/**
 * Outcome-scoped evidence metadata (C6) and the autophagy index (D2-02).
 *
 * Mechanisms may carry warrants (kind, confidence, the outcome they cover), the population, what the supporting evidence
 * observed (tissue and observation type) and how the engine uses them (`modelStatus`). These tests keep that metadata
 * well-formed and serialisable, and pin the autophagy content to the final behaviour: Vitals does not quantify autophagy,
 * the index is an exploratory research display (not a goal, no planning or health credit), measured human flux stays
 * separate from it, and no text calls the index or its parameter draws measured flux, a percentage of autophagy, a
 * longevity gain or a predicted range.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { GOAL_CAPABILITY, isProductionGoalEligible, SERIES } from '@/engine/types/metrics';
import {
  capabilityAllowsOptimization,
  STATUS_LABEL,
  type UncertaintyKind,
  type Warrant,
} from '@/lib/bodyContracts';
import { EVIDENCE_TOPICS } from '../index';
import type { EvidenceTopic, Mechanism } from '../schema';
import { MODEL_STATUS_LABEL, modelStatusLabel, OBSERVATION_TYPE_LABEL, WARRANT_LABEL } from '../warrants';
import { leak, strings } from './leakScan';

const UNCERTAINTY_KINDS: Readonly<Record<UncertaintyKind, true>> = {
  none: true,
  measurementRepeatability: true,
  parameterSensitivity: true,
  scenario: true,
  conditionalResidual: true,
  heuristic: true,
  calibratedPrediction: true,
};
const CONFIDENCES: Readonly<Record<Warrant['confidence'], true>> = {
  high: true,
  moderate: true,
  low: true,
  provisional: true,
};
const nonEmpty = (s: unknown): boolean => typeof s === 'string' && s.trim().length > 0;

/** Identifier and link fields: not prose. */
const NOT_PROSE = new Set([
  'id',
  'slug',
  'dossier',
  'referenceIds',
  'relatedMetricIds',
  'relatedParamIds',
  'pmid',
  'doi',
  'url',
  'type',
  'confidence',
  'modelStatus',
  'uncertaintyKind',
  'status',
  'grade',
  'category',
]);

let topics: EvidenceTopic[] = [];
let autophagy: EvidenceTopic;

beforeAll(async () => {
  topics = await Promise.all(EVIDENCE_TOPICS.map(async (e) => (await e.load()).default));
  const t = topics.find((x) => x.slug === 'autophagy-longevity');
  if (!t) throw new Error('autophagy topic missing');
  autophagy = t;
}, 120_000);

const mechanism = (id: string): Mechanism => {
  const m = autophagy.mechanisms.find((x) => x.id === id);
  if (!m) throw new Error(`mechanism ${id} missing`);
  return m;
};
/** Articles that describe (a part of) the autophagy index. */
const indexArticles = (): Mechanism[] =>
  autophagy.mechanisms.filter((m) => m.relatedMetricIds.includes('autophagyIdx'));
const prose = (value: unknown, path: string): Array<[string, string]> => {
  const rows: Array<[string, string]> = [];
  strings(value, path, rows, NOT_PROSE);
  return rows;
};

