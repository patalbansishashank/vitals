package desi.creative.vitals.widgets

import desi.creative.vitals.widgets.viz.BitmapBudget
import desi.creative.vitals.widgets.viz.VizBitmaps
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Bitmaps in a RemoteViews count against `6 * screenW * screenH` bytes (the Android 17 behaviour change: a warning at
 * targetSdk 36, an exception from 37). A widget keeps its pictures under a quarter of that and halves their resolution
 * before it gives one up.
 */
class WidgetBudgetTest {
    @Test
    fun theLimitIsSixTimesTheDisplayInBytes() {
        assertEquals(15_552_000L, BitmapBudget.limit(1080, 2400))
        assertEquals(6_912_000L, BitmapBudget.limit(720, 1600))
        assertEquals(3_888_000L, BitmapBudget.allowance(1080, 2400))
        assertEquals(4L * 100 * 50, BitmapBudget.bytes(100, 50))
    }

    @Test
    fun aPictureIsCappedAtItsLongestSideAndKeepsItsAspect() {
        // a 2x2's ring zone at 3x density: 110 dp -> 330 px
        assertEquals(330 to 330, VizBitmaps.pixels(110f, 110f, 3f))
        // a very large zone: the longest side stops at the cap and the other follows
        val (w, h) = VizBitmaps.pixels(400f, 200f, 4f)
        assertEquals(VizBitmaps.MAX_SIDE, w)
        assertEquals(VizBitmaps.MAX_SIDE / 2, h)
        // scaled by the budget's say, never under 2 px
        assertEquals(165 to 165, VizBitmaps.pixels(110f, 110f, 3f, scale = 0.5f))
        assertEquals(2 to 2, VizBitmaps.pixels(0.1f, 0.1f, 1f))
    }

    @Test
    fun theWorstWidgetIsFarUnderTheAllowanceOnEveryPhone() {
        // the Today glance: three rings at their largest on a tall 4x2 (about 100 dp across), the heaviest widget there is
        val rings = List(3) { 100f to 100f }
        for ((sw, sh, d) in listOf(Triple(1080, 2400, 2.75f), Triple(720, 1600, 2f), Triple(1440, 3200, 4f))) {
            assertEquals("${sw}x$sh", 1f, BitmapBudget.scaleFor(rings, d, sw, sh))
            val bytes = rings.sumOf { (w, h) -> VizBitmaps.pixels(w, h, d).let { BitmapBudget.bytes(it.first, it.second) } }
            assertTrue("$sw x $sh: $bytes bytes against ${BitmapBudget.limit(sw, sh)}", bytes < BitmapBudget.limit(sw, sh) / 4)
        }
    }

    @Test
    fun overTheAllowanceTheResolutionHalvesAndThenThePictureIsGivenUp() {
        val big = listOf(500f to 500f)
        // one picture at the cap (720 x 720 = 2.07 MB) fits a big phone's quarter (3.9 MB) but not a small one's (1.7 MB)
        assertEquals(1f, BitmapBudget.scaleFor(big, 3f, 1080, 2400))
        assertEquals(0.5f, BitmapBudget.scaleFor(big, 3f, 720, 1600))
        // four of them do not fit even the big phone at full size
        assertEquals(0.5f, BitmapBudget.scaleFor(List(4) { 500f to 500f }, 3f, 1080, 2400))
        // a screen too small for any: no picture, the widget shows its numbers and words
        assertNull(BitmapBudget.scaleFor(listOf(500f to 500f), 3f, 100, 100))
        assertNotNull(BitmapBudget.scaleFor(listOf(10f to 10f), 3f, 100, 100))
    }
}
