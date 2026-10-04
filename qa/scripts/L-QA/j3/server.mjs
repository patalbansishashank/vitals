// J3 server side: the test person `L-QA-J3-<hhmm>` (created without --join: the server holds the person's sync key and
// hands it to each paired device, decision 5), pairing codes, agent tokens, removal. Only L-QA-J3- labels are touched;
// codes and tokens stay in memory, never printed. Person ids of this journey are kept in .e6-tmp/j3/state.json.
import fs from 'node:fs';
import { sshRun, personsList, agentToken } from './harness/lib/server.mjs';
import { TMP, cfg } from './apps.mjs';

const VS = 'node ~/vitals-server/current/bin/vitals-server.mjs';
const SSH = cfg.serverSsh;
const STATE = `${TMP}/j3/state.json`;
export const PREFIX = 'L-QA-J3-';
export const state = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {});
export const saveState = (s) => {
  fs.mkdirSync(`${TMP}/j3`, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 1), { mode: 0o600 });
};
const safe = (s) => {
  if (!/^[A-Za-z0-9 _./:-]+$/.test(s)) throw new Error('unsafe argument');
  return `'${s}'`;
};
async function mustBeOurs(id) {
  if (id === cfg.ownerPersonId) throw new Error('refusing: the owner person');
  const p = (await personsList(SSH)).find((x) => x.id === id);
  if (!p) return null;
  if (!p.label.startsWith(PREFIX)) throw new Error(`refusing to touch ${id}: label not ${PREFIX}…`);
  return p;
}
export async function addPerson(label) {
  if (!label.startsWith(PREFIX)) throw new Error('bad label');
  const r = await sshRun(SSH, `${VS} persons add ${safe(label)} --tz Asia/Kolkata`);
  const m = r.stdout.match(/([0-9a-f]{16})\s+L-QA-J3-/);
  if (!m) throw new Error(`persons add failed: ${r.stderr.slice(0, 200)}`);
  return m[1];
}
export async function pairCode(id, label) {
  await mustBeOurs(id);
  const r = await sshRun(SSH, `${VS} pair code ${id} --label ${safe(label)}`);
  const m = r.stdout.match(/Code (\d{8})/);
  if (!m) throw new Error(`pair code failed: ${r.stderr.slice(0, 200)}`);
  return m[1];
}
/** The pairing QR text (`vitals-server:1?u=…&c=…`), for a device that pairs by link; never printed. */
export async function pairQr(id, label) {
  await mustBeOurs(id);
  const r = await sshRun(SSH, `${VS} pair code ${id} --label ${safe(label)}`);
  const m = r.stdout.match(/vitals-server:1\?\S+/);
  return m ? m[0] : null;
}
export async function token(id) {
  await mustBeOurs(id);
  return agentToken(SSH, id);
}
export async function revokeToken(id, tokenId) {
  await mustBeOurs(id);
  return (await sshRun(SSH, `${VS} agent-token revoke ${id} ${safe(tokenId)}`)).stdout.trim();
}
export async function devices(id) {
  await mustBeOurs(id);
  return (await sshRun(SSH, `${VS} devices list ${id}`)).stdout;
}
export async function removePerson(id) {
  const p = await mustBeOurs(id);
  if (!p) return 'not found';
  const r = await sshRun(SSH, `${VS} persons remove ${id}`);
  return (r.stdout.trim() || r.stderr.trim()).slice(0, 200);
}
export { personsList, sshRun };
export const listPersons = () => personsList(SSH);
