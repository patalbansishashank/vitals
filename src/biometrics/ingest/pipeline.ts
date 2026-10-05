/**
 * The one ingest pipeline every channel feeds (SUITE_SPEC §4.3, tier H):
 * validate -> normalise units -> dedupe -> split series into chunks -> write manifests and records -> upsert sources.
 * Resolving daily views and scheduling rescoring are the caller's next steps; the report carries the dates touched.
 * Series records are never stored as records, only as chunks.
 */
import { seriesToSamples, splitByLocalDayAndStream } from '../core/chunks';
import type { SampleGroup } from '../core/chunks';
import { recordId } from '../core/hash';
import { isRingSource, ringStartPolicy, type RingChoice } from '../core/policy';
import { contentRecordId } from '../core/recordIds';
import { newSourceDoc, policyOf, policyStreamOf, sourceKeyOf, suggestedPolicies } from '../core/source';
import { validateBatch } from '../core/validate';
import type { BioBatch, BioProvenance, BioRecord, BioSourceDoc, DeviceTier, IngestReport, Instant, LocalDate, PolicyStream, RawSample, SampleOrigin, SeriesRecord, StreamPolicy } from '../core/types';
import { localDateOf, tzOffsetSeconds } from '../importers/util';
import type { BioStore } from '../store/types';
import { addDaysIso } from './dates';

/** Report plus the set of local dates whose data changed (for rescoring scheduling). */
export interface IngestOutcome extends IngestReport {
  datesTouched: LocalDate[];
  /** Records rejected as structurally invalid. */
  rejected: number;
  /** Records or streams skipped because their StreamPolicy.imported is off. */
  skipped: number;
}

export interface IngestOpts {
  now: Instant;
  /** When given, only streams whose policy has `imported: true` are stored. One list for every source, or per source key
   * (a source without an entry imports nothing). When omitted everything is imported (the user chose to import the file). */
  policies?: StreamPolicy[] | Record<string, StreamPolicy[]>;
  /** The person's ring master switch (`ringSharing:me`; 'on' when not given): a new ring source, or a stream new to one,
   * starts from it. */
  ringSharing?: RingChoice;
  /** Sources folded into another (SUITE_SPEC §15.2 "one ring = one source"): a record whose provenance would file it
   * under a key here is re-provenanced to the target before anything else (`lumenFold`). */
  fold?: Record<string, FoldTarget>;
}

/** Where a folded source's records go: the ring key, and the maker and model its provenance then names. */
export interface FoldTarget {
  key: string;
  maker: string;
  model: string;
}

/** The record as filed under the target: its provenance names the ring, and its id is the ring key's own content id
 * (`recordIds.ts`), the one the ring's Bluetooth reads give the same night, day or workout. */
function folded(rec: BioRecord, f: FoldTarget): BioRecord {
  const p = rec.provenance;
  return { ...rec, record_id: contentRecordId(rec, f.key), provenance: { ...p, channel: f.key as BioProvenance['channel'], device: { ...(p.device ?? {}), type: 'ring', manufacturer: f.maker, model: f.model, tier: p.device?.tier ?? 'C' } } };
}

/** The batch with every record that falls under a folded source re-provenanced to its target (what `ingestBatches` does
 * first; callers that compare a batch with stored records before ingesting it, like the Lumen main-night recompute,
 * apply it themselves). */
export function foldBatch(batch: BioBatch, fold: Record<string, FoldTarget>): BioBatch {
  return { ...batch, records: batch.records.map((r) => {
    const f = fold[sourceKeyOf(r.provenance)];
    return f ? folded(r, f) : r;
  }) };
}

function originOf(rec: SeriesRecord): SampleOrigin {
  if (rec.sampling.mode === 'spot') return 'spot';
  if (rec.provenance.channel.startsWith('ble:')) {
    if (rec.sampling.mode === 'continuous') return rec.context === 'exercise' ? 'workout_stream' : 'live';
    return 'history';
  }
  return 'import';
}

function policiesFor(opts: IngestOpts, sourceKey: string): StreamPolicy[] | undefined {
  const p = opts.policies;
  if (p === undefined) return undefined;
  return Array.isArray(p) ? p : (p[sourceKey] ?? []);
}

