/**
 * Golden-plan regression helpers (QA items 6, 9, 10; R-PLAN-SAFETY). The golden tests pin plan PROPERTIES, not numbers:
 * option count, safety (independent validator + the Simulator's own run), the prescription ranges a coach could defend
 * from the dossiers, and the priority order of the scorecard. They protect plan quality when the engine is recalibrated.
 */
import { expect } from 'vitest';
import { simulate } from '../../../core/loop';
import type { Schedule } from '../../../types/schedule';
import type { SimulationResult } from '../../../types/result';
import { compileRequest, type PlanningContext } from '../context';
import { mealClocks, mergeDay } from '../dayMath';
import { listableWarning } from '../planner';
import type { PlanOption, PlannerRequest, PlannerResult } from '../types';
import { validatePlan } from '../validate';
import { MEDIUM_MARGIN } from '../../optim/ladder';

/** Measured prescription of one phase of an option (from the schedule and the option's own Simulator-mode run). */
export interface PhaseStats {
  name: string;
  blockId: string;
  startDay: number;
  endDay: number;
  /** True planned balance: intake / maintenance reference at the planned activity (R-MAINT series), %. */
  energyPct: number;
  proteinGPerKg: number;
  rtSessionsPerWeek: number;
  /** Hard sets per muscle group per week (regions all get the same sets in planner sessions). */
  rtSetsPerMuscleWeek: number;
  cardioMinPerWeek: number;
  windowH: number;
}

const WEEK = 7;

/** Days of a phase that are plain eating days (not touched by a fast, not a refeed / low / zero day). */
function plainDays(s: Schedule, from: number, to: number): number[] {
  const touched = new Set<number>();
  for (const e of s.events ?? []) {
    const a = e.startDay * 24 + e.startH;
    const b = a + e.durationH;
    for (let d = Math.floor(a / 24); d <= Math.floor((b - 1e-9) / 24) + 3; d++) touched.add(d);
  }
  const out: number[] = [];
  for (let d = from; d < Math.min(to, s.horizonDays); d++) {
    const t = mergeDay(s.programs[s.days[d]!.program]!, s.days[d]!.override);
    if (touched.has(d) || t.energy.kind !== 'pctMaintenance' || / · (refeed|low-energy|zero-energy) day/.test(t.label)) continue;
    out.push(d);
  }
  return out;
}

export function phaseStats(ctx: PlanningContext, o: PlanOption): PhaseStats[] {
  const s = o.schedule;
  const sim = o.simulation;
  const ei = sim.daily.inEnergy!;
  const ref = sim.daily.inMaintRef!;
  const prot = sim.daily.inProtein!;
  return o.phases
    .filter((p) => p.weeks > 0)
    .map((p) => {
      const days = plainDays(s, p.startDay, p.endDay);
      let e = 0;
      let r = 0;
      let pr = 0;
      for (const d of days) {
        e += ei[d]!;
        r += ref[d]!;
        pr += prot[d]!;
      }
      let rt = 0;
      let sets = 0;
      let cardio = 0;
      for (let d = p.startDay; d < p.endDay; d++) {
        const t = mergeDay(s.programs[s.days[d]!.program]!, s.days[d]!.override);
        for (const x of t.exercise ?? []) {
          if (x.kind === 'resistance') {
            rt++;
            sets += Math.max(0, ...Object.values(x.setsByRegion ?? {}).map((v) => v ?? 0));
          } else cardio += x.durationMin;
        }
      }
      const weeks = (p.endDay - p.startDay) / WEEK;
      const d0 = days[0] ?? p.startDay;
      const mc = mealClocks(mergeDay(s.programs[s.days[d0]!.program]!, s.days[d0]!.override));
      const win = Math.max(...mc) - Math.min(...mc);
      return {
        name: p.name,
        blockId: p.blockId,
        startDay: p.startDay,
        endDay: p.endDay,
        energyPct: days.length ? (100 * e) / r : NaN,
        proteinGPerKg: days.length ? pr / days.length / ctx.caps.rwKg : NaN,
        rtSessionsPerWeek: rt / weeks,
        rtSetsPerMuscleWeek: sets / weeks,
        cardioMinPerWeek: cardio / weeks,
        windowH: win,
      };
    });
}

