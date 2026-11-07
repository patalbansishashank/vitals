package com.pulseloop.shortvideo

import com.pulseloop.shortvideo.IslandGeometry.Cutout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Where the pill goes and how big it is, for the owner's phone and the other shapes a cutout comes in. */
class IslandGeometryTest {
    // The owner's OnePlus Nord 4 (CPH2661) as his screenshot of the old pill reads back (the old code drawn with these
    // numbers is 370 px wide and ends 156 px down, as in the screenshot): 1240 x 2772 at 3.375 (540 dpi), a 139 px status
    // bar and a top cutout reported as a rect 79 px wide and as tall as the whole bar around the camera hole.
    private val nord4 = IslandScreen(1240, 2772, 139, Cutout(580, 0, 659, 139), 3.375f)

    private fun dp(v: Float, screen: IslandScreen) = Math.round(v * screen.density)

    @Test fun `the owner's phone gets a pill around the 79 px hole that fits inside the 139 px status bar`() {
        val g = IslandGeometry.of(nord4)
        assertTrue(g.visible)
        assertEquals(619, g.centerX)
        assertEquals(69, g.centerY)
        assertEquals(79, g.holeWidth)
        // The rect is 139 tall but the hole is round: no taller than wide.
        assertEquals(79, g.holeHeight)
        // One size, always: the hole and 4 dp either side.
        assertEquals(79 + 2 * dp(4f, nord4), g.height)
        assertEquals(16, g.top)
        assertEquals(g.centerY, g.top + g.height / 2)
        assertTrue(g.height < nord4.statusBarHeight)
        // The old pill was the rect's height plus 8 dp, and 12 dp more swollen: 166 and 206 px in a 139 px bar.
        assertTrue(g.height < 139 + dp(8f, nord4))
        // At most 36 % of the screen, so the clock and the system icons stay.
        assertEquals(446, g.maxWidth)
        assertTrue(g.left(g.maxWidth) > 0 && g.left(g.maxWidth) + g.maxWidth < 1240)
    }

    @Test fun `a status bar the system did not report is the cutout's bottom, or 24 dp without one`() {
        assertEquals(IslandGeometry.of(nord4), IslandGeometry.of(nord4.copy(statusBarHeight = 0)))
        val bare = IslandScreen(1080, 1920, 0, null, 2.625f)
        val g = IslandGeometry.of(bare)
        assertEquals(dp(24f, bare) - 2 * dp(2f, bare), g.height)
        assertEquals(dp(24f, bare) / 2, g.centerY)
    }

    @Test fun `a round hole in the middle is wrapped with a small margin`() {
        val screen = IslandScreen(1080, 2400, 105, Cutout(502, 28, 578, 104), 2.625f)
        val g = IslandGeometry.of(screen)
        assertEquals(540, g.centerX)
        assertEquals(66, g.centerY)
        assertEquals(76, g.holeWidth)
        assertEquals(76, g.holeHeight)
        // 76 + 2 * 11 would leave the bar: held to the bar less a thin margin top and bottom, still round the hole.
        assertEquals(105 - 2 * dp(2f, screen), g.height)
        assertTrue(g.height > g.holeHeight + 2 * dp(2f, screen))
    }

    @Test fun `a hole in the corner is nothing to wrap, so the pill sits top centre`() {
        val screen = IslandScreen(1080, 2280, 80, Cutout(910, 20, 1000, 105), 2.625f)
        val g = IslandGeometry.of(screen)
        assertEquals(540, g.centerX)
        assertEquals(40, g.centerY)
        assertEquals(0, g.holeWidth)
        assertEquals(0, g.holeHeight)
        assertTrue(g.height <= 80)
        assertEquals(5, g.top)
    }

    @Test fun `a notch is wrapped over its full width and its own height`() {
        val screen = IslandScreen(1080, 2340, 96, Cutout(380, 0, 700, 84), 2.625f)
        val g = IslandGeometry.of(screen)
        assertEquals(540, g.centerX)
        assertEquals(42, g.centerY)
        assertEquals(320, g.holeWidth)
        assertEquals(84, g.holeHeight)
        // The notch is taller than the bar leaves room for: the pill stays round it, 2 dp clear either side.
        assertEquals(84 + 2 * dp(2f, screen), g.height)
        // Room either side of it for a brain and a count, even though 320 px is a third of the width.
        assertTrue(g.maxWidth >= g.holeWidth + 2 * dp(48f, screen))
    }

    @Test fun `no cutout puts a pill top centre inside the status bar`() {
        val screen = IslandScreen(1080, 1920, 63, null, 2.625f)
        val g = IslandGeometry.of(screen)
        assertEquals(540, g.centerX)
        assertEquals(31, g.centerY)
        assertEquals(0, g.holeWidth)
        assertEquals(63 - 2 * dp(2f, screen), g.height)
        assertEquals(5, g.top)
        assertEquals(389, g.maxWidth)
    }