export async function ingestBatches(batches: AsyncIterable<BioBatch> | Iterable<BioBatch>, store: BioStore, opts: IngestOpts): Promise<IngestOutcome> {
  const out: IngestOutcome = { batches: 0, records: 0, samples: 0, chunks: 0, duplicates: 0, sources: [], days: null, warnings: [], datesTouched: [], rejected: 0, skipped: 0 };
  const dates = new Set<LocalDate>();
  const seen = new Map<string, { prov: BioProvenance; streams: Set<PolicyStream>; dates: Set<LocalDate> }>();
  const skippedBy = new Map<string, number>();
  const note = (sk: string, prov: BioProvenance, stream: PolicyStream): void => {
    let e = seen.get(sk);
    if (!e) seen.set(sk, (e = { prov, streams: new Set(), dates: new Set() }));
    e.streams.add(stream);
  };

  for await (const raw of batches) {
    const chk = validateBatch(raw);
    out.warnings.push(...chk.warnings);
    for (const r of chk.rejected) out.warnings.push(r);
    if (!chk.batch) {
      out.rejected += 1;
      continue;
    }
    out.batches++;
    out.rejected += chk.rejected.length;
    const series: Array<{ sourceKey: string; stream: SeriesRecord['metric']; tz_offset_s: number; samples: RawSample[]; decoder?: string; prov: BioProvenance }> = [];

    for (const raw of chk.batch.records) {
      const f = opts.fold?.[sourceKeyOf(raw.provenance)];
      const rec = f ? folded(raw, f) : raw;
      const sourceKey = sourceKeyOf(rec.provenance);
      const stream = policyStreamOf(rec);
      const pols = policiesFor(opts, sourceKey);
      if (pols !== undefined && !policyOf(pols, stream)?.imported) {
        out.skipped++;
        skippedBy.set(stream, (skippedBy.get(stream) ?? 0) + 1);
        continue;
      }
      if (rec.kind === 'series') {
        series.push({ sourceKey, stream: rec.metric, tz_offset_s: rec.time.tz_offset_s, samples: seriesToSamples(rec, originOf(rec)), ...(rec.provenance.decoder ? { decoder: rec.provenance.decoder } : {}), prov: rec.provenance });
        continue;
      }
      const res = await store.putRecord(rec, sourceKey);
      if (res === 'inserted') {
        out.records++;
        note(sourceKey, rec.provenance, stream);
        seen.get(sourceKey)!.dates.add(rec.time.local_date);
        dates.add(rec.time.local_date);
      } else out.duplicates++;
    }

    // series -> chunks, grouped per day (and hour when large); one group per decoder to keep manifests honest
    const byDecoder = new Map<string, typeof series>();
    for (const s of series) {
      const k = s.decoder ?? '';
      const a = byDecoder.get(k);
      if (a) a.push(s);
      else byDecoder.set(k, [s]);
    }
    for (const [decoder, items] of byDecoder) {
      const groups: SampleGroup[] = splitByLocalDayAndStream(items);
      for (const g of groups) {
        const prov = items.find((i) => i.sourceKey === g.key.sourceKey)!.prov;
        const r = await store.putSamples(g.key, g.samples, { tz_offset_s: g.tz_offset_s, ...(decoder ? { decoder } : {}), createdAt: opts.now });
        out.duplicates += r.duplicates;
        if (r.added > 0) {
          out.samples += r.added;
          if (r.manifest) out.chunks++;
          dates.add(g.key.local_date);
          note(g.key.sourceKey, prov, g.key.stream);
          seen.get(g.key.sourceKey)!.dates.add(g.key.local_date);
        }
      }
    }
  }

  // sources
  const existing = await store.sources();
  let nextPriority = existing.reduce((m, s) => Math.max(m, s.priority ?? -1), -1) + 1;
  for (const [sk, e] of seen) {
    const doc = await store.getSource(sk);
    if (!doc) {
      const d: BioSourceDoc = newSourceDoc(e.prov, nextPriority++, [...e.streams], opts.ringSharing);
      d.baselineEpochs = [[...e.dates].sort()[0]!];
      await store.putSource(d);
    } else {
      const missing = [...e.streams].filter((s) => !policyOf(doc.policies, s));
      // a stream new to a ring source starts as a new ring source would (the ring defaults, or off with the switch off)
      const add = isRingSource(doc) ? missing.map((s) => ringStartPolicy(s, opts.ringSharing)) : suggestedPolicies(missing);
      if (missing.length > 0) await store.putSource({ ...doc, policies: [...doc.policies, ...add] });
    }
    out.sources.push(sk);
  }
  for (const [stream, n] of skippedBy) out.warnings.push(`skipped ${n} ${stream} record(s): stream not imported`);
  out.datesTouched = [...dates].sort();
  if (out.datesTouched.length > 0) out.days = { from: out.datesTouched[0]!, to: out.datesTouched[out.datesTouched.length - 1]! };
  return out;
}

