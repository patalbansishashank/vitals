package com.pulseloop.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** (r087, A12) The dedicated sleep read no longer follows every pass. */
class SleepFollowUpTest {
    private val gap = SleepFollowUp.MIN_INTERVAL_MS

    @Test fun `the first pass of a connection is always followed by a read`() {
        val policy = SleepFollowUp()
        assertTrue(policy.due(0, requested = false))
        policy.read(0)
        assertFalse(policy.due(60_000, requested = false))
        policy.connected()
        assertTrue(policy.due(61_000, requested = false))
    }

    @Test fun `passes a minute apart share one read per interval`() {
        val policy = SleepFollowUp()
        var reads = 0
        for (minute in 0 until 120) {
            val at = minute * 60_000L
            if (policy.due(at, requested = false)) { policy.read(at); reads++ }
        }
        assertTrue("was 120", reads == (120 * 60_000L / gap).toInt())
    }

    @Test fun `a pass the person asked for is followed at once`() {
        val policy = SleepFollowUp()
        policy.read(0)
        assertFalse(policy.due(1_000, requested = false))
        assertTrue(policy.due(1_000, requested = true))
    }

    @Test fun `a pass that ends sends the read only when it is due, and counts it only when it went out`() {
        val policy = SleepFollowUp()
        var sent = 0
        var linkUp = true
        var held = false
        fun passEnded(at: Long, requested: Boolean = false) =
            policy.afterPass(at, requested, send = { if (linkUp) sent++; linkUp }, held = { held })

        passEnded(0)
        assertEquals("the first pass of a connection", 1, sent)
        passEnded(60_000)
        passEnded(120_000)
        assertEquals("not again a minute later", 1, sent)

        // Nothing could be asked of the ring: the pass after it tries again.
        linkUp = false
        passEnded(gap)
        linkUp = true
        passEnded(gap + 60_000)
        assertEquals(2, sent)

        // Asked, but the engine held it back inside the sleep window: every pass asks until one goes out.
        held = true
        passEnded(2 * gap + 60_000)
        passEnded(2 * gap + 120_000)
        assertEquals(4, sent)
        held = false
        passEnded(2 * gap + 180_000)
        assertEquals(5, sent)
        passEnded(2 * gap + 240_000)
        assertEquals("counted once it went out", 5, sent)

        passEnded(2 * gap + 300_000, requested = true)
        assertEquals("a pass the person asked for is followed at once", 6, sent)
    }

    @Test fun `a read that was held back is tried again at the next pass`() {
        val policy = SleepFollowUp()
        policy.read(0)
        assertTrue(policy.due(gap, requested = false))
        // Not sent (the sleep hold): nothing is recorded, so the pass after it is due as well.
        assertTrue(policy.due(gap + 60_000, requested = false))
    }
}
