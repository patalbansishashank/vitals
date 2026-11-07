/*
 * The V4c screenshot harness's day (dev only, never in the app's routes): a believable Tuesday of the owner's plan with
 * the real V2/V3 functions on synthetic evidence. A morning walk the ring and phone saw (Gauge recorded it; it looks like
 * the planned 07:30 walk), stairs at noon the step detector found, badminton yesterday evening from Health Connect, the
 * minute timeline (ring and phone steps, supported HR, last night's sleep), the engine-shaped hours of the day (RMR, food
 * digestion, steps and exercise energy, the plan for the hours ahead) and an in-memory review store the sheets change.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { createGaugeCommandsController, type GaugeCommandsController } from '@/state/gaugeCommands';
import { makeCommandsFixture } from '@/features/ring/commands';
import type { GaugeCommandsApi, GaugeRecordingState } from '@/net/gaugeCommands';
import type { GaugeTimeline } from '@/net/gauge';
import {
  decided,
  defaultDecision,
  editRevisionOf,
  estimateFor,
  isTombstone,
  isUpdated,
  reviewSheetModel,
  revisionOf,
  type ActivityCandidateDoc,
  type CandidateDecision,
  type CandidateRecord,
  type PersonForEstimate,
} from '@/living/activityCandidates';
import { decisionEstimateRequest, editedDecision } from '@/commands/living/activity';
import { exerciseRecordOf } from '@/living/sensors/activityEnergy';
import { dayHeartPoints, type DayBout } from '../../progress/data/actuals';
import { minuteIndex } from '../../progress/data/timelines';
import { energyDay, energyToday, type EnergyHour } from '@/living/sensors/energyDay';
import { freezeZoneBoundaries, hrProfile } from '@/living/sensors';
import { STEPS_REMAINDER_ASSUMPTION } from '@/living/todayReplay';
import { addDays } from '@/living/dates';
import type { ActivityData, PreviewOutcome } from '../../activity/data';
import { boutsOf, frozenZonesOf, heartPointsView, minutesFor, zonesFromSettings } from '../../activity/data';
import type { ActionOutcome } from '../../data/actions';
import { ringActivities, type SessionEntry } from '@/features/ring/activities';

export type Scene = 'pending' | 'nodevice' | 'manual' | 'overplan' | 'recording' | 'noweight';

const PERSON: PersonForEstimate = { massKg: 82.4, ageY: 38, sex: 'male', rmrKcalPerDay: 1780 };
const MIN = 60_000;
const H = 3_600_000;

/** Deterministic noise in [0, 1). */
const noise = (k: number) => {
  const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export interface DayFixture {
  today: string;
  nowMs: number;
  midnight: number;
  scene: Scene;
  device: boolean;
}

export function dayFixture(today: string, nowMs: number, scene: Scene): DayFixture {
  return {
    today,
    nowMs,
    midnight: new Date(`${today}T00:00:00`).getTime(),
    scene,
    device: scene !== 'nodevice' && scene !== 'manual',
  };
}

// ------------------------------------------------------------------------------------------- the minute timeline
type Span = { from: number; to: number; ring: number; phone: number | null; hr?: number };

function spans(f: DayFixture): Span[] {
  const at = (h: number) => f.midnight + h * H;
  const s: Span[] = [
    // the walk: the ring and the phone in a pocket agree; the last 6 min are standing at the door
    { from: at(7 + 5 / 60), to: at(7 + 44 / 60), ring: 112, phone: 108, hr: 118 },
    { from: at(7 + 44 / 60), to: at(7 + 50 / 60), ring: 4, phone: 3, hr: 96 },
    { from: at(7 + 50 / 60), to: at(8.6), ring: 16, phone: 15 },
    // the desk morning: the phone on the desk sees nothing
    { from: at(9), to: at(12.1), ring: 4, phone: null },
    { from: at(12 + 10 / 60), to: at(12 + 24 / 60), ring: 74, phone: 70, hr: 124 },
    { from: at(12.4), to: at(13.5), ring: 12, phone: 11 },
    // the afternoon: ring and phone disagree in one hour (a phone in a bag on a walk to the shop)
    { from: at(15), to: at(15.6), ring: 46, phone: 31 },
    { from: at(16), to: at(17.4), ring: 14, phone: 13 },
  ];
  if (f.scene === 'overplan')
    s.push(
      { from: at(17.5), to: at(18 + 40 / 60), ring: 158, phone: 154, hr: 152 },
      { from: at(18.7), to: at(21.5), ring: 11, phone: 10 },
    );
  if (f.scene === 'recording') s.splice(1);
  return s;
}

export function timelineFixture(f: DayFixture): GaugeTimeline | null {
  if (!f.device) return null;
  const n = 1440;
  const steps = {
    selected: Array<number | null>(n).fill(null),
    source: Array<string | null>(n).fill(null),
    ring: Array<number | null>(n).fill(null),
    phone: Array<number | null>(n).fill(null),
    support: Array<'minute' | null>(n).fill(null),
  };
  const hr = { bpm: Array<number | null>(n).fill(null), supportedS: Array<number | null>(n).fill(null) };
  const stage = Array<'light' | 'deep' | 'rem' | 'awake' | null>(n).fill(null);
  const nowK = Math.floor((f.nowMs - f.midnight) / MIN);
  // last night: asleep to 06:32, awake after
  for (let k = 0; k < 392; k++)
    stage[k] = k % 90 < 18 ? 'deep' : k % 90 > 70 ? 'rem' : k === 200 || k === 201 ? 'awake' : 'light';
  for (let k = 0; k < nowK && k < n; k++) {
    // the ring's quiet minutes: zero steps while worn and awake
    if (k >= 392) {
      steps.ring[k] = 0;
      steps.selected[k] = 0;
      steps.source[k] = 'ring';
      steps.support[k] = 'minute';
    }
    if (k % 5 === 0 && k >= 392) {
      hr.bpm[k] = 68 + Math.round(noise(k) * 8);
      hr.supportedS[k] = 15;
    }
    if (k < 392 && k % 5 === 0) {
      hr.bpm[k] = 54 + Math.round(noise(k) * 6);
      hr.supportedS[k] = 15;
    }
  }
  for (const s of spans(f)) {
    for (let t = s.from; t < s.to && t < f.nowMs; t += MIN) {
      const k = Math.floor((t - f.midnight) / MIN);
      const r = Math.max(0, Math.round(s.ring * (0.85 + noise(k) * 0.3)));
      const p = s.phone === null ? null : Math.max(0, Math.round(s.phone * (0.85 + noise(k + 7) * 0.3)));
      steps.ring[k] = r;
      steps.phone[k] = p;
      // one source per interval: the ring (preference), the phone where the ring saw no gait
      steps.selected[k] = r;
      steps.source[k] = 'ring';
      steps.support[k] = 'minute';
      if (s.hr) {
        hr.bpm[k] = Math.round(s.hr + (noise(k + 3) - 0.5) * 10);
        hr.supportedS[k] = 60;
      }
    }
  }
  return {
    available: true,
    source: 'gauge',
    date: f.today,
    tz: 'Asia/Kolkata',
    start: new Date(f.midnight).toISOString(),
    minutes: n,
    steps,
    hr,
    sleep: { stage },
    sessions: [],
    hcExercise: [],
    acquisition: { ring: [], phone: [] },
  } as unknown as GaugeTimeline;
}

const sumSteps = (t: GaugeTimeline | null) =>
  t ? t.steps.selected.reduce<number>((s, v) => s + (v ?? 0), 0) : 0;

// ------------------------------------------------------------------------------------------- candidates
function windowMinutes(t: GaugeTimeline | null) {
  if (!t) return null;
  return {
    first: Date.parse(t.start!),
    steps: t.steps.selected,
    hr: { bpm: t.hr.bpm, supportedS: t.hr.supportedS },
  };
}

function candidate(
  f: DayFixture,
  o: {
    key: string;
    exerciseId: string;
    date?: string;
    start: number;
    end: number;
    sources: ActivityCandidateDoc['sources'];
    why: string[];
    planMatch?: ActivityCandidateDoc['planMatch'];
    vendor?: Array<{ source: string; kcal: number }>;
    evidence: ReturnType<typeof windowMinutes>;
    status?: 'pending' | 'approved';
    manual?: boolean;
    intensity?: { class: 'light' | 'moderate' | 'vigorous' };
  },
): ActivityCandidateDoc {
  const window = { start: o.start, end: o.end };
  const estimate = estimateFor({
    exerciseId: o.exerciseId,
    window,
    person: PERSON,
    minutes: o.evidence,
    keytelEnabled: true,
    ...(o.vendor ? { vendor: o.vendor } : {}),
    ...(o.intensity ? { intensity: o.intensity } : {}),
  });
  const sourceRevision = revisionOf(o.key, null);
  const doc: ActivityCandidateDoc = {
    key: o.key,
    date: o.date ?? f.today,
    tz: 'Asia/Kolkata',
    startAt: new Date(o.start).toISOString(),
    endAt: new Date(o.end).toISOString(),
    window,
    refs: o.manual ? [`manual:${o.key}`] : o.sources.map((s) => s.ref),
    sources: o.sources,
    sourceRevision,
    estimateRevision: 'e1',
    revision: revisionOf(sourceRevision, 'e1'),
    suggested: { exerciseId: o.exerciseId, confidence: 'high', needsReview: false, why: o.why },
    measures: {
      durationMin: (o.end - o.start) / MIN,
      steps: null,
      medianCadence: null,
      hrSupportedS: null,
      meanHr: null,
    },
    estimate,
    corroboratedBy: [],
    mergeSuggestions: [],
    planMatch: o.planMatch ?? null,
    status: 'pending',
    decidedRevision: null,
    entryId: null,
    decidedAt: null,
    decidedBy: null,
    decision: null,
    decidedEstimate: null,
    history: [],
    firstSeenAt: new Date(o.end + 20 * MIN).toISOString(),
    updatedAt: new Date(o.end + 20 * MIN).toISOString(),
    resolvedAt: null,
    evidence: o.evidence,
  };
  return o.status === 'approved'
    ? decided(doc, {
        status: 'approved',
        decidedRevision: doc.revision,
        entryId: `e-${o.key}`,
        decision: defaultDecision(doc),
        estimate,
        now: new Date(o.end + 30 * MIN).toISOString(),
      })
    : doc;
}

export function candidatesFixture(f: DayFixture, t: GaugeTimeline | null): ActivityCandidateDoc[] {
  const at = (h: number, date = f.today) => new Date(`${date}T00:00:00`).getTime() + h * H;
  const ev = windowMinutes(t);
  const y = addDays(f.today, -1);
  const out: ActivityCandidateDoc[] = [];
  if (f.device && f.scene !== 'recording') {
    out.push(
      candidate(f, {
        key: 'WALKAM00000000000000000001',
        exerciseId: 'walk_brisk',
        start: at(7 + 5 / 60),
        end: at(7 + 50 / 60),
        sources: [
          { source: 'gaugeSession', ref: 'gauge:w-0705', revision: 'r1', confidence: 'high' },
          { source: 'ringTelemetry', ref: 'ring:0705', revision: 'r1', confidence: 'medium' },
        ],
        why: ['recorded in the ring app'],
        planMatch: {
          itemId: 'cardioSession:14:0',
          slotKey: '14:0',
          startH: 7.5,
          deltaH: -0.42,
          sameFamily: true,
        },
        vendor: [{ source: 'Phone estimate', kcal: 241 }],
        evidence: ev,
        status: f.scene === 'overplan' ? 'approved' : 'pending',
      }),
      candidate(f, {
        key: 'STAIRS00000000000000000002',
        exerciseId: 'stair_climb',
        start: at(12 + 10 / 60),
        end: at(12 + 24 / 60),
        sources: [
          { source: 'cadenceDetector', ref: 'detect:cadence:1210', revision: 'r1', confidence: 'medium' },
        ],
        why: ['steady cadence for 14 min'],
        evidence: ev,
        status: f.scene === 'overplan' ? 'approved' : 'pending',
      }),
    );
    if (f.scene !== 'overplan')
      out.push(
        candidate(f, {
          key: 'BADMIN00000000000000000003',
          exerciseId: 'badminton',
          date: y,
          start: at(19, y),
          end: at(20 + 10 / 60, y),
          sources: [{ source: 'hcSession', ref: 'hc:strava-88', revision: 'r1', confidence: 'high' }],
          why: ['a Health Connect session from another app'],
          evidence: null,
        }),
      );
    if (f.scene === 'overplan')
      out.push(
        candidate(f, {
          key: 'RUNPM000000000000000000004',
          exerciseId: 'jog_outdoor',
          start: at(17.5),
          end: at(18 + 40 / 60),
          sources: [
            { source: 'gaugeSession', ref: 'gauge:r-1730', revision: 'r1', confidence: 'high' },
            { source: 'ringTelemetry', ref: 'ring:1730', revision: 'r1', confidence: 'medium' },
          ],
          why: ['recorded in the ring app'],
          vendor: [{ source: 'Phone estimate', kcal: 812 }],
          evidence: ev,
          status: 'approved',
        }),
      );
  }
  if (f.scene === 'manual')
    out.push(
      candidate(f, {
        key: 'YOGA0000000000000000000005',
        exerciseId: 'hatha_yoga',
        start: at(7),
        end: at(7.75),
        sources: [],
        why: ['logged by hand'],
        evidence: null,
        status: 'approved',
        manual: true,
        intensity: { class: 'moderate' },
      }),
    );
  return out;
}

// ------------------------------------------------------------------------------------------- the day's hours
/** Engine-shaped hours of the app day (04:00 to 04:00): actual through now, the plan's remainder after. */
function hoursFixture(
  f: DayFixture,
  t: GaugeTimeline | null,
  recs: readonly CandidateRecord[],
  planOnly: boolean,
): EnergyHour[] {
  const start = f.midnight + 4 * H;
  const rmrH = PERSON.rmrKcalPerDay! / 24;
  const meals: Array<[number, number]> = [
    [12.5, 760],
    [16.5, 390],
    [19.5, 900],
  ];
  const bouts = planOnly ? [] : boutsOf(recs, f.today);
  const out: EnergyHour[] = [];
  for (let j = 0; j < 24; j++) {
    const h0 = start + j * H;
    const clock = 4 + j;
    const past = !planOnly && h0 + H <= f.nowMs;
    // steps of the hour: the timeline's before now, the plan's share after (9 000 over the awake day)
    let steps = 0;
    // steps inside an approved bout are that bout's (the engine's stepsIncluded): never counted twice
    const inBout = (ms: number) => bouts.some((b) => ms >= b.window.start && ms < b.window.end);
    if (past && t)
      for (let k = 0; k < 60; k++)
        if (!inBout(h0 + k * MIN)) steps += t.steps.selected[Math.floor((h0 - f.midnight) / MIN) + k] ?? 0;
        else if (clock >= 6.5 && clock < 23) steps = 9000 / 16.5;
    const asleep = clock < 6.5 || clock >= 23;
    const tef = meals.reduce((s, [mh, kc]) => s + (clock >= mh && clock < mh + 4 ? (kc * 0.1) / 4 : 0), 0);
    const stepsEnergy = steps * 0.035;
    const neatBase = asleep ? 0 : 22;
    let exercise = 0;
    for (const b of bouts) {
      const ov = Math.max(0, Math.min(h0 + H, b.window.end) - Math.max(h0, b.window.start)) / MIN;
      exercise += ov * (b.incrementalKcalPerMin ?? 0);
    }
    if (planOnly && clock === 7) exercise += 150;
    out.push({
      start: h0,
      rmr: rmrH,
      tef,
      neat: neatBase + stepsEnergy,
      stepsEnergy,
      exerciseEnergy: exercise,
      tdee: rmrH + tef + neatBase + stepsEnergy + exercise,
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- previews, zones, points
/** The boundaries the harness froze into its approved entries (at 38 years, before any waking resting HR). */
const APPROVAL_ZONES = freezeZoneBoundaries(hrProfile({ ageY: PERSON.ageY }));

/** `previewEstimate` over the harness's person (the commands' own request; `noWeight`: no weight on record). */
function fixturePreview(
  c: ActivityCandidateDoc | undefined,
  draft: CandidateDecision | null,
  noWeight: boolean,
): PreviewOutcome {
  if (!c) return { estimate: null, missing: null };
  const decide = (d: CandidateDecision): PreviewOutcome =>
    noWeight
      ? { estimate: null, missing: 'weight' }
      : { estimate: estimateFor(decisionEstimateRequest(c, d, PERSON, true)), missing: null };
  if (draft) return decide(draft);
  if (c.status !== 'pending' && !isUpdated(c))
    return { estimate: c.decidedEstimate ?? c.estimate, missing: null };
  if (c.status === 'edited' && c.decision) return decide(c.decision);
  return c.estimate ? { estimate: c.estimate, missing: null } : decide(defaultDecision(c));
}

/** Earlier days of the harness's week (Monday): a known day of points. */
const EARLIER_POINTS = 34;

/** Heart Points of the harness's days by Progress's own day calculation (`dayHeartPoints`, approved bouts only). */
function fixtureHeartPoints(
  f: DayFixture,
  t: GaugeTimeline | null,
  recs: readonly CandidateRecord[],
  from: string,
  to: string,
): Array<{ date: string; heartPoints: number | null }> {
  const out: Array<{ date: string; heartPoints: number | null }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d !== f.today) {
      out.push({ date: d, heartPoints: f.device ? EARLIER_POINTS : null });
      continue;
    }
    const bouts: DayBout[] = boutsOf(recs, d).map((b) => {
      const c = recs.find((r) => r.key === b.id) as ActivityCandidateDoc | undefined;
      const e = c?.decidedEstimate ?? c?.estimate ?? null;
      const ex = c ? exerciseRecordOf(c.decision?.exerciseId ?? c.suggested.exerciseId) : null;
      return {
        id: b.id,
        window: b.window,
        met: e?.engineDose?.met ?? null,
        gait: ex?.cardioModality === 'walk' || ex?.cardioModality === 'run' ? ex.cardioModality : null,
        incrementalKcalPerMin: b.incrementalKcalPerMin ?? null,
        envelope: b.envelope ?? null,
      };
    });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    out.push({
      date: d,
      heartPoints: dayHeartPoints({
        start: f.midnight + 4 * H,
        end: f.nowMs,
        minuteAt: minuteIndex([t], tz),
        bouts,
        ageY: PERSON.ageY,
      }),
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- the harness's data
export function fixtureActivityData(
  f: DayFixture,
  o: { quiet: boolean; commands: GaugeCommandsController },
): ActivityData {
  const timeline = timelineFixture(f);
  let records: CandidateRecord[] = candidatesFixture(f, timeline);
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  };
  const get = () => records;
  const change = (next: CandidateRecord[]): ActionOutcome => {
    const before = records;
    records = next;
    emit();
    return {
      ok: true,
      undo: async () => {
        records = before;
        emit();
        return { ok: true };
      },
    };
  };
  const find = (id: string) =>
    records.find((r) => r.key === id && !isTombstone(r)) as ActivityCandidateDoc | undefined;
  const nowIso = () => new Date(f.nowMs).toISOString();
  const approve = (ids: readonly string[]) =>
    records.map((r) =>
      !isTombstone(r) && ids.includes(r.key)
        ? decided(r, {
            status: 'approved',
            decidedRevision: r.revision,
            entryId: `e-${r.key}`,
            decision: defaultDecision(r),
            estimate: r.estimate,
            now: nowIso(),
          })
        : r,
    );
  let todayCache: { recs: CandidateRecord[]; value: ReturnType<ActivityData['useToday']> } | null = null;
  const todayView = () => {
    if (todayCache && todayCache.recs === records) return todayCache.value;
    const hours = hoursFixture(f, timeline, records, false);
    const plan = hoursFixture(f, timeline, records, true);
    const planDay = energyDay({ hours: plan, minutes: [], bouts: [] });
    const located = f.device ? sumSteps(timeline) : null;
    const awake = { from: f.midnight + 6.5 * H, to: f.midnight + 23 * H };
    const remaining = Math.max(
      0,
      Math.min(1, (awake.to - Math.max(f.nowMs, awake.from)) / (awake.to - awake.from)),
    );
    const uncovered = f.device ? 0 : Math.max(0, 1 - remaining);
    const prior = Math.round(9000 * (remaining + uncovered));
    const value = {
      model: {
        date: f.today,
        quiet: o.quiet,
        steps: {
          fusedSoFar: located,
          rxSteps: 9000,
          remainingAwakeFrac: remaining,
          uncoveredAwakeFrac: uncovered,
          prior,
          total: (located ?? 0) + prior,
          sessionIncludedSteps: 0,
          assumption: STEPS_REMAINDER_ASSUMPTION,
          status: f.device ? ('observed' as const) : ('asPlanned' as const),
          lineages: f.device ? ['ring', 'phone'] : [],
          headlinePolicy: f.device ? ('located' as const) : null,
          goal: { value: 9000, source: 'plan' as const },
        },
        energy: o.quiet
          ? null
          : {
              ...energyToday({
                run: hours,
                now: f.nowMs,
                planDay: { total: planDay.total, active: planDay.active },
              }),
              label: 'estimated' as const,
            },
        provisional: records
          .filter(
            (r): r is ActivityCandidateDoc => !isTombstone(r) && r.status === 'pending' && r.date === f.today,
          )
          .map((r) => ({ id: r.key, window: { ...r.window }, kcal: r.estimate?.booked.grossKcal ?? null })),
        assumptions: ['habitualBaseline:stepsRemainderPlanShare'],
        sessions: { linked: [], unplanned: [], prescribed: [], skipped: [] },
      },
      day: o.quiet
        ? null
        : energyDay({ hours, minutes: minutesFor(hours, timeline), bouts: boutsOf(records, f.today) }),
      plan: o.quiet ? null : planDay,
      energyBasis: { weightKg: 82.4, formula: 'Mifflin–St Jeor' as const },
    };
    todayCache = { recs: records, value };
    return value;
  };
  return {
    useReview: (from, to) => {
      const recs = useSyncExternalStore(subscribe, get, get);
      return reviewSheetModel(recs, { from, to, quiet: o.quiet, provisionalOverlay: true });
    },
    useCandidate: (id) => {
      const recs = useSyncExternalStore(subscribe, get, get);
      const c = id ? recs.find((r) => r.key === id) : undefined;
      return c && !isTombstone(c) ? c : null;
    },
    useToday: (date, isToday) => {
      useSyncExternalStore(subscribe, get, get);
      return isToday && date === f.today ? todayView() : null;
    },
    useTimeline: (date) => (date === f.today ? timeline : null),
    useStepsDay: (date) => {
      if (date !== f.today || !timeline) return null;
      const located = sumSteps(timeline);
      return {
        date,
        located,
        ringDailyTotal: located + 640,
        ringResidual: 640,
        headline: located,
        headlinePolicy: 'located',
        coverage: { ringMin: 820, phoneMin: 610, eitherMin: 840, unknownMin: 0 },
      };
    },
    approve: async (id) => change(approve([id])),
    approveAll: async (items) => change(approve(items.map((i) => i.id))),
    edit: async (input) => {
      const c = find(input.id);
      if (!c) return { ok: false, message: 'That activity is no longer in the review list.' };
      if (f.scene === 'noweight')
        return { ok: false, message: 'Vitals needs your body weight to estimate the energy.' };
      // the command's own merge and estimate inputs (`editedDecision`, `decisionEstimateRequest`)
      const decision = editedDecision(c, input);
      const window = { start: Date.parse(decision.startAt), end: Date.parse(decision.endAt) };
      const estimate = estimateFor(decisionEstimateRequest(c, decision, PERSON, true));
      return change(
        records.map((r) =>
          r.key === c.key
            ? {
                ...decided(c, {
                  status: 'edited',
                  decidedRevision: editRevisionOf(c.revision, decision),
                  entryId: `e-${c.key}-2`,
                  decision,
                  estimate,
                  now: nowIso(),
                }),
                window,
              }
            : r,
        ),
      );
    },
    reject: async (id) => {
      const c = find(id);
      if (!c) return { ok: false };
      return change(
        records.map((r) =>
          r.key === id
            ? decided(c, {
                status: 'rejected',
                decidedRevision: c.revision,
                entryId: null,
                decision: null,
                estimate: null,
                now: nowIso(),
              })
            : r,
        ),
      );
    },
    usePreview: (id, draft) => {
      const recs = useSyncExternalStore(subscribe, get, get);
      return useMemo(
        () =>
          fixturePreview(
            recs.find((r) => r.key === id && !isTombstone(r)) as ActivityCandidateDoc | undefined,
            draft,
            f.scene === 'noweight',
          ),
        [recs, id, draft],
      );
    },
    useZoneBoundaries: (id) => {
      const recs = useSyncExternalStore(subscribe, get, get);
      const c = (id ? recs.find((r) => r.key === id && !isTombstone(r)) : undefined) as
        ActivityCandidateDoc | undefined;
      // an approved activity's boundaries are the ones frozen at approval (the harness froze them at 38 years, no RHR)
      return (
        frozenZonesOf(
          c ?? null,
          c?.entryId ? { kind: 'session', zones: APPROVAL_ZONES ?? undefined } : null,
        ) ?? zonesFromSettings(PERSON.ageY, null, c?.sleepingLowHr)
      );
    },
    useHeartPoints: (from, to) => {
      const recs = useSyncExternalStore(subscribe, get, get);
      return useMemo(
        () => heartPointsView(fixtureHeartPoints(f, timeline, recs, from, to), to),
        [recs, from, to],
      );
    },
    // (r069 D4) an earlier day on the Energy page: the same synthetic day moved back, as its whole realised run
    useDayEnergy: (date) => {
      useSyncExternalStore(subscribe, get, get);
      return useMemo(() => {
        if (o.quiet || date >= f.today)
          return { status: 'ready' as const, day: null, basis: null, missing: null };
        const back = Date.parse(`${f.today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`);
        const hours = hoursFixture(f, timeline, records, false).map((h) => ({ ...h, start: h.start - back }));
        return {
          status: 'ready' as const,
          day: energyDay({ hours, minutes: [], bouts: [] }),
          basis: 'body' as const,
          missing: null,
        };
      }, [date]);
    },
    // (r069 D4) a period's past days: the synthetic day's total, a little different each day (weekends quieter)
    useEnergyDays: (dates) => {
      const key = dates.join(',');
      return useMemo(() => {
        if (o.quiet) return { status: 'ready' as const, days: [], missing: null };
        const base = hoursFixture(f, timeline, records, false);
        const day = energyDay({ hours: base, minutes: [], bouts: [] });
        return {
          status: 'ready' as const,
          missing: null,
          days: dates
            .filter((d) => d < f.today)
            .map((d, i) => {
              const k = 0.86 + 0.22 * noise(i + d.length * 7 + Number(d.slice(8, 10)));
              const c = day.components;
              return {
                date: d,
                kcal: day.total * k,
                kinds: {
                  resting: (c.rmr + c.other) * k,
                  movement: (c.neatBase + c.stepsEnergy) * k,
                  digestion: c.tef * k,
                  exercise: (c.exercise + c.recovery) * k,
                },
                components: Object.fromEntries(
                  Object.entries(c).map(([key, value]) => [key, value * k]),
                ) as typeof c,
                envelope: { lo: day.envelope.lo * k, hi: day.envelope.hi * k },
                energyBasis: { weightKg: 82.4, formula: 'Mifflin–St Jeor' as const },
              };
            }),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key]);
    },
    // (r069 D4) the Ring's canonical list over the harness's records: each decided one as its session entry
    useDayActivities: (date) => {
      const recs = useSyncExternalStore(subscribe, get, get);
      return useMemo(
        () =>
          ringActivities({
            sessions: sessionsOfRecords(recs),
            candidates: recs,
            from: addDays(date as never, -1),
            to: date as never,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        [recs, date],
      );
    },
    commands: () => o.commands,
  };
}

/** (r069 D4) The session entries the harness's decided records stand for (as `activity.approve` writes them). */
function sessionsOfRecords(recs: readonly CandidateRecord[]): SessionEntry[] {
  const out: SessionEntry[] = [];
  for (const r of recs) {
    if (isTombstone(r) || (r.status !== 'approved' && r.status !== 'edited') || !r.entryId) continue;
    const w = r.decision
      ? { start: Date.parse(r.decision.startAt), end: Date.parse(r.decision.endAt) }
      : r.window;
    const e = r.decidedEstimate ?? r.estimate;
    out.push({
      id: r.entryId,
      date: r.date,
      kind: 'session',
      status: 'done',
      durationMin: Math.round((w.end - w.start) / MIN),
      performed: [{ exerciseId: r.decision?.exerciseId ?? r.suggested.exerciseId }],
      physicalBoutId: r.key,
      candidate: {
        key: r.key,
        decidedRevision: r.decidedRevision ?? r.revision,
        sourceRevision: r.sourceRevision,
        estimateRevision: null,
        estimatorVersion: 'fixture',
        ...(r.refs.every((x) => x.startsWith('manual:')) ? { manual: true as const } : {}),
      },
      occurrence: {
        precision: 'interval',
        interval: { start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() },
      },
      ...(e
        ? {
            cost: {
              grossKcal: e.booked.grossKcal,
              ownRestKcal: 0,
              netAboveRestKcal: 0,
              displacedLifestyleKcal: null,
              incrementalKcal: null,
              method: e.booked.method,
              source: 'estimated',
              envelope: e.booked.envelope,
            },
          }
        : {}),
    } as unknown as SessionEntry);
  }
  return out;
}

/** Gauge on the phone, paired and polling; with `recording`, a walk started at 07:05 is under way. */
export function commandsFixture(f: DayFixture): GaugeCommandsController {
  const base = makeCommandsFixture({ delayMs: 600 });
  let recording: GaugeRecordingState | null =
    f.scene === 'recording'
      ? {
          sessionId: 'w-0705',
          status: 'recording',
          type: 'walk',
          startedAt: new Date(f.midnight + (7 + 5 / 60) * H).toISOString(),
        }
      : null;
  const api: GaugeCommandsApi = {
    ...base,
    async watch(id, w) {
      const r = await base.watch(id, w);
      if (r.ok && r.command.state === 'done') {
        const t = r.command.type;
        if (t === 'workout.start') {
          const type = (r.command.payload as { type?: string }).type ?? 'walk';
          recording = {
            sessionId: `s-${id.slice(0, 6)}`,
            status: 'recording',
            type,
            startedAt: new Date().toISOString(),
          };
          return { ...r, command: { ...r.command, result: { state: 'recording', ...recording } } };
        }
        if (t === 'workout.pause' && recording) recording = { ...recording, status: 'paused' };
        if (t === 'workout.resume' && recording) recording = { ...recording, status: 'recording' };
        if (t === 'workout.stop') recording = null;
      }
      return r;
    },
    async state() {
      const s = await base.state();
      return s.ok ? { ok: true, state: { ...s.state, recording } } : s;
    },
  };
  return createGaugeCommandsController({
    api,
    local: { probe: async () => false, run: async () => ({ kind: 'fallback' }) },
  });
}
