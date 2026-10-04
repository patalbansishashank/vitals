/**
 * One ring = one source (SUITE_SPEC §15.2): `biometrics.ringFold`, a system-actor command the app runs at boot and after
 * a ring is paired. It moves, without duplicating a record or a sample:
 *   - a `ble:` source from an earlier build whose key is neither a §15.2 ring key nor its driver's canonical legacy key
 *     (the key came from what the ring advertised) into the ring's canonical source;
 *   - a Lumen source under a key other than `LUMEN_SOURCE_KEY` (a pre-R20 key that depended on the device model Lumen
 *     reported) into `LUMEN_SOURCE_KEY`;
 *   - when the person has exactly one J-Style 2301 ring source, the Lumen source into that ring source; from then on
 *     new Lumen data is filed under the ring key through `bioSources/ringFold:me` `{ lumen: <ringKey> }`, which the
 *     ingest pipeline reads. Two or more such rings: no fold (ambiguous), Lumen stays its own source.
 * Every case is detected by key structure, never by a name. Records are re-provenanced (channel = target key, maker and
 * model from the family table) and re-put under the target, chunk samples merge into the target's chunks as stored, both
 * de-duplicated (by record id and version, by sample); then the old source goes the way `bio.deleteSource` removes one.
 * Data under a key that has lost its source document moves too. Idempotent: an interrupted run finishes on the next.
 * Loaded lazily by `./index.ts`.
 */
import { channelOfSourceKey, isRingSource, RING_FOLD_ID, ringFoldOf, ringStartPolicies, ringStartPolicy, type RingFold } from '@/biometrics/core/policy';
import { LUMEN_DEVICE_MODEL, LUMEN_SOURCE_KEY, newSourceDoc, policyOf, policyStreamOf, sourceKeyOf, suggestedPolicies } from '@/biometrics/core/source';
import type { BioChannel, BioProvenance, BioRecord, BioStream, LocalDate, PolicyStream, RawSample } from '@/biometrics/core/types';
import { tzOffsetSeconds } from '@/biometrics/importers/util';
import { familyIdentity, knownRingLabel, macOf, parseRingKey, ringKeyFromId, type FamilyIdentity } from '@/biometrics/service/identity';
import type { BioDocIndex, SourceBody } from '@/biometrics/store/docIndex';
import { fail } from '../registry';
import type { CommandContext } from '../types';
import { scoreSource } from './exec';
import { scheduleRescore } from './runtime';
import { changedByPerson, storedRingChoice } from './sharing';
import { bioIndex, commandWriter, deriveWriter, openBioStore } from './store';

export { RING_FOLD_ID };

const LUMEN_CHANNELS = new Set(['file:lumen_cloudevents', 'file:lumen_archive', 'mqtt:lumen']);
const JSTYLE = familyIdentity('jstyle2301');

/** The driver's canonical pre-v0.5.0 key, `ble:<driver>|<maker>:<model>`. */
function legacyKeyOf(driver: string, fam: FamilyIdentity): string {
  return sourceKeyOf({ channel: `ble:${driver}` as BioChannel, device: { type: 'ring', manufacturer: fam.maker, model: fam.model, tier: 'C' }, recording_method: 'automatic', modality: 'sensed', ingested_at: '' });
}

/** §15.2 ring sources of a family and model. */
function ringsOf(sources: readonly SourceBody[], fam: FamilyIdentity): SourceBody[] {
  return sources.filter((s) => {
    const p = parseRingKey(s.sourceKey);
    return !!p && !p.legacy && p.family === fam.family && (p.model ?? fam.model) === fam.model;
  });
}

interface Move {
  from: string;
  to: string;
  fam: FamilyIdentity;
}

