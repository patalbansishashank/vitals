// J1 helpers: first run (welcome → screening → consent → body), the open question card, per-chapter answer strategies,
// the blood-marker paths and layout measurements. Used by j1-intake.mjs (desktop, every probe) and j1-viewports.mjs.
import fs from 'node:fs';
import { ROOT, go, read, mainText, scanForbidden, shot } from './lib.mjs';

export const CHAPTERS = [
  { id: 'activity', path: '/onboarding/activity', section: 'activity', title: 'A normal day' },
  { id: 'training', path: '/onboarding/training', section: 'training', title: 'Training and equipment' },
  { id: 'food', path: '/onboarding/diet', section: 'diet', title: 'Food and kitchen' },
  { id: 'markers', path: '/onboarding/markers', section: 'markers', title: 'Blood markers' },
  { id: 'devices', path: '/onboarding/devices', section: 'devices', title: 'Devices and data' },
];
export const MARKERS_6 = { 'LDL cholesterol': 162, 'HDL cholesterol': 42, triglycerides: 180, HbA1c: 5.8, creatinine: 1.0, eGFR: 95, ferritin: 45, TSH: 2.5, 'vitamin D (25-OH)': 18 };
export const MARKER_IDS_6 = ['ldl', 'hdl', 'tg', 'hba1c', 'creatinine', 'egfr', 'ferritin', 'tsh', 'vitD'];

const CARD = 'main fieldset.lm-ik-card';
export const card = (page) => page.locator(CARD);

/** The open question card (or null): id, kind, position text, parent chip, prompt, footer keys. */
export function cardState(page) {
  return page.evaluate((sel) => {
    const f = document.querySelector(sel);
    if (!f) return null;
    const foot = [...f.querySelectorAll(':scope > .lm-ik-card__foot button')].map((b) => ({ t: b.innerText.trim(), dis: b.getAttribute('aria-disabled') === 'true' || b.disabled }));
    return {
      id: f.id.replace(/^ik-/, ''),
      kind: f.dataset.kind,
      changing: f.dataset.changing === 'true',
      count: f.querySelector('.lm-ik-card__count')?.innerText.trim() ?? '',
      chip: f.querySelector('.lm-ik-chip-parent')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      prompt: f.querySelector('legend')?.innerText.trim() ?? '',
      foot,
    };
  }, CARD);
}

/** Waits until the open card differs from `prevId` (or disappears); returns the new state. */
export async function nextCard(page, prevId, ms = 6000) {
  const t0 = Date.now();
  let st = await cardState(page);
  while (Date.now() - t0 < ms) {
    if (!st || st.id !== prevId) return st;
    await page.waitForTimeout(150);
    st = await cardState(page);
  }
  return st;
}

/** The answered rows: [{ q, a, later, notUsed }]. */
export const rows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('main .lm-ik-row-a')].map((r) => ({
      q: r.querySelector('.lm-ik-row-a__q')?.innerText.trim() ?? '',
      a: r.querySelector('.lm-ik-row-a__a')?.innerText.trim() ?? '',
      later: r.dataset.later === 'true',
      notUsed: r.dataset.notUsed === 'true',
    })),
  );

export const turnsOf = (ig, section) => ig.sections?.[section]?.turns ?? { values: {}, status: {} };

/** Forbidden-text scan of the current screen; returns hits with the route. */
export async function scan(page, label, bag) {
  const hits = scanForbidden(await mainText(page));
  if (hits.length) bag.push(`${label}: ${hits.join(' ; ')}`);
  return hits;
}

