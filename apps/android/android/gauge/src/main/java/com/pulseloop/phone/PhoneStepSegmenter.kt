package com.pulseloop.phone

import kotlin.math.abs
import kotlin.math.ceil

/**
 * Pure differencing and record building for the phone's `TYPE_STEP_COUNTER` (energy SPEC §GB.1,
 * RESEARCH II.2). No Android types, so the tests drive it directly.
 *
 * **Differencing.** Same boot, `m_i > m_{i−1}` and `C_i ≥ C_{i−1}` → `Δ = C_i − C_{i−1}` on the
 * support `(m_{i−1}, m_i]`. Anything else (the first sample, a reboot, time going backwards, the
 * counter dropping) starts a new segment: the sample becomes a baseline and that Δ stays unknown.
 * Nothing is ever interpolated.
 *
 * **Records.** A delta becomes, in this order of preference:
 * 1. **Detector minutes** (`support:'minute'`, `timing:'detector'`) — only when the step detector
 *    was listening for the whole span ([CounterSpan.listenedThroughout]), heard at least one step
 *    in it, and its event count agrees with Δ within [detectorTolerance]. The span is cut at
 *    wall-clock minute boundaries; each piece carries its **share of Δ**, placed by the detector's
 *    events (largest remainder: the pieces always add up to Δ; a listening minute with no detector
 *    events is an observed zero for the phone — it says nothing about carry), and
 *    `parent_steps = Δ`. Pieces never overlap the neighbouring spans, so a wall-clock minute split
 *    between two spans is two disjoint records, never a double count.
 *    (P: engineering addition, not in RESEARCH — flagged for review, SPEC §0 / notes C13.)
 *
 *    (2.8.5, r068 walk) The count is always the counter's: the detector only places it. Before,
 *    each piece carried the detector's own count, and a detector that hears fewer steps than the
 *    counter lost the difference on every span the tolerance let through. The owner's phone reports
 *    the counter about once a second (Δ 1–4) and gives about one detector event a second, so a
 *    span of Δ = 2 went up as 1 step: an evening walk the counter (and the phone's own step app)
 *    put at ~3,850 steps over 40 minutes read 2,615 for the whole outing.
 * 2. **A counter minute** (`support:'minute'`, `timing:'counter'`) — the whole support lies inside
 *    one wall-clock minute.
 * 3. **One `counterSpan`** with Δ over its real support. The counter is on-change, so the first
 *    delta after a quiet period spans that whole period: coarse, and kept coarse.
 *
 * The detector agreement gate is a product default (P): a non-wake-up detector loses events when
 * its FIFO overflows while the phone sleeps, and timing the delta by a detector that missed most
 * steps would misplace them. Such a span falls back to the honest coarse record. Since 2.8.5 the
 * gate guards only the placement (the total is Δ either way), so it lets a detector that heard
 * half the steps place them: the owner's hears about 60 % of them, evenly.
 */
object PhoneStepSegmenter {
    const val SUPPORT_MINUTE = "minute"
    const val SUPPORT_COUNTER_SPAN = "counterSpan"
    const val TIMING_DETECTOR = "detector"
    const val TIMING_COUNTER = "counter"
    private const val MINUTE_MS = 60_000L
    private const val NS_PER_MS = 1_000_000L

    /** One counter sample: boot, monotonic event time (ns, elapsed-realtime base), cumulative count. */
    data class CounterSample(
        val bootId: String,
        val mNs: Long,
        val count: Long,
        /** The listener registration that delivered it. */
        val listenId: Long,
    )

    /** `UTC = utcMs + (m − mNs)`. */
    data class UtcAnchor(val id: String, val bootId: String, val utcMs: Long, val mNs: Long) {
        fun utcMsAt(m: Long): Long = utcMs + Math.floorDiv(m - mNs, NS_PER_MS)
        fun mAt(utc: Long): Long = mNs + (utc - utcMs) * NS_PER_MS
    }

    sealed interface Diff {
        /** A new segment begins; no count is known for the time before this sample. */
        data class Baseline(val reason: String) : Diff
        data class Span(val span: CounterSpan) : Diff
    }

    /** A counter delta on its support `(mStartNs, mEndNs]`. */
    data class CounterSpan(
        val bootId: String,
        val mStartNs: Long,
        val mEndNs: Long,
        val steps: Long,
        /** Both ends came from one listener registration, so a detector heard all of it. */
        val listenedThroughout: Boolean,
    )

    data class Record(
        val startMs: Long,
        val endMs: Long,
        val steps: Long,
        val support: String,
        val timing: String,
        val parentSteps: Long?,
        val bootId: String,
        val mStartNs: Long,
        val mEndNs: Long,
        val anchorId: String,
    ) {
        /** The event subject (§2.1): `phone_steps:<boot_id>:<m_start_ns>`. */
        val subject: String get() = "phone_steps:$bootId:$mStartNs"
    }

