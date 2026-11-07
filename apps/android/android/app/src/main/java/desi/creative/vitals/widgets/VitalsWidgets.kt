package desi.creative.vitals.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Paint
import android.graphics.Typeface
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import desi.creative.vitals.MainActivity
import desi.creative.vitals.R
import desi.creative.vitals.widgets.design.CardArt
import desi.creative.vitals.widgets.design.HueColors
import desi.creative.vitals.widgets.design.Tokens
import desi.creative.vitals.widgets.viz.BitmapBudget
import desi.creative.vitals.widgets.viz.VizBitmaps
import desi.creative.vitals.widgets.viz.VizSpec
import java.time.ZoneId

/**
 * The widgets' RemoteViews (r071). One provider per card: the Today glance (three rings), Heart rate, Energy, Sleep, Steps,
 * Weight (opt-in), the Log / Record keys and the one-tap Log. Each instance is drawn at its own size from the stored
 * snapshot and the clock (`CardFormat`): real TextViews for every word and figure (Geist, so they scale with the system
 * font and TalkBack reads them), the generated card drawable for the face, the hue's glow and the hairline, and one
 * ImageView with a bitmap for the picture, drawn by the pure painters (never any text). A tap opens the app on the
 * matching screen (`WidgetLinks`). A widget is the end frame of the card's animation: nothing here moves.
 */
object VitalsWidgets {
    /** The widgets by provider class; `card` is the registry id the web feed's `status().byCard` uses. */
    enum class Kind(val card: String, val fallback: WidgetSize) {
        TODAY("today", WidgetSize(280, 132)),
        RING("ring", WidgetSize(132, 132)),
        ACTIONS("actions", WidgetSize(280, 58)),
        LOG("log", WidgetSize(58, 58)),
        ENERGY("energy", WidgetSize(132, 132)),
        SLEEP("sleep", WidgetSize(132, 132)),
        STEPS("steps", WidgetSize(132, 132)),
        WEIGHT("weight", WidgetSize(132, 132));

        companion object {
            fun fromCard(card: String?): Kind? = entries.firstOrNull { it.card == card }
        }
    }

    fun providerOf(kind: Kind): Class<*> = when (kind) {
        Kind.TODAY -> TodayWidgetProvider::class.java
        Kind.RING -> RingWidgetProvider::class.java
        Kind.ACTIONS -> ActionsWidgetProvider::class.java
        Kind.LOG -> LogWidgetProvider::class.java
        Kind.ENERGY -> EnergyWidgetProvider::class.java
        Kind.SLEEP -> SleepWidgetProvider::class.java
        Kind.STEPS -> StepsWidgetProvider::class.java
        Kind.WEIGHT -> WeightWidgetProvider::class.java
    }

    /** The widgets that draw the snapshot (the keys do not). */
    private val dataKinds = listOf(Kind.TODAY, Kind.RING, Kind.ENERGY, Kind.SLEEP, Kind.STEPS, Kind.WEIGHT)

    private fun idsOf(ctx: Context, kind: Kind): IntArray = AppWidgetManager.getInstance(ctx)?.getAppWidgetIds(ComponentName(ctx, providerOf(kind))) ?: IntArray(0)

    /** How many widgets of each card are on the home screen (the web side builds a card's pictures only when one is). */
    fun placedByCard(ctx: Context): Map<String, Int> = Kind.entries.associate { it.card to idsOf(ctx, it).size }

    /** How many Vitals widgets are on the home screen (the web side may skip work when none is). */
    fun placedCount(ctx: Context): Int = placedByCard(ctx).values.sum()

    /** Can the launcher be asked to pin a widget (Android 8+, launcher-dependent)? */
    fun canPin(ctx: Context): Boolean = AppWidgetManager.getInstance(ctx)?.isRequestPinAppWidgetSupported == true

    /** Ask the launcher to pin a widget of this card; the person confirms on the home screen. `supported` false: say where to find it in words. */
    fun requestPin(ctx: Context, card: String?): Pair<Boolean, Boolean>? {
        val kind = Kind.fromCard(card) ?: return null
        val mgr = AppWidgetManager.getInstance(ctx) ?: return false to false
        if (!mgr.isRequestPinAppWidgetSupported) return false to false
        return true to mgr.requestPinAppWidget(ComponentName(ctx, providerOf(kind)), null, null)
    }

