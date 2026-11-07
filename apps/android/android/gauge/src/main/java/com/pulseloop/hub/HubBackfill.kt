package com.pulseloop.hub

import androidx.room.withTransaction
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.DerivedUpdateEntity
import com.pulseloop.data.entity.MeasurementEntity
import com.pulseloop.data.entity.SleepSessionEntity
import com.pulseloop.data.entity.SleepStageBlockEntity
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.ring.PulseEvent
import com.pulseloop.ring.SleepStage
import com.pulseloop.ring.StepSupport
import java.time.Instant
import kotlin.math.roundToInt
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * First-pair backfill: walks the whole stored history — measurements (incl. vendor metrics and
 * blood pressure), daily activity, activity buckets, sleep timelines, local insights/scores and the
 * current device state — through the same mapper as live events into the hub outbox.
 *
 * It is throttled rather than dumped: the uploader calls [fillIfNeeded] before every batch, and a
 * chunk is produced only while fewer than [LOW_WATER] events are waiting. So a years-long history
 * never sits in the outbox all at once (each row holds a full JSON payload), the work runs on the
 * upload worker rather than the UI, and a resume cursor in [HubSettingsSource] survives process
 * death. Re-enqueueing a chunk after a crash is harmless: ids are deterministic and inserts ignore
 * duplicates. Demo rows are never uploaded.
 */
