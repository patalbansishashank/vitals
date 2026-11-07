package com.pulseloop.service

import com.pulseloop.data.DemoDataPolicy
import com.pulseloop.data.entity.SleepSessionEntity
import com.pulseloop.data.entity.SleepStageBlockEntity
import com.pulseloop.ring.SleepStage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlin.math.*

/**
 * Ported from SleepInsights.swift.
 * Range-aware sleep scoring + interpretation. Pure logic — zero Android deps.
 * All logic is data-honest: missing nights never treated as zero, averages
 * over valid nights only, no fallback to stale prior nights.
 */

// ── Sleep Score ───────────────────────────────────────────────────────────

enum class SleepQualityLabel { EXCELLENT, GOOD, FAIR, NEEDS_WORK }

data class SleepScoreResult(
    val score: Int,
    val label: SleepQualityLabel,
    val deepPct: Int,
    val lightPct: Int,
    val awakePct: Int?,  // null when no usable awake signal
    /** True when continuity is unavailable; the index then uses recorded duration alone. */
    val isProvisional: Boolean = false,
)

object SleepScore {
    private val namedStages = setOf(
        SleepStage.DEEP.name,
        SleepStage.LIGHT.name,
        SleepStage.REM.name,
        SleepStage.AWAKE.name,
    )

    /** True when at least one named stage exists; useful for a partial/provisional graph. */
    fun hasAnyNamedStageData(blocks: List<SleepStageBlockEntity>): Boolean =
        blocks.any { it.durationMinutes > 0 && it.stageRaw in namedStages }

    /** Fraction of positive-duration stage minutes carrying a named stage (0…1). */
    fun namedStageCoverage(blocks: List<SleepStageBlockEntity>): Double {
        val positive = blocks.filter { it.durationMinutes > 0 }
        if (positive.isEmpty()) return 0.0
        val total = positive.sumOf { it.durationMinutes }.toDouble()
        val named = positive.filter { it.stageRaw in namedStages }
            .sumOf { it.durationMinutes }.toDouble()
        return (named / total).coerceIn(0.0, 1.0)
    }

    /**
     * Sleep-stage labels are only scoreable when nearly all of the stage timeline is named.
     * A partial decoder is still valuable for duration/timing, but treating its UNKNOWN minutes
     * as zero deep/light/REM would manufacture a low score. This gate is deliberately conservative
     * for firmware families whose byte meanings have not been validated against a reference.
     */
    fun hasUsableStageData(blocks: List<SleepStageBlockEntity>): Boolean {
        val positive = blocks.filter { it.durationMinutes > 0 }
        if (positive.isEmpty()) return false
        val total = positive.sumOf { it.durationMinutes }
        val named = positive
            .filter { it.stageRaw in namedStages }
            .sumOf { it.durationMinutes }
        // Permit a small number of gaps from packet boundaries, but never a mostly opaque night.
        return named * 100 >= total * 95
    }

    /** A plausible recorded duration supports a score even when stages remain opaque. */
    fun calculateIfUsable(
        session: SleepSessionEntity,
        blocks: List<SleepStageBlockEntity>,
    ): SleepScoreResult? = if (session.totalMinutes in 1..1440) calculate(session, blocks) else null

    /** Display and persisted insights share the same duration/continuity calculation. */
    fun calculateForDisplay(
        session: SleepSessionEntity,
        blocks: List<SleepStageBlockEntity>,
    ): SleepScoreResult? {
        return calculateIfUsable(session, blocks)
    }

    fun qualityLabel(score: Int): SleepQualityLabel = when {
        score >= 85 -> SleepQualityLabel.EXCELLENT
        score >= 70 -> SleepQualityLabel.GOOD
        score >= 55 -> SleepQualityLabel.FAIR
        else -> SleepQualityLabel.NEEDS_WORK
    }

