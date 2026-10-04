// L-REV2: prove the v0.5.0 one-time migrations (`biometrics.ringDefaults`, `biometrics.ringFold`) on a COPY of a
// person directory, as the SYSTEM actor, through the server's own person program (packages/companion/src/home/
// personProgram.ts) with relayUrl null (or a loopback relay given by L_REV2_RELAY, two-device check).
//
//   L_REV2_COPY=<dir> [L_REV2_DEVICE_ID=<16 chars>] [L_REV2_RELAY=http://127.0.0.1:<port>] [L_REV2_OUT=<json>]
//     [L_REV2_MODE=migrate|sync] node qa/scripts/L-REV2/migrateCopy.mjs
//
// Prints redacted counts only (no values, no dates of individual records, no raw source keys). The owner secret is read
// from <dir>/owner.key inside this process and handed to the program; it is never printed. All network is blocked
// except the loopback relay when one is given.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { guardNetwork, makeRedactor, snapshot, sum, table, unionSamples } from './lib.mjs';

process.removeAllListeners('warning');
const dir = process.env.L_REV2_COPY;
if (!dir) throw new Error('L_REV2_COPY is required');
const relayUrl = process.env.L_REV2_RELAY ?? null;
const mode = process.env.L_REV2_MODE ?? (relayUrl ? 'sync' : 'migrate');
const attempts = guardNetwork(relayUrl);

const { installPolyfills } = await import('@evolu/common/polyfills');
installPolyfills();
const { openPersonProgram } = await import('../../../packages/companion/src/home/personProgram.ts');

const person = JSON.parse(readFileSync(join(dir, 'person.json'), 'utf8'));
const deviceId = process.env.L_REV2_DEVICE_ID ?? person.deviceId;
const secret = new Uint8Array(readFileSync(join(dir, 'owner.key')));
if (secret.length !== 32) throw new Error('owner.key must be 32 bytes');
const init = { personId: basename(dir), dir, timeZone: person.timeZone, deviceId, relayUrl, instance: `L-REV2-${basename(dir)}` };

const out = [];
const log = (s = '') => {
  out.push(s);
  console.log(s);
};
const ms = (t) => `${Math.round(t)} ms`;

