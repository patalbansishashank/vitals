/** E9b meal logging through the bus: log.meal thresholds and nutrient rules, log.mealFromPhoto with a fake recognizer, log.bulk. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAgentActivity, resetAgentActivityForTests } from '@/agents/activity';
import { guardedCall } from '@/agents/dispatcher';
import { createFoodTable } from '@/catalogues';
import type { FoodRecord } from '@/catalogues/types';
import { FOOD_FIXTURE } from '@/content/catalogues/foods.fixture';
import { createBusAgentDispatcher } from '@/commands/ai/agentDispatcher';
import { toolManifest } from '@/commands/manifest';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { installAiPorts, type PhotoRecognition } from '@/commands/aiPorts';
import type { LogEntry } from '@/living';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { mintWriteToken } from '@/store';
import { readMealIntake } from '@/lib/nutrientExposure';
import { carbFatScenario } from '@/engine/model/intake/energyBasis';
import { relogComponents, setFoodTable, wallInstants, type MealLogResult } from '..';
import { PLAN_ID, seedPlan } from './seed';

function out<T = MealLogResult>(r: CommandResult): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  if (!('output' in r)) throw new Error('no output');
  return r.output as T;
}
type Logged = Extract<MealLogResult, { status: 'logged' }>;
/** Today inside the seeded plan (2026-09-28, 28 days): an "as planned" slot needs a planned day, whatever the real date. */
function onPlanDay(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T06:30:00.000Z'));
}
const meals = () => getDocumentStore().peekAll<LogEntry>('dailyLogs').filter((d) => d.kind === 'meal') as unknown as Array<Extract<LogEntry, { kind: 'meal' }>>;

beforeEach(() => {
  freshState({ cleared: true });
  installAiPorts({});
  resetAgentActivityForTests();
});
afterEach(() => {
  vi.useRealTimers();
  installAiPorts({});
  setBlobStore(null);
});

