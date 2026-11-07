/**
 * Output series catalogue (docs/MODEL_SPEC.md §6). Static data shared by the engine recorder, the chart, the planner
 * (goal functionals, desirability) and the Evidence library.
 *
 * kind: 'metric' = the 55 outcome metrics (chartable; some goal-eligible) · 'detail' = component/diagnostic series
 * (TDEE stack, weight decomposition, hourly curves) · 'input' = realised inputs echoed as series.
 */
import type { SourceRef } from '../../content/evidence/schema';
import { capabilityAllowsOptimization, type GoalCapability, type Warrant } from '@/lib/bodyContracts';
import type { OperatorId } from '@/lib/measurementOperators';
import type { EvidenceGrade } from './params';
import type { ModuleId, SignalName } from './signals';

/** The eight design categories (design/tokens.css --lm-cat-*). */
export type MetricCategory = 'body' | 'fuel' | 'energy' | 'cellular' | 'hormones' | 'cardio' | 'performance' | 'recovery';

/**
 * Daily aggregation of an hourly quantity: value at 24:00 ('end'), at the day's wake time ('wake': the state at clock time
 * ⌈sleepWakeH⌉, i.e. the value recorded for hour ⌈sleepWakeH⌉ − 1 (`core/math.wakeRecordHour`) — the morning weigh-in before
 * any waking-hour input; used by the scale-weight series and their decomposition), or
 * mean/sum/min/max over the 24 hourly values. Daily-only series are written once in endOfDay and use 'end'. The t = 0
 * value (`SimulationResult.initial`) of a 'wake' series is day 0's wake-hour value (the entered morning weight).
 */
export type DailyAgg = 'end' | 'wake' | 'mean' | 'sum' | 'min' | 'max';
export type Direction = 'up' | 'down' | 'target' | 'context';
/** Planner eligibility (dossier 18 §4.5): 'none' = display only (reason in `goalNote`). */
export type GoalKind = 'target' | 'maximise' | 'minimise' | 'none';
/** 17 §4.6 / orchestrator ruling: blood markers and hormones default to change from the user's own baseline. */
export type Presentation = 'absolute' | 'deltaFromBaseline' | 'index' | 'state';
/** CHART_SPEC §2.1 overlay transform. */
export type OverlayTransform = 'pct' | 'pts' | 'log2' | 'none';
export type LaneType = 'line' | 'line+threshold' | 'index' | 'state' | 'stacked-area' | 'bars' | 'range-only';
/**
 * Uncertainty band method (MODEL_SPEC §8): 'draws' = P10/P90 of the parameter ensemble; 'fixChange:NN' = ±NN % of
 * the predicted change from baseline (dossier 16 §4.11 fallback); 'fixValue:NN' = ±NN % of the value; 'none'.
 */
export type BandMethod = 'draws' | `fixChange:${number}` | `fixValue:${number}` | 'none';

export interface SeriesDef {
  readonly id: string;
  readonly kind: 'metric' | 'detail' | 'input';
  readonly label: string;
  readonly unit: string;
  readonly category: MetricCategory;
  readonly owner: ModuleId | 'core';
  /** 'hourly' series are stored hourly (record 'full') and aggregated daily; 'daily' series are daily only. */
  readonly resolution: 'hourly' | 'daily';
  readonly agg: DailyAgg;
  readonly direction: Direction;
  readonly goal: GoalKind;
  readonly goalNote?: string;
  readonly grade: EvidenceGrade;
  readonly band: BandMethod;
  /** Fallback band when draws are disabled (dossier 16 §4.11), same syntax as `band` minus 'draws'. */
  readonly bandFallback?: BandMethod;
  readonly presentation: Presentation;
  readonly overlay: OverlayTransform;
  readonly lane: LaneType;
  /** Reference/threshold lines for the chart (absolute presentation only). */
  readonly thresholds?: readonly number[];
  /** Mandatory caveat shown with the series (grade C/D or regulated markers). */
  readonly caveat?: string;
  readonly sexes?: readonly ('male' | 'female')[];
  /**
   * Maintainers only: the research-note sections that define the computation ("13 §4.1, 01 §4.2"; "schedule"; ruling ids).
   * Never rendered: the screen uses `sources`.
   */
  readonly src: string;
  /** Evidence topics that define the computation, in order of importance (first = owner). The UI renders these, never `src`. */
  readonly sources: readonly SourceRef[];
  /** Plain-language definition of what the series shows (where the label alone could mislead; Evidence/About texts). */
  readonly description?: string;
}

const CAVEAT_ASI =
  'Autophagy cannot be measured in your organs by any routine test. This line is a relative model signal of conditions linked to autophagy in animal and a few small human studies; it does not tell you how much autophagy happens, where, or whether it improves health. Evidence grade C–D.';
const CAVEAT_MARKER =
  'Blood-marker curves are model trends for an average person, not lab predictions. They cannot diagnose or rule out any condition.';
const CAVEAT_INDEX = 'Relative model index (0–100), not a measurement.';

