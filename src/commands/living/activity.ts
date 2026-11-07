/**
 * Executors of the activity review commands (`../defs/activity.ts`, energy SPEC §V3). The behaviour is the pure
 * `@/living/activityCandidates` (identity, revisions, the session entry) and V2's `detectActivities` / `activityEnergy`;
 * these functions read the documents, call them and write the result through the command's transaction, so one ChangeSet
 * holds the candidate and its session entry and `history.undo` reverts both.
 *
 * Sync safety (the Package I rule): candidate keys, entry ids and retract ids are deterministic, so two devices importing or
 * deciding the same thing write the same rows; a row another device already wrote is not written again.
 */
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { settingsValues } from '@/state/internal/settings';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import { useProfileStore } from '@/state/profileStore';
import { pickBodyValues } from '@/state/internal/profileModel';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { rolloverOf } from '@/living/appDay';
import { addDays, localToInstant } from '@/living/dates';
import { effectiveEntries, projectEntries } from '@/living/logs';
import { projectLiving } from '@/living/projection';
import { gaugeEntryId } from '@/living/gaugeImport';
import type { Instant, LocalDate, LogEntry, PrescribedSession } from '@/living/types';
import { detectActivities, detectionRef, recordingRefOf, type DetectMinutes } from '@/living/sensors/activityDetect';
import { freezeZoneBoundaries, hrProfile, type ZoneBoundaries } from '@/living/sensors/hrProfile';
import type { HrSegment } from '@/living/sensors/types';
import { contentHash } from '@/lib/bodyContracts';
import {
  appClockH,
  knownActivityTypeId,
  candidateDocId,
  candidateKeyOf,
  checkApprovable,
  compactResolved,
  decided,
  decidedWindowOf,
  movingMinutes,
  duplicatePartners,
  defaultDecision,
  editRevisionOf,
  estimateFor,
  isOpenStatus,
  isTombstone,
  isUpdated,
  manualRef,
  planAutoAccept,
  needsTypeChoice,
  overlappingBouts,
  planCandidateUpsert,
  refDocId,
  reviewSheetModel,
  revisionOf,
  reviewedRevisionOf,
  sessionEntryOf,
  type ActivityCandidateDoc,
  type ActivityIntensity,
  type CandidateDecision,
  type CandidateEstimate,
  type CandidateRecord,
  type CandidateRefDoc,
  type CandidateStatus,
  type DecidedBy,
  type EstimateRequest,
  type ManualOverlap,
  type PersonForEstimate,
  type WindowMinutes,
} from '@/living/activityCandidates';
import { fail } from '../registry';
import type { CommandContext } from '../types';
import { appendEntry, implement, readDocs } from './index';

// ------------------------------------------------------------------------------------------- reads
export interface CandidateState {
  records: CandidateRecord[];
  byKey: Map<string, CandidateRecord>;
  refIndex: Map<string, string>;
}

/** Every stored candidate and the alias index. */
export async function readCandidates(): Promise<CandidateState> {
  const store = getDocumentStore();
  await store.ready;
  const records = store.peekAll<CandidateRecord>('activityCandidates').map((d) => bodyOf<CandidateRecord>(d));
  const refs = store.peekAll<CandidateRefDoc>('activityCandidateRefs').map((d) => bodyOf<CandidateRefDoc>(d));
  return {
    records,
    byKey: new Map(records.map((r) => [r.key, r] as const)),
    refIndex: new Map(refs.map((r) => [r.ref, r.key] as const)),
  };
}

const rollover = (): number => rolloverOf(settingsValues());

/** The basics the person entered themselves; null = never entered (0.6.3 S2: a population default never stands in). */
export interface EnteredBasics {
  weightKg: number | null;
  ageYears: number | null;
  heightCm: number | null;
  sex: 'male' | 'female' | null;
}

/**
 * (0.6.3 S2) The raw basics of the profile store, before the simulator profile fills the gaps with typical values (86 kg,
 * 40 years, 175 cm; Your body's `effectiveBasics` lists exactly these nulls as `missing`): the estimators read these,
 * never the filled ones.
 */
export function enteredBasics(): EnteredBasics {
  try {
    const v = pickBodyValues(useProfileStore.getState());
    return {
      weightKg: v.weightKg,
      ageYears: v.ageYears,
      heightCm: v.heightCm,
      sex: v.sex === 'male' || v.sex === 'female' ? v.sex : null,
    };
  } catch {
    return { weightKg: null, ageYears: null, heightCm: null, sex: null };
  }
}

/** A stored measurement as `personOn` reads it (the append-only history: retractions and corrections included). */
type MassReading = {
  id?: string;
  date?: string;
  metric?: string;
  value?: number;
  assumed?: boolean;
  kind?: string;
  target?: string;
  supersedes?: string;
  keep?: string;
  overrides?: readonly string[];
  at?: string;
  recordedAt?: string;
  source?: { by?: string; app?: string };
};

/**
 * (0.6.3 FX1, aR14) The measurements in force: a retracted weigh-in, or one a correction superseded, never stands (the same
 * projection every other reader of the history uses). Readings without ids (a caller's plain list) pass as they are.
 */
function effectiveMeasurements(
  ms: ReadonlyArray<MassReading>,
): Array<{ date: string; metric: string; value: number; assumed?: boolean }> {
  const withIds = ms.filter(
    (m): m is MassReading & { id: string } => typeof m.id === 'string' && m.id.length > 0,
  );
  const plain = ms.filter((m) => !(typeof m.id === 'string' && m.id.length > 0));
  const inForce = withIds.length ? projectEntries(withIds) : [];
  return [...inForce, ...plain].flatMap((m) =>
    m.kind === 'retract' ||
    typeof m.date !== 'string' ||
    typeof m.metric !== 'string' ||
    typeof m.value !== 'number'
      ? []
      : [{ date: m.date, metric: m.metric, value: m.value, ...(m.assumed ? { assumed: true } : {}) }],
  );
}

/**
 * The person facts of the estimators on a date: the latest dated weigh-in on or before it, else the weight the person
 * entered in their profile; the age they entered (else unknown: no age-dependent HR estimate); RMR from the engine only
 * when age and height were entered too. Null when no body mass is known (audit F15, 0.6.3 S2: an estimate is refused,
 * never made from an invented or a typical weight).
 */
