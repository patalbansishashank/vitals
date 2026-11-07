// @vitest-environment node
/**
 * C5/C6 planner safety (D4-01, D4-02, D4-03) and the planner-side parts of D2-02, D5-02, D5-05 and D7-02:
 *  - exact joint scenario screen (no per-column quantile acceptance), missing/zero-member semantics, independent audit
 *    stream of the frozen candidate (no rerank), certificates and lifecycle re-validation;
 *  - typed lock checks on the final resolved schedule (fat %E, creatine, caffeine, unsupported food-quality bounds);
 *  - the exercise symptom gate across request compilation, repair and the validator;
 *  - the research index is never an objective; an out-of-domain measured baseline is never a goal;
 *  - living forecast bands are labelled scenario ranges; the re-plan's realised past resolves fasts in absolute time.
 */
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSIONS, certificateAuthorizes, iidZeroFailureLowerBound, normalizedMarginScore, requiredJointPasses, type SymptomReport } from '@/lib/bodyContracts';
import { compileSchedule } from '../../../core/compileSchedule';
import type { PersonProfile } from '../../../types/profile';
import type { DayTemplate, Schedule } from '../../../types/schedule';
import { TIER_ENSEMBLE, createLocalEvaluator, runPlanner } from '../../optim/pipeline';
import { jointScreenOf, robustSummary } from '../../optim/robust';
import { GoalSystem } from '../../optim/goals';
import { functionToy } from '../../optim/toys';
import { SAFETY_AUDIT_DRAW_OFFSET, isHoldoutDraw, isSafetyAuditDraw, type EvalOutput } from '../../optim/types';
import { NON_HEALTH_OBJECTIVE, compileRequest, labBaselineDomainIssue } from '../context';
import { mergeDay } from '../dayMath';
import { baselineSchedule } from '../decode';
import { servesFasting } from '../evidenceGraph';
import { EnginePlanModel, REQUIRED_SAFETY_MARGIN_IDS, missingStateMargins } from '../model';
import { repairSchedule } from '../repair';
import { realise, replan, replanSafetySubject, replanStateHash } from '../replan';
import { exerciseGateOf } from '../safety';
import {
  auditSubjectHash,
  checkExerciseGate,
  contextForSchedule,
  evaluatePlanSafety,
  issueCertificate,
  optionSafetyOf,
  optionSafetyStatus,
  canonicalProfileSafety,
  plannerCertificateInputs,
  revalidatePlanSafety,
  safetySubject,
  verifiedLimitNotes,
} from '../safetyAudit';
import { lifecycleSafetyGate } from '@/living/lifecycleSafety';
import { LIVING_SCENARIO_BAND_META, bandsOf, dayTemplate } from '../sensitivities';
import type { PlannerRequest, PlannerRequestV2 } from '../types';
import { runLadderPlanner } from '../ladderPlanner';
import { validatePlan } from '../validate';
import { FAT_LOSS_KEEP_LEAN, MAN_95, request } from './personas';
import { confirmedState, logsAsPlanned, makePlan, replanRequest } from './replan.fixtures';

const out = (margins: number[], missing?: number[]): EvalOutput => ({ goals: [1], margins, regulariser: 0, descriptors: [], ...(missing ? { missing } : {}) });

function goals1() {
  const gs = new GoalSystem([{ id: 'g', sense: 'max' }]);
  gs.setBaseline([0]);
  gs.observe([2], true);
  return gs;
}

// ------------------------------------------------------------------------------------------------ D4-03 joint screen

describe('joint scenario screen (D4-03)', () => {
  it('disjoint per-constraint failures cannot pass, even with every interpolated P10 ≥ 0', () => {
    // 16 members, two margins: member 0 fails margin 0, member 1 fails margin 1 → 14 joint passes < 15
    const outs = Array.from({ length: 16 }, (_, m) => out([m === 0 ? -0.5 : 0.5, m === 1 ? -0.5 : 0.5]));
    const r = robustSummary(outs, goals1());
    for (const b of r.margins) expect(b.p10).toBeGreaterThanOrEqual(0);
    expect(r.chanceViolation).toBe(0);
    expect(r.joint).toMatchObject({ status: 'fail', M: 16, passes: 14, required: 15, reasonCode: 'belowRequired' });
    expect(r.chanceFeasible).toBe(false);
  });

  it('15 of 16 passes at alpha 0.1, 14 of 16 fails', () => {
    expect(requiredJointPasses(16)).toBe(15);
    const mk = (fails: number) => Array.from({ length: 16 }, (_, m) => out([m < fails ? -0.01 : 0.2]));
    expect(jointScreenOf(mk(1), [0]).status).toBe('pass');
    expect(jointScreenOf(mk(2), [0]).status).toBe('fail');
  });

  it('zero members, a missing required margin and a known violation: Unchecked / Unchecked / fail', () => {
    expect(jointScreenOf([], [0]).status).toBe('unchecked');
    expect(jointScreenOf([], [0]).reasonCode).toBe('noMembers');
    const miss = Array.from({ length: 16 }, (_, m) => out([0.3, 0.3], m === 3 ? [1] : undefined));
    const j = jointScreenOf(miss, [0, 1]);
    expect(j.status).toBe('unchecked');
    expect(j.missing).toEqual(['1']);
    const nonFinite = Array.from({ length: 4 }, () => out([Number.NaN]));
    expect(jointScreenOf(nonFinite, [0]).status).toBe('unchecked');
    expect(jointScreenOf(Array.from({ length: 16 }, () => out([1])), [0], 0.1, { knownViolation: true }).status).toBe('fail');
    // robustSummary with zero members is never chance-feasible
    expect(robustSummary([], goals1()).chanceFeasible).toBe(false);
  });

  it('positive rescaling of any margin column never changes joint acceptance; scalar ranking needs declared same-unit scales', () => {
    const outs = Array.from({ length: 16 }, (_, m) => out([m === 0 ? -1 : 0.4, 0.2 - 0.01 * m, m === 5 ? -0.1 : 3]));
    const base = jointScreenOf(outs, [0, 1, 2]);
    for (const s of [[1, 1, 1], [1000, 0.001, 9], [0.5, 2, 1e6]]) {
      const scaled = outs.map((o) => out(Array.from(o.margins, (v, c) => v * s[c]!)));
      const j = jointScreenOf(scaled, [0, 1, 2]);
      expect([j.status, j.passes]).toEqual([base.status, base.passes]);
    }
    expect(normalizedMarginScore({ fat: -10, kcal: 200 }, { fat: 10, kcal: 100 })).toBe(-1);
    expect(normalizedMarginScore({ fat: -10, kcal: 200 }, { fat: 10 })).toBeNull();
    expect(normalizedMarginScore({ fat: -10 }, { fat: 0 })).toBeNull();
  });

  it('the IID zero-failure bound is only a declared-IID audit quantity (0.829 for 16, 0.902 for 29)', () => {
    expect(iidZeroFailureLowerBound(16)!).toBeCloseTo(0.829, 3);
    expect(iidZeroFailureLowerBound(29)!).toBeCloseTo(0.902, 3);
  });
});

// ------------------------------------------------------------------------------------------------ D4-03 audit stream

