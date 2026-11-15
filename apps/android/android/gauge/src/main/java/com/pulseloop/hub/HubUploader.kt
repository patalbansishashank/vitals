package com.pulseloop.hub

import com.pulseloop.data.dao.HubOutboxDao
import com.pulseloop.data.entity.HubOutboxEntity
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

sealed interface HubDrainResult {
    data object NotPaired : HubDrainResult
    /** The server answered 401. Nothing more is sent until the owner pairs again. */
    data object NeedsRepair : HubDrainResult
    data object Empty : HubDrainResult
    data class Success(val uploaded: Int, val hasMore: Boolean = false) : HubDrainResult
    /** 429 / 503: try again no earlier than [delayMs] from now. */
    data class RetryAfter(val delayMs: Long, val uploaded: Int = 0) : HubDrainResult
    /** Anything else: retry with exponential backoff. */
    data class Retry(val error: String, val uploaded: Int = 0) : HubDrainResult
}

/**
 * Drains the hub outbox to `POST /v1/lumen/events` (contract §2).
 *
 * - Batches up to the server's `maxBatch` events and `maxBytes` decompressed bytes, oldest first. Rows that
 *   have failed [STUCK_ATTEMPTS] times wait until the others have gone, so nothing queues up behind them.
 * - 413 halves the batch for the rest of the drain; a single event the server still refuses, or
 *   one larger than `maxBytes` on its own, is marked rejected so it cannot wedge the queue.
 * - 401 flags the pairing for re-pair and stops. 429/503 record Retry-After and stop. Anything
 *   else stops for a WorkManager exponential-backoff retry.
 * - A row the server keeps answering with a server error is found and left out of this drain's later
 *   batches, so the others still go up. It stays queued and is tried again in later drains, the least
 *   tried first: a server error is never taken as a verdict on the row.
 * - Idempotent by event id: a row is only marked done after a 200, and the server counts a
 *   re-sent id as a duplicate, so a lost response just re-sends the same ids.
 */
