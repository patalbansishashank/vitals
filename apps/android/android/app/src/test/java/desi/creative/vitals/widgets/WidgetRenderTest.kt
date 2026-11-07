package desi.creative.vitals.widgets

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import desi.creative.vitals.R
import desi.creative.vitals.widgets.WidgetSamples.MIN
import desi.creative.vitals.widgets.WidgetSamples.now
import desi.creative.vitals.widgets.WidgetSamples.zone
import java.io.File
import java.io.FileOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.roundToInt

/**
 * Every widget's RemoteViews applies (framework views only), reads right and fits, at the sizes a launcher gives it and at
 * a large system font; each state is also drawn to a PNG under build/outputs/widgets for review (the render is the review
 * artefact: nothing runs on a launcher here). Synthetic data only (the shared fixtures).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class WidgetRenderTest {
    private val ctx: Context = RuntimeEnvironment.getApplication()
    private val out = File("build/outputs/widgets").apply { mkdirs() }

    private companion object {
        init {
            // the renders kept from a failing check are the last run's alone (once per run, not per test)
            File("build/outputs/widgets").listFiles { f -> f.name.startsWith("failed-") }?.forEach { it.delete() }
        }
    }
    private val digit = Regex("""\d""")

    /** The sizes a launcher gives: a 2x2 as a square and as a tall cell, a 4x2 on a 5-column and on a 4-column grid, a 4x1, a 1x1. */
    private val square = WidgetSize(172, 172)
    private val tall = WidgetSize(130, 220)
    private val wide = WidgetSize(352, 172)
    private val wideTall = WidgetSize(276, 220)

    private fun context(fontScale: Float): Context =
        if (fontScale == 1f) ctx else ctx.createConfigurationContext(Configuration(ctx.resources.configuration).apply { this.fontScale = fontScale })

    private fun inflate(kind: VitalsWidgets.Kind, snapshot: WidgetSnapshot?, size: WidgetSize, fontScale: Float = 1f): View {
        val c = context(fontScale)
        val rv = VitalsWidgets.views(c, kind, snapshot, now, zone, size)
        val v = rv.apply(c, FrameLayout(c))
        val d = c.resources.displayMetrics.density
        val w = (size.widthDp * d).roundToInt()
        val h = (size.heightDp * d).roundToInt()
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, w, h)
        return v
    }

    /** Draw on a dim wallpaper-like ground with a margin, the way a launcher shows it. */
    private fun save(name: String, v: View) {
        val pad = (12 * ctx.resources.displayMetrics.density).roundToInt()
        val bmp = Bitmap.createBitmap(v.width + 2 * pad, v.height + 2 * pad, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint().apply { shader = LinearGradient(0f, 0f, bmp.width.toFloat(), bmp.height.toFloat(), Color.rgb(0x3A, 0x41, 0x4A), Color.rgb(0x22, 0x26, 0x2C), Shader.TileMode.CLAMP) }
        c.drawRect(0f, 0f, bmp.width.toFloat(), bmp.height.toFloat(), p)
        c.translate(pad.toFloat(), pad.toFloat())
        v.draw(c)
        FileOutputStream(File(out, "$name.png")).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun visible(v: View): Boolean {
        var p: View? = v
        while (p != null) {
            if (p.visibility != View.VISIBLE) return false
            p = p.parent as? View
        }
        return true
    }

    private fun texts(v: View): List<String> = when {
        v.visibility != View.VISIBLE -> emptyList()
        v is TextView -> listOf(v.text.toString())
        v is ViewGroup -> (0 until v.childCount).flatMap { texts(v.getChildAt(it)) }
        else -> emptyList()
    }

    private fun descriptions(v: View): List<String> =
        listOfNotNull(v.contentDescription?.toString()) + ((v as? ViewGroup)?.let { g -> (0 until g.childCount).flatMap { descriptions(g.getChildAt(it)) } } ?: emptyList())

    private fun View.text(id: Int): String = findViewById<TextView>(id).text.toString()
    private fun View.shown(id: Int): Boolean = findViewById<View>(id)?.let { visible(it) } == true

    /** Every visible text lies wholly inside the widget, is not squeezed and is not cut with an ellipsis (nothing clipped at this size). */
    private fun assertNothingClipped(root: View, label: String) {
        try {
            checkNothingClipped(root, label)
        } catch (e: AssertionError) {
            // a failing render is kept to look at: build/outputs/widgets/failed-<label>.png
            save("failed-" + label.replace(Regex("[^A-Za-z0-9.-]+"), "-"), root)
            throw e
        }
    }

    private fun checkNothingClipped(root: View, label: String) {
        fun walk(v: View) {
            if (v.visibility != View.VISIBLE) return
            if (v is TextView && v.text.isNotEmpty()) {
                val l = v.layout
                assertNotNull("$label: '${v.text}' has no layout", l)
                val needed = l.height + v.compoundPaddingTop + v.compoundPaddingBottom
                assertTrue("$label: '${v.text}' is squeezed ($needed > ${v.height})", needed <= v.height)
                // a card's name may end in an ellipsis in a narrow widget at a large system font; no figure, word or range may
                if (v.id != R.id.vw_title) for (line in 0 until l.lineCount) assertEquals("$label: '${v.text}' is cut with an ellipsis", 0, l.getEllipsisCount(line))
                // no line is wider than its view (a figure clipped at its edge) and no text is dropped by a line limit
                val avail = v.width - v.compoundPaddingLeft - v.compoundPaddingRight
                for (line in 0 until l.lineCount) assertTrue("$label: '${v.text}' line $line is ${l.getLineMax(line)} px in a view of $avail", l.getLineMax(line) <= avail + 1f)
                assertEquals("$label: '${v.text}' is cut by a line limit", v.text.length, l.getLineEnd(l.lineCount - 1))
                var x = v.left
                var y = v.top
                var p = v.parent as? View
                while (p != null && p !== root.parent) {
                    x += p.left
                    y += p.top
                    p = p.parent as? View
                }
                // inside the widget (positions are summed up to the root, whose own offset is zero)
                assertTrue("$label: '${v.text}' leaves the widget", x >= 0 && y >= 0)
            }
            if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
        }
        walk(root)
    }

    private fun assertQuietClean(v: View, label: String) {
        for (t in texts(v)) assertFalse("$label: quiet shows no digit in '$t'", digit.containsMatchIn(t))
        for (t in descriptions(v)) assertFalse("$label: quiet shows no digit in the spoken '$t'", digit.containsMatchIn(t))
    }

    // ------------------------------------------------------------------------------------------------- the cards

    @Test
    fun energy() {
        val sq = inflate(VitalsWidgets.Kind.ENERGY, WidgetSamples.numbers(), square)
        assertEquals("1 096", sq.text(R.id.vw_hero))
        assertEquals("kcal", sq.text(R.id.vw_unit))
        assertEquals("On plan", sq.text(R.id.vw_state))
        assertEquals("983–1 209", sq.text(R.id.vw_range))
        assertTrue("the ring", sq.shown(R.id.vw_viz))
        assertFalse(sq.shown(R.id.vw_asof))
        assertNothingClipped(sq, "energy 2x2")
        save("energy-2x2", sq)
        save("energy-2x2-tall", inflate(VitalsWidgets.Kind.ENERGY, WidgetSamples.numbers(), tall))
        val w = inflate(VitalsWidgets.Kind.ENERGY, WidgetSamples.numbers(), wide)
        assertEquals("of 2 595 today", w.text(R.id.vw_meta))
        assertTrue("the line", w.shown(R.id.vw_viz))
        assertEquals("the estimate keeps its range", "983–1 209", w.text(R.id.vw_range))
        assertNothingClipped(w, "energy 4x2")
        save("energy-4x2", w)
        save("energy-4x2-tall", inflate(VitalsWidgets.Kind.ENERGY, WidgetSamples.numbers(), wideTall))
        val q = inflate(VitalsWidgets.Kind.ENERGY, WidgetSamples.quiet(), square)
        assertEquals(WidgetFormat.Words.QUIET_ON, q.text(R.id.vw_note))
        assertFalse(q.shown(R.id.vw_viz))
        assertFalse(q.shown(R.id.vw_hero))
        assertQuietClean(q, "energy quiet")
        save("energy-quiet", q)
    }

    @Test
    fun sleep() {
        val sq = inflate(VitalsWidgets.Kind.SLEEP, WidgetSamples.numbers(), square)
        assertEquals("7 h 56", sq.text(R.id.vw_hero))
        assertEquals("Goal met", sq.text(R.id.vw_state))
        assertEquals("7 h 30", sq.text(R.id.vw_range))
        assertNothingClipped(sq, "sleep 2x2")
        save("sleep-2x2", sq)
        save("sleep-2x2-tall", inflate(VitalsWidgets.Kind.SLEEP, WidgetSamples.numbers(), tall))
        val w = inflate(VitalsWidgets.Kind.SLEEP, WidgetSamples.numbers(), wide)
        assertEquals("23:14 – 07:37", w.text(R.id.vw_meta))
        assertTrue("the night", w.shown(R.id.vw_viz))
        assertNothingClipped(w, "sleep 4x2")
        save("sleep-4x2", w)
        save("sleep-4x2-tall", inflate(VitalsWidgets.Kind.SLEEP, WidgetSamples.numbers(), wideTall))
        val q = inflate(VitalsWidgets.Kind.SLEEP, WidgetSamples.quiet(), square)
        assertEquals("Goal met", q.text(R.id.vw_word))
        assertFalse(q.shown(R.id.vw_hero))
        assertTrue(q.shown(R.id.vw_viz))
        assertQuietClean(q, "sleep quiet 2x2")
        save("sleep-quiet-2x2", q)
        val qw = inflate(VitalsWidgets.Kind.SLEEP, WidgetSamples.quiet(), wide)
        assertEquals("late evening\nto early morning", qw.text(R.id.vw_meta))
        assertTrue("the hypnogram stays in quiet mode", qw.shown(R.id.vw_viz))
        assertNothingClipped(qw, "sleep quiet 4x2")
        assertQuietClean(qw, "sleep quiet 4x2")
        save("sleep-quiet-4x2", qw)
    }

    @Test
    fun steps() {
        val sq = inflate(VitalsWidgets.Kind.STEPS, WidgetSamples.numbers(), square)
        assertEquals("7 605", sq.text(R.id.vw_hero))
        assertEquals("steps", sq.text(R.id.vw_unit))
        assertEquals("On course", sq.text(R.id.vw_state))
        assertEquals("of 9 000", sq.text(R.id.vw_range))
        assertNothingClipped(sq, "steps 2x2")
        save("steps-2x2", sq)
        save("steps-2x2-tall", inflate(VitalsWidgets.Kind.STEPS, WidgetSamples.numbers(), tall))
        val w = inflate(VitalsWidgets.Kind.STEPS, WidgetSamples.numbers(), wide)
        assertEquals("likely 12 878", w.text(R.id.vw_meta))
        assertTrue("the hours", w.shown(R.id.vw_viz))
        assertNothingClipped(w, "steps 4x2")
        save("steps-4x2", w)
        save("steps-4x2-tall", inflate(VitalsWidgets.Kind.STEPS, WidgetSamples.numbers(), wideTall))
        val q = inflate(VitalsWidgets.Kind.STEPS, WidgetSamples.quiet(), square)
        assertEquals("Over half of the goal", q.text(R.id.vw_word))
        assertTrue(q.shown(R.id.vw_viz))
        assertQuietClean(q, "steps quiet")
        assertNothingClipped(q, "steps quiet")
        save("steps-quiet", q)
    }

    @Test
    fun heartRate() {
        val sq = inflate(VitalsWidgets.Kind.RING, WidgetSamples.numbers(), square)
        assertEquals("79", sq.text(R.id.vw_hero))
        assertEquals("bpm", sq.text(R.id.vw_unit))
        assertEquals("Normal", sq.text(R.id.vw_state))
        assertEquals("50–90", sq.text(R.id.vw_range))
        assertEquals("at 13:16", sq.text(R.id.vw_meta))
        assertTrue("the day's line", sq.shown(R.id.vw_viz))
        assertNothingClipped(sq, "heart 2x2")
        save("ring-2x2", sq)
        save("ring-2x2-tall", inflate(VitalsWidgets.Kind.RING, WidgetSamples.numbers(), tall))
        val w = inflate(VitalsWidgets.Kind.RING, WidgetSamples.numbers(), wide)
        assertEquals("at 13:16 · Ring 64 %", w.text(R.id.vw_meta))
        assertNothingClipped(w, "heart 4x2")
        save("ring-4x2", w)
        val stale = inflate(VitalsWidgets.Kind.RING, WidgetSamples.numbers(at = now - 70 * MIN), square)
        assertEquals("as of 12:10", stale.text(R.id.vw_asof))
        save("ring-stale", stale)
        val q = inflate(VitalsWidgets.Kind.RING, WidgetSamples.quiet(), square)
        assertEquals("Measured recently", q.text(R.id.vw_word))
        assertFalse(q.shown(R.id.vw_viz))
        assertQuietClean(q, "heart quiet")
        save("ring-quiet", q)
        val unpaired = inflate(VitalsWidgets.Kind.RING, WidgetSamples.numbers().copy(ring = WidgetSnapshot.RingPart("unpaired", null, null, null)), square)
        assertEquals(WidgetFormat.Words.UNPAIRED, unpaired.text(R.id.vw_note))
        assertNothingClipped(unpaired, "heart unpaired")
        save("ring-unpaired", unpaired)
    }

    @Test
    fun weight() {
        val off = inflate(VitalsWidgets.Kind.WEIGHT, WidgetSamples.numbers().copy(body = null), square)
        assertEquals(WidgetFormat.Words.WEIGHT_OFF, off.text(R.id.vw_note))
        assertNothingClipped(off, "weight off")
        save("weight-off", off)
        val sq = inflate(VitalsWidgets.Kind.WEIGHT, WidgetSamples.numbers(), square)
        assertEquals("85.2", sq.text(R.id.vw_hero))
        assertEquals("kg", sq.text(R.id.vw_unit))
        assertEquals("On track", sq.text(R.id.vw_state))
        assertTrue(sq.shown(R.id.vw_viz))
        assertNothingClipped(sq, "weight 2x2")
        save("weight-2x2", sq)
        save("weight-4x2", inflate(VitalsWidgets.Kind.WEIGHT, WidgetSamples.numbers(), wide))
        val q = inflate(VitalsWidgets.Kind.WEIGHT, WidgetSamples.quiet(), square)
        assertEquals("On track", q.text(R.id.vw_word))
        assertQuietClean(q, "weight quiet")
        save("weight-quiet", q)
    }

    // ------------------------------------------------------------------------------------------------- the glance and the keys

    @Test
    fun todayGlance() {
        val v = inflate(VitalsWidgets.Kind.TODAY, WidgetSamples.numbers(), wide)
        assertEquals("Today", v.text(R.id.vw_title))
        assertEquals("Wed 28 Oct", v.text(R.id.vw_day))
        assertEquals("7 605", v.text(R.id.vw_hero1))
        assertEquals("1 096", v.text(R.id.vw_hero2))
        assertEquals("7 h 56", v.text(R.id.vw_hero3))
        assertEquals(listOf("Steps", "Energy", "Sleep"), listOf(v.text(R.id.vw_label1), v.text(R.id.vw_label2), v.text(R.id.vw_label3)))
        for (id in intArrayOf(R.id.vw_cell1, R.id.vw_cell2, R.id.vw_cell3)) assertTrue("each ring is its own tap", v.findViewById<View>(id).hasOnClickListeners())
        assertTrue("the card opens Today", v.hasOnClickListeners())
        assertNothingClipped(v, "today")
        save("today", v)
        save("today-tall", inflate(VitalsWidgets.Kind.TODAY, WidgetSamples.numbers(), wideTall))
        val stale = inflate(VitalsWidgets.Kind.TODAY, WidgetSamples.numbers(at = now - 70 * MIN), wide)
        assertEquals("as of 12:10", stale.text(R.id.vw_asof))
        save("today-stale", stale)
        val q = inflate(VitalsWidgets.Kind.TODAY, WidgetSamples.quiet(), wide)
        assertFalse("no energy in quiet mode: two rings", q.shown(R.id.vw_cell3))
        assertEquals("Over half of the goal", q.text(R.id.vw_word1))
        assertEquals("Goal met", q.text(R.id.vw_word2))
        assertEquals("Wed", q.text(R.id.vw_day))
        assertQuietClean(q, "today quiet")
        assertNothingClipped(q, "today quiet")
        save("today-quiet", q)
        val newDay = inflate(VitalsWidgets.Kind.TODAY, WidgetSamples.numbers(at = now - 15 * 60 * MIN, date = "2026-10-27"), wide)
        assertEquals(WidgetFormat.Words.NEW_DAY, newDay.text(R.id.vw_note))
        assertFalse(newDay.shown(R.id.vw_cells))
        save("today-new-day", newDay)
        val empty = inflate(VitalsWidgets.Kind.TODAY, null, wide)
        assertEquals(WidgetFormat.Words.FIRST_OPEN, empty.text(R.id.vw_note))
        assertNothingClipped(empty, "today empty")
        save("today-empty", empty)
    }

    @Test
    fun keys() {
        val a = inflate(VitalsWidgets.Kind.ACTIONS, null, WidgetSize(352, 76))
        assertTrue(a.findViewById<View>(R.id.vw_key_log).hasOnClickListeners())
        assertTrue(a.findViewById<View>(R.id.vw_key_record).hasOnClickListeners())
        assertEquals(listOf("Log", "Record"), texts(a))
        assertEquals(listOf("Log an activity", "Record"), descriptions(a))
        save("actions", a)
        val l = inflate(VitalsWidgets.Kind.LOG, null, WidgetSize(76, 76))
        assertTrue(l.hasOnClickListeners())
        assertEquals(listOf("Log an activity"), descriptions(l))
        assertEquals("one round key and no label", emptyList<String>(), texts(l))
        save("log", l)
    }

    // ------------------------------------------------------------------------------------------------- every widget, everywhere

    @Test
    fun everythingFitsAtALargeSystemFont() {
        val kinds = listOf(VitalsWidgets.Kind.ENERGY, VitalsWidgets.Kind.SLEEP, VitalsWidgets.Kind.STEPS, VitalsWidgets.Kind.RING, VitalsWidgets.Kind.WEIGHT, VitalsWidgets.Kind.TODAY)
        for (kind in kinds) {
            // the Today glance is never narrower than 250 dp (its provider's minimum)
            for (size in (if (kind == VitalsWidgets.Kind.TODAY) listOf(wide, wideTall) else listOf(square, tall, wide, wideTall))) {
                val v = inflate(kind, WidgetSamples.numbers(), size, fontScale = 1.3f)
                assertNothingClipped(v, "${kind.card} ${size.widthDp}x${size.heightDp} at font scale 1.3")
                if (kind == VitalsWidgets.Kind.ENERGY && size == square) save("energy-2x2-font13", v)
                if (kind == VitalsWidgets.Kind.TODAY && size == wide) save("today-font13", v)
            }
        }
    }

    @Test
    fun smallWidgetsKeepTheirFiguresInsideTheirRings() {
        // a launcher's 2x2 can be as small as the provider's minimum (110 dp); a figure, a word or a range never leaves its place
        val small = listOf(WidgetSize(110, 110), WidgetSize(130, 130), WidgetSize(146, 146))
        val figures = listOf(WidgetSamples.numbers(), WidgetSamples.quiet())
        for (kind in listOf(VitalsWidgets.Kind.ENERGY, VitalsWidgets.Kind.SLEEP, VitalsWidgets.Kind.STEPS, VitalsWidgets.Kind.RING, VitalsWidgets.Kind.WEIGHT)) {
            for (size in small) for (scale in listOf(1f, 1.3f)) for (snap in figures) {
                val v = inflate(kind, snap, size, scale)
                assertNothingClipped(v, "${kind.card} ${size.widthDp}x${size.heightDp} font $scale ${if (snap.quiet) "quiet" else "numbers"}")
            }
        }
        // a 4x2 at its minimum height, the glance included
        for (size in listOf(WidgetSize(250, 110), WidgetSize(300, 130))) {
            for (scale in listOf(1f, 1.3f)) for (snap in figures) {
                assertNothingClipped(inflate(VitalsWidgets.Kind.TODAY, snap, size, scale), "today ${size.widthDp}x${size.heightDp} font $scale")
                for (kind in listOf(VitalsWidgets.Kind.ENERGY, VitalsWidgets.Kind.SLEEP, VitalsWidgets.Kind.STEPS, VitalsWidgets.Kind.RING, VitalsWidgets.Kind.WEIGHT)) {
                    assertNothingClipped(inflate(kind, snap, size, scale), "${kind.card} ${size.widthDp}x${size.heightDp} font $scale")
                }
            }
        }
        save("energy-110", inflate(VitalsWidgets.Kind.ENERGY, WidgetSamples.numbers(), WidgetSize(110, 110)))
        save("energy-quiet-110-font13", inflate(VitalsWidgets.Kind.ENERGY, WidgetSamples.quiet(), WidgetSize(110, 110), 1.3f))
        save("steps-quiet-130", inflate(VitalsWidgets.Kind.STEPS, WidgetSamples.quiet(), WidgetSize(130, 130)))
        save("today-250x110", inflate(VitalsWidgets.Kind.TODAY, WidgetSamples.numbers(), WidgetSize(250, 110)))
    }

    @Test
    fun aLargeSystemFontKeepsTheFiguresInsideTheRingsOfARealLauncher() {
        for (kind in listOf(VitalsWidgets.Kind.ENERGY, VitalsWidgets.Kind.SLEEP, VitalsWidgets.Kind.STEPS)) {
            for (size in listOf(WidgetSize(130, 130), WidgetSize(146, 146), square, tall)) for (snap in listOf(WidgetSamples.numbers(), WidgetSamples.quiet())) {
                assertNothingClipped(inflate(kind, snap, size, 2f), "${kind.card} ${size.widthDp}x${size.heightDp} at font scale 2")
            }
        }
        save("steps-quiet-130-font2", inflate(VitalsWidgets.Kind.STEPS, WidgetSamples.quiet(), WidgetSize(130, 130), 2f))
        save("energy-146-font2", inflate(VitalsWidgets.Kind.ENERGY, WidgetSamples.numbers(), WidgetSize(146, 146), 2f))
    }

    @Test
    fun quietModeShowsNoDigitAnywhere() {
        val kinds = listOf(VitalsWidgets.Kind.ENERGY, VitalsWidgets.Kind.SLEEP, VitalsWidgets.Kind.STEPS, VitalsWidgets.Kind.RING, VitalsWidgets.Kind.WEIGHT, VitalsWidgets.Kind.TODAY)
        // a quiet flag on a snapshot that still carries figures shows none of them either
        for (s in listOf(WidgetSamples.quiet(), WidgetSamples.numbers().copy(quiet = true), WidgetSamples.quiet(at = now - 5 * 60 * MIN))) {
            for (kind in kinds) for (size in (if (kind == VitalsWidgets.Kind.TODAY) listOf(wide, wideTall) else listOf(square, tall, wide, wideTall))) {
                assertQuietClean(inflate(kind, s, size), "${kind.card} ${size.widthDp}x${size.heightDp}")
            }
        }
    }

    @Test
    fun eachPictureIsABitmapUnderTheBudget() {
        val m = ctx.resources.displayMetrics
        val budget = desi.creative.vitals.widgets.viz.BitmapBudget.limit(m.widthPixels, m.heightPixels)
        var worst = 0L
        for (kind in listOf(VitalsWidgets.Kind.ENERGY, VitalsWidgets.Kind.SLEEP, VitalsWidgets.Kind.STEPS, VitalsWidgets.Kind.RING, VitalsWidgets.Kind.WEIGHT, VitalsWidgets.Kind.TODAY)) {
            for (size in (if (kind == VitalsWidgets.Kind.TODAY) listOf(wide, wideTall) else listOf(square, tall, wide, wideTall))) {
                val v = inflate(kind, WidgetSamples.numbers(), size)
                var bytes = 0L
                fun walk(x: View) {
                    if (x is ImageView && x.visibility == View.VISIBLE) (x.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap?.let { bytes += it.allocationByteCount }
                    if (x is ViewGroup) for (i in 0 until x.childCount) walk(x.getChildAt(i))
                }
                walk(v)
                worst = maxOf(worst, bytes)
                assertTrue("${kind.card} ${size.widthDp}x${size.heightDp}: $bytes bytes of pictures", bytes <= budget / 4)
            }
        }
        assertTrue("worst widget: $worst of $budget", worst > 0)
    }
}
