/**
 * (r087) The import beside the real pulse loop and over the real client (the other import tests use a fake of each).
 *  - The pulse and the import keep the same 30-second gap from the same moment, so the import's waiting word and the
 *    pulse's next refresh can fall due together: the screens must hear one of them, or every question on screen is
 *    asked twice in a row.
 *  - Over the client's per-request views two requests reach the server at a time, and "the server has no detections
 *    route" is read from the detections request itself, whichever of its siblings answers last.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localToInstant } from '@/living/dates';
import { createGaugeApi } from '@/net/gauge';
import type { GaugeCacheStore } from '@/net/gaugeCache';
import { onGaugeDataChanged } from '@/net/gaugeIdentity';
import type { GaugePulseAnswer } from '@/net/gaugePulse';
import { PULSE_REFRESH_GAP_MS, resetGaugeLiveForTests, startGaugePulse } from '../gaugePulse';
import {
  GAUGE_IMPORT_KEY, GAUGE_IMPORT_NOTIFY_MARGIN_MS, GAUGE_IMPORT_PARALLEL_READS,
  readGaugeImportState, resetGaugeImportNotifyForTests, runGaugeImport, type ActivityImportInput, type GaugeImportDeps,
} from '../gaugeImport';

const TZ = 'UTC';
const TODAY = '2026-10-20';
const NOW = Date.parse('2026-10-20T06:34:00Z');
const ALL = { ring: TODAY, sleep: TODAY, steps: TODAY, activities: TODAY };

function memoryStorage(init: unknown) {
  const m = new Map<string, string>([[GAUGE_IMPORT_KEY, JSON.stringify(init)]]);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
/** A filled device that imported half an hour ago; its hourly chunk is not due. */
const backfilled = (over: Record<string, unknown> = {}) => ({ lastImportAt: '2026-10-20T06:00:00.000Z', lastDate: TODAY, backfilled: true, feeds: ALL, reconcile: { next: null, at: '2026-10-20T06:00:00.000Z' }, ...over });

afterEach(() => {
  vi.useRealTimers();
  resetGaugeLiveForTests();
  resetGaugeImportNotifyForTests();
});

describe('beside the pulse', () => {
  /**
   * The first pulse moves the data 1 s in: the screens are told and the import it starts takes 4 s and writes. `second`
   * is how long after that a second pulse moves the data again (null: never). Answers when the screens were told (ms).
   */
  async function toldWith(second: number | null): Promise<number[]> {
    vi.useFakeTimers({ now: NOW });
    const told: number[] = [];
    const off = onGaugeDataChanged(() => told.push(Date.now() - NOW));
    const storage = memoryStorage(backfilled());
    let imports = 0;
    const importer = async () => {
      const first = ++imports === 1;
      await new Promise((resolve) => setTimeout(resolve, 4000));
      // only the first import finds something new
      return { created: first ? [1] : [], skipped: [] };
    };
    const api = {
      activity: async () => ({ days: [] }),
      sleep: async () => ({ sessions: [] }),
      steps: async () => ({ fusionVersion: 'steps-fuse/1', intervals: [], days: [] }),
      status: () => ({ lastOkAt: null, problem: null }),
    } as unknown as GaugeImportDeps['api'];
    const moved = (data: number): GaugePulseAnswer => ({ ok: true, pulse: { token: `t${data}`, boot: 'b', uploads: data, data, lastUploadAt: null, dataAt: null } });
    let call = 0;
    const pulse = (_since: string | null, o: { signal?: AbortSignal }) => new Promise<GaugePulseAnswer>((resolve) => {
      call++;
      // the baseline at once, the first move after 1 s, the second `second` after that; then held until stopped
      if (call === 1) resolve(moved(1));
      else if (call === 2) setTimeout(() => resolve(moved(2)), 1000);
      else if (call === 3 && second !== null) setTimeout(() => resolve(moved(3)), second);
      o.signal?.addEventListener('abort', () => resolve({ ok: false, problem: 'offline' }), { once: true });
    });
    const stop = startGaugePulse({
      pulse, visible: () => true, isPaired: () => true, onPairing: () => () => undefined, now: () => Date.now(),
      readLocal: async () => null, flushLocal: async () => null,
      refresh: async (current) => {
        if (current()) await runGaugeImport({ enabled: () => true, today: () => TODAY, tz: () => TZ, now: () => Date.now(), importer, storage, api }, current);
      },
    });
    try {
      await vi.advanceTimersByTimeAsync(1000 + PULSE_REFRESH_GAP_MS * 3);
      return told;
    } finally {
      stop();
      off();
      // whatever import the stop left running ends before the next case
      await vi.advanceTimersByTimeAsync(60_000);
    }
  }

  it('two pulses inside one gap, the second while the import is running: one word at the end of the gap', async () => {
    expect(await toldWith(2000)).toEqual([1000, 1000 + PULSE_REFRESH_GAP_MS]);
  });

  it('two pulses inside one gap, the second after the import wrote: still one word at the end of the gap', async () => {
    // the import's own word was already waiting for that moment when the pulse's refresh was set for it
    expect(await toldWith(10_000)).toEqual([1000, 1000 + PULSE_REFRESH_GAP_MS]);
  });

  it('one pulse: the import it started tells the screens once the gap is over', async () => {
    expect(await toldWith(null)).toEqual([1000, 1000 + PULSE_REFRESH_GAP_MS + GAUGE_IMPORT_NOTIFY_MARGIN_MS]);
  });
});

