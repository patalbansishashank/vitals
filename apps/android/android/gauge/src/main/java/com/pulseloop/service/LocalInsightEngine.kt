package com.pulseloop.service

import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.ActivitySessionEntity
import com.pulseloop.data.entity.UserGoalEntity
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.PulseEventBus
import com.pulseloop.util.TimeUtil
import java.time.Instant
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.math.sqrt

data class InsightResult(
    val value: Double,
    val confidence: String,
    val inputs: Map<String, Double>,
    val note: String,
    val contributors: List<ScoreContributor> = emptyList(),
)

/** Pure, versioned formulas. They describe wellness estimates, never diagnoses. */
object InsightAlgorithms {
    const val SLEEP_VERSION = DailySleepScoreAlgorithm.VERSION
    const val ACTIVITY_VERSION = "lumen-activity-v3"
    // v5: the prior-day nutrition component (0.10 in v4) is gone with the Nutrition feature
    // (Vitals owns food); the remaining weights are renormalised to sum to 1 ([RECOVERY_WEIGHTS]).
    const val RECOVERY_VERSION = "lumen-recovery-v5"

    /**
     * Recovery v5 configured weights: v4's 0.25 / 0.15 / 0.30 / 0.10 / 0.10 with the nutrition
     * 0.10 removed, rescaled by 1 / 0.90 so they sum to 1. A score still renormalises over the
     * components that are present, so the rescale changes the reported weights, not the ratios.
     */
    val RECOVERY_WEIGHTS: Map<String, Double> = linkedMapOf(
        "hrv" to 0.25, "resting_hr" to 0.15, "sleep" to 0.30,
        "temperature" to 0.10, "prior_day_load" to 0.10,
    ).let { raw -> val total = raw.values.sum(); raw.mapValues { it.value / total } }
    const val WORKOUT_VERSION = "pulseloop-trimp-v1"
    const val WORKOUT_LOAD_VERSION = "lumen-training-load-v2"
    const val VO2_VERSION = "lumen-submax-vo2-reserve-v2"
    const val ROCKPORT_VO2_VERSION = "lumen-rockport-confirmed-v2"
    const val HRV_TREND_VERSION = "lumen-log-hrv-week-v2"
    const val STRESS_VERSION = "lumen-autonomic-load-v1"

    fun activityScore(
        steps: Int,
        activeMinutes: Int,
        workoutMinutes: Double,
        stepGoal: Int,
        activeMinuteGoal: Int,
    ): InsightResult {
        val stepRatio = ratio(steps.toDouble(), stepGoal.toDouble())
        val activeRatio = ratio(activeMinutes.toDouble(), activeMinuteGoal.toDouble())
        val workoutRatio = ratio(workoutMinutes, 30.0)
        val score = (40 * stepRatio + 35 * activeRatio + 25 * workoutRatio).coerceIn(0.0, 100.0)
        return InsightResult(
            score,
            confidence = if (activeMinutes > 0 || workoutMinutes > 0) "medium" else "low",
            inputs = linkedMapOf(
                "steps" to steps.toDouble(),
                "step_goal" to stepGoal.toDouble(),
                "active_minutes" to activeMinutes.toDouble(),
                "active_minute_goal" to activeMinuteGoal.toDouble(),
                "workout_minutes" to workoutMinutes.takeIf { it.isFinite() && it >= 0.0 }.orZero(),
            ),
            note = "Goal-relative activity composite; not a clinical fitness score.",
            contributors = listOf(
                ScoreContributor("steps", "Steps", steps.toDouble(), "steps", stepRatio * 100, 0.40, 0.40,
                    "Progress toward the daily step goal.", ScoreContributorRole.SCORED),
                ScoreContributor("active_minutes", "Active minutes", activeMinutes.toDouble(), "min", activeRatio * 100, 0.35, 0.35,
                    "Progress toward the daily active-minute goal.", ScoreContributorRole.SCORED),
                ScoreContributor("workout_minutes", "Workout time", workoutMinutes, "min", workoutRatio * 100, 0.25, 0.25,
                    "Up to 30 minutes contributes to this daily activity index.", ScoreContributorRole.SCORED),
            ),
        )
    }

    /** Natural-log RMSSD for within-device longitudinal trends (RMSSD must be positive). */
    fun lnRmssd(rmssdMillis: Double): Double? =
        rmssdMillis.takeIf { it.isFinite() && it > 0.0 }?.let(::ln)

