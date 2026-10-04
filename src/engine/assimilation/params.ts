/**
 * Assimilation constants (docs/SUITE_SPEC.md §3.5, plan/01-after-launch/research/R11-living-plan.md §3), declared as
 * `ParamDef`s with grades like every engine constant (MODEL_SPEC §0.4). They are NOT part of the physiology registry
 * (`buildModelParams(MODULES)` never sees them, so they are never drawn in ensembles and do not move the registry hash);
 * the living plan reads them through `assimilationParams()` and may override them per person (e.g. unstandardised
 * weigh-ins). SUITE_SPEC §11 item 5 keeps σ_rel, q_w, q_r, the δ prior and clamps provisional until R11 §8 Q1 is settled:
 * each lives in exactly one entry below.
 */
import type { ParamDef } from '../types/params';

const R11 = 'R11 living plan';
const PROPOSED = 'R11 [PROPOSED] engineering choice, grade D, to be tuned on logged data';

function p(name: string, value: number, low: number, high: number, unit: string, grade: ParamDef['grade'], source: string, dossier: string, status: ParamDef['status'], label: string, note?: string): ParamDef {
  return { id: `assimilation.${name}`, value, low, high, unit, grade, source, dossier, status, label, draw: 'fixed', ...(note ? { note } : {}) };
}

export const ASSIMILATION_PARAMS: readonly ParamDef[] = [
  // ---- trend filter (local-linear-trend Kalman, R11 §3.2; SUITE_SPEC §3.5 step 2)
  p('sigmaRel', 0.005, 0.004, 0.008, '1 (fraction of body mass)', 'C', 'Within-person 1-day SD 0.53 % of body mass, standardised morning weighing (PMC10653631; one man, 9,521 days)', `${R11} §3.1-3.2`, 'verified',
    'Weigh-in noise, standardised (SD as a share of body mass)', 'n = 1; free-living users are likely noisier (R11 §8 Q1)'),
  p('sigmaRelUnstd', 0.0065, 0.006, 0.007, '1 (fraction of body mass)', 'D', PROPOSED, `${R11} §3.1`, 'proposed-fit', 'Weigh-in noise, unstandardised (any time of day)'),
  p('qW', 0.03, 0.02, 0.05, 'kg/d at 75 kg', 'D', PROPOSED, `${R11} §3.2 table`, 'proposed-fit', 'Trend process noise (day-to-day genuine mass jitter)', 'scaled linearly with body mass'),
  p('qR', 0.005, 0.003, 0.01, 'kg/d per day at 75 kg', 'D', PROPOSED, `${R11} §3.2 table`, 'proposed-fit', 'Rate process noise (rate changes over weeks, not days)', 'scaled linearly with body mass'),
  p('refMassKg', 75, 75, 75, 'kg', 'D', PROPOSED, `${R11} §3.2`, 'proposed-fit', 'Body mass the q_w and q_r defaults refer to'),
  p('rateInitSdKgD', 0.05, 0.02, 0.1, 'kg/d', 'D', PROPOSED, `${R11} §3.2`, 'proposed-fit', 'Prior SD of the trend rate when the filter starts (0.35 kg/week)'),
  p('outlierSigma', 3.5, 3, 4, 'SD of the innovation', 'D', PROPOSED, `${R11} §3.2 robustness`, 'proposed-fit', 'Innovation size that marks a weigh-in as unusual'),
  p('outlierRMult', 10, 10, 10, '1', 'D', PROPOSED, `${R11} §3.2 robustness`, 'proposed-fit', 'Noise multiplier for an unusual weigh-in (flagged, never deleted)'),
  p('eventRMult', 4, 4, 4, '1', 'D', PROPOSED, `${R11} §3.1 events`, 'proposed-fit', 'Noise multiplier after a declared event (illness, travel, creatine start, diet break, new block)'),
  p('eventDays', 4, 3, 5, 'd', 'D', PROPOSED, `${R11} §3.1 events`, 'proposed-fit', 'Days the event multiplier lasts'),
  p('gapResetDays', 14, 14, 14, 'd', 'D', PROPOSED, `${R11} §3.3 item 3`, 'proposed-fit', 'Days without a weigh-in that reset the trend uncertainty'),
  p('gapResetSdKg', 1, 1, 1, 'kg', 'D', PROPOSED, `${R11} §3.3 item 3`, 'proposed-fit', 'Trend SD after a long gap'),
  p('dowMinDays', 42, 42, 42, 'd', 'D', PROPOSED, `${R11} §3.1 weekly cycle`, 'proposed-fit', 'Days of data before a day-of-week offset is estimated'),
  p('dowShrink', 7, 3, 14, 'weigh-ins', 'D', PROPOSED, `${R11} §3.1 weekly cycle`, 'proposed-fit', 'Shrinkage pseudo-count of each day-of-week offset toward 0'),
  p('ewmaAlpha', 0.1, 0.1, 0.2, '1', 'D', "Hacker's Diet 10 % rule (Walker); MacroFactor documents a recency-weighted average", `${R11} §3.2 display`, 'verified', 'Display trend smoothing (EWMA α)', 'lag (1 − α)/α = 9 d; display only, never used for estimation'),
  // ---- check-in gates (R11 §3.3; SUITE_SPEC §3.5)
  p('checkInMin7', 4, 4, 4, 'weigh-ins', 'D', PROPOSED, `${R11} §3.3 item 2`, 'proposed-fit', 'Weigh-ins in 7 days needed for a check-in (alternative: 10 in 14)'),
  p('checkInMin14', 10, 10, 10, 'weigh-ins', 'D', PROPOSED, `${R11} §3.3 item 2`, 'proposed-fit', 'Weigh-ins in 14 days that also allow a check-in'),
  // ---- energy-balance bias δ (R11 §3.3; SUITE_SPEC §3.5 step 4)
  p('biasPriorSdKcal', 150, 100, 200, 'kcal/d', 'D', PROPOSED, `${R11} §3.3 item 2`, 'proposed-fit', 'Prior SD of the energy-balance correction each week'),
  p('biasClampKcal', 300, 300, 300, 'kcal/d', 'D', PROPOSED, `${R11} §3.3 item 2`, 'proposed-fit', 'Largest energy-balance correction'),
  p('biasMaxStepKcal', 100, 100, 100, 'kcal/d per week', 'D', PROPOSED, `${R11} §3.3 item 2`, 'proposed-fit', 'Largest weekly change of the correction'),
  p('biasAiSdBumpKcal', 50, 50, 50, 'kcal/d', 'D', PROPOSED, `${R11} §6.3 item 8`, 'proposed-fit', 'Prior SD added when most logged energy was AI-estimated'),
  p('biasAiShare', 0.7, 0.7, 0.7, '1', 'D', PROPOSED, `${R11} §6.3 item 8`, 'proposed-fit', 'AI-estimated energy share above which the prior widens'),
  p('biasWindowDays', 20, 14, 28, 'd', 'D', 'MacroFactor expenditure v3 (≈ 20-day window; pauses with > 3 of 7 days unlogged)', `${R11} §3.2 rate detectability`, 'proposed-fit', 'Window of the energy-balance estimate'),
  p('biasMinWeighIns', 10, 10, 10, 'weigh-ins', 'D', PROPOSED, `${R11} §3.2`, 'proposed-fit', 'Weigh-ins in the window needed to update the correction'),
  p('biasMinIntakeDays', 4, 4, 4, 'logged days per week', 'D', PROPOSED, `${R11} §3.2`, 'proposed-fit', 'Logged intake days in each of the last two weeks needed to update the correction'),
  // ---- composition observations at the anchor (R11 §3.3 items 4-5)
  p('girthSdCm', 0.8, 0.7, 1.0, 'cm', 'C', 'Self-measured circumferences: ICC ≥ 0.87, TEM ≈ 0.2-1.9 cm (Springer 2016, BMC Med Res Methodol)', `${R11} §3.3 item 4`, 'verified', 'Noise of a weekly mean waist measurement'),
  p('girthMinWeeks', 3, 3, 4, 'weeks', 'D', PROPOSED, `${R11} §3.3 item 4`, 'proposed-fit', 'Weekly waist means needed before the fat/lean split is nudged'),
  p('biaSdPct', 2.5, 2, 4, '% body fat', 'D', 'Consumer bioimpedance vs DXA; hydration moves it more than the weekly change', `${R11} §3.3 item 5`, 'unverified', 'Noise of a weekly mean body-fat reading from a consumer scale'),
  p('biaMaxGain', 0.3, 0.2, 0.5, '1', 'D', PROPOSED, `${R11} §3.3 item 5`, 'proposed-fit', 'Largest share of the gap a consumer body-fat reading may move the split ("never overrides")'),
  p('dxaSdPct', 1.25, 1, 1.5, '% body fat', 'C', 'DXA body-fat precision (dossier 14)', `${R11} §3.3 item 5`, 'verified', 'Noise of a DXA or clinical body-fat reading'),
  p('modelBfSdPct', 2, 1.5, 3, '% body fat', 'D', PROPOSED, `${R11} §3.3`, 'proposed-fit', "SD of the engine's own body-fat estimate at a check-in"),
];

