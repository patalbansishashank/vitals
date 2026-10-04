package desi.creative.vitals

import android.content.Intent
import android.os.Bundle
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity
import com.getcapacitor.WebViewListener

/**
 * The one activity. Capacitor's BridgeActivity loads the web app; this adds the VitalsShell plugin, the share
 * intake, back-button handling and what it takes to keep the WebView's JS (the ring link) running with the screen
 * off while RingLinkService is up.
 *
 * What Capacitor 8 pauses in the background: nothing in the WebView. Bridge.onPause() calls
 * cordovaWebView.handlePause(keepRunning) with the Cordova "KeepRunning" preference, which defaults to true, so
 * webView.onPause()/pauseTimers() are never called; onStop() only tells the plugins. So there is nothing to undo;
 * the two things below are Android's own: the renderer priority (the OS drops a hidden WebView's renderer to
 * "waived", a kill candidate) and, as a guard, timers if that preference were ever flipped.
 */
class MainActivity : BridgeActivity() {

    private var handledIntent: Intent? = null

    /** The WebView's renderer is gone and a fresh activity (and WebView) is on its way: the service stays. */
    private var restarting = false

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(VitalsShellPlugin::class.java)
        // Before super: the plugin loads inside super.onCreate and reads the reason ('boot' fires bootCompleted).
        if (savedInstanceState != null) {
            // Recreated after the process died: the launch intent's share or link was handled the first time.
            handledIntent = intent
            ShellState.launchReason = "launcher"
        } else {
            ShellState.launchReason = ShellState.reasonFor(intent)
        }
        super.onCreate(savedInstanceState)
        ShellState.activityAlive = true
        SharedFiles.pruneOld(this)

        // Keep the renderer process at foreground priority even when the activity is hidden (API 26+); otherwise
        // Android lowers it as soon as the screen goes off and may kill it under memory pressure.
        bridge?.webView?.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)

        // Measured on the owner's phone: with the screen off for 20 minutes the system dropped the WebView's renderer
        // ("isolated not needed"), and WebView's default for an unhandled loss is to kill the app with it. Handle it:
        // keep the process and the ring service, and start over with a fresh activity and WebView, whose JS
        // reconnects the ring.
        bridge?.addWebViewListener(object : WebViewListener() {
            override fun onRenderProcessGone(webView: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                restarting = true
                runOnUiThread { recreate() }
                return true
            }
        })

        // Capacitor has no back handling of its own (that is @capacitor/app, not a dependency): without this the
        // activity finishes and the ring link dies. Go back in the web history, else leave the app in the background.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val webView = bridge?.webView
                if (webView != null && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    moveTaskToBack(true)
                }
            }
        })

        // BridgeActivity.load() already routed the launch intent through onNewIntent (after the bridge's own first
        // load, so an App Link's page replaces it); this only covers the case where it did not (no WebView installed).
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null || intent === handledIntent) return
        handledIntent = intent
        ShellState.launchReason = ShellState.reasonFor(intent)
        if (ShellState.isFromHistory(intent)) return
        SharedFiles.take(this, intent)
        openAppLink(intent)
    }

    /** An https://vitals.creative.desi/settings… App Link: the same page on the app's own origin, in the WebView. */
    private fun openAppLink(intent: Intent) {
        if (intent.action != Intent.ACTION_VIEW) return
        val url = AppLinks.localUrlFor(intent.dataString) ?: return
        val webView = bridge?.webView ?: return
        // Posted, so it runs after anything Capacitor queued for its first load and wins.
        webView.post { webView.loadUrl(url) }
    }

    override fun onStop() {
        super.onStop()
        if (ShellState.keepAliveOn) {
            // Guard only: Capacitor does not pause the WebView (see the class comment), these are no-ops then.
            bridge?.webView?.let {
                it.onResume()
                it.resumeTimers()
            }
        }
    }

    override fun onDestroy() {
        ShellState.activityAlive = false
        // The WebView (and the ring link in it) is gone: the service has nothing left to keep alive, unless a fresh
        // WebView is about to take over.
        if (!restarting && !isChangingConfigurations) RingLinkService.stop(this)
        super.onDestroy()
    }
}