describe('over the real client', () => {
  const noStore: GaugeCacheStore = { get: async () => null, put: async () => undefined, clear: async () => undefined, retain: async () => undefined };
  const answer = (data: Record<string, unknown>) => ({ status: 200, body: { ok: true, status: 'applied', summary: 'ok', data } });
  type Route = (url: URL) => { status: number; body?: unknown };
  const routes: Record<string, Route> = {
    activity: () => answer({ days: [] }),
    sleep: () => answer({ sessions: [] }),
    steps: () => answer({ fusionVersion: 'steps-fuse/1', intervals: [], days: [] }),
    'steps/fuse': () => answer({ fusionVersion: 'steps-fuse/1', intervals: [], days: [] }),
    changes: () => answer({ cursor: 'c1.1.0', more: false, changes: [] }),
    hc: () => answer({ records: [], deleted: [] }),
    workouts: () => answer({ sessions: [] }),
    baselines: () => answer({}),
    timeline: (url) => {
      const date = url.searchParams.get('date')!;
      return answer({ date, start: localToInstant(date, 0, TZ), minutes: 2, steps: { selected: [1, 2] }, hr: { bpm: [null, null], supportedS: [null, null] }, sleep: { stage: [null, null] } });
    },
    'fusion-context': () => answer({ revision: 'r1', changed: false }),
  };
  const detections: Route = () => answer({ episodes: [], withdrawn: [], cursor: 'd1', detector: 'detect/2' });

  /** A home server with these routes (any other is a 404), each answer taking a moment so the fan-out can be seen. */
  function server(served: Record<string, Route>) {
    const calls: string[] = [];
    let out = 0;
    let peak = 0;
    const fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const route = url.pathname.replace('/v1/gauge/', '');
      calls.push(route);
      out++;
      peak = Math.max(peak, out);
      await new Promise((resolve) => setTimeout(resolve, 5));
      out--;
      const r = served[route]?.(url) ?? { status: 404, body: { ok: false } };
      return new Response(JSON.stringify(r.body ?? null), { status: r.status });
    }) as typeof globalThis.fetch;
    const client = { isPaired: () => true, subscribe: () => () => undefined, chatModelOptions: () => ({ serverUrl: 'http://home.test/', deps: { fetch } }) };
    return { calls, peak: () => peak, api: createGaugeApi({ server: client as never, now: () => Date.now(), tz: () => TZ, store: noStore }) };
  }
  const deps = (over: Partial<GaugeImportDeps>): Partial<GaugeImportDeps> => ({
    enabled: () => true,
    today: () => TODAY,
    tz: () => TZ,
    now: () => NOW,
    importer: async () => ({ created: [], skipped: [] }),
    activityImporter: async () => ({ created: [], updated: [] }),
    hcWeight: () => true,
    stepsContext: async () => ({ activities: [], preference: {}, headline: 'atLeast' as const }),
    ...over,
  });

  it('two requests reach the server at a time, and the run reads every feed', async () => {
    const s = server({ ...routes, detections });
    const storage = memoryStorage(backfilled());
    expect(await runGaugeImport(deps({ api: s.api, storage }))).toMatchObject({ ran: true, from: '2026-10-18', to: TODAY });
    expect(s.peak()).toBe(GAUGE_IMPORT_PARALLEL_READS);
    expect(new Set(s.calls)).toEqual(new Set(['changes', 'fusion-context', 'activity', 'sleep', 'steps', 'hc', 'detections', 'workouts', 'baselines', 'timeline']));
    expect(readGaugeImportState(storage)).toMatchObject({ feeds: ALL, detector: 'detect/2', lastImportAt: new Date(NOW).toISOString() });
  });

  it('a server that lost its detections route is seen as one, though its other reads answer after that 404', async () => {
    const s = server(routes);
    const storage = memoryStorage(backfilled({ detector: 'detect/2' }));
    const seen: Array<ActivityImportInput['serverDetector']> = [];
    const activityImporter = async (input: ActivityImportInput) => {
      seen.push(input.serverDetector);
      return { created: [], updated: [] };
    };
    expect(await runGaugeImport(deps({ api: s.api, storage, activityImporter }))).toMatchObject({ ran: true });
    // the detections read is the first of its group: the timelines after it answered, and used to hide its 404
    expect(s.calls.indexOf('detections')).toBeLessThan(s.calls.lastIndexOf('timeline'));
    // the local detector is back on: no server detector is passed, and none is kept for the next run
    expect(seen).toEqual([undefined]);
    expect(readGaugeImportState(storage).detector).toBeUndefined();
  });

  it('a server that only failed to answer the detections keeps the detector it advertised', async () => {
    const s = server({ ...routes, detections: () => ({ status: 500, body: { ok: false } }) });
    const storage = memoryStorage(backfilled({ detector: 'detect/2' }));
    const seen: Array<ActivityImportInput['serverDetector']> = [];
    const activityImporter = async (input: ActivityImportInput) => {
      seen.push(input.serverDetector);
      return { created: [], updated: [] };
    };
    expect(await runGaugeImport(deps({ api: s.api, storage, activityImporter }))).toMatchObject({ ran: true });
    expect(seen).toEqual(['detect/2']);
    expect(readGaugeImportState(storage).detector).toBe('detect/2');
  });
});
