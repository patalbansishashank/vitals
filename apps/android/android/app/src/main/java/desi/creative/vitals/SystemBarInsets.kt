package desi.creative.vitals

import android.webkit.WebView
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.Bridge
import com.getcapacitor.WebViewListener

/** The page owns its insets. No native inset-style scrollbar may reserve a side gutter around it. */
internal fun configureEdgeToEdgeWebView(webView: WebView) {
    webView.scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
    webView.isVerticalScrollBarEnabled = false
    webView.isHorizontalScrollBarEnabled = false
    webView.isVerticalFadingEdgeEnabled = false
    webView.isHorizontalFadingEdgeEnabled = false
    webView.overScrollMode = View.OVER_SCROLL_NEVER
    webView.setPadding(0, 0, 0, 0)
}

/**
 * Keep the WebView behind the bars, including on Chromium < 140. Capacitor 8's default insets listener instead
 * pads the decor on those versions, exposing a separate native background above/alongside the page. Its injected
 * --safe-area-inset-* properties also aren't the --lm-safe-* tokens our layout consumes.
 *
 * We own insets (SystemBars.insetsHandling = disable), but leave icon styling/visibility with SystemBars. Only the
 * keyboard shrinks the viewport; safe-area padding belongs to the page's controls, never to the native backdrop.
 */
internal fun MainActivity.installSystemBarInsets(bridge: Bridge) {
    val decor = window.decorView
    val webView = bridge.webView

    fun publishInsets(insets: WindowInsetsCompat) {
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
        val density = resources.displayMetrics.density
        // Physical px -> CSS px, without rounding away fractional safe area. Explicit tokens avoid the WebView
        // env(safe-area-inset-*) bugs before Chromium 140 (and its keyboard bug before 144).
        webView.evaluateJavascript(
            """
            (() => {
                const s = document.documentElement.style;
                s.setProperty('--lm-safe-top', '${bars.top / density}px');
                s.setProperty('--lm-safe-right', '${bars.right / density}px');
                s.setProperty('--lm-safe-bottom', '${if (keyboardVisible) 0f else bars.bottom / density}px');
                s.setProperty('--lm-safe-left', '${bars.left / density}px');
            })();
            """.trimIndent(),
            null,
        )
    }

    ViewCompat.setOnApplyWindowInsetsListener(decor) { view, insets ->
        val keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
        val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
        view.setPadding(0, 0, 0, if (keyboardVisible) keyboard.bottom else 0)
        publishInsets(insets)

        // The keyboard has already resized the viewport. Clear the bottom system inset while it is shown so a
        // WebView that understands native safe areas doesn't reserve the navigation bar a second time.
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        WindowInsetsCompat.Builder(insets)
            .setInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
                Insets.of(bars.left, bars.top, bars.right, if (keyboardVisible) 0 else bars.bottom),
            )
            .build()
    }

    // Insets can arrive before the document exists. Republish on every navigation/reload, not only on rotation
    // or a keyboard change; otherwise a new page would fall back to the broken env() values on older WebViews.
    bridge.addWebViewListener(object : WebViewListener() {
        override fun onPageCommitVisible(view: WebView?, url: String?) {
            ViewCompat.getRootWindowInsets(decor)?.let(::publishInsets)
            ViewCompat.requestApplyInsets(decor)
        }
    })
    ViewCompat.requestApplyInsets(decor)
}
