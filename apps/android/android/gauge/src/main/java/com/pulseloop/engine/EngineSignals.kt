package com.pulseloop.engine

import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.hub.HubSettingsSource
import com.pulseloop.ring.RingBLEClient
import com.pulseloop.shortvideo.ShortVideoPrefs
import com.pulseloop.social.SocialPrefs
import com.pulseloop.util.TimeUtil
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.transform

/** (r087) When the engine's state is worth building again for the screen. */
object EngineSignals {
    /** A wait is never longer than this: a changed clock or time zone, or a timer the phone's sleep held back, is noticed. */
    const val DAY_RECHECK_MS = 15 * 60_000L

    /**
     * The phone's local date now, then each new date as it comes. Whatever is keyed by "today" follows this instead of
     * a date taken once.
     */
    fun localDays(
        now: () -> Long = System::currentTimeMillis,
        zone: () -> ZoneId = ZoneId::systemDefault,
    ): Flow<LocalDate> = flow {
        while (true) {
            val at = now()
            val z = zone()
            emit(Instant.ofEpochMilli(at).atZone(z).toLocalDate())
            delay(TimeUtil.millisUntilNextLocalDay(at, z).coerceAtMost(DAY_RECHECK_MS))
        }
    }.distinctUntilChanged()

    /**
     * Every reason to build the state for the screen: each of the engine's own [changes] (its mode, a permission
     * answer; [onChange] runs before the change is passed on, so what was kept from before it is dropped first), and
     * [active]'s signals for as long as the engine runs the ring. [isActive] is asked again after every change: a take
     * over starts them, the old ring app coming back stops them.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun forState(
        changes: Flow<Unit>,
        onChange: () -> Unit,
        isActive: () -> Boolean,
        active: suspend () -> Flow<Unit>,
    ): Flow<Unit> = merge(
        changes.onEach { onChange() },
        changes.onStart { emit(Unit) }.flatMapLatest { if (isActive()) active() else emptyFlow() },
    )

    /**
     * Every reason to build the state again while the engine runs the ring: the [link] to it, the upload ([hub] and
     * the queue), the saved ring, the short-video settings, and what the database holds for the phone's date ([days])
     * with the newest heart rate. A step count or a heart-rate reading stored on this phone is a signal, so the screen
     * has it before the server does. Each part also signals once when it is first read.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun active(
        db: PulseLoopDatabase,
        link: Flow<RingBLEClient.BLEState>,
        hub: HubSettingsSource,
        videoPrefs: Flow<ShortVideoPrefs>,
        socialPrefs: Flow<SocialPrefs>,
        zone: () -> ZoneId = ZoneId::systemDefault,
        days: Flow<LocalDate> = localDays(zone = zone),
    ): Flow<Unit> = merge(
        // only what the state shows of the link: its trace and the scan list change far more often
        link.map {
            listOf(it.connectionState, it.batteryPercent, it.lastError, it.firmwareVersion, it.credentialRejected, it.credentialAuthenticated)
        }.distinctUntilChanged().map { },
        hub.pairing.map { },
        hub.status.map { },
        db.hubOutboxDao().pendingCountFlow().map { },
        db.deviceDao().currentFlow().map { },
        videoPrefs.map { },
        socialPrefs.map { },
        // what is counted per day follows the phone's date over midnight
        days.flatMapLatest { day ->
            merge(
                db.shortVideoDao().rangeFlow(day.toString(), day.toString()).map { },
                db.socialTimeDao().rangeFlow(day.toString(), day.toString()).map { },
                EngineReadings.stepsChanges(db, day, zone()),
            )
        },
        EngineReadings.heartRateChanges(db),
    )

    /**
     * Lets a signal through at once, then at most one per [gapMs] while they keep coming; the last one always gets
     * through. A history pass writes rows without a pause, so waiting for a quiet moment would hold today's steps back
     * until the pass ends.
     */
    fun Flow<Unit>.paced(gapMs: Long): Flow<Unit> = conflate().transform {
        emit(it)
        delay(gapMs)
    }
}
