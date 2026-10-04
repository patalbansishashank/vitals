/* ==========================================================================
   Deterministic fake data for tests and the demo route (/dev/charts).
   A toy model with plausible SHAPES (ketosis lag, glycogen refill, adaptation
   building slowly, MPS after protein + training…). It is NOT the engine and
   its numbers must never be read as physiology.
   ========================================================================== */
import { mulberry32 } from '@/lib/rng';
import type {
  ChartData,
  ChartEvent,
  ChartSeries,
  ComparisonData,
  CompositionTracks,
  ConvergenceTrace,
  DayWindow,
  DirectionOfGood,
  EvidenceGrade,
  ExerciseSession,
  IntakeContext,
  LaneKind,
  MacroSeries,
  Meal,
  MetricCategory,
  OverlayTransform,
  Phase,
  PhaseTone,
  PlanId,
  PlanSeriesSet,
  StateTrack,
  Threshold,
} from './types';

/* ------------------------------------------------------------------ programs */

interface Program {
  name: string;
  /** Energy as a fraction of baseline maintenance. */
  pct: number;
  proteinGkg: number;
  netCarbs: number;
  fibre: number;
  alcohol: number;
  /** [clock hour, share of the day's food] */
  meals: Array<[number, number]>;
  lift?: [number, number];
  cardio?: [number, number];
  walk?: [number, number];
  steps: number;
  fast?: boolean;
}

const P: Record<string, Program> = {
  A: { name: 'training day', pct: 0.85, proteinGkg: 2.0, netCarbs: 140, fibre: 30, alcohol: 0, meals: [[12.5, 0.45], [19, 0.55]], lift: [17.5, 1], steps: 8000 },
  B: { name: 'rest day', pct: 0.75, proteinGkg: 2.0, netCarbs: 60, fibre: 30, alcohol: 0, meals: [[12.5, 0.5], [19, 0.5]], steps: 7000 },
  C: { name: 'long walk day', pct: 0.8, proteinGkg: 2.0, netCarbs: 100, fibre: 32, alcohol: 0, meals: [[9.5, 0.3], [13.5, 0.3], [18.5, 0.4]], walk: [7.5, 1.5], steps: 15000 },
  D: { name: 'water-only fast', pct: 0, proteinGkg: 0, netCarbs: 0, fibre: 0, alcohol: 0, meals: [], steps: 6000, fast: true },
  E: { name: 'maintenance', pct: 1.0, proteinGkg: 1.8, netCarbs: 260, fibre: 35, alcohol: 0, meals: [[8.5, 0.3], [13, 0.35], [19, 0.35]], steps: 8000 },
  W: { name: 'maintenance, weekend', pct: 1.05, proteinGkg: 1.6, netCarbs: 250, fibre: 28, alcohol: 24, meals: [[10, 0.35], [14, 0.25], [20, 0.4]], steps: 9000 },
  F: { name: 'training, maintenance', pct: 1.0, proteinGkg: 2.0, netCarbs: 240, fibre: 32, alcohol: 0, meals: [[9.5, 0.3], [13.5, 0.3], [19, 0.4]], lift: [17.5, 1], steps: 8000 },
  G: { name: 'cardio day', pct: 0.85, proteinGkg: 1.8, netCarbs: 180, fibre: 30, alcohol: 0, meals: [[9, 0.35], [13, 0.3], [19, 0.35]], cardio: [7, 0.75], steps: 9000 },
};

interface Block {
  weeks: number;
  pattern: string;
  label: string;
  shortLabel: string;
  tone: PhaseTone;
}

type Style = 'cut' | 'steady' | 'fasts' | 'recomp';

const STYLES: Record<Style, Block[]> = {
  cut: [
    { weeks: 4, pattern: 'ABABACB', label: 'fat-loss base', shortLabel: 'base', tone: 'deficit-2' },
    { weeks: 1, pattern: 'EEEEEWW', label: 'diet break', shortLabel: 'break', tone: 'neutral' },
    { weeks: 5, pattern: 'ABADACB', label: 'fasting block', shortLabel: 'fasting', tone: 'deficit-3' },
    { weeks: 2, pattern: 'FEFEFWW', label: 'maintenance', shortLabel: 'maint.', tone: 'neutral' },
    { weeks: 6, pattern: 'ABAGACB', label: 'second cut', shortLabel: 'cut 2', tone: 'deficit-2' },
    { weeks: 1, pattern: 'EEEEEWW', label: 'diet break', shortLabel: 'break', tone: 'neutral' },
    { weeks: 5, pattern: 'ABADGCB', label: 'fasting block', shortLabel: 'fasting', tone: 'deficit-3' },
    { weeks: 3, pattern: 'FEFEFWW', label: 'maintenance', shortLabel: 'maint.', tone: 'neutral' },
  ],
  steady: [
    { weeks: 8, pattern: 'ABABACB', label: 'carb-periodised deficit', shortLabel: 'deficit', tone: 'deficit-2' },
    { weeks: 1, pattern: 'EEEEEWW', label: 'diet break', shortLabel: 'break', tone: 'neutral' },
    { weeks: 8, pattern: 'ABAGACB', label: 'carb-periodised deficit', shortLabel: 'deficit', tone: 'deficit-2' },
    { weeks: 10, pattern: 'FEFEFWW', label: 'maintenance', shortLabel: 'maint.', tone: 'neutral' },
  ],
  fasts: [
    { weeks: 17, pattern: 'ABDBACB', label: 'weekly 36 h fast', shortLabel: '36 h fast', tone: 'deficit-3' },
    { weeks: 10, pattern: 'FEFEFWW', label: 'maintenance', shortLabel: 'maint.', tone: 'neutral' },
  ],
  recomp: [{ weeks: 27, pattern: 'FEFEFCW', label: 'recomposition at maintenance', shortLabel: 'recomp', tone: 'neutral' }],
};

