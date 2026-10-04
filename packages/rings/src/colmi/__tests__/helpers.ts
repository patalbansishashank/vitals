/**
 * Test helpers for the Colmi fixtures (`qa/fixtures/rings/colmi`): fixture loading, a fake peripheral that also records
 * which characteristic each frame went to, fixture steps → fake steps, and a reverse map from `RingEvent` to the
 * Kotlin event shape the fixtures assert.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakePeripheral, type FakeStep } from '../../testing';
import { fromHex, type RingEvent, type Uuid } from '../../types';
import { COLMI_UUIDS } from '../commands';

const FIX = join(__dirname, '../../../../..', 'qa/fixtures/rings/colmi');
export const fixture = <T,>(f: string): T => JSON.parse(readFileSync(join(FIX, f), 'utf8')) as T;

export interface ColmiStep {
  expectWrite: string;
  channel?: 'command';
  notify?: string[];
  notifyChannel?: 'bigData';
  action?: string;
  afterMs?: number;
  expectEvents?: Array<Record<string, unknown>>;
  expectProgress?: string;
}
export interface ColmiSession {
  name: string;
  clock: { nowMs: number; tzOffsetS: number };
  state?: { measurementSettings: Record<string, number | boolean> | null; profile: Record<string, number | string | boolean> | null };
  expectSeededSettings?: Record<string, number | boolean>;
  steps: ColmiStep[];
}

const sessions = fixture<{ sessions: ColmiSession[] }>('sessions.json').sessions;
export function session(name: string): ColmiSession {
  const s = sessions.find((x) => x.name === name);
  if (!s) throw new Error(`no fixture session ${name}`);
  return s;
}

/** The first history request ends every handshake session in the Kotlin; in the library the sync starts it. */
export const HISTORY_START = '43 00 0f 00 5f 01 00 00 00 00 00 00 00 00 00 b2';
export const handshakeSteps = (name: string): ColmiStep[] => session(name).steps.filter((s) => s.expectWrite !== HISTORY_START);

/** Fixture step → fake step: exact bytes; big-data replies arrive on the V2 notify characteristic. */
export const toFake = (s: ColmiStep): FakeStep => ({
  expect: fromHex(s.expectWrite),
  reply: s.notify ?? [],
  channel: s.notifyChannel === 'bigData' ? COLMI_UUIDS.bigData : undefined,
});

/** A fake ring that also records the service and characteristic of every write. */
export class ColmiFake extends FakePeripheral {
  readonly targets: Array<{ service: Uuid; characteristic: Uuid }> = [];
  override async write(service: Uuid, characteristic: Uuid, bytes: Uint8Array, mode: 'withResponse' | 'withoutResponse'): Promise<void> {
    this.targets.push({ service, characteristic });
    return super.write(service, characteristic, bytes, mode);
  }
}

export const fixedClock = (c: { nowMs: number; tzOffsetS: number }) => ({ now: () => c.nowMs, tzOffsetS: () => c.tzOffsetS });

export async function collect(it: AsyncIterable<RingEvent>): Promise<RingEvent[]> {
  const out: RingEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const STAGE_NAMES: Record<string, string> = { light: 'LIGHT', deep: 'DEEP', rem: 'REM', awake: 'AWAKE', unknown: 'UNKNOWN' };

/** `RingEvent` → the Kotlin event the fixtures name (undefined for housekeeping the Kotlin has no event for). */
export function kotlinOf(e: RingEvent): Record<string, unknown> | undefined {
  switch (e.type) {
    case 'sample':
      if (e.stream === 'hr') return e.origin === 'history' ? { kotlin: 'HistoryMeasurement', kind_field: 'HEART_RATE', value: e.value, t: e.t } : { kotlin: 'HeartRateSample', bpm: e.value, t: e.t };
      if (e.stream === 'spo2') return e.origin === 'history' ? { kotlin: 'HistoryMeasurement', kind_field: 'SPO2', value: e.value, t: e.t } : { kotlin: 'Spo2Result', value: e.value, t: e.t };
      if (e.stream === 'hrv') return { kotlin: 'HistoryMeasurement', kind_field: 'HRV', value: e.value, t: e.t };
      if (e.stream === 'skin_temp') return { kotlin: 'TemperatureSample', celsius: e.value, t: e.t };
      return undefined;
    case 'activityBucket':
      return { kotlin: 'ActivityBucket', steps: e.steps, distanceMeters: e.distanceM, t: e.start };
    case 'sleepEpochs': {
      const runs: Array<{ stage: string; minutes: number }> = [];
      for (const s of e.stages) {
        const name = STAGE_NAMES[s]!;
        const last = runs[runs.length - 1];
        if (last && last.stage === name) last.minutes++;
        else runs.push({ stage: name, minutes: 1 });
      }
      return { kotlin: 'SleepTimeline', stagesRunLength: runs, stageCount: e.stages.length, t: e.start };
    }
    case 'status':
      if (e.key === 'battery') return { kotlin: 'Battery', percent: e.value };
      if (e.key === 'error' && e.value === 'no_reading') return { kotlin: 'HeartRateComplete' };
      return undefined;
    default:
      return undefined;
  }
}

/** Every asserted field of `expected` (Kotlin shape, ISO `_timestamp`) holds in `actual` (from `kotlinOf`). */
export function sameAsKotlin(actual: Record<string, unknown> | undefined, expected: Record<string, unknown>): string | null {
  if (!actual) return `missing ${String(expected.kotlin)}`;
  for (const [k, v] of Object.entries(expected)) {
    if (k === 'kind' || k === 'isHistory') continue;
    if (k === '_timestamp') {
      if (actual.t !== Date.parse(String(v))) return `${String(expected.kotlin)} t ${new Date(Number(actual.t)).toISOString()} != ${String(v)}`;
    } else if (k === '_timestampBefore') {
      if (!(Number(actual.t) < Date.parse(String(v)))) return `${String(expected.kotlin)} t not before ${String(v)}`;
    } else if (typeof v === 'number') {
      if (typeof actual[k] !== 'number' || Math.abs((actual[k] as number) - v) > 1e-9) return `${String(expected.kotlin)}.${k} ${String(actual[k])} != ${v}`;
    } else if (JSON.stringify(actual[k]) !== JSON.stringify(v)) {
      return `${String(expected.kotlin)}.${k} ${JSON.stringify(actual[k])} != ${JSON.stringify(v)}`;
    }
  }
  return null;
}

/** Kotlin-shaped view of the events, housekeeping dropped. */
export const kotlinEvents = (evs: RingEvent[]): Array<Record<string, unknown>> => evs.map(kotlinOf).filter((x): x is Record<string, unknown> => x !== undefined);
