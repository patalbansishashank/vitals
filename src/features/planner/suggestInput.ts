/**
 * Gathers the goal suggester's input (`goals.suggest`, SUITE_SPEC §13.4) from the person's answers and installs it as
 * the command's `goalSuggest` port: Your body (estimate, likely range, waist, training history), the intake document,
 * entered blood markers (the markers document when present, else the readings typed on Your body), the safety snapshot and the fastest-safe reach of
 * the probe goals (worker). Every part degrades to "missing" rather than a guess.
 */
import { dispatch, installPorts, type Actor } from '@/commands';
import { selectBodyValues, useProfileStore } from '@/state/profileStore';
import { getDocumentStore } from '@/state/runtime';
import type { MarkersView } from '@/markers';
import { summarizeBody } from '@/features/body/model';
import { readIntake } from '@/features/intake/doc';
import {
  labNotes,
  suggestionProbeGoals,
  trainingYears,
  SUGGEST_HORIZON_DAYS,
  type FastingTierOptIn,
  type GoalSuggestionInput,
  type MarkerNote,
  type SuggestIntake,
} from '@/engine/planner/domain/suggestGoals';
import type { TargetReach } from '@/engine/planner/domain/types';
import type { ConstraintDraft } from '@/state/plannerStore';
import { estimateTargetsAsync } from './plannerClient';
import { buildPlannerRequest, type SafetySnapshot } from './request';

/** What only the Planner screen knows (effective limits, safety access); kept fresh by `useGoalSuggestContext`. */
export interface SuggestContext {
  constraints: ConstraintDraft;
  safety: SafetySnapshot;
  startDate: string;
  noWeightLossGoal: boolean;
  optedTier: string | null;
  maxFastHours: number;
}