describe('log.meal', () => {
  it('computes nutrients from grams × the food table and commits a confident meal', async () => {
    onPlanDay();
    await seedPlan();
    const r = out(await dispatch('log.meal', { slot: 'meal2', components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 150 }, { name: 'dal', localName: 'dal', foodId: 'lentils_cooked', grams: 150 }], method: 'typed' })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.needsConfirmation).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.totals.energyKcal.value).toBeCloseTo(195 + 174, 0);
    expect(r.totals.energyKcal.low).toBeLessThan(r.totals.energyKcal.value);
    expect(r.totals.energyKcal.high).toBeGreaterThan(r.totals.energyKcal.value);
    expect(r.undo).toEqual({ command: 'log.retract', input: { entryId: r.entryId } });
    await settleCommits();
    const [e] = meals();
    expect(e).toMatchObject({ kind: 'meal', slot: 'meal2', clockH: 14, planId: PLAN_ID, source: { by: 'user', method: 'typed' } });
    expect(e!.components[1]).toMatchObject({ foodId: 'lentils_cooked', nutrientSource: 'table' });
    expect(e!.totals.energyKcal.value).toBeCloseTo(369, 0);
    // undo info works
    expect((await dispatch('log.retract', { entryId: r.entryId })).ok).toBe(true);
  });

  it('logs a tick "as planned" from the slot\'s prescription when nothing is named', async () => {
    onPlanDay();
    await seedPlan();
    const r = out(await dispatch('log.meal', { slot: 'meal2', components: [], method: 'asPlanned' })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.totals.energyKcal.value).toBeGreaterThan(0);
    expect(r.totals.energyKcal.low).toBeLessThan(r.totals.energyKcal.value);
    await settleCommits();
    expect(meals()[0]).toMatchObject({ slot: 'meal2', clockH: 14, source: { method: 'asPlanned' } });
    const bad = await dispatch('log.meal', { slot: 'nope', components: [], method: 'asPlanned' });
    expect(bad.ok).toBe(false);
  });

  it('parses text when no components are given', async () => {
    const r = out(await dispatch('log.meal', { text: '2 eggs and 1 katori dal', components: [], method: 'typed', clockH: 9 })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.components.map((c) => c.foodId)).toEqual(['egg_whole_raw', 'lentils_cooked']);
    expect(r.totals.proteinG.value).toBeCloseTo(12.6 + 13.5, 0);
  });

  it('commits but asks for confirmation between 0.4 and 0.7', async () => {
    const r = out(await dispatch('log.meal', { components: [{ name: 'banana' }], method: 'typed', clockH: 16 })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.confidence).toBeGreaterThanOrEqual(0.4);
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.needsConfirmation).toBe(true);
    expect(r.lowConfidence.map((c) => c.foodId)).toEqual(['banana_raw']);
    await settleCommits();
    expect(meals()).toHaveLength(1);
  });

  it('asks instead of writing below 0.4 (or with an unknown food)', async () => {
    const a = out(await dispatch('log.meal', { components: [{ name: 'xyzzy pie', grams: 100 }], method: 'typed' }));
    expect(a.status).toBe('ask');
    expect((a as { question: string }).question).toMatch(/xyzzy pie/);
    const b = out(await dispatch('log.meal', { components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 100 }], method: 'aiText', confidence: 0.3 }));
    expect(b.status).toBe('ask');
    await settleCommits();
    expect(meals()).toHaveLength(0);
  });

  it('says "needs_choice, saved false" to an agent for an unknown food, and nothing is written (J3-02)', async () => {
    const dispatcher = createBusAgentDispatcher({ directApply: () => false });
    let n = 0;
    const call = (args: Record<string, unknown>) => guardedCall(dispatcher, toolManifest(), 'mcp', 'log_meal', args, { actor: { kind: 'mcp', id: 't' }, idempotencyKey: `k${n++}` });
    const a = await call({ components: [{ name: 'xyzzy pie', grams: 100 }], method: 'typed' });
    expect(a, JSON.stringify(a)).toMatchObject({ ok: true, status: 'needs_choice', saved: false });
    expect(a.summary).toMatch(/^Nothing logged yet\..*xyzzy pie/);
    expect(a.summary).toMatch(/call log_meal again/);
    expect(a.summary).not.toMatch(/done/);
    // the food table has nothing close: no candidates to pick from, and the activity shows it was not logged
    expect(a.candidates).toBeUndefined();
    expect(getAgentActivity()[0]).toMatchObject({ tool: 'log_meal', status: 'needs_choice' });
    await settleCommits();
    expect(meals()).toHaveLength(0);
    // a meal that is logged still says so, without the new fields
    const b = await call({ components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 150 }], method: 'typed' });
    expect(b).toMatchObject({ ok: true, status: 'applied', summary: 'Log a meal: done.' });
    expect(b).not.toHaveProperty('saved');
    expect(b).not.toHaveProperty('candidates');
    expect(getAgentActivity()[0]).toMatchObject({ tool: 'log_meal', status: 'applied' });
    await settleCommits();
    expect(meals()).toHaveLength(1);
  });

  it('offers the foods that nearly match, per component, for the agent to pick from (J3-02)', async () => {
    const base = FOOD_FIXTURE[0]!;
    const poha = (id: string, name: string): FoodRecord => ({ ...base, id, name, aliases: [] });
    setFoodTable(createFoodTable([poha('poha_thick', 'Poha, thick'), poha('poha_thin', 'Poha, thin'), ...FOOD_FIXTURE], 'test'));
    try {
      const dispatcher = createBusAgentDispatcher({ directApply: () => false });
      const a = await guardedCall(dispatcher, toolManifest(), 'mcp', 'log_meal', { components: [{ name: 'poha flakes', grams: 100 }], method: 'typed' }, { actor: { kind: 'mcp', id: 't' }, idempotencyKey: 'k-poha' });
      expect(a, JSON.stringify(a)).toMatchObject({ ok: true, status: 'needs_choice', saved: false });
      expect(a.candidates).toEqual([
        { component: 'poha flakes', foodId: 'poha_thick', name: 'Poha, thick' },
        { component: 'poha flakes', foodId: 'poha_thin', name: 'Poha, thin' },
      ]);
      expect(a.summary).toMatch(/^Nothing logged yet\./);
      expect(a.summary).toMatch(/Pick one of these foods .* call log_meal again/);
      // the command's own answer carries the same list, for callers that are not agents
      expect(a.data).toMatchObject({ status: 'ask', saved: false, candidates: a.candidates });
      await settleCommits();
      expect(meals()).toHaveLength(0);
      // picking one of them logs it
      const b = await guardedCall(dispatcher, toolManifest(), 'mcp', 'log_meal', { components: [{ name: 'poha flakes', foodId: 'poha_thin', grams: 100 }], method: 'typed' }, { actor: { kind: 'mcp', id: 't' }, idempotencyKey: 'k-poha-2' });
      expect(b).toMatchObject({ ok: true, status: 'applied' });
      await settleCommits();
      expect(meals().map((m) => m.components[0]!.foodId)).toEqual(['poha_thin']);
    } finally {
      setFoodTable(null);
    }
  });

  it('rejects nutrient numbers unless they come from a label', async () => {
    const bad = await dispatch('log.meal', { components: [{ name: 'rice', grams: 100, energyKcal: 500 }], method: 'typed' } as never);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error.code).toBe('invalid_input');
    // a label is valid with energy alone (D6-02: unknown macros stay unknown); without energy it needs every macro
    const noEnergy = await dispatch('log.meal', { components: [{ name: 'bar', grams: 60, labelPer100g: { proteinG: 20 } }], method: 'label' });
    expect(!noEnergy.ok && noEnergy.error.code).toBe('invalid_input');
    const negative = await dispatch('log.meal', { components: [{ name: 'bar', grams: 60, labelPer100g: { energyKcal: 380, proteinG: -1 } }], method: 'label' });
    expect(!negative.ok && negative.error.code).toBe('invalid_input');
    const partial = out(await dispatch('log.meal', { components: [{ name: 'bar', grams: 60, labelPer100g: { energyKcal: 380 } }], method: 'label', clockH: 10 })) as Logged;
    expect(partial.status).toBe('logged');
    expect(partial.totals.energyKcal.value).toBeCloseTo(228, 0);
    expect(partial.totals.unknown).toEqual(expect.arrayContaining(['proteinG', 'carbG', 'fatG', 'fibreG']));
    expect(partial.energy).toMatchObject({ reportedMEKcal: 228, reconciledMEKcal: 228, status: 'energyOnly' });
    const r = out(await dispatch('log.meal', { components: [{ name: 'protein bar', grams: 60, labelPer100g: { energyKcal: 380, proteinG: 33, fatG: 12, carbG: 35, fibreG: 5 }, carbBasis: 'totalByDifference' }], method: 'label', clockH: 11 })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.totals.energyKcal.value).toBeCloseTo(228, 0);
    expect(r.totals.carbG.value).toBeCloseTo(18, 0); // net
    expect(r.totals.energyKcal.high - r.totals.energyKcal.value).toBeLessThan(0.12 * 228);
    await settleCommits();
    expect(meals().map((m) => m.components[0]!.nutrientSource)).toEqual(['label', 'label']);
  });
});

