package com.pulseloop.social

import com.pulseloop.hub.FakeHubOutboxDao
import com.pulseloop.social.SocialUsageReader.Event
import com.pulseloop.social.SocialUsageReader.Kind
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Persist-then-upload through the repository, and the `habits/social_time` daily CloudEvent (durations only). */
class SocialTimeDayAndHubTest {

    private val zone = ZoneId.of("Asia/Kolkata")
    private fun at(y: Int, m: Int, d: Int, h: Int, min: Int, s: Int = 0) =
        ZonedDateTime.of(y, m, d, h, min, s, 0, zone).toInstant().toEpochMilli()

    private val ig = "com.instagram.android"
    private val yt = "com.google.android.youtube"
    private fun fg(pkg: String, t: Long) = Event(pkg, Kind.FOREGROUND, t)
    private fun bg(pkg: String, t: Long) = Event(pkg, Kind.BACKGROUND, t)

    /** In-memory [SocialTimeDao] with the same (date, app) keying and REPLACE semantics as Room. */
    private class FakeDao : SocialTimeDao {
        val rows = MutableStateFlow<Map<Pair<String, String>, SocialTimeDayEntity>>(emptyMap())
        override suspend fun upsert(list: List<SocialTimeDayEntity>) {
            rows.value = rows.value + list.associateBy { it.date to it.app }
        }
        override suspend fun day(date: String) = rows.value.values.filter { it.date == date }
        override suspend fun range(from: String, to: String) = rows.value.values.filter { it.date in from..to }.sortedBy { it.date }
        override fun rangeFlow(from: String, to: String): Flow<List<SocialTimeDayEntity>> =
            rows.map { m -> m.values.filter { it.date in from..to }.sortedBy { it.date } }
        override suspend fun clear(date: String, app: String) { rows.value = rows.value - (date to app) }
    }

    private fun repo(
        dao: SocialTimeDao,
        query: SocialUsageQuery,
        hub: FakeHubOutboxDao? = null,
        prefs: SocialPrefs = SocialPrefs(),
        granted: Boolean = true,
        paired: Boolean = true,
    ) = SocialTimeRepository(
        dao = dao,
        hubDao = hub,
        settings = { prefs },
        query = query,
        usageGranted = { granted },
        zone = { zone },
        hubInstallationId = { if (paired) "install-1" else null },
        requestHubUpload = {},
    )

    @Test fun `recompute persists per-app whole-day totals`() = runBlocking {
        val dao = FakeDao()
        val query = SocialUsageQuery { _, _ ->
            listOf(
                fg(ig, at(2026, 11, 16, 9, 0)), bg(ig, at(2026, 11, 16, 9, 20)),
                fg(yt, at(2026, 11, 16, 10, 0)), bg(yt, at(2026, 11, 16, 10, 10)),
            )
        }
        val now = at(2026, 11, 16, 12, 0)
        repo(dao, query).recompute(now, days = 1)
        val summary = repo(dao, query).summary(LocalDate.of(2026, 11, 16))
        assertEquals(mapOf("instagram" to 1200, "youtube" to 600), summary.perApp)
        assertEquals(1800, summary.totalSeconds)
        assertEquals(now, summary.updatedAt)
    }

    @Test fun `nothing is persisted when disabled or the grant is missing`() = runBlocking {
        val query = SocialUsageQuery { _, _ -> listOf(fg(ig, at(2026, 11, 16, 9, 0)), bg(ig, at(2026, 11, 16, 9, 20))) }
        val now = at(2026, 11, 16, 12, 0)
        val offDao = FakeDao()
        repo(offDao, query, prefs = SocialPrefs(enabled = false)).recompute(now)
        assertTrue(offDao.rows.value.isEmpty())
        val ungrantedDao = FakeDao()
        repo(ungrantedDao, query, granted = false).recompute(now)
        assertTrue(ungrantedDao.rows.value.isEmpty())
    }

