// @vitest-environment node
/** Lever / block registry (18 §4.4.1, §4.4.7) and dossier-17 caps (17 §2.3, §4.3.2). */
import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../../../core/resolveProfile';
import { BLOCKS, BLOCK_IDS } from '../registry/blocks';
import { LEVERS, SCHEDULE_FIELDS, checkLeverRegistry } from '../registry/levers';
import { HC, compileSafetyCaps, fastAllowed, tierForHours } from '../safety';
import { LEAN_MAN, MAN_95, OBESE_MAN, OLDER_WOMAN, WOMAN_62 } from './personas';

const BRANDS = /keto(?!ne)|paleo|atkins|carnivore|zone diet|5:2|16:8|matador|psmf|omad|whole30|mediterranean|dash diet|intermittent fasting/i;

describe('registry', () => {
  it('lever registry passes the registration check; every usable lever writes only Schedule fields', () => {
    expect(checkLeverRegistry()).toEqual([]);
    for (const l of LEVERS) for (const f of l.engineInputs) expect(SCHEDULE_FIELDS).toContain(f);
    // 21 §4J L1-L19 are all registered, usable or with a reason
    for (let i = 1; i <= 19; i++) {
      const l = LEVERS.find((x) => x.id === `L${i}`);
      expect(l, `L${i}`).toBeDefined();
      if (!l!.plannerUsable) expect(l!.unsupportedReason).toBeTruthy();
    }
  });

  it('B0-B22 (+ B23 small surplus, B24 mild deficit) are present, measurable and brand-free; simulate-only blocks are never phases', () => {
    expect(BLOCK_IDS.length).toBe(25);
    for (const id of BLOCK_IDS) {
      const b = BLOCKS[id];
      expect(b.id).toBe(id);
      expect(`${b.name} ${b.rationale} ${b.tradeoffs}`).not.toMatch(BRANDS);
      if (b.energyPct) expect(b.energyPct.min).toBeLessThanOrEqual(b.energyPct.max);
      if (b.durationWeeks) expect(b.durationWeeks.min).toBeLessThanOrEqual(b.durationWeeks.max);
    }
    for (const l of LEVERS) expect(`${l.explain.name} ${l.explain.oneLiner}`).not.toMatch(BRANDS);
    for (const id of ['B4', 'B5', 'B7', 'B17'] as const) expect(BLOCKS[id].use).toBe('simulateOnly');
    // ruling 18:10: 3-7-day fasts are an expert-tier event (never without the T4 attestation)
    expect(BLOCKS.B16.use).toBe('event');
    // numbers copied from 13 §4C
    expect(BLOCKS.B1.energyPct).toEqual({ min: 75, max: 85 });
    expect(BLOCKS.B3.proteinGPerKgBw).toEqual({ min: 2.3, max: 2.4 });
    expect(BLOCKS.B9.carbGPerKgBw).toEqual({ min: 6, max: 10 });
    expect(BLOCKS.B21.energyPct).toEqual({ min: 110, max: 120 });
    // the lean-gain block fills the gap between maintenance and B21 (09 §4.8, 11 §4.8)
    expect(BLOCKS.B23.energyPct).toEqual({ min: 103, max: 110 });
    expect(BLOCKS.B24.energyPct).toEqual({ min: 85, max: 95 });
  });
});