describe('reported energy with unknown macros (D6-02)', () => {
  type Meal = Extract<LogEntry, { kind: 'meal' }>;
  const typed = (label: Record<string, number>, extra: Record<string, unknown> = {}) => dispatch('log.meal', { components: [{ name: 'dinner out', grams: 100, labelPer100g: label }], method: 'typed', clockH: 20, ...extra });

  it('600 kcal with 30 g protein stays 600 kcal: carbohydrate and fat stay unknown, nothing is closed by 4/4/9', async () => {
    const r = out(await typed({ energyKcal: 600, proteinG: 30 })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.totals.energyKcal.value).toBe(600);
    expect(r.totals.proteinG.value).toBe(30);
    expect(r.totals.unknown).toEqual(expect.arrayContaining(['carbG', 'fatG', 'fibreG']));
    expect(r.totals.unknown).not.toContain('energyKcal');
    expect(r.totals.unknown).not.toContain('proteinG');
    expect(r.energy).toMatchObject({ reportedMEKcal: 600, conventionMEKcal: null, reconciledMEKcal: 600, residualKcal: null, method: 'reported', status: 'energyOnly', boundary: 'reportedME' });
    expect(r.energy.macroMask).toEqual({ protein: 'known', carbohydrate: 'unknown', fat: 'unknown', fibre: 'unknown', ethanol: 'unknown' });
    await settleCommits();
    const [e] = meals() as Meal[];
    // the stored entry: reported energy, the known gram, unknown (not zero) carbohydrate/fat, the person's label as given
    expect(e!.energy?.reportedMEKcal).toBe(600);
    expect(e!.totals.unknown).toEqual(expect.arrayContaining(['carbG', 'fatG']));
    expect(e!.components[0]!.snapshot).toMatchObject({ source: 'user', per100g: { energyKcal: 600, proteinG: 30, carbG: null, fatG: null } });
    expect(e!.provenance).toBe('reported');
    const ex = Object.fromEntries((e!.exposures ?? []).map((x) => [x.id, x]));
    expect(ex.energy).toMatchObject({ value: 600, unit: 'kcal', coverage: 'complete', provenance: 'reported' });
    expect(ex.protein).toMatchObject({ value: 30, unit: 'g', coverage: 'complete' });
    expect(ex.carbAvailable).toMatchObject({ value: null, coverage: 'unknown' });
    expect(ex.fat).toMatchObject({ value: null, coverage: 'unknown' });
    expect(e!.nutrientCoverage).toMatchObject({ energy: 'complete', protein: 'complete', fat: 'unknown' });
    // what the realised history/compiler read: 600 kcal, protein 30 g, 480 kcal unallocated energy (no named substrate)
    const intake = readMealIntake(e!);
    expect(intake).toMatchObject({ energyKcal: 600, macros: { proteinG: 30 }, unexplainedKcal: 480, residualKind: 'unallocated', legacy: false });
    expect(intake.macros).not.toHaveProperty('carbG');
    expect(intake.macros).not.toHaveProperty('fatG');
    // a macro-dependent run needs a DECLARED scenario: q = 1 and q = 0 are conditional endpoints, energy and protein kept
    const spec = { clockH: 20, energyKcal: intake.energyKcal, macros: intake.macros };
    const all = carbFatScenario(spec, { kind: 'carbFatFamily', q: 1 }, { fibreKnownZero: true, alcoholKnownZero: true });
    const none = carbFatScenario(spec, { kind: 'carbFatFamily', q: 0 }, { fibreKnownZero: true, alcoholKnownZero: true });
    expect(all.status === 'allocated' && all.meal.macros).toEqual({ proteinG: 30, carbG: 120, fatG: 0 });
    expect(none.status === 'allocated' && none.meal.macros?.fatG).toBeCloseTo(53.3333, 4);
    expect(none.status === 'allocated' && none.meal.energyKcal).toBe(600);
    // without that declaration (unknown fibre/alcohol) the family does not close: no silent 50/50
    expect(carbFatScenario(spec, { kind: 'carbFatFamily', q: 0.5 }).status).toBe('notUnique');
  });

  it('a kcal-only entry keeps its energy and every macro unknown', async () => {
    const r = out(await typed({ energyKcal: 450 })) as Logged;
    expect(r.totals.energyKcal.value).toBe(450);
    expect(r.totals.unknown).toEqual(expect.arrayContaining(['proteinG', 'carbG', 'fatG', 'fibreG']));
    expect(r.energy).toMatchObject({ reportedMEKcal: 450, reconciledMEKcal: 450, status: 'energyOnly' });
    expect(Object.values(r.energy.macroMask).every((k) => k === 'unknown')).toBe(true);
    await settleCommits();
    const intake = readMealIntake(meals()[0]!);
    expect(intake.energyKcal).toBe(450);
    expect(intake.macros).toEqual({});
    expect(intake.unexplainedKcal).toBe(450);
  });

  it('known grams above the reported energy are a source conflict: both kept, nothing negative or rewritten', async () => {
    const r = out(await typed({ energyKcal: 100, proteinG: 100 })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.totals.energyKcal.value).toBe(100);
    expect(r.totals.proteinG.value).toBe(100);
    expect(r.energy.status).toBe('conflict');
    expect(r.energy.reportedMEKcal).toBe(100);
    await settleCommits();
    const intake = readMealIntake(meals()[0]!);
    expect(intake).toMatchObject({ energyKcal: 100, macros: { proteinG: 100 }, residualKind: 'conflict' });
    expect(carbFatScenario({ clockH: 20, energyKcal: 100, macros: { proteinG: 100, fibreG: 0, alcoholG: 0 } }, { kind: 'carbFatFamily', q: 1 }).status).toBe('conflict');
  });

  it('complete numbers: an inconsistent set is a conflict; a consistent label keeps its small residual', async () => {
    const bad = out(await dispatch('log.meal', { components: [{ name: 'dinner out', grams: 100, labelPer100g: { energyKcal: 600, proteinG: 30, carbG: 20, fatG: 10, fibreG: 0 }, carbBasis: 'available' }], method: 'typed', clockH: 20 })) as Logged;
    expect(bad.energy).toMatchObject({ reportedMEKcal: 600, conventionMEKcal: 290, residualKcal: 310, status: 'conflict' });
    const ok = out(await dispatch('log.meal', { components: [{ name: 'protein bar', grams: 60, labelPer100g: { energyKcal: 380, proteinG: 33, fatG: 12, carbG: 35, fibreG: 5 }, carbBasis: 'totalByDifference' }], method: 'label', clockH: 11 })) as Logged;
    expect(ok.energy.status).toBe('consistent');
    expect(ok.energy.reportedMEKcal).toBeCloseTo(228, 6);
    expect(ok.energy.conventionMEKcal).toBeCloseTo(0.6 * (4 * 33 + 4 * 30 + 9 * 12 + 2 * 5), 6);
    expect(ok.energy.residualKcal).toBeCloseTo(6, 6);
  });

  it('table foods: reported energy is the table energy; the specific-factor residual is source reconciliation, not missing substrate', async () => {
    const r = out(await dispatch('log.meal', { components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 150 }, { name: 'dal', foodId: 'lentils_cooked', grams: 150 }], method: 'typed', clockH: 13 })) as Logged;
    expect(r.energy.method).toBe('reported');
    expect(r.energy.reportedMEKcal).toBeCloseTo(r.totals.energyKcal.value, 0);
    expect(r.energy.status).toBe('consistent');
    expect(typeof r.energy.residualKcal).toBe('number');
    expect(r.totals.unknown).toBeUndefined();
    await settleCommits();
    const [e] = meals() as Meal[];
    expect(e!.components[0]!.snapshot).toMatchObject({ source: 'food', id: 'rice_white_cooked' });
    expect(typeof e!.components[0]!.snapshot!.version).toBe('string');
    const intake = readMealIntake(e!);
    expect(intake.residualKind === 'reconciliation' || intake.residualKind === 'none').toBe(true);
    expect(intake.macros.carbG).toBeGreaterThan(0);
  });
});

