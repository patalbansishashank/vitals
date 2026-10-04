/**
 * safety — turning the hit matrix into `SimWarning`s (docs/MODEL_SPEC.md §7.2; runs of hits merged into day ranges).
 *
 * Runs: consecutive hit days form one run; a gap of at most one day is bridged ("gap ≤ 1 day"), a longer gap closes the
 * run. `peakValue` is the worst driving value inside the run (min or max per rule). Messages: the rule's template with
 * its placeholders filled from the peak value (and, for rules whose second number varies by day, from the peak day).
 * Runs at finalize time only: allocation is allowed here.
 */
import type { Severity, SimWarning, WarningRuleId } from '../../types/events';
import { MAX_MESSAGE_CHARS, N_RULES, RULES, RULE_INDEX as X } from './rules';
import type { SafetyK, SafetyState } from './state';

/** Number → text with at most `dp` decimals and no trailing zeros; non-finite → "?". */
export function fmtNum(x: number, dp: number): string {
  if (!Number.isFinite(x)) return '?';
  const r = Number(x.toFixed(dp));
  return String(Object.is(r, -0) ? 0 : r);
}

/** Fill a rule template. `values` maps placeholder name → text; unknown placeholders become "?". Result ≤ 200 chars. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  const out = template.replace(/\{([^}]+)\}/g, (_m, key: string) => values[key] ?? '?');
  if (out.length <= MAX_MESSAGE_CHARS) return out;
  // last resort (a placeholder rendered unusually wide): cut at the last word boundary that fits
  const cut = out.slice(0, MAX_MESSAGE_CHARS - 1);
  const sp = cut.lastIndexOf(' ');
  return `${cut.slice(0, sp > 100 ? sp : cut.length)}…`;
}

/** Placeholder values of rule `ruleIndex` for a run whose worst value is `peak`, reached on day `peakDay`. */
export function placeholderValues(
  s: SafetyState,
  k: SafetyK,
  ruleIndex: number,
  peak: number,
  peakDay: number,
): Record<string, string> {
  const id = RULES[ruleIndex]!.id;
  const v: Record<string, string> = {};
  switch (id) {
    case 'W-E01':
      v.EI = fmtNum(peak, 0);
      v.floor = fmtNum(k.isFemale ? k.floorFemaleKcal : k.floorMaleKcal, 0);
      break;
    case 'W-E03':
      v.d = fmtNum(peak, 0);
      v.cap = fmtNum(s.capDefD[peakDay] ?? Number.NaN, 0);
      break;
    case 'W-E05':
      v.r = fmtNum(peak, 2);
      v.cap = fmtNum(s.capPctD[peakDay] ?? Number.NaN, 2);
      break;
    case 'W-E07':
    case 'W-E08':
    case 'W-E09':
      v.EA = fmtNum(peak, 1);
      break;
    case 'W-E10':
      v.n = fmtNum(Math.floor(peak / 7), 0);
      break;
    case 'W-E11':
      v.x = fmtNum(peak, 1);
      break;
    case 'W-E13':
      v.bmi = fmtNum(peak, 1);
      break;
    case 'W-E15':
    case 'W-E16':
    case 'W-20-FAST-LEAN':
      v.bf = fmtNum(peak, 1);
      break;
    case 'W-M01':
    case 'W-M02':
      v.p = fmtNum(peak, 2);
      break;
    case 'W-M06':
      v.f = fmtNum(peak, 0);
      break;
    case 'W-M11':
      v.x = fmtNum(peak, 1);
      break;
    case 'W-X01':
      v.x = fmtNum(peak, 0);
      break;
    case 'W-X03':
      v.n = fmtNum(peak, 0);
      break;
    case 'W-S01':
      v.g = fmtNum(peak, 2);
      break;
    case 'W-S03':
      v['102/88'] = fmtNum(k.isFemale ? k.waistCautionFemaleCm : k.waistCautionMaleCm, 0);
      break;
    case 'W-13-ALPERT':
      v.d = fmtNum(peak, 0);
      v.cap = fmtNum(s.alpertCapD[peakDay] ?? Number.NaN, 0);
      break;
    case 'W-05-KETO-FED':
      v.x = fmtNum(peak, 1);
      break;
    case 'W-01-FATFLOOR':
      v.fm = fmtNum(peak, 1);
      break;
    default:
      break;
  }
  return v;
}

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { danger: 0, caution: 1, info: 2 };

/**
 * Rules whose message prints the driving value next to its limit at the same precision: a run whose worst value renders
 * equal to the limit is within rounding of it ("Your deficit (734 kcal/day) is above about 734 kcal/day", QA 2026-09-30)
 * and is suppressed — the rule compares unrounded values, the message would contradict itself.
 */
const PEAK_VS_LIMIT: Readonly<Record<string, readonly [string, string]>> = {
  'W-E03': ['d', 'cap'],
  'W-E05': ['r', 'cap'],
  'W-13-ALPERT': ['d', 'cap'],
};

function pushRun(
  out: SimWarning[],
  s: SafetyState,
  k: SafetyK,
  ri: number,
  start: number,
  end: number,
  pk: number,
  pkDay: number,
): void {
  const rule = RULES[ri]!;
  const values = placeholderValues(s, k, ri, pk, pkDay);
  const pair = PEAK_VS_LIMIT[rule.id];
  if (pair && values[pair[0]] === values[pair[1]]) return;
  out.push({
    id: rule.id as WarningRuleId,
    severity: rule.severity,
    startDay: start,
    endDay: end,
    peakValue: pk,
    message: fillTemplate(rule.template, values),
    src: rule.sources
      .map((s) => s.legacy)
      .filter(Boolean)
      .join(', '),
    sources: rule.sources,
  });
}

/** Merge the hit matrix into warnings (sorted by start day, then severity, then rule order). */
export function buildWarnings(s: SafetyState, k: SafetyK): SimWarning[] {
  const out: SimWarning[] = [];
  const nDays = s.nDays;
  const last = s.lastDay;
  if (last < 0) return out;
  for (let ri = 0; ri < N_RULES; ri++) {
    if (s.ruleHit[ri] === 0) continue;
    const isMin = RULES[ri]!.worst === 'min';
    const row = ri * nDays;
    let start = -1;
    let end = -1;
    let pk = 0;
    let pkDay = 0;
    for (let d = 0; d <= last; d++) {
      if (s.hit[row + d] === 0) continue;
      const v = s.peak[row + d]!;
      if (start >= 0 && d - end <= 2) {
        end = d;
        if (isMin ? v < pk : v > pk) {
          pk = v;
          pkDay = d;
        }
      } else {
        if (start >= 0) pushRun(out, s, k, ri, start, end, pk, pkDay);
        start = d;
        end = d;
        pk = v;
        pkDay = d;
      }
    }
    if (start >= 0) pushRun(out, s, k, ri, start, end, pk, pkDay);
  }
  out.sort(
    (a, b) =>
      a.startDay - b.startDay ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (X[a.id as keyof typeof X] ?? 0) - (X[b.id as keyof typeof X] ?? 0),
  );
  return out;
}
