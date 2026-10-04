/**
 * Your body — all copy in one place (design/screens/your-body.md §6, DESIGN_DIRECTION §7 voice: second person,
 * present tense, specific, never moralising; numbers with units and ranges; no body labels, no exclamation marks).
 * Engraved labels are authored lowercase.
 */
import { FAT_ANCHOR_DESCRIPTORS, type Sex } from '@/engine/body';

export const TITLE = 'Your body';

export const SAVE = {
  saved: 'saved on this device',
  saving: 'saving…',
  unavailable: 'not saved · this browser isn’t storing data',
} as const;

export const SETUP = {
  steps: [
    { id: 'basics', label: 'basics' },
    { id: 'shape', label: 'shape' },
    { id: 'habits', label: 'a normal day' },
  ],
  progressLabel: 'Setup progress',
  next: { basics: 'Next: shape', shape: 'Next: a normal day', habits: 'Done' },
  back: 'Back',
  skip: 'Skip for now',
  intro: {
    basics: 'Four facts the equations need. Your data starts on this device and can sync if you connect your own server.',
    shape: 'Drag the scales, or the figure’s edges, until the figure looks like you. Every estimate follows as you go.',
    habits: 'How you usually train, move, sleep and eat. Maintenance energy updates as you go.',
  },
  missing: (fields: string[]) => `Enter your ${listAnd(fields)} to continue.`,
  startTitle: 'Choose a start',
  startLead: 'Your body is set. Every projection and plan starts from it, and you can refine it any time.',
  simulate: 'Simulate a plan I have in mind',
  simulateHint: 'Paint weeks of eating, training and fasting, then run them.',
  plan: 'Find a plan for my goals',
  planHint: 'Rank what you want to change; Vitals searches for regimes that get there.',
  stay: 'Back to Your body',
} as const;

export const CONTINUE = {
  title: 'Next',
  lead: 'Saved on this device. Projections and plans start from this body.',
  simulate: 'Simulate a plan',
  plan: 'Find a plan',
} as const;

export function listAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ---------------------------------------------------------------------------------------------- basics */

export const BASICS = {
  title: 'Basics',
  units: 'Units',
  sexLabel: 'sex for the physiology equations',
  sexOptions: [
    { value: 'female', label: 'female' },
    { value: 'male', label: 'male' },
    { value: 'unspecified', label: 'prefer not to say' },
  ],
  sexUnspecifiedHelp: 'We’ll average the female and male equations, so ranges are a little wider.',
  sexUnsetHelp: 'Choose the equation set that fits your body best. It changes the physiology, not how we address you.',
  age: 'age',
  height: 'height',
  weight: 'weight',
  typical: 'typical adult value · enter yours',
  bmiCaution: 'Check this weight — it’s outside the range our equations were built on. Projections will show wider ranges.',
  more: 'equation details',
  ethnicity: 'ancestry · optional',
  ethnicityHelp: 'Only adjusts the body-fat equation, its range and the visceral-fat estimate. Leave it unset if you prefer.',
  ethnicityOptions: [
    { value: 'unset', label: 'not set' },
    { value: 'white', label: 'European' },
    { value: 'black', label: 'African or Caribbean' },
    { value: 'eastAsian', label: 'East Asian' },
    { value: 'southeastAsian', label: 'Southeast Asian' },
    { value: 'southAsian', label: 'South Asian' },
    { value: 'hispanic', label: 'Hispanic or Latin American' },
    { value: 'other', label: 'other or mixed' },
  ],
} as const;

/* ---------------------------------------------------------------------------------------------- figure */

