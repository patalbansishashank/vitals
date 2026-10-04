// Q4 scripted model: an OpenAI-compatible chat-completions server (streaming, tools) for the Coach journeys.
// It follows qa/fixtures/Q4/script.json: a rule matches the person's last message; the rule's steps answer in order
// (step N = the Nth assistant reply after that message). Steps name tool calls (with {{date}}-style placeholders), plain
// text, or a dynamic handler below. One-shot JSON calls (recipes, goal suggestion, lab rows, the self-test) are
// answered by schema name. Every request is appended (Authorization redacted) to the log given in Q4_LOG.
//   node qa/scripts/Q4/fakeprovider.mjs [port]      (default 4192)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = JSON.parse(fs.readFileSync(path.join(here, '../../fixtures/Q4/script.json'), 'utf8'));
const PORT = Number(process.argv[2] || process.env.Q4_PORT || 4192);
let LOG = process.env.Q4_LOG || path.join(here, '../../../.e6-tmp/q4-provider.jsonl');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

// ---------------------------------------------------------------- placeholders
const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
function nextDow(s, name) { const want = DOW[name]; for (let k = 1; k <= 7; k++) { const t = addDays(s, k); if (new Date(t + 'T12:00:00Z').getUTCDay() === want) return t; } }
function fill(v, env) {
  if (typeof v === 'string') {
    const whole = v.match(/^\{\{(.+)\}\}$/);
    const f = (expr) => {
      expr = expr.trim();
      let m;
      if (expr === 'date') return env.date;
      if ((m = expr.match(/^date([+-]\d+)$/))) return addDays(env.date, Number(m[1]));
      if ((m = expr.match(/^next:(\w{3})$/))) return nextDow(env.date, m[1]);
      if ((m = expr.match(/^var:(\w+)$/))) return env.vars[m[1]];
      if (expr === 'attachment') return (env.userText.match(/attachmentId "([^"]+)"/) || [])[1] || 'missing';
      return '{{' + expr + '}}';
    };
    if (whole) return f(whole[1]);
    return v.replace(/\{\{([^}]+)\}\}/g, (_, e) => String(f(e)));
  }
  if (Array.isArray(v)) return v.map((x) => fill(x, env));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, env)]));
  return v;
}

// ---------------------------------------------------------------- helpers over the request
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text || '').join(' ') : '');
function toolResults(msgs, since) {
  const out = [];
  for (let i = since; i < msgs.length; i++) if (msgs[i].role === 'tool') { let j; try { j = JSON.parse(textOf(msgs[i].content)); } catch { j = { raw: textOf(msgs[i].content) }; } const call = msgs.slice(0, i).reverse().find((m) => m.tool_calls?.some((t) => t.id === msgs[i].tool_call_id)); const name = call?.tool_calls.find((t) => t.id === msgs[i].tool_call_id)?.function.name; out.push({ name, result: j }); }
  return out;
}

// ---------------------------------------------------------------- dynamic handlers (need data from earlier tool results)
const DYNAMIC = {
  /** After planner_result: start the rung named in vars.want ('recommended' → the first option). */
  startRung(env) {
    const pr = env.results.filter((r) => r.name === 'planner_result').pop();
    const opts = pr?.result?.data?.options ?? [];
    const want = env.vars.want;
    // a naive model tries the Ideal anyway; the app must refuse it (the Ideal is never started)
    if (want === 'ideal') {
      const tried = env.results.find((r) => r.name === 'plan_start');
      if (!tried) return { tools: [{ name: 'plan_start', args: { source: { rung: 'ideal' }, startDate: env.date } }] };
      return { text: `The Ideal cannot be started as a plan (${tried.result?.summary ?? 'refused'}). I can start the Hard, Medium or Easy plan instead.` };
    }
    const rung = want === 'recommended' ? (opts[0] ? { A: 'hard', B: 'medium', C: 'easy' }[opts[0].id] ?? 'medium' : 'medium') : want;
    return { tools: [{ name: 'plan_start', args: { source: { rung }, startDate: env.date, name: `Coach: ${rung}` } }] };
  },
};

