package com.pulseloop.ring

/** Firmware handshake material. Keep it inside the driver and out of UI, logs and diagnostics. */
internal object JStyle2301Passcode {
    private val value = byteArrayOf(0x30, 0x36, 0x32, 0x4a, 0x30, 0x55, 0x54, 0x38)

    fun bytes(): ByteArray = value.copyOf()
}
