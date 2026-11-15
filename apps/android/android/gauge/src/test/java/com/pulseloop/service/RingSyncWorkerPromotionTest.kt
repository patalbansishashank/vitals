package com.pulseloop.service

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** (r087, A6) A refused foreground promotion must not cost the 15-minute job its pass. */
class RingSyncWorkerPromotionTest {
    @Test fun `a promotion Android allows is reported`() = runBlocking {
        var promoted = 0
        assertTrue(promoteIfAllowed { promoted++ })
        assertEquals(1, promoted)
    }

    @Test fun `a background start Android refuses is not an error`() = runBlocking {
        // Android 12's ForegroundServiceStartNotAllowedException is an IllegalStateException.
        assertFalse(promoteIfAllowed { throw IllegalStateException("startForegroundService() not allowed") })
        assertFalse(promoteIfAllowed { throw SecurityException("missing foreground service type permission") })
        assertFalse(promoteIfAllowed { throw java.util.concurrent.ExecutionException(IllegalStateException("wrapped")) })
    }

    @Test fun `cancellation and real failures are not swallowed`() = runBlocking {
        try {
            promoteIfAllowed { throw CancellationException("stopped") }
            fail("cancellation must pass through")
        } catch (_: CancellationException) {}
        try {
            promoteIfAllowed { throw java.io.IOException("unrelated") }
            fail("an unrelated failure must pass through")
        } catch (_: java.io.IOException) {}
        try {
            promoteIfAllowed { throw java.util.concurrent.ExecutionException(java.io.IOException("unrelated")) }
            fail("an unrelated wrapped failure must pass through")
        } catch (_: java.util.concurrent.ExecutionException) {}
    }
}
