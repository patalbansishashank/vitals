package com.pulseloop.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase 0 + Phase 5 (docs/health-connect-integration.md): the permission sets must be derived
 * from the record classes, not hardcoded, and must contain exactly the sixteen WRITE permissions
 * (ten Phase 1-4 + six Phase 5 "beyond iOS"). The separately consented ring-vendor comparison has its
 * own exact read set. Asserting the official string
 * literals pins the record-class -> permission mapping so a silent library change fails loudly
 * here, not in the field.
 */
class HealthConnectPermissionsTest {

    @Test
    fun allContainsExactlyTheFifteenWritePermissions() {
        assertEquals(15, HealthConnectPermissions.all.size)
    }

    @Test
    fun nutritionIsNoLongerRequested() {
        // Nutrition moved to the Vitals app: Gauge writes no NutritionRecords any more.
        assertFalse("android.permission.health.WRITE_NUTRITION" in HealthConnectPermissions.all)
        assertTrue(HealthConnectPermissions.DataTypeRow.entries.none { it.name == "NUTRITION" })
    }

    @Test
    fun everyPermissionIsAHealthWritePermission() {
        for (p in HealthConnectPermissions.all) {
            assertTrue("expected a health WRITE permission, got $p", p.startsWith("android.permission.health.WRITE_"))
        }
    }

    @Test
    fun noReadPermissionAnyWhere() {
        for (p in HealthConnectPermissions.all) {
            assertFalse("found a read permission: $p", p.startsWith("android.permission.health.READ"))
        }
    }

    @Test
    fun derivationMatchesTheOfficialPermissionStrings() {
        // Official data-types reference; the route is singular on purpose (READ_EXERCISE_ROUTES
        // is the plural one - the docs call out the asymmetry).
        val phase1To4 = setOf(
            "android.permission.health.WRITE_HEART_RATE",
            "android.permission.health.WRITE_OXYGEN_SATURATION",
            "android.permission.health.WRITE_HEART_RATE_VARIABILITY",
            "android.permission.health.WRITE_BODY_TEMPERATURE",
            "android.permission.health.WRITE_SLEEP",
            "android.permission.health.WRITE_STEPS",
            "android.permission.health.WRITE_ACTIVE_CALORIES_BURNED",
            "android.permission.health.WRITE_DISTANCE",
            "android.permission.health.WRITE_EXERCISE",
            "android.permission.health.WRITE_EXERCISE_ROUTE",
        )
        val phase5 = setOf(
            "android.permission.health.WRITE_BLOOD_PRESSURE",
            "android.permission.health.WRITE_BLOOD_GLUCOSE",
            "android.permission.health.WRITE_RESPIRATORY_RATE",
            "android.permission.health.WRITE_VO2_MAX",
            "android.permission.health.WRITE_RESTING_HEART_RATE",
        )
        assertTrue(phase1To4.all { HealthConnectPermissions.all.contains(it) })
        assertTrue(phase5.all { HealthConnectPermissions.all.contains(it) })
    }

    @Test
    fun everyRowMapsToItsPermissions() {
        assertEquals(1, HealthConnectPermissions.permissionsForRow(HealthConnectPermissions.DataTypeRow.HEART_RATE).size)
        assertEquals(3, HealthConnectPermissions.permissionsForRow(HealthConnectPermissions.DataTypeRow.STEPS_AND_ACTIVITY).size)
        assertEquals(2, HealthConnectPermissions.permissionsForRow(HealthConnectPermissions.DataTypeRow.WORKOUTS).size)
        // Phase 5: every type maps to exactly its single write permission.
        for (row in listOf(
            HealthConnectPermissions.DataTypeRow.BLOOD_PRESSURE,
            HealthConnectPermissions.DataTypeRow.BLOOD_GLUCOSE,
            HealthConnectPermissions.DataTypeRow.RESPIRATORY_RATE,
            HealthConnectPermissions.DataTypeRow.VO2_MAX,
            HealthConnectPermissions.DataTypeRow.RESTING_HEART_RATE,
        )) {
            assertEquals("permissionsForRow($row)", 1, HealthConnectPermissions.permissionsForRow(row).size)
        }
        // And no row is empty.
        assertTrue(HealthConnectPermissions.DataTypeRow.values().none { HealthConnectPermissions.permissionsForRow(it).isEmpty() })
    }

    @Test
    fun ringVendorComparisonContainsTenDataReadsPlusHistory() {
        assertEquals(10, RingVendorComparisonPermissions.data.size)
        assertEquals(11, RingVendorComparisonPermissions.all.size)
        assertTrue(RingVendorComparisonPermissions.data.all {
            it.startsWith("android.permission.health.READ_")
        })
        assertTrue(
            "android.permission.health.READ_HEALTH_DATA_HISTORY" in RingVendorComparisonPermissions.all
        )
        assertTrue(HealthConnectPermissions.all.intersect(RingVendorComparisonPermissions.all).isEmpty())
    }
}
