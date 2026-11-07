// @vitest-environment node
/**
 * End to end over the pure layers: start a plan from a scenario, freeze prescriptions, log three weeks the way people do
 * (taps, some meals, gaps, a skipped session, weigh-ins), build LoggedDays, replay the realised schedule, assimilate
 * daily, check in weekly (records + ConfirmedState), rebuild the state from the record, assemble Today, drift and a
 * re-plan request. A hidden energy-balance error drives the true weight; everything must be deterministic.
 */
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { runReplay } from '@/engine/assimilation';
import { mulberry32 } from '@/engine/core/math';
import {
  activateIfDue,
  addDays,
  adherenceTrend,
  biasOn,
  buildReplanRequest,
  buildTodayView,
  catalogueEquivalence,
  compositionReadingsFor,
  confirmedStateFromRecord,
  dailyAssimilation,
  driftGoal,
  expectedCreditFor,
  forecastBandOn,
  freezePrescription,
  intakeEvidenceOf,
  isCheckInDue,
  lapseState,
  localToInstant,
  pickReplan,
  projectLiving,
  projectionSchedule,
  realisedSchedule,
  revealedAdherence,
  startFromScenario,
  templateOfDay,
  toLoggedDay,
  weekdayOf,
  weeklyCheckIn,
  weighInsFor,
  type ConfirmedStateRecord,
  type CreditObservation,
  type DayStatusDoc,
  type LoggedDayResult,
  type LogEntry,
  type MeasurementEntry,
  type PlanVersionDoc,
} from '..';

const TZ = 'Europe/London';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 38, heightCm: 179, weightKg: 94 }, habits: { typicalSteps: 6500, sessionsPerWeek: 2 }, startDate: '2026-10-05' };
const TRAIN: DayTemplate = {
  id: 'A', label: 'training day', energy: { kind: 'pctMaintenance', pct: 80 },
  macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'g', value: 190 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } }, exercise: [{ kind: 'resistance', startH: 18, durationMin: 55, volume: 'moderate' }], steps: 9000,
};
const REST: DayTemplate = { ...TRAIN, id: 'B', label: 'rest day', energy: { kind: 'pctMaintenance', pct: 75 }, exercise: [], steps: 8000 };
const PATTERN = [0, 1, 0, 1, 0, 1, 1];
const SCENARIO: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 84, programs: [TRAIN, REST], days: Array.from({ length: 84 }, (_, d) => ({ program: PATTERN[d % 7]! })) };
const HIDDEN_DELTA = -200;

