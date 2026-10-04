import { open, BASE, shot, dump } from './lib.mjs';
const mobile = process.argv[2] === 'mobile';
const { browser, page, errors } = await open({ mobile });
await page.goto(BASE + '/settings#devices', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const sec = page.locator('section#devices');
await sec.locator('input[type=file]').setInputFiles('src/biometrics/importers/__fixtures__/canonical.csv');
await page.waitForTimeout(6000);
console.log('TOASTS', await page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert]')].map(e => e.innerText).filter(Boolean)));
console.log((await sec.innerText()).replace(/\n+/g, ' | '));
await dump(page, 'devices', 'section#devices');
await shot(page, `devices-${mobile ? 'm' : 'd'}`);
// toggle coach visibility to hidden for first source
const coach = sec.getByRole('radio', { name: /hidden/i });
console.log('coach radios', await coach.count());
const sw = sec.getByRole('switch'); console.log('switches', await sw.count(), await sw.evaluateAll(es => es.map(e => (e.getAttribute('aria-label') || e.closest('label')?.innerText || '').trim() + '=' + (e.getAttribute('aria-checked') ?? e.checked))));
console.log('ERRORS', errors.filter(e => !/preload|Permissions-Policy|GL Driver/.test(e)));
await browser.close();
