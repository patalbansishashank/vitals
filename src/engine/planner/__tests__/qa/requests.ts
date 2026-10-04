/**
 * QA pass 2 (release gate v0.2) planner requests: the five golden requests, autophagy first with the 24-72-h tier and
 * training, fat loss first with the same tier, and the benchmark's ten fuzzed training-split requests. Tier M, the
 * app's "Find plans" budget.
 */
import path from 'node:path';
import { fuzzRequest } from '../../bench/suites/domain';
import { AUTOPHAGY_FIRST_T3, GOLDEN, GOLDEN_SUPPLEMENT_CONSENT, WOMAN_78, type GoldenKey } from '../../domain/__tests__/golden.requests';
import type { PlannerRequestV2 } from '../../domain/types';

/** Where `run.qa.ts` writes the digests and `checks.qa.ts` reads them (QA_OUT_DIR overrides, e.g. qa/results/e5b/planner). */
export const OUT_DIR = process.env['QA_OUT_DIR']
  ? path.resolve(process.env['QA_OUT_DIR'])
  : path.resolve(__dirname, '..', '..', '..', '..', '..', 'qa', 'results', 'q2', 'planner');

export const GOLDEN_QA_KEYS = ['a', 'b', 'c', 'd', 'e'] as const;
export const FUZZ_QA_KEYS = Array.from({ length: 10 }, (_, i) => `fuzz${i}`);
export const QA_KEYS = [...GOLDEN_QA_KEYS, 'af', 'flf', ...FUZZ_QA_KEYS];

/** Fat loss first for the 78-kg woman with the 24-72-h tier opted in (R-FAST-GATE's fat-loss case). */
export const FAT_LOSS_FIRST_T3: PlannerRequestV2 = {
  profile: WOMAN_78,
  goals: [
    { metric: 'fatMass', direction: 'minimise' },
    { metric: 'skeletalMuscle', direction: 'maximise' },
  ],
  horizonDays: 84,
  constraints: { trainingDaysPerWeek: { min: 2, max: 3 }, maxFastHours: 72 },
  safety: { mode: 'M0', optIns: { fastingTier: 'T3' }, fasting: { maxFastHours: 72 } },
  seed: 211,
};

export function qaRequest(key: string): PlannerRequestV2 {
  let req: PlannerRequestV2;
  if (key === 'af') req = AUTOPHAGY_FIRST_T3(3);
  else if (key === 'flf') req = FAT_LOSS_FIRST_T3;
  else if (key.startsWith('fuzz')) req = fuzzRequest(Number(key.slice(4)));
  // the golden tests run (d) and (e) with the persona's supplement consent; QA runs them the same way
  else if (key === 'd' || key === 'e') req = GOLDEN_SUPPLEMENT_CONSENT(GOLDEN[key]);
  else req = GOLDEN[key as GoldenKey];
  const { budget: _budget, ...rest } = req;
  return { ...rest, budget: { tier: 'M' } };
}
