/**
 * Live maintenance for the intake and Your body: the stored body inputs with the "a normal day" answers in force (the
 * draft while answering), through the same `summarizeBody` → `resolveProfile` the Simulator uses.
 */
import { useMemo } from 'react';
import type { ActivityDriverId } from '@/engine/types/profile';
import { summarizeBody, withIntakeActivity, type BodySummary } from '@/features/body/model';
import { useBodyValues, type BodyProfileValues } from '@/state/profileStore';
import type { EnergyUnit } from '@/state/settingsStore';
import { reduceActivity, type ActivityResult } from './chapters/activity';
import type { FlowContext } from './flow';
import { maintenanceView, type MaintenanceView } from './maintenanceView';
import type { ChapterAnswers } from './types';

/** Body values with the activity answers (and, while answering, their habit fields) applied — never written. */
export function draftBodyValues(v: BodyProfileValues, r: ActivityResult, withHabits: boolean): BodyProfileValues {
  let habits = { ...v.habits };
  if (withHabits) {
    for (const [k, x] of Object.entries(r.habits)) (habits as Record<string, unknown>)[k] = x;
    if (r.clearTypicalSteps) {
      const { typicalSteps: _drop, ...rest } = habits;
      habits = rest;
    }
  }
  if (r.activity) return { ...v, habits: { ...habits, activity: r.activity } };
  return withIntakeActivity({ ...v, habits }, undefined);
}

export interface LiveMaintenance {
  summary: BodySummary;
  result: ActivityResult;
  defaulted: readonly ActivityDriverId[];
  view: MaintenanceView;
}

export function useLiveMaintenance(answers: ChapterAnswers, ctx: FlowContext, unit: EnergyUnit, withHabits: boolean): LiveMaintenance {
  const v = useBodyValues();
  const result = useMemo(() => reduceActivity(answers, ctx), [answers, ctx]);
  const summary = useMemo(() => summarizeBody(draftBodyValues(v, result, withHabits)), [v, result, withHabits]);
  const view = useMemo(() => maintenanceView(summary.maintenance, summary.maintenance.resolved.habits.activity, result.defaulted, unit), [summary, result, unit]);
  return { summary, result, defaulted: result.defaulted, view };
}
