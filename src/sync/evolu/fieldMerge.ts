/**
 * Per-field last-writer-wins for synced documents (SUITE_SPEC §2.3 LWW-F). Pure: no Evolu, no I/O.
 *
 * Evolu resolves the `json` column of a row last-writer-wins, so on its own a whole document is the conflict unit. To
 * resolve per field, the column holds an envelope with one clock per field:
 *
 *   { "v": 2, "fields": { "/name": …, "/weightKg": … }, "clocks": { "/name": HLC, "/weightKg": HLC, "/gone": HLC },
 *     "deleted": false, "deletedClock": HLC }
 *
 * - Field paths are JSON pointers. By default every top-level key is one field (`/key`); a collection may declare
 *   deeper paths (`/state`), whose children then become fields of their own (`/state/units`). A document that is not a
 *   plain object is the single field `""`. Arrays and scalars are always replaced as a whole.
 * - A clock without a field is a removed field (a tombstone), so a removal also wins or loses by its clock.
 * - Clocks are HLC strings `${ms 13}-${counter hex 4}-${device}` (SUITE_SPEC §0.1): string order is clock order, and two
 *   equal times break the tie by device id. Two equal clocks (only possible for rows from before this change) break the
 *   tie by the field's JSON text, so every device picks the same winner.
 * - The envelope lives inside the `json` column, which Evolu encrypts end to end like before.
 *
 * Inside this module a document state keeps every field as its JSON text: comparing and merging texts needs no deep
 * copies, and nothing the caller holds can change a state after the fact.
 */
import { deepEqual, isPlainObject } from '../../store/json';

export type Hlc = string;

export interface FieldState {
  /** Field path → JSON text of the value. */
  texts: Record<string, string>;
  /** Field path → clock of its last change (also for removed fields). */
  clocks: Record<string, Hlc>;
  deleted: boolean;
  deletedClock: Hlc;
}

export const ENVELOPE_VERSION = 2;
export const ROOT = '';

const ptr = (k: string) => `/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`;
const unptr = (p: string) =>
  p
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

/** Clock in the SUITE_SPEC §0.1 HLC format. */
export const MAX_HLC_MS = 9_999_999_999_999;
export const formatHlc = (ms: number, counter: number, device: string): Hlc =>
  `${String(Math.min(MAX_HLC_MS, Math.max(0, Math.floor(Number.isFinite(ms) ? ms : 0)))).padStart(13, '0')}-${Math.min(counter, 0xffff).toString(16).padStart(4, '0')}-${device}`;

function parseHlc(c: Hlc): { ms: number; counter: number } {
  const m = /^(\d{13})-([0-9a-f]{4})-/.exec(c);
  return m ? { ms: Number(m[1]), counter: parseInt(m[2]!, 16) } : { ms: 0, counter: 0 };
}

/** A clock read from storage in the one shape that sorts as a string: ms beyond 13 digits are capped (a clock from the
 * year 3000 would otherwise sort before today's), anything unreadable becomes the lowest clock. */
export function cleanClock(c: unknown): Hlc {
  if (typeof c !== 'string') return '';
  const m = /^(\d+)-([0-9a-f]{1,4})-([\s\S]*)$/.exec(c);
  if (!m) return '';
  return formatHlc(Number(m[1]), parseInt(m[2]!, 16), m[3]!);
}

/** Sets an own property even for the key `__proto__` (a plain assignment would change the prototype instead). */
function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/** Clock given to every field of a document written before per-field clocks existed: its last write time. */
export function legacyClock(updatedIso: string, device: string): Hlc {
  const ms = Date.parse(updatedIso);
  return formatHlc(Number.isFinite(ms) ? ms : 0, 0, device);
}

/**
 * Hybrid logical clock of one device: never goes backwards, and after `observe` it is ahead of every clock this device
 * has seen, so an edit made after reading a remote change always wins over that change.
 */
