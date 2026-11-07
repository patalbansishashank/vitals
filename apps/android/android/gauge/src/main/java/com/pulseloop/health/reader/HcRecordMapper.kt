package com.pulseloop.health.reader

import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseRouteResult
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.PowerRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.SpeedRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * One Health Connect record reduced to what the `hc/record` event carries (energy SPEC §2.1).
 * The reader works on these, never on platform records, so its tests need no Health Connect.
 */
data class HcRecordView(
    val type: HcType,
    val id: String,
    val originPackage: String,
    val device: DeviceInfo?,
    val recordingMethod: Int,
    val clientRecordId: String?,
    val lastModified: Instant,
    val start: Instant,
    val end: Instant,
    val startOffsetMin: Int?,
    val endOffsetMin: Int?,
    val payload: JsonObject,
) {
    data class DeviceInfo(val type: Int, val manufacturer: String?, val model: String?)

    /** The event subject and the store key: `<recordType>:<hcRecordId>`. */
    val key: String get() = HcRecordMapper.key(type, id)
}

object HcRecordMapper {
    /** Gauge's own package (release and `.debug`). */
    const val OWN_PACKAGE_PREFIX = "com.pulseloop"
    /** Every record Gauge writes to Health Connect has a client record id with this prefix. */
    const val OWN_CLIENT_ID_PREFIX = "pl-"

    fun key(type: HcType, id: String): String = "${type.recordType}:$id"

    /**
     * Gauge's own exports never travel back (SPEC §2.1): origin `com.pulseloop` (or its debug
     * build), or a client record id starting `pl-`.
     */
    fun isOwn(view: HcRecordView): Boolean =
        view.originPackage == OWN_PACKAGE_PREFIX || view.originPackage.startsWith("$OWN_PACKAGE_PREFIX.") ||
            view.clientRecordId?.startsWith(OWN_CLIENT_ID_PREFIX) == true

    /** The event `data`, minus `received_at` (the uploader adds it). */
    fun data(view: HcRecordView, nativeOrigins: Set<String>): JsonObject = buildJsonObject {
        put("schema_version", 1)
        put("observed_at", view.start.toString())
        put("record_type", view.type.recordType)
        put("origin_package", view.originPackage)
        put("origin_is_device_native", view.originPackage in nativeOrigins)
        view.device?.let { d ->
            putJsonObject("device") {
                put("type", deviceType(d.type))
                d.manufacturer?.let { put("manufacturer", it) }
                d.model?.let { put("model", it) }
            }
        }
        put("recording_method", recordingMethod(view.recordingMethod))
        view.clientRecordId?.let { put("client_record_id", it) }
        put("last_modified", view.lastModified.toString())
        put("start", view.start.toString())
        put("end", view.end.toString())
        putJsonObject("zone_offsets") {
            view.startOffsetMin?.let { put("start_min", it) }
            view.endOffsetMin?.let { put("end_min", it) }
        }
        put("payload", view.payload)
    }

    fun recordingMethod(method: Int): String = when (method) {
        Metadata.RECORDING_METHOD_ACTIVELY_RECORDED -> "activelyRecorded"
        Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED -> "automaticallyRecorded"
        Metadata.RECORDING_METHOD_MANUAL_ENTRY -> "manualEntry"
        else -> "unknown"
    }

    fun deviceType(type: Int): String = when (type) {
        Device.TYPE_PHONE -> "phone"
        Device.TYPE_WATCH -> "watch"
        Device.TYPE_RING -> "ring"
        Device.TYPE_SCALE -> "scale"
        Device.TYPE_FITNESS_BAND -> "fitnessBand"
        Device.TYPE_CHEST_STRAP -> "chestStrap"
        Device.TYPE_HEAD_MOUNTED -> "headMounted"
        Device.TYPE_SMART_DISPLAY -> "smartDisplay"
        else -> "unknown"
    }

