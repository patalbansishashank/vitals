// @vitest-environment node
/**
 * Decoder / repair / validator properties (dossier 18 §7.1; optim README "remaining" tests):
 *  7.1.1 decode is total and every decoded + repaired plan satisfies all input-space bounds (independent validator),
 *  7.1.2 energy consistency after the engine's own compilation (no macro/energy conflicts; pct days resolve exactly),
 *  7.1.3 every multi-day fast has its locked recovery; spacing / cumulative limits hold incl. horizon end,
 *  7.1.4 idempotence decode(encode(decode(x))) = decode(x),
 *  7.1.5 `never` levers and `optIn` levers without consent never appear,
 *  D7-04 habitual active exposure: observed daily use in the baseline, continued (never re-added) by plans, increments only.
 */
import { describe, expect, it } from 'vitest';
import { compileSchedule } from '../../../core/compileSchedule';
import { Rng } from '../../optim/rng';
import { compileRequest, type PlanningContext } from '../context';
import { decodePlan, encodeValues, habitualCreatine, plannedCreatineG, roundGenome, type HabitualActiveExposure } from '../decode';
import { repairSchedule, zeroSpans } from '../repair';
import { enumerateStructures, type SkeletonStructure } from '../skeleton';
import { validatePlan } from '../validate';
import { KETOSIS_FIRST, FAT_LOSS_KEEP_LEAN, LEAN_MAN, MAN_95, OBESE_MAN, OLDER_WOMAN, WOMAN_62, request } from './personas';

function contexts(): Array<[string, PlanningContext]> {
  return [
    ['man95 fat loss', compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN))],
    ['woman62 fat loss', compileRequest(request(WOMAN_62, FAT_LOSS_KEEP_LEAN, { horizonDays: 56 }))],
    ['lean man muscle', compileRequest(request(LEAN_MAN, [{ metric: 'leanTissue', direction: 'maximise' }, { metric: 'fatMass', direction: 'minimise' }], { horizonDays: 183 }))],
    ['older woman', compileRequest(request(OLDER_WOMAN, FAT_LOSS_KEEP_LEAN, { horizonDays: 84 }))],
    [
      'obese man fasting opt-in',
      compileRequest(
        request(OBESE_MAN, KETOSIS_FIRST, {
          horizonDays: 140,
          safety: { mode: 'M0', optIns: { fastingTier: 'T3' }, fasting: { maxFastHours: 72 } },
          constraints: { prefersFasting: true },
        }),
      ),
    ],
  ];
}

function run(ctx: PlanningContext, st: SkeletonStructure, x: Float64Array) {
  const plan = decodePlan(ctx, st, x);
  const { schedule, log } = repairSchedule(ctx, plan.schedule, plan);
  return { plan, schedule, log };
}

function corners(n: number, max = 4096): Float64Array[] {
  const out: Float64Array[] = [];
  const total = Math.min(max, 2 ** n);
  for (let m = 0; m < total; m++) out.push(Float64Array.from({ length: n }, (_, j) => ((m >> j) & 1 ? 1 : 0)));
  return out;
}

