// @vitest-environment node
/**
 * W0 phase 0C joint fixture: the W0-core consumers (compiler, loop, recorder, exposure and fingerprint providers) against
 * the W0-history / W0-food / W0-training / W0-clinical providers, through the real pipeline
 *
 *   plan documents → the one realised history (C2) → realised schedule → compileSchedule → runEngine.
 *
 * Lifecycle and replay invariants checked here: reported meal energy reaches the hourly table (D6-02); a realised day's
 * exposure carries its coverage and a partial day's known sum counts observed events only (D4-01, C1/C3); a logged bout
 * keeps its set groups and identity (D3-01); the same documents in any order, delivered twice or reloaded from JSON replay
 * identically and an entry dated today leaves the elapsed history alone (C2/C7 reload/import/sync); future and running
 * fast length never reaches the elapsed physiology (D2-01); measured lab anchors and their statuses survive a resumed run
 * (D7-02); the initial-state fingerprint a certificate binds follows the history and nothing else (D4-03).
 */
import type { DayTemplate, PersonProfile, ResistanceSetGroup, Schedule } from '@/engine';
import { CONTRACT_VERSIONS } from '@/lib/bodyContracts';
import { addDays, localToInstant } from '@/living/dates';
import { projectLiving, projectionSchedule, type LivingDocs } from '@/living/projection';
import { DEFAULT_ITEM_WEIGHTS } from '@/living/prescription';
import { historyAnchorOf, reduceRealisedHistory, type HistoryDocument } from '@/living/realisedHistory';
import type { DayStatusDoc, LogEntry, PlanDoc, PlanVersionDoc } from '@/living/types';
import { compileSchedule, DayHourTable, expandDayToHours, resolvedDayExposure } from '../compileSchedule';
import { initialStateFingerprint, runEngine } from '../loop';
import { resolveProfile } from '../resolveProfile';
import type { SimulationResult } from '../../types/result';

const TZ = 'Asia/Kolkata';
const START = '2026-10-05';
/** Today = plan day 3: days 0-2 are the elapsed history. */
const TODAY = addDays(START, 3);
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { sessionsPerWeek: 3 }, startDate: START };
const DAY: DayTemplate = {
  id: 'A',
  label: 'day',
  energy: { kind: 'kcal', kcal: 2000 },
  macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } },
  steps: 8000,
  sleep: { bedH: 23, wakeH: 7 },
};

function schedule(events: Schedule['events'] = []): Schedule {
  return { schemaVersion: 1, startDate: START, horizonDays: 14, programs: [DAY], days: Array.from({ length: 14 }, () => ({ program: 0 })), events };
}

function planDocs(s: Schedule, profile: PersonProfile = MAN): { plan: PlanDoc & { id: string }; version: PlanVersionDoc } {
  const at = '2026-10-01T10:00:00.000Z';
  const plan: PlanDoc & { id: string } = {
    id: 'p1', name: 'Plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: at }, status: 'active', startDate: START,
    plannedEndDate: addDays(START, s.horizonDays), request: { profile, goals: [], horizonDays: s.horizonDays }, baselineProfile: profile, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: at,
  };
  const version: PlanVersionDoc = {
    planId: 'p1', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: s, genome: null, sessions: {},
    sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'x', registryHash: 'y', catalogueVersion: 'z' }, createdBy: { kind: 'system' }, createdAt: at,
  };
  return { plan, version };
}

const src = { by: 'user' as const, method: 'typed' as const };
const est = (v: number) => ({ value: v, sd: 0.08 * v });
type Totals = Extract<LogEntry, { kind: 'meal' }>['totals'];

function meal(id: string, day: number, clockH: number, totals: Totals): LogEntry {
  const date = addDays(START, day);
  return { id, date, tz: TZ, at: localToInstant(date, clockH, TZ), source: src, kind: 'meal', clockH, components: [], totals } as LogEntry;
}
/** A fully analysed meal (every macro known, consistent with its energy at the general factors 4/4/9/2). */
const full = (id: string, day: number, clockH: number, kcal: number, protein: number): LogEntry => {
  const rest = kcal - 4 * protein - 2 * 6;
  return meal(id, day, clockH, { energyKcal: est(kcal), proteinG: est(protein), carbG: est((rest * 0.5) / 4), fatG: est((rest * 0.5) / 9), fibreG: est(6) });
};
/** D6-02: reported energy and protein only; carbohydrate, fat and fibre are unknown (placeholders, never zeros). */
const energyAndProtein = (id: string, day: number, clockH: number, kcal: number, protein: number): LogEntry =>
  meal(id, day, clockH, { energyKcal: est(kcal), proteinG: est(protein), carbG: { value: 0, sd: 0 }, fatG: { value: 0, sd: 0 }, unknown: ['carbG', 'fatG', 'fibreG'] });
