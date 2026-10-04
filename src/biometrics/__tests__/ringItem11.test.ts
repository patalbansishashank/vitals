/**
 * Plan 04 item 11 (SUITE_SPEC §15.2): a ring's data reaches the plan and the scores by default, with no switch pressed;
 * the master switch off (`ringSharingOffPolicy`) or a stream's own plan switch off takes it out again; a non-ring import
 * keeps the old opt-in default. The plan side runs the living plan's projection (LoggedDays, adherence and the engine
 * replay of the realised days) over the ring's observations; the score side runs the rescore job over a store.
 * Synthetic person and ring data only.
 */
import { describe, expect, it } from 'vitest';
import type { PersonProfile } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, projectLiving, type MeasurementEntry, type PlanDoc, type PlanVersionDoc } from '@/living';
import { buildObservations } from '../core/observations';
import { defaultPolicies, sourceKeyOf } from '../core/source';
import { ringDefaultPolicies, ringSharingOffPolicy, POLICY_STREAMS, normalizePolicy } from '../core/policy';
import { SCORE_CATALOGUE } from '../core/scores/catalogue';
import type { BioProvenance, BioRecord, BioSourceDoc, PolicyStream, StreamPolicy } from '../core/types';
import { rescoreHistory } from '../ingest/rescoreJob';
import { InMemoryBioStore } from '../store/memory';

const TZ = 'UTC';
const START = '2026-09-28';
const TODAY = '2026-10-01';
const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30'];

const RING_PROV: BioProvenance = {
  channel: 'ble:jstyle2301', recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-10-01T06:00:00.000Z',
  device: { type: 'ring', model: 'J-Style 2301', tier: 'C' },
};
const APPLE_PROV: BioProvenance = {
  channel: 'file:apple_health', recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-10-01T06:00:00.000Z',
  source_app: 'Health', device: { type: 'watch', tier: 'B' },
};
/** The ring service's key for one ring (`ble:<family>/<model>/<ringId>`; synthetic id). */
const RING = 'ble:jstyle2301/2301/serial:TEST0001';
const APPLE = sourceKeyOf(APPLE_PROV);

const sharingOff = (): StreamPolicy[] => POLICY_STREAMS.map((s) => ringSharingOffPolicy(s));
const engineOffFor = (streams: readonly PolicyStream[]): StreamPolicy[] =>
  ringDefaultPolicies().map((p) => (streams.includes(p.stream) ? normalizePolicy({ ...p, engine: false }) : p));

function source(sourceKey: string, label: string, policies: StreamPolicy[]): BioSourceDoc {
  return { sourceKey, label, tier: 'C', priority: 0, policies, baselineEpochs: [] };
}

const quality = { validation: 'measured', confidence: null, flags: [] } as const;

/** Three nights and days of a ring: `asleepH` per night, `steps` per day, an evening ride when `ride`. */
function ringDays(o: { asleepH: number; steps: number; ride: boolean }, prov: BioProvenance = RING_PROV, dates: readonly string[] = DAYS): BioRecord[] {
  const out: BioRecord[] = [];
  for (const d of dates) {
    const wake = `${d}T06:30:00.000Z`;
    const bed = new Date(Date.parse(wake) - (o.asleepH + 0.5) * 3_600_000).toISOString();
    out.push({ kind: 'sleep', record_id: `s-${d}`, version: 1, time: { start: bed, end: wake, tz_offset_s: 0, local_date: d }, provenance: prov, quality: { ...quality, flags: [] }, is_main: true, asleep_s: o.asleepH * 3600, in_bed_s: (o.asleepH + 0.5) * 3600 } as BioRecord);
    out.push({ kind: 'daily', record_id: `d-${d}`, version: 1, time: { tz_offset_s: 0, local_date: d }, provenance: prov, quality: { ...quality, flags: [] }, steps: o.steps, resting_hr_bpm: 54 } as BioRecord);
    if (o.ride) out.push({ kind: 'workout', record_id: `w-${d}`, version: 1, time: { start: `${d}T17:00:00.000Z`, end: `${d}T17:50:00.000Z`, tz_offset_s: 0, local_date: d }, provenance: prov, quality: { ...quality, flags: [] }, exercise_type: 'cycling', active_duration_s: 3000, active_kcal: 450 } as BioRecord);
  }
  return out;
}

// ------------------------------------------------------------------------------------------- fixture plan

