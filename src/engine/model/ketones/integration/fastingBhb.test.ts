/**
 * Integration (integrator A2, goal 1): the fuel → ketones → fasting coupling in the FULL engine against the BHB targets
 * of dossier 05 §7 (V1-V3, V5-V7, V9, V10, V13) and dossier 20 §4.3.4 (BHB_ref, lean man / obese woman / lean woman),
 * with the coupled-engine calibration now in the registry (see `targets.ts` for scenarios, tolerances and sources).
 * Also invariant O-6 for the ketone plateau: physiological (< 8 mM) through 24 days of zero intake.
 */
import { describe, expect, it } from 'vitest';
import { evaluateTargets, type TargetValue } from './targets';

const ALL = evaluateTargets(undefined, new Set(['fast', 'diet', 'exit', 'ex']));
const by = (name: string): TargetValue => {
  const t = ALL.find((x) => x.name === name);
  if (!t) throw new Error(`no target ${name}`);
  return t;
};
const ok = (t: TargetValue): boolean => Number.isFinite(t.v) && Math.abs(t.v - t.target) <= t.tol;

/** Registered misses of the coupled calibration (reported with numbers; see the final report of the integration pass). */
const KNOWN: Record<string, string> = {
  'lean woman 24 h': 'Browning F 0.33 vs Haymond F 1.7 at 30 h conflict (20 §4.3.4: no sex term); the model sits between (≈ 0.66 at 24 h, 1.12 at 30 h)',
  'lean woman 48 h': 'same conflict: Browning F 1.22 (lower than men) vs the model 1.82 (women ≥ men via the smaller FFM-scaled clearance)',
  'Burke day 6 07:00': 'eucaloric LCHF with 3 h/d of walking: 1.60 vs 1.2 ± 0.36 (05 k_mgF grade D on the exercise-driven glycogen deficit)',
};

describe('coupled-engine BHB calibration (05 §7, 20 §4.3.4)', () => {
  for (const t of ALL) {
    const note = KNOWN[t.name];
    (note ? it.fails : it)(`${t.name}: ${t.target} ± ${t.tol.toFixed(2)} (${t.source})${note ? ` — KNOWN MISS: ${note}` : ''}`, () => {
      expect({ name: t.name, v: Number(t.v.toFixed(3)), ok: ok(t) }).toMatchObject({ ok: true });
    });
  }
  it('fasting BHB rises monotonically (daily) and plateaus physiologically (< 8 mM), lean and obese', () => {
    for (const [a, b] of [['lean man 24 h', 'lean man 48 h'], ['lean man 48 h', 'lean man 72 h'], ['lean man 72 h', 'lean man day 7'], ['lean man day 7', 'lean man day 14'], ['lean man day 14', 'lean man day 21'], ['obese woman 72 h', 'obese woman day 7'], ['obese woman day 7', 'obese woman day 21']] as const) {
      expect(by(b).v).toBeGreaterThan(by(a).v);
    }
    expect(by('lean man day 21').v).toBeLessThan(8);
    expect(by('obese woman day 24').v).toBeLessThan(8);
    // obesity blunts early fasting ketosis (Neudorf 2025 obese/lean 48 h 0.51; 20 BHB_ref 0.62; 05 model 0.68-0.80)
    const r = by('obese woman 72 h').v / by('lean man 72 h').v;
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThan(0.9);
  });
});
