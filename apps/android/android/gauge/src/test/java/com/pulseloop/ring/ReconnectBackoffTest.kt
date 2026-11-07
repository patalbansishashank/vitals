package com.pulseloop.ring

import org.junit.Assert.*
import org.junit.Test

class ReconnectBackoffTest {
    @Test fun scheduleNeverExhaustsAndResetStartsFresh() {
        val backoff = ReconnectBackoff()
        assertEquals(ReconnectBackoff.DELAYS, List(6) { backoff.nextDelay() })
        assertTrue(backoff.atCeiling)
        repeat(100) { assertEquals(300_000L, backoff.nextDelay()) }
        backoff.reset()
        assertFalse(backoff.atCeiling)
        assertEquals(5_000L, backoff.nextDelay())
    }
    @Test fun transientFailuresRetrySoonAndWedgedStackWaitsForEdge() {
        val backoff = ReconnectBackoff()
        assertEquals(5_000L, backoff.nextDelay(133))
        assertEquals(5_000L, backoff.nextDelay(22))
        assertEquals(30_000L, backoff.nextDelay(62))
        repeat(6) { backoff.nextDelay() }
        listOf(133, 22, 62).forEach { assertEquals(300_000L, backoff.nextDelay(it)) }
        listOf(8, 19).forEach { assertEquals(300_000L, backoff.nextDelay(it)) }
        assertNull(backoff.nextDelay(257))
        assertTrue(backoff.waitingForBluetooth)
        backoff.reset()
        assertFalse(backoff.waitingForBluetooth)
        assertEquals(5_000L, backoff.nextDelay())
    }

    @Test fun repeatedTransientErrorsReachAndStayAtFiveMinuteCeiling() {
        for (status in listOf(133, 22, 62)) {
            val backoff = ReconnectBackoff()
            assertEquals(listOf(5_000L, 5_000L, 30_000L, 60_000L, 120_000L, 300_000L),
                List(6) { backoff.nextDelay(status) })
            assertTrue(backoff.atCeiling)
            repeat(100) { assertEquals(300_000L, backoff.nextDelay(status)) }
            backoff.reset()
            assertEquals(5_000L, backoff.nextDelay(status))
            assertEquals(5_000L, backoff.nextDelay(status))
            assertEquals(30_000L, backoff.nextDelay(status))
        }
    }
}