/**
 * R-PLAN-SAFETY: the same schedule run the way the Simulator runs it (`simulate`, full mode) raises no caution or danger
 * warning unless the plan's own safety notes list it (and then only one its regime carries by choice).
 */
export function expectSimulatorAgrees(req: PlannerRequest, o: PlanOption): SimulationResult {
  const ctx = compileRequest(req);
  const sim = simulate({ ...req.profile, startDate: req.startDate ?? req.profile.startDate }, o.schedule);
  const listed = new Set((o.safetyItems ?? []).map((x) => x.rule).filter(Boolean));
  for (const w of sim.warnings) {
    if (w.severity === 'info') continue;
    expect(listed.has(w.id), `${o.id} ${o.name}: Simulator ${w.severity} ${w.id} (days ${w.startDay + 1}-${w.endDay + 1}) is not in the plan's safety notes`).toBe(true);
    expect(listableWarning(ctx, o.schedule, w.id), `${o.id}: ${w.id} is avoidable and must not occur`).toBe(true);
  }
  return sim;
}

/** Common golden properties: status, ≥ 2 distinct options, independent validation, Simulator agreement, priority order. */
export function expectGoldenBasics(req: PlannerRequest, res: PlannerResult, minOptions = 1): PlanningContext {
  const ctx = compileRequest(req);
  expect(res.status).toBe('ok');
  expect(res.complete).toBe(true);
  // ladder semantics (PLANNER_V2_SPEC §9.6 item 6): "≥ 2 distinct options" became "ladder distinctness passes or each
  // collapse carries a reason" (expectLadder); the options here are the rungs, Hard first
  expect(res.options.length).toBeGreaterThanOrEqual(minOptions);
  if (res.v2) expectLadder(res);
  const sigs = res.options.map((o) => JSON.stringify([o.schedule.programs, o.schedule.days, o.schedule.events ?? []]));
  expect(new Set(sigs).size).toBe(res.options.length);
  expect(new Set(res.options.map((o) => o.name)).size).toBe(res.options.length);
  for (const o of res.options) {
    expect(validatePlan(ctx, o.schedule).ok).toBe(true);
    expectSimulatorAgrees(req, o);
    // names describe measurable composition (no diet brands)
    for (const p of o.phases) expect(`${p.name} ${p.summary} ${p.why}`).not.toMatch(/\bketo\b|paleo|atkins|carnivore|zone diet|5:2|matador|warrior|omad/i);
    // meals on the 15-minute grid, sessions never over a meal
    for (let d = 0; d < o.schedule.horizonDays; d++) {
      const t = mergeDay(o.schedule.programs[o.schedule.days[d]!.program]!, o.schedule.days[d]!.override);
      const meals = t.energy.kind === 'zero' ? [] : mealClocks(t);
      for (const m of meals) expect(Math.abs(m * 4 - Math.round(m * 4)), `meal ${m} on day ${d + 1}`).toBeLessThan(1e-6);
      for (const x of t.exercise ?? []) {
        expect(Math.abs(x.startH * 4 - Math.round(x.startH * 4))).toBeLessThan(1e-6);
        const end = x.startH + (x.durationMin ?? 60) / 60;
        for (const m of meals) expect(m > x.startH - 1e-9 && m < end - 1e-9, `session ${x.startH}-${end} over meal ${m} (day ${d + 1})`).toBe(false);
      }
    }
  }
  // weekly rhythm stable within a phase: the resistance-training weekdays repeat in every full week that no fast touches
  for (const o of res.options) {
    const s = o.schedule;
    const touched = new Set<number>();
    for (const e of s.events ?? []) {
      const a0 = e.startDay * 24 + e.startH;
      for (let d = Math.floor(a0 / 24) - 1; d <= Math.floor((a0 + e.durationH) / 24) + 3; d++) touched.add(d);
    }
    for (const p of o.phases.filter((q) => q.weeks > 0)) {
      let ref: string | null = null;
      for (let w0 = p.startDay; w0 + 7 <= p.endDay; w0 += 7) {
        if ([...Array(7).keys()].some((i) => touched.has(w0 + i))) continue;
        const pat = [...Array(7).keys()]
          .map((i) => ((mergeDay(s.programs[s.days[w0 + i]!.program]!, s.days[w0 + i]!.override).exercise ?? []).some((x) => x.kind === 'resistance') ? 'R' : '-'))
          .join('');
        if (ref === null) ref = pat;
        expect(pat, `${o.id} ${p.name}: training rhythm changes in the week from day ${w0 + 1}`).toBe(ref);
      }
    }
  }
  // label consistency (release check 2026-10-01): the title's energy % is the phases' %, and a "keep" goal gets one verdict
  for (const o of res.options) {
    const m = /\((−|\+)(\d+) %\)/.exec(o.name);
    if (m) {
      const word = m[1] === '−' ? 'Deficit' : 'Surplus';
      expect(o.phases.some((p) => p.name.startsWith(`${word} ${m[2]} %`)), `${o.id} "${o.name}" vs phases ${o.phases.map((p) => p.name).join(' / ')}`).toBe(true);
    }
    for (const sc of o.scorecard) {
      if (sc.keepTolerance === undefined || sc.target === null) continue;
      const drift = ['fatMass', 'bodyFatPct', 'waist', 'scaleWeight'].includes(sc.metric) ? sc.value - sc.target : sc.target - sc.value;
      expect(sc.verdict, `${o.id} ${sc.label} ${sc.change.toFixed(3)}`).toBe(drift <= sc.keepTolerance + 1e-9 ? 'kept' : 'notReached');
      expect(sc.met).toBe(sc.verdict === 'kept');
      if (sc.verdict === 'kept') expect(sc.percentOfAchievable).toBe(100);
    }
  }
  for (const f of res.feasibility) {
    const a0 = res.options[0]?.scorecard[f.goal];
    if (a0?.verdict === 'kept') {
      expect(f.text).not.toMatch(/not reachable|not kept/);
      expect(f.status === 'attainable' || f.status === 'metAtBaseline').toBe(true);
    }
  }
  // priority order: Hard is (near) best on goal 1; an easier rung keeps at least half of Hard's goal-1 progress (§1.3:
  // Easy d̃₁ ≥ 0.5·g_H; Medium lies between), i.e. gives up at most 50 points of goal 1 (+ the model's precision)
  const a = res.options[0]!;
  for (const o of res.options.slice(1)) expect(o.scorecard[0]!.costVsA).toBeLessThanOrEqual(0.5 * Math.max(0, a.scorecard[0]!.percentOfAchievable) + 5 + 1e-6);
  expect(a.scorecard[0]!.percentOfAchievable).toBeGreaterThanOrEqual(Math.max(...res.options.map((o) => o.scorecard[0]!.percentOfAchievable)) - 10);
  return ctx;
}