/** A `ble:` source keyed from what the ring advertised (neither a ring key nor its driver's canonical legacy key). */
function strayRing(src: SourceBody, sources: readonly SourceBody[]): Move | undefined {
  const p = parseRingKey(src.sourceKey);
  if (!p?.legacy) return undefined;
  const driver = src.ble?.driver ?? p.family;
  if (!knownRingLabel(driver)) return undefined;
  const fam = familyIdentity(driver);
  if (src.sourceKey === legacyKeyOf(driver, fam)) return undefined;
  const rings = ringsOf(sources, fam);
  const mac = macOf(src.ble?.address);
  const to = rings.length === 1 ? rings[0]!.sourceKey : src.ble?.ringId ? ringKeyFromId(driver, src.ble.ringId, fam.model) : mac ? ringKeyFromId(driver, `mac:${mac}`, fam.model) : legacyKeyOf(driver, fam);
  return { from: src.sourceKey, to, fam };
}

/** A Lumen source under a key other than the one Lumen key. */
function strayLumen(src: Pick<SourceBody, 'sourceKey'>): boolean {
  return LUMEN_CHANNELS.has(channelOfSourceKey(src.sourceKey)) && src.sourceKey !== LUMEN_SOURCE_KEY;
}

/** The fold Lumen data gets: the one J-Style 2301 ring source, or none (no ring, or two or more). */
export function lumenFoldOf(sources: readonly SourceBody[]): { lumen?: string; ambiguous: boolean } {
  const rings = ringsOf(sources, JSTYLE);
  if (rings.length === 1) return { lumen: rings[0]!.sourceKey, ambiguous: false };
  return { ambiguous: rings.length > 1 };
}

/** The stored fold the pipeline files new Lumen data by. */
export function storedRingFold(ix: BioDocIndex): RingFold | undefined {
  return ringFoldOf(ix.sourceDocs.get(RING_FOLD_ID));
}

/** Provenance that `sourceKeyOf` files under `to`: a ring key is its own channel; a legacy key or the Lumen key is built
 * from the channel and the maker and model it names. */
function reprovenance(p: BioProvenance, to: string, fam: FamilyIdentity): BioProvenance {
  const tier = p.device?.tier ?? 'C';
  if (to === LUMEN_SOURCE_KEY) return { ...p, channel: 'file:lumen_cloudevents', device: { ...(p.device ?? {}), type: 'ring', manufacturer: '', model: LUMEN_DEVICE_MODEL, tier } };
  const channel = (to.includes('/') ? to : channelOfSourceKey(to)) as BioChannel;
  return { ...p, channel, device: { ...(p.device ?? {}), type: 'ring', manufacturer: fam.maker, model: fam.model, tier } };
}

/** Records per flush: a transaction always carries whole remove-and-put pairs, so an interruption loses nothing. */
const MOVE_BATCH = 100;

/** The origin a moved sample keeps. Under a ring key `import` does not exist: the ring's own history reads and the
 * server's folded Lumen path store the same minutes as `history`, so the overlap merges instead of doubling. */
function movedOrigin(origin: RawSample['origin'], to: string): RawSample['origin'] {
  return origin === 'import' && to.startsWith('ble:') ? 'history' : origin;
}

/**
 * Everything of `from` into `to`, then `from` and its stale scores removed. A record document is one per record id and
 * version, shared by every source that read it, and immutable, so each old document is removed and re-put with the
 * target's provenance as two adjacent ops of one transaction (`moveRecordDoc`: by document, never by record id, and
 * every version is kept whatever other versions exist). Chunk samples go through `putSamples` as stored (origin, time, value, quality), where they
 * merge sample by sample into the target's chunks; nothing is re-validated, so no sample is dropped on the way. Each
 * step is idempotent: an interrupted run finishes on the next.
 */
