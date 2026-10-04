/** Plan 04 item 11: a ring connected through Vitals is shared by default; other imports stay opt-in (SUITE_SPEC §15.2). */
import { describe, expect, it } from 'vitest';
import { batch, daily, hrSeries, NOW, prov } from './factory';
import { adoptPersonPolicies, applyImportPolicy, effectivePolicy, importPolicies } from '../effective';
import {
  isRingSource, POLICY_STREAMS, ringChoiceOf, ringDefaultPolicies, ringDefaultPolicy, ringPoliciesAtDefault, ringSharing, ringSharingOffPolicy, ringStartPolicies, ringStartPolicy,
  suggestedOnPolicy,
} from '../policy';
import { newSourceDoc, ringDefaultPolicies as fromSource, sourceKeyOf, suggestedPolicies } from '../source';
import type { BioProvenance, StreamPolicy } from '../types';
import { InMemoryBioStore } from '../../store/memory';
import { ingestBatches } from '../../ingest/pipeline';

const RING = { type: 'ring', manufacturer: 'J-Style', model: '2301', tier: 'C' } as const;
const ble = prov({ channel: 'ble:jstyle', device: RING });
const lumenMqtt = prov({ channel: 'mqtt:lumen', device: { type: 'ring', model: 'J-Style 2301', tier: 'C' } });
const lumenFile = prov({ channel: 'file:lumen_cloudevents', device: { type: 'ring', model: 'J-Style 2301', tier: 'C' } });
const lumenArchive = prov({ channel: 'file:lumen_archive', device: { type: 'ring', model: 'J-Style 2301', tier: 'C' } });
// other apps' files mark rings too; they keep the opt-in default
const apple = prov({ channel: 'file:apple_health', device: { type: 'ring', manufacturer: 'Other', model: 'Ring', tier: 'B' } });
const gadget = prov({ channel: 'file:gadgetbridge', device: { type: 'ring', manufacturer: 'Other', model: 'R09', tier: 'C' } });
const hc = prov({ channel: 'file:health_connect', device: { type: 'ring', manufacturer: 'Other', model: 'Ring', tier: 'B' } });

const allRingDefaults = (ps: readonly StreamPolicy[]) => POLICY_STREAMS.every((s) => JSON.stringify(ps.find((p) => p.stream === s)) === JSON.stringify(ringDefaultPolicy(s)));

