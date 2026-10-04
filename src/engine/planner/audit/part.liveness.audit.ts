/**
 * Slow audit, mechanism liveness in full (check 2): every probed edge on the three probe people, the ensemble noise
 * floor (½ of the P10-P90 half-width over parameter draws on the probe's base plan), the module stub for every edge, and
 * the undocumented-mechanism scan. Writes `liveness` to the audit cache.
 */
import { expect, it } from 'vitest';
import { EVIDENCE_EDGES } from '../domain/evidenceGraph';
import { writePart } from './cache';
import { checkLiveness, ensembleFloor } from './liveness';
import type { ProbePersona } from './probes';
import type { LivenessPart } from './report';

const PERSONAS: readonly ProbePersona[] = ['man88', 'woman78', 'leanTrained'];
const DRAWS = 10;

it('mechanism liveness, full (check 2)', () => {
  const t0 = performance.now();
  const specs = [...new Map(EVIDENCE_EDGES.filter((e) => e.probe).map((e) => [JSON.stringify([e.probe!.base, e.probe!.toggle]), { base: e.probe!.base, toggle: e.probe!.toggle }])).values()];
  const floor = ensembleFloor(PERSONAS, specs, DRAWS);
  const rep = checkLiveness(EVIDENCE_EDGES, { personas: PERSONAS, stub: 'all', floor, now: () => performance.now() });
  const part: LivenessPart = { ms: performance.now() - t0, runs: rep.runs + specs.length * PERSONAS.length * DRAWS, floorDraws: DRAWS, edges: rep.edges, undocumented: rep.undocumented };
  writePart('liveness', part);
  expect(rep.edges.length).toBe(EVIDENCE_EDGES.length - EVIDENCE_EDGES.filter((e) => e.status === 'infoOnly').length);
});