    fun difference(prev: CounterSample?, cur: CounterSample): Diff = when {
        prev == null -> Diff.Baseline("first")
        prev.bootId != cur.bootId -> Diff.Baseline("reboot")
        cur.mNs <= prev.mNs -> Diff.Baseline("timeNotAdvancing")
        cur.count < prev.count -> Diff.Baseline("counterDrop")
        else -> Diff.Span(
            CounterSpan(
                bootId = cur.bootId,
                mStartNs = prev.mNs,
                mEndNs = cur.mNs,
                steps = cur.count - prev.count,
                listenedThroughout = prev.listenId == cur.listenId,
            ),
        )
    }

    /**
     * (P) How far the detector's count may sit from the counter's Δ and still place it: half of Δ
     * (at least 3). 2.8.5: it only places Δ now (the pieces add up to Δ), so 10 % was needlessly
     * strict — a detector hearing 60 % of the steps sent every longer span coarse.
     */
    fun detectorTolerance(delta: Long): Long = maxOf(3L, ceil(delta * 0.50).toLong())

    /**
     * The records for one span. [detectorTimesNs] are the step-detector event times inside the
     * span, or null when no detector was listening (no sensor, or not registered throughout).
     */
    fun resolve(span: CounterSpan, anchor: UtcAnchor, detectorTimesNs: List<Long>?): List<Record> {
        val start = anchor.utcMsAt(span.mStartNs)
        val end = maxOf(anchor.utcMsAt(span.mEndNs), start + 1)
        val detector = detectorTimesNs
            ?.takeIf { span.listenedThroughout }
            ?.filter { it > span.mStartNs && it <= span.mEndNs }
        if (detector != null && detector.isNotEmpty() && abs(detector.size - span.steps) <= detectorTolerance(span.steps)) {
            return detectorMinutes(span, anchor, start, end, detector)
        }
        val support = if (Math.floorDiv(start, MINUTE_MS) == Math.floorDiv(end - 1, MINUTE_MS)) SUPPORT_MINUTE else SUPPORT_COUNTER_SPAN
        return listOf(
            Record(start, end, span.steps, support, TIMING_COUNTER, null, span.bootId, span.mStartNs, span.mEndNs, anchor.id),
        )
    }

    private fun detectorMinutes(span: CounterSpan, anchor: UtcAnchor, start: Long, end: Long, detector: List<Long>): List<Record> {
        data class Piece(val start: Long, val end: Long, val mStart: Long, val mEnd: Long, val heard: Long)
        val pieces = mutableListOf<Piece>()
        var pieceStart = start
        var pieceMStart = span.mStartNs
        while (pieceStart < end) {
            val minuteEnd = (Math.floorDiv(pieceStart, MINUTE_MS) + 1) * MINUTE_MS
            val pieceEnd = minOf(minuteEnd, end)
            val pieceMEnd = if (pieceEnd == end) span.mEndNs else anchor.mAt(pieceEnd)
            // Half-open in m too: an event exactly on a cut belongs to the earlier piece, the way
            // the counter assigns a count to (prev, cur].
            pieces += Piece(pieceStart, pieceEnd, pieceMStart, pieceMEnd, detector.count { it > pieceMStart && it <= pieceMEnd }.toLong())
            pieceStart = pieceEnd
            pieceMStart = pieceMEnd
        }
        val shares = shareByWeight(span.steps, pieces.map { it.heard })
        return pieces.mapIndexed { i, p ->
            Record(p.start, p.end, shares[i], SUPPORT_MINUTE, TIMING_DETECTOR, span.steps, span.bootId, p.mStart, p.mEnd, anchor.id)
        }
    }

    /**
     * (2.8.5) [total] shared in proportion to [weights] by largest remainder (ties to the earlier
     * piece): non-negative, adding up to [total] exactly. Weights must not all be zero.
     */
    fun shareByWeight(total: Long, weights: List<Long>): List<Long> {
        val sum = weights.sum()
        require(sum > 0 && total >= 0 && weights.all { it >= 0 })
        val floors = weights.map { Math.multiplyExact(total, it) / sum }
        val remainders = weights.map { Math.multiplyExact(total, it) % sum }
        var left = total - floors.sum()
        val out = floors.toMutableList()
        for (i in weights.indices.sortedWith(compareByDescending<Int> { remainders[it] }.thenBy { it })) {
            if (left <= 0) break
            out[i] = out[i] + 1
            left--
        }
        return out
    }
}