/** One-structure toy: goal x, margin (0.8 − x)/0.8; audit draws return `auditMargin` (selection and holdout draws as nominal). */
function auditToy(auditMargin: number, seen: number[] = []) {
  return functionToy(
    [
      { id: 'base', dim: 0, tags: [] },
      { id: 'lin', dim: 1, tags: [] },
    ],
    [{ id: 'g', sense: 'max' }],
    { structure: 0, x: [] },
    (_s, i, x, draw) => {
      seen.push(draw);
      const v = i === 0 ? 0 : x[0]!;
      const margin = isSafetyAuditDraw(draw) ? auditMargin : (0.8 - v) / 0.8;
      return { goals: [v], margins: [margin], descriptors: [v] };
    },
  );
}

describe('independent safety audit of the frozen candidate (D4-03)', () => {
  const cfg = { seed: 'audit', tier: 'S' as const, totalEU: 600, ensembleSize: 8, holdoutSize: 8 };

  it('reserves a separate stream (M = the selection-ensemble size), records the audit and keeps the outcome holdout separate', async () => {
    const seen: number[] = [];
    const toy = auditToy(0.5, seen);
    const res = await runPlanner(toy.problem, createLocalEvaluator(toy.model, toy.problem.structures), cfg);
    expect(res.options.length).toBeGreaterThan(0);
    const audits = seen.filter(isSafetyAuditDraw);
    expect(audits.length).toBe(8 * res.options.length);
    expect(seen.filter(isHoldoutDraw).every((d) => d < SAFETY_AUDIT_DRAW_OFFSET)).toBe(true);
    for (const o of res.options) {
      expect(o.safetyAudit).toMatchObject({ stream: 'safetyAudit', M: 8, attempt: 1 });
      expect(o.safetyAudit.screen.status).toBe('pass');
      expect(o.selectionScreen?.M).toBe(8);
    }
    expect(res.provenance.stageEU['S5.safetyAudit']).toBe(8 * res.options.length);
    expect(TIER_ENSEMBLE).toEqual({ S: 16, M: 32, L: 64, X: 128 });
  });

  it('a failed audit is recorded and never reranks, repairs or reseeds the frozen choice', async () => {
    const ok = auditToy(0.5);
    const bad = auditToy(-0.5);
    const a = await runPlanner(ok.problem, createLocalEvaluator(ok.model, ok.problem.structures), cfg);
    const b = await runPlanner(bad.problem, createLocalEvaluator(bad.model, bad.problem.structures), cfg);
    expect(b.options.map((o) => [o.structureIndex, Array.from(o.x)])).toEqual(a.options.map((o) => [o.structureIndex, Array.from(o.x)]));
    for (const o of b.options) {
      expect(o.safetyAudit.screen.status).toBe('fail');
      expect(o.safetyAudit.attempt).toBe(1);
      // the selection screen passed: it never substitutes for the audit
      expect(o.selectionScreen?.status).toBe('pass');
      expect(optionSafetyStatus('verified', o.safetyAudit.screen)).toBe('review');
    }
  });

  it('no audit budget (size 0) is Unchecked, never verified', async () => {
    const toy = auditToy(0.5);
    const res = await runPlanner(toy.problem, createLocalEvaluator(toy.model, toy.problem.structures), { ...cfg, safetyAuditSize: 0 });
    for (const o of res.options) {
      expect(o.safetyAudit.notRun).toBe('disabled');
      expect(o.safetyAudit.screen.status).toBe('unchecked');
      expect(optionSafetyStatus('verified', o.safetyAudit.screen)).toBe('unchecked');
    }
  });

  it('option status: violation and conflict outrank the audit; an absent audit is Unchecked', () => {
    const pass = jointScreenOf(Array.from({ length: 16 }, () => out([1])), [0]);
    expect(optionSafetyStatus('verified', pass)).toBe('verified');
    expect(optionSafetyStatus('violation', pass)).toBe('violation');
    expect(optionSafetyStatus('conflict', pass)).toBe('conflict');
    expect(optionSafetyStatus('verified', null)).toBe('unchecked');
  });
});

// ------------------------------------------------------------------------------------------------ D4-01 final resolved checks

/** The habitual schedule with fat at `pct` % of energy on every day and no sessions. */
function fatSchedule(req: PlannerRequest, pct: number): Schedule {
  const ctx = compileRequest(req);
  const s = baselineSchedule(ctx);
  return { ...s, programs: s.programs.map((p) => ({ ...p, exercise: undefined, macros: { ...p.macros, fat: { unit: 'pctEnergy' as const, value: pct }, carbs: { unit: 'remainder' as const } } })) };
}

function simOf(req: PlannerRequest, s: Schedule) {
  const ctx = compileRequest(req);
  return new EnginePlanModel(ctx, { bindings: [], recordAll: true, fullMode: true }).simulate(s, -1);
}