describe('ring defaults', () => {
  it('every stream: imported, scores, plan where eligible, Coach daily + detail; vendor scores never feed scores or plan', () => {
    const ps = ringDefaultPolicies();
    expect(ps.map((p) => p.stream)).toEqual([...POLICY_STREAMS]);
    expect(ps.find((p) => p.stream === 'sleep_sessions')).toEqual({ stream: 'sleep_sessions', imported: true, coach: 'daily+series', engine: true, scores: true });
    expect(ps.find((p) => p.stream === 'spo2')).toEqual({ stream: 'spo2', imported: true, coach: 'daily+series', engine: false, scores: true });
    expect(ps.find((p) => p.stream === 'vendor_scores')).toEqual({ stream: 'vendor_scores', imported: true, coach: 'daily+series', engine: false, scores: false });
    expect(fromSource()).toEqual(ps);
  });

  it('ring sources: Bluetooth (old and new key forms) and Lumen by any route; not other apps’ files', () => {
    for (const p of [ble, lumenMqtt, lumenFile, lumenArchive]) expect(isRingSource({ sourceKey: sourceKeyOf(p) }), p.channel).toBe(true);
    expect(isRingSource({ sourceKey: 'ble:jstyle/2301/AB12CD' })).toBe(true);
    for (const p of [apple, gadget, hc, prov()]) expect(isRingSource({ sourceKey: sourceKeyOf(p), deviceType: 'ring' }), p.channel).toBe(false);
  });

  it('newSourceDoc gives a ring the ring defaults on every stream and any other source the device-on suggestion', () => {
    for (const p of [ble, lumenMqtt, lumenFile, lumenArchive]) expect(allRingDefaults(newSourceDoc(p, 0, ['hr']).policies), p.channel).toBe(true);
    for (const p of [apple, gadget, hc]) {
      const doc = newSourceDoc(p, 0, ['hr', 'sleep_sessions']);
      expect(doc.policies, p.channel).toEqual(suggestedPolicies(['hr', 'sleep_sessions']));
      expect(doc.policies.every((x) => x.coach === 'hidden')).toBe(true);
    }
  });

  it('a person matrix nobody set keeps ring streams on; an explicit person choice wins', () => {
    expect(adoptPersonPolicies(ringDefaultPolicies(), [])).toEqual(ringDefaultPolicies());
    const person: StreamPolicy[] = [{ stream: 'hr', imported: true, coach: 'hidden', engine: true, scores: false }];
    const adopted = adoptPersonPolicies(ringDefaultPolicies(), person);
    expect(adopted.find((p) => p.stream === 'hr')).toEqual(person[0]);
    expect(adopted.find((p) => p.stream === 'hrv')).toEqual(ringDefaultPolicy('hrv'));
  });

  it('a ring source without its own entry falls back to the ring default; other sources to the device-on suggestion', () => {
    expect(effectivePolicy({ sourceKey: sourceKeyOf(ble), policies: [] }, [], 'hrv')).toEqual(ringDefaultPolicy('hrv'));
    expect(effectivePolicy({ sourceKey: sourceKeyOf(apple), policies: [] }, [], 'hrv')).toEqual(suggestedOnPolicy('hrv'));
    expect(effectivePolicy({ policies: [] }, [], 'hrv')).toEqual(suggestedOnPolicy('hrv'));
  });

  it('ring records are not dropped at ingest when the person matrix was never set', async () => {
    const b = batch([daily('d1', '2026-03-10', { steps: 9000, resting_hr_bpm: 55 }, lumenMqtt), hrSeries('h1', '2026-03-10T01:00:00.000Z', [60, 61, 62], 60, lumenMqtt)]);
    expect(applyImportPolicy(b, [])).toEqual(b);
    const store = new InMemoryBioStore();
    const rep = await ingestBatches([applyImportPolicy(b, [])], store, { now: NOW, policies: importPolicies([]) });
    expect(rep).toMatchObject({ records: 1, samples: 3, skipped: 0 });
    expect(rep.sources).toEqual([sourceKeyOf(lumenMqtt)]);
    expect(sourceKeyOf(lumenMqtt).startsWith('file:lumen_cloudevents')).toBe(true);
    const src = (await store.getSource(sourceKeyOf(lumenMqtt)))!;
    expect(allRingDefaults(src.policies)).toBe(true);
  });

  it('a new stream on an existing ring source starts from the ring default', async () => {
    const store = new InMemoryBioStore();
    const sk = sourceKeyOf(ble);
    await store.putSource({ ...newSourceDoc(ble, 0, []), policies: [ringDefaultPolicy('steps')] });
    await ingestBatches([batch([hrSeries('h1', '2026-03-10T01:00:00.000Z', [60, 61], 60, ble)])], store, { now: NOW });
    expect((await store.getSource(sk))!.policies.find((p) => p.stream === 'hr')).toEqual(ringDefaultPolicy('hr'));
  });
});

