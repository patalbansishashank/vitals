/**
 * Ring identity (SUITE_SPEC §15.2 "Ring identity and source key"; PLAN 04 item 1 rules a–e). Tier P.
 *
 * The ring, not the device: `ringKey = ringSourceKey(ringIdentity(…))` = `ble:<family>/<model>/<ringId>`, the same on
 * every platform that can see the ring's serial or address. Maker, model and label come from this table (decision 10:
 * never from the advertised name, which carries a retail brand). Keys are never rewritten: a source from before v0.5.0
 * (`ble:jstyle2301|…`) keeps its key and history.
 */
import { ringIdentity, ringSourceKey, type FamilyId } from '../../../packages/rings/src/types';
import { isRingSource } from '../core/policy';

export interface FamilyIdentity {
  family: string;
  maker: string;
  model: string;
  label: string;
}

/** Per driver: the family id A5a uses, maker and model for provenance, the label every screen shows. */
const FAMILIES: Record<string, FamilyIdentity> = {
  jstyle2301: { family: 'jstyle2301', maker: 'J-Style', model: '2301', label: 'J-Style 2301' },
  colmi: { family: 'colmi', maker: 'Colmi', model: 'R02', label: 'Colmi R02 ring' },
  'colmi-r02': { family: 'colmi', maker: 'Colmi', model: 'R02', label: 'Colmi R02 ring' },
  crp: { family: 'crp', maker: 'CRP', model: 'ring', label: 'CRP ring' },
  jring: { family: 'jring', maker: 'Jring', model: 'ring', label: 'Jring ring' },
  luckring: { family: 'luckring', maker: 'LuckRing', model: 'ring', label: 'LuckRing ring' },
  rwfit: { family: 'rwfit', maker: 'RWfit', model: 'ring', label: 'RWfit ring' },
  ycbt: { family: 'ycbt', maker: 'YCBT', model: 'ring', label: 'YCBT ring' },
};

const cleanLabel = (s: string): string => s.replace(/\s*\(.*?\)\s*/g, ' ').trim();

/**
 * Maker, model and label for a driver. Unknown drivers fall back to what the registry says about them (`family` as
 * maker, the id as model, the driver's label), never to anything a ring advertises.
 */
export function familyIdentity(driverId: string, fallback?: { family?: string; label?: string }): FamilyIdentity {
  const known = FAMILIES[driverId];
  if (known) return known;
  const maker = fallback?.family ? cleanLabel(fallback.family) : driverId;
  return { family: driverId, maker, model: driverId, label: fallback?.label ? cleanLabel(fallback.label) : maker };
}

/** The table's label for a driver it knows, else undefined (a stored label is rewritten only to a known one). */
export function knownRingLabel(driverId: string): string | undefined {
  return FAMILIES[driverId]?.label;
}

/** The label a ring source shows, whatever its stored label says (decision 10). */
export function ringLabelOf(driverId: string, fallback?: { family?: string; label?: string }): string {
  return familyIdentity(driverId, fallback).label;
}

/**
 * `ble:<family>/<model>/<ringId>` from what the ring itself gave: serial beats address beats advertised id. Throws when
 * nothing is known (a browser without an address): the caller then matches the person's existing rings instead.
 */
export function ringKeyOf(p: { driverId: string; model?: string; serial?: string; address?: string; advertisedId?: string }): string {
  const fam = familyIdentity(p.driverId);
  const id = ringIdentity({ family: fam.family as FamilyId, model: p.model ?? fam.model, serial: p.serial, address: p.address, advertisedId: p.advertisedId });
  return ringSourceKey(id);
}

/** `ble:<family>/<model>/<ringId>` from an already-derived `ringId` ('serial:…', 'mac:…', 'adv:…'). */
export function ringKeyFromId(driverId: string, ringId: string, model?: string): string {
  const fam = familyIdentity(driverId);
  return `ble:${fam.family}/${model ?? fam.model}/${ringId}`;
}

/** Family and model of a key: the A5a form `ble:<family>/<model>/<ringId>` and the pre-v0.5.0 form `ble:<driver>|…`. */
export function parseRingKey(ringKey: string): { family: string; model?: string; ringId?: string; legacy: boolean } | undefined {
  if (!ringKey.startsWith('ble:')) return undefined;
  const rest = ringKey.slice(4);
  const slash = rest.indexOf('/');
  if (slash > 0) {
    const [family, model, ...id] = rest.split('/');
    return { family: family!, model: model === '-' ? undefined : model, ringId: id.join('/') || undefined, legacy: false };
  }
  const bar = rest.indexOf('|');
  return { family: bar > 0 ? rest.slice(0, bar) : rest, legacy: true };
}

/* ---------------------------------------------------------------- what agents see (L-REV2 R3-10, R3-11) */

/** A ring key's alias prefix (`ble:<family>/<model>/`, or `ble:<driver>|` for a key from before v0.5.0) when the key
 * carries the ring's own id after it; undefined for any other key, an alias and a key without an id. */