describe('typed locks on the final resolved schedule (D4-01)', () => {
  const fatReq = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28, safety: { plannerLocks: [{ id: 'fat-cap', value: 15, unit: '%E', source: 'marker' }] } });

  it('fat cap 15 %E rejects a resolved higher-fat schedule (not merely a reason line)', () => {
    const ctx = compileRequest(fatReq);
    const s = fatSchedule(fatReq, 30);
    const e = evaluatePlanSafety(ctx, s, simOf(fatReq, s));
    const fat = e.evaluations.find((v) => v.constraintId === 'fat-cap')!;
    expect(fat.status).toBe('violation');
    expect(fat.margin!).toBeLessThan(-10);
    expect(e.status).toBe('violation');
    expect(validatePlan(ctx, s).reasons.some((r) => r.startsWith('lock.fat-cap'))).toBe(true);
    // a compliant schedule passes the same resolved check and only then earns a verified note
    const ok = fatSchedule(fatReq, 15);
    const e2 = evaluatePlanSafety(ctx, ok, simOf(fatReq, ok));
    expect(e2.evaluations.find((v) => v.constraintId === 'fat-cap')!.status).toBe('pass');
    expect(verifiedLimitNotes(e2.evaluations, ctx.caps.constraints.merged)).toEqual(['Total fat stays at or below 15 % of energy (blood result).']);
    expect(verifiedLimitNotes(e.evaluations, ctx.caps.constraints.merged)).toEqual([]);
  });

  it('repair writes fat as a share of energy so the cap holds at the runtime-resolved intake', () => {
    const ctx = compileRequest(fatReq);
    const r = repairSchedule(ctx, fatSchedule(fatReq, 30));
    expect(r.log.some((l) => l.rule === 'lock.fat-cap')).toBe(true);
    const e = evaluatePlanSafety(ctx, r.schedule, simOf(fatReq, r.schedule));
    expect(e.evaluations.find((v) => v.constraintId === 'fat-cap')!.status).toBe('pass');
  });

  it('refeed and fast-touched days are checked on the compiled, resolved intake', () => {
    const ctx = compileRequest(fatReq);
    const s = fatSchedule(fatReq, 30);
    const withFast: Schedule = { ...s, events: [{ kind: 'fast', startDay: 7, startH: 19, durationH: 72, refeed: 'auto' }] };
    const cs = compileSchedule(withFast, ctx.rp);
    expect(cs.days.some((d) => (d.refeedFactor ?? 1) < 1)).toBe(true);
    const e = evaluatePlanSafety(ctx, withFast, simOf(fatReq, withFast));
    expect(e.evaluations.find((v) => v.constraintId === 'fat-cap')!.status).toBe('violation');
  });

  it('a positive creatine cap (3 g/day) is enforced on the resolved dose; a caffeine mg/day cap on the day total', () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, {
      horizonDays: 28,
      safety: { plannerLocks: [{ id: 'creatine-cap', value: 3, source: 'import', unit: 'g/d' }, { id: 'caffeine-cap', value: 200, unit: 'mg/d', source: 'marker' }], optIns: { levers: ['L7'] } },
    });
    const ctx = compileRequest(req);
    const s0 = fatSchedule(req, 25);
    const s: Schedule = { ...s0, programs: s0.programs.map((p) => ({ ...p, substances: { creatineG: 4, caffeine: [{ clockH: 8, mg: 150 }, { clockH: 13, mg: 150 }] } })) };
    const e = evaluatePlanSafety(ctx, s, simOf(req, s));
    expect(e.evaluations.find((v) => v.constraintId === 'creatine-cap')!.status).toBe('violation');
    expect(e.evaluations.find((v) => v.constraintId === 'caffeine-cap')!.status).toBe('violation');
    const r = repairSchedule(ctx, s);
    const t = mergeDay(r.schedule.programs[r.schedule.days[0]!.program]!, r.schedule.days[0]!.override);
    expect(t.substances?.creatineG ?? 0).toBeLessThanOrEqual(3);
    expect((t.substances?.caffeine ?? []).reduce((a, c) => a + c.mg, 0)).toBeLessThanOrEqual(200);
    const e2 = evaluatePlanSafety(ctx, r.schedule, simOf(req, r.schedule));
    expect(e2.evaluations.find((v) => v.constraintId === 'creatine-cap')!.status).toBe('pass');
    expect(e2.evaluations.find((v) => v.constraintId === 'caffeine-cap')!.status).toBe('pass');
  });

  it('an unsupported mandatory saturated-fat or added-sugar limit cannot be verified or startable', () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28, safety: { plannerLocks: [{ id: 'satfat-cap', value: 7, source: 'marker' }] } });
    const ctx = compileRequest(req);
    const s = fatSchedule(req, 25);
    const e = evaluatePlanSafety(ctx, s, simOf(req, s));
    const sat = e.evaluations.find((v) => v.constraintId === 'satfat-cap')!;
    expect([sat.capability, sat.status]).toEqual(['unsupported', 'unchecked']);
    expect(e.status).toBe('unchecked');
    const pass = jointScreenOf(Array.from({ length: 16 }, () => out([1])), [0]);
    expect(optionSafetyOf(e, { audit: pass }).status).toBe('unchecked');
  });

  it('zero added alcohol is certified only for the planner-added scope; empty safety notes are not "safe"', () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28, safety: { plannerLocks: [{ id: 'alcohol-cap', value: 0, source: 'marker' }, { id: 'potassium-supp-cap', value: 0, source: 'marker' }] } });
    const ctx = compileRequest(req);
    const s = fatSchedule(req, 25);
    const e = evaluatePlanSafety(ctx, s, simOf(req, s));
    expect(e.evaluations.find((v) => v.constraintId === 'alcohol-cap')!.status).toBe('pass');
    const k = e.evaluations.find((v) => v.constraintId === 'potassium-supp-cap')!;
    expect([k.capability, k.reasonCode]).toEqual(['satisfiedByConstruction', 'prescribedScopeOnly']);
    // no audit → Unchecked, whatever the (empty) warnings say
    expect(optionSafetyOf(e, {}).status).toBe('unchecked');
  });
});

// ------------------------------------------------------------------------------------------------ certificates and lifecycle

describe('certificates bind the frozen plan and are re-validated at lifecycle boundaries (C5)', () => {
  const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 });
  const pass = jointScreenOf(Array.from({ length: 16 }, () => out([1])), [0]);
  const protocol = { M: 16, seed: 'cert' };

  function certified(r: PlannerRequest) {
    const ctx = compileRequest(r);
    const s = repairSchedule(ctx, fatSchedule(r, 25)).schedule;
    const e = evaluatePlanSafety(ctx, s, simOf(r, s));
    // (A1-011) the issuer hands over the audit with the subject it evaluated (a bare screen never issues Verified)
    const cert = issueCertificate(plannerCertificateInputs(ctx, s, REQUIRED_SAFETY_MARGIN_IDS, protocol), { screen: pass, subjectHash: auditSubjectHash(s), protocol }, e.status, { episodeId: 'ep1', createdAt: '' });
    return { ctx, s, e, cert };
  }

  it('a verified certificate authorizes only the identical plan, profile, locks and versions', () => {
    const { s, e, cert } = certified(req);
    expect(e.status).toBe('verified');
    expect(cert.status).toBe('verified');
    expect(cert.version).toBe(CONTRACT_VERSIONS.safetyCertificate);
    const same = revalidatePlanSafety(req, s, { boundary: 'start', certificate: cert, requiredMargins: REQUIRED_SAFETY_MARGIN_IDS, protocol });
    expect(same.certificateValid).toBe(true);
    expect(same.status).toBe('verified');
    expect(same.startable).toBe(true);
    // a changed schedule, lock, profile or draw protocol invalidates it
    const s2: Schedule = { ...s, horizonDays: s.horizonDays, programs: s.programs.map((p, i) => (i === 0 ? { ...p, steps: (p.steps ?? 6000) + 1 } : p)) };
    expect(revalidatePlanSafety(req, s2, { boundary: 'adopt', certificate: cert, requiredMargins: REQUIRED_SAFETY_MARGIN_IDS, protocol }).certificateValid).toBe(false);
    const locked: PlannerRequest = { ...req, safety: { plannerLocks: [{ id: 'caffeine-cap', value: 300, source: 'marker' }] } };
    const v = revalidatePlanSafety(locked, s, { boundary: 'resume', certificate: cert, requiredMargins: REQUIRED_SAFETY_MARGIN_IDS, protocol });
    expect(v.certificateValid).toBe(false);
    expect(v.startable).toBe(false);
    expect(revalidatePlanSafety(req, s, { boundary: 'replan', certificate: cert, requiredMargins: REQUIRED_SAFETY_MARGIN_IDS, protocol: { ...protocol, seed: 'other' } }).certificateValid).toBe(false);
    // a boolean never authorizes; a failed audit never yields a verified certificate
    expect(certificateAuthorizes({ ...cert, status: 'failed' }, cert.fingerprint)).toBe(false);
    const fail = jointScreenOf(Array.from({ length: 16 }, (_, m) => out([m < 4 ? -1 : 1])), [0]);
    expect(issueCertificate(plannerCertificateInputs(compileRequest(req), s, REQUIRED_SAFETY_MARGIN_IDS, protocol), fail, 'verified', { episodeId: 'ep1', createdAt: '' }).status).toBe('failed');
  });

  it('a symptom reported after the run blocks start / adopt / scenario start of the earlier plan (no unchecked carry-over)', () => {
    const { s, cert } = certified(req);
    const symptom: SymptomReport = { id: 'sx1', category: 'exertionalChestDiscomfort', status: 'new', reportedAt: '2026-10-10T08:00:00Z', context: 'exertional', source: 'user' };
    const later: PlannerRequest = { ...req, profile: { ...req.profile, safety: { mode: 'M0', flags: { symptoms: [symptom] } } } };
    for (const boundary of ['start', 'adopt', 'scenarioStart'] as const) {
      const v = revalidatePlanSafety(later, s, { boundary, certificate: cert, requiredMargins: REQUIRED_SAFETY_MARGIN_IDS, protocol });
      expect(v.certificateValid).toBe(false);
      expect(v.startable).toBe(false);
    }
  });

  it('start: the run request and the start request bind the same fingerprint (profile start date, JSON reload/sync)', () => {
    // the planner request carries the start on the request only; the lifecycle consumer compiles it onto the profile
    const { startDate: _sd, ...noStart } = req.profile;
    void _sd;
    const run: PlannerRequest = { ...req, startDate: '2026-10-05', profile: noStart };
    const { s, e, cert } = certified(run);
    expect(e.status).toBe('verified');
    const atStart: PlannerRequest = { ...run, profile: { ...noStart, startDate: '2026-10-05' } };
    const v = revalidatePlanSafety(atStart, s, { boundary: 'start', certificate: cert });
    expect(v.fingerprint).toBe(cert.fingerprint);
    expect(v.certificateValid).toBe(true);
    expect(v.status).toBe('verified');
    // persisted and reloaded (planner run state, plan version documents, sync): nothing in the fingerprint changes
    const j = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    const reloaded = revalidatePlanSafety(j(run), j(s), { boundary: 'start', certificate: j(cert) });
    expect(reloaded.fingerprint).toBe(cert.fingerprint);
    expect(reloaded.certificateValid).toBe(true);
  });

  it('start: screening mappings that agree in meaning bind the same certificate; a flag that changes a rule does not', () => {
    // the planner request's mapping writes "no opt-in" / "no medication" explicitly, the Simulator profile leaves them out
    const planner: PlannerRequest = { ...req, profile: { ...req.profile, safety: { mode: 'M0', flags: { fastingOptIn: 'none', diabetesMedication: 'none', gout: false, symptoms: [] } } } };
    const simulator: PlannerRequest = { ...req, profile: { ...req.profile, safety: { mode: 'M0', flags: {} } } };
    const bare: PlannerRequest = { ...req, profile: { ...req.profile, safety: undefined } };
    const { s, cert } = certified(planner);
    for (const r of [simulator, bare]) expect(revalidatePlanSafety(r, s, { boundary: 'start', certificate: cert }).fingerprint).toBe(cert.fingerprint);
    expect(canonicalProfileSafety(planner.profile.safety)).toEqual({ mode: 'M0', flags: {} });
    const restricted: PlannerRequest = { ...req, profile: { ...req.profile, safety: { mode: 'M0', flags: { exerciseRestriction: true } } } };
    expect(revalidatePlanSafety(restricted, s, { boundary: 'start', certificate: cert }).certificateValid).toBe(false);
    const optedIn: PlannerRequest = { ...req, profile: { ...req.profile, safety: { mode: 'M0', flags: { fastingOptIn: 'T2' } } } };
    expect(revalidatePlanSafety(optedIn, s, { boundary: 'start', certificate: cert }).certificateValid).toBe(false);
  });

  it('the outcome holdout is a separate field and never certifies safety', () => {
    const { e } = certified(req);
    const o = optionSafetyOf(e, { holdoutDraws: 32, audit: null });
    expect(o.outcomeHoldout).toEqual({ draws: 32, status: 'evaluated' });
    expect(o.status).toBe('unchecked');
  });
});

