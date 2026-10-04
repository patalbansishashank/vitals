import { launch, open, UA } from './lib.mjs';
const b = await launch();
const { page } = await open(b, { viewport: { width: 1440, height: 900 }, ua: UA.linux });
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const out = [];
  [...document.styleSheets].forEach((s, i) => { const names = []; try { for (const r of s.cssRules) { if (r.constructor.name === 'CSSLayerBlockRule') names.push('block:' + r.name); else if (r.constructor.name === 'CSSLayerStatementRule') names.push('stmt:' + r.nameList.join('/')); else if (r.constructor.name === 'CSSImportRule') names.push('import'); } } catch (e) { names.push('(x)'); } out.push(i + ' ' + (s.href ?? 'inline').replace(location.origin, '') + ' => ' + [...new Set(names)].join(' ')); });
  return out.join('\n');
}));
await b.close();
