// J1: pair a fresh browser profile to the server by code; status connected; the server's device list shows it; a
// second profile revokes it → the first sees "removed" and forgets the pairing; pair again.
//   node qa/scripts/Q8/j1-pair.mjs
import { results, openProfile, go, pairing, pairByCode, addPerson, pairCode, devicesList, serverCall, mainText, shot, sleep, closeBrowser, log } from './lib.mjs';

export async function run({ person = null } = {}) {
  const { check, save } = results('J1-pair');
  const id = person ?? (await addPerson('q8-j1'));
  const A = await openProfile('j1-a');
  const B = await openProfile('j1-b', { vp: 'mobile' });
  try {
    const ok = await pairByCode(A, await pairCode(id, 'Q8 A'), undefined, 'Q8 profile A');
    check('A paired by code (device token kept on this device only)', ok);
    const a = await pairing(A);
    const st = await serverCall(A, 'GET', '/v1/pair/status');
    check('A: /v1/pair/status answers 200 for this person', st.status === 200 && JSON.stringify(st.body).includes(id), `${st.status} ${JSON.stringify(st.body).slice(0, 160)}`);
    await go(A, '/settings?section=server');
    await sleep(2500);
    const txt = await mainText(A);
    check('A: Settings › Server shows connected (reachable, answers now yes)', /reachable/.test(txt) && /answers now \| yes/.test(txt), txt.slice(0, 400));
    await shot(A, 'J1-connected-1440');
    const list1 = await devicesList(id);
    check('server devices list shows A', list1.some((d) => d.id === a?.deviceId && d.kind === 'device'), JSON.stringify(list1.map((d) => [d.kind, d.label])));

    check('B paired by code', await pairByCode(B, await pairCode(id, 'Q8 B'), undefined, 'Q8 profile B'));
    await go(B, '/settings?section=server');
    await sleep(2000);
    const rev = B.page.getByRole('button', { name: /^Revoke Q8 profile A/ });
    check('B: Devices card lists A with Revoke', (await rev.count()) > 0, await mainText(B));
    await rev.first().click();
    await B.page.getByRole('button', { name: 'Remove device' }).click();
    await sleep(2000);
    const list2 = await devicesList(id);
    check('server devices list no longer has A as active', !list2.some((d) => d.id === a?.deviceId) || /revoked/i.test(JSON.stringify(list2)), JSON.stringify(list2.map((d) => [d.kind, d.label])));
    const direct = await A.page.evaluate(async (s) => (await fetch(`${s.baseUrl}/v1/pair/status`, { headers: { authorization: `Bearer ${s.token}` } })).status, a);
    check('A’s old token is refused (401)', direct === 401, String(direct));

    // A notices: "Check now" (the watcher would on its next poll, at most 60 s later)
    await go(A, '/settings?section=server');
    const now = A.page.getByRole('button', { name: 'Check now' });
    if (await now.count()) await now.first().click();
    const seen = await A.page.getByText(/This device was removed from your server/).first().waitFor({ timeout: 75000 }).then(() => true, () => false);
    check('A sees "removed" in its own words', seen, await mainText(A));
    check('A forgot the pairing (no token stored)', !(await pairing(A))?.token);
    const last = await A.page.evaluate(() => localStorage.getItem('vitals-server.last'));
    check('A records why without a secret', last && !last.includes(a.token), String(last).slice(0, 160));
    await shot(A, 'J1-removed-1440');
    const again = A.page.getByRole('button', { name: 'Connect again' });
    check('A offers Connect again', (await again.count()) > 0);

    check('A paired again with a new code', await pairByCode(A, await pairCode(id, 'Q8 A again'), undefined, 'Q8 profile A again'));
    const st2 = await serverCall(A, 'GET', '/v1/pair/status');
    check('A connected again (200)', st2.status === 200, String(st2.status));
    const list3 = await devicesList(id);
    check('devices list shows A again and B', list3.filter((d) => d.kind === 'device').length >= 2, JSON.stringify(list3.map((d) => [d.kind, d.label])));
    const bad = await A.page.evaluate(async (s) => (await fetch(`${s.baseUrl}/v1/pair/device`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '00000000', label: 'x' }) })).status, await pairing(A));
    check('a wrong code is refused (4xx)', bad >= 400 && bad < 500, String(bad));
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no console or page errors (A)', A.errors.filter((e) => !/401|Failed to load resource/.test(e)).length === 0, A.errors.join(' | '));
  check('no console or page errors (B)', B.errors.length === 0, B.errors.join(' | '));
  await A.ctx.close(); await B.ctx.close();
  return { rows: save({ person: 'q8-j1' }), id };
}
if (process.argv[1]?.endsWith('j1-pair.mjs')) { const { rows } = await run(); await closeBrowser(); log(`${rows.filter((r) => r.ok).length}/${rows.length} passed`); }
