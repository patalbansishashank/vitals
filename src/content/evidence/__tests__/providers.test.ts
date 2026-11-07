// @vitest-environment node
/**
 * Provider/consumer fixtures of the evidence library (C6, D2-02), the Phase 0C wiring checks.
 *
 * The library is both a consumer (it restates what the cellular module, the goal-capability registry and the drift
 * projection do) and a provider (other code points at its articles through `detailsRef`, and the info sheets read its
 * warrant words). These tests keep both directions in step with the code that is actually there:
 *  1. every `detailsRef` written in production source opens an existing article, and a range sent with it is described
 *     in that article with the same kind of uncertainty;
 *  2. the autophagy index article states the cellular module's own definition (scale, the 12 h anchor, the timing
 *     parameters behind its sensitivity range, the legacy display bands, its exploratory research status);
 *  3. a metric the capability registry keeps out of planning is never described as a modelled production mechanism;
 *  4. the sheet words come from one provider and compose the way the sheets print them;
 *  5. article and claim ids of the autophagy topic stay stable, so saved Explain links, shared links and earlier answers
 *     still open (adding articles is fine; renaming or removing one is not).
 */
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { ASI_BANDS, ASI_RESEARCH_INDEX } from '@/engine/model/cellular/labels';
import { CELLULAR_PARAMS } from '@/engine/model/cellular/params';
import { GOAL_CAPABILITY, type MetricId } from '@/engine/types/metrics';
import { capabilityAllowsOptimization, type UncertaintyKind } from '@/lib/bodyContracts';
import { EVIDENCE_TOPICS } from '../index';
import type { EvidenceTopic, Mechanism } from '../schema';
import {
  hasWarrantContent,
  MODEL_STATUS_LABEL,
  OBSERVATION_TYPE_LABEL,
  observationText,
  WARRANT_LABEL,
  warrantText,
} from '../warrants';

let topics: EvidenceTopic[] = [];
const byId = new Map<string, { topic: EvidenceTopic; mechanism: Mechanism }>();

beforeAll(async () => {
  topics = await Promise.all(EVIDENCE_TOPICS.map(async (e) => (await e.load()).default));
  for (const topic of topics)
    for (const mechanism of topic.mechanisms) byId.set(mechanism.id, { topic, mechanism });
}, 120_000);

const mechanism = (id: string): Mechanism => {
  const m = byId.get(id)?.mechanism;
  if (!m) throw new Error(`mechanism ${id} missing`);
  return m;
};

/* ------------------------------------------------------------------------------------ 1. detailsRef consumers */