    /** Redraw the widgets that show data (after a publish, or a clear). */
    fun updateData(ctx: Context) {
        for (kind in dataKinds) updateKind(ctx, kind)
    }

    /** Redraw the instances of one kind (all of them, or the given ids), each at its own size. */
    fun updateKind(ctx: Context, kind: Kind, ids: IntArray? = null) {
        val mgr = AppWidgetManager.getInstance(ctx) ?: return
        val targets = ids ?: idsOf(ctx, kind)
        if (targets.isEmpty()) return
        val snapshot = WidgetState.snapshot(ctx)
        val now = System.currentTimeMillis()
        val zone = ZoneId.systemDefault()
        for (id in targets) mgr.updateAppWidget(id, views(ctx, kind, snapshot, now, zone, sizeOf(ctx, mgr, id, kind)))
    }

    /** An instance's own size: from its options (the launcher says it on placement and on every resize). */
    fun sizeOf(ctx: Context, mgr: AppWidgetManager, id: Int, kind: Kind): WidgetSize =
        WidgetSize.from(mgr.getAppWidgetOptions(id), ctx.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE, kind.fallback)

    fun views(ctx: Context, kind: Kind, snapshot: WidgetSnapshot?, now: Long, zone: ZoneId, size: WidgetSize): RemoteViews = when (kind) {
        Kind.TODAY -> trio(ctx, CardFormat.trio(snapshot, now, zone), size)
        Kind.RING -> card(ctx, CardFormat.heart(snapshot, now, zone, size.cls), size)
        Kind.ENERGY -> card(ctx, CardFormat.energy(snapshot, now, zone, size.cls), size)
        Kind.SLEEP -> card(ctx, CardFormat.sleep(snapshot, now, zone, size.cls), size)
        Kind.STEPS -> card(ctx, CardFormat.steps(snapshot, now, zone, size.cls), size)
        Kind.WEIGHT -> card(ctx, CardFormat.weight(snapshot, now, zone, size.cls), size)
        Kind.ACTIONS -> RemoteViews(ctx.packageName, R.layout.widget_keys).apply {
            setOnClickPendingIntent(R.id.vw_key_log, open(ctx, WidgetLinks.LOG))
            setOnClickPendingIntent(R.id.vw_key_record, open(ctx, WidgetLinks.RECORD))
        }
        Kind.LOG -> RemoteViews(ctx.packageName, R.layout.widget_key).apply {
            setOnClickPendingIntent(android.R.id.background, open(ctx, WidgetLinks.LOG))
        }
    }

    // ---------------------------------------------------------------------------------------------------------------

    private val BACKGROUND = android.R.id.background

    private fun layoutOf(layout: CardLayout): Int = when (layout) {
        CardLayout.RING -> R.layout.widget_card_ring
        CardLayout.SIDE -> R.layout.widget_card_side
        CardLayout.STACK -> R.layout.widget_card_stack
    }

    private fun sizeClassName(size: WidgetSize): String = size.cls.name.lowercase()

