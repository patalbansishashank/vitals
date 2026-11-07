package com.pulseloop.service

import com.pulseloop.data.DemoDataPolicy
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.data.entity.SleepSessionEntity
import com.pulseloop.data.entity.SleepStageBlockEntity
import com.pulseloop.ring.MeasurementKind
import java.time.Instant
import java.time.ZoneId
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

enum class SleepScoreReadMode { DISPLAY, DERIVED }

data class SleepScoreContext(
    val priorPrimarySessions: List<SleepSessionEntity> = emptyList(),
    val priorBlocksBySession: Map<String, List<SleepStageBlockEntity>> = emptyMap(),
    val targetMinutes: Int = 480,
    val nightlyHrvMs: Double? = null,
    val sleepingHeartRateDropBpm: Double? = null,
    val zoneId: ZoneId = ZoneId.systemDefault(),
)

data class DailySleepScore(
    val score: Int,
    val label: SleepQualityLabel,
    val contributors: List<ScoreContributor>,
    val confidence: String,
    val algorithmVersion: String,
    val primarySessionId: String,
    val totalSleepMinutes: Int,
    val awakeAfterOnsetMinutes: Int?,
    val sleepEfficiencyPercent: Double?,
    val timingDeviationMinutes: Double?,
    val explanation: String,
)

/** Duration + continuity + timing consistency. Stage proportions and physiology remain context. */
object DailySleepScoreAlgorithm {
    const val VERSION = "lumen-sleep-v4"
    private const val DURATION_WEIGHT = 0.50
    private const val CONTINUITY_WEIGHT = 0.25
    private const val TIMING_WEIGHT = 0.25
    private const val MIN_PRIOR_NIGHTS = 7
    private val sleepStages = setOf("DEEP", "LIGHT", "REM")