function buildSchedule(style: Style, days: number): { programs: string[]; phases: Phase[] } {
  const programs: string[] = [];
  const phases: Phase[] = [];
  const blocks = STYLES[style];
  let k = 0;
  while (programs.length < days) {
    const b = blocks[k % blocks.length]!;
    const start = programs.length;
    for (let w = 0; w < b.weeks && programs.length < days; w++)
      for (let d = 0; d < 7 && programs.length < days; d++) programs.push(b.pattern[d]!);
    const prev = phases[phases.length - 1];
    if (prev && prev.label === b.label) prev.endDay = programs.length;
    else
      phases.push({
        startDay: start,
        endDay: programs.length,
        label: b.label,
        shortLabel: b.shortLabel,
        letter: String(phases.length + 1),
        tone: b.tone,
      });
    k++;
  }
  return { programs, phases };
}

/* --------------------------------------------------------------- catalogue */

interface MetricMeta {
  id: string;
  label: string;
  shortLabel: string;
  category: MetricCategory;
  unit: string;
  grade: EvidenceGrade;
  decimals: number;
  direction: DirectionOfGood;
  kind?: LaneKind;
  overlay?: OverlayTransform;
  overlayNote?: string;
  thresholds?: Threshold[];
  reference?: { lo: number; hi: number; label?: string };
  domain?: 'hug' | 'zero';
  mechanism?: string;
  /** Band half-width: absolute at start + absolute growth by the end of 183 days. */
  band: [number, number];
  hourly?: boolean;
}

