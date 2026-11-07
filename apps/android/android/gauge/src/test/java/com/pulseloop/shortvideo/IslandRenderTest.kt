package com.pulseloop.shortvideo

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import com.pulseloop.shortvideo.IslandGeometry.Cutout
import java.io.File
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The real pill ([IslandView], sized by [IslandGeometry]) drawn over a mock of the owner's phone (OnePlus Nord 4,
 * 1240 x 2772 at 540 dpi) and of the other cutout shapes, as PNGs under build/outputs/island for review
 * (vitals-research/r071/shots/pill keeps a copy). The picture is measured, not only the arithmetic: the pill's black
 * against the status bar, and the count's own pixels for its colour, its place and its contrast. Synthetic data only.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w367dp-h821dp-540dpi")
class IslandRenderTest {
    private val out = File("build/outputs/island").apply { mkdirs() }
    private val density get() = RuntimeEnvironment.getApplication().resources.displayMetrics.density

    /** The owner's phone: a 79 px camera hole inside a top cutout rect as tall as the 139 px status bar. */
    private fun nord4() = IslandScreen(1240, 2772, 139, Cutout(580, 0, 659, 139), density)

    /** The status bar (dark, with a clock, notification icons, signal and battery), video below, the camera hole. */
    private fun phone(screen: IslandScreen, rows: Int): Bitmap {
        val bmp = Bitmap.createBitmap(screen.width, rows, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.shader = LinearGradient(0f, 0f, 0f, rows.toFloat(), 0xFF9A9A9A.toInt(), 0xFF5A5A5A.toInt(), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, screen.width.toFloat(), rows.toFloat(), p)
        p.shader = null
        val bar = screen.statusBarHeight.toFloat()
        p.color = 0xFF0D1318.toInt()
        c.drawRect(0f, 0f, screen.width.toFloat(), bar, p)
        val mid = bar / 2
        p.color = Color.WHITE
        p.textSize = bar * 0.32f
        c.drawText("17:23", screen.width * 0.05f, mid + p.textSize / 3, p)
        p.color = 0xFFD0D0D0.toInt()
        val icon = bar * 0.3f
        for (i in 0 until 3) {
            val left = screen.width * 0.25f + i * icon * 1.5f
            c.drawRoundRect(RectF(left, mid - icon, left + icon * 2, mid + icon), icon / 3, icon / 3, p)
        }
        c.drawText("64%", screen.width * 0.86f, mid + p.textSize / 3, p)
        for (i in 0 until 4) {
            val left = screen.width * 0.68f + i * icon * 0.7f
            c.drawRect(left, mid + icon - (i + 1) * icon * 0.5f, left + icon * 0.45f, mid + icon, p)
        }
        screen.topCutout?.let {
            p.color = Color.BLACK
            c.drawCircle(it.centerX.toFloat(), it.centerY.toFloat(), minOf(it.width, it.height) / 2f, p)
        }
        return bmp
    }

    private class Drawn(val bitmap: Bitmap, val geometry: IslandGeometry, val view: IslandView)

    /** The pill showing [count] of [limit] (rolling in from [from], [progress] of the way), laid out as its window is. */
    private fun draw(screen: IslandScreen, count: Int, limit: Int = 30, rows: Int = 420, from: Int? = null, progress: Float = 1f): Drawn {
        val context = RuntimeEnvironment.getApplication()
        val geometry = IslandGeometry.of(screen)
        val view = IslandView(context, geometry)
        view.update(count, limit, animate = false)
        if (from != null) view.rollFrom(from, progress)
        view.measure(
            View.MeasureSpec.makeMeasureSpec(view.windowWidth, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(view.windowHeight, View.MeasureSpec.EXACTLY),
        )
        view.layout(0, 0, view.windowWidth, view.windowHeight)
        val bitmap = phone(screen, rows)
        val canvas = Canvas(bitmap)
        canvas.translate(geometry.left(view.windowWidth).toFloat(), geometry.top.toFloat())
        view.draw(canvas)
        return Drawn(bitmap, geometry, view)
    }

    private fun save(name: String, bitmap: Bitmap, rows: Int = bitmap.height) =
        File(out, "$name.png").outputStream().use { Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, rows).compress(Bitmap.CompressFormat.PNG, 100, it) }

    /** The pill's black in the picture: the status bar, the video and the icons are not pure black, the pill is. */
    private data class Black(val left: Int, val right: Int, val top: Int, val bottom: Int) {
        val width get() = right - left + 1
        val height get() = bottom - top + 1
    }

    private fun black(bitmap: Bitmap, g: IslandGeometry): Black {
        fun isBlack(x: Int, y: Int) = bitmap.getPixel(x, y) and 0xFFFFFF == 0
        val reach = g.maxWidth / 2 + 4
        val xs = (maxOf(0, g.centerX - reach)..minOf(bitmap.width - 1, g.centerX + reach)).filter { isBlack(it, g.centerY) }
        val ys = (0 until bitmap.height).filter { isBlack(g.centerX, it) }
        return Black(xs.min(), xs.max(), ys.min(), ys.max())
    }

    /** The view alone on a transparent bitmap the size of its window: the pill is the only opaque black. */
    private fun aloneBitmap(view: IslandView): Bitmap {
        val bmp = Bitmap.createBitmap(view.windowWidth, view.windowHeight, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bmp))
        return bmp
    }

