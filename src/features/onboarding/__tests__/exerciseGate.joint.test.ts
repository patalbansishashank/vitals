// @vitest-environment node
/**
 * Phase 0C joint check of the exercise symptom gate (D4-02, C5). Three consumers read the same symptom state:
 *  - the screening (`evaluateScreening` / `screeningExerciseGate`, src/lib/safetyPolicy.ts — W0-clinical),
 *  - the planner (`exerciseGateOf` / `compileRequest`, src/engine/planner/domain — W0-planner),
 *  - the living lifecycle (`withCurrentSymptoms` / `lifecycleSafetyGate`, src/living/lifecycleSafety.ts — W0-history),
 * through the production adapters (screening flags → `profileSafetyFrom`, screening locks → `toSafetyInput`). They must
 * agree, and a lock stored in a request must not keep a review open after a later report clarifies it.
 */
import { describe, expect, it } from 'vitest';
import { compileRequest } from '@/engine/planner/domain/context';
import { baselineSchedule } from '@/engine/planner/domain/decode';
import { exerciseGateOf } from '@/engine/planner/domain/safety';
import type { PlannerRequest } from '@/engine/planner/domain/types';
import { FAT_LOSS_KEEP_LEAN, MAN_95, request } from '@/engine/planner/domain/__tests__/personas';
import type { PersonProfile } from '@/engine/types/profile';
import { profileSafetyFrom, toSafetyInput } from '@/features/planner/request';
import type { ClinicianExerciseEnvelope, SymptomReport } from '@/lib/bodyContracts';
import { PLANNER_GATE_OF } from '@/lib/safetyPolicy';
import { currentSymptoms, lifecycleSafetyGate, withCurrentSymptoms } from '@/living/lifecycleSafety';
import type { LogEntry, LoggedSymptom } from '@/living/types';
import { evaluateScreening, screeningExerciseGate, type ScreeningAnswers, type YesNoPrefer } from '../safetyRules';
import { STANDARD_ANSWERS as STD } from '../testing';

const TODAY = '2026-10-10';

const sx = (id: string, category: SymptomReport['category'], status: SymptomReport['status'], occurredOn = '2026-10-01'): SymptomReport => ({
  id,
  category,
  status,
  occurredOn,
  reportedAt: `${occurredOn}T09:00:00Z`,
  context: 'exertional',
  source: 'user',
});
const env = (id: string, over: Partial<ClinicianExerciseEnvelope> = {}): ClinicianExerciseEnvelope => ({
  id,
  assessedAt: '2026-10-04',
  permitted: ['walking'],
  progressionAllowed: false,
  coversSymptomIds: ['s1'],
  stepsCeiling: 5000,
  source: 'selfEnteredClinician',
  ...over,
});

const SYMPTOM_SETS: Record<string, SymptomReport[]> = {
  none: [],
  chestUnexplained: [sx('s1', 'exertionalChestDiscomfort', 'unexplained')],
  chestResolved: [sx('s1', 'exertionalChestDiscomfort', 'resolved')],
  chestUnknownStatus: [sx('s1', 'exertionalChestDiscomfort', 'unknown')],
  kneeNew: [sx('k1', 'musculoskeletal', 'new')],
  chestThenSyncope: [sx('s1', 'exertionalChestDiscomfort', 'unexplained'), sx('s2', 'syncopeOrPresyncope', 'new', '2026-10-06')],
  legacyMigrated: [{ id: 'legacy-q13', category: 'other', status: 'reviewNeeded', reportedAt: '2026-01-01T00:00:00Z', context: 'unknown', source: 'legacyScreening' }],
};
const ENVELOPE_SETS: Record<string, ClinicianExerciseEnvelope[]> = {
  none: [],
  covers: [env('e1')],
  revoked: [env('e1', { revokedAt: '2026-10-09' })],
  reviewPassed: [env('e1', { reviewBy: '2026-10-08' })],
  reviewToday: [env('e1', { reviewBy: TODAY })],
  coversBothButOlder: [env('e1', { coversSymptomIds: ['s1', 's2'] })],
  newerCoversBoth: [env('e2', { assessedAt: '2026-10-07', coversSymptomIds: ['s1', 's2'], permitted: ['cardio', 'walking'], progressionAllowed: true })],
  bothEnvelopes: [env('e1'), env('e2', { assessedAt: '2026-10-07', coversSymptomIds: ['s1', 's2'], permitted: ['cardio'], progressionAllowed: true })],
  instantAssessedAt: [env('e3', { assessedAt: '2026-10-04T15:00:00.000Z' })],
  otherSymptom: [env('e1', { coversSymptomIds: ['zz'] })],
};
const ANSWERS: readonly YesNoPrefer[] = ['no', 'yes', 'prefer-not'];

