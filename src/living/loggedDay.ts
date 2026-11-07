/**
 * `toLoggedDay` (docs/SUITE_SPEC.md §3.4): one calendar day of a living plan as PLANNER_V2's `LoggedDay` — the engine inputs
 * of what was done (`inputs: DayTemplate`), the outcome and credit of every prescribed item, coverage — plus the realised fast
 * event and the day's adherence score. Pure.
 *
 * Rules (2026-10-18 contracts C1–C3, D5-01, D5-05, D6-02, D3-01):
 *  - observed meals replay EXACTLY as logged: reported energy (`MealSpec.energyKcal`), only the known macro grams (an
 *    unknown macro is never a zero), clock hour and event identity. The unobserved rest of a partially logged day is a
 *    separate, named imputed remainder (`LatentRemainder`) on the prescription's unlogged meal slots; it never scales the
 *    observed meals and gets no invented clock (no prescribed slot → it is recorded, not simulated);
 *  - day completeness is only the person's explicit day report (`DayStatusDoc.intake`): meal count, a per-meal `complete`
 *    flag or a confirmed score never make a day complete. `intakeLogged` = some actual intake evidence; `calibrationEligible`
 *    = a complete non-assumed quantitative energy record or a confirmed zero-intake day (the δ estimate's exposure gate);
 *  - food, training and fast marks are behaviour taps: they select replay scenarios (the prescription, a partial or the
 *    habitual day) and adherence credit, never measured intake; a meal's own answer (`marks.meals`) covers that slot only;
 *  - sessions → the logged dose (engine sessions resolved at logging time, else the injected compiler, else the stimulus),
 *    carrying the bout's identity; a usual ("training as usual") session marked not or skipped has no habitual dose, partly
 *    replays an explicit scaled usual dose, an explicit unknown dose stays unknown;
 *  - fasts come from the absolute-time resolution (`resolveFasts`, shared across days): a verified intake ends the
 *    zero-calorie clock wherever it falls, a running fast is censored, the fast's planned length is metadata;
 *  - substances and supplements resolve planned versus actual doses by explicit item identity: a linked log replaces its
 *    planned dose, an explicit extra adds, an unlinked log of a planned ingredient is an unresolved identity (the replay
 *    uses the observed doses only and names the ambiguity); units are validated (invalid pairs never become grams);
 *  - steps logged > prescribed-if-as-planned > habitual; sleep logged > prescribed. "Logged" includes the ring's steps and
 *    main sleep that the Gauge import writes as entries (S1): they count exactly like the person's own logs, the person's
 *    own entry for the same day wins over them (`projectEntries`), a ring night counts the minutes the ring scored as
 *    asleep (`asleepMin`, not the time in bed), and each ring channel is one shared device-bias group
 *    (`deviceBias:gauge:steps`, `deviceBias:gauge:sleep`). Heart rate, HRV, SpO2 and temperature are not read;
 *  - UNKNOWN items (no log, no mark) are never failures: they drop out of the score and, for the replay only, are
 *    simulated at their expected credit E[c] from revealed adherence (energy interpolated toward maintenance, session volume
 *    scaled, a fast kept when E[c] ≥ 0.5), flagged `assumedItems` and as named assumptions.
 */
import { splitBoutSessions } from './boutParts';
import type {
  ActiveDoseSpec,
  DayTemplate,
  ExerciseSession,
  FastEvent,
  MealSpec,
  SubstanceSpec,
} from '@/engine';
import { MAX_MEALS } from '@/engine/types/inputs';
import {
  ADHERENCE_ZERO_DAY_TOLERANCE_KCAL,
  activeExposureFromServing,
  dayIntakeCoverage,
  exposureCalibrationEligible,
  type CausalResolution,
  type ChannelCoverage,
  type ChannelCoverageMap,
  type ExposureId,
  type ExposureQuantity,
  type HistoryAssumptionKind,
  type LatentRemainder,
  type UncertaintyGroup,
} from '@/lib/bodyContracts';
import {
  energyCredit,
  markCredit,
  proteinCredit,
  ratioCredit,
  scoreDay,
  windowCredit,
  type ItemCredit,
} from './adherence';
import { DEFAULT_ROLLOVER_H } from './appDay';
import { addDays, instantToLocal, localToInstant, weekdayOf } from './dates';
import type { EquivalenceFn } from './equivalence';
import {
  fastItemOutcome,
  resolveFasts,
  resolvedForPrescription,
  UNKNOWN_FAST_KEEP_CREDIT,
  type ResolvedFast,
} from './fastIntervals';
import {
  legacyUnknownFields,
  mealExposures,
  polyolsOf,
  readMealIntake,
  sourceOfComponent,
  sumExposures,
  type ExposureSum,
  type MealIntake,
} from '@/lib/nutrientExposure';
import { amountMethodOf, isGaugeEntry } from './logs';
import { drinksOfEthanolG, entryProvenance, mealEnergyKcal, substanceDose } from './occurrence';
import type {
  ItemOutcome,
  LoggedDay,
  PerformedExercise,
  PlanItemType,
  StimulusIntent,
  StimulusVector,
} from './plannerContract';
import type {
  AdherenceScore,
  AmountMethod,
  DayStatusDoc,
  Instant,
  LocalDate,
  LogEntry,
  Mark,
  MarkBlock,
  PrescribedDaySnapshot,
  PrescribedSession,
  SleepQuality,
  WellbeingConcern,
} from './types';

export type SessionCompiler = (
  performed: readonly PerformedExercise[],
  startH: number,
) => ExerciseSession[] | null;

export interface LoggedDayInput {
  date: LocalDate;
  /** Plan start (plan-day index of fast events). */
  planStart: LocalDate;
  tz: string;
  prescription: PrescribedDaySnapshot;
  /** Effective entries of this date (edits and retracts resolved). */
  entries: readonly LogEntry[];
  status?: DayStatusDoc | null;
  /** E[c] of an item type (revealed adherence; prior mean 0.75 when nothing is known). */
  expected: (type: PlanItemType, weekday: number) => number;
  equivalence?: EquivalenceFn;
  intentByItem?: Record<string, StimulusIntent>;
  sessionCompiler?: SessionCompiler;
  /** `benefitRetained` values (E6) by item id; replace the fast credit forms when present. */
  creditOverrides?: Record<string, number>;
  /** The day is over (rolled over or confirmed); otherwise the score is "so far". */
  final: boolean;
  /** (C2/D5-05) Fasts resolved over the whole history (`resolveFasts`); absent: resolved from this day's entries alone. */
  fasts?: readonly ResolvedFast[];
  /** App-day rollover hour (legacy clock records' occurrence); default 4. */
  rolloverH?: number;
  /** Observation horizon when `fasts` is absent (default: the end of the app day). */
  asOf?: Instant;
}

/** (D5-08) A dose the replay imputed (scenario semantics; the outcome status and utility credit are separate facts). */
export interface ImputedDose {
  itemId: string;
  type: PlanItemType;
  /** Fraction of the prescribed dose replayed (energy: the interpolation weight toward the prescription). */
  fraction: number;
  source: 'expectedCredit' | 'markTap';
  semantics: 'utilityCreditScenario';
}

/** An explicit assumption the day's replay relies on (C2). */
export interface DayAssumption {
  kind: HistoryAssumptionKind;
  reasonCode: string;
}

/** Planned and logged doses of one ingredient whose identity could not be resolved (C2: never nearest-time matched). */
export interface IdentityAlternative {
  id: string;
  memberIds: string[];
  candidates: string[];
}

export interface LoggedDayResult {
  loggedDay: LoggedDay;
  score: AdherenceScore;
  /** Realised fast starting on this day (plan-day indices), if any. */
  fast: FastEvent | null;
  /** Items simulated at expected credit (unknown). */
  assumedItems: string[];
  /**
   * (D5-08) Doses the replay imputed from a utility credit or a tap (a scenario input, never a measured fraction): which
   * item, the fraction of the prescribed dose replayed and where it came from. Observed completion stays in the items.
   */
  imputedDoses?: ImputedDose[];
  /** Some actual intake evidence (non-assumed meals, a food mark or a day report). */
  intakeLogged: boolean;
  /** Backfilled day (never scored, never estimated from). */
  assumedDay: boolean;
  // ---- (C1/C2, D5-01) contract additions
  /** Per-channel coverage of the day (absent channel = unknown). */
  coverage: ChannelCoverageMap;
  /** The day may enter an exposure-conditional energy-balance calibration (complete quantitative or confirmed zero). */
  calibrationEligible: boolean;
  /** What was observed, exactly as logged (null = unknown, never zero): energy kcal and protein g of the observed meals. */
  observed: { energyKcal: number | null; proteinG: number | null; meals: number; unknownEnergyMeals: number };
  /** Imputed remainders of the replay (scenario inputs, separate from the observed meals). */
  remainders: LatentRemainder[];
  assumptions: DayAssumption[];
  /** Causal resolution of the replayed inputs (daily-native at best; 'scenario' when anything was assumed). */
  resolution: CausalResolution;
  /** Unresolved planned/actual identities of substances and supplements. */
  alternatives: IdentityAlternative[];
  // ---- (W1) observation contract additions: what was entered, kept apart from completion and from model scores
  /**
   * (D2-06/D8-04/D8-09) Ratings and concern flags exactly as entered that day (null = nothing rated; an unrated day is
   * never a zero or a "fine"). Felt hunger, fullness and craving are not item completion; mood/fatigue are not a model tier.
   */
  observedWellbeing: ObservedWellbeing | null;
  /**
   * (D3-07/D8-04) Exercise energy above rest, the energy-availability numerator term (the energy ledger books incremental
   * cost elsewhere). `netAboveRestKcal` is the day's complete session expenditure: only with complete (or confirmed-zero)
   * exercise coverage and a stated cost on every logged session; null = unknown, never a zero. `knownNetKcal` is the known
   * sum of the logged finite costs (a lower bound of the day's expenditure unless coverage is complete), `coverage` the
   * exercise channel's coverage.
   */
  exercise: {
    netAboveRestKcal: number | null;
    logged: number;
    withCost: number;
    knownNetKcal?: number;
    coverage?: ChannelCoverage;
    /**
     * (energy SPEC §V3.5) The coverage split: every prescribed session has its log (`plannedItemsResolved`); what the
     * sensors saw (`sensorCoverage`: an approved device bout or fused step coverage = 'observed', else 'unknown' — missing
     * sensor data never confirms a zero); what the person attested (the training mark, else null).
     */
    plannedItemsResolved?: boolean;
    sensorCoverage?: 'observed' | 'unknown';
    attestation?: Mark | null;
  };
  /** (D8-06) The observed sleep of the night ending this day (wake date), its asleep hours and the logged episodes. */
  sleep: ObservedDaySleep | null;
  /**
   * (D7-04) Observed active-ingredient exposure of the day by ingredient: the known daily sum, the largest single dose
   * (bolus) and how many events had unknown potency (those add no number; their safety check stays unchecked).
   */
  actives: Readonly<Record<string, ActiveDayExposure>>;
  /** (D6-03) Known nutrient sums of the logged meals with nutrient-specific coverage (a partial sum is a lower bound). */
  nutrients: Readonly<Partial<Record<ExposureId, ExposureSum>>>;
  /** (D6-06) How the logged meal amounts were obtained, counted by component (legacy numbers stay 'unknown', never weighed). */
  amountMethods: Readonly<Partial<Record<AmountMethod, number>>>;
  /** (D6-06/C3) Shared-error groups of the day's meal components (one draw per group, never independent per entry). */
  uncertaintyGroups: UncertaintyGroup[];
}

