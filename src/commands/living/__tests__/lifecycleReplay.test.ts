/**
 * Phase 0C joint checks of the living plan's consumers against their providers, through the command bus with the planner's
 * receding-horizon `replan` in-process (tier S) and the planner's own lifecycle revalidation (`revalidatePlanSafety`):
 *  - replay (C2): the re-plan request carries the shared realised schedule stamped with the projection's history hash,
 *    and the planner's certificate binds that same hash;
 *  - lifecycle (C5/A1-001/A1-012): a certificate is revalidated on the planner's own subject at the re-plan and adoption
 *    boundaries with the current history AND audit-state hashes; a valid one is Verified and startable, a day lived or a
 *    past day edited since makes it invalid — never startable: the adoption is refused unless the one declared final
 *    audit of exactly that subject (the confirmed-state audit) passes —, a symptom blocks it, a failed audit never adopts, and a shifted resume carries
 *    no stale certificate (refused without its own audit);
 *  - idempotence (C7/D5-02): a check-in retried the same day keeps one decision.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentStore, createMemoryBackend, mintWriteToken, bodyOf } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import { currentDay, dispatch, installLivingPorts, type CommandResult } from '@/commands';
import { installPorts, timeZone } from '@/commands/bus';
import { currentStateHash, readDocs } from '@/commands/living';
import { replan, replanSafetySubject, replanStateHash } from '@/engine/planner/domain/replan';
import { auditSubjectHash, contextForSchedule, evaluatePlanSafety, issueCertificate, plannerCertificateInputs, revalidatePlanSafety } from '@/engine/planner/domain/safetyAudit';
import type { LifecycleFinalAudit } from '@/living';
import { compileRequest } from '@/engine/planner/domain/context';
import type { PlannerResult, PlanOption } from '@/engine/planner/domain/types';
import * as plannerState from '@/state/internal/planner';
import { withSystemWrite } from '@/state/scope';
import { REQUIRED_SAFETY_MARGIN_IDS } from '@/engine/planner/domain/model';
import type { ReplanRequest, ReplanResult } from '@/engine/planner/domain/replanTypes';
import { jointScreenOf } from '@/engine/planner/optim/robust';
import type { EvalOutput } from '@/engine/planner/optim/types';
import { baseRequest, makePlan, PERSON, START, type Fixture } from '@/engine/planner/domain/__tests__/replan.fixtures';
import {
  addDays,
  currentProfileSafety,
  DEFAULT_ITEM_WEIGHTS,
  freezePrescription,
  prescribedExerciseFrom,
  projectEntries,
  projectLiving,
  type ConfirmedStateRecord,
  type DayStatusDoc,
  type PlanDoc,
  type PlanVersionDoc,
} from '@/living';
import type { AdaptOutput } from '@/commands/living/adapt';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ9';
const TODAY_IDX = 7;
const TODAY = addDays(START, TODAY_IDX);
const NOON = (date: string) => new Date(`${date}T12:00:00`);

let fx: Fixture;
let request: ReturnType<typeof baseRequest>;
const seen: Array<{ req: ReplanRequest; res: ReplanResult }> = [];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON(TODAY));
  request = baseRequest({ goals: [{ metric: 'fatMass', direction: 'target', target: 26.1, targetKind: 'absolute' }, { metric: 'leanTissue', direction: 'maximise' }] });
  fx = makePlan({ request, pick: (s) => /^B1(\[|$)/.test(s.id), x: (st) => withGene(st, 'seg0.energy', 0.6) });
  // the planner's re-plan in-process; the revalidation port stays the production one (`revalidatePlanSafety`)
  installLivingPorts({
    planner: {
      replan: async (req, o) => {
        const res = await replan(req, { tier: o?.tier ?? 'S' });
        seen.push({ req, res });
        return res;
      },
    },
  });
}, 60_000);
afterAll(() => {
  vi.useRealTimers();
  installLivingPorts();
  installPorts({ planner: undefined });
});
beforeEach(() => {
  seen.length = 0;
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000009' }), validation: 'off' }));
  // the Planner's composed current safety input, as the Planner port publishes it (A1-002: the boundary reads it)
  installPorts({ planner: { prepare: () => ({ request: currentRequestSync(), hash: 'published' }), run: async () => null, cancel: () => undefined } });
  installLivingPorts({ planner: { replan: livingReplan } });
});
const livingReplan = async (req: ReplanRequest, o?: { tier?: 'S' | 'M' | 'L' | 'X' }) => {
  const res = await replan(req, { tier: o?.tier ?? 'S' });
  seen.push({ req, res });
  return res;
};
/** The current request synchronously (screening now, no logged symptoms): what the published Planner input carries. */
function currentRequestSync(): typeof request {
  const safety = simulatorProfileNow(new Date().toISOString()).safety;
  return { ...request, profile: { ...request.profile, ...(safety ? { safety } : {}) } };
}
afterEach(() => {
  vi.setSystemTime(NOON(TODAY));
});

