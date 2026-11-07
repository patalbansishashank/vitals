/**
 * Phase 0C joint verification of the meal energy provider (D6-02, C1-C3/C7) with its consumers: a 600 kcal / 30 g protein
 * entry, a kcal-only entry and a legacy kcal-only entry (stored zero C/F, no ledger) survive
 *   command (`log.meal`) → stored log → realised history (`projectLiving`) → realised schedule → compiler → hourly
 *   ingestion → engine intake (full engine run, ingestion-to-appearance audit read from a day snapshot),
 * and the derived history is idempotent across reload (JSON round trip), import (twice) and re-reads of legacy entries.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { readDocs } from '@/commands/living';
import type { PersonProfile } from '@/engine';
import { DayHourTable, expandDayToHours } from '@/engine/core/compileSchedule';
import { runEngine } from '@/engine/core/loop';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { intakeEnergyAudit } from '@/engine/model/intake/energyBasis';
import { intakeModule, type IntakeState } from '@/engine/model/intake';
import { makeCtx } from '@/engine/model/intake/__tests__/harness';
import { compileVersion, localToInstant, projectLiving, projectionSchedule, type LivingDocs, type LogEntry } from '@/living';
import { readMealIntake } from '@/lib/nutrientExposure';
import { importAll } from '@/state/persistence';
import { mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { relogComponents, type MealLogResult } from '..';
import { seedPlan } from './seed';

const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-09-28' };
const D = '2026-09-29'; // plan day 1
const TODAY = '2026-10-01'; // plan day 3
type Meal = Extract<LogEntry, { kind: 'meal' }>;

function logged(r: CommandResult): string {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  const o = (r as { output: MealLogResult }).output;
  if (o.status !== 'logged') throw new Error(`not logged: ${o.status}`);
  return o.entryId;
}

/** The old manual path's shape (before the ledger): typed kcal and protein, unknown C/F/fibre stored as 0, no `energy`. */
function legacyEntry(date: string, clockH: number, tz: string): Omit<Meal, 'id'> & { _id: string } {
  const z = { value: 0, sd: 0 };
  const n = { energyKcal: { value: 600, sd: 48 }, proteinG: { value: 30, sd: 2.4 }, carbG: z, fatG: z, fibreG: z };
  return {
    _id: '01JABCDEFGHJKMNPQRSTVWXYZ7', date, tz, at: '2026-09-29T14:00:00.000Z', source: { by: 'user', method: 'typed' }, kind: 'meal', clockH,
    components: [{ name: 'dinner', grams: { value: 100, sd: 0 }, nutrients: n, nutrientSource: 'user' }], totals: n,
  };
}

async function seedLegacy(e: ReturnType<typeof legacyEntry>): Promise<void> {
  const store = getDocumentStore();
  await store.ready;
  await store.transact(mintWriteToken('migration', { label: 'legacy entry' }), async (tx) => {
    await tx.append('dailyLogs', e);
  });
}

async function logAll(): Promise<{ id600: string; idKcal: string; idLegacy: string; tz: string }> {
  await seedPlan();
  const id600 = logged(await dispatch('log.meal', { date: D, clockH: 8, method: 'typed', components: [{ name: 'shake', grams: 100, labelPer100g: { energyKcal: 600, proteinG: 30 } }] }));
  const idKcal = logged(await dispatch('log.meal', { date: D, clockH: 13, method: 'typed', components: [{ name: 'thali', grams: 100, labelPer100g: { energyKcal: 450 } }] }));
  await settleCommits();
  const tz = getDocumentStore().peekAll<LogEntry>('dailyLogs')[0]!.tz;
  const legacy = legacyEntry(D, 19, tz);
  await seedLegacy(legacy);
  return { id600, idKcal, idLegacy: legacy._id, tz };
}

const project = (docs: LivingDocs, tz: string) => projectLiving({ docs, today: TODAY, tz, now: localToInstant(TODAY, 10, tz), skipAssimilation: true });

beforeEach(() => {
  freshState({ cleared: true });
});

