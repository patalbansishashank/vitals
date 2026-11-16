package com.pulseloop.social

import com.pulseloop.broadcasting.BroadcastEventMapper
import com.pulseloop.broadcasting.PulseCloudEvent
import com.pulseloop.data.entity.HubOutboxEntity
import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The daily "Social time" CloudEvent for the home-server outbox (category `habits/social_time`, subject
 * `social_time:<date>`; SPEC social-time). Only durations leave the phone — never anything about what was watched.
 *
 * One current event per local day: the server supersedes by newest `time` for the same subject, so a later upload of a
 * changed day wins. The [eventId] hashes the date and the values (not `updatedAt`), so re-sending an unchanged day is a
 * duplicate the outbox drops, while a changed day is a new row that supersedes the old on the server.
 */
object SocialHubEvent {
    const val TYPE = "habits.social_time.daily.updated"
    const val CATEGORY = "habits/social_time"
    const val SOURCE = "usage_access"

    fun subject(summary: SocialDaySummary): String = "social_time:${summary.date}"

    fun eventId(summary: SocialDaySummary, targetMin: Int, targetMax: Int, apps: List<String>): String {
        val canonical = buildString {
            append(TYPE).append('|').append(subject(summary)).append('|').append(summary.totalSeconds)
            append('|').append(targetMin).append('-').append(targetMax)
            append('|').append(apps.joinToString(","))
            summary.perApp.entries.sortedBy { it.key }.forEach { append('|').append(it.key).append('=').append(it.value) }
        }
        return "pl-" + BroadcastEventMapper.sha256(canonical).take(40)
    }

    fun toHubOutbox(
        summary: SocialDaySummary,
        targetMin: Int,
        targetMax: Int,
        enabledApps: List<String>,
        installationId: String,
        zone: ZoneId = ZoneId.systemDefault(),
        receivedAt: Instant = Instant.now(),
    ): HubOutboxEntity {
        val time = if (summary.updatedAt > 0) Instant.ofEpochMilli(summary.updatedAt) else receivedAt
        val data = buildJsonObject {
            put("date", summary.date.toString())
            put("tz", zone.id)
            put("totalSeconds", summary.totalSeconds)
            put("perApp", buildJsonObject { summary.perApp.entries.sortedBy { it.key }.forEach { put(it.key, it.value) } })
            put("apps", buildJsonArray { enabledApps.forEach { add(it) } })
            put("targetMinMinutes", targetMin)
            put("targetMaxMinutes", targetMax)
            put("source", SOURCE)
            put("updatedAt", summary.updatedAt)
        }
        val id = eventId(summary, targetMin, targetMax, enabledApps)
        val envelope = PulseCloudEvent(
            id = id,
            type = TYPE,
            source = "urn:pulseloop:installation:$installationId",
            subject = subject(summary),
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