const PERSON: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: START };
const PLAN = {
  id: 'plan-ring', name: 'Ring plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-09-27T10:00:00.000Z' }, status: 'active',
  startDate: START, plannedEndDate: '2026-10-26', request: { profile: PERSON, goals: [], horizonDays: 28 }, baselineProfile: PERSON, headVersion: 1,
  pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-09-27T10:00:00.000Z',
} as unknown as PlanDoc & { id: string };
const DAY_TEMPLATE = {
  id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 2000 },
  macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } },
  steps: 8000, sleep: { bedH: 23, wakeH: 7 },
};
const VERSION = {
  planId: PLAN.id, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
  schedule: { schemaVersion: 1, startDate: START, horizonDays: 28, programs: [DAY_TEMPLATE], days: Array.from({ length: 28 }, () => ({ program: 0 })) },
  genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
  forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
  provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-09-27T10:00:00.000Z',
} as unknown as PlanVersionDoc;
const WEIGH_INS: MeasurementEntry[] = [
  { id: 'w1', date: '2026-09-28', metric: 'weightKg', value: 90, context: 'morningFasted', source: { by: 'user', method: 'typed' } },
  { id: 'w2', date: '2026-09-30', metric: 'weightKg', value: 89.7, context: 'morningFasted', source: { by: 'user', method: 'typed' } },
];

/** The plan over the ring's data: observations through the opt-in matrix, then the projection (replay included). */
function planWith(records: BioRecord[], src: BioSourceDoc) {
  const observations = buildObservations({ records: records.map((record) => ({ sourceKey: src.sourceKey, record })), sources: [src], person: [], results: [], tz: TZ });
  const p = projectLiving({
    docs: { plan: PLAN, versions: [VERSION], dayStatus: [], entries: [], measurements: WEIGH_INS, records: [], observations },
    today: TODAY, tz: TZ, now: '2026-10-01T12:00:00.000Z',
  });
  const past = p.days.filter((d) => d.date < TODAY);
  return {
    observations,
    inputs: past.map((d) => ({ sleep: d.result.loggedDay.inputs.sleep?.hours, steps: d.result.loggedDay.inputs.steps, exercise: d.result.loggedDay.inputs.exercise?.length ?? 0 })),
    items: past.map((d) => d.result.score.items.map((i) => `${i.itemId}:${i.credit}:${i.why}`).join('|')),
    replay: Array.from(p.assimilation?.replay.scaleWakeKg ?? []).slice(0, 4),
    coachPrompts: p.today.coachPrompts,
  };
}

const RESTED = { asleepH: 7.5, steps: 9000, ride: false };
const SHORT = { ...RESTED, asleepH: 5 };
const ACTIVE = { asleepH: 7.5, steps: 12000, ride: true };
const IDLE = { asleepH: 7.5, steps: 2500, ride: false };

describe('ring data reaches the plan by default (item 11)', () => {
  const ring = source(RING, 'J-Style 2301', ringDefaultPolicies());

  it('measured sleep from the ring replaces the plan’s assumption and changes the plan’s output', () => {
    const a = planWith(ringDays(RESTED), ring);
    const b = planWith(ringDays(SHORT), ring);
    expect(a.observations[0]?.sleep).toMatchObject({ hours: 7.5, source: 'J-Style 2301' });
    expect(a.inputs.map((x) => x.sleep)).toEqual([7.5, 7.5, 7.5]);
    expect(b.inputs.map((x) => x.sleep)).toEqual([5, 5, 5]);
    expect(a.items).not.toEqual(b.items);
  });

  it('steps and workouts from the ring change the realised days, the adherence and the engine replay', () => {
    const a = planWith(ringDays(ACTIVE), ring);
    const b = planWith(ringDays(IDLE), ring);
    expect(a.inputs.map((x) => x.steps)).toEqual([12000, 12000, 12000]);
    expect(b.inputs.map((x) => x.steps)).toEqual([2500, 2500, 2500]);
    expect(a.inputs.every((x) => x.exercise === 1)).toBe(true);
    expect(b.inputs.every((x) => x.exercise === 0)).toBe(true);
    expect(a.items).not.toEqual(b.items);
    expect(a.items.join()).toContain('steps (device)');
    expect(a.replay).toHaveLength(4);
    expect(a.replay).not.toEqual(b.replay);
  });

  it('the person sees which source measured what', () => {
    const p = planWith(ringDays(SHORT, RING_PROV, [...DAYS, TODAY]), ring);
    expect(p.coachPrompts).toEqual(expect.arrayContaining(['The plan assumed 8000 steps; J-Style 2301 measured 9000.', 'The plan assumed 8 h of sleep; J-Style 2301 measured 5.']));
  });
});

