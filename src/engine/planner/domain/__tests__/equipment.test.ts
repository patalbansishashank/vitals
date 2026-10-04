// @vitest-environment node
/**
 * Equipment-aware prescription (PLANNER_V2_SPEC §8, §9.7 row "Equipment"): the envelope bounds the training genes, the
 * composer delivers the planner's prescriptions within tolerance and the delivered dose is what the schedule carries,
 * refused and contraindicated exercises never appear, everything is deterministic, shopping benefits are the signed
 * re-run differences, rungs without a purchase allowance never require a purchase, and no profile means no change.
 */
import { describe, expect, it } from 'vitest';
import type { ConcreteSession, TrainingProfile } from '@/catalogues';
import { SEED_CATALOGUE as C } from '@/content/catalogues';
import { leak } from '@/content/evidence/__tests__/leakScan';
import { RT_STYLE_MET } from '../../../core/defaults';
import { simulate } from '../../../core/loop';
import type { ResistanceSession, Schedule, TrainingRegion } from '../../../types/schedule';
import { compileRequest, type PlanningContext } from '../context';
import { mergeDay } from '../dayMath';
import { decodePlan } from '../decode';
import {
  catalogueWeekday,
  equipmentEnvelope,
  equipmentFor,
  equipmentHeavyOk,
  equipmentPhrase,
  equipmentRegionCap,
  equipmentSetsCap,
  goalSense,
  purchaseBurden,
  toShoppingItemV2,
  type EquipmentForResult,
} from '../equipment';
import { enumerateStructures, rtPrescription } from '../skeleton';
import type { PlannerRequest, PlannerRequestV2 } from '../types';
import { GOLDEN } from './golden.requests';

const REGIONS: readonly TrainingRegion[] = ['chest', 'upperBack', 'shoulders', 'arms', 'core', 'glutes', 'quads', 'hamstrings', 'calves'];

const profile = (o: Partial<TrainingProfile> = {}): TrainingProfile => ({
  owned: [],
  access: [],
  refused: [],
  liked: [],
  injuries: [],
  skill: 2,
  purchaseAllowance: { maxPriceTier: 0, maxItems: 0 },
  ...o,
});
const NOTHING = profile();
const NOTHING_ALLOW = profile({ purchaseAllowance: { maxPriceTier: 2, maxItems: 2 } });
const HOME = profile({ owned: ['dumbbell', 'bench', 'floor_mat', 'chair', 'pullup_bar'] });
const GYM = profile({
  owned: ['floor_mat'],
  access: [{ place: 'gym', equipment: ['barbell', 'plates', 'squat_rack', 'bench', 'dumbbell', 'cable_station', 'leg_machine', 'leg_press', 'pullup_bar', 'treadmill', 'rower'], weekdays: [0, 1, 2, 3, 4, 5, 6] }],
  skill: 3,
});
const MUDGAR = profile({ owned: ['mudgar_heavy', 'floor_mat'], liked: ['indian'] });

const withTraining = (req: PlannerRequest, training: TrainingProfile | undefined): PlannerRequestV2 => ({ ...req, ...(training ? { training } : {}) });
const ctxOf = (key: 'b' | 'c', training?: TrainingProfile): PlanningContext => compileRequest(withTraining(GOLDEN[key], training));

/** A non-baseline structure's default genome, decoded (the plan the optimiser starts from). */
function planOf(ctx: PlanningContext, which = 1): Schedule {
  const st = enumerateStructures(ctx, 12)[which]!;
  return decodePlan(ctx, st, st.x0).schedule;
}

function dayExercise(s: Schedule, d: number) {
  return mergeDay(s.programs[s.days[d]!.program]!, s.days[d]!.override).exercise ?? [];
}

function allTexts(r: EquipmentForResult): string[] {
  return [r.text, r.infeasible ?? '', ...r.required.map((x) => x.text), ...r.optional.map((x) => x.text)].filter(Boolean);
}

