// @vitest-environment node
/**
 * End-to-end planner runs against the real `runEngine` (MODEL_SPEC §10): request → baseline → pipeline → options.
 * Structural assertions always run; assertions that need real physiology use `itPhysio` (skipped while the listed
 * modules are stubs). Budgets are small (the suite checks behaviour, not optimality).
 */
import { EASY_SEARCH, easySearchBudget } from '../../optim/easySearch';
import { hybridLadderShare } from '../../optim/hybrid';
import { describe, expect, it } from 'vitest';
import { runDomainPlanner } from '../planner';
import { validatePlan } from '../validate';
import { compileRequest } from '../context';
import { plannedKcal } from '../decode';
import { itPhysio } from './physio';
import { FAT_LOSS_KEEP_LEAN, LEAN_MAN, MAN_95, WOMAN_62, request } from './personas';

/** Small budgets: the S5 ensemble is off (ensembleSize 0) because chance-constraint repair needs a real tier budget. */
const SMALL = { tier: 'S' as const, totalEU: 300, timeToTarget: false };

describe('planner end-to-end (real engine)', () => {
  it('returns safe, validated options with schedules, simulations, scorecards and explanations', async () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 56, seed: 1, budget: { ensembleSize: 0 } });
    const res = await runDomainPlanner(req, SMALL);
    expect(res.status).toBe('ok');
    expect(res.complete).toBe(true);
    expect(res.options.length).toBeGreaterThanOrEqual(1);
    const ctx = compileRequest(req);
    for (const o of res.options) {
      expect(validatePlan(ctx, o.schedule).ok).toBe(true);
      expect(o.schedule.days.length).toBe(56);
      expect(o.simulation.meta.nDays).toBe(56);
      expect(o.scorecard.length).toBe(2);
      expect(o.name.length).toBeGreaterThan(3);
      expect(o.phases.length).toBeGreaterThanOrEqual(1);
      expect(o.explanation.length).toBeGreaterThan(0);
      expect(o.explanation.join(' ')).toMatch(/no fat-loss bonus/);
      expect(o.safetyNotes.length).toBeGreaterThan(0);
      for (const p of o.phases) expect(`${p.summary} ${p.why}`).not.toMatch(/\bketo\b|keto diet|paleo|atkins|carnivore|zone diet|5:2|matador/i);
    }
    expect(new Set(res.options.map((o) => o.name)).size).toBe(res.options.length);
    expect(res.feasibility.length).toBe(2);
    // the search's own budget (the hybrid's v1 search + its ladder run on top); the fasting-rival comparison may add a
    // few nominal evaluations (≤ 4 + its chance check); the dedicated Easy search (§12.2) runs on top, within its pot
    const easyPot = easySearchBudget('S', 300) + EASY_SEARCH.candidates * (30 + 300) + 2;
    expect(res.provenance.euUsed).toBeLessThanOrEqual(300 + Math.floor(hybridLadderShare('S') * 300) + 1 + easyPot);
  }, 180_000);

  it('result enrichments: daily ensemble bands, progress score, graded safety notes, fasting explanation', async () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 42, seed: 11, budget: { ensembleSize: 3 } });
    const scores: (number | null | undefined)[] = [];
    const res = await runDomainPlanner(req, { tier: 'S', totalEU: 400, timeToTarget: false, onProgress: (p) => scores.push(p.score) });
    // R-FAST-GATE: fat loss (goal 1) can be served by 24-h fasts (default tier), so fasting is offered; the search decides
    expect(res.fasting?.offered).toBe(true);
    expect(res.fasting?.reason).toMatch(/goal 1 \(fat mass\)/);
    expect(scores.some((x) => typeof x === 'number')).toBe(true);
    if (res.status !== 'ok') return; // tiny budget: the P90 chance constraint may reject every finalist
    for (const o of res.options) {
      expect(o.bands?.draws).toBe(3);
      const fm = o.bands!.series.fatMass!;
      expect(fm.p10.length).toBe(43);
      for (let t = 0; t < 43; t++) expect(fm.p10[t]!).toBeLessThanOrEqual(fm.p90[t]! + 1e-6);
      expect(o.bands!.series.leanTissue).toBeDefined();
      expect(o.safetyItems!.length).toBe(o.safetyNotes.length);
      expect(o.safetyItems!.every((x) => ['info', 'caution', 'danger'].includes(x.severity))).toBe(true);
      if (!o.fasting?.used) {
        expect(o.explanation.join(' ')).toMatch(/Fasting was considered because/);
        expect(o.fasting?.rival?.reason).toBeDefined();
      }
    }
  }, 180_000);

  it('is deterministic for a fixed seed', async () => {
    const req = request(WOMAN_62, FAT_LOSS_KEEP_LEAN, { horizonDays: 28, seed: 'fixed', budget: { ensembleSize: 0 } });
    const a = await runDomainPlanner(req, { ...SMALL, totalEU: 120 });
    const b = await runDomainPlanner(req, { ...SMALL, totalEU: 120 });
    expect(JSON.stringify(a.options.map((o) => o.schedule))).toBe(JSON.stringify(b.options.map((o) => o.schedule)));
  }, 180_000);

  it('blocks and rejects per the safety gate and request validation', async () => {
    const blocked = await runDomainPlanner(request({ ...MAN_95, safety: { mode: 'M0', flags: { diabetesMedication: 'insulin' } } }, FAT_LOSS_KEEP_LEAN), SMALL);
    expect(blocked.status).toBe('blocked');
    const r1 = await runDomainPlanner(request(WOMAN_62, [{ metric: 'fatMass', direction: 'target', target: 15 }], { safety: { mode: 'R1' } }), SMALL);
    expect(r1.status).toBe('invalid');
    const bad = await runDomainPlanner(request(MAN_95, [{ metric: 'leanMass', direction: 'maximise' }]), SMALL);
    expect(bad.status).toBe('invalid');
    expect(bad.message).toMatch(/cannot be used as a goal/);
    const short = await runDomainPlanner({ ...request(MAN_95, FAT_LOSS_KEEP_LEAN), horizonDays: 10 }, SMALL);
    expect(short.status).toBe('invalid');
  });

  it('never plans below maintenance for a no-deficit profile (R1) and keeps the ≥ 12-h window', async () => {
    const req = request(WOMAN_62, [{ metric: 'leanTissue', direction: 'maximise' }], { horizonDays: 28, seed: 3, safety: { mode: 'R1' } });
    const res = await runDomainPlanner(req, { ...SMALL, totalEU: 120 });
    const ctx = compileRequest(req);
    for (const o of res.options) {
      const k = plannedKcal(ctx, o.schedule);
      for (let d = 0; d < k.length; d++) expect(k[d]!).toBeGreaterThanOrEqual(ctx.rp.tdee0Kcal * 0.995);
      for (const t of o.schedule.programs) if (t.meals?.window) expect(t.meals.window.lengthH).toBeGreaterThanOrEqual(12 - 1e-9);
    }
  }, 180_000);

  itPhysio(['energy', 'composition', 'water'])(
    '18 §7.7 face validity: 95-kg man, lose fat and keep lean → deficit within the caps, fat falls, protein ≥ 1.6 g/kg',
    async () => {
      const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 112, seed: 7, budget: { ensembleSize: 0 } });
      const res = await runDomainPlanner(req, { ...SMALL, totalEU: 400 });
      expect(res.status).toBe('ok');
      const a = res.options[0]!;
      const fat = a.scorecard[0]!;
      expect(fat.change).toBeLessThan(-1);
      const ctx = compileRequest(req);
      const k = plannedKcal(ctx, a.schedule);
      const mean = k.reduce((s, v) => s + v, 0) / k.length;
      expect(mean / ctx.rp.tdee0Kcal).toBeLessThan(0.97);
      expect(mean / ctx.rp.tdee0Kcal).toBeGreaterThanOrEqual(1 - ctx.caps.deficitCapPct / 100 - 0.01);
      const lean = a.scorecard[1]!;
      expect(lean.change).toBeGreaterThan(-3);
    },
    180_000,
  );

  itPhysio(['energy', 'composition', 'muscle'])(
    'muscle-gain goal first (lean man) → no fasting levers and resistance training in every option',
    async () => {
      const req = request(LEAN_MAN, [{ metric: 'leanTissue', direction: 'maximise' }, { metric: 'fatMass', direction: 'minimise' }], { horizonDays: 84, seed: 5, budget: { ensembleSize: 0 } });
      const res = await runDomainPlanner(req, { ...SMALL, totalEU: 300 });
      expect(res.status).toBe('ok');
      for (const o of res.options) {
        expect(o.schedule.events ?? []).toEqual([]);
        expect(o.schedule.programs.some((p) => (p.exercise ?? []).some((x) => x.kind === 'resistance'))).toBe(true);
      }
    },
    180_000,
  );

  itPhysio(['energy', 'composition', 'water'])(
    '18 §4.14.3 time-to-target: an unattainable fat target gets a required duration or an explicit "not reached"',
    async () => {
      const req = request(MAN_95, [{ metric: 'fatMass', direction: 'target', target: -15, targetKind: 'change' }], { horizonDays: 28, seed: 9, budget: { ensembleSize: 0 } });
      const res = await runDomainPlanner(req, { tier: 'S', totalEU: 200, tttBudgetEU: 150 });
      const f = res.feasibility[0]!;
      expect(f.status).toBe('unattainable');
      expect(f.text).toMatch(/weeks/);
      if (f.requiredWeeks !== null) expect(f.requiredWeeks).toBeGreaterThan(4);
    },
    240_000,
  );
});
