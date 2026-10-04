// Fake OpenAI-compatible endpoint for Coach QA. 127.0.0.1:4190
import http from 'node:http';
import fs from 'node:fs';
const LOG = '/media/DEV/tmp/liv-fakeai.log';
const TOOL = process.env.TOOL || 'log_meal';
const ARGS = { components: [{ name: 'dal', grams: 150 }, { name: 'rice', grams: 200 }], method: 'aiText', slot: 'lunch', clockH: 13, text: 'dal and rice for lunch', confidence: 0.8 };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
let n = 0;
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${req.method} ${req.url} ${body.slice(0, 200000)}\n`);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method === 'GET' && req.url.endsWith('/models')) { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model', owned_by: 'qa' }] })); }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404, cors); return res.end('{}'); }
    let j = {}; try { j = JSON.parse(body); } catch {}
    const msgs = j.messages || [];
    const last = msgs[msgs.length - 1] || {};
    const hasTools = Array.isArray(j.tools) && j.tools.some((t) => t.function?.name === TOOL);
    const toolTurn = last.role !== 'tool' && hasTools && /lunch|ate|had/i.test(JSON.stringify(last.content || ''));
    const id = 'chatcmpl-' + ++n;
    const ping = Array.isArray(j.tools) && j.tools.some((t) => t.function?.name === 'ping_echo') && last.role !== 'tool';
    const json = !!j.response_format;
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    const text = json ? '{"ok": true}' : last.role === 'tool' ? 'Logged your lunch: dal and rice, about 500 kcal.' : 'Hello from the fake model.';
    const call = { id: 'call_' + n, type: 'function', function: { name: TOOL, arguments: JSON.stringify(ARGS) } };
    if (ping) {
      const calls = [3, 4].map((k, i) => ({ index: i, id: `call_p${n}_${k}`, type: 'function', function: { name: 'ping_echo', arguments: JSON.stringify({ n: k }) } }));
      if (!j.stream) { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id, object: 'chat.completion', model: j.model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: calls.map(({ index, ...c }) => c) }, finish_reason: 'tool_calls' }], usage })); }
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: j.model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: calls }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: j.model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage })}\n\n`);
      res.write('data: [DONE]\n\n'); return res.end();
    }
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
    } else {
      for (const w of text.match(/.{1,12}/g)) send(ch({ content: w }));
      send(ch({}, 'stop'));
    }
    send({ id, object: 'chat.completion.chunk', model: j.model, choices: [], usage });
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(4190, '127.0.0.1', () => console.log('fakeai on 4190'));
