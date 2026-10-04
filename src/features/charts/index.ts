/* ==========================================================================
   Public API of the chart module. Import from '@/features/charts'.
   ========================================================================== */
import './charts.css';

export type * from './types';

/* views */
export { ChartFrame } from './components/ChartFrame';
export type { ChartFrameProps, ChartView } from './components/ChartFrame';
export { LaneStack } from './components/LaneStack';
export type { LaneStackProps, ChartStatus } from './components/LaneStack';
export { OverlayView } from './components/OverlayView';
export type { OverlayViewProps } from './components/OverlayView';
export { FocusView } from './components/FocusView';
export type { FocusViewProps } from './components/FocusView';
export { CompareView } from './components/CompareView';
export type { CompareViewProps } from './components/CompareView';
export { DayView, ClockDial, fastOfDay } from './components/DayView';
export type { DayViewProps, ClockDialProps } from './components/DayView';
export { TdeeStack } from './components/TdeeStack';
export type { TdeeStackProps } from './components/TdeeStack';
export { WeightDecomposition, weeklyDeltas } from './components/WeightDecomposition';
export type { WeightDecompositionProps } from './components/WeightDecomposition';
export { ConvergenceChart } from './components/ConvergenceChart';
export type { ConvergenceChartProps } from './components/ConvergenceChart';
export { PreviewStrip } from './components/PreviewStrip';
export type { PreviewStripProps } from './components/PreviewStrip';
export { DataTable } from './components/DataTable';
export type { DataTableProps } from './components/DataTable';
export { LegendChip, KeyGlyph } from './components/LegendChip';

/* state */
export { ChartController } from './core/controller';
export type { ControllerOptions, CursorState, ViewState } from './core/controller';
export { useChartController, useChartTheme } from './core/hooks';
export { readChartTheme } from './core/theme';
export type { ChartTheme } from './core/theme';

/* data */
export { adaptResult, toChartSeries } from './adapt';
export type { AdaptOptions, EngineLikeResult, EngineMetricMeta } from './adapt';
export { CATEGORY_ORDER, CATEGORY_LABEL, MACRO_ORDER, OVERLAY_MAX } from './catalogue';
export { DEFAULT_LANE_IDS, pickerGroups, toggleMetric, matchesQuery, capacityText, isOverlayEligible } from './lib/picker';
export type { PickerGroup, PickerItem, PickerMode, PickerFilter, ToggleResult } from './lib/picker';
export { buildTable, tableToCSV } from './lib/table';
export type { TableOptions } from './lib/table';
export { laneSummary } from './lib/summary';
export { zoomReducer, initialZoom } from './lib/zoom';
export type { ZoomAction, ZoomState, ZoomPreset } from './lib/zoom';
/* reading values at a moment (Explain drawer, summaries) */
export { valueAt } from './lib/series';
export { describeSample } from './lib/time';
export { formatRange as formatValueRange } from './lib/format';

/* living mode (CHART_SPEC §7.8–7.10) */
export type * from './living/types';
export { TrendLane } from './living/TrendLane';
export type { TrendLaneProps } from './living/TrendLane';
export { AdherenceCalendar, calendarWeeks, calendarDayLabel } from './living/AdherenceCalendar';
export type { AdherenceCalendarProps, CalendarCell, CalendarCellState } from './living/AdherenceCalendar';
export { BlockBars, blockValueText } from './living/BlockBars';
export type { BlockBarsProps } from './living/BlockBars';
export { ScoreHistory } from './living/ScoreHistory';
export type { ScoreHistoryProps } from './living/ScoreHistory';
export { AdherenceDial } from './living/AdherenceDial';
export type { AdherenceDialProps, DialSize } from './living/AdherenceDial';
export { dialArcs, dialSentence } from './living/adherenceGeometry';
export type { DialArc } from './living/adherenceGeometry';
export { trendSummary, trendReadoutText, trendTableRows, trendToChartData, trendDomain, trendLayout, quietScoreWord, scoreSummary, scoreTableRows } from './living/trend';
export type { TrendSize, TrendTableRow, TrendDomain, ScoreTableRow } from './living/trend';
