/**
 * Your body — all copy in one place (design/screens/your-body.md §6, DESIGN_DIRECTION §7 voice: second person,
 * present tense, specific, never moralising; numbers with units and ranges; no body labels, no exclamation marks).
 * Ember copy rules (SPEC §6): labels only; a line under a heading only when it states a fact; keys are verb + object
 * in sentence case. Field and scale labels are authored lowercase.
 */
import { paths } from '@/app/paths';
import type { InfoSpec } from '@/components';
import { FAT_ANCHOR_DESCRIPTORS, type Sex } from '@/engine/body';

export const TITLE = 'Your body';

/** Saving is silent; only a failed save says so, once, as a toast. */
export const SAVE = {
  unavailable: 'Couldn’t save: this browser isn’t storing data',
} as const;

export const SETUP = {
  steps: [
    { id: 'basics', label: 'Basics' },
    { id: 'shape', label: 'Shape' },
    { id: 'habits', label: 'A normal day' },
  ],
  progressLabel: 'Setup progress',
  next: { basics: 'Next: shape', shape: 'Next: a normal day', habits: 'Done' },
  back: 'Back',
  skip: 'Skip for now',
  missing: (fields: string[]) => `Enter your ${listAnd(fields)} to continue.`,
  startTitle: 'Choose a start',
  simulate: 'Simulate a plan',
  plan: 'Find plans',
  planLine: 'Set a goal; Vitals finds plans that reach it.',
  simulateLine: 'Try food, fasting and training and see what they do.',
  /** The two ways on, as the mono line under each title (the sentences above are what their (i) says). */
  planMeta: 'Goal to plans',
  simulateMeta: 'Try it',
} as const;

/** The way on from Your body into the two planning tools (header primary and the ⋯), when the navigation lacks them. */
export const CONTINUE = {
  simulate: 'Simulate a plan',
  plan: 'Find plans',
} as const;

export function listAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ---------------------------------------------------------------------------------------------- basics */

export const BASICS = {
  title: 'Basics',
  units: 'Units',
  /** Phones, normal mode: the card is five rows and "Edit" opens the same form in a panel. */
  edit: 'Edit',
  editorTitle: 'Basics',
  unitsRow: 'Units',
  /** A row whose value is waiting for the person (the typical value is shown instead). */
  typicalRow: 'Typical',
  notSet: 'Not set',
  /** Quiet mode: the weight row says it is set, never what it is. */
  setRow: 'Set',
  unitWords: { metric: 'Metric', imperial: 'Imperial' },
  sexWords: { female: 'Female', male: 'Male', unspecified: 'Prefer not to say' },
  sexLabel: 'Sex',
  sexOptions: [
    { value: 'female', label: 'Female' },
    { value: 'male', label: 'Male' },
    { value: 'unspecified', label: 'Prefer not to say' },
  ],
  sexUnspecifiedHelp: 'Ranges are a little wider.',
  sexUnsetHelp: 'Sets the equations, not how we address you.',
  age: 'Age',
  height: 'Height',
  weight: 'Weight',
  typical: 'Typical adult value',
  bmiCaution: 'Check this weight: it’s outside the range the equations were built on.',
  more: 'More details',
  ethnicity: 'Ancestry · optional',
  ethnicityHelp: 'Adjusts the body-fat and visceral-fat estimates.',
  ethnicityOptions: [
    { value: 'unset', label: 'Not set' },
    { value: 'white', label: 'European' },
    { value: 'black', label: 'African or Caribbean' },
    { value: 'eastAsian', label: 'East Asian' },
    { value: 'southeastAsian', label: 'Southeast Asian' },
    { value: 'southAsian', label: 'South Asian' },
    { value: 'hispanic', label: 'Hispanic or Latin American' },
    { value: 'other', label: 'Other or mixed' },
  ],
} as const;

/* ---------------------------------------------------------------------------------------------- figure */

