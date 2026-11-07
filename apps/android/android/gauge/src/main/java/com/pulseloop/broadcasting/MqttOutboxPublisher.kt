package com.pulseloop.broadcasting

import com.pulseloop.data.dao.BroadcastOutboxDao
import com.pulseloop.data.entity.BroadcastOutboxEntity
import java.io.IOException
import javax.net.ssl.SSLException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import org.eclipse.paho.client.mqttv3.IMqttActionListener
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken
import org.eclipse.paho.client.mqttv3.IMqttToken
import org.eclipse.paho.client.mqttv3.MqttAsyncClient
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended
import org.eclipse.paho.client.mqttv3.MqttConnectOptions
import org.eclipse.paho.client.mqttv3.MqttException
import org.eclipse.paho.client.mqttv3.MqttMessage
import org.eclipse.paho.client.mqttv3.MqttSecurityException
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence

enum class PermanentFailureKind { AUTHENTICATION, CLIENT_CONFIGURATION, TLS }

sealed interface BroadcastDrainResult {
    data object Disabled : BroadcastDrainResult
    data object Empty : BroadcastDrainResult
    data class InvalidConfiguration(val error: String) : BroadcastDrainResult
    data class Success(val published: Int, val hasMore: Boolean = false) : BroadcastDrainResult
    data class PermanentFailure(
        val error: String,
        val kind: PermanentFailureKind,
        val published: Int = 0,
    ) : BroadcastDrainResult
    data class Retry(val error: String, val published: Int = 0) : BroadcastDrainResult
}

interface MqttSessionEvents {
    fun connectionLost(cause: Throwable?)
    fun connectComplete(reconnect: Boolean)
}

interface MqttPublishSession {
    val isConnected: Boolean
    suspend fun publish(topic: String, payload: ByteArray, qos: Int, retained: Boolean)
    suspend fun close()
}

fun interface MqttSessionFactory {
    suspend fun connect(
        settings: MqttBroadcastSettings,
        events: MqttSessionEvents,
    ): MqttPublishSession
}

/** MQTT 3.1.1 session backed by Eclipse Paho's JVM client. Room, not Paho, owns durability. */
object PahoMqttSessionFactory : MqttSessionFactory {
    override suspend fun connect(
        settings: MqttBroadcastSettings,
        events: MqttSessionEvents,
    ): MqttPublishSession {
        val client = MqttAsyncClient(settings.brokerUri, settings.clientId, MemoryPersistence())
        client.setCallback(object : MqttCallbackExtended {
            override fun connectionLost(cause: Throwable?) = events.connectionLost(cause)
            override fun connectComplete(reconnect: Boolean, serverURI: String?) {
                events.connectComplete(reconnect)
            }
            override fun messageArrived(topic: String?, message: MqttMessage?) = Unit
            override fun deliveryComplete(token: IMqttDeliveryToken?) = Unit
        })
        val options = MqttConnectOptions().apply {
            // Paho's DEFAULT probes MQTT 3.1.1 and then retries MQTT 3.1 after any initial
            // refusal, which turns one bad-password save into two broker connections. The app's
            // wire contract is explicitly MQTT 3.1.1, so pin it and classify the single refusal.
            mqttVersion = MqttConnectOptions.MQTT_VERSION_3_1_1
            isCleanSession = true
            isAutomaticReconnect = true
            connectionTimeout = CONNECTION_TIMEOUT_SECONDS
            keepAliveInterval = settings.keepAliveSeconds
            maxInflight = MAX_INFLIGHT
            if (settings.username.isNotBlank()) userName = settings.username
            if (settings.password.isNotEmpty()) password = settings.password.toCharArray()
            isHttpsHostnameVerificationEnabled = true
        }
        try {
            awaitMqttAction { listener -> client.connect(options, null, listener) }
        } catch (t: Throwable) {
            runCatching { client.disconnectForcibly(0, 1_000, false) }
            runCatching { client.close(true) }
            throw t
        }
        return PahoMqttSession(client)
    }

