package com.pulseloop.service

import com.pulseloop.util.TimeUtil
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class LocalInsightStaleRowsTest {
    /** Nutrition no longer produces a score, so today's row from an older build is cleared. */
    @Test fun `a nutrition score left by an older build is always removed`() {
        val now = Instant.parse("2026-09-16T12:00:00Z").toEpochMilli()
        val ids = LocalInsightEngine.staleCurrentInsightIds(emptyList(), now)
        assertTrue(ids.contains("insight:nutrition_score:${TimeUtil.startOfDayLocal(now)}"))
    }
}
