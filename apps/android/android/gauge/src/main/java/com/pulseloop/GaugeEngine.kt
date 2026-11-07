package com.pulseloop

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.WorkManager
import com.pulseloop.broadcasting.BroadcastOutboxDispatcher
import com.pulseloop.data.DataRepairs
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.diagnostics.CrashLogger
import com.pulseloop.engine.EngineIdentityStore
import com.pulseloop.engine.EngineMode
import com.pulseloop.engine.EnginePairing
import com.pulseloop.engine.GaugePresence
import com.pulseloop.hub.HubSync
import com.pulseloop.hub.HubUrl
import com.pulseloop.ring.RingConnectionState
import com.pulseloop.ring.RingDeviceType
import com.pulseloop.service.AppVisibility
import com.pulseloop.service.RingConnectionService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * (Vitals 0.7.0) Gauge's engine as part of Vitals: what Gauge's `PulseLoopApplication.onCreate` did, behind one switch
 * that follows [EngineMode].
 *
 * The engine is **off** (passive, or waiting for take over) while the Gauge app is installed or before the person has
 * tapped take over: the two must never both connect to the ring, count phone steps or count short videos. Off means
 * nothing starts: no runtime, no service, no worker, no upload; the accessibility service, the boot receiver, the
 * workers and the tile check [isActive] themselves. The state is looked at again whenever a package comes or goes and
 * whenever the app comes to the front ([reconcile]); Gauge installed again stops the engine.
 */
object GaugeEngine {
    private const val TAG = "GaugeEngine"
    private const val PREFS = "vitals_engine"
    private const val KEY_TOOK_OVER = "took_over"
    private const val KEY_TOOK_OVER_AT = "took_over_at"
    private const val KEY_AUTO_FIND = "auto_find_ring"
    private const val PRESENCE_TTL_MS = 3_000L

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var started = false
    @Volatile private var observerAdded = false
    @Volatile private var packageWatched = false
    private val adoptLock = Mutex()
    private val finding = java.util.concurrent.atomic.AtomicBoolean(false)

    @Volatile private var presence: Pair<Long, Boolean>? = null

    private val _changes = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
    /** Something the engine's state is made of changed (a package came or went, a take over, a permission answer). */
    val changes: SharedFlow<Unit> = _changes.asSharedFlow()
    fun notifyChanged() { _changes.tryEmit(Unit) }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Whether a Gauge app (either build) is on this phone; answered from a three-second cache. */
    fun gaugeInstalled(context: Context): Boolean {
        val now = SystemClock.elapsedRealtime()
        presence?.let { (at, value) -> if (now - at < PRESENCE_TTL_MS) return value }
        return GaugePresence.installed(context).isNotEmpty().also { presence = now to it }
    }

    fun tookOver(context: Context): Boolean = prefs(context).getBoolean(KEY_TOOK_OVER, false)

    fun mode(context: Context): EngineMode = EngineMode.of(gaugeInstalled(context), tookOver(context))

    fun isActive(context: Context): Boolean = mode(context) == EngineMode.ACTIVE

    /** When the person tapped take over (epoch ms), or null before. */
    fun tookOverAt(context: Context): Long? = prefs(context).getLong(KEY_TOOK_OVER_AT, 0L).takeIf { it > 0 }

    /** The app's `Application.onCreate`: watches for Gauge coming and going, and starts the engine when it is on. */
    fun onAppCreate(app: Application) {
        watchPackages(app)
        reconcile(app)
    }

    /**
     * Look at the mode again and make the engine match it: start it when it is [EngineMode.ACTIVE], stop it when it
     * was running and is not any more. Cheap; safe to call from anywhere.
     */
    @Synchronized
    fun reconcile(context: Context): EngineMode {
        val app = context.applicationContext as Application
        val mode = mode(app)
        if (mode == EngineMode.ACTIVE) start(app) else if (started) stop(app)
        return mode
    }

    /**
     * The person tapped take over. Remembered for good; the engine starts at once when Gauge is already gone, otherwise
     * (Gauge still installed) when Gauge is uninstalled. Never grants anything: the permissions are asked for with the
     * system's own dialogs.
     */
    fun takeOver(context: Context): EngineMode {
        val p = prefs(context)
        if (!p.getBoolean(KEY_TOOK_OVER, false)) {
            p.edit().putBoolean(KEY_TOOK_OVER, true).putLong(KEY_TOOK_OVER_AT, System.currentTimeMillis()).commit()
        }
        p.edit().putBoolean(KEY_AUTO_FIND, true).apply()
        presence = null
        val mode = reconcile(context)
        notifyChanged()
        return mode
    }

