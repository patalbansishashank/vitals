// @vitest-environment node
import { mulberry32 } from '@/engine/core/math';
import type { StimulusVector } from '@/catalogues';
import {
  adherenceProposals,
  adherenceTrend,
  BETA_PRIOR,
  betaCdf,
  betaQuantile,
  costliestItem,
  coverageLabel,
  energyCredit,
  expectedCredit,
  expectedCreditFor,
  fastCredit,
  proteinCredit,
  revealedAdherence,
  scoreDay,
  windowCredit,
  type CreditObservation,
} from '../adherence';
import { catalogueEquivalence } from '../equivalence';
import { addDays } from '../dates';
import type { PrescribedItem } from '../types';

/** The owner's example day: four items, one carrying 20 % of the goal benefit. */
const ITEMS: PrescribedItem[] = [
  { itemId: 'energy', type: 'energy', weight: 0.4, target: { energyKcal: 1900 } },
  { itemId: 'protein', type: 'protein', weight: 0.2, target: { proteinG: 150 } },
  { itemId: 'rtSession:3:0', type: 'rtSession', weight: 0.2, target: { durationMin: 50 } },
  { itemId: 'steps', type: 'steps', weight: 0.2, target: { steps: 9000 } },
];
const allDone = ITEMS.map((i) => ({ itemId: i.itemId, credit: 1, why: 'done' }));

const BACK_SQUAT: StimulusVector = {
  effectiveSetsByRegion: { quads: 6, glutes: 3, hamstrings: 1.5 },
  pattern: 'squat', loadClass: 'moderate', netKcal: 120, mem: 0, hiMinutes: 0, mobilityMinutes: {},
  strength: [{ pattern: 'squat', implement: 'bar', sets: 4, loadPct: 75 }],
};
const GOBLET_SQUAT: StimulusVector = {
  effectiveSetsByRegion: { quads: 6, glutes: 3, hamstrings: 1.5 },
  pattern: 'squat', loadClass: 'moderate', netKcal: 115, mem: 0, hiMinutes: 0, mobilityMinutes: {},
  strength: [{ pattern: 'squat', implement: 'handheld', sets: 4, loadPct: 72 }],
};

describe("owner's example (SUITE_SPEC §3.7): 100 / 80 / equivalent swap 100", () => {
  it('scores the five days as 100, 100, 100, 80, 100', () => {
    const swap = catalogueEquivalence(BACK_SQUAT, GOBLET_SQUAT);
    expect(swap.parity).toBe(true);
    const days = [
      scoreDay(ITEMS, allDone, { final: true }),
      scoreDay(ITEMS, allDone, { final: true }),
      scoreDay(ITEMS, allDone, { final: true }),
      scoreDay(ITEMS, allDone.map((c) => (c.itemId === 'rtSession:3:0' ? { ...c, credit: 0, why: 'session skipped' } : c)), { final: true }),
      scoreDay(ITEMS, allDone.map((c) => (c.itemId === 'rtSession:3:0' ? { ...c, credit: swap.credit, why: 'counts as the planned session' } : c)), { final: true }),
    ];
    expect(days.map((d) => d.score)).toEqual([100, 100, 100, 80, 100]);
    expect(days.every((d) => d.coverage === 1)).toBe(true);
    expect(costliestItem(days[3]!)!.itemId).toBe('rtSession:3:0');
  });

  it('a lighter substitute scores partially (credited for what it trains)', () => {
    const half: StimulusVector = { ...GOBLET_SQUAT, effectiveSetsByRegion: { quads: 3, glutes: 1.5, hamstrings: 0.75 }, netKcal: 60, strength: [{ pattern: 'squat', implement: 'handheld', sets: 2, loadPct: 60 }] };
    const r = catalogueEquivalence(BACK_SQUAT, half);
    expect(r.parity).toBe(false);
    const s = scoreDay(ITEMS, allDone.map((c) => (c.itemId === 'rtSession:3:0' ? { ...c, credit: r.credit } : c)), { final: true });
    expect(s.score!).toBeGreaterThan(80);
    expect(s.score!).toBeLessThan(100);
  });
});