describe('outcome-scoped mechanism metadata', () => {
  it('uses known warrant kinds and confidences, each scoped to an outcome when a scope is given', () => {
    const problems: string[] = [];
    for (const t of topics)
      for (const m of t.mechanisms) {
        for (const w of m.warrants ?? []) {
          if (!(w.type in WARRANT_LABEL)) problems.push(`${m.id}: unknown warrant kind ${w.type}`);
          if (!(w.confidence in CONFIDENCES)) problems.push(`${m.id}: unknown confidence ${w.confidence}`);
          if (w.scope !== undefined && !nonEmpty(w.scope)) problems.push(`${m.id}: empty warrant scope`);
        }
        if (m.outcomeScope !== undefined && !nonEmpty(m.outcomeScope))
          problems.push(`${m.id}: empty outcomeScope`);
        if (m.population !== undefined && !nonEmpty(m.population)) problems.push(`${m.id}: empty population`);
      }
    expect(problems).toEqual([]);
  });

  it('names the tissue and a known observation type for every observation', () => {
    const problems: string[] = [];
    for (const t of topics)
      for (const m of t.mechanisms)
        for (const o of m.observations ?? []) {
          if (!nonEmpty(o.tissue)) problems.push(`${m.id}: observation without tissue`);
          if (!(o.type in OBSERVATION_TYPE_LABEL))
            problems.push(`${m.id}: unknown observation type ${o.type}`);
        }
    expect(problems).toEqual([]);
  });

  it('labels key-number ranges with a known uncertainty kind, and claims no calibrated prediction', () => {
    const problems: string[] = [];
    for (const t of topics)
      for (const m of t.mechanisms)
        for (const k of m.keyNumbers) {
          if (k.uncertaintyKind === undefined) continue;
          if (!(k.uncertaintyKind in UNCERTAINTY_KINDS))
            problems.push(`${m.id} "${k.label}": unknown ${k.uncertaintyKind}`);
          // No range in the library has passed a held-out evaluation; calibrated coverage cannot be claimed.
          if (k.uncertaintyKind === 'calibratedPrediction')
            problems.push(`${m.id} "${k.label}": calibrated prediction claimed`);
        }
    expect(problems).toEqual([]);
  });

  it('gives every model status a short status word (the inline exploratory word matches the status vocabulary)', () => {
    for (const t of topics)
      for (const m of t.mechanisms)
        if (m.modelStatus) expect(modelStatusLabel(m), m.id).toBe(MODEL_STATUS_LABEL[m.modelStatus]);
    expect(MODEL_STATUS_LABEL.exploratory).toBe(STATUS_LABEL.exploratory);
    expect(modelStatusLabel({})).toBeNull();
  });

  it('keeps the metadata labels free of internal references', () => {
    const rows: Array<[string, string]> = [
      ...Object.entries(WARRANT_LABEL),
      ...Object.entries(OBSERVATION_TYPE_LABEL),
      ...Object.entries(MODEL_STATUS_LABEL),
    ];
    expect(rows.map(([k, v]) => (leak(v) ? `${k}: ${leak(v)}` : null)).filter(Boolean)).toEqual([]);
  });

  it('survives a JSON round trip unchanged, with only finite numbers (what the evidence tool and workers receive)', () => {
    const nonFinite: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'number' && !Number.isFinite(v)) nonFinite.push(path);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    for (const t of topics) {
      walk(t, t.slug);
      expect(JSON.parse(JSON.stringify(t)), t.slug).toStrictEqual(t);
    }
    expect(nonFinite).toEqual([]);
  });
});