/** Explanation hygiene: phase "why" texts match the phase's numbers (no "15-25 %" on a different deficit, no LDL on non-lipid plans). */
export function expectHonestText(ctx: PlanningContext, o: PlanOption, stats: PhaseStats[]): void {
  const lipids = ctx.classRank.lipids !== undefined;
  o.phases.forEach((p, i) => {
    if (!lipids) expect(p.why).not.toMatch(/used for LDL|LDL\/ApoB goals/);
    expect(p.why).not.toMatch(/15-25 %/);
    const st = stats[i];
    const m = /(\d+) % energy deficit|deficit (\d+) %|(\d+) % surplus/.exec(`${p.why} ${p.name}`);
    if (st && m && Number.isFinite(st.energyPct)) {
      const stated = Number(m[1] ?? m[2] ?? m[3]);
      expect(Math.abs(stated - Math.abs(100 - st.energyPct)), `${p.name}: says ${stated} %, is ${st.energyPct.toFixed(1)} %`).toBeLessThanOrEqual(3);
    }
  });
  const moves = o.explanation.find((e) => e.startsWith('What moves goal 1'));
  if (moves) {
    const c = o.contributions.find((x) => moves.includes(x.label));
    if (c?.deltaGoal1Metric !== undefined) expect(moves).toMatch(c.deltaGoal1Metric > 0 ? /lower\.$/ : /higher\.$/);
  }
}

/** One-line summary of an option for failure messages and the planner README. */
export function describe2(o: PlanOption, stats: PhaseStats[]): string {
  const sc = o.scorecard.map((s) => `${s.label} ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}`).join(', ');
  const ph = stats.map((p) => `${p.name} [${Math.round(p.energyPct)} %, P ${p.proteinGPerKg.toFixed(1)}, RT ${p.rtSessionsPerWeek.toFixed(1)}×${Math.round(p.rtSetsPerMuscleWeek)} sets, cardio ${Math.round(p.cardioMinPerWeek)} min, window ${p.windowH} h]`).join(' → ');
  return `${o.id} ${o.name}: ${ph}; fasts ${(o.schedule.events ?? []).map((e) => `${e.durationH} h`).join(',') || 'none'}; ${sc}`;
}

