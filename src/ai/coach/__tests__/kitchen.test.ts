/**
 * Kitchen and pantry in the Coach (SUITE_SPEC §13.3) over the real command bus: the Coach's "I have X at home" writes
 * the same pantry document the picker writes (convergence), "I also have a soda maker" reaches the kitchen, the
 * briefing carries the kitchen block, and the recipe request carries equipment and pantry.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { allCommands, buildManifest, dispatch, getCommand, on, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { addDays } from '@/living/dates';
import { createChatModel, getPreset, presetCapabilities } from '../../providers';
import { fakeFetch, instantSleep, sse, type FakeReply } from '../../testing/fakeFetch';
import { createCoachAdapter } from '../adapter';
import { buildBriefing, gatherBriefingData } from '../briefing';
import { createAiRecipeProvider, SYSTEM, type DispatchFn, type MealSlotTarget } from '../recipes';
import type { CoachBus } from '../tools';

const bus: CoachBus = {
  dispatch: (id, input, opts) => dispatch(id, input, opts),
  manifest: () => buildManifest('ai'),
  getCommand: (id) => getCommand(id),
  commandIds: () => allCommands().map((d) => d.id),
  on: (l) => on(l),
};

type Call = { id: string; name: string; args: unknown };
const toolTurn = (...calls: Call[]): FakeReply => ({
  text: sse(
    { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: calls.map((c, i) => ({ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    'data: [DONE]\n\n',
  ),
});
const textTurn = (t: string): FakeReply => ({ text: sse({ choices: [{ index: 0, delta: { content: t }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } }, 'data: [DONE]\n\n') });

function coach(replies: FakeReply[]) {
  const ff = fakeFetch(replies);
  const preset = getPreset('openrouter')!;
  const model = createChatModel({ preset, model: 'anthropic/claude-sonnet-5.5', apiKey: 'test-key', capabilities: { ...presetCapabilities(preset), tools: true, parallelTools: true, vision: false }, deps: { fetch: ff.fetch, sleep: instantSleep().sleep, random: () => 0 } });
  let n = 0;
  const adapter = createCoachAdapter({ bus, model, provider: { name: 'OpenRouter', model: 'Claude Sonnet 5.5' }, now: () => new Date(), newId: () => `n${++n}`, sleep: async () => undefined });
  return { adapter, ff, model };
}

async function say(adapter: ReturnType<typeof coach>['adapter'], text: string) {
  await adapter.send({ conversationId: 'coach', text }, () => undefined, new AbortController().signal);
  await settleCommits();
  return adapter.history('coach').at(-1)!;
}

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
}
type PantryOut = { items: Array<{ id: string; label: string; source: string; qtyApprox?: string; lastConfirmedAt?: string }> };

beforeEach(() => {
  freshState({ cleared: true });
});

describe('Coach ⇄ pantry convergence', () => {
  it('"I have bhindi and paneer at home" lands in the same list the picker writes, one entry per item', async () => {
    out(await dispatch('pantry.add', { items: [{ id: 'pa.okra', label: 'Okra' }], replace: true })); // the picker
    await settleCommits();
    const { adapter } = coach([toolTurn({ id: 'c1', name: 'pantry_add', args: { items: [{ label: 'bhindi' }, { label: 'paneer', qtyApprox: '200 g' }] } }), textTurn('Noted: okra and paneer.')]);
    const turn = await say(adapter, 'right now I have bhindi and 200 g paneer at home');
    expect(turn.text).toBe('Noted: okra and paneer.');
    const coachView = out<PantryOut>(await dispatch('pantry.get', {}));
    expect(coachView.items.map((i) => [i.id, i.source])).toEqual([
      ['pa.okra', 'picker'],
      ['pa.paneer', 'coach'],
    ]);
    expect(coachView.items[0]!.lastConfirmedAt).toBeDefined();
    expect(coachView.items[1]!.qtyApprox).toBe('200 g');
    // the picker opens on the same list and saving it unchanged changes nothing
    const picker = out<PantryOut>(await dispatch('pantry.add', { items: coachView.items.map((i) => ({ id: i.id, label: i.label })), replace: true }));
    expect(picker.items).toEqual(coachView.items);
  });

  it('a pasted list goes through parse then add (source paste), and the Coach can do the same with the tools', async () => {
    const { adapter } = coach([
      toolTurn({ id: 'p1', name: 'pantry_parse_list', args: { text: 'pyaz 2kg\ntamatar\nmystery sauce' } }),
      toolTurn({ id: 'p2', name: 'pantry_add', args: { items: [{ label: 'pyaz', id: 'pa.onion_red', qtyApprox: '2kg' }, { label: 'tamatar' }, { label: 'mystery sauce' }] } }),
      textTurn('Added 3 things.'),
    ]);
    await say(adapter, 'pyaz 2kg, tamatar, mystery sauce');
    const v = out<PantryOut>(await dispatch('pantry.get', {}));
    expect(v.items.map((i) => i.id)).toEqual(['pa.onion_red', expect.stringMatching(/tomato/), 'custom:mystery-sauce']);
    expect(v.items.every((i) => i.source === 'coach')).toBe(true);
  });

  it('"I also have a soda maker and an egg boiler" reaches the kitchen through kitchen_add', async () => {
    const { adapter } = coach([toolTurn({ id: 'k1', name: 'kitchen_add', args: { items: [{ label: 'soda maker' }, { label: 'egg boiler' }] } }), textTurn('Added.')]);
    await say(adapter, 'I also have a soda maker and an egg boiler');
    const k = out<{ equipment: Array<{ id: string; source: string }> }>(await dispatch('kitchen.get', {}));
    expect(k.equipment).toEqual([expect.objectContaining({ id: 'eq.soda_maker', source: 'coach' }), expect.objectContaining({ id: 'eq.egg_boiler', source: 'coach' })]);
  });
});

describe('briefing', () => {
  it('carries the kitchen block from kitchen.get / pantry.get and the rule for recording what is at home', async () => {
    out(await dispatch('kitchen.set', { equipment: [{ id: 'eq.otg', note: 'small, 28 L' }, { id: 'eq.soda_maker', use: 'ownNotUsed' }], cuisines: [{ id: 'cu.punjabi' }] }));
    await settleCommits();
    out(await dispatch('pantry.add', { items: [{ label: 'okra' }] }));
    await settleCommits();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const data = await gatherBriefingData(bus, now, today, addDays);
    const b = buildBriefing(data, { addDays });
    expect(b.text).toContain('OTG oven (eq.otg; small, 28 L)');
    expect(b.text).toContain('(eq.soda_maker; not used)');
    expect(b.text).toContain('Cuisines, most often first: Punjabi');
    expect(b.text).toContain('In the kitchen now: Okra');
    expect(b.text).toContain('pantry_add');
    expect(b.visible.about).toContain('Kitchen: 2 pieces of equipment, 1 item at home.');
  });

  it('says the kitchen is not told yet when nothing is known', () => {
    const b = buildBriefing({ now: '2026-10-02T08:00:00.000Z', today: '2026-10-02' });
    expect(b.text).toContain('Kitchen: not told yet');
  });
});

describe('recipe request', () => {
  const slots: MealSlotTarget[] = [{ slot: 'breakfast', name: 'Breakfast', clockH: 8, energyKcal: 450, proteinG: 30, carbG: 45, fatG: 15 }];
  const CANDS = [{ id: 'egg_whole_raw', name: 'Egg', tags: [], portions: [{ label: '1 large egg', g: 50 }] }];
  const fit = { ok: true, output: { status: 'fits', meals: [{ slot: 'breakfast', items: [{ foodId: 'egg_whole_raw', grams: 150 }] }], deviations: [], repairHints: [] } };

  it('carries equipment (with notes and not-used) and the pantry read from the documents; the recipe lists its equipment', async () => {
    out(await dispatch('kitchen.set', { equipment: [{ id: 'eq.egg_boiler' }, { id: 'eq.soda_maker', use: 'ownNotUsed' }, { id: 'eq.otg', note: 'small, 28 L' }], cuisines: [{ id: 'cu.punjabi' }], staples: [{ id: 'st.atta' }] }));
    await settleCommits();
    out(await dispatch('pantry.add', { items: [{ label: 'okra' }, { label: 'paneer', qtyApprox: '200 g' }] }));
    await settleCommits();
    // real kitchen/pantry reads, scripted food commands
    const d: DispatchFn = async (id, input) => {
      if (id === 'food.candidates') return { ok: true, output: CANDS };
      if (id === 'food.planDay') return fit as never;
      return (await dispatch(id, input)) as never;
    };
    const ff = fakeFetch([textTurn(JSON.stringify({ meals: [{ slot: 'breakfast', dish: 'Boiled eggs', cuisine: 'Punjabi', ingredients: [{ foodId: 'egg_whole_raw', grams: 150 }], steps: ['Boil in the egg boiler.'], activeMin: 2, equipment: ['Electric egg boiler'] }] }))]);
    const preset = getPreset('openrouter')!;
    const model = createChatModel({ preset, model: 'anthropic/claude-sonnet-5.5', apiKey: 'test-key', capabilities: { ...presetCapabilities(preset), jsonSchema: true }, deps: { fetch: ff.fetch, sleep: instantSleep().sleep } });
    const res = await createAiRecipeProvider({ model, dispatch: d, kitchen: { timeBudgetMin: 15 } }).planDay({ date: '2026-10-02', slots });
    const sent = JSON.stringify(ff.requests[0]!.body);
    expect(sent).toContain('Electric egg boiler');
    expect(sent).toContain('owned, not used now');
    expect(sent).toContain('small, 28 L');
    expect(sent).toContain('Okra');
    expect(sent).toContain('Paneer (200 g)');
    expect(sent).toContain('preferPantry');
    expect(sent).toContain('timeBudgetMin');
    const r = res.breakfast!;
    if ('error' in r) throw new Error(r.error);
    expect(r.equipment).toEqual(['Electric egg boiler']);
  });

  it('the system prompt makes equipment and pantry explicit', () => {
    expect(SYSTEM).toContain('KITCHEN.equipment');
    expect(SYSTEM).toContain('egg boiler, soda maker');
    expect(SYSTEM).toContain('KITCHEN.pantry');
  });

  it('works when the kitchen cannot be read (no documents, failing reads)', async () => {
    const d: DispatchFn = async (id) => (id === 'food.candidates' ? { ok: true, output: CANDS } : id === 'food.planDay' ? (fit as never) : { ok: false, error: { message: 'nope' } });
    const ff = fakeFetch([textTurn(JSON.stringify({ meals: [{ slot: 'breakfast', dish: 'Eggs', ingredients: [{ foodId: 'egg_whole_raw', grams: 150 }], steps: ['Cook.'] }] }))]);
    const preset = getPreset('openrouter')!;
    const model = createChatModel({ preset, model: 'm', apiKey: 'k', capabilities: { ...presetCapabilities(preset), jsonSchema: true }, deps: { fetch: ff.fetch, sleep: instantSleep().sleep } });
    const res = await createAiRecipeProvider({ model, dispatch: d }).planDay({ date: '2026-10-02', slots, pantry: ['eggs'] });
    expect('error' in res.breakfast!).toBe(false);
    expect(JSON.stringify(ff.requests[0]!.body)).toContain('"preferPantry\\":true');
  });
});
