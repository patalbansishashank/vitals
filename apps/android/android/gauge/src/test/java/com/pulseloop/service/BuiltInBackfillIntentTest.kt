package com.pulseloop.service

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BuiltInBackfillIntentTest {
    @Test fun linkDropBeforeDeepInvocationKeepsRecoveryQueued() {
        val intent = BuiltInBackfillIntent()
        intent.queue()
        // Loading settings/profile was cancelled before refresh was called.
        assertFalse(intent.authAccepted())
        assertTrue(intent.queued)
        intent.deepInvoked()
        assertTrue(intent.authAccepted())
        assertFalse(intent.queued)
    }

    @Test fun rejectionThenReconnectKeepsOneDeepRecoveryUntilAccepted() {
        val intent = BuiltInBackfillIntent()
        intent.queue()
        intent.deepInvoked()
        // No acceptance on the first GATT; the next connection must still choose deep.
        assertTrue(intent.queued)
        intent.deepInvoked()
        assertTrue(intent.authAccepted())
        assertFalse(intent.authAccepted())
    }
}
