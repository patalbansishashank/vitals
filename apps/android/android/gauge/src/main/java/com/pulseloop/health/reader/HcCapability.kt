package com.pulseloop.health.reader

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.PowerRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.SpeedRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import kotlin.reflect.KClass

/**
 * The Health Connect record types Gauge reads (energy SPEC §2.1 `hc/record`). Each is read only
 * while its own read permission is granted. [recordType] is the contract's `record_type`.
 *
 * Weight is included by DECISION D13's recommended default ("import Health Connect weight: yes,
 * device provenance, manual entries win"): Gauge uploads every weight record with its
 * `recording_method` and origin; the manual-beats-device rule is applied by the consumer (Vitals),
 * which owns the body-composition record.
 */
enum class HcType(val recordType: String, val recordClass: KClass<out Record>) {
    STEPS("Steps", StepsRecord::class),
    DISTANCE("Distance", DistanceRecord::class),
    SPEED("Speed", SpeedRecord::class),
    POWER("Power", PowerRecord::class),
    HEART_RATE("HeartRate", HeartRateRecord::class),
    EXERCISE_SESSION("ExerciseSession", ExerciseSessionRecord::class),
    ACTIVE_CALORIES("ActiveCaloriesBurned", ActiveCaloriesBurnedRecord::class),
    TOTAL_CALORIES("TotalCaloriesBurned", TotalCaloriesBurnedRecord::class),
    BASAL_METABOLIC_RATE("BasalMetabolicRate", BasalMetabolicRateRecord::class),
    WEIGHT("Weight", WeightRecord::class),
    RESTING_HEART_RATE("RestingHeartRate", RestingHeartRateRecord::class),
    SLEEP_SESSION("SleepSession", SleepSessionRecord::class),
    ;

    val readPermission: String get() = HealthPermission.getReadPermission(recordClass)

    companion object {
        fun of(recordType: String): HcType? = entries.firstOrNull { it.recordType == recordType }
    }
}

/** How Health Connect records reach Gauge (item S19 of the 0.6.3 audit). */
enum class HcReadPath {
    /** Nothing readable: no Health Connect, or no read grant. */
    NONE,
    /** The 15-minute worker reads in the background (and nothing else is needed). */
    BACKGROUND,
    /** Only ordinary reads are granted: Gauge reads only while it is open ([HcForegroundReader]). */
    FOREGROUND_ONLY,
}

/** Why the background worker cannot read. */
enum class HcBackgroundLimitation {
    /** This phone's Health Connect has no `READ_HEALTH_DATA_IN_BACKGROUND` feature. */
    UNSUPPORTED,
    /** The feature exists but the owner has not granted it. */
    NOT_GRANTED,
}

/**
 * What this phone lets the reader do right now (SPEC §GB.2 capability check): SDK availability,
 * `READ_HEALTH_DATA_IN_BACKGROUND`, `READ_HEALTH_DATA_HISTORY`, and the per-type read grants.
 *
 * The 15-minute worker is background, so it reads nothing without the background permission
 * ([canReadInBackground]). Ordinary read grants alone still allow reads while Gauge is in the
 * foreground ([canReadInForeground]): [HcForegroundReader] reconciles then, on open, on resume and
 * while the companion screen is visible ([readPath] `FOREGROUND_ONLY`). History depth follows DECISION D14's recommended default: one year where
 * the history permission is granted (P), else the 30 days the platform allows without it.
 */
data class HcCapability(
    val sdkAvailable: Boolean,
    val backgroundFeature: Boolean,
    val backgroundGranted: Boolean,
    val historyFeature: Boolean,
    val historyGranted: Boolean,
    val readable: List<HcType>,
) {
    val canReadInBackground: Boolean get() = sdkAvailable && backgroundFeature && backgroundGranted
    /** Health Connect serves ordinary reads to an app in the foreground with no extra permission. */
    val canReadInForeground: Boolean get() = sdkAvailable && readable.isNotEmpty()

    /** How records reach Gauge on this phone right now. */
    val readPath: HcReadPath get() = when {
        !sdkAvailable || readable.isEmpty() -> HcReadPath.NONE
        canReadInBackground -> HcReadPath.BACKGROUND
        else -> HcReadPath.FOREGROUND_ONLY
    }

    /** Why reads stop when Gauge leaves the foreground; null unless [readPath] is `FOREGROUND_ONLY`. */
    val backgroundLimitation: HcBackgroundLimitation? get() = when {
        readPath != HcReadPath.FOREGROUND_ONLY -> null
        !backgroundFeature -> HcBackgroundLimitation.UNSUPPORTED
        else -> HcBackgroundLimitation.NOT_GRANTED
    }
    val historyDays: Long get() = if (historyFeature && historyGranted) HISTORY_DAYS_WITH_PERMISSION else HISTORY_DAYS_DEFAULT

    companion object {
        /** D14: one year (P). */
        const val HISTORY_DAYS_WITH_PERMISSION = 365L
        /** What Health Connect itself allows without the history permission. */
        const val HISTORY_DAYS_DEFAULT = 30L

        val UNAVAILABLE = HcCapability(false, false, false, false, false, emptyList())

        fun from(sdkAvailable: Boolean, granted: Set<String>, backgroundFeature: Boolean, historyFeature: Boolean): HcCapability {
            if (!sdkAvailable) return UNAVAILABLE
            return HcCapability(
                sdkAvailable = true,
                backgroundFeature = backgroundFeature,
                backgroundGranted = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in granted,
                historyFeature = historyFeature,
                historyGranted = HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY in granted,
                readable = HcType.entries.filter { it.readPermission in granted },
            )
        }

        /** Never prompts: it only reads what is already granted. */
        suspend fun probe(context: Context): HcCapability {
            val app = context.applicationContext
            if (HealthConnectClient.getSdkStatus(app) != HealthConnectClient.SDK_AVAILABLE) return UNAVAILABLE
            val client = HealthConnectClient.getOrCreate(app)
            val granted = runCatching { client.permissionController.getGrantedPermissions() }.getOrDefault(emptySet())
            fun feature(f: Int) = runCatching {
                client.features.getFeatureStatus(f) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
            }.getOrDefault(false)
            return from(
                sdkAvailable = true,
                granted = granted,
                backgroundFeature = feature(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND),
                historyFeature = feature(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY),
            )
        }

        /** The legacy package name the platform writes its own device data under. */
        const val LEGACY_DEVICE_ORIGIN = "android"

        /**
         * Origins whose records are this phone's own sensors (`origin_is_device_native`, SPEC §2.1):
         * the legacy `android`, plus the platform's current device data source where the framework
         * exposes one (`getCurrentDeviceDataSource()`, looked up reflectively because the client
         * library does not wrap it; absent → legacy only).
         */
        fun nativeOrigins(context: Context): Set<String> = buildSet {
            add(LEGACY_DEVICE_ORIGIN)
            currentDeviceDataSource(context)?.let(::add)
        }

        private fun currentDeviceDataSource(context: Context): String? = runCatching {
            val managerClass = Class.forName("android.health.connect.HealthConnectManager")
            val manager = context.getSystemService(managerClass) ?: return null
            val method = managerClass.methods.firstOrNull { it.name == "getCurrentDeviceDataSource" && it.parameterCount == 0 }
                ?: return null
            when (val source = method.invoke(manager)) {
                is String -> source
                null -> null
                else -> source.javaClass.methods.firstOrNull { it.name == "getPackageName" && it.parameterCount == 0 }
                    ?.invoke(source) as? String
            }
        }.getOrNull()?.takeIf { it.isNotBlank() }
    }
}