    fun calculate(
        sessions: List<SleepSessionEntity>,
        blocksBySession: Map<String, List<SleepStageBlockEntity>>,
        context: SleepScoreContext,
    ): DailySleepScore? {
        val valid = sessions.filter { it.totalMinutes > 0 }
        val primary = valid.maxByOrNull { it.totalMinutes } ?: return null
        val totalMinutes = valid.sumOf { it.totalMinutes }.takeIf { it in 1..1440 } ?: return null
        val target = context.targetMinutes.coerceIn(420, 720)
        val durationScore = (100.0 * totalMinutes / target).coerceIn(0.0, 100.0)
        val primaryBlocks = blocksBySession[primary.id].orEmpty()
        val continuity = continuity(primaryBlocks)
        val timing = timingConsistency(
            primary, primaryBlocks, context.priorPrimarySessions,
            context.priorBlocksBySession, context.zoneId)

        data class Available(val id: String, val configured: Double, val score: Double)
        val available = buildList {
            add(Available("duration", DURATION_WEIGHT, durationScore))
            continuity?.let { add(Available("continuity", CONTINUITY_WEIGHT, it.score)) }
            timing?.let { add(Available("timing_consistency", TIMING_WEIGHT, it.score)) }
        }
        val availableWeight = available.sumOf { it.configured }
        fun applied(id: String): Double = available.firstOrNull { it.id == id }
            ?.let { it.configured / availableWeight } ?: 0.0
        val score = available.sumOf { it.score * it.configured / availableWeight }
            .roundToInt().coerceIn(0, 100)

        fun stageMinutes(stage: String) = primaryBlocks.filter { it.stageRaw == stage }
            .sumOf { it.durationMinutes.coerceAtLeast(0) }
        val hasStageContext = SleepScore.hasAnyNamedStageData(primaryBlocks)
        val deep = stageMinutes("DEEP").takeIf { hasStageContext }
        val rem = stageMinutes("REM").takeIf { hasStageContext }
        val contributors = listOf(
            ScoreContributor(
                id = "duration", label = "Duration", value = totalMinutes.toDouble(), unit = "min",
                score = durationScore, weight = applied("duration"), configuredWeight = DURATION_WEIGHT,
                explanation = "Total recorded sleep across the waking day against a ${target}-minute target.",
                role = ScoreContributorRole.SCORED,
            ),
            continuity?.let {
                ScoreContributor(
                    id = "continuity", label = "Continuity", value = it.efficiency, unit = "%",
                    score = it.score, weight = applied("continuity"), configuredWeight = CONTINUITY_WEIGHT,
                    explanation = "Sleep efficiency from first recorded sleep to final recorded sleep; leading wake and gaps between sessions are excluded.",
                    role = ScoreContributorRole.SCORED,
                )
            } ?: ScoreContributor(
                id = "continuity", label = "Continuity", configuredWeight = CONTINUITY_WEIGHT,
                explanation = "Unavailable without a sufficiently complete sleep/wake timeline.",
                role = ScoreContributorRole.UNAVAILABLE,
            ),
            timing?.let {
                ScoreContributor(
                    id = "timing_consistency", label = "Timing consistency",
                    value = it.deviationMinutes, unit = "min deviation", score = it.score,
                    weight = applied("timing_consistency"), configuredWeight = TIMING_WEIGHT,
                    explanation = "Current primary-sleep midpoint versus the circular local-time baseline from ${it.priorNights} prior nights.",
                    role = ScoreContributorRole.SCORED,
                )
            } ?: ScoreContributor(
                id = "timing_consistency", label = "Timing consistency", configuredWeight = TIMING_WEIGHT,
                explanation = "Needs at least $MIN_PRIOR_NIGHTS prior primary nights in the 28-day baseline.",
                role = ScoreContributorRole.UNAVAILABLE,
            ),
            stageContext("deep_sleep", "Deep sleep", deep),
            stageContext("rem_sleep", "REM sleep", rem),
            contextMetric("nightly_hrv", "Nightly HRV", context.nightlyHrvMs, "ms",
                "Night-window HRV context; recovery uses its personal baseline separately."),
            contextMetric("sleeping_hr_drop", "Sleeping HR drop", context.sleepingHeartRateDropBpm, "bpm",
                "Difference between the personal resting-HR baseline and the night's low sleeping rate."),
        )
        val confidence = when (available.size) {
            3 -> "medium"
            2 -> "low"
            else -> "low"
        }
        val unavailable = contributors.filter { it.role == ScoreContributorRole.UNAVAILABLE }.map { it.label }
        val explanation = buildString {
            append("Sleep index = ")
            append(contributors.filter { it.role == ScoreContributorRole.SCORED }.joinToString(" + ") {
                "${(it.weight * 100).roundToInt()}% ${it.label.lowercase()}"
            })
            append(". Deep/REM and physiology are context, not point targets.")
            if (unavailable.isNotEmpty()) append(" Missing contributors were omitted and available weights renormalized: ${unavailable.joinToString()}.")
        }
        return DailySleepScore(
            score, SleepScore.qualityLabel(score), contributors, confidence, VERSION, primary.id,
            totalMinutes, continuity?.awakeMinutes, continuity?.efficiency,
            timing?.deviationMinutes, explanation,
        )
    }

    private data class Continuity(val awakeMinutes: Int, val efficiency: Double, val score: Double)

    private fun continuity(blocks: List<SleepStageBlockEntity>): Continuity? {
        if (!SleepScore.hasUsableStageData(blocks)) return null
        val positive = blocks.filter { it.durationMinutes > 0 }.sortedBy { it.startAt }
        val firstSleep = positive.firstOrNull { it.stageRaw in sleepStages }?.startAt ?: return null
        val lastSleepEnd = positive.lastOrNull { it.stageRaw in sleepStages }?.let {
            it.startAt + it.durationMinutes * 60_000L
        } ?: return null
        if (lastSleepEnd <= firstSleep) return null
        val spanMinutes = ((lastSleepEnd - firstSleep) / 60_000L).toInt()
        if (spanMinutes <= 0) return null
        val states = arrayOfNulls<String>(spanMinutes)
        for (block in positive) {
            repeat(block.durationMinutes) { minute ->
                val at = block.startAt + minute * 60_000L
                if (at !in firstSleep until lastSleepEnd) return@repeat
                val index = ((at - firstSleep) / 60_000L).toInt()
                if (index !in states.indices) return@repeat
                val existing = states[index]
                if (existing != null && existing != block.stageRaw) return null
                states[index] = block.stageRaw
            }
        }
        val namedCoverage = states.count { it == "AWAKE" || (it != null && it in sleepStages) }
        if (namedCoverage * 100 < spanMinutes * 95) return null
        val awake = states.count { it == "AWAKE" }
        val asleep = states.count { it != null && it in sleepStages }
        val denominator = asleep + awake
        if (denominator <= 0) return null
        val efficiency = 100.0 * asleep / denominator
        // NSF supports sleep efficiency as a quality dimension. The 70–85 mapping is an explicit
        // product heuristic, not a diagnostic threshold or a validated coefficient.
        val component = (100.0 * (efficiency - 70.0) / 15.0).coerceIn(0.0, 100.0)
        return Continuity(awake, efficiency, component)
    }