    /** Calculate sleep score from session + stage blocks. */
    fun calculate(
        session: SleepSessionEntity,
        blocks: List<SleepStageBlockEntity>,
    ): SleepScoreResult {
        // Duration and descriptive stage percentages use recorded asleep minutes. Clock span
        // only helps assess whether a timeline without explicit wake has adequate coverage.
        val total = if (session.totalMinutes > 0) session.totalMinutes.toDouble() else 0.0
        val span = session.spanMinutes.toDouble().takeIf { it > 0 } ?: total
        // stageRaw is persisted as the SleepStage enum name (uppercase) — match it exactly.
        // Stage shares remain available for graphs but are not score targets.
        fun minutesFor(vararg stages: SleepStage) =
            blocks.filter { b -> stages.any { it.name == b.stageRaw } }
                .sumOf { it.durationMinutes.coerceAtLeast(0).toLong() }.toDouble()
        val deep = minutesFor(SleepStage.DEEP)
        val light = minutesFor(SleepStage.LIGHT)
        val awake = minutesFor(SleepStage.AWAKE)
        val coveredStageMin = blocks.sumOf { it.durationMinutes.coerceAtLeast(0).toDouble() }
        // Use recorded minutes, not the gap between a main night and a nap. Missing labels
        // cannot establish sleep continuity. A complete vocabulary does not validate stages.
        val hasAwakeSignal = hasUsableStageData(blocks) &&
            (awake > 0 || (span > 0 && coveredStageMin >= span * 0.95))

        val totalHours = total / 60
        val deepPct = if (total > 0) (deep / total) * 100 else 0.0
        val lightPct = if (total > 0) (light / total) * 100 else 0.0
        val awakePct: Double? = if (coveredStageMin > 0 && hasAwakeSignal)
            (awake / coveredStageMin * 100).coerceIn(0.0, 100.0) else null

        // AASM recommends >=7h for adults; no evidence supports penalising one long night.
        // This 0–100 mapping is a product heuristic, not a clinical instrument. Duration
        // dominates; deep/light/REM proportions do not earn or lose points.
        val duration = (totalHours / 7.0).coerceIn(0.0, 1.0) * 100.0
        val continuity = awakePct?.let { ((40.0 - it) / 25.0).coerceIn(0.0, 1.0) * 100.0 }
        val score = (if (continuity == null) duration else duration * 0.75 + continuity * 0.25)
            .roundToInt().coerceIn(0, 100)

        return SleepScoreResult(
            score = score,
            label = qualityLabel(score),
            deepPct = deepPct.roundToInt(),
            lightPct = lightPct.roundToInt(),
            awakePct = awakePct?.roundToInt(),
            isProvisional = continuity == null || !hasUsableStageData(blocks),
        )
    }
}

// ── Formatting ────────────────────────────────────────────────────────────

/**
 * How long the wearer was **asleep** across these stage blocks — the minutes the ring named as a
 * sleep stage (deep, light or REM); awake is excluded (issue #63) and so is unknown (SPEC GA.9).
 *
 * This is a session's `totalMinutes`, and it is deliberately not the span from its start to its
 * end. A night the ring splits into two records is stored as one row covering both, so the span
 * also counts the minutes between them: on the reporter's night the app said 8 h 10 (23:51 to
 * 08:02) for a night whose two records declared 268 and 140 minutes, 6 h 48. Neither figure is
 * wrong, but only one of them is a duration — the other is a range, and the sleep card already
 * shows the range on its own line underneath. See [spanMinutes] for that one.
 *
 * The vendor app draws the same distinction, and the reporter found where (`SleepActivity:695`,
 * `com.yucheng.smarthealthpro`): each history entry is built as
 * `deepSleepTotal + lightSleepTotal + remTotal`, with `wakeDuration` carried separately and
 * excluded, while `startTime` comes from the first record of the day and `endTime` from the last.
 * It never conflates the two either.
 *
 * **Known asleep only (SPEC GA.9, the lower/upper bounds rule).** This used to be "every stage
 * except AWAKE", which counted `SleepStage.UNKNOWN` as slept. UNKNOWN is the `else` branch of every
 * decoder here: an unrecognised byte, and on a J-Style ring with unknown firmware *every* byte. It
 * says nothing about whether the wearer slept, so it can no longer make a night longer. This is the
 * lower bound `K` (DEEP + LIGHT + REM); [asleepUpperBoundMinutes] is `K + U`. A night that is all
 * UNKNOWN therefore has a duration of 0 and no score, and its stages stay visible as unknown. The
 * server derivation (S2 `sleepMetrics`) uses the same two bounds.
 */
fun asleepMinutes(blocks: List<SleepStageBlockEntity>): Int =
    blocks.filter { it.stageRaw in KNOWN_ASLEEP_STAGES }
        .sumOf { it.durationMinutes.coerceAtLeast(0) }
        .coerceAtLeast(0)

/** Upper bound of time asleep: known asleep plus UNKNOWN minutes (`K + U`, SPEC GA.9). */
fun asleepUpperBoundMinutes(blocks: List<SleepStageBlockEntity>): Int =
    blocks.filter { it.stageRaw in KNOWN_ASLEEP_STAGES || it.stageRaw == SleepStage.UNKNOWN.name }
        .sumOf { it.durationMinutes.coerceAtLeast(0) }
        .coerceAtLeast(0)

