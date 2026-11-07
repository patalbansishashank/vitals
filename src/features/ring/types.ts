/**
 * The Gauge read API's types, from the client (`src/net/gauge.ts`). The few aliases under it are names the Ring
 * screens use for parts of those types.
 */
import type { GaugeApi, GaugeDailySummary, GaugeDayMetric, GaugeDeviceState, GaugeScore, GaugeV2Api } from '@/net/gauge';

export type {
  GaugeActivity,
  GaugeActivityDay,
  GaugeApi,
  GaugeAvailability,
  GaugeBucket,
  GaugeBucketPoint,
  GaugeCallOptions,
  GaugeDailySummary,
  GaugeDayMetric,
  GaugeDeviceState,
  GaugeProblem,
  GaugeProvenance,
  GaugeRawPoint,
  GaugeScore,
  GaugeScores,
  GaugeSeries,
  GaugeSeriesQuery,
  GaugeShortVideo,
  GaugeShortVideoAverage,
  GaugeShortVideoDay,
  GaugeSleep,
  GaugeSleepSession,
  GaugeSleepStage,
  GaugeStats,
  GaugeStatus,
  GaugeWorkout,
  GaugeWorkouts,
  GaugeV2Api,
  GaugeBaselines,
  GaugeClockBaseline,
  GaugeDayDerived,
  GaugeNullReason,
  GaugeSleepMetrics,
  GaugeStepDay,
  GaugeSteps,
  GaugeTimeline,
} from '@/net/gauge';

/**
 * The client the Ring screens read: the §2.2 read API plus S2's routes (SPEC §2.2, A.1.1). The S2 routes are optional so
 * an older client or a test fake without them still works: a screen then shows what the older routes carry.
 */
export type RingApi = GaugeApi & Partial<GaugeV2Api>;

/** `gauge_daily_summary` (the screens' short name). */
export type GaugeDaily = GaugeDailySummary;
export type GaugeScoreEntry = GaugeScore;
export type GaugeDevice = GaugeDeviceState['devices'][number];
/** One reported state of a device (`state/<x>`): its payload fields plus the event type and time. */
export type GaugeStateEntry = GaugeDevice['state'][string];

/** A day metric of one value (everything but blood pressure). */
export type GaugeValueMetric = Extract<GaugeDayMetric, { mean: number | null }>;
/** The blood-pressure day metric. */
export type GaugeBpMetric = Extract<GaugeDayMetric, { meanSystolic: number | null }>;

export const isBpMetric = (m: GaugeDayMetric): m is GaugeBpMetric => 'meanSystolic' in m;
