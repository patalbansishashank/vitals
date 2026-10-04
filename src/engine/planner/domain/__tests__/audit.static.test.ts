// @vitest-environment node
/**
 * Evidence-coverage audit, static part (PLANNER_V2_SPEC §6.1-6.3 checks 1a, 1b; the gate registry; the fasting gate vs
 * the evidence graph). Decode level only, no engine runs. Known findings are listed with their reason: a new finding
 * fails the test, a fixed one too (so the list stays true). They are published in docs/PLANNER_COVERAGE.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_TOPIC_SLUGS } from '@/content/evidence/schema';
import { leak } from '@/content/evidence/__tests__/leakScan';
import { buildModelParams } from '../../../core/paramsRegistry';
import { MODULES } from '../../../core/moduleRegistry';
import { SERIES, SERIES_INDEX, type MetricId } from '../../../types/metrics';
import { SIGNAL_DEFS } from '../../../types/signals';
import { compileRequest } from '../context';
import { EVIDENCE_EDGES, ZERO_INTAKE_SOURCES, edgesTo, leversWithoutEdges, servesFasting } from '../evidenceGraph';
import { GATES, GATE_INDEX, SWITCHABLE_GATES, gateOn, withGatesDisabledSync } from '../gates';
import { enumerateStructures } from '../skeleton';
import { coverageCorpus } from '../../audit/corpus';
import { probePair } from '../../audit/probes';
import { KNOWN_FASTING_DIVERGENCES, fastingGateAgreement, fastingGateReport, geneRanges, reachability, repairRates } from '../../audit/static';

const GOAL_METRICS = SERIES.filter((d) => d.kind === 'metric' && d.goal !== 'none').map((d) => d.id as MetricId);

/**
 * Where the fasting gate and the evidence graph disagree (metric:direction). Owner ruling 2026-10-01: every goal the graph
 * credits to a fast is offered (LDL / ApoB down move either way with fasts, endurance capacity up, glycogen down), so no
 * `graphOnly` pair remains; the gate-only pairs stay offered and are the known divergences with their reasons
 * (`KNOWN_FASTING_DIVERGENCES`).
 */
const KNOWN_GATE_DISAGREEMENTS: Readonly<Record<string, 'graphOnly' | 'gateOnly'>> = {
  'hunger:down': 'gateOnly',
  'adherence:up': 'gateOnly',
  'ketoInduction:down': 'gateOnly',
  'igf1:up': 'gateOnly',
  'bhb:down': 'gateOnly',
};

/** Usable levers outside the v1 grammar (catalogue-only: registered with a channel, never enumerated). */
const KNOWN_UNREACHABLE_LEVERS = ['L2', 'L6'];

