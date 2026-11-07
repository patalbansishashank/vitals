package com.pulseloop.shortvideo

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Query
import androidx.room.Transaction
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.Flow

/**
 * One app's short-video tally for one local day (v32). Only counts: nothing about what was
 * watched. [date] is ISO `yyyy-MM-dd` in the phone's zone at the moment of counting, so the day
 * turns over at local midnight.
 */
@Entity(
    tableName = "short_video_days",
    primaryKeys = ["date", "app"],
    indices = [Index("date")],
)
data class ShortVideoDayEntity(
    val date: String,
    /** [ShortVideoApp.key]. */
    val app: String,
    val count: Int = 0,
    /** Countdowns started on this app that day (each reel at or over the limit). */
    val limitHits: Int = 0,
    val cancels: Int = 0,
    /** The daily limit in force at the last update. */
    val dailyLimit: Int = ShortVideoSettings.DEFAULT_LIMIT,
    val updatedAt: Long = 0,
)

@Dao
abstract class ShortVideoDao {
    @Query(
        "INSERT OR IGNORE INTO short_video_days(date, app, count, limitHits, cancels, dailyLimit, updatedAt) " +
            "VALUES(:date, :app, 0, 0, 0, :limit, :now)",
    )
    abstract suspend fun ensureRow(date: String, app: String, limit: Int, now: Long)

    @Query("UPDATE short_video_days SET count = count + 1, dailyLimit = :limit, updatedAt = :now WHERE date = :date AND app = :app")
    abstract suspend fun bumpCount(date: String, app: String, limit: Int, now: Long)

    @Query("UPDATE short_video_days SET limitHits = limitHits + 1, dailyLimit = :limit, updatedAt = :now WHERE date = :date AND app = :app")
    abstract suspend fun bumpLimitHit(date: String, app: String, limit: Int, now: Long)

    @Query("UPDATE short_video_days SET cancels = cancels + 1, dailyLimit = :limit, updatedAt = :now WHERE date = :date AND app = :app")
    abstract suspend fun bumpCancel(date: String, app: String, limit: Int, now: Long)

    /** Insert-then-update rather than SQLite UPSERT, which API 26–29 devices lack. */
    @Transaction
    open suspend fun increment(date: String, app: String, field: Field, limit: Int, now: Long) {
        ensureRow(date, app, limit, now)
        when (field) {
            Field.COUNT -> bumpCount(date, app, limit, now)
            Field.LIMIT_HIT -> bumpLimitHit(date, app, limit, now)
            Field.CANCEL -> bumpCancel(date, app, limit, now)
        }
    }

    @Query("SELECT * FROM short_video_days WHERE date = :date")
    abstract suspend fun day(date: String): List<ShortVideoDayEntity>

    @Query("SELECT * FROM short_video_days WHERE date >= :from AND date <= :to ORDER BY date ASC")
    abstract fun rangeFlow(from: String, to: String): Flow<List<ShortVideoDayEntity>>

    @Query("DELETE FROM short_video_days WHERE date = :date")
    abstract suspend fun clearDay(date: String)

    enum class Field { COUNT, LIMIT_HIT, CANCEL }
}

/** One day summed over both apps, as shown in the app and sent to the hub. */
data class ShortVideoDaySummary(
    val date: LocalDate,
    val counts: Map<ShortVideoApp, Int>,
    val limit: Int,
    val limitHits: Int,
    val cancels: Int,
    val updatedAt: Long,
) {
    val total: Int get() = counts.values.sum()
    fun count(app: ShortVideoApp): Int = counts[app] ?: 0

    companion object {
        fun of(date: LocalDate, rows: List<ShortVideoDayEntity>, fallbackLimit: Int): ShortVideoDaySummary {
            val mine = rows.filter { it.date == date.toString() }
            return ShortVideoDaySummary(
                date = date,
                counts = ShortVideoApp.entries.associateWith { app -> mine.filter { it.app == app.key }.sumOf { it.count } },
                limit = mine.maxByOrNull { it.updatedAt }?.dailyLimit ?: fallbackLimit,
                limitHits = mine.sumOf { it.limitHits },
                cancels = mine.sumOf { it.cancels },
                updatedAt = mine.maxOfOrNull { it.updatedAt } ?: 0L,
            )
        }
    }
}

/** Local-midnight day arithmetic, kept pure so the rollover is testable with any zone. */
object ShortVideoDayClock {
    fun dayOf(epochMs: Long, zone: ZoneId = ZoneId.systemDefault()): LocalDate =
        Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate()

    fun startOfDay(date: LocalDate, zone: ZoneId = ZoneId.systemDefault()): Instant =
        date.atStartOfDay(zone).toInstant()

    /** The last [days] days ending with [today], oldest first. */
    fun window(today: LocalDate, days: Int): List<LocalDate> =
        (days - 1 downTo 0).map { today.minusDays(it.toLong()) }
}
