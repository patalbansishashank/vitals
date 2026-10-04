// Q9 journey 5: the one-time history import, then the live stream over the same days → stored once.
// Profile "c" paired with person q9-c on oci-arm (node qa/scripts/Q9/setup.mjs c). The synthetic Lumen Health archive
// (src/biometrics/importers/__fixtures__/lumen-archive.json) goes in through Settings › Devices › "Import your Lumen
// Health history…"; then three events covering the same night, day and heart rate (the instants lumenArchive.test.ts
// uses for its overlap check) arrive over MQTT. Expected: no new record id; the card and SERVER.md describe the same steps.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORIGIN, ROOT, checker, cli, exportDocs, kept, log, lumenClient, lumenEvent, profile, publishAll, sleep, startPreview, waitQa } from './lib.mjs';

const c = checker();
const st = kept('state-c.json');
if (!st?.personId) throw new Error('run setup.mjs c first');
const results = { at: new Date().toISOString() };
const preview = await startPreview();
const P = await profile('c');
const page = P.page;
const ids = async () => {
  for (let i = 0; i < 20; i++) {
    const recs = (await exportDocs(page)).collections.bioRecords ?? [];
    if (recs.length) return { ids: new Set(recs.map((r) => r.record_id)), docs: recs.length, recs };
    await sleep(1500);
  }
  return { ids: new Set(), docs: 0, recs: [] };
};
try {
  c.journey('J5 history import then stream');
  await page.goto(`${ORIGIN}/settings?section=devices&qa=1`, { waitUntil: 'load' });
  await waitQa(page);
  const card = page.locator('section[aria-label="Lumen Health over MQTT"]');
  await card.waitFor();
  const cardText = (await card.innerText()).replace(/\s*\n\s*/g, ' | ');
  results.cardHistoryText = /Your Lumen Health history[^]*?(?=\| [A-Z][a-z]+ [a-z]+ over|$)/.exec(cardText)?.[0]?.slice(0, 400);
  await card.locator('input[type=file][aria-label="Import your Lumen Health history…"]').setInputFiles(join(ROOT, 'src/biometrics/importers/__fixtures__/lumen-archive.json'));
  const toast = await page.getByText(/\d+ records?, \d+ readings?\./).first().waitFor({ timeout: 60000 }).then(() => page.getByText(/\d+ records?, \d+ readings?\./).first().innerText(), () => '');
  results.toast = toast;
  c.check('history import through the Devices card (Import your Lumen Health history…)', /27 Sep – 29 Sep: \d+ records, \d+ readings\./.test(toast), toast);
  const before = await ids();
  results.before = before.docs;

  const out = cli(`mqtt add ${st.personId}`);
  const L = { address: /Address\s+(\S+)/.exec(out)?.[1], username: /User name\s+(\S+)/.exec(out)?.[1], password: /Password\s+(\S+)/.exec(out)?.[1] };
  const recv = '2026-09-29T18:00:05Z';
  const overlap = [
    lumenEvent('j5phone', 'health.sleep.timeline.updated', 'sleep_timeline', 'sleep/timeline', '2026-09-28T21:00:00Z', { sample_interval_minutes: 1, complete_session: true, stages: ['awake', 'awake', 'light', 'light', 'deep', 'rem', 'rem', 'unknown', 'light', 'awake', 'light'], provenance: 'device_classified' }, recv),
    lumenEvent('j5phone', 'health.activity.updated', 'daily_activity', 'activity/daily', '2026-09-29T18:00:00Z', { steps: 9000, distance_m: 6800, calories_kcal: 380, active_minutes: 45, provenance: 'device_reported' }, recv),
    lumenEvent('j5phone', 'health.metric.observed', 'hr', 'metrics/hr', '2026-09-29T05:00:00Z', { metric: 'hr', value: 61, unit: 'bpm', provenance: 'device_history', quality: 'unverified' }, recv),
  ];
  const cl = await lumenClient(L.address, L.username, L.password, 'q9-phone-c');
  await publishAll(cl, overlap);
  await cl.endAsync(true);
  let after = before;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    after = await ids();
    if (after.docs !== before.docs) break;
  }
  const fresh = [...after.ids].filter((x) => !before.ids.has(x));
  results.after = { docs: after.docs, newIds: fresh.length, kinds: fresh.map((x) => after.recs.find((r) => r.record_id === x)?.kind) };
  c.check('the overlapping live events add no new record id (stored once)', fresh.length === 0, `record ids ${before.ids.size} → ${after.ids.size}; documents ${before.docs} → ${after.docs}`);
  const doc = readFileSync(join(ROOT, 'docs/SERVER.md'), 'utf8');
  const phone = /## Phone setup[^]*?(?=\n## )/.exec(doc)?.[0] ?? '';
  c.check('SERVER.md names the same control as the card ("Import your Lumen Health history…") and the export path in Lumen Health', phone.includes('Import your Lumen Health history') && /Export All Data/.test(phone), (/Import your Lumen Health history[^\n]*/.exec(phone)?.[0] ?? /Import[^\n]*/.exec(phone)?.[0] ?? '').slice(0, 200));
  await card.screenshot({ path: join(ROOT, 'qa/screenshots/Q9-history-import-1440.png') }).catch(() => undefined);
} catch (e) {
  c.check('no exception', false, e.stack?.split('\n').slice(0, 3).join(' / '));
} finally {
  results.checks = c.checks;
  writeFileSync(join(ROOT, 'qa/results/Q9-j5-history.json'), JSON.stringify(results, null, 2));
  log(`browser errors: ${P.errors.slice(0, 5).join(' || ')}`);
  await P.ctx.close();
  preview?.kill();
  log(JSON.stringify(c.summary()));
}
