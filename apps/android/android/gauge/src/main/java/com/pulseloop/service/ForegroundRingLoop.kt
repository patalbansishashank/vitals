package com.pulseloop.service

import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/**
 * What the ring does while the app is on screen: one shallow pass as soon as the app comes to the front, then one
 * every [refreshMs] counted from the end of the last, and a short reconnect wait while the link is down.
 *
 * The pass itself keeps every guard it had ([RingSyncCoordinator.refreshForeground]): it yields to a measurement, a
 * workout and a pass already running, and leaves sleep alone inside the learned window.
 */
internal class ForegroundRingLoop(
    /** The engine is on and the app is still in front; false ends the loop. */
    private val wanted: () -> Boolean,
    /** The person has not disconnected the ring and Bluetooth may be used. */
    private val mayUseRing: () -> Boolean,
    private val connected: () -> Boolean,
    /** A connection attempt (or a scan the person started) is already under way. */
    private val connecting: () -> Boolean,
    /** Dial the saved ring now, with the usual guards. */
    private val reconnect: () -> Unit,
    /** Ask for one shallow pass; false when it must not run now. */
    private val startPass: () -> Boolean,
    private val passRunning: () -> Boolean,
    private val refreshMs: Long = REFRESH_MS,
    private val reconnectMs: Long = RECONNECT_MS,
    private val passTimeoutMs: Long = PASS_TIMEOUT_MS,
) {
    suspend fun run() {
        var linkWasDown = false
        while (wanted()) {
            if (!mayUseRing()) {
                delay(refreshMs)
                continue
            }
            if (!connected()) {
                // Unattended, a failed reconnect backs off to minutes. Someone looking at the app should not wait
                // that long, so the wait starts over while it is in front.
                linkWasDown = true
                delay(reconnectMs)
                if (wanted() && mayUseRing() && !connected() && !connecting()) reconnect()
                continue
            }
            if (linkWasDown) {
                // A new connection reads the ring by itself; the cadence resumes after that pass.
                linkWasDown = false
            } else if (startPass()) {
                // Count from the pass's end, not its start: a slow transfer cannot pile up another request.
                withTimeoutOrNull(passTimeoutMs) { while (passRunning()) delay(PASS_POLL_MS) }
            }
            delay(refreshMs)
        }
    }

    companion object {
        const val REFRESH_MS = 60_000L
        /** About one connection attempt: a failed one is followed by the next almost at once. */
        const val RECONNECT_MS = 30_000L
        const val PASS_TIMEOUT_MS = 120_000L
        private const val PASS_POLL_MS = 500L
    }
}
