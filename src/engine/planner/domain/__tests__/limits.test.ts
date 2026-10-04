// @vitest-environment node
/**
 * Practical limits and the Ideal transform (PLANNER_V2_SPEC §2.1-§2.4, §9.7 "Ideal"): every input field is classed;
 * `idealRequest` changes only practical and preference fields (table-driven from `LIMIT_CLASS`) and keeps safety,
 * consent, goals and horizon; `relaxGroup` changes only its group; the Ideal-only genes decode to valid schedules;
 * the binding test; the texts read in plain words.
 */
import { describe, expect, it } from 'vitest';
import { leak } from '../../../../content/evidence/__tests__/leakScan';
import type { TrainingProfile } from '../../../../catalogues/types';
import type { SafetyOptIns } from '../../../../features/onboarding/safetyRules';
import type { ConstraintDraft } from '../../../../state/internal/plannerModel';
import type { Schedule } from '../../../types/schedule';
import { Rng } from '../../optim/rng';
import { compileRequest, type PlanningContext } from '../context';
import { decodePlan, encodeValues } from '../decode';
import { IDEAL_SLEEP, bedClockOf, sleepHoursOf } from '../ideal';
import { ADVISED_IDEAL, LIMIT_CLASS, bindingLimits, gMinMetric, idealRequest, limitText, relaxGroup, relaxGroupDetailed, type LimitFieldDef } from '../limits';
import { MARGIN_IDS, MARGIN_NA } from '../model';
import { repairSchedule } from '../repair';
import { compileSafetyCaps } from '../safety';
import { enumerateStructures, makeStructure, transferGenome, type SkeletonStructure } from '../skeleton';
import { LIMIT_GROUPS, type PlannerRequest, type PlannerRequestV2, type PlannerSafetyInput, type PracticalConstraints } from '../types';
import { validatePlan } from '../validate';
import { FAT_LOSS_KEEP_LEAN, LEAN_MAN, MAN_95, WOMAN_62, request } from './personas';

// ---- every field of every input type (the compiler fails when a type gains a field these lists do not name)
const PRACTICAL: Record<keyof PracticalConstraints, true> = {
  trainingDaysPerWeek: true, allowedTrainingWeekdays: true, trainingTimeH: true, maxSessionMin: true, cardioDaysPerWeek: true, cardioModality: true,
  eatingWindow: true, mealsPerDay: true, steps: true, excludedLevers: true, fasting: true, prefersFasting: true, sleepFixed: true, hungerTolerance: true,
  maxFastHours: true, proteinFloorGPerKg: true, carbFloorGPerDay: true,
};
const DRAFT: Record<keyof ConstraintDraft, true> = {
  trainingDays: true, trainingWeekdays: true, trainingTimeH: true, maxSessionMin: true, cardioDays: true, cardioModality: true, earliestH: true, latestH: true,
  mealsPerDay: true, steps: true, longestFastH: true, prefersFasting: true, excluded: true, proteinFloor: true, carbFloorG: true, sleepFixed: true, hungerTolerance: true,
};
const SAFETY: Record<keyof PlannerSafetyInput, true> = {
  plannerAccess: true, mode: true, restrictions: true, plannerLocks: true, fasting: true, flags: true, optIns: true, expertMode: true,
};
const SAFETY_FASTING: Record<keyof NonNullable<PlannerSafetyInput['fasting']>, true> = { maxFastHours: true, maxEligibleTier: true, effectiveTier: true, optInTiers: true, shortWindowAvailable: true };
const SAFETY_OPTINS: Record<keyof NonNullable<PlannerSafetyInput['optIns']>, true> = { fastingTier: true, shortEatingWindow: true, levers: true };
const OPTINS: Record<keyof SafetyOptIns, true> = { fastingTier: true, shortEatingWindow: true, recentIllness: true };
const TRAINING: Record<keyof TrainingProfile, true> = {
  owned: true, access: true, refused: true, liked: true, injuries: true, cleared: true, skill: true, purchaseAllowance: true, loadsKg: true, capacities: true, enjoy: true,
};
const REQUEST: Record<keyof PlannerRequestV2, true> = {
  profile: true, goals: true, horizonDays: true, startDate: true, constraints: true, safety: true, strictness: true, seed: true, budget: true, ideal: true,
  relaxedGroups: true, training: true, ladder: true, previous: true, markerWarnings: true, preferLevers: true, // E20: markers
};