function withGene(st: { x0: Float64Array; geneIndex: Readonly<Record<string, number>> }, gene: string, value: number): Float64Array {
  const x = Float64Array.from(st.x0);
  const i = st.geneIndex[gene];
  if (i !== undefined) x[i] = value;
  return x;
}
function planDocOf(over: Partial<PlanDoc> = {}): PlanDoc {
  return {
    name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${START}T08:00:00.000Z` }, status: 'active',
    startDate: START, plannedEndDate: addDays(START, request.horizonDays), request, baselineProfile: PERSON, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: `${START}T08:00:00.000Z`, ...over,
  };
}
function versionDoc(over: Partial<PlanVersionDoc> = {}): PlanVersionDoc {
  return {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: fx.plan.schedule, genome: { structureId: fx.plan.structureId, x: [...fx.plan.genome] }, sessions: {},
    sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: fx.plan.provenance, createdBy: { kind: 'system' }, createdAt: `${START}T08:00:00.000Z`, ...over,
  };
}

/** A plan lived "as planned" for a week (marks only: an estimate, not measured intake). */
async function seed(opts: { plan?: Partial<PlanDoc>; head?: Partial<PlanVersionDoc> } = {}): Promise<void> {
  const store = getDocumentStore();
  await store.ready;
  const plan = planDocOf(opts.plan);
  const version = versionDoc(opts.head);
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
    for (let d = 0; d < TODAY_IDX; d++) {
      const date = addDays(START, d);
      const prescribed = freezePrescription({ plan: { ...plan, id: PLAN_ID }, version, date, tz: 'UTC' });
      const day: DayStatusDoc = { date, planId: PLAN_ID, planDay: d, marks: { all: 'asPlanned' }, prescribed };
      await tx.put('dayStatus', { ...day, _id: `day:${date}` });
    }
  });
}

const out = <T = AdaptOutput,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};
const versions = (): PlanVersionDoc[] => getDocumentStore().peekAll<PlanVersionDoc>('planVersions').map((d) => bodyOf<PlanVersionDoc>(d)).sort((a, b) => a.version - b.version);
const versionOf = (n: number): PlanVersionDoc => versions().find((v) => v.version === n)!;

/** The history hash the commands see now (bus zone, current clock and app day). */
async function historyHashNow(): Promise<string> {
  const now = new Date();
  const docs = await readDocs();
  return projectLiving({ docs, today: currentDay(now.getTime(), timeZone()), tz: timeZone(), now: now.toISOString(), skipAssimilation: true }).history!.contentHash;
}

/** The request the adoption boundary checks under: the plan's request with the current safety (one rule, C5). */
async function currentRequest(): Promise<typeof request> {
  const docs = await readDocs();
  const safety = currentProfileSafety(request.profile.safety, simulatorProfileNow(new Date().toISOString()).safety, projectEntries(docs.entries));
  return { ...request, profile: { ...request.profile, ...(safety ? { safety } : {}) } };
}

const PROTOCOL = { M: 16, seed: 'joint' };
const PASS = jointScreenOf(Array.from({ length: 16 }, (): EvalOutput => ({ goals: [1], margins: [1], regulariser: 0, descriptors: [] })), [0]);

/** The current audit initial-state hash the commands compute (A1-012). */
async function stateHashNow(): Promise<string> {
  const now = new Date();
  const docs = await readDocs();
  const plan = docs.plan as PlanDoc & { id: string };
  const head = docs.versions.find((v) => v.version === 1)!;
  return (await currentStateHash({ today: currentDay(now.getTime(), timeZone()), tz: timeZone(), now: now.toISOString() }, docs, plan, head))!;
}

/** A certificate whose passing audit binds exactly `schedule` (A1-011: the subject hash and protocol travel with the screen). */
function bound(ctx: ReturnType<typeof contextForSchedule>, schedule: PlanVersionDoc['schedule'], status: Parameters<typeof issueCertificate>[2], historyHash?: string, stateHash?: string, episodeId = 'joint') {
  return issueCertificate(plannerCertificateInputs(ctx, schedule, REQUIRED_SAFETY_MARGIN_IDS, PROTOCOL, historyHash, stateHash), { screen: PASS, subjectHash: auditSubjectHash(schedule), protocol: PROTOCOL }, status, { episodeId, createdAt: '' });
}

/** A re-plan proposal made today whose certificate (a passing audit) binds the subject from today, `historyHash` and the current state. */
async function certifiedProposal(historyHash: string): Promise<PlanVersionDoc> {
  const subject = replanSafetySubject({ request: await currentRequest(), schedule: fx.plan.schedule, startDate: START }, TODAY);
  const ctx = contextForSchedule(subject.request, subject.schedule);
  const e = evaluatePlanSafety(ctx, subject.schedule, null, { elapsedDays: TODAY_IDX });
  expect(e.status).toBe('verified');
  const certificate = bound(ctx, subject.schedule, e.status, historyHash, await stateHashNow());
  expect(certificate.status).toBe('verified');
  return versionDoc({ version: 2, parent: 1, status: 'proposed', reason: 'weekly', effectiveFromDay: TODAY_IDX, certificate, safetyStatus: 'verified', createdAt: `${TODAY}T08:00:00.000Z` });
}

/**
 * A fake declared final audit (A1-001/A1-004): issues one certificate for exactly the subject it is given, with the
 * source kept as history, and counts its calls (one automatic attempt per decision episode, never a retry).
 */
function fakeAudit(calls: Array<Parameters<LifecycleFinalAudit>[0]>, pass = true): LifecycleFinalAudit {
  return async (i) => {
    calls.push(i);
    const subject = i.from ? replanSafetySubject({ request: i.request, schedule: i.schedule, startDate: i.from.planStart }, i.from.date) : { request: i.request, schedule: i.schedule };
    const elapsed = i.from ? Math.round((Date.parse(i.from.date) - Date.parse(i.from.planStart)) / 86_400_000) : 0;
    const ctx = contextForSchedule(subject.request, subject.schedule);
    const e = evaluatePlanSafety(ctx, subject.schedule, null, { elapsedDays: elapsed });
    const cert = issueCertificate(plannerCertificateInputs(ctx, subject.schedule, REQUIRED_SAFETY_MARGIN_IDS, PROTOCOL, i.historyHash, i.stateHash), pass ? { screen: PASS, subjectHash: auditSubjectHash(subject.schedule), protocol: PROTOCOL } : { screen: { ...PASS, status: 'fail' }, subjectHash: auditSubjectHash(subject.schedule), protocol: PROTOCOL }, e.status, {
      episodeId: i.episodeId,
      createdAt: i.createdAt,
      ...(i.source ? { history: [{ fingerprint: i.source.fingerprint, episodeId: i.source.episodeId, status: i.source.status, at: i.source.createdAt }] } : {}),
    });
    return cert;
  };
}

/** Seed the plan with a certified proposal v2 made today (the plan's head pointer at it, as a re-plan leaves it). */
async function seedWithProposal(): Promise<PlanVersionDoc> {
  await seed();
  const proposal = await certifiedProposal(await historyHashNow());
  await getDocumentStore().transact(mintWriteToken('migration', { label: 'proposal' }), async (tx) => {
    await tx.append('planVersions', { ...proposal, _id: `${PLAN_ID}:v2` });
    await tx.put('plans', { ...planDocOf({ headVersion: 2 }), _id: PLAN_ID });
  });
  return proposal;
}

describe('replay: one realised history from the living plan to the planner (C2)', () => {
  it('the re-plan request carries the realised schedule stamped with the projection hash; the certificate binds it and its subject', async () => {
    await seed();
    const hash = await historyHashNow();
    const o = out(await dispatch('plan.declareEvent', { kind: 'busy', from: addDays(TODAY, 2), to: addDays(TODAY, 4) }));
    const { req, res } = seen[0]!;
    expect(req.realisedSchedule?.realised).toMatchObject({ historyHash: hash, throughDay: TODAY_IDX });
    // every elapsed day travels (unknown ones included), the days the history holds
    expect(req.logs.map((l) => l.date)).toEqual(Array.from({ length: TODAY_IDX }, (_, d) => addDays(START, d)));
    expect(res.safety?.historyHash).toBe(hash);
    // the planner's subject recomputes exactly the certificate's fingerprint (what the revalidation port computes)
    const subject = replanSafetySubject(res.plan, TODAY);
    // (A1-012) the certificate binds the audited initial state too: the same state hash recomputes the same fingerprint
    const rv = revalidatePlanSafety(subject.request, subject.schedule, { boundary: 'replan', certificate: res.safety!.certificate, historyHash: hash, stateHash: replanStateHash(req), elapsedDays: TODAY_IDX });
    expect(rv.fingerprint).toBe(res.safety!.certificate.fingerprint);
    // the stored version keeps the certificate and the history; a failed audit is Review and never adopted at once
    const v = versionOf(o.version!);
    expect(v.certificate?.fingerprint).toBe(res.safety!.certificate.fingerprint);
    expect(v.forecast.historyHash).toBe(hash);
    if (res.safety!.certificate.status === 'failed') {
      expect(o.status).toBe('proposed');
      expect(v.safetyStatus).toBe('review');
    } else {
      expect(v.safetyStatus).toBe(rv.status);
    }
  }, 180_000);
});

describe('lifecycle: certificates revalidated on their subject against the current history (C5)', () => {
  it('a proposal whose certificate matches its subject, the current safety and the current history is adopted Verified', async () => {
    await seedWithProposal();
    const r = out<{ version: number; status: string }>(await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: 2 }));
    expect(r.status).toBe('adopted');
    expect(versionOf(r.version).safetyStatus).toBe('verified');
  }, 120_000);

  it('a past day logged after the proposal (another history) is never adopted without a fresh audit; the log stays', async () => {
    await seedWithProposal();
    expect((await dispatch('log.steps', { date: addDays(TODAY, -2), steps: 9100 })).ok).toBe(true);
    const r = await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: 2 });
    expect(r.ok).toBe(false);
    // the proposal's certificate binds another history; the confirmed-state audit of the new one runs (the re-plan's own
    // certification) and this borderline plan fails it (12 of 16 members pass): refused with the audit's reason
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked', detail: { rule: 'lifecycle:auditFailed', reason: 'review', allowedAlternatives: expect.arrayContaining(['plan.rejectVersion']) } });
    expect(versions().map((v) => v.status)).toEqual(['adopted', 'proposed']);
    expect(getDocumentStore().peekAll('dailyLogs')).toHaveLength(1);
  }, 120_000);

  it('with the declared final audit port, one audit of exactly that subject under the current history and state certifies the adoption', async () => {
    const calls: Array<Parameters<LifecycleFinalAudit>[0]> = [];
    installLivingPorts({ planner: { replan: livingReplan }, audit: fakeAudit(calls) });
    const proposal = await seedWithProposal();
    vi.setSystemTime(NOON(addDays(TODAY, 1)));
    // what the adoption boundary must bind: the history and confirmed state as they are now (before it writes)
    const historyNow = await historyHashNow();
    const stateNow = await stateHashNow();
    const r = out<{ version: number; status: string }>(await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: 2 }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.historyHash).toBe(historyNow);
    expect(calls[0]!.stateHash).toBe(stateNow);
    const v = versionOf(r.version);
    expect(v.safetyStatus).toBe('verified');
    // the adopted version carries the fresh certificate; the proposal's own stays as history
    expect(v.certificate?.fingerprint).not.toBe(proposal.certificate!.fingerprint);
    expect(v.certificate?.history?.[0]?.fingerprint).toBe(proposal.certificate!.fingerprint);
    expect(versionOf(2).certificate?.fingerprint).toBe(proposal.certificate!.fingerprint);
  }, 120_000);

  it('a failed declared audit is never retried and never adopts', async () => {
    const calls: Array<Parameters<LifecycleFinalAudit>[0]> = [];
    installLivingPorts({ planner: { replan: livingReplan }, audit: fakeAudit(calls, false) });
    await seedWithProposal();
    vi.setSystemTime(NOON(addDays(TODAY, 1)));
    const r = await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: 2 });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(versions().map((v) => v.status)).toEqual(['adopted', 'proposed']);
  }, 120_000);

  it('a day lived since the proposal is Unchecked and never adopted without a fresh audit', async () => {
    await seedWithProposal();
    vi.setSystemTime(NOON(addDays(TODAY, 1)));
    const r = await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: 2 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked' });
  }, 120_000);

  it('a concerning symptom logged after the proposal blocks adopting a prescription with exercise from today', async () => {
    expect(prescribedExerciseFrom(fx.plan.schedule, TODAY_IDX, null).sessions).toBe(true);
    await seedWithProposal();
    expect((await dispatch('log.subjective', { date: TODAY, symptom: { category: 'exertionalChestDiscomfort', status: 'new', context: 'exertional' } })).ok).toBe(true);
    const r = await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: 2 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked', detail: { allowedAlternatives: expect.arrayContaining(['plan.rejectVersion']) } });
  }, 120_000);

  it('a shifted resume is a new prescription: no stale certificate, never resumed Unchecked; one declared audit certifies it', async () => {
    const certificate = (await seedWithProposal()).certificate!;
    setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000010' }), validation: 'off' }));
    await seed({ plan: { status: 'paused', pauses: [{ from: addDays(TODAY, -2), to: null }] }, head: { certificate, safetyStatus: 'verified' } });
    const refused = await dispatch('plan.resume', {});
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatchObject({ code: 'safety_blocked', detail: { allowedAlternatives: ['plan.end'] } });
    expect(versions()).toHaveLength(1);
    const calls: Array<Parameters<LifecycleFinalAudit>[0]> = [];
    installLivingPorts({ planner: { replan: livingReplan }, audit: fakeAudit(calls) });
    out(await dispatch('plan.resume', {}));
    const v = versions().at(-1)!;
    expect(calls).toHaveLength(1);
    expect(v.reason).toBe('resume');
    expect(v.certificate?.fingerprint).not.toBe(certificate.fingerprint);
    expect(v.safetyStatus).toBe('verified');
  }, 120_000);
});

describe('start: a planner option certificate checked whole against the current safety (C5)', () => {
  /** A finished Planner run whose medium option carries a certificate (passing audit) on its whole schedule and request. */
  function runWithCertifiedOption(runRequest: typeof request): PlanOption {
    const ctx = compileRequest(runRequest);
    const e = evaluatePlanSafety(ctx, fx.plan.schedule, null);
    const certificate = bound(ctx, fx.plan.schedule, e.status, undefined, undefined, 'start');
    const option = {
      id: 'B', name: 'B', schedule: fx.plan.schedule, simulation: { meta: { registryHash: 'reg', engineVersion: 'eng' }, daily: {} },
      scorecard: [{ goal: 0, metric: 'fatMass', start: 26.6, value: 25.9, band: null }, { goal: 1, metric: 'leanTissue', start: 63, value: 63, band: null }],
      bands: { draws: 0, series: {} }, safetyNotes: [], safetyItems: [], explanation: ['Medium plan.'],
      safety: { status: certificate.status === 'verified' ? 'verified' : 'unchecked', evaluations: e.evaluations, audit: PASS, certificate, outcomeHoldout: { draws: 0, status: 'notRun' } },
    } as unknown as PlanOption;
    withSystemWrite(() => {
      plannerState.runStarted('run-h', runRequest, Date.now());
      plannerState.runFinished({ options: [option], provenance: fx.plan.provenance } as unknown as PlannerResult, Date.now());
    }, 'test planner run');
    return option;
  }
  /** The run request as the Planner builds it now: the plan request with the current screening's safety. */
  const runRequestNow = () => ({ ...request, profile: { ...request.profile, ...(simulatorProfileNow(new Date().toISOString()).safety ? { safety: simulatorProfileNow(new Date().toISOString()).safety! } : {}) } });
  const started = () => versions().find((v) => v.version === 1 && v.reason === 'start')!;

  it('a run made under the current safety starts Verified, bound to the option certificate', async () => {
    vi.setSystemTime(NOON(addDays(START, -3)));
    await getDocumentStore().ready;
    const option = runWithCertifiedOption(runRequestNow());
    expect(option.safety?.certificate?.status).toBe('verified');
    out(await dispatch('plan.start', { source: { rung: 'medium' }, startDate: START }));
    expect(started().safetyStatus).toBe('verified');
    expect(started().certificate?.fingerprint).toBe(option.safety!.certificate!.fingerprint);
  }, 120_000);

  it('a run made under another safety state is never started Unchecked: refused before any write', async () => {
    vi.setSystemTime(NOON(addDays(START, -3)));
    await getDocumentStore().ready;
    runWithCertifiedOption({ ...request, profile: { ...request.profile, safety: { mode: 'M0', flags: { gout: true } } } });
    // no declared final audit available: the certificate binds another subject, so the start is Unchecked and refused
    installLivingPorts({ planner: { replan: livingReplan }, audit: undefined });
    const r = await dispatch('plan.start', { source: { rung: 'medium' }, startDate: START });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked', detail: { reason: 'unchecked', allowedAlternatives: ['planner.find'] } });
    expect(versions()).toEqual([]);
    expect(getDocumentStore().peekAll('activePlan')).toEqual([]);
    // the production final audit (A1-001/A1-004) runs once on exactly this subject under the current safety: this fixture's
    // nominal run breaks a required margin, so the audit fails and the start stays refused before any write
    installLivingPorts({ planner: { replan: livingReplan } });
    const audited = await dispatch('plan.start', { source: { rung: 'medium' }, startDate: START });
    expect(audited.ok).toBe(false);
    expect(!audited.ok && audited.error).toMatchObject({ code: 'safety_blocked', detail: { rule: 'lifecycle:auditFailed', reason: 'review', allowedAlternatives: ['planner.find'] } });
    expect(versions()).toEqual([]);
    expect(getDocumentStore().peekAll('activePlan')).toEqual([]);
  }, 120_000);

  it('a concerning symptom logged before the start blocks a prescription with exercise; the log is kept', async () => {
    vi.setSystemTime(NOON(addDays(START, -3)));
    await getDocumentStore().ready;
    runWithCertifiedOption(runRequestNow());
    expect((await dispatch('log.subjective', { symptom: { category: 'exertionalChestDiscomfort', status: 'new', context: 'exertional' } })).ok).toBe(true);
    const r = await dispatch('plan.start', { source: { rung: 'medium' }, startDate: START });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked', detail: { allowedAlternatives: ['planner.find'] } });
    expect(versions()).toEqual([]);
    expect(getDocumentStore().peekAll('dailyLogs')).toHaveLength(1);
  }, 120_000);
});

describe('A1-004: start validates and fingerprints the FINAL anchored prescription', () => {
  function runWithCertifiedOption(runRequest: typeof request): PlanOption {
    const ctx = compileRequest(runRequest);
    const e = evaluatePlanSafety(ctx, fx.plan.schedule, null);
    const certificate = bound(ctx, fx.plan.schedule, e.status, undefined, undefined, 'start');
    const option = {
      id: 'B', name: 'B', schedule: fx.plan.schedule, simulation: { meta: { registryHash: 'reg', engineVersion: 'eng' }, daily: {} },
      scorecard: [{ goal: 0, metric: 'fatMass', start: 26.6, value: 25.9, band: null }, { goal: 1, metric: 'leanTissue', start: 63, value: 63, band: null }],
      bands: { draws: 0, series: {} }, safetyNotes: [], safetyItems: [], explanation: ['Medium plan.'],
      safety: { status: certificate.status === 'verified' ? 'verified' : 'unchecked', evaluations: e.evaluations, audit: PASS, certificate, outcomeHoldout: { draws: 0, status: 'notRun' } },
    } as unknown as PlanOption;
    withSystemWrite(() => {
      plannerState.runStarted('run-final', runRequest, Date.now());
      plannerState.runFinished({ options: [option], provenance: fx.plan.provenance } as unknown as PlannerResult, Date.now());
    }, 'test planner run');
    return option;
  }
  const started = () => versions().find((v) => v.version === 1 && v.reason === 'start')!;
  const planDoc = () => bodyOf<PlanDoc>(getDocumentStore().peek('plans', getDocumentStore().peek<{ planId: string }>('activePlan', 'me')!.planId)!);

  it('another start date than the run certified is refused before any write; one declared audit binds exactly the final subject', async () => {
    vi.setSystemTime(NOON(addDays(START, -3)));
    await getDocumentStore().ready;
    const option = runWithCertifiedOption(currentRequestSync());
    const later = addDays(START, 7); // the same weekday: only the dates change, and with them the subject
    const refused = await dispatch('plan.start', { source: { rung: 'medium' }, startDate: later });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatchObject({ code: 'safety_blocked', detail: { allowedAlternatives: ['planner.find'] } });
    expect(versions()).toEqual([]);
    const calls: Array<Parameters<LifecycleFinalAudit>[0]> = [];
    installLivingPorts({ planner: { replan: livingReplan }, audit: fakeAudit(calls) });
    out(await dispatch('plan.start', { source: { rung: 'medium' }, startDate: later }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.schedule.startDate).toBe(later);
    const v = started();
    expect(v.schedule.startDate).toBe(later);
    expect(v.safetyStatus).toBe('verified');
    // the stored certificate is exactly what was checked: revalidating the stored request and schedule reproduces it
    const rv = revalidatePlanSafety(planDoc().request, v.schedule, { boundary: 'start', certificate: v.certificate! });
    expect(rv.fingerprint).toBe(v.certificate!.fingerprint);
    expect(rv.certificateValid).toBe(true);
    // the source certificate stays provenance in the history, never the authorization
    expect(v.certificate!.fingerprint).not.toBe(option.safety!.certificate!.fingerprint);
    expect(v.certificate!.history?.[0]?.fingerprint).toBe(option.safety!.certificate!.fingerprint);
  }, 120_000);

  it('the unchanged start keeps its own certificate: no audit is asked for', async () => {
    vi.setSystemTime(NOON(addDays(START, -3)));
    await getDocumentStore().ready;
    const calls: Array<Parameters<LifecycleFinalAudit>[0]> = [];
    installLivingPorts({ planner: { replan: livingReplan }, audit: fakeAudit(calls) });
    const option = runWithCertifiedOption(currentRequestSync());
    out(await dispatch('plan.start', { source: { rung: 'medium' }, startDate: START }));
    expect(calls).toHaveLength(0);
    expect(started().certificate?.fingerprint).toBe(option.safety!.certificate!.fingerprint);
  }, 120_000);
});

describe('A1-012: a certificate binds the confirmed state its audit consumed', () => {
  it('a proposal certified under one confirmed state does not authorize after a confirmation changed the correction', async () => {
    await seedWithProposal();
    // a confirmed check-in since (same history, another energy-balance correction): the audited initial state changed
    await getDocumentStore().transact(mintWriteToken('migration', { label: 'record' }), async (tx) => {
      const record: ConfirmedStateRecord = {
        planId: PLAN_ID, anchorDate: addDays(START, 6), anchorDay: 6, trendWeight: { kg: 94.4, sd: 0.4 }, energyBiasKcal: { mean: 150, sd: 120 },
        residualSplit: { tissueMassKg: 70, residualKg: 0, fatKg: 0, leanKg: 0, source: 'engine' }, inputsHash: 'x', engine: { engineVersion: 'e', registryHash: 'r' }, trigger: 'weekly',
      };
      await tx.append('anchors', { ...record, _id: `${PLAN_ID}:${addDays(START, 6)}` });
    });
    const r = await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: 2 });
    expect(r.ok).toBe(false);
    // the certificate is not valid for the new state; the audit from that state runs and fails here: still refused
    expect(!r.ok && r.error).toMatchObject({ code: 'safety_blocked', detail: { rule: 'lifecycle:auditFailed', reason: 'review' } });
    expect(versions().map((v) => v.status)).toEqual(['adopted', 'proposed']);
  }, 120_000);
});

describe('idempotence of a confirmed decision (D5-02)', () => {
  it('a check-in retried the same day keeps one stored decision', async () => {
    await seed();
    const store = getDocumentStore();
    await store.transact(mintWriteToken('migration', { label: 'weigh-ins' }), async (tx) => {
      for (let d = 1; d < TODAY_IDX; d++) {
        const date = addDays(START, d);
        await tx.append('measurements', { _id: `w${d}`, date, at: `${date}T07:00:00.000Z`, metric: 'weightKg', value: 95 - 0.1 * d, context: 'morningFasted', source: { by: 'user', method: 'typed' } });
      }
    });
    const records = () => store.peekAll<ConfirmedStateRecord>('anchors').map((d) => bodyOf<ConfirmedStateRecord>(d));
    expect(out<{ verdict: string }>(await dispatch('plan.checkIn', {})).verdict).toBe('confirmed');
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ decisionId: `${PLAN_ID}:${TODAY}`, historyHash: await historyHashNow(), trendWeightOperator: 'waterAdjustedWake' });
    // the retry (a double tap, a command replay) answers again without a second decision
    expect(out<{ verdict: string }>(await dispatch('plan.checkIn', {})).verdict).toBe('confirmed');
    expect(records()).toHaveLength(1);
  }, 120_000);
});
