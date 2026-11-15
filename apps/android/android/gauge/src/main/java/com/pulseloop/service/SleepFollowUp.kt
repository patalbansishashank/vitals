package com.pulseloop.service

/**
 * When a finished pass is followed by the dedicated sleep read.
 *
 * The read used to follow every pass, which was harmless while passes were minutes apart. With a pass a minute it
 * meant a four-page sleep transfer a minute, and every sleep read closes the ring's open sleep record
 * ([com.pulseloop.ring.RingSleepReadHold]). Sleep changes slowly, so the read now follows the first pass of each
 * connection, any pass the person asked for, and otherwise one pass per [minIntervalMs].
 */
internal class SleepFollowUp(private val minIntervalMs: Long = MIN_INTERVAL_MS) {
    private var lastReadAt: Long? = null

    /** A new connection: its first pass is followed by a read whatever came before. */
    fun connected() { lastReadAt = null }

    fun due(nowMs: Long, requested: Boolean): Boolean {
        val last = lastReadAt ?: return true
        return requested || nowMs - last >= minIntervalMs
    }

    /** The read was really sent (a held read is not one: the next pass tries again). */
    fun read(nowMs: Long) { lastReadAt = nowMs }

    /**
     * A pass just ended. When the read is due, [send] asks for it (false: nothing was asked of the ring), and it
     * counts as read unless the engine [held] it back.
     */
    fun afterPass(nowMs: Long, requested: Boolean, send: () -> Boolean, held: () -> Boolean) {
        if (due(nowMs, requested) && send() && !held()) read(nowMs)
    }

    companion object {
        const val MIN_INTERVAL_MS = 30 * 60_000L
    }
}
