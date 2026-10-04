/**
 * Engine warnings (MODEL_SPEC §7.2, dossier 17 §3) → the Warnings panel: grouped by severity, each with a short
 * risk-first title (DESIGN_DIRECTION §7 "risk first, then what to do, then the option"), the engine's own ≤ 200-char
 * message as the body, the affected days, and — where the rule implies one — a one-tap remedy that jumps to the
 * offending days in the schedule. Always-on notes (W-U*) are kept apart as "about this projection".
 *
 * The day range and the message are the engine's, shown as they are (QA 2026-10-01): `startDay`/`endDay` are 0-based
 * inclusive day indices, displayed 1-based ("days 1–14" for 0–13) and handed to the schedule unchanged (`?days=0-13`);
 * nothing here re-offsets a range or re-derives a duration from it. A rule computed over a 7-day mean says so in its
 * message ("Averaged over the last 7 days, …"); that note is part of the body, verbatim. Titles only restate the
 * engine's driving value (`peakValue`) with the engine's own rounding, or a fixed risk phrase.
 */
import type { SimWarning, Severity } from '@/engine';
import type { SourceRef } from '@/content/evidence/schema';
import { formatNumber } from '@/components';

export interface WarningRemedy {
  /** Key caption: specific, a verb first ("Adjust energy on days 4–21"). */
  label: string;
  /** Schedule days to pre-select (inclusive). */
  startDay: number;
  endDay: number;
  /** Rule id, forwarded to the schedule so it can offer the matching edit. */
  ruleId: string;
}

export interface WarningItem {
  key: string;
  id: string;
  severity: Severity;
  title: string;
  body: string;
  startDay: number;
  endDay: number;
  /** "days 4–21" (1-based, what the schedule shows). */
  daysText: string;
  remedy?: WarningRemedy;
  /** The evidence behind the message: topic and source numbers, rendered as links into the Evidence library. */
  sources: readonly SourceRef[];
  /** Maintainers' research-note pointer. Never rendered: the panel shows `sources`. */
  src: string;
}

export interface WarningGroups {
  danger: WarningItem[];
  caution: WarningItem[];
  info: WarningItem[];
  /** Always-on notes about the projection itself (W-U01 … W-U05). */
  notes: WarningItem[];
  counts: { danger: number; caution: number; info: number };
}

const one = (v: number) => formatNumber(v, 1);
const int = (v: number) => formatNumber(Math.round(v), 0);

/** "day 4" / "days 4–21" (1-based). */
export function daysText(startDay: number, endDay: number): string {
  return startDay === endDay ? `day ${startDay + 1}` : `days ${startDay + 1}–${endDay + 1}`;
}

type TitleFn = (w: SimWarning) => string;