private val KNOWN_ASLEEP_STAGES = setOf(SleepStage.DEEP.name, SleepStage.LIGHT.name, SleepStage.REM.name)

/**
 * How long the session covers on the clock, first stage block to last — which since issue #63 is a
 * different number from [SleepSessionEntity.totalMinutes], the time actually asleep.
 *
 * Use this wherever wall-clock position matters (a hypnogram's x axis, a timeline); use
 * `totalMinutes` wherever a duration is being reported. The sleep card shows both, as the vendor
 * app does: the duration as the headline, the span as the range underneath it.
 */
val SleepSessionEntity.spanMinutes: Int
    get() = ((endAt - startAt) / 60_000L).toInt().coerceAtLeast(0)

object SleepFormat {
    fun duration(minutes: Int?): String {
        if (minutes == null || minutes < 0) return "—"
        val h = minutes / 60; val m = minutes % 60
        return if (h <= 0) "${m}m" else "${h}h ${m.toString().padStart(2, '0')}m"
    }

    fun clockTime(ts: Long): String {
        val t = Instant.ofEpochMilli(ts).atZone(ZoneId.systemDefault())
        val h = t.hour % 12; val displayH = if (h == 0) 12 else h
        val ampm = if (t.hour < 12) "AM" else "PM"
        return "$displayH:${t.minute.toString().padStart(2, '0')} $ampm"
    }
}

// ── Coach Interpretation ──────────────────────────────────────────────────

data class SleepCoach(
    val headline: String,
    val body: String,
    val chips: List<String>,
)

data class SleepNoDataState(
    val label: String,
    val value: String,
    val support: String,
)

data class SleepBar(
    val label: String,
    val durationMin: Int?,
    val score: Int?,
    val present: Boolean,
)

object SleepInsights {
    val rangeHeroLabel = mapOf(
        SleepRangeKey.DAY to "Last Sleep",
        SleepRangeKey.WEEK to "Weekly Sleep",
        SleepRangeKey.MONTH to "Monthly Sleep",
        SleepRangeKey.YEAR to "Yearly Sleep",
    )

    private const val minAggNights = 2

    // ── Aggregation ──────────────────────────────────────────────────────

    fun validSessions(sessions: List<SleepSessionEntity>) =
        sessions.filter { it.totalMinutes > 0 }

    /** One waking day's sleep collapsed to a single combined session + its concatenated blocks. */
    data class DaySleep(val session: SleepSessionEntity, val blocks: List<SleepStageBlockEntity>)

    /**
     * Collapse each waking day's sessions (main night + daytime naps) into ONE combined [DaySleep]
     * so a night plus naps counts as a single tracked day for aggregate math (averages, "N of M
     * nights", histograms). Ported from iOS `SleepInsights.collapseByDay` (PR #83).
     *
     * Deterministic. Days with exactly one session pass through unchanged. For multi-session days,
     * blocks are concatenated (sorted by startAt), totalMinutes are SUMMED (total time asleep across
     * the day, not the wall-clock span), bounds are the earliest start / latest end, and the score
     * is a duration-weighted average of the present per-session scores. The combined row carries a
     * synthetic `collapsed-<day>` id; callers resolve its blocks from the returned [DaySleep.blocks].
     * Result is sorted by day.
     */
    fun collapseByDay(
        sessions: List<SleepSessionEntity>,
        blocksBySession: (String) -> List<SleepStageBlockEntity>,
    ): List<DaySleep> =
        sessions.groupBy { it.date }.map { (day, all) ->
            // A ring night and a seeded demo night can share a date now that a connect deletes
            // nothing (`DemoDataPolicy`) — the seeder's "skip days that already have ring data"
            // guard only covers seed-after-sync, not sync-after-seed. Summing the two would
            // report ~13h asleep and inflate every average built on top. Real wins per day.
            val ring = all.filterNot { DemoDataPolicy.isDemo(it.sourceRaw) }
            val daySessions = if (ring.isNotEmpty()) ring else all
            if (daySessions.size == 1) {
                val only = daySessions.first()
                return@map DaySleep(only, blocksBySession(only.id))
            }
            val blocks = daySessions.flatMap { blocksBySession(it.id) }.sortedBy { it.startAt }
            val totalMinutes = daySessions.sumOf { it.totalMinutes }
            val startAt = daySessions.minOf { it.startAt }
            val endAt = daySessions.maxOf { it.endAt }

            val scored = daySessions.mapNotNull { s -> s.score?.let { it to maxOf(0, s.totalMinutes) } }
            val totalWeight = scored.sumOf { it.second }
            val combinedScore: Int? = when {
                scored.isEmpty() -> null
                totalWeight > 0 -> (scored.sumOf { it.first.toDouble() * it.second } / totalWeight).roundToInt()
                else -> (scored.sumOf { it.first }.toDouble() / scored.size).roundToInt()
            }

            DaySleep(
                session = SleepSessionEntity(
                    id = "collapsed-$day", date = day, startAt = startAt, endAt = endAt,
                    totalMinutes = totalMinutes, score = combinedScore,
                    sourceRaw = daySessions.first().sourceRaw,
                ),
                blocks = blocks,
            )
        }.sortedBy { it.session.date }

