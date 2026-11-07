package com.pulseloop.service

import com.pulseloop.data.entity.SleepSessionEntity
import com.pulseloop.data.entity.SleepStageBlockEntity
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Ported from SleepServiceTests.swift + sleep score validations.
 * Tests sleep scoring, formatting, insights, and coach interpretation.
 * Pure logic — no Room/SwiftData dependency.
 */
class SleepInsightsTest {

    // ── Helpers ──────────────────────────────────────────────────────────

    private fun session(totalMin: Int, dateOffset: Int = 0): SleepSessionEntity {
        val day = Instant.now().truncatedTo(ChronoUnit.DAYS).plus(dateOffset.toLong(), ChronoUnit.DAYS)
        return SleepSessionEntity(
            date = day.toEpochMilli(),
            startAt = day.plusSeconds(23 * 3600L).toEpochMilli(),
            endAt = day.plusSeconds((23 + totalMin / 60).toLong() * 3600L).toEpochMilli(),
            totalMinutes = totalMin,
        )
    }

    private fun blocks(vararg stages: String): List<SleepStageBlockEntity> =
        stages.map { stage ->
            SleepStageBlockEntity(
                sessionId = "test",
                startAt = 0,
                startMinute = 0,
                durationMinutes = 5,
                stageRaw = stage,
            )
        }

