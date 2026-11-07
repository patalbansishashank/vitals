package com.pulseloop.hub

import com.pulseloop.data.dao.HubOutboxDao
import com.pulseloop.data.entity.HubOutboxEntity
import com.pulseloop.data.sources.HcRecordEntity
import com.pulseloop.data.sources.HcSourceDao
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

/**
 * The Health Connect reader's upload plug-in (energy SPEC §2.1, package GB): every row of
 * `hc_records` after the cursor becomes `hc/record` (a record or a new revision of one) or
 * `hc/deleted` (a tombstone), subject `<recordType>:<hcRecordId>`. A revision is a new event under
 * the same subject; the server keeps the latest `last_modified`.
 *
 * Paged like the other sources, so the one-year back-fill (DECISION D14) reaches the outbox in
 * bounded slices between upload batches instead of all at once. Gauge's own exports never reach
 * this table (the reader drops them), so nothing here re-checks origin.
 */
class HubHealthConnectSource(
    private val hc: Store,
    private val outbox: HubOutboxDao,
    private val settings: HubSettingsSource,
    private val cursor: HubSourceCursor,
    private val now: () -> Instant = Instant::now,
    private val pageSize: Int = 200,
    private val maxPagesPerCall: Int = 10,
) : HubUploadSource {

    interface Store {
        suspend fun recordsAfter(afterSeq: Long, limit: Int): List<HcRecordEntity>
    }

    class DaoStore(private val dao: HcSourceDao) : Store {
        override suspend fun recordsAfter(afterSeq: Long, limit: Int) = dao.recordsAfter(afterSeq, limit)
    }

    override fun reset() { cursor.value = null }

    override suspend fun enqueueChanged(): Int {
        if (settings.pairing.value == null) return 0
        var queued = 0
        var pages = 0
        while (pages++ < maxPagesPerCall) {
            val after = cursor.value?.toLongOrNull() ?: 0L
            val page = hc.recordsAfter(after, pageSize)
            if (page.isEmpty()) break
            val receivedAt = now()
            val rows = page.mapNotNull { event(it, settings.installationId, receivedAt) }
            outbox.enqueueAll(rows)
            queued += rows.size
            cursor.value = page.last().seq.toString()
            if (page.size < pageSize) break
        }
        return queued
    }

    companion object {
        const val RECORD_TYPE = "com.pulseloop.hc.record.v1"
        const val RECORD_CATEGORY = "hc/record"
        const val DELETED_TYPE = "com.pulseloop.hc.deleted.v1"
        const val DELETED_CATEGORY = "hc/deleted"
        const val CURSOR_KEY = "hc_records.v1"

        /** Null only for a row whose stored JSON no longer parses (it is skipped, not retried). */
        fun event(row: HcRecordEntity, installationId: String, receivedAt: Instant): HubOutboxEntity? {
            val data = runCatching { Json.parseToJsonElement(row.dataJson).jsonObject }.getOrNull() ?: return null
            return if (row.deleted) {
                HubSourceEvents.event(DELETED_TYPE, DELETED_CATEGORY, row.key, Instant.ofEpochMilli(row.lastModifiedMs), data, installationId, receivedAt)
            } else {
                HubSourceEvents.event(RECORD_TYPE, RECORD_CATEGORY, row.key, Instant.ofEpochMilli(row.startMs), data, installationId, receivedAt)
            }
        }
    }
}