/**
 * Ladder semantics (PLANNER_V2_SPEC §1.3, §9.6 item 6): Hard present; rungs ordered by goal 1 and by difficulty; every
 * missing rung carries a collapse reason with a sentence; present easier rungs pass the distinctness thresholds; time to
 * target never shorter on an easier rung (up to a week of rounding); every engine sentence free of internal references.
 */
export function expectLadder(res: PlannerResult): void {
  const v2 = res.v2;
  expect(v2, 'the v2 result rides along').toBeDefined();
  if (!v2) return;
  expect(v2.status).toBe('ok');
  const H = v2.rungs.hard;
  expect(H, 'Hard is always present').toBeDefined();
  if (!H) return;
  const order = (['hard', 'medium', 'easy'] as const).filter((r) => v2.rungs[r]);
  for (const r of ['medium', 'easy'] as const) {
    if (v2.rungs[r]) continue;
    const c = v2.ladder.collapsed.find((x) => x.rung === r);
    expect(c, `${r} is missing without a collapse reason`).toBeDefined();
    expect(c!.text.length).toBeGreaterThan(10);
  }
  const D = order.map((r) => v2.rungs[r]!.summary.difficulty.D);
  for (let i = 1; i < D.length; i++) expect(D[i]!, `difficulty ordered ${order.join(' ≥ ')}`).toBeLessThanOrEqual(D[i - 1]! + 1e-9);
  if (order.length > 1) {
    expect(v2.ladder.checks.ordered).toBe(true);
    if (v2.rungs.easy) expect(H.summary.difficulty.D - v2.rungs.easy.summary.difficulty.D, 'Hard and Easy at least 0.15 apart').toBeGreaterThanOrEqual(0.15 - 1e-6);
    const k = (r: (typeof order)[number]) => v2.rungs[r]!.summary.outcomes[0]!;
    for (let i = 1; i < order.length; i++) {
      const prev = v2.rungs[order[i - 1]!]!.summary.difficulty.D;
      const cur = v2.rungs[order[i]!]!.summary.difficulty.D;
      // §12.8: Hard and Easy at least 0.15 apart; a Medium between them at least 0.08 from each (0.15 without Easy)
      const gap = order.length === 3 ? MEDIUM_MARGIN.minDGap : 0.15;
      expect(prev - cur, `rungs at least ${gap} apart in difficulty`).toBeGreaterThanOrEqual(gap - 1e-6);
      // goal 1 ordered (percent of achievable, from the run's own scale)
      expect(k(order[i]!).percentOfAchievable).toBeLessThanOrEqual(k(order[i - 1]!).percentOfAchievable + 1e-6);
      // time to target never shorter on the easier rung (one week of rounding)
      const wp = k(order[i - 1]!).weeksToTarget;
      const wc = k(order[i]!).weeksToTarget;
      if (wp !== null && wc !== null) expect(wc).toBeGreaterThanOrEqual(wp - 1);
    }
  }
  const leakRe = /\bdossiers?\b|§|\bR-[A-Z]{2,}|\bWP\d|MODEL_SPEC|\boption [ABC]\b|\bplan [ABC]\b/i;
  const texts: string[] = [];
  for (const r of order) {
    const s = v2.rungs[r]!.summary;
    texts.push(s.title, s.subtitle, s.fasting.text, s.equipment.text, ...s.difficulty.components.map((c) => `${c.label} ${c.text}`), ...s.bindingLimits.map((b) => b.text), ...s.outcomes.map((o) => o.tttText ?? ''));
    texts.push(...v2.rungs[r]!.explanation);
  }
  texts.push(...v2.ladder.collapsed.map((c) => c.text), ...v2.feasibility.map((f) => f.text));
  if (v2.ideal) texts.push(...v2.ideal.limitCosts.map((c) => c.text), ...v2.ideal.advised.map((x) => x.text), ...v2.ideal.relaxed.map((x) => `${x.from} ${x.to}`));
  for (const t of texts) expect(t, t).not.toMatch(leakRe);
}
