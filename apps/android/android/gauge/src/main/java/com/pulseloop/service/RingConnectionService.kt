package com.pulseloop.service

import com.pulseloop.R
import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.ForegroundInfo
import com.pulseloop.PulseLoopRuntime
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.ring.RingBLEClient
import com.pulseloop.ring.RingConnectionState
import com.pulseloop.wearables.WearableModel
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.sync.withLock

/**
 * Keeps the process alive; the process runtime, not this Service, owns the one GATT client.
 *
 * Gauge 2.8.1 (audit S18): the service also hosts the phone step counter and Vitals' command
 * channel, and those no longer depend on the ring. It runs while [RingServiceEligibility.Plan.runService]
 * — the ring link is eligible, or the phone counter is (its own `ACTIVITY_RECOGNITION` grant) — and
 * connects the ring only while the link is. With no paired ring, keep-connected off, or after a user
 * disconnect, it stays up for the phone alone (promoted as `health` on Android 14+, without
 * `connectedDevice`), with a notification that says so.
 */
class RingConnectionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var updateJob: Job? = null
    private var lastNotificationAt = 0L
    private var lastState: RingConnectionState? = null
    private var notificationDelay: Job? = null
    private var pendingNotification = RingBLEClient.BLEState() to (null as Long?)
    private var receiverRegistered = false
    /** Whether this evaluation connected the ring (vs. running for the phone alone). */
    private var linkActive = false
    private var promotedTypes: Int? = null
    private val evaluation = kotlinx.coroutines.sync.Mutex()
    private val systemEvents = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val client = PulseLoopRuntime.ensureRing(context).bleClient
            when (intent.action) {
                Intent.ACTION_SCREEN_ON -> client.reconnectIfNeeded()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        ContextCompat.registerReceiver(this, systemEvents, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
        }, ContextCompat.RECEIVER_EXPORTED)
        receiverRegistered = true
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Promote before database, preferences, or runtime initialization (including cold restart).
        // The link is assumed wanted here; [evaluate] drops `connectedDevice` once it knows otherwise.
        val types = RingServiceEligibility.foregroundTypes(Build.VERSION.SDK_INT, link = true, bluetoothGranted(this),
            com.pulseloop.phone.PhoneStepCounter.hasActivityRecognition(this))
        if (types == null || !promote(types)) {
            stopSelf()
            return START_NOT_STICKY
        }
        serviceRunning = true
        val runtime = PulseLoopRuntime.ensureRing(this)
        val disconnect = intent?.action == ACTION_DISCONNECT
        // The notification's Disconnect: sticky for the ring (userDisconnect), but the phone counter
        // and the command channel keep running when they may.
        if (disconnect) runtime.bleClient.userDisconnect()
        evaluate(withdrawLink = disconnect, fromStartCommand = true)
        return START_STICKY
    }

    /** startForeground with [types]; false when Android refuses it (a type's permission is missing). */
    private fun promote(types: Int): Boolean = try {
        val notification = notification(this, pendingNotification.first, pendingNotification.second, linkActive || promotedTypes == null)
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, types)
        else startForeground(NOTIFICATION_ID, notification)
        promotedTypes = types
        true
    } catch (e: SecurityException) {
        Log.w(TAG, "Foreground promotion refused for types $types", e)
        false
    } catch (e: IllegalStateException) {
        Log.w(TAG, "Foreground promotion refused for types $types", e)
        false
    }

    /**
     * Decide what this service hosts now: the ring link (only when [RingServiceEligibility.Plan.link]
     * and not [withdrawLink]), the phone step counter and the command channel. Stops the service when
     * neither the link nor the phone is eligible. [withdrawLink] is a one-shot "the ring link is no
     * longer wanted" (user disconnect, forget, keep-connected off): this pass never connects it.
     */
    internal fun evaluate(withdrawLink: Boolean, fromStartCommand: Boolean = false) {
        scope.launch {
            evaluation.withLock {
                val runtime = PulseLoopRuntime.ensureRing(this@RingConnectionService)
                val plan = plan(this@RingConnectionService)
                val link = plan.link && !withdrawLink && runtime.bleClient.hasPermissions()
                if (!link && !plan.phone) {
                    stopSelf()
                    return@withLock
                }
                val ar = com.pulseloop.phone.PhoneStepCounter.hasActivityRecognition(this@RingConnectionService)
                val types = RingServiceEligibility.foregroundTypes(Build.VERSION.SDK_INT, link, bluetoothGranted(this@RingConnectionService), ar)
                if (types == null) {
                    stopSelf()
                    return@withLock
                }
                val linkChanged = link != linkActive
                linkActive = link
                running = link
                if (types != promotedTypes) promote(types)
                // As before on every start command; from an in-process re-evaluation only when the link
                // was not already hosted (a foreground return must not re-dial a working link).
                if (link && (fromStartCommand || linkChanged)) runtime.bleClient.connectLastKnown()
                // Package GB: the phone's own step counter listens for as long as this service lives
                // (it logs `noPermission` itself without the grant).
                com.pulseloop.phone.PhoneStepCounter.startIn(this@RingConnectionService)
                // Gauge 2.8.3: Activity Recognition transitions register beside it (evidence only; detection
                // never starts a recording or ring sport mode). Idempotent while registered.
                com.pulseloop.phone.PhoneActivityRecognition.startIn(this@RingConnectionService, "service")
                // Package C: Vitals' command channel polls for as long as this service lives.
                com.pulseloop.command.CommandChannel.startIn(this@RingConnectionService)
                if (linkChanged) publishNotification()
                if (updateJob == null) updateJob = launch { collectNotificationState(runtime) }
            }
        }
    }

    private suspend fun collectNotificationState(runtime: PulseLoopRuntime.RingRuntime) {
        combine(runtime.bleClient.state, PulseLoopDatabase.getInstance(this@RingConnectionService).deviceDao().currentFlow()) { state, device ->
            // Exclude packet diagnostics so routine GATT traffic never wakes SystemUI.
            RingBLEClient.BLEState(connectionState = state.connectionState,
                batteryPercent = state.batteryPercent ?: device?.batteryPercent,
                activeWearableModelID = state.activeWearableModelID ?: device?.wearableModelID) to device?.lastFullSyncAt
        }.distinctUntilChanged().collect { snapshot ->
            pendingNotification = snapshot
            val state = snapshot.first
            val now = android.os.SystemClock.elapsedRealtime()
            if (state.connectionState != lastState || now - lastNotificationAt >= 30_000L) {
                notificationDelay?.cancel(); notificationDelay = null
                publishNotification()
            } else if (notificationDelay == null) {
                // Trailing update only for an actual changed summary, never a polling clock.
                notificationDelay = scope.launch {
                    delay((30_000L - (now - lastNotificationAt)).coerceAtLeast(1))
                    publishNotification()
                    notificationDelay = null
                }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null
    private fun publishNotification() {
        val (state, syncedAt) = pendingNotification
        lastState = state.connectionState
        lastNotificationAt = android.os.SystemClock.elapsedRealtime()
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(this, state, syncedAt, linkActive))
    }
    override fun onTaskRemoved(rootIntent: Intent?) { /* A swipe must not tear down the link. */ }
    override fun onDestroy() {
        running = false
        serviceRunning = false
        if (instance === this) instance = null
        com.pulseloop.phone.PhoneStepCounter.stopIn()
        com.pulseloop.phone.PhoneActivityRecognition.stopIn()
        com.pulseloop.command.CommandChannel.stopIn()
        if (receiverRegistered) unregisterReceiver(systemEvents)
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_ID = "ring_link"
        const val NOTIFICATION_ID = 1002
        const val WORKER_NOTIFICATION_ID = 1003
        const val ACTION_DISCONNECT = "com.pulseloop.DISCONNECT_RING"
        private const val TAG = "RingConnectionService"
        /** The service is up AND hosting the ring link (what BLE code means by "the service runs"). */
        @Volatile var running: Boolean = false
            private set
        /** The service is up at all: the link, the phone counter, or both. */
        @Volatile var serviceRunning: Boolean = false
            private set
        @Volatile var serviceWanted: Boolean = false
            private set
        @Volatile private var instance: RingConnectionService? = null
        private val startScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

        /** The ring link's eligibility only (paired real ring, keep-connected, no user disconnect). */
        suspend fun eligible(context: Context): Boolean = plan(context).link

        /** Link and phone eligibility together ([RingServiceEligibility.plan]). */
        suspend fun plan(context: Context): RingServiceEligibility.Plan {
            // (Vitals 0.7.0) the engine is off while Gauge is installed: nothing to host
            if (!com.pulseloop.GaugeEngine.isActive(context)) return RingServiceEligibility.Plan(link = false, phone = false)
            val keep = context.getSharedPreferences("ring_connection", Context.MODE_PRIVATE)
                .getBoolean("keepConnected", true)
            val stopped = context.getSharedPreferences("ring_ble", Context.MODE_PRIVATE)
                .getBoolean(RingBLEClient.USER_DISCONNECTED_KEY, false)
            return RingServiceEligibility.plan(
                pairedRealRing = PulseLoopDatabase.getInstance(context).deviceDao().currentReal() != null,
                keepConnected = keep,
                userDisconnected = stopped,
                activityRecognition = com.pulseloop.phone.PhoneStepCounter.hasActivityRecognition(context),
                hasStepCounter = hasStepCounter(context),
            )
        }

        fun hasStepCounter(context: Context): Boolean =
            context.getSystemService(android.hardware.SensorManager::class.java)
                ?.getDefaultSensor(android.hardware.Sensor.TYPE_STEP_COUNTER) != null

        /** The runtime grant Android 14 checks for the `connectedDevice` type. */
        fun bluetoothGranted(context: Context): Boolean = Build.VERSION.SDK_INT < 31 ||
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED

        /** Exempt edges are boot/package-replaced, BLE pending scan, or a promoted worker. */
        fun requestStart(context: Context, exempt: Boolean = false) {
            val app = context.applicationContext
            startScope.launch { startIfEligible(app, exempt) }
        }

        suspend fun startIfEligible(context: Context, exempt: Boolean = false): Boolean {
            val plan = plan(context)
            serviceWanted = plan.runService
            if (!serviceWanted) return false
            // Already up (perhaps for the phone alone): let it re-decide whether to host the link.
            instance?.takeIf { serviceRunning }?.let { it.evaluate(withdrawLink = false); return true }
            if (!exempt && !ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return false
            val client = PulseLoopRuntime.ensureRing(context).bleClient
            val linkPossible = plan.link && client.hasPermissions()
            if (!linkPossible && !plan.phone) return false
            if (RingServiceEligibility.foregroundTypes(Build.VERSION.SDK_INT, linkPossible, bluetoothGranted(context),
                    com.pulseloop.phone.PhoneStepCounter.hasActivityRecognition(context)) == null) return false
            return try {
                ContextCompat.startForegroundService(context, Intent(context, RingConnectionService::class.java))
                true
            } catch (e: IllegalStateException) {
                // Background restrictions can change between the eligible edge and this call.
                Log.w(TAG, "Foreground start deferred until the next eligible edge", e)
                false
            } catch (e: SecurityException) {
                Log.w(TAG, "Foreground start deferred until Bluetooth permission is restored", e)
                false
            }
        }

        /**
         * The ring link is no longer wanted (user disconnect, forget, keep-connected off). The service
         * drops it but stays up when the phone counter is eligible on its own; otherwise it stops, as
         * it always did. Not "stop everything": nothing in the app needs that.
         */
        fun stop(context: Context) {
            val service = instance?.takeIf { serviceRunning }
            if (service != null) {
                service.evaluate(withdrawLink = true)
                return
            }
            serviceWanted = false
            context.stopService(Intent(context, RingConnectionService::class.java))
        }

        /**
         * `ACTIVITY_RECOGNITION` was just granted (the companion checklist is the only place that
         * asks). A running service re-enters [onStartCommand], which re-promotes it with the `health`
         * type [foregroundTypes] now allows and restarts the step counter, which had stopped at
         * `noPermission`; both are idempotent, and so is the reconnect there. A service that is not
         * running picks the grant up when it next starts.
         */
        fun onActivityRecognitionGranted(context: Context) {
            if (!serviceRunning) {
                // 2.8.1: the grant alone makes the service eligible (phone counter), ring or not.
                requestStart(context)
                return
            }
            try {
                ContextCompat.startForegroundService(context, Intent(context, RingConnectionService::class.java))
            } catch (e: IllegalStateException) {
                Log.w(TAG, "Step counter start deferred to the next service start", e)
            }
        }

        /**
         * `connectedDevice`, plus `health` on Android 14+ once `ACTIVITY_RECOGNITION` is granted
         * (energy SPEC §GB.1: the phone step counter runs in this service). Android 14 throws from
         * startForeground() for a `health` type without that runtime grant, so it is added only then.
         */
        fun foregroundTypes(context: Context): Int =
            RingServiceEligibility.foregroundTypes(Build.VERSION.SDK_INT, link = true, bluetoothGranted(context),
                com.pulseloop.phone.PhoneStepCounter.hasActivityRecognition(context))
                ?: ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE

        fun foregroundInfo(context: Context): ForegroundInfo = if (Build.VERSION.SDK_INT >= 29)
            ForegroundInfo(WORKER_NOTIFICATION_ID, notification(context), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        else ForegroundInfo(WORKER_NOTIFICATION_ID, notification(context))

        fun notification(
            context: Context,
            state: RingBLEClient.BLEState = RingBLEClient.BLEState(),
            lastSyncAt: Long? = null,
            /** False while the service runs for the phone alone: no ring title, no Disconnect. */
            linkActive: Boolean = true,
        ): Notification {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Ring connection", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Keeps your ring connected and health data up to date"
                setSound(null, null)
                setShowBadge(false)
            })
            val model = WearableModel.model(state.activeWearableModelID)?.displayName ?: "Ring"
            val battery = state.batteryPercent?.let { " · $it%" }.orEmpty()
            val sync = lastSyncAt?.let { " · synced ${java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(it))}" }.orEmpty()
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_gauge)
            if (linkActive) {
                builder.setContentTitle("$model · ${state.connectionState.name.lowercase().replaceFirstChar { it.uppercase() }}")
                    .setContentText("Background connection$battery$sync")
            } else {
                builder.setContentTitle("Vitals · Phone steps")
                    .setContentText("Counting phone steps in the background")
            }
            builder.setOngoing(true).setOnlyAlertOnce(true).setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(PendingIntent.getActivity(context, 102, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                // Headless workout start (energy SPEC §GB.5); pause and finish live on the workout's
                // own notification. Routed through the workout receiver like every other caller.
                .addAction(0, "Start walk", PendingIntent.getBroadcast(context, 104,
                    com.pulseloop.ui.tile.WorkoutControl.intent(context.packageName,
                        com.pulseloop.ui.tile.WorkoutControl.Command.Start(com.pulseloop.ui.tile.WorkoutControl.DEFAULT_TYPE)),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            if (linkActive) builder.addAction(0, "Disconnect", PendingIntent.getService(context, 103,
                Intent(context, RingConnectionService::class.java).setAction(ACTION_DISCONNECT),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            return builder.build()
        }
    }
}
