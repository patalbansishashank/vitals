package com.pulseloop.engine

import org.json.JSONObject

/** One permission, as the web layer sees it (`Perm` in the plugin's contract). */
enum class Perm(val wire: String) { GRANTED("granted"), DENIED("denied"), PARTIAL("partial"), UNAVAILABLE("unavailable") }

/**
 * What `GaugeEngine.getState()` answers (Vitals' `EngineState`): the mode, whether Gauge is still on the phone, the
 * ring, the permissions the engine needs, the upload and the short-video counter. [toJson] is the wire shape, field for
 * field; everything absent is left out, never null.
 */
data class EngineState(
    val mode: EngineMode,
    val gaugeInstalled: Boolean,
    /** Gauge's own queue, asked of the Gauge app while it is installed; null when unknown. */
    val gaugePendingUploads: Int?,
    val ring: Ring,
    val permissions: Permissions,
    val upload: Upload,
    val shortVideo: ShortVideo,
) {
    enum class RingState(val wire: String) { NONE("none"), SCANNING("scanning"), CONNECTING("connecting"), CONNECTED("connected"), DISCONNECTED("disconnected") }

    data class Ring(
        val state: RingState = RingState.NONE,
        val name: String? = null,
        val address: String? = null,
        val battery: Int? = null,
        val lastSyncAt: String? = null,
        val lastError: String? = null,
        /** Presence only. The credential itself never crosses the bridge. */
        val credentialConfigured: Boolean = false,
        val credentialRequired: Boolean = false,
        val credentialRejected: Boolean = false,
        val credentialAuthenticated: Boolean = false,
    )

    data class Permissions(
        val bluetooth: Perm,
        val healthConnect: Perm,
        val activityRecognition: Perm,
        val notifications: Perm,
        val shortVideoAccessibility: Boolean,
        val batteryUnrestricted: Boolean,
        /**
         * (r071) Android holds the short-video counter back until it is allowed in App info ("restricted settings",
         * [RestrictedSettings]): true when it does or this install is the kind it holds back, false when it does not,
         * null when the phone does not say (and while the counter is on, when it no longer matters).
         */
        val shortVideoRestricted: Boolean? = null,
    )

    data class Upload(
        val paired: Boolean = false,
        val pending: Int = 0,
        val lastSentAt: String? = null,
        val lastError: String? = null,
    )

    data class ShortVideo(
        val enabled: Boolean = false,
        val dailyLimit: Int? = null,
        val instagram: Int = 0,
        val youtube: Int = 0,
    )

    fun toJson(): JSONObject {
        fun JSONObject.putIf(key: String, value: Any?) = apply { if (value != null) put(key, value) }
        return JSONObject()
            .put("mode", mode.wire)
            .put(
                "gauge",
                JSONObject().put("installed", gaugeInstalled).put("pendingUploads", gaugePendingUploads ?: JSONObject.NULL),
            )
            .put(
                "ring",
                JSONObject().put("state", ring.state.wire)
                    .put("credentialConfigured", ring.credentialConfigured)
                    .put("credentialRequired", ring.credentialRequired)
                    .put("credentialRejected", ring.credentialRejected)
                    .put("credentialAuthenticated", ring.credentialAuthenticated)
                    .putIf("name", ring.name).putIf("address", ring.address).putIf("battery", ring.battery)
                    .putIf("lastSyncAt", ring.lastSyncAt).putIf("lastError", ring.lastError),
            )
            .put(
                "permissions",
                JSONObject()
                    .put("bluetooth", permissions.bluetooth.wire)
                    .put("healthConnect", permissions.healthConnect.wire)
                    .put("activityRecognition", permissions.activityRecognition.wire)
                    .put("notifications", permissions.notifications.wire)
                    .put("shortVideoAccessibility", permissions.shortVideoAccessibility)
                    .putIf("shortVideoRestricted", permissions.shortVideoRestricted)
                    .put("batteryUnrestricted", permissions.batteryUnrestricted),
            )
            .put(
                "upload",
                JSONObject().put("paired", upload.paired).put("pending", upload.pending)
                    .putIf("lastSentAt", upload.lastSentAt).putIf("lastError", upload.lastError),
            )
            .put(
                "shortVideo",
                JSONObject().put("enabled", shortVideo.enabled)
                    .put("dailyLimit", shortVideo.dailyLimit ?: JSONObject.NULL)
                    .put("today", JSONObject().put("instagram", shortVideo.instagram).put("youtube", shortVideo.youtube)),
            )
    }

    companion object {
        /** `granted` when every permission is held, `denied` when none is, `partial` between. */
        fun perm(held: Collection<Boolean>): Perm = when {
            held.isEmpty() -> Perm.UNAVAILABLE
            held.all { it } -> Perm.GRANTED
            held.none { it } -> Perm.DENIED
            else -> Perm.PARTIAL
        }

        /** The ring's connection as the contract's five states; [known] is whether a ring has ever been connected. */
        fun ringState(state: com.pulseloop.ring.RingConnectionState, known: Boolean): RingState = when (state) {
            com.pulseloop.ring.RingConnectionState.SCANNING -> RingState.SCANNING
            com.pulseloop.ring.RingConnectionState.CONNECTING, com.pulseloop.ring.RingConnectionState.RECONNECTING -> RingState.CONNECTING
            com.pulseloop.ring.RingConnectionState.CONNECTED -> RingState.CONNECTED
            com.pulseloop.ring.RingConnectionState.DISCONNECTED, com.pulseloop.ring.RingConnectionState.FAILED -> RingState.DISCONNECTED
            com.pulseloop.ring.RingConnectionState.IDLE -> if (known) RingState.DISCONNECTED else RingState.NONE
        }

        /** The daily limit the web layer shows: the limit while the counter limits, null when it is switched off. */
        fun limitOf(enabled: Boolean, dailyLimit: Int): Int? = dailyLimit.takeIf { enabled }
    }
}
