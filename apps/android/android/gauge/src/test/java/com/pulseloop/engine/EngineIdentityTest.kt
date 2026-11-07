package com.pulseloop.engine

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.pulseloop.hub.HubApi
import com.pulseloop.hub.HubPairResult
import com.pulseloop.hub.HubPairing
import com.pulseloop.hub.OkHttpHubApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class EngineIdentityTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { server.shutdown() }

    private fun pairing(url: String, needsRepair: Boolean = false) =
        HubPairing(url, "tok", "person", "0.7.0", 500, 1_000_000, 1L, needsRepair)

    @Test fun `the identity is kept, replaced and cleared, and never printed with its credential`() {
        val prefs = ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("identity-test", Context.MODE_PRIVATE)
        val store = EngineIdentityStore(prefs)
        assertNull(store.get())
        store.save(" https://oci.example:8443/ ", " secret ")
        val id = store.get()!!
        assertEquals("https://oci.example:8443", id.serverUrl)
        assertEquals("secret", id.deviceToken)
        assertFalse(id.toString().contains("secret"))
        store.save("https://other.example", "next")
        assertEquals("next", store.get()!!.deviceToken)
        store.clear()
        assertNull(store.get())
    }

    @Test fun `the engine pairs when it has no token, was refused, or the server changed, and not otherwise`() {
        assertTrue(EnginePairing.needsPair(null, "https://a.example"))
        assertTrue(EnginePairing.needsPair(pairing("https://a.example", needsRepair = true), "https://a.example"))
        assertTrue(EnginePairing.needsPair(pairing("https://a.example"), "https://b.example"))
        assertFalse(EnginePairing.needsPair(pairing("https://a.example"), "https://a.example/"))
    }

    @Test fun `pair-device sends the Vitals credential as a bearer and the three fields, and reads the pair answer`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody(
            """{"token":"lumen-token","personId":"p1","deviceId":"d9","serverVersion":"0.7.0","maxBatch":250,"maxBytes":524288}""",
        ))
        val result = OkHttpHubApi().pairDevice(server.url("/").toString(), "vitals-credential", "install-1", "Vitals · Pixel", "0.7.0")
        val ok = (result as HubPairResult.Success).response
        assertEquals("lumen-token", ok.token)
        assertEquals("p1", ok.personId)
        assertEquals("d9", ok.deviceId)
        assertEquals(250, ok.maxBatch)
        assertEquals(524_288L, ok.maxBytes)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/v1/lumen/pair-device", request.path)
        assertEquals("Bearer vitals-credential", request.getHeader("Authorization"))
        val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals(setOf("installationId", "deviceName", "appVersion"), body.keys)
        assertEquals("install-1", body.getValue("installationId").jsonPrimitive.content)
        assertEquals("0.7.0", body.getValue("appVersion").jsonPrimitive.content)
    }

    @Test fun `pair-device failures keep their status, and an older server's answer without a device id still pairs`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"unauthorized"}"""))
        server.enqueue(MockResponse().setResponseCode(404))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"token":"t","personId":"p"}"""))
        val api: HubApi = OkHttpHubApi()
        val url = server.url("/").toString()
        val denied = api.pairDevice(url, "x", "i", "n", "v") as HubPairResult.Failure
        assertEquals(401, denied.status); assertEquals("unauthorized", denied.error)
        assertEquals(404, (api.pairDevice(url, "x", "i", "n", "v") as HubPairResult.Failure).status)
        val bare = (api.pairDevice(url, "x", "i", "n", "v") as HubPairResult.Success).response
        assertNull(bare.deviceId); assertNotNull(bare.token); assertEquals(500, bare.maxBatch)
    }
}
