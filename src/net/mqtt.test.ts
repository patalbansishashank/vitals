import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNetAllowlist } from './net';
import { allowNewPhone, createMqttCredential, getMqttStatus, MqttRequestError, revokeMqttCredential, setServerConnection } from './mqtt';

const fetchMock = vi.fn();
beforeEach(() => {
  resetNetAllowlist();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setServerConnection({ baseUrl: 'https://home.example.ts.net:8443', token: 'SECRET-TOKEN' });
});
afterEach(() => {
  setServerConnection(undefined);
  vi.unstubAllGlobals();
});
const ok = (body: unknown, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));

describe('mqtt server calls', () => {
  it('sends the token in the Authorization header and never in the URL', async () => {
    fetchMock.mockReturnValue(ok({ enabled: true }));
    await getMqttStatus();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://home.example.ts.net:8443/v1/mqtt/status');
    expect(String(url)).not.toContain('SECRET');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer SECRET-TOKEN' });
  });

  it('uses the documented routes and methods', async () => {
    fetchMock.mockImplementation(() => ok({}));
    await createMqttCredential();
    fetchMock.mockImplementation(() => ok(null, 204));
    await revokeMqttCredential('p1-1');
    await allowNewPhone('p1-1');
    const calls = fetchMock.mock.calls.map(([u, i]) => `${(i as RequestInit).method} ${new URL(String(u)).pathname}`);
    expect(calls).toEqual(['POST /v1/mqtt/credentials', 'DELETE /v1/mqtt/credentials/p1-1', 'POST /v1/mqtt/credentials/p1-1/allow-new-phone']);
  });

  it('refuses without a paired server and reports server errors', async () => {
    setServerConnection(null);
    await expect(getMqttStatus()).rejects.toMatchObject({ code: 'not_paired' });
    expect(fetchMock).not.toHaveBeenCalled();
    setServerConnection({ baseUrl: 'https://home.example.ts.net:8443', token: 't' });
    fetchMock.mockReturnValue(ok({ error: 'unauthorized' }, 401));
    await expect(getMqttStatus()).rejects.toBeInstanceOf(MqttRequestError);
  });
});
