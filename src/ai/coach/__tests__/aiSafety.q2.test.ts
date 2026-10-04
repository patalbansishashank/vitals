/**
 * Release gate Q2 (SUITE_SPEC §1.4, §5.2, §5.5, §5.7): the Coach over the REAL command registry and bus, once per
 * provider wire dialect (OpenAI chat completions — OpenAI, Gemini, local Ollama —, OpenAI Responses — OpenAI and
 * Sign in with ChatGPT through the Companion —, Anthropic Messages), with a scripted fake server.
 *
 * 1. The tools sent to the model never include a destructive command the registry keeps off the `ai` surface, and a
 *    forged call naming any destructive command (UI-only or not) is never dispatched and changes no document.
 * 2. A consequential edit by the model becomes a pending proposal: nothing changes until the person applies it.
 * 3. A log by the model applies at once, and its Undo restores the documents as they were.
 */
import { allCommands, dispatch, getCommand, outputOf, seal, settleCommits, type CommandResult, type DispatchOptions } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { COLLECTIONS, type CollectionId, type MemoryBackend } from '@/store';
import { effectiveEntries } from '@/living/logs';
// eslint-disable-next-line no-restricted-imports -- the test reads the profile projection the edit would change
import { useProfileStore } from '@/state/profileStore';
import { createChatModel, getPreset, presetCapabilities } from '../../providers';
import { fakeFetch, instantSleep, sse, sseEvents, type FakeReply, type RecordedRequest } from '../../testing/fakeFetch';
import { toolNameOf } from '../../tools/registry';
import { createCoachAdapter } from '../adapter';
import { appBus } from '../runtime';
import type { CoachBus } from '../tools';
import type { StreamEventView } from '../types';

type Dialect = 'openai-chat' | 'openai-responses' | 'anthropic-messages';
interface Call {
  id: string;
  name: string;
  args: unknown;
}

/* ------------------------------------------------------------------------------------------------ wire formats */

function toolTurn(dialect: Dialect, calls: Call[]): FakeReply {
  if (dialect === 'openai-chat') {
    return {
      text: sse(
        { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: calls.map((c, i) => ({ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        'data: [DONE]\n\n',
      ),
    };
  }
  if (dialect === 'anthropic-messages') {
    return {
      text: sseEvents(
        { event: 'message_start', data: { type: 'message_start', message: { id: 'm1', role: 'assistant', content: [], usage: { input_tokens: 900, output_tokens: 1 } } } },
        ...calls.flatMap((c, i) => [
          { event: 'content_block_start', data: { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: c.id, name: c.name, input: {} } } },
          { event: 'content_block_delta', data: { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(c.args) } } },
          { event: 'content_block_stop', data: { type: 'content_block_stop', index: i } },
        ]),
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ),
    };
  }
  return {
    text: sseEvents(
      ...calls.flatMap((c, i) => {
        const item = { type: 'function_call', id: `fc_${i}`, call_id: c.id, name: c.name, arguments: JSON.stringify(c.args) };
        return [
          { event: 'response.output_item.added', data: { type: 'response.output_item.added', output_index: i, item: { ...item, arguments: '' } } },
          { event: 'response.function_call_arguments.delta', data: { type: 'response.function_call_arguments.delta', output_index: i, item_id: item.id, delta: item.arguments } },
          { event: 'response.output_item.done', data: { type: 'response.output_item.done', output_index: i, item } },
        ];
      }),
      { event: 'response.completed', data: { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 900, output_tokens: 20 } } } },
    ),
  };
}

function textTurn(dialect: Dialect, text: string): FakeReply {
  if (dialect === 'openai-chat') return { text: sse({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 950, completion_tokens: 8 } }, 'data: [DONE]\n\n') };
  if (dialect === 'anthropic-messages') {
    return {
      text: sseEvents(
        { event: 'message_start', data: { type: 'message_start', message: { id: 'm2', role: 'assistant', content: [], usage: { input_tokens: 950, output_tokens: 1 } } } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ),
    };
  }
  return {
    text: sseEvents(
      { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', output_index: 0, delta: text } },
      { event: 'response.completed', data: { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 950, output_tokens: 8 } } } },
    ),
  };
}

type WireTool = { name?: string; function?: { name?: string }; tools?: WireTool[] };
/**
 * Tool names in a provider request body (chat: `tools[].function.name`; Responses and Anthropic: `tools[].name`;
 * a Responses namespace, as Sign in with ChatGPT sends, nests its tools under `tools[].tools`).
 */
