// @vitest-environment node
/**
 * Ruling R-FAST-GATE (2026-10-01; PLANNER_V2_SPEC §3.1, §3.3, §3.5): the fasting gate's truth table, the overlay hosts of
 * the 24-h fast, the planner's W-05-KETO-FED guard matching the engine rule, and the classification of fasting use
 * (a short eating window is time-restricted eating, not a fast). Pure: no engine runs.
 */
import { describe, expect, it } from 'vitest';
import type { RankedGoal } from '../types';
import type { Schedule } from '../../../types/schedule';
import { compileRequest } from '../context';
import { fastingKind, longestFastH, usesFast } from '../fastMath';
import { KETO_ANY_DAILY_MAX, KETO_FED_DAILY_MAX, ketoFedDailyLimits } from '../model';
import { OVERLAY_HOSTS, enumerateStructures } from '../skeleton';
import { MAN_95, OBESE_MAN, request } from './personas';

const g = (metric: RankedGoal['metric'], direction: RankedGoal['direction'] = 'maximise', extra: Partial<RankedGoal> = {}): RankedGoal => ({ metric, direction, ...extra });
const FAT = g('fatMass', 'target', { target: -8, targetKind: 'change' });
// D2-02: the autophagy research index is no goal (never an objective, never a fasting reason); the transient-marker rows of
// the truth table use blood ketones, the other goal class fasting serves by the ruling
const AUTO = g('autophagyIdx');
// Explicit synthetic aspiration in mmol/L; never a default target for users.
const KETO = g('bhb', 'target', { target: 1.0 });
const LEAN = g('leanTissue');
const T = (tier: 'T2' | 'T3') => ({ safety: { optIns: { fastingTier: tier } } });

