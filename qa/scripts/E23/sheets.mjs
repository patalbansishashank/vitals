// E23 sheet pass: opens every remaining sheet / side panel / dialog at 390, 768 and 1440 px in both themes on the seeded
// profile (run seed.mjs first), screenshots the overlay into qa/screenshots/E23-<sheet>-<width>-<theme>.png and measures
// its spacing (content inset from the panel edges, head / foot padding) into .e6-tmp/e23-sheets.json.
// usage: node qa/scripts/E23/sheets.mjs [sheet ids…]   (BASE defaults to the preview on :5188)
import { writeFileSync } from 'node:fs';
import { open, go, ROOT } from './lib.mjs';

const btn = (name) => (page) => page.getByRole('button', { name, exact: typeof name === 'string' }).first().click();
const menu = (item) => async (page) => {
  await page.getByRole('button', { name: /^(Today menu)$/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: item }).click();
};
export const SHEETS = {
  start: ['/simulate/starter/schedule', async (page) => {
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.getByRole('button', { name: /Start this plan|Replace active plan/ }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: /Start this plan|Replace active plan/ }).first().click();
  }],
  busy: ['/today', menu(/busy or away/)],
  checkin: ['/today', menu(/Check in now/)],
  pause: ['/today', menu(/Pause plan/)],
  row: ['/today', btn('More for breakfast')],
  meal: ['/food', btn('I ate something else: breakfast')],
  otherfood: ['/food', btn('Log other food')],
  recipe: ['/food', btn('Open breakfast details')],
  swap: ['/train', btn(/^Swap /)],
  session: ['/train', btn('I did something else')],
  measure: ['/progress', btn('Add a measurement')],
  import: ['/settings', async (page) => {
    await page.locator('section:has(h2:text("Your data")) input[type=file]').first().setInputFiles(`${ROOT}/qa/fixtures/q1b/export-m-veg.json`);
  }],
  erase: ['/settings', btn('Reset everything')],
  // Food side panels (wrapped by E23) and sheets outside living mode (checked, not changed unless they measure 0)
  nobenefit: ['/food', btn('Things that won’t help your goals')],
  habits: ['/body', btn(/^Edit$/)],
  labs: ['/body', btn('Add values')],
  goals: ['/plan/goals', btn('Add a goal')],
  explain: ['/simulate/starter/results', btn('Fat mass: explain')],
};

/** The top-most open overlay and its spacing. */
async function measure(page) {
  return page.evaluate(() => {
    const cands = [...document.querySelectorAll('dialog[open], .lm-sidepanel[data-mode], [role=dialog], [role=alertdialog]')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const el = cands.at(-1);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const px = (e, p) => (e ? getComputedStyle(e)[p] : null);
    const head = el.querySelector('.lm-panel__head, .lm-dialog__head');
    const foot = el.querySelector('.lm-panel__foot, .lm-dialog__foot');
    const body = el.querySelector('.lm-panel__body, .lm-dialog__body') ?? el;
    // leaf content: text-bearing or control elements inside the body, visible
    const leaves = [...body.querySelectorAll('p, h2, h3, h4, label, legend, button, input, select, textarea, li, span, dt, dd, td, th, a')].filter((e) => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden' || st.position === 'fixed') return false;
      return r.bottom > box.top && r.top < box.bottom;
    });
    const b = body.getBoundingClientRect();
    let minL = Infinity, minR = Infinity, minT = Infinity;
    let worst = '';
    for (const e of leaves) {
      const r = e.getBoundingClientRect();
      const l = r.left - b.left, rr = b.right - r.right;
      if (l < minL) { minL = l; if (l < 12) worst = `${e.tagName.toLowerCase()}.${e.className}`.slice(0, 80); }
      if (rr < minR) minR = rr;
      if (r.top - b.top < minT) minT = r.top - b.top;
    }
    return {
      kind: el.classList.contains('lm-sheet') ? 'sheet' : el.classList.contains('lm-sidepanel') ? 'side' : el.classList.contains('lm-dialog') ? 'dialog' : el.tagName.toLowerCase() + '.' + el.className,
      title: (el.querySelector('.lm-panel__title, .lm-dialog__title, h2')?.textContent ?? '').trim().slice(0, 60),
      w: Math.round(box.width), h: Math.round(box.height),
      headPad: px(head, 'padding'), footPad: px(foot, 'padding'), bodyPad: px(body, 'padding'),
      insetL: Math.round(minL), insetR: Math.round(minR), insetT: Math.round(minT), worst,
      overflowX: body.scrollWidth > body.clientWidth + 1,
      first: [...body.children].map((c) => `${c.tagName.toLowerCase()}.${c.className}`.slice(0, 60)).join(' + '),
    };
  });
}

const only = process.argv.slice(2);
const out = [];
const WS = (process.env.E23_W || '390,768,1440').split(',').map(Number);
const THEMES = (process.env.E23_THEME || 'light,dark').split(',');
for (const w of WS) {
  for (const theme of THEMES) {
    const { ctx, page, errors } = await open(w, theme);
    for (const [id, [route, opener]] of Object.entries(SHEETS)) {
      if (only.length && !only.includes(id)) continue;
      try {
        await go(page, route);
        await opener(page);
        await page.waitForTimeout(900);
        const m = await measure(page);
        const file = `qa/screenshots/E23-${id}-${w}-${theme}.png`;
        await page.screenshot({ path: `${ROOT}/${file}` });
        out.push({ id, w, theme, file, ...m });
        console.log(id, w, theme, JSON.stringify(m));
      } catch (e) {
        out.push({ id, w, theme, error: String(e.message).split('\n')[0] });
        console.log(id, w, theme, 'ERROR', String(e.message).split('\n')[0]);
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
    if (errors.length) console.log('page errors', errors);
    await ctx.close();
  }
}
writeFileSync(`${ROOT}/.e6-tmp/e23-sheets${only.length ? '-' + only.join('-') : ''}.json`, JSON.stringify(out, null, 1));