/** Appendix A of CHART_SPEC plus the hourly helpers the day view needs. */
export const FIXTURE_METRICS: readonly MetricMeta[] = [
  { id: 'fat_mass', label: 'Fat mass', shortLabel: 'fat', category: 'body', unit: 'kg', grade: 'A', decimals: 1, direction: 'lower', band: [0.12, 2.2], mechanism: 'Falls as the deficit draws on stores; the rate slows as metabolic adaptation builds (grade A).' },
  { id: 'lean_mass', label: 'Lean mass', shortLabel: 'lean', category: 'body', unit: 'kg', grade: 'B', decimals: 1, direction: 'higher', band: [0.18, 1.6], mechanism: 'Holds when protein is at least 1.6 g/kg with lifting; dips with glycogen water on fast days.' },
  { id: 'scale_weight', label: 'Scale weight', shortLabel: 'weight', category: 'body', unit: 'kg', grade: 'A', decimals: 1, direction: 'neutral', band: [0.35, 2.5], mechanism: 'Fat plus lean tissue plus glycogen and the water bound to it; fast days move it by a kilo or more.' },
  { id: 'skeletal_muscle', label: 'Skeletal muscle', shortLabel: 'muscle', category: 'body', unit: 'kg', grade: 'B', decimals: 1, direction: 'higher', band: [0.2, 1.2] },
  { id: 'body_fat_pct', label: 'Body fat', shortLabel: 'body fat', category: 'body', unit: '%', grade: 'B', decimals: 1, direction: 'lower', band: [0.4, 2.4] },
  { id: 'body_water', label: 'Body water', shortLabel: 'water', category: 'body', unit: 'kg', grade: 'C', decimals: 1, direction: 'neutral', band: [0.5, 1.6] },
  { id: 'waist', label: 'Waist', shortLabel: 'waist', category: 'body', unit: 'cm', grade: 'B', decimals: 1, direction: 'lower', band: [1.0, 3.5] },
  { id: 'visceral_fat', label: 'Visceral fat', shortLabel: 'visceral', category: 'body', unit: 'index', grade: 'C', decimals: 0, direction: 'lower', band: [3, 9] },
  { id: 'glycogen', label: 'Glycogen (total)', shortLabel: 'glycogen', category: 'fuel', unit: 'g', grade: 'B', decimals: 0, direction: 'neutral', band: [30, 70], hourly: true, mechanism: 'Drains on fast and low-carbohydrate days and refills within one to two days of carbohydrate.' },
  { id: 'liver_glycogen', label: 'Liver glycogen', shortLabel: 'liver glyc.', category: 'fuel', unit: 'g', grade: 'B', decimals: 0, direction: 'neutral', band: [10, 18], hourly: true },
  { id: 'muscle_glycogen', label: 'Muscle glycogen', shortLabel: 'muscle glyc.', category: 'fuel', unit: 'g', grade: 'B', decimals: 0, direction: 'neutral', band: [25, 60], hourly: true },
  { id: 'ketones', label: 'Blood ketones (BHB)', shortLabel: 'ketones', category: 'fuel', unit: 'mmol/L', grade: 'B', decimals: 2, direction: 'neutral', overlay: 'none', overlayNote: 'Ketones vary ten-fold, so they stay in lanes.', thresholds: [{ value: 0.5, label: 'nutritional ketosis' }, { value: 3, label: 'deep ketosis' }], band: [0.04, 0.3], hourly: true, domain: 'zero', mechanism: 'Rise 12–36 h into a fast as liver glycogen runs low; fall within hours of carbohydrate.' },
  { id: 'keto_adaptation', label: 'Keto-adaptation', shortLabel: 'keto-adapt.', category: 'fuel', unit: 'index', grade: 'C', decimals: 0, direction: 'neutral', band: [4, 14] },
  { id: 'fat_ox_share', label: 'Fat oxidation share', shortLabel: 'fat ox.', category: 'fuel', unit: '%', grade: 'B', decimals: 0, direction: 'neutral', band: [4, 9], hourly: true },
  { id: 'glucose', label: 'Blood glucose', shortLabel: 'glucose', category: 'fuel', unit: 'mmol/L', grade: 'B', decimals: 1, direction: 'in-range', thresholds: [{ value: 7.8, label: 'post-meal upper' }], reference: { lo: 3.9, hi: 5.6, label: 'fasting range' }, band: [0.25, 0.5], hourly: true, domain: 'hug' },
  { id: 'tdee', label: 'Energy expenditure (TDEE)', shortLabel: 'TDEE', category: 'energy', unit: 'kcal/d', grade: 'A', decimals: 0, direction: 'neutral', kind: 'stacked-area', band: [45, 260], mechanism: 'Resting expenditure falls with body mass and adaptation; movement and training add on top.' },
  { id: 'energy_balance', label: 'Energy balance', shortLabel: 'balance', category: 'energy', unit: 'kcal/d', grade: 'A', decimals: 0, direction: 'neutral', overlay: 'none', overlayNote: 'Energy balance crosses zero, so a percent change has no meaning; view it in Lanes.', band: [60, 220] },
  { id: 'met_adaptation', label: 'Metabolic adaptation', shortLabel: 'adaptation', category: 'energy', unit: 'kcal/d', grade: 'B', decimals: 0, direction: 'neutral', overlay: 'none', overlayNote: 'Adaptation starts at zero; view it in Lanes.', band: [12, 150], mechanism: 'Moves toward about 14 % of the energy gap with a two-week time constant; diet breaks recover part of it.' },
  { id: 'neat', label: 'Non-exercise movement', shortLabel: 'NEAT', category: 'energy', unit: 'kcal/d', grade: 'B', decimals: 0, direction: 'neutral', band: [40, 120] },
  { id: 'autophagy', label: 'Autophagy signal', shortLabel: 'autophagy', category: 'cellular', unit: 'index', grade: 'D', decimals: 0, direction: 'neutral', band: [9, 18], hourly: true, mechanism: 'Relative index; rises after about 16 h without food and drops with protein. Exogenous ketones do not raise it.' },
  { id: 'mtor', label: 'mTOR activity', shortLabel: 'mTOR', category: 'cellular', unit: 'index', grade: 'C', decimals: 0, direction: 'neutral', band: [6, 12], hourly: true },
  { id: 'ampk', label: 'AMPK activity', shortLabel: 'AMPK', category: 'cellular', unit: 'index', grade: 'C', decimals: 0, direction: 'neutral', band: [6, 12], hourly: true },
  { id: 'mps', label: 'Muscle protein synthesis', shortLabel: 'MPS', category: 'cellular', unit: 'index', grade: 'B', decimals: 0, direction: 'higher', band: [5, 10], hourly: true },
  { id: 'igf1', label: 'IGF-1', shortLabel: 'IGF-1', category: 'cellular', unit: 'ng/mL', grade: 'B', decimals: 0, direction: 'neutral', band: [18, 40] },
  { id: 'hunger', label: 'Hunger pressure', shortLabel: 'hunger', category: 'hormones', unit: 'index', grade: 'C', decimals: 0, direction: 'lower', band: [5, 14], mechanism: 'Rises with the deficit and as leptin falls with fat mass; eases during diet breaks.' },
  { id: 'insulin', label: 'Insulin response', shortLabel: 'insulin', category: 'hormones', unit: 'index', grade: 'B', decimals: 0, direction: 'neutral', band: [5, 10], hourly: true },
  { id: 'leptin', label: 'Leptin', shortLabel: 'leptin', category: 'hormones', unit: 'ng/mL', grade: 'B', decimals: 1, direction: 'neutral', band: [1.2, 3] },
  { id: 't3', label: 'Thyroid (T3)', shortLabel: 'T3', category: 'hormones', unit: 'pg/mL', grade: 'B', decimals: 2, direction: 'neutral', band: [0.18, 0.4] },
  { id: 'cortisol', label: 'Cortisol', shortLabel: 'cortisol', category: 'hormones', unit: 'index', grade: 'C', decimals: 0, direction: 'lower', band: [6, 14] },
  { id: 'reproductive', label: 'Reproductive hormones', shortLabel: 'reproductive', category: 'hormones', unit: 'index', grade: 'C', decimals: 0, direction: 'higher', band: [6, 16] },
  { id: 'insulin_sens', label: 'Insulin sensitivity', shortLabel: 'insulin sens.', category: 'cardio', unit: 'index', grade: 'B', decimals: 0, direction: 'higher', band: [3, 9] },
  { id: 'ldl', label: 'LDL-C', shortLabel: 'LDL', category: 'cardio', unit: 'mmol/L', grade: 'A', decimals: 2, direction: 'lower', thresholds: [{ value: 3.0, label: 'target' }], band: [0.18, 0.45] },
  { id: 'apob', label: 'ApoB', shortLabel: 'ApoB', category: 'cardio', unit: 'g/L', grade: 'A', decimals: 2, direction: 'lower', thresholds: [{ value: 0.9, label: 'target' }], band: [0.05, 0.12] },
  { id: 'hdl', label: 'HDL-C', shortLabel: 'HDL', category: 'cardio', unit: 'mmol/L', grade: 'B', decimals: 2, direction: 'higher', band: [0.06, 0.14] },
  { id: 'tg', label: 'Triglycerides', shortLabel: 'TG', category: 'cardio', unit: 'mmol/L', grade: 'B', decimals: 2, direction: 'lower', thresholds: [{ value: 1.7, label: 'upper limit' }], band: [0.1, 0.3], domain: 'hug' },
  { id: 'bp_sys', label: 'Blood pressure (systolic)', shortLabel: 'BP', category: 'cardio', unit: 'mmHg', grade: 'A', decimals: 0, direction: 'lower', thresholds: [{ value: 130, label: 'stage 1' }], band: [3, 7], domain: 'hug' },
  { id: 'liver_fat', label: 'Liver fat', shortLabel: 'liver fat', category: 'cardio', unit: '%', grade: 'B', decimals: 1, direction: 'lower', thresholds: [{ value: 5.5, label: 'fatty liver' }], band: [0.6, 1.8] },
  { id: 'vo2max', label: 'VO₂max', shortLabel: 'VO₂max', category: 'performance', unit: 'mL/kg/min', grade: 'B', decimals: 1, direction: 'higher', band: [1.2, 3] },
  { id: 'strength', label: 'Strength index', shortLabel: 'strength', category: 'performance', unit: 'index', grade: 'B', decimals: 0, direction: 'higher', band: [3, 9] },
  { id: 'training_capacity', label: 'Training capacity', shortLabel: 'capacity', category: 'performance', unit: 'index', grade: 'C', decimals: 0, direction: 'higher', band: [5, 12] },
  { id: 'sleep_quality', label: 'Sleep quality', shortLabel: 'sleep', category: 'recovery', unit: 'index', grade: 'C', decimals: 0, direction: 'higher', band: [6, 12] },
  { id: 'mood_energy', label: 'Mood & energy', shortLabel: 'mood', category: 'recovery', unit: 'index', grade: 'C', decimals: 0, direction: 'higher', band: [7, 14] },
  { id: 'bone', label: 'Bone health index', shortLabel: 'bone', category: 'recovery', unit: 'index', grade: 'C', decimals: 0, direction: 'higher', band: [2, 6] },
  { id: 'micronutrient_risk', label: 'Micronutrient risk', shortLabel: 'micronutrients', category: 'recovery', unit: 'index', grade: 'D', decimals: 0, direction: 'lower', band: [4, 10] },
];

