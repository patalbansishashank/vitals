/** Isolated Signals layout regression. Start Vite, then RING_BASE=http://127.0.0.1:4403 node this-file [output-dir].
 * Uses synthetic data and blocks external requests. Never opens the owner's browser/profile.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.RING_BASE ?? 'http://127.0.0.1:4403';
const out = process.argv[2] ?? '/tmp/vitals-signals-layout';
const sizes = [
  { name: '360', width: 360, height: 800, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: 'landscape', width: 844, height: 390, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];
const states = ['populated', 'stale', 'learning', 'quiet', 'long', 'large-text'];
const rows = [];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });

async function collect(card) {
  return card.evaluate((node) => {
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      pageWidth: document.documentElement.scrollWidth,
      card: rect(node),
      scales: [...node.querySelectorAll('.rgo-row__scale')].map((e) => ({
        host: rect(e),
        svg: rect(e.querySelector('svg')),
        stale: e.querySelector('.lmz-scale__stale') ? rect(e.querySelector('.lmz-scale__stale')) : null,
      })),
      hero: [...node.querySelectorAll('.rgo-hero__pic')].map((e) => ({
        host: rect(e),
        layers: [...e.querySelectorAll('svg')].map(rect),
      })),
      text: [...node.querySelectorAll('.rgo-row__label, .rgo-num, .rgo-hero__facts > .rgo-hero__line > .lm-mono')].map((e) => {
        const range = document.createRange();
        range.selectNodeContents(e);
        return { text: e.textContent, boxes: [...range.getClientRects()].map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })) };
      }),
      rowLayout: [...node.querySelectorAll('.rgo-row')].map((e) => ({
        main: rect(e.querySelector('.rgo-row__main')),
        value: rect(e.querySelector('.rgo-row__value')),
      })),
    };
  });
}

try {
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile, timezoneId: 'Asia/Kolkata', reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await context.addInitScript(() => { window.__VITALS_GAUGE_DEMO__ = true; });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-01T12:00:00+05:30'));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/settings`);
    await page.evaluate(async () => {
      const { bootDocuments, settleUnscopedWrites } = await import('/src/state/runtime.ts');
      const { settleCommits } = await import('/src/commands/history.ts');
      const { flushAllMirrors } = await import('/src/state/bridge.ts');
      await bootDocuments();
      (await import('/src/features/onboarding/testing.ts')).seedClearedSafety();
      const profile = (await import('/src/state/profileStore.ts')).useProfileStore.getState();
      profile.setSex('male'); profile.setAge(38); profile.setHeight(178); profile.setWeight(77); profile.setSetup('done');
      // Full navigation must not interrupt consent/profile persistence or leave stale mirrors behind.
      await settleUnscopedWrites();
      await settleCommits();
      flushAllMirrors();
    });
    for (const state of states) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`${base}/ring`);
      await page.evaluate(async (state) => {
        const { makeGaugeFixture } = await import('/src/features/ring/fixtures.ts');
        const now = new Date('2026-11-01T12:00:00+05:30').getTime() - (state === 'stale' ? 4 * 3600000 : 0);
        (await import('/src/features/ring/api.ts')).setGaugeApi(makeGaugeFixture({ now, texture: 'raw', historyDays: state === 'learning' ? 3 : 400 }));
        await (await import('/src/commands/index.ts')).dispatch('settings.update', { patch: { quietMode: state === 'quiet' } });
        (await import('/src/features/ring/monitor/store.ts')).setRingMonitor(state === 'learning' ? ['hrv', 'hr', 'temp', 'spo2', 'stress'] : null);
        if (state === 'long') {
          const { entryOf } = await import('/src/features/ring/monitor/catalogue.ts');
          entryOf('hr').label = 'Heart rate during ordinary daily activity and recovery';
          entryOf('temp').label = 'Skin temperature overnight compared with your usual night';
        }
        if (state === 'large-text') document.documentElement.style.fontSize = '32px';
      }, state);
      const card = page.getByRole('heading', { name: 'Signals', exact: true }).locator('xpath=ancestor::section[1]');
      await card.getByRole('button', { name: 'Edit', exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      // Measure at the requested viewport before any full-height screenshot changes its orientation.
      const bounds = await collect(card);
      rows.push({ size: size.name, state, errors: [...errors], ...bounds });
      assert.equal(bounds.pageWidth, bounds.viewport.width, `${size.name}/${state}: horizontal page scroll`);
      for (const scale of bounds.scales) {
        assert(scale.svg.left >= scale.host.left - 1 && scale.svg.right <= scale.host.right + 1, `${size.name}/${state}: scale exceeds its allocated column`);
        if (scale.stale) assert(scale.stale.right <= scale.host.right + 1, `${size.name}/${state}: stale indicator escapes scale`);
      }
      for (const hero of bounds.hero) for (const layer of hero.layers) assert(layer.left >= hero.host.left - 1 && layer.right <= hero.host.right + 1, `${size.name}/${state}: hero picture escapes`);
      for (const text of bounds.text) for (const box of text.boxes) assert(box.left >= bounds.card.left - 1 && box.right <= bounds.card.right + 1, `${size.name}/${state}: text escapes: ${text.text}`);
      for (const row of bounds.rowLayout) {
        const separateRows = row.value.top >= row.main.bottom - 1;
        assert(separateRows || row.main.right <= row.value.left + 1, `${size.name}/${state}: label and reading collide`);
      }
      assert.deepEqual(errors, []);
      if (size.name === 'landscape') {
        await card.evaluate((e) => e.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: `${out}/${size.name}-${state}-top.png` });
        await card.evaluate((e) => e.scrollIntoView({ block: 'end' }));
        await page.screenshot({ path: `${out}/${size.name}-${state}-bottom.png` });
      } else {
        // Explicit height + observer settling avoids Chromium fullPage's stale SVG raster during viewport changes.
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
        await page.waitForTimeout(500);
        await card.screenshot({ path: `${out}/${size.name}-${state}.png` });
      }
    }
    await context.close();
  }
} finally {
  writeFileSync(`${out}/bounds.json`, JSON.stringify(rows, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ cases: rows.length, errors: rows.flatMap((r) => r.errors) }));
