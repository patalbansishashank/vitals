// J2: providers via the server. The three "via your server" presets show their state; an NVIDIA key (a fake value) is
// set through the server: the server keeps it, the browser never does (localStorage and every IndexedDB store are
// scanned for it); Load the model list and Test connection show the server's words for the refused key; the key is
// removed again. Unpaired, the three presets read "needs your server".
//   node qa/scripts/Q8/j2-providers.mjs
import { results, openProfile, go, pairByCode, addPerson, pairCode, serverCall, mainText, shot, sleep, closeBrowser, log, sshRun } from './lib.mjs';

const FAKE_KEY = `nvapi-q8-fake-${Math.random().toString(36).slice(2, 10)}-not-a-real-key`;
const ALL = /needs your server|not signed in|signed in|sign-in expired|no key|key set/;

/** Every string in localStorage and in every object store of every IndexedDB database that contains `needle`. */
const browserHas = (p, needle) => p.page.evaluate(async (needle) => {
  const hits = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if ((localStorage.getItem(k) || '').includes(needle) || k.includes(needle)) hits.push(`localStorage:${k}`); }
  for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if ((sessionStorage.getItem(k) || '').includes(needle)) hits.push(`sessionStorage:${k}`); }
  const dbs = (await indexedDB.databases?.()) ?? [];
  for (const { name } of dbs) {
    const db = await new Promise((r) => { const o = indexedDB.open(name); o.onsuccess = () => r(o.result); o.onerror = () => r(null); });
    if (!db) continue;
    for (const s of db.objectStoreNames) {
      const rows = await new Promise((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); });
      const txt = JSON.stringify(rows, (k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? new TextDecoder().decode(v) : v));
      if (txt.includes(needle)) hits.push(`indexedDB:${name}/${s}`);
    }
    db.close();
  }
  return { hits, dbs: dbs.map((d) => d.name) };
}, needle);
const rowOf = (p, value) => p.page.locator('label, li, div').filter({ has: p.page.locator(`input[type=radio][value="${value}"]`) }).last();

