package com.pulseloop.ring

import org.junit.Assert.*
import org.junit.Test

class ConnectionPriorityPolicyTest {
    @Test fun activeWorkWinsOverIdleAndReturnsThroughBalanced() {
        fun priority(sync: Boolean = false, leg: Boolean = false, workout: Boolean = false, idle: Long = 0) =
            ConnectionPriorityPolicy.priority(RingDeviceType.CRP, sync, leg, workout, idle)
        assertEquals(LinkPriority.HIGH, priority(sync = true, idle = 600_000))
        assertEquals(LinkPriority.HIGH, priority(leg = true, idle = 600_000))
        assertEquals(LinkPriority.HIGH, priority(workout = true, idle = 600_000))
        assertEquals(LinkPriority.BALANCED, priority(idle = 299_999))
        assertEquals(LinkPriority.LOW_POWER, priority(idle = 300_000))
    }
    @Test fun ycbtNeverRequestsParametersAndJringHasBalancedFloor() {
        assertEquals(LinkPriority.DEFAULT, ConnectionPriorityPolicy.priority(RingDeviceType.YCBT, true, true, true, 600_000))
        assertEquals(LinkPriority.DEFAULT, ConnectionPriorityPolicy.priority(RingDeviceType.YCBT, false, false, false, 600_000))
        assertEquals(LinkPriority.BALANCED, ConnectionPriorityPolicy.priority(RingDeviceType.JRING, false, false, false, 600_000))
        assertEquals(LinkPriority.HIGH, ConnectionPriorityPolicy.priority(RingDeviceType.JRING, true, false, false, 600_000))
    }
}