/** D6-02: a kcal-only entry. */
const kcalOnly = (id: string, day: number, clockH: number, kcal: number): LogEntry =>
  meal(id, day, clockH, { energyKcal: est(kcal), proteinG: { value: 0, sd: 0 }, carbG: { value: 0, sd: 0 }, fatG: { value: 0, sd: 0 }, unknown: ['proteinG', 'carbG', 'fatG', 'fibreG'] });

/** D3-01: a logged bout whose stored engine dose carries two homogeneous set groups (as the catalogue's `toEngineDose` writes it). */
const GROUPS: ResistanceSetGroup[] = [
  { sets: 3, regionWeights: { quads: 1, glutes: 0.5 }, contraction: 'dynamic', loadPct1RM: 75, rir: 2, restSec: 120, startOffsetMin: 0, durationMin: 12 },
  { sets: 2, regionWeights: { core: 1 }, contraction: 'isometric', holdSec: 40, startOffsetMin: 12, durationMin: 6 },
];
function session(id: string, day: number, startH: number): LogEntry {
  const date = addDays(START, day);
  return {
    id, date, tz: TZ, at: localToInstant(date, startH, TZ), source: src, kind: 'session', status: 'done', startH, durationMin: 18, performed: [],
    stimulus: { effectiveSetsByRegion: { quads: 3, glutes: 1.5, core: 2 }, pattern: 'squat', loadClass: 'moderate', netKcal: 90, mem: 0, hiMinutes: 0, mobilityMinutes: {} },
    catalogueVersion: 'test',
    engine: [{ kind: 'resistance', startH, durationMin: 18, setsByRegion: { quads: 3, glutes: 1.5, core: 2 }, setsByRegionIncludesTypeFactor: true, groups: GROUPS }],
  } as LogEntry;
}

const attest = (day: number, intake: DayStatusDoc['intake']): DayStatusDoc => ({ date: addDays(START, day), planId: 'p1', intake });

/** Days 0-1 attested complete; day 2 logs one meal only (the rest of the day is the history's imputed remainder) and a bout. */
const ENTRIES: LogEntry[] = [
  full('d0-a', 0, 8, 700, 50),
  full('d0-b', 0, 13, 700, 50),
  full('d0-c', 0, 19, 600, 50),
  energyAndProtein('d1-eo', 1, 8.5, 600, 30),
  kcalOnly('d1-k', 1, 13, 400),
  full('d1-c', 1, 19, 900, 60),
  full('d2-a', 2, 8, 700, 50),
  session('s2', 2, 18),
];
const STATUS: DayStatusDoc[] = [attest(0, 'complete'), attest(1, 'complete')];

function docsOf(s: Schedule, entries: readonly LogEntry[] = ENTRIES, status: readonly DayStatusDoc[] = STATUS, profile: PersonProfile = MAN): LivingDocs {
  const { plan, version } = planDocs(s, profile);
  return { plan, versions: [version], dayStatus: [...status], entries: [...entries], measurements: [], records: [] };
}
const nowOf = (today: string, clockH = 10) => localToInstant(today, clockH, TZ);
function realised(docs: LivingDocs, today = TODAY): { p: ReturnType<typeof projectLiving>; s: Schedule } {
  const p = projectLiving({ docs, today, tz: TZ, now: nowOf(today), skipAssimilation: true });
  return { p, s: projectionSchedule(p, today)! };
}

const rp = resolveProfile(MAN);
const mealAt = (cs: ReturnType<typeof compileSchedule>, day: number, clockH: number) => {
  const d = cs.days[day]!;
  return d.meals.slice(0, d.nMeals).find((m) => Math.abs(m.clockH - clockH) < 1e-9);
};
/** First series/day where two runs differ in days [from, to), or null. */
function firstDiff(a: SimulationResult, b: SimulationResult, from: number, to: number): string | null {
  for (const id of Object.keys(a.daily) as Array<keyof SimulationResult['daily']>) {
    const x = a.daily[id];
    const y = b.daily[id];
    if (!x || !y) return `${String(id)}: missing`;
    for (let d = from; d < to; d++) if (!Object.is(x[d], y[d])) return `${String(id)}[${d}]: ${x[d]} vs ${y[d]}`;
  }
  return null;
}

