// Shared helpers for the L-REV2 migration harness: network guard, redaction of source keys, snapshots of the
// biometrics documents (counts and opaque ids only: never a value, a date list or a raw key).
import '../sync/lib/tsResolve.mjs';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The command bus pulls in a few `.tsx` files (toasts); the server bundles them with Vite, this harness transpiles
// them with the repo's typescript (react-jsx) and lets `.css` imports through as empty modules. Registered after
// tsResolve's hooks, so it runs first.
let tsMod = null;
registerHooks({
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };
    if (url.startsWith('file:') && url.endsWith('.json')) {
      // Vite gives JSON modules named exports too; Node needs them spelled out
      const data = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
      const named = data && typeof data === 'object' && !Array.isArray(data)
        ? Object.keys(data).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k)).map((k) => `export const ${k} = __json[${JSON.stringify(k)}];`).join('\n')
        : '';
      return { format: 'module', source: `const __json = ${JSON.stringify(data)};\nexport default __json;\n${named}`, shortCircuit: true };
    }
    if (!url.startsWith('file:') || !url.endsWith('.tsx')) return next(url, context);
    tsMod ??= createRequire(import.meta.url)('typescript');
    const code = readFileSync(fileURLToPath(url), 'utf8');
    const out = tsMod.transpileModule(code, {
      fileName: fileURLToPath(url),
      compilerOptions: { module: tsMod.ModuleKind.ESNext, target: tsMod.ScriptTarget.ES2022, jsx: tsMod.JsxEmit.ReactJSX, verbatimModuleSyntax: false, useDefineForClassFields: true, sourceMap: false },
    });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  },
});

/** Replace fetch and WebSocket: nothing leaves this process except to a loopback relay the caller allows. */
export function guardNetwork(allowBase) {
  const attempts = [];
  const allowed = (u) => {
    if (!allowBase) return false;
    try {
      const url = new URL(typeof u === 'string' ? u : u?.url ?? String(u));
      return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === new URL(allowBase).port;
    } catch {
      return false;
    }
  };
  const realFetch = globalThis.fetch;
  const RealWS = globalThis.WebSocket;
  globalThis.fetch = (input, init) => {
    if (allowed(input)) return realFetch(input, init);
    attempts.push(`fetch:${hostOf(input)}`);
    throw new Error('network blocked by harness');
  };
  globalThis.WebSocket = class extends (RealWS ?? class {}) {
    constructor(url, protocols) {
      if (!allowed(url)) {
        attempts.push(`ws:${hostOf(url)}`);
        throw new Error('network blocked by harness');
      }
      super(url, protocols);
    }
  };
  return attempts;
}

const hostOf = (u) => {
  try {
    return new URL(typeof u === 'string' ? u : u?.url ?? String(u)).host.length > 0 ? 'remote' : 'unknown';
  } catch {
    return 'unknown';
  }
};

/** Source-key redaction: stable names, never the key itself. */
export function makeRedactor({ LUMEN_SOURCE_KEY, channelOfSourceKey, parseRingKey }) {
  const LUMEN = new Set(['file:lumen_cloudevents', 'mqtt:lumen', 'file:lumen_archive']);
  const others = new Map();
  return (key) => {
    if (key === LUMEN_SOURCE_KEY) return 'lumen';
    const ch = channelOfSourceKey(key);
    if (LUMEN.has(ch)) return 'lumen-old';
    if (key.startsWith('ble:')) return `ring:${parseRingKey(key)?.family ?? 'unknown'}`;
    if (ch === 'manual') return 'manual';
    if (ch === 'correction') return 'correction';
    if (!others.has(key)) others.set(key, `other-${others.size + 1}`);
    return others.get(key);
  };
}

const inc = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const sortObj = (m) => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * One snapshot of the biometrics documents. `names` maps raw keys to printable names. Returns plain JSON: per source
 * records by stream, docId sets, nights per date, chunks, and sample keys per (stream, day) (needed for the union).
 */
