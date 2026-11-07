package com.pulseloop.phone

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity
import com.pulseloop.data.sources.ActivityAcquisitionEntity
import com.pulseloop.data.sources.ActivitySourceDao
import com.pulseloop.data.sources.ActivityTransitionEntity
import com.pulseloop.data.sources.PhoneAnchorEntity
import com.pulseloop.data.sources.SourcesDatabase
import com.pulseloop.phone.PhoneStepSegmenter.UtcAnchor
import kotlin.coroutines.resume
import kotlin.math.abs
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The phone's Activity Recognition as an evidence source for automatic workout detection (Gauge 2.8.3,
 * auto-detection CONTRACT §1): the Transition API's ENTER/EXIT events for `IN_VEHICLE`, `ON_BICYCLE`,
 * `RUNNING`, `WALKING` and `STILL`, delivered to [ActivityTransitionReceiver] through an explicit
 * broadcast [PendingIntent].
 *
 * - **Occurrence time, not callback time.** An event's `elapsedRealtimeNanos` maps to UTC through the
 *   boot/UTC anchor the phone step counter uses (`phone_anchors`, `UTC = anchor UTC + (m − anchor m)`):
 *   the newest anchor of this boot, unless the wall clock has moved away from it (a clock change no
 *   one anchored), in which case a fresh anchor is taken and shared the same way.
 * - **Events are durable before anything else.** One callback's events are inserted in one transaction,
 *   unique on (boot, elapsed ns, activity, transition): a re-delivered event is ignored, and the upload
 *   id is a hash of the same identity, so a replay is the same event everywhere.
 * - **Acquisition is what was registered, not what was permitted** ([ActivityRecognitionLog]): an
 *   interval is `listening` only after Play Services accepted the registration. A refusal is `failed`,
 *   no Play Services is `unsupported`, no grant is `noPermission`, and stopping is `stopped`. Each
 *   registration attempt has its own `registration_epoch`. Gaps between intervals are unknown.
 * - Registered again after a reboot or package replacement (both lose Play Services registrations;
 *   [com.pulseloop.service.RingBootReceiver]), when the permission comes back (the heartbeat sees the
 *   grant) and whenever acquisition restarts with the always-on service, alongside [PhoneStepCounter].
 * - Detection never starts a recording or ring sport mode: this class only records evidence.
 *
 * The core is plain suspend code over [Store], [Registrar] and [PhoneStepCounter.Clock]; calls must be
 * serialised by the caller (the Android wrapper funnels everything through one channel).
 */
