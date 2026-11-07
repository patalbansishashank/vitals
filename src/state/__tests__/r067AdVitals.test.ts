/**
 * 0.6.7 AD-VITALS, the import side (contract §3):
 *  - `hcSessionOf` reads the real Gauge Health Connect payload ("running_treadmill" + code 57), the legacy integer, the
 *    symbolic name alone and an unknown named type (generic, reviewed), and still drops a record with no type;
 *  - `api.detections` follows every page (`next` and `more`), drops malformed episodes alone, keeps the newest revision
 *    and treats withdrawn ones as withdrawn;
 *  - `activityInput` passes the final episodes (ms instants) and the withdrawn ids to `activity.fromGauge`, reports the
 *    open ones for Today's live line and says the server runs detect/2 (remembered across a failed read).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { ServerError } from '@/net/server';
import { createGaugeApi, type GaugeDetections, type GaugeHc } from '@/net/gauge';
import { resolveActivityAlias } from '@/content/catalogues/activityTypes';
import { detectActivities } from '@/living/sensors/activityDetect';
import { activityInput, detectionsInput, hcSessionOf, readGaugeImportState, runGaugeImport, type ActivityInputReport, type GaugeImportDeps } from '../gaugeImport';
import { liveDetections, setLiveDetections } from '../liveDetections';

// the record as the server holds it (vitals-research/r063/data/lumen-live.db, hc_records), in the shape `/v1/gauge/hc` returns
const REAL = {
  id: 'ExerciseSession:e62df7cb-398c-35a2-9ee1-453bde140990',
  recordType: 'ExerciseSession',
  originPackage: 'com.google.android.apps.fitness',
  originIsDeviceNative: false,
  recordingMethod: 'activelyRecorded',
  lastModified: '2025-12-23T03:09:02.037Z',
  start: '2025-12-23T02:49:20.991Z',
  end: '2025-12-23T03:08:12.643Z',
  zoneOffsets: { start: 330, end: 330 },
  payload: { exercise_type: 'running_treadmill', exercise_type_code: 57, title: 'Morning treadmill walk', segments: [], laps: [], route_state: 'none' },
};

describe('hcSessionOf: Gauge Health Connect sessions are no longer dropped', () => {
  it('the real payload (symbolic name + code 57) maps to code 57', () => {
    expect(hcSessionOf(REAL)).toMatchObject({ id: REAL.id, exerciseType: 57, originPackage: 'com.google.android.apps.fitness', title: 'Morning treadmill walk', revision: REAL.lastModified });
  });

  it('every live shape: walking 79, biking_stationary 9, boot_camp 10, HIIT 36', () => {
    for (const [name, code] of [['walking', 79], ['biking_stationary', 9], ['boot_camp', 10], ['high_intensity_interval_training', 36]] as const) {
      expect(hcSessionOf({ ...REAL, payload: { exercise_type: name, exercise_type_code: code } })!.exerciseType).toBe(code);
      // the name alone (no code) resolves through the Health Connect alias table
      expect(hcSessionOf({ ...REAL, payload: { exercise_type: name } })!.exerciseType).toBe(code);
    }
  });

  it('a legacy integer exercise_type still reads; the code wins over a disagreeing name', () => {
    expect(hcSessionOf({ ...REAL, payload: { exercise_type: 79 } })!.exerciseType).toBe(79);
    expect(hcSessionOf({ ...REAL, payload: { exercise_type: 'walking', exercise_type_code: 56 } })!.exerciseType).toBe(56);
    expect(hcSessionOf({ ...REAL, payload: { exercise_type: 'type_123' } })!.exerciseType).toBe(123);
  });

  it('an unknown code or name is a generic session to review, never dropped; no type at all is not a session', () => {
    const unknownCode = hcSessionOf({ ...REAL, payload: { exercise_type: 'mystery', exercise_type_code: 999 } })!;
    expect(unknownCode.exerciseType).toBe(999);
    expect(resolveActivityAlias('hc', 999)).toMatchObject({ exerciseId: 'other_moderate', needsReview: true });
    expect(hcSessionOf({ ...REAL, payload: { exercise_type: 'mystery_sport' } })!.exerciseType).toBe(0);
    expect(hcSessionOf({ ...REAL, payload: { title: 'x' } })).toBeNull();
    expect(hcSessionOf({ ...REAL, payload: { exercise_type: 7.5 } })).toBeNull();
    expect(hcSessionOf({ ...REAL, originPackage: 'com.pulseloop' })).toBeNull();
  });

  it('through the detector: Google Fit\'s treadmill walk (code 57, titled a walk) is a treadmill walk to review', () => {
    const s = hcSessionOf(REAL)!;
    const r = detectActivities({ hcSessions: [s], mintKey: () => 'k' });
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]!.suggested).toMatchObject({ exerciseId: 'treadmill_walk', needsReview: true });
    const run = detectActivities({ hcSessions: [{ ...s, title: 'Evening run' }], mintKey: () => 'k' });
    expect(run.drafts[0]!.suggested.exerciseId).toBe('treadmill_run');
  });

  it('the real payload reaches a candidate through the import and the command', async () => {
    freshState({ cleared: true });
    const hc = { type: 'ExerciseSession', from: '', to: '', records: [REAL] } as unknown as GaugeHc;
    const fake = { workouts: async () => null, hc: async () => hc, timeline: async () => null, baselines: async () => null, status: () => ({ lastOkAt: null, problem: null }) } as unknown as GaugeImportDeps['api'];
    const input = (await activityInput(fake, '2025-12-23', '2025-12-23', '2025-12-23'))!;
    expect(input.hcSessions).toHaveLength(1);
    const r = await dispatch('activity.fromGauge', input, { actor: { kind: 'system', id: 'gauge-import' } });
    await settleCommits();
    expect(r.ok && 'output' in r && (r.output as { created: string[] }).created).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------- api.detections
const BASE = 'https://home.example:8443';
const envelope = (data: unknown) => ({ ok: true, status: 'applied', summary: 'ok', data });
function fakeApi(pages: Array<{ status: number; body?: unknown }>) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    const r = pages.shift() ?? { status: 500 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  const server = {
    isPaired: () => true,
    subscribe: () => () => undefined,
    chatModelOptions: () => {
      if (!fetchImpl) throw new ServerError('not_paired');
      return { serverUrl: `${BASE}/`, deps: { fetch: fetchImpl } };
    },
  };
  return { calls, api: createGaugeApi({ server, now: () => Date.parse('2026-10-28T07:00:00Z'), tz: () => 'Asia/Kolkata' }) };
}
const wire = (o: Record<string, unknown>) => ({ id: 'E1', revision: 1, detector: 'detect/2', config: '1.0.0', start: '2026-10-28T04:00:00Z', end: '2026-10-28T04:24:00Z', moving: [{ start: '2026-10-28T04:00:00Z', end: '2026-10-28T04:24:00Z' }], state: 'final', label: 'walk_possibly_treadmill', alternatives: ['walk'], existence: 0.72, typeScore: 0.45, level: 'medium', reasons: ['phoneSteadyCadence', 'ringFewSteps'], coverage: { phone: 1, ring: 1, hr: 0.4, ar: 0, gps: 0 }, evidenceHash: 'h1', recordingRefs: [], ...o });

describe('api.detections', () => {
  it('follows next and more pages, keeps the newest revision, drops malformed episodes, treats withdrawn as withdrawn', async () => {
    const { api, calls } = fakeApi([
      { status: 200, body: envelope({ episodes: [wire({}), wire({ id: 'BAD', start: 'nope' }), { junk: true }], withdrawn: ['OLD'], cursor: 'c1', next: 'p2', processedThrough: '2026-10-28T04:30:00Z', detector: 'detect/2' }) },
      { status: 200, body: envelope({ episodes: [wire({ revision: 2, end: '2026-10-28T04:30:00Z' }), wire({ id: 'E2', state: 'withdrawn' })], withdrawn: [], cursor: 'c2', more: true }) },
      { status: 200, body: envelope({ episodes: [wire({ id: 'E3', state: 'open', start: '2026-10-28T06:40:00Z', end: '2026-10-28T06:58:00Z', label: 'walk' })], withdrawn: [], cursor: 'c3' }) },
    ]);
    const r = (await api.detections!({ from: '2026-10-27', to: '2026-10-28' }))!;
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatch(/\/v1\/gauge\/detections\?.*from=2026-10-27.*to=2026-10-28/);
    expect(calls[1]).toMatch(/cursor=p2/);
    expect(calls[2]).toMatch(/since=c2/);
    expect(r.truncated).toBe(false);
    expect(r.detector).toBe('detect/2');
    expect(r.cursor).toBe('c3');
    expect(r.withdrawn).toEqual(['E2', 'OLD']);
    expect(r.episodes.map((e) => [e.id, e.revision, e.state])).toEqual([['E1', 2, 'final'], ['E3', 1, 'open']]);
    expect(r.episodes[0]!.end).toBe('2026-10-28T04:30:00.000Z');
  });

  it('null when the server has no such route; truncated when a page does not arrive', async () => {
    expect(await fakeApi([{ status: 404, body: { ok: false } }]).api.detections!({ from: 'a', to: 'b' })).toBeNull();
    const cut = await fakeApi([{ status: 200, body: envelope({ episodes: [wire({})], withdrawn: [], cursor: 'c1', next: 'p2' }) }, { status: 500 }]).api.detections!({ from: 'a', to: 'b' });
    expect(cut).toMatchObject({ truncated: true, episodes: [expect.objectContaining({ id: 'E1' })] });
  });
});

// ------------------------------------------------------------------------------------------- activityInput
const READ: GaugeDetections = {
  episodes: [
    { id: 'F1', revision: 2, detector: 'detect/2', start: '2026-10-28T04:00:00.000Z', end: '2026-10-28T04:24:00.000Z', moving: [], state: 'final', label: 'walk_possibly_treadmill', alternatives: ['walk'], existence: 0.72, typeScore: 0.45, level: 'medium', reasons: ['ringFewSteps'], evidenceHash: 'h' },
    { id: 'O1', revision: 1, detector: 'detect/2', start: '2026-10-28T06:40:00.000Z', end: '2026-10-28T06:58:00.000Z', moving: [], state: 'open', label: 'walk', alternatives: [], existence: 0.5, typeScore: 0.6, level: 'low', reasons: [] },
  ],
  withdrawn: ['GONE'],
  cursor: 'c',
  processedThrough: null,
  detector: 'detect/2',
  truncated: false,
};

describe('activityInput with detections', () => {
  beforeEach(() => setLiveDetections(null));

  const fake = (detections: (() => Promise<GaugeDetections | null>) | null, problem: string | null = null) =>
    ({ workouts: async () => null, hc: async () => null, timeline: async () => null, baselines: async () => null, status: () => ({ lastOkAt: null, problem }), ...(detections ? { detections } : {}) }) as unknown as GaugeImportDeps['api'];

  it('final episodes (ms instants) and withdrawn ids go to the command; open ones are reported for the live line', async () => {
    const report: ActivityInputReport = {};
    const input = (await activityInput(fake(async () => READ), '2026-10-27', '2026-10-28', '2026-10-28', 'UTC', { report }))!;
    expect(input.detections).toEqual([expect.objectContaining({ id: 'F1', revision: 2, state: 'final', start: Date.parse('2026-10-28T04:00:00Z'), end: Date.parse('2026-10-28T04:24:00Z'), label: 'walk_possibly_treadmill', level: 'medium' })]);
    expect(input.withdrawnDetections).toEqual(['GONE']);
    expect(input.serverDetector).toBe('detect/2');
    expect(report.detections).toEqual({ open: [{ id: 'O1', label: 'walk', start: Date.parse('2026-10-28T06:40:00Z'), end: Date.parse('2026-10-28T06:58:00Z') }], detector: 'detect/2' });
    // the input passes the command schema (`truncated` is the import's own flag, never sent: importActivities drops it)
    freshState({ cleared: true });
    const { truncated: _t, ...sent } = input;
    void _t;
    const r = await dispatch('activity.fromGauge', sent, { actor: { kind: 'system', id: 'gauge-import' } });
    await settleCommits();
    expect(r.ok ? null : JSON.stringify(r.error)).toBeNull();
  });

  it('a failed detections read keeps the remembered detect/2 (never both detectors); an older server without the route says none', async () => {
    const failed = (await activityInput(fake(async () => null), '2026-10-28', '2026-10-28', '2026-10-28', 'UTC', { serverDetector: 'detect/2', report: {} }));
    // nothing else answered either: no input at all, which runs nothing
    expect(failed).toBeNull();
    const withHc = { ...fake(async () => null), hc: async () => ({ type: 'ExerciseSession', records: [REAL] }) } as unknown as GaugeImportDeps['api'];
    expect((await activityInput(withHc, '2025-12-23', '2025-12-23', '2025-12-23', 'UTC', { serverDetector: 'detect/2' }))!.serverDetector).toBe('detect/2');
    const old = { ...fake(async () => null, 'not_supported'), hc: async () => ({ type: 'ExerciseSession', records: [REAL] }) } as unknown as GaugeImportDeps['api'];
    const report: ActivityInputReport = {};
    const input = (await activityInput(old, '2025-12-23', '2025-12-23', '2025-12-23', 'UTC', { serverDetector: 'detect/2', report }))!;
    expect(input.serverDetector).toBeUndefined();
    expect(report.detections).toEqual({ open: [], detector: null });
  });

  it('detectionsInput bounds the final episodes to 500', () => {
    const many: GaugeDetections = { ...READ, episodes: Array.from({ length: 520 }, (_, k) => ({ ...READ.episodes[0]!, id: `X${k}` })) };
    expect(detectionsInput(many).final).toHaveLength(500);
  });

  it('the live store keeps the open episodes per identity and clears on null', () => {
    setLiveDetections([{ id: 'O1', label: 'walk', start: 1, end: 2 }]);
    expect(liveDetections()).toEqual([{ id: 'O1', label: 'walk', start: 1, end: 2 }]);
    const same = liveDetections();
    setLiveDetections([{ id: 'O1', label: 'walk', start: 1, end: 2 }]);
    expect(liveDetections()).toEqual(same);
    setLiveDetections(null);
    expect(liveDetections()).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------- the whole run
describe('runGaugeImport with detections', () => {
  function memoryStorage() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  }
  const api = (detections: () => Promise<GaugeDetections | null>, problem: () => string | null = () => null) =>
    ({
      activity: async () => ({ days: [] }),
      sleep: async () => ({ sessions: [] }),
      steps: async () => ({ fusionVersion: 'steps-fuse/1', intervals: [], days: [] }),
      hc: async (type: string) => ({ type, from: '', to: '', records: [], deleted: [], truncated: false }),
      workouts: async () => ({ sessions: [] }),
      timeline: async () => null,
      detections,
      status: () => ({ lastOkAt: null, problem: problem() }),
    }) as unknown as GaugeImportDeps['api'];

  it('the run sets the live line, sends the final episodes and remembers detect/2 through a failed read', async () => {
    setLiveDetections(null);
    const storage = memoryStorage();
    const inputs: Array<Record<string, unknown>> = [];
    const base = { enabled: () => true, today: () => '2026-10-28', tz: () => 'UTC', now: () => Date.parse('2026-10-28T07:00:00Z'), importer: async () => ({ created: [], skipped: [] }), storage, activityImporter: async (i: object) => (inputs.push(i as Record<string, unknown>), { created: [], updated: [] }) };
    await runGaugeImport({ ...base, api: api(async () => READ) });
    expect(liveDetections().map((d) => d.id)).toEqual(['O1']);
    expect(inputs.at(-1)).toMatchObject({ serverDetector: 'detect/2', withdrawnDetections: ['GONE'], detections: [expect.objectContaining({ id: 'F1' })] });
    expect(readGaugeImportState(storage).detector).toBe('detect/2');
    // the next run's read fails: detect/2 stays remembered and still turns detect/1 off; the live line is kept
    await runGaugeImport({ ...base, api: api(async () => null) });
    expect(readGaugeImportState(storage).detector).toBe('detect/2');
    expect(inputs.at(-1)).toMatchObject({ serverDetector: 'detect/2' });
    expect(liveDetections().map((d) => d.id)).toEqual(['O1']);
    // the episode ended: the live line goes
    await runGaugeImport({ ...base, api: api(async () => ({ ...READ, episodes: [READ.episodes[0]!] })) });
    expect(liveDetections()).toEqual([]);
  });
});