// ------------------------------------------------------------------------------------------------ D4-02 symptom gate

const withFlags = (p: PersonProfile, flags: NonNullable<PersonProfile['safety']>['flags'], habits?: PersonProfile['habits']): PersonProfile => ({
  ...p,
  ...(habits ? { habits } : {}),
  safety: { mode: 'M0', flags },
});
const chest = (status: SymptomReport['status'] = 'new', id = 'sx1'): SymptomReport => ({ id, category: 'exertionalChestDiscomfort', status, occurredOn: '2026-10-01', reportedAt: '2026-10-01T09:00:00Z', context: 'exertional', source: 'user' });

describe('exercise symptom gate and reviewed envelopes (D4-02)', () => {
  it('an unresolved concerning symptom stops RT, cardio and step progression; a documented 1 500-step baseline stays ≤ 1 500', () => {
    const p = withFlags(MAN_95, { symptoms: [chest()] }, { typicalSteps: 1500, sessionsPerWeek: 2, trainingHistory: 'lt1y' });
    const ctx = compileRequest(request(p, FAT_LOSS_KEEP_LEAN));
    expect(ctx.caps.exercise.gate).toBe('suspended');
    expect(ctx.practical.rtDays.max).toBe(0);
    expect(ctx.practical.cardioDays.max).toBe(0);
    expect(ctx.practical.steps.max).toBeLessThanOrEqual(1500);
    // the Ideal relaxation and explicit user step limits cannot lift it
    const ctxI = compileRequest(request(p, FAT_LOSS_KEEP_LEAN, { constraints: { steps: { min: 8000, max: 15000 }, trainingDaysPerWeek: { min: 3, max: 5 } } }));
    expect(ctxI.practical.steps.max).toBeLessThanOrEqual(1500);
    expect(ctxI.practical.rtDays.max).toBe(0);
  });

  it('without a documented baseline the plan holds the habit: no invented 3 000-step minimum or 12 000 maximum', () => {
    const p = withFlags({ ...MAN_95, habits: { sessionsPerWeek: 2, trainingHistory: 'lt1y' } }, { symptoms: [chest()] });
    const ctx = compileRequest(request(p, FAT_LOSS_KEEP_LEAN));
    expect(ctx.caps.exercise.stepsBaselineDocumented).toBe(false);
    expect(ctx.practical.steps.min).toBe(ctx.practical.steps.max);
    expect(ctx.practical.steps.max).toBe(Math.max(0, ctx.rp.habits.typicalSteps));
  });

  it('repair removes sessions and "training as usual", clamps steps; the validator and the final gate check agree', () => {
    const p = withFlags(MAN_95, { symptoms: [chest()] }, { typicalSteps: 1500, sessionsPerWeek: 3, trainingHistory: '1to3y' });
    const ctx = compileRequest(request(p, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 }));
    const s0 = baselineSchedule(ctx);
    const s: Schedule = { ...s0, programs: s0.programs.map((t) => ({ ...t, steps: 9000, habitualTraining: true })) };
    expect(checkExerciseGate(ctx, s).ok).toBe(false);
    expect(validatePlan(ctx, s).ok).toBe(false);
    const r = repairSchedule(ctx, s);
    expect(checkExerciseGate(ctx, r.schedule).ok).toBe(true);
    for (let d = 0; d < r.schedule.horizonDays; d++) {
      const t: DayTemplate = mergeDay(r.schedule.programs[r.schedule.days[d]!.program]!, r.schedule.days[d]!.override);
      expect(t.exercise ?? []).toEqual([]);
      expect(t.habitualTraining ?? false).toBe(false);
      expect(t.steps ?? 0).toBeLessThanOrEqual(1500);
    }
  });

  it('a covering reviewed envelope restores what it permits; revoked, review-date-passed or uncovered envelopes are not carried', () => {
    const today = '2026-10-05';
    const sx = chest('unexplained');
    const env = { id: 'env1', assessedAt: '2026-10-03', permitted: ['cardio', 'walking'] as const, progressionAllowed: true, stepsCeiling: 8000, coversSymptomIds: ['sx1'], source: 'selfEnteredClinician' as const };
    expect(exerciseGateOf({ symptoms: [sx], exerciseEnvelopes: [env] }, today).gate).toBe('envelope');
    expect(exerciseGateOf({ symptoms: [sx], exerciseEnvelopes: [{ ...env, revokedAt: '2026-10-04' }] }, today).gate).toBe('suspended');
    expect(exerciseGateOf({ symptoms: [sx], exerciseEnvelopes: [{ ...env, reviewBy: '2026-10-04' }] }, today).gate).toBe('suspended');
    expect(exerciseGateOf({ symptoms: [sx], exerciseEnvelopes: [{ ...env, coversSymptomIds: ['other'] }] }, today).gate).toBe('suspended');
    // a new symptom after the assessment invalidates it regardless of the envelope's own dates
    const newer = { ...chest('new', 'sx2'), occurredOn: '2026-10-04' };
    expect(exerciseGateOf({ symptoms: [sx, newer], exerciseEnvelopes: [{ ...env, coversSymptomIds: ['sx1', 'sx2'] }] }, today).gate).toBe('suspended');
    const p = withFlags(MAN_95, { symptoms: [sx], exerciseEnvelopes: [env] });
    const ctx = compileRequest(request(p, FAT_LOSS_KEEP_LEAN));
    expect(ctx.caps.exercise.cardioAllowed).toBe(true);
    expect(ctx.caps.exercise.rtAllowed).toBe(false);
    expect(ctx.practical.rtDays.max).toBe(0);
    expect(ctx.practical.cardioDays.max).toBeGreaterThan(0);
    expect(ctx.practical.steps.max).toBeLessThanOrEqual(8000);
  });

  it('asymptomatic BP risk, a historic joint limitation and a musculoskeletal symptom keep their own rules (no symptom block)', () => {
    for (const flags of [{ cardiovascularOrBp: true }, { exerciseRestriction: true }, { symptoms: [{ ...chest(), category: 'musculoskeletal' as const }] }]) {
      const ctx = compileRequest(request(withFlags(MAN_95, flags), FAT_LOSS_KEEP_LEAN));
      expect(ctx.caps.exercise.gate).toBe('none');
      expect(ctx.caps.exercise.allowed).toBe(true);
      expect(ctx.practical.rtDays.max).toBeGreaterThan(0);
    }
    // an asymptomatic healthy adult needs no clinician approval
    expect(compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN)).caps.exercise.gate).toBe('none');
  });

  it('a legacy yes / prefer-not answer is an incomplete screen (review), never a diagnosed symptom', () => {
    expect(exerciseGateOf({ faintingOrChestPain: true }, '2026-10-05').gate).toBe('reviewNeeded');
    expect(exerciseGateOf({ answers: { faintingOrChestPain: 'preferNot' } }, '2026-10-05').gate).toBe('reviewNeeded');
    expect(exerciseGateOf({ answers: { faintingOrChestPain: 'no' } }, '2026-10-05').gate).toBe('none');
    // a clarified, resolved report closes the legacy question
    expect(exerciseGateOf({ faintingOrChestPain: true, symptoms: [chest('resolved')] }, '2026-10-05').gate).toBe('none');
  });
});

