/** Test helpers for the `home` role: a temp data dir, a fake person-worker factory and HTTP calls with a bearer. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCompanion, type Companion } from '../server.ts';
import type { IngestLumenResult, PersonInit, PersonRequest, PersonResponse } from './personRpc.ts';
import type { WorkerFactory } from './workers.ts';

export const SITE = 'https://vitals.creative.desi';

/** Records every request per person; `ingestLumen` returns one record per event. */
export function fakeWorkers() {
  const calls = new Map<string, PersonRequest[]>();
  const opened: PersonInit[] = [];
  const factory: WorkerFactory = async (init) => {
    opened.push(init);
    const mine = calls.get(init.personId) ?? [];
    calls.set(init.personId, mine);
    return {
      async call(req: PersonRequest): Promise<PersonResponse> {
        mine.push(req);
        if (req.op === 'ingestLumen') {
          const ev = req.events[0] as { type?: string; time?: string; data?: { percent?: number } };
          if (ev?.type === 'health.device.battery.updated') return { ok: true, value: { records: 0, added: 0, installations: req.installations, status: [{ kind: 'battery', at: ev.time ?? '', value: ev.data?.percent }], streams: {} } satisfies IngestLumenResult };
          if (ev?.type === 'health.unknown.thing') return { ok: true, value: { records: 0, added: 0, installations: req.installations, status: [], streams: {}, rejected: [{ index: 0, reason: 'unknown_type', type: ev.type }] } satisfies IngestLumenResult };
          return { ok: true, value: { records: 1, added: 1, installations: req.installations, status: [], streams: { hr: 1 } } satisfies IngestLumenResult };
        }
        return { ok: true, value: { personId: init.personId } };
      },
      close: async () => undefined,
    };
  };
  return { factory, calls, opened, ingested: (id: string) => (calls.get(id) ?? []).filter((r) => r.op === 'ingestLumen') };
}

export async function startTestHome(o: { dataDir?: string; mqtt?: boolean; mqttTls?: { certFile: string; keyFile: string }; factory?: WorkerFactory; log?: (line: string) => void } = {}) {
  const dataDir = o.dataDir ?? (await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'home-')));
  const fake = fakeWorkers();
  const c: Companion = await startCompanion({
    port: 0,
    dataDir: join(dataDir, 'relay'),
    allowedOrigins: [],
    relay: false,
    ...(o.log ? { log: o.log } : {}),
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', mqtt: { enabled: o.mqtt ?? true, ...(o.mqttTls ? { tls: { listen: [{ host: '127.0.0.1', port: 0 }], ...o.mqttTls } } : {}) }, rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: o.factory ?? fake.factory },
  });
  const home = c.home!;
  const api = async (path: string, init: { method?: string; token?: string; origin?: string | null; body?: unknown; host?: string } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.origin !== null) headers.origin = init.origin ?? SITE;
    if (init.host) headers.host = init.host;
    const r = await fetch(`${c.url}${path}`, { method: init.method ?? 'GET', headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> & { [k: string]: never }, headers: r.headers };
  };
  /** Adds a person and pairs one device; returns its token. */
  const person = async (label: string) => {
    const p = await home.persons.add({ label, timeZone: 'Asia/Kolkata', secret: new Uint8Array(32).fill(label.length), relayUrl: null });
    const { code } = await home.devices.issueCode(p.id);
    const r = await api('/v1/pair/device', { method: 'POST', body: { code, label: `${label} phone` } });
    return { id: p.id, token: r.body.token as unknown as string, deviceId: r.body.deviceId as unknown as string };
  };
  return { c, home, api, person, fake, dataDir };
}