/* -------------------------------------------------------------------- model */

const BW0 = 84.9;
const M0 = 2540;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

interface RunOut {
  daily: Map<string, Float32Array>;
  hourly: Map<string, Float32Array>;
  base: Map<string, number>;
  intake: IntakeContext;
  composition: CompositionTracks;
  events: ChartEvent[];
  ketosis: StateTrack;
  tdeeParts: { bmr: Float32Array; tef: Float32Array; neat: Float32Array; exercise: Float32Array; noAdapt: Float32Array };
}

function run(programs: string[], seed: number): RunOut {
  const days = programs.length;
  const H = days * 24;
  const rnd = mulberry32(seed);
  const noise = () => rnd() * 2 - 1;
  const D = (id: string) => {
    const a = new Float32Array(days);
    daily.set(id, a);
    return a;
  };
  const Hr = (id: string) => {
    const a = new Float32Array(H);
    hourly.set(id, a);
    return a;
  };
  const daily = new Map<string, Float32Array>();
  const hourly = new Map<string, Float32Array>();

  // hourly tracks
  const hLiver = Hr('liver_glycogen');
  const hMuscle = Hr('muscle_glycogen');
  const hGly = Hr('glycogen');
  const hKet = Hr('ketones');
  const hGlu = Hr('glucose');
  const hIns = Hr('insulin');
  const hFox = Hr('fat_ox_share');
  const hMps = Hr('mps');
  const hAut = Hr('autophagy');
  const hAmpk = Hr('ampk');
  const hMtor = Hr('mtor');

  // intake
  const grams: MacroSeries = {
    protein: new Float32Array(days),
    netCarbs: new Float32Array(days),
    fibre: new Float32Array(days),
    fat: new Float32Array(days),
    alcohol: new Float32Array(days),
  };
  const maintenance = new Float32Array(days);
  const steps = new Float32Array(days);
  const exercise: ExerciseSession[] = [];
  const meals: Meal[] = [];
  const eatingWindows: DayWindow[] = [];
  const sleep: DayWindow[] = [];
  const events: ChartEvent[] = [];
  const ketoDaily = new Uint8Array(days);
  const ketoHourly = new Uint8Array(H);

  // slow state
  let F = 24.1;
  let Lt = 57.4; // lean tissue excluding glycogen + its water
  let Ad = 0;
  let KA = 0;
  let hunger = 34;
  let strength = 52;
  let vo2 = 41.5;
  let igf = 185;
  let fastDaysRecent = 0;
  let liver = 82;
  let muscle = 380;
  let ket = 0.12;
  let ins = 12;
  let mps = 22;
  let aut = 16;
  let ampk = 24;
  let mtor = 26;
  let exc = 0; // glucose excursion
  let hoursSinceMeal = 10;
  let trainBoost = 0;
  let prevInKetosis = false;
  let pendingK = -1;
  let prevLowLiver = false;
  const bals: number[] = [];

  const out = {
    fat: D('fat_mass'), lean: D('lean_mass'), weight: D('scale_weight'), sm: D('skeletal_muscle'), bf: D('body_fat_pct'),
    water: D('body_water'), waist: D('waist'), visc: D('visceral_fat'), gly: D('glycogen'), liv: D('liver_glycogen'),
    mus: D('muscle_glycogen'), ket: D('ketones'), ka: D('keto_adaptation'), fox: D('fat_ox_share'), glu: D('glucose'),
    tdee: D('tdee'), bal: D('energy_balance'), adapt: D('met_adaptation'), neat: D('neat'), aut: D('autophagy'),
    mtor: D('mtor'), ampk: D('ampk'), mps: D('mps'), igf: D('igf1'), hunger: D('hunger'), ins: D('insulin'),
    leptin: D('leptin'), t3: D('t3'), cort: D('cortisol'), repro: D('reproductive'), is: D('insulin_sens'),
    ldl: D('ldl'), apob: D('apob'), hdl: D('hdl'), tg: D('tg'), bp: D('bp_sys'), lfat: D('liver_fat'),
    vo2: D('vo2max'), str: D('strength'), cap: D('training_capacity'), sleepQ: D('sleep_quality'),
    mood: D('mood_energy'), bone: D('bone'), micro: D('micronutrient_risk'),
  };
  const comp: CompositionTracks = { fat: new Float32Array(days), lean: new Float32Array(days), glycogen: new Float32Array(days), water: new Float32Array(days) };
  const parts = { bmr: new Float32Array(days), tef: new Float32Array(days), neat: new Float32Array(days), exercise: new Float32Array(days), noAdapt: new Float32Array(days) };

  const glyWater = (g: number) => (g * 3) / 1000;
  const weightOf = (f: number, lt: number, g: number) => f + lt + g / 1000 + glyWater(g);
  const base = new Map<string, number>([
    ['fat_mass', F],
    ['lean_mass', Lt + (liver + muscle) / 1000 + glyWater(liver + muscle)],
    ['scale_weight', weightOf(F, Lt, liver + muscle)],
  ]);

  for (let d = 0; d < days; d++) {
    const p = P[programs[d]!]!;
    const prev = d > 0 ? P[programs[d - 1]!]! : null;
    const next = d + 1 < days ? P[programs[d + 1]!]! : null;
    const W = weightOf(F, Lt, liver + muscle);
    const kcal = p.pct * M0;
    const pg = p.proteinGkg * BW0;
    const cg = p.netCarbs;
    const fib = p.fibre;
    const alc = p.alcohol;
    const fg = Math.max(0, (kcal - pg * 4 - cg * 4 - fib * 2 - alc * 7) / 9);
    grams.protein[d] = pg;
    grams.netCarbs[d] = cg;
    grams.fibre[d] = fib;
    grams.fat[d] = fg;
    grams.alcohol[d] = alc;
    steps[d] = p.steps + Math.round(noise() * 600);

    // energy expenditure
    const bmr = 370 + 21.6 * Lt + 3.5 * (F - 24.1) + Ad * 0.4;
    const tef = 0.1 * kcal + 0.1 * pg;
    const neatK = 180 + (steps[d]! - 8000) * 0.04 + Ad * 0.6 + 2 * noise();
    const ex = (p.lift ? 260 : 0) + (p.cardio ? 420 : 0) + (p.walk ? 190 : 0);
    const Mt = bmr + tef + neatK + ex + 360;
    maintenance[d] = Mt;
    parts.bmr[d] = bmr + 360;
    parts.tef[d] = tef;
    parts.neat[d] = neatK;
    parts.exercise[d] = ex;
    parts.noAdapt[d] = Mt - Ad;
    const bal = kcal - Mt;
    bals.push(bal);
    const E7 = bals.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, bals.length);

    // sessions, meals, windows, sleep
    if (p.lift) exercise.push({ day: d, startHour: p.lift[0], durationMin: p.lift[1] * 60, type: 'resistance', label: 'lifting' });
    if (p.cardio) exercise.push({ day: d, startHour: p.cardio[0], durationMin: p.cardio[1] * 60, type: 'cardio', label: 'run' });
    if (p.walk) exercise.push({ day: d, startHour: p.walk[0], durationMin: p.walk[1] * 60, type: 'walk', label: 'long walk' });
    for (const [hr, share] of p.meals)
      meals.push({ day: d, startHour: hr, durationMin: 35, grams: { protein: pg * share, netCarbs: cg * share, fibre: fib * share, fat: fg * share, alcohol: hr >= 19 ? alc : 0 } });
    if (p.meals.length) eatingWindows.push({ day: d, startHour: p.meals[0]![0], endHour: p.meals[p.meals.length - 1]![0] + 0.75 });
    const late = programs[d] === 'W';
    sleep.push({ day: d, startHour: late ? 23.75 : 23, endHour: late ? 31.5 : 31 });

    // events around fasts
    if (p.fast && !prev?.fast) {
      const lastMeal = d > 0 ? P[programs[d - 1]!]!.meals.at(-1)?.[0] : undefined;
      events.push({ day: lastMeal != null ? d - 1 : d, hour: lastMeal != null ? lastMeal + 0.75 : 0, type: 'fast-start', label: 'fast starts' });
      if (prev?.lift) events.push({ day: d, type: 'safety', severity: 'caution', label: '36 h fast right after a lifting day' });
    }
    if (p.fast && next && !next.fast) events.push({ day: d + 1, hour: next.meals[0]?.[0] ?? 8, type: 'fast-end', label: 'fast ends · refeed' });
    if (programs[d] === 'E' && prev && prev.pct < 0.95 && d > 0) events.push({ day: d, type: 'diet-break', label: 'diet break starts' });

    // hourly loop
    const carbs3 = [0, 1, 2].reduce((acc, k) => acc + (d - k >= 0 ? P[programs[d - k]!]!.netCarbs : p.netCarbs), 0) / 3;
    let dayKetMax = 0;
    for (let h = 0; h < 24; h++) {
      const hi = d * 24 + h;
      let carbApp = 0;
      let protApp = 0;
      for (let back = 0; back < 3; back++) {
        const dd = h - back >= 0 ? d : d - 1;
        if (dd < 0) continue;
        const pp = P[programs[dd]!]!;
        const hh = (h - back + 24) % 24;
        for (const [mh, share] of pp.meals) {
          if (Math.floor(mh) !== hh) continue;
          const w = back === 0 ? 0.45 : back === 1 ? 0.35 : 0.2;
          carbApp += pp.netCarbs * share * w;
          protApp += pp.proteinGkg * BW0 * share * w;
        }
      }
      const mealNow = p.meals.some(([mh]) => Math.floor(mh) === h);
      hoursSinceMeal = mealNow ? 0 : hoursSinceMeal + 1;
      const lifting = p.lift && h >= Math.floor(p.lift[0]) && h < p.lift[0] + p.lift[1] ? 1 : 0;
      const running = p.cardio && h >= Math.floor(p.cardio[0]) && h < p.cardio[0] + p.cardio[1] ? 1 : 0;
      const walking = p.walk && h >= Math.floor(p.walk[0]) && h < p.walk[0] + p.walk[1] ? 1 : 0;
      if (lifting) trainBoost = 1;
      trainBoost *= 0.972;

      exc += carbApp * 0.05 - exc * 0.75;
      const fastDepth = clamp(hoursSinceMeal / 40, 0, 1);
      const glu = 4.95 - 0.7 * fastDepth + exc * (1.1 - 0.004 * (out.is[Math.max(0, d - 1)] || 50)) + 0.05 * noise();
      const insT = 6 + carbApp * 0.95 + protApp * 0.45;
      ins += (clamp(insT, 3, 95) - ins) * 0.6;
      liver = clamp(liver + carbApp * 0.36 - (ins < 15 ? 2.6 : 0.8) - running * 6, 4, 112);
      muscle = clamp(muscle + (150 + 1.25 * carbs3 - muscle) * 0.022 - lifting * 30 - running * 55 - walking * 12, 60, 480);
      const ketT = (0.07 + 1.7 * sigmoid((26 - liver) / 6) * clamp(1 - ins / 40, 0, 1) * (0.7 + 0.4 * KA) + 0.04 * Math.max(0, hoursSinceMeal - 16)) * (1 + 0.04 * noise());
      ket += (ketT - ket) * (ketT > ket ? 0.13 : 0.4);
      ket = clamp(ket, 0.03, 5.5);
      const foxT = clamp(34 + 58 * (1 - ins / 55) + 4 * ket, 18, 92);
      const mpsT = (14 + protApp * 1.3 * (1 + 0.9 * trainBoost) + lifting * 12) * (p.fast ? 0.7 : 1);
      mps += (clamp(mpsT, 8, 98) - mps) * 0.45;
      const autT = 12 + 64 * sigmoid((hoursSinceMeal - 19) / 5) - 0.18 * ins - 0.25 * protApp;
      aut += (clamp(autT, 4, 96) - aut) * 0.16;
      const ampkT = 20 + 52 * sigmoid((hoursSinceMeal - 15) / 5) + 18 * (running + walking + lifting * 0.5) - 0.1 * ins;
      ampk += (clamp(ampkT, 5, 95) - ampk) * 0.3;
      const mtorT = 14 + 0.45 * ins + 0.9 * protApp + 16 * lifting + 10 * trainBoost;
      mtor += (clamp(mtorT, 5, 95) - mtor) * 0.4;

      hLiver[hi] = liver;
      hMuscle[hi] = muscle;
      hGly[hi] = liver + muscle;
      hKet[hi] = ket;
      hGlu[hi] = glu;
      hIns[hi] = ins;
      hFox[hi] = foxT + noise();
      hMps[hi] = mps;
      hAut[hi] = aut;
      hAmpk[hi] = ampk;
      hMtor[hi] = mtor;
      const state = ket >= 3 ? 3 : ket >= 0.5 ? 2 : ket >= 0.3 ? 1 : 0;
      ketoHourly[hi] = state;
      dayKetMax = Math.max(dayKetMax, state);
      // state changes count once they hold for 6 h (no flapping around meals)
      const inK: boolean = prevInKetosis ? ket >= 0.4 : ket >= 0.5;
      if (inK !== prevInKetosis) {
        if (pendingK < 0) pendingK = hi;
        if (hi - pendingK >= 5) {
          const at = pendingK;
          events.push({ day: Math.floor(at / 24), hour: at % 24, type: inK ? 'ketosis-entered' : 'ketosis-exited', label: inK ? 'ketosis entered' : 'ketosis exited' });
          prevInKetosis = inK;
          pendingK = -1;
        }
      } else pendingK = -1;
      const low: boolean = prevLowLiver ? liver < 45 : liver < 18;
      if (low && !prevLowLiver) events.push({ day: d, hour: h, type: 'glycogen-low', label: 'liver glycogen below 30 %' });
      prevLowLiver = low;
    }
    ketoDaily[d] = dayKetMax;

    // slow daily update
    const protOK = pg / W >= 1.6;
    const share = p.fast ? 0.82 : bal < 0 ? (protOK ? 0.93 : 0.78) : 0.55;
    let gain = (p.lift && protOK ? 0.018 : 0) * (bal < -900 ? 0.4 : 1);
    if (p.fast && prev?.lift) gain -= 0.025;
    F += (bal * share) / 7700;
    Lt += (bal * (1 - share)) / 1800 + gain;
    const At = clamp(0.14 * E7, -300, 0);
    Ad += (At - Ad) * (At < Ad ? 1 / 14 : 1 / 14);
    KA = clamp(KA + (ket > 0.5 ? 0.045 : -0.012), 0, 1);
    fastDaysRecent = fastDaysRecent * 0.86 + (p.fast ? 1 : 0);
    const Ht = 30 + 0.045 * Math.max(0, -E7) + (p.fast ? 24 : 0) + 1.4 * (24.1 - F) - (bal > 0 ? 6 : 0);
    hunger += (Ht - hunger) * 0.42;
    strength += (p.lift ? 0.22 : 0) * (protOK ? 1 : 0.4) - (p.fast ? 0.15 : 0) - 0.01;
    vo2 += (p.cardio ? 0.06 : 0) + (p.walk ? 0.02 : 0) - 0.004;
    igf += (185 - 34 * fastDaysRecent + 0.08 * (pg - 150) - igf) * 0.3;

    const glyc = liver + muscle;
    const Wn = weightOf(F, Lt, glyc);
    const n1 = noise();
    out.fat[d] = F;
    out.lean[d] = Lt + glyc / 1000 + glyWater(glyc);
    out.weight[d] = Wn + 0.12 * n1;
    out.sm[d] = 0.5 * Lt + 3.2 + (strength - 52) * 0.02;
    out.bf[d] = (F / Wn) * 100;
    out.water[d] = 0.72 * Lt + glyWater(glyc) + 0.15 * n1;
    out.waist[d] = 64 + 1.1 * F;
    out.visc[d] = clamp(38 + 2.1 * (F - 24.1), 0, 100);
    const dayMean = (a: Float32Array) => {
      let s = 0;
      for (let k = 0; k < 24; k++) s += a[d * 24 + k]!;
      return s / 24;
    };
    out.gly[d] = dayMean(hGly);
    out.liv[d] = dayMean(hLiver);
    out.mus[d] = dayMean(hMuscle);
    out.ket[d] = dayMean(hKet);
    out.ka[d] = KA * 100;
    out.fox[d] = dayMean(hFox);
    out.glu[d] = dayMean(hGlu);
    out.tdee[d] = Mt;
    out.bal[d] = bal;
    out.adapt[d] = Ad;
    out.neat[d] = neatK;
    out.aut[d] = dayMean(hAut);
    out.mtor[d] = dayMean(hMtor);
    out.ampk[d] = dayMean(hAmpk);
    out.mps[d] = dayMean(hMps);
    out.igf[d] = igf;
    out.hunger[d] = clamp(hunger + 2 * noise(), 0, 100);
    out.ins[d] = dayMean(hIns);
    out.leptin[d] = 0.46 * F * (1 + 0.00022 * E7);
    out.t3[d] = 3.2 * (1 + 0.00009 * E7) - 0.25 * fastDaysRecent * 0.2;
    out.cort[d] = clamp(38 + 0.012 * Math.max(0, -E7) + 9 * (p.fast ? 1 : 0) + 2 * noise(), 0, 100);
    out.repro[d] = clamp(72 - 0.02 * Math.max(0, -E7) - 4 * fastDaysRecent, 0, 100);
    out.is[d] = clamp(50 + 1.7 * (24.1 - F) + 6 * KA + (p.lift ? 1 : 0), 0, 100);
    out.ldl[d] = 3.25 - 0.03 * (24.1 - F) + 0.22 * KA + 0.03 * n1;
    out.apob[d] = out.ldl[d]! * 0.29 + 0.02;
    out.hdl[d] = 1.18 + 0.012 * (24.1 - F) + 0.04 * KA;
    out.tg[d] = 1.55 - 0.05 * (24.1 - F) - 0.25 * KA + 0.04 * n1;
    out.bp[d] = 131 - 0.8 * (base.get('scale_weight')! - Wn) + 1.2 * n1;
    out.lfat[d] = Math.max(1.5, 7.2 - 0.42 * (24.1 - F));
    out.vo2[d] = vo2;
    out.str[d] = clamp(strength, 0, 100);
    out.cap[d] = clamp(58 + 0.06 * (muscle - 380) - 6 * (p.fast ? 1 : 0) - 0.01 * Math.max(0, -E7) + 2 * noise(), 0, 100);
    out.sleepQ[d] = clamp(71 - 0.12 * (hunger - 34) - (late ? 5 : 0) + 2 * noise(), 0, 100);
    out.mood[d] = clamp(66 - 0.015 * Math.max(0, -E7) - 0.18 * (hunger - 34) + 2 * noise(), 0, 100);
    out.bone[d] = clamp(70 - 0.02 * d * (p.pct < 0.8 ? 1 : 0.2) + (p.lift ? 0.02 : 0), 0, 100);
    out.micro[d] = clamp(18 + 22 * fastDaysRecent * 0.3 + (p.pct < 0.8 ? 3 : 0) + noise(), 0, 100);
    comp.fat[d] = F;
    comp.lean[d] = Lt;
    comp.glycogen[d] = glyc / 1000;
    comp.water[d] = glyWater(glyc) + 0.15 * n1;
  }
  base.set('met_adaptation', 0);
  base.set('energy_balance', out.bal[0]!);

  const ketosis: StateTrack = { id: 'ketosis', label: 'Ketosis', levels: ['none', 'forming', 'nutritional', 'deep'], daily: ketoDaily, hourly: ketoHourly };
  events.sort((a, b) => a.day + (a.hour ?? 12) / 24 - (b.day + (b.hour ?? 12) / 24));
  return {
    daily,
    hourly,
    base,
    intake: { grams, maintenance, steps, exercise, meals, eatingWindows, sleep },
    composition: comp,
    events,
    ketosis,
    tdeeParts: parts,
  };
}

