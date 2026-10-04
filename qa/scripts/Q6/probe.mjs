// Dumps headings and controls of routes on a copy of a seeded profile. usage: node probe.mjs <profile> <route…>
import { openProfile, go, dump } from './lib.mjs';
const [from, ...routes] = process.argv.slice(2);
const { page, errors, close } = await openProfile('probe', { from });
for (const r of routes) { await go(page, r); await dump(page, r); }
console.log('ERRORS', errors);
await close();
