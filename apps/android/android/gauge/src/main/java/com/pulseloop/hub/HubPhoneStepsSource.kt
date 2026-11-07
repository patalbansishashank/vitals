package com.pulseloop.hub

import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.broadcasting.PulseCloudEvent
import com.pulseloop.data.dao.HubOutboxDao
import com.pulseloop.data.entity.HubOutboxEntity
import com.pulseloop.data.sources.PhoneAcquisitionEntity
import com.pulseloop.data.sources.PhoneSourceDao
import com.pulseloop.data.sources.PhoneStepRecordEntity
import java.time.Instant
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The phone step counter's upload plug-in (energy SPEC §2.1, package GB): `activity/phone_steps`
 * records and closed `phone/acquisition` intervals from the sources database, each stream with its
 * own `seq` cursor. Paged ([pageSize] rows, at most [maxPagesPerCall] pages per call), so a long
 * stretch of minute records reaches the outbox in bounded slices between upload batches.
 *
 * `m_start_ns` / `m_end_ns` travel as decimal strings: elapsed nanoseconds pass 2^53 after about
 * 104 days of uptime, beyond what a JSON number keeps exactly.
 *
 * **Checkpoints (Gauge 2.8.3, auto-detection CONTRACT §1).** Closed intervals still roll hourly, so on
 * their own the server would learn about a live walk or an observed-zero stretch up to an hour late. While
 * an interval is open, each call may also queue a checkpoint of it — `to` = the last moment the state is
 * known to have held (the step counter touches it every minute while listening, so ≈ now), `open: true` —
 * at most once per [checkpointEveryMs] and only when that moment has moved. A checkpoint has the closed
 * interval's subject and `observed_at` (its `from`), so the server's current-event rule replaces it with
 * each later checkpoint and finally with the closed interval. `to` is never wall-clock now: after a process
 * death the open interval is stale, and claiming listening up to now would invent observed zeros.
 */
