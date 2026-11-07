package com.pulseloop.ring

import com.pulseloop.wearables.WearableModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import android.util.Log
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Coordinator for the J-Style 2301A/2301B platform used by the J-Style 2301 ring.
 *
 * This is not PulseLoop's existing `jring`/56ff family. The verified topology is one FFF0
 * service, writes on FFF6 and notifications on FFF7; history commands and packet layouts match the
 * manufacturer 2301 SDK and our physical V0525 capture.
 */
object JStyle2301Coordinator : WearableCoordinator {
    override val deviceType: RingDeviceType = RingDeviceType.JSTYLE_2301

    override fun matches(name: String?, advertisement: AdvertisementInfo): Boolean {
        if (WearableModel.modelForAdvertisedName(name)?.family == deviceType) return true
        val marker = advertisement.manufacturerData
        if (marker != null && marker.size >= 4 &&
            (marker[0].toInt() and 0xFF) == 0x34 &&
            (marker[1].toInt() and 0xFF) == 0x12 &&
            (marker[marker.lastIndex - 1].toInt() and 0xFF) == 0x23 &&
            (marker.last().toInt() and 0xFF) == 0x01
        ) return true
        return name?.startsWith("$RING_VENDOR Smart Ring", ignoreCase = true) == true
    }

    override val capabilities: Set<WearableCapability> = setOf(
        WearableCapability.HEART_RATE,
        WearableCapability.SPO2,
        WearableCapability.SPO2_HISTORY,
        WearableCapability.STEPS,
        WearableCapability.SLEEP,
        WearableCapability.REM_SLEEP,
        WearableCapability.HRV,
        WearableCapability.STRESS,
        WearableCapability.TEMPERATURE,
        WearableCapability.BATTERY,
        WearableCapability.MANUAL_HEART_RATE,
        WearableCapability.REALTIME_HEART_RATE,
    )

    override val iconSystemName: String = "circle.circle.fill"

    override fun makeDriver(writer: RingCommandWriter): WearableDriver = JStyle2301Driver(writer)
}

