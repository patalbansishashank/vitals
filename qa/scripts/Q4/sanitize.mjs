// Writes .e6-tmp/q4-J*.jsonl (the scripted model's request log) as compact fixtures in qa/fixtures/Q4/exchanges/:
// per request the turn so far (from the person's last message), tool schemas as names, long texts cut. The request
// log never holds an Authorization value (only present/absent).
import fs from 'node:fs';
import { ROOT } from './lib.mjs';

export function sanitize() {
  fs.mkdirSync(`${ROOT}/qa/fixtures/Q4/exchanges`, { recursive: true });
  const cut = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + `…[${s.length - n} more]` : s);
  const content = (c) => (Array.isArray(c) ? c.map((p) => (p.image_url ? { type: 'image_url', image_url: { url: cut(p.image_url.url, 60) } } : { ...p, text: cut(p.text, 1200) })) : cut(c, 1200));
  for (const f of fs.readdirSync(`${ROOT}/.e6-tmp`).filter((x) => /^q4-J\d\.jsonl$/.test(x))) {
    const out = fs.readFileSync(`${ROOT}/.e6-tmp/${f}`, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
      const j = JSON.parse(l);
      const msgs = j.request.messages ?? [];
      let u = msgs.length - 1;
      while (u > 0 && msgs[u].role !== 'user') u--;
      const turn = msgs.slice(Math.max(u, 0));
      return JSON.stringify({
        authorization: j.authorization,
        model: j.request.model,
        tools: (j.request.tools ?? []).length,
        schema: j.request.response_format?.json_schema?.name ?? null,
        system: cut(msgs[0]?.role === 'system' ? msgs[0].content : '', 200),
        turn: turn.map((m) => ({ role: m.role, ...(m.tool_calls ? { tool_calls: m.tool_calls.map((c) => ({ name: c.function.name, arguments: cut(c.function.arguments, 400) })) } : {}), content: content(m.content) })),
        reply: j.reply,
      });
    });
    fs.writeFileSync(`${ROOT}/qa/fixtures/Q4/exchanges/${f.replace('q4-', '')}`, out.join('\n') + '\n');
  }
}
if (process.argv[1]?.endsWith('sanitize.mjs')) sanitize();
