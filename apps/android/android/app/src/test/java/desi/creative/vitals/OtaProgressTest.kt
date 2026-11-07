package desi.creative.vitals

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OtaProgressTest {
    @Test fun actualBytesAreThrottledAndCompletionIsNotReadiness() {
        var now = 0L
        val events = mutableListOf<OtaProgress>()
        val progress = OtaProgressReporter(1000, events::add) { now }
        progress.bytes(0)
        progress.bytes(100)
        now = 199
        progress.bytes(200)
        assertEquals(listOf(0L), events.map { it.received })
        now = 200
        progress.bytes(300)
        progress.bytes(1000)
        progress.verifying()
        progress.verifying()
        progress.bytes(500)
        assertEquals(listOf(0L, 300L, 1000L, 1000L), events.map { it.received })
        assertEquals(listOf("downloading", "downloading", "downloading", "verifying"), events.map { it.phase })
        assertTrue(events.all { it.total == 1000L })
    }

    @Test fun invalidOrRegressiveCountsCannotBecomeProgress() {
        val events = mutableListOf<OtaProgress>()
        val progress = OtaProgressReporter(100, events::add) { 500L }
        progress.bytes(-1)
        progress.bytes(101)
        progress.verifying()
        assertTrue(events.isEmpty())
        progress.bytes(100)
        progress.bytes(50)
        assertEquals(listOf(100L), events.map { it.received })
    }

    @Test fun detachedBridgeFailuresNeverAbortTheDownload() {
        var reports = 0
        val progress = OtaProgressReporter(100, { reports++; throw IllegalStateException("detached") })
        progress.bytes(0)
        progress.bytes(100)
        progress.verifying()
        assertEquals(3, reports)
    }
}