class JStyle2301Driver(
    private val writer: RingCommandWriter?,
    private val zoneId: ZoneId = ZoneId.systemDefault(),
    private val now: () -> Instant = Instant::now,
    /**
     * GA.8 per-stream history cursors. Process-wide until [configureHistoryCursorStore] supplies the
     * durable per-ring store (`RingBLEClient.installDriver` does, right after construction); null
     * turns cursoring off entirely.
     */
    cursorStore: JStyle2301HistoryCursorStore? = JStyle2301HistoryCursorStore.PROCESS,
    /** Whether this pass may read sleep: a read closes the ring's open sleep record ([RingSleepReadHold]). */
    private val mayReadSleep: () -> Boolean = { RingSleepReadHold.mayRead(now(), zoneId) },
    private val mayReadSleepUnattended: () -> Boolean = { RingSleepReadHold.mayReadUnattended(now(), zoneId) },
    private val firmwarePasscode: () -> ByteArray = JStyle2301Passcode::bytes,
) : WearableDriver {
    private val cursors = cursorStore?.let(::SwitchableJStyle2301HistoryCursorStore)
    private val decoder = JStyle2301Decoder(zoneId)
    /** Built lazily so [configureClockStore] (called right after construction) is honoured. */
    private var clockStore: RingClockStore? = null
    private var corrector: RingClockCorrector? = null
    private fun clock(): RingClockCorrector =
        corrector ?: RingClockCorrector(clockStore).also { corrector = it }
    private val historySync = JStyle2301HistorySync(writer, cursorStore = cursors)
    private var connectionSecret: String? = null
    private var syncEngine: JStyle2301SyncEngine? = null

    override val serviceUUIDs: List<String> = listOf(JStyle2301UUIDs.SERVICE)
    override val writeUUID: String = JStyle2301UUIDs.WRITE
    override val notifyUUIDs: List<String> = listOf(JStyle2301UUIDs.NOTIFY)
    override val requiredSubscriptionsBeforeConnected = listOf(
        RequiredSubscription(JStyle2301UUIDs.NOTIFY, SubscriptionMode.NOTIFICATION),
    )

    override fun frame(command: ByteArray): ByteArray = command

    override fun configureClockStore(store: RingClockStore?) {
        clockStore = store
        corrector = null
    }

    override fun configureHistoryCursorStore(store: RingHistoryCursorStore?) {
        cursors?.durable = store?.let(::DurableJStyle2301HistoryCursorStore)
    }

    override fun ingest(data: ByteArray, from: String): List<RingDecodedEvent> {
        val receivedAt = now()
        // The engine asks for the ring's clock (0x41) just before it sets it (0x01), so this
        // read-back measures the clock every record already in the archive was stamped with.
        JStyle2301Protocol.deviceTime(data, zoneId)?.let { ringTime ->
            val offset = clock().recordReadBack(ringTime, receivedAt)
            if (RingClockOffset.isSignificant(offset)) {
                Log.w("JStyle2301", "ring clock off by ${offset / 1000} s; correcting history")
                PulseEventBus.publishBlocking(
                    PulseEvent.SyncProgress("Ring clock was ${offset / 1000} s off; set and corrected")
                )
            }
        }
        val decoded = decoder.decode(data).map { correctTimestamp(it, receivedAt) }
        // Record extents before the packet itself, which may end the stream (GA.8 coverage).
        data.firstOrNull()?.let { opcode ->
            historySync.noteRecords(opcode.toInt() and 0xFF, decoded.mapNotNull(::recordExtent))
        }
        historySync.notePacket(data)
        val orderedProgress = historySync.takePacketProgress().mapNotNull { event ->
            when (event) {
                is PulseEvent.SyncProgress ->
                    if (event.stage == "done") RingDecodedEvent.HistorySyncFinished
                    else RingDecodedEvent.HistorySyncProgress(event.stage)
                is PulseEvent.HistoryCoverage -> RingDecodedEvent.HistoryCoverage(
                    event.stream, event.from, event.to, event.complete, event.reason,
                )
                else -> null
            }
        }
        // Progress follows the packet's own measurements in this returned list, so the shared bus
        // cannot run end-of-sync analytics before the terminal payload has been persisted.
        return decoded + orderedProgress
    }

    override fun configureConnectionSecret(secret: String?) {
        connectionSecret = secret?.takeIf { it.isNotEmpty() }
    }

    override fun redactOutboundForStorage(frame: ByteArray): ByteArray =
        if (frame.firstOrNull()?.toInt()?.and(0xFF) == JStyle2301Protocol.AUTHENTICATE) {
            JStyle2301Protocol.redactedAuthenticationRequest()
        } else {
            frame.copyOf()
        }

    /**
     * Every ring-stamped history record gets the same treatment: shifted by the persisted offset
     * of the clock that stamped it ([RingClockCorrector.offsetAt]), never clamped (the stamp is
     * the record's key), and carrying its raw stamp so the store can drop the copy an older
     * version kept under it. Live readings are phone-stamped; the 0x51 day totals are date-stamped
     * ([JStyle2301Decoder.DAY_TOTAL_KEYS]), so neither moves. 2.7.3 shifted the day totals too and
     * filed each one under 23:53 of the previous day.
     */
    @Suppress("UNUSED_PARAMETER")
    private fun correctTimestamp(event: RingDecodedEvent, receivedAt: Instant): RingDecodedEvent {
        fun shift(at: Instant): Long = clock().offsetAt(at)
        return when (event) {
            is RingDecodedEvent.HistoryMeasurement -> shift(event._timestamp).let { s ->
                if (s == 0L) event else event.copy(_timestamp = event._timestamp.minusMillis(s), rawTimestamp = event._timestamp)
            }
            is RingDecodedEvent.VendorMetric ->
                if (!event.isHistory || event.key in JStyle2301Decoder.DAY_TOTAL_KEYS) event
                else shift(event._timestamp).let { s ->
                    if (s == 0L) event else event.copy(_timestamp = event._timestamp.minusMillis(s), rawTimestamp = event._timestamp)
                }
            is RingDecodedEvent.ActivityBucket -> shift(event._timestamp).let { s ->
                if (s == 0L) event else event.copy(_timestamp = event._timestamp.minusMillis(s), rawTimestamp = event._timestamp)
            }
            is RingDecodedEvent.SleepTimeline -> shift(event._timestamp).let { s ->
                if (s == 0L) event else event.copy(_timestamp = event._timestamp.minusMillis(s), rawTimestamp = event._timestamp)
            }
            else -> event
        }
    }

    /** The (corrected) time span one decoded history record covers, `[start, end)`. */
    private fun recordExtent(event: RingDecodedEvent): Pair<Instant, Instant>? = when (event) {
        is RingDecodedEvent.ActivityBucket ->
            event._timestamp to event._timestamp.plusSeconds((event.durationS ?: 60).toLong())
        is RingDecodedEvent.SleepTimeline ->
            event._timestamp to event._timestamp.plusSeconds(event.stages.size * 60L)
        is RingDecodedEvent.HistoryMeasurement -> event._timestamp to event._timestamp
        is RingDecodedEvent.ActivityUpdate ->
            event._timestamp to event._timestamp.atZone(zoneId).plusDays(1).toInstant()
        is RingDecodedEvent.VendorMetric ->
            if (event.isHistory && event.key !in JStyle2301Decoder.DAY_TOTAL_KEYS) event._timestamp to event._timestamp
            else null
        else -> null
    }

    override fun makeSyncEngine(): RingSyncEngine =
        (syncEngine ?: JStyle2301SyncEngine(
            writer, historySync, connectionSecret,
            localNow = { LocalDateTime.ofInstant(now(), zoneId) },
            mayReadSleep = mayReadSleep,
            mayReadSleepUnattended = mayReadSleepUnattended,
            firmwarePasscode = firmwarePasscode,
        ).also { syncEngine = it })

    override fun connectionDidEnd() {
        historySync.cancel()
        syncEngine?.connectionDidEnd()
    }
}

