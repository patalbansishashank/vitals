// One Node replica in its own process (forked by replica.mjs): an Evolu store from the app's own adapter
// (src/sync/evolu/adapter.ts, per-field merge in fieldMerge.ts) on the server's Node platform
// (packages/companion/src/evoluNode.ts), SQLite files in its own data dir. The parent drives it over IPC; the owner
// secret arrives over IPC only (never argv, environment or a file). `kill()` in the parent is SIGKILL on this process.
//
// Ring data (S5) goes through the app's own code, wired as the server's person program wires it
// (packages/companion/src/home/personProgram.ts): the document store over this Evolu store, `DocBioStore` +
// `BioDocIndex` (src/biometrics/store), the file chunk store (packages/companion/src/home/blobFiles.ts) sealed and
// uploaded to the relay's /blobs through this replica's proxy, the BLE event mapping (src/biometrics/core/events.ts
// mapEventsToBatch, what `bio.deviceSync` calls) and `ingestBatches` (src/biometrics/ingest/pipeline.ts). The only
// harness-made piece is the writer: one derive transaction per flush, as `deriveWriter` (src/commands/bio/store.ts)
// does, copied here because that module pulls in the browser runtime.
import './tsResolve.mjs';

process.removeAllListeners('warning'); // stripTypeScriptTypes is "experimental"; the parent keeps stderr for errors only
const { installPolyfills } = await import('@evolu/common/polyfills');
installPolyfills();
const { createEvoluSyncStore } = await import('../../../../src/sync/evolu/adapter.ts');
const { createNodeEvoluPlatform } = await import('../../../../packages/companion/src/evoluNode.ts');

let store = null;
let opened = null;
let bio = null;
/** First time this process saw each document arrive from elsewhere (epoch ms), and the last status changes. */
const arrived = new Map();
const statusLog = [];

const ops = {
  async open({ secret, relayUrl, dataDir, appName, deviceId, instance }) {
    store = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir, instance }), appName });
    store.subscribe((c) => {
      if (c.origin !== 'remote') return;
      const k = `${c.col}/${c.id}`;
      if (!arrived.has(k)) arrived.set(k, Date.now());
    });
    store.onStatus((s) => {
      statusLog.push({ at: Date.now(), state: s.state });
      if (statusLog.length > 200) statusLog.shift();
    });
    await store.open({ secret: Buffer.from(secret, 'base64url'), relayUrl, deviceId });
    opened = { dataDir, relayUrl, deviceId };
    bio = null;
    return { ok: true };
  },
  async put({ col, id, value, schema = 1 }) {
    const d = await store.put(col, id, value, { schema });
    return { rev: d._rev, at: Date.now() };
  },
  /** Changes only the named top-level fields of a document (what a settings or profile edit does). */
  async patch({ col, id, fields, schema = 1 }) {
    const prev = await store.get(col, id);
    const value = { ...(prev && !prev._deleted ? prev.value : {}), ...fields };
    const d = await store.put(col, id, value, { schema });
    return { rev: d._rev, at: Date.now() };
  },
  async get({ col, id }) {
    return store.get(col, id);
  },
  async list({ col }) {
    return store.list(col);
  },
  async arrivedAt({ col, id }) {
    return arrived.get(`${col}/${id}`) ?? null;
  },
  async status() {
    return { ...store.status(), recent: statusLog.slice(-10) };
  },
  async setRelay({ url }) {
    await store.setRelay(url);
    return true;
  },
  async pull() {
    return store.pull();
  },
  async close() {
    bio?.blobs.close();
    await store?.close();
    store = null;
    bio = null;
    return true;
  },
  /** Ring data: `read` maps decoded ring events to a batch and ingests it (offline-safe); `flush` uploads the chunk bytes. */
  async ring(cmd) {
    const b = await bioStore();
    if (cmd.op === 'read') {
      const batch = b.mod.mapEventsToBatch(cmd.events, cmd.ctx);
      const rep = await b.mod.ingestBatches([batch], b.store, { now: cmd.ctx.ingestedAt });
      await b.store.flush();
      const sleep = batch.records.find((r) => r.kind === 'sleep');
      return { records: rep.records, samples: rep.samples, chunks: rep.chunks, duplicates: rep.duplicates, sources: rep.sources, sleep: sleep ? { record_id: sleep.record_id, version: sleep.version, asleep_s: sleep.asleep_s } : null, pendingUploads: b.blobs.store.pending() };
    }
    if (cmd.op === 'flush') return { uploaded: await b.blobs.store.flush(), pending: b.blobs.store.pending(), lastError: b.blobs.store.lastError?.code ?? null };
    if (cmd.op === 'share') {
      // what the person does in Settings › Devices: share these streams with the Coach (agents read them through MCP)
      const src = await b.store.getSource(cmd.sourceKey);
      if (!src) throw new Error(`no source ${cmd.sourceKey}`);
      const policies = src.policies.map((p) => (cmd.streams[p.stream] ? { ...p, imported: true, coach: cmd.streams[p.stream] } : p));
      await b.store.putSource({ ...src, policies });
      await b.store.flush();
      return policies.filter((p) => cmd.streams[p.stream]);
    }
    throw new Error(`unknown ring op ${cmd.op}`);
  },
  /** What this replica holds for one source, stream and day (the S5 assertions read only this). */
  async bioView({ sourceKey, stream, date, recordId }) {
    const b = await bioStore();
    const records = (await b.store.records({ kind: 'sleep', from: date, to: date })).filter((r) => r.sourceKey === sourceKey).map((r) => ({ record_id: r.record.record_id, version: r.record.version, asleep_s: r.record.asleep_s, is_main: r.record.is_main }));
    const recordDocs = recordId ? (await store.list('bioRecords')).filter((d) => !d._deleted && d.value?.record_id === recordId).map((d) => d._id) : [];
    const q = { stream, from: date, to: date };
    let samples = [];
    let partial = null;
    let readError = null;
    try {
      const r = await b.store.readSamples({ ...q, strict: false });
      samples = r.samples.filter((x) => x.sourceKey === sourceKey).map((x) => ({ t: x.t, value: x.value, origin: x.origin }));
      partial = r.partial;
    } catch (e) {
      readError = e instanceof Error ? e.message : String(e);
    }
    let strictError = null;
    try {
      await b.store.readSamples({ ...q, strict: true });
    } catch (e) {
      strictError = e instanceof Error ? e.message : String(e);
    }
    const day = (m) => m.local_date === date;
    const live = (await b.store.manifests({ sourceKey, stream })).filter(day).map((m) => ({ chunkId: m.chunkId, n: m.n, supersedes: m.supersedes ?? null }));
    const all = (await b.store.manifests({ sourceKey, stream, includeSuperseded: true })).filter(day).length;
    return { records, recordDocs, samples, partial, readError, strictError, live, all };
  },
};

