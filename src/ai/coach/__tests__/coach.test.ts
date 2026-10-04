// @vitest-environment node
/**
 * The Coach end to end over a scripted provider (fake fetch, OpenAI-compatible stream) and a fake command bus that
 * mirrors the dispatcher's agent rules (staging of consequential writes, no destructive commands for agents).
 */
import type { CommandDef, CommandResult, DispatchOptions, ToolDescriptor } from '@/commands/types';
import { createChatModel, getPreset, presetCapabilities, type Capabilities, type ChatModel } from '../../providers';
import { fakeFetch, instantSleep, sse, type FakeReply, type RecordedRequest } from '../../testing/fakeFetch';
import { toolNameOf } from '../../tools/registry';
import { estimateTextTokens } from '../../providers/usage';
import { createCoachAdapter, type CoachAdapterDeps } from '../adapter';
import { addDays } from '@/living/dates';
import { buildBriefing, type BriefingData } from '../briefing';
import { createMemoryConversationStore, type ConversationStore } from '../conversation';
import { UNDO_WINDOW_OVER } from '../executor';
import type { CoachBus } from '../tools';
import type { CardView, StreamEventView } from '../types';

/* ------------------------------------------------------------------------------------------------ fake bus */

type Spec = Pick<CommandDef, 'id' | 'title' | 'description' | 'perm' | 'impact'> & { surfaces?: string[]; output?: (input: Record<string, unknown>, opts: DispatchOptions) => unknown };

const ANY = { type: 'object', additionalProperties: true };
const SPECS: Spec[] = [
  { id: 'log.meal', title: 'Log a meal', description: 'Log a meal as components with grams.', perm: 'write', impact: 'low', output: (i) => mealOut(i) },
  { id: 'log.mealFromPhoto', title: 'Log a meal from a photo', description: 'Log a meal from an attached photo.', perm: 'write', impact: 'low', output: () => ({ ...mealOut({ components: [{ name: 'dal tadka', grams: 150 }, { name: 'rice', grams: 250 }] }), saw: 'a steel thali with dal, rice and two roti' }) },
  { id: 'log.retract', title: 'Remove an entry', description: 'Remove a logged entry.', perm: 'write', impact: 'low', output: () => ({ retracted: true }) },
  { id: 'log.session', title: 'Log a training session', description: 'Log a session.', perm: 'write', impact: 'low' },
  { id: 'log.sleep', title: 'Log sleep', description: 'Log last night’s sleep.', perm: 'write', impact: 'low', output: () => ({}) },
  { id: 'log.get', title: 'Read the log', description: 'Logged entries between two dates.', perm: 'read', output: () => Array.from({ length: 75 }, (_, i) => ({ id: `e${i}`, kind: 'meal', date: '2026-09-30' })) },
  { id: 'today.get', title: 'Today', description: 'Today.', perm: 'read', output: () => ({ plan: null }) },
  { id: 'plan.swapExercise', title: 'Swap an exercise', description: 'Swap a prescribed exercise for another on a date; returns how equivalent the stimulus is.', perm: 'write', impact: 'low', output: (i) => swapOut(i) },
  { id: 'plan.declareEvent', title: 'Declare an event', description: 'Tell the plan about days without training; returns a re-plan proposal with the goal-date impact.', perm: 'write', impact: 'consequential', output: () => PROPOSAL },
  { id: 'plan.shift', title: 'Shift plan days', description: 'Shift days, optionally absorbing an occasion; returns a proposal with the goal-date impact.', perm: 'write', impact: 'consequential', output: () => PROPOSAL },
  { id: 'plan.end', title: 'End the plan', description: 'End the running plan.', perm: 'destructive' },
  { id: 'settings.update', title: 'Change settings', description: 'Change display settings.', perm: 'write', impact: 'low', output: () => ({}) },
  { id: 'coach.applyPending', title: 'Apply a proposal', description: 'Apply.', perm: 'write', impact: 'consequential', surfaces: ['ui'], output: () => ({ applied: true, result: PROPOSAL }) },
  { id: 'coach.discardPending', title: 'Discard a proposal', description: 'Discard.', perm: 'write', impact: 'low', output: () => ({ discarded: true }) },
  { id: 'coach.delete', title: 'Delete a conversation', description: 'Delete.', perm: 'destructive', surfaces: ['ui'] },
  { id: 'data.eraseAll', title: 'Erase all data', description: 'Erase.', perm: 'destructive', surfaces: ['ui'] },
  { id: 'safety.setFastingOptIn', title: 'Fasting opt-in', description: 'Opt in.', perm: 'write', impact: 'consequential', surfaces: ['ui'] },
  { id: 'history.undo', title: 'Undo a change', description: 'Undo.', perm: 'write', impact: 'low', output: () => ({ undone: true, skipped: [] }) },
];

