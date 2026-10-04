// Seeds the Q6 "companion" profile: a copy of "full" paired with a local Companion (proxy role) on :4894 whose
// config dir is .e6-tmp/q6-companion. A fresh pairing code comes from `vitals-companion pair` (never printed).
import { openProfile, go, dump, btn, sleep, ROOT } from './lib.mjs';
const URL_C = process.env.Q6_COMPANION || 'http://127.0.0.1:4894';
import { execFileSync } from 'node:child_process';
const port = new URL(URL_C).port;
// a fresh single-use code from the running Companion (same config dir); never printed
const raw = execFileSync('node', [`${ROOT}/packages/companion/bin/vitals-companion.mjs`, 'pair', '--port', port, '--config-dir', `${ROOT}/.e6-tmp/q6-companion`], { encoding: 'utf8' });
const code = (raw.match(/\b(\d{4}[ -]?\d{4})\b/) || [])[1]?.replace(/\D/g, '');
const { page, errors, close } = await openProfile('companion', { from: 'full' });
await go(page, '/settings/agents', { wait: 2000 });
page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
await btn(page, /^(Look for the Companion|Check again)$/).first().click(); await sleep(2500);
const addr = page.getByLabel('companion address');
if (await addr.count()) { await addr.fill(URL_C); await sleep(300); await btn(page, 'Check again').click(); await sleep(2500); }
const codeField = page.getByLabel('pairing code');
if (code && (await codeField.count())) { await codeField.first().fill(code); await btn(page, 'Pair').click(); await sleep(2500); }
const sw = page.getByRole('switch', { name: /agents on this computer/ }).or(page.getByLabel('agents on this computer'));
if (await sw.count()) { await sw.first().click().catch(() => {}); await sleep(1500); }
await dump(page, 'agents');
const sec = page.locator('section:has(h2:text("Agents"))');
console.log((await sec.innerText()).slice(0, 900));
console.log('ERRORS', errors);
await close();