describe('7.1 decoder properties', () => {
  const ctxs = contexts();

  it('declares proposed steps outside separately prescribed walking while leaving the habitual baseline intact', () => {
    const ctx = compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN, { constraints: { cardioModality: 'walk' } }));
    const st = enumerateStructures(ctx).find(s => !s.skeleton.baseline)!;
    const proposed = run(ctx, st, st.x0 as Float64Array).schedule;
    expect(proposed.programs.length).toBeGreaterThan(0);
    expect(proposed.programs.every(p => p.stepsScope === 'excludesTraining')).toBe(true);
    const compiled = compileSchedule(proposed, ctx.rp);
    expect(compiled.days.every(d => d.stepsScope === 'excludesTraining')).toBe(true);
  });

  it('enumerates a non-trivial, pruned structure list per persona (baseline first)', () => {
    for (const [name, ctx] of ctxs) {
      const sts = enumerateStructures(ctx);
      expect(sts[0]!.skeleton.baseline, name).toBe(true);
      expect(sts.length, name).toBeGreaterThan(5);
      const ids = new Set(sts.map((s) => s.id));
      expect(ids.size, name).toBe(sts.length);
      for (const s of sts) {
        expect(s.x0.length).toBe(s.dim);
        expect(s.dim).toBeLessThanOrEqual(40);
      }
    }
  }, 60_000);

  it('7.1.1 / 7.1.5: total on random genomes and corners; every repaired plan passes the independent validator', () => {
    const rng = new Rng(20260930);
    let checked = 0;
    for (const [name, ctx] of ctxs) {
      const sts = enumerateStructures(ctx);
      for (const st of sts) {
        const xs: Float64Array[] = [st.x0 as Float64Array];
        for (let k = 0; k < 6; k++) xs.push(Float64Array.from({ length: st.dim }, () => rng.float()));
        if (st.dim <= 12) xs.push(...corners(st.dim, 16));
        for (const x of xs) {
          const { schedule } = run(ctx, st, x);
          const v = validatePlan(ctx, schedule);
          if (!v.ok) throw new Error(`${name} / ${st.id}: ${v.reasons.join('; ')}`);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  }, 120_000);

  it('7.1.2 energy consistency after engine compilation', () => {
    const rng = new Rng(7);
    for (const [name, ctx] of ctxs) {
      const sts = enumerateStructures(ctx).slice(0, 25);
      for (const st of sts) {
        const x = Float64Array.from({ length: st.dim }, () => rng.float());
        const { schedule } = run(ctx, st, x);
        const cs = compileSchedule(schedule, ctx.rp);
        const bad = cs.notes.filter((n) => n.code !== 'sessionsTruncated');
        expect(bad, `${name} / ${st.id}: ${JSON.stringify(bad.slice(0, 3))}`).toEqual([]);
        for (const day of cs.days) {
          const sum = 4 * day.proteinG + 4 * day.carbG + 9 * day.fatG + 2 * day.fibreG + 7 * day.alcoholG;
          expect(Math.abs(sum - day.energyKcal)).toBeLessThanOrEqual(1);
        }
      }
    }
  }, 60_000);

  it('7.1.3 multi-day fasts carry locked recovery; spacing and cumulative limits hold to the horizon end', () => {
    const [, ctx] = ctxs[4]!;
    const sts = enumerateStructures(ctx).filter((s) => s.skeleton.event || s.skeleton.overlay?.lever === 'fastDay24' || s.skeleton.segments.some((g) => g.kind === 'phase' && g.block === 'B12'));
    expect(sts.length).toBeGreaterThan(0);
    const rng = new Rng(11);
    let events = 0;
    for (const st of sts) {
      for (let k = 0; k < 10; k++) {
        const x = Float64Array.from({ length: st.dim }, () => rng.float());
        const { schedule } = run(ctx, st, x);
        for (const e of schedule.events ?? []) {
          events++;
          const end = e.startDay * 24 + e.startH + e.durationH;
          expect(end).toBeLessThanOrEqual(schedule.horizonDays * 24);
          if (e.durationH >= 48) {
            // meal-to-meal durations (ruling 18:10): > 48 h carry the graded refeed; ≥ 48 h lock the end day and the next
            if (e.durationH > 48) expect(e.refeed).toBe('auto');
            const endDay = Math.floor(end / 24);
            for (const d of [endDay, endDay + 1]) {
              if (d >= schedule.horizonDays) continue;
              const sd = schedule.days[d]!;
              const t = { ...schedule.programs[sd.program]!, ...(sd.override ?? {}) };
              expect(t.exercise ?? []).toEqual([]);
              if (t.energy.kind === 'pctMaintenance') expect(t.energy.pct).toBeLessThanOrEqual(100 + 1e-6);
            }
          }
        }
        const spans = zeroSpans(ctx, schedule);
        for (let i = 0; i < spans.length; i++) {
          let h7 = 0;
          for (let j = 0; j <= i; j++) h7 += Math.max(0, Math.min(spans[j]!.end, spans[i]!.end) - Math.max(spans[j]!.start, spans[i]!.end - 168));
          expect(h7).toBeLessThanOrEqual(108 + 1e-6);
        }
      }
    }
    expect(events).toBeGreaterThan(0);
  }, 60_000);

  it('ruling 18:10: opted-in 72-h fasts and expert-tier 3-7-day fasts survive repair and validate (tier rules, 28-day floor)', () => {
    const t3 = contexts()[4]![1];
    const t4 = compileRequest(
      request(OBESE_MAN, KETOSIS_FIRST, {
        horizonDays: 168,
        safety: { mode: 'M0', optIns: { fastingTier: 'T4' }, fasting: { maxFastHours: 168 }, expertMode: true },
        constraints: { prefersFasting: true },
      }),
    );
    expect(t4.caps.fastTierAllowed.T4).toBe(true);
    const kept = new Map<number, number>();
    for (const ctx of [t3, t4]) {
      const sts = enumerateStructures(ctx).filter((s) => s.skeleton.event);
      expect(sts.length).toBeGreaterThan(0);
      for (const st of sts) {
        const { schedule } = run(ctx, st, Float64Array.from(st.x0));
        const v = validatePlan(ctx, schedule);
        if (!v.ok) throw new Error(`${st.id}: ${v.reasons.join('; ')}`);
        for (const e of schedule.events ?? []) kept.set(e.durationH, (kept.get(e.durationH) ?? 0) + 1);
      }
    }
    expect(kept.get(72) ?? 0).toBeGreaterThan(0);
    expect((kept.get(120) ?? 0) + (kept.get(168) ?? 0)).toBeGreaterThan(0);
    // without expert mode no fast longer than 72 h is ever enumerated
    for (const st of enumerateStructures(t3)) expect(st.skeleton.event?.durationH ?? 0).toBeLessThanOrEqual(72);
  }, 60_000);

  it('7.1.4 idempotence: decode(encode(decode(x))) = decode(x), and rounding is stable', () => {
    const rng = new Rng(3);
    for (const [name, ctx] of ctxs) {
      for (const st of enumerateStructures(ctx).slice(1, 30)) {
        const x = Float64Array.from({ length: st.dim }, () => rng.float());
        const a = decodePlan(ctx, st, x);
        const x2 = encodeValues(st, a.values, a.ranges);
        const b = decodePlan(ctx, st, x2);
        expect(JSON.stringify(b.schedule), `${name} / ${st.id}`).toBe(JSON.stringify(a.schedule));
        const r1 = roundGenome(ctx, st, x);
        const r2 = roundGenome(ctx, st, r1);
        expect(JSON.stringify(decodePlan(ctx, st, r2).schedule)).toBe(JSON.stringify(decodePlan(ctx, st, r1).schedule));
      }
    }
  }, 60_000);

  it('7.1.5 tiers: fasts beyond 24 h need consent, no fasting structures without a served goal; never-tier blocks absent', () => {
    // ruling R-FAST-GATE: the default 24-h tier counts as held, so fat loss ranked first offers 24-h fasts (the optimiser
    // decides); multi-day events and zero-energy days need the T2+ opt-in
    const ctx = compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN));
    const sts = enumerateStructures(ctx);
    expect(ctx.fastingRelevant).toBe(true);
    expect(sts.some((s) => s.skeleton.overlay?.lever === 'fastDay24')).toBe(true);
    for (const s of sts) {
      expect(s.skeleton.event).toBeNull();
      for (const seg of s.skeleton.segments) if (seg.kind === 'phase') expect(['B4', 'B5', 'B7', 'B12', 'B16', 'B17']).not.toContain(seg.block);
      // surplus phases never carry fasts (20 §4C)
      if (s.skeleton.segments.some((g) => g.kind === 'phase' && (g.block === 'B21' || g.block === 'B23'))) expect(s.skeleton.event).toBeNull();
    }
    // a muscle goal ranked above every goal fasting serves: no fasting structures at all
    const muscleFirst = compileRequest(request(MAN_95, [...FAT_LOSS_KEEP_LEAN].reverse(), { safety: { optIns: { fastingTier: 'T3' } } }));
    expect(muscleFirst.fastingRelevant).toBe(false);
    for (const s of enumerateStructures(muscleFirst)) {
      expect(s.skeleton.event).toBeNull();
      expect(s.skeleton.overlay?.lever).not.toBe('fastDay24');
    }
    // T2 consent without T3: 72-h events never enumerated; R1 mode: no deficit blocks at all
    const t2 = compileRequest(request(OBESE_MAN, KETOSIS_FIRST, { safety: { optIns: { fastingTier: 'T2' } } }));
    expect(enumerateStructures(t2).some((s) => s.skeleton.event?.durationH === 72)).toBe(false);
    const r1 = compileRequest(request(WOMAN_62, [{ metric: 'leanTissue', direction: 'maximise' }], { safety: { mode: 'R1' } }));
    const r1s = enumerateStructures(r1);
    for (const s of r1s) for (const seg of s.skeleton.segments) if (seg.kind === 'phase') expect(['B1', 'B2', 'B3', 'B11', 'B12']).not.toContain(seg.block);
    // mixed-role blocks (very-low-fat) stay available at maintenance only
    const b6 = r1s.find((s) => s.skeleton.segments.some((g) => g.kind === 'phase' && g.block === 'B6'));
    if (b6) {
      const { schedule } = run(r1, b6, new Float64Array(b6.dim));
      for (const t of schedule.programs) if (t.energy.kind === 'pctMaintenance') expect(t.energy.pct).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(validatePlan(r1, schedule).ok).toBe(true);
    }
  }, 60_000);
});