    private const val CONNECTION_TIMEOUT_SECONDS = 12
    const val MAX_INFLIGHT = 10
}

private class PahoMqttSession(
    private val client: MqttAsyncClient,
) : MqttPublishSession {
    override val isConnected: Boolean get() = client.isConnected

    override suspend fun publish(topic: String, payload: ByteArray, qos: Int, retained: Boolean) {
        awaitMqttAction { listener ->
            client.publish(
                topic,
                MqttMessage(payload).apply {
                    this.qos = qos.coerceIn(0, 2)
                    isRetained = retained
                },
                null,
                listener,
            )
        }
    }

    override suspend fun close() {
        try {
            withTimeout(CLOSE_TIMEOUT_MS) {
                if (client.isConnected) {
                    awaitMqttAction { listener ->
                        client.disconnect(DISCONNECT_QUIESCE_MS, null, listener)
                    }
                } else {
                    // Stops Paho's automatic-reconnect scheduler when there is no live socket.
                    client.disconnectForcibly(0, DISCONNECT_QUIESCE_MS, false)
                }
            }
        } finally {
            // force=true also closes a client caught between reconnect attempts; callers can then
            // guarantee that idle means no Paho threads or timers survive.
            client.close(true)
        }
    }

    companion object {
        private const val DISCONNECT_QUIESCE_MS = 1_000L
        private const val CLOSE_TIMEOUT_MS = 5_000L
    }
}

private suspend fun awaitMqttAction(start: (IMqttActionListener) -> IMqttToken) {
    suspendCancellableCoroutine<Unit> { continuation ->
        val listener = object : IMqttActionListener {
            override fun onSuccess(asyncActionToken: IMqttToken?) {
                if (continuation.isActive) continuation.resume(Unit)
            }

            override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) {
                if (continuation.isActive) {
                    continuation.resumeWithException(exception ?: IOException("MQTT action failed"))
                }
            }
        }
        try {
            start(listener)
        } catch (t: Throwable) {
            if (continuation.isActive) continuation.resumeWithException(t)
        }
    }
}

