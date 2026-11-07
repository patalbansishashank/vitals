package com.pulseloop.ui.tile

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log
import androidx.core.content.ContextCompat
import com.pulseloop.PulseLoopRuntime
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.service.LiveWorkoutManager
import com.pulseloop.service.RecordingActivityType
import com.pulseloop.service.RecordingStart
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Gauge's workout surface (energy SPEC §GB.5). Gauge is headless, so a recording is started and
 * stopped without any Gauge screen, from three places that all run [WorkoutControl.dispatch]:
 *
 * 1. The quick-settings tile ([WorkoutTileService]): tap to start a walk, tap again to stop.
 * 2. The always-on ring notification's "Start walk" action (pause / resume / finish then live on
 *    the workout notification, as before).
 * 3. **The exported API for the Vitals app** ([WorkoutControlReceiver]): an explicit broadcast,
 *    protected by the `<applicationId>.permission.CONTROL_WORKOUT` permission.
 *
 * Every path ends in [LiveWorkoutManager], and ring sport mode is set exactly as for an in-app
 * start. The type is coarse on purpose (`walk | run | cycle | other`): Vitals fixes the real
 * activity type later.
 *
 * ## The intent API (for Vitals)
 *
 * Package `com.pulseloop` (debug builds: `com.pulseloop.debug`), receiver
 * `com.pulseloop.ui.tile.WorkoutControlReceiver`. The caller declares and holds
 * `<package>.permission.CONTROL_WORKOUT` (protection level `dangerous`, so Vitals requests it at
 * runtime; per the install rule the agent taps the prompt through adb) and lists the package in
 * `<queries>`. Send it with `sendOrderedBroadcast(intent, null, resultReceiver, null, 0, null, null)`
 * to read the result; a plain `sendBroadcast` works too, without a result.
 *
 * | Action | Extras in | Does |
 * |---|---|---|
 * | `com.pulseloop.action.WORKOUT_START` | `type` (`walk`, `run`, `cycle`, `other`; default `walk`), `use_gps` (boolean, default false), `activity_type_id` (optional catalogue id, 2.8.1) | starts a recording |
 * | `com.pulseloop.action.WORKOUT_PAUSE` | — | pauses the recording |
 * | `com.pulseloop.action.WORKOUT_RESUME` | — | resumes a paused one |
 * | `com.pulseloop.action.WORKOUT_STOP` | — | finishes and saves it (it then uploads as `activity/session`) |
 * | `com.pulseloop.action.WORKOUT_STATUS` | — | changes nothing |
 *
 * Result: `resultCode` [RESULT_OK] (-1) or [RESULT_ERROR] (1); result extras `state`
 * (`idle | recording | paused`), `session_id`, `type`, `started_at` (epoch ms) and
 * `activity_type_id` (when the start named one) when a recording exists, and `error` on failure:
 * `already_recording` (with the running session's extras), `no_active_workout`, `not_recording`,
 * `not_paused`, `bad_type`, `bad_activity_type` (an id outside `[a-z0-9_]{1,48}`), `needs_activity_recognition`
 * (Android 14+ needs it for the workout's `health` foreground service), `foreground_start_blocked`
 * (Android refused a background foreground-service start; Gauge's battery-optimisation exemption,
 * which its checklist asks for, is what normally allows it), `failed`.
 *
 * A start that asks for GPS also reports `gps`: `on`, or `off` with `warning` naming why
 * ([WorkoutGpsAccess]: `gps_permission_missing`, `gps_precise_permission_missing`,
 * `gps_location_off`). Such a start still succeeds, without a route: the deliberate no-GPS fallback.
 *
 * `activity_type_id` (0.6.3 S26) is Vitals' catalogue id (`treadmill_run`, `air_bike`,
 * `mudgar_pair`, ...). It is kept on the session and uploaded; the ring's sport mode follows
 * [RecordingActivityType.sportTypeFor], and `type` stays the coarse type, as before.
 */
object WorkoutControl {
    const val ACTION_START = "com.pulseloop.action.WORKOUT_START"
    const val ACTION_PAUSE = "com.pulseloop.action.WORKOUT_PAUSE"
    const val ACTION_RESUME = "com.pulseloop.action.WORKOUT_RESUME"
    const val ACTION_STOP = "com.pulseloop.action.WORKOUT_STOP"
    const val ACTION_STATUS = "com.pulseloop.action.WORKOUT_STATUS"
    const val EXTRA_TYPE = "type"
    const val EXTRA_USE_GPS = "use_gps"
    const val EXTRA_ACTIVITY_TYPE_ID = "activity_type_id"
    const val EXTRA_GPS = "gps"
    const val EXTRA_WARNING = "warning"
    const val EXTRA_STATE = "state"
    const val EXTRA_SESSION_ID = "session_id"
    const val EXTRA_STARTED_AT = "started_at"
    const val EXTRA_ERROR = "error"
    const val RESULT_OK = -1
    const val RESULT_ERROR = 1
    const val RECEIVER_CLASS = "com.pulseloop.ui.tile.WorkoutControlReceiver"
    const val PERMISSION_SUFFIX = ".permission.CONTROL_WORKOUT"
    val TYPES = listOf("walk", "run", "cycle", "other")
    const val DEFAULT_TYPE = "walk"

    sealed interface Command {
        data class Start(val type: String = DEFAULT_TYPE, val useGps: Boolean = false, val activityTypeId: String? = null) : Command
        data object Pause : Command
        data object Resume : Command
        data object Stop : Command
        data object Status : Command
    }

    data class Session(val id: String, val type: String, val status: String, val startedAt: Long, val activityTypeId: String? = null)

    /**
     * A start's result: the session, and for a start that asked for GPS whether a route is being
     * recorded ([gps] `on | off`) and, when not, why ([warning]).
     */
    data class Started(val session: Session, val gps: String? = null, val warning: String? = null)

    data class Outcome(
        val code: Int,
        val session: Session?,
        val error: String? = null,
        val gps: String? = null,
        val warning: String? = null,
    ) {
        val state: String get() = when (session?.status) {
            "recording" -> "recording"
            "paused" -> "paused"
            else -> "idle"
        }

        fun extras(): Bundle = Bundle().apply {
            putString(EXTRA_STATE, state)
            session?.let {
                putString(EXTRA_SESSION_ID, it.id)
                putString(EXTRA_TYPE, it.type)
                putLong(EXTRA_STARTED_AT, it.startedAt)
                it.activityTypeId?.let { id -> putString(EXTRA_ACTIVITY_TYPE_ID, id) }
            }
            error?.let { putString(EXTRA_ERROR, it) }
            gps?.let { putString(EXTRA_GPS, it) }
            warning?.let { putString(EXTRA_WARNING, it) }
        }
    }

    /** What [dispatch] drives. [LiveController] in production. */
    interface Controller {
        suspend fun active(): Session?
        /** A reason a start would fail before it touches anything, or null. */
        fun startBlocker(): String?
        suspend fun start(type: String, useGps: Boolean): Session
        /** The full start (catalogue id, GPS outcome). Defaults to [start] for controllers without them. */
        suspend fun start(command: Command.Start): Started = Started(start(command.type, command.useGps))
        suspend fun pause(session: Session): Session
        suspend fun resume(session: Session): Session
        suspend fun finish(session: Session)
        suspend fun cancel(session: Session)
    }

    fun permission(packageName: String): String = packageName + PERMISSION_SUFFIX

    /** The explicit intent for [command], addressed to Gauge's receiver in [packageName]. */
    fun intent(packageName: String, command: Command): Intent = Intent(actionOf(command)).apply {
        setClassName(packageName, RECEIVER_CLASS)
        if (command is Command.Start) {
            putExtra(EXTRA_TYPE, command.type)
            putExtra(EXTRA_USE_GPS, command.useGps)
            command.activityTypeId?.let { putExtra(EXTRA_ACTIVITY_TYPE_ID, it) }
        }
    }

    fun actionOf(command: Command): String = when (command) {
        is Command.Start -> ACTION_START
        Command.Pause -> ACTION_PAUSE
        Command.Resume -> ACTION_RESUME
        Command.Stop -> ACTION_STOP
        Command.Status -> ACTION_STATUS
    }

    fun parse(intent: Intent?): Command? = when (intent?.action) {
        ACTION_START -> Command.Start(
            type = intent.getStringExtra(EXTRA_TYPE) ?: DEFAULT_TYPE,
            useGps = intent.getBooleanExtra(EXTRA_USE_GPS, false),
            activityTypeId = intent.getStringExtra(EXTRA_ACTIVITY_TYPE_ID),
        )
        ACTION_PAUSE -> Command.Pause
        ACTION_RESUME -> Command.Resume
        ACTION_STOP -> Command.Stop
        ACTION_STATUS -> Command.Status
        else -> null
    }

    suspend fun dispatch(controller: Controller, command: Command): Outcome {
        val active = controller.active()
        return when (command) {
            Command.Status -> Outcome(RESULT_OK, active)
            is Command.Start -> {
                if (command.type !in TYPES) return Outcome(RESULT_ERROR, active, "bad_type")
                if (command.activityTypeId != null && !RecordingActivityType.isValidId(command.activityTypeId)) {
                    return Outcome(RESULT_ERROR, active, "bad_activity_type")
                }
                if (active != null) return Outcome(RESULT_ERROR, active, "already_recording")
                controller.startBlocker()?.let { return Outcome(RESULT_ERROR, null, it) }
                try {
                    val started = controller.start(command)
                    Outcome(RESULT_OK, started.session, gps = started.gps, warning = started.warning)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // ForegroundServiceStartNotAllowedException is an IllegalStateException. The
                    // session row may already exist: cancel it rather than leave a recording with
                    // no service behind it.
                    controller.active()?.let { runCatching { controller.cancel(it) } }
                    val reason = if (e is IllegalStateException) "foreground_start_blocked" else "failed"
                    Log.w(TAG, "Workout start failed: ${e.message}")
                    Outcome(RESULT_ERROR, null, reason)
                }
            }
            Command.Pause -> when (active?.status) {
                null -> Outcome(RESULT_ERROR, null, "no_active_workout")
                "recording" -> Outcome(RESULT_OK, controller.pause(active))
                else -> Outcome(RESULT_ERROR, active, "not_recording")
            }
            Command.Resume -> when (active?.status) {
                null -> Outcome(RESULT_ERROR, null, "no_active_workout")
                "paused" -> Outcome(RESULT_OK, controller.resume(active))
                else -> Outcome(RESULT_ERROR, active, "not_paused")
            }
            Command.Stop -> if (active == null) {
                Outcome(RESULT_ERROR, null, "no_active_workout")
            } else {
                controller.finish(active)
                Outcome(RESULT_OK, null)
            }
        }
    }

    /** Production controller over the process's [LiveWorkoutManager]. Call on the main thread. */
    class LiveController(private val context: Context) : Controller {
        private val manager: LiveWorkoutManager get() = PulseLoopRuntime.ensureRing(context).liveWorkout
        private val db get() = PulseLoopDatabase.getInstance(context)

        private fun entity(id: String) = manager.state.value.activeSession?.takeIf { it.id == id }

        override suspend fun active(): Session? {
            // After a process death the manager is empty but the row is still recording.
            val s = manager.state.value.activeSession ?: db.activitySessionDao().active() ?: return null
            val activityTypeId = RecordingStart.fromEvents(db.activityEventDao().forSession(s.id))?.activityTypeId
            return Session(s.id, s.type, s.statusRaw, s.startedAt, activityTypeId)
        }

        override fun startBlocker(): String? {
            if (Build.VERSION.SDK_INT >= 34) {
                fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
                // The workout's foreground service is type `health`; startForeground() throws
                // inside the service without one of these, which would crash rather than fail.
                if (!granted(Manifest.permission.ACTIVITY_RECOGNITION) && !granted(Manifest.permission.BODY_SENSORS)) {
                    return "needs_activity_recognition"
                }
            }
            return null
        }

        override suspend fun start(type: String, useGps: Boolean): Session = start(Command.Start(type, useGps)).session

        override suspend fun start(command: Command.Start): Started {
            val r = manager.startRecording(command.type, command.useGps, command.activityTypeId)
            val s = r.session
            return Started(
                Session(s.id, s.type, s.statusRaw, s.startedAt, command.activityTypeId),
                gps = if (command.useGps) (if (r.gpsUnavailable == null) "on" else "off") else null,
                warning = r.gpsUnavailable,
            )
        }

        private suspend fun row(session: Session) = entity(session.id) ?: db.activitySessionDao().byId(session.id)
            ?: error("Session ${session.id} vanished")

        override suspend fun pause(session: Session): Session {
            manager.pause(row(session))
            return session.copy(status = "paused")
        }

        override suspend fun resume(session: Session): Session {
            manager.resume(row(session))
            return session.copy(status = "recording")
        }

        override suspend fun finish(session: Session) { manager.finish(row(session)) }
        override suspend fun cancel(session: Session) { manager.cancel(row(session)) }
    }

    /** Run [command] on the main thread and hand back the outcome (never throws). */
    fun execute(context: Context, command: Command, done: (Outcome) -> Unit = {}) {
        val app = context.applicationContext
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        scope.launch {
            val outcome = try {
                dispatch(LiveController(app), command)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "Workout command failed: ${e.message}")
                Outcome(RESULT_ERROR, null, "failed")
            }
            try { done(outcome) } finally { scope.cancel() }
        }
    }

    private const val TAG = "WorkoutControl"
}

