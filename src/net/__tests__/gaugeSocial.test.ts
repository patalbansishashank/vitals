/** (social-time) The `socialTime` read: the tool JSON from `/v1/gauge/social-time`, the device zone on the query, null offline. */
import { describe, expect, it } from 'vitest';
import { ServerError } from '../server';
import { createGaugeApi, type GaugeSocialTime } from '../gauge';
import { SOCIAL_APP_KEYS, SOCIAL_TARGET_MAX_MINUTES, SOCIAL_TARGET_MIN_MINUTES, socialAppLabel } from '../gaugeSocial';

const BASE = 'https://home.example:8443';
const envelope = (data: unknown) => ({ ok: true, status: 'applied', summary: 'ok', data });

const SOCIAL: GaugeSocialTime = {
  from: '2026-11-10',
  to: '2026-11-16',
  tz: 'Asia/Kolkata',
  days: [
    { date: '2026-11-16', totalSeconds: 1980, perApp: { instagram: 1200, youtube: 600, reddit: 180 }, targetMinMinutes: 30, targetMaxMinutes: 45 },
  ],
  source: 'usage_access',
};

type Reply = { status: number; body?: unknown } | 'down';

function fakeServer(replies: Reply[], paired = true) {
  const calls: Array<{ url: string }> = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push({ url: String(input) });
    const r = replies.shift() ?? { status: 500 };
    if (r === 'down') throw new TypeError('Failed to fetch');
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  const server = {
    isPaired: () => paired,
    pairing: () => (paired ? { baseUrl: BASE, person: { id: 'person-a', label: '' }, deviceId: 'device-a', pairedAt: 'device-a' } : null),
    subscribe: () => () => undefined,
    chatModelOptions: () => {
      if (!paired) throw new ServerError('not_paired');
      return { serverUrl: `${BASE}/`, deps: { fetch: fetchImpl } };
    },
  };
  return { server, calls };
}

describe('gauge socialTime', () => {
  it('the catalogue is the seven-app common set, in order, with the default target band', () => {
    expect(SOCIAL_APP_KEYS).toEqual(['instagram', 'youtube', 'facebook', 'snapchat', 'twitter', 'reddit', 'tiktok']);
    expect(socialAppLabel('twitter')).toBe('X');
    expect(socialAppLabel('unknown-key')).toBe('unknown-key');
    expect([SOCIAL_TARGET_MIN_MINUTES, SOCIAL_TARGET_MAX_MINUTES]).toEqual([30, 45]);
  });

  it('reads the tool JSON and carries from/to and the device zone', async () => {
    const { server, calls } = fakeServer([{ status: 200, body: envelope(SOCIAL) }]);
    const api = createGaugeApi({ server, tz: () => 'Asia/Kolkata' });
    expect(await api.socialTime!('2026-11-10', '2026-11-16')).toEqual(SOCIAL);
    expect(calls[0]!.url).toBe(`${BASE}/v1/gauge/social-time?from=2026-11-10&to=2026-11-16&tz=Asia%2FKolkata`);
  });

  it('is null when not paired, and asks nothing', async () => {
    const { server, calls } = fakeServer([], false);
    const api = createGaugeApi({ server });
    expect(await api.socialTime!('2026-11-10', '2026-11-16')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('offline: the last good answer', async () => {
    const { server } = fakeServer([{ status: 200, body: envelope(SOCIAL) }, 'down']);
    const api = createGaugeApi({ server, tz: () => 'Asia/Kolkata' });
    await api.socialTime!('2026-11-10', '2026-11-16');
    expect(await api.socialTime!('2026-11-10', '2026-11-16')).toEqual(SOCIAL);
    expect(api.status().problem).toBe('offline');
  });
});