describe('documents → realised history → compiled replay (W0 0C)', () => {
  const { p, s } = realised(docsOf(schedule()));
  const cs = compileSchedule(s, rp);

  it('the replay schedule echoes the realised history it came from (the hash a certificate and the fingerprint bind)', () => {
    expect(p.history).not.toBeNull();
    expect(s.realised).toMatchObject({ historyHash: p.history!.contentHash, throughDay: 3, contractVersion: CONTRACT_VERSIONS.realisedHistory });
    expect(cs.realised?.historyHash).toBe(p.history!.contentHash);
    // every elapsed day is an observed day with its coverage and a daily-at-best causal resolution
    for (const d of [0, 1, 2]) {
      expect(cs.days[d]!.coverage).toBeDefined();
      expect(['daily', 'scenario']).toContain(cs.days[d]!.resolution);
    }
    expect(cs.days[3]!.coverage).toBeUndefined();
  });

  it('D6-02: 600 kcal / 30 g protein and kcal-only entries keep their energy from the log to the hourly table and the run', () => {
    const eo = mealAt(cs, 1, 8.5)!;
    expect(eo).toMatchObject({ kcal: 600, reportedKcal: 600, proteinG: 30, carbG: 0, fatG: 0, energyStatus: 'energyOnly', eventId: 'd1-eo' });
    expect(eo.unallocatedKcal).toBeCloseTo(600 - 4 * 30, 9);
    const k = mealAt(cs, 1, 13)!;
    expect(k).toMatchObject({ kcal: 400, reportedKcal: 400, proteinG: 0, energyStatus: 'energyOnly', eventId: 'd1-k' });
    expect(k.unallocatedKcal).toBeCloseTo(400, 9);
    const d1 = cs.days[1]!;
    expect(d1.energyKcal).toBeCloseTo(1900, 9);
    expect(d1.unallocatedKcal).toBeCloseTo(880, 9);
    // hourly ingestion: the day's rows carry exactly the reported energy, the unexplained part as unallocated energy
    const t = new DayHourTable();
    expandDayToHours(d1, 23, 8, null, 24, t, cs.days[0]!);
    let kcal = 0;
    let unalloc = 0;
    for (let h = 0; h < 24; h++) {
      kcal += t.kcal[h]!;
      unalloc += t.unallocatedKcal[h]!;
    }
    expect(kcal).toBeCloseTo(1900, 6);
    expect(unalloc).toBeCloseTo(880, 6);
    // and the run's intake echo
    const r = runEngine(rp, cs, { record: 'daily', series: ['inEnergy', 'inProtein'] });
    expect(r.daily.inEnergy![1]).toBeCloseTo(1900, 2);
    expect(r.daily.inProtein![1]).toBeCloseTo(90, 3);
  });

  it('D4-01: a realised day states its exposure coverage; a partial day counts the observed events only', () => {
    const d1 = resolvedDayExposure(cs.days[1]!);
    expect(d1.energy).toEqual({ knownSum: 1900, unit: 'kcal', coverage: 'complete' });
    // two meals have unknown protein/carbohydrate: a lower bound of the known grams, never a measured zero
    expect(d1.protein!.coverage).toBe('partial');
    expect(d1.protein!.knownSum).toBeCloseTo(90, 9);
    expect(d1.carbAvailable!.coverage).toBe('partial');
    // day 2 logged one 700 kcal meal; the rest of the day is the history's imputed remainder (a scenario input)
    const d2 = cs.days[2]!;
    const e2 = resolvedDayExposure(d2);
    expect(e2.energy!.coverage).toBe('partial');
    expect(d2.energyKcal).toBeGreaterThan(700 + 1);
    expect(e2.energy!.knownSum).toBeCloseTo(700, 9);
    expect(e2.protein!.knownSum).toBeCloseTo(50, 9);
    // a prescribed (future) day states its own modeled exposure completely
    expect(resolvedDayExposure(cs.days[5]!).energy).toMatchObject({ coverage: 'complete' });
    // the allocation-free refresh agrees with a fresh read (runtime-resolved days)
    const c2 = compileSchedule(s, rp, { exposure: true });
    expect(c2.days[2]!.exposure).toEqual(e2);
  });

  it('D3-01: a logged bout keeps its set groups, its identity and the origin day through replay and compile', () => {
    const d2 = cs.days[2]!;
    expect(d2.nRtGroups).toBe(2);
    const g = d2.rtGroups!.slice(0, 2);
    expect(g.map((x) => [x.sets, x.contraction, x.sessionId ?? d2.sessions[x.session]?.sessionId])).toEqual([
      [3, 'dynamic', 's2'],
      [2, 'isometric', 's2'],
    ]);
    expect(g[0]).toMatchObject({ loadPct1RM: 75, rir: 2, restSec: 120 });
    // an unreported effort stays unknown (NaN) and flagged, never a default dressed as reported
    expect(Number.isNaN(g[1]!.rir)).toBe(true);
    expect(g[1]!.assumed).toBe(1);
    // days without groups keep the legacy path unchanged
    expect(cs.days[0]!.nRtGroups ?? 0).toBe(0);
    expect(cs.days[5]!.nRtGroups ?? 0).toBe(0);
  });
});

