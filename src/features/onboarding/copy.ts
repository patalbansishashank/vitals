/**
 * Vitals — onboarding, safety and disclaimer copy. ONE module so clinicians and counsel can review it.
 *
 * Sources: research/17-safety-guardrails.md (§3 persistent banner, §4.1 item wording, §4.3.3 stop rules and
 * acknowledgements, §4.5 DS-8 help card, §4.6 disclaimer drafts, §4.7 privacy) edited to the design voice
 * (design/DESIGN_DIRECTION.md §7: second person, present tense, precise, humane, never moralising; risk
 * first, then what to do, then the option; no guarantees, no exclamation marks) and the screen spec
 * design/screens/onboarding-safety.md §6.
 *
 * `REVIEW:` marks every statement the dossier flags for clinician or counsel review (§1.2 item 7, §4.6,
 * §10) and every number that must be re-verified before release (DS-8 helplines).
 *
 * Versioning: acknowledged text is versioned in ACK_VERSIONS (./copyEarly.ts). Changing the meaning of acknowledged copy
 * means bumping its version, which re-prompts everyone who acknowledged the old text; add a line to
 * DISCLAIMER_CHANGES for the "What changed" note.
 */
import type { FastingAckId, MessageId, ModeName, OptInTier, PlannerLockId, QuestionId } from './safetyRules';

// The few values the safety gate and stores need before first paint live in ./copyEarly.ts, so the app's initial bundle
// does not carry this whole module; they are part of this copy and reviewed with it.
export { ACK_VERSIONS, DANGER_ACK_VERSION, FASTING_ACK_VERSION, MODE_LABEL, SHORT_WINDOW_ACK_VERSION } from './copyEarly';

/** Thin space between a number and its unit or thousands (DESIGN_DIRECTION §3.1), in its no-break form (U+202F) so a value never wraps away from its unit. */
const T = '\u202F';

/* ============================================================================
   Versions of acknowledged copy
   ============================================================================ */

// ACK_VERSIONS, FASTING_ACK_VERSION, SHORT_WINDOW_ACK_VERSION and DANGER_ACK_VERSION live in ./copyEarly.ts (re-exported above).

/** "What changed" line shown on re-consent, by the version the user is asked to accept. */
export const DISCLAIMER_CHANGES: Readonly<Record<number, string>> = {
  1: '',
};

/** Date this copy was last reviewed. REVIEW: set to the date of clinician and counsel sign-off before release. */
export const LAST_REVIEWED = '30 September 2026';

/* ============================================================================
   Welcome (step 1)
   ============================================================================ */

export const WELCOME = {
  documentTitle: 'Welcome',
  headline: 'See what a plan does before you live it.',
  body: 'Vitals projects your body forward day by day from what you eat, how you train, move and sleep. It shows trends for an average person like you — with ranges, not promises — and the evidence behind every curve. Everything stays on this device.',
  start: 'Get started',
  time: 'About a minute. A few questions first, then your body and a normal week (about five minutes, every question skippable).',
  importLead: 'Already have data?',
  importAction: 'Import a file',
  /** Text alternative for the aria-hidden example recording (design spec §9). */
  illustrationAlt: 'Example: a twelve-week projection in three channels — fat mass falling slowly, glycogen dipping during a three-day fast, and blood ketones rising while it lasts — beside a body figure that slims slightly.',
  exampleLabel: 'example',
  lanes: { fat: 'fat mass', glycogen: 'glycogen', ketones: 'blood ketones' },
  ketosisThreshold: 'ketosis',
} as const;

export const STEP_NAMES = { intro: 'Welcome', screening: 'About you', consent: 'Before you start' } as const;
export const PROGRESS = {
  label: 'Setup progress',
  done: ', done',
  current: (n: number, of: number) => `, step ${n} of ${of}`,
  back: 'Back',
} as const;

/* ============================================================================
   Screening (step 2)
   ============================================================================ */

export const SCREENING = {
  title: 'About you',
  lead: "A few questions that change what's safe to suggest.",
  sub: 'Answers stay on this device. You can change them any time in Settings.',
  whyTitle: 'Why we ask',
  why: "These answers change what the Planner may suggest and which warnings the Simulator shows. They aren't a diagnosis, and they are never sent anywhere.",
  continue: 'Continue',
  save: 'Save answers',
  remaining: (n: number) => (n === 1 ? '1 question left' : `${n} questions left`),
  continueBlocked: 'Answer every question above to continue. “Prefer not to say” counts.',
  tickOne: 'Tick at least one.',
  jumpTo: 'Go to the next unanswered question',
  reviewSettings: 'Change any answer, then save. Your safety settings update straight away.',
  reviewImport:
    'These answers came from an imported file. Check them, then save to apply them on this device. For the eating questions the file holds only their outcome, not your answers, and that outcome is kept.',
  reviewExpired: "It's been a year since you answered. Please check these are still right.",
  reviewUpdate: 'We added or changed some questions. Please answer the new ones.',
  scoffPrivacy: "For your privacy, Vitals doesn't keep your answers to the eating questions. Please answer them again.",
  /** Review of stored answers: only the outcome of the eating questions was kept (DS-10), and it still applies. */
  scoffKept: (risk: boolean) =>
    `For your privacy, Vitals keeps only the outcome of these questions, not your answers. ${
      risk ? 'Your earlier answers pointed to a gentler approach, and that still applies.' : 'Your earlier answers did not change your safety settings, and that still applies.'
    } Answer them again only if something has changed.`,
  storageBlocked: "This browser isn't saving data, so your answers reset when you close the tab.",
  groups: { you: 'you', eating: 'eating', health: 'health and medicines', activity: 'activity', alcohol: 'alcohol' },
} as const;

