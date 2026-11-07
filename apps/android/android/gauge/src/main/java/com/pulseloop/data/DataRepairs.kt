package com.pulseloop.data

import android.content.Context
import androidx.room.withTransaction
import com.pulseloop.service.SleepScore
import com.pulseloop.service.DailyCalorieEstimator
import com.pulseloop.service.asleepMinutes
import com.pulseloop.util.TimeUtil

/**
 * One-time, prefs-gated data repairs run at app start, off the render path.
 * Mirrors the iOS pattern (`ActivityService.migrateInflatedActivityIfNeeded` /
 * `SleepService.migrateSplitSleepSessionsIfNeeded` in PulseServices.swift).
 */
object DataRepairs {
    private const val PREFS = "data_repairs"

    /**
     * Repair of `activity_daily` rows written by the old bucket handling, which routed history
     * buckets through the live max() ratchet and collapsed a past day's total to its single
     * largest bucket. Recomputes each past day that has synced buckets as the sum of its
     * distinct `activity_buckets` rows (the same aggregation the live sync path uses).
     *
     * Days WITHOUT buckets are left untouched: the ring only re-serves ~7 days of history,
     * so deleting older rows would permanently destroy months of step/distance history in
     * exchange for nothing — an undercounted total beats no total. Days inside the re-serve
     * window are additionally self-healed by `applyActivityBucket` on the next sync. Today's
     * row is out of scope — the live cumulative total re-ratchets on the next update.
     *
     * Complete ring sleep records independently replace their waking-day session and remove any
     * overlapping legacy midnight-split parents. Connection events must not clear real sleep:
     * replacement history is asynchronous and may be empty or consumed.
     */
    suspend fun runIfNeeded(context: Context, db: PulseLoopDatabase = PulseLoopDatabase.getInstance(context)) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "activityBucketRepair.v1"
        if (prefs.getBoolean(key, false)) {
            repairEnergyEstimatesIfNeeded(context, db)
            return
        }
        val today = TimeUtil.startOfTodayLocal()
        for (day in db.activityBucketDao().daysBefore(today)) {
            val buckets = db.activityBucketDao().byDay(day)
            if (buckets.isEmpty()) continue
            val existing = db.activityDailyDao().byDay(day) ?: continue
            db.activityDailyDao().upsert(existing.copy(
                steps = buckets.sumOf { it.steps },
                distanceMeters = buckets.sumOf { it.distanceMeters },
                source = "ring_history",
                updatedAt = System.currentTimeMillis(),
            ))
        }
        prefs.edit().putBoolean(key, true).apply()
        repairEnergyEstimatesIfNeeded(context, db)
    }

    /**
     * Once after the v33 migration removed 2.7.3's clock duplicates: re-derive what was computed
     * from them outside the tables the migration rewrote. The resting-HR baseline, and the daily
     * insights (recovery, sleep, activity, HRV balance and the rest) for each recent day, which the
     * engine otherwise only computes for today. Calorie estimates rerun through
     * [repairEnergyEstimatesIfNeeded]. Recomputed insights upload as newer versions, so the
     * server's scores follow.
     */
    suspend fun repairAfterClockDuplicatesIfNeeded(
        context: Context,
        db: PulseLoopDatabase = PulseLoopDatabase.getInstance(context),
        nowMs: Long = System.currentTimeMillis(),
    ) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "clockDuplicateDerived.v33"
        if (prefs.getBoolean(key, false)) return
        com.pulseloop.service.RestingHRBaselineService.refreshNow(db)
        val today = TimeUtil.startOfDayLocal(nowMs)
        for (daysAgo in CLOCK_DUPLICATE_DAYS downTo 1) {
            val dayEnd = TimeUtil.startOfDayLocal(today - (daysAgo - 1) * 86_400_000L) - 1
            com.pulseloop.service.LocalInsightEngine.recomputeAndPublish(db, nowMs = dayEnd)
        }
        prefs.edit().putBoolean(key, true).apply()
    }

    /** 2.7.3 re-pulled about two weeks of ring history (back to Oct 14 on the owner's ring). */
    private const val CLOCK_DUPLICATE_DAYS = 21

    /** Recompute daily derived energy; original device fields and workout calories survive. */
    suspend fun repairEnergyEstimatesIfNeeded(
        context: Context,
        db: PulseLoopDatabase = PulseLoopDatabase.getInstance(context),
    ) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        // v33 removed 2.7.3's duplicate activity buckets: the estimates built on them rerun once.
        val keys = listOf("dailyDistanceEnergy.v3", "activityBucketDedupe.v33")
        if (keys.all { prefs.getBoolean(it, false) }) return
        val person = db.userProfileDao().get()
        val profile = DailyCalorieEstimator.Profile(person?.sex, person?.age, person?.weightKg, person?.heightCm)
        // Per-day transactions serialize read/modify/write with incoming sync without holding
        // one write lock for an entire multi-year archive. An interrupted pass safely repeats.
        for (day in db.activityDailyDao().recentReal(Int.MAX_VALUE)) {
            db.withTransaction { DailyCalorieEstimator.recompute(day.date, db, profile) }
        }
        prefs.edit().apply { keys.forEach { putBoolean(it, true) } }.apply()
    }

    /**
     * Restate every stored night's `totalMinutes` as time asleep rather than the span from its
     * start to its end (issue #63). Ring history only reaches back about a week, so a re-sync
     * would leave every older night reading the old way indefinitely — and the two numbers differ
     * by the awake stretches plus, on a night the ring split into two records, the gap between
     * them: 8 h 10 against 6 h 48 on the reporter's night.
     *
     * Recomputed from each session's own stage blocks, which are exact — they are a run-length
     * encoding of a per-minute stage list and are de-overlapped on merge. A session with no blocks
     * left is skipped rather than zeroed: there is nothing to recompute from, and a zero would
     * hide the night entirely (`byDay` and `earliestDay` both filter on `totalMinutes > 0`).
     * Demo rows are repaired too, so a seeded night and a real one report the same kind of number.
     *
     * The stored `score` is recomputed with it, since the score's denominators moved with the
     * definition. And the whole pass is one transaction: it runs at app start alongside the first
     * sync, and a row-by-row read-modify-write outside one could overwrite a night the reconcile
     * had just rewritten with a stale snapshot of it.
     */
    suspend fun repairSleepDurationsIfNeeded(
        context: Context,
        db: PulseLoopDatabase = PulseLoopDatabase.getInstance(context),
    ) {
        repairV0789SleepStagesIfNeeded(context, db)
        // Independent version gate: existing installs already completed the duration repair.
        repairSleepScoresIfNeeded(context, db)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "sleepAsleepMinutesRepair.v1"
        if (prefs.getBoolean(key, false)) return
        val now = System.currentTimeMillis()
        db.withTransaction {
            for (session in db.sleepSessionDao().all()) {
                val blocks = db.sleepStageBlockDao().forSession(session.id)
                if (blocks.isEmpty()) continue
                val asleep = asleepMinutes(blocks)
                if (asleep == session.totalMinutes) continue
                val restated = session.copy(totalMinutes = asleep, updatedAt = now)
                db.sleepSessionDao().upsert(
                    restated.copy(score = SleepScore.calculateIfUsable(restated, blocks)?.score)
                )
            }
        }
        prefs.edit().putBoolean(key, true).apply()
    }

    /**
     * Restates only UNKNOWN minutes whose retained raw packet proves V0789 byte 5. Existing sleep
     * rows have no firmware/raw-code provenance, so missing or conflicting packet evidence is a
     * hard no-op. A normal history re-sync will apply the corrected decoder to other retained days.
     */
    suspend fun repairV0789SleepStagesIfNeeded(
        context: Context,
        db: PulseLoopDatabase = PulseLoopDatabase.getInstance(context),
    ) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "v0789Raw5AwakeRepair.v1"
        if (prefs.getBoolean(key, false)) return
        val packets = db.rawPacketDao().byFirmwareAndKind("V0789", "sleep_timeline")
        val awakeEvidence = V0789SleepStageRepair.awakeMinuteEvidence(packets)
        if (awakeEvidence.isNotEmpty()) {
            db.withTransaction {
                for (session in db.sleepSessionDao().all()) {
                    val blocks = db.sleepStageBlockDao().forSession(session.id)
                    val repaired = V0789SleepStageRepair.repair(session, blocks, awakeEvidence)
                        ?: continue
                    db.sleepStageBlockDao().deleteBySession(session.id)
                    repaired.blocks.forEach { db.sleepStageBlockDao().insert(it) }
                    val restated = session.copy(
                        totalMinutes = repaired.asleepMinutes,
                        updatedAt = System.currentTimeMillis(),
                    )
                    db.sleepSessionDao().upsert(restated.copy(
                        score = SleepScore.calculateIfUsable(restated, repaired.blocks)?.score,
                    ))
                }
            }
        }
        // Only mark complete after every row and its recomputed duration/score commit atomically.
        prefs.edit().putBoolean(key, true).apply()
    }

    /** Refresh the derived score without changing a single recorded minute or stage block. */
    suspend fun repairSleepScoresIfNeeded(
        context: Context,
        db: PulseLoopDatabase = PulseLoopDatabase.getInstance(context),
    ) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "sleepDurationContinuityScore.v3"
        if (prefs.getBoolean(key, false)) return
        db.withTransaction {
            for (session in db.sleepSessionDao().all()) {
                val blocks = db.sleepStageBlockDao().forSession(session.id)
                val score = SleepScore.calculateIfUsable(session, blocks)?.score
                if (score != session.score) {
                    db.sleepSessionDao().upsert(session.copy(
                        score = score,
                        updatedAt = System.currentTimeMillis(),
                    ))
                }
            }
        }
        // Only mark complete after the transaction succeeds; interrupted passes are idempotent.
        prefs.edit().putBoolean(key, true).apply()
    }
}
