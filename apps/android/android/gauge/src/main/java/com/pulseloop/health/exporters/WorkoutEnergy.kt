package com.pulseloop.health.exporters

import com.pulseloop.data.entity.ActivitySessionEntity
import com.pulseloop.data.entity.UserProfileEntity
import com.pulseloop.service.DailyCalorieEstimator

/** Session storage is gross kcal; Health Connect active energy excludes resting expenditure. */
internal object WorkoutEnergy {
    /** Earlier sessions own overlapping minutes; deterministic ID tie-break makes replay stable. */
    fun allocatedNetCalories(sessions: List<ActivitySessionEntity>, profile: UserProfileEntity?): Map<String, Double> {
        val occupied = mutableListOf<Pair<Long, Long>>()
        val result = mutableMapOf<String, Double>()
        for (session in sessions.sortedWith(compareBy<ActivitySessionEntity> { it.startedAt }.thenBy { it.id })) {
            val net = netCalories(session, profile) ?: continue
            val end = session.endedAt ?: continue
            if ((session.calories ?: 0.0) <= 0) continue
            var cursor = session.startedAt
            var uncovered = 0L
            for ((a, b) in occupied.sortedBy { it.first }) {
                if (b <= cursor || a >= end) continue
                uncovered += (minOf(a, end) - cursor).coerceAtLeast(0L)
                cursor = maxOf(cursor, b)
            }
            uncovered += (end - cursor).coerceAtLeast(0L)
            result[session.id] = net * uncovered / (end - session.startedAt)
            occupied += session.startedAt to end
        }
        return result
    }

    fun netCalories(session: ActivitySessionEntity, profile: UserProfileEntity?): Double? {
        val gross = session.calories?.takeIf { it.isFinite() && it >= 0 } ?: return null
        val end = session.endedAt ?: return null
        val minutes = (end - session.startedAt) / 60_000.0
        if (minutes <= 0) return null
        val rest = DailyCalorieEstimator.bmrPerMinute(
            weightKg = profile?.weightKg ?: 70.0,
            heightCm = profile?.heightCm ?: 170.0,
            age = profile?.age ?: 35,
            sex = profile?.sex,
        )
        return (gross - rest * minutes).coerceAtLeast(0.0)
    }
}
