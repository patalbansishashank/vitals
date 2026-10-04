// Fake OpenAI-compatible endpoint (QA-B). PORT env (default 4193). Control: POST /__mode {mode:'ok'|'error'|'slow'|'empty'}
import http from 'node:http';
import fs from 'node:fs';
const PORT = +(process.env.PORT || 4193);
const LOG = '/media/DEV/Hobby/Lumen Health/.tmp-q1b/fake-b.log';
const TOOL = 'log_meal';
const ARGS = { components: [{ name: 'dal', grams: 150 }, { name: 'rice', grams: 200 }], method: 'aiText', slot: 'lunch', clockH: 13, text: 'dal and rice for lunch', confidence: 0.8 };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
let mode = 'ok', n = 0;
const pick = (allowed, re) => (allowed.find((a) => re.test(a.name || '')) || allowed[0])?.id;
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${req.method} ${req.url} ${body.slice(0, 6000)}\n`);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.url === '/__mode') { mode = JSON.parse(body).mode; res.writeHead(200, cors); return res.end(mode); }
    if (req.method === 'GET' && req.url.endsWith('/models')) { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model', owned_by: 'qa' }] })); }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404, cors); return res.end('{}'); }
    let j = {}; try { j = JSON.parse(body); } catch {}
    const msgs = j.messages || [];
    const last = msgs[msgs.length - 1] || {};
    const sys = JSON.stringify(msgs[0]?.content || '');
    const isRecipe = /You plan meals/.test(sys);
    const hasTools = Array.isArray(j.tools) && j.tools.some((t) => t.function?.name === TOOL);
    const toolTurn = !isRecipe && last.role !== 'tool' && hasTools && /lunch|ate|had/i.test(JSON.stringify(last.content || ''));
    const id = 'chatcmpl-' + ++n;
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    let text = last.role === 'tool' ? 'Logged your lunch: dal and rice, about 500 kcal.' : 'Hello from the fake model.';
    if (j.response_format && !isRecipe) text = '{"ok": true}';
    if (isRecipe) {
      if (mode === 'slow') await new Promise((r) => setTimeout(r, 7000));
      if (mode === 'error') { res.writeHead(500, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'boom' } })); }
      let u = {}; try { u = JSON.parse(msgs[msgs.length - 1].content?.[0]?.text ?? msgs[msgs.length - 1].content); } catch {}
      const allowed = u.ALLOWED || [];
      const slots = Object.keys(u.targets || {});
      fs.appendFileSync(LOG, `RECIPE-REQ slots=${slots} allowed=${allowed.length} ${JSON.stringify(allowed.slice(0, 12))}\n`);
      const grain = pick(allowed, /rice|roti|oat|bread/i), prot = pick(allowed, /dal|lentil|paneer|egg|chicken|tofu|curd|yogh?urt/i), veg = pick(allowed, /spinach|vegetable|tomato|onion|carrot|cauli/i);
      const meals = mode === 'empty' ? [] : slots.map((s, i) => ({
        slot: s, dish: i === 0 ? 'QA dal bowl' : 'QA second dish ' + s, cuisine: 'Indian', activeMin: 15, equipment: ['pan'],
        ingredients: [{ foodId: prot, grams: 150 }, { foodId: grain, grams: 150 }, ...(veg ? [{ foodId: veg, grams: 100 }] : [])],
        steps: ['Cook the grain.', 'Simmer the rest.', 'Serve.'],
        // deliberately wrong claims the app must ignore
        kcal: 9999, protein_g: 1, claimed: 'about 9999 kcal and 1 g protein',
      }));
      text = JSON.stringify({ meals });
    }
    const ping = Array.isArray(j.tools) && j.tools.some((t) => t.function?.name === 'ping_echo') && last.role !== 'tool';
    if (ping) {
      const calls = [3, 4].map((k, i) => ({ index: i, id: `call_p${n}_${k}`, type: 'function', function: { name: 'ping_echo', arguments: JSON.stringify({ n: k }) } }));
      if (!j.stream) { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id, object: 'chat.completion', model: j.model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: calls.map(({ index, ...c }) => c) }, finish_reason: 'tool_calls' }], usage })); }
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: j.model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: calls }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: j.model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage })}\n\n`);
      res.write('data: [DONE]\n\n'); return res.end();
    }
    const call = { id: 'call_' + n, type: 'function', function: { name: TOOL, arguments: JSON.stringify(ARGS) } };
    if (!j.stream) {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      const message = toolTurn ? { role: 'assistant', content: null, tool_calls: [call] } : { role: 'assistant', content: text };
      return res.end(JSON.stringify({ id, object: 'chat.completion', model: j.model, choices: [{ index: 0, message, finish_reason: toolTurn ? 'tool_calls' : 'stop' }], usage }));
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const ch = (delta, fr = null) => ({ id, object: 'chat.completion.chunk', model: j.model, choices: [{ index: 0, delta, finish_reason: fr }] });
    send(ch({ role: 'assistant', content: '' }));
    if (toolTurn) {
      const a = call.function.arguments;
      send(ch({ tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: TOOL, arguments: a.slice(0, 30) } }] }));
      send(ch({ tool_calls: [{ index: 0, function: { arguments: a.slice(30) } }] }));
      send(ch({}, 'tool_calls'));
    } else { for (const w of text.match(/[\s\S]{1,200}/g) || ['']) send(ch({ content: w })); send(ch({}, 'stop')); }
    send({ id, object: 'chat.completion.chunk', model: j.model, choices: [], usage });
    res.write('data: [DONE]\n\n'); res.end();
  });
}).listen(PORT, '127.0.0.1', () => console.log('fake on', PORT));
