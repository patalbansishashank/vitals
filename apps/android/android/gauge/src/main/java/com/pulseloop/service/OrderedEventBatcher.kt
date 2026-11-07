package com.pulseloop.service

import com.pulseloop.ring.PulseEvent
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** One consumer owns ordering. Timeout is measured from the first event, never reset by traffic. */
internal object OrderedEventBatcher {
    const val MAX_EVENTS = 64
    const val MAX_WAIT_MS = 150L
    fun isControl(event: PulseEvent): Boolean = when (event) {
        is PulseEvent.DeviceStateChanged, is PulseEvent.SyncProgress, is PulseEvent.LiveSampleGate,
        is PulseEvent.DeviceForgotten, is PulseEvent.MeasurementComplete,
        // Cumulative activity totals and bucket rollups do not commute on a past day.
        is PulseEvent.ActivityUpdate -> true
        else -> false
    }

    suspend fun collect(events: Flow<PulseEvent>, nowNanos: () -> Long = System::nanoTime, flush: suspend (List<PulseEvent>) -> Unit) = coroutineScope {
        val incoming = Channel<PulseEvent>(MAX_EVENTS)
        val collector = launch(start = CoroutineStart.UNDISPATCHED) { try { events.collect { incoming.send(it) } } finally { incoming.close() } }
        try {
            while (true) {
                val first = incoming.receiveCatching().getOrNull() ?: break
                val batch = mutableListOf(first)
                val deadline = nowNanos() + MAX_WAIT_MS * 1_000_000
                while (batch.size < MAX_EVENTS && !isControl(batch.last())) {
                    val remaining = ((deadline - nowNanos()) / 1_000_000).coerceAtLeast(0)
                    val next = withTimeoutOrNull(remaining) { incoming.receiveCatching().getOrNull() } ?: break
                    batch += next
                }
                flush(batch)
            }
        } finally { collector.cancel(); incoming.cancel() }
    }
}