    fun averageDuration(valid: List<SleepSessionEntity>): Int? {
        if (valid.isEmpty()) return null
        return valid.sumOf { it.totalMinutes } / valid.size
    }

    fun averageScore(valid: List<SleepSessionEntity>, blocksBySession: (String) -> List<SleepStageBlockEntity>): Int? {
        if (valid.isEmpty()) return null
        val scores = valid.mapNotNull { SleepScore.calculateIfUsable(it, blocksBySession(it.id))?.score }
        if (scores.isEmpty()) return null
        return scores.average().roundToInt()
    }

    private fun durationConsistency(valid: List<SleepSessionEntity>): Double? {
        if (valid.size < 2) return null
        val avg = averageDuration(valid)?.toDouble() ?: return null
        val variance = valid.sumOf { (it.totalMinutes - avg).pow(2) } / valid.size
        return sqrt(variance)
    }

    // ── Coach Text ───────────────────────────────────────────────────────

    fun dayCoach(
        session: SleepSessionEntity,
        blocks: List<SleepStageBlockEntity>,
        activitySteps: Int?,
        dailyScore: DailySleepScore? = null,
    ): SleepCoach {
        if (dailyScore != null) return canonicalDayCoach(dailyScore)
        val score = SleepScore.calculateIfUsable(session, blocks)
        if (score == null) {
            val partial = SleepScore.hasAnyNamedStageData(blocks)
            return SleepCoach(
                "Sleep duration captured",
                if (partial) {
                    "The ring supplied sleep timing and a partial stage timeline. I’ll show the named portions, keep unknown segments visible, and avoid inventing a stage-based score."
                } else {
                    "The ring supplied sleep timing, but this firmware's stage labels are not validated yet. I’ll keep the duration and raw timeline without inventing a stage-based score."
                },
                listOf(if (partial) "Stages provisional" else "Stages pending"),
            )
        }
        val awakePct = score.awakePct
        val chips = mutableListOf<String>()
        if (session.totalMinutes in 420..540) chips.add("Good duration")
        if (score.isProvisional) chips.add("Duration available")
        if (awakePct != null && awakePct <= 10) chips.add("Awake time low")

        if (score.score >= 85) {
            val body = if (score.isProvisional)
                "Your recorded sleep duration was strong. There isn't enough stage information to assess interruptions, so duration determines this score."
            else "Your recorded sleep duration was strong, with relatively little awake time in the supplied timeline. Stage proportions do not change the score."
            return SleepCoach("Strong sleep duration", body, chips.ifEmpty { listOf("Excellent") }.take(3))
        }
        if (awakePct != null && awakePct > 15) {
            return SleepCoach(
                "Good sleep, with some restlessness",
                "You slept long enough, but awake time was a bit elevated. If this repeats, look at late caffeine, alcohol, temperature, or stress near bedtime.",
                (listOf("Awake time elevated") + chips).take(3),
            )
        }
        if (session.totalMinutes < 390) {
            return SleepCoach(
                "Duration held the score back",
                "Recorded sleep was below seven hours. Look at several nights together: a short night may reflect less sleep or an incomplete recording.",
                (listOf("Short duration") + chips).take(3),
            )
        }
        return SleepCoach(
            "Solid night overall",
            "The score follows recorded sleep duration and, when available, awake time. Compare several nights to see whether your sleep is becoming longer or less interrupted.",
            chips.ifEmpty { listOf("Good") }.take(3),
        )
    }

