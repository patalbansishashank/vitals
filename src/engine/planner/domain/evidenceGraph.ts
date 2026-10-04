/**
 * Evidence graph (PLANNER_V2_SPEC §6.1; R6 §7.1; R5 mechanism vocabulary): which planner lever, building block, catalogue
 * item or user input reaches which goal metric, through which engine module, with which sign, under which condition.
 *
 * Generated where the registries carry the facts and hand-entered where they do not:
 *   - lever and block edges = the lever / block registry (`LEVERS`, `BLOCKS`) joined with a hand-entered table of
 *     mechanism *channels* (what a lever does to the engine inputs, e.g. "more energy eaten", "a zero-intake span"); each
 *     channel lists the goal metrics it moves, the sign and an optional condition;
 *   - the module, recorded series and evidence topic of an edge come from the series catalogue (`SERIES[metric].owner`,
 *     `.sources`) unless a channel names another module; the bus signals on the path come from the signal contract
 *     (`SIGNAL_DEFS`: signals the channel's entry module writes and the metric's module reads);
 *   - catalogue edges come from the catalogue (`catalogueEdges(SEED_CATALOGUE)`), with their outcome families mapped to
 *     goal metrics here;
 *   - levers without an engine channel (`plannerUsable: false`) carry `infoOnly` edges: the mechanism is known, the model
 *     does not simulate it yet (R5: "Not simulated yet"; listed in the Evidence library, never credited in the numbers).
 *
 * Signs are the effect of switching the lever on (or raising its parameter) on the metric: +1 raises it, −1 lowers it,
 * 0 = condition-dependent (the direction depends on the person or the rest of the plan). Certainty is recorded and never
 * used to drop, order or weight an edge (evidence policy: grades never gate the search).
 *
 * Uses: the fasting gate's `servesFasting` (§3.1, compared with `FASTING_SERVED` in the audit tests), the coverage audit
 * (§6.3: reachability, mechanism liveness, evaluator completeness) and the Evidence library's "what moves this metric".
 * `source` is user-facing (topic slugs of the Evidence library, item 5); `maintainerRef` is for code and docs only.
 */
import { catalogueEdges } from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';
import type { EvidenceTopicSlug } from '@/content/evidence/schema';
import { SERIES, SERIES_INDEX, type MetricId, type SeriesDef, type SeriesId } from '../../types/metrics';
import { SIGNAL_DEFS, type ModuleId, type SignalName } from '../../types/signals';
import { BLOCKS, type BlockId } from './registry/blocks';
import { LEVERS } from './registry/levers';
import type { EvidenceGrade } from './types';

// ---------------------------------------------------------------------------------------------------------------
// contract (PLANNER_V2_SPEC §6.1)
// ---------------------------------------------------------------------------------------------------------------

/** R5 mechanism route: reaches engine state directly / through a mapping onto a modelled pathway / not at all (yet). */
export type MechanismStatus = 'modelled' | 'mapped' | 'infoOnly';

/** Machine-checkable conditions under which an edge holds (or decides its sign when the sign is 0). */
export type EdgeConditionId =
  | 'deficit'
  | 'surplus'
  | 'rtPresent'
  | 'muscleGoal'
  | 'lowBodyFat'
  | 'lowCarb'
  | 'shortSleep'
  | 'weightLoss'
  | 'trainingNovice';

/** Probe of an edge for the liveness check (personas and base plans of `src/engine/planner/audit/probes.ts`). */
export type ProbePersonaId = 'man88' | 'woman78' | 'leanTrained';
export type ProbePlanId = 'maintenance' | 'deficit' | 'surplus' | 'veryLowCarb';
export type ProbeToggle =
  | { readonly kind: 'gene'; readonly path: string; readonly from?: number; readonly to?: number }
  | { readonly kind: 'flag'; readonly flag: 'creatine' | 'omega3' | 'viscousFibre' | 'sleepExtension'; readonly genes?: Readonly<Record<string, number>> }
  | {
      readonly kind: 'overlay';
      readonly overlay: { readonly lever: 'refeedDay'; readonly days: 1 | 2 } | { readonly lever: 'fastDay24'; readonly perWeek: 1 | 2 };
      readonly genes?: Readonly<Record<string, number>>;
    }
  | { readonly kind: 'event'; readonly durationH: 48 | 72 | 120 | 168; readonly genes?: Readonly<Record<string, number>> }
  | {
      readonly kind: 'segments';
      readonly segments: ReadonlyArray<
        | { readonly kind: 'phase'; readonly block: 'B0' | 'B1' | 'B2' | 'B3' | 'B6' | 'B11' | 'B12' | 'B21' | 'B22' | 'B23' | 'B24'; readonly perWeek?: number }
        | { readonly kind: 'cycle'; readonly on: 'B1' | 'B2' | 'B6'; readonly off: 'B8' }
      >;
      /** Genes of the toggled structure in unit coordinates (e.g. a phase's energy at its top, to compare at equal energy). */
      readonly genes?: Readonly<Record<string, number>>;
    };

