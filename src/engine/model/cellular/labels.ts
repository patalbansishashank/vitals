/**
 * Display contract of the legacy Autophagy Signal Index (D2-02, contract C6).
 *
 * The ASI is a retained research index: a 0-100 definition of when conditions linked to autophagy are present (anchored
 * by construction at 25 after 12 h post-absorptive, 08 §4.10). It is not an autophagic-flux estimate in any tissue, not
 * a longevity or health amount, and not a goal: it earns no objective, benefit or comparison credit, and its parameter
 * draws carry no predictive coverage. Operating screens show its status word only; the mechanism, the unknown
 * organ-specific flux and the person's own fasting intent belong in the info sheet.
 */
import type { OutputStatus } from '@/lib/bodyContracts';

/** Inline status of the retained legacy index (C6 short status): the number itself is never shown as a health amount. */
export const ASI_DISPLAY_STATUS: Extract<OutputStatus, 'exploratory'> = 'exploratory';

/** What the legacy index is and is not, for adapters, exports and the info sheet (versioned research display). */
export const ASI_RESEARCH_INDEX = {
  /** Version of the index definition; bump when the formula or its anchors change. */
  version: 1,
  unit: 'index',
  range: [0, 100] as const,
  status: 'exploratory',
  /** No goal, objective, benefit edge or saved-target adoption (D2-02). */
  healthObjective: false,
  /** Autophagic flux is not estimated: no tissue, no rate, no percentage. */
  fluxEstimate: false,
  /** Parameter-draw spread is index sensitivity, never a calibrated predictive interval. */
  uncertaintyKind: 'parameterSensitivity',
  predictiveCoverage: false,
  /**
   * The 25-at-12-h anchor and the 08 §4.10 hour anchors are definitions the formula is built to reproduce: their tests
   * are code regressions, not empirical validation counts.
   */
  anchors: 'definitional',
} as const;

export interface AsiBand {
  /** Lower edge (inclusive) of the band on the 0-100 index. */
  readonly from: number;
  readonly label: string;
}

/**
 * 08 §4.10 legacy band names (0-15 "fed — suppressed" … 75-100 "multi-day fast"). Research display only, kept so
 * historical results reproduce; operating screens use `ASI_DISPLAY_STATUS` and never a stage-name badge.
 * @deprecated D2-02: legacy research display.
 */
export const ASI_BANDS: readonly AsiBand[] = [
  { from: 0, label: 'fed — suppressed' },
  { from: 15, label: 'post-absorptive (baseline)' },
  { from: 30, label: 'extended/short fast' },
  { from: 50, label: 'prolonged fast' },
  { from: 75, label: 'multi-day fast' },
];

/**
 * Legacy band name of an ASI value (relative model signal, not a measurement of autophagy).
 * @deprecated D2-02: legacy research display; use `ASI_DISPLAY_STATUS` on operating screens.
 */
export function asiLabel(asi: number): string {
  let label = ASI_BANDS[0]!.label;
  for (let i = 1; i < ASI_BANDS.length; i++) if (asi >= ASI_BANDS[i]!.from) label = ASI_BANDS[i]!.label;
  return label;
}
