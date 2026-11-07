package desi.creative.vitals

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OtaLogicTest {
    private val apk = 601
    private val embeddedBuiltAt = 1_000L
    private val bundles = mutableMapOf(
        "b1" to BundleInfo("b1", 601, 2_000),
        "b2" to BundleInfo("b2", 601, 3_000),
        "old" to BundleInfo("old", 600, 500),
        "future" to BundleInfo("future", 700, 4_000),
    )
    private fun boot(s: OtaState, code: Int = apk) = OtaLogic.boot(s, code, embeddedBuiltAt) { bundles[it] }

    @Test
    fun firstStartServesTheApksBundle() {
        val b = boot(OtaState())
        assertNull(b.serve)
        assertFalse(b.trial)
        assertEquals(apk, b.state.nativeVersionCode)
    }

    @Test
    fun aPendingBundleIsTriedOnTheNextColdStartAndConfirmedByReady() {
        val b = boot(OtaState(nativeVersionCode = apk, pending = "b1"))
        assertEquals("b1", b.serve)
        assertTrue(b.trial)
        assertNull(b.state.pending)
        assertNull(b.state.previous)
        val ok = OtaLogic.ready(b.state)
        assertTrue(ok.confirmed)
        // later starts serve it without a trial
        val again = boot(ok)
        assertEquals("b1", again.serve)
        assertFalse(again.trial)
    }

    @Test
    fun noReadyWithinTheTrialRollsBackAndMarksBad() {
        val running = boot(OtaState(nativeVersionCode = apk, current = "b1", pending = "b2")).state
        assertEquals("b2", running.current)
        assertEquals("b1", running.previous)
        val back = OtaLogic.rollBack(running)
        assertEquals("b1", back.current)
        assertTrue(back.confirmed)
        assertTrue("b2" in back.bad)
        assertFalse(OtaLogic.wanted(back, "b2"))
        // and the next cold start keeps serving b1
        assertEquals("b1", boot(back).serve)
    }

    @Test
    fun aTrialThatCrashedIsRolledBackOnTheNextStart() {
        val trial = boot(OtaState(nativeVersionCode = apk, pending = "b1")).state
        // process died before ready(): the state on disk still says tried, unconfirmed
        val next = boot(trial)
        assertNull(next.serve)
        assertFalse(next.trial)
        assertTrue("b1" in next.state.bad)
    }

    @Test
    fun readyAfterRollbackChangesNothing() {
        val s = OtaState(nativeVersionCode = apk, current = "b1")
        assertEquals(s, OtaLogic.ready(s))
        assertEquals(s, OtaLogic.rollBack(s))
    }

    @Test
    fun aBadVersionIsNeverServedOrWanted() {
        val s = OtaState(nativeVersionCode = apk, pending = "b1", bad = setOf("b1"))
        assertNull(boot(s).serve)
        assertFalse(OtaLogic.wanted(s, "b1"))
        assertTrue(OtaLogic.wanted(s, "b2"))
        assertFalse(OtaLogic.wanted(s, "../x"))
    }

    @Test
    fun anIncompatibleBundleIsSkipped() {
        val b = boot(OtaState(nativeVersionCode = apk, pending = "future"))
        assertNull(b.serve)
        assertEquals("needs a newer app", OtaLogic.acceptable(OtaState(), "future", bundles["future"]!!, apk, embeddedBuiltAt))
        assertEquals("older than the app's own bundle", OtaLogic.acceptable(OtaState(), "old", bundles["old"]!!, apk, embeddedBuiltAt))
        assertEquals("bundle.json names another version", OtaLogic.acceptable(OtaState(), "b2", bundles["b1"]!!, apk, embeddedBuiltAt))
        assertNull(OtaLogic.acceptable(OtaState(), "b1", bundles["b1"]!!, apk, embeddedBuiltAt))
    }

    @Test
    fun aNewApkResetsToItsOwnBundleUnlessADownloadedOneIsNewer() {
        val s = OtaState(nativeVersionCode = 600, current = "b1", previous = "old")
        // the new APK's bundle was built after b1
        val reset = OtaLogic.boot(s, apk, 2_500) { bundles[it] }
        assertNull(reset.serve)
        assertNull(reset.state.previous)
        // b1 is newer than the new APK's bundle and compatible: kept
        val kept = OtaLogic.boot(s, apk, 1_500) { bundles[it] }
        assertEquals("b1", kept.serve)
        assertEquals(apk, kept.state.nativeVersionCode)
    }

    @Test
    fun aMissingFolderFallsBackToTheLastGoodBundle() {
        val s = OtaState(nativeVersionCode = apk, current = "gone", previous = "b1")
        assertEquals("b1", boot(s).serve)
        assertNull(boot(OtaState(nativeVersionCode = apk, current = "gone")).serve)
    }

    @Test
    fun stateSurvivesAPropertiesRoundTrip() {
        val s = OtaState(701, "b2", false, true, "b1", "b3", setOf("x", "y"))
        assertEquals(s, OtaState.fromProperties(s.toProperties()))
        assertEquals(OtaState(), OtaState.fromProperties(java.util.Properties()))
        assertEquals(setOf("b1", "b2", "b3"), OtaLogic.keep(s))
    }

    @Test
    fun applyPendingStartsTrialAndReadyConfirmsIt() {
        val staged = OtaState(nativeVersionCode = apk, current = "b1", pending = "b2")
        val trial = OtaLogic.activatePending(staged, apk, embeddedBuiltAt) { bundles[it] }!!
        assertEquals("b2", trial.current)
        assertEquals("b1", trial.previous)
        assertNull(trial.pending)
        assertFalse(trial.confirmed)
        assertTrue(trial.tried)
        val confirmed = OtaLogic.ready(trial)
        assertTrue(confirmed.confirmed)
        assertEquals("b2", boot(confirmed).serve)
    }

    @Test
    fun applyPendingTimeoutRollsBackAndMarksBundleBad() {
        val trial = OtaLogic.activatePending(OtaState(nativeVersionCode = apk, pending = "b1"), apk, embeddedBuiltAt) { bundles[it] }!!
        val rolledBack = OtaLogic.rollBack(trial)
        assertNull(rolledBack.current)
        assertTrue("b1" in rolledBack.bad)
        assertNull(OtaLogic.activatePending(rolledBack.copy(pending = "b1"), apk, embeddedBuiltAt) { bundles[it] })
    }

    @Test
    fun applyPendingRequiresAConfirmedCurrentAndCompatibleIntactBundle() {
        val staged = OtaState(nativeVersionCode = apk, current = "b1", pending = "b2")
        assertNull(OtaLogic.activatePending(staged.copy(confirmed = false), apk, embeddedBuiltAt) { bundles[it] })
        assertNull(OtaLogic.activatePending(staged.copy(pending = "future"), apk, embeddedBuiltAt) { bundles[it] })
        assertNull(OtaLogic.activatePending(staged.copy(pending = "old"), apk, embeddedBuiltAt) { bundles[it] })
        assertNull(OtaLogic.activatePending(staged, apk, embeddedBuiltAt) { null })
        assertNull(OtaLogic.activatePending(staged, apk, embeddedBuiltAt) { bundles["b1"] })
    }

    @Test
    fun oldBridgeReadyAndOldWatchdogCannotOwnTheNewTrial() {
        val guard = OtaTrialGuard()
        val oldBridge = Any()
        val newBridge = Any()
        val oldTimer = guard.attach(oldBridge)
        guard.invalidate() // applyWebNow invalidates the page that requested Restart
        assertFalse(guard.acceptsReady(oldBridge))
        assertFalse(guard.acceptsTimeout(oldTimer))
        val newTimer = guard.attach(newBridge)
        assertFalse(guard.acceptsReady(oldBridge))
        assertTrue(guard.acceptsReady(newBridge))
        assertFalse(guard.acceptsTimeout(oldTimer))
        assertTrue(guard.acceptsTimeout(newTimer))
        guard.invalidate() // ready() confirmed the new page
        assertFalse(guard.acceptsTimeout(newTimer))
    }
}
