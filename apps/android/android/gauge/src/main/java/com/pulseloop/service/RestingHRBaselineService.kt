package com.pulseloop.service

import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.UserProfileEntity
import com.pulseloop.ring.MeasurementKind
import kotlin.math.roundToInt

/**
 * Ported from RestingHRBaselineService.swift (iOS #95).
 * Learns a personalized resting-HR baseline from primary-sleep resting-HR estimates over the
 * trailing 30 days. Each night contributes one p10 value, and their median becomes the baseline;
 * this prevents a long, densely sampled night or waking activity from dominating it.
 *
 * Called from [EventPersistenceSubscriber] on sync completion. That wiring is load-bearing: with no
 * caller, `hrRestingBaseline` stays null forever and [VitalsThresholdEngine]'s default `"auto"` HR
 * zone mode silently falls back to fixed 50/90 boundaries — which is how it shipped on first port,
 * so the feature moved everyone's "normal" band without giving anyone the personalisation that
 * justified moving it.
 */
object RestingHRBaselineService {

    private const val BASELINE_DAYS = 30
    private const val MIN_NIGHTS = 7
    private const val REFRESH_INTERVAL_MS = 6 * 3600_000L

    suspend fun refreshIfStale(db: PulseLoopDatabase) {
        val profile = db.userProfileDao().get() ?: return
        val lastUpdate = profile.hrRestingBaselineUpdatedAt ?: 0L
        val now = System.currentTimeMillis()
        if (now - lastUpdate < REFRESH_INTERVAL_MS) return
        refresh(db, profile)
    }

    /** Recompute now, whatever the last refresh (after the v33 duplicate cleanup). */
    suspend fun refreshNow(db: PulseLoopDatabase) {
        val profile = db.userProfileDao().get() ?: return
        refresh(db, profile)
    }

    private suspend fun refresh(db: PulseLoopDatabase, profile: UserProfileEntity) {
        val now = System.currentTimeMillis()
        val start = now - BASELINE_DAYS * 86_400_000L
        // One primary (longest) real sleep per waking day. Demo sessions can coexist with ring
        // data and must never contribute to a persisted physiological baseline.
        val primarySleeps = db.sleepSessionDao().startingInRangeReal(start, now)
            .filter {
                it.sourceRaw !in setOf("demo", "mock") && it.totalMinutes > 0 &&
                    it.startAt >= start && it.endAt <= now
            }
            .groupBy { it.date }
            .values
            .mapNotNull { day -> day.maxByOrNull { it.totalMinutes } }

        val nightly = primarySleeps.mapNotNull { sleep ->
            val values = db.measurementDao()
                .rangeReal(MeasurementKind.HEART_RATE.name, sleep.startAt, sleep.endAt)
                .map { it.value }
                .filter { it.isFinite() && it > 0 }
                .sorted()
            if (values.size < 3) null else percentile(values, 0.10)
        }.sorted()
        val rounded = if (nightly.size < MIN_NIGHTS) profile.hrRestingBaseline
            else (percentile(nightly, 0.50) * 2).roundToInt() / 2.0
        // Record an attempted refresh even with an unchanged baseline or insufficient nights;
        // otherwise every sync repeats the full scan indefinitely on those common paths.
        db.userProfileDao().upsert(profile.copy(
            hrRestingBaseline = rounded,
            hrRestingBaselineUpdatedAt = now,
            updatedAt = now,
        ))
    }

    private fun percentile(sorted: List<Double>, fraction: Double): Double {
        if (sorted.isEmpty()) return 0.0
        if (sorted.size == 1) return sorted.first()
        val rank = fraction * (sorted.size - 1)
        val lower = rank.toInt()
        val upper = kotlin.math.ceil(rank).toInt().coerceAtMost(sorted.size - 1)
        if (lower == upper) return sorted[lower]
        val weight = rank - lower
        return sorted[lower] * (1 - weight) + sorted[upper] * weight
    }
}
