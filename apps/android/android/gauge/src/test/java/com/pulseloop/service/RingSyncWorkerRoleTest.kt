package com.pulseloop.service

import org.junit.Assert.*
import org.junit.Test

class RingSyncWorkerRoleTest {
    @Test fun liveLinkUsesOnlySyncWhenBatteryHasHeadroom() {
        var sync = 0; var connect = 0
        val role = RingSyncWorkerRole.select(true, false, false)
        RingSyncWorkerRole.dispatch(role, { sync++ }, { connect++ })
        assertEquals(1, sync); assertEquals(0, connect)
        assertEquals(RingSyncWorkerRole.Role.SKIP, RingSyncWorkerRole.select(true, true, false))
    }
    @Test fun offlineFallbackConnectsUnlessBatteryOrUserBlocksIt() {
        var sync = 0; var connect = 0
        RingSyncWorkerRole.dispatch(RingSyncWorkerRole.select(false, false, false), { sync++ }, { connect++ })
        assertEquals(0, sync); assertEquals(1, connect)
        assertEquals(RingSyncWorkerRole.Role.SKIP, RingSyncWorkerRole.select(false, true, false))
        assertEquals(RingSyncWorkerRole.Role.SKIP, RingSyncWorkerRole.select(true, false, true))
    }
}