    private fun sessionWithBlocks(totalMin: Int, vararg stageCounts: Pair<String, Int>): Pair<SleepSessionEntity, List<SleepStageBlockEntity>> {
        val s = session(totalMin)
        val blks = stageCounts.flatMap { (stage, count) -> (1..count).map { SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = stage) } }
        return s to blks
    }

    // ── Sleep Score Tests ────────────────────────────────────────────────

    @Test
    fun testIdealNightScoresHigh() {
        // Stage proportions are descriptive only; a good duration can reach 100.
        val s = session(480)  // 8 hours
        val blocks = buildList {
            repeat(288) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "LIGHT")) }
            repeat(66) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "DEEP")) }
            repeat(30) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "REM")) }
            repeat(24) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "AWAKE")) }
        }
        val result = SleepScore.calculate(s, blocks)
        assertTrue("Ideal 8h night should score >= 85, got ${result.score}", result.score >= 85)
        assertEquals(SleepQualityLabel.EXCELLENT, result.label)
        assertEquals(14, result.deepPct)   // 66 deep / 480; REM is separate
        assertEquals(60, result.lightPct)  // 288/480 = 60%
        assertNotNull(result.awakePct)
        assertEquals(6, result.awakePct)   // 24/408 recorded minutes
    }

    @Test
    fun testShortNightScoresLow() {
        // 4h sleep → low score
        val s = session(240)
        val blocks = buildList {
            repeat(80) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "LIGHT")) }
            repeat(20) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "DEEP")) }
        }
        val result = SleepScore.calculate(s, blocks)
        assertTrue("Short 4h night should score < 70, got ${result.score}", result.score < 70)
    }

    @Test
    fun testMissingDeepDoesNotPenalizeDurationScore() {
        val s = session(480)
        val blocks = buildList {
            repeat(130) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "LIGHT")) }
            repeat(10) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "AWAKE")) }
        }
        val result = SleepScore.calculate(s, blocks)
        assertEquals(100, result.score)
        assertEquals(0, result.deepPct)
    }

    @Test
    fun testScoreRangeIsZeroToOneHundred() {
        // Test various inputs always return 0-100
        val s = session(300)
        val blocks = buildList {
            repeat(50) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "LIGHT")) }
        }
        val result = SleepScore.calculate(s, blocks)
        assertTrue("Score ${result.score} should be >= 0", result.score >= 0)
        assertTrue("Score ${result.score} should be <= 100", result.score <= 100)
    }

    /**
     * Since issue #63 `totalMinutes` is time asleep, so a night's blocks always cover at least
     * that many minutes. Judged against it, the "does this ring label awake at all" coverage
     * heuristic would be true for every ring, and a ring that never labels awake would be handed
     * the full awake sub-score for nothing. It is judged against the span instead.
     */
    @Test
    fun `a ring that never labels awake and covers only part of the night reports no awake share`() {
        // 8 h in bed, 6 h of labelled sleep, no AWAKE blocks anywhere: 75% coverage of the span.
        val s = session(360).copy(endAt = session(360).startAt + 480 * 60_000L)
        val blocks = buildList {
            repeat(300) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "LIGHT")) }
            repeat(60) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "DEEP")) }
        }
        val result = SleepScore.calculate(s, blocks)
        assertNull("no awake signal: coverage is 75% of the span, not 100% of time asleep", result.awakePct)
        assertEquals("stage shares are of time asleep", 17, result.deepPct)   // 60/360
    }

    @Test
    fun `the awake share is of time in bed, and the stage shares of time asleep`() {
        // 7 h in bed = 420 min span; 30 min awake; 390 min asleep.
        val s = session(390).copy(endAt = session(390).startAt + 420 * 60_000L)
        val blocks = buildList {
            repeat(300) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "LIGHT")) }
            repeat(90) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "DEEP")) }
            repeat(30) { add(SleepStageBlockEntity(sessionId = s.id, startAt = 0, startMinute = 0, durationMinutes = 1, stageRaw = "AWAKE")) }
        }
        val result = SleepScore.calculate(s, blocks)
        assertEquals(7, result.awakePct)    // 30/420
        assertEquals(23, result.deepPct)    // 90/390
        assertEquals(77, result.lightPct)   // 300/390
    }

    @Test
    fun testQualityLabelThresholds() {
        assertEquals(SleepQualityLabel.EXCELLENT, SleepScore.qualityLabel(85))
        assertEquals(SleepQualityLabel.GOOD, SleepScore.qualityLabel(72))
        assertEquals(SleepQualityLabel.FAIR, SleepScore.qualityLabel(58))
        assertEquals(SleepQualityLabel.NEEDS_WORK, SleepScore.qualityLabel(40))
    }

    @Test
    fun testNoBlocksReturnsValidScore() {
        val s = session(420)
        val result = SleepScore.calculate(s, emptyList())
        assertTrue(result.score in 0..100)
        assertNull(result.awakePct)
        assertEquals(0, result.deepPct)
        assertEquals(0, result.lightPct)
    }

    @Test
    fun `opaque firmware stages retain a duration only score`() {
        val s = session(420)
        val opaque = listOf(
            SleepStageBlockEntity("opaque", s.id, 0, 0, 420, "UNKNOWN"),
        )
        assertFalse(SleepScore.hasUsableStageData(opaque))
        assertEquals(100, SleepScore.calculateIfUsable(s, opaque)!!.score)
        assertTrue(SleepScore.calculateIfUsable(s, opaque)!!.isProvisional)
        assertNull(SleepScore.calculateIfUsable(s, opaque)!!.awakePct)
    }

    @Test
    fun `small boundary gap still permits a named stage score`() {
        val s = session(480)
        val mostlyNamed = listOf(
            SleepStageBlockEntity("named", s.id, 0, 0, 240, "LIGHT"),
            SleepStageBlockEntity("named", s.id, 240, 240, 220, "DEEP"),
            SleepStageBlockEntity("gap", s.id, 460, 460, 20, "UNKNOWN"),
        )
        assertTrue(SleepScore.hasUsableStageData(mostlyNamed))
        assertNotNull(SleepScore.calculateIfUsable(s, mostlyNamed))
    }

    @Test
    fun `partial named stages produce a provisional display score`() {
        val s = session(270)
        val partial = listOf(
            SleepStageBlockEntity("deep", s.id, 0, 0, 90, "DEEP"),
            SleepStageBlockEntity("light", s.id, 90, 90, 160, "LIGHT"),
            SleepStageBlockEntity("unknown", s.id, 250, 250, 20, "UNKNOWN"),
        )
        val result = SleepScore.calculateForDisplay(s, partial)
        assertNotNull(result)
        assertTrue(result!!.isProvisional)
        assertEquals(250.0 / 270.0, SleepScore.namedStageCoverage(partial), 1e-9)
        assertEquals(result, SleepScore.calculateIfUsable(s, partial))
    }

    // ── Format Tests ─────────────────────────────────────────────────────

    @Test
    fun `normal REM changes do not alter the score`() {
        val s = session(480)
        val original = listOf(
            SleepStageBlockEntity("d", s.id, 0, 0, 96, "DEEP"),
            SleepStageBlockEntity("r", s.id, 0, 96, 96, "REM"),
            SleepStageBlockEntity("l", s.id, 0, 192, 288, "LIGHT"),
        )
        val changed = original.map { if (it.stageRaw == "LIGHT") it.copy(stageRaw = "REM") else it }
        assertEquals(100, SleepScore.calculate(s, original).score)
        assertEquals(SleepScore.calculate(s, original).score, SleepScore.calculate(s, changed).score)
        assertEquals(20, SleepScore.calculate(s, original).deepPct)
    }

    @Test
    fun `shorter duration and more recorded waking lower the index`() {
        fun timeline(asleep: Int, awake: Int) = listOf(
            SleepStageBlockEntity("s", "s", 0, 0, asleep, "LIGHT"),
            SleepStageBlockEntity("w", "s", 0, asleep, awake, "AWAKE"),
        )
        val good = SleepScore.calculate(session(420), timeline(420, 20)).score
        val short = SleepScore.calculate(session(240), timeline(240, 20)).score
        val restless = SleepScore.calculate(session(420), timeline(420, 180)).score
        assertEquals(100, good)
        assertTrue(short < good)
        assertTrue(restless < good)
        assertEquals(100, SleepScore.calculateForDisplay(session(600), emptyList())!!.score)
        assertNull(SleepScore.calculateForDisplay(session(0), emptyList()))
        assertNull(SleepScore.calculateForDisplay(session(1441), emptyList()))
    }

    @Test
    fun testDurationFormat() {
        assertEquals("7h 30m", SleepFormat.duration(450))
        assertEquals("5m", SleepFormat.duration(5))
        assertEquals("1h 00m", SleepFormat.duration(60))
        assertEquals("—", SleepFormat.duration(null))
        assertEquals("—", SleepFormat.duration(-1))
    }

    // ── Valid Sessions ───────────────────────────────────────────────────

    @Test
    fun testValidSessionsFiltersZeroMinutes() {
        val sessions = listOf(session(0), session(300), session(0), session(420))
        val valid = SleepInsights.validSessions(sessions)
        assertEquals(2, valid.size)
        assertEquals(300, valid[0].totalMinutes)
        assertEquals(420, valid[1].totalMinutes)
    }

    // ── Average Duration ─────────────────────────────────────────────────

    @Test
    fun testAverageDuration() {
        val sessions = listOf(session(300), session(420), session(360))
        val avg = SleepInsights.averageDuration(sessions)
        assertEquals(360, avg)
    }

    @Test
    fun testAverageDurationEmpty() {
        assertNull(SleepInsights.averageDuration(emptyList()))
    }

    // ── Day Coach ────────────────────────────────────────────────────────

    @Test
    fun testDayCoachHighScore() {
        val (s, blocks) = sessionWithBlocks(480,
            "LIGHT" to 80, "DEEP" to 30, "REM" to 20, "AWAKE" to 10)
        val coach = SleepInsights.dayCoach(s, blocks, 6000)
        assertTrue(coach.headline.isNotEmpty())
        assertTrue(coach.chips.isNotEmpty())
    }

    @Test
    fun testDayCoachShortDuration() {
        val (s, blocks) = sessionWithBlocks(240,
            "LIGHT" to 40, "DEEP" to 10)
        val coach = SleepInsights.dayCoach(s, blocks, 2000)
        assertTrue(coach.headline.contains("Duration", ignoreCase = true) ||
            coach.body.contains("short", ignoreCase = true))
    }

    @Test
    fun `v4 coach does not praise good duration when timing is poor`() {
        val (s, blocks) = sessionWithBlocks(480,
            "LIGHT" to 80, "DEEP" to 30, "REM" to 20, "AWAKE" to 10)
        val daily = DailySleepScore(
            score = 75,
            label = SleepQualityLabel.GOOD,
            contributors = listOf(
                ScoreContributor(
                    id = "duration", label = "Duration", value = 480.0, unit = "min",
                    score = 100.0, weight = 0.5, configuredWeight = 0.5,
                    explanation = "Duration", role = ScoreContributorRole.SCORED,
                ),
                ScoreContributor(
                    id = "continuity", label = "Continuity", value = 92.0, unit = "%",
                    score = 90.0, weight = 0.25, configuredWeight = 0.25,
                    explanation = "Continuity", role = ScoreContributorRole.SCORED,
                ),
                ScoreContributor(
                    id = "timing_consistency", label = "Timing consistency",
                    value = 180.0, unit = "min deviation", score = 20.0,
                    weight = 0.25, configuredWeight = 0.25,
                    explanation = "Timing", role = ScoreContributorRole.SCORED,
                ),
            ),
            confidence = "medium", algorithmVersion = "lumen-sleep-v4",
            primarySessionId = s.id, totalSleepMinutes = 480,
            awakeAfterOnsetMinutes = 20, sleepEfficiencyPercent = 92.0,
            timingDeviationMinutes = 180.0, explanation = "v4",
        )

        val coach = SleepInsights.dayCoach(s, blocks, 6000, daily)

        assertTrue(coach.headline.contains("timing", ignoreCase = true))
        assertTrue(coach.body.contains("180"))
        assertFalse(coach.headline.contains("strong", ignoreCase = true))
    }

    @Test
    fun testDayNoDataCoach() {
        assertTrue(SleepInsights.dayNoDataCoach.headline.isNotEmpty())
        assertTrue(SleepInsights.dayNoDataCoach.chips.isEmpty())
    }

    // ── Aggregate Coach ─────────────────────────────────────────────────

    @Test
    fun testAggregateCoachInsufficientData() {
        val sessions = listOf(session(300))
        val coach = SleepInsights.aggregateCoach(
            SleepRangeKey.WEEK, sessions, 7, 480,
        ) { emptyList() }
        assertTrue(coach.headline.contains("Not enough", ignoreCase = true))
        assertEquals(1, coach.chips.size)
        assertTrue(coach.chips[0].contains("1 of 7"))
    }

    @Test
    fun testAggregateCoachWeekWithFullData() {
        val sessions = (1..7).map { session(420 + it * 5) }
        val coach = SleepInsights.aggregateCoach(
            SleepRangeKey.WEEK, sessions, 7, 480,
        ) { emptyList() }
        assertTrue(coach.headline.contains("week", ignoreCase = true))
        assertTrue(coach.chips.isNotEmpty())
    }

    // ── No-Data States ──────────────────────────────────────────────────

    @Test
    fun testNoDataStates() {
        for (range in SleepRangeKey.entries) {
            val state = SleepInsights.noDataState(range)
            assertTrue(state.label.isNotEmpty())
            assertTrue(state.value.isNotEmpty())
            assertTrue(state.support.isNotEmpty())
        }
    }

    // ── Night Axis ──────────────────────────────────────────────────────

    @Test
    fun testNightAxisBuildsCorrectLength() {
        val now = Instant.now().truncatedTo(ChronoUnit.DAYS)
        val start = now.minus(6, ChronoUnit.DAYS).toEpochMilli()
        val end = now.toEpochMilli()
        val sessions = listOf(
            session(400, -1),
            session(380, -3),
        )
        val bars = SleepInsights.buildNightAxis(start, end, sessions, { emptyList() }, SleepRangeKey.WEEK)
        assertEquals(7, bars.size)
        val present = bars.count { it.present }
        assertEquals(2, present)
    }

    // ── Month Buckets ───────────────────────────────────────────────────

    @Test
    fun testMonthBucketsReturns12Bars() {
        val now = Instant.now()
        val sessions = listOf(session(420))
        val bars = SleepInsights.buildMonthBuckets(now.toEpochMilli(), sessions) { emptyList() }
        assertEquals(12, bars.size)
        val present = bars.count { it.present }
        assertEquals(1, present)
    }
}