describe('food-derived ethanol and caffeine (C3/D5-01)', () => {
  type Meal = Extract<LogEntry, { kind: 'meal' }>;
  it('ethanol is counted once (inside energy, as grams) and caffeine joins the exposure ledger', async () => {
    const base = FOOD_FIXTURE[0]!;
    const beer: FoodRecord = { ...base, id: 'beer_lager', name: 'Beer, lager', aliases: [], per100g: { energyKcal: 43, proteinG: 0.5, fatG: 0, carbG: 3.6, fibreG: 0, alcoholG: 3.9 } };
    const coffee: FoodRecord = { ...base, id: 'coffee_brewed', name: 'Coffee, brewed', aliases: [], per100g: { energyKcal: 1, proteinG: 0.1, fatG: 0, carbG: 0, fibreG: 0, caffeineMg: 40 } };
    setFoodTable(createFoodTable([beer, coffee, ...FOOD_FIXTURE], 'test'));
    try {
      const r = out(await dispatch('log.meal', { components: [{ name: 'beer', foodId: 'beer_lager', grams: 500 }], method: 'typed', clockH: 21 })) as Logged;
      expect(r.totals.alcoholG?.value).toBeCloseTo(19.5, 6);
      expect(r.energy.macroMask.ethanol).toBe('known');
      expect(r.energy.conventionMEKcal).toBeCloseTo(4 * 2.5 + 4 * 18 + 7 * 19.5, 6);
      expect(r.energy.status).toBe('consistent');
      out(await dispatch('log.meal', { components: [{ name: 'coffee', foodId: 'coffee_brewed', grams: 250 }, { name: 'rice', foodId: 'rice_white_cooked', grams: 100 }], method: 'typed', clockH: 8 }));
      await settleCommits();
      const [b, c] = (meals() as Meal[]).sort((x, y) => y.clockH - x.clockH);
      expect(readMealIntake(b!).macros.alcoholG).toBeCloseTo(19.5, 6);
      expect((b!.exposures ?? []).find((x) => x.id === 'ethanol')).toMatchObject({ value: 19.5, coverage: 'complete' });
      // caffeine listed for the coffee, not analysed for the rice: a known lower bound, never a complete zero-or-sum
      expect((c!.exposures ?? []).find((x) => x.id === 'caffeine')).toMatchObject({ value: null, lowerBound: 100, unit: 'mg', coverage: 'partial' });
      // one caffeine exposure per meal (the snapshot aggregate is not counted a second time)
      expect((c!.exposures ?? []).filter((x) => x.id === 'caffeine')).toHaveLength(1);
      expect((b!.exposures ?? []).filter((x) => x.id === 'ethanol')).toHaveLength(1);
      expect(c!.components[0]!.uncertaintyGroupIds).toEqual(expect.arrayContaining([expect.stringMatching(/^portionMass:/), 'sourceComposition:food:coffee_brewed@test']));
    } finally {
      setFoodTable(null);
    }
  });
});

describe('meal occurrence time (C1/D5-01)', () => {
  type Meal = Extract<LogEntry, { kind: 'meal' }>;
  const rice = [{ name: 'rice', foodId: 'rice_white_cooked', grams: 150 }];

  it('a backdated meal without a clock stays date-only (the legacy clock is a placeholder, never an occurrence)', async () => {
    out(await dispatch('log.meal', { date: '2026-09-29', components: rice, method: 'typed' }));
    await settleCommits();
    const [e] = meals() as Meal[];
    expect(e!.occurrence).toMatchObject({ precision: 'dateOnly', date: '2026-09-29', dateMeaning: 'appDay' });
    expect(e!.occurrence!.at).toBeUndefined();
    expect(e!.recordedAt).toBe(e!.at);
    expect(e!.contract).toBe(1);
  });

  it('an explicit clock hour is an exact occurrence on that date; an explicit instant wins and gives the clock', async () => {
    out(await dispatch('log.meal', { date: '2026-09-29', clockH: 20, components: rice, method: 'typed' }));
    await settleCommits();
    const [a] = meals() as Meal[];
    expect(a!.occurrence!.precision).toBe('exact');
    expect(Date.parse(a!.occurrence!.at!)).toBe(wallInstants('2026-09-29', 20, a!.tz)[0]);
    const at = new Date(wallInstants('2026-09-30', 7.5, a!.tz)[0]!).toISOString();
    out(await dispatch('log.meal', { date: '2026-09-30', occurredAt: at, components: rice, method: 'typed' }));
    await settleCommits();
    const b = (meals() as Meal[]).find((m) => m.date === '2026-09-30')!;
    expect(b.occurrence).toMatchObject({ precision: 'exact', at });
    expect(b.clockH).toBeCloseTo(7.5, 6);
  });

  it('an "as planned" tick takes the plan clock as a placeholder, not as when the meal happened', async () => {
    onPlanDay();
    await seedPlan();
    out(await dispatch('log.meal', { slot: 'meal2', components: [], method: 'asPlanned' }));
    await settleCommits();
    const [e] = meals() as Meal[];
    expect(e!.clockH).toBe(14);
    expect(e!.occurrence!.precision).toBe('dateOnly');
    expect(e!.provenance).toBe('asPlanned');
    expect((e!.exposures ?? []).every((x) => x.coverage === 'asPlannedEstimate')).toBe(true);
  });
});

