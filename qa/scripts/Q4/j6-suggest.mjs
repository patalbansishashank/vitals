// J6: "suggest goals from my answers" → goals.suggest source 'ai' through the Coach: same output shape as the
// rule-based suggester; an AI answer that contradicts the rules is replaced by the rule result with a plain note.
import { openProfile, go, read, say, results, providerLog, providerMode, ROOT, lastTurnText } from './lib.mjs';
import fs from 'node:fs';

const LOG = `${ROOT}/.e6-tmp/q4-J6.jsonl`;
const toolOutputs = (from) => fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(from).map((l) => JSON.parse(l)).flatMap((r) => r.request.messages.filter((m) => m.role === 'tool').map((m) => { try { return JSON.parse(m.content); } catch { return null; } })).filter((x) => x?.data?.version);
const lines = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0);
const keys = (o) => Object.keys(o).filter((k) => !['source', 'version', 'fallback'].includes(k)).sort().join(',');

export async function run({ vp = 'desktop' } = {}) {
  const { check, save } = results('J6-suggest');
  fs.rmSync(LOG, { force: true });
  await providerLog(LOG);
  await providerMode({});
  const { ctx, page, errors } = await openProfile('j6', { from: 'seed-base', vp });
  try {
    await go(page, '/coach');
    const rule = await read(page, 'goals.suggest', { source: 'rule' });
    check('rule-based suggestion available from the Coach page', rule.source === 'rule' && rule.goals.length > 0, JSON.stringify(rule).slice(0, 160));
    let n0 = lines();
    await say(page, 'suggest goals from my answers');
    const ai = toolOutputs(n0).at(-1)?.data;
    check('the Coach called goals_suggest (source ai) and got an answer', ai?.source === 'ai', JSON.stringify(ai ?? null).slice(0, 160));
    check('same output shape as the rule-based suggester', ai && keys(ai) === keys(rule) && ai.goals.every((g) => 'metric' in g && 'mode' in g && 'why' in g), `${ai && keys(ai)} vs ${keys(rule)}`);
    check('AI goals do not contradict the rules (same metric and direction for the first goals)', ai && rule.goals.slice(0, 2).every((g, i) => ai.goals[i]?.metric === g.metric && ai.goals[i]?.mode === g.mode), JSON.stringify(ai?.goals?.map((g) => [g.metric, g.mode])));
    check('AI limits equal the rules limits', ai && JSON.stringify(ai.constraints) === JSON.stringify(rule.constraints));
    check('Coach reply is plain text, no raw JSON', !/[{}]/.test(await lastTurnText(page)));
    await providerMode({ goals: 'contradict' });
    n0 = lines();
    await say(page, 'suggest goals from my answers again');
    const bad = toolOutputs(n0).at(-1)?.data;
    check('a contradicting AI answer is replaced by the rule result with a note', bad && bad.goals[0]?.mode === rule.goals[0].mode && /built-in rules/.test(bad.fallback ?? ''), JSON.stringify(bad ?? null).slice(0, 220));
    check('nothing was written by a suggestion', (await read(page, 'goals.get')).goals.length === 0);
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  await providerMode({});
  check('no console or page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
  return save();
}
if (process.argv[1]?.endsWith('j6-suggest.mjs')) { const rows = await run(); console.table(rows.map((r) => ({ name: r.name, ok: r.ok }))); }