export const FIGURE = {
  title: 'Figure',
  captionPointer: 'front · side · drag the figure’s edges to adjust',
  captionTouch: 'front · side',
  viewLabel: 'What the stage shows',
  views: [
    { value: 'figure', label: 'figure' },
    { value: 'visceral', label: 'visceral' },
  ],
  adjustDrawing: 'Adjust the drawing ›',
  loadDetailed: 'Load detailed figure · up to 300 kB',
  slowSwitch: 'Switched to the simple figure to keep sliders smooth.',
  visceralCaption: 'Waist slice, drawn to scale from your estimate. Illustrative — organs are simplified.',
  visceralHow: 'Estimated from your fat mass, where it sits, age and waist. Grade C: a model checked against scans; read the size of the band, not the exact number.',
  visceralHowLink: 'How this is drawn ›',
  visceralWaistSets: 'Your waist measurement sets the outer contour.',
  visceralAddWaist: 'A waist measurement narrows the range.',
  adjust: 'adjust on figure',
  hiddenTitle: 'Figure hidden.',
  hiddenBody: 'Your estimates still use the shape sliders.',
  hiddenSettings: 'Turn it back on in Settings › Appearance.',
  gentleHidden: 'The figure is hidden in gentle mode. Your estimates still use the shape sliders.',
  gentleShow: 'Show figure',
  gentleHide: 'Hide figure',
  settingsLink: 'Appearance settings',
  diverges: (fig: string, est: string) =>
    `The figure shows ${fig} % body fat as you set it. The estimate, ${est} %, weighs it against your height, weight and training — projections start from the estimate.`,
  miniLabel: 'Back to the figure',
} as const;

/* ---------------------------------------------------------------------------------------------- drawing */

/**
 * Shape › Adjust the drawing (body-figure-v2.md §5.4): drawing-only controls. Never a sex or gender word here, nor
 * "neutral", "type A/B" or "body type" (a copy test enforces it).
 */
export const DRAWING = {
  title: 'Adjust the drawing',
  frame: 'frame',
  hipsLed: 'hips-led',
  shouldersLed: 'shoulders-led',
  basicsTick: 'basics',
  frameHelp: 'Only changes the drawing. Your estimates don’t change.',
  matchBasics: 'Match my basics',
  matchesAlready: 'Already matches your basics',
  layers: 'show lean tissue inside',
  layersHelp: 'Draws the fat as a see-through layer over the lean tissue. Off: one solid figure.',
  extrasHelp: 'Chest and arms change the drawing too, not the estimate.',
} as const;

/* ---------------------------------------------------------------------------------------------- estimates */

export const EST = {
  title: 'Estimates',
  caption: 'live · likely range = 80 % of people like you',
  bodyFat: 'body fat',
  fatMass: 'fat mass',
  leanMass: 'lean mass',
  ffmi: 'lean mass index',
  maintenance: 'maintenance',
  needsWeight: 'needs weight',
  averages: 'based on averages · refine',
  averagesHint: 'Shape the figure or add a waist measurement',
  showNumbers: 'show numbers',
  hideNumbers: 'hide numbers',
  gentleNote: 'Body-weight numbers are tucked away in gentle mode.',
  howBodyFat: (sd: string, measuredWaist: boolean, measuredBf: string | null) => {
    if (measuredBf) return `± ${sd} points (1 SD). From your ${measuredBf} measurement, figure and weight.`;
    return measuredWaist
      ? `± ${sd} points (1 SD). From your figure, weight and waist. A DEXA scan would narrow this to about ±3 points.`
      : `± ${sd} points (1 SD). From your figure and weight. Add a waist measurement to narrow the range.`;
  },
  howFatMass: 'Body fat × weight.',
  howLean: 'Everything that isn’t fat: muscle, organs, bone, water, glycogen.',
  howFfmi: (words: string) => `Lean mass per height². The figure’s muscle: ${words} for your size.`,
  howMaintenance: (rmr: string, steps: string, sessions: number) =>
    `${rmr}, × your activity: ${steps} steps, ${sessions === 0 ? 'no training sessions' : `${sessions} session${sessions === 1 ? '' : 's'} a week`}.`,
  rmr: {
    measured: 'Your measured resting energy',
    'lean-mass': 'Resting energy from your lean mass',
    'size-and-age': 'Resting energy from your size and age',
  },
  spoken: (bf: string, lean: string, maint: string) => `Body fat ${bf}. Lean mass ${lean}. Maintenance ${maint} a day.`,
} as const;

/* ---------------------------------------------------------------------------------------------- shape */