function pipeline() {
  const started = startFromScenario(
    { planId: 'plan-1', now: '2026-10-01T09:00:00.000Z', today: '2026-10-01', createdBy: { kind: 'user' }, versions: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' } },
    { id: 'sc1', rev: '3', name: 'My scenario', schedule: SCENARIO },
    MAN,
    [{ metric: 'scaleWeight', direction: 'target', target: -6, targetKind: 'change' }],
    { startDate: '2026-10-05', startValues: new Map([[0, 94]]) },
  );
  if (!started.ok) throw new Error(started.reason);
  expect(started.plan.status).toBe('scheduled');
  const activated = activateIfDue(started.plan, '2026-10-05');
  if (!activated.ok) throw new Error(activated.reason);
  const plan = { ...activated.plan, id: started.plan.id };
  // forecast digest from the nominal plan replay (± 0.8 kg band), as the start command would store it
  const nominal = runReplay({ profile: plan.baselineProfile, schedule: started.version.schedule });
  const p50 = Array.from(nominal.scaleWakeKg);
  const version: PlanVersionDoc = { ...started.version, forecast: { ...started.version.forecast, asPrescribed: { scaleWeight: { p10: p50.map((x) => x - 0.8), p50, p90: p50.map((x) => x + 0.8) } } } };

  // ---- the person: hidden δ; logs for days 0..20
  const truth = runReplay({ profile: MAN, schedule: SCENARIO, intakeOffsets: [{ fromDay: 0, kcal: HIDDEN_DELTA }] });
  const rnd = mulberry32(7);
  const z = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const measurements: MeasurementEntry[] = [];
  const entries: LogEntry[] = [];
  const status = new Map<string, DayStatusDoc>();
  for (let d = 0; d < 21; d++) {
    const date = addDays(plan.startDate, d);
    if (rnd() < 0.85) measurements.push({ id: `w${d}`, date, metric: 'weightKg', value: Math.round((truth.scaleWakeKg[d]! + 0.45 * z()) * 10) / 10, context: 'morningFasted', source: { by: 'user', method: 'typed' } });
    if (d === 9) {
      status.set(date, { date, marks: { food: 'asPlanned' } });
      entries.push({ id: `s${d}`, date, tz: TZ, source: { by: 'user', method: 'typed' }, kind: 'session', status: 'skipped', itemId: `rtSession:${d}:0`, performed: [], stimulus: { effectiveSetsByRegion: {}, pattern: 'squat', loadClass: 'moderate', netKcal: 0, mem: 0, hiMinutes: 0, mobilityMinutes: {} }, catalogueVersion: 'c' } as LogEntry);
    } else if (d % 5 === 3) {
      // a gap day: nothing logged
    } else if (d % 4 === 1) {
      for (const [h, k] of [[8.5, 550], [13, 700], [19, 650]] as const) {
        entries.push({ id: `m${d}-${h}`, date, tz: TZ, at: localToInstant(date, h, TZ), source: { by: 'ai', method: 'aiText' }, kind: 'meal', clockH: h, complete: h === 19, components: [], totals: { energyKcal: { value: k, sd: 0.25 * k }, proteinG: { value: 45, sd: 10 }, carbG: { value: 60, sd: 15 }, fatG: { value: 20, sd: 6 }, fibreG: { value: 8, sd: 2 } } } as LogEntry);
      }
    } else {
      status.set(date, { date, marks: { all: 'asPlanned' } });
    }
  }

  // ---- LoggedDays with revealed adherence from the days before
  const results: LoggedDayResult[] = [];
  const credits: CreditObservation[] = [];
  const recordsOut: ConfirmedStateRecord[] = [];
  for (let d = 0; d < 21; d++) {
    const date = addDays(plan.startDate, d);
    const blocks = revealedAdherence(credits, addDays(date, -1));
    const rx = freezePrescription({ plan, version, date, tz: TZ });
    const r = toLoggedDay({
      date, planStart: plan.startDate, tz: TZ, prescription: rx, entries: entries.filter((e) => e.date === date), status: status.get(date) ?? null,
      expected: (t, wd) => expectedCreditFor(blocks, t, wd), equivalence: catalogueEquivalence, final: true,
    });
    results.push(r);
    for (const o of r.loggedDay.items) if (o.credit !== null) credits.push({ date, type: o.type, credit: o.credit });
  }
  const weighIns = weighInsFor(plan, measurements, entries);
  // the balance estimate's exposure gate: only complete quantitative or confirmed-zero days (C1/D5-01)
  const intakeDays = results.map((r, d) => (r.calibrationEligible ? d : -1)).filter((d) => d >= 0);

  // ---- weekly check-ins on days 14 and 21 (Mondays)
  for (const day of [14, 21]) {
    const today = addDays(plan.startDate, day);
    const schedule = realisedSchedule(plan, version, results.slice(0, day), today);
    const ci = weeklyCheckIn({ plan, schedule, records: recordsOut, weighIns: weighIns.filter((w) => w.day <= day), today, intakeDays });
    if (ci.record) recordsOut.push(ci.record);
  }
  return { plan, version, truth, results, credits, recordsOut, weighIns, intakeDays, measurements, entries, status };
}

const run = pipeline();

describe('living plan end to end', () => {
  it('scores logged days, leaves gap days unscored, and counts the skipped session', () => {
    const scores = run.results.map((r) => r.score.score);
    expect(scores.filter((s) => s === null).length).toBeGreaterThanOrEqual(3); // gap days
    expect(scores[9]!).toBeLessThan(100);
    expect(scores[9]!).toBeGreaterThan(50);
    for (const r of run.results) if (r.score.score !== null) expect(r.score.score).toBeLessThanOrEqual(100);
    const t = adherenceTrend(run.results.map((r) => ({ date: r.loggedDay.date, score: r.score.score, final: true, logged: r.score.coverage > 0 })), '2026-10-25');
    expect(t.a7).not.toBeNull();
    expect(t.daysLogged7).toBeGreaterThanOrEqual(5);
  });

  it('produces two confirmed records whose trend tracks the true weight and whose δ points the right way', () => {
    expect(run.recordsOut.map((r) => r.anchorDay)).toEqual([14, 21]);
    for (const r of run.recordsOut) {
      const truthTissue = run.truth.tissueWakeKg[r.anchorDay]!;
      expect(Math.abs(r.trendWeight.kg - truthTissue)).toBeLessThan(2 * r.trendWeight.sd + 0.1);
      expect(r.inputsHash).toMatch(/^[0-9a-f]{16}$/);
      expect(r.residualSplit.source).toBe('engine');
      // D5-02: the stored trend is the water-adjusted estimate (tagged), the raw scale trend is kept beside it
      expect(r.trendWeightOperator).toBe('waterAdjustedWake');
      expect(r.rawScale!.kg).not.toBeCloseTo(r.trendWeight.kg, 1);
      expect(r.stamp?.contracts).toMatch(/^[0-9a-f]{16}$/);
    }
    // partial meal days, as-planned taps and gaps are never exposure-calibration days (no day here is reported complete)
    expect(run.intakeDays).toEqual([]);
    expect(biasOn(run.recordsOut, 21).mean).toBeLessThanOrEqual(0);
  });

  it('rebuilds the confirmed state from the stored record bit for bit (only records sync, never snapshots)', () => {
    const today = addDays(run.plan.startDate, 21);
    const schedule = realisedSchedule(run.plan, run.version, run.results.slice(0, 21), today);
    const again = weeklyCheckIn({ plan: run.plan, schedule, records: run.recordsOut.slice(0, 1), weighIns: run.weighIns, today, intakeDays: run.intakeDays });
    const rebuilt = confirmedStateFromRecord(run.plan, schedule, run.recordsOut, run.recordsOut[1]!);
    expect(Array.from(rebuilt.snapshot.bus)).toEqual(Array.from(again.state!.snapshot.bus));
    expect(again.record).toEqual(run.recordsOut[1]);
  });

  it('daily assimilation reuses the cached anchor snapshot and equals a full replay', () => {
    const today = addDays(run.plan.startDate, 22);
    const past = [...run.results];
    const blocks = revealedAdherence(run.credits, addDays(today, -1));
    const rx = freezePrescription({ plan: run.plan, version: run.version, date: addDays(run.plan.startDate, 21), tz: TZ });
    past.push(toLoggedDay({ date: rx.planDay === 21 ? addDays(run.plan.startDate, 21) : '', planStart: run.plan.startDate, tz: TZ, prescription: rx, entries: [], expected: (t, wd) => expectedCreditFor(blocks, t, wd), final: true }));
    const schedule = realisedSchedule(run.plan, run.version, past, today);
    const r21 = run.recordsOut[1]!;
    const state = confirmedStateFromRecord(run.plan, schedule, run.recordsOut, r21);
    const cached = dailyAssimilation({ plan: run.plan, schedule, records: run.recordsOut, weighIns: run.weighIns, today, cached: { anchorDay: 21, inputsHash: r21.inputsHash, snapshot: state.snapshot } });
    const full = dailyAssimilation({ plan: run.plan, schedule, records: run.recordsOut, weighIns: run.weighIns, today });
    expect(cached.usedCache).toBe(true);
    expect(full.usedCache).toBe(false);
    for (let d = 21; d < 84; d++) expect(cached.replay.scaleWakeKg[d]).toBe(full.replay.scaleWakeKg[d]);
    expect(cached.trendToday).toEqual(full.trendToday);
    // a changed past invalidates the cache (hash mismatch)
    const stale = dailyAssimilation({ plan: run.plan, schedule, records: run.recordsOut, weighIns: run.weighIns, today, cached: { anchorDay: 21, inputsHash: 'deadbeefdeadbeef', snapshot: state.snapshot } });
    expect(stale.usedCache).toBe(false);
  });

  it('assembles Today (contract), drift against the band, and a re-plan request from the confirmed state', () => {
    const today = addDays(run.plan.startDate, 21);
    expect(weekdayOf(today)).toBe(run.plan.policy.checkInWeekday);
    expect(isCheckInDue(run.plan, today, null)).toBe(true);
    expect(isCheckInDue(run.plan, today, today)).toBe(false);
    const rx = freezePrescription({ plan: run.plan, version: run.version, date: today, tz: TZ });
    const blocks = revealedAdherence(run.credits, addDays(today, -1));
    const so = toLoggedDay({ date: today, planStart: run.plan.startDate, tz: TZ, prescription: rx, entries: [], expected: (t, wd) => expectedCreditFor(blocks, t, wd), final: false });
    const rec = run.recordsOut[1]!;
    const band = forecastBandOn(run.version, 21)!;
    expect(band.p10).toBeLessThan(band.p90);
    const drift = driftGoal({ goal: 0, metric: 'scaleWeight', target: 88, better: 'down', trend: { value: rec.trendWeight.kg, sd: rec.trendWeight.sd }, band, previous: [] });
    const view = buildTodayView({
      date: today, tz: TZ, rolloverH: 4, quietMode: false, minimalMode: false, now: localToInstant(today, 9, TZ), plan: run.plan, version: run.version,
      prescription: rx, entries: [], measurements: run.measurements.filter((m) => m.date === today), status: null, logged: so,
      trend: adherenceTrend(run.results.map((r) => ({ date: r.loggedDay.date, score: r.score.score, final: true, logged: r.score.coverage > 0 })), addDays(today, -1)),
      drift: { asOf: today, goals: [drift] }, trendWeight: rec.trendWeight, forecastToday: band, checkIn: { due: false, lastAt: today },
      lapse: lapseState(addDays(today, -1), today, run.plan.startDate),
    });
    expect(view.mode).toBe('living');
    expect(view.plan).toMatchObject({ id: 'plan-1', day: 22, of: 84, status: 'active', version: 1 });
    expect(view.remaining!.energyKcal).toBeCloseTo(rx.energyKcal, 6);
    expect(view.checklist[0]!.command.id).toBe('log.measurement');
    expect(view.checklist.some((c) => c.kind === 'session' && c.command.id === 'log.session')).toBe(true);
    expect(view.adherence.today!.final).toBe(false);
    expect(view.trendWeight!.todayExpected).toEqual(band);
    expect(view.drift![0]!.state).toBe('onTrack');
    expect(JSON.stringify(view)).not.toMatch(/§|R11|SUITE_SPEC|PLANNER_V2/);
    // Vitals reads no devices: sleep and steps rows are done only once the person logs them
    expect(view.checklist.find((c) => c.kind === 'sleep')).toMatchObject({ done: false });
    const quiet = buildTodayView({ ...{ date: today, tz: TZ, rolloverH: 4, minimalMode: true, now: localToInstant(today, 9, TZ), plan: run.plan, version: run.version, prescription: rx, entries: [], measurements: [], status: null, logged: so, trend: adherenceTrend([], today), drift: null, trendWeight: null, forecastToday: null, checkIn: { due: true, lastAt: null }, lapse: { welcomeBack: false, gap: [] } }, quietMode: true });
    expect(quiet.remaining).toBeNull();
    expect(quiet.adherence.today).toBeNull();
    expect(quiet.checklist.map((c) => c.kind)).toEqual(['weigh', 'mark']);
    expect(quiet.notices.map((n) => n.kind)).toEqual(expect.arrayContaining(['checkIn', 'burden']));

    const state = confirmedStateFromRecord(run.plan, realisedSchedule(run.plan, run.version, run.results, today), run.recordsOut, rec);
    const decision = pickReplan({ today, closedDay: null, checkInConfirmed: true, declared: [], recent: [], a7: 90, scored7: 5, outOfBandDays: 0, requestChanged: false, safetyBindsInDays: null })!;
    const req = buildReplanRequest({ decision, today, plan: run.plan, head: run.version, state, logs: run.results.map((r) => r.loggedDay), adherence: revealedAdherence(run.credits, today) });
    expect(req.kind).toBe('weekly');
    expect(req.logs.every((l) => l.date >= state.anchorDate && l.date < today)).toBe(true);
    expect(req.plan.request.goals[0]).toMatchObject({ target: 88, targetKind: 'absolute' });
    expect(req.state.snapshot.day).toBe(21);
  });

  it('is deterministic end to end', () => {
    const again = pipeline();
    expect(again.recordsOut).toEqual(run.recordsOut);
    expect(again.results.map((r) => r.score)).toEqual(run.results.map((r) => r.score));
  });
});

describe('drift on matched observation operators (D5-02)', () => {
  it('weigh-ins exactly on the scale forecast (labile water included) stay on track: water is never read as tissue drift', () => {
    const plan = run.plan;
    const nominal = runReplay({ profile: plan.baselineProfile, schedule: run.version.schedule });
    const measurements: MeasurementEntry[] = Array.from({ length: 21 }, (_, d) => ({ id: `n${d}`, date: addDays(plan.startDate, d), metric: 'weightKg' as const, value: nominal.scaleWakeKg[d]!, context: 'morningFasted' as const, source: { by: 'user' as const, method: 'typed' as const } }));
    const dayStatus: DayStatusDoc[] = Array.from({ length: 21 }, (_, d) => ({ date: addDays(plan.startDate, d), marks: { all: 'asPlanned' as const } }));
    const today = addDays(plan.startDate, 21);
    const p = projectLiving({ docs: { plan, versions: [run.version], dayStatus, entries: [], measurements, records: [] }, today, tz: TZ, now: localToInstant(today, 10, TZ) });
    const band = forecastBandOn(run.version, 21)!;
    const scale = p.assimilation!.scaleToday!.kg;
    const waterAdjusted = p.assimilation!.trendToday!.kg;
    expect(scale).toBeGreaterThan(band.p10);
    expect(scale).toBeLessThan(band.p90);
    // the water-adjusted estimate is a different observable (scale minus model labile water), never this band's
    expect(Math.abs(scale - waterAdjusted)).toBeGreaterThan(0.3);
    expect(p.drift!.goals[0]!.state).toBe('onTrack');
    // without a confirmed check-in the state is not yet a decision: unclear, never a claim of being on track
    expect(p.drift!.goals[0]!.certainty).toBe('unclear');
  });
});

describe('living projection (what today.get / plan.adherence / plan.drift return)', () => {
  const docs = () => ({ plan: run.plan, versions: [run.version], dayStatus: [...run.status.values()], entries: run.entries, measurements: run.measurements, records: run.recordsOut });

  it('projects every plan day to today, the trend, assimilation, drift and Today from documents alone', () => {
    const today = addDays(run.plan.startDate, 22);
    const p = projectLiving({ docs: docs(), today, tz: TZ, now: localToInstant(today, 10, TZ) });
    expect(p.days).toHaveLength(23);
    expect(p.days.slice(0, 21).map((d) => d.result.score.score)).toEqual(run.results.map((r) => r.score.score));
    expect(p.days[22]!.result.score.final).toBe(false);
    expect(p.trend.a7).not.toBeNull();
    expect(p.assimilation!.trendToday!.kg).toBeGreaterThan(85);
    expect(p.drift!.goals[0]!.metric).toBe('scaleWeight');
    expect(p.lastCheckIn).toBe(addDays(run.plan.startDate, 21));
    expect(p.checkInDue).toBe(false);
    expect(p.today.plan!.day).toBe(23);
    expect(p.today.trendWeight!.todayExpected.p50).toBeGreaterThan(80);
    expect(p.today.drift).toHaveLength(1);
    // D5-02: the drift compares the scale trend with the scale band (one operator), no causal shares
    const g = p.drift!.goals[0]!;
    expect(g.operator).toBe('scaleWake');
    expect(g.causes).toEqual([]);
    expect(g.trend.value).toBe(p.assimilation!.scaleToday!.kg);
    expect(g.decisionIds).toHaveLength(run.recordsOut.length);
    expect(p.today.trendWeight!.kg).toBe(p.assimilation!.scaleToday!.kg);
    // deterministic
    expect(JSON.stringify(projectLiving({ docs: docs(), today, tz: TZ, now: localToInstant(today, 10, TZ) }).today)).toBe(JSON.stringify(p.today));
  });

  it('frozen prescriptions in dayStatus win over the version (re-plans never rewrite the past)', () => {
    const today = addDays(run.plan.startDate, 5);
    const d2 = addDays(run.plan.startDate, 2);
    const base = projectLiving({ docs: docs(), today, tz: TZ, now: localToInstant(today, 10, TZ), skipAssimilation: true });
    const rx = { ...base.days[2]!.prescription, energyKcal: 1234 };
    const p = projectLiving({ docs: { ...docs(), dayStatus: [...docs().dayStatus.filter((s) => s.date !== d2), { date: d2, prescribed: rx }] }, today, tz: TZ, now: localToInstant(today, 10, TZ), skipAssimilation: true });
    expect(p.days[2]!.frozen).toBe(true);
    expect(p.days[2]!.prescription.energyKcal).toBe(1234);
  });

  it('before the start or without a plan: planning mode, no prescription', () => {
    const p = projectLiving({ docs: { ...docs(), plan: null }, today: '2026-10-20', tz: TZ, now: '2026-10-20T09:00:00.000Z' });
    expect(p.today.mode).toBe('planning');
    expect(p.today.prescription).toBeNull();
    const early = projectLiving({ docs: { ...docs(), plan: { ...run.plan, status: 'scheduled' } }, today: '2026-10-03', tz: TZ, now: '2026-10-03T09:00:00.000Z' });
    expect(early.today.notices[0]!.text).toMatch(/starts on 2026-10-05/);
  });
});

// ------------------------------------------------------------------------------------------- W1 consumer round trips
/** Deep-freeze a document tree: a read adapter that rewrote a stored document would throw (ES modules are strict). */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x);
  }
  return v;
}

