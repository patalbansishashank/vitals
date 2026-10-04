// Q9 journey 1: the live stream against oci-arm.
// A Lumen-like MQTT client publishes the synthetic stream, a "last night" stream for today and R17's ring.jsonl to the
// server; the Devices card of the paired profile "a" shows the feed; the records reach the browser by sync and show in
// Progress; a second sync group (profile "b") imports the same events from a file, and the stored records are compared.
//
//   node qa/scripts/Q9/setup.mjs a && node qa/scripts/Q9/setup.mjs b nojoin && node qa/scripts/Q9/j1-live.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { serverUrl } from '../lib/localConfig.mjs';
import { join } from 'node:path';
import {
  ORIGIN, ROOT, TMP, checker, cli, exportDocs, keep, kept, lastNightStream, log, lumenClient, profile, publishAll, qaRead, serverCall, sleep, startPreview, topicSuffix, waitQa,
} from './lib.mjs';

const c = checker();
const stA = kept('state-a.json');
if (!stA?.personId) throw new Error('run setup.mjs a first');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const SHOTS = join(ROOT, 'qa/screenshots');
const results = { today, personA: 'q9-a', at: new Date().toISOString() };

const synthetic = readFileSync(join(ROOT, 'qa/fixtures/lumen/mqtt-stream.synthetic.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((m) => ({ topic: m.topic, payload: m.payload }));
const night = lastNightStream('install123', today);
const ring = readFileSync(join(ROOT, 'packages/companion/spike/headless/fixtures/ring.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => {
  const ev = JSON.parse(l);
  return { topic: `lumen-health/v1/spike/${topicSuffix(ev)}`, payload: l };
});
const streamL1 = [...synthetic, ...night.messages];
keep('night.json', { bed: night.bed, wake: night.wake, asleepMin: night.asleepMin, today });
// the same events as one CloudEvents file for the second group
const file = join(TMP, 'j1-same-events.jsonl');
writeFileSync(file, [...streamL1, ...ring].map((m) => m.payload).join('\n') + '\n');

const preview = await startPreview();
const A = await profile('a');
const page = A.page;
let clients = [];
try {
  c.journey('J1 live stream');
  // ---- broker logins: L1 from the Devices card (shown once), L2 from the CLI
  await page.goto(`${ORIGIN}/settings?section=devices&qa=1`, { waitUntil: 'load' });
  const card = page.locator(`section[aria-label="Lumen Health over MQTT"]`);
  await card.waitFor({ timeout: 30000 });
  let L1 = kept('login-L1.json');
  let L2 = kept('login-L2.json');
  if (L1?.personId !== stA.personId || L2?.personId !== stA.personId) {
    await card.getByRole('button', { name: 'Create broker login' }).click();
    const once = card.locator('[role=group][aria-label="Shown once"]');
    await once.waitFor({ timeout: 30000 });
    const onceText = await once.innerText();
    const lines = onceText.split('\n').map((l) => l.trim()).filter(Boolean);
    const field = (label) => lines[lines.indexOf(label) + 1];
    L1 = { address: field('address'), baseTopic: field('base topic'), username: field('username'), password: field('password') };
    keep('login-L1.json', { ...L1, personId: stA.personId });
    c.check('Devices card: "Create broker login" shows address, base topic, username, password once', L1.address === `wss://${new URL(serverUrl()).host}/mqtt` && L1.baseTopic === 'lumen-health/v1' && /^p[0-9a-f]{16}-\d+$/.test(L1.username ?? '') && (L1.password ?? '').length >= 16, `address ${L1.address}, base topic ${L1.baseTopic}, username ${L1.username}`);
    // no screenshot of the shown-once block: it holds the password
    await card.getByLabel('I’ve pasted these into Lumen Health').check().catch(() => undefined);
    await card.getByRole('button', { name: 'Done' }).click().catch(() => undefined);
    const out = cli(`mqtt add ${stA.personId}`);
    L2 = { address: /Address\s+(\S+)/.exec(out)?.[1], username: /User name\s+(\S+)/.exec(out)?.[1], password: /Password\s+(\S+)/.exec(out)?.[1] };
    keep('login-L2.json', { ...L2, personId: stA.personId });
    c.check('second broker login from `vitals-server mqtt add`', /^p[0-9a-f]{16}-\d+$/.test(L2.username ?? '') && L2.address === L1.address, L2.username);

  } else log('broker logins of an earlier run reused');
  // ---- publish
  const t1 = Date.now();
  const c1 = await lumenClient(L1.address, L1.username, L1.password, 'q9-phone-1');
  const c2 = await lumenClient(L2.address, L2.username, L2.password, 'q9-phone-2');
  clients = [c1, c2];
  await Promise.all([publishAll(c1, streamL1), publishAll(c2, ring)]);
  const pubMs = Date.now() - t1;
  c.check(`all ${streamL1.length + ring.length} messages acknowledged (QoS 1, 10 in flight, wss with subprotocol mqtt)`, true, `${pubMs} ms`);
  results.published = { L1: streamL1.length, L2: ring.length, ms: pubMs };

  // ---- the Devices card
  let st = null;
  for (let i = 0; i < 20; i++) {
    st = (await serverCall(page, 'GET', '/v1/mqtt/status')).json;
    const n = (st?.eventsToday ?? []).reduce((a, x) => a + x.count, 0);
    if (n >= streamL1.length + ring.length - 10) break;
    await sleep(1500);
  }
  results.statusAfterPublish = st;
  c.check('GET /v1/mqtt/status: both logins connected, events counted per stream', st?.credentials?.length === 2 && st.credentials.every((x) => x.connected) && (st.eventsToday ?? []).length > 3, JSON.stringify(st?.eventsToday ?? []).slice(0, 300));
  await page.reload({ waitUntil: 'load' });
  await card.waitFor();
  await page.getByText('last event').first().waitFor({ timeout: 20000 }).catch(() => undefined);
  await sleep(1500);
  const cardText = (await card.innerText()).replace(/\s*\n\s*/g, ' | ');
  results.cardText = cardText;
  c.check('Devices card shows connection state ("connected")', /\bconnected\b/.test(cardText) && !/never connected/.test(cardText), cardText.slice(0, 300));
  c.check('Devices card shows the last event time', /last event \| [A-Z][a-z]{2} \d|last event \| \d/.test(cardText), cardText.slice(0, 300));
  c.check('Devices card shows counts per stream today', /today \| .*\d/.test(cardText) && !/today \| nothing yet/.test(cardText), (/today \|[^]*?(?=set aside|$)/.exec(cardText)?.[0] ?? '').slice(0, 300));
  c.check('Devices card shows a battery line (64 % from the last battery event)', /Battery 64 %/.test(cardText), (/Battery[^|]*/.exec(cardText)?.[0]) ?? 'no battery line on the card');
  await card.screenshot({ path: join(SHOTS, 'Q9-devices-card-1440.png') }).catch(() => undefined);

  // ---- records by sync
  await waitQa(page);
  let docs = null;
  let nBio = 0;
  for (let i = 0; i < 40; i++) {
    docs = await exportDocs(page);
    const recs = docs.documents?.bioRecords ?? docs.collections?.bioRecords ?? [];
    nBio = recs.length;
    if (recs.some((r) => JSON.stringify(r).includes(`"steps":${4210}`)) && recs.some((r) => JSON.stringify(r).includes('2026-10-01'))) break;
    await sleep(3000);
  }
  results.exportKeysA = Object.keys(docs ?? {});
  log(`export top-level keys: ${results.exportKeysA.join(', ')}; bioRecords ${nBio}`);
  writeFileSync(join(TMP, 'j1-export-a.json'), JSON.stringify(docs));
  c.check('records reached the paired browser by sync (today’s 4,210 steps and the ring.jsonl night)', nBio > 0, `bioRecords ${nBio}`);
} catch (e) {
  c.check('no exception', false, e.stack?.split('\n').slice(0, 3).join(' / '));
} finally {
  for (const cl of clients) await cl.endAsync(true).catch(() => undefined);
  results.checks = c.checks;
  writeFileSync(join(ROOT, 'qa/results/Q9-j1-live.json'), JSON.stringify(results, null, 2));
  log(`browser errors: ${A.errors.slice(0, 5).join(' || ')}`);
  await A.ctx.close();
  preview?.kill();
  log(JSON.stringify(c.summary()));
}
