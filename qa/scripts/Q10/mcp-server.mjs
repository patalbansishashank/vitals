// Q10 control process: the packed Vitals Server (home role, no sync relay, no MQTT) with person control ops on stdin.
// Copied into the release dir by mcp-proofs.mjs so bare imports resolve; config in MCP_CFG (JSON). Replies `CTRL <json>`.
import { createInterface } from 'node:readline';
const { installPolyfills } = await import('@evolu/common/polyfills');
installPolyfills();
const cfg = JSON.parse(process.env.MCP_CFG);
const { startCompanion } = await import('./src/server.ts');
const { threadWorkerFactory } = await import('./src/home/workers.ts');
const c = await startCompanion({
  host: '127.0.0.1', port: cfg.port, dataDir: `${cfg.dataDir}/relay`, allowedOrigins: [cfg.origin], serveApp: cfg.app,
  log: (l) => console.log(`log ${l}`),
  home: { dataDir: cfg.dataDir, allowedOrigins: [cfg.origin], publicOrigin: cfg.origin, mqtt: { enabled: false },
    rateLimit: { capacity: 1000, perMinute: 60_000 },
    workerFactory: threadWorkerFactory(new URL('./dist/person-worker.mjs', import.meta.url)) },
});
console.log(`READY ${c.url}`);
const reply = (o) => console.log(`CTRL ${JSON.stringify(o)}`);
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const m = JSON.parse(line);
    if (m.op === 'addPerson') {
      const p = await c.home.persons.add({ label: m.label, timeZone: m.tz, secret: new Uint8Array(Buffer.from(m.secretHex, 'hex')), relayUrl: null });
      reply({ op: 'addPerson', id: p.id });
    } else if (m.op === 'code') reply({ op: 'code', ...(await c.home.devices.issueCode(m.person, m.label)) });
    else if (m.op === 'dispatch') reply({ op: 'dispatch', res: await c.home.pool.call(m.person, { op: 'dispatch', command: m.command, input: m.input, source: m.source ?? 'server' }) });
    else if (m.op === 'close') { await c.close(); reply({ op: 'close' }); process.exit(0); }
  } catch (e) { reply({ error: e instanceof Error ? e.message : String(e) }); }
}
