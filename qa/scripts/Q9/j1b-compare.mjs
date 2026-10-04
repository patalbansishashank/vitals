// Q9 journey 1, second half: a second sync group (profile "b", setup.mjs b nojoin) imports the same events from a file
// (Settings › Devices › Choose a file…); its stored records are compared with what the broker path stored for q9-a
// (profile "a", exported after j1-live.mjs). Equal = same record ids, same newest version per id, same values once the
// channel-specific provenance (channel, decoder, ingested_at) and document bookkeeping are set aside.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORIGIN, ROOT, TMP, checker, exportDocs, log, profile, sleep, startPreview, waitQa } from './lib.mjs';

const c = checker();
c.journey('J1 identical to a file import');
const preview = await startPreview();

const DOC_META = new Set(['_id', '_rev', '_updatedAt', '_createdAt', '_deleted', 'createdAt', 'updatedAt', 'isDeleted', 'id']);
const norm = (v) => {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      if (DOC_META.has(k) || k.startsWith('_')) continue;
      if (k === 'provenance') {
        const { channel: _c, ingested_at: _i, decoder: _d, ...rest } = v[k];
        o[k] = norm(rest);
      } else if (k === 'ingested_at') continue;
      else o[k] = norm(v[k]);
    }
    return o;
  }
  return v;
};
const newest = (recs) => {
  const m = new Map();
  for (const r of recs) if (!m.has(r.record_id) || m.get(r.record_id).version < r.version) m.set(r.record_id, r);
  return m;
};
// live chunks (not superseded) per source, stream and day; their content hash covers the samples
const chunkMap = (chunks) => new Map(chunks.filter((ch) => !ch.superseded).map((ch) => [`${ch.sourceKey}|${ch.stream}|${ch.local_date}`, { n: ch.n, min: ch.min, max: ch.max, contentHash: ch.contentHash }]));

async function exportOf(name, file) {
  const P = await profile(name);
  try {
    await P.page.goto(`${ORIGIN}/settings?section=devices&qa=1`, { waitUntil: 'load' });
    await waitQa(P.page);
    if (file) {
      await P.page.locator('input[type=file][aria-label="Choose a file…"]').setInputFiles(file);
      const toast = await P.page.getByText(/\d+ records?, \d+ readings?\./).first().waitFor({ timeout: 60000 }).then(() => P.page.getByText(/\d+ records?, \d+ readings?\./).first().innerText(), () => '');
      log(`file import toast: ${toast}`);
      c.check('file import in the second group finished (Settings › Devices › Choose a file…)', /records/.test(toast), toast);
      await sleep(2000);
    }
    for (let i = 0; i < 20; i++) {
      const d = await exportDocs(P.page);
      if (d.collections?.bioRecords?.length) return d;
      await sleep(1500);
    }
    throw new Error(`no bioRecords in the export of profile ${name}`);
  } finally {
    await P.ctx.close();
  }
}

try {
  const a = await exportOf('a');
  const b = await exportOf('b', join(TMP, 'j1-same-events.jsonl'));
  writeFileSync(join(TMP, 'j1-export-b.json'), JSON.stringify(b));
  const ra = newest(a.collections.bioRecords);
  const rb = newest(b.collections.bioRecords);
  const idsA = [...ra.keys()].sort();
  const idsB = [...rb.keys()].sort();
  c.check('equal record ids (broker path vs file import)', JSON.stringify(idsA) === JSON.stringify(idsB), `broker ${idsA.length}, file ${idsB.length}; only broker: ${idsA.filter((x) => !rb.has(x)).length}, only file: ${idsB.filter((x) => !ra.has(x)).length}`);
  const verDiff = idsA.filter((id) => rb.has(id) && ra.get(id).version !== rb.get(id).version);
  c.check('equal newest version per record id', verDiff.length === 0, verDiff.map((id) => `${ra.get(id).kind} ${id.slice(0, 8)} ${ra.get(id).version} vs ${rb.get(id).version}`).join('; '));
  const valDiff = idsA.filter((id) => rb.has(id) && JSON.stringify(norm(ra.get(id))) !== JSON.stringify(norm(rb.get(id))));
  const firstDiff = valDiff[0] ? (() => {
    const x = norm(ra.get(valDiff[0]));
    const y = norm(rb.get(valDiff[0]));
    return Object.keys({ ...x, ...y }).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).map((k) => `${k}: ${JSON.stringify(x[k]).slice(0, 120)} vs ${JSON.stringify(y[k]).slice(0, 120)}`).join(' / ');
  })() : '';
  c.check('equal values per record (channel provenance set aside)', valDiff.length === 0, `${valDiff.length} differ; ${firstDiff}`);
  const ca = chunkMap(a.collections.bioChunks ?? []);
  const cb = chunkMap(b.collections.bioChunks ?? []);
  const sample = (ch) => JSON.stringify(ch);
  const chunkKeysEqual = JSON.stringify([...ca.keys()].sort()) === JSON.stringify([...cb.keys()].sort());
  const chunkDiff = [...ca.keys()].filter((k) => cb.has(k) && sample(ca.get(k)) !== sample(cb.get(k)));
  const allA = (a.collections.bioChunks ?? []).length;
  log(`chunk documents: broker path ${allA} (${allA - ca.size} superseded), file ${(b.collections.bioChunks ?? []).length}`);
  c.check('equal sample chunks (series samples)', chunkKeysEqual && chunkDiff.length === 0, `broker ${ca.size} chunks, file ${cb.size}; differing ${chunkDiff.length}${chunkDiff[0] ? `: ${sample(ca.get(chunkDiff[0])).slice(0, 200)} vs ${sample(cb.get(chunkDiff[0])).slice(0, 200)}` : ''}`);
  const channels = [...new Set(a.collections.bioRecords.map((r) => r.provenance?.channel))].join(',') + ' vs ' + [...new Set(b.collections.bioRecords.map((r) => r.provenance?.channel))].join(',');
  log(`channels: ${channels}`);
  writeFileSync(join(ROOT, 'qa/results/Q9-j1-compare.json'), JSON.stringify({ at: new Date().toISOString(), recordsBroker: idsA.length, recordsFile: idsB.length, chunksBroker: ca.size, chunkDocsBroker: (a.collections.bioChunks ?? []).length, chunkDocsFile: (b.collections.bioChunks ?? []).length, chunksFile: cb.size, channels, checks: c.checks }, null, 2));
} catch (e) {
  c.check('no exception', false, e.stack?.split('\n').slice(0, 3).join(' / '));
} finally {
  preview?.kill();
  log(JSON.stringify(c.summary()));
}
