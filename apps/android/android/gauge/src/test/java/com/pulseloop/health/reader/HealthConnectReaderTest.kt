package com.pulseloop.health.reader

import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import com.pulseloop.data.sources.HcRecordEntity
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The reader against a fake Health Connect client (SPEC §GB tests). */
class HealthConnectReaderTest {

    /** A fake Health Connect: a record table, paged reads, a change log and expirable tokens. */
    class FakeHc : HealthConnectReader.HcGateway {
        val log = mutableListOf<String>()
        val records = mutableListOf<HcRecordView>()
        /** Per token: the changes still to hand out. */
        private val changeLog = mutableListOf<Pair<HcRecordView?, String?>>()
        private var tokenSeq = 0
        private val tokenPos = mutableMapOf<String, Int>()
        val expired = mutableSetOf<String>()
        var revokeOnReadCall: Int? = null
        private var readCalls = 0

        override suspend fun changesToken(type: HcType): String {
            val t = "tok${++tokenSeq}"
            tokenPos[t] = changeLog.size
            log += "token:$t"
            return t
        }

        override suspend fun read(type: HcType, from: Instant, to: Instant, pageToken: String?, pageSize: Int): HealthConnectReader.Page {
            readCalls++
            if (revokeOnReadCall == readCalls) throw SecurityException("permission revoked")
            log += "read:${pageToken ?: "-"}"
            val all = records.filter { it.type == type && !it.start.isBefore(from) && it.start.isBefore(to) }.sortedBy { it.start }
            val offset = pageToken?.toInt() ?: 0
            val page = all.drop(offset).take(pageSize)
            val next = (offset + pageSize).takeIf { it < all.size }?.toString()
            return HealthConnectReader.Page(page, next)
        }

        override suspend fun changes(token: String): HealthConnectReader.Changes {
            log += "changes:$token"
            if (token in expired) return HealthConnectReader.Changes(emptyList(), emptyList(), token, false, tokenExpired = true)
            val pos = tokenPos.getValue(token)
            val slice = changeLog.drop(pos).take(2)
            val nextPos = pos + slice.size
            val next = "tok${++tokenSeq}".also { tokenPos[it] = nextPos }
            return HealthConnectReader.Changes(
                upserts = slice.mapNotNull { it.first },
                deletedIds = slice.mapNotNull { it.second },
                nextToken = next,
                hasMore = nextPos < changeLog.size,
                tokenExpired = false,
            )
        }

        fun upsert(view: HcRecordView) { records.removeAll { it.id == view.id }; records += view; changeLog += view to null }
        fun delete(id: String) { records.removeAll { it.id == id }; changeLog += null to id }
    }

    class FakeStore : HealthConnectReader.HcStore {
        val rows = linkedMapOf<String, HcRecordEntity>()
        val state = mutableMapOf<String, String>()
        var seq = 0L
        val commits = mutableListOf<Pair<Int, HcChangesCursor>>()
        override suspend fun state(): Map<String, String> = state.toMap()
        override suspend fun existing(keys: List<String>) = keys.mapNotNull { rows[it] }.associateBy { it.key }
        override suspend fun commit(rows: List<HcRecordEntity>, cursor: HcChangesCursor) {
            rows.forEach { this.rows.remove(it.key); this.rows[it.key] = it.copy(seq = ++seq) }
            cursor.allKeys().forEach(state::remove)
            cursor.toState().forEach { state[it.key] = it.value }
            commits += rows.size to cursor
        }
    }

    private val now = Instant.parse("2026-10-27T12:00:00Z")

    private fun steps(id: String, at: Instant, count: Long = 100, origin: String = "com.google.android.apps.fitness",
                      clientId: String? = null, modified: Instant = at, device: Int = Device.TYPE_PHONE) = HcRecordView(
        type = HcType.STEPS, id = id, originPackage = origin,
        device = HcRecordView.DeviceInfo(device, "Google", "Pixel 8"),
        recordingMethod = Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED, clientRecordId = clientId,
        lastModified = modified, start = at, end = at.plusSeconds(600), startOffsetMin = 330, endOffsetMin = 330,
        payload = buildJsonObject { put("count", count) },
    )

