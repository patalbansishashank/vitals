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
import com.pulseloop.hub.HubSettingsSource
import com.pulseloop.hub.HubSync
import com.pulseloop.ring.JStyle2301FirmwareProfile
import com.pulseloop.ring.RingBLEClient
import com.pulseloop.ring.RingConnectionState
import com.pulseloop.ring.RingDeviceType
import com.pulseloop.shortvideo.ShortVideoApp
import com.pulseloop.shortvideo.ShortVideoDaySummary
import com.pulseloop.shortvideo.ShortVideoPrefs
import com.pulseloop.shortvideo.ShortVideoRepository
import com.pulseloop.shortvideo.ShortVideoRuntime
import com.pulseloop.shortvideo.ShortVideoSettings
import com.pulseloop.social.SocialDaySummary
import com.pulseloop.social.SocialPrefs
import com.pulseloop.social.SocialSettings
import com.pulseloop.social.SocialUsageAccess
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * (Vitals 0.7.0) Reads the engine's state off the phone. While the engine is not [EngineMode.ACTIVE] it opens nothing
 * (no ring runtime, no database): the permissions are plain system checks and the rest is empty, so asking for the
 * state never wakes what must stay off.
 */
object EngineStateReader {
    fun iso(ms: Long?): String? = ms?.takeIf { it > 0 }?.let { Instant.ofEpochMilli(it).toString() }

    /**
     * Safe to call from any thread: the permission checks and the database are read off the main thread, and only the
     * ring runtime is taken on it (where it is made). [keptPermissions] is an answer the caller kept ([EnginePermissions]);
     * null asks the system now.
     */
    suspend fun read(
        context: Context,
        gaugePending: Int? = null,
        keptPermissions: EngineState.Permissions? = null,
        zone: ZoneId = ZoneId.systemDefault(),
    ): EngineState = withContext(Dispatchers.IO) {
        val app = context.applicationContext
        val mode = GaugeEngine.mode(app)
        val permissions = keptPermissions ?: permissions(app)
        val prefs = ShortVideoSettings.get(app).prefs.value
        val socialPrefs = SocialSettings.get(app).prefs.value
        val usageAccess = SocialUsageAccess.isGranted(app)
        if (mode != EngineMode.ACTIVE) {
            // Passive opens no database (the "opens nothing while off" rule), so today is empty; the targets, enabled
            // apps and the Usage-access grant still come through so the web can prompt before take-over.
            val today = Instant.ofEpochMilli(System.currentTimeMillis()).atZone(zone).toLocalDate()
            return@withContext EngineState(
                mode = mode,
                gaugeInstalled = GaugeEngine.gaugeInstalled(app),
                gaugePendingUploads = gaugePending,
                ring = EngineState.Ring(),
                permissions = permissions,
                upload = EngineState.Upload(),
                shortVideo = EngineState.ShortVideo(prefs.enabled, EngineState.limitOf(prefs.enabled, prefs.dailyLimit)),
                social = social(socialPrefs, usageAccess, SocialDaySummary.empty(today)),
            )
        }
        val db = PulseLoopDatabase.getInstance(app)
        val runtime = withContext(Dispatchers.Main.immediate) { PulseLoopRuntime.ensureRing(app) }
        active(
            db = db,
            link = runtime.bleClient.state.value,
            ringPasswordSet = { runtime.apiKeyStore.ringPassword.isNotEmpty() },
            hub = HubSync.store(app),
            videoPrefs = prefs,
            socialPrefs = socialPrefs,
            usageAccess = usageAccess,
            permissions = permissions,
            now = System.currentTimeMillis(),
            zone = zone,
        )
    }

    /** The social-time part of the state: the grant, today's totals, the target band and the apps counted. */
    internal fun social(prefs: SocialPrefs, usageAccess: Boolean, today: SocialDaySummary): EngineState.Social =
        EngineState.Social(
            usageAccess = usageAccess,
            today = EngineState.Social.Day(today.date.toString(), today.totalSeconds, today.perApp),
            targetMinMinutes = prefs.targetMinMinutes,
            targetMaxMinutes = prefs.targetMaxMinutes,
            enabledApps = prefs.enabledKeys,
        )

