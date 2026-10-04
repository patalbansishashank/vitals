// Seeds a profile through the real first-run UI: screening, consent, body, goals, plan search, Start.
// usage: node qa/scripts/Q4/seed.mjs [stopAfter]   → profile .e6-tmp/q4-profiles/seed-<stage>
import { openProfile, go, dump, mainText, sleep, btn, read } from './lib.mjs';
const stop = process.argv[2] || 'all';
export async function screening(page) {
  await go(page, '/welcome');
  await btn(page, 'Get started').first().click(); await sleep(1000);
  await btn(page, '18–64').click();
  for (let r = 0; r < 5; r++) { const l = btn(page, 'no'); const n = await l.count(); let c = 0; for (let i = 0; i < n; i++) if ((await l.nth(i).getAttribute('aria-checked')) !== 'true') { await l.nth(i).click(); c++; await sleep(150); } if (!c) break; }
  await btn(page, 'Continue').first().click(); await sleep(1500);
  await page.locator('main input[type=checkbox]').first().check(); await btn(page, 'Continue').first().click(); await sleep(2000);
}
export async function body(page) {
  await btn(page, 'male').click();
  const t = page.locator('main input[type=text]');
  for (const [i, v] of [[0, '35'], [1, '175'], [2, '92']]) { await t.nth(i).click(); await page.keyboard.press('Control+a'); await page.keyboard.type(v, { delay: 30 }); await page.keyboard.press('Tab'); await sleep(200); }
  await btn(page, 'Next: shape').first().click(); await sleep(1500);
  await btn(page, 'Skip for now').first().click(); await sleep(1500);
}
// A real provider instead of the scripted model: Q4_REAL_PRESET=<preset id> Q4_REAL_KEY=<key> [Q4_REAL_MODEL=<id>]
// (the key is typed into the page's key vault, never printed). Default: the scripted model on Q4_FAKE_URL.
export const REAL = process.env.Q4_REAL_PRESET || null;
export const FAKE_KEY = process.env.Q4_REAL_KEY || 'q4-fake-key-DO-NOT-ECHO-7731';
export const FAKE_URL = process.env.Q4_FAKE_URL || 'http://127.0.0.1:4192/v1';
/** Settings › AI provider: custom OpenAI-chat endpoint (the scripted model), a key, the model id, Test connection, Save. */
export async function provider(page) {
  await go(page, '/settings/ai'); await sleep(1000);
  if (REAL) {
    await page.locator(`input[type=radio][value="${REAL}"]`).check(); await sleep(400);
    if (await page.locator('input[type=password]').count()) { await page.locator('input[type=password]').first().fill(FAKE_KEY); await btn(page, 'Save key').click(); await sleep(800); }
    if (process.env.Q4_REAL_MODEL) await page.getByLabel('model id', { exact: true }).fill(process.env.Q4_REAL_MODEL);
  } else {
    await page.locator('input[type=radio][value=custom]').check(); await sleep(400);
    await page.getByLabel('base URL').fill(FAKE_URL); await sleep(200);
    await btn(page, 'OpenAI chat').click(); await sleep(500);
    await page.locator('input[type=password]').first().fill(FAKE_KEY); await btn(page, 'Save key').click(); await sleep(800);
    await page.getByLabel('model id', { exact: true }).fill('q4-scripted'); await sleep(200);
  }
  await btn(page, 'Test connection').click(); await sleep(4000);
  await btn(page, 'Save provider').click(); await sleep(1500);
}
export async function seedBase() {
  const { page, errors, close } = await openProfile('seed-base');
  let ok = true;
  try { await screening(page); await body(page); await provider(page); } catch (e) { ok = false; console.log('seed', e.message.split('\n')[0]); }
  await close();
  return ok && errors.length === 0;
}
if (process.argv[1]?.endsWith('seed.mjs')) {
  const { page, errors, close } = await openProfile('seed-base');
  try {
    await screening(page);
    await body(page);
    await provider(page);
    const cfg = await read(page, 'settings.get', {});
    console.log('settings ai:', JSON.stringify(cfg.aiProvider ?? cfg).slice(0, 400));
    const t = await mainText(page); console.log(t.slice(t.indexOf('AI provider'), t.indexOf('AI provider') + 500));
  } catch (e) { console.log('ERR', e.message.split('\n')[0]); await dump(page, 'err'); }
  console.log('ERRORS', errors);
  await close();
}
