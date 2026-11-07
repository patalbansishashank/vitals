/**
 * (0.6.7 AD-VITALS) The server's `detect/2` episode labels in Vitals' terms (contract §3, sol §3 "Owner-facing wording"):
 * the catalogue type a label suggests (none for a `possible_*` label: the person chooses), the type choices the review
 * offers, and the words. Pure: no store, no clock.
 *
 * A detection is evidence that something happened, never an activity by itself: it is reviewed like every other candidate
 * and books nothing until approved (D8). The level and scores are ranking heuristics, never shown as numbers.
 */
import { UNKNOWN_ACTIVITY_ID } from '@/content/catalogues/activityTypes';

/** The known labels (contract §2); any other label reads as a possible workout. */
export type DetectionLabel =
  | 'walk'
  | 'walk_possibly_treadmill'
  | 'treadmill_walk'
  | 'run'
  | 'treadmill_run'
  | 'cycling'
  | 'possible_cycling'
  | 'possible_workout'
  | 'possible_strength';

interface LabelInfo {
  /** The catalogue type suggested; null = no preselected type (approval needs the person's choice). */
  exerciseId: string | null;
  /** "Possible treadmill walk", "Walk detected". */
  title: string;
  /** The live line's verb while the episode is open: "Walking now". */
  live: string;
  /** Catalogue types offered beside the suggestion (most likely first). */
  alternatives: readonly string[];
}

/** Types offered for an ambiguous episode (sol §3: never preselected from habit alone). */
export const AMBIGUOUS_CHOICES: readonly string[] = ['air_bike', 'stationary_bike', 'strength_general', 'mudgar_two_hand'];

const GAIT_ALTS = ['walk', 'treadmill_walk', 'jog_outdoor', 'treadmill_run'] as const;

const LABELS: Readonly<Record<DetectionLabel, LabelInfo>> = {
  walk: { exerciseId: 'walk', title: 'Walk detected', live: 'Walking now', alternatives: ['treadmill_walk', 'walk_brisk', 'hike'] },
  // (sol §2: missing GPS never establishes a treadmill) the owner's keyboard walk: the treadmill is suggested, walk beside it
  walk_possibly_treadmill: { exerciseId: 'treadmill_walk', title: 'Possible treadmill walk', live: 'Walking now', alternatives: ['walk', 'treadmill_desk_slow'] },
  treadmill_walk: { exerciseId: 'treadmill_walk', title: 'Possible treadmill walk', live: 'Walking now', alternatives: ['walk', 'treadmill_desk_slow', 'treadmill_incline_walk'] },
  run: { exerciseId: 'jog_outdoor', title: 'Run detected', live: 'Running now', alternatives: ['treadmill_run', 'walk_brisk'] },
  treadmill_run: { exerciseId: 'treadmill_run', title: 'Possible treadmill run', live: 'Running now', alternatives: ['jog_outdoor', 'treadmill_walk'] },
  cycling: { exerciseId: 'cycle_outdoor', title: 'Bike ride detected', live: 'Cycling now', alternatives: ['stationary_bike'] },
  possible_cycling: { exerciseId: null, title: 'Possible bike ride', live: 'Moving now', alternatives: ['cycle_outdoor', 'stationary_bike'] },
  possible_workout: { exerciseId: null, title: 'Possible workout', live: 'Active now', alternatives: [] },
  possible_strength: { exerciseId: null, title: 'Possible workout', live: 'Active now', alternatives: ['strength_general', 'mudgar_two_hand'] },
};

const LABEL_TO_EXERCISE: Readonly<Record<string, string>> = {
  walk: 'walk',
  walk_possibly_treadmill: 'treadmill_walk',
  treadmill_walk: 'treadmill_walk',
  run: 'jog_outdoor',
  treadmill_run: 'treadmill_run',
  cycling: 'cycle_outdoor',
  possible_cycling: 'cycle_outdoor',
  possible_strength: 'strength_general',
};

/** A label as one of the known ones (an unknown label is a possible workout). */
export const detectionLabelOf = (label: string): DetectionLabel => (label in LABELS ? (label as DetectionLabel) : 'possible_workout');

/** What a label means: the suggested type (null: the person chooses), its title, its live verb and its alternatives. */
export const detectionLabelInfo = (label: string): LabelInfo => LABELS[detectionLabelOf(label)];

/** Whether approval needs the person to choose a type (a `possible_*` or unknown label). */
export const detectionNeedsType = (label: string): boolean => detectionLabelInfo(label).exerciseId === null;

