/**
 * The activity review through the command bus (energy SPEC §V3, the owner's words): detected activities and their energy
 * come in automatically; the person approves all, approves one, edits or rejects; with neither ring nor phone worn they
 * log by hand; going over or under the plan shows in the replayed projection. Scenarios:
 *  - approving all vs one (revision binding, idempotence, one undo for approve all);
 *  - an edit that changes the calories;
 *  - a rejection never resurrects and a late one removes the energy and changes the history;
 *  - a no-device manual-log day;
 *  - an over-plan workout day raises the replayed TEE by its incremental energy, the forecast only (D10);
 *  - replay determinism (the same documents replay to the same hash; two devices write the same rows).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintWriteToken, bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState, AI } from '@/commands/__tests__/harness';
import { useProfileStore } from '@/state/profileStore';
import { readDocs } from '@/commands/living';
import { simulate, type DayTemplate } from '@/engine';
import { addDays, DEFAULT_ITEM_WEIGHTS, effectiveEntries, evaluateTriggers, localToInstant, projectLiving, projectionSchedule, type LogEntry, type PlanDoc, type PlanVersionDoc } from '@/living';
import type { ActivityCandidateDoc, ReviewSheetModel } from '@/living/activityCandidates';
import { editedDecision, previewEstimate, readCandidates } from '../activity';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXY33';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const START = '2026-10-14';
const TODAY = '2026-10-21';
const Y = addDays(TODAY, -1);
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };

const REST: DayTemplate = {
  id: 'R', label: 'rest day', energy: { kind: 'kcal', kcal: 2100 },
  macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  steps: 8000, sleep: { bedH: 23, wakeH: 7 },
};
const WALK: DayTemplate = { ...REST, id: 'W', label: 'walk day', exercise: [{ kind: 'cardio', modality: 'walk', startH: 7, durationMin: 30 }] };

const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};


/** (0.6.3 S2) The person's own basics: the estimators never fall back to the typical ones (these are the values they showed). */
function enterBasics(): void {
  const p = useProfileStore.getState();
  p.setAge(40);
  p.setHeight(169);
  p.setWeight(80);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ms(TODAY, 12)));
});
afterAll(() => {
  vi.useRealTimers();
});

