package com.pulseloop.service

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat

/**
 * Whether a recording may use GPS (0.6.3 S20). Gauge is headless, so a recording usually starts
 * from Vitals' command or the tile with no Gauge screen in front; the location grant is asked for
 * in the companion checklist, never in the middle of a start.
 *
 * A start that asks for GPS without it is not refused: the recording starts **without a route**
 * (the deliberate no-GPS fallback), and the outcome names why, so Vitals can say "recording
 * without GPS: allow precise location in Gauge" and the uploaded session carries the same reason
 * (`gps_unavailable`).
 */
object WorkoutGpsAccess {
    /** No location grant at all. */
    const val PERMISSION_MISSING = "gps_permission_missing"
    /** Android 12+ "approximate" only: fixes of ~2 km are no route, so it is treated as missing. */
    const val PRECISE_MISSING = "gps_precise_permission_missing"
    /** Location is switched off for the whole phone (quick settings). Gauge never changes it. */
    const val LOCATION_OFF = "gps_location_off"
    /**
     * Android refused location access from the workout's foreground service (a background start
     * may not use a while-in-use permission). Found only once the service starts, so it reaches
     * the session, not the start outcome.
     */
    const val BACKGROUND_BLOCKED = "gps_background_blocked"

    /** Why GPS can't be used, or null when it can. Pure, for tests. */
    fun blocker(fineGranted: Boolean, coarseGranted: Boolean, locationOn: Boolean): String? = when {
        !fineGranted && !coarseGranted -> PERMISSION_MISSING
        !fineGranted -> PRECISE_MISSING
        !locationOn -> LOCATION_OFF
        else -> null
    }

    fun preciseGranted(context: Context): Boolean = granted(context, Manifest.permission.ACCESS_FINE_LOCATION)

    fun approximateGranted(context: Context): Boolean = granted(context, Manifest.permission.ACCESS_COARSE_LOCATION)

    fun blocker(context: Context): String? = blocker(
        fineGranted = preciseGranted(context),
        coarseGranted = approximateGranted(context),
        locationOn = runCatching {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            lm == null || LocationManagerCompat.isLocationEnabled(lm)
        }.getOrDefault(true),
    )

    private fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
