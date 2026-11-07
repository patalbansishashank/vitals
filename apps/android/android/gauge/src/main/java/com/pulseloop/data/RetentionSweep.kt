package com.pulseloop.data

import android.content.Context
import androidx.room.withTransaction
import androidx.work.*
import com.pulseloop.settings.ApiKeyStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.TimeUnit

object RawPacketRetention {
    const val KEEP_ROWS = 5_000
    const val WINDOW_MS = 24 * 60 * 60_000L
    const val PRUNE_EVERY = 500
    fun fullCaptureActive(startedAt: Long, now: Long): Boolean =
        startedAt > 0 && now >= startedAt && now - startedAt < WINDOW_MS
}

/** Only telemetry and receipts belong here. Real health history and deletion tombstones never do. */
object RetentionSweep {
    const val DAY_MS = 24 * 60 * 60_000L
    // Explicit owner default: retain workout sensor details. Enable only after that choice changes.
    const val PRUNE_FINISHED_WORKOUT_POLLS = false
    data class Policy(val table: String, val sql: String, val cutoff: Long)

    internal fun sensorPollPolicy(now: Long) = Policy("activity_sensor_polls",
        "DELETE FROM activity_sensor_polls WHERE sessionId IN " +
            "(SELECT id FROM activity_sessions WHERE statusRaw = 'finished' AND endedAt < ?)",
        now - 90 * DAY_MS)

    fun policies(now: Long, fullCapture: Boolean): List<Policy> = buildList {
        if (!fullCapture) add(Policy("raw_packets", "DELETE FROM raw_packets WHERE id NOT IN (SELECT id FROM raw_packets ORDER BY timestamp DESC, id DESC LIMIT ${RawPacketRetention.KEEP_ROWS}) AND timestamp < ?", now - DAY_MS))
        add(Policy("broadcast_outbox", "DELETE FROM broadcast_outbox WHERE (publishedAt IS NOT NULL AND publishedAt < ?) OR (publishedAt IS NULL AND createdAt < ?)", now - 30 * DAY_MS))
        // Hub receipts only. A row the server has not acknowledged is the durable sync path, so it
        // is never aged out here (Unpair is what drops the queue).
        add(Policy("hub_outbox", "DELETE FROM hub_outbox WHERE uploadedAt IS NOT NULL AND uploadedAt < ?", now - 30 * DAY_MS))
        // The schema calls the insight key `kind` and the scope `entityId`. Keep the newest
        // row for every scope even when it is older than the normal diagnostic horizon.
        add(Policy("derived_updates", "DELETE FROM derived_updates WHERE timestamp < ? AND EXISTS (SELECT 1 FROM derived_updates newer WHERE newer.kind = derived_updates.kind AND newer.entityId = derived_updates.entityId AND (newer.timestamp > derived_updates.timestamp OR (newer.timestamp = derived_updates.timestamp AND newer.rowid > derived_updates.rowid)))", now - 400 * DAY_MS))
        add(Policy("battery_samples", "DELETE FROM battery_samples WHERE timestamp < ?", now - 180 * DAY_MS))
        add(Policy("wearable_logs", "DELETE FROM wearable_logs WHERE timestamp < ?", now - 30 * DAY_MS))
        if (PRUNE_FINISHED_WORKOUT_POLLS) add(sensorPollPolicy(now))
    }

    suspend fun run(db: PulseLoopDatabase, now: Long, fullCapture: Boolean = false) {
        for (policy in policies(now, fullCapture)) db.withTransaction {
            val args = if (policy.table == "broadcast_outbox") arrayOf<Any>(policy.cutoff, policy.cutoff) else arrayOf<Any>(policy.cutoff)
            db.openHelper.writableDatabase.execSQL(policy.sql, args)
        }
    }
}

class RetentionWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        sweepIfDue(applicationContext, PulseLoopDatabase.getInstance(applicationContext))
        reclaimFreePages(PulseLoopDatabase.getInstance(applicationContext))
        Result.success()
    } catch (e: Exception) {
        if (e is kotlinx.coroutines.CancellationException) throw e
        Result.retry()
    }

    companion object {
        private val mutex = Mutex()
        /** VACUUM cannot run in a Room migration transaction. Reclaim migration/prune space
         * only in this idle, battery-not-low worker; startup never blocks on a file rewrite. */
        internal suspend fun reclaimFreePages(db: PulseLoopDatabase) = mutex.withLock {
            val sql = db.openHelper.writableDatabase
            fun pragma(name: String) = sql.query("PRAGMA $name").use { it.moveToFirst(); it.getLong(0) }
            val pages = pragma("page_count")
            if (pages >= 1024 && pragma("freelist_count") > pages / 4) sql.execSQL("VACUUM")
        }
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("telemetry-retention", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<RetentionWorker>(24, TimeUnit.HOURS)
                    .setConstraints(Constraints.Builder().setRequiresDeviceIdle(true).setRequiresBatteryNotLow(true).build()).build())
        }

        suspend fun sweepIfDue(context: Context, db: PulseLoopDatabase) = mutex.withLock {
            val prefs = context.getSharedPreferences("telemetry-retention", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            val last = prefs.getLong("lastSweep", 0)
            if (last == 0L || now < last || now - last >= RetentionSweep.DAY_MS) {
                RetentionSweep.run(db, now, ApiKeyStore(context).rawPacketFullCapture)
                prefs.edit().putLong("lastSweep", now).apply()
            }
        }
    }
}
