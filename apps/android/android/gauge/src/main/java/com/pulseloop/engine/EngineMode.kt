package com.pulseloop.engine

import android.content.Context
import android.content.pm.PackageManager

/**
 * (Vitals 0.7.0) Which of Gauge's two apps is on this phone: the release build and the debug build the owner's phone
 * runs (`applicationIdSuffix = ".debug"`, so it installs beside the release).
 */
object GaugePresence {
    const val RELEASE = "com.pulseloop"
    const val DEBUG = "com.pulseloop.debug"
    val PACKAGES = listOf(RELEASE, DEBUG)

    /** The Gauge packages installed, release first. */
    fun installed(context: Context): List<String> {
        val pm = context.applicationContext.packageManager
        return PACKAGES.filter { pkg ->
            try {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(pkg, 0)
                true
            } catch (_: PackageManager.NameNotFoundException) {
                false
            } catch (_: Exception) {
                false
            }
        }
    }
}

/**
 * What the engine does with the ring, the phone's sensors and the upload.
 *
 * - [PASSIVE]: Gauge is installed. Gauge owns the ring, counts the steps and the short videos and uploads; the engine
 *   does none of it, so nothing is double counted and nothing fights over the ring.
 * - [NEEDS_TAKEOVER]: Gauge is gone but the person has not yet tapped "Take over". Still nothing runs.
 * - [ACTIVE]: Gauge is gone and the person tapped take over. The engine runs.
 *
 * A person who tapped take over while Gauge was still installed stays [PASSIVE] until Gauge goes, then becomes
 * [ACTIVE] with no second tap; Gauge installed again hands everything back to [PASSIVE].
 */
enum class EngineMode(val wire: String) {
    PASSIVE("passive"),
    NEEDS_TAKEOVER("needsTakeover"),
    ACTIVE("active"),
    ;

    companion object {
        fun of(gaugeInstalled: Boolean, tookOver: Boolean): EngineMode = when {
            gaugeInstalled -> PASSIVE
            tookOver -> ACTIVE
            else -> NEEDS_TAKEOVER
        }
    }
}