export function personOn(
  date: LocalDate,
  entries?: { measurements: ReadonlyArray<MassReading> },
): PersonForEstimate | null {
  try {
    const basics = enteredBasics();
    const weighIn = effectiveMeasurements(entries?.measurements ?? [])
      .filter(
        (m) =>
          m.metric === 'weightKg' &&
          !m.assumed &&
          typeof m.date === 'string' &&
          m.date <= date &&
          Number.isFinite(m.value) &&
          m.value > 0,
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const massKg = weighIn?.value ?? basics.weightKg;
    if (!(typeof massKg === 'number' && Number.isFinite(massKg) && massKg > 0)) return null;
    let rmr: number | null = null;
    if (basics.ageYears !== null && basics.heightCm !== null) {
      try {
        const p = simulatorProfileNow();
        rmr = resolveProfile({ ...p, body: { ...p.body, weightKg: massKg } }).rmr0Kcal;
      } catch {
        rmr = null;
      }
    }
    return {
      massKg,
      ageY: basics.ageYears,
      sex: basics.sex,
      rmrKcalPerDay: rmr !== null && Number.isFinite(rmr) && rmr > 0 ? rmr : null,
    };
  } catch {
    return null;
  }
}

const NO_MASS =
  'Vitals needs your body weight to estimate the energy. Add it in your profile (or log a weigh-in), then try again.';

/** (F11, §V2.1) The zone boundaries in force now: the person's D6 settings, the age they entered and the S2 sleeping low HR. */
function zonesNow(sleepingLowHr: number | null | undefined): ZoneBoundaries | null {
  const ageY = enteredBasics().ageYears;
  const hp = settingsValues().hrProfile;
  return freezeZoneBoundaries(
    hrProfile({
      ageY,
      hrMaxOverride: hp?.hrMaxOverride ?? null,
      hrRestOverride: hp?.hrRestOverride ?? null,
      sleepingLowHr: sleepingLowHr ?? null,
      proxySleepLowOptIn: hp?.useSleepLowAsRest === true,
    }),
  );
}

async function stimulusOf(
  exerciseId: string,
  minutes: number,
  massKg: number,
  intensity?: ActivityIntensity,
): Promise<{ stimulus: Extract<LogEntry, { kind: 'session' }>['stimulus']; catalogueVersion: string }> {
  // the seed catalogue loads with the first decision, not with the registry (SUITE_SPEC §9.5: catalogues lazy)
  const [{ SEED_CATALOGUE }, { resolveSession }] = await Promise.all([
    import('@/content/catalogues'),
    import('@/catalogues'),
  ]);
  // the entered height (else 1.7 m): it only shapes descriptors, never the energy
  const heightCm = enteredBasics().heightCm;
  const heightM = heightCm !== null ? heightCm / 100 : 1.7;
  // (Codex #14) the stated intensity reaches the stimulus too: the rating with its scale, the talk test, speed and power
  const it = intensity;
  const performed = {
    exerciseId,
    minutes,
    ...(it?.rpe !== undefined ? { rpe: it.rpe, rpeScale: it.rpeScale ?? ('unknown' as const) } : {}),
    ...(it?.talkTest && it.talkTest !== 'unknown' && it.talkTest !== 'fullSentences'
      ? { talkTest: it.talkTest }
      : {}),
    ...(it?.class && it.class !== 'unknown' ? { healthIntensityClass: it.class } : {}),
    ...(it?.speedKmh !== undefined ? { speedKmh: it.speedKmh } : {}),
    ...(it?.gradePct !== undefined ? { gradePct: it.gradePct } : {}),
    ...(it?.powerW !== undefined ? { powerW: it.powerW } : {}),
  };
  const vector = resolveSession([performed], SEED_CATALOGUE, {
    bodyMassKg: massKg,
    vo2max: 40,
    heightM,
  }).vector;
  return { stimulus: vector, catalogueVersion: SEED_CATALOGUE.version };
}

/** Effective entry ids (the one an approval supersedes must still be in force). */
function effectiveIds(entries: readonly LogEntry[]): Set<string> {
  return new Set(effectiveEntries(entries).map((e) => e.id));
}

async function putCandidate(ctx: CommandContext, c: CandidateRecord): Promise<void> {
  await ctx.docs.put('activityCandidates', { ...c, _id: candidateDocId(c.key) });
}

async function putRef(ctx: CommandContext, r: CandidateRefDoc): Promise<void> {
  await ctx.docs.put('activityCandidateRefs', { ...r, _id: refDocId(r.ref) });
}

/** Append a deterministic entry unless another device already wrote it (sync made it one row). */
async function appendOnce(ctx: CommandContext, id: string, entry: Omit<LogEntry, 'id'>): Promise<string> {
  if (getDocumentStore().peek('dailyLogs', id)) return id;
  if (await ctx.docs.get('dailyLogs', id)) return id;
  await appendEntry(ctx, { ...entry, id } as LogEntry);
  return id;
}

async function retractOnce(
  ctx: CommandContext,
  target: LogEntry,
  reason: string,
  lineage = false,
): Promise<string> {
  const id = gaugeEntryId(target.date, `retract|${target.id}|${reason}`);
  if (getDocumentStore().peek('dailyLogs', id) || (await ctx.docs.get('dailyLogs', id))) return id;
  await ctx.docs.append('dailyLogs', {
    date: target.date,
    tz: target.tz,
    at: ctx.now,
    recordedAt: ctx.now,
    kind: 'retract',
    target: target.id,
    ...(lineage ? { lineage: true } : {}),
    source: {
      by: 'user',
      method: 'typed',
      actorId: ctx.actor.id,
      ...(target.source.deviceKey ? { deviceKey: target.source.deviceKey } : {}),
    },
    _id: id,
  });
  return id;
}

/**
 * (r069) Retract a bout's sessions in force with their earlier versions (`lineage`): retracting only the newest version of
 * an edited activity brings the version before it back, so a rejected hand log stayed on Today with its first time. One
 * marker per version in force, so one undo restores exactly what was there. Returns the retraction of `named` (the
 * decision's entry) when it was in force, else of the first one.
 */
async function retractBout(
  ctx: CommandContext,
  key: string,
  ent: { live: Set<string>; byId: Map<string, LogEntry> },
  named: string | null,
  reason: string,
): Promise<string | undefined> {
  const heads = [...ent.byId.values()]
    .filter((e) => e.kind === 'session' && e.physicalBoutId === key && ent.live.has(e.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  let out: string | undefined;
  for (const e of heads) {
    const id = await retractOnce(ctx, e, reason, true);
    if (e.id === named || !out) out = id;
  }
  return out;
}

const loadCandidate = (s: CandidateState, id: string): ActivityCandidateDoc => {
  const c = s.byKey.get(id);
  if (!c) fail('not_found', 'That activity is no longer in the review list.', { path: '/id' });
  if (isTombstone(c))
    fail('precondition_failed', 'That activity was resolved long ago and can no longer change.');
  return c;
};

// ------------------------------------------------------------------------------------------- decision core
interface DecideOut {
  id: string;
  status: CandidateStatus;
  revision: string | null;
  entryId: string | null;
  supersedes?: string;
  retracted?: string;
  unchanged?: boolean;
}

async function writeDecision(
  ctx: CommandContext,
  c: ActivityCandidateDoc,
  o: {
    decision: CandidateDecision;
    estimate: CandidateEstimate;
    decidedRevision: string;
    edited: boolean;
    status: 'approved' | 'edited';
    live: Set<string>;
    byId: Map<string, LogEntry>;
    /** (r070) The automatic rules decided (`activity.autoAccept`); absent: the person. */
    by?: DecidedBy;
  },
): Promise<DecideOut> {
  const supersedes = c.entryId && o.live.has(c.entryId) ? c.entryId : undefined;
  const { stimulus, catalogueVersion } = await stimulusOf(
    o.decision.exerciseId,
    o.estimate.durationMin,
    o.estimate.massKg,
    o.decision.intensity,
  );
  const manual = c.refs.length > 0 && c.refs.every((r) => r.startsWith('manual:'));
  const prevEntry = c.entryId ? o.byId.get(c.entryId) : undefined;
  const timeUnknown =
    manual &&
    prevEntry &&
    prevEntry.kind === 'session' &&
    prevEntry.startH === undefined &&
    o.decision.startAt === c.startAt
      ? { date: c.date }
      : undefined;
  const { id, entry } = sessionEntryOf({
    candidate: c,
    decision: o.decision,
    estimate: o.estimate,
    decidedRevision: o.decidedRevision,
    stimulus,
    catalogueVersion,
    edited: o.edited,
    tz: ctx.tz,
    rolloverH: rollover(),
    now: ctx.now,
    ...(supersedes ? { supersedes } : {}),
    source: { actorId: ctx.actor.id },
    ...(timeUnknown ? { timeUnknown } : {}),
    zones: zonesNow(c.sleepingLowHr),
  });
  // a decision moved to another day: the old entry is retracted there (its date is part of its identity)
  let retracted: string | undefined;
  let sup = supersedes;
  if (supersedes && prevEntry && prevEntry.date !== entry.date) {
    retracted = await retractOnce(ctx, prevEntry, `moved:${o.decidedRevision}`);
    delete (entry as { supersedes?: string }).supersedes;
    sup = undefined;
  }
  const entryId = await appendOnce(ctx, id, entry);
  await putCandidate(
    ctx,
    decided(c, {
      status: o.status,
      decidedRevision: o.decidedRevision,
      entryId,
      decision: o.decision,
      estimate: o.estimate,
      now: ctx.now,
      ...(o.by ? { by: o.by } : {}),
    }),
  );
  return {
    id: c.key,
    status: o.status,
    revision: o.decidedRevision,
    entryId,
    ...(sup ? { supersedes: sup } : {}),
    ...(retracted ? { retracted } : {}),
  };
}

const NEEDS_TYPE = 'Choose what this activity was first (or reject it if it was not exercise).';
const DUPLICATE =
  'This looks like the same activity as one you already counted. Reject one of them, or say they were separate activities.';
const DUPLICATE_IN_BATCH =
  'Some of these look like the same activity seen twice. Approve or reject one of them first, or say they were separate.';

/**
 * (0.6.3 S3/A4) The duplicate rule of a decision that would newly book a pending activity: another candidate that looks
 * like the same bout and is already approved or edited refuses it, unless the person says this was a separate activity
 * (`separate`: the pair is remembered on the candidate and never held again). Returns the candidate to decide.
 */
function checkDuplicate(
  s: CandidateState,
  c: ActivityCandidateDoc,
  separate: boolean | undefined,
  path: string,
): ActivityCandidateDoc {
  const twins = duplicatePartners(c, s.records);
  if (twins.length === 0) return c;
  if (separate === true)
    return {
      ...c,
      separateFrom: [...new Set([...(c.separateFrom ?? []), ...twins.map((t) => t.key)])].sort(),
    };
  if (isOpenStatus(c.status) && twins.some((t) => t.status !== 'pending'))
    fail('conflict', DUPLICATE, { path, reason: 'duplicate' });
  return c;
}

async function approveOne(
  ctx: CommandContext,
  s: CandidateState,
  ent: { live: Set<string>; byId: Map<string, LogEntry>; measurements: ReadonlyArray<MassReading> },
  input: { id: string; revision: string; asItemId?: string; separate?: boolean },
): Promise<DecideOut> {
  const loaded = loadCandidate(s, input.id);
  const refusal = checkApprovable(loaded, input.revision);
  if (refusal)
    fail(refusal.code, refusal.message, {
      path: '/revision',
      ...(refusal.code === 'conflict' ? { reason: 'revisionChanged' } : {}),
    });
  const c = checkDuplicate(s, loaded, input.separate, '/id');
  // (0.6.7 AD-VITALS) a detected activity without a type is approved only with the person's choice (activity.edit)
  if (needsTypeChoice(c)) fail('precondition_failed', NEEDS_TYPE, { path: '/id', reason: 'needsType' });
  const asItemId = input.asItemId ?? (!isOpenStatus(c.status) ? c.decision?.asItemId : undefined);
  // the same decision again (a double tap, a second device, Approve all over an unchanged edit): nothing to write
  if (
    (c.status === 'approved' || c.status === 'edited') &&
    reviewedRevisionOf(c) === input.revision &&
    (asItemId ?? null) === (c.decision?.asItemId ?? null) &&
    c.entryId &&
    ent.live.has(c.entryId)
  ) {
    return { id: c.key, status: c.status, revision: c.decidedRevision, entryId: c.entryId, unchanged: true };
  }
  // (F1) an edited activity whose evidence moved on is approved again WITH the person's edit: their type, window,
  // intensity and machine kcal are re-estimated over the new evidence, never replaced by the defaults
  if (c.status === 'edited' && c.decision) {
    const decision: CandidateDecision = { ...c.decision, ...(asItemId ? { asItemId } : {}) };
    const estimate = estimateOfDecision(c, decision, ent);
    return writeDecision(ctx, c, {
      decision,
      estimate,
      decidedRevision: editRevisionOf(c.revision, decision),
      edited: true,
      status: 'edited',
      live: ent.live,
      byId: ent.byId,
    });
  }
  const decision = defaultDecision(c, asItemId);
  let estimate = c.estimate;
  if (!estimate) {
    const r = approvalEstimate(c, decision, ent);
    if (r.missing === 'weight') fail('precondition_failed', NO_MASS);
    estimate = r.estimate;
  }
  if (!estimate)
    fail(
      'precondition_failed',
      'No energy estimate can be made for that activity type. Edit it to choose a known type.',
    );
  return writeDecision(ctx, c, {
    decision,
    estimate,
    decidedRevision: input.revision,
    edited: false,
    status: 'approved',
    live: ent.live,
    byId: ent.byId,
  });
}

type Measurements = { measurements: ReadonlyArray<MassReading> };

/** What an estimate of a candidate can be: the estimate, or the person fact it is missing (no weight: never a 75 kg guess). */
export interface DecisionEstimate {
  estimate: CandidateEstimate | null;
  missing: 'weight' | null;
}

/**
 * The V2 estimate request of a decision over the candidate's evidence: the stored minute evidence, the full stated
 * intensity (class, speed and grade, power, rating), the machine kcal, the vendor comparisons and the pauses. Exported so
 * the activity sheet previews exactly what `activity.edit` books (UI audit #3).
 */
export function decisionEstimateRequest(
  c: ActivityCandidateDoc,
  decision: CandidateDecision,
  person: PersonForEstimate,
  keytelEnabled: boolean,
): EstimateRequest {
  return {
    exerciseId: decision.exerciseId,
    window: { start: Date.parse(decision.startAt), end: Date.parse(decision.endAt) },
    person,
    minutes: c.evidence ?? null,
    ...(decision.intensity ? { intensity: decision.intensity } : {}),
    ...(decision.kcalOverride !== undefined ? { kcalOverride: decision.kcalOverride } : {}),
    keytelEnabled,
    ...(c.estimate?.vendor.length
      ? {
          vendor: c.estimate.vendor.map((v) => ({
            source: v.source,
            kcal: v.kcal,
            ...(v.method ? { method: v.method } : {}),
          })),
        }
      : {}),
    ...(c.pauses?.length ? { pauses: c.pauses } : {}),
  };
}

/** The estimate an edit (`tz` given: the person facts of the decided start's app day) or a re-approval would book. */
export function decisionEstimate(
  c: ActivityCandidateDoc,
  decision: CandidateDecision,
  ent: Measurements,
  tz?: string,
): DecisionEstimate {
  const person = personOn(tz ? appClockH(Date.parse(decision.startAt), tz, rollover()).date : c.date, ent);
  if (!person) return { estimate: null, missing: 'weight' };
  return {
    estimate: estimateFor(
      decisionEstimateRequest(c, decision, person, settingsValues().keytelEnabled !== false),
    ),
    missing: null,
  };
}

/** The estimate an approval books when the candidate carries none (its own window, evidence and pauses). */
export function approvalEstimate(
  c: ActivityCandidateDoc,
  decision: CandidateDecision,
  ent: Measurements,
): DecisionEstimate {
  const person = personOn(c.date, ent);
  if (!person) return { estimate: null, missing: 'weight' };
  return {
    estimate: estimateFor({
      exerciseId: decision.exerciseId,
      window: c.window,
      person,
      minutes: c.evidence ?? null,
      keytelEnabled: settingsValues().keytelEnabled !== false,
      ...(c.pauses?.length ? { pauses: c.pauses } : {}),
    }),
    missing: null,
  };
}

/** The fields `activity.edit` can clear (turning off "This was my planned …", emptying the machine kcal). */
export const EDIT_CLEARABLE = ['intensity', 'carry', 'asItemId', 'kcalOverride'] as const;
export type EditClearable = (typeof EDIT_CLEARABLE)[number];

export interface ActivityEditChanges {
  exerciseId?: string;
  startAt?: string;
  endAt?: string;
  intensity?: ActivityIntensity;
  carry?: 'pocket' | 'hand' | 'desk';
  asItemId?: string;
  kcalOverride?: number;
  /** (UI audit #16) Fields the person removed: the earlier decision's value is dropped, not kept. */
  clear?: readonly EditClearable[];
}

/** The decision an edit makes: the changes over the earlier decision (else the suggestion), minus what was cleared. */
export function editedDecision(c: ActivityCandidateDoc, input: ActivityEditChanges): CandidateDecision {
  const prior = c.decision;
  const cleared = new Set<EditClearable>(input.clear ?? []);
  const pick = <K extends EditClearable>(k: K): CandidateDecision[K] | undefined =>
    input[k] !== undefined ? (input[k] as CandidateDecision[K]) : cleared.has(k) ? undefined : prior?.[k];
  const intensity = pick('intensity');
  const carry = pick('carry');
  const asItemId = pick('asItemId');
  const kcalOverride = pick('kcalOverride');
  return {
    exerciseId: input.exerciseId ?? prior?.exerciseId ?? c.suggested.exerciseId,
    startAt: input.startAt ?? prior?.startAt ?? c.startAt,
    endAt: input.endAt ?? prior?.endAt ?? c.endAt,
    ...(intensity ? { intensity } : {}),
    ...(carry ? { carry } : {}),
    ...(asItemId ? { asItemId } : {}),
    ...(kcalOverride !== undefined ? { kcalOverride } : {}),
  };
}

/**
 * What Save would book for the activity sheet (UI audit #1, #3): `draft` = the edited decision (`editedDecision`), or null
 * when nothing changed (a pending activity is then approved as it stands; a decided one keeps its booked estimate; an
 * edited one whose evidence moved on is approved again with the person's edit). The same functions as the commands.
 */
export function previewEstimate(
  c: ActivityCandidateDoc,
  draft: CandidateDecision | null,
  ent: Measurements,
  tz: string,
): DecisionEstimate {
  if (draft) return decisionEstimate(c, draft, ent, tz);
  // unchanged: a decided activity keeps what it booked, unless its evidence moved on (then Save approves it again)
  if (!isOpenStatus(c.status) && !isUpdated(c))
    return { estimate: c.decidedEstimate ?? c.estimate, missing: null };
  if (c.status === 'edited' && c.decision) return decisionEstimate(c, c.decision, ent);
  return c.estimate ? { estimate: c.estimate, missing: null } : approvalEstimate(c, defaultDecision(c), ent);
}

/** The V2 estimate of a decision over the candidate's evidence (an edit, or an edit approved again). */
function estimateOfDecision(
  c: ActivityCandidateDoc,
  decision: CandidateDecision,
  ent: Measurements,
  tz?: string,
): CandidateEstimate {
  const r = decisionEstimate(c, decision, ent, tz);
  if (r.missing === 'weight') fail('precondition_failed', NO_MASS);
  if (!r.estimate)
    fail('invalid_input', 'That exercise type is not in the catalogue.', { path: '/exerciseId' });
  return r.estimate;
}

async function entriesNow(ctx: CommandContext) {
  const docs = await readDocs(ctx.today);
  return {
    live: effectiveIds(docs.entries),
    byId: new Map(docs.entries.map((e) => [e.id, e] as const)),
    measurements: docs.measurements,
    docs,
  };
}

// ------------------------------------------------------------------------------------------- activity.candidates
implement(
  'activity.candidates',
  async (_ctx, input: { from: string; to: string; status?: CandidateStatus }) => {
    const s = await readCandidates();
    const quiet = settingsValues().quietMode;
    const records = input.status
      ? s.records.filter((r) => !isTombstone(r) && r.status === input.status)
      : s.records;
    const model = reviewSheetModel(records, {
      from: input.from,
      to: input.to,
      quiet,
      provisionalOverlay: settingsValues().provisionalOverlay !== false,
    });
    if (input.status === 'possible') return { ...model, rows: model.possible, approveAll: { items: [] } };
    if (input.status && input.status !== 'pending')
      return {
        ...model,
        rows: model.decided.filter((r) => r.status === input.status),
        approveAll: { items: [] },
      };
    return model;
  },
);

// ------------------------------------------------------------------------------------------- approve, approve all
implement(
  'activity.approve',
  async (ctx, input: { id: string; revision: string; asItemId?: string; separate?: boolean }) => {
    const s = await readCandidates();
    return approveOne(ctx, s, await entriesNow(ctx), input);
  },
);

implement('activity.approveAll', async (ctx, input: { items: Array<{ id: string; revision: string }> }) => {
  const s = await readCandidates();
  // every item binds the revision the person saw: one stale item refuses the whole change (nothing is approved)
  const seen = new Set<string>();
  for (const it of input.items) {
    if (seen.has(it.id)) fail('invalid_input', 'The same activity is listed twice.', { path: '/items' });
    seen.add(it.id);
    const c = s.byKey.get(it.id);
    const refusal = checkApprovable(c, it.revision);
    if (refusal)
      fail(refusal.code, refusal.message, {
        path: `/items/${input.items.indexOf(it)}`,
        ...(refusal.code === 'conflict' ? { reason: 'revisionChanged' } : {}),
      });
    // (0.6.3 S3/A4) Approve all never books a duplicate: an activity that looks like another one (open in this or any
    // review, or already counted) waits for the person's own choice, as the sheet holds it
    if (c && !isTombstone(c) && duplicatePartners(c, s.records).length > 0)
      fail('conflict', DUPLICATE_IN_BATCH, {
        path: `/items/${input.items.indexOf(it)}`,
        reason: 'duplicate',
      });
    if (c && !isTombstone(c) && needsTypeChoice(c))
      fail('precondition_failed', NEEDS_TYPE, {
        path: `/items/${input.items.indexOf(it)}`,
        reason: 'needsType',
      });
  }
  const ent = await entriesNow(ctx);
  const approved: DecideOut[] = [];
  for (const it of input.items) approved.push(await approveOne(ctx, s, ent, it));
  return { approved };
});

// ------------------------------------------------------------------------------------------- edit
implement(
  'activity.edit',
  async (ctx, input: { id: string; revision: string; separate?: boolean } & ActivityEditChanges) => {
    const s = await readCandidates();
    const loaded = loadCandidate(s, input.id);
    const refusal = checkApprovable(loaded, input.revision);
    if (refusal) fail(refusal.code, refusal.message, { path: '/revision' });
    // an edit approves too: the same duplicate rule as Approve (0.6.3 S3/A4)
    const c = checkDuplicate(s, loaded, input.separate, '/id');
    if (needsTypeChoice(c) && input.exerciseId === undefined)
      fail('invalid_input', NEEDS_TYPE, { path: '/exerciseId', reason: 'needsType' });
    const decision = editedDecision(c, input);
    const start = Date.parse(decision.startAt);
    const end = Date.parse(decision.endAt);
    if (!(end > start)) fail('invalid_input', 'The end must be after the start.', { path: '/endAt' });
    if (end - start > 12 * 3_600_000)
      fail('invalid_input', 'An activity can be at most 12 hours long.', { path: '/endAt' });
    const decidedRevision = editRevisionOf(c.revision, decision);
    const ent = await entriesNow(ctx);
    if (c.decidedRevision === decidedRevision && c.entryId && ent.live.has(c.entryId))
      return { id: c.key, status: c.status, revision: decidedRevision, entryId: c.entryId, unchanged: true };
    const estimate = estimateOfDecision(c, decision, ent, ctx.tz);
    return writeDecision(ctx, c, {
      decision,
      estimate,
      decidedRevision,
      edited: true,
      status: 'edited',
      live: ent.live,
      byId: ent.byId,
    });
  },
);

// ------------------------------------------------------------------------------------------- reject
implement('activity.reject', async (ctx, input: { id: string }) => {
  const s = await readCandidates();
  const c = loadCandidate(s, input.id);
  if (c.status === 'rejected')
    return { id: c.key, status: c.status, revision: c.decidedRevision, entryId: null, unchanged: true };
  const ent = await entriesNow(ctx);
  // a late rejection removes the approved session: its energy leaves the day and every projection after it (r069: every
  // version of it, so an earlier one never comes back)
  const retracted = await retractBout(ctx, c.key, ent, c.entryId, 'rejected');
  await putCandidate(
    ctx,
    decided(c, {
      status: 'rejected',
      decidedRevision: c.revision,
      entryId: null,
      decision: null,
      estimate: null,
      now: ctx.now,
    }),
  );
  return {
    id: c.key,
    status: 'rejected' as const,
    revision: c.revision,
    entryId: null,
    ...(retracted ? { retracted } : {}),
  };
});

// ------------------------------------------------------------------------------------------- automatic acceptance (r070)
/**
 * (r070) The automatic decisions (`planAutoAccept`) over every stored candidate, written as one change: recordings and
 * strong detections are counted (`decidedBy: 'auto'`, the same session entry an approval writes), duplicates are merged
 * into the activity of higher precedence (a counted one's sessions leave the day), weak detections become quiet
 * possibles, and stale "updated" markers on the person's decisions are cleared. The import runs it after every
 * `activity.fromGauge`; a second run writes nothing. A candidate with no estimate (no weight on record) waits.
 */
implement('activity.autoAccept', async (ctx) => {
  const s = await readCandidates();
  const plan = planAutoAccept(s.records);
  const accepted: string[] = [];
  const merged: string[] = [];
  const waiting: string[] = [];
  if (plan.accept.length + plan.merge.length + plan.possible.length + plan.clear.length === 0)
    return { accepted, merged, possible: [], cleared: 0, waiting };
  const ent = await entriesNow(ctx);
  const doc = (key: string) => loadCandidate(s, key);
  for (const a of plan.accept) {
    const c = doc(a.key);
    const decision = defaultDecision(c);
    const estimate = c.estimate ?? approvalEstimate(c, decision, ent).estimate;
    if (!estimate) {
      waiting.push(c.key);
      continue;
    }
    // a candidate open again after its merge (the activity it went into was deleted upstream) is its own activity now
    const { mergedInto: _m, supersededBy: _s, ...open } = c;
    void _m;
    void _s;
    await writeDecision(ctx, open, {
      decision,
      estimate,
      decidedRevision: c.revision,
      edited: false,
      status: 'approved',
      live: ent.live,
      byId: ent.byId,
      by: 'auto',
    });
    accepted.push(c.key);
  }
  for (const m of plan.merge) {
    const c = doc(m.key);
    const counted = c.status === 'approved' || c.status === 'edited';
    if (counted) await retractBout(ctx, c.key, ent, c.entryId, 'merged');
    await putCandidate(ctx, {
      ...c,
      status: 'superseded',
      supersededBy: m.into,
      mergedInto: m.into,
      decidedBy: 'auto',
      resolvedAt: ctx.now,
      updatedAt: ctx.now,
      history: [
        ...c.history,
        { status: c.status, revision: counted ? c.decidedRevision : c.revision, entryId: c.entryId, at: ctx.now },
      ],
    });
    merged.push(c.key);
  }
  for (const key of plan.possible) {
    const { mergedInto: _m, supersededBy: _s, ...c } = doc(key);
    void _m;
    void _s;
    await putCandidate(ctx, { ...c, status: 'possible', resolvedAt: ctx.now, updatedAt: ctx.now });
  }
  for (const key of plan.clear) {
    const { updatedFrom: _u, ...c } = doc(key);
    void _u;
    await putCandidate(ctx, c);
  }
  return { accepted, merged, possible: plan.possible, cleared: plan.clear.length, waiting };
});

// ------------------------------------------------------------------------------------------- manual log
/** (0.6.3 A5) What the person chose for a manual log that overlaps a recording. */
export type ManualResolution = 'replace' | 'link' | 'separate';

export interface ManualLogInput {
  exerciseId: string;
  date: LocalDate;
  /** App-clock start hour (24 and more after midnight, before the rollover); absent = the person said the time is unknown. */
  startH?: number;
  durationMin: number;
  intensity: ActivityIntensity;
  kcalOverride?: number;
  /**
   * (0.6.3 A5) How an overlap with a recorded activity is resolved: `replace` = this log replaces the recording (it is
   * rejected), `link` = the same activity (the recording keeps its time and takes this type and effort), `separate` = two
   * activities (both count). Required when there is an overlap: without it nothing is saved.
   */
  resolution?: ManualResolution;
}

/**
 * (0.6.3 A27) Where a manual log sits: the stated start on its app day (an hour of 24 or more is after midnight, on the
 * next calendar date) for its minutes, or, when the time is unknown, noon of the date as a placeholder (never used for
 * overlaps; the entry stays date-only). The preview, the overlap check and the saved activity all use this.
 */
export function manualPlacement(
  input: Pick<ManualLogInput, 'date' | 'startH' | 'durationMin'>,
  tz: string,
): { start: number; end: number; timeKnown: boolean } {
  const timeKnown = input.startH !== undefined && Number.isFinite(input.startH);
  const iso =
    timeKnown && input.startH! >= 24
      ? localToInstant(addDays(input.date, 1), input.startH! - 24, tz)
      : localToInstant(input.date, timeKnown ? input.startH! % 24 : 12, tz);
  const start = Date.parse(iso);
  return { start, end: start + input.durationMin * 60_000, timeKnown };
}

/**
 * (0.6.3 S12/A26) The one estimator request of a manual log, for the live preview and for the booking alike: the dated
 * person facts (`personOn`), the placed window, the stated intensity (the WHO class stays the person's statement; Heart
 * Points come from the booked equivalent MET, the Fit-compatible channel) and a machine kcal.
 */
export function manualEstimateRequest(
  input: Pick<ManualLogInput, 'exerciseId' | 'intensity' | 'kcalOverride'>,
  window: { start: number; end: number },
  person: PersonForEstimate,
  keytelEnabled: boolean,
): EstimateRequest {
  return {
    exerciseId: input.exerciseId,
    window: { start: window.start, end: window.end },
    person,
    intensity: input.intensity,
    ...(input.kcalOverride !== undefined ? { kcalOverride: input.kcalOverride } : {}),
    keytelEnabled,
  };
}

/**
 * (r063 FX3 aR16) "The same activity": the recording it is linked into, as the booking saves it — the recording's own
 * decided window, pauses and minute evidence, with the stated type, effort and machine kcal.
 */
export interface ManualLink {
  /** The linked recording's candidate key. */
  key: string;
  decision: CandidateDecision;
  window: { start: number; end: number };
  pauses: Array<{ start: number; end: number }>;
  /** Minutes moving (the window less its pauses): the saved session's minutes. */
  durationMin: number;
  /** Where the recording came from (`gauge:` / `hc:` refs): the evidence it keeps. */
  refs: string[];
}

/** What a manual log would book, and what it overlaps (the Train sheet shows both before anything is saved). */
export interface ManualCheck {
  placement: { start: number; end: number; timeKnown: boolean };
  /** The estimate the log books: with `resolution: 'link'` over an overlap, the linked recording's (see `linked`). */
  estimate: CandidateEstimate | null;
  missing: 'weight' | null;
  conflicts: ManualOverlap[];
  /** (r063 FX3 aR16) Present when `resolution: 'link'` resolves an overlap: the recording the log becomes. */
  linked?: ManualLink;
}

/** (r063 FX3 aR16) The decision a "same activity" link writes on the recording: its own window, the stated type and effort. */
export function linkedDecision(
  target: ActivityCandidateDoc,
  input: Pick<ManualLogInput, 'exerciseId' | 'intensity' | 'kcalOverride'>,
): CandidateDecision {
  const w = decidedWindowOf(target);
  const prior = target.decision;
  return {
    exerciseId: input.exerciseId,
    startAt: iso(w.start),
    endAt: iso(w.end),
    intensity: input.intensity,
    ...(input.kcalOverride !== undefined ? { kcalOverride: input.kcalOverride } : {}),
    ...(prior?.carry ? { carry: prior.carry } : {}),
    ...(prior?.asItemId ? { asItemId: prior.asItemId } : {}),
  };
}

/** The check of a manual log over the given weigh-ins and candidates (the command and the app's preview both call it). */
export function manualCheck(
  input: ManualLogInput,
  o: {
    ent: Measurements;
    records: readonly CandidateRecord[];
    tz: string;
    person?: PersonForEstimate | null;
  },
): ManualCheck {
  const placement = manualPlacement(input, o.tz);
  const conflicts = placement.timeKnown ? overlappingBouts(placement, o.records) : [];
  const keytel = settingsValues().keytelEnabled !== false;
  // (r063 FX3 aR16) linked into the first overlapping recording (as the command books it): its window and evidence
  const target =
    input.resolution === 'link' && conflicts.length > 0
      ? (o.records.find((r) => r.key === conflicts[0]!.key) as ActivityCandidateDoc | undefined)
      : undefined;
  if (target) {
    const decision = linkedDecision(target, input);
    const window = { start: Date.parse(decision.startAt), end: Date.parse(decision.endAt) };
    const pauses = (target.pauses ?? []).filter((p) => p.end > window.start && p.start < window.end);
    const linked: ManualLink = {
      key: target.key,
      decision,
      window,
      pauses,
      durationMin: Math.round(movingMinutes(window, pauses)),
      refs: [...target.refs],
    };
    // `person` stands in for the stored facts only in tests and the screenshot harness
    if (o.person !== undefined)
      return {
        placement,
        estimate: o.person ? estimateFor(decisionEstimateRequest(target, decision, o.person, keytel)) : null,
        missing: o.person ? null : 'weight',
        conflicts,
        linked,
      };
    const r = decisionEstimate(target, decision, o.ent, o.tz);
    return { placement, estimate: r.estimate, missing: r.missing, conflicts, linked };
  }
  // `person` stands in for the stored facts only in tests and the screenshot harness
  const person = o.person !== undefined ? o.person : personOn(input.date, o.ent);
  if (!person) return { placement, estimate: null, missing: 'weight', conflicts };
  return {
    placement,
    estimate: estimateFor(manualEstimateRequest(input, placement, person, keytel)),
    missing: null,
    conflicts,
  };
}

/** The app's check now: the stored weigh-ins and candidates (synchronous, for the live preview). */
export function manualCheckNow(input: ManualLogInput, tz: string): ManualCheck {
  let measurements: Measurements['measurements'] = [];
  let records: CandidateRecord[] = [];
  try {
    const store = getDocumentStore();
    measurements = store
      .peekAll<{ date: string; metric: string; value: number; assumed?: boolean }>('measurements')
      .map((d) => bodyOf<{ date: string; metric: string; value: number; assumed?: boolean }>(d));
    records = store.peekAll<CandidateRecord>('activityCandidates').map((d) => bodyOf<CandidateRecord>(d));
  } catch {
    // no store yet: no weigh-ins, no recordings
  }
  return manualCheck(input, { ent: { measurements }, records, tz });
}

const OVERLAP =
  'This overlaps an activity your ring or phone recorded. Choose whether it replaces it, is the same activity, or was a separate one.';
const iso = (ms: number): Instant => new Date(ms).toISOString();

/** Reject a recording a manual log replaces (its approved session leaves the day). */
async function rejectReplaced(
  ctx: CommandContext,
  c: ActivityCandidateDoc,
  ent: { live: Set<string>; byId: Map<string, LogEntry> },
  by: string,
): Promise<void> {
  await retractBout(ctx, c.key, ent, c.entryId, 'replaced');
  await putCandidate(ctx, {
    ...decided(c, {
      status: 'rejected',
      decidedRevision: c.revision,
      entryId: null,
      decision: null,
      estimate: null,
      now: ctx.now,
    }),
    resolvedBy: { key: by, resolution: 'replace' },
  });
}

implement('activity.logManual', async (ctx, input: ManualLogInput) => {
  if (input.date > ctx.today)
    fail('invalid_input', 'An activity cannot be logged for a future day.', { path: '/date' });
  const rolloverH = rollover();
  const ent = await entriesNow(ctx);
  const s = await readCandidates();
  const chk = manualCheck(input, { ent, records: s.records, tz: ctx.tz });
  const { start, end, timeKnown } = chk.placement;
  if (timeKnown && end > Date.parse(ctx.now) + 5 * 60_000)
    fail('invalid_input', 'That activity would end in the future.', { path: '/durationMin' });
  if (chk.missing === 'weight') fail('precondition_failed', NO_MASS);
  const estimate = chk.estimate;
  if (!estimate)
    fail('invalid_input', 'That exercise type is not in the catalogue.', { path: '/exerciseId' });
  const conflicts = chk.conflicts.map((o) => ({
    id: o.key,
    entryId: o.entryId,
    overlapPct: o.overlapPct,
    status: o.status,
  }));
  // (0.6.3 A5) an overlap with something the person decided is their choice before anything is saved: never both silently
  // (r070) one with activities only the automatic rules counted needs no answer: the hand log wins and replaces them
  const handWins =
    conflicts.length > 0 &&
    conflicts.every((c) => {
      const o = loadCandidate(s, c.id);
      return o.decidedBy !== 'user' || isOpenStatus(o.status);
    });
  if (conflicts.length > 0 && !input.resolution && !handWins)
    fail('conflict', OVERLAP, { path: '/resolution', reason: 'overlap' });
  const resolution = conflicts.length > 0 ? (input.resolution ?? (handWins ? ('replace' as const) : undefined)) : undefined;
  const kcalOut = (e: CandidateEstimate) =>
    settingsValues().quietMode ? null : Math.round(e.booked.grossKcal);

  if (resolution === 'link') {
    // the same activity: the recording keeps its own window and evidence and takes the stated type, effort and kcal —
    // exactly the decision and estimate the preview showed (`manualCheck` with the resolution, r063 FX3 aR16)
    const target = loadCandidate(s, conflicts[0]!.id);
    const decision = chk.linked?.key === target.key ? chk.linked.decision : linkedDecision(target, input);
    const linked =
      chk.linked?.key === target.key && chk.estimate
        ? chk.estimate
        : estimateOfDecision(target, decision, ent, ctx.tz);
    const out = await writeDecision(
      ctx,
      { ...target, resolvedBy: { key: target.key, resolution: 'link' } },
      {
        decision,
        estimate: linked,
        decidedRevision: editRevisionOf(target.revision, decision),
        edited: true,
        status: 'edited',
        live: ent.live,
        byId: ent.byId,
      },
    );
    const saved = {
      exerciseId: decision.exerciseId,
      durationMin: Math.round(linked.durationMin),
      startAt: decision.startAt,
      endAt: decision.endAt,
    };
    return { id: target.key, entryId: out.entryId!, kcal: kcalOut(linked), conflicts, resolution, saved };
  }

  const ref = manualRef(ctx.newId());
  const key = candidateKeyOf(ref, start, ctx.tz, rolloverH);
  const sourceRevision = revisionOf(ref, null);
  const decision: CandidateDecision = {
    exerciseId: input.exerciseId,
    startAt: iso(start),
    endAt: iso(end),
    intensity: input.intensity,
    ...(input.kcalOverride !== undefined ? { kcalOverride: input.kcalOverride } : {}),
  };
  const doc: ActivityCandidateDoc = {
    key,
    date: timeKnown ? appClockH(start, ctx.tz, rolloverH).date : input.date,
    tz: ctx.tz,
    startAt: decision.startAt,
    endAt: decision.endAt,
    window: { start, end },
    refs: [ref],
    sources: [],
    sourceRevision,
    estimateRevision: null,
    revision: revisionOf(sourceRevision, null),
    suggested: {
      exerciseId: input.exerciseId,
      confidence: 'high',
      needsReview: false,
      why: ['logged by hand'],
    },
    measures: {
      durationMin: input.durationMin,
      steps: null,
      medianCadence: null,
      hrSupportedS: null,
      meanHr: input.intensity.avgHr ?? null,
    },
    estimate,
    corroboratedBy: [],
    mergeSuggestions: [],
    planMatch: null,
    status: 'pending',
    decidedRevision: null,
    entryId: null,
    decidedAt: null,
    decidedBy: null,
    decision: null,
    decidedEstimate: null,
    history: [],
    firstSeenAt: ctx.now,
    updatedAt: ctx.now,
    resolvedAt: null,
    ...(timeKnown ? {} : { timeUnknown: true as const }),
    // "these were separate": the pair is remembered, so neither is held or refused as the other's duplicate
    ...(resolution === 'separate' ? { separateFrom: conflicts.map((c) => c.id).sort() } : {}),
  };
  const { stimulus, catalogueVersion } = await stimulusOf(
    input.exerciseId,
    input.durationMin,
    estimate.massKg,
    input.intensity,
  );
  const { id, entry } = sessionEntryOf({
    candidate: doc,
    decision,
    estimate,
    decidedRevision: doc.revision,
    stimulus,
    catalogueVersion,
    edited: false,
    tz: ctx.tz,
    rolloverH,
    now: ctx.now,
    source: { actorId: ctx.actor.id },
    ...(timeKnown ? {} : { timeUnknown: { date: input.date } }),
    zones: zonesNow(null),
  });
  // "replace": the recordings it overlaps are rejected (their sessions leave the day) in the same change, so one Undo
  // brings them back with the log gone
  const replaced: string[] = [];
  if (resolution === 'replace') {
    for (const c of conflicts) {
      await rejectReplaced(ctx, loadCandidate(s, c.id), ent, key);
      replaced.push(c.id);
    }
  }
  const entryId = await appendOnce(ctx, id, entry);
  await putCandidate(
    ctx,
    decided(doc, {
      status: 'approved',
      decidedRevision: doc.revision,
      entryId,
      decision,
      estimate,
      now: ctx.now,
    }),
  );
  await putRef(ctx, { ref, key });
  // (r063 FX3 aR16) the saved facts, for the success message (a log without a clock time has no window)
  const saved = {
    exerciseId: input.exerciseId,
    durationMin: Math.round(estimate.durationMin),
    startAt: timeKnown ? decision.startAt : null,
    endAt: timeKnown ? decision.endAt : null,
  };
  return {
    id: key,
    entryId,
    kcal: kcalOut(estimate),
    conflicts,
    ...(resolution ? { resolution } : {}),
    ...(replaced.length > 0 ? { replaced } : {}),
    saved,
  };
});

// ------------------------------------------------------------------------------------------- import
interface FromGaugeInput {
  gaugeSessions: Array<{
    id: string;
    revision: string;
    start: number;
    end: number;
    type: string;
    kcal?: number | null;
    distanceM?: number | null;
    pauses?: Array<{ start: number; end: number }>;
    activityTypeId?: string;
  }>;
  hcSessions: Array<{
    id: string;
    revision: string;
    start: number;
    end: number;
    exerciseType: number;
    originPackage: string;
    title?: string;
    hasHr?: boolean;
    hasRoute?: boolean;
    /** (r069) Its segments (where in the window the exercise was). */
    segments?: Array<{ start: number; end: number }>;
    /** (r070) How Health Connect says it was recorded, and its laps. */
    recordingMethod?: 'manual' | 'active' | 'auto';
    laps?: number;
  }>;
  telemetry?: Array<{ id: string; revision: string; start: number; end: number; mode?: string }>;
  /**
   * (r063 S16/A19) `speedMps`/`speedAccepted`/`gradePct`/`powerW`/`powerVerified`: Health Connect motion per minute
   * (`ActivityImportInput`); (0.6.3 FX5) `gpsSpeedMps`/`gpsSpeedAccepted`: Gauge's route-derived moving speed.
   */
  minutes?: Array<{
    first: number;
    steps: Array<number | null>;
    hrBpm?: Array<number | null>;
    hrSupportedS?: Array<number | null>;
    hrExact?: Array<{ start: number; end: number; bpm: number }>;
    asleep?: boolean[];
    speedMps?: Array<number | null>;
    speedAccepted?: boolean[];
    gradePct?: Array<number | null>;
    powerW?: Array<number | null>;
    powerVerified?: boolean[];
    gpsSpeedMps?: Array<number | null>;
    gpsSpeedAccepted?: boolean[];
  }>;
  deletedRefs?: string[];
  /** (F11) The S2 sleeping low HR baseline (an HRrest proxy only when the person opted in, D6). */
  sleepingLowHr?: number | null;
  /** (0.6.3 FX5) Where `sleepingLowHr` came from: the ring (absent: the ring), or Health Connect's resting HR as the fallback. */
  sleepingLowHrSource?: 'ring' | 'healthConnect';
  /** (0.6.7 AD-VITALS) The server's detection episodes (only final ones become candidates). */
  detections?: Array<{
    id: string;
    revision: number;
    detector: string;
    start: number;
    end: number;
    state?: 'open' | 'final' | 'withdrawn';
    label: string;
    alternatives?: string[];
    existence: number;
    typeScore: number;
    level: 'low' | 'medium' | 'high';
    reasons?: string[];
    coverage?: { phone?: number; ring?: number; hr?: number; ar?: number; gps?: number };
    evidenceHash?: string;
    recordingRefs?: string[];
  }>;
  /** (0.6.7 AD-VITALS) Episode ids the server withdrew. */
  withdrawnDetections?: string[];
  /** (0.6.7 AD-VITALS) The server's detector (`detect/2`): the local detect/1 detectors are then off. */
  serverDetector?: string;
}

/** (0.6.7 AD-VITALS) The server runs `detect/2` or later: the local cadence and HR detectors stay off (never both). */
export function serverDetects(detector: string | undefined | null): boolean {
  const m = typeof detector === 'string' ? /^detect\/(\d+)$/.exec(detector.trim()) : null;
  return m !== null && Number(m[1]) >= 2;
}

/**
 * (Codex #7) Hash of the minute evidence inside a window: fused steps, supported HR and (r063 FX4, M20) Health Connect
 * motion; null when none of it is known.
 */
function evidenceRevisionOfWindow(
  m: ReturnType<typeof mergeMinutes>,
  start: number,
  end: number,
): string | null {
  if (!m) return null;
  const a = Math.max(0, Math.floor((start - m.first) / 60_000));
  const b = Math.min(m.steps.length, Math.ceil((end - m.first) / 60_000));
  if (b <= a) return null;
  const steps = m.steps.slice(a, b);
  const bpm = m.hr ? m.hr.bpm.slice(a, b) : [];
  const sup = m.hr ? m.hr.supportedS.slice(a, b) : [];
  // (r063 S16/A19) Health Connect speed and power join the hash only where they exist, so a window without them keeps its
  // revision; (r063 FX4, M20) they count as evidence on their own, so a motion-only correction re-estimates
  const motion = MOTION_KEYS.flatMap((k) => {
    const v = m[k]?.slice(a, b);
    return v && v.some((x) => x !== null && x !== false) ? [[k, v]] : [];
  });
  if (steps.every((x) => x === null) && bpm.every((x) => x === null) && motion.length === 0) return null;
  // (Codex #11) the exact readings join the hash only where they exist, so a window without them keeps its revision
  const exact = exactIn(m, start, end);
  return contentHash([
    'evidence/1',
    m.first + a * 60_000,
    steps,
    bpm,
    sup,
    ...(exact ? [exact.map((g) => [g.start, g.end, g.bpm])] : []),
    ...(motion.length ? [motion] : []),
  ]);
}

/** (r063 S16/A19) The per-minute Health Connect motion fields a minute grid may carry; (0.6.3 FX5) and Gauge's GPS speed. */
const MOTION_KEYS = [
  'speedMps',
  'speedAccepted',
  'gradePct',
  'powerW',
  'powerVerified',
  'gpsSpeedMps',
  'gpsSpeedAccepted',
] as const;
type MotionKey = (typeof MOTION_KEYS)[number];
type MotionArrays = {
  speedMps?: Array<number | null>;
  speedAccepted?: boolean[];
  gradePct?: Array<number | null>;
  powerW?: Array<number | null>;
  powerVerified?: boolean[];
  gpsSpeedMps?: Array<number | null>;
  gpsSpeedAccepted?: boolean[];
};

type MergedMinutes = DetectMinutes & {
  asleep: boolean[];
  exact?: { segments: HrSegment[]; covered: Array<{ start: number; end: number }> };
} & MotionArrays;

/** The exact HR segments inside `[start, end)` when days with exact readings cover all of it, else null (minute means). */
function exactIn(m: MergedMinutes | null, start: number, end: number): HrSegment[] | null {
  if (!m?.exact) return null;
  let at = start;
  for (const c of m.exact.covered) {
    if (c.start > at) break;
    if (c.end > at) at = c.end;
    if (at >= end) break;
  }
  if (at < end) return null;
  return m.exact.segments.filter((g) => g.end > start && g.start < end);
}

/** One contiguous minute grid from day timelines (gaps between them stay null: unknown, never zero). */
export function mergeMinutes(days: FromGaugeInput['minutes']): MergedMinutes | null {
  const list = (days ?? [])
    .filter((d) => Number.isFinite(d.first) && d.steps.length > 0)
    .sort((a, b) => a.first - b.first);
  if (list.length === 0) return null;
  const first = list[0]!.first;
  const last = list.reduce((m, d) => Math.max(m, d.first + d.steps.length * 60_000), first);
  const n = Math.round((last - first) / 60_000);
  const steps: Array<number | null> = new Array(n).fill(null);
  const bpm: Array<number | null> = new Array(n).fill(null);
  const sup: Array<number | null> = new Array(n).fill(null);
  const asleep: boolean[] = new Array(n).fill(false);
  let anyHr = false;
  const exact: HrSegment[] = [];
  const covered: Array<{ start: number; end: number }> = [];
  // (r063 S16/A19) Health Connect motion, only when some day has it (a grid without it is exactly what it was)
  const motion: MotionArrays = {};
  const flag = (k: MotionKey) => k === 'speedAccepted' || k === 'powerVerified' || k === 'gpsSpeedAccepted';
  for (const k of MOTION_KEYS) {
    if (list.some((d) => Array.isArray(d[k])))
      (motion as Record<MotionKey, Array<number | null | boolean>>)[k] = new Array(n).fill(
        flag(k) ? false : null,
      );
  }
  for (const d of list) {
    const o = Math.round((d.first - first) / 60_000);
    for (const k of MOTION_KEYS) {
      const into = (motion as Record<MotionKey, Array<number | null | boolean> | undefined>)[k];
      const from = d[k] as Array<number | null | boolean> | undefined;
      if (!into || !Array.isArray(from)) continue;
      from.forEach((v, j) => {
        if (o + j >= n || j >= d.steps.length) return;
        if (flag(k)) into[o + j] = v === true;
        else if (typeof v === 'number' && Number.isFinite(v)) into[o + j] = v;
      });
    }
    // (Codex #11) a day the server sent its raw readings for: exact over the whole day
    if (Array.isArray(d.hrExact)) {
      covered.push({ start: d.first, end: d.first + d.steps.length * 60_000 });
      for (const g of d.hrExact)
        if (
          Number.isFinite(g.start) &&
          Number.isFinite(g.end) &&
          Number.isFinite(g.bpm) &&
          g.end > g.start &&
          g.bpm > 0
        )
          exact.push({ start: g.start, end: g.end, bpm: g.bpm });
    }
    d.steps.forEach((v, k) => {
      if (o + k < n && v !== null && v !== undefined) steps[o + k] = v;
    });
    d.hrBpm?.forEach((v, k) => {
      if (o + k < n && v !== null && v !== undefined) {
        bpm[o + k] = v;
        anyHr = true;
      }
    });
    d.hrSupportedS?.forEach((v, k) => {
      if (o + k < n && v !== null && v !== undefined) sup[o + k] = v;
    });
    d.asleep?.forEach((v, k) => {
      if (o + k < n) asleep[o + k] = v === true;
    });
  }
  exact.sort((a, b) => a.start - b.start || a.end - b.end);
  covered.sort((a, b) => a.start - b.start);
  return {
    first,
    steps,
    ...(anyHr ? { hr: { bpm, supportedS: sup } } : {}),
    asleep,
    ...(covered.length ? { exact: { segments: exact, covered } } : {}),
    ...motion,
  };
}

/** The minutes around a window (±30 min), kept on the candidate so an edit can re-estimate a moved window. */
function sliceMinutes(m: ReturnType<typeof mergeMinutes>, start: number, end: number): WindowMinutes | null {
  if (!m) return null;
  const a = Math.max(0, Math.floor((start - 30 * 60_000 - m.first) / 60_000));
  const b = Math.min(m.steps.length, Math.ceil((end + 30 * 60_000 - m.first) / 60_000));
  if (b <= a) return null;
  const exact = exactIn(m, m.first + a * 60_000, m.first + b * 60_000);
  return {
    first: m.first + a * 60_000,
    steps: m.steps.slice(a, b),
    ...(m.hr ? { hr: { bpm: m.hr.bpm.slice(a, b), supportedS: m.hr.supportedS.slice(a, b) } } : {}),
    ...(exact ? { hrExact: exact } : {}),
    asleep: m.asleep.slice(a, b),
    // (r063 S16/A19) the window's Health Connect motion, when it has any
    ...(MOTION_KEYS.some((k) => m[k]?.slice(a, b).some((x) => x !== null && x !== false))
      ? Object.fromEntries(MOTION_KEYS.flatMap((k) => (m[k] ? [[k, m[k]!.slice(a, b)]] : [])))
      : {}),
  };
}

implement('activity.fromGauge', async (ctx, input: FromGaugeInput) => {
  const s = await readCandidates();
  const rolloverH = rollover();
  const settings = settingsValues();
  const minutes = mergeMinutes(input.minutes);
  // (0.6.3 S2) the age the person entered: never the typical 40 the simulator profile shows
  const profileAge = enteredBasics().ageYears;
  const hp = settings.hrProfile;
  const sleepingLowHr =
    typeof input.sleepingLowHr === 'number' && Number.isFinite(input.sleepingLowHr)
      ? input.sleepingLowHr
      : null;
  // (0.6.3 FX5) Health Connect's resting HR stands in only when the ring's sleeping low was not ready (the import says so)
  const sleepingLowHrSource =
    sleepingLowHr !== null && input.sleepingLowHrSource === 'healthConnect'
      ? ('healthConnect' as const)
      : null;
  // (F11) the sleeping low HR reaches the profile: D6's opt-in can then take it as the HRrest proxy
  const boundaries = freezeZoneBoundaries(
    hrProfile({
      ageY: profileAge,
      hrMaxOverride: hp?.hrMaxOverride ?? null,
      hrRestOverride: hp?.hrRestOverride ?? null,
      sleepingLowHr,
      proxySleepLowOptIn: hp?.useSleepLowAsRest === true,
    }),
  );
  const full = s.records.filter((r): r is ActivityCandidateDoc => !isTombstone(r));
  const withdrawn = new Set([
    ...(input.withdrawnDetections ?? []),
    ...(input.detections ?? []).filter((e) => e.state === 'withdrawn').map((e) => e.id),
  ]);
  const result = detectActivities({
    // (0.6.3 S26) the catalogue activity a recording was started as, when known, is the suggested type
    gaugeSessions: input.gaugeSessions.map((g) => {
      const picked = knownActivityTypeId(g.activityTypeId);
      return {
        id: g.id,
        revision: g.revision,
        start: g.start,
        end: g.end,
        type: g.type,
        ...(picked ? { activityTypeId: picked } : {}),
      };
    }),
    hcSessions: input.hcSessions,
    telemetry: input.telemetry ?? [],
    ...(minutes ? { minutes } : {}),
    // (0.6.7 AD-VITALS) the server's final episodes; with detect/2 on the server, the local detectors are off
    episodes: (input.detections ?? []).filter(
      (e) => (e.state ?? 'final') === 'final' && !withdrawn.has(e.id),
    ),
    localDetectors: !serverDetects(input.serverDetector),
    hrBoundaries: boundaries,
    aliasIndex: s.refIndex,
    // (r069) recordings deleted upstream host nothing: this pass's deletions and those the candidates kept
    goneRefs: new Set(
      [...(input.deletedRefs ?? []), ...full.flatMap((c) => c.deletedSources ?? [])].map(recordingRefOf),
    ),
    // a hand log without a known time has a placeholder window: it never absorbs or suggests merging with a recording
    existing: full
      .filter((c) => c.timeUnknown !== true)
      .map((c) => {
        const counted = c.status === 'approved' || c.status === 'edited';
        const withdrawnDecision =
          c.withdrawn?.decided?.status === 'approved' || c.withdrawn?.decided?.status === 'edited';
        return {
          key: c.key,
          window: counted || withdrawnDecision ? decidedWindowOf(c) : c.window,
          // (r069) a decided activity withdrawn upstream still is one: the session written over it attaches (and restores it)
          counted: counted || withdrawnDecision,
          ...(c.refs[0] ? { hostRef: c.refs[0] } : {}),
          live: counted || isOpenStatus(c.status) || withdrawnDecision,
        };
      }),
    // V3 mints keys itself (deterministic, `candidateKeyOf`): the detector's proposal is never used
    mintKey: () => '',
  });
  const docs = await readDocs(ctx.today);
  const sessionsByRef = new Map<string, FromGaugeInput['gaugeSessions'][number]>(
    input.gaugeSessions.map((g) => [`gauge:${g.id}`, g]),
  );
  // the prescriptions of the plan days (plan matching hint, §V3.3)
  let prescribed: Map<string, readonly PrescribedSession[]> | null = null;
  const prescribedOn = (date: string): readonly PrescribedSession[] => {
    if (!prescribed) {
      prescribed = new Map();
      try {
        const p = projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
        for (const d of p.days) prescribed.set(d.date, d.prescription.sessions);
      } catch {
        // no plan: no hints
      }
    }
    return prescribed.get(date) ?? [];
  };
  const plan = planCandidateUpsert({
    drafts: result.drafts,
    absorbed: result.absorbed,
    deletedRefs: input.deletedRefs ?? [],
    withdrawnRefs: [...withdrawn].map(detectionRef),
    detectorHosts: result.detectorHosts,
    existing: s.byKey,
    refIndex: s.refIndex,
    evidenceRevisionOf: (d) => evidenceRevisionOfWindow(minutes, d.window.start, d.window.end),
    estimateOf: (d) => {
      // (0.6.7 AD-VITALS) a detected activity without a type has no estimate until the person chooses one (never booked or
      // shown as generic moderate cardio)
      if (d.detection?.needsType) return null;
      const g = d.refs.map((r) => sessionsByRef.get(r)).find((x) => x !== undefined);
      const person = personOn(appClockH(d.window.start, ctx.tz, rolloverH).date, docs);
      // (F15) no known body mass: no estimate now (approval asks for the weight), never an invented one
      if (!person) return null;
      return estimateFor({
        exerciseId: d.suggested.exerciseId,
        window: d.window,
        person,
        minutes: sliceMinutes(minutes, d.window.start, d.window.end),
        keytelEnabled: settings.keytelEnabled !== false,
        ...(g?.kcal !== undefined && g.kcal !== null && Number.isFinite(g.kcal)
          ? { vendor: [{ source: 'gauge', kcal: g.kcal, method: 'gauge' }] }
          : {}),
        ...(g?.pauses?.length ? { pauses: g.pauses } : {}),
        inputsRef: d.sourceRevision,
      });
    },
    // (r069) what a decision books over this pass's evidence (the re-approval's estimate): a decided activity asks again
    // only when that is another activity, other minutes, energy or points than what was decided
    decisionEstimateOf: (d, c) => {
      if (!c.decision) return null;
      const person = personOn(c.date, docs);
      if (!person) return null;
      const w = decidedWindowOf(c);
      const around = sliceMinutes(minutes, Math.min(w.start, d.window.start), Math.max(w.end, d.window.end));
      return estimateFor(
        decisionEstimateRequest(
          { ...c, evidence: around ?? c.evidence ?? null },
          c.decision,
          person,
          settings.keytelEnabled !== false,
        ),
      );
    },
    prescribedOn,
    tz: ctx.tz,
    rolloverH,
    now: ctx.now,
  });
  // (r069) decided activities read again after a withdrawal: the session entries the withdrawal retracted come back (a
  // copy that supersedes each retraction, deterministic so two devices write one), and the candidate names the copy
  const restoredEntry = new Map<string, string>();
  if (plan.restore.length > 0) {
    const markers = effectiveEntries(docs.entries, true).flatMap((e) =>
      e.kind === 'retract' && e.target ? [{ id: e.id, target: e.target }] : [],
    );
    const byId = new Map(docs.entries.map((e) => [e.id, e] as const));
    for (const r of plan.restore) {
      // the version that was in force (the one the withdrawal names, else the newest): one copy, never every version
      const withdrawn = markers.flatMap((m) => {
        const target = byId.get(m.target);
        return target &&
          target.kind === 'session' &&
          target.physicalBoutId === r.key &&
          m.id === gaugeEntryId(target.date, `retract|${target.id}|sourceDeleted`)
          ? [{ marker: m.id, target }]
          : [];
      });
      const pick =
        withdrawn.find((x) => x.target.id === r.entryId) ??
        withdrawn.sort((a, b) => (b.target.at ?? '').localeCompare(a.target.at ?? ''))[0];
      if (!pick) continue;
      const { id: _old, ...copy } = pick.target;
      void _old;
      const id = gaugeEntryId(pick.target.date, `restore|${pick.marker}`);
      await appendOnce(ctx, id, { ...copy, at: ctx.now, supersedes: pick.marker } as Omit<LogEntry, 'id'>);
      restoredEntry.set(r.key, id);
    }
  }
  const created: string[] = [];
  const updated: string[] = [];
  const blocked: string[] = [];
  const superseded: string[] = [];
  let unchanged = 0;
  for (const o of plan.outcomes) {
    if (o.outcome === 'created') created.push(o.key);
    else if (o.outcome === 'updated' || o.outcome === 'attached') updated.push(o.key);
    else if (o.outcome === 'blocked') blocked.push(o.key);
    else if (o.outcome === 'superseded') superseded.push(o.key);
    else unchanged++;
  }
  for (const doc of plan.puts) {
    const evidence = sliceMinutes(minutes, doc.window.start, doc.window.end);
    // (F8) the Gauge session's pauses stay with the candidate (booked minutes = moving minutes, at approval and on edit)
    const g = doc.refs.map((r) => sessionsByRef.get(r)).find((x) => x !== undefined);
    const pauses = g?.pauses
      ?.filter((p) => Number.isFinite(p.start) && p.end > p.start)
      .map((p) => ({ start: p.start, end: p.end }));
    const restoredId = restoredEntry.get(doc.key);
    await putCandidate(ctx, {
      ...doc,
      ...(restoredId ? { entryId: restoredId } : {}),
      ...(evidence ? { evidence } : {}),
      ...(pauses && pauses.length > 0 ? { pauses } : {}),
      ...(sleepingLowHr !== null ? { sleepingLowHr } : {}),
      ...(sleepingLowHrSource ? { sleepingLowHrSource } : {}),
    });
  }
  for (const r of plan.records) await putCandidate(ctx, r);
  for (const r of plan.refs) await putRef(ctx, r);
  // (0.6.3 S13) an approved activity whose every source was deleted upstream leaves replay: its session is retracted (the
  // candidate, withdrawn above, keeps the decision in its history; the retraction is the audit row in the log)
  // (FX1) every in-force session of the bout goes, not only the entry the decision named (a later edit superseded it)
  if (plan.retract.length > 0) {
    const live = effectiveIds(docs.entries);
    const byId = new Map(docs.entries.map((e) => [e.id, e] as const));
    // (r069) every version of it, so an earlier one never comes back in its place
    for (const r of plan.retract) await retractBout(ctx, r.key, { live, byId }, r.entryId, 'sourceDeleted');
  }
  // (r069) a rejected activity counts nothing: a session version a rejection left in force (before r069 it retracted only
  // the newest version, and the one before it came back) is retracted now
  {
    const written = new Map(plan.puts.map((p) => [p.key, p] as const));
    const rejected = full.filter((c) => (written.get(c.key) ?? c).status === 'rejected');
    if (rejected.length > 0) {
      const live = effectiveIds(docs.entries);
      const byId = new Map(docs.entries.map((e) => [e.id, e] as const));
      for (const c of rejected)
        if (docs.entries.some((e) => e.kind === 'session' && e.physicalBoutId === c.key && live.has(e.id)))
          await retractBout(ctx, c.key, { live, byId }, null, 'rejected');
    }
  }
  // retention: resolved records past 90 days become their compact tombstones (never removed)
  const written = new Set([...plan.puts.map((p) => p.key), ...plan.records.map((r) => r.key)]);
  const tombs = compactResolved(
    s.records.filter((r) => !written.has(r.key)),
    ctx.now,
  );
  for (const t of tombs) await putCandidate(ctx, t);
  return {
    created: [...new Set(created)],
    updated: [...new Set(updated)],
    unchanged,
    blocked: [...new Set(blocked)],
    superseded,
    compacted: tombs.length,
  };
});

/** Effective session entries of a candidate (tests, the review sheet's undo card). */
export function candidateEntries(entries: readonly LogEntry[], key: string): LogEntry[] {
  return projectEntries(entries).filter((e) => e.kind === 'session' && e.physicalBoutId === key);
}
