package com.pulseloop.hub

import com.pulseloop.data.entity.HubOutboxEntity
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.ring.PulseEvent
import java.time.Instant
import java.util.zip.GZIPInputStream
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class HubUploaderTest {
    private lateinit var server: MockWebServer
    private val dao = FakeHubOutboxDao()
    private var clock = 1_000_000L

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { server.shutdown() }

    private fun settings(maxBatch: Int = 500, maxBytes: Long = 1_048_576) =
        FakeHubSettings(server.url("/").toString(), maxBatch, maxBytes)

    private fun uploader(settings: HubSettingsSource) =
        HubUploader(dao, settings, OkHttpHubApi(now = { clock }), now = { clock })

    private fun event(i: Int): HubOutboxEntity = HubEventMapper.toHubOutbox(
        PulseEvent.HistoryMeasurement(MeasurementKind.HEART_RATE, 60.0 + i, Instant.ofEpochMilli(i * 60_000L)),
        "install123",
        Instant.ofEpochMilli(10_000L + i),
    )!!

    private suspend fun enqueue(count: Int) = (0 until count).forEach { dao.enqueue(event(it)) }

    private fun ok(accepted: Int, duplicates: Int = 0, rejected: String = "[]") = MockResponse()
        .setResponseCode(200)
        .setBody("""{"accepted":$accepted,"duplicates":$duplicates,"rejected":$rejected}""")

    private fun RecordedRequest.json(): JsonObject {
        val bytes = body.readByteArray()
        val raw = if (getHeader("Content-Encoding") == "gzip") GZIPInputStream(bytes.inputStream()).readBytes() else bytes
        return Json.parseToJsonElement(raw.toString(Charsets.UTF_8)).jsonObject
    }

    @Test fun `batches up to maxBatch with gzip bearer auth and the contract body`() = runBlocking {
        enqueue(7)
        repeat(3) { server.enqueue(ok(3)) }
        val result = uploader(settings(maxBatch = 3)).drain()

        assertEquals(HubDrainResult.Success(7), result)
        val sizes = (1..3).map {
            val request = server.takeRequest()
            assertEquals("/v1/lumen/events", request.path)
            assertEquals("Bearer secret-token", request.getHeader("Authorization"))
            assertEquals("gzip", request.getHeader("Content-Encoding"))
            assertTrue(request.getHeader("Content-Type")!!.startsWith("application/json"))
            val body = request.json()
            assertEquals("install123", body.getValue("installationId").jsonPrimitive.content)
            val events = body.getValue("events").jsonArray
            events.forEach { assertEquals("metrics/hr", it.jsonObject.getValue("category").jsonPrimitive.content) }
            events.size
        }
        assertEquals(listOf(3, 3, 1), sizes)
        assertEquals(0, dao.pendingCount())
        assertTrue(dao.rows.values.all { it.payloadJson.isEmpty() && it.uploadedAt != null })
    }

    @Test fun `packs batches by maxBytes of decompressed body`() = runBlocking {
        enqueue(30)
        repeat(30) { server.enqueue(ok(1)) }
        val result = uploader(settings(maxBytes = 4_096)).drain()

        assertEquals(HubDrainResult.Success(30), result)
        var sent = 0
        val requests = server.requestCount
        assertTrue("expected several byte-limited batches, got $requests", requests > 1)
        repeat(requests) {
            val request = server.takeRequest()
            val raw = GZIPInputStream(request.body.readByteArray().inputStream()).readBytes()
            assertTrue(raw.size <= 4_096)
            sent += Json.parseToJsonElement(raw.toString(Charsets.UTF_8)).jsonObject.getValue("events").jsonArray.size
        }
        assertEquals(30, sent)

        val rows = (0 until 6).map(::event)
        val one = rows.first().payloadJson.length
        val overhead = OkHttpHubApi.eventsBodySize("install123", emptyList())
        assertEquals(2, HubUploader.packByBytes("install123", rows, overhead + 2L * one + 1 + 5).size)
        assertTrue(HubUploader.packByBytes("install123", rows, overhead + one - 1L).isEmpty())
    }

    @Test fun `413 halves the batch until the server accepts it`() = runBlocking {
        enqueue(8)
        server.enqueue(MockResponse().setResponseCode(413))
        server.enqueue(MockResponse().setResponseCode(413))
        server.enqueue(ok(2)); server.enqueue(ok(2)); server.enqueue(ok(2)); server.enqueue(ok(2))
        val result = uploader(settings(maxBatch = 8)).drain()

        assertEquals(HubDrainResult.Success(8), result)
        val sizes = (1..6).map { server.takeRequest().json().getValue("events").jsonArray.size }
        assertEquals(listOf(8, 4, 2, 2, 2, 2), sizes)
    }

    @Test fun `a single event the server still refuses with 413 is rejected and does not wedge the queue`() = runBlocking {
        enqueue(2)
        server.enqueue(MockResponse().setResponseCode(413))
        server.enqueue(MockResponse().setResponseCode(413))
        server.enqueue(ok(1))
        val settings = settings(maxBatch = 2)
        val result = uploader(settings).drain()

        assertEquals(HubDrainResult.Success(1), result)
        val first = dao.rows.getValue(event(0).eventId)
        assertTrue(first.rejected)
        assertNotNull(first.uploadedAt)
        assertFalse(dao.rows.getValue(event(1).eventId).rejected)
        assertEquals(1L, settings.status.value.rejectedTotal)
    }

    @Test fun `401 asks for a re-pair and stops uploading`() = runBlocking {
        enqueue(3)
        server.enqueue(MockResponse().setResponseCode(401))
        val settings = settings()
        val uploader = uploader(settings)

        assertEquals(HubDrainResult.NeedsRepair, uploader.drain())
        assertTrue(settings.pairing.value!!.needsRepair)
        assertEquals(3, dao.pendingCount())
        // Nothing more is sent until the owner pairs again.
        assertEquals(HubDrainResult.NeedsRepair, uploader.drain())
        assertEquals(1, server.requestCount)
    }

    @Test fun `429 honours Retry-After seconds and sends nothing before it elapses`() = runBlocking {
        enqueue(2)
        server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "120"))
        server.enqueue(ok(2))
        val settings = settings()
        val uploader = uploader(settings)

        assertEquals(HubDrainResult.RetryAfter(120_000L), uploader.drain())
        assertEquals(clock + 120_000L, settings.status.value.notBefore)
        clock += 60_000L
        assertEquals(HubDrainResult.RetryAfter(60_000L), uploader.drain())
        assertEquals(1, server.requestCount)
        clock += 60_000L
        assertEquals(HubDrainResult.Success(2), uploader.drain())
        assertEquals(2, server.requestCount)
    }

    @Test fun `503 honours an HTTP-date Retry-After`() = runBlocking {
        enqueue(1)
        clock = Instant.parse("2026-10-22T10:00:00Z").toEpochMilli()
        server.enqueue(MockResponse().setResponseCode(503).setHeader("Retry-After", "Thu, 22 Oct 2026 10:05:00 GMT"))
        assertEquals(HubDrainResult.RetryAfter(300_000L), uploader(settings()).drain())
        assertEquals(300_000L, OkHttpHubApi.parseRetryAfter("Thu, 22 Oct 2026 10:05:00 GMT", clock))
        assertNull(OkHttpHubApi.parseRetryAfter("soon", clock))
    }

    @Test fun `other failures retry with backoff and keep the rows pending`() = runBlocking {
        enqueue(2)
        server.enqueue(MockResponse().setResponseCode(500))
        val settings = settings()
        val result = uploader(settings).drain()

        assertTrue(result is HubDrainResult.Retry)
        assertEquals(2, dao.pendingCount())
        assertTrue(dao.rows.values.all { it.attemptCount == 1 && it.lastError == "HTTP 500" })
        assertEquals("HTTP 500", settings.status.value.lastError)
    }

    @Test fun `idempotent by event id locally and across a lost response`() = runBlocking {
        val first = event(1)
        assertTrue(dao.enqueue(first) != -1L)
        // The same observation re-synced later has the same id and is not queued again.
        assertEquals(-1L, dao.enqueue(event(1).copy(createdAt = 99_999)))
        assertEquals(1, dao.pendingCount())

        // The server stored the batch but the reply was lost: the retry re-sends the same id and
        // the server counts it as a duplicate, which still settles the row.
        server.enqueue(MockResponse().setResponseCode(502))
        server.enqueue(ok(0, duplicates = 1))
        val settings = settings()
        val uploader = uploader(settings)
        assertTrue(uploader.drain() is HubDrainResult.Retry)
        assertEquals(HubDrainResult.Success(1), uploader.drain())
        val ids = (1..2).map { server.takeRequest().json().getValue("events").jsonArray.single().jsonObject.getValue("id").jsonPrimitive.content }
        assertEquals(listOf(first.eventId, first.eventId), ids)
        assertEquals(1L, settings.status.value.duplicatesTotal)
        assertEquals(HubDrainResult.Empty, uploader.drain())
        assertEquals(2, server.requestCount)
    }

    @Test fun `per-event rejections are recorded without failing the batch`() = runBlocking {
        enqueue(3)
        val bad = event(1).eventId
        server.enqueue(ok(2, rejected = """[{"id":"$bad","reason":"malformed"}]"""))
        val settings = settings()
        assertEquals(HubDrainResult.Success(3), uploader(settings).drain())
        assertTrue(dao.rows.getValue(bad).rejected)
        assertEquals("malformed", dao.rows.getValue(bad).lastError)
        assertEquals(2, dao.rows.values.count { !it.rejected && it.uploadedAt != null })
        assertEquals(2L, settings.status.value.acceptedTotal)
        assertEquals(1L, settings.status.value.rejectedTotal)
    }

    @Test fun `a rejection without an id is matched by its index`() = runBlocking {
        enqueue(3)
        val byIndex = event(2).eventId
        val byId = event(0).eventId
        server.enqueue(ok(1, rejected = """[{"id":null,"index":2,"reason":"bad_id"},{"id":"$byId","index":0,"reason":"bad_time"},{"id":"not-in-batch","reason":"x"}]"""))
        val settings = settings()
        assertEquals(HubDrainResult.Success(3), uploader(settings).drain())
        assertEquals("bad_id", dao.rows.getValue(byIndex).lastError)
        assertTrue(dao.rows.getValue(byIndex).rejected)
        assertEquals("bad_time", dao.rows.getValue(byId).lastError)
        assertFalse(dao.rows.getValue(event(1).eventId).rejected)
        assertEquals(2L, settings.status.value.rejectedTotal)
    }

    @Test fun `status reads the server's extra fields and tolerates an older server without them`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody(
            """{"personId":"p1","lastEventAt":"2026-10-22T08:00:00.000Z","lastObservedAt":"2026-10-22T07:59:00.000Z",""" +
                """"counts":{"metrics/hr":12,"deletion":2},"deletions":2,"serverVersion":"0.6.3","extra":{"x":1}}""",
        ))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"personId":"p1","lastEventAt":null,"counts":{},"serverVersion":"0.6.0"}"""))
        val api = OkHttpHubApi()
        val url = server.url("/").toString()
        val s = api.status(url, "secret-token").getOrThrow()
        assertEquals("2026-10-22T07:59:00.000Z", s.lastObservedAt)
        assertEquals(2L, s.deletions)
        assertEquals(mapOf("metrics/hr" to 12L, "deletion" to 2L), s.counts)
        assertEquals("Bearer secret-token", server.takeRequest().getHeader("Authorization"))
        val old = api.status(url, "secret-token").getOrThrow()
        assertNull(old.lastObservedAt)
        assertNull(old.deletions)
        assertNull(old.lastEventAt)
    }

    @Test fun `unpair posts the bearer token and is best effort`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(500))
        val api = OkHttpHubApi()
        val url = server.url("/").toString()
        val pairing = FakeHubSettings(url).pairing.value
        assertTrue(HubSync.revokeOnServer(pairing, api))
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/v1/lumen/unpair", request.path)
        assertEquals("Bearer secret-token", request.getHeader("Authorization"))
        assertTrue(api.unpair(url, "secret-token").isSuccess) // 401: already revoked
        assertFalse(HubSync.revokeOnServer(pairing, api)) // 500
        assertFalse(HubSync.revokeOnServer(null, api))
        server.shutdown()
        assertFalse(HubSync.revokeOnServer(pairing, api)) // unreachable: no throw
    }

    @Test fun `unpaired drains nothing`() = runBlocking {
        enqueue(1)
        val settings = settings().also { it.unpair() }
        assertEquals(HubDrainResult.NotPaired, uploader(settings).drain())
        assertEquals(0, server.requestCount)
    }

    @Test fun `pairing posts the contract body and maps server errors`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody(
            """{"token":"t0k","personId":"p1","serverVersion":"0.6.2","maxBatch":250,"maxBytes":524288}""",
        ))
        server.enqueue(MockResponse().setResponseCode(410).setBody("""{"error":"code_expired","message":"used"}"""))
        val api = OkHttpHubApi()
        val url = server.url("/").toString()
        val ok = api.pair(url, "12345678", "install123", "OnePlus CPH2661", "2.7.0") as HubPairResult.Success
        assertEquals(HubPairResponse("t0k", "p1", "0.6.2", 250, 524_288), ok.response)
        val request = server.takeRequest()
        assertEquals("/v1/lumen/pair", request.path)
        val body = request.json()
        assertEquals("12345678", body.getValue("code").jsonPrimitive.content)
        assertEquals("install123", body.getValue("installationId").jsonPrimitive.content)
        assertEquals("OnePlus CPH2661", body.getValue("deviceName").jsonPrimitive.content)
        assertEquals("2.7.0", body.getValue("appVersion").jsonPrimitive.content)

        val failed = api.pair(url, "12345678", "install123", "x", "y") as HubPairResult.Failure
        assertEquals(410, failed.status)
        assertEquals("code_expired", failed.error)
    }

    @Test fun `server URL must be https except loopback`() {
        assertNull(HubUrl.validationError("https://oci.tail1234.ts.net:8443/"))
        assertNull(HubUrl.validationError("http://localhost:8443"))
        assertNull(HubUrl.validationError("http://127.0.0.1:8443"))
        assertNotNull(HubUrl.validationError("http://oci.tail1234.ts.net:8443"))
        assertNotNull(HubUrl.validationError("http://192.168.1.4:8443"))
        assertNotNull(HubUrl.validationError("ftp://host"))
        assertNotNull(HubUrl.validationError("https://user:pw@host"))
        assertEquals("https://h:1", HubUrl.normalize(" https://h:1/ "))
        assertTrue(HubPairingCode.isValid("1234 5678"))
        assertFalse(HubPairingCode.isValid("1234567"))
    }
}
