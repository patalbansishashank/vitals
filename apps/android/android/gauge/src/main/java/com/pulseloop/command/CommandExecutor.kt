package com.pulseloop.command

import com.pulseloop.shortvideo.ShortVideoApp
import com.pulseloop.shortvideo.ShortVideoPrefs
import com.pulseloop.ui.tile.WorkoutControl
import java.time.Instant
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** The Reels settings ([com.pulseloop.shortvideo.ShortVideoSettings] in production). */
interface ReelsPort {
    /** Applies the given fields only (never the disclosure, capsule, upload or debug switches); returns the result. */
    fun apply(dailyLimit: Int?, apps: Set<ShortVideoApp>?, enabled: Boolean?, countdownSeconds: Int?): ShortVideoPrefs
}

/** A spot heart-rate measurement on the ring. */
interface HeartRatePort {
    sealed interface Outcome {
        data class Reading(val bpm: Int, val observedAt: Long) : Outcome
        data object WorkoutActive : Outcome
        data object Busy : Outcome
        data object Disconnected : Outcome
        data object Refused : Outcome
        data object NoReading : Outcome
    }

    /** [onRunning] is called once the measurement really starts (about 32 s follow). */
    suspend fun measure(onRunning: suspend () -> Unit): Outcome
}

/**
 * (2.8.4, r068 B2) "Refresh" on another device: sync the ring's history into Gauge now. Production connects a ring that
 * dropped (never one the person disconnected), runs the coordinator's history sync and waits for its end.
 */
interface RingSyncPort {
    sealed interface Outcome {
        /** [complete]: the ring said the sync finished (false: it stalled and what arrived is kept). */
        data class Synced(val at: Long, val complete: Boolean) : Outcome
        data object Disconnected : Outcome
        /** A spot measurement holds the ring. */
        data object Busy : Outcome
    }

    /** [onRunning] is called once the sync really starts (the ring is connected). */
    suspend fun sync(onRunning: suspend () -> Unit): Outcome

    object Unsupported : RingSyncPort {
        override suspend fun sync(onRunning: suspend () -> Unit): Outcome = Outcome.Disconnected
    }
}

/**
 * (2.8.4, r068 B2) Push what waits in the hub outbox to the home server now, so the device that asked sees the new
 * readings when the command answers. True when nothing is left waiting.
 */
interface UploadPort {
    suspend fun flush(): Boolean

    object None : UploadPort {
        override suspend fun flush(): Boolean = false
    }
}

/** The OTA check (`OtaUpdates.check(ctx, userTapped = false)` in production). */
interface UpdatePort {
    data class Result(val outcome: String, val versionName: String? = null, val versionCode: Int? = null)
    suspend fun check(): Result
}

/** Which lane runs a type: each lane is in `seq` order, the lanes run concurrently (a measurement never delays a stop). */
enum class CommandLane { WORKOUT, RING, APP }

/**
 * Runs one command and maps the result to its ack (energy SPEC §A.4 items 3 and 9). Gauge checks the ranges itself
 * ([validate]) before anything runs. Workout commands go through GB's [WorkoutControl.dispatch], exactly as the tile,
 * the notification and the local broadcast API do.
 */