export async function snapshot({ ix, store, names, policyStreamOf, isRingSource, ringSharing, ringPoliciesAtDefault, RING_IDS }) {
  const recordsByStream = new Map(); // name -> Map(stream -> n)
  const docIds = new Map(); // name -> [docId]
  const nights = new Map(); // date -> Map(name -> n) (latest version only)
  const nightStarts = new Map(); // date -> Set(start instant) (kept as a count only)
  const latestIds = new Set(ix.latest.values());
  for (const e of ix.recDocs.values()) {
    const name = names(e.sourceKey);
    if (!recordsByStream.has(name)) recordsByStream.set(name, new Map());
    inc(recordsByStream.get(name), policyStreamOf(e.record));
    if (!docIds.has(name)) docIds.set(name, []);
    docIds.get(name).push(e.docId);
    if (e.record.kind === 'sleep' && latestIds.has(e.docId)) {
      const d = e.record.time.local_date;
      if (!nights.has(d)) nights.set(d, new Map());
      inc(nights.get(d), name);
      if (!nightStarts.has(d)) nightStarts.set(d, new Set());
      nightStarts.get(d).add(String(e.record.time.start ?? ''));
    }
  }
  const chunks = new Map(); // name -> Map(stream -> {live, superseded})
  const days = new Map(); // `${sourceKey}\0${stream}\0${date}` -> {sourceKey, stream, date}
  for (const c of ix.chunks.values()) {
    const name = names(c.sourceKey);
    if (!chunks.has(name)) chunks.set(name, new Map());
    const m = chunks.get(name);
    const cur = m.get(c.stream) ?? { live: 0, superseded: 0 };
    cur[c.superseded ? 'superseded' : 'live']++;
    m.set(c.stream, cur);
    days.set(`${c.sourceKey}\0${c.stream}\0${c.local_date}`, { sourceKey: c.sourceKey, stream: c.stream, date: c.local_date });
  }
  // samples per (source, stream, day) and their keys for the cross-source union
  const samples = {}; // name -> stream -> date -> n
  const sampleKeys = {}; // stream -> date -> [name:origin:t ...] kept as Set via arrays
  let partial = 0;
  for (const { sourceKey, stream, date } of days.values()) {
    const got = await store.samples({ sourceKey, stream, from: date, to: date });
    const name = names(sourceKey);
    ((samples[name] ??= {})[stream] ??= {})[date] = got.length;
    const keys = ((sampleKeys[stream] ??= {})[date] ??= []);
    for (const s of got) keys.push(`${name}\u0001${s.origin}\u0001${s.t}`);
  }
  const sources = ix.sources().map((s) => ({
    name: names(s.sourceKey),
    isRing: isRingSource(s),
    atDefault: ringPoliciesAtDefault(s.policies),
    policies: [...s.policies].sort((a, b) => a.stream.localeCompare(b.stream)).map((p) => `${p.stream}:${p.imported ? 'imp' : 'noimp'}/${p.coach}/${p.engine ? 'eng' : 'noeng'}/${p.scores ? 'sc' : 'nosc'}`),
    hasBle: !!s.ble,
    baselineEpochs: s.baselineEpochs?.length ?? 0,
  }));
  const markers = {};
  for (const id of RING_IDS) {
    const b = ix.sourceDocs.get(id);
    markers[id] = b ? { present: true, ranAt: !!b.ranAt, moved: Array.isArray(b.moved) ? b.moved.length : b.moved, kept: Array.isArray(b.kept) ? b.kept.length : undefined, notice: b.notice, choice: b.choice, lumen: b.lumen ? names(b.lumen) : undefined } : { present: false };
  }
  return {
    recordsByStream: Object.fromEntries([...recordsByStream].map(([k, v]) => [k, sortObj(v)])),
    docIds: Object.fromEntries([...docIds].map(([k, v]) => [k, v.sort()])),
    nights: Object.fromEntries([...nights].map(([d, m]) => [d, sortObj(m)])),
    nightStarts: Object.fromEntries([...nightStarts].map(([d, set]) => [d, set.size])),
    chunks: Object.fromEntries([...chunks].map(([k, v]) => [k, sortObj(v)])),
    samples,
    sampleKeys,
    sources: sources.sort((a, b) => a.name.localeCompare(b.name)),
    ringSharing: ringSharing(ix.sources()),
    markers,
    scores: ix.scoreDocs.size,
    corrections: ix.correctionDocs.size,
    partial,
  };
}

/** Union of sample keys over the two Lumen sources by (origin, t), per (stream, day). */
export function unionSamples(sampleKeys, sourceNames) {
  const out = {}; // stream -> date -> n
  for (const [stream, byDate] of Object.entries(sampleKeys)) {
    for (const [date, keys] of Object.entries(byDate)) {
      const set = new Set();
      for (const k of keys) {
        const [name, origin, t] = k.split('\u0001');
        if (sourceNames.includes(name)) set.add(`${origin}\u0001${t}`);
      }
      (out[stream] ??= {})[date] = set.size;
    }
  }
  return out;
}

export const sum = (o) => Object.values(o).reduce((a, b) => a + (typeof b === 'number' ? b : sum(b)), 0);

/** Markdown table: rows = streams, columns = names. */
export function table(title, byName, streams, cols) {
  const lines = [`**${title}**`, '', `| stream | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`];
  for (const s of streams) lines.push(`| ${s} | ${cols.map((c) => byName[c]?.[s] ?? 0).join(' | ')} |`);
  lines.push(`| total | ${cols.map((c) => sum(byName[c] ?? {})).join(' | ')} |`);
  return lines.join('\n');
}