    /** Caller supplies one comparable resting/nightly median per day, latest seven days first
     * argument and a non-overlapping earlier baseline second. A ring HRV summary is not assumed
     * to be independently verified RMSSD. Log transformation limits extreme-value influence. */
    fun hrvTrend(recentNightlyValues: List<Double>, baselineNightlyValues: List<Double>): InsightResult? {
        val recent = recentNightlyValues.filter { it.isFinite() && it in 1.0..300.0 }.map(::ln)
        val prior = baselineNightlyValues.filter { it.isFinite() && it in 1.0..300.0 }.map(::ln).sorted()
        if (recent.size < 3 || prior.size < 7) return null
        val center = quantile(prior, 0.5)
        val scale = ((quantile(prior, 0.75) - quantile(prior, 0.25)) / 1.349).coerceAtLeast(0.10)
        val current = recent.average()
        val z = ((current - center) / scale).coerceIn(-3.0, 3.0)
        val balance = logistic(z)
        val relativeChangePercent = 100.0 * (exp(current - center) - 1.0)
        return InsightResult(balance, if (recent.size >= 5 && prior.size >= 14) "medium" else "low",
            linkedMapOf("recent_log_hrv" to current, "baseline_log_hrv" to center,
                "recent_days" to recent.size.toDouble(), "baseline_days" to prior.size.toDouble(),
                "relative_change_percent" to relativeChangePercent, "hrv_z" to z),
            "Weekly within-device HRV balance: 50 is the personal baseline; higher is higher HRV, not necessarily better recovery. Requires comparable nightly summaries.",
            contributors = listOf(
                ScoreContributor(
                    id = "hrv_balance_index",
                    label = "HRV balance index",
                    value = balance,
                    unit = "score",
                    score = balance,
                    weight = 1.0,
                    configuredWeight = 1.0,
                    explanation = "The existing normalized within-device HRV index; 50 is the personal baseline.",
                    role = ScoreContributorRole.SCORED,
                ),
                ScoreContributor(
                    id = "recent_log_hrv",
                    label = "Recent nightly log HRV",
                    value = current,
                    unit = "ln(ms)",
                    explanation = "Mean log-transformed HRV across ${recent.size} recent comparable nights.",
                    role = ScoreContributorRole.CONTEXT,
                ),
                ScoreContributor(
                    id = "baseline_log_hrv",
                    label = "Prior nightly baseline",
                    value = center,
                    unit = "ln(ms)",
                    explanation = "Median log-transformed HRV across ${prior.size} earlier comparable nights.",
                    role = ScoreContributorRole.CONTEXT,
                ),
                ScoreContributor(
                    id = "relative_change_percent",
                    label = "Relative HRV change",
                    value = relativeChangePercent,
                    unit = "%",
                    explanation = "Recent nightly HRV relative to the prior personal baseline.",
                    role = ScoreContributorRole.CONTEXT,
                ),
            ))
    }

    /** Robust location/scale with practical floors so a quantized, flat baseline cannot turn a
     * one-unit change into an extreme score. Baselines here contain one value per night. */
    fun personalDeviation(value: Double?, baseline: BaselineStats?, minimumScale: Double): Double? {
        if (value == null || !value.isFinite() || baseline == null ||
            baseline.sampleCount < 7 || baseline.spanDays < 6 || !baseline.median.isFinite() ||
            !baseline.p25.isFinite() || !baseline.p75.isFinite() || minimumScale <= 0) return null
        val scale = ((baseline.p75 - baseline.p25) / 1.349).coerceAtLeast(minimumScale)
        return ((value - baseline.median) / scale).coerceIn(-3.0, 3.0)
    }

    /** Resting autonomic load only; callers must exclude exercise and use matched windows. */
    fun stressScore(hrv: Double?, hrvBaseline: BaselineStats?, restingHr: Double?, restingHrBaseline: BaselineStats?): InsightResult? {
        val hrvZ = personalDeviation(hrv?.takeIf { it in 1.0..300.0 }, hrvBaseline,
            ((hrvBaseline?.median ?: 50.0) * 0.10).coerceAtLeast(3.0))
        val hrZ = personalDeviation(restingHr?.takeIf { it in 30.0..220.0 }, restingHrBaseline, 3.0)
        if (hrvZ == null || hrZ == null) return null
        return InsightResult(logistic(-0.6 * hrvZ + 0.4 * hrZ), "low",
            linkedMapOf("hrv_z" to hrvZ, "resting_hr_z" to hrZ),
            "Personal resting autonomic-load index; 50 is usual. Not a measurement of psychological stress; temperature, illness, exercise and alcohol can also change it.",
            listOf(
                ScoreContributor("hrv", "Heart rate variability", hrv, "ms", logistic(-hrvZ), 0.60, 0.60,
                    "Lower-than-usual HRV increases resting load.", ScoreContributorRole.SCORED),
                ScoreContributor("resting_hr", "Resting heart rate", restingHr, "bpm", logistic(-hrZ), 0.40, 0.40,
                    "Higher-than-usual resting heart rate increases resting load.", ScoreContributorRole.SCORED),
            ))
    }

