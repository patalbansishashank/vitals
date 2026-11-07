package com.pulseloop.command

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.pulseloop.hub.HubSync
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The safety net after a process death (energy SPEC §A.4 item 8): every 15 min, on any network, one `wait=0` poll and
 * the work it returns. Nothing to do while the always-on loop runs in this process and answers, or while unpaired.
 * (2.8.4, r068 B2) A loop that runs but has had no poll answer for [CommandChannel.STALE_MS] is stuck: it is restarted.
 */
class CommandPollWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        // (Vitals 0.7.0) nothing runs while Gauge is installed or before Vitals has taken over
        if (!com.pulseloop.GaugeEngine.isActive(applicationContext)) return Result.success()
        if (CommandChannel.isRunning) {
            if (CommandChannel.isStale()) {
                Log.i("CommandPollWorker", "command loop stuck: restarting it")
                CommandChannel.restart(applicationContext)
            }
            return Result.success()
        }
        val app = applicationContext
        val pairing = HubSync.store(app).pairing.value?.takeUnless { it.needsRepair } ?: return Result.success()
        withTimeoutOrNull(MAX_RUN_MS) { CommandChannel.loop(app).run(pairing, once = true) }
        return Result.success()
    }

    companion object {
        private const val UNIQUE = "gauge-command-poll"
        private const val MAX_RUN_MS = 5 * 60_000L

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CommandPollWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(UNIQUE, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
