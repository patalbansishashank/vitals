// Q9 journey 3 helper: the packed Vitals Server (home role, MQTT on) on a loopback port, run from the release directory
// (copied there by j3-restart.mjs so bare imports resolve against the release's node_modules). Config in Q9_CFG (JSON).
// Control lines on stdin (JSON) answer on stdout as `CTRL <json>`. Secrets (owner secret, broker password, device
// token) are generated here and handed to the parent over the pipe only; nothing secret is printed to a log.
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

const { installPolyfills } = await import('@evolu/common/polyfills');
installPolyfills();
const cfg = JSON.parse(process.env.Q9_CFG);
const { startCompanion } = await import('./src/server.ts');
const { threadWorkerFactory } = await import('./src/home/workers.ts');

const c = await startCompanion({
  host: '127.0.0.1',
  port: cfg.port,
  dataDir: `${cfg.dataDir}/relay`,
  allowedOrigins: [cfg.origin],
  log: (l) => console.log(`log ${l}`),
  home: {
    dataDir: cfg.dataDir,
    allowedOrigins: [cfg.origin],
    publicOrigin: cfg.origin,
    mqtt: { enabled: true },
    rateLimit: { capacity: 1000, perMinute: 60_000 },
    workerFactory: threadWorkerFactory(new URL('./dist/person-worker.mjs', import.meta.url)),
  },
});
console.log(`READY ${c.url}`);

const reply = (o) => console.log(`CTRL ${JSON.stringify(o)}`);
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const m = JSON.parse(line);
    if (m.op === 'addPerson') {
      const p = await c.home.persons.add({ label: m.label, timeZone: m.tz, secret: new Uint8Array(randomBytes(32)), relayUrl: `ws://127.0.0.1:${c.port}/sync` });
      const cred = await c.home.ingest.addCredential(p.id, `ws://127.0.0.1:${c.port}/mqtt`);
      const dev = await c.home.devices.mint(p.id, { kind: 'device', label: 'Q9 j3' });
      reply({ op: 'addPerson', id: p.id, username: cred.username, password: cred.password, token: dev.token });
    } else if (m.op === 'idle') {
      await c.home.broker?.idle();
      await c.home.pool.call(m.person, { op: 'flush' });
      reply({ op: 'idle' });
    } else if (m.op === 'dispatch') {
      reply({ op: 'dispatch', res: await c.home.pool.call(m.person, { op: 'dispatch', command: m.command, input: m.input, source: m.source ?? 'server' }) });
    } else if (m.op === 'close') {
      await c.close();
      reply({ op: 'close' });
      process.exit(0);
    }
  } catch (e) {
    reply({ error: e instanceof Error ? e.message : String(e) });
  }
}