/** AdaptOutput (src/commands/living/adapt.ts). */
const PROPOSAL = {
  planId: 'p1',
  version: 3,
  status: 'proposed',
  cardId: 'version:p1:3',
  pinned: ['2026-10-02'],
  diff: [{ date: '2026-10-02', field: 'training', before: 'strength 17:30', after: 'rest', why: 'busy' }],
  goalDates: [{ goal: 0, before: '2026-12-21', after: '2026-12-23', range: ['2026-12-21', '2026-12-30'] }],
  impact: [{ metric: 'weight', endP50Delta: 0.2 }],
  notes: ['Three days without training move the goal date by about two days.'],
};

/** plan.swapExercise output: the day's swap, or every week (a proposed plan version). */
function swapOut(i: Record<string, unknown>) {
  const base = { equivalence: { score: 0.86, credit: 0.86, parity: false, band: 'partial', perTerm: [], shortfall: [], alsoTrained: [] }, swap: { slotKey: i.slotKey, from: i.from, to: { exerciseId: i.to, setCount: 3 }, credit: 0.86, band: 'partial' } };
  if (i.everyWeek !== true) return { ...base, everyWeek: false, version: null, cardId: null, notes: ['Back squat → Goblet squat on 2026-10-01.'] };
  return { ...base, everyWeek: true, weekly: { weeks: 6, meanCredit: 0.91 }, version: 4, status: 'proposed', cardId: 'version:p1:4', notes: ['Use Goblet squat instead of Back squat on this weekday every week from 2026-10-01 (6 sessions).', 'It keeps 91 % of the prescribed training stimulus.'] };
}

function mealOut(i: Record<string, unknown>) {
  const comps = (i.components as Array<{ name: string; grams: number }>) ?? [];
  return {
    status: 'logged',
    entryId: `entry-${comps.length}`,
    totals: { energyKcal: { value: 640, sd: 80, low: 510, high: 780 }, proteinG: { value: 33, sd: 4, low: 25, high: 41 } },
    components: comps.map((c) => ({ name: c.name, grams: c.grams, gramsLow: c.grams * 0.8, gramsHigh: c.grams * 1.3, confidence: 0.8, nutrients: { energyKcal: { value: c.grams * 1.5 } } })),
    confidence: 0.8,
    needsConfirmation: false,
    undo: { command: 'log.retract', input: { entryId: `entry-${comps.length}` } },
  };
}

interface Dispatched {
  id: string;
  input: unknown;
  opts: DispatchOptions;
}

let deviceOwnsSleep = false;
function fakeBus(): CoachBus & { calls: Dispatched[]; executed: Dispatched[] } {
  const calls: Dispatched[] = [];
  const executed: Dispatched[] = [];
  const defs = new Map<string, CommandDef & Spec>(SPECS.map((s) => [s.id, { ...s, input: ANY, surfaces: s.surfaces ?? ['ui', 'ai'], excludedReason: { ai: 'Only you can do this, in the app.' } } as unknown as CommandDef & Spec] as const));
  let n = 0;
  return {
    calls,
    executed,
    getCommand: (id) => defs.get(id),
    commandIds: () => [...defs.keys()],
    on: () => () => undefined,
    manifest: () =>
      [...defs.values()]
        .filter((d) => d.surfaces.includes('ai'))
        .map((d) => ({ name: toolNameOf(d.id), commandId: d.id, version: 1, title: d.title, description: d.description, inputSchema: ANY, outputSchema: ANY, annotations: {} as ToolDescriptor['annotations'], perm: d.perm, ...(d.impact ? { impact: d.impact } : {}), group: d.id.split('.')[0] }) as ToolDescriptor),
    dispatch: async (id, input, opts = {}): Promise<CommandResult> => {
      calls.push({ id, input, opts });
      const def = defs.get(id) as (CommandDef & Spec) | undefined;
      if (!def) return { ok: false, error: { code: 'not_found', message: `Unknown command "${id}".` } };
      const actor = opts.actor ?? { kind: 'user', id: 'local-user' };
      if (actor.kind === 'ai' && !def.surfaces.includes('ai')) return { ok: false, error: { code: 'surface_forbidden', message: 'Not available here.' } };
      if (def.perm === 'destructive' && actor.kind !== 'user') return { ok: false, error: { code: 'confirmation_required', message: 'This needs your confirmation in the app.' } };
      const output = def.output?.(input as Record<string, unknown>, opts) ?? {};
      if (opts.dryRun) return { ok: true, output, changeSet: null, notices: [] };
      if (actor.kind === 'ai' && def.impact === 'consequential') return { ok: true, pending: { pendingId: `pend-${++n}`, commandId: id as never, expiresAt: '2026-10-02T09:00:00.000Z' }, notices: [] };
      // a device-owned stream: the bus stages a correction in place of the log (SUITE_SPEC §14.6)
      if (actor.kind === 'ai' && id === 'log.sleep' && deviceOwnsSleep) {
        const i = input as { bedAt: string; wakeAt: string };
        const asleepS = (Date.parse(i.wakeAt) - Date.parse(i.bedAt)) / 1000;
        return { ok: true, pending: { pendingId: `pend-${++n}`, commandId: 'biometrics.correct' as never, expiresAt: '2026-10-02T09:00:00.000Z' }, notices: [], redirected: 'biometrics.correct' as never, redirectedInput: { target: { kind: 'sleep', localDate: '2026-10-02' }, value: { asleepS, bedAt: i.bedAt, wakeAt: i.wakeAt } } };
      }
      if (def.perm !== 'read') executed.push({ id, input, opts });
      return { ok: true, output, changeSet: { id: `cs-${++n}`, commandId: id as never, label: def.title, at: '', actor, docs: [] }, notices: [] };
    },
  };
}