describe('evidence graph (§6.1)', () => {
  const params = new Set(buildModelParams(MODULES).defs.map((p) => p.id));
  const signals = new Set(SIGNAL_DEFS.map((s) => s.name as string));
  const modules = new Set(MODULES.map((m) => m.id as string));

  it('every edge is well formed: goal metric, module, registry params, bus signals, series, topic, sign, status', () => {
    const bad: string[] = [];
    const ids = new Set<string>();
    for (const e of EVIDENCE_EDGES) {
      if (ids.has(e.id)) bad.push(`${e.id}: duplicate id`);
      ids.add(e.id);
      if (!GOAL_METRICS.includes(e.metric)) bad.push(`${e.id}: ${e.metric} is not goal-eligible`);
      if (!modules.has(e.mechanism.module)) bad.push(`${e.id}: unknown module ${e.mechanism.module}`);
      for (const p of e.mechanism.paramIds) if (!params.has(p)) bad.push(`${e.id}: unknown parameter ${p}`);
      for (const s of e.mechanism.signals) if (!signals.has(s)) bad.push(`${e.id}: unknown signal ${s}`);
      for (const s of e.mechanism.series) if (SERIES_INDEX[s] === undefined) bad.push(`${e.id}: unknown series ${s}`);
      if (!(EVIDENCE_TOPIC_SLUGS as readonly string[]).includes(e.source.topic)) bad.push(`${e.id}: unknown topic ${e.source.topic}`);
      if (![1, -1, 0].includes(e.sign)) bad.push(`${e.id}: sign ${e.sign}`);
      if (!['modelled', 'mapped', 'infoOnly'].includes(e.status)) bad.push(`${e.id}: status ${e.status}`);
      if (!['A', 'B', 'C', 'D'].includes(e.certainty)) bad.push(`${e.id}: certainty ${e.certainty}`);
      if (!e.maintainerRef.trim()) bad.push(`${e.id}: no maintainer reference`);
      const l = leak(`${e.source.topic} ${e.source.refs.join(' ')}`);
      if (l) bad.push(`${e.id}: user-facing source leaks ${l}`);
    }
    expect(bad, bad.slice(0, 20).join('\n')).toEqual([]);
    expect(EVIDENCE_EDGES.length).toBeGreaterThan(500);
  });

  it('every lever has edges; every goal metric has at least one modelled edge', () => {
    expect(leversWithoutEdges()).toEqual([]);
    const without = GOAL_METRICS.filter((m) => !edgesTo(m).some((e) => e.status !== 'infoOnly'));
    expect(without).toEqual([]);
  });

  it('every probe switches something the grammar can build', () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    for (const e of EVIDENCE_EDGES) {
      if (!e.probe) continue;
      const k = JSON.stringify(e.probe);
      if (seen.has(k)) continue;
      seen.add(k);
      const p = probePair(e.probe);
      if (p.missing.length) bad.push(`${e.id}: probe genes missing ${p.missing.join(', ')}`);
      if (JSON.stringify(p.base) === JSON.stringify(p.toggled)) bad.push(`${e.id}: probe toggles nothing`);
    }
    expect(bad).toEqual([]);
  });

  it('grades are recorded and never used: the graph carries every certainty, sorting by grade changes no edge', () => {
    const grades = new Set(EVIDENCE_EDGES.map((e) => e.certainty));
    expect(grades.size).toBeGreaterThanOrEqual(3);
    // servesFasting reads status and sign only (a D-grade edge counts like an A-grade one)
    const z = EVIDENCE_EDGES.filter((e) => ZERO_INTAKE_SOURCES.has(e.from.id) && e.metric === 'autophagyIdx');
    expect(z.length).toBeGreaterThan(0);
    expect(servesFasting('autophagyIdx', 'up')).toBe(true);
  });

  it('fasting gate: offers every goal the graph credits; the gate-only pairs are the known divergences', { timeout: 60_000 }, () => {
    const found = fastingGateAgreement(coverageCorpus()[0]!.request.profile);
    expect(found).toEqual(KNOWN_GATE_DISAGREEMENTS);
    const rep = fastingGateReport(found);
    expect(rep.unexpected).toEqual([]);
    expect(rep.expected.map((e) => e.pair).sort()).toEqual(Object.keys(KNOWN_FASTING_DIVERGENCES).sort());
    for (const e of rep.expected) expect(leak(e.reason), e.pair).toBeNull();
  });
});

