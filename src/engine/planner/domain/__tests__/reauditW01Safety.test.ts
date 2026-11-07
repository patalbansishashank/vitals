// @vitest-environment node
/**
 * Re-audit of waves 0-1, package F08 (planner safety): A1-001 authoritative startability, A1-003 clinician intensity
 * maxima, A1-004 the final anchored start subject, A1-006 unknown/rejected lock definitions, A1-007 normalized supplement
 * actives, A1-008 floor applicability of explicit meals, A1-011 the finalized frozen audit subject, A1-012 the audit
 * initial-state/controller binding, A1-014 nutrient coverage intervals and A1-035 the audit draw protocol.
 *
 * Bounds used here (5 %E, 30 % VO2max, 130 g/d, 2000 mg/d …) are illustrative clinician entries, not policy thresholds.
 */
import { describe, expect, it } from 'vitest';
import { contentHash, type ClinicianExerciseEnvelope, type JointScreenResult, type SafetyCertificate, type SymptomReport } from '@/lib/bodyContracts';
import { lifecycleSafetyGate, revalidationStartable, finalAuditAllowed } from '@/living/lifecycleSafety';
import { sameSafetySubject, startFromRung, withFinalCertificate } from '@/living/start';
import type { PersonProfile } from '../../../types/profile';
import type { CardioSession, DayTemplate, Schedule } from '../../../types/schedule';
import { latinHypercube, Rng } from '../../optim/rng';
import { createLocalEvaluator, runPlanner, type FinalAuditSubject } from '../../optim/pipeline';
import { functionToy } from '../../optim/toys';
import type { EvalOutput } from '../../optim/types';
import { buildModelParams, quantilesToParams, variableParamCount } from '../../../core/paramsRegistry';
import { MODULES } from '../../../core/moduleRegistry';
import { compileRequest } from '../context';
import { baselineSchedule } from '../decode';
import { auditFrozenSchedule, auditProtocolOf, finalSubjectCertificate } from '../evaluatorHost';
import { EnginePlanModel, REQUIRED_SAFETY_MARGIN_IDS } from '../model';
import { repairSchedule } from '../repair';
import { replanStateHash } from '../replan';
import { normalizeIntensityCap } from '../safety';
import {
  auditStateHash,
  auditSubjectHash,
  checkIntensityCaps,
  evaluateConstraint,
  evaluatePlanSafety,
  issueCertificate,
  plannerCertificateInputs,
  resolvedExposure,
  revalidatePlanSafety,
  type PlannerSafetyCertificate,
} from '../safetyAudit';
import type { PlanOption, PlannerRequest, PlannerRequestV2 } from '../types';
import { validatePlan } from '../validate';
import { FAT_LOSS_KEEP_LEAN, MAN_95, request } from './personas';
import { GOLDEN } from './golden.requests';
import { runLadderPlanner } from '../ladderPlanner';
import { confirmedState, logsAsPlanned, makePlan, replanRequest } from './replan.fixtures';
import { replan, replanSafetySubject } from '../replan';
import { EvaluatorHost } from '../evaluatorHost';
import { createPooledEvaluator } from '../../optim/pipeline';

type Lock = NonNullable<NonNullable<PlannerRequest['safety']>['plannerLocks']>[number];

const PASS16: JointScreenResult = { status: 'pass', M: 16, passes: 16, required: 15, failedMembers: [], missing: [], alpha: 0.1, reasonCode: 'ok' };
const PROTOCOL = { M: 16, seed: 'f08' };

const withLocks = (locks: Lock[], extra: Partial<PlannerRequest> = {}): PlannerRequest => ({ ...request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 }), safety: { mode: 'M0', plannerLocks: locks }, ...extra });

const withFlags = (p: PersonProfile, flags: Record<string, unknown>): PersonProfile => ({ ...p, safety: { mode: 'M0', flags: { ...(p.safety?.flags ?? {}), ...flags } } as PersonProfile['safety'] });

/** A clean repaired baseline schedule for a request (no fasts, ordinary eating days). */
function cleanSchedule(req: PlannerRequest): Schedule {
  const ctx = compileRequest(req);
  return repairSchedule(ctx, baselineSchedule(ctx)).schedule;
}

/** A verified certificate bound to exactly this subject (as a planner issuer would make it). */
function certify(req: PlannerRequest, schedule: Schedule, opts: { historyHash?: string; stateHash?: string } = {}): PlannerSafetyCertificate {
  const ctx = compileRequest({ ...req, horizonDays: schedule.horizonDays });
  const e = evaluatePlanSafety(ctx, schedule, null);
  return issueCertificate(plannerCertificateInputs(ctx, schedule, REQUIRED_SAFETY_MARGIN_IDS, PROTOCOL, opts.historyHash, opts.stateHash), { screen: PASS16, subjectHash: auditSubjectHash(schedule), protocol: PROTOCOL }, e.status, { episodeId: 'f08', createdAt: '' });
}

/** A one-template schedule of `days` days (every day the same template). */
function scheduleOf(t: DayTemplate, days = 7, startDate = '2026-10-05', extra: Partial<Schedule> = {}): Schedule {
  return { schemaVersion: 1, startDate, horizonDays: days, programs: [t], days: Array.from({ length: days }, () => ({ program: 0 })), ...extra } as Schedule;
}

const EAT: DayTemplate = {
  id: 'eat',
  label: 'eat',
  energy: { kind: 'kcal', kcal: 2779 },
  macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 100 }, fat: { unit: 'remainder' } },
} as DayTemplate;

// ------------------------------------------------------------------------------------------------ A1-001