// ------------------------------------------------------------------------------------------------ lifecycle subjects (C5, 0C)

describe('lifecycle boundaries judge the prescription from its own day (C5)', () => {
  const p = withFlags(MAN_95, { symptoms: [chest()] }, { typicalSteps: 6000, sessionsPerWeek: 2, trainingHistory: 'lt1y' });
  const req = request(p, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 });
  const ctx = compileRequest(req);
  const clean = repairSchedule(ctx, baselineSchedule(ctx)).schedule;
  // day 2 (already lived) was prescribed "training as usual" before the symptom was reported
  const days = clean.days.map((d, i) => (i === 1 ? { ...d, override: { ...d.override, habitualTraining: true } } : d));
  const lived: Schedule = { ...clean, days };
  const protocol = { M: 16, seed: 'subject' };
  const pass = jointScreenOf(Array.from({ length: 16 }, () => out([1])), [0]);

  it('safetySubject: day 0 is the whole schedule unchanged; a later day moves the start and drops lived days', () => {
    const whole = safetySubject(req, lived, 0);
    expect(whole.schedule).toBe(lived);
    expect(whole.request).toBe(req);
    const sub = safetySubject(req, lived, 3);
    expect(sub.fromDay).toBe(3);
    expect(sub.schedule.horizonDays).toBe(25);
    expect(sub.schedule.startDate).toBe('2026-10-08');
    expect(sub.request.profile.startDate).toBe('2026-10-08');
    expect(safetySubject(req, lived, 99).fromDay).toBe(27);
    expect(safetySubject(req, lived, Number.NaN).fromDay).toBe(0);
  });

  it('lived history is never re-judged: the same plan from today passes the gate, and an issuer certificate on that subject re-validates', () => {
    const whole = revalidatePlanSafety(req, lived, { boundary: 'adopt' });
    expect(whole.evaluation.exercise.ok).toBe(false);
    expect(whole.status).toBe('violation');
    const fromToday = revalidatePlanSafety(req, lived, { boundary: 'adopt', fromDay: 3 });
    expect(fromToday.fromDay).toBe(3);
    expect(fromToday.evaluation.exercise.ok).toBe(true);
    // the issuer (a re-plan) certifies exactly `safetySubject(request, schedule, today)` with the history hash
    const sub = safetySubject(req, lived, 3);
    const sctx = contextForSchedule(sub.request, sub.schedule);
    const e = evaluatePlanSafety(sctx, sub.schedule, null, { elapsedDays: 3 });
    const cert = issueCertificate(plannerCertificateInputs(sctx, sub.schedule, REQUIRED_SAFETY_MARGIN_IDS, protocol, 'hist-3'), { screen: pass, subjectHash: auditSubjectHash(sub.schedule), protocol }, e.status, { episodeId: 'ep', createdAt: '' });
    const v = revalidatePlanSafety(req, lived, { boundary: 'adopt', certificate: cert, fromDay: 3, historyHash: 'hist-3' });
    expect(v.fingerprint).toBe(cert.fingerprint);
    expect(v.certificateValid).toBe(cert.status === 'verified');
    expect(v.status).toBe(cert.status === 'verified' ? 'verified' : e.status);
    // a day logged since (another history hash) or another day is another subject: never authorized
    expect(revalidatePlanSafety(req, lived, { boundary: 'adopt', certificate: cert, fromDay: 3, historyHash: 'hist-4' }).certificateValid).toBe(false);
    expect(revalidatePlanSafety(req, lived, { boundary: 'adopt', certificate: cert, fromDay: 4, historyHash: 'hist-3' }).certificateValid).toBe(false);
  });

  it('with the living gate (provider): a whole-schedule revalidation blocks on lived days, the subject revalidation does not', () => {
    const asGate = (r: ReturnType<typeof revalidatePlanSafety>) =>
      lifecycleSafetyGate({ boundary: 'adopt', schedule: lived, fromDay: 3, profile: p, entries: [], revalidation: { status: r.status, startable: r.startable, reasonCode: r.reasonCode, certificateValid: r.certificateValid } });
    const blocked = asGate(revalidatePlanSafety(req, lived, { boundary: 'adopt' }));
    expect(blocked.blocked).toBe(true);
    expect(blocked.reasons.some((x) => x.code === 'revalidation:violation')).toBe(true);
    // (A1-001) the subject's checks pass (lived days are not re-judged), but without a certificate of this subject the
    // prescription is Unchecked and withheld until its audit — never activated on an Unchecked label
    const unchecked = asGate(revalidatePlanSafety(req, lived, { boundary: 'adopt', fromDay: 3 }));
    expect(unchecked.blocked).toBe(true);
    expect(unchecked.status).toBe('unchecked');
    expect(unchecked.reasons.some((x) => x.code === 'revalidation:violation')).toBe(false);
    expect(unchecked.reasons[0]!.code).toBe('revalidation:certificateRequired');
    const sub = safetySubject(req, lived, 3);
    const sctx = contextForSchedule(sub.request, sub.schedule);
    const se = evaluatePlanSafety(sctx, sub.schedule, null, { elapsedDays: 3 });
    const cert = issueCertificate(plannerCertificateInputs(sctx, sub.schedule, REQUIRED_SAFETY_MARGIN_IDS, protocol, 'hist-3'), { screen: pass, subjectHash: auditSubjectHash(sub.schedule), protocol }, se.status, { episodeId: 'ep', createdAt: '' });
    const ok = asGate(revalidatePlanSafety(req, lived, { boundary: 'adopt', fromDay: 3, certificate: cert, historyHash: 'hist-3' }));
    expect(ok.blocked).toBe(cert.status !== 'verified');
    // the symptom still holds: a prescription with exercise from today is refused at the same boundary
    const ahead: Schedule = { ...lived, days: lived.days.map((d, i) => (i === 5 ? { ...d, override: { ...d.override, habitualTraining: true } } : d)) };
    expect(revalidatePlanSafety(req, ahead, { boundary: 'adopt', fromDay: 3 }).status).toBe('violation');
  });
});