export interface EvidenceEdge {
  /** Stable id, e.g. 'fastDay24>zeroIntake>autophagyIdx'. */
  id: string;
  from: { kind: 'lever' | 'block' | 'catalogue' | 'input'; id: string; params?: Record<string, number> };
  /** Engine module, registry params and bus signals on the path, observable series. */
  mechanism: { module: string; paramIds: readonly string[]; signals: readonly string[]; series: readonly SeriesId[] };
  /** Goal metric reached. */
  metric: MetricId;
  /** Effect on the metric of switching `from` on (or raising it); 0 = condition-dependent. */
  sign: 1 | -1 | 0;
  condition?: EdgeConditionId;
  status: MechanismStatus;
  /** Recorded, never used to drop or weight an edge. */
  certainty: EvidenceGrade;
  /** User-facing structured reference: Evidence library topic (item 5: no internal numbers). */
  source: { topic: string; refs: readonly string[] };
  /** Code and docs only, never rendered (e.g. '20 §4C'). */
  maintainerRef: string;
  probe?: { persona: ProbePersonaId; base: ProbePlanId; toggle: ProbeToggle };
  /** Metric units; default = ½ of the P10-P90 half-width of the metric on the probe (full audit). */
  noiseFloor?: number;
}

// ---------------------------------------------------------------------------------------------------------------
// channels (hand-entered from the research notes; signs checked against the engine by the liveness audit)
// ---------------------------------------------------------------------------------------------------------------

/** What a lever or block does to the engine inputs. */
export type ChannelId =
  | 'energyIntake'
  | 'zeroIntake'
  | 'lowEnergyDays'
  | 'protein'
  | 'fatShare'
  | 'carbIntake'
  | 'fibre'
  | 'viscousFibre'
  | 'omega3'
  | 'eatingWindow'
  | 'mealCount'
  | 'resistanceTraining'
  | 'cardio'
  | 'steps'
  | 'sleepExtension'
  | 'creatine'
  | 'caffeine'
  | 'postMealWalk'
  | 'lateEating';

type Effect = readonly [metric: MetricId, sign: 1 | -1 | 0, condition?: EdgeConditionId, module?: ModuleId];

interface ChannelDef {
  readonly id: ChannelId;
  /** Engine module that first reads the channel's inputs (signals on the path start here). */
  readonly entry: ModuleId;
  /** Key registry parameters of the pathway (validated against the parameter registry by the audit tests). */
  readonly paramIds: readonly string[];
  readonly effects: readonly Effect[];
  /** Research-note pointer of the pathway (maintainers). */
  readonly ref: string;
}

/** Body-composition metrics that follow the energy balance (01, 14). */
const BODY_DOWN_WITH_DEFICIT: readonly MetricId[] = ['scaleWeight', 'fatMass', 'bodyFatPct', 'waist', 'visceralFat'];

