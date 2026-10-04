/**
 * Evidence library — public API for other features.
 *
 *   import { ExplainDrawer, useMechanism, useEvidenceSearch, GradeLegend } from '@/features/evidence';
 *
 * - `<ExplainDrawer open onClose mechanismIds | metricId returnTo reading? drivers? />` — "explain this curve":
 *   the value at the crosshair with its likely range and what drives it there (when the caller passes them),
 *   then the mechanisms, most defining first (`orderForMetric`), each with a compact summary, how it is modelled,
 *   grade + reason, top key numbers, caveats and "Open in Evidence" (bottom sheet < 1024 px, side panel above).
 * - `useMechanism(id)` → `{ status, mechanism, topic, retry }`; `useMechanisms(ids)` for several.
 * - `useEvidenceSearch(query, filters, { debounceMs })` → progressive results over mechanisms,
 *   common claims and metrics, with facet counts.
 * - `<GradeLegend />` — what grades A–D (and mechanism status) mean.
 * - `metricLabel(id)` / `metricInfo(id)` — the metric adapter (engine catalogue, id fallback).
 * - `mechanismHref(id, section?)`, `topicHref(slug)` — links into the library.
 * - `<SourceRefLinks refs={[{ topic: 'safety-limits', refs: [6, 7] }]} />` — evidence cited by topic and source number,
 *   linked into the library ("Safety limits › references 6, 7"). The only way a `SourceRef` is rendered; the plain
 *   text form is `sourceRefLabel` in `@/content/evidence/sources`.
 */
export { ExplainDrawer } from './ExplainDrawer';
export type { ExplainDrawerProps, ExplainDriver, ExplainReading } from './ExplainDrawer';
export { LEADING_MECHANISMS, orderForMetric } from './explainOrder';
export { GradeLegend } from './GradeLegend';
export type { GradeLegendProps } from './GradeLegend';
export {
  EvidenceRepositoryContext,
  useDebouncedValue,
  useEvidenceRepository,
  useEvidenceSearch,
  useEvidenceStatus,
  useMechanism,
  useMechanisms,
  useTopic,
} from './hooks';
export type {
  EvidenceSearchOptions,
  EvidenceSearchState,
  LoadStatus,
  MechanismState,
  MechanismsState,
  TopicState,
} from './hooks';
export { EvidenceRepository, evidenceRepository } from './data/repository';
export type { ResolvedMechanism } from './data/repository';
export { EMPTY_FILTERS } from './data/filters';
export type { EvidenceFilters } from './data/filters';
export {
  idToLabel,
  metricGoalHref,
  metricInfo,
  metricLabel,
  metricResultsHref,
  outcomeMetrics,
} from './metricLabels';
export type { MetricInfo } from './metricLabels';
export { ARTICLE_SECTIONS, mechanismHref, topicHref, topicRefAnchor } from './links';
export type { ArticleSection, EvidenceNavState } from './links';
export { SourceRefLinks } from './components/SourceRefLinks';
export type { SourceRefLinksProps } from './components/SourceRefLinks';