type Options<V extends string> = Readonly<Record<V, string>>;

export const YES_NO: Options<'yes' | 'no'> = { yes: 'yes', no: 'no' };
export const YES_NO_PREFER: Options<'yes' | 'no' | 'prefer-not'> = { yes: 'yes', no: 'no', 'prefer-not': 'prefer not to say' };

export const QUESTIONS = {
  ageBand: {
    title: 'How old are you?',
    help: 'Vitals is built for adults. Your exact age goes in Your body.',
    options: { 'under-18': 'under 18', '18-64': '18–64', '65-74': '65–74', '75-plus': '75 or older' },
  },
  sarcf: {
    title: 'Strength and getting around',
    help: 'Five quick questions that help plans look after muscle and bone.',
    items: {
      lift: `How much difficulty do you have lifting and carrying 4.5${T}kg (10${T}lb)?`,
      walk: 'How much difficulty do you have walking across a room?',
      chair: 'How much difficulty do you have getting up from a chair or bed?',
      stairs: 'How much difficulty do you have climbing a flight of 10 stairs?',
      falls: 'How many times have you fallen in the past year?',
    },
    options: { 0: 'none', 1: 'some', 2: 'a lot or unable' },
    fallsOptions: { 0: 'none', 1: '1–3', 2: '4 or more' },
  },
  pregnancy: {
    title: 'Are you pregnant or breastfeeding, or planning a pregnancy in the next few months?',
    help: undefined,
    options: { 'pregnant-or-breastfeeding': 'pregnant or breastfeeding', planning: 'planning a pregnancy', no: 'no', 'prefer-not': 'prefer not to say' },
  },
  eatingDisorder: {
    title: 'Have you ever been diagnosed with, or treated for, an eating disorder?',
    help: 'Now or in the past.',
  },
  scoff: {
    // REVIEW: SCOFF is a published instrument; items are adapted (item 4 reworded, "one stone" → 6 kg), so its
    // validation figures do not transfer; confirm licence/permission before release (dossier §4.1).
    title: 'A few quick questions about eating',
    help: "They help Vitals choose gentle defaults when eating is hard. They aren't a diagnosis.",
    items: {
      sick: 'Do you make yourself sick because you feel uncomfortably full, or to control your weight?',
      control: 'Do you worry that you have lost control over how much you eat?',
      weightLoss: `In the last 3 months, have you lost more than 6${T}kg (13${T}lb) without meaning to, or through very strict dieting?`,
      believeFat: 'Do you believe you are fat when other people say you are too thin?',
      foodDominates: 'Would you say food dominates your life?',
    },
  },
  diabetes: {
    title: 'Do you have diabetes, or take any medicine to lower blood sugar?',
    help: undefined,
    itemsLabel: 'Which of these apply?',
    // REVIEW: medicine examples (clinician / pharmacist).
    items: {
      'type-1': 'Type 1 diabetes',
      insulin: 'Insulin',
      'sulfonylurea-meglitinide': 'A sulfonylurea or meglitinide (for example gliclazide, glimepiride, repaglinide)',
      sglt2: 'An SGLT2 inhibitor (names ending in “-gliflozin”, for example empagliflozin, dapagliflozin)',
      metformin: 'Metformin',
      'glp1-injection': 'A GLP-1 medicine or another injection (for example semaglutide, liraglutide)',
      'other-glucose-lowering': 'Another medicine that lowers blood sugar',
      'diet-only': 'Diabetes managed without medicine',
    },
  },
  conditions: {
    title: 'Has a doctor ever said you have a heart condition, high blood pressure, kidney disease or liver disease, or that you have had a stroke?',
    help: undefined,
    itemsLabel: 'Which of these?',
    items: {
      heart: 'A heart condition or irregular heartbeat',
      'high-blood-pressure': 'High blood pressure',
      kidney: 'Kidney disease',
      liver: 'Liver disease',
      stroke: 'A stroke',
    },
  },
  metabolic: {
    title: 'Do you have gout, kidney stones, gallstones or pancreatitis, or a rare metabolic condition?',
    help: 'Rare metabolic conditions include porphyria, and carnitine or fat-oxidation disorders.',
    itemsLabel: 'Which of these?',
    items: {
      gout: 'Gout',
      'kidney-stones': 'Kidney stones',
      gallstones: 'Gallstones or gallbladder disease',
      pancreatitis: 'Pancreatitis',
      'rare-metabolic': 'A rare metabolic condition (for example porphyria, or a carnitine or fat-oxidation disorder)',
    },
  },
  medications: {
    title: 'Do you regularly take prescription medicine for a long-term condition?',
    help: 'For example blood-pressure or “water” tablets, lithium, blood thinners, seizure medicines or steroids.',
    itemsLabel: 'Which kinds? Your pharmacist can tell you if you are not sure.',
    // REVIEW: medicine classes, examples and their mapping (dossier §4.4; warfarin and thyroid rows UNVERIFIED).
    items: {
      diuretic: 'Water tablets (diuretics, for example furosemide or a thiazide)',
      'acei-arb-mra': 'An ACE inhibitor, ARB or spironolactone (for example ramipril, losartan)',
      'other-blood-pressure': 'Other blood-pressure medicine (for example a beta-blocker or amlodipine)',
      lithium: 'Lithium',
      'topiramate-zonisamide': 'Topiramate or zonisamide',
      corticosteroid: 'Steroid tablets (for example prednisolone)',
      'heart-rhythm': 'A medicine that affects heart rhythm',
      chemotherapy: 'Chemotherapy',
      antacid: 'Antacids most days',
      anticoagulant: 'A blood thinner (for example warfarin, apixaban)',
      thyroid: 'Thyroid hormone (for example levothyroxine)',
      other: 'Another long-term prescription medicine',
    },
  },
  symptoms: {
    title: 'In the past 12 months, have you fainted, had chest pain, or felt so dizzy you lost your balance?',
    help: undefined,
  },
  supervisedExercise: {
    title: 'Has a doctor said you should only exercise under medical supervision?',
    help: undefined,
  },
  musculoskeletal: {
    title: 'Do you have a bone, joint or muscle problem that more exercise could make worse?',
    help: undefined,
  },
  alcohol: {
    title: 'Do you drink heavily, or has anyone said alcohol is a problem for you?',
    help: undefined,
  },
} as const;

