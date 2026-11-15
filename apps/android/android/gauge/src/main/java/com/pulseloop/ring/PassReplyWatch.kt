package com.pulseloop.ring

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Notices a link that takes writes but never answers.
 *
 * The connection watchdog asks the phone whether the link is up, and a write the phone could not deliver resets the
 * link on its own. Neither sees a ring that acknowledges every write and then says nothing: the link looks healthy,
 * no pass ever brings a reading, and only a fresh connection ends it. So a pass that was asked for and drew no packet
 * at all within [silenceMs] reports the link as silent.
 *
 * One packet of any kind, however late within the window, is proof enough: a slow ring is never reported.
 */
internal class PassReplyWatch(
    private val scope: CoroutineScope,
    private val silenceMs: Long = SILENCE_MS,
    private val onSilent: () -> Unit,
) {
    private val lock = Any()
    private var waiting: Job? = null

    /**
     * A pass is about to be asked of the ring. Called before the request is written, so that no answer can arrive
     * ahead of the wait. A later pass restarts the wait.
     */
    fun passRequested() {
        synchronized(lock) {
            waiting?.cancel()
            val job = scope.launch(start = kotlinx.coroutines.CoroutineStart.LAZY) {
                delay(silenceMs)
                // Checked under the lock: a packet that lands as the wait ends still counts.
                val silent = synchronized(lock) { (waiting === coroutineContext[Job]).also { if (it) waiting = null } }
                if (silent) onSilent()
            }
            waiting = job
            job.start()
        }
    }

    /** The ring sent something (called from the Bluetooth thread). */
    fun packetReceived() = stop()

    /** The pass was not sent after all. */
    fun passNotStarted() = stop()

    /** The link went down, or is being replaced: whatever was asked on it no longer matters. */
    fun linkEnded() = stop()

    private fun stop() {
        synchronized(lock) {
            waiting?.cancel()
            waiting = null
        }
    }

    companion object {
        /** Far longer than a listening ring takes to answer the battery read every pass starts with. */
        const val SILENCE_MS = 20_000L
    }
}
