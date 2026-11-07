package com.pulseloop.ring

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.junit.Assert.*
import org.junit.Test

class PulseEventDataFlowTest {
    @Test fun `data subscribers receive ordered non packet events while persistence sees all`() = runBlocking {
        val all = Channel<PulseEvent>(Channel.UNLIMITED)
        val data = Channel<PulseEvent>(Channel.UNLIMITED)
        val a = launch(start = CoroutineStart.UNDISPATCHED) { PulseEventBus.events.collect { all.send(it) } }
        val b = launch(start = CoroutineStart.UNDISPATCHED) { PulseEventBus.dataEvents.collect { data.send(it) } }
        try {
            val packet = PulseEvent.RawPacket(PacketDirection.INCOMING, byteArrayOf(1), RingDecodedEvent.Unknown(1u, byteArrayOf(1)))
            val events = listOf(PulseEvent.BatteryLevel(71), packet, PulseEvent.BatteryLevel(72))
            events.forEach { PulseEventBus.publish(it) }
            withTimeout(5000) {
                assertEquals(events, List(3) { all.receive() })
                assertEquals(listOf(events[0], events[2]), List(2) { data.receive() })
            }
            assertTrue(data.tryReceive().isFailure)
        } finally { a.cancelAndJoin(); b.cancelAndJoin() }
    }
}