/** Section a question sits in on the screening page. */
export const QUESTION_GROUP: Readonly<Record<QuestionId, keyof typeof SCREENING.groups>> = {
  ageBand: 'you',
  sarcf: 'you',
  pregnancy: 'you',
  eatingDisorder: 'eating',
  scoff: 'eating',
  diabetes: 'health',
  conditions: 'health',
  metabolic: 'health',
  medications: 'health',
  symptoms: 'activity',
  supervisedExercise: 'activity',
  musculoskeletal: 'activity',
  alcohol: 'alcohol',
};

/* ============================================================================
   Consequences (inline under the question, and in the safety summary)
   ============================================================================ */

export const MESSAGES: Readonly<Record<MessageId, { title: string; body: string }>> = {
  'adults-only': {
    title: 'Vitals is for adults.',
    body: 'Continue to read why, and where to find support.',
  },
  'older-adult': {
    title: 'Plans look after muscle and bone.',
    body: `From 65, plans keep deficits to 15${T}% of maintenance and loss to 0.5${T}% of body weight a week, with protein of at least 1.2${T}g per kg and fasts of up to 24 hours.`,
  },
  'older-adult-75': {
    title: 'Plans stay at maintenance.',
    body: 'From 75, plans focus on protein and strength training rather than a deficit, and keep daily fasts short.',
  },
  'sarcopenia-risk': {
    title: 'Plans stay at maintenance.',
    body: 'Your answers suggest strength needs protecting, so plans focus on protein and strength training rather than a deficit.',
  },
  'pregnancy-planner-off': {
    title: 'The Planner is off.',
    body: "Vitals isn't designed for pregnancy or breastfeeding. You can still explore the Simulator; it flags anything that isn't advised.",
  },
  'pregnancy-planning': {
    title: "We'll use clinician-first mode.",
    body: 'While you plan a pregnancy, plans stay at maintenance with no fasting over 12 hours. Please check changes with your clinician.',
  },
  'pregnancy-undisclosed': {
    // REVIEW: dossier §4.1 treats "prefer not to say" as "no" with this notice; clinician to confirm.
    title: "That's fine.",
    body: "Vitals isn't designed for pregnancy or breastfeeding. If either applies, please use the Simulator only and check changes with your clinician.",
  },
  'gentle-mode': {
    title: "Thank you for telling us. We'll use gentle mode.",
    body: 'Plans stay at maintenance or above, with no fasting over 12 hours and no weight-loss goals. Support is available any time.',
  },
  'gentle-mode-undisclosed': {
    title: "That's fine. We'll use gentle mode.",
    body: 'Plans stay at maintenance or above, with no fasting over 12 hours and no weight-loss goals. Support is available any time.',
  },
  'gentle-mode-scoff': {
    title: "Based on your answers, we'll use gentle mode.",
    body: 'Plans stay at maintenance or above, with no fasting over 12 hours and no weight-loss goals. Support is available any time.',
  },
  'diabetes-planner-off': {
    title: 'The Planner is off.',
    body: 'Some diabetes medicines can cause low blood sugar or ketoacidosis with fasting, low-carb eating or big deficits. The Simulator will flag risky days. Please plan changes with your clinician.',
  },
  'diabetes-clinician-first': {
    title: "We'll use clinician-first mode.",
    body: 'Plans keep deficits small and skip very-low-carb eating, and remind you to check changes with your clinician. With glucose-lowering medicine, fasts stay under 12 hours.',
  },
  'diabetes-undisclosed': {
    // REVIEW: "prefer not to say" on Q9 is treated as a possible glucose-lowering medicine (not specified in the dossier).
    title: "That's fine. We'll use clinician-first mode.",
    body: 'Plans keep deficits small, keep fasts under 12 hours and skip very-low-carb eating. Please check changes with your clinician.',
  },
  'conditions-clinician-first': {
    title: "We'll use clinician-first mode.",
    body: 'Smaller deficits, no fasts over 24 hours, and a reminder to check changes with your clinician.',
  },
  'metabolic-clinician-first': {
    title: "We'll use clinician-first mode.",
    body: 'Smaller deficits, no fasts over 24 hours, and a reminder to check changes with your clinician.',
  },
  'medications-clinician-first': {
    title: "We'll use clinician-first mode.",
    body: 'Some medicines interact with fasting, salt and fluid shifts. Plans use smaller deficits and no fasts over 24 hours; please check changes with your clinician or pharmacist.',
  },
  'symptoms-exercise': {
    title: "We'll keep exercise light to moderate in plans.",
    body: 'Vigorous sessions in the Simulator show a notice. Please get checked by a clinician before hard training.',
  },
  'supervised-exercise': {
    title: "Plans won't prescribe exercise.",
    body: 'You can still add exercise in the Simulator; vigorous sessions show a notice.',
  },
  'musculoskeletal-exercise': {
    title: "We'll build exercise up gently.",
    body: 'Plans raise training volume and impact slowly.',
  },
  'alcohol-fasting': {
    title: 'Plans keep fasts short.',
    body: 'Alcohol changes blood sugar and salt balance during fasting, so plans keep fasts to 20 hours and skip very-low-energy days.',
  },
  'body-underweight': {
    // REVIEW: clinician wording for the underweight notice (W-E14, §4.2, DS-1).
    title: 'Your BMI is under 18.5.',
    body: "Plans won't include a deficit, fasting or very-low-carb eating. Please talk to a clinician about your goals; you deserve care at any weight.",
  },
  'body-bmi-below-20': {
    title: "Plans won't start a deficit.",
    body: 'A deficit starts only at a BMI of 20 or above, with room for error in the body-fat estimate.',
  },
  'body-bf-below-floor': {
    title: "Plans won't include a deficit.",
    body: 'Your estimated body fat is close to the lower limit Vitals plans to. The estimate can be off by about 4 points.',
  },
  'refeeding-risk': {
    title: 'Fasts over 48 hours are off.',
    body: 'Your answers match risk factors for problems when eating restarts after a long fast.',
  },
};