function def(from: LimitFieldDef['from'], field: string): LimitFieldDef | undefined {
  return LIMIT_CLASS.find((d) => d.from === from && d.field === field);
}

const RICH: PlannerRequest = request(MAN_95, FAT_LOSS_KEEP_LEAN, {
  horizonDays: 84,
  startDate: '2026-10-05',
  strictness: 'strict',
  seed: 7,
  budget: { tier: 'S' },
  constraints: {
    trainingDaysPerWeek: { min: 2, max: 3 },
    allowedTrainingWeekdays: [0, 2, 4],
    trainingTimeH: 7,
    maxSessionMin: 45,
    cardioDaysPerWeek: { min: 0, max: 1 },
    cardioModality: 'walk',
    eatingWindow: { earliestH: 9, latestH: 19 },
    mealsPerDay: { min: 2, max: 3 },
    steps: { min: 5000, max: 7000 },
    excludedLevers: ['B2', 'refeedDay'],
    fasting: 'none',
    prefersFasting: true,
    sleepFixed: true,
    hungerTolerance: 'low',
    maxFastHours: 16,
    proteinFloorGPerKg: 2,
    carbFloorGPerDay: 100,
  },
  safety: {
    mode: 'M0',
    plannerLocks: [
      { id: 'deficit-cap', value: 15, reasons: [{ rule: 'S-12' }] },
      { id: 'max-fast', value: 14, reasons: [{ rule: 'user' }] },
      { id: 'protein-floor', value: 1.8, reasons: [{ rule: 'user' }] },
    ],
    optIns: { fastingTier: 'T2', levers: ['omega3'] },
    flags: ['gout'],
  },
});
const PLAIN: PlannerRequest = request(WOMAN_62, FAT_LOSS_KEEP_LEAN, { horizonDays: 56 });
const WITH_TRAINING: PlannerRequestV2 = {
  ...request(LEAN_MAN, [{ metric: 'leanTissue', direction: 'maximise' }, { metric: 'fatMass', direction: 'minimise' }], { horizonDays: 84, constraints: { trainingDaysPerWeek: { min: 3, max: 4 }, steps: { min: 9000, max: 11000 } } }),
  training: { owned: ['dumbbell-pair'], access: [], refused: ['jumping'], liked: [], injuries: ['knee'], skill: 3, purchaseAllowance: { maxPriceTier: 0, maxItems: 0 } },
};
const CASES: Array<[string, PlannerRequest]> = [['rich', RICH], ['plain', PLAIN], ['training', WITH_TRAINING]];

const json = (x: unknown) => JSON.stringify(x ?? null);

