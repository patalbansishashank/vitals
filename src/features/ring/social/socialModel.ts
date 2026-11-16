/**
 * (social-time) Social time, said in the quiet, non-judging voice (no mascot, no shame): today's total minutes against
 * the person's daily target band (30–45 by default). Calm at or below the low edge, warming toward the high edge, "over
 * your budget" past it. The same current-day source serves the card and the page; the engine's local `social.today` is
 * the provisional number until the server has the day. Pure.
 */
import type { RangeBand } from '@/components';
import { socialAppLabel, type GaugeSocialTimeDay } from '@/net/gaugeSocial';
import type { EngineSocial } from './socialEngine';

export type SocialPlacement = 'within' | 'nearing' | 'over';

/** Whole minutes from seconds (a few seconds never reads as a minute: round). */
export const socialMinutes = (totalSeconds: number): number => Math.round(totalSeconds / 60);

/** Where the day's minutes sit against the target band. */
export function socialPlacement(minutes: number, min: number, max: number): SocialPlacement {
  if (minutes > max) return 'over';
  if (minutes > min) return 'nearing';
  return 'within';
}

/** The band word: within / near / over your budget. */
export function socialWord(minutes: number, min: number, max: number, words: { within: string; nearing: string; over: string }): string {
  return words[socialPlacement(minutes, min, max)];
}

/** The RangeScale's upper bound: the target's high edge plus headroom, rounded up to cover a heavy day. */
export function socialScaleMax(minutes: number, max: number): number {
  return Math.max(60, max + 15, Math.ceil(minutes / 15) * 15);
}

/** The three bands for the RangeScale (a mark and a word each; the marker itself stays ivory). */
export function socialBands(min: number, max: number, words: { within: string; nearing: string; over: string }): RangeBand[] {
  return [
    { from: -Infinity, word: words.within, severity: 'ok' },
    { from: min, word: words.nearing, severity: 'caution' },
    { from: max, word: words.over, severity: 'caution' },
  ];
}

/**
 * The current-day source for the overview and the page: the server's day when it has it (the source of truth), otherwise
 * this phone's running total for today (the provisional number). Null when neither has the day.
 */
export function displaySocialDay(date: string, remote: GaugeSocialTimeDay | null, local: EngineSocial | null, isToday: boolean): GaugeSocialTimeDay | null {
  if (remote) return remote;
  if (isToday && local?.today && local.today.date === date) {
    return {
      date,
      totalSeconds: local.today.totalSeconds,
      perApp: local.today.perApp,
      targetMinMinutes: local.targetMinMinutes,
      targetMaxMinutes: local.targetMaxMinutes,
    };
  }
  return null;
}

/** True when the day's number is this phone's running total, not the server's (shown labelled as provisional). */
export const isProvisional = (remote: GaugeSocialTimeDay | null, isToday: boolean, local: EngineSocial | null): boolean =>
  !remote && isToday && !!local?.today;

export interface SocialAppRow {
  id: string;
  label: string;
  minutes: number;
  share: number;
  valueText: string;
  hue: string;
}

/** The per-app split, most time first, for the (i) panel. Apps with no time that day are left out (the wire omits them). */
export function socialAppRows(day: GaugeSocialTimeDay): SocialAppRow[] {
  const total = day.totalSeconds || 0;
  return Object.entries(day.perApp)
    .map(([id, seconds]) => ({ id, label: socialAppLabel(id), seconds }))
    .filter((x) => x.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .map((x, i) => ({
      id: x.id,
      label: x.label,
      minutes: socialMinutes(x.seconds),
      share: total > 0 ? x.seconds / total : 0,
      valueText: `${socialMinutes(x.seconds)} min`,
      hue: i === 0 ? 'var(--lm-hue-videos)' : 'var(--lm-hue-videos-ink)',
    }));
}
