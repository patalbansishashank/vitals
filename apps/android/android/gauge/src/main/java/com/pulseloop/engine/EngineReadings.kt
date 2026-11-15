package com.pulseloop.engine

import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.ring.MeasurementKind
import com.pulseloop.util.TimeUtil
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * (r087) The two readings the engine's own database holds that the screen shows before the server answers: the ring's
 * count of the phone's today and the newest heart-rate reading. Both are what the ring said, with its time; nothing is
 * fused or averaged here. A demo row is never a real reading (`DemoDataPolicy`).
 */
object EngineReadings {
    private val HEART_RATE = MeasurementKind.HEART_RATE.name
    private val DEMO_SOURCES = setOf("demo", "mock")

    /** The ring's count for [date]: null [steps] while it has reported none. */
    data class RingDay(val date: LocalDate, val steps: Int?, val stepsAt: Long?)

    /** The key `activity_daily` files [date] under: its local midnight, as every writer computes it. */
    fun dayStart(date: LocalDate, zone: ZoneId = ZoneId.systemDefault()): Long =
        TimeUtil.startOfDayLocal(date.atTime(12, 0).atZone(zone).toInstant().toEpochMilli(), zone)

    suspend fun ringDay(db: PulseLoopDatabase, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): RingDay {
        val row = db.activityDailyDao().byDay(TimeUtil.startOfDayLocal(now, zone))?.takeIf { it.source !in DEMO_SOURCES }
        return RingDay(Instant.ofEpochMilli(now).atZone(zone).toLocalDate(), row?.steps, row?.updatedAt)
    }

    suspend fun today(db: PulseLoopDatabase, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): EngineState.Today? {
        val day = ringDay(db, now, zone)
        val steps = day.steps?.takeIf { it >= 0 } ?: return null
        return EngineState.Today(day.date.toString(), steps, EngineStateReader.iso(day.stepsAt))
    }

    suspend fun latestHr(db: PulseLoopDatabase): EngineState.LatestHr? {
        val row = db.measurementDao().latestRealFlow(HEART_RATE).first() ?: return null
        val at = EngineStateReader.iso(row.timestamp) ?: return null
        // a reading of nothing (the ring was off the finger) is not a heart rate
        if (!row.value.isFinite() || row.value <= 0) return null
        return EngineState.LatestHr(row.value.roundToInt(), at)
    }

    /** Fires when the ring's count for [date] is first read and each time it or its time changes. */
    fun stepsChanges(db: PulseLoopDatabase, date: LocalDate, zone: ZoneId = ZoneId.systemDefault()): Flow<Unit> =
        db.activityDailyDao().byDayFlow(dayStart(date, zone)).map { it?.steps to it?.updatedAt }.distinctUntilChanged().map { }

    /** Fires when the newest heart-rate reading is first read and each time a newer one lands (or it is removed). */
    fun heartRateChanges(db: PulseLoopDatabase): Flow<Unit> =
        db.measurementDao().latestRealFlow(HEART_RATE).map { it?.timestamp to it?.value }.distinctUntilChanged().map { }
}