    /** A platform record → its view, or null for a type Gauge does not read. */
    fun view(record: Record): HcRecordView? {
        val m = record.metadata
        fun build(type: HcType, start: Instant, end: Instant, so: ZoneOffset?, eo: ZoneOffset?, payload: JsonObject) = HcRecordView(
            type = type,
            id = m.id,
            originPackage = m.dataOrigin.packageName,
            device = m.device?.let { HcRecordView.DeviceInfo(it.type, it.manufacturer, it.model) },
            recordingMethod = m.recordingMethod,
            clientRecordId = m.clientRecordId,
            lastModified = m.lastModifiedTime,
            start = start,
            end = end,
            startOffsetMin = so?.totalSeconds?.div(60),
            endOffsetMin = eo?.totalSeconds?.div(60),
            payload = payload,
        )
        return when (record) {
            is StepsRecord -> build(HcType.STEPS, record.startTime, record.endTime, record.startZoneOffset, record.endZoneOffset,
                buildJsonObject { put("count", record.count) })
            is DistanceRecord -> build(HcType.DISTANCE, record.startTime, record.endTime, record.startZoneOffset, record.endZoneOffset,
                buildJsonObject { put("m", record.distance.inMeters) })
            is SpeedRecord -> build(HcType.SPEED, record.startTime, record.endTime, record.startZoneOffset, record.endZoneOffset,
                buildJsonObject {
                    putJsonArray("samples") {
                        record.samples.forEach { s -> addJsonObject { put("t", s.time.toString()); put("mps", s.speed.inMetersPerSecond) } }
                    }
                })
            is PowerRecord -> build(HcType.POWER, record.startTime, record.endTime, record.startZoneOffset, record.endZoneOffset,
                buildJsonObject {
                    putJsonArray("samples") {
                        record.samples.forEach { s -> addJsonObject { put("t", s.time.toString()); put("w", s.power.inWatts) } }
                    }
                })
            is HeartRateRecord -> build(HcType.HEART_RATE, record.startTime, record.endTime, record.startZoneOffset, record.endZoneOffset,
                buildJsonObject {
                    putJsonArray("samples") {
                        record.samples.forEach { s -> addJsonObject { put("t", s.time.toString()); put("bpm", s.beatsPerMinute) } }
                    }
                })
            is ExerciseSessionRecord -> build(HcType.EXERCISE_SESSION, record.startTime, record.endTime, record.startZoneOffset, record.endZoneOffset,
                exercisePayload(record))
            is ActiveCaloriesBurnedRecord -> build(HcType.ACTIVE_CALORIES, record.startTime, record.endTime, record.startZoneOffset, record.endZoneOffset,
                buildJsonObject { put("kcal", record.energy.inKilocalories) })
            is TotalCaloriesBurnedRecord -> build(HcType.TOTAL_CALORIES, record.startTime, record.endTime, record.startZoneOffset, record.endZoneOffset,
                buildJsonObject { put("kcal", record.energy.inKilocalories) })
            is BasalMetabolicRateRecord -> build(HcType.BASAL_METABOLIC_RATE, record.time, record.time, record.zoneOffset, record.zoneOffset,
                buildJsonObject { put("kcal_per_day", record.basalMetabolicRate.inKilocaloriesPerDay) })
            is WeightRecord -> build(HcType.WEIGHT, record.time, record.time, record.zoneOffset, record.zoneOffset,
                buildJsonObject { put("kg", record.weight.inKilograms) })
            is RestingHeartRateRecord -> build(HcType.RESTING_HEART_RATE, record.time, record.time, record.zoneOffset, record.zoneOffset,
                buildJsonObject { put("bpm", record.beatsPerMinute) })
            is SleepSessionRecord -> build(HcType.SLEEP_SESSION, record.startTime, record.endTime, record.startZoneOffset, record.endZoneOffset,
                buildJsonObject {
                    putJsonArray("stages") {
                        record.stages.forEach { s ->
                            addJsonObject {
                                put("start", s.startTime.toString())
                                put("end", s.endTime.toString())
                                put("stage", sleepStage(s.stage))
                            }
                        }
                    }
                })
            else -> null
        }
    }

    /**
     * Routes are never silently assumed (SPEC §GB.2): only the route's state is reported. Gauge
     * does not request `READ_EXERCISE_ROUTES`, so a route usually reads as `consentRequired`.
     */
    internal fun routeState(result: ExerciseRouteResult): String = when (result) {
        is ExerciseRouteResult.Data -> "available"
        is ExerciseRouteResult.ConsentRequired -> "consentRequired"
        else -> "none"
    }

    private fun exercisePayload(record: ExerciseSessionRecord): JsonObject = buildJsonObject {
        put("exercise_type", exerciseType(record.exerciseType))
        put("exercise_type_code", record.exerciseType)
        record.title?.let { put("title", it) }
        putJsonArray("segments") {
            record.segments.forEach { s ->
                addJsonObject {
                    put("start", s.startTime.toString())
                    put("end", s.endTime.toString())
                    put("type", s.segmentType)
                    put("repetitions", s.repetitions)
                }
            }
        }
        putJsonArray("laps") {
            record.laps.forEach { l ->
                addJsonObject {
                    put("start", l.startTime.toString())
                    put("end", l.endTime.toString())
                    l.length?.let { put("length_m", it.inMeters) }
                }
            }
        }
        put("route_state", routeState(record.exerciseRouteResult))
    }

    private fun exerciseType(code: Int): String =
        runCatching { ExerciseSessionRecord.EXERCISE_TYPE_INT_TO_STRING_MAP[code] }.getOrNull() ?: "type_$code"

    private fun sleepStage(code: Int): String = when (code) {
        SleepSessionRecord.STAGE_TYPE_AWAKE -> "awake"
        SleepSessionRecord.STAGE_TYPE_SLEEPING -> "sleeping"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "outOfBed"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "awakeInBed"
        else -> "unknown"
    }
}