    private data class Timing(val deviationMinutes: Double, val score: Double, val priorNights: Int)

    private fun timingConsistency(
        current: SleepSessionEntity,
        currentBlocks: List<SleepStageBlockEntity>,
        prior: List<SleepSessionEntity>,
        priorBlocks: Map<String, List<SleepStageBlockEntity>>,
        zoneId: ZoneId,
    ): Timing? {
        val currentBounds = namedSleepBounds(currentBlocks) ?: return null
        val currentDate = Instant.ofEpochMilli(current.date).atZone(zoneId).toLocalDate()
        val earliestDate = currentDate.minusDays(28)
        val eligible = prior.asSequence()
            .filter { it.date < current.date && it.totalMinutes > 0 && it.endAt <= currentBounds.first }
            .filter {
                val date = Instant.ofEpochMilli(it.date).atZone(zoneId).toLocalDate()
                !date.isBefore(earliestDate) && date.isBefore(currentDate)
            }
            .groupBy { it.date }.values.mapNotNull { rows -> rows.maxByOrNull { it.totalMinutes } }
            .filter { namedSleepBounds(priorBlocks[it.id].orEmpty()) != null }
        if (eligible.size < MIN_PRIOR_NIGHTS) return null
        val minutes = eligible.map {
            midpointMinute(namedSleepBounds(priorBlocks[it.id].orEmpty())!!, zoneId)
        }
        val x = minutes.sumOf { cos(it / 1440.0 * 2.0 * PI) }
        val y = minutes.sumOf { sin(it / 1440.0 * 2.0 * PI) }
        if (abs(x) + abs(y) < 1e-9) return null
        var center = atan2(y, x) / (2.0 * PI) * 1440.0
        if (center < 0) center += 1440.0
        val currentMinute = midpointMinute(currentBounds, zoneId)
        val direct = abs(currentMinute - center)
        val deviation = minOf(direct, 1440.0 - direct)
        // A two-hour displacement exhausts this contributor. This transparent mapping is a Lumen
        // heuristic; it is not presented as the published Sleep Regularity Index.
        val score = (100.0 * (1.0 - deviation / 120.0)).coerceIn(0.0, 100.0)
        return Timing(deviation, score, eligible.size)
    }

    private fun namedSleepBounds(blocks: List<SleepStageBlockEntity>): Pair<Long, Long>? {
        val named = blocks.filter { it.durationMinutes > 0 && it.stageRaw in sleepStages }
        if (named.isEmpty()) return null
        return named.minOf { it.startAt } to
            named.maxOf { it.startAt + it.durationMinutes * 60_000L }
    }

    private fun midpointMinute(bounds: Pair<Long, Long>, zoneId: ZoneId): Double {
        val midpoint = bounds.first + (bounds.second - bounds.first) / 2L
        val local = Instant.ofEpochMilli(midpoint).atZone(zoneId)
        return local.hour * 60.0 + local.minute + local.second / 60.0
    }

    private fun contextMetric(id: String, label: String, value: Double?, unit: String, text: String) =
        ScoreContributor(
            id = id, label = label, value = value, unit = unit, explanation = text,
            role = if (value == null) ScoreContributorRole.UNAVAILABLE else ScoreContributorRole.CONTEXT,
        )

    private fun stageContext(id: String, label: String, minutes: Int?) = ScoreContributor(
        id = id, label = label, value = minutes?.toDouble(), unit = "min",
        explanation = if (minutes == null) "Unavailable without a named stage timeline."
        else "Ring-labelled stage context; shown without assigning unvalidated score points.",
        role = if (minutes == null) ScoreContributorRole.UNAVAILABLE else ScoreContributorRole.CONTEXT,
    )
}