describe('A1-001: an Unchecked prescription is never activated; the planner decision is authoritative', () => {
  const req = withLocks([{ id: 'satfat-cap', value: 5, unit: '%E', source: 'clinician' }]);
  const sched = cleanSchedule(req);

  it('a mandatory unsupported bound (5 %E saturated fat) is unchecked and not startable, even with a passing certificate', () => {
    const cert = certify(req, sched);
    const r = revalidatePlanSafety(req, sched, { boundary: 'start', certificate: cert });
    const sat = r.evaluation.evaluations.find((e) => e.constraintId === 'satfat-cap')!;
    expect(sat).toMatchObject({ capability: 'unsupported', status: 'unchecked', mandatory: true, unit: '%E' });
    expect(r.evaluation.status).toBe('unchecked');
    expect(r.startable).toBe(false);
    expect(cert.status).not.toBe('verified');
    // the consumer gate refuses before any write: Unchecked is not permission
    const gate = lifecycleSafetyGate({ boundary: 'start', schedule: sched, fromDay: 0, profile: req.profile, entries: [], revalidation: { status: r.status, startable: r.startable, reasonCode: r.reasonCode, certificateValid: r.certificateValid } });
    expect(gate.blocked).toBe(true);
    expect(gate.status).toBe('unchecked');
    // a legacy port that drops `startable` cannot turn Unchecked into permission either
    expect(lifecycleSafetyGate({ boundary: 'start', schedule: sched, fromDay: 0, profile: req.profile, entries: [], revalidation: { status: 'unchecked' } }).blocked).toBe(true);
    expect(revalidationStartable({ status: 'unchecked', certificateValid: true })).toBe(false);
  });

  it('an optional (own preference) unsupported bound does not lock unrelated planning: a current certificate starts', () => {
    const own = withLocks([{ id: 'satfat-cap', value: 5, unit: '%E', source: 'user' }]);
    const s = cleanSchedule(own);
    const cert = certify(own, s);
    const r = revalidatePlanSafety(own, s, { boundary: 'start', certificate: cert });
    expect(r.evaluation.evaluations.find((e) => e.constraintId === 'satfat-cap')?.mandatory).toBe(false);
    expect(r.status).toBe('verified');
    expect(r.startable).toBe(true);
    const gate = lifecycleSafetyGate({ boundary: 'start', schedule: s, fromDay: 0, profile: own.profile, entries: [], revalidation: { status: r.status, startable: r.startable, certificateValid: r.certificateValid } });
    expect(gate).toMatchObject({ blocked: false, status: 'verified' });
  });

  it('stale or missing certificate: Unchecked with the concrete next step; a failed audit never activates; no port never authorizes', () => {
    const plain = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 });
    const s = cleanSchedule(plain);
    const none = revalidatePlanSafety(plain, s, { boundary: 'start' });
    expect(none).toMatchObject({ status: 'unchecked', startable: false, reasonCode: 'certificateRequired' });
    const stale = certify(plain, s, { historyHash: 'h1' });
    const r = revalidatePlanSafety(plain, s, { boundary: 'adopt', certificate: stale, historyHash: 'h2' });
    expect(r).toMatchObject({ certificateValid: false, startable: false, reasonCode: 'certificateRequired' });
    const g = lifecycleSafetyGate({ boundary: 'adopt', schedule: s, fromDay: 0, profile: plain.profile, entries: [], revalidation: { status: r.status, startable: r.startable, reasonCode: r.reasonCode, certificateValid: r.certificateValid } });
    expect(g.blocked).toBe(true);
    expect(g.reasons[0]!.code).toBe('revalidation:certificateRequired');
    // a failed audit: blocked, and no declared final audit may follow it
    const failed: SafetyCertificate = { ...certify(plain, s), status: 'failed' };
    expect(lifecycleSafetyGate({ boundary: 'start', schedule: s, fromDay: 0, profile: plain.profile, entries: [], certificate: failed, revalidation: { status: 'verified', startable: true } }).blocked).toBe(true);
    expect(finalAuditAllowed(failed)).toBe(false);
    expect(finalAuditAllowed(null)).toBe(true);
    // no revalidation (none installed or it threw): never authorizes
    expect(lifecycleSafetyGate({ boundary: 'resume', schedule: s, fromDay: 0, profile: plain.profile, entries: [] })).toMatchObject({ blocked: true, status: 'unchecked' });
  });

  it('an incomplete legacy symptom screen limits exercise only: a prescription without exercise stays certifiable (no global lock)', () => {
    const p = withFlags(MAN_95, { answers: { faintingOrChestPain: 'preferNot' } });
    const req2 = request(p, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 });
    const ctx = compileRequest(req2);
    expect(ctx.caps.exercise.gate).toBe('reviewNeeded');
    const s = cleanSchedule(req2);
    const e = evaluatePlanSafety(ctx, s, null);
    expect(e.exercise.ok).toBe(true);
    expect(e.status).not.toBe('review');
    const r = revalidatePlanSafety(req2, s, { boundary: 'start', certificate: certify(req2, s) });
    expect(r.startable).toBe(e.status === 'verified');
    // the same person with training as usual on a day: refused (the gate stops exercise prescription)
    const trained: Schedule = { ...s, days: s.days.map((d, i) => (i === 2 ? { ...d, override: { ...d.override, habitualTraining: true } } : d)) };
    expect(revalidatePlanSafety(req2, trained, { boundary: 'start' }).status).toBe('violation');
  });
});

// ------------------------------------------------------------------------------------------------ A1-003

const CHEST: SymptomReport = { id: 'sx1', category: 'exertionalChestDiscomfort', status: 'unexplained', occurredOn: '2026-09-20', reportedAt: '2026-09-20T09:00:00Z', context: 'exertional', source: 'user' };
const envelope = (intensity: ClinicianExerciseEnvelope['intensity'], extra: Partial<ClinicianExerciseEnvelope> = {}): ClinicianExerciseEnvelope => ({
  id: 'env1',
  assessedAt: '2026-09-25',
  permitted: ['cardio', 'walking', 'steps'],
  progressionAllowed: true,
  coversSymptomIds: ['sx1'],
  source: 'selfEnteredClinician',
  ...(intensity ? { intensity } : {}),
  ...extra,
});
const enveloped = (env: ClinicianExerciseEnvelope): PlannerRequest => request(withFlags(MAN_95, { symptoms: [CHEST], exerciseEnvelopes: [env] }), FAT_LOSS_KEEP_LEAN, { horizonDays: 28 });

/** The clean schedule with one cardio session a week (day 2, 9, …). */
function withCardio(s: Schedule, c: Partial<CardioSession>): Schedule {
  const session: CardioSession = { kind: 'cardio', modality: 'cycle', startH: 17, durationMin: 30, ...c } as CardioSession;
  return { ...s, days: s.days.map((d, i) => (i % 7 === 2 ? { ...d, override: { ...d.override, exercise: [session] } } : d)) };
}

