import { launch, open, UA } from './lib.mjs';
const b = await launch();
const { page } = await open(b, { viewport: { width: 1440, height: 900 }, ua: UA.linux, routes: async (p) => p.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'v0.5.0', assets: [{ name: 'Vitals-linux-x86_64.AppImage', size: 123456789 }] }) })) });
await page.waitForSelector('.lm-dl__key'); await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const el = document.querySelector('.lm-dl__key'); const hits = [];
  const walk = (rules, ctx) => { for (const rule of rules) { if (rule.cssRules && !rule.selectorText) walk(rule.cssRules, ctx + ' ' + (rule.name || rule.conditionText || rule.constructor.name)); else if (rule.selectorText) { try { if (el.matches(rule.selectorText) || el.querySelector('.lm-key__label')?.matches(rule.selectorText)) { const st = rule.style; if (st.color || st.background || st.backgroundColor || st.webkitTextFillColor) hits.push(ctx + ' | ' + rule.selectorText + ' | color=' + st.color + ' bg=' + (st.background || st.backgroundColor)); } } catch (e) {} } } };
  for (const s of document.styleSheets) { try { walk(s.cssRules, 'sheet'); } catch (e) {} }
  const cs = getComputedStyle(document.documentElement);
  return { hits, inverse: cs.getPropertyValue('--lm-ink-inverse'), ink: cs.getPropertyValue('--lm-ink') };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
