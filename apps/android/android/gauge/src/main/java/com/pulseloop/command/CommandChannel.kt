package com.pulseloop.command

import android.content.Context
import android.util.Log
import com.pulseloop.GaugeHost
import com.pulseloop.PulseLoopRuntime
import com.pulseloop.hub.HubPairing
import com.pulseloop.hub.HubSettingsSource
import com.pulseloop.hub.HubDrainResult
import com.pulseloop.hub.HubSync
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.PulseEventBus
import com.pulseloop.ring.RingConnectionState
import com.pulseloop.service.RingSyncCoordinator
import com.pulseloop.shortvideo.ShortVideoApp
import com.pulseloop.shortvideo.ShortVideoPrefs
import com.pulseloop.shortvideo.ShortVideoSettings
import com.pulseloop.ui.tile.WorkoutControl
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * The hold-open poll loop for Vitals' commands (energy SPEC §A.4 item 8; Vitals' docs/GAUGE-COMMANDS.md).
 *
 * `GET /v1/lumen/commands?wait=25`, run what returns, ask again at once (never sooner than every 2 s). Errors back off
 * from 2 s, doubling to 60 s with jitter; a 401 marks the pairing `needsRepair` and ends the loop; a changed `personId`
 * ends it too. Three lanes run concurrently, each in `seq` order: `workout`, `ring` (`hr.measure`), `app` (`reels.set`,
 * `update.check`), so a 32 s measurement never delays a stop. A command runs only if it is unexpired by the server's
 * clock (every poll answer carries `now`; a wrong phone clock cannot revive one), unseen in the [CommandLedger] and
 * valid by Gauge's own range checks. Nothing here logs a payload or a result.
 */