export const CHANNELS: Readonly<Record<ChannelId, ChannelDef>> = {
  energyIntake: {
    id: 'energyIntake',
    entry: 'intake',
    paramIds: ['composition.rhoF', 'composition.rhoL', 'energy.betaAT', 'appetite.satDefMaxKcal', 'cardiometabolic.si.ebDefA'],
    ref: '01 §4.1-4.3; 02 §4.8; 12 §4.9; 06 §4.5-4.11; 13 §4C',
    effects: [
      ...BODY_DOWN_WITH_DEFICIT.map((m): Effect => [m, 1]),
      ['leanTissue', 1],
      ['skeletalMuscle', 1],
      ['glycogenTotal', 1],
      ['muscleGlycogen', 1],
      ['bhb', -1],
      ['ketoAdaptation', -1],
      ['autophagyIdx', -1],
      ['tdee', 1],
      ['rmr', 1],
      ['metabolicAdaptation', 1],
      ['hunger', -1],
      ['adherence', 1, 'deficit'],
      ['insulinSensitivity', -1],
      ['glucose', 1],
      ['fastingGlucose', 1],
      ['triglycerides', 1],
      ['sbp', 1],
      ['liverFat', 1],
      ['crp', 1],
      ['ldl', 0, 'weightLoss'],
      ['apoB', 0, 'weightLoss'],
      // the strength index follows lean tissue (composition); lighter body vs fuller glycogen: either way for endurance
      ['strength', 1, undefined, 'composition'],
      ['enduranceCapacity', 0, 'weightLoss'],
      ['micronutrientScore', 1],
    ],
  },
  zeroIntake: {
    id: 'zeroIntake',
    entry: 'fasting',
    paramIds: ['fasting.tauAT', 'fasting.nPkLean', 'ketones.eDef', 'cellular.kBhb', 'appetite.fastHungerOnsetH'],
    ref: '20 §4.2-4.7, §4C; 07; 05 §4.3; 08 §4.10-4.12; 12 §4.9',
    effects: [
      // a zero-intake span removes the day's food: it delivers part of a deficit by construction (20 §4C: a delivery
      // pattern of a deficit, no fat-loss advantage at equal weekly energy)
      ...BODY_DOWN_WITH_DEFICIT.map((m): Effect => [m, -1]),
      ['leanTissue', -1],
      ['skeletalMuscle', -1],
      ['glycogenTotal', -1],
      ['muscleGlycogen', -1],
      ['bhb', 1],
      ['hoursInKetosis', 1],
      ['ketoAdaptation', 1],
      ['autophagyIdx', 1],
      ['igf1', -1],
      ['tdee', -1],
      ['rmr', -1],
      ['metabolicAdaptation', -1],
      ['hunger', 1],
      ['adherence', -1],
      ['insulinSensitivity', 0, 'weightLoss'],
      ['glucose', -1],
      ['fastingGlucose', -1],
      ['triglycerides', -1],
      ['sbp', -1],
      ['liverFat', -1],
      ['crp', -1],
      ['ldl', 0, 'weightLoss'],
      ['apoB', 0, 'weightLoss'],
      ['strength', -1, undefined, 'composition'],
      ['enduranceCapacity', 0, 'weightLoss'],
      ['micronutrientScore', -1],
    ],
  },
  lowEnergyDays: {
    id: 'lowEnergyDays',
    entry: 'intake',
    paramIds: ['composition.rhoF', 'appetite.satDefMaxKcal'],
    // two low days a week at about the same weekly energy as a continuous deficit: no fat-loss bonus (20 §4C)
    ref: '13 §4C B11; 20 §4C; 17 HC-E2',
    effects: [
      ...BODY_DOWN_WITH_DEFICIT.map((m): Effect => [m, 0, 'deficit']),
      ['leanTissue', 0],
      ['glycogenTotal', 1],
      ['muscleGlycogen', 1],
      ['hoursInKetosis', 1],
      ['ketoAdaptation', 1],
      ['rmr', -1],
      ['hunger', 0],
      ['adherence', -1],
      ['liverFat', -1],
      ['enduranceCapacity', 1],
    ],
  },
  protein: {
    id: 'protein',
    entry: 'intake',
    paramIds: ['composition.mPp0', 'energy.tefP', 'appetite.hProtCoef', 'muscle.rhoPLow'],
    ref: '03 §4.4, §4.19; 02 §4.4; 12 §4.9',
    effects: [
      ['fatMass', -1, 'deficit'],
      ['scaleWeight', -1, 'deficit'],
      ['bodyFatPct', -1, 'deficit'],
      ['waist', -1, 'deficit'],
      ['visceralFat', -1, 'deficit'],
      ['leanTissue', 1, 'rtPresent'],
      ['skeletalMuscle', 1, 'rtPresent'],
      ['tdee', 1],
      ['rmr', 1],
      ['hunger', -1],
      ['adherence', 1],
      ['bhb', 1],
      ['glucose', -1],
      ['ldl', -1],
      ['apoB', -1],
      ['triglycerides', -1],
      ['sbp', -1],
    ],
  },
  fatShare: {
    id: 'fatShare',
    entry: 'intake',
    paramIds: ['fuel.alphaGlc', 'ketones.lipoA', 'cardiometabolic.ldl.sfa'],
    ref: '04 §4.10-4.16; 05 §4.2-4.3; 06 §4.2-4.5',
    effects: [
      ['glycogenTotal', -1],
      ['muscleGlycogen', -1],
      ['bhb', 1],
      ['ketoAdaptation', 1],
      ['glucose', -1],
      ['autophagyIdx', 1],
      ['ldl', 1],
      ['apoB', 1],
      ['triglycerides', -1],
      ['liverFat', -1],
      ['sbp', -1],
      ['enduranceCapacity', -1],
      ['tdee', -1],
    ],
  },
  carbIntake: {
    id: 'carbIntake',
    entry: 'intake',
    paramIds: ['fuel.alphaGlc', 'fuel.hWater', 'ketones.g50Frac', 'ketones.c50'],
    ref: '04 §4.1-4.16; 05 §4.2, §4.11; 13 §4C B2',
    effects: [
      ['glycogenTotal', 1],
      ['muscleGlycogen', 1],
      ['bhb', -1],
      ['hoursInKetosis', -1],
      ['ketoAdaptation', -1],
      ['autophagyIdx', -1],
      ['glucose', 1],
      ['enduranceCapacity', 1],
      ['ldl', -1],
      ['apoB', -1],
      ['triglycerides', 1],
    ],
  },
  fibre: {
    id: 'fibre',
    entry: 'intake',
    paramIds: ['intake.fibreKFKcalPerG', 'appetite.hFibCoef', 'intake.glcFibCoef'],
    ref: '15 §4.1-4.5; 06 §4.4; 04 §4.16',
    effects: [
      ['fatMass', -1],
      ['glucose', -1],
      ['hunger', -1],
      ['ldl', -1],
      ['apoB', -1],
      ['insulinSensitivity', 1],
      ['micronutrientScore', 1],
    ],
  },
  viscousFibre: {
    id: 'viscousFibre',
    entry: 'intake',
    paramIds: ['appetite.vViscous', 'intake.glcFibCoef'],
    ref: '21 §4J L9; 15 §4.3; 06 §4.4',
    effects: [
      ['ldl', -1],
      ['apoB', -1],
      ['glucose', -1],
      ['hunger', -1],
      ['fatMass', -1],
    ],
  },
  omega3: {
    id: 'omega3',
    entry: 'intake',
    paramIds: [],
    ref: '21 §4J L8; 06 §4.5, §4.8',
    effects: [
      ['triglycerides', -1],
      ['sbp', -1],
      ['apoB', -1],
    ],
  },
  eatingWindow: {
    id: 'eatingWindow',
    entry: 'intake',
    paramIds: ['intake.mClockSlopePerH', 'cellular.h50'],
    ref: '07 §4.1-4.7; 08 §4.10',
    effects: [
      ['autophagyIdx', -1],
      ['bhb', -1],
      ['glucose', 1],
      ['glycogenTotal', 1],
      ['enduranceCapacity', -1],
    ],
  },
  mealCount: {
    id: 'mealCount',
    entry: 'intake',
    paramIds: ['appetite.dMealPerMealKcal', 'intake.mClockSlopePerH'],
    ref: '07 §4.4; 12 §4.9; 08 §4.15',
    effects: [
      ['hunger', -1],
      ['glucose', 1],
      ['autophagyIdx', 1],
    ],
  },
  resistanceTraining: {
    id: 'resistanceTraining',
    entry: 'activity',
    paramIds: ['muscle.kG', 'muscle.rhoMax', 'composition.sRtSets', 'activity.rtMetDefault'],
    ref: '09 §4.1-4.14; 10 §4.1; 03 §4.19',
    effects: [
      ['leanTissue', 1, undefined, 'composition'],
      ['skeletalMuscle', 1, undefined, 'composition'],
      ['rtMuscleGain', 1],
      ['strength', 1],
      ['fatMass', -1],
      ['bodyFatPct', -1],
      ['waist', -1],
      ['visceralFat', -1],
      ['tdee', 1],
      ['insulinSensitivity', 1],
      ['hunger', -1],
    ],
  },
  cardio: {
    id: 'cardio',
    entry: 'activity',
    paramIds: ['activity.vo2GMax', 'activity.metVo2', 'cardiometabolic.si.exA'],
    ref: '10 §4.1-4.13; 19 §4.4; 06 §4.8',
    effects: [
      ['vo2max', 1],
      ['enduranceCapacity', 1],
      ['tdee', 1],
      ['insulinSensitivity', 1],
      ['sbp', -1],
      ['crp', -1],
      ['glycogenTotal', 1],
      ['hunger', -1],
    ],
  },
  steps: {
    id: 'steps',
    entry: 'activity',
    paramIds: ['activity.stepsNet', 'cardiometabolic.si.stepsA'],
    ref: '21 §4J L1; 10 §4.13; 02 §4.6',
    effects: [
      ['tdee', 1],
      ['insulinSensitivity', 1],
      ['hunger', -1],
      ['glycogenTotal', 1],
      ['enduranceCapacity', 1],
    ],
  },
  sleepExtension: {
    id: 'sleepExtension',
    entry: 'moderators',
    paramIds: ['moderators.hRef', 'moderators.siPerH', 'appetite.dSleepPerHKcal'],
    ref: '16 §4.1.1-4.1.11; 21 §4J L5',
    effects: [
      ['hunger', -1, 'shortSleep'],
      ['skeletalMuscle', 1, 'shortSleep'],
      ['leanTissue', 1, 'shortSleep'],
      ['rmr', 1, 'shortSleep'],
      ['strength', 1, 'shortSleep'],
    ],
  },
  creatine: {
    id: 'creatine',
    entry: 'intake',
    paramIds: ['intake.crXMax', 'water.creatineWaterKg'],
    ref: '21 §4J L7; 15 §4.8; 09 §4.14',
    effects: [
      ['strength', 1, 'rtPresent', 'muscle'],
      ['rtMuscleGain', 1, 'rtPresent', 'muscle'],
      ['bodyFatPct', -1, 'rtPresent', 'water'],
    ],
  },
  caffeine: {
    id: 'caffeine',
    entry: 'intake',
    paramIds: ['moderators.caffeineTHalfH', 'energy.kCaff'],
    ref: '21 §4J L6; 15 §4.6; 16 §4.2.1',
    effects: [
      ['enduranceCapacity', 1],
      ['tdee', 1],
    ],
  },
  postMealWalk: {
    id: 'postMealWalk',
    entry: 'activity',
    paramIds: [],
    ref: '21 §4J L2',
    effects: [['glucose', -1]],
  },
  lateEating: {
    id: 'lateEating',
    entry: 'intake',
    paramIds: ['intake.mClockSlopePerH'],
    ref: '21 §4J L19; 07 §4.7',
    effects: [
      ['glucose', -1],
      ['hunger', 0],
    ],
  },
};