describe('no training profile: every hook is a no-op', () => {
  it('envelope null, caps infinite, strength keeps 82 % 1RM, genes and decoded doses as before', async () => {
    const ctx = ctxOf('c');
    expect(equipmentEnvelope(ctx)).toBeNull();
    expect(equipmentSetsCap(ctx, 3)).toBe(Number.POSITIVE_INFINITY);
    expect(equipmentRegionCap(ctx, 'upperBack')).toBe(Number.POSITIVE_INFINITY);
    expect(equipmentHeavyOk(ctx)).toBe(true);
    expect(rtPrescription(ctx)).toMatchObject({ loadPct: 82, style: 'heavyCompound' });
    const st = enumerateStructures(ctx, 12)[1]!;
    const g = st.genes.find((x) => x.path === 'rt.sets')!;
    expect([g.min, g.max, g.def]).toEqual([5, 20, 11]);
    const sched = planOf(ctx);
    // the v1 dose: every region alike
    for (let d = 0; d < sched.horizonDays; d++)
      for (const s of dayExercise(sched, d)) if (s.kind === 'resistance') expect(new Set(Object.values(s.setsByRegion!)).size).toBe(1);
    const res = await equipmentFor(ctx, sched, { ideal: false });
    expect(res.schedule).toBe(sched);
    expect(res).toMatchObject({ sessions: [], required: [], optional: [], text: '', infeasible: null });
    expect((await equipmentFor(ctx, sched, { ideal: true })).schedule).toBe(sched);
  });
});

describe('envelope (§8.2)', () => {
  it('bounds rt.sets per region and keeps 82 % 1RM only when some region reaches 80 %', () => {
    const bare = ctxOf('c', NOTHING);
    const env = equipmentEnvelope(bare)!;
    expect(env.heavyReachable).toBe(false);
    expect(env.uncoveredRegions).toContain('upperBack');
    expect(rtPrescription(bare)).toMatchObject({ loadPct: 70, style: 'general' });
    const gym = ctxOf('c', GYM);
    expect(equipmentEnvelope(gym)!.heavyReachable).toBe(true);
    expect(rtPrescription(gym)).toMatchObject({ loadPct: 82, style: 'heavyCompound' });
    // decoded doses: no region above what the equipment delivers; uncovered regions get no prescribed sets
    for (const ctx of [bare, ctxOf('b', MUDGAR)]) {
      const sts = enumerateStructures(ctx, 6);
      for (const st of sts.slice(1)) {
        for (const u of [0, 0.5, 1]) {
          const x = new Float64Array(st.dim).fill(u);
          const plan = decodePlan(ctx, st, x);
          for (let d = 0; d < plan.schedule.horizonDays; d++) {
            for (const s of dayExercise(plan.schedule, d)) {
              if (s.kind !== 'resistance') continue;
              for (const r of REGIONS) expect(s.setsByRegion![r] ?? 0, `${st.id} ${r}`).toBeLessThanOrEqual(equipmentRegionCap(ctx, r, s.loadPct1RM) + 1e-3);
              for (const r of equipmentEnvelope(ctx)!.uncoveredRegions) expect(s.setsByRegion![r] ?? 0).toBe(0);
            }
          }
        }
      }
    }
  });

  it('the Ideal and a relaxed equipment group use the full catalogue', () => {
    const ideal = compileRequest({ ...withTraining(GOLDEN.b, NOTHING), ideal: true });
    const relaxed = compileRequest({ ...withTraining(GOLDEN.b, NOTHING), relaxedGroups: ['equipment'] });
    for (const ctx of [ideal, relaxed]) {
      const env = equipmentEnvelope(ctx)!;
      expect(env.ideal).toBe(true);
      expect(env.uncoveredRegions).toEqual([]);
      expect(env.heavyReachable).toBe(true);
    }
  });
});

