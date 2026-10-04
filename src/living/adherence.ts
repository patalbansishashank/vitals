/**
 * Daily adherence score (docs/SUITE_SPEC.md §3.7; R11 §4; PLANNER_V2 §8.6).
 *
 *   score = 100 · Σ w_i c_i / Σ w_i   over items with KNOWN status (logged, device-covered or marked as planned)
 *
 * w_i = the version's counterfactual item weights (floor 0.02, renormalised over the day's items; `prescription.ts`), c_i ∈
 * [0, 1] = benefit retained. Unknown items drop out of both sums (missing ≠ failed); `coverage` = known weight share; < 0.6
 * is shown as "based on 3 of 5 items", < 0.4 gives no score; assumed (backfilled) days are never scored. The owner's
 * example: all done → 100; one skipped item of weight 0.2 → 80; an equivalent swap → 100.
 *
 * Credits use the fast forms of §3.7 (energy ±5 %/±75 kcal then a taper by the planned balance, protein −10 %, sessions by
 * equivalence, fasts by hours beyond the overnight gap, steps/sleep proportional, supplements 0/1). When E6's
 * `benefitRetained` is available the caller passes its value instead (`ItemCreditOverride`). Also: rolling trend A_7/A_28,
 * revealed adherence (Beta posteriors per item type and weekday) and the swap/weekday rules for the planner. Pure.
 */
import { addDays, daysBetween, weekdayOf } from './dates';
import type { BlockAdherence, PlanItemType } from './plannerContract';
import type { AdherenceItemScore, AdherenceScore, AdherenceTrend, LocalDate, PrescribedItem, Weekday } from './types';

// ------------------------------------------------------------------------------------------- constants (single exports)
/** Coverage below which no score is given, and below which the score is labelled "based on k of n items" (§3.7). */
export const COVERAGE_NO_SCORE = 0.4;
export const COVERAGE_LABEL = 0.6;
/** Energy tolerance: ±5 % of the target, at least ±75 kcal (§3.7, R4 §3.5). */
export const ENERGY_TOL_REL = 0.05;
export const ENERGY_TOL_MIN_KCAL = 75;
/** Smallest balance the energy taper spreads over, kcal/d (a maintenance-day prescription still tapers). */
export const ENERGY_TAPER_MIN_KCAL = 150;
/** Share of credit an over-delivery in the "harmless" direction can cost at most (deep undershoot on a deficit day). */
export const ENERGY_SAFE_SIDE_MAX_LOSS = 0.5;
/** Protein: full credit from 90 % of the target up (overshoot scores 1). */
export const PROTEIN_FULL_FRAC = 0.9;
/** Fasts: benefits accrue beyond the habitual overnight gap (h); a fast broken at 18 of 24 h earns (18−12)/(24−12) = 0.5. */
export const FAST_BASE_H = 12;
/** Window: grace around the eating window, h. */
export const WINDOW_GRACE_H = 0.5;
/** Credit of a T0 "partly" mark without detail. */
export const PARTLY_CREDIT = 0.5;
/** Revealed adherence (R11 §4.3): prior Beta(6, 2), forgetting half-life 21 d; swap/weekday rules (PLANNER_V2 §7.6). */
export const BETA_PRIOR = { a: 6, b: 2 } as const;
export const BETA_HALF_LIFE_D = 21;
export const SWAP_MIN_OPPORTUNITIES = 8;
export const SWAP_MEAN_BELOW = 0.5;
export const SWAP_UPPER80_BELOW = 0.7;
export const WEEKDAY_CREDIT_BELOW = 0.4;
/** Trend (§3.7): A_7 needs ≥ 3 scored days; A_28 is an EWMA with half-life 14 d; arrow beyond ±5 points. */
export const A7_MIN_DAYS = 3;
export const A28_HALF_LIFE_D = 14;
export const TREND_ARROW_POINTS = 5;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// ------------------------------------------------------------------------------------------- credit fast forms
/**
 * Energy credit. Inside ±max(5 %, 75 kcal) → 1. Outside, the direction that undoes the planned balance (eating more on a
 * deficit day, less on a surplus day) tapers linearly to 0 when the whole planned balance is lost; the other direction
 * costs at most `ENERGY_SAFE_SIDE_MAX_LOSS` (more deficit is not more adherence, but it does not undo progress). A
 * maintenance day tapers both ways over `ENERGY_TAPER_MIN_KCAL`.
 */