    /** One card: the slots of its layout, in the hue's colours; a note instead of the figure when it has no figure for today. */
    private fun card(ctx: Context, v: CardView, size: WidgetSize): RemoteViews {
        val fontScale = fontScaleOf(ctx)
        val rv = RemoteViews(ctx.packageName, layoutOf(v.layout))
        val hue = Tokens.hue(v.hue)
        rv.setInt(BACKGROUND, "setBackgroundResource", CardArt.card(v.hue, sizeClassName(size)))
        CardArt.icon(v.id).takeIf { it != 0 }?.let {
            rv.setImageViewResource(R.id.vw_icon, it)
            rv.setInt(R.id.vw_icon, "setColorFilter", hue.solid)
        }
        rv.setTextViewText(R.id.vw_title, v.title)
        rv.text(R.id.vw_asof, v.asOf)
        rv.setContentDescription(BACKGROUND, v.spoken)
        rv.setOnClickPendingIntent(BACKGROUND, open(ctx, v.tap))

        val body = if (v.layout == CardLayout.RING) R.id.vw_center else R.id.vw_split
        // a ring that is too small for the figure (or the quiet word) to sit inside it is not drawn: the figure takes the body
        val ringUsed = v.layout == CardLayout.RING && ringFits(ctx, v, size)
        if (v.layout == CardLayout.RING) {
            // the figure (or the quiet word) stays inside the ring: the centre spans the body, and its padding narrows it to the ring's inside
            val d = ctx.resources.displayMetrics.density
            val pad = ((CardGeometry.bodyW(size) - CardGeometry.heroWidth(CardLayout.RING, size, fontScale, ringUsed)) / 2f * d).toInt().coerceAtLeast(0)
            rv.setViewPadding(R.id.vw_center, pad, 0, pad, 0)
        }
        if (v.note != null) {
            rv.setViewVisibility(body, View.GONE)
            rv.setViewVisibility(R.id.vw_viz, View.GONE)
            rv.setViewVisibility(R.id.vw_foot, View.GONE)
            rv.text(R.id.vw_note, v.note)
            // a sentence takes the whole body and the foot's room (the foot is hidden): at its size, up to five lines of it
            val room = CardGeometry.bodyH(size, fontScale) + CardGeometry.FOOT * maxOf(1f, fontScale)
            rv.setTextViewTextSize(R.id.vw_note, TypedValue.COMPLEX_UNIT_SP, noteSp(ctx, v.note, CardGeometry.bodyW(size), room, 5))
            return rv
        }
        rv.setViewVisibility(R.id.vw_note, View.GONE)
        rv.setViewVisibility(body, View.VISIBLE)

        // a small ring has no room for the unit under the figure: the unit goes first
        val compact = v.layout == CardLayout.RING && (!ringUsed || CardGeometry.ring(size, fontScale).w < CardGeometry.COMPACT_RING)
        // the figure (sized to the room it has), or the quiet word where it would be
        if (v.hero != null) {
            rv.setTextViewText(R.id.vw_hero, v.hero)
            // beside the figure, the unit takes its own width off the room the figure has (inside a ring it sits underneath),
            // and the facts under it take their height
            val reserve = if (v.layout != CardLayout.RING && v.unit != null) unitWidthDp(ctx, v.unit) + 4f else 0f
            val reserveH = if (v.layout != CardLayout.RING && v.meta != null && metaFits(ctx, v, size)) metaHeightDp(ctx, v.meta, v.layout, size) else 0f
            rv.setTextViewTextSize(R.id.vw_hero, TypedValue.COMPLEX_UNIT_SP, heroSp(ctx, v.hero, v.layout, size, reserve, reserveH, ringUsed))
            rv.setViewVisibility(R.id.vw_hero, View.VISIBLE)
        } else {
            rv.setViewVisibility(R.id.vw_hero, View.GONE)
        }
        rv.text(R.id.vw_word, if (v.hero == null) v.word else null)
        if (v.hero == null && v.word != null) rv.setTextViewTextSize(R.id.vw_word, TypedValue.COMPLEX_UNIT_SP, wordSp(ctx, v.word, v.layout, size, ringUsed))
        rv.text(R.id.vw_unit, if (compact) null else v.unit)
        // the facts line gives way when the body cannot hold the figure and it together (a short widget at a large system font)
        rv.text(R.id.vw_meta, v.meta?.takeIf { v.layout == CardLayout.RING || metaFits(ctx, v, size) })
        for (id in intArrayOf(R.id.vw_unit, R.id.vw_meta, R.id.vw_state, R.id.vw_range)) rv.setTextColor(id, hue.ink)
        // the foot: where it stands, and the range or goal. The range is the estimate's honesty and stays; the word gives way
        // when the two do not fit one line (a narrow, tall 2x2 at a large system font)
        val state = v.state?.takeIf { footFits(ctx, it, v.range, size) }
        rv.text(R.id.vw_state, state)
        // alone in the foot, the word takes the size that fits one line of the card (a narrow widget at a large system font)
        if (state != null && v.range == null) rv.setTextViewTextSize(R.id.vw_state, TypedValue.COMPLEX_UNIT_SP, stateSp(ctx, state, CardGeometry.bodyW(size) - 2f))
        rv.text(R.id.vw_range, v.range)
        // the range is the estimate's honesty and is never dropped: alone in the foot it takes the size that fits one line
        if (v.range != null) rv.setTextViewTextSize(R.id.vw_range, TypedValue.COMPLEX_UNIT_SP, rangeSp(ctx, v.range, CardGeometry.bodyW(size) - 8f - (if (state != null) stateWidthDp(ctx, state) else 0f)))
        rv.setViewVisibility(R.id.vw_foot, if (state != null || v.range != null) View.VISIBLE else View.GONE)

        // the picture, from the room the layout gives it, held to the bitmap budget
        val spec = v.viz
        val drawn = v.layout != CardLayout.RING || ringUsed
        if (spec != null && drawn && picture(ctx, rv, R.id.vw_viz, spec, hue, CardGeometry.viz(v.layout, size, fontScale))) {
            rv.setViewVisibility(R.id.vw_viz, View.VISIBLE)
        } else {
            rv.setViewVisibility(R.id.vw_viz, View.GONE)
        }
        return rv
    }