async function seed(): Promise<void> {
  freshState({ cleared: true });
  enterBasics();
  const store = getDocumentStore();
  await store.ready;
  const profile = { schemaVersion: 1 as const, body: { sex: 'male' as const, ageYears: 40, heightCm: 180, weightKg: 80 }, startDate: START };
  const plan: PlanDoc = {
    name: 'Plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${START}T06:00:00.000Z` }, status: 'active',
    startDate: START, plannedEndDate: addDays(START, 28), request: { profile, goals: [], horizonDays: 28 }, baselineProfile: profile, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: `${START}T06:00:00.000Z`,
  };
  const version: PlanVersionDoc = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    // day 6 (yesterday) prescribes a 30-min walk at 07:00; every other day is a rest day
    schedule: { schemaVersion: 1, startDate: START, horizonDays: 28, programs: [REST, WALK], days: Array.from({ length: 28 }, (_, d) => ({ program: d === 6 ? 1 : 0 })) },
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${START}T06:00:00.000Z`,
  };
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
  });
}

const walkY = (rev = 'r1', endH = 7.75) => ({ id: 'g-walk', revision: rev, start: ms(Y, 7), end: ms(Y, endH), type: 'walk', kcal: 210 });
const runY = (rev = 'r1') => ({ id: 'g-run', revision: rev, start: ms(Y, 18), end: ms(Y, 18.5), type: 'run', kcal: 330 });

async function importSessions(sessions: Array<ReturnType<typeof walkY>>): Promise<{ created: string[]; updated: string[]; blocked: string[] }> {
  const r = await dispatch('activity.fromGauge', { gaugeSessions: sessions, hcSessions: [] }, SYS);
  await settleCommits();
  return out(r);
}
async function review(from = Y, to = Y): Promise<ReviewSheetModel> {
  return out<ReviewSheetModel>(await dispatch('activity.candidates', { from, to }));
}
function sessions(): Array<Extract<LogEntry, { kind: 'session' }>> {
  const all = getDocumentStore().peekAll<LogEntry>('dailyLogs').map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id }) as LogEntry);
  return effectiveEntries(all).filter((e): e is Extract<LogEntry, { kind: 'session' }> => e.kind === 'session');
}
async function projection() {
  const docs = await readDocs(TODAY);
  return projectLiving({ docs, today: TODAY, tz: TZ, now: new Date(ms(TODAY, 12)).toISOString(), skipAssimilation: true });
}

beforeEach(seed);

describe('approving all vs one', () => {
  it('approve one writes one done session; approve all binds the visible revisions and one undo reverts it', async () => {
    expect((await importSessions([walkY(), runY()])).created).toHaveLength(2);
    const m = await review();
    expect(m.rows.map((r) => r.exerciseId)).toEqual(['walk', 'jog_outdoor']);
    expect(m.strip?.text).toMatch(/^2 activities to review · 75 min · ~\d+ kcal$/);
    // pending candidates never enter the plan (D8)
    expect(sessions()).toHaveLength(0);

    const one = await dispatch('activity.approve', { id: m.rows[0]!.id, revision: m.rows[0]!.revision });
    await settleCommits();
    expect(out<{ status: string; entryId: string }>(one)).toMatchObject({ status: 'approved' });
    expect(sessions()).toHaveLength(1);
    // idempotent: the same approval again writes nothing
    expect(out<{ unchanged?: boolean }>(await dispatch('activity.approve', { id: m.rows[0]!.id, revision: m.rows[0]!.revision }))).toMatchObject({ unchanged: true });
    await settleCommits();
    expect(sessions()).toHaveLength(1);

    const all = await dispatch('activity.approveAll', m.approveAll);
    await settleCommits();
    const res = out<{ approved: Array<{ status: string; unchanged?: boolean }> }>(all);
    expect(res.approved.map((a) => a.unchanged === true)).toEqual([true, false]);
    expect(sessions()).toHaveLength(2);
    expect((await review()).rows).toEqual([]);

    // one undo reverts the approve all (the run), the separately approved walk stays
    const cs = 'changeSet' in all ? all.changeSet : null;
    expect(cs).not.toBeNull();
    expect(out<{ undone: boolean }>(await dispatch('history.undo', { changeSetId: cs!.id }))).toMatchObject({ undone: true });
    await settleCommits();
    expect(sessions().map((s) => s.workout?.exerciseType)).toEqual(['walk']);
    expect((await review()).rows.map((r) => r.exerciseId)).toEqual(['jog_outdoor']);
  });

  it('refuses the whole approve all when an item was updated since the person looked', async () => {
    await importSessions([walkY(), runY()]);
    const seen = await review();
    expect((await importSessions([walkY(), runY('r2')])).updated).toHaveLength(1);
    const r = await dispatch('activity.approveAll', seen.approveAll);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('conflict');
    await settleCommits();
    expect(sessions()).toHaveLength(0);
  });

  it('an agent cannot approve directly: the call is staged for the person', async () => {
    await importSessions([walkY()]);
    const m = await review();
    const r = await dispatch('activity.approveAll', m.approveAll, { actor: AI, idempotencyKey: `${AI.conversationId}:${AI.toolCallId}` });
    expect(r.ok && 'pending' in r).toBe(true);
    await settleCommits();
    expect(sessions()).toHaveLength(0);
  });
});

describe('an edit that changes the calories', () => {
  it('re-estimates, supersedes the approved session and keeps one in force', async () => {
    await importSessions([runY()]);
    const row = (await review()).rows[0]!;
    await dispatch('activity.approve', { id: row.id, revision: row.revision });
    await settleCommits();
    const before = sessions()[0]!;
    // the machine showed 480 kcal and it was a 40-minute run: booked as reported
    const ed = await dispatch('activity.edit', { id: row.id, revision: row.revision, endAt: new Date(ms(Y, 18 + 40 / 60)).toISOString(), kcalOverride: 480 });
    await settleCommits();
    expect(out<{ status: string; supersedes?: string }>(ed)).toMatchObject({ status: 'edited', supersedes: before.id });
    const now = sessions();
    expect(now).toHaveLength(1);
    expect(now[0]!.cost).toMatchObject({ grossKcal: 480, method: 'reported', source: 'estimated' });
    expect(now[0]!.cost!.grossKcal).not.toBe(before.cost!.grossKcal);
    expect(now[0]!.durationMin).toBeCloseTo(40, 6);
    expect(now[0]!.source).toMatchObject({ by: 'user', method: 'typed', deviceKey: `gauge:activity:${row.id}` });
    // the projection books the new energy
    const p = await projection();
    expect(p.days.find((d) => d.date === Y)!.result.exercise.knownNetKcal).toBeCloseTo(now[0]!.cost!.netAboveRestKcal, 6);
  });
});

describe('the activity sheet books what it previews (UI audit #3, #16)', () => {
  const candidate = async (id: string) => (await readCandidates()).byKey.get(id) as ActivityCandidateDoc;

  it('previews an edit with the same inputs Save books: the full intensity and the recorded pauses', async () => {
    const paused = { ...walkY(), pauses: [{ start: ms(Y, 7.25), end: ms(Y, 7.25 + 10 / 60) }] };
    await importSessions([paused as ReturnType<typeof walkY>]);
    const row = (await review()).rows[0]!;
    await dispatch('activity.edit', { id: row.id, revision: row.revision, exerciseId: 'treadmill_incline_walk', intensity: { class: 'moderate', speedKmh: 6, gradePct: 5 } });
    await settleCommits();
    const c = await candidate(row.id);
    // the person changes only the effort: speed and grade stay, as the command merges them
    const changes = { intensity: { ...c.decision!.intensity, class: 'vigorous' as const } };
    const draft = editedDecision(c, changes);
    expect(draft.intensity).toEqual({ class: 'vigorous', speedKmh: 6, gradePct: 5 });
    const docs = await readDocs(TODAY);
    const preview = previewEstimate(c, draft, docs, TZ);
    expect(preview.missing).toBeNull();
    // pauses are never exercise time: 45 min recorded, 10 paused
    expect(preview.estimate!.durationMin).toBeCloseTo(35, 6);
    await dispatch('activity.edit', { id: row.id, revision: row.revision, ...changes });
    await settleCommits();
    const booked = sessions()[0]!;
    expect(booked.cost!.grossKcal).toBeCloseTo(preview.estimate!.booked.grossKcal, 6);
    expect(booked.durationMin).toBeCloseTo(35, 6);
    // unchanged: the decided activity keeps what it booked
    expect(previewEstimate(await candidate(row.id), null, docs, TZ).estimate!.booked.grossKcal).toBeCloseTo(booked.cost!.grossKcal, 6);
  });

  it('clears an earlier choice: the planned-session link and the machine kcal', async () => {
    await importSessions([runY()]);
    const row = (await review()).rows[0]!;
    await dispatch('activity.edit', { id: row.id, revision: row.revision, kcalOverride: 480, asItemId: 'cardioSession:6:0' });
    await settleCommits();
    expect(sessions()[0]!.cost).toMatchObject({ grossKcal: 480, method: 'reported' });
    expect(sessions()[0]!.itemId).toBe('cardioSession:6:0');
    const r = await dispatch('activity.edit', { id: row.id, revision: row.revision, clear: ['kcalOverride', 'asItemId'] });
    await settleCommits();
    expect(r.ok).toBe(true);
    const now = sessions();
    expect(now).toHaveLength(1);
    expect(now[0]!.cost!.method).not.toBe('reported');
    expect(now[0]!.itemId).toBeUndefined();
    const c = await candidate(row.id);
    expect(c.decision!.kcalOverride).toBeUndefined();
    expect(c.decision!.asItemId).toBeUndefined();
  });
});

describe('rejection', () => {
  it('a rejected activity never comes back; a late rejection removes its energy and changes the history', async () => {
    await importSessions([runY()]);
    const row = (await review()).rows[0]!;
    const p0 = await projection();
    await dispatch('activity.approve', { id: row.id, revision: row.revision });
    await settleCommits();
    const p1 = await projection();
    expect(p1.history!.contentHash).not.toBe(p0.history!.contentHash);
    expect(p1.days.find((d) => d.date === Y)!.result.exercise.knownNetKcal).toBeGreaterThan(0);
    expect(out<{ retracted?: string }>(await dispatch('activity.reject', { id: row.id })).retracted).toBeDefined();
    await settleCommits();
    expect(sessions()).toHaveLength(0);
    const p2 = await projection();
    expect(p2.days.find((d) => d.date === Y)!.result.exercise.knownNetKcal ?? 0).toBe(0);
    expect(p2.history!.contentHash).not.toBe(p1.history!.contentHash);
    // a re-import (even a new revision of the same session) never resurrects it
    expect((await importSessions([runY('r7')])).blocked).toEqual([row.id]);
    expect((await review()).rows).toEqual([]);
  });
});

describe('a no-device manual-log day', () => {
  it('logs a walk by hand: estimated energy, counted by the day, no device data needed', async () => {
    const d = addDays(TODAY, -2); // a rest day, nothing recorded
    const r = await dispatch('activity.logManual', { exerciseId: 'walk_brisk', date: d, startH: 17, durationMin: 40, intensity: { class: 'moderate', talkTest: 'fullSentences' } }, { idempotencyKey: 'manual-1' });
    await settleCommits();
    const o = out<{ id: string; entryId: string; kcal: number; conflicts: unknown[] }>(r);
    expect(o.kcal).toBeGreaterThan(100);
    expect(o.conflicts).toEqual([]);
    const s = sessions();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ date: d, startH: 17, status: 'done', provenance: 'estimated', physicalBoutId: o.id, source: { by: 'user', method: 'typed' } });
    expect(s[0]!.cost!.inputsProvenance).toMatchObject({ duration: 'reported' });
    const day = (await projection()).days.find((x) => x.date === d)!.result;
    expect(day.exercise).toMatchObject({ plannedItemsResolved: true, logged: 1, withCost: 1, sensorCoverage: 'unknown' });
    expect(day.exercise.netAboveRestKcal).toBeCloseTo(s[0]!.cost!.netAboveRestKcal, 6);
    // the same submit again (idempotency key) writes nothing
    await dispatch('activity.logManual', { exerciseId: 'walk_brisk', date: d, startH: 17, durationMin: 40, intensity: { class: 'moderate' } }, { idempotencyKey: 'manual-1' });
    await settleCommits();
    expect(sessions()).toHaveLength(1);
  });

  it('a manual log overlapping an approved device activity asks first (0.6.3 A5) and merges nothing when they were separate', async () => {
    await importSessions([runY()]);
    const row = (await review()).rows[0]!;
    await dispatch('activity.approve', { id: row.id, revision: row.revision });
    await settleCommits();
    const input = { exerciseId: 'jog_outdoor', date: Y, startH: 18, durationMin: 30, intensity: {} };
    const asked = await dispatch('activity.logManual', input, { idempotencyKey: 'manual-2a' });
    expect(!asked.ok && asked.error).toMatchObject({ code: 'conflict', detail: { reason: 'overlap' } });
    await settleCommits();
    expect(sessions()).toHaveLength(1);
    const r = out<{ conflicts: Array<{ id: string; overlapPct: number }>; resolution: string }>(await dispatch('activity.logManual', { ...input, resolution: 'separate' }, { idempotencyKey: 'manual-2' }));
    expect(r.conflicts).toEqual([expect.objectContaining({ id: row.id, overlapPct: 100, status: 'approved' })]);
    expect(r.resolution).toBe('separate');
    await settleCommits();
    expect(sessions()).toHaveLength(2);
  });
});

describe('an over-plan workout day', () => {
  it('raises the replayed TEE of that day by the bout’s incremental energy; the forecast updates, food does not (D10)', async () => {
    const d = addDays(TODAY, -3); // a rest day: nothing planned
    const before = await projection();
    await importSessions([{ id: 'g-long', revision: 'r1', start: ms(d, 9), end: ms(d, 10.5), type: 'run', kcal: 900 }]);
    const row = (await review(d, d)).rows[0]!;
    await dispatch('activity.approve', { id: row.id, revision: row.revision });
    await settleCommits();
    const after = await projection();
    const bout = sessions()[0]!;
    const I = bout.cost!.incrementalKcal!;
    expect(I).toBeGreaterThan(300);
    const idx = before.days.find((x) => x.date === d)!.planDay;
    const tee = (p: typeof before) => simulate(p.plan!.baselineProfile, projectionSchedule(p, TODAY)!, { record: 'daily', series: ['tdee'], burnInDays: 0 }).daily.tdee![idx]!;
    const delta = tee(after) - tee(before);
    // the day's exercise energy is I plus the recovery released the same day (booked once)
    expect(delta).toBeGreaterThan(0.95 * I);
    expect(delta).toBeLessThan(I + (bout.cost!.recoveryKcal ?? 0.15 * I) + 0.05 * I);
    // the re-plan trigger: forecast only, never an intake change
    const t = evaluateTriggers({ today: TODAY, closedDay: { date: d, items: [], exercise: { incrementalKcal: I, plannedEatKcal: 0 } }, checkInConfirmed: false, declared: [], recent: [], a7: null, scored7: 0, outOfBandDays: 0, safetyBindsInDays: null, requestChanged: false } as never);
    expect(t[0]).toMatchObject({ forecastOnly: true });
  });
});

describe("today: actual so far plus the remaining plan", () => {
  it('an approved bout this morning and the fused steps so far replace the plan’s morning; the rest stays planned', async () => {
    await dispatch('log.fromGauge', { steps: [{ date: TODAY, steps: 3000, fusion: { version: 'steps-fuse/1', located: 3000, headlinePolicy: 'located', coverage: { ringMin: 300, phoneMin: 0, eitherMin: 300, unknownMin: 0 } }, sources: ['ring'] }], sleep: [] }, SYS);
    await importSessions([{ id: 'g-am', revision: 'r1', start: ms(TODAY, 8), end: ms(TODAY, 9), type: 'walk', kcal: 250 }]);
    const row = (await review(TODAY, TODAY)).rows[0]!;
    await dispatch('activity.approve', { id: row.id, revision: row.revision });
    await settleCommits();
    const p = await projection();
    const t = p.todayActual!;
    expect(t.sessions.unplanned).toHaveLength(1);
    expect(t.steps).toMatchObject({ fusedSoFar: 3000, rxSteps: 8000, assumption: 'stepsRemainderPlanShare' });
    expect(t.template.steps).toBe(Math.round(3000 + 8000 * (11 / 16)));
    const s = projectionSchedule(p, TODAY)!;
    const todayIdx = p.days.find((x) => x.date === TODAY)!.planDay;
    const replayed = s.programs[s.days[todayIdx]!.program]!;
    expect(replayed.steps).toBe(t.template.steps);
    expect(replayed.exercise).toHaveLength(1);
    expect(replayed.exercise![0]).toMatchObject({ kind: 'cardio', modality: 'walk', durationMin: 60 });
  });
});

describe('replay determinism', () => {
  it('the same documents replay to the same hash; two devices importing and approving the same thing write the same rows', async () => {
    await importSessions([walkY(), runY()]);
    const m = await review();
    await dispatch('activity.approveAll', m.approveAll);
    await settleCommits();
    const a1 = (await projection()).history!.contentHash;
    const a2 = (await projection()).history!.contentHash;
    expect(a2).toBe(a1);
    const keysA = m.rows.map((r) => r.id);
    const idsA = sessions().map((s) => s.id).sort();

    // a second device: a fresh store, the same plan and the same evidence
    await seed();
    await importSessions([walkY(), runY()]);
    const m2 = await review();
    expect(m2.rows.map((r) => r.id)).toEqual(keysA);
    expect(m2.approveAll).toEqual(m.approveAll);
    await dispatch('activity.approveAll', m2.approveAll);
    await settleCommits();
    expect(sessions().map((s) => s.id).sort()).toEqual(idsA);
  });
});

describe('Codex #11: exact HR zone time from the raw readings', () => {
  // a 10-min ride yesterday 07:00; the day's minute grid around it with the timeline's minute means (140 bpm, 60 s)
  const day = (exact: boolean) => {
    const first = ms(Y, 6.5);
    const n = 60;
    const inRide = (k: number) => k >= 30 && k < 40;
    const minutes = {
      first, steps: Array.from({ length: n }, () => null as number | null), hrBpm: Array.from({ length: n }, (_, k) => (inRide(k) ? 140 : null)),
      hrSupportedS: Array.from({ length: n }, (_, k) => (inRide(k) ? 60 : null)),
    };
    // each ride minute: 30 s at 110, then 30 s at 170 (the 10-s stream's supports)
    const hrExact = Array.from({ length: 60 }, (_, j) => ({ start: ms(Y, 7) + j * 10_000, end: ms(Y, 7) + (j + 1) * 10_000, bpm: j % 6 < 3 ? 110 : 170 }));
    return exact ? { ...minutes, hrExact } : minutes;
  };
  const ride = { id: 'g-ride', revision: 'r1', start: ms(Y, 7), end: ms(Y, 7) + 10 * 60_000, type: 'cycle_outdoor', kcal: 90 };

  it('keeps the exact segments on the evidence and books Heart Points from them (15, not 20), naming the source', async () => {
    await dispatch('activity.fromGauge', { gaugeSessions: [ride], hcSessions: [], minutes: [day(true)] }, SYS);
    await settleCommits();
    const s = await readCandidates();
    const c = [...s.byKey.values()].find((x) => !('compact' in x && x.compact) && (x as ActivityCandidateDoc).refs.includes('gauge:g-ride')) as ActivityCandidateDoc;
    expect(c.evidence?.hrExact).toHaveLength(60);
    expect(c.estimate?.hrSource).toBe('samples');
    // age 40: 110 bpm = 1 point/min, 170 = 2 → 10 min × (0.5 + 1) = 15
    expect(c.estimate?.heartPoints).toBeCloseTo(15, 6);
  });

  it('falls back to the minute means without the raw readings, and says so (20 points)', async () => {
    await dispatch('activity.fromGauge', { gaugeSessions: [ride], hcSessions: [], minutes: [day(false)] }, SYS);
    await settleCommits();
    const s = await readCandidates();
    const c = [...s.byKey.values()].find((x) => !('compact' in x && x.compact) && (x as ActivityCandidateDoc).refs.includes('gauge:g-ride')) as ActivityCandidateDoc;
    expect(c.evidence?.hrExact).toBeUndefined();
    expect(c.estimate?.hrSource).toBe('minuteMeans');
    expect(c.estimate?.heartPoints).toBeCloseTo(20, 6);
  });
});
