package com.pulseloop.shortvideo

import com.pulseloop.R

/**
 * How rotten today's brain is. Thresholds are fractions of the daily limit:
 * below 25 % healthy, then greying, wilted, green and cracked, rotting from the limit itself, and
 * fully rotten past 150 %.
 */
enum class BrainStage(val title: String, val caption: String) {
    HEALTHY("Healthy", "Pink, plump and pleased with you."),
    GREYING("Greying", "A little dusty around the folds."),
    WILTED("Wilted", "Drooping. Maybe look at a tree?"),
    CRACKED("Cracked", "Green-tinged and starting to crack."),
    ROTTING("Rotting", "The flies have found it."),
    ROTTEN("Fully rotten", "Past 150 % of your limit. It has opinions about this.");

    val drawableRes: Int
        get() = when (this) {
            HEALTHY -> R.drawable.brain_stage_0
            GREYING -> R.drawable.brain_stage_1
            WILTED -> R.drawable.brain_stage_2
            CRACKED -> R.drawable.brain_stage_3
            ROTTING -> R.drawable.brain_stage_4
            ROTTEN -> R.drawable.brain_stage_5
        }

    companion object {
        fun forCount(count: Int, limit: Int): BrainStage {
            if (count <= 0) return HEALTHY
            val ratio = count.toDouble() / limit.coerceAtLeast(1)
            return when {
                ratio > 1.5 -> ROTTEN
                ratio >= 1.0 -> ROTTING
                ratio >= 0.75 -> CRACKED
                ratio >= 0.5 -> WILTED
                ratio >= 0.25 -> GREYING
                else -> HEALTHY
            }
        }
    }
}
