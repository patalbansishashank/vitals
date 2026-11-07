package com.pulseloop.data.entity

import androidx.room.*

/**
 * Ported from [SleepSession] in PulseModels.swift.
 */
@Entity(tableName = "sleep_sessions", indices = [Index("date"), Index("startAt")])
data class SleepSessionEntity(
    @PrimaryKey val id: String = java.util.UUID.randomUUID().toString(),
    val date: Long,          // epoch millis, start of day
    val startAt: Long,       // epoch millis
    val endAt: Long,         // epoch millis
    val totalMinutes: Int,
    val score: Int? = null,
    val syncedAt: Long? = null,
    /** "ring" for synced sessions, "demo" for seeded ones — lets demo clears leave real data alone. */
    val sourceRaw: String = "ring",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

/**
 * Ported from [SleepStageBlock] in PulseModels.swift.
 */
@Entity(
    tableName = "sleep_stage_blocks",
    indices = [Index("sessionId")],
    foreignKeys = [ForeignKey(
        entity = SleepSessionEntity::class,
        parentColumns = ["id"], childColumns = ["sessionId"],
        onDelete = ForeignKey.CASCADE
    )],
)
data class SleepStageBlockEntity(
    @PrimaryKey val id: String = java.util.UUID.randomUUID().toString(),
    val sessionId: String,
    val startAt: Long,       // epoch millis
    val startMinute: Int,
    val durationMinutes: Int,
    val stageRaw: String,    // SleepStage name
)

/**
 * Ported from [RawPacketRow] in PulseModels.swift.
 * Bounded production diagnostics, or an explicitly enabled 24-hour full capture.
 */
@Entity(tableName = "raw_packets", indices = [Index("timestamp"), Index("firmwareRevision", "decodedKind")])
data class RawPacketEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val timestamp: Long = System.currentTimeMillis(),
    val directionRaw: String,
    val commandId: Int,
    val hexPayload: String,
    val decodedKind: String? = null,
    val decodedJSON: String? = null,
    val confidenceRaw: String = "unknown",
    /** The protocol family that produced this frame, for the diagnostics report's masking — see
     *  [com.pulseloop.ring.PulseEvent.RawPacket.deviceType]. Null on rows captured before it was
     *  recorded, which the redactor masks conservatively. */
    val deviceTypeRaw: String? = null,
    /** Firmware reported by this connection before the packet was decoded. Null means the ring
     *  had not answered its revision query yet; never infer it from whichever device is current. */
    val firmwareRevision: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
)

/**
 * Ported from [ActivityEvent] in PulseModels.swift.
 */
@Entity(tableName = "activity_events", indices = [Index("sessionId")])
data class ActivityEventEntity(
    @PrimaryKey val id: String = java.util.UUID.randomUUID().toString(),
    val sessionId: String,
    val kind: String,
    val timestamp: Long,
    val payloadJSON: String? = null,
)

/**
 * Ported from [ActivitySample] in PulseModels.swift.
 */
@Entity(tableName = "activity_samples", indices = [Index("sessionId"), Index("timestamp")])
data class ActivitySampleEntity(
    @PrimaryKey val id: String = java.util.UUID.randomUUID().toString(),
    val sessionId: String,
    val measurementId: String? = null,
    val kind: String,
    val value: Double,
    val unit: String,
    val timestamp: Long,
    val source: String = "mock",
    val confidenceRaw: String = "known",
)

/**
 * Ported from [ActivitySensorPollEvent] in PulseModels.swift.
 */
@Entity(tableName = "activity_sensor_polls", indices = [Index("sessionId")])
data class ActivitySensorPollEntity(
    @PrimaryKey val id: String = java.util.UUID.randomUUID().toString(),
    val sessionId: String,
    val timestamp: Long,
    val kind: String,    // "hr" | "spo2"
    val status: String,  // "started" | "success" | "failed" | "skipped"
    val value: Double? = null,
    val errorMessage: String? = null,
)

/**
 * Ported from [DerivedUpdateRow] in PulseModels.swift.
 */
@Entity(tableName = "derived_updates", indices = [Index("timestamp"), Index("kind", "entityId")])
data class DerivedUpdateEntity(
    @PrimaryKey val id: String = java.util.UUID.randomUUID().toString(),
    val timestamp: Long = System.currentTimeMillis(),
    val kind: String,
    val entityType: String,
    val entityId: String,
    val payloadJSON: String? = null,
)

