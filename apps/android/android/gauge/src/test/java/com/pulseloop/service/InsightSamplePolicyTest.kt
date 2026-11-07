package com.pulseloop.service

import com.pulseloop.ring.MeasurementKind
import org.junit.Assert.*
import org.junit.Test

class InsightSamplePolicyTest {
    @Test fun `cool finger temperatures and low oxygen are not discarded as unhealthy`() {
        assertTrue(InsightSamplePolicy.accepts(MeasurementKind.TEMPERATURE, 30.0))
        assertTrue(InsightSamplePolicy.accepts(MeasurementKind.SPO2, 65.0))
        assertFalse(InsightSamplePolicy.accepts(MeasurementKind.TEMPERATURE, Double.NaN))
        assertFalse(InsightSamplePolicy.accepts(MeasurementKind.HEART_RATE, 0.0))
    }

    @Test fun `duplicate burst does not establish nighttime coverage`() {
        assertTrue(InsightSamplePolicy.nightlyValues(List(20) { VitalSample(0L, 60.0) }).isEmpty())
        assertEquals(3, InsightSamplePolicy.nightlyValues(listOf(
            VitalSample(0L, 60.0), VitalSample(600_000L, 61.0), VitalSample(1_200_000L, 62.0))).size)
    }
}
