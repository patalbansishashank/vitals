package com.pulseloop.ring

/** Retry timing is independent of GATT and uses elapsed realtime in the adapter. */
class ReconnectBackoff {
    enum class Failure { TRANSIENT, NORMAL, WAIT_FOR_BLUETOOTH }
    var attempt: Int = 0
        private set
    var waitingForBluetooth: Boolean = false
        private set
    val atCeiling: Boolean get() = attempt >= DELAYS.size

    fun reset() { attempt = 0; waitingForBluetooth = false }

    fun nextDelay(status: Int = 0): Long? {
        val failure = classify(status)
        if (failure == Failure.WAIT_FOR_BLUETOOTH) {
            waitingForBluetooth = true
            return null
        }
        val delay = DELAYS[attempt.coerceAtMost(DELAYS.lastIndex)]
        attempt = (attempt + 1).coerceAtMost(DELAYS.size)
        // Give a transient stack error two quick recovery opportunities. Repeated transient
        // errors are still an unavailable link and must not bypass the unattended ceiling.
        return if (failure == Failure.TRANSIENT && attempt <= FAST_TRANSIENT_ATTEMPTS) DELAYS.first() else delay
    }

    companion object {
        private const val FAST_TRANSIENT_ATTEMPTS = 2
        val DELAYS = listOf(5_000L, 15_000L, 30_000L, 60_000L, 120_000L, 300_000L)
        fun classify(status: Int): Failure = when (status) {
            133, 22, 62 -> Failure.TRANSIENT
            257 -> Failure.WAIT_FOR_BLUETOOTH
            else -> Failure.NORMAL
        }
    }
}
