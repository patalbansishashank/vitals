package com.pulseloop.service

/** Shared sleep chart and coach range; retained from the otherwise unused summary models. */
enum class SleepRangeKey(val key: String) {
    DAY("day"), WEEK("week"), MONTH("month"), YEAR("year");

    companion object {
        fun fromKey(key: String): SleepRangeKey? = entries.firstOrNull { it.key == key }
    }
}