describe('the master switch and the per-stream plan switch take ring data out of the plan', () => {
  it('master switch off: nothing of the ring reaches the plan (resting HR included)', () => {
    expect(planWith(ringDays(ACTIVE), source(RING, 'J-Style 2301', sharingOff())).observations).toEqual([]);
  });

  for (const [name, policies] of [
    ['master switch off', sharingOff()],
    ['plan switch off for sleep, steps and workouts', engineOffFor(['sleep_sessions', 'steps', 'workouts', 'daily_summary'])],
  ] as const) {
    it(`${name}: a different night or day of activity no longer changes the plan`, () => {
      const ring = source(RING, 'J-Style 2301', [...policies]);
      const sleepA = planWith(ringDays(RESTED), ring);
      const sleepB = planWith(ringDays(SHORT), ring);
      expect(sleepA.observations.some((o) => o.sleep || o.steps || o.workouts)).toBe(false);
      expect(sleepA).toEqual(sleepB);
      const actA = planWith(ringDays(ACTIVE), ring);
      const actB = planWith(ringDays(IDLE), ring);
      expect(actA).toEqual(actB);
      expect(actA.inputs.every((x) => x.steps !== 12000 && x.steps !== 2500)).toBe(true);
    });
  }
});

describe('ring data feeds the scores by default; sharing off withholds them', () => {
  const defs = SCORE_CATALOGUE.filter((d) => d.scoreId === 'sleep.tst');

  async function storeWith(policies: StreamPolicy[]) {
    const s = new InMemoryBioStore();
    await s.putSource(source(RING, 'J-Style 2301', policies));
    for (const r of ringDays(RESTED)) await s.putRecord(r, RING);
    return s;
  }
  const run = (s: InMemoryBioStore) => rescoreHistory(s, { defs, from: DAYS[0]!, to: DAYS.at(-1)!, now: '2026-10-01T07:00:00.000Z', build: 't' });
  const tst = async (s: InMemoryBioStore) => (await s.scores({ scoreId: 'sleep.tst' })).sort((a, b) => a.scope.localDate.localeCompare(b.scope.localDate));

  it('total sleep time runs on the ring’s nights with the ring defaults', async () => {
    const s = await storeWith(ringDefaultPolicies());
    await run(s);
    const r = await tst(s);
    expect(r.map((x) => x.status)).toEqual(['ok', 'ok', 'ok']);
    expect(r[0]!.value).toBe(450);
  });

  it('with sharing off it is withheld, and the next rescore replaces scores computed before', async () => {
    const off = await storeWith(sharingOff());
    await run(off);
    expect((await tst(off)).every((x) => x.status !== 'ok' && x.value === null)).toBe(true);

    const s = await storeWith(ringDefaultPolicies());
    await run(s);
    await s.putSource(source(RING, 'J-Style 2301', sharingOff()));
    await run(s);
    expect((await tst(s)).every((x) => x.status !== 'ok')).toBe(true);
  });

  it('the scores switch of the sleep stream alone does the same', async () => {
    const s = await storeWith(ringDefaultPolicies().map((p) => (p.stream === 'sleep_sessions' ? { ...p, scores: false } : p)));
    await run(s);
    expect((await tst(s)).every((x) => x.status !== 'ok')).toBe(true);
  });
});

describe('imports from other vendors stay opt-in', () => {
  it('an Apple Health import with everything off does not reach the plan or the scores', async () => {
    const apple = source(APPLE, 'Health', defaultPolicies());
    const a = planWith(ringDays(ACTIVE, APPLE_PROV), apple);
    const b = planWith(ringDays(IDLE, APPLE_PROV), apple);
    expect(a.observations).toEqual([]);
    expect(a).toEqual(b);

    const s = new InMemoryBioStore();
    await s.putSource(apple);
    for (const r of ringDays(RESTED, APPLE_PROV)) await s.putRecord(r, APPLE);
    await rescoreHistory(s, { defs: SCORE_CATALOGUE.filter((d) => d.scoreId === 'sleep.tst'), from: DAYS[0]!, to: DAYS.at(-1)!, now: '2026-10-01T07:00:00.000Z', build: 't' });
    expect((await s.scores({ scoreId: 'sleep.tst' })).every((x) => x.status !== 'ok')).toBe(true);
  });
});