describe('reload / import / sync idempotence of the replay (C2/C7)', () => {
  const base = docsOf(schedule());
  const { p, s } = realised(base);
  const cs = compileSchedule(s, rp);
  const run = runEngine(rp, cs, { record: 'daily' });

  it('the same documents in another order give the same history, schedule, compile and run', () => {
    const again = realised(docsOf(schedule(), [...ENTRIES].reverse(), [...STATUS].reverse()));
    expect(again.p.history!.contentHash).toBe(p.history!.contentHash);
    expect(JSON.stringify(again.s)).toBe(JSON.stringify(s));
    const c2 = compileSchedule(again.s, rp);
    expect(c2).toEqual(cs);
    expect(firstDiff(run, runEngine(rp, c2, { record: 'daily' }), 0, cs.nDays)).toBeNull();
  });

  it('a document delivered twice (sync echo, repeated import) is one observation: same history, schedule and fingerprint', () => {
    const again = realised(docsOf(schedule(), [...ENTRIES].reverse().concat(ENTRIES.slice(0, 3)), STATUS));
    expect(again.p.history!.contentHash).toBe(p.history!.contentHash);
    expect(again.p.history!.uncertaintyGroups).toEqual(p.history!.uncertaintyGroups);
    expect(JSON.stringify(again.s)).toBe(JSON.stringify(s));
    expect(initialStateFingerprint(rp, compileSchedule(again.s, rp))).toBe(initialStateFingerprint(rp, cs));
  });

  it('the C2 reducer is order- and re-delivery-insensitive over raw documents', () => {
    const { plan, version } = planDocs(schedule());
    const docs: HistoryDocument[] = [
      { kind: 'plan', plan },
      { kind: 'version', version },
      ...STATUS.map((st) => ({ kind: 'dayStatus' as const, status: st })),
      ...ENTRIES.map((entry) => ({ kind: 'entry' as const, entry })),
    ];
    const anchor = historyAnchorOf(plan, TZ);
    const a = reduceRealisedHistory(anchor, docs, nowOf(TODAY), CONTRACT_VERSIONS.realisedHistory);
    const b = reduceRealisedHistory(anchor, [...docs].reverse().concat(docs.slice(-3)), nowOf(TODAY), CONTRACT_VERSIONS.realisedHistory);
    expect(b.contentHash).toBe(a.contentHash);
    expect(a.days.map((d) => d.planDay)).toEqual([0, 1, 2]);
  });

  it('a JSON reload of the schedule compiles and runs bit-identically, with the same initial-state fingerprint', () => {
    const reloaded = JSON.parse(JSON.stringify(s)) as Schedule;
    const c2 = compileSchedule(reloaded, rp);
    expect(c2).toEqual(cs);
    expect(firstDiff(run, runEngine(rp, c2, { record: 'daily' }), 0, cs.nDays)).toBeNull();
    expect(initialStateFingerprint(rp, c2)).toBe(initialStateFingerprint(rp, cs));
  });

  it('an entry dated today leaves the elapsed history alone; a late past entry changes it, and the fingerprint follows', () => {
    const today = realised(docsOf(schedule(), [...ENTRIES, full('d3-a', 3, 8, 500, 40)]));
    expect(today.p.history!.contentHash).toBe(p.history!.contentHash);
    expect(initialStateFingerprint(rp, compileSchedule(today.s, rp))).toBe(initialStateFingerprint(rp, cs));
    const late = realised(docsOf(schedule(), [...ENTRIES, full('d0-late', 0, 21, 300, 10)]));
    expect(late.p.history!.contentHash).not.toBe(p.history!.contentHash);
    const lc = compileSchedule(late.s, rp);
    expect(lc.days[0]!.energyKcal).toBeCloseTo(cs.days[0]!.energyKcal + 300, 9);
    expect(initialStateFingerprint(rp, lc)).not.toBe(initialStateFingerprint(rp, cs));
  });
});

