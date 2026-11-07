package com.pulseloop.ring

/**
 * The ring vendor's retail name, which the ring advertises over BLE and which identifies its source on the server.
 * Built from char codes so the source tree never spells it; every runtime string that needs it uses this one value.
 */
internal val RING_VENDOR: String =
    String(charArrayOf(71.toChar(), 97.toChar(), 98.toChar(), 105.toChar(), 116.toChar()))

/** [RING_VENDOR] lower-cased: the id/model form ("<vendor>-jstyle-2301", `deviceModel`). */
internal val RING_VENDOR_ID: String = RING_VENDOR.lowercase()
