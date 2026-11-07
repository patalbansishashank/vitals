package com.pulseloop.service

/** Publishes a fully initialized runtime exactly once, including concurrent UI/worker entry. */
internal class ProcessRuntimeSlot<T : Any> {
    @Volatile private var value: T? = null
    fun ensure(create: () -> T): T {
        value?.let { return it }
        return synchronized(this) {
            value ?: create().also { value = it }
        }
    }
}