// ---------------------------------------------------------------------------------------------------------------
// what each lever and block does (direction on the channel) and how it is probed
// ---------------------------------------------------------------------------------------------------------------

type Probe = NonNullable<EvidenceEdge['probe']>;
const pr = (base: ProbePlanId, toggle: ProbeToggle, persona: ProbePersonaId = 'man88'): Probe => ({ persona, base, toggle });

interface SourceUse {
  readonly channel: ChannelId;
  /** +1: switching on / raising moves the channel up; −1: down. */
  readonly dir: 1 | -1;
  /** Condition of every edge of this use (an effect's own condition wins). */
  readonly condition?: EdgeConditionId;
  /** Channel metrics this source does not move (documented exceptions). */
  readonly except?: readonly MetricId[];
  /** Lever parameter the probe varies (recorded in `from.params`: 0 = low corner, 1 = high corner). */
  readonly param?: string;
  readonly probe?: Probe;
}

/** Usable levers → channels (unusable levers get `infoOnly` edges below). */
export const LEVER_CHANNELS: Readonly<Record<string, readonly SourceUse[]>> = {
  energy: [{ channel: 'energyIntake', dir: 1, param: 'pct', probe: pr('deficit', { kind: 'gene', path: 'seg0.energy' }) }],
  protein: [{ channel: 'protein', dir: 1, param: 'gPerKg', probe: pr('deficit', { kind: 'gene', path: 'seg0.protein' }) }],
  carbFat: [
    { channel: 'fatShare', dir: 1, param: 'fatGPerKg', probe: pr('deficit', { kind: 'gene', path: 'seg0.fat' }) },
    { channel: 'carbIntake', dir: 1, param: 'carbG', probe: pr('veryLowCarb', { kind: 'gene', path: 'seg0.carbG' }) },
  ],
  fibre: [{ channel: 'fibre', dir: 1, param: 'g', probe: pr('maintenance', { kind: 'gene', path: 'fibre' }) }],
  eatingWindow: [
    { channel: 'eatingWindow', dir: 1, param: 'lengthH', probe: pr('maintenance', { kind: 'gene', path: 'window.lengthH' }) },
    { channel: 'mealCount', dir: 1, param: 'meals', probe: pr('maintenance', { kind: 'gene', path: 'meals' }) },
  ],
  resistanceTraining: [{ channel: 'resistanceTraining', dir: 1, param: 'sessions', probe: pr('maintenance', { kind: 'gene', path: 'rt.sessions' }) }],
  cardio: [{ channel: 'cardio', dir: 1, param: 'sessions', probe: pr('maintenance', { kind: 'gene', path: 'cardio.sessions' }) }],
  dietBreak: [{ channel: 'energyIntake', dir: 1, probe: pr('deficit', { kind: 'segments', segments: [{ kind: 'cycle', on: 'B1', off: 'B8' }] }) }],
  refeedDay: [{ channel: 'energyIntake', dir: 1, probe: pr('deficit', { kind: 'overlay', overlay: { lever: 'refeedDay', days: 1 } }) }],
  lowDays: [{ channel: 'lowEnergyDays', dir: 1, probe: pr('deficit', { kind: 'segments', segments: [{ kind: 'phase', block: 'B11' }] }) }],
  zeroDay: [{ channel: 'zeroIntake', dir: 1, probe: pr('maintenance', { kind: 'segments', segments: [{ kind: 'phase', block: 'B12', perWeek: 2 }] }) }],
  fastDay24: [{ channel: 'zeroIntake', dir: 1, probe: pr('maintenance', { kind: 'overlay', overlay: { lever: 'fastDay24', perWeek: 1 } }) }],
  // the fast late in the plan, so goal functionals that read the last week (IGF-1) see it
  // (the micronutrient score reads eating days only: one multi-day fast does not move it)
  waterFast: [
    { channel: 'zeroIntake', dir: 1, param: 'durationH', except: ['micronutrientScore'], probe: pr('maintenance', { kind: 'event', durationH: 72, genes: { 'ev.pos': 1 } }) },
  ],
  L1: [{ channel: 'steps', dir: 1, param: 'steps', probe: pr('maintenance', { kind: 'gene', path: 'steps' }) }],
  // not in the v1 grammar (catalogue-only levers): edges exist, no probe can switch them on
  L2: [{ channel: 'postMealWalk', dir: 1 }],
  L5: [{ channel: 'sleepExtension', dir: 1, param: 'extraH', probe: pr('maintenance', { kind: 'flag', flag: 'sleepExtension' }) }],
  L6: [{ channel: 'caffeine', dir: 1 }],
  L7: [{ channel: 'creatine', dir: 1, param: 'g', probe: pr('maintenance', { kind: 'flag', flag: 'creatine' }) }],
  L8: [{ channel: 'omega3', dir: 1, param: 'g', probe: pr('maintenance', { kind: 'flag', flag: 'omega3' }) }],
  L9: [{ channel: 'viscousFibre', dir: 1, param: 'g', probe: pr('maintenance', { kind: 'flag', flag: 'viscousFibre' }) }],
  // applied by construction in every plan (last meal ≥ 3 h before bed): no switch to probe
  L19: [{ channel: 'lateEating', dir: -1 }],
};