    private fun capability(history: Boolean = true, types: List<HcType> = listOf(HcType.STEPS)) = HcCapability.from(
        sdkAvailable = true,
        granted = types.map { it.readPermission }.toSet() + HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND +
            (if (history) setOf(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY) else emptySet()),
        backgroundFeature = true,
        historyFeature = true,
    )

    private fun reader(hc: FakeHc, store: FakeStore, pageSize: Int = 2, natives: Set<String> = setOf("android"), clock: () -> Instant = { now }) =
        HealthConnectReader(hc, store, natives, clock, pageSize = pageSize)

    @Test fun `first run takes the token before the back-fill and paginates it`() = runBlocking {
        val hc = FakeHc()
        (0 until 5).forEach { hc.records += steps("s$it", now.minus(Duration.ofDays(it.toLong() + 1))) }
        val store = FakeStore()
        val result = reader(hc, store).run(capability())
        assertEquals("token:tok1", hc.log.first())
        assertEquals(listOf("read:-", "read:2", "read:4"), hc.log.filter { it.startsWith("read") })
        assertEquals(5, store.rows.size)
        assertEquals(HealthConnectReader.TypeOutcome.CURRENT, result.outcomes[HcType.STEPS])
        // Every page committed with its own page token: a killed job resumes at the next page.
        assertTrue(store.commits.any { it.second.pageToken == "2" })
        assertTrue(HcChangesCursor.decode(HcType.STEPS, store.state).backfillDone)
    }

    @Test fun `history depth is one year with the history permission, else thirty days`() = runBlocking {
        val hc = FakeHc()
        hc.records += steps("old", now.minus(Duration.ofDays(200)))
        hc.records += steps("new", now.minus(Duration.ofDays(3)))
        val withHistory = FakeStore()
        reader(hc, withHistory).run(capability(history = true))
        assertEquals(setOf("Steps:old", "Steps:new"), withHistory.rows.keys)
        val without = FakeStore()
        reader(hc, without).run(capability(history = false))
        assertEquals(setOf("Steps:new"), without.rows.keys)
    }

    @Test fun `changes add revisions, skip unchanged records and turn deletions into tombstones`() = runBlocking {
        val hc = FakeHc()
        hc.records += steps("a", now.minusSeconds(3_600))
        val store = FakeStore()
        reader(hc, store).run(capability())
        val firstSeq = store.rows.getValue("Steps:a").seq

        hc.upsert(steps("a", now.minusSeconds(3_600), count = 140, modified = now))
        hc.upsert(steps("b", now.minusSeconds(1_800)))
        hc.delete("b")
        hc.delete("never-seen")
        reader(hc, store).run(capability())

        val a = store.rows.getValue("Steps:a")
        assertTrue(a.seq > firstSeq)
        assertEquals(140, Json.parseToJsonElement(a.dataJson).jsonObject["payload"]!!.jsonObject["count"]!!.jsonPrimitive.content.toInt())
        assertTrue(store.rows.getValue("Steps:b").deleted)
        assertFalse("a tombstone is never fabricated for a record we never held", "Steps:never-seen" in store.rows)

        // Re-reading the same revision writes nothing new.
        val before = store.seq
        hc.upsert(steps("a", now.minusSeconds(3_600), count = 140, modified = now))
        reader(hc, store).run(capability())
        assertEquals(before, store.seq)
    }

    @Test fun `gauge's own exports never come back`() = runBlocking {
        val hc = FakeHc()
        hc.records += steps("own1", now.minusSeconds(100), origin = "com.pulseloop")
        hc.records += steps("own2", now.minusSeconds(200), origin = "com.pulseloop.debug")
        hc.records += steps("own3", now.minusSeconds(300), origin = "com.other", clientId = "pl-act-steps-1")
        hc.records += steps("theirs", now.minusSeconds(400))
        val store = FakeStore()
        reader(hc, store).run(capability())
        assertEquals(setOf("Steps:theirs"), store.rows.keys)
        hc.delete("own1")
        reader(hc, store).run(capability())
        assertEquals(setOf("Steps:theirs"), store.rows.keys)
    }