// ------------------------------------------------------------------------------------------------ D2-02 / D7-02

describe('no health objective for research indices (D2-02); out-of-domain baselines (D7-02)', () => {
  it('the autophagy index cannot be a goal, cannot open fasting and earns no fasting credit; mTOR/AMPK stay non-goals', () => {
    expect(NON_HEALTH_OBJECTIVE.has('autophagyIdx')).toBe(true);
    for (const m of ['autophagyIdx', 'mtorIdx', 'ampkIdx'] as const) {
      const ctx = compileRequest(request(MAN_95, [{ metric: m, direction: 'maximise' }, FAT_LOSS_KEEP_LEAN[0]!]));
      expect(ctx.problems.length, m).toBeGreaterThan(0);
      expect(ctx.goals.some((g) => g.metric === m)).toBe(false);
    }
    expect(servesFasting('autophagyIdx', 'up')).toBe(false);
    const imported = compileRequest(request(MAN_95, [{ metric: 'autophagyIdx', direction: 'maximise' }], { safety: { optIns: { fastingTier: 'T3' } } }));
    expect(imported.problems.join(' ')).toMatch(/research index/);
    expect(imported.fastingServedGoal).toBeNull();
  });

  it('a measured LDL outside the calibration domain stays exactly as measured and is not planned as a goal', () => {
    const p: PersonProfile = { ...MAN_95, labs: { ldlMmolL: 8.02 }, labMeta: { ldlMmolL: { source: 'marker', outOfDomain: true } } };
    const ctx = compileRequest(request(p, [{ metric: 'ldl', direction: 'minimise' }]));
    expect(ctx.problems.join(' ')).toMatch(/outside the range the model supports/);
    expect(ctx.rp.input.labs?.ldlMmolL).toBe(8.02);
    const inDomain = compileRequest(request({ ...MAN_95, labs: { ldlMmolL: 4.2 } }, [{ metric: 'ldl', direction: 'minimise' }]));
    expect(inDomain.problems).toEqual([]);
  });

  it('the engine domain rule decides without provenance and follows dependencies (ApoB from LDL); a generated prior is not a measurement', () => {
    // 8.02 mmol/L = 310 mg/dL, outside the module's 40–250 mg/dL calibration domain; no labMeta (a manual Body-page lab)
    const manual: PersonProfile = { ...MAN_95, labs: { ldlMmolL: 8.02 } };
    expect(labBaselineDomainIssue(manual, 'ldl')).toBe('own');
    expect(labBaselineDomainIssue(manual, 'apoB')).toBe('dependency');
    expect(labBaselineDomainIssue(manual, 'hdl')).toBeNull();
    const ctx = compileRequest(request(manual, [{ metric: 'ldl', direction: 'minimise' }, FAT_LOSS_KEEP_LEAN[0]!]));
    expect(ctx.goals.some((g) => g.metric === 'ldl')).toBe(false);
    expect(ctx.problems.join(' ')).toMatch(/your measured value is outside the range the model supports/);
    // other goals plan normally
    expect(ctx.goals.some((g) => g.metric === FAT_LOSS_KEEP_LEAN[0]!.metric)).toBe(true);
    expect(ctx.rp.input.labs?.ldlMmolL).toBe(8.02);
    const generated: PersonProfile = { ...manual, labMeta: { ldlMmolL: { source: 'generated' } } };
    expect(labBaselineDomainIssue(generated, 'ldl')).toBeNull();
    expect(labBaselineDomainIssue(generated, 'apoB')).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ D5-02 / D5-05 provider side

describe('living forecast semantics (D5-02) and the re-plan realised past (D5-05)', () => {
  it('living bands are labelled conditional scenario ranges (no calibrated coverage)', () => {
    expect(LIVING_SCENARIO_BAND_META).toMatchObject({ uncertaintyKind: 'scenario', coverage: 'unvalidated', method: 'fallback', draws: 0 });
    const y = Float32Array.from({ length: 10 }, (_, i) => 90 - 0.1 * i);
    const sim = { daily: { scaleWeight: y } } as unknown as Parameters<typeof bandsOf>[0]['nominal'];
    const b = bandsOf({ nominal: sim, low: null, high: null }, 0, 10, [], 0.3);
    expect(b.scaleWeight!.meta).toBe(LIVING_SCENARIO_BAND_META);
  });

  it('a logged meal inside a prescribed fast ends the zero-calorie interval at that meal (the meal is eaten, never dropped)', () => {
    const ctx = compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 }));
    const base = baselineSchedule(ctx);
    // a 48-h fast from day 0, 20:00; a logged meal on day 1 at noon
    const active: Schedule = { ...base, events: [{ kind: 'fast', startDay: 0, startH: 20, durationH: 48, refeed: 'auto' }] };
    const t0 = mergeDay(base.programs[0]!, undefined);
    const logged: DayTemplate = { ...t0, energy: { kind: 'kcal', kcal: 2000 }, meals: { meals: [{ clockH: 12, energyKcal: 700 }, { clockH: 19, energyKcal: 1300 }] } };
    const logs = [{ date: ctx.startDate, inputs: t0, items: [], coverage: 1 }, { date: '2026-10-06', inputs: logged, items: [{ itemId: 'f', type: 'fast' as const, status: 'partial' as const, credit: 0.3 }], coverage: 1 }];
    const r = realise(active, logs, ctx.startDate, 3);
    expect(r.events).toHaveLength(1);
    expect(r.events![0]!.durationH).toBeCloseTo(16, 6);
    expect(r.events![0]!.source).toBe('observed');
    expect(r.events![0]!.refeed).toBe('none');
    const cs = compileSchedule(r, ctx.rp);
    expect(cs.days[1]!.mealDropMask ?? 0).toBe(0);
    // an explicitly skipped fast is removed; a partial credit alone never decides
    const skipped = realise(active, [{ ...logs[0]!, items: [{ itemId: 'f', type: 'fast' as const, status: 'skipped' as const, credit: 0 }] }], ctx.startDate, 3);
    expect(skipped.events).toEqual([]);
    const partialNoMeal = realise(active, [{ ...logs[0]!, items: [{ itemId: 'f', type: 'fast' as const, status: 'partial' as const, credit: 0.2 }] }], ctx.startDate, 3);
    expect(partialNoMeal.events![0]!.durationH).toBe(48);
  });

  it('the shared realised schedule, when given, supplies the past verbatim (no independent re-derivation)', () => {
    const ctx = compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 }));
    const base = baselineSchedule(ctx);
    const shared: Schedule = { ...base, events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 14.5, source: 'observed', eventId: 'ev1' }], realised: { historyHash: 'h', asOf: '2026-10-08T00:00:00Z', contractVersion: 1, throughDay: 3 } };
    const active: Schedule = { ...base, events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 48 }, { kind: 'fast', startDay: 10, startH: 20, durationH: 24 }] };
    const r = realise(active, [], ctx.startDate, 3, shared);
    expect(r.events!.map((e) => [e.startDay, e.durationH, e.eventId ?? null])).toEqual([[1, 14.5, 'ev1'], [10, 24, null]]);
    // the observed prefix keeps the shared history's identity (the hash assimilation replays and certificates bind)
    expect(r.realised).toEqual({ historyHash: 'h', asOf: '2026-10-08T00:00:00Z', contractVersion: 1, throughDay: 3 });
    for (let d = 0; d < 3; d++) expect(JSON.stringify(dayTemplate(r, d))).toBe(JSON.stringify(dayTemplate(shared, d)));
    // nothing elapsed: the prescription as it stands
    expect(realise(active, [], ctx.startDate, 0, shared)).toBe(active);
  });
});