export const SERIES = [
  // ------------------------------------------------------------------ body (8)
  { id: 'scaleWeight', kind: 'metric', label: 'Scale weight', unit: 'kg', category: 'body', owner: 'water', resolution: 'hourly', agg: 'wake', direction: 'target', goal: 'target', grade: 'A', band: 'draws', bandFallback: 'fixChange:35', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '13 §4.1, 01 §4.2', sources: [{ topic: 'transitions-periodisation' }, { topic: 'body-weight-models' }], description: 'Morning scale weight: the daily value is the weight at the day\'s wake hour (post-void, before eating), as people weigh themselves. The entered weight is taken to be such a morning weight, so day 0 reads it exactly; the hourly curve shows the swings of the day (meals, glycogen and its water, sodium water).' },
  { id: 'fatMass', kind: 'metric', label: 'Fat mass', unit: 'kg', category: 'body', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'down', goal: 'target', grade: 'A', band: 'draws', bandFallback: 'fixChange:35', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '01 §4.1-4.3, 03 §4.4, 11 §4.15', sources: [{ topic: 'body-weight-models' }, { topic: 'protein-muscle' }, { topic: 'energy-surplus' }] },
  { id: 'leanMass', kind: 'metric', label: 'Inferred non-fat scale mass', unit: 'kg', category: 'body', owner: 'water', resolution: 'hourly', agg: 'wake', direction: 'up', goal: 'none', goalNote: 'includes glycogen, water and gut contents; use leanTissue as the goal', grade: 'A', band: 'draws', bandFallback: 'fixChange:50', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '20 §4.5.3, 13 §4.1, 14 M5', sources: [{ topic: 'extended-water-fasting' }, { topic: 'transitions-periodisation' }, { topic: 'body-composition-estimation' }], description: 'Wake-hour scale weight minus fat mass: muscle and organ tissue plus glycogen, body water and gut contents, so it moves with water and glycogen swings. Not DXA lean or skeletal muscle.' },
  { id: 'leanTissue', kind: 'metric', label: 'Lean tissue (protein-based)', unit: 'kg', category: 'body', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'up', goal: 'maximise', goalNote: 'muscle/organ tissue without glycogen and water swings', grade: 'B', band: 'draws', bandFallback: 'fixChange:50', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '01 §4.2, 03 §4.4/4.19, 09 §4.8-4.10, 20 §4.4', sources: [{ topic: 'body-weight-models' }, { topic: 'protein-muscle' }, { topic: 'resistance-training' }, { topic: 'extended-water-fasting' }] },
  { id: 'skeletalMuscle', kind: 'metric', label: 'Skeletal muscle', unit: 'kg', category: 'body', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'up', goal: 'maximise', grade: 'C', band: 'draws', bandFallback: 'fixChange:64', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '03 §4.19 step 7, 09 §4.9', sources: [{ topic: 'protein-muscle' }, { topic: 'resistance-training' }] },
  { id: 'bodyFatPct', kind: 'metric', label: 'Body fat', unit: '%', category: 'body', owner: 'water', resolution: 'hourly', agg: 'wake', direction: 'down', goal: 'target', grade: 'A', band: 'draws', bandFallback: 'fixChange:35', presentation: 'absolute', overlay: 'pts', lane: 'line', src: '14 M1, 01', sources: [{ topic: 'body-composition-estimation' }, { topic: 'body-weight-models' }], description: 'Fat mass as a percentage of the wake-hour scale weight.' },
  { id: 'waist', kind: 'metric', label: 'Waist', unit: 'cm', category: 'body', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'down', goal: 'target', grade: 'B', band: 'draws', bandFallback: 'fixChange:35', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '14 M7-M8', sources: [{ topic: 'body-composition-estimation' }] },
  { id: 'visceralFat', kind: 'metric', label: 'Visceral fat', unit: 'kg', category: 'body', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'down', goal: 'minimise', grade: 'B', band: 'draws', bandFallback: 'fixChange:50', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '14 M6-M7, 06 §4.10', sources: [{ topic: 'body-composition-estimation' }, { topic: 'cardiometabolic-markers' }] },

  // ------------------------------------------------------------------ fuel (9)
  { id: 'glycogenTotal', kind: 'metric', label: 'Glycogen (total)', unit: 'g', category: 'fuel', owner: 'fuel', resolution: 'hourly', agg: 'end', direction: 'context', goal: 'target', goalNote: 'performance goals only', grade: 'B', band: 'draws', bandFallback: 'fixValue:30', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '04 §4.1-4.10', sources: [{ topic: 'carbohydrate-glycogen-insulin' }] },
  { id: 'liverGlycogen', kind: 'metric', label: 'Liver glycogen', unit: 'g', category: 'fuel', owner: 'fuel', resolution: 'hourly', agg: 'end', direction: 'context', goal: 'none', goalNote: 'display; drives ketosis', grade: 'B', band: 'draws', bandFallback: 'fixValue:30', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '04 §4.2, §4.8', sources: [{ topic: 'carbohydrate-glycogen-insulin' }] },
  { id: 'muscleGlycogen', kind: 'metric', label: 'Muscle glycogen', unit: 'g', category: 'fuel', owner: 'fuel', resolution: 'hourly', agg: 'end', direction: 'context', goal: 'maximise', goalNote: 'performance goals only', grade: 'B', band: 'draws', bandFallback: 'fixValue:30', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '04 §4.4-4.7', sources: [{ topic: 'carbohydrate-glycogen-insulin' }] },
  { id: 'bhb', kind: 'metric', label: 'Blood ketones (BHB)', unit: 'mmol/L', category: 'fuel', owner: 'ketones', resolution: 'hourly', agg: 'mean', direction: 'target', goal: 'target', grade: 'B', band: 'draws', bandFallback: 'fixValue:30', presentation: 'absolute', overlay: 'log2', lane: 'line+threshold', thresholds: [0.5, 3.0], src: '05 §4.1-4.5, §4.17', sources: [{ topic: 'fat-oxidation-ketosis' }] },
  { id: 'ketosisState', kind: 'metric', label: 'Ketosis state', unit: 'state', category: 'fuel', owner: 'ketones', resolution: 'hourly', agg: 'wake', direction: 'context', goal: 'none', goalNote: 'use hoursInKetosis as the goal', grade: 'A', band: 'none', presentation: 'state', overlay: 'none', lane: 'state', src: '05 §6 (0 none <0.2, 1 light, 2 nutritional 0.5-3, 3 fasting, 4 warning); daily = the morning fasting value (05 §6 "morning fasting BHB")', sources: [{ topic: 'fat-oxidation-ketosis' }], description: 'Hourly: the ketosis category of the blood-ketone level that hour. Daily: the category of the morning fasting value on waking, the convention of the studies (a day counts as nutritional ketosis when the morning value is at least 0.5 mmol/L). Short peaks before a late first meal or after a fasted workout do not make a ketosis day.' },
  { id: 'hoursInKetosis', kind: 'metric', label: 'Hours in ketosis', unit: 'h/d', category: 'fuel', owner: 'ketones', resolution: 'daily', agg: 'end', direction: 'target', goal: 'maximise', grade: 'B', band: 'draws', bandFallback: 'fixValue:30', presentation: 'absolute', overlay: 'none', lane: 'bars', src: '05 §6', sources: [{ topic: 'fat-oxidation-ketosis' }] },
  { id: 'ketoAdaptation', kind: 'metric', label: 'Keto-adaptation index', unit: '%', category: 'fuel', owner: 'ketones', resolution: 'daily', agg: 'end', direction: 'context', goal: 'maximise', grade: 'C', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'index', src: '05 §4.11 combined index 50·(A_f + A_s): the dossier\'s two keto-adaptation states, fast (A_f, days, §4.11.1, grade B) and slow (A_s, weeks, §4.11.2, grade C), equally weighted (PROPOSED; release check 2026-10-01 — was 100·A_f); components: ketoAdaptFast, ketoAdaptSlow', sources: [{ topic: 'fat-oxidation-ketosis' }], description: 'Combined index of the two adaptation processes of a low-carbohydrate diet or a fast, each counted half. Fat-oxidation adaptation (days): muscles and liver shift to burning fat — about 90 % complete after 5 days under roughly 50 g of carbohydrate a day, and lost again within about 5 days of high-carbohydrate eating. Ketone-kinetics adaptation (weeks): muscles take up fewer ketones and leave them for the brain — it builds over 2–3 weeks only while blood ketones stay above about 0.5 mmol/L, mostly during fasting. On a ketogenic diet the index settles near 55–65 % within 3–4 weeks: the fast half completes in about a week, the slow half stays small unless ketones run high (a deficit or a fast).' },
  { id: 'fatOxidation', kind: 'metric', label: 'Fat oxidation', unit: 'g/d', category: 'fuel', owner: 'fuel', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', goalNote: 'fat balance, not oxidation, sets fat loss', grade: 'B', band: 'draws', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '04 §4.10-4.12', sources: [{ topic: 'carbohydrate-glycogen-insulin' }] },
  { id: 'glucose', kind: 'metric', label: 'Blood glucose', unit: 'mmol/L', category: 'fuel', owner: 'intake', resolution: 'hourly', agg: 'mean', direction: 'down', goal: 'minimise', grade: 'C', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '04 §4.16', sources: [{ topic: 'carbohydrate-glycogen-insulin' }] },

  // ------------------------------------------------------------------ energy (6)
  { id: 'tdee', kind: 'metric', label: 'Energy expenditure (TDEE)', unit: 'kcal/d', category: 'energy', owner: 'energy', resolution: 'hourly', agg: 'sum', direction: 'context', goal: 'maximise', goalNote: 'preserve expenditure', grade: 'A', band: 'draws', bandFallback: 'fixValue:26', presentation: 'absolute', overlay: 'pct', lane: 'stacked-area', src: '02 §4.13', sources: [{ topic: 'energy-expenditure' }] },
  { id: 'rmr', kind: 'metric', label: 'Resting metabolic rate', unit: 'kcal/d', category: 'energy', owner: 'energy', resolution: 'hourly', agg: 'sum', direction: 'up', goal: 'maximise', grade: 'A', band: 'draws', bandFallback: 'fixValue:13', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '02 §4.1-4.3', sources: [{ topic: 'energy-expenditure' }] },
  { id: 'neat', kind: 'metric', label: 'Non-exercise movement', unit: 'kcal/d', category: 'energy', owner: 'energy', resolution: 'hourly', agg: 'sum', direction: 'up', goal: 'none', goalNote: 'follows steps and adaptation', grade: 'B', band: 'draws', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '02 §4.6, 10 §4.13', sources: [{ topic: 'energy-expenditure' }, { topic: 'cardio-activity' }] },
  { id: 'metabolicAdaptation', kind: 'metric', label: 'Metabolic adaptation', unit: 'kcal/d', category: 'energy', owner: 'energy', resolution: 'daily', agg: 'end', direction: 'up', goal: 'maximise', goalNote: 'closer to 0 is better', grade: 'B', band: 'draws', presentation: 'absolute', overlay: 'none', lane: 'line', src: '02 §4.8 (AT_R + AT_N)', sources: [{ topic: 'energy-expenditure' }] },
  { id: 'energyBalance', kind: 'metric', label: 'Energy balance', unit: 'kcal/d', category: 'energy', owner: 'energy', resolution: 'hourly', agg: 'sum', direction: 'target', goal: 'none', goalNote: 'an input consequence', grade: 'A', band: 'draws', presentation: 'absolute', overlay: 'none', lane: 'line', src: '01, 02', sources: [{ topic: 'body-weight-models' }, { topic: 'energy-expenditure' }] },
  { id: 'maintenance', kind: 'metric', label: 'Maintenance energy', unit: 'kcal/d', category: 'energy', owner: 'energy', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', goalNote: 'reference line', grade: 'B', band: 'draws', bandFallback: 'fixValue:26', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '02 §4.13 EI_inst at the scheduled activity (R-MAINT)', sources: [{ topic: 'energy-expenditure' }], description: 'The energy that would keep your body as it is today weight-stable at the exercise and steps this schedule plans. It includes metabolic adaptation, so it falls as you lose weight and your body adapts; it assumes your usual food mix (a high-protein plan burns a little more, 20-60 kcal/day, which shows in total expenditure). It starts from your resting metabolism: a measured body-fat % (DXA or BIA) for a trained or very muscular person switches the estimate from Mifflin-St Jeor to Cunningham, which is based on lean mass and runs 5-15 % higher, about half from the lean mass the measurement reveals and half from the equation (it predicts trained people better).' },

  // ------------------------------------------------------------------ cellular (5)
  { id: 'autophagyIdx', kind: 'metric', label: 'Autophagy signal', unit: 'index', category: 'cellular', owner: 'cellular', resolution: 'hourly', agg: 'mean', direction: 'context', goal: 'maximise', goalNote: 'never traded against grade A/B goals', grade: 'D', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'index', caveat: CAVEAT_ASI, src: '08 §4.10', sources: [{ topic: 'autophagy-longevity' }] },
  { id: 'mtorIdx', kind: 'metric', label: 'mTOR activity', unit: 'index', category: 'cellular', owner: 'cellular', resolution: 'hourly', agg: 'mean', direction: 'context', goal: 'none', goalNote: 'advanced signalling view', grade: 'C', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'index', caveat: CAVEAT_INDEX, src: '08 §4.11', sources: [{ topic: 'autophagy-longevity' }] },
  { id: 'ampkIdx', kind: 'metric', label: 'AMPK activity', unit: 'index', category: 'cellular', owner: 'cellular', resolution: 'hourly', agg: 'mean', direction: 'context', goal: 'none', goalNote: 'advanced signalling view', grade: 'C', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'index', caveat: CAVEAT_INDEX, src: '08 §4.6', sources: [{ topic: 'autophagy-longevity' }] },
  { id: 'mps', kind: 'metric', label: 'Muscle protein synthesis', unit: '% of reference', category: 'cellular', owner: 'muscle', resolution: 'hourly', agg: 'mean', direction: 'up', goal: 'none', goalNote: 'acute MPS does not predict growth', grade: 'C', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'index', caveat: CAVEAT_INDEX, src: '03 §4.7, 09 §4.4', sources: [{ topic: 'protein-muscle' }, { topic: 'resistance-training' }] },
  { id: 'igf1', kind: 'metric', label: 'IGF-1', unit: 'rel', category: 'cellular', owner: 'hormones', resolution: 'daily', agg: 'end', direction: 'target', goal: 'target', goalNote: 'U-shaped; user-chosen direction', grade: 'B', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '08 §4.12', sources: [{ topic: 'autophagy-longevity' }] },

  // ------------------------------------------------------------------ hormones & appetite (7)
  { id: 'hunger', kind: 'metric', label: 'Hunger pressure', unit: 'index', category: 'hormones', owner: 'appetite', resolution: 'daily', agg: 'end', direction: 'down', goal: 'minimise', grade: 'C', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'index', caveat: CAVEAT_INDEX, src: '12 §4.9', sources: [{ topic: 'hormones-appetite' }] },
  { id: 'leptin', kind: 'metric', label: 'Leptin', unit: 'rel', category: 'hormones', owner: 'hormones', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', goalNote: 'constraint/guard only', grade: 'B', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '12 §4.1', sources: [{ topic: 'hormones-appetite' }] },
  { id: 't3', kind: 'metric', label: 'Thyroid (T3)', unit: 'rel', category: 'hormones', owner: 'hormones', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', goalNote: 'guard only', grade: 'B', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '12 §4.3', sources: [{ topic: 'hormones-appetite' }] },
  { id: 'cortisol', kind: 'metric', label: 'Cortisol', unit: 'rel', category: 'hormones', owner: 'hormones', resolution: 'daily', agg: 'end', direction: 'down', goal: 'none', grade: 'C', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '12 §4.4', sources: [{ topic: 'hormones-appetite' }] },
  { id: 'testosterone', kind: 'metric', label: 'Testosterone', unit: 'rel', category: 'hormones', owner: 'hormones', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', goalNote: 'guard only', grade: 'B', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, sexes: ['male'], src: '12 §4.5', sources: [{ topic: 'hormones-appetite' }] },
  { id: 'menstrualRisk', kind: 'metric', label: 'Menstrual concern index (research)', unit: 'index', category: 'hormones', owner: 'hormones', resolution: 'daily', agg: 'end', direction: 'down', goal: 'none', goalNote: 'constraint for women', grade: 'B', band: 'draws', presentation: 'absolute', overlay: 'pts', lane: 'line', sexes: ['female'], src: '19 §4.9 P_LPD (12 §4.6 R_MD = registered alternative, MODEL_SPEC R-MENS)', sources: [{ topic: 'performance-wellbeing-bone' }] },
  { id: 'adherence', kind: 'metric', label: 'Plan adherence index', unit: '%', category: 'hormones', owner: 'appetite', resolution: 'daily', agg: 'end', direction: 'up', goal: 'maximise', goalNote: 'planner ranks outcome × P_surv', grade: 'D', band: 'draws', presentation: 'absolute', overlay: 'pts', lane: 'line', caveat: CAVEAT_INDEX, src: '12 §4.10', sources: [{ topic: 'hormones-appetite' }] },

  // ------------------------------------------------------------------ cardio (9)
  { id: 'insulinSensitivity', kind: 'metric', label: 'Insulin sensitivity', unit: 'rel', category: 'cardio', owner: 'cardiometabolic', resolution: 'daily', agg: 'end', direction: 'up', goal: 'maximise', grade: 'B', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '04 §4.18 (S_I = S_hep^0.4·S_mus^0.6)', sources: [{ topic: 'carbohydrate-glycogen-insulin' }], description: 'Whole-body insulin sensitivity S_I = S_hep^0.4·S_mus^0.6 relative to a healthy reference, moved by fat mass, liver fat, fitness, activity, sleep and diet quality. It deliberately excludes the short-lived insulin resistance of fasting and very-low-carbohydrate eating (post-fast glucose intolerance): that is carried by carbohydrate tolerance, which recovers within days once carbohydrate is eaten again.' },
  { id: 'ldl', kind: 'metric', label: 'LDL cholesterol', unit: 'mmol/L', category: 'cardio', owner: 'cardiometabolic', resolution: 'daily', agg: 'end', direction: 'down', goal: 'minimise', grade: 'A', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '06 §4.2-4.4, §4.7', sources: [{ topic: 'cardiometabolic-markers' }] },
  { id: 'apoB', kind: 'metric', label: 'ApoB', unit: 'g/L', category: 'cardio', owner: 'cardiometabolic', resolution: 'daily', agg: 'end', direction: 'down', goal: 'minimise', grade: 'A', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '06 §4.2', sources: [{ topic: 'cardiometabolic-markers' }] },
  { id: 'hdl', kind: 'metric', label: 'HDL cholesterol', unit: 'mmol/L', category: 'cardio', owner: 'cardiometabolic', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', goalNote: 'weak causal target', grade: 'A', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '06 §4.6-4.7', sources: [{ topic: 'cardiometabolic-markers' }] },
  { id: 'triglycerides', kind: 'metric', label: 'Triglycerides', unit: 'mmol/L', category: 'cardio', owner: 'cardiometabolic', resolution: 'daily', agg: 'end', direction: 'down', goal: 'minimise', grade: 'A', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '06 §4.5', sources: [{ topic: 'cardiometabolic-markers' }] },
  { id: 'sbp', kind: 'metric', label: 'Blood pressure (systolic)', unit: 'mmHg', category: 'cardio', owner: 'cardiometabolic', resolution: 'daily', agg: 'end', direction: 'down', goal: 'minimise', grade: 'A', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '06 §4.8', sources: [{ topic: 'cardiometabolic-markers' }] },
  { id: 'liverFat', kind: 'metric', label: 'Liver fat', unit: '%', category: 'cardio', owner: 'cardiometabolic', resolution: 'daily', agg: 'end', direction: 'down', goal: 'minimise', grade: 'B', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '06 §4.9, 11 §4.9', sources: [{ topic: 'cardiometabolic-markers' }, { topic: 'energy-surplus' }] },
  { id: 'fastingGlucose', kind: 'metric', label: 'Fasting glucose', unit: 'mmol/L', category: 'cardio', owner: 'cardiometabolic', resolution: 'daily', agg: 'end', direction: 'down', goal: 'minimise', grade: 'B', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '04 §4.16, 06 §4.11', sources: [{ topic: 'carbohydrate-glycogen-insulin' }, { topic: 'cardiometabolic-markers' }] },
  { id: 'crp', kind: 'metric', label: 'hs-CRP', unit: 'rel', category: 'cardio', owner: 'cardiometabolic', resolution: 'daily', agg: 'end', direction: 'down', goal: 'minimise', grade: 'B', band: 'draws', presentation: 'deltaFromBaseline', overlay: 'pct', lane: 'line', caveat: CAVEAT_MARKER, src: '06 §4.12', sources: [{ topic: 'cardiometabolic-markers' }] },

  // ------------------------------------------------------------------ performance (5)
  { id: 'vo2max', kind: 'metric', label: 'VO₂max', unit: 'mL/kg/min', category: 'performance', owner: 'activity', resolution: 'daily', agg: 'end', direction: 'up', goal: 'maximise', grade: 'A', band: 'draws', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '10 §4.8', sources: [{ topic: 'cardio-activity' }] },
  { id: 'strength', kind: 'metric', label: 'Strength index', unit: '% of baseline', category: 'performance', owner: 'muscle', resolution: 'daily', agg: 'end', direction: 'up', goal: 'maximise', grade: 'B', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'line', src: '09 §4.14 × 19 §4.3 M_EA', sources: [{ topic: 'resistance-training' }, { topic: 'performance-wellbeing-bone' }] },
  { id: 'trainingStatus', kind: 'metric', label: 'Training status', unit: '% of potential', category: 'performance', owner: 'muscle', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', grade: 'C', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'index', src: '09 §4.6', sources: [{ topic: 'resistance-training' }] },
  { id: 'enduranceCapacity', kind: 'metric', label: 'Cycling endurance index (research)', unit: '% of baseline', category: 'performance', owner: 'wellbeing', resolution: 'daily', agg: 'end', direction: 'up', goal: 'maximise', grade: 'B', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'line', src: '19 §4.4', sources: [{ topic: 'performance-wellbeing-bone' }] },
  { id: 'rtMuscleGain', kind: 'metric', label: 'Training-attributable lean', unit: 'kg', category: 'performance', owner: 'muscle', resolution: 'daily', agg: 'end', direction: 'up', goal: 'maximise', grade: 'C', band: 'draws', bandFallback: 'fixChange:64', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '09 §4.9 (Σ M_acc,r)', sources: [{ topic: 'resistance-training' }] },

  // ------------------------------------------------------------------ recovery & wellbeing (6)
  { id: 'sleepQuality', kind: 'metric', label: 'Sleep quality', unit: 'index', category: 'recovery', owner: 'moderators', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', grade: 'C', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'index', caveat: CAVEAT_INDEX, src: '16 §4.2, 19 §4.10', sources: [{ topic: 'sleep-sex-age' }, { topic: 'performance-wellbeing-bone' }] },
  { id: 'moodTier', kind: 'metric', label: 'Wellbeing concerns', unit: 'tier', category: 'recovery', owner: 'wellbeing', resolution: 'daily', agg: 'end', direction: 'down', goal: 'none', goalNote: 'guard only; never a cognition score', grade: 'C', band: 'none', presentation: 'state', overlay: 'none', lane: 'state', src: '19 §4.5 (0 green, 1 amber, 2 red)', sources: [{ topic: 'performance-wellbeing-bone' }] },
  { id: 'energyAvailability', kind: 'metric', label: 'Energy availability', unit: 'kcal/kg FFM/d', category: 'recovery', owner: 'wellbeing', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', goalNote: 'hard floor 30 (17 HC-E4)', grade: 'B', band: 'draws', presentation: 'absolute', overlay: 'pct', lane: 'line+threshold', thresholds: [30, 45], src: '19 §4.1, 17 §2.1', sources: [{ topic: 'performance-wellbeing-bone' }, { topic: 'safety-limits' }] },
  { id: 'hipBmdChange', kind: 'metric', label: 'Hip bone density change', unit: '%', category: 'recovery', owner: 'wellbeing', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', goalNote: 'research display only; no personal forecast', grade: 'B', band: 'draws', presentation: 'absolute', overlay: 'none', lane: 'line', src: '19 §4.2', sources: [{ topic: 'performance-wellbeing-bone' }] },
  { id: 'ketoInduction', kind: 'metric', label: 'Keto-induction symptoms', unit: '0–1', category: 'recovery', owner: 'wellbeing', resolution: 'daily', agg: 'end', direction: 'down', goal: 'minimise', grade: 'C', band: 'draws', presentation: 'index', overlay: 'pts', lane: 'index', src: '13 §4.10', sources: [{ topic: 'transitions-periodisation' }] },
  { id: 'micronutrientScore', kind: 'metric', label: 'Micronutrient completeness', unit: 'score', category: 'recovery', owner: 'wellbeing', resolution: 'daily', agg: 'end', direction: 'up', goal: 'maximise', grade: 'D', band: 'none', presentation: 'index', overlay: 'pts', lane: 'index', caveat: 'Rule-based flags from typical food composition, not a measurement of your nutrient status.', src: '15 §4.9', sources: [{ topic: 'fibre-hydration-substances' }] },

  // ------------------------------------------------------------------ detail series (components, decomposition, hourly curves)
  { id: 'tef', kind: 'detail', label: 'Thermic effect of food', unit: 'kcal/d', category: 'energy', owner: 'energy', resolution: 'hourly', agg: 'sum', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'stacked-area', src: '02 §4.4', sources: [{ topic: 'energy-expenditure' }] },
  { id: 'exerciseEE', kind: 'detail', label: 'Exercise energy', unit: 'kcal/d', category: 'energy', owner: 'activity', resolution: 'hourly', agg: 'sum', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'stacked-area', src: '10 §4.1-4.2', sources: [{ topic: 'cardio-activity' }] },
  // SPEC V1.1 (2026-10-27): hourly components for the energy-day display (V2 energyDay). New outputs only, no equation change.
  { id: 'exerciseEnergy', kind: 'detail', label: 'Exercise energy (booked)', unit: 'kcal/d', category: 'energy', owner: 'activity', resolution: 'hourly', agg: 'sum', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'line', src: 'SPEC V1.1; 10 §4.1-4.2', sources: [{ topic: 'cardio-activity' }], description: 'The exercise energy the ledger books each hour: net above own rest minus the displaced lifestyle prior (signed), plus recovery released that hour. Identical to the exercise lane of the expenditure stack (exEEKcalH).' },
  { id: 'stepsEnergy', kind: 'detail', label: 'Step energy above habitual', unit: 'kcal/d', category: 'energy', owner: 'activity', resolution: 'hourly', agg: 'sum', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'line', src: 'SPEC V1.1; 10 §4.1, §4.14', sources: [{ topic: 'cardio-activity' }], description: 'Signed energy of the steps above (or below) the habitual step baseline each hour (stepsExtraKcalH). It is already inside non-exercise movement; never add it to that series.' },
  { id: 'insulin', kind: 'detail', label: 'Insulin (relative)', unit: 'rel', category: 'fuel', owner: 'intake', resolution: 'hourly', agg: 'mean', direction: 'context', goal: 'none', grade: 'C', band: 'none', presentation: 'index', overlay: 'none', lane: 'line', src: '04 §4.17', sources: [{ topic: 'carbohydrate-glycogen-insulin' }] },
  { id: 'glycogenWater', kind: 'detail', label: 'Glycogen + bound water', unit: 'kg', category: 'body', owner: 'water', resolution: 'hourly', agg: 'wake', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'deltaFromBaseline', overlay: 'none', lane: 'bars', src: '04 §4.1, 13 §4.2', sources: [{ topic: 'carbohydrate-glycogen-insulin' }, { topic: 'transitions-periodisation' }] },
  { id: 'ecfShift', kind: 'detail', label: 'Sodium & fluid shift', unit: 'kg', category: 'body', owner: 'water', resolution: 'hourly', agg: 'wake', direction: 'context', goal: 'none', grade: 'C', band: 'none', presentation: 'deltaFromBaseline', overlay: 'none', lane: 'bars', src: '13 §4.3-4.4, 15 §4.7', sources: [{ topic: 'transitions-periodisation' }, { topic: 'fibre-hydration-substances' }] },
  { id: 'gutContent', kind: 'detail', label: 'Gut contents', unit: 'kg', category: 'body', owner: 'water', resolution: 'hourly', agg: 'wake', direction: 'context', goal: 'none', grade: 'C', band: 'none', presentation: 'deltaFromBaseline', overlay: 'none', lane: 'bars', src: '13 §4.5', sources: [{ topic: 'transitions-periodisation' }] },
  { id: 'choOxidation', kind: 'detail', label: 'Carbohydrate oxidation', unit: 'g/d', category: 'fuel', owner: 'fuel', resolution: 'hourly', agg: 'sum', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'line', src: '04 §4.10', sources: [{ topic: 'carbohydrate-glycogen-insulin' }] },
  { id: 'dnl', kind: 'detail', label: 'Net de novo lipogenesis', unit: 'g/d', category: 'fuel', owner: 'fuel', resolution: 'hourly', agg: 'sum', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'line', src: '04 §4.13', sources: [{ topic: 'carbohydrate-glycogen-insulin' }] },
  { id: 'nitrogenBalance', kind: 'detail', label: 'Nitrogen balance', unit: 'g N/d', category: 'body', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'line', src: '03 §4.19 step 8', sources: [{ topic: 'protein-muscle' }] },
  { id: 'uricAcid', kind: 'detail', label: 'Uric acid (relative)', unit: 'rel', category: 'cardio', owner: 'cardiometabolic', resolution: 'daily', agg: 'end', direction: 'down', goal: 'none', goalNote: 'guard (17 W-F11, W-P06)', grade: 'B', band: 'none', presentation: 'deltaFromBaseline', overlay: 'none', lane: 'line', caveat: CAVEAT_MARKER, src: '06 §4.13, 20 §4.7', sources: [{ topic: 'cardiometabolic-markers' }, { topic: 'extended-water-fasting' }] },
  { id: 'waterWeight', kind: 'detail', label: 'Water & glycogen weight', unit: 'kg', category: 'body', owner: 'water', resolution: 'hourly', agg: 'wake', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'deltaFromBaseline', overlay: 'none', lane: 'line', src: '13 §4.1-4.6, 04 §4.1, 15 §4.7, 20 §4.5', sources: [{ topic: 'transitions-periodisation' }, { topic: 'carbohydrate-glycogen-insulin' }, { topic: 'fibre-hydration-substances' }, { topic: 'extended-water-fasting' }] },
  { id: 'fastProteinCost', kind: 'detail', label: 'Protein tissue lost in fasts', unit: 'kg', category: 'body', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'down', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'line', src: '20 §4.4, §6', sources: [{ topic: 'extended-water-fasting' }] },
  { id: 'hoursFasted', kind: 'detail', label: 'Hours since last intake', unit: 'h', category: 'fuel', owner: 'intake', resolution: 'hourly', agg: 'max', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'state', src: '17 §2.1 fast_h', sources: [{ topic: 'safety-limits' }] },
  // integration pass 2026-09-30 (detail series requested by the results view; cheap, already computed)
  { id: 'atResting', kind: 'detail', label: 'Adaptive thermogenesis, resting (AT_R)', unit: 'kcal/d', category: 'energy', owner: 'energy', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'line', src: '02 §4.8 (AT_R; held during fasts, 20 §4.2)', sources: [{ topic: 'energy-expenditure' }, { topic: 'extended-water-fasting' }] },
  { id: 'atNonResting', kind: 'detail', label: 'Adaptive thermogenesis, non-resting (AT_N)', unit: 'kcal/d', category: 'energy', owner: 'energy', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'line', src: '02 §4.8 (AT_N)', sources: [{ topic: 'energy-expenditure' }] },
  { id: 'fatTrunk', kind: 'detail', label: 'Trunk subcutaneous fat', unit: 'kg', category: 'body', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'down', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '14 M7 (regional allocation)', sources: [{ topic: 'body-composition-estimation' }] },
  { id: 'fatArms', kind: 'detail', label: 'Arm fat', unit: 'kg', category: 'body', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'down', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '14 M7 (regional allocation)', sources: [{ topic: 'body-composition-estimation' }] },
  { id: 'fatLegs', kind: 'detail', label: 'Leg and gluteofemoral fat', unit: 'kg', category: 'body', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'down', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '14 M7 (regional allocation)', sources: [{ topic: 'body-composition-estimation' }] },
  { id: 'muscleArms', kind: 'detail', label: 'Skeletal muscle, arms', unit: 'kg', category: 'performance', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', goalNote: 'regional muscle mass (the model has no muscle-thickness quantity)', grade: 'C', band: 'none', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '14 M7; 03 §4.19; 09 §4.9', sources: [{ topic: 'body-composition-estimation' }, { topic: 'protein-muscle' }, { topic: 'resistance-training' }] },
  { id: 'muscleLegs', kind: 'detail', label: 'Skeletal muscle, legs', unit: 'kg', category: 'performance', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', goalNote: 'regional muscle mass (the model has no muscle-thickness quantity)', grade: 'C', band: 'none', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '14 M7; 03 §4.19; 09 §4.9', sources: [{ topic: 'body-composition-estimation' }, { topic: 'protein-muscle' }, { topic: 'resistance-training' }] },
  { id: 'muscleTrunk', kind: 'detail', label: 'Skeletal muscle, trunk', unit: 'kg', category: 'performance', owner: 'composition', resolution: 'daily', agg: 'end', direction: 'up', goal: 'none', goalNote: 'regional muscle mass (the model has no muscle-thickness quantity)', grade: 'C', band: 'none', presentation: 'absolute', overlay: 'pct', lane: 'line', src: '14 M7; 03 §4.19; 09 §4.9', sources: [{ topic: 'body-composition-estimation' }, { topic: 'protein-muscle' }, { topic: 'resistance-training' }] },
  { id: 'ketoAdaptFast', kind: 'detail', label: 'Fat-oxidation adaptation (fast)', unit: '%', category: 'fuel', owner: 'ketones', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'index', overlay: 'none', lane: 'index', src: '05 §4.11.1 (100·A_f; τ 48 h up, 40 h down; bus signal ketoAdaptFast)', sources: [{ topic: 'fat-oxidation-ketosis' }], description: 'Fast half of the keto-adaptation index: the shift of muscle and liver towards burning fat. Rises within days of eating under roughly 50–100 g of carbohydrate a day (about 90 % after 5 days) and falls within about 5 days of high-carbohydrate eating.' },
  { id: 'ketoAdaptSlow', kind: 'detail', label: 'Ketone-kinetics adaptation (slow)', unit: '%', category: 'fuel', owner: 'ketones', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'C', band: 'none', presentation: 'index', overlay: 'none', lane: 'index', src: '05 §4.11.2 (100·A_s; τ 120 h towards clamp((TKB − 0.5)/2.0, 0, 1); bus signal ketoAdaptSlow)', sources: [{ topic: 'fat-oxidation-ketosis' }], description: 'Slow half of the keto-adaptation index: muscles take up fewer ketones, leaving more for the brain. Builds over weeks only while total blood ketones stay above about 0.5 mmol/L — mainly in prolonged fasting; on a ketogenic diet at maintenance it stays low. Evidence from fasting studies, contested.' },
  { id: 'totalKetones', kind: 'detail', label: 'Total ketone bodies', unit: 'mmol/L', category: 'fuel', owner: 'ketones', resolution: 'hourly', agg: 'mean', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'line', src: '05 §4.5 (TKB = BHB + AcAc; bus signal tkbMmolL)', sources: [{ topic: 'fat-oxidation-ketosis' }] },
  { id: 'dietFatigue', kind: 'detail', label: 'Diet fatigue', unit: '0–1', category: 'hormones', owner: 'appetite', resolution: 'daily', agg: 'end', direction: 'down', goal: 'none', grade: 'D', band: 'none', presentation: 'index', overlay: 'none', lane: 'index', caveat: CAVEAT_INDEX, src: '12 §4.10 (diet-fatigue state F; bus signal dietFatigue)', sources: [{ topic: 'hormones-appetite' }] },

  // ------------------------------------------------------------------ realised inputs
  { id: 'inEnergy', kind: 'input', label: 'Energy intake', unit: 'kcal/d', category: 'energy', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule', sources: [] },
  { id: 'inEnergyPctMaint', kind: 'input', label: 'Energy vs maintenance', unit: '%', category: 'energy', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule; R-MAINT reference', sources: [], description: 'Energy eaten as a percentage of the day\'s maintenance reference, i.e. the intake that keeps the body weight-stable at the activity this schedule plans (not at your habitual activity).' },
  { id: 'inMaintRef', kind: 'input', label: 'Maintenance reference', unit: 'kcal/d', category: 'energy', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'R-MAINT (DayInput.maintenanceKcal)', sources: [], description: 'The maintenance the day\'s energy was planned against: habitual maintenance minus habitual exercise energy plus the exercise and steps this schedule plans (averaged over the phase or week, with the model\'s exercise compensation). Fixed at the start for "% of maintenance at the start"; follows the body for "% of current maintenance".' },
  { id: 'inBalancePlanned', kind: 'input', label: 'Planned energy balance', unit: 'kcal/d', category: 'energy', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'R-MAINT (DayInput.plannedBalanceKcal)', sources: [], description: 'Energy eaten minus the day\'s maintenance reference: negative = planned deficit, positive = planned surplus, at the activity this schedule plans.' },
  { id: 'inProtein', kind: 'input', label: 'Protein', unit: 'g/d', category: 'energy', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule', sources: [] },
  { id: 'inCarbs', kind: 'input', label: 'Net carbohydrate', unit: 'g/d', category: 'energy', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule', sources: [] },
  { id: 'inFat', kind: 'input', label: 'Fat', unit: 'g/d', category: 'energy', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule', sources: [] },
  { id: 'inFibre', kind: 'input', label: 'Fibre', unit: 'g/d', category: 'energy', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule', sources: [] },
  { id: 'inAlcohol', kind: 'input', label: 'Alcohol', unit: 'g/d', category: 'energy', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule', sources: [] },
  { id: 'inSteps', kind: 'input', label: 'Steps', unit: 'steps/d', category: 'performance', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule', sources: [] },
  { id: 'inRtSets', kind: 'input', label: 'Resistance sets', unit: 'sets/d', category: 'performance', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule', sources: [] },
  { id: 'inCardioMin', kind: 'input', label: 'Cardio minutes', unit: 'min/d', category: 'performance', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule', sources: [] },
  { id: 'inSleep', kind: 'input', label: 'Sleep', unit: 'h', category: 'recovery', owner: 'core', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', grade: 'A', band: 'none', presentation: 'absolute', overlay: 'none', lane: 'bars', src: 'schedule', sources: [] },

  // ------------------------------------------------------------------ W3 (D2-07): appended so existing indices stay put
  { id: 'reproductiveConcern', kind: 'detail', label: 'Energy and cycle concern', unit: 'state', category: 'hormones', owner: 'hormones', resolution: 'daily', agg: 'end', direction: 'context', goal: 'none', goalNote: 'qualitative status; never a personal %/cycle', grade: 'C', band: 'none', presentation: 'state', overlay: 'none', lane: 'state', sexes: ['female'], src: '19 §4.9; D2-07 reproductiveConcernStatus (0 not applicable, 1 no model concern, 2 insufficient history, 3 eligibility unknown, 4 concern, 5 review)', sources: [{ topic: 'performance-wellbeing-bone' }], description: 'Qualitative energy and cycle concern from the logged energy history and confirmed cycle status. Missing history or unconfirmed cycles never read as reassurance; an observed cycle change reads Review.' },
  // ------------------------------------------------------------------ D2-08 (A1-058): appended so existing indices stay put
  { id: 'bhbEndpoint', kind: 'detail', label: 'Blood ketones at the hour end (BHB)', unit: 'mmol/L', category: 'fuel', owner: 'ketones', resolution: 'hourly', agg: 'end', direction: 'context', goal: 'none', goalNote: 'the value a timed blood reading is compared with', grade: 'B', band: 'none', presentation: 'absolute', overlay: 'log2', lane: 'line', src: '05 §4.5; D2-08 hour-end blood D-BHB: hourly sample h is the value at time h + 1, daily = the value at 24:00 (operator bhbEndpoint)', sources: [{ topic: 'fat-oxidation-ketosis' }], description: 'Blood ketone (D-BHB) level at the end of each hour, the instant a timed finger-prick reading is compared with. The hourly Blood ketones line is the mean over the hour, so the two differ while ketones rise or fall.' },
] as const satisfies readonly SeriesDef[];

export type SeriesId = (typeof SERIES)[number]['id'];
export type MetricId = Extract<(typeof SERIES)[number], { kind: 'metric' }>['id'];
/**
 * Series a module owns (A1-058): a provider types its `records` and its recorder indices with it, so a series missing from
 * the catalogue (or owned by another module) is a compile error instead of a silently disabled `-1` index.
 */
export type SeriesOwnedBy<M extends ModuleId | 'core'> = Extract<(typeof SERIES)[number], { owner: M }>['id'];

/** id → index into metric frames and result arrays. Built once at module load. */
export const SERIES_INDEX: Readonly<Record<SeriesId, number>> = Object.freeze(
  Object.fromEntries(SERIES.map((d, i) => [d.id, i])) as Record<SeriesId, number>,
);
/** Short alias used by modules: `out[MI.fatMass] = s.fm`. */
export const MI = SERIES_INDEX;
export const N_SERIES = SERIES.length;
export const METRIC_IDS: readonly MetricId[] = SERIES.filter((d) => d.kind === 'metric').map((d) => d.id as MetricId);

/**
 * Detail series that are exactly a published bus signal of their owner module (MODEL_SPEC §6.2): the core records them
 * from the bus (hourly series each hour, daily series after endOfDay) only when requested, so the owner module needs no
 * recording code. The signal's writer must be the series owner (checked in the core tests).
 */
export const SIGNAL_MIRRORS: readonly { readonly series: SeriesId; readonly signal: SignalName }[] = [
  { series: 'totalKetones', signal: 'tkbMmolL' },
  { series: 'dietFatigue', signal: 'dietFatigue' },
];

export function seriesDef(id: SeriesId): SeriesDef {
  return SERIES[SERIES_INDEX[id]] as SeriesDef;
}

// ---------------------------------------------------------------------------------------------------------------------
// C4: the measurement operator each observable series is compared through (2026-10-18 contracts)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Operator per series (C4): a series is compared with an observation only through this operator. Series without an entry
 * are model quantities with no direct observable. `bodyFatPct` is the wake scale-equivalent reading; the tissue fat
 * fraction is a different operator (`tissueFatFraction`). `bhb` is the hour mean and `bhbEndpoint` the hour-end instant
 * (a timed blood reading is compared with the endpoint, D2-08). `nitrogenBalance` is the signed model body-N change
 * (ΔLT·1000/(1 + hP)/6.25, g N/d) and deliberately has no entry: it is not urinary nitrogen excretion (`urinaryNitrogen`
 * is a non-negative urine flux; intake, non-urinary losses and non-protein pools make them different estimands, A1-059).
 */
export const SERIES_OBSERVABLE: Readonly<Partial<Record<SeriesId, OperatorId>>> = {
  scaleWeight: 'scaleWake',
  fatMass: 'modelFatMass',
  leanMass: 'inferredNonFatScaleMass',
  leanTissue: 'modelLeanTissue',
  bodyFatPct: 'scaleBodyFatWake',
  waist: 'waist',
  bhb: 'bhbHourlyMean',
  bhbEndpoint: 'bhbEndpoint',
  sbp: 'bloodPressure',
  fastingGlucose: 'fastingGlucose',
};

/** Series that are latent/legacy research indices: shown only as Exploratory, never as measurements or objectives. */
export const EXPLORATORY_SERIES: ReadonlySet<SeriesId> = new Set<SeriesId>([
  'autophagyIdx',
  'mtorIdx',
  'ampkIdx',
  'mps',
  'ketoAdaptation',
  'ketoAdaptFast',
  'ketoAdaptSlow',
  'igf1',
  'leptin',
  't3',
  'cortisol',
  'testosterone',
  'menstrualRisk',
  'adherence',
  'hunger',
  'enduranceCapacity',
  'hipBmdChange',
  'micronutrientScore',
]);

// ---------------------------------------------------------------------------------------------------------------------
// C6: goal capability registry (2026-10-18 contracts)
// ---------------------------------------------------------------------------------------------------------------------

const W = {
  energyBalance: { type: 'firstPrinciples', confidence: 'high', scope: 'energy conservation of the tissue model' },
  bodyCompTrials: { type: 'empiricalFormal', confidence: 'moderate', scope: 'population mean weight/fat change under controlled intake' },
  mechanism: { type: 'physiologicallyIntuitive', confidence: 'moderate', scope: 'direction and rough size, personal response uncalibrated' },
  causal: { type: 'causallyCoherent', confidence: 'moderate', scope: 'mechanism chain; personal calibration pending' },
  functional: { type: 'functionallyTrue', confidence: 'provisional', scope: 'useful planning heuristic pending personal validation' },
  noLink: { type: 'analyticallyTrue', confidence: 'high', scope: 'no validated link from this index to a health outcome' },
  observed: { type: 'commonSense', confidence: 'high', scope: 'what was measured or logged' },
} as const satisfies Record<string, Warrant>;

const cap = (
  availability: GoalCapability['availability'],
  estimand: string,
  reasonCode: string,
  opts: Partial<Omit<GoalCapability, 'availability' | 'estimand' | 'reasonCode'>> = {},
): GoalCapability => ({
  availability,
  estimand,
  reasonCode,
  timeBasis: opts.timeBasis ?? 'end',
  requiredInputs: opts.requiredInputs ?? [],
  requiredOutputs: opts.requiredOutputs ?? [],
  population: opts.population ?? 'adults inside the engine’s supported profile domain',
  objectives: opts.objectives ?? [],
  satiation: opts.satiation ?? 'none',
  warrants: opts.warrants ?? [],
  ...(opts.operator ? { operator: opts.operator } : {}),
});
const display = (reasonCode: string, estimand: string) => cap('unavailable', estimand, reasonCode, { timeBasis: 'none', warrants: [W.noLink] });
const monitor = (reasonCode: string, estimand: string) => cap('observedOnly', estimand, reasonCode, { timeBasis: 'episode', warrants: [W.observed] });

/**
 * Outcome-specific goal capability for every metric (C6/D4-05; D2-02, D2-06, D2-07, D2-08, D7-07, D8-08, D8-09). Planner
 * routes (request, imported/saved goals, reach/Ideal, sensitivity, living replan) gate on it: `unavailable` and
 * `observedOnly` metrics are never objectives and earn no benefit credit; `scenario` objectives are labelled assumptions.
 * The legacy `SeriesDef.goal` keeps the objective shape for historical artifacts.
 */
export const GOAL_CAPABILITY: Readonly<Record<MetricId, GoalCapability>> = {
  scaleWeight: cap('supported', 'water-adjusted (tissue) weight trend at horizon end, kg', 'trendWeightOperator', { operator: 'waterAdjustedWake', objectives: ['target'], requiredOutputs: ['scaleWeight'], warrants: [W.energyBalance, W.bodyCompTrials] }),
  fatMass: cap('supported', 'model fat mass at horizon end, kg', 'ok', { operator: 'modelFatMass', objectives: ['target', 'minimise'], requiredOutputs: ['fatMass', 'leanTissue'], warrants: [W.energyBalance, W.bodyCompTrials] }),
  leanMass: display('scaleOperatorIncludesWater', 'inferred non-fat scale mass (includes glycogen, water, gut)'),
  leanTissue: cap('supported', 'model lean tissue at horizon end, kg (partition conditional on protein and training inputs)', 'conditionalPartition', { operator: 'modelLeanTissue', objectives: ['maximise', 'target'], requiredOutputs: ['leanTissue'], warrants: [W.bodyCompTrials, W.mechanism] }),
  skeletalMuscle: cap('scenario', 'model skeletal muscle at horizon end, kg', 'growthStateUncalibrated', { objectives: ['maximise'], requiredOutputs: ['skeletalMuscle'], warrants: [W.mechanism] }),
  bodyFatPct: cap('supported', 'tissue fat fraction 100·FM/(FM + FFM_act) at horizon end, %', 'tissueFractionEstimand', { operator: 'tissueFatFraction', objectives: ['target'], requiredOutputs: ['fatMass', 'leanTissue'], warrants: [W.energyBalance, W.bodyCompTrials] }),
  waist: cap('scenario', 'model waist girth at horizon end, cm', 'girthOperatorUnvalidated', { operator: 'waist', objectives: ['target', 'minimise'], requiredOutputs: ['waist', 'fatMass'], warrants: [W.mechanism] }),
  visceralFat: cap('scenario', 'model visceral fat at horizon end, kg', 'regionalAllocationModel', { objectives: ['minimise'], requiredOutputs: ['visceralFat'], warrants: [W.mechanism] }),
  glycogenTotal: cap('scenario', 'model total glycogen, g', 'taskScopedFuel', { objectives: ['target'], satiation: 'required', requiredOutputs: ['glycogenTotal'], warrants: [W.mechanism] }),
  liverGlycogen: display('displayOnly', 'model liver glycogen, g'),
  muscleGlycogen: cap('scenario', 'model whole-body muscle glycogen, g', 'taskScopedFuel', { objectives: ['maximise'], satiation: 'optional', requiredOutputs: ['muscleGlycogen'], warrants: [W.mechanism] }),
  bhb: cap('scenario', 'model blood D-BHB, mmol/L (hour mean)', 'concentrationObservationModelPending', { operator: 'bhbHourlyMean', timeBasis: 'mean', objectives: ['target'], satiation: 'required', requiredOutputs: ['bhb'], warrants: [W.mechanism] }),
  ketosisState: display('displayOnly', 'model ketosis state'),
  hoursInKetosis: cap('scenario', 'model hours per day with BHB above the ketosis threshold', 'concentrationObservationModelPending', { timeBasis: 'mean', objectives: ['maximise'], satiation: 'optional', requiredOutputs: ['hoursInKetosis', 'bhb'], warrants: [W.mechanism] }),
  ketoAdaptation: display('latentStateNotCertificate', 'latent keto-adaptation states'),
  fatOxidation: display('displayOnly', 'model fat oxidation, g/d'),
  glucose: cap('scenario', 'model mean plasma glucose, mmol/L', 'needsTargetBand', { timeBasis: 'mean', objectives: ['target', 'band'], satiation: 'required', requiredOutputs: ['glucose'], warrants: [W.mechanism] }),
  tdee: cap('scenario', 'model total energy expenditure, kcal/d', 'expenditureNotHealthEndpoint', { timeBasis: 'mean', objectives: ['maximise'], requiredOutputs: ['tdee'], warrants: [W.energyBalance, W.mechanism] }),
  rmr: cap('scenario', 'model resting metabolic rate, kcal/d', 'expenditureNotHealthEndpoint', { timeBasis: 'mean', objectives: ['maximise'], requiredOutputs: ['rmr'], warrants: [W.mechanism] }),
  neat: display('displayOnly', 'model non-exercise movement energy, kcal/d'),
  metabolicAdaptation: cap('scenario', 'model adaptive thermogenesis, kcal/d', 'adaptationUncalibrated', { objectives: ['maximise'], requiredOutputs: ['metabolicAdaptation'], warrants: [W.mechanism] }),
  energyBalance: display('displayOnly', 'model energy balance, kcal/d'),
  maintenance: display('displayOnly', 'model maintenance energy, kcal/d'),
  autophagyIdx: display('noHealthObjective', 'legacy autophagy research index (no flux estimate)'),
  mtorIdx: display('noHealthObjective', 'mTOR activity index'),
  ampkIdx: display('noHealthObjective', 'AMPK activity index'),
  mps: display('simulatedResponseIndex', 'simulated anabolic-response index'),
  igf1: display('responseModelUnvalidated', 'IGF-1 relative to baseline (exploratory mechanism)'),
  hunger: cap('scenario', 'uncalibrated hunger burden index (0–100)', 'burdenPriorUncalibrated', { timeBasis: 'mean', objectives: ['minimise'], requiredOutputs: ['hunger'], warrants: [W.functional, W.mechanism] }),
  leptin: display('exploratoryMechanism', 'leptin relative to baseline'),
  t3: display('exploratoryMechanism', 'T3 relative to baseline'),
  cortisol: display('exploratoryMechanism', 'cortisol relative to baseline'),
  testosterone: monitor('measuredLabOnly', 'measured testosterone with its lab range'),
  menstrualRisk: monitor('loggedCycleConcernsOnly', 'logged cycle changes and energy-availability concern'),
  adherence: display('notAProbability', 'model adherence index (no probability semantics)'),
  insulinSensitivity: cap('scenario', 'model insulin sensitivity relative to baseline', 'personalResponseUncalibrated', { objectives: ['maximise'], requiredOutputs: ['insulinSensitivity'], warrants: [W.mechanism] }),
  ldl: cap('scenario', 'model LDL cholesterol, mmol/L', 'populationResponseScenario', { objectives: ['minimise', 'target'], satiation: 'optional', requiredOutputs: ['ldl'], warrants: [W.bodyCompTrials, W.mechanism] }),
  apoB: display('proxyResponseUnvalidated', 'ApoB (exploratory proxy response)'),
  hdl: monitor('measuredLabOnly', 'measured HDL cholesterol'),
  triglycerides: cap('scenario', 'model triglycerides, mmol/L', 'populationResponseScenario', { objectives: ['minimise', 'target'], satiation: 'optional', requiredOutputs: ['triglycerides'], warrants: [W.mechanism] }),
  sbp: cap('scenario', 'model systolic pressure vs protocol-tagged repeated home readings, mmHg', 'needsTargetBandAndProtocol', { operator: 'bloodPressure', objectives: ['target', 'band'], satiation: 'required', requiredOutputs: ['sbp'], warrants: [W.mechanism] }),
  liverFat: cap('scenario', 'model liver fat, %', 'sustainedResponseUncalibrated', { objectives: ['minimise'], satiation: 'optional', requiredOutputs: ['liverFat'], warrants: [W.mechanism] }),
  fastingGlucose: cap('scenario', 'model fasting glucose vs eligible fasting samples, mmol/L', 'needsTargetBandMedicationAware', { operator: 'fastingGlucose', objectives: ['target', 'band'], satiation: 'required', requiredOutputs: ['fastingGlucose'], warrants: [W.mechanism] }),
  crp: cap('scenario', 'model hs-CRP relative to baseline', 'personalResponseUncalibrated', { objectives: ['minimise'], satiation: 'optional', requiredOutputs: ['crp'], warrants: [W.mechanism] }),
  vo2max: cap('scenario', 'model VO2max, mL/kg/min (broad estimate; fitness tests calibrate)', 'broadEstimate', { objectives: ['maximise'], requiredOutputs: ['vo2max'], warrants: [W.mechanism] }),
  strength: cap('scenario', 'task-specific strength index vs baseline', 'taskSpecific', { objectives: ['maximise'], requiredOutputs: ['strength'], warrants: [W.mechanism, W.functional] }),
  trainingStatus: display('displayOnly', 'model training status'),
  enduranceCapacity: display('genericIndexNotTask', 'generic endurance index (task-scoped research only)'),
  rtMuscleGain: cap('scenario', 'training-attributable lean tissue, kg', 'growthStateUncalibrated', { objectives: ['maximise'], requiredOutputs: ['rtMuscleGain', 'leanTissue'], warrants: [W.mechanism] }),
  sleepQuality: monitor('loggedSleepOnly', 'logged sleep duration and quality'),
  moodTier: monitor('observedWellbeingOnly', 'observed wellbeing and concern flags'),
  energyAvailability: display('safetyContextOnly', 'energy availability exposure, kcal/kg FFM/d'),
  hipBmdChange: monitor('measuredDxaOnly', 'measured site-specific DXA BMD'),
  ketoInduction: cap('scenario', 'keto-induction symptom load (0–1)', 'burdenPriorUncalibrated', { timeBasis: 'mean', objectives: ['minimise'], requiredOutputs: ['ketoInduction'], warrants: [W.functional] }),
  micronutrientScore: display('fabricatedPrecision', 'rule-based micronutrient flags (not nutrient status)'),
};

/** The capability of a metric (C6). */
export function goalCapability(id: MetricId): GoalCapability {
  return GOAL_CAPABILITY[id];
}

/**
 * Production goal eligibility (C6): goal-shaped (`SeriesDef.goal !== 'none'`) AND an optimizable capability. Every request
 * route must use this instead of reading `SeriesDef.goal` alone (legacy artifacts keep their stored goal for display).
 */
export function isProductionGoalEligible(id: string): boolean {
  const i = (SERIES_INDEX as Readonly<Record<string, number>>)[id];
  if (i === undefined) return false;
  const d = SERIES[i]!;
  return d.kind === 'metric' && d.goal !== 'none' && capabilityAllowsOptimization(GOAL_CAPABILITY[d.id as MetricId]);
}
