package com.pulseloop.data.entity

import androidx.room.Entity
import androidx.room.Index

/**
 * One externally publishable event waiting for delivery.
 *
 * The row is inserted in the same Room transaction as the health data it describes. MQTT is an
 * at-least-once transport, so [eventId] is stable and is also the primary key: replaying an
 * identical ring-history record cannot create an unbounded queue, and subscribers can use the id
 * as their own de-duplication key.
 *
 * A successful publish remains as the de-duplication receipt. Splitting its compact receipt from
 * the payload is a later storage optimization; deleting it would make an old ring-history replay
 * look new and publish the same observation again.
 */
@Entity(
    tableName = "broadcast_outbox",
    indices = [Index("publishedAt"), Index("createdAt")],
)
data class BroadcastOutboxEntity(
    @androidx.room.PrimaryKey val eventId: String,
    /** Topic relative to the configured `<base>/<installation-id>/` prefix. */
    val topicSuffix: String,
    /** CloudEvents-compatible JSON. Credentials and Bluetooth addresses never belong here. */
    val payloadJson: String,
    val qos: Int = 1,
    val retain: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val attemptCount: Int = 0,
    val lastAttemptAt: Long? = null,
    val lastError: String? = null,
    val publishedAt: Long? = null,
)
