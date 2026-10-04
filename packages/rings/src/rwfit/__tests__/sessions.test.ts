// @vitest-environment node
/**
 * RWfit sessions (`sessions.json`) replayed over the fake peripheral with `openRingSession`: framing chosen from the
 * discovered services, the connect burst, the legacy manifest-gated cascade and the JL burst with its ACKs. Also the scan
 * cases (`scan.json`) and the reconnect / priority values.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { FakePeripheral, fakeFromSession, type FixtureSession } from '../../testing';
import { ANDROID_RECONNECT, DEFAULT_PRIORITY, fromHex, toHex, uuid16, type RingEvent } from '../../types';
import { rwfit } from '../family';
import type { RWfitState } from '../protocol';
import { collect, fixture, kotlinEvents, sameAsKotlin, utc } from './helpers';

type Session = FixtureSession & { framing: 'legacy' | 'jl'; expectEvents?: Array<Record<string, unknown>> };
const sessions = fixture<{ sessions: Session[] }>('sessions.json').sessions;
const TIMERS = { quietMs: 30, stallMs: 80 };
const open = (fake: FakePeripheral, now = utc.now) => openRingSession(rwfit, fake, { timers: TIMERS, clock: { now, tzOffsetS: utc.tzOffsetS } });

describe('rwfit sessions', () => {
  for (const s of sessions) {
    it(s.name, async () => {
      const fake = fakeFromSession(s, { frameLength: 0 });
      let testNow = utc.now();
      const session = await open(fake, () => testNow);
      expect((session.runtime.state as RWfitState).framing).toBe(s.framing);
      expect(session.info()).toEqual({ firmware: s.framing, battery: undefined, clockOffsetS: 0 });
      expect(session.identity).toMatchObject({ family: 'rwfit', basis: 'advertised' });
      const scripted = s.steps.length;
      if (scripted <= 1) {
        // Only the first write is asserted; every write of the burst uses the chosen framing.
        expect(toHex(fake.writes[0]!)).toBe(s.steps[0]!.expectWrite);
        const magic = s.framing === 'jl' ? 0xab : 0x7e;
        expect(fake.writes.every((w) => w[0] === magic)).toBe(true);
        await session.close();
        return;
      }
      // This Kotlin golden history reply is from epoch 2000; align the synthetic receive clock to its capture.
      if (s.name === 'jl connect and history burst') testNow = 947_454_900_000;
      const evs = await collect(session.sync({}, () => {}, new AbortController().signal));
      expect(fake.writes.map(toHex)).toEqual(s.steps.map((x) => x.expectWrite));
      expect(fake.errors).toEqual([]);
      expect(fake.remaining).toBe(0);
      for (const e of s.expectEvents ?? []) expect(kotlinEvents(evs).map((k) => sameAsKotlin(k, e)).some((r) => r === null)).toBe(true);
      expect(evs.at(-1)).toMatchObject({ type: 'progress', done: true });
      if (s.framing === 'jl') {
        // The heart-rate reply closes its stream with a cursor; the eight streams that never answered are reported.
        expect(evs).toContainEqual({ type: 'status', key: 'cursor', value: `rw1:${947_454_848}`, stream: 'hr' });
        const errs = evs.filter((e) => e.type === 'status' && e.key === 'error').map((e) => (e.type === 'status' ? e.value : ''));
        expect(errs).toHaveLength(8);
        expect(errs.every((v) => String(v).startsWith('no_reply:'))).toBe(true);
      } else {
        // Manifest claimed steps + heart rate: only those two were read; the empty replies give no cursor and no error.
        expect(evs.filter((e) => e.type === 'status' && (e.key === 'error' || e.key === 'cursor'))).toEqual([]);
      }
      await session.close();
    });
  }

  it('the handshake battery reply lands in the info and is ACKed', async () => {
    const fake = new FakePeripheral(
      [
        { expect: '7e 01 00 00 00 00 01 00' },
        { expect: { prefix: '7e 01 21' } },
        { expect: '7e 01 01 00 00 00 03 00', reply: ['7e 01 01 00 03 00 01 4d 00 00 4d'] },
        { expect: '7e 01 ff 00 04 00 04 00 00 01 01 00' },
      ],
      { services: [uuid16(0xa00a)] },
    );
    const session = await open(fake);
    expect(session.info()).toEqual({ firmware: 'legacy', battery: 77, clockOffsetS: 0 });
    expect(session.handshakeEvents).toContainEqual({ type: 'status', key: 'charging', value: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await session.close();
  });

  it('a transport that cannot list services stays on legacy (Kotlin default)', async () => {
    const fake = new FakePeripheral([{ expect: '7e 01 00 00 00 00 01 00' }]);
    (fake as { services?: unknown }).services = undefined;
    const session = await open(fake);
    expect(session.info().firmware).toBe('legacy');
    await session.close();
  });

  it('readHistory of one stream still reads the manifest first', async () => {
    const s = sessions.find((x) => x.framing === 'legacy' && x.steps.length > 1)!;
    const fake = fakeFromSession(s, { frameLength: 0 });
    const session = await open(fake);
    const evs: RingEvent[] = await collect(session.readHistory('hr', {}, new AbortController().signal));
    expect(toHex(fake.writes[3]!)).toBe('7e 01 a0 00 00 00 04 00');
    expect(fake.writes.some((w) => w[2] === 0xa3)).toBe(true);
    expect(fake.writes.some((w) => w[2] === 0xa1)).toBe(false);
    expect(evs.at(-1)).toMatchObject({ type: 'progress', done: true });
    await session.close();
  });
});

describe('rwfit scan', () => {
  const scan = fixture<{ vectors: Array<{ name: string; advertisement: { name?: string; serviceUuids: string[]; manufacturerData: string[] }; match: boolean }> }>('scan.json');
  for (const v of scan.vectors) {
    it(v.name, () => {
      const ad = { ...v.advertisement, manufacturerData: v.advertisement.manufacturerData.map(fromHex) };
      expect(rwfit.scan.match(ad)).toBe(v.match);
    });
  }

  it('the 32-bit spelling of A00A matches too (Kotlin `0000a00a`)', () => {
    expect(rwfit.scan.match({ serviceUuids: ['0000A00A'], manufacturerData: [] })).toBe(true);
  });

  it('lists A00A and the three marker services for Web Bluetooth, and filters on service and company ids', () => {
    expect(rwfit.scan.optionalServices).toEqual([uuid16(0xa00a), uuid16(0xae00), '00010203-0405-0607-0809-0a0b0c0d1912', uuid16(0xff00)]);
    expect(rwfit.scan.requestFilters.map((f) => f.services?.[0] ?? f.manufacturerData?.[0]?.companyIdentifier)).toEqual([uuid16(0xa00a), 0x05d6, 0x05d6, 0x06d6]);
    expect(rwfit.modelFromAdvertisement?.({ name: 'RW-01', serviceUuids: [], manufacturerData: [] })).toBeUndefined();
  });
});

describe('rwfit family values', () => {
  it('reconnect and priority are the Android defaults', () => {
    expect(rwfit.reconnect).toBe(ANDROID_RECONNECT);
    expect(rwfit.priority).toBe(DEFAULT_PRIORITY);
  });

  it('GATT map, tier, no live or spot, decoder tag per framing', () => {
    expect(rwfit.gatt).toEqual({ service: uuid16(0xa00a), write: uuid16(0xb002), notify: [{ characteristic: uuid16(0xb003), mode: 'notify' }] });
    expect(rwfit.tier).toBe('C');
    expect(rwfit.liveHeartRate).toBeUndefined();
    expect(rwfit.spot).toBeUndefined();
    expect(rwfit.decoderTag('jl')).toBe('rwfit/jl@1');
    expect(rwfit.decoderTag('')).toBe('rwfit/unknown@1');
    const f = fromHex('ab 01 00 03 fc a0 02 03 10');
    expect(rwfit.protocol.redactOutbound(f)).toEqual(f);
  });
});
