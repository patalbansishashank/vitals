package com.pulseloop.ring

import android.content.Context
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** GA.8: the per-stream history cursor survives an app restart (prefs, one key per ring and stream). */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class JStyle2301HistoryCursorPersistenceTest {
    private lateinit var context: Context
    private val prefsName = "cursor-persistence-test"

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit().clear().commit()
    }

    /** A fresh store over the same file, as a restarted process builds it. */
    private fun durable(address: String? = "AA:BB") = DurableJStyle2301HistoryCursorStore(
        PrefsRingHistoryCursorStore(context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)) { address },
    )

    @Test fun `encoding round-trips, absent instants included, and garbage reads as no cursor`() {
        val full = JStyle2301HistoryCursor(
            Instant.ofEpochMilli(1_000), Instant.ofEpochMilli(2_000), Instant.ofEpochMilli(500), true, 40,
        )
        assertEquals(full, DurableJStyle2301HistoryCursorStore.decode(DurableJStyle2301HistoryCursorStore.encode(full)))
        val sparse = JStyle2301HistoryCursor(null, null, null, false, 20)
        assertEquals(sparse, DurableJStyle2301HistoryCursorStore.decode(DurableJStyle2301HistoryCursorStore.encode(sparse)))
        listOf(null, "", "v0|1|2|3|1|20", "v1|x|2|3|1|20", "v1|1|2|3|yes|20", "v1|1|2|3|1|0", "v1|1|2").forEach {
            assertNull(it, DurableJStyle2301HistoryCursorStore.decode(it))
        }
    }

    @Test fun `a cursor is kept per ring and read back by a new store instance`() {
        val stream = JStyle2301HistoryStream.SLEEP
        val cursor = JStyle2301HistoryCursor(Instant.ofEpochMilli(9_000), Instant.ofEpochMilli(9_600), null, true, 20)
        durable("AA:BB").save(stream, cursor)
        assertEquals(cursor, durable("AA:BB").load(stream))
        assertNull("another ring starts its own history", durable("CC:DD").load(stream))
        assertNull("another stream has its own cursor", durable("AA:BB").load(JStyle2301HistoryStream.SPO2))
    }

    @Test fun `after a restart a drained stream is not deep-pulled again`() = runTest {
        val streams = listOf(JStyle2301HistoryStream.ACTIVITY_DETAIL, JStyle2301HistoryStream.HEART_RATE)
        val t = Instant.parse("2026-10-21T10:00:00Z")

        // First process: activity detail is the deep pull (queued last) and drains.
        val first = mutableListOf<ByteArray>()
        val before = JStyle2301HistorySync(RingCommandWriter { first += it }, 100, 500, scope = this, progressSink = {}, cursorStore = durable())
        before.start(streams, pageLimit = 1)
        assertEquals(0x55, first.first()[0].toInt() and 0xFF)
        before.noteRecords(0x55, listOf(t to t))
        repeat(50) { before.notePacket(byteArrayOf(0x55, 0x00)) }
        before.noteRecords(0x52, listOf(t to t.plusSeconds(600)))
        before.notePacket(byteArrayOf(0x52, 0xFF.toByte()))
        assertTrue(durable().load(JStyle2301HistoryStream.ACTIVITY_DETAIL)!!.historyDrained)

        // Second process, new objects over the same prefs: activity detail now pages incrementally,
        // so heart rate (still undrained) is the deep pull and activity detail is asked for first.
        val second = mutableListOf<ByteArray>()
        val after = JStyle2301HistorySync(RingCommandWriter { second += it }, 100, 500, scope = this, progressSink = {}, cursorStore = durable())
        after.start(streams, pageLimit = 1)
        assertEquals(0x52, second.first()[0].toInt() and 0xFF)
        after.cancel()
    }

    @Test fun `the driver writes through the store it is configured with`() {
        val values = mutableMapOf<String, String>()
        val store = object : RingHistoryCursorStore {
            override fun read(stream: String) = values[stream]
            override fun write(stream: String, value: String) { values[stream] = value }
        }
        val utc = java.time.ZoneId.of("UTC")
        val driver = JStyle2301Driver(writer = null, zoneId = utc, now = { Instant.parse("2026-10-21T12:00:00Z") },
            cursorStore = InMemoryJStyle2301HistoryCursorStore())
        driver.configureHistoryCursorStore(store)
        val engine = driver.makeSyncEngine()
        // The durable cursor test needs the explicit archive plan; automatic startup
        // now asks for only one recent page per stream.
        engine.refresh()
        driver.ingest(byteArrayOf(0x27, 0x00, 0x05, 0x02, 0x05), "fff7").forEach(engine::handle)
        val packet = ByteArray(25).also {
            it[0] = 0x52
            // 2026-10-21 07:00:00 in BCD, as the decoder reads it.
            byteArrayOf(0x26, 0x10, 0x21, 0x07, 0x00, 0x00).copyInto(it, 3)
        } + byteArrayOf(0x52, 0xFF.toByte())
        driver.ingest(packet, "fff7")
        driver.connectionDidEnd()
        val saved = DurableJStyle2301HistoryCursorStore.decode(values[JStyle2301HistoryStream.ACTIVITY_DETAIL.key])
        assertNotNull("activity detail's cursor reached the durable store", saved)
        assertTrue(saved!!.historyDrained)
    }
}