/* ------------------------------------------------------------------------------------------------ scripted model */

type Call = { id: string; name: string; args: unknown };
const toolTurn = (...calls: Call[]): FakeReply => ({
  text: sse(
    { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: calls.map((c, i) => ({ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    'data: [DONE]\n\n',
  ),
});
const textTurn = (t: string): FakeReply => ({ text: sse({ choices: [{ index: 0, delta: { content: t }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } }, 'data: [DONE]\n\n') });

function modelWith(replies: Array<FakeReply | ((r: RecordedRequest) => FakeReply)>, caps: Partial<Capabilities> = {}) {
  const ff = fakeFetch(replies);
  const preset = getPreset('openrouter')!;
  const model: ChatModel = createChatModel({ preset, model: 'anthropic/claude-sonnet-5.5', apiKey: 'test-key', capabilities: { ...presetCapabilities(preset), tools: true, parallelTools: true, vision: false, ...caps }, deps: { fetch: ff.fetch, sleep: instantSleep().sleep, random: () => 0 } });
  return { ff, model };
}

function setup(replies: Parameters<typeof modelWith>[0], caps: Partial<Capabilities> = {}, extra: Partial<CoachAdapterDeps> = {}) {
  const bus = fakeBus();
  const { ff, model } = modelWith(replies, caps);
  let id = 0;
  const adapter = createCoachAdapter({
    bus,
    model,
    provider: { name: 'OpenRouter', model: 'Claude Sonnet 5.5' },
    now: () => new Date('2026-10-01T08:00:00.000Z'),
    newId: () => `n${++id}`,
    sleep: async () => undefined,
    ...extra,
  });
  return { bus, ff, adapter };
}

async function send(adapter: ReturnType<typeof setup>['adapter'], text: string, extra: { photo?: File; signal?: AbortSignal; onEvent?: (e: StreamEventView) => void } = {}) {
  const events: StreamEventView[] = [];
  await adapter.send({ conversationId: 'coach', text, ...(extra.photo ? { photo: extra.photo } : {}) }, (e) => (events.push(e), extra.onEvent?.(e)), extra.signal ?? new AbortController().signal);
  const turns = adapter.history('coach');
  return { events, turn: turns[turns.length - 1]!, cards: turns[turns.length - 1]!.cards };
}

const executedIds = (bus: ReturnType<typeof fakeBus>) => bus.executed.map((d) => d.id);

/* ------------------------------------------------------------------------------------------------ tests */

describe('Coach conversation', () => {
  it("a tab's context reaches the model with the meal's name next to its slot id (Q4-10)", async () => {
    const { adapter, ff } = setup([textTurn('What was in the poha?')]);
    await adapter.send({ conversationId: 'coach', text: 'poha and chai', context: { screen: 'food', slot: 'meal2', slotName: 'lunch', date: '2026-10-01' } }, () => undefined, new AbortController().signal);
    expect(JSON.stringify(ff.requests[0]!.body)).toContain('[context: from food, slot meal2 (lunch), date 2026-10-01]');
  });

  it('logs a meal from text: log card, applied at once, Undo retracts as the person', async () => {
    const { bus, adapter, ff } = setup([toolTurn({ id: 'c1', name: 'log_meal', args: { slot: 'lunch', components: [{ name: 'dal', grams: 150 }, { name: 'rice', grams: 160 }], method: 'aiText' } }), textTurn('Logged lunch.')]);
    const { turn, cards, events } = await send(adapter, 'had dal and rice for lunch');
    expect(turn.text).toBe('Logged lunch.');
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card).toMatchObject({ class: 'log', state: 'applied', title: 'Logged lunch' });
    expect(card.totals).toContain('kcal (510–780)');
    expect(card.meal?.components.map((c) => c.name)).toEqual(['dal', 'rice']);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['card', 'text', 'done']));
    // dispatched as the AI with the conversation:toolCall idempotency key
    const logged = bus.executed.find((d) => d.id === 'log.meal')!;
    expect(logged.opts.actor).toMatchObject({ kind: 'ai', conversationId: 'coach', toolCallId: 'c1' });
    expect(logged.opts.idempotencyKey).toBe('coach:c1');
    // the tool result went back to the model
    expect(JSON.stringify(ff.requests[1]!.body)).toContain('"status\\":\\"applied');

    expect(await adapter.act(card.id, 'undo')).toEqual({ ok: true });
    const retract = bus.executed.find((d) => d.id === 'log.retract')!;
    expect(retract.input).toEqual({ entryId: 'entry-2' });
    expect(retract.opts.actor).toMatchObject({ kind: 'user', onBehalfOf: { kind: 'ai' } });
    expect(adapter.history('coach').at(-1)!.cards[0]!.state).toBe('undone');
  });

  it('photo flow: stores the photo, logs from it, shows "what I saw"; edited grams re-log as photo + your grams', async () => {
    const putPhoto = vi.fn(async () => ({ attachmentId: 'att-1', url: 'blob:thumb' }));
    const { bus, adapter, ff } = setup([toolTurn({ id: 'p1', name: 'log_meal_from_photo', args: { attachmentId: 'att-1', slot: 'lunch' } }), textTurn('Logged it from your photo.')], { vision: true }, { putPhoto });
    const photo = new File([new Uint8Array([1, 2, 3])], 'thali.jpg', { type: 'image/jpeg' });
    const { cards } = await send(adapter, 'lunch', { photo });
    expect(putPhoto).toHaveBeenCalledOnce();
    expect(JSON.stringify(ff.requests[0]!.body)).toContain('attachmentId \\"att-1\\"');
    const card = cards[0] as CardView;
    expect(card.meal?.photo?.url).toBe('blob:thumb');
    expect(card.meal?.photo?.alt).toContain('steel thali');
    expect(card.meal?.review).toBe(true);
    expect(card.source?.label).toBe('Coach · photo');
    expect(card.meal?.components[1]).toMatchObject({ name: 'rice', grams: 250, gramsLow: 200, gramsHigh: 325 });
    expect(adapter.history('coach').find((t) => t.role === 'you')!.photo?.url).toBe('blob:thumb');

    expect((await adapter.act(card.id, 'edit', { componentId: card.meal!.components[1]!.id, grams: 300 })).ok).toBe(true);
    expect(executedIds(bus)).toEqual(['log.mealFromPhoto', 'log.retract', 'log.meal']);
    expect(bus.executed[2]!.input).toMatchObject({ method: 'aiPhotoUserGrams', attachmentIds: ['att-1'], components: [{ name: 'dal tadka', grams: 150 }, { name: 'rice', grams: 300 }] });
    const next = adapter.history('coach').at(-1)!.cards[0]!;
    expect(next.meal?.components[1]).toMatchObject({ grams: 300, yours: true });
    expect(next.meal?.review).toBe(false);
  });

  /** A conversation store whose turns go through JSON, as the documents do (nothing survives by reference). */
  function jsonStore(): ConversationStore {
    const inner = createMemoryConversationStore();
    const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    return { ...inner, appendTurn: (id, t) => inner.appendTurn(id, copy(t)), updateTurn: (id, t) => inner.updateTurn(id, copy(t)), listTurns: async (id) => copy(await inner.listTurns(id)) };
  }

  async function loggedThenReloaded(reloadAt: string) {
    const store = jsonStore();
    const first = setup([toolTurn({ id: 'c1', name: 'log_meal', args: { slot: 'lunch', components: [{ name: 'dal', grams: 150 }, { name: 'rice', grams: 160 }], method: 'aiText' } }), textTurn('Logged lunch.')], {}, { store });
    const { cards } = await send(first.adapter, 'had dal and rice for lunch');
    // a reload: a new adapter (and executor) over the same stored conversation, the old one's memory gone
    const bus = fakeBus();
    const { model } = modelWith([]);
    const adapter = createCoachAdapter({ bus, model, store, now: () => new Date(reloadAt), newId: () => 'r1' });
    adapter.history('coach');
    await vi.waitFor(() => expect(adapter.history('coach').at(-1)?.cards).toHaveLength(1));
    return { bus, adapter, cardId: cards[0]!.id };
  }

  it('Undo on a Coach card still works after a reload, through the command bus (log.retract)', async () => {
    const { bus, adapter, cardId } = await loggedThenReloaded('2026-10-02T07:00:00.000Z');
    expect(adapter.history('coach').at(-1)!.cards[0]).toMatchObject({ id: cardId, state: 'applied' });
    expect(adapter.history('coach').at(-1)!.cards[0]!.note).toBeUndefined();
    expect(await adapter.act(cardId, 'undo')).toEqual({ ok: true });
    expect(bus.executed.map((d) => [d.id, d.input])).toEqual([['log.retract', { entryId: 'entry-2' }]]);
    expect(bus.executed[0]!.opts.actor).toMatchObject({ kind: 'user', onBehalfOf: { kind: 'ai', conversationId: 'coach', toolCallId: 'c1' } });
    expect(adapter.history('coach').at(-1)!.cards[0]!.state).toBe('undone');
  });

  it('after the 24 h window a reloaded card says Undo is over and nothing is dispatched', async () => {
    const { bus, adapter, cardId } = await loggedThenReloaded('2026-10-02T08:00:01.000Z');
    expect(adapter.history('coach').at(-1)!.cards[0]).toMatchObject({ state: 'applied', note: UNDO_WINDOW_OVER });
    expect(await adapter.act(cardId, 'undo')).toEqual({ ok: false, message: UNDO_WINDOW_OVER });
    expect(bus.calls).toEqual([]);
    expect(adapter.history('coach').at(-1)!.cards[0]!.state).toBe('applied');
  });

  it('swaps an exercise (low impact): applied with Undo, stimulus match on the card', async () => {
    const { bus, adapter } = setup([toolTurn({ id: 's1', name: 'plan_swap_exercise', args: { date: '2026-10-01', slotKey: 'rt:0', from: 'barbell-squat', to: 'goblet-squat' } }), textTurn('Swapped.')]);
    const { cards } = await send(adapter, 'no barbell today, swap the squats');
    expect(cards[0]).toMatchObject({ class: 'log', state: 'applied' });
    expect(cards[0]!.items).toEqual([
      { label: 'date', before: null, after: '2026-10-01' },
      { label: 'stimulus kept', before: null, after: '86 %' },
    ]);
    expect(cards[0]!.note).toBe('Back squat → Goblet squat on 2026-10-01.');
    expect(executedIds(bus)).toEqual(['plan.swapExercise']);
  });

  it('a swap every week leaves a proposal on Today; the card says so with the weekly stimulus kept', async () => {
    const { bus, adapter } = setup([toolTurn({ id: 's2', name: 'plan_swap_exercise', args: { date: '2026-10-01', slotKey: 'rt:0', from: 'barbell-squat', to: 'goblet-squat', everyWeek: true } }), textTurn('Proposed.')]);
    const { cards } = await send(adapter, 'swap the squats every Thursday');
    expect(cards[0]).toMatchObject({ class: 'log', state: 'applied', title: 'Swap an exercise · every week' });
    expect(cards[0]!.items).toContainEqual({ label: 'stimulus kept', before: null, after: '91 %' });
    expect(cards[0]!.note).toMatch(/It keeps 91 % of the prescribed training stimulus\. A proposal is waiting on Today; nothing changes until it is applied\.$/);
    expect(JSON.stringify({ title: cards[0]!.title, items: cards[0]!.items, note: cards[0]!.note })).not.toMatch(/rt:0|barbell-squat|goblet-squat/);
    expect(executedIds(bus)).toEqual(['plan.swapExercise']);
  });

  it('"I slept six hours" on a ring-fed night → the card shows the correction the bus staged, not the log (no raw times)', async () => {
    deviceOwnsSleep = true;
    try {
      const { bus, adapter } = setup([toolTurn({ id: 's1', name: 'log_sleep', args: { bedAt: '2026-10-01T19:10:00.000Z', wakeAt: '2026-10-02T01:10:00.000Z' } }), textTurn('Noted, waiting for you to confirm.')]);
      const { cards } = await send(adapter, 'I slept six hours last night');
      const card = cards[0]!;
      expect(card.state).toBe('pending');
      expect(card.title).toMatch(/^Correct your sleep/);
      expect(card.title).toContain('Yours 6 h 00 min');
      expect(JSON.stringify({ title: card.title, items: card.items, note: card.note })).not.toMatch(/2026-10-01T19:10|bed at|wake at/);
      expect(executedIds(bus)).toEqual([]);
    } finally {
      deviceOwnsSleep = false;
    }
  });

  it('"busy for three days" → plan.declareEvent proposal with the goal-date effect; Apply goes through coach.applyPending', async () => {
    const { bus, adapter, ff } = setup([toolTurn({ id: 'b1', name: 'plan_declare_event', args: { kind: 'busy', from: '2026-10-02', to: '2026-10-04' } }), textTurn('Here’s what that would do.')]);
    const { cards } = await send(adapter, "I'm busy for three days, no training");
    const card = cards[0]!;
    expect(card).toMatchObject({ class: 'edit', state: 'pending', title: 'Proposal · declare an event', until: '2026-10-02T09:00:00.000Z' });
    expect(card.impact?.goalDates[0]).toEqual({ label: 'goal date', before: ['2026-12-21', '2026-12-21'], after: ['2026-12-21', '2026-12-30'] });
    expect(card.impact?.metrics[0]).toMatchObject({ label: 'weight by the end', delta: 0.2, unit: 'kg' });
    expect(card.items[0]).toMatchObject({ before: 'strength 17:30', after: 'rest' });
    // staged, not applied: a dry run then the staged dispatch, nothing executed
    expect(bus.calls.filter((c) => c.id === 'plan.declareEvent').map((c) => !!c.opts.dryRun)).toEqual([true, false]);
    expect(executedIds(bus)).toEqual([]);
    expect(JSON.stringify(ff.requests[1]!.body)).toContain('pending_user');

    expect(await adapter.act(card.id, 'apply')).toEqual({ ok: true });
    const staged = bus.calls.find((c) => c.id === 'plan.declareEvent' && !c.opts.dryRun)!;
    expect(staged.opts.actor).toMatchObject({ kind: 'ai', toolCallId: 'b1' });
    expect(bus.executed.map((d) => d.id)).toEqual(['coach.applyPending']);
    expect(bus.executed[0]!.input).toEqual({ pendingId: expect.stringMatching(/^pend-/) });
    expect(bus.executed[0]!.opts.actor).toMatchObject({ kind: 'user', onBehalfOf: { kind: 'ai' } });
    const applied = adapter.history('coach').at(-1)!.cards[0]!;
    expect(applied.state).toBe('applied');
    // the plan keeps a change that raises load as a proposal on Today: the card says where it waits
    expect(applied.note).toBe('Three days without training move the goal date by about two days. It is waiting on Today: apply it there to change the plan.');
  });

  it('absorbs a high-carbohydrate occasion through plan.shift as a proposal', async () => {
    const { bus, adapter } = setup([
      toolTurn({ id: 'h1', name: 'plan_shift', args: { from: '2026-10-04', days: 1, mode: 'habitual', absorb: { date: '2026-10-04', extraCarbG: 150, note: 'wedding' } } }),
      textTurn('I can absorb the wedding.'),
    ]);
    const { cards } = await send(adapter, 'wedding on Saturday, lots of rice and sweets');
    expect(cards[0]).toMatchObject({ class: 'edit', state: 'pending' });
    expect(cards[0]!.impact?.goalDates).toHaveLength(1);
    expect(executedIds(bus)).toEqual([]);
    expect(await adapter.act(cards[0]!.id, 'discard')).toEqual({ ok: true });
    expect(bus.executed.map((d) => d.id)).toEqual(['coach.discardPending']);
  });

  it('the model can never execute a destructive command, even when it calls one', async () => {
    const { bus, adapter } = setup([
      toolTurn({ id: 'd1', name: 'plan_end', args: { reason: 'abandoned' } }, { id: 'd2', name: 'coach_delete', args: { conversationId: 'coach' } }, { id: 'd3', name: 'data_erase_all', args: {} }),
      textTurn('Ending a plan needs your confirmation.'),
    ]);
    const { cards } = await send(adapter, 'end my plan and delete everything');
    expect(cards.map((c) => c.class)).toEqual(['destructive', 'uiOnly', 'uiOnly']);
    expect(cards[0]!.confirm).toMatchObject({ word: 'end', actionLabel: 'End plan' });
    expect(bus.calls.map((c) => c.id)).not.toEqual(expect.arrayContaining(['plan.end']));
    expect(bus.calls.some((c) => c.id === 'coach.delete' || c.id === 'data.eraseAll')).toBe(false);
    expect(bus.executed).toEqual([]);
    // the page completes it after the typed confirmation; the Coach only records it
    expect(await adapter.act(cards[0]!.id, 'review', { outcome: 'confirmed' })).toEqual({ ok: true });
    expect(bus.executed).toEqual([]);
    expect(adapter.history('coach').at(-1)!.cards[0]!.state).toBe('applied');
  });

  it('blocks safety-loosening calls with a blocked card', async () => {
    const { bus, adapter } = setup([
      toolTurn({ id: 'x1', name: 'safety_set_fasting_opt_in', args: { optIn: true } }, { id: 'x2', name: 'settings_update', args: { patch: { quietMode: false } } }),
      textTurn('Only you can change that.'),
    ]);
    const { cards } = await send(adapter, 'turn off my safety limits');
    expect(cards.map((c) => c.class)).toEqual(['blocked', 'blocked']);
    expect(bus.calls.some((c) => c.id.startsWith('safety.') || c.id === 'settings.update')).toBe(false);
  });

  it('pages get_* tools and caps results with a "more" cursor', async () => {
    const { adapter, ff } = setup([toolTurn({ id: 'g1', name: 'get_log', args: { from: '2026-09-01', to: '2026-09-30', limit: 30 } }), textTurn('You logged a lot.')]);
    const { turn } = await send(adapter, 'what did I eat last month?');
    expect(turn.reads?.reads?.[0]?.label).toBe('read the log');
    const toolMsg = (ff.requests[1]!.body as { messages: Array<{ role: string; content: string }> }).messages.find((m) => m.role === 'tool')!;
    const env = JSON.parse(toolMsg.content) as { data: { items: unknown[]; total: number; nextCursor: string; more: string } };
    expect(env.data.items).toHaveLength(30);
    expect(env.data.total).toBe(75);
    expect(env.data.more).toContain('cursor "30"');
  });
});

describe('Coach degradation, limits and errors', () => {
  it('basic tier: only read and log tools; a plan edit it calls anyway is refused', async () => {
    const { bus, adapter } = setup([toolTurn({ id: 'k1', name: 'plan_shift', args: { from: '2026-10-02', days: 3, mode: 'noTraining' } }), textTurn('I can’t change your plan.')], {}, { tier: 'basic' });
    await send(adapter, 'skip training this week');
    const names = adapter.lastToolNames();
    expect(names).toEqual(expect.arrayContaining(['log_meal', 'get_log', 'today_get']));
    expect(names).not.toEqual(expect.arrayContaining(['plan_shift']));
    expect(names.some((n) => n === 'plan_declare_event' || n === 'plan_end')).toBe(false);
    expect(bus.calls.some((c) => c.id === 'plan.shift')).toBe(false);
    expect(adapter.status().kind).toBe('basic');
  });

  it('no tools: structured-output fallback suggests a log card the person confirms', async () => {
    const reply = { reply: 'Here’s what I’d log.', intent: 'log_meal', args: { slot: 'dinner', components: [{ name: 'roti', grams: 70 }] } };
    const { bus, adapter, ff } = setup([{ json: { choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(reply) }, finish_reason: 'stop' }] } }, textTurn(JSON.stringify(reply))], { tools: false, streaming: false });
    const { turn, cards } = await send(adapter, 'two roti for dinner');
    expect(adapter.status().kind).toBe('noTools');
    expect(turn.text).toBe('Here’s what I’d log.');
    expect(cards[0]).toMatchObject({ class: 'log', state: 'pending' });
    expect((ff.requests[0]!.body as { tools?: unknown }).tools).toBeUndefined();
    expect(bus.executed).toEqual([]);
    expect(await adapter.act(cards[0]!.id, 'apply')).toEqual({ ok: true });
    expect(bus.executed[0]).toMatchObject({ id: 'log.meal', input: { method: 'aiText', slot: 'dinner' } });
    expect(bus.executed[0]!.opts.actor).toMatchObject({ kind: 'user', onBehalfOf: { kind: 'ai' } });
  });

  it('no vision: a photo gets a request for a text description and nothing is sent', async () => {
    const { adapter, ff } = setup([], { vision: false });
    expect(adapter.status().vision).toBe(false);
    const { turn } = await send(adapter, 'lunch', { photo: new File([new Uint8Array([1])], 'x.jpg', { type: 'image/jpeg' }) });
    expect(turn.text).toContain('can’t see photos');
    expect(ff.requests).toHaveLength(0);
  });

  it('stop: aborting after a tool step ends the turn as stopped without another request', async () => {
    const ctrl = new AbortController();
    const { adapter, ff } = setup([toolTurn({ id: 'a1', name: 'log_meal', args: { components: [{ name: 'oats', grams: 250 }], method: 'aiText' } }), textTurn('never sent')]);
    const { turn, events } = await send(adapter, 'oats', { signal: ctrl.signal, onEvent: (e) => e.type === 'card' && ctrl.abort() });
    expect(turn).toMatchObject({ stopped: true, streaming: false });
    expect(turn.cards).toHaveLength(1);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(ff.requests).toHaveLength(1);
  });

  it('retries on 429 after the provider gives up, showing rateLimited with retryInS', async () => {
    const busy: FakeReply = { status: 429, headers: { 'retry-after': '7' }, json: { error: { message: 'Rate limit reached', type: 'rate_limit' } } };
    const { adapter } = setup([busy, busy, busy, busy, textTurn('Here now.')]);
    const seen: string[] = [];
    adapter.subscribe(() => {
      const s = adapter.status();
      if (s.kind === 'rateLimited') seen.push(`${s.kind}:${s.retryInS}`);
    });
    const { turn } = await send(adapter, 'hello');
    expect(seen[0]).toBe('rateLimited:7');
    expect(turn.text).toBe('Here now.');
    expect(adapter.status().kind).toBe('ready');
  });

  it('maps a refused key to keyRefused', async () => {
    const { adapter } = setup([{ status: 401, json: { error: { message: 'bad key' } } }]);
    const { events, turn } = await send(adapter, 'hi');
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'keyRefused' });
    expect(turn.error?.message).toContain('refused by OpenRouter');
  });

  it('words provider failures plainly instead of showing the raw provider text', async () => {
    const cases: Array<[FakeReply, string]> = [
      [{ status: 404, json: { error: { message: "The model `x/y` does not exist", code: 'model_not_found', param: 'model' } } }, 'model'],
      [{ status: 400, json: { error: { message: "This model's maximum context length is 128000 tokens", code: 'context_length_exceeded' } } }, 'too long'],
      [{ status: 400, json: { error: { message: "Invalid 'messages[3].tool_call_id': unexpected value", type: 'invalid_request_error' } } }, 'could not handle'],
      [{ status: 500, json: { error: { message: 'upstream_error: internal' } } }, 'problem'],
    ];
    for (const [reply, words] of cases) {
      const { adapter } = setup([reply, reply, reply, reply]);
      const { turn } = await send(adapter, 'hi');
      expect(turn.error?.message).toContain(words);
      expect(turn.error?.message).not.toMatch(/messages\[|tool_call_id|context_length|upstream_error|`x\/y`/);
    }
  });

  it('summarises earlier days after 30 turns and sends summaries + recent turns only', async () => {
    const replies: Array<FakeReply | ((r: RecordedRequest) => FakeReply)> = [];
    for (let i = 0; i < 30; i++) replies.push(textTurn(`ok ${i}`));
    const summary = { days: [{ date: '2026-09-30', decisions: ['keep the window'], logged: ['lunch'], openQuestions: [], userPrefsLearned: ['likes dal'] }] };
    replies.push(textTurn(JSON.stringify(summary)));
    replies.push(textTurn('fresh segment'));
    const recorded: number[] = [];
    const { adapter, ff } = setup(replies, {}, { spend: { spentUsd: () => 0, record: () => void recorded.push(1) } });
    for (let i = 0; i < 30; i++) await send(adapter, `message ${i}`);
    const { turn } = await send(adapter, 'message 30');
    expect(turn.segment).toBe(1);
    // every model request is in the spend ledger, the summary call included
    expect(recorded).toHaveLength(ff.requests.length);
    expect(JSON.stringify(ff.requests[30]!.body)).toContain('day_summaries');
    const last = ff.requests[31]!.body as { messages: Array<{ role: string; content: unknown }> };
    expect(JSON.stringify(last.messages[0])).toContain('Summary of the earlier conversation');
    expect(JSON.stringify(last.messages[0])).toContain('likes dal');
    expect(last.messages.filter((m) => m.role === 'user')).toHaveLength(7);
  });
});

