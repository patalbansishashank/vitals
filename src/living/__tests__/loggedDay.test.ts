// @vitest-environment node
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import type { StimulusVector } from '@/catalogues';
import { freezePrescription, DEFAULT_ITEM_WEIGHTS } from '../prescription';
import { toLoggedDay, scaleSession, stimulusToEngineSessions, type LoggedDayInput } from '../loggedDay';
import { resolveFasts } from '../fastIntervals';
import { catalogueEquivalence } from '../equivalence';
import { effectiveEntries, aiEnergyShare, burdenMonitor, lapseState, tierOfEntry } from '../logs';
import { localToInstant } from '../dates';
import type { LogEntry, PlanDoc, PlanVersionDoc, PrescribedDaySnapshot } from '../types';

const TZ = 'Asia/Kolkata';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { sessionsPerWeek: 3 }, startDate: '2026-10-05' };
const TRAIN: DayTemplate = {
  id: 'A', label: 'training day', energy: { kind: 'kcal', kcal: 2000 },
  macros: { protein: { unit: 'g', value: 160 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 9, lengthH: 10 } }, exercise: [{ kind: 'resistance', startH: 18, durationMin: 50, setsByRegion: { quads: 6, glutes: 3, chest: 6 } }],
  steps: 9000, sleep: { bedH: 23, wakeH: 7 },
};
const FAST: DayTemplate = { ...TRAIN, id: 'F', label: 'fast day', exercise: [] };
const SCHED: Schedule = {
  schemaVersion: 1, startDate: '2026-10-05', horizonDays: 14, programs: [TRAIN, FAST],
  days: Array.from({ length: 14 }, (_, d) => ({ program: d === 4 ? 1 : 0 })),
  events: [{ kind: 'fast', startDay: 4, startH: 20, durationH: 24 }],
};
const PRESCRIBED_STIM: StimulusVector = {
  effectiveSetsByRegion: { quads: 6, glutes: 3, chest: 6 }, pattern: 'squat', loadClass: 'moderate', netKcal: 150, mem: 0, hiMinutes: 0, mobilityMinutes: {},
};

const plan: PlanDoc & { id: string } = {
  id: 'p1', name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-01T10:00:00.000Z' },
  status: 'active', startDate: '2026-10-05', plannedEndDate: '2026-10-19', request: { profile: MAN, goals: [], horizonDays: 14 },
  baselineProfile: MAN, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-01T10:00:00.000Z',
};
const version: PlanVersionDoc = {
  planId: 'p1', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHED, genome: null,
  sessions: {}, sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
  forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
  provenance: { engineVersion: 'x', registryHash: 'y', catalogueVersion: 'z' }, createdBy: { kind: 'system' }, createdAt: '2026-10-01T10:00:00.000Z',
};

function rx(date: string): PrescribedDaySnapshot {
  const r = freezePrescription({ plan, version, date, tz: TZ });
  // the composed session's stimulus (E8 would fill it from `version.sessions`)
  return { ...r, sessions: r.sessions.map((s) => ({ ...s, stimulus: PRESCRIBED_STIM })) };
}

let seq = 0;
const src = { by: 'user' as const, method: 'typed' as const };
function meal(date: string, clockH: number, kcal: number, protein: number, over: Partial<LogEntry> = {}): LogEntry {
  const e = (v: number, f = 0.08) => ({ value: v, sd: v * f });
  return {
    id: `m${++seq}`, date, tz: TZ, at: localToInstant(date, clockH, TZ), source: src, kind: 'meal', clockH, components: [],
    totals: { energyKcal: e(kcal), proteinG: e(protein), carbG: e((kcal - 4 * protein) * 0.5 / 4), fatG: e((kcal - 4 * protein) * 0.5 / 9), fibreG: e(8) }, ...over,
  } as LogEntry;
}
const base = (date: string, over: Partial<LoggedDayInput> = {}): LoggedDayInput => ({
  date, planStart: plan.startDate, tz: TZ, prescription: rx(date), entries: [], expected: () => 0.75, equivalence: catalogueEquivalence, final: true, ...over,
});

