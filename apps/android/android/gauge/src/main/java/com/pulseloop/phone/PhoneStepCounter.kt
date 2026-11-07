package com.pulseloop.phone

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import com.pulseloop.data.sources.PhoneAnchorEntity
import com.pulseloop.data.sources.PhoneCounterLastEntity
import com.pulseloop.data.sources.PhonePendingSpanEntity
import com.pulseloop.data.sources.PhoneSourceDao
import com.pulseloop.data.sources.PhoneStepRecordEntity
import com.pulseloop.data.sources.SourcesDatabase
import com.pulseloop.phone.PhoneStepSegmenter.CounterSample
import com.pulseloop.phone.PhoneStepSegmenter.Diff
import com.pulseloop.phone.PhoneStepSegmenter.UtcAnchor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The phone's own step counter as an evidence source (energy SPEC §GB.1, DECISION D4: the direct
 * counter plus step-detector timing is the primary phone lineage; Health Connect device-native
 * steps are uploaded as the alternate).
 *
 * - `TYPE_STEP_COUNTER` is registered while the always-on [com.pulseloop.service.RingConnectionService]
 *   runs (which it does for the phone alone, with no ring paired or after a user disconnect — 2.8.1), with `maxReportLatency` 60 s (P). Its presence is checked first; no sensor → `noSensor`.
 * - Each sample `(boot_id, m_ns, C)` is persisted transactionally with the delta it closes
 *   ([PhoneSourceDao.commitSample]); [PhoneStepSegmenter] does the differencing.
 * - Where `TYPE_STEP_DETECTOR` exists it is registered too, and its event times place the delta in
 *   wall-clock minutes (P, engineering addition flagged for review). A delta waits up to
 *   [RESOLVE_GRACE_NS] for the detector's batch of the same period, because the two sensors batch
 *   independently.
 * - UTC = anchor UTC + (m − anchor m). The anchor is re-taken at every start and on every
 *   clock-change broadcast; each record names the anchor it used (`utc_anchor_id`).
 * - Acquisition state goes to [PhoneAcquisitionLog].
 * - `ACTIVITY_RECOGNITION` is a runtime permission (API 29+); without it the state is
 *   `noPermission` and nothing is registered. Nothing here prompts for it.
 *
 * The core below is plain suspend code over [Store], [Sensors] and [Clock], so the tests drive it
 * with a fake sensor manager. All calls must be serialised by the caller (the Android wrapper
 * funnels every callback through one channel).
 */