export const FIGURE = {
  title: 'Figure',
  viewLabel: 'What the stage shows',
  views: [
    { value: 'figure', label: 'Figure' },
    { value: 'visceral', label: 'Visceral' },
  ],
  loadDetailed: 'Load detailed figure · up to 300 kB',
  slowSwitch: 'Switched to the simple figure to keep sliders smooth.',
  visceralCaption: 'Drawn to scale from your estimate, not a scan. Organs simplified.',
  visceralHow: 'Grade C: a model checked against scans.',
  visceralHowLink: 'How this is drawn',
  visceralWaistSets: 'Your waist sets the outer contour.',
  hiddenTitle: 'Figure hidden.',
  hiddenBody: 'Your estimates still use the shape sliders.',
  gentleHidden: 'The figure is hidden in gentle mode. Your estimates still use the shape sliders.',
  gentleShow: 'Show figure',
  gentleHide: 'Hide figure',
  settingsLink: 'Appearance settings',
  diverges: (fig: string, est: string) => `The figure shows ${fig} % body fat as you set it. Projections start from the estimate, ${est} %.`,
  /** Quiet mode: the same note without the numbers. */
  divergesQuiet: 'The figure shows what you set. Projections start from the estimate.',
  miniLabel: 'Back to the figure',
  /** The foot of the card: where the picture comes from. */
  foot: 'Drawn from your estimate',
} as const;

/* ---------------------------------------------------------------------------------------------- drawing */

/**
 * Shape › Adjust the drawing (body-figure-v2.md §5.4): drawing-only controls. Never a sex or gender word here, nor
 * "neutral", "type A/B" or "body type" (a copy test enforces it).
 */
export const DRAWING = {
  title: 'Adjust the drawing',
  /** One line for the whole panel: nothing in it moves an estimate. */
  lead: 'Changes the drawing only, not the estimates.',
  frame: 'Frame',
  hipsLed: 'Hips-led',
  shouldersLed: 'Shoulders-led',
  basicsTick: 'basics',
  matchBasics: 'Match my basics',
  matchesAlready: 'Already matches your basics',
  layers: 'Show lean tissue inside',
} as const;

/* ---------------------------------------------------------------------------------------------- estimates */

/** Estimates: four readouts, each its value and likely range (80 %); maintenance lives in its own card. */
export const EST = {
  title: 'Estimates',
  bodyFat: 'Body fat',
  fatMass: 'Fat mass',
  leanMass: 'Lean mass',
  ffmi: 'Lean mass index',
  needsWeight: 'needs weight',
  showNumbers: 'Show numbers',
  hideNumbers: 'Hide numbers',
  regionLabel: 'Body estimates',
  spoken: (bf: string, lean: string) => `Body fat ${bf}. Lean mass ${lean}.`,
  /** The foot (r071): the state word on the left, what the bars show on the right. */
  state: { estimate: 'Estimate', calibrating: 'Calibrating', needsWeight: 'Needs weight' },
  range: '80 % range',
  /** The hero's own label: what the big number is, in mono caps under it. */
  heroLabel: 'Body fat',
  /** The stacked bar: what it splits. */
  splitLabel: 'Fat and lean mass',
  fat: 'Fat',
  lean: 'Lean',
  /** Quiet mode (and gentle): words and pictures; the live region says that they moved, never to what. */
  quietLabel: 'Lean mass index',
  quietSpoken: 'Estimates updated.',
  /** The (i) panel's data table: every estimate with its value and range. */
  table: { title: 'Estimates table', head: ['Estimate', 'Value', 'Likely range (80 %)'], file: 'vitals-body-estimates.csv' },
} as const;

/** The maintenance card's foot: where the number comes from (the card's other words are the intake's own copy). */
export const MAINTENANCE = {
  from: 'From your answers',
  /**
   * Quiet mode: the one answer that would narrow the range, said without the kcal it would narrow it by (the intake's own
   * sentences print that number; the key under them keeps its name).
   */
  unknownQuiet: {
    steps: 'A counted week of steps would narrow the range',
    work: 'Picking your job would narrow the range',
    rmr: 'A measured resting rate would narrow the range',
    home: 'Your time on your feet at home would narrow the range',
    commute: 'Your commute would narrow the range',
    recreation: 'Minutes of sport a week would narrow the range',
    training: 'Your training would narrow the range',
  },
} as const;

/* ---------------------------------------------------------------------------------------------- shape */