function ringIdPrefix(sourceKey: string): string | undefined {
  if (!sourceKey.startsWith('ble:')) return undefined;
  const rest = sourceKey.slice(4);
  const bar = rest.indexOf('|');
  const slash = rest.indexOf('/');
  const end = slash > 0 && (bar < 0 || slash < bar) ? rest.indexOf('/', slash + 1) : bar > 0 ? bar : -1;
  if (end < 0 || end === rest.length - 1 || /^ring\d*$/.test(rest.slice(end + 1))) return undefined;
  return `ble:${rest.slice(0, end + 1)}`;
}

/**
 * The keys an agent gets for ring sources: nothing in them comes from the ring's id (serial, Bluetooth address,
 * advertised id). Per family and model (per driver for a key from before v0.5.0) the person's ring sources are numbered
 * in the order their documents were created (`createdAt`, synced, so every device and the server agree; one without it
 * after those), then by key: `ble:jstyle2301/2301/ring1`. A ring key with no document among `sources` (records that
 * synced before it, a deleted source) is `…/ring` without a number. Any other key maps to itself. Known limit: removing
 * a ring renumbers the later rings of its family and model; aliases agree within one state of the store.
 */
export function ringAliases(sources: ReadonlyArray<{ sourceKey: string; createdAt?: string }>): (sourceKey: string) => string {
  const groups = new Map<string, Array<{ key: string; at: string }>>();
  for (const s of sources) {
    const prefix = ringIdPrefix(s.sourceKey);
    if (!prefix) continue;
    let rings = groups.get(prefix);
    if (!rings) groups.set(prefix, (rings = []));
    rings.push({ key: s.sourceKey, at: s.createdAt || '\uffff' });
  }
  const alias = new Map<string, string>();
  // code-unit order, not the locale's: the same on every device and the server
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  for (const [prefix, rings] of groups) rings.sort((a, b) => cmp(a.at, b.at) || cmp(a.key, b.key)).forEach((r, i) => alias.set(r.key, `${prefix}ring${i + 1}`));
  return (k) => {
    const prefix = ringIdPrefix(k);
    return prefix ? (alias.get(k) ?? `${prefix}ring`) : k;
  };
}

const RING_KEY_IN_TEXT = /ble:[A-Za-z0-9_-]+(?:\/[^/\s"'`<>|]+\/[^\s"'`<>,;()]+|\|[^\s"'`<>,;()]+)/g;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isPlain = (x: object): boolean => {
  const p: unknown = Object.getPrototypeOf(x);
  return p === Object.prototype || p === null;
};

/**
 * `v` with every ring key in it (a whole string, inside text, an object key, at any depth) as its alias among `sources`;
 * `v` itself when it holds none. A key the store holds is replaced whole first, longest first (an id may hold a space);
 * then anything else that reads like a ring key, less a full stop, comma or colon that ends it. Only arrays and plain
 * objects are walked: a date or a typed array passes as it is. For results built before the reader was known (a job's,
 * the change list).
 */
export function aliasRingKeys<T>(v: T, sources: ReadonlyArray<{ sourceKey: string; createdAt?: string }>): T {
  if (!JSON.stringify(v ?? null).includes('ble:')) return v;
  const alias = ringAliases(sources);
  const known = sources
    .map((s) => s.sourceKey)
    .filter((k) => alias(k) !== k)
    .sort((a, b) => b.length - a.length)
    .map((k) => ({ re: new RegExp(`${escapeRe(k)}(?![A-Za-z0-9_:+/=-])`, 'g'), to: alias(k) }));
  const aliasIn = (s: string): string => {
    if (!s.includes('ble:')) return s;
    for (const k of known) s = s.replace(k.re, k.to);
    return s.replace(RING_KEY_IN_TEXT, (m) => {
      const key = m.replace(/[.,:]+$/, '');
      return alias(key) + m.slice(key.length);
    });
  };
  const walk = (x: unknown): unknown =>
    typeof x === 'string' ? aliasIn(x) : Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' && isPlain(x) ? Object.fromEntries(Object.entries(x).map(([k, y]) => [aliasIn(k), walk(y)])) : x;
  return walk(v) as T;
}

/**
 * A ring source's label from the table at read time (decision 10): the ring service rewrites a stored label only when it
 * starts on a client, so a label read off the ring's advertisement before the table existed can still be stored (and a
 * person served only by the server never gets the rewrite). A driver the table does not know keeps `stored` when one is
 * given, else is named by its id. Lumen reads one J-Style 2301. Undefined for a source that is not a ring.
 */
export function ringSourceLabel(src: { sourceKey: string; ble?: { driver?: string } }, stored?: string): string | undefined {
  if (!isRingSource(src)) return undefined;
  const driver = src.ble?.driver ?? parseRingKey(src.sourceKey)?.family ?? 'jstyle2301';
  return knownRingLabel(driver) ?? stored ?? familyIdentity(driver).label;
}

/** A Bluetooth address (`aa:bb:cc:dd:ee:ff`, any case or with dashes) as the platform id gives it; undefined otherwise. */
export function macOf(platformId: string | undefined): string | undefined {
  const m = platformId?.trim().toLowerCase().replace(/-/g, ':');
  return m && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m) ? m : undefined;
}