/** (D2-06) The rating scales a subjective entry may carry (each its own construct; none is item completion). */
export type WellbeingScale =
  'hunger' | 'fullness' | 'craving' | 'mood' | 'energy' | 'fatigue' | 'restfulness';
const WELLBEING_SCALES: readonly WellbeingScale[] = [
  'hunger',
  'fullness',
  'craving',
  'mood',
  'energy',
  'fatigue',
  'restfulness',
];

/**
 * (D2-06) One entered rating with its own identity: the value, the clock hour the SAME entry stated (absent = untimed,
 * never borrowed from another entry) and the entry it came from. `recordedAt` only orders edits; it is never a rating time.
 */
export interface WellbeingObservation {
  scale: WellbeingScale;
  value: number;
  clockH?: number;
  entryId: string;
}

/** (D2-06/D8-09) One day's entered ratings (0–10) and concern flags; absent fields were not rated. */
export interface ObservedWellbeing {
  hunger?: number;
  fullness?: number;
  craving?: number;
  /**
   * Clock hour of the latest HUNGER rating, from the same entry that supplied it (cleared when that entry is untimed; a
   * fullness- or craving-only entry never moves it). Per-scale times are in `observations`.
   */
  ratedAtClockH?: number;
  mood?: number;
  energy?: number;
  fatigue?: number;
  restfulness?: number;
  concerns: WellbeingConcern[];
  /** Ids of the subjective entries the values came from. */
  entryIds: string[];
  /**
   * (D2-06) Every valid rating of the day as its own observation (value + own clock + entry), in entry order: the latest
   * per scale above is a display summary; calibration reads these (two hunger ratings at 09:00 and 20:00 stay two).
   */
  observations?: WellbeingObservation[];
}

/** (D8-06) A day's observed sleep: the main episode ending on the wake date and the merged asleep time of every episode. */
export interface ObservedDaySleep {
  /** Asleep hours of the union of the day's episodes (overlaps counted once; never decremented by a model). */
  hours: number;
  main: {
    bedAt: Instant;
    wakeAt: Instant;
    quality?: SleepQuality;
    restfulness?: number;
    entryId: string;
  } | null;
  episodes: number;
  /** (D8-06/A1-053) Every valid episode as logged (main first, then by bed time), quality only when entered. */
  list?: Array<{
    bedAt: Instant;
    wakeAt: Instant;
    kind: 'main' | 'nap';
    quality?: SleepQuality;
    restfulness?: number;
    entryId: string;
  }>;
}

/** (D7-04) Observed exposure of one active ingredient on one day. */
export interface ActiveDayExposure {
  unit: string;
  /** Sum of the events with a known amount (a lower bound when `unknownEvents` > 0). */
  knownDaily: number;
  /** Largest single known dose (bolus/peak), never a daily average. */
  peakBolus: number;
  events: number;
  unknownEvents: number;
}

/**
 * Version of the day reduction's W1 observation semantics (C7: recorded with derived artifacts). 3 (re-audit W0/W1): every
 * sleep episode and the known total asleep hours travel apart from the main timing (A1-053); exercise expenditure carries
 * its channel coverage and known sum (A1-057); ratings keep their own clock and entry (A1-055); creatine comes from the
 * canonical label active (A1-032); polyols keep their identities (A1-031); an unknown hard-set count stays unknown (A1-022).
 */
export const LOGGED_DAY_SEMANTICS_VERSION = 3;

const LOAD_PCT: Record<StimulusVector['loadClass'], number> = {
  heavy: 85,
  moderate: 70,
  light: 50,
  veryLight: 30,
};

/**
 * Engine sessions from a stimulus vector (fallback when no catalogue compiler is wired): the frozen set groups when the
 * vector carries them (drawn factors re-apply per group), else the effective sets by region. (D3-09/A1-022) The vector's
 * dose status travels with the resistance session: an unknown hard-set count is the named legacy minute-conversion
 * scenario, never a reported dose.
 */
export function stimulusToEngineSessions(
  stim: StimulusVector,
  startH: number,
  durationMin?: number,
): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  const sets = Object.values(stim.effectiveSetsByRegion).reduce<number>((a, b) => a + (b ?? 0), 0);
  const groups = stim.setGroups && stim.setGroups.length > 0 ? stim.setGroups : null;
  const status = stimulusDoseStatus(stim);
  const dose = status
    ? {
        doseStatus: status,
        ...(status === 'unknown'
          ? { unknownDoseScenario: stim.unknownDoseScenario ?? ('legacyMinuteConversion' as const) }
          : {}),
      }
    : {};
  let t = startH;
  if (groups || sets > 0) {
    const physical = groups ? groups.reduce((a, g) => a + (Number.isFinite(g.sets) ? g.sets : 0), 0) : sets;
    const minutes = Math.max(10, Math.round(physical * 2.5));
    out.push(
      groups
        ? { kind: 'resistance', startH: t, durationMin: minutes, groups, ...dose }
        : {
            kind: 'resistance',
            startH: t,
            durationMin: minutes,
            setsByRegion: { ...stim.effectiveSetsByRegion },
            loadPct1RM: LOAD_PCT[stim.loadClass] ?? 70,
            ...dose,
          },
    );
    t += minutes / 60;
  }
  const cardioMin = stim.mem > 0 ? stim.mem : 0;
  if (cardioMin > 0)
    out.push({
      kind: 'cardio',
      modality: 'other',
      startH: t,
      durationMin: cardioMin,
      pctVo2max: stim.hiMinutes > cardioMin / 2 ? 0.85 : 0.6,
    });
  if (out.length === 0 && durationMin && durationMin > 0)
    out.push({ kind: 'cardio', modality: 'other', startH, durationMin, pctVo2max: 0.5 });
  return out;
}

const VOLUME_LADDER = ['minimal', 'light', 'moderate', 'high', 'veryHigh'] as const;

/**
 * Scale an engine session's dose by a credit (expected or partial): cardio minutes, resistance sets (set groups' physical
 * sets, else region sets, else, for a volume preset, the preset one step lower per 25 % missing) and duration. Null when
 * nothing is left. The bout identity is kept.
 */
export function scaleSession(s: ExerciseSession, f: number): ExerciseSession | null {
  if (!(f > 0.01)) return null;
  if (f >= 0.999) return s;
  if (s.kind === 'cardio') return { ...s, durationMin: s.durationMin * f };
  const out: ExerciseSession = {
    ...s,
    ...(s.durationMin !== undefined ? { durationMin: s.durationMin * f } : {}),
  };
  if (s.groups && s.groups.length > 0)
    return { ...out, groups: s.groups.map((g) => ({ ...g, sets: g.sets * f })) };
  if (s.setsByRegion) {
    const sets: Partial<Record<keyof NonNullable<typeof s.setsByRegion>, number>> = {};
    for (const [r, v] of Object.entries(s.setsByRegion) as Array<
      [keyof NonNullable<typeof s.setsByRegion>, number | undefined]
    >)
      sets[r] = (v ?? 0) * f;
    return { ...out, setsByRegion: sets };
  }
  const idx = VOLUME_LADDER.indexOf(s.volume ?? 'moderate');
  const down = Math.min(idx, Math.round((1 - f) / 0.25));
  return { ...out, volume: VOLUME_LADDER[Math.max(0, idx - down)]! };
}