export const SHAPE = {
  title: 'Shape',
  reset: 'Reset to estimate',
  /** The body-fat scale's spoken value in quiet mode: what the person set, never the estimate beside it. */
  quietValueText: (pct: string) => `body fat on the figure ${pct} percent`,
  bodyFat: 'Body fat',
  nearest: (pct: string, words: string) => `reference at ${pct} %: ${words}`,
  whereTitle: 'Where it sits',
  belly: 'Belly & waist',
  hips: 'Hips & thighs',
  chest: 'Chest',
  arms: 'Arms',
  shareUnit: '% of fat',
  distLabels: [
    { value: -1, label: 'Less' },
    { value: 0, label: 'Typical' },
    { value: 1, label: 'More' },
  ],
  bellyLocked: 'Set by your waist measurement',
  unlock: 'Unlock',
  muscleTitle: 'Muscle',
  upper: 'Upper body',
  lower: 'Lower body',
  expectedRef: 'expected',
  /** Everything but the body-fat scale waits behind this disclosure. */
  fineTune: 'Fine-tune shape',
  measuredTitle: 'Measurements',
  /** Row labels; each switch's accessible name is the row with "Use measured" in front. */
  waistRow: 'Waist',
  waistSwitch: 'Use measured waist',
  /** The waist scale under its row: where to measure (spoken with the row word in front). */
  waist: 'at the top of the hip bones',
  waistHow: 'After a normal breath out.',
  waistPin: (pct: string) => `Your waist suggests about ${pct} % body fat; the estimate moved.`,
  neck: 'Neck · optional',
  neckHelp: 'Below the larynx.',
  hip: 'Hips at the widest · optional',
  knownRow: 'Body fat',
  knownSwitch: 'Use measured body fat',
  knownValue: 'Measured body fat',
  knownMethod: 'Measured by',
  methods: [
    { value: 'dxa', label: 'DEXA' },
    { value: 'bia', label: 'Smart scale' },
    { value: 'skinfold', label: 'Calipers' },
    { value: 'navy', label: 'Tape' },
  ],
  mismatch: (kg: string) =>
    `Body fat and muscle as set here would fit a body of about ${kg}. The estimate weighs both against your real weight, so its range is wider.`,
  mismatchQuiet: 'Body fat and muscle as set here would fit a different weight from yours. The estimate weighs both against your real weight, so its range is wider.',
  waistPinQuiet: 'Your waist suggests a body-fat value of its own; the estimate moved.',
  consistency: 'This much muscle is more than your training history usually builds. That’s possible; the estimate keeps a wider range.',
  dragBelly: (share: number) => `belly & waist · ${share} % of fat`,
  dragHips: (share: number) => `hips & thighs · ${share} % of fat`,
  dragChest: (share: number) => `chest · ${share} % of fat · drawing only`,
  dragArms: (share: number) => `arms · ${share} % of fat · drawing only`,
  dragMuscle: (which: 'upper' | 'lower', words: string) => `${which} muscle · ${words}`,
  dragBody: (pct: string) => `body fat · ${pct} %`,
} as const;

/**
 * Visual descriptors at the engine's fat anchors (dossier 14 T2, grade D conventions), lowercased. The female top
 * stop's engine text names a size ("Very large"); the screen describes what is visible instead (DESIGN_DIRECTION
 * §5: no body labels).
 */
