/**
 * Fasting explanations (ruling R-FAST-GATE, 2026-10-01; PLANNER_V2_SPEC §3.6 "a fast was considered and rejected
 * because …"). An option without a fast, when fasting was offered, is compared with the best plan with a fast the search
 * evaluated (the rival): the reason it lost follows the precedence validator, safetyMargin, chance > goalLoss >
 * shortlist > noGoalGain, with the numbers that decided it. An option with a fast says what the fast buys (its "without
 * the N-hour fasts" ablation). Plain language only: no dossier numbers, rule ids or internal names in the text.
 */
import type { PlanningContext } from './context';
import { ruleText } from './explain';
import type { FastingKind, FastingRejectReason, FastingVerdict, GoalScore } from './types';

/** Differences the fasting comparison names (PROPOSED display thresholds). */
export const FAST_COMPARE = {
  /** Smallest goal-level step q_k in desirability units (PLANNER_V2_SPEC §4.3: q_k ≥ 0.01). */
  minStep: 0.01,
  /** Fat loss counts as "the same" within this many kg (about the model's ensemble spread over 12 weeks). */
  sameFatKg: 0.25,
  /** Lean-tissue difference worth naming, kg. */
  leanKg: 0.1,
  /** Hunger-peak difference worth naming, points of the 0-100 index (7-day mean peak). */
  hungerPts: 2,
  /** What a fast buys (the "without the fasts" ablation) is named from this much desirability on a goal. */
  ablationD: 0.02,
} as const;

/** The best plan with a fast, assessed for the comparison (one Simulator-mode run, its search record, checks). */
export interface RivalPlan {
  structureId: string;
  /** Its fasts in plain words ("72-hour fasts", "a weekly 24-hour fast", "zero-energy days"). */
  phrase: string;
  kind: FastingKind;
  longestFastH: number;
  /** Search desirability d̃ per goal and the weighted goal score G of the planner-mode nominal run (final anchors). */
  desirability: ArrayLike<number>;
  goalScore: number;
  /** Safety violation of the search record and the margin ids below zero. */
  vS: number;
  violated: readonly string[];
  /** Independent validator outcome and the Simulator cautions/dangers it may not carry (R-PLAN-SAFETY). */
  valid: boolean;
  unlistable: ReadonlyArray<{ id: string; message: string }>;
  /** P90 chance constraint over the ensemble (null = not checked) and the worst margin id when it fails. */
  chance: { ok: boolean; worst: string | null } | null;
  /** Goal functionals of the Simulator-mode run, metric units (goal order). */
  values: readonly number[];
  fatChange: number;
  leanChange: number;
  hungerPeak: number;
  /** Lowest 7-day energy availability where the Simulator's EA rules apply (kcal/kg FFM/d) and its day index. */
  eaLow: { value: number; day: number } | null;
}

