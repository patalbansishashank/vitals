// @vitest-environment node
/**
 * The Gauge import (S1): ring steps and main sleep become daily-log entries — idempotent, keyed by day, deterministic ids
 * across devices, the person's own entry always wins, removals stay removed — and the living plan counts them like logs.
 */
import { describe, expect, it } from 'vitest';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { gaugeEntryId, gaugeKey, planGaugeImport, TODAY_STEPS_JUMP, type GaugeImportInput } from '../gaugeImport';
import { isGaugeEntry, projectEntries } from '../logs';
import { toLoggedDay, type LoggedDayInput } from '../loggedDay';
import { freezePrescription, DEFAULT_ITEM_WEIGHTS } from '../prescription';
import { catalogueEquivalence } from '../equivalence';
import { entryProvenance } from '../occurrence';
import type { LogEntry, PlanDoc, PlanVersionDoc } from '../types';

const TZ = 'Asia/Kolkata';
const TODAY = '2026-10-20';
const NOW = '2026-10-20T12:00:00.000Z';

/** Apply a plan like `log.fromGauge` does: append each create under its id. */
function apply(entries: LogEntry[], input: Partial<GaugeImportInput>): { entries: LogEntry[]; plan: ReturnType<typeof planGaugeImport> } {
  const plan = planGaugeImport({ entries, steps: [], sleep: [], tz: TZ, today: TODAY, now: NOW, ...input });
  const next = [...entries];
  for (const c of plan.create) if (!next.some((e) => e.id === c.id)) next.push({ ...c.entry, id: c.id } as LogEntry);
  return { entries: next, plan };
}

const night = (wakingDate: string, start: string, end: string, asleepMinutes: number) => ({ wakingDate, start, end, asleepMinutes });
const user = { by: 'user' as const, method: 'typed' as const };

