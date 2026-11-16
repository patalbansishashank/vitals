package com.pulseloop.social

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import java.time.LocalDate
import kotlinx.coroutines.flow.Flow

/**
 * One app's foreground-time total for one local day (v38; SPEC social-time). Durations only — never anything about what
 * was on screen. [date] is ISO `yyyy-MM-dd` in the phone's zone, so the day turns over at local midnight. [seconds] is
 * the whole-day total recomputed from Usage access each cycle, not an increment, so a row is replaced in place.
 *
 * Persisted every cycle so history survives UsageStats' own short retention window: once a day is stored here it is the
 * source for the hub upload even after Android has dropped the raw events.
 */
@Entity(
    tableName = "social_time_days",
    primaryKeys = ["date", "app"],
    indices = [Index("date")],
)
data class SocialTimeDayEntity(
    val date: String,
    /** [SocialApp.key]. */
    val app: String,
    val seconds: Int = 0,
    val updatedAt: Long = 0,
)

@Dao
interface SocialTimeDao {
    /** Whole-day totals are recomputed and replaced, never accumulated, so REPLACE is correct and API-safe. */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rows: List<SocialTimeDayEntity>)

    @Query("SELECT * FROM social_time_days WHERE date = :date")
    suspend fun day(date: String): List<SocialTimeDayEntity>

    @Query("SELECT * FROM social_time_days WHERE date >= :from AND date <= :to ORDER BY date ASC")
    suspend fun range(from: String, to: String): List<SocialTimeDayEntity>

    @Query("SELECT * FROM social_time_days WHERE date >= :from AND date <= :to ORDER BY date ASC")
    fun rangeFlow(from: String, to: String): Flow<List<SocialTimeDayEntity>>

    @Query("DELETE FROM social_time_days WHERE date = :date AND app = :app")
    suspend fun clear(date: String, app: String)
}

/** One day's foreground time summed over the enabled apps, as the card shows it and the hub sends it. */
data class SocialDaySummary(
    val date: LocalDate,
    /** Seconds per [SocialApp.key], only apps with time > 0 that day. */
    val perApp: Map<String, Int>,
    val updatedAt: Long,
) {
    val totalSeconds: Int get() = perApp.values.sum()

    companion object {
        fun of(date: LocalDate, rows: List<SocialTimeDayEntity>): SocialDaySummary {
            val mine = rows.filter { it.date == date.toString() && it.seconds > 0 }
            return SocialDaySummary(
                date = date,
                perApp = mine.associate { it.app to it.seconds },
                updatedAt = mine.maxOfOrNull { it.updatedAt } ?: 0L,
            )
        }

        fun empty(date: LocalDate) = SocialDaySummary(date, emptyMap(), 0L)
    }
}
