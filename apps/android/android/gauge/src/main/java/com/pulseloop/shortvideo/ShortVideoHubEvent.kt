package com.pulseloop.shortvideo

import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.broadcasting.PulseCloudEvent
import com.pulseloop.data.entity.HubOutboxEntity
import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The daily short-video CloudEvent for the home-server outbox (category `habits/short_video`,
 * subject the ISO date). Only counts ever leave the phone.
 *
 * Every update of a day shares `observed_at` (that day's local midnight) and carries the time of
 * its last change as `time`, so the server's "newest time wins for the same category, subject and
 * observed_at" keeps the latest numbers. The id hashes the date and the values: re-sending an
 * unchanged day is a duplicate, a changed one is a new version.
 */
object ShortVideoHubEvent {
    const val TYPE = "habits.short_video.daily.updated"
    const val CATEGORY = "habits/short_video"

    fun eventId(summary: ShortVideoDaySummary): String {
        val canonical = listOf(
            TYPE,
            summary.date.toString(),
            summary.count(ShortVideoApp.INSTAGRAM),
            summary.count(ShortVideoApp.YOUTUBE),
            summary.limit,
            summary.limitHits,
            summary.cancels,
        ).joinToString("|")
        return "pl-" + BroadcastEventMapper.sha256(canonical).take(40)
    }

    fun toHubOutbox(
        summary: ShortVideoDaySummary,
        installationId: String,
        zone: ZoneId = ZoneId.systemDefault(),
        receivedAt: Instant = Instant.now(),
    ): HubOutboxEntity {
        val observedAt = ShortVideoDayClock.startOfDay(summary.date, zone)
        val time = if (summary.updatedAt > 0) Instant.ofEpochMilli(summary.updatedAt) else receivedAt
        val data = buildJsonObject {
            put("schema_version", 1)
            put("observed_at", observedAt.toString())
            put("received_at", receivedAt.toString())
            put("date", summary.date.toString())
            put("counts", buildJsonObject {
                put(ShortVideoApp.INSTAGRAM.key, summary.count(ShortVideoApp.INSTAGRAM))
                put(ShortVideoApp.YOUTUBE.key, summary.count(ShortVideoApp.YOUTUBE))
            })
            put("limit", summary.limit)
            put("limit_hits", summary.limitHits)
            put("cancels", summary.cancels)
        }
        val id = eventId(summary)
        val envelope = PulseCloudEvent(
            id = id,
            type = TYPE,
            source = "urn:pulseloop:installation:$installationId",
            subject = summary.date.toString(),
            time = time.toString(),
            data = data,
            category = CATEGORY,
        )
        return HubOutboxEntity(
            eventId = id,
            category = CATEGORY,
            payloadJson = BroadcastEventMapper.json.encodeToString(envelope),
            createdAt = receivedAt.toEpochMilli(),
        )
    }
}