describe('unknown is never failed; coverage rules', () => {
  it('unknown items drop out of both sums', () => {
    const s = scoreDay(ITEMS, [{ itemId: 'energy', credit: 1, why: '' }, { itemId: 'protein', credit: 0.5, why: '' }], { final: true });
    expect(s.coverage).toBeCloseTo(0.6, 12);
    expect(s.score).toBeCloseTo((100 * (0.4 + 0.1)) / 0.6, 9);
    expect(s.items.find((i) => i.itemId === 'steps')!.credit).toBeNull();
    expect(coverageLabel(s)).toBeNull();
  });

  it('coverage < 0.6 is labelled "based on k of n items"; < 0.4 gives no score', () => {
    const fiftyFive = scoreDay([...ITEMS.slice(0, 3), { ...ITEMS[3]!, weight: 0.25 }], [{ itemId: 'energy', credit: 1, why: '' }, { itemId: 'rtSession:3:0', credit: 1, why: '' }], { final: true });
    expect(fiftyFive.coverage).toBeLessThan(0.6);
    expect(coverageLabel(fiftyFive)).toBe('based on 2 of 4 items');
    const none = scoreDay(ITEMS, [{ itemId: 'protein', credit: 1, why: '' }], { final: true });
    expect(none.coverage).toBeCloseTo(0.2, 12);
    expect(none.score).toBeNull();
  });

  it('assumed (backfilled) and paused days are never scored; unconfirmed days are "so far"', () => {
    expect(scoreDay(ITEMS, allDone, { final: true, assumed: true }).score).toBeNull();
    expect(scoreDay(ITEMS, allDone, { final: true, paused: true }).score).toBeNull();
    expect(scoreDay(ITEMS, allDone, { final: false }).final).toBe(false);
  });
});

describe('score properties (random days)', () => {
  const rnd = mulberry32(2026);
  const randomDay = () => {
    const n = 1 + Math.floor(rnd() * 8);
    const raw = Array.from({ length: n }, () => 0.02 + rnd());
    const sum = raw.reduce((a, b) => a + b, 0);
    const items: PrescribedItem[] = raw.map((w, k) => ({ itemId: `i${k}`, type: 'energy', weight: w / sum, target: {} }));
    const credits = items.map((it) => ({ itemId: it.itemId, credit: rnd() < 0.25 ? null : rnd(), why: '' }));
    return { items, credits };
  };

  it('is bounded in [0, 100] (or null) and monotone in every credit', () => {
    for (let t = 0; t < 400; t++) {
      const { items, credits } = randomDay();
      const s = scoreDay(items, credits, { final: true });
      if (s.score !== null) {
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100 + 1e-9);
      }
      const k = Math.floor(rnd() * credits.length);
      if (credits[k]!.credit === null) continue;
      const up = credits.map((c, j) => (j === k ? { ...c, credit: Math.min(1, c.credit! + rnd() * (1 - c.credit!)) } : c));
      const s2 = scoreDay(items, up, { final: true });
      if (s.score !== null) expect(s2.score!).toBeGreaterThanOrEqual(s.score - 1e-9);
    }
  });

  it('adding an unknown item never changes the score; credits outside [0, 1] are clamped', () => {
    for (let t = 0; t < 200; t++) {
      const { items, credits } = randomDay();
      const s = scoreDay(items, credits, { final: true });
      const more = scoreDay([...items, { itemId: 'extra', type: 'steps', weight: 0.3, target: {} }], credits, { final: true });
      if (s.score !== null && more.score !== null) expect(more.score).toBeCloseTo(s.score, 9);
    }
    expect(scoreDay(ITEMS, allDone.map((c) => ({ ...c, credit: 1.7 })), { final: true }).score).toBe(100);
  });
});

describe('credit fast forms', () => {
  it('energy: 1 inside ±5 % (min ±75 kcal); overshoot on a deficit day tapers to 0 at maintenance; undershoot costs at most half', () => {
    expect(energyCredit(1800, 1870, 2400)).toBe(1);
    expect(energyCredit(1000, 1074, 1600)).toBe(1); // ±75 kcal floor
    expect(energyCredit(1800, 2400, 2400)).toBeCloseTo(0, 9);
    const mid = energyCredit(1800, 2100, 2400);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(energyCredit(1800, 900, 2400)).toBeGreaterThanOrEqual(0.5);
    // surplus day: undershoot undoes progress
    expect(energyCredit(3000, 2500, 2500)).toBeCloseTo(0, 9);
  });

  it('protein: full from 90 % up, overshoot scores 1; fasts by hours beyond the overnight gap (18 of 24 h → 0.5)', () => {
    expect(proteinCredit(150, 135)).toBe(1);
    expect(proteinCredit(150, 200)).toBe(1);
    expect(proteinCredit(150, 67.5)).toBeCloseTo(0.5, 9);
    expect(fastCredit(24, 18)).toBeCloseTo(0.5, 12);
    expect(fastCredit(24, 30)).toBe(1);
    expect(fastCredit(24, 10)).toBe(0);
  });

  it('window credit is the energy share eaten inside the window', () => {
    expect(windowCredit(12, 20, [{ clockH: 13, kcal: 600 }, { clockH: 22, kcal: 200 }])).toBeCloseTo(0.75, 12);
    expect(windowCredit(12, 20, [])).toBe(1);
  });
});