describe('D7-04: habitual active exposure (baseline, continuation, planned increments)', () => {
  const taking5: HabitualActiveExposure = { active: 'creatine', gPerDay: 5, schedule: 'daily', state: 'taking' };
  const req = request(LEAN_MAN, [{ metric: 'leanTissue', direction: 'maximise' }, { metric: 'strength', direction: 'maximise' }], { horizonDays: 56, safety: { optIns: { levers: ['creatine'] } } });
  const plain = compileRequest(req);
  const withHabit = (h: readonly HabitualActiveExposure[], extra: Partial<PlanningContext> = {}): PlanningContext => ({ ...plain, habitualActives: h, ...extra });
  const creatineOn = (s: { programs: ReadonlyArray<{ substances?: { creatineG?: number; creatineLoading?: boolean } }> }) => s.programs.map((p) => p.substances?.creatineG ?? 0);

  it('pure rules: only current daily use with a known dose continues; identical actives sum; unknown potency or a weekly regimen is unchecked', () => {
    expect(habitualCreatine([taking5])).toEqual({ continuedGPerDay: 5, unchecked: false });
    expect(habitualCreatine([taking5, { ...taking5, gPerDay: 2 }])).toEqual({ continuedGPerDay: 7, unchecked: false });
    expect(habitualCreatine([{ ...taking5, state: 'onHand' }])).toEqual({ continuedGPerDay: 0, unchecked: false });
    expect(habitualCreatine([{ ...taking5, state: 'stopped' }])).toEqual({ continuedGPerDay: 0, unchecked: false });
    expect(habitualCreatine([{ ...taking5, clinicianStop: true }])).toEqual({ continuedGPerDay: 0, unchecked: false });
    expect(habitualCreatine([{ ...taking5, gPerDay: null }])).toEqual({ continuedGPerDay: 0, unchecked: true });
    expect(habitualCreatine([{ ...taking5, schedule: 'weekly' }])).toEqual({ continuedGPerDay: 0, unchecked: true });
    expect(habitualCreatine(undefined)).toEqual({ continuedGPerDay: 0, unchecked: false });
    const h = habitualCreatine([taking5]);
    expect(plannedCreatineG(h, 0, true, 10)).toEqual({ totalG: 5, incrementG: 0 });
    expect(plannedCreatineG(h, 4, true, 10)).toEqual({ totalG: 5, incrementG: 0 });
    expect(plannedCreatineG(h, 8, true, 10)).toEqual({ totalG: 8, incrementG: 3 });
    expect(plannedCreatineG(h, 8, true, 3)).toEqual({ totalG: 3, incrementG: 0 });
    expect(plannedCreatineG(h, 8, false, 10)).toEqual({ totalG: 0, incrementG: 0 });
  });

  it('observed daily use is in the baseline (no loading); on-hand stock is not', () => {
    const sts = enumerateStructures(withHabit([taking5]));
    const base = decodePlan(withHabit([taking5]), sts[0]!, new Float64Array(0));
    expect(new Set(creatineOn(base.schedule))).toEqual(new Set([5]));
    expect(base.schedule.programs.some((p) => p.substances?.creatineLoading)).toBe(false);
    expect(base.lifestyle.creatineG).toBe(5);
    const onHand = decodePlan(withHabit([{ ...taking5, state: 'onHand' }]), sts[0]!, new Float64Array(0));
    expect(creatineOn(onHand.schedule).every((g) => g === 0)).toBe(true);
  });

  it('every plan continues the habitual dose without adding it again; a creatine lever adds only the increment above it', () => {
    const ctx = withHabit([taking5]);
    const sts = enumerateStructures(ctx).filter((s) => !s.skeleton.baseline);
    const noLever = sts.find((s) => !s.skeleton.creatine)!;
    const p = decodePlan(ctx, noLever, noLever.x0);
    expect(p.lifestyle.creatineG).toBe(5);
    expect(p.lifestyle.creatineIncrementG).toBe(0);
    for (const t of p.schedule.programs) if (t.energy.kind !== 'zero') expect(t.substances?.creatineG).toBe(5);
    const lever = sts.find((s) => s.skeleton.creatine);
    expect(lever, 'a creatine structure (consented, muscle goal, training allowed)').toBeDefined();
    if (lever) {
      const x = Float64Array.from(lever.x0);
      const gi = lever.geneIndex['creatine.g']!;
      x[gi] = 1; // the lever's top dose
      const q = decodePlan(ctx, lever, x);
      expect(q.lifestyle.creatineG).toBeGreaterThanOrEqual(5);
      expect(q.lifestyle.creatineIncrementG).toBeCloseTo(q.lifestyle.creatineG - 5, 9);
      x[gi] = 0; // the lever's lowest dose (3 g) is below the habitual 5 g: the plan carries 5 g, adds nothing
      const r = decodePlan(ctx, lever, x);
      expect(r.lifestyle.creatineG).toBe(5);
      expect(r.lifestyle.creatineIncrementG).toBe(0);
    }
  });

  it('a lock that forbids creatine ends the planned continuation; the baseline keeps the observed use', () => {
    const lockedReq = { ...req, safety: { ...req.safety, plannerLocks: [{ id: 'creatine-cap', value: 0, source: 'clinician' as const }] } };
    const locked = { ...compileRequest(lockedReq), habitualActives: [taking5] };
    expect(locked.caps.creatineAllowed).toBe(false);
    const sts = enumerateStructures(locked);
    const plan = sts.find((s) => !s.skeleton.baseline)!;
    expect(decodePlan(locked, plan, plan.x0).lifestyle.creatineG).toBe(0);
    expect(decodePlan(locked, sts[0]!, new Float64Array(0)).lifestyle.creatineG).toBe(5);
  });

  it('unknown potency is a valid record with an unchecked safety status and no numeric contribution', () => {
    const ctx = withHabit([{ ...taking5, gPerDay: null }]);
    const sts = enumerateStructures(ctx);
    const base = decodePlan(ctx, sts[0]!, new Float64Array(0));
    expect(base.exposureChecks).toEqual([{ active: 'creatine', status: 'unchecked', reasonCode: 'unknownPotencyOrSchedule' }]);
    expect(creatineOn(base.schedule).every((g) => g === 0)).toBe(true);
    const plan = sts.find((s) => !s.skeleton.baseline)!;
    expect(decodePlan(ctx, plan, plan.x0).exposureChecks?.[0]?.status).toBe('unchecked');
  });

  it('without a habitual exposure the decode is unchanged (no continuation, no exposure checks)', () => {
    const sts = enumerateStructures(plain);
    for (const st of sts.slice(0, 12)) {
      const a = decodePlan(plain, st, st.x0);
      const b = decodePlan({ ...plain, habitualActives: [] }, st, st.x0);
      expect(JSON.stringify(b.schedule)).toBe(JSON.stringify(a.schedule));
      expect(a.exposureChecks).toBeUndefined();
      expect(a.lifestyle.creatineIncrementG).toBeUndefined();
    }
  });
});