class PhoneStepCounter(
    private val store: Store,
    private val sensors: Sensors,
    private val clock: Clock,
    private val log: PhoneAcquisitionLog,
    private val hasPermission: () -> Boolean,
    /** Called after new records are durable (production: ask the hub uploader to run soon). */
    private val onRecords: () -> Unit = {},
    /**
     * Called from [heartbeat] at most every [CHECKPOINT_REQUEST_MS] while listening (production: ask the
     * hub uploader to run, which queues a checkpoint of the open acquisition interval — Gauge 2.8.3), so
     * observed zeros and a live walk reach the server within about five minutes, not at the hour.
     */
    private val onCheckpoint: () -> Unit = {},
) {
    interface Store {
        suspend fun last(): PhoneCounterLastEntity?
        suspend fun commitSample(last: PhoneCounterLastEntity, span: PhonePendingSpanEntity?)
        suspend fun pending(): List<PhonePendingSpanEntity>
        suspend fun resolve(spanId: Long, records: List<PhoneStepRecordEntity>)
        suspend fun putAnchor(anchor: PhoneAnchorEntity)
        suspend fun anchor(id: String): PhoneAnchorEntity?
    }

    class DaoStore(private val dao: PhoneSourceDao) : Store {
        override suspend fun last() = dao.last()
        override suspend fun commitSample(last: PhoneCounterLastEntity, span: PhonePendingSpanEntity?) = dao.commitSample(last, span)
        override suspend fun pending() = dao.pending()
        override suspend fun resolve(spanId: Long, records: List<PhoneStepRecordEntity>) = dao.resolve(spanId, records)
        override suspend fun putAnchor(anchor: PhoneAnchorEntity) = dao.putAnchor(anchor)
        override suspend fun anchor(id: String) = dao.anchor(id)
    }

    /**
     * The two step sensors. [register] returns null when the counter could not be registered, else
     * what was actually registered (the detector can be absent or refused while the counter works).
     */
    interface Sensors {
        val hasCounter: Boolean
        val hasDetector: Boolean
        fun register(onCounter: (tNs: Long, count: Long) -> Unit, onDetector: (tNs: Long) -> Unit): Registration?
        fun unregister()
    }

    /** What [Sensors.register] achieved beyond the counter itself. */
    data class Registration(val detector: Boolean)

    interface Clock {
        fun utcMs(): Long
        /** `SystemClock.elapsedRealtimeNanos()`: the base of `SensorEvent.timestamp`. */
        fun elapsedNs(): Long
        fun bootId(): String
    }

    private var listenId: Long? = null
    /** Registrations made by this process: only their spans can be timed by in-memory detector events. */
    private val ownListenIds = mutableSetOf<Long>()
    private var detectorListening = false
    private var anchor: UtcAnchor? = null
    private val detectorTimes = ArrayDeque<Long>()
    /** When each pending span was first seen by this process (elapsed ns), for the grace period. */
    private val seenAt = mutableMapOf<Long, Long>()

    val isListening: Boolean get() = listenId != null

    /** Start listening; returns the acquisition state entered. Idempotent. */
    suspend fun start(): String {
        val now = clock.utcMs()
        if (listenId != null) return PhoneAcquisitionLog.LISTENING
        log.recover(now)
        val state = when {
            !sensors.hasCounter -> PhoneAcquisitionLog.NO_SENSOR
            !hasPermission() -> PhoneAcquisitionLog.NO_PERMISSION
            else -> null
        }
        if (state != null) {
            log.enter(state, now)
            return state
        }
        takeAnchor("start")
        val id = now
        listenId = id
        ownListenIds += id
        val registration = runCatching { sensors.register({ t, c -> postCounter(t, c) }, { t -> postDetector(t) }) }.getOrNull()
        if (registration == null) {
            listenId = null
            detectorListening = false
            log.enter(PhoneAcquisitionLog.NO_SENSOR, now)
            return PhoneAcquisitionLog.NO_SENSOR
        }
        // What the sensor manager accepted, not what the phone advertises: a refused detector leaves
        // the counter's spans untimed and the interval's quiet minutes unknown, not zero.
        detectorListening = registration.detector
        log.enter(PhoneAcquisitionLog.LISTENING, now, detectorState(sensors.hasDetector, registration.detector))
        return PhoneAcquisitionLog.LISTENING
    }

    /** Stop listening, resolve what is pending (the detector has said all it will), log `stopped`. */
    suspend fun stop() {
        if (listenId == null) return
        runCatching { sensors.unregister() }
        resolveDue(force = true)
        listenId = null
        detectorListening = false
        log.enter(PhoneAcquisitionLog.STOPPED, clock.utcMs())
    }

    /** The wall clock or zone changed: later spans map to UTC with a fresh anchor. */
    suspend fun onClockChanged(reason: String) {
        if (listenId != null) takeAnchor(reason)
    }

    private var lastCheckpointMs: Long? = null

    /** Periodic: resolve spans whose grace has passed and keep the acquisition interval current. */
    suspend fun heartbeat() {
        resolveDue(force = false)
        if (listenId == null) return
        val now = clock.utcMs()
        log.touch(now)
        val last = lastCheckpointMs
        if (last == null || now - last >= CHECKPOINT_REQUEST_MS || now < last) {
            lastCheckpointMs = now
            onCheckpoint()
        }
    }

    // Hooks for the Android wrapper to replace with a channel post; the core handles them directly.
    internal var postCounter: (Long, Long) -> Unit = { _, _ -> }
    internal var postDetector: (Long) -> Unit = { }

    suspend fun onCounter(tNs: Long, count: Long) {
        val id = listenId ?: return
        val t = sane(tNs)
        val current = anchor ?: takeAnchor("start")
        val prev = store.last()?.let { CounterSample(it.bootId, it.mNs, it.count, it.listenId) }
        val cur = CounterSample(clock.bootId(), t, count, id)
        if (prev != null && prev.bootId == cur.bootId && prev.mNs == cur.mNs && prev.count == cur.count) return
        val span = when (val diff = PhoneStepSegmenter.difference(prev, cur)) {
            is Diff.Baseline -> null
            is Diff.Span -> diff.span.takeIf { it.steps > 0 }?.let {
                PhonePendingSpanEntity(
                    bootId = it.bootId,
                    mStartNs = it.mStartNs,
                    mEndNs = it.mEndNs,
                    steps = it.steps,
                    listenId = if (it.listenedThroughout) id else null,
                    anchorId = current.id,
                    createdAtMs = clock.utcMs(),
                )
            }
        }
        store.commitSample(
            PhoneCounterLastEntity(bootId = cur.bootId, mNs = t, count = count, listenId = id, anchorId = current.id, receivedAtMs = clock.utcMs()),
            span,
        )
        resolveDue(force = false)
        log.touch(clock.utcMs())
    }

    fun onDetector(tNs: Long) {
        if (listenId == null) return
        detectorTimes.addLast(sane(tNs))
        // A runaway buffer (a counter that never reports) must not grow without bound.
        while (detectorTimes.size > MAX_DETECTOR_EVENTS) detectorTimes.removeFirst()
    }

    /**
     * Resolve pending spans into records. A span is due when the detector has delivered an event
     * past its end, its grace period has passed, or [force]. A zero-step span is never pending: an
     * on-change counter only reports a change.
     */
    suspend fun resolveDue(force: Boolean) {
        val pending = store.pending()
        if (pending.isEmpty()) return
        val nowNs = clock.elapsedNs()
        val latestDetector = detectorTimes.lastOrNull()
        var wrote = false
        for (span in pending) {
            val own = span.listenId != null && span.listenId in ownListenIds
            val detectorCaughtUp = latestDetector != null && latestDetector > span.mEndNs
            val first = seenAt.getOrPut(span.id) { nowNs }
            val due = force || !own || !detectorListening || detectorCaughtUp || nowNs - first >= RESOLVE_GRACE_NS
            // In order: a later span must not spend detector events an earlier, waiting one needs.
            if (!due) break
            val anchorRow = store.anchor(span.anchorId)
            val spanAnchor = anchorRow?.let { UtcAnchor(it.anchorId, it.bootId, it.utcMs, it.mNs) }
                ?: anchor ?: takeAnchor("missing")
            val times = if (own && detectorListening) detectorTimes.filter { it > span.mStartNs && it <= span.mEndNs } else null
            val records = PhoneStepSegmenter.resolve(
                PhoneStepSegmenter.CounterSpan(span.bootId, span.mStartNs, span.mEndNs, span.steps, own),
                spanAnchor,
                times,
            ).map { it.toEntity(clock.utcMs()) }
            store.resolve(span.id, records)
            seenAt.remove(span.id)
            wrote = wrote || records.isNotEmpty()
            // Events at or before this span's end are spent.
            while (detectorTimes.isNotEmpty() && detectorTimes.first() <= span.mEndNs) detectorTimes.removeFirst()
        }
        if (wrote) onRecords()
    }

    private suspend fun takeAnchor(reason: String): UtcAnchor {
        val utc = clock.utcMs()
        val m = clock.elapsedNs()
        val boot = clock.bootId()
        val a = UtcAnchor("$boot:$utc:$m", boot, utc, m)
        store.putAnchor(PhoneAnchorEntity(a.id, boot, utc, m, reason, utc))
        anchor = a
        return a
    }

    /**
     * `SensorEvent.timestamp` is the elapsed-realtime base on current devices, but not guaranteed;
     * a value from the future or ≤ 0 is replaced by now rather than poisoning the support.
     */
    private fun sane(tNs: Long): Long {
        val now = clock.elapsedNs()
        return if (tNs <= 0 || tNs > now + 1_000_000_000L) now else tNs
    }

    companion object {
        private const val TAG = "PhoneStepCounter"

        /** The `phone/acquisition` detector field for a listening interval. */
        fun detectorState(hasDetector: Boolean, registered: Boolean): String = when {
            registered -> PhoneAcquisitionLog.DETECTOR_REGISTERED
            !hasDetector -> PhoneAcquisitionLog.DETECTOR_ABSENT
            else -> PhoneAcquisitionLog.DETECTOR_FAILED
        }
        /** (P) Twice the 60 s report latency. */
        const val RESOLVE_GRACE_NS = 120_000_000_000L
        const val MAX_REPORT_LATENCY_US = 60_000_000
        private const val MAX_DETECTOR_EVENTS = 50_000
        private const val HEARTBEAT_MS = 60_000L
        /** CONTRACT §1: an open acquisition interval reaches the server about every five minutes. */
        const val CHECKPOINT_REQUEST_MS = 5 * 60_000L

        @Volatile private var runtime: Runtime? = null

        /** Start the listener for the process (idempotent). Called by the always-on ring service. */
        fun startIn(context: Context) {
            val app = context.applicationContext
            val r = runtime ?: synchronized(this) { runtime ?: Runtime(app).also { runtime = it } }
            r.start()
        }

        /** Stop it (the ring service is going away). */
        fun stopIn() { runtime?.stop() }

        fun hasActivityRecognition(context: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

        /** `Settings.Global.BOOT_COUNT`, else the boot's wall minute (stable for one boot). */
        fun bootId(context: Context): String {
            val count = runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()
            if (count != null) return "b$count"
            return "w" + (System.currentTimeMillis() - SystemClock.elapsedRealtime()) / 60_000L
        }
    }

    /** Android wiring: real sensors, one serial event channel, a heartbeat and a clock receiver. */
    private class Runtime(private val app: Context) {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val events = Channel<suspend PhoneStepCounter.() -> Unit>(Channel.UNLIMITED)
        private val counter: PhoneStepCounter
        private var heartbeat: Job? = null
        private var receiverRegistered = false
        private val clockReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val reason = intent.action ?: "clock"
                events.trySend { onClockChanged(reason) }
            }
        }

        init {
            val dao = SourcesDatabase.getInstance(app).phoneDao()
            val bootId = bootId(app)
            counter = PhoneStepCounter(
                store = DaoStore(dao),
                sensors = AndroidSensors(app),
                clock = object : Clock {
                    override fun utcMs() = System.currentTimeMillis()
                    override fun elapsedNs() = SystemClock.elapsedRealtimeNanos()
                    override fun bootId() = bootId
                },
                log = PhoneAcquisitionLog(PhoneAcquisitionLog.DaoStore(dao)),
                hasPermission = { hasActivityRecognition(app) },
                onRecords = { com.pulseloop.hub.HubSync.requestUpload(app) },
                onCheckpoint = { com.pulseloop.hub.HubSync.requestUpload(app) },
            )
            counter.postCounter = { t, c -> events.trySend { onCounter(t, c) } }
            counter.postDetector = { t -> events.trySend { onDetector(t) } }
            scope.launch {
                for (event in events) {
                    try {
                        counter.event()
                    } catch (e: kotlinx.coroutines.CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        Log.w(TAG, "Phone step event failed: ${e.message}")
                    }
                }
            }
        }

        fun start() {
            events.trySend {
                val state = this.start()
                Log.i(TAG, "Phone step counter: $state")
            }
            synchronized(this) {
                if (!receiverRegistered) {
                    ContextCompat.registerReceiver(app, clockReceiver, IntentFilter().apply {
                        addAction(Intent.ACTION_TIME_CHANGED)
                        addAction(Intent.ACTION_TIMEZONE_CHANGED)
                    }, ContextCompat.RECEIVER_NOT_EXPORTED)
                    receiverRegistered = true
                }
                if (heartbeat == null) heartbeat = scope.launch {
                    while (isActive) {
                        delay(HEARTBEAT_MS)
                        events.trySend { this.heartbeat() }
                    }
                }
            }
        }

        fun stop() {
            synchronized(this) {
                heartbeat?.cancel(); heartbeat = null
                if (receiverRegistered) {
                    runCatching { app.unregisterReceiver(clockReceiver) }
                    receiverRegistered = false
                }
            }
            events.trySend { this.stop() }
        }
    }

    private class AndroidSensors(context: Context) : Sensors {
        private val manager = context.getSystemService(SensorManager::class.java)
        private val counterSensor: Sensor? = manager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        private val detectorSensor: Sensor? = manager?.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
        private var listener: SensorEventListener? = null

        override val hasCounter: Boolean get() = counterSensor != null
        override val hasDetector: Boolean get() = detectorSensor != null

        override fun register(onCounter: (Long, Long) -> Unit, onDetector: (Long) -> Unit): Registration? {
            val m = manager ?: return null
            val counter = counterSensor ?: return null
            val l = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    when (event.sensor.type) {
                        Sensor.TYPE_STEP_COUNTER -> onCounter(event.timestamp, event.values[0].toLong())
                        Sensor.TYPE_STEP_DETECTOR -> onDetector(event.timestamp)
                    }
                }
                override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
            }
            val ok = m.registerListener(l, counter, SensorManager.SENSOR_DELAY_NORMAL, MAX_REPORT_LATENCY_US)
            if (!ok) return null
            val detector = detectorSensor?.let { m.registerListener(l, it, SensorManager.SENSOR_DELAY_NORMAL, MAX_REPORT_LATENCY_US) } == true
            listener = l
            return Registration(detector)
        }

        override fun unregister() {
            listener?.let { manager?.unregisterListener(it) }
            listener = null
        }
    }
}

internal fun PhoneStepSegmenter.Record.toEntity(createdAtMs: Long) = PhoneStepRecordEntity(
    subject = subject,
    startMs = startMs,
    endMs = endMs,
    steps = steps,
    support = support,
    timing = timing,
    parentSteps = parentSteps,
    bootId = bootId,
    mStartNs = mStartNs,
    mEndNs = mEndNs,
    anchorId = anchorId,
    createdAtMs = createdAtMs,
)
