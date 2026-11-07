package desi.creative.vitals.widgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A widget reads its own size: a launcher's "2x2" can be 130x220 dp and a "4x2" 276 to 376 dp wide. */
class WidgetSizeTest {
    private val fallback = WidgetSize(132, 132)

    @Test
    fun classesFollowTheSizeNeverACellCount() {
        assertEquals(SizeClass.SQUARE, WidgetSize.classOf(130, 220))
        assertEquals(SizeClass.SQUARE, WidgetSize.classOf(172, 172))
        assertEquals(SizeClass.WIDE, WidgetSize.classOf(276, 220))
        assertEquals(SizeClass.WIDE, WidgetSize.classOf(352, 172))
        assertEquals(SizeClass.WIDE, WidgetSize.classOf(200, 90))
        assertEquals(SizeClass.STRIP, WidgetSize.classOf(276, 102 - 14))
        assertEquals(SizeClass.STRIP, WidgetSize.classOf(352, 76))
        assertEquals(SizeClass.SQUARE, WidgetSize.classOf(199, 400))
        assertEquals(SizeClass.SQUARE, WidgetSize(130, 220).cls)
    }

    @Test
    fun theOptionsGiveThePortraitOrTheLandscapeSize() {
        // portrait: the narrowest entry (or minimum width by maximum height); landscape: the widest (or maximum width by minimum height)
        val sizes = listOf(130f to 220f, 276f to 102f)
        assertEquals(WidgetSize(130, 220), WidgetSize.choose(sizes, 130, 102, 276, 220, landscape = false, fallback = fallback))
        assertEquals(WidgetSize(276, 102), WidgetSize.choose(sizes, 130, 102, 276, 220, landscape = true, fallback = fallback))
        // below Android 12 there is no list: the launcher's estimate
        assertEquals(WidgetSize(130, 220), WidgetSize.choose(emptyList(), 130, 102, 276, 220, landscape = false, fallback = fallback))
        assertEquals(WidgetSize(276, 102), WidgetSize.choose(emptyList(), 130, 102, 276, 220, landscape = true, fallback = fallback))
    }

    @Test
    fun aWidgetJustPlacedHasTheDefaultOfItsKind() {
        assertEquals(fallback, WidgetSize.choose(emptyList(), 0, 0, 0, 0, landscape = false, fallback = fallback))
        assertEquals("a half-said estimate is not a size", fallback, WidgetSize.choose(emptyList(), 130, 0, 276, 0, landscape = false, fallback = fallback))
        assertEquals(fallback, WidgetSize.choose(listOf(0f to 0f), 0, 0, 0, 0, landscape = false, fallback = fallback))
        assertEquals(SizeClass.SQUARE, VitalsWidgets.Kind.ENERGY.fallback.cls)
        assertEquals(SizeClass.WIDE, VitalsWidgets.Kind.TODAY.fallback.cls)
        assertEquals(SizeClass.STRIP, VitalsWidgets.Kind.ACTIONS.fallback.cls)
    }
}

/** The room a figure and its facts take: the lines of a text that wraps, and the largest size that fits. */
class TextFitTest {
    // a fake face: every character is 10 px wide
    private val ten = { s: String -> s.length * 10f }

    @Test
    fun linesWrapAtWordBoundaries() {
        assertEquals(1, TextFit.wrappedLines("AT 13:16", 100f, ten))
        assertEquals(2, TextFit.wrappedLines("AT 13:16 RING 64 %", 100f, ten))
        assertEquals(2, TextFit.wrappedLines("LATE EVENING\nTO EARLY MORNING", 400f, ten))
        assertEquals(1, TextFit.wrappedLines("", 100f, ten))
        // a word wider than the line takes a line of its own and does not loop
        assertEquals(2, TextFit.wrappedLines("EXTRAORDINARILY LONG", 50f, ten))
    }

    @Test
    fun theFigureTakesTheLargestSizeThatFits() {
        // 0.5 px of width per sp and character: "1 096" (5 characters) at 40 sp is 100 px
        val measure = { sp: Float -> 5 * sp * 0.5f }
        assertEquals(40f, TextFit.fitSp(40f, 16f, 200f, measure), 0f)
        assertEquals(40f, TextFit.fitSp(40f, 16f, 100f, measure), 0f)
        assertEquals(20f, TextFit.fitSp(40f, 16f, 50f, measure), 0.5f)
        // never below the smallest, whatever the room
        assertEquals(16f, TextFit.fitSp(40f, 16f, 5f, measure), 0.5f)
    }

    // a sentence: every character is `sp` px wide
    private val perSp = { w: String, sp: Float -> w.length * sp }

    @Test
    fun aSentenceTakesTheLargestSizeThatWrapsIntoItsLines() {
        val text = "OVER HALF OF THE GOAL"
        // two lines in 100 px: "OVER HALF" over "OF THE GOAL" (11 characters) is the widest, so about 9 px a character
        val two = TextFit.fitWordSp(text, 20f, 4f, 100f, 2, perSp)
        assertEquals(9f, two, 0.6f)
        assertTrue(TextFit.wordFits(text, two, 100f, 2, perSp))
        assertFalse(TextFit.wordFits(text, two + 1f, 100f, 2, perSp))
        // three lines allow a larger size
        assertTrue(TextFit.fitWordSp(text, 20f, 4f, 100f, 3, perSp) > two)
        // never over the largest asked for
        assertEquals(6f, TextFit.fitWordSp("A B", 6f, 4f, 100f, 2, perSp), 0f)
    }

    @Test
    fun theHeightBoundsTheSizeToo() {
        val text = "OVER HALF OF THE GOAL"
        // two lines at 1.2 times their size must fit 20 px: 8.3 or less
        val short = TextFit.fitWordSp(text, 20f, 4f, 100f, 3, perSp) { lines, sp -> lines * sp * 1.2f <= 20f }
        assertTrue(short <= 8.4f)
        assertTrue(TextFit.wordFits(text, short, 100f, 3, perSp) { lines, sp -> lines * sp * 1.2f <= 20f })
    }

    @Test
    fun aWordWiderThanTheLineShrinksTheSizeUntilTheWordFits() {
        // "EXTRAORDINARILY" (15 characters) is wider than 100 px at 8 sp, so it never fits there; it does at 6.5
        assertFalse(TextFit.wordFits("EXTRAORDINARILY LONG", 8f, 100f, 3, perSp))
        assertEquals(6.6f, TextFit.fitWordSp("EXTRAORDINARILY LONG", 20f, 4f, 100f, 3, perSp), 0.2f)
        // and never below the smallest, whatever the word
        assertEquals(8f, TextFit.fitWordSp("EXTRAORDINARILY LONG", 20f, 8f, 100f, 3, perSp), 0f)
    }
}
