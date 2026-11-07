package com.pulseloop.shortvideo

import kotlin.math.atan2
import kotlin.math.cbrt
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * The colour of the count in the island: calm at the first reel of the day, red at the daily limit and beyond.
 *
 * The ramp runs warm white, amber, red and is interpolated in OKLCH (lightness, chroma, hue), not in RGB: the steps
 * look even and the middle stays as vivid as its ends instead of going grey. A colour outside sRGB is brought in by
 * lowering its chroma only. Lightness falls from 0.96 to 0.65, so every step is at least 4.5:1 on the pill's black
 * (the red, the darkest, is 5.8:1). With no limit set the count keeps the neutral warm white.
 */
object CountColour {
    private class Stop(val at: Double, val l: Double, val c: Double, val h: Double)

    private val STOPS = listOf(
        Stop(0.0, 0.96, 0.012, 85.0), // warm white, the colour of the countdown's title
        Stop(0.5, 0.84, 0.165, 78.0), // amber
        Stop(1.0, 0.65, 0.240, 27.5), // red
    )

    /** The count's colour with no limit to measure it against: the calm end of the ramp. */
    val NEUTRAL: Int = colourAt(0.0)

    /** 0 at the first reel up to 1 at the limit and beyond; null when there is no limit. */
    fun progress(count: Int, limit: Int): Double? = when {
        limit <= 0 -> null
        limit == 1 -> if (count >= 1) 1.0 else 0.0
        count <= 1 -> 0.0
        else -> ((count - 1.0) / (limit - 1.0)).coerceAtMost(1.0)
    }

    /** The colour (opaque ARGB) of [count] reels against the daily [limit]. */
    fun of(count: Int, limit: Int): Int = colourAt(progress(count, limit) ?: 0.0)

    private fun colourAt(t: Double): Int {
        val (l, c, h) = oklchAt(t)
        return srgb(l, c, h)
    }

    /** The ramp's lightness, chroma and hue (degrees) at [t] from 0 to 1, before it is brought into sRGB. */
    internal fun oklchAt(t: Double): Triple<Double, Double, Double> {
        val x = t.coerceIn(0.0, 1.0)
        val i = STOPS.indexOfLast { it.at <= x }.coerceAtMost(STOPS.size - 2)
        val from = STOPS[i]
        val to = STOPS[i + 1]
        val u = (x - from.at) / (to.at - from.at)
        // The short way round the hue circle.
        val turn = ((to.h - from.h + 540.0) % 360.0) - 180.0
        return Triple(
            from.l + (to.l - from.l) * u,
            from.c + (to.c - from.c) * u,
            (from.h + turn * u + 360.0) % 360.0,
        )
    }

    /** Lightness, chroma and hue (degrees) of an sRGB colour. */
    internal fun toOklch(argb: Int): Triple<Double, Double, Double> {
        val (l, a, b) = toOklab(argb)
        return Triple(l, hypot(a, b), (Math.toDegrees(atan2(b, a)) + 360.0) % 360.0)
    }

    /** WCAG contrast ratio of an sRGB colour on black, 1 to 21. */
    internal fun contrastOnBlack(argb: Int): Double {
        val y = 0.2126 * linear(argb shr 16 and 0xFF) + 0.7152 * linear(argb shr 8 and 0xFF) + 0.0722 * linear(argb and 0xFF)
        return (y + 0.05) / 0.05
    }

    private fun linear(channel: Int): Double {
        val v = channel / 255.0
        return if (v <= 0.04045) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
    }

    private fun encode(linear: Double): Int {
        val v = linear.coerceIn(0.0, 1.0)
        return ((if (v <= 0.0031308) 12.92 * v else 1.055 * v.pow(1 / 2.4) - 0.055) * 255).roundToInt()
    }

    private fun toOklab(argb: Int): Triple<Double, Double, Double> {
        val r = linear(argb shr 16 and 0xFF)
        val g = linear(argb shr 8 and 0xFF)
        val b = linear(argb and 0xFF)
        val l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        val m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        val s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return Triple(
            0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
        )
    }

    /** Linear sRGB of an OKLab colour; a channel outside 0..1 is outside the gamut. */
    private fun toLinearSrgb(l: Double, a: Double, b: Double): DoubleArray {
        val x = (l + 0.3963377774 * a + 0.2158037573 * b).let { it * it * it }
        val y = (l - 0.1055613458 * a - 0.0638541728 * b).let { it * it * it }
        val z = (l - 0.0894841775 * a - 1.2914855480 * b).let { it * it * it }
        return doubleArrayOf(
            4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
            -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
            -0.0041960863 * x - 0.7034186147 * y + 1.7076147010 * z,
        )
    }

    private fun srgb(l: Double, c: Double, h: Double): Int {
        val hue = Math.toRadians(h)
        fun at(chroma: Double) = toLinearSrgb(l, chroma * cos(hue), chroma * sin(hue))
        fun inGamut(rgb: DoubleArray) = rgb.all { it > -0.0001 && it < 1.0001 }
        var rgb = at(c)
        if (!inGamut(rgb)) {
            // The most chroma this lightness and hue can have in sRGB.
            var low = 0.0
            var high = c
            repeat(24) {
                val mid = (low + high) / 2
                if (inGamut(at(mid))) low = mid else high = mid
            }
            rgb = at(low)
        }
        return 0xFF shl 24 or (encode(rgb[0]) shl 16) or (encode(rgb[1]) shl 8) or encode(rgb[2])
    }
}
