package com.pulseloop.hub

import com.pulseloop.data.dao.HubOutboxDao
import com.pulseloop.data.entity.HubOutboxEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** In-memory [HubOutboxDao] with the same ordering and conflict rules as the Room queries. */
class FakeHubOutboxDao : HubOutboxDao {
    val rows = linkedMapOf<String, HubOutboxEntity>()
    private val pendingFlow = MutableStateFlow(0)

    private fun refresh() { pendingFlow.value = rows.values.count { it.uploadedAt == null } }

    override suspend fun enqueue(event: HubOutboxEntity): Long {
        if (event.eventId in rows) return -1
        rows[event.eventId] = event
        refresh()
        return rows.size.toLong()
    }

    override suspend fun enqueueAll(events: List<HubOutboxEntity>): List<Long> = events.map { enqueue(it) }

    override suspend fun pending(limit: Int): List<HubOutboxEntity> = rows.values
        .filter { it.uploadedAt == null }
        .sortedWith(compareBy<HubOutboxEntity> { it.createdAt }.thenBy { it.eventId })
        .take(limit)

    override suspend fun pendingCount(): Int = rows.values.count { it.uploadedAt == null }
    override fun pendingCountFlow(): Flow<Int> = pendingFlow

    override suspend fun markUploaded(eventIds: List<String>, at: Long) {
        for (id in eventIds) rows[id]?.let {
            rows[id] = it.copy(uploadedAt = at, lastAttemptAt = at, lastError = null, attemptCount = it.attemptCount + 1, payloadJson = "")
        }
        refresh()
    }

    override suspend fun markRejected(eventIds: List<String>, at: Long, reason: String) {
        for (id in eventIds) rows[id]?.let {
            rows[id] = it.copy(uploadedAt = at, lastAttemptAt = at, lastError = reason, rejected = true, attemptCount = it.attemptCount + 1, payloadJson = "")
        }
        refresh()
    }

    override suspend fun markFailed(eventIds: List<String>, at: Long, error: String) {
        for (id in eventIds) rows[id]?.let {
            rows[id] = it.copy(lastAttemptAt = at, lastError = error, attemptCount = it.attemptCount + 1)
        }
    }

    override suspend fun clear() { rows.clear(); refresh() }
}

class FakeHubSettings(
    serverUrl: String,
    maxBatch: Int = 500,
    maxBytes: Long = 1_048_576,
    override val installationId: String = "install123",
) : HubSettingsSource {
    private val _pairing = MutableStateFlow<HubPairing?>(
        HubPairing(serverUrl, "secret-token", "person-1", "0.6.0", maxBatch, maxBytes, pairedAt = 1),
    )
    override val pairing: StateFlow<HubPairing?> = _pairing.asStateFlow()
    private val _status = MutableStateFlow(HubUploadStatus())
    override val status: StateFlow<HubUploadStatus> = _status.asStateFlow()
    override var backfillCursor: String? = null
        private set

    fun unpair() { _pairing.value = null }

    override fun recordSuccess(accepted: Int, duplicates: Int, rejected: Int, at: Long) {
        _status.value = _status.value.copy(
            lastUploadAt = at, lastError = null,
            acceptedTotal = _status.value.acceptedTotal + accepted,
            duplicatesTotal = _status.value.duplicatesTotal + duplicates,
            rejectedTotal = _status.value.rejectedTotal + rejected,
        )
    }
    override fun recordError(message: String, at: Long) { _status.value = _status.value.copy(lastError = message, lastErrorAt = at) }
    override fun markNeedsRepair(at: Long) { _pairing.value = _pairing.value?.copy(needsRepair = true) }
    override fun setNotBefore(at: Long) { _status.value = _status.value.copy(notBefore = at) }
    override fun saveBackfillCursor(cursor: String?, done: Boolean) {
        backfillCursor = cursor
        _status.value = _status.value.copy(backfillDone = done)
    }
}
