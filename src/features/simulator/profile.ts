import { renalSafetyFlags } from '@/lib/renalScope';
/**
 * The engine profile a Simulator run uses: the Your-body `PersonProfile` (`usePersonProfile()` from the profile
 * store) with the screening outcome merged in as engine safety `{mode, flags}` — the profile store leaves that to the
 * caller — so the engine arms its population rules (W-P*, W-M05, W-M10, W-X05, dossier 17 §3).
 */
import { useMemo } from 'react';
import type { PersonProfile, SafetyFlags, SafetyMode } from '@/engine';
import { useSafetyAccess, type SafetyAccess } from '@/features/onboarding';
import { useBodyContext, usePersonProfile } from '@/state/profileStore';
import { withMarkerLabs } from '@/markers/baselines'; // E20: markers
import { markersToday, useMarkersDoc } from '@/markers/ui/markersDoc'; // E20: markers
import { useMarkerRuleContext } from '@/markers/ui/useMarkers';

type Flag = SafetyAccess['outcome']['flags'][number];

const DIABETES_MEDS: ReadonlyArray<[Flag, NonNullable<SafetyFlags['diabetesMedication']>]> = [
  ['insulin', 'insulin'],
  ['sulfonylurea', 'sulfonylurea'],
  ['sglt2-inhibitor', 'sglt2'],
  ['glp1', 'glp1'],
  ['metformin', 'metforminOnly'],
  ['diabetes-diet-only', 'dietOnly'],
];

const INTERACTING: readonly Flag[] = [
  'diuretic',
  'raas-blocker',
  'other-antihypertensive',
  'lithium',
  'topiramate-zonisamide',
  'corticosteroid',
  'qt-prolonging',
  'chemotherapy',
  'antacid',
  'anticoagulant',
  'thyroid-hormone',
  'other-medication',
];

/**
 * Screening outcome → engine SafetyFlags (only flags the engine reads; absent = false). C5: the SAME encoding as the
 * planner request's `profileSafetyFrom` (src/features/planner/request.ts; parity test `safetyEncoder.parity.test.ts`), so a
 * planner certificate made under the current screening verifies at lifecycle boundaries that read this profile.
 */
export function engineSafety(access: Pick<SafetyAccess, 'outcome' | 'fasting'>): {
  mode: SafetyMode;
  flags: SafetyFlags;
} {
  const f = new Set(access.outcome.flags);
  const has = (x: Flag) => f.has(x);
  const flags: SafetyFlags = {};
  if (has('pregnant')) flags.pregnantOrBreastfeeding = true;
  if (has('planning-pregnancy')) flags.planningPregnancy = true;
  if (has('ed-history') || has('scoff-risk')) flags.eatingDisorderRisk = true;
  if (has('type-1-diabetes')) flags.type1Diabetes = true;
  const med = DIABETES_MEDS.find(([k]) => has(k));
  if (med) flags.diabetesMedication = med[1];
  if (has('heart-condition') || has('high-blood-pressure') || has('stroke')) flags.cardiovascularOrBp = true;
  if (has('kidney-disease')) flags.kidneyDisease = true;
  if (has('liver-disease')) flags.liverDisease = true;
  if (has('gout')) flags.gout = true;
  if (has('kidney-stones')) flags.kidneyStones = true;
  if (has('gallstones')) flags.gallstones = true;
  if (has('pancreatitis')) flags.pancreatitis = true;
  if (has('rare-metabolic')) flags.fatOxidationDisorderOrPorphyria = true;
  if (INTERACTING.some(has)) flags.medicationInteraction = true;
  if (has('exercise-symptoms')) flags.faintingOrChestPain = true;
  if (has('supervised-exercise-only') || has('musculoskeletal')) flags.exerciseRestriction = true;
  if (has('heavy-alcohol')) flags.heavyAlcoholUse = true;
  if (has('recent-illness')) flags.acuteIllnessLast4Weeks = true;
  flags.fastingOptIn = access.fasting.optedTier ?? 'none';
  if (access.outcome.renal) Object.assign(flags, renalSafetyFlags(access.outcome.renal));
  return { mode: access.outcome.mode, flags };
}

/** PersonProfile for Simulator runs (body + habits from Your body, safety from screening). */
export function useSimulatorProfile(): PersonProfile {
  const bodyProfile = usePersonProfile();
  // E20: markers — entered blood results replace the population starting values (Body page labs stay the fallback)
  const markersDoc = useMarkersDoc();
  // D7-05: the marker rule context (diet and medication change dates), the same freshness the rules use
  const ruleCtx = useMarkerRuleContext(markersToday());
  const profile = useMemo(() => withMarkerLabs(bodyProfile, markersDoc, ruleCtx), [bodyProfile, markersDoc, ruleCtx]);
  const access = useSafetyAccess(useBodyContext());
  // keyed by value: an equal screening outcome keeps the same profile object (stable hashes, no re-runs)
  const safetyKey = JSON.stringify(engineSafety(access));
  const safety = useMemo(() => JSON.parse(safetyKey) as PersonProfile['safety'], [safetyKey]);
  return useMemo<PersonProfile>(() => ({ ...profile, safety }), [profile, safety]);
}