describe('command → history → compiler → engine (D6-02 joint path)', () => {
  it('600 kcal / 30 g protein, kcal-only and legacy kcal-only entries keep their energy all the way to appearance', async () => {
    const { id600, idKcal, idLegacy, tz } = await logAll();
    const p = project(await readDocs(TODAY), tz);
    const day = p.days.find((d) => d.date === D)!;

    // realised history: observed meals replay exactly as logged (energy kept, unknown macros absent, never 0)
    const specs = day.result.loggedDay.inputs.meals?.meals ?? [];
    const spec = (id: string) => specs.find((s) => s.eventId === id)!;
    expect(spec(id600)).toMatchObject({ energyKcal: 600, macros: { proteinG: 30 } });
    expect(Object.keys(spec(id600).macros ?? {})).toEqual(['proteinG']);
    expect(spec(idKcal)).toMatchObject({ energyKcal: 450, macros: {} });
    expect(spec(idLegacy).energyKcal).toBe(600);
    expect(day.result.observed).toMatchObject({ energyKcal: 1650, proteinG: null, meals: 3, unknownEnergyMeals: 0 });
    expect(p.history!.days.find((d) => d.date === D)!.coverage.energy).toBe('partial');

    // compiler: energy is the report; what the known grams do not explain is energy-only (no named substrate)
    const realised = projectionSchedule(p, TODAY)!;
    const compiled = compileVersion(MAN, realised);
    const cd = compiled.days[1]!;
    const meals = Array.from({ length: cd.nMeals }, (_, k) => cd.meals[k]!);
    const meal = (id: string) => meals.find((m) => m.eventId === id)!;
    expect(meal(id600)).toMatchObject({ kcal: 600, unallocatedKcal: 480, proteinG: 30, carbG: 0, fatG: 0, energyStatus: 'energyOnly' });
    expect(meal(idKcal)).toMatchObject({ kcal: 450, unallocatedKcal: 450, proteinG: 0, carbG: 0, fatG: 0, energyStatus: 'energyOnly' });
    expect(meal(idLegacy)).toMatchObject({ kcal: 600, unallocatedKcal: 480, carbG: 0, fatG: 0, energyStatus: 'energyOnly' });

    // hourly ingestion: every meal's full energy and its energy-only part land in its hour (the imputed remainder of the
    // partly logged day sits on the open prescription slots, as separate meals)
    const t = new DayHourTable();
    expandDayToHours(cd, cd.sleepBedH, cd.sleepHours, null, 0, t, compiled.days[0]!);
    const byHour = (f: (m: (typeof meals)[number]) => number) => Array.from({ length: 24 }, (_, h) => meals.filter((m) => Math.floor(m.clockH) === h).reduce((x, m) => x + f(m), 0));
    const kcalByHour = byHour((m) => m.kcal);
    const unByHour = byHour((m) => m.unallocatedKcal ?? 0);
    for (let h = 0; h < 24; h++) {
      expect(t.kcal[h]).toBeCloseTo(kcalByHour[h]!, 9);
      expect(t.unallocatedKcal[h]).toBeCloseTo(unByHour[h]!, 9);
    }
    expect([meal(id600).clockH, meal(idKcal).clockH, meal(idLegacy).clockH]).toEqual([8, 13, 19]);

    // engine: the compiler's hourly kcal reach the gut in full and every kcal appears or is still in the gut. The audit
    // is cumulative from the module's init (burn-in included), so days 0-2 are the difference of the day-0 and day-3
    // snapshots (everything stepped through days 0-2, the day-2 → 3 midnight tail still in the gut)
    const run = runEngine(resolveProfile({ ...MAN, startDate: realised.startDate }), compiled, { record: 'daily', captureSnapshotAt: [0, 3] });
    const k = intakeModule.prepare(makeCtx(resolveProfile(MAN)));
    const auditAt = (day: number) => {
      const snap = run.snapshots![day]!;
      return intakeEnergyAudit(snap.states[snap.moduleIds.indexOf('intake')] as IntakeState, k);
    };
    const a0 = auditAt(0);
    const a3 = auditAt(3);
    const submittedDays = [0, 1, 2].reduce((acc, d) => acc + Array.from({ length: compiled.days[d]!.nMeals }, (_, j) => compiled.days[d]!.meals[j]!.kcal).reduce((x, y) => x + y, 0), 0);
    expect(a3.submittedKcal - a0.submittedKcal).toBeCloseTo(submittedDays, 6);
    expect(a3.registeredKcal - a0.registeredKcal).toBeCloseTo(submittedDays, 6);
    expect(Math.abs(a0.imbalanceKcal)).toBeLessThan(1e-6);
    expect(Math.abs(a3.imbalanceKcal)).toBeLessThan(1e-6);
  });

  it('a planned meal answered with a recipe serving keeps its table composition: estimated exposure, never a conflict', async () => {
    await seedPlan();
    const id = logged(await dispatch('log.meal', { date: D, slot: 'meal1', method: 'asPlanned', components: [{ name: 'dal', foodId: 'lentils_cooked', grams: 250 }] }));
    await settleCommits();
    const e = getDocumentStore().peekAll<Meal>('dailyLogs').find((x) => x._id === id)!;
    expect(e.provenance).toBe('asPlanned');
    expect(e.energy!.status).toBe('consistent');
    expect((e.exposures ?? []).every((x) => x.coverage === 'asPlannedEstimate')).toBe(true);
    expect(readMealIntake(e).residualKind).not.toBe('conflict');
  });
});