export const SHAPE = {
  title: 'Shape',
  reset: 'Reset to estimate',
  bodyFat: 'body fat',
  bodyFatHelp: 'Start from our estimate, then match the figure to how you look.',
  nearest: (pct: string, words: string) => `reference at ${pct} %: ${words}`,
  whereTitle: 'Where it sits',
  belly: 'belly & waist',
  hips: 'hips & thighs',
  chest: 'chest',
  arms: 'arms',
  drawingOnly: 'changes the drawing, not the estimate',
  shareUnit: '% of fat',
  distLabels: [
    { value: -1, label: 'less' },
    { value: 0, label: 'typical' },
    { value: 1, label: 'more' },
  ],
  bellyLocked: 'set by your waist measurement',
  unlock: 'unlock',
  muscleTitle: 'Muscle',
  upper: 'upper body',
  lower: 'lower body',
  expectedRef: 'expected',
  muscleHelp: '“Expected” is the muscle your height, weight, age and training imply. Match the figure to how you look; the estimate weighs both.',
  measuredTitle: 'Measured',
  waistSwitch: 'use measurement',
  waist: 'waist at the top of the hip bones',
  waistLocked: 'turn on “use measurement”',
  waistHelp: 'Optional. Measure around your waist at the top of the hip bones, after a normal breath out. It narrows the body-fat range and sets where fat sits.',
  waistPredicted: 'Shows the waist predicted from your body until you measure.',
  waistPin: (pct: string) => `Your waist suggests about ${pct} % body fat — we moved the estimate.`,
  neck: 'neck · optional',
  neckHelp: 'Below the larynx. With your waist it adds the US-Navy equation and narrows the range a little.',
  hip: 'hips at the widest · optional',
  knownSwitch: 'use a measurement',
  knownTitle: 'body fat measured',
  knownValue: 'measured body fat',
  knownMethod: 'measured by',
  knownHelp: 'A measured value narrows the range. DEXA narrows it most; smart scales vary more.',
  methods: [
    { value: 'dxa', label: 'DEXA' },
    { value: 'bia', label: 'smart scale' },
    { value: 'skinfold', label: 'calipers' },
    { value: 'navy', label: 'tape' },
  ],
  mismatch: (kg: string) =>
    `Body fat and muscle as set here would fit a body of about ${kg}. The estimate weighs both against your real weight, so its range is wider.`,
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
  done: 'Done',
  trainingTitle: 'Training',
  history: 'resistance training history',
  historyOptions: [
    { value: 'none', label: 'none' },
    { value: 'lt1y', label: '< 1 yr' },
    { value: '1to3y', label: '1–3 yrs' },
    { value: 'gt3y', label: '3+ yrs' },
  ],
  years: 'years of regular training',
  yearsHelp: 'Counts toward how much muscle your body has built. Breaks of a few months don’t reset it.',
  quality: 'how structured',
  qualityOptions: [
    { value: 'casual', label: 'casual' },
    { value: 'regular', label: 'regular' },
    { value: 'serious', label: 'structured' },
  ],
  qualityHelp: 'Structured = a program with progressive loads.',
  sessions: 'sessions a week, now',
  sessionsUnit: '/wk',
  mix: 'training type',
  mixLabels: [
    { value: 0, label: 'lifting' },
    { value: 0.5, label: 'mixed' },
    { value: 1, label: 'cardio' },
  ],
  mixValue: (lift: number) => `lifting ${lift} % · cardio ${100 - lift} %`,
  activityTitle: 'Movement',
  steps: 'typical steps',
  stepsRef: 'typical: 7 000',
  stepsUnit: '/day',
  sleepTitle: 'Sleep and stress',
  sleep: 'sleep window',
  sleepThumbs: ['bedtime', 'wake time'] as const,
  sleepQuality: 'sleep quality',
  qualityWords: [
    { value: 'poor', label: 'poor' },
    { value: 'fair', label: 'fair' },
    { value: 'good', label: 'good' },
  ],
  stress: 'stress',
  stressWords: [
    { value: 'low', label: 'low' },
    { value: 'moderate', label: 'moderate' },
    { value: 'high', label: 'high' },
  ],
  eatingTitle: 'Usual eating',
  eatingLead: 'What you eat now, on a typical day. It sets the starting point: glycogen, ketones and maintenance before any plan.',
  carbs: 'carbohydrate',
  carbsRef: 'typical 45 %',
  carbsUnit: '% of energy',
  protein: 'protein',
  proteinUnit: 'g/kg',
  proteinRef: 'typical 1.1',
  meals: 'meals a day',
  mealsOptions: [
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    { value: '4', label: '4' },
    { value: '5', label: '5+' },
  ],
  window: 'eating window',
  windowThumbs: ['first bite', 'last bite'] as const,
  animal: 'animal foods',
  animalOptions: [
    { value: 'omnivore', label: 'meat & fish' },
    { value: 'pescatarian', label: 'fish' },
    { value: 'vegetarian', label: 'eggs & dairy' },
    { value: 'vegan', label: 'none' },
  ],
  animalHelp: 'Sets protein quality. Plant proteins count a little less per gram.',
  advanced: 'advanced · optional',
  advancedLead: 'Sensible defaults are already set. Change what you know.',
  advancedEvidence: 'The research behind the defaults',
  fibre: 'fibre',
  fibreUnit: 'g per 1 000 kcal',
  /** Settings › energy in kJ: the same density per 1 000 kJ (stored per 1 000 kcal). */
  fibreUnitKJ: 'g per 1 000 kJ',
  sodium: 'salt (sodium)',
  sodiumUnit: 'g sodium/day',
  caffeine: 'caffeine',
  caffeineUnit: 'mg/day',
  caffeineHint: 'a mug of filter coffee ≈ 100 mg',
  alcohol: 'alcohol',
  alcoholUnit: 'drinks/wk',
  alcoholHint: 'one drink = 14 g alcohol',
  upf: 'ready-made and packaged food',
  upfUnit: '% of energy',
  variety: 'food variety',
  varietyOptions: [
    { value: '1', label: 'narrow' },
    { value: '2', label: 'average' },
    { value: '3', label: 'wide' },
  ],
  multivitamin: 'daily multivitamin',
  smoker: 'smoke tobacco',
  smokerHelp: 'Smoking clears caffeine about twice as fast; the model accounts for it.',
  drinks: 'energy from drinks · optional',
  drinksHelp: 'Juice, milk, soft drinks, alcohol, sweetened coffee. Leave empty for the population typical amount.',
  resetDefault: 'use default',
  cycleTitle: 'Cycle',
  menopause: 'menopause',
  menopauseOptions: [
    { value: 'pre', label: 'before' },
    { value: 'peri', label: 'around' },
    { value: 'post', label: 'after' },
  ],
  menopauseHelp: 'Moves where the model expects visceral fat to settle, and the cycle-related changes.',
  cycleTrack: 'track menstrual cycle',
  cycleHelp: 'Lets the model account for cycle-related water and appetite changes. Stays on this device.',
  cycleLength: 'cycle length',
  cycleUnit: 'days',
  lastPeriod: 'last period started',
  contraception: 'contraception',
  contraceptionOptions: [
    { value: 'none', label: 'none' },
    { value: 'combinedOral', label: 'combined pill' },
    { value: 'progestinOnly', label: 'progestin-only' },
    { value: 'iud', label: 'IUD' },
    { value: 'other', label: 'other' },
  ],
  summary: {
    history: 'training history',
    type: 'training type',
    steps: 'typical steps',
    sleep: 'sleep',
    stress: 'stress',
    eating: 'usual eating',
    cycle: 'cycle',
  },
  notSet: 'not set',
} as const;

/* ---------------------------------------------------------------------------------------------- labs */

export const LABS = {
  title: 'Lab values',
  caption: 'optional',
  lead: 'Recent measured values, if you have them. Blood-marker channels then start from your numbers instead of showing only the change.',
  empty: 'None added. You can skip this.',
  add: 'Add values',
  edit: 'Edit',
  editorTitle: 'Lab values',
  editorLead: 'Only enter values from a recent test (the last 3 months). Leave the rest empty.',
  clear: (name: string) => `Clear ${name}`,
  clearAll: 'Clear all',
  unitsNote: 'Units follow Settings › Units › glucose and lipids.',
  groups: {
    metabolism: 'Metabolism and fitness',
    lipids: 'Blood lipids',
    glucose: 'Glucose',
    pressure: 'Blood pressure',
    other: 'Other',
  },
  count: (n: number) => `${n} value${n === 1 ? '' : 's'} added`,
} as const;
