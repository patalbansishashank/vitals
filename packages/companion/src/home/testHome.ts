/** Test helpers for the `home` role: a temp data dir, a fake person-worker factory and HTTP calls with a bearer. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCompanion, type Companion } from '../server.ts';
import type { PersonInit, PersonRequest, PersonResponse } from './personRpc.ts';
import type { WorkerFactory } from './workers.ts';

export const SITE = 'https://vitals.creative.desi';

/** Records every request per person. */
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
        return { ok: true, value: { personId: init.personId } };
      },
      close: async () => undefined,
    };
  };
  return { factory, calls, opened };
}

export async function startTestHome(o: { dataDir?: string; factory?: WorkerFactory; log?: (line: string) => void; releases?: { publicInstall?: boolean } } = {}) {
  const dataDir = o.dataDir ?? (await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'home-')));
  const fake = fakeWorkers();
  const c: Companion = await startCompanion({
    port: 0,
    dataDir: join(dataDir, 'relay'),
    allowedOrigins: [],
    relay: false,
    ...(o.log ? { log: o.log } : {}),
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: o.factory ?? fake.factory, ...(o.releases ? { releases: o.releases } : {}) },
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
