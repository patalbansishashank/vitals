/**
 * A goal suggestion → the `goals.edit` ops the proposal card's keys dispatch (planner-goals.md §12.2): Apply replaces
 * the goal list and the listed limits; "Add only new goals" appends the goals not already listed (up to six). Both
 * record `goals.suggested` (`setSuggested`) with the provenance and the keys of the goals the suggestion added.
 */
import type { GoalSuggestion, SuggestedGoal } from '@/engine/planner/domain/suggestGoals';
import type { ConstraintDraft, GoalDraft, GoalMode } from '@/state/plannerStore';
import { MAX_PLANNER_GOALS } from '@/state/plannerStore';
import { goalMetric, modeSpec, modeTakesAmount } from './catalogue';
import type { editGoals } from './commands';

type GoalOps = Parameters<typeof editGoals>[0];
export type ApplyMode = 'replace' | 'append';

/** One suggested goal as a goal row (the catalogue's mode when the metric offers it; its default otherwise). */
export function draftOf(g: SuggestedGoal, key: string): GoalDraft | null {
  const m = goalMetric(g.metric);
  if (!m || !m.eligible) return null;
  const spec = m.modes.some((x) => x.mode === g.mode) ? modeSpec(m, g.mode as GoalMode) : m.modes[0]!;
  const amount = modeTakesAmount(spec) ? (g.target ?? m.target?.fallback ?? 1) : null;
  return { key, metric: m.id, mode: spec.mode, amount, strength: 'should', functional: null };
}

/** The limits a suggestion sets, as a `setLimits` patch. */
export function limitsPatch(s: GoalSuggestion): Partial<ConstraintDraft> {
  const c = s.constraints;
  const out: Partial<ConstraintDraft> = {};
  if (c.trainingDays) out.trainingDays = [c.trainingDays[0], c.trainingDays[1]];
  if (c.trainingTimeH !== undefined) out.trainingTimeH = c.trainingTimeH;
  if (c.maxSessionMin !== undefined) out.maxSessionMin = c.maxSessionMin;
  if (c.earliestH !== undefined) out.earliestH = c.earliestH;
  if (c.latestH !== undefined) out.latestH = c.latestH;
  if (c.longestFastH !== undefined) out.longestFastH = c.longestFastH;
  if (c.sleepFixed !== undefined) out.sleepFixed = c.sleepFixed;
  return out;
}

export function suggestionOps(s: GoalSuggestion, current: readonly GoalDraft[], mode: ApplyMode, now: Date = new Date()): { ops: GoalOps; added: GoalDraft[] } {
  const at = now.toISOString();
  const keySalt = now.getTime().toString(36);
  const ops: GoalOps = [];
  const keep = mode === 'replace' ? [] : current;
  if (mode === 'replace') for (const g of current) ops.push({ op: 'remove', key: g.key });
  const added: GoalDraft[] = [];
  for (const g of s.goals) {
    if (keep.length + added.length >= MAX_PLANNER_GOALS) break;
    if (keep.some((x) => x.metric === g.metric) || added.some((x) => x.metric === g.metric)) continue;
    const d = draftOf(g, `${g.metric}-suggested-${keySalt}`);
    if (d) added.push(d);
  }
  for (const d of added) ops.push({ op: 'add', goal: d });
  if (mode === 'replace') {
    const patch = limitsPatch(s);
    if (Object.keys(patch).length) ops.push({ op: 'setLimits', patch });
  }
  ops.push({ op: 'setSuggested', record: { suggestion: s as never, at, provenance: { source: s.source, version: s.version }, goalKeys: added.map((d) => d.key) } });
  return { ops, added };
}

/** A goal still reads as suggested while it matches the suggestion it came from (the engraved "suggested" tag). */
export function isUntouchedSuggestion(g: GoalDraft, record: { suggestion: GoalSuggestion; goalKeys: readonly string[] } | null): boolean {
  if (!record || !record.goalKeys.includes(g.key)) return false;
  const s = record.suggestion.goals.find((x) => x.metric === g.metric);
  if (!s) return false;
  const d = draftOf(s, g.key);
  return !!d && d.mode === g.mode && d.amount === g.amount && g.strength === 'should';
}

/** The suggestion's one-line reason for a goal, shown under its row until the person edits that goal (Q3-J4-05). */
export function suggestionWhy(g: GoalDraft, record: { suggestion: GoalSuggestion; goalKeys: readonly string[] } | null): string | null {
  if (!record || !isUntouchedSuggestion(g, record)) return null;
  const why = record.suggestion.goals.find((x) => x.metric === g.metric)?.why?.trim();
  return why || null;
}
