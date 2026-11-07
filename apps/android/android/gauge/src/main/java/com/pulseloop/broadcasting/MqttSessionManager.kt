package com.pulseloop.broadcasting

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Log
import com.pulseloop.data.dao.BroadcastOutboxDao
import kotlin.math.min
import kotlin.random.Random
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface BroadcastSessionState {
    data object Disabled : BroadcastSessionState
    data object Idle : BroadcastSessionState
    data object NoNetwork : BroadcastSessionState
    data object Connecting : BroadcastSessionState
    data object Connected : BroadcastSessionState
    data object Draining : BroadcastSessionState
    data class IdleTimeout(val closesAt: Long) : BroadcastSessionState
    data class Retrying(val delayMillis: Long, val error: String) : BroadcastSessionState
    data class InvalidConfiguration(val error: String) : BroadcastSessionState
    data class Stopped(val error: String, val kind: PermanentFailureKind) : BroadcastSessionState
}

/** Exponential broker-connect backoff with symmetric jitter, reset by success/network changes. */
class MqttRetryBackoff(
    private val random: () -> Double = { Random.nextDouble() },
) {
    private var failures = 0

    fun nextDelayMillis(): Long {
        val exponent = min(failures++, MAX_EXPONENT)
        val raw = min(INITIAL_MS shl exponent, MAX_MS)
        val jitter = JITTER_MIN + (JITTER_MAX - JITTER_MIN) * random().coerceIn(0.0, 1.0)
        return (raw * jitter).toLong().coerceIn((INITIAL_MS * JITTER_MIN).toLong(), MAX_MS)
    }

    fun reset() {
        failures = 0
    }

    companion object {
        const val INITIAL_MS = 10_000L
        const val MAX_MS = 300_000L
        private const val MAX_EXPONENT = 5
        private const val JITTER_MIN = 0.8
        private const val JITTER_MAX = 1.2
    }
}

interface BroadcastRecoveryScheduler {
    fun schedule()
    fun cancel()
}

/**
 * Owns the one MQTT session for the process. Every mutation is serialized through [commands], so
 * Paho callbacks, Room triggers, settings changes and Android network callbacks cannot race.
 */
