package com.pulseloop.broadcasting

import java.util.UUID
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken
import org.eclipse.paho.client.mqttv3.MqttAsyncClient
import org.eclipse.paho.client.mqttv3.MqttCallback
import org.eclipse.paho.client.mqttv3.MqttMessage
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Opt-in real-broker test: `MQTT_TEST_URI=tcp://127.0.0.1:18883 ./gradlew ...`. */
class MqttTransportSmokeTest {
    @Test
    fun `Paho invalid credentials make one MQTT 3_1_1 attempt`() = runBlocking {
        val uri = System.getenv("MQTT_TEST_URI").orEmpty()
        val username = System.getenv("MQTT_TEST_USERNAME").orEmpty()
        val badPassword = System.getenv("MQTT_TEST_BAD_PASSWORD").orEmpty()
        assumeTrue("MQTT bad-credential test is not configured",
            uri.isNotBlank() && username.isNotBlank() && badPassword.isNotBlank())

        val failure = runCatching {
            PahoMqttSessionFactory.connect(
                MqttBroadcastSettings(
                    true, uri, "unused", "bad-auth-${UUID.randomUUID()}", username, badPassword,
                ),
                NoOpSessionEvents,
            )
        }.exceptionOrNull() ?: throw AssertionError("Expected broker authentication refusal")
        assertEquals(
            MqttFailureClassification.Permanent(PermanentFailureKind.AUTHENTICATION),
            classifyMqttFailure(failure),
        )
    }

    @Test
    fun `Paho publisher reaches a real subscriber`() = runBlocking {
        val uri = System.getenv("MQTT_TEST_URI").orEmpty()
        assumeTrue("MQTT_TEST_URI is not configured", uri.isNotBlank())
        val topic = "pulseloop-test/${UUID.randomUUID()}"
        val received = Channel<String>(1)
        val subscriber = MqttAsyncClient(uri, "subscriber-${UUID.randomUUID()}", MemoryPersistence())
        subscriber.setCallback(object : MqttCallback {
            override fun connectionLost(cause: Throwable?) = Unit
            override fun deliveryComplete(token: IMqttDeliveryToken?) = Unit
            override fun messageArrived(topic: String?, message: MqttMessage?) {
                received.trySend(message?.payload?.toString(Charsets.UTF_8).orEmpty())
            }
        })
        subscriber.connect().waitForCompletion(10_000)
        subscriber.subscribe(topic, 1).waitForCompletion(10_000)

        val session = PahoMqttSessionFactory.connect(
            MqttBroadcastSettings(true, uri, "unused", "publisher-${UUID.randomUUID()}", "", ""),
            object : MqttSessionEvents {
                override fun connectionLost(cause: Throwable?) = Unit
                override fun connectComplete(reconnect: Boolean) = Unit
            },
        )
        try {
            session.publish(topic, "hello-health-event".toByteArray(), 1, false)
            assertEquals("hello-health-event", withTimeout(10_000) { received.receive() })
        } finally {
            session.close()
            runCatching { subscriber.disconnect().waitForCompletion(5_000) }
            runCatching { subscriber.close() }
        }
    }

    @Test
    fun `Paho publisher preserves one topic order across one hundred inflight messages`() = runBlocking {
        val uri = System.getenv("MQTT_TEST_URI").orEmpty()
        assumeTrue("MQTT_TEST_URI is not configured", uri.isNotBlank())
        val topic = "pulseloop-test/${UUID.randomUUID()}/ordered"
        val received = Channel<Int>(Channel.UNLIMITED)
        val subscriber = MqttAsyncClient(uri, "subscriber-${UUID.randomUUID()}", MemoryPersistence())
        subscriber.setCallback(object : MqttCallback {
            override fun connectionLost(cause: Throwable?) = Unit
            override fun deliveryComplete(token: IMqttDeliveryToken?) = Unit
            override fun messageArrived(topic: String?, message: MqttMessage?) {
                received.trySend(message?.payload?.toString(Charsets.UTF_8)?.toInt() ?: -1)
            }
        })
        subscriber.connect().waitForCompletion(10_000)
        subscriber.subscribe(topic, 1).waitForCompletion(10_000)

        val session = PahoMqttSessionFactory.connect(
            MqttBroadcastSettings(true, uri, "unused", "publisher-${UUID.randomUUID()}", "", ""),
            NoOpSessionEvents,
        )
        try {
            coroutineScope {
                (0 until 100).chunked(10).forEach { batch ->
                    batch.map { value ->
                        async {
                            session.publish(topic, value.toString().toByteArray(), 1, false)
                        }
                    }.forEach { it.await() }
                }
            }
            val actual = withTimeout(15_000) { List(100) { received.receive() } }
            assertEquals((0 until 100).toList(), actual)
        } finally {
            session.close()
            runCatching { subscriber.disconnect().waitForCompletion(5_000) }
            runCatching { subscriber.close() }
        }
    }

    private object NoOpSessionEvents : MqttSessionEvents {
        override fun connectionLost(cause: Throwable?) = Unit
        override fun connectComplete(reconnect: Boolean) = Unit
    }
}
