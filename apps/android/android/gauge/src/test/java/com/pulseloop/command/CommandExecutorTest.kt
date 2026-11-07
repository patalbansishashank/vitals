package com.pulseloop.command

import com.pulseloop.shortvideo.ShortVideoApp
import com.pulseloop.shortvideo.ShortVideoPrefs
import com.pulseloop.shortvideo.ShortVideoSettings
import com.pulseloop.ui.tile.WorkoutControl.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Each command and its result mapping (energy SPEC §A.4 items 3 and 9). */
class CommandExecutorTest {
    private val t0 = 1_793_000_000_000L
    private val workout = FakeWorkout()
    private val reels = FakeReels()
    private val hr = FakeHeartRate(takesMs = 0)
    private val updates = FakeUpdates()
    private val sync = FakeRingSync(takesMs = 0)
    private val uploads = FakeUploads()
    private val executor = CommandExecutor(workout, reels, hr, updates, ringSync = sync, uploads = uploads)

    private suspend fun run(type: String, vararg payload: Pair<String, Any>) = executor.execute(command("c-1", type, t0, 60_000, 1, *payload))
    private fun JsonObject?.s(key: String) = this?.get(key)?.jsonPrimitive?.content

    @Test fun `workout start maps each GB outcome`() = runTest {
        val ok = run("workout.start", "type" to "run", "useGps" to true)
        assertEquals("done", ok.status)
        assertEquals("recording", ok.result.s("state"))
        assertEquals("w-new", ok.result.s("sessionId"))
        assertEquals("run", ok.result.s("type"))
        assertEquals("2026-10-26T07:33:20Z", ok.result.s("startedAt"))
        assertEquals(listOf("start:run:true"), workout.calls)

        val again = run("workout.start", "type" to "walk")
        assertEquals(CommandAck.rejected("already_recording").copy(result = again.result), again)
        assertEquals("w-new", again.result.s("sessionId"))

        workout.current = null
        assertEquals(CommandAck.rejected("bad_type"), run("workout.start", "type" to "swim"))
        workout.blocker = "needs_activity_recognition"
        assertEquals(CommandAck.failed("needs_activity_recognition"), run("workout.start", "type" to "walk"))
    }

    @Test fun `workout start keeps the old shape and takes an optional catalogue activity id`() = runTest {
        // The 2.8.0 command: no id, no new keys in the ack.
        val old = run("workout.start", "type" to "walk")
        assertEquals("done", old.status)
        assertEquals(setOf("state", "sessionId", "type", "startedAt"), old.result!!.keys)
        assertNull(workout.lastStart!!.activityTypeId)

        workout.current = null
        val ok = run("workout.start", "type" to "other", "activityTypeId" to "treadmill_run")
        assertEquals("done", ok.status)
        assertEquals("treadmill_run", workout.lastStart!!.activityTypeId)
        assertEquals("other", ok.result.s("type"))
        assertEquals("treadmill_run", ok.result.s("activityTypeId"))

        // The upload's spelling is accepted too; both spellings must agree.
        workout.current = null
        assertEquals("done", run("workout.start", "type" to "other", "activity_type_id" to "air_bike").status)
        assertEquals("air_bike", workout.lastStart!!.activityTypeId)
        workout.current = null
        assertEquals(CommandAck.rejected("bad_activity_type"), run("workout.start", "type" to "other", "activityTypeId" to "air_bike", "activity_type_id" to "mudgar_pair"))
        assertEquals(CommandAck.rejected("bad_activity_type"), run("workout.start", "type" to "other", "activityTypeId" to "Air Bike"))
        assertEquals(CommandAck.rejected("bad_activity_type"), run("workout.start", "type" to "other", "activityTypeId" to 7))
        // The coarse type is still required and still checked.
        assertEquals(CommandAck.rejected("bad_type"), run("workout.start", "type" to "treadmill_run", "activityTypeId" to "treadmill_run"))
        assertTrue(CommandExecutor.ACTIVITY_TYPE_CAPABILITY in CommandExecutor.CAPABILITIES)
    }

