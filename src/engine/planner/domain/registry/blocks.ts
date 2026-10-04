/**
 * Building-block library (dossier 13 §4C, blocks B0-B22) as typed data for the planner grammar (dossier 18 §4.16).
 *
 * Blocks are defined only by measurable quantities: energy as % of the modelled maintenance (13 §4C: "% of the user's
 * current modelled TDEE"; the engine resolves it with `reference: 'blockStart'`), protein/fat/carbohydrate in g/kg
 * body weight, g/d or % energy, and durations in weeks. Every range is copied from 13 §4C; where a 17 hard constraint
 * is stricter, the planner intersects at decode/repair time (the block keeps the dossier value).
 *
 * `use` says how the grammar uses a block: `phase` (a segment of the plan), `cycleOff` (the maintenance half of a
 * cycle), `overlay` (recurring days inside a phase), `event` (hour-exact zero-intake spans), `rule` (enforced by
 * repair), `simulateOnly` (13/20: not planner-prescribable) or `registryOnly` (needs inputs the planner does not have).
 */
import type { EvidenceGrade } from '../types';
import type { SafetyCaps } from '../safety';

export type BlockId =
  | 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9' | 'B10' | 'B11'
  | 'B12' | 'B13' | 'B14' | 'B15' | 'B16' | 'B17' | 'B18' | 'B19' | 'B20' | 'B21' | 'B22' | 'B23' | 'B24';

export type BlockFamily =
  | 'maintenance' | 'deficit' | 'veryLowCarb' | 'aggressiveDeficit' | 'veryLowEnergy' | 'veryLowFat' | 'dietBreak'
  | 'refeed' | 'carbLoad' | 'intermittentRestriction' | 'alternateDay' | 'zeroIntake' | 'trainLow' | 'reintroduction'
  | 'fibreRamp' | 'surplus' | 'recovery';

export type BlockUse = 'phase' | 'cycleOff' | 'overlay' | 'event' | 'rule' | 'simulateOnly' | 'registryOnly';

/** 18 §4.4.1 SafetyTier extended with 17's expert-mode tier (MODEL_SPEC §10.3). */
export type SafetyTier = 'default' | 'optIn' | 'expert' | 'never';

export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface BlockDef {
  readonly id: BlockId;
  /** Measurable name (no brand names). */
  readonly name: string;
  readonly family: BlockFamily;
  readonly use: BlockUse;
  readonly useNote?: string;
  readonly energyRole: 'deficit' | 'maintenance' | 'surplus' | 'mixed' | 'zero';
  /** Energy, % of modelled maintenance. */
  readonly energyPct?: Range;
  /** Energy, absolute kcal/d. */
  readonly energyKcal?: Range;
  readonly proteinGPerKgBw?: Range;
  /** B1: protein range for people who do not train (≥ 1.2 g/kg instead of 1.6-2.4). */
  readonly proteinGPerKgBwUntrained?: Range;
  /** Protein per kg ideal body weight (BMI-22 weight, 13 §4C). */
  readonly proteinGPerKgIbw?: Range;
  readonly fatGPerKgBw?: Range;
  readonly fatPctEnergy?: Range;
  readonly carbG?: Range;
  readonly carbGPerKgBw?: Range;
  readonly carbPctEnergy?: Range;
  readonly fibreG?: Range;
  /** Which macro takes the remaining energy. */
  readonly remainder?: 'carbs' | 'fat';
  /** Duration of one block instance, weeks (null = no limit given by the dossier; the grammar then uses ≥ 2 weeks, 18 §4.9). */
  readonly durationWeeks: (Range & { readonly default?: number }) | null;
  /** Mandatory resistance-training sessions per week (B3). */
  readonly minRtSessions?: number;
  /** Days per week (overlays) or instances (events). */
  readonly perWeek?: Range;
  readonly prerequisites: readonly string[];
  /** Planner tier for this person (17 via compiled caps). */
  tier(caps: SafetyCaps): SafetyTier;
  readonly grade: EvidenceGrade;
  /** Maintainer pointer into the research files: code-only, never rendered (not in any explanation, UI or export). */
  readonly dossier: string;
  /** What the block is and why it is used (explanations; never credits sequencing itself, MODEL_SPEC R-SEQ). */
  readonly rationale: string;
  readonly tradeoffs: string;
}