describe('prescription snapshot (§3.3)', () => {
  it('freezes energy, macros, meals, window, sessions, steps, sleep and weighted items (weights sum to 1)', () => {
    const r = rx('2026-10-05');
    expect(r.planDay).toBe(0);
    expect(r.energyKcal).toBeCloseTo(2000, 6);
    expect(r.macros.proteinG).toBeCloseTo(160, 6);
    expect(r.meals).toHaveLength(3);
    expect(r.window).toEqual({ startH: 9, endH: 19 });
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]!.slotKey).toBe('0:0');
    expect(r.items.map((i) => i.type).sort()).toEqual(['energy', 'protein', 'rtSession', 'sleep', 'steps', 'window']);
    expect(r.items.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(1, 12);
    expect(new Set(r.items.map((i) => i.weight)).size).toBeGreaterThan(1); // not equal weights
  });

  it('a fast day carries the fast as instants and an item; a paused day is habitual with zero weights', () => {
    const f = rx('2026-10-09');
    expect(f.fast).toMatchObject({ hours: 24, lastIntakeAt: localToInstant('2026-10-09', 20, TZ) });
    expect(f.items.some((i) => i.type === 'fast')).toBe(true);
    const p = freezePrescription({ plan, version, date: '2026-10-07', tz: TZ, paused: true });
    expect(p.paused).toBe(true);
    expect(p.dayType).toBe('habitual day');
    expect(p.items.every((i) => i.weight === 0)).toBe(true);
  });
});