class HubUploader(
    private val dao: HubOutboxDao,
    private val settings: HubSettingsSource,
    private val api: HubApi,
    private val now: () -> Long = System::currentTimeMillis,
    private val elapsedNow: () -> Long = { System.nanoTime() / 1_000_000L },
    /** Production: the throttled first-pair backfill, which tops the outbox up between batches. */
    private val beforeBatch: suspend () -> Unit = {},
    private val maxDrainMillis: Long = 8 * 60_000L,
) {
    suspend fun drain(): HubDrainResult = drainLock.withLock { drainLocked() }

    private suspend fun drainLocked(): HubDrainResult {
        val pairing = settings.pairing.value ?: return HubDrainResult.NotPaired
        if (pairing.needsRepair) return HubDrainResult.NeedsRepair
        val notBefore = settings.status.value.notBefore
        if (notBefore > now()) return HubDrainResult.RetryAfter(notBefore - now())

        val installationId = settings.installationId
        val startedAt = elapsedNow()
        val fullBatch = pairing.maxBatch.coerceIn(1, MAX_BATCH_CAP)
        var batchLimit = fullBatch
        val maxBytes = pairing.maxBytes.coerceAtLeast(MIN_BYTES)
        var uploaded = 0
        // Rows the server refused on their own in this drain (event id to its error), left out of later batches.
        val setAside = linkedMapOf<String, String>()
        // The server took one of the rows that had kept failing, so a refusal after it is about the rows sent, not
        // the server.
        var accepting = false
        // Rows refused on their own since the server last took one of the rows that had kept failing.
        var refusedInARow = 0

        while (elapsedNow() - startedAt < maxDrainMillis) {
            beforeBatch()
            val fresh = dao.pendingFresh(STUCK_ATTEMPTS, batchLimit)
            val stuck = fresh.isEmpty()
            val pending = if (!stuck) fresh else
                dao.pendingStuck(STUCK_ATTEMPTS, batchLimit + setAside.size).filterNot { it.eventId in setAside }.take(batchLimit)
            if (pending.isEmpty()) {
                val refusal = setAside.values.lastOrNull()
                if (refusal != null) {
                    // The rows behind went up, which cleared the error; the queue is still not empty.
                    settings.recordError(refusal, now())
                    return HubDrainResult.Retry(refusal, uploaded)
                }
                return if (uploaded == 0) HubDrainResult.Empty else HubDrainResult.Success(uploaded)
            }
            // These rows have failed drain after drain. One goes alone until the server takes it: if a row is the
            // cause, the others are not sent into the same refusal again, and if the server is down, the cost is a
            // few one-row requests.
            val batch = packByBytes(installationId, if (stuck && !accepting) pending.take(1) else pending, maxBytes)
            if (batch.isEmpty()) {
                // This event alone is larger than the server will ever take.
                dao.markRejected(listOf(pending.first().eventId), now(), "Larger than the server's maxBytes")
                settings.recordSuccess(0, 0, 1, now())
                continue
            }

            when (val response = api.uploadEvents(pairing.serverUrl, pairing.token, installationId, batch.map { it.payloadJson })) {
                is HubUploadResponse.Ok -> {
                    val at = now()
                    val rejected = resolveRejections(batch, response.rejected)
                    val done = batch.map { it.eventId }.filterNot { it in rejected }
                    if (done.isNotEmpty()) dao.markUploaded(done, at)
                    for ((reason, group) in rejected.entries.groupBy({ it.value.take(200) }, { it.key })) {
                        dao.markRejected(group, at, reason)
                    }
                    settings.recordSuccess(response.accepted, response.duplicates, rejected.size, at)
                    uploaded += batch.size
                    if (stuck) {
                        accepting = true
                        refusedInARow = 0
                    }
                }
                HubUploadResponse.TooLarge -> {
                    if (batch.size == 1) {
                        dao.markRejected(listOf(batch.single().eventId), now(), "Server refused the event as too large (413)")
                        settings.recordSuccess(0, 0, 1, now())
                    } else {
                        batchLimit = (batch.size / 2).coerceAtLeast(1)
                    }
                }
                HubUploadResponse.Unauthorized -> {
                    dao.markFailed(batch.map { it.eventId }, now(), "401 Unauthorized")
                    settings.markNeedsRepair(now())
                    return HubDrainResult.NeedsRepair
                }
                is HubUploadResponse.Throttled -> {
                    val delay = (response.retryAfterMs ?: DEFAULT_THROTTLE_MS).coerceIn(MIN_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS)
                    val at = now()
                    dao.markFailed(batch.map { it.eventId }, at, "HTTP ${response.status}")
                    settings.setNotBefore(at + delay)
                    settings.recordError("Server busy (HTTP ${response.status}); retrying in ${delay / 1000}s", at)
                    return HubDrainResult.RetryAfter(delay, uploaded)
                }
                is HubUploadResponse.Failed -> {
                    val at = now()
                    dao.markFailed(batch.map { it.eventId }, at, response.error)
                    settings.recordError(response.error, at)
                    val serverError = response.status != null && response.status in 500..599
                    if (!serverError || !stuck) return HubDrainResult.Retry(response.error, uploaded)
                    if (batch.size > 1) {
                        // Reached only once the server has taken one of these rows in this drain: the cause is in
                        // this batch.
                        batchLimit = batch.size / 2
                    } else {
                        if (refusedInARow >= MAX_SET_ASIDE) return HubDrainResult.Retry(response.error, uploaded)
                        setAside[batch.single().eventId] = response.error
                        refusedInARow++
                        batchLimit = fullBatch
                    }
                }
            }
        }
        return HubDrainResult.Success(uploaded, hasMore = dao.pendingCount() > 0)
    }

    companion object {
        /** The contract's advertised default; a server may lower it, never raise it past this. */
        const val MAX_BATCH_CAP = 500
        private const val MIN_BYTES = 4_096L
        private const val DEFAULT_THROTTLE_MS = 60_000L
        private const val MIN_RETRY_AFTER_MS = 1_000L
        private const val MAX_RETRY_AFTER_MS = 6 * 60 * 60_000L
        /**
         * Failed attempts after which the oldest row of a batch counts as stuck. A server that is restarting fails a
         * few drains in a row and then recovers; only past that does the uploader look for a row to leave out.
         */
        const val STUCK_ATTEMPTS = 5
        /**
         * Rows refused one after another, with nothing taken in between, before a drain stops. A server that refuses
         * everything costs one more one-row request than this; rows refused here and there among ones the server
         * takes are all left out, however many they are.
         */
        const val MAX_SET_ASIDE = 3

        /** One drain per process: a periodic run and an immediate one must not send twice at once. */
        private val drainLock = Mutex()

        /**
         * The batch's event ids the server rejected, with the reason. A rejection is matched by its id
         * when that id is in the batch, else by its index (the server reports a malformed event
         * without a readable id by position only). Anything matching neither is ignored.
         */
        internal fun resolveRejections(batch: List<HubOutboxEntity>, rejections: List<HubRejection>): Map<String, String> {
            val ids = batch.map { it.eventId }.toSet()
            val out = linkedMapOf<String, String>()
            for (r in rejections) {
                val id = r.id?.takeIf { it in ids } ?: r.index?.let { batch.getOrNull(it)?.eventId } ?: continue
                out.putIfAbsent(id, r.reason)
            }
            return out
        }

        /** The longest oldest-first prefix whose request body stays within [maxBytes]. */
        internal fun packByBytes(
            installationId: String,
            rows: List<HubOutboxEntity>,
            maxBytes: Long,
        ): List<HubOutboxEntity> {
            var total = OkHttpHubApi.eventsBodySize(installationId, emptyList())
            val out = mutableListOf<HubOutboxEntity>()
            for (row in rows) {
                val next = total + row.payloadJson.toByteArray(Charsets.UTF_8).size + if (out.isEmpty()) 0 else 1
                if (next > maxBytes) break
                total = next
                out += row
            }
            return out
        }
    }
}
