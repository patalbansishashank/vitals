/**
 * Which streams a device feeds, and what the device and the person's own correction say for a day. Read straight from
 * the biometrics index (sources, records, corrections), so a source turned on, an import or a correction shows at once.
 * An unowned stream keeps manual logging; an owned one shows the device value with a Correct action.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { ownedFamilies, type OwnedFamily } from '@/biometrics/core/policy';
import { resolveDays } from '@/biometrics/core/resolve';
import type { BioCorrection } from '@/biometrics/core/types';
import { sharedBioIndex, type BioDocIndex } from '@/biometrics/store/docIndex';
import { getDocumentStore } from '@/state/runtime';
import type { LocalDate } from '@/living';

/** The streams Today lets a device own. */
export type OwnedKind = 'sleep' | 'steps' | 'weight';

export const FAMILY_OF: Readonly<Record<OwnedKind, OwnedFamily>> = {
  sleep: 'sleep_sessions',
  steps: 'steps',
  weight: 'body',
};
export const KIND_WORD: Readonly<Record<OwnedKind, string>> = {
  sleep: 'sleep',
  steps: 'steps',
  weight: 'weight',
};

export interface OwnedStream {
  kind: OwnedKind;
  /** The device's name ("J-Style ring"). */
  owner: string;
  /** What the device itself recorded for the day (hours / steps / kg), null when it has nothing yet. */
  deviceValue: number | null;
  /** The value in use: the correction when there is one, else the device's. */
  value: number | null;
  /** The active correction for the day, if any. */
  correction: BioCorrection | null;
}

export type DeviceOwnership = Partial<Record<OwnedKind, OwnedStream>>;

export const correctionKeyOf = (kind: OwnedKind, date: LocalDate): string =>
  kind === 'sleep' ? `sleep:${date}` : kind === 'steps' ? `daily:${date}:steps` : `spot:${date}:weight_kg`;

function index(): BioDocIndex | null {
  try {
    return sharedBioIndex(getDocumentStore());
  } catch {
    return null;
  }
}

/** Re-renders when the index changes; the snapshot is its revision. */
function useRevision(ix: BioDocIndex | null): number {
  return useSyncExternalStore(
    (fn) => (ix ? ix.subscribe(fn) : () => undefined),
    () => (ix ? ix.revision() : 0),
    () => 0,
  );
}

function valuesOf(ix: BioDocIndex, date: LocalDate, corrections: readonly BioCorrection[]) {
  const records = ix.latestRecords(date, date).map((r) => ({ sourceKey: r.sourceKey, record: r.record }));
  const day = resolveDays(records, ix.sources(), { from: date, to: date }, corrections).find(
    (d) => d.localDate === date,
  );
  const spot = day?.spots.filter((s) => s.metric === 'weight_kg').pop();
  return {
    sleep: day?.mainSleep ? day.mainSleep.asleep_s / 3600 : null,
    steps: day?.daily?.steps ?? null,
    weight: spot ? spot.value : null,
  } satisfies Record<OwnedKind, number | null>;
}

export function useDeviceOwnership(date: LocalDate): DeviceOwnership {
  const ix = index();
  const rev = useRevision(ix);
  return useMemo(() => {
    void rev;
    if (!ix || !ix.isLoaded) return {};
    const owned = ownedFamilies(ix.sources());
    const corrections = ix.corrections();
    const device = valuesOf(ix, date, []);
    const used = valuesOf(
      ix,
      date,
      corrections.filter((c) => c.target.localDate === date),
    );
    const out: DeviceOwnership = {};
    for (const kind of ['sleep', 'steps', 'weight'] as const) {
      const o = owned[FAMILY_OF[kind]];
      if (!o) continue;
      const c = ix.correction(correctionKeyOf(kind, date));
      out[kind] = {
        kind,
        owner: o.label,
        deviceValue: device[kind],
        value: used[kind],
        correction: c && !c.clearedAt ? c : null,
      };
    }
    return out;
  }, [ix, rev, date]);
}

/** Active corrections, newest first (Progress lists them). */
export function useCorrections(): BioCorrection[] {
  const ix = index();
  const rev = useRevision(ix);
  return useMemo(
    () => (void rev, ix && ix.isLoaded ? ix.corrections().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) : []),
    [ix, rev],
  );
}

/** Whether a device owns a stream right now (non-hook, for the write side). */
export function ownsStream(kind: OwnedKind): boolean {
  const ix = index();
  return !!ix && ix.isLoaded && !!ownedFamilies(ix.sources())[FAMILY_OF[kind]];
}

/** What the device itself recorded for a day (no correction applied), null when it has nothing. */
export function deviceValueFor(kind: OwnedKind, date: LocalDate): number | null {
  const ix = index();
  return ix && ix.isLoaded ? valuesOf(ix, date, [])[kind] : null;
}

/** The device names feeding each stream (for labels outside Today). */
export function useOwnerLabels(): Partial<Record<OwnedKind, string>> {
  const ix = index();
  const rev = useRevision(ix);
  return useMemo(() => {
    void rev;
    if (!ix || !ix.isLoaded) return {};
    const owned = ownedFamilies(ix.sources());
    const out: Partial<Record<OwnedKind, string>> = {};
    for (const k of ['sleep', 'steps', 'weight'] as const) if (owned[FAMILY_OF[k]]) out[k] = owned[FAMILY_OF[k]]!.label;
    return out;
  }, [ix, rev]);
}
