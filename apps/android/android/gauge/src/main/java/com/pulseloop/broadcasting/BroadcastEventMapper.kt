package com.pulseloop.broadcasting

import com.pulseloop.data.entity.BroadcastOutboxEntity
import com.pulseloop.ring.HrProvenance
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.ring.PulseEvent
import java.security.MessageDigest
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class PulseCloudEvent(
    val specversion: String = "1.0",
    val id: String,
    val type: String,
    val source: String,
    val subject: String,
    val time: String,
    val datacontenttype: String = "application/json",
    val data: JsonObject,
    /**
     * The transport-neutral routing key — the MQTT topic suffix (`metrics/hr`, `sleep/timeline`,
     * …). Null on MQTT, where the topic already carries it (explicitNulls = false omits it, so
     * MQTT payloads are byte-identical to before); set on the HTTPS hub upload, which has no topic.
     */
    val category: String? = null,
)

/**
 * Which ring produced an event (SPEC §2.1 "new data fields on every ring-derived event").
 * Every field is optional: one that is unknown is omitted, never guessed. [zone] gives
 * `local_offset_min`, the zone offset at the event's observation instant.
 */
data class RingSourceIdentity(
    val deviceKey: String? = null,
    val deviceModel: String? = null,
    val firmware: String? = null,
    val decoderVersion: String? = null,
    val zone: java.time.ZoneId? = null,
) {
    companion object {
        /** sha256 of the ring MAC (case- and separator-insensitive), first 16 hex characters. */
        fun deviceKey(mac: String?): String? {
            val normalized = mac?.uppercase()?.filter { it.isLetterOrDigit() }?.takeIf { it.isNotEmpty() } ?: return null
            return BroadcastEventMapper.sha256(normalized).take(16)
        }

        /**
         * The decoder that produced a family's events. `jstyle2301/2` and `colmi/2` are the
         * ring-evidence decoders of SPEC GA (native step support); other families are unchanged.
         */
        fun decoderVersion(deviceType: com.pulseloop.ring.RingDeviceType): String = when (deviceType) {
            com.pulseloop.ring.RingDeviceType.JSTYLE_2301 -> com.pulseloop.ring.JStyle2301Decoder.DECODER_VERSION
            com.pulseloop.ring.RingDeviceType.COLMI_R02 -> "colmi/2"
            else -> "${deviceType.name.lowercase()}/1"
        }
    }
}

/** One mapped event before it is bound to a transport's outbox row. */
data class MappedCloudEvent(
    val eventId: String,
    val topicSuffix: String,
    val envelope: PulseCloudEvent,
    val retain: Boolean,
)

/**
 * Converts the typed in-process event into a transport-neutral, CloudEvents-compatible record.
 * Raw BLE frames and internal flow-control events are deliberately excluded; normalized health,
 * device, measurement and synchronization facts are included.
 */
object BroadcastEventMapper {
    internal val json = Json { encodeDefaults = true; explicitNulls = false }

    fun toOutbox(
        event: PulseEvent,
        installationId: String,
        receivedAt: Instant = Instant.now(),
        source: RingSourceIdentity? = null,
    ): BroadcastOutboxEntity? {
        val mapped = toCloudEvent(event, installationId, receivedAt, source) ?: return null
        return BroadcastOutboxEntity(
            eventId = mapped.eventId,
            topicSuffix = mapped.topicSuffix,
            payloadJson = json.encodeToString(mapped.envelope),
            qos = 1,
            retain = mapped.retain,
            createdAt = receivedAt.toEpochMilli(),
        )
    }