/** Risk-first titles with the rule's driving value. Falls back to the message's first sentence. */
const TITLES: Record<string, TitleFn> = {
  'W-E01': (w) => `Average intake about ${int(w.peakValue)} kcal a day.`,
  // no duration from the range: W-E02 starts on the 3rd consecutive day, so the range is not the length of the run
  'W-E02': () => 'Under 800 kcal a day.',
  'W-E03': (w) => `Your deficit reaches ${int(w.peakValue)} % of maintenance.`,
  'W-E04': (w) => `A deficit of ${int(w.peakValue)} % of maintenance.`,
  'W-E05': (w) => `About ${one(w.peakValue)} % of body weight lost per week.`,
  'W-E06': (w) => `More than 1.5 kg lost per week (${one(w.peakValue)} kg).`,
  'W-E07': (w) => `Energy availability near ${one(w.peakValue)} kcal/kg lean mass for weeks.`,
  'W-E08': (w) => `Energy availability falls to ${one(w.peakValue)} kcal/kg lean mass.`,
  'W-E09': (w) => `Energy availability is reduced (${one(w.peakValue)} kcal/kg lean mass).`,
  // the engine's {n}: whole weeks of the run (peakValue = consecutive days), floored as in its message
  'W-E10': (w) => `A deficit of 15 % or more for ${formatNumber(Math.floor(w.peakValue / 7), 0)} weeks.`,
  'W-E11': (w) => `Total loss reaches ${one(w.peakValue)} % of your starting weight.`,
  'W-E12': () => 'Total loss over 24 % of your starting weight.',
  'W-E13': (w) => `BMI reaches ${one(w.peakValue)}.`,
  'W-E14': (w) => `BMI falls below 18.5 (${one(w.peakValue)}).`,
  'W-E15': (w) => `Body fat falls to about ${one(w.peakValue)} %.`,
  'W-E16': (w) => `Body fat falls to about ${one(w.peakValue)} %.`,
  'W-E17': () => 'Fast loss can cause temporary hair shedding.',
  'W-E18': () => 'Watch for changes in your cycle.',
  'W-E19': () => 'Long restriction lowers bone density slightly.',
  'W-E20': () => 'Low energy availability for more than two weeks.',
  'W-M01': (w) => `Protein of ${one(w.peakValue)} g/kg is below the adult minimum.`,
  'W-M02': (w) => `Protein of ${one(w.peakValue)} g/kg is low for a deficit.`,
  'W-M03': (w) => `Protein reaches ${int(w.peakValue)} % of energy.`,
  'W-M04': () => 'Protein above 3.1 g/kg lean mass.',
  'W-M05': () => 'High protein with kidney disease.',
  'W-M06': (w) => `Fat is about ${int(w.peakValue)} g a day.`,
  'W-M07': () => 'Very little fat during rapid loss.',
  'W-M08': () => 'Net carbs under 50 g: the model enters ketosis.',
  'W-M09': () => 'Four weeks or more of very-low carbohydrate.',
  'W-M10': () => 'Very-low carbohydrate with a listed condition or medicine.',
  'W-M11': (w) => `Fibre about ${one(w.peakValue)} g per 1000 kcal.`,
  'W-M12': () => 'Salt loss in the first days of fasting or very-low carbohydrate.',
  'W-M13': () => 'Sodium above 2.3 g a day for months.',
  'W-M14': () => 'Fluid intake looks low.',
  'W-M15': () => 'Very high fluid intake.',
  'W-M17': () => 'Magnesium supplement above 350 mg a day.',
  'W-M18': () => 'More than 14 units of alcohol a week.',
  'W-M20': () => 'More than 2 drinks on one occasion.',
  'W-M21': () => 'High caffeine intake.',
  'W-M22': () => 'Caffeine close to bedtime.',
  // fasting tiers by their band: peakValue counts zero-intake hours (a 72 h meal-to-meal fast peaks at 71), so printing it
  // would contradict the fast the schedule shows
  'W-F01': () => 'A fast of up to 24 h.',
  'W-F02': () => 'A fast of 24–48 h.',
  'W-F03': () => 'A fast of 48–72 h.',
  'W-F04': () => 'A water-only fast of 3–7 days.',
  'W-F05': () => 'A water-only fast longer than 7 days.',
  'W-F06': () => 'A fast of 48 h or more without electrolytes.',
  'W-F07': () => 'Long fasts are close together.',
  'W-F08': () => 'A fast of 72 h or more with no refeed plan.',
  'W-F09': () => 'Hard training during a fast of 24 h or more.',
  'W-F10': () => 'A long fast while already lean.',
  'W-F11': () => 'Fasting raises uric acid.',
  'W-F12': () => 'Very low intake with high protein share for 3 days or more.',
  'W-F13': () => 'Many long fasts in two weeks.',
  'W-F14': () => 'An eating window under 4 hours.',
  'W-S01': (w) => `Gaining about ${one(w.peakValue)} % of body weight per week.`,
  'W-S02': () => 'A surplus over 20 % for more than 12 weeks.',
  'W-13-ALPERT': () => 'The deficit is larger than fat stores can supply.',
  'W-05-KETO-FED': (w) => `Ketones reach ${one(w.peakValue)} mmol/L while eating.`,
  'W-20-FAST-LEAN': () => 'A long fast while already lean.',
};

type RemedyFn = (w: SimWarning) => string | null;
const range = (w: SimWarning) => daysText(w.startDay, w.endDay);

