/**
 * UI labels for the Autophagy Signal Index (08 §4.10 "Qualitative labels for UI") and the mandatory statement pointer.
 * The mandatory uncertainty statement itself is the `caveat` of the `autophagyIdx` series in `types/metrics.ts`
 * (W-U05); it must be shown whenever the ASI is charted or selected as a goal.
 */

export interface AsiBand {
  /** Lower edge (inclusive) of the band on the 0-100 index. */
  readonly from: number;
  readonly label: string;
}

/** 0-15 "fed - suppressed"; 15-30 "post-absorptive (baseline)"; 30-50 "extended/short fast"; 50-75 "prolonged fast"; 75-100 "multi-day fast". */
export const ASI_BANDS: readonly AsiBand[] = [
  { from: 0, label: 'fed — suppressed' },
  { from: 15, label: 'post-absorptive (baseline)' },
  { from: 30, label: 'extended/short fast' },
  { from: 50, label: 'prolonged fast' },
  { from: 75, label: 'multi-day fast' },
];

/** Qualitative label for an ASI value (relative model signal, not a measurement of autophagy). */
export function asiLabel(asi: number): string {
  let label = ASI_BANDS[0]!.label;
  for (let i = 1; i < ASI_BANDS.length; i++) if (asi >= ASI_BANDS[i]!.from) label = ASI_BANDS[i]!.label;
  return label;
}

/** Hours per week in the "prolonged-fast" zone (08 §6 `asiDeepHoursWeek`: hours with asi ≥ 50). */
export const ASI_DEEP_THRESHOLD = 50;
