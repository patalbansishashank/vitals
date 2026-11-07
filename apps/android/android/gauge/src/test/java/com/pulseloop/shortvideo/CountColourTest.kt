package com.pulseloop.shortvideo

import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The island's count colour: warm white at the first reel, red at the daily limit, always readable on black. */
class CountColourTest {
    private fun hex(argb: Int) = "#%06X".format(argb and 0xFFFFFF)

    /** Every channel within [by] of the expected 0xRRGGBB. */
    private fun near(expected: Int, actual: Int, by: Int = 2) =
        listOf(16, 8, 0).all { abs((expected shr it and 0xFF) - (actual shr it and 0xFF)) <= by }

    @Test fun `against a limit of 30 the count goes from warm white through amber to red at 1, 10, 20, 30 and 35`() {
        val at = listOf(1, 10, 20, 30, 35).associateWith { CountColour.of(it, 30) }
        assertTrue(hex(at.getValue(1)), near(0xF5F1E9, at.getValue(1)))   // warm white
        assertTrue(hex(at.getValue(10)), near(0xFED285, at.getValue(10))) // pale amber
        assertTrue(hex(at.getValue(20)), near(0xFF9D35, at.getValue(20))) // orange
        assertTrue(hex(at.getValue(30)), near(0xFF3532, at.getValue(30))) // red at the limit
        assertTrue(hex(at.getValue(35)), near(0xFF3532, at.getValue(35))) // and beyond it
        // As colours, not only as numbers: nearly neutral, then warm and vivid, then a red.
        val (l1, c1, _) = CountColour.toOklch(at.getValue(1))
        val (_, c10, h10) = CountColour.toOklch(at.getValue(10))
        val (_, c20, h20) = CountColour.toOklch(at.getValue(20))
        val (l30, c30, h30) = CountColour.toOklch(at.getValue(30))
        assertTrue("warm white: L $l1, C $c1", l1 > 0.95 && c1 < 0.03)
        assertTrue("amber at 10: C $c10, h $h10", c10 > 0.08 && h10 in 76.0..86.0)
        assertTrue("orange at 20: C $c20, h $h20", c20 > 0.15 && h20 in 55.0..70.0)
        assertTrue("red at the limit: L $l30, C $c30, h $h30", c30 > 0.2 && h30 in 22.0..33.0 && l30 < 0.7)
    }

    @Test fun `the limit and everything past it is the same red`() {
        val red = CountColour.of(30, 30)
        for (count in 30..800) assertEquals("$count of 30", red, CountColour.of(count, 30))
        // A limit of 1 is reached by the first reel.
        assertEquals(CountColour.NEUTRAL, CountColour.of(0, 1))
        assertEquals(red, CountColour.of(1, 1))
        // Another limit moves the ramp: 15 of 30 and 250 of 500 are the same colour, near the middle.
        assertEquals(CountColour.of(16, 31), CountColour.of(251, 501))
    }

    @Test fun `with no limit set the count keeps the neutral colour`() {
        assertNull(CountColour.progress(12, 0))
        assertNull(CountColour.progress(12, -1))
        for (count in 0..200) {
            assertEquals("$count with no limit", CountColour.NEUTRAL, CountColour.of(count, 0))
            assertEquals(CountColour.NEUTRAL, CountColour.of(count, -5))
        }
        // The neutral colour is where the ramp starts: the first reel and none yet.
        assertEquals(CountColour.NEUTRAL, CountColour.of(1, 30))
        assertEquals(CountColour.NEUTRAL, CountColour.of(0, 30))
        assertTrue(hex(CountColour.NEUTRAL), near(0xF5F1E9, CountColour.NEUTRAL))
    }

    @Test fun `every step is at least 4 and a half to 1 on the pill's black, for any count and any limit`() {
        var worst = Double.MAX_VALUE
        for (limit in listOf(1, 2, 3, 5, 10, 30, 31, 100, 500)) {
            for (count in 0..800) {
                val colour = CountColour.of(count, limit)
                val contrast = CountColour.contrastOnBlack(colour)
                assertTrue("$count of $limit is ${hex(colour)}, only $contrast to 1", contrast >= 4.5)
                worst = minOf(worst, contrast)
            }
        }
        // The red is the darkest step and still has room: 5.8 to 1.
        assertTrue("worst step $worst to 1", worst >= 5.5)
        assertEquals(1.0, CountColour.contrastOnBlack(0xFF000000.toInt()), 1e-9)
        assertEquals(21.0, CountColour.contrastOnBlack(0xFFFFFFFF.toInt()), 1e-9)
    }