class PhoneActivityRecognition(
    private val store: Store,
    private val registrar: Registrar,
    private val clock: PhoneStepCounter.Clock,
    private val log: ActivityRecognitionLog,
    private val hasPermission: () -> Boolean,
    /** Called after new events are durable (production: ask the hub uploader to run soon). */
    private val onRecords: () -> Unit = {},
) {
    interface Store {
        /** Inserts one callback's rows in one transaction, ignoring known events; returns how many were new. */
        suspend fun insertTransitions(rows: List<ActivityTransitionEntity>): Int
        suspend fun latestAnchor(bootId: String): PhoneAnchorEntity?
        suspend fun putAnchor(anchor: PhoneAnchorEntity)
        suspend fun maxEpoch(): Int
    }

    class DaoStore(private val dao: ActivitySourceDao) : Store {
        override suspend fun insertTransitions(rows: List<ActivityTransitionEntity>) = dao.insertTransitions(rows).count { it > 0 }
        override suspend fun latestAnchor(bootId: String) = dao.latestAnchor(bootId)
        override suspend fun putAnchor(anchor: PhoneAnchorEntity) = dao.putAnchor(anchor)
        override suspend fun maxEpoch() = dao.maxEpoch()
    }

    sealed interface RegisterResult {
        data object Listening : RegisterResult
        data object Unsupported : RegisterResult
        data object NoPermission : RegisterResult
        data class Failed(val reason: String?) : RegisterResult
    }

    /** Play Services' Transition API; a fake in tests. */
    interface Registrar {
        /** Play Services is present and usable on this phone. */
        val supported: Boolean
        suspend fun register(epoch: Int): RegisterResult
        suspend fun unregister()
    }

    /** One `ActivityTransitionEvent` as delivered. */
    data class RawTransition(val activityType: Int, val transitionType: Int, val elapsedNs: Long)

    /** The state this process last entered, or null before [start]. */
    var state: String? = null
        private set
    /** The registration this process holds while [state] is listening. */
    private var epoch: Int? = null
    private var recovered = false
    private var lastAttemptMs = Long.MIN_VALUE

    /** Register (idempotent while listening); returns the acquisition state entered. */
    suspend fun start(reason: String): String {
        val now = clock.utcMs()
        if (state == LISTENING) {
            log.touch(now)
            return LISTENING
        }
        if (!recovered) {
            log.recover()
            recovered = true
        }
        val attempt = store.maxEpoch() + 1
        lastAttemptMs = now
        val result = when {
            !registrar.supported -> RegisterResult.Unsupported
            !hasPermission() -> RegisterResult.NoPermission
            else -> try {
                registrar.register(attempt)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                RegisterResult.Failed(e.message)
            }
        }
        val next = stateOf(result)
        log.enter(next, clock.utcMs(), attempt)
        state = next
        epoch = if (next == LISTENING) attempt else null
        if (result is RegisterResult.Failed) Log.w(TAG, "Activity transitions not registered ($reason): ${result.reason}")
        return next
    }

    /** Remove the registration and log `stopped`. */
    suspend fun stop() {
        val current = state ?: return
        if (current == STOPPED) return
        if (current == LISTENING) {
            try {
                registrar.unregister()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) {
            }
        }
        log.enter(STOPPED, clock.utcMs(), epoch ?: log.openEpoch() ?: 0)
        state = STOPPED
        epoch = null
    }

    /**
     * Periodic: keep the open interval current (hourly roll), notice a revoked or restored permission,
     * and retry a failed registration every [RETRY_FAILED_MS].
     */
    suspend fun heartbeat() {
        val now = clock.utcMs()
        when (state) {
            LISTENING -> if (!hasPermission()) {
                log.enter(NO_PERMISSION, now, epoch ?: 0)
                state = NO_PERMISSION
                epoch = null
            } else {
                log.touch(now)
            }
            NO_PERMISSION -> if (hasPermission()) start("permissionRestored") else log.touch(now)
            FAILED -> if (now - lastAttemptMs >= RETRY_FAILED_MS || now < lastAttemptMs) start("retry") else log.touch(now)
            UNSUPPORTED -> log.touch(now)
            else -> Unit
        }
    }

    /**
     * One Transition API callback. Maps each event to UTC by its occurrence time, stores the batch in one
     * transaction (known events ignored), and touches a listening interval. Returns how many were new.
     * [epochHint] is the registration the delivering intent was made for, when it says.
     */
    suspend fun onTransitions(events: List<RawTransition>, epochHint: Int?): Int {
        val nowUtc = clock.utcMs()
        val nowNs = clock.elapsedNs()
        val boot = clock.bootId()
        val ep = epochHint ?: epoch ?: log.openEpoch() ?: 0
        // One anchor per callback, chosen once the batch has an event to map.
        var chosen: UtcAnchor? = null
        val rows = mutableListOf<ActivityTransitionEntity>()
        for (e in events) {
            val activity = activityName(e.activityType) ?: continue
            val transition = transitionName(e.transitionType) ?: continue
            // An elapsed time ≤ 0 or from the future is not an occurrence time; such an event is dropped
            // rather than stamped with the callback time.
            if (e.elapsedNs <= 0 || e.elapsedNs > nowNs + FUTURE_SLACK_NS) continue
            val a = chosen ?: anchorFor(boot, nowUtc, nowNs).also { chosen = it }
            rows += ActivityTransitionEntity(
                bootId = boot,
                elapsedNs = e.elapsedNs,
                activity = activity,
                transition = transition,
                occurredAtMs = a.utcMsAt(e.elapsedNs),
                anchorId = a.id,
                registrationEpoch = ep,
                receivedAtMs = nowUtc,
            )
        }
        val inserted = if (rows.isEmpty()) 0 else store.insertTransitions(rows)
        // A delivery proves the registration was alive now.
        log.touchListening(nowUtc)
        if (inserted > 0) onRecords()
        return inserted
    }

    /**
     * The step counter's newest anchor for this boot, unless the wall clock has left it (more than
     * [ANCHOR_TOLERANCE_MS]): then a fresh anchor, stored where the counter keeps its own.
     */
    private suspend fun anchorFor(boot: String, nowUtc: Long, nowNs: Long): UtcAnchor {
        val latest = store.latestAnchor(boot)?.let { UtcAnchor(it.anchorId, it.bootId, it.utcMs, it.mNs) }
        if (latest != null && abs(latest.utcMsAt(nowNs) - nowUtc) <= ANCHOR_TOLERANCE_MS) return latest
        val a = UtcAnchor("$boot:$nowUtc:$nowNs", boot, nowUtc, nowNs)
        store.putAnchor(PhoneAnchorEntity(a.id, boot, nowUtc, nowNs, if (latest == null) "activity" else "activityClock", nowUtc))
        return a
    }

    companion object {
        private const val TAG = "PhoneActivityRecognition"
        const val LISTENING = "listening"
        const val NO_PERMISSION = "noPermission"
        const val UNSUPPORTED = "unsupported"
        const val FAILED = "failed"
        const val STOPPED = "stopped"

        /** The wall clock may sit this far from the shared anchor before a fresh one is taken. */
        const val ANCHOR_TOLERANCE_MS = 2_000L
        private const val FUTURE_SLACK_NS = 1_000_000_000L
        const val RETRY_FAILED_MS = 15 * 60_000L
        private const val HEARTBEAT_MS = 60_000L

        const val ACTION_TRANSITIONS = "com.pulseloop.phone.ACTIVITY_TRANSITIONS"
        const val EXTRA_EPOCH = "com.pulseloop.phone.REGISTRATION_EPOCH"
        private const val REQUEST_CODE = 0x4152

        /** The activities registered, by the name the contract uses. */
        val ACTIVITIES: Map<Int, String> = linkedMapOf(
            DetectedActivity.IN_VEHICLE to "IN_VEHICLE",
            DetectedActivity.ON_BICYCLE to "ON_BICYCLE",
            DetectedActivity.RUNNING to "RUNNING",
            DetectedActivity.WALKING to "WALKING",
            DetectedActivity.STILL to "STILL",
        )

        fun activityName(type: Int): String? = ACTIVITIES[type]

        fun transitionName(type: Int): String? = when (type) {
            ActivityTransition.ACTIVITY_TRANSITION_ENTER -> "ENTER"
            ActivityTransition.ACTIVITY_TRANSITION_EXIT -> "EXIT"
            else -> null
        }

        fun stateOf(result: RegisterResult): String = when (result) {
            RegisterResult.Listening -> LISTENING
            RegisterResult.Unsupported -> UNSUPPORTED
            RegisterResult.NoPermission -> NO_PERMISSION
            is RegisterResult.Failed -> FAILED
        }

        @Volatile private var runtime: Runtime? = null

        private fun runtime(context: Context): Runtime {
            val app = context.applicationContext
            return runtime ?: synchronized(this) { runtime ?: Runtime(app).also { runtime = it } }
        }

        /** Register for the process (idempotent while listening): service start, boot, package replaced. */
        fun startIn(context: Context, reason: String) = runtime(context).start(reason)

        /** Remove the registration (the always-on service is going away). */
        fun stopIn() { runtime?.stop() }

        /** A callback from [ActivityTransitionReceiver]; [done] runs once the events are durable (or after 9 s). */
        internal fun deliver(context: Context, events: List<RawTransition>, epochHint: Int?, done: () -> Unit) =
            runtime(context).deliver(events, epochHint, done)

        internal fun pendingIntent(context: Context, epoch: Int?): PendingIntent {
            val intent = Intent(context, ActivityTransitionReceiver::class.java).setAction(ACTION_TRANSITIONS)
            if (epoch != null) intent.putExtra(EXTRA_EPOCH, epoch)
            // Mutable: Play Services fills the result into it. Explicit, so the mutability is safe.
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
        }
    }

    /** Android wiring: the Play Services registrar, one serial event channel and a heartbeat. */
    private class Runtime(private val app: Context) {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val events = Channel<suspend PhoneActivityRecognition.() -> Unit>(Channel.UNLIMITED)
        private val core: PhoneActivityRecognition
        private var heartbeat: Job? = null

        init {
            val db = SourcesDatabase.getInstance(app)
            val dao = db.activityDao()
            val bootId = PhoneStepCounter.bootId(app)
            core = PhoneActivityRecognition(
                store = DaoStore(dao),
                registrar = GmsRegistrar(app),
                clock = object : PhoneStepCounter.Clock {
                    override fun utcMs() = System.currentTimeMillis()
                    override fun elapsedNs() = SystemClock.elapsedRealtimeNanos()
                    override fun bootId() = bootId
                },
                log = ActivityRecognitionLog(ActivityRecognitionLog.DaoStore(dao)),
                hasPermission = { PhoneStepCounter.hasActivityRecognition(app) },
                onRecords = { com.pulseloop.hub.HubSync.requestUpload(app) },
            )
            scope.launch {
                for (event in events) {
                    try {
                        core.event()
                    } catch (e: kotlinx.coroutines.CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        Log.w(TAG, "Activity recognition event failed: ${e.message}")
                    }
                }
            }
        }

        fun start(reason: String) {
            events.trySend { Log.i(TAG, "Activity transitions ($reason): ${this.start(reason)}") }
            synchronized(this) {
                if (heartbeat == null) heartbeat = scope.launch {
                    while (isActive) {
                        delay(HEARTBEAT_MS)
                        events.trySend { this.heartbeat() }
                    }
                }
            }
        }

        fun stop() {
            synchronized(this) { heartbeat?.cancel(); heartbeat = null }
            events.trySend { this.stop() }
        }

        fun deliver(batch: List<RawTransition>, epochHint: Int?, done: () -> Unit) {
            val stored = CompletableDeferred<Unit>()
            events.trySend {
                try { onTransitions(batch, epochHint) } finally { stored.complete(Unit) }
            }
            scope.launch {
                try { withTimeoutOrNull(9_000L) { stored.await() } } finally { done() }
            }
        }
    }

    /** Play Services' Transition API. */
    private class GmsRegistrar(private val app: Context) : Registrar {
        override val supported: Boolean
            get() = runCatching { GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(app) == ConnectionResult.SUCCESS }.getOrDefault(false)

        @SuppressLint("MissingPermission") // checked by the core before every call
        override suspend fun register(epoch: Int): RegisterResult {
            val request = ActivityTransitionRequest(
                ACTIVITIES.keys.flatMap { type ->
                    listOf(ActivityTransition.ACTIVITY_TRANSITION_ENTER, ActivityTransition.ACTIVITY_TRANSITION_EXIT).map { t ->
                        ActivityTransition.Builder().setActivityType(type).setActivityTransition(t).build()
                    }
                },
            )
            return withTimeoutOrNull(REGISTER_TIMEOUT_MS) {
                suspendCancellableCoroutine<RegisterResult> { cont ->
                    try {
                        ActivityRecognition.getClient(app)
                            .requestActivityTransitionUpdates(request, pendingIntent(app, epoch))
                            .addOnSuccessListener { if (cont.isActive) cont.resume(RegisterResult.Listening) }
                            .addOnFailureListener { e ->
                                if (!cont.isActive) return@addOnFailureListener
                                cont.resume(
                                    when {
                                        e is SecurityException -> RegisterResult.NoPermission
                                        e is ApiException && e.statusCode == CommonStatusCodes.API_NOT_CONNECTED -> RegisterResult.Unsupported
                                        else -> RegisterResult.Failed(e.message)
                                    },
                                )
                            }
                    } catch (e: SecurityException) {
                        if (cont.isActive) cont.resume(RegisterResult.NoPermission)
                    }
                }
            } ?: RegisterResult.Failed("timeout")
        }

        @SuppressLint("MissingPermission")
        override suspend fun unregister() {
            ActivityRecognition.getClient(app).removeActivityTransitionUpdates(pendingIntent(app, null))
        }

        companion object { private const val REGISTER_TIMEOUT_MS = 30_000L }
    }
}

