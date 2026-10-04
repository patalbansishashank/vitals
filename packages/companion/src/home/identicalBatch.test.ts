// @vitest-environment node
/**
 * SUITE_SPEC §14.9 "Identical batch", end to end through the broker: the synthetic Lumen stream sent one message at a
 * time by a real MQTT client (mqtt.js, WebSocket, QoS 1) into the in-process broker and the real person program; then
 * the same events as one file-sized batch add zero records. (Record-level equality of the file and broker paths, up to
 * `channel` and `ingested_at`, is proven in src/biometrics/importers/__tests__/lumenIngest.test.ts.)
 */
import { readFile } from 'node:fs/promises';
import mqtt from 'mqtt';
import { afterAll, expect, it } from 'vitest';
import { openPersonProgram } from './personProgram.ts';
import type { IngestLumenResult, PersonStats } from './personRpc.ts';
import { startTestHome } from './testHome.ts';
import type { WorkerFactory } from './workers.ts';

const root = new URL('../../../../', import.meta.url);
const done: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const d of done.reverse()) await d();
});

it('the broker path stores what the file path stores, and the file adds nothing afterwards', async () => {
  const secret = new Uint8Array(32).fill(3);
  const factory: WorkerFactory = async (init) => {
    const p = await openPersonProgram(init, secret);
    return { call: (r) => p.handle(r), close: () => p.close() };
  };
  const t = await startTestHome({ mqtt: true, factory });
  done.push(() => t.c.close());
  const a = await t.person('Ana');
  const cred = (await t.api('/v1/mqtt/credentials', { method: 'POST', token: a.token, body: {} })).body as unknown as { username: string; password: string };
  const c = await mqtt.connectAsync(`${t.c.url.replace('http', 'ws')}/mqtt`, { username: cred.username, password: cred.password, reconnectPeriod: 0 });
  done.push(() => c.endAsync(true));

  const stream = (await readFile(new URL('qa/fixtures/lumen/mqtt-stream.synthetic.jsonl', root), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { topic: string; payload: string });
  // the same messages twice: a resend after a lost PUBACK is stored once
  for (const m of [...stream, ...stream]) await c.publishAsync(m.topic, m.payload, { qos: 1 });
  await t.home.broker!.idle();
  const stats = async () => ((await t.home.pool.call(a.id, { op: 'stats' })) as { value: PersonStats }).value;
  const afterBroker = await stats();
  expect(afterBroker.documents).toBeGreaterThan(0);

  const file = (await readFile(new URL('qa/fixtures/lumen/cloudevents.synthetic.jsonl', root), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown);
  const r = await t.home.pool.call(a.id, { op: 'ingestLumen', events: file, installations: await t.home.ingest.installations(a.id) });
  expect(r.ok).toBe(true);
  expect((r as { value: IngestLumenResult }).value.added).toBe(0);
  expect((await stats()).documents).toBe(afterBroker.documents);
  const status = (await t.api('/v1/mqtt/status', { token: a.token })).body as unknown as { eventsToday: Array<{ stream: string; count: number }>; deadLetters: { today: number } };
  expect(status.eventsToday.length).toBeGreaterThan(0);
  console.log(JSON.stringify({ messages: stream.length, documents: afterBroker.documents, deadLettersToday: status.deadLetters.today }));
}, 120_000);
