package com.pulseloop.shortvideo

/** The "Capsule" setting: where today's brain and count appear while Reels/Shorts is open. */
enum class CapsuleMode(val label: String) {
    /** The system capsule (Android 16 Live Update) when the phone shows it, else the overlay. */
    AUTO("Auto"),
    SYSTEM_ONLY("System only"),
    OVERLAY_ONLY("Overlay only"),
}

/** What the phone can do right now. [promoted] is null until a posted notification was checked. */
data class CapsuleEnvironment(
    val sdkInt: Int,
    val notificationsAllowed: Boolean,
    val canPostPromoted: Boolean,
    val promoted: Boolean?,
) {
    /** Android 16 Live Updates exist and this app may post them. */
    val liveUpdatesPossible: Boolean get() = sdkInt >= 36 && notificationsAllowed && canPostPromoted
}

data class CapsuleDecision(val systemNotification: Boolean, val overlayPill: Boolean) {
    init { require(!(systemNotification && overlayPill)) { "Never both at once" } }
    companion object { val NONE = CapsuleDecision(false, false) }
}

/**
 * Picks exactly one surface (or none). The system capsule wins in Auto when Live Updates are
 * possible and the posted notification was not seen to lose its promotion; the overlay pill is the
 * fallback for phones without a capsule or when Live Updates are not allowed.
 */
object CapsulePolicy {
    fun decide(mode: CapsuleMode, env: CapsuleEnvironment): CapsuleDecision = when (mode) {
        CapsuleMode.OVERLAY_ONLY -> CapsuleDecision(systemNotification = false, overlayPill = true)
        CapsuleMode.SYSTEM_ONLY ->
            if (env.notificationsAllowed) CapsuleDecision(systemNotification = true, overlayPill = false) else CapsuleDecision.NONE
        CapsuleMode.AUTO ->
            if (env.liveUpdatesPossible && env.promoted != false) CapsuleDecision(systemNotification = true, overlayPill = false)
            else CapsuleDecision(systemNotification = false, overlayPill = true)
    }
}