// ---------------------------------------------------------------- one-shot JSON answers by schema name
function jsonAnswer(name, j, all) {
  const user = textOf([...(j.messages || [])].reverse().find((m) => m.role === 'user')?.content);
  if (name === 'ok_check') return { ok: true };
  if (name === 'goal_suggestion') {
    // Echo the rule-based suggestion (the oracle) with a plainer reason; never adds a goal the rules did not.
    const m = user.match(/RULES SUGGESTION:\s*([\s\S]*)$/);
    let rule = {};
    try { rule = JSON.parse(m[1].trim().replace(/^```(json)?|```$/g, '')); } catch { try { rule = JSON.parse(m[1].slice(m[1].indexOf('{'), m[1].lastIndexOf('}') + 1)); } catch {} }
    const r = rule.suggestion ?? rule;
    if (MODE.goals === 'contradict') return { ...r, goals: [{ metric: 'fatMass', mode: 'gain', target: 8, unit: 'kg', why: 'More mass.' }, ...(r.goals || []).slice(1)] };
    return r;
  }
  if (name === 'propose_day_meals') return recipes(user, all);
  if (name === 'lab_rows') {
    // the photo fixture's rows, as a vision model would read them (synthetic report, qa/fixtures/markers)
    const exp = JSON.parse(fs.readFileSync(path.join(here, '../../fixtures/markers/photo-report.expected.json'), 'utf8'));
    return { sampleDate: exp.sampleDate, rows: (exp.tierA || []).map((r) => ({ marker: r.markerId, nameOnReport: r.nameOnReport, value: r.value, unit: r.unit })) };
  }
  return {};
}
function recipes(user, all) {
  let req = {};
  try { req = JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1)); } catch {}
  const allowed = req.ALLOWED || req.allowed || [];
  const ids = (allowed.map ? allowed : []).map((a) => (typeof a === 'string' ? { id: a, name: a } : { id: a.foodId || a.id, name: a.name || a.label || a.foodId || a.id }));
  const pick = (re, n = 1) => ids.filter((x) => re.test(`${x.id} ${x.name}`)).slice(0, n);
  const slots = req.targets ? Object.keys(req.targets) : ['lunch', 'dinner'];
  const hasAirFryer = /air.?fryer/i.test(all);
  const pantry = [...pick(/paneer/i), ...pick(/spinach|palak/i)];
  const base = pantry.length ? pantry : ids.slice(0, 2);
  const extra = [...pick(/lentil|dal/i), ...pick(/rice/i), ...pick(/yogh?urt|curd/i)];
  const meals = slots.slice(0, 4).map((slot, i) => ({
    slot,
    dish: ['Air-fried paneer with spinach', 'Spinach dal with rice', 'Paneer bhurji with spinach and curd'][i % 3],
    ingredients: [...base, ...extra].map((x, k) => ({ foodId: x.id, grams: k === 0 ? 120 : 100 })),
    steps: i === 0 && hasAirFryer
      ? ['Cube the paneer and toss with spices.', 'Air fry at 180 °C for 10 minutes, turning once.', 'Wilt the spinach in a pan and serve together.']
      : ['Cook the dal until soft.', 'Stir in chopped spinach and the paneer cubes.', 'Season and serve. No roti.'],
  }));
  return { meals };
}