function sentToolNames(req: RecordedRequest): string[] {
  const flat = (tools: WireTool[]): string[] => tools.flatMap((t) => (t.tools ? flat(t.tools) : [t.function?.name ?? t.name ?? '']));
  return flat((req.body as { tools?: WireTool[] }).tools ?? []);
}

/* ------------------------------------------------------------------------------------------------ fixtures */

/** Every provider route the app ships, by wire dialect. */
const PROVIDERS: Array<{ preset: string; dialect: Dialect; apiKey: string; serverUrl?: string }> = [
  { preset: 'openai-chat', dialect: 'openai-chat', apiKey: 'sk-q2-openai-chat' },
  { preset: 'gemini', dialect: 'openai-chat', apiKey: 'q2-gemini-key' },
  { preset: 'ollama', dialect: 'openai-chat', apiKey: '' },
  { preset: 'openai', dialect: 'openai-responses', apiKey: 'sk-q2-openai' },
  { preset: 'siwc', dialect: 'openai-responses', apiKey: '', serverUrl: 'https://vitals.example.ts.net:8443' },
  { preset: 'anthropic', dialect: 'anthropic-messages', apiKey: 'sk-ant-q2' },
];

const DESTRUCTIVE = () => allCommands().filter((d) => d.perm === 'destructive');
const DESTRUCTIVE_UI_ONLY = () => DESTRUCTIVE().filter((d) => !d.surfaces.includes('ai'));

/** Plausible arguments so that a destructive tool on the `ai` surface gets past schema validation. */
const FORGED_ARGS: Record<string, unknown> = {
  'plan.end': { reason: 'abandoned' },
  'plan.replace': { source: { rung: 'gentle' }, startDate: '2026-10-05', reason: 'replaced' },
  'data.import': { file: '{"vitalsVersion":2}', mode: 'replace' },
  'bio.deleteSource': { sourceKey: 'apple-health' },
  'coach.delete': { conversationId: 'coach' },
};

/** Documents of the person's data (bookkeeping collections excluded: ledgers, change log, jobs, caches). */
const DATA_COLS = (Object.keys(COLLECTIONS) as CollectionId[]).filter((c) => !['local', 'derived'].includes(COLLECTIONS[c].strategy) && !['pendingChanges', 'conversations', 'messages'].includes(c));

/** Every change still coalescing (the seed's own gestures) written, then every commit landed. */
async function settled(): Promise<void> {
  await seal();
  await settleCommits();
}

async function snapshot(backend: MemoryBackend, cols: readonly string[] = Object.keys(COLLECTIONS)): Promise<Record<string, unknown>> {
  await settled();
  const out: Record<string, unknown> = {};
  for (const col of cols) for (const d of await backend.list(col)) if (!d._deleted) out[`${col}/${d._id}`] = d.value;
  return out;
}

/** The app's localStorage mirrors (`vitals.*`), state only (the mirror's own write time is not data). */
function mirrors(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(globalThis.localStorage)) {
    try {
      out[k] = (JSON.parse(globalThis.localStorage.getItem(k) ?? 'null') as { state?: unknown } | null)?.state;
    } catch {
      out[k] = globalThis.localStorage.getItem(k);
    }
  }
  return out;
}

/**
 * What the person sees: append-only logs as their effective entries (a retract entry removes the one it targets,
 * as every screen reads them), every other data document as it is.
 */
async function effectiveState(backend: MemoryBackend): Promise<Record<string, unknown>> {
  await settled();
  const out: Record<string, unknown> = {};
  for (const col of DATA_COLS) {
    const rows = (await backend.list<Record<string, unknown>>(col)).filter((d) => !d._deleted).map((d) => ({ ...d.value, id: d._id }));
    if (COLLECTIONS[col].strategy === 'append') out[col] = effectiveEntries(rows as Array<{ id: string }>);
    else for (const r of rows) out[`${col}/${r.id}`] = r;
  }
  return out;
}

function recordingBus(): CoachBus & { calls: Array<{ id: string; opts: DispatchOptions; result: CommandResult }> } {
  const calls: Array<{ id: string; opts: DispatchOptions; result: CommandResult }> = [];
  return {
    ...appBus,
    calls,
    dispatch: async (id, input, opts) => {
      const result = await appBus.dispatch(id, input, opts);
      calls.push({ id, opts: opts ?? {}, result });
      return result;
    },
  };
}

