package com.pulseloop.service

/** The periodic job borrows the process runtime; no role ever creates or destroys a client. */
object RingSyncWorkerRole {
    enum class Role { LIVE_PASS, CONNECT, SKIP }
    fun select(connected: Boolean, batteryLow: Boolean, userDisconnected: Boolean): Role = when {
        userDisconnected -> Role.SKIP
        batteryLow -> Role.SKIP
        connected -> Role.LIVE_PASS
        else -> Role.CONNECT
    }
    fun dispatch(role: Role, syncNow: () -> Unit, connectLastKnown: () -> Unit) {
        when (role) {
            Role.LIVE_PASS -> syncNow()
            Role.CONNECT -> connectLastKnown()
            Role.SKIP -> Unit
        }
    }
}
