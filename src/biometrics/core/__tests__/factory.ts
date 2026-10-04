/** Synthetic record factories for tests. */
import type { BioBatch, BioProvenance, DailyRecord, SeriesRecord, SleepRecord } from '../types';

export const NOW = '2026-03-12T08:00:00.000Z';

export function prov(over: Partial<BioProvenance> = {}): BioProvenance {
  return {
    channel: 'file:canonical', recording_method: 'automatic', modality: 'sensed', ingested_at: NOW,
    device: { type: 'ring', manufacturer: 'Acme', model: 'R1', tier: 'B' }, ...over,
  };
}

const quality = { validation: 'measured', confidence: null, flags: [] } as const;

export function daily(id: string, date: string, f: Partial<DailyRecord> = {}, p: BioProvenance = prov(), version = 1): DailyRecord {
  return { kind: 'daily', record_id: id, version, time: { tz_offset_s: 0, local_date: date }, provenance: p, quality: { ...quality, flags: [] }, ...f };
}

export function sleep(id: string, date: string, asleepS: number, isMain: boolean, p: BioProvenance = prov(), start = `${date}T00:00:00.000Z`): SleepRecord {
  return { kind: 'sleep', record_id: id, version: 1, time: { start, tz_offset_s: 0, local_date: date }, provenance: p, quality: { ...quality, flags: [] }, is_main: isMain, asleep_s: asleepS };
}

export function hrSeries(id: string, startIso: string, values: number[], intervalS = 60, p: BioProvenance = prov(), extra: Partial<SeriesRecord> = {}): SeriesRecord {
  return {
    kind: 'series', record_id: id, version: 1, time: { start: startIso, tz_offset_s: 0, local_date: startIso.slice(0, 10) }, provenance: p, quality: { ...quality, flags: [] },
    metric: 'hr', unit: 'bpm', aggregation: 'sample', interval_s: intervalS, sampling: { mode: 'continuous' }, values, ...extra,
  };
}

export function batch(records: BioBatch['records'], tz = 'UTC'): BioBatch {
  return { schema: 'vitals.biometrics/1', producer: { name: 'test', version: '1' }, exported_at: NOW, tz, records };
}
