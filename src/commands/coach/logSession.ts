/**
 * `log.session` (E9b; E5 left it a stub): a training session from free text or `performed[]`.
 *
 * Each performed item is resolved against the catalogue (exact name/alias or `exerciseId`); unknown names go through
 * `resolveUnknown` with `aiPorts().resolveExercise` as the resolver (the keyword heuristic stands in when no provider
 * is configured). The stimulus of what was done is compared with the day's prescribed session (`stimulusEquivalence`)
 * and a `session` LogEntry is appended through the command's transaction. New exercises are returned as drafts
 * (`unresolved`) for the person to confirm; they are not added to the user catalogue here.
 */
import {
  createCatalogue,
  draftToRecord,
  resolveSession,
  resolveUnknown,
  stimulusEquivalence,
  type Catalogue,
  type ExerciseDraft,
  type ExerciseRecord,
  type PerformedExercise,
  type StimulusContext,
  type StimulusVector,
  type TrainingRegion,
} from '@/catalogues';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import { aiPorts } from '../aiPorts';
import { implementLate as implement } from './late';
import type { CommandContext } from '../types';

interface Input {
  date?: string;
  status: 'done' | 'partial' | 'skipped';
  slotKey?: string;
  startH?: number;
  durationMin?: number;
  performed: PerformedExercise[];
  rpe?: number;
  bioWorkoutId?: string;
}

interface PrescribedSessionView {
  slotKey: string;
  kind: 'resistance' | 'cardio';
  stimulus: StimulusVector | null;
}

export interface ResolvedExerciseView {
  /** What was typed (or the catalogue id given). */
  input: string;
  exerciseId: string;
  name: string;
  via: 'catalogue' | 'ai' | 'heuristic' | 'user';
  confidence: number;
  /** Not in the catalogue yet (a draft record stands in for it). */
  isNew: boolean;
}

export interface UnresolvedView {
  name: string;
  /** The draft that stood in for the credit calculation; confirm it, correct it or add it with `catalogue.addExercise`. */
  draft: ExerciseDraft;
  exerciseId: string;
  reason: string;
}

interface Region {
  region: string;
  note: string;
}

const slug = (name: string): string => `user-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exercise'}`;

/** "sandbag carries 3 x 40" → name + sets × reps; "stairs 20 min" → minutes. */
function parseText(text: string): { name: string; sets?: number; reps?: number; minutes?: number } {
  let t = ` ${text} `;
  const out: { name: string; sets?: number; reps?: number; minutes?: number } = { name: '' };
  const sr = /(\d+)\s*[x×]\s*(\d+)/i.exec(t);
  if (sr) {
    out.sets = Number(sr[1]);
    out.reps = Number(sr[2]);
    t = t.replace(sr[0], ' ');
  }
  const mn = /(\d+(?:\.\d+)?)\s*(?:min|mins|minutes)\b/i.exec(t);
  if (mn) {
    out.minutes = Number(mn[1]);
    t = t.replace(mn[0], ' ');
  }
  out.name = t.replace(/[,;:·-]+\s*$/, '').replace(/\s+/g, ' ').trim();
  return out;
}

const hasDose = (p: PerformedExercise): boolean => p.sets !== undefined || p.setCount !== undefined || p.minutes !== undefined || p.rounds !== undefined || p.workSec !== undefined || p.holdSec !== undefined;

function stimulusContext(): StimulusContext {
  try {
    const p = simulatorProfileNow();
    return { bodyMassKg: p.body.weightKg, vo2max: 40, heightM: p.body.heightCm / 100 };
  } catch {
    return { bodyMassKg: 75, vo2max: 40, heightM: 1.7 };
  }
}

async function prescribedFor(date: string): Promise<PrescribedSessionView[]> {
  const { dispatch } = await import('../bus');
  const r = await dispatch('day.get', { date });
  if (!r.ok || !('output' in r)) return [];
  const rx = (r.output as { prescription?: { sessions?: PrescribedSessionView[] } | null }).prescription;
  return rx?.sessions ?? [];
}

const REGION_LABEL = (r: string): string => r.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

