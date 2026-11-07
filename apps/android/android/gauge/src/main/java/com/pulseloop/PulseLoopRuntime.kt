package com.pulseloop

import android.app.Application
import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import com.pulseloop.broadcasting.BroadcastOutboxDispatcher
import com.pulseloop.data.DataRepairs
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.diagnostics.CrashLogger
import com.pulseloop.service.EventPersistenceSubscriber
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import com.pulseloop.ring.RingBLEClient
import com.pulseloop.ring.RingDeviceType
import com.pulseloop.ring.JStyle2301FirmwareProfile
import com.pulseloop.service.*
import com.pulseloop.settings.ApiKeyStore

/**
 * Process-lifetime data plumbing shared by the engine's services, Vitals' plugin and WorkManager.
 *
 * RingSyncWorker can start the app in a cold process, where no screen has ever opened. The
 * event bus is deliberately in-memory, so a persistence subscriber owned by Compose would leave
 * that worker's decoded packets queued only until the process is reclaimed. Keep the subscriber at
 * the application boundary instead ([GaugeEngine]); [ensurePersistence] is idempotent for the foreground and
 * background owners in this process.
 */
object PulseLoopRuntime {
    private val lock = Any()
    /** Recent nights the usual sleep window is learned from. */
    private const val SLEEP_WINDOW_NIGHTS = 14
    private const val BUILT_IN_BACKFILL_PREFS = "ring_auth_migration"
    private const val BUILT_IN_BACKFILL_DONE = "jstyle_v0789_builtin_backfill_started"

    @Volatile
    private var persistence: EventPersistenceSubscriber? = null

    data class RingRuntime(
        val bleClient: RingBLEClient,
        val coordinator: RingSyncCoordinator,
        val apiKeyStore: ApiKeyStore,
        val liveWorkout: LiveWorkoutManager,
        val gpsRecorder: GpsRouteRecorder,
        val batteryAlerts: BatteryAlertMonitor,
    )

    private val ring = ProcessRuntimeSlot<RingRuntime>()
    private val ringScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var legacyDisconnectJob: Job? = null
    private var foregroundRefreshJob: Job? = null

    fun onForeground(context: Context) {
        legacyDisconnectJob?.cancel(); legacyDisconnectJob = null
        val runtime = ensureRing(context)
        runtime.bleClient.reconnectIfNeeded()
        RingConnectionService.requestStart(context)
        if (foregroundRefreshJob?.isActive != true) {
            foregroundRefreshJob = ringScope.launch {
                while (isActive) {
                    // Count from the prior pass's completion, not its start. A slow GATT transfer
                    // cannot pile up another request while the single-operation queue is busy.
                    delay(FOREGROUND_REFRESH_MS)
                    if (!GaugeEngine.isActive(context) ||
                        !ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) break
                    val userStopped = context.getSharedPreferences("ring_ble", Context.MODE_PRIVATE)
                        .getBoolean(RingBLEClient.USER_DISCONNECTED_KEY, false)
                    if (userStopped || !runtime.bleClient.hasPermissions()) continue
                    if (!runtime.coordinator.refreshForeground()) continue
                    withTimeoutOrNull(FOREGROUND_PASS_TIMEOUT_MS) {
                        while (isActive && runtime.bleClient.syncEngine?.isHistorySyncRunning == true) delay(500)
                    }
                }
            }
        }
    }

    fun onBackground(context: Context) {
        foregroundRefreshJob?.cancel(); foregroundRefreshJob = null
        val runtime = ensureRing(context)
        legacyDisconnectJob?.cancel()
        if (runtime.bleClient.state.value.connectionState == com.pulseloop.ring.RingConnectionState.SCANNING) {
            runtime.bleClient.stopScanning()
        }
        if (runtime.apiKeyStore.keepConnected || runtime.liveWorkout.state.value.activeSession != null) return
        // Process-owned: swiping away the Activity cannot cancel legacy mode's grace period.
        legacyDisconnectJob = ringScope.launch {
            delay(45_000)
            if (!runtime.apiKeyStore.keepConnected && runtime.liveWorkout.state.value.activeSession == null &&
                !ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                runtime.bleClient.disconnect()
            }
        }
    }

    private const val FOREGROUND_REFRESH_MS = 60_000L
    private const val FOREGROUND_PASS_TIMEOUT_MS = 120_000L

