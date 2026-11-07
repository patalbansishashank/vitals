package com.pulseloop.hub

import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.data.dao.HubOutboxDao
import com.pulseloop.data.entity.HubOutboxEntity
import com.pulseloop.data.sources.ActivityAcquisitionEntity
import com.pulseloop.data.sources.ActivitySourceDao
import com.pulseloop.data.sources.ActivityTransitionEntity
import java.time.Instant
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The Activity Recognition upload plug-in (auto-detection CONTRACT §1, Gauge 2.8.3), on the phone-step
 * outbox/cursor pattern ([HubPhoneStepsSource]): `phone/activity_transition` events and closed
 * `phone/activity_recognition_acquisition` intervals from the sources database, each stream with its own
 * `seq` cursor, paged.
 *
 * - A transition's subject is its activity; its event time and `observed_at` are `occurred_at`. Its id is
 *   a hash of installation + boot_id + elapsed_ns + activity + transition only, so the same event is the
 *   same id however often (or with whatever anchor or epoch) it is re-queued.
 * - `elapsed_ns` is a decimal string: elapsed nanoseconds pass 2^53 after about 104 days of uptime.
 * - `observed_at` and `received_at` are the hub envelope's own fields, required on every event.
 */
class HubActivityRecognitionSource(
    private val store: Store,
    private val outbox: HubOutboxDao,
    private val settings: HubSettingsSource,
    private val transitionsCursor: HubSourceCursor,
    private val acquisitionCursor: HubSourceCursor,
    private val now: () -> Instant = Instant::now,
    private val pageSize: Int = 200,
    private val maxPagesPerCall: Int = 10,
) : HubUploadSource {

    interface Store {
        suspend fun transitionsAfter(afterSeq: Long, limit: Int): List<ActivityTransitionEntity>
        suspend fun closedIntervalsAfter(afterSeq: Long, limit: Int): List<ActivityAcquisitionEntity>
    }

    class DaoStore(private val dao: ActivitySourceDao) : Store {
        override suspend fun transitionsAfter(afterSeq: Long, limit: Int) = dao.transitionsAfter(afterSeq, limit)
        override suspend fun closedIntervalsAfter(afterSeq: Long, limit: Int) = dao.closedIntervalsAfter(afterSeq, limit)
    }

    override fun reset() {
        transitionsCursor.value = null
        acquisitionCursor.value = null
    }

    override suspend fun enqueueChanged(): Int {
        if (settings.pairing.value == null) return 0
        val installation = settings.installationId
        var queued = 0
        var pages = 0
        while (pages < maxPagesPerCall) {
            val after = transitionsCursor.value?.toLongOrNull() ?: 0L
            val page = store.transitionsAfter(after, pageSize)
            if (page.isEmpty()) break
            pages++
            val receivedAt = now()
            outbox.enqueueAll(page.map { transitionEvent(it, installation, receivedAt) })
            queued += page.size
            transitionsCursor.value = page.last().seq.toString()
            if (page.size < pageSize) break
        }
        while (pages < maxPagesPerCall) {
            val after = acquisitionCursor.value?.toLongOrNull() ?: 0L
            val page = store.closedIntervalsAfter(after, pageSize)
            if (page.isEmpty()) break
            pages++
            val receivedAt = now()
            outbox.enqueueAll(page.mapNotNull { acquisitionEvent(it, installation, receivedAt) })
            queued += page.size
            acquisitionCursor.value = page.last().seq.toString()
            if (page.size < pageSize) break
        }
        return queued
    }

    companion object {
        const val TRANSITION_TYPE = "com.pulseloop.phone.activity_transition.v1"
        const val TRANSITION_CATEGORY = "phone/activity_transition"
        const val ACQUISITION_TYPE = "com.pulseloop.phone.activity_recognition_acquisition.v1"
        const val ACQUISITION_CATEGORY = "phone/activity_recognition_acquisition"
        const val ACQUISITION_SUBJECT = "activity_recognition_acquisition"
        const val TRANSITIONS_CURSOR_KEY = "activity_transitions.v1"
        const val ACQUISITION_CURSOR_KEY = "activity_recognition_acquisition.v1"

        fun transitionData(t: ActivityTransitionEntity): JsonObject {
            val occurred = Instant.ofEpochMilli(t.occurredAtMs).toString()
            return buildJsonObject {
                put("schema_version", 1)
                put("observed_at", occurred)
                put("activity", t.activity)
                put("transition", t.transition)
                put("occurred_at", occurred)
                put("boot_id", t.bootId)
                put("elapsed_ns", t.elapsedNs.toString())
                put("registration_epoch", t.registrationEpoch)
            }
        }

        /** The contract's stable identity: installation + boot_id + elapsed_ns + activity + transition. */
        fun transitionEventId(t: ActivityTransitionEntity, installationId: String): String =
            "pl-" + BroadcastEventMapper.sha256("$TRANSITION_TYPE|$installationId|${t.bootId}|${t.elapsedNs}|${t.activity}|${t.transition}").take(40)

        fun transitionEvent(t: ActivityTransitionEntity, installationId: String, receivedAt: Instant): HubOutboxEntity =
            HubSourceEvents.event(
                TRANSITION_TYPE, TRANSITION_CATEGORY, t.activity, Instant.ofEpochMilli(t.occurredAtMs), transitionData(t),
                installationId, receivedAt, eventId = transitionEventId(t, installationId),
            )

        fun acquisitionEvent(i: ActivityAcquisitionEntity, installationId: String, receivedAt: Instant): HubOutboxEntity? {
            val to = i.toMs ?: return null
            val from = Instant.ofEpochMilli(i.fromMs)
            val data = buildJsonObject {
                put("schema_version", 1)
                put("observed_at", from.toString())
                put("from", from.toString())
                put("to", Instant.ofEpochMilli(to).toString())
                put("state", i.state)
                put("registration_epoch", i.registrationEpoch)
            }
            return HubSourceEvents.event(ACQUISITION_TYPE, ACQUISITION_CATEGORY, ACQUISITION_SUBJECT, from, data, installationId, receivedAt)
        }
    }
}
