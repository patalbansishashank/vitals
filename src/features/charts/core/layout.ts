/* ==========================================================================
   Chart layout by CONTAINER width (CHART_SPEC §4.7), so the same chart works
   docked beside a picker, full width, or on a phone.
   ========================================================================== */
export type LayoutSize = 's' | 'm' | 'l';

export interface StackLayout {
  size: LayoutSize;
  width: number;
  /** Lane label gutter (0 on small screens: labels sit above the plot). */
  gutter: number;
  /**
   * Y-tick column inside the plot (the plot's left padding): wide enough for the widest tick label measured across
   * the stack (`useAxisGutter`) plus an outer inset, never narrower than `tickBase`.
   */
  tickCol: number;
  /** The minimum tick column, and the width class the tick labels are formatted for (thousands compact below 40). */
  tickBase: number;
  rightPad: number;
  laneH: number;
  inputsH: number;
  focusH: number;
  stripH: number;
  /** Overlay end-label column. */
  labelCol: number;
  /** Plot cell width (canvas width) = width − gutter. */
  cellW: number;
  /** Left of the data area relative to the chart body. */
  plotLeft: number;
  plotW: number;
}

/**
 * Space left of the widest tick label (CSS px). Phones: the plot starts at the card's edge, so the labels keep the
 * lane titles' 12 px inset; wider layouts: the plot starts after the label gutter's hairline.
 */
export const AXIS_INSET = { s: 12, m: 6, l: 6 } as const;

/**
 * `axisCss`: the widest tick label's column (`yAxisWidth`: label, gap, tick, spine), measured across every lane that
 * shares the time axis, so all plots start at the same x and no label is cut at the card's edge.
 */
export function stackLayout(width: number, axisCss = 0): StackLayout {
  const w = Math.max(240, Math.round(width));
  const size: LayoutSize = w < 768 ? 's' : w < 1024 ? 'm' : 'l';
  const gutter = size === 's' ? 0 : size === 'm' ? 150 : 168;
  const tickBase = w < 500 ? 26 : 32;
  const tickCol = axisCss > 0 ? Math.max(tickBase, Math.ceil(axisCss + AXIS_INSET[size])) : tickBase;
  const rightPad = 8;
  const cellW = w - gutter;
  return {
    size,
    width: w,
    gutter,
    tickCol,
    tickBase,
    rightPad,
    laneH: size === 's' ? 64 : 72,
    inputsH: size === 's' ? 60 : 72,
    focusH: size === 's' ? 220 : size === 'm' ? 260 : 280,
    stripH: 26,
    // phones: the value only (r068 W2-3); wider: value and name
    labelCol: size === 's' ? 72 : 176,
    cellW,
    plotLeft: gutter + tickCol,
    plotW: Math.max(40, cellW - tickCol - rightPad),
  };
}
