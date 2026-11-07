/**
 * Settings › Heart rate over V3's synced settings (energy SPEC §V4.7, §V3.9): `hrProfile`, `keytelEnabled`,
 * `stepsPreference`, `soleSustainedGait`, `stepsHeadline` and `hrMaxSuggestionDeclinedBpm` (DECISIONS V4e-07) live in the
 * synced `settings` document; every change goes through `settings.update` as the person. The HRmax suggestion's evidence
 * (V2 `suggestHrMaxRaise`) is the approved device bouts of the last 180 days (done `session` entries written by an
 * approval) with the supported HR of their minutes from the fused timeline (`hr-support/1`).
 *
 * Values a device kept under `HEART_SETTINGS_KEY` before the synced fields existed are moved once into the synced
 * settings (only where the synced value is still the default) and the key is deleted.
 */
import { useEffect, useSyncExternalStore } from 'react';
import '@/commands/defs/settings'; // registers `settings.update`
import { failureMessage, GENERIC_FAILURE, sendCommand } from '@/features/lib/sendCommand';
import { addDays, compareDates, localToInstant } from '@/living/dates';
import type { LocalDate, LogEntry } from '@/living';
import { segmentsFromTimeline, type HrMaxEvidenceBout, type Ms } from '@/living/sensors';
import { DEFAULT_SETTINGS, useSettingsStore, type SettingsValues } from '@/state/settingsStore';
import { timelinesFor, timelineStart } from '@/features/living/progress/data/timelines';
import type * as Runtime from '@/state/runtime';

export type StepLineagePreference = 'ring' | 'phone';

/** §V3.9 settings (D1, D2, D3, D6) plus the one this screen adds (a declined HRmax suggestion). */
export interface HeartSettings {
  hrProfile: {
    /** A maximum the person set (a test, a coach, or a confirmed suggestion). */
    hrMaxOverride?: number | null;
    /** A WAKING resting HR the person entered. */
    hrRestOverride?: number | null;
    /** D6: use the sleeping low as the resting HR for heart-rate reserve (opt-in, default off). */
    useSleepLowAsRest: boolean;
  };
  /** D2: Keytel heart-rate calories inside its domain (default on). */
  keytelEnabled: boolean;
  /** D1: the step source preferred when both observe the same interval (ring and phone, in order). */
  stepsPreference: readonly StepLineagePreference[];
  /** D1: a sole sustained gait wins (the treadmill case). */
  soleSustainedGait: boolean;
  /** D3: the day's steps headline. */
  stepsHeadline: 'atLeast' | 'located';
  /** The suggested HRmax the person declined; a suggestion shows again only above it. */
  hrMaxSuggestionDeclinedBpm: number | null;
}

export const HEART_SETTINGS_DEFAULTS: HeartSettings = {
  hrProfile: { ...DEFAULT_SETTINGS.hrProfile },
  keytelEnabled: DEFAULT_SETTINGS.keytelEnabled,
  stepsPreference: DEFAULT_SETTINGS.stepsPreference.filter((x): x is StepLineagePreference => x === 'ring' || x === 'phone'),
  soleSustainedGait: DEFAULT_SETTINGS.soleSustainedGait,
  stepsHeadline: DEFAULT_SETTINGS.stepsHeadline,
  hrMaxSuggestionDeclinedBpm: DEFAULT_SETTINGS.hrMaxSuggestionDeclinedBpm,
};

/** Where V4e kept these on the device before the synced fields existed (migrated once, then deleted). */
export const HEART_SETTINGS_KEY = 'vitals.heartSettings';

type Synced = Pick<SettingsValues, 'hrProfile' | 'keytelEnabled' | 'stepsPreference' | 'soleSustainedGait' | 'stepsHeadline' | 'hrMaxSuggestionDeclinedBpm'>;

const ringPhone = (p: readonly string[]): StepLineagePreference[] => {
  const out = p.filter((x): x is StepLineagePreference => x === 'ring' || x === 'phone');
  return out.length > 0 ? out : [...HEART_SETTINGS_DEFAULTS.stepsPreference];
};

let memo: { src: Synced; value: HeartSettings } | null = null;