    fun recoveryScore(
        hrv: Double?,
        hrvBaseline: BaselineStats?,
        restingHr: Double?,
        restingHrBaseline: BaselineStats?,
        sleepScore: Double?,
        skinTemperature: Double?,
        temperatureBaseline: BaselineStats?,
        priorDayLoadBalanceScore: Double? = null,
    ): InsightResult? {
        data class Component(val name: String, val score: Double, val weight: Double)
        val components = mutableListOf<Component>()
        val inputs = linkedMapOf<String, Double>()

        val hrvZ = personalDeviation(hrv?.takeIf { it in 1.0..300.0 }, hrvBaseline,
            ((hrvBaseline?.median ?: 50.0) * 0.10).coerceAtLeast(3.0))
        if (hrvZ != null && hrv != null && hrvBaseline != null) {
            val z = hrvZ
            components += Component("hrv", logistic(z.coerceAtMost(1.0)), RECOVERY_WEIGHTS.getValue("hrv"))
            inputs["hrv"] = hrv
            inputs["hrv_baseline"] = hrvBaseline.median
            inputs["hrv_z"] = z
        }
        val hrZ = personalDeviation(restingHr?.takeIf { it in 30.0..220.0 }, restingHrBaseline, 3.0)
        if (hrZ != null && restingHr != null && restingHrBaseline != null) {
            val z = -hrZ
            components += Component("resting_hr", logistic(z), RECOVERY_WEIGHTS.getValue("resting_hr"))
            inputs["resting_hr"] = restingHr
            inputs["resting_hr_baseline"] = restingHrBaseline.median
            inputs["resting_hr_z"] = z
        }
        if (sleepScore != null && sleepScore.isFinite()) {
            components += Component("sleep", sleepScore.coerceIn(0.0, 100.0), RECOVERY_WEIGHTS.getValue("sleep"))
            inputs["sleep_score"] = sleepScore
        }
        val tempZ = personalDeviation(skinTemperature?.takeIf { it in 20.0..45.0 }, temperatureBaseline, 0.5)
        if (tempZ != null && skinTemperature != null && temperatureBaseline != null) {
            val delta = skinTemperature - temperatureBaseline.median
            val score = 100.0 * exp(-0.5 * tempZ * tempZ)
            components += Component("temperature", score, RECOVERY_WEIGHTS.getValue("temperature"))
            inputs["skin_temperature_c"] = skinTemperature
            inputs["temperature_baseline_c"] = temperatureBaseline.median
            inputs["temperature_delta_c"] = delta
        }
        priorDayLoadBalanceScore?.takeIf { it.isFinite() }?.let {
            components += Component("prior_day_load", it.coerceIn(0.0, 100.0), RECOVERY_WEIGHTS.getValue("prior_day_load"))
            inputs["prior_day_load_balance_score"] = it.coerceIn(0.0, 100.0)
        }

        // A sleep score by itself is just sleep under another name. Require a second independent
        // component before emitting a recovery number.
        if (components.size < 2) return null
        val weight = components.sumOf { it.weight }
        val score = components.sumOf { it.score * it.weight } / weight
        val establishedPhysiology = components.count { it.name == "hrv" || it.name == "resting_hr" }
        val confidence = when {
            components.size >= 3 && establishedPhysiology >= 1 -> "medium"
            else -> "low"
        }
        val specs = RECOVERY_WEIGHTS
        val appliedContributors = specs.map { (id, configured) ->
            val component = components.firstOrNull { it.name == id }
            val raw = when (id) {
                "hrv" -> hrv to "ms"
                "resting_hr" -> restingHr to "bpm"
                "sleep" -> sleepScore to "score"
                "temperature" -> inputs["temperature_delta_c"] to "delta_degC"
                "prior_day_load" -> priorDayLoadBalanceScore to "score"
                else -> null to null
            }
            ScoreContributor(
                id = id,
                label = when (id) {
                    "hrv" -> "Heart rate variability"
                    "resting_hr" -> "Resting heart rate"
                    "sleep" -> "Sleep"
                    "temperature" -> "Temperature deviation"
                    "prior_day_load" -> "Prior-day load"
                    else -> id
                },
                value = raw.first,
                unit = raw.second,
                score = component?.score,
                weight = component?.weight?.div(weight) ?: 0.0,
                configuredWeight = configured,
                explanation = when (id) {
                    "prior_day_load" -> "Prior-day activity load relative to its personal baseline."
                    else -> "Personal-baseline recovery input."
                },
                role = if (component == null) ScoreContributorRole.UNAVAILABLE else ScoreContributorRole.SCORED,
            )
        }
        return InsightResult(
            value = score.coerceIn(0.0, 100.0),
            confidence = confidence,
            inputs = inputs,
            note = "Personal-baseline recovery composite. Missing inputs are omitted and available weights renormalized. Autonomic load is not added separately because it reuses HRV and resting HR. Weights and 0–100 mapping are on-device heuristics, not a clinically validated recovery measure.",
            contributors = appliedContributors,
        )
    }

    fun workoutScore(
        durationMinutes: Double,
        averageHeartRate: Double,
        restingHeartRate: Double,
        maximumHeartRate: Double,
        female: Boolean?,
    ): InsightResult? {
        if (!durationMinutes.isFinite() || durationMinutes <= 0 ||
            !averageHeartRate.isFinite() || averageHeartRate !in 30.0..220.0 ||
            restingHeartRate !in 30.0..150.0 || maximumHeartRate !in 100.0..230.0 ||
            maximumHeartRate <= restingHeartRate) return null
        val fraction = ((averageHeartRate - restingHeartRate) /
            (maximumHeartRate - restingHeartRate)).coerceIn(0.0, 1.0)
        if (fraction <= 0) return null
        val coefficient = if (female == true) 0.86 * exp(1.67 * fraction)
            else 0.64 * exp(1.92 * fraction)
        val trimp = durationMinutes * fraction * coefficient
        val score = 100.0 * (1.0 - exp(-trimp / 75.0))
        return InsightResult(
            value = score.coerceIn(0.0, 100.0),
            confidence = "medium",
            inputs = linkedMapOf(
                "duration_minutes" to durationMinutes,
                "average_hr_bpm" to averageHeartRate,
                "resting_hr_bpm" to restingHeartRate,
                "maximum_hr_bpm" to maximumHeartRate,
                "heart_rate_reserve_fraction" to fraction,
                "trimp" to trimp,
            ),
            note = "Cardiovascular load from heart-rate reserve and Banister TRIMP.",
            contributors = listOf(
                ScoreContributor("cardio_load", "Cardiovascular load", trimp, "TRIMP", score, 1.0, 1.0,
                    "Duration and heart-rate reserve combined with the Banister method.", ScoreContributorRole.SCORED),
                ScoreContributor("duration", "Duration", durationMinutes, "min", explanation = "Workout duration context.", role = ScoreContributorRole.CONTEXT),
                ScoreContributor("average_hr", "Average heart rate", averageHeartRate, "bpm", explanation = "Recorded workout heart rate.", role = ScoreContributorRole.CONTEXT),
            ),
        )
    }