let context: SuggestContext | null = null;
export function setSuggestContext(c: SuggestContext | null): void {
  context = c;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const REACH_TIMEOUT_MS = 15_000;
const TIERS: readonly string[] = ['T2', 'T3', 'T4'];

/** Confirmed readings above the lab's printed upper limit (the markers package adds its own notes when it lands). */
export function markerNotesFromDoc(doc: unknown): { notes: MarkerNote[]; answered: boolean } {
  if (!isObj(doc)) return { notes: [], answered: false };
  const readings = Array.isArray(doc.readings) ? doc.readings.filter(isObj) : [];
  const newest = new Map<string, Record<string, unknown>>();
  for (const r of readings) {
    if (r.confirmed !== true || typeof r.id !== 'string' || typeof r.date !== 'string') continue;
    const p = newest.get(r.id);
    if (!p || String(p.date) < r.date) newest.set(r.id, r);
  }
  const notes: MarkerNote[] = [];
  for (const [id, r] of newest) {
    const range = isObj(r.labRange) ? r.labRange : null;
    const high = typeof range?.high === 'number' ? range.high : null;
    const value = typeof r.value === 'number' ? r.value : null;
    if (high === null || value === null || value <= high) continue;
    notes.push({
      markerId: id,
      severity: 'caution',
      because: { markerId: id, label: id, value, unit: String(r.unit ?? ''), date: r.date as string },
    });
  }
  return { notes, answered: doc.chapter === 'manual' || doc.chapter === 'report' || readings.length > 0 };
}

async function probeReach(
  profile: ReturnType<typeof summarizeBody>['profile'],
  c: SuggestContext | null,
  signal?: AbortSignal,
): Promise<TargetReach[]> {
  if (!c) return [];
  const goals = suggestionProbeGoals();
  const request = buildPlannerRequest({
    goals: [],
    horizonDays: SUGGEST_HORIZON_DAYS,
    startDate: c.startDate,
    constraints: c.constraints,
    strictness: 'balanced',
    profile,
    safety: c.safety,
  });
  request.goals = goals;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      estimateTargetsAsync(request),
      new Promise<TargetReach[]>((resolve) => {
        timer = setTimeout(() => resolve([]), REACH_TIMEOUT_MS);
        signal?.addEventListener('abort', () => resolve([]), { once: true });
      }),
    ]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** The markers document (`markers/me`, added by the blood-markers chapter); null until that collection exists. */
/** Notes from E20's rule engine through `markers.get` (as the asking actor); null when there is nothing to evaluate. */
async function markerNotesFromEvaluation(
  actor: Actor,
): Promise<{ notes: MarkerNote[]; answered: boolean } | null> {
  try {
    const r = await dispatch('markers.get', {}, { actor });
    if (!r.ok || !('output' in r)) return null;
    const view = r.output as MarkersView;
    if (!view.doc.readings.length)
      return view.doc.chapter === 'skipped' ? { notes: [], answered: false } : null;
    const notes = view.notes.filter((n) => n.kind !== 'retest');
    return {
      notes: notes.map((n) => ({
        markerId: n.markerId,
        severity: n.severity,
        because: n.because,
        text: n.text,
      })),
      answered: true,
    };
  } catch {
    return null;
  }
}

function peekMarkers(store: ReturnType<typeof getDocumentStore>): unknown {
  try {
    return (store.peek as (col: string, id: string) => unknown)('markers', 'me');
  } catch {
    return null;
  }
}

/** The suggester's input from the stores now. */
export async function gatherSuggestionInput(opts: {
  signal?: AbortSignal;
  actor: Actor;
  purpose?: GoalSuggestionInput['purpose'];
}): Promise<GoalSuggestionInput> {
  const values = selectBodyValues(useProfileStore.getState());
  const body = summarizeBody(values);
  const habits = body.profile.habits;
  const labs = body.profile.labs;
  const intake = readIntake() as unknown as SuggestIntake;
  const store = getDocumentStore();
  // I2: the markers package's rule engine (E20) gives the notes (severity and because-line from the interaction table);
  // the printed-range fallback below only runs when it cannot (no readings, or the evaluation throws)
  const fromDoc = (await markerNotesFromEvaluation(opts.actor)) ?? markerNotesFromDoc(peekMarkers(store));
  const fromLabs = labNotes(labs).filter((n) => !fromDoc.notes.some((d) => d.markerId === n.markerId));
  const c = context;
  const reach = body.complete ? await probeReach(body.profile, c, opts.signal) : [];
  return {
    profile: {
      complete: body.complete,
      sex: body.sex === 'male' || body.sex === 'female' ? body.sex : null,
      ageYears: body.missing.includes('age') ? null : body.ageYears,
      heightCm: body.missing.includes('height') ? null : body.heightCm,
      weightKg: body.missing.includes('weight') ? null : body.weightKg,
      ...(habits ? { habits } : {}),
      ...(labs ? { labs } : {}),
    },
    body: {
      bfPct: body.complete ? body.bodyFatPct : null,
      bfBand: body.complete ? [body.bodyFatBand80[0], body.bodyFatBand80[1]] : null,
      leanKg: body.complete ? body.leanMassKg : null,
      ...(body.measured.waist && values.waist.cm !== null ? { waistCm: values.waist.cm } : {}),
      ...(body.complete ? { visceralKg: body.vatKg } : {}),
      trainingAgeY: trainingYears(habits?.trainingHistory),
      basedOnAverages: body.basedOnAverages,
      measuredBodyFat: body.measured.bodyFat,
    },
    intake,
    markers: [...fromDoc.notes, ...fromLabs],
    markersAnswered: fromDoc.answered,
    safety: {
      noWeightLossGoal: c?.noWeightLossGoal ?? false,
      optedTier: c?.optedTier && TIERS.includes(c.optedTier) ? (c.optedTier as FastingTierOptIn) : null,
      ...(c ? { maxFastHours: c.maxFastHours } : {}),
    },
    reach,
    horizonDays: SUGGEST_HORIZON_DAYS,
    ...(opts.purpose ? { purpose: opts.purpose } : {}),
  };
}

/** Fingerprint of the answers a suggestion was made from ("Your answers changed since this was suggested"). */
export function answersFingerprint(purpose?: GoalSuggestionInput['purpose']): string {
  const v = selectBodyValues(useProfileStore.getState());
  const intake = readIntake();
  return JSON.stringify([
    v.revision,
    v.updatedAt,
    intake.answeredAt,
    intake.skipped ?? null,
    purpose ?? null,
  ]);
}

installPorts({ goalSuggest: { gather: gatherSuggestionInput } });
