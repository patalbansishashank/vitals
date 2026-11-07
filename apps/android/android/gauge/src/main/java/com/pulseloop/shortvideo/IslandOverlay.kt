package com.pulseloop.shortvideo

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.view.animation.PathInterpolator
import androidx.core.content.ContextCompat
import androidx.core.content.res.ResourcesCompat
import com.pulseloop.R
import kotlin.math.max
import kotlin.math.min

/**
 * The "island": a black pill around the camera hole with the brain on the left and today's count
 * on the right, as a TYPE_ACCESSIBILITY_OVERLAY (no extra permission). It never takes touches or
 * focus. It is always the same size, the one that hugs the hole; the count turns from warm white to
 * red as it nears the daily limit ([CountColour]) and rolls to the next number in place.
 *
 * Its place and size come from the real screen ([IslandGeometry]): the status bar's height and
 * the display cutout. It is put up again after a rotation and not drawn while the phone is on its side.
 */
class IslandOverlay(private val context: Context) {
    private val windowManager = context.getSystemService(WindowManager::class.java)
    private val displays = context.getSystemService(DisplayManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var view: IslandView? = null
    private var wanted = false
    private var count = 0
    private var limit = 30
    private var rotation = -1

    val showing: Boolean get() = view != null

    fun show(count: Int, limit: Int) {
        this.count = count
        this.limit = limit
        if (!wanted) {
            wanted = true
            rotation = currentRotation()
            displays.registerDisplayListener(displayListener, handler)
        }
        place()
    }

    fun onNewReel(count: Int, limit: Int) {
        this.count = count
        this.limit = limit
        view?.update(count, limit, animate = true)
    }

    fun hide() {
        if (wanted) {
            wanted = false
            handler.removeCallbacks(placeAgain)
            displays.unregisterDisplayListener(displayListener)
        }
        detach()
    }

    /** Puts the pill up for the screen as it is now: laid out again when that changed, not at all on its side. */
    private fun place() {
        val screen = readScreen()
        val geometry = IslandGeometry.of(screen)
        val existing = view
        if (existing != null && existing.geometry == geometry) {
            existing.update(count, limit, animate = false)
            return
        }
        detach()
        if (geometry.visible) attach(screen, geometry)
    }

    private fun attach(screen: IslandScreen, geometry: IslandGeometry) {
        val v = IslandView(context, geometry).also { it.update(count, limit, animate = false) }
        val params = WindowManager.LayoutParams(
            v.windowWidth,
            v.windowHeight,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            // LEFT, not START: x counts from the screen's left edge, also in a right-to-left language.
            gravity = Gravity.TOP or Gravity.LEFT
            x = geometry.left(v.windowWidth)
            y = geometry.top
            title = "Short-video countdown"
            if (Build.VERSION.SDK_INT >= 30) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            } else if (Build.VERSION.SDK_INT >= 28) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        if (runCatching { windowManager.addView(v, params) }.isSuccess) view = v
        // What the pill was sized from, for checking it on the phone without a cable.
        ShortVideoDebugLog.event(
            null, "island",
            "screen ${screen.width}x${screen.height} d=${screen.density} font=${context.resources.configuration.fontScale} " +
                "bar=${screen.statusBarHeight} cutout=${screen.topCutout?.let { "${it.left},${it.top},${it.right},${it.bottom}" } ?: "none"}" +
                " -> centre ${geometry.centerX},${geometry.centerY} hole ${geometry.holeWidth}x${geometry.holeHeight}" +
                " height ${geometry.height} window ${v.windowWidth}x${v.windowHeight}" +
                if (view == null) " (not added)" else "",
        )
    }

    private fun detach() {
        val v = view ?: return
        view = null
        v.stop()
        runCatching { windowManager.removeViewImmediate(v) }
    }

    private fun readScreen(): IslandScreen {
        val resources = context.resources
        var width = resources.displayMetrics.widthPixels
        var height = resources.displayMetrics.heightPixels
        var statusBar = 0
        var cutout: Rect? = null
        if (Build.VERSION.SDK_INT >= 30) {
            runCatching {
                val metrics = windowManager.maximumWindowMetrics
                if (!metrics.bounds.isEmpty) {
                    width = metrics.bounds.width()
                    height = metrics.bounds.height()
                }
                // Ignoring visibility: the bar's size even while the app in front hides it.
                statusBar = metrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.statusBars()).top
                cutout = metrics.windowInsets.displayCutout?.boundingRectTop
            }
        } else if (Build.VERSION.SDK_INT >= 29) {
            @Suppress("DEPRECATION")
            cutout = runCatching { windowManager.defaultDisplay.cutout?.boundingRectTop }.getOrNull()
        }
        if (statusBar <= 0) {
            val id = resources.getIdentifier("status_bar_height", "dimen", "android")
            if (id > 0) statusBar = resources.getDimensionPixelSize(id)
        }
        return IslandScreen(
            width = width,
            height = height,
            statusBarHeight = statusBar,
            topCutout = cutout?.takeIf { !it.isEmpty }?.let { IslandGeometry.Cutout(it.left, it.top, it.right, it.bottom) },
            density = resources.displayMetrics.density,
        )
    }