/* ------------------------------------------------------------ series build */

function bandFor(values: Float32Array, halfStart: number, halfGrowth: number, perDay: number, skew = 1): { lo: Float32Array; hi: Float32Array } {
  const n = values.length;
  const lo = new Float32Array(n);
  const hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / perDay / 183;
    const w = halfStart + halfGrowth * Math.min(1, t);
    lo[i] = values[i]! - w;
    hi[i] = values[i]! + w * skew;
  }
  return { lo, hi };
}

function makeSeries(meta: MetricMeta, r: RunOut): ChartSeries {
  const daily = r.daily.get(meta.id)!;
  const isIndex = meta.unit === 'index';
  const clampBand = (b: { lo: Float32Array; hi: Float32Array }) => {
    if (isIndex || meta.unit === '%') for (let i = 0; i < b.lo.length; i++) {
      b.lo[i] = clamp(b.lo[i]!, 0, 100);
      b.hi[i] = clamp(b.hi[i]!, 0, 100);
    }
    if (meta.id === 'ketones') for (let i = 0; i < b.lo.length; i++) {
      const v = (b.lo[i]! + b.hi[i]!) / 2;
      b.lo[i] = v * 0.68;
      b.hi[i] = v * 1.45;
    }
    if (meta.id === 'met_adaptation') for (let i = 0; i < b.lo.length; i++) b.hi[i] = Math.min(0, b.hi[i]!);
    return b;
  };
  const s: ChartSeries = {
    id: meta.id,
    label: meta.label,
    shortLabel: meta.shortLabel,
    unit: meta.unit,
    category: meta.category,
    direction: meta.direction,
    grade: meta.grade,
    format: { decimals: meta.decimals },
    kind: meta.kind,
    overlay: meta.overlay,
    overlayNote: meta.overlayNote,
    thresholds: meta.thresholds,
    reference: meta.reference,
    domain: meta.domain,
    mechanism: meta.mechanism,
    baseline: r.base.get(meta.id),
    daily: { values: daily, band: clampBand(bandFor(daily, meta.band[0], meta.band[1], 1, meta.id === 'met_adaptation' ? 0.8 : 1)) },
  };
  const hv = r.hourly.get(meta.id);
  if (meta.hourly && hv) s.hourly = { values: hv, band: clampBand(bandFor(hv, meta.band[0], meta.band[1], 24)) };
  if (meta.kind === 'stacked-area') {
    s.stack = {
      components: [
        { id: 'bmr', label: 'resting (BMR)', daily: r.tdeeParts.bmr },
        { id: 'tef', label: 'digestion (TEF)', daily: r.tdeeParts.tef },
        { id: 'neat', label: 'movement (NEAT)', daily: r.tdeeParts.neat },
        { id: 'exercise', label: 'exercise', daily: r.tdeeParts.exercise },
      ],
      counterfactual: { label: 'without adaptation', daily: r.tdeeParts.noAdapt },
    };
  }
  return s;
}

