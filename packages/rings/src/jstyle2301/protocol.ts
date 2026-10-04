/**
 * J-Style 2301 `Protocol` for `@vitals/rings`: the proven v0.4.0 state machine (`./legacyProtocol.ts`, byte-exact against the
 * Kotlin tests and run against the owner's ring) behind the library's `Protocol` shape. Tier P.
 */
import type { RingDecodedEvent } from '../../../../src/biometrics/core/ble/types';
import type { IngestResult, Protocol, RingEvent, SleepStage } from '../types';
import { redactOutbound } from './commands';
import { createJStyle2301Protocol, type J2301Options } from './legacyProtocol';
import { plausibleAggregate } from '../plausibility';

export type { J2301State, OpcodeCursor } from './legacyProtocol';
export { decodeCursor, encodeCursor, historyReady, planJ2301Sync, DRIFT_REPORT_S, MAX_PAGES, PACKETS_PER_PAGE, REPLY_MS, SETTLE_MS, SILENCE_MAX_MS, STALL_MS } from './legacyProtocol';

const STAGES: ReadonlySet<string> = new Set<SleepStage>(['unknown', 'awake', 'light', 'deep', 'rem']);

/** The decoder's events are a subset of `RingEvent`; only the sleep stage names need a checked widening. */
export function toRingEvent(e: RingDecodedEvent): RingEvent {
  if (e.type === 'sleepEpochs') return { ...e, stages: e.stages.map((s): SleepStage => (STAGES.has(s) ? (s as SleepStage) : 'unknown')) };
  return e;
}

/** The 0x51 day totals arrive as `vendor daily_*` values at the day's local midnight; one `dailyTotal` per day joins them. */
const DAILY: Record<string, 'steps' | 'distanceM' | 'kcal' | 'activeS'> = { daily_steps: 'steps', daily_distance: 'distanceM', daily_kcal: 'kcal', active_minutes: 'activeS' };

export function toRingEvents(events: RingDecodedEvent[]): RingEvent[] {
  const out = events.map(toRingEvent);
  const days = new Map<number, Extract<RingEvent, { type: 'dailyTotal' }>>();
  for (const e of events) {
    if (e.type !== 'vendor') continue;
    const field = DAILY[e.key];
    if (!field) continue;
    const d = days.get(e.t) ?? { type: 'dailyTotal', localDay: e.t };
    d[field] = field === 'activeS' ? e.value * 60 : e.value;
    days.set(e.t, d);
  }
  return [...out, ...days.values()].filter(plausibleAggregate);
}

export function createJ2301Protocol(opts: J2301Options = {}): Protocol {
  const legacy = createJStyle2301Protocol(opts);
  const widen = (r: { events: RingDecodedEvent[]; state: Record<string, unknown>; send?: IngestResult['send']; done?: boolean }): IngestResult => ({
    ...r,
    events: toRingEvents(r.events),
  });
  return {
    initialState: legacy.initialState,
    frame: (cmd) => legacy.frame(cmd).map((bytes) => ({ bytes })),
    ingest: (bytes, state, channel, receivedMs) => widen(legacy.ingest(bytes, state, channel, receivedMs)),
    planSync: (cursor) => legacy.planSync(cursor),
    begin: (cmd, state) => legacy.begin!(cmd, state),
    timeout: (state, kind) => widen(legacy.timeout!(state, kind)),
    redactOutbound,
  };
}
