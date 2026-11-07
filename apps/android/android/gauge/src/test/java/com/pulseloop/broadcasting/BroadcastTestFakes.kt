package com.pulseloop.broadcasting

import com.pulseloop.data.dao.BroadcastOutboxDao
import com.pulseloop.data.entity.BroadcastOutboxEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

internal open class FakeBroadcastOutboxDao(
    rows: List<BroadcastOutboxEntity> = emptyList(),
) : BroadcastOutboxDao {
    val rows = rows.associateByTo(linkedMapOf()) { it.eventId }
    val publishedBatches = mutableListOf<List<String>>()
    private val pendingCountState = MutableStateFlow(0)
    private val deliveredCountState = MutableStateFlow(0)

    init { updateCounts() }

    override suspend fun enqueue(event: BroadcastOutboxEntity): Long {
        if (rows.containsKey(event.eventId)) return -1
        rows[event.eventId] = event
        updateCounts()
        return rows.size.toLong()
    }

    override suspend fun pending(limit: Int): List<BroadcastOutboxEntity> = rows.values
        .filter { it.publishedAt == null }
        .sortedWith(compareBy<BroadcastOutboxEntity> { it.createdAt }.thenBy { it.eventId })
        .take(limit)

    override fun pendingCountFlow(): Flow<Int> = pendingCountState
    open override suspend fun pendingCount(): Int = pendingCountState.value
    override fun deliveredCountFlow(): Flow<Int> = deliveredCountState

    override suspend fun markPublishedBatch(eventIds: List<String>, publishedAt: Long) {
        publishedBatches += eventIds.toList()
        eventIds.forEach { id ->
            rows[id]?.let {
                rows[id] = it.copy(
                    payloadJson = "",
                    publishedAt = publishedAt,
                    lastAttemptAt = publishedAt,
                    lastError = null,
                    attemptCount = it.attemptCount + 1,
                )
            }
        }
        updateCounts()
    }

    override suspend fun markFailedBatch(eventIds: List<String>, attemptedAt: Long, error: String) {
        eventIds.forEach { id ->
            rows[id]?.let {
                rows[id] = it.copy(
                    lastAttemptAt = attemptedAt,
                    lastError = error,
                    attemptCount = it.attemptCount + 1,
                )
            }
        }
        updateCounts()
    }

    override suspend fun pruneOlderThan(cutoff: Long): Int {
        val ids = rows.values.filter {
            (it.publishedAt != null && it.publishedAt < cutoff) ||
                (it.publishedAt == null && it.createdAt < cutoff)
        }.map { it.eventId }
        ids.forEach(rows::remove)
        updateCounts()
        return ids.size
    }

    override suspend fun clear() {
        rows.clear()
        updateCounts()
    }

    private fun updateCounts() {
        pendingCountState.value = rows.values.count { it.publishedAt == null }
        deliveredCountState.value = rows.values.count { it.publishedAt != null }
    }
}

internal class FakeSettingsSource(initial: MqttBroadcastSettings) : BroadcastSettingsSource {
    override val installationId = "installation"
    val mutableSettings = MutableStateFlow(initial)
    override val settings: StateFlow<MqttBroadcastSettings> = mutableSettings
    val mutableError = MutableStateFlow<String?>(null)
    override val lastPermanentError: StateFlow<String?> = mutableError
    val mutableFailureKind = MutableStateFlow<PermanentFailureKind?>(null)
    override val lastPermanentFailureKind: StateFlow<PermanentFailureKind?> = mutableFailureKind
    override fun recordPermanentError(
        message: String,
        kind: PermanentFailureKind,
        expectedRevision: Long,
    ): Boolean {
        if (mutableSettings.value.revision != expectedRevision) return false
        mutableError.value = message
        mutableFailureKind.value = kind
        return true
    }
}

internal fun outboxRow(index: Int, createdAt: Long = index.toLong()) = BroadcastOutboxEntity(
    eventId = "event-${index.toString().padStart(4, '0')}",
    topicSuffix = "metrics/hr",
    payloadJson = index.toString(),
    createdAt = createdAt,
)