describe('fasting gate (R-FAST-GATE truth table)', () => {
  it('ketosis #1 + T3 → offered, with 72-h events in the structure set', () => {
    const ctx = compileRequest(request(MAN_95, [KETO, FAT], T('T3')));
    expect(ctx.fastingRelevant).toBe(true);
    expect(ctx.fastingServedGoal).toBe(0);
    expect(ctx.fastingReason).toMatch(/goal 1 \(blood ketones/i);
    expect(enumerateStructures(ctx).some((s) => s.skeleton.event?.durationH === 72)).toBe(true);
  });

  it('the autophagy index is refused as a goal and serves no fasting (D2-02)', () => {
    const ctx = compileRequest(request(MAN_95, [AUTO, FAT], T('T3')));
    expect(ctx.problems.join(' ')).toMatch(/research index, not a measure of a health outcome/);
    expect(ctx.goals.map((x) => x.metric)).toEqual(['fatMass']);
    // fat loss is then the goal fasting serves (the optimiser decides whether a fast helps it)
    expect(ctx.fastingServedGoal).toBe(1);
  });

  it('ketosis #1 + T2 → offered (48-h fasts, no 72-h)', () => {
    const ctx = compileRequest(request(MAN_95, [KETO, FAT], T('T2')));
    expect(ctx.fastingRelevant).toBe(true);
    const sts = enumerateStructures(ctx);
    expect(sts.some((s) => s.skeleton.event?.durationH === 48)).toBe(true);
    expect(sts.some((s) => (s.skeleton.event?.durationH ?? 0) > 48)).toBe(false);
  });

  it('fat loss #1, muscle #2 + T3 → offered, served goal = fat loss (the optimiser decides)', () => {
    const ctx = compileRequest(request(MAN_95, [FAT, LEAN], T('T3')));
    expect(ctx.fastingRelevant).toBe(true);
    expect(ctx.fastingServedGoal).toBe(0);
  });

  it('muscle #1, ketosis #2 + T3 → not offered: the muscle goal ranks above the served goal', () => {
    const ctx = compileRequest(request(MAN_95, [LEAN, KETO], T('T3')));
    expect(ctx.fastingRelevant).toBe(false);
    expect(ctx.fastingReason).toMatch(/goal 1 \(lean tissue.*\) ranks above goal 2/i);
    expect(enumerateStructures(ctx).some((s) => s.skeleton.event !== null || s.skeleton.overlay?.lever === 'fastDay24')).toBe(false);
  });

  it('ketosis #1 with the longest fast at 20 h → not offered, with the longest-fast reason', () => {
    const ctx = compileRequest(request(MAN_95, [KETO, FAT], { ...T('T3'), constraints: { maxFastHours: 20, fasting: 'none' } }));
    expect(ctx.fastingRelevant).toBe(false);
    expect(ctx.fastingReason).toMatch(/longest acceptable fast to 20 hours/);
  });

  it('ketosis #1 without an opt-in → offered with 24-h fasts only (the default tier counts; opt-ins raise the ceiling)', () => {
    const ctx = compileRequest(request(MAN_95, [KETO, FAT]));
    expect(ctx.fastingRelevant).toBe(true);
    expect(ctx.caps.maxFastH).toBe(24);
    expect(ctx.fastingReason).toMatch(/only 24-hour fasts/);
    const sts = enumerateStructures(ctx);
    expect(sts.some((s) => s.skeleton.overlay?.lever === 'fastDay24')).toBe(true);
    expect(sts.some((s) => s.skeleton.event !== null)).toBe(false);
  });

  it('the screening excludes fasts over 12 h (diabetes treatment) → not offered, with the screening reason', () => {
    const ctx = compileRequest(request({ ...MAN_95, safety: { mode: 'M0', flags: { diabetesMedication: 'metforminOnly' } } }, [KETO, FAT], T('T3')));
    expect(ctx.fastingRelevant).toBe(false);
    expect(ctx.fastingReason).toMatch(/safety screening/);
  });

  it("fasting: 'none' → refused; no goal fasting serves → not offered; a preference serves the top goal", () => {
    expect(compileRequest(request(MAN_95, [KETO], { constraints: { fasting: 'none' } })).fastingReason).toBe('you ruled out fasting');
    const none = compileRequest(request(MAN_95, [g('vo2max'), g('rmr')], T('T3')));
    expect(none.fastingRelevant).toBe(false);
    expect(none.fastingReason).toMatch(/none of your goals gains from fasting/);
    const pref = compileRequest(request(MAN_95, [LEAN, FAT], { ...T('T3'), constraints: { prefersFasting: true } }));
    expect(pref.fastingRelevant).toBe(true);
    expect(pref.fastingReason).toMatch(/prefer fasting/);
  });

  it('goals the evidence graph credits to a fast are offered (lower LDL, less glycogen); ApoB and the generic endurance index are no goals (C6)', () => {
    for (const goal of [g('apoB', 'minimise'), g('enduranceCapacity')]) {
      const ctx = compileRequest(request(MAN_95, [goal, g('vo2max')], T('T3')));
      expect(ctx.problems.join(' '), goal.metric).toMatch(/cannot be used as a goal/);
      expect(ctx.goals.map((x) => x.metric), goal.metric).toEqual(['vo2max']);
    }
    for (const goal of [g('ldl', 'minimise'), g('glycogenTotal', 'target', { target: -100, targetKind: 'change' })]) {
      const ctx = compileRequest(request(MAN_95, [goal, g('vo2max')], T('T3')));
      expect(ctx.fastingRelevant, goal.metric).toBe(true);
      expect(ctx.fastingServedGoal, goal.metric).toBe(0);
      expect(ctx.fastingReason, goal.metric).toMatch(/^it can serve goal 1/);
    }
    // the muscle rule still applies to a graph-credited goal
    const m = compileRequest(request(MAN_95, [LEAN, g('ldl', 'minimise')], T('T3')));
    expect(m.fastingRelevant).toBe(false);
    expect(m.fastingServedGoal).toBe(1);
  });

  it('reasons are plain sentences without internal references', () => {
    for (const goals of [[KETO, FAT], [FAT, LEAN], [LEAN, KETO], [g('ldl', 'minimise')]]) {
      const ctx = compileRequest(request(OBESE_MAN, goals, T('T3')));
      expect(ctx.fastingReason).not.toMatch(/dossier|§|\bR-[A-Z]|HC-|W-[A-Z]/);
    }
  });
});

describe('24-h fast overlay hosts and grammar (R-FAST-GATE item 3)', () => {
  it('the 24-h fast sits in maintenance, mild-deficit and very-low-carbohydrate phases; refeed days stay deficit-only', () => {
    expect([...OVERLAY_HOSTS.fastDay24].sort()).toEqual(['B0', 'B1', 'B2', 'B22', 'B24', 'B3', 'B6']);
    expect(OVERLAY_HOSTS.refeedDay).not.toContain('B2');
    const sts = enumerateStructures(compileRequest(request(MAN_95, [KETO, FAT], T('T3'))));
    const hosts = (b: string) => sts.some((s) => s.skeleton.overlay?.lever === 'fastDay24' && s.skeleton.segments.some((x) => x.kind === 'phase' && x.block === b));
    expect(hosts('B2')).toBe(true);
    expect(hosts('B24')).toBe(true);
    expect(hosts('B0')).toBe(true);
    // never inside surplus phases
    for (const s of sts)
      if (s.skeleton.segments.every((x) => x.kind === 'phase' && (x.block === 'B21' || x.block === 'B23'))) expect(s.skeleton.overlay?.lever).not.toBe('fastDay24');
  });
});

describe('planner W-05-KETO-FED guard matches the engine rule (R-FAST-GATE item 2)', () => {
  it('without diabetes the guard is off (the rule does not apply); with diabetes 3.0 outside the 72-h refeed phase', () => {
    const plain = compileRequest(request(MAN_95, [KETO, FAT], T('T3')));
    const fastDay = Uint8Array.from({ length: 20 }, (_, d) => (d === 5 || d === 6 ? 1 : 0));
    expect(ketoFedDailyLimits(plain, fastDay, 20)).toBeNull();
    const diabetic = compileRequest(request({ ...MAN_95, safety: { mode: 'M0', flags: { diabetesMedication: 'glp1' } } }, [KETO, FAT]));
    const lim = ketoFedDailyLimits(diabetic, fastDay, 20)!;
    expect(lim[2]).toBe(KETO_FED_DAILY_MAX);
    for (const d of [5, 6, 7, 8, 9]) expect(lim[d], `day ${d}`).toBe(KETO_ANY_DAILY_MAX); // fast days + 72 h after
    expect(lim[10]).toBe(KETO_FED_DAILY_MAX);
  });
});

describe('fasting kind (golden (d) classification fix)', () => {
  const day = (meals: number[]) => ({ id: `m${meals.join('-')}`, label: 'd', energy: { kind: 'pctMaintenance' as const, pct: 100 }, macros: { protein: { unit: 'g' as const, value: 120 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } }, meals: { meals: meals.map((h) => ({ clockH: h, share: 1 / meals.length })) } });
  const sched = (programs: Schedule['programs'], dayProgram: (d: number) => number, events: Schedule['events'] = []): Schedule => ({
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: 14,
    programs,
    days: Array.from({ length: 14 }, (_, d) => ({ program: dayProgram(d) })),
    events,
  });
  it('an 8-h eating window is time-restricted eating, not a fast; 24-h, zero-day and multi-day fasts are fasts', () => {
    const wide = day([8, 13, 19]);
    const tre = day([11, 15, 19]);
    expect(fastingKind(sched([wide], () => 0))).toBe('none');
    const k = fastingKind(sched([tre], () => 0));
    expect(k).toBe('eatingWindow');
    expect(usesFast(k)).toBe(false);
    const f24 = sched([wide], () => 0, [{ kind: 'fast', startDay: 3, startH: 19, durationH: 24 }]);
    expect(fastingKind(f24)).toBe('fast24');
    expect(longestFastH(f24)).toBe(24);
    const zero = { ...wide, id: 'z', energy: { kind: 'zero' as const } };
    const zs = sched([wide, zero], (d) => (d === 4 ? 1 : 0));
    expect(fastingKind(zs)).toBe('zeroDays');
    expect(longestFastH(zs)).toBe(24 - 19 + 24 + 8);
    const multi = sched([wide, zero], (d) => (d === 4 ? 1 : 0), [{ kind: 'fast', startDay: 9, startH: 19, durationH: 72 }]);
    expect(fastingKind(multi)).toBe('multiDay');
    expect(usesFast('multiDay') && usesFast('zeroDays') && usesFast('fast24')).toBe(true);
  });
});
