package com.pulseloop.health

import android.os.Bundle
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity

/**
 * Target of the "privacy policy" link in the Health Connect permission sheet — mandatory for
 * any app requesting health data types (official get-started guide). Pre-34 devices fire
 * `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` at this activity directly; API 34+
 * reaches the `ViewPermissionUsageActivity` alias (manifest, guarded by
 * START_VIEW_PERMISSION_USAGE), which targets this same screen.
 *
 * In-app rationale, no hosted URL — the Gadgetbridge precedent for sideload-only
 * distribution (docs/health-connect-integration.md §2, caveat 2).
 */
class HealthConnectRationaleActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val title = TextView(this).apply {
            text = "How Vitals uses Health Connect"
            textSize = 18f
            setTextColor(TEXT)
            setPadding(0, 0, 0, dp(12))
        }
        val body = TextView(this).apply {
            setTextColor(TEXT)
            text = """
                Vitals reads from Health Connect so the steps, workouts, heart rate, sleep, energy and weight that other apps record on this phone reach your own home server, beside your ring's readings. It reads: steps, distance, speed, power, exercise sessions, heart rate, heart rate variability, resting heart rate, sleep, active and total calories, basal metabolic rate, VO₂ max and weight.

                · Read only: Vitals never writes to Health Connect.
                · What it reads goes only to your own home server, where Vitals works out your day; nothing goes anywhere else.
                · Past data (up to a year) is read once, so your history is complete; after that every 15 minutes, in the background if you allow it.
                · You can revoke any permission at any time in the Health Connect app.
            """.trimIndent()
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            setBackgroundColor(BACKDROP)
            addView(title)
            addView(body)
        }
        setContentView(ScrollView(this).apply { setBackgroundColor(BACKDROP); addView(column) })
    }

    private companion object {
        /** Vitals' Ember backdrop and text (DESIGN.md): the app is dark only. */
        const val BACKDROP = 0xFF090909.toInt()
        const val TEXT = 0xFFEDEAE4.toInt()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
