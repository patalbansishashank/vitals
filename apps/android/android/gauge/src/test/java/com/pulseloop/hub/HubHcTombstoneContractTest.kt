package com.pulseloop.hub

import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import com.pulseloop.health.reader.HcCapability
import com.pulseloop.health.reader.HcRecordView
import com.pulseloop.health.reader.HcType
import com.pulseloop.health.reader.HealthConnectReader
import com.pulseloop.health.reader.HealthConnectReaderTest
import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Contract: a Health Connect deletion, read by the real reader and mapped by the real hub source,
 * is an `hc/deleted` event the server accepts and applies (`lumenStore.ts` `checkEvent` +
 * `hcDeletedOk`, `lumenMigrate.ts` `hc_records`: a tombstone retracts a record when its
 * `observed_at` is at or after the record's `last_modified`). The regexes and the type list are
 * copied from the server so a drift on either side fails here.
 */
class HubHcTombstoneContractTest {
    private val serverId = Regex("^[A-Za-z0-9._:-]{1,128}$")
    private val serverName = Regex("^[A-Za-z0-9._-]{1,128}$")
    private val serverSubject = Regex("^[A-Za-z0-9._:-]{1,128}$")
    private val serverCategory = Regex("^[a-z0-9_]+(?:/[a-z0-9_-]+)?$")
    private val serverHcTypes = listOf(
        "Steps", "Distance", "Speed", "Power", "HeartRate", "ExerciseSession", "ActiveCaloriesBurned",
        "TotalCaloriesBurned", "BasalMetabolicRate", "Weight", "RestingHeartRate", "SleepSession",
    )

    @Test fun `every reader type is one the server accepts`() {
        assertEquals(serverHcTypes.toSet(), HcType.entries.map { it.recordType }.toSet())
    }

    @Test fun `a deletion read from Health Connect uploads as an hc deleted event the server accepts`() = runBlocking {
        val readAt = Instant.parse("2026-10-27T12:00:00Z")
        val deletedAt = Instant.parse("2026-10-27T13:30:00Z")
        var clock = readAt
        val modified = readAt.minusSeconds(600)
        val hc = HealthConnectReaderTest.FakeHc()
        val recordId = "0f8e7d6c-5b4a-3921-8070-6f5e4d3c2b1a"
        hc.records += HcRecordView(
            type = HcType.STEPS, id = recordId, originPackage = "com.google.android.apps.fitness",
            device = HcRecordView.DeviceInfo(Device.TYPE_PHONE, "Google", "Pixel 8"),
            recordingMethod = Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED, clientRecordId = null,
            lastModified = modified, start = readAt.minusSeconds(3_600), end = readAt.minusSeconds(3_000),
            startOffsetMin = 330, endOffsetMin = 330, payload = buildJsonObject { put("count", 420) },
        )
        val store = HealthConnectReaderTest.FakeStore()
        val reader = HealthConnectReader(hc, store, setOf("android"), { clock })
        val capability = HcCapability.from(
            true, setOf(HcType.STEPS.readPermission, HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND),
            backgroundFeature = true, historyFeature = true,
        )
        reader.run(capability)
        clock = deletedAt
        hc.delete(recordId)
        reader.run(capability)

        val installation = "0123456789abcdef0123456789abcdef"
        val uploadAt = deletedAt.plusSeconds(5)
        val rows = store.rows.values.sortedBy { it.seq }.mapNotNull { HubHealthConnectSource.event(it, installation, uploadAt) }
        // The record row was revised into the tombstone (same key), so only the tombstone is left.
        val tomb = rows.single()
        assertEquals(HubHealthConnectSource.DELETED_CATEGORY, tomb.category)
        val e = Json.parseToJsonElement(tomb.payloadJson).jsonObject
        fun s(o: JsonObject, k: String) = o[k]!!.jsonPrimitive.content

        // checkEvent
        assertEquals("1.0", s(e, "specversion"))
        assertTrue(serverId.matches(s(e, "id")))
        assertEquals("com.pulseloop.hc.deleted.v1", s(e, "type"))
        assertTrue(serverName.matches(s(e, "type")))
        assertEquals("urn:pulseloop:installation:$installation", s(e, "source"))
        assertTrue(serverSubject.matches(s(e, "subject")))
        assertEquals("hc/deleted", s(e, "category"))
        assertTrue(serverCategory.matches(s(e, "category")))
        Instant.parse(s(e, "time"))
        val d = e["data"]!!.jsonObject
        assertEquals(1, d["schema_version"]!!.jsonPrimitive.intOrNull)
        val observed = Instant.parse(s(d, "observed_at"))
        assertEquals(uploadAt, Instant.parse(s(d, "received_at")))

        // hcDeletedOk: an allowed type, subject `<recordType>:<hc id>` with a safe id
        assertEquals("Steps", s(d, "record_type"))
        assertTrue(s(d, "record_type") in serverHcTypes)
        val subject = s(e, "subject")
        assertEquals("Steps:$recordId", subject)
        assertTrue(Regex("^[A-Za-z0-9._-]{1,100}$").matches(subject.removePrefix("Steps:")))

        // hc_records: the same subject as the record it retracts, observed at or after its revision
        assertEquals(deletedAt, observed)
        assertTrue(!observed.isBefore(modified))
        assertTrue("a deletion is not a revision", "payload" !in d && "last_modified" !in d)
    }
}