export function createHlc(device: string, now: () => number = Date.now) {
  let ms = 0;
  let counter = 0;
  return {
    next(): Hlc {
      const t = now();
      if (t > ms) {
        ms = t;
        counter = 0;
      } else if (counter >= 0xffff) {
        ms += 1;
        counter = 0;
      } else counter += 1;
      return formatHlc(ms, counter, device);
    },
    observe(c: Hlc | undefined) {
      if (!c) return;
      const o = parseHlc(c);
      if (o.ms > ms || (o.ms === ms && o.counter > counter)) {
        ms = o.ms;
        counter = o.counter;
      }
    },
  };
}
export type HlcClock = ReturnType<typeof createHlc>;

/** Splits a document value into field path → JSON text. `deep` lists pointers whose children are fields of their own. */
export function flatten(value: unknown, deep: ReadonlySet<string> = EMPTY): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isPlainObject(value)) {
    out[ROOT] = JSON.stringify(value ?? null);
    return out;
  }
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v === undefined || typeof v === 'function') continue;
      const p = prefix + ptr(k);
      if (deep.has(p) && isPlainObject(v) && Object.keys(v).length > 0) walk(v, p);
      else out[p] = JSON.stringify(v);
    }
  };
  walk(value, '');
  return out;
}
const EMPTY: ReadonlySet<string> = new Set();

