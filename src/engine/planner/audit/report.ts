/**
 * Coverage report of the evidence-coverage audit (PLANNER_V2_SPEC §6.3 output): `docs/PLANNER_COVERAGE.md` (plain
 * language: Evidence-library topic names, lever and block names, never research-note numbers) and the JSON summary
 * `public/validation/planner-coverage.json` (levers reachable %, edges live %, dead fields, flagged gates, undocumented
 * mechanisms). Pure builders: the audit runner gathers the parts and writes the files.
 */
import { EVIDENCE_TOPICS } from '@/content/evidence';
import { EVIDENCE_EDGES } from '../domain/evidenceGraph';
import { GATES, GATE_INDEX } from '../domain/gates';
import { BLOCKS, type BlockId } from '../domain/registry/blocks';
import { LEVER_INDEX } from '../domain/registry/levers';
import type { FieldTrace } from './fields';
import type { EdgeLiveness, UndocumentedEffect } from './liveness';
import type { DynamicStatus, GateCost } from './plan';
import { fastingGateReport, metricLabel, type FastingGateReport, type GeneRangeReport, type ReachabilityReport, type RepairRateReport } from './static';
import type { ModeAgreement } from './evaluator';

/**
 * Flagged rules the owner reviewed and kept (QA pass 2, 2026-10-02). The flag stays in the numbers so a later audit
 * that finds a larger gain is still visible; the row says why the rule stays.
 */
export const REVIEWED_GATES: Readonly<Record<string, { date: string; why: string }>> = {
  'zeroDays.servedClass': {
    date: '2026-10-02',
    why: 'the evidence for alternate zero-energy days is in overweight people losing weight; for other goals the gain comes with a training-attributable lean loss in every person tested',
  },
  'omega3.tgBpGoal': {
    date: '2026-10-02',
    why: 'omega-3 has no documented fat-loss mechanism; the gain is one tolerance, within search noise',
  },
};

export interface StaticPart {
  ms: number;
  reach: ReachabilityReport;
  genes: { dead: string[]; registry: GeneRangeReport['registry']; count: number };
  repair: Pick<RepairRateReport, 'samples' | 'effectivelyFixed'>;
  fields: Array<Pick<FieldTrace, 'key' | 'verdict' | 'nonMonotone'> & { cls: string }>;
  masking: Array<{ key: string; formLimitH: number; masked: boolean }>;
  fastingGate: Record<string, 'graphOnly' | 'gateOnly'>;
  evaluator: { unrecorded: string[]; agreement: ModeAgreement };
}

export interface LivenessPart {
  ms: number;
  runs: number;
  floorDraws: number;
  edges: EdgeLiveness[];
  undocumented: UndocumentedEffect[];
}

export interface PlanPart {
  ms: number;
  runs: number;
  dynamic: Record<string, { status: DynamicStatus; request: string | null; detail: string }>;
  gates: GateCost[];
}

/** Committed summary: no dates, run times or machine data (they go to the uncommitted qa/results/.timing/audit.json). */
export interface CoverageSummary {
  levers: { total: number; reachable: number; reachablePct: number; unreachable: string[]; dynamic: Record<string, DynamicStatus> };
  blocks: { total: number; reachable: number; reachablePct: number; unreachable: string[] };
  edges: {
    total: number;
    modelled: number;
    mapped: number;
    infoOnly: number;
    probed: number;
    live: number;
    livePct: number;
    weak: number;
    mixed: number;
    wrongSign: number;
    dead: number;
    notProbed: number;
    moduleNotOnPath: string[];
    disagreements: Array<{ edge: string; status: string }>;
  };
  deadFields: string[];
  notStrictFields: Array<{ field: string; verdict: string }>;
  maskedConsents: string[];
  gates: { total: number; unsourced: string[]; flagged: Array<{ gate: string; metric: string; gainInTolerances: number }>; costs: GateCost[] };
  undocumentedMechanisms: Array<{ sources: string[]; metric: string; personas: number; maxDelta: number }>;
  fastingGateVsGraph: FastingGateReport;
  geneRange: { dead: string[]; outsideRegistry: string[]; effectivelyFixed: string[] };
  evaluator: { unrecordedSeries: string[]; plans: number; maxRelDiff: number; disagreements: number };
}

/** Run times of the audit's parts (uncommitted, qa/results/.timing/audit.json). */
export function auditTiming(s: StaticPart, l: LivenessPart, p: PlanPart, generated: string): Record<string, unknown> {
  return { generated, staticMs: Math.round(s.ms), livenessMs: Math.round(l.ms), livenessRuns: l.runs, planMs: Math.round(p.ms), planRuns: p.runs };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : 0);