/* ============================================================================
   Modes and limits
   ============================================================================ */

// MODE_LABEL lives in ./copyEarly.ts (re-exported above).

/** Short form for "Mode: Standard." lines (Settings). */
export const MODE_SHORT: Readonly<Record<ModeName, string>> = {
  standard: 'Standard',
  gentle: 'Gentle',
  'clinician-first': 'Clinician-first',
  'simulator-only': 'Simulator only',
  'adults-only': 'Adults only',
};

export const MODE_SUMMARY: Readonly<Record<ModeName, string>> = {
  standard: `The Planner can suggest deficits up to 25${T}% of maintenance and fasts up to 24 hours; longer fasts need your opt-in in Settings.`,
  gentle: 'Plans stay at maintenance or above, with no fasting over 12 hours and no weight-loss goals. The Simulator still works and flags restrictive days.',
  'clinician-first': `Plans use smaller deficits (up to 15${T}% of maintenance) and no fasts over 24 hours, with a reminder to check changes with your clinician.`,
  'simulator-only': "The Planner is off. You can explore the Simulator; it flags anything that isn't advised for you.",
  'adults-only': 'Vitals is for adults. The Evidence library stays open.',
};

/**
 * The mode summary with the fasting line matched to the current opt-in: "fasts up to 24 hours" is only true without
 * an opt-in (QA 12: Settings kept saying 24 h after opting in to 72 h). `fasting` is the evaluated outcome's
 * `fasting` block (its `maxFastHours` is the effective cap after opt-ins).
 */
