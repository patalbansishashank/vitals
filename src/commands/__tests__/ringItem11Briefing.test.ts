/**
 * Plan 04 item 11 (SUITE_SPEC §15.2): the Coach briefing and the MCP reads carry a ring's data with no switch pressed;
 * the master switch off ("Use my ring data in my plan and Coach") hides it from both; an Apple Health import stays
 * hidden from the Coach as before. Runs through the real command bus with a seeded plan and ring (synthetic data).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLICY_STREAMS, ringDefaultPolicies } from '@/biometrics/core/policy';
import { SCORE_CATALOGUE } from '@/biometrics/core/scores/catalogue';
import { newSourceDoc, sourceKeyOf } from '@/biometrics/core/source';
import type { BioProvenance, BioRecord, StreamPolicy } from '@/biometrics/core/types';
import { rescoreHistory } from '@/biometrics/ingest/rescoreJob';
import type { PersonProfile } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, HIDDEN_WHY, type PlanDoc, type PlanVersionDoc, type TodayView } from '@/living';
import { addDays } from '@/living/dates';
import { mintWriteToken } from '@/store';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { allCommands, commandBus, dispatch, getCommand, settleCommits, type CommandResult } from '@/commands';
import { deriveWriter, openBioStore } from '@/commands/bio/store';
import { setTimeZoneSource } from '@/commands/bus';
import { resetBioRuntime } from '@/commands/bio/runtime';
import { MCP, freshState } from './harness';
import { buildBriefing, gatherBriefingData } from '@/ai/coach/briefing';
import type { CoachBus } from '@/ai/coach/tools';

const TODAY = '2026-10-01';
const YESTERDAY = '2026-09-30';
const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ1';

const RING_PROV: BioProvenance = {
  channel: 'ble:jstyle2301', recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-10-01T06:45:00.000Z',
  device: { type: 'ring', model: 'J-Style 2301', tier: 'C' },
};
const APPLE_PROV: BioProvenance = {
  channel: 'file:apple_health', recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-10-01T06:45:00.000Z',
  source_app: 'Health', device: { type: 'watch', tier: 'B' },
};
/** The ring service's key for one ring (`ble:<family>/<model>/<ringId>`; synthetic id). */
const RING = 'ble:jstyle2301/2301/serial:TEST0001';
const APPLE = sourceKeyOf(APPLE_PROV);

const quality = { validation: 'measured', confidence: null, flags: [] } as const;
function days(prov: BioProvenance, tag: string): BioRecord[] {
  const out: BioRecord[] = [];
  for (const d of [YESTERDAY, TODAY]) {
    out.push({ kind: 'sleep', record_id: `${tag}-s-${d}`, version: 1, time: { start: `${addDays(d, -1)}T23:00:00.000Z`, end: `${d}T06:30:00.000Z`, tz_offset_s: 0, local_date: d }, provenance: prov, quality: { ...quality, flags: [] }, is_main: true, asleep_s: 7 * 3600, in_bed_s: 7.5 * 3600 } as BioRecord);
    out.push({ kind: 'daily', record_id: `${tag}-d-${d}`, version: 1, time: { tz_offset_s: 0, local_date: d }, provenance: prov, quality: { ...quality, flags: [] }, steps: 9000, resting_hr_bpm: 54 } as BioRecord);
  }
  return out;
}

async function seedPlan() {
  const man: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-09-28' };
  const plan = {
    name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-09-27T10:00:00.000Z' }, status: 'active',
    startDate: '2026-09-28', plannedEndDate: '2026-10-26', request: { profile: man, goals: [], horizonDays: 28 }, baselineProfile: man, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-09-27T10:00:00.000Z',
  } as unknown as PlanDoc;
  const day = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 2000 }, macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } }, steps: 8000 };
  const version = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: { schemaVersion: 1, startDate: '2026-09-28', horizonDays: 28, programs: [day], days: Array.from({ length: 28 }, () => ({ program: 0 })) },
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-09-27T10:00:00.000Z',
  } as unknown as PlanVersionDoc;
  const store = getDocumentStore();
  await store.ready;
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: '2026-09-28' });
  });
}

