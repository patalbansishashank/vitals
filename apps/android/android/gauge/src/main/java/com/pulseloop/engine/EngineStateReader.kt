package com.pulseloop.engine

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.pulseloop.GaugeEngine
import com.pulseloop.PulseLoopRuntime
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.health.reader.HcCapability
import com.pulseloop.health.reader.HcType
import com.pulseloop.hub.HubSync
import com.pulseloop.ring.JStyle2301FirmwareProfile
import com.pulseloop.ring.RingDeviceType
import com.pulseloop.shortvideo.ShortVideoApp
import com.pulseloop.shortvideo.ShortVideoDaySummary
import com.pulseloop.shortvideo.ShortVideoRepository
import com.pulseloop.shortvideo.ShortVideoRuntime
import com.pulseloop.shortvideo.ShortVideoSettings
import java.time.Instant
import java.time.LocalDate

/**
 * (Vitals 0.7.0) Reads the engine's state off the phone. While the engine is not [EngineMode.ACTIVE] it opens nothing
 * (no ring runtime, no database): the permissions are plain system checks and the rest is empty, so asking for the
 * state never wakes what must stay off.
 */
object EngineStateReader {
    fun iso(ms: Long?): String? = ms?.takeIf { it > 0 }?.let { Instant.ofEpochMilli(it).toString() }

    suspend fun read(context: Context, gaugePending: Int? = null): EngineState {
        val app = context.applicationContext
        val mode = GaugeEngine.mode(app)
        val permissions = permissions(app, healthConnect(app))
        val prefs = ShortVideoSettings.get(app).prefs.value
        if (mode != EngineMode.ACTIVE) {
            return EngineState(
                mode = mode,
                gaugeInstalled = GaugeEngine.gaugeInstalled(app),
                gaugePendingUploads = gaugePending,
                ring = EngineState.Ring(),
                permissions = permissions,
                upload = EngineState.Upload(),
                shortVideo = EngineState.ShortVideo(prefs.enabled, EngineState.limitOf(prefs.enabled, prefs.dailyLimit)),
            )
        }
        val db = PulseLoopDatabase.getInstance(app)
        val runtime = PulseLoopRuntime.ensureRing(app)
        val client = runtime.bleClient
        val ble = client.state.value
        val device = db.deviceDao().currentReal()
        val credentialRequired = (ble.activeDeviceType ?: device?.deviceType) == RingDeviceType.JSTYLE_2301 &&
            JStyle2301FirmwareProfile.forRevision(ble.firmwareVersion ?: device?.firmwareVersion).requiresAuthentication
        val hub = HubSync.store(app)
        val pairing = hub.pairing.value
        val status = hub.status.value
        val today = runCatching {
            ShortVideoDaySummary.of(LocalDate.now(), db.shortVideoDao().day(LocalDate.now().toString()), prefs.dailyLimit)
        }.getOrNull()
        return EngineState(
            mode = mode,
            gaugeInstalled = false,
            gaugePendingUploads = null,
            ring = EngineState.Ring(
                state = EngineState.ringState(ble.connectionState, device != null),
                credentialConfigured = credentialRequired || runtime.apiKeyStore.ringPassword.isNotEmpty(),
                credentialRequired = credentialRequired,
                credentialRejected = credentialRequired && ble.credentialRejected,
                credentialAuthenticated = credentialRequired && ble.connectionState == com.pulseloop.ring.RingConnectionState.CONNECTED && ble.credentialAuthenticated,
                name = device?.advertisedName ?: device?.name,
                address = device?.peripheralIdentifier ?: device?.bleAddressHint,
                battery = ble.batteryPercent ?: device?.batteryPercent,
                lastSyncAt = iso(device?.lastFullSyncAt ?: device?.lastSyncAt),
                lastError = ble.lastError,
            ),
            permissions = permissions,
            upload = EngineState.Upload(
                paired = pairing != null && !pairing.needsRepair,
                pending = if (pairing != null) db.hubOutboxDao().pendingCount() else 0,
                lastSentAt = iso(status.lastUploadAt),
                lastError = status.lastError?.takeIf { (status.lastErrorAt ?: 0) > (status.lastUploadAt ?: 0) },
            ),
            shortVideo = EngineState.ShortVideo(
                enabled = prefs.enabled,
                dailyLimit = EngineState.limitOf(prefs.enabled, prefs.dailyLimit),
                instagram = today?.count(ShortVideoApp.INSTAGRAM) ?: 0,
                youtube = today?.count(ShortVideoApp.YOUTUBE) ?: 0,
            ),
        )
    }

    fun permissions(app: Context, healthConnect: Perm): EngineState.Permissions {
        val counterOn = ShortVideoRuntime.isServiceEnabled(app)
        return EngineState.Permissions(
            bluetooth = bluetooth(app),
            healthConnect = healthConnect,
            activityRecognition = activityRecognition(app),
            notifications = if (NotificationManagerCompat.from(app).areNotificationsEnabled()) Perm.GRANTED else Perm.DENIED,
            shortVideoAccessibility = counterOn,
            batteryUnrestricted = batteryUnrestricted(app),
            // (r071) only asked while the counter is off: once it is on, Android's hold no longer matters
            shortVideoRestricted = if (counterOn) null else RestrictedSettings.isRestricted(app),
        )
    }

    fun has(app: Context, permission: String) =
        ContextCompat.checkSelfPermission(app, permission) == PackageManager.PERMISSION_GRANTED

    fun bluetooth(app: Context): Perm {
        if (!app.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) return Perm.UNAVAILABLE
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            EngineState.perm(listOf(has(app, Manifest.permission.BLUETOOTH_SCAN), has(app, Manifest.permission.BLUETOOTH_CONNECT)))
        } else {
            // below Android 12 the scan needs the location grant (the Bluetooth permissions are install-time)
            EngineState.perm(listOf(has(app, Manifest.permission.ACCESS_FINE_LOCATION)))
        }
    }

    fun activityRecognition(app: Context): Perm =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) Perm.GRANTED
        else EngineState.perm(listOf(has(app, Manifest.permission.ACTIVITY_RECOGNITION)))

    fun batteryUnrestricted(app: Context): Boolean =
        app.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(app.packageName) == true

    /** The read permissions the Health Connect reader asks for, held or not. */
    val healthConnectReadPermissions: Set<String> get() = HcType.entries.map { it.readPermission }.toSet()

    suspend fun healthConnect(app: Context): Perm {
        val capability = runCatching { HcCapability.probe(app) }.getOrNull() ?: return Perm.UNAVAILABLE
        if (!capability.sdkAvailable) return Perm.UNAVAILABLE
        val readable = capability.readable.size
        return when {
            readable >= HcType.entries.size -> Perm.GRANTED
            readable == 0 -> Perm.DENIED
            else -> Perm.PARTIAL
        }
    }
}