export function modeSummary(modeName: ModeName, fasting?: { maxFastHours: number; optInTiers: readonly string[] }): string {
  if (modeName !== 'standard' || !fasting) return MODE_SUMMARY[modeName];
  const deficit = `The Planner can suggest deficits up to 25${T}% of maintenance`;
  const h = fasting.maxFastHours;
  if (h > 72) return `${deficit}, fasts up to 72 hours, and in expert mode one fast of 3 to 7 days at most every 12 weeks, as you chose in Settings › Safety.`;
  if (h > 24) return `${deficit} and fasts up to ${Math.round(h)} hours, as you chose in Settings › Safety.`;
  if (fasting.optInTiers.length === 0) return `${deficit} and fasts up to ${Math.max(12, Math.round(h))} hours; your answers keep longer fasts out of plans.`;
  return MODE_SUMMARY.standard;
}

/** Also clinician-first when gentle mode applies (R1 + R2). */
export const MODE_ALSO_CLINICIAN_FIRST = 'Clinician-first rules apply too: please check changes with your clinician.';

export const SUMMARY = {
  title: 'Your safety settings',
  changesLabel: 'what this changes in plans',
  standardLabel: 'limits for plans',
  review: 'Review my answers',
  bodyPending: 'Your height, weight and body fat from Your body also set limits once you add them.',
  chip: (mode: string) => mode,
  chipPopoverTitle: 'What this changes',
} as const;

const h = (v: number) => (v === 1 ? '1 hour' : `${v} hours`);

export const LOCK_TEXT: Readonly<Record<PlannerLockId, (value?: number) => string>> = {
  'no-deficit': () => 'Plans stay at maintenance or above.',
  'deficit-cap': (v) => `Deficits up to ${v}${T}% of maintenance.`,
  'rate-cap': (v) => `Weight change of at most ${v}${T}% of body weight a week.`,
  'max-fast': (v) => (v !== undefined && v <= 12 ? `No fasting over ${h(v)}.` : `Fasts up to ${h(v ?? 24)}.`),
  'min-eating-window': (v) => `A daily eating window of at least ${h(v ?? 6)}.`,
  'no-ketogenic': () => `No very-low-carb eating (under 50${T}g net carbs a day).`,
  'carb-floor': (v) => `At least ${v}${T}g of carbohydrate a day.`,
  'no-vled': () => `No very-low-energy days (under 800${T}kcal).`,
  'no-weight-loss-goal': () => 'No weight-loss goals.',
  'protein-cap': (v) => `Protein up to ${v}${T}g per kg a day.`,
  'protein-floor': (v) => `Protein of at least ${v}${T}g per kg a day.`,
  'no-potassium-supplement': () => 'No potassium supplements.',
  'no-creatine': () => 'No creatine.',
  'fat-floor': (v) => `At least ${v}${T}g of fat a day, with some at each main meal.`,
  'exercise-light-moderate': () => 'Exercise stays light to moderate.',
  'exercise-low-impact': () => 'Training volume and impact rise slowly.',
  'no-exercise-prescription': () => "Plans don't prescribe exercise.",
};

/* ============================================================================
   Consent (step 3) and re-consent
   ============================================================================ */

export const CONSENT = {
  title: 'Before you start',
  heading: 'Vitals is a simulator.',
  // REVIEW: counsel — intended-use statements (FDA General Wellness / MDR wellness carve-out, dossier §4.6).
  points: [
    'It projects trends for an average person with your inputs — with ranges, not promises.',
    "It is not medical advice. It can't diagnose, treat or prevent anything, and it doesn't know your health history.",
    "It will show you risky plans if you build them, and say why they're risky. The Planner never suggests plans outside its safety limits.",
  ],
  check: 'I understand',
  continue: 'Continue',
  continueBlocked: 'Tick “I understand” to continue.',
  fullDisclaimer: 'Full disclaimer',
  whatChanged: 'What changed',
  updatedTitle: 'The disclaimer has changed.',
  updatedBody: 'Please read it again and confirm.',
  shortcut: 'Ctrl or ⌘ + Enter continues.',
} as const;

/* ============================================================================
   Hard stop (under 18)
   ============================================================================ */

export const HARD_STOP = {
  title: 'Vitals is for adults.',
  // REVIEW: clinician — wording for under-18s (dossier HC-P1, DS-8).
  body: "Projections and plans like these aren't suitable under 18. If you'd like to talk about food, sport or your body, a GP, school nurse or another adult you trust is a good place to start.",
  evidence: 'You can still read the Evidence library.',
  evidenceLink: 'Open the Evidence library',
  mistake: 'I entered my age by mistake',
} as const;

/* ============================================================================
   Help card (DS-8)
   ============================================================================ */