export interface AssimilationParams {
  sigmaRel: number;
  sigmaRelUnstd: number;
  qW: number;
  qR: number;
  refMassKg: number;
  rateInitSdKgD: number;
  outlierSigma: number;
  outlierRMult: number;
  eventRMult: number;
  eventDays: number;
  gapResetDays: number;
  gapResetSdKg: number;
  dowMinDays: number;
  dowShrink: number;
  ewmaAlpha: number;
  checkInMin7: number;
  checkInMin14: number;
  biasPriorSdKcal: number;
  biasClampKcal: number;
  biasMaxStepKcal: number;
  biasAiSdBumpKcal: number;
  biasAiShare: number;
  biasWindowDays: number;
  biasMinWeighIns: number;
  biasMinIntakeDays: number;
  girthSdCm: number;
  girthMinWeeks: number;
  biaSdPct: number;
  biaMaxGain: number;
  dxaSdPct: number;
  modelBfSdPct: number;
}

/** Nominal values keyed by short name, with optional per-person overrides (validated to stay inside [low, high]). */
export function assimilationParams(overrides: Partial<AssimilationParams> = {}): AssimilationParams {
  const out: Record<string, number> = {};
  for (const d of ASSIMILATION_PARAMS) {
    const name = d.id.slice('assimilation.'.length);
    const o = (overrides as Record<string, number | undefined>)[name];
    out[name] = o !== undefined && Number.isFinite(o) ? Math.min(d.high, Math.max(d.low, o)) : d.value;
  }
  return out as unknown as AssimilationParams;
}

export const ASSIMILATION_DEFAULTS: AssimilationParams = assimilationParams();