let program = null;
const t0 = performance.now();
try {
  program = await openPersonProgram(init, secret);
  log(`program opened in ${ms(performance.now() - t0)} (copy=${basename(dir)}, device=${deviceId === person.deviceId ? 'person.json device' : 'other device'}, relay=${relayUrl ? 'loopback' : 'none'})`);

  const commands = await import('../../../src/commands/index.ts');
  const { SYSTEM_ACTOR } = await import('../../../src/commands/types.ts');
  const { bioIndex, openBioStore, readOnlyWriter } = await import('../../../src/commands/bio/store.ts');
  const { flushRescore } = await import('../../../src/commands/bio/runtime.ts');
  const policy = await import('../../../src/biometrics/core/policy.ts');
  const source = await import('../../../src/biometrics/core/source.ts');
  const { parseRingKey } = await import('../../../src/biometrics/service/identity.ts');
  const { getDocumentStore } = await import('../../../src/state/runtime.ts');
  const { COLLECTIONS } = await import('../../../src/store/index.ts');

  const names = makeRedactor({ LUMEN_SOURCE_KEY: source.LUMEN_SOURCE_KEY, channelOfSourceKey: policy.channelOfSourceKey, parseRingKey });
  const RING_IDS = [policy.RING_DEFAULTS_ID, policy.RING_FOLD_ID, policy.RING_SHARING_ID];
  const docCount = () => {
    const s = getDocumentStore();
    const per = {};
    for (const col of Object.keys(COLLECTIONS)) per[col] = s.peekAll(col).length;
    return per;
  };
  const settle = async () => {
    await commands.settleCommits();
    await flushRescore();
    await commands.settleCommits();
  };
  const snap = async (label) => {
    const ix = await bioIndex();
    const store = await openBioStore({ writer: readOnlyWriter });
    const t = performance.now();
    const s = await snapshot({ ix, store, names, policyStreamOf: source.policyStreamOf, isRingSource: policy.isRingSource, ringSharing: policy.ringSharing, ringPoliciesAtDefault: policy.ringPoliciesAtDefault, RING_IDS });
    s.docs = docCount();
    s.label = label;
    log(`snapshot "${label}" taken in ${ms(performance.now() - t)}`);
    return s;
  };
  const migrate = async (pass) => {
    const r = {};
    for (const cmd of ['biometrics.ringDefaults', 'biometrics.ringFold']) {
      const t = performance.now();
      const res = await commands.dispatch(cmd, {}, { actor: SYSTEM_ACTOR });
      await settle();
      const took = performance.now() - t;
      if (!res.ok) {
        log(`${pass} ${cmd}: FAILED ${res.error?.code ?? ''} ${res.error?.message ?? ''} (${ms(took)})`);
        r[cmd] = { ok: false, took };
        continue;
      }
      const v = res.output ?? {};
      const summary = cmd === 'biometrics.ringDefaults'
        ? `ran=${v.ran} moved=${(v.moved ?? []).map(names).join(',') || '-'} kept=${(v.kept ?? []).map(names).join(',') || '-'}`
        : `ran=${v.ran} moved=${(v.moved ?? []).map((m) => `${names(m.from)}->${names(m.to)}`).join(',') || '-'} lumen=${v.lumen ? names(v.lumen) : null} ambiguous=${v.ambiguous}`;
      log(`${pass} ${cmd}: ${summary} (${ms(took)}, settled)`);
      r[cmd] = { ok: true, ran: v.ran, took };
    }
    return r;
  };

  const printSnap = (s) => {
    const cols = [...new Set([...Object.keys(s.recordsByStream), ...Object.keys(s.chunks), ...Object.keys(s.samples)])].sort();
    const streamsOf = (o) => [...new Set(cols.flatMap((c) => Object.keys(o[c] ?? {})))].sort();
    log(`### ${s.label}`);
    log();
    log(`documents per collection: ${Object.entries(s.docs).filter(([, n]) => n > 0).map(([c, n]) => `${c}=${n}`).join(', ')}`);
    log(`sources: ${s.sources.map((x) => `${x.name}(ring=${x.isRing}, atDefault=${x.atDefault}, ble=${x.hasBle})`).join('; ') || 'none'}; ringSharing=${s.ringSharing}`);
    for (const x of s.sources) log(`  ${x.name} policies: ${x.policies.join(' ')}`);
    log(`markers: ${Object.entries(s.markers).map(([id, m]) => `${id}=${m.present ? JSON.stringify(m) : 'absent'}`).join('; ')}`);
    log(`scores=${s.scores} corrections=${s.corrections}`);
    log();
    log(table('records (every stored version) by stream', s.recordsByStream, streamsOf(s.recordsByStream), cols));
    log();
    const liveChunks = Object.fromEntries(cols.map((c) => [c, Object.fromEntries(Object.entries(s.chunks[c] ?? {}).map(([k, v]) => [k, v.live]))]));
    const supChunks = Object.fromEntries(cols.map((c) => [c, Object.fromEntries(Object.entries(s.chunks[c] ?? {}).map(([k, v]) => [k, v.superseded]))]));
    log(table('live chunks by stream', liveChunks, streamsOf(liveChunks), cols));
    log();
    log(table('superseded chunks by stream', supChunks, streamsOf(supChunks), cols));
    log();
    const sampleTotals = Object.fromEntries(cols.map((c) => [c, Object.fromEntries(Object.entries(s.samples[c] ?? {}).map(([k, v]) => [k, sum(v)]))]));
    log(table('samples by stream', sampleTotals, streamsOf(sampleTotals), cols));
    log();
    const nightDates = Object.keys(s.nights);
    const multi = Object.entries(s.nights).filter(([, m]) => sum(m) >= 2);
    const crossSource = multi.filter(([, m]) => Object.keys(m).length >= 2).length;
    log(`nights: ${nightDates.length} distinct dates with a sleep record; ${multi.length} dates with 2+ nights (${crossSource} of them across two sources, ${multi.length - crossSource} within one source)`);
    const perSource = {};
    for (const m of Object.values(s.nights)) for (const [n, k] of Object.entries(m)) perSource[n] = (perSource[n] ?? 0) + k;
    log(`nights per source: ${Object.entries(perSource).map(([n, k]) => `${n}=${k}`).join(', ')}`);
    const sameStart = multi.filter(([d, m]) => (s.nightStarts?.[d] ?? 0) < sum(m)).length;
    log(`nights on 2+ dates with the same start instant (same session stored twice): ${sameStart} dates`);
    log();
  };

  const before = await snap('before');
  printSnap(before);

  let results = {};
  let after = before;
  let again = before;
  if (mode === 'count') {
    log('count only: no migration dispatched');
  } else if (mode === 'migrate') {
    log('## pass 1 (first start of v0.5.0)');
    results.pass1 = await migrate('pass1');
    after = await snap('after pass 1');
    printSnap(after);
    log('## pass 2 (idempotency)');
    results.pass2 = await migrate('pass2');
    again = await snap('after pass 2');
    printSnap(again);
  } else {
    // sync mode: wait for the loopback relay to bring both devices together, then prove the migrations do nothing more
    const start = Date.now();
    let last = JSON.stringify(docCount());
    let stableSince = Date.now();
    let status = null;
    while (Date.now() - start < 60000) {
      await new Promise((r) => setTimeout(r, 2000));
      const now = JSON.stringify(docCount());
      if (now !== last) {
        last = now;
        stableSince = Date.now();
      }
      const st = await commands.dispatch('sync.status', {}, { actor: { kind: 'user', id: 'local-user' } }).catch(() => null);
      status = st?.ok ? st.value : status;
      const pending = status?.pending ?? status?.unsent ?? 0;
      if (Date.now() - stableSince >= 10000 && (status?.state === 'synced' || status?.state === 'idle') && !pending) break;
    }
    log(`sync wait: ${ms(Date.now() - start)}; status state=${status?.state ?? 'unknown'} pending=${status?.pending ?? status?.unsent ?? 'n/a'}`);
    await settle();
    after = await snap('after sync');
    printSnap(after);
    log('## migrations once more on the merged state');
    results.pass1 = await migrate('merged');
    again = await snap('after migrations on merged state');
    printSnap(again);
  }

  // ---------------------------------------------------------------- checks (printed as numbers only)
  log('## checks');
  const lumenNames = ['lumen', 'lumen-old'];
  const idsOf = (s, which) => new Set(which.flatMap((n) => s.docIds[n] ?? []));
  const beforeIds = idsOf(before, lumenNames);
  const afterIds = idsOf(after, ['lumen']);
  const lost = [...beforeIds].filter((id) => !afterIds.has(id));
  const gained = [...afterIds].filter((id) => !beforeIds.has(id));
  const allBefore = new Set(Object.values(before.docIds).flat());
  const allAfter = new Set(Object.values(after.docIds).flat());
  const lostAny = [...allBefore].filter((id) => !allAfter.has(id));
  log(`1 records: before lumen+lumen-old=${beforeIds.size} (all sources ${allBefore.size}); after lumen=${afterIds.size} (all sources ${allAfter.size}); lost=${lost.length} gained=${gained.length}; lost in any source=${lostAny.length} -> ${lostAny.length === 0 ? 'PASS' : 'FAIL'}`);
  if (lost.length) log(`  lost ids (record_id@version): ${lost.slice(0, 20).join(' ')}${lost.length > 20 ? ' ...' : ''}`);
  if (gained.length) log(`  new ids (record_id@version): ${gained.slice(0, 20).join(' ')}${gained.length > 20 ? ' ...' : ''}`);

  const multiAfter = Object.entries(after.nights).filter(([, m]) => sum(m) >= 2);
  const preexisting = multiAfter.filter(([d]) => sum(before.nights[d] ?? {}) >= 2).length;
  const crossBefore = multiAfter.filter(([d]) => Object.keys(before.nights[d] ?? {}).length >= 2).length;
  log(`2 nights: after, ${Object.keys(after.nights).length} dates with sleep, ${multiAfter.length} dates with 2+ nights (${preexisting} already had 2+ before, ${crossBefore} of those across the two Lumen sources) -> ${multiAfter.length === 0 ? 'PASS' : preexisting === multiAfter.length ? 'PASS (pre-existing, not made by the migration)' : 'FAIL'}`);

  const uBefore = unionSamples(before.sampleKeys, lumenNames);
  const uAfter = unionSamples(after.sampleKeys, ['lumen']);
  let eq = 0, lt = 0, gt = 0, missing = 0, extra = 0, nb = 0, na = 0;
  for (const [stream, byDate] of Object.entries(uBefore)) for (const [d, n] of Object.entries(byDate)) {
    nb += n;
    const a = uAfter[stream]?.[d];
    if (a === undefined) missing += n;
    else if (a === n) eq++;
    else if (a < n) lt++;
    else gt++;
  }
  for (const [stream, byDate] of Object.entries(uAfter)) for (const [d, n] of Object.entries(byDate)) {
    na += n;
    if (uBefore[stream]?.[d] === undefined) extra += n;
  }
  log(`3 samples per (stream, day): before union over lumen+lumen-old = ${nb} samples; after lumen = ${na}; days equal=${eq} fewer=${lt} more=${gt}; samples on days missing after=${missing}; samples on new days=${extra} -> ${lt === 0 && gt === 0 && missing === 0 && extra === 0 ? 'PASS' : 'FAIL'}`);
  const beforeSep = {};
  for (const n of lumenNames) for (const [st, byDate] of Object.entries(before.samples[n] ?? {})) beforeSep[st] = (beforeSep[st] ?? 0) + sum(byDate);
  log(`  before, counted per source (overlap not removed): ${Object.entries(beforeSep).map(([s, n]) => `${s}=${n}`).join(', ')}; union removes ${sum(beforeSep) - nb} duplicate (origin, time) samples`);

  const strip = (s) => JSON.stringify({ r: s.recordsByStream, d: s.docIds, n: s.nights, c: s.chunks, s: s.samples, src: s.sources, rs: s.ringSharing, m: s.markers });
  const same = strip(after) === strip(again);
  const ran2 = Object.values(results.pass2 ?? results.pass1 ?? {}).map((r) => r.ran);
  log(`4 idempotent: second pass ran=${JSON.stringify(ran2)}; snapshot after pass 2 identical to after pass 1 (records, ids, nights, chunks, samples, sources, markers): ${same} -> ${same && ran2.every((r) => r === false) ? 'PASS' : 'FAIL'}`);
  log(`network attempts blocked: ${attempts.length}${attempts.length ? ` (${[...new Set(attempts)].join(', ')})` : ''} -> ${attempts.length === 0 ? 'PASS (no network call attempted)' : 'FAIL'}`);
  const verdict = {
    records: lostAny.length === 0 && lost.length === 0,
    nights: multiAfter.length === 0 || preexisting === multiAfter.length,
    samples: lt === 0 && gt === 0 && missing === 0 && extra === 0,
    idempotent: same && ran2.every((r) => r === false),
    network: attempts.length === 0,
  };
  const failed = Object.entries(verdict).filter(([, ok]) => !ok).map(([k]) => k);
  log(`SUMMARY ${failed.length === 0 ? 'PASS' : 'FAIL'}: ${Object.entries(verdict).map(([k, ok]) => `${k}=${ok ? 'PASS' : 'FAIL'}`).join(' ')} (records before=${allBefore.size} after=${allAfter.size}, samples before=${nb} after=${na})`);
  process.exitCode = failed.length === 0 ? 0 : 3;

  if (process.env.L_REV2_OUT) {
    writeFileSync(process.env.L_REV2_OUT, JSON.stringify({ init: { deviceId, timeZone: init.timeZone, copy: basename(dir), relay: !!relayUrl }, before, after, again, results, attempts }, null, 1), { mode: 0o600 });
    log(`json written to ${basename(process.env.L_REV2_OUT)}`);
  }
} finally {
  const t = performance.now();
  if (program) await program.close().catch((e) => console.error('close failed', e?.message));
  console.log(`program closed in ${ms(performance.now() - t)}`);
}
process.exit(process.exitCode ?? 0);