/** The bout an engine session belongs to: its `boutId`, else its session id without a part suffix (`#m1`). */
const boutKeyOf = (s: ExerciseSession, k: number): string =>
  s.boutId ?? (s.sessionId ? s.sessionId.replace(/#m\d+$/, '') : `#${k}`);

/**
 * (0.6.5, owner: "make sure activities don't overlap") A day's engine sessions with every minute counted once: walking
 * them in start order, a session loses the minutes an EARLIER-starting other bout already covers (the rule Heart Points
 * use, FX2). What it keeps is its own moving parts (`splitBoutSessions`): its dose, realised energy and included steps
 * scale by the share of minutes kept and EPOC is booked over the kept minutes. Sessions of one bout (a circuit's cardio
 * and resistance parts, a bout split at its pauses) never clip each other. A session left with under half a minute is
 * dropped. Sessions without minutes (a dose with no duration) are kept as they are. Pure; `startH` in app-clock hours.
 */
export function withoutOverlaps(sessions: readonly ExerciseSession[]): ExerciseSession[] {
  const order = sessions.map((s, k) => ({ s, k })).sort((a, b) => a.s.startH - b.s.startH || a.k - b.k);
  const covered: Array<{ bout: string; a: number; b: number }> = [];
  const out: ExerciseSession[] = [];
  for (const { s, k } of order) {
    const bout = boutKeyOf(s, k);
    const dur = s.durationMin ?? 0;
    if (!(dur > 0)) {
      out.push(s);
      continue;
    }
    const a = s.startH * 60;
    const b = a + dur;
    // the minutes of [a, b) other bouts already hold, merged
    const cuts = covered
      .filter((c) => c.bout !== bout && c.b > a && c.a < b)
      .map((c) => [Math.max(a, c.a), Math.min(b, c.b)] as const)
      .sort((x, y) => x[0] - y[0]);
    const kept: Array<{ startH: number; durationMin: number }> = [];
    let t = a;
    for (const [ca, cb] of cuts) {
      if (ca > t) kept.push({ startH: t / 60, durationMin: ca - t });
      t = Math.max(t, cb);
    }
    if (b > t) kept.push({ startH: t / 60, durationMin: b - t });
    covered.push({ bout, a, b });
    const keptMin = kept.reduce((x, p) => x + p.durationMin, 0);
    if (cuts.length === 0) {
      out.push(s);
      continue;
    }
    if (keptMin < 0.5) continue;
    const f = keptMin / dur;
    // the dose and the realised energy and steps for the minutes kept, then laid onto those minutes
    const scaled = scaleSession(s, f) ?? s;
    const share: ExerciseSession = {
      ...scaled,
      durationMin: keptMin,
      ...(s.realisedGrossKcal !== undefined ? { realisedGrossKcal: s.realisedGrossKcal * f } : {}),
      ...(s.kind === 'cardio' && s.stepsIncluded !== undefined
        ? { stepsIncluded: Math.round(s.stepsIncluded * f) }
        : {}),
    } as ExerciseSession;
    out.push(...splitBoutSessions([share], kept));
  }
  return out.sort((x, y) => x.startH - y.startH);
}

function itemTypeOfSession(s: PrescribedSession): PlanItemType {
  return s.kind === 'resistance' ? 'rtSession' : 'cardioSession';
}

/**
 * (D3-09/A1-022) Completion status of a session equivalence: the scorer's own `completion` when it reports one, else read
 * from the vectors — a weighted hypertrophy/strength term whose prescribed or performed hard-set count is unknown is an
 * unknown term (its ratio is only the named legacy minute-conversion scenario). `knownTermsScore` = the weighted score of
 * the independently known terms (null when none); with every term known it is the plain score.
 */
export interface DoseCompletion {
  status: 'known' | 'partial' | 'unknown';
  unknownTerms: string[];
  knownTermsScore: number | null;
  scenario?: 'legacyMinuteConversion';
}
export function doseCompletionOf(
  r: {
    score?: number;
    credit: number;
    perTerm?: ReadonlyArray<{ term: string; ratio: number; weight: number; status?: 'known' | 'unknown' }>;
    completion?: {
      status: DoseCompletion['status'];
      unknownTerms?: readonly string[];
      knownTermsScore?: number | null;
      scenario?: 'legacyMinuteConversion';
    };
  },
  prescribed: StimulusVector | null,
  performed: StimulusVector,
): DoseCompletion {
  // the scorer's own verdict (`EquivalenceResult.completion`, the one published shape); without it, read from the terms
  const c = r.completion;
  if (c)
    return {
      status: c.status,
      unknownTerms: [...(c.unknownTerms ?? [])],
      knownTermsScore: c.knownTermsScore ?? null,
      ...(c.scenario ? { scenario: c.scenario } : {}),
    };
  const muscle = (v: StimulusVector | null, term: string): boolean => {
    if (!v || (term !== 'hyp' && term !== 'str')) return false;
    const o = v.outcomeDoseStatus?.[term === 'hyp' ? 'hypertrophy' : 'strength'];
    return o === 'unknown' || (o === undefined && v.doseStatus === 'unknown');
  };
  const terms = (r.perTerm ?? []).filter((t) => t.weight > 0);
  const unknown = terms.filter(
    (t) => t.status === 'unknown' || muscle(prescribed, t.term) || muscle(performed, t.term),
  );
  if (unknown.length === 0)
    return { status: 'known', unknownTerms: [], knownTermsScore: r.score ?? r.credit };
  const known = terms.filter((t) => !unknown.includes(t));
  const w = known.reduce((a, t) => a + t.weight, 0);
  const knownTermsScore =
    w > 0 ? Math.min(1, Math.max(0, known.reduce((a, t) => a + t.ratio * t.weight, 0) / w)) : null;
  return {
    status: known.length === 0 ? 'unknown' : 'partial',
    unknownTerms: unknown.map((t) => t.term),
    knownTermsScore,
    scenario: 'legacyMinuteConversion',
  };
}

/** (D3-09/A1-022) Dose status of a stimulus vector's muscle dose: the hypertrophy/strength outcome status, else the vector's. */
function stimulusDoseStatus(
  stim: StimulusVector | undefined,
): 'reported' | 'inferred' | 'default' | 'unknown' | undefined {
  if (!stim) return undefined;
  const o = stim.outcomeDoseStatus;
  if (o?.hypertrophy === 'unknown' || o?.strength === 'unknown') return 'unknown';
  return stim.doseStatus;
}

/** Give engine sessions a bout identity (a log entry or a prescription slot) when they have none (D3-01). */
const withSessionId = (sessions: readonly ExerciseSession[], id: string): ExerciseSession[] =>
  sessions.map((s, k) => (s.sessionId ? s : { ...s, sessionId: sessions.length > 1 ? `${id}#${k}` : id }));

type Meal = Extract<LogEntry, { kind: 'meal' }>;
type MacroKey = 'proteinG' | 'carbG' | 'fatG' | 'fibreG' | 'alcoholG';

/** The exposure provider's reading of a stored meal (C3/D6-02), memoised per immutable entry. */
const intakeMemo = new WeakMap<Meal, MealIntake>();
function intakeOf(m: Meal): MealIntake {
  let r = intakeMemo.get(m);
  if (!r) {
    r = readMealIntake({ ...m, components: m.components ?? [] });
    intakeMemo.set(m, r);
  }
  return r;
}

/**
 * The macro grams a meal actually knows, read through the provider (listed unknowns and absent fields are left out, never
 * zero; a legacy kcal-only entry's placeholder zeros read as unknown — D6-02 read adapter, the stored record is untouched).
 */
function knownMacros(m: Meal): Partial<Record<MacroKey, number>> {
  return intakeOf(m).macros;
}

const macroKnown = (m: Meal, k: MacroKey): boolean => knownMacros(m)[k] !== undefined;

/**
 * Normalised exposures of a stored meal (C3/D6-03): the provider's snapshot when the entry carries one, else read from its
 * components (or, for a totals-only entry, its totals) with the provider's legacy reading (stored placeholder zeros of a
 * typed kcal-only entry are unknown, never 0 g). Memoised per immutable entry.
 */
const exposureMemo = new WeakMap<Meal, readonly ExposureQuantity[]>();
function exposuresOf(m: Meal): readonly ExposureQuantity[] {
  let r = exposureMemo.get(m);
  if (r) return r;
  if (m.exposures && m.exposures.length > 0) r = m.exposures;
  else {
    const method = m.source?.method;
    const legacy = (c: {
      nutrients: Meal['totals'];
      nutrientSource: 'table' | 'label' | 'user' | 'model';
    }): Meal['totals'] => {
      const extra = m.energy ? [] : legacyUnknownOf(c);
      return extra.length
        ? { ...c.nutrients, unknown: [...new Set([...(c.nutrients.unknown ?? []), ...extra])] }
        : c.nutrients;
    };
    const comps =
      (m.components ?? []).length > 0
        ? m.components.map((c) => ({ nutrients: legacy(c), source: sourceOfComponent(c, method) }))
        : [
            {
              nutrients: legacy({ nutrients: m.totals, nutrientSource: 'user' }),
              source: method === 'asPlanned' ? ('asPlanned' as const) : ('user' as const),
            },
          ];
    r = mealExposures(comps, { ...(method ? { method } : {}), originEventId: m.id });
  }
  exposureMemo.set(m, r);
  return r;
}

/**
 * (D6-01/A1-031) Polyol grams of a stored meal by identity ('unidentified' = an identity-unknown total): the immutable
 * ledger's unmodelled route when it records one, else the components' frozen snapshots read by the shared provider.
 * Null when the meal names no positive polyol mass.
 */
function polyolsOfMeal(m: Meal): Readonly<Record<string, number>> | null {
  const route = m.energy?.substrateRoute;
  if (route?.unmodelledPolyolsG && Object.keys(route.unmodelledPolyolsG).length > 0)
    return route.unmodelledPolyolsG;
  const p = polyolsOf(
    (m.components ?? []).map((c) => ({ grams: c.grams?.value ?? null, snapshot: c.snapshot ?? null })),
  );
  if (!p) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.byIdentity)) if (Number.isFinite(v) && v > 0) out[k] = v;
  return Object.keys(out).length > 0 ? out : null;
}

/** Legacy placeholder-zero fields of a typed component (the provider's D6-02 read rule). */
function legacyUnknownOf(c: {
  nutrients: Meal['totals'];
  nutrientSource: 'table' | 'label' | 'user' | 'model';
}): NonNullable<Meal['totals']['unknown']> {
  return legacyUnknownFields(c) as NonNullable<Meal['totals']['unknown']>;
}

/**
 * (D8-06) A day's observed sleep from its sleep entries (all dated by their wake date): asleep hours of the union of the
 * episodes' [bed, wake) instants (an overlap or a duplicate counts once), and the main episode — the longest one not marked
 * a nap (ties: lowest id). Null when no entry has a valid interval. Pure.
 */
export function observedSleep(
  logs: ReadonlyArray<Extract<LogEntry, { kind: 'sleep' }>>,
): ObservedDaySleep | null {
  const eps = logs
    .map((e) => ({ e, a: Date.parse(e.bedAt), b: Date.parse(e.wakeAt) }))
    .filter((x) => Number.isFinite(x.a) && Number.isFinite(x.b) && x.b > x.a);
  if (eps.length === 0) return null;
  const sorted = [...eps].sort((x, y) => x.a - y.a || x.b - y.b);
  let total = 0;
  let curA = sorted[0]!.a;
  let curB = sorted[0]!.b;
  for (const x of sorted.slice(1)) {
    if (x.a <= curB) curB = Math.max(curB, x.b);
    else {
      total += curB - curA;
      curA = x.a;
      curB = x.b;
    }
  }
  total += curB - curA;
  // (S1 import) a ring episode knows its minutes asleep: its awake minutes in bed leave the total (once per episode)
  for (const x of eps) {
    const m = x.e.asleepMin;
    if (m !== undefined && Number.isFinite(m) && m > 0) total -= Math.max(0, x.b - x.a - m * 60_000);
  }
  total = Math.max(0, total);
  const main = eps
    .filter((x) => x.e.episodeKind !== 'nap')
    .sort((x, y) => y.b - y.a - (x.b - x.a) || (x.e.id < y.e.id ? -1 : x.e.id > y.e.id ? 1 : 0))[0];
  const ordered = [...(main ? [main] : []), ...sorted.filter((x) => x !== main)];
  return {
    hours: total / 3_600_000,
    main: main
      ? {
          bedAt: main.e.bedAt,
          wakeAt: main.e.wakeAt,
          entryId: main.e.id,
          ...(main.e.quality ? { quality: main.e.quality } : {}),
          ...(main.e.restfulness !== undefined ? { restfulness: main.e.restfulness } : {}),
        }
      : null,
    episodes: eps.length,
    list: ordered.map((x) => ({
      bedAt: x.e.bedAt,
      wakeAt: x.e.wakeAt,
      kind: x === main ? ('main' as const) : ('nap' as const),
      entryId: x.e.id,
      ...(x.e.quality ? { quality: x.e.quality } : {}),
      ...(x.e.restfulness !== undefined ? { restfulness: x.e.restfulness } : {}),
    })),
  };
}

/** (D2-06/D8-09) The day's ratings and concern flags as entered (latest entry wins per field; flags accumulate). */
export function observedWellbeingOf(entries: readonly LogEntry[]): ObservedWellbeing | null {
  const subj = entries
    .filter((e): e is Extract<LogEntry, { kind: 'subjective' }> => e.kind === 'subjective' && !e.assumed)
    .sort((a, b) =>
      (a.recordedAt ?? a.at ?? '') < (b.recordedAt ?? b.at ?? '')
        ? -1
        : (a.recordedAt ?? a.at ?? '') > (b.recordedAt ?? b.at ?? '')
          ? 1
          : a.id < b.id
            ? -1
            : 1,
    );
  if (subj.length === 0) return null;
  const out: ObservedWellbeing = { concerns: [], entryIds: [], observations: [] };
  const rating = (v: number | undefined): number | undefined =>
    v !== undefined && Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : undefined;
  const concerns = new Set<WellbeingConcern>();
  for (const e of subj) {
    out.entryIds.push(e.id);
    // the entry's own clock (valid hours [0, 24) only): it belongs to the ratings THIS entry carries, nothing else
    const clockH =
      e.ratedAtClockH !== undefined &&
      Number.isFinite(e.ratedAtClockH) &&
      e.ratedAtClockH >= 0 &&
      e.ratedAtClockH < 24
        ? e.ratedAtClockH
        : undefined;
    for (const k of WELLBEING_SCALES) {
      const v = rating(e[k]);
      if (v === undefined) continue;
      out[k] = v;
      out.observations!.push({
        scale: k,
        value: v,
        ...(clockH !== undefined ? { clockH } : {}),
        entryId: e.id,
      });
      if (k === 'hunger') {
        if (clockH !== undefined) out.ratedAtClockH = clockH;
        else delete out.ratedAtClockH;
      }
    }
    for (const c of e.concerns ?? []) concerns.add(c);
  }
  out.concerns = [...concerns].sort();
  return out;
}

/**
 * (D7-04) Observed active exposures of one supplement log: the entry's stored exposures, else the label arithmetic of its
 * product snapshot (servings × label actives, unit-checked). A log without a product or with unknown potency yields
 * `value: null` quantities (valid record, safety unchecked) — never a catalogue standard potency.
 */