export const HELP = {
  title: 'Support, any time.',
  body: 'If eating, food or your body feels hard right now, you deserve care at any weight. Talk to your doctor, or contact an eating-disorder helpline where you live.',
  directoryLead: 'Free, confidential helplines by country:',
  directory: { label: 'findahelpline.com', href: 'https://findahelpline.com' },
  // REVIEW: verify every number and opening time before release and re-verify periodically (dossier DS-8).
  regions: [
    { region: 'UK', service: 'Beat', detail: 'England 0808 801 0677 · Scotland 0808 801 0432 · Wales 0808 801 0433 · Northern Ireland 0808 801 0434 (3–8 pm, Monday to Friday)' },
    { region: 'Australia', service: 'Butterfly', detail: '1800 33 4673 (8 am to midnight AEST, every day)' },
  ],
  crisis: "Vitals is not a crisis service. If you might be in danger, call your local emergency number.",
  link: 'Support, any time',
} as const;

/* ============================================================================
   Disclaimers next to the numbers (dossier §4.6 placements)
   ============================================================================ */

export const DISCLAIMER = {
  /** Every results surface, directly under the numbers (design §6.6; FTC "near the claim"). */
  resultsLine: 'Projections for an average person with your inputs. Not medical advice. Individual results differ: see the range on each curve.',
  resultsLink: 'Safety & limits',
  /** Planner prescription card (dossier §4.6). */
  plannerCard: 'This plan stays inside published safety limits for healthy adults. It is not personalised medical advice. Stop and get help if you feel unwell.',
  // REVIEW: counsel — short footer (dossier §4.6 draft, ≤ 230 characters).
  footer: 'Vitals is an educational simulator for adults 18 and over. It estimates trends for an average person — not medical advice, diagnosis or treatment. Talk to a clinician before changing how you eat, fast or exercise.',
  /** Settings › About summary line above the full text. */
  settingsSummary: 'Vitals is an educational simulator, not a medical device. It is not medical advice.',
} as const;

/** §3 persistent banner for every caution/danger scenario. REVIEW: clinician (PROPOSED from the AE profiles). */
export const STOP_AND_GET_HELP =
  'Stop and get help if you feel faint, have chest pain or an irregular heartbeat, are confused, keep vomiting, or have severe headache, cramps or abdominal pain.';

/* ============================================================================
   Danger acknowledgement (results) — design §6.6, dossier §3 / §4.6
   ============================================================================ */

export const DANGER = {
  // REVIEW: counsel/clinician — danger interstitial (dossier §4.6 draft).
  lead: 'This scenario goes beyond limits considered safe without medical supervision. Vitals shows it for education only.',
  check: 'I understand this is a simulation, not a recommendation.',
  show: 'Show the projection',
  showBlocked: 'Tick the box to show the projection.',
  strip: 'Simulation — not a recommendation',
  heading: (n: number) => (n === 1 ? 'Before you see this projection' : `Before you see this projection (${n} warnings)`),
} as const;

/* ============================================================================
   Planner interstitial (R2) and gate
   ============================================================================ */

export const GATE = {
  plannerOffTitle: 'The Planner is off for you.',
  plannerOffBody: 'Your answers mean Vitals won’t suggest plans. You can explore any scenario in the Simulator; it flags what isn’t advised.',
  openSimulator: 'Open the Simulator',
  unscreenedTitle: 'Answer the safety questions first.',
  unscreenedBody: 'They take about a minute and decide what Vitals may suggest.',
  unscreenedAction: 'Answer the questions',
  adultsTitle: 'Vitals is for adults.',
  adultsBody: 'Projections and plans aren’t available under 18. The Evidence library stays open.',
  simulatorNotice: (mode: string) => `${mode} is on. The Simulator flags days that aren't advised for you.`,
  clinicianTitle: 'Talk to your clinician before changing how you eat.',
  // REVIEW: clinician — "talk to your clinician" interstitial for Warn-class populations (dossier §4.2).
  clinicianBody: 'Your answers mean some changes could affect a condition or a medicine. Plans stay inside smaller limits; please check them with your clinician or pharmacist before you start.',
  clinicianCheck: "I'll check plans with my clinician before I follow them.",
  clinicianContinue: 'Continue to the Planner',
  clinicianBlocked: 'Tick the box to continue.',
} as const;

/* ============================================================================
   Fasting tiers and opt-ins (dossier §4.3; Settings › Safety)
   ============================================================================ */

export const TIER_LABEL: Readonly<Record<OptInTier, string>> = { T2: 'up to 48 hours', T3: 'up to 72 hours', T4: '3 to 7 days' };

