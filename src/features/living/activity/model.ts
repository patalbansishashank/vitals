/**
 * Today's activity, recording and review models (energy SPEC §V4.1–§V4.3, A.3.5). Pure: the screens render them and the
 * tests read them. Words follow §1.7: kcal are "estimated" with a "scenario range", Heart Points are "Heart Points
 * (Fit-compatible estimate)", quiet mode carries no kcal and no scores.
 */
import { clockText, durationText, formatEnergy, formatEnergyRange, formatNumber, type EnergyUnitChoice } from '@/components';
import { ACTIVITY_TRAITS, activityTraitsOf } from '@/content/catalogues/activityTypes';
import { exerciseRecordOf } from '@/living/sensors/activityEnergy';
import type { EnergyDay, EnergyState } from '@/living/sensors/energyDay';
import type { CandidateSource } from '@/living/sensors/activityDetect';
import type { EstimateEvidence, ReviewRow } from '@/living/activityCandidates';
import type { Envelope } from '@/living/sensors/types';
import type { GaugeTimeline } from '@/net/gauge';
import { addDays } from '@/living/dates';
import {
  DETECTION_ONLY_AFTER_APPROVAL,
  detectionLabelInfo,
  detectionReasonText,
} from '@/living/detectionLabels';
import type { LiveDetection } from '@/state/liveDetections';

// ------------------------------------------------------------------------------------------- names and words
/** (r063 S16/A19) Why Health Connect speed or power was not used, in words (the estimate's `evidence[].reason`). */
export const EVIDENCE_REASON: Record<string, string> = {
  statedSpeedFirst: 'the speed you entered is used instead',
  statedPowerFirst: 'the power you entered is used instead',
  speedNotAccepted: 'none of it was measured (typed-in speed is not used)',
  speedCoverageLow: 'it covers too little of the activity',
  powerCoverageLow: 'it covers too little of the activity',
  speedOutsideDomain: 'it is outside what the speed equation covers',
  notGait: 'speed is used for walking and running only',
  speedNotEligibleForType: 'speed is used for walking and running only',
  powerNotVerified: 'it is not verified, so it never changes the energy',
  displayWattsNotMetabolicWork: 'this machine’s watts are not a measure of the work your body did',
  powerOutsideDomain: 'it is outside what the power equation covers',
  anotherEstimatorFirst: 'another estimate comes first',
};

/**
 * (r063 S16/A19) The activity sheet's "how this was estimated" words for the Health Connect evidence of an estimate:
 * `method` the suffix of the booked method when the estimate used it, `notes` one line per stream it did not use. Shown only
 * outside quiet mode (with the kcal).
 */
export function evidenceWords(e: EstimateEvidence | undefined): { method: string | null; notes: string[] } {
  if (!e) return { method: null, notes: [] };
  const used: string[] = [];
  const notes: string[] = [];
  if (e.speed) {
    const kmh = e.speed.kmh !== null ? ` (${formatNumber(e.speed.kmh, 1)} km/h)` : '';
    // (0.6.3 FX5) the speed's lineage: Gauge's own GPS route, or Health Connect
    const what = e.speed.source === 'gaugeGps' ? 'Phone GPS speed' : 'Health Connect speed';
    if (e.speed.used) used.push(`${what}${kmh}`);
    else notes.push(`${what}${kmh} not used: ${EVIDENCE_REASON[e.speed.reason ?? ''] ?? 'not eligible'}`);
  }
  if (e.power) {
    const w = ` (${formatNumber(Math.round(e.power.avgW), 0)} W)`;
    if (e.power.used) used.push(`verified Health Connect power${w}`);
    else
      notes.push(
        `Health Connect power${w} shown only: ${EVIDENCE_REASON[e.power.reason ?? ''] ?? 'not eligible'}`,
      );
  }
  return { method: used.length ? `from ${used.join(' and ')}` : null, notes };
}

const cap = (s: string) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s);