    private fun currentRotation(): Int = displays.getDisplay(Display.DEFAULT_DISPLAY)?.rotation ?: -1

    // A rotation puts the pill up again for the new screen, or takes it down on its side. The display also
    // changes for its refresh rate and brightness, hence the rotation check; the delay lets the window metrics settle.
    private val placeAgain = Runnable { if (wanted) place() }
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = Unit
        override fun onDisplayRemoved(displayId: Int) = Unit
        override fun onDisplayChanged(displayId: Int) {
            if (displayId != Display.DEFAULT_DISPLAY) return
            val now = currentRotation()
            if (now == rotation) return
            rotation = now
            handler.removeCallbacks(placeAgain)
            handler.postDelayed(placeAgain, 150)
        }
    }
}

internal class IslandView(context: Context, val geometry: IslandGeometry) : View(context) {
    private companion object {
        /** The brain takes at most this much of the pill's height. */
        const val BRAIN_SHARE = 0.7f
        /** The count is never shrunk below this, however little room the screen leaves. */
        const val MIN_TEXT_SCALE = 0.4f
        /** The number rolls this much of a line up and out, the next one in from below. */
        const val ROLL_SHIFT = 0.3f
        const val ROLL_MS = 260L
    }

    private val density = resources.displayMetrics.density
    private fun dp(v: Float) = v * density
    private fun sp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, resources.displayMetrics)
    private val holeWidth = geometry.holeWidth.toFloat()
    private val pillHeight = geometry.height.toFloat()
    private val brainSize = min(dp(20f), pillHeight * BRAIN_SHARE)
    private val gap = dp(6f)
    private val pad = dp(7f)
    private val vPad = dp(3f)
    private val countPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = runCatching { ResourcesCompat.getFont(context, R.font.inter_bold) }.getOrNull()
        isFakeBoldText = typeface == null
        fontFeatureSettings = "tnum"
        textAlign = Paint.Align.CENTER
    }
    private val pillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }
    private val rect = RectF()
    private var count = 0
    private var limit = 30
    private var colour = CountColour.NEUTRAL
    private var stage = BrainStage.HEALTHY
    private var brain: Drawable? = null
    private var previousCount = 0
    private var previousColour = CountColour.NEUTRAL
    private var roll = 1f
    private var animator: ValueAnimator? = null

    // The count at the size the user's font setting gives it (15 sp), shrunk so that it fits the pill's height on
    // one line and two digits fit the side the pill's widest leaves it. A number with more digits is drawn
    // smaller to fit the same column: the pill is never wider for it.
    private val countSize: Float
    private val textSlot: Float
    private val column: Float
    private val line: Float

    init {
        countPaint.textSize = sp(15f)
        val byHeight = IslandGeometry.fitScale(pillHeight - 2 * vPad, lineHeight())
        val room = if (holeWidth > 0f) (geometry.maxWidth - holeWidth) / 2 - pad - gap
            else geometry.maxWidth - 2 * pad - gap - brainSize
        val byWidth = IslandGeometry.fitScale(room, countPaint.measureText("99"))
        countSize = countPaint.textSize * min(byHeight, byWidth).coerceAtLeast(MIN_TEXT_SCALE)
        countPaint.textSize = countSize
        line = lineHeight()
        textSlot = countPaint.measureText("99")
        column = max(brainSize, textSlot)

        contentDescription = null
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    private val pillWidth = min(IslandGeometry.pillWidth(holeWidth, brainSize, textSlot, pad, gap), geometry.maxWidth.toFloat())

    // The pill's own size and 1 dp spare either side for its soft edge: the window never changes.
    val windowWidth: Int = (pillWidth + dp(2f)).toInt()
    val windowHeight: Int = geometry.height

    private fun lineHeight(): Float = countPaint.fontMetrics.let { it.descent - it.ascent }

    /** [animate]: the number rolls to the new count (unless the system's animations are off); otherwise it just changes. */
    fun update(count: Int, limit: Int, animate: Boolean) {
        val changed = count != this.count
        if (changed && animate && ValueAnimator.areAnimatorsEnabled()) {
            previousCount = this.count
            previousColour = colour
            roll = 0f
            animator?.cancel()
            animator = ValueAnimator.ofFloat(0f, 1f).apply {
                duration = ROLL_MS
                interpolator = PathInterpolator(0.2f, 0f, 0f, 1f)
                addUpdateListener { roll = it.animatedValue as Float; invalidate() }
                start()
            }
        } else if (changed || limit != this.limit) {
            animator?.cancel()
            animator = null
            roll = 1f
        }
        this.count = count
        this.limit = limit
        colour = CountColour.of(count, limit)
        val next = BrainStage.forCount(count, limit)
        if (next != stage || brain == null) {
            stage = next
            brain = ContextCompat.getDrawable(context, next.drawableRes)
        }
        invalidate()
    }

    fun stop() { animator?.cancel(); animator = null }

    /** The number [progress] of the way from [previous] to the current count, 0 to 1 (also used by the render preview). */
    internal fun rollFrom(previous: Int, progress: Float) {
        previousCount = previous
        previousColour = CountColour.of(previous, limit)
        roll = progress.coerceIn(0f, 1f)
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        rect.set(cx - pillWidth / 2, cy - pillHeight / 2, cx + pillWidth / 2, cy + pillHeight / 2)
        canvas.drawRoundRect(rect, pillHeight / 2, pillHeight / 2, pillPaint)

        // Around a hole the brain's column is against its left edge and the count's against its right, both as wide
        // as the wider; without one the two columns sit side by side in the pill's middle.
        val brainX: Float
        val textX: Float
        if (holeWidth > 0f) {
            brainX = cx - holeWidth / 2 - gap - column / 2
            textX = cx + holeWidth / 2 + gap + column / 2
        } else {
            val left = rect.left + pad
            brainX = left + brainSize / 2
            textX = left + brainSize + gap + textSlot / 2
        }
        brain?.let { d ->
            d.setBounds((brainX - brainSize / 2).toInt(), (cy - brainSize / 2).toInt(), (brainX + brainSize / 2).toInt(), (cy + brainSize / 2).toInt())
            d.draw(canvas)
        }
        if (roll < 1f) {
            val shift = line * ROLL_SHIFT
            drawCount(canvas, previousCount, previousColour, 1f - roll, -shift * roll, textX, cy)
            drawCount(canvas, count, colour, roll, shift * (1f - roll), textX, cy)
        } else {
            drawCount(canvas, count, colour, 1f, 0f, textX, cy)
        }
    }

    /** One number, centred in its column and in the pill, [dy] off centre. */
    private fun drawCount(canvas: Canvas, n: Int, colour: Int, alpha: Float, dy: Float, x: Float, cy: Float) {
        val text = n.toString()
        countPaint.textSize = countSize
        val wide = countPaint.measureText(text)
        if (wide > column) countPaint.textSize = countSize * max(column / wide, MIN_TEXT_SCALE)
        countPaint.color = colour
        countPaint.alpha = (255 * alpha).toInt()
        val fm = countPaint.fontMetrics
        canvas.drawText(text, x, cy - (fm.ascent + fm.descent) / 2 + dy, countPaint)
    }
}