export const FASTING = {
  switchLabel: 'allow fasts over 24 hours in plans',
  switchHelp: 'Plans with longer fasts include salt, fluid and a gentle return to eating.',
  onHelp: (tier: OptInTier) => `On: fasts ${TIER_LABEL[tier]}.`,
  notStandard: 'Only available in Standard mode.',
  notEligible: 'Your answers keep fasts to 24 hours or less.',
  legacy: 'You turned this on in an earlier version. Confirm the new safety steps to keep it on.',
  legacyAction: 'Review and confirm',
  reconfirm: 'The fasting safety steps changed. Confirm them again to keep longer fasts on.',
  illness: (days: number) => `Longer fasts are paused after recent illness${days > 0 ? ` for ${days} more ${days === 1 ? 'day' : 'days'}` : ''}.`,
  expertLabel: 'expert mode: fasts of 3 to 7 days',
  expertHelp: 'Only with a clinician supervising.',
  // dialog
  dialogTitle: 'Allow fasts over 24 hours?',
  // REVIEW: clinician — tier risk statements (dossier §4.3.1, W-F02/W-F03).
  intro: 'Fasts of 24–72 hours can cause light-headedness, headaches and low energy, and need salt and fluid planning. Plans will include those, and a gentle return to eating.',
  illnessQuestion: 'In the last 4 weeks, have you had vomiting, diarrhoea or a fever, an operation, or an infection?',
  illnessBlocked: 'Longer fasts stay off for 4 weeks while you recover. Plans keep daily fasts short until then.',
  priorQuestion: 'Have you fasted for 24 hours before without feeling unwell?',
  priorBlocked: 'Plans stay at 24 hours for now. Longer fasts need a 24-hour fast you already know you tolerate.',
  tierLabel: 'longest fast in plans',
  t3Unavailable: 'Your answers keep fasts to 48 hours or less.',
  acknowledgementsLabel: 'please confirm',
  allow: 'Allow longer fasts',
  allowBlocked: 'Answer both questions and tick every box first.',
  cancel: 'Cancel',
  turnOff: 'Longer fasts are off. Plans keep fasts to 24 hours.',
  // expert mode (T4) — REVIEW: clinician + counsel before enabling (dossier §1.2 item 1, §4.3.2).
  expertTitle: 'Turn on expert mode?',
  expertIntro:
    'Expert mode lets plans include water-only fasts of 3 to 7 days. Every study of fasts this long was medically supervised. Even then, about 1 in 5 people had a severe (grade 3 or higher) side effect by day 5, and 2 of 768 stays had a serious adverse event.',
  expertRefeed: "I'll follow the refeeding plan: about half my usual energy for the first 2 days, back to normal over at least 4 days, with thiamine and a multivitamin.",
  expertConfirmTitle: 'Plans may now include fasts of 3 to 7 days.',
  expertConfirmBody: 'At most one every 12 weeks, with at least 28 days between, always followed by the refeeding plan. You can turn this off any time in Settings.',
  expertContinue: 'Continue',
  expertConfirm: 'Turn on expert mode',
  shortWindowLabel: 'allow eating windows of 4–6 hours in plans',
  shortWindowHelp: 'Plans still fit your protein and energy floors inside the window.',
  shortWindowTitle: 'Allow eating windows of 4–6 hours?',
  shortWindowBody: 'A short daily eating window makes it harder to fit enough protein, fibre and micronutrients, and can bring dizziness or urges to binge. Plans still meet your protein and energy floors inside the window.',
  shortWindowCheck: 'I understand',
  shortWindowAllow: 'Allow',
  shortWindowBlocked: 'Tick “I understand” first.',
  stopRulesLabel: 'stop rules',
} as const;

/** Tier acknowledgements (dossier §4.3.3). REVIEW: clinician. */
export const FASTING_ACKS: Readonly<Record<FastingAckId, string>> = {
  A: 'I answered the safety questions honestly, and I understand this is not medical advice.',
  B: "I'll end a fast straight away if any of these happen:",
  C: "I understand fasts this long were studied under medical supervision. Someone will know I'm fasting, and I won't drive or use dangerous equipment if I feel light-headed.",
  D: 'A clinician knows about my fasts over 3 days and is supervising them.',
};

/** Stop rules for every fast ≥ T2 (dossier §4.3.3, PROPOSED). REVIEW: clinician. */
export const STOP_RULES: readonly string[] = [
  "Fainting, or nearly fainting, that doesn't settle after lying down for 10 minutes",
  'Chest pain, or an irregular or racing heartbeat',
  'New confusion, or slurred or difficult speech',
  'A severe or lasting headache',
  'Vomiting or diarrhoea for more than 6 hours',
  'Muscle cramps, tremor or tingling',
  'Severe pain in your belly or side',
  'A hot, swollen joint',
];

/* ============================================================================
   Settings › Safety
   ============================================================================ */

export const SETTINGS_SAFETY = {
  modeLine: 'Mode',
  notAnswered: "You haven't answered the safety questions yet.",
  answer: 'Answer the questions',
  review: 'Review my answers',
  support: 'Support, any time',
  limitsLink: 'Safety & limits',
  turnOffTitle: (what: string) => `Turn off ${what}?`,
  turnOffBody: 'Your new answers make Vitals less restrictive. Plans may then include more restriction than before.',
  turnOffKeep: 'Keep it on',
  turnOffConfirm: 'Turn it off',
  saved: 'Your safety settings are updated.',
} as const;