async function moveSource(ctx: CommandContext, m: Move): Promise<{ records: number; samples: number; partial?: boolean }> {
  const ix = await bioIndex();
  const src = ix.source(m.from);
  const old = [...ix.recDocs.values()].filter((e) => e.sourceKey === m.from);
  const store = await openBioStore({ writer: deriveWriter(undefined, 'ring fold'), batchSize: MOVE_BATCH * 4 });
  const seen = new Map<string, { prov: BioProvenance; streams: Set<PolicyStream>; dates: Set<LocalDate> }>();
  const note = (prov: BioProvenance, stream: PolicyStream, date: LocalDate): void => {
    let e = seen.get(m.to);
    if (!e) seen.set(m.to, (e = { prov, streams: new Set(), dates: new Set() }));
    e.streams.add(stream);
    e.dates.add(date);
  };
  // records: every stored version is rewritten under the target (no version check: a lower version must not go because
  // a higher one exists under either source; readers pick the highest), MOVE_BATCH at a time
  for (let i = 0; i < old.length; i += MOVE_BATCH) {
    for (const e of old.slice(i, i + MOVE_BATCH)) {
      const rec: BioRecord = { ...e.record, provenance: reprovenance(e.record.provenance, m.to, m.fam) };
      if (await store.moveRecordDoc(rec, m.to)) note(rec.provenance, policyStreamOf(rec), rec.time.local_date);
    }
    await store.flush();
  }
  // chunk samples, one (stream, day) at a time
  const days = new Map<string, { stream: BioStream; date: LocalDate }>();
  for (const c of ix.chunks.values()) if (c.sourceKey === m.from && !c.superseded) days.set(`${c.stream}\u0000${c.local_date}`, { stream: c.stream, date: c.local_date });
  const tier = src?.tier ?? 'C';
  let samples = 0;
  // a chunk whose bytes are on neither this device nor the relay yet cannot be moved: the old source then stays this run
  // (its manifests and document are kept) and the next boot finishes the move
  let partial = false;
  for (const { stream, date } of days.values()) {
    const read = await store.readSamples({ sourceKey: m.from, stream, from: date, to: date });
    if (read.partial) partial = true;
    const got = read.samples;
    if (got.length === 0) continue;
    const manifest = [...ix.chunks.values()].find((c) => c.sourceKey === m.from && c.stream === stream && c.local_date === date && !c.superseded);
    const moved: RawSample[] = got.map((s) => ({ t: s.t, value: s.value, origin: movedOrigin(s.origin, m.to), ...(s.quality ? { quality: s.quality } : {}) }));
    const r = await store.putSamples({ sourceKey: m.to, stream, local_date: date }, moved, { tz_offset_s: tzOffsetSeconds(got[0]!.t, ctx.tz), ...(manifest?.decoder ? { decoder: manifest.decoder } : {}), createdAt: ctx.now });
    samples += r.added;
    if (r.added > 0) note(reprovenance({ channel: m.to as BioChannel, recording_method: 'automatic', modality: 'sensed', ingested_at: ctx.now, device: { type: 'ring', tier } }, m.to, m.fam), stream, date);
    await store.flush();
  }
  // the target source: created from the old one when it does not exist yet (as the pipeline would, from the first
  // record); a stream new to it starts as the pipeline starts one
  const choice = storedRingChoice(ix);
  const target = await store.getSource(m.to);
  const e = seen.get(m.to);
  if (!target) {
    const streams = [...(e?.streams ?? [])];
    const policies = src?.policies ?? (e ? newSourceDoc(e.prov, 0, streams, choice).policies : ringStartPolicies(choice));
    await store.putSource({ sourceKey: m.to, label: m.fam.label, tier, policies, baselineEpochs: src?.baselineEpochs ?? (e ? [[...e.dates].sort()[0]!] : []) });
    if (src?.ble) await store.patchSource(m.to, { ble: src.ble });
  } else if (e) {
    const missing = [...e.streams].filter((s) => !policyOf(target.policies, s));
    const add = isRingSource(target) ? missing.map((s) => ringStartPolicy(s, choice)) : suggestedPolicies(missing);
    if (missing.length > 0) await store.putSource({ ...target, policies: [...target.policies, ...add] });
  }
  await store.flush();
  if (partial) return { records: old.length, samples, partial: true };
  // the old source's chunks and the scores it fed, as bio.deleteSource removes them
  await store.dropChunks(m.from);
  await store.flush();
  const left = new Set((await bioIndex()).dates());
  const stale: string[] = [];
  for (const [id, r] of ix.scoreDocs) if (!left.has(r.scope.localDate) || scoreSource(ix, r) === m.from) stale.push(id);
  await store.removeScores(stale);
  await store.flush();
  if (src) {
    const own = await openBioStore({ writer: commandWriter(ctx.docs) });
    const ownTarget = await own.getSource(m.to);
    const touched = changedByPerson();
    // the person's own choices on the old source stay with the data when the target has none
    if (ownTarget && touched.has(m.from) && !touched.has(m.to)) await own.putSource({ ...ownTarget, policies: src.policies });
    await own.removeSource(m.from);
    await own.flush();
  }
  const dates = [...old.map((e) => e.record.time.local_date), ...[...days.values()].map((d) => d.date)].sort();
  if (dates.length > 0) scheduleRescore(dates[0]!);
  return { records: old.length, samples };
}

