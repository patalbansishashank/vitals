package desi.creative.vitals.widgets

import android.appwidget.AppWidgetManager
import android.os.Bundle
import android.view.View
import desi.creative.vitals.R
import desi.creative.vitals.widgets.WidgetSamples.fixture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAppWidgetManager

/**
 * Widgets as the launcher holds them: placed instances of the providers, each with its own size. A redraw gives every instance
 * a RemoteViews of its own size (a 2x2 and a 4x2 of the same card are different layouts), the status counts what is placed
 * by card (the web feed reads only for those), and an update of one instance leaves the others alone.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WidgetPlacementTest {
    private val ctx = RuntimeEnvironment.getApplication()
    private val mgr: AppWidgetManager = AppWidgetManager.getInstance(ctx)
    private val shadow: ShadowAppWidgetManager = shadowOf(mgr)

    @Before
    fun snapshot() {
        // what the web app last published (the shared numbers fixture, today in the sample's clock)
        WidgetState.saveSnapshot(ctx, fixture("snapshot-numbers.json"))
    }

    private fun place(provider: Class<out android.appwidget.AppWidgetProvider>, layout: Int, w: Int, h: Int): Int {
        val id = shadow.createWidget(provider, layout)
        mgr.updateAppWidgetOptions(
            id,
            Bundle().apply {
                putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, w)
                putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, w)
                putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, h)
                putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, h)
            },
        )
        return id
    }

    private fun viewOf(id: Int): View = shadow.getViewFor(id)

    @Test
    fun theStatusCountsWhatIsPlacedByCard() {
        assertEquals(0, VitalsWidgets.placedCount(ctx))
        place(EnergyWidgetProvider::class.java, R.layout.widget_card_ring, 172, 172)
        place(EnergyWidgetProvider::class.java, R.layout.widget_card_ring, 352, 172)
        place(TodayWidgetProvider::class.java, R.layout.widget_trio, 352, 172)
        val by = VitalsWidgets.placedByCard(ctx)
        assertEquals(2, by["energy"])
        assertEquals(1, by["today"])
        assertEquals(0, by["sleep"])
        assertEquals(setOf("today", "ring", "actions", "log", "energy", "sleep", "steps", "weight"), by.keys)
        assertEquals(3, VitalsWidgets.placedCount(ctx))
    }

    @Test
    fun everyInstanceIsDrawnAtItsOwnSize() {
        val small = place(EnergyWidgetProvider::class.java, R.layout.widget_card_ring, 172, 172)
        val big = place(EnergyWidgetProvider::class.java, R.layout.widget_card_ring, 352, 172)
        VitalsWidgets.updateData(ctx)
        val s = viewOf(small)
        val b = viewOf(big)
        assertNotNull("the 2x2 is the ring layout", s.findViewById<View>(R.id.vw_center))
        assertNull(s.findViewById<View>(R.id.vw_split))
        assertNotNull("the 4x2 is the side layout", b.findViewById<View>(R.id.vw_split))
        assertNull(b.findViewById<View>(R.id.vw_center))
    }

    @Test
    fun theProvidersDrawWhenTheSystemAsksAndWhenTheLauncherResizes() {
        val id = place(StepsWidgetProvider::class.java, R.layout.widget_card_ring, 172, 172)
        val provider = StepsWidgetProvider()
        provider.onUpdate(ctx, mgr, intArrayOf(id))
        assertNotNull(viewOf(id).findViewById<View>(R.id.vw_center))
        // the launcher says the widget is now a 4x2: only that instance is redrawn, in the wide layout
        val other = place(StepsWidgetProvider::class.java, R.layout.widget_card_ring, 172, 172)
        provider.onUpdate(ctx, mgr, intArrayOf(other))
        val wide = Bundle().apply {
            putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 352)
            putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 352)
            putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 172)
            putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 172)
        }
        mgr.updateAppWidgetOptions(id, wide)
        provider.onAppWidgetOptionsChanged(ctx, mgr, id, wide)
        assertNotNull(viewOf(id).findViewById<View>(R.id.vw_split))
        assertNotNull("the other instance keeps its own size", viewOf(other).findViewById<View>(R.id.vw_center))
    }

    @Test
    fun aWidgetJustPlacedWithNoSizeYetGetsItsDefault() {
        val id = shadow.createWidget(SleepWidgetProvider::class.java, R.layout.widget_card_ring)
        VitalsWidgets.updateData(ctx)
        assertTrue(viewOf(id).findViewById<View>(R.id.vw_center) != null)
    }

    @Test
    fun withNoSnapshotEveryWidgetAsksForTheApp() {
        WidgetState.clearSnapshot(ctx)
        val id = place(EnergyWidgetProvider::class.java, R.layout.widget_card_ring, 172, 172)
        VitalsWidgets.updateData(ctx)
        val note = viewOf(id).findViewById<android.widget.TextView>(R.id.vw_note)
        assertEquals(WidgetFormat.Words.FIRST_OPEN, note.text.toString())
        assertTrue(note.visibility == View.VISIBLE)
    }

    @Test
    fun thePinKeyKnowsTheCardsAndRefusesAnythingElse() {
        assertNull(VitalsWidgets.requestPin(ctx, "settings"))
        assertNull(VitalsWidgets.requestPin(ctx, null))
        // a launcher that cannot pin says so, and the web side then says where to find the widget in words
        shadow.setRequestPinAppWidgetSupported(false)
        assertEquals(false to false, VitalsWidgets.requestPin(ctx, "energy"))
        assertFalse(VitalsWidgets.canPin(ctx))
        shadow.setRequestPinAppWidgetSupported(true)
        assertTrue(VitalsWidgets.canPin(ctx))
        assertEquals(true, VitalsWidgets.requestPin(ctx, "energy")!!.first)
        assertEquals(setOf("today", "ring", "actions", "log", "energy", "sleep", "steps", "weight"), VitalsWidgets.Kind.entries.map { it.card }.toSet())
    }

    @Test
    fun theDrawnPicturesKeptBetweenRedrawsStayUnderTheirBound() {
        desi.creative.vitals.widgets.viz.VizBitmaps.clearCache()
        val hue = desi.creative.vitals.widgets.design.Tokens.hue("energy")
        // ten different rings at the largest size a picture has: 2 MB each, the process keeps a few
        for (i in 1..10) desi.creative.vitals.widgets.viz.VizBitmaps.render(desi.creative.vitals.widgets.viz.VizSpec.Ring(i / 10.0), hue, 300f, 300f, 3f)
        assertTrue(desi.creative.vitals.widgets.viz.VizBitmaps.cachedBytes() <= desi.creative.vitals.widgets.viz.VizBitmaps.CACHE_BYTES)
        // the same picture twice is drawn once
        val a = desi.creative.vitals.widgets.viz.VizBitmaps.render(desi.creative.vitals.widgets.viz.VizSpec.Ring(0.5), hue, 100f, 100f, 3f)
        val b = desi.creative.vitals.widgets.viz.VizBitmaps.render(desi.creative.vitals.widgets.viz.VizSpec.Ring(0.5), hue, 100f, 100f, 3f)
        assertTrue(a === b)
    }
}
