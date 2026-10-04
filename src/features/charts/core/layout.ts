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
  /** Y-tick column inside the plot. */
  tickCol: number;
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

export function stackLayout(width: number): StackLayout {
  const w = Math.max(240, Math.round(width));
  const size: LayoutSize = w < 768 ? 's' : w < 1024 ? 'm' : 'l';
  const gutter = size === 's' ? 0 : size === 'm' ? 150 : 168;
  const tickCol = w < 500 ? 26 : 32;
  const rightPad = 8;
  const cellW = w - gutter;
  return {
    size,
    width: w,
    gutter,
    tickCol,
    rightPad,
    laneH: size === 's' ? 64 : 72,
    inputsH: size === 's' ? 60 : 72,
    focusH: size === 's' ? 220 : size === 'm' ? 260 : 280,
    stripH: 26,
    labelCol: size === 's' ? 96 : 176,
    cellW,
    plotLeft: gutter + tickCol,
    plotW: Math.max(40, cellW - tickCol - rightPad),
  };
}
