// J4 markers: high LDL and low eGFR typed by hand in the intake markers chapter → a re-run ladder shows marker-driven
// cautions with "because your X was Y on date" (plan 02 item 9; SUITE_SPEC §13.5.3).
import { fresh, seed, read, go, closeAll, results, mainText, scanForbidden, shot, sleep, answerScreening, dump } from './lib.mjs';
import { REQUESTS, applyRequest, runTier, assertLadder } from './j4-lib.mjs';
const R = results('J4-markers');
const { page, errors } = await fresh('desktop');
try {
  await seed(page);
  await go(page, '/onboarding/markers'); await sleep(2500);
  await page.getByRole('button', { name: /^Type the values/ }).click(); await sleep(1500);
  await page.getByLabel('lipids, tested on').fill('2026-09-14');
  await page.getByLabel('LDL cholesterol, value').fill('190');
  await page.getByRole('button', { name: /kidney and salts/ }).click(); await sleep(800);
  await page.getByLabel('kidney and salts, tested on').fill('2026-09-14');
  await page.getByLabel('eGFR, value').fill('50');
  await sleep(500);
  const save = page.getByRole('button', { name: /^Save \d+ value/ });
  R.check('Save counts both values', /Save 2 values/.test(await save.innerText()), await save.innerText());
  await save.click(); await sleep(2000);
  const t0 = await mainText(page);
  R.check('forbidden scan (markers chapter)', !scanForbidden(t0).length, scanForbidden(t0).join(';'));
  R.check('no doubled "because you said"', !/because you said: because you said/.test(t0));
  const m = await read(page, 'markers.get');
  const ids = m.doc.readings.map((r) => `${r.markerId ?? r.id}=${r.value}`);
  R.check('markers stored through the bus', m.doc.readings.length >= 2, ids.join(' '));
  R.check('marker notes computed (high LDL, low eGFR)', m.notes.length > 0, JSON.stringify(m.notes).slice(0, 180));
  // re-run a request
  await applyRequest(page, REQUESTS.find((r) => r.k === 'a'));
  let s = await runTier(page, 'S');
  if (s.summary.status !== 'done' || /screening|safety question/i.test(s.summary.message ?? '')) {
    // a low eGFR re-asks the kidney question before plans run (it asks, it does not refuse)
    const txt = await mainText(page);
    R.check('re-ask explained when the search pauses', /kidney|safety question/i.test(txt) || /kidney|safety/i.test(s.summary.message ?? ''), (s.summary.message ?? '').slice(0, 120));
    await go(page, '/welcome?step=screening'); await sleep(1500); await answerScreening(page);
    await go(page, '/plan/goals'); await sleep(1500);
    s = await runTier(page, 'S');
  }
  await assertLadder(page, R.check, 'markers/a/S', s.summary, { tier: 'S', deep: false });
  const t = await mainText(page);
  const because = t.match(/because your [^\n]{5,90}/gi) ?? [];
  R.check('LDL caution: "because your LDL … was 190 … on 14 Sep 2026"', because.some((b) => /LDL/i.test(b) && /190/.test(b) && /14 Sep/.test(b)), because.slice(0, 4).join(' | '));
  R.check('eGFR caution: "because your eGFR was 50 … on 14 Sep"', because.some((b) => /eGFR/i.test(b) && /50/.test(b) && /14 Sep/.test(b)), because.slice(0, 4).join(' | '));
  await shot(page, 'J4', 'markers-ladder');
} catch (err) { R.check('journey ran', false, err.message.slice(0, 180)); await dump(page, 'fail').catch(() => {}); }
R.check('no console/page errors', errors.length === 0, errors.join(' | '));
const rows = R.save(); await closeAll();
const fail = rows.filter((r) => !r.ok);
console.log(`J4 markers: ${rows.length - fail.length} pass / ${fail.length} fail`); for (const f of fail) console.log(`FAIL ${f.name} — ${f.detail}`);
process.exit(fail.length ? 1 : 0);