describe('log.mealFromPhoto', () => {
  const rec = (confidence: number): PhotoRecognition => ({
    saw: 'A plate of rice with dal and a glossy curry.',
    confidence,
    components: [
      { name: 'rice', localName: 'chawal', grams: 180, gramsLow: 140, gramsHigh: 220, confidence: 0.9 },
      { name: 'lentil curry', foodId: 'lentils_cooked', grams: 150, gramsLow: 110, gramsHigh: 190, visibleFatCue: 'glossy', confidence: 0.85 },
    ],
  });

  async function withPhoto(r: PhotoRecognition): Promise<{ seen: Array<{ attachmentId: string; size: number }> }> {
    const blobs = createMemoryBlobStore();
    await blobs.put(new Uint8Array([1, 2, 3, 4]), { purpose: 'photo', aadId: 'photo-1' });
    setBlobStore(blobs);
    const seen: Array<{ attachmentId: string; size: number }> = [];
    installAiPorts({ recognizePhoto: async (req) => (seen.push({ attachmentId: req.attachmentId, size: req.image.size }), r) });
    return { seen };
  }

  it('needs a vision-capable model', async () => {
    const r = await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1' });
    expect(!r.ok && r.error.code).toBe('precondition_failed');
    expect(!r.ok && r.error.message).toMatch(/vision-capable model/);
  });

  it('computes nutrients from grams with photo-only bands and returns "what I saw"', async () => {
    const { seen } = await withPhoto(rec(0.85));
    const r = out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1', clockH: 13 })) as Logged;
    expect(seen).toEqual([{ attachmentId: 'photo-1', size: 4 }]);
    expect(r.status).toBe('logged');
    expect(r.saw).toMatch(/rice with dal/);
    expect(r.components.map((c) => c.foodId)).toEqual(['rice_white_cooked', 'lentils_cooked']);
    expect(r.components[0]).toMatchObject({ grams: 180, gramsLow: 140, gramsHigh: 220 });
    const e = r.totals.energyKcal;
    expect(e.value).toBeCloseTo(1.8 * 130 + 1.5 * 116, 0);
    expect((e.value - e.low) / e.value).toBeGreaterThanOrEqual(0.35 - 1e-3);
    const p = r.totals.proteinG;
    expect((p.high - p.value) / p.value).toBeGreaterThanOrEqual(0.5 - 1e-3);
    const f = r.totals.fatG;
    expect((f.high - f.value) / f.value).toBeGreaterThanOrEqual(0.5);
    await settleCommits();
    const [m] = meals();
    expect(m).toMatchObject({ attachmentIds: ['photo-1'], source: { method: 'aiPhoto' }, clockH: 13 });
    expect(m!.id ?? r.entryId).toBeTruthy();
  });

  it("a photo's capture time is a device occurrence (the upload time never is); a partial label keeps unknown macros", async () => {
    const capturedAt = '2026-10-01T07:15:00.000Z';
    await withPhoto({ ...rec(0.85), capturedAt });
    out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1' }));
    await settleCommits();
    const [m] = meals();
    expect(m!.occurrence).toMatchObject({ precision: 'exact', at: capturedAt, source: 'device' });
    expect(m!.components.every((c) => c.amountMethod === 'photoEstimated')).toBe(true);
    await withPhoto({ saw: 'A snack bar with its label.', confidence: 0.9, components: [{ name: 'snack bar', grams: 40, gramsLow: 40, gramsHigh: 40, confidence: 0.9 }], labelPer100g: { energyKcal: 450, proteinG: 10 } });
    const r = out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1', clockH: 16 })) as Logged;
    expect(r.totals.energyKcal.value).toBeCloseTo(180, 6);
    expect(r.totals.proteinG.value).toBeCloseTo(4, 6);
    expect(r.totals.unknown).toEqual(expect.arrayContaining(['carbG', 'fatG']));
    expect(r.energy.status).toBe('energyOnly');
  });

  it('a photographed label without a stated carbohydrate basis is imported as unknown basis: energy kept, available carbohydrate unresolved (D6-01)', async () => {
    await withPhoto({ saw: 'A cereal bar label.', confidence: 0.9, components: [{ name: 'cereal bar', grams: 40, gramsLow: 40, gramsHigh: 40, confidence: 0.9 }], labelPer100g: { energyKcal: 400, proteinG: 8, fatG: 12, carbG: 60, fibreG: 6 } });
    const r = out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1', clockH: 16 })) as Logged;
    expect(r.totals.energyKcal.value).toBeCloseTo(160, 6);
    expect(r.totals.unknown).toContain('carbG');
    await settleCommits();
    const m = meals().find((x) => x.components[0]!.name === 'cereal bar')!;
    expect(m.components[0]!.carbBasis).toBe('unknown');
    expect(m.components[0]!.snapshot!.per100g.carbG).toBe(60); // the printed value is kept as printed
    expect(m.exposures!.find((x) => x.id === 'carbAvailable')).toMatchObject({ value: null, upperBound: 24 });
    // a stated basis is used as stated
    await withPhoto({ saw: 'A cereal bar label.', confidence: 0.9, components: [{ name: 'cereal bar 2', grams: 40, gramsLow: 40, gramsHigh: 40, confidence: 0.9 }], labelPer100g: { energyKcal: 400, proteinG: 8, fatG: 12, carbG: 60, fibreG: 6 }, labelCarbBasis: 'totalByDifference' });
    const r2 = out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1', clockH: 17 })) as Logged;
    expect(r2.totals.carbG.value).toBeCloseTo(0.4 * 54, 6);
  });

  it('photo grams stay photo-estimated; foods the model could not tell apart form an identity-ambiguity group (D6-06)', async () => {
    await withPhoto({ saw: 'A bowl of chickpeas.', confidence: 0.9, components: [{ name: 'chickpeas', foodId: 'chickpeas_cooked', grams: 150, gramsLow: 120, gramsHigh: 180, confidence: 0.9, alternatives: ['chickpeas_cooked', 'lentils_cooked'] }] });
    out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1', clockH: 13 }));
    await settleCommits();
    const [m] = meals();
    expect(m!.components[0]!.amountMethod).toBe('photoEstimated');
    const groups = m!.components[0]!.uncertaintyGroupIds!;
    expect(groups.some((g) => g.startsWith('identityAmbiguity:') && g.endsWith('chickpeas_cooked|lentils_cooked'))).toBe(true);
    expect(groups).toContain('reportingBias:person:photoEstimated');
  });

  it('asks below 0.4 and flags 0.4–0.7 for confirmation', async () => {
    await withPhoto(rec(0.3));
    const a = out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1' }));
    expect(a.status).toBe('ask');
    expect(a.saw).toMatch(/plate/);
    await settleCommits();
    expect(meals()).toHaveLength(0);
    await withPhoto(rec(0.55));
    const b = out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1' })) as Logged;
    expect(b.status).toBe('logged');
    expect(b.needsConfirmation).toBe(true);
  });

  it('a photo that needs a choice tells the agent to call log_meal with the components, not the photo tool again (J3-02)', async () => {
    await withPhoto(rec(0.3));
    const dispatcher = createBusAgentDispatcher({ directApply: () => false });
    const a = await guardedCall(dispatcher, toolManifest(), 'webmcp', 'log_meal_from_photo', { attachmentId: 'photo-1' }, { actor: { kind: 'webmcp', id: 'webmcp' }, idempotencyKey: 'k-photo' });
    expect(a, JSON.stringify(a)).toMatchObject({ ok: true, status: 'needs_choice', saved: false });
    expect(a.summary).toMatch(/call log_meal with the components/);
    expect(a.summary).not.toMatch(/log_meal_from_photo/);
    await settleCommits();
    expect(meals()).toHaveLength(0);
  });

  it('reports a missing photo', async () => {
    setBlobStore(createMemoryBlobStore());
    installAiPorts({ recognizePhoto: async () => rec(0.9) });
    const r = await dispatch('log.mealFromPhoto', { attachmentId: 'missing' });
    expect(!r.ok && r.error.code).toBe('not_found');
  });
});

