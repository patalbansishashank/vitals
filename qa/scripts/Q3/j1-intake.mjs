// Q3 journey 1 (desktop 1440×900, no AI provider): first run from /welcome through every intake chapter. On every
// question: footer keys, Back (→ previous question in change mode, Cancel returns), leave the chapter and return (same
// question), Ask me later (status 'skipped' in intake.get, an "Answer" row that reopens it), the answer (status
// 'answered', the answered list shows it). At each chapter end: Change of earlier answers lands in state (intake.get,
// profile.get, kitchen.get, supplements.get) and can be restored. Measured maintenance, kitchen pickers (region
// defaults, Paste a list), supplements (taking vs on hand, dose rows), blood markers (manual ≥ 6 values; report upload
// with table extraction and no provider; skip), devices, summary card insets and the progress bar.
//   BASE=http://127.0.0.1:5191 node qa/scripts/Q3/j1-intake.mjs
import { fresh, results, closeAll, mainText, shot } from './lib.mjs';
import { CHAPTERS, MARKER_IDS_6, answer, card, cardState, expected, firstRun, go, nextCard, overflowPx, progressBox, read, rows, scan, summaryInsets, turnsOf, uploadReport } from './j1-lib.mjs';
// the app's day: it rolls over at 04:00 (SUITE_SPEC §3.4), so before 04:00 it is still yesterday
const localToday = () => { const d = new Date(Date.now() - 4 * 3600e3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const R = results('J1');
const { page, errors } = await fresh('desktop');
const forbidden = [];
const screens = new Set();
const onScreen = async (label) => {
  screens.add(label);
  await scan(page, label, forbidden);
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ig = () => read(page, 'intake.get');
const t0 = Date.now();

const NAME = { hdl: 'HDL cholesterol', ldl: 'LDL cholesterol', tg: 'triglycerides', apoB: 'ApoB', lpa: 'Lp(a)', hba1c: 'HbA1c', ft3: 'free T3', tsh: 'TSH', b12: 'vitamin B12', vitD: 'vitamin D (25-OH)', hsCrp: 'hs-CRP', ferritin: 'ferritin', fpg: 'fasting glucose', insulin: 'fasting insulin', alt: 'ALT (SGPT)', ast: 'AST (SGOT)', ggt: 'GGT', creatinine: 'creatinine', egfr: 'eGFR', uacr: 'urine ACR', urate: 'uric acid', hb: 'haemoglobin', sodium: 'sodium', potassium: 'potassium', testosterone: 'testosterone (total)', cortisol: 'morning cortisol' };

/* ------------------------------------------------------------------ first run */
try {
  await firstRun(page, undefined, onScreen);
  R.check('first run: welcome → screening → consent → body → a normal day', /onboarding\/activity/.test(page.url()), page.url());
} catch (e) {
  R.check('first run: welcome → screening → consent → body → a normal day', false, e.message.split('\n')[0]);
}

/* ------------------------------------------------------------------ progress bar at 1440 (open question, Skip this part shown) */
{
  const p = await progressBox(page);
  const ok = p && p.sameRowAsTitle && p.rowEndGap <= 25 && p.width >= 430 && p.width <= 450 && p.skipGap !== null && Math.abs(p.skipGap - 24) <= 2;
  R.check('progress bar 1440: on the title row, right-aligned (row ends ${p?.rowEndGap} px from the column edge), 440 wide, 24 px before Skip this part', ok, JSON.stringify(p));
  console.log('progress 1440', JSON.stringify(p));
}

/* ------------------------------------------------------------------ every question of every chapter */
const perQuestion = [];
async function walkChapter(ch) {
  let prev = null;
  let idx = 0;
  const seen = new Map();
  for (let guard = 0; guard < 40; guard++) {
    const st = await cardState(page);
    if (!st) break;
    seen.set(st.id, (seen.get(st.id) ?? 0) + 1);
    if (seen.get(st.id) > 2) {
      R.check(`${ch.id}/${st.id}: flow moves on after answering`, false, 'same question opened 3 times');
      break;
    }
    const q = `${ch.id}/${st.id}`;
    const res = { q, prompt: st.prompt };
    await onScreen(q);
    const keys = st.foot.map((k) => k.t);
    // a widget with its own footer (markers table: "Save N values") puts its key in Next's place (Q3-J1-06)
    const next = st.foot.find((k) => k.t === 'Next' || /^Save \d+ values?$/.test(k.t));
    res.footer = keys.join(' · ');
    R.check(`${q}: Next present and disabled until answered`, next && next.dis, res.footer);
    if (idx > 0) R.check(`${q}: Back present`, keys.includes('Back'), res.footer);
    if (st.chip !== null) R.check(`${q}: parent chip has one "because you said:"`, (st.chip.match(/because you said/g) ?? []).length === 1, st.chip);

    // Back → previous question in change mode → Cancel → this question again
    if (keys.includes('Back') && prev) {
      await card(page).locator(':scope > .lm-ik-card__foot button').filter({ hasText: /^Back$/ }).click();
      const b = await nextCard(page, st.id);
      const cancel = card(page).locator(':scope > .lm-ik-card__foot button').filter({ hasText: /^Cancel$/ });
      const hasCancel = (await cancel.count()) > 0;
      if (hasCancel) await cancel.click();
      const c = await nextCard(page, b?.id ?? '');
      res.back = b?.id === prev && b.changing && c?.id === st.id;
      R.check(`${q}: Back opens the previous question (${prev}) in change mode; Cancel returns`, res.back, `back→${b?.id} changing=${b?.changing} cancel→${c?.id}`);
      if (c?.id !== st.id) { await go(page, ch.path); await page.locator('main h1').waitFor(); }
    }

    // leave the chapter and return: the same question opens
    await go(page, '/body');
    await page.waitForTimeout(400);
    await go(page, ch.path);
    await page.locator('main fieldset.lm-ik-card, main h3').first().waitFor({ timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    const back = await cardState(page);
    res.return = back?.id === st.id;
    R.check(`${q}: leave and return shows the same question`, res.return, `returned to ${back?.id ?? 'no card'}`);
    if (!res.return) { perQuestion.push(res); break; }

    // Ask me later → status skipped, an "Answer" row → reopens the same question
    if (keys.includes('Ask me later')) {
      await card(page).locator(':scope > .lm-ik-card__foot button').filter({ hasText: /^Ask me later$/ }).click();
      await nextCard(page, st.id);
      await page.waitForTimeout(300);
      const status = turnsOf(await ig(), ch.section).status[st.id];
      const laterRow = page.locator('main li.lm-ik-row-a[data-later]').filter({ hasText: st.prompt.slice(0, 40) });
      const rowShown = (await laterRow.count()) > 0;
      if (rowShown) await laterRow.first().getByRole('button').click();
      const again = await cardState(page);
      res.later = status === 'skipped' && rowShown && again?.id === st.id;
      R.check(`${q}: Ask me later records 'skipped', lists it, and Answer reopens it`, res.later, `status=${status} row=${rowShown} reopened=${again?.id}`);
      if (again?.id !== st.id) { perQuestion.push(res); break; }
    } else res.later = 'n/a';

    // answer
    try {
      res.answer = await answer(page, (await cardState(page)) ?? st, 'rich');
    } catch (e) {
      res.answer = 'ERR ' + e.message.split('\n')[0];
    }
    await nextCard(page, st.id, 8000);
    await page.waitForTimeout(400);
    const t = turnsOf(await ig(), ch.section);
    const rs = await rows(page);
    const row = rs.find((r) => r.q === st.prompt || r.q.startsWith(st.prompt.slice(0, 30)));
    res.stored = t.status[st.id] === 'answered' && t.values[st.id] !== undefined;
    res.row = row?.a ?? null;
    R.check(`${q}: answer stored (intake.get status 'answered')`, res.stored, `${res.answer} → status=${t.status[st.id]} value=${JSON.stringify(t.values[st.id])?.slice(0, 80)}`);
    R.check(`${q}: the answered list shows the answer`, row && row.a && !/object Object|undefined/.test(row.a) && !row.later, JSON.stringify(row ?? 'no row').slice(0, 160));
    if (idx === 0) {
      const evs = await page.evaluate(() => window.__vitals.events().filter((e) => e.type === 'committed').map((e) => e.commandId));
      R.check(`${q}: the answer was written through the command bus`, evs.some((c) => /^(intake|markers|kitchen|pantry|supplements)\./.test(c)), evs.slice(-5).join(','));
    }
    perQuestion.push(res);
    prev = st.id;
    idx++;
  }
  await onScreen(`${ch.id}/end`);
}

/** Change on a row: single answers switch to another option and back (state checked each time); others Cancel. */
async function changeTests(ch, { only = null, extra = null } = {}) {
  const rs = (await rows(page)).filter((r) => !r.later && !r.notUsed);
  for (const r of rs) {
    try {
      await changeOne(ch, r, only, extra);
    } catch (e) {
      R.check(`${ch.id} change "${r.q.slice(0, 40)}": completes`, false, e.message.split('\n')[0]);
      await go(page, ch.path);
    }
  }
}
async function changeOne(ch, r, only, extra) {
  {
    const key = page.getByRole('button', { name: new RegExp(`^Change: ${esc(r.q.slice(0, 60))}`) }).first();
    if (!(await key.count())) return;
    await key.click();
    const st = await cardState(page);
    if (!st || !st.changing) { R.check(`${ch.id} change "${r.q.slice(0, 40)}": opens the question in change mode`, false, JSON.stringify(st)); await go(page, ch.path); return; }
    if (only && !only.includes(st.id)) {
      await card(page).locator(':scope > .lm-ik-card__foot button').filter({ hasText: /^Cancel$/ }).click();
      await nextCard(page, st.id);
      const after = (await rows(page)).find((x) => x.q === r.q);
      R.check(`${ch.id}/${st.id}: Change → Cancel keeps the row unchanged`, after?.a === r.a, `${r.a} → ${after?.a}`);
      return;
    }
    if (st.kind !== 'single') {
      await card(page).locator(':scope > .lm-ik-card__foot button').filter({ hasText: /^Cancel$/ }).click();
      await nextCard(page, st.id);
      const after = (await rows(page)).find((x) => x.q === r.q);
      R.check(`${ch.id}/${st.id}: Change → Cancel keeps the row unchanged`, after?.a === r.a, `${r.a} → ${after?.a}`);
      return;
    }
    const before = turnsOf(await ig(), ch.section).values[st.id];
    const extraBefore = extra ? await extra(st.id) : null;
    const opts = await page.evaluate(() => [...document.querySelectorAll('main fieldset.lm-ik-card .lm-ik-turn__answers button')].map((b) => ({ t: b.innerText.trim(), on: b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true' })));
    const cur = opts.find((o) => o.on);
    const alt = opts.find((o) => !o.on && !/^Something|^Add$/.test(o.t));
    if (!alt || !cur) { await card(page).locator(':scope > .lm-ik-card__foot button').filter({ hasText: /^Cancel$/ }).click(); return; }
    await card(page).locator('.lm-ik-turn__answers button').filter({ hasText: new RegExp(`^${esc(alt.t.split('\n')[0])}`) }).first().click();
    await nextCard(page, st.id);
    await page.waitForTimeout(500);
    const mid = turnsOf(await ig(), ch.section).values[st.id];
    const extraMid = extra ? await extra(st.id) : null;
    const rowMid = (await rows(page)).find((x) => x.q === r.q);
    // a newly needed child opens next: put it off for now (restoring the parent hides it again)
    const child = await cardState(page);
    // restore
    await page.getByRole('button', { name: new RegExp(`^Change: ${esc(r.q.slice(0, 60))}`) }).first().click();
    await page.waitForTimeout(300);
    await card(page).locator('.lm-ik-turn__answers button').filter({ hasText: new RegExp(`^${esc(cur.t.split('\n')[0])}`) }).first().click();
    await nextCard(page, st.id);
    await page.waitForTimeout(500);
    const end = turnsOf(await ig(), ch.section).values[st.id];
    const changed = JSON.stringify(mid) !== JSON.stringify(before);
    const restored = JSON.stringify(end) === JSON.stringify(before);
    R.check(`${ch.id}/${st.id}: Change to "${alt.t.slice(0, 30)}" lands in intake.get, the row updates, and changing back restores it`, changed && restored && rowMid && rowMid.a !== r.a, `before=${JSON.stringify(before)} mid=${JSON.stringify(mid)} end=${JSON.stringify(end)} row=${rowMid?.a?.slice(0, 40)}${child && child.id !== st.id ? ' child=' + child.id : ''}`);
    if (extra && (extraBefore !== null || extraMid !== null)) R.check(`${ch.id}/${st.id}: the change reaches the derived document`, JSON.stringify(extraMid) !== JSON.stringify(extraBefore), `${JSON.stringify(extraBefore)?.slice(0, 80)} → ${JSON.stringify(extraMid)?.slice(0, 80)}`);
  }
}

for (const ch of CHAPTERS) {
  if (!page.url().includes(ch.path)) await go(page, ch.path);
  await page.locator('main h1').waitFor();
  const h1 = await page.locator('main h1').innerText();
  R.check(`${ch.id}: chapter opens (${ch.title})`, h1.trim() === ch.title, h1);
  await walkChapter(ch);

  if (ch.id === 'activity') {
    const txt = await mainText(page);
    const iRes = txt.indexOf('Your maintenance');
    const iM1 = txt.indexOf('Have you ever had your resting energy');
    R.check('activity: maintenance result card comes before the measured-maintenance questions', iRes >= 0 && iM1 > iRes, `result@${iRes} M1@${iM1}`);
    const a = await ig();
    const m = a.sections.activity.measured;
    R.check('activity: measured resting energy stored (1720 kcal, metabolic cart, 2026-03)', m && m.kind === 'rmr' && m.value === 1720 && m.method === 'metabolic_cart' && m.date === '2026-03', JSON.stringify(m));
    R.check('activity: result card says how the measurement is used', /Your measurement: 1\s?720 kcal resting · breath test · Mar 2026 · used as your resting energy/.test(txt), txt.match(/Your measurement[^\n]*/)?.[0]);
    const prof = await read(page, 'profile.get');
    R.check('activity: profile carries the measured resting metabolism', JSON.stringify(prof).includes('1720'), JSON.stringify(prof).match(/.{40}1720.{40}/)?.[0] ?? 'no 1720 in profile');
    R.check('activity: no slide-in sheet or "Correct it" anywhere', !(await page.locator('[role=dialog], .lm-sheet').count()) && !/Correct it|Keep these/.test(txt), '');
    await changeTests(ch, { extra: async (id) => (id === 'job' || id === 'home' ? JSON.stringify((await read(page, 'profile.get')).profile?.habits ?? {}) : null) });
  } else if (ch.id === 'food') {
    const k = await read(page, 'kitchen.get');
    R.check('food: cuisines saved (kitchen.get has Kerala)', k.cuisines?.some((c) => c.id === 'cu.kerala'), JSON.stringify(k.cuisines));
    const kerala = ['eq.puttu_maker', 'eq.appam_pan'].filter((id) => k.equipment?.some((e) => e.id === id || (e.label ?? '').toLowerCase().includes(id.split('.')[1].split('_')[0])));
    R.check('food: equipment pre-ticked from the Kerala region defaults (puttu maker, appam pan)', kerala.length === 2 && k.equipment.length >= 10, `${k.equipment?.length} items; ${kerala.join(',')}`);
    const pasted = ['Ragi flour', 'Basmati rice', 'Ghee', 'Quinoa', 'zzqx widget powder'];
    const st = (k.staples ?? []).map((s) => s.label);
    R.check('food: "Paste a list" staples saved (5 matched + 1 kept as written)', pasted.every((p) => st.includes(p)) && st.some((l) => /toor/i.test(l)), st.slice(-7).join(', '));
    const pa = await read(page, 'pantry.get');
    const pl = (pa.items ?? []).map((i) => i.label.toLowerCase()).join('|');
    R.check('food: pasted pantry list saved (paneer, spinach, cheddar, bhindi/okra)', /paneer/.test(pl) && /spinach/.test(pl) && /cheddar/.test(pl) && /(okra|bhindi|lady)/.test(pl), pl.slice(0, 200));
    const s = await read(page, 'supplements.get');
    const by = Object.fromEntries((s.rows ?? []).map((r) => [r.supplementId, r]));
    R.check('food: supplements taking vs on hand (creatine 5 g morning, D3 2000 IU morning, whey at home)', s.stance === 'taking' && by.creatine_monohydrate?.state === 'taking' && by.creatine_monohydrate.dose === 5 && by.creatine_monohydrate.timesOfDay?.includes('morning') && by.vitamin_d3?.dose === 2000 && by.whey_protein?.state === 'onHand', JSON.stringify(s.rows));
    R.check('food: supplement levers reach the planner inputs (creatine opted in)', s.planner?.optInLevers?.includes('creatine'), JSON.stringify(s.planner));
    // the S1 options include taking and on hand
    await page.getByRole('button', { name: /^Change: Do you take supplements now/ }).click();
    const s1 = await card(page).innerText();
    R.check('food: S1 offers "I already take some" and "I have some at home but don’t take them"', /I already take some/.test(s1) && /I have some at home but don.t take them/.test(s1), '');
    await card(page).locator(':scope > .lm-ik-card__foot button').filter({ hasText: /^Cancel$/ }).click();
    await changeTests(ch, { extra: async (id) => (id === 'supplements' ? (await read(page, 'supplements.get')).stance : id === 'cooks' || id === 'mealTime' ? JSON.stringify((await ig()).sections.diet.whoCooks ?? '') + JSON.stringify((await ig()).sections.diet.timeBudgetMin ?? '') : null) });
    // a picker answer changed from its row lands in kitchen.get
    await page.getByRole('button', { name: /^Change: Which cuisines/ }).click();
    await card(page).getByRole('searchbox').fill('punjabi');
    await page.waitForTimeout(300);
    await card(page).getByRole('button', { name: /^Punjabi/ }).or(card(page).getByRole('checkbox', { name: /^Punjabi/ })).first().click();
    await card(page).locator('.lm-ik-turn__answers button').filter({ hasText: /^Done/ }).click();
    await page.waitForTimeout(1200);
    const k2 = await read(page, 'kitchen.get');
    R.check('food: Change cuisines (+ Punjabi) lands in kitchen.get, Kerala kept first', k2.cuisines?.length === 2 && k2.cuisines[0].id === 'cu.kerala' && /punjab/i.test(k2.cuisines[1].id), JSON.stringify(k2.cuisines));
  } else if (ch.id === 'markers') {
    const m1 = await read(page, 'markers.get');
    const man = (m1.doc?.readings ?? []).filter((r) => r.provenance === 'manual').map((r) => r.id);
    R.check(`markers: manual entry saved ${MARKER_IDS_6.length} values (LDL, HDL, TG, HbA1c, creatinine, eGFR, ferritin, TSH, vitamin D)`, MARKER_IDS_6.every((id) => man.includes(id)), man.join(','));
    const ldl = m1.doc.readings.find((r) => r.id === 'ldl');
    R.check('markers: LDL 162 mg/dL stored with the canonical mmol/L value', ldl && ldl.value === 162 && Math.abs(ldl.valueCanonical - 4.19) < 0.02 && ldl.date === localToday(), JSON.stringify(ldl));
    const txt = await mainText(page);
    R.check('markers: chapter end lists what the values change, with "because your LDL…" chips', /What these change in your plan/.test(txt) && new RegExp(`because your LDL cholesterol was 162 mg/dL on ${Number(localToday().slice(8))} ${new Date(localToday() + 'T12:00').toLocaleString('en-GB', { month: 'short' })} ${localToday().slice(0, 4)}`).test(txt), '');
    await shot(page, 'J1', 'markers-manual-end');
    // the entry card statements, verbatim
    await page.getByRole('button', { name: /^Change: Do you have results from a recent blood test/ }).first().click();
    await page.waitForTimeout(600);
    const b0 = await card(page).innerText();
    R.check('markers: both statements verbatim on the entry card', b0.includes('This is the most detailed option; many values are involved.') && /not medical advice/.test(b0), b0.slice(0, 300));
    // the report path with no provider: table-layout extraction alone
    await card(page).locator('.lm-ik-turn__answers button').filter({ hasText: /^Let the Coach read my report/ }).click();
    await nextCard(page, 'has');
    const rep = await cardState(page);
    R.check('markers: "Let the Coach read my report" opens the report card', rep?.id === 'report', JSON.stringify(rep));
    await onScreen('markers/report');
    const exp = expected('thyro-style');
    const up = await uploadReport(page, 'thyro-style.pdf');
    await onScreen('markers/review');
    await shot(page, 'J1', 'markers-review');
    const found = exp.tierA.filter((m) => up.rowsRead.some((r) => r.label.startsWith(`Use ${NAME[m.markerId]}, ${m.value} `)));
    R.check(`markers: report read on the device without a provider; review table lists all ${exp.tierA.length} expected markers with values`, found.length === exp.tierA.length && up.rowsRead.length === exp.tierA.length, `${found.length}/${exp.tierA.length} matched; rows=${up.rowsRead.map((r) => r.label).join(' | ').slice(0, 300)}`);
    R.check('markers: every review row starts unticked', up.rowsRead.length > 0 && up.rowsRead.every((r) => !r.ticked), '');
    const absent = Object.keys(NAME).filter((id) => !exp.tierA.some((m) => m.markerId === id) && id !== 'ft3');
    R.check('markers: absent markers read "not in your report"', absent.slice(0, 5).every((id) => up.text.includes(`${NAME[id]} · not in your report`)), absent.slice(0, 5).join(','));
    R.check('markers: patient details are not shown in the review', !up.text.includes(exp.patient.name) && !up.text.includes(exp.patient.phone), '');
    R.check('markers: sample date read from the report', up.text.includes('14 Sep 2026') && exp.sampleDate === '2026-09-14', exp.sampleDate);
    await card(page).getByRole('button', { name: /^Tick all high-confidence/ }).click();
    const save = card(page).getByRole('button', { name: /^Save \d+ confirmed values/ });
    const n = Number((await save.innerText()).match(/\d+/)[0]);
    await save.click();
    await page.waitForTimeout(1500);
    const evs = await page.evaluate(() => window.__vitals.events().filter((e) => e.type === 'committed').map((e) => e.commandId));
    R.check('bus: the confirmed values were written through the command bus (committed events)', evs.some((c) => /^markers\./.test(c)), evs.join(','));
    const m2 = await read(page, 'markers.get');
    const pdf = (m2.doc?.readings ?? []).filter((r) => r.provenance === 'pdf');
    const wrong = pdf.filter((r) => { const e = exp.tierA.find((m) => m.markerId === r.id); return !e || e.value !== r.value || r.date !== exp.sampleDate; });
    R.check(`markers: ${n} confirmed values saved with provenance pdf, values and date as the report`, pdf.length === n && n >= exp.tierA.length - 2 && !wrong.length, `saved ${pdf.length}; mismatches ${JSON.stringify(wrong).slice(0, 200)}`);
    // skip path: "No, skip this chapter" (recorded as answered skip; what the plan uses is reported)
    await page.getByRole('button', { name: /^Change: Do you have results from a recent blood test/ }).first().click();
    await card(page).locator('.lm-ik-turn__answers button').filter({ hasText: /^No, skip this chapter/ }).click();
    await page.waitForTimeout(1200);
    const t = turnsOf(await ig(), 'markers');
    const m3 = await read(page, 'markers.get');
    R.check('markers: skip path records "skip" and closes the chapter', t.values.has === 'skip' && !(await cardState(page)), JSON.stringify(t.values).slice(0, 120));
    R.check('markers: after "skip", markers.get current is empty (plans start from typical values) — or the screen says the saved values still count', (m3.current?.length ?? Object.keys(m3.current ?? {}).length) === 0 || /still|kept|saved values/i.test(await mainText(page)), `current=${JSON.stringify(m3.current).slice(0, 120)}`);
    await shot(page, 'J1', 'markers-skipped');
    // back to the typed values for the rest of the journey (that question is answered, so the chapter stays done)
    await page.getByRole('button', { name: /^Change: Do you have results from a recent blood test/ }).first().click();
    await card(page).locator('.lm-ik-turn__answers button').filter({ hasText: /^Type the values/ }).click();
    await page.waitForTimeout(1200);
    R.check('markers: switching back to "Type the values" keeps the chapter done', !(await cardState(page)), JSON.stringify(await cardState(page)));
  } else {
    await changeTests(ch);
  }
  await onScreen(`${ch.id}/after-changes`);
  R.check(`${ch.id}: no horizontal overflow`, (await overflowPx(page)) <= 0, String(await overflowPx(page)));
}

/* ------------------------------------------------------------------ summary card */
await go(page, '/onboarding/summary?from=setup');
await page.locator('.lm-ik-summary__face').waitFor({ timeout: 10000 }).catch(() => undefined);
await onScreen('summary');
const sumTxt = await mainText(page);
R.check('summary: lists every chapter with a change key', ['a normal day', 'training', 'food', 'blood markers', 'devices'].every((c) => sumTxt.includes(c)) && (await page.getByRole('link', { name: /^Change / }).or(page.getByRole('button', { name: /^Change / })).count()) >= 5, '');
R.check('summary: no "asked later · nothing" row', !/asked later\s*·?\s*nothing/i.test(sumTxt), '');
for (const [w, h] of [[1440, 900], [768, 1024]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  const ins = await summaryInsets(page);
  console.log(`summary ${w}`, JSON.stringify(ins));
  const pad = w >= 1024 ? 20 : 16;
  const ok = ins && !ins.missing && ins.keyLeft >= pad && Math.abs(ins.keyLeft - ins.rowTextLeft) <= 1 && Math.abs(ins.keyLeft - ins.titleLeft) <= 1 && ins.keyBottom >= pad - 2 && ins.keyTopBelowRule >= 16;
  R.check(`summary ${w}: footer key inset ${ins?.keyLeft}px left / ${ins?.keyBottom}px bottom / ${ins?.keyTopBelowRule}px below the rule, aligned with rows (${ins?.rowTextLeft}) and title (${ins?.titleLeft})`, ok, JSON.stringify(ins));
  if (w === 1440) await shot(page, 'J1', 'summary-1440');
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'Looks right — continue' }).click();
await page.waitForTimeout(2000);
await onScreen('after-summary');
R.check('summary: "Looks right — continue" leaves the intake', !/onboarding/.test(page.url()), page.url());
const fin = await ig();
R.check('intake.get: nothing missing at the end', (fin.missing ?? []).length === 0, JSON.stringify(fin.missing));

/* ------------------------------------------------------------------ totals */
R.check(`forbidden-text scan clean on ${screens.size} screens`, forbidden.length === 0, forbidden.join(' || '));
R.check('no console or page errors', errors.length === 0, errors.join(' | '));
const rowsOut = R.save();
console.table(perQuestion.map((r) => ({ q: r.q, back: r.back ?? '-', ret: r.return, later: r.later, stored: r.stored, row: (r.row ?? '').slice(0, 30) })));
const failed = rowsOut.filter((r) => !r.ok);
console.log(`J1 desktop: ${rowsOut.length - failed.length}/${rowsOut.length} checks passed in ${Math.round((Date.now() - t0) / 1000)} s`);
await closeAll();
process.exit(failed.length ? 1 : 0);