    /** The Today glance: three rings (two in quiet mode), each its own hue and its own tap; the header opens Today. */
    private fun trio(ctx: Context, v: TrioView, size: WidgetSize): RemoteViews {
        val rv = RemoteViews(ctx.packageName, R.layout.widget_trio)
        rv.setInt(BACKGROUND, "setBackgroundResource", CardArt.card("gold", sizeClassName(size)))
        rv.setTextViewText(R.id.vw_title, v.title)
        rv.setTextViewText(R.id.vw_day, v.dayLine)
        rv.text(R.id.vw_asof, v.asOf)
        rv.setContentDescription(BACKGROUND, v.spoken)
        rv.setOnClickPendingIntent(BACKGROUND, open(ctx, WidgetLinks.TODAY))
        if (v.note != null) {
            rv.setViewVisibility(R.id.vw_cells, View.GONE)
            rv.text(R.id.vw_note, v.note)
            val fs = fontScaleOf(ctx)
            val room = size.heightDp - 2 * CardGeometry.PAD - CardGeometry.HEAD * maxOf(1f, fs) - CardGeometry.GAP
            rv.setTextViewTextSize(R.id.vw_note, TypedValue.COMPLEX_UNIT_SP, noteSp(ctx, v.note, CardGeometry.bodyW(size), room, 3))
            return rv
        }
        rv.setViewVisibility(R.id.vw_note, View.GONE)
        rv.setViewVisibility(R.id.vw_cells, View.VISIBLE)
        val cells = intArrayOf(R.id.vw_cell1, R.id.vw_cell2, R.id.vw_cell3)
        val rings = intArrayOf(R.id.vw_ring1, R.id.vw_ring2, R.id.vw_ring3)
        val heroes = intArrayOf(R.id.vw_hero1, R.id.vw_hero2, R.id.vw_hero3)
        val labels = intArrayOf(R.id.vw_label1, R.id.vw_label2, R.id.vw_label3)
        val words = intArrayOf(R.id.vw_word1, R.id.vw_word2, R.id.vw_word3)
        val fontScale = fontScaleOf(ctx)
        val diameter = CardGeometry.trioRing(size, v.cells.size, fontScale)
        val labelsShown = CardGeometry.trioLabels(size, fontScale)
        // the three rings are one RemoteViews: they share one bitmap budget
        val m = ctx.resources.displayMetrics
        val rings3 = v.cells.count { it.ratio != null }
        val scale = BitmapBudget.scaleFor(List(rings3) { diameter to diameter }, m.density, m.widthPixels, m.heightPixels)
        for (i in cells.indices) {
            val c = v.cells.getOrNull(i)
            if (c == null) {
                rv.setViewVisibility(cells[i], View.GONE)
                continue
            }
            val hue = Tokens.hue(c.hue)
            rv.setViewVisibility(cells[i], View.VISIBLE)
            rv.setContentDescription(cells[i], c.spoken)
            rv.setOnClickPendingIntent(cells[i], open(ctx, c.tap))
            rv.setTextViewText(labels[i], c.label)
            rv.setTextColor(labels[i], hue.ink)
            rv.setViewVisibility(labels[i], if (labelsShown) View.VISIBLE else View.GONE)
            // the ring wears its own hue; the figure sits inside it (quiet mode: a word under the label instead)
            val ring = c.ratio?.let { VizSpec.Ring(it) }
            if (ring != null && scale != null && diameter >= 8f) {
                rv.setImageViewBitmap(rings[i], VizBitmaps.render(ring, hue, diameter, diameter, m.density, scale, hue.solid))
                rv.setViewVisibility(rings[i], View.VISIBLE)
            } else {
                rv.setViewVisibility(rings[i], View.GONE)
            }
            if (c.hero != null) {
                rv.setTextViewText(heroes[i], c.hero)
                rv.setTextViewTextSize(heroes[i], TypedValue.COMPLEX_UNIT_SP, trioSp(ctx, c.hero, diameter))
                rv.setViewVisibility(heroes[i], View.VISIBLE)
            } else {
                rv.setViewVisibility(heroes[i], View.GONE)
            }
            rv.text(words[i], c.word)
        }
        return rv
    }

