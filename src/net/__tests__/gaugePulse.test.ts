/** (r069 sync) The pulse client: the held read's query, the answer checked, and what an older server or a refusal says. */
import { describe, expect, it, vi } from 'vitest';
import { createGaugePulseApi, pulseMovedData, pulseOf } from '../gaugePulse';

const P = { token: 'b1.3.2', boot: 'b1', uploads: 3, data: 2, lastUploadAt: '2026-10-29T11:50:00.000Z', dataAt: '2026-10-29T11:49:00.000Z' };

function serverWith(fetch: (url: string) => Promise<Response>) {
  return { isPaired: () => true, chatModelOptions: () => ({ serverUrl: 'https://home.example:8443/', deps: { fetch } }) } as never;
}

describe('gauge pulse client', () => {
  it('reads an answer field by field', () => {
    expect(pulseOf({ ...P, serverNow: 'x' })).toEqual(P);
    expect(pulseOf({ ...P, data: -1 })).toBeNull();
    expect(pulseOf(null)).toBeNull();
  });

  it('moves data on a new data count or a new server run, never on uploads alone or the first answer', () => {
    expect(pulseMovedData(null, P)).toBe(false);
    expect(pulseMovedData(P, { ...P, uploads: 9, token: 'b1.9.2' })).toBe(false);
    expect(pulseMovedData(P, { ...P, data: 3, token: 'b1.3.3' })).toBe(true);
    expect(pulseMovedData(P, { ...P, boot: 'b2', token: 'b2.3.2' })).toBe(true);
  });

  it('holds with since and wait, asks at once without since; 404 is not_supported, 403 unauthorized, offline offline', async () => {
    const urls: string[] = [];
    const ok = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(P), { status: 200 });
    });
    const api = createGaugePulseApi({ server: serverWith(ok) });
    expect(await api.pulse(null)).toEqual({ ok: true, pulse: P });
    expect(await api.pulse('b1.3.2', { wait: 25 })).toEqual({ ok: true, pulse: P });
    expect(urls).toEqual(['https://home.example:8443/v1/gauge/pulse', 'https://home.example:8443/v1/gauge/pulse?since=b1.3.2&wait=25']);
    expect(await createGaugePulseApi({ server: serverWith(async () => new Response('', { status: 404 })) }).pulse(null)).toEqual({ ok: false, problem: 'not_supported' });
    expect(await createGaugePulseApi({ server: serverWith(async () => new Response('', { status: 403 })) }).pulse(null)).toEqual({ ok: false, problem: 'unauthorized' });
    expect(await createGaugePulseApi({ server: serverWith(() => Promise.reject(new TypeError('network'))) }).pulse(null)).toEqual({ ok: false, problem: 'offline' });
    expect(await createGaugePulseApi({ server: { isPaired: () => false } as never }).pulse(null)).toEqual({ ok: false, problem: 'not_paired' });
  });
});
