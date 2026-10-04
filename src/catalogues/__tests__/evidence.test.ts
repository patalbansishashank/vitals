/** Evidence policy (R5): inclusion by mechanism, band inflation by certainty, mapping by shared mechanism. */
import { describe, expect, it } from 'vitest';
import {
  catalogueEdges,
  certaintyFromAnchor,
  evidenceClause,
  exerciseLabels,
  exerciseMapping,
  inclusionReason,
  inflateBand,
  inflationFactor,
  isIncludable,
  mapIntervention,
  supplementLabel,
  tauCdf,
  tauPrior,
  tauQuantile,
  triQuantile,
  type EvidenceGrade,
  type EvidenceLabel,
} from '@/catalogues';
import { SEED_CATALOGUE as C, SEED_EXERCISES } from '@/content/catalogues';
import { leak } from '@/content/evidence/__tests__/leakScan';

describe('R5 §3.3 worked example 1: gada swings mapped onto effective sets', () => {
  const gada = mapIntervention({
    itemId: 'gada_swing',
    outcomes: ['hypertrophy', 'strength', 'energy'],
    anchor: { kind: 'mechanism', id: 'resistance-effective-sets', grade: 'A' },
    pathway: 'offset load → shoulder, grip and trunk torque → mechanical tension → effective sets → muscle protein synthesis',
    // 3 sets per side at RIR 2: 3 × f_RIR 0.88 × f_load Tri(0.45, 0.8, 1.0)
    inputs: { shouldersEffectiveSets: { value: 3 * 0.88 * 0.8, low: 3 * 0.88 * 0.45, high: 3 * 0.88 * 1.0 } },
    dims: { pattern: 0.5, regions: 1, loadType: 0.5, intensity: 0.5, velocity: 0, rom: 1, volume: 1, duration: 1, cardio: 0.5 },
    indirectness: { population: 0, intervention: 1, outcome: 1 },
    wouldSettle: '10-week trial in untrained adults: mace vs volume-matched dumbbell shoulder work, ultrasound deltoid thickness',
    author: 'dossier',
    median: 0.8,
    wRobust: 0.15,
    extraSigma: 0.06,
  });

  it('S ≈ 0.67 → σ_τ = 0.27 (+0.06 for unknown mass distribution = 0.33), median 0.8, w 0.15', () => {
    expect(gada.similarity.S).toBeCloseTo(0.667, 3);
    expect(gada.tau.sigmaLog - 0.06).toBeCloseTo(0.267, 3);
    expect(gada.tau.sigmaLog).toBeCloseTo(0.33, 2);
    expect(gada.tau).toMatchObject({ median: 0.8, wRobust: 0.15, tauLo: 0.5 });
  });

  it('certainty: anchor A, intervention and outcome downgrades → C', () => {
    expect(gada.certainty).toBe('C');
  });

  it('effective sets ≈ 2.1 (1.2–2.6) on the shoulders from the f_load triangle', () => {
    const per = 3 * 0.88;
    expect(per * triQuantile(0.45, 0.8, 1.0, 0)).toBeCloseTo(1.2, 1);
    expect(per * 0.8).toBeCloseTo(2.1, 1);
    expect(per * triQuantile(0.45, 0.8, 1.0, 1)).toBeCloseTo(2.6, 1);
    const m = gada.mapped.shouldersEffectiveSets!;
    expect(m.p10).toBeLessThan(m.p50);
    expect(m.p50).toBeLessThan(m.p90);
  });

  it('is included (mechanism known, mapped) and worded with its pathway, never as speculative', () => {
    const label: EvidenceLabel = { mechanism: { known: true, pathway: gada.pathway, route: 'mapped' }, certainty: gada.certainty };
    expect(isIncludable(label)).toBe(true);
    const clause = evidenceClause(label, 'shoulder and grip resistance work');
    expect(clause).toMatch(/Counted as shoulder and grip resistance work/);
    expect(clause).toMatch(/range is wide/);
    expect(clause).not.toMatch(/speculative/i);
  });
});