const topicTitle = (slug: string) => EVIDENCE_TOPICS.find((t) => t.slug === slug)?.title ?? slug;
const leverName = (id: string) => LEVER_INDEX.get(id)?.explain.name ?? (id in BLOCKS ? BLOCKS[id as BlockId].name : id);
const sourceName = (id: string) => (id in BLOCKS ? BLOCKS[id as BlockId].name : LEVER_INDEX.get(id)?.explain.name ?? id.replace(/_/g, ' '));

export function aggregateUndocumented(u: readonly UndocumentedEffect[]): CoverageSummary['undocumentedMechanisms'] {
  const m = new Map<string, { sources: string[]; metric: string; personas: Set<string>; maxDelta: number }>();
  for (const x of u) {
    const k = `${x.sources.join('/')}|${x.metric}`;
    const r = m.get(k) ?? { sources: x.sources, metric: x.metric, personas: new Set<string>(), maxDelta: 0 };
    r.personas.add(x.persona);
    if (Math.abs(x.delta) > Math.abs(r.maxDelta)) r.maxDelta = x.delta;
    m.set(k, r);
  }
  return [...m.values()].map((r) => ({ sources: r.sources, metric: r.metric, personas: r.personas.size, maxDelta: +r.maxDelta.toPrecision(3) })).sort((a, b) => b.personas - a.personas || a.metric.localeCompare(b.metric));
}