describe('toLoggedDay (§3.4)', () => {
  it('logged meals of a day reported complete become exact energy and macro grams with explicit meals; energy and protein are credited', () => {
    const d = '2026-10-05';
    const entries = [meal(d, 9, 600, 50), meal(d, 13, 700, 55, { complete: true } as Partial<LogEntry>), meal(d, 18.5, 700, 55)];
    const r = toLoggedDay(base(d, { entries, status: { date: d, intake: 'complete' } }));
    expect(r.loggedDay.inputs.energy).toEqual({ kind: 'kcal', kcal: 2000 });
    expect(r.loggedDay.inputs.meals?.meals).toHaveLength(3);
    expect(r.loggedDay.inputs.meals?.meals?.map((m) => m.energyKcal)).toEqual([600, 700, 700]);
    expect(r.loggedDay.items.find((i) => i.itemId === 'energy')).toMatchObject({ status: 'done', credit: 1 });
    expect(r.loggedDay.items.find((i) => i.itemId === 'protein')!.credit).toBeCloseTo(1, 9);
    expect(r.loggedDay.items.find((i) => i.itemId === 'window')!.credit).toBe(1);
    expect(r.intakeLogged).toBe(true);
    expect(r.coverage.energy).toBe('complete');
    expect(r.calibrationEligible).toBe(true);
    expect(r.remainders).toEqual([]);
  });

  it('D5-01: three meals and a per-meal complete flag never make a complete day; observed meals stay exact, the rest is a separate remainder', () => {
    const d = '2026-10-05';
    const entries = [meal(d, 9, 600, 50), meal(d, 13, 700, 55, { complete: true } as Partial<LogEntry>), meal(d, 18.5, 700, 55)];
    const r = toLoggedDay(base(d, { entries }));
    expect(r.coverage.energy).toBe('partial');
    expect(r.calibrationEligible).toBe(false);
    expect(r.loggedDay.items.find((i) => i.itemId === 'energy')).toMatchObject({ status: 'unknown', credit: null });
    const specs = r.loggedDay.inputs.meals!.meals!;
    const observed = specs.filter((m) => m.eventId !== undefined);
    expect(observed.map((m) => [m.clockH, m.energyKcal, m.macros?.proteinG])).toEqual([[9, 600, 50], [13, 700, 55], [18.5, 700, 55]]);
    const imputed = specs.filter((m) => m.eventId === undefined);
    const rest = imputed.reduce((a, m) => a + (m.energyKcal ?? 0), 0);
    expect(r.remainders).toHaveLength(1);
    expect(r.remainders[0]).toMatchObject({ channel: 'energy', scenario: 'expectedCredit', timing: 'prescribedSlots', provenance: 'imputed' });
    expect(r.remainders[0]!.value).toBeCloseTo(rest, 6);
    const e = r.loggedDay.inputs.energy;
    expect(e.kind === 'kcal' && e.kcal).toBeCloseTo(2000 + rest, 6);
    expect(r.assumptions.some((a) => a.kind === 'remainderImputation')).toBe(true);
    expect(r.resolution).toBe('scenario');
  });

  it('D5-01/D6-02: one 500 kcal breakfast replays as 500 observed kcal at its clock; unknown macros are left out, never zero', () => {
    const d = '2026-10-05';
    const bf = { ...meal(d, 8, 500, 30), totals: { energyKcal: { value: 500, sd: 40 }, proteinG: { value: 30, sd: 3 }, carbG: { value: 0, sd: 0 }, fatG: { value: 0, sd: 0 }, unknown: ['carbG', 'fatG'] } } as LogEntry;
    const r = toLoggedDay(base(d, { entries: [bf] }));
    const spec = r.loggedDay.inputs.meals!.meals!.find((m) => m.eventId === bf.id)!;
    expect(spec).toMatchObject({ clockH: 8, energyKcal: 500, macros: { proteinG: 30 } });
    expect(spec.macros).not.toHaveProperty('carbG');
    expect(spec.macros).not.toHaveProperty('fatG');
    expect(r.observed).toMatchObject({ energyKcal: 500, proteinG: 30, meals: 1 });
    expect(r.coverage.energy).toBe('partial');
    expect(r.coverage.carbohydrate).toBe('partial');
    expect(r.calibrationEligible).toBe(false);
    // the remainder sits on the prescription's other slots and never rescales the breakfast
    for (const m of r.loggedDay.inputs.meals!.meals!) if (m.eventId === undefined) expect(m.clockH).not.toBe(8);
  });

  it('D5-01: "nothing eaten" is a confirmed zero (eligible), never skipped; as-planned taps and backfill stay estimates', () => {
    const d = '2026-10-06';
    const zero = toLoggedDay(base(d, { status: { date: d, intake: 'none' } }));
    expect(zero.loggedDay.inputs.energy).toEqual({ kind: 'zero' });
    expect(zero.coverage.energy).toBe('confirmedZero');
    expect(zero.calibrationEligible).toBe(true);
    const tap = toLoggedDay(base(d, { status: { date: d, marks: { food: 'asPlanned' } } }));
    expect(tap.coverage.energy).toBe('asPlannedEstimate');
    expect(tap.calibrationEligible).toBe(false);
    const asPlannedMeal = toLoggedDay(base(d, { entries: [meal(d, 9, 2000, 160, { source: { by: 'user', method: 'asPlanned' } } as Partial<LogEntry>)], status: { date: d, intake: 'complete' } }));
    expect(asPlannedMeal.coverage.energy).toBe('complete');
    expect(asPlannedMeal.calibrationEligible).toBe(false);
    const partly = toLoggedDay(base(d, { status: { date: d, marks: { food: 'partly' } } }));
    expect(partly.loggedDay.inputs.energy).not.toEqual(TRAIN.energy);
  });

  it('D5-01: a meal answered "not" gets no remainder; an answered "partly" slot gets half its planned energy as an imputed remainder', () => {
    const d = '2026-10-06';
    const r0 = rx(d);
    const [s1, s2] = r0.meals;
    const r = toLoggedDay(base(d, { status: { date: d, marks: { meals: { [s1!.slot]: 'not', [s2!.slot]: 'partly' } } } }));
    const specs = r.loggedDay.inputs.meals!.meals!;
    expect(specs.some((m) => m.clockH === s1!.clockH)).toBe(false);
    expect(specs.find((m) => m.clockH === s2!.clockH)!.energyKcal).toBeCloseTo(0.5 * s2!.energyKcal, 6);
    expect(r.loggedDay.items.find((i) => i.itemId === 'energy')!.credit).toBeNull();
  });

  it('nothing logged: every item unknown, no score, and the replay uses the expected credit', () => {
    const r = toLoggedDay(base('2026-10-06', { expected: () => 0.5 }));
    expect(r.score.score).toBeNull();
    expect(r.score.coverage).toBe(0);
    expect(r.loggedDay.items.every((i) => i.status === 'unknown' && i.credit === null)).toBe(true);
    const e = r.loggedDay.inputs.energy;
    expect(e.kind).toBe('kcal');
    // halfway between maintenance and the prescription
    expect(e.kind === 'kcal' && e.kcal).toBeGreaterThan(2000);
    const sets = r.loggedDay.inputs.exercise![0]!;
    expect(sets.kind === 'resistance' && sets.setsByRegion!.quads).toBeCloseTo(3, 9);
    expect(r.assumedItems).toContain('rtSession:1:0');
    expect(r.intakeLogged).toBe(false);
  });

  it('T0 marks: "as planned" scores 100 with the prescription as inputs; "not" on food simulates maintenance', () => {
    const all = toLoggedDay(base('2026-10-06', { status: { date: '2026-10-06', marks: { all: 'asPlanned' } } }));
    expect(all.score.score).toBe(100);
    expect(all.loggedDay.inputs.energy).toEqual(TRAIN.energy);
    const not = toLoggedDay(base('2026-10-06', { status: { date: '2026-10-06', marks: { food: 'not', train: 'asPlanned' } } }));
    expect(not.loggedDay.inputs.energy).toEqual({ kind: 'pctMaintenance', pct: 100, reference: 'current' });
    expect(not.loggedDay.items.find((i) => i.itemId === 'energy')!.credit).toBe(0);
  });

  it('an equivalent session swap counts in full; a skipped session is 0; the engine simulates what was logged', () => {
    const d = '2026-10-05';
    const same: StimulusVector = { ...PRESCRIBED_STIM, pattern: 'lunge' };
    const swap = toLoggedDay(base(d, { entries: [{ id: 's1', date: d, tz: TZ, source: src, kind: 'session', status: 'done', itemId: 'rtSession:0:0', performed: [], stimulus: same, catalogueVersion: 'c1', startH: 18 } as LogEntry] }));
    expect(swap.loggedDay.items.find((i) => i.type === 'rtSession')).toMatchObject({ status: 'done', credit: 1 });
    const skip = toLoggedDay(base(d, { entries: [{ id: 's2', date: d, tz: TZ, source: src, kind: 'session', status: 'skipped', itemId: 'rtSession:0:0', performed: [], stimulus: same, catalogueVersion: 'c1' } as LogEntry] }));
    expect(skip.loggedDay.items.find((i) => i.type === 'rtSession')).toMatchObject({ status: 'skipped', credit: 0 });
    expect(skip.loggedDay.inputs.exercise).toEqual([]);
    const cardio: StimulusVector = { effectiveSetsByRegion: {}, pattern: 'gait', loadClass: 'veryLight', netKcal: 300, mem: 40, hiMinutes: 0, mobilityMinutes: {} } as unknown as StimulusVector;
    const other = toLoggedDay(base(d, { entries: [{ id: 's3', date: d, tz: TZ, source: src, kind: 'session', status: 'done', itemId: 'rtSession:0:0', performed: [], stimulus: cardio, catalogueVersion: 'c1', startH: 7 } as LogEntry] }));
    const c = other.loggedDay.items.find((i) => i.type === 'rtSession')!.credit!;
    expect(c).toBeLessThan(0.6);
    expect(other.loggedDay.inputs.exercise![0]).toMatchObject({ kind: 'cardio', durationMin: 40 });
  });

  it('a fast broken at 18 of 24 h earns half; a meal inside the prescribed fast ends it there', () => {
    const d = '2026-10-09';
    const last = localToInstant(d, 20, TZ);
    const first = new Date(Date.parse(last) + 18 * 3_600_000).toISOString();
    const r = toLoggedDay(base(d, { entries: [{ id: 'f1', date: d, tz: TZ, source: src, kind: 'fast', lastIntakeAt: last, firstIntakeAt: first, broken: true } as LogEntry] }));
    expect(r.loggedDay.items.find((i) => i.type === 'fast')).toMatchObject({ status: 'partial', credit: 0.5 });
    expect(r.fast).toMatchObject({ startDay: 4, startH: 20, durationH: 18, source: 'observed' });
    // the next day's breakfast ends the prescribed fast there (resolved across midnight, by when the meal happened)
    const d2 = '2026-10-10';
    const breakfast = meal(d2, 8, 500, 30);
    const fasts = resolveFasts({ planStart: plan.startDate, tz: TZ, asOf: localToInstant('2026-10-11', 4, TZ), entries: [breakfast], days: [{ date: d, planDay: 4, prescription: rx(d), status: null }, { date: d2, planDay: 5, prescription: rx(d2), status: null }] });
    const r2 = toLoggedDay(base(d, { prescription: rx(d), fasts }));
    expect(r2.loggedDay.items.find((i) => i.type === 'fast')!.credit).toBeCloseTo((12 - 12) / 12, 9);
    expect(r2.fast!.durationH).toBeCloseTo(12, 9);
    // the meal's entry time is not its occurrence: the same breakfast entered two days later ends the fast at the same hour
    const late = { ...breakfast, at: '2026-10-12T09:00:00.000Z', recordedAt: '2026-10-12T09:00:00.000Z' } as LogEntry;
    const again = resolveFasts({ planStart: plan.startDate, tz: TZ, asOf: localToInstant('2026-10-13', 4, TZ), entries: [late], days: [{ date: d, planDay: 4, prescription: rx(d), status: null }] });
    expect(again[0]!.achievedH).toBeCloseTo(12, 9);
  });

  it('unknown fast: kept for the replay only when E[c] ≥ 0.5', () => {
    expect(toLoggedDay(base('2026-10-09', { expected: () => 0.8 })).fast).not.toBeNull();
    expect(toLoggedDay(base('2026-10-09', { expected: () => 0.3 })).fast).toBeNull();
  });

  it('steps and sleep come only from what the person logged (Vitals reads no devices)', () => {
    const d = '2026-10-05';
    const r = toLoggedDay(base(d, { entries: [
      { id: 'st', date: d, tz: TZ, source: src, kind: 'steps', steps: 4500 } as LogEntry,
      { id: 'sl', date: d, tz: TZ, source: src, kind: 'sleep', bedAt: localToInstant('2026-10-04', 23.5, TZ), wakeAt: localToInstant(d, 6.5, TZ) } as LogEntry,
    ] }));
    expect(r.loggedDay.inputs.steps).toBe(4500);
    expect(r.score.items.find((i) => i.itemId === 'steps')!.why).toBe('4500 steps');
    expect(r.loggedDay.inputs.sleep).toMatchObject({ bedH: 23.5, wakeH: 6.5, hours: 7 });
  });

  it('a backfilled ("assumed") day replays as planned but is never scored nor counted as logged intake', () => {
    const r = toLoggedDay(base('2026-10-06', { status: { date: '2026-10-06', marks: { all: 'asPlanned' }, assumed: true } }));
    expect(r.assumedDay).toBe(true);
    expect(r.score.score).toBeNull();
    expect(r.intakeLogged).toBe(false);
    expect(r.loggedDay.inputs.energy).toEqual(TRAIN.energy);
    // legacy backfill is never measured completeness (C1/D5-01)
    expect(r.coverage.energy).toBe('asPlannedEstimate');
    expect(r.calibrationEligible).toBe(false);
  });

  it('illness and stress become engine modifiers; substances become engine inputs', () => {
    const d = '2026-10-05';
    const r = toLoggedDay(base(d, { entries: [
      { id: 'e1', date: d, tz: TZ, source: src, kind: 'event', event: 'illness' } as LogEntry,
      { id: 'e2', date: d, tz: TZ, source: src, kind: 'subjective', stress: 'high' } as LogEntry,
      { id: 'e3', date: d, tz: TZ, source: src, kind: 'substance', substance: 'caffeine', clockH: 8, amount: 200, unit: 'mg' } as LogEntry,
    ] }));
    expect(r.loggedDay.inputs.modifiers).toMatchObject({ illness: true, stress: 'high' });
    expect(r.loggedDay.inputs.substances?.caffeine).toEqual([{ clockH: 8, mg: 200, eventId: 'e3' }]);
  });
});