// ---------------------------------------------------------------- canonical export

const SERIES_DEVICE_TYPE = 'band' as const;

function provenanceFor(sourceKey: string, tier: DeviceTier, now: Instant): BioProvenance {
  const bar = sourceKey.indexOf('|');
  const channel = (bar < 0 ? sourceKey : sourceKey.slice(0, bar)) as BioProvenance['channel'];
  const rest = bar < 0 ? '' : sourceKey.slice(bar + 1);
  const p: BioProvenance = { channel, recording_method: 'automatic', modality: 'sensed', ingested_at: now };
  if (rest.startsWith('app:')) p.source_app = rest.slice(4);
  else if (rest) {
    const c = rest.indexOf(':');
    p.device = { type: SERIES_DEVICE_TYPE, manufacturer: rest.slice(0, c), model: rest.slice(c + 1), tier };
  }
  return p;
}

/** All records plus raw series of a date range as canonical JSONL (one BioRecord per line; series as `series` records with
 * explicit `t_offset_s`). Sample origins are not part of the wire form and come back as 'import' on re-import. `tz` (IANA)
 * decides the local day of each series record; default UTC. */
export async function exportCanonicalJsonl(store: BioStore, range: { from: LocalDate; to: LocalDate }, opts: { tz?: string; now?: Instant } = {}): Promise<string> {
  const tz = opts.tz ?? 'UTC';
  const now = opts.now ?? `${range.to}T00:00:00.000Z`;
  const lines: string[] = [];
  // raw: the records as stored (a stitched night is a view; re-imported it would overwrite its first piece)
  for (const { record } of await store.records({ from: range.from, to: range.to, raw: true })) lines.push(JSON.stringify(record));
  const sources = new Map((await store.sources()).map((s) => [s.sourceKey, s]));
  const manifests = await store.manifests({ from: addDaysIso(range.from, -1), to: addDaysIso(range.to, 1) });
  const streams = [...new Set(manifests.map((m) => m.stream))].sort();
  for (const stream of streams) {
    const samples = await store.samples({ stream, from: addDaysIso(range.from, -1), to: addDaysIso(range.to, 1) });
    const groups = new Map<string, { sourceKey: string; date: LocalDate; samples: typeof samples }>();
    for (const s of samples) {
      const date = localDateOf(s.t, tz);
      if (date < range.from || date > range.to) continue;
      const k = `${s.sourceKey}\u0000${date}`;
      const g = groups.get(k);
      if (g) g.samples.push(s);
      else groups.set(k, { sourceKey: s.sourceKey, date, samples: [s] });
    }
    for (const g of [...groups.values()].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey) || a.date.localeCompare(b.date))) {
      const t0 = g.samples[0]!.t;
      const startIso = new Date(t0).toISOString();
      const tier = sources.get(g.sourceKey)?.tier ?? 'C';
      const hasQ = g.samples.some((s) => s.quality);
      const rec: SeriesRecord = {
        kind: 'series',
        record_id: recordId({ source: g.sourceKey, kind: 'series', metric: stream, start: startIso }),
        version: 1,
        time: { start: startIso, tz_offset_s: tzOffsetSeconds(t0, tz), local_date: g.date },
        provenance: provenanceFor(g.sourceKey, tier, now),
        quality: { validation: 'measured', confidence: null, flags: [] },
        metric: stream,
        unit: UNIT[stream] ?? 'unit',
        aggregation: 'sample',
        sampling: { mode: 'continuous', device_tier: tier },
        t_offset_s: g.samples.map((s) => (s.t - t0) / 1000),
        values: g.samples.map((s) => s.value),
        ...(hasQ ? { quality_mask: g.samples.map((s) => s.quality ?? 0) } : {}),
      };
      lines.push(JSON.stringify(rec));
    }
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

const UNIT: Partial<Record<string, string>> = { hr: 'bpm', ibi: 'ms', hrv: 'ms', spo2: 'pct', skin_temp: 'degC', body_temp: 'degC', resp_rate: 'brpm', steps: 'count', distance: 'm', active_kcal: 'kcal' };
