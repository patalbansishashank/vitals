package com.pulseloop.health.reader

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.pulseloop.data.sources.SourcesDatabase
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex

/**
 * The Health Connect read while Gauge is open (0.6.3 audit S19).
 *
 * Health Connect serves ordinary reads to an app in the foreground; only the 15-minute worker needs
 * `READ_HEALTH_DATA_IN_BACKGROUND`. On a phone whose Health Connect lacks that feature, or where the
 * owner granted only the record types, the worker reads nothing ([HcCapability.readPath]
 * `FOREGROUND_ONLY`), so this reconciles instead: on app open, on every resume, and every
 * [MIN_INTERVAL_MS] while the app stays visible. It runs the same [HealthConnectReader] (same cursor,
 * same outbox), so a later background grant simply carries on from where it stopped.
 *
 * Where the worker can read ([HcReadPath.BACKGROUND]) this does nothing: the two never overlap.
 * A grant made on the companion screen reconciles at once (the readable set changed), otherwise a
 * run waits [MIN_INTERVAL_MS] after the last one, so resuming the app repeatedly does not hammer
 * Health Connect. A run cut short by leaving the app (Health Connect then refuses the read) keeps
 * what was committed; the next visit resumes from the stored cursor.
 */
object HcForegroundReader {
    private const val TAG = "HcForegroundReader"

    /** (P) At most one foreground pass per five minutes, unless the grants changed. */
    const val MIN_INTERVAL_MS = 5 * 60_000L

    data class LastRun(val atMs: Long, val readable: Set<HcType>)

    /** Pure decision: whether a foreground pass should run now. */
    fun shouldRun(
        paired: Boolean,
        capability: HcCapability,
        last: LastRun?,
        nowMs: Long,
        minIntervalMs: Long = MIN_INTERVAL_MS,
    ): Boolean {
        if (!paired) return false
        if (capability.readPath != HcReadPath.FOREGROUND_ONLY) return false
        if (last == null) return true
        if (capability.readable.toSet() != last.readable) return true
        return nowMs - last.atMs >= minIntervalMs || nowMs < last.atMs
    }

    private val running = Mutex()

    @Volatile
    private var last: LastRun? = null

    /** Clears the throttle (tests). */
    internal fun resetForTest() { last = null }

    /**
     * One throttled pass; call only while Gauge is visible. Returns the reader's result, or null
     * when nothing ran (not due, not foreground-only, unpaired, or another pass is in flight).
     */
    suspend fun reconcile(context: Context, nowMs: Long = System.currentTimeMillis()): HealthConnectReader.RunResult? {
        val app = context.applicationContext
        if (!com.pulseloop.hub.HubSync.isPaired(app)) return null
        if (!running.tryLock()) return null
        try {
            val capability = runCatching { HcCapability.probe(app) }.getOrDefault(HcCapability.UNAVAILABLE)
            if (!shouldRun(paired = true, capability = capability, last = last, nowMs = nowMs)) return null
            last = LastRun(nowMs, capability.readable.toSet())
            val reader = HealthConnectReader(
                gateway = HealthConnectReader.ClientGateway(HealthConnectClient.getOrCreate(app)),
                store = HealthConnectReader.DaoStore(SourcesDatabase.getInstance(app).hcDao()),
                nativeOrigins = HcCapability.nativeOrigins(app),
            )
            val result = reader.run(capability, foreground = true)
            if (result.written > 0) com.pulseloop.hub.HubSync.requestUpload(app)
            return result
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "foreground read failed: ${e.message}")
            return null
        } finally {
            running.unlock()
        }
    }

    /**
     * Reconciles on open and on every resume, then every [MIN_INTERVAL_MS] while [owner] stays
     * resumed. Leaving the app cancels the loop, so no read is attempted from the background.
     */
    fun runWhileResumed(owner: LifecycleOwner, context: Context) {
        owner.lifecycleScope.launch {
            owner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                while (true) {
                    reconcile(context)
                    delay(MIN_INTERVAL_MS)
                }
            }
        }
    }
}
