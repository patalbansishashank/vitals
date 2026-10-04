/**
 * The score catalogue (R9 §4.3): every ScoreDef, all versions side by side. Tier P.
 */
import type { ScoreDef } from '../types';
import { compareVersions, latestVersions as latestOf, scoreOrder as orderOf } from './rescore';
import { loadDefs } from './load';
import { vo2maxDefs } from './vo2max';
// WIRING: agents A/B/D write these concurrently.
import { sleepDefs } from './sleep';
import { hrvDefs } from './hrv';
import { rhrDefs } from './rhr';
import { illnessDefs } from './illness';
import { overreachingDefs } from './overreaching';
import { autonomicDefs } from './autonomic';
import { nightVitalsDefs } from './nightVitals';
import { sleepIndexDefs } from './android/sleepIndex';
import { readinessDefs } from './android/readiness';

export const SCORE_CATALOGUE: ScoreDef[] = [
  ...sleepDefs,
  ...sleepIndexDefs,
  ...rhrDefs,
  ...hrvDefs,
  ...illnessDefs,
  ...overreachingDefs,
  ...autonomicDefs,
  ...nightVitalsDefs,
  ...loadDefs,
  ...vo2maxDefs,
  ...readinessDefs,
];

/** A def by id; `version` omitted → the highest version. */
export function getScoreDef(id: string, version?: string, defs: readonly ScoreDef[] = SCORE_CATALOGUE): ScoreDef | undefined {
  if (version !== undefined) return defs.find((d) => d.scoreId === id && d.version === version);
  return defs.filter((d) => d.scoreId === id).sort((a, b) => compareVersions(b.version, a.version))[0];
}

export function latestVersions(defs: readonly ScoreDef[] = SCORE_CATALOGUE): ScoreDef[] {
  return [...latestOf(defs).values()];
}

export function scoreOrder(defs: readonly ScoreDef[] = SCORE_CATALOGUE): ScoreDef[] {
  return orderOf(defs);
}
