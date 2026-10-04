package desi.creative.vitals

import android.content.Context
import android.util.AttributeSet
import android.view.View
import com.getcapacitor.CapacitorWebView
import java.lang.ref.WeakReference

/**
 * Capacitor's WebView, with one change: while RingLinkService runs, it tells Chromium its window is still visible.
 *
 * Measured on the owner's phone (Android 16): about 20 s after the screen goes off, the WebView's renderer stops
 * running JS (timers, and events sent from native such as RingTick's), although its process is at foreground-service
 * priority, not frozen, and the CPU is held awake. Chromium stops a renderer whose pages are all hidden, and the screen
 * going off makes the window invisible. Reporting it visible keeps the ring service's JS running whenever the CPU is
 * awake (RingTick wakes it). Nothing is drawn with the screen off: there are no frames to draw without the display.
 *
 * The page would then always think it is on screen, so the real window visibility goes to the web layer as the
 * plugin's `screen` event (androidBoot makes `document.visibilityState` follow it).
 */
class RingWebView(context: Context, attrs: AttributeSet?) : CapacitorWebView(context, attrs) {

    init {
        current = WeakReference(this)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        current = WeakReference(this)
        // Attached while the window is hidden (a fresh WebView after a renderer loss with the screen off): Android
        // does not call onWindowVisibilityChanged then, and Chromium would start it hidden.
        if (ShellState.keepAliveOn && windowVisibility != View.VISIBLE) super.onWindowVisibilityChanged(View.VISIBLE)
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(if (ShellState.keepAliveOn) View.VISIBLE else visibility)
        val on = visibility == View.VISIBLE
        if (on != ShellState.onScreen) {
            ShellState.onScreen = on
            ShellState.plugin?.fireScreen(on)
        }
    }

    /** The service started or stopped while the window is hidden: tell Chromium the visibility that applies now. */
    fun keepAliveChanged() {
        super.onWindowVisibilityChanged(if (ShellState.keepAliveOn) View.VISIBLE else windowVisibility)
    }

    companion object {
        @Volatile private var current: WeakReference<RingWebView>? = null

        /** Called on any thread after ShellState.keepAliveOn changed. */
        fun onKeepAliveChanged() {
            val view = current?.get() ?: return
            view.post { view.keepAliveChanged() }
        }
    }
}