    @Test fun `two holes merged into one wide rect are not wrapped`() {
        val g = IslandGeometry.of(IslandScreen(1080, 2400, 100, Cutout(60, 20, 1020, 90), 2.625f))
        assertEquals(540, g.centerX)
        assertEquals(0, g.holeWidth)
    }

    @Test fun `a hole well off centre is not wrapped`() {
        val g = IslandGeometry.of(IslandScreen(1080, 2400, 100, Cutout(300, 20, 380, 100), 2.625f))
        assertEquals(540, g.centerX)
        assertEquals(0, g.holeWidth)
    }

    @Test fun `a phone on its side shows no pill`() {
        // Landscape: the cutout is on a short edge, so there is no top rect, and the status bar is not the band the pill sits in.
        val landscape = IslandScreen(2772, 1240, 100, null, 3.375f)
        assertFalse(IslandGeometry.of(landscape).visible)
        assertTrue(landscape.landscape)
        assertTrue(IslandGeometry.of(nord4).visible)
        assertFalse(nord4.landscape)
    }

    @Test fun `the pill stays on screen and inside the status bar for every shape`() {
        val screens = listOf(
            nord4,
            IslandScreen(1080, 2400, 105, Cutout(502, 28, 578, 104), 2.625f),
            IslandScreen(1080, 2280, 80, Cutout(910, 20, 1000, 105), 2.625f),
            IslandScreen(1080, 1920, 63, null, 2.625f),
            IslandScreen(1440, 3120, 130, Cutout(680, 40, 760, 120), 3.5f),
            IslandScreen(720, 1600, 52, Cutout(330, 0, 390, 60), 1.75f),
        )
        for (s in screens) {
            val g = IslandGeometry.of(s)
            val note = "$s -> $g"
            assertTrue(note, g.height > 0)
            assertTrue(note, g.height <= s.statusBarHeight || g.holeHeight + 2 * dp(2f, s) > s.statusBarHeight)
            assertTrue(note, g.maxWidth in 1..s.width)
            assertTrue(note, g.maxWidth <= s.width * 0.36f + 1 || g.holeWidth > 0)
            val windowWidth = g.maxWidth
            assertTrue(note, g.left(windowWidth) >= 0 && g.left(windowWidth) + windowWidth <= s.width)
            // The centre sits on the hole when there is one, on the screen's middle when not.
            assertEquals(note, if (g.holeWidth > 0) s.topCutout!!.centerX else s.width / 2, g.centerX)
        }
    }

    @Test fun `a window is kept on the screen`() {
        val g = IslandGeometry.of(nord4)
        assertEquals(619 - 200, g.left(400))
        assertEquals(0, g.copy(centerX = 10).left(400))
        assertEquals(1240 - 400, g.copy(centerX = 1230).left(400))
    }

    @Test fun `the pill's width is the hole plus the wider side's content on both sides, or the two side by side`() {
        // Around a hole both sides are as wide as the wider content so the hole stays in the middle.
        assertEquals(79f + 2 * (24f + 20f + 67f), IslandGeometry.pillWidth(79f, 67f, 63f, 24f, 20f), 0.001f)
        assertEquals(79f + 2 * (24f + 20f + 90f), IslandGeometry.pillWidth(79f, 67f, 90f, 24f, 20f), 0.001f)
        // Without one the brain and the count sit together.
        assertEquals(2 * 24f + 20f + 67f + 63f, IslandGeometry.pillWidth(0f, 67f, 63f, 24f, 20f), 0.001f)
    }

    @Test fun `content shrinks to fit what is left and never grows`() {
        assertEquals(1f, IslandGeometry.fitScale(120f, 106f), 0f)
        assertEquals(1f, IslandGeometry.fitScale(106f, 106f), 0f)
        assertEquals(0.75f, IslandGeometry.fitScale(60f, 80f), 0.001f)
        assertEquals(1f, IslandGeometry.fitScale(10f, 0f), 0f)
        assertEquals(0f, IslandGeometry.fitScale(-5f, 80f), 0f)
        // The owner's pill at the largest font setting (2.0): the count's line is 15 * 3.375 * 2 * 1.21 = 122 px
        // against 87 px between the pill's top and bottom padding, so it is drawn at 0.71.
        val line = 15f * 3.375f * 2f * 1.21f
        val room = IslandGeometry.of(nord4).height - 2 * 3 * 3.375f
        val scale = IslandGeometry.fitScale(room, line)
        assertEquals(0.71f, scale, 0.01f)
        assertEquals(room, line * scale, 0.01f)
    }
}
