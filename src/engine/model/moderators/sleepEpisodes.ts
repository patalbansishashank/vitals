/**
 * Observed sleep episodes → waking dates (D8-06, C1; `CONTRACT_VERSIONS.sleepDate`). Pure helpers for the boundary adapter
 * that turns logged `{ bedAt, wakeAt, tz }` instants into the engine's per-day `sleepEndingToday` input:
 *
 *  - durations come from the absolute instants (offsets in the ISO strings, or the IANA zone when the string is UTC), so a
 *    DST change, midnight crossing or a daytime (shift-work) episode keeps its true length; raw timestamps are never edited;
 *  - an episode belongs to the LOCAL DATE OF ITS WAKE instant: sleep ending on day D informs waking day D (planned template
 *    nights keep their starting-date convention elsewhere — this module never shifts them);
 *  - overlapping or duplicate episodes are merged (union of their intervals), never double-counted;
 *  - naps add to the day's total sleep duration but not to the main episode's timing;
 *  - an unparseable episode is reported as invalid, not guessed.
 * No `Date.now`/clock reads; `Intl` is used only to resolve a named zone for a UTC instant.
 */
import { daysFromCivil } from './equations';

/** One logged episode (mirrors `ObservedSleepEpisode` of the schedule contract). */
export interface SleepEpisodeInput {
  bedAt: string;
  wakeAt: string;
  tz?: string;
  quality?: 'poor' | 'fair' | 'good';
  restfulness?: number;
  kind?: 'main' | 'nap';
  /** Minutes reported awake inside the episode (subtracted from the duration, never below zero). */
  awakeMin?: number;
  eventId?: string;
}

/** An instant resolved to absolute minutes and its local wall-clock date/time. */
export interface ResolvedInstant {
  /** Minutes since 1970-01-01T00:00Z (absolute). */
  epochMin: number;
  /** Local civil date `YYYY-MM-DD` and its day number (days since 1970-01-01). */
  localDate: string;
  localDayNumber: number;
  /** Local clock hour, fractional (0 ≤ h < 24). */
  localClockH: number;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** Civil date of a day number (inverse of `daysFromCivil`, Hinnant). */
export function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: era * 400 + yoe + (m <= 2 ? 1 : 0), m, d };
}

const isoDate = (dayNumber: number): string => {
  const { y, m, d } = civilFromDays(dayNumber);
  return `${y}-${pad2(m)}-${pad2(d)}`;
};

/** Local wall-clock parts of an absolute instant in a named IANA zone (null when the zone is unknown to the runtime). */
function zoneParts(epochMin: number, tz: string): { dayNumber: number; clockH: number } | null {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const parts = f.formatToParts(new Date(epochMin * 60000));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
    const y = get('year');
    const mo = get('month');
    const d = get('day');
    const h = get('hour');
    const mi = get('minute');
    const s = get('second');
    if (![y, mo, d, h, mi, s].every(Number.isFinite)) return null;
    return { dayNumber: daysFromCivil(y, mo, d), clockH: h + mi / 60 + s / 3600 };
  } catch {
    return null;
  }
}

/**
 * Resolve an ISO-8601 instant. With an explicit offset (`+05:30`, `-04:00`) the local wall time is the one written; with
 * `Z` and a zone the local time comes from the zone; without any offset the instant is floating and unresolved (null:
 * its absolute duration across a DST change cannot be known).
 */
export function resolveInstant(iso: string, tz?: string): ResolvedInstant | null {
  const m = ISO.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const sec = m[6] ? Number(m[6]) : 0;
  const frac = m[7] ? Number(`0.${m[7]}`) : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 60) return null;
  const off = m[8];
  if (off === undefined) return null;
  const wallDay = daysFromCivil(y, mo, d);
  const wallMin = wallDay * 1440 + h * 60 + mi + (sec + frac) / 60;
  if (off === 'Z') {
    const epochMin = wallMin;
    if (tz) {
      const zp = zoneParts(epochMin, tz);
      if (!zp) return null;
      return { epochMin, localDate: isoDate(zp.dayNumber), localDayNumber: zp.dayNumber, localClockH: zp.clockH };
    }
    return { epochMin, localDate: isoDate(wallDay), localDayNumber: wallDay, localClockH: h + mi / 60 + (sec + frac) / 3600 };
  }
  const sign = off[0] === '-' ? -1 : 1;
  const digits = off.slice(1).replace(':', '');
  const offMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  return { epochMin: wallMin - offMin, localDate: isoDate(wallDay), localDayNumber: wallDay, localClockH: h + mi / 60 + (sec + frac) / 3600 };
}