const deficitTier = (c: SafetyCaps): SafetyTier => (c.deficitCapPct > 0 ? 'default' : 'never');
const vTier = (c: SafetyCaps): SafetyTier => (c.bmi >= 30 && c.deficitCapPct > 0 ? 'expert' : 'never');

/** Library version (stored in plan provenance). */
export const LIBRARY_VERSION = 1;

export const BLOCKS: Readonly<Record<BlockId, BlockDef>> = {
  B0: {
    id: 'B0', name: 'Mixed maintenance', family: 'maintenance', use: 'phase', energyRole: 'maintenance',
    energyPct: { min: 100, max: 100 }, proteinGPerKgBw: { min: 1.2, max: 2.2 }, fatGPerKgBw: { min: 0.6, max: 1.5 },
    fibreG: { min: 25, max: 40 }, remainder: 'carbs', durationWeeks: null,
    prerequisites: [], tier: () => 'default', grade: 'A', dossier: '13 §4C B0',
    rationale: 'Eat at maintenance with a mixed diet; the reference against which every other block is judged.',
    tradeoffs: 'No change in fat mass is expected from energy balance.',
  },
  B1: {
    id: 'B1', name: 'Moderate continuous deficit', family: 'deficit', use: 'phase', energyRole: 'deficit',
    energyPct: { min: 75, max: 85 }, proteinGPerKgBw: { min: 1.6, max: 2.4 }, fatGPerKgBw: { min: 0.5, max: 1.5 },
    remainder: 'carbs', durationWeeks: null, proteinGPerKgBwUntrained: { min: 1.2, max: 2.4 },
    prerequisites: ['stays above the safety floors for energy and nutrients'], tier: deficitTier, grade: 'A', dossier: '13 §4C B1',
    rationale: 'A steady 15-25 % energy deficit with high protein; fat loss follows the energy deficit.',
    tradeoffs: 'Hunger builds slowly over weeks; a diet break every 4-12 weeks is offered for adherence.',
  },
  B2: {
    id: 'B2', name: 'Very-low-carbohydrate (net carbohydrate 20-50 g/d)', family: 'veryLowCarb', use: 'phase', energyRole: 'mixed',
    energyPct: { min: 75, max: 100 }, proteinGPerKgBw: { min: 1.2, max: 2.0 }, carbG: { min: 20, max: 50 }, remainder: 'fat',
    durationWeeks: { min: 3, max: 12 },
    prerequisites: ['mode M0', 'no type 1 diabetes / SGLT2 inhibitor / pregnancy', 'min 21 d', '≤ 12 wk per block'],
    tier: (c) => (c.ketogenicAllowed ? 'default' : 'never'), grade: 'B', dossier: '13 §4C B2; 17 HC-M4',
    rationale: 'Net carbohydrate below 50 g/d so the body runs mainly on fat and ketones (useful for ketone-related goals).',
    tradeoffs: 'Scale weight drops 1.5-2.5 kg of water in week 1 and returns when carbohydrate comes back; LDL may rise; induction symptoms in days 2-4.',
  },
  B3: {
    id: 'B3', name: 'Aggressive short deficit with resistance training', family: 'aggressiveDeficit', use: 'phase', energyRole: 'deficit',
    energyPct: { min: 55, max: 70 }, proteinGPerKgBw: { min: 2.3, max: 2.4 }, carbGPerKgBw: { min: 2, max: Infinity },
    fatGPerKgBw: { min: 0.5, max: 0.8 }, remainder: 'carbs', durationWeeks: { min: 2, max: 4 }, minRtSessions: 3,
    prerequisites: ['BF ≥ 10 % (men) / ≥ 18 % (women)', 'age 18-65', 'no ED history', '≥ 3 RT sessions/wk', '≥ 4 wk maintenance before repeating'],
    tier: (c) => (c.deficitCapPct > 0 && c.ageYears <= 65 && c.mode !== 'R1' && c.bodyFatPct >= c.bfFloorPct ? 'default' : 'never'),
    grade: 'C', dossier: '13 §4C B3',
    rationale: 'A short, larger deficit (30-45 %) with very high protein and mandatory resistance training, bounded by the deficit cap.',
    tradeoffs: 'Hunger rises quickly; only 2-4 weeks, followed by maintenance.',
  },
  B4: {
    id: 'B4', name: 'Protein-sparing very-low-energy (600-900 kcal/d)', family: 'veryLowEnergy', use: 'simulateOnly',
    useNote: 'Expert mode only, BMI ≥ 30, under clinical supervision; not proposed by the planner.', energyRole: 'deficit',
    energyKcal: { min: 600, max: 900 }, proteinGPerKgIbw: { min: 1.2, max: 1.5 }, carbG: { min: 0, max: 20 },
    durationWeeks: { min: 1, max: 12 }, prerequisites: ['BMI ≥ 30 (or ≥ 27 with comorbidity)', 'baseline ECG', 'labs'], tier: vTier,
    grade: 'B', dossier: '13 §4C B4', rationale: 'Very-low-energy, protein-only regime.', tradeoffs: 'Clinical supervision required.',
  },
  B5: {
    id: 'B5', name: 'Formula total diet replacement (800-850 kcal/d)', family: 'veryLowEnergy', use: 'simulateOnly',
    useNote: 'Expert mode only; not proposed by the planner.', energyRole: 'deficit',
    energyKcal: { min: 800, max: 850 }, proteinGPerKgIbw: { min: 0.8, max: 1.2 }, durationWeeks: { min: 8, max: 20 },
    prerequisites: ['BMI ≥ 27 with T2D or ≥ 30'], tier: vTier, grade: 'A', dossier: '13 §4C B5',
    rationale: 'Very-low-energy formula diet.', tradeoffs: 'Clinical programme.',
  },
  B6: {
    id: 'B6', name: 'Very-low-fat, high-carbohydrate', family: 'veryLowFat', use: 'phase', energyRole: 'mixed',
    energyPct: { min: 75, max: 100 }, proteinGPerKgBw: { min: 1.0, max: 1.6 }, fatPctEnergy: { min: 10, max: 15 },
    carbPctEnergy: { min: 65, max: 75 }, remainder: 'carbs', durationWeeks: null,
    prerequisites: ['fat ≥ 15 % of energy and ≥ 30 g/d (the safety limit is stricter than the block and wins)'], tier: () => 'default',
    grade: 'B', dossier: '13 §4C B6; 17 HC-M3',
    rationale: 'Fat at the 15 %-of-energy floor, most energy from carbohydrate (used for LDL/ApoB goals).',
    tradeoffs: 'Triglycerides may rise with high sugar; scale weight rises briefly when moving from low-carbohydrate eating.',
  },
  B7: {
    id: 'B7', name: 'Protein-only very-low-energy week', family: 'veryLowEnergy', use: 'simulateOnly',
    useNote: 'Simulate-only for people who do not meet the prerequisites of the protein-sparing very-low-energy regime; expert mode otherwise.', energyRole: 'deficit',
    carbG: { min: 0, max: 20 }, durationWeeks: { min: 1, max: 1 }, prerequisites: ['as for the protein-sparing very-low-energy regime'], tier: vTier, grade: 'D',
    dossier: '13 §4C B7', rationale: 'Protein-only week.', tradeoffs: 'Not planner-prescribable.',
  },
  B8: {
    id: 'B8', name: 'Diet break at maintenance', family: 'dietBreak', use: 'cycleOff', energyRole: 'maintenance',
    energyPct: { min: 100, max: 100 }, remainder: 'carbs', durationWeeks: { min: 1, max: 2 },
    prerequisites: ['after 2-12 weeks of deficit'], tier: () => 'default', grade: 'B', dossier: '13 §4C B8; 17 HC-E7',
    rationale: 'One to two weeks at maintenance (extra energy mainly as carbohydrate, protein unchanged) to lower hunger and diet fatigue.',
    tradeoffs: 'Scale weight rises 0.5-1.0 kg in 2-4 days from glycogen and water; the model credits no extra fat loss to the break itself.',
  },
  B9: {
    id: 'B9', name: 'Refeed day(s)', family: 'refeed', use: 'overlay', energyRole: 'maintenance',
    energyPct: { min: 100, max: 120 }, carbGPerKgBw: { min: 6, max: 10 }, fatGPerKgBw: { min: 0, max: 0.6 },
    durationWeeks: null, perWeek: { min: 1, max: 2 }, prerequisites: ['1-2 consecutive days, ≤ 2 d/week'],
    tier: () => 'default', grade: 'C', dossier: '13 §4C B9',
    rationale: 'One or two higher-carbohydrate days at 100-120 % of maintenance inside a deficit, to ease hunger.',
    tradeoffs: 'Scale weight +0.5-1.5 kg resolving over 2-4 days; lowers the weekly deficit slightly.',
  },
  B10: {
    id: 'B10', name: 'Carbohydrate load (10 g/kg for 24-36 h)', family: 'carbLoad', use: 'registryOnly',
    useNote: 'Needs an endurance-event date, which the planner request does not carry.', energyRole: 'surplus',
    carbGPerKgBw: { min: 10, max: 10 }, proteinGPerKgBw: { min: 1.2, max: 1.6 }, durationWeeks: null, prerequisites: ['event > 90 min'],
    tier: () => 'default', grade: 'A', dossier: '13 §4C B10', rationale: 'Pre-event glycogen loading.', tradeoffs: '+1-2 kg scale weight.',
  },
  B11: {
    id: 'B11', name: 'Two low-energy days per week (500-700 kcal)', family: 'intermittentRestriction', use: 'phase', energyRole: 'deficit',
    energyPct: { min: 95, max: 100 }, energyKcal: { min: 500, max: 700 }, proteinGPerKgBw: { min: 1.0, max: 2.4 },
    fatGPerKgBw: { min: 0.5, max: 1.5 }, remainder: 'carbs', durationWeeks: null, perWeek: { min: 2, max: 2 },
    prerequisites: ['low days non-consecutive, ≥ 500 kcal (F) / 600 kcal (M), ≤ 2 per rolling 7 d'],
    tier: deficitTier, grade: 'A', dossier: '13 §4C B11; 17 HC-E2',
    rationale: 'Two non-consecutive low-energy days a week with ~95-100 % on the other five: the weekly deficit is delivered in two days.',
    tradeoffs: 'Same fat loss as an equal continuous deficit (no fasting bonus; see Evidence › Fasting, meal timing and eating windows); low days are hungry days.',
  },
  B12: {
    id: 'B12', name: 'Alternate zero-energy days (36-42 h water-only fasts)', family: 'alternateDay', use: 'phase', energyRole: 'deficit',
    energyPct: { min: 100, max: 120 }, proteinGPerKgBw: { min: 1.2, max: 2.2 }, fatGPerKgBw: { min: 0.5, max: 1.5 },
    remainder: 'carbs', durationWeeks: null, perWeek: { min: 2, max: 3 },
    prerequisites: ['opt-in for fasts up to 48 h', '≤ 3/wk if ≤ 36 h, ≤ 2/wk if 36-48 h, ≥ 24 h eating between', 'eating days ≤ 120 % of maintenance', 'overweight users with a weight-loss goal'],
    tier: (c) => (c.deficitCapPct > 0 && c.fastTierAllowed.T2 && c.bmi >= 25 ? 'optIn' : 'never'), grade: 'B', dossier: '13 §4C B12; 20 §4C; 17 HC-F2',
    rationale: 'Two or three calendar days a week with no energy, eating at 100-120 % of maintenance on the others.',
    tradeoffs: 'No fat-loss advantage over an equal continuous deficit and slightly more lean loss (see Evidence › Extended water-only fasting); hunger on fast days does not habituate.',
  },
  B13: {
    id: 'B13', name: '24-h water-only fast (after the last meal to the same clock hour)', family: 'zeroIntake', use: 'overlay', energyRole: 'zero',
    energyKcal: { min: 0, max: 0 }, durationWeeks: null, perWeek: { min: 1, max: 2 },
    prerequisites: ['≤ 2 per week, non-consecutive; default-tier fasting allows up to 3 per week'],
    tier: (c) => (c.fastTierAllowed.T1 ? 'default' : 'never'), grade: 'B', dossier: '13 §4C B13; 17 HC-F1/F2; 20 §4C',
    rationale: 'A weekly 24-hour water-only fast as a way of delivering part of the weekly deficit.',
    tradeoffs: 'No metabolic credit and a small lean cost (≈ 35-45 g protein per fast in the model; see Evidence › Extended water-only fasting); avoided for muscle-gain goals.',
  },
  B14: {
    id: 'B14', name: '48-h water-only fast', family: 'zeroIntake', use: 'event', energyRole: 'zero',
    energyKcal: { min: 0, max: 0 }, durationWeeks: null, prerequisites: ['opt-in for fasts up to 48 h', '≤ 1 per 2 weeks (proposed)'],
    tier: (c) => (c.fastTierAllowed.T2 ? 'optIn' : 'never'), grade: 'C', dossier: '13 §4C B14; 17 HC-F2; 20 §4C',
    rationale: 'A two-day water-only fast (ketone, IGF-1 and autophagy-signal goals only).',
    tradeoffs: 'Repeated early nitrogen losses cost lean tissue; 1-2 kg scale swing; no fat-loss advantage (see Evidence › Extended water-only fasting).',
  },
  B15: {
    id: 'B15', name: '72-h water-only fast with a 2-day graded refeed', family: 'zeroIntake', use: 'event', energyRole: 'zero',
    energyKcal: { min: 0, max: 0 }, durationWeeks: null,
    prerequisites: ['opt-in for fasts up to 72 h and eligibility', '≤ 1 per month and ≤ 2 per 30 d, ≥ 7 d apart', 'refeed ≈ 50 % then 80-100 %'],
    tier: (c) => (c.fastTierAllowed.T3 ? 'optIn' : 'never'), grade: 'C', dossier: '13 §4C B15; 17 HC-F2/F3; 20 §4C',
    rationale: 'A three-day water-only fast followed by a locked two-day graded refeed (for users who rank IGF-1 / autophagy-signal goals).',
    tradeoffs: '≈ 270 g protein lost per fast with ≈ 50 g repleted (see Evidence › Extended water-only fasting); never used for muscle-gain goals.',
  },
  B16: {
    id: 'B16', name: '3- to 7-day water-only fast with a graded refeed', family: 'zeroIntake', use: 'event',
    useNote: 'Evidence grade D: planned only in expert mode with a clinician-supervision attestation (at most one per 12 weeks); the evidence base otherwise treats it as simulation-only; fasts over 7 days are never planned.',
    energyRole: 'zero', energyKcal: { min: 0, max: 0 }, durationWeeks: null,
    prerequisites: ['expert mode with a clinician-supervision attestation', 'BMI ≥ 25, no medication', '≥ 28 d apart, ≤ 1 per 12 wk', 'refeed ramp 50/50/75/100 % over ≥ max(4 d, ½ fast days)'],
    tier: (c) => (c.fastTierAllowed.T4 ? 'expert' : 'never'), grade: 'D', dossier: '13 §4C B16; 17 §4.3; 20 §4C; ruling 18:10',
    rationale: 'A multi-day water-only fast under clinical supervision, only for users who rank IGF-1 / autophagy-signal goals and opted into the expert tier.',
    tradeoffs: '≈ 0.45-0.63 kg protein lost per 5-7-day fast; LDL rises during the fast; no fat-loss advantage over the same deficit (see Evidence › Extended water-only fasting).',
  },
  B17: {
    id: 'B17', name: 'Five-day very-low-energy block (≈ 720-1,100 kcal/d, 9-11 %E protein)', family: 'veryLowEnergy', use: 'simulateOnly',
    useNote: 'Allowed only in expert mode; protein 16-30 g/d is below lean-sparing intake.', energyRole: 'deficit',
    energyKcal: { min: 720, max: 1100 }, durationWeeks: { min: 1, max: 1 }, prerequisites: ['V tier'], tier: vTier, grade: 'B',
    dossier: '13 §4C B17; 20 §4C', rationale: 'Monthly five-day low-energy block.', tradeoffs: 'Lean loss; V tier.',
  },
  B18: {
    id: 'B18', name: 'Train-low / sleep-low microcycle', family: 'trainLow', use: 'registryOnly',
    useNote: 'Endurance-performance protocol needing session-level carbohydrate timing and an event; the planner does not build it yet.',
    energyRole: 'maintenance', carbGPerKgBw: { min: 6, max: 6 }, durationWeeks: { min: 1, max: 3 }, prerequisites: ['endurance training'],
    tier: () => 'default', grade: 'B', dossier: '13 §4C B18', rationale: 'Endurance adaptation protocol.', tradeoffs: '—',
  },
  B19: {
    id: 'B19', name: 'Carbohydrate reintroduction ramp', family: 'reintroduction', use: 'registryOnly',
    useNote: 'Mandatory only after the very-low-energy regimes, which the planner never proposes; the simulator shows the water rebound after a very-low-carbohydrate phase.',
    energyRole: 'maintenance', carbG: { min: 0, max: 90 }, durationWeeks: { min: 2, max: 8 }, prerequisites: ['after a very-low-energy regime'],
    tier: () => 'default', grade: 'B', dossier: '13 §4C B19', rationale: 'Stepped carbohydrate return.', tradeoffs: '+1-3 kg scale (water).',
  },
  B20: {
    id: 'B20', name: 'Fibre ramp (≤ +5-10 g/d per week)', family: 'fibreRamp', use: 'rule', energyRole: 'maintenance',
    durationWeeks: null, prerequisites: [], tier: () => 'default', grade: 'D', dossier: '13 §4C B20; 21 §5A',
    rationale: 'Fibre is increased gradually when a plan raises it.', tradeoffs: 'Gut content (scale) rises ≈ 5 g stool per g NSP.',
  },
  B21: {
    id: 'B21', name: 'Surplus (gaining) phase', family: 'surplus', use: 'phase', energyRole: 'surplus',
    energyPct: { min: 110, max: 120 }, proteinGPerKgBw: { min: 1.6, max: 2.2 }, fatGPerKgBw: { min: 0.5, max: 1.5 },
    carbGPerKgBw: { min: 3, max: Infinity }, remainder: 'carbs', durationWeeks: null,
    prerequisites: ['target +0.25-0.5 %BW/wk', 'no surplus at high waist / WHtR ≥ 0.6 / BMI ≥ 30'],
    tier: (c) => (c.surplusAllowed ? 'default' : 'never'), grade: 'C', dossier: '13 §4C B21; 11; 17 HC-E8',
    rationale: 'A 10-20 % energy surplus with high protein to support muscle gain with resistance training.',
    tradeoffs: 'Some fat is gained along with lean tissue.',
  },
  B22: {
    id: 'B22', name: 'Post-diet maintenance', family: 'recovery', use: 'phase', energyRole: 'maintenance',
    energyPct: { min: 100, max: 100 }, proteinGPerKgBw: { min: 1.6, max: 2.2 }, fatGPerKgBw: { min: 0.6, max: 1.5 },
    remainder: 'carbs', durationWeeks: null, prerequisites: ['immediately at maintenance (not reverse-ramped)'],
    tier: () => 'default', grade: 'C', dossier: '13 §4C B22',
    rationale: 'Maintenance with protein kept high after a deficit, so the plan ends weight-stable.',
    tradeoffs: 'Scale weight rises briefly as glycogen and water refill.',
  },
  B23: {
    id: 'B23', name: 'Small surplus with resistance training (lean gain)', family: 'surplus', use: 'phase', energyRole: 'surplus',
    energyPct: { min: 103, max: 110 }, proteinGPerKgBw: { min: 1.6, max: 2.2 }, fatGPerKgBw: { min: 0.5, max: 1.5 },
    remainder: 'carbs', durationWeeks: null, minRtSessions: 2,
    prerequisites: ['resistance training ≥ 2 sessions/wk', 'no surplus at high waist / WHtR ≥ 0.6 / BMI ≥ 30'],
    tier: (c) => (c.surplusAllowed ? 'default' : 'never'), grade: 'B',
    // planner round 2026-09-30: the 13 §4C library had no block between maintenance (B0) and a 10-20 % surplus (B21)
    dossier: '09 §4.8 (Helms 2023: +5 % and +15 % gave the same muscle gain); 11 §4.8 (larger surplus → more fat); 13 §4C B21 lower end',
    rationale: 'A 3-10 % surplus with high protein and resistance training: most of the muscle gain of a larger surplus with less fat.',
    tradeoffs: 'Slower weight gain than a larger surplus; some fat is still gained.',
  },
  B24: {
    id: 'B24', name: 'Mild continuous deficit', family: 'deficit', use: 'phase', energyRole: 'deficit',
    energyPct: { min: 85, max: 95 }, proteinGPerKgBw: { min: 1.6, max: 2.4 }, proteinGPerKgBwUntrained: { min: 1.2, max: 2.4 },
    fatGPerKgBw: { min: 0.5, max: 1.5 }, remainder: 'carbs', durationWeeks: null,
    prerequisites: ['stays above the safety floors for energy and nutrients'], tier: deficitTier, grade: 'A',
    // planner round 2026-09-30: 13 §4C starts continuous deficits at 15 % (B1); a milder continuous deficit for people
    // whose energy availability (≥ 30 kcal/kg FFM with training, R-EA-PLANNER) or hunger tolerance caps the deficit
    dossier: '13 §4C B1 (lower end); 17 §2.2 HC-E4 and §3 W-E07; 09 §4.8 (lean tissue kept better with smaller deficits); 12 §4.9 (hunger grows with the deficit)',
    rationale: 'A steady 5-15 % energy deficit with high protein: slower fat loss that keeps energy for training and hunger low.',
    tradeoffs: 'Fat loss is slower than with a larger deficit.',
  },
};