/** Horizontal overflow of the document (px beyond the viewport). */
export const overflowPx = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** welcome → Get started → screening (no / 18–64 to everything, incl. follow-ups) → consent → body basics → shape. */
export async function firstRun(page, body = { age: 34, height: 176, weight: 84 }, onScreen = async () => {}) {
  await go(page, '/welcome');
  await onScreen('welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.waitForURL(/step=screening/);
  for (let i = 0; i < 20; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      for (const f of document.querySelectorAll('main fieldset')) {
        if (f.querySelector('[aria-pressed=true],[aria-checked=true]')) continue;
        const b = [...f.querySelectorAll('button')].find((x) => x.innerText.trim() === 'no' || x.innerText.trim() === '18–64');
        if (b) {
          b.click();
          c++;
        }
      }
      return c;
    });
    await page.waitForTimeout(400);
    // follow-up questions render after an answer: stop only when nothing is left and Continue is enabled
    if (!n && await page.getByRole('button', { name: 'Continue', exact: true }).isEnabled().catch(() => false)) break;
  }
  await onScreen('screening');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL(/step=consent/);
  await onScreen('consent');
  await page.getByRole('checkbox', { name: 'I understand' }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL(/\/body/);
  await page.waitForTimeout(800);
  await page.locator('main button').filter({ hasText: /^male$/ }).click();
  for (const [name, v] of [['age', body.age], ['height', body.height], ['weight', body.weight]]) {
    const el = page.getByRole('spinbutton', { name }).first();
    await el.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(String(v));
    await page.keyboard.press('Tab');
  }
  await page.waitForTimeout(400);
  await onScreen('body-basics');
  await page.getByRole('button', { name: 'Next: shape' }).click();
  await page.waitForTimeout(1200);
  await onScreen('body-shape');
  await page.getByRole('button', { name: 'Next: a normal day' }).click();
  await page.waitForURL(/onboarding\/activity/);
  await page.locator(CARD).waitFor();
}