export const LIFTED_NAME = {
  BLOCK_APP: 'the adults-only block',
  BLOCK_PLANNER: 'Simulator-only mode',
  R1: 'gentle mode',
  R2: 'clinician-first mode',
} as const;

/* ============================================================================
   Safety & limits page (dossier §4.6 full disclaimer, edited)
   ============================================================================ */

export const LIMITS_PAGE = {
  title: 'Safety & limits',
  documentTitle: 'Safety & limits',
  intro: 'What Vitals is, what it is not, and the limits it plans within.',
  fullTitle: 'Important information and limits',
  // REVIEW: counsel — the whole page (intended use, exclusions, regulatory positioning; dossier §4.6, §10 item 9).
  sections: [
    {
      id: 'what',
      title: 'What Vitals is',
      paragraphs: [
        'Vitals is an educational tool. It uses published research to estimate how body weight, body composition and related measures may change for an average person with the inputs you give, under a plan of eating, fasting and exercise.',
        'The Planner suggests plans that stay inside safety limits drawn from clinical guidelines and studies.',
      ],
    },
    {
      id: 'not',
      title: 'What it is not',
      paragraphs: [
        "Vitals is not a medical device. It doesn't diagnose, treat, cure or prevent any disease, including obesity or eating disorders. It can't replace advice from a doctor, registered dietitian or other qualified professional, and it doesn't know your health history.",
      ],
    },
    {
      id: 'who',
      title: 'Who it is for',
      paragraphs: [
        "Adults 18 and over without conditions that need medical supervision. Vitals isn't designed for anyone who is pregnant or breastfeeding, has had an eating disorder, takes medicine that lowers blood sugar, or has heart, kidney or liver disease. For many other conditions and medicines, check with a clinician first.",
        'When your answers to the safety questions suggest extra care, the Planner suggests less, or nothing, and the Simulator flags more.',
      ],
    },
    {
      id: 'reading',
      title: 'How to read the projections',
      paragraphs: [
        'Projections are model estimates for an average person, not predictions for you. Real results vary widely, in both directions, with genetics, sleep, illness, medicines, how closely a plan is followed, and errors in the numbers you enter.',
        'Every curve carries an evidence grade from A (strong human evidence) to D (expert opinion or animal data); grade C and D curves are exploratory. Blood-marker and autophagy curves are model trends, not laboratory results, and cannot diagnose or rule out anything.',
      ],
    },
  ],
  limitsTitle: 'Safety limits for plans',
  limitsLead: 'The Planner never suggests a plan outside these limits. The Simulator can show riskier scenarios, and labels them clearly. The limits are conservative guides, not guarantees of safety.',
  // REVIEW: clinician — every number below (dossier §2.2, §2.5; several are PROPOSED engineering judgement).
  limits: [
    { key: 'average energy', value: `at least 1${T}200${T}kcal a day (female model) or 1${T}500${T}kcal (male model), as a 7-day average` },
    { key: 'deficit', value: `up to 25${T}% of maintenance (30${T}% from a BMI of 30; less when leaner, older, or in clinician-first mode)` },
    { key: 'pace', value: `about 0.5–1${T}% of body weight a week, never more than 1.5${T}kg` },
    { key: 'energy after exercise', value: `at least 30${T}kcal per kg of lean mass a day` },
    { key: 'body size', value: 'a deficit starts only at a BMI of 20 or above, and never projects below 19' },
    { key: 'fasting', value: 'up to 24 hours by default; 24–72 hours only if you turn it on; never longer than 72 hours' },
    { key: 'very-low-energy days', value: `none under 800${T}kcal` },
    { key: 'protein', value: `at least 0.8${T}g per kg a day, 1.2${T}g in a deficit or from 65` },
  ],
  sexNote: 'Female and male here mean the setting of the physiological model, not an identity.',
  stopTitle: 'Stop and get help',
  stopBody: 'If eating, weight or exercise feels out of control or distressing, please contact a health professional or a helpline. You deserve care at any weight.',
  dataTitle: 'Your data',
  // REVIEW: counsel — privacy statements (dossier §4.7; hosting logs are a separate processing to disclose).
  data: [
    "Everything you enter is processed in this browser. Vitals doesn't send it to a server: there is no account, no analytics and no cookies.",
    "It stays in this browser's storage until you delete it in Settings › Your data › Reset everything. On a shared device, anyone using this browser can see it.",
    'The website host keeps standard connection logs (such as IP addresses) when the page loads. It never receives what you enter.',
  ],
  modeTitle: 'Your safety mode',
  changesTitle: 'Evidence and changes',
  changes: 'Every curve links to its sources and evidence grade in the Evidence library. Guidance changes; this page was last reviewed on',
  evidenceLink: 'Evidence library',
} as const;
