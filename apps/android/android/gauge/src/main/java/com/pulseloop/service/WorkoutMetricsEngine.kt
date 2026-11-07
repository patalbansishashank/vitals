package com.pulseloop.service

/** Plain profile values the calorie model needs. */
data class MetricsProfileValues(
    val sex: String? = null,
    val age: Int? = null,
    val weightKg: Double? = null,
)

/**
 * Ported from [WorkoutMetricsEngine] in WorkoutMetricsEngine.swift (iOS #57a).
 * Calories use the Keytel et al. (2005) HR model when the ring gave us dense-enough HR and the
 * profile is complete, otherwise a per-type MET estimate (speed-tiered for run/cycle) replaces
 * the old flat 8 kcal/min for everything.
 */
object WorkoutMetricsEngine {
    /** Fallback body weight when no profile exists. */
    const val DEFAULT_WEIGHT_KG = 70.0
    /** Minimum fraction of workout minutes with an HR sample before the HR model is trusted. */
    const val KEYTEL_COVERAGE_THRESHOLD = 0.6

    fun calories(
        type: String,
        durationSeconds: Int,
        distanceMeters: Double?,
        hrSamples: List<Pair<Long, Double>>,  // (epochMillis, bpm)
        profile: MetricsProfileValues,
    ): Double {
        val minutes = durationSeconds / 60.0
        if (minutes <= 0) return 0.0
        val speed = distanceMeters?.takeIf { it.isFinite() && it > 0 }?.div(durationSeconds)
        val weight = profile.weightKg?.takeIf { it.isFinite() && it in 20.0..350.0 } ?: DEFAULT_WEIGHT_KG
        // When a timed distance is available, use the ACSM level-grade walking/running
        // relationship before the coarser Compendium fallback. It is still an estimate (grade is
        // unavailable here), so keep it separate from the ring's reported calories.
        acsmMetValue(type, speed)?.let { return metCalories(it, weight, minutes) }
        if (type in setOf("walk", "run", "cycle", "hike")) {
            keytelCalories(minutes, hrSamples, profile)?.let { return it }
        }
        return metCalories(metValue(type, speed), weight, minutes)
    }

    /** Gross energy, including rest: oxygen cost × approximately 5 kcal per litre O2. */
    fun metCalories(met: Double, weightKg: Double, minutes: Double): Double =
        if (met.isFinite() && weightKg.isFinite() && minutes.isFinite())
            (met * 3.5 * weightKg / 200.0 * minutes).coerceAtLeast(0.0) else 0.0

    /**
     * ACSM level-grade metabolic equation. [averageSpeedMps] is derived from a measured route and
     * elapsed time, not from steps alone; unsupported activities deliberately return null. The
     * grade term is omitted because the current workout model does not yet retain route elevation.
     */
    fun acsmMetValue(type: String, averageSpeedMps: Double?, gradeFraction: Double = 0.0): Double? {
        val speed = averageSpeedMps ?: return null
        if (!speed.isFinite() || speed <= 0.0 || !gradeFraction.isFinite() || gradeFraction !in -0.2..0.3) return null
        val speedMpm = speed * 60.0
        val vo2 = when (type) {
            "walk" -> if (speed in 0.8..2.2) 3.5 + 0.1 * speedMpm + 1.8 * speedMpm * gradeFraction else null
            "run" -> if (speed in 2.0..6.0) 3.5 + 0.2 * speedMpm + 0.9 * speedMpm * gradeFraction else null
            else -> null
        } ?: return null
        return (vo2 / 3.5).coerceAtLeast(1.0)
    }

    /** MET by canonical activity type (2011 Compendium ballparks), speed-tiered where average
     *  speed meaningfully changes intensity. */
    fun metValue(type: String, averageSpeedMps: Double?): Double = when (type) {
        "walk" -> 3.5
        "run" -> when {
            averageSpeedMps == null || averageSpeedMps <= 0 -> 9.8
            averageSpeedMps < 2.2 -> 8.3    // ≲ 8 km/h jog
            averageSpeedMps < 2.7 -> 9.8    // ~9.7 km/h
            averageSpeedMps < 3.2 -> 11.0   // ~11.3 km/h
            else -> 12.3
        }
        "cycle" -> when {
            averageSpeedMps == null || averageSpeedMps <= 0 -> 6.8
            averageSpeedMps < 4.2 -> 5.8    // < 15 km/h
            averageSpeedMps < 5.5 -> 6.8    // 15-20 km/h
            averageSpeedMps < 6.9 -> 8.0    // 20-25 km/h
            else -> 10.0
        }
        "gym" -> 5.0
        "squash" -> 12.0
        "sport" -> 7.0
        "yoga" -> 2.5
        "dance" -> 5.5
        "hike" -> 6.0
        else -> 4.0
    }

    /** Sum of per-minute Keytel rates, with uncovered minutes credited at the covered minutes'
     *  mean rate. Returns null when the profile is incomplete or HR coverage is below threshold. */
    private fun keytelCalories(
        minutes: Double,
        hrSamples: List<Pair<Long, Double>>,
        profile: MetricsProfileValues,
    ): Double? {
        val sex = profile.sex?.lowercase()?.takeIf { it == "male" || it == "female" } ?: return null
        val age = profile.age ?: return null
        val weight = profile.weightKg ?: return null
        if (age !in 18..80 || !weight.isFinite() || weight !in 20.0..350.0) return null
        if (hrSamples.isEmpty()) return null
        // Reject impossible/overflow values before calculating coverage. A single malformed ring
        // sample must not become a very high calorie rate or make an otherwise sparse workout
        // look sufficiently covered for the HR regression.
        val byMinute = hrSamples
            .filter { it.second.isFinite() && it.second in 90.0..180.0 }
            .groupBy { it.first / 60_000L }
        if (byMinute.isEmpty() || byMinute.size / minutes < KEYTEL_COVERAGE_THRESHOLD) return null
        val rates = byMinute.values.map { bucket ->
            val meanHR = bucket.sumOf { it.second } / bucket.size
            keytelCalorieRate(meanHR, sex, age, weight)
        }
        val meanRate = rates.sum() / rates.size
        return maxOf(0.0, meanRate * minutes)
    }

    /** kcal/min for a given heart rate (Keytel et al. 2005, without VO2max), clamped >= 0.
     *  Made public for DailyCalorieEstimator (iOS #98). */
    fun keytelCalorieRate(hr: Double, sex: String?, age: Int, weightKg: Double): Double {
        val male = sex?.lowercase() == "male"
        val kj = if (male)
            -55.0969 + 0.6309 * hr + 0.1988 * weightKg + 0.2017 * age
        else
            -20.4022 + 0.4472 * hr - 0.1263 * weightKg + 0.0740 * age
        return maxOf(0.0, kj / 4.184)
    }
}
