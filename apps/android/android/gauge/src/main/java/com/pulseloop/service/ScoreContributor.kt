package com.pulseloop.service

/** Whether a contributor changes the score, is display-only context, or is currently unavailable. */
enum class ScoreContributorRole { SCORED, CONTEXT, UNAVAILABLE }

/**
 * Immutable, inspectable input to a composite wellness score.
 *
 * [weight] is the normalized weight actually applied (0 for context/unavailable); the original
 * formula share remains in [configuredWeight] so missing inputs and weight re-normalization are
 * visible instead of silently manufacturing a neutral value.
 */
data class ScoreContributor(
    val id: String,
    val label: String,
    val value: Double? = null,
    val unit: String? = null,
    val score: Double? = null,
    val weight: Double = 0.0,
    val configuredWeight: Double = 0.0,
    val explanation: String,
    val role: ScoreContributorRole,
)