    @Test fun `a gps start without the location grant starts without a route and says why`() = runTest {
        workout.gpsWarning = "gps_permission_missing"
        val ack = run("workout.start", "type" to "run", "useGps" to true)
        assertEquals("done", ack.status)
        assertEquals("recording", ack.result.s("state"))
        assertEquals("off", ack.result.s("gps"))
        assertEquals("gps_permission_missing", ack.result.s("warning"))

        workout.current = null
        workout.gpsWarning = null
        val on = run("workout.start", "type" to "run", "useGps" to true)
        assertEquals("on", on.result.s("gps"))
        assertNull(on.result!!["warning"])
    }

    @Test fun `pause, resume and stop are idempotent by state`() = runTest {
        assertEquals(CommandAck.rejected("no_active_workout"), run("workout.pause"))
        assertEquals(CommandAck.rejected("no_active_workout"), run("workout.resume"))
        assertEquals("noop", run("workout.stop").status)

        workout.current = Session("w-1", "walk", "recording", t0)
        assertEquals("done", run("workout.pause").status)
        val again = run("workout.pause")
        assertEquals("noop", again.status)
        assertEquals("paused", again.result.s("state"))
        assertEquals("done", run("workout.resume").status)
        assertEquals("noop", run("workout.resume").status)
        val stop = run("workout.stop", "sessionId" to "w-1")
        assertEquals("done", stop.status)
        assertEquals("idle", stop.result.s("state"))
        assertEquals("w-1", stop.result.s("sessionId"))
    }

    @Test fun `a sessionId that is not the active one never touches it`() = runTest {
        workout.current = Session("w-2", "walk", "recording", t0)
        val r = run("workout.stop", "sessionId" to "w-1")
        assertEquals("rejected", r.status)
        assertEquals("wrong_workout", r.code)
        assertTrue(workout.calls.isEmpty())
        assertEquals("recording", workout.current?.status)
    }