describe('planGaugeImport', () => {
  it('imports steps and the main night with Gauge provenance (C1), once', () => {
    const { entries, plan } = apply([], {
      steps: [{ date: '2026-10-18', steps: 8214 }, { date: '2026-10-19', steps: 10_050 }],
      sleep: [night('2026-10-19', '2026-10-18T23:10:00+05:30', '2026-10-19T06:52:00+05:30', 412), night('2026-10-19', '2026-10-19T14:00:00+05:30', '2026-10-19T14:40:00+05:30', 35)],
    });
    expect(plan.create.map((c) => c.key)).toEqual([gaugeKey('steps', '2026-10-18'), gaugeKey('steps', '2026-10-19'), gaugeKey('sleep', '2026-10-19')]);
    const steps = entries.find((e) => e.kind === 'steps' && e.date === '2026-10-18') as Extract<LogEntry, { kind: 'steps' }>;
    expect(steps.steps).toBe(8214);
    expect(steps.scope).toBe('totalDay');
    expect(steps.source).toMatchObject({ by: 'device', method: 'biometrics', app: 'gauge', deviceKey: 'gauge:steps:2026-10-18' });
    expect(steps.provenance).toBe('measured');
    expect(steps.occurrence).toMatchObject({ precision: 'dateOnly', date: '2026-10-18', dateMeaning: 'calendarLocal', source: 'device' });
    expect(steps.contract).toBe(1);
    expect(isGaugeEntry(steps)).toBe(true);
    const sleep = entries.find((e) => e.kind === 'sleep') as Extract<LogEntry, { kind: 'sleep' }>;
    // the main episode (the nap is not imported), dated by its wake date, its stages' minutes asleep kept
    expect(sleep).toMatchObject({ date: '2026-10-19', bedAt: '2026-10-18T17:40:00.000Z', wakeAt: '2026-10-19T01:22:00.000Z', asleepMin: 412, episodeKind: 'main', provenance: 'estimated' });
    expect(sleep.occurrence).toMatchObject({ precision: 'interval', dateMeaning: 'wakeDate', source: 'device' });
    expect(sleep.quality).toBeUndefined();
    expect(entryProvenance(sleep)).toBe('estimated');

    // re-running with the same readings writes nothing
    const again = apply(entries, { steps: [{ date: '2026-10-18', steps: 8214 }, { date: '2026-10-19', steps: 10_050 }], sleep: [night('2026-10-19', '2026-10-18T23:10:00+05:30', '2026-10-19T06:52:00+05:30', 412)] });
    expect(again.plan.create).toEqual([]);
    expect(again.plan.skipped.map((s) => s.reason)).toEqual(['unchanged', 'unchanged', 'unchanged']);
  });

  it('backfills 30 days in one run', () => {
    const steps = Array.from({ length: 30 }, (_, k) => ({ date: `2026-${k < 11 ? '09' : '10'}-${String(k < 11 ? 20 + k : k - 10).padStart(2, '0')}`, steps: 5000 + k }));
    const { entries } = apply([], { steps });
    expect(entries.filter((e) => e.kind === 'steps')).toHaveLength(30);
    expect(new Set(entries.map((e) => e.id)).size).toBe(30);
  });

  it('a changed past day supersedes its own entry; the projection counts one', () => {
    const first = apply([], { steps: [{ date: '2026-10-18', steps: 6000 }] }).entries;
    const { entries, plan } = apply(first, { steps: [{ date: '2026-10-18', steps: 9100 }] });
    expect(plan.create[0]!.entry.supersedes).toBe(first[0]!.id);
    const counted = projectEntries(entries).filter((e) => e.kind === 'steps');
    expect(counted).toHaveLength(1);
    expect((counted[0] as Extract<LogEntry, { kind: 'steps' }>).steps).toBe(9100);
  });

  it("rewrites today's climbing steps only after a while or a big jump", () => {
    const first = apply([], { steps: [{ date: TODAY, steps: 2000 }], now: '2026-10-20T04:00:00.000Z' }).entries;
    expect(apply(first, { steps: [{ date: TODAY, steps: 2500 }], now: '2026-10-20T04:30:00.000Z' }).plan.skipped[0]!.reason).toBe('throttled');
    expect(apply(first, { steps: [{ date: TODAY, steps: 2000 + TODAY_STEPS_JUMP }], now: '2026-10-20T04:30:00.000Z' }).plan.create).toHaveLength(1);
    expect(apply(first, { steps: [{ date: TODAY, steps: 2500 }], now: '2026-10-20T06:00:00.000Z' }).plan.create).toHaveLength(1);
  });

  it('supersedes a same-count fusion correction for replay coverage and lineage, even inside today’s count throttle', () => {
    const early = {
      date: TODAY,
      steps: 4000,
      sources: ['ring'],
      fusion: {
        version: 'steps-fuse/1', located: 4000, headlinePolicy: 'located' as const,
        coverage: { ringMin: 240, phoneMin: 0, eitherMin: 240, unknownMin: 1200 },
        spans: [{ start: '2026-10-20T01:30:00.000Z', end: '2026-10-20T05:30:00.000Z' }],
      },
    };
    const first = apply([], { steps: [early], now: '2026-10-20T06:00:00.000Z' });
    const changed = {
      ...early,
      sources: ['ring', 'phone'],
      fusion: {
        ...early.fusion,
        coverage: { ringMin: 200, phoneMin: 80, eitherMin: 250, unknownMin: 1190 },
        spans: [
          { start: '2026-10-20T01:30:00.000Z', end: '2026-10-20T04:30:00.000Z' },
          { start: '2026-10-20T04:40:00.000Z', end: '2026-10-20T05:50:00.000Z' },
        ],
      },
    };
    const next = apply(first.entries, { steps: [changed], now: '2026-10-20T06:30:00.000Z' });
    expect(next.plan.create).toHaveLength(1);
    expect(next.plan.create[0]!.entry.supersedes).toBe(first.entries[0]!.id);
    expect(next.entries).toHaveLength(2); // append-only history
    const projected = projectEntries(next.entries).filter((e): e is Extract<LogEntry, { kind: 'steps' }> => e.kind === 'steps');
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ steps: 4000, source: { sources: ['phone', 'ring'] }, fusion: { coverage: changed.fusion.coverage, spans: changed.fusion.spans } });

    // An upstream revision/hash alone is not a new stored reading; order of the same lineages and spans is immaterial.
    const hashOnly = { ...changed, inputsHash: 'sha256:revision-only', sources: ['phone', 'ring'], fusion: { ...changed.fusion, spans: [...changed.fusion.spans].reverse() } };
    const same = apply(next.entries, { steps: [hashOnly], now: '2026-10-20T06:35:00.000Z' });
    expect(same.plan.create).toEqual([]);
    expect(same.plan.skipped[0]?.reason).toBe('unchanged');

    const manual = { id: 'manual', date: TODAY, tz: TZ, source: user, kind: 'steps', steps: 4000 } as LogEntry;
    expect(apply([...first.entries, manual], { steps: [changed] }).plan).toMatchObject({ create: [], skipped: [{ reason: 'userEntry' }] });
    const removed = { id: 'removed', date: TODAY, tz: TZ, source: user, kind: 'retract', target: first.entries[0]!.id } as LogEntry;
    expect(apply([...first.entries, removed], { steps: [changed] }).plan).toMatchObject({ create: [], skipped: [{ reason: 'removed' }] });
  });

  it("the person's own entry wins: nothing is written for that day", () => {
    const manual = [
      { id: 'u1', date: '2026-10-18', tz: TZ, source: user, kind: 'steps', steps: 7000 },
      { id: 'u2', date: '2026-10-19', tz: TZ, source: user, kind: 'sleep', bedAt: '2026-10-18T17:00:00Z', wakeAt: '2026-10-19T01:00:00Z' },
    ] as LogEntry[];
    const { plan } = apply(manual, { steps: [{ date: '2026-10-18', steps: 8214 }], sleep: [night('2026-10-19', '2026-10-18T23:10:00+05:30', '2026-10-19T06:52:00+05:30', 412)] });
    expect(plan.create).toEqual([]);
    expect(plan.skipped).toEqual([
      { key: 'gauge:steps:2026-10-18', stream: 'steps', reason: 'userEntry', entryId: 'u1' },
      { key: 'gauge:sleep:2026-10-19', stream: 'sleep', reason: 'userEntry', entryId: 'u2' },
    ]);
  });

  it('a manual nap does not hide the ring night', () => {
    const nap = [{ id: 'n1', date: '2026-10-19', tz: TZ, source: user, kind: 'sleep', bedAt: '2026-10-19T08:30:00Z', wakeAt: '2026-10-19T09:00:00Z', episodeKind: 'nap' }] as LogEntry[];
    expect(apply(nap, { sleep: [night('2026-10-19', '2026-10-18T23:10:00+05:30', '2026-10-19T06:52:00+05:30', 412)] }).plan.create).toHaveLength(1);
  });

  it('an entry the person removed is not brought back', () => {
    const first = apply([], { steps: [{ date: '2026-10-18', steps: 8214 }] }).entries;
    const removed = [...first, { id: 'r1', date: '2026-10-18', tz: TZ, source: user, kind: 'retract', target: first[0]!.id } as LogEntry];
    expect(apply(removed, { steps: [{ date: '2026-10-18', steps: 9000 }] }).plan.skipped[0]!.reason).toBe('removed');
  });

  it('skips unknowns and a night still going on', () => {
    const { plan } = apply([], {
      steps: [{ date: '2026-10-18', steps: 0 }, { date: '2026-10-21', steps: 100 }],
      // (r063 S29) its last sync was 03:00 and it is 03:20 now: not over yet (completion is read from the timestamps)
      sleep: [night(TODAY, '2026-10-19T23:30:00+05:30', '2026-10-20T03:00:00+05:30', 180), night('2026-10-18', '2026-10-17T23:00:00+05:30', '2026-10-18T07:00:00+05:30', 0)],
      now: '2026-10-19T21:50:00.000Z',
    });
    expect(plan.create).toEqual([]);
  });

  it('two devices reading the same value write the same document', () => {
    const a = planGaugeImport({ entries: [], steps: [{ date: '2026-10-18', steps: 8214 }], sleep: [], tz: TZ, today: TODAY, now: NOW });
    const b = planGaugeImport({ entries: [], steps: [{ date: '2026-10-18', steps: 8214 }], sleep: [], tz: TZ, today: TODAY, now: '2026-10-20T12:03:00.000Z' });
    expect(a.create[0]!.id).toBe(b.create[0]!.id);
    expect(a.create[0]!.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(gaugeEntryId('2026-10-18', 'x')).not.toBe(gaugeEntryId('2026-10-18', 'y'));
  });
});