describe('D2-01: fast length and label never reach the elapsed physiology', () => {
  // days 0-2 fully logged and attested (last meal 19:00), so the realised day inputs are identical in every variant
  const entries = [0, 1, 2].flatMap((d) => [full(`m${d}a`, d, 8, 700, 50), full(`m${d}b`, d, 13, 700, 50), full(`m${d}c`, d, 19, 600, 50)]);
  const status = [0, 1, 2].map((d) => attest(d, 'complete'));
  const variants: Record<string, Schedule['events']> = {
    none: [],
    running23: [{ kind: 'fast', startDay: 2, startH: 20, durationH: 23 }],
    running24: [{ kind: 'fast', startDay: 2, startH: 20, durationH: 24 }],
    running48: [{ kind: 'fast', startDay: 2, startH: 20, durationH: 48 }],
    future36: [{ kind: 'fast', startDay: 3, startH: 20, durationH: 36 }],
  };
  const runs = Object.fromEntries(
    Object.entries(variants).map(([k, ev]) => {
      const { s } = realised(docsOf(schedule(ev), entries, status));
      const cs = compileSchedule(s, rp);
      return [k, { cs, r: runEngine(rp, cs, { record: 'daily' }) }];
    }),
  );

  it('the elapsed days compile to the same intake in every variant (no meal dropped or refed by a planned length)', () => {
    for (const k of Object.keys(variants)) for (const d of [0, 1, 2]) expect(runs[k]!.cs.days[d]!.energyKcal).toBeCloseTo(2000, 9);
    // the planned length survives as policy metadata only (meal-to-meal length of the planned zero-intake span)
    const planned = (k: string) => runs[k]!.cs.days[2]!.fastPolicy?.plannedDurationH ?? 0;
    expect(planned('running48')).toBe(runs.running48!.cs.fastSpans[0]!.mealToMealH);
    expect(planned('running48')).toBeGreaterThan(planned('running24'));
    expect(planned('running24')).toBeGreaterThan(planned('running23'));
    expect(runs.none!.cs.days[2]!.fastPolicy).toBeUndefined();
  });

  it('every recorded series of days 0-2 is bit-identical for none / 23 / 24 / 48 h running and a future fast', () => {
    for (const k of Object.keys(variants)) expect(firstDiff(runs.none!.r, runs[k]!.r, 0, 3), k).toBeNull();
  });
});

describe('D7-02 measured anchors through a resumed realised replay', () => {
  const labs = { ldlMmolL: 310 / 38.67, tgMmolL: 1200 / 88.57, hdlMmolL: 1.2 };
  const person: PersonProfile = { ...MAN, labs };
  const { s } = realised(docsOf(schedule(), ENTRIES, STATUS, person));
  const prof = resolveProfile(person);
  const cs = compileSchedule(s, prof);
  const full3 = runEngine(prof, cs, { record: 'daily', captureSnapshotAt: [3] });

  it('the measured values are the exact t = 0 values; the out-of-calibration ones carry their status from daily index 0 (A1-052)', () => {
    expect(full3.initial.ldl).toBe(labs.ldlMmolL);
    expect(full3.initial.triglycerides).toBe(labs.tgMmolL);
    expect(full3.initial.hdl).toBe(1.2);
    expect(full3.meta.outputStatus?.ldl).toMatchObject({ status: 'outOfDomain', fromDay: 0 });
    expect(full3.meta.outputStatus?.apoB).toMatchObject({ status: 'outOfDomain', fromDay: 0 });
    expect(full3.meta.outputStatus?.hdl).toBeUndefined();
    expect(full3.meta.observedAnchors!.find((a) => a.series === 'hdl')?.outOfDomain).toBe(false);
  });

  it('resuming from today keeps the anchors, the statuses and every value', () => {
    const cont = runEngine(prof, cs, { record: 'daily', initialSnapshot: full3.snapshots![3]! });
    expect(cont.meta.observedAnchors).toEqual(full3.meta.observedAnchors);
    expect(cont.meta.outputStatus).toEqual(full3.meta.outputStatus);
    expect(firstDiff(full3, cont, 3, cs.nDays)).toBeNull();
  });
});
