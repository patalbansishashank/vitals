// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BioRecord, DailyRecord, SeriesRecord, SleepRecord, SpotRecord, WorkoutRecord } from '../../core/types';
import { appleHealthImporter, parseHkDevice } from '../appleHealth';
import XML from '../__fixtures__/export.xml?raw';
import { XmlTokenizer, decodeEntities } from '../xmlStream';
import type { XmlHandler } from '../xmlStream';

const enc = new TextEncoder();

/** A Blob whose stream() yields fixed-size slices, so tags and multi-byte characters straddle chunk boundaries. */
function chunkedBlob(bytes: Uint8Array, size: number): Blob {
  const b = new Blob([bytes as BlobPart]);
  Object.defineProperty(b, 'stream', {
    value: () => {
      let i = 0;
      return new ReadableStream<Uint8Array>({
        pull(c) {
          if (i >= bytes.length) return c.close();
          c.enqueue(bytes.slice(i, i + size));
          i += size;
        },
      });
    },
  });
  return b;
}

const ctx = () => ({ tz: 'Europe/Berlin', now: '2026-10-01T00:00:00.000Z', signal: new AbortController().signal, onProgress: () => {} });

async function run(blob: Blob): Promise<{ recs: BioRecord[]; batches: number; progress: number[] }> {
  const recs: BioRecord[] = [];
  const progress: number[] = [];
  let batches = 0;
  for await (const b of appleHealthImporter.run(blob, { ...ctx(), onProgress: (p) => progress.push(p) })) {
    batches++;
    expect(b.schema).toBe('vitals.biometrics/1');
    recs.push(...b.records);
  }
  return { recs, batches, progress };
}

const of = <T extends BioRecord>(recs: BioRecord[], kind: T['kind']): T[] => recs.filter((r) => r.kind === kind) as T[];

describe('xml tokenizer', () => {
  it('decodes entities and handles every chunk split', () => {
    const src = `<?xml version="1.0"?><!DOCTYPE a [<!ELEMENT a (b)*> <!-- x > y -->]><a x="1 &amp; 2 &#65;&#x42;" y='q>r'><b/><b k="v"></b><!-- <c/> --><![CDATA[<d/>]]></a>`;
    for (let step = 1; step < 12; step++) {
      const ev: string[] = [];
      const h: XmlHandler = { open: (n, a, sc) => ev.push(`o:${n}:${JSON.stringify(a)}${sc ? ':sc' : ''}`), close: (n) => ev.push(`c:${n}`) };
      const t = new XmlTokenizer(h);
      for (let i = 0; i < src.length; i += step) t.push(src.slice(i, i + step));
      expect(ev).toEqual(['o:a:{"x":"1 & 2 AB","y":"q>r"}', 'o:b:{}:sc', 'c:b', 'o:b:{"k":"v"}', 'c:b', 'c:a']);
    }
  });
  it('decodeEntities leaves unknown entities', () => {
    expect(decodeEntities('a &amp; &unknown; &#x1F600;')).toBe('a & &unknown; \u{1F600}');
  });
});

describe('device parsing', () => {
  it('tiers: watch B, ring B, else phone C', () => {
    expect(parseHkDevice('<<HKDevice: 0x1, name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch6,2, software:10.0>>', 'x')).toMatchObject({ type: 'watch', tier: 'B', model: 'Watch6,2', firmware: '10.0' });
    expect(parseHkDevice(undefined, 'Oura')).toMatchObject({ type: 'ring', tier: 'B' });
    expect(parseHkDevice(undefined, 'Withings')).toMatchObject({ type: 'phone', tier: 'C' });
  });
});

