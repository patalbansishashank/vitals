// E22: Sign in with ChatGPT precheck without consent. Builds the real authorize request in a throwaway config dir,
// asks OpenAI for it without following redirects (no login, no consent), checks the loopback callback listener, stops.
// Usage: node --experimental-strip-types qa/scripts/e22/siwc-precheck.mjs   (Node 22.18+ strips types by default)
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createSiwc } from '../../../packages/companion/src/siwc.ts';
const dir = mkdtempSync(join(process.env.TMPDIR || '.e6-tmp', 'siwc-pre-'));
const siwc = createSiwc({ configDir: dir, log: () => {}, openBrowser: () => {} });
const login = await siwc.login();
login.done.catch(() => {});
const u = new URL(login.authorizeUrl);
const p = Object.fromEntries(u.searchParams);
console.log('authorize endpoint:', `${u.origin}${u.pathname}`);
console.log('params:', JSON.stringify({ client_id: p.client_id, response_type: p.response_type, scope: p.scope, redirect_uri: p.redirect_uri?.replace(/:\d+\//, ':<port>/'), code_challenge_method: p.code_challenge_method, resource: p.resource, agent_name_hint: p.agent_name_hint, ext_agent_host_id: p.ext_agent_host_id ? 'urn:uuid:<install id>' : undefined, state: p.state ? '<set>' : undefined, nonce: p.nonce ? '<set>' : undefined, other: Object.keys(p).filter((k) => !['client_id','response_type','scope','redirect_uri','code_challenge','code_challenge_method','resource','agent_name_hint','ext_agent_host_id','state','nonce'].includes(k)) }));
const r = await fetch(login.authorizeUrl, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
const loc = r.headers.get('location');
console.log('OpenAI answered:', r.status, loc ? `→ ${new URL(loc, u).origin}${new URL(loc, u).pathname}` : '(no redirect)');
if (!loc) console.log('body excerpt:', (await r.text()).replace(/\s+/g, ' ').slice(0, 300));
else if (/error/.test(loc)) console.log('redirect carries error:', new URL(loc, u).searchParams.get('error'), new URL(loc, u).searchParams.get('error_description'));
// A real browser passes the bot check; it stops at whatever page OpenAI shows first (login or an error), never consents.
{
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await (await browser.newContext()).newPage();
  await page.goto(login.authorizeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('browser goto:', e.message));
  await page.waitForTimeout(8000);
  const at = new URL(page.url());
  console.log('browser landed on:', `${at.origin}${at.pathname}`, '| title:', await page.title());
  console.log('page text excerpt:', (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300));
  await page.screenshot({ path: 'qa/screenshots/E22-siwc-precheck.png' });
  await browser.close();
}
const cb = await fetch(new URL(login.redirectUri ?? p.redirect_uri), { signal: AbortSignal.timeout(5000) }).catch((e) => ({ status: `unreachable (${e.message})` }));
console.log('loopback callback without a code answers:', cb.status, '(expected: an error page; the listener is reachable)');
siwc.close();
rmSync(dir, { recursive: true, force: true });
console.log('stopped before consent; nothing saved');
