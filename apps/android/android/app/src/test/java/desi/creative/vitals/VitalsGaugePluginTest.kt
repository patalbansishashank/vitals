package desi.creative.vitals

import desi.creative.vitals.GaugeWorkoutAck.Ack
import desi.creative.vitals.GaugeWorkoutAck.RESULT_ERROR
import desi.creative.vitals.GaugeWorkoutAck.RESULT_OK
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Gauge's workout broadcast results mapped to the command channel's ack (energy SPEC §A.4 item 9), and the package choice. */
class VitalsGaugePluginTest {
    private val started = 1_793_000_000_000L
    private fun reply(code: Int, state: String = "idle", error: String? = null, session: String? = null) =
        GaugeWorkoutAck.reply(code, state, session, session?.let { "run" }, session?.let { started }, error)!!

    @Test
    fun choosesTheInstalledGauge() {
        assertEquals("com.pulseloop", GaugeWorkoutAck.choosePackage(setOf("com.pulseloop", "com.pulseloop.debug"), debuggable = false))
        assertEquals("com.pulseloop.debug", GaugeWorkoutAck.choosePackage(setOf("com.pulseloop", "com.pulseloop.debug"), debuggable = true))
        assertEquals("com.pulseloop", GaugeWorkoutAck.choosePackage(setOf("com.pulseloop"), debuggable = true))
        // a release Vitals never talks to an unknown debug Gauge, only to one signed with the owner's pinned certificate
        assertNull(GaugeWorkoutAck.choosePackage(setOf("com.pulseloop.debug"), debuggable = false))
        assertNull(GaugeWorkoutAck.choosePackage(setOf("com.pulseloop.debug"), debuggable = false, trustedDebug = false))
        assertEquals("com.pulseloop.debug", GaugeWorkoutAck.choosePackage(setOf("com.pulseloop.debug"), debuggable = false, trustedDebug = true))
        assertEquals("com.pulseloop", GaugeWorkoutAck.choosePackage(setOf("com.pulseloop", "com.pulseloop.debug"), debuggable = false, trustedDebug = true))
        assertNull(GaugeWorkoutAck.choosePackage(emptySet(), debuggable = true))
        assertEquals("com.pulseloop.debug.permission.CONTROL_WORKOUT", GaugeWorkoutAck.permission("com.pulseloop.debug"))
        assertEquals(GaugeWorkoutAck.ALIAS_DEBUG, GaugeWorkoutAck.aliasFor("com.pulseloop.debug"))
    }

    @Test
    fun localDataOnlyFromAPinnedGauge() {
        val both = setOf(GaugeWorkoutAck.RELEASE, GaugeWorkoutAck.DEBUG)
        // (r069 sync) health data: every package must carry the owner's pinned certificate, the release one too
        assertNull(GaugeLocalData.choosePackage(both, debuggable = false) { false })
        assertEquals(GaugeWorkoutAck.RELEASE, GaugeLocalData.choosePackage(both, debuggable = false) { true })
        assertEquals(GaugeWorkoutAck.DEBUG, GaugeLocalData.choosePackage(both, debuggable = false) { it == GaugeWorkoutAck.DEBUG })
        assertEquals(GaugeWorkoutAck.DEBUG, GaugeLocalData.choosePackage(both, debuggable = true) { true })
        assertNull(GaugeLocalData.choosePackage(emptySet(), debuggable = false) { true })
        assertEquals("com.pulseloop.debug.vitals", GaugeLocalData.authority(GaugeWorkoutAck.DEBUG))
        assertEquals(setOf("snapshot", "flush"), GaugeLocalData.METHODS)
    }