describe('"same as yesterday" keeps the entry\'s semantics (D6-02 product path)', () => {
  it('table foods by id and grams, typed numbers with unknowns still unknown, legacy zeros not carried as zeros', async () => {
    const { id600, idLegacy } = await logAll();
    const idTable = logged(await dispatch('log.meal', { date: D, clockH: 20, method: 'typed', components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 150 }, { name: 'dal', foodId: 'lentils_cooked', grams: 150 }] }));
    await settleCommits();
    const byId = (id: string) => getDocumentStore().peekAll<Meal>('dailyLogs').find((e) => e._id === id)!;
    const again = async (id: string): Promise<Meal> => {
      const old = byId(id);
      const next = logged(await dispatch('log.meal', { date: TODAY, clockH: old.clockH, method: 'typed', components: relogComponents(old) }));
      await settleCommits();
      return byId(next);
    };
    const t1 = byId(idTable);
    const t2 = await again(idTable);
    expect(t2.components.map((c) => [c.foodId, c.grams.value])).toEqual(t1.components.map((c) => [c.foodId, c.grams.value]));
    expect(t2.totals.energyKcal.value).toBeCloseTo(t1.totals.energyKcal.value, 9);
    expect(t2.energy!.status).toBe(t1.energy!.status);
    const s2 = await again(id600);
    expect(s2.energy).toMatchObject({ reportedMEKcal: 600, status: 'energyOnly', macroMask: { protein: 'known', carbohydrate: 'unknown', fat: 'unknown' } });
    expect(readMealIntake(s2).macros).toEqual({ proteinG: 30 });
    const l2 = await again(idLegacy);
    expect(l2.energy).toMatchObject({ reportedMEKcal: 600, status: 'energyOnly', macroMask: { protein: 'known', carbohydrate: 'unknown', fat: 'unknown' } });
    expect(readMealIntake(l2).macros).toEqual({ proteinG: 30 });
    // the stored originals are untouched
    expect(byId(idLegacy)).not.toHaveProperty('energy');
  });
});

describe('reload, import and re-read idempotence (C2/C7)', () => {
  it('a JSON round trip (reload / sync payload) gives the same history hash and the same compiled meals', async () => {
    const { tz } = await logAll();
    const docs = await readDocs(TODAY);
    const a = project(docs, tz);
    const b = project(JSON.parse(JSON.stringify(docs)) as LivingDocs, tz);
    expect(b.history!.contentHash).toBe(a.history!.contentHash);
    const ca = compileVersion(MAN, projectionSchedule(a, TODAY)!).days[1]!;
    const cb = compileVersion(MAN, projectionSchedule(b, TODAY)!).days[1]!;
    for (let k = 0; k < ca.nMeals; k++) expect([cb.meals[k]!.kcal, cb.meals[k]!.unallocatedKcal, cb.meals[k]!.eventId]).toEqual([ca.meals[k]!.kcal, ca.meals[k]!.unallocatedKcal, ca.meals[k]!.eventId]);
  });

  it('importing the logs (twice) into a fresh device keeps every ledger field and the same history', async () => {
    const { tz } = await logAll();
    const before = project(await readDocs(TODAY), tz).history!.contentHash;
    const logs = getDocumentStore()
      .peekAll<LogEntry>('dailyLogs')
      .map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k === '_id' || !k.startsWith('_'))));
    const stored = JSON.parse(JSON.stringify(logs)) as Array<Record<string, unknown>>;

    freshState({ cleared: true });
    await seedPlan();
    const file = { vitalsVersion: '2', app: 'vitals', collections: { dailyLogs: stored } };
    await importAll(file, 'merge');
    await importAll(file, 'merge'); // a repeated import/sync of the same documents adds nothing
    await settleCommits();
    const again = getDocumentStore().peekAll<Meal>('dailyLogs');
    expect(again).toHaveLength(stored.length);
    const typed = again.find((e) => e.energy?.reportedMEKcal === 600)!;
    expect(typed.energy).toMatchObject({ status: 'energyOnly', macroMask: { protein: 'known', carbohydrate: 'unknown', fat: 'unknown' } });
    expect(typed.nutrientCoverage).toBeDefined();
    expect(typed.components[0]!.snapshot).toBeDefined();
    expect(project(await readDocs(TODAY), tz).history!.contentHash).toBe(before);
  });

  it('a legacy entry reads the same every time and is never rewritten', async () => {
    const { idLegacy } = await logAll();
    const stored = getDocumentStore().peekAll<Meal>('dailyLogs').find((e) => e._id === idLegacy)!;
    const frozen = structuredClone(stored);
    const deepFreeze = (o: unknown): void => {
      if (o && typeof o === 'object') {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
    };
    deepFreeze(frozen);
    const r1 = readMealIntake(frozen);
    const r2 = readMealIntake(frozen);
    expect(r2).toEqual(r1);
    expect(r1).toMatchObject({ energyKcal: 600, macros: { proteinG: 30 }, legacy: true, residualKind: 'unallocated' });
    expect(r1.legacyUnknown).toEqual(expect.arrayContaining(['carbG', 'fatG']));
    expect(frozen).toEqual(stored);
    expect(stored).not.toHaveProperty('energy');
  });
});
