package com.pulseloop.ui.tile

import android.service.quicksettings.Tile
import com.pulseloop.ui.tile.WorkoutControl.Command
import com.pulseloop.ui.tile.WorkoutControl.Session
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The tile, the ring-notification action and the Vitals API all speak one intent (SPEC §GB.5). */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class WorkoutTileServiceTest {

    private class FakeController(var current: Session? = null, var blocker: String? = null, var failStart: Exception? = null) : WorkoutControl.Controller {
        val calls = mutableListOf<String>()
        override suspend fun active() = current
        override fun startBlocker() = blocker
        override suspend fun start(type: String, useGps: Boolean): Session {
            calls += "start:$type:$useGps"
            current = Session("s1", type, "recording", 1_000)
            failStart?.let { throw it }
            return current!!
        }
        override suspend fun pause(session: Session) = session.copy(status = "paused").also { calls += "pause"; current = it }
        override suspend fun resume(session: Session) = session.copy(status = "recording").also { calls += "resume"; current = it }
        override suspend fun finish(session: Session) { calls += "finish"; current = null }
        override suspend fun cancel(session: Session) { calls += "cancel"; current = null }
    }

    @Test fun `a tap starts a walk when idle and finishes when recording or paused`() {
        assertEquals(Command.Start("walk"), WorkoutTileService.commandFor(null))
        assertEquals(Command.Stop, WorkoutTileService.commandFor("recording"))
        assertEquals(Command.Stop, WorkoutTileService.commandFor("paused"))
        assertEquals(Tile.STATE_INACTIVE, WorkoutTileService.tileState(null).first)
        assertEquals(Tile.STATE_ACTIVE, WorkoutTileService.tileState("recording").first)
    }

    @Test fun `the intent is explicit, names the receiver and round-trips every command`() {
        val start = WorkoutControl.intent("com.pulseloop", Command.Start("run", useGps = true))
        assertEquals("com.pulseloop", start.component!!.packageName)
        assertEquals(WorkoutControl.RECEIVER_CLASS, start.component!!.className)
        assertEquals(WorkoutControl.ACTION_START, start.action)
        assertEquals("run", start.getStringExtra(WorkoutControl.EXTRA_TYPE))
        for (c in listOf(Command.Start("cycle"), Command.Pause, Command.Resume, Command.Stop, Command.Status)) {
            assertEquals(c, WorkoutControl.parse(WorkoutControl.intent("com.pulseloop.debug", c)))
        }
        // A bare Vitals intent with no extras is a walk without GPS.
        assertEquals(Command.Start("walk", false), WorkoutControl.parse(android.content.Intent(WorkoutControl.ACTION_START)))
        assertNull(WorkoutControl.parse(android.content.Intent("something.else")))
        assertEquals("com.pulseloop.permission.CONTROL_WORKOUT", WorkoutControl.permission("com.pulseloop"))
    }

    @Test fun `start, pause, resume and stop drive the controller and report state`() = runBlocking {
        val c = FakeController()
        val started = WorkoutControl.dispatch(c, Command.Start("walk"))
        assertEquals(WorkoutControl.RESULT_OK, started.code)
        assertEquals("recording", started.state)
        assertEquals("s1", started.extras().getString(WorkoutControl.EXTRA_SESSION_ID))
        assertEquals("already_recording", WorkoutControl.dispatch(c, Command.Start("run")).error)
        assertEquals("paused", WorkoutControl.dispatch(c, Command.Pause).state)
        assertEquals("not_recording", WorkoutControl.dispatch(c, Command.Pause).error)
        assertEquals("recording", WorkoutControl.dispatch(c, Command.Resume).state)
        assertEquals("not_paused", WorkoutControl.dispatch(c, Command.Resume).error)
        val stopped = WorkoutControl.dispatch(c, Command.Stop)
        assertEquals("idle", stopped.state)
        assertEquals("no_active_workout", WorkoutControl.dispatch(c, Command.Stop).error)
        assertEquals(listOf("start:walk:false", "pause", "resume", "finish"), c.calls)
    }

    @Test fun `bad types, blockers and a refused foreground start fail cleanly`() = runBlocking {
        assertEquals("bad_type", WorkoutControl.dispatch(FakeController(), Command.Start("mudgar")).error)
        val blocked = FakeController(blocker = "needs_activity_recognition")
        assertEquals("needs_activity_recognition", WorkoutControl.dispatch(blocked, Command.Start("walk")).error)
        assertTrue(blocked.calls.isEmpty())
        val refused = FakeController(failStart = IllegalStateException("startForegroundService() not allowed"))
        val out = WorkoutControl.dispatch(refused, Command.Start("walk"))
        assertEquals("foreground_start_blocked", out.error)
        assertEquals(listOf("start:walk:false", "cancel"), refused.calls)
        assertNull("the half-started session is cancelled", refused.current)
    }

    @Test fun `the intent carries a catalogue activity id and the result reports it with the gps fallback`() = runBlocking {
        val cmd = Command.Start("other", useGps = true, activityTypeId = "air_bike")
        val intent = WorkoutControl.intent("com.pulseloop", cmd)
        assertEquals("air_bike", intent.getStringExtra(WorkoutControl.EXTRA_ACTIVITY_TYPE_ID))
        assertEquals(cmd, WorkoutControl.parse(intent))
        // An old intent has no id.
        assertNull(WorkoutControl.parse(WorkoutControl.intent("com.pulseloop", Command.Start("walk")))!!.let { (it as Command.Start).activityTypeId })

        assertEquals("bad_activity_type", WorkoutControl.dispatch(FakeController(), Command.Start("other", activityTypeId = "Air Bike!")).error)

        val gpsLess = object : WorkoutControl.Controller by FakeController() {
            override suspend fun start(command: Command.Start) = WorkoutControl.Started(
                Session("s2", command.type, "recording", 2_000, command.activityTypeId), gps = "off", warning = "gps_permission_missing",
            )
        }
        val out = WorkoutControl.dispatch(gpsLess, cmd)
        assertEquals(WorkoutControl.RESULT_OK, out.code)
        val extras = out.extras()
        assertEquals("air_bike", extras.getString(WorkoutControl.EXTRA_ACTIVITY_TYPE_ID))
        assertEquals("other", extras.getString(WorkoutControl.EXTRA_TYPE))
        assertEquals("off", extras.getString(WorkoutControl.EXTRA_GPS))
        assertEquals("gps_permission_missing", extras.getString(WorkoutControl.EXTRA_WARNING))
        // A plain start reports neither.
        val plain = WorkoutControl.dispatch(FakeController(), Command.Start("walk")).extras()
        assertNull(plain.getString(WorkoutControl.EXTRA_GPS))
        assertNull(plain.getString(WorkoutControl.EXTRA_ACTIVITY_TYPE_ID))
    }
}