/**
 * The ring notice's "Start walk" action (see [WorkoutControl] for the API). Gauge exported it behind
 * `<applicationId>.permission.CONTROL_WORKOUT` for Vitals; inside Vitals (0.7.0) it is not exported and
 * only the app's own explicit intents reach it. Vitals' screens call [WorkoutControl.execute] directly.
 */
class WorkoutControlReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val command = WorkoutControl.parse(intent) ?: return
        val ordered = isOrderedBroadcast
        val pending = goAsync()
        WorkoutControl.execute(context, command) { outcome ->
            try {
                if (ordered) pending.setResult(outcome.code, outcome.state, outcome.extras())
            } finally {
                pending.finish()
            }
        }
    }
}

/**
 * Quick-settings tile: idle → tap starts a walk; recording or paused → tap finishes it. The label
 * and state follow the live workout each time the shade opens.
 */
class WorkoutTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        refresh()
    }

    override fun onClick() {
        super.onClick()
        // (Vitals 0.7.0) Gauge records while it is installed; this tile wakes nothing until Vitals has taken over
        if (!com.pulseloop.GaugeEngine.isActive(this)) return refresh()
        val active = PulseLoopRuntime.ensureRing(this).liveWorkout.state.value.activeSession
        WorkoutControl.execute(this, commandFor(active?.statusRaw)) { refresh() }
    }

    private fun refresh() {
        val tile = qsTile ?: return
        if (!com.pulseloop.GaugeEngine.isActive(this)) {
            tile.state = Tile.STATE_UNAVAILABLE
            tile.label = LABEL
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.subtitle = "Finish moving from the old ring app first"
            tile.updateTile()
            return
        }
        val status = runCatching { PulseLoopRuntime.ensureRing(this).liveWorkout.state.value.activeSession?.statusRaw }.getOrNull()
        val (state, subtitle) = tileState(status)
        tile.state = state
        tile.label = LABEL
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.subtitle = subtitle
        tile.updateTile()
    }

    companion object {
        const val LABEL = "Workout"

        /** What a tap does for the current session status (null = idle). */
        fun commandFor(activeStatus: String?): WorkoutControl.Command =
            if (activeStatus == "recording" || activeStatus == "paused") WorkoutControl.Command.Stop
            else WorkoutControl.Command.Start(WorkoutControl.DEFAULT_TYPE)

        fun tileState(activeStatus: String?): Pair<Int, String> = when (activeStatus) {
            "recording" -> Tile.STATE_ACTIVE to "Recording · tap to finish"
            "paused" -> Tile.STATE_ACTIVE to "Paused · tap to finish"
            else -> Tile.STATE_INACTIVE to "Tap to start a walk"
        }
    }
}