/** Remedy captions (the key jumps to the schedule with these days selected). Null = no schedule remedy. */
const REMEDIES: Array<[RegExp, RemedyFn]> = [
  [/^W-E0[1-6]$|^W-E1[0-2]$|^W-13-ALPERT$|^W-E17$|^W-F12$/, (w) => `Adjust energy on ${range(w)}`],
  [/^W-E0[7-9]$|^W-E18$|^W-E20$/, (w) => `Eat more or train less on ${range(w)}`],
  [/^W-M0[1-2]$/, (w) => `Raise protein on ${range(w)}`],
  [/^W-M0[3-4]$/, (w) => `Lower protein on ${range(w)}`],
  [/^W-M0[6-7]$/, (w) => `Add fat on ${range(w)}`],
  [/^W-M09$|^W-M10$/, (w) => `Review carbohydrate on ${range(w)}`],
  [/^W-M11$/, (w) => `Add fibre on ${range(w)}`],
  [/^W-M12$/, (w) => `Add salt on ${range(w)}`],
  [/^W-M1[4-5]$/, (w) => `Adjust fluids on ${range(w)}`],
  [/^W-F0[2-5]$|^W-F13$|^W-F07$|^W-20-FAST-LEAN$/, (w) => `Shorten the fast on ${range(w)}`],
  [/^W-F06$/, (w) => `Add electrolytes on ${range(w)}`],
  [/^W-F08$/, (w) => `Plan a refeed after ${range(w)}`],
  [/^W-F09$/, (w) => `Move hard training off ${range(w)}`],
  [/^W-F14$/, (w) => `Widen the eating window on ${range(w)}`],
  [/^W-S0[1-2]$/, (w) => `Lower the surplus on ${range(w)}`],
  [/^W-X0[1-3]$/, (w) => `Ease training on ${range(w)}`],
];

function firstSentence(msg: string): { title: string; rest: string } {
  const m = /^(.+?[.:])\s+(.*)$/s.exec(msg);
  if (!m) return { title: msg, rest: '' };
  return { title: m[1]!.replace(/:$/, '.'), rest: m[2]! };
}

export function warningTitle(w: SimWarning): string {
  const fn = TITLES[w.id];
  if (fn) {
    const t = fn(w);
    if (!/NaN|—/.test(t)) return t;
  }
  return firstSentence(w.message).title;
}

export function warningRemedy(w: SimWarning): WarningRemedy | undefined {
  if (w.severity === 'info' && !/^W-M0[12]$|^W-M11$/.test(w.id)) return undefined;
  for (const [re, fn] of REMEDIES) {
    if (re.test(w.id)) {
      const label = fn(w);
      return label ? { label, startDay: w.startDay, endDay: w.endDay, ruleId: w.id } : undefined;
    }
  }
  return undefined;
}

export const isProjectionNote = (w: Pick<SimWarning, 'id'>): boolean => /^W-U0\d$/.test(w.id);

export function toWarningItem(w: SimWarning, k = 0): WarningItem {
  const title = warningTitle(w);
  const authored = Boolean(TITLES[w.id]);
  // with an authored title the whole message is the body; with a derived one, the rest of the message
  const body = authored ? w.message : firstSentence(w.message).rest || w.message;
  return {
    key: `${w.id}-${w.startDay}-${k}`,
    id: w.id,
    severity: w.severity,
    title,
    body,
    startDay: w.startDay,
    endDay: w.endDay,
    daysText: daysText(w.startDay, w.endDay),
    remedy: warningRemedy(w),
    sources: w.sources ?? [],
    src: w.src,
  };
}

/** Group by severity (danger first), each by first affected day; always-on notes apart. */
export function groupWarnings(warnings: readonly SimWarning[]): WarningGroups {
  const out: WarningGroups = { danger: [], caution: [], info: [], notes: [], counts: { danger: 0, caution: 0, info: 0 } };
  warnings.forEach((w, k) => {
    const it = toWarningItem(w, k);
    if (isProjectionNote(w)) out.notes.push(it);
    else out[w.severity].push(it);
  });
  for (const s of ['danger', 'caution', 'info'] as const) {
    out[s].sort((a, b) => a.startDay - b.startDay || a.id.localeCompare(b.id));
    out.counts[s] = out[s].length;
  }
  return out;
}

/** Toolbar chip text: "1 danger", "2 cautions", or null when nothing needs attention. */
export function chipText(counts: WarningGroups['counts']): { severity: 'danger' | 'caution'; text: string } | null {
  if (counts.danger) return { severity: 'danger', text: `${counts.danger} ${counts.danger === 1 ? 'danger' : 'dangers'}` };
  if (counts.caution) return { severity: 'caution', text: `${counts.caution} ${counts.caution === 1 ? 'caution' : 'cautions'}` };
  return null;
}

/** Danger rules for the acknowledgement gate: one per rule id (first run), title + engine message. */
export function dangerRules(warnings: readonly SimWarning[]): Array<{ id: string; title: string; message: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; title: string; message: string }> = [];
  for (const w of [...warnings].sort((a, b) => a.startDay - b.startDay)) {
    if (w.severity !== 'danger' || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push({ id: w.id, title: warningTitle(w), message: w.message });
  }
  return out;
}