class CommandExecutor(
    private val workout: WorkoutControl.Controller,
    private val reels: ReelsPort,
    private val heartRate: HeartRatePort,
    private val updates: UpdatePort,
    /** Where workout calls run: the main thread in production ([WorkoutControl.LiveController] needs it). */
    private val workoutContext: CoroutineContext = EmptyCoroutineContext,
    private val ringSync: RingSyncPort = RingSyncPort.Unsupported,
    private val uploads: UploadPort = UploadPort.None,
) {
    /** A reason to refuse the command before it runs (`rejected: bad_payload` / `bad_type`), or null. */
    fun validate(c: RemoteCommand): CommandAck? {
        val p = c.payload
        fun only(vararg keys: String) = p.keys.all { it in keys }
        return when (c.type) {
            "reels.set" -> when {
                p.isEmpty() || !only("dailyLimit", "apps", "enabled", "countdownSeconds") -> BAD
                p.containsKey("dailyLimit") && p.int("dailyLimit")?.let { it in ShortVideoLimits.LIMIT } != true -> BAD
                p.containsKey("countdownSeconds") && p.int("countdownSeconds")?.let { it in ShortVideoLimits.COUNTDOWN } != true -> BAD
                p.containsKey("enabled") && p.bool("enabled") == null -> BAD
                p.containsKey("apps") && p.apps() == null -> BAD
                else -> null
            }
            "workout.start" -> when {
                !only("type", "useGps", "activityTypeId", "activity_type_id") -> BAD
                p.str("type") !in WorkoutControl.TYPES -> CommandAck.rejected("bad_type")
                p.containsKey("useGps") && p.bool("useGps") == null -> BAD
                (p.containsKey("activityTypeId") || p.containsKey("activity_type_id")) && p.activityTypeId() == null ->
                    CommandAck.rejected("bad_activity_type")
                else -> null
            }
            "workout.pause", "workout.resume", "workout.stop" -> when {
                !only("sessionId") -> BAD
                p.containsKey("sessionId") && p.str("sessionId").isNullOrBlank() -> BAD
                else -> null
            }
            "hr.measure", "update.check", "ring.sync" -> if (p.isEmpty()) null else BAD
            else -> CommandAck.rejected("unknown_type")
        }
    }

    suspend fun execute(c: RemoteCommand, onRunning: suspend () -> Unit = {}): CommandAck {
        validate(c)?.let { return it }
        return try {
            when (c.type) {
                "reels.set" -> reelsSet(c.payload)
                "workout.start", "workout.pause", "workout.resume", "workout.stop" -> withContext(workoutContext) { workoutCommand(c) }
                "hr.measure" -> measure(onRunning)
                "ring.sync" -> sync(onRunning)
                "update.check" -> updateCheck()
                else -> CommandAck.rejected("unknown_type")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            CommandAck.failed("failed")
        }
    }

    private fun reelsSet(p: JsonObject): CommandAck {
        val applied = reels.apply(
            dailyLimit = p.int("dailyLimit"),
            apps = p.apps(),
            enabled = p.bool("enabled"),
            countdownSeconds = p.int("countdownSeconds"),
        )
        return CommandAck.done(buildJsonObject { put("applied", reelsJson(applied)) })
    }

    private suspend fun workoutCommand(c: RemoteCommand): CommandAck {
        val asked = c.payload.str("sessionId")
        val before = workout.active()
        // a late command must never touch a newer workout
        if (asked != null && before != null && before.id != asked) return CommandAck.rejected("wrong_workout", sessionJson(before))
        val command = when (c.type) {
            "workout.start" -> WorkoutControl.Command.Start(c.payload.str("type")!!, c.payload.bool("useGps") ?: false, c.payload.activityTypeId())
            "workout.pause" -> WorkoutControl.Command.Pause
            "workout.resume" -> WorkoutControl.Command.Resume
            else -> WorkoutControl.Command.Stop
        }
        val outcome = WorkoutControl.dispatch(workout, command)
        return mapWorkout(c.type, outcome, before)
    }

    private suspend fun measure(onRunning: suspend () -> Unit): CommandAck = when (val r = heartRate.measure(onRunning)) {
        is HeartRatePort.Outcome.Reading -> {
            // (r068 B2) the reading reaches the server before the answer does: the asking device re-reads it at once
            val uploaded = flush()
            CommandAck.done(buildJsonObject {
                put("bpm", r.bpm)
                put("observedAt", Instant.ofEpochMilli(r.observedAt).toString())
                put("uploaded", uploaded)
            })
        }
        HeartRatePort.Outcome.WorkoutActive -> CommandAck.rejected("workout_active")
        HeartRatePort.Outcome.Busy -> CommandAck.rejected("busy")
        HeartRatePort.Outcome.Disconnected -> CommandAck.failed("ring_disconnected")
        HeartRatePort.Outcome.Refused -> CommandAck.failed("ring_refused")
        HeartRatePort.Outcome.NoReading -> CommandAck.failed("no_reading")
    }

    private suspend fun sync(onRunning: suspend () -> Unit): CommandAck = when (val r = ringSync.sync(onRunning)) {
        is RingSyncPort.Outcome.Synced -> {
            val uploaded = flush()
            CommandAck.done(buildJsonObject {
                put("syncedAt", Instant.ofEpochMilli(r.at).toString())
                put("complete", r.complete)
                put("uploaded", uploaded)
            })
        }
        RingSyncPort.Outcome.Busy -> CommandAck.rejected("busy")
        RingSyncPort.Outcome.Disconnected -> CommandAck.failed("ring_disconnected")
    }

    /** An upload that fails never turns a reading into a failure: the regular upload carries it later. */
    private suspend fun flush(): Boolean = try {
        uploads.flush()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        false
    }

    private suspend fun updateCheck(): CommandAck {
        val r = updates.check()
        return when (r.outcome) {
            "UP_TO_DATE", "READY", "WAITING_FOR_TAP" -> CommandAck.done(buildJsonObject {
                put("outcome", r.outcome)
                r.versionName?.let { put("versionName", it) }
                r.versionCode?.let { put("versionCode", it) }
            })
            "NOT_PAIRED", "NEEDS_REPAIR", "UPDATES_IN_VITALS" -> CommandAck.rejected(r.outcome.lowercase())
            else -> CommandAck.failed("check_failed")
        }
    }

    companion object {
        private val BAD = CommandAck.rejected("bad_payload")

        fun laneOf(type: String): CommandLane = when {
            type.startsWith("workout.") -> CommandLane.WORKOUT
            // one ring: a measurement and a history sync never run at once
            type == "hr.measure" || type == "ring.sync" -> CommandLane.RING
            else -> CommandLane.APP
        }

        /**
         * Every type this build runs (the `capabilities` it reports), plus feature tokens a caller may
         * check before using a newer payload field: [ACTIVITY_TYPE_CAPABILITY] = `workout.start` takes
         * `activityTypeId` (2.8.1). The server keeps only the tokens it knows. `ring.sync` since 2.8.4.
         */
        const val ACTIVITY_TYPE_CAPABILITY = "workout.start.activity_type_id"
        val CAPABILITIES = listOf("reels.set", "workout.start", "workout.pause", "workout.resume", "workout.stop", "hr.measure", "ring.sync", ACTIVITY_TYPE_CAPABILITY)

        fun sessionJson(s: WorkoutControl.Session?, state: String? = null): JsonObject = buildJsonObject {
            put("state", state ?: when (s?.status) {
                "recording" -> "recording"
                "paused" -> "paused"
                else -> "idle"
            })
            s?.let {
                put("sessionId", it.id)
                put("type", it.type)
                put("startedAt", Instant.ofEpochMilli(it.startedAt).toString())
                it.activityTypeId?.let { id -> put("activityTypeId", id) }
            }
        }

        fun reelsJson(p: ShortVideoPrefs): JsonObject = buildJsonObject {
            put("enabled", p.enabled)
            put("dailyLimit", p.dailyLimit)
            put("countdownSeconds", p.countdownSeconds)
            putJsonArray("apps") { ShortVideoApp.entries.filter { it in p.enabledApps }.forEach { add(JsonPrimitive(it.key)) } }
        }

        /** GB's outcome as the channel's ack (§A.4 item 9; the Vitals plugin maps the local path the same way). */
        fun mapWorkout(type: String, o: WorkoutControl.Outcome, before: WorkoutControl.Session?): CommandAck {
            val ok = o.code == WorkoutControl.RESULT_OK
            val e = o.error
            val state = buildJsonObject { put("state", o.state) }
            return when (type) {
                "workout.start" -> when {
                    ok -> CommandAck.done(JsonObject(sessionJson(o.session) + buildJsonObject {
                        o.gps?.let { put("gps", it) }
                        o.warning?.let { put("warning", it) }
                    }))
                    e == "already_recording" -> CommandAck.rejected(e, sessionJson(o.session))
                    e == "bad_type" || e == "bad_activity_type" -> CommandAck.rejected(e)
                    else -> CommandAck.failed(e ?: "failed")
                }
                "workout.pause" -> when {
                    ok -> CommandAck.done(buildJsonObject { put("state", "paused") })
                    e == "not_recording" && o.state == "paused" -> CommandAck.noop(state)
                    e == "no_active_workout" -> CommandAck.rejected(e)
                    else -> CommandAck.failed(e ?: "failed")
                }
                "workout.resume" -> when {
                    ok -> CommandAck.done(buildJsonObject { put("state", "recording") })
                    e == "not_paused" && o.state == "recording" -> CommandAck.noop(state)
                    e == "no_active_workout" -> CommandAck.rejected(e)
                    else -> CommandAck.failed(e ?: "failed")
                }
                else -> when {
                    ok -> CommandAck.done(buildJsonObject {
                        put("state", "idle")
                        before?.let { put("sessionId", it.id) }
                    })
                    e == "no_active_workout" -> CommandAck.noop(buildJsonObject { put("state", "idle") })
                    else -> CommandAck.failed(e ?: "failed")
                }
            }
        }
    }
}

/** Gauge's own ranges for the Reels settings (the same as [com.pulseloop.shortvideo.ShortVideoSettings]'s clamp). */
internal object ShortVideoLimits {
    val LIMIT = com.pulseloop.shortvideo.ShortVideoSettings.LIMIT_RANGE
    val COUNTDOWN = com.pulseloop.shortvideo.ShortVideoSettings.COUNTDOWN_RANGE
}

private fun JsonObject.prim(key: String): JsonPrimitive? = (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }
internal fun JsonObject.str(key: String): String? = prim(key)?.takeIf { it.isString }?.content
internal fun JsonObject.int(key: String): Int? = prim(key)?.takeIf { !it.isString }?.let { p ->
    p.intOrNull?.takeIf { p.content.toDoubleOrNull() == it.toDouble() }
}
internal fun JsonObject.bool(key: String): Boolean? = prim(key)?.takeIf { !it.isString }?.booleanOrNull

/**
 * The catalogue activity id of a `workout.start` (0.6.3 S26): `activityTypeId` (the channel's
 * camelCase), or `activity_type_id` (the upload's spelling). Null when absent, not a valid id, or
 * given twice with different values.
 */
internal fun JsonObject.activityTypeId(): String? {
    val a = if (containsKey("activityTypeId")) (str("activityTypeId") ?: return null) else null
    val b = if (containsKey("activity_type_id")) (str("activity_type_id") ?: return null) else null
    if (a != null && b != null && a != b) return null
    return (a ?: b)?.takeIf(com.pulseloop.service.RecordingActivityType::isValidId)
}

/** `apps` as a set of known apps, or null when it is not a list of known keys, each once. */
internal fun JsonObject.apps(): Set<ShortVideoApp>? {
    val arr = this["apps"] as? JsonArray ?: return null
    val keys = arr.map { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: return null }
    if (keys.toSet().size != keys.size) return null
    return keys.map { ShortVideoApp.fromKey(it) ?: return null }.toSet()
}
