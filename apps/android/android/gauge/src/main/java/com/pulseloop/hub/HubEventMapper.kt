package com.pulseloop.hub

import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.broadcasting.PulseCloudEvent
import com.pulseloop.broadcasting.RingSourceIdentity
import com.pulseloop.data.entity.HubOutboxEntity
import com.pulseloop.data.entity.MeasurementEntity
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.ring.PulseEvent
import java.time.Instant
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Binds [BroadcastEventMapper]'s CloudEvents to the HTTPS hub outbox (contract §2): the same
 * envelope and deterministic id as MQTT, plus the `category` field (= the MQTT topic suffix).
 */
object HubEventMapper {
    const val DELETION_TYPE = "com.pulseloop.deletion.v1"
    const val DELETION_CATEGORY = "deletion"
    /** Matches the ±90 s spot-tombstone window (EventPersistenceSubscriber.SPOT_MATCH_MS). */
    const val DELETION_HALF_WINDOW_MS = 90_000L

    /** [source] stamps the ring identity fields of SPEC §2.1 on ring-derived events. */
    fun toHubOutbox(
        event: PulseEvent,
        installationId: String,
        receivedAt: Instant = Instant.now(),
        source: RingSourceIdentity? = null,
    ): HubOutboxEntity? {
        val mapped = BroadcastEventMapper.toCloudEvent(event, installationId, receivedAt, source) ?: return null
        val envelope = mapped.envelope.copy(category = mapped.topicSuffix)
        return HubOutboxEntity(
            eventId = mapped.eventId,
            category = mapped.topicSuffix,
            payloadJson = BroadcastEventMapper.json.encodeToString(envelope),
            createdAt = receivedAt.toEpochMilli(),
        )
    }

    /**
     * A `com.pulseloop.deletion.v1` event for one target (contract §2, Deletions). Every target but
     * category `*` names a time range with both `from` and `to` (ISO instants, `from <= to`); the
     * server rejects a range deletion missing either end.
     */
    fun deletion(
        target: JsonObject,
        installationId: String,
        deletedAt: Instant,
    ): HubOutboxEntity {
        require(isValidTarget(target)) { "A deletion target other than category * needs both from and to" }
        val data = buildJsonObject {
            put("schema_version", 1)
            put("observed_at", deletedAt.toString())
            put("received_at", deletedAt.toString())
            put("target", target)
        }
        // Each delete is its own fact: the deletion time is part of the identity, so deleting,
        // re-recording and deleting again is two events, not a duplicate.
        val eventId = "pl-" + BroadcastEventMapper.sha256("$DELETION_TYPE|$deletedAt|$target").take(40)
        val envelope = PulseCloudEvent(
            id = eventId,
            type = DELETION_TYPE,
            source = "urn:pulseloop:installation:$installationId",
            subject = DELETION_CATEGORY,
            time = deletedAt.toString(),
            data = data,
            category = DELETION_CATEGORY,
        )
        return HubOutboxEntity(
            eventId = eventId,
            category = DELETION_CATEGORY,
            payloadJson = BroadcastEventMapper.json.encodeToString(envelope),
            createdAt = deletedAt.toEpochMilli(),
        )
    }

    internal fun isValidTarget(target: JsonObject): Boolean {
        val category = target.text("category") ?: return false
        if (category == "*") return true
        val from = target.text("from")?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return false
        val to = target.text("to")?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return false
        return !from.isAfter(to)
    }

