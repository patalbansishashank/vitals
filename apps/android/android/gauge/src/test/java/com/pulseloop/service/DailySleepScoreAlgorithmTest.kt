package com.pulseloop.service

import com.pulseloop.data.entity.SleepSessionEntity
import com.pulseloop.data.entity.SleepStageBlockEntity
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DailySleepScoreAlgorithmTest {
    private val zone = ZoneId.of("UTC")
    private val currentDate = LocalDate.of(2026, 9, 16)
    private val currentDay = currentDate.atStartOfDay(zone).toInstant().toEpochMilli()

    @Test
    fun `duration sums naps while continuity comes only from primary after sleep onset`() {
        val primary = session("night", currentDate, 2, 8, 300)
        val nap = session("nap", currentDate, 15, 16, 30)
        val blocks = mapOf(
            primary.id to timeline(primary, listOf("AWAKE" to 30, "LIGHT" to 150,
                "AWAKE" to 30, "DEEP" to 150)),
            nap.id to timeline(nap, listOf("LIGHT" to 30)),
        )

        val result = DailySleepScoreAlgorithm.calculate(
            listOf(primary, nap), blocks, SleepScoreContext(targetMinutes = 480, zoneId = zone))!!

        assertEquals(330, result.totalSleepMinutes)
        assertEquals(30, result.awakeAfterOnsetMinutes) // leading 30m wake is excluded
        assertEquals(90.9, result.sleepEfficiencyPercent!!, 0.1)
        assertEquals(2.0 / 3.0, result.contributors.first { it.id == "duration" }.weight, 1e-9)
    }

    @Test
    fun `short night cannot become a near perfect score from continuity and timing`() {
        val current = session("current", currentDate, 2, 6, 240)
        val prior = (1..7).map { session("p$it", currentDate.minusDays(it.toLong()), 2, 6, 240) }
        val allBlocks = (prior + current).associate { it.id to timeline(it, listOf("LIGHT" to 240)) }

        val result = DailySleepScoreAlgorithm.calculate(
            listOf(current), mapOf(current.id to allBlocks.getValue(current.id)),
            SleepScoreContext(prior, prior.associate { it.id to allBlocks.getValue(it.id) },
                targetMinutes = 480, zoneId = zone),
        )!!

        assertTrue("four hours must not look near-perfect: ${result.score}", result.score <= 75)
    }

    @Test
    fun `sparse named timeline cannot earn perfect continuity`() {
        val current = session("current", currentDate, 1, 9, 20)
        val start = current.startAt
        val blocks = listOf(
            block("a", current.id, start, 0, 10, "LIGHT"),
            block("b", current.id, start + 470 * 60_000L, 470, 10, "DEEP"),
        )

        val result = DailySleepScoreAlgorithm.calculate(
            listOf(current), mapOf(current.id to blocks), SleepScoreContext(zoneId = zone))!!

        assertEquals(ScoreContributorRole.UNAVAILABLE,
            result.contributors.first { it.id == "continuity" }.role)
    }

    @Test
    fun `conflicting overlapping stages make continuity unavailable`() {
        val current = session("current", currentDate, 1, 2, 60)
        val blocks = listOf(
            block("sleep", current.id, current.startAt, 0, 60, "LIGHT"),
            block("wake", current.id, current.startAt + 20 * 60_000L, 20, 10, "AWAKE"),
        )
        val result = DailySleepScoreAlgorithm.calculate(
            listOf(current), mapOf(current.id to blocks), SleepScoreContext(zoneId = zone))!!
        assertEquals(ScoreContributorRole.UNAVAILABLE,
            result.contributors.first { it.id == "continuity" }.role)
    }

    @Test
    fun `timing baseline uses distinct prior nights within 28 calendar days and excludes future`() {
        val current = session("current", currentDate, 23, 7, 480)
        val goodPrior = (1..7).map {
            session("p$it", currentDate.minusDays(it.toLong()), 23, 7, 480)
        }
        val old = session("old", currentDate.minusDays(29), 12, 20, 480)
        val future = session("future", currentDate.plusDays(1), 12, 20, 480)
        val prior = goodPrior + old + future + goodPrior.first().copy(id = "duplicate")
        val priorBlocks = prior.associate { it.id to timeline(it, listOf("AWAKE" to 30, "LIGHT" to 480)) }
        val currentBlocks = timeline(current, listOf("AWAKE" to 30, "LIGHT" to 480))

        val result = DailySleepScoreAlgorithm.calculate(
            listOf(current), mapOf(current.id to currentBlocks),
            SleepScoreContext(prior, priorBlocks, zoneId = zone),
        )!!

        val timing = result.contributors.first { it.id == "timing_consistency" }
        assertEquals(ScoreContributorRole.SCORED, timing.role)
        assertTrue(timing.value!! < 1.0)
    }

    @Test
    fun `missing stage timeline keeps deep and REM unavailable rather than zero`() {
        val current = session("current", currentDate, 1, 8, 420)
        val result = DailySleepScoreAlgorithm.calculate(
            listOf(current), mapOf(current.id to emptyList()), SleepScoreContext(zoneId = zone))!!
        assertEquals(ScoreContributorRole.UNAVAILABLE,
            result.contributors.first { it.id == "deep_sleep" }.role)
        assertNull(result.contributors.first { it.id == "rem_sleep" }.value)
    }

    @Test
    fun `real display day excludes demo prior baseline`() {
        val real = session("real", currentDate, 1, 8, 420, "ring")
        val demoPrior = (1..8).map {
            session("demo$it", currentDate.minusDays(it.toLong()), 1, 8, 420, "demo")
        }
        val current = SleepScoreRepository.selectCurrent(listOf(real), SleepScoreReadMode.DISPLAY)
        val prior = SleepScoreRepository.selectPrior(demoPrior, currentUsesReal = true)
        assertEquals(listOf(real), current)
        assertTrue(prior.isEmpty())
    }

    private fun session(
        id: String,
        date: LocalDate,
        startHour: Int,
        endHour: Int,
        total: Int,
        source: String = "ring",
    ): SleepSessionEntity {
        val day = date.atStartOfDay(zone)
        val start = day.plusHours(startHour.toLong()).toInstant().toEpochMilli()
        val endDay = if (endHour <= startHour) day.plusDays(1) else day
        val end = endDay.plusHours(endHour.toLong()).toInstant().toEpochMilli()
        return SleepSessionEntity(id, day.toInstant().toEpochMilli(), start, end, total, sourceRaw = source)
    }

    private fun timeline(
        session: SleepSessionEntity,
        runs: List<Pair<String, Int>>,
    ): List<SleepStageBlockEntity> {
        var offset = 0
        return runs.mapIndexed { index, (stage, duration) ->
            block("${session.id}-$index", session.id, session.startAt + offset * 60_000L,
                offset, duration, stage).also { offset += duration }
        }
    }

    private fun block(
        id: String, sessionId: String, start: Long, offset: Int, duration: Int, stage: String,
    ) = SleepStageBlockEntity(id, sessionId, start, offset, duration, stage)
}