function fromStore(s: Synced): HeartSettings {
  const m = memo?.src;
  if (m && m.hrProfile === s.hrProfile && m.keytelEnabled === s.keytelEnabled && m.stepsPreference === s.stepsPreference && m.soleSustainedGait === s.soleSustainedGait && m.stepsHeadline === s.stepsHeadline && m.hrMaxSuggestionDeclinedBpm === s.hrMaxSuggestionDeclinedBpm) return memo!.value;
  const hp = s.hrProfile ?? DEFAULT_SETTINGS.hrProfile;
  const value: HeartSettings = {
    hrProfile: { hrMaxOverride: hp.hrMaxOverride ?? null, hrRestOverride: hp.hrRestOverride ?? null, useSleepLowAsRest: hp.useSleepLowAsRest === true },
    keytelEnabled: s.keytelEnabled !== false,
    stepsPreference: ringPhone(s.stepsPreference ?? DEFAULT_SETTINGS.stepsPreference),
    soleSustainedGait: s.soleSustainedGait !== false,
    stepsHeadline: s.stepsHeadline === 'located' ? 'located' : 'atLeast',
    hrMaxSuggestionDeclinedBpm: typeof s.hrMaxSuggestionDeclinedBpm === 'number' ? s.hrMaxSuggestionDeclinedBpm : null,
  };
  memo = { src: { hrProfile: s.hrProfile, keytelEnabled: s.keytelEnabled, stepsPreference: s.stepsPreference, soleSustainedGait: s.soleSustainedGait, stepsHeadline: s.stepsHeadline, hrMaxSuggestionDeclinedBpm: s.hrMaxSuggestionDeclinedBpm }, value };
  return value;
}

/** The settings now. */
export const readHeartSettings = (): HeartSettings => fromStore(useSettingsStore.getState());

export function useHeartSettings(): HeartSettings {
  useEffect(() => {
    void migrateLegacyHeartSettings();
  }, []);
  return useSyncExternalStore(useSettingsStore.subscribe, readHeartSettings, readHeartSettings);
}

export type HeartSettingsPatch = Partial<Omit<HeartSettings, 'hrProfile'>> & { hrProfile?: Partial<HeartSettings['hrProfile']> };

/** The `settings.update` patch of a screen patch (the whole `hrProfile`; other step lineages kept after ring and phone). */
function toPatch(patch: HeartSettingsPatch): Partial<SettingsValues> {
  const s = useSettingsStore.getState();
  const out: Partial<SettingsValues> = {};
  if (patch.hrProfile) {
    const hp = { ...DEFAULT_SETTINGS.hrProfile, ...s.hrProfile };
    out.hrProfile = {
      hrMaxOverride: patch.hrProfile.hrMaxOverride !== undefined ? patch.hrProfile.hrMaxOverride : hp.hrMaxOverride,
      hrRestOverride: patch.hrProfile.hrRestOverride !== undefined ? patch.hrProfile.hrRestOverride : hp.hrRestOverride,
      useSleepLowAsRest: patch.hrProfile.useSleepLowAsRest ?? hp.useSleepLowAsRest,
    };
  }
  if (patch.keytelEnabled !== undefined) out.keytelEnabled = patch.keytelEnabled;
  if (patch.stepsPreference !== undefined) {
    const others = (s.stepsPreference ?? []).filter((x) => x !== 'ring' && x !== 'phone');
    out.stepsPreference = [...patch.stepsPreference, ...others];
  }
  if (patch.soleSustainedGait !== undefined) out.soleSustainedGait = patch.soleSustainedGait;
  if (patch.stepsHeadline !== undefined) out.stepsHeadline = patch.stepsHeadline;
  if (patch.hrMaxSuggestionDeclinedBpm !== undefined) out.hrMaxSuggestionDeclinedBpm = patch.hrMaxSuggestionDeclinedBpm;
  return out;
}

/** The outcome of applying a patch: done, or why not (plain words; the old values stay in force). */
export type HeartUpdateResult = { ok: true } | { ok: false; message: string };

/**
 * Apply a patch through `settings.update` and report the outcome. The failure is NOT toasted here: the Heart rate
 * screen shows it in place, with a retry (a toast alone leaves nothing to act on once it fades).
 */
export async function applyHeartSettings(patch: HeartSettingsPatch): Promise<HeartUpdateResult> {
  const p = toPatch(patch);
  if (Object.keys(p).length === 0) return { ok: true };
  const r = await sendCommand('settings.update', { patch: p as never }, { silent: true });
  return r.ok ? { ok: true } : { ok: false, message: failureMessage(r.error) ?? GENERIC_FAILURE };
}

