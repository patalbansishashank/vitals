/**
 * Slow audit, static part: checks 1a/1b on the whole corpus, check 3 and check 4 (decode level), the fasting gate vs the
 * evidence graph. Writes `static` to the audit cache.
 */
import { expect, it } from 'vitest';
// eslint-disable-next-line no-restricted-imports -- the dead-field audit traces the Goals screen's limits form into the request
import { defaultConstraints, defaultLongestFast, profileSafetyFrom, toPracticalConstraints, toSafetyInput } from '@/features/planner/request';
import { writePart } from './cache';
import { coverageCorpus } from './corpus';
import { plannerVsSimulator, unrecordedEdgeSeries } from './evaluator';
import { defaultFastMasking, traceFields, type AppMapping } from './fields';
import type { StaticPart } from './report';
import { fastingGateAgreement, geneRanges, reachability, repairRates } from './static';

it('static checks (1a, 1b, 3, 4, fasting gate)', () => {
  const t0 = performance.now();
  const corpus = coverageCorpus();
  const mapping = { defaultConstraints, toPracticalConstraints, toSafetyInput, profileSafetyFrom, defaultLongestFast } as unknown as AppMapping;
  const genes = geneRanges(corpus.filter((_, i) => i % 9 === 0).map((e) => e.request), 30);
  const repair = repairRates(corpus.filter((_, i) => i % 13 === 0).map((e) => e.request), 16, 10);
  const part: StaticPart = {
    ms: 0,
    reach: reachability(corpus),
    genes: { dead: genes.dead, registry: genes.registry, count: Object.keys(genes.genes).length },
    repair: { samples: repair.samples, effectivelyFixed: repair.effectivelyFixed },
    fields: traceFields(mapping).map((t) => ({ key: t.key, verdict: t.verdict, nonMonotone: t.nonMonotone, cls: t.def.class })),
    masking: defaultFastMasking(mapping),
    fastingGate: fastingGateAgreement(corpus[0]!.request.profile),
    evaluator: { unrecorded: unrecordedEdgeSeries(), agreement: plannerVsSimulator(50) },
  };
  part.ms = performance.now() - t0;
  writePart('static', part);
  expect(part.reach.requests).toBe(corpus.length);
});
