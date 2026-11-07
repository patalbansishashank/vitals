package desi.creative.vitals.widgets

import android.content.Context

/**
 * The snapshot store (SharedPreferences, private to the app and excluded from every backup by data_extraction_rules)
 * and the widget tap waiting for the web app. A tap can arrive before the bridge has loaded (a cold start): the path
 * waits here until the web side takes it (`VitalsWidgets.takeOpen`), the same way shared files wait in ShellState.
 */
object WidgetState {
    private const val PREFS = "vitals_widgets"
    private const val KEY_SNAPSHOT = "snapshot"

    /** The plugin instance while the bridge is loaded, so MainActivity can announce a tap. */
    @Volatile var plugin: VitalsWidgetsPlugin? = null

    private val lock = Any()
    private var pendingPath: String? = null

    fun setPendingOpen(path: String) = synchronized(lock) { pendingPath = path }

    fun hasPendingOpen(): Boolean = synchronized(lock) { pendingPath != null }

    /** Returns the waiting path and clears it. */
    fun takePendingOpen(): String? = synchronized(lock) { pendingPath.also { pendingPath = null } }

    fun saveSnapshot(ctx: Context, json: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_SNAPSHOT, json).apply()
    }

    fun snapshot(ctx: Context): WidgetSnapshot? = WidgetSnapshot.parse(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SNAPSHOT, null))

    fun clearSnapshot(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_SNAPSHOT).apply()
    }
}
