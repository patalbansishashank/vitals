/**
 * D5-06 — the living loop's check-in coordination, pure parts: the due rule with its late-open catch-up (decided on the
 * current date, never backdated), the decision key over evidence ids / history hash / versions / decision point, the split of
 * stored anchors into records and decisions (legacy records stay imported history), disturbance review without a forced
 * tissue anchor, immediate eligibility re-checks on a new safety event, and the energy-nudge policy (off by default).
 */
import { describe, expect, it } from 'vitest';
import type { PersonProfile, Schedule } from '@/engine';
import {
  addDays,
  checkInDueAt,
  checkInEvidenceOf,
  checkInReview,
  confirmDecision,
  ENERGY_NUDGE_POLICY,
  isCheckInDue,
  lastConfirmedCheckIn,
  nudgeAllowed,
  prescriptionEligibility,
  previewDecision,
  scheduledCheckInDate,
  splitAnchorDocs,
  storedDecisionOn,
  type ConfirmedStateRecord,
  type LogEntry,
  type MeasurementEntry,
  type PlanDoc,
} from '@/living';

const MACROS = { protein: { unit: 'g' as const, value: 120 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } };
const START = '2026-09-28'; // a Monday
const PERSON: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: START };
const SCHEDULE: Schedule = {
  schemaVersion: 1, startDate: START, horizonDays: 28,
  programs: [{ id: 'A', label: 'day', energy: { kind: 'kcal', kcal: 2000 }, macros: MACROS, steps: 8000 }],
  days: Array.from({ length: 28 }, () => ({ program: 0 })),
};
const plan: PlanDoc & { id: string } = {
  id: '01JABCDEFGHJKMNPQRSTVWXYZ5', name: 'p', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${START}T08:00:00.000Z` }, status: 'active',
  startDate: START, plannedEndDate: addDays(START, 28), request: { profile: PERSON, goals: [], horizonDays: 28 }, baselineProfile: PERSON, headVersion: 1,
  // check-in on Sundays (weekday 6: 0 = Monday)
  pauses: [], intentions: {}, policy: { checkInWeekday: 6, autoApplyLoadLowering: true }, createdAt: `${START}T08:00:00.000Z`,
};
const head = { version: 1, schedule: SCHEDULE };
const source = { by: 'user' as const, method: 'typed' as const };
const weigh = (id: string, date: string, value: number, extra: Partial<MeasurementEntry> = {}): MeasurementEntry => ({ id, date, metric: 'weightKg', value, source, at: `${date}T07:00:00.000Z`, ...extra });
const record = (anchorDate: string): ConfirmedStateRecord => ({
  planId: plan.id, anchorDate, anchorDay: 13, trendWeight: { kg: 89, sd: 0.3 }, energyBiasKcal: { mean: 0, sd: 150 },
  residualSplit: { tissueMassKg: 80, residualKg: 0, fatKg: 0, leanKg: 0, source: 'engine' }, inputsHash: 'x', engine: { engineVersion: 'e', registryHash: 'r' }, trigger: 'weekly',
});

describe('due rule: weekly from day 7, late-open catch-up on the current date (D5-06)', () => {
  it('is due on the check-in weekday from day 7 on, not before', () => {
    expect(scheduledCheckInDate(plan, '2026-10-04')).toBeNull(); // the first Sunday is day 6
    expect(scheduledCheckInDate(plan, '2026-10-11')).toBe('2026-10-11');
    expect(checkInDueAt(plan, '2026-10-04', null).due).toBe(false);
    expect(checkInDueAt(plan, '2026-10-11', null)).toEqual({ due: true, scheduled: '2026-10-11', late: false, decisionPoint: '2026-10-11' });
  });

  it('a late open catches up once, decided today (never backdated); a confirmation clears it until the next weekday', () => {
    const late = checkInDueAt(plan, '2026-10-13', null);
    expect(late).toEqual({ due: true, scheduled: '2026-10-11', late: true, decisionPoint: '2026-10-13' });
    expect(isCheckInDue(plan, '2026-10-13', null)).toBe(true);
    // confirmed on the Tuesday: nothing due until the next Sunday
    for (const d of ['2026-10-13', '2026-10-14', '2026-10-17']) expect(checkInDueAt(plan, d, '2026-10-13').due).toBe(false);
    expect(checkInDueAt(plan, '2026-10-18', '2026-10-13').due).toBe(true);
    // a paused plan has nothing due
    expect(checkInDueAt({ ...plan, status: 'paused' }, '2026-10-11', null).due).toBe(false);
  });
});

describe('stored decisions beside records (C7 read adapter)', () => {
  it('legacy records stay imported history; a record with a decision and a decision-only document both count once', () => {
    const preview = previewDecision(checkInEvidenceOf({ plan, head, measurements: [], today: '2026-10-18', historyHash: 'h1' }));
    const confirmed = confirmDecision(preview, { actor: { kind: 'user' }, now: '2026-10-18T09:00:00.000Z', mode: 'explicit', anchored: false, review: { status: 'none', reasons: [], anchor: 'none' } });
    const docs = [record('2026-10-11'), { ...record('2026-10-04'), decision: { ...confirmed, decisionPoint: '2026-10-04' } }, { kind: 'checkInDecision', planId: plan.id, anchorDate: '2026-10-18', decision: confirmed }];
    const { records, decisions } = splitAnchorDocs(docs);
    expect(records.map((r) => r.anchorDate)).toEqual(['2026-10-11', '2026-10-04']);
    // no decision is synthesized for the legacy record (never relabelled as an automatic decision)
    expect(decisions.map((d) => d.decisionPoint)).toEqual(['2026-10-04', '2026-10-18']);
    expect(lastConfirmedCheckIn(records, decisions)).toBe('2026-10-18');
    expect(storedDecisionOn(plan.id, '2026-10-18', records, decisions)?.decision?.status).toBe('confirmed');
    expect(storedDecisionOn(plan.id, '2026-10-11', records, decisions)?.record?.anchorDate).toBe('2026-10-11');
    expect(storedDecisionOn(plan.id, '2026-10-12', records, decisions)).toBeNull();
    // a preview never counts as a confirmation
    expect(lastConfirmedCheckIn([], [preview])).toBeNull();
  });
});

describe('decision key: evidence ids, history hash, versions, adopted plan and decision point', () => {
  const ms = [weigh('w1', '2026-10-12', 90), weigh('w2', '2026-10-14', 89.8), weigh('w3', '2026-10-16', 89.7)];
  const key = (o: Partial<Parameters<typeof checkInEvidenceOf>[0]> = {}) => checkInEvidenceOf({ plan, head, measurements: ms, today: '2026-10-18', historyHash: 'h1', ...o });

  it('is stable for the same documents in any order, and the preview id names it', () => {
    const a = key();
    expect(key({ measurements: [...ms].reverse() }).key).toBe(a.key);
    expect(a.evidenceIds).toEqual(['w1', 'w2', 'w3']);
    expect(a.previewId).toBe(`ci-${a.key}`);
    expect(a.previewId.length).toBeLessThanOrEqual(64);
  });

  it('changes with an edit, a retraction, another history, another adopted version or another decision point', () => {
    const a = key().key;
    const edited = [...ms, { ...weigh('w2b', '2026-10-14', 89.9), supersedes: 'w2' }];
    expect(key({ measurements: edited }).key).not.toBe(a);
    const retracted = [...ms, { ...weigh('r1', '2026-10-16', 0), kind: 'retract', target: 'w3' } as unknown as MeasurementEntry];
    expect(key({ measurements: retracted }).evidenceIds).toEqual(['w1', 'w2']);
    expect(key({ historyHash: 'h2' }).key).not.toBe(a);
    expect(key({ head: { version: 2 } }).key).not.toBe(a);
    expect(key({ today: '2026-10-19' }).key).not.toBe(a);
  });

  it('a confirmation keeps the preview key and is marked confirmed exactly once by the caller', () => {
    const p = previewDecision(key());
    expect(p.status).toBe('preview');
    const c = confirmDecision(p, { actor: { kind: 'user', id: 'me' }, now: '2026-10-18T09:00:00.000Z', mode: 'explicit', anchored: true, review: { status: 'none', reasons: [], anchor: 'none' }, proposalVersion: 3 });
    expect(c).toMatchObject({ status: 'confirmed', key: p.key, id: `${plan.id}:2026-10-18`, proposalVersion: 3, mode: 'explicit', anchored: true });
  });
});

describe('disturbance review is not a tissue anchor (D5-06)', () => {
  const ev = (id: string, date: string, event: 'illness' | 'travel', to?: string): LogEntry => ({ id, date, tz: 'UTC', kind: 'event', event, ...(to ? { to } : {}), source }) as LogEntry;
  it('an illness since the last check-in asks for review; the anchor stays none', () => {
    const r = checkInReview({ plan, today: '2026-10-18', since: '2026-10-11', entries: [ev('e1', '2026-10-14', 'illness', '2026-10-16')], measurements: [], blockStarts: [] });
    expect(r).toEqual({ status: 'review', reasons: [{ code: 'illness', date: '2026-10-14' }], anchor: 'none' });
  });
  it('an event before the last check-in, or nothing at all, is a routine check-in', () => {
    expect(checkInReview({ plan, today: '2026-10-18', since: '2026-10-11', entries: [ev('e1', '2026-10-05', 'travel', '2026-10-06')], measurements: [], blockStarts: [] }).status).toBe('none');
    expect(checkInReview({ plan, today: '2026-10-18', since: null, entries: [], measurements: [], blockStarts: [] }).status).toBe('none');
  });
  it('a weigh-in gap of 14 days and a scan are review reasons too', () => {
    const r = checkInReview({ plan, today: '2026-10-18', since: '2026-10-11', entries: [], measurements: [weigh('a', '2026-09-30', 90), weigh('b', '2026-10-18', 89), { ...weigh('c', '2026-10-15', 20), metric: 'bodyFatPct', method: 'dxa' }], blockStarts: [] });
    expect(r.reasons.map((x) => x.code).sort()).toEqual(['compositionScan', 'weighInGap']);
  });
});

describe('eligibility re-checks the current prescription on a new safety event (C5/D5-06)', () => {
  const symptom = (status: 'new' | 'resolved', at: string): LogEntry =>
    ({ id: `s-${status}`, date: '2026-10-15', tz: 'UTC', at, recordedAt: at, kind: 'subjective', symptom: { category: 'exertionalChestDiscomfort', status, context: 'exertional' }, source }) as LogEntry;

  it('a concerning symptom blocks today’s prescription at once (no weigh-in, no lock window); its resolution lifts it', () => {
    const none = prescriptionEligibility({ plan, head, today: '2026-10-15', entries: [] });
    expect(none.blocked).toBe(false);
    expect(none.status).toBe('unchecked');
    const held = prescriptionEligibility({ plan, head, today: '2026-10-15', entries: [symptom('new', '2026-10-15T08:00:00.000Z')] });
    expect(held).toMatchObject({ blocked: true, status: 'review', boundary: 'symptomChange' });
    expect(held.reasons[0]?.code).toBe('symptomExercise');
    expect(held.key).not.toBe(none.key);
    const lifted = prescriptionEligibility({ plan, head, today: '2026-10-15', entries: [symptom('new', '2026-10-15T08:00:00.000Z'), symptom('resolved', '2026-10-15T10:00:00.000Z')] });
    expect(lifted.blocked).toBe(false);
  });

  it('changed screening answers invalidate the stored certification (at most Unchecked) without a blanket block', () => {
    const current = { mode: 'M0' as const, flags: { answers: { kidneyDisease: 'yes' } } } as unknown as NonNullable<PersonProfile['safety']>;
    const e = prescriptionEligibility({ plan, head, today: '2026-10-15', entries: [], currentSafety: current });
    expect(e).toMatchObject({ safetyChanged: true, boundary: 'safetyChange', status: 'unchecked', blocked: false });
    expect(prescriptionEligibility({ plan, head, today: '2026-10-15', entries: [], currentSafety: current }).key).toBe(e.key);
  });
});

describe('energy nudge policy (D5-06): off by default, an engineering bound, suppressed in a risk context', () => {
  it('stays disabled unless opted in, and never runs in a risk context', () => {
    expect(ENERGY_NUDGE_POLICY).toMatchObject({ enabled: false, maxFrac: 0.1, maxDays: 3, basis: 'engineeringBound', escalation: 'none' });
    expect(nudgeAllowed({ optedIn: false, riskContext: false })).toBe(false);
    expect(nudgeAllowed({ optedIn: true, riskContext: false })).toBe(true);
    expect(nudgeAllowed({ optedIn: true, riskContext: true })).toBe(false);
  });
});
