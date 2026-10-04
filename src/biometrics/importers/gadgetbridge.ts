/**
 * Gadgetbridge database importer (`Gadgetbridge.db` from "Data management -> Export DB", or a JSON table dump of it).
 * Written from the public table/column names only (greenDAO schema, AGPL project: no code reused). Tier C for every
 * device. Layouts and ASSUMED names: docs/biometrics/sqlite-layouts.md.
 */
import { recordId } from '../core/hash';
import type {
  BioBatch, BioProvenance, BioRecord, BioStream, BiometricsImporter, DailyRecord, DeviceType, ImportContext, QualityFlag, SeriesRecord,
  SleepRecord, SleepStageInterval, SleepStageName,
} from '../core/types';
import { idText, num, openInput, rowReader, rows, sniffSqliteFamily, str } from './sqlite';
import type { SqlDatabase, SqlOpener } from './sqlite';
import { batchRecords, isoUtc, localDateOf, makeBatch, tzOffsetSeconds } from './util';

const SOURCE = 'gadgetbridge';

/** Colmi sleep stage codes. ASSUMED from the QRing protocol (1 light, 2 deep, 3 rem, 4 awake); unverified in the DAO. */
export const COLMI_STAGE_NAMES: Record<number, SleepStageName> = { 0: 'unknown', 1: 'light', 2: 'deep', 3: 'rem', 4: 'awake' };

export interface GadgetbridgeOptions {
  openSqlite?: SqlOpener;
  batchSize?: number;
  /** Gap between two stage samples that starts a new sleep session, minutes (PROPOSED 30). */
  sleepGapMin?: number;
}

/** Seconds vs milliseconds: epoch seconds stay below 1e11 until the year 5138. */
export const toMs = (ts: number): number => (ts >= 1e11 ? ts : ts * 1000);

export function createGadgetbridgeImporter(opts: GadgetbridgeOptions = {}): BiometricsImporter {
  return {
    id: 'gadgetbridge',
    label: 'Gadgetbridge database',
    accepts: {
      mime: ['application/vnd.sqlite3', 'application/x-sqlite3', 'application/zip', 'application/json'],
      extensions: ['.db', '.sqlite', '.zip', '.json'],
      sniff: sniffSqliteFamily,
    },
    needs: ['sqljs'],
    async *run(input: Blob, ctx: ImportContext): AsyncIterable<BioBatch> {
      const db = await openInput(input, opts.openSqlite, 'This Gadgetbridge export');
      ctx.onProgress(0.05);
      const records = await mapGadgetbridge(db, ctx, opts.sleepGapMin ?? 30);
      ctx.onProgress(0.9);
      for await (const chunk of batchRecords(records, opts.batchSize ?? 200)) {
        ctx.signal.throwIfAborted();
        yield makeBatch(chunk, { producer: { name: 'vitals/gadgetbridge', version: '1' }, tz: ctx.tz, exportedAt: ctx.now });
      }
      ctx.onProgress(1);
    },
  };
}

interface Dev {
  key: string;
  device: NonNullable<BioProvenance['device']>;
}

