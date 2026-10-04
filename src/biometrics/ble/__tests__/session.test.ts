import { describe, expect, it } from 'vitest';
import type { RingDecodedEvent } from '@/biometrics/core/ble/types';
import { authenticationRequest, command, J2301_COMPANY_ID, J2301_UUIDS } from '@/biometrics/core/ble/jstyle2301/commands';
import { builtInPasscode } from '@/biometrics/core/ble/jstyle2301/passcode';
import { RecordedLink } from '../fakeLink';
import { colmiDriver, jstyle2301Driver } from '../drivers';
import { driverFor, getDriver } from '../registry';
import type { SessionClock } from '../session';

const clock: SessionClock = { now: () => Date.UTC(2026, 8, 16, 10), tzOffsetS: () => 0 };
const bcd = (v: number): number => (Math.floor(v / 10) << 4) | v % 10;
const hrRec = (bpm: number, min: number): Uint8Array => Uint8Array.of(0x55, 0, 0, ...[26, 9, 14, 12, min, 0].map(bcd), bpm);
const opts = { clock, timers: { quietMs: 5, stallMs: 20 } };
const collect = async (it: AsyncIterable<RingDecodedEvent>): Promise<RingDecodedEvent[]> => {
  const out: RingDecodedEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

describe('registry', () => {
  it('matches names, then services', () => {
    // A J-Style 2301 is matched by its FFF0 service, never by name.
    expect(driverFor('J2301-1234')).toBeUndefined();
    expect(driverFor('J2301-1234', [J2301_UUIDS.service])?.id).toBe('jstyle2301');
    expect(driverFor(undefined, [J2301_UUIDS.service.toUpperCase()])?.id).toBe('jstyle2301');
    expect(jstyle2301Driver.requestOptions.filters).toEqual([{ services: [J2301_UUIDS.service] }, { manufacturerData: [{ companyIdentifier: J2301_COMPANY_ID }] }]);
    expect(jstyle2301Driver.requestOptions.filters.some((f) => f.namePrefix || f.name)).toBe(false);
    expect(driverFor('R02_341C')?.id).toBe('colmi-r02');
    expect(driverFor('SMART_RING')).toBeUndefined();
    expect(getDriver('colmi-r02')).toBe(colmiDriver);
  });
});

describe('2301 session over RecordedLink', () => {
  it('V0525: battery, firmware, then one page per stream with cursors', async () => {
    const link = new RecordedLink([
      { expect: command(0x13), reply: [Uint8Array.of(0x13, 88)] },
      { expect: command(0x27), reply: [Uint8Array.of(0x27, 0, 5, 2, 5)] },
      { expect: command(0x55, 0), reply: [new Uint8Array([...hrRec(61, 1), ...hrRec(62, 2), 0x55, 0xff])] },
    ]);
    const s = await jstyle2301Driver.open(link, opts);
    expect(await s.info()).toEqual({ firmware: 'V0525', battery: 88, clockOffsetS: 0 });
    const evs = await collect(s.readHistory('hr', undefined, new AbortController().signal));
    // 0x55 answered with terminal; 0x54 gets no reply and ends on the stall timer.
    expect(evs.filter((e) => e.type === 'sample').map((e) => (e.type === 'sample' ? e.value : 0))).toEqual([61, 62]);
    expect(evs.filter((e) => e.type === 'status' && e.key === 'cursor')).toHaveLength(2);
    expect(link.writes.map((w) => w[0])).toEqual([0x13, 0x27, 0x55, 0x54]);
    expect(link.errors).toEqual(['unexpected write 54 00 00 00 00 00 00 00 00 00 00 00 00 00 00 54']);
    await s.close();
  });

  it('V0789 authenticates with the built-in passcode (nothing asked of the person); a refusal is auth_rejected', async () => {
    const steps = (ok: boolean) => [
      { expect: command(0x13), reply: [Uint8Array.of(0x13, 50)] },
      { expect: command(0x27), reply: [Uint8Array.of(0x27, 0, 7, 8, 9)] },
      { expect: { prefix: '3c' }, reply: [Uint8Array.of(0x3c, ok ? 1 : 0)] },
    ];
    const link = new RecordedLink(steps(true));
    const s = await jstyle2301Driver.open(link, opts);
    expect((await s.info()).firmware).toBe('V0789');
    // Compared as a boolean so a failure never prints the frame.
    expect(link.writes[2]?.join() === authenticationRequest(builtInPasscode()).join()).toBe(true);
    await s.close();
    await expect(jstyle2301Driver.open(new RecordedLink(steps(false)), opts)).rejects.toMatchObject({ code: 'auth_rejected' });
    await expect(jstyle2301Driver.open(new RecordedLink(steps(false)), { ...opts, credential: 'A1b2C3d4' })).rejects.toMatchObject({ code: 'auth_rejected' });
  });

  it('unknown firmware blocks history', async () => {
    const link = new RecordedLink([
      { expect: command(0x13), reply: [Uint8Array.of(0x13, 50)] },
      { expect: command(0x27), reply: [Uint8Array.of(0x27, 1, 2, 3, 4)] },
    ]);
    const s = await jstyle2301Driver.open(link, opts);
    const evs = await collect(s.sync({}, () => {}, new AbortController().signal));
    expect(evs).toEqual([{ type: 'status', key: 'error', value: 'unsupported_firmware:V1234' }]);
  });

  it('abort stops a sync; a dropped link rejects', async () => {
    const link = new RecordedLink([
      { expect: command(0x13), reply: [Uint8Array.of(0x13, 50)] },
      { expect: command(0x27), reply: [Uint8Array.of(0x27, 0, 5, 2, 5)] },
      { expect: command(0x51, 0), disconnectAfter: true },
    ]);
    const s = await jstyle2301Driver.open(link, opts);
    await expect(collect(s.sync({}, () => {}, new AbortController().signal))).rejects.toMatchObject({ code: 'disconnected' });
    const ac = new AbortController();
    ac.abort();
    await expect(collect(s.sync({}, () => {}, ac.signal))).rejects.toMatchObject({ code: 'aborted' });
  });
});