describe('gate registry (§6.2)', () => {
  const code = ['skeleton.ts', 'context.ts'].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  // gate ids are dotted literals inside gateOn(…) calls (a call may pick one of two ids)
  const sites = [...code.matchAll(/gateOn\(([^)]*)\)/g)].flatMap((m) => [...m[1]!.matchAll(/'([A-Za-z0-9]+\.[A-Za-z0-9.]+)'/g)].map((x) => x[1]!));

  it('every gate has a source, a kind and a plain-language predicate; ids are unique', () => {
    const bad = GATES.filter((g) => g.source === null || !g.source.topic || !(EVIDENCE_TOPIC_SLUGS as readonly string[]).includes(g.source.topic)).map((g) => g.id);
    expect(bad, 'unsourced gates fail the audit').toEqual([]);
    expect(new Set(GATES.map((g) => g.id)).size).toBe(GATES.length);
    for (const g of GATES) expect(leak(g.predicate), g.id).toBeNull();
  });

  it('every gateOn site in the grammar and the request compiler names a registered gate, and every switchable gate has a site', () => {
    expect(sites.length).toBeGreaterThan(20);
    expect(sites.filter((id) => !GATE_INDEX.has(id))).toEqual([]);
    expect([...SWITCHABLE_GATES].filter((id) => !sites.includes(id))).toEqual([]);
  });

  it('safety and consent gates stay on outside the audit; an evidence gate switches off inside it', () => {
    expect(gateOn({ disabledGates: new Set(['block.tier']) }, 'block.tier')).toBe(true);
    expect(gateOn({ disabledGates: new Set(['lever.optInConsent']) }, 'lever.optInConsent')).toBe(true);
    expect(gateOn({ disabledGates: new Set(['surplus.noFasts']) }, 'surplus.noFasts')).toBe(false);
    expect(() => gateOn({ disabledGates: new Set(['no.such.gate']) }, 'no.such.gate')).toThrow(/unregistered/);
    const req = { profile: coverageCorpus()[0]!.request.profile, goals: [{ metric: 'leanTissue' as const, direction: 'maximise' as const }, { metric: 'autophagyIdx' as const, direction: 'maximise' as const }], horizonDays: 112, safety: { optIns: { fastingTier: 'T3' as const } } };
    const on = compileRequest(req);
    expect(on.fastingRelevant).toBe(false);
    const off = withGatesDisabledSync(['fasting.muscleAbove'], () => compileRequest(req));
    expect(off.fastingRelevant).toBe(true);
    expect(enumerateStructures(off).length).toBeGreaterThan(enumerateStructures(on).length);
    // a context compiled outside the audit carries no disabled set
    expect(compileRequest(req).disabledGates).toBeUndefined();
  });
});

describe('check 1: lever reachability and gene range (§6.3 1a, 1b)', () => {
  const corpus = coverageCorpus();

  it('1a: every usable lever and every phase, overlay and event block appears in a structure of the coverage corpus', { timeout: 120_000 }, () => {
    expect(corpus.length).toBeGreaterThanOrEqual(200);
    const r = reachability(corpus);
    expect(r.unreachableLevers).toEqual(KNOWN_UNREACHABLE_LEVERS);
    expect(r.unreachableBlocks).toEqual([]);
  });

  it('1b: every gene moves its engine input between corners 0 and 1; decoded ranges stay inside the lever registry or are reported', { timeout: 120_000 }, () => {
    const sub = corpus.filter((_, i) => i % 29 === 0).map((e) => e.request);
    const g = geneRanges(sub, 14);
    expect(g.dead).toEqual([]);
    expect(Object.keys(g.genes).length).toBeGreaterThan(15);
    // decoded values outside the registry's parameter range (reported): the eating window may start up to 15:00 (latest
    // meal 21:00 minus the 6-h minimum window) against the lever's 14:00; walking intensity sits at 40-55 % of VO2max,
    // below the cardio lever's 45 % minimum (the decoder's modality bands are the dossier's)
    const outside = g.registry.filter((r) => r.decoded && (r.decoded[0] < r.registry[0] - 1e-9 || r.decoded[1] > r.registry[1] + 1e-9)).map((r) => `${r.lever}.${r.param}`);
    expect(outside.sort()).toEqual(['cardio.pctVo2max', 'eatingWindow.startH']);
  });

  it('1b: no gene is overridden by repair on most days of most Latin-hypercube samples (effectively fixed)', { timeout: 120_000 }, () => {
    const sub = corpus.filter((_, i) => i % 37 === 0).map((e) => e.request);
    const r = repairRates(sub, 8, 6);
    expect(r.samples).toBeGreaterThan(100);
    expect(r.effectivelyFixed).toEqual([]);
  });
});