export function supplementExposures(
  e: Extract<LogEntry, { kind: 'supplement' }>,
): readonly ExposureQuantity[] {
  if (e.exposures && e.exposures.length > 0) return e.exposures;
  if (!e.product) return [];
  const recorded =
    e.servings !== undefined && e.product.servingAmount !== null && Number.isFinite(e.servings)
      ? { amount: e.servings * e.product.servingAmount, unit: e.product.servingUnit }
      : { amount: e.dose, unit: e.unit };
  return activeExposureFromServing(recorded, e.product, {
    originEventId: e.id,
    ...(e.occurrence ? { occurrence: e.occurrence } : {}),
  });
}

const ACTIVE_UNITS: ReadonlySet<string> = new Set(['g', 'mg', 'ug', 'mmol']);

const GROUP_KINDS: ReadonlySet<UncertaintyGroup['kind']> = new Set([
  'portionMass',
  'sourceComposition',
  'batchYield',
  'retainedOil',
  'reportingBias',
  'occurrenceTime',
  'deviceBias',
  'identityAmbiguity',
]);
/** Kind of a shared-error group from its id prefix (`portionMass:…`, `sourceComposition:…`); unknown prefixes are composition. */
function groupKindOf(id: string): UncertaintyGroup['kind'] {
  const k = id.split(':')[0] as UncertaintyGroup['kind'];
  return GROUP_KINDS.has(k) ? k : 'sourceComposition';
}

/** Energy of a replay energy spec interpolated toward maintenance at credit c (an unknown or partly-followed day). */
function energyAtCredit(e: DayTemplate['energy'], c: number, maint: number): DayTemplate['energy'] {
  if (e.kind === 'pctMaintenance') return { ...e, pct: 100 + c * (e.pct - 100) };
  if (e.kind === 'kcal') return { kind: 'kcal', kcal: maint + c * (e.kcal - maint) };
  return c < 0.5 ? { kind: 'pctMaintenance', pct: 100, reference: 'current' } : e;
}

/** Planned id of a substance/supplement record's link (absent = unlinked). */
function linkOf(e: LogEntry): string | undefined {
  const raw = e.link?.itemId ?? e.itemId;
  if (!raw) return undefined;
  if (e.kind === 'supplement' && !raw.includes(':')) return `supplement:${raw}`;
  return raw;
}