describe('apple health importer', () => {
  it('maps every type (tiny chunks)', async () => {
    const { recs, progress } = await run(chunkedBlob(enc.encode(XML), 37));
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1]!)).toBe(true);

    const series = of<SeriesRecord>(recs, 'series');
    const byMetric = (m: string): SeriesRecord => series.find((s) => s.metric === m)!;
    expect(byMetric('hr').values).toEqual([61, 67]);
    expect(byMetric('hr').t_offset_s).toEqual([0, 300]);
    expect(byMetric('hr').time).toMatchObject({ tz_offset_s: 7200, local_date: '2026-09-29', start: '2026-09-29T06:00:00.000Z' });
    expect(byMetric('hr').provenance).toMatchObject({ channel: 'file:apple_health', source_app: "Sam's Apple Watch", device: { type: 'watch', tier: 'B' } });
    expect(byMetric('spo2').values).toEqual([97, 95]);
    expect(byMetric('spo2').unit).toBe('%');
    expect(byMetric('resp_rate').values).toEqual([14.5]);
    expect(byMetric('skin_temp').values).toEqual([35.4]);
    expect(byMetric('steps').aggregation).toBe('sum');
    expect(byMetric('steps').values).toEqual([500, 700]);
    expect(byMetric('steps').provenance.device).toMatchObject({ type: 'phone', tier: 'C' });
    expect(byMetric('distance').values).toEqual([400]);
    expect(byMetric('active_kcal').values[0]).toBeCloseTo(10, 6);

    const daily = of<DailyRecord>(recs, 'daily');
    const watch = daily.find((d) => d.provenance.source_app === "Sam's Apple Watch" && d.vo2max === undefined)!;
    expect(watch.resting_hr_bpm).toBe(52);
    expect(watch.hrv).toMatchObject({ metric: 'sdnn', value_ms: 48.5, window: 'spot', n: 1 });
    expect(watch.quality.flags).toContain('apple_sdnn');
    expect(watch.spo2_avg_pct).toBe(96);
    expect(watch.spo2_min_pct).toBe(95);
    expect(watch.hr_min_bpm).toBe(61);
    expect(watch.hr_max_bpm).toBe(67);
    expect(watch.active_kcal).toBe(10);
    expect(watch.skin_temp_c).toBe(35.4);
    const phone = daily.find((d) => d.provenance.source_app === "Sam's iPhone")!;
    expect(phone.steps).toBe(1200);
    expect(phone.distance_m).toBe(400);
    const vo2 = daily.find((d) => d.vo2max)!;
    expect(vo2.vo2max).toEqual({ ml_kg_min: 44.2, method: 'vendor_estimate' });
    expect(vo2.quality.flags).toContain('estimated_vo2');
    expect(vo2.quality.validation).toBe('estimated');

    const spots = of<SpotRecord>(recs, 'spot');
    const sp = (m: string): SpotRecord[] => spots.filter((s) => s.metric === m);
    expect(sp('weight_kg')[0]!.value).toBeCloseTo(80, 2);
    expect(sp('weight_kg')[0]!.provenance.recording_method).toBe('manual');
    expect(sp('weight_kg')[0]!.quality.validation).toBe('self_reported');
    expect(sp('weight_kg')[0]!.provenance.source_app).toBe('Scale & Co');
    expect(sp('body_fat_pct')[0]!.value).toBe(21.5);
    expect(sp('lean_mass_kg')[0]!.value).toBe(62.5);
    expect(sp('waist_cm')[0]!.value).toBe(84);
    expect(sp('bp_sys_mmhg')).toHaveLength(1);
    expect(sp('bp_dia_mmhg')).toHaveLength(1);
    expect(sp('glucose_mg_dl')[0]!.value).toBeCloseTo(90.08, 2);
    expect(sp('body_temp_c')[0]!.value).toBe(36.8);

    const sleeps = of<SleepRecord>(recs, 'sleep');
    expect(sleeps).toHaveLength(2);
    const main = sleeps.find((s) => s.is_main)!;
    expect(sleeps.filter((s) => s.is_main)).toHaveLength(1);
    expect(main.time.local_date).toBe('2026-09-29');
    expect(main.in_bed_s).toBe(7.5 * 3600);
    expect(main.light_s).toBe(2 * 3600);
    expect(main.deep_s).toBe(3600);
    expect(main.rem_s).toBe(2 * 3600);
    expect(main.awake_s).toBe(20 * 60 + 10 * 60 + 10 * 60); // awake + InBed remainder 23:00-23:10 and 06:20-06:30
    expect(main.asleep_s).toBe((2 + 1 + 2) * 3600 + 110 * 60);
    expect(main.waso_s).toBe(20 * 60);
    expect(main.awakenings).toBe(1);
    expect(main.latency_s).toBe(600);
    expect(main.stages!.map((s) => s.stage)).toEqual(['awake_in_bed', 'light', 'deep', 'awake', 'rem', 'asleep_unspecified', 'awake_in_bed']);
    expect(main.provenance.native_id).toMatch(/^[0-9a-f]{32}$/);
    expect(sleeps.find((s) => !s.is_main)!.asleep_s).toBe(1800);

    const wk = of<WorkoutRecord>(recs, 'workout');
    expect(wk).toHaveLength(1);
    expect(wk[0]).toMatchObject({ exercise_type: 'traditional_strength_training', native_type: 'HKWorkoutActivityTypeTraditionalStrengthTraining', active_duration_s: 2730, distance_m: 3200, active_kcal: 320, hr_avg_bpm: 128.5, hr_max_bpm: 165 });
    expect(of(recs, 'daily').length).toBe(daily.length);
  });

  it('is chunk-size independent and idempotent across runs', async () => {
    const a = await run(chunkedBlob(enc.encode(XML), 1000));
    const b = await run(chunkedBlob(enc.encode(XML), 7));
    const c = await run(new Blob([XML]));
    const ids = (r: BioRecord[]): string[] => r.map((x) => `${x.kind}:${x.record_id}@${x.version}`).sort();
    expect(ids(a.recs)).toEqual(ids(b.recs));
    expect(ids(a.recs)).toEqual(ids(c.recs));
    expect(new Set(ids(a.recs)).size).toBe(a.recs.length);
  });

  it('emits bounded batches', async () => {
    const rows = Array.from({ length: 1300 }, (_, i) => `<Record type="HKQuantityTypeIdentifierBodyMass" sourceName="S" unit="kg" startDate="2026-01-01 00:${String(i % 60).padStart(2, '0')}:00 +0000" endDate="2026-01-01 00:00:00 +0000" value="${70 + i}"/>`);
    const { recs, batches } = await run(new Blob([`<HealthData>${rows.join('')}</HealthData>`]));
    expect(recs).toHaveLength(1300);
    expect(batches).toBe(3);
  });

  it('reads export.xml from a stored zip and a deflate zip', async () => {
    const { zipOne } = await import('./zipFixture');
    for (const method of [0, 8] as const) {
      const zip = await zipOne('apple_health_export/export.xml', enc.encode(XML), method);
      const { recs } = await run(zip);
      expect(of<WorkoutRecord>(recs, 'workout')).toHaveLength(1);
      expect(of<SleepRecord>(recs, 'sleep')).toHaveLength(2);
    }
    await expect(run(await (await import('./zipFixture')).zipOne('other.txt', enc.encode('x'), 0))).rejects.toThrow(/export\.xml/);
  });

  it('sniffs', () => {
    expect(appleHealthImporter.accepts.sniff(enc.encode('<?xml version="1.0"?><HealthData locale="en">'))).toBe(true);
    expect(appleHealthImporter.accepts.sniff(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(true);
    expect(appleHealthImporter.accepts.sniff(enc.encode('{"a":1}'))).toBe(false);
  });
});
