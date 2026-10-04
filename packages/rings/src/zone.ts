/**
 * The local calendar a history record is laid out on: the IANA zone the session stamps as `params.tz` when it is known
 * (each day gets the offset of its own date, like the Kotlin's `LocalDate.minusDays(n).atStartOfDay(zone)`), else the
 * fixed offset `tzOffsetS` stamped on the command. Same approach as YCBT's `zoneOffsetS` / `localToEpochMs`.
 */
export interface Zone {
  tz?: string;
  tzOffsetS: number;
}

const DAY_S = 86_400;
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    let f: Intl.DateTimeFormat | null = null;
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    } catch {
      // An unknown zone name: the fixed offset is used.
    }
    formatters.set(tz, f);
  }
  return formatters.get(tz)!;
}

/** UTC offset (s, east positive) in force at `epochMs`. */
export function zoneOffsetAtS(zone: Zone, epochMs: number): number {
  const f = zone.tz ? formatter(zone.tz) : null;
  if (!f) return zone.tzOffsetS;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(epochMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return Math.round((wall - Math.floor(epochMs / 1000) * 1000) / 1000);
}

/** Local calendar day number (days since 1970-01-01) holding `epochMs`. */
export const zoneDayIndex = (epochMs: number, zone: Zone): number => Math.floor((Math.floor(epochMs / 1000) + zoneOffsetAtS(zone, epochMs)) / DAY_S);

/**
 * Local wall-clock seconds (as if UTC) → epoch ms, like Java's `LocalDateTime.atZone`: the offset in force at that
 * local time; in an autumn overlap the earlier instant; in a spring gap the time moves forward by the gap.
 */
export function zoneWallToMs(localS: number, zone: Zone): number {
  const before = zoneOffsetAtS(zone, (localS - DAY_S) * 1000);
  const after = zoneOffsetAtS(zone, (localS + DAY_S) * 1000);
  const valid = [localS - before, localS - after].filter((t) => zoneOffsetAtS(zone, t * 1000) === localS - t);
  return (valid.length ? Math.min(...valid) : localS - before) * 1000;
}

/** Epoch ms of the start of local day `day` (`atStartOfDay(zone)`). */
export const zoneMidnightMs = (day: number, zone: Zone): number => zoneWallToMs(day * DAY_S, zone);
