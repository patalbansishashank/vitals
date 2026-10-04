// @vitest-environment node
/**
 * Evidence-coverage audit checks 2 (reduced) and 3 (PLANNER_V2_SPEC §6.3):
 *  2  mechanism liveness: every modelled / mapped edge with a probe moves its metric with the stated sign on the three
 *     probe personas (nominal Simulator-mode runs, numerical floor), and stubbing the edge's engine module changes the
 *     effect (the module is on the path); the full form with the ensemble noise floor runs in `pnpm audit:planner`;
 *  3  goal evaluator completeness: the planner records every series the edges of a goal metric touch, and the planner-mode
 *     goal values equal the Simulator-mode ones on 50 random plans (1e-9 relative).
 */
import { describe, expect, it } from 'vitest';
import { EVIDENCE_EDGES } from '../evidenceGraph';
import { plannerVsSimulator, unrecordedEdgeSeries } from '../../audit/evaluator';
import { checkLiveness } from '../../audit/liveness';

/**
 * Engine-vs-evidence disagreements (reported to the planner lead, published in docs/PLANNER_COVERAGE.md):
 *  - more protein at the same share of maintenance energy lowers lean tissue in the model (by about 35 g over 12 weeks
 *    in a 20 % deficit): the higher thermic effect of protein deepens the real deficit, which costs more lean tissue than
 *    the protein spares (the research notes expect protein to spare lean tissue in a deficit). The catalogue's protein
 *    items inherit it through the same channel;
 *  - a 10-20 % surplus raises the autophagy signal for one probe person and lowers it for another.
 */
const KNOWN_LIVENESS: Readonly<Record<string, string>> = {
  'protein>protein>leanTissue': 'wrongSign',
  'protein>protein>skeletalMuscle': 'wrongSign',
  'whey_protein>FFM with RT>leanTissue': 'wrongSign',
  'whey_protein>MPS during energy deficit>leanTissue': 'wrongSign',
  'plant_protein>LBM/strength vs whey with RT>leanTissue': 'wrongSign',
  'plant_protein>LBM/strength vs whey with RT>strength': 'wrongSign',
  'casein_presleep>chronic hypertrophy>skeletalMuscle': 'wrongSign',
  'B21>energyIntake>autophagyIdx': 'mixed',
};

/** Sources whose edges no probe can switch: catalogue-only levers, the by-construction rule, the expert tier, caffeine and electrolyte items. */
const NOT_PROBED_SOURCES = new Set(['L2', 'L6', 'L19', 'B16']);

describe('check 2 (reduced): mechanism liveness on three personas', () => {
  const t0 = performance.now();
  const rep = checkLiveness(EVIDENCE_EDGES, { personas: ['man88', 'woman78', 'leanTrained'], stub: 'sampled', now: () => performance.now() });
  const ms = performance.now() - t0;

  it('runs about 300 engine simulations', () => {
    expect(rep.runs).toBeLessThan(450);
    expect(ms).toBeGreaterThan(0);
  });

  it('every probed modelled / mapped edge moves its metric with the stated sign, except the reported disagreements', () => {
    const bad = Object.fromEntries(rep.edges.filter((e) => e.status !== 'live' && e.status !== 'notProbed').map((e) => [e.edge, e.status]));
    expect(bad).toEqual(KNOWN_LIVENESS);
    expect(rep.edges.filter((e) => e.status === 'live').length).toBeGreaterThan(1000);
  });

  it('only edges without a grammar switch are unprobed (or whose condition no probe person meets, e.g. adherence in a surplus)', () => {
    const byId = new Map(EVIDENCE_EDGES.map((e) => [e.id, e]));
    const unprobed = rep.edges.filter((e) => e.status === 'notProbed');
    const noSwitch = new Set(unprobed.filter((e) => !e.note?.startsWith('the condition')).map((e) => byId.get(e.edge)!).filter((e) => e.from.kind !== 'catalogue').map((e) => e.from.id));
    expect([...noSwitch].filter((s) => !NOT_PROBED_SOURCES.has(s))).toEqual([]);
    expect(unprobed.filter((e) => e.note?.startsWith('the condition')).map((e) => e.edge).sort()).toEqual(['B21>energyIntake>adherence', 'B23>energyIntake>adherence']);
  });

  it('stubbing an edge’s engine module changes the effect (the module is on the path)', () => {
    const stubbed = rep.edges.filter((e) => e.stub);
    expect(stubbed.length).toBeGreaterThan(40);
    expect(stubbed.filter((e) => !e.stub!.onPath).map((e) => `${e.edge} (${e.stub!.module})`)).toEqual([]);
  });
});

describe('check 3: goal evaluator completeness', () => {
  it('the planner records every series the edges of a goal metric touch', () => {
    expect(unrecordedEdgeSeries()).toEqual([]);
  });

  it('planner-mode and Simulator-mode goal values agree on 50 random plans (1e-9 relative)', { timeout: 300_000 }, () => {
    const r = plannerVsSimulator(50);
    expect(r.compared).toBe(150);
    expect(r.diffs).toEqual([]);
  });
});
