package com.pulseloop.service

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import com.pulseloop.command.WakeHold
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/**
 * What the ring does while [RingConnectionService] holds the link and nobody is looking: one shallow pass every
 * [intervalMs]. Without it the held link carried new readings only when the 15-minute job ran, and Android defers
 * that job freely.
 *
 * The pass is the foreground one ([RingSyncCoordinator.refreshForeground]) with its guards; [mayRun] adds what only
 * background work needs. The CPU is held awake for the pass alone, never for the wait between passes.
 *
 * The wait is measured on [clock], which goes on while the phone sleeps. [delay] does not: in a pocket with the
 * screen off, five minutes of it can take most of an hour. So the loop asks to be woken when the pass is due
 * ([wakeAt], answered with [nudge]) and, in case that comes late, looks at the clock every [SLICE_MS] it is awake.
 */
internal class BackgroundRingLoop(
    private val mayRun: () -> Boolean,
    /** Ask for one shallow pass; false when it must not run now. */
    private val startPass: () -> Boolean,
    private val passRunning: () -> Boolean,
    private val wake: WakeHold,
    /** Milliseconds that also count while the phone sleeps (elapsed realtime). */
    private val clock: () -> Long,
    /** Ask for a [nudge] at this [clock] time. Best effort: the loop does not depend on it. */
    private val wakeAt: (Long) -> Unit = {},
    private val intervalMs: Long = INTERVAL_MS,
    private val passTimeoutMs: Long = PASS_TIMEOUT_MS,
) {
    private val nudges = Channel<Unit>(Channel.CONFLATED)

    /** The phone is awake now (the alarm asked for with [wakeAt], or the screen came on): look at the clock. */
    fun nudge() { nudges.trySend(Unit) }

    suspend fun run() {
        while (true) {
            waitUntil(clock() + intervalMs)
            if (!mayRun()) continue
            // The hold ends by itself if this coroutine is cancelled before the release below.
            val held = wake.acquire(passTimeoutMs + SETTLE_MS + WAKE_SLACK_MS)
            try {
                if (startPass()) {
                    withTimeoutOrNull(passTimeoutMs) { while (passRunning()) delay(PASS_POLL_MS) }
                    // The last rows reach storage and the upload leaves before the phone may sleep again.
                    delay(SETTLE_MS)
                }
            } finally {
                held.release()
            }
        }
    }

    private suspend fun waitUntil(due: Long) {
        wakeAt(due)
        while (true) {
            val left = due - clock()
            if (left <= 0) return
            withTimeoutOrNull(minOf(left, SLICE_MS)) { nudges.receive() }
        }
    }

    companion object {
        const val INTERVAL_MS = 5 * 60_000L
        /** A shallow pass takes 10 to 40 seconds. */
        const val PASS_TIMEOUT_MS = 60_000L
        const val SETTLE_MS = 5_000L
        /** How much awake time a pass that is due needs before it starts when no [nudge] comes. */
        const val SLICE_MS = 30_000L
        private const val WAKE_SLACK_MS = 5_000L
        private const val PASS_POLL_MS = 500L
    }
}

/**
 * Wakes the phone when a background pass is due. One inexact alarm with an in-process listener: it needs no
 * permission and no receiver, and it ends with the process. Android may deliver it some minutes late, and holds it
 * back altogether while the phone is in deep sleep (Doze); the 15-minute job has the same limit.
 */
internal class BackgroundPassAlarm(
    context: Context,
    /** Covers the step from the alarm to the pass's own hold: Android keeps the phone awake only until the listener returns. */
    private val handover: WakeHold,
    private val onWake: () -> Unit,
) {
    private val alarms = context.applicationContext.getSystemService(AlarmManager::class.java)
    private val listener = AlarmManager.OnAlarmListener {
        handover.acquire(HANDOVER_MS)
        onWake()
    }

    /** Wake at [atElapsedMs] (elapsed realtime). A new request replaces the one before. */
    fun arm(atElapsedMs: Long) {
        runCatching { alarms?.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, atElapsedMs, TAG, listener, null) }
    }

    fun cancel() {
        runCatching { alarms?.cancel(listener) }
    }

    private companion object {
        const val TAG = "Gauge:pass"
        const val HANDOVER_MS = 2_000L
    }
}

/** Background ring work is skipped on a phone that is low and not charging. */
internal object PhoneBattery {
    private const val LOW_PERCENT = 15

    fun isLow(level: Int, scale: Int, plugged: Int): Boolean =
        plugged == 0 && level * 100 / scale.coerceAtLeast(1) <= LOW_PERCENT

    fun isLow(context: Context): Boolean {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        return isLow(
            level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, 100) ?: 100,
            scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100,
            plugged = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0,
        )
    }
}
