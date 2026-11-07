package desi.creative.vitals.widgets

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.widget.FrameLayout
import desi.creative.vitals.widgets.WidgetSamples.now
import desi.creative.vitals.widgets.WidgetSamples.zone
import java.io.File
import java.io.FileOutputStream
import kotlin.math.roundToInt
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The picker's previews (`previewImage`, shown on every Android version; from Android 12 a `previewLayout` would show the
 * live layout with no figures): each widget at the size the picker offers, drawn by the very code that draws it on the
 * home screen, from the sample numbers (never a person's own), with a transparent ground. Written to
 * build/outputs/widget-previews; copy them to src/main/res/drawable-nodpi/vw_preview_<card>.png when the look changes
 * (apps/android/README.md says how).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xhdpi")
class WidgetPreviewsTest {
    private val ctx = RuntimeEnvironment.getApplication()
    private val out = File("build/outputs/widget-previews").apply { mkdirs() }

    /** The size the picker draws each widget at (dp): its default cells on a typical launcher. */
    private val sizes = mapOf(
        VitalsWidgets.Kind.TODAY to WidgetSize(320, 160),
        VitalsWidgets.Kind.RING to WidgetSize(160, 160),
        VitalsWidgets.Kind.ENERGY to WidgetSize(160, 160),
        VitalsWidgets.Kind.SLEEP to WidgetSize(160, 160),
        VitalsWidgets.Kind.STEPS to WidgetSize(160, 160),
        VitalsWidgets.Kind.WEIGHT to WidgetSize(160, 160),
        VitalsWidgets.Kind.ACTIONS to WidgetSize(320, 64),
        VitalsWidgets.Kind.LOG to WidgetSize(64, 64),
    )

    @Test
    fun everyWidgetHasAPreviewAtItsDefaultSize() {
        val d = ctx.resources.displayMetrics.density
        for (kind in VitalsWidgets.Kind.entries) {
            val size = sizes.getValue(kind)
            val rv = VitalsWidgets.views(ctx, kind, WidgetSamples.numbers(), now, zone, size)
            val v = rv.apply(ctx, FrameLayout(ctx))
            val w = (size.widthDp * d).roundToInt()
            val h = (size.heightDp * d).roundToInt()
            v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
            v.layout(0, 0, w, h)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            v.draw(Canvas(bmp))
            val file = File(out, "vw_preview_${kind.card}.png")
            FileOutputStream(file).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            assertTrue("${kind.card}: ${file.length()} bytes", file.length() in 1_000..400_000)
        }
    }
}