describe('LIMIT_CLASS', () => {
  it('classes every PracticalConstraints, ConstraintDraft, PlannerSafetyInput, SafetyOptIns, TrainingProfile and request field', () => {
    const want: Array<[LimitFieldDef['from'], string]> = [
      ...Object.keys(PRACTICAL).map((k) => ['PracticalConstraints', k] as [LimitFieldDef['from'], string]),
      ...Object.keys(DRAFT).map((k) => ['ConstraintDraft', k] as [LimitFieldDef['from'], string]),
      ...Object.keys(SAFETY).map((k) => ['PlannerSafetyInput', k] as [LimitFieldDef['from'], string]),
      ...Object.keys(SAFETY_FASTING).map((k) => ['PlannerSafetyInput', `fasting.${k}`] as [LimitFieldDef['from'], string]),
      ...Object.keys(SAFETY_OPTINS).map((k) => ['PlannerSafetyInput', `optIns.${k}`] as [LimitFieldDef['from'], string]),
      ...Object.keys(OPTINS).map((k) => ['SafetyOptIns', k] as [LimitFieldDef['from'], string]),
      ...Object.keys(TRAINING).map((k) => ['TrainingProfile', k] as [LimitFieldDef['from'], string]),
      ...Object.keys(REQUEST).map((k) => ['PlannerRequest', k] as [LimitFieldDef['from'], string]),
    ];
    for (const [from, field] of want) expect(def(from, field), `${from}.${field}`).toBeDefined();
    const keys = LIMIT_CLASS.map((d) => `${d.from}.${d.field}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of LIMIT_CLASS) {
      if (d.class === 'practical' || d.class === 'preference') expect(LIMIT_GROUPS, `${d.from}.${d.field}`).toContain(d.group);
      else expect(d.group, `${d.from}.${d.field}`).toBeNull();
    }
    // safety and consent stay out of every group
    for (const k of Object.keys(SAFETY)) expect(['safety', 'consent']).toContain(def('PlannerSafetyInput', k)!.class);
    for (const k of ['goals', 'horizonDays', 'startDate', 'strictness'] as const) expect(def('PlannerRequest', k)!.class).toBe('request');
    // every group has at least one field
    for (const g of LIMIT_GROUPS) expect(LIMIT_CLASS.some((d) => d.group === g), g).toBe(true);
  });
});

describe('idealRequest / relaxGroup', () => {
  it('idealRequest changes only practical and preference fields; safety, consent, goals and horizon are kept', () => {
    for (const [name, req] of CASES) {
      const { request: ideal, relaxed } = idealRequest(req);
      expect(ideal.ideal, name).toBe(true);
      expect(ideal.relaxedGroups, name).toEqual([...LIMIT_GROUPS]);
      // request-level fields untouched
      for (const k of Object.keys(REQUEST) as Array<keyof PlannerRequestV2>) {
        if (k === 'constraints' || k === 'safety' || k === 'ideal' || k === 'relaxedGroups') continue;
        expect(json(ideal[k as keyof PlannerRequest] ?? (ideal as PlannerRequestV2)[k]), `${name}.${k}`).toBe(json(req[k as keyof PlannerRequest] ?? (req as PlannerRequestV2)[k]));
      }
      // constraints: every changed field is practical or preference
      const a = (req.constraints ?? {}) as Record<string, unknown>;
      const b = (ideal.constraints ?? {}) as Record<string, unknown>;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (json(a[k]) === json(b[k])) continue;
        const d = def('PracticalConstraints', k);
        expect(d, `${name}: ${k} changed but is unclassed`).toBeDefined();
        expect(['practical', 'preference'], `${name}: ${k}`).toContain(d!.class);
      }
      // safety: identical but for the user-tagged locks (the older form of three user limits)
      const sa = req.safety ?? {};
      const sb = ideal.safety ?? {};
      for (const k of Object.keys(SAFETY) as Array<keyof PlannerSafetyInput>) {
        if (k === 'plannerLocks') continue;
        expect(json(sb[k]), `${name}: safety.${k}`).toBe(json(sa[k]));
      }
      const screening = (sa.plannerLocks ?? []).filter((l) => !l.reasons?.length || l.reasons.some((r) => r.rule !== 'user'));
      expect(json(sb.plannerLocks?.filter((l) => !l.reasons?.length || l.reasons.some((r) => r.rule !== 'user')) ?? []), name).toBe(json(screening));
      expect((sb.plannerLocks ?? []).some((l) => l.reasons?.every((r) => r.rule === 'user'))).toBe(false);
      // relaxed rows name their field's group and read in plain words
      for (const r of relaxed) {
        const field = r.field.replace(/^constraints\./, '');
        if (r.field === 'training.owned') expect(r.group).toBe('equipment');
        else expect(def('PracticalConstraints', field)?.group, r.field).toBe(r.group);
        expect(r.from).not.toBe(r.to);
        for (const t of [r.from, r.to]) {
          expect(leak(t), t).toBeNull();
          expect(t).not.toMatch(/undefined|NaN|\b[BL]\d+\b/);
        }
      }
      // the safety caps that do not depend on practical limits are unchanged
      const c0 = compileRequest(req);
      const c1 = compileRequest(ideal);
      expect(c1.problems, name).toEqual([]);
      for (const k of ['deficitCapPct', 'rateCapPct', 'maxPctTdee', 'energyFloorKcal', 'proteinCapRw', 'fastingOptIn', 'mode', 'rtNovice', 'blocked'] as const) expect(json(c1.caps[k]), `${name}: caps.${k}`).toBe(json(c0.caps[k]));
      expect(json(c1.caps.exercise)).toBe(json(c0.caps.exercise));
      // food floors fall back to the safety floors alone
      const safetyOnly = compileSafetyCaps(c1.rp, ideal.safety, undefined);
      expect(c1.caps.carbFloorG).toBe(safetyOnly.carbFloorG);
      expect(c1.caps.proteinFloorRw).toBe(safetyOnly.proteinFloorRw);
    }
    // the rich request lists the relaxed fields
    const rich = idealRequest(RICH).relaxed.map((r) => r.field);
    for (const f of ['trainingDaysPerWeek', 'allowedTrainingWeekdays', 'trainingTimeH', 'maxSessionMin', 'cardioDaysPerWeek', 'cardioModality', 'eatingWindow', 'mealsPerDay', 'steps', 'sleepFixed', 'hungerTolerance', 'maxFastHours', 'fasting', 'excludedLevers', 'prefersFasting', 'proteinFloorGPerKg', 'carbFloorGPerDay'])
      expect(rich, f).toContain(`constraints.${f}`);
    expect(idealRequest(WITH_TRAINING).relaxed.some((r) => r.group === 'equipment')).toBe(true);
  });

  it('relaxGroup changes only the fields of its group (and that group’s user-tagged locks)', () => {
    for (const g of LIMIT_GROUPS) {
      const { request: r, relaxed } = relaxGroupDetailed(RICH, g);
      expect(r.ideal).toBeUndefined();
      expect(r.relaxedGroups).toEqual([g]);
      expect(json(relaxGroup(RICH, g))).toBe(json(r));
      const a = (RICH.constraints ?? {}) as Record<string, unknown>;
      const b = (r.constraints ?? {}) as Record<string, unknown>;
      const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => json(a[k]) !== json(b[k]));
      for (const k of changed) expect(def('PracticalConstraints', k)?.group, `${g}: ${k}`).toBe(g);
      if (g !== 'equipment') expect(changed.length, g).toBeGreaterThan(0);
      for (const x of relaxed) expect(x.group).toBe(g);
      const locksA = json(RICH.safety?.plannerLocks);
      const locksB = json(r.safety?.plannerLocks);
      if (g === 'fasting' || g === 'foodFloors') expect(locksB).not.toBe(locksA);
      else expect(locksB).toBe(locksA);
      expect(json({ ...r.safety, plannerLocks: null })).toBe(json({ ...RICH.safety, plannerLocks: null }));
      // the group's text and the patch the adopt panel writes back
      const t = limitText(g, RICH, r);
      expect(t.label.length).toBeGreaterThan(0);
      for (const s of [t.label, t.current, t.relaxedTo]) expect(leak(s), s).toBeNull();
      if (g !== 'equipment') expect(t.current).not.toBe(t.relaxedTo);
      for (const k of Object.keys(t.adopt)) expect(def('PracticalConstraints', k)?.group, `${g} adopt ${k}`).toBe(g);
    }
    expect(limitText('trainingDays', RICH, relaxGroup(RICH, 'trainingDays'))).toMatchObject({ current: expect.stringContaining('3 training days'), relaxedTo: expect.stringContaining('6 training days') });
  });

  it('the context accepts the Ideal values: up to 6 training and cardio days (rest day and novice cap kept), the widest window', () => {
    const lean = compileRequest(idealRequest(WITH_TRAINING).request);
    expect(lean.practical.rtDays.max).toBe(6);
    expect(lean.practical.cardioDays.max).toBe(6);
    expect(lean.practical.idealGenes).toEqual({ sleep: true, clock: true, modality: true });
    expect(lean.practical.sleepFixed).toBe(false);
    const novice = compileRequest(idealRequest(RICH).request);
    expect(novice.caps.rtNovice).toBe(true);
    expect(novice.practical.rtDays.max).toBe(3);
    expect(novice.practical.maxSessionMin).toBe(90);
    expect(novice.practical.steps).toEqual({ min: 4000, max: 12000 });
    expect(novice.practical.hTol).toBe(0.7);
    expect(novice.practical.excluded.size).toBe(0);
    expect(novice.practical.earliestH).toBeLessThanOrEqual(compileRequest(RICH).practical.earliestH);
    expect(novice.practical.latestH).toBeGreaterThanOrEqual(compileRequest(RICH).practical.latestH);
    // an ordinary request has no Ideal genes
    expect(compileRequest(RICH).practical.idealGenes).toEqual({ sleep: false, clock: false, modality: false });
  });
});

describe('Ideal-only genes', () => {
  function idealCtxs(): Array<[string, PlanningContext]> {
    return [
      ['man95 fat loss', compileRequest(idealRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 84 })).request)],
      ['lean man muscle', compileRequest(idealRequest(WITH_TRAINING).request)],
      ['light-moderate only', compileRequest(idealRequest(request(WOMAN_62, FAT_LOSS_KEEP_LEAN, { horizonDays: 56, safety: { plannerLocks: [{ id: 'exercise-light-moderate' }] } })).request)],
    ];
  }

  function checkSchedule(name: string, ctx: PlanningContext, s: Schedule): void {
    const v = validatePlan(ctx, s);
    if (!v.ok) throw new Error(`${name}: ${v.reasons.join('; ')}`);
    const mods = ctx.practical.idealModalities;
    for (let d = 0; d < s.horizonDays; d++) {
      const sd = s.days[d]!;
      const t = { ...s.programs[sd.program]!, ...(sd.override ?? {}) };
      const sl = t.sleep;
      expect(sl?.bedH, `${name} day ${d}`).toBeDefined();
      const dur = sleepHoursOf(sl!.bedH!, sl!.wakeH!);
      expect(dur).toBeGreaterThanOrEqual(IDEAL_SLEEP.minH - 1e-9);
      expect(dur).toBeLessThanOrEqual(IDEAL_SLEEP.maxH + 1e-9);
      expect((sl!.bedH! * 4) % 1).toBeCloseTo(0, 6);
      const bedClock = bedClockOf(sl!.bedH!);
      for (const x of t.exercise ?? []) {
        const end = x.startH + (x.durationMin ?? 60) / 60;
        expect(end, `${name} day ${d}: session ends ${end} with bed ${bedClock}`).toBeLessThanOrEqual(bedClock - 1 + 1e-6);
        expect(x.startH).toBeGreaterThanOrEqual(sl!.wakeH! + 1 - 1e-6);
        if (x.kind === 'cardio') expect(mods).toContain(x.modality);
      }
    }
  }

  it('Ideal structures carry the sleep, clock and modality genes; random genomes decode and repair to valid schedules', () => {
    const rng = new Rng(20261001);
    let checked = 0;
    for (const [name, ctx] of idealCtxs()) {
      const sts = enumerateStructures(ctx);
      expect(sts.length, name).toBeGreaterThan(5);
      const st1 = sts[1]!;
      for (const p of ['sleep.durationH', 'sleep.midpointH', 'train.clockH']) expect(st1.geneIndex[p], `${name} ${p}`).toBeDefined();
      if (ctx.practical.cardioDays.max > 0 && ctx.practical.idealModalities.length > 1) expect(st1.geneIndex['cardio.modality'], name).toBeDefined();
      if (name === 'light-moderate only') expect(ctx.practical.idealModalities).not.toContain('run');
      for (const st of sts.slice(1, 20)) {
        expect(st.genes.some((g) => g.path === 'sleep.extraH'), st.id).toBe(false);
        const xs = [Float64Array.from(st.x0), new Float64Array(st.dim), new Float64Array(st.dim).fill(1)];
        for (let k = 0; k < 3; k++) xs.push(Float64Array.from({ length: st.dim }, () => rng.float()));
        for (const x of xs) {
          const plan = decodePlan(ctx, st, x);
          const { schedule } = repairSchedule(ctx, plan.schedule, plan);
          checkSchedule(`${name} / ${st.id}`, ctx, schedule);
          // idempotence of the sequential value reader with the new genes
          const again = decodePlan(ctx, st, encodeValues(st, plan.values, plan.ranges));
          expect(JSON.stringify(again.schedule)).toBe(JSON.stringify(plan.schedule));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  }, 120_000);

  it('genome transfer maps shared genes by path (Hard → Ideal) and leaves the Ideal-only genes at their defaults', () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 84 });
    const hard = compileRequest(req);
    const ideal = compileRequest(idealRequest(req).request);
    const sk = enumerateStructures(hard)[3]!.skeleton;
    const from: SkeletonStructure = makeStructure(hard, sk);
    const to: SkeletonStructure = makeStructure(ideal, sk);
    expect(to.id).toBe(from.id);
    const x = Float64Array.from({ length: from.dim }, (_, i) => ((i * 7) % 10) / 10);
    const y = transferGenome(from, to, x);
    for (const g of from.genes) {
      const j = to.geneIndex[g.path];
      if (j === undefined) continue;
      const i = from.geneIndex[g.path]!;
      const vFrom = g.min + x[i]! * (g.max - g.min);
      const gt = to.genes[j]!;
      const vTo = gt.min + y[j]! * (gt.max - gt.min);
      expect(vTo, g.path).toBeCloseTo(Math.min(gt.max, Math.max(gt.min, vFrom)), 9);
    }
    for (const p of ['sleep.durationH', 'sleep.midpointH', 'train.clockH']) expect(y[to.geneIndex[p]!]).toBe(to.x0[to.geneIndex[p]!]);
  });
});

describe('binding limits, advice and g_min', () => {
  it('a plan at the user’s bounds binds those groups; the Ideal of the same plan binds none of them', () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 84, constraints: { trainingDaysPerWeek: { min: 0, max: 2 }, maxSessionMin: 40, steps: { min: 6000, max: 7000 }, hungerTolerance: 'low', cardioDaysPerWeek: { min: 0, max: 2 } } });
    const ctx = compileRequest(req);
    const st = enumerateStructures(ctx).find((s) => s.geneIndex['rt.sessions'] !== undefined && s.geneIndex['cardio.minutes'] !== undefined)!;
    const x = new Float64Array(st.dim).fill(1);
    const plan = decodePlan(ctx, st, x);
    const { schedule, log } = repairSchedule(ctx, plan.schedule, plan);
    const margins = new Float64Array(MARGIN_IDS.length).fill(MARGIN_NA);
    margins[MARGIN_IDS.indexOf('hungerCap')] = 0.1;
    const b = bindingLimits(ctx, st, x, schedule, log, margins);
    const groups = b.map((x) => x.group);
    for (const g of ['trainingDays', 'steps', 'sessionTime', 'hunger', 'cardio'] as const) expect(groups, g).toContain(g);
    for (const x of b) {
      expect(x.share).toBeGreaterThan(0);
      expect(x.share).toBeLessThanOrEqual(1);
      expect(leak(x.text), x.text).toBeNull();
      expect(x.text).toMatch(/\(on \d+ % of days\)|\(the plan uses all of it\)/);
    }
    expect(b.find((x) => x.group === 'trainingDays')!.text).toContain('2 training days');
    // the same genome in the Ideal: the relaxed bounds are not reached
    const ictx = compileRequest(idealRequest(req).request);
    const ist = makeStructure(ictx, st.skeleton);
    const ix = transferGenome(st, ist, x);
    const iplan = decodePlan(ictx, ist, ix);
    const ir = repairSchedule(ictx, iplan.schedule, iplan);
    const ib = bindingLimits(ictx, ist, ix, ir.schedule, ir.log, margins).map((x) => x.group);
    for (const g of ['trainingDays', 'steps', 'sessionTime', 'hunger', 'cardio'] as const) expect(ib, g).not.toContain(g);
  });

  it('advice texts and g_min (§1.3 table)', () => {
    expect(ADVISED_IDEAL.length).toBeGreaterThanOrEqual(4);
    for (const a of ADVISED_IDEAL) {
      expect(leak(`${a.domain}: ${a.text}`)).toBeNull();
      expect(a.text.length).toBeGreaterThan(10);
    }
    const ctx1 = compileRequest(
      request(MAN_95, [
        { metric: 'fatMass', direction: 'minimise' },
        { metric: 'scaleWeight', direction: 'minimise' },
        { metric: 'bodyFatPct', direction: 'minimise' },
        { metric: 'waist', direction: 'minimise' },
        { metric: 'visceralFat', direction: 'minimise' },
        { metric: 'ldl', direction: 'minimise' },
      ]),
    );
    expect([0, 1, 2, 3, 4, 5].map((i) => gMinMetric(ctx1, i))).toEqual([1, 1, 1, 1, 0.1, null]);
    const ctx2 = compileRequest(request(LEAN_MAN, [{ metric: 'skeletalMuscle', direction: 'maximise' }, { metric: 'leanTissue', direction: 'maximise' }, { metric: 'strength', direction: 'maximise' }]));
    expect([0, 1, 2].map((i) => gMinMetric(ctx2, i))).toEqual([0.3, 0.3, 5]);
    expect(gMinMetric(ctx2, 9)).toBeNull();
  });
});
