// J3 with the real ChatGPT sign-in on oci-arm (run by the orchestrator with the owner present, one command):
//
//   pnpm build && node qa/scripts/Q8/j3-siwc.mjs
//
// What it does: creates a throwaway person `q8-siwc` on oci-arm that joins this browser profile's own new sync group
// (never the owner's person or data), pairs the profile by code, then waits (up to 20 min) until that person is signed
// in to ChatGPT on the server. The owner signs in once, in a second terminal, with the fallback of docs/SERVER.md:
//
//   ssh vitals-server 'node ~/vitals-server/current/bin/vitals-server.mjs siwc login <id printed below> --callback-port 1455 --ssh-host vitals-server'
//   ssh -N -L 1455:127.0.0.1:1455 vitals-server      # then open the printed sign-in address in this PC's browser
//
// (`siwc login` needs the vitals-server CLI fix of Q8-01, i.e. a deploy of this branch.) Then: "Sign in with ChatGPT
// (via your server)" is chosen in Settings › Coach and the same journeys as j3-coach.mjs are typed into the Coach.
// Expected assertions (the stand-in run asserts the same, plus the stand-in's request log):
//   - the ChatGPT block reads "Signed in on your server"; the siwc chip reads "signed in"; Test connection passes
//   - a plan starts through the Coach (goals_edit, planner_find, plan_start proposal applied)
//   - "change my training days to Tue/Thu" → plan.shift proposals pending, nothing applied; Apply + adopt → Monday no
//     training, Tuesday training; Undo restores
//   - "I ate dal, rice and two eggs" → a meal with dal, rice, eggs in log.get, energy with a band, committed by actor ai
//   - "I did 30 min on the treadmill" → a 30-minute treadmill session; Undo on the card retracts it
//   - "I'm travelling for three days" → plan.declareEvent (travel) pending; adopted → three days without training; Undo
//   - "suggest goals from my answers" → a plain-text reply; goals unchanged
//   - /v1/ai/usage counts the requests; nothing written to localStorage/IndexedDB holds a ChatGPT token
// A real model may word or order its calls differently; failures are listed per check in qa/results/Q8-J3-siwc.json.
// At the end it signs the person out on the server (POST /v1/ai/siwc/logout) and removes q8-siwc.
import { results, openProfile, go, read, pairByCode, addPerson, pairCode, setUpSync, serverCall, sleep, closeBrowser, log, mainText, personsRemove, devicesList, devicesRevoke } from './lib.mjs';
import { coachJourneys, seedProfile, makePlan, chooseServerPreset } from './coach-lib.mjs';

const { check, save } = results('J3-siwc');
const P = await openProfile('j3-siwc');
let id = null;
try {
  check('first run through the intake', await seedProfile(P));
  const phrase = await setUpSync(P);
  id = await addPerson('q8-siwc', phrase);
  check('paired by code', await pairByCode(P, await pairCode(id, 'Q8 siwc'), undefined, 'Q8 siwc'));
  console.log(`\nPerson for the sign-in: ${id}\nOwner: run the two commands in the header of this script now (waiting up to 20 min).\n`);
  let signed = false;
  for (let i = 0; i < 120 && !signed; i++) { signed = (await serverCall(P, 'GET', '/v1/ai/siwc/status')).body?.signedIn === true; if (!signed) await sleep(10000); }
  check('signed in to ChatGPT on the server for q8-siwc', signed);
  if (signed) {
    check('Settings › Coach: Sign in with ChatGPT (via your server) chosen and saved', await chooseServerPreset(P, 'siwc', null));
    check('the ChatGPT block reads "Signed in on your server"', /Signed in on your server/.test(await mainText(P)));
    const plan = await makePlan(P);
    check('a plan started through the Coach', plan.ok, plan.detail);
    for (const r of await coachJourneys(P, { tag: '-siwc' })) check(r.name, r.ok, r.detail);
    const usage = await serverCall(P, 'GET', '/v1/ai/usage');
    check('the server counted the requests', usage.body?.today?.requests > 0, JSON.stringify(usage.body));
    const leak = await P.page.evaluate(() => JSON.stringify(localStorage).match(/eyJ[\w-]{20,}\.[\w-]{20,}/) !== null);
    check('no ChatGPT token in localStorage', !leak);
  }
} catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
if (id) {
  // SIWC_KEEP=1: the sign-in was MOVED here from the owner's PC and must survive for the owner's person (no logout, no removal)
  if (!process.env.SIWC_KEEP) await serverCall(P, 'POST', '/v1/ai/siwc/logout').catch(() => {});
  for (const d of await devicesList(id)) await devicesRevoke(id, d.id);
  if (process.env.SIWC_KEEP) log(`q8-siwc ${id} kept: it holds the moved ChatGPT sign-in`);
  else log(`remove q8-siwc after its worker idles (15 min): ${await personsRemove(id)}`);
}
await P.ctx.close();
await closeBrowser();
const rows = save({ preset: 'siwc' });
log(`${rows.filter((r) => r.ok).length}/${rows.length} passed`);
