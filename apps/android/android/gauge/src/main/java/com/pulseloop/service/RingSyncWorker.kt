package com.pulseloop.service

import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.*
import com.pulseloop.PulseLoopRuntime
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.health.HealthConnectExportWorker
import com.pulseloop.ring.RingConnectionState
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.filterIsInstance
import com.pulseloop.ring.PulseEventBus
import com.pulseloop.ring.PulseEvent
import java.util.concurrent.TimeUnit

/** Periodic shallow history refresh on the shared runtime, with a bounded connect fallback. */
class RingSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    companion object {
        private const val WORK_NAME = "ring_background_sync"
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                PeriodicWorkRequestBuilder<RingSyncWorker>(15, TimeUnit.MINUTES, 5, TimeUnit.MINUTES)
                    // Battery is checked at execution, so charging can still use the short cadence.
                    .setConstraints(Constraints.Builder().build())
                    .build())
        }
        fun cancel(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME) }
    }

    override suspend fun doWork(): Result {
        // (Vitals 0.7.0) nothing runs while Gauge is installed or before Vitals has taken over
        if (!com.pulseloop.GaugeEngine.isActive(applicationContext)) return Result.success()
        val db = PulseLoopDatabase.getInstance(applicationContext)
        if (db.deviceDao().currentReal() == null) return Result.success()
        val runtime = PulseLoopRuntime.ensureRing(applicationContext)
        val client = runtime.bleClient
        if (!client.hasPermissions()) return Result.success()
        val userStopped = applicationContext.getSharedPreferences("ring_ble", Context.MODE_PRIVATE)
            .getBoolean(com.pulseloop.ring.RingBLEClient.USER_DISCONNECTED_KEY, false)
        if (userStopped) return Result.success()
        val alreadyConnected = client.state.value.connectionState == RingConnectionState.CONNECTED
        val battery = applicationContext.registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, 100) ?: 100
        val scale = battery?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100) ?: 100
        val charging = (battery?.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0
        val role = RingSyncWorkerRole.select(alreadyConnected, !charging && level * 100 / scale.coerceAtLeast(1) <= 15, userStopped)
        if (role == RingSyncWorkerRole.Role.SKIP) return Result.success()
        if (!runtime.apiKeyStore.keepConnected && isAppForeground()) return Result.success()
        return try {
            if (!RingConnectionService.running) setForeground(RingConnectionService.foregroundInfo(applicationContext))
            withContext(Dispatchers.Main.immediate) {
                if (runtime.apiKeyStore.keepConnected) RingConnectionService.startIfEligible(applicationContext, exempt = true)
                if (role == RingSyncWorkerRole.Role.LIVE_PASS) {
                    // An unattended pass never enters the manual deep cursor planner. The
                    // coordinator also refuses overlap with history, workouts and measurements.
                    if (runtime.coordinator.refreshForeground()) {
                        withTimeoutOrNull(120_000) {
                            while (client.syncEngine?.isHistorySyncRunning == true) delay(500)
                        }
                        delay(2_000) // let the last decoded rows reach Room and the upload outbox
                        HealthConnectExportWorker.enqueue(applicationContext)
                    }
                    return@withContext
                }
                withTimeoutOrNull(45_000) {
                    val done = async(start = CoroutineStart.UNDISPATCHED) {
                        PulseEventBus.dataEvents.filterIsInstance<PulseEvent.SyncProgress>().first { it.stage == "done" }
                    }
                    RingSyncWorkerRole.dispatch(role, {}, client::connectLastKnown)
                    client.state.first { it.connectionState == RingConnectionState.CONNECTED }
                    // The runtime callback owns startup and settings; never replace it here.
                    done.await()
                    delay(2_000)
                    HealthConnectExportWorker.enqueue(applicationContext)
                }
            }
            Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Result.retry()
        } finally {
            withContext(NonCancellable + Dispatchers.Main.immediate) {
                if (role == RingSyncWorkerRole.Role.CONNECT && !runtime.apiKeyStore.keepConnected && !isAppForeground() &&
                    runtime.liveWorkout.state.value.activeSession == null) client.disconnect()
            }
        }
    }

    private suspend fun isAppForeground(): Boolean = withContext(Dispatchers.Main.immediate) {
        ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    }
}