/** Select (native on touch/narrow screens, a listbox popover on desktop): choose `label` in the field named `name`. */
export async function pickSelect(page, scope, name, label) {
  const native = scope.locator(`select[aria-label="${name}"]`);
  if (await native.count()) return native.selectOption({ label });
  await scope.getByRole('combobox', { name, exact: true }).or(scope.getByRole('button', { name, exact: true })).first().click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

const clickIn = async (page, re, scope = `${CARD} .lm-ik-turn__answers`) => {
  const b = page.locator(`${scope} button`).filter({ hasText: re }).first();
  await b.click();
  await page.waitForTimeout(200);
};
const clickDone = (page) => clickIn(page, /^Done/);

/**
 * Answers the open card with the journey's choice for that question (`variant`: 'rich' = the desktop journey's
 * specific answers; 'defaults' = the quickest valid answer). Returns a short note of what was chosen.
 */
export async function answer(page, st, variant = 'rich') {
  const id = st.id;
  const rich = variant === 'rich';
  const f = card(page);
  switch (id) {
    case 'work': await clickIn(page, /^yes$/); return 'yes';
    case 'workTime': await clickIn(page, /^8 h/); return '8 h';
    case 'sport': await clickIn(page, /^none$/); return 'none';
    case 'sleep': await clickIn(page, /^23:00–07:00/); return '23–07';
    case 'measuredEver':
      if (rich) { await clickIn(page, /^yes, my resting energy/); return 'yes resting'; }
      await clickIn(page, /^no/); return 'no';
    case 'measured': {
      await f.getByRole('spinbutton', { name: 'measured figure' }).fill('1720');
      await clickIn(page, /^breath test/);
      await pickSelect(page, f, 'month', 'March');
      await pickSelect(page, f, 'year', '2026');
      await clickIn(page, /^Save$/);
      return '1720 kcal cart Mar 2026';
    }
    case 'willing': case 'kit': case 'time': case 'models': case 'streams': await clickDone(page); return 'Done';
    case 'where': await clickIn(page, /^home$/); await clickDone(page); return 'home';
    case 'injuries': case 'conditions': await clickIn(page, /^none$/); await clickDone(page); return 'none';
    case 'wontDo': await clickIn(page, /^nothing$/); await clickDone(page); return 'nothing';
    case 'eat': await clickIn(page, /^vegetarian \(with dairy\)/); await clickDone(page); return 'vegetarian';
    case 'allergies': await clickIn(page, /^none$/); await clickDone(page); return 'none';
    case 'rules': await clickIn(page, /^none$/); await clickDone(page); return 'none';
    case 'food.cuisines': {
      if (rich) {
        await f.getByRole('searchbox').fill('kerala');
        await page.waitForTimeout(300);
        await f.getByRole('button', { name: 'Kerala', exact: true }).or(f.getByRole('checkbox', { name: 'Kerala', exact: true })).first().click();
        await f.getByRole('button', { name: 'Clear search' }).click().catch(() => undefined);
      }
      await clickDone(page);
      return rich ? 'Kerala' : 'none';
    }
    case 'food.equipment': await clickDone(page); return 'region defaults';
    case 'food.staples': case 'food.pantry': {
      if (rich) {
        const list = id === 'food.staples' ? 'ragi flour\nbasmati rice, toor dal\nghee\nquinoa\nzzqx widget powder' : 'paneer, spinach, cheddar cheese, bhindi';
        await f.getByRole('button', { name: /Paste a list/ }).click();
        await f.locator('.lm-pk__paste-body textarea').fill(list);
        await f.getByRole('button', { name: 'Read the list' }).click();
        await page.waitForTimeout(500);
        await f.getByRole('button', { name: /^Add \d+ items?/ }).click();
        await page.waitForTimeout(200);
        await clickDone(page);
        return 'defaults + pasted list';
      }
      if (id === 'food.pantry') { await f.locator('button').filter({ hasText: /^Skip this list$/ }).first().click(); return 'Skip this list'; }
      await clickDone(page);
      return 'defaults';
    }
    case 'supplements':
      if (rich) { await clickIn(page, /^I already take some/); return 'taking'; }
      await clickIn(page, /^I’d rather get everything from food/); return 'food first';
    case 'taking': {
      for (const name of ['Creatine monohydrate', 'Whey protein', 'Vitamin D3']) await f.getByRole('button', { name, exact: true }).click();
      const row = (n) => f.locator('.lm-supprow').filter({ has: page.getByRole('button', { name: 'Remove ' + n, exact: true }) });
      await f.getByLabel('Creatine monohydrate dose, grams').fill('5');
      await f.getByRole('button', { name: 'Creatine monohydrate in the morning' }).click();
      await f.getByLabel('Vitamin D3 dose, international unit').fill('2000');
      await f.getByRole('button', { name: 'Vitamin D3 in the morning' }).click();
      await row('Whey protein').getByRole('radio', { name: 'have it, don’t take' }).click();
      await page.waitForTimeout(200);
      await clickDone(page);
      return 'creatine 5 g am, D3 2000 IU am, whey at home';
    }
    case 'has':
      if (st.prompt.startsWith('Do you wear')) { await clickIn(page, /^ring$/); await clickDone(page); return 'ring'; }
      await clickIn(page, rich ? /^Type the values/ : /^No, skip this chapter/);
      return rich ? 'manual' : 'skip';
    case 'manual': return enterMarkers(page);
    case 'routes': await clickIn(page, /^Later$/); return 'later';
    default: break;
  }
  // generic: single = the default option, else the first; multi = first + Done; number = default preset; custom = Done
  if (st.kind === 'single') {
    const d = page.locator(`${CARD} .lm-ik-turn__answers button`).filter({ hasText: /default/ });
    if (await d.count()) { await d.first().click(); return 'default'; }
    await page.locator(`${CARD} .lm-ik-turn__answers button`).first().click();
    return 'first';
  }
  if (st.kind === 'number') {
    const d = page.locator(`${CARD} .lm-ik-turn__answers button`).filter({ hasText: /default/ });
    await (await d.count() ? d.first() : page.locator(`${CARD} .lm-ik-turn__answers button`).first()).click();
    return 'preset';
  }
  if (st.kind === 'multi') { await page.locator(`${CARD} .lm-ik-turn__answers button`).first().click(); await clickDone(page); return 'first'; }
  await clickDone(page);
  return 'Done';
}

/** Manual marker table: ≥ 6 markers across five groups; Save. */
export async function enterMarkers(page) {
  const f = card(page);
  for (const g of ['sugar', 'kidney and salts', 'thyroid', 'blood and iron', 'vitamins']) {
    const k = f.getByRole('button', { name: new RegExp(`^${g} · `) });
    if ((await k.getAttribute('aria-expanded')) !== 'true') await k.click();
  }
  for (const [k, v] of Object.entries(MARKERS_6)) {
    const i = f.getByLabel(`${k}, value`, { exact: true });
    await i.fill(String(v));
    await i.press('Tab');
  }
  await page.waitForTimeout(300);
  await f.getByRole('button', { name: /^Save \d+ values/ }).click();
  return `${Object.keys(MARKERS_6).length} values`;
}

/** Reads a fixture's expectation. */
export const expected = (name) => JSON.parse(fs.readFileSync(`${ROOT}/qa/fixtures/markers/${name}.expected.json`, 'utf8'));

/** Uploads a report and waits for the review table or a message; returns { text, rows: [{id, value, unit, ticked}] }. */
export async function uploadReport(page, file) {
  await page.locator('main input[type=file]').setInputFiles(`${ROOT}/qa/fixtures/markers/${file}`);
  let text = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    text = await card(page).innerText().catch(() => '');
    if (/Confirm what Vitals read|needs an AI provider|no text Vitals can read|doesn't look like|couldn.t be read/i.test(text)) break;
  }
  await page.waitForTimeout(500);
  text = await card(page).innerText().catch(() => text);
  const rowsRead = await page.evaluate(() =>
    [...document.querySelectorAll('main fieldset.lm-ik-card input[type=checkbox][aria-label^="Use "]')].map((c) => ({ label: c.getAttribute('aria-label'), ticked: c.checked })),
  );
  return { text, rowsRead };
}

/** Summary card insets (px) from bounding boxes. */
export const summaryInsets = (page) =>
  page.evaluate(() => {
    const face = document.querySelector('.lm-ik-summary__face');
    if (!face) return null;
    const F = face.getBoundingClientRect();
    const foot = face.querySelector('.lm-face-foot')?.getBoundingClientRect();
    const key = face.querySelector('.lm-ik-summary__go')?.getBoundingClientRect();
    const dt = face.querySelector('dt')?.getBoundingClientRect();
    const title = face.querySelector('h2')?.getBoundingClientRect();
    const lastRow = [...face.querySelectorAll('dd')].pop()?.getBoundingClientRect();
    const r = (x) => Math.round(x * 10) / 10;
    if (!foot || !key) return { missing: !foot ? 'footer' : 'key' };
    return {
      card: { left: r(F.left), width: r(F.width) },
      keyLeft: r(key.left - F.left),
      keyRight: r(F.right - key.right),
      keyBottom: r(F.bottom - key.bottom),
      keyTopBelowRule: r(key.top - foot.top),
      ruleBelowLastRow: lastRow ? r(foot.top - lastRow.bottom) : null,
      rowTextLeft: dt ? r(dt.left - F.left) : null,
      titleLeft: title ? r(title.left - F.left) : null,
      titleTop: title ? r(title.top - F.top) : null,
      keyWidth: r(key.width),
    };
  });

/** Progress bar position against the header row / page column. */
export const progressBox = (page) =>
  page.evaluate(() => {
    const p = document.querySelector('.lm-ik-progress');
    if (!p) return null;
    const P = p.getBoundingClientRect();
    const h1 = document.querySelector('main h1, h1')?.getBoundingClientRect();
    const col = p.parentElement.getBoundingClientRect();
    const skip = [...document.querySelectorAll('main button, header button')].find((b) => b.innerText.trim() === 'Skip this part')?.getBoundingClientRect();
    const lastRight = Math.max(P.right, skip ? skip.right : 0);
    const r = (x) => Math.round(x * 10) / 10;
    return {
      viewport: window.innerWidth,
      left: r(P.left), right: r(P.right), width: r(P.width),
      colLeft: r(col.left), colRight: r(col.right),
      gapLeft: r(P.left - col.left), gapRight: r(col.right - P.right),
      centreOffset: r((P.left + P.right) / 2 - (col.left + col.right) / 2),
      sameRowAsTitle: h1 ? Math.abs(P.top - h1.top) < 24 || (P.top < h1.bottom && P.bottom > h1.top) : null,
      belowTitle: h1 ? P.top >= h1.bottom - 1 : null,
      skipGap: skip ? r(skip.left - P.right) : null,
      rowEndGap: r(col.right - lastRight),
      valueText: p.getAttribute('aria-valuetext'),
    };
  });

export { go, read, shot };
