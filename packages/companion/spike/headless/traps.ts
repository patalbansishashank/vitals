/**
 * Vitest setup for the R17 spike: records every touch of a browser global (with the first app frame of the stack) so
 * the report lists exact pointers. The globals stay as Node has them (absent, or Node's own), the trap only watches.
 */
type Hit = { global: string; prop?: string; at: string };
const hits: Hit[] = ((globalThis as { __r17hits?: Hit[] }).__r17hits = []);
const seen = new Set<string>();

function where(): string {
  const lines = String(new Error().stack).split('\n').slice(2);
  const app = lines.find((l) => /\/(src|packages\/companion\/src)\//.test(l) && !l.includes('/spike/'));
  return (app ?? lines.find((l) => !l.includes('traps.ts')) ?? '?').trim().replace(/^at /, '').replace(/.*\/media\/DEV\/Hobby\/Lumen Health\//, '').replace(/\)$/, '');
}
function record(global: string, prop?: string) {
  const at = where();
  const k = `${global}.${prop ?? ''}@${at}`;
  if (seen.has(k)) return;
  seen.add(k);
  hits.push({ global, prop, at });
}

for (const name of ['window', 'document', 'localStorage', 'sessionStorage', 'indexedDB', 'Worker', 'SharedWorker', 'location', 'requestAnimationFrame', 'matchMedia', 'caches', 'FileSystemFileHandle']) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, name);
  const read = desc?.get ? () => desc.get!.call(globalThis) : () => desc?.value;
  try {
    Object.defineProperty(globalThis, name, { configurable: true, get() { record(name); return name === 'localStorage' || name === 'sessionStorage' ? undefined : read(); }, set(v) { Object.defineProperty(globalThis, name, { value: v, writable: true, configurable: true }); } });
  } catch { /* not configurable */ }
}
// Node has its own navigator: watch which properties the app reads.
const nav = globalThis.navigator;
if (nav) Object.defineProperty(globalThis, 'navigator', { configurable: true, value: new Proxy(nav, { get(t, p) { if (typeof p === 'string') record('navigator', p); const v = Reflect.get(t, p, t); return typeof v === 'function' ? v.bind(t) : v; } }) });
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: unknown, init?: unknown) => { record('fetch', String((input as { url?: string })?.url ?? input).slice(0, 80)); return realFetch(input as never, init as never); }) as typeof fetch;
