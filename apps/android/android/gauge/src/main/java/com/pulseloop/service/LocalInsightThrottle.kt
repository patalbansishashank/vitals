package com.pulseloop.service

import kotlinx.coroutines.*

/** Leading run plus one trailing run; all requests merge their changed input sets. */
internal class LocalInsightThrottle(
    private val scope: CoroutineScope,
    private val now: () -> Long = { android.os.SystemClock.elapsedRealtime() },
    private val run: suspend (Set<String>) -> Unit,
) {
    private var lastRun: Long? = null
    private var lastDone: Long? = null
    private var pending = mutableSetOf<String>()
    private var pendingIncludesDone = false
    private var runningDone = false
    private var scheduled: Job? = null

    @Synchronized fun request(done: Boolean, inputs: Set<String>) {
        val at = now()
        if (!done && (runningDone || lastDone?.let { at - it < 5 * 60_000 } == true)) return
        if (inputs.isEmpty() && pending.isEmpty()) return
        if (done && inputs.isNotEmpty()) pendingIncludesDone = true
        pending += inputs
        if (scheduled?.isActive == true) return
        val wait = lastRun?.let { (it + 60_000 - at).coerceAtLeast(0) } ?: 0
        scheduled = scope.launch {
            delay(wait)
            val (changed, includesDone) = synchronized(this@LocalInsightThrottle) {
                val snapshot = pending.toSet()
                val doneSnapshot = pendingIncludesDone
                pending.clear()
                pendingIncludesDone = false
                runningDone = doneSnapshot
                lastRun = now()
                snapshot to doneSnapshot
            }
            try {
                run(changed)
                if (includesDone) synchronized(this@LocalInsightThrottle) { lastDone = now() }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                // The subscriber has already handed ownership of these inputs to the throttle.
                // Preserve them for the trailing retry rather than waiting for another ring sync.
                synchronized(this@LocalInsightThrottle) {
                    pending += changed
                    pendingIncludesDone = pendingIncludesDone || includesDone
                }
                android.util.Log.e("LocalInsight", "Recompute failed; retaining inputs", e)
            } finally {
                synchronized(this@LocalInsightThrottle) {
                    runningDone = false
                    scheduled = null
                    if (pending.isNotEmpty()) request(true, emptySet())
                }
            }
        }
    }

    @Synchronized fun stop() {
        scheduled?.cancel()
        scheduled = null
        pending.clear()
        pendingIncludesDone = false
        runningDone = false
    }
}
