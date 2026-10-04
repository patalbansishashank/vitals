/**
 * Every model parameter a topic can link to (`Mechanism.relatedParamIds`), by id: the engine modules' parameters plus
 * the parameter sets that live outside the module registry (activity intake, tracking and re-planning, catalogue
 * constants). The Evidence library shows them as parameter cards.
 */
import { CATALOGUE_PARAMS } from '@/catalogues/params';
import { MODULES } from '@/engine/core/moduleRegistry';
import { ASSIMILATION_PARAMS } from '@/engine/assimilation/params';
import { ACTIVITY_INTAKE_PARAMS } from '@/engine/intake/activity/params';
import type { ParamDef } from '@/engine/types/params';

export const ALL_PARAMS: readonly ParamDef[] = [
  ...MODULES.flatMap((m) => m.params),
  ...ACTIVITY_INTAKE_PARAMS,
  ...ASSIMILATION_PARAMS,
  ...CATALOGUE_PARAMS,
];

export const PARAM_INDEX: ReadonlyMap<string, ParamDef> = new Map(ALL_PARAMS.map((p) => [p.id, p]));

export function findParam(id: string): ParamDef | undefined {
  return PARAM_INDEX.get(id);
}
