package com.pulseloop.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InsightAlgorithmsTest {
    @Test
    fun `activity score reaches one hundred only when all three targets are met`() {
        val complete = InsightAlgorithms.activityScore(10_000, 45, 30.0, 10_000, 45)
        assertEquals(100.0, complete.value, 0.0001)

        val half = InsightAlgorithms.activityScore(5_000, 0, 0.0, 10_000, 45)
        assertEquals(20.0, half.value, 0.0001)
        assertEquals("low", half.confidence)
    }

    @Test
    fun `invalid activity duration cannot contaminate score or exported inputs`() {
        val result = InsightAlgorithms.activityScore(1000, 10, Double.NaN, 10000, 45)
        assertTrue(result.value.isFinite())
        assertTrue(result.inputs.values.all { it.isFinite() })
    }

    @Test
    fun `saved verbal effort participates in load with approximate provenance`() {
        assertEquals(2.0, InsightAlgorithms.sessionRpe("easy")!!, 0.0)
        assertEquals(3.0, InsightAlgorithms.sessionRpe("moderate")!!, 0.0)
        assertEquals(5.0, InsightAlgorithms.sessionRpe("hard")!!, 0.0)
        assertEquals(7.0, InsightAlgorithms.sessionRpe("very_hard")!!, 0.0)
        assertEquals(6.5, InsightAlgorithms.sessionRpe("6.5")!!, 0.0)
        assertNull(InsightAlgorithms.sessionRpe("NaN"))
        assertNull(InsightAlgorithms.sessionRpe("11"))
        val load = InsightAlgorithms.workoutLoad(30.0, null, null, null, null,
            InsightAlgorithms.sessionRpe("hard"), effortFromLabel = true)!!
        assertEquals(150.0, load.value, 0.0)
        assertEquals("low", load.confidence)
        assertEquals(1.0, load.inputs.getValue("rpe_from_label"), 0.0)
    }

    @Test
    fun `lnRMSSD is positive-only and keeps the observed value separate`() {
        assertEquals(kotlin.math.ln(50.0), InsightAlgorithms.lnRmssd(50.0)!!, 1e-9)
        assertNull(InsightAlgorithms.lnRmssd(0.0))
        assertNull(InsightAlgorithms.lnRmssd(Double.NaN))
    }

    @Test
    fun `recovery is withheld when sleep is the only usable component`() {
        assertNull(
            InsightAlgorithms.recoveryScore(
                hrv = null,
                hrvBaseline = null,
                restingHr = null,
                restingHrBaseline = null,
                sleepScore = 82.0,
                skinTemperature = null,
                temperatureBaseline = null,
            )
        )
    }

    @Test
    fun `recovery responds in the correct direction to HRV and resting HR`() {
        val baseline = established(mean = 50.0, sd = 5.0)
        val good = InsightAlgorithms.recoveryScore(60.0, baseline, 45.0, baseline, 80.0, null, null)!!
        val poor = InsightAlgorithms.recoveryScore(40.0, baseline, 60.0, baseline, 80.0, null, null)!!
        assertTrue(good.value > poor.value)
        assertTrue(good.inputs.containsKey("hrv_z"))
    }

    @Test
    fun `recovery exposes raw contributor values applied weights and explicit missing inputs`() {
        val baseline = established(mean = 50.0, sd = 5.0)
        val result = InsightAlgorithms.recoveryScore(
            hrv = 60.0, hrvBaseline = baseline,
            restingHr = 45.0, restingHrBaseline = baseline,
            sleepScore = 80.0, skinTemperature = 35.8,
            temperatureBaseline = baseline.copy(median = 35.5, p25 = 35.2, p75 = 35.8),
            priorDayLoadBalanceScore = 90.0,
        )!!
        val hrv = result.contributors.first { it.id == "hrv" }
        assertEquals("Heart rate variability", hrv.label)
        assertEquals(60.0, hrv.value!!, 0.0)
        assertEquals("ms", hrv.unit)
        assertTrue(hrv.weight > 0.0)
        assertNotNull(hrv.score)
        // Nutrition moved to the Vitals app: recovery no longer lists a nutrition input at all.
        assertTrue(result.contributors.none { it.id == "prior_day_nutrition" })
        assertEquals(1.0, result.contributors.sumOf { it.weight }, 1e-9)
    }

    @Test
    fun `recovery v5 drops nutrition and renormalises the remaining weights`() {
        assertEquals("lumen-recovery-v5", InsightAlgorithms.RECOVERY_VERSION)
        val w = InsightAlgorithms.RECOVERY_WEIGHTS
        assertEquals(listOf("hrv", "resting_hr", "sleep", "temperature", "prior_day_load"), w.keys.toList())
        assertEquals(1.0, w.values.sum(), 1e-12)
        // v4's 0.25 / 0.15 / 0.30 / 0.10 / 0.10 over the 0.90 left once nutrition's 0.10 is gone.
        assertEquals(0.25 / 0.90, w.getValue("hrv"), 1e-12)
        assertEquals(0.15 / 0.90, w.getValue("resting_hr"), 1e-12)
        assertEquals(0.30 / 0.90, w.getValue("sleep"), 1e-12)
        assertEquals(0.10 / 0.90, w.getValue("temperature"), 1e-12)
        assertEquals(0.10 / 0.90, w.getValue("prior_day_load"), 1e-12)

        // Sleep 80 and prior-day load 50 only: (80 * 0.30 + 50 * 0.10) / 0.40 = 72.5, as before.
        val result = InsightAlgorithms.recoveryScore(
            hrv = null, hrvBaseline = null, restingHr = null, restingHrBaseline = null,
            sleepScore = 80.0, skinTemperature = null, temperatureBaseline = null,
            priorDayLoadBalanceScore = 50.0,
        )!!
        assertEquals(72.5, result.value, 1e-9)
        assertEquals(1.0, result.contributors.sumOf { it.configuredWeight }, 1e-9)
        assertEquals(0.75, result.contributors.first { it.id == "sleep" }.weight, 1e-9)
        assertTrue(result.contributors.none { it.id == "prior_day_nutrition" })
        assertTrue(result.inputs.keys.none { it.contains("nutrition") })
    }

    @Test
    fun `TRIMP workout score increases with duration and heart rate`() {
        val easy = InsightAlgorithms.workoutScore(20.0, 120.0, 60.0, 190.0, false)!!
        val hard = InsightAlgorithms.workoutScore(45.0, 160.0, 60.0, 190.0, false)!!
        assertTrue(hard.value > easy.value)
        assertTrue(hard.inputs.getValue("trimp") > easy.inputs.getValue("trimp"))
    }

    @Test
    fun `session RPE is the preferred load for non-steady workouts`() {
        val load = InsightAlgorithms.workoutLoad(
            durationMinutes = 30.0,
            averageHeartRate = null,
            restingHeartRate = null,
            maximumHeartRate = null,
            female = null,
            perceivedEffort = 6.0,
        )!!
        assertEquals(180.0, load.value, 0.0001)
        assertEquals(6.0, load.inputs.getValue("session_rpe"), 0.0001)
        assertTrue(load.note.contains("Foster", ignoreCase = true))
    }

    @Test
    fun `Rockport estimate uses the documented normalized equation`() {
        val estimate = InsightAlgorithms.rockportVo2PeakEstimate(
            durationSeconds = 20.0 * 60.0,
            distanceMeters = 1609.344,
            finishHeartRate = 150.0,
            age = 28,
            weightKg = 82.0,
            sex = "male",
            standardizedTestConfirmed = true,
        )!!
        val expected = 132.853 - 0.0769 * (82.0 * 2.2046226218) - 0.3877 * 28 +
            6.315 - 3.2649 * 20.0 - 0.1565 * 150.0
        assertEquals(expected, estimate.value, 0.0001)
        assertEquals("low", estimate.confidence) // Kline cohort was 30–69 years
        assertTrue(estimate.note.contains("Rockport", ignoreCase = true))
    }

    @Test
    fun `Rockport estimate rejects a non-mile or too-short session`() {
        assertNull(InsightAlgorithms.rockportVo2PeakEstimate(300.0, 1609.344, 150.0, 28, 82.0, "male"))
        assertNull(InsightAlgorithms.rockportVo2PeakEstimate(1200.0, 800.0, 150.0, 28, 82.0, "male"))
    }

    @Test
    fun `VO2 estimate requires a long enough aerobic GPS workout`() {
        assertNull(InsightAlgorithms.vo2MaxEstimate("gym", 1800.0, 0.0, 140.0, 60.0, 190.0))
        assertNull(InsightAlgorithms.vo2MaxEstimate("run", 300.0, 1200.0, 150.0, 60.0, 190.0))

        val estimate = InsightAlgorithms.vo2MaxEstimate("run", 1800.0, 6_000.0, 150.0, 60.0, 190.0)
        assertNotNull(estimate)
        assertTrue(estimate!!.value in 10.0..90.0)
        assertEquals("low", estimate.confidence)
    }

    @Test
    fun `generic mile walk cannot silently become Rockport test`() {
        assertNull(InsightAlgorithms.rockportVo2PeakEstimate(1200.0, 1609.344, 150.0, 28, 82.0, "male"))
    }

    @Test
    fun `VO2 uses oxygen reserve and excludes hikes or wrong gait speeds`() {
        val estimate = InsightAlgorithms.vo2MaxEstimate("run", 1800.0, 6000.0, 150.0, 60.0, 190.0)!!
        assertEquals(3.5 + 40.0 / (90.0 / 130.0), estimate.value, 0.0001)
        assertNull(InsightAlgorithms.vo2MaxEstimate("hike", 1800.0, 3000.0, 150.0, 60.0, 190.0))
        assertNull(InsightAlgorithms.vo2MaxEstimate("walk", 1800.0, 6000.0, 150.0, 60.0, 190.0))
        assertNull(InsightAlgorithms.vo2MaxEstimate("run", 1800.0, 6000.0, Double.NaN, 60.0, 190.0))
    }

    @Test
    fun `quantized nightly baseline yields bounded useful recovery after seven nights`() {
        val flat = established(50.0, 0.0).copy(sampleCount = 7, spanDays = 6.0)
        val result = InsightAlgorithms.recoveryScore(51.0, flat, 51.0, flat, 80.0, null, null)!!
        assertTrue(result.value.isFinite())
        assertTrue(result.value in 40.0..85.0)
        assertTrue(result.confidence != "high")
        assertNull(InsightAlgorithms.personalDeviation(50.0, flat.copy(sampleCount = 6), 3.0))
    }

    @Test
    fun `weekly HRV needs multiple days and treats baseline as center`() {
        assertNull(InsightAlgorithms.hrvTrend(listOf(50.0, 50.0), List(14) { 50.0 }))
        val usual = InsightAlgorithms.hrvTrend(List(5) { 50.0 }, List(14) { 50.0 })!!
        val elevated = InsightAlgorithms.hrvTrend(List(5) { 60.0 }, List(14) { 50.0 })!!
        assertEquals(50.0, usual.value, 0.0001)
        assertTrue(elevated.value > usual.value)
        assertEquals(20.0, elevated.inputs.getValue("relative_change_percent"), 0.0001)

        val contributors = elevated.contributors.associateBy { it.id }
        assertEquals(
            setOf("hrv_balance_index", "recent_log_hrv", "baseline_log_hrv", "relative_change_percent"),
            contributors.keys,
        )
        val index = contributors.getValue("hrv_balance_index")
        assertEquals(ScoreContributorRole.SCORED, index.role)
        assertEquals(elevated.value, index.score!!, 0.0001)
        assertEquals("score", index.unit)
        assertEquals(1.0, index.weight, 0.0)
        assertEquals("ln(ms)", contributors.getValue("recent_log_hrv").unit)
        assertEquals("ln(ms)", contributors.getValue("baseline_log_hrv").unit)
        assertEquals("%", contributors.getValue("relative_change_percent").unit)
        assertTrue(contributors.values.all { it.explanation.isNotBlank() })
    }

    @Test
    fun `autonomic load rises when resting HR rises and HRV falls`() {
        val baseline = established(50.0, 5.0)
        val usual = InsightAlgorithms.stressScore(50.0, baseline, 50.0, baseline)!!
        val loaded = InsightAlgorithms.stressScore(35.0, baseline, 65.0, baseline)!!
        assertEquals(50.0, usual.value, 0.0001)
        assertTrue(loaded.value > usual.value)
        assertNull(InsightAlgorithms.stressScore(Double.NaN, baseline, 50.0, baseline))
    }

    private fun established(mean: Double, sd: Double) = BaselineStats(
        mean = mean,
        median = mean,
        standardDeviation = sd,
        p25 = mean - sd,
        p75 = mean + sd,
        sampleCount = 30,
        spanDays = 14.0,
    )
}
