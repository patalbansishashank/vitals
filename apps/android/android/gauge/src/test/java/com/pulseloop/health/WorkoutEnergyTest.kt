package com.pulseloop.health

import com.pulseloop.data.entity.ActivitySessionEntity
import com.pulseloop.health.exporters.WorkoutEnergy
import com.pulseloop.service.DailyCalorieEstimator
import org.junit.Assert.assertEquals
import org.junit.Test

class WorkoutEnergyTest {
    @Test fun `health connect active energy excludes the same resting baseline as daily energy`() {
        val session = ActivitySessionEntity(type = "walk", startedAt = 0L, endedAt = 3_600_000L, calories = 300.0)
        assertEquals(300.0 - DailyCalorieEstimator.bmrPerMinute() * 60,
            WorkoutEnergy.netCalories(session, null)!!, 0.001)
    }

    @Test fun `resting subtraction cannot produce negative active energy`() {
        val session = ActivitySessionEntity(type = "walk", startedAt = 0L, endedAt = 3_600_000L, calories = 1.0)
        assertEquals(0.0, WorkoutEnergy.netCalories(session, null)!!, 0.001)
    }

    @Test fun `overlapping siblings allocate time once and zero duplicate records`() {
        val first = ActivitySessionEntity(id = "a", type = "walk", startedAt = 0L, endedAt = 3_600_000L, calories = 300.0)
        val duplicate = first.copy(id = "b")
        val allocation = WorkoutEnergy.allocatedNetCalories(listOf(duplicate, first), null)
        assertEquals(WorkoutEnergy.netCalories(first, null)!!, allocation.getValue("a"), 0.001)
        assertEquals(0.0, allocation.getValue("b"), 0.001)
    }
}