/** The option's side of the comparison. */
export interface OptionSide {
  scorecard: readonly GoalScore[];
  desirability: ArrayLike<number>;
  goalScore: number;
  fatChange: number;
  leanChange: number;
  hungerPeak: number;
  /** The option itself uses a fast (option A's side, for alternatives). */
  usesFast?: boolean;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
export function amount(x: number): string {
  const v = Math.abs(x);
  return v >= 10 ? String(Math.round(v)) : v >= 1 ? r1(v).toFixed(1) : String(Math.round(v * 100) / 100);
}
const signedKg = (x: number) => {
  const r = r1(x);
  return `${r === 0 ? '±' : r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)} kg`;
};
/** A metric label inside a sentence: the first letter lowered unless the label opens with an acronym ("LDL …"). */
export function inSentence(label: string): string {
  return label.length > 1 && label[1] === label[1]!.toLowerCase() ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/** "a", "a and b", "a, b and c". */
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const tidy = (s: string) => s.replace(/ {2,}/g, ' ').replace(/ ([,.)])/g, '$1');

/** Goal-level step q_k = max(0.01, the model's resolution of goal k in desirability units). */
export function goalSteps(minTolerance: ReadonlyArray<number | undefined>, range: ReadonlyArray<number>): Float64Array {
  return Float64Array.from(range, (w, k) => {
    const t = minTolerance[k];
    const q = t !== undefined && Number.isFinite(t) && w > 0 ? t / w : 0;
    return Math.max(FAST_COMPARE.minStep, q);
  });
}

/**
 * Why the rival lost to this option, with the deciding numbers (PLANNER_V2_SPEC §3.6). `q` = goal-level steps (desirability
 * units, goal order). `optionA` = option A's side when this option is an alternative (B, C): a rival that beats this
 * alternative on the goals is explained by how it lost to option A.
 */
export function rivalVerdict(
  ctx: PlanningContext,
  r: RivalPlan,
  o: OptionSide,
  q: ArrayLike<number>,
  optionA: OptionSide | null = null,
): NonNullable<FastingVerdict['rival']> & { text: string } {
  const K = ctx.goals.length;
  const goalDeltas: Array<{ goal: number; delta: number; unit: string }> = [];
  const gains: string[] = [];
  let firstDiff = -1;
  let rivalBetter = false;
  for (let k = 0; k < K; k++) {
    const sc = o.scorecard[k];
    const v = r.values[k];
    const delta = sc && v !== undefined && Number.isFinite(v) ? v - sc.value : NaN;
    if (sc && Number.isFinite(delta)) goalDeltas.push({ goal: k, delta: +delta.toFixed(4), unit: sc.unit });
    const step = q[k] ?? FAST_COMPARE.minStep;
    const lr = Math.floor((r.desirability[k] ?? NaN) / step + 1e-9);
    const lo = Math.floor((o.desirability[k] ?? NaN) / step + 1e-9);
    if (!Number.isFinite(lr) || !Number.isFinite(lo) || lr === lo) continue;
    if (firstDiff < 0) {
      firstDiff = k;
      rivalBetter = lr > lo;
    }
    if (lr > lo && sc && Number.isFinite(delta) && Math.abs(delta) > 1e-9)
      gains.push(`${delta > 0 ? 'raised' : 'lowered'} ${inSentence(sc.label)} by ${amount(delta)} ${sc.unit}`);
  }
  const hungerPeakDelta = Number.isFinite(r.hungerPeak) && Number.isFinite(o.hungerPeak) ? +(r.hungerPeak - o.hungerPeak).toFixed(1) : null;
  const leanTissueDeltaKg = Number.isFinite(r.leanChange) && Number.isFinite(o.leanChange) ? +(r.leanChange - o.leanChange).toFixed(3) : null;
  const fatSame =
    Number.isFinite(r.fatChange) && Number.isFinite(o.fatChange) && Math.min(r.fatChange, o.fatChange) < -FAST_COMPARE.sameFatKg && Math.abs(r.fatChange - o.fatChange) < FAST_COMPARE.sameFatKg;
  const facts: string[] = [];
  if (hungerPeakDelta !== null && hungerPeakDelta >= FAST_COMPARE.hungerPts) facts.push(`higher hunger peaks (+${Math.round(hungerPeakDelta)} points)`);
  if (leanTissueDeltaKg !== null && leanTissueDeltaKg < -FAST_COMPARE.leanKg) facts.push(`${amount(leanTissueDeltaKg)} kg more lean-tissue loss`);
  const sameFat = fatSame ? `the same fat loss within ${amount(Math.max(0.1, Math.abs(r.fatChange - o.fatChange)))} kg (${signedKg(r.fatChange).replace(' kg', '')} vs ${signedKg(o.fatChange)})` : null;
  // what the comparison showed besides the deciding reason (safety texts carry it too)
  const factsAll = sameFat ? [sameFat, ...facts] : facts;
  const alsoAll = factsAll.length ? ` It gave ${list(factsAll)}.` : '';
  const deltaD = +(r.goalScore - o.goalScore).toFixed(4);
  const base = { kind: r.kind, longestFastH: r.longestFastH, structureId: r.structureId, goalDeltas, hungerPeakDelta, leanTissueDeltaKg, deltaD };
  const lead = `A plan with ${r.phrase} was considered`;
  const out = (reason: FastingRejectReason, detail: string, text: string) => ({ ...base, reason, detail, text: tidy(text) });

  // 1. rival unsafe or rejected by the final checks (precedence validator, safetyMargin, chance)
  if (!r.valid) {
    const d = 'the spacing or refeed rules of your fasting tier';
    return out('validator', d, `${lead}, but it broke ${d}.`);
  }
  if (r.unlistable.length) {
    const w = r.unlistable[0]!;
    const t = ruleText(w.id);
    const d = t !== w.id ? t : w.message;
    return out('validator', d, t !== w.id ? `${lead}, but in the Simulator it would break ${t}.` : `${lead}, but the Simulator would warn: “${w.message}”`);
  }
  if (r.vS > 0) {
    const ea = r.violated.some((id) => id === 'HC-E4' || id === 'W-E07') && r.eaLow;
    if (ea) {
      const d = `energy availability ${r1(r.eaLow!.value)} kcal per kg fat-free mass on day ${r.eaLow!.day + 1}`;
      return out('safetyMargin', d, `${lead}, but on training weeks it would take energy availability below the safe floor (${d}).${alsoAll}`);
    }
    const id = r.violated.find((x) => x !== 'abort') ?? null;
    const d = id ? ruleText(id) : 'a safety bound reached during the simulation';
    return out('safetyMargin', d, `${lead}, but it would not keep a safe distance from ${d}.${alsoAll}`);
  }
  if (r.chance && !r.chance.ok) {
    const d = r.chance.worst ? ruleText(r.chance.worst) : 'its safety limits';
    return out('chance', d, `${lead}, but across the model’s uncertainty range it would not stay within ${d}.${alsoAll}`);
  }
  // 2. the ranked goals: worse on the first goal whose level differs
  const also = facts.length ? ` It also meant ${list(facts)}.` : '';
  if (firstDiff >= 0 && !rivalBetter) {
    const sc = o.scorecard[firstDiff];
    const gd = goalDeltas.find((g) => g.goal === firstDiff);
    const label = sc ? `goal ${firstDiff + 1} (${inSentence(sc.label)})` : `goal ${firstDiff + 1}`;
    const d = gd && sc ? `${label} ${amount(gd.delta)} ${sc.unit} ${gd.delta > 0 ? 'higher' : 'lower'}` : label;
    const lost = `${label} would end ${gd && sc ? `${amount(gd.delta)} ${sc.unit} ${gd.delta > 0 ? 'higher' : 'lower'}` : 'worse'}`;
    const text = gains.length ? `${lead}. It ${list(gains)}, but ${lost}, and you ranked that higher.` : `${lead}. ${lost.charAt(0).toUpperCase()}${lost.slice(1)}.`;
    return out('goalLoss', d, `${text}${also}`);
  }
  if (firstDiff >= 0 && rivalBetter && optionA) {
    const vs = gains.length ? ` and ${list(gains)} compared with this plan` : '';
    // option A itself fasts: this plan is the alternative without a fast
    if (optionA.usesFast)
      return out('alternative', 'the Hard plan uses fasting', `${lead}${vs}; the Hard plan uses fasting, and this plan is shown as a distinct alternative without it.`);
    // better than this alternative, but it lost to option A: say how
    const vA = rivalVerdict(ctx, r, optionA, q, null);
    if (vA.reason !== 'shortlist') return out(vA.reason, vA.detail, `${lead}${vs}, but it lost to the Hard plan (${vA.detail}); this plan is shown as a distinct alternative.`);
  }
  if (firstDiff >= 0 && rivalBetter) {
    const d = gains.length ? list(gains) : 'no worse on your goals';
    return out(
      'shortlist',
      d,
      `${lead}${gains.length ? ` and ${list(gains)}` : ''}, but it did not come through the final checks (rounding to practical amounts, the model’s uncertainty range and the choice of distinct options), so this plan was kept.${also}`,
    );
  }
  // 3. tied on every goal level: lost on hunger, lean tissue or complexity
  const same = sameFat ?? 'the same results on your ranked goals';
  const d = facts.length ? list(facts) : 'more fasting days to follow for no gain';
  return out('noGoalGain', d, `${lead}. It gave ${same}, with ${d}, so this plan was kept.`);
}

const NUM_WORDS = ['', 'one', 'two', 'three'];

/**
 * The fasts of a schedule in plain words, counted from its actual fast events (the same source as the card's fasting
 * line) and naming every kind: "3 fasts of 72 hours and 7 fasts of 24 hours (10 in all)", "a 24-hour fast every week (12 in
 * all)", "3 zero-energy days a week".
 */
export function describeFasts(events: readonly { durationH: number }[], zeroDays: number, horizonDays: number): string {
  const groups = new Map<number, number>();
  for (const e of events) {
    const h = Math.round(e.durationH);
    groups.set(h, (groups.get(h) ?? 0) + 1);
  }
  const parts = [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([h, n]) => `${n === 1 ? 'one fast' : `${n} fasts`} of ${h} hours`);
  if (zeroDays) parts.unshift(`${zeroDays} zero-energy day${zeroDays === 1 ? '' : 's'}`);
  if (parts.length === 1 && !zeroDays && groups.size === 1) {
    const [h, n] = [...groups.entries()][0]!;
    if (h <= 24 && n > 2) {
      const perWeek = Math.max(1, Math.round((7 * n) / Math.max(1, horizonDays)));
      return `${perWeek === 1 ? `a ${h}-hour fast every week` : `${NUM_WORDS[perWeek] ?? perWeek} ${h}-hour fasts a week`} (${n} in all)`;
    }
  }
  const total = events.length;
  return parts.length > 1 && events.length > 1 ? `${parts.join(' and ')} (${total} fasts in all)` : parts.join(' and ');
}

/**
 * The fasting verdict of one option. `rival` = the comparison for an option without a fast (when fasting was offered),
 * `without` = what the option's fast buys (its ablation, goal-1-style units), `notEvaluated` = fasting was offered but no
 * plan with a fast could be evaluated.
 */
export function fastingVerdict(
  ctx: PlanningContext,
  kind: FastingKind,
  longestFastH: number,
  what: string,
  rival: (NonNullable<FastingVerdict['rival']> & { text: string }) | null,
  without: { label: string; goal: number; delta: number } | null,
): FastingVerdict {
  const used = kind === 'fast24' || kind === 'zeroDays' || kind === 'multiDay';
  const tre = kind === 'eatingWindow' ? ' Its short daily eating window is time-restricted eating, not a fast.' : '';
  if (!used) {
    if (!ctx.fastingRelevant) return { used, kind, longestFastH, text: tidy(`Fasting was not considered: ${ctx.fastingReason}.${tre}`) };
    if (!rival)
      return { used, kind, longestFastH, text: tidy(`Fasting was considered because ${ctx.fastingReason}, but no plan with a fast was evaluated within the search budget.${tre}`) };
    const { text, ...r } = rival;
    return { used, kind, longestFastH, text: tidy(`Fasting was considered because ${ctx.fastingReason}. ${text}${tre}`), rival: r };
  }
  let text = `Includes ${what} because ${ctx.fastingReason}.`;
  const g = without ? ctx.goals[without.goal] : undefined;
  if (without && g)
    text += ` ${without.label.charAt(0).toUpperCase()}${without.label.slice(1)}, ${inSentence(g.def.label)} would be about ${amount(without.delta)} ${g.def.unit} ${without.delta > 0 ? 'lower' : 'higher'}.`;
  text += ' The fast days follow your fasting tier’s spacing and refeed rules; at the same weekly deficit fasting gives no extra fat loss and costs some lean tissue.';
  return { used, kind, longestFastH, text: tidy(text) };
}