describe('the master switch off is remembered for rings that come later (J7-01)', () => {
  const allOff = (ps: readonly StreamPolicy[]) => POLICY_STREAMS.every((s) => JSON.stringify(ps.find((p) => p.stream === s)) === JSON.stringify(ringSharingOffPolicy(s)));

  it('ringStartPolicies: the ring defaults, or with the switch off what the switch writes', () => {
    expect(ringStartPolicies()).toEqual(ringDefaultPolicies());
    expect(ringStartPolicies('on')).toEqual(ringDefaultPolicies());
    expect(ringStartPolicies('off')).toEqual(POLICY_STREAMS.map((s) => ringSharingOffPolicy(s)));
    expect(ringStartPolicy('hr', 'off')).toEqual({ stream: 'hr', imported: true, coach: 'hidden', engine: false, scores: false });
    expect(ringSharing([{ sourceKey: sourceKeyOf(ble), policies: ringStartPolicies('off') }])).toBe('off');
  });

  it('the stored choice: off only when the document says so', () => {
    expect(ringChoiceOf(undefined)).toBe('on');
    expect(ringChoiceOf({ kind: 'ringSharing', choice: 'on' })).toBe('on');
    expect(ringChoiceOf({ kind: 'ringSharing', choice: 'off' })).toBe('off');
    expect(ringChoiceOf({ choice: 'OFF' })).toBe('on');
  });

  it('newSourceDoc: a ring starts off with the switch off; other sources keep the device-on suggestion', () => {
    for (const p of [ble, lumenMqtt, lumenFile, lumenArchive]) expect(allOff(newSourceDoc(p, 0, ['hr'], 'off').policies), p.channel).toBe(true);
    expect(allRingDefaults(newSourceDoc(ble, 0, ['hr'], 'on').policies)).toBe(true);
    for (const p of [apple, gadget, hc]) expect(newSourceDoc(p, 0, ['hr'], 'off').policies, p.channel).toEqual(suggestedPolicies(['hr']));
  });

  it('ingest with the switch off: a new ring source and a stream new to one start off, still brought in', async () => {
    const store = new InMemoryBioStore();
    const b = batch([daily('d1', '2026-03-10', { steps: 9000 }, lumenMqtt), hrSeries('h1', '2026-03-10T01:00:00.000Z', [60, 61, 62], 60, lumenMqtt)]);
    const rep = await ingestBatches([b], store, { now: NOW, policies: importPolicies([]), ringSharing: 'off' });
    expect(rep).toMatchObject({ records: 1, samples: 3, skipped: 0 });
    expect(allOff((await store.getSource(sourceKeyOf(lumenMqtt)))!.policies)).toBe(true);

    await store.putSource({ ...newSourceDoc(ble, 0, []), policies: [ringSharingOffPolicy('steps')] });
    await ingestBatches([batch([hrSeries('h2', '2026-03-10T02:00:00.000Z', [60, 61], 60, ble)])], store, { now: NOW, ringSharing: 'off' });
    expect((await store.getSource(sourceKeyOf(ble)))!.policies.find((p) => p.stream === 'hr')).toEqual(ringSharingOffPolicy('hr'));
  });

  it('one ring test everywhere: the device type on the doc or on its records does not make a ring source', () => {
    expect(isRingSource({ sourceKey: sourceKeyOf(apple), deviceType: 'ring' }, 'ring')).toBe(false);
    expect(isRingSource({ sourceKey: sourceKeyOf(ble) }, 'watch')).toBe(true);
  });
});

describe('ringSharing (the master switch state)', () => {
  const ring = (policies: StreamPolicy[], p: BioProvenance = ble) => ({ sourceKey: sourceKeyOf(p), policies });
  const other = { sourceKey: sourceKeyOf(apple), policies: suggestedPolicies(['hr']) };

  it('reads none, on, off and some', () => {
    expect(ringSharing([other])).toBe('none');
    expect(ringSharing([other, ring(ringDefaultPolicies())])).toBe('on');
    const off = POLICY_STREAMS.map((s) => ringSharingOffPolicy(s));
    expect(ringSharing([ring(off), other])).toBe('off');
    expect(ringSharing([ring(ringDefaultPolicies()), ring(off, lumenFile)])).toBe('some');
    expect(ringSharing([ring(ringDefaultPolicies().map((p) => (p.stream === 'hr' ? { ...p, coach: 'daily' as const } : p)))])).toBe('some');
  });

  it('off keeps what the person stopped bringing in', () => {
    expect(ringSharingOffPolicy('hr', { stream: 'hr', imported: false, coach: 'hidden', engine: false, scores: false })).toMatchObject({ imported: false });
    expect(ringSharingOffPolicy('hr')).toEqual({ stream: 'hr', imported: true, coach: 'hidden', engine: false, scores: false });
  });
});

describe('ringPoliciesAtDefault (migration test of "never changed")', () => {
  it('the old device-on suggestion and the ring default read as untouched; any other entry as a choice', () => {
    expect(ringPoliciesAtDefault(suggestedPolicies(['hr', 'sleep_sessions', 'vendor_scores']))).toBe(true);
    expect(ringPoliciesAtDefault(ringDefaultPolicies())).toBe(true);
    expect(ringPoliciesAtDefault([...suggestedPolicies(['hr']), { stream: 'hrv', imported: true, coach: 'daily', engine: true, scores: true }])).toBe(false);
    expect(ringPoliciesAtDefault([{ stream: 'hr', imported: false, coach: 'hidden', engine: false, scores: false }])).toBe(false);
  });
});
