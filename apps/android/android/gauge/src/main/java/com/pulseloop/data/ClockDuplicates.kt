package com.pulseloop.data

import com.pulseloop.ring.RingClockOffset
import com.pulseloop.ring.RingClockSegment

/**
 * Which stored copies of one ring series are duplicates left by 2.7.3's clock correction. One rule
 * for every history type (steps, heart rate, SpO2, HRV, stress, temperature, vendor estimates):
 *
 * - A record's identity is its **canonical stamp**: the raw ring stamp shifted by the persisted
 *   offset of the clock that stamped it ([RingClockSegment]), which is what 2.7.4 produces on every
 *   re-pull. The ring stamps whole seconds, so canonical stamps sit on a grid of whole seconds plus
 *   each segment's fixed sub-second remainder ([canonicalFractions]).
 * - **Raw twin**: a copy at the raw stamp `r` of a record whose canonical copy `r − offset` is also
 *   stored. The raw one goes. For a date-stamped value ([Stamp.DATE], the J-Style day totals) the
 *   date is the identity, so it is the *shifted* copy that goes.
 * - **Near copy**: a copy under [SAME_RECORD_MS] from another, off the canonical grid (2.7.3 shifted
 *   each connection's history by that connection's sub-second read-back noise). Two genuine
 *   readings are at least a whole second apart, so nothing genuine is that close; for dense series
 *   (heart rate has real readings one second apart) the value must match as well.
 * - Sleep is stored as stage blocks, not rows: see [com.pulseloop.service.ClockShiftSleep].
 */
object ClockDuplicates {
    /** Under a second: closer than two whole-second ring stamps can be. */
    const val SAME_RECORD_MS = 999L

    enum class Stamp { RING_CLOCK, DATE }

    data class Row<K>(val key: K, val at: Long, val value: Double, val updatedAt: Long)

    fun usable(segments: List<RingClockSegment>): List<RingClockSegment> =
        segments.filter { RingClockOffset.isSignificant(it.offsetMs) && it.offsetMs % 1000 != 0L }
            .sortedBy { it.setAtMs }

    fun canonicalFractions(segments: List<RingClockSegment>): Set<Long> =
        setOf(0L) + usable(segments).map { Math.floorMod(-it.offsetMs, 1000L) }

    /** The earliest segment whose old clock could have stamped [raw] (as RingClockCorrector reads it). */
    fun segmentFor(raw: Long, segments: List<RingClockSegment>): RingClockSegment? =
        segments.firstOrNull { raw < it.setAtMs + it.offsetMs }

    /**
     * The duplicates among [rows], all of one series. [isDayStart] tells a local midnight, for
     * [Stamp.DATE]. Buckets need not match value as near copies (they sit a minute apart, and the
     * bucket still filling grows between pulls); dense series must. Pure, shared with the tests.
     */
    fun <K> find(
        rows: List<Row<K>>,
        segments: List<RingClockSegment>,
        twinsMatchValue: Boolean = true,
        nearMatchValue: Boolean = true,
        stamp: Stamp = Stamp.RING_CLOCK,
        isDayStart: (Long) -> Boolean = { false },
    ): List<Row<K>> {
        val usable = usable(segments)
        val sorted = rows.sortedBy { it.at }
        val byAt = HashMap<Long, Row<K>>(sorted.size * 2).also { m -> sorted.forEach { m[it.at] = it } }
        val removed = LinkedHashMap<K, Row<K>>()

        for (row in sorted) when (stamp) {
            Stamp.RING_CLOCK -> {
                val segment = segmentFor(row.at, usable) ?: continue
                val corrected = byAt[row.at - segment.offsetMs] ?: continue
                if (!twinsMatchValue || corrected.value == row.value) removed[row.key] = row
            }
            Stamp.DATE -> for (segment in usable) {
                val raw = row.at + segment.offsetMs
                if (isDayStart(raw) && segmentFor(raw, usable) == segment && byAt[raw] != null) {
                    removed[row.key] = row
                    break
                }
            }
        }

        val fractions = canonicalFractions(segments)
        val left = sorted.filter { it.key !in removed }
        var lo = 0
        for ((i, row) in left.withIndex()) {
            while (left[lo].at < row.at - SAME_RECORD_MS) lo++
            if (Math.floorMod(row.at, 1000L) in fractions) continue
            val siblings = buildList {
                var j = lo
                while (j < left.size && left[j].at <= row.at + SAME_RECORD_MS) {
                    val other = left[j]
                    if (j != i && other.key !in removed && (!nearMatchValue || other.value == row.value)) add(other)
                    j++
                }
            }
            if (siblings.isEmpty()) continue
            val keep = siblings.firstOrNull { Math.floorMod(it.at, 1000L) in fractions }
                ?: (siblings + row).maxWith(compareBy<Row<K>>({ it.updatedAt }, { it.at }))
            if (keep !== row) removed[row.key] = row
        }
        return removed.values.toList()
    }
}
