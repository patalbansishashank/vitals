package com.pulseloop.shortvideo

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import androidx.core.content.ContextCompat
import java.time.LocalDate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Which surface is showing the brain right now, for the settings screen. */
enum class CapsuleSurface { NONE, SYSTEM, OVERLAY }

/** Live state the settings screen observes. */
object ShortVideoRuntime {
    internal val running = MutableStateFlow(false)
    internal val surface = MutableStateFlow(CapsuleSurface.NONE)
    internal val promoted = MutableStateFlow<Boolean?>(null)
    val serviceRunning: StateFlow<Boolean> = running.asStateFlow()
    val capsuleSurface: StateFlow<CapsuleSurface> = surface.asStateFlow()
    /** Whether the last posted Live Update was promoted by the system; null if never checked. */
    val lastPromoted: StateFlow<Boolean?> = promoted.asStateFlow()

    fun component(context: Context) = ComponentName(context, ShortVideoAccessibilityService::class.java)

    /** True when the user has switched Gauge's service on in Accessibility settings. */
    fun isServiceEnabled(context: Context): Boolean {
        val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?: return false
        val me = component(context)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    /** Show the island for a few seconds (settings → debug). Needs the service running. */
    fun previewIsland(): Boolean = ShortVideoAccessibilityService.instance?.previewIsland() ?: false

    /** Show the countdown in preview mode (never goes home). Needs the service running. */
    fun previewCountdown(): Boolean = ShortVideoAccessibilityService.instance?.previewCountdown() ?: false
}

/**
 * Watches Instagram and YouTube (and nothing else: the service's packageNames restrict it) to
 * count Reels and Shorts. The accessibility events are reduced to [FeedInput]s for
 * [ReelCounter]; [LimitController] decides on countdowns; the brain appears in exactly one
 * surface chosen by [CapsulePolicy] while a short-video screen is in front.
 */
class ShortVideoAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile internal var instance: ShortVideoAccessibilityService? = null
        private const val TICK_MS = 250L
        private const val WATCHDOG_MS = 1_000L
        private const val CLASSIFY_THROTTLE_MS = 250L
        private const val CLASSIFY_IN_SESSION_MS = 600L
        private const val PREVIEW_MS = 4_000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val writeLock = Mutex()
    private val classifier = ShortVideoScreenClassifier()
    private val counter = ReelCounter()
    private val limit = LimitController()

    private lateinit var settings: ShortVideoSettings
    private lateinit var repo: ShortVideoRepository
    private lateinit var island: IslandOverlay
    private lateinit var live: LiveCapsuleNotification
    private lateinit var countdown: CountdownOverlay

    private var prefs = ShortVideoPrefs()
    private var today: LocalDate = LocalDate.MIN
    private var todayTotal = 0
    private var todayCounts: Map<ShortVideoApp, Int> = emptyMap()
    private var countdownApp: ShortVideoApp? = null
    private var previewing = false
    private var promoted: Boolean? = null
    private var classifyPending = false
    private var lastClassifyAt = 0L
    private var lastWatchdogAt = 0L
    private var ticking = false
    private val lastSummary = mutableMapOf<ShortVideoApp, String>()