export function energyCredit(targetKcal: number, actualKcal: number, maintenanceKcal?: number): number {
  if (!(targetKcal > 0) || !Number.isFinite(actualKcal)) return actualKcal <= 50 && targetKcal <= 50 ? 1 : 0;
  const tol = Math.max(ENERGY_TOL_REL * targetKcal, ENERGY_TOL_MIN_KCAL);
  const dev = actualKcal - targetKcal;
  if (Math.abs(dev) <= tol) return 1;
  const balance = maintenanceKcal !== undefined && Number.isFinite(maintenanceKcal) ? targetKcal - maintenanceKcal : 0;
  const span = Math.max(ENERGY_TAPER_MIN_KCAL, Math.abs(balance) - tol);
  const excess = Math.abs(dev) - tol;
  const undoes = balance < -tol ? dev > 0 : balance > tol ? dev < 0 : true;
  if (undoes) return clamp01(1 - excess / span);
  return clamp01(1 - ENERGY_SAFE_SIDE_MAX_LOSS * Math.min(1, excess / span));
}

export function proteinCredit(targetG: number, actualG: number): number {
  if (!(targetG > 0)) return 1;
  return clamp01(actualG / (PROTEIN_FULL_FRAC * targetG));
}

/** Fast credit by hours achieved beyond the overnight gap (meal to meal). */
export function fastCredit(targetH: number, achievedH: number): number {
  if (!(targetH > FAST_BASE_H)) return achievedH >= targetH ? 1 : clamp01(achievedH / Math.max(1, targetH));
  return clamp01((achievedH - FAST_BASE_H) / (targetH - FAST_BASE_H));
}

/**
 * Share of the logged meal energy eaten inside the window (± grace); 1 when nothing was eaten. A window may run past
 * midnight (`endH` > 24, start + length): a meal at 01:00 (clock hour 1) is then also tested as hour 25.
 */
export function windowCredit(startH: number, endH: number, meals: ReadonlyArray<{ clockH: number; kcal: number }>): number {
  let all = 0;
  let inside = 0;
  const within = (h: number) => h >= startH - WINDOW_GRACE_H && h <= endH + WINDOW_GRACE_H;
  for (const m of meals) {
    const k = Math.max(0, m.kcal);
    all += k;
    if (within(m.clockH) || (endH > 24 && within(m.clockH + 24))) inside += k;
  }
  return all > 0 ? inside / all : 1;
}

export const ratioCredit = (target: number, actual: number): number => (target > 0 ? clamp01(actual / target) : 1);

/** Credit of a T0 mark without detail. */
export function markCredit(mark: 'asPlanned' | 'partly' | 'not'): number {
  return mark === 'asPlanned' ? 1 : mark === 'partly' ? PARTLY_CREDIT : 0;
}

// ------------------------------------------------------------------------------------------- day score
export interface ItemCredit {
  itemId: string;
  credit: number | null;
  why: string;
}

/** Score a day from its prescribed items and their credits (null = unknown). */
export function scoreDay(items: readonly PrescribedItem[], credits: readonly ItemCredit[], opts: { final: boolean; assumed?: boolean; paused?: boolean }): AdherenceScore {
  const byId = new Map(credits.map((c) => [c.itemId, c] as const));
  let wAll = 0;
  let wKnown = 0;
  let num = 0;
  const out: AdherenceItemScore[] = [];
  for (const it of items) {
    const c = byId.get(it.itemId);
    const credit = c && c.credit !== null && Number.isFinite(c.credit) ? clamp01(c.credit) : null;
    wAll += it.weight;
    if (credit !== null) {
      wKnown += it.weight;
      num += it.weight * credit;
    }
    out.push({ itemId: it.itemId, type: it.type, weight: it.weight, credit, why: c?.why ?? 'not logged' });
  }
  const coverage = wAll > 0 ? wKnown / wAll : 0;
  const scoreable = !opts.assumed && !opts.paused && coverage >= COVERAGE_NO_SCORE && wKnown > 0;
  // clamp float noise of the renormalised weights (Σw c / Σw can land a hair above 1)
  const score = scoreable ? Math.min(100, Math.max(0, (100 * num) / wKnown)) : null;
  return { score, coverage: Math.min(1, coverage), items: out, final: opts.final };
}

