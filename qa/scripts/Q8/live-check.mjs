// Live acceptance after a release: the LIVE site (https://vitals.creative.desi, no local build, no request mapping)
// creates a sync group on oci-arm, a server person joins it, the site pairs by code, and the device route answers.
//   node qa/scripts/Q8/live-check.mjs
import { openProfile, setUpSync, addPerson, pairCode, pairByCode, serverCall, personsRemove, closeBrowser, log, SERVER } from './lib.mjs';
const P = await openProfile('live-check', { map: false });
let id = null;
try {
  const phrase = await setUpSync(P, SERVER);
  log(`live site: sync group created on ${SERVER} (24 words, not printed: ${phrase.split(' ').length})`);
  id = await addPerson('q8-live-check', phrase);
  log(`server person q8-live-check ${id} joined the group`);
  const ok = await pairByCode(P, await pairCode(id, 'live check'), SERVER, 'live check');
  log(`live site paired to the server by code: ${ok}`);
  const st = await serverCall(P, 'GET', '/v1/pair/status');
  log(`GET /v1/pair/status: ${st.status} ${JSON.stringify(st.body).slice(0, 120)}`);
  const ai = await serverCall(P, 'GET', '/v1/ai/status').catch(() => ({ status: 'n/a' }));
  log(`GET /v1/ai/status: ${ai.status}`);
  log(`page errors: ${P.errors.filter((x) => x.startsWith('pageerror')).join(' | ').slice(0, 200) || 'none'}`);
} finally {
  await P.ctx.close().catch(() => {});
  await closeBrowser().catch(() => {});
  if (id) log(`remove live-check: ${await personsRemove(id)}`);
}