/** The planner profile flags the production request builder derives from a screening outcome. */
function plannerFlags(answers: ScreeningAnswers) {
  const o = evaluateScreening(answers);
  return profileSafetyFrom(o.flags, o.mode, null).flags;
}

describe('screening, planner and lifecycle read the symptom state the same way (0C, D4-02)', () => {
  it('the screening gate and the planner gate agree on every combination of answer, symptoms and envelopes', () => {
    let compared = 0;
    for (const a of ANSWERS)
      for (const [sName, symptoms] of Object.entries(SYMPTOM_SETS))
        for (const [eName, envelopes] of Object.entries(ENVELOPE_SETS)) {
          const answers: ScreeningAnswers = { ...STD, symptoms: a };
          const mine = screeningExerciseGate(answers, { symptoms, exerciseEnvelopes: envelopes, today: TODAY });
          const theirs = exerciseGateOf({ ...plannerFlags(answers), symptoms, exerciseEnvelopes: envelopes }, TODAY);
          const label = `${a} / ${sName} / ${eName}`;
          expect(PLANNER_GATE_OF[mine.status], label).toBe(theirs.gate);
          expect(mine.envelope?.id ?? null, label).toBe(theirs.envelope?.id ?? null);
          if (mine.status === 'suspended') expect(mine.uncovered, label).toEqual(theirs.symptomIds);
          // the screening writes a symptom lock only for a structured suspension (the planner holds the review itself)
          const o = evaluateScreening(answers, { symptoms, exerciseEnvelopes: envelopes, today: TODAY });
          const symptomLock = o.plannerLocks.some((l) => l.id === 'no-exercise-prescription' && l.reasons.some((r) => r.source === 'symptoms'));
          expect(symptomLock, label).toBe(theirs.gate === 'suspended');
          compared++;
        }
    expect(compared).toBe(ANSWERS.length * Object.keys(SYMPTOM_SETS).length * Object.keys(ENVELOPE_SETS).length);
  });

  it('an envelope permitting progression of a named domain restores only that domain in both gates', () => {
    const symptoms = SYMPTOM_SETS.chestThenSyncope!;
    const { stepsCeiling: ceiling, ...noCeiling } = ENVELOPE_SETS.newerCoversBoth![0]!;
    for (const [e, steps, plannerCeiling] of [
      [ENVELOPE_SETS.newerCoversBoth![0]!, 'documentedOnly', ceiling], // its own step ceiling holds
      [noCeiling, 'free', null], // walking progression permitted, no own ceiling
    ] as const) {
      const mine = screeningExerciseGate({ symptoms: 'no' }, { symptoms, exerciseEnvelopes: [e], today: TODAY });
      expect(mine).toMatchObject({ status: 'envelope', allowsNewExercise: true, allowsProgression: true, steps });
      const p: PersonProfile = { ...MAN_95, safety: { mode: 'M0', flags: { symptoms, exerciseEnvelopes: [e] } }, startDate: TODAY };
      const caps = compileRequest(request(p, FAT_LOSS_KEEP_LEAN)).caps.exercise;
      expect(caps.gate).toBe('envelope');
      expect(caps.cardioAllowed).toBe(true);
      expect(caps.rtAllowed).toBe(false); // resistance is not a permitted domain
      expect(caps.stepsCeiling).toBe(plannerCeiling);
    }
  });
});

/** A symptom event as `log.subjective` / the Living screens write it. */
function symptomLog(id: string, date: string, symptom: LoggedSymptom): LogEntry {
  return { id, date, tz: 'UTC', recordedAt: `${date}T08:00:00Z`, source: { by: 'user', method: 'typed' }, kind: 'event', event: 'symptom', symptom };
}