    /**
     * Internal training load in arbitrary units. A user-provided session-RPE (Foster's
     * duration×RPE method) is preferred because HR is a poor intensity proxy for resistance and
     * interval work. When RPE is absent, fall back to Banister's sex-specific HRR TRIMP. The
     * method is recorded in the note and inputs so subscribers never confuse the two scales.
     */
    fun workoutLoad(
        durationMinutes: Double,
        averageHeartRate: Double?,
        restingHeartRate: Double?,
        maximumHeartRate: Double?,
        female: Boolean?,
        perceivedEffort: Double? = null,
        effortFromLabel: Boolean = false,
    ): InsightResult? {
        if (!durationMinutes.isFinite() || durationMinutes <= 0.0) return null
        val rpe = perceivedEffort?.takeIf { it.isFinite() && it in 0.0..10.0 }
        if (rpe != null) {
            return InsightResult(
                value = durationMinutes * rpe,
                confidence = if (effortFromLabel) "low" else "medium",
                inputs = linkedMapOf(
                    "duration_minutes" to durationMinutes,
                    "session_rpe" to rpe,
                    "method_s_rpe" to 1.0,
                    "rpe_from_label" to if (effortFromLabel) 1.0 else 0.0,
                ),
                note = if (effortFromLabel) "Duration × approximate effort mapped from the saved verbal label; arbitrary training-load units. Label mapping is a on-device convention."
                    else "Foster session-RPE load (duration × perceived effort); arbitrary units, not a clinical score.",
                contributors = listOf(
                    ScoreContributor("duration", "Duration", durationMinutes, "min", explanation = "Saved workout duration.", role = ScoreContributorRole.CONTEXT),
                    ScoreContributor("session_rpe", "Perceived effort", rpe, "/ 10", explanation = if (effortFromLabel) "Approximate value mapped from the saved effort label." else "User-entered session effort.", role = ScoreContributorRole.CONTEXT),
                ),
            )
        }

        val hr = averageHeartRate ?: return null
        val rest = restingHeartRate ?: return null
        val max = maximumHeartRate ?: return null
        if (hr !in 30.0..220.0 || rest !in 30.0..150.0 || max !in 100.0..230.0 || max <= rest) return null
        val fraction = ((hr - rest) / (max - rest)).coerceIn(0.0, 1.0)
        if (fraction <= 0.0) return null
        val isFemale = female == true
        val coefficient = if (isFemale) 0.86 * exp(1.67 * fraction)
        else 0.64 * exp(1.92 * fraction)
        val trimp = durationMinutes * fraction * coefficient
        return InsightResult(
            value = trimp,
            confidence = if (female == null) "low" else "medium",
            inputs = linkedMapOf(
                "duration_minutes" to durationMinutes,
                "average_hr_bpm" to hr,
                "resting_hr_bpm" to rest,
                "maximum_hr_bpm" to max,
                "heart_rate_reserve_fraction" to fraction,
                "trimp" to trimp,
                "method_banister_trimp" to 1.0,
            ),
            note = "Banister HR-reserve TRIMP; arbitrary training-load units and sensitive to HR quality.",
            contributors = listOf(
                ScoreContributor("duration", "Duration", durationMinutes, "min", explanation = "Saved workout duration.", role = ScoreContributorRole.CONTEXT),
                ScoreContributor("heart_rate_reserve", "Heart-rate reserve", fraction * 100.0, "%", explanation = "Average intensity between resting and estimated maximum heart rate.", role = ScoreContributorRole.CONTEXT),
                ScoreContributor("trimp", "Training impulse", trimp, "AU", explanation = "Banister heart-rate training load.", role = ScoreContributorRole.CONTEXT),
            ),
        )
    }

    /**
     * Kline/Rockport one-mile walk estimate in mL/kg/min. This is intentionally a separate,
     * explicit test method: a free-living ring workout is not automatically a VO₂max test.
     * The published normalized equation was developed in adults aged 30–69; users outside that
     * range receive a low-confidence result rather than being silently excluded.
     */
    fun rockportVo2PeakEstimate(
        durationSeconds: Double,
        distanceMeters: Double,
        finishHeartRate: Double,
        age: Int,
        weightKg: Double,
        sex: String?,
        standardizedTestConfirmed: Boolean = false,
    ): InsightResult? {
        if (!standardizedTestConfirmed) return null
        if (!durationSeconds.isFinite() || !distanceMeters.isFinite() || !finishHeartRate.isFinite()) return null
        if (durationSeconds !in 8 * 60.0..45 * 60.0) return null
        if (distanceMeters / METERS_PER_MILE !in 0.98..1.02) return null
        if (finishHeartRate !in 40.0..220.0 || !weightKg.isFinite() || weightKg <= 0.0 || age !in 18..79) return null
        val normalizedSex = sex?.lowercase() ?: return null
        if (normalizedSex != "male" && normalizedSex != "female") return null

        val timeMinutes = durationSeconds / 60.0
        val weightLb = weightKg * KG_TO_POUNDS
        val sexScore = if (normalizedSex == "male") 1.0 else 0.0
        // Normalized Rockport/Kline form (not the alternate absolute-L/min form).
        val estimate = 132.853 - 0.0769 * weightLb - 0.3877 * age +
            6.315 * sexScore - 3.2649 * timeMinutes - 0.1565 * finishHeartRate
        if (!estimate.isFinite() || estimate !in 5.0..90.0) return null

        return InsightResult(
            value = estimate,
            confidence = if (age in 30..69) "medium" else "low",
            inputs = linkedMapOf(
                "distance_m" to distanceMeters,
                "time_minutes" to timeMinutes,
                "finish_hr_bpm" to finishHeartRate,
                "age_years" to age.toDouble(),
                "weight_kg" to weightKg,
                "sex_male" to sexScore,
            ),
            note = "Rockport/Kline normalized one-mile walk estimate; standardized field-test context only, not a measured VO₂max or medical result.",
        )
    }