    private class Overflow(val pixels: Int, val clipped: Boolean)

    /**
     * How many pixels the view draws outside its own black pill (the count or the brain hanging out of it), and
     * whether its window is too narrow for the pill (the pill touches the window's left or right edge).
     */
    private fun overflowOf(view: IslandView): Overflow {
        val bmp = aloneBitmap(view)
        val solid = (0 until bmp.height).flatMap { y -> (0 until bmp.width).filter { x -> bmp.getPixel(x, y) == Color.BLACK }.map { x -> x to y } }
        val left = solid.minOf { it.first }
        val right = solid.maxOf { it.first }
        val top = solid.minOf { it.second }
        val bottom = solid.maxOf { it.second }
        var pixels = 0
        for (y in 0 until bmp.height) for (x in 0 until bmp.width) {
            // One pixel of slack for the pill's own anti-aliased edge.
            if (Color.alpha(bmp.getPixel(x, y)) > 0 && (x < left - 1 || x > right + 1 || y < top - 1 || y > bottom + 1)) pixels++
        }
        return Overflow(pixels, left <= 0 || right >= bmp.width - 1)
    }

    /**
     * The count's own pixels, on its side of the hole: the brightest is the text colour itself (the middle of a
     * stroke), the ink is everything at least half as bright.
     */
    private class Ink(val top: Int, val bottom: Int, val left: Int, val right: Int, val colour: Int) {
        val height get() = bottom - top + 1
        val centreY get() = (top + bottom) / 2.0
    }

    private fun inkOf(view: IslandView): Ink {
        val bmp = aloneBitmap(view)
        val from = bmp.width / 2 + view.geometry.holeWidth / 2
        fun luminance(p: Int) = 0.2126 * (p shr 16 and 0xFF) + 0.7152 * (p shr 8 and 0xFF) + 0.0722 * (p and 0xFF)
        val solid = (0 until bmp.height).flatMap { y -> (from until bmp.width).map { x -> x to y } }.filter { (x, y) -> bmp.getPixel(x, y) ushr 24 == 0xFF }
        val brightest = solid.maxBy { (x, y) -> luminance(bmp.getPixel(x, y)) }
        val ink = solid.filter { (x, y) -> luminance(bmp.getPixel(x, y)) >= luminance(bmp.getPixel(brightest.first, brightest.second)) / 2 }
        return Ink(ink.minOf { it.second }, ink.maxOf { it.second }, ink.minOf { it.first }, ink.maxOf { it.first }, bmp.getPixel(brightest.first, brightest.second) or (0xFF shl 24))
    }

    private fun near(expected: Int, actual: Int, by: Int = 2) = listOf(16, 8, 0).all { abs((expected shr it and 0xFF) - (actual shr it and 0xFF)) <= by }