/* ------------------------------------------------------------------ public */

export interface FixtureOptions {
  /** Horizon in days (default 84). */
  days?: number;
  seed?: number;
  /** ISO date of day 0 (default Mon 5 Oct 2026); pass null for "day N" labels. */
  startDate?: string | null;
  /** Keep only the first N metrics of the catalogue order (default all). */
  metrics?: number;
}

export function makeChartData(opts: FixtureOptions = {}): ChartData {
  const days = opts.days ?? 84;
  const { programs, phases } = buildSchedule('cut', days);
  const r = run(programs, opts.seed ?? 7);
  const metas = opts.metrics != null ? FIXTURE_METRICS.slice(0, opts.metrics) : FIXTURE_METRICS;
  return {
    time: { days, startDate: opts.startDate === null ? undefined : (opts.startDate ?? '2026-10-05') },
    series: metas.map((m) => makeSeries(m, r)),
    phases,
    events: r.events,
    intake: r.intake,
    states: [r.ketosis],
    composition: r.composition,
  };
}

const PLAN_STYLE: Record<PlanId, { style: Style; name: string }> = {
  A: { style: 'steady', name: 'Steady deficit, carb-periodised' },
  B: { style: 'fasts', name: 'Weekly 36 h fasts, high protein' },
  C: { style: 'recomp', name: 'Recomposition at maintenance' },
};

