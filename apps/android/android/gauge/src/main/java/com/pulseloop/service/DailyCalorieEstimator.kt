package com.pulseloop.service

import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.ActivityBucketEntity
import com.pulseloop.data.entity.ActivityDailyEntity
import com.pulseloop.data.entity.ActivitySessionEntity
import com.pulseloop.data.entity.MeasurementEntity
import com.pulseloop.ring.MeasurementKind

/**
 * Ported from `DailyCalorieMath` / `DailyCalorieEstimator` in DailyCalorieEstimator.swift (iOS #98).
 * Fills in daily calories for rings that report none (LuckRing/TK18, ring-history-only days).
 *
 * The model attributes **each interval of the day to exactly one estimator** — workout window >
 * distance-based step bucket — and every term is net of resting energy, so adding the
 * Mifflin-St Jeor BMR baseline at read time can't double-count. Without that attribution the terms
 * overlap: a logged run's minutes would be paid for by its session calories, again by its elevated
 * HR samples, and a third time by its step bucket.
 */
object DailyCalorieEstimator {

    private const val FLEX_HR_FRACTION = 0.6
    private const val MAX_HR = 220.0
    private const val INTERMITTENT_CADENCE_SPM = 100.0
    private const val DEFAULT_WEIGHT_KG = 70.0
    private const val DEFAULT_HEIGHT_CM = 170.0
    private const val DEFAULT_AGE = 35
    private const val DAY_MS = 86_400_000L

    /**
     * The `source` value the ring-history ingest writes. iOS drops the ring's own history calorie
     * field as unverified, so a `ring_history` row's `calories` means "no device value", not zero
     * burn (`ActivityDaily.deviceReportedCalories`).
     */
    const val RING_HISTORY_SOURCE = "ring_history"

    data class Profile(val sex: String?, val age: Int?, val weightKg: Double?, val heightCm: Double?)

    /** Mifflin-St Jeor BMR (kcal/day), clamped at 0 like iOS's `mifflinBMR`. */
    fun bmr(
        weightKg: Double = DEFAULT_WEIGHT_KG,
        heightCm: Double = DEFAULT_HEIGHT_CM,
        age: Int = DEFAULT_AGE,
        sex: String? = null,
    ): Double {
        val sexConst = when (sex?.lowercase()) {
            "male" -> 5.0
            "female" -> -161.0
            else -> -78.0   // mean of the two constants when sex is unspecified
        }
        val weight = weightKg.takeIf { it.isFinite() && it in 20.0..350.0 } ?: DEFAULT_WEIGHT_KG
        val height = heightCm.takeIf { it.isFinite() && it in 100.0..250.0 } ?: DEFAULT_HEIGHT_CM
        return maxOf(0.0, 10.0 * weight + 6.25 * height - 5.0 * age.coerceIn(18, 100) + sexConst)
    }

    fun bmrPerMinute(
        weightKg: Double = DEFAULT_WEIGHT_KG,
        heightCm: Double = DEFAULT_HEIGHT_CM,
        age: Int = DEFAULT_AGE,
        sex: String? = null,
    ): Double = bmr(weightKg, heightCm, age, sex) / 1440.0

    private fun bmrPerMinute(p: Profile): Double = bmrPerMinute(
        p.weightKg ?: DEFAULT_WEIGHT_KG,
        p.heightCm ?: DEFAULT_HEIGHT_CM,
        p.age ?: DEFAULT_AGE,
        p.sex,
    )

    /** Flex-HR threshold: only samples at or above this contribute (Spurr's Flex-HR method). */
    fun flexHR(age: Int = DEFAULT_AGE): Double = FLEX_HR_FRACTION * (MAX_HR - age)

    // ── Read-time selection ─────────────────────────────────────────────────────

    /**
     * The calories the *device itself* reported, or null when it gave none.
     *
     * Mirrors iOS `ActivityDaily.deviceReportedCalories`:
     * `source == ringHistorySource || calories <= 0 ? nil : calories`. Note the direction — a
     * `ring_history` row never counts as a device value however large its `calories` column is.
     * This was inverted on first port (it returned the value *only* for `ring_history`, and ignored
     * genuine device calories from every other source), which made the estimate replace real data
     * and real data replace the estimate.
     */
    fun deviceReportedCalories(day: ActivityDailyEntity): Double? =
        if (day.source == RING_HISTORY_SOURCE || day.calories <= 0.0) null else day.calories