/**
 * Where one stream's history pulls have reached (GA.8). All times are corrected record times.
 *
 * [newestStart] is the overlap marker: a later incremental pull stops paging once it receives a
 * record that starts at or before it. [contiguousFrom]..[newestEnd] is the span every pull so far
 * has proven gap-free. [historyDrained] says a pull has reached the end of the ring's history (or
 * the deepest budget, [JStyle2301HistorySync.maxDeepPages]); until then each sync spends one
 * deeper pull ([nextDeepPages]) on the first such stream.
 */
data class JStyle2301HistoryCursor(
    val newestStart: Instant?,
    val newestEnd: Instant?,
    val contiguousFrom: Instant?,
    val historyDrained: Boolean,
    val nextDeepPages: Int,
)

/**
 * Persistence for [JStyle2301HistoryCursor]. [PROCESS] lives as long as the app process; it is the
 * fallback for a driver nobody gave a durable store (tests, previews). In the app the cursor
 * survives restarts: `RingBLEClient.installDriver` hands every driver a per-ring
 * [RingHistoryCursorStore] in SharedPreferences, which [DurableJStyle2301HistoryCursorStore] wraps.
 * Without that, a restart forgot every drained stream and re-spent the deep pulls from scratch.
 */
interface JStyle2301HistoryCursorStore {
    fun load(stream: JStyle2301HistoryStream): JStyle2301HistoryCursor?
    fun save(stream: JStyle2301HistoryStream, cursor: JStyle2301HistoryCursor)

    companion object {
        val PROCESS: JStyle2301HistoryCursorStore = InMemoryJStyle2301HistoryCursorStore()
    }
}

class InMemoryJStyle2301HistoryCursorStore : JStyle2301HistoryCursorStore {
    private val cursors = java.util.concurrent.ConcurrentHashMap<JStyle2301HistoryStream, JStyle2301HistoryCursor>()
    override fun load(stream: JStyle2301HistoryStream): JStyle2301HistoryCursor? = cursors[stream]
    override fun save(stream: JStyle2301HistoryStream, cursor: JStyle2301HistoryCursor) { cursors[stream] = cursor }
}

/** Reads and writes [durable] once it is set, [fallback] until then. */
internal class SwitchableJStyle2301HistoryCursorStore(
    private val fallback: JStyle2301HistoryCursorStore,
) : JStyle2301HistoryCursorStore {
    @Volatile var durable: JStyle2301HistoryCursorStore? = null
    private fun target() = durable ?: fallback
    override fun load(stream: JStyle2301HistoryStream): JStyle2301HistoryCursor? = target().load(stream)
    override fun save(stream: JStyle2301HistoryStream, cursor: JStyle2301HistoryCursor) = target().save(stream, cursor)
}

/**
 * [JStyle2301HistoryCursor] over a string store: one value per stream, keyed by
 * [JStyle2301HistoryStream.key]. Format `v1|newestStart|newestEnd|contiguousFrom|drained|nextDeep`,
 * instants as epoch ms, an absent instant as an empty field. A value that does not parse reads as no
 * cursor, which only costs one deep pull.
 */
class DurableJStyle2301HistoryCursorStore(private val store: RingHistoryCursorStore) : JStyle2301HistoryCursorStore {
    override fun load(stream: JStyle2301HistoryStream): JStyle2301HistoryCursor? = decode(store.read(stream.key))
    override fun save(stream: JStyle2301HistoryStream, cursor: JStyle2301HistoryCursor) = store.write(stream.key, encode(cursor))

    companion object {
        private const val VERSION = "v1"

        fun encode(c: JStyle2301HistoryCursor): String = listOf(
            VERSION,
            c.newestStart?.toEpochMilli()?.toString().orEmpty(),
            c.newestEnd?.toEpochMilli()?.toString().orEmpty(),
            c.contiguousFrom?.toEpochMilli()?.toString().orEmpty(),
            if (c.historyDrained) "1" else "0",
            c.nextDeepPages.toString(),
        ).joinToString("|")

        fun decode(value: String?): JStyle2301HistoryCursor? {
            val parts = value?.split('|') ?: return null
            if (parts.size != 6 || parts[0] != VERSION) return null
            fun instant(field: String): Result<Instant?> =
                if (field.isEmpty()) Result.success(null)
                else field.toLongOrNull()?.let { Result.success(Instant.ofEpochMilli(it)) } ?: Result.failure(IllegalArgumentException())
            val newestStart = instant(parts[1]).getOrElse { return null }
            val newestEnd = instant(parts[2]).getOrElse { return null }
            val contiguousFrom = instant(parts[3]).getOrElse { return null }
            val drained = when (parts[4]) { "1" -> true; "0" -> false; else -> return null }
            val nextDeep = parts[5].toIntOrNull()?.takeIf { it > 0 } ?: return null
            return JStyle2301HistoryCursor(newestStart, newestEnd, contiguousFrom, drained, nextDeep)
        }
    }
}