const productionSources = import.meta.glob(
  [
    '/src/**/*.{ts,tsx}',
    '!/src/**/__tests__/**',
    '!/src/**/test/**',
    '!/src/**/*.test.{ts,tsx}',
    '!/src/**/testing.ts',
    '!/src/**/testkit.ts',
    '!/src/**/fixtures.ts',
    '!/src/content/**',
    '!/src/engine/planner/bench/**',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

interface DetailsRefUse {
  file: string;
  line: number;
  ref: string;
  /** `uncertaintyKind` written in the same object literal, when it is a plain string. */
  uncertaintyKind?: string;
  /** The same object literal carries a `range`. */
  hasRange: boolean;
}

const stringValue = (e: ts.Expression): string | undefined =>
  ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : undefined;

/** `{ …, detailsRef: '<id>', … }` object literals of a source file, with the sibling `uncertaintyKind` and `range`. */
function detailsRefUses(file: string, code: string): DetailsRefUse[] {
  if (!code.includes('detailsRef')) return [];
  const sf = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: DetailsRefUse[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map<string, ts.Expression>();
      let hasRange = false;
      for (const p of node.properties) {
        if (!p.name || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
        if (p.name.text === 'range') hasRange = true;
        if (ts.isPropertyAssignment(p)) props.set(p.name.text, p.initializer);
      }
      const refExpr = props.get('detailsRef');
      const ref = refExpr ? stringValue(refExpr) : undefined;
      if (ref !== undefined) {
        const kindExpr = props.get('uncertaintyKind');
        const kind = kindExpr ? stringValue(kindExpr) : undefined;
        out.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          ref,
          hasRange,
          ...(kind !== undefined ? { uncertaintyKind: kind } : {}),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const uses = (): DetailsRefUse[] =>
  Object.entries(productionSources).flatMap(([f, code]) => detailsRefUses(f, code));

describe('detailsRef consumers open existing articles', () => {
  it('finds the detailsRef producers in the source (the scan is not empty)', () => {
    const found = uses();
    expect(found.length).toBeGreaterThan(0);
    // the drift card's balance residual is one of them, sent with its conditional residual range
    expect(
      found.some(
        (u) =>
          u.file.endsWith('/living/projection.ts') &&
          u.ref === '24-energy-balance-bias' &&
          u.hasRange &&
          u.uncertaintyKind === 'conditionalResidual',
      ),
    ).toBe(true);
  });

  it('every detailsRef written in production source is an article id of the library', () => {
    const missing = uses()
      .filter((u) => !byId.has(u.ref))
      .map((u) => `${u.file}:${u.line} → ${u.ref}`);
    expect(missing).toEqual([]);
  });

  it('a range sent with a detailsRef is described in that article with the same kind of uncertainty', () => {
    const problems: string[] = [];
    for (const u of uses()) {
      if (!u.hasRange || !u.uncertaintyKind || u.uncertaintyKind === 'none') continue;
      const m = byId.get(u.ref)?.mechanism;
      if (!m) continue; // reported above
      if (!m.keyNumbers.some((k) => k.uncertaintyKind === u.uncertaintyKind))
        problems.push(
          `${u.file}:${u.line}: ${u.ref} has no key number with uncertaintyKind ${u.uncertaintyKind}`,
        );
    }
    expect(problems).toEqual([]);
  });

  it('the balance residual article reads as a residual, not measured expenditure, and never as a calibrated interval', () => {
    const m = mechanism('24-energy-balance-bias');
    expect(m.howModelled).toMatch(/a balance residual, not measured expenditure/);
    const range = m.keyNumbers.find(
      (k) => k.uncertaintyKind === ('conditionalResidual' satisfies UncertaintyKind),
    );
    expect(range?.note).toMatch(/not a full prediction interval/);
    expect(range?.note).toMatch(/coverage has not been validated/);
    // 1.2816 SD either side is the 10th–90th percentile pair the projection sends
    expect(range?.value).toMatch(/1\.28/);
    expect(range?.value).toMatch(/10th–90th/);
  });
});

/* -------------------------------------------------------------------- 2. the cellular module's index definition */

const param = (name: string) => {
  const p = CELLULAR_PARAMS.find((x) => x.id === `cellular.${name}`);
  if (!p) throw new Error(`cellular.${name} missing`);
  return p;
};
const num = (x: number): string => String(x);

describe('the index article states the cellular module definition', () => {
  it('names the 12 h anchor as a definition with the module value', () => {
    const anchor = param('asiRef12');
    expect(anchor.low).toBe(anchor.high); // never varied in draws
    const m = mechanism('08-autophagy-signal-index');
    const central = m.keyNumbers.find((k) => k.label.startsWith('Central value'));
    expect(central?.value).toContain(`12 h: ${num(anchor.value)} (by definition)`);
    expect(m.summary).toContain(`set to ${num(anchor.value)} at 12 h after a meal by definition`);
    expect(m.caveats).toContain(`its value of ${num(anchor.value)} at 12 h after a meal are definitions`);
  });

  it('builds its sensitivity range from the module timing parameters and their bounds', () => {
    const h50 = param('h50');
    const nh = param('nh');
    const m = mechanism('08-autophagy-signal-index');
    const spread = m.keyNumbers.find((k) => k.label.startsWith('Sensitivity range'));
    expect(spread?.label).toContain(`h50 ${num(h50.low)}–${num(h50.high)} h`);
    expect(spread?.label).toContain(`nh ${num(nh.low)}–${num(nh.high)}`);
    expect(m.caveats).toContain(`h50 (${num(h50.low)}–${num(h50.high)} h)`);
    expect(spread?.uncertaintyKind).toBe(ASI_RESEARCH_INDEX.uncertaintyKind);
  });

  it('matches the research-index declaration: exploratory, 0–100, definitional anchors, no flux estimate', () => {
    const m = mechanism('08-autophagy-signal-index');
    expect(m.modelStatus).toBe(ASI_RESEARCH_INDEX.status);
    const [lo, hi] = ASI_RESEARCH_INDEX.range;
    expect(m.summary).toContain(`${lo}–${hi} research index`);
    expect(ASI_RESEARCH_INDEX.anchors).toBe('definitional');
    expect(m.keyNumbers.find((k) => k.label.startsWith('Central value'))?.note).toMatch(
      /code check, not validation/,
    );
    expect(m.observations?.every((o) => o.type === 'modelDefinition')).toBe(true);
    expect(ASI_RESEARCH_INDEX.fluxEstimate).toBe(false);
    expect(m.observations?.some((o) => o.type === 'humanTissueFlux')).toBe(false);
    expect(ASI_RESEARCH_INDEX.healthObjective).toBe(false);
    expect(m.howModelled).toMatch(/enters no plan objective, comparison or safety check/);
  });

  it('lists the legacy display bands at the module edges', () => {
    const labels = mechanism('08-autophagy-signal-index').keyNumbers.find(
      (k) => k.label === 'Labels for the display',
    );
    const edges = [...ASI_BANDS.map((b) => b.from), ASI_RESEARCH_INDEX.range[1]];
    for (let i = 0; i < edges.length - 1; i++)
      expect(labels?.value).toContain(`${edges[i]}–${edges[i + 1]} “`);
  });
});

/* -------------------------------------------------------------------- 3. the goal-capability registry */

describe('the capability registry and the articles agree', () => {
  it('a metric kept out of planning is never described as a modelled production mechanism', () => {
    const blocked = (Object.keys(GOAL_CAPABILITY) as MetricId[]).filter(
      (id) =>
        !capabilityAllowsOptimization(GOAL_CAPABILITY[id]) &&
        GOAL_CAPABILITY[id].reasonCode === 'noHealthObjective',
    );
    expect(blocked).toEqual(expect.arrayContaining(['autophagyIdx', 'mtorIdx', 'ampkIdx']));
    const problems: string[] = [];
    for (const t of topics)
      for (const m of t.mechanisms)
        if (
          m.modelStatus === 'production' &&
          m.relatedMetricIds.some((id) => (blocked as string[]).includes(id))
        )
          problems.push(`${m.id}: production status for ${m.relatedMetricIds.join(', ')}`);
    expect(problems).toEqual([]);
  });

  it('every article whose only charted metrics are the autophagy, mTOR or AMPK index carries a model status word', () => {
    const display = new Set<string>(['autophagyIdx', 'mtorIdx', 'ampkIdx']);
    const missing: string[] = [];
    for (const { mechanism: m } of byId.values())
      if (
        m.relatedMetricIds.length > 0 &&
        m.relatedMetricIds.every((id) => display.has(id)) &&
        !m.modelStatus
      )
        // a mixed article (muscle gain alongside a chosen eating pattern) also covers modelled outcomes: no single word
        if (!m.observations?.some((o) => o.type === 'humanOutcome')) missing.push(m.id);
    expect(missing).toEqual([]);
  });
});

/* -------------------------------------------------------------------- 4. sheet words from one provider */

describe('sheet words', () => {
  it('compose the way the sheets print them', () => {
    expect(warrantText({ type: 'analyticallyTrue', confidence: 'high', scope: 'direction only' })).toBe(
      'Analytically true · high · direction only',
    );
    expect(warrantText({ type: 'timeTested', confidence: 'moderate' })).toBe('Time-tested · moderate');
    expect(observationText({ tissue: 'whole blood (SIRT1 mRNA)', type: 'humanBloodMarker' })).toBe(
      'whole blood (SIRT1 mRNA) · human blood marker',
    );
  });

  it('keep observation types in lower case (they follow a tissue) and warrant kinds capitalised (they head a row)', () => {
    for (const [k, v] of Object.entries(OBSERVATION_TYPE_LABEL)) expect(v, k).toBe(v.toLowerCase());
    for (const [k, v] of Object.entries(WARRANT_LABEL)) expect(v[0], k).toBe(v[0]!.toUpperCase());
  });

  it('name the warrant kinds the same way in the warrant-kinds article', () => {
    const text = mechanism('27-warrant-kinds')
      .keyNumbers.map((k) => k.value)
      .join(' ')
      .toLowerCase();
    for (const [k, v] of Object.entries(WARRANT_LABEL)) expect(text, k).toContain(v.toLowerCase());
  });

  it('open a warrant block only when there is something to show', () => {
    expect(hasWarrantContent({ modelStatus: 'production' })).toBe(false);
    expect(hasWarrantContent({})).toBe(false);
    expect(hasWarrantContent({ modelStatus: 'exploratory' })).toBe(true);
    expect(hasWarrantContent({ population: 'adults' })).toBe(true);
    expect(MODEL_STATUS_LABEL.notModelled).toBe('Not modelled');
  });
});

/* -------------------------------------------------------------------- 5. stable ids */

/** Article and claim ids of the autophagy topic before the 2026-10-18 revision. */
const AUTOPHAGY_IDS_BEFORE = [
  '08-human-autophagy-evidence',
  '08-mouse-to-human-timescale',
  '08-amino-acids-mtorc1',
  '08-insulin-akt-suppression',
  '08-fasting-depth-drive',
  '08-ampk-exercise-glycogen',
  '08-sirtuins-nad',
  '08-exercise-autophagy-pulse',
  '08-chronic-restriction-term',
  '08-autophagy-signal-index',
  '08-muscle-mtorc1-index',
  '08-igf1-relative-level',
  '08-fgf21-not-charted',
  '08-tissue-specificity',
  '08-autophagy-vs-muscle-gain',
  '08-protein-restriction-igf1',
  '08-calerie-calorie-restriction',
  '08-fasting-mimicking-diet',
  '08-autophagy-compounds',
  '08-myth-autophagy-starts-at-16h',
  '08-myth-autophagy-peaks-24-48-72h',
  '08-myth-protein-threshold-breaks-fast',
  '08-myth-coffee-and-fasting',
  '08-myth-exogenous-ketones',
  '08-myth-fasting-activates-ampk',
  '08-myth-fasted-training-maximises-autophagy',
  '08-myth-autophagy-declines-with-age',
  '08-myth-intermittent-fasting-proven',
  '08-myth-calorie-restriction-lowers-igf1',
  '08-myth-lower-igf1-always-better',
  '08-myth-fmd-reverses-age-2-5-years',
  '08-myth-serum-lc3-shows-autophagy',
  '08-myth-longer-fast-better',
];

describe('stable ids', () => {
  it('keeps every earlier article and claim id of the autophagy topic', () => {
    const t = topics.find((x) => x.slug === 'autophagy-longevity')!;
    const now = new Set([...t.mechanisms.map((m) => m.id), ...t.myths.map((m) => m.id)]);
    expect(AUTOPHAGY_IDS_BEFORE.filter((id) => !now.has(id))).toEqual([]);
  });

  it('keeps article ids unique across the library (one id, one article)', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const t of topics)
      for (const m of t.mechanisms) {
        if (seen.has(m.id)) dup.push(`${m.id} in ${seen.get(m.id)} and ${t.slug}`);
        seen.set(m.id, t.slug);
      }
    expect(dup).toEqual([]);
  });
});
