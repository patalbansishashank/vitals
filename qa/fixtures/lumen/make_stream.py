#!/usr/bin/env python3
"""Synthetic Lumen Health MQTT stream (no owner data). Re-implements the envelope and id rule of
LumenHealth app/src/main/java/com/pulseloop/broadcasting/BroadcastEventMapper.kt:39-66,330-346:
data = {schema_version, observed_at, received_at, ...values} in insertion order; id = "pl-" + first 40 hex of
sha256("type|subject|observedAt|" + compact JSON of data without received_at). Values follow the Kotlin unit tests
(BroadcastEventMapperTest.kt) where one exists, otherwise they are made up. Doubles keep a ".0" like kotlinx.
Ids are NOT verified against a Kotlin run. Output: mqtt-stream.synthetic.jsonl, one {topic,qos,retain,payload} per line,
where payload is the exact UTF-8 string a broker would receive."""
import hashlib, json

BASE, INST = "lumen-health/v1", "install123"
OBS, RECV = "2026-09-14T12:30:00Z", "2026-09-14T12:35:00Z"
out = []

def enc(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)

def ev(type_, subject, suffix, observed, values, retain=False, received=RECV):
    data = {"schema_version": 1, "observed_at": observed, "received_at": received, **values}
    ident = {k: v for k, v in data.items() if k != "received_at"}
    eid = "pl-" + hashlib.sha256(f"{type_}|{subject}|{observed}|{enc(ident)}".encode()).hexdigest()[:40]
    env = {"specversion": "1.0", "id": eid, "type": type_, "source": f"urn:pulseloop:installation:{INST}",
           "subject": subject, "time": observed, "datacontenttype": "application/json", "data": data}
    out.append({"topic": f"{BASE}/{INST}/{suffix}", "qos": 1, "retain": retain, "payload": enc(env)})

def metric(key, unit, value, observed, provenance, extra=None):
    ev("health.metric.observed", key, f"metrics/{key}", observed,
       {"metric": key, "value": value, "unit": unit, "provenance": provenance, "quality": "unverified", **(extra or {})})

metric("hr", "bpm", 72.0, OBS, "device_history", {"replayed": True})                       # mapper test l.24-37
metric("hr", "bpm", 88.0, "2026-09-14T12:31:00Z", "device_spot", {"spot": True, "ring_will_log": False})
metric("spo2", "%", 97.0, "2026-09-14T03:10:00Z", "device_history", {"replayed": True})
metric("temp", "°C", 34.6, "2026-09-14T03:10:00Z", "device_history", {"replayed": True})
metric("hrv", "ms", 41.0, "2026-09-14T03:10:00Z", "vendor_history", {"replayed": True})
metric("stress", "", 30.0, "2026-09-14T03:10:00Z", "vendor_history", {"replayed": True})
ev("health.metric.observed", "blood_pressure", "metrics/blood_pressure", OBS,
   {"systolic": 118, "diastolic": 76, "unit": "mmHg", "provenance": "device_history_estimate", "replayed": True})
ev("health.vendor_metric.observed", "vendor.vascular_age", "vendor/vascular_age", OBS,               # mapper test l.59
   {"metric": "vascular age", "value": 39.0, "unit": "years", "provenance": "device_history_estimate",
    "quality": "unverified", "replayed": True})
ev("health.activity.bucket.observed", "activity_bucket", "activity/buckets", "2026-09-14T12:00:00Z",
   {"steps": 84, "distance_m": 61.0, "provenance": "device_history", "replayed": True})
ev("health.activity.updated", "daily_activity", "activity/daily", OBS,
   {"steps": 6400, "distance_m": 4650.0, "calories_kcal": 210.0, "calories_provenance": "device_estimate",
    "calories_energy_basis": "unspecified_by_device", "active_minutes": 34, "provenance": "device_reported"})
stages = ["awake"] * 3 + ["light"] * 20 + ["deep"] * 15 + ["rem"] * 10 + ["unknown"] * 2 + ["light"] * 10 + ["awake"] * 2
for complete in (False, True):  # the same night sent twice: provisional, then complete
    ev("health.sleep.timeline.updated", "sleep_timeline", "sleep/timeline", "2026-09-13T22:40:00Z",
       {"sample_interval_minutes": 1, "complete_session": complete, "stages": stages if complete else stages[:40],
        "provenance": "device_classified", "replayed": True})
ev("health.insight.updated", "recovery_score", "insights/recovery_score", OBS,                     # mapper test l.71-82
   {"insight": "recovery_score", "value": 73.0, "unit": "score", "confidence": "medium", "algorithm_version": "test-v1",
    "inputs": {"hrv": 47.0, "sleep_score": 81.0}, "note": None, "provenance": "locally_derived"}, retain=True)
ev("health.device.battery.updated", "battery", "state/battery", RECV, {"percent": 64}, retain=True)
ev("health.device.firmware.updated", "firmware", "state/firmware", RECV, {"version": "V0789"}, retain=True)
ev("health.device.wear_state.updated", "wear_state", "state/wear", RECV, {"worn": True}, retain=True)
ev("health.sync.progress", "sync", "state/sync", RECV, {"stage": "manual MQTT test"}, retain=True)

with open("mqtt-stream.synthetic.jsonl", "w", encoding="utf-8") as f:
    for line in out:
        f.write(enc(line) + "\n")
with open("cloudevents.synthetic.jsonl", "w", encoding="utf-8") as f:  # importer input: envelopes only
    for line in out:
        f.write(line["payload"] + "\n")