    @Test fun ownersPhoneAtOneTenTwentyThirtyAndThirtyFiveOfThirty() {
        val screen = nord4()
        var reference: Black? = null
        for (count in listOf(1, 10, 20, 30, 35)) {
            val shot = draw(screen, count)
            val g = shot.geometry
            val b = black(shot.bitmap, g)
            val ink = inkOf(shot.view)
            val expected = CountColour.of(count, 30)
            println("ISLAND owner $count of 30: pill ${b.width}x${b.height} at x ${b.left}..${b.right}, y ${b.top}..${b.bottom}; bar ${screen.statusBarHeight}; count #%06X, %.2f to 1".format(ink.colour and 0xFFFFFF, CountColour.contrastOnBlack(ink.colour)))
            // Inside the status bar, centred on the hole, narrower than before (the old pill was 362 to 399 px wide).
            assertTrue("$count: ends at ${b.bottom}, the bar at ${screen.statusBarHeight - 1}", b.bottom <= screen.statusBarHeight - 1)
            assertTrue("$count: starts at ${b.top}", b.top >= 0)
            assertTrue("$count: ${b.width} px wide", b.width <= g.maxWidth && b.width < 362)
            assertEquals("$count: centred", g.centerX.toDouble(), (b.left + b.right) / 2.0, 2.0)
            assertTrue("$count: round the 79 px hole", b.height >= 79 && b.width >= 79)
            // Always the same pill, whatever the count.
            assertEquals("$count: the pill's size", reference ?: b, b)
            reference = b
            // The count: its colour from the ramp, readable on the black, on one line in the middle of the pill.
            assertTrue("$count: drawn #%06X, the ramp says #%06X".format(ink.colour and 0xFFFFFF, expected and 0xFFFFFF), near(expected, ink.colour))
            assertTrue("$count: ${CountColour.contrastOnBlack(ink.colour)} to 1", CountColour.contrastOnBlack(ink.colour) >= 4.5)
            assertEquals("$count: centred in the pill", shot.view.windowHeight / 2.0, ink.centreY, 3.0)
            assertEquals("$count: nothing outside the pill", 0, overflowOf(shot.view).pixels)
            save("owner-count-%02d-top".format(count), shot.bitmap, 300)
        }
        // The whole screen at the phone's real size.
        save("owner-frame", draw(screen, 10, rows = screen.height).bitmap)
    }

    @Test fun theNumberRollsInPlaceAndThePillStaysTheSame() {
        val screen = nord4()
        for ((from, to) in listOf(9 to 10, 29 to 30, 99 to 100)) {
            val settled = black(draw(screen, to).bitmap, IslandGeometry.of(screen))
            for (step in 0..10) {
                val progress = step / 10f
                val shot = draw(screen, to, from = from, progress = progress)
                val b = black(shot.bitmap, shot.geometry)
                assertEquals("$from to $to at $progress: the pill's size", settled, b)
                val overflow = overflowOf(shot.view)
                assertEquals("$from to $to at $progress: drawn outside the pill", 0, overflow.pixels)
                assertFalse("$from to $to at $progress: the window is too narrow", overflow.clipped)
            }
        }
        save("owner-roll-top", draw(screen, 10, from = 9, progress = 0.5f).bitmap, 300)
    }

    @Test fun theSizeNeverChangesWithTheDigitsAndTheLargestFontStillFits() {
        for (font in listOf(1f, 1.3f, 2f)) {
            RuntimeEnvironment.setFontScale(font)
            var reference: Black? = null
            var tallest = 0
            for (count in listOf(0, 1, 9, 10, 99, 100, 128, 1042)) {
                val shot = draw(nord4(), count)
                val g = shot.geometry
                val b = black(shot.bitmap, g)
                val ink = inkOf(shot.view)
                val note = "font $font, $count"
                assertTrue("$note: ends at ${b.bottom}", b.bottom <= 138)
                assertTrue("$note: ${b.width} px wide", b.width <= g.maxWidth)
                assertEquals("$note: centred", g.centerX.toDouble(), (b.left + b.right) / 2.0, 2.0)
                assertEquals("$note: the pill's size", reference ?: b, b)
                reference = b
                val overflow = overflowOf(shot.view)
                assertEquals("$note: drawn outside the pill", 0, overflow.pixels)
                assertFalse("$note: the window is too narrow for the pill", overflow.clipped)
                assertTrue("$note: ${CountColour.contrastOnBlack(ink.colour)} to 1", CountColour.contrastOnBlack(ink.colour) >= 4.5)
                // More digits are drawn smaller to fit the same column, never taller.
                if (count in 10..99) tallest = maxOf(tallest, ink.height)
                if (count >= 100) assertTrue("$note: ${ink.height} px tall against $tallest", ink.height <= tallest)
                if (count == 1042) save("owner-font-$font-1042-top", shot.bitmap, 300)
            }
        }
    }