describe('projection of Gauge entries', () => {
  const gauge = (id: string, over: Partial<LogEntry>) =>
    ({ id, date: '2026-10-18', tz: TZ, kind: 'steps', steps: 8000, source: { by: 'device', method: 'biometrics', app: 'gauge', deviceKey: 'gauge:steps:2026-10-18' }, ...over }) as LogEntry;

  it('a manual entry for the same day hides the ring value (it stays stored)', () => {
    const entries = [gauge('g1', {}), { id: 'u1', date: '2026-10-18', tz: TZ, source: user, kind: 'steps', steps: 7000 } as LogEntry];
    expect(projectEntries(entries).map((e) => e.id)).toEqual(['u1']);
  });

  it('two devices forking one ring key: the newest reading counts, without a conflict', () => {
    const entries = [gauge('g0', { at: '2026-10-18T10:00:00Z' }), gauge('g1', { steps: 9000, supersedes: 'g0', at: '2026-10-18T12:00:00Z' }), gauge('g2', { steps: 9400, supersedes: 'g0', at: '2026-10-18T12:05:00Z' })];
    const out = projectEntries(entries);
    expect(out.map((e) => e.id)).toEqual(['g2']);
    expect(out[0]!.conflict).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------ the engine's use

const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-10-12' };
const DAY: DayTemplate = {
  id: 'A', label: 'day', energy: { kind: 'kcal', kcal: 2000 }, macros: { protein: { unit: 'g', value: 160 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 9, lengthH: 10 } }, steps: 9000, sleep: { bedH: 23, wakeH: 7 },
};
const SCHED: Schedule = { schemaVersion: 1, startDate: '2026-10-12', horizonDays: 14, programs: [DAY], days: Array.from({ length: 14 }, () => ({ program: 0 })) };
const PLAN: PlanDoc & { id: string } = {
  id: 'p1', name: 'Plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-11T10:00:00.000Z' }, status: 'active', startDate: '2026-10-12', plannedEndDate: '2026-10-26',
  request: { profile: MAN, goals: [], horizonDays: 14 }, baselineProfile: MAN, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-11T10:00:00.000Z',
};
const VERSION: PlanVersionDoc = {
  planId: 'p1', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHED, genome: null, sessions: {},
  sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} }, forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] },
  explanation: [], provenance: { engineVersion: 'x', registryHash: 'y', catalogueVersion: 'z' }, createdBy: { kind: 'system' }, createdAt: '2026-10-11T10:00:00.000Z',
};
const dayInput = (date: string, entries: readonly LogEntry[]): LoggedDayInput => ({
  date, planStart: PLAN.startDate, tz: TZ, prescription: freezePrescription({ plan: PLAN, version: VERSION, date, tz: TZ }), entries: projectEntries(entries).filter((e) => e.date === date),
  expected: () => 0.75, equivalence: catalogueEquivalence, final: true,
});

