// @vitest-environment node
/**
 * V3 living plan (energy SPEC §V3, RESEARCH VI checks): candidate identity and revisions, the session entry an approval
 * writes, today's replay (actual so far + plan remainder), the coverage split, the realised-history hash additions, the
 * fused-steps import and the forecast-only departure. Pure layers only; the command scenarios are in
 * `src/commands/living/__tests__/activity.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { realisedHistoryHash } from '@/lib/bodyContracts';
import { detectActivities } from '../sensors/activityDetect';
import { activityEnergy } from '../sensors/activityEnergy';
import {
  candidateKeyOf,
  checkApprovable,
  compactEstimate,
  compactResolved,
  decided,
  defaultDecision,
  estimateFor,
  isUpdated,
  overlappingBouts,
  planCandidateUpsert,
  planMatchOf,
  reviewSheetModel,
  sessionEntryOf,
  type ActivityCandidateDoc,
  type CandidateRecord,
} from '../activityCandidates';
import { awakeFractions, todayActual, STEPS_REMAINDER_ASSUMPTION } from '../todayReplay';
import { todayEnergyStepsModel } from '../todayModel';
import { freezePrescription, DEFAULT_ITEM_WEIGHTS } from '../prescription';
import { toLoggedDay } from '../loggedDay';
import { catalogueEquivalence } from '../equivalence';
import { localToInstant } from '../dates';
import { sensorLineageOf } from '../realisedHistory';
import { planGaugeImport, gaugeKey } from '../gaugeImport';
import { evaluateTriggers, exerciseDeparted } from '../replan';
import type { LogEntry, PlanDoc, PlanVersionDoc, PrescribedDaySnapshot } from '../types';

const TZ = 'Asia/Kolkata';
const NOW = '2026-10-21T06:30:00.000Z'; // 12:00 in Kolkata
const MAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 80 },
  startDate: '2026-10-19',
};
const WALK_DAY: DayTemplate = {
  id: 'W',
  label: 'walk day',
  energy: { kind: 'kcal', kcal: 2200 },
  macros: {
    protein: { unit: 'g', value: 150 },
    carbs: { unit: 'g', value: 220 },
    fat: { unit: 'remainder' },
  },
  exercise: [{ kind: 'cardio', modality: 'walk', startH: 7, durationMin: 30 }],
  steps: 10000,
  sleep: { bedH: 23, wakeH: 7 },
};
const SCHED: Schedule = {
  schemaVersion: 1,
  startDate: '2026-10-19',
  horizonDays: 14,
  programs: [WALK_DAY],
  days: Array.from({ length: 14 }, () => ({ program: 0 })),
};
const plan: PlanDoc & { id: string } = {
  id: 'p1',
  name: 'Plan',
  rung: 'medium',
  origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-18T10:00:00.000Z' },
  status: 'active',
  startDate: '2026-10-19',
  plannedEndDate: '2026-11-02',
  request: { profile: MAN, goals: [], horizonDays: 14 },
  baselineProfile: MAN,
  headVersion: 1,
  pauses: [],
  intentions: {},
  policy: { checkInWeekday: 0, autoApplyLoadLowering: true },
  createdAt: '2026-10-18T10:00:00.000Z',
};
const version: PlanVersionDoc = {
  planId: 'p1',
  version: 1,
  parent: null,
  status: 'adopted',
  reason: 'start',
  effectiveFromDay: 0,
  schedule: SCHED,
  genome: null,
  sessions: {},
  sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
  forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] },
  explanation: [],
  provenance: { engineVersion: 'x', registryHash: 'y', catalogueVersion: 'z' },
  createdBy: { kind: 'system' },
  createdAt: '2026-10-18T10:00:00.000Z',
};
const rx = (date: string): PrescribedDaySnapshot => freezePrescription({ plan, version, date, tz: TZ });
const PERSON = { massKg: 80, ageY: 40, sex: 'male' as const, rmrKcalPerDay: 1800 };
const STIM = {
  effectiveSetsByRegion: {},
  pattern: 'gait',
  loadClass: 'light',
  netKcal: 0,
  mem: 0,
  hiMinutes: 0,
  mobilityMinutes: {},
} as unknown as Extract<LogEntry, { kind: 'session' }>['stimulus'];

const at = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));

function walkDraft(date: string, startH: number, minutes: number, id = 'w1', revision = 'r1') {
  const start = at(date, startH);
  return detectActivities({
    gaugeSessions: [{ id, revision, start, end: start + minutes * 60_000, type: 'walk' }],
    mintKey: () => '',
  });
}

function importOnce(
  existing: Map<string, CandidateRecord>,
  refIndex: Map<string, string>,
  drafts: ReturnType<typeof detectActivities>,
  now = NOW,
) {
  const plan = planCandidateUpsert({
    drafts: drafts.drafts,
    absorbed: drafts.absorbed,
    existing,
    refIndex,
    estimateOf: (d) =>
      estimateFor({
        exerciseId: d.suggested.exerciseId,
        window: d.window,
        person: PERSON,
        keytelEnabled: true,
      }),
    tz: TZ,
    now,
  });
  for (const p of plan.puts) existing.set(p.key, p);
  for (const r of plan.records) existing.set(r.key, r);
  for (const r of plan.refs) refIndex.set(r.ref, r.key);
  return plan;
}

describe('candidate identity and revisions (C11)', () => {
  it('mints one stable key per first evidence; a re-import with the same evidence writes nothing', () => {
    const existing = new Map<string, CandidateRecord>();
    const refs = new Map<string, string>();
    const first = importOnce(existing, refs, walkDraft('2026-10-20', 7, 45));
    expect(first.outcomes.map((o) => o.outcome)).toEqual(['created']);
    const key = first.puts[0]!.key;
    expect(key).toBe(candidateKeyOf('gauge:w1', at('2026-10-20', 7), TZ));
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(refs.get('gauge:w1')).toBe(key);
    const again = importOnce(existing, refs, walkDraft('2026-10-20', 7, 45));
    expect(again.puts).toEqual([]);
    expect(again.outcomes.map((o) => o.outcome)).toEqual(['unchanged']);
    // a second device with the same evidence computes the same key and revision
    const other = importOnce(new Map(), new Map(), walkDraft('2026-10-20', 7, 45));
    expect(other.puts[0]!.key).toBe(key);
    expect(other.puts[0]!.revision).toBe(first.puts[0]!.revision);
  });

  it('a new source revision updates a pending candidate, marks an automatic decision "updated", and never touches the person\'s decision (r070)', () => {
    const decide = (by?: 'auto') => {
      const existing = new Map<string, CandidateRecord>();
      const refs = new Map<string, string>();
      const c = importOnce(existing, refs, walkDraft('2026-10-20', 7, 45)).puts[0]!;
      const approved = decided(c, {
        status: 'approved',
        decidedRevision: c.revision,
        entryId: 'E1',
        decision: defaultDecision(c),
        estimate: c.estimate,
        now: NOW,
        ...(by ? { by } : {}),
      });
      existing.set(c.key, approved);
      expect(isUpdated(approved)).toBe(false);
      // (0.6.7) a materially longer bout (a few minutes' wobble keeps the decision: sameBooked)
      const up = importOnce(existing, refs, walkDraft('2026-10-20', 7, 60, 'w1', 'r2'));
      return { c, up, after: existing.get(c.key) as ActivityCandidateDoc };
    };
    // (r070, owner 2026-10-30: "I approved something, it comes back in review") the person's decision stands whatever its source does
    const mine = decide();
    expect(mine.up.outcomes[0]!.outcome).not.toBe('updated');
    expect(mine.after.status).toBe('approved');
    expect(mine.after.entryId).toBe('E1');
    expect(mine.after.decidedRevision).toBe(mine.c.revision);
    expect(mine.after.updatedFrom).toBeUndefined();
    expect(isUpdated(mine.after)).toBe(false);
    expect(checkApprovable(mine.after, mine.c.revision)).toBeNull();
    // an automatic decision follows its source: marked, then booked again by planAutoAccept
    const auto = decide('auto');
    expect(auto.up.outcomes[0]!.outcome).toBe('updated');
    expect(auto.after.status).toBe('approved');
    expect(auto.after.entryId).toBe('E1');
    expect(auto.after.decidedRevision).toBe(auto.c.revision);
    expect(isUpdated(auto.after)).toBe(true);
    expect(checkApprovable(auto.after, auto.c.revision)?.code).toBe('conflict');
    expect(checkApprovable(auto.after, auto.after.revision)).toBeNull();
  });

  it('a rejected key is never re-created, and its tombstone keeps the refs after 90 days', () => {
    const existing = new Map<string, CandidateRecord>();
    const refs = new Map<string, string>();
    const c = importOnce(existing, refs, walkDraft('2026-10-20', 7, 45)).puts[0]!;
    existing.set(
      c.key,
      decided(c, {
        status: 'rejected',
        decidedRevision: c.revision,
        entryId: null,
        decision: null,
        estimate: null,
        now: NOW,
      }),
    );
    expect(
      importOnce(existing, refs, walkDraft('2026-10-20', 7, 45, 'w1', 'r9')).outcomes.map((o) => o.outcome),
    ).toEqual(['blocked']);
    expect((existing.get(c.key) as ActivityCandidateDoc).status).toBe('rejected');
    const later = new Date(Date.parse(NOW) + 91 * 86_400_000).toISOString();
    const tombs = compactResolved([...existing.values()], later);
    // (0.6.3 FX1) with its source refs, so a later upstream deletion can still reach it
    expect(tombs).toEqual([
      {
        key: c.key,
        compact: true,
        refs: ['gauge:w1'],
        status: 'rejected',
        decidedRevision: c.revision,
        entryId: null,
        resolvedAt: NOW,
        sources: ['gauge:w1'],
      },
    ]);
    existing.set(c.key, tombs[0]!);
    expect(
      importOnce(existing, refs, walkDraft('2026-10-20', 7, 45, 'w1', 'r10'), later).outcomes.map(
        (o) => o.outcome,
      ),
    ).toEqual(['blocked']);
  });

  it('upstream deletion supersedes a pending candidate', () => {
    const existing = new Map<string, CandidateRecord>();
    const refs = new Map<string, string>();
    const c = importOnce(existing, refs, walkDraft('2026-10-20', 7, 45)).puts[0]!;
    const p = planCandidateUpsert({
      drafts: [],
      existing,
      refIndex: refs,
      deletedRefs: ['gauge:w1'],
      tz: TZ,
      now: NOW,
    });
    expect(p.outcomes).toEqual([{ key: c.key, ref: 'gauge:w1', outcome: 'superseded' }]);
    expect(p.puts[0]!.status).toBe('superseded');
  });
});

describe('the review model and plan matching', () => {
  it('lists pending rows, binds approve-all to the visible revisions, hides kcal in quiet mode', () => {
    const existing = new Map<string, CandidateRecord>();
    const refs = new Map<string, string>();
    importOnce(existing, refs, walkDraft('2026-10-20', 7, 45, 'a'));
    importOnce(existing, refs, walkDraft('2026-10-20', 18, 30, 'b'));
    const m = reviewSheetModel([...existing.values()], { from: '2026-10-20', to: '2026-10-20' });
    expect(m.rows).toHaveLength(2);
    expect(m.strip?.text).toMatch(/^2 activities to review · 75 min · ~\d+ kcal$/);
    expect(m.approveAll.items).toEqual(m.rows.map((r) => ({ id: r.id, revision: r.revision })));
    const quiet = reviewSheetModel([...existing.values()], { quiet: true });
    expect(quiet.strip?.text).toBe('2 activities to review · 75 min');
    expect(quiet.rows.every((r) => r.kcal === null)).toBe(true);
  });

  it('hints the planned session of the same family within ±3 h, never another family', () => {
    const sessions = rx('2026-10-20').sessions;
    const hint = planMatchOf('walk', at('2026-10-20', 8.5), TZ, 4, sessions);
    expect(hint).toMatchObject({ itemId: `cardioSession:${sessions[0]!.slotKey}`, deltaH: 1.5 });
    expect(planMatchOf('walk', at('2026-10-20', 11), TZ, 4, sessions)).toBeNull();
    expect(planMatchOf('mudgar_pair', at('2026-10-20', 7), TZ, 4, sessions)).toBeNull();
  });
});

describe('the session an approval writes (§V3.2)', () => {
  const existing = new Map<string, CandidateRecord>();
  const c = importOnce(existing, new Map(), walkDraft('2026-10-20', 7, 45)).puts[0]!;
  const withSteps: ActivityCandidateDoc = { ...c, measures: { ...c.measures, steps: 4800 } };

  it('one done session: estimated cost with its ledger, the V1.5 engine dose, gait steps inside it, the device source', () => {
    const { id, entry } = sessionEntryOf({
      candidate: withSteps,
      decision: defaultDecision(withSteps),
      estimate: c.estimate!,
      decidedRevision: c.revision,
      stimulus: STIM,
      catalogueVersion: 'cat',
      edited: false,
      tz: TZ,
      now: NOW,
    });
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(entry).toMatchObject({
      kind: 'session',
      status: 'done',
      date: '2026-10-20',
      startH: 7,
      durationMin: 45,
      provenance: 'estimated',
      physicalBoutId: c.key,
      stepsIncluded: 4800,
      extra: true,
    });
    expect(entry.source).toMatchObject({
      by: 'device',
      method: 'biometrics',
      app: 'gauge',
      deviceKey: `gauge:activity:${c.key}`,
    });
    expect(entry.cost).toMatchObject({
      source: 'estimated',
      inputsProvenance: { duration: 'measured', hr: 'assumed' },
    });
    expect(entry.cost!.incrementalKcal).toBeCloseTo(
      entry.cost!.netAboveRestKcal - entry.cost!.displacedLifestyleKcal!,
      6,
    );
    const eng = entry.engine![0]!;
    expect(eng).toMatchObject({
      kind: 'cardio',
      modality: 'walk',
      startH: 7,
      durationMin: 45,
      realisedGrossKcal: c.estimate!.cost.grossKcal,
      stepsIncluded: 4800,
      sessionId: c.key,
    });
    expect(entry.candidate).toMatchObject({
      key: c.key,
      decidedRevision: c.revision,
      estimatorVersion: c.estimate!.booked.version,
    });
    // an edit is the person's (typed), keeps the device key, and names the slot it was
    const ed = sessionEntryOf({
      candidate: withSteps,
      decision: { ...defaultDecision(withSteps), asItemId: 'cardioSession:1:0' },
      estimate: c.estimate!,
      decidedRevision: 'x',
      stimulus: STIM,
      catalogueVersion: 'cat',
      edited: true,
      tz: TZ,
      now: NOW,
      supersedes: id,
    });
    expect(ed.entry.source).toMatchObject({
      by: 'user',
      method: 'typed',
      deviceKey: `gauge:activity:${c.key}`,
    });
    expect(ed.entry).toMatchObject({ itemId: 'cardioSession:1:0', supersedes: id });
    expect(ed.entry.extra).toBeUndefined();
  });

  it('a non-gait, gripping bout never creates sets: the dose stays unknown', () => {
    const e = estimateFor({
      exerciseId: 'mudgar_pair',
      window: { start: at('2026-10-20', 18), end: at('2026-10-20', 18.5) },
      person: PERSON,
      keytelEnabled: true,
    })!;
    const { entry } = sessionEntryOf({
      candidate: c,
      decision: {
        exerciseId: 'mudgar_pair',
        startAt: localToInstant('2026-10-20', 18, TZ),
        endAt: localToInstant('2026-10-20', 18.5, TZ),
      },
      estimate: e,
      decidedRevision: 'r',
      stimulus: STIM,
      catalogueVersion: 'c',
      edited: true,
      tz: TZ,
      now: NOW,
    });
    expect(entry.engine![0]).toMatchObject({ kind: 'resistance', doseStatus: 'unknown' });
    expect(entry.stepsIncluded).toBeUndefined();
  });

  it('a manual window overlapping an approved device bout by ≥ 50 % is a conflict', () => {
    const appr = decided(c, {
      status: 'approved',
      decidedRevision: c.revision,
      entryId: 'E1',
      decision: defaultDecision(c),
      estimate: c.estimate,
      now: NOW,
    });
    expect(overlappingBouts({ start: at('2026-10-20', 7.25), end: at('2026-10-20', 8) }, [appr])).toEqual([
      {
        key: c.key,
        entryId: 'E1',
        overlapPct: 67,
        status: 'approved',
        auto: false,
        exerciseId: appr.decision!.exerciseId,
        startAt: appr.decision!.startAt,
        endAt: appr.decision!.endAt,
      },
    ]);
    expect(overlappingBouts({ start: at('2026-10-20', 7.6), end: at('2026-10-20', 9) }, [appr])).toEqual([]);
  });

  it('an edit with the machine’s kcal books it as reported', () => {
    const base = estimateFor({ exerciseId: 'walk', window: c.window, person: PERSON, keytelEnabled: true })!;
    const typed = estimateFor({
      exerciseId: 'walk',
      window: c.window,
      person: PERSON,
      keytelEnabled: true,
      kcalOverride: 410,
    })!;
    expect(typed.booked).toMatchObject({ estimator: 'reported', grossKcal: 410 });
    expect(typed.comparisons.map((x) => x.estimator)).toContain('met');
    expect(base.booked.grossKcal).not.toBe(410);
  });
});

describe('the RESEARCH VI checks over the logged day', () => {
  const date = '2026-10-20';
  const prescription = rx(date);
  const slot = prescription.sessions[0]!;
  const itemId = `cardioSession:${slot.slotKey}`;
  const existing = new Map<string, CandidateRecord>();
  const c = importOnce(existing, new Map(), walkDraft(date, 7, 45)).puts[0]!;
  const approved = (asItemId?: string): LogEntry =>
    ({
      ...sessionEntryOf({
        candidate: { ...c, measures: { ...c.measures, steps: 4800 } },
        decision: defaultDecision(c, asItemId),
        estimate: c.estimate!,
        decidedRevision: c.revision,
        stimulus: STIM,
        catalogueVersion: 'cat',
        edited: false,
        tz: TZ,
        now: NOW,
      }).entry,
      id: 'A1',
      ...(asItemId ? { link: { planId: 'p1', version: 1, itemId: asItemId } } : {}),
    }) as LogEntry;
  const day = (entries: LogEntry[]) =>
    toLoggedDay({
      date,
      planStart: plan.startDate,
      tz: TZ,
      prescription,
      entries,
      expected: () => 0.75,
      equivalence: catalogueEquivalence,
      final: true,
    });

  it('a 30-min planned walk replaced by an approved 45-min walk appears once', () => {
    const r = day([approved(itemId)]);
    expect(r.loggedDay.inputs.exercise).toHaveLength(1);
    expect(r.loggedDay.inputs.exercise![0]).toMatchObject({ durationMin: 45, sessionId: c.key });
    expect(r.exercise).toMatchObject({
      plannedItemsResolved: true,
      sensorCoverage: 'observed',
      logged: 1,
      withCost: 1,
    });
    expect(r.exercise.netAboveRestKcal).toBeCloseTo(c.estimate!.cost.netAboveRestKcal, 6);
    // without the link it is an extra bout beside the (unknown) planned one: the planned slot is not resolved
    const extra = day([approved()]);
    expect(extra.loggedDay.inputs.exercise!.length).toBe(2);
    expect(extra.exercise.plannedItemsResolved).toBe(false);
    expect(extra.exercise.netAboveRestKcal).toBeNull();
  });

  it('fused total-day steps know the overlap from the approved gait bout', () => {
    const steps = {
      id: 'S1',
      date,
      tz: TZ,
      kind: 'steps',
      steps: 12000,
      scope: 'totalDay',
      source: {
        by: 'device',
        method: 'biometrics',
        app: 'gauge',
        deviceKey: gaugeKey('steps', date),
        sources: ['phone', 'ring'],
      },
      fusion: {
        version: 'steps-fuse/1',
        located: 12000,
        headlinePolicy: 'located',
        coverage: { ringMin: 900, phoneMin: 600, eitherMin: 1000, unknownMin: 440 },
      },
    } as LogEntry;
    const r = day([approved(itemId), steps]);
    expect(r.loggedDay.inputs.sessionIncludedSteps).toBe(4800);
    expect(r.assumptions.map((a) => a.reasonCode)).not.toContain('stepsOverlapUnknown');
    expect(r.assumptions.map((a) => a.reasonCode)).not.toContain('stepsSessionOverlapUnknown');
  });

  it('an off-wrist day is not skipped: no device data is unknown, never a zero', () => {
    const r = day([]);
    expect(r.coverage.steps).toBe('unknown');
    expect(r.exercise.netAboveRestKcal).toBeNull();
    expect(r.exercise.sensorCoverage).toBe('unknown');
    expect(r.loggedDay.inputs.steps === undefined || r.loggedDay.inputs.steps > 0).toBe(true);
    expect(r.loggedDay.items.find((x) => x.itemId === itemId)?.status).toBe('unknown');
  });
});

describe("today's replay (§V3.4)", () => {
  const date = '2026-10-21';
  const prescription = rx(date);
  const itemId = `cardioSession:${prescription.sessions[0]!.slotKey}`;
  const steps = (n: number, eitherMin?: number): LogEntry =>
    ({
      id: 'S',
      date,
      tz: TZ,
      kind: 'steps',
      steps: n,
      scope: 'totalDay',
      source: { by: 'device', method: 'biometrics', app: 'gauge', deviceKey: gaugeKey('steps', date) },
      ...(eitherMin !== undefined
        ? {
            fusion: {
              version: 'steps-fuse/1',
              located: n,
              headlinePolicy: 'located',
              coverage: { ringMin: eitherMin, phoneMin: 0, eitherMin, unknownMin: 0 },
            },
          }
        : {}),
    }) as LogEntry;

  it('a noon partial step count does not zero the afternoon (the plan share of the rest is a named prior)', () => {
    const t = todayActual({
      date,
      prescription,
      headTemplate: prescription.template,
      entries: [steps(4000)],
      nowMs: Date.parse(NOW),
      tz: TZ,
    });
    const aw = awakeFractions({ bedH: 23, wakeH: 7 }, 12);
    expect(aw.remaining).toBeCloseTo(11 / 16, 9);
    expect(t.steps).toMatchObject({
      fusedSoFar: 4000,
      rxSteps: 10000,
      assumption: STEPS_REMAINDER_ASSUMPTION,
      status: 'inferred',
    });
    expect(t.template.steps).toBe(Math.round(4000 + 10000 * (11 / 16)));
    expect(t.assumptions).toContain(`habitualBaseline:${STEPS_REMAINDER_ASSUMPTION}`);
    expect(t.template.observed?.assumptionIds).toContain(
      `${date}:habitualBaseline:${STEPS_REMAINDER_ASSUMPTION}`,
    );
    // the unperformed planned walk stays prescribed at full dose
    expect(t.sessions.prescribed).toEqual([itemId]);
    expect(t.template.exercise).toHaveLength(1);
  });

  it('a morning gap with no step coverage gets the same prior, never zero', () => {
    // 12:00: 300 awake minutes elapsed, only 120 covered → 180 more minutes at the plan share
    const t = todayActual({
      date,
      prescription,
      headTemplate: prescription.template,
      entries: [steps(2000, 120)],
      nowMs: Date.parse(NOW),
      tz: TZ,
    });
    expect(t.steps.uncoveredAwakeFrac).toBeCloseTo(180 / 960, 9);
    expect(t.template.steps).toBe(Math.round(2000 + 10000 * (11 / 16 + 180 / 960)));
  });

  it('a linked approved actual replaces its slot; an unplanned one is added; the energy model has one authority', () => {
    const c = importOnce(new Map(), new Map(), walkDraft(date, 7, 60)).puts[0]!;
    const linked = {
      ...sessionEntryOf({
        candidate: c,
        decision: defaultDecision(c, itemId),
        estimate: c.estimate!,
        decidedRevision: c.revision,
        stimulus: STIM,
        catalogueVersion: 'c',
        edited: false,
        tz: TZ,
        now: NOW,
      }).entry,
      id: 'L',
    } as LogEntry;
    const c2 = importOnce(new Map(), new Map(), walkDraft(date, 9, 30, 'w2')).puts[0]!;
    const extra = {
      ...sessionEntryOf({
        candidate: c2,
        decision: defaultDecision(c2),
        estimate: c2.estimate!,
        decidedRevision: c2.revision,
        stimulus: STIM,
        catalogueVersion: 'c',
        edited: false,
        tz: TZ,
        now: NOW,
      }).entry,
      id: 'X',
    } as LogEntry;
    const t = todayActual({
      date,
      prescription,
      headTemplate: prescription.template,
      entries: [linked, extra],
      nowMs: Date.parse(NOW),
      tz: TZ,
    });
    expect(t.sessions).toMatchObject({
      linked: [{ itemId, entryId: 'L' }],
      unplanned: ['X'],
      prescribed: [],
    });
    expect(t.template.exercise!.map((x) => x.durationMin)).toEqual([60, 30]);
    // no steps logged yet: the whole day is the plan's (no fused count, no zero)
    expect(t.template.steps).toBe(10000);
    const run = Array.from({ length: 24 }, (_, h) => ({
      start: at(date, 4) + h * 3_600_000,
      rmr: 75,
      tef: 10,
      neat: 20,
      stepsEnergy: 5,
      exerciseEnergy: h === 3 ? 200 : 0,
      tdee: h === 3 ? 305 : 105,
    }));
    const m = todayEnergyStepsModel({ actual: t, run, planRun: run, nowMs: at(date, 12), quiet: false });
    expect(m.energy).toMatchObject({ byBedtime: 23 * 105 + 305, plan: 23 * 105 + 305, label: 'estimated' });
    expect(m.energy!.soFar).toBeCloseTo(7 * 105 + 305, 6);
    expect(m.steps.goal).toEqual({ value: 10000, source: 'plan' });
    expect(todayEnergyStepsModel({ actual: t, run, nowMs: at(date, 12), quiet: true }).energy).toBeNull();
  });
});

describe('the realised-history hash additions (§V3.8)', () => {
  it('carries the fusion and estimator versions and each approved decision revision; absent otherwise', () => {
    const s = {
      id: 'S',
      date: '2026-10-20',
      tz: TZ,
      kind: 'steps',
      steps: 9000,
      source: { by: 'device', method: 'biometrics' },
      fusion: { version: 'steps-fuse/1', located: 9000, headlinePolicy: 'located' },
    } as LogEntry;
    const a = {
      id: 'A',
      date: '2026-10-20',
      tz: TZ,
      kind: 'session',
      status: 'done',
      performed: [],
      stimulus: STIM,
      catalogueVersion: 'c',
      source: { by: 'device', method: 'biometrics' },
      candidate: {
        key: 'K',
        decidedRevision: 'R1',
        sourceRevision: 's',
        estimateRevision: 'e',
        estimatorVersion: 'compendium-met/1',
      },
    } as LogEntry;
    expect(sensorLineageOf([], '2026-10-21')).toBeNull();
    const l = sensorLineageOf([s, a], '2026-10-21')!;
    expect(l).toEqual({
      fusionVersions: ['steps-fuse/1'],
      estimatorVersions: ['compendium-met/1'],
      decisions: [{ date: '2026-10-20', entryId: 'A', candidateKey: 'K', decidedRevision: 'R1' }],
    });
    // a later decision revision of the same bout changes the hash (a late edit invalidates from its day)
    const edited = {
      ...a,
      candidate: { ...(a as { candidate: object }).candidate, decidedRevision: 'R2' },
    } as LogEntry;
    const h = (x: unknown) =>
      realisedHistoryHash({
        kind: 'vitals.realisedHistory',
        contractVersion: 1,
        reducerVersion: 2,
        anchor: {
          planId: 'p',
          anchorDate: 'd',
          anchorDay: 0,
          stateHash: 's',
          profileHash: 'p',
          rolloverH: 4,
          rolloverVersion: 1,
          tz: TZ,
        },
        asOf: NOW,
        days: [],
        events: [],
        fasts: [],
        assumptions: [],
        uncertaintyGroups: [],
        sensors: x,
      } as never);
    expect(h(l)).not.toBe(h(sensorLineageOf([s, edited], '2026-10-21')));
    // today's entries are not part of the elapsed history
    expect(sensorLineageOf([s, a], '2026-10-20')).toBeNull();
  });
});

describe('fused steps import (§V3.6)', () => {
  const fused = (date: string, steps: number) => ({
    date,
    steps,
    fusion: { version: 'steps-fuse/1', located: steps, headlinePolicy: 'located' as const },
    sources: ['ring', 'phone'],
  });
  const ringEntry: LogEntry = {
    id: 'G1',
    date: '2026-10-19',
    tz: TZ,
    at: '2026-10-20T00:00:00.000Z',
    kind: 'steps',
    steps: 9000,
    scope: 'totalDay',
    source: { by: 'device', method: 'biometrics', app: 'gauge', deviceKey: gaugeKey('steps', '2026-10-19') },
  } as LogEntry;

  it('the first fused run supersedes each ring-only entry once; then it holds', () => {
    const p = planGaugeImport({
      entries: [ringEntry],
      steps: [fused('2026-10-19', 9000)],
      sleep: [],
      tz: TZ,
      today: '2026-10-21',
      now: NOW,
    });
    expect(p.create).toHaveLength(1);
    expect(p.create[0]!.entry).toMatchObject({
      steps: 9000,
      supersedes: 'G1',
      sourceVersion: 'steps-fuse/1',
      fusion: { version: 'steps-fuse/1' },
      source: { sources: ['phone', 'ring'] },
    });
    const next = { ...(p.create[0]!.entry as object), id: p.create[0]!.id } as LogEntry;
    const again = planGaugeImport({
      entries: [ringEntry, next],
      steps: [fused('2026-10-19', 9000)],
      sleep: [],
      tz: TZ,
      today: '2026-10-21',
      now: NOW,
    });
    expect(again.create).toEqual([]);
    expect(again.skipped[0]!.reason).toBe('unchanged');
  });

  it('a correction older than 30 days is listed as changed upstream, never rewritten', () => {
    const old = {
      ...ringEntry,
      date: '2026-09-01',
      source: { ...ringEntry.source, deviceKey: gaugeKey('steps', '2026-09-01') },
    } as LogEntry;
    const p = planGaugeImport({
      entries: [old],
      steps: [{ date: '2026-09-01', steps: 9500 }],
      sleep: [],
      tz: TZ,
      today: '2026-10-21',
      now: NOW,
    });
    expect(p.create).toEqual([]);
    expect(p.skipped).toEqual([
      { key: gaugeKey('steps', '2026-09-01'), stream: 'steps', reason: 'changedUpstream', entryId: 'G1' },
    ]);
  });
});

describe('re-plan: an over-plan workout updates the forecast only (§V3.7, D10)', () => {
  it('departs above 15 % of the planned EAT and never asks for food', () => {
    const base = { date: '2026-10-20', items: [] };
    expect(exerciseDeparted({ ...base, exercise: { incrementalKcal: 340, plannedEatKcal: 300 } })).toBe(
      false,
    );
    expect(exerciseDeparted({ ...base, exercise: { incrementalKcal: 360, plannedEatKcal: 300 } })).toBe(true);
    expect(exerciseDeparted({ ...base, exercise: { incrementalKcal: 250, plannedEatKcal: 0 } })).toBe(true);
    const t = evaluateTriggers({
      today: '2026-10-21',
      closedDay: { ...base, exercise: { incrementalKcal: 600, plannedEatKcal: 200 } },
      checkInConfirmed: false,
      declared: [],
      recent: [],
      a7: null,
      scored7: 0,
      outOfBandDays: 0,
      safetyBindsInDays: null,
      requestChanged: false,
    } as never);
    expect(t).toEqual([expect.objectContaining({ kind: 'light', trigger: 'nudge', forecastOnly: true })]);
  });
});

describe('estimates are deterministic and match V2', () => {
  it('the compact copy is the V2 booked estimate', () => {
    const w = { start: at('2026-10-20', 7), end: at('2026-10-20', 8) };
    const e = estimateFor({ exerciseId: 'walk', window: w, person: PERSON, keytelEnabled: true })!;
    const v2 = activityEnergy({
      exerciseId: 'walk',
      durationMin: 60,
      massKg: 80,
      ageY: 40,
      sex: 'male',
      rmrKcalPerDay: 1800,
      d2Keytel: true,
    });
    expect(e.booked.grossKcal).toBeCloseTo(v2.booked.grossKcal, 9);
    expect(compactEstimate(v2, 60, 80).cost).toEqual(
      e.cost.inputsRef === v2.cost.inputsRef ? v2.cost : { ...v2.cost, inputsRef: e.cost.inputsRef },
    );
    expect(estimateFor({ exerciseId: 'walk', window: w, person: PERSON, keytelEnabled: true })).toEqual(e);
  });
});
