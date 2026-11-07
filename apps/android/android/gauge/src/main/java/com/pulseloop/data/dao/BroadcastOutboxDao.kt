package com.pulseloop.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.pulseloop.data.entity.BroadcastOutboxEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface BroadcastOutboxDao {
    /** Returns -1 when the exact logical event is already queued or delivered. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueue(event: BroadcastOutboxEntity): Long

    @Query(
        "SELECT * FROM broadcast_outbox WHERE publishedAt IS NULL " +
            "ORDER BY createdAt ASC, eventId ASC LIMIT :limit",
    )
    suspend fun pending(limit: Int = 250): List<BroadcastOutboxEntity>

    @Query("SELECT COUNT(*) FROM broadcast_outbox WHERE publishedAt IS NULL")
    fun pendingCountFlow(): Flow<Int>

    @Query("SELECT COUNT(*) FROM broadcast_outbox WHERE publishedAt IS NULL")
    suspend fun pendingCount(): Int

    @Query("SELECT COUNT(*) FROM broadcast_outbox WHERE publishedAt IS NOT NULL")
    fun deliveredCountFlow(): Flow<Int>

    @Query(
        "UPDATE broadcast_outbox SET publishedAt = :publishedAt, lastAttemptAt = :publishedAt, " +
            "lastError = NULL, attemptCount = attemptCount + 1, payloadJson = '' " +
            "WHERE eventId IN (:eventIds)",
    )
    suspend fun markPublishedBatch(eventIds: List<String>, publishedAt: Long)

    @Query(
        "UPDATE broadcast_outbox SET lastAttemptAt = :attemptedAt, lastError = :error, " +
            "attemptCount = attemptCount + 1 WHERE eventId IN (:eventIds)",
    )
    suspend fun markFailedBatch(eventIds: List<String>, attemptedAt: Long, error: String)

    @Query(
        "DELETE FROM broadcast_outbox WHERE " +
            "(publishedAt IS NOT NULL AND publishedAt < :cutoff) OR " +
            "(publishedAt IS NULL AND createdAt < :cutoff)",
    )
    suspend fun pruneOlderThan(cutoff: Long): Int

    @Query("DELETE FROM broadcast_outbox")
    suspend fun clear()
}
