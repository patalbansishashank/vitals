/**
 * Gate registry (PLANNER_V2_SPEC §6.2; R6 §7.2 item 5): every condition that removes structures, levers or gene range
 * from the planner's search is registered here with the evidence it rests on and its kind. The grammar asks
 * `gateOn(ctx, id)` at each site, so the coverage audit can remove one gate at a time and re-plan (§6.3 check 5: does a
 * safe plan get better for a ranked goal without the gate?). A gate without a source fails the audit.
 *
 * Kinds: `safety` (17 caps, screening, tiers: never relaxed), `consent` (opt-ins: never relaxed), `userLimit` (the
 * person's own limits), `evidence` (the research says the removed option cannot help or is not indicated), `feasibility`
 * (the option cannot be built: no Schedule channel, does not fit the horizon). Safety and consent gates can be switched
 * off only inside `withGatesDisabled(..., { audit: true })`; anywhere else `gateOn` keeps them on whatever the context says.
 *
 * `source` is user-facing (Evidence library topic, item 5); `maintainerRef` is for code and docs only.
 */
import type { EvidenceTopicSlug } from '@/content/evidence/schema';

export type GateKind = 'safety' | 'consent' | 'userLimit' | 'evidence' | 'feasibility';

export interface GateDef {
  /** 'fasting.servedGoal', 'surplus.noFasts', 'refeed.deficitOnly', … */
  id: string;
  /** File and function. */
  where: string;
  removes: 'structures' | 'levers' | 'geneRange';
  /** Plain description of what the gate keeps out. */
  predicate: string;
  /** Null fails the audit. */
  source: { topic: string; refs: readonly string[] } | null;
  maintainerRef: string;
  kind: GateKind;
}

const src = (topic: EvidenceTopicSlug): { topic: string; refs: readonly string[] } => ({ topic, refs: [] });
const SK = 'domain/skeleton.ts';
const CX = 'domain/context.ts';

