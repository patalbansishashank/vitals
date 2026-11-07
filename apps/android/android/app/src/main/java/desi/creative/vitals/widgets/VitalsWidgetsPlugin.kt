package desi.creative.vitals.widgets

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The `VitalsWidgets` plugin (web side: src/platform/widgets.ts). The web app publishes a small snapshot whenever Today's
 * figures or the ring's change (throttled) and when it goes to the background; this keeps it (WidgetState) and redraws
 * the widgets. A widget tap waits in WidgetState until the web side takes it (`open` event, then `takeOpen`).
 *
 * (r071) `status` says which widgets are placed (by card) and which snapshot revision this build reads, so the web feed
 * builds a card's pictures only for a widget that exists and only for a shell that can draw them; `pin` asks the launcher
 * to pin a widget of a card (the person confirms on the home screen).
 */
@CapacitorPlugin(name = "VitalsWidgets")
class VitalsWidgetsPlugin : Plugin() {

    override fun load() {
        WidgetState.plugin = this
        if (WidgetState.hasPendingOpen()) announceOpen()
    }

    override fun handleOnDestroy() {
        if (WidgetState.plugin === this) WidgetState.plugin = null
    }

    /** The app goes to the background: the web side publishes what it has now. */
    override fun handleOnPause() {
        notifyListeners("pause", JSObject())
    }

    /** A widget tap is waiting (main thread, from MainActivity or on load). Retained until the web side listens. */
    fun announceOpen() {
        notifyListeners("open", JSObject(), true)
    }

    @PluginMethod
    fun publish(call: PluginCall) {
        val snap = call.getObject("snapshot")?.let { WidgetSnapshot.parse(it) }
        if (snap == null) {
            call.reject("not a widget snapshot", "invalid")
            return
        }
        val ctx = context
        WidgetState.saveSnapshot(ctx, snap.toJson().toString())
        VitalsWidgets.updateData(ctx)
        call.resolve(JSObject().put("placed", VitalsWidgets.placedCount(ctx)))
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val ctx = context
        val byCard = VitalsWidgets.placedByCard(ctx)
        val counts = JSObject().also { o -> byCard.forEach { (card, n) -> o.put(card, n) } }
        call.resolve(
            JSObject().put("placed", byCard.values.sum()).put("byCard", counts).put("contract", WidgetSnapshot.CONTRACT).put("pin", VitalsWidgets.canPin(ctx)),
        )
    }

    /** Ask the launcher to pin a widget of a card. Nothing is added without the person's confirmation on the home screen. */
    @PluginMethod
    fun pin(call: PluginCall) {
        val result = VitalsWidgets.requestPin(context, call.getString("card"))
        if (result == null) {
            call.reject("not a widget card", "invalid")
            return
        }
        call.resolve(JSObject().put("supported", result.first).put("requested", result.second))
    }

    /** Forget the snapshot (the person erased their data or unpaired): the widgets ask for the app again. */
    @PluginMethod
    fun clear(call: PluginCall) {
        val ctx = context
        WidgetState.clearSnapshot(ctx)
        VitalsWidgets.updateData(ctx)
        call.resolve()
    }

    @PluginMethod
    fun takeOpen(call: PluginCall) {
        call.resolve(JSObject().put("path", WidgetState.takePendingOpen()))
    }
}
