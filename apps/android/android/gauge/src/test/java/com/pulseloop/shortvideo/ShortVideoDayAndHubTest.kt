package com.pulseloop.shortvideo

import com.pulseloop.hub.FakeHubOutboxDao
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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Local-midnight rollover through the repository, and the daily hub CloudEvent. */
class ShortVideoDayAndHubTest {

    /** In-memory [ShortVideoDao] with the same keying as the Room table. */
    private class FakeDao : ShortVideoDao() {
        val rows = MutableStateFlow<Map<Pair<String, String>, ShortVideoDayEntity>>(emptyMap())
        override suspend fun ensureRow(date: String, app: String, limit: Int, now: Long) {
            val k = date to app
            if (k !in rows.value) rows.value = rows.value + (k to ShortVideoDayEntity(date, app, dailyLimit = limit, updatedAt = now))
        }
        private fun change(date: String, app: String, f: (ShortVideoDayEntity) -> ShortVideoDayEntity) {
            val k = date to app
            rows.value[k]?.let { rows.value = rows.value + (k to f(it)) }
        }
        override suspend fun bumpCount(date: String, app: String, limit: Int, now: Long) =
            change(date, app) { it.copy(count = it.count + 1, dailyLimit = limit, updatedAt = now) }
        override suspend fun bumpLimitHit(date: String, app: String, limit: Int, now: Long) =
            change(date, app) { it.copy(limitHits = it.limitHits + 1, dailyLimit = limit, updatedAt = now) }
        override suspend fun bumpCancel(date: String, app: String, limit: Int, now: Long) =
            change(date, app) { it.copy(cancels = it.cancels + 1, dailyLimit = limit, updatedAt = now) }
        override suspend fun day(date: String) = rows.value.values.filter { it.date == date }
        override fun rangeFlow(from: String, to: String): Flow<List<ShortVideoDayEntity>> =
            rows.map { m -> m.values.filter { it.date in from..to }.sortedBy { it.date } }
        override suspend fun clearDay(date: String) { rows.value = rows.value.filterKeys { it.first != date } }
    }

    private val zone = ZoneId.of("Asia/Kolkata")
    private fun at(y: Int, m: Int, d: Int, h: Int, min: Int, s: Int = 0) =
        ZonedDateTime.of(y, m, d, h, min, s, 0, zone).toInstant().toEpochMilli()

    private fun repo(dao: ShortVideoDao, hub: FakeHubOutboxDao? = null, paired: Boolean = true, upload: Boolean = true) =
        ShortVideoRepository(
            dao = dao,
            hubDao = hub,
            settings = { ShortVideoPrefs(dailyLimit = 30, hubUpload = upload) },
            zone = { zone },
            hubInstallationId = { if (paired) "install-1" else null },
            requestHubUpload = {},
        )

    @Test fun `the day turns over at local midnight`() = runBlocking {
        val dao = FakeDao()
        val r = repo(dao)
        assertEquals(1, r.recordReel(ShortVideoApp.INSTAGRAM, at(2026, 10, 22, 23, 59, 58)))
        assertEquals(2, r.recordReel(ShortVideoApp.YOUTUBE, at(2026, 10, 22, 23, 59, 59)))
        // One second later is a new day with a fresh total, so the limit starts over too.
        assertEquals(1, r.recordReel(ShortVideoApp.YOUTUBE, at(2026, 10, 23, 0, 0, 0)))
        val oct22 = r.summary(LocalDate.of(2026, 10, 22))
        assertEquals(1, oct22.count(ShortVideoApp.INSTAGRAM))
        assertEquals(1, oct22.count(ShortVideoApp.YOUTUBE))
        assertEquals(1, r.summary(LocalDate.of(2026, 10, 23)).total)
        // The same instant is a different local date in another zone.
        assertEquals(LocalDate.of(2026, 10, 22), ShortVideoDayClock.dayOf(at(2026, 10, 23, 0, 0, 30), ZoneId.of("Europe/London")))
    }

    @Test fun `start of day survives a DST change`() {
        val berlin = ZoneId.of("Europe/Berlin")
        val start = ShortVideoDayClock.startOfDay(LocalDate.of(2026, 10, 25), berlin)
        assertEquals(Instant.parse("2026-10-24T22:00:00Z"), start)
        assertEquals(
            listOf("2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"),
            ShortVideoDayClock.window(LocalDate.of(2026, 10, 25), 7).map { it.toString() },
        )
    }

    @Test fun `limit hits and cancels are kept per day`() = runBlocking {
        val r = repo(FakeDao())
        val t = at(2026, 10, 22, 21, 0)
        r.recordReel(ShortVideoApp.YOUTUBE, t)
        r.recordLimitHit(ShortVideoApp.YOUTUBE, t)
        r.recordLimitHit(ShortVideoApp.INSTAGRAM, t + 1)
        r.recordCancel(ShortVideoApp.INSTAGRAM, t + 2)
        val s = r.summary(LocalDate.of(2026, 10, 22))
        assertEquals(2, s.limitHits)
        assertEquals(1, s.cancels)
        assertEquals(1, s.total)
    }