/** Duration of one episode in hours from its absolute instants minus reported awake time (≥ 0); null when invalid. */
export function observedEpisodeHours(ep: SleepEpisodeInput): number | null {
  const a = resolveInstant(ep.bedAt, ep.tz);
  const b = resolveInstant(ep.wakeAt, ep.tz);
  if (!a || !b || !(b.epochMin > a.epochMin)) return null;
  const awake = ep.awakeMin !== undefined && ep.awakeMin > 0 ? ep.awakeMin : 0;
  const min = b.epochMin - a.epochMin - awake;
  return min > 0 ? min / 60 : 0;
}

/** Sleep attributed to one waking date. */
export interface WakeDateSleep {
  /** Local date of the wake instant(s) `YYYY-MM-DD`. */
  wakeDate: string;
  /** Total sleep ending on this date (merged main episode + naps, overlaps counted once), h. */
  hours: number;
  /** Main episode alone, h, and its local bed/wake clock hours (0 when the date holds only naps). */
  mainHours: number;
  bedClockH: number;
  wakeClockH: number;
  /** Naps ending on this date, h. */
  napHours: number;
  /** Subjective entries of the main episode, only when actually entered. */
  quality?: 'poor' | 'fair' | 'good';
  restfulness?: number;
  /** Event ids merged into this date (provenance). */
  eventIds: string[];
}

export interface MappedSleep {
  byWakeDate: WakeDateSleep[];
  /** Episodes that could not be resolved (unparseable, floating time or wake ≤ bed): kept out, never guessed. */
  invalid: SleepEpisodeInput[];
}

interface Block {
  start: number;
  end: number;
  wake: ResolvedInstant;
  bed: ResolvedInstant;
  nap: boolean;
  awakeMin: number;
  quality?: SleepEpisodeInput['quality'];
  restfulness?: number;
  eventIds: string[];
}

/**
 * Map logged episodes to waking dates (D8-06). Overlapping episodes merge into one block (its end decides the wake date;
 * it is a nap only if every merged episode is a nap). On each date the longest non-nap block is the main episode; other
 * blocks are naps. Pure; output sorted by date.
 */
export function mapEpisodesToWakeDates(episodes: readonly SleepEpisodeInput[]): MappedSleep {
  const invalid: SleepEpisodeInput[] = [];
  const blocks: Block[] = [];
  for (const ep of episodes) {
    const bed = resolveInstant(ep.bedAt, ep.tz);
    const wake = resolveInstant(ep.wakeAt, ep.tz);
    if (!bed || !wake || !(wake.epochMin > bed.epochMin)) {
      invalid.push(ep);
      continue;
    }
    blocks.push({
      start: bed.epochMin,
      end: wake.epochMin,
      bed,
      wake,
      nap: ep.kind === 'nap',
      awakeMin: ep.awakeMin !== undefined && ep.awakeMin > 0 ? ep.awakeMin : 0,
      ...(ep.quality ? { quality: ep.quality } : {}),
      ...(ep.restfulness !== undefined ? { restfulness: ep.restfulness } : {}),
      eventIds: ep.eventId ? [ep.eventId] : [],
    });
  }
  blocks.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Block[] = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && b.start < last.end) {
      if (b.end > last.end) {
        last.end = b.end;
        last.wake = b.wake;
      }
      last.nap = last.nap && b.nap;
      last.awakeMin = Math.max(last.awakeMin, b.awakeMin);
      if (last.quality === undefined && b.quality !== undefined) last.quality = b.quality;
      if (last.restfulness === undefined && b.restfulness !== undefined) last.restfulness = b.restfulness;
      last.eventIds.push(...b.eventIds);
    } else merged.push({ ...b, eventIds: [...b.eventIds] });
  }
  const byDate = new Map<string, Block[]>();
  for (const b of merged) {
    const list = byDate.get(b.wake.localDate) ?? [];
    list.push(b);
    byDate.set(b.wake.localDate, list);
  }
  const out: WakeDateSleep[] = [];
  for (const [wakeDate, list] of [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const len = (b: Block): number => Math.max(0, b.end - b.start - b.awakeMin) / 60;
    let main: Block | undefined;
    for (const b of list) if (!b.nap && (main === undefined || len(b) > len(main))) main = b;
    let total = 0;
    let naps = 0;
    for (const b of list) {
      total += len(b);
      if (b !== main) naps += len(b);
    }
    out.push({
      wakeDate,
      hours: total,
      mainHours: main ? len(main) : 0,
      bedClockH: main ? main.bed.localClockH : 0,
      wakeClockH: main ? main.wake.localClockH : 0,
      napHours: naps,
      ...(main?.quality ? { quality: main.quality } : {}),
      ...(main?.restfulness !== undefined ? { restfulness: main.restfulness } : {}),
      eventIds: list.flatMap((b) => b.eventIds),
    });
  }
  return { byWakeDate: out, invalid };
}