describe('A1-003: every clinician intensity maximum is carried, compared on every phase and repaired to', () => {
  it('normalization keeps the original entry; percent vs fraction by explicit unit only; unknown/invalid/unsupported are never guessed', () => {
    const n = (it: ClinicianExerciseEnvelope['intensity']) => normalizeIntensityCap(envelope(it));
    expect(n({ convention: 'pctVo2max', max: 30, unit: '%' })).toMatchObject({ status: 'supported', normalized: { channel: 'pctVo2maxFraction', max: 0.3 }, original: { max: 30, unit: '%' } });
    expect(n({ convention: 'pctVo2max', max: 0.3, unit: 'fraction' })!.normalized).toEqual({ channel: 'pctVo2maxFraction', max: 0.3 });
    expect(n({ convention: 'pctVo2max', max: 30, unit: '' })!.status).toBe('unknownUnit');
    expect(n({ convention: 'pctVo2max', max: Number.NaN, unit: '%' })!.status).toBe('invalidValue');
    expect(n({ convention: 'RPE', max: 13, unit: 'Borg 6-20' })!.status).toBe('noComparableChannel');
    expect(n({ convention: 'RPE', max: 4, unit: 'CR10' })!.normalized).toEqual({ channel: 'cr10', max: 4 });
    expect(n({ convention: 'MET', max: 4, unit: 'MET' })!.normalized).toEqual({ channel: 'grossMet', max: 4 });
    expect(n({ convention: 'MET', max: 3, unit: 'net MET' })!.status).toBe('noComparableChannel');
    expect(n({ convention: 'pctHRmax', max: 60, unit: '%' })!.status).toBe('noComparableChannel');
    expect(n({ convention: 'talkTest', max: 1, unit: 'level' })!.status).toBe('noComparableChannel');
  });

  it('clinician 30 % VO2max with a prescribed 50 %: never Verified unchanged; repair lowers it to ≤ 0.30 and the result passes', () => {
    const req = enveloped(envelope({ convention: 'pctVo2max', max: 30, unit: '%' }));
    const ctx = compileRequest(req);
    expect(ctx.caps.exercise.gate).toBe('envelope');
    expect(ctx.caps.exercise.intensityCaps).toHaveLength(1);
    const s50 = withCardio(cleanSchedule(req), { pctVo2max: 0.5 });
    const e50 = evaluatePlanSafety(ctx, s50, null);
    expect(e50.exercise.intensity[0]).toMatchObject({ status: 'violation', peak: 0.5 });
    expect(e50.status).toBe('violation');
    expect(validatePlan(ctx, s50).reasons.some((r) => r.startsWith('envelope.intensity'))).toBe(true);
    expect(revalidatePlanSafety(req, s50, { boundary: 'start', certificate: certify(req, s50) }).startable).toBe(false);
    // repair lowers the supported dose; the independent validator and the final check agree on the result
    const fixed = repairSchedule(ctx, s50).schedule;
    const doses = fixed.days.flatMap((d) => (d.override?.exercise ?? []).filter((x): x is CardioSession => x.kind === 'cardio').map((x) => x.pctVo2max));
    expect(doses.length).toBeGreaterThan(0);
    for (const v of doses) expect(v).toBeLessThanOrEqual(0.3 + 1e-12);
    const ef = evaluatePlanSafety(ctx, fixed, null);
    expect(ef.exercise.intensity[0]!.status).toBe('pass');
    expect(validatePlan(ctx, fixed).reasons.filter((r) => r.startsWith('envelope.intensity'))).toEqual([]);
    // a matching allowable value passes as is
    expect(checkIntensityCaps(ctx.caps.exercise.intensityCaps, withCardio(cleanSchedule(req), { pctVo2max: 0.3 }))[0]!.status).toBe('pass');
  });

  it('a high-intensity interval hidden by a low session mean is a violation; repair lowers the phase', () => {
    const req = enveloped(envelope({ convention: 'pctVo2max', max: 30, unit: '%' }));
    const ctx = compileRequest(req);
    const s = withCardio(cleanSchedule(req), { pctVo2max: 0.25, durationMin: 30, phases: [{ kind: 'work', durationMin: 5, pctVo2max: 0.9 }, { kind: 'recovery', durationMin: 25, pctVo2max: 0.2 }] });
    expect(checkIntensityCaps(ctx.caps.exercise.intensityCaps, s)[0]).toMatchObject({ status: 'violation', peak: 0.9 });
    const fixed = repairSchedule(ctx, s).schedule;
    expect(checkIntensityCaps(ctx.caps.exercise.intensityCaps, fixed)[0]!.status).toBe('pass');
  });

  it('absent intensity, an RPE of unknown scale or a net-MET limit: Unchecked (never the generic moderate band)', () => {
    const pct = compileRequest(enveloped(envelope({ convention: 'pctVo2max', max: 30, unit: '%' })));
    const absent = withCardio(cleanSchedule(pct.request), {});
    expect(checkIntensityCaps(pct.caps.exercise.intensityCaps, absent)[0]!.status).toBe('unchecked');
    expect(evaluatePlanSafety(pct, absent, null).status).toBe('unchecked');
    // repair states the modelled default lowered to the maximum (never raised)
    const stated = repairSchedule(pct, absent).schedule;
    expect(checkIntensityCaps(pct.caps.exercise.intensityCaps, stated)[0]!.status).toBe('pass');
    // (sessions stated on one channel only: a schedule whose other cardio has no CR-10 rating stays unchecked)
    const cr10 = compileRequest(enveloped(envelope({ convention: 'RPE', max: 4, unit: 'CR10' })));
    const unknownScale = withCardio(scheduleOf(EAT, 28), { rpe: 3 });
    expect(checkIntensityCaps(cr10.caps.exercise.intensityCaps, unknownScale)[0]!.status).toBe('unchecked');
    expect(checkIntensityCaps(cr10.caps.exercise.intensityCaps, withCardio(scheduleOf(EAT, 28), { rpe: 3, rpeScale: 'cr10' }))[0]!.status).toBe('pass');
    expect(checkIntensityCaps(cr10.caps.exercise.intensityCaps, withCardio(scheduleOf(EAT, 28), { rpe: 5, rpeScale: 'cr10' }))[0]!.status).toBe('violation');
    expect(checkIntensityCaps(cr10.caps.exercise.intensityCaps, cleanSchedule(cr10.request))[0]!.status).toBe('unchecked');
    const net = compileRequest(enveloped(envelope({ convention: 'MET', max: 3, unit: 'net MET' })));
    expect(checkIntensityCaps(net.caps.exercise.intensityCaps, withCardio(scheduleOf(EAT, 28), { met: 2.5 }))[0]!.status).toBe('unchecked');
    const gross = compileRequest(enveloped(envelope({ convention: 'MET', max: 3, unit: 'MET' })));
    expect(checkIntensityCaps(gross.caps.exercise.intensityCaps, withCardio(scheduleOf(EAT, 28), { met: 2.5 }))[0]!.status).toBe('pass');
    expect(checkIntensityCaps(gross.caps.exercise.intensityCaps, withCardio(scheduleOf(EAT, 28), { met: 3.5 }))[0]!.status).toBe('violation');
    // an unreadable limit needs review
    const bad = compileRequest(enveloped(envelope({ convention: 'pctVo2max', max: 30, unit: 'weird' })));
    expect(evaluatePlanSafety(bad, withCardio(cleanSchedule(bad.request), { pctVo2max: 0.2 }), null).status).toBe('review');
  });

  it('a healthy adult without an envelope keeps ordinary planning (no intensity cap, the generic band only)', () => {
    const ctx = compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 }));
    expect(ctx.caps.exercise.intensityCaps).toEqual([]);
    const s = withCardio(cleanSchedule(ctx.request), { pctVo2max: 0.6 });
    expect(evaluatePlanSafety(ctx, s, null).exercise.intensity).toEqual([]);
  });

  it('the normalized policy and the original envelope are in the certificate subject', () => {
    const a = enveloped(envelope({ convention: 'pctVo2max', max: 30, unit: '%' }));
    const b = enveloped(envelope({ convention: 'pctVo2max', max: 40, unit: '%' }));
    const s = cleanSchedule(a);
    const fa = plannerCertificateInputs(compileRequest(a), s, REQUIRED_SAFETY_MARGIN_IDS, PROTOCOL);
    expect(fa.intensityPolicy?.[0]).toMatchObject({ original: { max: 30 }, normalized: { max: 0.3 } });
    expect(contentHash(fa)).not.toBe(contentHash(plannerCertificateInputs(compileRequest(b), s, REQUIRED_SAFETY_MARGIN_IDS, PROTOCOL)));
  });
});

// ------------------------------------------------------------------------------------------------ A1-004

function optionFor(req: PlannerRequest, schedule: Schedule, certificate?: SafetyCertificate): PlanOption {
  const sim = new EnginePlanModel(compileRequest(req), { bindings: [], recordAll: true, fullMode: true }).simulate(schedule, -1);
  return { id: 'B', name: 'B', schedule, simulation: sim, scorecard: [], utility: 0, hunger: {} as PlanOption['hunger'], complexity: {} as PlanOption['complexity'], phases: [], explanation: [], notes: [], safetyNotes: [], bindingConstraints: [], confidence: {} as PlanOption['confidence'], ...(certificate ? { safety: { status: 'verified', certificate } } : {}) } as unknown as PlanOption;
}