export function toLoggedDay(i: LoggedDayInput): LoggedDayResult {
  const rx = i.prescription;
  const wd = weekdayOf(i.date);
  const status = i.status ?? null;
  const rolloverH = i.rolloverH ?? DEFAULT_ROLLOVER_H;
  const assumedDay = status?.assumed === true || (i.entries.length > 0 && i.entries.every((e) => e.assumed));
  const marks = status?.marks ?? {};
  const markFor = (b: Exclude<MarkBlock, 'all'>): Mark | undefined => marks[b] ?? marks.all;
  const credits: ItemCredit[] = [];
  const outcomes = new Map<string, ItemOutcome>();
  const assumedItems: string[] = [];
  const imputedDoses: ImputedDose[] = [];
  const impute = (
    itemId: string,
    type: PlanItemType,
    fraction: number,
    source: ImputedDose['source'],
  ): void => {
    if (Number.isFinite(fraction))
      imputedDoses.push({ itemId, type, fraction, source, semantics: 'utilityCreditScenario' });
  };
  const assumptions: DayAssumption[] = [];
  const remainders: LatentRemainder[] = [];
  const alternatives: IdentityAlternative[] = [];
  const assume = (kind: HistoryAssumptionKind, reasonCode: string): void => {
    if (!assumptions.some((a) => a.kind === kind && a.reasonCode === reasonCode))
      assumptions.push({ kind, reasonCode });
  };
  const itemOf = (id: string) => rx.items.find((x) => x.itemId === id);
  const setItem = (
    itemId: string,
    type: PlanItemType,
    status: ItemOutcome['status'],
    credit: number | null,
    why: string,
    performed?: StimulusVector,
  ): void => {
    if (!itemOf(itemId)) return;
    credits.push({ itemId, credit, why });
    outcomes.set(itemId, { itemId, type, status, credit, ...(performed ? { performed } : {}) });
  };
  const statusOf = (c: number): ItemOutcome['status'] =>
    c >= 0.999 ? 'done' : c <= 0.001 ? 'skipped' : 'partial';
  const t: DayTemplate = { ...rx.template, label: 'as logged' };

  // ------------------------------------------------------------------ intake (D5-01, D6-02)
  const meals = i.entries.filter((e): e is Meal => e.kind === 'meal');
  const quantified = meals.filter((m) => !m.assumed);
  const attestation = status?.intake;
  const foodMark = markFor('food');
  const mealMarks = marks.meals ?? {};
  const maint = Number.isFinite(rx.maintenanceKcal) ? rx.maintenanceKcal : rx.energyKcal;
  const eTarget = itemOf('energy')?.target.energyKcal ?? rx.energyKcal;
  const pTarget = itemOf('protein')?.target.proteinG ?? rx.macros.proteinG;
  const energyOf = (m: Meal): number | null => mealEnergyKcal(m);
  const unknownEnergyMeals = meals.filter((m) => energyOf(m) === null).length;
  const observedKcal = meals.reduce((s, m) => s + (energyOf(m) ?? 0), 0);
  const observedProtein = meals.every((m) => macroKnown(m, 'proteinG'))
    ? meals.reduce((s, m) => s + (knownMacros(m).proteinG ?? 0), 0)
    : null;
  const complete = attestation === 'complete' && quantified.length > 0;
  const confirmedZero = attestation === 'none' && meals.length === 0;
  const answeredSlots = Object.keys(mealMarks);
  let energyCoverage: ChannelCoverage = assumedDay
    ? 'asPlannedEstimate'
    : dayIntakeCoverage({
        attestation,
        quantifiedIntakeEvents: quantified.length,
        asPlannedTaps: (foodMark ? 1 : 0) + answeredSlots.length + (meals.length - quantified.length),
      });
  if (energyCoverage === 'complete' && unknownEnergyMeals > 0) energyCoverage = 'partial';
  let intakeLogged = false;
  if (meals.length > 0 || answeredSlots.length > 0) {
    intakeLogged = quantified.length > 0 || answeredSlots.length > 0 || foodMark !== undefined;
    // observed meals, exactly as logged
    const observedSpecs: MealSpec[] = meals
      .slice()
      .sort((a, b) => a.clockH - b.clockH)
      .map((m) => {
        const kcal = energyOf(m);
        const intake = intakeOf(m);
        const macros = intake.macros;
        const residual = intake.residualKind === 'none' ? undefined : intake.residualKind;
        const conv =
          4 * (macros.proteinG ?? 0) +
          4 * (macros.carbG ?? 0) +
          9 * (macros.fatG ?? 0) +
          2 * (macros.fibreG ?? 0) +
          7 * (macros.alcoholG ?? 0);
        const polyols = polyolsOfMeal(m);
        return {
          clockH: m.clockH,
          share: Math.max(1e-6, kcal ?? conv),
          ...(kcal !== null ? { energyKcal: kcal } : {}),
          macros,
          ...(residual ? { energyResidual: residual } : {}),
          // (D6-01/A1-031) polyols by identity, outside the non-polyol carbohydrate and with their energy inside the
          // reported ME; their substrate route is unmodelled (never a resolved zero, never glucose at 4 kcal/g)
          ...(polyols
            ? {
                polyolsG: polyols,
                polyolBasis: {
                  inPrintedCarb: 'unknown' as const,
                  energyConvention: kcal !== null ? ('insideReportedME' as const) : ('unknown' as const),
                },
              }
            : {}),
          eventId: m.id,
          ...(m.intakeDurationH !== undefined ? { intakeDurationH: m.intakeDurationH } : {}),
          ...(m.form ? { form: m.form } : {}),
          ...(m.carbComposition ? { carbComposition: m.carbComposition } : {}),
        };
      });
    // the unobserved rest of the day: a separate imputed remainder on the prescription's open meal slots
    const remainderSpecs: MealSpec[] = [];
    let remainderKcal = 0;
    if (!complete && !assumedDay) {
      const loggedSlots = new Set(meals.map((m) => m.slot).filter((s): s is string => !!s));
      const dayCredit = foodMark ? markCredit(foodMark) : i.expected('energy', wd);
      const scenario = foodMark ? `foodMark:${foodMark}` : 'expectedCredit';
      const target = foodMark === 'not' ? maint : maint + dayCredit * (rx.energyKcal - maint);
      const answered: Array<{ slot: (typeof rx.meals)[number]; kcal: number }> = [];
      const open: Array<(typeof rx.meals)[number]> = [];
      for (const s of rx.meals) {
        if (loggedSlots.has(s.slot)) continue;
        const own = mealMarks[s.slot];
        if (own) answered.push({ slot: s, kcal: markCredit(own) * s.energyKcal });
        else open.push(s);
      }
      const answeredKcal = answered.reduce((a, x) => a + x.kcal, 0);
      const openPlanned = open.reduce((a, s) => a + s.energyKcal, 0);
      const openKcal =
        open.length > 0 && openPlanned > 0 ? Math.max(0, target - observedKcal - answeredKcal) : 0;
      const pieces: Array<{ slot: (typeof rx.meals)[number]; kcal: number }> = [
        ...answered,
        ...open.map((s) => ({
          slot: s,
          kcal: openPlanned > 0 ? (openKcal * s.energyKcal) / openPlanned : 0,
        })),
      ].filter((p) => p.kcal > 0.5);
      // never more meals than the engine simulates: the remainder then sits on its first slot
      const room = Math.max(1, MAX_MEALS - observedSpecs.length);
      const placed =
        pieces.length > room
          ? [
              {
                slot: pieces.slice().sort((a, b) => a.slot.clockH - b.slot.clockH)[0]!.slot,
                kcal: pieces.reduce((a, p) => a + p.kcal, 0),
                merged: pieces,
              },
            ]
          : pieces.map((p) => ({ ...p, merged: [p] }));
      for (const p of placed) {
        // the imputed grams follow each slot's planned composition at the imputed energy (a scenario, never an observation)
        const planned = p.merged.reduce(
          (a, x) => {
            const f = x.kcal / Math.max(1e-9, x.slot.energyKcal);
            return { pr: a.pr + x.slot.proteinG * f, c: a.c + x.slot.carbG * f, f: a.f + x.slot.fatG * f };
          },
          { pr: 0, c: 0, f: 0 },
        );
        remainderSpecs.push({
          clockH: p.slot.clockH,
          share: Math.max(1e-6, p.kcal),
          energyKcal: p.kcal,
          macros: { proteinG: planned.pr, carbG: planned.c, fatG: planned.f },
        });
        remainderKcal += p.kcal;
      }
      const unplaced = rx.meals.length === 0 ? Math.max(0, target - observedKcal) : 0;
      if (remainderKcal > 0 || unplaced > 0) {
        remainders.push({
          date: i.date,
          channel: 'energy',
          scenario,
          value: remainderKcal > 0 ? remainderKcal : unplaced,
          timing: remainderKcal > 0 ? 'prescribedSlots' : 'unknown',
          provenance: 'imputed',
        });
        assume('remainderImputation', remainderKcal > 0 ? scenario : `${scenario}:unplaced`);
      }
    }
    t.energy = {
      kind: 'kcal',
      kcal: observedSpecs.reduce((a, s) => a + (s.energyKcal ?? s.share ?? 0), 0) + remainderKcal,
    };
    const sum = (k: MacroKey, specs: readonly MealSpec[]): number =>
      specs.reduce((a, s) => a + (s.macros?.[k] ?? 0), 0);
    const all = [...observedSpecs, ...remainderSpecs];
    t.macros = {
      ...rx.template.macros,
      protein: { unit: 'g', value: sum('proteinG', all) },
      carbs: { unit: 'g', value: sum('carbG', all) },
      fat: { unit: 'g', value: sum('fatG', all) },
      fibre: { unit: 'g', value: sum('fibreG', all) },
    };
    t.meals = { meals: all };
    const gi = meals.find((m) => m.glycaemicIndex !== undefined)?.glycaemicIndex;
    const upf = meals.find((m) => m.upfShare !== undefined)?.upfShare;
    if (gi !== undefined || upf !== undefined)
      t.food = {
        ...rx.template.food,
        ...(gi !== undefined ? { glycaemicIndex: gi } : {}),
        ...(upf !== undefined ? { upfShare: upf } : {}),
      };
    if (complete && unknownEnergyMeals === 0) {
      const e = energyCredit(eTarget, observedKcal, maint);
      setItem(
        'energy',
        'energy',
        statusOf(e),
        e,
        `ate ${Math.round(observedKcal)} of ${Math.round(eTarget)} kcal`,
      );
      if (observedProtein !== null) {
        const p = proteinCredit(pTarget, observedProtein);
        setItem(
          'protein',
          'protein',
          statusOf(p),
          p,
          `${Math.round(observedProtein)} of ${Math.round(pTarget)} g protein`,
        );
      } else setItem('protein', 'protein', 'unknown', null, 'protein not logged');
    } else if (foodMark) {
      const c = markCredit(foodMark);
      setItem('energy', 'energy', statusOf(c), c, `food marked ${foodMark}`);
      setItem('protein', 'protein', statusOf(c), c, `food marked ${foodMark}`);
    } else {
      setItem('energy', 'energy', 'unknown', null, 'meals logged so far');
      setItem('protein', 'protein', 'unknown', null, 'meals logged so far');
      assumedItems.push('energy');
    }
    if (rx.window) {
      const c = windowCredit(
        rx.window.startH,
        rx.window.endH,
        meals.map((m) => ({ clockH: m.clockH, kcal: energyOf(m) ?? 0 })),
      );
      setItem('window', 'window', statusOf(c), c, 'meals inside the eating window');
    }
  } else if (confirmedZero) {
    // the person's explicit "nothing eaten": a confirmed zero-intake day (never "skipped")
    intakeLogged = !assumedDay;
    t.energy = { kind: 'zero' };
    const e = energyCredit(eTarget, 0, maint);
    setItem('energy', 'energy', statusOf(e), e, 'nothing eaten');
    setItem(
      'protein',
      'protein',
      statusOf(proteinCredit(pTarget, 0)),
      proteinCredit(pTarget, 0),
      'nothing eaten',
    );
    if (rx.window) setItem('window', 'window', 'done', 1, 'nothing eaten');
  } else if (foodMark) {
    intakeLogged = !assumedDay;
    const c = markCredit(foodMark);
    if (foodMark === 'not') {
      t.energy = { kind: 'pctMaintenance', pct: 100, reference: 'current' };
      t.meals = rx.template.meals;
    } else if (foodMark === 'partly') {
      t.energy = energyAtCredit(rx.template.energy, c, maint);
      impute('energy', 'energy', c, 'markTap');
    }
    assume('asPlannedTap', `foodMark:${foodMark}`);
    setItem('energy', 'energy', statusOf(c), c, `food marked ${foodMark}`);
    setItem('protein', 'protein', statusOf(c), c, `food marked ${foodMark}`);
    if (rx.window) setItem('window', 'window', statusOf(c), c, `food marked ${foodMark}`);
  } else {
    // unknown intake: simulate at expected credit between maintenance and the prescription
    const c = i.expected('energy', wd);
    t.energy = energyAtCredit(rx.template.energy, c, maint);
    impute('energy', 'energy', c, 'expectedCredit');
    setItem('energy', 'energy', 'unknown', null, 'not logged');
    setItem('protein', 'protein', 'unknown', null, 'not logged');
    if (rx.window) setItem('window', 'window', 'unknown', null, 'not logged');
    assumedItems.push('energy', 'protein');
    assume('unknownDayFrozenPrescription', 'energyAtExpectedCredit');
  }

  // ------------------------------------------------------------------ nutrients, amount methods, shared-error groups (D6-03, D6-06)
  const realMeals = meals.filter((m) => !m.assumed);
  const nutrients = sumExposures(realMeals.map(exposuresOf), energyCoverage);
  // observed known nutrients override the prescription's defaults only when the day knows them completely; a partial
  // sum stays a lower bound in `nutrients` and the replay keeps the prescription's (assumed) composition for it
  const fullyKnown = (id: ExposureId): number | null =>
    nutrients[id]?.coverage === 'complete' ? nutrients[id]!.knownSum : null;
  const fatKnown = fullyKnown('fat');
  const satKnown = fullyKnown('satFat');
  if (fatKnown !== null && fatKnown > 0 && satKnown !== null)
    t.macros = {
      ...t.macros,
      fatTypes: { ...t.macros.fatTypes, satShare: Math.min(1, Math.max(0, satKnown / fatKnown)) },
    };
  const carbKnown = fullyKnown('carbAvailable');
  const sugarsKnown = fullyKnown('sugars');
  if (carbKnown !== null && carbKnown > 0 && sugarsKnown !== null)
    t.macros = { ...t.macros, sugarsShare: Math.min(1, Math.max(0, sugarsKnown / carbKnown)) };
  const sodiumKnown = fullyKnown('sodium');
  if (sodiumKnown !== null) t.hydration = { ...t.hydration, sodiumG: sodiumKnown / 1000 };
  const amountMethods: Partial<Record<AmountMethod, number>> = {};
  const groupMembers = new Map<string, string[]>();
  for (const m of realMeals) {
    const comps = m.components ?? [];
    if (comps.length === 0) amountMethods.unknown = (amountMethods.unknown ?? 0) + 1;
    comps.forEach((c, k) => {
      const method = amountMethodOf(c);
      amountMethods[method] = (amountMethods[method] ?? 0) + 1;
      for (const g of c.uncertaintyGroupIds ?? [])
        groupMembers.set(g, [...(groupMembers.get(g) ?? []), `${m.id}#${k}`]);
    });
  }
  const uncertaintyGroups: UncertaintyGroup[] = [...groupMembers.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([id, memberIds]) => ({ id, kind: groupKindOf(id), memberIds }));

  // ------------------------------------------------------------------ sessions (D5-01 usual sessions, D3-01 identity)
  const sessionLogs = i.entries.filter(
    (e): e is Extract<LogEntry, { kind: 'session' }> => e.kind === 'session',
  );
  const usedLogs = new Set<string>();
  const exercise: ExerciseSession[] = [];
  const trainMark = markFor('train');
  let usualExplicit = false;
  let matchedSessions = 0;
  /**
   * (D3-09/A1-022) a logged dose that is inferred, a default or unknown is a named assumption (never reported hard sets):
   * the entry's own status, else the frozen stimulus vector's (an ordinary `log.session` stores it there)
   */
  const noteDose = (log: Extract<LogEntry, { kind: 'session' }>): void => {
    const status = log.doseStatus ?? stimulusDoseStatus(log.stimulus);
    if (status && status !== 'reported') assume('prescriptionReplay', `sessionDose:${status}`);
    if (status === 'unknown')
      assume(
        'prescriptionReplay',
        `unknownDose:${log.stimulus?.unknownDoseScenario ?? 'legacyMinuteConversion'}`,
      );
  };
  /** The engine sessions of a log carry its dose status when the compiled payload does not state one (unknown stays unknown). */
  const withDoseStatus = (
    sessions: readonly ExerciseSession[],
    log: Extract<LogEntry, { kind: 'session' }>,
  ): ExerciseSession[] => {
    const status = log.doseStatus ?? stimulusDoseStatus(log.stimulus);
    if (!status) return [...sessions];
    return sessions.map((x) =>
      x.kind === 'resistance' && x.doseStatus === undefined
        ? {
            ...x,
            doseStatus: status,
            ...(status === 'unknown'
              ? {
                  unknownDoseScenario:
                    log.stimulus?.unknownDoseScenario ?? ('legacyMinuteConversion' as const),
                }
              : {}),
          }
        : x,
    );
  };
  for (const s of rx.sessions) {
    const type = itemTypeOfSession(s);
    const itemId = `${type}:${s.slotKey}`;
    const log = sessionLogs.find(
      (e) =>
        e.itemId === itemId ||
        e.itemId === s.slotKey ||
        e.link?.itemId === itemId ||
        e.link?.itemId === s.slotKey,
    );
    if (log) {
      usedLogs.add(log.id);
      matchedSessions++;
      if (s.usual) usualExplicit = true;
      if (log.status === 'skipped') {
        setItem(itemId, type, 'skipped', 0, 'session skipped');
        continue;
      }
      let credit: number | null;
      let why: string;
      let muscleUnknown = false;
      if (s.stimulus && i.equivalence) {
        const r = i.equivalence(s.stimulus, log.stimulus, i.intentByItem?.[itemId]);
        // (D3-09/A1-022) an unknown hard-set count (prescribed or performed) never yields observed full parity: muscle
        // completion stays unknown, the independently known terms (energy, cardio, mobility) keep their own credit; a log
        // that says "done as planned" without listing items is the prescription itself
        const completion = doseCompletionOf(r, s.stimulus, log.stimulus);
        const asPlanned = log.status === 'done' && (log.performed ?? []).length === 0;
        if (completion.status !== 'known' && !asPlanned) {
          credit = completion.status === 'partial' ? completion.knownTermsScore : null;
          why = 'muscle dose unknown';
          muscleUnknown = true;
          assume('prescriptionReplay', 'muscleCompletionUnknown');
        } else {
          credit = r.credit;
          why = r.parity
            ? 'counts as the planned session'
            : (r.shortfall[0]?.text ?? 'partly matched the planned session');
        }
      } else if (log.status === 'done') {
        credit = 1;
        why = 'session done';
      } else {
        credit = log.durationMin && s.durationMin > 0 ? Math.min(1, log.durationMin / s.durationMin) : 0.5;
        why = 'session partly done';
      }
      setItem(
        itemId,
        type,
        credit === null
          ? 'unknown'
          : muscleUnknown
            ? 'partial'
            : log.status === 'done' && credit >= 0.999
              ? 'done'
              : statusOf(credit),
        credit,
        why,
        log.stimulus,
      );
      // a usual session's habitual dose as the log states it: none, an explicit fraction, or unknown (never invented)
      if (s.usual && log.habitualDose) {
        if (log.habitualDose.kind === 'scaled') {
          const f = Math.min(1, Math.max(0, log.habitualDose.fraction ?? credit ?? 0.5));
          for (const e of s.engine) {
            const sc = scaleSession(e, f);
            if (sc) exercise.push(...withSessionId([sc], log.id));
          }
        } else if (log.habitualDose.kind === 'unknown') assume('habitualBaseline', 'usualDoseUnknown');
        continue;
      }
      const eng = log.engine ?? i.sessionCompiler?.(log.performed, log.startH ?? s.startH) ?? null;
      noteDose(log);
      if (eng && eng.length > 0) exercise.push(...withSessionId(withDoseStatus(eng, log), log.id));
      else if (
        log.status === 'done' &&
        (!s.stimulus || (credit !== null && credit >= 0.999 && !muscleUnknown))
      )
        exercise.push(...withSessionId(s.engine, log.id));
      else {
        // (D3-09) a dose rebuilt from the stimulus vector is an inferred scenario, never reported hard sets
        assume('prescriptionReplay', 'sessionDoseFromStimulus');
        exercise.push(
          ...withSessionId(
            stimulusToEngineSessions(log.stimulus, log.startH ?? s.startH, log.durationMin),
            log.id,
          ),
        );
      }
      continue;
    }
    if (trainMark) {
      const c = markCredit(trainMark);
      setItem(itemId, type, statusOf(c), c, `training marked ${trainMark}`);
      assume('asPlannedTap', `trainMark:${trainMark}`);
      if (s.usual) {
        // as planned: the engine's habitual training stays; not: no habitual dose; partly: an explicit scaled usual dose
        if (trainMark !== 'asPlanned') usualExplicit = true;
        if (trainMark === 'partly') {
          for (const e of s.engine) {
            const sc = scaleSession(e, c);
            if (sc) exercise.push(...withSessionId([sc], s.slotKey));
          }
        }
        continue;
      }
      if (c < 0.999) impute(itemId, type, c, 'markTap');
      for (const e of s.engine) {
        const sc = scaleSession(e, c);
        if (sc) exercise.push(...withSessionId([sc], s.slotKey));
      }
      continue;
    }
    const c = i.expected(type, wd);
    setItem(itemId, type, 'unknown', null, 'not logged');
    assumedItems.push(itemId);
    // a usual ("training as usual") session without its own log adds no exercise here: on a day that
    // logs no training the engine trains it (habitualTraining below), and once anything else is logged the logs replace it
    if (s.usual) {
      assume('habitualBaseline', sessionLogs.length > 0 ? 'usualReplacedByLogs' : 'usualAtHabit');
      continue;
    }
    assume('prescriptionReplay', 'sessionAtExpectedCredit');
    impute(itemId, type, c, 'expectedCredit');
    for (const e of s.engine) {
      const sc = scaleSession(e, c);
      if (sc) exercise.push(...withSessionId([sc], s.slotKey));
    }
  }
  for (const log of sessionLogs) {
    if (usedLogs.has(log.id) || log.status === 'skipped') continue;
    noteDose(log);
    // an unplanned session without a start clock is replayed at a named default hour (an assumption, not its occurrence)
    if (log.startH === undefined) assume('prescriptionReplay', 'sessionClockDefault');
    const compiled = log.engine ?? i.sessionCompiler?.(log.performed, log.startH ?? 18) ?? null;
    if (!compiled) assume('prescriptionReplay', 'sessionDoseFromStimulus');
    const eng = compiled
      ? withDoseStatus(compiled, log)
      : stimulusToEngineSessions(log.stimulus, log.startH ?? 18, log.durationMin);
    exercise.push(...withSessionId(eng, log.id));
  }
  // (0.6.5) every minute counted once: an activity overlapping an earlier-starting one keeps only its own minutes
  t.exercise = withoutOverlaps(exercise);
  // (D3-07/D8-04) the logged bouts' net-above-rest energy (the energy-availability term). The known sum of the logged
  // finite costs is kept apart from the day's complete session expenditure: the day's scalar exists only when the
  // exercise channel is complete (logged sessions covering every prescribed one, the existing coverage rule) or an
  // explicit confirmed zero, AND every non-skipped logged session states its cost. No logs prove no amount (never a
  // zero day); a missing cost is unknown, never a zero; a complete food record never upgrades exercise
  const doneLogs = sessionLogs.filter((l) => l.status !== 'skipped' && !l.assumed);
  const costOf = (l: Extract<LogEntry, { kind: 'session' }>) => l.cost ?? l.stimulus?.cost;
  const withCost = doneLogs.filter(
    (l) => costOf(l) !== undefined && Number.isFinite(costOf(l)!.netAboveRestKcal),
  );
  const exerciseCoverage = (
    sessionLogs.length > 0
      ? matchedSessions === rx.sessions.length
        ? 'complete'
        : 'partial'
      : trainMark
        ? 'asPlannedEstimate'
        : 'unknown'
  ) as ChannelCoverage;
  const knownNetKcal = withCost.reduce((a, l) => a + Math.max(0, costOf(l)!.netAboveRestKcal), 0);
  // (energy SPEC §V3.5) the split: items resolved, sensor coverage, attestation; the day's scalar needs resolved items AND
  // a cost on every done session (a pending candidate never enters: only approved entries are session logs)
  const plannedItemsResolved = matchedSessions === rx.sessions.length;
  const deviceBout = doneLogs.some(
    (l) => l.source.by === 'device' || (l.candidate !== undefined && l.candidate.manual !== true),
  );
  const fusedSteps = i.entries.some(
    (e) => e.kind === 'steps' && e.fusion !== undefined && (e.fusion.coverage?.eitherMin ?? 0) > 0,
  );
  const exerciseNet: LoggedDayResult['exercise'] = {
    netAboveRestKcal:
      (exerciseCoverage === 'complete' || exerciseCoverage === 'confirmedZero') &&
      plannedItemsResolved &&
      withCost.length === doneLogs.length
        ? knownNetKcal
        : null,
    logged: doneLogs.length,
    withCost: withCost.length,
    knownNetKcal,
    coverage: exerciseCoverage,
    plannedItemsResolved,
    sensorCoverage: deviceBout || fusedSteps ? 'observed' : 'unknown',
    attestation: trainMark ?? null,
  };
  const ownSessions = rx.sessions.filter((s) => !s.usual).length;
  t.habitualTraining =
    rx.template.habitualTraining === true && ownSessions === 0 && sessionLogs.length === 0 && !usualExplicit;

  // ------------------------------------------------------------------ fast (C2/D5-05: resolved in absolute time)
  const resolved =
    i.fasts ??
    resolveFasts({
      planStart: i.planStart,
      tz: i.tz,
      rolloverH,
      asOf: i.asOf ?? localHorizon(i.date, rolloverH, i.tz, i.entries),
      entries: i.entries,
      days: [{ date: i.date, planDay: rx.planDay, prescription: rx, status }],
    });
  let fastCoverage: ChannelCoverage = 'unknown';
  if (rx.fast && rx.fastEvent) {
    const rf = resolvedForPrescription(resolved, rx);
    const o = fastItemOutcome(rf, rx.fast.hours);
    setItem('fast', 'fast', o.status, o.credit, o.why);
    if (o.assumed) assumedItems.push('fast');
    if (rf?.assumption) assume(rf.assumption, `fast:${rf.basis}`);
    fastCoverage =
      rf?.basis === 'log'
        ? rf.interval.end.kind === 'observed'
          ? 'complete'
          : 'partial'
        : rf?.basis === 'terminatingEvent'
          ? 'partial'
          : rf?.basis === 'mark'
            ? 'asPlannedEstimate'
            : 'unknown';
  } else if (itemOf('fast')) {
    // a zero-energy day without an event: a known lower bound above the tolerance proves it was not zero; a zero day is
    // proven only by the person's day report (nothing eaten, or everything logged within the tolerance)
    const c = confirmedZero
      ? 1
      : observedKcal > ADHERENCE_ZERO_DAY_TOLERANCE_KCAL
        ? 0
        : complete && unknownEnergyMeals === 0
          ? 1
          : foodMark
            ? markCredit(foodMark)
            : null;
    setItem(
      'fast',
      'fast',
      c === null ? 'unknown' : statusOf(c),
      c,
      c === null ? 'not logged' : 'water-only day',
    );
    if (c !== null)
      fastCoverage = confirmedZero || complete ? 'complete' : foodMark ? 'asPlannedEstimate' : 'partial';
  }
  let fast: FastEvent | null = null;
  for (const rf of resolved) {
    const ev = rf.event;
    if (!ev || ev.startDay !== rx.planDay || !(ev.durationH > 0)) continue;
    if (rf.expectedCreditDecision && !(i.expected('fast', wd) >= UNKNOWN_FAST_KEEP_CREDIT)) continue;
    fast = ev;
    if (fastCoverage === 'unknown' && rf.basis === 'log')
      fastCoverage = rf.interval.end.kind === 'observed' ? 'complete' : 'partial';
    break;
  }

  // ------------------------------------------------------------------ steps, sleep
  const stepsLog = i.entries.find((e): e is Extract<LogEntry, { kind: 'steps' }> => e.kind === 'steps');
  const steps = stepsLog?.steps;
  let stepsCoverage: ChannelCoverage = 'unknown';
  if (steps !== undefined) {
    t.steps = steps;
    if (stepsLog?.scope) t.stepsScope = stepsLog.scope;
    stepsCoverage = 'complete';
    // (D3-07) a total-day count includes the logged sessions' locomotor steps: they leave the step-energy ledger only (the
    // reported count stays as entered); an excludes-training count is never reduced; an unknown scope with logged
    // sessions is one named overlap assumption, never a guessed overlap
    const scope = stepsLog?.scope ?? 'unknown';
    const included = doneLogs.filter(
      (l) => l.stepsIncluded !== undefined && Number.isFinite(l.stepsIncluded) && l.stepsIncluded > 0,
    );
    if (scope === 'totalDay' && included.length > 0)
      t.sessionIncludedSteps = Math.min(
        steps,
        included.reduce((a, l) => a + l.stepsIncluded!, 0),
      );
    else delete t.sessionIncludedSteps;
    if (scope === 'unknown' && doneLogs.length > 0) assume('habitualBaseline', 'stepsSessionOverlapUnknown');
    // (energy SPEC §V3.5) with a total-day count the overlap is known from the located steps of approved gait bouts; it is
    // unknown only for a gait session whose steps intervals are missing
    const gaitWithoutSteps = doneLogs.some(
      (l) =>
        (l.stepsIncluded === undefined || !(l.stepsIncluded > 0)) &&
        (l.engine ?? []).some((x) => x.kind === 'cardio' && (x.modality === 'walk' || x.modality === 'run')),
    );
    if (scope === 'totalDay' && gaitWithoutSteps) assume('habitualBaseline', 'stepsOverlapUnknown');
    // (S1 import) a ring count is a device measurement: one shared device-bias group across every ring day
    const ringSteps = stepsLog !== undefined && isGaugeEntry(stepsLog);
    if (ringSteps)
      uncertaintyGroups.push({ id: 'deviceBias:gauge:steps', kind: 'deviceBias', memberIds: [stepsLog.id] });
    if (rx.steps !== undefined)
      setItem(
        'steps',
        'steps',
        statusOf(ratioCredit(rx.steps, steps)),
        ratioCredit(rx.steps, steps),
        `${Math.round(steps)} steps${ringSteps ? ' (ring)' : ''}`,
      );
  } else if (rx.steps !== undefined) {
    if (marks.all === 'asPlanned' || markFor('train') === 'asPlanned') {
      t.steps = rx.steps;
      stepsCoverage = 'asPlannedEstimate';
      assume('asPlannedTap', 'stepsAsPlanned');
      setItem('steps', 'steps', 'done', 1, 'marked as planned');
    } else {
      // replay: habitual steps (engine default) unless revealed adherence says otherwise
      const c = i.expected('steps', wd);
      if (c < 0.5) delete t.steps;
      setItem('steps', 'steps', 'unknown', null, 'not logged');
      assumedItems.push('steps');
      assume('prescriptionReplay', 'stepsAtExpectedCredit');
    }
  }
  // (D8-06) observed sleep maps to its WAKE date (the entry's date): the night ending on this day sets this day's sleep.
  // Episodes are merged by their instants (an overlap is counted once); the main episode is the longest non-nap one. The
  // logged duration is never decremented by a modelled caffeine/alcohol effect; quality only when the person entered it.
  const sleepObs = observedSleep(
    i.entries.filter((e): e is Extract<LogEntry, { kind: 'sleep' }> => e.kind === 'sleep' && !e.assumed),
  );
  let sleepH: number | undefined;
  // (D8-06/A1-053) every logged episode travels as logged (the compiler unions them once), apart from the main episode's
  // timing (which places hourly sleep; a nap never stretches it) and the known total asleep hours of the waking day
  const episodesOf = (o: ObservedDaySleep) =>
    (o.list ?? []).map((x) => ({
      bedAt: x.bedAt,
      wakeAt: x.wakeAt,
      tz: i.tz,
      kind: x.kind,
      eventId: x.entryId,
      ...(x.quality ? { quality: x.quality } : {}),
      ...(x.restfulness !== undefined ? { restfulness: x.restfulness } : {}),
    }));
  if (sleepObs?.main) {
    const bed = instantToLocal(sleepObs.main.bedAt, i.tz);
    const wake = instantToLocal(sleepObs.main.wakeAt, i.tz);
    sleepH = sleepObs.hours;
    // an observed night without a rating is UNRATED: the planned quality is never inherited, nothing is read as good/poor
    const { quality: _plannedQuality, ...planned } = t.sleep ?? {};
    void _plannedQuality;
    t.sleep = {
      ...planned,
      bedH: bed.clockH,
      wakeH: wake.clockH,
      hours: sleepH,
      ...(sleepObs.main.quality ? { quality: sleepObs.main.quality } : {}),
      observed: {
        bedAt: sleepObs.main.bedAt,
        wakeAt: sleepObs.main.wakeAt,
        tz: i.tz,
        kind: 'main',
        eventId: sleepObs.main.entryId,
        ...(sleepObs.main.quality ? { quality: sleepObs.main.quality } : {}),
        ...(sleepObs.main.restfulness !== undefined ? { restfulness: sleepObs.main.restfulness } : {}),
      },
      ...(sleepObs.episodes > 1 ? { observedEpisodes: episodesOf(sleepObs) } : {}),
      observedTotalHours: sleepObs.hours,
      observedCoverage: 'complete',
    };
  } else if (sleepObs) {
    // a nap-only record stays partial: the main night is unknown and keeps the prescription's night as a named scenario;
    // the nap's known dose travels as logged (never a full night invented from it)
    t.sleep = {
      ...(t.sleep ?? {}),
      observedEpisodes: episodesOf(sleepObs),
      observedTotalHours: sleepObs.hours,
      observedCoverage: 'partial',
    };
    assume('prescriptionReplay', 'sleepMainUnknown');
  }
  const ringSleep = i.entries
    .filter((e) => e.kind === 'sleep' && !e.assumed && isGaugeEntry(e))
    .map((e) => e.id);
  if (ringSleep.length > 0)
    uncertaintyGroups.push({ id: 'deviceBias:gauge:sleep', kind: 'deviceBias', memberIds: ringSleep });
  uncertaintyGroups.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sleepTarget = itemOf('sleep')?.target.hours;
  if (sleepTarget !== undefined) {
    if (sleepH !== undefined)
      setItem(
        'sleep',
        'sleep',
        statusOf(ratioCredit(sleepTarget, sleepH)),
        ratioCredit(sleepTarget, sleepH),
        `${sleepH.toFixed(1)} h asleep${ringSleep.length > 0 ? ' (ring)' : ''}`,
      );
    else setItem('sleep', 'sleep', 'unknown', null, 'not logged');
  }

  // ------------------------------------------------------------------ substances and supplements (D5-01 identity, units)
  const planned = rx.template.substances ?? {};
  const dosed = i.entries.filter(
    (e): e is Extract<LogEntry, { kind: 'substance' | 'supplement' }> =>
      e.kind === 'substance' || e.kind === 'supplement',
  );
  const linked = new Set<string>();
  for (const e of dosed) {
    const l = linkOf(e);
    if (l && e.extra !== true) linked.add(l);
  }
  const unlinked = (ing: string) =>
    dosed.filter(
      (e) =>
        !linkOf(e) && e.extra !== true && (ing === 'creatine' ? carriesCreatine(e) : ingredientOf(e) === ing),
    );
  const subs: SubstanceSpec = { ...(planned.creatineLoading ? { creatineLoading: true } : {}) };
  /** Planned doses of an ingredient stay unless a linked log replaced them or an unlinked log makes the identity unresolved. */
  const keepPlanned = (ing: string, ids: readonly string[]): boolean[] => {
    const amb = unlinked(ing);
    const openIds = ids.filter((id) => !linked.has(id));
    if (amb.length > 0 && openIds.length > 0) {
      alternatives.push({
        id: `identity:${i.date}:${ing}`,
        memberIds: amb.map((e) => e.id),
        candidates: openIds,
      });
      assume('prescriptionReplay', `unresolvedIdentity:${ing}`);
      return ids.map(() => false);
    }
    if (openIds.length > 0) assume('prescriptionReplay', `plannedDose:${ing}`);
    return ids.map((id) => !linked.has(id));
  };
  const plannedCaf = planned.caffeine ?? [];
  keepPlanned(
    'caffeine',
    plannedCaf.map((_, k) => `substance:caffeine:${k}`),
  ).forEach((keep, k) => {
    if (keep)
      subs.caffeine = [
        ...(subs.caffeine ?? []),
        { ...plannedCaf[k]!, eventId: plannedCaf[k]!.eventId ?? `substance:caffeine:${k}` },
      ];
  });
  const plannedAlc = planned.alcohol ?? [];
  keepPlanned(
    'alcohol',
    plannedAlc.map((_, k) => `substance:alcohol:${k}`),
  ).forEach((keep, k) => {
    if (keep)
      subs.alcohol = [
        ...(subs.alcohol ?? []),
        { ...plannedAlc[k]!, eventId: plannedAlc[k]!.eventId ?? `substance:alcohol:${k}` },
      ];
  });
  const plannedKet = planned.exogenousKetones ?? [];
  keepPlanned(
    'exogenousKetones',
    plannedKet.map((_, k) => `substance:exogenousKetones:${k}`),
  ).forEach((keep, k) => {
    if (keep)
      subs.exogenousKetones = [
        ...(subs.exogenousKetones ?? []),
        { ...plannedKet[k]!, eventId: plannedKet[k]!.eventId ?? `substance:exogenousKetones:${k}` },
      ];
  });
  let creatineG =
    (planned.creatineG ?? 0) > 0 && keepPlanned('creatine', ['supplement:creatine'])[0]
      ? planned.creatineG!
      : 0;
  let doseUnknown = false;
  const creatineSeen: Array<{ id: string; kind: string; g: number; linked: boolean; extra: boolean }> = [];
  /** Creatine events of unknown amount (unknown label potency or an invalid legacy unit): counted, never a number. */
  const creatineUnknown: string[] = [];
  for (const e of dosed) {
    if (e.kind === 'substance') {
      const d = substanceDose(e);
      if (!d) {
        doseUnknown = true;
        continue;
      }
      if (e.substance === 'caffeine')
        subs.caffeine = [
          ...(subs.caffeine ?? []),
          { clockH: e.clockH, mg: d.unit === 'mg' ? d.value : d.value * 1000, eventId: e.id },
        ];
      else if (e.substance === 'alcohol')
        subs.alcohol = [
          ...(subs.alcohol ?? []),
          {
            clockH: e.clockH,
            drinks: drinksOfEthanolG(d.unit === 'g' ? d.value : d.value / 1000),
            eventId: e.id,
          },
        ];
      else if (e.substance === 'creatine')
        creatineSeen.push({
          id: e.id,
          kind: 'substance',
          g: d.unit === 'g' ? d.value : d.value / 1000,
          linked: !!linkOf(e),
          extra: e.extra === true,
        });
      else
        subs.exogenousKetones = [
          ...(subs.exogenousKetones ?? []),
          { clockH: e.clockH, gBhb: d.unit === 'g' ? d.value : d.value / 1000, form: 'salt', eventId: e.id },
        ];
    } else if (labelled(e)) {
      // (D7-04/A1-032) a product-labelled log: creatine from its canonical 'creatine' active exposure only (servings ×
      // label, unit-checked), never the product mass or the capsule count; unknown potency stays unknown (no number, an
      // unknown event, coverage partial). The product's other actives replay in the actives loop below.
      for (const x of supplementExposures(e)) {
        if (x.id !== 'creatine') continue;
        const g = creatineGramsOf(x);
        if (g === null) {
          doseUnknown = true;
          creatineUnknown.push(e.id);
          continue;
        }
        creatineSeen.push({ id: e.id, kind: 'supplement', g, linked: !!linkOf(e), extra: e.extra === true });
      }
    } else if (CREATINE_IDS.has(e.supplementId)) {
      // documented legacy read adapter: an unlabelled creatine record's g/mg dose already denotes creatine mass
      const g = e.unit === 'g' ? e.dose : e.unit === 'mg' ? e.dose / 1000 : null;
      if (g === null || !Number.isFinite(g) || g < 0) {
        doseUnknown = true;
        creatineUnknown.push(e.id);
        continue;
      }
      creatineSeen.push({ id: e.id, kind: 'supplement', g, linked: !!linkOf(e), extra: e.extra === true });
    }
  }
  // creatine recorded both ways (a substance and a supplement log of the same dose, neither linked nor extra) is one dose
  const counted = new Set<string>();
  for (const c of creatineSeen) {
    if (counted.has(c.id)) continue;
    const twin =
      !c.linked && !c.extra
        ? creatineSeen.find(
            (o) =>
              o.id !== c.id &&
              !counted.has(o.id) &&
              o.kind !== c.kind &&
              !o.linked &&
              !o.extra &&
              Math.abs(o.g - c.g) < 1e-9,
          )
        : undefined;
    creatineG += c.g;
    counted.add(c.id);
    if (twin) {
      counted.add(twin.id);
      alternatives.push({
        id: `identity:${i.date}:creatine:${c.id}`,
        memberIds: [c.id, twin.id],
        candidates: ['oneDose', 'twoDoses'],
      });
    }
  }
  if (creatineG > 0) subs.creatineG = creatineG;
  else delete subs.creatineG;
  // (C3/D6-03) food-borne caffeine joins the replay unless a caffeine log explicitly links to that meal (one exposure);
  // an unlinked caffeine log is an independent event (two drinks at the same time are two)
  const activeDay: Record<string, ActiveDayExposure> = {};
  const addActive = (id: string, unit: string, value: number | null): void => {
    const cur = activeDay[id] ?? { unit, knownDaily: 0, peakBolus: 0, events: 0, unknownEvents: 0 };
    cur.events += 1;
    if (value === null) cur.unknownEvents += 1;
    else {
      cur.knownDaily += value;
      cur.peakBolus = Math.max(cur.peakBolus, value);
    }
    activeDay[id] = cur;
  };
  for (const e of dosed)
    if (e.kind === 'substance' && e.substance === 'caffeine') {
      const d = substanceDose(e);
      addActive('caffeine', 'mg', d ? (d.unit === 'mg' ? d.value : d.value * 1000) : null);
    }
  // (D7-04/A1-032) creatine: every observed event once in the exposure summary (g; unknown potency counted, no number);
  // its amount reaches the engine through the one creatine scalar above, never also as an active dose
  for (const c of creatineSeen) addActive('creatine', 'g', c.g);
  for (const _id of creatineUnknown) addActive('creatine', 'g', null);
  for (const m of realMeals) {
    const caf = exposuresOf(m).find((x) => x.id === 'caffeine');
    if (!caf) continue;
    if (dosed.some((e) => e.kind === 'substance' && e.substance === 'caffeine' && linkOf(e) === m.id))
      continue;
    addActive('caffeine', 'mg', caf.value);
    if (caf.value !== null && caf.value > 0)
      subs.caffeine = [
        ...(subs.caffeine ?? []),
        { clockH: m.clockH, mg: caf.value, eventId: `${m.id}:caffeine` },
      ];
  }
  // (D7-04) active-ingredient doses: observed ones from each log's label arithmetic (unknown potency adds no number and
  // stays unchecked); a planned one stays unless its item's linked log replaced it or an unlinked log of the same
  // ingredient leaves the identity unresolved (then only the observed doses replay and the ambiguity is named)
  const observedActives: ActiveDoseSpec[] = [];
  const unlinkedIngredients = new Set<string>();
  for (const e of dosed) {
    if (e.kind !== 'supplement') continue;
    for (const x of supplementExposures(e)) {
      // creatine is routed once, to the creatine scalar (above); every other labelled active of the product replays here
      if (x.id === 'creatine') continue;
      addActive(x.id, x.unit, x.value);
      if (x.value === null) doseUnknown = true;
      else if (ACTIVE_UNITS.has(x.unit))
        observedActives.push({
          ingredient: x.id,
          amount: x.value,
          unit: x.unit as ActiveDoseSpec['unit'],
          ...(e.clockH !== undefined ? { clockH: e.clockH } : {}),
          eventId: e.id,
          origin: 'observed',
        });
      if (!linkOf(e) && e.extra !== true) unlinkedIngredients.add(x.id);
    }
  }
  const plannedActives: ActiveDoseSpec[] = [];
  for (const a of planned.actives ?? []) {
    if (a.origin === 'observed') continue;
    const item = a.eventId;
    if (item && linked.has(item)) continue;
    if (unlinkedIngredients.has(a.ingredient)) {
      const id = `identity:${i.date}:${a.ingredient}`;
      const amb = dosed
        .filter(
          (e) =>
            e.kind === 'supplement' &&
            !linkOf(e) &&
            e.extra !== true &&
            supplementExposures(e).some((x) => x.id === a.ingredient),
        )
        .map((e) => e.id);
      const prev = alternatives.find((x) => x.id === id);
      if (prev) prev.candidates.push(item ?? a.ingredient);
      else alternatives.push({ id, memberIds: amb, candidates: [item ?? a.ingredient] });
      assume('prescriptionReplay', `unresolvedIdentity:${a.ingredient}`);
      continue;
    }
    assume('prescriptionReplay', `plannedDose:${a.ingredient}`);
    plannedActives.push(a);
  }
  if (plannedActives.length + observedActives.length > 0)
    subs.actives = [...plannedActives, ...observedActives];
  if (Object.keys(subs).length > 0) t.substances = subs;
  else delete t.substances;
  for (const s of rx.supplements) {
    const id = s.itemId ?? `supplement:${s.supplementId}`;
    const logged = i.entries.some(
      (e) => e.kind === 'supplement' && (e.supplementId === s.supplementId || linkOf(e) === id),
    );
    if (logged) setItem(`supplement:${s.supplementId}`, 'supplement', 'done', 1, 'taken');
    else if (marks.all)
      setItem(
        `supplement:${s.supplementId}`,
        'supplement',
        statusOf(markCredit(marks.all)),
        markCredit(marks.all),
        `day marked ${marks.all}`,
      );
    else setItem(`supplement:${s.supplementId}`, 'supplement', 'unknown', null, 'not logged');
  }
  const ill = i.entries.some(
    (e) => (e.kind === 'event' && e.event === 'illness') || (e.kind === 'subjective' && e.illness === true),
  );
  const stress = i.entries.find(
    (e): e is Extract<LogEntry, { kind: 'subjective' }> => e.kind === 'subjective' && e.stress !== undefined,
  )?.stress;
  if (ill || stress)
    t.modifiers = { ...t.modifiers, ...(ill ? { illness: true } : {}), ...(stress ? { stress } : {}) };

  // ------------------------------------------------------------------ remaining items, overrides, score
  for (const it of rx.items)
    if (!outcomes.has(it.itemId)) setItem(it.itemId, it.type, 'unknown', null, 'not logged');
  if (i.creditOverrides) {
    for (const c of credits) {
      const v = i.creditOverrides[c.itemId];
      if (v !== undefined && c.credit !== null) {
        c.credit = v;
        c.why = `${c.why} (benefit kept: ${Math.round(100 * v)} %)`;
        const o = outcomes.get(c.itemId)!;
        outcomes.set(c.itemId, { ...o, credit: v, status: statusOf(v) });
      }
    }
  }
  if (assumedDay) {
    // backfilled day: "as planned" for the replay, never scored
    for (const c of credits) c.credit = null;
    assume('asPlannedTap', 'backfilledDay');
  }

  // ------------------------------------------------------------------ coverage, resolution (C1/C2)
  const macroCoverage = (k: MacroKey): ChannelCoverage =>
    energyCoverage === 'complete' && meals.some((m) => !macroKnown(m, k)) ? 'partial' : energyCoverage;
  const has = (k: LogEntry['kind'], pred: (e: LogEntry) => boolean = () => true) =>
    i.entries.some((e) => e.kind === k && !e.assumed && pred(e));
  const coverage: ChannelCoverageMap = {
    energy: energyCoverage,
    protein: macroCoverage('proteinG'),
    carbohydrate: macroCoverage('carbG'),
    fat: macroCoverage('fatG'),
    exercise: exerciseCoverage,
    fasting: fastCoverage,
    steps: stepsCoverage,
    sleep: sleepObs?.main ? 'complete' : sleepObs ? 'partial' : 'unknown',
    ...(has('substance', (e) => e.kind === 'substance' && e.substance === 'caffeine')
      ? { caffeine: 'partial' as const }
      : {}),
    ...(has('substance', (e) => e.kind === 'substance' && e.substance === 'alcohol')
      ? { alcohol: 'partial' as const }
      : {}),
    ...(has('supplement') || doseUnknown ? { supplements: 'partial' as const } : {}),
    // (C3/D6-03) nutrient-specific coverage of what the meals know (a partial sum is a lower bound)
    ...(nutrients.fibre ? { fibre: nutrients.fibre.coverage } : {}),
    ...(nutrients.sodium ? { sodium: nutrients.sodium.coverage } : {}),
    ...(nutrients.ethanol && !has('substance', (e) => e.kind === 'substance' && e.substance === 'alcohol')
      ? { alcohol: nutrients.ethanol.coverage }
      : {}),
    // (C1/D1-06) Vitals has no fluid log: beverage volume is unknown, never "hydrated"
    fluids: 'unknown',
  };
  const calibrationEligible =
    !assumedDay && exposureCalibrationEligible(energyCoverage, quantified.map(entryProvenance));
  const resolution: CausalResolution =
    assumedDay || assumedItems.length > 0 || remainders.length > 0 || assumptions.length > 0
      ? 'scenario'
      : 'daily';
  t.observed = {
    coverage,
    resolution,
    eventIds: i.entries
      .filter((e) => !e.assumed && e.kind !== 'retract' && e.kind !== 'note' && e.kind !== 'stepsCorrection')
      .map((e) => e.id),
    assumptionIds: assumptions.map((a) => `${i.date}:${a.kind}:${a.reasonCode}`),
  };

  const score = scoreDay(rx.items, credits, {
    final: i.final,
    assumed: assumedDay,
    ...(rx.paused ? { paused: true } : {}),
  });
  const loggedDay: LoggedDay = {
    date: i.date,
    inputs: t,
    items: rx.items
      .map((it) => outcomes.get(it.itemId)!)
      .map((o) => (assumedDay ? { ...o, status: 'unknown' as const, credit: null } : o)),
    coverage: score.coverage,
  };
  return {
    loggedDay,
    score,
    fast,
    assumedItems: [...new Set(assumedItems)],
    ...(imputedDoses.length > 0 ? { imputedDoses } : {}),
    intakeLogged: intakeLogged && !assumedDay,
    assumedDay,
    coverage,
    calibrationEligible,
    observed: {
      energyKcal:
        unknownEnergyMeals > 0
          ? null
          : quantified.length > 0 || confirmedZero
            ? quantified.reduce((s, m) => s + (energyOf(m) ?? 0), 0)
            : null,
      proteinG: quantified.length > 0 ? observedProtein : confirmedZero ? 0 : null,
      meals: quantified.length,
      unknownEnergyMeals,
    },
    remainders,
    assumptions,
    resolution,
    alternatives,
    observedWellbeing: observedWellbeingOf(i.entries),
    exercise: exerciseNet,
    sleep: sleepObs,
    actives: activeDay,
    nutrients,
    amountMethods,
    uncertaintyGroups,
  };
}

