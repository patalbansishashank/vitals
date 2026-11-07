/**
 * The one place the Ring screens get the Gauge client from: `gaugeApi` from `@/net/gauge` (the §2.2 routes and S2's
 * `GaugeV2Api`: steps, timeline, baselines, hc).
 *
 * Tests install their own client with `setGaugeApi`. A development build also serves seeded demo data when the tab sets
 * `window.__VITALS_GAUGE_DEMO__ = true` before the app loads (the screenshot harness does), so the screens can be seen
 * without a paired server; production builds drop that branch.
 */
import { gaugeApi } from '@/net/gauge';
import type { RingApi } from './types';

let override: RingApi | null = null;
const listeners = new Set<() => void>();

declare global {
  interface Window {
    __VITALS_GAUGE_DEMO__?: boolean;
  }
}

/** True in a development tab that asked for the seeded demo. */
export const ringDemo = (): boolean => import.meta.env.DEV && typeof window !== 'undefined' && window.__VITALS_GAUGE_DEMO__ === true;

function demoApi(): RingApi {
  const load = () => import('./fixtures').then((m) => m.demoGaugeApi());
  return {
    status: () => ({ lastOkAt: new Date().toISOString(), problem: null }),
    subscribe: () => () => undefined,
    clearCache: () => undefined,
    availability: () => load().then((a) => a.availability()),
    series: (q) => load().then((a) => a.series(q)),
    daily: (d) => load().then((a) => a.daily(d)),
    sleep: (f, t) => load().then((a) => a.sleep(f, t)),
    activity: (f, t) => load().then((a) => a.activity(f, t)),
    scores: (f, t, k) => load().then((a) => a.scores(f, t, k)),
    device: () => load().then((a) => a.device()),
    shortVideo: (f, t) => load().then((a) => a.shortVideo(f, t)),
    workouts: (f, t) => load().then((a) => a.workouts(f, t)),
    steps: (f, t) => load().then((a) => a.steps!(f, t)),
    timeline: (d) => load().then((a) => a.timeline!(d)),
    baselines: (d) => load().then((a) => a.baselines!(d)),
    hc: (ty, f, t) => load().then((a) => a.hc!(ty, f, t)),
  };
}

const demo = ringDemo() ? demoApi() : null;

/** The client the screens read from. */
export function gauge(): RingApi {
  return override ?? demo ?? gaugeApi;
}

/** Tests: read from this client instead (null restores the real one). Drops every cached answer. */
export function setGaugeApi(api: RingApi | null): void {
  override = api;
  for (const l of listeners) l();
}

/** Called when the client changes (the query cache clears itself). */
export function onGaugeApiChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