/** Planner blocks (phases, cycle halves, overlays, events) → channels, relative to the probe's base plan. */
export const BLOCK_CHANNELS: Partial<Readonly<Record<BlockId, readonly SourceUse[]>>> = {
  B1: [{ channel: 'energyIntake', dir: -1, probe: pr('maintenance', { kind: 'segments', segments: [{ kind: 'phase', block: 'B1' }] }) }],
  // a 5-15 % deficit stays under the appetite module's adherence threshold
  B24: [{ channel: 'energyIntake', dir: -1, except: ['adherence'], probe: pr('maintenance', { kind: 'segments', segments: [{ kind: 'phase', block: 'B24' }] }) }],
  B3: [{ channel: 'energyIntake', dir: -1, probe: pr('maintenance', { kind: 'segments', segments: [{ kind: 'phase', block: 'B3' }] }) }],
  // macro blocks compared at equal energy (their phase energy at 100 %)
  B2: [{ channel: 'carbIntake', dir: -1, probe: pr('maintenance', { kind: 'segments', segments: [{ kind: 'phase', block: 'B2' }], genes: { 'seg0.energy': 1 } }) }],
  // B6 also lowers protein (1.0-1.6 g/kg) and raises sugars: expenditure, the autophagy signal, ApoB and liver fat follow
  // those more than the fat share there
  B6: [
    {
      channel: 'fatShare',
      dir: -1,
      except: ['tdee', 'autophagyIdx', 'apoB', 'liverFat'],
      probe: pr('maintenance', { kind: 'segments', segments: [{ kind: 'phase', block: 'B6' }], genes: { 'seg0.energy': 1 } }),
    },
  ],
  B11: [{ channel: 'lowEnergyDays', dir: 1, probe: pr('deficit', { kind: 'segments', segments: [{ kind: 'phase', block: 'B11' }] }) }],
  B12: [{ channel: 'zeroIntake', dir: 1, probe: pr('maintenance', { kind: 'segments', segments: [{ kind: 'phase', block: 'B12', perWeek: 2 }] }) }],
  // a surplus only where the person may gain (17 HC-E8)
  // a surplus only where the person may gain (17 HC-E8); its small glucose and triglyceride shifts follow the block's
  // carbohydrate share more than the extra energy
  B21: [{ channel: 'energyIntake', dir: 1, condition: 'surplus', except: ['glucose'], probe: pr('maintenance', { kind: 'segments', segments: [{ kind: 'phase', block: 'B21' }] }) }],
  B23: [{ channel: 'energyIntake', dir: 1, condition: 'surplus', except: ['triglycerides'], probe: pr('maintenance', { kind: 'segments', segments: [{ kind: 'phase', block: 'B23' }] }) }],
  B22: [{ channel: 'energyIntake', dir: 1, probe: pr('deficit', { kind: 'segments', segments: [{ kind: 'phase', block: 'B1' }, { kind: 'phase', block: 'B22' }] }) }],
  B8: [{ channel: 'energyIntake', dir: 1, probe: pr('deficit', { kind: 'segments', segments: [{ kind: 'cycle', on: 'B1', off: 'B8' }] }) }],
  B9: [{ channel: 'energyIntake', dir: 1, probe: pr('deficit', { kind: 'overlay', overlay: { lever: 'refeedDay', days: 1 } }) }],
  B13: [{ channel: 'zeroIntake', dir: 1, probe: pr('maintenance', { kind: 'overlay', overlay: { lever: 'fastDay24', perWeek: 1 } }) }],
  B14: [{ channel: 'zeroIntake', dir: 1, except: ['micronutrientScore'], probe: pr('maintenance', { kind: 'event', durationH: 48, genes: { 'ev.pos': 1 } }) }],
  B15: [{ channel: 'zeroIntake', dir: 1, except: ['micronutrientScore'], probe: pr('maintenance', { kind: 'event', durationH: 72, genes: { 'ev.pos': 1 } }) }],
  // expert tier only (clinician attestation): no probe persona holds it
  B16: [{ channel: 'zeroIntake', dir: 1, except: ['micronutrientScore'] }],
};

