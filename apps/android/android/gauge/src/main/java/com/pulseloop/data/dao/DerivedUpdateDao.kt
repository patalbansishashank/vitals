package com.pulseloop.data.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import com.pulseloop.data.entity.DerivedUpdateEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DerivedUpdateDao {
    @Upsert
    suspend fun upsert(update: DerivedUpdateEntity)

    @Query("SELECT * FROM derived_updates WHERE kind = :kind ORDER BY timestamp DESC LIMIT 1")
    suspend fun latest(kind: String): DerivedUpdateEntity?

    @Query("DELETE FROM derived_updates WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("SELECT * FROM derived_updates ORDER BY timestamp DESC LIMIT :limit")
    fun recentFlow(limit: Int = 50): Flow<List<DerivedUpdateEntity>>

    // Include the last supported aerobic estimate even after newer daily indices accumulate.
    @Query("SELECT * FROM derived_updates WHERE entityType = 'local_insight' ORDER BY timestamp DESC")
    fun localInsightsFlow(): Flow<List<DerivedUpdateEntity>>
}
