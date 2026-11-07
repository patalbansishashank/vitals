/**
 * Plain-word labels for the outcome-scoped metadata of a mechanism (`Mechanism.warrants`, `observations`, `modelStatus`
 * in `./schema.ts`), for the info/Explain sheet. Operating screens show at most the model-status word ("Exploratory",
 * "Not modelled"); warrants, observation types and population stay in the sheet.
 *
 * This module is the one source of these words: the Explain sheet, the library article and the metric reading guide
 * import them (and `warrantText` / `observationText`) instead of keeping their own tables.
 */
import type { Warrant, WarrantType } from '@/lib/bodyContracts';
import type { EvidenceObservation, Mechanism } from './schema';

/** The kind of reason a claim is believed (C6). A trial grade is one of them (`empiricalFormal`), never the only one. */
export const WARRANT_LABEL: Readonly<Record<WarrantType, string>> = {
  analyticallyTrue: 'Analytically true',
  firstPrinciples: 'First-principles derived',
  empiricalFormal: 'Empirical, formal studies',
  causallyCoherent: 'Causally coherent',
  physiologicallyIntuitive: 'Physiologically intuitive',
  ecologicallyValid: 'Ecologically valid',
  functionallyTrue: 'Functionally true',
  tacitKnowledge: 'Tacit knowledge',
  // the authority of experts, not a formal consensus process
  eminenceBased: 'Expert opinion',
  commonSense: 'Common sense',
  timeTested: 'Time-tested',
  livedExperience: 'Lived experience',
};

/**
 * What the supporting evidence actually observed, in lower case: it follows the tissue after a middle dot
 * ("blood cells (flux assay …) · human tissue flux", see `observationText`).
 */
export const OBSERVATION_TYPE_LABEL: Readonly<Record<EvidenceObservation['type'], string>> = {
  humanTissueFlux: 'human tissue flux',
  humanBloodMarker: 'human blood marker',
  humanOutcome: 'human outcome',
  animal: 'animal studies',
  cell: 'cell studies',
  modelDefinition: 'model definition',
};

export type MechanismModelStatus = NonNullable<Mechanism['modelStatus']>;

/** Short status word for how the engine uses a mechanism (an exploratory index reads "Exploratory", never a range). */
export const MODEL_STATUS_LABEL: Readonly<Record<MechanismModelStatus, string>> = {
  production: 'Modelled',
  exploratory: 'Exploratory',
  notModelled: 'Not modelled',
};

/** The status word of a mechanism, or null when it carries no model status. */
export function modelStatusLabel(m: Pick<Mechanism, 'modelStatus'>): string | null {
  return m.modelStatus ? MODEL_STATUS_LABEL[m.modelStatus] : null;
}

/** One warrant as a sheet row value: "Analytically true · high · direction only". */
export function warrantText(w: Warrant): string {
  return [WARRANT_LABEL[w.type] ?? w.type, w.confidence, w.scope].filter(Boolean).join(' · ');
}

/** One observation as a sheet row value: "whole blood (SIRT1 mRNA) · human blood marker". */
export function observationText(o: Pick<EvidenceObservation, 'tissue' | 'type'>): string {
  return `${o.tissue} · ${OBSERVATION_TYPE_LABEL[o.type] ?? o.type}`;
}

/**
 * Whether a mechanism has anything for the sheet's warrant block. A `production` status alone adds nothing (it is the
 * default reading), so it does not open an empty block.
 */
export function hasWarrantContent(
  m: Pick<Mechanism, 'warrants' | 'outcomeScope' | 'population' | 'observations' | 'modelStatus'>,
): boolean {
  return Boolean(
    m.warrants?.length ||
    m.outcomeScope ||
    m.population ||
    m.observations?.length ||
    (m.modelStatus && m.modelStatus !== 'production'),
  );
}