export function makeComparison(opts: { days?: number; seed?: number; startDate?: string } = {}): ComparisonData {
  const days = opts.days ?? 119;
  const plans: PlanSeriesSet[] = (['A', 'B', 'C'] as const).map((id, k) => {
    const { programs, phases } = buildSchedule(PLAN_STYLE[id].style, days);
    const r = run(programs, (opts.seed ?? 11) + k);
    return { id, name: PLAN_STYLE[id].name, phases, series: FIXTURE_METRICS.map((m) => makeSeries(m, r)) };
  });
  const fat0 = plans[0]!.series.find((s) => s.id === 'fat_mass')!.baseline!;
  const lean0 = plans[0]!.series.find((s) => s.id === 'lean_mass')!.baseline!;
  return {
    time: { days, startDate: opts.startDate ?? '2026-10-05' },
    plans,
    goals: [
      { rank: 1, metricId: 'fat_mass', text: 'lose 10 kg', target: { value: fat0 - 10, label: 'target −10 kg' } },
      { rank: 2, metricId: 'lean_mass', text: 'keep', target: { value: lean0, label: 'keep lean mass' } },
      { rank: 3, metricId: 'autophagy', text: 'raise' },
    ],
    contextMetricIds: ['hunger', 'scale_weight'],
  };
}

export function makeConvergence(opts: { iterations?: number; seed?: number } = {}): ConvergenceTrace[] {
  const n = opts.iterations ?? 120;
  const rnd = mulberry32(opts.seed ?? 3);
  const finals: Record<PlanId, number> = { A: 0.82, B: 0.78, C: 0.64 };
  return (['A', 'B', 'C'] as const).map((plan) => {
    const scores = new Float32Array(n);
    let best = 0.2 + rnd() * 0.1;
    for (let i = 0; i < n; i++) {
      const target = finals[plan] * (1 - Math.exp(-i / (18 + rnd() * 6)));
      if (rnd() < 0.35) best = Math.max(best, Math.min(finals[plan], target + rnd() * 0.02));
      scores[i] = best;
    }
    return { plan, scores };
  });
}