describe('standing briefing', () => {
  const heavy: BriefingData = {
    now: '2026-10-01T08:00:00.000Z',
    today: '2026-10-01',
    tz: 'Asia/Kolkata',
    safety: { modeLabel: 'Standard', mode: 'standard', plannerAccess: 'ok', maxFastHours: 24, restrictions: ['no fasts over 24 h'] },
    profile: { profile: { age: 41, heightCm: 176, sex: 'male', name: 'Secret Name', notes: 'x'.repeat(4000) }, estimate: { bodyFatPct: 24 }, complete: true },
    goals: { goals: Array.from({ length: 40 }, (_, i) => ({ metric: `metric${i}`, amount: i, text: 'y'.repeat(200) })) },
    recentLog: Array.from({ length: 400 }, (_, i) => ({ date: `2026-09-${String(24 + (i % 7)).padStart(2, '0')}`, kind: 'meal', text: 'z'.repeat(80) })),
    adherence: { days: Array.from({ length: 28 }, (_, i) => ({ date: i, score: 80, coverage: 1, detail: 'w'.repeat(100) })) },
    pending: Array.from({ length: 30 }, (_, i) => ({ pendingId: `p${i}`, commandId: 'plan.shift' })),
    questions: { questions: Array.from({ length: 20 }, (_, i) => ({ text: `Question ${i} ${'q'.repeat(300)}` })) },
    scores: { readiness: Array.from({ length: 100 }, () => ({ v: 1.234, band: 'normal' })) },
  };

  it('fits a heavy day into ≤ 3k tokens, keeps the rules and the disclaimer, never sends a name', () => {
    const b = buildBriefing(heavy, { provider: { name: 'Anthropic', model: 'Claude Sonnet 5.5' } });
    expect(b.tokens).toBeLessThanOrEqual(3000);
    expect(estimateTextTokens(b.text)).toBeLessThanOrEqual(3000);
    expect(b.text).toContain('not medical advice');
    expect(b.text).toContain('safety_blocked');
    expect(b.text).toContain('Safety: mode Standard');
    expect(b.text).not.toContain('Secret Name');
    expect(b.sections[0]!.id).toBe('static');
    expect(b.dropped.length + b.truncated.length).toBeGreaterThan(0);
    expect(b.visible.waiting).toBe(30);
    expect(b.visible.ask.length).toBeGreaterThan(0);
  });

  it('the visible "Last 7 days" carries the days before today that have logs or a score, newest first', () => {
    const d: BriefingData = {
      now: '2026-10-01T08:00:00.000Z',
      today: '2026-10-01',
      recentLog: [{ date: '2026-09-30', kind: 'meal' }, { date: '2026-09-30', kind: 'steps' }, { date: '2026-09-28', kind: 'weight' }, { date: '2026-09-24', kind: 'meal' }],
      adherence: { days: [{ date: '2026-09-29', score: 72 }, { date: '2026-10-01', score: 50 }] },
    };
    const week = buildBriefing(d, { addDays }).visible.week!;
    expect(week.map((w) => [w.date, w.entries.length, w.score?.score])).toEqual([
      ['2026-09-30', 2, null],
      ['2026-09-29', 0, 72],
      ['2026-09-28', 1, null],
    ]);
  });

  it('flags the planning-off safety mode (no plan-changing tools)', () => {
    const b = buildBriefing({ ...heavy, safety: { modeLabel: 'Hold', plannerAccess: 'blocked', maxFastHours: 0 } });
    expect(b.noPlanning).toBe(true);
    expect(b.text).toContain('cannot change the plan');
  });
});