/** Apply a patch through `settings.update`; resolves true when it went through (the "Saved" flash shows only then). */
export async function updateHeartSettings(patch: HeartSettingsPatch): Promise<boolean> {
  const p = toPatch(patch);
  if (Object.keys(p).length === 0) return true;
  const r = await sendCommand('settings.update', { patch: p as never });
  return r.ok;
}

/** Tests and the harness: back to the defaults (or a given state), through the same command. */
export async function resetHeartSettings(next: HeartSettings = HEART_SETTINGS_DEFAULTS): Promise<boolean> {
  try {
    localStorage.removeItem(HEART_SETTINGS_KEY);
  } catch {
    // nothing stored
  }
  return updateHeartSettings({ ...next, hrProfile: { hrMaxOverride: null, hrRestOverride: null, ...next.hrProfile } });
}

let migrated = false;

/** Moves the device-kept values (V4e's stand-in) into the synced settings once, where the synced value is still default. */
export async function migrateLegacyHeartSettings(): Promise<void> {
  if (migrated) return;
  migrated = true;
  let raw: string | null;
  try {
    raw = localStorage.getItem(HEART_SETTINGS_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const old = JSON.parse(raw) as Partial<HeartSettings>;
    const now = readHeartSettings();
    const d = HEART_SETTINGS_DEFAULTS;
    const patch: HeartSettingsPatch = {};
    const hp: Partial<HeartSettings['hrProfile']> = {};
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    for (const k of ['hrMaxOverride', 'hrRestOverride', 'useSleepLowAsRest'] as const) {
      const v = old.hrProfile?.[k];
      if (v !== undefined && !same(v, d.hrProfile[k]) && same(now.hrProfile[k], d.hrProfile[k])) (hp as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(hp).length) patch.hrProfile = hp;
    for (const k of ['keytelEnabled', 'stepsPreference', 'soleSustainedGait', 'stepsHeadline', 'hrMaxSuggestionDeclinedBpm'] as const) {
      const v = old[k];
      if (v !== undefined && !same(v, d[k]) && same(now[k], d[k])) (patch as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(patch).length === 0 || (await updateHeartSettings(patch))) localStorage.removeItem(HEART_SETTINGS_KEY);
  } catch {
    try {
      localStorage.removeItem(HEART_SETTINGS_KEY); // unreadable: nothing to move
    } catch {
      // ignore
    }
  }
}

/** Tests: allow the one-time migration to run again. */
export function resetHeartMigration(): void {
  migrated = false;
}

/* ---- the HRmax suggestion's evidence: approved bouts with supported HR ------------------------------------------- */

export interface HrEvidenceAdapter {
  /** Approved bouts that ended in the 180 days before `now`, with their supported HR segments and signal quality. */
  hrMaxEvidenceBouts(now: Ms): readonly HrMaxEvidenceBout[];
}

/** The window `suggestHrMaxRaise` reads (V2 `hrMaxRaiseWindowDays`). */
const EVIDENCE_DAYS = 180;

type Session = Extract<LogEntry, { kind: 'session' }>;

/** The approved device bouts of the documents with a time window (the done sessions an approval wrote). */
export function approvedDeviceBouts(entries: readonly LogEntry[], tz: string): Array<{ id: string; date: LocalDate; window: { start: Ms; end: Ms } }> {
  const out: Array<{ id: string; date: LocalDate; window: { start: Ms; end: Ms } }> = [];
  for (const e of entries) {
    if (e.kind !== 'session') continue;
    const s = e as Session;
    if (s.status !== 'done' || !s.candidate || s.candidate.manual || typeof s.startH !== 'number' || !(typeof s.durationMin === 'number' && s.durationMin > 0)) continue;
    const start = Date.parse(localToInstant(s.date, s.startH, tz));
    if (!Number.isFinite(start)) continue;
    out.push({ id: s.physicalBoutId ?? s.id, date: s.date, window: { start, end: start + s.durationMin * 60_000 } });
  }
  return out;
}

let evStamp = 0;
let evCache: { key: string; bouts: readonly HrMaxEvidenceBout[] } | null = null;
let evLoading: string | null = null;
const evListeners = new Set<() => void>();
let evRev = 0;
const evBump = () => {
  evRev++;
  for (const l of evListeners) l();
};
let evWatched: unknown = null;
let evOff: (() => void) | null = null;

async function loadEvidence(now: Ms): Promise<readonly HrMaxEvidenceBout[]> {
  const [{ getDocumentStore }, { bodyOf }, { projectEntries }, { timeZone }, { currentDay }] = await Promise.all([import('@/state/runtime'), import('@/store'), import('@/living/logs'), import('@/commands/bus'), import('@/commands/livingWiring')]);
  const store = getDocumentStore();
  await store.ready;
  const tz = timeZone();
  const today = currentDay(now);
  const since = addDays(today, -(EVIDENCE_DAYS + 1));
  const all = store.peekAll<LogEntry>('dailyLogs').map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id }) as LogEntry);
  const bouts = approvedDeviceBouts(projectEntries(all), tz).filter((b) => compareDates(b.date, since) >= 0 && b.window.end <= now);
  if (bouts.length === 0) return [];
  // a bout's minutes sit on the timeline of its local calendar date(s): its app date, and the next one after midnight
  const dates = [...new Set(bouts.flatMap((b) => [b.date, addDays(b.date, 1)]))];
  const tls = await timelinesFor(dates, today, now);
  return bouts.map((b) => {
    const segments = [b.date, addDays(b.date, 1)]
      .map((d) => tls.get(d))
      .flatMap((t) => (t ? segmentsFromTimeline(timelineStart(t, tz), t.hr.bpm, t.hr.supportedS) : []))
      .filter((g) => g.end > b.window.start && g.start < b.window.end)
      .sort((x, y) => x.start - y.start);
    // `hr-support/1` minutes are the quality-accepted ones (no motion artefact, enough samples)
    return { id: b.id, window: b.window, segments, quality: segments.length > 0 };
  });
}