/** "based on 3 of 5 items" when coverage < 0.6 (§3.7); null otherwise. */
export function coverageLabel(s: AdherenceScore): string | null {
  if (s.score === null || s.coverage >= COVERAGE_LABEL) return null;
  const known = s.items.filter((i) => i.credit !== null).length;
  return `based on ${known} of ${s.items.length} items`;
}

/** The item that cost the most points (weight × (1 − credit)), for "the 40-min lift was skipped: it carried 40 %". */
export function costliestItem(s: AdherenceScore): AdherenceItemScore | null {
  let best: AdherenceItemScore | null = null;
  let bestCost = 0;
  for (const i of s.items) {
    if (i.credit === null) continue;
    const cost = i.weight * (1 - i.credit);
    if (cost > bestCost + 1e-12) {
      best = i;
      bestCost = cost;
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------- trend
export interface ScoredDay {
  date: LocalDate;
  score: number | null;
  final: boolean;
  /** Any non-assumed log, mark or weigh-in that day. */
  logged?: boolean;
}

/** A_7, A_28 (EWMA half-life 14 d over scored days), counts, arrow and a spark of the last 14 scored values. */
export function adherenceTrend(days: readonly ScoredDay[], asOf: LocalDate): AdherenceTrend {
  const recent = days.filter((d) => {
    const age = daysBetween(d.date, asOf);
    return age >= 0 && age < 28;
  });
  const scored = recent.filter((d) => d.final && d.score !== null);
  const last7 = scored.filter((d) => daysBetween(d.date, asOf) < 7);
  const a7 = last7.length >= A7_MIN_DAYS ? last7.reduce((s, d) => s + d.score!, 0) / last7.length : null;
  let wSum = 0;
  let sSum = 0;
  for (const d of scored) {
    const w = Math.pow(2, -daysBetween(d.date, asOf) / A28_HALF_LIFE_D);
    wSum += w;
    sSum += w * d.score!;
  }
  const a28 = scored.length >= A7_MIN_DAYS ? sSum / wSum : null;
  const arrow = a7 === null || a28 === null ? null : a7 - a28 > TREND_ARROW_POINTS ? 'up' : a7 - a28 < -TREND_ARROW_POINTS ? 'down' : 'steady';
  const logged7 = new Set(recent.filter((d) => d.logged && daysBetween(d.date, asOf) < 7).map((d) => d.date)).size;
  const spark = [...scored].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-14).map((d) => d.score!);
  return { a7, a28, scored7: last7.length, scored28: scored.length, daysLogged7: logged7, arrow, spark };
}

// ------------------------------------------------------------------------------------------- revealed adherence
export interface CreditObservation {
  date: LocalDate;
  type: PlanItemType;
  credit: number;
}

/**
 * Beta posteriors per item type, and per (type, weekday) with ≥ 1 observation, as of `asOf`: prior Beta(6, 2), fractional
 * updates a += c, b += 1 − c, each observation discounted by 2^(−age/21). Only known, scored (non-assumed) items enter.
 */
export function revealedAdherence(obs: readonly CreditObservation[], asOf: LocalDate, withWeekdays = true): BlockAdherence[] {
  const lambda = (date: LocalDate): number => Math.pow(2, -Math.max(0, daysBetween(date, asOf)) / BETA_HALF_LIFE_D);
  const acc = new Map<string, BlockAdherence>();
  const bump = (key: string, base: Omit<BlockAdherence, 'a' | 'b' | 'opportunities'>, c: number, w: number): void => {
    let x = acc.get(key);
    if (!x) {
      x = { ...base, a: BETA_PRIOR.a, b: BETA_PRIOR.b, opportunities: 0 };
      acc.set(key, x);
    }
    x.a += w * c;
    x.b += w * (1 - c);
    x.opportunities += 1;
  };
  for (const o of [...obs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type < b.type ? -1 : 1))) {
    if (daysBetween(o.date, asOf) < 0) continue;
    const c = clamp01(o.credit);
    const w = lambda(o.date);
    bump(o.type, { type: o.type }, c, w);
    if (withWeekdays) bump(`${o.type}@${weekdayOf(o.date)}`, { type: o.type, weekday: weekdayOf(o.date) as Weekday }, c, w);
  }
  return [...acc.values()].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : (a.weekday ?? -1) - (b.weekday ?? -1)));
}

export const expectedCredit = (b: Pick<BlockAdherence, 'a' | 'b'>): number => b.a / (b.a + b.b);