export function fatDescriptor(sex: Sex, stop: number): string {
  const raw = FAT_ANCHOR_DESCRIPTORS[sex][stop] ?? '';
  const text = sex === 'female' && stop === 7 ? 'Belly and hips overhang, fold at the waist' : raw;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/* ---------------------------------------------------------------------------------------------- habits */

export const HABITS = {
  title: 'Habits',
  edit: 'Edit',
  editorTitle: 'Habits',
  trainingTitle: 'Training',
  history: 'Resistance training history',
  historyOptions: [
    { value: 'none', label: 'None' },
    { value: 'lt1y', label: '< 1 yr' },
    { value: '1to3y', label: '1–3 yrs' },
    { value: 'gt3y', label: '3+ yrs' },
  ],
  years: 'Years of regular training',
  yearsHelp: 'Breaks of a few months don’t reset it.',
  quality: 'How structured',
  qualityOptions: [
    { value: 'casual', label: 'Casual' },
    { value: 'regular', label: 'Regular' },
    { value: 'serious', label: 'Structured' },
  ],
  qualityHelp: 'Structured: a program with progressive loads.',
  stressTitle: 'Stress',
  stress: 'Stress',
  stressWords: [
    { value: 'low', label: 'Low' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'high', label: 'High' },
  ],
  eatingTitle: 'Usual eating',
  carbs: 'Carbohydrate',
  carbsRef: 'typical 45 %',
  typicalTick: 'typical',
  carbsUnit: '% of energy',
  protein: 'Protein',
  proteinUnit: 'g/kg',
  meals: 'Meals a day',
  mealsOptions: [
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    { value: '4', label: '4' },
    { value: '5', label: '5+' },
  ],
  window: 'Eating window',
  windowThumbs: ['first bite', 'last bite'] as const,
  animal: 'Animal foods',
  animalOptions: [
    { value: 'omnivore', label: 'Meat & fish' },
    { value: 'pescatarian', label: 'Fish' },
    { value: 'vegetarian', label: 'Eggs & dairy' },
    { value: 'vegan', label: 'None' },
  ],
  animalHelp: 'Plant proteins count a little less per gram.',
  advanced: 'Advanced',
  advancedEvidence: 'The research behind the defaults',
  fibre: 'Fibre',
  fibreUnit: 'g per 1 000 kcal',
  /** Settings › energy in kJ: the same density per 1 000 kJ (stored per 1 000 kcal). */
  fibreUnitKJ: 'g per 1 000 kJ',
  sodium: 'Salt (sodium)',
  sodiumUnit: 'g sodium/day',
  caffeine: 'Caffeine',
  caffeineUnit: 'mg/day',
  caffeineHint: 'A mug of filter coffee ≈ 100 mg',
  alcohol: 'Alcohol',
  alcoholUnit: 'drinks/wk',
  alcoholHint: 'One drink = 14 g alcohol',
  upf: 'Ready-made and packaged food',
  upfUnit: '% of energy',
  variety: 'Food variety',
  varietyOptions: [
    { value: '1', label: 'Narrow' },
    { value: '2', label: 'Average' },
    { value: '3', label: 'Wide' },
  ],
  multivitamin: 'Daily multivitamin',
  smoker: 'Smoke tobacco',
  smokerHelp: 'Smoking clears caffeine about twice as fast.',
  drinks: 'Energy from drinks · optional',
  drinksHelp: 'Juice, milk, soft drinks, alcohol, sweetened coffee.',
  resetDefault: 'Use default',
  cycleTitle: 'Cycle',
  menopause: 'Menopause',
  menopauseOptions: [
    { value: 'pre', label: 'Before' },
    { value: 'peri', label: 'Around' },
    { value: 'post', label: 'After' },
  ],
  cycleTrack: 'Track menstrual cycle',
  cycleLength: 'Cycle length',
  cycleUnit: 'days',
  lastPeriod: 'Last period started',
  contraception: 'Contraception',
  contraceptionOptions: [
    { value: 'none', label: 'None' },
    { value: 'combinedOral', label: 'Combined pill' },
    { value: 'progestinOnly', label: 'Progestin-only' },
    { value: 'iud', label: 'IUD' },
    { value: 'other', label: 'Other' },
  ],
  /** The card's rows: only what its editor sets (steps, sessions and sleep are set in "a normal day", the intake). */
  /** The foot link: the whole card opens the same editor. */
  footEdit: 'Edit',
  summary: {
    history: 'Training history',
    stress: 'Stress',
    carbs: 'Carbohydrate',
    meals: 'Meals a day',
    window: 'Eating window',
    cycle: 'Cycle',
  },
  notSet: 'Not set',
} as const;

/* ---------------------------------------------------------------------------------------------- labs */

export const LABS = {
  title: 'Lab values',
  /** Empty: one mono line and one pill. */
  empty: 'No lab values',
  addPill: 'Add lab values',
  /** The foot link to the one other place blood tests live (Progress › Blood markers). */
  markers: 'Blood markers in Progress',
  /** Quiet mode: the values wait behind this key; the rows keep their names. */
  showValues: 'Show numbers',
  hideValues: 'Hide numbers',
  hiddenValue: 'Hidden',
  add: 'Add',
  addLabel: 'Add lab values',
  edit: 'Edit',
  editLabel: 'Edit lab values',
  editorTitle: 'Lab values',
  editorLead: 'Values from the last 3 months only.',
  clear: (name: string) => `Clear ${name}`,
  clearAll: 'Clear all',
  groups: {
    metabolism: 'Metabolism and fitness',
    lipids: 'Blood lipids',
    glucose: 'Glucose',
    pressure: 'Blood pressure',
    other: 'Other',
  },
} as const;

/* ---------------------------------------------------------------------------------------------- the (i) panels */

/**
 * What each card's (i) says (r071): the explanation that used to sit under a heading or inside a chip, in plain second
 * person, with where it comes from and what its range is. 25 to 60 words a card. The head holds no other key.
 */
export const INFO = {
  figure: {
    title: 'About the figure',
    body: 'A drawing built from your estimate, not a scan. It follows your height, weight and sex, then the Shape sliders. Adjust the drawing changes only how it looks, never your estimates. The visceral view is drawn to scale with organs simplified; it is Grade C, a model checked against scans.',
    source: { kind: 'estimate', words: 'Drawn from your height, weight, sex and the Shape sliders.' },
    range: 'No range of its own: the Estimates card holds the likely range.',
    evidence: { to: paths.evidenceTopic('body-composition-estimation'), label: FIGURE.visceralHowLink, grade: 'C' },
  },
  estimates: {
    title: 'How these are estimated',
    body: 'Body fat, fat mass, lean mass and lean mass index (lean mass per height squared) are estimates from your height, weight and sex, adjusted by your shape, any waist or body-fat measurement, and your training. The bar is the 80 % range: the true value is likely inside it. Calibrating means only population averages so far.',
    source: { kind: 'estimate', words: 'From your height, weight, sex, shape, measurements and training.' },
    range: 'An 80 % range: the true value is likely inside it, never certain.',
    terms: [
      { term: 'Lean mass index', text: 'Lean mass divided by your height squared, in kg/m².' },
      { term: 'Calibrating', text: 'Only population averages so far. A shape, a measurement or training narrows it.' },
    ],
    evidence: { to: paths.evidenceTopic('body-composition-estimation'), label: 'How body composition is estimated' },
  },
  shape: {
    title: 'Shape',
    body: 'These sliders describe your body so the estimates can use it: body fat, where your fat sits, and how much muscle you carry for your size. Moving them also reshapes the figure. If you add a measured waist or body fat, the estimate uses it and the matching slider is set for you.',
    source: { kind: 'logged', words: 'Your own settings.' },
    range: 'None: you set these.',
  },
  basics: {
    title: 'Basics',
    body: 'Sex, age, height and weight set the equations behind every estimate. Sex sets the equations, not how we address you. Until you enter a value, Vitals uses a typical adult value and says so.',
    source: { kind: 'logged', words: 'What you entered; typical adult values stand in until then.' },
    range: 'None: these are your own values.',
  },
  maintenance: {
    title: 'Maintenance',
    body: 'About how much energy your body uses in a day. It’s an estimate with a range. The bar splits it into resting metabolism, everyday living, steps, training and digesting food; a dashed part rests on a default because you skipped that question. The note under the table names the answer that would narrow the range most.',
    source: { kind: 'estimate', words: 'From your answers: resting metabolism from your measured rate, your lean mass, or your size, age and sex.' },
    range: 'An 80 % range, rounded to the nearest 10.',
    evidence: { to: paths.evidenceTopic('energy-expenditure'), label: 'How energy use is estimated' },
  },
  habits: {
    title: 'Habits',
    body: 'Your usual eating, stress and training history. They feed the estimates and the plan. Where you haven’t answered, Vitals shows its default value, so you can see what it assumed.',
    source: { kind: 'logged', words: 'Your answers, and defaults where you gave none.' },
    range: 'None: defaults stand in where you have not answered.',
  },
  labs: {
    title: 'Lab values',
    body: 'Optional values from the last 3 months only. Resting energy and VO₂max should come from a lab or field test, not a watch. Leave anything you don’t have empty.',
    source: { kind: 'logged', words: 'Your own entries from a lab or field test.' },
    range: 'None here: Blood markers in Progress shows readings against your plan.',
  },
  plan: { title: 'Find plans', body: SETUP.planLine },
  simulate: { title: 'Simulate a plan', body: SETUP.simulateLine },
} satisfies Record<string, InfoSpec>;