describe('A1-004: start validates and certifies exactly the final anchored prescription', () => {
  const ctxBase = { planId: 'p1', now: '2026-10-02T08:00:00.000Z', today: '2026-10-02', createdBy: { kind: 'user' as const }, versions: { engineVersion: '', registryHash: '', catalogueVersion: '' } };
  const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28, startDate: '2026-10-05' }) as PlannerRequestV2;
  const source = cleanSchedule(req);

  it('an unchanged start keeps the source certificate; a moved start keeps it only as provenance (never on the version)', () => {
    const cert = certify(req, source);
    const same = startFromRung(ctxBase as never, optionFor(req, source, cert), req, 'medium', null, { startDate: '2026-10-05' });
    if (!same.ok) throw new Error(same.reason);
    expect(same.subjectChanged).toBe(false);
    expect(same.version.certificate).toBe(cert);
    expect(same.subject.schedule).toBe(same.version.schedule);
    expect(same.subject.request).toBe(same.plan.request);
    // the unchanged route re-validates on the stored subject itself
    expect(revalidatePlanSafety(same.subject.request, same.subject.schedule, { boundary: 'start', certificate: same.version.certificate }).certificateValid).toBe(cert.status === 'verified');
    for (const date of ['2026-10-12', '2026-10-08']) {
      const moved = startFromRung(ctxBase as never, optionFor(req, source, cert), req, 'medium', null, { startDate: date });
      if (!moved.ok) throw new Error(moved.reason);
      expect(moved.subjectChanged).toBe(true);
      expect(moved.version.certificate).toBeUndefined();
      expect(moved.sourceCertificate).toBe(cert);
      expect(moved.subject.request.startDate).toBe(date);
      expect(moved.subject.schedule.startDate).toBe(date);
      // the source certificate can never authorize the changed subject
      expect(revalidatePlanSafety(moved.subject.request, moved.subject.schedule, { boundary: 'start', certificate: cert }).certificateValid).toBe(false);
      expect(sameSafetySubject({ request: req, schedule: source }, moved.subject)).toBe(false);
    }
  });

  it('a date-only shift re-evaluates the clinician envelope: reviewBy 10-07, chosen 10-12 is refused on the final subject', () => {
    const env = envelope({ convention: 'pctVo2max', max: 30, unit: '%' }, { reviewBy: '2026-10-07' });
    const r = request(withFlags(MAN_95, { symptoms: [CHEST], exerciseEnvelopes: [env] }), FAT_LOSS_KEEP_LEAN, { horizonDays: 28, startDate: '2026-10-05' }) as PlannerRequestV2;
    const s = withCardio(cleanSchedule(r), { pctVo2max: 0.25 });
    const cert = certify(r, s);
    const start10 = revalidatePlanSafety(r, s, { boundary: 'start', certificate: cert });
    expect(start10.evaluation.exercise.gate).toBe('envelope');
    const moved = startFromRung(ctxBase as never, optionFor(r, s, cert), r, 'medium', null, { startDate: '2026-10-12' });
    if (!moved.ok) throw new Error(moved.reason);
    const final = revalidatePlanSafety(moved.subject.request, moved.subject.schedule, { boundary: 'start', certificate: moved.version.certificate ?? null });
    expect(final.evaluation.exercise.gate).toBe('suspended');
    expect(final.status).toBe('violation');
    expect(final.startable).toBe(false);
  });

  it('the entered review date governs the prescription days after it: sessions past it are refused, repair removes them', () => {
    const env = envelope({ convention: 'pctVo2max', max: 30, unit: '%' }, { reviewBy: '2026-10-14' });
    const r = request(withFlags(MAN_95, { symptoms: [CHEST], exerciseEnvelopes: [env] }), FAT_LOSS_KEEP_LEAN, { horizonDays: 28, startDate: '2026-10-05' });
    const ctx = compileRequest(r);
    expect(ctx.caps.exercise.gateChange).toEqual({ day: 10, date: '2026-10-15', gate: 'suspended' });
    const s = withCardio(cleanSchedule(r), { pctVo2max: 0.25 });
    const e = evaluatePlanSafety(ctx, s, null);
    expect(e.exercise.ok).toBe(false);
    expect(e.exercise.reasons.some((x) => /after the clinician review date 2026-10-15/.test(x))).toBe(true);
    expect(validatePlan(ctx, s).reasons.some((x) => x.startsWith('HC-X4.envelope'))).toBe(true);
    const fixed = repairSchedule(ctx, s).schedule;
    const fe = evaluatePlanSafety(ctx, fixed, null);
    expect(fe.exercise.reasons.filter((x) => /review date/.test(x))).toEqual([]);
    // the sessions before the review date stay
    expect(fixed.days.slice(0, 10).some((d) => (d.override?.exercise ?? []).length > 0)).toBe(true);
  });

  it('one declared final audit of the changed subject: the stored fingerprint equals what is checked; a failed source is never re-audited', () => {
    const cert = certify(req, source);
    const moved = startFromRung(ctxBase as never, optionFor(req, source, cert), req, 'medium', null, { startDate: '2026-10-09' });
    if (!moved.ok) throw new Error(moved.reason);
    const small = { ...cert, drawProtocol: { ...cert.drawProtocol!, M: 2 } };
    const fin = finalSubjectCertificate({ request: moved.subject.request, schedule: moved.subject.schedule, source: small, episodeId: 'final-1', createdAt: '' });
    expect(fin.certificate).not.toBeNull();
    const c = fin.certificate!;
    expect(c.history?.[0]).toMatchObject({ fingerprint: cert.fingerprint, episodeId: cert.episodeId });
    expect(c.auditSubjectHash).toBe(auditSubjectHash(moved.subject.schedule));
    const docs = withFinalCertificate(moved, c);
    const check = revalidatePlanSafety(docs.subject.request, docs.subject.schedule, { boundary: 'start', certificate: docs.version.certificate });
    expect(check.fingerprint).toBe(c.fingerprint);
    expect(check.certificateValid).toBe(c.status === 'verified');
    // a deterministic recheck reproduces the same draws and result (no new sampling opportunity)
    const again = finalSubjectCertificate({ request: moved.subject.request, schedule: moved.subject.schedule, source: small, episodeId: 'final-1', createdAt: '' }).certificate!;
    expect(again.audit).toEqual(c.audit);
    expect(finalSubjectCertificate({ request: moved.subject.request, schedule: moved.subject.schedule, source: { ...small, status: 'failed' }, episodeId: 'final-2', createdAt: '' })).toEqual({ certificate: null, reason: 'sourceAuditFailed' });
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------ A1-006

describe('A1-006: unknown and rejected mandatory definitions are never silently dropped', () => {
  it('an unknown clinician sodium cap is kept with its value/unit/source for review: no verified certificate, not startable', () => {
    const req = withLocks([{ id: 'sodium-cap', value: 2000, unit: 'mg/d', source: 'clinician' }]);
    const ctx = compileRequest(req);
    expect(ctx.caps.constraints.review).toContainEqual(expect.objectContaining({ id: 'sodium-cap', reason: 'unsupportedDefinition', value: 2000, unit: 'mg/d', source: 'clinician', mandatory: true }));
    const s = cleanSchedule(req);
    expect(evaluatePlanSafety(ctx, s, null).status).toBe('review');
    const cert = certify(req, s);
    expect(cert.status).not.toBe('verified');
    expect(revalidatePlanSafety(req, s, { boundary: 'start', certificate: cert }).startable).toBe(false);
  });

  it('a negative caffeine cap is surfaced as rejected with its original value and blocks verification; a known violation stays', () => {
    const req = withLocks([{ id: 'caffeine-cap', value: -1, unit: 'mg/d', source: 'clinician' }]);
    const ctx = compileRequest(req);
    const s = cleanSchedule(req);
    const e = evaluatePlanSafety(ctx, s, null);
    expect(e.rejected).toContainEqual(expect.objectContaining({ constraintId: 'caffeine-cap', reason: 'negativeValue', value: -1, unit: 'mg/d', mandatory: true }));
    expect(e.status).toBe('review');
    expect(plannerCertificateInputs(ctx, s, REQUIRED_SAFETY_MARGIN_IDS, PROTOCOL).rejected).toHaveLength(1);
    // a simultaneous known violation (caffeine 300 mg/d against a valid 200 mg/d cap) is kept
    const both = withLocks([{ id: 'caffeine-cap', value: -1, unit: 'mg/d', source: 'clinician' }, { id: 'caffeine-cap', value: 200, unit: 'mg/d', source: 'marker' }]);
    const caf: Schedule = { ...cleanSchedule(both), programs: cleanSchedule(both).programs.map((t) => ({ ...t, substances: { ...t.substances, caffeine: [{ clockH: 8, mg: 150 }, { clockH: 13, mg: 150 }] } })) };
    expect(evaluatePlanSafety(compileRequest(both), caf, null).status).toBe('violation');
  });

  it('nonfinite / missing values need review; supported boolean locks keep their effects and add no review', () => {
    const nf = compileRequest(withLocks([{ id: 'protein-cap', value: Number.NaN, unit: 'g/kg', source: 'clinician' }, { id: 'carb-floor', unit: 'g/d', source: 'clinician' } as Lock]));
    expect(nf.caps.constraints.review.map((r) => r.reason)).toEqual(['missingOrNonFiniteValue', 'missingOrNonFiniteValue']);
    const sem = compileRequest(withLocks([{ id: 'no-ketogenic' }, { id: 'no-exercise-prescription' }, { id: 'no-vled' }, { id: 'no-potassium-supplement' }] as Lock[]));
    expect(sem.caps.constraints.review).toEqual([]);
    expect(sem.caps.carbFloorG).toBeGreaterThanOrEqual(50);
    expect(sem.caps.exercise.allowed).toBe(false);
    // the semantic potassium lock is the typed supplement-only bound 0 g/d
    expect(sem.caps.constraints.merged.find((d) => d.id === 'no-potassium-supplement')).toMatchObject({ quantity: 'potassiumSupplementPerDay', value: 0, scope: 'supplementOnly' });
  });

  it('an optional unknown preference is explained without blocking unrelated planning or hiding a known violation', () => {
    const req = withLocks([{ id: 'my-own-limit', value: 3, unit: 'cups', source: 'user' }]);
    const ctx = compileRequest(req);
    expect(ctx.caps.constraints.review).toContainEqual(expect.objectContaining({ id: 'my-own-limit', mandatory: false, reason: 'unsupportedDefinition' }));
    const s = cleanSchedule(req);
    expect(evaluatePlanSafety(ctx, s, null).status).not.toBe('review');
  });
});

// ------------------------------------------------------------------------------------------------ A1-007

describe('A1-007: normalized supplement actives join the final checks in canonical units', () => {
  const locks: Lock[] = [
    { id: 'potassium-supp-cap', value: 0, unit: 'g/d', source: 'clinician' },
    { id: 'caffeine-cap', value: 200, unit: 'mg/d', source: 'clinician' },
    { id: 'creatine-cap', value: 3, unit: 'g/d', source: 'clinician' },
  ];
  const req = withLocks(locks);
  const ctx = compileRequest(req);
  const base = cleanSchedule(req);
  const withSubs = (subs: DayTemplate['substances']): Schedule => ({ ...base, programs: base.programs.map((t) => ({ ...t, substances: { ...t.substances, ...subs } })) });
  const statusOf = (s: Schedule, id: string) => evaluatePlanSafety(ctx, s, null).evaluations.find((e) => e.constraintId === id)!;

  it('3 g elemental potassium, 1000 mg caffeine and 10 g creatine actives violate their caps even with empty legacy channels', () => {
    const s = withSubs({ caffeine: [], creatineG: 0, actives: [{ ingredient: 'potassium', amount: 3, unit: 'g', origin: 'planned' }, { ingredient: 'caffeine', amount: 1000, unit: 'mg', origin: 'planned' }, { ingredient: 'creatine', amount: 10000, unit: 'mg', origin: 'planned' }] });
    expect(statusOf(s, 'potassium-supp-cap')).toMatchObject({ status: 'violation', capability: 'enforced' });
    expect(statusOf(s, 'caffeine-cap').status).toBe('violation');
    expect(statusOf(s, 'creatine-cap').status).toBe('violation');
    const v = validatePlan(ctx, s);
    expect(v.reasons.some((r) => r.startsWith('lock.potassium-supp-cap'))).toBe(true);
    expect(v.reasons.some((r) => r.startsWith('lock.caffeine-cap'))).toBe(true);
    expect(v.reasons.some((r) => r.startsWith('HC-M12'))).toBe(true);
  });

  it('a linked event counts once; doses without identity on both sides are an interval, never a double count', () => {
    const linked = withSubs({ caffeine: [{ clockH: 8, mg: 150, eventId: 'e1' }], actives: [{ ingredient: 'caffeine', amount: 150, unit: 'mg', eventId: 'e1', origin: 'observed' }] });
    const x = resolvedExposure(ctx, linked, null);
    expect(x.caffeineMg[0]).toBe(150);
    expect(x.caffeineHiMg[0]).toBe(150);
    expect(statusOf(linked, 'caffeine-cap').status).toBe('pass');
    const ambiguous = withSubs({ caffeine: [{ clockH: 8, mg: 150 }], actives: [{ ingredient: 'caffeine', amount: 150, unit: 'mg', origin: 'planned' }] });
    const y = resolvedExposure(ctx, ambiguous, null);
    expect([y.caffeineMg[0], y.caffeineHiMg[0]]).toEqual([150, 300]);
    expect(statusOf(ambiguous, 'caffeine-cap').status).toBe('unchecked');
    const distinct = withSubs({ caffeine: [{ clockH: 8, mg: 150, eventId: 'a' }], actives: [{ ingredient: 'caffeine', amount: 0.1, unit: 'g', eventId: 'b', origin: 'planned' }] });
    expect(resolvedExposure(ctx, distinct, null).caffeineMg[0]).toBe(250);
    expect(statusOf(distinct, 'caffeine-cap').status).toBe('violation');
  });

  it('a genuinely absent potassium source proves zero for the prescribed scope; an incompletely observed one stays unchecked', () => {
    expect(statusOf(base, 'potassium-supp-cap')).toMatchObject({ status: 'pass', capability: 'satisfiedByConstruction', reasonCode: 'prescribedScopeOnly' });
    const observed: Schedule = { ...base, days: base.days.map((d, i) => (i === 0 ? { ...d, override: { ...d.override, observed: { coverage: { supplements: 'partial' }, resolution: 'daily' } } } : d)) } as Schedule;
    expect(statusOf(observed, 'potassium-supp-cap').status).toBe('unchecked');
    const molar = withSubs({ actives: [{ ingredient: 'potassium', amount: 10, unit: 'mmol', origin: 'planned' }] });
    expect(statusOf(molar, 'potassium-supp-cap').status).toBe('unchecked');
  });
});

// ------------------------------------------------------------------------------------------------ A1-008

describe('A1-008: an ordinary explicit meal list is not an exemption from daily floors', () => {
  const req = withLocks([{ id: 'carb-floor', value: 130, unit: 'g/d', source: 'clinician' }]);
  const ctx = compileRequest({ ...req, horizonDays: 7 });
  const explicit = scheduleOf({ ...EAT, meals: { meals: [{ clockH: 8, share: 1 }, { clockH: 13, share: 1 }, { clockH: 19, share: 1 }] } });
  const shorthand = scheduleOf({ ...EAT, meals: { count: 3, window: { startH: 8, lengthH: 11 } } });

  it('2779 kcal with 100 g carbohydrate on explicit 08/13/19 meals violates a mandatory 130 g/day floor, like the shorthand', () => {
    for (const s of [explicit, shorthand]) {
      const x = resolvedExposure(ctx, s, null);
      expect(Array.from(x.fastExempt)).toEqual([0, 0, 0, 0, 0, 0, 0]);
      const e = evaluatePlanSafety(ctx, s, null);
      expect(e.evaluations.find((v) => v.constraintId === 'carb-floor')?.status).toBe('violation');
      expect(e.status).toBe('violation');
    }
    expect(Array.from(resolvedExposure(ctx, explicit, null).floorDay)).toEqual(Array.from(resolvedExposure(ctx, shorthand, null).floorDay));
    // the independent validator applies the same floor to both representations
    expect(validatePlan(ctx, explicit).reasons.some((r) => r.startsWith('HC-M4'))).toBe(true);
    expect(validatePlan(ctx, shorthand).reasons.some((r) => r.startsWith('HC-M4'))).toBe(true);
  });

  it('declared fast and refeed days stay exempt; a meal list cannot create the exemption', () => {
    const fast = { ...explicit, events: [{ kind: 'fast' as const, startDay: 2, startH: 19, durationH: 24, electrolytes: true, refeed: 'none' as const }] };
    const x = resolvedExposure(ctx, fast, null);
    expect(x.fastExempt[2]).toBe(1);
    expect(x.fastExempt[3]).toBe(1);
    expect(x.fastExempt[0]).toBe(0);
    // a clinician floor is not waived by the 17 low-energy eating-day exemption (a policy semantics only)
    const low = scheduleOf({ ...EAT, energy: { kind: 'kcal', kcal: 700 }, macros: { protein: { unit: 'g', value: 60 }, carbs: { unit: 'g', value: 60 }, fat: { unit: 'remainder' } } });
    const def = ctx.caps.constraints.merged.find((d) => d.id === 'carb-floor')!;
    expect(evaluateConstraint(def, resolvedExposure(ctx, low, null), ctx).status).toBe('violation');
  });
});

// ------------------------------------------------------------------------------------------------ A1-011

describe('A1-011: the one audit evaluates the finalized frozen subject; a certificate binds only that subject', () => {
  it('issueCertificate: a bare screen or another subject never issues Verified', () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 });
    const s = cleanSchedule(req);
    const ctx = compileRequest(req);
    const e = evaluatePlanSafety(ctx, s, null);
    const inputs = plannerCertificateInputs(ctx, s, REQUIRED_SAFETY_MARGIN_IDS, PROTOCOL);
    const bare = issueCertificate(inputs, PASS16, e.status, { episodeId: 'x', createdAt: '' });
    expect(bare).toMatchObject({ status: e.status === 'verified' ? 'unchecked' : bare.status });
    const other = issueCertificate(inputs, { screen: PASS16, subjectHash: auditSubjectHash({ ...s, horizonDays: s.horizonDays }) + 'x', protocol: PROTOCOL }, e.status, { episodeId: 'x', createdAt: '' });
    expect(other.status).not.toBe('verified');
    const bound = issueCertificate(inputs, { screen: PASS16, subjectHash: auditSubjectHash(s), protocol: PROTOCOL }, e.status, { episodeId: 'x', createdAt: '' });
    expect(bound.status).toBe(e.status === 'verified' ? 'verified' : 'unchecked');
    const wrongProtocol = issueCertificate(inputs, { screen: PASS16, subjectHash: auditSubjectHash(s), protocol: { M: 16, seed: 'other' } }, e.status, { episodeId: 'x', createdAt: '' });
    expect(wrongProtocol.status).not.toBe('verified');
  });

  it('pipeline: a port finalizes each chosen candidate once; a finalization-only failure fails the screen with no second audit', async () => {
    const toy = functionToy(
      [
        { id: 'base', dim: 0, tags: [] },
        { id: 'lin', dim: 1, tags: [] },
      ],
      [{ id: 'g', sense: 'max' }],
      { structure: 0, x: [] },
      (_s, i, x) => {
        const v = i === 0 ? 0 : x[0]!;
        return { goals: [v], margins: [(0.8 - v) / 0.8], descriptors: [v] };
      },
    );
    const calls: string[] = [];
    const port = {
      audit(structure: number, x: Float64Array, M: number): FinalAuditSubject {
        calls.push(`${structure}|${Array.from(x).join(',')}`);
        const pass: EvalOutput = { goals: [0], margins: [1], regulariser: 0, descriptors: [] };
        // the finalized subject breaks a margin nominally although the decoded candidate passed
        return { outputs: Array.from({ length: M }, () => pass), nominal: { ...pass, margins: [-0.1] }, subjectHash: `final-${structure}`, protocol: { seed: 'ens', M } };
      },
    };
    const res = await runPlanner(toy.problem, createLocalEvaluator(toy.model, toy.problem.structures), { seed: 'audit', tier: 'S', totalEU: 600, ensembleSize: 8, holdoutSize: 8, safetyAuditSize: 4, safetyAuditProtocol: { seed: 'ens' }, auditSubject: port });
    expect(res.options.length).toBeGreaterThan(0);
    expect(calls.length).toBe(res.options.length);
    for (const o of res.options) {
      expect(o.safetyAudit.screen).toMatchObject({ status: 'fail', reasonCode: 'knownViolation' });
      expect(o.safetyAudit.subjectHash).toBe(`final-${o.structureIndex}`);
      expect(o.safetyAudit.seed).toBe('ens');
      expect(o.safetyAudit.attempt).toBe(1);
    }
    // no port: the decoded genome is audited and no subject is bound; the seed is the declared evaluator ensemble
    const plain = await runPlanner(toy.problem, createLocalEvaluator(toy.model, toy.problem.structures), { seed: 'audit', tier: 'S', totalEU: 600, ensembleSize: 8, holdoutSize: 8, safetyAuditSize: 4, safetyAuditProtocol: { seed: 'ens' } });
    for (const o of plain.options) {
      expect(o.safetyAudit.subjectHash).toBeNull();
      expect(o.safetyAudit.seed).toBe('ens');
    }
  });

  it('auditFrozenSchedule evaluates exactly the given schedule and reports its hash and parameter vectors', () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 });
    const ctx = compileRequest(req);
    const s = cleanSchedule(req);
    const model = new EnginePlanModel(ctx, { bindings: [], ensemble: { seed: 'base', size: 2, safetyAuditSize: 2 } });
    const r = auditFrozenSchedule(model, s, { M: 2, seed: 'base' });
    expect(r.outputs).toHaveLength(2);
    expect(r.subjectHash).toBe(auditSubjectHash(s));
    // the recorded protocol recreates every evaluated parameter vector (stream 'ensemble/safetyAudit', LHS, m ascending)
    const defs = buildModelParams(MODULES).defs;
    const P = variableParamCount(defs);
    const U = latinHypercube(2, P, new Rng('base').fork('ensemble/safetyAudit'));
    const params = [0, 1].map((m) => Array.from(quantilesToParams(defs, U.subarray(m * P, (m + 1) * P))));
    expect(r.protocol.paramsHash).toBe(contentHash({ stream: 'ensemble/safetyAudit', params }));
  });
});