/** "Walk", "Air bike", "Treadmill incline walk": the catalogue's name, its long qualifiers dropped. */
export function activityName(exerciseId: string): string {
  const name = exerciseRecordOf(exerciseId)?.name ?? exerciseId.replace(/_/g, ' ');
  return cap(name.split(/[,(]/)[0]!.trim());
}

/** Every activity type the picker offers (the V1 activity catalogue), by name. */
export function activityTypes(): Array<{ id: string; name: string }> {
  return Object.keys(ACTIVITY_TRAITS)
    .filter((id) => exerciseRecordOf(id))
    .map((id) => ({ id, name: activityName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Types matching what was typed (name words in order of appearance), the suggested and recent ones first. */
export function searchTypes(q: string, pinned: readonly string[] = []): Array<{ id: string; name: string }> {
  const all = activityTypes();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit =
    words.length === 0
      ? all
      : all.filter((t) => words.every((w) => t.name.toLowerCase().includes(w) || t.id.includes(w)));
  const pin = new Map(pinned.map((id, i) => [id, i] as const));
  return [...hit].sort(
    (a, b) => (pin.get(a.id) ?? 99) - (pin.get(b.id) ?? 99) || a.name.localeCompare(b.name),
  );
}

/** Does the type count steps (a carry selector makes sense)? */
export const isGaitType = (exerciseId: string): boolean => {
  const ex = exerciseRecordOf(exerciseId);
  return ex ? activityTraitsOf(ex).stepsLocomotor && activityTraitsOf(ex).carry !== 'none' : false;
};

const SOURCE_WORD: Record<CandidateSource, string> = {
  gaugeSession: 'Phone recording',
  hcSession: 'Health Connect',
  ringTelemetry: 'Ring',
  cadenceDetector: 'Steps',
  hrDetector: 'Heart rate',
  // (0.6.7 AD-VITALS) the home server's detection: "detected", never "logged by hand"
  automaticDetector: 'Detected',
};

/** "Ring and steps": what saw it, in order, each once. */
export function sourcesText(sources: ReadonlyArray<{ source: CandidateSource }>): string {
  const words = [...new Set(sources.map((s) => SOURCE_WORD[s.source]))];
  if (words.length === 0) return 'Logged by hand';
  if (words.length === 1) return words[0]!;
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)!.toLowerCase()}`;
}

/** "07:05–07:50" on the person's clock. */
export const timeRangeText = (startAt: string, endAt: string, tz?: string): string =>
  `${clockText(Date.parse(startAt), tz)}–${clockText(Date.parse(endAt), tz)}`;

/** A time of day as words (quiet mode: no clock digits): "in the night" … "late in the evening". */
export function partOfDayWords(ms: number, tz?: string): string {
  if (!Number.isFinite(ms)) return 'at some point';
  const [hh, mm] = clockText(ms, tz).split(':').map(Number);
  const h = (hh ?? 0) + (mm ?? 0) / 60;
  if (h < 5) return 'in the night';
  if (h < 8) return 'early in the morning';
  if (h < 12) return 'in the morning';
  if (h < 17) return 'in the afternoon';
  if (h < 21) return 'in the evening';
  return 'late in the evening';
}

/**
 * (0.6.3 INT) An activity's time in quiet mode, words only (aria too): "in the morning", or "from the morning into the
 * afternoon" when it crosses a part of the day. Clock times are digits, so quiet mode never shows them (owner, 10-28).
 */
export function quietTimeText(startAt: string, endAt: string, tz?: string): string {
  const a = partOfDayWords(Date.parse(startAt), tz);
  const b = partOfDayWords(Date.parse(endAt), tz);
  // "early in the morning" → "morning": the part's noun
  const noun = (w: string) => w.replace(/^(?:early |late )?in the /, '');
  if (a === 'at some point' || b === 'at some point' || noun(a) === noun(b)) return a;
  return `from the ${noun(a)} into the ${noun(b)}`;
}

/** The time of an activity row: the clock range, or its part of the day in quiet mode. */
export const rowTimeText = (startAt: string, endAt: string, quiet: boolean, tz?: string): string =>
  quiet ? quietTimeText(startAt, endAt, tz) : timeRangeText(startAt, endAt, tz);

/** (r063 FX2 sR16) Words for a log saved without a clock time: its stored times are a placeholder, never shown. */
export const TIME_NOT_GIVEN = 'time not given';

/** A review row's time: its range, or `TIME_NOT_GIVEN` for a "time unknown" log. */
export const reviewRowTimeText = (
  r: { startAt: string; endAt: string; timeUnknown?: true },
  quiet: boolean,
  tz?: string,
): string => (r.timeUnknown ? TIME_NOT_GIVEN : rowTimeText(r.startAt, r.endAt, quiet, tz));

/** A whole kcal figure with its no-break thousands ("1 240"). */
export const kcalText = (v: number): string => formatNumber(Math.round(v), 0);

/** An energy figure in the person's unit (kcal stored; kJ rounded to 10, UI audit #24), without the unit. */
export const energyText = (kcal: number, unit: EnergyUnitChoice = 'kcal'): string =>
  unit === 'kcal' ? kcalText(kcal) : formatEnergy(kcal, unit, { withUnit: false });

/** "about 310 kcal, 220–400" (scenario range); "about 1 300 kJ, 920–1 670" in kJ. */
export function kcalRangeText(
  value: number,
  range: Envelope | null | undefined,
  unit: EnergyUnitChoice = 'kcal',
): string {
  const r =
    range && Number.isFinite(range.lo) && Number.isFinite(range.hi)
      ? `, ${formatEnergyRange(range.lo, range.hi, unit, { withUnit: false })}`
      : '';
  return `about ${energyText(value, unit)} ${unit}${r}`;
}

/**
 * The booked energy: a number the machine showed reads as it is, "0 kcal (from the machine)" included (0.6.3: an explicit
 * 0 is booked, never replaced by an estimate); an estimate reads "about N kcal, lo–hi".
 */
export function bookedKcalText(
  value: number,
  range: Envelope | null | undefined,
  method: string | undefined,
  unit: EnergyUnitChoice = 'kcal',
): string {
  return method === 'reported'
    ? `${energyText(value, unit)} ${unit} (from the machine)`
    : kcalRangeText(value, range, unit);
}

/** Quiet words for an activity row's Heart Points (no digits): a pending row's never count until approved. */
export const QUIET_ROW_WORDS = {
  earned: 'Heart Points earned',
  onceApproved: 'Heart Points once counted',
} as const;

/**
 * The row's second line: "45 min · about 210 kcal, 160–260 · 18 Heart Points". Quiet mode (0.6.3 S31: words only, no
 * digits): no minutes, no kcal, no score; only whether it carries Heart Points ("Heart Points earned"), else nothing.
 */
export function rowFacts(
  r: Pick<ReviewRow, 'minutes' | 'kcal' | 'heartPoints'> & Partial<Pick<ReviewRow, 'status'>>,
  quiet: boolean,
  unit: EnergyUnitChoice = 'kcal',
): string {
  const pts = r.heartPoints !== null && r.heartPoints > 0;
  if (quiet)
    return pts ? (r.status === 'pending' ? QUIET_ROW_WORDS.onceApproved : QUIET_ROW_WORDS.earned) : '';
  return [
    durationText(r.minutes),
    r.kcal ? bookedKcalText(r.kcal.value, r.kcal.range, r.kcal.method, unit) : null,
    pts ? `${formatNumber(Math.round(r.heartPoints!), 0)} Heart Points` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** (r070) The activity sheet's note on an activity counted automatically, and that the person's change sticks. */
export const AUTO_NOTE_STICKS = 'Edit or remove it and that sticks.';
/** (r070) Health Connect apps the note names by their friendly name (the package is never shown). */
const HC_APP_NAMES: Readonly<Record<string, string>> = {
  'com.google.android.apps.fitness': 'Google Fit',
  'com.google.android.apps.healthdata': 'Health Connect',
  'com.fitbit.FitbitMobile': 'Fitbit',
  'com.sec.android.app.shealth': 'Samsung Health',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect',
  'com.strava': 'Strava',
  'com.huawei.health': 'Huawei Health',
  'com.xiaomi.wearable': 'Mi Fitness',
  'com.ouraring.oura': 'Oura',
  'com.nike.ntc': 'Nike Training Club',
  'com.nike.plusgps': 'Nike Run Club',
  'com.polar.polarflow': 'Polar Flow',
  'com.withings.wiscale2': 'Withings',
};
/** (r070) "Added from Google Fit", "Added from your ring": where an automatically counted activity came from. */
export function autoNoteText(from: { kind: 'healthConnect' | 'gauge' | 'ring' | 'detected'; app?: string }): string {
  if (from.kind === 'gauge') return 'Added from your phone recording';
  if (from.kind === 'ring') return 'Added from your ring';
  if (from.kind === 'detected') return 'Detected and added automatically';
  return `Added from ${(from.app && HC_APP_NAMES[from.app]) || 'Health Connect'}`;
}

/** (0.6.7 AD-VITALS) The words of detected activities (the home server's detection episodes). */
export const DETECTED_WORDS = {
  /** the source word, and the Today list's word beside a detected row */
  detected: 'detected',
  toReview: 'detected, not counted yet',
  counted: 'detected, counted',
  /** the review sheet */
  choose: 'What was it?',
  notExercise: 'Not exercise',
  chooseFirst: 'Choose what it was first',
  onlyAfterApproval: DETECTION_ONLY_AFTER_APPROVAL,
  notExercised: (title: string) => `${title}: marked as not exercise`,
} as const;

/**
 * (0.6.7 AD-VITALS) A review row's name: a detected activity still to review reads by its detection ("Possible treadmill
 * walk", "Possible workout"); a decided one by the type the person approved.
 */
export function rowName(r: Pick<ReviewRow, 'exerciseId' | 'status' | 'detection'>): string {
  if (r.detection && (r.status === 'pending' || r.status === 'possible' || r.detection.needsType))
    return detectionLabelInfo(r.detection.label).title;
  return activityName(r.exerciseId);
}

/** (0.6.7 AD-VITALS) A detected row's evidence in words (sol §3), or null for any other row. */
export const detectedReasonText = (r: Pick<ReviewRow, 'detection'>): string | null =>
  r.detection ? detectionReasonText(r.detection.label, r.detection.reasons, r.detection.coverage) : null;

/**
 * The word beside a row in Today's activities: "not counted yet", "counted", "logged by hand"; (0.6.7) a detected one says so
 * ("detected, not counted yet", "detected, counted"), never "logged by hand".
 */
export function activityRowWord(
  r: Pick<ReviewRow, 'status' | 'updated' | 'sources' | 'detection'>,
  words: { pending: string; byHand: string; updated: string; status: Record<string, string> },
): string {
  if (r.status === 'pending') return r.detection ? DETECTED_WORDS.toReview : words.pending;
  if (r.updated) return words.updated;
  if (r.detection && (r.status === 'approved' || r.status === 'edited')) return DETECTED_WORDS.counted;
  // (0.6.7) a removed hand log is not counted, never "logged by hand"
  if (r.sources.length === 0 && r.status !== 'rejected') return words.byHand;
  return words.status[r.status] ?? '';
}

/**
 * (0.6.7 AD-VITALS) Today's live line of an episode still going on: "Walking now · detected · 18 min" (the minutes of its
 * evidence so far); quiet mode is words only: "Walking now · detected". Null when its newest evidence is older than
 * `staleMs` (the import has not run since: it is not shown as going on now).
 */
export function liveLineText(
  d: Pick<LiveDetection, 'label' | 'start' | 'end'>,
  nowMs: number,
  quiet: boolean,
  staleMs: number,
): string | null {
  if (!(d.end > d.start) || nowMs - d.end > staleMs) return null;
  const verb = detectionLabelInfo(d.label).live;
  if (quiet) return `${verb} · ${DETECTED_WORDS.detected}`;
  return `${verb} · ${DETECTED_WORDS.detected} · ${Math.max(1, Math.round((d.end - d.start) / 60_000))} min`;
}

/** "Looks like your planned walk at 07:00" (§V3.3: a hint, never applied without the person). */
export function planMatchText(
  r: Pick<ReviewRow, 'planMatch'>,
  plannedName?: string | null,
  quiet = false,
): string | null {
  if (!r.planMatch) return null;
  // (0.6.3 INT) quiet mode: no clock time
  if (quiet) return `Looks like your planned ${plannedName ? plannedName.toLowerCase() : 'session'}`;
  // (Claude P3-8) whole minutes first, then split: 7.999 h reads 08:00, never 07:60
  const m = Math.round(r.planMatch.startH * 60);
  const at = `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `Looks like your planned ${plannedName ? plannedName.toLowerCase() : 'session'} at ${at}`;
}

// ------------------------------------------------------------------------------------------- day groups (D18)
export type DayPart = 'morning' | 'afternoon' | 'evening';
export const DAY_PART_LABEL: Record<DayPart, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

/** Morning 05:00–12:00, Afternoon 12:00–17:00, Evening otherwise (P). An untimed stop has no part. */
export function dayPartOf(h: number): DayPart {
  const x = ((h % 24) + 24) % 24;
  if (x >= 5 && x < 12) return 'morning';
  if (x >= 12 && x < 17) return 'afternoon';
  return 'evening';
}

export interface DayGroup<T> {
  part: DayPart;
  rows: T[];
  /** Done (or assumed as planned): a skipped stop is answered, never done (Claude P2-17). */
  done: number;
  /** Answered in any way (done, partly, skipped): a finished part folds away. */
  answered: number;
  /** The group holding the clock now (gold dot and "Now"). */
  now: boolean;
  /** "3 · 2 of 3 done" */
  countText: string;
}

/** Timed stops grouped by part of the day, in day order; only the groups that hold a stop. */
export function dayGroups<T extends { at: number | null }>(
  rows: readonly T[],
  isDone: (r: T) => boolean,
  nowH: number | null,
  isAnswered: (r: T) => boolean = isDone,
): Array<DayGroup<T>> {
  const order: DayPart[] = ['morning', 'afternoon', 'evening'];
  const nowPart = nowH === null ? null : dayPartOf(nowH);
  // a stop before 05:00 (an early fast end, a late meal after midnight) sits with the evening it belongs to
  const by = new Map<DayPart, T[]>();
  for (const r of rows) {
    const p = r.at === null ? 'morning' : dayPartOf(r.at);
    by.set(p, [...(by.get(p) ?? []), r]);
  }
  return order
    .filter((p) => by.has(p))
    .map((p) => {
      const rs = by.get(p)!;
      const done = rs.filter(isDone).length;
      return {
        part: p,
        rows: rs,
        done,
        answered: rs.filter(isAnswered).length,
        now: p === nowPart,
        countText: `${done} of ${rs.length} done`,
      };
    });
}

// ------------------------------------------------------------------------------------------- the 24 h strip (D18)
export const DAY_STRIP_STATES = ['Eating', 'Fast', 'Training', 'Sleep'] as const;

/**
 * The plan day as category segments over [dayStart, dayStart + 24 h): sleep (the template's window), the eating window,
 * the fast outside it, the sessions. Clock hours are the app day's (they may run past 24).
 */
export function dayStripSegments(o: {
  dayStart: number;
  sleep?: { bedH: number; wakeH: number } | null;
  window?: { startH: number; endH: number } | null;
  sessions?: ReadonlyArray<{ startH: number; durationMin: number }>;
}): Array<{ from: number; to: number; state: number }> {
  const H = 3_600_000;
  const day0 = o.dayStart;
  const end = day0 + 24 * H;
  // the app day starts at the rollover, so the clock is measured from that day's midnight
  const midnight = (() => {
    const d = new Date(day0);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const at = (h: number) => Math.max(day0, Math.min(end, midnight + h * H));
  const segs: Array<{ from: number; to: number; state: number }> = [];
  const put = (from: number, to: number, state: number) => {
    if (to > from) segs.push({ from, to, state });
  };
  const sleeps: Array<[number, number]> = [];
  if (o.sleep) {
    const wake = o.sleep.wakeH;
    const bed = o.sleep.bedH < wake ? o.sleep.bedH + 24 : o.sleep.bedH;
    // the morning part: from the day start to the wake time; the night: from bed time to the end
    sleeps.push([day0, at(wake)], [at(bed), end]);
  }
  const awakeFrom = sleeps[0]?.[1] ?? day0;
  const awakeTo = sleeps[1]?.[0] ?? end;
  for (const [a, b] of sleeps) put(a, b, 3);
  if (o.window) {
    const ws = Math.max(awakeFrom, at(o.window.startH));
    const we = Math.min(awakeTo, at(o.window.endH));
    put(awakeFrom, ws, 1);
    put(ws, we, 0);
    put(we, awakeTo, 1);
  }
  // sessions sit on top of whatever they overlap
  const out: Array<{ from: number; to: number; state: number }> = [];
  const sessions = (o.sessions ?? [])
    .map((s) => [at(s.startH), Math.min(end, at(s.startH) + s.durationMin * 60_000)] as [number, number])
    .filter(([a, b]) => b > a);
  for (const s of segs) {
    let pieces: Array<[number, number]> = [[s.from, s.to]];
    for (const [a, b] of sessions)
      pieces = pieces.flatMap(([x, y]) =>
        b <= x || a >= y
          ? [[x, y] as [number, number]]
          : (
              [
                [x, a],
                [b, y],
              ] as Array<[number, number]>
            ).filter(([p, q]) => q > p),
      );
    for (const [x, y] of pieces) out.push({ from: x, to: y, state: s.state });
  }
  for (const [a, b] of sessions) out.push({ from: a, to: b, state: 2 });
  return out.sort((a, b) => a.from - b.from);
}

// ------------------------------------------------------------------------------------------- sleep quick action (D21)
export type SleepAction = 'goingToSleep' | 'imUp';

/**
 * Which one-tap sleep key the day shows: "I'm up" in the morning until the person is up (05:00–12:00, P), "Going to
 * sleep" from 20:00 or from an hour before the planned bed time (P), until lights out is set. Null otherwise.
 */
export function sleepAction(
  nowH: number,
  o: { bedH?: number | null; lightsOutTonight: boolean; upToday: boolean },
): SleepAction | null {
  const h = ((nowH % 24) + 24) % 24;
  if (h >= 5 && h < 12 && !o.upToday) return 'imUp';
  const bed = o.bedH !== null && o.bedH !== undefined ? ((o.bedH % 24) + 24) % 24 : 23;
  const from = Math.min(20, bed - 1 < 12 ? 20 : bed - 1);
  if ((h >= from || h < 4) && !o.lightsOutTonight) return 'goingToSleep';
  return null;
}

/**
 * The waking date a "Going to sleep" tap belongs to, from the CALENDAR date and clock hour of now (Claude P1-3): the next
 * calendar date from 12:00, the calendar date itself after midnight (01:10 on the 27th, still app day the 26th, files
 * under the night ending on the 27th, never the night that already ended).
 */
export function wakingDateOf(calendarDate: string, clockH: number): string {
  return clockH >= 12 ? addDays(calendarDate, 1) : calendarDate;
}

// ------------------------------------------------------------------------------------------- recording
/** A stopwatch from the start: "0:12:41", "1:02:05" (a negative or unknown span reads 0:00:00). */
export function elapsedText(startedAt: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 1000));
  if (!Number.isFinite(s)) return '0:00:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
}

export const RECORD_TYPES = ['walk', 'run', 'cycle', 'other'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
export const RECORD_TYPE_LABEL: Record<RecordType, string> = {
  walk: 'Walk',
  run: 'Run',
  cycle: 'Cycle',
  other: 'Other',
};
export const recordTypeWord = (t: string): string =>
  (RECORD_TYPE_LABEL as Record<string, string>)[t]?.toLowerCase() ?? 'activity';

// ------------------------------------------------------------------------------------------- time scrubber
export interface ScrubModel {
  /** The span the scrubber covers (ms), a margin around the recorded window. */
  from: number;
  to: number;
  /** One bar per minute: steps (or the HR when steps are absent), null = no reading. */
  bars: Array<{ t: number; v: number | null }>;
  max: number;
  kind: 'steps' | 'hr' | 'none';
}

/** The minute chart under the scrubber: the window with 15 min either side (clipped to the evidence). */
export function scrubModel(
  window: { start: number; end: number },
  evidence:
    | { first: number; steps: readonly (number | null)[]; hr?: { bpm: readonly (number | null)[] } }
    | null
    | undefined,
  marginMin = 15,
): ScrubModel {
  const from = window.start - marginMin * 60_000;
  const to = window.end + marginMin * 60_000;
  const bars: ScrubModel['bars'] = [];
  const steps = evidence?.steps ?? [];
  const hr = evidence?.hr?.bpm ?? [];
  const hasSteps = steps.some((v) => v !== null && v > 0);
  const kind: ScrubModel['kind'] = !evidence
    ? 'none'
    : hasSteps
      ? 'steps'
      : hr.some((v) => v !== null)
        ? 'hr'
        : 'none';
  for (let t = from; t < to; t += 60_000) {
    const k = evidence ? Math.floor((t - evidence.first) / 60_000) : -1;
    const v =
      k >= 0 ? (kind === 'steps' ? (steps[k] ?? null) : kind === 'hr' ? (hr[k] ?? null) : null) : null;
    bars.push({ t, v });
  }
  const max = Math.max(1, ...bars.map((b) => b.v ?? 0));
  return { from, to, bars, max, kind };
}

/** A late stop: the last minute with movement (steps above `floor`) inside the window, if it is well before the end. */
export function lastMovingMinute(
  window: { start: number; end: number },
  evidence: { first: number; steps: readonly (number | null)[] } | null | undefined,
  floor = 20,
): number | null {
  if (!evidence) return null;
  let last: number | null = null;
  for (let t = window.start; t < window.end; t += 60_000) {
    const v = evidence.steps[Math.floor((t - evidence.first) / 60_000)];
    if (v !== null && v !== undefined && v >= floor) last = t + 60_000;
  }
  return last !== null && window.end - last >= 5 * 60_000 ? last : null;
}

// ------------------------------------------------------------------------------------------- energy chart (§V4.1)
export const STATE_ORDER: readonly EnergyState[] = [
  'sleep',
  'resting',
  'light',
  'active',
  'exercise',
  'unknown',
];
export const STATE_LABEL: Record<EnergyState, string> = {
  sleep: 'Sleep',
  resting: 'Resting',
  light: 'Light',
  active: 'Active',
  exercise: 'Exercise',
  unknown: 'Unknown',
};

export interface EnergyColumn {
  start: number;
  /**
   * kcal of the 15 min by state, as the engine allocated them (UI audit #4: the bin's `stateBodyKcal`, so a bout's exercise
   * energy stays on its minutes) and the state's minutes; empty for a planned column.
   */
  parts: Array<{ state: EnergyState; kcal: number; minutes: number }>;
  tef: number;
  total: number;
  /** Movement above own rest (D15) in the bin: steps energy, the rest of NEAT and exercise. */
  active: number;
  /** After now: the plan for the rest of the day (one bar, no states: nothing has happened yet). */
  future: boolean;
}

/** The 15-min columns of the day (§V4.1: stacked time states before now, the plan after, TEF its own thin band). */
export function energyColumns(day: Pick<EnergyDay, 'bins15'>, nowMs: number): EnergyColumn[] {
  return day.bins15.map((b) => {
    const future = b.start >= nowMs;
    const parts = future
      ? []
      : STATE_ORDER.map((st) => ({
          state: st,
          kcal: b.stateBodyKcal[st] ?? 0,
          minutes: b.stateMin[st] ?? 0,
        })).filter((p) => p.kcal > 0);
    const active = Math.max(0, b.components.stepsEnergy + b.components.neatBase + b.components.exercise);
    return { start: b.start, parts, tef: b.components.tef, total: b.kcal, active, future };
  });
}

/** Kcal and minutes by state before now, and the plan for the rest (the chart in words). */
export function energySplit(cols: readonly EnergyColumn[]): {
  byState: Record<EnergyState, { kcal: number; minutes: number }>;
  planned: { kcal: number; minutes: number };
  total: number;
} {
  const byState = Object.fromEntries(STATE_ORDER.map((s) => [s, { kcal: 0, minutes: 0 }])) as Record<
    EnergyState,
    { kcal: number; minutes: number }
  >;
  const planned = { kcal: 0, minutes: 0 };
  let total = 0;
  for (const c of cols) {
    total += c.total;
    if (c.future) {
      planned.kcal += c.total - c.tef;
      planned.minutes += 15;
      continue;
    }
    for (const p of c.parts) {
      byState[p.state].kcal += p.kcal;
      byState[p.state].minutes += p.minutes;
    }
  }
  return { byState, planned, total };
}

/**
 * "Energy through the day, estimated: 1 420 kcal so far, about 2 610 by bedtime; sleep 610, …; the rest as planned 1 190."
 * In the person's energy unit (0.6.3 S31; stored kcal).
 */
export function spokenEnergy(
  split: ReturnType<typeof energySplit>,
  soFar: number | null,
  tef: number,
  unit: EnergyUnitChoice = 'kcal',
): string {
  const t = (v: number) => energyText(v, unit);
  const parts = STATE_ORDER.filter((s) => split.byState[s].kcal > 0.5).map(
    (s) => `${STATE_LABEL[s].toLowerCase()} ${t(split.byState[s].kcal)}`,
  );
  const rest = split.planned.kcal > 0.5 ? `; the rest of the day as planned ${t(split.planned.kcal)}` : '';
  return `Energy through the day, estimated: ${soFar !== null ? `${t(soFar)} ${unit} so far, ` : ''}about ${t(split.total)} by bedtime; ${parts.join(', ')}${rest}; food digestion ${t(tef)} (modelled).`;
}

/**
 * (UI audit #22) The Active view in words: movement above own rest (steps, the rest of NEAT and exercise) before now and
 * planned after, with the busiest quarter hour. No resting energy, no food digestion: what the bars show.
 */
export function spokenActive(cols: readonly EnergyColumn[], unit: EnergyUnitChoice = 'kcal'): string {
  const t = (v: number) => energyText(v, unit);
  let past = 0;
  let ahead = 0;
  let peak: EnergyColumn | null = null;
  for (const c of cols) {
    if (c.future) ahead += c.active;
    else {
      past += c.active;
      if (!peak || c.active > peak.active) peak = c;
    }
  }
  const at =
    peak && peak.active > 0.5 ? `; most at ${clockText(peak.start)} (${t(peak.active)} in 15 min)` : '';
  const rest = ahead > 0.5 ? `; the rest of the day as planned ${t(ahead)}` : '';
  return `Active energy through the day, movement above your own rest, estimated: ${t(past)} ${unit} so far, about ${t(past + ahead)} by bedtime${at}${rest}.`;
}

// ------------------------------------------------------------------------------------------- steps by source (§V4.1)
export interface StepsHour {
  start: number;
  ring: number | null;
  phone: number | null;
  selected: number | null;
  /** The counted steps of the hour came from: ring, phone or both. */
  from: 'ring' | 'phone' | 'both' | null;
  /** Ring and phone disagree by more than 20 % where both saw the hour (D1). */
  disagree: boolean;
}

const sum = (xs: ReadonlyArray<number | null>): number | null => {
  let s = 0;
  let any = false;
  for (const x of xs) {
    if (x === null || !Number.isFinite(x)) continue;
    s += x;
    any = true;
  }
  return any ? s : null;
};

/** (r068 B1) A coarse record's or part's steps and the instant that places it in an hour (its last instant). */
export function coarseAt(v: unknown, at: 'end' | 'at'): { ms: number; steps: number; lineage: string | null } | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const ms = typeof o[at] === 'string' ? Date.parse(o[at] as string) - (at === 'end' ? 1 : 0) : NaN;
  const steps = typeof o.steps === 'number' && Number.isFinite(o.steps) ? o.steps : null;
  return Number.isFinite(ms) && steps !== null ? { ms, steps, lineage: typeof o.lineage === 'string' ? o.lineage : null } : null;
}

/**
 * The day's timeline by hour: ring, phone and the selected count (never max, never a sum of the two).
 *
 * (r068 B1) Each lane takes its minute values and, from a server that sends them, its coarse records whole in the hour
 * they ended (`ringCoarse`, `phoneCoarse`); the counted lane takes the minutes the fusion placed and each unplaced coarse
 * unit's parts in the hour each ended, so its hours add up to the located total. Nothing coarse is split across hours.
 */
export function stepsHours(t: Pick<GaugeTimeline, 'date' | 'start' | 'minutes' | 'steps'>): StepsHour[] {
  const first = t.start ? Date.parse(t.start) : Date.parse(`${t.date}T00:00:00`);
  const nh = Math.ceil(t.minutes / 60);
  const hourOf = (ms: number) => {
    const h = Math.floor((ms - first) / 3_600_000);
    return h >= 0 && h < nh ? h : -1;
  };
  const extra = { ring: Array<number | null>(nh).fill(null), phone: Array<number | null>(nh).fill(null), selected: Array<number | null>(nh).fill(null) };
  const extraFrom: Array<Set<string>> = Array.from({ length: nh }, () => new Set());
  const add = (lane: keyof typeof extra, h: number, v: number) => {
    if (h >= 0) extra[lane][h] = (extra[lane][h] ?? 0) + v;
  };
  for (const r of t.steps.ringCoarse ?? []) {
    const c = coarseAt(r, 'end');
    if (c) add('ring', hourOf(c.ms), c.steps);
  }
  for (const r of t.steps.phoneCoarse ?? []) {
    const c = coarseAt(r, 'end');
    if (c) add('phone', hourOf(c.ms), c.steps);
  }
  for (const u of t.steps.coarse ?? []) {
    if (typeof u !== 'object' || u === null || (u as { placed?: unknown }).placed === true) continue;
    const lineage = typeof (u as { lineage?: unknown }).lineage === 'string' ? ((u as { lineage: string }).lineage) : null;
    const parts = (u as { parts?: unknown }).parts;
    for (const p of Array.isArray(parts) ? parts : []) {
      const c = coarseAt(p, 'at');
      const h = c ? hourOf(c.ms) : -1;
      if (!c || h < 0) continue;
      add('selected', h, c.steps);
      if (lineage) extraFrom[h]!.add(lineage.startsWith('ring') ? 'ring' : lineage.startsWith('phone') ? 'phone' : lineage);
    }
  }
  const plus = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);
  const out: StepsHour[] = [];
  for (let h = 0; h * 60 < t.minutes; h++) {
    const a = h * 60;
    const b = Math.min(t.minutes, a + 60);
    const ring = plus(sum(t.steps.ring.slice(a, b)), extra.ring[h] ?? null);
    const phone = plus(sum(t.steps.phone.slice(a, b)), extra.phone[h] ?? null);
    const selected = plus(sum(t.steps.selected.slice(a, b)), extra.selected[h] ?? null);
    const srcs = new Set([
      ...t.steps.source
        .slice(a, b)
        .filter((s): s is string => !!s)
        .map((s) => (s.startsWith('ring') ? 'ring' : s.startsWith('phone') ? 'phone' : s)),
      ...extraFrom[h]!,
    ]);
    const from =
      srcs.size === 0
        ? null
        : srcs.size > 1
          ? 'both'
          : (([...srcs][0] === 'ring' ? 'ring' : 'phone') as 'ring' | 'phone');
    const disagree =
      ring !== null &&
      phone !== null &&
      Math.max(ring, phone) >= 100 &&
      Math.abs(ring - phone) / Math.max(ring, phone) > 0.2;
    out.push({ start: first + a * 60_000, ring, phone, selected, from, disagree });
  }
  return out;
}

/** (UI audit #6) A lane's total over the hours; null when no hour of it has a reading (never an observed zero). */
export function laneTotal(hours: readonly StepsHour[], key: 'ring' | 'phone' | 'selected'): number | null {
  return sum(hours.map((h) => h[key]));
}

/** "Ring and phone", "Ring", "Phone": the lineage chip of the day's steps. */
export function lineageText(lineages: readonly string[]): string | null {
  const ring = lineages.some((l) => l.startsWith('ring'));
  const phone = lineages.some((l) => l.startsWith('phone'));
  if (ring && phone) return 'Ring and phone';
  if (ring) return 'Ring';
  if (phone) return 'Phone';
  return lineages.length ? 'Health Connect' : null;
}

// ------------------------------------------------------------------------------------------- Heart Points (§V4.1)
export const HEART_POINTS_GOAL = 150;
export const HEART_POINTS_LABEL = 'Heart Points (Fit-compatible estimate)';

/** The week's Heart Points in quiet words (no digits, 0.6.3 S31). */
export const HEART_POINTS_QUIET = {
  met: 'goal met this week',
  onTrack: 'on track this week',
  building: 'building this week',
  none: 'No readings',
} as const;

/**
 * Quiet words for the week's points against the goal: met at the goal, on track when at or past the goal's share of the
 * days so far (`daysIn` of 7, Monday = 1), building otherwise; unknown (null) is "No readings", never zero.
 */
export function heartPointsQuietText(week: number | null, daysIn = 7): string {
  if (week === null) return HEART_POINTS_QUIET.none;
  if (week >= HEART_POINTS_GOAL) return HEART_POINTS_QUIET.met;
  const share = Math.min(7, Math.max(1, daysIn)) / 7;
  return week > 0 && week >= HEART_POINTS_GOAL * share
    ? HEART_POINTS_QUIET.onTrack
    : HEART_POINTS_QUIET.building;
}

/**
 * The pending activities' Heart Points today (named apart: "12 more once counted"; they never count). Today's and the week's
 * counted points come from the shared day calculation (`ActivityData.useHeartPoints`, UI audit #5), never from here.
 */
export function pendingHeartPoints(
  pending: ReadonlyArray<Pick<ReviewRow, 'date' | 'heartPoints'>>,
  today: string,
): number {
  return Math.round(pending.filter((r) => r.date === today).reduce((s, r) => s + (r.heartPoints ?? 0), 0));
}