class CommandLoop(
    private val settings: HubSettingsSource,
    private val api: CommandApi,
    private val executor: CommandExecutor,
    private val ledger: CommandLedger,
    private val clock: () -> Long = System::currentTimeMillis,
    private val random: Random = Random.Default,
    /** After every command that reached a final answer (the state reporter posts again). */
    private val onApplied: () -> Unit = {},
    /**
     * (2.8.4, r068 B2) Keeps the CPU awake while the loop has work of its own: a backoff or the gap between polls, and
     * every command until its last ack. Without it a dozing phone froze the loop inside a coroutine `delay` (timers stop
     * while the CPU sleeps) and Vitals' commands expired unseen. The held poll itself needs none: the server's answer
     * is a network packet, which wakes the phone.
     */
    private val wake: WakeHold = WakeHold.None,
) {
    enum class Stop { UNAUTHORIZED, PERSON_CHANGED, DRAINED }

    /** Server clock minus this phone's, from the last poll answer. */
    @Volatile var clockOffsetMs: Long = 0L
        private set

    private val inFlight: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** When the last poll came back with an answer (this phone's clock); 0 before the first. A stuck loop stops moving it. */
    @Volatile var lastAnswerAt: Long = 0L
        private set

    private suspend fun awake(ms: Long, body: suspend () -> Unit) {
        val hold = wake.acquire(ms + WAKE_SLACK_MS)
        try { body() } finally { hold.release() }
    }

    /** A `delay` that the CPU's sleep cannot stretch. */
    private suspend fun pause(ms: Long) { if (ms > 0) awake(ms) { delay(ms) } }

    /** Polls until a 401 or a changed person (or the caller's cancellation). [once]: one poll, then wait for its work. */
    suspend fun run(pairing: HubPairing, waitS: Int = WAIT_S, once: Boolean = false): Stop = coroutineScope {
        val lanes = CommandLane.entries.associateWith { Channel<RemoteCommand>(Channel.UNLIMITED) }
        val stopping = AtomicBoolean(false)
        val workers = lanes.values.map { ch ->
            launch {
                for (c in ch) {
                    if (stopping.get()) {
                        inFlight.remove(c.id)
                        continue
                    }
                    runOne(pairing, c)
                }
            }
        }
        var backoff = 0L
        var lastPollAt: Long? = null
        val stop: Stop
        while (true) {
            lastPollAt?.let { pause(it + MIN_POLL_GAP_MS - clock()) }
            lastPollAt = clock()
            val r = api.poll(pairing.serverUrl, pairing.token, if (once) 0 else waitS)
            if (r !is PollResult.Failed) lastAnswerAt = clock()
            when (r) {
                is PollResult.Ok -> {
                    backoff = 0
                    if (pairing.personId.isNotBlank() && r.personId.isNotBlank() && r.personId != pairing.personId) {
                        stop = Stop.PERSON_CHANGED
                        break
                    }
                    clockOffsetMs = r.serverNow - clock()
                    if (r.commands.isNotEmpty()) awake(ADMIT_WAKE_MS) {
                        for (c in r.commands) admit(pairing, c) { lanes.getValue(CommandExecutor.laneOf(c.type)).send(c) }
                    }
                    if (once) {
                        stop = Stop.DRAINED
                        break
                    }
                }
                PollResult.Unauthorized -> {
                    settings.markNeedsRepair(clock())
                    stop = Stop.UNAUTHORIZED
                    break
                }
                is PollResult.Throttled -> {
                    backoff = nextBackoff(backoff)
                    pause(maxOf(r.retryAfterMs ?: 0L, jittered(backoff)))
                }
                is PollResult.Failed -> {
                    if (once) {
                        stop = Stop.DRAINED
                        break
                    }
                    backoff = nextBackoff(backoff)
                    pause(jittered(backoff))
                }
            }
        }
        // what a lane already runs finishes; what waits behind it does not start
        if (stop != Stop.DRAINED) stopping.set(true)
        lanes.values.forEach { it.close() }
        workers.forEach { it.join() }
        stop
    }

    fun isExpired(c: RemoteCommand): Boolean = clock() + clockOffsetMs >= c.expiresAt

    private suspend fun admit(pairing: HubPairing, c: RemoteCommand, enqueue: suspend () -> Unit) {
        // re-offered while this process still runs it (a lease ran out): the running one answers
        if (!inFlight.add(c.id)) return
        val seen = ledger.lookup(c.id)
        val immediate: CommandAck? = when {
            seen?.ack != null -> seen.ack
            // noted but never answered: the process died while it ran; never run it twice
            seen != null -> CommandAck.failed("interrupted").also { ledger.finish(c.id, it) }
            isExpired(c) -> CommandAck.expired.also { ledger.finish(c.id, it) }
            else -> executor.validate(c)?.also { ledger.finish(c.id, it) }
        }
        if (immediate != null) {
            inFlight.remove(c.id)
            send(pairing, c.id, immediate)
            return
        }
        ledger.begin(c.id)
        enqueue()
    }

    private suspend fun runOne(pairing: HubPairing, c: RemoteCommand) = awake(RUN_WAKE_MS) {
        try {
            val ack = if (isExpired(c)) CommandAck.expired else executor.execute(c) {
                send(pairing, c.id, CommandAck(CommandAck.RUNNING), attempts = 1)
            }
            ledger.finish(c.id, ack)
            Log.i(TAG, "command ${c.id} ${c.type} ${ack.status}${ack.code?.let { " $it" } ?: ""}")
            send(pairing, c.id, ack)
            if (ack.status != "expired") onApplied()
        } finally {
            inFlight.remove(c.id)
        }
    }

    /** An ack, retried briefly; a lost one is re-sent from the ledger when the server offers the id again. */
    private suspend fun send(pairing: HubPairing, id: String, ack: CommandAck, attempts: Int = 3) {
        var wait = 1_000L
        repeat(attempts) { i ->
            when (api.ack(pairing.serverUrl, pairing.token, id, ack)) {
                SendResult.Ok, is SendResult.Refused -> return
                SendResult.Unauthorized -> {
                    settings.markNeedsRepair(clock())
                    return
                }
                is SendResult.Failed -> if (i < attempts - 1) {
                    delay(wait)
                    wait *= 2
                }
            }
        }
    }

    private fun nextBackoff(prev: Long): Long = if (prev <= 0) BACKOFF_START_MS else minOf(prev * 2, BACKOFF_MAX_MS)
    private fun jittered(ms: Long): Long = (ms * (0.8 + 0.4 * random.nextDouble())).toLong()

    companion object {
        const val WAIT_S = 25
        const val MIN_POLL_GAP_MS = 2_100L
        const val BACKOFF_START_MS = 2_000L
        const val BACKOFF_MAX_MS = 60_000L
        /** Longest a command holds the CPU: a ring sync's connect, sync and upload, plus its acks. */
        const val RUN_WAKE_MS = 4 * 60_000L
        const val ADMIT_WAKE_MS = 30_000L
        const val WAKE_SLACK_MS = 5_000L
        private const val TAG = "CommandLoop"
    }
}

/**
 * Process wiring: one loop in its own scope for as long as the always-on `RingConnectionService` lives (it calls
 * [startIn] and [stopIn] beside `PhoneStepCounter`), and only while Gauge is paired and not `needsRepair`.
 */
object CommandChannel {
    @Volatile private var runtime: Runtime? = null

    fun startIn(context: Context) {
        val app = context.applicationContext
        synchronized(this) { runtime ?: Runtime(app).also { runtime = it } }.start()
    }

    fun stopIn() { runtime?.stop() }

    /** True while the always-on loop runs in this process (the safety-net worker then has nothing to do). */
    val isRunning: Boolean get() = runtime?.isRunning == true

    /**
     * (2.8.4, r068 B2) True while the always-on loop runs but no poll has answered for [STALE_MS]: a held poll answers
     * within 25 s, so the loop is stuck (a dead connection that a sleeping phone never timed out). The safety-net
     * worker then restarts it.
     */
    fun isStale(now: Long = System.currentTimeMillis()): Boolean = runtime?.isStale(now) == true

    /** Cancel the loop and start a fresh one (same process, same pairing). */
    fun restart(context: Context) {
        val app = context.applicationContext
        synchronized(this) { runtime ?: Runtime(app).also { runtime = it } }.restart()
    }

    const val STALE_MS = 3 * 60_000L

    @Volatile private var ledger: CommandLedger? = null

    private fun ledger(app: Context): CommandLedger = ledger ?: synchronized(this) {
        ledger ?: CommandLedger(File(app.filesDir, CommandLedger.FILE_NAME)).also { ledger = it }
    }

    /** The production loop. Shared by the service and [CommandPollWorker]. */
    fun loop(app: Context, onApplied: () -> Unit = {}): CommandLoop = CommandLoop(
        settings = HubSync.store(app),
        api = OkHttpCommandApi(),
        executor = CommandExecutor(
            workout = WorkoutControl.LiveController(app),
            reels = SettingsReels(app),
            heartRate = RingHeartRate(app),
            updates = VitalsUpdatePort,
            workoutContext = Dispatchers.Main.immediate,
            ringSync = RingSync(app),
            uploads = HubFlush(app),
        ),
        ledger = ledger(app),
        onApplied = onApplied,
        wake = PowerWakeHold(app),
    )

    /** What `POST /v1/lumen/commands/state` carries: the Reels settings and the live recording, never health data. */
    fun snapshot(app: Context): JsonObject {
        val prefs = ShortVideoSettings.get(app).prefs.value
        val session = runCatching { PulseLoopRuntime.ensureRing(app).liveWorkout.state.value.activeSession }.getOrNull()
        return stateJson(prefs, session?.let { WorkoutControl.Session(it.id, it.type, it.statusRaw, it.startedAt) }, GaugeHost.versionName(app))
    }

    fun stateJson(prefs: ShortVideoPrefs, session: WorkoutControl.Session?, appVersion: String = "0"): JsonObject = buildJsonObject {
        put("appVersion", appVersion)
        putJsonArray("capabilities") { CommandExecutor.CAPABILITIES.forEach { add(JsonPrimitive(it)) } }
        put("reels", CommandExecutor.reelsJson(prefs))
        val live = session?.takeIf { it.status == "recording" || it.status == "paused" }
        if (live == null) put("recording", JsonNull) else put("recording", buildJsonObject {
            put("sessionId", live.id)
            put("status", live.status)
            put("type", live.type)
            put("startedAt", java.time.Instant.ofEpochMilli(live.startedAt).toString())
        })
    }

    /**
     * Runs [body] for the current pairing while it is paired and not `needsRepair`: an unpair, a `needsRepair` mark or
     * a new pairing cancels it (a new pairing starts it again). After [body] returns on its own, nothing runs until the
     * pairing changes.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun supervise(pairings: Flow<HubPairing?>, body: suspend (HubPairing) -> Unit) {
        pairings.map { it?.takeUnless { p -> p.needsRepair } }.distinctUntilChanged().collectLatest { pairing ->
            if (pairing != null) body(pairing)
        }
    }

    private class Runtime(private val app: Context) {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        private var job: Job? = null
        @Volatile private var current: CommandLoop? = null
        @Volatile private var startedAt: Long = 0L
        val isRunning: Boolean get() = job?.isActive == true

        fun isStale(now: Long): Boolean {
            if (!isRunning) return false
            val loop = current ?: return false
            val last = maxOf(loop.lastAnswerAt, startedAt)
            return now - last > STALE_MS
        }

        @Synchronized
        fun restart() {
            job?.cancel()
            job = null
            start()
        }

        @Synchronized
        fun start() {
            if (job?.isActive == true) return
            startedAt = System.currentTimeMillis()
            runCatching { CommandPollWorker.schedule(app) }
            val settings = HubSync.store(app)
            job = scope.launch {
                supervise(settings.pairing) { pairing ->
                    val api = OkHttpCommandApi()
                    val reporter = CommandStateReporter(api, settings, snapshot = { snapshot(app) })
                    val loop = loop(app, onApplied = reporter::request).also { current = it }
                    coroutineScope {
                        val reporting = launch {
                            val changes = combine(
                                ShortVideoSettings.get(app).prefs,
                                PulseLoopRuntime.ensureRing(app).liveWorkout.state.map { s -> s.activeSession?.let { it.id to it.statusRaw } },
                            ) { prefs, live -> prefs to live }
                            reporter.run(changes)
                        }
                        val stop = loop.run(pairing)
                        Log.i("CommandChannel", "command loop ended: $stop")
                        reporting.cancel()
                    }
                }
            }
        }

        @Synchronized
        fun stop() {
            job?.cancel()
            job = null
        }
    }
}

/** `reels.set` → [ShortVideoSettings.update]; its `sanitise` clamps again. Only the four fields Vitals may set. */
class SettingsReels(private val app: Context) : ReelsPort {
    override fun apply(dailyLimit: Int?, apps: Set<ShortVideoApp>?, enabled: Boolean?, countdownSeconds: Int?): ShortVideoPrefs {
        val settings = ShortVideoSettings.get(app)
        settings.update { p ->
            p.copy(
                dailyLimit = dailyLimit ?: p.dailyLimit,
                enabledApps = apps ?: p.enabledApps,
                enabled = enabled ?: p.enabled,
                countdownSeconds = countdownSeconds ?: p.countdownSeconds,
            )
        }
        return settings.prefs.value
    }
}

/** `hr.measure` → the process's [RingSyncCoordinator.measureHR] (about 32 s), on the main thread like the Measure button. */
class RingHeartRate(private val app: Context) : HeartRatePort {
    override suspend fun measure(onRunning: suspend () -> Unit): HeartRatePort.Outcome = withContext(Dispatchers.Main.immediate) {
        val c = PulseLoopRuntime.ensureRing(app).coordinator
        when {
            c.workoutHRActive -> HeartRatePort.Outcome.WorkoutActive
            c.hrState == RingSyncCoordinator.MeasureState.MEASURING -> HeartRatePort.Outcome.Busy
            !c.isConnected -> HeartRatePort.Outcome.Disconnected
            else -> {
                onRunning()
                val bpm = c.measureHR()
                when {
                    bpm != null -> HeartRatePort.Outcome.Reading(bpm, System.currentTimeMillis())
                    !c.isConnected -> HeartRatePort.Outcome.Disconnected
                    c.workoutHRActive -> HeartRatePort.Outcome.WorkoutActive
                    else -> HeartRatePort.Outcome.NoReading
                }
            }
        }
    }
}

/**
 * (2.8.4, r068 B2) `ring.sync` → the coordinator's history sync, as pull-to-refresh runs it, awaited to its end. A ring
 * that dropped is dialled again (never one the person disconnected); its connect handshake runs the sync itself, so
 * only an already-connected ring is asked with `syncNow`. A sync the ring never ends keeps what arrived (`complete`
 * false) after [SYNC_MS].
 */
class RingSync(private val app: Context) : RingSyncPort {
    override suspend fun sync(onRunning: suspend () -> Unit): RingSyncPort.Outcome = coroutineScope {
        // the person asked: this pass reads sleep even inside their usual sleep window (r069)
        com.pulseloop.ring.RingSleepReadHold.request()
        val runtime = PulseLoopRuntime.ensureRing(app)
        val c = runtime.coordinator
        val client = runtime.bleClient
        val finished = async(start = CoroutineStart.UNDISPATCHED) {
            PulseEventBus.dataEvents.filterIsInstance<PulseEvent.SyncProgress>().first { it.stage == "done" }
        }
        try {
            val wasConnected = withContext(Dispatchers.Main.immediate) { c.isConnected }
            if (!wasConnected) {
                val userStopped = app.getSharedPreferences("ring_ble", Context.MODE_PRIVATE)
                    .getBoolean(com.pulseloop.ring.RingBLEClient.USER_DISCONNECTED_KEY, false)
                if (userStopped || !client.hasPermissions()) return@coroutineScope RingSyncPort.Outcome.Disconnected
                withContext(Dispatchers.Main.immediate) {
                    c.requestManualBackfillOnNextConnect()
                    client.connectLastKnown()
                }
                withTimeoutOrNull(CONNECT_MS) { client.state.first { it.connectionState == RingConnectionState.CONNECTED } }
                    ?: return@coroutineScope RingSyncPort.Outcome.Disconnected
            }
            if (withContext(Dispatchers.Main.immediate) { c.hrState == RingSyncCoordinator.MeasureState.MEASURING }) {
                return@coroutineScope RingSyncPort.Outcome.Busy
            }
            // A foreground shallow pass already owns the pager. A manual request must not
            // report that pass as its own (it may intentionally include sleep).
            if (wasConnected && withContext(Dispatchers.Main.immediate) { client.syncEngine?.isHistorySyncRunning == true }) {
                return@coroutineScope RingSyncPort.Outcome.Busy
            }
            onRunning()
            withContext(Dispatchers.Main.immediate) {
                if (wasConnected) c.syncNow()
                else {
                    // the connect handshake starts its own sync; ask only if none began
                    delay(HANDSHAKE_MS)
                    if (c.syncProgress.value == null) c.syncNow()
                }
            }
            val complete = withTimeoutOrNull(SYNC_MS) { finished.await() } != null
            // the last history rows reach the database (and the hub outbox) a moment after the ring's "done"
            delay(SETTLE_MS)
            RingSyncPort.Outcome.Synced(System.currentTimeMillis(), complete)
        } finally {
            finished.cancel()
        }
    }

    companion object {
        const val CONNECT_MS = 20_000L
        const val HANDSHAKE_MS = 3_000L
        const val SYNC_MS = 90_000L
        const val SETTLE_MS = 2_000L
    }
}

/**
 * (2.8.4, r068 B2) Drains the hub outbox now, through the same uploader (and lock) as the upload worker, so a command's
 * answer reaches Vitals after its data. Bounded: a slow or refusing server leaves the rest to the regular upload.
 */
class HubFlush(private val app: Context) : UploadPort {
    override suspend fun flush(): Boolean {
        delay(SETTLE_MS)
        val emptied = withTimeoutOrNull(FLUSH_MS) {
            val uploader = HubSync.uploader(app)
            repeat(MAX_PASSES) {
                when (val r = uploader.drain()) {
                    HubDrainResult.Empty -> return@withTimeoutOrNull true
                    is HubDrainResult.Success -> if (!r.hasMore) return@withTimeoutOrNull true
                    else -> return@withTimeoutOrNull false
                }
            }
            false
        } ?: false
        if (!emptied) HubSync.requestUpload(app)
        return emptied
    }

    companion object {
        const val SETTLE_MS = 1_500L
        const val FLUSH_MS = 40_000L
        const val MAX_PASSES = 20
    }
}

/**
 * `update.check` (Vitals 0.7.0): the engine is part of Vitals, which updates itself (its own updater, one tap). The
 * type is no longer in [CommandExecutor.CAPABILITIES], so Vitals never offers it; an older Vitals that still sends it
 * gets `rejected` `updates_in_vitals`.
 */
object VitalsUpdatePort : UpdatePort {
    override suspend fun check(): UpdatePort.Result = UpdatePort.Result("UPDATES_IN_VITALS")
}
