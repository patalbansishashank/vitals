package com.pulseloop.data

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.pulseloop.data.entity.SleepSessionEntity
import com.pulseloop.data.entity.SleepStageBlockEntity
import com.pulseloop.hub.HubEventMapper
import com.pulseloop.ring.JStyle2301Decoder
import com.pulseloop.ring.RingClockSegment
import com.pulseloop.service.ClockShiftSleep
import com.pulseloop.service.SleepScore
import com.pulseloop.service.asleepMinutes
import com.pulseloop.util.TimeUtil

/**
 * v32 → v33: removes every duplicate 2.7.3's ring-clock correction stored and re-derives what was
 * built on them.
 *
 * 2.7.3 learned the J-Style 2301 ring's clock ran 383 s fast and shifted each re-pulled history record
 * back by that offset — onto a new key next to the copy older versions had stored at the ring's
 * raw stamp — and shifted each later connection's records by that connection's sub-second
 * read-back noise, a new key every time. Server data: Oct 26 24,260 steps for a real 12,122,
 * Oct 27 4,274 heart-rate samples for 993 real ones, the same doubling for SpO2, HRV, stress,
 * temperature and every vendor estimate, and ~6 minutes of each night counted twice.
 *
 * - **Activity buckets** and **ring-history measurements** (every `history`/`vendor_history` kind):
 *   [ClockDuplicates] finds the raw twins and near copies; they are deleted.
 * - **Sleep**: [ClockShiftSleep.trimStoredRuns] cuts the surviving raw tail of each re-pulled
 *   night; the session's bounds, time asleep and score are recomputed from what is left.
 * - `activity_daily` gains `deviceSteps` (the old total for untouched days, null for re-summed
 *   ones until the ring next reports them); affected days' steps and distance are re-summed.
 * - Each removed bucket or measurement is queued in `hub_pending_deletions` (an exact instant, its
 *   upload category) so the server drops it too. Scores and other derived values outside these
 *   tables are recomputed once at the next start ([DataRepairs.repairAfterClockDuplicatesIfNeeded]).
 *
 * [clockSegments] are the offsets 2.7.3 persisted per ring; without them only near copies go.
 */