class HubPhoneStepsSource(
    private val phone: Store,
    private val outbox: HubOutboxDao,
    private val settings: HubSettingsSource,
    private val recordsCursor: HubSourceCursor,
    private val acquisitionCursor: HubSourceCursor,
    private val now: () -> Instant = Instant::now,
    private val pageSize: Int = 200,
    private val maxPagesPerCall: Int = 10,
    /** Where the open-interval checkpoints are up to (`<seq>:<toMs>:<queuedAtMs>`); null = no checkpoints. */
    private val checkpointCursor: HubSourceCursor? = null,
    private val checkpointEveryMs: Long = CHECKPOINT_EVERY_MS,
) : HubUploadSource {

    interface Store {
        suspend fun recordsAfter(afterSeq: Long, limit: Int): List<PhoneStepRecordEntity>
        suspend fun closedIntervalsAfter(afterSeq: Long, limit: Int): List<PhoneAcquisitionEntity>
        suspend fun openInterval(): PhoneAcquisitionEntity? = null
    }

    class DaoStore(private val dao: PhoneSourceDao) : Store {
        override suspend fun recordsAfter(afterSeq: Long, limit: Int) = dao.recordsAfter(afterSeq, limit)
        override suspend fun closedIntervalsAfter(afterSeq: Long, limit: Int) = dao.closedIntervalsAfter(afterSeq, limit)
        override suspend fun openInterval() = dao.openInterval()
    }

    override fun reset() {
        recordsCursor.value = null
        acquisitionCursor.value = null
        checkpointCursor?.value = null
    }

    override suspend fun enqueueChanged(): Int {
        if (settings.pairing.value == null) return 0
        val installation = settings.installationId
        var queued = 0
        var pages = 0
        while (pages < maxPagesPerCall) {
            val after = recordsCursor.value?.toLongOrNull() ?: 0L
            val page = phone.recordsAfter(after, pageSize)
            if (page.isEmpty()) break
            pages++
            val receivedAt = now()
            outbox.enqueueAll(page.map { stepsEvent(it, installation, receivedAt) })
            queued += page.size
            recordsCursor.value = page.last().seq.toString()
            if (page.size < pageSize) break
        }
        while (pages < maxPagesPerCall) {
            val after = acquisitionCursor.value?.toLongOrNull() ?: 0L
            val page = phone.closedIntervalsAfter(after, pageSize)
            if (page.isEmpty()) break
            pages++
            val receivedAt = now()
            outbox.enqueueAll(page.mapNotNull { acquisitionEvent(it, installation, receivedAt) })
            queued += page.size
            acquisitionCursor.value = page.last().seq.toString()
            if (page.size < pageSize) break
        }
        queued += enqueueCheckpoint(installation)
        return queued
    }

    /** At most one checkpoint of the open interval per [checkpointEveryMs], only when its end has moved. */
    private suspend fun enqueueCheckpoint(installation: String): Int {
        val cursor = checkpointCursor ?: return 0
        val open = phone.openInterval() ?: return 0
        val at = now()
        val nowMs = at.toEpochMilli()
        val to = open.lastSeenMs.coerceAtMost(nowMs)
        if (to <= open.fromMs) return 0
        val last = cursor.value?.split(':')?.mapNotNull { it.toLongOrNull() }?.takeIf { it.size == 3 }
        if (last != null) {
            val (seq, lastTo, queuedAt) = last
            if (seq == open.seq && to <= lastTo) return 0
            // The tolerance absorbs WorkManager start jitter between two five-minute requests, which would
            // otherwise skip a whole period now and then.
            if (nowMs >= queuedAt && nowMs - queuedAt < checkpointEveryMs - CHECKPOINT_JITTER_MS) return 0
        }
        val event = acquisitionEvent(open, installation, at, checkpointTo = to) ?: return 0
        outbox.enqueue(event)
        cursor.value = "${open.seq}:$to:$nowMs"
        return 1
    }

    companion object {
        const val STEPS_TYPE = "com.pulseloop.activity.phone_steps.v1"
        const val STEPS_CATEGORY = "activity/phone_steps"
        const val ACQUISITION_TYPE = "com.pulseloop.phone.acquisition.v1"
        const val ACQUISITION_CATEGORY = "phone/acquisition"
        const val ACQUISITION_SUBJECT = "phone_acquisition"
        const val RECORDS_CURSOR_KEY = "phone_steps.v1"
        const val ACQUISITION_CURSOR_KEY = "phone_acquisition.v1"
        const val CHECKPOINT_CURSOR_KEY = "phone_acquisition_checkpoint.v1"
        /** CONTRACT §1: observed zeros and live walks reach the server within about five minutes. */
        const val CHECKPOINT_EVERY_MS = 5 * 60_000L
        const val CHECKPOINT_JITTER_MS = 30_000L

        fun stepsData(r: PhoneStepRecordEntity): JsonObject = buildJsonObject {
            put("schema_version", 1)
            put("observed_at", Instant.ofEpochMilli(r.startMs).toString())
            put("start", Instant.ofEpochMilli(r.startMs).toString())
            put("end", Instant.ofEpochMilli(r.endMs).toString())
            put("steps", r.steps)
            put("support", r.support)
            put("timing", r.timing)
            r.parentSteps?.let { put("parent_steps", it) }
            put("boot_id", r.bootId)
            put("m_start_ns", r.mStartNs.toString())
            put("m_end_ns", r.mEndNs.toString())
            put("utc_anchor_id", r.anchorId)
        }

        fun stepsEvent(r: PhoneStepRecordEntity, installationId: String, receivedAt: Instant): HubOutboxEntity =
            HubSourceEvents.event(STEPS_TYPE, STEPS_CATEGORY, r.subject, Instant.ofEpochMilli(r.startMs), stepsData(r), installationId, receivedAt)

        /**
         * A closed interval, or with [checkpointTo] a checkpoint of the open one (`to` = [checkpointTo],
         * `open: true`); an open interval without it is not an event.
         */
        fun acquisitionEvent(i: PhoneAcquisitionEntity, installationId: String, receivedAt: Instant, checkpointTo: Long? = null): HubOutboxEntity? {
            val to = (if (i.toMs == null) checkpointTo else i.toMs) ?: return null
            val from = Instant.ofEpochMilli(i.fromMs)
            val data = buildJsonObject {
                put("schema_version", 1)
                put("observed_at", from.toString())
                put("from", from.toString())
                put("to", Instant.ofEpochMilli(to).toString())
                put("state", i.state)
                // 2.8.1: a listening interval says whether the step detector was actually registered.
                // Registered = every step in it is timed, so a minute no phone_steps record covers is
                // observed zero. Rows from before 2.8.1 carry neither field (unknown, as before).
                if (i.state == com.pulseloop.phone.PhoneAcquisitionLog.LISTENING && i.detector != null) {
                    put("detector", i.detector)
                    put("observed_zero", i.detector == com.pulseloop.phone.PhoneAcquisitionLog.DETECTOR_REGISTERED)
                }
                if (i.toMs == null) put("open", true)
            }
            return HubSourceEvents.event(ACQUISITION_TYPE, ACQUISITION_CATEGORY, ACQUISITION_SUBJECT, from, data, installationId, receivedAt)
        }
    }
}

/**
 * The hub envelope for the phone and Health Connect sources: the shared CloudEvents envelope plus
 * `category` (SPEC §2.1), with a deterministic id over type, subject, observation time and data
 * (`received_at` excluded), so a re-queued row is the same event and the server counts it once.
 */
internal object HubSourceEvents {
    fun event(
        type: String,
        category: String,
        subject: String,
        observedAt: Instant,
        identity: JsonObject,
        installationId: String,
        receivedAt: Instant,
        /** An id the category's contract fixes over fewer fields than its data (activity transitions). */
        eventId: String? = null,
    ): HubOutboxEntity {
        val data = JsonObject(identity.filterKeys { it != "received_at" } + ("received_at" to kotlinx.serialization.json.JsonPrimitive(receivedAt.toString())))
        val identityOnly = JsonObject(identity.filterKeys { it != "received_at" })
        val eventId = eventId ?: ("pl-" + BroadcastEventMapper.sha256("$type|$subject|$observedAt|$identityOnly").take(40))
        val envelope = PulseCloudEvent(
            id = eventId,
            type = type,
            source = "urn:pulseloop:installation:$installationId",
            subject = subject,
            time = observedAt.toString(),
            data = data,
            category = category,
        )
        return HubOutboxEntity(
            eventId = eventId,
            category = category,
            payloadJson = BroadcastEventMapper.json.encodeToString(envelope),
            createdAt = receivedAt.toEpochMilli(),
        )
    }
}
