package desi.creative.vitals.widgets

import android.appwidget.AppWidgetManager
import android.os.Build
import android.os.Bundle
import android.util.SizeF

/** The three shapes a widget is drawn in (r071): a launcher's cells vary (a "2x2" can be 130x220 dp, a "4x2" 276 to 376 dp wide), so a widget reads its own size, never a cell count. */
enum class SizeClass { STRIP, SQUARE, WIDE }

/** One widget instance's size in dp. */
data class WidgetSize(val widthDp: Int, val heightDp: Int) {
    val cls: SizeClass get() = classOf(widthDp, heightDp)

    companion object {
        /** Under this tall is a strip (a 4x1). */
        const val STRIP_BELOW_DP = 90

        /** Under this wide is a square (a 2x2); from it, wide. */
        const val WIDE_FROM_DP = 200

        fun classOf(widthDp: Int, heightDp: Int): SizeClass = when {
            heightDp < STRIP_BELOW_DP -> SizeClass.STRIP
            widthDp < WIDE_FROM_DP -> SizeClass.SQUARE
            else -> SizeClass.WIDE
        }

        /**
         * The size an instance has now, from its own options: on Android 12+ the entry of `OPTION_APPWIDGET_SIZES` for the
         * orientation (the narrowest is the portrait one, the widest the landscape one); otherwise, and below 12, the
         * pair the launcher estimates (portrait: minimum width by maximum height; landscape: maximum width by minimum
         * height). `fallback` when the launcher has not said yet (a widget just placed).
         */
        fun from(options: Bundle?, landscape: Boolean, fallback: WidgetSize, sdk: Int = Build.VERSION.SDK_INT): WidgetSize {
            if (options == null) return fallback
            var sizes: List<Pair<Float, Float>> = emptyList()
            if (sdk >= Build.VERSION_CODES.S) {
                @Suppress("DEPRECATION")
                val list = options.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
                sizes = list.orEmpty().map { it.width to it.height }
            }
            return choose(
                sizes = sizes,
                minW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0),
                minH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0),
                maxW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0),
                maxH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0),
                landscape = landscape,
                fallback = fallback,
            )
        }

        /** Pure: the size from what the launcher gave (sizes in dp; any 0 means "not said"). */
        fun choose(sizes: List<Pair<Float, Float>>, minW: Int, minH: Int, maxW: Int, maxH: Int, landscape: Boolean, fallback: WidgetSize): WidgetSize {
            val pick = if (landscape) sizes.maxByOrNull { it.first } else sizes.minByOrNull { it.first }
            if (pick != null && pick.first > 0f && pick.second > 0f) return WidgetSize(pick.first.toInt(), pick.second.toInt())
            val w = if (landscape) maxW else minW
            val h = if (landscape) minH else maxH
            return if (w > 0 && h > 0) WidgetSize(w, h) else fallback
        }
    }
}
