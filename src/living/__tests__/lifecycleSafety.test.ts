// @vitest-environment node
/**
 * Lifecycle safety (C5; D4-01, D4-02, D4-03): the boundary gate reads the current symptom state, blocks a failed or violating
 * certificate and a known revalidation problem, never reports Verified without the planner's revalidation, and keeps
 * ordinary activity and logging out of the exercise hold. (A1-001) Activation needs the planner's authoritative startable
 * decision: without a revalidation, or with an Unchecked one, the prescription is withheld; the symptom reason still names
 * the exercise hold first.
 */
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import type { SafetyCertificate } from '@/lib/bodyContracts';
import { currentSymptoms, lifecycleSafetyGate, prescribedExerciseFrom, symptomsFromEntries, withCurrentSymptoms } from '../lifecycleSafety';
import type { LogEntry } from '../types';

const BASE: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 50, heightCm: 178, weightKg: 92 }, habits: { typicalSteps: 1500 }, startDate: '2026-10-05' };
const REST: DayTemplate = { id: 'R', label: 'rest', energy: { kind: 'kcal', kcal: 2000 }, macros: { protein: { unit: 'g', value: 140 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } } };
const TRAIN: DayTemplate = { ...REST, id: 'T', label: 'train', exercise: [{ kind: 'resistance', startH: 18, setsByRegion: { quads: 6 } }] };
const sched = (t: DayTemplate): Schedule => ({ schemaVersion: 1, startDate: '2026-10-05', horizonDays: 14, programs: [t], days: Array.from({ length: 14 }, () => ({ program: 0 })) });
const src = { by: 'user' as const, method: 'typed' as const };
const symptom = (id: string, date: string, category: string, status: string, at: string): LogEntry =>
  ({ id, date, tz: 'UTC', at, recordedAt: at, source: src, kind: 'event', event: 'symptom', symptom: { category, status, context: 'exertional' } }) as unknown as LogEntry;