    fun vo2MaxEstimate(
        activityType: String,
        durationSeconds: Double,
        distanceMeters: Double,
        averageHeartRate: Double,
        restingHeartRate: Double,
        maximumHeartRate: Double,
    ): InsightResult? {
        if (activityType !in setOf("walk", "run") || !durationSeconds.isFinite() || durationSeconds < 8 * 60 ||
            !distanceMeters.isFinite() || distanceMeters <= 0 || averageHeartRate !in 30.0..220.0 ||
            restingHeartRate !in 30.0..150.0 || maximumHeartRate !in 100.0..230.0 || maximumHeartRate <= restingHeartRate
        ) return null
        val speedMps = distanceMeters / durationSeconds
        if (activityType == "walk" && speedMps !in 0.8..1.9 ||
            activityType == "run" && speedMps !in 2.2..6.0) return null
        val reserveFraction = (averageHeartRate - restingHeartRate) /
            (maximumHeartRate - restingHeartRate)
        if (reserveFraction !in 0.55..0.90) return null

        val speedMpm = speedMps * 60.0
        val submaxOxygenCost = if (activityType == "run") 0.2 * speedMpm + 3.5
            else 0.1 * speedMpm + 3.5
        // Swain & Leutholtz: HR reserve corresponds to VO2 reserve, not percent VO2max.
        val estimate = 3.5 + (submaxOxygenCost - 3.5) / reserveFraction
        if (!estimate.isFinite() || estimate !in 10.0..90.0) return null
        return InsightResult(
            value = estimate,
            confidence = "low",
            inputs = linkedMapOf(
                "duration_seconds" to durationSeconds,
                "distance_m" to distanceMeters,
                "speed_mps" to speedMps,
                "average_hr_bpm" to averageHeartRate,
                "resting_hr_bpm" to restingHeartRate,
                "maximum_hr_bpm" to maximumHeartRate,
                "heart_rate_reserve_fraction" to reserveFraction,
                "submax_oxygen_cost" to submaxOxygenCost,
            ),
            note = "Aerobic-capacity estimate from level-ground oxygen cost and HR reserve. Compare similar steady routes and conditions; whole-workout HR, hills and heat can shift it. Not measured VO₂max.",
        )
    }

    /** Saved coach labels mapped to approximate CR10 anchors, not silently discarded. */
    fun sessionRpe(effort: String?): Double? {
        val normalized = effort?.trim()?.lowercase()?.replace(' ', '_') ?: return null
        normalized.toDoubleOrNull()?.let { return it.takeIf { value -> value.isFinite() && value in 0.0..10.0 } }
        return when (normalized) {
            "easy" -> 2.0
            "moderate" -> 3.0
            "hard" -> 5.0
            "very_hard" -> 7.0
            else -> null
        }
    }

    private fun Double?.orZero(): Double = this ?: 0.0

    private fun ratio(value: Double, goal: Double): Double =
        if (!value.isFinite() || !goal.isFinite() || goal <= 0) 0.0 else (value / goal).coerceIn(0.0, 1.0)

    private fun logistic(z: Double): Double = 100.0 / (1.0 + exp(-1.2 * z.coerceIn(-3.0, 3.0)))

    private fun quantile(sorted: List<Double>, fraction: Double): Double {
        val position = (sorted.size - 1) * fraction
        val low = position.toInt()
        val high = (low + 1).coerceAtMost(sorted.lastIndex)
        return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
    }

    private const val METERS_PER_MILE = 1609.344
    private const val KG_TO_POUNDS = 2.2046226218
}

/** Queries real (never demo) rows and publishes today's deterministic insight events. */
object LocalInsightEngine {
    private const val BASELINE_DAYS = 30L
    private const val DAY_MS = 86_400_000L

    suspend fun recomputeAndPublish(
        db: PulseLoopDatabase,
        nowMs: Long = System.currentTimeMillis(),
        changedInputs: Set<String>? = null,
    ) {
        if (changedInputs != null && changedInputs.isEmpty()) return
        val events = compute(db, nowMs, changedInputs)
        // A previously decoded night may have had a score before a firmware-specific decoder was
        // tightened. Remove that stale derived row when the current run correctly withholds the
        // score, rather than leaving an old number available to widgets/coach/broadcast readers.
        staleCurrentInsightIds(events, nowMs).forEach { db.derivedUpdateDao().deleteById(it) }
        events.forEach(PulseEventBus::publishBlocking)
    }