describe('lifecycle: the request built from the screening never outlives a clarified symptom state (0C, C5/D4-02)', () => {
  const answers: ScreeningAnswers = { ...STD, symptoms: 'yes' };
  const outcome = evaluateScreening(answers);
  const safety = toSafetyInput({ outcome, plannerAccess: outcome.plannerAccess, optedTier: null, shortWindowOn: false });
  const profile: PersonProfile = { ...MAN_95, safety: profileSafetyFrom(outcome.flags, outcome.mode, null) };
  const req = (p: PersonProfile): PlannerRequest => request(p, FAT_LOSS_KEEP_LEAN, { safety });

  it('a Q13 yes without context is review in the planner (no RT, cardio or step progression), not a stored lock', () => {
    expect(safety.plannerLocks?.some((l) => l.id === 'no-exercise-prescription')).toBe(false);
    expect(safety.plannerLocks?.some((l) => l.id === 'exercise-light-moderate')).toBe(true); // the existing gate stays
    const ctx = compileRequest(req(profile));
    expect(ctx.caps.exercise).toMatchObject({ gate: 'reviewNeeded', rtAllowed: false, cardioAllowed: false });
    expect(ctx.practical.rtDays.max).toBe(0);
    expect(PLANNER_GATE_OF[screeningExerciseGate(answers).status]).toBe('reviewNeeded');
  });

  it('a later logged report clarifies it (resolved) or suspends it (unresolved), with the same stored request safety', () => {
    const resolved = withCurrentSymptoms(profile, [symptomLog('l1', '2026-10-06', { category: 'exertionalChestDiscomfort', status: 'resolved', occurredOn: '2026-09-20' })]);
    const clarified = compileRequest(req(resolved));
    expect(clarified.caps.exercise.gate).toBe('none');
    expect(clarified.caps.exercise.rtAllowed).toBe(true);
    expect(screeningExerciseGate(answers, { symptoms: resolved.safety!.flags.symptoms!, today: TODAY }).status).toBe('clear');

    const entries = [symptomLog('l2', '2026-10-06', { category: 'syncopeOrPresyncope', status: 'new', context: 'exertional' })];
    const open = withCurrentSymptoms(profile, entries);
    const ctx = compileRequest(req(open));
    expect(ctx.caps.exercise.gate).toBe('suspended');
    const mine = screeningExerciseGate(answers, { symptoms: currentSymptoms(profile, entries), today: TODAY });
    expect(mine.status).toBe('suspended');
    expect(mine.uncovered).toEqual(ctx.caps.exercise.symptomIds);
    // the lifecycle gate without a planner revalidation blocks a prescription that raises steps above the baseline
    const s0 = baselineSchedule(ctx);
    const schedule = { ...s0, programs: s0.programs.map((t) => ({ ...t, steps: 9000 })) };
    const gate = lifecycleSafetyGate({ boundary: 'adopt', schedule, fromDay: 0, profile: open, entries, today: TODAY });
    expect(gate.blocked).toBe(true);
    expect(gate.concerning.map((s) => s.id)).toEqual(mine.uncovered);
    // a resolution logged later lifts it at the next boundary; the history (both reports) is kept
    const later = [...entries, symptomLog('l3', '2026-10-08', { category: 'syncopeOrPresyncope', status: 'resolved' })];
    const resumeInput = { boundary: 'resume' as const, schedule, fromDay: 0, profile: withCurrentSymptoms(profile, later), entries: later, today: TODAY };
    const pending = lifecycleSafetyGate(resumeInput);
    expect(pending.concerning).toEqual([]);
    expect(pending.blocked).toBe(true);
    expect(pending.reasons.map((r) => r.code)).toEqual(['revalidationUnavailable']);
    expect(lifecycleSafetyGate({ ...resumeInput, revalidation: { status: 'verified', certificateValid: true } }).blocked).toBe(false);
    expect(screeningExerciseGate(answers, { symptoms: currentSymptoms(profile, later), today: TODAY }).status).toBe('clear');
  });
});