describe('R5 §3.4 worked example 2: sattu as a legume protein', () => {
  const sattu = mapIntervention({
    itemId: 'food.sattu',
    outcomes: ['protein'],
    anchor: { kind: 'item', id: 'pea-protein', grade: 'B' },
    pathway: 'dietary protein → digestible indispensable amino acids → effective protein and per-meal leucine → muscle protein synthesis',
    inputs: { qDaily: { value: 0.76, low: 0.62, high: 0.86 } },
    dims: { foodClass: 1, limitingAminoAcid: 1, processing: 0, leucine: 1, digestion: 1 },
    indirectness: { population: 0, intervention: 0, outcome: 1 },
    wouldSettle: 'DIAAS of roasted Bengal-gram flour in adults',
    author: 'dossier',
  });

  it('S = 0.8 → σ_τ = 0.20, median 1, w 0.10; certainty C', () => {
    expect(sattu.similarity.S).toBeCloseTo(0.8, 9);
    expect(sattu.tau).toMatchObject({ median: 1, wRobust: 0.1 });
    expect(sattu.tau.sigmaLog).toBeCloseTo(0.2, 9);
    expect(sattu.certainty).toBe('C');
  });

  it('Q_meal = √Q_daily · min(1.15, √(Leu%/8)) ≈ 0.83 (0.75–0.89)', () => {
    const qMeal = (q: number, leu: number): number => Math.sqrt(q) * Math.min(1.15, Math.sqrt(leu / 8));
    expect(qMeal(0.76, 7.25)).toBeCloseTo(0.83, 2);
    expect(qMeal(0.62, 7.0)).toBeCloseTo(0.74, 2);
    expect(qMeal(0.86, 7.5)).toBeCloseTo(0.9, 2);
  });
});

describe('R5 counter-example: "jeera water melts fat" (M0)', () => {
  const jeera: EvidenceLabel = { mechanism: { known: false, pathway: '', route: 'none' }, certainty: 'D' };
  it('is not included and is described as not simulated', () => {
    expect(isIncludable(jeera)).toBe(false);
    expect(inclusionReason([jeera])).toMatch(/Not simulated/);
    expect(evidenceClause(jeera)).toMatch(/Not simulated/);
  });
  it('an info-only pathway is not simulated either; direct null evidence excludes', () => {
    const ash: EvidenceLabel = { mechanism: { known: true, pathway: 'stress hormones and sleep', route: 'infoOnly' }, certainty: 'B' };
    expect(isIncludable(ash)).toBe(false);
    expect(inclusionReason([ash])).toMatch(/Not simulated yet/);
    const mapped: EvidenceLabel = { mechanism: { known: true, pathway: 'x', route: 'mapped' }, certainty: 'A' };
    expect(isIncludable(mapped, { directNullOrHarm: true })).toBe(false);
  });
});

describe('grades never gate (R5 §2.5 audit)', () => {
  it('changing every certainty to A or to D leaves inclusion unchanged for every catalogue item', () => {
    const grades: EvidenceGrade[] = ['A', 'B', 'C', 'D'];
    for (const e of SEED_EXERCISES) {
      const labels = Object.values(exerciseLabels(e));
      const base = isIncludable(labels);
      for (const g of grades) expect(isIncludable(labels.map((l) => ({ ...l, certainty: g })))).toBe(base);
    }
    for (const s of C.supplements) {
      const l = supplementLabel(s);
      for (const g of grades) expect(isIncludable({ ...l, certainty: g })).toBe(isIncludable(l));
    }
  });

  it('the D-grade mudgar and gada are in, as mapped items', () => {
    for (const id of ['mudgar_two_hand', 'gada_swing']) {
      const e = C.exercise(id)!;
      expect(e.certainty).toBe('D');
      expect(e.status).toBe('mapped');
      expect(isIncludable(Object.values(exerciseLabels(e)))).toBe(true);
      expect(exerciseMapping(e)!.tau.sigmaLog).toBeGreaterThan(0.2);
    }
  });
});

