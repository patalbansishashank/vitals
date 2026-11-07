/**
 * Validation evidence ledger (review D8-03, contract C7). Every scenario of the suite gets one entry that says what kind of
 * evidence its rows are, so a report can never add a conservation identity, a fit to the study a coefficient came from
 * and a comparison with an untouched study into one number:
 *
 *   verification         analytic identities, definition anchors and invariances of the software (true or false, no study)
 *   conditionalDynamics  shared-input comparisons with an independent model (the Hall planner port, dossier 04's daily
 *                        carbohydrate law, a dossier's own model table): both models get the same inputs, so agreement tests
 *                        dynamics conditional on those inputs, not human prediction
 *   developmentFit       a published study the model was built, calibrated or checked against (role estimation: a cited
 *                        parameter came from it; role calibration: it was visible while the model was tuned)
 *   externalEvaluation   a study held out under a frozen model and extraction protocol (role externalEvaluation, with the
 *                        frozen model version and the freeze hash recorded before the outcomes were extracted)
 *
 * Rules (D8-03): the split unit is the study/cohort, never a row or an arm; a study that influenced a model version is
 * development for that version; a completed frozen-model external evaluation stays valid historical evidence for the version
 * it evaluated after it is read, while a later revision tuned on it is development for that revision. Historical scenarios
 * are development unless provenance establishes independence (migration default): this release has no external evaluation.
 * Tolerances keep their type (SD, SEM, CI, clinical, design, direction), never interchangeable, and every imputed input
 * stays visible. Pure data and pure functions; no engine run here.
 */
import type { PersonProfile, Schedule } from '../types';
import type { ParamDef } from '../types/params';
import type { Check, Expectation, Scenario } from './harness/types';
import { PROVENANCE, type OutcomeProvenance } from './provenance';

export const LEDGER_SCHEMA_VERSION = 2;

export type EvidenceClass = 'verification' | 'conditionalDynamics' | 'developmentFit' | 'externalEvaluation';
export type DatasetRole = 'estimation' | 'calibration' | 'externalEvaluation';
/** What a tolerance means. 'design' = the dossier's chosen acceptance band; 'direction' = a sign/order check. */
export type ToleranceType = 'SD' | 'SEM' | 'CI' | 'clinical' | 'design' | 'direction';

export const EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  'verification',
  'conditionalDynamics',
  'developmentFit',
  'externalEvaluation',
];
export const TOLERANCE_TYPES: readonly ToleranceType[] = [
  'SD',
  'SEM',
  'CI',
  'clinical',
  'design',
  'direction',
];

/** A frozen-model external evaluation: the model version it evaluated and the freeze recorded before extraction. */
export interface FrozenEvaluation {
  modelVersion: string;
  /** Hash of the frozen model and extraction protocol, recorded before the holdout outcomes were extracted. */
  freezeHash: string;
  protocol: string;
  /** Must be true: outcomes extracted only after the freeze. */
  extractedAfterFreeze: boolean;
  /** Rows attempted, including unavailable / aborted ones (all are reported). */
  attempted: number;
}

export interface Tolerance {
  type: ToleranceType;
  /** Where the tolerance comes from (the expectation's source, else the scenario citation). */
  source: string;
}

export interface LedgerEntry {
  scenarioId: string;
  /** Canonical arm/outcome sidecar, including explicit unknowns. */
  provenance?: Readonly<Record<string, OutcomeProvenance>>;
  /** Study/cohort ids: the split unit. */
  studies: readonly string[];
  arms: readonly string[];
  /** Expectation (outcome) ids. */
  outcomes: readonly string[];
  evidenceClass: EvidenceClass;
  /** Dataset role for study data (null for verification and conditional dynamics). */
  role: DatasetRole | null;
  /** 'documented' = provenance establishes the role; 'migrationDefault' = development because nothing establishes independence. */
  roleBasis: 'documented' | 'migrationDefault';
  /** Parameters / rulings / policies the study influenced (from the parameter registry's cited sources, plus documented ones). */
  influenced: readonly string[];
  /** Inputs: observed (measured in the study), protocol (prescribed by it) and imputed (filled in by the fixture or engine). */
  inputs: { observed: readonly string[]; protocol: readonly string[]; imputed: readonly string[] };
  population: string;
  /** Per outcome: endpoint operator (how the model quantity maps onto the study's measurement) and tolerance. */
  endpoints: Readonly<Record<string, string>>;
  tolerances: Readonly<Record<string, Tolerance>>;
  /** D1-08: whether the fixture reproduces the study protocol. */
  protocolFidelity: 'matched' | 'mismatched' | 'unknown';
  /** Frozen-model external evaluations of this study (historical evidence for the version each evaluated). */
  evaluations: readonly FrozenEvaluation[];
  /** Model versions tuned or selected on this study's outcomes after an evaluation (development for those versions). */
  influencedVersions: readonly string[];
  note?: string;
}