describe('W1: consumer round trips, legacy reads and idempotence (C1–C7)', () => {
  const start = run.plan.startDate;
  const src = { by: 'user' as const, method: 'typed' as const };
  const checkInAt = (day: number, extra: Partial<Parameters<typeof weeklyCheckIn>[0]> = {}, records: ConfirmedStateRecord[] = []) => {
    const today = addDays(start, day);
    const schedule = realisedSchedule(run.plan, run.version, run.results.slice(0, day), today);
    return weeklyCheckIn({ plan: run.plan, schedule, records, weighIns: run.weighIns.filter((w) => w.day <= day), today, intakeDays: run.intakeDays, ...extra });
  };

  it('D6-06: the day reduction’s intake evidence reaches the check-in; the δ gate counts the same eligible days', () => {
    const ev = intakeEvidenceOf(run.results.map((result, planDay) => ({ planDay, result })));
    expect(ev).toHaveLength(21);
    expect(ev.filter((e) => e.calibrationEligible).map((e) => e.day)).toEqual(run.intakeDays);
    // meals logged as totals only: their amount method is unknown (a number is never assumed weighed)
    expect(ev[1]!.amountMethods).toEqual({ unknown: 3 });
    const plain = checkInAt(14);
    const withEvidence = checkInAt(14, { intakeEvidence: ev.filter((e) => e.day < 14) });
    expect(withEvidence.record!.energyBiasKcal).toEqual(plain.record!.energyBiasKcal);
    expect(withEvidence.output.intakeEvidence!.interpretation).toBe('netResidual');
    expect(withEvidence.output.intakeEvidence!.byCoverage.partial).toBeGreaterThan(0);
  });

  it('D5-07: a scan is used once at its own day, a later decision skips it as consumed; a legacy reading stays method unknown', () => {
    const dxa: MeasurementEntry = { id: 'dxa1', date: addDays(start, 12), metric: 'bodyFatPct', value: 27, method: 'dxa', scanMassKg: 91.5, device: 'clinic-dxa', source: src };
    const legacy: MeasurementEntry = { id: 'bf-old', date: addDays(start, 11), metric: 'bodyFatPct', value: 30, source: src };
    const measurements = deepFreeze([...run.measurements, dxa, legacy]);
    const composition = compositionReadingsFor(run.plan, measurements)!;
    expect(composition.readings!.map((r) => [r.observationId, r.day, r.method, r.scanMassKg ?? null])).toEqual([['bf-old', 11, 'unknown', null], ['dxa1', 12, 'dxa', 91.5]]);
    const first = checkInAt(14, { composition });
    expect(first.output.composition!.consumedObservationIds).toContain('dxa1');
    expect(first.record!.consumedObservationIds).toContain('dxa1');
    expect(first.output.composition!.skipped.find((x) => x.observationId === 'bf-old')?.reason).toBe('methodUnknown');
    // idempotent: the same documents give the same decision
    expect(checkInAt(14, { composition }).record).toEqual(first.record);
    // the next decision does not use the same revision again
    const second = checkInAt(21, { composition }, [first.record!]);
    expect(second.output.composition?.consumedObservationIds ?? []).not.toContain('dxa1');
    // each record keeps what its own decision consumed; the earlier records' ids travel with every later request
    expect(second.record!.consumedObservationIds ?? []).not.toContain('dxa1');
  });

  it('C7: a document seen twice (sync echo, repeated import) changes nothing: same history hash and day results', () => {
    const today = addDays(start, 22);
    const docs = { plan: run.plan, versions: [run.version], dayStatus: [...run.status.values()], entries: run.entries, measurements: run.measurements, records: run.recordsOut };
    const a = projectLiving({ docs, today, tz: TZ, now: localToInstant(today, 10, TZ), skipAssimilation: true });
    const b = projectLiving({ docs: { ...docs, entries: [...run.entries, ...run.entries], measurements: [...run.measurements, ...run.measurements] }, today, tz: TZ, now: localToInstant(today, 10, TZ), skipAssimilation: true });
    expect(b.history!.contentHash).toBe(a.history!.contentHash);
    expect(JSON.stringify(b.days.map((d) => d.result))).toBe(JSON.stringify(a.days.map((d) => d.result)));
  });

  it('C1/C7: legacy documents are read through adapters and never rewritten; today’s logged night initialises today only (D8-06)', () => {
    const today = addDays(start, 22);
    const night: LogEntry = { id: 'sl22', date: today, tz: TZ, source: src, kind: 'sleep', bedAt: localToInstant(addDays(start, 21), 23.5, TZ), wakeAt: localToInstant(today, 5, TZ) } as LogEntry;
    const docs = deepFreeze({ plan: run.plan, versions: [run.version], dayStatus: [...run.status.values()], entries: [...run.entries, night], measurements: run.measurements, records: run.recordsOut });
    const p = projectLiving({ docs, today, tz: TZ, now: localToInstant(today, 10, TZ), skipAssimilation: true });
    expect(p.days[22]!.result.sleep!.hours).toBeCloseTo(5.5, 6);
    const s = projectionSchedule(p, today)!;
    expect(templateOfDay(s, 22).sleep?.hours).toBeCloseTo(5.5, 6);
    expect(templateOfDay(s, 23)).toEqual(templateOfDay(run.version.schedule, 23));
  });
});