/** The biometrics store over this replica's Evolu store (opened on first use, again after a restart). */
async function bioStore() {
  if (bio) return bio;
  const [{ createDocumentStore, mintWriteToken, revokeWriteToken }, { DocBioStore }, { BioDocIndex }, { openFileChunkStore }, { createRemoteBlobBackend }, { relayHttpBase }, { mapEventsToBatch }, { ingestBatches }] = await Promise.all([
    import('../../../../src/store/index.ts'),
    import('../../../../src/biometrics/store/docStore.ts'),
    import('../../../../src/biometrics/store/docIndex.ts'),
    import('../../../../packages/companion/src/home/blobFiles.ts'),
    import('../../../../src/sync/blobs/remote.ts'),
    import('../../../../src/sync/pairing.ts'),
    import('../../../../src/biometrics/core/events.ts'),
    import('../../../../src/biometrics/ingest/pipeline.ts'),
  ]);
  const docs = createDocumentStore({ backend: store, device: opened.deviceId });
  await docs.ready;
  const blobs = openFileChunkStore(`${opened.dataDir}/blobs`);
  const nodeNet = { fetch: (input, init) => globalThis.fetch(input, init), assertAllowed: () => {} };
  if (store.keys) await blobs.store.attachRemote({ seal: store.keys.blob, backend: createRemoteBlobBackend({ baseUrl: relayHttpBase(opened.relayUrl), keys: store.keys, net: nodeNet }) });
  const apply = async (tx, op) => {
    if (op.kind === 'put') return tx.put(op.col, { ...op.body, _id: op.id });
    if (op.kind === 'append') return tx.append(op.col, { ...op.body, _id: op.id });
    if (op.kind === 'patch') return tx.patch(op.col, op.id, op.patch);
    return tx.remove(op.col, op.id);
  };
  const writer = {
    durable: true,
    async write(ops) {
      if (ops.length === 0) return;
      const token = mintWriteToken('derive', { label: 'ring sync' });
      try {
        await docs.transact(token, async (tx) => {
          for (const op of ops) await apply(tx, op);
        });
      } finally {
        revokeWriteToken(token);
      }
    },
  };
  const index = new BioDocIndex(docs);
  bio = { docs, blobs, store: new DocBioStore({ index, blobs: blobs.store, writer }), mod: { mapEventsToBatch, ingestBatches } };
  return bio;
}

process.on('message', async (m) => {
  try {
    const value = await ops[m.op](m.args ?? {});
    process.send({ id: m.id, ok: true, value });
  } catch (e) {
    process.send({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
process.send({ ready: true });
