package com.pulseloop.command

import com.pulseloop.shortvideo.ShortVideoApp
import com.pulseloop.shortvideo.ShortVideoPrefs
import com.pulseloop.shortvideo.ShortVideoSettings
import com.pulseloop.ui.tile.WorkoutControl
import com.pulseloop.ui.tile.WorkoutControl.Session
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

class FakeWorkout(var current: Session? = null, var blocker: String? = null) : WorkoutControl.Controller {
    val calls = mutableListOf<String>()
    override suspend fun active() = current
    override fun startBlocker() = blocker
    /** The last full start; [gpsWarning] is what a start asking for GPS reports (null = GPS on). */
    var lastStart: WorkoutControl.Command.Start? = null
    var gpsWarning: String? = null
    override suspend fun start(type: String, useGps: Boolean): Session {
        calls += "start:$type:$useGps"
        return Session("w-new", type, "recording", 1_793_000_000_000L).also { current = it }
    }
    override suspend fun start(command: WorkoutControl.Command.Start): WorkoutControl.Started {
        lastStart = command
        val s = start(command.type, command.useGps).copy(activityTypeId = command.activityTypeId).also { current = it }
        return WorkoutControl.Started(s, gps = if (command.useGps) (if (gpsWarning == null) "on" else "off") else null, warning = if (command.useGps) gpsWarning else null)
    }
    override suspend fun pause(session: Session) = session.copy(status = "paused").also { calls += "pause"; current = it }
    override suspend fun resume(session: Session) = session.copy(status = "recording").also { calls += "resume"; current = it }
    override suspend fun finish(session: Session) { calls += "finish"; current = null }
    override suspend fun cancel(session: Session) { calls += "cancel"; current = null }
}

/** Applies like [com.pulseloop.command.SettingsReels], through the real clamp. */
class FakeReels(var prefs: ShortVideoPrefs = ShortVideoPrefs(disclosureAccepted = true, verboseDebug = true)) : ReelsPort {
    var calls = 0
    override fun apply(dailyLimit: Int?, apps: Set<ShortVideoApp>?, enabled: Boolean?, countdownSeconds: Int?): ShortVideoPrefs {
        calls++
        prefs = ShortVideoSettings.sanitise(
            prefs.copy(
                dailyLimit = dailyLimit ?: prefs.dailyLimit,
                enabledApps = apps ?: prefs.enabledApps,
                enabled = enabled ?: prefs.enabled,
                countdownSeconds = countdownSeconds ?: prefs.countdownSeconds,
            ),
        )
        return prefs
    }
}

class FakeHeartRate(var outcome: HeartRatePort.Outcome = HeartRatePort.Outcome.Reading(62, 1_793_000_032_000L), var takesMs: Long = 32_000) : HeartRatePort {
    var calls = 0
    override suspend fun measure(onRunning: suspend () -> Unit): HeartRatePort.Outcome {
        calls++
        onRunning()
        delay(takesMs)
        return outcome
    }
}

/** (r068 B2) A ring sync that takes [takesMs] and ends with [outcome]. */
class FakeRingSync(var outcome: RingSyncPort.Outcome = RingSyncPort.Outcome.Synced(1_793_000_090_000L, complete = true), var takesMs: Long = 60_000) : RingSyncPort {
    var calls = 0
    override suspend fun sync(onRunning: suspend () -> Unit): RingSyncPort.Outcome {
        calls++
        if (outcome is RingSyncPort.Outcome.Synced) onRunning()
        delay(takesMs)
        return outcome
    }
}

/** (r068 B2) Records each flush; [fails] throws instead. */
class FakeUploads(var emptied: Boolean = true, var fails: Boolean = false) : UploadPort {
    var flushes = 0
    override suspend fun flush(): Boolean {
        flushes++
        if (fails) error("server unreachable")
        return emptied
    }
}

/** (r068 B2) Counts the holds that are open now and every timeout asked for. */
class FakeWake : WakeHold {
    var open = 0
        private set
    val asked = mutableListOf<Long>()
    override fun acquire(timeoutMs: Long): WakeHold.Held {
        asked += timeoutMs
        open++
        var released = false
        return WakeHold.Held { if (!released) { released = true; open-- } }
    }
}

class FakeUpdates(var result: UpdatePort.Result = UpdatePort.Result("UP_TO_DATE")) : UpdatePort {
    override suspend fun check() = result
}

/** Answers polls from a script; an empty script holds like the server (wait seconds) and answers no commands. */
class FakeCommandApi(private val now: () -> Long) : CommandApi {
    val polls = Channel<PollResult>(Channel.UNLIMITED)
    val pollWaits = mutableListOf<Int>()
    val pollTimes = mutableListOf<Long>()
    val acks = mutableListOf<Pair<String, CommandAck>>()
    val states = mutableListOf<JsonObject>()
    var ackResult: SendResult = SendResult.Ok
    var personId = "person-1"
    val firstAck = CompletableDeferred<Unit>()

    override suspend fun poll(serverUrl: String, token: String, waitS: Int): PollResult {
        pollWaits += waitS
        pollTimes += now()
        polls.tryReceive().getOrNull()?.let { return it }
        delay(waitS * 1000L)
        return PollResult.Ok(now(), personId, 25, emptyList())
    }

    override suspend fun ack(serverUrl: String, token: String, id: String, ack: CommandAck): SendResult {
        acks += id to ack
        firstAck.complete(Unit)
        return ackResult
    }

    override suspend fun postState(serverUrl: String, token: String, state: JsonObject): SendResult {
        states += state
        return SendResult.Ok
    }

    fun ok(serverNow: Long, vararg commands: RemoteCommand) = polls.trySend(PollResult.Ok(serverNow, personId, 25, commands.toList()))
}

fun command(id: String, type: String, issuedAt: Long, ttlMs: Long, seq: Long = 1, vararg payload: Pair<String, Any>) = RemoteCommand(
    id = id,
    seq = seq,
    type = type,
    payload = JsonObject(payload.associate { (k, v) ->
        k to when (v) {
            is String -> JsonPrimitive(v)
            is Number -> JsonPrimitive(v)
            is Boolean -> JsonPrimitive(v)
            is List<*> -> kotlinx.serialization.json.JsonArray(v.map { JsonPrimitive(it as String) })
            else -> error("unsupported")
        }
    }),
    issuedAt = issuedAt,
    expiresAt = issuedAt + ttlMs,
    attempt = 1,
)
