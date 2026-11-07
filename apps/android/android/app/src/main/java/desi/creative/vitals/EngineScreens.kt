package desi.creative.vitals

import android.content.Intent
import android.net.Uri
import android.provider.Settings

/**
 * (r071) The system's own screens the `GaugeEngine` plugin opens for the owner. Opening one changes nothing: every
 * switch on them is the owner's to flip.
 */
object EngineScreens {
    /** Settings › Accessibility, where the short-video counter is switched on. */
    fun accessibility(): Intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)

    /**
     * Vitals' own App info page. On Android 13+ an app that came onto the phone as a file has its ⋮ menu item "Allow
     * restricted settings" here (after one denied attempt to turn the counter on); without it the accessibility switch
     * stays grey. It also holds the battery fallback.
     */
    fun appInfo(packageName: String): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
}