class ClockDuplicateMigration(
    private val clockSegments: () -> List<RingClockSegment>,
    private val now: () -> Long = System::currentTimeMillis,
) : Migration(32, 33) {

    private data class Pending(val category: String, val kind: String?, val at: Long)

    override fun migrate(db: SupportSQLiteDatabase) {
        val hasDeviceSteps = db.query("PRAGMA table_info(`activity_daily`)").use { c ->
            generateSequence { if (c.moveToNext()) c.getString(c.getColumnIndexOrThrow("name")) else null }
                .any { it == "deviceSteps" }
        }
        if (!hasDeviceSteps) db.execSQL("ALTER TABLE `activity_daily` ADD COLUMN `deviceSteps` INTEGER")
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `hub_pending_deletions` (
                `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                `category` TEXT NOT NULL,
                `kind` TEXT,
                `fromMs` INTEGER NOT NULL,
                `toMs` INTEGER NOT NULL,
                `createdAt` INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL("UPDATE `activity_daily` SET `deviceSteps` = `steps`")

        val segments = clockSegments()
        val at = now()
        // Twins exist only for records the ring still held when 2.7.3 re-pulled them; near copies
        // only since 2.7.3. Two months before the first set (or before now) covers both.
        val windowStart = (ClockDuplicates.usable(segments).minOfOrNull { it.setAtMs } ?: at) - WINDOW_MS
        val pending = mutableListOf<Pending>()

        removeBucketDuplicates(db, segments, at, pending)
        removeMeasurementDuplicates(db, segments, windowStart, pending)
        repairSleep(db, segments, windowStart, at)

        for (p in pending) {
            db.insert("hub_pending_deletions", SQLiteDatabase.CONFLICT_ABORT, ContentValues().apply {
                put("category", p.category)
                put("kind", p.kind)
                put("fromMs", p.at)
                put("toMs", p.at)
                put("createdAt", at)
            })
        }
    }

    private fun removeBucketDuplicates(db: SupportSQLiteDatabase, segments: List<RingClockSegment>, at: Long, pending: MutableList<Pending>) {
        val rows = buildList {
            db.query(
                "SELECT `startEpoch`, `date`, `steps`, `updatedAt` FROM `activity_buckets` " +
                    "WHERE `source` NOT IN ('demo','mock') ORDER BY `startEpoch` ASC",
            ).use { c ->
                while (c.moveToNext()) add(ClockDuplicates.Row(c.getLong(0) to c.getLong(1), c.getLong(0), c.getInt(2).toDouble(), c.getLong(3)))
            }
        }
        val removed = ClockDuplicates.find(rows, segments, twinsMatchValue = true, nearMatchValue = false)
        if (removed.isEmpty()) return
        removed.map { it.at }.chunked(500).forEach { chunk ->
            db.execSQL("DELETE FROM `activity_buckets` WHERE `startEpoch` IN (${chunk.joinToString(",")})")
        }
        removed.forEach { pending += Pending(HubEventMapper.BUCKET_CATEGORY, HubEventMapper.BUCKET_KIND, it.at) }
        for (day in removed.map { it.key.second }.toSortedSet()) {
            db.execSQL(
                """
                UPDATE `activity_daily` SET
                    `steps` = (SELECT COALESCE(SUM(`steps`), 0) FROM `activity_buckets` WHERE `date` = ?),
                    `distanceMeters` = (SELECT COALESCE(SUM(`distanceMeters`), 0) FROM `activity_buckets` WHERE `date` = ?),
                    `deviceSteps` = NULL,
                    `updatedAt` = ?
                WHERE `date` = ?
                """.trimIndent(),
                arrayOf<Any>(day, day, at, day),
            )
        }
    }

    private fun removeMeasurementDuplicates(
        db: SupportSQLiteDatabase,
        segments: List<RingClockSegment>,
        windowStart: Long,
        pending: MutableList<Pending>,
    ) {
        val kinds = buildList {
            db.query(
                "SELECT DISTINCT `kindRaw` FROM `measurements` WHERE `sourceRaw` IN ('history','vendor_history') AND `timestamp` >= ?",
                arrayOf<Any>(windowStart),
            ).use { c -> while (c.moveToNext()) add(c.getString(0)) }
        }
        for (kind in kinds) {
            val rows = buildList {
                db.query(
                    "SELECT `id`, `timestamp`, `value`, `createdAt` FROM `measurements` " +
                        "WHERE `kindRaw` = ? AND `sourceRaw` IN ('history','vendor_history') AND `timestamp` >= ? ORDER BY `timestamp` ASC",
                    arrayOf<Any>(kind, windowStart),
                ).use { c -> while (c.moveToNext()) add(ClockDuplicates.Row(c.getString(0), c.getLong(1), c.getDouble(2), c.getLong(3))) }
            }
            val removed = ClockDuplicates.find(
                rows, segments,
                stamp = if (kind in DATE_STAMPED_KINDS) ClockDuplicates.Stamp.DATE else ClockDuplicates.Stamp.RING_CLOCK,
                isDayStart = { TimeUtil.startOfDayLocal(it) == it },
            )
            if (removed.isEmpty()) continue
            removed.chunked(500).forEach { chunk ->
                db.execSQL(
                    "DELETE FROM `measurements` WHERE `id` IN (${chunk.joinToString(",") { "?" }})",
                    chunk.map { it.key }.toTypedArray(),
                )
            }
            val categories = HubEventMapper.categoriesFor(kind)
            for (row in removed) categories.forEach { (category, k) -> pending += Pending(category, k, row.at) }
        }
    }

    private fun repairSleep(db: SupportSQLiteDatabase, segments: List<RingClockSegment>, windowStart: Long, at: Long) {
        val sessions = buildList {
            db.query(
                "SELECT `id`, `date`, `createdAt` FROM `sleep_sessions` WHERE `sourceRaw` = 'ring' AND `endAt` >= ?",
                arrayOf<Any>(windowStart),
            ).use { c -> while (c.moveToNext()) add(Triple(c.getString(0), c.getLong(1), c.getLong(2))) }
        }
        for ((id, date, createdAt) in sessions) {
            val blocks = buildList {
                db.query(
                    "SELECT `id`, `startAt`, `startMinute`, `durationMinutes`, `stageRaw` FROM `sleep_stage_blocks` " +
                        "WHERE `sessionId` = ? ORDER BY `startAt` ASC",
                    arrayOf<Any>(id),
                ).use { c ->
                    while (c.moveToNext()) add(SleepStageBlockEntity(c.getString(0), id, c.getLong(1), c.getInt(2), c.getInt(3), c.getString(4)))
                }
            }
            if (blocks.isEmpty()) continue
            val kept = ClockShiftSleep.trimStoredRuns(blocks, segments, createdAt)
            if (kept == blocks) continue
            db.execSQL("DELETE FROM `sleep_stage_blocks` WHERE `sessionId` = ?", arrayOf<Any>(id))
            if (kept.isEmpty()) {
                db.execSQL("DELETE FROM `sleep_sessions` WHERE `id` = ?", arrayOf<Any>(id))
                continue
            }
            val start = kept.minOf { it.startAt }
            val end = kept.maxOf { it.startAt + it.durationMinutes * 60_000L }
            val total = asleepMinutes(kept)
            val rebuilt = kept.map { it.copy(startMinute = ((it.startAt - start) / 60_000L).toInt()) }
            val score = SleepScore.calculateIfUsable(
                SleepSessionEntity(id = id, date = date, startAt = start, endAt = end, totalMinutes = total),
                rebuilt,
            )?.score
            for (b in rebuilt) {
                db.insert("sleep_stage_blocks", SQLiteDatabase.CONFLICT_REPLACE, ContentValues().apply {
                    put("id", b.id); put("sessionId", id); put("startAt", b.startAt)
                    put("startMinute", b.startMinute); put("durationMinutes", b.durationMinutes); put("stageRaw", b.stageRaw)
                })
            }
            db.execSQL(
                "UPDATE `sleep_sessions` SET `startAt` = ?, `endAt` = ?, `totalMinutes` = ?, `score` = ?, `updatedAt` = ? WHERE `id` = ?",
                arrayOf<Any?>(start, end, total, score, at, id),
            )
        }
    }

    companion object {
        private const val WINDOW_MS = 60L * 86_400_000L
        /** The J-Style day totals, stored as vendor measurements under a date, not a ring stamp. */
        val DATE_STAMPED_KINDS = JStyle2301Decoder.DAY_TOTAL_KEYS.map { "VENDOR_" + it.uppercase() }.toSet()
    }
}