describe('missing required outputs (D4-03)', () => {
  it('a margin whose engine output is absent is reported missing, not passed', () => {
    const ctx = compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 }));
    const model = new EnginePlanModel(ctx, { bindings: [] });
    const sim = model.simulate(baselineSchedule(ctx), -1);
    expect(missingStateMargins(sim)).toEqual([]);
    const stripped = { ...sim, constraints: sim.constraints?.filter((c) => c.id !== 'HC-E5') };
    expect(missingStateMargins(stripped)).toContain(3);
  });
});

// ------------------------------------------------------------------------------------------------ start route, end to end (C5, 0C)

describe('start: a planner rung certificate re-validates at the living start (C5)', () => {
  it('the run request (with the current profile safety) and the rung schedule reproduce the certificate; limit notes only after the check', async () => {
    const run: PlannerRequestV2 = {
      ...request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 28 }),
      startDate: '2026-10-05',
      seed: 11,
      safety: { plannerLocks: [{ id: 'caffeine-cap', value: 300, source: 'marker' }] },
    };
    const res = await runLadderPlanner(run, { tier: 'S', algorithm: 'v2', ideal: false, limitCosts: false, timeToTarget: false });
    const rungs = Object.values(res.rungs).filter((r): r is NonNullable<typeof r> => !!r?.safety?.certificate);
    expect(rungs.length).toBeGreaterThan(0);
    // with the tier's budget the audit runs (M = 16 at S) and a plan can be verified
    expect(rungs.some((r) => r.safety!.certificate!.status === 'verified')).toBe(true);
    const j = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    for (const r of rungs) {
      const cert = r.safety!.certificate!;
      expect(cert.requiredMargins?.length).toBeGreaterThan(0);
      expect(cert.drawProtocol?.M).toBe(TIER_ENSEMBLE.S);
      // the living start: the stored run request, the current profile safety (unchanged), the rung's own schedule
      const atStart = { ...run, profile: { ...run.profile, ...(run.profile.safety ? { safety: run.profile.safety } : {}) } };
      const v = revalidatePlanSafety(j(atStart), j(r.schedule), { boundary: 'start', certificate: j(cert) });
      expect(v.fingerprint, r.kind).toBe(cert.fingerprint);
      expect(v.certificateValid).toBe(cert.status === 'verified');
      // a symptom reported before the start: never the earlier assurance
      const sx: SymptomReport = { id: 'sx-start', category: 'exertionalChestDiscomfort', status: 'new', reportedAt: '2026-10-04T08:00:00Z', context: 'exertional', source: 'user' };
      const later = { ...atStart, profile: { ...atStart.profile, safety: { mode: 'M0' as const, flags: { symptoms: [sx] } } } };
      expect(revalidatePlanSafety(later, r.schedule, { boundary: 'start', certificate: cert }).certificateValid).toBe(false);
      // the caffeine note is written only when the final resolved check passed that limit
      const caffeine = r.safety!.evaluations?.find((e) => e.constraintId === 'caffeine-cap');
      expect(caffeine).toBeDefined();
      const note = r.safetyNotes.some((t) => /mg\/day of caffeine/.test(t));
      expect(note).toBe(caffeine?.status === 'pass');
    }
  }, 600_000);
});

// ------------------------------------------------------------------------------------------------ re-plan route (D4-02, D4-03)