function setup(p: (typeof PROVIDERS)[number], replies: FakeReply[]) {
  const { backend } = freshState({ cleared: true });
  const ff = fakeFetch(replies);
  const preset = getPreset(p.preset)!;
  const model = createChatModel({
    preset,
    apiKey: p.apiKey,
    ...(p.serverUrl ? { serverUrl: p.serverUrl } : {}),
    capabilities: { ...presetCapabilities(preset), tools: true, parallelTools: true, vision: false },
    deps: { fetch: ff.fetch, sleep: instantSleep().sleep, random: () => 0 },
  });
  const bus = recordingBus();
  let n = 0;
  const adapter = createCoachAdapter({ bus, model, provider: { name: preset.label, model: model.model }, aiActorId: preset.id, newId: () => `q2-${++n}`, sleep: async () => undefined });
  const send = async (text: string) => {
    const events: StreamEventView[] = [];
    await adapter.send({ conversationId: 'coach', text }, (e) => events.push(e), new AbortController().signal);
    const turn = adapter.history('coach').at(-1)!;
    return { turn, cards: turn.cards, events };
  };
  return { backend, ff, bus, adapter, send };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------------------------------------ tests */

describe('registry facts the gate relies on', () => {
  it('the destructive commands are known and every one off the ai surface carries a written reason', () => {
    const ids = DESTRUCTIVE().map((d) => d.id).sort();
    expect(ids).toEqual(expect.arrayContaining(['data.eraseAll', 'data.import', 'sync.unpair', 'coach.delete', 'bio.deleteSource', 'plan.end']));
    for (const d of DESTRUCTIVE_UI_ONLY()) expect(d.excludedReason?.ai, d.id).toBeTruthy();
  });
});

describe.each(PROVIDERS)('Coach over the real bus, provider $preset ($dialect)', (p) => {
  it('never offers UI-only destructive tools, and a forged call naming ANY destructive command dispatches nothing and changes nothing', async () => {
    const destructive = DESTRUCTIVE();
    // plan.end first: the one destructive request per turn becomes the typed-confirmation card
    const ordered = [...destructive].sort((a, b) => (a.id === 'plan.end' ? -1 : b.id === 'plan.end' ? 1 : 0));
    const calls = ordered.map((d, i) => ({ id: `forged_${i}`, name: toolNameOf(d.id), args: FORGED_ARGS[d.id] ?? {} }));
    const { backend, ff, bus, send } = setup(p, [toolTurn(p.dialect, calls), textTurn(p.dialect, 'That needs you, in the app.')]);
    const before = await snapshot(backend);
    const ls = mirrors();

    const { cards } = await send('end my plan, erase everything and stop syncing');

    // the tool list the provider received
    const offered = sentToolNames(ff.requests[0]!);
    expect(offered.length).toBeGreaterThan(5);
    for (const d of DESTRUCTIVE_UI_ONLY()) expect(offered, d.id).not.toContain(toolNameOf(d.id));
    // a destructive tool that IS on the ai surface may only be offered as a confirmation request (never executed)
    for (const name of offered) {
      const def = getCommand(name.replace(/_/g, '.')) ?? allCommands().find((d) => toolNameOf(d.id) === name);
      if (def?.perm === 'destructive') expect(def.surfaces, def.id).toContain('ai');
    }

    // nothing destructive reached the bus, from any route
    const destructiveIds = new Set(destructive.map((d) => d.id as string));
    expect(bus.calls.filter((c) => destructiveIds.has(c.id))).toEqual([]);
    // the person's data and settings are exactly as before
    expect(await snapshot(backend)).toEqual(before);
    const now = mirrors();
    for (const k of Object.keys(ls)) expect(now[k], k).toEqual(ls[k]);
    // UI-only ones become "do it in the app" cards; plan.end a typed-confirmation card the person must complete
    const endCard = cards.find((c) => c.class === 'destructive');
    expect(endCard?.title).toMatch(/end/i);
    expect(cards.filter((c) => c.class === 'uiOnly').length).toBe(DESTRUCTIVE_UI_ONLY().length);
    // the model was told nothing changed for every call
    const secondBody = JSON.stringify(ff.requests[1]!.body);
    expect(secondBody).not.toMatch(/"status":"applied"/);
  });

  it('an edit (consequential write) becomes a pending proposal: nothing changes until the person applies it', async () => {
    const { backend, bus, adapter, send } = setup(p, [
      toolTurn(p.dialect, [{ id: 'edit_1', name: 'profile_patch', args: { weightKg: 77 } }]),
      textTurn(p.dialect, 'I proposed the change.'),
    ]);
    const weightBefore = useProfileStore.getState().weightKg;
    const before = await snapshot(backend, DATA_COLS);
    const { cards } = await send('set my weight to 77 kg');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ class: 'edit', state: 'pending' });
    // a dry run for the preview, then the real dispatch, which the bus stages
    const staged = bus.calls.find((c) => c.id === 'profile.patch' && !c.opts.dryRun)!;
    expect(staged.opts.actor?.kind).toBe('ai');
    expect(staged.result.ok && 'pending' in staged.result).toBe(true);
    expect(useProfileStore.getState().weightKg).toBe(weightBefore);
    expect(await snapshot(backend, DATA_COLS)).toEqual(before);
    expect(outputOf(await dispatch('coach.pending', {}))).toEqual([expect.objectContaining({ commandId: 'profile.patch', status: 'pending' })]);

    // the person applies it
    expect(await adapter.act(cards[0]!.id, 'apply')).toMatchObject({ ok: true });
    await settleCommits();
    expect(useProfileStore.getState().weightKg).toBe(77);
    expect(outputOf(await dispatch('coach.pending', {}))).toEqual([]);
  });

  it('a log applies at once, and its Undo restores the previous state', async () => {
    const { backend, bus, adapter, send } = setup(p, [
      toolTurn(p.dialect, [
        { id: 'log_1', name: 'log_measurement', args: { metric: 'waistCm', value: 88.5, date: '2026-10-01' } },
        { id: 'log_2', name: 'log_note', args: { text: 'Slept badly', date: '2026-10-01' } },
      ]),
      textTurn(p.dialect, 'Logged both.'),
    ]);
    const before = await effectiveState(backend);
    const { cards } = await send('waist 88.5 cm today, and note that I slept badly');
    expect(cards.map((c) => [c.class, c.state])).toEqual([['log', 'applied'], ['log', 'applied']]);
    // applied at once, by the AI, without a proposal
    expect(bus.calls.filter((c) => c.id.startsWith('log.') && getCommand(c.id)?.perm !== 'read').map((c) => [c.id, c.opts.actor?.kind, c.result.ok && 'changeSet' in c.result])).toEqual([
      ['log.measurement', 'ai', true],
      ['log.note', 'ai', true],
    ]);
    const after = await effectiveState(backend);
    expect(after).not.toEqual(before);
    expect(Object.values(after['measurements'] as object[]).length).toBe((before['measurements'] as object[]).length + 1);

    for (const c of cards) expect(await adapter.act(c.id, 'undo'), c.title).toMatchObject({ ok: true });
    const final = await effectiveState(backend);
    // the logs are gone from every list the person sees, and every document that existed is as it was
    for (const k of Object.keys(before)) expect(final[k], k).toEqual(before[k]);
    // (the only document that may appear is the seed's starter scenario catching up with its projection in a run
    // after another test; it is not something the Coach wrote)
    expect(Object.keys(final).filter((k) => !(k in before) && k !== 'scenarios/starter')).toEqual([]);
    expect(adapter.history('coach').at(-1)!.cards.map((c) => c.state)).toEqual(['undone', 'undone']);
  });
});

describe('forged dispatch straight to the bus', () => {
  it.each(['ai', 'webmcp', 'mcp', 'companion'] as const)('no destructive command executes for actor %s, and nothing changes', async (kind) => {
    const { backend } = freshState({ cleared: true });
    const before = await snapshot(backend);
    for (const d of DESTRUCTIVE()) {
      const r = await dispatch(d.id, FORGED_ARGS[d.id] ?? {}, { actor: { kind, id: 'forger', conversationId: 'c', toolCallId: `t-${d.id}` }, idempotencyKey: `forged:${d.id}` });
      expect(r.ok, `${d.id} as ${kind}`).toBe(false);
      expect(['surface_forbidden', 'confirmation_required'], d.id).toContain(r.ok ? 'ok' : r.error.code);
    }
    expect(await snapshot(backend)).toEqual(before);
  });
});
