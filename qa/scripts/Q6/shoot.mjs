// Q6 visual pass: every screen in screens.mjs at 390 / 768 / 1440 px in light and dark, one fresh copy of each seeded
// profile per (width, theme) run. Screenshots → qa/screenshots/Q6/<screen>-<width>-<theme>.png|webp (≤ 200 kB),
// measurements → qa/results/Q6/shots.json. usage: node shoot.mjs [screen ids…]  (Q6_W=390,768 Q6_THEME=dark narrow it)
import fs from 'node:fs';
import { openProfile, go, shot, ROOT, sleep } from './lib.mjs';
import { measure } from './measure.mjs';
import { SCREENS } from './screens.mjs';
import { scanForbidden } from '../Q3/lib.mjs';
const only = process.argv.slice(2);
const WS = (process.env.Q6_W || '390,768,1440').split(',').map(Number);
const THEMES = (process.env.Q6_THEME || 'light,dark').split(',');
// the server profile is on another origin (BASE): shot only in its own run (Q6_SERVER=1, qa/scripts/Q10/srv-visual.mjs)
const list = SCREENS.filter((s) => (s.profile === 'server') === !!process.env.Q6_SERVER).filter((s) => !only.length || only.some((o) => s.id === o || (o.endsWith('*') && s.id.startsWith(o.slice(0, -1)))));
const outFile = `${ROOT}/qa/results/Q6/shots.json`;
fs.mkdirSync(`${ROOT}/qa/results/Q6`, { recursive: true });
const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
for (const w of WS) for (const theme of THEMES) {
  for (const profile of [...new Set(list.map((s) => s.profile))]) {
    const { page, errors, close } = await openProfile(`run-${profile}`, { w, theme, from: profile === 'fresh' ? null : profile });
    const bad = [];
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 120)}`); });
    for (const s of list.filter((x) => x.profile === profile)) {
      const key = `${s.id}-${w}-${theme}`;
      errors.length = 0; bad.length = 0;
      try {
        await go(page, s.route, { wait: 1500 });
        if (s.prep) await s.prep(page);
        await sleep(600);
        await page.mouse.move(0, 0);
        const m = await measure(page, { scope: s.scope, vw: w });
        const file = await shot(page, key, { mask: s.mask });
        // internal names on screen (v0.4: "Lumen Health" is the ring's app, named on purpose)
        const forbidden = scanForbidden((await page.evaluate(() => `${document.title}\n${document.body.innerText}`)).replace(/Lumen Health/g, 'Ring app'));
        prev[key] = { id: s.id, w, theme, route: s.route, url: new URL(page.url()).pathname, file, ...m, forbidden, errors: errors.slice(), http: bad.slice() };
        console.log(key, `ox=${m.overflowX} off=${m.offscreen.length} ovl=${m.overlaps.length} lc=${m.lowContrast.length} clip=${m.clipped.length} unl=${m.unlabeled.length} grp=${m.groups.length} err=${errors.length}`);
      } catch (e) {
        prev[key] = { id: s.id, w, theme, route: s.route, error: String(e.message).split('\n')[0], errors: errors.slice() };
        console.log(key, 'ERROR', String(e.message).split('\n')[0]);
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
    await close();
  }
  fs.writeFileSync(outFile, JSON.stringify(prev, null, 1));
}
fs.writeFileSync(outFile, JSON.stringify(prev, null, 1));
