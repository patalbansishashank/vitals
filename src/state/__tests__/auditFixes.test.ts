/**
 * Regression tests of the energy-core audit fixes in the device state (impl-audit claude-core F3, F9, F10; codex-core #1,
 * #4, #16). Scenarios from the auditors' scratch tests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { mintWriteToken } from '@/store';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { addDays, DEFAULT_ITEM_WEIGHTS, localToInstant, type LogEntry, type PlanDoc, type PlanVersionDoc } from '@/living';
import { adaptGaugeData, gaugeData, type GaugeApi, type GaugeHc, type GaugeSteps, type GaugeStepsFuseRequest } from '@/net/gauge';
import { createGaugeCommandsController } from '../gaugeCommands';
import { activityInput, fuseActivitiesOf, fusedStepsDays, hcSessionOf, runGaugeImport, type GaugeImportDeps } from '../gaugeImport';
import { loadTodayEnergySteps } from '../livingActivity';
import { getDocumentStore } from '../runtime';

const FIXTURES = join(__dirname, '..', '..', '..', 'packages', 'companion', 'fixtures', 'gauge-v2');
const fixtureData = (name: string) => gaugeData((JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as { envelope: unknown }).envelope)!;

describe('F9: a coalesced hr.measure is watched under the server id', () => {
  it('the second Measure tap resolves with the reading of the command already in force; retry reuses that id', async () => {
    const stored = { id: 'AAAAAAAAAAAAAAAAAAAA', type: 'hr.measure', payload: {}, state: 'delivered', code: null, detail: null, result: null, issuedAt: '', expiresAt: new Date(Date.now() + 60_000).toISOString(), occurredAt: null, deliveredAt: null, attempt: 1, installationId: 'x', updatedAt: '' };
    const watched: string[] = [];
    const sentIds: string[] = [];
    const api = {
      send: async (b: { id: string }) => (sentIds.push(b.id), { ok: true, command: stored, online: true, coalesced: true }),
      watch: async (id: string) => {
        watched.push(id);
        return id === stored.id ? { ok: true, command: { ...stored, state: 'done', result: { bpm: 61 } }, online: true } : { ok: false, problem: 'not_found' };
      },
      state: async () => ({ ok: false, problem: 'not_paired' }),
      list: async () => ({ ok: true, commands: [] }),
    } as never;
    const ctl = createGaugeCommandsController({ api, local: { probe: async () => false, run: async () => ({ kind: 'fallback' }) } });
    const v = await ctl.send('hr.measure', {} as never);
    expect(watched).toEqual([stored.id]);
    expect(v).toMatchObject({ state: 'done', result: { bpm: 61 } });
    await ctl.retry('hr.measure');
    expect(sentIds[1]).toBe(stored.id);
  });
});

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('F3: the import fuses steps with the approved bouts and the D1/D3 settings', () => {
  const day = { date: '2026-10-20', located: 2000, ringDailyTotal: 9000, ringResidual: 7000, phoneDailyTotal: null, headline: 9000, headlinePolicy: 'atLeast' as const, coverage: { ringMin: 600, phoneMin: 0, eitherMin: 600, unknownMin: 840 } };
  function api(o: { fuse?: boolean } = {}) {
    const posted: GaugeStepsFuseRequest[] = [];
    const tzs: Array<string | undefined> = [];
    const steps: GaugeSteps = { fusionVersion: 'steps-fuse/1', intervals: [], days: [day] } as never;
    const a = {
      activity: async (_f: string, _t: string, op?: { tz?: string }) => (tzs.push(op?.tz), { days: [] }),
      sleep: async (_f: string, _t: string, op?: { tz?: string }) => (tzs.push(op?.tz), { sessions: [] }),
      steps: async () => steps,
      ...(o.fuse === false ? {} : { stepsFuse: async (b: GaugeStepsFuseRequest) => (posted.push(b), steps) }),
      status: () => ({ lastOkAt: null, problem: null }),
    } as unknown as GaugeApi;
    return { api: a, posted, tzs };
  }
  const ctx = { activities: [{ start: '2026-10-20T04:00:00.000Z', end: '2026-10-20T04:30:00.000Z', kind: 'nonLocomotor' as const }], preference: { stepsPreference: ['ring', 'phone'], soleSustainedGait: true }, headline: 'located' as const };

  it('posts the bouts and the preference, sends the zone, and honours stepsHeadline "located"', async () => {
    const { api: a, posted, tzs } = api();
    const seen: Array<{ steps: Array<{ date: string; steps: number; fusion?: { headlinePolicy: string } }> }> = [];
    const deps: Partial<GaugeImportDeps> = {
      api: a, enabled: () => true, today: () => '2026-10-20', now: () => Date.parse('2026-10-20T12:00:00Z'), storage: memoryStorage(), tz: () => 'Asia/Kolkata',
      stepsContext: () => ctx,
      importer: async (input) => (seen.push(input as never), { created: [], skipped: [] }),
    };
    const r = await runGaugeImport(deps);
    expect(r.ran).toBe(true);
    expect(posted[0]).toMatchObject({ tz: 'Asia/Kolkata', activities: ctx.activities, preference: ctx.preference });
    expect(tzs).toEqual(['Asia/Kolkata', 'Asia/Kolkata']);
    expect(seen[0]!.steps).toEqual([expect.objectContaining({ date: '2026-10-20', steps: 2000, fusion: expect.objectContaining({ headlinePolicy: 'located' }) })]);
    // "atLeast" keeps the server's headline
    expect(fusedStepsDays({ fusionVersion: 'f', intervals: [], days: [day] } as never, 'Asia/Kolkata', 'atLeast')[0]!.steps).toBe(9000);
  });

  it('the bouts come from the in-force sessions with an interval: gait locomotor, the rest non-locomotor', () => {
    const s = (id: string, ex: string, a: string, b: string, over: Partial<LogEntry> = {}) =>
      ({ id, date: '2026-10-20', tz: 'UTC', kind: 'session', status: 'done', performed: [{ exerciseId: ex }], workout: { exerciseType: ex }, occurrence: { precision: 'interval', interval: { start: a, end: b } }, source: { by: 'device' }, ...over }) as unknown as LogEntry;
    const acts = fuseActivitiesOf([
      s('a', 'walk', '2026-10-20T07:00:00Z', '2026-10-20T07:30:00Z'),
      s('b', 'mudgar_pair', '2026-10-20T08:00:00Z', '2026-10-20T08:20:00Z'),
      s('c', 'walk', '2026-10-20T09:00:00Z', '2026-10-20T09:30:00Z', { status: 'skipped' } as never),
      s('d', 'walk', '2026-10-01T09:00:00Z', '2026-10-01T09:30:00Z', { date: '2026-10-01' } as never),
    ], '2026-10-19', '2026-10-20');
    expect(acts).toEqual([
      { start: '2026-10-20T07:00:00.000Z', end: '2026-10-20T07:30:00.000Z', kind: 'locomotor' },
      { start: '2026-10-20T08:00:00.000Z', end: '2026-10-20T08:20:00.000Z', kind: 'nonLocomotor' },
    ]);
  });

  it('(r063 S10/A15) a paused bout is sent as its moving intervals, each with the bout kind and carry', () => {
    const e = {
      id: 'p', date: '2026-10-20', tz: 'UTC', kind: 'session', status: 'done', performed: [{ exerciseId: 'walk' }], workout: { exerciseType: 'walk' },
      occurrence: { precision: 'interval', interval: { start: '2026-10-20T10:00:00Z', end: '2026-10-20T11:00:00Z' } }, source: { by: 'device' }, carry: 'pocket',
      moving: [{ start: '2026-10-20T10:00:00Z', end: '2026-10-20T10:10:00Z' }, { start: '2026-10-20T10:50:00Z', end: '2026-10-20T11:00:00Z' }],
    } as unknown as LogEntry;
    expect(fuseActivitiesOf([e], '2026-10-20', '2026-10-20')).toEqual([
      { start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T10:10:00.000Z', kind: 'locomotor', carry: 'pocket' },
      { start: '2026-10-20T10:50:00.000Z', end: '2026-10-20T11:00:00.000Z', kind: 'locomotor', carry: 'pocket' },
    ]);
  });

  it('a client without the fuse route reads GET /steps', async () => {
    const { api: a } = api({ fuse: false });
    const seen: unknown[] = [];
    await runGaugeImport({ api: a, enabled: () => true, today: () => '2026-10-20', now: () => 0, storage: memoryStorage(), importer: async (i) => (seen.push(i), { created: [], skipped: [] }) });
    expect((seen[0] as { steps: unknown[] }).steps).toHaveLength(1);
  });
});

describe('Codex #16: a supported zero day is imported', () => {
  it('a covered day with 0 steps is a row; an uncovered 0 is not', () => {
    const d = (eitherMin: number) => ({ fusionVersion: 'f', intervals: [], days: [{ date: '2026-10-18', located: 0, headline: 0, headlinePolicy: 'located', coverage: { ringMin: eitherMin, phoneMin: 0, eitherMin, unknownMin: 1440 - eitherMin } }] }) as never;
    expect(fusedStepsDays(d(600), 'UTC').map((x) => x.steps)).toEqual([0]);
    expect(fusedStepsDays(d(0), 'UTC')).toEqual([]);
  });
});

describe('Codex #1: Health Connect records never break the activity import batch', () => {
  beforeEach(() => {
    freshState({ cleared: true });
  });

  it("S2's record shape (origin, not originPackage) maps, a malformed record is dropped alone, and the batch passes the command schema", async () => {
    const good = { id: 'fit-walk', recordType: 'ExerciseSession', start: '2026-10-20T17:00:00+05:30', end: '2026-10-20T17:40:00+05:30', origin: 'com.google.android.apps.fitness', deviceNative: false, lineage: 'phone', lastModified: null, payload: { exercise_type: 79, title: 'Evening walk' } };
    const bad = [
      { ...good, id: 'no-type', payload: { title: 'x' } },
      { ...good, id: 'frac', payload: { exercise_type: 7.5 } },
      { ...good, id: 'no-end', end: null },
      'junk',
    ];
    const hc = adaptGaugeData('/v1/gauge/hc', { type: 'ExerciseSession', from: '', to: '', records: [good, ...bad] }) as unknown as GaugeHc;
    const workouts = fixtureData('workouts');
    const fake = { workouts: async () => workouts, hc: async () => hc, timeline: async () => null, baselines: async () => null, status: () => ({ lastOkAt: null, problem: null }) } as unknown as GaugeImportDeps['api'];
    const input = (await activityInput(fake, '2026-10-20', '2026-10-20', '2026-10-20'))!;
    expect(input.hcSessions).toEqual([expect.objectContaining({ id: 'fit-walk', originPackage: 'com.google.android.apps.fitness', exerciseType: 79, title: 'Evening walk' })]);
    expect(input.hcSessions[0]!.revision).toMatch(/\|/);
    expect(input.gaugeSessions.length).toBeGreaterThan(0);
    const r = await dispatch('activity.fromGauge', input, { actor: { kind: 'system', id: 'gauge-import' } });
    await settleCommits();
    expect(r.ok).toBe(true);
    expect(hcSessionOf({ ...good, origin: 'com.pulseloop' })).toBeNull();
  });
});

describe("Codex #4: today's engine hours are civil clock hours", () => {
  beforeEach(() => {
    freshState({ cleared: true });
  });

  it('hour 0 of the run is local midnight of today, not the app day rollover start', async () => {
    const store = getDocumentStore();
    await store.ready;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const { currentDay } = await import('@/commands');
    const today = currentDay();
    const startDate = addDays(today, -3);
    const profile = { schemaVersion: 1 as const, body: { sex: 'female' as const, ageYears: 35, heightCm: 165, weightKg: 62 }, startDate };
    const prog = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 1900 }, macros: { protein: { unit: 'g' as const, value: 120 }, carbs: { unit: 'g' as const, value: 180 }, fat: { unit: 'remainder' as const } }, steps: 9000, sleep: { bedH: 23, wakeH: 7 } };
    const id = '01JABCDEFGHJKMNPQRSTVWXY66';
    const plan: PlanDoc = { name: 'P', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${startDate}T06:00:00.000Z` }, status: 'active', startDate, plannedEndDate: addDays(startDate, 14), request: { profile, goals: [], horizonDays: 14 }, baselineProfile: profile, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: `${startDate}T06:00:00.000Z` };
    const version: PlanVersionDoc = { planId: id, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: { schemaVersion: 1, startDate, horizonDays: 14, programs: [prog], days: Array.from({ length: 14 }, () => ({ program: 0 })) }, genome: null, sessions: {}, sensitivities: { planVersion: 'v', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} }, forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [], provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${startDate}T06:00:00.000Z` };
    await store.transact(mintWriteToken('migration', { label: 'seed' }), async (tx) => {
      await tx.put('plans', { ...plan, _id: id });
      await tx.append('planVersions', { ...version, _id: `${id}:v1` });
      await tx.put('activePlan', { _id: 'me', planId: id, since: startDate });
    });
    const starts: number[] = [];
    await loadTodayEnergySteps({ runHours: async (_k, _p, _s, _i, dayStartMs) => (starts.push(dayStartMs), null) });
    expect(starts.length).toBeGreaterThan(0);
    for (const s of starts) expect(s).toBe(Date.parse(localToInstant(today, 0, tz)));
  });
});