describe('composition (§8.3)', () => {
  const cases: Array<[string, 'b' | 'c', TrainingProfile]> = [
    ['home, muscle', 'b', HOME],
    ['gym, muscle', 'b', GYM],
    ['home, fat loss + strength', 'c', HOME],
    ['gym, fat loss + strength', 'c', GYM],
    ['bodyweight only', 'b', NOTHING],
  ];

  it.each(cases)('%s: delivers the prescription within tolerance and writes the delivered dose into the schedule', async (_n, key, prof) => {
    const ctx = ctxOf(key, prof);
    const sched = planOf(ctx);
    const res = await equipmentFor(ctx, sched, { ideal: false });
    expect(res.infeasible).toBeNull();
    // one composed session per training session of the horizon, dated
    let n = 0;
    for (let d = 0; d < sched.horizonDays; d++) n += dayExercise(sched, d).length;
    expect(res.sessions.length).toBe(n);
    // the composer tolerance per week and region: short by at most max(10 %, 0.5 per session)
    const T = sched.horizonDays;
    const start = Date.parse(`${sched.startDate}T00:00:00Z`);
    for (let w = 0; w < Math.floor(T / 7); w++) {
      const tgt: Record<string, number> = {};
      const del: Record<string, number> = {};
      const cnt: Record<string, number> = {};
      for (const s of res.sessions) {
        const d = Math.round((Date.parse(`${s.prescription.date}T00:00:00Z`) - start) / 86_400_000);
        if (d < 7 * w || d >= 7 * w + 7 || s.prescription.kind !== 'resistance') continue;
        for (const [r, t] of Object.entries(s.prescription.setsByRegion)) {
          tgt[r] = (tgt[r] ?? 0) + t!;
          del[r] = (del[r] ?? 0) + ((s.delivered.effectiveSetsByRegion as Record<string, number>)[r] ?? 0);
          cnt[r] = (cnt[r] ?? 0) + 1;
        }
      }
      for (const r of Object.keys(tgt)) expect(tgt[r]! - del[r]!, `week ${w} ${r}`).toBeLessThanOrEqual(Math.max(0.1 * tgt[r]!, 0.5 * cnt[r]!) + 1e-9);
    }
    // most sessions meet the per-session tolerance outright
    const rt = res.sessions.filter((s) => s.prescription.kind === 'resistance');
    expect(rt.filter((s) => s.withinTolerance).length / rt.length).toBeGreaterThanOrEqual(0.8);
    // the schedule carries exactly the composed sessions' delivered dose (and MET)
    let i = 0;
    for (let d = 0; d < T; d++) {
      const ex = dayExercise(res.schedule, d);
      const orig = dayExercise(sched, d);
      if (orig.length === 0) {
        expect(ex).toEqual([]);
        continue;
      }
      const composed: ConcreteSession[] = res.sessions.slice(i, i + orig.length);
      i += orig.length;
      const r = composed.find((s) => s.engine.resistance)?.engine;
      const written = ex.find((s) => s.kind === 'resistance') as ResistanceSession | undefined;
      if (r?.resistance) {
        expect(written).toBeDefined();
        for (const reg of REGIONS) expect(written!.setsByRegion![reg] ?? 0).toBeCloseTo(r.resistance.setsByRegion?.[reg] ?? 0, 3);
        expect(written!.met).toBeCloseTo(r.resistanceMet!, 3);
        expect(written!.startH).toBe(orig[0]!.startH);
      }
    }
    expect(i).toBe(res.sessions.length);
    for (const t of allTexts(res)) expect(leak(t), t).toBeNull();
    // the written schedule simulates
    const sim = simulate(ctx.rp, res.schedule, { record: 'daily' });
    expect(Number.isFinite(sim.final.fatMass!)).toBe(true);
  });

  it('never prescribes refused or contraindicated exercises (rungs and the Ideal)', async () => {
    const prof = profile({ ...HOME, refused: ['push_up', 'lunge', 'kettlebell', 'yoga', 'jumping'], injuries: ['knee', 'lumbar'] });
    const ctx = ctxOf('b', prof);
    const sched = planOf(ctx);
    for (const ideal of [false, true]) {
      const res = await equipmentFor(ctx, sched, { ideal });
      expect(res.sessions.length).toBeGreaterThan(0);
      for (const s of res.sessions) {
        for (const it of s.items) {
          const e = C.exercise(it.exerciseId)!;
          expect(e.id).not.toBe('push_up');
          expect(e.pattern).not.toBe('lunge');
          expect(e.tradition).not.toBe('yoga');
          expect(e.tags).not.toContain('jumping');
          expect(it.equipment).not.toContain('kettlebell');
          expect(e.contraTags.some((t) => t === 'knee' || t === 'lumbar'), e.id).toBe(false);
          expect(e.skill).toBeLessThanOrEqual(prof.skill + 1);
        }
      }
    }
  });

  it('is deterministic (rungs, the Ideal, with benefit re-runs)', async () => {
    const ctx = ctxOf('c', NOTHING_ALLOW);
    const sched = planOf(ctx);
    const gd = async (s: Schedule) => [{ goal: 0, delta: s.programs.length * 0.01, unit: 'kg' }];
    for (const ideal of [false, true]) {
      const a = await equipmentFor(ctx, sched, { ideal, goalDelta: gd });
      const b = await equipmentFor(compileRequest(withTraining(GOLDEN.c, NOTHING_ALLOW)), sched, { ideal, goalDelta: gd });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('writes the MET of hybrid and ballistic items (additive ResistanceSession.met)', async () => {
    const ctx = ctxOf('b', MUDGAR);
    const res = await equipmentFor(ctx, planOf(ctx), { ideal: false });
    expect(res.sessions.some((s) => s.items.some((it) => it.exerciseId.startsWith('mudgar')))).toBe(true);
    let hybrid = false;
    for (let d = 0; d < res.schedule.horizonDays; d++) {
      const ex = dayExercise(res.schedule, d);
      const r = ex.find((s) => s.kind === 'resistance') as ResistanceSession | undefined;
      if (!r) continue;
      expect(r.met).toBeGreaterThan(0);
      if (r.met! > RT_STYLE_MET.general + 1 && ex.some((s) => s.kind === 'cardio')) hybrid = true;
    }
    expect(hybrid).toBe(true);
  });

  it('reports a dose the equipment cannot deliver as infeasible, in plain words', async () => {
    const ctx = compileRequest({ ...withTraining(GOLDEN.b, MUDGAR), constraints: { trainingDaysPerWeek: { min: 3, max: 3 }, maxSessionMin: 25 } });
    const sched = planOf(ctx);
    // ask for far more than 25 minutes hold: 6 counted sets for every region
    const heavy: Schedule = {
      ...sched,
      programs: sched.programs.map((p) => (p.exercise ? { ...p, exercise: p.exercise.map((s) => (s.kind === 'resistance' ? { ...s, setsByRegion: Object.fromEntries(REGIONS.map((r) => [r, 6])) } : s)) } : p)),
    };
    const res = await equipmentFor(ctx, heavy, { ideal: false });
    expect(res.infeasible).toMatch(/^With what you have, the sessions cannot deliver the planned .+ work\.$/);
    expect(leak(res.infeasible!)).toBeNull();
  });
});

describe('shopping list (§8.5)', () => {
  it('a rung without a purchase allowance never requires a purchase; the Ideal lists purchases', async () => {
    const ctx = ctxOf('b', NOTHING);
    const sched = planOf(ctx);
    const rung = await equipmentFor(ctx, sched, { ideal: false });
    expect(rung.required.every((r) => r.priceTier === 0)).toBe(true);
    expect(rung.optional.every((r) => r.priceTier === 0)).toBe(true);
    expect(purchaseBurden(rung.required)).toBe(0);
    expect(rung.text).toMatch(/^Uses only what you have\./);
    expect(rung.text).toMatch(/Nothing you have trains the upper back.* directly/);
    const idealCtx = compileRequest({ ...withTraining(GOLDEN.b, NOTHING), ideal: true });
    const ideal = await equipmentFor(idealCtx, planOf(idealCtx), { ideal: true });
    expect([...ideal.required, ...ideal.optional].some((r) => r.priceTier > 0)).toBe(true);
    expect(ideal.text).toMatch(/^Uses equipment you don't have yet: /);
    for (const t of [...allTexts(rung), ...allTexts(ideal)]) {
      expect(leak(t), t).toBeNull();
      expect(t, t).not.toMatch(/\b[a-z]+[A-Z]\w*/); // no internal ids (camelCase) in user text
    }
  });

  it('with an allowance, the item that makes the dose deliverable is required and used', async () => {
    const ctx = ctxOf('b', NOTHING_ALLOW);
    const res = await equipmentFor(ctx, planOf(ctx), { ideal: false });
    expect(res.infeasible).toBeNull();
    expect(res.required.length).toBe(1);
    const req = res.required[0]!;
    expect(req.priceTier).toBeLessThanOrEqual(2);
    expect(req.text).toMatch(/^To make this plan work you'd need .+ \(.+\)\.$/);
    expect(res.text.startsWith(req.text)).toBe(true);
    expect(res.sessions.some((s) => s.items.some((it) => it.equipment.some((q) => (req.equipmentIds ?? [req.equipmentId]).includes(q))))).toBe(true);
    expect(purchaseBurden(res.required)).toBe(req.priceTier > 0 ? 0.05 : 0);
  });

  it('benefits are the signed with − without re-run, stated for a goal the item improves', async () => {
    const ctx = ctxOf('b', NOTHING_ALLOW);
    const sched = planOf(ctx);
    // goal 0 of request (b) is skeletal muscle (maximise): read it from a real engine run
    const goalDelta = async (s: Schedule) => [{ goal: 0, delta: simulate(ctx.rp, s, { record: 'daily' }).final.skeletalMuscle!, unit: 'kg' }];
    const res = await equipmentFor(ctx, sched, { ideal: false, goalDelta });
    const req = res.required[0]!;
    expect(req.benefit.length).toBe(1);
    // the required item adds the work the plan could not do without it: more muscle
    expect(goalSense(ctx, 0)).toBe(1);
    expect(req.benefit[0]!.delta).toBeGreaterThan(0);
    expect(req.text).toMatch(/\(adds [\d.]+ kg skeletal muscle\)\.$/);
    // optional rows that were re-run all improve the goal (non-improving rows are dropped)
    for (const r of res.optional) if (r.benefit.length) expect(r.benefit[0]!.delta).toBeGreaterThan(0);
    // a constant callback improves nothing: re-run optional rows are dropped, the required row stays
    const flat = await equipmentFor(ctx, sched, { ideal: false, goalDelta: async () => [{ goal: 0, delta: 1, unit: 'kg' }] });
    expect(flat.required.length).toBe(1);
    expect(flat.required[0]!.benefit[0]!.delta).toBe(0);
    expect(flat.optional.every((r) => r.benefit.length === 0)).toBe(true);
  });

  it('maps E8 rows field for field, with a plain sentence in the goal direction', () => {
    const fat = ctxOf('c', NOTHING); // goal 0: fat mass down
    const muscle = ctxOf('b', NOTHING); // goal 0: skeletal muscle up
    expect(goalSense(fat, 0)).toBe(-1);
    const row = {
      equipmentId: 'band_loop_long',
      equipmentIds: ['band_loop_long'],
      name: 'Long loop power band',
      priceTier: 1,
      required: true,
      unlocks: ['horizontalPull', 'cardio:row'],
      deltaUtility: 0.4,
      score: 0.2,
      withinAllowance: true,
      benefit: [],
      text: 'x',
    };
    const a = toShoppingItemV2(fat, row, { ideal: false, benefit: [{ goal: 0, delta: -0.4, unit: 'kg' }] });
    expect(a).toMatchObject({ equipmentId: 'band_loop_long', equipmentIds: ['band_loop_long'], priceTier: 1, required: true, unlocks: ['horizontalPull', 'cardio:row'] });
    expect(a.text).toBe("To make this plan work you'd need a long loop power band (0.4 kg less fat mass).");
    // a change against the goal's direction is not called a benefit: the sentence says what the item adds instead
    expect(toShoppingItemV2(fat, row, { ideal: false, benefit: [{ goal: 0, delta: 0.4, unit: 'kg' }] }).text).toBe("To make this plan work you'd need a long loop power band (adds rowing work).");
    expect(toShoppingItemV2(muscle, { ...row, required: false }, { ideal: false, benefit: [{ goal: 0, delta: 0.3, unit: 'kg' }] }).text).toBe('Worth buying: a long loop power band (adds 0.3 kg skeletal muscle).');
    expect(toShoppingItemV2(muscle, row, { ideal: true }).text).toBe('The Ideal plan uses a long loop power band (adds rowing work).');
    expect(equipmentPhrase('Dumbbells (fixed or adjustable)')).toBe('dumbbells');
    expect(equipmentPhrase('Ab wheel')).toBe('an ab wheel');
    expect(equipmentPhrase('Indian clubs (pair)')).toBe('Indian clubs');
  });

  it('purchase burden: 0.05 per required paid item (§8.4)', () => {
    expect(purchaseBurden([])).toBe(0);
    expect(
      purchaseBurden([
        { required: true, priceTier: 2 },
        { required: true, priceTier: 0 },
        { required: false, priceTier: 3 },
        { required: true, priceTier: 1 },
      ]),
    ).toBeCloseTo(0.1, 12);
  });
});

describe('weekday convention', () => {
  it('maps planner weekdays (Monday first) to the catalogue’s (Sunday first)', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(catalogueWeekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});
