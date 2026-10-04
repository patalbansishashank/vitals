// R18 probe: Chromium Local Network Access from the live public origin (https://vitals.creative.desi).
// Loads the site in headless system Chromium and fetch()es loopback, a tailnet IP, `tailscale serve` names and a public
// host, under several variants (default; permission granted through CDP; LNA-disabling flags). Prints JSON lines.
// Needs: Companion on 127.0.0.1:4891 and on <tailnet IP>:4892, stream-server behind `tailscale serve --https=8444`.
// Usage: node qa/scripts/R18/lna-probe.mjs <tailnetIPv4> <thisPcTsName> > result.json
import { chromium } from 'playwright-core';
import { localConfig } from '../lib/localConfig.mjs';
const cfg = localConfig();
const [ip = cfg.pcIp4, pcName = cfg.pcHost] = process.argv.slice(2);
if (!ip || !pcName) throw new Error('give <tailnetIPv4> <thisPcTsName> or set pcIp4 and pcHost in qa/local.config.json');
const SITE = 'https://vitals.creative.desi/';
const TARGETS = [
  { id: 'a-loopback', url: 'http://127.0.0.1:4891/health' },
  { id: 'a-loopback-tas', url: 'http://127.0.0.1:4891/health', tas: 'loopback' },
  { id: 'b-tailnet-ip', url: `http://${ip}:4892/health` },
  { id: 'b-tailnet-ip-tas', url: `http://${ip}:4892/health`, tas: 'local' },
  { id: 'b-tailnet-ip-tas-preflight', url: `http://${ip}:4892/v1/pair/status`, tas: 'local', auth: true },
  { id: 'c-serve-server', url: `${cfg.serverUrl}/health` },
  { id: 'c-serve-pc', url: `https://${pcName}:8444/echo`, auth: true },
  { id: 'c-serve-pc-sse', url: `https://${pcName}:8444/sse`, sse: true },
  { id: 'd-public', url: 'https://api.github.com/zen' },
];
const VARIANTS = [
  { id: 'default', args: [] },
  { id: 'granted-via-cdp', args: [], grant: true },
  { id: 'flag-disable-LocalNetworkAccessChecks', args: ['--disable-features=LocalNetworkAccessChecks'] },
  { id: 'flag-companion-doc-webmcp-only', args: ['--enable-features=WebMCP'] },
  // The live site's CSP (connect-src: https:, wss:, loopback http only) stops http://100.x before LNA is reached;
  // these two variants switch CSP off in the test browser to see what Chromium itself does with a tailnet IP.
  { id: 'default-bypassCSP', args: [], bypassCSP: true },
  { id: 'granted-via-cdp-bypassCSP', args: [], grant: true, bypassCSP: true },
].filter((v) => !process.env.R18_VARIANTS || process.env.R18_VARIANTS.split(',').includes(v.id));
const out = [];
for (const v of VARIANTS) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', ...v.args] });
  const ctx = await browser.newContext({ bypassCSP: Boolean(v.bypassCSP) });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const failures = [];
  cdp.on('Network.loadingFailed', (e) => failures.push({ errorText: e.errorText, blockedReason: e.blockedReason, cors: e.corsErrorStatus }));
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(m.text().slice(0, 300)));
  const browserCdp = await browser.newBrowserCDPSession();
  const grantTried = {};
  if (v.grant) {
    // Grant in the page's own browser context (Playwright contexts are not the default one).
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    // One call: each Browser.grantPermissions call replaces the context's earlier grants.
    for (const names of [['localNetwork', 'loopbackNetwork'], ['localNetworkAccess']]) {
      try { await browserCdp.send('Browser.grantPermissions', { origin: SITE.slice(0, -1), permissions: names, browserContextId: targetInfo.browserContextId }); grantTried[names.join('+')] = 'ok'; break; }
      catch (e) { grantTried[names.join('+')] = String(e.message).split('\n')[0].slice(0, 120); }
    }
  }
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  const perms = await page.evaluate(async () => {
    const r = {};
    for (const name of ['local-network-access', 'local-network', 'loopback-network']) {
      try { r[name] = (await navigator.permissions.query({ name })).state; } catch (e) { r[name] = 'error: ' + e.message; }
    }
    return r;
  });
  for (const t of TARGETS) {
    failures.length = 0;
    const res = await page.evaluate(async (t) => {
      const init = { mode: 'cors', signal: AbortSignal.timeout(10000) };
      if (t.tas) init.targetAddressSpace = t.tas;
      if (t.auth) init.headers = { Authorization: 'Bearer r18-probe-not-a-real-token' };
      const t0 = performance.now();
      try {
        const r = await fetch(t.url, init);
        if (t.sse) {
          const reader = r.body.getReader(); const times = []; let s = '';
          for (;;) { const { done, value } = await reader.read(); if (done) break; s += new TextDecoder().decode(value); times.push(Math.round(performance.now() - t0)); }
          return { outcome: 'allowed', status: r.status, chunkTimesMs: times, events: (s.match(/data:/g) || []).length };
        }
        const body = (await r.text()).slice(0, 120);
        return { outcome: 'allowed', status: r.status, body, ms: Math.round(performance.now() - t0) };
      } catch (e) { return { outcome: 'blocked', error: `${e.name}: ${e.message}`, ms: Math.round(performance.now() - t0) }; }
    }, t);
    await page.waitForTimeout(150);
    out.push({ variant: v.id, target: t.id, url: t.url, targetAddressSpace: t.tas ?? null, ...res, cdpFailures: [...failures] });
  }
  out.push({ variant: v.id, permissions: perms, grantTried, console: consoleLines.filter((l) => /local network|private network|mixed content|cors|blocked/i.test(l)).slice(0, 12) });
  await browser.close();
}
console.log(JSON.stringify({ chromium: '/usr/bin/chromium', site: SITE, at: new Date().toISOString(), results: out }, null, 1));
