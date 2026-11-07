package desi.creative.vitals

import java.util.Collections
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Activity recreation must not leave the previous Bridge observing native state. No ring/runtime is started here. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class GaugeEnginePluginLifecycleTest {
    private fun scope(plugin: GaugeEnginePlugin): CoroutineScope =
        GaugeEnginePlugin::class.java.getDeclaredField("scope").apply { isAccessible = true }.get(plugin) as CoroutineScope

    private fun destroy(plugin: GaugeEnginePlugin) {
        GaugeEnginePlugin::class.java.getDeclaredMethod("handleOnDestroy").apply { isAccessible = true }.invoke(plugin)
    }

    @Test fun destroyedBridgeStopsObservingWhileItsReplacementKeepsReceivingState() = runBlocking {
        val signal = MutableStateFlow(0)
        val oldPlugin = GaugeEnginePlugin()
        val oldValues = Collections.synchronizedList(mutableListOf<Int>())
        val oldCollector = scope(oldPlugin).launch(start = CoroutineStart.UNDISPATCHED) {
            signal.collect { oldValues.add(it) }
        }
        assertTrue(oldCollector.isActive)
        destroy(oldPlugin)
        oldCollector.join()
        assertFalse(oldCollector.isActive)

        val newPlugin = GaugeEnginePlugin()
        val newValues = Collections.synchronizedList(mutableListOf<Int>())
        val newCollector = scope(newPlugin).launch(start = CoroutineStart.UNDISPATCHED) {
            signal.collect { newValues.add(it) }
        }
        try {
            signal.value = 1
            withTimeout(1000) { while (newValues.lastOrNull() != 1) delay(1) }
            assertEquals(listOf(0), oldValues.toList())
            assertEquals(listOf(0, 1), newValues.toList())
            assertTrue(newCollector.isActive)
        } finally {
            destroy(newPlugin)
            newCollector.join()
        }
    }
}