describe('the living plan reads imported steps and sleep like logs', () => {
  const ring = apply([], {
    steps: [{ date: '2026-10-18', steps: 8100 }],
    sleep: [night('2026-10-18', '2026-10-17T23:00:00+05:30', '2026-10-18T07:00:00+05:30', 420)],
  }).entries;

  it('credits the steps item and labels the ring, with one device-bias group per channel', () => {
    const r = toLoggedDay(dayInput('2026-10-18', ring));
    expect(r.loggedDay.inputs.steps).toBe(8100);
    expect(r.loggedDay.inputs.stepsScope).toBe('totalDay');
    const steps = r.loggedDay.items.find((x) => x.itemId === 'steps')!;
    expect(steps.status).not.toBe('unknown');
    expect(steps.credit).toBeCloseTo(8100 / 9000, 2);
    expect(r.score.items.find((x) => x.itemId === 'steps')?.why).toBe('8100 steps (ring)');
    expect(r.uncertaintyGroups.map((g) => [g.id, g.kind])).toEqual(expect.arrayContaining([['deviceBias:gauge:steps', 'deviceBias'], ['deviceBias:gauge:sleep', 'deviceBias']]));
  });

  it('a ring night counts its minutes asleep, not the time in bed', () => {
    const r = toLoggedDay(dayInput('2026-10-18', ring));
    // 8 h in bed, 7 h asleep
    expect(r.loggedDay.inputs.sleep?.hours).toBeCloseTo(7, 6);
    expect(r.loggedDay.inputs.sleep?.observedTotalHours).toBeCloseTo(7, 6);
    expect(r.loggedDay.inputs.sleep?.wakeH).toBeCloseTo(7, 6);
    expect(r.score.items.find((x) => x.itemId === 'sleep')?.why).toBe('7.0 h asleep (ring)');
  });

  it("the person's own steps and sleep replace the ring's", () => {
    const own = [
      ...ring,
      { id: 'u1', date: '2026-10-18', tz: TZ, source: user, kind: 'steps', steps: 5000 },
      { id: 'u2', date: '2026-10-18', tz: TZ, source: user, kind: 'sleep', bedAt: '2026-10-17T18:00:00Z', wakeAt: '2026-10-18T00:00:00Z' },
    ] as LogEntry[];
    const r = toLoggedDay(dayInput('2026-10-18', own));
    expect(r.loggedDay.inputs.steps).toBe(5000);
    expect(r.loggedDay.inputs.sleep?.hours).toBeCloseTo(6, 6);
    expect(r.score.items.find((x) => x.itemId === 'steps')?.why).toBe('5000 steps');
    expect(r.uncertaintyGroups.some((g) => g.id.startsWith('deviceBias:gauge'))).toBe(false);
  });
});
