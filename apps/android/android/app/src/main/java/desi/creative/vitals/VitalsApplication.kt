package desi.creative.vitals

import android.app.Application
import com.pulseloop.GaugeEngine

/**
 * (0.7.0) The app process. Gauge's engine lives in this app now: starting it is what Gauge's own Application did, but only
 * once the Gauge app is gone and the owner has tapped take over ([GaugeEngine]); until then this does nothing at all.
 */
class VitalsApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // A failing engine must never keep Vitals itself from opening; the Ring screens show it as not running.
        runCatching { GaugeEngine.onAppCreate(this) }
            .onFailure { android.util.Log.e("VitalsApplication", "Ring engine did not start", it) }
    }
}
