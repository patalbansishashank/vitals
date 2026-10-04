// J4: two devices through the server. Profile A sets up sync against the server (the 24 words stay in memory); a q8
// person on the server joins that sync group (words on ssh stdin); both profiles pair by code; profile B joins sync with
// A's words. A logs a meal → B sees it within 5 s (read through the bus). Then B goes offline (its sync socket is cut
// and refused), A changes one Settings field (energy unit) and B another (week start); B comes back: both devices keep
// both edits (per-field merge).
//
// The meal is logged through the page's own agent surface (WebMCP tool `log_meal`, actor webmcp, log class: applied at
// once) because a person with no plan has no Today/Food rows to tap; the Coach journeys (J3) log meals by typing.
//   node qa/scripts/Q8/j4-two-devices.mjs
import { results, openProfile, go, read, pairByCode, addPerson, pairCode, setUpSync, joinSync, sleep, closeBrowser, log, shot, mainText, switchableRelay } from './lib.mjs';

export function webmcpPolyfill() {
  localStorage.setItem('vitals-agents.webmcp', 'true');
  window.__tools = {};
  Object.defineProperty(navigator, 'modelContext', {
    value: { registerTool(t) { window.__tools[t.name] = t; return { unregister() { delete window.__tools[t.name]; } }; }, unregisterTool(n) { delete window.__tools[n]; } },
    configurable: true,
  });
}
export async function tool(p, name, input = {}) {
  await p.page.waitForFunction((n) => window.__tools?.[n], name, { timeout: 30000 });
  return JSON.parse(await p.page.evaluate(async ([n, i]) => (await window.__tools[n].execute(i)).content[0].text, [name, input]));
}
async function pickBank(p, section, label) {
  const sec = p.page.locator(`section#${section}`);
  const r = sec.getByRole('radio', { name: label, exact: true });
  if (await r.count()) return r.first().click();
  return sec.getByRole('button', { name: label, exact: true }).first().click();
}

