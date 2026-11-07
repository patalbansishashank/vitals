package desi.creative.vitals.widgets

import desi.creative.vitals.widgets.design.WidgetTargets

/**
 * A widget tap opens one screen of the app. The PendingIntent names a target, never a path: MainActivity is exported
 * (launcher, App Links), so any app could send this action, and only the screens listed in design/widgets.json (the
 * generated `WidgetTargets`) can come of it (the Record sheet only opens; nothing starts without the person's own tap on
 * Start). The web side checks the path again against the router (src/app/navPort.ts), and a test checks that every
 * target is a screen of the app. Pure, so it is unit tested.
 */
object WidgetLinks {
    const val ACTION_OPEN = "desi.creative.vitals.action.WIDGET_OPEN"
    const val EXTRA_TARGET = "desi.creative.vitals.extra.WIDGET_TARGET"

    const val TODAY = "today"
    const val RING = "ring"
    const val LOG = "log"
    const val RECORD = "record"
    const val ENERGY = "energy"
    const val SLEEP = "sleep"
    const val STEPS = "steps"
    const val HR = "hr"
    const val WEIGHT = "weight"

    /** The app's paths by target id (design/widgets.json). */
    private val PATHS: Map<String, String> = WidgetTargets.PATHS

    val targets: List<String> get() = PATHS.keys.toList()

    /** The in-app path for a widget intent, or null for anything else. */
    fun pathFor(action: String?, target: String?): String? = if (action == ACTION_OPEN && target != null) PATHS[target] else null

    /** A stable PendingIntent request code per target (distinct, so the system keeps one PendingIntent each). */
    fun requestCode(target: String): Int = 7100 + PATHS.keys.indexOf(target).coerceAtLeast(0)
}
