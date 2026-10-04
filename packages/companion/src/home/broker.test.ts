// @vitest-environment node
/** MQTT ingest (SUITE_SPEC §14.5, §14.9 "Ack after write"): a real mqtt.js client over WebSocket into the in-process broker. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import mqtt, { type MqttClient } from 'mqtt';
import { afterEach, describe, expect, it } from 'vitest';
import { appendDurable } from './ingest.ts';
import { startTestHome } from './testHome.ts';

const INST = 'a'.repeat(32);
const TOPIC = `lumen-health/v1/${INST}/metrics/hr`;
const ce = (id: string, type = 'health.metric.observed') =>
  JSON.stringify({ specversion: '1.0', id, type, source: 'lumen', time: '2026-10-02T21:00:00Z', data: { metric: 'hr', value: 60, unit: 'bpm', observed_at: '2026-10-02T21:00:00Z' } });

let stop: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const s of stop.reverse()) await s();
  stop = [];
});

async function setup(dataDir?: string) {
  const t = await startTestHome({ mqtt: true, ...(dataDir ? { dataDir } : {}) });
  stop.push(() => t.c.close());
  const a = await t.person('Ana');
  const cred = (await t.api('/v1/mqtt/credentials', { method: 'POST', token: a.token, body: {} })).body as unknown as { username: string; password: string; address: string; baseTopic: string };
  const connect = async (o: mqtt.IClientOptions = {}) => {
    const c: MqttClient = await mqtt.connectAsync(`${t.c.url.replace('http', 'ws')}/mqtt`, { username: cred.username, password: cred.password, protocolVersion: 4, clean: true, reconnectPeriod: 200, connectTimeout: 5000, ...o });
    stop.push(() => c.endAsync(true));
    return c;
  };
  return { t, a, cred, connect };
}

describe('MQTT broker', () => {
  it('hands out a credential once and refuses bad logins and subscriptions', async () => {
    const { t, a, cred, connect } = await setup();
    expect(cred).toMatchObject({ address: 'wss://host.tail0.ts.net:8443/mqtt', baseTopic: 'lumen-health/v1' });
    expect(cred.username).toBe(`p${a.id}-1`);
    expect(await readFile(t.home.persons.paths(a.id).mqtt, 'utf8')).not.toContain(cred.password);
    await expect(mqtt.connectAsync(`${t.c.url.replace('http', 'ws')}/mqtt`, { username: cred.username, password: 'nope', reconnectPeriod: 0 })).rejects.toThrow();
    const c = await connect();
    const granted = await c.subscribeAsync('#', { qos: 1 }).catch((e: Error) => e);
    expect(Array.isArray(granted) ? granted[0]!.qos : 128).toBe(128);
    const s = await t.api('/v1/mqtt/status', { token: a.token });
    expect(s.body).toMatchObject({ enabled: true, address: cred.address, credentials: [{ username: cred.username, connected: true }] });
  });

  it('acknowledges only after the WAL append, and the hook delay shows in the PUBACK (≥ 2 s)', async () => {
    const { t, a, connect } = await setup();
    const c = await connect();
    const real = t.home.ingest.walAppend;
    t.home.ingest.walAppend = async (f, l) => {
      await new Promise((r) => setTimeout(r, 2000));
      return real(f, l);
    };
    const t0 = performance.now();
    await c.publishAsync(TOPIC, ce('e1'), { qos: 1 });
    const ms = performance.now() - t0;
    expect(ms).toBeGreaterThanOrEqual(2000);
    await t.home.broker!.idle();
    expect(t.fake.ingested(a.id)).toHaveLength(1);
    console.log(`PUBACK delay with a 2 s hook: ${Math.round(ms)} ms`);
  }, 20_000);

  it('a failed WAL write closes the connection without PUBACK; the client resends and it is stored once', async () => {
    const { t, a, connect } = await setup();
    const c = await connect({ clean: false, clientId: 'lumen-test' });
    let fail = 1;
    t.home.ingest.walAppend = async (f, l) => {
      if (fail-- > 0) throw new Error('disk full');
      return appendDurable(f, l);
    };
    let closes = 0;
    c.on('close', () => closes++);
    await c.publishAsync(TOPIC, ce('e2'), { qos: 1 });
    expect(closes).toBeGreaterThanOrEqual(1);
    await c.publishAsync(TOPIC, ce('e2'), { qos: 1 }); // a resend after a lost PUBACK: same envelope id
    await t.home.broker!.idle();
    expect(t.fake.ingested(a.id)).toHaveLength(1);
  }, 20_000);

  it('serialises 10 in-flight messages, writes them in order, and keeps the WAL small', async () => {
    const { t, a, connect } = await setup();
    const c = await connect();
    await Promise.all(Array.from({ length: 10 }, (_, i) => c.publishAsync(TOPIC, ce(`m${i}`), { qos: 1 })));
    await t.home.broker!.idle();
    // messages that piled up during an import go in one call: count every event of every call
    const got = t.fake.ingested(a.id).flatMap((r) => (r.op === 'ingestLumen' ? r.events.map((e) => (e as { id: string }).id) : ['']));
    expect(got).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`));
    const wal = await readFile(t.home.persons.paths(a.id).wal, 'utf8');
    expect(wal).not.toContain('"payload"');
  });

  it('dead-letters bad messages with the right reason and still acknowledges them', async () => {
    const { t, a, connect } = await setup();
    const c = await connect();
    await c.publishAsync(TOPIC, 'not json', { qos: 1 });
    await c.publishAsync(TOPIC, JSON.stringify({ hello: 1 }), { qos: 1 });
    await c.publishAsync(TOPIC, Buffer.alloc(300 * 1024, 32), { qos: 1 });
    await c.publishAsync(TOPIC, ce('u1', 'health.unknown.thing'), { qos: 1 });
    await c.publishAsync(TOPIC, ce('ok1'), { qos: 1 });
    await c.publishAsync(`lumen-health/v1/${'b'.repeat(32)}/metrics/hr`, ce('w1'), { qos: 1 });
    await t.home.broker!.idle();
    const dir = t.home.persons.paths(a.id).deadletter;
    const lines = (await Promise.all((await readdir(dir)).map((f) => readFile(join(dir, f), 'utf8')))).join('').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { reason: string; sample: string });
    expect(lines.map((l) => l.reason).sort()).toEqual(['not_cloudevent', 'not_json', 'too_large', 'unknown_type', 'wrong_installation']);
    expect(lines.every((l) => l.sample.length <= 2048)).toBe(true);
    const s = await t.api('/v1/mqtt/status', { token: a.token });
    expect(s.body.deadLetters).toMatchObject({ today: 5, last7d: 5, byReason: { not_cloudevent: 1, not_json: 1, too_large: 1, unknown_type: 1, wrong_installation: 1 } });
    expect(s.body.eventsToday).toEqual([{ stream: 'hr', count: 1 }]);
    expect(s.body.battery).toBeNull();
    await c.publishAsync(TOPIC, JSON.stringify({ specversion: '1.0', id: 'b1', type: 'health.device.battery.updated', source: 'lumen', time: '2026-10-02T21:05:00Z', data: { observed_at: '2026-10-02T21:05:00Z', percent: 64 } }), { qos: 1 });
    await t.home.broker!.idle();
    expect((await t.api('/v1/mqtt/status', { token: a.token })).body.battery).toEqual({ percent: 64, at: '2026-10-02T21:05:00Z' });
    // "Allow a new phone" clears the pin
    const cred = (s.body.credentials as unknown as Array<{ username: string }>)[0]!.username;
    expect((await t.api(`/v1/mqtt/credentials/${cred}/allow-new-phone`, { method: 'POST', token: a.token, body: {} })).status).toBe(200);
    await c.publishAsync(`lumen-health/v1/${'b'.repeat(32)}/metrics/hr`, ce('w2'), { qos: 1 });
    await t.home.broker!.idle();
    expect(t.fake.ingested(a.id)).toHaveLength(4); // ok1, the unknown type (rejected inside the worker), the battery, w2
  });

  it('imports WAL entries left undone at shutdown when the server starts again', async () => {
    const first = await setup();
    const { a } = first;
    const p = first.t.home.persons.paths(a.id);
    await appendDurable(p.wal, JSON.stringify({ envelopeId: 'left1', topic: TOPIC, receivedAt: '2026-10-03T00:00:00Z', payload: ce('left1') }));
    await first.t.c.close();
    stop = [];
    const again = await startTestHome({ mqtt: true, dataDir: first.t.dataDir });
    stop.push(() => again.c.close());
    expect(again.fake.ingested(a.id)).toHaveLength(1);
    expect(await again.home.ingest.walPending(a.id)).toEqual([]);
  });

  it('revoking a credential disconnects it at once', async () => {
    const { t, a, cred, connect } = await setup();
    const c = await connect({ reconnectPeriod: 0 });
    const closed = new Promise<void>((r) => c.once('close', () => r()));
    expect((await t.api(`/v1/mqtt/credentials/${cred.username}`, { method: 'DELETE', token: a.token })).status).toBe(204);
    await closed;
    expect((await t.api('/v1/mqtt/status', { token: a.token })).body.credentials).toEqual([]);
  });
});


describe('MQTT over TLS (the phone connects to a public name that points at the tailnet: ssl://)', () => {
  async function tlsSetup() {
    const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-subj', '/CN=localhost', '-days', '2', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
    const t = await startTestHome({ mqtt: true, mqttTls: { certFile: join(dir, 'c.pem'), keyFile: join(dir, 'k.pem') } });
    stop.push(() => t.c.close());
    const a = await t.person('Ana');
    const cred = (await t.api('/v1/mqtt/credentials', { method: 'POST', token: a.token, body: {} })).body as unknown as { username: string; password: string };
    const port = t.home.broker!.tlsPorts[0]!;
    const ca = await readFile(join(dir, 'c.pem'));
    return { t, a, cred, port, ca };
  }

  it('listens on the TLS port, verifies the certificate, acknowledges after the write and refuses a bad login', async () => {
    const { t, a, cred, port, ca } = await tlsSetup();
    expect(t.home.broker!.tlsPorts).toHaveLength(1);
    const c = await mqtt.connectAsync(`mqtts://127.0.0.1:${port}`, { username: cred.username, password: cred.password, protocolVersion: 4, clean: true, reconnectPeriod: 0, ca, rejectUnauthorized: true });
    stop.push(() => c.endAsync(true));
    await c.publishAsync(TOPIC, ce('tls1'), { qos: 1 });
    await t.home.broker!.idle();
    expect(t.fake.ingested(a.id)).toHaveLength(1);
    await expect(mqtt.connectAsync(`mqtts://127.0.0.1:${port}`, { username: cred.username, password: 'nope', reconnectPeriod: 0, ca })).rejects.toThrow();
    const s = await t.api('/v1/mqtt/status', { token: a.token });
    expect(s.body).toMatchObject({ credentials: [{ username: cred.username, connected: true }] });
  });

  it('refuses a client that does not trust the certificate, and a plain-text client never gets in; the server keeps serving', async () => {
    const { t, a, cred, port } = await tlsSetup();
    await expect(mqtt.connectAsync(`mqtts://127.0.0.1:${port}`, { username: cred.username, password: cred.password, reconnectPeriod: 0, rejectUnauthorized: true })).rejects.toThrow();
    // plain MQTT bytes on the TLS port: the handshake fails and the socket is dropped
    const dropped = await new Promise<boolean>((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => s.write(Buffer.from([0x10, 0x0c, 0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c, 0x00, 0x00])));
      s.on('close', () => resolve(true));
      s.on('error', () => resolve(true));
      setTimeout(() => { s.destroy(); resolve(false); }, 4000);
    });
    expect(dropped).toBe(true);
    // the listener is still up and the broker still healthy afterwards
    expect(t.home.broker!.tlsPorts).toEqual([port]);
    expect((await t.api('/v1/mqtt/status', { token: a.token })).status).toBe(200);
  }, 15_000);
});
