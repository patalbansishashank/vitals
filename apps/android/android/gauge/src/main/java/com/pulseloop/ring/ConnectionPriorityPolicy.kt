package com.pulseloop.ring

enum class LinkPriority { DEFAULT, HIGH, BALANCED, LOW_POWER }

object ConnectionPriorityPolicy {
    const val IDLE_LOW_POWER_MS = 300_000L
    val IDLE_PRIORITY = LinkPriority.LOW_POWER
    val JRING_IDLE_FLOOR = LinkPriority.BALANCED
    fun priority(family: RingDeviceType?, syncActive: Boolean, legActive: Boolean,
                 workoutActive: Boolean, idleMs: Long): LinkPriority = when {
        family == RingDeviceType.YCBT -> LinkPriority.DEFAULT
        syncActive || legActive || workoutActive -> LinkPriority.HIGH
        family == RingDeviceType.JRING -> JRING_IDLE_FLOOR
        idleMs >= IDLE_LOW_POWER_MS -> IDLE_PRIORITY
        else -> LinkPriority.BALANCED
    }
}