    private fun JsonObject.text(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /**
     * Insight kinds Gauge no longer produces. Nutrition moved to the Vitals app, so a stored
     * `nutrition_score` row from an older build is never uploaded again ([HubBackfill]).
     */
    val RETIRED_INSIGHT_KINDS = setOf("nutrition_score")

    /**
     * Hide every retired insight this installation uploaded before (category
     * `insights/<kind>`, all time up to [deletedAt]), so server agents stop seeing old
     * nutrition scores. Queued once by [HubSync.retireInsightsOnce].
     */
    fun retiredInsightDeletions(installationId: String, deletedAt: Instant): List<HubOutboxEntity> =
        RETIRED_INSIGHT_KINDS.sorted().map { kind ->
            deletion(
                buildJsonObject {
                    put("category", "insights/${BroadcastEventMapper.safeTopicSegment(kind)}")
                    put("from", Instant.EPOCH.toString())
                    put("to", deletedAt.toString())
                },
                installationId,
                deletedAt,
            )
        }

    /** "Reset App Data": everything this installation ever uploaded. */
    fun resetAll(installationId: String, deletedAt: Instant): HubOutboxEntity =
        deletion(buildJsonObject { put("category", "*") }, installationId, deletedAt)

    /**
     * A ±90 s range around each deleted reading's timestamp, in the category its upload used. Both
     * rows of a blood-pressure reading collapse into one `metrics/blood_pressure` target. Rows whose
     * kind maps to no uploaded category are skipped. Windows of one (category, kind) that overlap
     * are sent as their union — exactly the same set of hidden events, one event instead of one per
     * reading (0.6.3: deleting a run of readings no longer sends a deletion per sample).
     */
    fun measurementDeletions(
        rows: List<MeasurementEntity>,
        installationId: String,
        deletedAt: Instant,
    ): List<HubOutboxEntity> {
        val windows = rows
            .flatMap { row -> categoriesFor(row.kindRaw).map { (category, kind) -> Triple(category, kind, row.timestamp) } }
            .distinct()
            .mapIndexed { i, (category, kind, timestamp) ->
                HubDeletionCoalescer.Target(i.toLong(), category, kind, timestamp - DELETION_HALF_WINDOW_MS, timestamp + DELETION_HALF_WINDOW_MS)
            }
        return windows.groupBy { it.category to it.kind }
            .flatMap { (key, group) ->
                HubDeletionCoalescer.merge(key.first, key.second, group.sortedBy { it.fromMs }, stay = null, maxGapMs = 0)
            }
            .map { range -> exactDeletion(range.category, range.kind, range.fromMs, range.toMs, installationId, deletedAt) }
    }

    /**
     * A range deletion for one category (and optional kind); both ends inclusive, epoch millis.
     * Stored-history deletions reach this only through [HubPendingDeletions], which coalesces and
     * paces them — never call it once per removed sample (0.6.3).
     */
    fun exactDeletion(
        category: String,
        kind: String?,
        fromMs: Long,
        toMs: Long,
        installationId: String,
        deletedAt: Instant,
    ): HubOutboxEntity = deletion(
        buildJsonObject {
            put("category", category)
            if (kind != null) put("kind", kind)
            put("from", Instant.ofEpochMilli(fromMs).toString())
            put("to", Instant.ofEpochMilli(toMs).toString())
        },
        installationId,
        deletedAt,
    )

    /** The category and subject [BroadcastEventMapper] uploads an activity bucket under. */
    const val BUCKET_CATEGORY = "activity/buckets"
    const val BUCKET_KIND = "activity_bucket"
    const val SLEEP_CATEGORY = "sleep/timeline"
    const val SLEEP_KIND = "sleep_timeline"

    /**
     * (category, kind) pairs a stored `measurements.kindRaw` may have been uploaded under,
     * mirroring the upload mapping. A blood-pressure row covers both spellings: a live or decoded
     * reading travels as one `metrics/blood_pressure` event, a per-kind history sample as
     * `metrics/bp_sys` / `metrics/bp_dia`.
     */
    internal fun categoriesFor(kindRaw: String): List<Pair<String, String>> {
        if (kindRaw.startsWith(VENDOR_PREFIX)) {
            val key = BroadcastEventMapper.safeTopicSegment(kindRaw.removePrefix(VENDOR_PREFIX))
            return listOf("vendor/$key" to key)
        }
        val kind = runCatching { MeasurementKind.valueOf(kindRaw) }.getOrNull() ?: return emptyList()
        val own = "metrics/${kind.key}" to kind.key
        return when (kind) {
            MeasurementKind.BLOOD_PRESSURE_SYSTOLIC,
            MeasurementKind.BLOOD_PRESSURE_DIASTOLIC -> listOf("metrics/blood_pressure" to "blood_pressure", own)
            else -> listOf(own)
        }
    }

    private const val VENDOR_PREFIX = "VENDOR_"
}