    /**
     * The single mapping both transports share (MQTT outbox, HTTPS hub outbox), so an event has
     * the same deterministic id and envelope whichever way it leaves the phone.
     */
    fun toCloudEvent(
        event: PulseEvent,
        installationId: String,
        receivedAt: Instant = Instant.now(),
        source: RingSourceIdentity? = null,
    ): MappedCloudEvent? {
        val mapped = mappedEvent(event, receivedAt, source?.zone ?: java.time.ZoneId.systemDefault())?.let { m ->
            if (source != null && isRingDerived(event)) m.copy(data = withSource(m.data, source, m.observedAt)) else m
        } ?: return null
        // Delivery time changes on a replay; the observed fact does not. Exclude received_at so
        // an identical history record keeps one id across every re-sync and app restart.
        val identityData = JsonObject(mapped.data.filterKeys { it != "received_at" })
        val canonical = "${mapped.type}|${mapped.subject}|${mapped.observedAt}|$identityData"
        val eventId = "pl-${sha256(canonical).take(40)}"
        val envelope = PulseCloudEvent(
            id = eventId,
            type = mapped.type,
            source = "urn:pulseloop:installation:$installationId",
            subject = mapped.subject,
            time = mapped.observedAt.toString(),
            data = mapped.data,
        )
        return MappedCloudEvent(eventId, mapped.topicSuffix, envelope, mapped.retain)
    }

    /** Events whose values a ring measured or decoded (they carry [RingSourceIdentity]). */
    internal fun isRingDerived(event: PulseEvent): Boolean = when (event) {
        is PulseEvent.HeartRateSample, is PulseEvent.Spo2Result, is PulseEvent.HistoryMeasurement,
        is PulseEvent.StressSample, is PulseEvent.HrvSample, is PulseEvent.TemperatureSample,
        is PulseEvent.VendorMetric, is PulseEvent.BloodSugarSample, is PulseEvent.BloodPressureSample,
        is PulseEvent.ActivityUpdate, is PulseEvent.ActivityBucket, is PulseEvent.SleepTimeline,
        is PulseEvent.SportTelemetrySample, is PulseEvent.HistoryCoverage -> true
        else -> false
    }

    private fun withSource(data: JsonObject, source: RingSourceIdentity, observedAt: Instant): JsonObject {
        val out = LinkedHashMap(data)
        source.deviceKey?.let { out["device_key"] = JsonPrimitive(it) }
        source.deviceModel?.let { out["device_model"] = JsonPrimitive(it) }
        source.firmware?.let { out["firmware"] = JsonPrimitive(it) }
        source.decoderVersion?.let { out["decoder_version"] = JsonPrimitive(it) }
        source.zone?.let { out["local_offset_min"] = JsonPrimitive(it.rules.getOffset(observedAt).totalSeconds / 60) }
        return JsonObject(out)
    }

    /** The upload subject of native-support ring steps; `activity_bucket` stays for legacy rows. */
    const val RING_STEPS_SUBJECT = "ring_steps"
    const val SPORT_TELEMETRY_TYPE = "com.pulseloop.activity.sport_telemetry.v1"
    /** The declared sampling cadence of a heart-rate reading, seconds (server `hrSupport.ts`). */
    const val CADENCE_FIELD = "cadence_s"

    private data class Mapped(
        val type: String,
        val subject: String,
        val topicSuffix: String,
        val observedAt: Instant,
        val data: JsonObject,
        val retain: Boolean = false,
    )