/**
 * Sequential pager for the 2301 history protocol. A request returns at most 50 notifications;
 * mode 2 continues from the device cursor. Some streams finish with an explicit `opcode FF`, while
 * others simply go quiet below 50, so both terminal and time-settled completion are supported.
 *
 * **Detail completeness (SPEC GA.8).** Mode 0 always restarts at the newest record, so one page
 * per sync leaves holes whenever more than a page arrived since the last link. With a
 * [cursorStore] each stream keeps a [JStyle2301HistoryCursor]:
 * - a drained stream pages on (up to [catchUpPages]) until it reaches its previous newest record;
 * - one undrained stream per run gets a deep pull of [JStyle2301HistoryCursor.nextDeepPages]
 *   (doubling to [maxDeepPages] when bounded), queued last so the shallow streams land first;
 * - every other undrained stream gets the caller's page budget and waits for a later link.
 *
 * When a stream ends, a [PulseEvent.HistoryCoverage] states the gap-free span proven so far and
 * whether it is `complete` (the pull reached the end of history or the previous pull) or bounded.
 * Without a [cursorStore] the budgets are exactly the caller's, as before.
 */
class JStyle2301HistorySync(
    private val writer: RingCommandWriter?,
    private val settleMs: Long = 1_200,
    private val stallMs: Long = 4_000,
    private val maxPages: Int = 20,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val progressSink: ((PulseEvent) -> Unit)? = null,
    private val cursorStore: JStyle2301HistoryCursorStore? = null,
    /** First deep-pull budget for a stream with no drained history (P). */
    private val deepPages: Int = 20,
    /** Deep pulls double up to this; past it the stream is treated as drained as far as reachable (P). */
    val maxDeepPages: Int = 80,
    /** Budget for an incremental pull that stops at its overlap with the previous one (P). */
    private val catchUpPages: Int = 20,
) {
    companion object {
        private const val PACKETS_PER_PAGE = 50
        val catalog = listOf(
            JStyle2301HistoryStream.ACTIVITY_TOTAL,
            JStyle2301HistoryStream.ACTIVITY_DETAIL,
            JStyle2301HistoryStream.HEART_RATE,
            JStyle2301HistoryStream.WORKOUT_HEART_RATE,
            JStyle2301HistoryStream.HRV,
            JStyle2301HistoryStream.SLEEP,
            JStyle2301HistoryStream.SPO2,
            JStyle2301HistoryStream.TEMPERATURE,
        )
    }

    /** How a stream's pull ended; the coverage `reason`. */
    private enum class End(val wire: String) {
        DRAINED("drained"), OVERLAP("overlap"), BOUNDED("bounded"), INTERRUPTED("interrupted")
    }

    private data class Plan(val budget: Int, val stopAtOrBefore: Instant?, val deep: Boolean)

    private var queue = mutableListOf<JStyle2301HistoryStream>()
    private var plans = mapOf<JStyle2301HistoryStream, Plan>()
    private var current: JStyle2301HistoryStream? = null
    private var page = 0
    private var packetsOnPage = 0
    private var oldestSeen: Instant? = null
    private var newestStartSeen: Instant? = null
    private var newestEndSeen: Instant? = null
    private var overlapReached = false
    private var settleJob: Job? = null
    private var stallJob: Job? = null
    private val packetProgress = mutableListOf<PulseEvent>()

    @get:Synchronized
    val isRunning: Boolean get() = current != null

    @Synchronized
    fun start(
        streams: List<JStyle2301HistoryStream> = catalog,
        pageLimit: Int = maxPages,
        forceShallow: Boolean = false,
    ) {
        if (current != null) return
        val shallow = pageLimit.coerceIn(1, maxPages)
        var deepChosen = false
        plans = streams.distinct().associateWith { stream ->
            val store = cursorStore ?: return@associateWith Plan(shallow, null, deep = false)
            val cursor = store.load(stream)
            when {
                forceShallow -> Plan(shallow, cursor?.newestStart, deep = false)
                cursor != null && cursor.historyDrained ->
                    Plan(maxOf(shallow, catchUpPages).coerceAtMost(maxDeepPages), cursor.newestStart, deep = false)
                !deepChosen -> {
                    deepChosen = true
                    Plan((cursor?.nextDeepPages ?: deepPages).coerceIn(1, maxDeepPages), null, deep = true)
                }
                else -> Plan(shallow, cursor?.newestStart, deep = false)
            }
        }
        queue = plans.keys.sortedBy { if (plans.getValue(it).deep) 1 else 0 }.toMutableList()
        advanceLocked(orderedWithPacket = false)
    }

    @Synchronized
    fun cancel() {
        cancelTimersLocked()
        if (current != null) finishStreamLocked(End.INTERRUPTED, orderedWithPacket = false)
        queue.clear()
        current = null
        page = 0
        packetsOnPage = 0
        packetProgress.clear()
    }

    /**
     * The record spans `[start, end)` decoded from one inbound packet of [opcode], reported by the
     * driver before [notePacket] so a terminal packet's own records count.
     */
    @Synchronized
    fun noteRecords(opcode: Int, extents: List<Pair<Instant, Instant>>) {
        val stream = current ?: return
        if (stream.opcode != opcode || extents.isEmpty()) return
        val earliest = extents.minOf { it.first }
        val latestStart = extents.maxOf { it.first }
        val latestEnd = extents.maxOf { it.second }
        oldestSeen = oldestSeen?.let { minOf(it, earliest) } ?: earliest
        newestStartSeen = newestStartSeen?.let { maxOf(it, latestStart) } ?: latestStart
        newestEndSeen = newestEndSeen?.let { maxOf(it, latestEnd) } ?: latestEnd
        val marker = plans[stream]?.stopAtOrBefore
        if (marker != null && !earliest.isAfter(marker)) overlapReached = true
    }

    @Synchronized
    fun notePacket(packet: ByteArray) {
        val stream = current ?: return
        if (packet.isEmpty() || (packet[0].toInt() and 0xFF) != stream.opcode) return
        packetsOnPage++
        stallJob?.cancel(); stallJob = null

        if (JStyle2301Protocol.isTerminal(packet, stream)) {
            finishStreamLocked(End.DRAINED, orderedWithPacket = true)
            advanceLocked(orderedWithPacket = true)
            return
        }

        if (packetsOnPage >= PACKETS_PER_PAGE) {
            settleJob?.cancel(); settleJob = null
            page++
            val budget = plans[stream]?.budget ?: maxPages
            if (overlapReached) {
                finishStreamLocked(End.OVERLAP, orderedWithPacket = true)
                advanceLocked(orderedWithPacket = true)
                return
            }
            if (page >= budget) {
                publish(
                    PulseEvent.SyncProgress("${stream.label}: bounded at $budget pages"),
                    orderedWithPacket = true,
                )
                finishStreamLocked(End.BOUNDED, orderedWithPacket = true)
                advanceLocked(orderedWithPacket = true)
                return
            }
            packetsOnPage = 0
            writer?.enqueue(JStyle2301Protocol.historyRequest(stream, continuation = true))
            armStallLocked()
            return
        }
        armSettleLocked()
    }

    /** Progress caused by this exact inbound packet, drained by [JStyle2301Driver.ingest]. */
    @Synchronized
    fun takePacketProgress(): List<PulseEvent> = packetProgress.toList().also {
        packetProgress.clear()
    }

    /**
     * Close the current stream: publish what it proved and move its cursor. A quiet ring (settle
     * or a stall after a request) is the end of its history, as the vendor app treats it.
     */
    private fun finishStreamLocked(end: End, orderedWithPacket: Boolean) {
        val stream = current ?: return
        val plan = plans[stream]
        val old = cursorStore?.load(stream)
        val oldest = oldestSeen
        val newestEnd = newestEndSeen
        val from = when {
            oldest == null -> null
            overlapReached && old?.contiguousFrom != null -> minOf(old.contiguousFrom, oldest)
            else -> oldest
        }
        val ended = end
        if (from != null && newestEnd != null) {
            publish(
                PulseEvent.HistoryCoverage(
                    stream = stream.key,
                    from = from,
                    to = newestEnd,
                    complete = ended == End.DRAINED || ended == End.OVERLAP,
                    reason = ended.wire,
                ),
                orderedWithPacket,
            )
        }
        val store = cursorStore ?: return
        val newestStart = listOfNotNull(old?.newestStart, newestStartSeen).maxOrNull()
        val newestEndAll = listOfNotNull(old?.newestEnd, newestEnd).maxOrNull()
        val nextDeep = old?.nextDeepPages ?: deepPages
        val next = when (ended) {
            End.DRAINED -> JStyle2301HistoryCursor(newestStart, newestEndAll, from ?: old?.contiguousFrom, true, nextDeep)
            End.OVERLAP -> JStyle2301HistoryCursor(newestStart, newestEndAll, from, old?.historyDrained ?: false, nextDeep)
            End.BOUNDED, End.INTERRUPTED -> {
                if (from == null && old == null) return
                val budget = plan?.budget ?: maxPages
                val escalated = if (plan?.deep == true && ended == End.BOUNDED) (budget * 2).coerceAtMost(maxDeepPages) else nextDeep
                // A bounded deep pull at the deepest budget has gone as far back as one link can.
                val givenUp = plan?.deep == true && ended == End.BOUNDED && budget >= maxDeepPages
                JStyle2301HistoryCursor(
                    newestStart, newestEndAll,
                    contiguousFrom = from ?: old?.contiguousFrom,
                    // Not reaching the previous pull leaves a gap that only a deep pull can fill.
                    historyDrained = givenUp || (overlapReached && old?.historyDrained == true),
                    nextDeepPages = escalated,
                )
            }
        }
        store.save(stream, next)
    }

    private fun advanceLocked(orderedWithPacket: Boolean) {
        cancelTimersLocked()
        oldestSeen = null; newestStartSeen = null; newestEndSeen = null; overlapReached = false
        if (queue.isEmpty()) {
            current = null
            publish(PulseEvent.SyncProgress("done"), orderedWithPacket)
            return
        }
        current = queue.removeAt(0)
        page = 0
        packetsOnPage = 0
        val stream = current!!
        publish(PulseEvent.SyncProgress("Syncing ${stream.label}..."), orderedWithPacket)
        writer?.enqueue(JStyle2301Protocol.historyRequest(stream))
        armStallLocked()
    }

    private fun armSettleLocked() {
        settleJob?.cancel()
        settleJob = scope.launch {
            delay(settleMs)
            synchronized(this@JStyle2301HistorySync) {
                finishStreamLocked(End.DRAINED, orderedWithPacket = false)
                advanceLocked(orderedWithPacket = false)
            }
        }
    }

    private fun armStallLocked() {
        stallJob?.cancel()
        stallJob = scope.launch {
            delay(stallMs)
            synchronized(this@JStyle2301HistorySync) {
                finishStreamLocked(End.DRAINED, orderedWithPacket = false)
                advanceLocked(orderedWithPacket = false)
            }
        }
    }

    private fun cancelTimersLocked() {
        settleJob?.cancel(); settleJob = null
        stallJob?.cancel(); stallJob = null
    }

    private fun publish(event: PulseEvent, orderedWithPacket: Boolean) {
        if (progressSink != null) {
            progressSink.invoke(event)
        } else if (orderedWithPacket) {
            packetProgress += event
        } else {
            PulseEventBus.publishBlocking(event)
        }
    }

}

