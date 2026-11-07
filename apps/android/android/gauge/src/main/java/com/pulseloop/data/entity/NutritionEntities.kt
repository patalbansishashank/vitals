package com.pulseloop.data.entity

import androidx.room.*

/*
 * LEFTOVER DATA. Nutrition was removed from Gauge (food planning and logging live in the Vitals app).
 * The `meal_entries` and `food_products` tables, their entities and DAOs are kept on
 * purpose, with every row: no migration drops them, so the owner can still decide whether to
 * move past meals into Vitals. Only the data archive (export/import) and "delete all data"
 * still read or write them. Do not add new UI on top of them. (The `user_goals` intake goals
 * were settings, not meal data, and were removed: MIGRATION_32_33.)
 */

@Entity(tableName = "meal_entries", indices = [Index("date")])
data class MealEntryEntity(
    @PrimaryKey val id: String = java.util.UUID.randomUUID().toString(),
    val date: Long,
    val timestamp: Long,
    val name: String,
    val mealTypeRaw: String = "snack",
    val calories: Double,
    val proteinG: Double = 0.0,
    val carbsG: Double = 0.0,
    val fatG: Double = 0.0,
    val fiberG: Double? = null,
    val sugarG: Double? = null,
    val sodiumMg: Double? = null,
    val sourceRaw: String = "manual",
    val offProductCode: String? = null,
    val servingDescription: String? = null,
    val servingGrams: Double? = null,
    val quantity: Double = 1.0,
    /**
     * iOS `MealEntry.init` defaults `confidence: DecodeConfidence = .known`
     * (NutritionModels.swift:99), and its reader falls back to `.known` for an
     * unrecognized raw (:147). "medium" was never in the known/partial/unknown
     * vocabulary — nothing ever wrote it deliberately, it only leaked out of this
     * default. MIGRATION_22_23 normalizes the rows that got it.
     */
    val confidenceRaw: String = "known",
    val userEdited: Boolean = false,
    val notes: String? = null,
    /**
     * Canonical, validated JSON returned by the meal estimator before the user reviews or edits
     * the visible fields. The ordinary nutrition columns above remain the authoritative final
     * values; this is provenance/audit data, not a second source for totals.
     */
    val aiEstimateJson: String? = null,
    /** Non-secret [CoachProviderMode.rawValue] used for the estimate. */
    val aiProviderRaw: String? = null,
    /** Provider model slug used for the estimate. Never contains an API key. */
    val aiModel: String? = null,
    val loggedByCoach: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    /**
     * Last-modified stamp driving the Health Connect nutrition export watermark + record
     * version (Phase 6). Equals [createdAt] for the insert-once rows logged today; a future
     * in-place meal-edit path bumps it so the edited meal re-exports under the same
     * `pl-meal-<id>` clientRecordId. iOS's twin meal model carries this for the same reason.
     */
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "food_products", indices = [Index("lastUsedAt")])
data class CachedFoodProductEntity(
    @PrimaryKey val code: String,
    val name: String,
    val brand: String? = null,
    val energyKcal100g: Double,
    val protein100g: Double = 0.0,
    val carbs100g: Double = 0.0,
    val fat100g: Double = 0.0,
    val fiber100g: Double? = null,
    val sugars100g: Double? = null,
    val saturatedFat100g: Double? = null,
    val sodiumMg100g: Double? = null,
    val servingSizeText: String? = null,
    val servingQuantityG: Double? = null,
    val lastUsedAt: Long = System.currentTimeMillis(),
    val useCount: Int = 0,
)