/**
 * Observation horizon of a standalone day (no shared resolution given): the end of its app day, or a later logged fast end
 * among its entries (an explicitly recorded end is an observation, not a forecast).
 */
function localHorizon(date: LocalDate, rolloverH: number, tz: string, entries: readonly LogEntry[]): Instant {
  let t = Date.parse(localToInstant(addDays(date, 1), rolloverH, tz));
  for (const e of entries)
    if (e.kind === 'fast' && e.firstIntakeAt) t = Math.max(t, Date.parse(e.firstIntakeAt) + 1);
  return new Date(t).toISOString();
}

/** Active ingredient of a substance or supplement record (for identity resolution of planned doses). */
function ingredientOf(e: Extract<LogEntry, { kind: 'substance' | 'supplement' }>): string {
  return e.kind === 'substance'
    ? e.substance
    : CREATINE_IDS.has(e.supplementId)
      ? 'creatine'
      : `supplement:${e.supplementId}`;
}

/** (A1-032) Supplement ids that name creatine itself: the plan's alias and the catalogue id. */
const CREATINE_IDS: ReadonlySet<string> = new Set(['creatine', 'creatine_monohydrate']);

/** A product-labelled supplement log (label snapshot or stored label exposures): its actives come from the label only. */
function labelled(e: Extract<LogEntry, { kind: 'supplement' }>): boolean {
  return !!e.product || (e.exposures !== undefined && e.exposures.length > 0);
}

/** Whether a record carries creatine: a creatine substance, a creatine id, or a labelled product with a creatine active. */
function carriesCreatine(e: Extract<LogEntry, { kind: 'substance' | 'supplement' }>): boolean {
  if (e.kind === 'substance') return e.substance === 'creatine';
  return labelled(e)
    ? supplementExposures(e).some((x) => x.id === 'creatine')
    : CREATINE_IDS.has(e.supplementId);
}

/** Creatine grams of a canonical exposure quantity (g, mg, µg); null when unknown or not a mass. */
function creatineGramsOf(x: ExposureQuantity): number | null {
  if (x.value === null || !Number.isFinite(x.value) || x.value < 0) return null;
  return x.unit === 'g' ? x.value : x.unit === 'mg' ? x.value / 1000 : x.unit === 'ug' ? x.value / 1e6 : null;
}