// ---------------------------------------------------------------- the handler
let n = 0;
let MODE = {}; // POST /__mode {"goals":"contradict"} → the next goal suggestions disagree with the rules
function answer(j) {
  const msgs = j.messages || [];
  const all = JSON.stringify(msgs);
  const tools = (j.tools || []).map((t) => t.function?.name);
  // provider self-test (Settings › Test connection)
  if (tools.includes('ping_echo')) return msgs.at(-1)?.role === 'tool' ? { text: 'done' } : { tools: [{ name: 'ping_echo', args: { n: 3 } }, { name: 'ping_echo', args: { n: 4 } }] };
  const schema = j.response_format?.json_schema?.name || (all.match(/\b(propose_day_meals|goal_suggestion|lab_rows|ok_check|meal_photo)\b/) || [])[1];
  if (schema && !tools.length) return { text: JSON.stringify(jsonAnswer(schema, j, all)) };
  if (!tools.length && /image_url|"type":"image"/.test(all)) return { text: '6' };
  // a Coach turn: last person message + how many assistant replies since
  let ui = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { ui = i; break; }
  const userText = textOf(msgs[ui]?.content);
  const step = msgs.slice(ui + 1).filter((m) => m.role === 'assistant').length;
  const date = (userText.match(/date[^0-9]{0,12}(\d{4}-\d{2}-\d{2})/) || all.match(/\b(20\d\d-\d\d-\d\d)\b/) || [])[1] || iso(new Date());
  if (!tools.length) return { text: 'Done.' }; // last step of a turn is sent without tools
  // exploration helper: "QA call <tool> <json args>" calls that one tool, then reports the result
  const qa = userText.match(/QA call (\w+) (\{.*\})/);
  if (qa) return step === 0 ? { tools: [{ name: qa[1], args: JSON.parse(qa[2]) }] } : { text: 'Result: ' + JSON.stringify(toolResults(msgs, ui + 1).map((r) => r.result.summary ?? r.result)).slice(0, 600) };
  const rule = SCRIPT.rules.find((r) => new RegExp(r.user, 'i').test(userText));
  if (!rule) return { text: SCRIPT.fallback };
  const s = rule.steps[step];
  const env = { date, userText, vars: rule.vars || {}, results: toolResults(msgs, ui + 1) };
  if (!s) {
    const refused = env.results.filter((r) => r.result && r.result.ok === false);
    if (refused.length && refused.length === env.results.filter((r) => !/^get_|_get$|_result$/.test(r.name || '')).length) return { text: 'That did not work: ' + refused.map((r) => r.result.summary).join(' ') };
    const note = refused.length ? ' Not done: ' + refused.map((r) => r.result.summary).join(' ') : '';
    return { text: fill(rule.done || 'Done.', env) + note };
  }
  if (s.dynamic) return DYNAMIC[s.dynamic](env);
  if (s.tools) return { tools: s.tools.map((t) => ({ name: t.name, args: fill(t.args || {}, env) })) };
  return { text: fill(s.text, env) };
}

function send(res, j, out) {
  const id = 'chatcmpl-q4-' + ++n;
  const usage = { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 };
  const calls = (out.tools || []).map((t, i) => ({ index: i, id: `call_q4_${n}_${i}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } }));
  if (!j.stream) {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    const message = calls.length ? { role: 'assistant', content: null, tool_calls: calls.map(({ index, ...c }) => c) } : { role: 'assistant', content: out.text };
    return res.end(JSON.stringify({ id, object: 'chat.completion', model: j.model, choices: [{ index: 0, message, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage }));
  }
  res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const chunk = (delta, fr = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: j.model, choices: [{ index: 0, delta, finish_reason: fr }] })}\n\n`);
  chunk({ role: 'assistant', content: '' });
  if (calls.length) { chunk({ tool_calls: calls }); chunk({}, 'tool_calls'); }
  else { for (const w of String(out.text).match(/[\s\S]{1,40}/g) || ['']) chunk({ content: w }); chunk({}, 'stop'); }
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: j.model, choices: [], usage })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/__log') { LOG = body.trim(); res.writeHead(200, cors); return res.end('ok'); }
    if (req.method === 'POST' && req.url === '/__mode') { try { MODE = JSON.parse(body || '{}'); } catch { MODE = {}; } res.writeHead(200, cors); return res.end('ok'); }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const auth = req.headers.authorization ? 'present' : 'absent';
    if (req.method === 'GET' && req.url.endsWith('/models')) { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: [{ id: 'q4-scripted', object: 'model', owned_by: 'qa' }] })); }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404, cors); return res.end('{}'); }
    let j = {};
    try { j = JSON.parse(body); } catch {}
    let out;
    try { out = answer(j); } catch (e) { out = { text: 'scripted model error: ' + e.message }; }
    fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), url: req.url, authorization: auth, request: j, reply: out }) + '\n');
    send(res, j, out);
  });
}).listen(PORT, '127.0.0.1', () => console.log('q4 scripted model on', PORT));
