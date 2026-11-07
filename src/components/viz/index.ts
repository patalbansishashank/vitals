/**
 * Shared viz modules (SPEC A.3.2, DATAVIZ P1–P11). Props in, no fetching, no store reads, no features imports. Each module
 * exports the component, its pure model function and its spoken*() sentence. Import from '@/components'.
 */
export { TickStrip, tickModel, tickDomain, tickCount, goalLabel, spokenTick, TICK_MIN, TICK_MAX, TICK_PITCH } from './TickStrip';
export type { TickStripProps, TickStripState, TickGoalKind, TickModel, TickMark } from './TickStrip';
export { DotFill, dotModel, dotColumns, dotQuietWord, spokenDots, DOT_ROWS, DOT_PITCH, DOT_COLS_MIN, DOT_COLS_MAX } from './DotFill';
export type { DotFillProps, DotFillState, DotModel } from './DotFill';
export { Stat, StatGroup, StatChipView, chipText, spokenStat } from './Stat';
export type { StatProps, StatGroupProps, StatChip, StatState } from './Stat';
export { OvernightTrace, traceSmooth, traceModel, traceRuns, traceTicks, medianStep, magnitudeText, trendPhrase, spokenTrace, DOTS_AT_MOST } from './OvernightTrace';
export type { OvernightTraceProps, OvernightTraceState, TracePoint, TrendWord, TrendMagnitude, TraceModel } from './OvernightTrace';
export { StateStrip, stateTimeline, stateSegments, segmentText, spokenStrip, rampStep, MIN_SEG_PX, SEG_GAP_PX, MAX_STATES } from './StateStrip';
export type { StateStripProps, StateSegment, DrawnSegment } from './StateStrip';
export { Hypnogram, hypnoRuns, spokenHypnogram, rawStageWord, sessionsWindow, HYPNO_STAGES } from './Hypnogram';
export type { HypnogramProps, HypnogramSession } from './Hypnogram';
export { smoothStages, stageTimeline as rawStageTimeline, stageTotals, smoothSeries, smoothingFor, smoothExtremes, displayDomain, medianSpacing, monotonePath, bandPath, dataKey, STAGE_SMOOTHING } from './smooth';
export type { RawStageSpan, StageSpan, StageSmoothing, SeriesPoint, SmoothPoint, SeriesSmoothing } from './smooth';
export { ShareBar, shareText, spokenShare } from './ShareBar';
export type { ShareBarProps, ShareBarRow } from './ShareBar';
export { LevelBar, levelCell, cellOfUnit, personalKnot, usualPhrase, spokenLevel, LEVEL_KNOTS, LEVEL_KNOTS_10 } from './LevelBar';
export type { LevelBarProps, LevelColumns, LevelState, Knot } from './LevelBar';
export { ArcRuler, arcTicks, arcWord, bandOf, spokenArc, bezier, NEEDLE_MS } from './ArcRuler';
export type { ArcRulerProps, ArcRulerState, ArcBand, ArcTick } from './ArcRuler';
export { DayDisc, litDots, arcDots, arcWeights, spokenDisc, DISC_DOTS, DISC_R } from './DayDisc';
export type { DayDiscProps, DayArc, DayArcId } from './DayDisc';
export { MonitorSheet, moveId, removeId, addId, monitorCapacity, movedText } from './MonitorSheet';
export type { MonitorSheetProps, MonitorItem } from './MonitorSheet';
export { ReadingAge, LearningLine, learningText } from './marks';
export type { ReadingAgeProps, LearningLineProps } from './marks';
export { TwinTable as VizTwinTable, TwinKey, downloadText, toCSV } from './TwinTable';
export type { TwinTableProps as VizTwinTableProps } from './TwinTable';
export { polar, arcPath, tidyCeil, niceStep as vizNiceStep, interpolate, speak, durationText, clockText } from './geometry';
export { ChartTwin, InlineTwin, twinCsv, twinFileName } from './twin';
export type { TwinData } from './twin';
/* r071 foundation 0B: the new pictures. Each has its pure model, its spoken sentence and its Table twin. */
export { RadialTicks, radialModel, spokenRadial, radialTwin, radialPx, radialCount, quietNeeds, RADIAL_SIZES } from './RadialTicks';
export type { RadialTicksProps, RadialPart, RadialModel, RadialSize, RadialState, RadialGoalKind } from './RadialTicks';
export { DottedTrack, trackModel, trackColumns, spokenTrack, trackTwin, TRACK_PITCH, TRACK_DOT_R, TRACK_H, TRACK_LAP_R, TRACK_THUMB } from './DottedTrack';
export type { DottedTrackProps, TrackMark, TrackModel, TrackState, TrackGoalKind } from './DottedTrack';
export { HighlightBars, barsModel, spokenBars, spokenBar, barsTwin, barDate } from './HighlightBars';
export type { HighlightBarsProps, BarStack, BarModel, BarsModel } from './HighlightBars';
export { GlowLine, lineModel, linePoints, lineTicks, lineXTicks, spokenLine, lineTwin, PULSE_CYCLES } from './GlowLine';
export type { GlowLineProps, LinePoint, LineSpan, LineMark, LineBand, LineState, LineModel, LineHover } from './GlowLine';
export { RangeScale, scaleModel, bandAt, spokenRange, rangeTwin } from './RangeScale';
export type { RangeScaleProps, RangeBand, RangeSeverity, RangeState, ScaleModel, ScaleTick } from './RangeScale';
export { StackBar, stackModel, shareWord, spokenStack, stackTwin } from './StackBar';
export type { StackBarProps, StackSegment, StackModel } from './StackBar';
export { WindowBar, windowModel, windowTicks, windowMarkLayout, spokenWindow, windowTwin } from './WindowBar';
export type { WindowBarProps, TimeWindow, WindowMark, WindowModel, MarkPlace } from './WindowBar';
export { areaPath, smoothPreset, SMOOTH_PRESETS } from './smooth';
export type { SmoothPreset } from './smooth';
export { tickRing, quietStep, ratioWord, goalPhrase, reachedPhrase } from './geometry';
export type { GoalKind, RingTick } from './geometry';
