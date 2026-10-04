// Q8 cleanup on oci-arm: for every person whose label starts with "q8-": revoke its devices and agent keys (so nothing
// reopens its worker), wait until the worker has closed (15 minutes idle; Q8_WAIT_MIN overrides), then `persons remove`.
// Never touches another person (lib.mjs refuses ids it did not create or adopt by label).
//   node qa/scripts/Q8/cleanup.mjs
import { adoptLeftovers, devicesList, devicesRevoke, personsRemove, personsList, sleep, log } from './lib.mjs';

const ids = await adoptLeftovers();
log(`q8 persons: ${ids.length}`);
for (const id of ids) for (const d of await devicesList(id)) log(`${id} revoke ${d.kind} ${d.label}: ${await devicesRevoke(id, d.id)}`);
const min = Number(process.env.Q8_WAIT_MIN ?? 16);
if (ids.length && min > 0) { log(`waiting ${min} min for the workers to close`); await sleep(min * 60000); }
for (const id of ids) log(`${id} remove: ${await personsRemove(id)}`);
const left = (await personsList()).filter((p) => p.label.startsWith('q8-'));
log(`q8 persons left: ${left.length}`);