describe('autophagy index: an exploratory research display, never a goal', () => {
  it('keeps the index as a model definition with an analytical warrant, not an observation of flux', () => {
    const m = mechanism('08-autophagy-signal-index');
    expect(m.modelStatus).toBe('exploratory');
    expect(m.observations?.length).toBeGreaterThan(0);
    expect(m.observations?.every((o) => o.type === 'modelDefinition')).toBe(true);
    expect(m.warrants?.some((w) => w.type === 'analyticallyTrue')).toBe(true);
    expect(m.warrants?.some((w) => w.type === 'causallyCoherent' && w.confidence === 'low')).toBe(true);
    expect(m.summary).toMatch(/not a goal/);
    expect(m.summary).toMatch(/no planning or health credit/);
    expect(m.summary).toMatch(/not a percentage of autophagy/);
    expect(m.howModelled).toMatch(/enters no plan objective, comparison or safety check/);
  });

  it('keeps measured human flux separate from the index and scoped to blood cells, never an organ', () => {
    const flux = autophagy.mechanisms.flatMap((m) =>
      (m.observations ?? [])
        .filter((o) => o.type === 'humanTissueFlux')
        .map((o) => [m.id, o.tissue] as const),
    );
    expect(flux.length).toBeGreaterThan(0);
    for (const [id, tissue] of flux) {
      expect(tissue, id).toMatch(/blood cells/);
      expect(tissue, id).not.toMatch(/liver|brain|heart|organ/i);
    }
    expect(flux.map(([id]) => id)).not.toContain('08-autophagy-signal-index');
  });

  it('identifies tissue and observation type in every article about the index', () => {
    for (const m of indexArticles()) expect(m.observations?.length ?? 0, m.id).toBeGreaterThan(0);
  });

  it('carries the shared statement in every article about the index: not quantified, not a goal, no flux range', () => {
    for (const m of indexArticles()) {
      expect(m.caveats, m.id).toMatch(/^Vitals does not quantify autophagy/);
      expect(m.caveats, m.id).toMatch(/Flux can be measured in human blood cells/);
      expect(m.caveats, m.id).toMatch(/not a goal, and earns no planning or health credit/);
      expect(m.caveats, m.id).toMatch(/not a predicted range for flux/);
    }
  });

  it('never labels the index or its draws as measured flux, a percentage of autophagy, a longevity gain or a predicted range', () => {
    const forbidden: ReadonlyArray<readonly [RegExp, string]> = [
      [/likely[- ]range/i, 'likely range'],
      [/\bP10[–-]P90 band\b/, 'probability-looking band label'],
      [/shaded band shows/i, 'band read as timing certainty'],
      [/\d+(\.\d+)? ?% (of )?autophagy\b/i, 'percentage of autophagy'],
      [/\bpercent(age)? autophagy\b/i, 'percentage of autophagy'],
      [/\blongevity (gain|benefit)/i, 'longevity gain'],
      [/\bautophagy (goal|target)\b/i, 'autophagy goal'],
      [/U\(ASI\)|asiWeeklyMean/, 'index utility'],
      [/\bautophagy ranks first\b|\branked autophagy first\b|\bif autophagy ranks\b/i, 'autophagy ranking'],
      [/\b(index|signal) (measures|is a measurement of) autophagy\b/i, 'index as measurement'],
    ];
    const rows: Array<[string, string]> = [];
    for (const t of topics)
      for (const m of t.mechanisms) {
        const r = prose(m, `${t.slug}.${m.id}`);
        // Every article in the autophagy topic, and any other article that mentions autophagy.
        if (t.slug === 'autophagy-longevity' || r.some(([, s]) => /autophag/i.test(s))) rows.push(...r);
      }
    rows.push(
      ...prose(autophagy.openQuestions, 'autophagy.openQuestions'),
      ...prose(autophagy.scope, 'autophagy.scope'),
    );
    const hits = rows.flatMap(([path, text]) =>
      forbidden.filter(([re]) => re.test(text)).map(([, name]) => `${path}: ${name}`),
    );
    expect(hits).toEqual([]);
  });

  it('reads the index anchor table and its parameter spread as a code check and a sensitivity range', () => {
    const m = mechanism('08-autophagy-signal-index');
    const anchors = m.keyNumbers.find((k) => k.label.startsWith('Central value'));
    expect(anchors?.note).toMatch(/code check, not validation/);
    const spread = m.keyNumbers.find((k) => k.label.startsWith('Sensitivity range'));
    expect(spread?.uncertaintyKind).toBe('parameterSensitivity');
    expect(spread?.note).toMatch(/Not a probability/);
    expect(m.equation).not.toMatch(/U\(|utility/i);
  });

  it('gives protein restriction no cellular credit', () => {
    const term = mechanism('08-chronic-restriction-term').keyNumbers.find(
      (k) => k.label === 'Protein-restriction term',
    );
    expect(term?.value).toBe('0');
    expect(mechanism('08-protein-restriction-igf1').howModelled).toMatch(
      /not treated as an autophagy lever and earns no cellular benefit/,
    );
  });

  it('keeps a chosen fasting pattern as a preference inside the safety limits, with no index objective', () => {
    const m = mechanism('08-autophagy-vs-muscle-gain');
    expect(m.equation).toBeUndefined();
    expect(m.howModelled).toMatch(/not a planning goal/);
    expect(m.howModelled).toMatch(/no plan lengthens a fast, narrows an eating window or lowers protein/);
    expect(m.howModelled).toMatch(/stays your preference, inside the safety limits/);
    expect(m.warrants?.some((w) => w.type === 'timeTested')).toBe(true);
  });

  it('agrees with the goal capability registry: no route can optimise the index, and mTOR and AMPK stay non-optimisable', () => {
    expect(capabilityAllowsOptimization(GOAL_CAPABILITY.autophagyIdx)).toBe(false);
    expect(isProductionGoalEligible('autophagyIdx')).toBe(false);
    for (const id of ['mtorIdx', 'ampkIdx'] as const) {
      expect(SERIES.find((d) => d.id === id)?.goal, id).toBe('none');
      expect(capabilityAllowsOptimization(GOAL_CAPABILITY[id]), id).toBe(false);
      expect(isProductionGoalEligible(id), id).toBe(false);
    }
  });
});
