package desi.creative.vitals

import android.provider.Settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The system screens the engine plugin opens for the owner: the right action for each, and nothing else on the intent. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EngineScreensTest {
    @Test
    fun appInfoOpensVitalsOwnPage() {
        // where ⋮ › Allow restricted settings lives (Android 13+)
        val intent = EngineScreens.appInfo("desi.creative.vitals")
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, intent.action)
        assertEquals("package:desi.creative.vitals", intent.data.toString())
        assertNull(intent.component)
    }

    @Test
    fun accessibilityOpensTheAccessibilityList() {
        val intent = EngineScreens.accessibility()
        assertEquals(Settings.ACTION_ACCESSIBILITY_SETTINGS, intent.action)
        assertNull(intent.data)
    }
}
