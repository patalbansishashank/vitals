// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import type { ClinicalNutritionEnvelope } from '@/lib/bodyContracts';
import { renalSafetyFlags, resolveRenalScope } from '@/lib/renalScope';
import { compileSchedule } from '@/engine/core/compileSchedule';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { realisticSchedule } from '@/engine/planner/domain/sensitivities';
import { addDays } from '../dates';
import { applyBehaviorPath, ensembleOutcome, opportunitiesOf, physicalBehaviorSchedule, sampleBehaviorPaths } from '../behaviorPaths';
import { calendarEnergyAvailability, dailyEa, repeatedCalendarEaReview, type EaLedgerDay } from '../energyAvailability';
import { bpEpisodes, monitorGoals } from '../monitoring';
import { currentProfileSafety } from '../lifecycleSafety';
import { DEFAULT_ITEM_WEIGHTS } from '../prescription';
import { projectLiving } from '../projection';
import type { LogEntry, MeasurementEntry, PlanDoc, PlanVersionDoc } from '../types';

const START = '2026-09-28';
const PERSON: PersonProfile = { schemaVersion: 1, body: { sex: 'female', ageYears: 45, heightCm: 165, weightKg: 70 }, startDate: START };
const rp = resolveProfile(PERSON);
const macros: DayTemplate['macros'] = { protein: { unit: 'g', value: 120 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } };
const day: DayTemplate = { id: 'a', label: 'a', energy: { kind: 'kcal', kcal: 1050 }, macros, meals: { count: 3, window: { startH: 8, lengthH: 12 } }, exercise: [{ kind: 'cardio', modality: 'cycle', startH: 17, durationMin: 60, phases: [{ kind: 'work', durationMin: 40, met: 8 }, { kind: 'recovery', durationMin: 20, met: 3 }] }] };
const schedule = (template = day): Schedule => ({ schemaVersion: 1, startDate: START, horizonDays: 28, programs: [template], days: Array.from({ length: 28 }, () => ({ program: 0 })), events: [{ kind: 'fast', startDay: 3, startH: 18, durationH: 24 }] });
const source = { by: 'user' as const, method: 'typed' as const };
const ledger = (n: number): EaLedgerDay[] => Array.from({ length: n }, (_, i) => ({ date: addDays(START, i), eiKcal: 1050, eiCoverage: 'complete', eeeNetKcal: 0, exerciseCoverage: 'complete', exerciseScope: 'coveredSessions', ffmKg: 50, ffmBasis: 'model', fastDay: false }));
const measured = (id: string, value: number, extra: Partial<MeasurementEntry> = {}): MeasurementEntry => ({ id, value, date: START, metric: 'waistCm', source, ...extra });
const monitored = (ms: MeasurementEntry[], metric: 'waist' | 'bhb' | 'bodyFatPct' | 'glucose' = 'waist') => monitorGoals({ startDate: START, request: { profile: PERSON, goals: [{ metric, direction: 'minimise' }], horizonDays: 28 } }, ms, addDays(START, 28))[0]!;