describe('session helpers', () => {
  it('scales doses by credit and derives engine sessions from a stimulus', () => {
    expect(scaleSession({ kind: 'cardio', modality: 'run', startH: 7, durationMin: 40 }, 0.5)).toMatchObject({ durationMin: 20 });
    expect(scaleSession({ kind: 'resistance', startH: 7, volume: 'moderate' }, 0.5)).toMatchObject({ volume: 'minimal' });
    expect(scaleSession({ kind: 'resistance', startH: 7, volume: 'moderate' }, 0)).toBeNull();
    const s = stimulusToEngineSessions(PRESCRIBED_STIM, 18);
    expect(s[0]).toMatchObject({ kind: 'resistance', setsByRegion: { quads: 6 }, loadPct1RM: 70 });
  });
});

describe('logs, provenance and burden', () => {
  it('edits supersede and retracts hide; tiers; AI-estimated energy share', () => {
    const d = '2026-10-05';
    const a = meal(d, 9, 500, 30);
    const b = { ...meal(d, 9, 450, 30), supersedes: a.id } as LogEntry;
    const c = { ...meal(d, 13, 800, 40), source: { by: 'ai' as const, method: 'aiPhoto' as const } } as LogEntry;
    const r = { id: 'r1', date: d, tz: TZ, source: src, kind: 'retract', target: c.id } as LogEntry;
    expect(effectiveEntries([a, b, c, r]).map((e) => e.id)).toEqual([b.id]);
    expect(aiEnergyShare([b, c])).toBeCloseTo(800 / 1250, 9);
    expect(tierOfEntry(b)).toBe('T2');
  });

  it('minimal mode after two weeks of < 3 T1+ days; welcome back after ≥ 2 missed days', () => {
    expect(burdenMonitor([], [], '2026-10-25', '2026-10-05').minimalMode).toBe(true);
    expect(burdenMonitor([], [], '2026-10-12', '2026-10-05').minimalMode).toBe(false);
    expect(lapseState('2026-10-10', '2026-10-13', '2026-10-05')).toEqual({ welcomeBack: true, gap: ['2026-10-11', '2026-10-12'] });
    expect(lapseState('2026-10-11', '2026-10-13', '2026-10-05').welcomeBack).toBe(false);
  });
});