// ------------------------------------------------------------------ study identity

const SURNAME = "[A-Z][\\p{L}'’-]+(?:[ -](?:van|de|der|den|von|da)?[ -]?[A-Z][\\p{L}'’-]+)?";
const AUTHOR_YEAR = new RegExp(
  `(${SURNAME})(?:\\s+et\\s+al\\.?|\\s*(?:&|and)\\s+${SURNAME})?,?\\s+((?:19|20)\\d{2})\\b`,
  'gu',
);
const FOLD: Readonly<Record<string, string>> = {
  ł: 'l',
  Ł: 'L',
  ø: 'o',
  Ø: 'O',
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  đ: 'd',
  Đ: 'D',
};

/** Normalised study id `surname-year` (lower case, ASCII letters). */
export function studyKey(surname: string, year: string): string {
  const s = surname
    .replace(/[łŁøØßæÆđĐ]/g, (c) => FOLD[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${s}-${year}`;
}

/** Every author-year citation in a text, as study ids, in order of appearance (deduplicated). */
export function citedStudies(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(AUTHOR_YEAR)) {
    const head = m[1]!;
    if (
      /^(Dossier|Table|Fig|Figure|MODEL|Grade|Ruling|Review|Plan|Appendix|Hall-type|Tier|Cell|Lancet|JAMA|Am|J|N)$/.test(
        head,
      )
    )
      continue;
    const parts = head.split(/[ -]/);
    // a particle surname (Van Itallie, De Ruiter) keeps all its words; otherwise the first word is the surname
    const k = studyKey(
      /^(van|de|der|den|von|da|di|du|le|la)$/i.test(parts[0]!) ? parts.join('-') : parts[0]!,
      m[2]!,
    );
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Cohort ids where several papers report one cohort (the split unit is the cohort): CALERIE phase 1 and 2, the Minnesota
 * experiment, and model-value targets (a dossier's own model table is not a human study).
 */
const COHORTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^01-7\.3-calerie1|^02-V4-calerie|calerie-?1/i, 'calerie-1'],
  [/^01-7\.4-calerie2|calerie-?2/i, 'calerie-2'],
  [/minnesota/i, 'minnesota-1950'],
];

/** Targets taken from a dossier's own model table (dossier 20 §4B.3 schedule behaviour), not from a human study. */
function isModelTable(sc: Pick<Scenario, 'title' | 'citation'>): boolean {
  return /MODEL values/.test(sc.citation) || /^§4B\.3/.test(sc.title);
}

/** Study ids of a scenario: a known cohort, else the first author-year of the citation (the primary paper), else of the title. */
export function studiesOf(sc: Pick<Scenario, 'id' | 'title' | 'citation' | 'dossier'>): string[] {
  for (const [re, id] of COHORTS) if (re.test(sc.id) || re.test(sc.title)) return [id];
  if (isModelTable(sc)) return [`dossier-${sc.dossier}-model`];
  if (sc.dossier === 'O-3') return ['dossier-04-daily-carbohydrate-law'];
  const fromCitation = citedStudies(sc.citation.split(';')[0] ?? sc.citation);
  if (fromCitation.length) return fromCitation.slice(0, 1);
  const fromTitle = citedStudies(sc.title);
  if (fromTitle.length) return fromTitle.slice(0, 1);
  const any = citedStudies(sc.citation);
  return any.length ? any.slice(0, 1) : [`scenario-${sc.id}`];
}

// ------------------------------------------------------------------ classification

/** Evidence class of a scenario from its provenance (see the header): oracle and model-value comparisons, anchors, studies. */
export function evidenceClassOf(sc: Pick<Scenario, 'id' | 'dossier' | 'title' | 'citation'>): EvidenceClass {
  if (sc.dossier === 'O-1' || sc.dossier === 'O-2' || sc.dossier === 'O-3') return 'conditionalDynamics';
  if (isModelTable(sc)) return 'conditionalDynamics';
  // activity-intake definition anchors and invariances (exact by construction of the mapping)
  if (/^R1-(V5-V10|V11|V12-V13)/.test(sc.id)) return 'verification';
  return 'developmentFit';
}

/** Tolerance type of one expectation (sign/order checks are 'direction'; otherwise the dossier's design band). */
export function toleranceOf(
  ex: Pick<Expectation, 'check' | 'source'>,
  sc: Pick<Scenario, 'citation'>,
): Tolerance {
  const dir = (c: Check) => c.kind === 'above' || c.kind === 'below';
  return { type: dir(ex.check) ? 'direction' : 'design', source: ex.source ?? sc.citation };
}

/** Endpoint operator of an expectation, from its label and unit (coarse; the measure function is the exact operator). */
export function endpointOf(ex: Pick<Expectation, 'label' | 'unit'>): string {
  const l = ex.label;
  if (/engine − BWP|engine − oracle|engine vs oracle|BWP /i.test(l)) return 'shared-input model difference';
  if (/urinary N|\bN on day|g N\b|nitrogen/i.test(`${l} ${ex.unit}`))
    return 'urinaryNitrogen (model prior, g N)';
  if (/DXA|FFM|LBM|lean[- ]mass/i.test(l)) return 'inferredNonFatScaleMass (scale − FM, DXA-like)';
  if (/lean[- ]tissue|lean change|lean gain|lean loss/i.test(l)) return 'modelLeanTissue';
  if (/IHTG|liver[- ]fat/i.test(l)) return 'liverFat (latent model, relative change)';
  if (/fat[- ]mass|\bFM\b|fat loss|fat change|fat gain|fat balance/i.test(l)) return 'modelFatMass';
  if (/weight|\bBW\b|ΔBW/i.test(l)) return 'scaleWake (morning scale weight)';
  if (/BHB|ketone/i.test(l)) return 'bhbHourlyMean';
  if (/glycogen/i.test(l)) return 'model glycogen';
  if (/LDL|HDL|TG\b|triglyceride|apoB|glucose|insulin|HbA1c|SBP|blood pressure/i.test(l))
    return 'model marker (relative or absolute change)';
  if (/EE\b|TEE|TDEE|REE|RMR|expenditure|AT\b/i.test(l)) return 'model expenditure';
  return 'model series';
}

/** Inputs of a scenario from its arm schedules and profiles: what the fixture prescribes, imputes or takes as observed. */
export function inputsOf(sc: Scenario, cls: EvidenceClass): LedgerEntry['inputs'] {
  const observed = new Set<string>();
  const protocol = new Set<string>();
  const imputed = new Set<string>();
  if (cls !== 'verification')
    imputed.add('participants: one representative person from published group means');
  for (const arm of Object.values(sc.arms)) {
    const sch: Schedule = arm.schedule;
    for (const p of sch.programs) {
      const k: string | undefined = p.energy?.kind;
      if (k === 'pctMaintenance')
        imputed.add('intake: % of the engine-modelled maintenance (baseline imputed by the engine)');
      else if (k === 'kcal') protocol.add('intake: absolute kcal/d');
      else if (k === 'zero') protocol.add('intake: zero-energy days');
      else if (k) protocol.add(`intake: ${k}`);
      if (p.steps !== undefined) imputed.add('activity: scheduled step count (not measured)');
      if (p.exercise?.length) protocol.add('exercise: prescribed sessions');
      if (p.habitualTraining) protocol.add('exercise: habitual sessions');
    }
    if (sch.events?.length) protocol.add('events: scheduled fasts/doses');
    const prof: PersonProfile = arm.profile;
    if (prof.body.knownBodyFatPct === undefined)
      imputed.add('body fat: estimated by the engine (no measured value)');
  }
  return { observed: [...observed], protocol: [...protocol], imputed: [...imputed] };
}

/** Population of a scenario from its arm profiles: sex, age and BMI ranges. */
export function populationOf(sc: Scenario): string {
  const ps: PersonProfile[] = Object.values(sc.arms).map((a) => a.profile);
  const sexes = [...new Set(ps.map((p) => p.body.sex))].sort();
  const ages = ps.map((p) => p.body.ageYears);
  const bmis = ps.map((p) => p.body.weightKg / (p.body.heightCm / 100) ** 2);
  const rng = (xs: number[], d = 0) => {
    const lo = Math.min(...xs).toFixed(d);
    const hi = Math.max(...xs).toFixed(d);
    return lo === hi ? lo : `${lo}-${hi}`;
  };
  const sex = sexes.length > 1 ? 'men and women' : sexes[0] === 'female' ? 'women' : 'men';
  return `adult ${sex}, ${rng(ages)} y, BMI ${rng(bmis)}`;
}

/** Coarse population group for counting: sex and age band. */
export function populationGroupOf(sc: Scenario): string {
  const ps: PersonProfile[] = Object.values(sc.arms).map((a) => a.profile);
  const sexes = new Set(ps.map((p) => p.body.sex));
  const older = ps.some((p) => p.body.ageYears >= 60);
  const sex = sexes.size > 1 ? 'mixed' : sexes.has('female') ? 'women' : 'men';
  return older ? `${sex}, ≥ 60 y` : `${sex}, < 60 y`;
}

/** Parameters whose cited source names one of the studies (registry provenance: the study influenced them). */
export function influencedParams(
  studies: readonly string[],
  defs: readonly Pick<ParamDef, 'id' | 'source'>[],
): string[] {
  const want = new Set(studies);
  const out: string[] = [];
  for (const d of defs) if (citedStudies(d.source).some((s) => want.has(s))) out.push(d.id);
  return out;
}

/** Documented overrides of the derived entries (protocol fidelity, observed inputs, notes). */
export const LEDGER_OVERRIDES: Readonly<
  Record<
    string,
    Partial<Pick<LedgerEntry, 'protocolFidelity' | 'note' | 'studies'>> & {
      observed?: readonly string[];
      imputed?: readonly string[];
      influenced?: readonly string[];
    }
  >
> = {
  '01-7.1-minnesota': {
    protocolFidelity: 'mismatched',
    influenced: ['ruling: adaptive NEAT owned by the energy module (no imposed activity fall)'],
    note: 'D1-08 mismatched-protocol challenge: relative cut on an unmatched baseline, scheduled instead of observed activity. Kept with its targets; not evidence about severe restriction in general.',
  },
  '01-7.1b-minnesota-matched': {
    protocolFidelity: 'matched',
    observed: ['activity: observed fall in voluntary activity (Hall 2006, δ 26 → 9 kcal/kg/d)'],
    imputed: [
      'activity: linear weekly time course of the fall, as steps (engine) and δ (Hall port)',
      'exercise: walking requirement as 7 × 60-min habitual walks',
      'baseline: steps solved so maintenance equals 3 630 kcal/d',
    ],
    note: 'D1-08 protocol-matched replay in the engine and the Hall 2011 port with identical inputs; non-gating.',
  },
  '01-7.4-calerie2': { observed: ['intake: measured group intake trajectory (DLW intake-balance method)'] },
};

/** Build the ledger of a scenario list (pure; `defs` = the parameter registry for the influence links). */
export function buildLedger(
  scenarios: readonly Scenario[],
  _defs: readonly Pick<ParamDef, 'id' | 'source'>[],
): LedgerEntry[] {
  return scenarios.map((sc) => {
    const curated = PROVENANCE[sc.id];
    const o = LEDGER_OVERRIDES[sc.id] ?? {};
    const provenance = Object.fromEntries(
      sc.expectations.flatMap((ex) => {
        const row = curated?.outcomes[ex.id];
        return row ? [[ex.id, structuredClone(row)]] : [];
      }),
    );
    const rows = Object.values(provenance);
    const evidenceClass = curated?.evidenceClass ?? 'developmentFit';
    const model = rows[0]?.model;
    const inputs = rows[0]?.inputs ?? {
      observed: [],
      protocol: [],
      imputed: ['provenance unknown: fixture has no curated input extraction'],
    };
    return {
      scenarioId: sc.id,
      provenance,
      studies: curated?.studies ?? [],
      arms: Object.keys(sc.arms),
      outcomes: sc.expectations.map((e) => e.id),
      evidenceClass,
      role: model?.role ?? (evidenceClass === 'developmentFit' ? 'calibration' : null),
      roleBasis: model?.roleBasis ?? 'migrationDefault',
      influenced: [...new Set(rows.flatMap((r) => r.model.influenced))],
      inputs,
      population: rows[0]?.scope.population ?? 'unknown',
      endpoints: Object.fromEntries(
        sc.expectations.map((ex) => [ex.id, provenance[ex.id]?.operator.estimand ?? 'unknown']),
      ),
      tolerances: Object.fromEntries(
        sc.expectations.map((ex) => [ex.id, provenance[ex.id]?.tolerance ?? toleranceOf(ex, sc)]),
      ),
      protocolFidelity: o.protocolFidelity ?? 'unknown',
      evaluations: model?.evaluations ?? [],
      influencedVersions: model?.influencedVersions ?? [],
      ...(o.note ? { note: o.note } : {}),
    };
  });
}

// ------------------------------------------------------------------ roles across model versions

/**
 * Role of a study entry for one model version (D8-03): a frozen external evaluation of exactly that version stays
 * external after it is read; a version tuned or selected on it is development (calibration); otherwise the entry's role.
 */
export function roleFor(
  entry: Pick<LedgerEntry, 'role' | 'evaluations' | 'influencedVersions'>,
  modelVersion: string,
): DatasetRole | null {
  if (entry.influencedVersions.includes(modelVersion)) return 'calibration';
  if (entry.evaluations.some((e) => e.modelVersion === modelVersion && e.extractedAfterFreeze))
    return 'externalEvaluation';
  if (entry.role === 'externalEvaluation')
    return entry.evaluations.length ? 'calibration' : 'externalEvaluation';
  return entry.role;
}

/** Evidence class of an entry for one model version (verification and conditional dynamics never change class). */
export function classFor(entry: LedgerEntry, modelVersion: string): EvidenceClass {
  if (entry.evidenceClass === 'verification' || entry.evidenceClass === 'conditionalDynamics')
    return entry.evidenceClass;
  return roleFor(entry, modelVersion) === 'externalEvaluation' ? 'externalEvaluation' : 'developmentFit';
}

// ------------------------------------------------------------------ registry checks

export interface LedgerIssue {
  scenarioId: string;
  kind:
    | 'missingEntry'
    | 'missingRole'
    | 'missingTolerance'
    | 'missingStudy'
    | 'missingInputs'
    | 'splitLeakage'
    | 'unfrozenEvaluation'
    | 'unknownOutcome'
    | 'missingUnit'
    | 'unknownProvenance'
    | 'provenanceMismatch';
  detail: string;
  /** Unknown extraction is reported without fabricating evidence; malformed mappings gate. */
  severity?: 'warning' | 'error';
}

/**
 * Registry checks (D8-03): every scenario has an entry; every outcome a typed, sourced tolerance and a unit; every study
 * entry a role, study ids and visible inputs; an external evaluation has a freeze recorded before extraction; and no study
 * appears both as development and as external evaluation for the same model version (study-level split leakage).
 */
export function validateLedger(
  entries: readonly LedgerEntry[],
  scenarios: readonly Scenario[],
  modelVersion: string,
): LedgerIssue[] {
  const issues: LedgerIssue[] = [];
  const byId = new Map(entries.map((e) => [e.scenarioId, e]));
  for (const sc of scenarios) {
    const e = byId.get(sc.id);
    if (!e) {
      issues.push({ scenarioId: sc.id, kind: 'missingEntry', detail: 'no ledger entry' });
      continue;
    }
    for (const ex of sc.expectations) {
      const p = e.provenance?.[ex.id];
      const canonical = PROVENANCE[sc.id]?.outcomes[ex.id];
      if (!p || p.status === 'unknown')
        issues.push({
          scenarioId: sc.id,
          kind: 'unknownProvenance',
          severity: 'warning',
          detail: `${ex.id}: ${p?.unknown.join('; ') || 'no curated outcome mapping'}`,
        });
      if (p) {
        const mismatches: string[] = [];
        if (p.operator.unit !== ex.unit) mismatches.push('unit');
        if (JSON.stringify(p.tolerance.check) !== JSON.stringify(ex.check))
          mismatches.push('numerical check');
        if (normaliseOperator(p.operator.expression) !== normaliseOperator(ex.measure.toString()))
          mismatches.push('operator expression/time');
        if (p.participatingArmIds.some((a) => !sc.arms[a])) mismatches.push('participating arm');
        for (const source of p.sources) {
          if (
            !e.studies.includes(source.cohortId) ||
            source.armIds.some((a) => !p.participatingArmIds.includes(a))
          )
            mismatches.push('source/cohort arm');
        }
        if (canonical && JSON.stringify(p) !== JSON.stringify(canonical))
          mismatches.push('canonical operator/unit/time/source-arm mapping');
        if (mismatches.length)
          issues.push({
            scenarioId: sc.id,
            kind: 'provenanceMismatch',
            detail: `${ex.id}: ${mismatches.join(', ')}`,
          });
      }
      const t = e.tolerances[ex.id];
      if (!t || !TOLERANCE_TYPES.includes(t.type) || !t.source.trim())
        issues.push({
          scenarioId: sc.id,
          kind: 'missingTolerance',
          detail: `${ex.id}: tolerance type/source missing`,
        });
      if (!ex.unit.trim())
        issues.push({ scenarioId: sc.id, kind: 'missingUnit', detail: `${ex.id}: no unit` });
    }
    for (const id of e.outcomes)
      if (!sc.expectations.some((x) => x.id === id))
        issues.push({ scenarioId: sc.id, kind: 'unknownOutcome', detail: `${id} is not an expectation` });
  }
  for (const e of entries) {
    if (!e.studies.length && !e.provenance)
      issues.push({ scenarioId: e.scenarioId, kind: 'missingStudy', detail: 'no study/cohort id' });
    if (
      (e.evidenceClass === 'developmentFit' || e.evidenceClass === 'externalEvaluation') &&
      roleFor(e, modelVersion) === null
    )
      issues.push({
        scenarioId: e.scenarioId,
        kind: 'missingRole',
        detail: 'study data without a dataset role',
      });
    if (
      e.evidenceClass !== 'verification' &&
      e.inputs.imputed.length + e.inputs.observed.length + e.inputs.protocol.length === 0
    )
      issues.push({ scenarioId: e.scenarioId, kind: 'missingInputs', detail: 'inputs not recorded' });
    for (const ev of e.evaluations)
      if (!ev.extractedAfterFreeze || !ev.freezeHash)
        issues.push({
          scenarioId: e.scenarioId,
          kind: 'unfrozenEvaluation',
          detail: `evaluation of ${ev.modelVersion} without a freeze before extraction`,
        });
  }
  const dev = new Map<string, string>();
  const ext = new Map<string, string>();
  for (const e of entries) {
    const c = classFor(e, modelVersion);
    for (const s of e.studies) {
      if (c === 'developmentFit') dev.set(s, e.scenarioId);
      if (c === 'externalEvaluation') ext.set(s, e.scenarioId);
    }
  }
  for (const [s, where] of ext)
    if (dev.has(s))
      issues.push({
        scenarioId: where,
        kind: 'splitLeakage',
        detail: `study ${s} is external here and development in ${dev.get(s)}`,
      });
  return issues;
}

/** Compare the checked expression independent of bundler import aliases or whitespace. */
export function normaliseOperator(expression: string): string {
  return expression
    .replace(/\(0,\s*__vite_ssr_import_\d+__\.([A-Za-z0-9_]+)\)/g, '$1')
    .replace(/__vite_ssr_import_\d+__\./g, '')
    .replace(/\s+/g, '');
}
