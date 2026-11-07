package desi.creative.vitals

import android.app.Application
import android.view.View
import android.webkit.WebView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WebViewViewportTest {
    @Test
    fun aPreviouslyInsetWebViewDoesNotReserveAScrollbarGutter() {
        val app: Application = RuntimeEnvironment.getApplication()
        val view = WebView(app)
        view.scrollBarStyle = View.SCROLLBARS_INSIDE_INSET
        view.setPadding(0, 0, 16, 0)
        view.isVerticalScrollBarEnabled = true
        view.isHorizontalScrollBarEnabled = true
        configureEdgeToEdgeWebView(view)
        assertEquals(View.SCROLLBARS_INSIDE_OVERLAY, view.scrollBarStyle)
        assertEquals(0, view.paddingRight)
        assertEquals(0, view.paddingLeft)
        assertFalse(view.isVerticalScrollBarEnabled)
        assertFalse(view.isHorizontalScrollBarEnabled)
        assertEquals(View.OVER_SCROLL_NEVER, view.overScrollMode)
        view.destroy()
    }
}