let runtime: typeof Runtime | null = null;
let runtimeLoading = false;

/** Re-read when the log changes, and forget everything when the document store is replaced (a reset, another person). */
function watchEvidence(): void {
  if (!runtime) {
    if (!runtimeLoading) {
      runtimeLoading = true;
      void import('@/state/runtime').then((m) => {
        runtime = m;
        watchEvidence();
      });
    }
    return;
  }
  let store: ReturnType<typeof runtime.getDocumentStore>;
  try {
    store = runtime.getDocumentStore();
  } catch {
    return;
  }
  if (store === evWatched) return;
  evOff?.();
  const replaced = evWatched !== null;
  evWatched = store;
  let started = false;
  evOff = store.watch('dailyLogs', {}, () => {
    if (!started) {
      started = true;
      return;
    }
    evStamp++;
    evBump();
  });
  if (replaced) {
    evStamp++;
    evCache = null;
    evLoading = null;
  }
}

const liveEvidence: HrEvidenceAdapter = {
  hrMaxEvidenceBouts(now) {
    watchEvidence();
    // the 180-day window moves by the day: one answer per day and document change
    const key = `${evStamp}:${Math.floor(now / 86_400_000)}`;
    if (evCache?.key === key) return evCache.bouts;
    if (evLoading !== key) {
      evLoading = key;
      void loadEvidence(now)
        .catch(() => [] as HrMaxEvidenceBout[])
        .then((bouts) => {
          if (evLoading !== key) return;
          evLoading = null;
          evCache = { key, bouts };
          evBump();
        });
    }
    return evCache?.bouts ?? [];
  },
};

let evidence: HrEvidenceAdapter = liveEvidence;

export const hrEvidenceAdapter = (): HrEvidenceAdapter => evidence;

/** Approved bouts with supported HR for the suggestion at `now`; re-renders when they load or the log changes. */
export function hrMaxEvidenceBouts(now: Ms): readonly HrMaxEvidenceBout[] {
  return evidence.hrMaxEvidenceBouts(now);
}

export function useHrMaxEvidenceBouts(now: Ms): readonly HrMaxEvidenceBout[] {
  const rev = useSyncExternalStore(
    (l) => {
      evListeners.add(l);
      return () => evListeners.delete(l);
    },
    () => evRev,
    () => evRev,
  );
  void rev;
  return hrMaxEvidenceBouts(now);
}

/** Tests and the harness only: install the bouts (null restores the live read). */
export function setHrEvidence(adapter: HrEvidenceAdapter | null): void {
  evidence = adapter ?? liveEvidence;
  evCache = null;
  evLoading = null;
  evStamp++;
  evBump();
}
