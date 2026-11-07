package com.pulseloop.data.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * One CloudEvent waiting for (or already acknowledged by) the HTTPS home-server upload.
 *
 * Deliberately a separate table from `broadcast_outbox`: the MQTT drainer blanks a row's payload
 * the moment the broker acknowledges it, so sharing one queue would let an MQTT publish erase an
 * event the hub has not uploaded yet (and vice versa). Each transport owns its own cursor.
 *
 * Inserted in the same Room transaction as the health rows it describes (EventPersistenceSubscriber,
 * MeasurementDeletion), so a committed reading always has its upload queued. [eventId] is the
 * mapper's deterministic `pl-<sha256>` id and the primary key: a re-synced history record is
 * ignored on insert instead of queued twice, and the server de-duplicates on the same id.
 *
 * An acknowledged row stays as a compact receipt (payload blanked) so the ring re-supplying a day
 * it already sent does not upload it again; RetentionSweep prunes receipts after 30 days.
 */
@Entity(
    tableName = "hub_outbox",
    indices = [Index("uploadedAt"), Index("createdAt")],
)
data class HubOutboxEntity(
    @PrimaryKey val eventId: String,
    /** The contract's `category` (the MQTT topic suffix, or `deletion`). */
    val category: String,
    /** The CloudEvent JSON, `category` included. Blanked once the server has acknowledged it. */
    val payloadJson: String,
    val createdAt: Long = System.currentTimeMillis(),
    val attemptCount: Int = 0,
    val lastAttemptAt: Long? = null,
    val lastError: String? = null,
    /** Set when the server accepted it, counted it as a duplicate, or rejected it. */
    val uploadedAt: Long? = null,
    /** True when the server (or the local size check) rejected the event; [lastError] says why. */
    val rejected: Boolean = false,
)

/**
 * A hub deletion still to be queued: written where no installation id is at hand (the v33
 * database migration that removed the ring-clock duplicate buckets) and turned into
 * `com.pulseloop.deletion.v1` events by the uploader while paired ([com.pulseloop.hub.HubPendingDeletions]).
 * [fromMs]..[toMs] is inclusive; a single removed row has `fromMs == toMs`.
 */
@Entity(tableName = "hub_pending_deletions")
data class HubPendingDeletionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val category: String,
    val kind: String?,
    val fromMs: Long,
    val toMs: Long,
    val createdAt: Long,
)
