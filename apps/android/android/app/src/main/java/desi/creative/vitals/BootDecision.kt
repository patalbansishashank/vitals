package desi.creative.vitals

/**
 * What the native layer does after a phone restart or an app update, with no JS running (contract: "Behaviour
 * without JS"). Pure, so it can be unit tested; the receiver feeds it the facts.
 */
object BootDecision {
    const val ACTION_BOOT = "android.intent.action.BOOT_COMPLETED"
    const val ACTION_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED"

    enum class Outcome { NOTHING, NOTIFY_TAP_TO_CONNECT }

    /**
     * Post the quiet "Tap to connect your ring" notification only when the person asked to keep the ring connected,
     * a ring is known, and the app is not already running (then its own JS handles the link). Android does not let
     * an app open its own screen from the background, hence a notification and never an activity start.
     */
    fun decide(action: String?, keepConnected: Boolean, ringKnown: Boolean, appRunning: Boolean): Outcome {
        if (action != ACTION_BOOT && action != ACTION_REPLACED) return Outcome.NOTHING
        if (appRunning) return Outcome.NOTHING
        return if (keepConnected && ringKnown) Outcome.NOTIFY_TAP_TO_CONNECT else Outcome.NOTHING
    }
}
