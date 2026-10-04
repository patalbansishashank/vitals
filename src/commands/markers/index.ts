/**
 * Blood markers (E20, SUITE_SPEC §13.5.6): the `markers.*` commands, their ports and the pending extractions.
 * Importing this module registers the definitions (`@/commands` imports it after `./defs/*`).
 */
import './defs';

export { markersConfirm, markersGet, markersImport, markersRemove, markersSet } from './defs';
export { clearPendingExtractions, pendingExtraction } from './pending';
export { labRangeOf, setMarkerExtractor, sniffMime, type ExtractDeps, type ExtractFn, type MarkerVisionPort } from './ports';
export { labMetric, markersView, ruleContext } from './view';