    @Test
    fun trustsOnlyThePinnedDebugSigner() {
        assertEquals(true, GaugeWorkoutAck.isTrustedDebugSigner(setOf(GaugeWorkoutAck.TRUSTED_DEBUG_SIGNER)))
        assertEquals(false, GaugeWorkoutAck.isTrustedDebugSigner(setOf("00".repeat(32))))
        assertEquals(false, GaugeWorkoutAck.isTrustedDebugSigner(setOf(GaugeWorkoutAck.TRUSTED_DEBUG_SIGNER, "00".repeat(32))))
        assertEquals(false, GaugeWorkoutAck.isTrustedDebugSigner(emptySet()))
        assertEquals(64, GaugeWorkoutAck.sha256Hex(byteArrayOf(1, 2, 3)).length)
    }

    @Test
    fun noReceiverIsNoAnswer() {
        assertNull(GaugeWorkoutAck.reply(GaugeWorkoutAck.NO_ANSWER, null, null, null, null, null))
    }

    @Test
    fun startMapping() {
        val ok = GaugeWorkoutAck.map("workout.start", reply(RESULT_OK, "recording", session = "w-1"), null)
        assertEquals(Ack("done", null, mapOf("state" to "recording", "sessionId" to "w-1", "type" to "run", "startedAt" to GaugeWorkoutAck.iso(started))), ok)
        assertEquals("2026-10-26T07:33:20Z", GaugeWorkoutAck.iso(started))
        val already = GaugeWorkoutAck.map("workout.start", reply(RESULT_ERROR, "recording", "already_recording", "w-0"), null)
        assertEquals("rejected", already.status)
        assertEquals("already_recording", already.code)
        assertEquals("w-0", already.result["sessionId"])
        assertEquals(Ack("rejected", "bad_type"), GaugeWorkoutAck.map("workout.start", reply(RESULT_ERROR, error = "bad_type"), null))
        for (code in listOf("needs_activity_recognition", "foreground_start_blocked", "failed")) {
            assertEquals(Ack("failed", code), GaugeWorkoutAck.map("workout.start", reply(RESULT_ERROR, error = code), null))
        }
    }

    @Test
    fun pauseResumeStopMapping() {
        assertEquals(Ack("done", null, mapOf("state" to "paused")), GaugeWorkoutAck.map("workout.pause", reply(RESULT_OK, "paused", session = "w-1"), null))
        assertEquals(Ack("noop", null, mapOf("state" to "paused")), GaugeWorkoutAck.map("workout.pause", reply(RESULT_ERROR, "paused", "not_recording", "w-1"), null))
        assertEquals(Ack("rejected", "no_active_workout"), GaugeWorkoutAck.map("workout.pause", reply(RESULT_ERROR, error = "no_active_workout"), null))
        assertEquals(Ack("done", null, mapOf("state" to "recording")), GaugeWorkoutAck.map("workout.resume", reply(RESULT_OK, "recording", session = "w-1"), null))
        assertEquals(Ack("noop", null, mapOf("state" to "recording")), GaugeWorkoutAck.map("workout.resume", reply(RESULT_ERROR, "recording", "not_paused", "w-1"), null))
        assertEquals(Ack("rejected", "no_active_workout"), GaugeWorkoutAck.map("workout.resume", reply(RESULT_ERROR, error = "no_active_workout"), null))
        assertEquals(Ack("done", null, mapOf("state" to "idle", "sessionId" to "w-1")), GaugeWorkoutAck.map("workout.stop", reply(RESULT_OK), "w-1"))
        assertEquals(Ack("noop", null, mapOf("state" to "idle")), GaugeWorkoutAck.map("workout.stop", reply(RESULT_ERROR, error = "no_active_workout"), null))
    }

    @Test
    fun wrongWorkoutOnlyForAnotherActiveSession() {
        val active = reply(RESULT_OK, "recording", session = "w-2")
        assertTrue(GaugeWorkoutAck.wrongWorkout("w-1", active))
        assertFalse(GaugeWorkoutAck.wrongWorkout("w-2", active))
        assertFalse(GaugeWorkoutAck.wrongWorkout(null, active))
        // nothing recording: the action itself answers (a late stop is a noop)
        assertFalse(GaugeWorkoutAck.wrongWorkout("w-1", reply(RESULT_OK)))
    }