/** Expected credit of a type (no weekday entry → the type entry → the prior mean 0.75). */
export function expectedCreditFor(blocks: readonly BlockAdherence[], type: PlanItemType, weekday?: number): number {
  const wd = weekday !== undefined ? blocks.find((b) => b.type === type && b.weekday === weekday) : undefined;
  if (wd && wd.opportunities >= 4) return expectedCredit(wd);
  const t = blocks.find((b) => b.type === type && b.weekday === undefined);
  return t ? expectedCredit(t) : BETA_PRIOR.a / (BETA_PRIOR.a + BETA_PRIOR.b);
}

/** Regularised incomplete beta I_x(a, b) (continued fraction, Numerical Recipes). */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lgamma(a + b) - lgamma(a) - lgamma(b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b + lbeta);
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(x, a, b)) / a;
  return 1 - (front * betacf(1 - x, b, a)) / b;
}

function betacf(x: number, a: number, b: number): number {
  const EPS = 1e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function lgamma(z: number): number {
  // Lanczos (g = 7, n = 9)
  const g = 7;
  const C = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lgamma(1 - z);
  const zz = z - 1;
  let x = C[0]!;
  for (let i = 1; i < g + 2; i++) x += C[i]! / (zz + i);
  const t = zz + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Quantile of Beta(a, b) by bisection. */
export function betaQuantile(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface SwapProposal {
  type: PlanItemType;
  rule: 'persistentlySkipped' | 'weekday';
  weekday?: number;
  expected: number;
  upper80?: number;
  text: string;
}

/**
 * PLANNER_V2 §7.6 / R11 §4.3 rules over the revealed-adherence posteriors and the recent credits:
 *  - swap: ≥ 8 opportunities, E[c] < 0.5 and the 80 % upper bound < 0.7 → propose the nearest-equivalent easier prescription;
 *  - weekday: c < 0.4 on ≥ 3 of the last 4 occurrences of a weekday → move the block.
 */
export function adherenceProposals(blocks: readonly BlockAdherence[], recent: readonly CreditObservation[], asOf: LocalDate): SwapProposal[] {
  const out: SwapProposal[] = [];
  for (const b of blocks) {
    if (b.weekday !== undefined || b.opportunities < SWAP_MIN_OPPORTUNITIES) continue;
    const e = expectedCredit(b);
    const up = betaQuantile(0.8, b.a, b.b);
    if (e < SWAP_MEAN_BELOW && up < SWAP_UPPER80_BELOW) out.push({ type: b.type, rule: 'persistentlySkipped', expected: e, upper80: up, text: `An easier version of this part of the plan would fit better.` });
  }
  const byKey = new Map<string, CreditObservation[]>();
  for (const o of recent) {
    if (daysBetween(o.date, asOf) < 0) continue;
    const k = `${o.type}@${weekdayOf(o.date)}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(o);
  }
  for (const [k, list] of [...byKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const last4 = list.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4);
    if (last4.length < 4) continue;
    const low = last4.filter((o) => o.credit < WEEKDAY_CREDIT_BELOW).length;
    if (low >= 3) {
      const [type, wd] = k.split('@') as [PlanItemType, string];
      out.push({ type, rule: 'weekday', weekday: Number(wd), expected: last4.reduce((s, o) => s + o.credit, 0) / 4, text: 'This keeps slipping on the same weekday; moving it may help.' });
    }
  }
  return out;
}

/** Per-type mean credit over [from, to] for the check-in bars. */
export function blockBars(obs: readonly CreditObservation[], from: LocalDate, to: LocalDate): Array<{ type: PlanItemType; mean: number; n: number }> {
  const acc = new Map<PlanItemType, { s: number; n: number }>();
  for (const o of obs) {
    if (o.date < from || o.date > to) continue;
    const x = acc.get(o.type) ?? { s: 0, n: 0 };
    x.s += o.credit;
    x.n += 1;
    acc.set(o.type, x);
  }
  return [...acc.entries()].map(([type, x]) => ({ type, mean: x.s / x.n, n: x.n })).sort((a, b) => (a.type < b.type ? -1 : 1));
}

/** Last `n` dates up to and including `asOf`. */
export function lastDates(asOf: LocalDate, n: number): LocalDate[] {
  return Array.from({ length: n }, (_, k) => addDays(asOf, k - n + 1));
}