    /**
     * What to display: our estimated **total** when available, otherwise the device figure —
     * BMR accrued over the day's elapsed minutes (so today's number grows from midnight, the way
     * Fitbit/Oura/Whoop present it) plus the stored net active estimate.
     */
    fun effectiveCalories(
        day: ActivityDailyEntity,
        profile: Profile,
        now: Long = System.currentTimeMillis(),
    ): Double? {
        val active = day.estimatedActiveCalories?.takeIf { it.isFinite() && it >= 0 }
            ?: return deviceReportedCalories(day)
        return bmrPerMinute(profile) * elapsedMinutes(day.date, now) + active
    }

    /**
     * The active-energy portion — what the calorie *goal ring* measures, so `UserGoal.calories`
     * stays an active-energy goal even when the displayed total includes basal burn.
     */
    fun effectiveActiveCalories(day: ActivityDailyEntity): Double? =
        day.estimatedActiveCalories?.takeIf { it.isFinite() && it >= 0 } ?: deviceReportedCalories(day)

    /** Minutes of [dayStart] that have elapsed: partial for today, full for the past, 0 ahead. */
    private fun elapsedMinutes(dayStart: Long, now: Long): Double = when {
        now < dayStart -> 0.0
        now >= dayStart + DAY_MS -> 1440.0
        else -> ((now - dayStart) / 60_000.0).coerceIn(0.0, 1440.0)
    }

    // ── Recompute ───────────────────────────────────────────────────────────────

    /**
     * Recompute one day from scratch — idempotent, so re-syncs and repeated calls converge.
     *
     * **No `activity_daily` row → no-op.** A day with nothing synced and nothing logged has nothing
     * to estimate against, and inserting a row here would fabricate a zero-step `ring_history` day
     * in the history and charts (iOS: `guard let row = MetricsRepository.activity(...) else return`).
     */
    suspend fun recompute(dayStart: Long, db: PulseLoopDatabase, profile: Profile) {
        val row = db.activityDailyDao().byDay(dayStart) ?: return
        val dayEnd = dayStart + DAY_MS

        // `rangeReal`: the estimate is written back onto the day's REAL `activity_daily` row
        // below, where it drives the calorie goal ring and is eligible for Health Connect export
        // (that export filters on the row's own source, which is not demo). Seeded HR for today
        // would inflate a number that outlives the demo data behind it (`DemoDataPolicy`).
        val hrSamples = db.measurementDao().rangeReal(MeasurementKind.HEART_RATE.name, dayStart, dayEnd)
        val buckets = db.activityBucketDao().byDay(dayStart)
        val workouts = db.activitySessionDao().finishedOverlapping(dayStart, dayEnd)

        // No movement evidence is different from a measured zero-activity day. Do not replace a
        // vendor-only record with a fabricated zero estimate while detailed history is pending.
        if (row.steps <= 0 && buckets.isEmpty() && workouts.none { (it.calories ?: 0.0) > 0 }) return

        val active = estimateNetActive(
            dayStart = dayStart,
            dayTotalSteps = row.steps,
            buckets = buckets,
            workouts = workouts,
            hrSamples = hrSamples,
            profile = profile,
        )
        db.activityDailyDao().upsert(row.copy(
            estimatedActiveCalories = active,
            updatedAt = System.currentTimeMillis(),
        ))
    }

    /** A half-open interval, in epoch millis, already attributed to some estimator. */
    private data class Window(val start: Long, val end: Long)

