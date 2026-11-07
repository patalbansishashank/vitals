package com.pulseloop.phone

import com.pulseloop.phone.PhoneStepSegmenter.CounterSample
import com.pulseloop.phone.PhoneStepSegmenter.CounterSpan
import com.pulseloop.phone.PhoneStepSegmenter.Diff
import com.pulseloop.phone.PhoneStepSegmenter.UtcAnchor
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneStepSegmenterTest {
    private val t0 = Instant.parse("2026-10-27T09:00:00Z").toEpochMilli()
    private val m0 = 5_000_000_000_000L
    private val anchor = UtcAnchor("a1", "b7", t0, m0)
    private fun m(sec: Double) = m0 + (sec * 1e9).toLong()

    @Test fun `the first sample, a reboot, a time step back and a counter drop are baselines only`() {
        val a = CounterSample("b7", m(0.0), 100, 1)
        assertEquals(Diff.Baseline("first"), PhoneStepSegmenter.difference(null, a))
        assertEquals(Diff.Baseline("reboot"), PhoneStepSegmenter.difference(a, a.copy(bootId = "b8", mNs = m(10.0), count = 5)))
        assertEquals(Diff.Baseline("timeNotAdvancing"), PhoneStepSegmenter.difference(a, a.copy(mNs = m(-1.0), count = 120)))
        assertEquals(Diff.Baseline("counterDrop"), PhoneStepSegmenter.difference(a, a.copy(mNs = m(10.0), count = 40)))
    }

    @Test fun `a same-boot increase is a delta on its real support`() {
        val d = PhoneStepSegmenter.difference(CounterSample("b7", m(0.0), 100, 1), CounterSample("b7", m(30.0), 160, 1))
        assertEquals(Diff.Span(CounterSpan("b7", m(0.0), m(30.0), 60, true)), d)
        val other = PhoneStepSegmenter.difference(CounterSample("b7", m(0.0), 100, 1), CounterSample("b7", m(30.0), 160, 2))
        assertEquals(false, (other as Diff.Span).span.listenedThroughout)
    }

    @Test fun `a delta inside one wall-clock minute is a counter minute`() {
        val r = PhoneStepSegmenter.resolve(CounterSpan("b7", m(5.0), m(50.0), 40, false), anchor, null).single()
        assertEquals(PhoneStepSegmenter.SUPPORT_MINUTE, r.support)
        assertEquals(PhoneStepSegmenter.TIMING_COUNTER, r.timing)
        assertEquals(40, r.steps)
        assertEquals(t0 + 5_000, r.startMs)
        assertEquals("phone_steps:b7:${m(5.0)}", r.subject)
    }

    @Test fun `a delta across minutes without the detector stays one coarse counterSpan`() {
        val r = PhoneStepSegmenter.resolve(CounterSpan("b7", m(0.0), m(3_600.0), 900, true), anchor, null)
        assertEquals(1, r.size)
        assertEquals(PhoneStepSegmenter.SUPPORT_COUNTER_SPAN, r[0].support)
        assertEquals(900, r[0].steps)
        assertEquals(t0 + 3_600_000, r[0].endMs)
    }

    @Test fun `detector timing cuts a listened span into disjoint minute pieces with zeros`() {
        // An idle stretch, then 30 steps in the third minute: zero minutes are observed zeros.
        val steps = (1..30).map { m(150.0 + it) }
        val r = PhoneStepSegmenter.resolve(CounterSpan("b7", m(30.0), m(181.0), 30, true), anchor, steps)
        assertEquals(listOf(30_000L, 60_000L, 120_000L, 180_000L), r.map { it.startMs - t0 })
        // The step exactly on 180 s belongs to the earlier piece, like the counter's (prev, cur].
        assertEquals(listOf(0L, 0L, 30L, 0L), r.map { it.steps })
        assertTrue(r.all { it.support == "minute" && it.timing == "detector" && it.parentSteps == 30L })
        // Pieces tile the support exactly: no overlap, no gap.
        assertEquals(r.drop(1).map { it.startMs }, r.dropLast(1).map { it.endMs })
        assertEquals(m(181.0), r.last().mEndNs)
        assertEquals(30, r.sumOf { it.steps })
    }

    @Test fun `a detector that missed steps falls back to the coarse record`() {
        val steps = (1..50).map { m(100.0 + it) } // counter says 200
        val r = PhoneStepSegmenter.resolve(CounterSpan("b7", m(0.0), m(400.0), 200, true), anchor, steps)
        assertEquals(PhoneStepSegmenter.SUPPORT_COUNTER_SPAN, r.single().support)
        assertEquals(200, r.single().steps)
    }

    @Test fun `a small detector discrepancy - the pieces carry the counter's delta, parent_steps names it`() {
        val steps = (1..98).map { m(60.0 + it * 0.5) }
        val r = PhoneStepSegmenter.resolve(CounterSpan("b7", m(0.0), m(120.0), 100, true), anchor, steps)
        assertEquals(100, r.sumOf { it.steps }) // 2.8.5: the counter's count, placed by the detector (before: 98)
        assertEquals(listOf(0L, 100L), r.map { it.steps })
        assertTrue(r.all { it.parentSteps == 100L })
    }

    // ── 2.8.5 (r068 walk): the count is the counter's; the detector only places it ──
    // The owner's phone: the counter reports about once a second with Δ 1–4, the detector gives
    // about one event a second. 2.8.4 sent each span's detector count (1), not Δ.

    @Test fun `a one-second span of 2 steps with one detector event is 2 steps, not 1`() {
        val r = PhoneStepSegmenter.resolve(CounterSpan("b7", m(10.0), m(11.0), 2, true), anchor, listOf(m(10.9)))
        assertEquals(2L, r.single().steps)
        assertEquals(PhoneStepSegmenter.TIMING_DETECTOR, r.single().timing)
        assertEquals(2L, r.single().parentSteps)
    }

    @Test fun `a span cut at the minute shares the delta by the detector's events, adding up to it`() {
        // Δ = 3 over 59.4–60.6 s: one event each side of the cut; the tie goes to the earlier piece
        val r = PhoneStepSegmenter.resolve(CounterSpan("b7", m(59.4), m(60.6), 3, true), anchor, listOf(m(59.9), m(60.4)))
        assertEquals(listOf(2L, 1L), r.map { it.steps })
        assertEquals(t0 + 60_000, r[1].startMs)
        assertTrue(r.all { it.parentSteps == 3L })
    }

    @Test fun `a span the detector heard nothing of is the counter's record, never pieces of zero`() {
        // 2.8.4: |0 − 2| ≤ 3 let it through as zero-step detector minutes, and the 2 steps were lost
        val inside = PhoneStepSegmenter.resolve(CounterSpan("b7", m(10.0), m(11.0), 2, true), anchor, emptyList()).single()
        assertEquals(PhoneStepSegmenter.TIMING_COUNTER, inside.timing)
        assertEquals(2L, inside.steps)
        val across = PhoneStepSegmenter.resolve(CounterSpan("b7", m(59.5), m(60.5), 2, true), anchor, emptyList()).single()
        assertEquals(PhoneStepSegmenter.SUPPORT_COUNTER_SPAN, across.support)
        assertEquals(2L, across.steps)
    }

    @Test fun `a minute's batch the detector heard 60 percent of is placed in minutes at the counter's count`() {
        // A screen-off batch: Δ = 95 over 60 s, 57 detector events. 2.8.4's 10 % gate sent it coarse.
        val events = (0 until 57).map { m(30.5 + it * 1.05) }
        val r = PhoneStepSegmenter.resolve(CounterSpan("b7", m(30.0), m(90.0), 95, true), anchor, events)
        assertTrue(r.all { it.timing == PhoneStepSegmenter.TIMING_DETECTOR && it.support == PhoneStepSegmenter.SUPPORT_MINUTE })
        assertEquals(95L, r.sumOf { it.steps })
        val heard = r.map { p -> events.count { it > p.mStartNs && it <= p.mEndNs } }
        assertEquals(listOf(29, 28), heard)
        assertEquals(listOf(48L, 47L), r.map { it.steps })
    }

    @Test fun `shareByWeight adds up exactly and follows the weights`() {
        assertEquals(listOf(1L, 1L, 1L), PhoneStepSegmenter.shareByWeight(3, listOf(1, 1, 1)))
        assertEquals(listOf(4L, 3L, 3L), PhoneStepSegmenter.shareByWeight(10, listOf(1, 1, 1)))
        assertEquals(listOf(0L, 7L, 0L), PhoneStepSegmenter.shareByWeight(7, listOf(0, 5, 0)))
        assertEquals(listOf(3849L), PhoneStepSegmenter.shareByWeight(3849, listOf(2400)))
        for (total in 0L..50L) for (w in listOf(listOf(1L, 2L, 3L), listOf(57L, 1L), listOf(0L, 0L, 9L))) {
            val out = PhoneStepSegmenter.shareByWeight(total, w)
            assertEquals(total, out.sum())
            assertTrue(out.all { it >= 0 })
        }
    }

    @Test fun `a span not listened throughout ignores detector events`() {
        val steps = (1..100).map { m(10.0 + it) }
        val r = PhoneStepSegmenter.resolve(CounterSpan("b7", m(0.0), m(300.0), 100, false), anchor, steps)
        assertEquals(PhoneStepSegmenter.SUPPORT_COUNTER_SPAN, r.single().support)
    }

    @Test fun `DST does not touch UTC support`() {
        // 2026-03-29 01:00 UTC, Europe/London springs forward. 2 h of monotonic time is 2 h of UTC.
        val dstUtc = Instant.parse("2026-03-29T00:30:00Z").toEpochMilli()
        val a = UtcAnchor("a2", "b7", dstUtc, m0)
        val r = PhoneStepSegmenter.resolve(CounterSpan("b7", m0, m0 + 7_200_000_000_000L, 500, true), a, (1..500).map { m0 + it * 14_000_000_000L })
        assertEquals(120, r.size)
        assertEquals(dstUtc + 7_200_000, r.last().endMs)
        assertEquals(500, r.sumOf { it.steps })
    }

    @Test fun `a clock jump maps later spans with the new anchor`() {
        val jumped = UtcAnchor("a2", "b7", t0 + 3_600_000 + 100_000, m(100.0)) // clock set forward 1 h at m=100 s
        val before = PhoneStepSegmenter.resolve(CounterSpan("b7", m(10.0), m(40.0), 20, false), anchor, null).single()
        val after = PhoneStepSegmenter.resolve(CounterSpan("b7", m(110.0), m(140.0), 20, false), jumped, null).single()
        assertEquals(t0 + 10_000, before.startMs)
        assertEquals(t0 + 3_600_000 + 110_000, after.startMs)
        assertEquals("a2", after.anchorId)
    }
}