    @Test fun `reels set applies only its fields, through the settings clamp`() = runTest {
        val r = run("reels.set", "dailyLimit" to 42, "apps" to listOf("youtube"), "countdownSeconds" to 10)
        assertEquals("done", r.status)
        val applied = r.result!!["applied"]!!.jsonObject
        assertEquals(42, applied["dailyLimit"]!!.jsonPrimitive.int)
        assertEquals(listOf("youtube"), applied["apps"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(setOf(ShortVideoApp.YOUTUBE), reels.prefs.enabledApps)
        // the switches Vitals may never touch
        assertTrue(reels.prefs.disclosureAccepted)
        assertTrue(reels.prefs.verboseDebug)

        // Gauge's own range check refuses out-of-range values before anything runs
        val before = reels.calls
        for (bad in listOf(arrayOf<Pair<String, Any>>("dailyLimit" to 0), arrayOf("dailyLimit" to 501), arrayOf("countdownSeconds" to 2), arrayOf("apps" to listOf("tiktok")),
            arrayOf("disclosureAccepted" to true), arrayOf("dailyLimit" to "20"), arrayOf("dailyLimit" to 20.5), arrayOf())) {
            assertEquals(CommandAck.rejected("bad_payload"), run("reels.set", *bad))
        }
        assertEquals(before, reels.calls)
    }

    @Test fun `the settings clamp holds for whatever reaches it`() {
        val p = ShortVideoSettings.sanitise(ShortVideoPrefs(dailyLimit = 9_999, countdownSeconds = 1))
        assertEquals(500, p.dailyLimit)
        assertEquals(3, p.countdownSeconds)
        assertEquals(ShortVideoLimits.LIMIT, 1..500)
        assertEquals(ShortVideoLimits.COUNTDOWN, 3..30)
    }

    @Test fun `heart rate maps each outcome and acks running first`() = runTest {
        var running = 0
        val ok = executor.execute(command("c-hr", "hr.measure", t0, 60_000)) { running++ }
        assertEquals(1, running)
        assertEquals("done", ok.status)
        assertEquals(62, ok.result!!["bpm"]!!.jsonPrimitive.int)
        assertEquals("2026-10-26T07:33:52Z", ok.result.s("observedAt"))
        val cases = mapOf(
            HeartRatePort.Outcome.WorkoutActive to CommandAck.rejected("workout_active"),
            HeartRatePort.Outcome.Busy to CommandAck.rejected("busy"),
            HeartRatePort.Outcome.Disconnected to CommandAck.failed("ring_disconnected"),
            HeartRatePort.Outcome.Refused to CommandAck.failed("ring_refused"),
            HeartRatePort.Outcome.NoReading to CommandAck.failed("no_reading"),
        )
        for ((outcome, ack) in cases) {
            hr.outcome = outcome
            assertEquals(ack, run("hr.measure"))
        }
        assertEquals(CommandAck.rejected("bad_payload"), run("hr.measure", "bpm" to 60))
    }

    @Test fun `update check maps each outcome`() = runTest {
        updates.result = UpdatePort.Result("READY", "2.9.0", 51)
        val ready = run("update.check")
        assertEquals("done", ready.status)
        assertEquals("READY", ready.result.s("outcome"))
        assertEquals("2.9.0", ready.result.s("versionName"))
        updates.result = UpdatePort.Result("UP_TO_DATE")
        assertNull(run("update.check").result!!["versionName"])
        updates.result = UpdatePort.Result("FAILED")
        assertEquals(CommandAck.failed("check_failed"), run("update.check"))
        updates.result = UpdatePort.Result("NEEDS_REPAIR")
        assertEquals(CommandAck.rejected("needs_repair"), run("update.check"))
        updates.result = UpdatePort.Result("NOT_PAIRED")
        assertEquals(CommandAck.rejected("not_paired"), run("update.check"))
    }

    @Test fun `lanes keep a measurement apart from workouts`() {
        assertEquals(CommandLane.WORKOUT, CommandExecutor.laneOf("workout.stop"))
        assertEquals(CommandLane.RING, CommandExecutor.laneOf("hr.measure"))
        assertEquals(CommandLane.APP, CommandExecutor.laneOf("reels.set"))
        assertEquals(CommandLane.APP, CommandExecutor.laneOf("update.check"))
        // one ring: a history sync waits behind a measurement, never beside it
        assertEquals(CommandLane.RING, CommandExecutor.laneOf("ring.sync"))
    }

    @Test fun `a measurement reaches the server before its answer (r068 B2)`() = runTest {
        val ok = run("hr.measure")
        assertEquals("done", ok.status)
        assertEquals(1, uploads.flushes)
        assertEquals("true", ok.result.s("uploaded"))
        // an upload that fails never turns the reading into a failure
        uploads.fails = true
        val stillOk = run("hr.measure")
        assertEquals("done", stillOk.status)
        assertEquals(62, stillOk.result!!["bpm"]!!.jsonPrimitive.int)
        assertEquals("false", stillOk.result.s("uploaded"))
        // no reading, nothing to upload
        hr.outcome = HeartRatePort.Outcome.NoReading
        run("hr.measure")
        assertEquals(2, uploads.flushes)
    }

    @Test fun `ring sync syncs, uploads, then answers, and maps each outcome (r068 B2)`() = runTest {
        var running = 0
        val ok = executor.execute(command("c-sync", "ring.sync", t0, 120_000)) { running++ }
        assertEquals(1, running)
        assertEquals("done", ok.status)
        assertEquals("2026-10-26T07:34:50Z", ok.result.s("syncedAt"))
        assertEquals("true", ok.result.s("complete"))
        assertEquals("true", ok.result.s("uploaded"))
        assertEquals(1, uploads.flushes)

        sync.outcome = RingSyncPort.Outcome.Synced(t0, complete = false)
        uploads.emptied = false
        val partial = run("ring.sync")
        assertEquals("done", partial.status)
        assertEquals("false", partial.result.s("complete"))
        assertEquals("false", partial.result.s("uploaded"))

        sync.outcome = RingSyncPort.Outcome.Disconnected
        assertEquals(CommandAck.failed("ring_disconnected"), run("ring.sync"))
        sync.outcome = RingSyncPort.Outcome.Busy
        assertEquals(CommandAck.rejected("busy"), run("ring.sync"))
        assertEquals(2, uploads.flushes)
        assertEquals(CommandAck.rejected("bad_payload"), run("ring.sync", "days" to 2))
        assertTrue("ring.sync" in CommandExecutor.CAPABILITIES)
        // a Gauge without the ring wired in says so instead of pretending
        val bare = CommandExecutor(workout, reels, hr, updates)
        assertEquals(CommandAck.failed("ring_disconnected"), bare.execute(command("c-sync2", "ring.sync", t0, 120_000)))
    }
}
