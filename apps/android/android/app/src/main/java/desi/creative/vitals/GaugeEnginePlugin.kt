package desi.creative.vitals

import android.Manifest
import android.content.Intent
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.health.connect.client.HealthConnectClient
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.pulseloop.GaugeEngine
import com.pulseloop.PulseLoopRuntime
import com.pulseloop.command.RingSync
import com.pulseloop.data.PulseLoopDatabase
import com.pulseloop.engine.EngineMode
import com.pulseloop.engine.EngineState
import com.pulseloop.engine.EngineStateReader
import com.pulseloop.health.HealthConnectReadPermissions
import com.pulseloop.hub.HubSync
import com.pulseloop.ring.RingConnectionState
import com.pulseloop.ring.WearableCapability
import com.pulseloop.service.RingConnectionService
import com.pulseloop.service.RingSyncCoordinator
import com.pulseloop.shortvideo.ShortVideoSettings
import java.time.LocalDate
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/**
 * The `GaugeEngine` plugin (0.7.0; web side: src/platform/gaugeEngine.ts): Gauge's engine, which now lives in this app
 * (the `:gauge` module), for the web layer. It never grants anything itself: permissions are asked for with the
 * system's own dialogs, and the accessibility, App info, battery and uninstall screens are only opened for the owner.
 *
 * `getState()` and the `state` event carry [EngineState]'s wire shape. While the Gauge app is installed the engine is
 * `passive` (it neither holds the ring, counts steps or short videos, nor uploads); once Gauge is gone and `takeOver()`
 * was called it is `active`. The methods that act on the ring and the upload (`scanRings`, `connectRing`, `forgetRing`,
 * `syncNow`, `measure`) are refused with the code `passive` until then.
 */
