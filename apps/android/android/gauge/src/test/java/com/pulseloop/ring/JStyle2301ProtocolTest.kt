package com.pulseloop.ring

import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JStyle2301ProtocolTest {
    private val decoder = JStyle2301Decoder(ZoneId.of("UTC"), initialFirmwareRevision = "V0525")

    @Test
    fun `vendor manual HR frames are exact 16 byte SDK commands`() {
        val prepare = JStyle2301Protocol.prepareRealtimeMeasurement()
        val prepareStop = JStyle2301Protocol.prepareRealtimeMeasurement(enable = false)
        val start = JStyle2301Protocol.heartRateMeasurement(start = true, seconds = 30)
        val stop = JStyle2301Protocol.heartRateMeasurement(start = false, seconds = 30)
        assertArrayEquals(byteArrayOf(0x09, 0x01, 0x00), prepare.copyOfRange(0, 3))
        assertArrayEquals(byteArrayOf(0x09, 0x00, 0x00), prepareStop.copyOfRange(0, 3))
        assertArrayEquals(byteArrayOf(0x28, 0x02, 0x01, 0x1E, 0x00), start.copyOfRange(0, 5))
        assertArrayEquals(byteArrayOf(0x28, 0x02, 0x00, 0x1E, 0x00), stop.copyOfRange(0, 5))
        listOf(prepare, prepareStop, start, stop).forEach { frame ->
            assertEquals(16, frame.size)
            assertEquals(frame.take(15).sumOf { it.u8() }.and(0xFF), frame.last().u8())
        }
    }

    @Test
    fun `vendor walk and run sport frames preserve exact mode and lifecycle bytes`() {
        val runStart = JStyle2301Protocol.sportMode(JStyle2301Protocol.SPORT_RUN, 1)
        val walkStart = JStyle2301Protocol.sportMode(JStyle2301Protocol.SPORT_WALK, 1)
        val walkStop = JStyle2301Protocol.sportMode(JStyle2301Protocol.SPORT_WALK, 4)
        assertArrayEquals(byteArrayOf(0x19, 0x01, 0x00, 0x00, 0x02), runStart.copyOfRange(0, 5))
        assertArrayEquals(byteArrayOf(0x19, 0x01, 0x09, 0x00, 0x02), walkStart.copyOfRange(0, 5))
        assertArrayEquals(byteArrayOf(0x19, 0x04, 0x09, 0x00, 0x02), walkStop.copyOfRange(0, 5))
        listOf(runStart, walkStart, walkStop).forEach {
            assertEquals(it.take(15).sumOf { byte -> byte.u8() }.and(0xFF), it.last().u8())
        }
    }

    @Test
    fun `manual HR reply decodes vendor byte two and rejects invalid values`() {
        val at = Instant.parse("2026-09-16T10:00:00Z")
        val decoder = JStyle2301Decoder(ZoneId.of("UTC"), initialFirmwareRevision = "V0789", now = { at })
        val event = decoder.decode(byteArrayOf(0x28, 0x02, 72)).single() as RingDecodedEvent.HeartRateSample
        assertEquals(72, event.bpm)
        assertEquals(at, event._timestamp)
        assertTrue(event.measurementResult)
        val bridged = RingEventBridge.eventsFor(event, at).single() as PulseEvent.HeartRateSample
        assertTrue(bridged.measurementResult)
        val zero = decoder.decode(byteArrayOf(0x28, 0x02, 0)).single()
        assertEquals("hr_sample", zero.kind)
        assertTrue(RingEventBridge.eventsFor(zero, at).isEmpty())
        assertEquals("sport_telemetry", decoder.decode(byteArrayOf(0x28, 0x03, 98)).single().kind)
    }

    @Test
    fun `sport telemetry is always health named and publishes plausible HR separately`() {
        val at = Instant.parse("2026-09-16T10:00:00Z")
        val decoder = JStyle2301Decoder(ZoneId.of("UTC"), initialFirmwareRevision = "V0789", now = { at })
        val warmup = decoder.decode(ByteArray(14).also { it[0] = 0x18 })
        assertEquals(listOf("sport_telemetry"), warmup.map { it.kind })
        val reading = decoder.decode(ByteArray(14).also { it[0] = 0x18; it[1] = 81 })
        assertEquals(listOf("sport_telemetry", "hr_sample"), reading.map { it.kind })
        assertEquals(81, (reading.last() as RingDecodedEvent.HeartRateSample).bpm)
        assertFalse((reading.last() as RingDecodedEvent.HeartRateSample).measurementResult)
        assertEquals("sport_telemetry", decoder.decode(byteArrayOf(0x09, 1, 0)).single().kind)
        val realtime = decoder.decode(ByteArray(22).also { it[0] = 0x09; it[21] = 92 })
        assertEquals(listOf("sport_telemetry", "hr_sample"), realtime.map { it.kind })
        assertTrue((realtime.last() as RingDecodedEvent.HeartRateSample).measurementStream)
    }

    @Test
    fun `V0789 manual HR authenticates then follows vendor prepare delay start and stop`() = runTest {
        val writes = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { writes += it.copyOf() }
        val history = JStyle2301HistorySync(writer, 10_000, 10_000, scope = this, progressSink = {})
        val engine = JStyle2301SyncEngine(writer, history, "A1b2C3d4", scope = this)

        engine.startHeartRate()
        assertEquals(listOf(0x27), writes.map { it[0].u8() })
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        assertEquals(0x3C, writes.last()[0].u8())
        engine.handle(RingDecodedEvent.AuthenticationResult(true))
        assertEquals(0x09, writes.last()[0].u8())
        advanceTimeBy(500)
        runCurrent()
        assertEquals(0x28, writes.last()[0].u8())
        assertEquals(1, writes.last()[2].u8())
        engine.stopHeartRate()
        assertArrayEquals(byteArrayOf(0x28, 0x02, 0x00), writes[writes.lastIndex - 1].copyOfRange(0, 3))
        assertArrayEquals(byteArrayOf(0x09, 0x00, 0x00), writes.last().copyOfRange(0, 3))
    }

    @Test
    fun `manual HR never starts when all V0789 authentication options are absent or rejected`() = runTest {
        suspend fun commands(secret: String?, accepted: Boolean?): List<Int> {
            val writes = mutableListOf<ByteArray>()
            val writer = RingCommandWriter { writes += it.copyOf() }
            val history = JStyle2301HistorySync(writer, 10_000, 10_000, scope = this, progressSink = {})
            val engine = JStyle2301SyncEngine(writer, history, secret, scope = this, firmwarePasscode = { byteArrayOf() })
            engine.startHeartRate()
            engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
            if (accepted != null) engine.handle(RingDecodedEvent.AuthenticationResult(accepted))
            advanceTimeBy(500)
            return writes.map { it[0].u8() }
        }
        assertEquals(listOf(0x27), commands(null, null))
        assertEquals(listOf(0x27, 0x3C), commands("A1b2C3d4", false))
    }

    @Test
    fun `manual HR cancellation during prepare disables realtime steps without starting sensor`() = runTest {
        val writes = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { writes += it.copyOf() }
        val history = JStyle2301HistorySync(writer, 10_000, 10_000, scope = this, progressSink = {})
        val engine = JStyle2301SyncEngine(writer, history, null, scope = this)
        engine.startHeartRate()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        assertArrayEquals(byteArrayOf(0x09, 0x01, 0x00), writes.last().copyOfRange(0, 3))
        engine.stopHeartRate()
        advanceTimeBy(500)
        runCurrent()
        assertEquals(listOf(0x27, 0x09, 0x09), writes.map { it[0].u8() })
        assertArrayEquals(byteArrayOf(0x09, 0x00, 0x00), writes.last().copyOfRange(0, 3))
    }

    @Test
    fun `authenticated walk workout uses vendor sport mode and stop while unsupported types no op`() = runTest {
        val writes = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { writes += it.copyOf() }
        val history = JStyle2301HistorySync(writer, 10_000, 10_000, scope = this, progressSink = {})
        val engine = JStyle2301SyncEngine(writer, history, null, scope = this)
        engine.startWorkoutHeartRate("walk")
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))
        assertArrayEquals(byteArrayOf(0x19, 0x01, 0x09, 0x00, 0x02), writes.last().copyOfRange(0, 5))
        engine.pauseWorkoutHeartRate()
        assertArrayEquals(byteArrayOf(0x19, 0x02, 0x09, 0x00, 0x02), writes.last().copyOfRange(0, 5))
        engine.resumeWorkoutHeartRate()
        assertArrayEquals(byteArrayOf(0x19, 0x03, 0x09, 0x00, 0x02), writes.last().copyOfRange(0, 5))
        engine.stopWorkoutHeartRate()
        assertArrayEquals(byteArrayOf(0x19, 0x04, 0x09, 0x00, 0x02), writes.last().copyOfRange(0, 5))
        val count = writes.size
        engine.startWorkoutHeartRate("cycle")
        assertEquals(count, writes.size)
        assertTrue(engine.supportsWorkoutHeartRate("walk"))
        assertTrue(engine.supportsWorkoutHeartRate("run"))
        assertFalse(engine.supportsWorkoutHeartRate("cycle"))
    }

    @Test
    fun `V0789 workout sends no sport command before authentication`() = runTest {
        val writes = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { writes += it.copyOf() }
        val history = JStyle2301HistorySync(writer, 10_000, 10_000, scope = this, progressSink = {})
        val engine = JStyle2301SyncEngine(writer, history, "A1b2C3d4", scope = this)
        engine.startWorkoutHeartRate("run")
        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        assertEquals(listOf(0x27, 0x3C), writes.map { it[0].u8() })
        engine.handle(RingDecodedEvent.AuthenticationResult(true))
        assertArrayEquals(byteArrayOf(0x19, 0x01, 0x00, 0x00, 0x02), writes.last().copyOfRange(0, 5))
    }

    @Test
    fun `history commands are 16 bytes with the verified cursor mode and checksum`() {
        val first = JStyle2301Protocol.historyRequest(JStyle2301HistoryStream.HEART_RATE)
        val next = JStyle2301Protocol.historyRequest(JStyle2301HistoryStream.HEART_RATE, continuation = true)

        assertEquals(16, first.size)
        assertEquals(0x55, first[0].u8())
        assertEquals(0, first[1].u8())
        assertEquals(0x55, first.last().u8())
        assertEquals(2, next[1].u8())
        assertEquals(0x57, next.last().u8())
    }

    @Test
    fun `V0789 authentication command is exact and its stored diagnostic copy is redacted`() {
        val request = JStyle2301Protocol.authenticationRequest("A1b2C3d4")
        assertEquals(16, request.size)
        assertEquals(0x3C, request[0].u8())
        assertArrayEquals("A1b2C3d4".toByteArray(), request.copyOfRange(1, 9))
        assertEquals(request.take(15).sumOf { it.u8() }.and(0xFF), request.last().u8())

        val driver = JStyle2301Driver(null)
        val redacted = driver.redactOutboundForStorage(request)
        assertEquals(0x3C, redacted[0].u8())
        assertTrue(redacted.copyOfRange(1, 15).all { it.u8() == 0 })
        assertFalse(redacted.contentEquals(request))
    }

    @Test
    fun `V0789 firmware and authentication result decode without exposing a credential`() {
        val fresh = JStyle2301Decoder(ZoneId.of("UTC"))
        assertEquals(
            RingDecodedEvent.FirmwareRevision("V0789"),
            fresh.decode(byteArrayOf(0x27, 0x00, 0x07, 0x08, 0x09)).single(),
        )
        assertEquals(JStyle2301FirmwareProfile.V0789, fresh.firmwareProfile)
        assertEquals(
            RingDecodedEvent.AuthenticationResult(true),
            fresh.decode(byteArrayOf(0x3C, 0x01)).single(),
        )
        assertEquals(
            RingDecodedEvent.AuthenticationResult(false),
            fresh.decode(byteArrayOf(0x3C, 0x00)).single(),
        )

        val hrvPacket = ByteArray(15).also {
            it[0] = 0x56
            stamp(it)
            it[9] = 91.toByte()
        }
        assertTrue(fresh.decode(hrvPacket).any {
            it is RingDecodedEvent.HistoryMeasurement &&
                it.kind_field == MeasurementKind.HRV && it.value == 50.0
        })

        val activityPacket = ByteArray(27).also {
            it[0] = 0x51
            it[2] = bcd(26)
            it[3] = bcd(9)
            it[4] = bcd(15)
            putU32(it, 5, 77)
            putU32(it, 9, 34)
        }
        val activity = fresh.decode(activityPacket)
            .filterIsInstance<RingDecodedEvent.ActivityUpdate>()
            .single()
        assertEquals(0, activity.activeMinutes)
        assertTrue(activity.replaceActiveMinutes)
    }

    @Test
    fun `battery and V0525 firmware decode without inventing connection events`() {
        assertEquals(RingDecodedEvent.Battery(100), decoder.decode(byteArrayOf(0x13, 100)).single())
        assertEquals(
            RingDecodedEvent.FirmwareRevision("V0525"),
            decoder.decode(byteArrayOf(0x27, 0x00, 0x05, 0x02, 0x05)).single(),
        )
    }

    @Test
    fun `heart rate SpO2 and temperature history preserve local timestamps`() {
        val hr = scalarRecord(0x55, 72)
        val spo2 = scalarRecord(0x66, 98)
        val temp = scalarRecord(0x62, 0, size = 11).also { putU16(it, 9, 368) }

        assertHistory(decoder.decode(hr).single(), MeasurementKind.HEART_RATE, 72.0)
        assertHistory(decoder.decode(spo2).single(), MeasurementKind.SPO2, 98.0)
        assertHistory(decoder.decode(temp).single(), MeasurementKind.TEMPERATURE, 36.8)
    }

    @Test
    fun `V0525 one minute sleep packet maps all four observed vendor stages`() {
        val packet = ByteArray(130)
        packet[0] = 0x53
        stamp(packet)
        packet[9] = 4
        packet[10] = 5
        packet[11] = 1
        packet[12] = 2
        packet[13] = 3

        val timeline = decoder.decode(packet).single() as RingDecodedEvent.SleepTimeline
        assertEquals(
            listOf(SleepStage.AWAKE, SleepStage.DEEP, SleepStage.LIGHT, SleepStage.REM),
            timeline.stages,
        )
        assertEquals(JStyle2301Decoder.HISTORY_DAYS, timeline.historyHorizonDays)
    }

    @Test
    fun `V0525 HRV bundle retains raw value and publishes vendor-app compatible transform`() {
        val packet = ByteArray(15)
        packet[0] = 0x56
        stamp(packet)
        packet[9] = 47
        packet[10] = 39
        packet[11] = 70
        packet[12] = 31
        packet[13] = 118
        packet[14] = 76

        val events = decoder.decode(packet)
        assertTrue(events.any { it is RingDecodedEvent.VendorMetric && it.key == "hrv_raw" && it.value == 47.0 })
        assertTrue(events.any { it is RingDecodedEvent.HistoryMeasurement && it.kind_field == MeasurementKind.HRV && it.value == 28.0 })
        assertTrue(events.any { it is RingDecodedEvent.HistoryMeasurement && it.kind_field == MeasurementKind.HEART_RATE && it.value == 70.0 })
        assertTrue(events.any { it is RingDecodedEvent.HistoryMeasurement && it.kind_field == MeasurementKind.STRESS && it.value == 31.0 })
        assertTrue(events.any { it is RingDecodedEvent.VendorMetric && it.key == "vascular_age" && it.value == 39.0 })
        assertTrue(events.any { it is RingDecodedEvent.VendorMetric && it.key == "blood_pressure_systolic_estimate" && it.value == 118.0 })
        assertTrue(events.any { it is RingDecodedEvent.VendorMetric && it.key == "blood_pressure_diastolic_estimate" && it.value == 76.0 })
    }

    @Test
    fun `V0789 maps resolved byte five and marker bytes to awake`() {
        val decoder = JStyle2301Decoder(ZoneId.of("UTC"))
        decoder.decode(byteArrayOf(0x27, 0x00, 0x07, 0x08, 0x09))
        val packet = ByteArray(130).also {
            it[0] = 0x53
            stamp(it)
            it[9] = 5
            it[10] = 1
            it[11] = 2
            it[12] = 3
            it[13] = 10
            it[14] = 5
        }
        val timeline = decoder.decode(packet).single() as RingDecodedEvent.SleepTimeline
        assertEquals(
            listOf(SleepStage.DEEP, SleepStage.LIGHT, SleepStage.REM, SleepStage.AWAKE, SleepStage.AWAKE),
            timeline.stages,
        )
    }

    @Test
    fun `unknown firmware preserves opaque HRV and refuses invented sleep labels`() {
        val unknown = JStyle2301Decoder(ZoneId.of("UTC"))
        val hrvPacket = ByteArray(15).also {
            it[0] = 0x56
            stamp(it)
            it[9] = 47
        }
        val hrv = unknown.decode(hrvPacket)
        assertTrue(hrv.any { it is RingDecodedEvent.VendorMetric && it.key == "hrv_raw" && it.value == 47.0 })
        assertFalse(hrv.any { it is RingDecodedEvent.HistoryMeasurement && it.kind_field == MeasurementKind.HRV })

        val sleepPacket = ByteArray(130).also {
            it[0] = 0x53
            stamp(it)
            it[9] = 4
            it[10] = 1
            it[11] = 2
            it[12] = 3
            it[13] = 5
        }
        val sleep = unknown.decode(sleepPacket).single() as RingDecodedEvent.SleepTimeline
        assertEquals(List(4) { SleepStage.UNKNOWN }, sleep.stages)

        unknown.decode(byteArrayOf(0x27, 0x00, 0x05, 0x02, 0x05))
        assertEquals(JStyle2301FirmwareProfile.V0525, unknown.firmwareProfile)
        assertTrue(unknown.decode(hrvPacket).any {
            it is RingDecodedEvent.HistoryMeasurement &&
                it.kind_field == MeasurementKind.HRV && it.value == 28.0
        })
    }

    @Test
    fun `activity total converts vendor hundredth-km field to metres`() {
        val packet = ByteArray(27)
        packet[0] = 0x51
        packet[2] = bcd(26)
        packet[3] = bcd(9)
        packet[4] = bcd(14)
        putU32(packet, 5, 8_432)
        putU32(packet, 9, 735) // V0525 field is seconds -> 12 complete active minutes
        putU32(packet, 13, 623) // 6.23 km
        putU32(packet, 17, 38_800) // 388 kcal
        putU16(packet, 21, 10_000)
        putU32(packet, 23, 62)

        val activity = decoder.decode(packet).filterIsInstance<RingDecodedEvent.ActivityUpdate>().single()
        assertEquals(8_432, activity.steps)
        assertEquals(6_230, activity.distanceMeters)
        assertEquals(388, activity.calories)
        assertEquals(12, activity.activeMinutes)
        assertTrue(activity.replaceActiveMinutes)
        assertTrue(decoder.decode(packet).any { it is RingDecodedEvent.VendorMetric && it.key == "exercise_duration_raw" && it.unit == "s" })
    }

    @Test
    fun `activity detail preserves exact block calories as a vendor metric`() {
        val packet = ByteArray(25)
        packet[0] = 0x52
        stamp(packet)
        putU16(packet, 9, 100)
        putU16(packet, 11, 435)
        putU16(packet, 13, 7)
        packet[15] = 60
        packet[16] = 40

        val events = decoder.decode(packet)
        assertTrue(events.any {
            it is RingDecodedEvent.VendorMetric &&
                it.key == "activity_detail_calories" && it.value == 4.35 && it.unit == "kcal"
        })
        // GA.1: every minute of the record, zeros included.
        val buckets = events.filterIsInstance<RingDecodedEvent.ActivityBucket>()
        assertEquals(10, buckets.size)
        assertEquals(listOf(60, 40, 0, 0, 0, 0, 0, 0, 0, 0), buckets.map { it.steps })
    }

    @Test
    fun `terminal marker is recognized whether standalone or appended`() {
        val stream = JStyle2301HistoryStream.SLEEP
        assertTrue(JStyle2301Protocol.isTerminal(byteArrayOf(0x53, 0xFF.toByte()), stream))
        assertTrue(JStyle2301Protocol.isTerminal(ByteArray(132).also {
            it[0] = 0x53; it[130] = 0x53; it[131] = 0xFF.toByte()
        }, stream))
        assertFalse(JStyle2301Protocol.isTerminal(byteArrayOf(0x53, 0x00), stream))
    }

    @Test
    fun `history pager continues at fifty packets then advances on terminal`() = runTest {
        val writes = mutableListOf<ByteArray>()
        val progress = mutableListOf<PulseEvent>()
        val sync = JStyle2301HistorySync(
            writer = RingCommandWriter { writes += it.copyOf() },
            settleMs = 100,
            stallMs = 500,
            scope = this,
            progressSink = { progress += it },
        )
        sync.start(listOf(JStyle2301HistoryStream.HEART_RATE, JStyle2301HistoryStream.SPO2))
        assertEquals(0, writes.single()[1].u8())

        repeat(50) { sync.notePacket(byteArrayOf(0x55, 0x00)) }
        assertEquals(2, writes.last()[1].u8())

        sync.notePacket(byteArrayOf(0x55, 0xFF.toByte()))
        assertEquals(0x66, writes.last()[0].u8())
        sync.notePacket(byteArrayOf(0x66, 0xFF.toByte()))
        assertFalse(sync.isRunning)
        assertTrue(progress.last() == PulseEvent.SyncProgress("done"))
    }

    @Test
    fun `one-page startup budget advances instead of requesting a continuation`() = runTest {
        val writes = mutableListOf<ByteArray>()
        val progress = mutableListOf<PulseEvent>()
        val sync = JStyle2301HistorySync(
            writer = RingCommandWriter { writes += it.copyOf() },
            settleMs = 100,
            stallMs = 500,
            scope = this,
            progressSink = { progress += it },
        )
        sync.start(
            streams = listOf(JStyle2301HistoryStream.HEART_RATE, JStyle2301HistoryStream.SPO2),
            pageLimit = 1,
        )

        repeat(50) { sync.notePacket(byteArrayOf(0x55, 0x00)) }

        assertEquals(0x66, writes.last()[0].u8())
        assertEquals(0, writes.last()[1].u8())
        assertTrue(progress.any { it == PulseEvent.SyncProgress("heart rate: bounded at 1 pages") })
        sync.notePacket(byteArrayOf(0x66, 0xFF.toByte()))
        assertTrue(progress.last() == PulseEvent.SyncProgress("done"))
    }

    @Test
    fun `V0789 gates all history until authentication succeeds`() = runTest {
        val writes = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { writes += it.copyOf() }
        val history = JStyle2301HistorySync(
            writer = writer,
            settleMs = 10_000,
            stallMs = 10_000,
            scope = this,
            progressSink = {},
        )
        val engine = JStyle2301SyncEngine(writer, history, "A1b2C3d4")

        engine.runStartup()
        assertEquals(listOf(0x13, 0x27), writes.map { it[0].u8() })

        engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
        assertEquals(0x3C, writes.last()[0].u8())
        assertFalse(writes.any { it[0].u8() in JStyle2301HistoryStream.entries.map { stream -> stream.opcode } })

        engine.handle(RingDecodedEvent.AuthenticationResult(true))
        assertEquals(JStyle2301HistoryStream.ACTIVITY_TOTAL.opcode, writes.last()[0].u8())
    }

    @Test
    fun `V0789 missing or rejected authentication options never send history`() = runTest {
        suspend fun writesFor(secret: String?, accepted: Boolean?): List<Int> {
            val writes = mutableListOf<ByteArray>()
            val writer = RingCommandWriter { writes += it.copyOf() }
            val history = JStyle2301HistorySync(
                writer = writer,
                settleMs = 10_000,
                stallMs = 10_000,
                scope = this,
                progressSink = {},
            )
            val engine = JStyle2301SyncEngine(writer, history, secret, firmwarePasscode = { byteArrayOf() })
            engine.runStartup()
            engine.handle(RingDecodedEvent.FirmwareRevision("V0789"))
            if (accepted != null) engine.handle(RingDecodedEvent.AuthenticationResult(accepted))
            return writes.map { it[0].u8() }
        }

        assertEquals(listOf(0x13, 0x27), writesFor(null, null))
        val rejected = writesFor("A1b2C3d4", false)
        assertEquals(listOf(0x13, 0x27, 0x3C), rejected)
    }

    @Test
    fun `V0525 begins history without authentication`() = runTest {
        val writes = mutableListOf<ByteArray>()
        val writer = RingCommandWriter { writes += it.copyOf() }
        val history = JStyle2301HistorySync(
            writer = writer,
            settleMs = 10_000,
            stallMs = 10_000,
            scope = this,
            progressSink = {},
        )
        val engine = JStyle2301SyncEngine(writer, history, null)

        engine.runStartup()
        engine.handle(RingDecodedEvent.FirmwareRevision("V0525"))

        // Clock read-back (0x41) then set (0x01) precede the first history request.
        assertEquals(listOf(0x13, 0x27, 0x41, 0x01, 0x51), writes.map { it[0].u8() })
    }

    @Test
    fun `coordinator recognizes ring vendor name and manufacturer marker`() {
        assertTrue(JStyle2301Coordinator.matches("$RING_VENDOR Smart Ring 7307", AdvertisementInfo(emptyList(), null)))
        assertTrue(
            JStyle2301Coordinator.matches(
                "white label",
                AdvertisementInfo(emptyList(), byteArrayOf(0x34, 0x12, 0x44, 0x23, 0x01)),
            )
        )
        assertFalse(JStyle2301Coordinator.matches("SMART_RING", AdvertisementInfo(emptyList(), null)))
        assertTrue(WearableCapability.MANUAL_HEART_RATE in JStyle2301Coordinator.capabilities)
        assertTrue(WearableCapability.REALTIME_HEART_RATE in JStyle2301Coordinator.capabilities)
    }

    private fun assertHistory(event: RingDecodedEvent, kind: MeasurementKind, value: Double) {
        event as RingDecodedEvent.HistoryMeasurement
        assertEquals(kind, event.kind_field)
        assertEquals(value, event.value, 0.0001)
        assertEquals(Instant.parse("2026-09-14T12:34:56Z"), event._timestamp)
    }

    private fun scalarRecord(opcode: Int, value: Int, size: Int = 10): ByteArray =
        ByteArray(size).also {
            it[0] = opcode.toByte()
            stamp(it)
            if (size == 10) it[9] = value.toByte()
        }

    private fun stamp(packet: ByteArray) {
        packet[3] = bcd(26)
        packet[4] = bcd(9)
        packet[5] = bcd(14)
        packet[6] = bcd(12)
        packet[7] = bcd(34)
        packet[8] = bcd(56)
    }

    private fun bcd(value: Int): Byte = (((value / 10) shl 4) or (value % 10)).toByte()

    private fun putU16(data: ByteArray, offset: Int, value: Int) {
        data[offset] = value.toByte()
        data[offset + 1] = (value ushr 8).toByte()
    }

    private fun putU32(data: ByteArray, offset: Int, value: Int) {
        repeat(4) { data[offset + it] = (value ushr (8 * it)).toByte() }
    }

    private fun Byte.u8(): Int = toInt() and 0xFF
}
