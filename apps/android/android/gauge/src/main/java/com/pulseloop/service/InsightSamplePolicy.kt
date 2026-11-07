package com.pulseloop.service

import com.pulseloop.ring.MeasurementKind

/** Broad signal bounds, not healthy ranges. Raw observations remain stored unchanged. */
object InsightSamplePolicy {
    fun accepts(kind: MeasurementKind, value: Double): Boolean = value.isFinite() && when (kind) {
        MeasurementKind.HEART_RATE -> value in 30.0..240.0
        MeasurementKind.HRV -> value > 0.0 && value <= 500.0
        MeasurementKind.SPO2 -> value in 50.0..100.0
        MeasurementKind.TEMPERATURE -> value in 15.0..45.0
        else -> value > 0.0
    }

    /** A lone observation must not define a whole night's physiology. */
    fun nightlyValues(samples: List<VitalSample>): List<Double> {
        val unique = samples.distinctBy { it.timestampMs }.sortedBy { it.timestampMs }
        if (unique.size < 3 || unique.last().timestampMs - unique.first().timestampMs < 20 * 60_000L)
            return emptyList()
        return unique.map { it.value }
    }
}
