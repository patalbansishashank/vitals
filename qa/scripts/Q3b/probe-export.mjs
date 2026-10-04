// Q3b probe: seed, search (quick), start a rung, export all data (data.export) to .e6-tmp/q3b-<rung>.json; then try plan.replan's UI path.
import fs from 'node:fs';
import { fresh, read, closeAll, ROOT } from '../Q3/lib.mjs';
import { search, startRung } from '../Q3/j5-lib.mjs';
const rung = process.argv[2] || 'Medium';
const { page, errors } = await fresh('desktop');
console.log('search secs', await search(page));
const plan = await startRung(page, rung);
console.log('plan', JSON.stringify(plan).slice(0, 300));
const ex = await read(page, 'data.export');
fs.writeFileSync(`${ROOT}/.e6-tmp/q3b-${rung}.json`, ex.text);
console.log('exported', ex.bytes, 'errors', errors);
await closeAll();