function regionNotes(pre: StimulusVector | null, done: StimulusVector): Region[] {
  const a = pre?.effectiveSetsByRegion ?? {};
  const b = done.effectiveSetsByRegion;
  const regions = [...new Set([...Object.keys(a), ...Object.keys(b)])] as TrainingRegion[];
  const out: Region[] = [];
  for (const r of regions) {
    const want = a[r] ?? 0;
    const got = b[r] ?? 0;
    const label = REGION_LABEL(r);
    if (want === 0) out.push({ region: r, note: `also trained ${label} (${got.toFixed(1)} effective sets)` });
    else if (got >= want * 0.9) out.push({ region: r, note: `${label}: covered (${got.toFixed(1)} of ${want.toFixed(1)} effective sets)` });
    else if (got === 0) out.push({ region: r, note: `${label}: not trained (${want.toFixed(1)} effective sets prescribed)` });
    else out.push({ region: r, note: `${label}: ${got.toFixed(1)} of ${want.toFixed(1)} effective sets` });
  }
  return out;
}

async function logSession(ctx: CommandContext, input: Input) {
  // the seed catalogue loads with the first logged session, not with the command registry (SUITE_SPEC §9.5: catalogues lazy)
  const { SEED_CATALOGUE, SEED_INPUT } = await import('@/content/catalogues');
  const date = input.date ?? ctx.today;
  const resolver = aiPorts().resolveExercise;
  const extra: ExerciseRecord[] = [];
  const resolved: ResolvedExerciseView[] = [];
  const unresolved: UnresolvedView[] = [];
  const performed: PerformedExercise[] = [];

  // expand free text lists ("a 3x10, b 20 min") into one item each
  const items: Array<{ p: PerformedExercise; text?: string }> = [];
  for (const p of input.performed) {
    if (p.exerciseId === undefined && p.freeText && /[,;\n]/.test(p.freeText) && !hasDose(p)) for (const part of p.freeText.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)) items.push({ p: {}, text: part });
    else items.push({ p, ...(p.exerciseId === undefined && p.freeText ? { text: p.freeText } : {}) });
  }

  for (const { p, text } of items) {
    if (p.exerciseId !== undefined && SEED_CATALOGUE.exercise(p.exerciseId)) {
      const ex = SEED_CATALOGUE.exercise(p.exerciseId)!;
      resolved.push({ input: p.exerciseId, exerciseId: ex.id, name: ex.name, via: 'catalogue', confidence: 1, isNew: false });
      performed.push(p);
      continue;
    }
    const typed = text ? parseText(text) : { name: p.exerciseId ?? p.freeText ?? '' };
    const name = typed.name || p.freeText || p.exerciseId || 'exercise';
    const draft = await resolveUnknown(name, text && text !== name ? text : p.freeText, { catalogue: SEED_CATALOGUE, ...(resolver ? { resolver } : {}) });
    if (draft.resolvedBy === 'catalogue' && draft.basedOn) {
      const ex = SEED_CATALOGUE.exercise(draft.basedOn)!;
      resolved.push({ input: name, exerciseId: ex.id, name: ex.name, via: 'catalogue', confidence: 1, isNew: false });
      performed.push(withDose({ ...p, exerciseId: ex.id, ...(text ? { freeText: text } : {}) }, ex, typed, hasDose(p)));
      continue;
    }
    const id = slug(name);
    const rec = draftToRecord(draft, { id });
    if (!extra.some((e) => e.id === id)) extra.push(rec);
    const via = draft.resolvedBy === 'user' ? 'user' : draft.resolvedBy === 'ai' ? 'ai' : 'heuristic';
    resolved.push({ input: name, exerciseId: id, name: draft.name, via, confidence: draft.confidence, isNew: true });
    unresolved.push({
      name,
      draft,
      exerciseId: id,
      reason: via === 'heuristic' ? 'not in the catalogue; counted like the closest known exercise until confirmed' : 'not in the catalogue; described by the exercise resolver, to be confirmed',
    });
    performed.push(withDose({ ...p, exerciseId: id, ...(text ? { freeText: text } : {}) }, rec, typed, hasDose(p)));
  }

  const catalogue: Catalogue = extra.length > 0 ? createCatalogue(SEED_INPUT, { exercises: extra }) : SEED_CATALOGUE;
  const sctx = stimulusContext();
  const doneVector = input.status === 'skipped' ? resolveSession([], catalogue, sctx).vector : resolveSession(performed, catalogue, sctx).vector;

  // the day's prescription: the named slot, else the closest of the day's sessions
  const sessions = await prescribedFor(date);
  const withStim = sessions.filter((s) => s.stimulus);
  let slot: PrescribedSessionView | undefined = input.slotKey ? sessions.find((s) => s.slotKey === input.slotKey) : undefined;
  if (!slot && !input.slotKey && withStim.length > 0) {
    slot = withStim.length === 1 ? withStim[0] : withStim.map((s) => ({ s, c: stimulusEquivalence(s.stimulus!, doneVector).credit })).sort((a, b) => b.c - a.c)[0]!.s;
  }
  const pre = slot?.stimulus ?? null;

  // "done as planned" with nothing listed: the prescribed stimulus is what was done
  const asPlanned = input.status === 'done' && performed.length === 0 && pre !== null;
  const stimulus = asPlanned ? pre! : doneVector;

  let equivalence: {
    credit: number | null;
    score: number | null;
    parity: boolean | null;
    band: string | null;
    vsSlotKey: string | null;
    perRegion: Region[];
    shortfall: Array<{ term: string; missing: number; text: string }>;
    alsoTrained: string[];
    note?: string;
  };
  if (input.status === 'skipped') {
    equivalence = { credit: 0, score: 0, parity: false, band: pre ? 'different' : null, vsSlotKey: slot?.slotKey ?? null, perRegion: regionNotes(pre, stimulus), shortfall: [], alsoTrained: [], note: 'skipped' };
  } else if (!pre) {
    equivalence = { credit: null, score: null, parity: null, band: null, vsSlotKey: null, perRegion: regionNotes(null, stimulus), shortfall: [], alsoTrained: [], note: 'no prescribed session to compare with' };
  } else if (asPlanned) {
    equivalence = { credit: 1, score: 1, parity: true, band: 'full', vsSlotKey: slot!.slotKey, perRegion: regionNotes(pre, stimulus), shortfall: [], alsoTrained: [] };
  } else {
    const e = stimulusEquivalence(pre, stimulus);
    equivalence = {
      credit: round2(e.credit),
      score: round2(e.score),
      parity: e.parity,
      band: e.band,
      vsSlotKey: slot!.slotKey,
      perRegion: regionNotes(pre, stimulus),
      shortfall: e.shortfall.map((s) => ({ term: s.term, missing: round2(s.missing), text: s.text })),
      alsoTrained: e.alsoTrained,
    };
  }

  const itemId = slot ? `${slot.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${slot.slotKey}` : undefined;
  const { appendLogEntry } = await import('./entries');
  const entryId = await appendLogEntry<'session'>(ctx, date, {
    kind: 'session',
    status: input.status,
    ...(input.startH !== undefined ? { startH: input.startH } : {}),
    ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
    performed,
    ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
    ...(input.bioWorkoutId ? { bioWorkoutId: input.bioWorkoutId } : {}),
    stimulus,
    catalogueVersion: catalogue.version,
    ...(itemId ? { itemId } : {}),
    ...(resolved.some((r) => r.isNew) ? { assumed: true, confidence: Math.min(...resolved.map((r) => r.confidence)) } : {}),
  });
  return { entryId, date, equivalence, resolvedExercises: resolved, unresolved };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Fill the dose of a typed item: what was typed, else the exercise's default. */
function withDose(p: PerformedExercise, ex: ExerciseRecord, typed: { sets?: number; reps?: number; minutes?: number }, already: boolean): PerformedExercise {
  if (already) return p;
  if (typed.sets !== undefined) return { ...p, setCount: typed.sets, ...(typed.reps !== undefined ? { reps: typed.reps } : {}) };
  if (typed.minutes !== undefined) return { ...p, minutes: typed.minutes };
  const d = ex.defaultDose;
  if ((d.sets ?? d.rounds ?? 0) > 0 && ex.loadType !== 'cardio' && ex.loadType !== 'mobility') return { ...p, setCount: d.sets ?? d.rounds ?? 3, ...(d.reps !== undefined ? { reps: d.reps } : {}) };
  return { ...p, minutes: d.durationMin ?? 20 };
}

implement('log.session', logSession, 'E9b');
