package com.pulseloop.hub

import androidx.room.withTransaction
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.HubPendingDeletionEntity
import java.time.Instant

/**
 * Turns [HubPendingDeletionEntity] rows into queued `com.pulseloop.deletion.v1` events. Runs from the
 * uploader (so only while paired, with the installation id at hand).
 *
 * Every hub deletion of stored ring history goes through here — the v33 clock-duplicate migration's
 * and the ones a sync queues when it drops a stale copy ([record]) — so that two rules hold for all
 * of them (0.6.3, after the 2.8.0 upgrade sent 16,498 per-sample deletions at once):
 *
 * - **Coalesced**: targets of one (category, kind) become one range wherever no stored row that
 *   must stay lies between them ([HubDeletionCoalescer]).
 * - **Budgeted**: at most [MAX_EVENTS_PER_HOUR] deletion events are queued or uploaded per rolling
 *   hour; the rest stay pending, in order, for later batches. A deletion is never dropped, only paced.
 *
 * Rows are consumed in one transaction with the events they become, so a row is either still pending
 * or queued.
 */
object HubPendingDeletions {
    /** Deletion events per rolling hour, counting those still waiting in the outbox. */
    const val MAX_EVENTS_PER_HOUR = 200
    private const val HOUR_MS = 3_600_000L

    /** Queue server deletions for stored rows removed now; turned into events by [drain]. */
    suspend fun record(db: PulseLoopDatabase, targets: List<Triple<String, String?, Long>>, now: Long = System.currentTimeMillis()): Int {
        if (targets.isEmpty()) return 0
        db.hubPendingDeletionDao().add(targets.distinct().map { (category, kind, at) ->
            HubPendingDeletionEntity(category = category, kind = kind, fromMs = at, toMs = at, createdAt = now)
        })
        return targets.size
    }

    /** Returns the number of pending rows consumed (each now covered by a queued deletion event). */
    suspend fun drain(db: PulseLoopDatabase, installationId: String, now: Instant = Instant.now()): Int =
        db.withTransaction {
            val pending = db.hubPendingDeletionDao()
            val rows = pending.all()
            if (rows.isEmpty()) return@withTransaction 0
            val budget = MAX_EVENTS_PER_HOUR - pending.recentDeletionEvents(now.toEpochMilli() - HOUR_MS)
            if (budget <= 0) return@withTransaction 0
            val ranges = HubDeletionCoalescer.coalesce(
                rows.map { HubDeletionCoalescer.Target(it.id, it.category, it.kind, it.fromMs, it.toMs) },
                survivors(db),
            ).take(budget)
            if (ranges.isEmpty()) return@withTransaction 0
            db.hubOutboxDao().enqueueAll(ranges.map {
                HubEventMapper.exactDeletion(it.category, it.kind, it.fromMs, it.toMs, installationId, now)
            })
            val consumed = ranges.flatMap { it.ids }
            consumed.chunked(500).forEach { pending.remove(it) }
            consumed.size
        }

    /**
     * Stored rows per upload category: measurements by [HubEventMapper.categoriesFor], activity
     * buckets, and sleep blocks (each uploaded timeline starts at a block). Unknown → null (no widening).
     */
    internal fun survivors(db: PulseLoopDatabase) = object : HubDeletionCoalescer.Survivors {
        private var kinds: List<String>? = null

        override suspend fun instants(category: String, kind: String?, fromMs: Long, toMs: Long): List<Long>? {
            val dao = db.hubPendingDeletionDao()
            return when {
                category == HubEventMapper.BUCKET_CATEGORY -> dao.bucketInstants(fromMs, toMs)
                category == HubEventMapper.SLEEP_CATEGORY -> dao.sleepBlockInstants(fromMs, toMs)
                category.startsWith("metrics/") || category.startsWith("vendor/") -> {
                    val all = kinds ?: dao.measurementKinds().also { kinds = it }
                    val matching = all.filter { raw ->
                        HubEventMapper.categoriesFor(raw).any { (c, k) -> c == category && (kind == null || k == kind) }
                    }
                    if (matching.isEmpty()) emptyList() else dao.measurementInstants(matching, fromMs, toMs)
                }
                else -> null
            }
        }
    }
}
