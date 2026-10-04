// Q3 journey 1 at mobile 390×844 and tablet 768×1024 (no AI provider): the whole first run with quick default answers,
// checking on every screen: no horizontal overflow, the forbidden-text scan, no console/page errors; the progress bar
// position (centred under the title on mobile, right-aligned on the title row on tablet); the summary card footer
// insets. Mobile takes the blood-markers skip path and "Skip this list" on the pantry; tablet uploads a report with a
// page that has no text (hospital-si.pdf) and a photo, both without a provider, and checks the honest messages.
//   BASE=http://127.0.0.1:5191 node qa/scripts/Q3/j1-viewports.mjs
import { fresh, results, closeAll, mainText, shot } from './lib.mjs';
import { CHAPTERS, answer, card, cardState, expected, firstRun, go, nextCard, overflowPx, progressBox, read, rows, scan, summaryInsets, turnsOf, uploadReport } from './j1-lib.mjs';

const R = results('J1v');
const t0 = Date.now();

async function walk(vp) {
  const { ctx, page, errors } = await fresh(vp);
  const forbidden = [];
  const overflow = [];
  let screens = 0;
  const onScreen = async (label) => {
    screens++;
    await scan(page, `${vp} ${label}`, forbidden);
    const o = await overflowPx(page);
    if (o > 0) overflow.push(`${label}: ${o}px`);
  };
  await firstRun(page, { age: 41, height: 162, weight: 70 }, onScreen);

  // progress bar position on the first chapter (open question)
  const p = await progressBox(page);
  console.log(`progress ${vp}`, JSON.stringify(p));
  if (vp === 'mobile') {
    R.check(`progress ${vp}: own row under the title, centred, ≤ 360 wide (offset ${p?.centreOffset}px, width ${p?.width}, gaps ${p?.gapLeft}/${p?.gapRight})`, p && p.belowTitle && Math.abs(p.centreOffset) <= 1 && p.width <= 360, JSON.stringify(p));
  } else {
    R.check(`progress ${vp}: on the title row, right-aligned (row ends ${p?.rowEndGap}px from the column edge), width ${p?.width}`, p && p.sameRowAsTitle && p.rowEndGap <= 32 && p.width >= 350 && p.width <= 440 /* 360 in design §2; 420 since Q6 e6b19bd so labels fit */ && p.centreOffset > 0, JSON.stringify(p));
  }
  await shot(page, 'J1', `${vp}-chapter-a`);

  for (const ch of CHAPTERS) {
    if (!page.url().includes(ch.path)) await go(page, ch.path);
    await page.locator('main h1').waitFor();
    let n = 0;
    for (let guard = 0; guard < 40; guard++) {
      const st = await cardState(page);
      if (!st) break;
      await onScreen(`${ch.id}/${st.id}`);
      if (ch.id === 'markers' && st.id === 'has') {
        if (vp === 'mobile') {
          await card(page).locator('.lm-ik-turn__answers button').filter({ hasText: /^No, skip this chapter/ }).click();
        } else {
          await card(page).locator('.lm-ik-turn__answers button').filter({ hasText: /^Let the Coach read my report/ }).click();
        }
        await nextCard(page, 'has');
        continue;
      }
      if (st.id === 'report') {
        // a photo without a provider: an honest message, no pretend reading
        const ph = await uploadReport(page, 'photo-report.png');
        await onScreen('markers/photo');
        R.check(`${vp} markers: a photo without a provider says it needs one (no pretend reading, no endless "reading")`, /needs an AI provider/i.test(ph.text) && ph.rowsRead.length === 0, ph.text.slice(0, 200));
        // a PDF with a page that has no text: rows from the text pages, the textless page reported honestly
        const exp = expected('hospital-si');
        const up = await uploadReport(page, 'hospital-si.pdf');
        await onScreen('markers/review');
        await shot(page, 'J1', `${vp}-markers-hospital`);
        const NAME = { hb: 'haemoglobin', fpg: 'fasting glucose', hba1c: 'HbA1c', ldl: 'LDL cholesterol', hdl: 'HDL cholesterol', tg: 'triglycerides', creatinine: 'creatinine', egfr: 'eGFR', urate: 'uric acid', sodium: 'sodium', potassium: 'potassium', alt: 'ALT (SGPT)', ast: 'AST (SGOT)', tsh: 'TSH', ft3: 'free T3', b12: 'vitamin B12', vitD: 'vitamin D (25-OH)', hsCrp: 'hs-CRP', testosterone: 'testosterone (total)' };
        const hit = exp.tierA.filter((m) => up.rowsRead.some((r) => r.label.startsWith(`Use ${NAME[m.markerId]}, ${m.value} `)));
        const imgRead = exp.imageOnly.filter((m) => up.rowsRead.some((r) => r.label.includes(`, ${m.value} `)));
        R.check(`${vp} markers: hospital-si.pdf (SI units) read on the device: ${hit.length}/${exp.tierA.length} text-layer markers with the report's values, none of the ${exp.imageOnly.length} image-only values invented, all unticked`, hit.length === exp.tierA.length && imgRead.length === 0 && up.rowsRead.every((r) => !r.ticked), up.rowsRead.map((r) => r.label).join(' | ').slice(0, 300));
        R.check(`${vp} markers: the page without text is reported honestly (needs a provider / could not be read)`, /couldn.t be read|could not be read|no text|needs an AI provider|without text/i.test(up.text), up.text.match(/[^\n]*(page|provider)[^\n]*/gi)?.slice(0, 3).join(' / ') ?? '');
        await card(page).getByRole('button', { name: /^Tick all high-confidence/ }).click();
        await card(page).getByRole('button', { name: /^Save \d+ confirmed values/ }).click();
        await page.waitForTimeout(1500);
        const m = await read(page, 'markers.get');
        R.check(`${vp} markers: confirmed values saved (provenance pdf)`, (m.doc?.readings ?? []).filter((r) => r.provenance === 'pdf').length > 0, String((m.doc?.readings ?? []).length));
        continue;
      }
      try {
        await answer(page, st, 'defaults');
      } catch (e) {
        R.check(`${vp} ${ch.id}/${st.id}: answerable`, false, e.message.split('\n')[0]);
        break;
      }
      await nextCard(page, st.id, 8000);
      n++;
    }
    await onScreen(`${ch.id}/end`);
    const t = turnsOf(await read(page, 'intake.get'), ch.section);
    const open = Object.entries(t.status ?? {}).filter(([, s]) => s !== 'answered').map(([k]) => k);
    R.check(`${vp} ${ch.id}: chapter done (${n} answered, none open)`, !(await cardState(page)) && open.length === 0, `open=${open.join(',')}`);
    if (ch.id === 'food' && vp === 'mobile') {
      const pantry = (await rows(page)).find((r) => r.q.startsWith('What’s in your kitchen right now'));
      R.check(`${vp} food: "Skip this list" on the pantry is recorded as answered "skipped, by choice", not asked later`, pantry && !pantry.later && /skipped, by choice/.test(pantry.a) && t.status['food.pantry'] === 'answered', JSON.stringify(pantry));
    }
    if (ch.id === 'markers' && vp === 'mobile') {
      R.check(`${vp} markers: skip path stores "skip" and no readings`, t.values.has === 'skip' && ((await read(page, 'markers.get')).doc?.readings ?? []).length === 0, JSON.stringify(t.values).slice(0, 100));
    }
  }

  await go(page, '/onboarding/summary?from=setup');
  await page.locator('.lm-ik-summary__face').waitFor({ timeout: 10000 }).catch(() => undefined);
  await onScreen('summary');
  const ins = await summaryInsets(page);
  console.log(`summary ${vp}`, JSON.stringify(ins));
  const pad = 16;
  R.check(`${vp} summary: footer key inset ${ins?.keyLeft}px left / ${ins?.keyRight}px right / ${ins?.keyBottom}px bottom / ${ins?.keyTopBelowRule}px below the rule; rows at ${ins?.rowTextLeft}px`, ins && !ins.missing && ins.keyLeft >= pad && Math.abs(ins.keyLeft - ins.rowTextLeft) <= 1 && ins.keyBottom >= pad && ins.keyTopBelowRule >= 16 && (vp !== 'mobile' || Math.abs(ins.keyLeft - ins.keyRight) <= 1), JSON.stringify(ins));
  const sum = await mainText(page);
  R.check(`${vp} summary: no "asked later · nothing" row`, !/asked later\s*·?\s*nothing/i.test(sum), '');
  if (vp === 'mobile') R.check(`${vp} summary: blood markers row reads "skipped"`, /blood markers\s*\n?\s*skipped/i.test(sum), sum.match(/blood markers[^\n]*\n[^\n]*/)?.[0]);
  await shot(page, 'J1', `${vp}-summary`);
  await page.getByRole('button', { name: 'Looks right — continue' }).click();
  await page.waitForTimeout(2000);
  await onScreen('after-summary');
  R.check(`${vp}: "Looks right — continue" leaves the intake`, !/onboarding/.test(page.url()), page.url());
  R.check(`${vp}: no horizontal overflow on ${screens} screens`, overflow.length === 0, overflow.join(' | '));
  R.check(`${vp}: forbidden-text scan clean on ${screens} screens`, forbidden.length === 0, forbidden.join(' || '));
  R.check(`${vp}: no console or page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

for (const vp of ['mobile', 'tablet']) {
  try {
    await walk(vp);
  } catch (e) {
    R.check(`${vp}: walk completes`, false, e.message.split('\n')[0] + ' @' + (e.stack.match(/j1-(viewports|lib).mjs:\d+/g) ?? []).join(','));
  }
}
const out = R.save();
const failed = out.filter((r) => !r.ok);
console.log(`J1 viewports: ${out.length - failed.length}/${out.length} checks passed in ${Math.round((Date.now() - t0) / 1000)} s`);
await closeAll();
process.exit(failed.length ? 1 : 0);