export const BLOCK_IDS = Object.keys(BLOCKS) as BlockId[];

/** Blocks the grammar may place as plan phases. */
export const PHASE_BLOCKS: readonly BlockId[] = BLOCK_IDS.filter((id) => BLOCKS[id].use === 'phase');

/** 13 §4C sequencing rules as data (composition constraints, checked by the grammar and tests). */
export const SEQUENCING = {
  /** Rule 1: no sequencing bonus (enforced by the engine, MODEL_SPEC R-SEQ; the planner never credits order). */
  noSequencingBonus: true,
  /** Rule 2: B2 ≥ 21 d; do not alternate B2 ⇄ carbohydrate blocks more often than every 14 d. */
  b2MinDays: 21,
  b2AlternationMinDays: 14,
  /** Rule 3: refeeds ≤ 2 d/week. */
  refeedMaxPerWeek: 2,
  /** Rule 4: fasts ≥ 48 h may not be followed immediately by a ≥ 120 % day (PROPOSED). */
  noHighDayAfterFastH: 48,
  highDayPct: 120,
  /** B3: ≥ 4 weeks at maintenance before repeating. */
  b3RepeatGapWeeks: 4,
  /** Rule 9: offer a diet break after every 4-12 weeks of deficit. */
  dietBreakAfterWeeks: { min: 4, max: 12 },
} as const;
