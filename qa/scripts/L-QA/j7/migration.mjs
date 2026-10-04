// J7 step 7: the one-time move of existing ring sources (owner's state before item 11), notice, left-alone source, runs once.
import { chromium, newPage, bootApp, install, shot, goRoute, rec, save } from './lib.mjs';
import { onboard } from '../j1/onboard.mjs';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const { ctx, page } = await newPage(browser);
await bootApp(page); await onboard(page, () => {}); await bootApp(page, '/'); await install(page);
// two ring sources as an earlier build left them: A untouched (device-on suggestion, Coach hidden), B with one stream the person chose (steps Coach daily only)
await page.evaluate(async () => {
  const { suggestedOnPolicy, POLICY_STREAMS } = await import('/src/biometrics/core/policy.ts');
  const { deriveWriter, openBioStore } = await import('/src/commands/bio/store.ts');
  const store = await openBioStore({ writer: deriveWriter(undefined, 'qa seed') });
  const pol = () => POLICY_STREAMS.map(suggestedOnPolicy);
  const polB = pol().map((p) => (p.stream === 'steps' ? { ...p, coach: 'daily' } : p));
  await store.putSource({ sourceKey: 'ble:jstyle2301|old-A', label: 'J-Style 2301', tier: 'C', priority: 0, policies: pol(), baselineEpochs: [] });
  await store.putSource({ sourceKey: 'ble:colmi|old-B', label: 'Colmi R02 ring', tier: 'C', priority: 1, policies: polB, baselineEpochs: [] });
  await store.putSource({ sourceKey: 'file:apple_health|x', label: 'Apple Health', tier: 'B', priority: 2, policies: pol(), baselineEpochs: [] });
  await store.flush();
});
const pre = await page.evaluate(() => __j7.sources());
const key = (s, k) => s.sources.find((x) => x.sourceKey.startsWith(k));
rec('M0 seeded pre-item-11 state: ring sources hidden from the Coach, no notice', key(pre, 'ble:jstyle2301|').policies.every((p) => p.coach === 'hidden') && !pre.ringDefaultsNotice ? 'PASS' : 'FAIL', `ringSharing=${pre.ringSharing} notice=${!!pre.ringDefaultsNotice}`);
// the migration runs on the next page load (4 s after boot)
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(9000); await install(page);
let s = await page.evaluate(() => __j7.sources());
const A = key(s, 'ble:jstyle2301|'), B = key(s, 'ble:colmi|'), Ap = key(s, 'file:apple_health|');
const stepsB = B.policies.find((p) => p.stream === 'steps');
rec('M1 untouched ring source moved to the ring defaults on next load', A.policies.every((p) => p.coach === 'daily+series' && p.scores !== (p.stream === 'vendor_scores')) ? 'PASS' : 'FAIL', `coach=${[...new Set(A.policies.map((p) => p.coach))]} engine=${A.policies.filter((p) => p.engine).length}`);
rec('M2 a ring source the person changed is left alone (steps Coach "daily" kept, others still hidden)', stepsB.coach === 'daily' && B.policies.filter((p) => p.stream !== 'steps').every((p) => p.coach === 'hidden') ? 'PASS' : 'FAIL', `steps=${JSON.stringify(stepsB)} others=${[...new Set(B.policies.filter((p) => p.stream !== 'steps').map((p) => p.coach))]}`);
rec('M3 a non-ring (Apple Health) source is not moved', Ap.policies.every((p) => p.coach === 'hidden') ? 'PASS' : 'FAIL', `coach=${[...new Set(Ap.policies.map((p) => p.coach))]}`);
rec('M4 notice offered once', !!s.ringDefaultsNotice ? 'PASS' : 'FAIL', `notice=${JSON.stringify(s.ringDefaultsNotice)}`);
await goRoute(page, '/settings#devices'); await page.waitForTimeout(1000);
const visible = await page.getByText('Your ring data is now used for your plan and scores').count();
await shot(page, 'm4-notice.png');
rec('M4b notice text shown on the Devices screen with its switch', visible > 0 ? 'PASS' : 'FAIL', `notice count=${visible}`);
await page.getByRole('button', { name: 'Dismiss', exact: true }).first().click({ timeout: 3000 }).catch((e) => console.log('dismiss', e.message.split('\n')[0]));
await page.waitForTimeout(800);
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(9000); await install(page);
s = await page.evaluate(() => __j7.sources());
rec('M5 after dismissing and a reload: no notice, no second move (B still left alone)', !s.ringDefaultsNotice && key(s, 'ble:colmi|').policies.find((p) => p.stream === 'steps').coach === 'daily' ? 'PASS' : 'FAIL', `notice=${JSON.stringify(s.ringDefaultsNotice)} ringSharing=${s.ringSharing}`);
await browser.close();
