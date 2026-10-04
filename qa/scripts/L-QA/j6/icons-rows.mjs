// Element screenshots of selected contact-sheet rows (run icons.mjs first).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = fileURLToPath(new URL('../../../results/L-QA/j6/', import.meta.url));
const PICK = { 'tray-16': 'tray/tray-16.png', 'tray-dark-16': 'tray/tray-dark-16.png', 'tray-template': 'trayTemplate.png', 'badge-96': 'badge-96.png', 'mono-512': 'icon-512-monochrome.png', 'icon-192': 'public/icons/icon-192.png', 'favicon-16': 'public/icons/favicon-16.png', 'apple-180': 'apple-touch-icon-180.png', 'mark-small': 'mark-small.svg', 'lockup-dark': 'lockup-dark.svg', 'ico-64': 'icon.ico [frame 6', 'icns-ic07': 'icon.icns [ic07]' };
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
await p.goto(`file://${HERE}icons.html`);
await p.waitForTimeout(500);
for (const [name, frag] of Object.entries(PICK)) {
  const row = p.locator(`.row[data-id*="${frag}"]`).first();
  if (await row.count()) await row.screenshot({ path: `${OUT}icons-row-${name}.png` }); else console.log('no row', name);
}
await b.close();
