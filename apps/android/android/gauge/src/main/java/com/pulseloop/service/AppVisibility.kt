package com.pulseloop.service

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/** Process visibility has no polling timer. Install once on the Application's main thread. */
object AppVisibility {
    private val visible = MutableStateFlow(false)
    val isVisible: StateFlow<Boolean> = visible.asStateFlow()
    private var observedLifecycle: Lifecycle? = null
    private val observer = LifecycleEventObserver { owner, _ ->
        visible.value = owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    }

    fun start(lifecycle: Lifecycle = ProcessLifecycleOwner.get().lifecycle) {
        if (observedLifecycle === lifecycle) return
        observedLifecycle?.removeObserver(observer)
        observedLifecycle = lifecycle
        visible.value = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        lifecycle.addObserver(observer)
    }
}

/** Cancels Room subscriptions and their in-flight work on STOP; resumes immediately on START. */
fun CoroutineScope.launchWhileVisible(
    visibility: StateFlow<Boolean>,
    block: suspend CoroutineScope.() -> Unit,
): Job = launch {
    visibility.collectLatest { visible ->
        if (visible) kotlinx.coroutines.coroutineScope { block() }
    }
}