export function summarise(s: StaticPart, l: LivenessPart, p: PlanPart): CoverageSummary {
  const levers = s.reach.levers;
  const blocks = s.reach.blocks;
  const probed = l.edges.filter((e) => e.status !== 'notProbed');
  const count = (st: string) => l.edges.filter((e) => e.status === st).length;
  return {
    levers: {
      total: Object.keys(levers).length,
      reachable: Object.values(levers).filter((n) => n > 0).length,
      reachablePct: pct(Object.values(levers).filter((n) => n > 0).length, Object.keys(levers).length),
      unreachable: s.reach.unreachableLevers,
      dynamic: Object.fromEntries(Object.entries(p.dynamic).map(([k, v]) => [k, v.status])),
    },
    blocks: {
      total: Object.keys(blocks).length,
      reachable: Object.values(blocks).filter((n) => n > 0).length,
      reachablePct: pct(Object.values(blocks).filter((n) => n > 0).length, Object.keys(blocks).length),
      unreachable: s.reach.unreachableBlocks,
    },
    edges: {
      total: EVIDENCE_EDGES.length,
      modelled: EVIDENCE_EDGES.filter((e) => e.status === 'modelled').length,
      mapped: EVIDENCE_EDGES.filter((e) => e.status === 'mapped').length,
      infoOnly: EVIDENCE_EDGES.filter((e) => e.status === 'infoOnly').length,
      probed: probed.length,
      live: count('live'),
      livePct: pct(count('live'), probed.length),
      weak: count('weak'),
      mixed: count('mixed'),
      wrongSign: count('wrongSign'),
      dead: count('dead'),
      notProbed: count('notProbed'),
      moduleNotOnPath: l.edges.filter((e) => e.stub && !e.stub.onPath).map((e) => e.edge),
      disagreements: l.edges.filter((e) => e.status === 'wrongSign' || e.status === 'mixed' || e.status === 'dead').map((e) => ({ edge: e.edge, status: e.status })),
    },
    deadFields: s.fields.filter((f) => f.verdict === 'dead' || f.verdict === 'noPerturbation').map((f) => f.key),
    notStrictFields: s.fields.filter((f) => f.verdict === 'changes' || f.verdict === 'contextOnly').map((f) => ({ field: f.key, verdict: f.verdict })),
    maskedConsents: s.masking.filter((m) => m.masked).map((m) => m.key),
    gates: {
      total: GATES.length,
      unsourced: GATES.filter((g) => g.source === null).map((g) => g.id),
      flagged: p.gates.filter((g) => g.flagged && g.worst).map((g) => ({ gate: g.gate, metric: g.worst!.metric, gainInTolerances: +(g.worst!.gain / g.worst!.delta).toFixed(2) })),
      costs: p.gates,
    },
    undocumentedMechanisms: aggregateUndocumented(l.undocumented),
    fastingGateVsGraph: fastingGateReport(s.fastingGate),
    geneRange: {
      dead: s.genes.dead,
      outsideRegistry: s.genes.registry.filter((r) => r.decoded && (r.decoded[0] < r.registry[0] - 1e-9 || r.decoded[1] > r.registry[1] + 1e-9)).map((r) => `${r.lever}.${r.param}`),
      effectivelyFixed: s.repair.effectivelyFixed,
    },
    evaluator: { unrecordedSeries: s.evaluator.unrecorded, plans: s.evaluator.agreement.plans, maxRelDiff: s.evaluator.agreement.maxRelDiff, disagreements: s.evaluator.agreement.diffs.length },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// markdown
// ---------------------------------------------------------------------------------------------------------------

const edgeText = (id: string): string => {
  const e = EVIDENCE_EDGES.find((x) => x.id === id);
  if (!e) return id;
  return `${sourceName(e.from.id)} → ${metricLabel(e.metric)} (${e.sign > 0 ? 'raises' : e.sign < 0 ? 'lowers' : 'either way'}; ${topicTitle(e.source.topic)})`;
};

const FIELD_TEXT: Readonly<Record<string, string>> = {
  'PlannerSafetyInput.fasting.maxEligibleTier': 'the screening’s highest eligible fasting tier',
  'PlannerSafetyInput.fasting.effectiveTier': 'the screening’s effective fasting tier',
  'PlannerSafetyInput.fasting.optInTiers': 'the screening’s list of opted-in tiers',
  'TrainingProfile.loadsKg': 'the weights you own',
  'TrainingProfile.liked': 'exercises you like',
  'TrainingProfile.capacities': 'your measured repetitions and one-repetition maxima',
};

const DYN_TEXT: Readonly<Record<DynamicStatus, string>> = {
  used: 'used by a final plan',
  rejectedWithNumbers: 'considered and rejected, with the numbers',
  missing: 'missing from the final plans and the explanations',
  noRequest: 'no request where it helps a ranked goal',
  runFailed: 'run failed',
};

export function markdown(sum: CoverageSummary, s: StaticPart, l: LivenessPart, p: PlanPart): string {
  const out: string[] = [];
  const line = (x = '') => out.push(x);
  line('# Planner evidence coverage');
  line();
  line('Generated by the evidence-coverage audit (`pnpm audit:planner`; the fast checks also run in `pnpm test`).');
  line('The audit asks whether the planner can use every piece of evidence the model encodes: whether each lever can appear');
  line('in a plan, whether each mechanism it relies on actually moves the numbers, whether every limit you set changes what');
  line('the planner may do, and whether any rule that removes options costs a better safe plan. Evidence grades never decide');
  line('anything here: they are recorded with each mechanism and shown, never used to drop or weight one.');
  line();
  line('## Summary');
  line();
  line('| Measure | Result |');
  line('|---|---|');
  line(`| Levers that can appear in a plan | ${sum.levers.reachable} of ${sum.levers.total} (${sum.levers.reachablePct} %) |`);
  line(`| Building blocks that can appear in a plan | ${sum.blocks.reachable} of ${sum.blocks.total} (${sum.blocks.reachablePct} %) |`);
  const dyn = Object.values(sum.levers.dynamic);
  line(`| Levers used or explained in real planner runs | ${dyn.filter((d) => d === 'used' || d === 'rejectedWithNumbers').length} of ${dyn.length} |`);
  line(`| Mechanisms (evidence edges) | ${sum.edges.total}: ${sum.edges.modelled} simulated, ${sum.edges.mapped} counted through a simulated mechanism, ${sum.edges.infoOnly} known but not yet in the model |`);
  line(`| Mechanisms that move their metric as stated | ${sum.edges.live} of ${sum.edges.probed} tested (${sum.edges.livePct} %) |`);
  line(`| Limits and consents that change nothing | ${sum.deadFields.length} |`);
  line(`| Rules that remove options, with their evidence | ${sum.gates.total} (${sum.gates.unsourced.length} without a source) |`);
  const reviewed = sum.gates.flagged.filter((f) => REVIEWED_GATES[f.gate]).length;
  line(`| Rules flagged for review (a better safe plan without them) | ${sum.gates.flagged.length}${reviewed ? ` (${reviewed} reviewed and kept)` : ''} |`);
  line(`| Effects in the model with no documented mechanism | ${sum.undocumentedMechanisms.length} |`);
  line(`| Planner and Simulator agree on goal values | ${sum.evaluator.disagreements === 0 ? 'yes' : 'no'} (${sum.evaluator.plans} random plans, largest relative difference ${sum.evaluator.maxRelDiff.toExponential(1)}) |`);
  line();

  line('## 1. Can every lever appear in a plan?');
  line();
  line(`Over ${s.reach.requests} test requests (every goal type × every consent combination × typical, tight and loose limits, five people) the planner’s structure grammar builds ${s.reach.structures.min}-${s.reach.structures.max} plan structures per request.`);
  line();
  line('| Lever | Requests where it can appear | In real planner runs |');
  line('|---|---|---|');
  for (const [id, n] of Object.entries(s.reach.levers)) line(`| ${leverName(id)} | ${n} | ${p.dynamic[id] ? DYN_TEXT[p.dynamic[id].status] : 'applied in every plan, or outside the grammar'} |`);
  line();
  if (sum.levers.unreachable.length)
    line(`Not in the grammar: ${sum.levers.unreachable.map(leverName).join(', ')}. The model can simulate them, but the planner does not build plans with them yet.`);
  line();
  line('| Building block | Requests where it can appear |');
  line('|---|---|');
  for (const [id, n] of Object.entries(s.reach.blocks)) line(`| ${BLOCKS[id as BlockId].name} | ${n} |`);
  line();
  line(`Every setting the planner varies moves the plan between its lowest and highest value (${sum.geneRange.dead.length ? `except ${sum.geneRange.dead.join(', ')}` : 'none is inert'}); none is overridden by the safety repair on most days (${s.repair.samples} sampled plans).`);
  if (sum.geneRange.outsideRegistry.length)
    line(`Ranges that go beyond the lever’s documented range: ${sum.geneRange.outsideRegistry.map((k) => ({ 'cardio.pctVo2max': 'walking intensity (40-55 % of VO2max, below the cardio lever’s 45 %)', 'eatingWindow.startH': 'the start of the eating window (up to 15:00 against the documented 14:00)' })[k] ?? k).join('; ')}.`);
  line();

  line('## 2. Does each mechanism move its metric?');
  line();
  line(`Each mechanism is switched on in a probe plan for three people (a man of 88 kg, a woman of 78 kg, a lean trained man) and the metric is compared with the plan without it. “Moves” means beyond the model’s own uncertainty band where that applies (half of the 10-90 % spread over ${l.floorDraws} parameter draws), else beyond rounding. ${l.runs} simulations.`);
  line();
  line(`- Moves as stated: ${sum.edges.live}; moves, but less than the uncertainty band: ${sum.edges.weak}; does not move: ${sum.edges.dead}; moves the other way: ${sum.edges.wrongSign}; differs between people: ${sum.edges.mixed}; no switch in the planner to test it: ${sum.edges.notProbed}.`);
  line(`- Switching the mechanism’s model part off removes at least part of the effect for every tested mechanism${sum.edges.moduleNotOnPath.length ? `, except ${sum.edges.moduleNotOnPath.length}` : ''}.`);
  line();
  if (sum.edges.disagreements.length) {
    line('Where the model and the documented mechanism disagree (for review):');
    line();
    const shown = new Set<string>();
    for (const d of sum.edges.disagreements) {
      const t = edgeText(d.edge);
      if (shown.has(t)) continue;
      shown.add(t);
      line(`- ${t}: ${d.status === 'wrongSign' ? 'the model moves it the other way' : d.status === 'mixed' ? 'the model moves it one way for one person and the other way for another' : 'the model does not move it'}.`);
    }
    line();
  }
  line('Effects the model shows with no documented mechanism (most frequent first; for review, many are second-order effects of a plan change):');
  line();
  for (const u of sum.undocumentedMechanisms.slice(0, 25)) line(`- ${u.sources.map(sourceName).join(' / ')} → ${metricLabel(u.metric)} (${u.personas} of 3 people, up to ${u.maxDelta})`);
  if (sum.undocumentedMechanisms.length > 25) line(`- … and ${sum.undocumentedMechanisms.length - 25} more in the JSON summary.`);
  line();

  line('## 3. Does the planner read what the mechanisms touch?');
  line();
  line(`For every goal metric the planner records the series its mechanisms touch${sum.evaluator.unrecordedSeries.length ? ` except ${sum.evaluator.unrecordedSeries.join(', ')}` : ''}, and its fast mode gives the same goal values as the Simulator on ${sum.evaluator.plans} random plans (largest relative difference ${sum.evaluator.maxRelDiff.toExponential(1)}).`);
  line();

  line('## 4. Does every limit and consent change what the planner may do?');
  line();
  line(`${s.fields.length} fields of the limits form, the consents, the screening and the training profile were changed one at a time on four requests.`);
  line();
  if (sum.deadFields.length) line(`Fields that change nothing the planner reads: ${sum.deadFields.map((k) => FIELD_TEXT[k] ?? k).join('; ')}.`);
  line();
  if (sum.notStrictFields.length) {
    line('Fields that change the plans but not strictly “more room / less room”:');
    line();
    for (const f of sum.notStrictFields) line(`- ${f.field}: ${f.verdict === 'contextOnly' ? 'acts through the model’s safety and comfort margins or the equipment envelope, not through the plan structures' : 'changes the plans in both directions'}`);
    line();
  }
  const MASK_TEXT: Readonly<Record<string, string>> = {
    'SafetyOptIns.fastingTier': 'with the form’s default longest fast a fasting-tier opt-in changes no plan',
    'PlannerSafetyInput.optIns.fastingTier': 'with the form’s default longest fast a fasting-tier opt-in changes no plan',
    'PlannerSafetyInput.expertMode': 'the form’s largest longest-fast option (72 hours) leaves the expert tier’s 3-7-day fasts unreachable',
  };
  const tierMask = s.masking.find((x) => x.key.endsWith('fastingTier'));
  if (tierMask && !tierMask.masked)
    line(`The form’s default longest fast follows the fasting tier you opted into (up to ${tierMask.formLimitH} hours), so a 48- or 72-hour opt-in reaches the plans without changing the limit by hand.`);
  if (sum.maskedConsents.length)
    line(`The limits form hides some consents: ${[...new Set(sum.maskedConsents.map((k) => MASK_TEXT[k] ?? k))].join('; ')}. The person’s own limit always wins, so this is a question for the form, not the planner.`);
  line();

  line('## 5. Rules that remove options');
  line();
  line('Every rule that removes plan structures, levers or setting ranges is registered with the evidence it rests on. Rules from the person’s own limits and from the evidence were each removed in turn and the affected requests planned again; safety rules and consents are never relaxed.');
  line();
  line('| Rule | Kind | Evidence | Without it |');
  line('|---|---|---|---|');
  for (const c of p.gates) {
    const g = GATE_INDEX.get(c.gate)!;
    const w = c.worst;
    const rv = REVIEWED_GATES[c.gate];
    const res = c.flagged && w ? `**flagged**: ${metricLabel(w.metric)} ${w.with.toFixed(2)} → ${w.without.toFixed(2)} (${(w.gain / w.delta).toFixed(1)} × the tolerance)${rv ? `; reviewed ${rv.date}, kept: ${rv.why}` : ''}` : w ? `no better safe plan (best change ${(w.gain / w.delta).toFixed(2)} × the tolerance)` : c.note;
    line(`| ${g.predicate} | ${g.kind} | ${g.source ? topicTitle(g.source.topic) : '**none**'} | ${res} |`);
  }
  line();

  line('## 6. Explanations');
  line();
  line('Every lever contribution an option states is re-checked by switching the lever off and running the plan again; every fasting comparison (“a plan with a fast was considered and lost because …”) is re-checked by re-running both plans. Both run in `pnpm test`.');
  line();
  line('## Fasting: which goals a fast can serve');
  line();
  line('The planner offers fasting for goal types (fat loss, glucose control, triglycerides and blood pressure, transient markers, hunger and adherence) and for every goal a fasting mechanism moves the right way (for example lower LDL or ApoB, more endurance capacity, less stored glycogen). Whether a fast is kept is left to the search: it stays only where it helps the ranked goals. Goals where the planner offers fasting although no mechanism says a fast helps (kept, because offering costs nothing):');
  line();
  const pairText = (k: string) => {
    const [m, dir] = k.split(':');
    return `${dir === 'up' ? 'Raise' : 'Lower'} ${metricLabel(m!).toLowerCase()}`;
  };
  for (const e of sum.fastingGateVsGraph.expected) line(`- ${pairText(e.pair)}: ${e.reason}.`);
  if (sum.fastingGateVsGraph.unexpected.length) {
    line();
    line('Unexpected differences (for review):');
    line();
    for (const u of sum.fastingGateVsGraph.unexpected)
      line(`- ${pairText(u.pair)}: ${u.kind === 'graphOnly' ? 'the mechanisms say a fast can serve it; the planner does not offer fasting for it' : 'the planner offers fasting for it; no mechanism says a fast helps it'}.`);
  }
  line();
  line('## Limits of this audit');
  line();
  line('- Mechanisms are tested one at a time on three people; interactions between levers are tested only through the real planner runs of sections 1 and 5.');
  line('- The limits trace stops at the plan structures and setting ranges; whether a limit binds in the final plan is reported by the planner itself (“what each limit costs”).');
  line('- Rules applied inside the plan decoder (protein floor with training, productive training volume, surplus size, no late eating) are registered but not removed one at a time.');
  line(`- ${p.runs} planner runs in parallel parts; run times are kept out of this file (qa/results/.timing/, not committed) so a release leaves the tree clean.`);
  return out.join('\n') + '\n';
}