export async function run({ person = null } = {}) {
  const { check, save } = results('J2-providers');
  const id = person ?? (await addPerson('q8-j2'));
  const A = await openProfile('j2-a');
  try {
    // unpaired: all three need a server
    await go(A, '/settings/ai');
    await sleep(1000);
    for (const v of ['siwc', 'nim', 'opencode-zen']) {
      const t = (await rowOf(A, v).innerText().catch(() => '')).replace(/\s+/g, ' ');
      check(`unpaired: ${v} reads "needs your server"`, /needs your server/.test(t), t.slice(0, 160));
    }
    check('paired by code', await pairByCode(A, await pairCode(id, 'Q8 J2'), undefined, 'Q8 J2'));
    await go(A, '/settings/ai');
    await sleep(2500);
    const chips = {};
    for (const v of ['siwc', 'nim', 'opencode-zen']) chips[v] = ((await rowOf(A, v).innerText().catch(() => '')).replace(/\s+/g, ' ').match(ALL) ?? [''])[0];
    check('paired: ChatGPT reads "not signed in", NIM and Zen read "no key"', chips.siwc === 'not signed in' && chips.nim === 'no key' && chips['opencode-zen'] === 'no key', JSON.stringify(chips));
    const st0 = await serverCall(A, 'GET', '/v1/ai/status');
    check('server /v1/ai/status: three presets, none ready', st0.status === 200 && st0.body.presets?.length === 3 && st0.body.presets.every((x) => !x.ready), JSON.stringify(st0.body).slice(0, 200));

    // choose NIM, set the key through the server
    await A.page.locator('input[type=radio][value="nim"]').evaluate((e) => e.click());
    await sleep(800);
    const keyBox = A.page.getByLabel('API key', { exact: true }).first();
    await keyBox.fill(FAKE_KEY);
    await A.page.getByRole('button', { name: 'Save key' }).first().click();
    await A.page.getByText('key set on your server').first().waitFor({ timeout: 20000 }).catch(() => {});
    const t1 = await mainText(A);
    check('key block reads "key set on your server"', /key set on your server/.test(t1), t1.slice(0, 300));
    const st1 = await serverCall(A, 'GET', '/v1/ai/status');
    check('server says NIM ready (key stored there)', st1.body.presets?.find((x) => x.id === 'nim')?.ready === true, JSON.stringify(st1.body).slice(0, 200));
    const keysOnServer = await sshRun(`node ~/vitals-server/current/bin/vitals-server.mjs keys list ${id}`);
    const ls = await sshRun(`ls -la ~/.local/share/vitals-server/persons/${id}/credentials/`);
    check('the key file on the server is 0600 (credentials/providers.json; contents not read)', /^-rw------- .* providers\.json$/m.test(ls.stdout), ls.stdout.split('\n').filter((l) => /providers/.test(l)).join(' '));
    // `vitals-server keys list` is documented in docs/SERVER.md but not wired into the vitals-server CLI (finding Q8-01)
    check('server CLI lists a nim key for this person (value not shown)', /nim/.test(keysOnServer.stdout) && !keysOnServer.stdout.includes(FAKE_KEY), keysOnServer.stdout.replace(FAKE_KEY, '[key]').slice(0, 160));
    await sleep(500);
    const has = await browserHas(A, FAKE_KEY);
    check('the key is in no localStorage, sessionStorage or IndexedDB store of the browser', has.hits.length === 0, `${has.hits.join(', ')} (dbs: ${has.dbs.join(', ')})`);
    const field = await keyBox.inputValue().catch(() => '');
    check('the key field is empty after saving', !field.includes(FAKE_KEY));
    const nimChip = ((await rowOf(A, 'nim').innerText().catch(() => '')).match(ALL) ?? [''])[0];
    check('NIM chip reads "key set"', nimChip === 'key set', nimChip);

    // Load the model list and Test connection go to NVIDIA through the server; the fake key is refused there
    const load = A.page.getByRole('button', { name: 'Load the model list' });
    let loadText = '';
    if (await load.count()) {
      await load.first().click();
      await sleep(8000);
      loadText = await mainText(A);
    }
    const loadMsg = (loadText.match(/Couldn't load the list: [^|]+|\d+ models listed by the provider\./) ?? [''])[0];
    check('Load the model list answers in plain words', Boolean(loadMsg), loadText.slice(0, 300));
    log(`Load models: ${loadMsg}`);
    const model = A.page.getByLabel(/^model$/i).first();
    if ((await model.count()) && (await model.evaluate((e) => e.tagName)) === 'SELECT') {
      const opts = await model.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      await model.selectOption(opts.find((o) => /llama|meta/.test(o)) ?? opts[0]);
    } else {
      const mid = A.page.getByLabel('model id', { exact: true });
      if (await mid.count()) await mid.fill('meta/llama-3.1-8b-instruct');
    }
    await sleep(500);
    await A.page.getByRole('button', { name: 'Test connection' }).first().click();
    await A.page.getByRole('alert').filter({ hasText: /./ }).first().waitFor({ timeout: 60000 }).catch(() => {});
    await sleep(1000);
    const testText = (await A.page.getByRole('alert').allInnerTexts()).join(' | ') || (await mainText(A));
    const refused = /refused (this|the) key|The AI service answered with an error/.exec(testText)?.[0];
    check('Test connection: the refused key is reported in the server’s words', Boolean(refused), testText.slice(0, 400));
    log(`Test connection says: ${testText.slice(0, 200)}`);
    const probe = await serverCall(A, 'GET', '/v1/ai/nim/probe');
    // NVIDIA lists its models without checking the key, so the server's probe cannot tell a refused key (finding Q8-04)
    check('server probe answers (NVIDIA lists models without checking the key)', probe.status === 200, JSON.stringify(probe.body).slice(0, 200));
    // a model from the server's own list (the select may hold a model NVIDIA retired: 410)
    const listed = (await serverCall(A, 'GET', '/v1/ai/nim/models')).body?.data?.map((m) => m.id) ?? [];
    const picked = listed.find((m) => /llama-3\.(1|3).*instruct/.test(m)) ?? listed[0] ?? 'meta/llama-3.3-70b-instruct';
    log(`model picked for the check: ${picked}`);
    const chat0 = await serverCall(A, 'POST', '/v1/ai/nim/chat/completions', { model: picked, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
    // §14.3 (E33, Q8-04): a refused key is named as such, with what to do; the upstream status stays in detail
    check('a chat call with the fake key: key_refused with the §14.3 words (upstream 401/403 in detail)', [401, 403, 502].includes(chat0.status) && chat0.body?.error?.code === 'key_refused' && /refused the key kept on your server\. Replace it above\./.test(chat0.body?.error?.message ?? ''), JSON.stringify(chat0.body).slice(0, 200));
    check('no server answer echoes the key', !JSON.stringify(probe.body).includes(FAKE_KEY));
    await shot(A, 'J2-nim-refused-1440');

    // remove it
    await A.page.getByRole('button', { name: 'Remove key' }).first().click();
    await A.page.getByRole('alertdialog').getByRole('button', { name: 'Remove key' }).click();
    await sleep(2000);
    const st2 = await serverCall(A, 'GET', '/v1/ai/status');
    check('key removed on the server (NIM not ready)', st2.body.presets?.find((x) => x.id === 'nim')?.ready === false, JSON.stringify(st2.body).slice(0, 200));
    check('key block reads "no key on your server yet"', /no key on your server yet/.test(await mainText(A)));
    const chat = await serverCall(A, 'POST', '/v1/ai/nim/chat/completions', { model: 'x', messages: [{ role: 'user', content: 'hi' }] });
    check('a Coach call without a key: 409 no_key in the §14.3 words', chat.status === 409 && chat.body?.error?.message === 'Add a key for this service in Settings › Coach first.', JSON.stringify(chat.body).slice(0, 200));
    const siwc = await serverCall(A, 'POST', '/v1/ai/siwc/responses', { model: 'x', input: 'hi' });
    check('ChatGPT without a sign-in: 409 not_signed_in in the §14.3 words', siwc.status === 409 && siwc.body?.error?.code === 'not_signed_in', JSON.stringify(siwc.body).slice(0, 200));
    const zen = await serverCall(A, 'GET', '/v1/ai/opencode-zen/models');
    // the model list is public upstream; the server only needs a key for chat (no_key checked above for NIM)
    const zenChat = await serverCall(A, 'POST', '/v1/ai/opencode-zen/chat/completions', { model: 'x', messages: [{ role: 'user', content: 'hi' }] });
    check('OpenCode Zen chat without a key: 409 no_key', zenChat.status === 409 && zenChat.body?.error?.code === 'no_key', `${zenChat.status}; models list without a key: ${zen.status}`);
    await A.page.locator('input[type=radio][value="siwc"]').evaluate((e) => e.click());
    await sleep(800);
    check('ChatGPT block: "Not signed in yet. Whoever runs your server signs in once."', /Not signed in yet\. Whoever runs your server signs in once\./.test(await mainText(A)));
    await shot(A, 'J2-siwc-1440');
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no page errors', A.errors.filter((e) => e.startsWith('pageerror')).length === 0, A.errors.join(' | '));
  await A.ctx.close();
  return { rows: save({ person: 'q8-j2' }), id };
}
if (process.argv[1]?.endsWith('j2-providers.mjs')) { const { rows } = await run(); await closeBrowser(); log(`${rows.filter((r) => r.ok).length}/${rows.length} passed`); }
