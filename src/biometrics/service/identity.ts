/**
 * Ring identity (SUITE_SPEC §15.2 "Ring identity and source key"; PLAN 04 item 1 rules a–e). Tier P.
 *
 * The ring, not the device: `ringKey = ringSourceKey(ringIdentity(…))` = `ble:<family>/<model>/<ringId>`, the same on
 * every platform that can see the ring's serial or address. Maker, model and label come from this table (decision 10:
 * never from the advertised name, which carries a retail brand). Keys are never rewritten: a source from before v0.5.0
 * (`ble:jstyle2301|…`) keeps its key and history.
 */
import { ringIdentity, ringSourceKey, type FamilyId } from '../../../packages/rings/src/types';

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

/** A Bluetooth address (`aa:bb:cc:dd:ee:ff`, any case or with dashes) as the platform id gives it; undefined otherwise. */
export function macOf(platformId: string | undefined): string | undefined {
  const m = platformId?.trim().toLowerCase().replace(/-/g, ':');
  return m && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m) ? m : undefined;
}