/**
 * The candidate's suggested catalogue type: the label's type, else the generic placeholder (`other_moderate`), which is
 * never booked as it stands (the review asks for the type, `needsType`).
 */
export const detectionExerciseId = (label: string): string => detectionLabelInfo(label).exerciseId ?? UNKNOWN_ACTIVITY_ID;

/**
 * The type choices of an episode, catalogue ids in order, each once: the suggestion, the server's alternative labels as
 * types, the label's own alternatives, then the ambiguous-workout choices for an episode without a type. ("Not exercise"
 * is the review's Reject, never a type.)
 */
export function detectionChoices(label: string, serverAlternatives: readonly string[] = []): string[] {
  const info = detectionLabelInfo(label);
  const fromServer = serverAlternatives.map((a) => LABEL_TO_EXERCISE[a]).filter((x): x is string => !!x);
  const gait = info.exerciseId !== null && (GAIT_ALTS as readonly string[]).includes(info.exerciseId);
  return [...new Set([...(info.exerciseId ? [info.exerciseId] : []), ...fromServer, ...info.alternatives, ...(gait ? [] : AMBIGUOUS_CHOICES)])];
}

// ------------------------------------------------------------------ words (sol §3 "Owner-facing wording")
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const has = (reasons: readonly string[], ...needles: RegExp[]) => reasons.some((r) => needles.some((n) => n.test(norm(r))));

/** The ring counted few steps while the phone counted many (the keyboard-treadmill pattern). */
// (0.6.7) the server's detect/2 reason codes (packages/companion/src/home/detect/detect.ts), matched exactly first; the
// loose patterns after them keep older or renamed codes readable
const code = (c: string) => new RegExp(`^${c.replace(/_/g, '')}$`);
const RING_FEW = [code('ring_low'), /ring.*(few|low|zero|quiet|disagree|lower)/, /(few|low|zero).*ring/, /phoneringdisagree/, /ringphonedisagree/];
const GPS_MOVED = [code('gps_moving'), /gps.*(speed|moved|moving|walk|run)/, /outdoor/, /speedwalk/, /speedrun/];
const STATIONARY = [code('stationary_location'), /stationary/, /stayedput/, /samplace/];
const MISSING = [code('coverage_gaps'), code('phone_unknown'), code('hr_poor_support'), code('hr_steps_unknown'), /missing/, /gap/, /partial/, /lowcoverage/, /coveragelow/, /unknown(phone|ring|hr)/];

/**
 * The episode's evidence in a sentence or two: "Your phone recorded steady steps while your ring recorded very few." A
 * missing-coverage note follows when the server says part of the window was not observed. Words only (no digits), so
 * quiet mode shows them as they are.
 */
export function detectionReasonText(label: string, reasons: readonly string[] = [], coverage?: { phone?: number }): string {
  const l = detectionLabelOf(label);
  let main: string;
  if (l === 'walk_possibly_treadmill' || l === 'treadmill_walk') {
    main = has(reasons, ...RING_FEW)
      ? 'Your phone recorded steady steps while your ring recorded very few.'
      : l === 'treadmill_walk' || has(reasons, ...STATIONARY)
        ? 'Steady phone steps while your location stayed in one place.'
        : 'Steady phone steps. Indoor or outdoor is unknown.';
  } else if (l === 'walk') main = has(reasons, ...GPS_MOVED) ? 'Steady steps while your location moved at walking speed.' : 'Steady phone steps. Indoor or outdoor is unknown.';
  else if (l === 'run') main = 'Running-pace steps, and your phone recognised running.';
  else if (l === 'treadmill_run') main = 'Running-pace steps while your location stayed in one place.';
  else if (l === 'cycling') main = 'Your phone recognised cycling; recorded movement supports it.';
  else if (l === 'possible_cycling') main = 'Movement at cycling speed with few phone steps. Choose the activity if you were cycling.';
  else if (l === 'possible_strength') main = 'Repeated ring movement and raised heart rate. Was this strength training?';
  else main = 'Heart rate rose with few phone steps. Choose the activity if you were exercising.';
  const gait = l === 'walk' || l === 'walk_possibly_treadmill' || l === 'treadmill_walk' || l === 'run' || l === 'treadmill_run';
  const missing = has(reasons, ...MISSING) || (gait && typeof coverage?.phone === 'number' && coverage.phone < 0.6);
  return missing ? `${main} Some sensor data is missing; the time may need adjusting.` : main;
}

/** The review's promise beside every detected activity. */
export const DETECTION_ONLY_AFTER_APPROVAL = 'Added to your activity log only after approval.';
