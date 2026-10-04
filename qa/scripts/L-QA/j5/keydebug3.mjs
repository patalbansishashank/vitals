import { launch, open, UA } from './lib.mjs';
const b = await launch();
const { page, ctx } = await open(b, { viewport: { width: 1440, height: 900 }, ua: UA.linux, routes: async (p) => p.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'v0.5.0', assets: [{ name: 'Vitals-linux-x86_64.AppImage', size: 123456789 }] }) })) });
await page.waitForSelector('.lm-dl__key'); await page.waitForTimeout(2000);
const s = await ctx.newCDPSession(page);
await s.send('DOM.enable'); await s.send('CSS.enable');
const doc = await s.send('DOM.getDocument');
for (const sel of ['.lm-dl__key', '.lm-dl__key .lm-key__label']) {
const { nodeId } = await s.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
const m = await s.send('CSS.getMatchedStylesForNode', { nodeId });
console.log('==', sel);
for (const r of m.matchedCSSRules) { const props = r.rule.style.cssProperties.filter((p) => /^(color|background|background-color|-webkit-text-fill-color)$/.test(p.name) && !p.disabled).map((p) => p.name + ':' + p.value); if (props.length) console.log(r.rule.origin, JSON.stringify(r.rule.selectorList.text), props.join(' '), JSON.stringify(r.rule.layers?.map?.((l) => l.text) ?? '')); }
console.log('inherited from parents with color:'); }
const info = await s.send('CSS.getComputedStyleForNode', { nodeId: (await s.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.lm-dl__key' })).nodeId });
console.log(info.computedStyle.filter((p) => p.name === 'color' || p.name === 'background-color'));
await b.close();