/** Receives the Transition API's results through the explicit [PendingIntent]; not exported. */
class ActivityTransitionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != PhoneActivityRecognition.ACTION_TRANSITIONS || !ActivityTransitionResult.hasResult(intent)) return
        val result = ActivityTransitionResult.extractResult(intent) ?: return
        val events = result.transitionEvents.map {
            PhoneActivityRecognition.RawTransition(it.activityType, it.transitionType, it.elapsedRealTimeNanos)
        }
        if (events.isEmpty()) return
        val epoch = intent.getIntExtra(PhoneActivityRecognition.EXTRA_EPOCH, 0).takeIf { it > 0 }
        val pending = goAsync()
        PhoneActivityRecognition.deliver(context, events, epoch) { pending.finish() }
    }
}

/**
 * When the Transition API registration was actually in place (`phone/activity_recognition_acquisition`):
 * intervals of `listening | noPermission | unsupported | failed | stopped`, each with its registration
 * epoch. Like [PhoneAcquisitionLog]: one interval open at a time, transitions in one transaction, and an
 * interval never crosses a UTC hour boundary (the next [touch] after the hour closes it and opens a
 * continuation with the same state and epoch). Only closed intervals are uploaded.
 *
 * Unlike the step counter's log, a process death leaves a **gap**, not a `stopped` interval: a Play
 * Services registration can outlive the process, so what happened after the last-seen moment is
 * unknown, and the contract reads a gap as unknown.
 */