    fun ensureRing(context: Context): RingRuntime = ring.ensure {
            val app = context.applicationContext
            ensurePersistence(app)
            val db = PulseLoopDatabase.getInstance(app)
            val backfillPrefs = app.getSharedPreferences(BUILT_IN_BACKFILL_PREFS, Context.MODE_PRIVATE)
            val keys = ApiKeyStore(app)
            val client = RingBLEClient(app, waitForRuntimeInitialization = true)
            val coordinator = RingSyncCoordinator(client, db, keys)
            val gps = GpsRouteRecorder(app, db)
            val runtime = RingRuntime(client, coordinator, keys,
                LiveWorkoutManager(coordinator, db, gps, app), gps, BatteryAlertMonitor(app))
            // Adapter events belong to the process runtime, just like the GATT client. The
            // foreground app can use a saved ring even when no background service is running.
            RingBluetoothObserver(app, client) {
                GaugeEngine.isActive(app) && (RingConnectionService.running ||
                    ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
            }.start()
            client.onConnected = { coordinator.runStartupSequence() }
            client.onFirmwareRead = { fw ->
                ringScope.launch(Dispatchers.IO) {
                    db.deviceDao().current()?.let { device ->
                        if (device.firmwareVersion.isNullOrBlank() || !device.firmwareVersion!!.contains("V")) {
                            db.deviceDao().upsert(device.copy(firmwareVersion = fw, updatedAt = System.currentTimeMillis()))
                        }
                    }
                }
            }
            coordinator.start()
            ringScope.launch {
                client.state.map { it.connectionState == com.pulseloop.ring.RingConnectionState.CONNECTED }
                    .distinctUntilChanged().collect { connected ->
                        BroadcastOutboxDispatcher.setRingConnected(app, connected)
                    }
            }
            ringScope.launch {
                client.state.map { it.credentialAuthenticated }.distinctUntilChanged().collect { accepted ->
                    if (accepted && coordinator.confirmBuiltInBackfillAuth()) {
                        backfillPrefs.edit().putBoolean(BUILT_IN_BACKFILL_DONE, true).apply()
                    }
                }
            }
            // r069: a sleep read closes the J-Style ring's open sleep record (no REM after it), so
            // unattended passes leave sleep alone inside the person's usual window while the phone is
            // unused; the window follows the stored nights.
            val power = app.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            com.pulseloop.ring.RingSleepReadHold.interactive = { power.isInteractive }
            val learnSleepWindow = {
                ringScope.launch(Dispatchers.IO) {
                    val nights = db.sleepSessionDao().recentReal(SLEEP_WINDOW_NIGHTS * 2)
                        .groupBy { it.date }.values.map { day -> day.maxBy { it.endAt - it.startAt } }
                        .take(SLEEP_WINDOW_NIGHTS).map { it.startAt to it.endAt }
                    com.pulseloop.ring.RingSleepReadHold.window =
                        com.pulseloop.ring.RingSleepReadHold.learn(nights, java.time.ZoneId.systemDefault())
                }
            }
            learnSleepWindow()
            ringScope.launch {
                var wasSyncing = false
                coordinator.syncProgress.collect { progress ->
                    val syncing = progress != null
                    // Preserve the existing supplemental sleep fetch across UI destruction.
                    // Connect never deletes any history; this refresh is idempotent.
                    if (wasSyncing && !syncing) {
                        coordinator.syncSleepNow()
                        learnSleepWindow()
                    }
                    wasSyncing = syncing
                }
            }
            runtime.batteryAlerts.start()
            RingSyncWorker.schedule(app)
            ringScope.launch {
                // Reset only once, before this process attempts its first connection.
                db.deviceDao().current()?.let { device ->
                    if (device.stateRaw == "CONNECTED" || device.stateRaw == "CONNECTING") {
                        db.deviceDao().upsert(device.copy(stateRaw = "DISCONNECTED", updatedAt = System.currentTimeMillis()))
                    }
                    if (device.id != "demo-device" && device.deviceType == RingDeviceType.JSTYLE_2301 &&
                        JStyle2301FirmwareProfile.forRevision(device.firmwareVersion).requiresAuthentication &&
                        !backfillPrefs.getBoolean(BUILT_IN_BACKFILL_DONE, false)) {
                        coordinator.requestBuiltInBackfillOnNextConnect()
                    }
                }
                client.markRuntimeReady()
                RingConnectionService.requestStart(app)
                // A pairing event is durable before eligibility is evaluated. Also catches a
                // first pair whose onConnected callback beats the persistence collector.
                db.deviceDao().currentFlow().map { it?.takeUnless { d -> d.id == "demo-device" }?.id }
                    .distinctUntilChanged().collect { id ->
                        if (id != null) RingConnectionService.requestStart(app)
                    }
            }
            runtime
    }

    fun ensurePersistence(context: Context): EventPersistenceSubscriber {
        persistence?.let { return it }
        synchronized(lock) {
            persistence?.let { return it }
            val appContext = context.applicationContext
            val subscriber = EventPersistenceSubscriber(
                context = appContext,
                db = PulseLoopDatabase.getInstance(appContext),
            )
            subscriber.start()
            persistence = subscriber
            return subscriber
        }
    }
}