    internal fun staleCurrentInsightIds(events: List<PulseEvent.DerivedInsight>, nowMs: Long): List<String> {
        val present = events.map { it.key }.toSet()
        val day = TimeUtil.startOfDayLocal(nowMs)
        val sleepDay = TimeUtil.referenceNightLocal(nowMs)
        return buildList {
            if ("sleep_score" !in present) add("insight:sleep_score:$sleepDay")
            if ("recovery_score" !in present) add("insight:recovery_score:$day")
            // Nutrition no longer produces a score (it lives in Vitals), so today's row from an
            // older build is always stale: clear it rather than leave a number nothing updates.
            if ("nutrition_score" !in present) add("insight:nutrition_score:$day")
        }
    }

    suspend fun compute(db: PulseLoopDatabase, nowMs: Long, changedInputs: Set<String>? = null): List<PulseEvent.DerivedInsight> {
        if (changedInputs != null && changedInputs.isEmpty()) return emptyList()
        val events = mutableListOf<PulseEvent.DerivedInsight>()
        val dayStart = TimeUtil.startOfDayLocal(nowMs)
        val nextDay = dayStart + DAY_MS
        val scope = Instant.ofEpochMilli(dayStart)
        val profile = db.userProfileDao().get()
        val goals = db.userGoalDao().get() ?: UserGoalEntity()
        val calorieProfile = profile?.let { DailyCalorieEstimator.Profile(it.sex, it.age, it.weightKg, it.heightCm) }
        if (calorieProfile != null && changedInputs == null) DailyCalorieEstimator.recompute(dayStart, db, calorieProfile)

        val sleepDay = TimeUtil.referenceNightLocal(nowMs)
        val sleepSessions = db.sleepSessionDao().ringAllByDay(sleepDay)
            .filter { it.sourceRaw !in setOf("demo", "mock") && it.totalMinutes > 0 }
        val sleepBlocksBySession = sleepSessions.associate { session ->
            session.id to db.sleepStageBlockDao().forSession(session.id)
        }
        val daySleep = SleepInsights.collapseByDay(sleepSessions) {
            sleepBlocksBySession[it].orEmpty()
        }.singleOrNull()
        val sleep = daySleep?.session
        val sleepBlocks = daySleep?.blocks.orEmpty()
        // HRV, resting HR and temperature recovery inputs come from the primary sleep window,
        // not a wall-clock span stretched across a later nap/continuation.
        val primarySleep = sleepSessions.maxByOrNull { it.totalMinutes }
        val dailySleepScore = SleepScoreRepository.forWakingDay(
            db, sleepDay, SleepScoreReadMode.DERIVED)
        if (sleep != null && dailySleepScore != null) {
            val scoreInputs = linkedMapOf<String, Double>(
                "sleep_minutes" to dailySleepScore.totalSleepMinutes.toDouble(),
            )
            dailySleepScore.contributors.forEach { contributor ->
                contributor.value?.let { scoreInputs["${contributor.id}_value"] = it }
                contributor.score?.let { scoreInputs["${contributor.id}_score"] = it }
                scoreInputs["${contributor.id}_weight"] = contributor.weight
                scoreInputs["${contributor.id}_available"] =
                    if (contributor.role == ScoreContributorRole.UNAVAILABLE) 0.0 else 1.0
            }
            events += insight(
                key = "sleep_score",
                result = InsightResult(
                    value = dailySleepScore.score.toDouble(),
                    confidence = dailySleepScore.confidence,
                    inputs = scoreInputs,
                    note = dailySleepScore.explanation,
                ),
                unit = "score",
                scopeStart = Instant.ofEpochMilli(sleepDay),
                version = InsightAlgorithms.SLEEP_VERSION,
            )
        }

        val activity = db.activityDailyDao().byDay(dayStart)?.takeIf { it.source !in setOf("demo", "mock") }
        val workouts = db.activitySessionDao().finishedStartedBetween(dayStart, nextDay)
        if (activity != null) {
            calorieProfile?.let { p ->
                DailyCalorieEstimator.effectiveActiveCalories(activity)?.let { value ->
                    events += insight("active_energy", InsightResult(value, "low",
                        linkedMapOf("steps" to activity.steps.toDouble()),
                        "Estimated net movement energy; excludes resting energy."),
                        "kcal", scope, "lumen-energy-v2")
                }
            }
            val workoutMinutes = workouts.sumOf { workoutDurationMinutes(it) }
            events += insight(
                "activity_score",
                InsightAlgorithms.activityScore(
                    activity.steps,
                    activity.activeMinutes,
                    workoutMinutes,
                    goals.steps,
                    goals.activeMinutes,
                ),
                "score",
                scope,
                InsightAlgorithms.ACTIVITY_VERSION,
            )
        }

        val baselineStart = nowMs - BASELINE_DAYS * DAY_MS
        val currentWindowStart = primarySleep?.startAt ?: dayStart
        val baselineEnd = currentWindowStart.coerceAtMost(nowMs)
        val currentWindowEnd = primarySleep?.endAt ?: nowMs

        suspend fun samples(kind: MeasurementKind, start: Long, end: Long) =
            db.measurementDao().rangeReal(kind.name, start, end)
                .filter { InsightSamplePolicy.accepts(kind, it.value) && it.timestamp <= nowMs }
                .map { VitalSample(it.timestamp, it.value) }

        suspend fun currentValues(kind: MeasurementKind): List<Double> =
            if (primarySleep == null) emptyList() else InsightSamplePolicy.nightlyValues(
                samples(kind, currentWindowStart, currentWindowEnd))
        val hrvCurrent = median(currentValues(MeasurementKind.HRV))
        val hrCurrent = percentile(currentValues(MeasurementKind.HEART_RATE), 0.10)
        val tempCurrent = median(currentValues(MeasurementKind.TEMPERATURE))

        // RMSSD is typically right-skewed; publish the log transform as a separate, explicitly
        // named trend series rather than replacing the ring's observed RMSSD value.
        hrvCurrent?.let { raw ->
            InsightAlgorithms.lnRmssd(raw)?.let { logged ->
                events += insight(
                    "hrv_lnrmssd",
                    InsightResult(
                        value = logged,
                        confidence = "medium",
                        inputs = linkedMapOf("rmssd_ms" to raw),
                        note = "Natural log of the ring-reported HRV summary; its RMSSD definition is not independently verified. Compare within this device only.",
                    ),
                    "ln(ms)",
                    scope,
                    InsightAlgorithms.HRV_TREND_VERSION,
                )
            }
        }

        // Recovery baselines compare one night with prior nights. An all-day HR mean is dominated
        // by movement and would make a normal sleeping rate look artificially excellent; one row
        // per sleep also prevents a long, densely sampled night from outweighing every other day.
        val priorSleeps = db.sleepSessionDao().startingInRangeReal(baselineStart, baselineEnd).filter {
            it.sourceRaw !in setOf("demo", "mock") && it.date != sleepDay &&
                it.startAt >= baselineStart && it.endAt <= baselineEnd && it.totalMinutes > 0
        }.groupBy { it.date }.values.mapNotNull { day -> day.maxByOrNull { it.totalMinutes } }
        suspend fun nightlyBaseline(
            kind: MeasurementKind,
            aggregate: (List<Double>) -> Double?,
        ): BaselineStats? {
            val all = samples(kind, baselineStart, baselineEnd)
            val nights = priorSleeps.mapNotNull { night ->
                val values = InsightSamplePolicy.nightlyValues(all.asSequence()
                    .filter { it.timestampMs in night.startAt..night.endAt }
                    .toList())
                aggregate(values)?.let { VitalSample(night.startAt, it) }
            }
            return BaselineStats.compute(nights)
        }
        val hrvBaseline = nightlyBaseline(MeasurementKind.HRV, ::median)
        val hrBaseline = nightlyBaseline(MeasurementKind.HEART_RATE) { percentile(it, 0.10) }
        val tempBaseline = nightlyBaseline(MeasurementKind.TEMPERATURE, ::median)

        if (tempCurrent != null && tempBaseline != null &&
            InsightAlgorithms.personalDeviation(tempCurrent, tempBaseline, 0.5) != null) {
            events += insight(
                "skin_temperature_deviation",
                InsightResult(tempCurrent - tempBaseline.median, "low",
                    linkedMapOf("nightly_skin_c" to tempCurrent, "baseline_skin_c" to tempBaseline.median,
                        "baseline_nights" to tempBaseline.sampleCount.toDouble()),
                    "Nightly median finger temperature relative to prior nights; ambient conditions and contact affect this signal."),
                "delta_degC", scope, "lumen-nightly-temperature-v1",
            )
        }

        val allHrv = samples(MeasurementKind.HRV, baselineStart, nowMs)
        val hrvNights = (priorSleeps + listOfNotNull(primarySleep)).distinctBy { it.date }.mapNotNull { night ->
            median(InsightSamplePolicy.nightlyValues(allHrv.filter {
                it.timestampMs in night.startAt..night.endAt
            }))?.let { night.startAt to it }
        }
        val recentCutoff = currentWindowStart - 6 * DAY_MS
        InsightAlgorithms.hrvTrend(hrvNights.filter { it.first >= recentCutoff }.map { it.second },
            hrvNights.filter { it.first < recentCutoff }.map { it.second })?.let {
            events += insight("hrv_balance", it, "score", scope, "lumen-weekly-hrv-v1")
        }
        InsightAlgorithms.stressScore(hrvCurrent, hrvBaseline, hrCurrent, hrBaseline)?.let {
            events += insight("resting_load", it, "score", scope, "lumen-resting-load-v1")
        }

        val priorDayStart = TimeUtil.startOfDayLocal(dayStart - 1)
        val priorActivity = db.activityDailyDao().byDay(priorDayStart)
            ?.takeIf { it.source !in setOf("demo", "mock") }
        val activityBaseline = BaselineStats.compute(
            db.activityDailyDao().recentReal(35)
                .filter { it.date < priorDayStart && it.date >= priorDayStart - BASELINE_DAYS * DAY_MS }
                .map { VitalSample(it.date, it.activeMinutes.toDouble()) },
        )
        val loadZ = InsightAlgorithms.personalDeviation(
            priorActivity?.activeMinutes?.toDouble(), activityBaseline, minimumScale = 10.0)
        // Only unusually high prior-day load reduces this component. A quiet day is not treated
        // as failed recovery, and fewer than seven baseline days leaves the component unavailable.
        val priorDayLoadBalance = loadZ?.let { z ->
            100.0 * exp(-0.5 * maxOf(0.0, z) * maxOf(0.0, z))
        }
        InsightAlgorithms.recoveryScore(
            hrv = hrvCurrent,
            hrvBaseline = hrvBaseline,
            restingHr = hrCurrent,
            restingHrBaseline = hrBaseline,
            sleepScore = dailySleepScore?.score?.toDouble(),
            skinTemperature = tempCurrent,
            temperatureBaseline = tempBaseline,
            priorDayLoadBalanceScore = priorDayLoadBalance,
        )?.let {
            events += insight("recovery_score", it, "score", scope, InsightAlgorithms.RECOVERY_VERSION)
        }

        val restingHr = profile?.hrRestingBaseline ?: hrBaseline?.median ?: hrCurrent
        val age = profile?.age ?: 35
        val maxHr = 208.0 - 0.7 * age
        val female = when (profile?.sex?.lowercase()) {
            "female" -> true
            "male" -> false
            else -> null
        }
        for (workout in workouts) {
            val duration = workoutDurationMinutes(workout)
            val avgHr = workout.avgHeartRate
            // sRPE remains useful even before a personal resting-HR baseline exists.
            InsightAlgorithms.workoutLoad(
                durationMinutes = duration,
                averageHeartRate = avgHr,
                restingHeartRate = restingHr,
                maximumHeartRate = maxHr,
                female = female,
                perceivedEffort = InsightAlgorithms.sessionRpe(workout.perceivedEffort),
                effortFromLabel = workout.perceivedEffort != null && workout.perceivedEffort.toDoubleOrNull() == null,
            )?.let {
                events += insight(
                    "workout_load", it, "AU", Instant.ofEpochMilli(workout.startedAt),
                    InsightAlgorithms.WORKOUT_LOAD_VERSION,
                )
            }
            if (restingHr != null) {
                if (avgHr != null) {
                    InsightAlgorithms.workoutScore(duration, avgHr, restingHr, maxHr, female)?.let {
                        events += insight(
                            "workout_score", it, "score", Instant.ofEpochMilli(workout.startedAt),
                            InsightAlgorithms.WORKOUT_VERSION,
                        )
                    }
                }
                if (workout.useGps && avgHr != null) {
                    val ended = workout.endedAt
                    val hrSamples = if (ended != null) db.measurementDao()
                        .rangeReal(MeasurementKind.HEART_RATE.name, workout.startedAt, ended)
                        .filter { it.value in 40.0..220.0 }
                        .sortedBy { it.timestamp }
                    else emptyList()
                    val terminalHr = ended?.let { end ->
                        hrSamples.lastOrNull { end - it.timestamp in 0L..120_000L }?.value
                    }
                    val rockport = if (workout.type.lowercase() == "walk" && terminalHr != null) {
                        InsightAlgorithms.rockportVo2PeakEstimate(
                            durationSeconds = duration * 60.0,
                            distanceMeters = workout.distanceMeters ?: 0.0,
                            finishHeartRate = terminalHr,
                            age = age,
                            weightKg = profile?.weightKg ?: 0.0,
                            sex = profile?.sex,
                        )
                    } else null
                    val estimate = rockport ?: InsightAlgorithms.vo2MaxEstimate(
                        activityType = workout.type,
                        durationSeconds = duration * 60.0,
                        distanceMeters = workout.distanceMeters ?: 0.0,
                        averageHeartRate = avgHr,
                        restingHeartRate = restingHr,
                        maximumHeartRate = maxHr,
                    )
                    estimate?.let {
                        events += insight(
                            "vo2max_estimate", it, "mL/kg/min", Instant.ofEpochMilli(workout.startedAt),
                            if (rockport != null) InsightAlgorithms.ROCKPORT_VO2_VERSION
                            else InsightAlgorithms.VO2_VERSION,
                        )
                    }
                }
            }
        }

        return events
    }

