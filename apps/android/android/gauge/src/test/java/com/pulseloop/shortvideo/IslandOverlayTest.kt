package com.pulseloop.shortvideo

import android.app.Application
import android.content.Context
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowDisplayManager
import org.robolectric.shadows.ShadowLooper
import org.robolectric.shadows.ShadowWindowManagerImpl

/**
 * The overlay's window: a touchless accessibility overlay sized and placed by [IslandGeometry], put up again after a
 * rotation and not there while the phone is on its side. (The framework reports no cutout here, so it is the
 * top-centre pill; the rules for cutouts are in [IslandGeometryTest] and what they draw in [IslandRenderTest].)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w367dp-h821dp-540dpi")
class IslandOverlayTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private val windowManager: WindowManager get() = context.getSystemService(WindowManager::class.java)
    private fun views(): List<View> = Shadow.extract<ShadowWindowManagerImpl>(windowManager).views

    private fun params(view: View) = view.layoutParams as WindowManager.LayoutParams

    @Test fun `the pill is a touchless accessibility overlay at the top centre, inside the status bar`() {
        val overlay = IslandOverlay(context)
        overlay.show(10, 30)
        assertTrue(overlay.showing)
        val view = views().single()
        val lp = params(view)
        println("OVERLAY window ${lp.width}x${lp.height} at ${lp.x},${lp.y}; screen ${context.resources.displayMetrics.widthPixels}x${context.resources.displayMetrics.heightPixels}")
        assertEquals(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY, lp.type)
        // LEFT and not START: x counts from the screen's left edge also in a right-to-left language.
        assertEquals(Gravity.TOP or Gravity.LEFT, lp.gravity)
        assertTrue(lp.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE != 0)
        assertTrue(lp.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE != 0)
        val width = context.resources.displayMetrics.widthPixels
        assertEquals(width / 2.0, lp.x + lp.width / 2.0, 1.5)
        assertTrue(lp.y >= 0)
        // The pill is at most 36 % of the screen; its window has 1 dp spare either side.
        assertTrue(lp.width <= width * 0.36f + 2 * context.resources.displayMetrics.density + 1)
        overlay.hide()
    }

    @Test fun `a new reel changes the number and never the window`() {
        val overlay = IslandOverlay(context)
        overlay.show(29, 30)
        val view = views().single()
        val lp = params(view)
        val before = listOf(lp.x, lp.y, lp.width, lp.height)
        overlay.onNewReel(30, 30)
        overlay.onNewReel(31, 30)
        overlay.show(31, 30)
        assertEquals(1, views().size)
        assertTrue(view === views().single())
        assertEquals(before, listOf(params(view).x, params(view).y, params(view).width, params(view).height))
        overlay.hide()
    }

    @Test fun `showing again with the same screen only updates the count`() {
        val overlay = IslandOverlay(context)
        overlay.show(10, 30)
        val first = views().single()
        overlay.show(11, 30)
        assertEquals(1, views().size)
        assertTrue(first === views().single())
        overlay.hide()
        assertFalse(overlay.showing)
        assertTrue(views().isEmpty())
    }

    @Test fun `no pill while the phone is on its side`() {
        RuntimeEnvironment.setQualifiers("w821dp-h367dp-540dpi")
        val overlay = IslandOverlay(context)
        overlay.show(10, 30)
        assertFalse(overlay.showing)
        assertTrue(views().isEmpty())
        overlay.hide()
    }

    @Test fun `a rotation takes the pill down on its side and puts it up again upright`() {
        val overlay = IslandOverlay(context)
        overlay.show(10, 30)
        assertTrue(overlay.showing)

        RuntimeEnvironment.setQualifiers("w821dp-h367dp-540dpi")
        ShadowDisplayManager.changeDisplay(Display.DEFAULT_DISPLAY, "w821dp-h367dp-540dpi")
        ShadowLooper.idleMainLooper(500, TimeUnit.MILLISECONDS)
        assertFalse("on its side", overlay.showing)
        assertTrue(views().isEmpty())

        RuntimeEnvironment.setQualifiers("w367dp-h821dp-540dpi")
        ShadowDisplayManager.changeDisplay(Display.DEFAULT_DISPLAY, "w367dp-h821dp-540dpi")
        ShadowLooper.idleMainLooper(500, TimeUnit.MILLISECONDS)
        assertTrue("upright again", overlay.showing)
        assertEquals(1, views().size)
        overlay.hide()
        assertTrue(views().isEmpty())
    }

    @Test fun `hide takes the pill down and stops listening for rotations`() {
        val overlay = IslandOverlay(context)
        overlay.show(10, 30)
        overlay.hide()
        assertTrue(views().isEmpty())
        // A rotation after hide must not bring it back.
        ShadowDisplayManager.changeDisplay(Display.DEFAULT_DISPLAY, "w821dp-h367dp-540dpi")
        ShadowDisplayManager.changeDisplay(Display.DEFAULT_DISPLAY, "w367dp-h821dp-540dpi")
        ShadowLooper.idleMainLooper(500, TimeUnit.MILLISECONDS)
        assertTrue(views().isEmpty())
        assertFalse(overlay.showing)
    }
}