class ActivityRecognitionLog(private val store: Store) {

    interface Store {
        suspend fun openInterval(): ActivityAcquisitionEntity?
        suspend fun transition(closing: ActivityAcquisitionEntity?, next: ActivityAcquisitionEntity?)
        suspend fun touchOpen(at: Long)
    }

    class DaoStore(private val dao: ActivitySourceDao) : Store {
        override suspend fun openInterval() = dao.openInterval()
        override suspend fun transition(closing: ActivityAcquisitionEntity?, next: ActivityAcquisitionEntity?) = dao.transition(closing, next)
        override suspend fun touchOpen(at: Long) = dao.touchOpen(at)
    }

    /** Close an interval left open by a previous process at its last-seen moment; the rest stays unknown. */
    suspend fun recover() {
        val open = store.openInterval() ?: return
        store.transition(open.copy(toMs = open.lastSeenMs.coerceAtLeast(open.fromMs)), null)
    }

    /** Enter [state] for registration [epoch] at [at]; the same state and epoch only touches. */
    suspend fun enter(state: String, at: Long, epoch: Int) {
        val open = store.openInterval()
        if (open != null && open.state == state && open.registrationEpoch == epoch) {
            touch(at)
            return
        }
        val closing = open?.copy(toMs = at.coerceAtLeast(open.fromMs), lastSeenMs = maxOf(at, open.fromMs))
        store.transition(closing, ActivityAcquisitionEntity(fromMs = at, toMs = null, state = state, lastSeenMs = at, registrationEpoch = epoch))
    }

    /** The open interval still holds at [at]; rolls it over at a UTC hour boundary. */
    suspend fun touch(at: Long) {
        var open = store.openInterval() ?: return
        while (true) {
            val hourEnd = (Math.floorDiv(open.fromMs, HOUR_MS) + 1) * HOUR_MS
            if (at < hourEnd) break
            store.transition(
                open.copy(toMs = hourEnd, lastSeenMs = hourEnd),
                ActivityAcquisitionEntity(fromMs = hourEnd, toMs = null, state = open.state, lastSeenMs = hourEnd, registrationEpoch = open.registrationEpoch),
            )
            open = store.openInterval() ?: return
        }
        store.touchOpen(at)
    }

    /** [touch], only while the open interval is `listening` (a delivered event proves nothing else). */
    suspend fun touchListening(at: Long) {
        if (store.openInterval()?.state == PhoneActivityRecognition.LISTENING) touch(at)
    }

    suspend fun openEpoch(): Int? = store.openInterval()?.registrationEpoch

    private companion object { const val HOUR_MS = 3_600_000L }
}