/**
 * Levers without an engine channel (`plannerUsable: false`): the known mechanism, not simulated (R5 `info-only`). The
 * Evidence library lists these as "known mechanism, not yet in the model"; the planner never credits them.
 */
export const INFO_ONLY_EDGES: Readonly<Record<string, ReadonlyArray<readonly [MetricId, 1 | -1 | 0]>>> = {
  L3: [['glucose', -1], ['insulinSensitivity', 1], ['tdee', 1]],
  L4: [['vo2max', 1], ['glucose', -1]],
  L10: [['glucose', -1]],
  L11: [['hunger', -1], ['fatMass', -1]],
  L12: [['fatMass', -1], ['hunger', -1]],
  L13: [['adherence', 1], ['fatMass', -1]],
  L14: [['fatMass', -1], ['adherence', 1]],
  L15: [['sbp', -1], ['vo2max', 1]],
  L16: [['insulinSensitivity', 1], ['rtMuscleGain', -1]],
  L17: [['enduranceCapacity', 1]],
  L18: [['triglycerides', -1], ['rtMuscleGain', 1]],
};

/** Catalogue outcome families (E8) → goal metrics, with the metric direction of a benefit. Unlisted outcomes reach no goal metric. */
export const CATALOGUE_OUTCOME_METRICS: Readonly<Record<string, ReadonlyArray<readonly [MetricId, 1 | -1]>>> = {
  hypertrophy: [['skeletalMuscle', 1], ['leanTissue', 1], ['rtMuscleGain', 1]],
  strength: [['strength', 1]],
  energy: [['tdee', 1]],
  cardio: [['vo2max', 1], ['enduranceCapacity', 1]],
  protein: [['leanTissue', 1]],
  fibre: [['ldl', -1]],
  lipids: [['ldl', -1], ['triglycerides', -1]],
  bloodPressure: [['sbp', -1]],
  performance: [['enduranceCapacity', 1]],
  micronutrient: [['micronutrientScore', 1]],
  // supplement outcome labels (free text in the seed)
  'FFM with RT': [['leanTissue', 1]],
  'MPS during energy deficit': [['leanTissue', 1]],
  'LBM/strength vs whey with RT': [['leanTissue', 1], ['strength', 1]],
  'chronic hypertrophy': [['skeletalMuscle', 1]],
  'LBM with RT': [['leanTissue', 1]],
  'endurance TT': [['enduranceCapacity', 1]],
  'fat loss': [['fatMass', -1]],
  'BP and stroke': [['sbp', -1]],
  BP: [['sbp', -1]],
  TG: [['triglycerides', -1]],
  weight: [['fatMass', -1]],
  'weight/fat': [['fatMass', -1]],
  'LDL-C': [['ldl', -1]],
  'weight in calorie restriction': [['fatMass', -1]],
  'low-carb flu prevention': [['ketoInduction', -1]],
  'muscle strength': [['strength', 1]],
  'time to exhaustion': [['enduranceCapacity', 1]],
  'time trial': [['enduranceCapacity', 1]],
  '4-10 min efforts': [['enduranceCapacity', 1]],
  'Wingate/Yo-Yo performance': [['enduranceCapacity', 1]],
  'micronutrient adequacy': [['micronutrientScore', 1]],
  'prevention of deficiency': [['micronutrientScore', 1]],
  'preventing deficiency in at-risk diets': [['micronutrientScore', 1]],
};