/** A source with its records and last night's heart-rate samples, written the way a ring sync writes them. */
async function seedSource(prov: BioProvenance, label: string, policies: StreamPolicy[], tag: string, sourceKey = prov === RING_PROV ? RING : sourceKeyOf(prov)) {
  const store = await openBioStore({ writer: deriveWriter() });
  await store.putSource({ sourceKey, label, tier: prov.device?.tier ?? 'C', priority: 0, policies, baselineEpochs: [] });
  for (const r of days(prov, tag)) await store.putRecord(r, sourceKey);
  const t0 = Date.parse(`${TODAY}T01:00:00.000Z`);
  await store.putSamples({ sourceKey, stream: 'hr', local_date: TODAY }, [0, 1, 2].map((k) => ({ t: t0 + k * 60_000, value: 52 + k, origin: 'history' as const })), { tz_offset_s: 0, createdAt: '2026-10-01T06:45:00.000Z' });
  await store.flush();
  // total sleep time over the nights, as the background rescore computes it
  await rescoreHistory(store, { defs: SCORE_CATALOGUE.filter((d) => d.scoreId === 'sleep.tst'), from: YESTERDAY, to: TODAY, now: '2026-10-01T07:00:00.000Z', build: 't' });
  await store.flush();
}

/** The Ring page's master switch, as the person turns it. */
async function masterSwitch(on: boolean) {
  expect(out<{ state: string }>(await dispatch('bio.setRingSharing', { on })).state).toBe(on ? 'on' : 'off');
  await settleCommits();
}

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(`command failed: ${JSON.stringify(r)}`);
  return r.output as T;
}

type Daily = { days: Array<{ date: string; values: Record<string, { value: number; source: string }>; sleep?: { asleepH: number; source: string } }>; hidden: string[] };
type Scores = { results: Array<{ scoreId: string; status: string; source: string | null }>; hidden: string[] };
type Series = { points: Array<{ value: number; source: string }>; hidden: boolean };

const bus = () => ({ ...commandBus, getCommand, commandIds: () => allCommands().map((d) => d.id) }) as unknown as CoachBus;
async function briefing() {
  // warm the shared biometrics index first, so today.get's observations read the stored documents
  await dispatch('bio.daily', { from: YESTERDAY, to: TODAY });
  const data = await gatherBriefingData(bus(), new Date(`${TODAY}T12:00:00.000Z`), TODAY, addDays);
  return { data, built: buildBriefing(data, { addDays }) };
}
const textOf = (b: ReturnType<typeof buildBriefing>) => b.sections.map((s) => s.text).join('\n');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the Coach briefing carries ring data by default (item 11)', () => {
  it('last night’s sleep, resting HR and steps from the ring, with no switch pressed', { timeout: 30_000 }, async () => {
    await seedPlan();
    await seedSource(RING_PROV, 'J-Style 2301', ringDefaultPolicies(), 'r');
    const { data, built } = await briefing();
    const signals = built.sections.find((s) => s.id === 'signals')?.text ?? '';
    expect(signals).toContain(`${TODAY}: sleep 7.0 h asleep (J-Style 2301); steps 9000, resting_hr_bpm 54 bpm (J-Style 2301)`);
    expect(signals).toContain(`${YESTERDAY}: sleep 7.0 h asleep (J-Style 2301)`);
    expect(built.visible.about).toContain('Body signals from J-Style 2301: sleep, steps, resting heart rate.');
    expect(data.bodySignals?.hidden).toEqual([]);
  });

  it('with the master switch off the ring is gone from the briefing', { timeout: 30_000 }, async () => {
    await seedPlan();
    await seedSource(RING_PROV, 'J-Style 2301', ringDefaultPolicies(), 'r');
    await masterSwitch(false);
    await settleCommits();
    const { data, built } = await briefing();
    expect(built.sections.some((s) => s.id === 'signals')).toBe(false);
    expect(data.bodySignals?.hidden).toEqual(expect.arrayContaining(['hr', 'sleep_sessions', 'steps']));
    expect(textOf(built)).not.toContain('J-Style 2301');
    expect(built.visible.about.some((l) => l.startsWith('Body signals'))).toBe(false);
  });

  it('an Apple Health import keeps the old default: the Coach does not see it', { timeout: 30_000 }, async () => {
    await seedPlan();
    const doc = newSourceDoc(APPLE_PROV, 0, POLICY_STREAMS);
    expect(doc.policies.every((p) => p.coach === 'hidden')).toBe(true);
    await seedSource(APPLE_PROV, 'Health', doc.policies, 'a');
    const { data, built } = await briefing();
    expect(built.sections.some((s) => s.id === 'signals')).toBe(false);
    expect(data.bodySignals?.hidden).toEqual(expect.arrayContaining(['sleep_sessions', 'steps']));
  });
});

