package com.pulseloop.broadcasting

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.pulseloop.data.PulseLoopDatabase
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.StateFlow

/** Process owner for the cached settings and the single held MQTT session. */
object BroadcastOutboxDispatcher {
    private val lock = Any()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile private var store: BroadcastSettingsStore? = null
    @Volatile private var manager: MqttSessionManager? = null

    fun start(context: Context) {
        if (manager != null) return
        synchronized(lock) {
            if (manager != null) return
            val appContext = context.applicationContext
            val settings = BroadcastSettingsStore(appContext)
            val sessionManager = MqttSessionManager(
                scope = scope,
                settingsStore = settings,
                dao = PulseLoopDatabase.getInstance(appContext).broadcastOutboxDao(),
                recoveryScheduler = WorkManagerBroadcastRecoveryScheduler(appContext),
            )
            store = settings
            manager = sessionManager
            sessionManager.registerNetworkCallback(appContext)
            sessionManager.requestFlush()
        }
    }

    fun settingsStore(context: Context): BroadcastSettingsStore {
        start(context)
        return checkNotNull(store)
    }

    fun sessionState(context: Context): StateFlow<BroadcastSessionState> {
        start(context)
        return checkNotNull(manager).state
    }

    fun requestFlush(context: Context) {
        start(context)
        manager?.requestFlush()
    }

    fun onProcessForeground(context: Context) {
        start(context)
        manager?.onProcessForeground()
    }

    fun setRingConnected(context: Context, connected: Boolean) {
        start(context)
        manager?.setRingConnected(connected)
    }
}

private class WorkManagerBroadcastRecoveryScheduler(context: Context) : BroadcastRecoveryScheduler {
    private val appContext = context.applicationContext

    override fun schedule() {
        val request = PeriodicWorkRequestBuilder<BroadcastRecoveryWorker>(15, TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .build()
        WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
            BroadcastRecoveryWorker.UNIQUE_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    override fun cancel() {
        WorkManager.getInstance(appContext).cancelUniqueWork(BroadcastRecoveryWorker.UNIQUE_NAME)
    }
}

/** A non-terminal safety net; network callbacks and live outbox triggers remain the primary path. */
class BroadcastRecoveryWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        if (PulseLoopDatabase.getInstance(applicationContext).broadcastOutboxDao().pendingCount() > 0) {
            BroadcastOutboxDispatcher.requestFlush(applicationContext)
        }
        return Result.success()
    }

    companion object {
        const val UNIQUE_NAME = "pulseloop-mqtt-outbox-recovery"
    }
}