    /** The uninstall screen for the Gauge app that is installed (the owner taps OK), or null when none is. */
    fun uninstallGaugeIntent(context: Context): Intent? {
        val pkg = GaugePresence.installed(context).firstOrNull() ?: return null
        return Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    // ---- server identity ----

    /**
     * The web layer's server address and Vitals-device credential. Empty values mean the Vitals pairing ended: the
     * engine forgets its identity and revokes its own upload token. A bad address is the only thing refused; a server
     * that cannot be reached or does not know `pair-device` yet shows in the upload state and is tried again.
     */
    suspend fun configure(context: Context, serverUrl: String, deviceToken: String) {
        val app = context.applicationContext
        adoptLock.withLock {
            val identity = EngineIdentityStore.get(app)
            if (serverUrl.isBlank() || deviceToken.isBlank()) {
                identity.clear()
                if (HubSync.isPaired(app)) HubSync.unpair(app)
            } else {
                HubUrl.validationError(serverUrl)?.let { throw IllegalArgumentException(it) }
                identity.save(serverUrl, deviceToken)
                adoptIdentityLocked(app)
            }
        }
        notifyChanged()
    }

    /**
     * Gets (or renews) the engine's own upload token from the server with the Vitals credential, when it has none, the
     * server refused it, or the address changed. Never while passive: a Gauge that is still installed uploads.
     */
    suspend fun adoptIdentity(context: Context) {
        val app = context.applicationContext
        adoptLock.withLock { adoptIdentityLocked(app) }
        notifyChanged()
    }

    /** Read inside the same lock as clear/save: a queued foreground adoption cannot resurrect a forgotten identity. */
    private suspend fun adoptIdentityLocked(app: Context) {
        if (!isActive(app)) return
        val identity = EngineIdentityStore.get(app).get() ?: return
        val store = HubSync.store(app)
        if (!EnginePairing.needsPair(store.pairing.value, identity.serverUrl)) return
        when (val outcome = HubSync.pairDevice(app, identity.serverUrl, identity.deviceToken)) {
            HubSync.PairOutcome.Paired -> Log.i(TAG, "paired with the server")
            is HubSync.PairOutcome.Failed -> store.recordError(outcome.message, System.currentTimeMillis())
        }
    }

    // ---- finding the ring ----

    /** The person removed the ring: it is not looked for again until they connect one or take over again. */
    fun stopAutoFind(context: Context) = prefs(context).edit().putBoolean(KEY_AUTO_FIND, false).apply()

    /**
     * With no ring known and the app in front, scans once and connects the J-Style 2301 (the owner's ring)
     * when it is in range. Any other ring is the person's to choose (`scanRings`, `connectRing`): a neighbour's ring
     * is never connected on its own. Needs the Bluetooth permissions; asks for nothing.
     */
    fun maybeFindRing(context: Context) {
        val app = context.applicationContext
        if (!isActive(app) || !prefs(app).getBoolean(KEY_AUTO_FIND, true)) return
        if (!finding.compareAndSet(false, true)) return
        appScope.launch {
            try {
                val runtime = PulseLoopRuntime.ensureRing(app)
                val client = runtime.bleClient
                if (!client.hasPermissions() || PulseLoopDatabase.getInstance(app).deviceDao().currentReal() != null) return@launch
                if (client.state.value.connectionState in setOf(RingConnectionState.CONNECTED, RingConnectionState.CONNECTING)) return@launch
                kotlinx.coroutines.withContext(Dispatchers.Main.immediate) { client.startScanning() }
                val deadline = SystemClock.elapsedRealtime() + FIND_SCAN_MS
                var target: String? = null
                while (SystemClock.elapsedRealtime() < deadline && target == null) {
                    delay(500)
                    target = client.state.value.discovered.firstOrNull { it.deviceType == RingDeviceType.JSTYLE_2301 }?.id
                    if (client.state.value.connectionState != RingConnectionState.SCANNING && target == null) break
                }
                kotlinx.coroutines.withContext(Dispatchers.Main.immediate) {
                    if (target != null) client.connectTo(target) else client.stopScanning()
                }
            } catch (e: Exception) {
                Log.w(TAG, "ring search failed: ${e.message}")
            } finally {
                finding.set(false)
                notifyChanged()
            }
        }
    }

    // ---- lifecycle ----

    private fun watchPackages(app: Application) {
        if (packageWatched) return
        packageWatched = true
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addDataScheme("package")
        }
        ContextCompat.registerReceiver(app, object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val pkg = intent.data?.schemeSpecificPart
                if (pkg !in GaugePresence.PACKAGES || intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)) return
                presence = null
                reconcile(context)
                notifyChanged()
                // Gauge just left: the engine is on now, and finds the ring while the app is in front.
                if (isActive(context)) maybeFindRing(context)
            }
        }, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    @Synchronized
    private fun start(app: Application) {
        if (started) return
        started = true
        CrashLogger.install(app)
        AppVisibility.start()
        // The durable external-event dispatcher: idle while MQTT is off or the outbox is empty.
        BroadcastOutboxDispatcher.start(app)
        // The home-server upload: loads the pairing persistence reads before queueing a hub row, keeps the upload alive.
        HubSync.start(app)
        // The persistence subscriber before any worker or BLE callback can publish to the in-process event bus.
        PulseLoopRuntime.ensurePersistence(app)
        PulseLoopRuntime.ensureRing(app)
        com.pulseloop.diagnostics.DiagnosticsSubscriber(PulseLoopDatabase.getInstance(app)).start(appScope)
        com.pulseloop.data.RetentionWorker.schedule(app)
        // The 15-minute Health Connect reader (a no-op without its grants; it never prompts).
        com.pulseloop.health.reader.HealthConnectReaderWorker.schedule(app)
        appScope.launch {
            com.pulseloop.data.RetentionWorker.sweepIfDue(app, PulseLoopDatabase.getInstance(app))
        }
        // Versioned repairs preserve source history, then refresh the derived indices even with the ring offline.
        appScope.launch {
            DataRepairs.runIfNeeded(app)
            DataRepairs.repairSleepDurationsIfNeeded(app)
            DataRepairs.repairAfterClockDuplicatesIfNeeded(app)
            com.pulseloop.service.LocalInsightEngine.recomputeAndPublish(PulseLoopDatabase.getInstance(app))
        }
        // The server identity the web layer gave, when there is one and no token yet.
        appScope.launch { adoptIdentity(app) }
        val main = android.os.Handler(android.os.Looper.getMainLooper())
        main.post {
            // Health Connect without background read: reconcile while Vitals is open (a no-op where the 15-minute
            // worker can read).
            com.pulseloop.health.reader.HcForegroundReader.runWhileResumed(ProcessLifecycleOwner.get(), app)
            if (observerAdded) return@post
            observerAdded = true
            ProcessLifecycleOwner.get().lifecycle.addObserver(
                LifecycleEventObserver { _, event ->
                    if (event == Lifecycle.Event.ON_START) {
                        // Gauge may have come back while the app was away.
                        if (reconcile(app) != EngineMode.ACTIVE) return@LifecycleEventObserver
                        BroadcastOutboxDispatcher.onProcessForeground(app)
                        PulseLoopRuntime.onForeground(app)
                        appScope.launch { adoptIdentity(app) }
                        maybeFindRing(app)
                    } else if (event == Lifecycle.Event.ON_STOP && started) {
                        PulseLoopRuntime.onBackground(app)
                    }
                },
            )
        }
    }

    /** Gauge is back: stop what the engine started, so only one of the two holds the ring and counts. */
    @Synchronized
    private fun stop(app: Application) {
        started = false
        runCatching { PulseLoopRuntime.ensureRing(app).bleClient.disconnect() }
        runCatching { RingConnectionService.stop(app) }
        runCatching { com.pulseloop.command.CommandChannel.stopIn() }
        runCatching { com.pulseloop.phone.PhoneStepCounter.stopIn() }
        runCatching { com.pulseloop.phone.PhoneActivityRecognition.stopIn() }
        runCatching { WorkManager.getInstance(app).cancelAllWork() }
    }

    private const val FIND_SCAN_MS = 25_000L
}