    @Test
    fun statusReportsTheSession() {
        assertEquals(Ack("done", null, mapOf("state" to "idle")), GaugeWorkoutAck.status(reply(RESULT_OK)))
        assertEquals("w-3", GaugeWorkoutAck.status(reply(RESULT_OK, "paused", session = "w-3")).result["sessionId"])
    }

    /** 0.6.3 S26: the catalogue activity travels to Gauge as `activity_type_id` only in Gauge's id shape. */
    @Test
    fun activityTypeIdShape() {
        assertEquals("activity_type_id", GaugeWorkoutAck.EXTRA_ACTIVITY_TYPE_ID)
        for (ok in listOf("air_bike", "walk", "treadmill_run", "a" + "b".repeat(47))) assertTrue(ok, GaugeWorkoutAck.ACTIVITY_TYPE_ID.matches(ok))
        for (bad in listOf("", "Air bike", "_walk", "walk-brisk", "a" + "b".repeat(48), "run\n")) assertFalse(bad, GaugeWorkoutAck.ACTIVITY_TYPE_ID.matches(bad))
    }

    /**
     * r063 FX3 (sR12/aR12): a start that asked for GPS keeps Gauge's `gps` and `warning` result extras in the ack, as the
     * server channel's `done` ack does, so Vitals can say "Recording without GPS" (Gauge 2.8.1 deliberate fallback).
     */
    @Test
    fun startKeepsTheGpsOutcome() {
        val off = GaugeWorkoutAck.reply(RESULT_OK, "recording", "w-9", "run", started, null, gps = "off", warning = "gps_permission_missing")!!
        val ack = GaugeWorkoutAck.map("workout.start", off, null)
        assertEquals("done", ack.status)
        assertEquals("off", ack.result["gps"])
        assertEquals("gps_permission_missing", ack.result["warning"])
        assertEquals("w-9", ack.result["sessionId"])
        val on = GaugeWorkoutAck.map("workout.start", GaugeWorkoutAck.reply(RESULT_OK, "recording", "w-9", "run", started, null, gps = "on")!!, null)
        assertEquals("on", on.result["gps"])
        assertFalse(on.result.containsKey("warning"))
        // a start without GPS carries neither, exactly as before
        val plain = GaugeWorkoutAck.map("workout.start", reply(RESULT_OK, "recording", session = "w-1"), null)
        assertFalse(plain.result.containsKey("gps"))
        assertFalse(plain.result.containsKey("warning"))
        // a status never invents one
        assertFalse(GaugeWorkoutAck.status(off.copy(gps = null, warning = null)).result.containsKey("gps"))
        assertEquals("gps", GaugeWorkoutAck.EXTRA_GPS)
        assertEquals("warning", GaugeWorkoutAck.EXTRA_WARNING)
    }

    /** r063 FX3: the action that fixes a no-GPS start: Gauge's location prompt, or the phone's location switch. */
    @Test
    fun gpsFixTarget() {
        assertEquals("com.pulseloop.action.GRANT_LOCATION", GaugeWorkoutAck.ACTION_GRANT_LOCATION)
        assertEquals("com.pulseloop.MainActivity", GaugeWorkoutAck.MAIN_ACTIVITY)
        assertEquals(GaugeWorkoutAck.GpsFix.GAUGE_PERMISSION, GaugeWorkoutAck.gpsFixFor("gps_permission_missing"))
        assertEquals(GaugeWorkoutAck.GpsFix.GAUGE_PERMISSION, GaugeWorkoutAck.gpsFixFor("gps_precise_permission_missing"))
        assertEquals(GaugeWorkoutAck.GpsFix.LOCATION_SETTINGS, GaugeWorkoutAck.gpsFixFor("gps_location_off"))
        assertEquals(GaugeWorkoutAck.GpsFix.GAUGE_PERMISSION, GaugeWorkoutAck.gpsFixFor(null))
    }
}
