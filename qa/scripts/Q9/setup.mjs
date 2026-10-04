// Q9 setup on oci-arm: a browser profile with a person's answers and a sync group on the server's relay, a server
// person `q9-<name>` that joins that group, the profile paired by code. State (ids only) in .e6-tmp/q9/state-<name>.json.
//
//   node qa/scripts/Q9/setup.mjs a        # profile "a", person q9-a
//   node qa/scripts/Q9/setup.mjs b nojoin # profile "b": sync group only, no server person
import { join as join_ } from 'node:path';
import { ORIGIN, TMP, addPerson, listPersons, removePerson, checker, keep, log, pairBrowser, pairCode, profile, qaRead, seedProfile, setUpSync, startPreview, waitQa } from './lib.mjs';

const name = process.argv[2] || 'a';
const local = process.argv[3] === 'local'; // no server at all: the journey-1 events imported from a file
const join = !local && process.argv[3] !== 'nojoin';
const c = checker();
c.journey(`setup ${name}`);
const preview = await startPreview();
const { ctx, page, errors } = await profile(name, { fresh: true });
let state = { name };
try {
  await seedProfile(page);
  if (local) {
    await page.goto(`${ORIGIN}/settings?section=devices&qa=1`, { waitUntil: 'load' });
    await page.locator('input[type=file][aria-label="Choose a file…"]').setInputFiles(join_(TMP, 'j1-same-events.jsonl'));
    const ok = await page.getByText(/records · .* samples/).first().waitFor({ timeout: 60000 }).then(() => true, () => false);
    c.check('journey-1 events imported from a file (local profile, no server)', ok);
    throw Object.assign(new Error('local'), { done: true });
  }
  const phrase = await setUpSync(page);
  c.check('sync group created on the server relay (24 words, not printed)', phrase.split(' ').length === 24);
  await waitQa(page);
  log(`sync.status: ${JSON.stringify((await qaRead(page, 'sync.status')).output ?? {}).slice(0, 200)}`);
  if (join) {
    for (const p of listPersons()) if (p.label === `q9-${name}`) log(`old q9-${name}: ${removePerson(p.id)}`);
    const id = addPerson(`q9-${name}`, phrase);
    state.personId = id;
    c.check(`server person q9-${name} joins the group`, /^[0-9a-f]{16}$/.test(id), id);
    const paired = await pairBrowser(page, pairCode(id, `Q9 ${name}`));
    c.check('browser paired by code (device token kept in the page)', paired);
  }
} catch (e) {
  if (!e.done) c.check('no exception', false, e.message.split('\n')[0]);
} finally {
  keep(`state-${name}.json`, state);
  log(`browser errors: ${errors.slice(0, 5).join(' || ')}`);
  await ctx.close();
  preview?.kill();
}
process.exit(c.checks.every((x) => x.ok) ? 0 : 1);
