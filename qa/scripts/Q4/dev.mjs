// dev helper: node qa/scripts/Q4/dev.mjs <profile> <from-profile|keep> <desktop|tablet|mobile> "<js using page, go, read, say, …>"
import * as L from './lib.mjs';
const [name, from, vp, code] = process.argv.slice(2);
const { page, errors, ctx } = await L.openProfile(name, { from: from === 'keep' ? null : from, keep: from === 'keep', vp });
const { dump, go, read, mainText, sleep, btn, say, cards, coachLog, lastTurnText, cardButton, planNow, events, shot } = L;
try { await eval(`(async () => { ${code} })()`); } catch (e) { console.log('ERR', e.message.split('\n')[0]); await dump(page, 'at-err'); }
console.log('ERRORS', errors);
await ctx.close();