    /**
     * The state while the engine runs the ring, from what it holds: [link] is the link to the ring now, [hub] the
     * upload's own record, and the rest is what [db] has stored, with the ring's count of the phone's today and the
     * newest heart rate. [ringPasswordSet] is only asked for a ring that does not sign in by itself.
     */
    internal suspend fun active(
        db: PulseLoopDatabase,
        link: RingBLEClient.BLEState,
        ringPasswordSet: () -> Boolean,
        hub: HubSettingsSource,
        videoPrefs: ShortVideoPrefs,
        socialPrefs: SocialPrefs,
        usageAccess: Boolean,
        permissions: EngineState.Permissions,
        now: Long,
        zone: ZoneId,
    ): EngineState {
        val device = db.deviceDao().currentReal()
        val credentialRequired = (link.activeDeviceType ?: device?.deviceType) == RingDeviceType.JSTYLE_2301 &&
            JStyle2301FirmwareProfile.forRevision(link.firmwareVersion ?: device?.firmwareVersion).requiresAuthentication
        val pairing = hub.pairing.value
        val status = hub.status.value
        val date = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val videos = runCatching {
            ShortVideoDaySummary.of(date, db.shortVideoDao().day(date.toString()), videoPrefs.dailyLimit)
        }.getOrNull()
        val socialToday = runCatching {
            SocialDaySummary.of(date, db.socialTimeDao().day(date.toString()))
        }.getOrNull() ?: SocialDaySummary.empty(date)
        return EngineState(
            mode = EngineMode.ACTIVE,
            gaugeInstalled = false,
            gaugePendingUploads = null,
            ring = EngineState.Ring(
                state = EngineState.ringState(link.connectionState, device != null),
                credentialConfigured = credentialRequired || ringPasswordSet(),
                credentialRequired = credentialRequired,
                credentialRejected = credentialRequired && link.credentialRejected,
                credentialAuthenticated = credentialRequired && link.connectionState == RingConnectionState.CONNECTED && link.credentialAuthenticated,
                name = device?.advertisedName ?: device?.name,
                address = device?.peripheralIdentifier ?: device?.bleAddressHint,
                battery = link.batteryPercent ?: device?.batteryPercent,
                lastSyncAt = iso(device?.lastFullSyncAt ?: device?.lastSyncAt),
                lastError = link.lastError,
            ),
            permissions = permissions,
            upload = EngineState.Upload(
                paired = pairing != null && !pairing.needsRepair,
                pending = if (pairing != null) db.hubOutboxDao().pendingCount() else 0,
                lastSentAt = iso(status.lastUploadAt),
                lastError = status.lastError?.takeIf { (status.lastErrorAt ?: 0) > (status.lastUploadAt ?: 0) },
            ),
            shortVideo = EngineState.ShortVideo(
                enabled = videoPrefs.enabled,
                dailyLimit = EngineState.limitOf(videoPrefs.enabled, videoPrefs.dailyLimit),
                instagram = videos?.count(ShortVideoApp.INSTAGRAM) ?: 0,
                youtube = videos?.count(ShortVideoApp.YOUTUBE) ?: 0,
            ),
            social = social(socialPrefs, usageAccess, socialToday),
            today = runCatching { EngineReadings.today(db, now, zone) }.getOrNull(),
            latestHr = runCatching { EngineReadings.latestHr(db) }.getOrNull(),
        )
    }

    /** Every permission as the system answers now (Health Connect, the package manager and the settings are asked). */
    suspend fun permissions(app: Context): EngineState.Permissions = permissions(app, healthConnect(app))

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

/**
 * The permission part of the state, kept between reads. Each answer asks Health Connect, the package manager and the
 * settings, and none of them changes while the person stays in the app, so the state built for every new ring reading
 * reuses the last answer. [invalidate] when one may have changed: the app came to the front, a permission dialog
 * closed, the engine's mode changed.
 */
class EnginePermissions(private val load: suspend () -> EngineState.Permissions) {
    private val epoch = AtomicInteger()
    @Volatile private var kept: Pair<Int, EngineState.Permissions>? = null

    fun invalidate() {
        epoch.incrementAndGet()
    }

    suspend fun get(): EngineState.Permissions {
        val asked = epoch.get()
        kept?.let { (at, value) -> if (at == asked) return value }
        // filed under the epoch it was asked in: an answer overtaken by [invalidate] is not served again
        return load().also { kept = asked to it }
    }
}