describe('re-plan: independent audit, certificate and the current symptom gate (D4-02, D4-03)', () => {
  it('a re-plan result carries its audit (reserved stream, M of its tier) and a certificate the lifecycle can re-validate', async () => {
    const fx = makePlan({ pick: (s) => /^B1(\[|$)/.test(s.id) });
    const state = confirmedState(fx.plan, 7, { deltaSd: 60 });
    // the living consumer's inputs: the shared realised history (its hash) and the CURRENT profile safety
    const shared: Schedule = { ...fx.plan.schedule, realised: { historyHash: 'hist-10', asOf: '2026-10-15T06:00:00.000Z', contractVersion: CONTRACT_VERSIONS.realisedHistory, throughDay: 10 } };
    const profileSafety = { mode: 'M0' as const, flags: { fastingOptIn: 'none' as const } };
    const req = { ...replanRequest(fx.plan, state, 10, 'weekly', { logs: logsAsPlanned(fx.plan, 7, 10) }), realisedSchedule: shared, currentSafety: { profileSafety } };
    const r = await replan(req, { totalEU: 60 });
    expect(r.safety).toBeDefined();
    const sf = r.safety!;
    // (A1-012) the CURRENT confirmed state's audit hash (here: the state the re-plan was made from)
    const stateHash = replanStateHash(req);
    expect(sf.historyHash).toBe('hist-10');
    expect(sf.audit.M).toBe(16);
    expect(sf.protocol.M).toBe(16);
    expect(['pass', 'fail', 'unchecked']).toContain(sf.audit.status);
    expect(sf.certificate.status === 'verified').toBe(sf.status === 'verified');
    const today = req.today;
    // the plan's own request with the current profile safety (an unchanged result keeps the stored plan record)
    const consumer = { ...fx.plan.request, profile: { ...fx.plan.request.profile, safety: profileSafety } };
    const subject = replanSafetySubject({ ...r.plan, request: consumer }, today);
    expect(subject.fromDay).toBe(10);
    const v = revalidatePlanSafety(subject.request, subject.schedule, { boundary: 'adopt', certificate: sf.certificate, requiredMargins: REQUIRED_SAFETY_MARGIN_IDS, protocol: sf.protocol, historyHash: sf.historyHash, stateHash, elapsedDays: 10 });
    expect(v.fingerprint).toBe(sf.certificate.fingerprint);
    // without the current state, or under another correction, the certificate is not valid (A1-012)
    expect(revalidatePlanSafety(subject.request, subject.schedule, { boundary: 'adopt', certificate: sf.certificate, historyHash: sf.historyHash, elapsedDays: 10 }).certificateValid).toBe(false);
    expect(revalidatePlanSafety(subject.request, subject.schedule, { boundary: 'adopt', certificate: sf.certificate, historyHash: sf.historyHash, stateHash: replanStateHash({ ...req, state: { ...req.state, energyBiasKcal: { ...req.state.energyBiasKcal, mean: req.state.energyBiasKcal.mean + 150 } } }), elapsedDays: 10 }).certificateValid).toBe(false);
    // a symptom reported after the re-plan invalidates it at adoption
    const sx: SymptomReport = { id: 'sx9', category: 'syncopeOrPresyncope', status: 'new', reportedAt: '2026-10-15T08:00:00Z', source: 'user' };
    const later = { ...subject.request, profile: { ...subject.request.profile, safety: { mode: 'M0' as const, flags: { symptoms: [sx] } } } };
    const v2 = revalidatePlanSafety(later, subject.schedule, { boundary: 'adopt', certificate: sf.certificate, requiredMargins: REQUIRED_SAFETY_MARGIN_IDS, protocol: sf.protocol, historyHash: sf.historyHash, stateHash, elapsedDays: 10 });
    expect(v2.certificateValid).toBe(false);
    expect(v2.startable).toBe(false);
    // the lifecycle consumer (replan / adopt boundary): that request, the version's full schedule, the version's
    // effective day and the current history hash — the same fingerprint
    const atAdopt = revalidatePlanSafety(consumer, r.plan.schedule, { boundary: 'adopt', certificate: sf.certificate, fromDay: 10, historyHash: 'hist-10', stateHash });
    expect(atAdopt.fingerprint).toBe(sf.certificate.fingerprint);
    expect(atAdopt.certificateValid).toBe(sf.certificate.status === 'verified');
    expect(atAdopt.status === 'verified').toBe(sf.status === 'verified');
    // persisted as a plan version and reloaded / synced / imported: the same fingerprint
    const j = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    expect(revalidatePlanSafety(j(consumer), j(r.plan.schedule), { boundary: 'adopt', certificate: j(sf.certificate), fromDay: 10, historyHash: 'hist-10', stateHash }).fingerprint).toBe(sf.certificate.fingerprint);
    // a day logged since (another history), adoption on a later day, or the whole schedule is another subject
    expect(revalidatePlanSafety(consumer, r.plan.schedule, { boundary: 'adopt', certificate: sf.certificate, fromDay: 10, historyHash: 'hist-11', stateHash }).certificateValid).toBe(false);
    expect(revalidatePlanSafety(consumer, r.plan.schedule, { boundary: 'adopt', certificate: sf.certificate, fromDay: 11, historyHash: 'hist-10', stateHash }).certificateValid).toBe(false);
    expect(revalidatePlanSafety(consumer, r.plan.schedule, { boundary: 'adopt', certificate: sf.certificate, historyHash: 'hist-10', stateHash }).certificateValid).toBe(false);
  }, 120_000);

  it('a new unresolved symptom opens the lock window: no prescribed sessions or step increase from today, history untouched', async () => {
    const withRt = (st: { x0: Float64Array; geneIndex: Readonly<Record<string, number>> }) => {
      const x = Float64Array.from(st.x0);
      for (const g of ['rt.sessions', 'rt.sets', 'steps']) if (st.geneIndex[g] !== undefined) x[st.geneIndex[g]!] = 1;
      return x;
    };
    const fx = makePlan({ pick: (s) => /^B1(\[|$)/.test(s.id), x: withRt });
    let sessionsAhead = 0;
    for (let d = 10; d < fx.plan.schedule.horizonDays; d++) sessionsAhead += (dayTemplate(fx.plan.schedule, d).exercise ?? []).length;
    expect(sessionsAhead).toBeGreaterThan(0);
    const state = confirmedState(fx.plan, 7, { deltaSd: 60 });
    const sx: SymptomReport = { id: 'sx1', category: 'exertionalChestDiscomfort', status: 'new', reportedAt: '2026-10-14T08:00:00Z', context: 'exertional', source: 'user' };
    const req = { ...replanRequest(fx.plan, state, 10, 'light', { logs: logsAsPlanned(fx.plan, 7, 10) }), currentSafety: { profileSafety: { mode: 'M0' as const, flags: { symptoms: [sx] } } } };
    let diag: { safetyFirst: boolean; lockEnd: number; todayIdx: number } | null = null;
    const r = await replan(req, { totalEU: 60, onDiagnostics: (d) => (diag = d) });
    expect(diag!.safetyFirst).toBe(true);
    expect(diag!.lockEnd).toBe(diag!.todayIdx);
    if (r.status !== 'noSafePlan') {
      const ctx = compileRequest({ ...r.plan.request });
      expect(ctx.caps.exercise.gate).toBe('suspended');
      for (let d = 10; d < r.plan.schedule.horizonDays; d++) expect(dayTemplate(r.plan.schedule, d).exercise ?? [], `day ${d}`).toEqual([]);
    }
    // the prescription before today is the plan's own (history is not rewritten)
    for (let d = 0; d < 10; d++) expect(JSON.stringify(dayTemplate(r.plan.schedule, d))).toBe(JSON.stringify(dayTemplate(fx.plan.schedule, d)));
    // lifecycle (replan / adopt boundary, with the living gate): the sessions already lived never block the re-plan that
    // stopped exercise from today; judged as a whole schedule they would
    let lived = 0;
    for (let d = 0; d < 10; d++) lived += (dayTemplate(r.plan.schedule, d).exercise ?? []).length;
    const profile = { ...fx.plan.request.profile, safety: { mode: 'M0' as const, flags: { symptoms: [sx] } } };
    const consumer = { ...fx.plan.request, profile };
    const gateOf = (v: ReturnType<typeof revalidatePlanSafety>) =>
      lifecycleSafetyGate({ boundary: 'replan', schedule: r.plan.schedule, fromDay: 10, profile, entries: [], certificate: r.safety?.certificate ?? null, revalidation: { status: v.status, certificateValid: v.certificateValid } });
    const whole = gateOf(revalidatePlanSafety(consumer, r.plan.schedule, { boundary: 'replan', certificate: r.safety?.certificate ?? null }));
    if (lived > 0) expect(whole.reasons.some((x) => x.code === 'revalidation:violation')).toBe(true);
    if (r.status !== 'noSafePlan') {
      const fromToday = revalidatePlanSafety(consumer, r.plan.schedule, { boundary: 'replan', certificate: r.safety?.certificate ?? null, fromDay: 10 });
      expect(fromToday.evaluation.exercise.ok).toBe(true);
      expect(gateOf(fromToday).reasons.some((x) => x.code === 'revalidation:violation')).toBe(false);
    }
  }, 180_000);
});
