/** Equipment-aware composition (PLANNER_V2 §8.2-8.5): tolerance, filters, determinism, availability, envelope, shopping, swaps. */
import { describe, expect, it } from 'vitest';
import {
  composeSession,
  composeSessions,
  sessionEquivalence,
  shoppingList,
  swapOptions,
  trainingEnvelope,
  type ResistancePrescription,
  type SessionPrescription,
  type TrainingProfile,
} from '@/catalogues';
import { SEED_CATALOGUE as C } from '@/content/catalogues';
import { CTX, profile } from './helpers';

const FULL_BODY: ResistancePrescription = {
  kind: 'resistance',
  weekday: 1,
  startH: 18,
  maxMin: 60,
  setsByRegion: { chest: 3, upperBack: 3, shoulders: 3, quads: 3, glutes: 3, hamstrings: 2, arms: 2, core: 2 },
};
const HOME: TrainingProfile = profile({ owned: ['dumbbell', 'bench', 'mudgar_heavy', 'treadmill', 'floor_mat', 'chair', 'pullup_bar'] });
const GYM: TrainingProfile = profile({
  owned: ['floor_mat'],
  access: [{ place: 'gym', equipment: ['barbell', 'plates', 'squat_rack', 'bench', 'dumbbell', 'cable_station', 'leg_machine', 'leg_press', 'pullup_bar', 'treadmill', 'rower'], weekdays: [1, 3, 5] }],
  skill: 3,
});

