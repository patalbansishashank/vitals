package com.pulseloop.data

import com.pulseloop.data.entity.RawPacketEntity
import com.pulseloop.data.entity.SleepSessionEntity
import com.pulseloop.data.entity.SleepStageBlockEntity
import com.pulseloop.ring.RingDeviceType
import com.pulseloop.ring.PacketDirection
import com.pulseloop.ring.SleepStage
import com.pulseloop.service.asleepMinutes
import java.time.DateTimeException
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/**
 * Evidence-gated repair for the V0789 sleep byte whose meaning was resolved after it had already
 * been persisted as [SleepStage.UNKNOWN]. Sleep rows do not carry firmware or the original byte,
 * so this helper never guesses from the current device or rewrites UNKNOWN globally. It changes a
 * minute only when a stored V0789 raw sleep packet proves that exact timestamp carried byte 5.
 */
internal object V0789SleepStageRepair {
    private const val SLEEP_OPCODE = 0x53
    private const val RESOLVED_AWAKE_CODE = 5
    private const val MINUTE_MS = 60_000L

    data class RepairedSession(
        val blocks: List<SleepStageBlockEntity>,
        val asleepMinutes: Int,
    )

    /**
     * Returns only unambiguous V0789/raw-5 minutes. Duplicate packets are harmless; if overlapping
     * captures disagree about a minute, that minute is deliberately excluded from the evidence.
     */
    fun awakeMinuteEvidence(
        packets: List<RawPacketEntity>,
        zoneId: ZoneId = ZoneId.systemDefault(),
    ): Set<Long> {
        val observedCodes = mutableMapOf<Long, MutableSet<Int>>()
        packets.asSequence()
            .filter { it.firmwareRevision?.trim()?.uppercase() == "V0789" }
            .filter { it.decodedKind == "sleep_timeline" }
            .filter { it.directionRaw == PacketDirection.INCOMING.name }
            // deviceTypeRaw was added after raw-packet persistence. A null family on an older row
            // is still admissible because the exact V0789 firmware profile is unique to this
            // protocol; a present family must agree and can never be inferred from today's ring.
            .filter { it.deviceTypeRaw == null || it.deviceTypeRaw == RingDeviceType.JSTYLE_2301.name }
            .forEach { packet ->
                val bytes = decodeHex(packet.hexPayload) ?: return@forEach
                if (bytes.size < 10 || bytes[0].u8() != SLEEP_OPCODE) return@forEach
                val start = timestamp(bytes, zoneId) ?: return@forEach
                val count = bytes[9].u8()
                if (count > bytes.size - 10) return@forEach
                repeat(count) { offset ->
                    val minute = start + offset * MINUTE_MS
                    observedCodes.getOrPut(minute) { mutableSetOf() }.add(bytes[10 + offset].u8())
                }
            }
        return observedCodes.asSequence()
            .filter { (_, codes) -> codes.size == 1 && RESOLVED_AWAKE_CODE in codes }
            .map { it.key }
            .toSet()
    }

    /** Repairs a real ring session, preserving every unmatched UNKNOWN minute and all named data. */
    fun repair(
        session: SleepSessionEntity,
        blocks: List<SleepStageBlockEntity>,
        awakeMinutes: Set<Long>,
    ): RepairedSession? {
        if (session.sourceRaw != "ring" || awakeMinutes.isEmpty()) return null
        var changed = false
        val repaired = blocks.flatMap { block ->
            if (block.stageRaw != SleepStage.UNKNOWN.name || block.durationMinutes <= 0) {
                return@flatMap listOf(block)
            }
            val resolved = BooleanArray(block.durationMinutes) { offset ->
                block.startAt + offset * MINUTE_MS in awakeMinutes
            }
            if (resolved.none { it }) return@flatMap listOf(block)
            changed = true
            split(block, resolved)
        }.sortedBy { it.startAt }
        if (!changed) return null
        return RepairedSession(repaired, asleepMinutes(repaired))
    }

    private fun split(
        block: SleepStageBlockEntity,
        resolved: BooleanArray,
    ): List<SleepStageBlockEntity> = buildList {
        var runStart = 0
        var runResolved = resolved[0]
        for (offset in 1..resolved.size) {
            val continues = offset < resolved.size && resolved[offset] == runResolved
            if (continues) continue
            val id = if (runStart == 0) block.id
            else "${block.id}:v0789-awake:$runStart"
            add(block.copy(
                id = id,
                startAt = block.startAt + runStart * MINUTE_MS,
                startMinute = block.startMinute + runStart,
                durationMinutes = offset - runStart,
                stageRaw = if (runResolved) SleepStage.AWAKE.name else SleepStage.UNKNOWN.name,
            ))
            if (offset < resolved.size) {
                runStart = offset
                runResolved = resolved[offset]
            }
        }
    }

    private fun timestamp(packet: ByteArray, zoneId: ZoneId): Long? {
        val fields = (3..8).map { bcd(packet[it]) ?: return null }
        return try {
            LocalDateTime.of(
                LocalDate.of(2000 + fields[0], fields[1], fields[2]),
                LocalTime.of(fields[3], fields[4], fields[5]),
            ).atZone(zoneId).toInstant().toEpochMilli()
        } catch (_: DateTimeException) {
            null
        }
    }

    private fun decodeHex(value: String): ByteArray? {
        if (value.length % 2 != 0) return null
        return runCatching {
            ByteArray(value.length / 2) { index ->
                value.substring(index * 2, index * 2 + 2).toInt(16).toByte()
            }
        }.getOrNull()
    }

    private fun bcd(byte: Byte): Int? {
        val raw = byte.u8()
        val high = raw ushr 4
        val low = raw and 0x0F
        return if (high <= 9 && low <= 9) high * 10 + low else null
    }

    private fun Byte.u8(): Int = toInt() and 0xFF
}