export const GATES: readonly GateDef[] = [
  // ------------------------------------------------------------------ fasting gate (context.ts fastingGate, §3.1)
  {
    id: 'fasting.longestFast',
    where: `${CX} fastingGate`,
    removes: 'structures',
    predicate: 'Fasting structures need an effective longest fast of at least 24 hours (fasting tier, screening limits and the person’s own longest fast).',
    source: src('safety-limits'),
    maintainerRef: '17 HC-F1, §4.3.2; PLANNER_V2_SPEC §3.1 (effective maxFastH ≥ 24)',
    kind: 'safety',
  },
  {
    id: 'fasting.refused',
    where: `${CX} fastingGate`,
    removes: 'structures',
    predicate: 'No fasting structures when the person ruled out fasting.',
    source: src('fasting-meal-timing'),
    maintainerRef: '18 §3 fasting refusal; PLANNER_V2_SPEC §3.1',
    kind: 'userLimit',
  },
  {
    id: 'fasting.servedGoal',
    where: `${CX} fastingGate`,
    removes: 'structures',
    predicate:
      'Fasting structures only when a ranked goal is one a fast can serve (transient markers, fat loss, glucose control, triglycerides and blood pressure, hunger and adherence, or any goal a fasting mechanism moves the right way, such as lower LDL or more endurance) or the person prefers fasting.',
    source: src('extended-water-fasting'),
    maintainerRef: '20 §4C; ruling R-FAST-GATE; owner ruling 2026-10-01 (graph-credited goals); PLANNER_V2_SPEC §3.1 (FASTING_SERVED ∪ servesFasting)',
    kind: 'evidence',
  },
  {
    id: 'fasting.muscleAbove',
    where: `${CX} fastingGate`,
    removes: 'structures',
    predicate: 'No fasting structures when a muscle goal ranks above the goal fasting would serve (long gaps without protein slow muscle gain).',
    source: src('extended-water-fasting'),
    maintainerRef: '20 §4C (lean cost of fasts); 03 §4.4; PLANNER_V2_SPEC §3.1',
    kind: 'evidence',
  },
  // ------------------------------------------------------------------ resolved limits (context.ts resolvePractical)
  {
    id: 'rt.noviceCap',
    where: `${CX} resolvePractical`,
    removes: 'geneRange',
    predicate: 'People new to resistance training are planned at most 3 sessions a week.',
    source: src('safety-limits'),
    maintainerRef: '17 HC-X2 (PROPOSED)',
    kind: 'safety',
  },
  // ------------------------------------------------------------------ grammar (skeleton.ts enumerateStructures and helpers)
  {
    id: 'user.excluded',
    where: `${SK} blockUsable / leverUsable / eventFeasible / enumerateStructures`,
    removes: 'levers',
    predicate: 'Levers and blocks the person refused are never used.',
    source: src('other-levers'),
    maintainerRef: '18 §3 (excludedLevers)',
    kind: 'userLimit',
  },
  {
    id: 'block.tier',
    where: `${SK} blockUsable`,
    removes: 'structures',
    predicate: 'Blocks whose tier is “never” or expert-only for this person (screening, BMI, body fat, fasting tier, age) are not used.',
    source: src('safety-limits'),
    maintainerRef: '17 §4.2-4.3; 13 §4C tiers',
    kind: 'safety',
  },
  {
    id: 'lever.noEngineChannel',
    where: `${SK} leverUsable`,
    removes: 'levers',
    predicate: 'Levers the model has no input for are listed as advice, never planned.',
    source: src('other-levers'),
    maintainerRef: 'MODEL_SPEC §11.1 (extra inputs X1-X19 deferred); 21 §4J',
    kind: 'feasibility',
  },
  {
    id: 'lever.tier',
    where: `${SK} leverUsable`,
    removes: 'levers',
    predicate: 'Levers whose tier is “never” for this person (screening flags, fasting tier) are not used.',
    source: src('safety-limits'),
    maintainerRef: '17 §4.2-4.3; 18 §4.4.1 SafetyTier',
    kind: 'safety',
  },
  {
    id: 'lever.expertOnlyFasts',
    where: `${SK} leverUsable`,
    removes: 'levers',
    predicate: 'The expert tier is used only for supervised multi-day fasts.',
    source: src('safety-limits'),
    maintainerRef: '17 §4.3.2; ruling 2026-09-30 18:10',
    kind: 'safety',
  },
  {
    id: 'lever.optInConsent',
    where: `${SK} leverUsable`,
    removes: 'levers',
    predicate: 'Opt-in levers (omega-3, a high caffeine dose) need the person’s opt-in.',
    source: src('safety-limits'),
    maintainerRef: '18 §4.4.1 optIn tier; 21 §4J L6/L8',
    kind: 'consent',
  },
  {
    id: 'block.energyEnvelope',
    where: `${SK} phaseFeasible`,
    removes: 'structures',
    predicate: 'A phase is used only when its energy range survives the deficit cap, the intake floor and the surplus limits.',
    source: src('safety-limits'),
    maintainerRef: '17 HC-E1/E3/E8; 11 §9',
    kind: 'safety',
  },
  {
    id: 'B11.weeklyFloor',
    where: `${SK} phaseFeasible`,
    removes: 'structures',
    predicate: 'Two low-energy days a week are used only when the week can still meet the intake floor and the deficit cap.',
    source: src('safety-limits'),
    maintainerRef: '17 HC-E1/E2/E3; 13 §4C B11',
    kind: 'safety',
  },
  {
    id: 'B12.intakeFloor28',
    where: `${SK} phaseFeasible`,
    removes: 'structures',
    predicate: 'Zero-energy days are used only when the eating days can bring the 28-day mean to the intake floor.',
    source: src('safety-limits'),
    maintainerRef: 'ruling 2026-09-30 18:10; 17 HC-E1, HC-E8',
    kind: 'safety',
  },
  {
    id: 'block.minRtSessions',
    where: `${SK} phaseFeasible`,
    removes: 'structures',
    predicate: 'The aggressive short deficit (3 sessions) and the lean-gain surplus (2 sessions) need enough training days a week.',
    source: src('resistance-training'),
    maintainerRef: '13 §4C B3 (≥ 3 RT sessions); 09 §4.8 (B23 ≥ 2)',
    kind: 'evidence',
  },
  {
    id: 'segments.durationFit',
    where: `${SK} segmentSequenceOk`,
    removes: 'structures',
    predicate: 'A phase sequence is used only when the phases’ minimum and maximum durations fit the horizon.',
    source: src('transitions-periodisation'),
    maintainerRef: '13 §4C durations; 18 §4.9 (≥ 2 weeks)',
    kind: 'feasibility',
  },
  {
    id: 'sequence.noRepeat',
    where: `${SK} segmentSequenceOk`,
    removes: 'structures',
    predicate: 'The same phase twice in a row is planned as one phase.',
    source: src('transitions-periodisation'),
    maintainerRef: '13 §4C rule 2 (B2 alternation), canonical structures',
    kind: 'feasibility',
  },
  {
    id: 'B3.notAlone',
    where: `${SK} enumerateStructures`,
    removes: 'structures',
    predicate: 'The aggressive 2-4-week deficit is always followed by maintenance, never used as the whole plan.',
    source: src('transitions-periodisation'),
    maintainerRef: '13 §4C B3 (2-4 weeks, ≥ 4 weeks maintenance before repeating)',
    kind: 'evidence',
  },
  {
    id: 'zeroDays.servedClass',
    where: `${SK} enumerateStructures`,
    removes: 'structures',
    predicate: 'Alternate zero-energy days only when the goal fasting serves is fat loss or a transient marker.',
    source: src('extended-water-fasting'),
    maintainerRef: '20 §4C (overweight users with a weight-loss goal); 13 §4C B12; PLANNER_V2_SPEC §3.1',
    kind: 'evidence',
  },
  {
    id: 'creatine.muscleGoal',
    where: `${SK} enumerateStructures`,
    removes: 'levers',
    predicate: 'Creatine only with a muscle goal.',
    source: src('other-levers'),
    maintainerRef: '21 §4J L7; 15 §4.8',
    kind: 'evidence',
  },
  {
    id: 'creatine.withTraining',
    where: `${SK} enumerateStructures`,
    removes: 'levers',
    predicate: 'Creatine only when resistance training can be planned.',
    source: src('other-levers'),
    maintainerRef: '21 §4J L7 (requires resistanceTraining)',
    kind: 'evidence',
  },
  {
    id: 'omega3.tgBpGoal',
    where: `${SK} enumerateStructures`,
    removes: 'levers',
    predicate: 'Omega-3 only with a triglyceride or blood-pressure goal.',
    source: src('other-levers'),
    maintainerRef: '21 §4J L8; 06 §4.5, §4.8',
    kind: 'evidence',
  },
  {
    id: 'viscousFibre.lipidGoal',
    where: `${SK} enumerateStructures`,
    removes: 'levers',
    predicate: 'Viscous fibre only with an LDL or ApoB goal.',
    source: src('other-levers'),
    maintainerRef: '21 §4J L9; 06 §4.4',
    kind: 'evidence',
  },
  {
    id: 'sleepExtension.shortSleep',
    where: `${SK} enumerateStructures`,
    removes: 'levers',
    predicate: 'Sleep extension only when habitual sleep is under 7 hours.',
    source: src('sleep-sex-age'),
    maintainerRef: '21 §4J L5; 16 §4.1.1-4.1.11',
    kind: 'evidence',
  },
  {
    id: 'sleep.fixed',
    where: `${SK} enumerateStructures`,
    removes: 'levers',
    predicate: 'No sleep changes when the person keeps sleep as it is.',
    source: src('sleep-sex-age'),
    maintainerRef: '18 §3 (sleepFixed)',
    kind: 'userLimit',
  },
  {
    id: 'refeed.deficitOnly',
    where: `${SK} enumerateStructures (OVERLAY_HOSTS)`,
    removes: 'structures',
    predicate: 'Refeed days only inside a deficit phase.',
    source: src('transitions-periodisation'),
    maintainerRef: '13 §4C B9 (allowedInBlocks B1, B3, B6)',
    kind: 'evidence',
  },
  {
    id: 'refeed.notInVeryLowCarb',
    where: `${SK} enumerateStructures`,
    removes: 'structures',
    predicate: 'No refeed days in a very-low-carbohydrate phase (a refeed breaks ketosis for 2-5 days).',
    source: src('transitions-periodisation'),
    maintainerRef: '13 §4C B9',
    kind: 'evidence',
  },
  {
    id: 'fast24.hosts',
    where: `${SK} enumerateStructures (OVERLAY_HOSTS)`,
    removes: 'structures',
    predicate: 'The weekly 24-hour fast sits in maintenance, deficit, very-low-carbohydrate and very-low-fat phases, never in a surplus.',
    source: src('extended-water-fasting'),
    maintainerRef: '20 §4C; ruling R-FAST-GATE; PLANNER_V2_SPEC §3.1',
    kind: 'evidence',
  },
  {
    id: 'surplus.noFasts',
    where: `${SK} enumerateStructures`,
    removes: 'structures',
    predicate: 'No multi-day fast in a plan with a surplus phase (the fast costs the lean tissue the surplus is for).',
    source: src('extended-water-fasting'),
    maintainerRef: '20 §4C (never for muscle-gain phases)',
    kind: 'evidence',
  },
  {
    id: 'zeroDays.noMultiDayFast',
    where: `${SK} enumerateStructures`,
    removes: 'structures',
    predicate: 'No multi-day fast in a plan with zero-energy days (the required eating gap between fasts does not fit).',
    source: src('safety-limits'),
    maintainerRef: '17 HC-F2',
    kind: 'safety',
  },
  {
    id: 'lowDays.noMultiDayFast',
    where: `${SK} enumerateStructures`,
    removes: 'structures',
    predicate: 'No multi-day fast in a plan made only of two-low-day phases (the fast and its recovery days do not fit between low days).',
    source: src('transitions-periodisation'),
    maintainerRef: '13 §4C B11; 17 HC-F3',
    kind: 'feasibility',
  },
  {
    id: 'fast.intakeFloor28',
    where: `${SK} eventFeasible`,
    removes: 'structures',
    predicate: 'A multi-day fast only when the 28 days around it can still meet the intake floor.',
    source: src('safety-limits'),
    maintainerRef: 'ruling 2026-09-30 18:10; 17 HC-E1',
    kind: 'safety',
  },
  {
    id: 'fast.horizonFits',
    where: `${SK} eventFeasible`,
    removes: 'structures',
    predicate: 'A multi-day fast only when the horizon holds the fast, its recovery days and a week.',
    source: src('extended-water-fasting'),
    maintainerRef: '17 HC-F3; 13 §4C rule 4',
    kind: 'feasibility',
  },
  // ------------------------------------------------------------------ gene-range rules of the decoder (registered; not switchable)
  {
    id: 'protein.trainingFloor',
    where: 'domain/skeleton.ts proteinRange (decoder clamp)',
    removes: 'geneRange',
    predicate: 'With resistance training and a muscle, fat-loss, deficit or surplus phase, protein is planned at 1.6 g/kg or more.',
    source: src('protein-muscle'),
    maintainerRef: '09 §4.8, §9; 08 §4.15',
    kind: 'evidence',
  },
  {
    id: 'rt.productiveRange',
    where: 'domain/skeleton.ts rtPrescription (decoder clamp)',
    removes: 'geneRange',
    predicate: 'Training volume stays in the productive range for the ranked goals (muscle: at least 2 sessions and 8-10 hard sets per muscle a week).',
    source: src('resistance-training'),
    maintainerRef: '09 §4.2, §4.3, §4.8, §4.14; QA item 9',
    kind: 'evidence',
  },
  {
    id: 'surplus.maxKcal',
    where: 'domain/skeleton.ts energyRange (decoder clamp)',
    removes: 'geneRange',
    predicate: 'A planned surplus is at most about 500 kcal a day (larger surpluses add mostly fat).',
    source: src('energy-surplus'),
    maintainerRef: '11 §9',
    kind: 'evidence',
  },
  {
    id: 'eatingWindow.lateEating',
    where: `${CX} resolvePractical / decode.ts decodeCore`,
    removes: 'geneRange',
    predicate: 'The last meal is at least 3 hours before bed.',
    source: src('other-levers'),
    maintainerRef: '21 §4J L19; 07 §4.7',
    kind: 'evidence',
  },
];

