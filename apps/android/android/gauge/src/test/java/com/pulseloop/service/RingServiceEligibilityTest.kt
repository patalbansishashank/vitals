package com.pulseloop.service

import android.content.pm.ServiceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RingServiceEligibilityTest {
    @Test fun allEligibilityCombinations() {
        for (paired in listOf(false, true)) for (keep in listOf(false, true)) for (stopped in listOf(false, true)) {
            assertEquals(paired && keep && !stopped, RingServiceEligibility.eligible(paired, keep, stopped))
        }
    }

    /** S18: the phone counter (and the command loop riding on the service) never wait for the ring. */
    @Test fun `the service runs for the phone alone, whatever the ring`() {
        for (paired in listOf(false, true)) for (keep in listOf(false, true)) for (stopped in listOf(false, true)) {
            val plan = RingServiceEligibility.plan(paired, keep, stopped, activityRecognition = true, hasStepCounter = true)
            assertTrue(plan.runService)
            assertTrue(plan.commandsInService)
            assertTrue(plan.phone)
            assertEquals(paired && keep && !stopped, plan.link)
        }
    }

    @Test fun `no ring and a user disconnect keep the link off but not the phone`() {
        val noRing = RingServiceEligibility.plan(false, true, false, activityRecognition = true, hasStepCounter = true)
        assertFalse(noRing.link); assertTrue(noRing.runService)
        val disconnected = RingServiceEligibility.plan(true, true, true, activityRecognition = true, hasStepCounter = true)
        assertFalse(disconnected.link); assertTrue(disconnected.runService)
    }

    @Test fun `without the phone grant or a counter, only the link can run the service`() {
        for (ar in listOf(false, true)) for (counter in listOf(false, true)) {
            if (ar && counter) continue
            assertFalse(RingServiceEligibility.plan(false, true, false, ar, counter).runService)
            assertTrue(RingServiceEligibility.plan(true, true, false, ar, counter).runService)
        }
    }

    @Test fun `foreground types on Android 14 claim only what is held`() {
        val cd = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        val health = ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
        assertEquals(cd or health, RingServiceEligibility.foregroundTypes(34, link = true, bluetoothGranted = true, activityRecognition = true))
        // Phone only (no ring, or disconnected): never connectedDevice.
        assertEquals(health, RingServiceEligibility.foregroundTypes(34, link = false, bluetoothGranted = true, activityRecognition = true))
        assertEquals(health, RingServiceEligibility.foregroundTypes(34, link = true, bluetoothGranted = false, activityRecognition = true))
        assertEquals(cd, RingServiceEligibility.foregroundTypes(34, link = true, bluetoothGranted = true, activityRecognition = false))
        assertNull(RingServiceEligibility.foregroundTypes(34, link = false, bluetoothGranted = true, activityRecognition = false))
        assertNull(RingServiceEligibility.foregroundTypes(35, link = true, bluetoothGranted = false, activityRecognition = false))
        // Before 14 there is no per-type permission check: unchanged behaviour.
        assertEquals(cd, RingServiceEligibility.foregroundTypes(33, link = false, bluetoothGranted = false, activityRecognition = true))
    }
}