    /** Narrative for the canonical v4 daily index; never recomputes or substitutes a score. */
    private fun canonicalDayCoach(daily: DailySleepScore): SleepCoach {
        val duration = daily.contributors.firstOrNull { it.id == "duration" }
        val continuity = daily.contributors.firstOrNull { it.id == "continuity" }
        val timing = daily.contributors.firstOrNull { it.id == "timing_consistency" }
        val chips = buildList {
            when {
                (duration?.score ?: 100.0) >= 85.0 -> add("Good duration")
                (duration?.score ?: 100.0) < 65.0 -> add("Duration below target")
            }
            when {
                continuity?.score == null -> add("Continuity unavailable")
                continuity.score < 60.0 -> add("Sleep interrupted")
                continuity.score >= 85.0 -> add("Sleep stayed continuous")
            }
            when {
                timing?.score == null -> add("Timing baseline building")
                timing.score < 60.0 -> add("Timing varied")
                timing.score >= 85.0 -> add("Timing consistent")
            }
        }.take(3)

        val headline = when {
            (duration?.score ?: 100.0) < 65.0 -> "Duration held the index back"
            (timing?.score ?: 100.0) < 60.0 -> "Sleep timing was less consistent"
            (continuity?.score ?: 100.0) < 60.0 -> "Sleep was more interrupted"
            daily.score >= 85 -> "Strong sleep pattern"
            else -> "Your sleep pattern at a glance"
        }
        val details = buildList {
            add("You recorded ${SleepFormat.duration(daily.totalSleepMinutes)} of sleep.")
            daily.sleepEfficiencyPercent?.let {
                add("Sleep efficiency was ${it.roundToInt()}%, which reflects continuity across the primary sleep period.")
            }
            daily.timingDeviationMinutes?.let {
                add("The sleep midpoint was about ${it.roundToInt()} minutes from your recent timing baseline.")
            }
            if (continuity?.score == null || timing?.score == null) {
                add("Unavailable contributors were omitted and the available v4 weights were renormalized.")
            }
        }
        return SleepCoach(headline, details.joinToString(" "), chips)
    }

    val dayNoDataCoach = SleepCoach(
        "No sleep tracked last night",
        "I don't see sleep data for last night. Wear your ring overnight and sync in the morning so I can compare your sleep against your baseline.",
        emptyList(),
    )

    fun aggregateCoach(
        range: SleepRangeKey,
        sessions: List<SleepSessionEntity>,
        expectedNights: Int,
        goalMin: Int?,
        blocksBySession: (String) -> List<SleepStageBlockEntity>,
    ): SleepCoach {
        val valid = validSessions(sessions)
        val avgMin = averageDuration(valid)
        val periodWord = when (range) { SleepRangeKey.WEEK -> "week"; SleepRangeKey.MONTH -> "month"; else -> "year" }

        if (valid.size < minAggNights) {
            val nightWord = if (valid.size == 1) "night" else "nights"
            return SleepCoach(
                "Not enough $periodWord data yet",
                "I only have ${valid.size} tracked $nightWord for this $periodWord. Wear the ring overnight for a few more nights and I'll build a reliable ${periodWord}ly picture.",
                listOf(nightsTrackedChip(valid.size, expectedNights)),
            )
        }

        val chips = mutableListOf(nightsTrackedChip(valid.size, expectedNights))
        avgMin?.let { goalDeltaChip(it, goalMin) }?.let { chips.add(it) }
        durationConsistency(valid)?.let { consistencyChip(it) }?.let { chips.add(it) }

        val avgText = SleepFormat.duration(avgMin)
        val coveragePhrase = "${valid.size} of $expectedNights nights tracked"

        return when (range) {
            SleepRangeKey.WEEK -> {
                val incomplete = valid.size < expectedNights
                val missing = expectedNights - valid.size
                val missingWord = if (missing == 1) "night" else "nights"
                val body = if (incomplete)
                    "You averaged $avgText across ${valid.size} tracked nights this week. That's a useful read, but $missing missing $missingWord mean the trend is still incomplete."
                else "You averaged $avgText across the full week. Your nights were tracked consistently, so this is a dependable picture of where your sleep sits right now."
                SleepCoach("Your week at a glance", body, chips.take(3))
            }
            SleepRangeKey.MONTH -> {
                val sparse = valid.size.toDouble() < expectedNights.toDouble() * 0.5
                val body = if (sparse)
                    "Your monthly average is $avgText, but coverage is low ($coveragePhrase), so I'd treat that number cautiously. More nights tracked will sharpen the trend."
                else "Your monthly average is $avgText across $coveragePhrase. The biggest lever is consistency — a few short nights move this number more than any single great one."
                SleepCoach("Your month in sleep", body, chips.take(3))
            }
            else -> SleepCoach(
                "Your long-term sleep trend",
                "Across the year your tracked average is $avgText over ${valid.size} nights. The long-term trend is still forming — as more months fill in, I'll be able to compare seasonal changes and consistency.",
                chips.take(3),
            )
        }
    }

