package desi.creative.vitals.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/**
 * The home-screen widgets, one provider per card (the picker is the library). Each draws from the stored snapshot only (no
 * network, no web app): on placement, on the system's 30-minute update (so "as of" and the clock times stay true) and on a
 * resize, each instance at its own size. The app redraws them whenever it publishes a new snapshot (VitalsWidgetsPlugin).
 *
 * The four classes that existed before r071 keep their names (renaming or removing one deletes the widgets placed from it):
 * Today is now the three-ring glance, Ring is Heart rate.
 */
abstract class VitalsWidgetProvider(private val kind: VitalsWidgets.Kind) : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        if (ids.isNotEmpty()) VitalsWidgets.updateKind(context, kind, ids)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        VitalsWidgets.updateKind(context, kind, intArrayOf(id))
    }
}

class TodayWidgetProvider : VitalsWidgetProvider(VitalsWidgets.Kind.TODAY)

class RingWidgetProvider : VitalsWidgetProvider(VitalsWidgets.Kind.RING)

class ActionsWidgetProvider : VitalsWidgetProvider(VitalsWidgets.Kind.ACTIONS)

class LogWidgetProvider : VitalsWidgetProvider(VitalsWidgets.Kind.LOG)

class EnergyWidgetProvider : VitalsWidgetProvider(VitalsWidgets.Kind.ENERGY)

class SleepWidgetProvider : VitalsWidgetProvider(VitalsWidgets.Kind.SLEEP)

class StepsWidgetProvider : VitalsWidgetProvider(VitalsWidgets.Kind.STEPS)

class WeightWidgetProvider : VitalsWidgetProvider(VitalsWidgets.Kind.WEIGHT)
