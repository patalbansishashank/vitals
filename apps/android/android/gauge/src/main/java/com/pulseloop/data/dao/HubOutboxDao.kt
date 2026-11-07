package com.pulseloop.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.pulseloop.data.entity.ActivityBucketEntity
import com.pulseloop.data.entity.ActivityDailyEntity
import com.pulseloop.data.entity.DerivedUpdateEntity
import com.pulseloop.data.entity.HubOutboxEntity
import com.pulseloop.data.entity.HubPendingDeletionEntity
import com.pulseloop.data.entity.MeasurementEntity
import com.pulseloop.data.entity.SleepSessionEntity
import com.pulseloop.data.entity.SleepStageBlockEntity
import kotlinx.coroutines.flow.Flow

/** The HTTPS home-server outbox. Independent of [BroadcastOutboxDao] (see [HubOutboxEntity]). */
@Dao
interface HubOutboxDao {
    /** Returns -1 when the exact logical event is already queued or uploaded. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueue(event: HubOutboxEntity): Long

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueueAll(events: List<HubOutboxEntity>): List<Long>

    @Query(
        "SELECT * FROM hub_outbox WHERE uploadedAt IS NULL " +
            "ORDER BY createdAt ASC, eventId ASC LIMIT :limit",
    )
    suspend fun pending(limit: Int): List<HubOutboxEntity>

    @Query("SELECT COUNT(*) FROM hub_outbox WHERE uploadedAt IS NULL")
    suspend fun pendingCount(): Int

    @Query("SELECT COUNT(*) FROM hub_outbox WHERE uploadedAt IS NULL")
    fun pendingCountFlow(): Flow<Int>

    @Query(
        "UPDATE hub_outbox SET uploadedAt = :at, lastAttemptAt = :at, lastError = NULL, " +
            "attemptCount = attemptCount + 1, payloadJson = '' WHERE eventId IN (:eventIds)",
    )
    suspend fun markUploaded(eventIds: List<String>, at: Long)

    @Query(
        "UPDATE hub_outbox SET uploadedAt = :at, lastAttemptAt = :at, lastError = :reason, " +
            "rejected = 1, attemptCount = attemptCount + 1, payloadJson = '' WHERE eventId IN (:eventIds)",
    )
    suspend fun markRejected(eventIds: List<String>, at: Long, reason: String)

    @Query(
        "UPDATE hub_outbox SET lastAttemptAt = :at, lastError = :error, " +
            "attemptCount = attemptCount + 1 WHERE eventId IN (:eventIds)",
    )
    suspend fun markFailed(eventIds: List<String>, at: Long, error: String)

    @Query("DELETE FROM hub_outbox")
    suspend fun clear()
}

/** Hub deletions waiting for an installation id ([HubPendingDeletionEntity]). */
@Dao
interface HubPendingDeletionDao {
    @Insert
    suspend fun add(rows: List<HubPendingDeletionEntity>)

    @Query("SELECT * FROM hub_pending_deletions ORDER BY id ASC LIMIT :limit")
    suspend fun next(limit: Int): List<HubPendingDeletionEntity>

    @Query("DELETE FROM hub_pending_deletions WHERE id IN (:ids)")
    suspend fun remove(ids: List<Long>)

    @Query("SELECT * FROM hub_pending_deletions ORDER BY id ASC")
    suspend fun all(): List<HubPendingDeletionEntity>

    /** Deletion events waiting in the outbox or uploaded since [since] (the hourly budget). */
    @Query("SELECT COUNT(*) FROM hub_outbox WHERE category = 'deletion' AND (uploadedAt IS NULL OR uploadedAt >= :since)")
    suspend fun recentDeletionEvents(since: Long): Int

    // Stored rows a coalesced deletion must not cover (com.pulseloop.hub.HubDeletionCoalescer).
    @Query("SELECT DISTINCT kindRaw FROM measurements")
    suspend fun measurementKinds(): List<String>

    @Query("SELECT DISTINCT timestamp FROM measurements WHERE kindRaw IN (:kinds) AND timestamp BETWEEN :fromMs AND :toMs ORDER BY timestamp ASC")
    suspend fun measurementInstants(kinds: List<String>, fromMs: Long, toMs: Long): List<Long>

    @Query("SELECT startEpoch FROM activity_buckets WHERE startEpoch BETWEEN :fromMs AND :toMs ORDER BY startEpoch ASC")
    suspend fun bucketInstants(fromMs: Long, toMs: Long): List<Long>

    @Query("SELECT DISTINCT startAt FROM sleep_stage_blocks WHERE startAt BETWEEN :fromMs AND :toMs ORDER BY startAt ASC")
    suspend fun sleepBlockInstants(fromMs: Long, toMs: Long): List<Long>
}

/**
 * Keyset-paged reads of the stored history for the first-pair backfill. Demo rows never leave the
 * phone. Reads only — the health tables' own DAOs stay the only writers.
 */
@Dao
interface HubBackfillDao {
    @Query(
        "SELECT * FROM measurements WHERE sourceRaw NOT IN ('demo','mock') " +
            "AND (timestamp > :afterTs OR (timestamp = :afterTs AND id > :afterId)) " +
            "ORDER BY timestamp ASC, id ASC LIMIT :limit",
    )
    suspend fun measurementsAfter(afterTs: Long, afterId: String, limit: Int): List<MeasurementEntity>

    @Query(
        "SELECT * FROM measurements WHERE kindRaw = :kindRaw AND timestamp = :timestamp " +
            "AND sourceRaw NOT IN ('demo','mock') ORDER BY id LIMIT 1",
    )
    suspend fun measurementAt(kindRaw: String, timestamp: Long): MeasurementEntity?

    @Query(
        "SELECT * FROM activity_daily WHERE source NOT IN ('demo','mock') " +
            "AND (date > :afterDate OR (date = :afterDate AND id > :afterId)) " +
            "ORDER BY date ASC, id ASC LIMIT :limit",
    )
    suspend fun activityDailyAfter(afterDate: Long, afterId: String, limit: Int): List<ActivityDailyEntity>

    @Query(
        "SELECT * FROM activity_buckets WHERE source NOT IN ('demo','mock') " +
            "AND startEpoch > :afterStart ORDER BY startEpoch ASC LIMIT :limit",
    )
    suspend fun activityBucketsAfter(afterStart: Long, limit: Int): List<ActivityBucketEntity>

    @Query(
        "SELECT * FROM sleep_sessions WHERE sourceRaw NOT IN ('demo','mock') " +
            "AND (startAt > :afterStart OR (startAt = :afterStart AND id > :afterId)) " +
            "ORDER BY startAt ASC, id ASC LIMIT :limit",
    )
    suspend fun sleepSessionsAfter(afterStart: Long, afterId: String, limit: Int): List<SleepSessionEntity>

    @Query("SELECT * FROM sleep_stage_blocks WHERE sessionId IN (:sessionIds) ORDER BY startAt ASC")
    suspend fun stageBlocksFor(sessionIds: List<String>): List<SleepStageBlockEntity>

    @Query(
        "SELECT * FROM derived_updates WHERE entityType = 'local_insight' AND id > :afterId " +
            "ORDER BY id ASC LIMIT :limit",
    )
    suspend fun insightsAfter(afterId: String, limit: Int): List<DerivedUpdateEntity>
}