/** Canonical DB owner for the daily index; UI, coach, widgets and broadcasts consume its result. */
object SleepScoreRepository {
    internal fun selectCurrent(
        rows: List<SleepSessionEntity>,
        mode: SleepScoreReadMode,
    ): List<SleepSessionEntity> {
        val valid = rows.filter { it.totalMinutes > 0 }
        val real = valid.filterNot { DemoDataPolicy.isDemo(it.sourceRaw) }
        return when (mode) {
            SleepScoreReadMode.DISPLAY -> if (real.isNotEmpty()) real else valid
            SleepScoreReadMode.DERIVED -> real
        }
    }

    internal fun selectPrior(
        rows: List<SleepSessionEntity>,
        currentUsesReal: Boolean,
    ): List<SleepSessionEntity> = if (currentUsesReal) {
        rows.filterNot { DemoDataPolicy.isDemo(it.sourceRaw) }
    } else {
        rows.filter { DemoDataPolicy.isDemo(it.sourceRaw) }
    }

    suspend fun forWakingDay(
        db: PulseLoopDatabase,
        day: Long,
        mode: SleepScoreReadMode,
    ): DailySleepScore? {
        val all = db.sleepSessionDao().allByDay(day)
        val sessions = selectCurrent(all, mode)
        if (sessions.isEmpty()) return null
        val currentUsesReal = sessions.any { !DemoDataPolicy.isDemo(it.sourceRaw) }
        val blocks = sessions.associate { it.id to db.sleepStageBlockDao().forSession(it.id) }
        val primary = sessions.maxByOrNull { it.totalMinutes } ?: return null
        val zoneId = ZoneId.systemDefault()
        val currentDate = Instant.ofEpochMilli(day).atZone(zoneId).toLocalDate()
        val baselineStart = currentDate.minusDays(28).atStartOfDay(zoneId)
            .toInstant().toEpochMilli()
        val useReal = mode == SleepScoreReadMode.DERIVED || currentUsesReal
        val priorRows = (if (useReal) {
            db.sleepSessionDao().inRangeReal(baselineStart, day - 1)
        } else {
            db.sleepSessionDao().inRange(baselineStart, day - 1)
        }).filter { it.date < day && it.totalMinutes > 0 }
        val prior = selectPrior(priorRows, useReal).groupBy { it.date }.values.mapNotNull { rows ->
            rows.maxByOrNull { it.totalMinutes }
        }
        val priorBlocks = prior.associate { it.id to db.sleepStageBlockDao().forSession(it.id) }
        val target = (db.userGoalDao().get()?.sleepMinutes ?: 480).coerceIn(420, 720)
        val hrv = if (!useReal) null else db.measurementDao()
            .rangeReal(MeasurementKind.HRV.name, primary.startAt, primary.endAt)
            .map { it.value }.filter { it.isFinite() && it in 1.0..300.0 }.sorted()
            .let { values -> values.takeIf { it.isNotEmpty() }?.let { it[it.size / 2] } }
        val sleepingHr = if (!useReal) null else db.measurementDao().rangeReal(
            MeasurementKind.HEART_RATE.name, primary.startAt, primary.endAt)
            .map { it.value }.filter { it.isFinite() && it in 30.0..220.0 }.sorted()
            .let { values -> values.takeIf { it.isNotEmpty() }
                ?.get(((values.size - 1) * 0.10).roundToInt()) }
        val hrDrop = if (!useReal) null else db.userProfileDao().get()?.hrRestingBaseline
            ?.takeIf { it.isFinite() && it in 30.0..150.0 }?.let { baseline ->
            sleepingHr?.let { baseline - it }?.takeIf { it.isFinite() && it in -100.0..100.0 }
        }
        return DailySleepScoreAlgorithm.calculate(
            sessions, blocks, SleepScoreContext(
                priorPrimarySessions = prior,
                priorBlocksBySession = priorBlocks,
                targetMinutes = target,
                nightlyHrvMs = hrv,
                sleepingHeartRateDropBpm = hrDrop,
                zoneId = zoneId,
            ))
    }
}
