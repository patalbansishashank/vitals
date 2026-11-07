package com.pulseloop.service

import com.pulseloop.data.ClockDuplicates
import com.pulseloop.data.entity.SleepStageBlockEntity
import com.pulseloop.ring.RingClockSegment

/**
 * Sleep's half of the clock-duplicate rule ([ClockDuplicates]). Sleep is stored as stage blocks,
 * and each packet *replaces* the interval it covers, so a re-pulled packet shifted back by the
 * clock offset `O` does not double a night outright: it replaces all of its raw copy except the
 * raw copy's last `O`, which survives past the corrected packet's end. Across a night of
 * consecutive packets each such stretch is overwritten by the next corrected packet, so what
 * remains is the last `O` of every run, about 6.4 minutes of minutes counted twice, stretching
 * the night and mixing stages. These functions cut exactly that stretch.
 */
object ClockShiftSleep {
    private const val MINUTE = 60_000L

    private fun end(b: SleepStageBlockEntity) = b.startAt + b.durationMinutes * MINUTE

    /**
     * Blocks of the run `[from, until)` cut at [cut]: later ones dropped, a block spanning it
     * shortened. Blocks outside the run are untouched; empty ones go.
     */
    fun cutAt(blocks: List<SleepStageBlockEntity>, cut: Long, from: Long, until: Long): List<SleepStageBlockEntity> =
        blocks.mapNotNull { b ->
            when {
                b.startAt < from || b.startAt >= until || end(b) <= cut -> b
                b.startAt >= cut -> null
                else -> b.copy(durationMinutes = ((cut - b.startAt) / MINUTE).toInt())
            }
        }.filter { it.durationMinutes > 0 }

    /** Contiguous runs (next start under a minute after the previous end), each sorted. */
    fun runs(blocks: List<SleepStageBlockEntity>): List<List<SleepStageBlockEntity>> {
        val out = mutableListOf<MutableList<SleepStageBlockEntity>>()
        for (b in blocks.sortedBy { it.startAt }) {
            val run = out.lastOrNull()
            if (run != null && b.startAt - run.maxOf(::end) < MINUTE) run += b else out += mutableListOf(b)
        }
        return out
    }

    /**
     * Persistence: a corrected packet covering up to [correctedEnd] whose raw copy ran to [rawEnd]
     * was just written. If its run now ends beyond [correctedEnd] but no later than [rawEnd], what
     * lies past [correctedEnd] can only be that raw copy (a later packet, corrected or raw, would
     * reach past [rawEnd]), so it is cut. Returns [blocks] unchanged otherwise.
     */
    fun trimAfterCorrectedPacket(
        blocks: List<SleepStageBlockEntity>,
        correctedEnd: Long,
        rawEnd: Long,
    ): List<SleepStageBlockEntity> {
        val run = runs(blocks).firstOrNull { r -> r.first().startAt < correctedEnd && r.maxOf(::end) >= correctedEnd }
            ?: return blocks
        val runEnd = run.maxOf(::end)
        if (runEnd <= correctedEnd || runEnd > rawEnd + MINUTE) return blocks
        return cutAt(blocks, correctedEnd, from = run.first().startAt, until = runEnd)
    }

    /**
     * Migration: one stored night ([sessionCreatedAt] = when its row was first written). A run is
     * one 2.7.3 re-pulled over a raw copy when it holds corrected-grid blocks (whole seconds minus
     * the offset's remainder), its corrected data ends before the clock was set, and a raw copy
     * existed: the row was written before the set, or the run still has blocks on the ring's own
     * whole-second grid. Its last `O` is then the surviving raw copy and is cut. A night first
     * received corrected (after the set) or never re-pulled is left alone.
     */
    fun trimStoredRuns(
        blocks: List<SleepStageBlockEntity>,
        segments: List<RingClockSegment>,
        sessionCreatedAt: Long? = null,
    ): List<SleepStageBlockEntity> {
        val usable = ClockDuplicates.usable(segments)
        if (usable.isEmpty()) return blocks.filter { it.durationMinutes > 0 }
        var out = blocks.filter { it.durationMinutes > 0 }
        for (run in runs(out)) {
            val start = run.first().startAt
            val runEnd = run.maxOf(::end)
            val segment = usable.firstOrNull { start < it.setAtMs } ?: continue
            val corrected = Math.floorMod(-segment.offsetMs, 1000L)
            val hasCorrected = run.any { Math.floorMod(it.startAt, 1000L) == corrected }
            val hasRaw = run.any { Math.floorMod(it.startAt, 1000L) == 0L && it.startAt < segment.setAtMs + segment.offsetMs }
            val storedRawFirst = hasRaw || (sessionCreatedAt != null && sessionCreatedAt < segment.setAtMs)
            if (!hasCorrected || !storedRawFirst || runEnd - segment.offsetMs > segment.setAtMs + MINUTE) continue
            // The tail survived as whole minutes (a split block keeps floor((end - cut) / 1 min)),
            // so it is floor(O) long, not O: cut there, or the corrected packet loses its last minute.
            out = cutAt(out, runEnd - (Math.abs(segment.offsetMs) / MINUTE) * MINUTE, from = start, until = runEnd)
        }
        return out
    }
}