    @Test fun `an expired token rescans by id over an overlap and marks the scope stale`() = runBlocking {
        val hc = FakeHc()
        hc.records += steps("a", now.minus(Duration.ofDays(40)))
        val store = FakeStore()
        reader(hc, store).run(capability())
        val token = HcChangesCursor.decode(HcType.STEPS, store.state).token!!
        // 35 days later the token has expired; meanwhile a record changed and one was deleted.
        val later = now.plus(Duration.ofDays(35))
        hc.expired += token
        hc.records += steps("c", later.minus(Duration.ofDays(2)))
        hc.records.removeAll { it.id == "a" }
        reader(hc, store, clock = { later }).run(capability())
        val cursor = HcChangesCursor.decode(HcType.STEPS, store.state)
        assertEquals(HcChangesCursor.SCOPE_STALE, cursor.scope)
        assertTrue(cursor.token != token)
        assertTrue("Steps:c" in store.rows)
        assertFalse("the deletion inside the expired window cannot be known", store.rows.getValue("Steps:a").deleted)
    }

    @Test fun `a permission revoked mid-read keeps what was committed and resumes at the same page`() = runBlocking {
        val hc = FakeHc()
        (0 until 6).forEach { hc.records += steps("s$it", now.minus(Duration.ofDays(it.toLong() + 1))) }
        hc.revokeOnReadCall = 2
        val store = FakeStore()
        val first = reader(hc, store).run(capability(types = listOf(HcType.STEPS, HcType.WEIGHT)))
        assertEquals(HealthConnectReader.TypeOutcome.NO_PERMISSION, first.outcomes[HcType.STEPS])
        assertEquals(HealthConnectReader.TypeOutcome.CURRENT, first.outcomes[HcType.WEIGHT])
        assertEquals(2, store.rows.size)
        assertEquals("2", HcChangesCursor.decode(HcType.STEPS, store.state).pageToken)

        hc.revokeOnReadCall = null
        hc.log.clear()
        reader(hc, store).run(capability())
        assertEquals("read:2", hc.log.first { it.startsWith("read") })
        assertEquals(6, store.rows.size)
    }

    @Test fun `nothing is read without the background permission or a type grant`() = runBlocking {
        val hc = FakeHc()
        hc.records += steps("a", now.minusSeconds(60))
        val store = FakeStore()
        val noBackground = HcCapability.from(true, setOf(HcType.STEPS.readPermission), backgroundFeature = true, historyFeature = true)
        assertTrue(reader(hc, store).run(noBackground).outcomes.isEmpty())
        val noType = capability(types = emptyList())
        assertTrue(reader(hc, store).run(noType).outcomes.isEmpty())
        assertTrue(hc.log.isEmpty())
        assertFalse(HcCapability.UNAVAILABLE.canReadInBackground)
    }

    @Test fun `device-native origin resolves through the legacy name and a synthetic platform source`() = runBlocking {
        val hc = FakeHc()
        hc.records += steps("legacy", now.minusSeconds(100), origin = "android")
        hc.records += steps("synthetic", now.minusSeconds(200), origin = "com.example.devicehealth")
        hc.records += steps("fit", now.minusSeconds(300))
        val store = FakeStore()
        reader(hc, store, natives = setOf(HcCapability.LEGACY_DEVICE_ORIGIN, "com.example.devicehealth")).run(capability())
        fun native(key: String) = Json.parseToJsonElement(store.rows.getValue(key).dataJson).jsonObject["origin_is_device_native"]!!.jsonPrimitive.boolean
        assertTrue(native("Steps:legacy"))
        assertTrue(native("Steps:synthetic"))
        assertFalse(native("Steps:fit"))
        val fit = Json.parseToJsonElement(store.rows.getValue("Steps:fit").dataJson).jsonObject
        assertEquals("phone", fit["device"]!!.jsonObject["type"]!!.jsonPrimitive.content)
        assertEquals("automaticallyRecorded", fit["recording_method"]!!.jsonPrimitive.content)
    }
}