describe('log.bulk', () => {
  it('writes each entry separately and returns one result per entry', async () => {
    const r = out<Array<{ date: string; index: number; status: string; entryId?: string }>>(
      await dispatch('log.bulk', {
        days: [
          { date: '2026-09-29', entries: [{ text: '2 eggs and 150 g rice', clockH: 9 }, { kind: 'session', status: 'done', performed: [] }] },
          { date: '2026-09-30', entries: [{ kind: 'meal', components: [{ name: 'dal', foodId: 'lentils_cooked', grams: 200 }], clockH: 13 }, { components: [{ name: 'xyzzy', grams: 50 }] }, { kind: 'steps', steps: 9000 }] },
        ],
      }),
    );
    expect(r.map((x) => [x.date, x.index, x.status])).toEqual([
      ['2026-09-29', 0, 'logged'],
      ['2026-09-29', 1, 'skipped'],
      ['2026-09-30', 0, 'logged'],
      ['2026-09-30', 1, 'ask'],
      ['2026-09-30', 2, 'logged'],
    ]);
    const ids = r.filter((x) => x.entryId).map((x) => x.entryId);
    expect(new Set(ids).size).toBe(3);
    await settleCommits();
    const m = meals();
    expect(m.map((x) => x.date).sort()).toEqual(['2026-09-29', '2026-09-30']);
    expect(m.every((x) => x.source.method === 'backfill')).toBe(true);
    // each entry is undoable on its own
    expect((await dispatch('log.retract', { entryId: ids[0]! })).ok).toBe(true);
  });

  it('tells an agent how many entries were logged: none → needs_choice and saved false; some → counts; all → done (J3-02)', async () => {
    // direct apply on (the person let this client apply plan edits): the call runs and answers per entry
    const dispatcher = createBusAgentDispatcher({ directApply: () => true });
    let n = 0;
    const call = (args: Record<string, unknown>) => dispatcher.call('log.bulk', args, { actor: { kind: 'webmcp', id: 'webmcp' }, idempotencyKey: `bulk-${n++}`, stage: false });
    const dal = { kind: 'meal', components: [{ name: 'dal', foodId: 'lentils_cooked', grams: 200 }], clockH: 13 };
    const none = await call({ days: [{ date: '2026-09-30', entries: [{ components: [{ name: 'xyzzy pie', grams: 50 }] }, { components: [{ name: 'plugh stew', grams: 50 }] }] }] });
    expect(none, JSON.stringify(none)).toMatchObject({ ok: true, status: 'needs_choice', saved: false });
    expect(none.summary).toMatch(/^0 of 2 logged; 2 need a food choice: "xyzzy pie", "plugh stew"\./);
    expect(none.summary).toMatch(/Nothing was saved for those entries\..* call log_bulk again with only those entries/);
    expect(none.summary).not.toMatch(/done/);
    await settleCommits();
    expect(meals()).toHaveLength(0);

    const some = await call({ days: [{ date: '2026-09-30', entries: [dal, { components: [{ name: 'xyzzy pie', grams: 50 }] }, { kind: 'steps', steps: 9000 }, { kind: 'session', status: 'done', performed: [] }] }] });
    expect(some, JSON.stringify(some)).toMatchObject({ ok: true, status: 'applied' });
    expect(some.summary).toMatch(/^2 of 4 logged; 1 needs a food choice: "xyzzy pie"; 1 skipped\./);
    expect(some.summary).not.toMatch(/done/);
    expect(some).not.toHaveProperty('saved');
    await settleCommits();
    expect(meals()).toHaveLength(1);

    const all = await call({ days: [{ date: '2026-10-01', entries: [dal, { kind: 'steps', steps: 1000 }] }] });
    expect(all).toMatchObject({ ok: true, status: 'applied', summary: 'Log several days: done.' });
    await settleCommits();
    expect(meals()).toHaveLength(2);
  });
});

