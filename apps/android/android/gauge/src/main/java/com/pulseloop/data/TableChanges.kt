package com.pulseloop.data

import androidx.room.InvalidationTracker
import androidx.room.RoomDatabase
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn

/** A cheap invalidation signal for derived readers spanning several tables. No count/scan SQL.
 * The observer exists only while collected, so visible-only consumers unregister on STOP. */
fun RoomDatabase.tableChanges(vararg tables: String): Flow<Unit> = callbackFlow {
    val observer = object : InvalidationTracker.Observer(tables) {
        override fun onInvalidated(tables: Set<String>) { trySend(Unit) }
    }
    invalidationTracker.addObserver(observer)
    trySend(Unit)
    awaitClose { invalidationTracker.removeObserver(observer) }
}.buffer(Channel.CONFLATED).flowOn(queryExecutor.asCoroutineDispatcher())