describe('composeSession', () => {
  it('delivers a full-body dose within ±0.5 effective set per region, inside the time cap, for home and gym users', () => {
    for (const p of [HOME, GYM]) {
      const s = composeSession(FULL_BODY, { profile: p, catalogue: C, ctx: CTX });
      expect(s.withinTolerance, JSON.stringify(s.delivered.effectiveSetsByRegion)).toBe(true);
      expect(s.minutes).toBeLessThanOrEqual(FULL_BODY.maxMin + 1e-9);
      for (const [r, t] of Object.entries(FULL_BODY.setsByRegion)) expect((s.delivered.effectiveSetsByRegion as Record<string, number>)[r] ?? 0).toBeGreaterThanOrEqual(t - 0.5);
      for (const it of s.items) expect(it.sets ?? 0).toBeLessThanOrEqual(5);
      const perPattern = new Map<string, number>();
      for (const it of s.items) {
        const pat = C.exercise(it.exerciseId)!.pattern;
        perPattern.set(pat, (perPattern.get(pat) ?? 0) + 1);
      }
      for (const n of perPattern.values()) expect(n).toBeLessThanOrEqual(2);
      expect(s.equivalence.score).toBeGreaterThan(0.85);
    }
  });

  it('is deterministic', () => {
    const a = composeSessions([FULL_BODY, { ...FULL_BODY, weekday: 3 }], { profile: HOME, catalogue: C, ctx: CTX });
    const b = composeSessions([FULL_BODY, { ...FULL_BODY, weekday: 3 }], { profile: HOME, catalogue: C, ctx: CTX });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('never prescribes refused, contraindicated, too-skilled or (when barred) high-impact items', () => {
    const p = profile({ ...HOME, refused: ['push_up', 'verticalPush', 'yoga', 'floor'], injuries: ['shoulder', 'knee'], skill: 1 });
    const rxs: SessionPrescription[] = [FULL_BODY, { kind: 'cardio', weekday: 2, startH: 7, modality: 'run', minutes: 20, pctVo2max: 0.75 }];
    for (const s of composeSessions(rxs, { profile: p, catalogue: C, ctx: CTX, allowImpact: false })) {
      for (const it of s.items) {
        const e = C.exercise(it.exerciseId)!;
        expect(e.id).not.toBe('push_up');
        expect(e.pattern).not.toBe('verticalPush');
        expect(e.tradition).not.toBe('yoga');
        expect(e.tags).not.toContain('floor');
        expect(e.tags).not.toContain('highImpact');
        expect(e.contraTags.some((t) => t === 'shoulder' || t === 'knee'), e.id).toBe(false);
        expect(e.skill).toBeLessThanOrEqual(2);
      }
    }
    const cleared = composeSession(FULL_BODY, { profile: { ...p, cleared: ['shoulder', 'knee'] }, catalogue: C, ctx: CTX });
    expect(cleared.items.some((it) => C.exercise(it.exerciseId)!.contraTags.includes('knee') || C.exercise(it.exerciseId)!.contraTags.includes('shoulder'))).toBe(true);
  });

  it('scores availability highest: owned and free items before a gym visit', () => {
    const p = profile({ owned: ['dumbbell', 'bench', 'floor_mat'], access: GYM.access });
    const s = composeSession({ ...FULL_BODY, setsByRegion: { chest: 3, quads: 3 } }, { profile: p, catalogue: C, ctx: CTX });
    for (const it of s.items) for (const q of it.equipment) expect(p.owned, `${it.exerciseId} uses ${q}`).toContain(q);
    const offDay = composeSession({ ...FULL_BODY, weekday: 0 }, { profile: GYM, catalogue: C, ctx: CTX });
    for (const it of offDay.items) for (const q of it.equipment) expect(['floor_mat']).toContain(q);
  });

  it('uses Indian equipment the person owns and likes: "with your mudgar and treadmill today"', () => {
    const p = profile({ owned: ['mudgar_heavy', 'treadmill'], liked: ['mudgar_two_hand', 'treadmill_run'] });
    const rt = composeSession({ ...FULL_BODY, setsByRegion: { shoulders: 2, upperBack: 2, core: 2 } }, { profile: p, catalogue: C, ctx: CTX });
    expect(rt.items.map((i) => i.exerciseId)).toContain('mudgar_two_hand');
    expect(rt.items.find((i) => i.exerciseId === 'mudgar_two_hand')!.text).toMatch(/Mudgar.*rounds|Mudgar.*× 20/);
    expect(rt.engine.cardio.length).toBe(1);
    const run = composeSession({ kind: 'cardio', weekday: 1, startH: 7, modality: 'run', minutes: 25, pctVo2max: 0.75 }, { profile: p, catalogue: C, ctx: CTX });
    expect(run.items[0]!.exerciseId).toBe('treadmill_run');
    expect(run.withinTolerance).toBe(true);
    expect(run.engine.cardio[0]).toMatchObject({ modality: 'run', durationMin: 25 });
    expect(run.items[0]!.kcal).toBeGreaterThan(200);
  });

  it('writes the delivered dose to the engine sessions and logs "as planned" at parity', () => {
    const s = composeSession(FULL_BODY, { profile: HOME, catalogue: C, ctx: CTX });
    const r = s.engine.resistance!;
    const sum: Record<string, number> = {};
    for (const it of s.items) {
      const e = C.exercise(it.exerciseId)!;
      const factor = e.loadType === 'ballistic' ? 0.5 : 1;
      for (const [reg, w] of Object.entries(e.regions)) sum[reg] = (sum[reg] ?? 0) + w! * factor * (it.sets ?? 0) * (it.holdSec !== undefined ? 0.5 : 1);
    }
    for (const [reg, v] of Object.entries(sum)) expect((r.setsByRegion as Record<string, number>)[reg]).toBeCloseTo(v, 9);
    const asPlanned = sessionEquivalence(s.items.map((i) => i.perf), s.items.map((i) => i.perf), C, CTX);
    expect(asPlanned.credit).toBe(1);
  });

  it('flags a dose the equipment cannot deliver (outside the envelope)', () => {
    const s = composeSession({ ...FULL_BODY, setsByRegion: { upperBack: 4, hamstrings: 4 } }, { profile: profile(), catalogue: C, ctx: CTX });
    expect(s.withinTolerance).toBe(false);
    expect(s.shortfall.length).toBeGreaterThan(0);
  });
});

describe('trainingEnvelope', () => {
  it('a bodyweight-only person has no vertical pull and is short on upper back (R3 §6 gaps); a pull-up bar opens it', () => {
    const bw = trainingEnvelope({ profile: profile(), catalogue: C, ctx: CTX });
    expect(bw.patterns).not.toContain('verticalPull');
    expect(bw.maxEffectiveSetsPerSession.upperBack ?? 0).toBe(0);
    expect(bw.cardioModalities.walk).toBeDefined();
    const bar = trainingEnvelope({ profile: profile({ owned: ['pullup_bar'] }), catalogue: C, ctx: CTX });
    expect(bar.patterns).toContain('verticalPull');
    expect(bar.maxEffectiveSetsPerSession.upperBack!).toBeGreaterThan(3);
  });
  it('a gym gives 100 %1RM-capable loads; the Ideal (full catalogue) dominates every region', () => {
    const gym = trainingEnvelope({ profile: GYM, catalogue: C, ctx: CTX, weekday: 1 });
    expect(gym.maxLoadPct.quads).toBe(100);
    const ideal = trainingEnvelope({ profile: profile({ skill: 5 }), catalogue: C, ctx: CTX, fullCatalogue: true });
    for (const [r, v] of Object.entries(gym.maxEffectiveSetsPerSession)) expect((ideal.maxEffectiveSetsPerSession as Record<string, number>)[r]!).toBeGreaterThanOrEqual(v! - 1e-9);
  });
});

describe('shoppingList', () => {
  const rxs: SessionPrescription[] = [{ ...FULL_BODY, setsByRegion: { upperBack: 4, chest: 3, quads: 3 } }];

  it('lists the items that close the gap, each with a positive benefit; the pull-up bar unlocks vertical pull', () => {
    const list = shoppingList(rxs, { profile: profile(), catalogue: C, ctx: CTX, ideal: true });
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      expect(s.deltaUtility).toBeGreaterThanOrEqual(0.05);
      expect(s.score).toBeCloseTo(s.deltaUtility / (s.priceTier + 1), 12);
    }
    const bar = list.find((s) => s.equipmentIds.includes('pullup_bar'));
    expect(bar).toBeDefined();
    expect(bar!.unlocks).toContain('verticalPull');
    expect(list.filter((s) => s.required).length).toBeLessThanOrEqual(1);
    if (list.some((s) => s.required)) expect(list[0]!.required).toBe(true);
  });

  it('a plan whose dose is met lists nothing required; rungs with no purchase allowance list only free items', () => {
    const met = shoppingList([{ ...FULL_BODY, setsByRegion: { chest: 2, quads: 2 } }], { profile: HOME, catalogue: C, ctx: CTX, ideal: true });
    expect(met.some((s) => s.required)).toBe(false);
    const rung = shoppingList(rxs, { profile: profile(), catalogue: C, ctx: CTX });
    for (const s of rung) expect(s.priceTier).toBe(0);
    const allowed = shoppingList(rxs, { profile: profile({ purchaseAllowance: { maxPriceTier: 1, maxItems: 1 } }), catalogue: C, ctx: CTX });
    expect(allowed.filter((s) => s.priceTier > 0).length).toBeLessThanOrEqual(1);
    for (const s of allowed) expect(s.priceTier).toBeLessThanOrEqual(1);
  });
});

describe('swapOptions', () => {
  it('offers alternatives that keep the dose equivalent, never refused ones', () => {
    const p = profile({ ...HOME, refused: ['dand'] });
    const opts = swapOptions({ exerciseId: 'db_bench_press', setCount: 3, reps: 10, rir: 2 }, { profile: p, catalogue: C, ctx: CTX, weekday: 1, startH: 18, limit: 5 });
    expect(opts.length).toBe(5);
    expect(opts.slice(0, 3).every((o) => o.equivalence.band === 'full')).toBe(true);
    for (let i = 1; i < opts.length; i++) expect(opts[i]!.equivalence.credit).toBeLessThanOrEqual(opts[i - 1]!.equivalence.credit);
    for (const o of opts) {
      expect(o.equivalence.band).not.toBe('different');
      expect(o.exerciseId).not.toBe('dand');
      expect(o.exerciseId).not.toBe('db_bench_press');
    }
    const cardio = swapOptions({ exerciseId: 'treadmill_run', minutes: 20 }, { profile: p, catalogue: C, ctx: CTX, weekday: 1, startH: 7, limit: 3 });
    expect(cardio[0]!.equivalence.credit).toBeGreaterThan(0.9);
  });
});