describe('label carbohydrate basis and extra label fields (D6-01, D6-03)', () => {
  const carbOf = async (labelPer100g: Record<string, number>, carbBasis?: string) => {
    const r = out(await dispatch('log.meal', { date: '2026-10-01', method: 'label', components: [{ name: 'bar', grams: 100, labelPer100g, ...(carbBasis ? { carbBasis } : {}) }] })) as Logged;
    await settleCommits();
    return { r, e: meals().find((m) => (m as unknown as { _id: string })._id === r.entryId)! };
  };

  it('an inclusive 30 g C / 10 g fibre label and an available 20 g C / 10 g fibre label both log 20 g available', async () => {
    const us = await carbOf({ energyKcal: 200, proteinG: 10, fatG: 5, carbG: 30, fibreG: 10 }, 'totalByDifference');
    const eu = await carbOf({ energyKcal: 200, proteinG: 10, fatG: 5, carbG: 20, fibreG: 10 }, 'available');
    expect(us.r.totals.carbG.value).toBeCloseTo(20, 6);
    expect(eu.r.totals.carbG.value).toBeCloseTo(20, 6); // never fibre-subtracted twice
    expect(us.e.components[0]!.snapshot!.per100g.carbG).toBe(30); // the printed value is kept
  });

  it('an unknown basis keeps the energy and the printed carbohydrate; available carbohydrate stays unknown, bounded by it', async () => {
    const { r, e } = await carbOf({ energyKcal: 200, proteinG: 10, fatG: 5, carbG: 30, fibreG: 10 }, 'unknown');
    expect(r.totals.energyKcal.value).toBeCloseTo(200, 6);
    expect(r.totals.unknown).toContain('carbG');
    expect(e.exposures!.find((x) => x.id === 'carbAvailable')).toMatchObject({ value: null, upperBound: 30 });
    expect(e.exposures!.find((x) => x.id === 'carbReported')).toMatchObject({ value: 30, coverage: 'complete' });
  });

  it('a total-by-difference label without fibre leaves available carbohydrate unknown; an explicit 0 resolves it', async () => {
    const missing = await carbOf({ energyKcal: 200, proteinG: 10, fatG: 5, carbG: 30 }, 'totalByDifference');
    const zero = await carbOf({ energyKcal: 200, proteinG: 10, fatG: 5, carbG: 30, fibreG: 0 }, 'totalByDifference');
    expect(missing.r.totals.unknown).toContain('carbG');
    expect(zero.r.totals.carbG.value).toBeCloseTo(30, 6);
  });

  it('"same as yesterday" of an available-basis label does not subtract fibre a second time', async () => {
    const { e } = await carbOf({ energyKcal: 200, proteinG: 10, fatG: 5, carbG: 20, fibreG: 10 }, 'available');
    const again = out(await dispatch('log.meal', { date: '2026-10-02', method: 'typed', components: relogComponents(e) })) as Logged;
    expect(again.totals.carbG.value).toBeCloseTo(20, 6);
    expect(again.totals.energyKcal.value).toBeCloseTo(200, 6);
  });

  it('a stated carbohydrate mixture is kept on the entry (the rest stays unknown, never glucose; D6-07)', async () => {
    await dispatch('log.bulk', { days: [{ date: '2026-10-01', entries: [{ kind: 'meal', components: [{ name: 'sports drink', grams: 500, labelPer100g: { energyKcal: 24, proteinG: 0, fatG: 0, carbG: 6 }, carbBasis: 'available' }], carbComposition: { glucoseEqG: 20, fructoseG: 10 }, form: 'liquid', intakeDurationH: 1 }] }] });
    await settleCommits();
    const m = meals().find((x) => x.components[0]!.name === 'sports drink')!;
    expect(m).toMatchObject({ carbComposition: { glucoseEqG: 20, fructoseG: 10 }, form: 'liquid', intakeDurationH: 1 });
  });

  it('printed sugars, polyols and sodium travel with the entry; identified polyols are never subtracted by a factor', async () => {
    const { r, e } = await carbOf({ energyKcal: 240, proteinG: 0, fatG: 0, carbG: 95, fibreG: 0, polyolsG: 60, sugarsG: 2, sodiumMg: 50 }, 'totalByDifference');
    expect(r.totals.energyKcal.value).toBeCloseTo(240, 6); // the label energy is kept
    expect(r.totals.carbG.value).toBeCloseTo(35, 6); // polyol mass is not available (glucose-forming) carbohydrate
    expect(r.energy.status).toBe('consistent'); // the polyol energy is reconciliation within 0–4 kcal/g, not a conflict
    expect(readMealIntake(e).residualKind).toBe('reconciliation'); // it appears as energy only, never as glucose
    expect(e.exposures!.find((x) => x.id === 'polyols')).toMatchObject({ value: 60, unit: 'g' });
    expect(e.exposures!.find((x) => x.id === 'sodium')).toMatchObject({ value: 50, coverage: 'complete' });
    expect(e.totals.sugarsG?.value).toBeCloseTo(2, 6);
  });
});