class MqttSessionManager(
    private val scope: CoroutineScope,
    private val settingsStore: BroadcastSettingsSource,
    private val dao: BroadcastOutboxDao,
    private val recoveryScheduler: BroadcastRecoveryScheduler,
    private val sessionFactory: MqttSessionFactory = PahoMqttSessionFactory,
    private val now: () -> Long = System::currentTimeMillis,
    private val backoff: MqttRetryBackoff = MqttRetryBackoff(),
    private val idleTimeoutMillis: Long = IDLE_TIMEOUT_MS,
) {
    private sealed interface Command {
        data object Flush : Command
        data class Network(val available: Boolean) : Command
        data class Ring(val connected: Boolean) : Command
        data class Settings(val value: MqttBroadcastSettings) : Command
        data class ConnectionLost(val generation: Long, val cause: Throwable?) : Command
        data class Reconnected(val generation: Long) : Command
        data object RetryElapsed : Command
        data object IdleElapsed : Command
    }

    private val commands = Channel<Command>(Channel.UNLIMITED)
    private val flushQueued = AtomicBoolean(false)
    private val initialPermanentError = settingsStore.lastPermanentError.value
    private val initialPermanentKind = settingsStore.lastPermanentFailureKind.value
    private val _state = MutableStateFlow<BroadcastSessionState>(
        if (initialPermanentError != null && initialPermanentKind != null) {
            BroadcastSessionState.Stopped(initialPermanentError, initialPermanentKind)
        } else {
            BroadcastSessionState.Idle
        },
    )
    val state: StateFlow<BroadcastSessionState> = _state.asStateFlow()

    private var settings = settingsStore.settings.value
    private var session: MqttPublishSession? = null
    private var sessionGeneration = 0L
    private var networkAvailable = false
    private var ringConnected = false
    private var blockedRevision: Long? = settings.revision.takeIf {
        settingsStore.lastPermanentError.value != null
    }
    private var retryJob: Job? = null
    private var idleJob: Job? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    init {
        scope.launch {
            settingsStore.settings.collectLatest { commands.send(Command.Settings(it)) }
        }
        scope.launch {
            for (command in commands) {
                try {
                    if (command === Command.Flush) flushQueued.set(false)
                    handle(command)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (t: Throwable) {
                    Log.e("BroadcastSession", "MQTT session command failed", t)
                    if (settings.enabled && blockedRevision != settings.revision) {
                        scheduleRetry(safeMqttError(t, settings))
                    }
                }
            }
        }
    }

    fun requestFlush() {
        enqueueFlush()
    }

    fun setRingConnected(connected: Boolean) {
        commands.trySend(Command.Ring(connected))
    }

    fun onProcessForeground() = requestFlush()

    /** Registers only the zero-wakeup default-network callback; it is retained for process life. */
    fun registerNetworkCallback(context: Context) {
        if (networkCallback != null) return
        val connectivity = context.applicationContext
            .getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // A local MQTT broker is useful without validated internet access.
                commands.trySend(Command.Network(true))
            }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                    commands.trySend(Command.Network(true))
                }
            }
            override fun onLost(network: Network) = update(connectivity)

            private fun update(manager: ConnectivityManager) {
                commands.trySend(Command.Network(manager.activeNetwork != null))
            }
        }
        networkCallback = callback
        connectivity.registerDefaultNetworkCallback(callback)
        commands.trySend(Command.Network(connectivity.activeNetwork != null))
    }

    internal fun setNetworkAvailableForTest(available: Boolean) {
        commands.trySend(Command.Network(available))
    }

    private suspend fun handle(command: Command) {
        when (command) {
            is Command.Settings -> handleSettings(command.value)
            is Command.Network -> handleNetwork(command.available)
            is Command.Ring -> handleRing(command.connected)
            is Command.ConnectionLost -> {
                if (command.generation != sessionGeneration || session == null) return
                _state.value = if (networkAvailable) BroadcastSessionState.Connecting
                else BroadcastSessionState.NoNetwork
                if (dao.pendingCount() > 0) recoveryScheduler.schedule()
            }
            is Command.Reconnected -> {
                if (command.generation != sessionGeneration || session == null) return
                backoff.reset()
                retryJob?.cancel()
                retryJob = null
                _state.value = BroadcastSessionState.Connected
                enqueueFlush()
            }
            Command.RetryElapsed -> {
                retryJob = null
                enqueueFlush()
            }
            Command.IdleElapsed -> {
                idleJob = null
                if (!ringConnected && dao.pendingCount() == 0) closeSession()
            }
            Command.Flush -> flush()
        }
    }

    private suspend fun handleSettings(next: MqttBroadcastSettings) {
        if (next.revision != settings.revision) {
            blockedRevision = null
            retryJob?.cancel()
            retryJob = null
            backoff.reset()
            closeSession(updateState = false)
        }
        settings = next
        if (!next.enabled) {
            recoveryScheduler.cancel()
            closeSession(updateState = false)
            _state.value = BroadcastSessionState.Disabled
        } else {
            enqueueFlush()
        }
    }

    private suspend fun handleNetwork(available: Boolean) {
        val changed = networkAvailable != available
        networkAvailable = available
        if (!available) {
            retryJob?.cancel()
            retryJob = null
            if (settings.enabled && blockedRevision != settings.revision) {
                _state.value = BroadcastSessionState.NoNetwork
            }
            if (settings.enabled && blockedRevision != settings.revision && dao.pendingCount() > 0) {
                recoveryScheduler.schedule()
            }
        } else if (changed) {
            backoff.reset()
            retryJob?.cancel()
            retryJob = null
            if (session != null && session?.isConnected != true) {
                _state.value = BroadcastSessionState.Connecting
            }
            enqueueFlush()
        }
    }

    private suspend fun handleRing(connected: Boolean) {
        ringConnected = connected
        if (connected) {
            idleJob?.cancel()
            idleJob = null
            if (session?.isConnected == true && _state.value is BroadcastSessionState.IdleTimeout) {
                _state.value = BroadcastSessionState.Connected
            }
        } else if (dao.pendingCount() == 0) {
            if (session != null && session?.isConnected != true) {
                closeSession()
            } else {
                scheduleIdleClose()
            }
        }
    }

    private suspend fun flush() {
        if (!settings.enabled) {
            recoveryScheduler.cancel()
            _state.value = BroadcastSessionState.Disabled
            return
        }
        settings.validationError()?.let {
            retryJob?.cancel()
            retryJob = null
            recoveryScheduler.cancel()
            _state.value = BroadcastSessionState.InvalidConfiguration(it)
            return
        }
        if (blockedRevision == settings.revision) {
            recoveryScheduler.cancel()
            return
        }
        if (retryJob?.isActive == true) return
        if (dao.pendingCount() == 0) {
            recoveryScheduler.cancel()
            afterQueueEmpty()
            return
        }
        if (!networkAvailable) {
            _state.value = BroadcastSessionState.NoNetwork
            recoveryScheduler.schedule()
            return
        }

        idleJob?.cancel()
        idleJob = null
        val drainSettings = settings
        var activeSession = session
        if (activeSession?.isConnected != true) {
            // Paho owns socket-loss reconnection for an established client. Its connectComplete
            // callback will re-arm the drain without a competing second client/session.
            if (activeSession != null &&
                _state.value in setOf(BroadcastSessionState.Connecting, BroadcastSessionState.NoNetwork)
            ) {
                if (dao.pendingCount() > 0) recoveryScheduler.schedule()
                return
            }
            if (activeSession != null) closeSession(updateState = false)
            _state.value = BroadcastSessionState.Connecting
            val generation = ++sessionGeneration
            activeSession = try {
                sessionFactory.connect(drainSettings, object : MqttSessionEvents {
                    override fun connectionLost(cause: Throwable?) {
                        commands.trySend(Command.ConnectionLost(generation, cause))
                    }
                    override fun connectComplete(reconnect: Boolean) {
                        if (reconnect) commands.trySend(Command.Reconnected(generation))
                    }
                }).also { session = it }
            } catch (t: Throwable) {
                if (t is CancellationException) throw t
                handleFailure(t, drainSettings)
                return
            }
            _state.value = BroadcastSessionState.Connected
        }

        _state.value = BroadcastSessionState.Draining
        when (val result = MqttOutboxDrainer(dao, now = now).drain(
            activeSession,
            drainSettings,
            settingsStore.installationId,
        )) {
            BroadcastDrainResult.Disabled -> _state.value = BroadcastSessionState.Disabled
            BroadcastDrainResult.Empty -> afterQueueEmpty()
            is BroadcastDrainResult.InvalidConfiguration ->
                _state.value = BroadcastSessionState.InvalidConfiguration(result.error)
            is BroadcastDrainResult.PermanentFailure -> stopPermanently(
                result.error,
                result.kind,
                drainSettings.revision,
            )
            is BroadcastDrainResult.Retry -> {
                closeSession(updateState = false)
                scheduleRetry(result.error)
            }
            is BroadcastDrainResult.Success -> {
                backoff.reset()
                if (result.hasMore) enqueueFlush() else afterQueueEmpty()
            }
        }
    }

    private suspend fun handleFailure(error: Throwable, failedSettings: MqttBroadcastSettings) {
        val safe = safeMqttError(error, failedSettings)
        when (val classification = classifyMqttFailure(error)) {
            is MqttFailureClassification.Permanent -> stopPermanently(
                safe,
                classification.kind,
                failedSettings.revision,
            )
            MqttFailureClassification.Transient -> scheduleRetry(safe)
        }
    }

    private suspend fun stopPermanently(
        error: String,
        kind: PermanentFailureKind,
        failedRevision: Long,
    ) {
        // A settings save can complete while Paho is awaiting CONNACK. The store compares and
        // writes atomically, so that old refusal can never be attached to the new credentials.
        if (!settingsStore.recordPermanentError(error, kind, failedRevision)) {
            closeSession(updateState = false)
            commands.trySend(Command.Settings(settingsStore.settings.value))
            return
        }
        blockedRevision = settings.revision
        retryJob?.cancel()
        retryJob = null
        recoveryScheduler.cancel()
        closeSession(updateState = false)
        _state.value = BroadcastSessionState.Stopped(error, kind)
    }

    private fun scheduleRetry(error: String) {
        recoveryScheduler.schedule()
        if (retryJob?.isActive == true) return
        val delayMillis = backoff.nextDelayMillis()
        _state.value = BroadcastSessionState.Retrying(delayMillis, error)
        retryJob = scope.launch {
            delay(delayMillis)
            commands.send(Command.RetryElapsed)
        }
    }

    private fun enqueueFlush() {
        if (flushQueued.compareAndSet(false, true)) {
            commands.trySend(Command.Flush)
        }
    }

    private suspend fun afterQueueEmpty() {
        recoveryScheduler.cancel()
        if (session?.isConnected != true) {
            if (session != null && ringConnected) {
                _state.value = if (networkAvailable) BroadcastSessionState.Connecting
                else BroadcastSessionState.NoNetwork
            } else {
                closeSession()
            }
        } else if (ringConnected) {
            _state.value = BroadcastSessionState.Connected
        } else {
            scheduleIdleClose()
        }
    }

    private fun scheduleIdleClose() {
        if (session?.isConnected != true) {
            _state.value = BroadcastSessionState.Idle
            return
        }
        if (idleJob?.isActive == true) return
        val closesAt = now() + idleTimeoutMillis
        _state.value = BroadcastSessionState.IdleTimeout(closesAt)
        idleJob = scope.launch {
            delay(idleTimeoutMillis)
            commands.send(Command.IdleElapsed)
        }
    }

    private suspend fun closeSession(updateState: Boolean = true) {
        idleJob?.cancel()
        idleJob = null
        val closing = session
        session = null
        sessionGeneration++
        runCatching { withContext(NonCancellable) { closing?.close() } }
            .onFailure { Log.w("BroadcastSession", "MQTT close failed", it) }
        if (updateState) _state.value = BroadcastSessionState.Idle
    }

    companion object {
        const val IDLE_TIMEOUT_MS = 5 * 60_000L
    }
}