    private val screenOff = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            feedAll(counter.reset(now()))
            onLeftShortVideo()
        }
    }

    /** (Vitals 0.7.0) Whether the counter runs: only once Vitals has taken over from Gauge ([GaugeEngine]). */
    private var awake = false
    private var engineOn = false
    private var nextWakeCheck = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        // While Gauge is still installed its own counter counts: this one stays dormant (it never counts the same
        // videos twice) and looks again at most every half minute, as events arrive.
        engineOn = com.pulseloop.GaugeEngine.isActive(this)
        if (engineOn) wake()
    }

    private fun wake() {
        if (awake) return
        awake = true
        settings = ShortVideoSettings.get(this)
        repo = ShortVideoRepository.get(this)
        island = IslandOverlay(this)
        live = LiveCapsuleNotification(this)
        countdown = CountdownOverlay(this) { onCancelPressed() }
        ShortVideoDebugLog.load(this)
        ShortVideoRuntime.running.value = true
        ContextCompat.registerReceiver(this, screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED)
        scope.launch {
            settings.prefs.collect { next ->
                val wasEnabled = prefs.enabled
                prefs = next
                limit.config = next.limitConfig
                val active = counter.activeApp
                if ((!next.enabled && wasEnabled) || (active != null && !next.appEnabled(active))) {
                    feedAll(counter.reset(now()))
                    onLeftShortVideo()
                } else if (counter.activeApp != null) {
                    refreshCapsule()
                }
            }
        }
        scope.launch {
            val wall = System.currentTimeMillis()
            writeLock.withLock { refreshToday(wall); repo.queueRecent(wall) }
        }
        ShortVideoDebugLog.event(null, "service", "connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        // Looked at most every half minute: Gauge installed again hands the counting back to Gauge.
        val t = android.os.SystemClock.elapsedRealtime()
        if (t >= nextWakeCheck) {
            nextWakeCheck = t + 30_000L
            engineOn = com.pulseloop.GaugeEngine.isActive(this)
        }
        if (!engineOn) return
        if (!awake) wake()
        val app = ShortVideoApp.fromPackage(event.packageName) ?: return
        if (!prefs.appEnabled(app)) return
        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_SCROLLED -> onScroll(app, event)
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> scheduleClassify(0)
            // A playing reel changes content constantly (progress bar); inside a session the
            // tree is re-read less often, scrolls and the watchdog cover the rest.
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ->
                scheduleClassify(if (counter.inSession) CLASSIFY_IN_SESSION_MS else CLASSIFY_THROTTLE_MS)
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        instance = null
        ShortVideoRuntime.running.value = false
        ShortVideoRuntime.surface.value = CapsuleSurface.NONE
        runCatching { unregisterReceiver(screenOff) }
        handler.removeCallbacksAndMessages(null)
        if (::island.isInitialized) island.hide()
        if (::live.isInitialized) live.hide()
        if (::countdown.isInitialized) countdown.hide()
        scope.cancel()
        super.onDestroy()
    }

    // ---- input ----

    private fun onScroll(app: ShortVideoApp, event: AccessibilityEvent) {
        val source = event.source ?: return
        val matcher = ShortVideoMatchers.forApp(app)
        val id = NodeSnapshotter.idOf(source)
        val className = source.className?.toString()
        val bounds = Rect().also(source::getBoundsInScreen)
        val screenHeight = resources.displayMetrics.heightPixels
        NodeSnapshotter.recycle(source)
        val tall = bounds.height() >= screenHeight * ShortVideoMatchers.MIN_SCREEN_COVERAGE
        val isPager = (id != null && id in matcher.pagerIds) ||
            (tall && matcher.pagerClassHints.any { className?.contains(it) == true } &&
                (id == null || matcher.idTokens.any { id.contains(it) }))
        if (!isPager) return
        if (!counter.inSession) scheduleClassify(0)
        val deltaY = if (Build.VERSION.SDK_INT >= 28) event.scrollDeltaY else 0
        feed(FeedInput.Scroll(now(), app, event.fromIndex, event.toIndex, event.itemCount, deltaY, bounds.height()))
        if (prefs.verboseDebug) {
            ShortVideoDebugLog.event(app, "scroll", "id=$id from=${event.fromIndex} to=${event.toIndex} n=${event.itemCount} dy=$deltaY")
        }
    }

    private fun scheduleClassify(delayMs: Long) {
        if (classifyPending) return
        val wait = (lastClassifyAt + delayMs - now()).coerceAtLeast(0)
        classifyPending = true
        handler.postDelayed({ classifyPending = false; classifyNow() }, wait)
    }

    private fun classifyNow() {
        lastClassifyAt = now()
        val root = runCatching { rootInActiveWindow }.getOrNull()
        val pkg = root?.packageName?.toString()
        val app = ShortVideoApp.fromPackage(pkg)
        if (root == null || app == null || !prefs.appEnabled(app)) {
            root?.let(NodeSnapshotter::recycle)
            feed(FeedInput.Screen(now(), null, false))
            return
        }
        val snapshot = runCatching { NodeSnapshotter.snapshot(root, pkg!!) }.getOrNull()
        NodeSnapshotter.recycle(root)
        val result = snapshot?.let(classifier::classify)
        if (result == null) { feed(FeedInput.Screen(now(), app, false)); return }
        logClassification(snapshot, result)
        feed(FeedInput.Screen(now(), app, result.inShortVideo, result.pageKey, result.pageHeightPx))
    }

    private fun logClassification(snapshot: ScreenSnapshot, c: Classification) {
        val summary = if (c.inShortVideo) "in ${c.app.feedName} via ${c.rule} ${c.matchedId}" else
            "not in ${c.app.feedName}" + if (c.nearMissIds.isNotEmpty()) "; near: ${c.nearMissIds.take(6).joinToString()}" else ""
        ShortVideoDebugLog.classification(c.app, summary)
        if (lastSummary[c.app] != summary) {
            lastSummary[c.app] = summary
            if (prefs.verboseDebug || c.inShortVideo != (counter.activeApp == c.app)) ShortVideoDebugLog.event(c.app, "screen", summary)
        }
        val tuning = c.isFallback || (!c.inShortVideo && c.nearMissIds.size >= 2)
        if (tuning || prefs.verboseDebug) {
            val ids = snapshot.nodes.mapNotNull { it.viewId }.distinct().take(40)
            val large = snapshot.nodes.filter {
                it.visible && it.height >= snapshot.screenHeight * ShortVideoMatchers.MIN_SCREEN_COVERAGE && it.className != null
            }.mapNotNull { n -> n.className?.substringAfterLast('.')?.let { "$it#${n.viewId ?: "-"}" } }.distinct().take(8)
            ShortVideoDebugLog.unknownLayout(
                this, c.app,
                "rule=${c.rule} matched=${c.matchedId ?: "-"} large=[${large.joinToString()}] ids=[${ids.joinToString()}]",
            )
        }
    }

    // ---- counter ----

    private fun feed(input: FeedInput) = feedAll(counter.accept(input))

    private fun feedAll(events: List<CounterEvent>) {
        for (e in events) when (e) {
            is CounterEvent.SessionStarted -> {
                ShortVideoDebugLog.event(e.app, "session", "started")
                refreshCapsule()
            }
            is CounterEvent.SessionEnded -> {
                ShortVideoDebugLog.event(e.app, "session", "ended")
                onLeftShortVideo()
                // e.atMs is the counter's uptime clock, not a date: queue by the wall clock
                scope.launch { writeLock.withLock { repo.queueRecent(System.currentTimeMillis()) } }
            }
            is CounterEvent.NewReel -> onNewReel(e)
        }
        ensureTicking()
    }

    private fun onNewReel(e: CounterEvent.NewReel) {
        val wall = System.currentTimeMillis()
        ShortVideoDebugLog.event(e.app, "reel", "+1 (${e.signal})")
        scope.launch {
            writeLock.withLock {
                refreshToday(wall)
                todayTotal = repo.recordReel(e.app, wall)
                todayCounts = repo.summary(today).counts
                if (counter.activeApp == e.app) {
                    island.onNewReel(todayTotal, prefs.dailyLimit)
                    refreshCapsule()
                }
                val effect = limit.onNewReel(now(), todayTotal)
                if (effect is LimitEffect.ShowCountdown && counter.activeApp == e.app) {
                    repo.recordLimitHit(e.app, wall)
                    countdownApp = e.app
                    previewing = false
                    countdown.show(effect)
                    ShortVideoDebugLog.event(e.app, "limit", "countdown ${effect.secondsLeft}s at ${effect.count}/${effect.limit}")
                    ensureTicking()
                } else if (effect != null) {
                    limit.onLeft()
                }
            }
        }
    }

    private fun onCancelPressed() {
        if (previewing) { previewing = false; countdown.hide(); return }
        val app = countdownApp
        if (limit.onCancel() == LimitEffect.Cancelled) {
            countdown.hide()
            ShortVideoDebugLog.event(app, "limit", "cancelled")
            if (app != null) {
                val wall = System.currentTimeMillis()
                scope.launch { writeLock.withLock { repo.recordCancel(app, wall) } }
            }
        }
    }

    private fun onLeftShortVideo() {
        if (limit.onLeft() != null || countdown.showing) countdown.hide()
        if (!previewing) hideCapsule()
    }

    // ---- ticking: settle, exit grace, countdown, watchdog, day rollover ----

    private fun ensureTicking() {
        if (ticking) return
        if (!counter.inSession && !limit.counting) return
        ticking = true
        handler.postDelayed(::tick, TICK_MS)
    }

    private fun tick() {
        ticking = false
        val t = now()
        feedAll(counter.accept(FeedInput.Tick(t)))
        when (val effect = limit.onTick(t)) {
            is LimitEffect.UpdateCountdown -> countdown.update(effect.secondsLeft)
            LimitEffect.GoHome -> {
                countdown.hide()
                ShortVideoDebugLog.event(countdownApp, "limit", "sent home")
                performGlobalAction(GLOBAL_ACTION_HOME)
            }
            else -> Unit
        }
        // The service only hears Instagram and YouTube, so leaving them (home, another app) is
        // noticed by looking at the active window.
        if (counter.inSession && t - lastWatchdogAt >= WATCHDOG_MS) {
            lastWatchdogAt = t
            classifyNow()
        }
        val wall = System.currentTimeMillis()
        if (repo.dayOf(wall) != today) scope.launch { writeLock.withLock { refreshToday(wall); if (counter.activeApp != null) refreshCapsule() } }
        ensureTicking()
    }

    private suspend fun refreshToday(wall: Long) {
        val day = repo.dayOf(wall)
        if (day == today) return
        val previous = today
        today = day
        val summary = repo.summary(day)
        todayTotal = summary.total
        todayCounts = summary.counts
        if (previous != LocalDate.MIN) repo.queueRecent(wall)
    }

    // ---- capsule ----

    private fun refreshCapsule() {
        val decision = CapsulePolicy.decide(prefs.capsuleMode, live.environment(promoted))
        if (decision.systemNotification) {
            island.hide()
            live.show(todayTotal, todayCounts, prefs.dailyLimit) { wasPromoted ->
                promoted = wasPromoted
                ShortVideoRuntime.promoted.value = wasPromoted
                ShortVideoDebugLog.event(counter.activeApp, "capsule", if (wasPromoted) "Live Update promoted" else "not promoted")
                if (!wasPromoted && counter.activeApp != null) refreshCapsule()
            }
            ShortVideoRuntime.surface.value = CapsuleSurface.SYSTEM
        } else {
            live.hide()
            if (decision.overlayPill) {
                island.show(todayTotal, prefs.dailyLimit)
                ShortVideoRuntime.surface.value = CapsuleSurface.OVERLAY
            } else {
                island.hide()
                ShortVideoRuntime.surface.value = CapsuleSurface.NONE
            }
        }
    }

    private fun hideCapsule() {
        island.hide()
        live.hide()
        // Re-check promotion next session: the user may have allowed Live Updates meanwhile.
        promoted = null
        ShortVideoRuntime.surface.value = CapsuleSurface.NONE
    }

    // ---- previews from the settings screen ----

    internal fun previewIsland(): Boolean {
        previewing = true
        refreshCapsule()
        handler.postDelayed({
            previewing = false
            if (counter.activeApp == null) hideCapsule()
        }, PREVIEW_MS)
        return true
    }

    internal fun previewCountdown(): Boolean {
        previewing = true
        countdown.show(
            LimitEffect.ShowCountdown(prefs.countdownSeconds, true, prefs.dailyLimit, prefs.dailyLimit),
            preview = true,
        )
        handler.postDelayed({ if (previewing) { previewing = false; countdown.hide() } }, PREVIEW_MS)
        return true
    }

    private fun now(): Long = SystemClock.uptimeMillis()
}