    /** Draw a picture for a zone and give it to an ImageView; false when even a quarter resolution would not fit the budget (no picture then). */
    private fun picture(ctx: Context, rv: RemoteViews, viewId: Int, spec: VizSpec, hue: HueColors, zone: CardGeometry.Zone, lit: Int = Tokens.INK): Boolean {
        val m = ctx.resources.displayMetrics
        val scale = BitmapBudget.scaleFor(listOf(zone.w to zone.h), m.density, m.widthPixels, m.heightPixels) ?: return false
        if (zone.w < 8f || zone.h < 8f) return false
        rv.setImageViewBitmap(viewId, VizBitmaps.render(spec, hue, zone.w, zone.h, m.density, scale, lit))
        return true
    }

    private fun font(ctx: Context, id: Int): Typeface = try {
        ctx.resources.getFont(id)
    } catch (e: Exception) {
        Typeface.DEFAULT
    }

    /** A size in sp as pixels, as a TextView makes it of the system font scale (on Android 14+ a small size grows more than a large one). */
    private fun spPx(ctx: Context, sp: Float): Float = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp, ctx.resources.displayMetrics)

    /** How much the system font scale grows the card's own text (a 13 sp line, between its 12 sp and 14 sp): 1 at the default scale, never less. */
    private fun fontScaleOf(ctx: Context): Float = (spPx(ctx, 13f) / (13f * ctx.resources.displayMetrics.density)).coerceAtLeast(1f)

    /** The smallest size, sp, a text may take: its own floor, or less at a large system font, so that it never renders below `renderedDp`. */
    private fun floorSp(ctx: Context, baseMin: Float, renderedDp: Float): Float =
        minOf(baseMin, renderedDp / (spPx(ctx, 8f) / (8f * ctx.resources.displayMetrics.density)).coerceAtLeast(1f))

    /** A line of a face is this many times its size tall (ascent plus descent: the layouts keep no font padding). */
    private fun lineRatio(ctx: Context, face: Int): Float {
        val fm = Paint().apply {
            typeface = font(ctx, face)
            textSize = 100f
        }.fontMetrics
        return ((fm.descent - fm.ascent) / 100f).coerceIn(1f, 1.6f)
    }

    /** Do the foot's word and range fit one line of the card, in the faces and sizes the layout gives them (at the user's font scale)? */
    fun footFits(ctx: Context, state: String, range: String?, size: WidgetSize): Boolean {
        if (range == null) return true
        val d = ctx.resources.displayMetrics.density
        val word = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = font(ctx, R.font.geist_regular)
            textSize = spPx(ctx, 12f)
        }
        val mono = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = font(ctx, R.font.geist_mono_medium)
            textSize = spPx(ctx, 10f)
            letterSpacing = 0.06f
        }
        return word.measureText(state) + mono.measureText(range.uppercase()) + 8f * d <= CardGeometry.bodyW(size) * d
    }

    /** The largest hero size in sp at which the figure fits the room its layout gives it (measured in the same face, at the user's font scale). */
    fun heroSp(ctx: Context, text: String, layout: CardLayout, size: WidgetSize, reserveDp: Float = 0f, reserveHeightDp: Float = 0f, ringUsed: Boolean = true): Float {
        val (max, min) = when (layout) {
            CardLayout.RING -> 34f to floorSp(ctx, 10f, 12f)
            CardLayout.SIDE -> 44f to floorSp(ctx, 14f, 14f)
            CardLayout.STACK -> 40f to floorSp(ctx, 14f, 14f)
        }
        val d = ctx.resources.displayMetrics.density
        val fontScale = fontScaleOf(ctx)
        // the figure's line is as tall as its size: what the body keeps beyond the facts under it caps the size too (a large system font on a short widget);
        // inside a ring the ring bounds the figure; with no ring (too small to draw) or beside a picture the body's height does
        val bounded = layout != CardLayout.RING || !ringUsed
        val ratio = lineRatio(ctx, R.font.geist_light)
        val roomPx = (CardGeometry.bodyH(size, fontScale) - reserveHeightDp) * d
        val floor = if (layout == CardLayout.RING) floorSp(ctx, 8f, 10f) else floorSp(ctx, 14f, 14f)
        val cap = if (bounded) TextFit.fitSp(max, floor, roomPx) { sp -> spPx(ctx, sp) * ratio } else max
        return fit(ctx, text, CardGeometry.heroWidth(layout, size, fontScale, ringUsed) - reserveDp, cap, minOf(min, cap))
    }

    /** The height of a mono-caps facts line under the figure, dp: its lines as they wrap in the column, at the user's font scale, and the gap above. */
    private fun metaHeightDp(ctx: Context, text: String, layout: CardLayout, size: WidgetSize): Float {
        val d = ctx.resources.displayMetrics.density
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = font(ctx, R.font.geist_mono_medium)
            textSize = spPx(ctx, 10f)
            letterSpacing = 0.08f
        }
        val column = if (layout == CardLayout.SIDE) CardGeometry.bodyW(size) * CardGeometry.SIDE_LEFT else CardGeometry.bodyW(size)
        val lines = TextFit.wrappedLines(text.uppercase(), column * d) { paint.measureText(it) }
        return lines * lineRatio(ctx, R.font.geist_mono_medium) * paint.textSize / d + 4f
    }

    /** A sentence at the largest size (13 sp down to its floor) at which it wraps into `maxLines` lines of `widthDp` and they fit `heightDp`. */
    private fun noteSp(ctx: Context, text: String, widthDp: Float, heightDp: Float, maxLines: Int): Float {
        val d = ctx.resources.displayMetrics.density
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = font(ctx, R.font.geist_regular) }
        val ratio = lineRatio(ctx, R.font.geist_regular)
        return TextFit.fitWordSp(
            text, 13f, floorSp(ctx, 8f, 8f), widthDp * d, maxLines,
            measure = { w, sp ->
                paint.textSize = spPx(ctx, sp)
                paint.measureText(w)
            },
            fitsHeight = { lines, sp -> lines * spPx(ctx, sp) * ratio <= heightDp * d },
        )
    }

    /** The foot's word in its face at its size, dp. */
    private fun stateWidthDp(ctx: Context, state: String): Float {
        val d = ctx.resources.displayMetrics.density
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = font(ctx, R.font.geist_regular)
            textSize = spPx(ctx, 12f)
        }
        return paint.measureText(state) / d
    }

    /** The largest size (12 sp down to its floor) at which the foot's word fits one line of `widthDp`. */
    private fun stateSp(ctx: Context, state: String, widthDp: Float): Float {
        val d = ctx.resources.displayMetrics.density
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = font(ctx, R.font.geist_regular) }
        return TextFit.fitSp(12f, floorSp(ctx, 8f, 8f), widthDp * d) { sp ->
            paint.textSize = spPx(ctx, sp)
            paint.measureText(state)
        }
    }

    /** The largest size (10 sp down to its floor) at which the mono-caps range fits one line of `widthDp`, at the user's font scale. */
    private fun rangeSp(ctx: Context, range: String, widthDp: Float): Float {
        val d = ctx.resources.displayMetrics.density
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = font(ctx, R.font.geist_mono_medium)
            letterSpacing = 0.06f
        }
        val caps = range.uppercase()
        return TextFit.fitSp(10f, floorSp(ctx, 6f, 8f), widthDp * d) { sp ->
            paint.textSize = spPx(ctx, sp)
            paint.measureText(caps)
        }
    }

    /** Is the ring big enough to draw, with the figure (or the quiet word) inside it at its smallest size? */
    private fun ringFits(ctx: Context, v: CardView, size: WidgetSize): Boolean {
        val fontScale = fontScaleOf(ctx)
        if (!CardGeometry.ringShown(size, fontScale)) return false
        val d = ctx.resources.displayMetrics.density
        val inner = CardGeometry.ring(size, fontScale).w * 0.64f
        val light = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = font(ctx, R.font.geist_light)
            letterSpacing = -0.035f
            fontFeatureSettings = "pnum"
            textSize = spPx(ctx, floorSp(ctx, 10f, 12f))
        }
        if (v.hero != null && light.measureText(v.hero) > inner * d) return false
        if (v.hero == null && v.word != null) {
            val regular = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = font(ctx, R.font.geist_regular) }
            val ratio = lineRatio(ctx, R.font.geist_regular)
            val fits = TextFit.wordFits(
                v.word, floorSp(ctx, 8f, 8f), inner * d, 3,
                measure = { w, sp ->
                    regular.textSize = spPx(ctx, sp)
                    regular.measureText(w)
                },
                fitsHeight = { lines, sp -> lines * spPx(ctx, sp) * ratio <= inner * d },
            )
            if (!fits) return false
        }
        return true
    }

    /** Can the body hold the figure (at its smallest) and the facts line under it? */
    private fun metaFits(ctx: Context, v: CardView, size: WidgetSize): Boolean {
        val meta = v.meta ?: return true
        val d = ctx.resources.displayMetrics.density
        val figure = lineRatio(ctx, R.font.geist_light) * spPx(ctx, floorSp(ctx, 14f, 14f)) / d
        return CardGeometry.bodyH(size, fontScaleOf(ctx)) >= metaHeightDp(ctx, meta, v.layout, size) + figure
    }

    /** The largest size at which the quiet word wraps into three lines of the room it has (13 sp inside a ring, 16 sp beside a picture). */
    fun wordSp(ctx: Context, text: String, layout: CardLayout, size: WidgetSize, ringUsed: Boolean = true): Float {
        val d = ctx.resources.displayMetrics.density
        val fontScale = fontScaleOf(ctx)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = font(ctx, R.font.geist_regular) }
        val ratio = lineRatio(ctx, R.font.geist_regular)
        // a word is up to three lines, and they must fit the body's height as well as its width
        val bodyPx = CardGeometry.bodyH(size, fontScale) * d
        val ringBound = layout == CardLayout.RING && ringUsed && CardGeometry.ringShown(size, fontScale)
        val heightPx = if (ringBound) CardGeometry.ring(size, fontScale).w * 0.64f * d else bodyPx
        return TextFit.fitWordSp(
            text, if (layout == CardLayout.RING) 13f else 16f, floorSp(ctx, 8f, 8f), CardGeometry.wordWidth(layout, size, fontScale, ringUsed) * d, 3,
            measure = { w, sp ->
                paint.textSize = spPx(ctx, sp)
                paint.measureText(w)
            },
            fitsHeight = { lines, sp -> lines * spPx(ctx, sp) * ratio <= heightPx },
        )
    }

    /** The width of a unit ("kcal") in the layout's unit face and size, at the user's font scale, dp. */
    private fun unitWidthDp(ctx: Context, unit: String): Float {
        val d = ctx.resources.displayMetrics.density
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = font(ctx, R.font.geist_regular)
            textSize = spPx(ctx, 12f)
        }
        return paint.measureText(unit) / d
    }

    private fun trioSp(ctx: Context, text: String, ringDp: Float): Float = fit(ctx, text, ringDp * 0.64f, 24f, 9f)

    private fun fit(ctx: Context, text: String, widthDp: Float, maxSp: Float, minSp: Float): Float {
        val d = ctx.resources.displayMetrics.density
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = font(ctx, R.font.geist_light)
            letterSpacing = -0.035f
            fontFeatureSettings = "pnum"
        }
        return TextFit.fitSp(maxSp, minSp, widthDp * d) { sp ->
            paint.textSize = spPx(ctx, sp)
            paint.measureText(text)
        }
    }

    private fun RemoteViews.text(id: Int, s: String?) {
        if (s.isNullOrEmpty()) {
            setViewVisibility(id, View.GONE)
        } else {
            setTextViewText(id, s)
            setViewVisibility(id, View.VISIBLE)
        }
    }

    /** A tap: MainActivity with the widget action and a target (never a path). */
    fun open(ctx: Context, target: String): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java)
            .setAction(WidgetLinks.ACTION_OPEN)
            .putExtra(WidgetLinks.EXTRA_TARGET, target)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(ctx, WidgetLinks.requestCode(target), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}