    private fun nightsTrackedChip(valid: Int, expected: Int) = "$valid of $expected tracked"

    private fun goalDeltaChip(avgMin: Int, goalMin: Int?): String? {
        if (goalMin == null) return null
        val delta = avgMin - goalMin
        if (abs(delta) <= 20) return "On target"
        return if (delta < 0) "Below goal" else "Above goal"
    }

    private fun consistencyChip(sd: Double): String? = when {
        sd <= 40 -> "Consistent"
        sd >= 80 -> "Variable nights"
        else -> null
    }

    // ── No-data states ───────────────────────────────────────────────────

    fun noDataState(range: SleepRangeKey): SleepNoDataState = when (range) {
        SleepRangeKey.DAY -> SleepNoDataState("Last Sleep", "No sleep captured last night",
            "Wear your ring overnight so your ring can track your next night.")
        SleepRangeKey.WEEK -> SleepNoDataState("Weekly Sleep", "Not enough weekly data",
            "Wear your ring overnight for a few nights to build a weekly view.")
        SleepRangeKey.MONTH -> SleepNoDataState("Monthly Sleep", "Not enough monthly data",
            "Track more nights this month to see a monthly average.")
        SleepRangeKey.YEAR -> SleepNoDataState("Yearly Sleep", "Not enough yearly data",
            "Long-term insights appear as more nights are tracked.")
    }

    // ── Histogram builders ───────────────────────────────────────────────

    fun buildNightAxis(
        start: Long, end: Long,
        sessions: List<SleepSessionEntity>,
        blocksBySession: (String) -> List<SleepStageBlockEntity>,
        range: SleepRangeKey,
    ): List<SleepBar> {
        val byDate = sessions.associateBy {
            Instant.ofEpochMilli(it.date).atZone(ZoneId.systemDefault()).truncatedTo(ChronoUnit.DAYS)
                .toInstant().toEpochMilli()
        }
        val bars = mutableListOf<SleepBar>()
        var cursor = Instant.ofEpochMilli(start).atZone(ZoneId.systemDefault()).truncatedTo(ChronoUnit.DAYS)
        val last = Instant.ofEpochMilli(end).atZone(ZoneId.systemDefault()).truncatedTo(ChronoUnit.DAYS)
        val weekdayFmt = DateTimeFormatter.ofPattern("EEEEE")

        while (!cursor.isAfter(last)) {
            val cursorMs = cursor.toInstant().toEpochMilli()
            val session = byDate[cursorMs]
            val present = (session?.totalMinutes ?: 0) > 0
            val label = if (range == SleepRangeKey.WEEK) cursor.format(weekdayFmt)
                else cursor.dayOfMonth.toString()
            val score = if (present) session?.let { s -> SleepScore.calculateIfUsable(s, blocksBySession(s.id))?.score } else null
            bars.add(SleepBar(label, session?.totalMinutes, score, present))
            cursor = cursor.plusDays(1)
        }
        return bars
    }

    fun buildMonthBuckets(
        end: Long,
        sessions: List<SleepSessionEntity>,
        blocksBySession: (String) -> List<SleepStageBlockEntity>,
    ): List<SleepBar> {
        val valid = validSessions(sessions)
        val byMonth = valid.groupBy {
            val t = Instant.ofEpochMilli(it.date).atZone(ZoneId.systemDefault())
            "${t.year}-${t.monthValue}"
        }
        val monthFmt = DateTimeFormatter.ofPattern("MMM")
        val endZ = Instant.ofEpochMilli(end).atZone(ZoneId.systemDefault())
        return (11 downTo 0).map { i ->
            val monthDate = endZ.minusMonths(i.toLong())
            val key = "${monthDate.year}-${monthDate.monthValue}"
            val monthSessions = byMonth[key] ?: emptyList()
            SleepBar(
                label = monthDate.format(monthFmt),
                durationMin = averageDuration(monthSessions),
                score = averageScore(monthSessions, blocksBySession),
                present = monthSessions.isNotEmpty(),
            )
        }
    }
}

// ── Extensions ────────────────────────────────────────────────────────────

private fun Double.roundToInt(): Int = round(this).toInt()