    @Test fun otherCutoutShapes() {
        // A typical 1080 x 2400 phone at 420 dpi: a round hole in the middle (a Pixel's), a notch, a hole in the
        // corner, and a 1080 x 1920 phone with no cutout at all.
        RuntimeEnvironment.setQualifiers("w411dp-h914dp-420dpi")
        val d = density
        val shapes = linkedMapOf(
            "centred-hole" to IslandScreen(1080, 2400, 98, Cutout(502, 28, 578, 104), d),
            "notch" to IslandScreen(1080, 2340, 96, Cutout(380, 0, 700, 84), d),
            "corner-hole" to IslandScreen(1080, 2280, 80, Cutout(910, 20, 1000, 105), d),
            "none" to IslandScreen(1080, 1920, 63, null, d),
        )
        for ((name, screen) in shapes) {
            val shot = draw(screen, 10, rows = 240)
            val g = shot.geometry
            val b = black(shot.bitmap, g)
            println("ISLAND $name: pill ${b.width}x${b.height} y ${b.top}..${b.bottom}; bar ${screen.statusBarHeight}; $g")
            assertEquals("$name: centred", g.centerX.toDouble(), (b.left + b.right) / 2.0, 2.0)
            assertTrue("$name: ${b.width} px wide", b.width <= g.maxWidth)
            // (a notch is taller than the bar: the top of the pill is above the screen)
            if (g.top >= 0) assertEquals("$name: ${b.height} px tall", g.height, b.height)
            // Without a hole to wrap the pill is wholly inside the status bar.
            if (g.holeWidth == 0) assertTrue("$name: ends at ${b.bottom}", b.bottom < screen.statusBarHeight)
            val overflow = overflowOf(shot.view)
            assertEquals("$name: drawn outside the pill", 0, overflow.pixels)
            assertFalse("$name: the window is too narrow for the pill", overflow.clipped)
            save("shape-$name", shot.bitmap)
        }
    }

    @Test fun theColourRampOneToThirtyFiveReadsOnTheBlackPill() {
        val screen = nord4()
        val lines = mutableListOf<String>()
        var reference: Black? = null
        var previous: Int? = null
        for (count in 1..35) {
            val shot = draw(screen, count)
            val b = black(shot.bitmap, shot.geometry)
            val ink = inkOf(shot.view)
            val contrast = CountColour.contrastOnBlack(ink.colour)
            assertEquals("$count: the pill's size", reference ?: b, b)
            reference = b
            assertTrue("$count: drawn #%06X, the ramp says #%06X".format(ink.colour and 0xFFFFFF, CountColour.of(count, 30) and 0xFFFFFF), near(CountColour.of(count, 30), ink.colour))
            assertTrue("$count: $contrast to 1", contrast >= 4.5)
            // Each step is a different colour until the limit, then the same red.
            if (previous != null && count <= 30) assertTrue("$count: the same colour as ${count - 1}", ink.colour != previous)
            previous = ink.colour
            lines += "$count #%06X %.2f".format(ink.colour and 0xFFFFFF, contrast)
            save("ramp-%02d".format(count), Bitmap.createBitmap(shot.bitmap, shot.geometry.centerX - 200, 0, 400, screen.statusBarHeight))
        }
        File(out, "colour-ramp.txt").writeText(lines.joinToString("\n") + "\n")
    }
}