export const GATE_INDEX: ReadonlyMap<string, GateDef> = new Map(GATES.map((g) => [g.id, g]));

/**
 * Gates with a `gateOn` site in the grammar or the request compiler (the others are decoder clamps, registered for the
 * record; the gate-cost audit reports them as not switchable).
 */
export const SWITCHABLE_GATES: ReadonlySet<string> = new Set(
  GATES.filter((g) => !g.where.includes('decoder clamp') && g.id !== 'eatingWindow.lateEating').map((g) => g.id),
);

// ---------------------------------------------------------------------------------------------------------------
// switching gates off (audit only)
// ---------------------------------------------------------------------------------------------------------------

let auditDisabled: ReadonlySet<string> | null = null;
let auditMode = false;

/** The disabled set `compileRequest` copies into a new context (null outside `withGatesDisabled`). */
export function compileDisabledGates(): ReadonlySet<string> | undefined {
  return auditDisabled ?? undefined;
}

/**
 * Run `fn` with the listed gates switched off for every context compiled inside it (the audit's gate-cost check, §6.3
 * check 5). Safety and consent gates switch off only with `audit: true`. Not re-entrant; one planner run at a time.
 */
export async function withGatesDisabled<T>(ids: Iterable<string>, fn: () => T | Promise<T>, opts: { audit?: boolean } = {}): Promise<T> {
  const set = new Set(ids);
  for (const id of set) if (!GATE_INDEX.has(id)) throw new Error(`unregistered gate "${id}"`);
  const prev = auditDisabled;
  const prevMode = auditMode;
  auditDisabled = set;
  auditMode = !!opts.audit;
  try {
    return await fn();
  } finally {
    auditDisabled = prev;
    auditMode = prevMode;
  }
}

/** Synchronous variant (enumeration-level checks). */
export function withGatesDisabledSync<T>(ids: Iterable<string>, fn: () => T, opts: { audit?: boolean } = {}): T {
  const set = new Set(ids);
  for (const id of set) if (!GATE_INDEX.has(id)) throw new Error(`unregistered gate "${id}"`);
  const prev = auditDisabled;
  const prevMode = auditMode;
  auditDisabled = set;
  auditMode = !!opts.audit;
  try {
    return fn();
  } finally {
    auditDisabled = prev;
    auditMode = prevMode;
  }
}

/**
 * Is gate `id` in force for this context? True unless the context's disabled set names it — and a safety or consent gate
 * stays on outside the audit whatever the context says.
 */
export function gateOn(ctx: { readonly disabledGates?: ReadonlySet<string> } | undefined, id: string): boolean {
  const d = ctx?.disabledGates;
  if (!d || d.size === 0 || !d.has(id)) return true;
  const g = GATE_INDEX.get(id);
  if (!g) throw new Error(`unregistered gate "${id}"`);
  if ((g.kind === 'safety' || g.kind === 'consent') && !auditMode) return true;
  return false;
}
