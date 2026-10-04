package desi.creative.vitals

import desi.creative.vitals.BootDecision.Outcome
import org.junit.Assert.assertEquals
import org.junit.Test

class BootDecisionTest {
    @Test
    fun notifiesAfterBootWhenAskedAndRingKnown() {
        assertEquals(
            Outcome.NOTIFY_TAP_TO_CONNECT,
            BootDecision.decide(BootDecision.ACTION_BOOT, keepConnected = true, ringKnown = true, appRunning = false)
        )
        assertEquals(
            Outcome.NOTIFY_TAP_TO_CONNECT,
            BootDecision.decide(BootDecision.ACTION_REPLACED, keepConnected = true, ringKnown = true, appRunning = false)
        )
    }

    @Test
    fun staysQuietWithoutTheSwitchOrARing() {
        assertEquals(
            Outcome.NOTHING,
            BootDecision.decide(BootDecision.ACTION_BOOT, keepConnected = false, ringKnown = true, appRunning = false)
        )
        assertEquals(
            Outcome.NOTHING,
            BootDecision.decide(BootDecision.ACTION_BOOT, keepConnected = true, ringKnown = false, appRunning = false)
        )
    }

    @Test
    fun staysQuietWhenTheAppAlreadyRuns() {
        assertEquals(
            Outcome.NOTHING,
            BootDecision.decide(BootDecision.ACTION_BOOT, keepConnected = true, ringKnown = true, appRunning = true)
        )
    }

    @Test
    fun ignoresOtherActions() {
        assertEquals(
            Outcome.NOTHING,
            BootDecision.decide("android.bluetooth.adapter.action.STATE_CHANGED", true, true, false)
        )
        assertEquals(Outcome.NOTHING, BootDecision.decide(null, true, true, false))
    }
}
