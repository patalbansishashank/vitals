package desi.creative.vitals

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock

/**
 * Reading the ring with the screen off. Measured on the owner's phone (Android 16): with the screen off the process,
 * RingLinkService and the WebView's renderer stay at foreground-service priority (not cached, not frozen) and the
 * Bluetooth link holds, but the CPU sleeps, and the WebView's timers count only the time the CPU is awake, so the ring
 * service's own sync timer never comes due. So, while the service runs: an alarm that may fire in idle wakes the
 * phone every [everyMs], takes a partial wake lock and sends `ringTick` to the web layer, which reads the ring and lets
 * sync upload, then calls `ringTickDone`. The lock goes then, or after [HOLD_MAX_MS] at the latest.
 *
 * Exact when Android allows it without asking the person (below Android 12), else inexact: Android may move a tick
 * later (and in deep idle spaces them out), never earlier.
 */
object RingTick {
    const val DEFAULT_EVERY_MS = 30 * 60_000L
    const val MIN_EVERY_MS = 60_000L
    const val HOLD_MAX_MS = 3 * 60_000L
    private const val WAKE_TAG = "vitals:ring-read"

    @Volatile var everyMs: Long = DEFAULT_EVERY_MS
        private set

    /** Diagnostics for getState(): ticks fired since the process started and the wall time of the last one. */
    @Volatile var count: Int = 0
        private set
    @Volatile var lastAt: Long = 0L
        private set

    private val lock = Any()
    private var wakeLock: PowerManager.WakeLock? = null

    /** Clamps to [MIN_EVERY_MS]; reschedules when the service runs. */
    fun setEvery(context: Context, ms: Long) {
        everyMs = ms.coerceAtLeast(MIN_EVERY_MS)
        if (ShellState.keepAliveOn) schedule(context)
    }

    private fun pending(context: Context): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, RingTickReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /** The next tick, [everyMs] from now (replaces a pending one). */
    fun schedule(context: Context) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val at = SystemClock.elapsedRealtime() + everyMs
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        try {
            if (exact) {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(context))
            } else {
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(context))
            }
        } catch (_: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(context))
        }
    }

    fun cancel(context: Context) {
        context.getSystemService(AlarmManager::class.java)?.cancel(pending(context))
        done()
    }

    /** The alarm fired: hold the CPU, plan the next tick, wake the web layer. */
    fun fire(context: Context) {
        if (!ShellState.keepAliveOn) return
        schedule(context)
        val plugin = ShellState.plugin ?: return
        synchronized(lock) {
            if (wakeLock?.isHeld != true) {
                val pm = context.getSystemService(PowerManager::class.java) ?: return
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_TAG).apply {
                    setReferenceCounted(false)
                    acquire(HOLD_MAX_MS)
                }
            }
        }
        count += 1
        lastAt = System.currentTimeMillis()
        plugin.fireRingTick(lastAt)
    }

    /** The web layer is done with this tick (or the service stopped): let the CPU sleep. */
    fun done() {
        synchronized(lock) {
            wakeLock?.let { if (it.isHeld) it.release() }
            wakeLock = null
        }
    }
}

/** The alarm's receiver (not exported: only this app's own PendingIntent reaches it). */
class RingTickReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        RingTick.fire(context.applicationContext)
    }
}