    private fun mappedEvent(event: PulseEvent, receivedAt: Instant, zone: java.time.ZoneId): Mapped? = when (event) {
        is PulseEvent.HeartRateSample -> {
            // A live sample of a recording workout with a verified gap declares it (HrProvenance);
            // every other live or spot sample stays exactly as before (no cadence, same id).
            val cadence = if (event.spot) null else HrProvenance.workoutCadence(HrProvenance.DEVICE_WORKOUT, event.cadenceS)
            metric(
                MeasurementKind.HEART_RATE, event.bpm.toDouble(), event.timestamp, receivedAt,
                provenance = when {
                    event.spot -> "device_spot"
                    cadence != null -> HrProvenance.DEVICE_WORKOUT
                    else -> "device_live"
                },
                extra = buildMap {
                    put("spot", JsonPrimitive(event.spot))
                    put("ring_will_log", JsonPrimitive(event.ringWillLogIt))
                    if (cadence != null) put(CADENCE_FIELD, JsonPrimitive(cadence))
                },
            )
        }
        is PulseEvent.Spo2Result -> metric(
            MeasurementKind.SPO2, event.value.toDouble(), event.timestamp, receivedAt,
            provenance = if (event.spot) "device_spot" else "device_live",
            extra = mapOf(
                "spot" to JsonPrimitive(event.spot),
                "ring_will_log" to JsonPrimitive(event.ringWillLogIt),
            ),
        )
        is PulseEvent.HistoryMeasurement -> metric(
            event.kind, event.value, event.timestamp, receivedAt,
            provenance = event.provenance,
            extra = buildMap {
                put("replayed", JsonPrimitive(true))
                // Only a workout stream's reading declares a cadence; all-day history never does.
                HrProvenance.workoutCadence(event.provenance, event.cadenceS)?.let { put(CADENCE_FIELD, JsonPrimitive(it)) }
            },
        )
        is PulseEvent.StressSample -> metric(
            MeasurementKind.STRESS, event.value.toDouble(), event.timestamp, receivedAt,
            provenance = if (event.isHistory) "device_history" else "device_live",
            extra = mapOf("replayed" to JsonPrimitive(event.isHistory)),
        )
        is PulseEvent.HrvSample -> metric(
            MeasurementKind.HRV, event.value.toDouble(), event.timestamp, receivedAt,
            provenance = "device_live",
        )
        is PulseEvent.TemperatureSample -> metric(
            MeasurementKind.TEMPERATURE, event.celsius, event.timestamp, receivedAt,
            provenance = if (event.isHistory) "device_history" else "device_live",
            extra = mapOf("replayed" to JsonPrimitive(event.isHistory)),
        )
        is PulseEvent.VendorMetric -> mapped(
            type = "health.vendor_metric.observed",
            subject = "vendor.${safeTopicSegment(event.key)}",
            topicSuffix = "vendor/${safeTopicSegment(event.key)}",
            observedAt = event.timestamp,
            receivedAt = receivedAt,
            values = mapOf(
                "metric" to JsonPrimitive(event.key),
                "value" to JsonPrimitive(event.value),
                "unit" to JsonPrimitive(event.unit),
                "provenance" to JsonPrimitive(if (event.isHistory) "device_history_estimate" else "device_estimate"),
                "quality" to JsonPrimitive("unverified"),
                "replayed" to JsonPrimitive(event.isHistory),
            ),
        )
        is PulseEvent.DerivedInsight -> mapped(
            type = "health.insight.updated",
            subject = safeTopicSegment(event.key),
            topicSuffix = "insights/${safeTopicSegment(event.key)}",
            observedAt = event.scopeStart,
            receivedAt = receivedAt,
            values = mapOf(
                "insight" to JsonPrimitive(event.key),
                "value" to JsonPrimitive(event.value),
                "unit" to JsonPrimitive(event.unit),
                "confidence" to JsonPrimitive(event.confidence),
                "algorithm_version" to JsonPrimitive(event.algorithmVersion),
                "inputs" to JsonObject(event.inputs.toSortedMap().mapValues { JsonPrimitive(it.value) }),
                "note" to nullable(event.note),
                "provenance" to JsonPrimitive("locally_derived"),
            ),
            retain = true,
        )
        is PulseEvent.BloodSugarSample -> metric(
            MeasurementKind.BLOOD_SUGAR, event.mgdl, event.timestamp, receivedAt,
            provenance = "device_estimate",
        )
        is PulseEvent.BloodPressureSample -> mapped(
            type = "health.metric.observed",
            subject = "blood_pressure",
            topicSuffix = "metrics/blood_pressure",
            observedAt = event.timestamp,
            receivedAt = receivedAt,
            values = mapOf(
                "systolic" to JsonPrimitive(event.systolic),
                "diastolic" to JsonPrimitive(event.diastolic),
                "unit" to JsonPrimitive("mmHg"),
                "provenance" to JsonPrimitive(if (event.isHistory) "device_history_estimate" else "device_estimate"),
                "replayed" to JsonPrimitive(event.isHistory),
            ),
        )
        is PulseEvent.ActivityUpdate -> mapped(
            type = "health.activity.updated",
            subject = "daily_activity",
            topicSuffix = "activity/daily",
            observedAt = event.timestamp,
            receivedAt = receivedAt,
            values = mapOf(
                "steps" to JsonPrimitive(event.steps),
                "distance_m" to JsonPrimitive(event.distanceMeters),
                "calories_kcal" to JsonPrimitive(event.calories),
                // SPEC §2.1: kept, but it is the ring vendor's number, not an energy estimate.
                "calories_label" to JsonPrimitive("vendor"),
                "calories_provenance" to JsonPrimitive("device_estimate"),
                "calories_energy_basis" to JsonPrimitive("unspecified_by_device"),
                "active_minutes" to (event.activeMinutes?.let(::JsonPrimitive) ?: JsonNull),
                "provenance" to JsonPrimitive("device_reported"),
            ),
        )
        // SPEC §2.1 / GA.1, GA.7: a bucket with native support is `ring_steps` evidence; one
        // without (pre-v36 rows, families of unknown bucket length) keeps the legacy subject and
        // the exact legacy payload, so its id is the one already uploaded.
        is PulseEvent.ActivityBucket -> if (event.support == null || event.durationS == null ||
            event.support == com.pulseloop.ring.StepSupport.LEGACY_UNKNOWN
        ) mapped(
            type = "health.activity.bucket.observed",
            subject = "activity_bucket",
            topicSuffix = "activity/buckets",
            observedAt = event.timestamp,
            receivedAt = receivedAt,
            values = mapOf(
                "steps" to JsonPrimitive(event.steps),
                "distance_m" to JsonPrimitive(event.distanceMeters),
                "provenance" to JsonPrimitive("device_history"),
                "replayed" to JsonPrimitive(true),
            ),
        ) else mapped(
            type = "health.activity.bucket.observed",
            subject = RING_STEPS_SUBJECT,
            topicSuffix = "activity/buckets",
            observedAt = event.timestamp,
            receivedAt = receivedAt,
            values = linkedMapOf(
                "start" to JsonPrimitive(event.timestamp.toString()),
                "duration_s" to JsonPrimitive(event.durationS),
                "steps" to JsonPrimitive(event.steps),
                "distance_m" to JsonPrimitive(event.distanceMeters),
                "support" to JsonPrimitive(event.support.wire),
                "parent_total_steps" to (event.parentTotalSteps?.let(::JsonPrimitive) ?: JsonNull),
                "parent_record_start" to nullable(event.parentRecordStart?.toString()),
                "provenance" to JsonPrimitive("device_history"),
                "replayed" to JsonPrimitive(true),
            ).also { values ->
                // Backfilled rows carry their own stored ring; live ones get the current ring's.
                event.deviceKey?.let { values["device_key"] = JsonPrimitive(it) }
            },
        )
        is PulseEvent.SportTelemetrySample -> mapped(
            type = SPORT_TELEMETRY_TYPE,
            subject = "sport_telemetry",
            topicSuffix = "activity/sport_telemetry",
            observedAt = event.timestamp,
            receivedAt = receivedAt,
            values = mapOf(
                "t" to JsonPrimitive(event.timestamp.toString()),
                "steps_cum" to JsonPrimitive(event.stepsCumulative),
                "kcal_cum_vendor" to (event.vendorKcalCumulative?.let(::JsonPrimitive) ?: JsonNull),
                "bpm" to (event.bpm?.let(::JsonPrimitive) ?: JsonNull),
                "provenance" to JsonPrimitive("device_live"),
            ),
        )
        // GA.8: what one history pull proved. [fromDay, toDay] are the whole local days inside
        // [from, to) (null when none is whole); complete = no gap before `from`.
        is PulseEvent.HistoryCoverage -> mapped(
            type = "health.sync.coverage",
            subject = "coverage.${safeTopicSegment(event.stream)}",
            topicSuffix = "state/sync",
            observedAt = receivedAt,
            receivedAt = receivedAt,
            values = coverageValues(event, zone),
        )
        is PulseEvent.SleepTimeline -> mapped(
            type = "health.sleep.timeline.updated",
            subject = "sleep_timeline",
            topicSuffix = "sleep/timeline",
            observedAt = event.timestamp,
            receivedAt = receivedAt,
            values = linkedMapOf<String, JsonElement>(
                "sample_interval_minutes" to JsonPrimitive(1),
                "complete_session" to JsonPrimitive(event.completeSession),
                "stages" to JsonArray(event.stages.map { JsonPrimitive(it.name.lowercase()) }),
                "provenance" to JsonPrimitive("device_classified"),
                "replayed" to JsonPrimitive(true),
            ).also { values ->
                // GA.2: present only when the decoder knows them, so older timelines keep their id.
                event.nativeEpochS?.let { values["native_epoch_s"] = JsonPrimitive(it) }
                event.rawStageCodes?.let { codes -> values["stage_codes_raw"] = JsonArray(codes.map(::JsonPrimitive)) }
            },
        )
        is PulseEvent.BatteryLevel -> mapped(
            type = "health.device.battery.updated",
            subject = "battery",
            topicSuffix = "state/battery",
            observedAt = receivedAt,
            receivedAt = receivedAt,
            values = mapOf("percent" to JsonPrimitive(event.percent)),
            retain = true,
        )
        is PulseEvent.DeviceStateChanged -> mapped(
            type = "health.device.connection.updated",
            subject = "connection",
            topicSuffix = "state/connection",
            observedAt = receivedAt,
            receivedAt = receivedAt,
            // Deliberately omit Bluetooth address and device name.
            values = mapOf(
                "state" to JsonPrimitive(event.state.name.lowercase()),
                "device_type" to nullable(event.deviceType?.name?.lowercase()),
                "firmware" to nullable(event.firmware),
            ),
            retain = true,
        )
        is PulseEvent.DeviceIdentified -> mapped(
            type = "health.device.identified",
            subject = "device",
            topicSuffix = "state/device",
            observedAt = receivedAt,
            receivedAt = receivedAt,
            values = mapOf(
                "device_type" to JsonPrimitive(event.deviceType.name.lowercase()),
                "model_id" to nullable(event.wearableModelID),
                "capabilities" to JsonArray(event.capabilities.map { it.key }.sorted().map(::JsonPrimitive)),
            ),
            retain = true,
        )
        PulseEvent.DeviceForgotten -> mapped(
            type = "health.device.forgotten",
            subject = "device",
            topicSuffix = "state/device",
            observedAt = receivedAt,
            receivedAt = receivedAt,
            values = mapOf("forgotten" to JsonPrimitive(true)),
            retain = true,
        )
        is PulseEvent.SyncProgress -> mapped(
            type = "health.sync.progress",
            subject = "sync",
            topicSuffix = "state/sync",
            observedAt = receivedAt,
            receivedAt = receivedAt,
            values = mapOf("stage" to JsonPrimitive(event.stage)),
            retain = true,
        )
        is PulseEvent.FirmwareRevision -> mapped(
            type = "health.device.firmware.updated",
            subject = "firmware",
            topicSuffix = "state/firmware",
            observedAt = receivedAt,
            receivedAt = receivedAt,
            values = mapOf("version" to JsonPrimitive(event.version)),
            retain = true,
        )
        is PulseEvent.WearState -> mapped(
            type = "health.device.wear_state.updated",
            subject = "wear_state",
            topicSuffix = "state/wear",
            observedAt = receivedAt,
            receivedAt = receivedAt,
            values = mapOf("worn" to JsonPrimitive(event.worn)),
            retain = true,
        )
        is PulseEvent.MeasurementComplete -> mapped(
            type = "health.measurement.completed",
            subject = "measurement",
            topicSuffix = "state/measurement",
            observedAt = event.timestamp,
            receivedAt = receivedAt,
            values = mapOf(
                "mode" to JsonPrimitive(event.mode),
                "success" to JsonPrimitive(event.success),
            ),
        )
        is PulseEvent.MeasurementRejected -> mapped(
            type = "health.measurement.rejected",
            subject = "measurement",
            topicSuffix = "state/measurement",
            observedAt = receivedAt,
            receivedAt = receivedAt,
            values = mapOf("mode" to JsonPrimitive(event.mode)),
        )

        // Raw frames are stored for local diagnostics; gates/completion sentinels and the old
        // ambiguous numeric firmware record are internal protocol mechanics, not health facts.
        is PulseEvent.RawPacket,
        is PulseEvent.LiveSampleGate,
        is PulseEvent.HeartRateComplete,
        is PulseEvent.Spo2Complete,
        is PulseEvent.ActivitySyncReset,
        is PulseEvent.FirmwareVersion -> null
    }

