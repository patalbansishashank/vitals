/**
 * Intake → profile derivation (SUITE_SPEC §2.3.1; importable only from `src/commands/**`). `intake.answer` derives the
 * habit fields the answers imply — the activity intake itself (`habits.activity`, so the Simulator and the Planner
 * resolve the same maintenance as Your body), steps and sessions from the activity chapter, the diet level and alcohol
 * from the food chapter — with the intake package's own reducers (`chapterOutput`), headlessly.
 */
import type { ActivityDriverId } from '@/engine/types/profile';
import { explainMaintenance, type MaintenanceExplanation } from '@/features/body/maintenance';
import { summarizeBody } from '@/features/body/model';
import { measuredRmrKcal, reduceActivity } from '@/features/intake/chapters/activity';
import { hasStepDevice } from '@/features/intake/chapters/devices';
import { detectIndia, flowContextOf } from '@/features/intake/context';
import { toIntakeDoc, turnsOf } from '@/features/intake/doc';
import { chapterOutput, type SectionContext } from '@/features/intake/sections';
import type { ChapterId, IntakeDoc, IntakeSectionId, MeasuredEnergy } from '@/features/intake/types';
import { deepEqual } from '@/store';
import { getDocumentStore } from '../runtime';
import { applyProfilePatch, bodyValues } from './profile';
import { safetyAccessNow, safetyValues } from './safety';

/** The chapter whose raw turns ride along in a section (the sections that carry habit answers). */
const HABIT_CHAPTER: Partial<Record<IntakeSectionId, ChapterId>> = { activity: 'activity', diet: 'food' };

/** The intake flow context, headlessly (what `useFlowContext` gives the screens). */
export function intakeContextNow(doc: IntakeDoc, now: string): SectionContext {
  const access = safetyAccessNow(now);
  return {
    india: detectIndia(),
    gentle: access.ready && access.outcome.restrictions.includes('R1'),
    stepDevice: hasStepDevice(doc.devices),
    safety: safetyValues().answers,
    now,
  };
}

export function intakeDocNow(): IntakeDoc {
  return toIntakeDoc(getDocumentStore().peek('intake', 'me'));
}

/**
 * Habit fields the stored intake implies after `section` changed, only where they differ from the profile now
 * (`null` clears a field). Null when nothing changes.
 */
export function derivedHabits(section: IntakeSectionId, body: Record<string, unknown>, now: string): Record<string, unknown> | null {
  const chapter = HABIT_CHAPTER[section];
  if (!chapter) return null;
  const doc = toIntakeDoc(body);
  const out = chapterOutput(chapter, turnsOf(doc, chapter), intakeContextNow(doc, now));
  const habits: Record<string, unknown> = { ...out.habits };
  if (section === 'activity') {
    // the engine's `ActivityIntake` only: the turns and the measured figure (bound to `labs` below) stay in the intake
    const { turns: _turns, measured: _measured, ...activity } = (doc.activity ?? {}) as Record<string, unknown>;
    void _turns;
    void _measured;
    habits.activity = Object.keys(activity).length ? activity : null;
  }
  const cur = bodyValues().habits as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(habits)) {
    if (v === null || v === undefined) {
      if (cur[k] !== undefined) changed[k] = null;
    } else if (!deepEqual(cur[k], v)) changed[k] = v;
  }
  return Object.keys(changed).length ? changed : null;
}

/**
 * The lab value a measured-energy answer sets (§13.1): a metabolic-cart resting figure becomes
 * `labs.measuredRmrKcal`, exactly the field the v2 "measured" path wrote with `profile.patch`. When the answer stops
 * qualifying (changed to another method, to maintenance, or to "no"), the value is cleared only if it is still the one
 * the intake wrote — a value typed on Your body › labs is never touched. Null when nothing changes.
 */
export function derivedLabs(before: unknown, after: unknown): { measuredRmrKcal: number | null } | null {
  const was = measuredRmrKcal((before as { measured?: MeasuredEnergy } | undefined)?.measured);
  const now = measuredRmrKcal((after as { measured?: MeasuredEnergy } | undefined)?.measured);
  const cur = (bodyValues().labs as Record<string, number | undefined> | undefined)?.measuredRmrKcal;
  if (now !== null) return cur === now ? null : { measuredRmrKcal: now };
  if (was !== null && cur === was) return { measuredRmrKcal: null };
  return null;
}

export function applyDerivedLabs(labs: { measuredRmrKcal: number | null }): void {
  applyProfilePatch({ labs });
}

/** Write the derived habit fields (one profile change inside the intake command). */
export function applyDerivedHabits(changed: Record<string, unknown>): void {
  applyProfilePatch({ habits: changed });
}

/** `profile.explainMaintenance`: what drove the estimate, with the assumed (skipped) drivers of the activity intake. */
export function maintenanceExplanationNow(now: string): MaintenanceExplanation & { rmrKcal: number; rmrMethod: string; steps: number; sessionsPerWeek: number } {
  const doc = intakeDocNow();
  const m = summarizeBody(bodyValues()).maintenance;
  const turns = turnsOf(doc, 'activity');
  const defaulted: ActivityDriverId[] = Object.keys(turns.status).length ? reduceActivity(turns, flowContextOf(intakeContextNow(doc, now))).defaulted : [];
  const ex = explainMaintenance(m, m.resolved.habits.activity, defaulted);
  return { ...ex, rmrKcal: m.rmrKcal, rmrMethod: m.rmrMethod, steps: m.steps, sessionsPerWeek: m.sessionsPerWeek };
}