describe('MCP reads follow the same switch (item 11)', () => {
  it('bio.daily and bio.series as an MCP client include the ring with the defaults', { timeout: 30_000 }, async () => {
    await seedSource(RING_PROV, 'J-Style 2301', ringDefaultPolicies(), 'r');
    const daily = out<Daily>(await dispatch('bio.daily', { from: YESTERDAY, to: TODAY }, { actor: MCP }));
    expect(daily.hidden).toEqual([]);
    const today = daily.days.find((d) => d.date === TODAY)!;
    expect(today.sleep).toMatchObject({ asleepH: 7, source: 'J-Style 2301' });
    expect(today.values['resting_hr_bpm']).toMatchObject({ value: 54, source: 'J-Style 2301' });
    expect(today.values['steps']?.value).toBe(9000);
    const series = out<Series>(await dispatch('bio.series', { metric: 'hr', from: TODAY, to: TODAY }, { actor: MCP }));
    expect(series.hidden).toBe(false);
    expect(series.points.map((p) => p.value)).toEqual([52, 53, 54]);
  });

  it('with the master switch off they list the ring’s streams as hidden and return none of its values', { timeout: 30_000 }, async () => {
    await seedSource(RING_PROV, 'J-Style 2301', ringDefaultPolicies(), 'r');
    await masterSwitch(false);
    const daily = out<Daily>(await dispatch('bio.daily', { from: YESTERDAY, to: TODAY }, { actor: MCP }));
    expect(daily.days).toEqual([]);
    expect(daily.hidden).toEqual(expect.arrayContaining(['hr', 'sleep_sessions', 'steps']));
    const series = out<Series>(await dispatch('bio.series', { metric: 'hr', from: TODAY, to: TODAY }, { actor: MCP }));
    expect(series.points).toEqual([]);
    expect(series.hidden).toBe(true);
    const scores = out<Scores>(await dispatch('bio.scores', { from: YESTERDAY, to: TODAY }, { actor: MCP }));
    expect(scores.results.some((r) => r.scoreId === 'sleep.tst')).toBe(false);
    // the person still sees their ring (imported stays on)
    const mine = out<Daily>(await dispatch('bio.daily', { from: YESTERDAY, to: TODAY }));
    expect(mine.days.find((d) => d.date === TODAY)?.values['steps']?.value).toBe(9000);
    // on again: shared again
    await masterSwitch(true);
    const back = out<Daily>(await dispatch('bio.daily', { from: YESTERDAY, to: TODAY }, { actor: MCP }));
    expect(back.hidden).toEqual([]);
    expect(back.days.find((d) => d.date === TODAY)?.sleep?.asleepH).toBe(7);
  });

  // Known gap (request filed with the hand-back): bio.scores decides an agent's view from the person-level matrix, whose
  // unset streams read "Coach hidden", not from the score's source; so a ring's scores stay hidden from the Coach and MCP
  // under the ring defaults. Drop `.fails` once bio.scores uses the source's Coach policy as bio.daily does.
  it('bio.scores as an MCP client includes the ring’s scores with the defaults', { timeout: 30_000 }, async () => {
    await seedSource(RING_PROV, 'J-Style 2301', ringDefaultPolicies(), 'r');
    const mine = out<Scores>(await dispatch('bio.scores', { from: YESTERDAY, to: TODAY }));
    expect(mine.results.filter((r) => r.scoreId === 'sleep.tst').map((r) => r.status)).toEqual(['ok', 'ok']);
    const agent = out<Scores>(await dispatch('bio.scores', { from: YESTERDAY, to: TODAY }, { actor: MCP }));
    expect(agent.hidden).toEqual([]);
    expect(agent.results.filter((r) => r.scoreId === 'sleep.tst')).toHaveLength(2);
  });

  it('the per-stream Coach switch hides just that stream', { timeout: 30_000 }, async () => {
    await seedSource(RING_PROV, 'J-Style 2301', ringDefaultPolicies().map((p) => (p.stream === 'sleep_sessions' ? { ...p, coach: 'hidden' as const } : p)), 'r');
    const daily = out<Daily>(await dispatch('bio.daily', { from: YESTERDAY, to: TODAY }, { actor: MCP }));
    expect(daily.hidden).toEqual(['sleep_sessions']);
    expect(daily.days.find((d) => d.date === TODAY)?.sleep).toBeUndefined();
    expect(daily.days.find((d) => d.date === TODAY)?.values['steps']?.value).toBe(9000);
  });

  it('an Apple Health import stays hidden from MCP clients', { timeout: 30_000 }, async () => {
    await seedSource(APPLE_PROV, 'Health', newSourceDoc(APPLE_PROV, 0, POLICY_STREAMS).policies, 'a');
    const daily = out<Daily>(await dispatch('bio.daily', { from: YESTERDAY, to: TODAY }, { actor: MCP }));
    expect(daily.days).toEqual([]);
    expect(daily.hidden).toEqual(expect.arrayContaining(['sleep_sessions', 'steps']));
    expect(APPLE).not.toBe(RING);
  });
});

