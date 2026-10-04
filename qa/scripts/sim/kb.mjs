import { open, firstRun } from './lib.mjs';
const { browser, page } = await open();
await firstRun(page);
console.log(await page.evaluate(() => { const r = document.querySelector('[role=radio]'); const out = [];
  const walk = (rules, sheet, layer) => { for (const ru of rules) { if (ru.cssRules && !ru.selectorText) walk(ru.cssRules, sheet, layer + (ru.name ? '/' + ru.name : '/' + ru.constructor.name)); else if (ru.selectorText) { try { if (r.matches(ru.selectorText) && /padding|display/.test(ru.style.cssText)) out.push(sheet + ' ' + layer + ' :: ' + ru.selectorText.slice(0, 100) + ' { ' + ru.style.cssText.slice(0, 150)); } catch {} } } };
  for (const s of document.styleSheets) walk(s.cssRules, (s.href || 'inline').split('/').pop(), '');
  return out.join('\n'); }));
await browser.close();