export async function run() {
  const { check, save } = results('J4-two-devices');
  const A = await openProfile('j4-a');
  // B syncs through a local relay in front of the server, so the test can take B alone offline
  const relay = await switchableRelay();
  const B = await openProfile('j4-b', { vp: 'tablet', selfSigned: true });
  for (const p of [A, B]) await p.ctx.addInitScript(webmcpPolyfill);
  let id = null;
  try {
    const phrase = await setUpSync(A);
    check('A: sync set up against the server (24 words read from the screen, not printed)', phrase.split(' ').length === 24);
    id = await addPerson('q8-j4', phrase);
    check('server person q8-j4 joined A’s sync group', /^[0-9a-f]{16}$/.test(id));
    check('A paired by code', await pairByCode(A, await pairCode(id, 'Q8 J4 A'), undefined, 'Q8 J4 A'));
    check('B paired by code', await pairByCode(B, await pairCode(id, 'Q8 J4 B'), undefined, 'Q8 J4 B'));
    await joinSync(B, phrase, relay.url);
    let sb = null;
    for (let i = 0; i < 30; i++) { sb = await read(B, 'sync.status').catch((e) => ({ error: e.message })); if (sb?.enabled) break; await sleep(500); }
    check('B joined the sync group', /"(on|connected|syncing|idle)"|"enabled":true|"paired":true/.test(JSON.stringify(sb)), JSON.stringify(sb).slice(0, 200));
    await go(A, '/settings');
    await go(B, '/settings');
    await sleep(3000);

    // A logs a meal → B sees it
    const today = (await read(A, 'today.get', {}).catch(() => null))?.date ?? new Date().toLocaleDateString('en-CA');
    const tag = `q8 dal ${Date.now() % 100000}`;
    const r = await tool(A, 'log_meal', { date: today, text: tag, method: 'aiText', slot: 'lunch', confidence: 0.7, components: [{ name: 'dal', grams: 150 }, { name: 'cooked rice', grams: 180 }, { name: 'boiled egg', grams: 100, portion: { unit: 'egg', count: 2 } }] });
    const t0 = Date.now();
    check('A: meal logged (command bus answer ok)', r.ok !== false && !r.error, JSON.stringify(r).slice(0, 200));
    const onA = JSON.stringify(await read(A, 'log.get', { from: today, to: today }));
    check('A: the meal is in A’s log', onA.includes(tag), onA.slice(0, 200));
    let seen = false;
    while (Date.now() - t0 < 30000) {
      const onB = JSON.stringify(await read(B, 'log.get', { from: today, to: today }));
      if (onB.includes(tag)) { seen = true; break; }
      await sleep(250);
    }
    const ms = Date.now() - t0;
    check(`B sees A’s meal within 5 s (took ${(ms / 1000).toFixed(1)} s)`, seen && ms <= 5000, seen ? `${ms} ms` : 'not seen in 30 s');
    log(`meal A → B: ${seen ? `${ms} ms` : 'not seen'}`);

    // per-field edits while B is offline
    const s0 = await read(A, 'settings.get');
    log(`settings before: energy ${s0.energyUnit ?? s0.settings?.energyUnit}, week ${s0.weekStart ?? s0.settings?.weekStart}`);
    // B's relay connection is cut and refused (Evolu's socket lives in a worker: page-level routing cannot reach it)
    relay.off();
    await sleep(3000);
    await go(A, '/settings#units');
    await pickBank(A, 'units', 'kJ');
    await B.page.evaluate(() => { location.hash = 'units'; }); // no reload while offline (no service worker here)
    await pickBank(B, 'units', 'Sunday');
    await sleep(1500);
    const a1 = await read(A, 'settings.get');
    const b1 = await read(B, 'settings.get');
    const f = (s, k) => s[k] ?? s.settings?.[k];
    await sleep(5000);
    const a1b = await read(A, 'settings.get');
    check('offline: A has kJ, B has Sunday (each its own edit, neither has the other’s after 5 s)', f(a1b, 'energyUnit') === 'kJ' && f(a1b, 'weekStart') !== 'sunday' && f(b1, 'weekStart') === 'sunday' && f(b1, 'energyUnit') !== 'kJ', `A ${f(a1, 'energyUnit')}/${f(a1, 'weekStart')} B ${f(b1, 'energyUnit')}/${f(b1, 'weekStart')}`);
    relay.on();
    let both = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 60000) {
      const a2 = await read(A, 'settings.get');
      const b2 = await read(B, 'settings.get');
      if (f(a2, 'energyUnit') === 'kJ' && f(a2, 'weekStart') === 'sunday' && f(b2, 'energyUnit') === 'kJ' && f(b2, 'weekStart') === 'sunday') { both = true; break; }
      await sleep(500);
    }
    const a3 = await read(A, 'settings.get');
    const b3 = await read(B, 'settings.get');
    check(`back online: both devices keep both edits (energy kJ and week from Sunday) (${((Date.now() - t1) / 1000).toFixed(1)} s)`, both, `A ${f(a3, 'energyUnit')}/${f(a3, 'weekStart')} B ${f(b3, 'energyUnit')}/${f(b3, 'weekStart')}`);
    const txtB = await mainText(B);
    check('B’s Settings screen shows kJ and Sunday selected', /kJ/.test(txtB) && /Sunday/.test(txtB));
    await shot(B, 'J4-settings-B-768');
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no page errors (A, B)', [...A.errors, ...B.errors].filter((e) => e.startsWith('pageerror')).length === 0, [...A.errors, ...B.errors].join(' | ').slice(0, 300));
  await A.ctx.close(); await B.ctx.close(); relay.close();
  return { rows: save({ person: 'q8-j4' }), id };
}
if (process.argv[1]?.endsWith('j4-two-devices.mjs')) { const { rows } = await run(); await closeBrowser(); log(`${rows.filter((r) => r.ok).length}/${rows.length} passed`); }
