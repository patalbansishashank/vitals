package com.pulseloop.hub

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * (2.8.7, r069 sync) The upload in this process: a debounced drain on the app's own scope, so readings leave the phone
 * seconds after they are stored while Gauge is alive (its foreground service keeps it so), instead of whenever
 * JobScheduler lets a background job run. Before 2.8.3 the server saw uploads in 30-minute clumps (the next ring sync
 * window), and a request that arrived while a WorkManager drain was running was dropped (`KEEP`).
 *
 * - [request] with a delay keeps an earlier due time (a burst of stored batches is one drain); a shorter delay
 *   (a flush) moves it earlier.
 * - A request while a drain runs is not lost: one more drain follows it ([again]).
 * - [drain] runs one pass (the uploader, under its process-wide lock); its outcome goes to [onResult].
 *
 * Pure (no Android): unit-tested with a test scope and clock.
 */
class HubKicker(
    private val scope: CoroutineScope,
    private val now: () -> Long,
    private val drain: suspend () -> HubDrainResult,
    private val onResult: (HubDrainResult) -> Unit = {},
) {
    private val lock = Any()
    private var job: Job? = null
    private var dueAt = Long.MAX_VALUE
    private var running = false
    private var again = false

    fun request(delayMs: Long) {
        synchronized(lock) {
            if (running) {
                again = true
                return
            }
            val due = now() + delayMs.coerceAtLeast(0)
            if (job?.isActive == true && dueAt <= due) return
            job?.cancel()
            dueAt = due
            job = scope.launch {
                delay(delayMs.coerceAtLeast(0))
                run()
            }
        }
    }

    private suspend fun run() {
        synchronized(lock) {
            running = true
            dueAt = Long.MAX_VALUE
        }
        val result = try {
            drain()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            HubDrainResult.Retry(e.message ?: "upload failed")
        } finally {
            synchronized(lock) { running = false }
        }
        onResult(result)
        val follow = synchronized(lock) { again.also { again = false } }
        // rows stored while this pass ran (or a pass that stopped early) get their own pass
        if (follow || (result is HubDrainResult.Success && result.hasMore)) request(FOLLOW_UP_MS)
    }

    companion object {
        const val FOLLOW_UP_MS = 2_000L
    }
}

/**
 * (2.8.7, r069 sync) How soon a failed upload is tried again. WorkManager's exponential backoff reached hours: after
 * the home server was down or unreachable, Gauge waited 60–200 minutes more before sending (and every new reading's
 * request was kept behind the backed-off job). This doubles from 30 s and stops at 5 minutes; a network that comes
 * back, the app coming to the front or Vitals' flush tries at once.
 */
object HubRetryPolicy {
    const val FIRST_MS = 30_000L
    const val MAX_MS = 5 * 60_000L

    /** The wait after the [failures]-th failure in a row (1 = the first). */
    fun delayMs(failures: Int): Long {
        if (failures <= 1) return FIRST_MS
        val shift = (failures - 1).coerceAtMost(10)
        return (FIRST_MS shl shift).coerceAtMost(MAX_MS)
    }
}