describe('rolling trend', () => {
  const asOf = '2026-11-01';
  const day = (k: number, score: number | null, final = true) => ({ date: addDays(asOf, -k), score, final, logged: score !== null });

  it('A_7 needs ≥ 3 scored days; A_28 is a 14-day half-life EWMA; arrow beyond ±5', () => {
    expect(adherenceTrend([day(0, 90), day(1, 80)], asOf).a7).toBeNull();
    const t = adherenceTrend([day(0, 90), day(1, 90), day(2, 90), ...Array.from({ length: 20 }, (_, k) => day(8 + k, 60))], asOf);
    expect(t.a7).toBe(90);
    expect(t.a28!).toBeGreaterThan(60);
    expect(t.a28!).toBeLessThan(90);
    expect(t.arrow).toBe('up');
    expect(t.daysLogged7).toBe(3);
    expect(t.scored28).toBe(23);
    const flat = adherenceTrend(Array.from({ length: 10 }, (_, k) => day(k, 80)), asOf);
    expect(flat.arrow).toBe('steady');
    expect(flat.a28).toBeCloseTo(80, 9);
  });

  it('unscored and unconfirmed days never pull the trend down', () => {
    const t = adherenceTrend([day(0, 95), day(1, null), day(2, 95), day(3, 95), day(4, 10, false)], asOf);
    expect(t.a7).toBe(95);
  });
});

describe('revealed adherence (Beta posteriors)', () => {
  const asOf = '2026-11-01';
  it('starts at the prior Beta(6, 2) and moves with fractional updates, forgetting with a 21-day half-life', () => {
    expect(expectedCreditFor([], 'rtSession')).toBeCloseTo(0.75, 12);
    const obs: CreditObservation[] = Array.from({ length: 10 }, (_, k) => ({ date: addDays(asOf, -k), type: 'rtSession', credit: 0 }));
    const b = revealedAdherence(obs, asOf).find((x) => x.type === 'rtSession' && x.weekday === undefined)!;
    expect(b.opportunities).toBe(10);
    expect(b.a).toBe(BETA_PRIOR.a);
    expect(b.b).toBeGreaterThan(BETA_PRIOR.b + 5);
    expect(b.b).toBeLessThan(BETA_PRIOR.b + 10);
    expect(expectedCredit(b)).toBeLessThan(0.5);
    const old = revealedAdherence(obs.map((o) => ({ ...o, date: addDays(o.date, -63) })), asOf).find((x) => x.weekday === undefined)!;
    expect(old.b - BETA_PRIOR.b).toBeCloseTo((b.b - BETA_PRIOR.b) / 8, 6);
  });

  it('Beta quantiles and the swap and weekday rules', () => {
    expect(betaQuantile(0.8, 1, 1)).toBeCloseTo(0.8, 6);
    expect(betaCdf(0.5, 3, 3)).toBeCloseTo(0.5, 9);
    const skipped: CreditObservation[] = Array.from({ length: 14 }, (_, k) => ({ date: addDays(asOf, -k), type: 'cardioSession', credit: 0.1 }));
    const props = adherenceProposals(revealedAdherence(skipped, asOf), skipped, asOf);
    expect(props.some((p) => p.type === 'cardioSession' && p.rule === 'persistentlySkipped')).toBe(true);
    const thursdays: CreditObservation[] = Array.from({ length: 4 }, (_, k) => ({ date: addDays('2026-10-29', -7 * k), type: 'rtSession', credit: k === 2 ? 1 : 0 }));
    const wk = adherenceProposals(revealedAdherence(thursdays, asOf), thursdays, asOf);
    expect(wk.find((p) => p.rule === 'weekday')?.weekday).toBe(3);
    const fine: CreditObservation[] = Array.from({ length: 14 }, (_, k) => ({ date: addDays(asOf, -k), type: 'energy', credit: 0.9 }));
    expect(adherenceProposals(revealedAdherence(fine, asOf), fine, asOf)).toEqual([]);
  });
});
