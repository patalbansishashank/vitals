package com.pulseloop.shortvideo

import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat
import com.pulseloop.R

/**
 * The full-screen "Limit reached — leaving in 5…" countdown with one big Cancel. It covers the
 * reel (so the next swipe cannot slip past it) and offers no way to change or disable the limit:
 * that lives only in Gauge's settings.
 */
class CountdownOverlay(private val context: Context, private val onCancel: () -> Unit) {
    private val windowManager = context.getSystemService(WindowManager::class.java)
    private var root: View? = null
    private var headline: TextView? = null
    private var detail: TextView? = null
    private var brain: ImageView? = null
    private var countdownText: TextView? = null

    val showing: Boolean get() = root != null

    fun show(effect: LimitEffect.ShowCountdown, preview: Boolean = false) {
        if (root == null) attach()
        bind(effect, preview)
    }

    /** Fill the texts for [effect] (also used by the render preview). */
    internal fun bind(effect: LimitEffect.ShowCountdown, preview: Boolean) {
        brain?.setImageResource(BrainStage.forCount(effect.count, effect.limit).drawableRes)
        detail?.text = when {
            preview -> "Preview only: nothing happens when it reaches zero."
            effect.firstHit -> "That was short video ${effect.count} of ${effect.limit} today."
            else -> "Short video ${effect.count} today, your limit is ${effect.limit}. Cancel to finish this one."
        }
        update(effect.secondsLeft)
    }

    fun update(secondsLeft: Int) {
        countdownText?.text = "leaving in $secondsLeft…"
        root?.contentDescription = "Daily short-video limit reached. Leaving in $secondsLeft seconds. Cancel to stay."
    }

    fun hide() {
        val v = root ?: return
        root = null; headline = null; detail = null; brain = null; countdownText = null
        runCatching { windowManager.removeViewImmediate(v) }
    }

    private fun attach() {
        val frame = createContent()
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.CENTER
            title = "Short-video limit countdown"
            if (Build.VERSION.SDK_INT >= 30) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            }
        }
        if (runCatching { windowManager.addView(frame, params) }.isSuccess) root = frame
        else { headline = null; detail = null; brain = null; countdownText = null }
    }

    /** The overlay's view tree; [headline], [detail] and [brain] point into it afterwards. */
    internal fun createContent(): View {
        val density = context.resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()
        val font = { res: Int -> runCatching { ResourcesCompat.getFont(context, res) }.getOrNull() }

        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(28), dp(24), dp(24))
            background = GradientDrawable().apply {
                setColor(0xFF1B1916.toInt())
                cornerRadius = dp(18).toFloat()
                setStroke(dp(1).coerceAtLeast(1), 0x66C6AB7C)
            }
        }
        val image = ImageView(context).apply {
            setImageResource(R.drawable.brain_stage_4)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        card.addView(image, LinearLayout.LayoutParams(dp(112), dp(112)))
        // Reads as one line, "Limit reached — leaving in 5…", set in two sizes.
        val titleView = TextView(context).apply {
            text = "Limit reached —"
            setTextColor(0xFFF5F1E9.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            typeface = font(R.font.inter_semibold) ?: Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, dp(16), 0, 0)
        }
        card.addView(titleView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val counter = TextView(context).apply {
            setTextColor(0xFFE3BF78.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 36f)
            typeface = font(R.font.inter_semibold) ?: Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            fontFeatureSettings = "tnum"
            setPadding(0, dp(2), 0, dp(10))
        }
        card.addView(counter, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val body = TextView(context).apply {
            setTextColor(0xFFC3BCB0.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = font(R.font.inter_regular)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(24))
        }
        card.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val cancel = TextView(context).apply {
            text = "Cancel"
            setTextColor(0xFF090909.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = font(R.font.inter_semibold) ?: Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            contentDescription = "Cancel, keep watching this video"
            background = GradientDrawable().apply {
                setColor(0xFFE3BF78.toInt())
                cornerRadius = dp(32).toFloat()
            }
            setOnClickListener { onCancel() }
        }
        card.addView(cancel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64)))

        val frame = FrameLayout(context).apply {
            setBackgroundColor(0xE6000000.toInt())
            // Swallow touches on the scrim so the reel underneath cannot be swiped past.
            isClickable = true
            addView(
                card,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
                    .apply { leftMargin = dp(20); rightMargin = dp(20) },
            )
        }

        headline = titleView; detail = body; brain = image; countdownText = counter
        return frame
    }
}