    private fun insight(
        key: String,
        result: InsightResult,
        unit: String,
        scopeStart: Instant,
        version: String,
    ): PulseEvent.DerivedInsight {
        val publishedInputs = result.inputs.toMutableMap()
        result.contributors.forEach { contributor ->
            contributor.value?.let { publishedInputs["${contributor.id}_value"] = it }
            contributor.score?.let { publishedInputs["${contributor.id}_score"] = it }
            publishedInputs["${contributor.id}_weight"] = contributor.weight
            publishedInputs["${contributor.id}_available"] =
                if (contributor.role == ScoreContributorRole.UNAVAILABLE) 0.0 else 1.0
        }
        return PulseEvent.DerivedInsight(
        key = key,
        value = (result.value * 10.0).roundToInt() / 10.0,
        unit = unit,
        scopeStart = scopeStart,
        confidence = result.confidence,
        algorithmVersion = version,
        inputs = publishedInputs,
        note = result.note,
    )
    }

    private fun workoutDurationMinutes(workout: ActivitySessionEntity): Double {
        val ended = workout.endedAt ?: return 0.0
        return ((ended - workout.startedAt) / 60_000.0 - workout.totalPauseSeconds / 60.0)
            .coerceAtLeast(0.0)
    }

    private fun median(values: List<Double>): Double? = percentile(values, 0.50)

    private fun percentile(values: List<Double>, fraction: Double): Double? {
        val sorted = values.filter { it.isFinite() && it > 0 }.sorted()
        if (sorted.isEmpty()) return null
        if (sorted.size == 1) return sorted.first()
        val rank = fraction.coerceIn(0.0, 1.0) * (sorted.size - 1)
        val lower = rank.toInt()
        val upper = kotlin.math.ceil(rank).toInt()
        val weight = rank - lower
        return sorted[lower] * (1 - weight) + sorted[upper] * weight
    }
}