    /**
     * Net active calories for one day — excludes the BMR baseline, which [effectiveCalories] adds
     * at read time. Pure, so it can be unit-tested without Room.
     */
    fun estimateNetActive(
        dayStart: Long,
        dayTotalSteps: Int,
        buckets: List<ActivityBucketEntity>,
        workouts: List<ActivitySessionEntity>,
        hrSamples: List<MeasurementEntity>,
        profile: Profile,
    ): Double {
        val dayEnd = dayStart + DAY_MS
        val weight = profile.weightKg?.takeIf { it.isFinite() && it in 20.0..350.0 } ?: DEFAULT_WEIGHT_KG
        val bmrPerMin = bmrPerMinute(profile)
        val covered = mutableListOf<Window>()
        val steppingWorkouts = mutableListOf<Window>()
        var activeKcal = 0.0

        // Each minute belongs to at most one logged workout, including duplicate/overlapping logs.
        for (workout in workouts.sortedWith(compareBy<ActivitySessionEntity> { it.startedAt }.thenBy { it.id })) {
            val end = workout.endedAt ?: continue
            val gross = workout.calories?.takeIf { it.isFinite() && it > 0 } ?: continue
            val clippedStart = maxOf(workout.startedAt, dayStart)
            val clippedEnd = minOf(end, dayEnd)
            if (clippedEnd <= clippedStart) continue
            val window = Window(clippedStart, clippedEnd)
            val uncoveredMs = (clippedEnd - clippedStart) - overlapSeconds(window, covered) * 1000
            val fraction = uncoveredMs / (end - workout.startedAt).toDouble()
            activeKcal += maxOf(0.0, gross * fraction - bmrPerMin * uncoveredMs / 60_000.0)
            covered.add(window)
            if (workout.type in setOf("walk", "run", "hike", "dance", "sport", "squash")) steppingWorkouts.add(window)
        }

        // All-day HR alone cannot distinguish exercise from heat, stress or poor optical contact.
        // Keep HR for workout estimates; do not extrapolate a sparse elevated sample for ten minutes.
        // Bucket duration is absent from legacy storage. Energy therefore depends on distance,
        // never on assuming that a JStyle one-minute bucket lasts fifteen minutes.
        val validBuckets = buckets.filter { it.startEpoch in dayStart until dayEnd && it.steps >= 0 }
            .distinctBy { it.startEpoch }.sortedBy { it.startEpoch }
        val spacing = validBuckets.zipWithNext().map { (a, b) -> b.startEpoch - a.startEpoch }
            .filter { it in 60_000L..900_000L }.minOrNull() ?: 60_000L
        val strideM = 0.414 * (profile.heightCm?.takeIf { it.isFinite() && it in 100.0..250.0 }
            ?: DEFAULT_HEIGHT_CM) / 100.0
        var stepKcal = 0.0
        var bucketSteps = 0L
        var coveredSteps = 0.0
        for (bucket in validBuckets) {
            bucketSteps += bucket.steps
            val bucketEnd = minOf(bucket.startEpoch + spacing, dayEnd)
            val overlap = overlapSeconds(Window(bucket.startEpoch, bucketEnd), covered)
            val keep = (1.0 - overlap / ((bucketEnd - bucket.startEpoch) / 1000.0)).coerceIn(0.0, 1.0)
            coveredSteps += bucket.steps * (1.0 - keep)
            val distance = bucket.distanceMeters.takeIf {
                it.isFinite() && it >= 0 && it <= bucket.steps * 2.0 && (it > 0 || bucket.steps == 0)
            } ?: (bucket.steps * strideM)
            // ACSM level walking horizontal oxygen cost: 0.1 ml/kg/m × 5 kcal/litre.
            stepKcal += 0.0005 * weight * distance * keep
        }
        // With missing bucket timing, workout steps are an explicit approximation, deducted only
        // to the extent not already represented by the buckets excluded above.
        val workoutStepAllowance = maxOf(0.0, mergedDurationSeconds(steppingWorkouts) / 60.0 *
            INTERMITTENT_CADENCE_SPM - coveredSteps)
        val residual = maxOf(0.0, dayTotalSteps.toDouble() - bucketSteps - workoutStepAllowance)
        stepKcal += 0.0005 * weight * residual * strideM
        return maxOf(0.0, activeKcal + stepKcal)
    }

    /**
     * Walking MET for intermittent stepping at ~100 steps/min, refined by stride length from height
     * when it's known (stride ≈ 0.414 × height → speed → Compendium walking tier). Height-unknown
     * returns 3.0, iOS's own fallback — deliberately *not* the tier that the 170 cm default would
     * produce, since that would silently assert a stride we don't have.
     */
    fun intermittentWalkMET(heightCm: Double?): Double {
        if (heightCm == null || heightCm <= 0) return 3.0
        val strideM = 0.414 * heightCm / 100.0
        val speedMps = strideM * INTERMITTENT_CADENCE_SPM / 60.0
        return when {
            speedMps < 1.0 -> 2.8    // < 3.6 km/h easy
            speedMps < 1.35 -> 3.5   // ~4.8 km/h moderate
            speedMps < 1.65 -> 4.3   // ~5.6 km/h brisk
            else -> 5.0              // ≥ 6 km/h very brisk
        }
    }

    // ── Interval helpers ────────────────────────────────────────────────────────

    private fun overlapSeconds(interval: Window, windows: List<Window>): Double =
        mergedDurationSeconds(
            windows.mapNotNull { w ->
                val start = maxOf(interval.start, w.start)
                val end = minOf(interval.end, w.end)
                if (end > start) Window(start, end) else null
            }
        )

    private fun mergedDurationSeconds(windows: List<Window>): Double {
        var total = 0L
        var currentEnd = Long.MIN_VALUE
        for (w in windows.sortedBy { it.start }) {
            val start = maxOf(w.start, currentEnd)
            if (w.end > start) {
                total += w.end - start
                currentEnd = w.end
            }
        }
        return total / 1000.0
    }

}