interface RingFoldBody extends RingFold {
  kind: 'ringFold';
  ranAt: string;
  /** How many sources were moved: never their old keys, which may carry an advertised name. */
  moved: number;
}

/** Runs any time; does nothing when every source is where it belongs and the stored fold is current. */
export async function ringFoldMigration(ctx: CommandContext) {
  if (ctx.actor.kind !== 'system') fail('precondition_failed', 'Vitals runs this itself.', { rule: 'system_actor' });
  const ix = await bioIndex();
  const sources = ix.sources();
  const fold = lumenFoldOf(sources);
  const moves: Move[] = [];
  for (const s of sources) {
    const stray = strayRing(s, sources);
    if (stray) moves.push(stray);
    else if (strayLumen(s)) moves.push({ from: s.sourceKey, to: fold.lumen ?? LUMEN_SOURCE_KEY, fam: JSTYLE });
    else if (s.sourceKey === LUMEN_SOURCE_KEY && fold.lumen) moves.push({ from: s.sourceKey, to: fold.lumen, fam: JSTYLE });
  }
  // Lumen data under a key with no source document (the server filed a message under a key another device had just
  // folded, or an older build wrote under an old key): the data moves the same way
  const dataKeys = new Set<string>();
  for (const e of ix.recDocs.values()) dataKeys.add(e.sourceKey);
  for (const c of ix.chunks.values()) if (!c.superseded) dataKeys.add(c.sourceKey);
  for (const key of dataKeys) {
    if (ix.source(key) || moves.some((mv) => mv.from === key)) continue;
    if (strayLumen({ sourceKey: key })) moves.push({ from: key, to: fold.lumen ?? LUMEN_SOURCE_KEY, fam: JSTYLE });
    else if (key === LUMEN_SOURCE_KEY && fold.lumen) moves.push({ from: key, to: fold.lumen, fam: JSTYLE });
  }
  const moved: Array<{ from: string; to: string }> = [];
  for (const m of moves) {
    if (m.from === m.to) continue;
    const r = await moveSource(ctx, m);
    // a move that could not read every chunk is finished on a later run; the old source is still there
    if (!r.partial) moved.push({ from: m.from, to: m.to });
  }
  const stored = storedRingFold(ix);
  const changed = moved.length > 0 || (stored?.lumen ?? null) !== (fold.lumen ?? null);
  if (!changed) return { ran: false, moved, lumen: fold.lumen ?? null, ambiguous: fold.ambiguous };
  const body: RingFoldBody = { kind: 'ringFold', ranAt: ctx.now, moved: moved.length, ...(fold.lumen ? { lumen: fold.lumen } : {}) };
  await ctx.docs.put('bioSources', { ...body, _id: RING_FOLD_ID });
  return { ran: true, moved, lumen: fold.lumen ?? null, ambiguous: fold.ambiguous };
}

