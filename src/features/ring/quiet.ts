/**
 * Quiet mode on the Ring's cards (0.6.3): words only, no digits, to assistive technology too — the way the rest of the
 * app says quiet values (a word for where a value sits: "Goal met", "about your goal", "Near usual"; times of day as
 * parts of the day; ages and syncs as "recently" / "earlier today"). Pure.
 */

const HOUR_MS = 3_600_000;

/** The local hour of an instant (fractional). */
function hourOf(at: string | number): number | null {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60;
}

/** A time of day as words: "in the night", "early in the morning", "in the morning", "in the afternoon", "in the evening", "late in the evening". */
export function partOfDay(at: string | number): string {
  const h = hourOf(at);
  if (h === null) return 'at some point';
  if (h < 5) return 'in the night';
  if (h < 8) return 'early in the morning';
  if (h < 12) return 'in the morning';
  if (h < 17) return 'in the afternoon';
  if (h < 21) return 'in the evening';
  return 'late in the evening';
}

/** "Fell asleep late in the evening · Woke early in the morning" (the night's caption in words). */
export function quietNightFact(onset: string | null | undefined, wake: string | null | undefined, start: string, end: string): string {
  return `Fell asleep ${partOfDay(onset ?? start)} · Woke ${partOfDay(wake ?? end)}`;
}

/** Asleep against the goal as a word: "Goal met", "Just short of the goal", "Short of the goal", "Well short of the goal". */
export function sleepGoalWord(asleepMin: number, goalMin: number, possibleMin = asleepMin): string {
  if (!(goalMin > 0) || !Number.isFinite(asleepMin) || (asleepMin < goalMin && possibleMin >= goalMin)) return 'Goal unclear';
  const r = asleepMin / goalMin;
  if (r >= 1) return 'Goal met';
  if (r >= 0.94) return 'Just short of the goal';
  if (r >= 0.8) return 'Short of the goal';
  return 'Well short of the goal';
}

/** A reading's age in words: "just now" · "recently" · "earlier today" · "a while ago". */
export function quietAge(ageMin: number): string {
  if (!Number.isFinite(ageMin)) return 'a while ago';
  if (ageMin < 1) return 'just now';
  if (ageMin < 60) return 'recently';
  if (ageMin < 18 * 60) return 'earlier today';
  return 'a while ago';
}

/** "Synced just now" · "Synced recently" · "Synced earlier today" · "Synced a while ago" · "Not synced yet". */
export function quietSynced(lastUploadAt: string | null | undefined, now: number): string {
  if (!lastUploadAt) return 'Not synced yet';
  const ms = Date.parse(lastUploadAt);
  if (!Number.isFinite(ms)) return 'Not synced yet';
  return `Synced ${quietAge(Math.max(0, (now - ms) / 60_000))}`;
}

/** A label that already reads as words, or null when it carries a figure (quiet mode then leaves it out). */
export function wordsOnly(text: string | null | undefined): string | null {
  return text && !/\d/.test(text) ? text : null;
}

/** "Updated 13:20" in words. */
export function quietUpdated(at: string | number, now: number): string {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  return Number.isFinite(ms) && now - ms < HOUR_MS ? 'Updated recently' : `Updated ${partOfDay(ms)}`;
}

/**
 * A duration in words (r063 FX3: quiet detail pages and the recording banner): "under a minute" · "a few minutes" ·
 * "about a quarter of an hour" · "about half an hour" · "about three quarters of an hour" · "about an hour" · "over an
 * hour" · "a few hours".
 */
export function quietDuration(min: number): string {
  if (!Number.isFinite(min) || min < 1) return 'under a minute';
  if (min < 10) return 'a few minutes';
  if (min < 22) return 'about a quarter of an hour';
  if (min < 38) return 'about half an hour';
  if (min < 52) return 'about three quarters of an hour';
  if (min < 75) return 'about an hour';
  if (min < 150) return 'over an hour';
  return 'a few hours';
}

/** How many of the days something held, in words: "every day" · "most days" · "some days" · "no days". */
export function quietDays(n: number, of: number): string {
  if (!(of > 0) || !(n > 0)) return 'no days';
  if (n >= of) return 'every day';
  if (n * 2 >= of) return 'most days';
  return 'some days';
}
