/**
 * The sources of the marker rule context besides the profile and the screening flags (./../context.ts): the screening's
 * medicines answer, the intake document's supplements and diet kind, the live plan and the plans that started before it
 * (their diet exposure — animal-food level and the carbohydrate class of their schedule, D7-05 — decides the diet change
 * date). Read synchronously (commands, the planner precondition) or live (screens). Store reads only through the public
 * projections (no store internals).
 */
import { useMemo } from 'react';
import { toIntakeDoc, useIntakeDoc } from '@/features/intake/doc';
import type { IntakeDoc } from '@/features/intake/types';
import type { PlanDoc, PlanVersionDoc } from '@/living';
import { profileFromIntake } from '@/features/living/food/profileModel';
import { getActivePlanSource, useActivePlan } from '@/features/living/mode';
import { isLivePlan } from '@/features/living/activePlan';
import { getDocumentStore } from '@/state/runtime';
import { useSafetyStore } from '@/state/safetyStore';
import type { CarbClass, MarkerContextInputs } from '../context';
import { planCarbClass } from './planLevers';

export type MarkerContextSources = Pick<MarkerContextInputs, 'medications' | 'supplements' | 'dietKind' | 'plan' | 'earlierPlans'>;

type Answers = { medications?: string; medicationItems?: readonly string[] } | null | undefined;
type Plan = { id?: string; status: string; startDate: string; doc?: Pick<PlanDoc, 'baselineProfile'>; version?: Pick<PlanVersionDoc, 'schedule'> } | null | undefined;
type EarlierPlans = NonNullable<MarkerContextInputs['earlierPlans']>;

const patternOf = (d: Pick<PlanDoc, 'baselineProfile'> | undefined): string | null => d?.baselineProfile?.habits?.dietAnimalLevel ?? null;

/** The carbohydrate class of a plan's schedule (null when not determinable: never guessed). */
function carbClassOf(d: Pick<PlanDoc, 'baselineProfile'> | undefined, v: Pick<PlanVersionDoc, 'schedule'> | undefined): CarbClass | null {
  if (!v?.schedule) return null;
  const w = d?.baselineProfile?.body?.weightKg;
  return planCarbClass({ schedule: v.schedule, ...(w ? { weightKg: w } : {}) });
}

/** The plans that actually started (ended after their start day), with their diet exposure (§13.5 diet change, D7-05). */
function earlierPlansNow(liveId: string | undefined): EarlierPlans {
  try {
    const store = getDocumentStore();
    return store
      .peekAll<PlanDoc>('plans')
      .filter((d) => d._id !== liveId && d.status === 'ended' && (!d.ended || d.ended.date > d.startDate))
      .map((d) => {
        const v = store.peek<Pick<PlanVersionDoc, 'schedule'>>('planVersions', `${d._id}:v${d.headVersion}`);
        return { startDate: d.startDate, dietPattern: patternOf(d), carbClass: carbClassOf(d, v ?? undefined) };
      });
  } catch {
    return [];
  }
}

function sourcesOf(answers: Answers, intake: IntakeDoc, plan: Plan): MarkerContextSources {
  const food = profileFromIntake(intake);
  const live = plan && isLivePlan(plan as never) ? plan : null;
  return {
    medications: answers?.medications ? { answer: answers.medications, items: answers.medicationItems ?? [] } : null,
    supplements: food.supplements ?? null,
    dietKind: food.dietKind,
    plan: live ? { status: live.status, startDate: live.startDate, dietPattern: patternOf(live.doc), carbClass: carbClassOf(live.doc, live.version) } : null,
    earlierPlans: live ? earlierPlansNow(live.id) : [],
  };
}

/** The sources now (synchronous; the store caches). */
export function readMarkerContextSources(): MarkerContextSources {
  let intake: IntakeDoc;
  try {
    intake = toIntakeDoc(getDocumentStore().peek('intake', 'me'));
  } catch {
    intake = toIntakeDoc(null);
  }
  return sourcesOf(useSafetyStore.getState().answers as Answers, intake, getActivePlanSource().get().plan);
}

/** The sources, live. */
export function useMarkerContextSources(): MarkerContextSources {
  const answers = useSafetyStore((s) => s.answers) as Answers;
  const intake = useIntakeDoc();
  const plan = useActivePlan();
  return useMemo(() => sourcesOf(answers, intake, plan), [answers, intake, plan]);
}