class JStyle2301SyncEngine(
    private val writer: RingCommandWriter?,
    private val historySync: JStyle2301HistorySync,
    private val connectionSecret: String? = null,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val localNow: () -> LocalDateTime = LocalDateTime::now,
    /** Whether this pass may read sleep: a read closes the ring's open sleep record ([RingSleepReadHold]). */
    private val mayReadSleep: () -> Boolean = { true },
    private val mayReadSleepUnattended: () -> Boolean = { true },
    private val firmwarePasscode: () -> ByteArray = JStyle2301Passcode::bytes,
) : RingSyncEngine {
    private data class HistoryRequest(
        val streams: List<JStyle2301HistoryStream>,
        val pageLimit: Int,
        val forceShallow: Boolean = false,
    )

    private var firmwareProfile = JStyle2301FirmwareProfile.UNKNOWN
    @Volatile private var authenticated = false
    @Volatile private var authenticationPending = false
    @Volatile private var authenticationFailed = false
    private var triedStoredPasscode = false
    private var triedBuiltInPasscode = false
    @Volatile private var pendingHistory: HistoryRequest? = null
    @Volatile private var pendingHeartRate = false
    @Volatile private var heartRateActive = false
    @Volatile private var realtimePreparationActive = false
    @Volatile private var pendingWorkoutMode: Int? = null
    @Volatile private var activeWorkoutMode: Int? = null
    private var heartRateStartJob: Job? = null
    /** The ring's clock has been read back and set on this connection. */
    @Volatile private var clockSynced = false

    /** Exposes the actual pager/authentication state to a cold-start WorkManager owner. */
    override val isHistorySyncRunning: Boolean
        get() = pendingHistory != null || authenticationPending || historySync.isRunning

    override val credentialAuthenticationFailed: Boolean get() = authenticationFailed

    override fun runStartup() {
        // The V0525 ring ends an Android GATT session after roughly three minutes. A
        // 20-page archive pull can spend most of that window on activity detail and disconnect
        // before SpO2/temperature or the terminal `done` event. Fetch the newest page of every
        // stream first: this completes comfortably inside one link, is idempotent, and is the
        // correct shape for unattended periodic sync. A resumable archive backfill can be exposed
        // as a separate operation later without making normal startup unreliable.
        // While the person is probably asleep the pass skips sleep, which would close the ring's
        // open record and cost the night its REM; the first pass after catches it up.
        val streams = if (mayReadSleepUnattended()) JStyle2301HistorySync.catalog
        else JStyle2301HistorySync.catalog - JStyle2301HistoryStream.SLEEP
        requestHistory(streams, pageLimit = 1, forceShallow = true)
    }

    override fun refresh() {
        // A person explicitly asking for Sync can recover a missed archive, using the
        // cursor's bounded/deep plan. Routine startup and foreground passes stay shallow.
        val streams = if (mayReadSleep()) JStyle2301HistorySync.catalog
        else JStyle2301HistorySync.catalog - JStyle2301HistoryStream.SLEEP
        requestHistory(streams, pageLimit = 1)
    }

    override fun refreshUnattendedBackfill() {
        val streams = if (mayReadSleepUnattended()) JStyle2301HistorySync.catalog
        else JStyle2301HistorySync.catalog - JStyle2301HistoryStream.SLEEP
        requestHistory(streams, pageLimit = 1)
    }

    override fun refreshForeground(): Boolean {
        if (isHistorySyncRunning || (firmwareProfile.requiresAuthentication && !authenticated)) return false
        val streams = if (mayReadSleepUnattended()) JStyle2301HistorySync.catalog
        else JStyle2301HistorySync.catalog - JStyle2301HistoryStream.SLEEP
        requestHistory(streams, pageLimit = 1, forceShallow = true)
        return true
    }

    override fun querySleep() {
        if (!mayReadSleep()) return
        requestHistory(listOf(JStyle2301HistoryStream.SLEEP), pageLimit = 4)
    }

    override fun syncSleepNow() = querySleep()

    override fun syncVitalsHistory() {
        requestHistory(
            listOf(
                JStyle2301HistoryStream.HEART_RATE,
                JStyle2301HistoryStream.WORKOUT_HEART_RATE,
                JStyle2301HistoryStream.HRV,
                JStyle2301HistoryStream.SPO2,
                JStyle2301HistoryStream.TEMPERATURE,
            ),
            pageLimit = 1,
        )
    }

    override fun handle(event: RingDecodedEvent) {
        when (event) {
            is RingDecodedEvent.FirmwareRevision -> handleFirmware(event.version)
            is RingDecodedEvent.AuthenticationResult -> handleAuthentication(event.accepted)
            else -> Unit
        }
    }

    private fun requestHistory(streams: List<JStyle2301HistoryStream>, pageLimit: Int, forceShallow: Boolean = false) {
        pendingHistory = HistoryRequest(streams, pageLimit, forceShallow)
        // Battery on every pass (0.6.4): the ring never pushes it, and asking only while the link
        // was not yet ready meant one read per connection — a ring that stays connected showed the
        // same percent for days (100 % for a week on the owner's V0789). The read is harmless and
        // self-contained, so it may go ahead of history on a ready link too.
        writer?.enqueue(JStyle2301Protocol.infoRequest(JStyle2301Protocol.INFO_BATTERY))
        if (historyReady()) {
            startPendingHistory()
            return
        }
        // V0789 must answer firmware before any history command is sent, because it ignores
        // history until opcode 0x3C succeeds.
        writer?.enqueue(JStyle2301Protocol.infoRequest(JStyle2301Protocol.INFO_FIRMWARE))
    }

    private fun handleFirmware(revision: String) {
        firmwareProfile = JStyle2301FirmwareProfile.forRevision(revision)
        if (!firmwareProfile.requiresAuthentication) {
            startPendingOperations()
            return
        }
        if (authenticated) {
            startPendingOperations()
            return
        }
        if (authenticationPending) return
        if (!startAuthenticationAttempt()) finishAuthenticationFailure()
    }

    /** Stored legacy override first, then the built-in firmware passcode at most once. */
    private fun startAuthenticationAttempt(): Boolean {
        val stored = connectionSecret
        if (!triedStoredPasscode && !stored.isNullOrEmpty()) {
            triedStoredPasscode = true
            val command = runCatching { JStyle2301Protocol.authenticationRequest(stored) }.getOrNull()
            if (command != null) {
                val sameAsBuiltIn = runCatching {
                    stored.toByteArray(Charsets.US_ASCII).contentEquals(firmwarePasscode())
                }.getOrDefault(false)
                if (sameAsBuiltIn) triedBuiltInPasscode = true
                sendAuthentication(command)
                return true
            }
        }
        if (!triedBuiltInPasscode) {
            triedBuiltInPasscode = true
            val command = runCatching { JStyle2301Protocol.authenticationRequest(firmwarePasscode()) }.getOrNull()
            if (command != null) {
                sendAuthentication(command)
                return true
            }
        }
        return false
    }

    private fun sendAuthentication(command: ByteArray) {
        authenticationPending = true
        authenticationFailed = false
        PulseEventBus.publishBlocking(PulseEvent.SyncProgress("Authenticating V0789 ring…"))
        writer?.enqueue(command)
    }

    private fun finishAuthenticationFailure() {
        authenticationFailed = true
        pendingHistory = null
        pendingHeartRate = false
        PulseEventBus.publishBlocking(PulseEvent.SyncProgress("Ring firmware authentication failed"))
    }

    private fun handleAuthentication(accepted: Boolean) {
        if (!authenticationPending) return
        authenticationPending = false
        authenticated = accepted
        if (accepted) {
            PulseEventBus.publishBlocking(PulseEvent.SyncProgress("V0789 ring authenticated"))
            startPendingOperations()
        } else {
            if (!startAuthenticationAttempt()) finishAuthenticationFailure()
        }
    }

    private fun historyReady(): Boolean =
        firmwareProfile != JStyle2301FirmwareProfile.UNKNOWN &&
            (!firmwareProfile.requiresAuthentication || authenticated)

    /**
     * Read the ring's clock back, then set it to the phone's local time — once per connection,
     * ahead of the first history request (the vendor SDK's `GetDeviceTime`/`SetDeviceTime`).
     * This driver used to send neither, so the ring ran on whatever clock it last had and every
     * history record came out minutes in the future. Gated like history, after V0789's 0x3C.
     */
    private fun syncClockIfNeeded() {
        if (clockSynced || !historyReady()) return
        clockSynced = true
        writer?.enqueue(JStyle2301Protocol.getTime())
        writer?.enqueue(JStyle2301Protocol.setTime(localNow()))
    }

    /** The daily re-set while connected; on a not-yet-ready link it runs before the next history. */
    override fun resyncTime() {
        clockSynced = false
        syncClockIfNeeded()
    }

    private fun startPendingHistory() {
        val request = pendingHistory ?: return
        syncClockIfNeeded()
        pendingHistory = null
        historySync.start(request.streams, request.pageLimit, request.forceShallow)
    }

    private fun startPendingOperations() {
        startPendingHistory()
        startPendingHeartRate()
        startPendingWorkout()
    }

    private fun requestProtectedOperation() {
        if (historyReady()) {
            startPendingHeartRate()
            startPendingWorkout()
            return
        }
        writer?.enqueue(JStyle2301Protocol.infoRequest(JStyle2301Protocol.INFO_FIRMWARE))
    }

    private fun startPendingHeartRate() {
        if (!pendingHeartRate || !historyReady()) return
        pendingHeartRate = false
        heartRateStartJob?.cancel()
        realtimePreparationActive = true
        writer?.enqueue(JStyle2301Protocol.prepareRealtimeMeasurement())
        heartRateStartJob = scope.launch {
            delay(500)
            heartRateActive = true
            writer?.enqueue(JStyle2301Protocol.heartRateMeasurement(start = true, seconds = 30))
        }
    }

    override fun startHeartRate() {
        if (pendingHeartRate || heartRateActive) return
        pendingHeartRate = true
        requestProtectedOperation()
    }

    override val spotHeartRateSeconds: Int = 32
    override val acceptsSingleSpotHeartRateResult: Boolean = true

    override fun startWorkoutHeartRate(activityType: String) {
        val mode = when (activityType.lowercase()) {
            "run" -> JStyle2301Protocol.SPORT_RUN
            "walk" -> JStyle2301Protocol.SPORT_WALK
            else -> return
        }
        if (activeWorkoutMode == mode || pendingWorkoutMode == mode) return
        pendingWorkoutMode = mode
        requestProtectedOperation()
    }

    override fun supportsWorkoutHeartRate(activityType: String): Boolean =
        activityType.lowercase() == "run" || activityType.lowercase() == "walk"

    private fun startPendingWorkout() {
        val mode = pendingWorkoutMode ?: return
        if (!historyReady()) return
        pendingWorkoutMode = null
        activeWorkoutMode = mode
        writer?.enqueue(JStyle2301Protocol.sportMode(mode, state = 1))
    }

    override fun stopWorkoutHeartRate() {
        val mode = activeWorkoutMode ?: pendingWorkoutMode
        pendingWorkoutMode = null
        activeWorkoutMode = null
        if (mode != null && historyReady()) writer?.enqueue(JStyle2301Protocol.sportMode(mode, state = 4))
    }

    override fun pauseWorkoutHeartRate() {
        activeWorkoutMode?.takeIf { historyReady() }?.let {
            writer?.enqueue(JStyle2301Protocol.sportMode(it, state = 2))
        }
    }

    override fun resumeWorkoutHeartRate() {
        activeWorkoutMode?.takeIf { historyReady() }?.let {
            writer?.enqueue(JStyle2301Protocol.sportMode(it, state = 3))
        }
    }

    override fun stopHeartRate() {
        pendingHeartRate = false
        heartRateStartJob?.cancel(); heartRateStartJob = null
        if (heartRateActive) {
            heartRateActive = false
            writer?.enqueue(JStyle2301Protocol.heartRateMeasurement(start = false, seconds = 30))
        }
        if (realtimePreparationActive) {
            realtimePreparationActive = false
            writer?.enqueue(JStyle2301Protocol.prepareRealtimeMeasurement(enable = false))
        }
    }

    internal fun connectionDidEnd() {
        heartRateStartJob?.cancel(); heartRateStartJob = null
        clockSynced = false
        pendingHeartRate = false
        heartRateActive = false
        realtimePreparationActive = false
        authenticated = false
        authenticationPending = false
        authenticationFailed = false
        triedStoredPasscode = false
        triedBuiltInPasscode = false
        pendingWorkoutMode = null
        activeWorkoutMode = null
    }
    override fun startSpO2() {}
    override fun stopSpO2() {}
    override fun findDevice() {}
    override fun setGoal(steps: Int) {}
    override fun powerOff() {}
    override fun factoryReset() {}
}
