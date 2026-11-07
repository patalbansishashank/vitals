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
 * - Batches up to the server's `maxBatch` events and `maxBytes` decompressed bytes, oldest first.
 * - 413 halves the batch for the rest of the drain; a single event the server still refuses, or
 *   one larger than `maxBytes` on its own, is marked rejected so it cannot wedge the queue.
 * - 401 flags the pairing for re-pair and stops. 429/503 record Retry-After and stop. Anything
 *   else stops for a WorkManager exponential-backoff retry.
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
        var batchLimit = pairing.maxBatch.coerceIn(1, MAX_BATCH_CAP)
        val maxBytes = pairing.maxBytes.coerceAtLeast(MIN_BYTES)
        var uploaded = 0

        while (elapsedNow() - startedAt < maxDrainMillis) {
            beforeBatch()
            val pending = dao.pending(batchLimit)
            if (pending.isEmpty()) {
                return if (uploaded == 0) HubDrainResult.Empty else HubDrainResult.Success(uploaded)
            }
            val batch = packByBytes(installationId, pending, maxBytes)
            if (batch.isEmpty()) {
                // The oldest event alone is larger than the server will ever take.
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
                    return HubDrainResult.Retry(response.error, uploaded)
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
