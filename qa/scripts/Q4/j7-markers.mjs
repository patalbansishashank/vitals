// J7: "read my markers" with synthetic reports (qa/fixtures/markers): the PDF is read on the device (text layer) →
// review table → confirm → a planner search via the Coach → the ladder shows "because your X was Y on date" lines.
// Privacy: no patient detail of the report reaches the provider (every request is inspected); for a photo (vision path)
// the image the provider gets has the header band blanked.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { openProfile, go, read, say, cards, sleep, results, providerLog, shot, ROOT, mainText, waitPlanner, confirmMarkersReview } from './lib.mjs';

const LOG = `${ROOT}/.e6-tmp/q4-J7.jsonl`;
const all = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '');
const patientStrings = (file) => Object.values(JSON.parse(fs.readFileSync(`${ROOT}/qa/fixtures/markers/${file}`, 'utf8')).patient).flatMap((v) => [v, ...String(v).split(/[\s,/]+/).filter((w) => w.length > 5 && !/^(Years?|Female|Male|Kolkata|Bengaluru|Jaipur)$/i.test(w))]);

export async function run({ vp = 'desktop' } = {}) {
  const { check, save } = results('J7-markers');
  fs.rmSync(LOG, { force: true });
  await providerLog(LOG);
  const { ctx, page, errors } = await openProfile('j7', { from: 'seed-base', vp });
  try {
    await go(page, '/coach');
    // the real picker: the attach key opens it and accepts a PDF (Q4-14)
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /^Add a (photo or PDF|PDF report)$/ }).first().click()]);
    await chooser.setFiles(`${ROOT}/qa/fixtures/markers/srl-style.pdf`);
    await sleep(800);
    await say(page, 'read my markers', { timeout: 240000 });
    const review = (await cards(page)).at(-1);
    check('review table card, nothing saved yet', review?.state === 'pending' && /not saved yet/i.test(review.text) && ((await read(page, 'markers.get')).doc?.readings ?? []).length === 0, review?.text.slice(0, 120));
    const tool = all().split('\n').filter(Boolean).map((l) => JSON.parse(l)).flatMap((r) => r.request.messages.filter((m) => m.role === 'tool')).map((m) => m.content).find((c) => /textLayer|extractionId/.test(c));
    check('PDF read on the device (text layer, no AI call for the values)', /"route":"textLayer"/.test(tool ?? ''), (tool ?? '').slice(0, 120));
    const leaked = patientStrings('srl-style.expected.json').filter((s) => all().includes(s));
    check('no patient detail of the PDF reaches the provider', leaked.length === 0, leaked.join(' | '));
    const label = await confirmMarkersReview(page);
    const readings = (await read(page, 'markers.get')).doc?.readings ?? [];
    check('confirm saves the ticked values with provenance and date', readings.length >= 10 && readings.every((r) => r.provenance === 'coach' && r.date === '2026-08-03' && r.confirmed), `${label}; ${readings.length} readings`);
    check('eGFR 47 and uric acid 7.2 saved', readings.some((r) => r.id === 'egfr' && r.value === 47) && readings.some((r) => r.id === 'urate' && r.value === 7.2), readings.map((r) => r.id).join(','));
    await say(page, 'make me a plan for losing 6 kg of fat in 3 months');
    const r = await waitPlanner(page);
    check('plan search after markers finished', r?.status === 'done', `${r?.status} ${r?.message}`);
    // in-app navigation keeps the in-memory result (a reload would drop it)
    await page.evaluate(() => { history.pushState({}, '', '/plan/results?qa=1'); dispatchEvent(new PopStateEvent('popstate')); });
    await sleep(3000);
    const t = (await mainText(page)).replace(/\s+/g, ' ');
    check('ladder shows planner cautions with the because-line', /because your (eGFR|uric acid|potassium|ALT)[^.]* was [\d.]+ [^ ]+ on 3 Aug 2026/i.test(t), (t.match(/because your[^.]{0,80}/i) ?? [''])[0]);
    check('nothing banned outright (caps and clinician notes, not bans)', /Nothing is banned outright/i.test(t) && !/\bbanned\b(?! outright)/i.test(t));
    await shot(page, `J7-ladder-because-${vp}`);
    // photo (vision path): the header band with the patient block is blanked before the image goes out
    const n0 = all().length;
    await go(page, '/coach');
    await page.locator('[data-testid=coach-photo-input]').setInputFiles(`${ROOT}/qa/fixtures/markers/photo-report.png`);
    await sleep(800);
    await say(page, 'read my markers from this photo', { timeout: 240000 });
    const after = all().slice(n0);
    const reqs = after.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const vision = reqs.find((x) => /lab_rows/.test(JSON.stringify(x.request)) && /image_url|"type":"image"/.test(JSON.stringify(x.request)));
    check('photo goes to the provider as a vision request', !!vision, `${reqs.length} requests`);
    const leaked2 = patientStrings('photo-report.expected.json').filter((s) => after.includes(s));
    check('no patient detail of the photo in any request text', leaked2.length === 0, leaked2.join(' | '));
    if (vision) {
      const url = JSON.stringify(vision.request).match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/)?.[0];
      const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
      const p2 = await b.newPage();
      const stats = await p2.evaluate(async (src) => {
        const img = new Image(); img.src = src; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const band = (y0, y1) => { const d = g.getImageData(0, Math.floor(y0 * img.height), img.width, Math.max(1, Math.floor((y1 - y0) * img.height))).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; s += v; s2 += v * v; n++; } const m = s / n; return Math.sqrt(Math.max(0, s2 / n - m * m)); };
        return { w: img.width, h: img.height, top: band(0, 0.2), body: band(0.35, 0.8) };
      }, url);
      await b.close();
      check('the image sent has a blank header band (patient block masked)', stats.top < 3 && stats.body > 10, JSON.stringify(stats));
    }
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no console or page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
  return save();
}
if (process.argv[1]?.endsWith('j7-markers.mjs')) { const rows = await run(); console.table(rows.map((r) => ({ name: r.name, ok: r.ok }))); }
