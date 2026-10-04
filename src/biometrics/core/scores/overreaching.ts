/**
 * overreaching.flag (R9 §2.8 "Overreaching", §2.4). Tier P. Grade C; rule thresholds PROPOSED.
 * Flag when (a) hrv.strain_accumulating held on ≥5 of the last 7 days, with A7/A28 > 1 (load.ewma) and no illness red;
 * or (b) hrv.status was 'below' for ≥7 consecutive days. Resting HR alone is never a flag (Bosquet 2008); the
 * 7-day RHR deviation is shown as context only.
 */
import type { ScoreDef, ScoreInput, ScoreResult } from '../types';
import { addDays, makeResult, withheld } from './util';
import { detailNum, priorByDate, RHR_ID } from './rhr';
import { STATUS_ID, STRAIN_ID } from './hrv';
import { NS_ID } from './illness';

export const OR_ID = 'overreaching.flag';
export const OR_VERSION = '1.0.0';
export const LOAD_ID = 'load.ewma';
/** R9 §2.8: strain on ≥5 of 7 days; HRV below on ≥7 consecutive days; A7/A28 > 1. */
export const STRAIN_DAYS = 5;
export const STRAIN_WINDOW = 7;
export const BELOW_RUN = 7;
export const ACWR_MIN = 1;

/** A7/A28 from a load.ewma result: detail a7/a28 (or acute/chronic), else detail acwr. null when absent. */
export function acwrOf(r: ScoreResult | undefined): number | null {
  if (!r) return null;
  const a7 = detailNum(r, 'a7') ?? detailNum(r, 'acute');
  const a28 = detailNum(r, 'a28') ?? detailNum(r, 'chronic');
  if (a7 !== null && a28 !== null && a28 > 0) return a7 / a28;
  return detailNum(r, 'acwr');
}

function computeOr(input: ScoreInput): ScoreResult {
  const d = input.localDate;
  const strain = new Map([...(input.prior[STRAIN_ID] ?? [])].filter((r) => r.status === 'ok').map((r) => [r.scope.localDate, r] as const));
  const status = new Map([...(input.prior[STATUS_ID] ?? [])].filter((r) => r.status === 'ok' || r.status === 'borderline').map((r) => [r.scope.localDate, r] as const));

  let strainDays = 0;
  let strainKnown = 0;
  for (let k = 0; k < STRAIN_WINDOW; k++) {
    const r = strain.get(addDays(d, -k));
    if (!r) continue;
    strainKnown++;
    if (r.state === 'strain_accumulating') strainDays++;
  }
  let belowRun = 0;
  while (status.get(addDays(d, -belowRun))?.state === 'below') belowRun++;
  let statusKnown = 0;
  for (let k = 0; k < BELOW_RUN; k++) if (status.has(addDays(d, -k))) statusKnown++;

  if (strainKnown < STRAIN_DAYS && statusKnown < BELOW_RUN)
    return withheld(OR_ID, OR_VERSION, input, `needs hrv.strain_accumulating on ≥${STRAIN_DAYS} of 7 days or hrv.status on ${BELOW_RUN} consecutive days`);

  const load = [...(input.prior[LOAD_ID] ?? [])].filter((r) => r.scope.localDate <= d && r.status === 'ok').pop();
  const acwr = acwrOf(load);
  const illnessRed = priorByDate(input, NS_ID).get(d)?.state === 'red';
  const branchA = strainDays >= STRAIN_DAYS && acwr !== null && acwr > ACWR_MIN && !illnessRed;
  const branchB = belowRun >= BELOW_RUN;
  const flag = branchA || branchB;
  const rhrDelta7 = detailNum(priorByDate(input, RHR_ID).get(d), 'delta7_bpm');
  return makeResult(OR_ID, OR_VERSION, input, {
    status: 'ok',
    value: flag ? 1 : 0,
    state: flag ? 'possible_overreaching' : 'none',
    confidence: 'low',
    sourceIds: [...(load ? [`${LOAD_ID}@${load.version}`] : [])],
    hashOf: { strainDays, strainKnown, belowRun, acwr, illnessRed },
    contributors: [
      { id: 'strain_days_7', raw: strainDays, unit: 'd', weightConfigured: 1, weightApplied: 1, available: strainKnown > 0 },
      { id: 'acwr', raw: acwr ?? undefined, unit: 'ratio', weightConfigured: 1, weightApplied: acwr === null ? 0 : 1, available: acwr !== null },
      { id: 'hrv_below_run', raw: belowRun, unit: 'd', weightConfigured: 1, weightApplied: 1, available: statusKnown > 0 },
    ],
    detail: { strain_days: strainDays, strain_known: strainKnown, below_run: belowRun, acwr, load_available: acwr !== null, illness_red: illnessRed, branch_strain_load: branchA, branch_hrv_below: branchB, rhr_delta7_bpm: rhrDelta7 },
  });
}

export const overreachingDefs: ScoreDef[] = [
  {
    scoreId: OR_ID,
    title: 'Possible overreaching',
    version: OR_VERSION,
    released: '2026-10-01',
    kind: 'flag',
    label: 'flag',
    inputs: [
      { stream: STRAIN_ID, window: '7d', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: STATUS_ID, window: '7d', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
      { stream: LOAD_ID, window: '28d', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false },
      { stream: NS_ID, window: 'night', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: true },
    ],
    profileInputs: [],
    gates: [`strain_results_7d>=${STRAIN_DAYS} OR status_results_consecutive>=${BELOW_RUN}`],
    formula: {
      fn: `${OR_ID}@${OR_VERSION}`,
      text: 'Flag = (strain_accumulating on ≥5 of 7 days AND A7/A28 > 1 AND NightSignal not red) OR (HRV status below for ≥7 consecutive days).',
    },
    params: [
      { name: 'strain_days', value: STRAIN_DAYS, unit: 'd', sourceRef: 'R9 §2.8', kind: 'proposed' },
      { name: 'strain_window', value: STRAIN_WINDOW, unit: 'd', sourceRef: 'R9 §2.8', kind: 'proposed' },
      { name: 'below_run', value: BELOW_RUN, unit: 'd', sourceRef: 'R9 §2.8', kind: 'proposed' },
      { name: 'acwr_min', value: ACWR_MIN, unit: 'ratio', sourceRef: 'R9 §2.8', kind: 'proposed' },
    ],
    output: { unit: 'flag', range: [0, 1], goodDirection: 'down', display: 'state' },
    uncertainty: { method: 'none', notes: 'Rule-based; grade C.' },
    evidence: {
      mechanism: { status: 'mapped', pathway: 'Sustained vagal withdrawal and unstable HRV under rising load (Plews 2013); RHR unreliable alone (Bosquet 2008)', engineNodes: [] },
      certainty: 'C',
      refs: [{ topicSlug: 'performance-wellbeing-bone', refIds: ['Plews13', 'Bosquet08'] }],
    },
    tierHandling: 'Inherits the HRV inputs: tier C HRV is within-person trend only, so the flag is relative to the person; confidence always low.',
    planEffects: [{ target: 'trainer_briefing', rule: 'Briefed as possible overreaching with its branches; the conflict rule ranks it with load (below illness red, HRV below, sleep debt).', priority: 4 }],
    optInStreams: ['hrv', 'ibi', 'sleep_sessions', 'workouts'],
    dependsOn: [STRAIN_ID, STATUS_ID, LOAD_ID, NS_ID, RHR_ID],
    compute: computeOr,
  },
];
