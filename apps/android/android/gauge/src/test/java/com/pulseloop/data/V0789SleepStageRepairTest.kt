package com.pulseloop.data

import com.pulseloop.data.entity.RawPacketEntity
import com.pulseloop.data.entity.SleepSessionEntity
import com.pulseloop.data.entity.SleepStageBlockEntity
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class V0789SleepStageRepairTest {
    private val utc = ZoneId.of("UTC")
    private val start = LocalDateTime.of(2026, 9, 16, 2, 33, 59)
        .atZone(utc).toInstant().toEpochMilli()

    @Test
    fun `exact V0789 byte five evidence repairs unknown and recomputes asleep minutes`() {
        val session = session(total = 5)
        val blocks = listOf(block("u", 0, 2, "UNKNOWN"), block("l", 2, 3, "LIGHT"))
        val evidence = V0789SleepStageRepair.awakeMinuteEvidence(
            listOf(packet("V0789", listOf(5, 5, 2, 2, 2))), utc)

        val repaired = V0789SleepStageRepair.repair(session, blocks, evidence)!!

        assertEquals(listOf("AWAKE", "LIGHT"), repaired.blocks.map { it.stageRaw })
        assertEquals(3, repaired.asleepMinutes)
    }

    @Test
    fun `partial evidence splits a block while overlap disagreement stays unknown`() {
        val session = session(total = 4)
        val blocks = listOf(block("u", 0, 4, "UNKNOWN"))
        val packets = listOf(
            packet("V0789", listOf(5, 5, 5, 5)),
            packet("V0789", listOf(5, 2, 5, 5)), // minute one conflicts and must not be repaired
        )
        val evidence = V0789SleepStageRepair.awakeMinuteEvidence(packets, utc)

        val repaired = V0789SleepStageRepair.repair(session, blocks, evidence)!!

        assertEquals(listOf("AWAKE", "UNKNOWN", "AWAKE"), repaired.blocks.map { it.stageRaw })
        assertEquals(listOf(1, 1, 2), repaired.blocks.map { it.durationMinutes })
        // SPEC GA.9: the unresolved UNKNOWN minute is no longer counted as asleep.
        assertEquals(0, repaired.asleepMinutes)
    }

    @Test
    fun `missing or wrong provenance changes nothing`() {
        val blocks = listOf(block("u", 0, 2, "UNKNOWN"))
        val wrongFirmware = V0789SleepStageRepair.awakeMinuteEvidence(
            listOf(packet("V0525", listOf(5, 5))), utc)
        val wrongFamily = V0789SleepStageRepair.awakeMinuteEvidence(
            listOf(packet("V0789", listOf(5, 5), deviceType = "CRP")), utc)

        assertNull(V0789SleepStageRepair.repair(session(total = 2), blocks, wrongFirmware))
        assertNull(V0789SleepStageRepair.repair(session(total = 2), blocks, wrongFamily))
        assertNull(V0789SleepStageRepair.repair(session(total = 2, source = "demo"), blocks, setOf(start)))
        assertNull(V0789SleepStageRepair.repair(
            session(total = 2, source = "health_connect"), blocks, setOf(start)))
    }

    @Test
    fun `outbound and truncated packets are not evidence`() {
        val outbound = packet("V0789", listOf(5, 5), direction = "OUTGOING")
        val truncated = packet("V0789", listOf(5, 5)).copy(
            // The header promises a third minute that is not present.
            hexPayload = packet("V0789", listOf(5, 5)).hexPayload.replaceRange(18, 20, "03"),
        )

        assertEquals(emptySet<Long>(),
            V0789SleepStageRepair.awakeMinuteEvidence(listOf(outbound, truncated), utc))
    }

    @Test
    fun `repair is idempotent when applied repeatedly`() {
        val session = session(total = 3)
        val evidence = setOf(start, start + 60_000L)
        val first = V0789SleepStageRepair.repair(
            session,
            listOf(block("u", 0, 2, "UNKNOWN"), block("l", 2, 1, "LIGHT")),
            evidence,
        )!!

        assertNull(V0789SleepStageRepair.repair(
            session.copy(totalMinutes = first.asleepMinutes), first.blocks, evidence))
    }

    @Test
    fun `leading wake and wake after sleep are both repaired without deleting the span`() {
        val session = session(total = 9)
        val blocks = listOf(
            block("pre", 0, 3, "UNKNOWN"),
            block("sleep-a", 3, 2, "LIGHT"),
            block("waso", 5, 2, "UNKNOWN"),
            block("sleep-b", 7, 2, "DEEP"),
        )
        val raw = listOf(5, 5, 5, 2, 2, 5, 5, 1, 1)
        val evidence = V0789SleepStageRepair.awakeMinuteEvidence(
            listOf(packet("V0789", raw)), utc)

        val repaired = V0789SleepStageRepair.repair(session, blocks, evidence)!!

        assertEquals(listOf("AWAKE", "LIGHT", "AWAKE", "DEEP"), repaired.blocks.map { it.stageRaw })
        assertEquals(4, repaired.asleepMinutes)
        assertEquals(start, repaired.blocks.first().startAt)
        assertEquals(start + 9 * 60_000L,
            repaired.blocks.last().startAt + repaired.blocks.last().durationMinutes * 60_000L)
    }

    private fun session(total: Int, source: String = "ring") = SleepSessionEntity(
        id = "s", date = start, startAt = start, endAt = start + total * 60_000L,
        totalMinutes = total, sourceRaw = source,
    )

    private fun block(id: String, offset: Int, duration: Int, stage: String) =
        SleepStageBlockEntity(
            id = id, sessionId = "s", startAt = start + offset * 60_000L,
            startMinute = offset, durationMinutes = duration, stageRaw = stage,
        )

    private fun packet(
        firmware: String,
        stages: List<Int>,
        deviceType: String = "JSTYLE_2301",
        direction: String = "INCOMING",
    ): RawPacketEntity {
        val bytes = ByteArray(10 + stages.size)
        bytes[0] = 0x53
        bytes[3] = bcd(26)
        bytes[4] = bcd(9)
        bytes[5] = bcd(16)
        bytes[6] = bcd(2)
        bytes[7] = bcd(33)
        bytes[8] = bcd(59)
        bytes[9] = stages.size.toByte()
        stages.forEachIndexed { index, value -> bytes[10 + index] = value.toByte() }
        return RawPacketEntity(
            directionRaw = direction,
            commandId = 0x53,
            hexPayload = bytes.joinToString("") { "%02x".format(it) },
            decodedKind = "sleep_timeline",
            deviceTypeRaw = deviceType,
            firmwareRevision = firmware,
        )
    }

    private fun bcd(value: Int): Byte = (((value / 10) shl 4) or (value % 10)).toByte()
}