class HubBackfill(
    private val db: PulseLoopDatabase,
    private val settings: HubSettingsSource,
    private val now: () -> Instant = Instant::now,
    private val chunkSize: Int = 250,
) {
    private enum class Stage { MEASUREMENTS, ACTIVITY_DAILY, ACTIVITY_BUCKETS, SLEEP, INSIGHTS, DEVICE, DONE }

    private data class Cursor(val stage: Stage, val key: Long = Long.MIN_VALUE, val id: String = "") {
        fun encode() = "${stage.name}|$key|$id"
        companion object {
            fun decode(raw: String?): Cursor {
                if (raw.isNullOrBlank()) return Cursor(Stage.MEASUREMENTS)
                val parts = raw.split('|', limit = 3)
                val stage = runCatching { Stage.valueOf(parts[0]) }.getOrNull() ?: return Cursor(Stage.MEASUREMENTS)
                return Cursor(stage, parts.getOrNull(1)?.toLongOrNull() ?: Long.MIN_VALUE, parts.getOrNull(2).orEmpty())
            }
        }
    }

    /** Top the outbox up to [LOW_WATER]; returns true once the whole history has been enqueued. */
    suspend fun fillIfNeeded(): Boolean {
        if (settings.pairing.value == null) return false
        if (settings.status.value.backfillDone) return true
        var guard = 0
        while (db.hubOutboxDao().pendingCount() < LOW_WATER && guard++ < MAX_CHUNKS_PER_CALL) {
            if (runChunk()) return true
        }
        return settings.status.value.backfillDone
    }

    /** One chunk of the current stage. Returns true when the backfill is complete. */
    internal suspend fun runChunk(): Boolean {
        val cursor = Cursor.decode(settings.backfillCursor)
        if (cursor.stage == Stage.DONE) {
            settings.saveBackfillCursor(cursor.encode(), done = true)
            return true
        }
        val installationId = settings.installationId
        val receivedAt = now()
        val (events, next) = when (cursor.stage) {
            Stage.MEASUREMENTS -> measurements(cursor)
            Stage.ACTIVITY_DAILY -> activityDaily(cursor)
            Stage.ACTIVITY_BUCKETS -> activityBuckets(cursor)
            Stage.SLEEP -> sleep(cursor)
            Stage.INSIGHTS -> insights(cursor)
            Stage.DEVICE -> device() to Cursor(Stage.DONE)
            Stage.DONE -> emptyList<PulseEvent>() to cursor
        }
        val rows = events.mapNotNull { HubEventMapper.toHubOutbox(it, installationId, receivedAt) }
        if (rows.isNotEmpty()) db.withTransaction { db.hubOutboxDao().enqueueAll(rows) }
        val done = next.stage == Stage.DONE
        settings.saveBackfillCursor(next.encode(), done)
        return done
    }

    private suspend fun measurements(cursor: Cursor): Pair<List<PulseEvent>, Cursor> {
        val dao = db.hubBackfillDao()
        val rows = dao.measurementsAfter(cursor.key, cursor.id, chunkSize)
        if (rows.isEmpty()) return emptyList<PulseEvent>() to Cursor(Stage.ACTIVITY_DAILY)
        val events = rows.mapNotNull { measurementEvent(it) }
        val last = rows.last()
        return events to Cursor(Stage.MEASUREMENTS, last.timestamp, last.id)
    }

    private suspend fun measurementEvent(row: MeasurementEntity): PulseEvent? {
        val at = Instant.ofEpochMilli(row.timestamp)
        if (!row.value.isFinite()) return null
        if (row.kindRaw.startsWith("VENDOR_")) {
            return PulseEvent.VendorMetric(
                key = row.kindRaw.removePrefix("VENDOR_").lowercase(),
                value = row.value,
                unit = row.unit,
                timestamp = at,
                isHistory = row.sourceRaw != "vendor_live",
            )
        }
        val kind = runCatching { MeasurementKind.valueOf(row.kindRaw) }.getOrNull() ?: return null
        val dao = db.hubBackfillDao()
        when (kind) {
            MeasurementKind.BLOOD_PRESSURE_SYSTOLIC -> {
                val diastolic = dao.measurementAt(MeasurementKind.BLOOD_PRESSURE_DIASTOLIC.name, row.timestamp)
                if (diastolic != null) {
                    return PulseEvent.BloodPressureSample(
                        systolic = row.value.roundToInt(),
                        diastolic = diastolic.value.roundToInt(),
                        timestamp = at,
                        isHistory = row.sourceRaw == "history",
                    )
                }
            }
            // Travels with its systolic row as one reading; alone it falls through as a sample.
            MeasurementKind.BLOOD_PRESSURE_DIASTOLIC ->
                if (dao.measurementAt(MeasurementKind.BLOOD_PRESSURE_SYSTOLIC.name, row.timestamp) != null) return null
            else -> Unit
        }
        val provenance = provenanceFor(row.sourceRaw, row.cadenceS)
        return PulseEvent.HistoryMeasurement(
            kind, row.value, at, provenance = provenance,
            cadenceS = com.pulseloop.ring.HrProvenance.workoutCadence(provenance, row.cadenceS),
        )
    }

    private suspend fun activityDaily(cursor: Cursor): Pair<List<PulseEvent>, Cursor> {
        val rows = db.hubBackfillDao().activityDailyAfter(cursor.key, cursor.id, chunkSize)
        if (rows.isEmpty()) return emptyList<PulseEvent>() to Cursor(Stage.ACTIVITY_BUCKETS)
        val events = rows.map {
            PulseEvent.ActivityUpdate(
                timestamp = Instant.ofEpochMilli(it.date),
                steps = it.steps,
                distanceMeters = it.distanceMeters,
                calories = it.calories,
                activeMinutes = it.activeMinutes,
            )
        }
        return events to Cursor(Stage.ACTIVITY_DAILY, rows.last().date, rows.last().id)
    }

    private suspend fun activityBuckets(cursor: Cursor): Pair<List<PulseEvent>, Cursor> {
        val rows = db.hubBackfillDao().activityBucketsAfter(cursor.key, chunkSize)
        if (rows.isEmpty()) return emptyList<PulseEvent>() to Cursor(Stage.SLEEP)
        // GA.7: a pre-v36 row (support legacyUnknown) re-sends the exact legacy event; a row the
        // new decoder wrote re-sends its native support and its own stored ring.
        val events = rows.map { row ->
            val support = StepSupport.fromWire(row.support)
            if (support == StepSupport.LEGACY_UNKNOWN || row.durationS == null) {
                PulseEvent.ActivityBucket(Instant.ofEpochMilli(row.startEpoch), row.steps, row.distanceMeters)
            } else {
                PulseEvent.ActivityBucket(
                    Instant.ofEpochMilli(row.startEpoch), row.steps, row.distanceMeters,
                    durationS = row.durationS,
                    support = support,
                    parentTotalSteps = row.parentTotal,
                    parentRecordStart = row.parentStart?.let(Instant::ofEpochMilli),
                    deviceKey = row.deviceKey,
                )
            }
        }
        return events to Cursor(Stage.ACTIVITY_BUCKETS, rows.last().startEpoch)
    }

    private suspend fun sleep(cursor: Cursor): Pair<List<PulseEvent>, Cursor> {
        val sessions = db.hubBackfillDao().sleepSessionsAfter(cursor.key, cursor.id, SLEEP_SESSIONS_PER_CHUNK)
        if (sessions.isEmpty()) return emptyList<PulseEvent>() to Cursor(Stage.INSIGHTS)
        val blocks = db.hubBackfillDao().stageBlocksFor(sessions.map { it.id }).groupBy { it.sessionId }
        val events = sessions.flatMap { session -> sleepTimelines(session, blocks[session.id].orEmpty()) }
        return events to Cursor(Stage.SLEEP, sessions.last().startAt, sessions.last().id)
    }

    private suspend fun insights(cursor: Cursor): Pair<List<PulseEvent>, Cursor> {
        val rows = db.hubBackfillDao().insightsAfter(cursor.id, chunkSize)
        if (rows.isEmpty()) return emptyList<PulseEvent>() to Cursor(Stage.DEVICE)
        return rows.mapNotNull(::insightEvent) to Cursor(Stage.INSIGHTS, 0, rows.last().id)
    }

    private suspend fun device(): List<PulseEvent> {
        val device = db.deviceDao().currentReal() ?: return emptyList()
        return buildList {
            add(PulseEvent.DeviceIdentified(device.deviceType, device.wearableModelID, null, device.capabilities))
            device.batteryPercent?.let { add(PulseEvent.BatteryLevel(it)) }
            add(PulseEvent.DeviceStateChanged(device.state, address = null, firmware = device.firmwareVersion))
        }
    }

    companion object {
        /** Produce more history only while fewer than this many events wait to upload. */
        const val LOW_WATER = 1_000
        private const val MAX_CHUNKS_PER_CALL = 20
        private const val SLEEP_SESSIONS_PER_CHUNK = 30
        private val json = Json { ignoreUnknownKeys = true }

        /**
         * The upload provenance of a stored row. A stored cadence marks a workout reading (v37,
         * [com.pulseloop.ring.HrProvenance]): a ring workout-stream row re-sends as
         * `workout_history`, a live sample recorded during a workout as `device_workout`. Without
         * one, nothing changes — all-day history never becomes a workout reading here.
         */
        internal fun provenanceFor(sourceRaw: String, cadenceS: Int? = null): String = when (sourceRaw) {
            "vendor_history" -> "vendor_history"
            "spot" -> "device_spot"
            "live", "colmi" -> if (cadenceS != null && sourceRaw == "live") com.pulseloop.ring.HrProvenance.DEVICE_WORKOUT else "device_live"
            else -> if (cadenceS != null && sourceRaw == "history") com.pulseloop.ring.HrProvenance.WORKOUT_HISTORY else "device_history"
        }

        /** One timeline per contiguous run of stage blocks (a gap starts a new run). */
        internal fun sleepTimelines(session: SleepSessionEntity, blocks: List<SleepStageBlockEntity>): List<PulseEvent.SleepTimeline> {
            val runs = mutableListOf<MutableList<SleepStageBlockEntity>>()
            for (block in blocks.filter { it.durationMinutes > 0 }.sortedBy { it.startAt }) {
                val current = runs.lastOrNull()
                val previous = current?.last()
                if (previous != null && previous.startAt + previous.durationMinutes * 60_000L == block.startAt) {
                    current.add(block)
                } else {
                    runs += mutableListOf(block)
                }
            }
            return runs.map { run ->
                PulseEvent.SleepTimeline(
                    timestamp = Instant.ofEpochMilli(run.first().startAt),
                    stages = run.flatMap { block ->
                        val stage = runCatching { SleepStage.valueOf(block.stageRaw) }.getOrDefault(SleepStage.UNKNOWN)
                        List(block.durationMinutes) { stage }
                    },
                    completeSession = false,
                )
            }
        }

        internal fun insightEvent(row: DerivedUpdateEntity): PulseEvent.DerivedInsight? {
            if (row.kind in HubEventMapper.RETIRED_INSIGHT_KINDS) return null
            val payload = row.payloadJSON?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() } ?: return null
            val value = payload["value"]?.jsonPrimitive?.doubleOrNull ?: return null
            val scopeStart = runCatching { Instant.parse(row.entityId) }.getOrNull() ?: return null
            fun text(key: String) = runCatching { payload[key]?.jsonPrimitive?.content }.getOrNull()
            return PulseEvent.DerivedInsight(
                key = row.kind,
                value = value,
                unit = text("unit").orEmpty(),
                scopeStart = scopeStart,
                confidence = text("confidence").orEmpty(),
                algorithmVersion = text("algorithm_version").orEmpty(),
                inputs = (payload["inputs"] as? JsonObject)?.mapNotNull { (key, element) ->
                    runCatching { element.jsonPrimitive.doubleOrNull }.getOrNull()?.let { key to it }
                }?.toMap().orEmpty(),
                note = text("note")?.takeIf { it.isNotEmpty() },
            )
        }
    }
}
