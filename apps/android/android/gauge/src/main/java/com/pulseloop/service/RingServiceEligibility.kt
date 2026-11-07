package com.pulseloop.service

import android.content.pm.ServiceInfo

/**
 * Who keeps the always-on [RingConnectionService] alive (Gauge 2.8.1, audit S18).
 *
 * The service hosts three things with different owners: the ring's BLE link, the phone step counter
 * and Vitals' command channel. Only the link depends on the ring:
 *
 * - **Link** ([link]): a paired real ring, keep-connected on, and no sticky user disconnect.
 * - **Phone** ([phone]): `ACTIVITY_RECOGNITION` granted and a step counter present — its own
 *   permission and nothing else. No ring needed; a user disconnect of the ring doesn't stop it.
 * - **Commands**: run inside the service whenever it runs (the loop itself waits for a pairing). With
 *   neither link nor phone eligible there is no honest foreground-service type to run under, so the
 *   15-minute [com.pulseloop.command.CommandPollWorker] carries them, as after a process death.
 *
 * The service runs when [Plan.runService]; it connects the ring only when [Plan.link].
 */
object RingServiceEligibility {
    /** Kept for callers that ask about the BLE link only (scan receiver, older call sites). */
    fun eligible(pairedRealRing: Boolean, keepConnected: Boolean, userDisconnected: Boolean): Boolean =
        link(pairedRealRing, keepConnected, userDisconnected)

    fun link(pairedRealRing: Boolean, keepConnected: Boolean, userDisconnected: Boolean): Boolean =
        pairedRealRing && keepConnected && !userDisconnected

    fun phone(activityRecognition: Boolean, hasStepCounter: Boolean): Boolean =
        activityRecognition && hasStepCounter

    data class Plan(val link: Boolean, val phone: Boolean) {
        val runService: Boolean get() = link || phone
        /** The command loop rides on the service; otherwise the poll worker serves it. */
        val commandsInService: Boolean get() = runService
    }

    fun plan(
        pairedRealRing: Boolean,
        keepConnected: Boolean,
        userDisconnected: Boolean,
        activityRecognition: Boolean,
        hasStepCounter: Boolean,
    ): Plan = Plan(
        link = link(pairedRealRing, keepConnected, userDisconnected),
        phone = phone(activityRecognition, hasStepCounter),
    )

    /**
     * The foreground-service types to promote with, or null when none may be used (the service must
     * not start). Android 14+ checks each type's runtime permission at `startForeground`:
     * `connectedDevice` needs a Bluetooth grant, `health` needs `ACTIVITY_RECOGNITION`. Below 14 the
     * check doesn't exist and the service has always run as `connectedDevice`.
     *
     * [link] false drops `connectedDevice` on 14+ so a phone-only service doesn't claim a ring link;
     * while the link is eligible but Bluetooth isn't granted, the phone alone can still run it.
     */
    fun foregroundTypes(sdk: Int, link: Boolean, bluetoothGranted: Boolean, activityRecognition: Boolean): Int? {
        if (sdk < 34) return ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        var types = 0
        if (link && bluetoothGranted) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        if (activityRecognition) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
        return types.takeIf { it != 0 }
    }
}