    @Test fun `going up the count only gets darker and redder, in small even steps`() {
        var previous = CountColour.toOklch(CountColour.of(1, 30))
        var biggest = 0.0
        for (count in 2..30) {
            val now = CountColour.toOklch(CountColour.of(count, 30))
            assertTrue("$count: lightness rose from ${previous.first} to ${now.first}", now.first <= previous.first + 0.002)
            assertTrue("$count: hue turned back from ${previous.third} to ${now.third}", now.third <= previous.third + 0.5)
            assertTrue("$count: chroma fell from ${previous.second} to ${now.second}", now.second >= previous.second - 0.002)
            // OKLab distance of this step: no jumps (0.02 is about the least a person sees).
            val a = previous.second * Math.cos(Math.toRadians(previous.third)) - now.second * Math.cos(Math.toRadians(now.third))
            val b = previous.second * Math.sin(Math.toRadians(previous.third)) - now.second * Math.sin(Math.toRadians(now.third))
            val step = Math.sqrt((previous.first - now.first).let { it * it } + a * a + b * b)
            biggest = maxOf(biggest, step)
            previous = now
        }
        assertTrue("biggest step $biggest", biggest < 0.045)
    }

    @Test fun `the ramp is interpolated in OKLCH, not in RGB`() {
        // Limit 5: count 4 is three quarters of the way, the middle of the amber to red stretch. The ramp there is
        // exactly halfway between the two stops in lightness, chroma and hue.
        val (l, c, h) = CountColour.oklchAt(0.75)
        assertEquals("lightness halfway between amber 0.84 and red 0.65", 0.745, l, 1e-9)
        assertEquals("chroma halfway between 0.165 and 0.24", 0.2025, c, 1e-9)
        assertEquals("hue halfway between amber 78 and red 27.5", 52.75, h, 1e-9)
        // The colour is that, with only its chroma lowered where sRGB cannot hold it.
        val mid = CountColour.of(4, 5)
        val (ml, mc, mh) = CountColour.toOklch(mid)
        assertEquals(l, ml, 0.01)
        assertEquals(h, mh, 1.5)
        assertTrue("chroma $mc is the most sRGB holds, not more than the ramp's $c", mc <= c + 0.005 && mc > 0.15)
        // The middle of the same two colours in RGB is another colour: redder, darker.
        val amber = CountColour.of(3, 5)
        val red = CountColour.of(5, 5)
        val rgbMid = listOf(16, 8, 0).map { ((amber shr it and 0xFF) + (red shr it and 0xFF)) / 2 }
        val (rl, _, rh) = CountColour.toOklch(0xFF000000.toInt() or (rgbMid[0] shl 16) or (rgbMid[1] shl 8) or rgbMid[2])
        assertTrue("RGB middle hue $rh, OKLCH middle hue $mh", abs(mh - rh) >= 8.0)
        assertTrue("RGB middle lightness $rl, OKLCH middle lightness $ml", abs(ml - rl) >= 0.015)
        val ours = listOf(16, 8, 0).map { mid shr it and 0xFF }
        assertTrue("RGB middle $rgbMid, OKLCH middle $ours", ours.zip(rgbMid).maxOf { (a, b) -> abs(a - b) } >= 10)
    }

    @Test fun `the OKLab maths agrees with the reference values`() {
        // Ottosson's published values for sRGB red and white.
        val (lr, cr, hr) = CountColour.toOklch(0xFFFF0000.toInt())
        assertEquals(0.62796, lr, 0.0005)
        assertEquals(Math.hypot(0.22486, 0.12585), cr, 0.0005)
        assertEquals(Math.toDegrees(Math.atan2(0.12585, 0.22486)), hr, 0.1)
        val (lw, cw, _) = CountColour.toOklch(0xFFFFFFFF.toInt())
        assertEquals(1.0, lw, 0.0005)
        assertEquals(0.0, cw, 0.0005)
        // The ramp's first stop, asked for directly, is the warm white.
        val (l0, c0, h0) = CountColour.oklchAt(0.0)
        assertEquals(0.96, l0, 1e-9)
        assertEquals(0.012, c0, 1e-9)
        assertEquals(85.0, h0, 1e-9)
        assertEquals(27.5, CountColour.oklchAt(1.0).third, 1e-9)
    }
}
