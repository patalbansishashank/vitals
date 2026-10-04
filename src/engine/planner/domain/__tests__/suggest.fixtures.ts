/**
 * Goal-suggestion test inputs built from engine personas: the planner's 17 QA requests (five golden, autophagy first,
 * fat loss first, ten fuzzed) and the face-validity personas, with the body estimate and the fastest-safe reach the app
 * would gather for them.
 */
import { estimateBodyFat } from '../../../body/estimateBody';
import type { PersonProfile } from '../../../types/profile';
import { estimateTargets } from '../reach';
import { suggestionProbeGoals, trainingYears, type FastingTierOptIn, type GoalSuggestionInput, type SuggestIntake } from '../suggestGoals';
import type { PlannerRequest } from '../types';

export function probeRequest(profile: PersonProfile, horizonDays = 112): PlannerRequest {
  return {
    profile,
    goals: suggestionProbeGoals().map((g) =>
      g.mode === 'lose'
        ? { metric: g.metric, direction: 'target' as const, target: -g.amount, targetKind: 'change' as const }
        : { metric: g.metric, direction: 'maximise' as const, target: g.amount, targetKind: 'change' as const },
    ),
    horizonDays,
    seed: 1,
  };
}

const reachCache = new Map<PersonProfile, ReturnType<typeof estimateTargets>>();

export function inputFor(profile: PersonProfile, opts: { optedTier?: FastingTierOptIn | null; intake?: SuggestIntake; reach?: boolean } = {}): GoalSuggestionInput {
  const b = profile.body;
  const fusion = estimateBodyFat(b);
  const bf = fusion.bodyFatPct;
  const sd = fusion.sdPct;
  let reach = reachCache.get(profile);
  if (opts.reach !== false && !reach) {
    reach = estimateTargets(probeRequest(profile));
    reachCache.set(profile, reach);
  }
  return {
    profile: {
      complete: true,
      sex: b.sex === 'male' || b.sex === 'female' ? b.sex : null,
      ageYears: b.ageYears,
      heightCm: b.heightCm,
      weightKg: b.weightKg,
      ...(profile.habits ? { habits: profile.habits } : {}),
      ...(profile.labs ? { labs: profile.labs } : {}),
    },
    body: {
      bfPct: bf,
      bfBand: [bf - 1.2816 * sd, bf + 1.2816 * sd],
      leanKg: b.weightKg * (1 - bf / 100),
      trainingAgeY: trainingYears(profile.habits?.trainingHistory),
      ...(b.knownBodyFatPct !== undefined ? { measuredBodyFat: true } : {}),
    },
    intake: opts.intake ?? {},
    markers: [],
    devices: {},
    safety: { noWeightLossGoal: false, optedTier: opts.optedTier ?? null },
    reach: opts.reach === false ? [] : (reach ?? []),
  };
}
