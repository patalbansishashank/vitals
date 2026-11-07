package desi.creative.vitals

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import com.getcapacitor.BridgeActivity
import com.getcapacitor.ServerPath
import com.getcapacitor.WebViewListener
import desi.creative.vitals.widgets.VitalsWidgetsPlugin
import desi.creative.vitals.widgets.WidgetLinks
import desi.creative.vitals.widgets.WidgetState

/**
 * The one activity. Capacitor's BridgeActivity loads the web app; this adds the VitalsShell, VitalsUpdates, VitalsGauge, GaugeEngine
 * (0.7.0, Gauge's engine inside this app) and VitalsWidgets plugins, the web bundle to serve (OtaBoot: the APK's own or a downloaded one), the share intake, App Links,
 * home-screen widget taps, back-button handling and recovery when the WebView's renderer is lost.
 */
class MainActivity : BridgeActivity() {

    private var handledIntent: Intent? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(VitalsShellPlugin::class.java)
        registerPlugin(VitalsUpdatesPlugin::class.java)
        registerPlugin(VitalsGaugePlugin::class.java)
        registerPlugin(GaugeEnginePlugin::class.java)
        registerPlugin(VitalsWidgetsPlugin::class.java)
        // A downloaded web bundle replaces the APK's assets before the bridge's first load (no double load).
        OtaBoot.serverBasePath(this)?.let { bridgeBuilder.setServerPath(ServerPath(ServerPath.PathType.BASE_PATH, it)) }
        // Recreated after the process died: the launch intent's share or link was handled the first time.
        if (savedInstanceState != null) handledIntent = intent
        super.onCreate(savedInstanceState)
        // Capacitor 8 does not enable edge-to-edge on Android < 15. Dark styles keep white icons even when the
        // device is in light mode; transparent scrims let the web page paint the system bars and display cutout.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        bridge?.let {
            // r068 U6: no visible scrollbar on the phone; the WebView's own indicator ignores the page's CSS
            configureEdgeToEdgeWebView(it.webView)
            installSystemBarInsets(it)
            OtaBoot.attach(this, it)
        }
        SharedFiles.pruneOld(this)

        // The system may drop a background WebView's renderer, and WebView's default for an unhandled loss is to kill
        // the app with it. Handle it: keep the process and start over with a fresh activity and WebView.
        bridge?.addWebViewListener(object : WebViewListener() {
            override fun onRenderProcessGone(webView: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                runOnUiThread { recreate() }
                return true
            }
        })

        // Capacitor has no back handling of its own (that is @capacitor/app, not a dependency): without this the
        // activity finishes. Go back in the web history, else leave the app in the background.
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

    override fun onDestroy() {
        OtaBoot.detach(bridge)
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        bridge?.triggerWindowJSEvent("vitalsForeground")
    }

    override fun onPause() {
        bridge?.triggerWindowJSEvent("vitalsBackground")
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null || intent === handledIntent) return
        handledIntent = intent
        if (ShellState.isFromHistory(intent)) return
        SharedFiles.take(this, intent)
        openAppLink(intent)
        openWidgetLink(intent)
    }

    /**
     * A home-screen widget tap: its screen waits in WidgetState and the web side opens it through the router (no page
     * reload). On a cold start the event is retained until the web app listens.
     */
    private fun openWidgetLink(intent: Intent) {
        val path = WidgetLinks.pathFor(intent.action, intent.getStringExtra(WidgetLinks.EXTRA_TARGET)) ?: return
        WidgetState.setPendingOpen(path)
        WidgetState.plugin?.announceOpen()
    }

    /** An https://vitals.creative.desi/settings… App Link: the same page on the app's own origin, in the WebView. */
    private fun openAppLink(intent: Intent) {
        if (intent.action != Intent.ACTION_VIEW) return
        val url = AppLinks.localUrlFor(intent.dataString) ?: return
        val webView = bridge?.webView ?: return
        // Posted, so it runs after anything Capacitor queued for its first load and wins.
        webView.post { webView.loadUrl(url) }
    }
}