/** Publishes acknowledged subsets in batches while a process-held session remains open. */
class MqttOutboxDrainer(
    private val dao: BroadcastOutboxDao,
    private val now: () -> Long = System::currentTimeMillis,
    private val elapsedNow: () -> Long = { System.nanoTime() / 1_000_000L },
    private val maxInflight: Int = PahoMqttSessionFactory.MAX_INFLIGHT,
    private val maxRowsPerDrain: Int = 2_000,
    private val maxDrainMillis: Long = 30_000L,
) {
    suspend fun drain(
        session: MqttPublishSession,
        settings: MqttBroadcastSettings,
        installationId: String,
    ): BroadcastDrainResult {
        if (!settings.enabled) return BroadcastDrainResult.Disabled
        settings.validationError()?.let { return BroadcastDrainResult.InvalidConfiguration(it) }

        val startedAt = elapsedNow()
        var published = 0
        while (published < maxRowsPerDrain && elapsedNow() - startedAt < maxDrainMillis) {
            val batchLimit = minOf(maxInflight, maxRowsPerDrain - published)
            val pending = dao.pending(batchLimit)
            if (pending.isEmpty()) {
                return if (published == 0) BroadcastDrainResult.Empty
                else BroadcastDrainResult.Success(published)
            }

            val remainingMillis = (maxDrainMillis - (elapsedNow() - startedAt)).coerceAtLeast(1L)
            val outcomes = publishBatch(
                session,
                settings,
                installationId,
                pending,
                remainingMillis,
            )
            val succeeded = outcomes.filter { it.error == null }.map { it.row.eventId }
            val failed = outcomes.filter { it.error != null }
            if (succeeded.isNotEmpty()) {
                dao.markPublishedBatch(succeeded, now())
                published += succeeded.size
            }
            if (failed.isNotEmpty()) {
                val firstError = failed.first().error!!
                val safe = safeMqttError(firstError, settings)
                dao.markFailedBatch(failed.map { it.row.eventId }, now(), safe)
                return when (val classification = classifyMqttFailure(firstError)) {
                    is MqttFailureClassification.Permanent -> BroadcastDrainResult.PermanentFailure(
                        error = safe,
                        kind = classification.kind,
                        published = published,
                    )
                    MqttFailureClassification.Transient -> BroadcastDrainResult.Retry(safe, published)
                }
            }
        }
        return BroadcastDrainResult.Success(published, hasMore = dao.pendingCount() > 0)
    }

    private suspend fun publishBatch(
        session: MqttPublishSession,
        settings: MqttBroadcastSettings,
        installationId: String,
        rows: List<BroadcastOutboxEntity>,
        timeoutMillis: Long,
    ): List<PublishOutcome> = coroutineScope {
        rows.map { row ->
            // Every coroutine reaches Paho's publish call in list order before it is dispatched,
            // preserving per-topic order even on a deliberately reordering dispatcher.
            async(start = CoroutineStart.UNDISPATCHED) {
                val error = try {
                    withTimeout(timeoutMillis) {
                        session.publish(
                            topic = fullTopic(settings, installationId, row),
                            payload = row.payloadJson.toByteArray(Charsets.UTF_8),
                            qos = row.qos,
                            retained = row.retain,
                        )
                    }
                    null
                } catch (timeout: TimeoutCancellationException) {
                    timeout
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (t: Throwable) {
                    t
                }
                PublishOutcome(row, error)
            }
        }.awaitAll()
    }

    private fun fullTopic(
        settings: MqttBroadcastSettings,
        installationId: String,
        row: BroadcastOutboxEntity,
    ): String = "${settings.baseTopic.trim('/')}/$installationId/${row.topicSuffix.trim('/')}"

    private data class PublishOutcome(val row: BroadcastOutboxEntity, val error: Throwable?)
}

sealed interface MqttFailureClassification {
    data class Permanent(val kind: PermanentFailureKind) : MqttFailureClassification
    data object Transient : MqttFailureClassification
}

fun classifyMqttFailure(error: Throwable): MqttFailureClassification {
    val causes = generateSequence(error as Throwable?) { it.cause }.toList()
    if (causes.any { it is SSLException }) {
        return MqttFailureClassification.Permanent(PermanentFailureKind.TLS)
    }
    if (causes.any { it is MqttSecurityException }) {
        return MqttFailureClassification.Permanent(PermanentFailureKind.AUTHENTICATION)
    }
    val mqtt = causes.filterIsInstance<MqttException>().firstOrNull()
    return when (mqtt?.reasonCode?.toInt()) {
        MqttException.REASON_CODE_FAILED_AUTHENTICATION.toInt(),
        MqttException.REASON_CODE_NOT_AUTHORIZED.toInt() ->
            MqttFailureClassification.Permanent(PermanentFailureKind.AUTHENTICATION)
        MqttException.REASON_CODE_INVALID_PROTOCOL_VERSION.toInt(),
        MqttException.REASON_CODE_INVALID_CLIENT_ID.toInt() ->
            MqttFailureClassification.Permanent(PermanentFailureKind.CLIENT_CONFIGURATION)
        else -> MqttFailureClassification.Transient
    }
}

fun safeMqttError(error: Throwable, settings: MqttBroadcastSettings): String {
    var message = error.message.orEmpty()
    for (secret in listOf(settings.password, settings.username)) {
        if (secret.isNotEmpty()) message = message.replace(secret, "<redacted>")
    }
    val description = if (message.isBlank()) error.javaClass.simpleName
        else "${error.javaClass.simpleName}: $message"
    return description.take(300)
}