describe('lifecycle safety gate', () => {
  const chest = symptom('s1', '2026-10-08', 'exertionalChestDiscomfort', 'new', '2026-10-08T07:00:00.000Z');

  it('an unresolved concerning exertional symptom blocks a prescription with sessions, not one without', () => {
    const blocked = lifecycleSafetyGate({ boundary: 'adopt', schedule: sched(TRAIN), fromDay: 3, profile: BASE, entries: [chest] });
    expect(blocked).toMatchObject({ blocked: true, status: 'review' });
    expect(blocked.reasons[0]!.code).toBe('symptomExercise');
    // no exercise hold for a rest prescription; without the planner's revalidation it is still never authorized (A1-001)
    const rest = lifecycleSafetyGate({ boundary: 'adopt', schedule: sched(REST), fromDay: 3, profile: BASE, entries: [chest] });
    expect(rest).toMatchObject({ blocked: true, status: 'unchecked' });
    expect(rest.reasons.map((r) => r.code)).toEqual(['revalidationUnavailable']);
  });

  it('steps: at or below the documented baseline stay allowed; above it, or any number without a baseline, is held', () => {
    const held = (r: ReturnType<typeof lifecycleSafetyGate>) => r.reasons.some((x) => x.code === 'symptomExercise');
    expect(held(lifecycleSafetyGate({ boundary: 'start', schedule: sched({ ...REST, steps: 1500 }), fromDay: 0, profile: BASE, entries: [chest] }))).toBe(false);
    expect(held(lifecycleSafetyGate({ boundary: 'start', schedule: sched({ ...REST, steps: 3000 }), fromDay: 0, profile: BASE, entries: [chest] }))).toBe(true);
    const noBaseline = { ...BASE, habits: {} };
    expect(prescribedExerciseFrom(sched({ ...REST, steps: 3000 }), 0, null)).toEqual({ sessions: false, stepsAbove: true });
    expect(held(lifecycleSafetyGate({ boundary: 'start', schedule: sched({ ...REST, steps: 3000 }), fromDay: 0, profile: noBaseline, entries: [chest] }))).toBe(true);
  });

  it('the latest report per category wins: a later resolution lifts the hold; a musculoskeletal report never triggers it', () => {
    const resolved = symptom('s2', '2026-10-10', 'exertionalChestDiscomfort', 'resolved', '2026-10-10T07:00:00.000Z');
    expect(currentSymptoms(BASE, [chest, resolved]).map((s) => s.status)).toEqual(['resolved']);
    const held = (r: ReturnType<typeof lifecycleSafetyGate>) => r.reasons.some((x) => x.code === 'symptomExercise');
    expect(held(lifecycleSafetyGate({ boundary: 'adopt', schedule: sched(TRAIN), fromDay: 5, profile: BASE, entries: [chest, resolved] }))).toBe(false);
    const knee = symptom('s3', '2026-10-08', 'musculoskeletal', 'new', '2026-10-08T07:00:00.000Z');
    expect(held(lifecycleSafetyGate({ boundary: 'adopt', schedule: sched(TRAIN), fromDay: 3, profile: BASE, entries: [knee] }))).toBe(false);
    // with the planner's startable revalidation the resolved person's prescription starts
    expect(lifecycleSafetyGate({ boundary: 'adopt', schedule: sched(TRAIN), fromDay: 5, profile: BASE, entries: [chest, resolved], revalidation: { status: 'verified', startable: true } }).blocked).toBe(false);
  });

  it('logged symptoms join the profile safety flags (what re-planning and revalidation read)', () => {
    const p = withCurrentSymptoms(BASE, [chest]);
    expect(p.safety?.flags.symptoms?.map((s) => [s.id, s.category, s.status])).toEqual([['s1', 'exertionalChestDiscomfort', 'new']]);
    expect(symptomsFromEntries([{ ...chest, assumed: true } as LogEntry])).toEqual([]);
    expect(withCurrentSymptoms(BASE, [])).toBe(BASE);
  });

  it('never Verified without the revalidation; a failed audit, a violation or a revalidation problem blocks', () => {
    // (A1-001) no revalidation never authorizes the prescription
    expect(lifecycleSafetyGate({ boundary: 'start', schedule: sched(TRAIN), fromDay: 0, profile: BASE, entries: [] })).toMatchObject({ blocked: true, status: 'unchecked' });
    expect(lifecycleSafetyGate({ boundary: 'start', schedule: sched(TRAIN), fromDay: 0, profile: BASE, entries: [], revalidation: { status: 'verified', certificateValid: true } }).status).toBe('verified');
    expect(lifecycleSafetyGate({ boundary: 'start', schedule: sched(TRAIN), fromDay: 0, profile: BASE, entries: [], revalidation: { status: 'violation', reasons: ['fat above 30 % of energy'] } })).toMatchObject({ blocked: true, status: 'violation', reasons: [{ text: 'fat above 30 % of energy' }] });
    const failed = { kind: 'vitals.safetyCertificate', version: 1, fingerprint: 'f', episodeId: 'e', attempt: 1, status: 'failed', audit: { status: 'fail', M: 16, passes: 14, required: 15, failedMembers: [1, 2], missing: [], alpha: 0.1, reasonCode: 'belowRequired' }, constraintStatus: 'verified', createdAt: '2026-10-05T00:00:00.000Z' } as SafetyCertificate;
    expect(lifecycleSafetyGate({ boundary: 'adopt', schedule: sched(REST), fromDay: 0, profile: BASE, entries: [], certificate: failed })).toMatchObject({ blocked: true, status: 'review' });
    // (A1-001) an Unchecked revalidation is not permission; the planner's startable decision (e.g. a covering clinician
    // envelope with a current certificate) is trusted
    expect(lifecycleSafetyGate({ boundary: 'adopt', schedule: sched(TRAIN), fromDay: 3, profile: BASE, entries: [chest], revalidation: { status: 'unchecked' } }).blocked).toBe(true);
    expect(lifecycleSafetyGate({ boundary: 'adopt', schedule: sched(TRAIN), fromDay: 3, profile: BASE, entries: [chest], revalidation: { status: 'unchecked', startable: false, reasonCode: 'certificateRequired' } }).reasons[0]!.code).toBe('revalidation:certificateRequired');
    expect(lifecycleSafetyGate({ boundary: 'adopt', schedule: sched(TRAIN), fromDay: 3, profile: BASE, entries: [chest], revalidation: { status: 'verified', startable: true } })).toMatchObject({ blocked: false, status: 'verified' });
  });
});
