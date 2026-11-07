/**
 * The food commands' side of the shared suggestion policy (D7-03; provider `@/lib/safetyPolicy`). The current safety
 * state is built from the same sources as the `supplements.*` commands and the planner: the stored screening (tri-state,
 * `suggestionSafetyNow`), the current blood-marker evaluation (flags and noSuggest with rule, sample date and
 * applicability) and the food allergies of answered food rules; the person's refusals and clinician stops join it through
 * `supplementSuggestionPolicy`. A source that cannot be read stays unknown (`unchecked`), never a negative screen.
 */
import { toSectionV2 } from '@/catalogues/supplements';
import { supplementSuggestionPolicy } from '@/catalogues/supplements/planner';
import type { SupplementRecord } from '@/catalogues/types';
import { SEED_SUPPLEMENTS } from '@/content/catalogues/supplements'; // not the index: it builds the whole seed catalogue
import { suggestionDecision, type MarkerNoSuggestInput, type SuggestionSafetyInput } from '@/lib/safetyPolicy';
import { evaluateMarkers } from '@/markers/rules';
import { suggestionSafetyFrom, suggestionSafetyNow } from '@/state/internal/safety';
import { readMarkers, ruleContext } from '../markers/view';
import type { CommandContext } from '../types';
import type { SupplementPolicy } from './extras';

interface IntakeLike {
  diet?: { rulesComplete?: boolean; allergies?: string[] };
  supplements?: unknown;
}

/** The shared suggestion-policy input now (D7-03), from the same sources as every other suggestion surface. */
export async function currentSuggestionSafety(ctx: CommandContext, intake?: IntakeLike | null): Promise<SuggestionSafetyInput> {
  let markers: { flags: readonly string[]; noSuggest: readonly MarkerNoSuggestInput[] } | null = null;
  try {
    const ev = evaluateMarkers(await readMarkers(ctx), ruleContext(ctx));
    markers = { flags: ev.safety.flags, noSuggest: ev.noSuggest ?? [] };
  } catch {
    /* markers or profile not readable: no marker decisions (screened predicates still apply) */
  }
  const diet = intake?.diet ?? null;
  try {
    return suggestionSafetyNow(markers, { diet });
  } catch {
    return suggestionSafetyFrom(null, { markers, diet });
  }
}

/**
 * The shared evaluator as the supplements line's policy: one decision per catalogue item for this person (screening,
 * markers, allergies, refusals and clinician stops of the supplements section).
 */
export async function foodSupplementPolicy(ctx: CommandContext): Promise<SupplementPolicy> {
  const intake = await ctx.docs.get<IntakeLike>('intake', 'me');
  const safety = await currentSuggestionSafety(ctx, intake);
  const section = toSectionV2(intake?.supplements);
  const byId = new Map(supplementSuggestionPolicy(section, SEED_SUPPLEMENTS, safety).decisions.map((d) => [d.subject, d] as const));
  return (r: SupplementRecord) => byId.get(r.id) ?? suggestionDecision(r, safety);
}