describe('certainty → band inflation (R5 §2.3)', () => {
  it('a wide A band is unchanged; a narrow D band widens to the floor; the centre never moves', () => {
    const a = inflateBand(10, 8, 12, 'A');
    expect(a).toMatchObject({ low: 8, high: 12, k: 1 });
    const d = inflateBand(1, 0.95, 1.05, 'D');
    expect(d.k).toBeCloseTo(0.35 / (0.1 / 2.563), 6);
    expect(1 - d.low).toBeCloseTo(d.k * 0.05, 9);
    expect((d.low + d.high) / 2).toBeCloseTo(1, 9);
  });
  it('never narrows, keeps asymmetry, clips to physical bounds, works in log space and for fixed params', () => {
    for (const g of ['A', 'B', 'C', 'D'] as const) {
      const r = inflateBand(0.5, 0.3, 0.6, g, { bounds: [0, 1] });
      expect(r.k).toBeGreaterThanOrEqual(1);
      expect(r.low).toBeLessThanOrEqual(0.3);
      expect(r.high).toBeGreaterThanOrEqual(0.6);
      expect(r.low).toBeGreaterThanOrEqual(0);
      expect(r.high).toBeLessThanOrEqual(1);
    }
    expect(inflateBand(0.9, 0.85, 0.95, 'D', { bounds: [0, 1] }).high).toBe(1);
    const lg = inflateBand(14, 12, 16, 'D', { log: true });
    expect(lg.low).toBeGreaterThan(0);
    const fixed = inflateBand(2, 2, 2, 'C');
    expect(fixed.high - fixed.low).toBeCloseTo(2 * 1.2816 * 0.2 * 2, 9);
    expect(inflationFactor('D', 0.05)).toBeGreaterThan(inflationFactor('C', 0.05));
    expect(inflationFactor('A', 0.5)).toBe(1);
  });
  it('certainty of a mapped item: anchor minus indirectness, floor D, +1 for an agreeing trial capped at the anchor', () => {
    expect(certaintyFromAnchor('A', { population: 0, intervention: 1, outcome: 1 })).toBe('C');
    expect(certaintyFromAnchor('B', { population: 2, intervention: 2, outcome: 0 })).toBe('D');
    expect(certaintyFromAnchor('A', { population: 1, intervention: 1, outcome: 0 }, { grade: 'C', sign: 1 })).toBe('B');
    expect(certaintyFromAnchor('B', { population: 0, intervention: 0, outcome: 0 }, { grade: 'B', sign: 1 })).toBe('B');
  });
});

describe('transfer factor τ', () => {
  it('is a proper monotone mixture whose spread grows as similarity falls and for AI-resolved items', () => {
    const t = tauPrior({ S: 0.5 });
    let prev = 0;
    for (let x = 0.05; x < 5; x += 0.05) {
      const c = tauCdf(t, x);
      expect(c).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = c;
    }
    expect(tauCdf(t, 50)).toBeCloseTo(1, 6);
    expect(tauQuantile(t, 0.5)).toBeGreaterThan(tauQuantile(t, 0.1));
    expect(tauPrior({ S: 0.3 }).sigmaLog).toBeGreaterThan(tauPrior({ S: 0.9 }).sigmaLog);
    expect(tauPrior({ S: 1, author: 'ai' }).wRobust).toBeGreaterThanOrEqual(0.25);
  });
});

describe('evidence-graph edges for catalogue items', () => {
  it('every exercise has an energy edge; mapped edges carry τ; no edge without a pathway', () => {
    const edges = catalogueEdges(C);
    for (const e of SEED_EXERCISES) expect(edges.some((x) => x.id === `${e.id}>energy`), e.id).toBe(true);
    for (const e of edges.filter((x) => x.status === 'mapped' && x.from.id === 'gada_swing')) expect(e.tauSd).toBeGreaterThan(0);
    expect(edges.find((x) => x.id === 'mudgar_two_hand>hypertrophy')).toMatchObject({ module: 'muscle', status: 'mapped', certainty: 'D' });
    expect(edges.some((x) => x.from.id === 'creatine_monohydrate' && x.engineInputs.includes('substances.creatineG'))).toBe(true);
  });
  it('wording carries no internal references', () => {
    for (const e of SEED_EXERCISES) {
      for (const l of Object.values(exerciseLabels(e))) {
        const c = evidenceClause(l, 'resistance work');
        expect(leak(c), c).toBeNull();
        expect(c).not.toMatch(/speculative/i);
      }
    }
  });
});