function docs() {
  const plan: PlanDoc & { id: string } = { id: 'p', name: 'p', rung: 'custom', origin: { kind: 'scenario', scenarioId: 's', scenarioRev: '1' }, status: 'active', startDate: START, plannedEndDate: addDays(START, 28), request: { profile: PERSON, goals: [], horizonDays: 28 }, baselineProfile: PERSON, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: `${START}T08:00:00Z` };
  const version: PlanVersionDoc = { planId: 'p', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: schedule(), genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} }, forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [], provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${START}T08:00:00Z` };
  const entries: LogEntry[] = Array.from({ length: 28 }, (_, i) => [{ id: `meal${i}`, date: addDays(START, i), tz: 'UTC', kind: 'meal', clockH: 13, components: [], totals: { energyKcal: { value: 1050, sd: 0 }, proteinG: { value: 120, sd: 0 }, carbG: { value: 80, sd: 0 }, fatG: { value: 27, sd: 0 } }, source }, { id: `skip${i}`, date: addDays(START, i), tz: 'UTC', kind: 'session', slotKey: 's1', status: 'skipped', source }] as LogEntry[]).flat();
  return { plan, versions: [version], entries, measurements: [], records: [], dayStatus: Array.from({ length: 28 }, (_, i) => ({ date: addDays(START, i), intake: 'complete' as const })) };
}

describe('A2-019 physical behavior scenarios', () => {
  it('utility-only posterior changes cannot alter production physical schedules; missing evidence preserves full prescribed dose', () => {
    const s = schedule();
    const a = realisticSchedule(s, 2, [], rp);
    const b = realisticSchedule(s, 2, [{ type: 'cardioSession', a: 1, b: 100, opportunities: 20 }], rp);
    expect(a).toEqual(s);
    expect(b).toEqual(a);
    expect(physicalBehaviorSchedule(s, rp, 2, 28, 'asPrescribed')).toEqual(s);
    const missing = physicalBehaviorSchedule(s, rp, 2, 28, 'missingData');
    expect(missing.days.slice(0, 2)).toEqual(s.days.slice(0, 2));
    expect(missing.days[2]!.override!.exercise).toEqual([]);
    expect(missing.days[2]!.override!.energy).toEqual({ kind: 'kcal', kcal: rp.tdee0Kcal });
    expect(missing.events).toEqual([]);
  });
  it('omitted crossing fasts preserve realised past but cannot mask restored future intake; finite windows preserve suffix', () => {
    const s = { ...schedule({ ...day, energy: { kind: 'zero' } }), events: [{ kind: 'fast' as const, startDay: 0, startH: 18, durationH: 120, refeed: 'auto' as const, refeedFactors: [0.5, 0.75] }] };
    const original = JSON.stringify(s);
    const prescribed = compileSchedule(s, rp);
    const omitted = physicalBehaviorSchedule(s, rp, 2, 28, 'missingData');
    expect(omitted.events).toEqual([{ ...s.events[0], durationH: 30, refeed: 'none', refeedFactors: undefined }]);
    const compiled = compileSchedule(omitted, rp);
    expect(compiled.days.slice(0, 2).map((d) => d.fastHours)).toEqual(prescribed.days.slice(0, 2).map((d) => d.fastHours));
    expect(compiled.days[2]!.fastHours).toBe(0);
    expect(compiled.days[2]!.zeroIntake).toBe(false);
    expect(compiled.days[2]!.energyKcal).toBeCloseTo(rp.tdee0Kcal, 6);
    const finite = physicalBehaviorSchedule({ ...s, programs: [day] }, rp, 2, 4, 'missingData');
    expect(finite.events!.map((e) => [e.startDay * 24 + e.startH, e.startDay * 24 + e.startH + e.durationH])).toEqual([[18, 48], [96, 138]]);
    const cf = compileSchedule(finite, rp);
    expect(cf.days[2]!.fastHours).toBe(0);
    expect(cf.days[3]!.fastHours).toBe(0);
    expect(cf.days[4]!.fastHours).toBeGreaterThan(0);
    expect(cf.days[4]!.energyKcal).toBe(0);
    expect(JSON.stringify(s)).toBe(original);
  });
  it('partial fasts remain distinct from skipping, including zero-intake templates; explicit continuation is required', () => {
    const s = schedule({ ...day, energy: { kind: 'zero' } });
    expect(opportunitiesOf(s, 0).some((o) => o.type === 'fast' && o.day === 0)).toBe(true);
    const p = { index: 0, seed: 1, outcomes: { '3:fast': 'partial' as const }, assumptions: ['partial18h'] };
    expect(() => applyBehaviorPath(s, p, 2)).toThrow(/continuation/);
    const partial = applyBehaviorPath(s, p, 2, { partialFastH: 18, intakeContinuation: day });
    const skipped = applyBehaviorPath(s, { ...p, outcomes: { '3:fast': 'skipped' } }, 2, { intakeContinuation: day });
    expect(partial.events![0]!.durationH).toBe(18);
    expect(skipped.events).toEqual([]);
    expect(partial.days[3]!.override!.energy).toEqual(day.energy);
    expect(skipped.days[3]!.override!.energy).toEqual(day.energy);
    expect(partial.days.slice(0, 2)).toEqual(s.days.slice(0, 2));
  });
  it('partial sessions scale interval phases and grouped sets coherently', () => {
    const s = schedule({ ...day, exercise: [...day.exercise!, { kind: 'resistance', startH: 18, durationMin: 40, groups: [{ regionWeights: { quads: 1 }, contraction: 'dynamic', sets: 6, reps: 8, loadPct1RM: 70, durationMin: 40 }] }] });
    const x = applyBehaviorPath(s, { index: 0, seed: 1, outcomes: { '3:cardioSession': 'partial', '3:rtSession': 'partial' }, assumptions: [] }, 2).days[3]!.override!.exercise!;
    expect(x[0]!.durationMin).toBe(30);
    expect(x[0]!.kind === 'cardio' && x[0]!.phases!.reduce((v, p) => v + p.durationMin, 0)).toBe(30);
    expect(x[1]!.kind === 'resistance' && x[1]!.groups![0]!.sets).toBe(3);
  });
  it('path seeds share cluster draws across compared schedules and ensemble summaries retain finite absence sidecars', () => {
    const input = { scenario: 'plausibleExecution' as const, probabilities: () => ({ done: 0.3, partial: 0.2, skipped: 0.5, basis: 'scenarioAssumption' as const, effectiveDays: 0 }), planId: 'p', version: 3, paths: 8 };
    const a = sampleBehaviorPaths({ ...input, opportunities: [{ day: 3, type: 'fast' }] });
    const b = sampleBehaviorPaths({ ...input, opportunities: [{ day: 1, type: 'rtSession' }, { day: 3, type: 'fast' }, { day: 3, type: 'fast' }] });
    expect(a.map((p) => p.outcomes['3:fast'])).toEqual(b.map((p) => p.outcomes['3:fast']));
    const result = ensembleOutcome(a, (p) => [p.outcomes['3:fast'] === 'done' ? 100 : 0, NaN], 'plausibleExecution');
    expect(result.mean[0]).toBe(a.filter((p) => p.outcomes['3:fast'] === 'done').length / a.length * 100);
    expect(result.available).toEqual([true, false]);
    expect(result.contributors).toEqual([8, 0]);
    expect(result.mean.every(Number.isFinite)).toBe(true);
  });
});

describe('A2-020/A2-022 independent calendar coverage and repeated policy', () => {
  it('first full eligible window ends day6 and review starts only at day20 (>14)', () => {
    expect(repeatedCalendarEaReview(ledger(1), START).needed).toBe(false);
    expect(repeatedCalendarEaReview(ledger(20), addDays(START, 19))).toMatchObject({ needed: false, consecutiveEligibleWindows: 14 });
    expect(repeatedCalendarEaReview(ledger(21), addDays(START, 20))).toMatchObject({ needed: true, consecutiveEligibleWindows: 15, reasonCodes: ['repeatedCalendarEaBelowReference'] });
  });
  it('any earlier unknown window breaks persistence even after current7 becomes covered', () => {
    const xs = ledger(28); xs[15]!.exerciseCoverage = 'unknown';
    expect(repeatedCalendarEaReview(xs, addDays(START, 27))).toMatchObject({ needed: false, consecutiveEligibleWindows: 6 });
    expect(calendarEnergyAvailability(xs, addDays(START, 27), 7).covered).toBe(7);
    xs[27]!.eiCoverage = 'partial';
    expect(repeatedCalendarEaReview(xs, addDays(START, 27)).consecutiveEligibleWindows).toBe(0);
    expect(repeatedCalendarEaReview(xs.filter((_, i) => i !== 15), addDays(START, 27)).needed).toBe(false);
  });
  it('known bout sums alone do not certify exercise; lower bounds need covered or finite-bounded subtraction', () => {
    const d = { ...ledger(1)[0]!, exerciseCoverage: undefined };
    expect(dailyEa(d)).toBeNull();
    expect(calendarEnergyAvailability([d], START, 7).ea.reasonCode).toBe('exerciseIncomplete');
    const partial = { ...d, eiCoverage: 'partial' as const, eiKcal: 600 };
    expect(calendarEnergyAvailability([partial], START, 7).lowerBound).toBeUndefined();
    expect(calendarEnergyAvailability([{ ...partial, exerciseUpperBoundKcal: 200 }], START, 7).lowerBound).toBe(8);
    expect(dailyEa({ ...d, exerciseCoverage: 'complete', eeeNetKcal: 1500 })).toBe(-9);
  });
  it.each(['unknown', undefined] as const)('complete exercise with %s scope is not supported actual exposure or persistence', (scope) => {
    const xs = ledger(28).map((d) => ({ ...d, exerciseCoverage: 'complete' as const, exerciseScope: scope, ffmBasis: 'measured' as const }));
    expect(dailyEa(xs[0]!)).toBeNull();
    const summary = calendarEnergyAvailability(xs, addDays(START, 27), 7);
    expect(summary.ea.value).toBeUndefined();
    expect(summary.ea.status).toBe('partial');
    expect(summary.ea.reasonCode).toBe('exerciseIncomplete');
    expect(summary.exerciseCoveredDays).toBe(0);
    expect(summary.covered).toBe(0);
    expect(summary.exerciseScopes).toEqual(['unknown']);
    expect(repeatedCalendarEaReview(xs, addDays(START, 27))).toMatchObject({ needed: false, consecutiveEligibleWindows: 0 });
  });
  it('ordinary living refresh evaluates review without a scale log; logs remain immutable', () => {
    const d = docs(); const before = JSON.stringify(d);
    // Match the actual frozen prescription's slot identities rather than inventing session completeness.
    const first = projectLiving({ docs: { ...d, entries: [] }, today: addDays(START, 28), tz: 'UTC', now: `${addDays(START, 28)}T12:00:00Z`, skipAssimilation: true });
    d.entries = d.entries.map((e) => e.kind === 'session' ? { ...e, itemId: first.days.find((x) => x.date === e.date)!.prescription.sessions[0]!.slotKey } : e);
    const raw = JSON.stringify(d);
    const p = projectLiving({ docs: d, today: addDays(START, 28), tz: 'UTC', now: `${addDays(START, 28)}T12:00:00Z`, skipAssimilation: true });
    expect(p.energyExposure!.review.needed).toBe(true);
    expect(p.today.notices.some((n) => n.id === 'repeatedCalendarEaBelowReference')).toBe(true);
    expect(p.assimilation).toBeNull();
    expect(JSON.stringify(d)).toBe(raw);
    expect(before.length).toBeGreaterThan(0);
    const unlogged = projectLiving({ docs: { ...d, entries: d.entries.filter((e) => e.kind !== 'session') }, today: addDays(START, 28), tz: 'UTC', now: `${addDays(START, 28)}T12:00:00Z`, skipAssimilation: true });
    expect(unlogged.energyExposure!.calendar7.ea.reasonCode).toBe('exerciseIncomplete');
    expect(unlogged.energyExposure!.review.needed).toBe(false);
  });
});

describe('A2-031 occurrence and operator preserving observed monitoring', () => {
  it('exact occurrence orders same-day backfill regardless of recordedAt; untimed same-day remains unordered', () => {
    const ms = [measured('a', 100, { recordedAt: `${START}T22:00:00Z`, occurrence: { precision: 'exact', at: `${START}T08:00:00Z`, dateMeaning: 'calendarLocal', source: 'user' } }), measured('b', 90, { recordedAt: `${START}T07:00:00Z`, occurrence: { precision: 'exact', at: `${START}T20:00:00Z`, dateMeaning: 'calendarLocal', source: 'user' } })];
    expect(monitored(ms)).toMatchObject({ latest: { value: 90 }, change: -10 });
    expect(monitored(ms.map((m) => ({ ...m, recordedAt: `${START}T23:00:00Z` })))).toEqual(monitored(ms));
    expect(monitored(ms.map((m) => ({ ...m, occurrence: undefined })))).toMatchObject({ change: null, first: null, latest: null, reasonCode: 'occurrenceOrderUnknown' });
  });
  it('blood BHB only accepts blood operators; bodyfat methods and glucose protocols stay separate', () => {
    const ketones = [measured('u', 2, { metric: 'ketonesMmolL', specimen: 'urine' }), measured('q', 2, { metric: 'ketonesMmolL' })];
    expect(monitored(ketones, 'bhb')).toMatchObject({ status: 'unknown', readings: 0, excludedOperatorReadings: 2 });
    expect(monitored([...ketones, measured('blood', 1, { metric: 'ketonesMmolL', specimen: 'capillaryBlood' })], 'bhb')).toMatchObject({ status: 'observed', readings: 1 });
    expect(monitored([measured('d', 25, { metric: 'bodyFatPct', method: 'dxa' }), measured('b', 20, { metric: 'bodyFatPct', method: 'bia', date: addDays(START, 2) })], 'bodyFatPct')).toMatchObject({ change: null, reasonCode: 'incompatibleOperators' });
    expect(monitored([measured('g', 5, { metric: 'glucoseMmolL', protocol: 'fasted' }), measured('h', 8, { metric: 'glucoseMmolL', protocol: 'postMeal', date: addDays(START, 2) })], 'glucose').change).toBeNull();
  });
  it('equal actual repeat identities remain separate; full raw lists never append aggregate means; legacy encoding remains explicit', () => {
    const rows = [measured('s', 125, { metric: 'sbpMmHg', episodeId: 'e', repeats: [120, 120, 135], repeatsEncoding: 'fullRawList' }), measured('s2', 120, { metric: 'sbpMmHg', episodeId: 'e' }), measured('d', 80, { metric: 'dbpMmHg', episodeId: 'e', repeats: [80], repeatsEncoding: 'primaryPlusAdditional' })];
    const e = bpEpisodes([...rows, rows[0]!])[0]!;
    expect(e.readings).toEqual({ sbp: [120, 120, 120, 135], dbp: [80, 80] });
    expect(e.sbp).toBe(123.75);
    const legacy = bpEpisodes([measured('legacy', 125, { metric: 'sbpMmHg', repeats: [120, 130] })])[0]!;
    expect(legacy).toMatchObject({ encoding: 'encodingUnknown', protocol: 'protocolUnknown', readings: { sbp: [] } });
    expect(legacy.legacyRepeats[0]).toMatchObject({ primary: 125, repeats: [120, 130] });
  });
});

it('A2-010 explicit current renal scope/revocation never falls back to stored guidance', () => {
  const envelope: ClinicalNutritionEnvelope = { id: 'old', condition: 'ckd', dialysis: 'none', stability: 'stable', weightBasis: 'clinicianEntered', basisWeightKg: 95, basisWeightOn: START, basisWeightKind: 'dry', bounds: [{ id: 'protein-order', quantity: 'proteinPerKg', unit: 'g/kg/d', comparator: 'cap', value: 1, basis: 'clinicianEntered', scope: 'total', window: { kind: 'day' }, applicability: 'applicable', mandatory: true, source: { kind: 'clinician', ref: 'source-document' }, policyVersion: 1 }], assessedAt: START, source: 'selfEnteredClinician' };
  const stored = { mode: 'M0' as const, flags: { nutritionEnvelopes: [envelope] } };
  const current = { mode: 'M0' as const, flags: renalSafetyFlags(resolveRenalScope({ flags: [], sourceKnown: true, envelopes: [], today: START })) };
  expect(currentProfileSafety(stored, current, [])!.flags.nutritionEnvelopes).toEqual([]);
  expect(currentProfileSafety(stored, undefined, [])!.flags.nutritionEnvelopes).toEqual([envelope]);
  const revoked = { mode: 'M0' as const, flags: renalSafetyFlags(resolveRenalScope({ flags: ['kidney-disease'], sourceKnown: true, envelopes: [{ ...envelope, revokedAt: START }], today: START })) };
  const result = currentProfileSafety(stored, revoked, [])!;
  expect(result.flags.nutritionEnvelopes).toEqual([{ ...envelope, revokedAt: START }]);
  expect(result.flags.renalScope!.applicable).toEqual([]);
});
