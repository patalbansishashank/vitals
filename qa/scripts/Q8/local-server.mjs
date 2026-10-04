// Q8 J3: runs this branch's Vitals Server (home role) from packages/companion, with the OpenCode Zen upstream pointed
// at a stand-in (the deployed server has no base-URL override; finding Q8-03). Copied from qa/scripts/I3/smoke-server.mjs.
// Config in SMOKE_CFG (JSON). Control lines on stdin (JSON) answer on stdout as `CTRL <json>`: addPerson (joins the
// browser's sync group with its owner secret), code (a pairing code), dispatch, close. The parent reads the answers;
// nothing secret reaches a console or a file. Needs `pnpm --filter vitals-companion build:person` first.
import { createInterface } from 'node:readline';

const { installPolyfills } = await import('@evolu/common/polyfills');
installPolyfills();
const cfg = JSON.parse(process.env.SMOKE_CFG);
const { startCompanion } = await import('../../../packages/companion/src/server.ts');
const { threadWorkerFactory } = await import('../../../packages/companion/src/home/workers.ts');
const { UPSTREAMS } = await import('../../../packages/companion/src/proxy.ts');

const c = await startCompanion({
  host: '127.0.0.1',
  port: cfg.port,
  dataDir: `${cfg.dataDir}/relay`,
  allowedOrigins: [cfg.origin],
  serveApp: cfg.app,
  log: (l) => console.log(`log ${l}`),
  upstreams: { ...UPSTREAMS, 'opencode-zen': { ...UPSTREAMS['opencode-zen'], baseUrl: cfg.standin } },
  home: {
    dataDir: cfg.dataDir,
    allowedOrigins: [cfg.origin],
    publicOrigin: cfg.origin,
    mqtt: { enabled: true },
    rateLimit: { capacity: 1000, perMinute: 60_000 },
    workerFactory: threadWorkerFactory(new URL('../../../packages/companion/dist/person-worker.mjs', import.meta.url)),
  },
});
console.log(`READY ${c.url}`);

const reply = (o) => console.log(`CTRL ${JSON.stringify(o)}`);
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const m = JSON.parse(line);
    if (m.op === 'addPerson') {
      const secret = new Uint8Array(Buffer.from(m.secretHex, 'hex'));
      const p = await c.home.persons.add({ label: m.label, timeZone: m.tz, secret, relayUrl: `ws://127.0.0.1:${c.port}/sync` });
      reply({ op: 'addPerson', id: p.id });
    } else if (m.op === 'code') {
      reply({ op: 'code', ...(await c.home.devices.issueCode(m.person, m.label)) });
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