/** Builds the document value back from its fields (newest first wins where a leaf and its children both exist). */
export function materialize(fields: Record<string, unknown>, clocks: Record<string, Hlc>): unknown {
  const paths = Object.keys(fields);
  if (paths.length === 1 && paths[0] === ROOT) return fields[ROOT];
  let flat = true;
  for (const p of paths) if (p === ROOT || p.indexOf('/', 1) !== -1) flat = false;
  if (flat) {
    const out: Record<string, unknown> = {};
    for (const p of paths) setOwn(out, unptr(p)[0]!, fields[p]);
    return out;
  }
  // Rare: deeper paths or a document that changed between object and non-object. Apply oldest first.
  paths.sort((a, b) => cmp(clocks[a] ?? '', clocks[b] ?? '') || cmp(a, b));
  let root: unknown = {};
  for (const p of paths) {
    if (p === ROOT) {
      root = fields[p];
      continue;
    }
    if (!isPlainObject(root)) root = {};
    const segs = unptr(p);
    let at = root as Record<string, unknown>;
    for (let i = 0; i < segs.length - 1; i++) {
      const next = at[segs[i]!];
      if (!isPlainObject(next)) setOwn(at, segs[i]!, {});
      at = at[segs[i]!] as Record<string, unknown>;
    }
    setOwn(at, segs[segs.length - 1]!, fields[p]);
  }
  return root;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The state after a local write: only fields whose value changed (or that were added or removed) get `clock`; every
 * other field keeps the clock it had.
 */
export function stamp(prev: FieldState | null, next: Record<string, string>, deleted: boolean, clock: Hlc): FieldState {
  if (!prev) {
    const clocks: Record<string, Hlc> = {};
    for (const p of Object.keys(next)) clocks[p] = clock;
    return { texts: next, clocks, deleted, deletedClock: clock };
  }
  const clocks: Record<string, Hlc> = { ...prev.clocks };
  for (const p of Object.keys(next)) {
    const before = prev.texts[p];
    if (before === undefined || (before !== next[p] && !sameJson(before, next[p]!))) clocks[p] = clock;
  }
  for (const p of Object.keys(prev.texts)) if (!(p in next)) clocks[p] = clock;
  const deletedClock = prev.deleted === deleted ? prev.deletedClock : clock;
  // keep the earlier text where only the key order differs, so equal states encode identically
  const texts: Record<string, string> = {};
  for (const p of Object.keys(next)) texts[p] = clocks[p] === prev.clocks[p] && prev.texts[p] !== undefined ? prev.texts[p]! : next[p]!;
  return { texts, clocks, deleted, deletedClock };
}

function sameJson(a: string, b: string): boolean {
  try {
    return deepEqual(JSON.parse(a), JSON.parse(b));
  } catch {
    return false;
  }
}

/** True when `a` wins over `b` for one field (or the delete flag). */
function wins(ca: Hlc | undefined, ta: string | undefined, cb: Hlc | undefined, tb: string | undefined): boolean {
  if (ca !== cb) return (ca ?? '') > (cb ?? '');
  return (ta === undefined ? '0' : `1${ta}`) >= (tb === undefined ? '0' : `1${tb}`);
}

/** Per-field merge: newer clock wins per field. Commutative, associative and idempotent, so delivery order never matters. */
export function merge(a: FieldState, b: FieldState): FieldState {
  const texts: Record<string, string> = {};
  const clocks: Record<string, Hlc> = {};
  const paths = new Set([...Object.keys(a.texts), ...Object.keys(b.texts), ...Object.keys(a.clocks), ...Object.keys(b.clocks)]);
  for (const p of paths) {
    const fromA = wins(a.clocks[p], a.texts[p], b.clocks[p], b.texts[p]);
    const s = fromA ? a : b;
    const c = s.clocks[p];
    if (c !== undefined) clocks[p] = c;
    const t = s.texts[p];
    if (t !== undefined) texts[p] = t;
  }
  const delFromA = wins(a.deletedClock, a.deleted ? 'd' : 'l', b.deletedClock, b.deleted ? 'd' : 'l');
  return { texts, clocks, deleted: delFromA ? a.deleted : b.deleted, deletedClock: delFromA ? a.deletedClock : b.deletedClock };
}

export function sameState(a: FieldState, b: FieldState): boolean {
  return a.deleted === b.deleted && a.deletedClock === b.deletedClock && sameRecord(a.texts, b.texts) && sameRecord(a.clocks, b.clocks);
}
function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

/** Newest clock in a state (fed to the device's HLC after a remote change). */
export function maxClock(s: FieldState): Hlc {
  let m = s.deletedClock;
  for (const c of Object.values(s.clocks)) if (c > m) m = c;
  return m;
}

/**
 * JSON of the envelope. Fields keep the document's key order (screens may list keys in order); two devices may write
 * the same state with keys in another order, which `sameState` treats as equal, so no extra write follows.
 */
export function encode(s: FieldState): string {
  const fields = Object.keys(s.texts)
    .map((p) => `${JSON.stringify(p)}:${s.texts[p]}`)
    .join(',');
  const clocks = Object.keys(s.clocks)
    .map((p) => `${JSON.stringify(p)}:${JSON.stringify(s.clocks[p])}`)
    .join(',');
  return `{"v":${ENVELOPE_VERSION},"fields":{${fields}},"clocks":{${clocks}},"deleted":${s.deleted},"deletedClock":${JSON.stringify(s.deletedClock)}}`;
}

interface Envelope {
  v: 2;
  fields: Record<string, unknown>;
  clocks: Record<string, Hlc>;
  deleted?: boolean;
  deletedClock?: Hlc;
}

export function isEnvelope(x: unknown): x is Envelope {
  return isPlainObject(x) && x.v === ENVELOPE_VERSION && isPlainObject(x.fields) && isPlainObject(x.clocks) && typeof x.deletedClock === 'string';
}

/** The document value stored in a `json` column (an envelope or a document from before per-field clocks). */
export function valueOf(parsed: unknown): unknown {
  return isEnvelope(parsed) ? materialize(parsed.fields, parsed.clocks) : parsed;
}

/**
 * The state of a stored `json` column. A document written before this change (no envelope) gets every field stamped
 * with its last write time (`legacy`); nothing is rewritten until the document next changes.
 */
export function decode(json: string, legacy: { clock: Hlc; deleted: boolean }, deep?: ReadonlySet<string>): FieldState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (isEnvelope(parsed)) {
    const texts: Record<string, string> = {};
    const clocks: Record<string, Hlc> = {};
    for (const [p, v] of Object.entries(parsed.fields)) if (p === ROOT || p.startsWith('/')) texts[p] = JSON.stringify(v);
    for (const [p, c] of Object.entries(parsed.clocks)) if (p === ROOT || p.startsWith('/')) clocks[p] = cleanClock(c);
    return { texts, clocks, deleted: parsed.deleted === true, deletedClock: cleanClock(parsed.deletedClock) };
  }
  const texts = flatten(parsed, deep);
  const clocks: Record<string, Hlc> = {};
  for (const p of Object.keys(texts)) clocks[p] = legacy.clock;
  return { texts, clocks, deleted: legacy.deleted, deletedClock: legacy.clock };
}