describe('17 caps', () => {
  it('deficit and rate caps follow 17 §2.3', () => {
    const c95 = compileSafetyCaps(resolveProfile(MAN_95), undefined);
    expect(c95.bmi).toBeGreaterThanOrEqual(25);
    expect(c95.deficitCapPct).toBe(HC.deficitCapPct.default);
    const cOb = compileSafetyCaps(resolveProfile(OBESE_MAN), undefined);
    expect(cOb.deficitCapPct).toBe(30);
    expect(cOb.rateCapPct).toBe(1.0);
    const cW = compileSafetyCaps(resolveProfile(WOMAN_62), undefined);
    expect(cW.deficitCapPct).toBeLessThanOrEqual(20);
    expect(cW.energyFloorKcal).toBe(1200);
    const cOld = compileSafetyCaps(resolveProfile(OLDER_WOMAN), undefined);
    expect(cOld.deficitCapPct).toBeLessThanOrEqual(15);
    expect(cOld.rateCapPct).toBeLessThanOrEqual(0.5);
    expect(cOld.fastTierAllowed.T2).toBe(false);
    const lean = compileSafetyCaps(resolveProfile(LEAN_MAN), undefined);
    expect(lean.rateCapPct).toBe(0.5); // BF ≤ floor + 6
  });

  it('fasting tiers: T1 default, T2/T3 need consent and eligibility, never > 72 h in the planner', () => {
    expect(tierForHours(20)).toBe('T0');
    expect(tierForHours(24)).toBe('T1');
    expect(tierForHours(36)).toBe('T2');
    expect(tierForHours(72)).toBe('T3');
    expect(tierForHours(100)).toBe('T4');
    const rp = resolveProfile(OBESE_MAN);
    const none = compileSafetyCaps(rp, undefined);
    expect(fastAllowed(none, 24)).toBe(true);
    expect(fastAllowed(none, 36)).toBe(false);
    const t3 = compileSafetyCaps(rp, { optIns: { fastingTier: 'T3' } });
    expect(fastAllowed(t3, 48)).toBe(true);
    expect(fastAllowed(t3, 72)).toBe(true);
    expect(fastAllowed(t3, 96)).toBe(false);
    const implied = compileSafetyCaps(rp, { fasting: { maxFastHours: 48 } });
    expect(fastAllowed(implied, 48)).toBe(true);
    expect(fastAllowed(implied, 60)).toBe(false);
    const locked = compileSafetyCaps(rp, { optIns: { fastingTier: 'T3' }, plannerLocks: [{ id: 'max-fast', value: 24 }] });
    expect(fastAllowed(locked, 36)).toBe(false);
    const r1 = compileSafetyCaps(rp, { mode: 'R1' });
    expect(r1.deficitCapPct).toBe(0);
    expect(r1.minWindowH).toBe(12);
    expect(r1.carbFloorG).toBeGreaterThanOrEqual(100);
    expect(fastAllowed(r1, 24)).toBe(false);
  });

  it('first-class request limits (longest fast, protein and carbohydrate floors) equal the legacy user locks', () => {
    const rp = resolveProfile(OBESE_MAN);
    const safety = { optIns: { fastingTier: 'T3' as const } };
    const viaFields = compileSafetyCaps(rp, safety, { maxFastHours: 36, proteinFloorGPerKg: 1.6, carbFloorGPerDay: 120 });
    const viaLocks = compileSafetyCaps(rp, {
      ...safety,
      plannerLocks: [
        { id: 'max-fast', value: 36, reasons: [{ rule: 'user' }] },
        { id: 'protein-floor', value: 1.6, reasons: [{ rule: 'user' }] },
        { id: 'carb-floor', value: 120, reasons: [{ rule: 'user' }] },
      ],
    });
    for (const c of [viaFields, viaLocks]) {
      expect(c.maxFastH).toBe(36);
      expect(fastAllowed(c, 36)).toBe(true);
      expect(fastAllowed(c, 48)).toBe(false);
      expect(c.proteinFloorRw).toBe(1.6);
      expect(c.proteinFloorDeficitRw).toBe(1.6);
      expect(c.carbFloorG).toBe(120);
      expect(c.ketogenicAllowed).toBe(false);
    }
    // the user's limit only lowers the tier limit, never raises it
    expect(compileSafetyCaps(rp, undefined, { maxFastHours: 72 }).maxFastH).toBe(24);
    expect(viaFields.fastingLimitReason).toMatch(/36 hours/);
  });

  it('expert tier (T4, 3-7-day fasts) needs expert mode, the T4 opt-in and BMI ≥ 25', () => {
    const rp = resolveProfile(OBESE_MAN);
    expect(compileSafetyCaps(rp, { optIns: { fastingTier: 'T4' } }).fastTierAllowed.T4).toBe(false);
    const t4 = compileSafetyCaps(rp, { optIns: { fastingTier: 'T4' }, expertMode: true });
    expect(t4.fastTierAllowed.T4).toBe(true);
    expect(fastAllowed(t4, 168)).toBe(true);
    expect(fastAllowed(t4, 169)).toBe(false);
    expect(compileSafetyCaps(resolveProfile(WOMAN_62), { optIns: { fastingTier: 'T4' }, expertMode: true }).fastTierAllowed.T4).toBe(false);
  });

  it('consumes the onboarding ScreeningOutcome shape structurally (locks, fasting eligibility, flags)', () => {
    const rp = resolveProfile(WOMAN_62);
    const outcome = {
      plannerAccess: 'restricted' as const,
      mode: 'R2' as const,
      restrictions: ['R2' as const],
      plannerLocks: [
        { id: 'deficit-cap', value: 15, reasons: [{ rule: 'HC-P7', source: 'conditions' }] },
        { id: 'protein-cap', value: 1.3, reasons: [{ rule: 'HC-M2', source: 'conditions' }] },
        { id: 'no-creatine', reasons: [{ rule: 'HC-M12', source: 'conditions' }] },
        { id: 'min-eating-window', value: 8, reasons: [] },
      ],
      fasting: { maxEligibleTier: 'T1' as const, eligibleMaxHours: 24, maxFastHours: 24, effectiveTier: 'T1' as const, optInTiers: [], bindingReasons: [], shortWindowAvailable: false },
      flags: ['kidney-disease'],
    };
    const c = compileSafetyCaps(rp, outcome);
    expect(c.deficitCapPct).toBeLessThanOrEqual(15);
    expect(c.proteinCapRw).toBeLessThanOrEqual(1.3);
    expect(c.creatineAllowed).toBe(false);
    expect(c.minWindowH).toBe(8);
    expect(c.maxFastH).toBeLessThanOrEqual(24);
    expect(c.ketogenicAllowed).toBe(false);
  });
});