describe('a stream the plan uses but the Coach does not see (MCP-01)', () => {
  beforeEach(() => setTimeZoneSource(() => 'UTC'));
  afterEach(() => setTimeZoneSource(null));

  /** The ring with sleep and steps used by the plan and `coach` as given; both days logged from it as the person does. */
  async function ringLogged(coach: 'hidden' | 'daily', byHand?: () => Promise<void>) {
    await seedPlan();
    await byHand?.();
    const policies = ringDefaultPolicies().map((p) => (p.stream === 'sleep_sessions' || p.stream === 'steps' ? { ...p, engine: true, coach } : p));
    await seedSource(RING_PROV, 'J-Style 2301', policies, 'r');
    for (const date of [YESTERDAY, TODAY]) expect(out<{ created: unknown[] }>(await dispatch('log.fromBiometrics', { date })).created.length).toBeGreaterThan(0);
    await settleCommits();
  }
  const briefingGet = async () => out<{ text: string }>(await dispatch('briefing.get', {}, { actor: MCP })).text;

  it('hidden: no sleep hours, steps or flags from the ring in either briefing, today.get or log.get; the plan still uses them', { timeout: 30_000 }, async () => {
    await ringLogged('hidden');
    // the person sees their ring's values, and the plan credits them
    const mine = out<TodayView>(await dispatch('today.get', {}));
    expect(mine.logged).toMatchObject({ steps: 9000, sleepHours: 7.5 });
    expect(mine.adherence.today?.items.find((i) => i.type === 'steps')).toMatchObject({ credit: 1, why: '9000 steps' });

    const { data, built } = await briefing();
    for (const text of [textOf(built), await briefingGet()]) {
      expect(text).not.toMatch(/9000|sleepHours|h asleep|Body-signal flags|"scoreId":"sleep\.tst"/);
      expect(text).not.toContain(`${YESTERDAY}: steps`);
      expect(text).toContain('Plan: Medium plan');
    }
    expect(data.todayView?.logged.steps).toBeUndefined();
    expect(data.todayView?.logged.sleepHours).toBeUndefined();
    expect(built.visible.today?.logged.entries).toEqual([]);

    // today.get and log.get as an MCP client
    const agent = out<TodayView>(await dispatch('today.get', {}, { actor: MCP }));
    expect(JSON.stringify(agent)).not.toMatch(/9000|sleepHours/);
    expect(agent.logged.entries).toEqual([]);
    expect(agent.biometrics).toBeNull();
    // what the plan made of it stays: steps done, the number left out
    expect(agent.adherence.today?.items.find((i) => i.type === 'steps')).toMatchObject({ credit: 1, why: HIDDEN_WHY });
    expect(agent.adherence.today?.score).toBe(mine.adherence.today?.score);
    expect(out<unknown[]>(await dispatch('log.get', { from: YESTERDAY, to: TODAY }, { actor: MCP }))).toEqual([]);
    expect(out<unknown[]>(await dispatch('log.get', { from: YESTERDAY, to: TODAY }))).toHaveLength(4);
    // day.get (an MCP tool too): no device entries and no line that quotes their values
    type DayOut = { entries: unknown[]; score: { items: Array<{ type: string; credit: number | null; why: string }> } | null };
    const myDay = out<DayOut>(await dispatch('day.get', {}));
    expect(JSON.stringify(myDay)).toMatch(/9000/);
    const agentDay = out<DayOut>(await dispatch('day.get', {}, { actor: MCP }));
    expect(JSON.stringify(agentDay)).not.toMatch(/9000|7\.5 h/);
    expect(agentDay.entries).toEqual([]);
    expect(agentDay.score?.items.find((i) => i.type === 'steps')).toMatchObject({ credit: 1, why: HIDDEN_WHY });
  });

  // L-REV2 R3-08: an agent that logs the day from the ring is not told the values of a hidden stream
  it('hidden: log.fromBiometrics by an agent writes the entries but does not echo their values', { timeout: 30_000 }, async () => {
    await seedPlan();
    const policies = ringDefaultPolicies().map((p) => (p.stream === 'sleep_sessions' || p.stream === 'steps' ? { ...p, engine: true, coach: 'hidden' as const } : p));
    await seedSource(RING_PROV, 'J-Style 2301', policies, 'r');
    const res = out<{ created: Array<Record<string, unknown>> }>(await dispatch('log.fromBiometrics', { date: TODAY }, { actor: MCP }));
    await settleCommits();
    expect(res.created.map((c) => c.stream).sort()).toEqual(['sleep_sessions', 'steps']);
    expect(JSON.stringify(res)).not.toMatch(/9000|bedAt|wakeAt/);
    // the plan still gets them, and the person sees them
    expect(out<TodayView>(await dispatch('today.get', {})).logged).toMatchObject({ steps: 9000, sleepHours: 7.5 });
    // a stream the Coach sees keeps its values for the agent
    await seedSource(RING_PROV, 'J-Style 2301', ringDefaultPolicies().map((p) => ({ ...p, engine: true })), 'r');
    const shared = out<{ created: Array<Record<string, unknown>> }>(await dispatch('log.fromBiometrics', { date: YESTERDAY }, { actor: MCP }));
    expect(shared.created.find((c) => c.stream === 'steps')).toMatchObject({ steps: 9000 });
  });

  it('hidden: a value the person logged by hand is not device data and stays', { timeout: 30_000 }, async () => {
    // last night's sleep typed in before the ring came, so the ring's night is skipped and its steps are logged
    await ringLogged('hidden', async () => {
      out(await dispatch('log.sleep', { bedAt: `${YESTERDAY}T22:00:00.000Z`, wakeAt: `${TODAY}T06:00:00.000Z` }));
      await settleCommits();
    });
    const agent = out<TodayView>(await dispatch('today.get', {}, { actor: MCP }));
    expect(agent.logged.sleepHours).toBe(8);
    expect(agent.logged.steps).toBeUndefined();
    expect(agent.logged.entries.map((e) => e.kind)).toEqual(['sleep']);
    const plan = (await briefing()).built.sections.find((s) => s.id === 'plan')?.text ?? '';
    expect(plan).toContain('"sleepHours":8');
    expect(plan).not.toContain('9000');
  });

  it('shared daily: the same values reach both briefings, today.get and log.get', { timeout: 30_000 }, async () => {
    await ringLogged('daily');
    const { built } = await briefing();
    const mcp = await briefingGet();
    for (const text of [textOf(built), mcp]) {
      expect(text).toMatch(/Logged today: .*"steps":9000.*"sleepHours":7\.5/);
      expect(text).toContain(`${TODAY}: sleep 7.0 h asleep (J-Style 2301); steps 9000`);
      expect(text).toContain(`${YESTERDAY}: steps, sleep`);
    }
    const agent = out<TodayView>(await dispatch('today.get', {}, { actor: MCP }));
    expect(agent.logged).toMatchObject({ steps: 9000, sleepHours: 7.5 });
    expect(agent.adherence.today?.items.find((i) => i.type === 'steps')?.why).toBe('9000 steps');
    expect(out<unknown[]>(await dispatch('log.get', { from: YESTERDAY, to: TODAY }, { actor: MCP }))).toHaveLength(4);
  });

  describe('log.fromBiometrics echoes ring values only where the Coach sees them', () => {
    type Made = { created: Array<{ entryId: string; kind: string; steps?: number; bedAt?: string; wakeAt?: string }> };
    async function ring(coach: 'hidden' | 'daily' | null) {
      await seedPlan();
      const policies = ringDefaultPolicies().map((p) => (p.stream === 'sleep_sessions' || p.stream === 'steps' ? { ...p, engine: true, ...(coach ? { coach } : {}) } : p));
      await seedSource(RING_PROV, 'J-Style 2301', policies, 'r');
    }

    it('an agent with the Coach switch off gets the entry ids but no steps or bed/wake times; the entries are written', { timeout: 30_000 }, async () => {
      await ring('hidden');
      const made = out<Made>(await dispatch('log.fromBiometrics', { date: TODAY }, { actor: MCP }));
      expect(made.created.map((c) => c.kind).sort()).toEqual(['sleep', 'steps']);
      expect(JSON.stringify(made)).not.toMatch(/9000|bedAt|wakeAt|"steps":\d/);
      await settleCommits();
      const mine = out<Array<{ id: string; kind: string; steps?: number }>>(await dispatch('log.get', { from: TODAY, to: TODAY }));
      expect(mine.map((e) => e.id).sort()).toEqual(made.created.map((c) => c.entryId).sort());
      expect(mine.find((e) => e.kind === 'steps')?.steps).toBe(9000);
    });

    it('an agent with the ring defaults (shared) gets the values', { timeout: 30_000 }, async () => {
      await ring(null);
      const made = out<Made>(await dispatch('log.fromBiometrics', { date: TODAY }, { actor: MCP }));
      expect(made.created.find((c) => c.kind === 'steps')?.steps).toBe(9000);
      expect(made.created.find((c) => c.kind === 'sleep')?.bedAt).toEqual(expect.any(String));
    });

    it('the person’s own call always gets the values, switch off too', { timeout: 30_000 }, async () => {
      await ring('hidden');
      const made = out<Made>(await dispatch('log.fromBiometrics', { date: TODAY }));
      expect(made.created.find((c) => c.kind === 'steps')?.steps).toBe(9000);
      expect(made.created.find((c) => c.kind === 'sleep')).toMatchObject({ bedAt: expect.any(String), wakeAt: expect.any(String) });
    });
  });
});