/** Pure mapping of an opened Gadgetbridge database (exported for tests). */
export async function mapGadgetbridge(db: SqlDatabase, ctx: Pick<ImportContext, 'tz' | 'now' | 'signal'>, sleepGapMin = 30): Promise<BioRecord[]> {
  const out: BioRecord[] = [];
  const names = await db.tables();

  const devices = new Map<string, Dev>();
  for (const r of await rows(db, 'DEVICE')) {
    const g = rowReader(r);
    const id = idText(g('_id')) ?? idText(g('id'));
    if (!id) continue;
    const name = str(g('name')) ?? '';
    const typeName = str(g('type_name')) ?? '';
    const type: DeviceType = /ring|\br\d{2}\b/i.test(`${name} ${typeName}`) ? 'ring' : 'band';
    const manufacturer = str(g('manufacturer'));
    const model = str(g('model')) ?? (name || undefined);
    devices.set(id, { key: id, device: { type, ...(manufacturer ? { manufacturer } : {}), ...(model ? { model } : {}), tier: 'C' } });
  }
  const devOf = (id: string | undefined): Dev => devices.get(id ?? '') ?? { key: id ?? 'unknown', device: { type: 'band', tier: 'C' } };

  const prov = (d: Dev, decoder: string): BioProvenance => ({
    channel: 'file:gadgetbridge',
    source_app: SOURCE,
    device: d.device,
    recording_method: 'automatic',
    modality: 'sensed',
    ingested_at: ctx.now,
    decoder,
  });

  type Table = Array<{ dev: Dev; ts: number; g: (n: string) => unknown }>;
  const load = async (table: string): Promise<Table> => {
    const res: Table = [];
    for (const r of await rows(db, table)) {
      const g = rowReader(r);
      const ts = num(g('timestamp'));
      if (ts === undefined || ts <= 0) continue;
      res.push({ dev: devOf(idText(g('device_id'))), ts: toMs(ts), g });
    }
    return res;
  };

  // Series: grouped per (device, local date, metric).
  const acc = new Map<string, { dev: Dev; metric: BioStream; unit: string; decoder: string; flags: QualityFlag[]; vendorState?: string; date: string; pts: Map<number, number> }>();
  const addPoint = (dev: Dev, metric: BioStream, unit: string, decoder: string, t: number, v: number, flags: QualityFlag[] = [], vendorState?: string): void => {
    const date = localDateOf(t, ctx.tz);
    const key = `${metric}|${dev.key}|${date}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { dev, metric, unit, decoder, flags, vendorState, date, pts: new Map() }));
    a.pts.set(t, v); // same timestamp from two tables: last write wins, so re-reads are idempotent
  };

  const steps = new Map<string, { dev: Dev; date: string; n: number; steps: number; decoder: string }>();
  const decoderFor = (table: string): string => (table.toUpperCase().startsWith('COLMI_') ? 'gadgetbridge/colmi@1' : 'gadgetbridge/generic_activity@1');

  // Activity samples: every *_ACTIVITY_SAMPLE table (Colmi first-class, others by the generic column pattern).
  for (const table of names.filter((n) => /_ACTIVITY_SAMPLE$/i.test(n))) {
    const cols = (await db.columns(table)).map((c) => c.toLowerCase());
    if (!cols.includes('timestamp')) continue;
    const decoder = decoderFor(table);
    for (const { dev, ts, g } of await load(table)) {
      const hr = num(g('heart_rate'));
      // Gadgetbridge marks "not measured" as 0, 255 or -1; physiologic sanity bound on top.
      if (hr !== undefined && hr >= 20 && hr <= 250) addPoint(dev, 'hr', 'bpm', decoder, ts, hr);
      const st = num(g('steps'));
      if (st !== undefined && st > 0) {
        const date = localDateOf(ts, ctx.tz);
        const k = `${dev.key}|${date}|${decoder}`;
        const cur = steps.get(k) ?? { dev, date, n: 0, steps: 0, decoder };
        cur.steps += st;
        cur.n++;
        steps.set(k, cur);
      }
    }
  }
  for (const { dev, ts, g } of await load('COLMI_HEART_RATE_SAMPLE')) {
    const hr = num(g('heart_rate'));
    if (hr !== undefined && hr >= 20 && hr <= 250) addPoint(dev, 'hr', 'bpm', 'gadgetbridge/colmi@1', ts, hr);
  }
  for (const { dev, ts, g } of await load('COLMI_SPO2_SAMPLE')) {
    const v = num(g('spo2'));
    if (v !== undefined && v >= 50 && v <= 100) addPoint(dev, 'spo2', 'pct', 'gadgetbridge/colmi@1', ts, v);
  }
  for (const { dev, ts, g } of await load('COLMI_STRESS_SAMPLE')) {
    const v = num(g('stress'));
    if (v !== undefined && v > 0 && v <= 100) addPoint(dev, 'vendor:stress', 'vendor_0_100', 'gadgetbridge/colmi@1', ts, v, [], 'vendor_opinion');
  }
  for (const { dev, ts, g } of await load('COLMI_HRV_VALUE_SAMPLE')) {
    const v = num(g('value'));
    if (v !== undefined && v > 0 && v < 500) addPoint(dev, 'hrv', 'ms', 'gadgetbridge/colmi@1', ts, v, ['hrv_vendor_defined']);
  }
  // Column name ASSUMED (TEMPERATURE), degrees C; Gadgetbridge and PulseLoop disagree on which models report it.
  for (const { dev, ts, g } of await load('COLMI_TEMPERATURE_SAMPLE')) {
    const v = num(g('temperature'));
    if (v !== undefined && v > 20 && v < 45) addPoint(dev, 'skin_temp', 'degC', 'gadgetbridge/colmi@1', ts, v);
  }
  ctx.signal.throwIfAborted();

  for (const [key, a] of acc) {
    const ts = [...a.pts.keys()].sort((x, y) => x - y);
    const t0 = ts[0]!;
    const off = tzOffsetSeconds(t0, ctx.tz);
    const s: SeriesRecord = {
      kind: 'series',
      record_id: recordId({ source: SOURCE, nativeId: `series|${key}` }),
      version: ts.length,
      time: { start: isoUtc(t0), end: isoUtc(ts[ts.length - 1]!), tz_offset_s: off, local_date: a.date },
      provenance: prov(a.dev, a.decoder),
      quality: { validation: a.metric.startsWith('vendor:') || a.metric === 'hrv' ? 'vendor_proprietary' : 'measured', confidence: null, flags: a.flags, ...(a.vendorState ? { vendor_state: a.vendorState } : {}) },
      metric: a.metric,
      unit: a.unit,
      aggregation: 'sample',
      sampling: { mode: 'periodic', device_tier: 'C' },
      t_offset_s: ts.map((t) => Math.round((t - t0) / 10) / 100),
      values: ts.map((t) => a.pts.get(t)!),
    };
    out.push(s);
  }

  for (const [key, a] of steps) {
    const d: DailyRecord = {
      kind: 'daily',
      record_id: recordId({ source: SOURCE, nativeId: `daily|${key}` }),
      version: a.n,
      time: { tz_offset_s: tzOffsetSeconds(Date.parse(`${a.date}T12:00:00Z`), ctx.tz), local_date: a.date },
      provenance: prov(a.dev, a.decoder),
      quality: { validation: 'measured', confidence: null, flags: [] },
      steps: a.steps,
    };
    out.push(d);
  }

  // Sleep: contiguous COLMI_SLEEP_STAGE_SAMPLE rows (TIMESTAMP = stage start, DURATION minutes: ASSUMED) form sessions.
  const stages = await load('COLMI_SLEEP_STAGE_SAMPLE');
  const byDev = new Map<string, typeof stages>();
  for (const s of stages) byDev.set(s.dev.key, [...(byDev.get(s.dev.key) ?? []), s]);
  const sleeps: SleepRecord[] = [];
  for (const list of byDev.values()) {
    list.sort((a, b) => a.ts - b.ts);
    let cur: SleepStageInterval[] = [];
    let curEnd = 0;
    const dev = list[0]!.dev;
    const flush = (): void => {
      if (cur.length === 0) return;
      sleeps.push(buildSleep(cur, dev, ctx, prov(dev, 'gadgetbridge/colmi@1')));
      cur = [];
    };
    for (const s of list) {
      const mins = num(s.g('duration'));
      if (mins === undefined || mins <= 0) continue;
      if (cur.length && s.ts - curEnd > sleepGapMin * 60_000) flush();
      const start = Math.max(s.ts, curEnd || s.ts);
      const end = s.ts + mins * 60_000;
      if (end <= start) continue;
      cur.push({ start: isoUtc(start), end: isoUtc(end), stage: COLMI_STAGE_NAMES[num(s.g('stage')) ?? 0] ?? 'unknown' });
      curEnd = end;
    }
    flush();
  }
  const best = new Map<string, SleepRecord>();
  for (const s of sleeps) {
    const k = `${s.provenance.device?.model ?? ''}|${s.time.local_date}`;
    const c = best.get(k);
    if (!c || s.asleep_s > c.asleep_s) best.set(k, s);
  }
  for (const s of best.values()) s.is_main = true;
  out.push(...sleeps);
  return out;
}

function buildSleep(st: SleepStageInterval[], dev: Dev, ctx: Pick<ImportContext, 'tz'>, provenance: BioProvenance): SleepRecord {
  const s0 = Date.parse(st[0]!.start);
  const s1 = Date.parse(st[st.length - 1]!.end);
  const dur: Partial<Record<SleepStageName, number>> = {};
  let first: number | undefined;
  let last: number | undefined;
  for (const x of st) {
    const a = Date.parse(x.start);
    const b = Date.parse(x.end);
    dur[x.stage] = (dur[x.stage] ?? 0) + (b - a) / 1000;
    if (x.stage === 'light' || x.stage === 'deep' || x.stage === 'rem') {
      first ??= a;
      last = b;
    }
  }
  let waso = 0;
  let awakenings = 0;
  for (const x of st) {
    const a = Date.parse(x.start);
    const b = Date.parse(x.end);
    if (x.stage === 'awake' && first !== undefined && last !== undefined && a >= first && b <= last) {
      waso += (b - a) / 1000;
      awakenings++;
    }
  }
  const asleep = (dur.light ?? 0) + (dur.deep ?? 0) + (dur.rem ?? 0);
  const total = (s1 - s0) / 1000;
  const off = tzOffsetSeconds(s1, ctx.tz);
  return {
    kind: 'sleep',
    record_id: recordId({ source: SOURCE, nativeId: `sleep|${dev.key}|${isoUtc(s0)}` }),
    version: st.length,
    time: { start: isoUtc(s0), end: isoUtc(s1), tz_offset_s: off, local_date: localDateOf(s1, ctx.tz) },
    provenance,
    quality: { validation: 'vendor_proprietary', confidence: null, flags: ['provisional_stages'] },
    is_main: false,
    in_bed_s: Math.round(total),
    asleep_s: Math.round(asleep),
    awake_s: Math.round(dur.awake ?? 0),
    light_s: Math.round(dur.light ?? 0),
    deep_s: Math.round(dur.deep ?? 0),
    rem_s: Math.round(dur.rem ?? 0),
    unknown_s: Math.round(dur.unknown ?? 0),
    ...(first !== undefined ? { latency_s: Math.round((first - s0) / 1000) } : {}),
    waso_s: Math.round(waso),
    awakenings,
    efficiency_pct: total > 0 ? Math.round((asleep / total) * 1000) / 10 : 0,
    stages: st,
  };
}
