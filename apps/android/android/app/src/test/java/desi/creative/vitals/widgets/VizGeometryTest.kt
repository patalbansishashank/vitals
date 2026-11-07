package desi.creative.vitals.widgets

import desi.creative.vitals.widgets.WidgetSnapshot.Series
import desi.creative.vitals.widgets.WidgetSnapshot.StageSpan
import desi.creative.vitals.widgets.viz.BarsGeometry
import desi.creative.vitals.widgets.viz.GlowLineGeometry
import desi.creative.vitals.widgets.viz.GlowLineGeometry.Insets
import desi.creative.vitals.widgets.viz.HypnogramGeometry
import desi.creative.vitals.widgets.viz.RadialTicksGeometry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The geometry of every picture: tick angles and lit counts, a line's points and gaps, a bar's rectangle, a stage run's block. No Android class in any of it. */
class VizGeometryTest {
    @Test
    fun theRingLightsTheRatioOfItsSeventyTwoTicks() {
        assertEquals(0, RadialTicksGeometry.litCount(0.0))
        assertEquals(36, RadialTicksGeometry.litCount(0.5))
        assertEquals(61, RadialTicksGeometry.litCount(0.845))
        assertEquals(72, RadialTicksGeometry.litCount(1.0))
        assertEquals("past the goal every tick is lit", 72, RadialTicksGeometry.litCount(3.4))
        assertEquals(0, RadialTicksGeometry.litCount(-1.0))
        assertEquals(0, RadialTicksGeometry.litCount(Double.NaN))
        val ticks = RadialTicksGeometry.ticks(0.5)
        assertEquals(72, ticks.size)
        assertEquals(0.0, ticks[0].angleDeg, 1e-9)
        assertEquals(5.0, ticks[1].angleDeg, 1e-9)
        assertEquals(355.0, ticks[71].angleDeg, 1e-9)
        assertEquals(36, ticks.count { it.lit })
        assertTrue("lit from 12 o'clock on", ticks.take(36).all { it.lit } && ticks.drop(36).none { it.lit })
        assertEquals("every sixth is longer", 12, ticks.count { it.long })
        assertTrue(ticks[0].long && ticks[6].long && !ticks[5].long)
    }

    @Test
    fun aPassedGoalGetsABrightCapAndNothingElseDoes() {
        assertTrue(RadialTicksGeometry.ticks(1.058)[0].cap)
        assertEquals(1, RadialTicksGeometry.ticks(1.058).count { it.cap })
        assertEquals(0, RadialTicksGeometry.ticks(1.0).count { it.cap })
        assertEquals(0, RadialTicksGeometry.ticks(0.99).count { it.cap })
    }

    private val inset = Insets(10f, 10f, 10f, 10f)

    @Test
    fun aLineIsOnePointPerReadingAndBreaksAtAGap() {
        val runs = GlowLineGeometry.runs(listOf(0.0, 0.5, null, 1.0, 0.25), 120f, 60f, inset)
        assertEquals(2, runs.size)
        assertEquals(2, runs[0].size)
        assertEquals(2, runs[1].size)
        // x spreads the whole series across the plot, y is 1 - the value of the plot's height
        assertEquals(10f, runs[0][0].x, 1e-4f)
        assertEquals(50f, runs[0][0].y, 1e-4f)
        assertEquals(35f, runs[0][1].x, 1e-4f)
        assertEquals(30f, runs[0][1].y, 1e-4f)
        assertEquals(85f, runs[1][0].x, 1e-4f)
        assertEquals(10f, runs[1][0].y, 1e-4f)
        assertEquals(110f, runs[1][1].x, 1e-4f)
        assertEquals(40f, runs[1][1].y, 1e-4f)
        assertEquals(emptyList<List<GlowLineGeometry.Pt>>(), GlowLineGeometry.runs(listOf(null, null), 100f, 50f, inset))
        // one reading sits in the middle
        assertEquals(60f, GlowLineGeometry.runs(listOf(0.5), 120f, 60f, inset)[0][0].x, 1e-4f)
    }

    @Test
    fun theLiveEndIsTheSeriesNowOrTheLastReading() {
        assertEquals(1, GlowLineGeometry.endIndex(Series(listOf(0.1, 0.2, 0.3), now = 1)))
        assertEquals("the last reading when now has none", 2, GlowLineGeometry.endIndex(Series(listOf(0.1, 0.2, 0.3, null), now = 3)))
        assertEquals(2, GlowLineGeometry.endIndex(Series(listOf(0.1, 0.2, 0.3, null))))
        assertNull(GlowLineGeometry.endIndex(Series(listOf(null, null))))
        val end = GlowLineGeometry.end(Series(listOf(0.0, 1.0), now = 1), 100f, 50f, inset)!!
        assertEquals(90f, end.x, 1e-4f)
        assertEquals(10f, end.y, 1e-4f)
    }

    @Test
    fun barsAreOnePerReadingNeverAZeroBarAndTheCurrentOneIsMarked() {
        val bars = BarsGeometry.bars(listOf(0.0, 0.5, null, 1.0, 0.01), now = 3, w = 100f, h = 50f, gapRatio = 0.5f, minHeight = 2f)
        // the zero reading and the gap draw nothing
        assertEquals(3, bars.size)
        assertEquals(0.5f * 50f, bars[0].height, 1e-4f)
        assertEquals(25f, bars[0].top, 1e-4f)
        assertEquals(10f, bars[0].width, 1e-4f)
        // the slot is 20: bar 1 starts at 20 + 5
        assertEquals(25f, bars[0].x, 1e-4f)
        assertTrue(bars[1].now)
        assertFalse(bars[0].now)
        assertEquals(50f, bars[1].height, 1e-4f)
        assertEquals(0f, bars[1].top, 1e-4f)
        assertEquals("a small reading keeps a visible bar", 2f, bars[2].height, 1e-4f)
        assertTrue(BarsGeometry.bars(emptyList(), null, 100f, 50f).isEmpty())
    }

    @Test
    fun aStageRunIsABlockOnItsRowAwakeOnTop() {
        assertEquals(listOf(0f, 1f, 2f, 3f), listOf(0, 1, 2, 3).map { HypnogramGeometry.rowOf(it) })
        assertEquals("a night with no stage is one band between the levels", 1.5f, HypnogramGeometry.rowOf(4), 0f)
        val blocks = HypnogramGeometry.blocks(listOf(StageSpan(0.5, 1.0, 3), StageSpan(0.0, 0.5, 0)), 200f, 80f, minWidth = 2f)
        // sorted in time; four rows of 20: awake is the middle of the first, deep of the last
        assertEquals(0f, blocks[0].x, 1e-4f)
        assertEquals(100f, blocks[0].width, 1e-4f)
        assertEquals(10f, blocks[0].centerY, 1e-4f)
        assertEquals(100f, blocks[1].x, 1e-4f)
        assertEquals(70f, blocks[1].centerY, 1e-4f)
        // a sliver is still a block
        assertEquals(2f, HypnogramGeometry.blocks(listOf(StageSpan(0.5, 0.5001, 2)), 200f, 80f, minWidth = 2f)[0].width, 1e-4f)
    }
}