@CapacitorPlugin(name = "GaugeEngine")
class GaugeEnginePlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val requestSeq = AtomicInteger()
    @Volatile private var lastEmitted: String? = null
    @Volatile private var gaugePending: Pair<Long, Int?>? = null
    private var accessibilityObserver: ContentObserver? = null

    private val app get() = context.applicationContext

    @OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
    override fun load() {
        val activeSignals = GaugeEngine.changes.onStart { emit(Unit) }.flatMapLatest {
            if (!GaugeEngine.isActive(app)) emptyFlow()
            else {
                val runtime = withContext(Dispatchers.Main.immediate) { PulseLoopRuntime.ensureRing(app) }
                val db = PulseLoopDatabase.getInstance(app)
                val hub = HubSync.store(app)
                val today = LocalDate.now().toString()
                merge(
                    runtime.bleClient.state.map {
                        listOf(it.connectionState, it.batteryPercent, it.lastError, it.firmwareVersion, it.credentialRejected, it.credentialAuthenticated)
                    }.distinctUntilChanged().map { },
                    hub.pairing.map { },
                    hub.status.map { },
                    db.hubOutboxDao().pendingCountFlow().map { },
                    db.deviceDao().currentFlow().map { },
                    ShortVideoSettings.get(app).prefs.map { },
                    db.shortVideoDao().rangeFlow(today, today).map { },
                )
            }
        }
        scope.launch { merge(GaugeEngine.changes, activeSignals).debounce(400).collect { emit() } }
        // Turning the short-video service on or off happens in the system's settings: the state follows it.
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) = GaugeEngine.notifyChanged()
        }
        accessibilityObserver = observer
        runCatching {
            app.contentResolver.registerContentObserver(
                Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES), false, observer,
            )
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        // Gauge may have come or gone, a permission may have changed in the system's settings
        GaugeEngine.reconcile(app)
        GaugeEngine.notifyChanged()
    }

    override fun handleOnDestroy() {
        // This Bridge's observers/calls must not retain a destroyed Activity. The ring runtime is process-owned.
        scope.cancel()
        accessibilityObserver?.let { runCatching { app.contentResolver.unregisterContentObserver(it) } }
        accessibilityObserver = null
        super.handleOnDestroy()
    }

    // ---- state ----

    /** Gauge's own upload queue, asked of the installed Gauge (a binder call), at most every 15 seconds. */
    private fun pendingOfGauge(): Int? {
        val now = System.currentTimeMillis()
        gaugePending?.let { (at, value) -> if (now - at < 15_000) return value }
        val json = GaugeProviderClient.call(app, GaugeLocalData.METHOD_SNAPSHOT).json
        val pending = json?.let { runCatching { JSONObject(it).getJSONObject("upload").getInt("pending") }.getOrNull() }
        gaugePending = now to pending
        return pending
    }

    private suspend fun state(): EngineState {
        val pending = if (GaugeEngine.gaugeInstalled(app)) withContext(Dispatchers.IO) { pendingOfGauge() } else null
        return withContext(Dispatchers.Main.immediate) { EngineStateReader.read(app, pending) }
    }

    private suspend fun stateJs(): JSObject = JSObject(state().toJson().toString())

    private suspend fun emit() {
        val js = runCatching { stateJs() }.getOrNull() ?: return
        val text = js.toString()
        if (text == lastEmitted) return
        lastEmitted = text
        notifyListeners("state", js)
    }

    /** Runs [block] off the plugin thread; whatever it throws rejects the call. */
    private fun go(call: PluginCall, block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
            } catch (e: IllegalArgumentException) {
                call.reject(e.message ?: "invalid", "invalid")
            } catch (e: Exception) {
                call.reject(e.message ?: "failed", "failed")
            }
        }
    }

    private suspend fun resolveState(call: PluginCall) = call.resolve(stateJs())

    /** The ring and upload methods only work once the engine is on; otherwise the call is rejected as `passive`. */
    private fun requireActive(call: PluginCall): Boolean {
        if (GaugeEngine.isActive(app)) return true
        val why = when (GaugeEngine.mode(app)) {
            EngineMode.PASSIVE -> "The old ring app is still installed, so it keeps the ring."
            else -> "Vitals has not taken over from the old ring app yet."
        }
        call.reject(why, "passive")
        return false
    }

    private suspend fun ring() = withContext(Dispatchers.Main.immediate) { PulseLoopRuntime.ensureRing(app) }

    @PluginMethod
    fun getState(call: PluginCall) = go(call) { resolveState(call) }

    // ---- identity and handover ----

    @PluginMethod
    fun configure(call: PluginCall) = go(call) {
        val url = call.getString("serverUrl")
        val token = call.getString("deviceToken")
        if (url == null || token == null) throw IllegalArgumentException("serverUrl and deviceToken are required")
        GaugeEngine.configure(app, url, token)
        call.resolve()
    }

    @PluginMethod
    fun uninstallGauge(call: PluginCall) {
        val intent = GaugeEngine.uninstallGaugeIntent(app)
        if (intent != null) {
            // the system's own uninstall dialog: the owner taps OK
            runCatching { (activity ?: context).startActivity(intent) }
                .onFailure { call.reject("Could not open the uninstall screen.", "failed"); return }
        }
        call.resolve()
    }

    @PluginMethod
    fun takeOver(call: PluginCall) = go(call) {
        val mode = GaugeEngine.takeOver(app)
        if (mode == EngineMode.ACTIVE) GaugeEngine.maybeFindRing(app)
        resolveState(call)
    }

    // ---- permissions and settings screens ----

    @PluginMethod
    override fun requestPermissions(call: PluginCall) { go(call) { requestWhich(call) } }

    private suspend fun requestWhich(call: PluginCall) {
        val which = mutableListOf<String>()
        call.getArray("which")?.let { arr -> for (i in 0 until arr.length()) arr.optString(i)?.let(which::add) }
        val unknown = which.filter { it !in KNOWN_PERMS }
        if (unknown.isNotEmpty()) throw IllegalArgumentException("unknown permission: ${unknown.first()}")
        val runtime = buildList {
            if ("bluetooth" in which) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    add(Manifest.permission.BLUETOOTH_SCAN); add(Manifest.permission.BLUETOOTH_CONNECT)
                } else add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
            if ("activityRecognition" in which && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) add(Manifest.permission.ACTIVITY_RECOGNITION)
            if ("notifications" in which && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filterNot { EngineStateReader.has(app, it) }
        if (runtime.isNotEmpty()) {
            awaitResult(ActivityResultContracts.RequestMultiplePermissions(), runtime.toTypedArray())
        }
        if ("healthConnect" in which && HealthConnectClient.getSdkStatus(app) == HealthConnectClient.SDK_AVAILABLE) {
            // Health Connect's own permission sheet; the grants are this app's, none carry over from Gauge
            awaitResult(HealthConnectReadPermissions.requestContract(), HealthConnectReadPermissions.all)
        }
        afterPermissions()
        resolveState(call)
    }

    private fun afterPermissions() {
        GaugeEngine.notifyChanged()
        if (!GaugeEngine.isActive(app)) return
        if (EngineStateReader.activityRecognition(app) == com.pulseloop.engine.Perm.GRANTED) RingConnectionService.onActivityRecognitionGranted(app)
        PulseLoopRuntime.onForeground(app)
        GaugeEngine.maybeFindRing(app)
    }

    /** Launches a system permission dialog and waits for the owner's answer (null when there is no activity to show it). */
    private suspend fun <I, O> awaitResult(contract: ActivityResultContract<I, O>, input: I): O? {
        val act = activity ?: return null
        val done = CompletableDeferred<O?>()
        act.runOnUiThread {
            var launcher: ActivityResultLauncher<I>? = null
            launcher = act.activityResultRegistry.register("vitals-engine-${requestSeq.incrementAndGet()}", contract) { result ->
                launcher?.unregister()
                done.complete(result)
            }
            try {
                launcher.launch(input)
            } catch (_: Exception) {
                launcher.unregister()
                done.complete(null)
            }
        }
        return done.await()
    }

    @PluginMethod
    fun openAccessibilitySettings(call: PluginCall) {
        openScreen(call, EngineScreens.accessibility())
    }

    /**
     * (r071) Vitals' own App info page, where Android 13+ keeps "Allow restricted settings" (⋮ menu) for an app that came
     * onto the phone as a file. The owner allows it there themselves; nothing is allowed from here.
     */
    @PluginMethod
    fun openAppInfo(call: PluginCall) {
        openScreen(call, EngineScreens.appInfo(app.packageName))
    }

    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        val pm = app.getSystemService(PowerManager::class.java)
        val intent = if (pm?.isIgnoringBatteryOptimizations(app.packageName) == true) {
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        } else {
            // the system's own "let this app run in the background" question
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${app.packageName}"))
        }
        openScreen(call, intent, EngineScreens.appInfo(app.packageName))
    }

    private fun openScreen(call: PluginCall, vararg intents: Intent) {
        for (intent in intents) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (runCatching { (activity ?: context).startActivity(intent) }.isSuccess) {
                call.resolve()
                return
            }
        }
        call.reject("Could not open the settings screen.", "failed")
    }

    // ---- the ring ----

    @PluginMethod
    fun scanRings(call: PluginCall) = go(call) {
        if (!requireActive(call)) return@go
        val client = ring().bleClient
        if (!client.hasPermissions()) {
            call.reject("Bluetooth permission is needed to look for rings.", "permission")
            return@go
        }
        if (client.state.value.connectionState == RingConnectionState.CONNECTED) {
            call.reject("A ring is connected: forget it first to look for another.", "connected")
            return@go
        }
        withContext(Dispatchers.Main.immediate) { client.startScanning() }
        if (client.state.value.connectionState != RingConnectionState.SCANNING) {
            call.reject(client.state.value.lastError ?: "Could not scan.", "scan")
            return@go
        }
        delay(SCAN_MS)
        val found = client.state.value.discovered.filter { it.isLikelyRing }
        withContext(Dispatchers.Main.immediate) { client.stopScanning() }
        val devices = JSArray()
        found.forEach { devices.put(JSObject().put("name", it.name).put("address", it.id).put("rssi", it.rssi)) }
        call.resolve(JSObject().put("devices", devices))
    }

    @PluginMethod
    fun connectRing(call: PluginCall) = go(call) {
        if (!requireActive(call)) return@go
        val address = call.getString("address")?.uppercase()
        if (address == null || !ADDRESS.matches(address)) throw IllegalArgumentException("address must be a Bluetooth address")
        val client = ring().bleClient
        if (!client.hasPermissions()) {
            call.reject("Bluetooth permission is needed to connect a ring.", "permission")
            return@go
        }
        withContext(Dispatchers.Main.immediate) { client.connectTo(address) }
        // the link comes up on its own; the state event follows it
        withTimeoutOrNull(1_500) { client.state.first { it.connectionState == RingConnectionState.CONNECTING || it.connectionState == RingConnectionState.CONNECTED } }
        resolveState(call)
    }


    @PluginMethod
    fun forgetRing(call: PluginCall) = go(call) {
        if (!requireActive(call)) return@go
        val runtime = ring()
        val db = PulseLoopDatabase.getInstance(app)
        // not looked for again until the person connects a ring
        GaugeEngine.stopAutoFind(app)
        val done = CompletableDeferred<Unit>()
        withContext(Dispatchers.Main.immediate) {
            if (runtime.coordinator.isConnected) {
                runtime.coordinator.forgetRing { db.deviceDao().clear(); done.complete(Unit) }
            } else {
                scope.launch { runtime.bleClient.forgetAndWait(); db.deviceDao().clear(); done.complete(Unit) }
            }
        }
        withTimeoutOrNull(FORGET_MS) { done.await() }
        resolveState(call)
    }

    @PluginMethod
    fun syncNow(call: PluginCall) = go(call) {
        if (!requireActive(call)) return@go
        // the ring's history sync, as pull-to-refresh runs it, awaited to its end; then the queue goes to the server
        RingSync(app).sync { }
        HubSync.flushNow(app)
        resolveState(call)
    }

    @PluginMethod
    fun measure(call: PluginCall) = go(call) {
        if (!requireActive(call)) return@go
        val kind = call.getString("kind")
        if (kind == null || kind !in MEASURE_KINDS) throw IllegalArgumentException("kind must be hr, spo2, hrv, temp or stress")
        val c = ring().coordinator
        val caps = ring().bleClient.state.value.activeCapabilities
        val ready = c.isConnected && !c.workoutHRActive && c.hrState != RingSyncCoordinator.MeasureState.MEASURING
        // the ring's combined reading carries stress; no ring Gauge supports measures temperature on demand
        val supported = when (kind) {
            "hr" -> WearableCapability.MANUAL_HEART_RATE in caps
            "spo2" -> WearableCapability.MANUAL_SPO2 in caps
            "hrv" -> WearableCapability.MANUAL_HRV in caps
            "stress" -> WearableCapability.STRESS in caps
            else -> false
        }
        if (!ready || !supported) {
            call.resolve(JSObject().put("started", false))
            return@go
        }
        scope.launch(Dispatchers.Main.immediate) {
            runCatching {
                when (kind) {
                    "hr" -> c.measureHR()
                    "spo2" -> c.measureSpO2()
                    "hrv" -> c.measureHRV()
                    else -> c.measureCombined()
                }
            }
        }
        call.resolve(JSObject().put("started", true))
    }

    // ---- short videos ----

    @PluginMethod
    fun setShortVideoLimit(call: PluginCall) = go(call) {
        if (!call.data.has("dailyLimit")) throw IllegalArgumentException("dailyLimit is required (a number, or null to switch the limit off)")
        val limit = if (call.data.isNull("dailyLimit")) null else call.getInt("dailyLimit")
            ?: throw IllegalArgumentException("dailyLimit must be a number or null")
        ShortVideoSettings.get(app).update { p ->
            if (limit == null) p.copy(enabled = false)
            // Vitals showed what the counter reads before sending the owner to the accessibility switch
            else p.copy(enabled = true, dailyLimit = limit.coerceIn(ShortVideoSettings.LIMIT_RANGE), disclosureAccepted = true)
        }
        GaugeEngine.notifyChanged()
        resolveState(call)
    }

    private companion object {
        val KNOWN_PERMS = setOf("bluetooth", "healthConnect", "activityRecognition", "notifications")
        val MEASURE_KINDS = setOf("hr", "spo2", "hrv", "temp", "stress")
        val ADDRESS = Regex("^([0-9A-F]{2}:){5}[0-9A-F]{2}$")
        const val SCAN_MS = 8_000L
        const val FORGET_MS = 12_000L
    }
}