// ------------------------------------------------------------------------------------------------ A1-012

describe('A1-012: the certificate binds the actual audit initial state and controller, separately from history', () => {
  it('0 vs +150 kcal/day correction: different state hashes; a certificate under one never validates under the other', () => {
    const fx = makePlan({ pick: (s) => /^B1(\[|$)/.test(s.id) });
    const s0 = confirmedState(fx.plan, 7, { deltaMean: 0 });
    const s150 = confirmedState(fx.plan, 7, { deltaMean: 150 });
    const h0 = replanStateHash({ state: s0, plan: fx.plan });
    const h150 = replanStateHash({ state: s150, plan: fx.plan });
    expect(h0).not.toBe(h150);
    // a snapshot with the same compatibility key but other content is another state
    const sameKey = { ...s0, snapshot: { ...s0.snapshot, t0WeightErrKg: s0.snapshot.t0WeightErrKg + 0.25 } };
    expect(sameKey.snapshot.key).toBe(s0.snapshot.key);
    expect(replanStateHash({ state: sameKey, plan: fx.plan })).not.toBe(h0);
    // a changed trend or particle weights is another state too
    expect(replanStateHash({ state: { ...s0, trendWeight: { ...s0.trendWeight, kg: s0.trendWeight.kg + 0.1 } }, plan: fx.plan })).not.toBe(h0);
    // the certificate issued under the +150 state: valid only with that current state; missing state is never valid
    const req = fx.plan.request;
    const cert = certify(req, fx.plan.schedule, { historyHash: 'hist', stateHash: h150 });
    const ok = revalidatePlanSafety(req, fx.plan.schedule, { boundary: 'adopt', certificate: cert, historyHash: 'hist', stateHash: h150 });
    expect(ok.certificateValid).toBe(cert.status === 'verified');
    expect(revalidatePlanSafety(req, fx.plan.schedule, { boundary: 'adopt', certificate: cert, historyHash: 'hist', stateHash: h0 }).certificateValid).toBe(false);
    expect(revalidatePlanSafety(req, fx.plan.schedule, { boundary: 'adopt', certificate: cert, historyHash: 'hist' })).toMatchObject({ certificateValid: false, startable: false });
    // the canonical state hash survives a worker transport (structured clone) unchanged
    expect(auditStateHash({ ...structuredClone(s150), anchorDay: 7 })).toBe(auditStateHash({ ...s150, anchorDay: 7 }));
  });

  it('real re-plans under correction 0 and +150 kcal/day bind different states; neither validates under the other', async () => {
    const fx = makePlan({ pick: (s) => /^B1(\[|$)/.test(s.id) });
    const shared: Schedule = { ...fx.plan.schedule, realised: { historyHash: 'hist-10', asOf: '2026-10-15T06:00:00.000Z', contractVersion: 1, throughDay: 10 } } as Schedule;
    const run = async (mean: number) => {
      const req = { ...replanRequest(fx.plan, confirmedState(fx.plan, 7, { deltaMean: mean, deltaSd: 60 }), 10, 'weekly', { logs: logsAsPlanned(fx.plan, 7, 10) }), realisedSchedule: shared };
      return { req, r: await replan(req, { totalEU: 60 }) };
    };
    const a = await run(0);
    const b = await run(150);
    const ha = replanStateHash(a.req);
    const hb = replanStateHash(b.req);
    expect(ha).not.toBe(hb);
    // the immutable observation history is the same; the derived state is not
    expect(a.r.safety!.historyHash).toBe(b.r.safety!.historyHash);
    for (const [x, own, other] of [[a, ha, hb], [b, hb, ha]] as const) {
      const sf = x.r.safety!;
      const subject = replanSafetySubject(x.r.plan, x.req.today);
      const atOwn = revalidatePlanSafety(subject.request, subject.schedule, { boundary: 'adopt', certificate: sf.certificate, historyHash: sf.historyHash, stateHash: own, elapsedDays: 10 });
      expect(atOwn.fingerprint).toBe(sf.certificate.fingerprint);
      expect(atOwn.certificateValid).toBe(sf.certificate.status === 'verified');
      const atOther = revalidatePlanSafety(subject.request, subject.schedule, { boundary: 'adopt', certificate: sf.certificate, historyHash: sf.historyHash, stateHash: other, elapsedDays: 10 });
      expect(atOther.fingerprint).not.toBe(sf.certificate.fingerprint);
      expect(atOther.startable).toBe(false);
    }
  }, 300_000);
});

// ------------------------------------------------------------------------------------------------ A1-014

describe('A1-014: unknown nutrient analysis is a lower bound, never a zero', () => {
  const kcalOnly = (macros?: { proteinG?: number; carbG?: number; fatG?: number }) =>
    scheduleOf({ ...EAT, energy: { kind: 'kcal', kcal: 2100 }, meals: { meals: [8, 13, 19].map((clockH) => ({ clockH, energyKcal: 700, ...(macros ? { macros } : {}) })) } }, 14);
  const req = withLocks([
    { id: 'protein-cap', value: 70 / 95, unit: 'g/kg', source: 'clinician' },
  ]);
  const ctx = compileRequest({ ...req, horizonDays: 14 });
  const cap = (quantity: 'proteinPerDay' | 'carbPerDay', value: number, comparator: 'cap' | 'floor' = 'cap') =>
    ({ id: `${quantity}-${comparator}-${value}`, quantity, unit: 'g/d', comparator, value, basis: 'notApplicable', scope: 'total', window: { kind: 'day' }, applicability: 'applicable', mandatory: true, source: { kind: 'clinician' }, policyVersion: 1 }) as const;

  it('energy-only 700 kcal × 3: energy is known, P/C caps are unchecked (no numeric zero passes a cap)', () => {
    const x = resolvedExposure(ctx, kcalOnly(), null);
    expect(x.energyKcal[0]).toBeCloseTo(2100, 0);
    expect(Number.isNaN(x.proteinHiG[0]!)).toBe(true);
    expect(Number.isNaN(x.carbHiG[0]!)).toBe(true);
    expect(evaluateConstraint(cap('proteinPerDay', 70), x, ctx).status).toBe('unchecked');
    expect(evaluateConstraint(cap('carbPerDay', 100), x, ctx).status).toBe('unchecked');
  });

  it('explicit known protein 30 g per meal: protein exact 90 g/day while absent C/F stay unknown', () => {
    const x = resolvedExposure(ctx, kcalOnly({ proteinG: 30 }), null);
    expect(evaluateConstraint(cap('proteinPerDay', 100), x, ctx).status).toBe('pass');
    expect(evaluateConstraint(cap('proteinPerDay', 80), x, ctx).status).toBe('violation');
    expect(evaluateConstraint(cap('carbPerDay', 100), x, ctx).status).toBe('unchecked');
  });

  it('mixed known 60 g + an unknown meal: lower bound 60 — cap 50 fails, cap 100 unchecked, floor 50 proven on an eating day', () => {
    const s = scheduleOf({ ...EAT, energy: { kind: 'kcal', kcal: 1900 }, meals: { meals: [{ clockH: 8, energyKcal: 1200, macros: { proteinG: 60, carbG: 150, fatG: 40 } }, { clockH: 18, energyKcal: 700 }] } }, 14);
    const x = resolvedExposure(ctx, s, null);
    expect(x.proteinG[0]).toBeCloseTo(60, 6);
    expect(evaluateConstraint(cap('proteinPerDay', 50), x, ctx).status).toBe('violation');
    expect(evaluateConstraint(cap('proteinPerDay', 100), x, ctx).status).toBe('unchecked');
    expect(evaluateConstraint(cap('proteinPerDay', 50, 'floor'), x, ctx).status).toBe('pass');
  });

  it('explicit 0 macros are known zeros; ordinary prescriptions stay construction-complete', () => {
    const zero = resolvedExposure(ctx, kcalOnly({ proteinG: 0, carbG: 0, fatG: 0 }), null);
    expect(zero.proteinHiG[0]).toBe(0);
    expect(evaluateConstraint(cap('proteinPerDay', 70), zero, ctx).status).toBe('pass');
    const plain = resolvedExposure(ctx, scheduleOf(EAT, 14), null);
    expect(plain.partialNutrientDays.protein).toBe(0);
    expect(plain.proteinHiG[0]).toBe(plain.proteinG[0]);
  });

  it('the engine asserts no protein/fat deficiency from unknown analysis (no W-M01…W-M07 from placeholders)', () => {
    const sim = new EnginePlanModel(ctx, { bindings: [], recordAll: true, fullMode: true }).simulate(kcalOnly(), -1);
    const ids = sim.warnings.map((w) => w.id);
    for (const id of ['W-M01', 'W-M02', 'W-M06', 'W-M07', 'W-M08']) expect(ids).not.toContain(id);
    // known zero fat stays a known zero: the very-low-fat rule may fire
    const known = new EnginePlanModel(ctx, { bindings: [], recordAll: true, fullMode: true }).simulate(kcalOnly({ proteinG: 30, carbG: 120, fatG: 0 }), -1);
    expect(known.warnings.some((w) => w.id === 'W-M07' || w.id === 'W-M06')).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ A1-035

describe('A1-035: the audit protocol is the evaluator ensemble, declared once at host creation', () => {
  it('the declared protocol carries the ensemble seed and M, never a search seed', () => {
    const init = { request: request(MAN_95, FAT_LOSS_KEEP_LEAN), ensemble: { seed: 'base', size: 16, safetyAuditSize: 16 } };
    expect(auditProtocolOf(init)).toMatchObject({ seed: 'base', M: 16, stream: 'ensemble/safetyAudit', sampler: 'lhs', order: 'memberAscending' });
  });

  it('local and pooled evaluators give the same audit protocol identity and certificate (search seed ≠ ensemble seed)', async () => {
    const req = { ...request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 }), budget: { tier: 'S', totalEU: 400, ensembleSize: 2 } } as unknown as PlannerRequestV2;
    const opts = { tier: 'S' as const, ideal: false, limitCosts: false, timeToTarget: false, algorithm: 'v2' as const };
    const local = await runLadderPlanner(req, opts);
    const pooled = await runLadderPlanner(req, {
      ...opts,
      evaluatorFor: (v, init) => {
        const hosts = [new EvaluatorHost(init), new EvaluatorHost(init)];
        return createPooledEvaluator(hosts.map((h) => (batch) => h.evaluate(v, batch)), 3);
      },
    });
    const certOf = (r: typeof local) => r.rungs.hard?.safety?.certificate as PlannerSafetyCertificate | undefined;
    const a = certOf(local);
    const b = certOf(pooled);
    expect(a).toBeDefined();
    expect(b?.fingerprint).toBe(a!.fingerprint);
    expect(b?.auditProtocol).toEqual(a!.auditProtocol);
    expect(a!.drawProtocol?.seed).toBe(local.provenance.seed);
  }, 600_000);
});

// ------------------------------------------------------------------------------------------------ A1-011 / A1-035 real run

describe('A1-011 / A1-035: a real hybrid run with a home training profile', () => {
  const HOME = { owned: ['dumbbell', 'bench', 'floor_mat', 'chair', 'pullup_bar'], access: [], refused: [], liked: [], injuries: [], skill: 2, purchaseAllowance: { maxPriceTier: 0, maxItems: 0 } };

  it('every certificate binds the finalized schedule its audit evaluated, under the base ensemble protocol (main and Ideal)', async () => {
    const req = { ...GOLDEN.c, horizonDays: 28, budget: { tier: 'S', totalEU: 600, ensembleSize: 2 }, training: HOME } as unknown as PlannerRequestV2;
    const res = await runLadderPlanner(req, { tier: 'S', limitCosts: false, timeToTarget: false });
    const base = res.provenance.seed;
    const defs = buildModelParams(MODULES).defs;
    const P = variableParamCount(defs);
    const expectedParams = (seed: string | number, M: number) => {
      const U = latinHypercube(M, P, new Rng(seed).fork('ensemble/safetyAudit'));
      return contentHash({ stream: 'ensemble/safetyAudit', params: Array.from({ length: M }, (_, m) => Array.from(quantilesToParams(defs, U.subarray(m * P, (m + 1) * P)))) });
    };
    const plans = [res.rungs.hard, res.rungs.medium, res.rungs.easy, res.ideal].filter((r): r is NonNullable<typeof r> => !!r);
    expect(plans.length).toBeGreaterThan(0);
    let composed = 0;
    let verified = 0;
    for (const r of plans) {
      const cert = r.safety?.certificate as PlannerSafetyCertificate | undefined;
      expect(cert).toBeDefined();
      if (!cert || cert.audit.M === 0) continue;
      // the audited subject is exactly the returned (finalized) schedule
      expect(cert.auditSubjectHash).toBe(auditSubjectHash(r.schedule));
      if (r.sessions?.length) composed++;
      if (cert.status === 'verified') verified++;
      // the protocol is the evaluator ensemble's (the Ideal's too), and it recreates every evaluated parameter vector
      expect(cert.drawProtocol?.seed).toBe(base);
      expect(cert.auditProtocol?.paramsHash).toBe(expectedParams(base, cert.drawProtocol!.M));
      // production lifecycle startability on the stored subject
      const v = revalidatePlanSafety(req, r.schedule, { boundary: 'start', certificate: cert });
      expect(v.fingerprint).toBe(cert.fingerprint);
      expect(v.startable).toBe(cert.status === 'verified' && v.evaluation.status === 'verified');
    }
    expect(composed).toBeGreaterThan(0);
    expect(verified).toBeGreaterThan(0);
  }, 900_000);
});