    internal fun coverageValues(event: PulseEvent.HistoryCoverage, zone: java.time.ZoneId): Map<String, JsonElement> {
        val fromDate = event.from.atZone(zone).toLocalDate()
        val firstWhole = if (fromDate.atStartOfDay(zone).toInstant() == event.from) fromDate else fromDate.plusDays(1)
        val lastWhole = event.to.atZone(zone).toLocalDate().minusDays(1)
        val whole = !firstWhole.isAfter(lastWhole)
        return linkedMapOf(
            "stream" to JsonPrimitive(event.stream),
            "from" to JsonPrimitive(event.from.toString()),
            "to" to JsonPrimitive(event.to.toString()),
            "fromDay" to nullable(if (whole) firstWhole.toString() else null),
            "toDay" to nullable(if (whole) lastWhole.toString() else null),
            "complete" to JsonPrimitive(event.complete),
            "reason" to JsonPrimitive(event.reason),
        )
    }

    private fun metric(
        kind: MeasurementKind,
        value: Double,
        observedAt: Instant,
        receivedAt: Instant,
        provenance: String,
        extra: Map<String, JsonElement> = emptyMap(),
    ): Mapped = mapped(
        type = "health.metric.observed",
        subject = kind.key,
        topicSuffix = "metrics/${kind.key}",
        observedAt = observedAt,
        receivedAt = receivedAt,
        values = linkedMapOf(
            "metric" to JsonPrimitive(kind.key),
            "value" to JsonPrimitive(value),
            "unit" to JsonPrimitive(kind.unit),
            "provenance" to JsonPrimitive(provenance),
            "quality" to JsonPrimitive("unverified"),
        ) + extra,
    )

    private fun mapped(
        type: String,
        subject: String,
        topicSuffix: String,
        observedAt: Instant,
        receivedAt: Instant,
        values: Map<String, JsonElement>,
        retain: Boolean = false,
    ): Mapped {
        val data = buildJsonObject {
            put("schema_version", 1)
            put("observed_at", observedAt.toString())
            put("received_at", receivedAt.toString())
            for ((key, value) in values) put(key, value)
        }
        return Mapped(type, subject, topicSuffix, observedAt, data, retain)
    }

    private fun nullable(value: String?): JsonElement = value?.let(::JsonPrimitive) ?: JsonNull

    internal fun safeTopicSegment(value: String): String = value.lowercase()
        .replace(Regex("[^a-z0-9_-]+"), "_")
        .trim('_')
        .ifBlank { "unknown" }

    internal fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
