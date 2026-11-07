package com.pulseloop.service

import com.pulseloop.data.entity.ActivityBucketEntity
import com.pulseloop.data.entity.ActivityDailyEntity
import com.pulseloop.data.entity.ActivitySessionEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EnergyTrendTest {
    private val profile = DailyCalorieEstimator.Profile("male", 28, 82.0, 166.37)
    private fun estimate(buckets: List<ActivityBucketEntity>) = DailyCalorieEstimator.estimateNetActive(
        0L, buckets.sumOf { it.steps }, buckets, emptyList(), emptyList(), profile)

    @Test fun `minute and fifteen minute packing have identical distance energy`() {
        val minute = (0..14).map { ActivityBucketEntity(it * 60_000L, 0L, 100, 70.0) }
        val packed = listOf(ActivityBucketEntity(0L, 0L, 1500, 1050.0))
        assertEquals(43.05, estimate(minute), 0.001)
        assertEquals(estimate(minute), estimate(packed), 0.001)
    }

    @Test fun `invalid distance falls back to step length without poisoning total`() {
        val result = estimate(listOf(ActivityBucketEntity(0L, 0L, 100, Double.NaN)))
        assertTrue(result.isFinite() && result > 0)
    }

    @Test fun `resting heart rate does not replace yoga model`() {
        val hr = (0..29).map { it * 60_000L to 140.0 }
        val result = WorkoutMetricsEngine.calories("yoga", 1800, null, hr,
            MetricsProfileValues("male", 28, 82.0))
        assertEquals(107.625, result, 0.001)
    }

    @Test fun `our active estimate wins while unavailable estimate preserves vendor fallback`() {
        val day = ActivityDailyEntity(date = 0L, calories = 900.0, source = "device", estimatedActiveCalories = 250.0)
        assertEquals(250.0, DailyCalorieEstimator.effectiveActiveCalories(day)!!, 0.001)
        assertEquals(250.0, DailyCalorieEstimator.effectiveCalories(day, profile, now = 0L)!!, 0.001)
        assertEquals(900.0, DailyCalorieEstimator.effectiveCalories(day.copy(estimatedActiveCalories = null), profile, 0L)!!, 0.001)
    }

    @Test fun `duplicate workouts do not double active energy`() {
        val workout = ActivitySessionEntity(type = "run", startedAt = 0L, endedAt = 3_600_000L, calories = 600.0)
        fun energy(workouts: List<ActivitySessionEntity>) = DailyCalorieEstimator.estimateNetActive(
            0L, 0, emptyList(), workouts, emptyList(), profile)
        assertEquals(energy(listOf(workout)), energy(listOf(workout, workout.copy(id = "duplicate"))), 0.001)
    }
}
