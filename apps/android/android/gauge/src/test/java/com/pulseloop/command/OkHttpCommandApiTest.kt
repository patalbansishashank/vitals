package com.pulseloop.command

import com.pulseloop.hub.FakeHubSettings
import com.pulseloop.shortvideo.ShortVideoPrefs
import com.pulseloop.ui.tile.WorkoutControl.Session
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The `/v1/lumen/commands*` wire format over MockWebServer, and the state reporter. */
class OkHttpCommandApiTest {
    private val server = MockWebServer().apply { start() }
    private val api = OkHttpCommandApi(now = { 0L })
    private val url get() = server.url("/").toString()

    @After fun stop() = server.shutdown()

    @Test fun `a poll reads the commands in seq order with the server clock`() = runBlocking {
        server.enqueue(MockResponse().setBody("""
            {"now":"2026-10-27T04:00:00.000Z","personId":"p1","maxWaitS":25,"commands":[
              {"id":"b-00000000000000002","seq":7,"type":"hr.measure","payload":{},"issuedAt":"2026-10-27T03:59:59.000Z","expiresAt":"2026-10-27T04:00:59.000Z","attempt":1},
              {"id":"a-00000000000000001","seq":5,"type":"reels.set","payload":{"dailyLimit":20},"issuedAt":"2026-10-27T03:59:00.000Z","expiresAt":"2026-10-28T03:59:00.000Z","attempt":2}
            ]}
        """.trimIndent()))
        val r = api.poll(url, "tok", 25) as PollResult.Ok
        val req = server.takeRequest()
        assertEquals("/v1/lumen/commands?wait=25", req.path)
        assertEquals("Bearer tok", req.getHeader("Authorization"))
        assertEquals(java.time.Instant.parse("2026-10-27T04:00:00Z").toEpochMilli(), r.serverNow)
        assertEquals("p1", r.personId)
        assertEquals(listOf("a-00000000000000001", "b-00000000000000002"), r.commands.map { it.id })
        assertEquals(20, r.commands[0].payload["dailyLimit"]!!.jsonPrimitive.int)
        assertEquals(2, r.commands[0].attempt)
    }

    @Test fun `401, 429 and a dropped body map to their results`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "3"))
        server.enqueue(MockResponse().setBody("not json"))
        assertEquals(PollResult.Unauthorized, api.poll(url, "tok", 99))
        assertEquals(PollResult.Throttled(3_000), api.poll(url, "tok", 0))
        assertTrue(api.poll(url, "tok", 0) is PollResult.Failed)
        // the wait is clamped to the server's 25 s
        assertEquals("/v1/lumen/commands?wait=25", server.takeRequest().path)
    }

    @Test fun `an ack posts status, code and result`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(MockResponse().setResponseCode(409))
        val ack = CommandAck.rejected("wrong_workout", buildJsonObject { put("state", "recording") })
        assertEquals(SendResult.Ok, api.ack(url, "tok", "a-00000000000000001", ack))
        val req = server.takeRequest()
        assertEquals("/v1/lumen/commands/a-00000000000000001/ack", req.path)
        val body = Json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("rejected", body["status"]!!.jsonPrimitive.content)
        assertEquals("wrong_workout", body["code"]!!.jsonPrimitive.content)
        assertEquals("recording", body["result"]!!.jsonObject["state"]!!.jsonPrimitive.content)
        assertEquals(SendResult.Refused(409), api.ack(url, "tok", "a-00000000000000001", ack))
    }

    @Test fun `the state carries the Reels settings and the live recording only`() {
        val s = CommandChannel.stateJson(ShortVideoPrefs(dailyLimit = 25, disclosureAccepted = true), Session("w-1", "run", "paused", 1_793_000_000_000L))
        assertEquals(setOf("appVersion", "capabilities", "reels", "recording"), s.keys)
        assertEquals(setOf("enabled", "dailyLimit", "countdownSeconds", "apps"), s["reels"]!!.jsonObject.keys)
        assertEquals("paused", s["recording"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, CommandChannel.stateJson(ShortVideoPrefs(), null)["recording"])
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun `the reporter posts on start, then once per burst of changes`() = runTest {
        val fake = FakeCommandApi { 0L }
        val changes = MutableStateFlow(0)
        val reporter = CommandStateReporter(fake, FakeHubSettings("https://hub.example"), snapshot = { buildJsonObject { put("n", changes.value) } })
        backgroundScope.launch { reporter.run(changes) }
        runCurrent()
        assertEquals(1, fake.states.size)
        changes.value = 1
        runCurrent()
        changes.value = 2
        reporter.request()
        runCurrent()
        advanceTimeBy(2_500)
        runCurrent()
        assertEquals(2, fake.states.size)
        assertEquals(2, fake.states.last()["n"]!!.jsonPrimitive.int)
    }
}
