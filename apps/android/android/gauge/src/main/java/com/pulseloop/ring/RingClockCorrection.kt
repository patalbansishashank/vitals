package com.pulseloop.ring

import android.content.SharedPreferences
import java.time.Duration
import java.time.Instant
import kotlin.math.abs

/**
 * One stretch of a ring's clock history, as the phone measured it just before re-setting it.
 *
 * Until [setAtMs] (phone time) the ring's RTC ran [offsetMs] ahead of the phone (negative =
 * behind), so every record it stamped in that stretch carries a raw time in
 * `[previous set + offset, setAtMs + offsetMs)`. The phone then pushed its own time, starting the
 * next stretch.
 */
data class RingClockSegment(val setAtMs: Long, val offsetMs: Long)

/** Durable home for a ring's [RingClockSegment]s, so a later connection can still un-skew records
 *  that were stamped before an earlier one set the clock. */
interface RingClockStore {
    fun load(): List<RingClockSegment>
    fun save(segments: List<RingClockSegment>)
}

/** Pure offset arithmetic shared by every family. */
object RingClockOffset {
    /** Offsets beyond this are recorded (persisted, logged); smaller ones are BLE latency plus
     *  ordinary RTC drift and only correct the current connection. */
    const val SIGNIFICANT_OFFSET_MS = 60_000L

    /** Ring clock minus phone clock, measured from a ring time read back at [receivedAt]. */
    fun measure(ringTime: Instant, receivedAt: Instant): Long =
        Duration.between(receivedAt, ringTime).toMillis()

    fun isSignificant(offsetMs: Long): Boolean = abs(offsetMs) > SIGNIFICANT_OFFSET_MS

    /** A reading can never have happened after the phone received it. */
    fun notAfter(timestamp: Instant, receivedAt: Instant): Instant =
        if (timestamp.isAfter(receivedAt)) receivedAt else timestamp
}

/**
 * Maps ring-stamped record times onto phone time.
 *
 * A record stamped `raw` belongs to the earliest segment whose old clock could still have
 * produced it (`raw < setAt + offset`), and has that segment's offset taken off. Anything newer
 * was stamped after the last set and is left as is. Every result is clamped to its receipt time.
 *
 * The window `[setAt, setAt + offset)` after a fast clock is set back is genuinely ambiguous (the
 * old and the new clock both produced those raw times). It is read as old-clock: on the
 * connection that set the clock that is the only possibility, and on later connections it makes a
 * re-pulled old record land on the same corrected instant it was first stored at, rather than
 * being stored a second time [offset] later.
 *
 * Records the app stored *before* it learned an offset sit at their raw stamp; their corrected
 * re-pull carries that stamp along ([RingDecodedEvent.ActivityBucket.rawTimestamp]) so the store
 * can drop the stale copy instead of keeping both.
 */
class RingClockCorrector(
    private val store: RingClockStore? = null,
    private val maxSegments: Int = 8,
) {
    private var persisted: List<RingClockSegment> =
        store?.load().orEmpty().sortedBy { it.setAtMs }.takeLast(maxSegments)

    /** The offset measured on this connection, or null before any read-back. */
    @get:Synchronized
    var lastOffsetMs: Long? = null
        private set

    /**
     * Record a ring-clock read-back taken just before the phone sets the ring's time. Returns the
     * offset (ring − phone). A significant offset is persisted and corrects records from then on.
     *
     * A small one is only noted ([lastOffsetMs]). It is not a clock error: the read-back carries
     * whole BCD seconds and arrives after BLE latency, so a right clock measures anywhere in about
     * ±1 s. 2.7.3 shifted the connection's history by that noise, so every connection stored the
     * same ring records under new sub-second keys (Oct 27: one day's steps four times over).
     */
    @Synchronized
    fun recordReadBack(ringTime: Instant, receivedAt: Instant): Long {
        val offset = RingClockOffset.measure(ringTime, receivedAt)
        lastOffsetMs = offset
        if (RingClockOffset.isSignificant(offset)) {
            val segment = RingClockSegment(receivedAt.toEpochMilli(), offset)
            persisted = (persisted + segment).sortedBy { it.setAtMs }.takeLast(maxSegments)
            store?.save(persisted)
        }
        return offset
    }

    /**
     * How far the old clock that stamped [raw] ran ahead (negative = behind), or 0 when [raw] was
     * stamped by a clock the phone has not had to correct. The same raw stamp always gets the same
     * shift, so a re-pulled record lands on the key it was first stored under.
     */
    @Synchronized
    fun offsetAt(raw: Instant): Long {
        val rawMs = raw.toEpochMilli()
        return persisted.firstOrNull { rawMs < it.setAtMs + it.offsetMs }?.offsetMs ?: 0L
    }

    fun correct(raw: Instant, receivedAt: Instant): Instant =
        RingClockOffset.notAfter(raw.minusMillis(offsetAt(raw)), receivedAt)
}

/** [RingClockStore] in SharedPreferences, one key per ring address ("" when unknown). */
class PrefsRingClockStore(
    private val prefs: SharedPreferences,
    private val address: () -> String?,
) : RingClockStore {
    private fun key() = "$KEY_PREFIX${address().orEmpty()}"

    override fun load(): List<RingClockSegment> = parse(prefs.getString(key(), null))

    override fun save(segments: List<RingClockSegment>) {
        prefs.edit()
            .putString(key(), segments.joinToString(";") { "${it.setAtMs},${it.offsetMs}" })
            .apply()
    }

    companion object {
        /** The SharedPreferences file [RingBLEClient] keeps these in. */
        const val PREFS_NAME = "ring_ble"
        private const val KEY_PREFIX = "ring.clockSegments."

        /** Every ring's segments: the database migration that removes their stale copies reads them. */
        fun allSegments(prefs: SharedPreferences): List<RingClockSegment> =
            prefs.all.filterKeys { it.startsWith(KEY_PREFIX) }.values
                .flatMap { parse(it as? String) }
                .filter { RingClockOffset.isSignificant(it.offsetMs) }
                .distinct()
                .sortedBy { it.setAtMs }

        private fun parse(value: String?): List<RingClockSegment> =
            value.orEmpty().split(';').mapNotNull { entry ->
                val parts = entry.split(',')
                if (parts.size != 2) return@mapNotNull null
                val setAt = parts[0].toLongOrNull() ?: return@mapNotNull null
                val offset = parts[1].toLongOrNull() ?: return@mapNotNull null
                RingClockSegment(setAt, offset)
            }
    }
}