describe('a new label without a carbohydrate basis has an unknown basis; stored entries keep theirs (A1-024)', () => {
  type Meal = Extract<LogEntry, { kind: 'meal' }>;
  const LABEL = { energyKcal: 140, proteinG: 10, carbG: 20, fatG: 0, fibreG: 10 };
  const logLabel = async (extra: Record<string, unknown> = {}, method = 'label') => {
    const r = out(await dispatch('log.meal', { date: '2026-10-01', method, components: [{ name: 'bar', grams: 100, labelPer100g: LABEL, ...extra }] })) as Logged;
    await settleCommits();
    return { r, e: meals().find((m) => (m as unknown as { _id: string })._id === r.entryId)! };
  };

  it('keeps 140 kcal and the printed 20 g; available carbohydrate is unknown and the energy is energy-only, never a conflict', async () => {
    for (const method of ['label', 'typed', 'aiText']) {
      const { r, e } = await logLabel({}, method);
      expect(r.totals.energyKcal.value).toBeCloseTo(140, 9);
      expect(r.totals.unknown).toContain('carbG');
      expect(r.energy.status).toBe('energyOnly');
      expect(e.components[0]!.carbBasis).toBe('unknown'); // the default is stored, so the entry declares how it was read
      expect(e.components[0]!.snapshot!.per100g).toMatchObject({ carbG: 20, fibreG: 10 });
      expect(e.exposures!.find((x) => x.id === 'carbReported')).toMatchObject({ value: 20, coverage: 'complete' });
      expect(e.exposures!.find((x) => x.id === 'carbAvailable')).toMatchObject({ value: null, upperBound: 20 });
    }
  });

  it('an explicit available basis gives 20 g; an explicit total-by-difference with 10 g fibre gives 10 g', async () => {
    expect((await logLabel({ carbBasis: 'available' })).r.totals.carbG.value).toBeCloseTo(20, 9);
    expect((await logLabel({ carbBasis: 'totalByDifference' })).r.totals.carbG.value).toBeCloseTo(10, 9);
    // relogging a new unknown-basis entry keeps it unknown (no subtraction appears on the second log)
    const { e } = await logLabel();
    const again = out(await dispatch('log.meal', { date: '2026-10-02', method: 'typed', components: relogComponents(e) })) as Logged;
    expect(again.totals.unknown).toContain('carbG');
    expect(again.energy.status).toBe('energyOnly');
  });

  async function seedStored(e: Omit<Meal, 'id'> & { _id: string }): Promise<Meal> {
    const store = getDocumentStore();
    await store.ready;
    await store.transact(mintWriteToken('migration', { label: 'stored label entry' }), async (tx) => {
      await tx.append('dailyLogs', e);
    });
    await settleCommits();
    return meals().find((m) => (m as unknown as { _id: string })._id === e._id)!;
  }
  const est = (v: number) => ({ value: v, sd: 0 });

  it('a stored label entry from before the unknown default keeps its legacy reading across reload and relog', async () => {
    // logged by the earlier W1 path: label snapshot, no carbBasis, available carbohydrate 20 − 10 = 10 g (legacy arithmetic)
    const n = { energyKcal: est(140), proteinG: est(10), carbG: est(10), fatG: est(0), fibreG: est(10) };
    const stored = await seedStored({
      _id: '01JQ0000000000000000000A01', date: '2026-09-30', tz: 'UTC', at: '2026-09-30T08:00:00.000Z', source: { by: 'user', method: 'label' }, kind: 'meal', clockH: 8,
      components: [{ name: 'bar', grams: est(100), nutrients: n, nutrientSource: 'label', snapshot: { source: 'label', per100g: { ...LABEL, satFatG: null } } }], totals: n,
    } as Omit<Meal, 'id'> & { _id: string });
    const before = readMealIntake(stored);
    expect(before.macros.carbG).toBe(10);
    // reload: the same entry reads the same
    expect(readMealIntake(JSON.parse(JSON.stringify(stored)) as Meal)).toEqual(before);
    const comps = relogComponents(stored);
    expect(comps[0]!.fromSnapshot).toMatchObject({ source: 'label', carbBasis: 'legacyTotalByDifference' });
    const again = out(await dispatch('log.meal', { date: '2026-10-01', method: 'typed', components: comps })) as Logged;
    expect(again.totals.carbG.value).toBeCloseTo(10, 9);
    expect(again.totals.energyKcal.value).toBeCloseTo(140, 9);
    await settleCommits();
    const relogged = meals().find((m) => (m as unknown as { _id: string })._id === again.entryId)!;
    expect(relogged.components[0]!.carbBasis).toBe('legacyTotalByDifference');
    expect(relogged.components[0]!.snapshot!.per100g).toMatchObject({ carbG: 20, fibreG: 10 }); // the printed values unchanged
    // and once more: the legacy reading is stable, never silently reinterpreted
    const third = out(await dispatch('log.meal', { date: '2026-10-02', method: 'typed', components: relogComponents(relogged) })) as Logged;
    expect(third.totals.carbG.value).toBeCloseTo(10, 9);
    // the stored original is never rewritten
    expect(meals().find((m) => (m as unknown as { _id: string })._id === '01JQ0000000000000000000A01')!.components[0]).not.toHaveProperty('carbBasis');
  });

  it('a pre-W1 entry without a snapshot relogs its stored available carbohydrate as stated', async () => {
    const n = { energyKcal: est(140), proteinG: est(10), carbG: est(10), fatG: est(0), fibreG: est(10) };
    const stored = await seedStored({
      _id: '01JQ0000000000000000000A02', date: '2026-09-30', tz: 'UTC', at: '2026-09-30T08:00:00.000Z', source: { by: 'user', method: 'label' }, kind: 'meal', clockH: 8,
      components: [{ name: 'bar', grams: est(100), nutrients: n, nutrientSource: 'label' }], totals: n,
    } as Omit<Meal, 'id'> & { _id: string });
    const again = out(await dispatch('log.meal', { date: '2026-10-01', method: 'typed', components: relogComponents(stored) })) as Logged;
    expect(again.totals.carbG.value).toBeCloseTo(10, 9);
  });
});