    @Test fun `daily hub event carries only counts and supersedes by value`() = runBlocking {
        val dao = FakeDao()
        val hub = FakeHubOutboxDao()
        val r = repo(dao, hub)
        val date = LocalDate.of(2026, 10, 22)
        repeat(3) { r.recordReel(ShortVideoApp.INSTAGRAM, at(2026, 10, 22, 20, it)) }
        r.recordReel(ShortVideoApp.YOUTUBE, at(2026, 10, 22, 20, 10))
        r.recordLimitHit(ShortVideoApp.YOUTUBE, at(2026, 10, 22, 20, 10))

        assertTrue(r.queueHub(date, at(2026, 10, 22, 21, 0)))
        assertFalse("unchanged day is a duplicate", r.queueHub(date, at(2026, 10, 22, 21, 5)))
        r.recordReel(ShortVideoApp.YOUTUBE, at(2026, 10, 22, 22, 0))
        assertTrue(r.queueHub(date, at(2026, 10, 22, 22, 1)))
        assertEquals(2, hub.rows.size)

        val rows = hub.rows.values.toList()
        assertNotEquals(rows[0].eventId, rows[1].eventId)
        val event = Json.parseToJsonElement(rows[1].payloadJson).jsonObject
        assertEquals("habits/short_video", event["category"]!!.jsonPrimitive.content)
        assertEquals("habits/short_video", rows[1].category)
        assertEquals("2026-10-22", event["subject"]!!.jsonPrimitive.content)
        assertEquals(ShortVideoHubEvent.TYPE, event["type"]!!.jsonPrimitive.content)
        assertEquals("urn:pulseloop:installation:install-1", event["source"]!!.jsonPrimitive.content)
        assertEquals(rows[1].eventId, event["id"]!!.jsonPrimitive.content)
        assertEquals(Instant.ofEpochMilli(at(2026, 10, 22, 22, 0)).toString(), event["time"]!!.jsonPrimitive.content)
        val data = event["data"]!!.jsonObject
        assertEquals(
            setOf("schema_version", "observed_at", "received_at", "date", "counts", "limit", "limit_hits", "cancels"),
            data.keys,
        )
        assertEquals(1, data["schema_version"]!!.jsonPrimitive.int)
        // observed_at is the day's local midnight for every version, so the newest time wins.
        assertEquals("2026-10-21T18:30:00Z", data["observed_at"]!!.jsonPrimitive.content)
        assertEquals("2026-10-22", data["date"]!!.jsonPrimitive.content)
        val counts = data["counts"]!!.jsonObject
        assertEquals(3, counts["instagram"]!!.jsonPrimitive.int)
        assertEquals(2, counts["youtube"]!!.jsonPrimitive.int)
        assertEquals(30, data["limit"]!!.jsonPrimitive.int)
        assertEquals(1, data["limit_hits"]!!.jsonPrimitive.int)
        assertEquals(0, data["cancels"]!!.jsonPrimitive.int)
    }

    @Test fun `recent days are queued by the wall clock, today included, and only once while unchanged`() = runBlocking {
        val dao = FakeDao()
        val hub = FakeHubOutboxDao()
        val r = repo(dao, hub)
        // days a process restart never sent, and today
        r.recordReel(ShortVideoApp.INSTAGRAM, at(2026, 10, 26, 21, 0))
        r.recordReel(ShortVideoApp.YOUTUBE, at(2026, 10, 28, 8, 0))
        r.recordReel(ShortVideoApp.INSTAGRAM, at(2026, 10, 29, 9, 0))
        r.recordReel(ShortVideoApp.INSTAGRAM, at(2026, 10, 15, 9, 0)) // outside the week

        assertEquals(3, r.queueRecent(at(2026, 10, 29, 9, 5)))
        assertEquals(setOf("2026-10-26", "2026-10-28", "2026-10-29"), hub.rows.values.map { subjectOf(it.payloadJson) }.toSet())
        assertEquals("unchanged days are duplicates", 0, r.queueRecent(at(2026, 10, 29, 9, 10)))

        r.recordReel(ShortVideoApp.INSTAGRAM, at(2026, 10, 29, 9, 20))
        assertEquals("only today changed", 1, r.queueRecent(at(2026, 10, 29, 9, 21)))
    }

    private fun subjectOf(payload: String) = Json.parseToJsonElement(payload).jsonObject["subject"]!!.jsonPrimitive.content

    @Test fun `the event id is deterministic for the same date and values`() {
        val s = ShortVideoDaySummary(
            LocalDate.of(2026, 10, 22),
            mapOf(ShortVideoApp.INSTAGRAM to 4, ShortVideoApp.YOUTUBE to 9),
            limit = 30, limitHits = 0, cancels = 0, updatedAt = 1,
        )
        assertEquals(ShortVideoHubEvent.eventId(s), ShortVideoHubEvent.eventId(s.copy(updatedAt = 999)))
        assertNotEquals(ShortVideoHubEvent.eventId(s), ShortVideoHubEvent.eventId(s.copy(cancels = 1)))
        assertNotEquals(ShortVideoHubEvent.eventId(s), ShortVideoHubEvent.eventId(s.copy(date = LocalDate.of(2026, 10, 23))))
        assertTrue(ShortVideoHubEvent.eventId(s).startsWith("pl-"))
    }

    @Test fun `nothing is queued when unpaired, opted out, or the day is empty`() = runBlocking {
        val date = LocalDate.of(2026, 10, 22)
        val hub = FakeHubOutboxDao()
        assertFalse(repo(FakeDao(), hub).queueHub(date))
        val dao = FakeDao()
        repo(dao, hub).recordReel(ShortVideoApp.YOUTUBE, at(2026, 10, 22, 9, 0))
        assertFalse(repo(dao, hub, paired = false).queueHub(date))
        assertFalse(repo(dao, hub, upload = false).queueHub(date))
        assertTrue(hub.rows.isEmpty())
    }
}