/**
 * A catalogue item reaches the engine through the same Schedule channel as a planner lever (a resistance session's sets,
 * a cardio session's MET-minutes, protein, creatine, omega-3, viscous fibre): its liveness is that channel's, probed with
 * the lever's switch. Items whose channel no planner lever writes (caffeine, sodium, magnesium) have no probe.
 */
function catalogueProbe(inputs: readonly string[]): Probe | undefined {
  const has = (p: string) => inputs.some((i) => i.startsWith(p));
  if (has('ResistanceSession.')) return LEVER_CHANNELS.resistanceTraining![0]!.probe;
  if (has('CardioSession.')) return LEVER_CHANNELS.cardio![0]!.probe;
  if (has('substances.creatineG')) return LEVER_CHANNELS.L7![0]!.probe;
  if (has('macros.fatTypes.omega3G')) return LEVER_CHANNELS.L8![0]!.probe;
  if (has('macros.fibre')) return LEVER_CHANNELS.L9![0]!.probe;
  if (has('macros.protein') || has('meals[].macros.proteinG')) return LEVER_CHANNELS.protein![0]!.probe;
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------------------------------------------

const def = (m: MetricId): SeriesDef => SERIES[SERIES_INDEX[m]] as SeriesDef;
/**
 * Engine module that turns the channel into the metric: the series owner, except the planner's scale-weight goal (it reads
 * tissue mass, which composition owns; water only adds glycogen, sodium and gut-content swings) and body fat % (fat
 * mass over scale weight: composition's fat mass is the mechanism).
 */
const moduleOf = (m: MetricId): string => (m === 'scaleWeight' || m === 'bodyFatPct' ? 'composition' : def(m).owner);
const topicOf = (m: MetricId): EvidenceTopicSlug => (def(m).sources[0]?.topic ?? 'body-weight-models') as EvidenceTopicSlug;

/** Bus signals a module writes that another module reads (the direct links of the signal contract). */
export function pathSignals(from: ModuleId, to: string): SignalName[] {
  if (from === to) return [];
  return SIGNAL_DEFS.filter((s) => s.writer === from && (s.readers as readonly string[]).includes(to)).map((s) => s.name as SignalName);
}

const GRADE_ORDER: readonly EvidenceGrade[] = ['A', 'B', 'C', 'D'];
const lower = (a: EvidenceGrade, b: EvidenceGrade): EvidenceGrade => (GRADE_ORDER.indexOf(a) >= GRADE_ORDER.indexOf(b) ? a : b);

function channelEdges(kind: 'lever' | 'block', id: string, use: SourceUse, grade: EvidenceGrade, ref: string): EvidenceEdge[] {
  const ch = CHANNELS[use.channel];
  return ch.effects.filter(([metric]) => !use.except?.includes(metric)).map(([metric, sign, cond, module]) => {
    const condition = cond ?? use.condition;
    const mod = module ?? moduleOf(metric);
    const s = (sign * use.dir) as 1 | -1 | 0;
    const e: EvidenceEdge = {
      id: `${id}>${ch.id}>${metric}`,
      from: { kind, id, ...(use.param ? { params: { [use.param]: 1 } } : {}) },
      mechanism: { module: mod, paramIds: ch.paramIds, signals: pathSignals(ch.entry, mod), series: [metric] },
      metric,
      sign: s === 0 ? 0 : s,
      status: 'modelled',
      certainty: lower(grade, def(metric).grade as EvidenceGrade),
      source: { topic: topicOf(metric), refs: [] },
      maintainerRef: `${ref}; ${ch.ref}; ${def(metric).src}`,
    };
    if (condition) e.condition = condition;
    if (use.probe) e.probe = use.probe;
    return e;
  });
}

function buildGraph(): EvidenceEdge[] {
  const out: EvidenceEdge[] = [];
  for (const l of LEVERS) {
    if (l.plannerUsable) {
      for (const use of LEVER_CHANNELS[l.id] ?? []) out.push(...channelEdges('lever', l.id, use, l.grade, l.source));
    } else {
      for (const [metric, sign] of INFO_ONLY_EDGES[l.id] ?? [])
        out.push({
          id: `${l.id}>infoOnly>${metric}`,
          from: { kind: 'lever', id: l.id },
          mechanism: { module: def(metric).owner, paramIds: [], signals: [], series: [metric] },
          metric,
          sign,
          status: 'infoOnly',
          certainty: l.grade,
          source: { topic: 'other-levers', refs: [] },
          maintainerRef: `${l.source}; ${l.unsupportedReason ?? ''}`,
        });
    }
  }
  for (const [id, uses] of Object.entries(BLOCK_CHANNELS) as Array<[BlockId, readonly SourceUse[]]>) {
    const b = BLOCKS[id];
    for (const use of uses) out.push(...channelEdges('block', id, use, b.grade, b.dossier));
  }
  for (const c of catalogueEdges(SEED_CATALOGUE)) {
    const targets = CATALOGUE_OUTCOME_METRICS[c.outcome];
    // sign 0 in the catalogue = trials found no effect for that outcome: evidence of no mechanism, not an edge (R5)
    if (!targets || c.sign === 0) continue;
    const probe = catalogueProbe(c.engineInputs);
    const entry: ModuleId = c.module === 'muscle' ? 'muscle' : c.module === 'activity' ? 'activity' : 'intake';
    for (const [metric, dir] of targets)
      out.push({
        id: `${c.id}>${metric}`,
        from: { kind: 'catalogue', id: c.from.id },
        mechanism: { module: c.module === 'other' ? moduleOf(metric) : entry, paramIds: [], signals: pathSignals(entry, moduleOf(metric)), series: [metric] },
        metric,
        sign: (c.sign * dir) as 1 | -1 | 0,
        status: c.status,
        certainty: c.certainty,
        source: { topic: topicOf(metric), refs: [] },
        maintainerRef: `catalogue ${c.from.id} (${c.outcome}; engine inputs ${c.engineInputs.join(', ') || 'none'})`,
        ...(probe && c.status !== 'infoOnly' ? { probe } : {}),
      });
  }
  return out;
}

/** The evidence graph (built once at module load; pure data). */
export const EVIDENCE_EDGES: readonly EvidenceEdge[] = buildGraph();

const BY_METRIC = new Map<MetricId, EvidenceEdge[]>();
for (const e of EVIDENCE_EDGES) {
  const list = BY_METRIC.get(e.metric) ?? [];
  list.push(e);
  BY_METRIC.set(e.metric, list);
}

/** Every edge that reaches `metric` ("what moves this metric"). */
export function edgesTo(metric: MetricId): readonly EvidenceEdge[] {
  return BY_METRIC.get(metric) ?? [];
}

/** Edges leaving one lever, block or catalogue item. */
export function edgesFrom(id: string): readonly EvidenceEdge[] {
  return EVIDENCE_EDGES.filter((e) => e.from.id === id);
}

/** Zero-intake levers and blocks (24-h fasts, zero-energy days, multi-day water-only fasts). */
export const ZERO_INTAKE_SOURCES: ReadonlySet<string> = new Set([
  ...LEVERS.filter((l) => l.family === 'zeroIntake').map((l) => l.id),
  ...(['B12', 'B13', 'B14', 'B15', 'B16'] as const),
]);

/**
 * PLANNER_V2_SPEC §3.1: a zero-intake lever has an edge to the metric with status ≠ infoOnly and a sign that helps the
 * goal's direction (`up` = the goal wants the metric higher), or sign 0 (condition-dependent).
 */
export function servesFasting(metric: MetricId, direction: 'up' | 'down'): boolean {
  const want = direction === 'up' ? 1 : -1;
  return edgesTo(metric).some((e) => ZERO_INTAKE_SOURCES.has(e.from.id) && e.status !== 'infoOnly' && (e.sign === 0 || e.sign === want));
}

/** Plain-language status labels for the Evidence library (R5 wording). */
export const STATUS_TEXT: Readonly<Record<MechanismStatus, string>> = {
  modelled: 'The model simulates how it works.',
  mapped: 'Counted by how it works, through a mechanism the model already simulates.',
  infoOnly: 'Known mechanism, not yet in the model.',
};

/** Levers the graph says nothing about (a usable lever without a channel, an unusable one without an info-only edge). */
export function leversWithoutEdges(): string[] {
  return LEVERS.filter((l) => (l.plannerUsable ? !LEVER_CHANNELS[l.id] : !INFO_ONLY_EDGES[l.id])).map((l) => l.id);
}