    @Test fun `the daily hub event carries durations only and supersedes by value`() = runBlocking {
        val dao = FakeDao()
        val hub = FakeHubOutboxDao()
        var events = listOf(fg(ig, at(2026, 11, 16, 9, 0)), bg(ig, at(2026, 11, 16, 9, 20)))
        val query = SocialUsageQuery { _, _ -> events }
        val date = LocalDate.of(2026, 11, 16)

        val r = repo(dao, query, hub)
        r.recompute(at(2026, 11, 16, 12, 0), days = 1)
        assertEquals(1, r.queueRecent(at(2026, 11, 16, 12, 0), days = 1))
        assertEquals("unchanged day is a duplicate", 0, r.queueRecent(at(2026, 11, 16, 12, 5), days = 1))

        // more time in a new app: a changed day queues a new superseding row
        events = events + listOf(fg(yt, at(2026, 11, 16, 13, 0)), bg(yt, at(2026, 11, 16, 13, 30)))
        r.recompute(at(2026, 11, 16, 13, 35), days = 1)
        assertEquals(1, r.queueRecent(at(2026, 11, 16, 13, 36), days = 1))
        assertEquals(2, hub.rows.size)

        val rows = hub.rows.values.toList()
        assertNotEquals(rows[0].eventId, rows[1].eventId)
        val event = Json.parseToJsonElement(rows[1].payloadJson).jsonObject
        assertEquals("habits/social_time", event["category"]!!.jsonPrimitive.content)
        assertEquals("habits/social_time", rows[1].category)
        assertEquals("social_time:2026-11-16", event["subject"]!!.jsonPrimitive.content)
        assertEquals(SocialHubEvent.TYPE, event["type"]!!.jsonPrimitive.content)
        assertEquals("urn:pulseloop:installation:install-1", event["source"]!!.jsonPrimitive.content)
        assertEquals(rows[1].eventId, event["id"]!!.jsonPrimitive.content)
        val data = event["data"]!!.jsonObject
        assertEquals(
            setOf("date", "tz", "totalSeconds", "perApp", "apps", "targetMinMinutes", "targetMaxMinutes", "source", "updatedAt"),
            data.keys,
        )
        assertEquals("2026-11-16", data["date"]!!.jsonPrimitive.content)
        assertEquals("Asia/Kolkata", data["tz"]!!.jsonPrimitive.content)
        assertEquals(1200 + 1800, data["totalSeconds"]!!.jsonPrimitive.int)
        assertEquals(1200, data["perApp"]!!.jsonObject["instagram"]!!.jsonPrimitive.int)
        assertEquals(1800, data["perApp"]!!.jsonObject["youtube"]!!.jsonPrimitive.int)
        assertEquals(30, data["targetMinMinutes"]!!.jsonPrimitive.int)
        assertEquals(45, data["targetMaxMinutes"]!!.jsonPrimitive.int)
        assertEquals("usage_access", data["source"]!!.jsonPrimitive.content)
        assertEquals(at(2026, 11, 16, 13, 35), data["updatedAt"]!!.jsonPrimitive.long)
        assertEquals(7, data["apps"]!!.jsonArray.size)
    }

    @Test fun `nothing is queued when unpaired, opted out, or the day is empty`() = runBlocking {
        val date = LocalDate.of(2026, 11, 16)
        val query = SocialUsageQuery { _, _ -> listOf(fg(ig, at(2026, 11, 16, 9, 0)), bg(ig, at(2026, 11, 16, 9, 20))) }
        val hub = FakeHubOutboxDao()
        // empty day
        assertFalse(repo(FakeDao(), query, hub).queueDay(date))
        val dao = FakeDao()
        repo(dao, query, hub).recompute(at(2026, 11, 16, 12, 0), days = 1)
        assertFalse(repo(dao, query, hub, paired = false).queueDay(date))
        assertFalse(repo(dao, query, hub, prefs = SocialPrefs(hubUpload = false)).queueDay(date))
        assertTrue(hub.rows.isEmpty())
    }

    @Test fun `the event id is deterministic for the same date and values`() {
        val s = SocialDaySummary(LocalDate.of(2026, 11, 16), mapOf("instagram" to 1200, "youtube" to 600), updatedAt = 1)
        val apps = SocialApp.keys
        assertEquals(SocialHubEvent.eventId(s, 30, 45, apps), SocialHubEvent.eventId(s.copy(updatedAt = 999), 30, 45, apps))
        assertNotEquals(SocialHubEvent.eventId(s, 30, 45, apps), SocialHubEvent.eventId(s.copy(perApp = mapOf("instagram" to 1201)), 30, 45, apps))
        assertNotEquals(SocialHubEvent.eventId(s, 30, 45, apps), SocialHubEvent.eventId(s, 30, 60, apps))
        assertNotEquals(SocialHubEvent.eventId(s, 30, 45, apps), SocialHubEvent.eventId(s.copy(date = LocalDate.of(2026, 11, 17)), 30, 45, apps))
        assertTrue(SocialHubEvent.eventId(s, 30, 45, apps).startsWith("pl-"))
    }

    @Test fun `collect recomputes then queues in one call, recovering recent days`() = runBlocking {
        val dao = FakeDao()
        val hub = FakeHubOutboxDao()
        val query = SocialUsageQuery { _, _ ->
            listOf(
                fg(ig, at(2026, 11, 14, 20, 0)), bg(ig, at(2026, 11, 14, 20, 30)),
                fg(yt, at(2026, 11, 16, 9, 0)), bg(yt, at(2026, 11, 16, 9, 15)),
            )
        }
        val queued = repo(dao, query, hub).collect(at(2026, 11, 16, 12, 0))
        assertEquals(2, queued)
        val subjects = hub.rows.values.map { Json.parseToJsonElement(it.payloadJson).jsonObject["subject"]!!.jsonPrimitive.content }.toSet()
        assertEquals(setOf("social_time:2026-11-14", "social_time:2026-11-16"), subjects)
    }
}
