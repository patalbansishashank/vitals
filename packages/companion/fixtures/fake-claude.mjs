#!/usr/bin/env node
// A stand-in for Claude Code in the server coach tests (src/coach/coach.test.ts). It speaks the parts of the real CLI
// the coach uses: `auth status`, and `-p --input-format stream-json --output-format stream-json` turns with
// `--session-id` / `--resume`, keeping a transcript where Claude keeps it (<config dir>/projects/<slug of cwd>/<id>.jsonl).
//
// Control: $HOME/fake-claude.json ({ "loggedOut": true }); every run appends { argv, envKeys, token, cwd, input } to
// $HOME/fake-claude.log. The user text picks a scenario: [mcp] calls tools on the server's /mcp with $VITALS_TOKEN,
// [call:<tool> <json>] calls one tool, [slow:<ms>] waits, [think:<ms>] streams a thinking block then waits, [hang] never answers, [limit] fails on a usage limit, [crash] exits without a result.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const home = process.env.HOME ?? '/nonexistent';
const control = (() => {
  try {
    return JSON.parse(readFileSync(join(home, 'fake-claude.json'), 'utf8'));
  } catch {
    return {};
  }
})();
const argv = process.argv.slice(2);
// failures land in $HOME/fake-claude.err for the test to read
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => {
    appendFileSync(join(home, 'fake-claude.err'), `${e?.stack ?? e}\n`);
    process.exit(3);
  });
}
const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (argv[0] === 'auth') {
  out({ loggedIn: !control.loggedOut, authMethod: 'claude.ai' });
  process.exit(control.loggedOut ? 1 : 0);
}
if (argv[0] === '--version') {
  process.stdout.write('9.9.9 (Claude Code fake)\n');
  process.exit(0);
}

const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
const input = JSON.parse(stdin.split('\n')[0]);
const blocks = input.message.content;
const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
const images = blocks.filter((b) => b.type === 'image').map((b) => b.source.media_type);
appendFileSync(
  join(home, 'fake-claude.log'),
  `${JSON.stringify({ argv, envKeys: Object.keys(process.env).sort(), token: process.env.VITALS_TOKEN ?? null, home, cwd: process.cwd(), text, images })}\n`,
);

const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude');
const projectDir = join(configDir, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
const resume = flag('--resume');
const sessionId = resume ?? flag('--session-id');
const transcript = join(projectDir, `${sessionId}.jsonl`);
const fail = (message, status = null) => {
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: message, api_error_status: status, session_id: sessionId });
  process.exit(1);
};
if (resume && !existsSync(transcript)) fail(`No conversation found with session ID: ${resume}`);
if (!resume && existsSync(transcript)) fail(`Session ID ${sessionId} is already in use.`);
mkdirSync(projectDir, { recursive: true });
appendFileSync(transcript, `${JSON.stringify({ type: 'user', text })}\n`);
const turn = readFileSync(transcript, 'utf8').trim().split('\n').length;

out({ type: 'system', subtype: 'init', session_id: sessionId, tools: [], mcp_servers: [{ name: 'vitals', status: 'connected' }] });
const delta = (t) => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }, parent_tool_use_id: null, session_id: sessionId });
const textStart = () => out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null, session_id: sessionId });

const think = /\[think:(\d+)\]/.exec(text);
if (think) {
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, parent_tool_use_id: null, session_id: sessionId });
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me weigh this.' } }, parent_tool_use_id: null, session_id: sessionId });
  await sleep(Number(think[1]));
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' Done.' } }, parent_tool_use_id: null, session_id: sessionId });
}
if (text.includes('[crash]')) {
  process.stderr.write('fatal: something broke\n');
  process.exit(2);
}
if (text.includes('[limit]')) fail('Claude AI usage limit reached|1792786200', 429);
if (text.includes('[hang]')) {
  await sleep(600_000);
  process.exit(0);
}
const slow = /\[slow:(\d+)\]/.exec(text);
if (slow) await sleep(Number(slow[1]));

let answer = '';
// [call:<tool> <json args>] calls one tool; [mcp] calls today_get, goal_set and gauge_data_availability
const one = /\[call:(\w+) (\{.*?\})\]/.exec(text);
const plan = one ? [[one[1], JSON.parse(one[2])]] : text.includes('[mcp]') ? [['today_get', {}], ['goal_set', { weeks: 2 }], ['gauge_data_availability', {}]] : null;
if (plan) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const cfg = JSON.parse(readFileSync(flag('--mcp-config'), 'utf8')).mcpServers.vitals;
  const headers = Object.fromEntries(Object.entries(cfg.headers).map(([k, v]) => [k, v.replace(/\$\{(\w+)\}/g, (_m, n) => process.env[n] ?? '')]));
  const client = new Client({ name: 'fake-claude', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers } }));
  const names = (await client.listTools()).tools.map((t) => t.name);
  const results = [];
  for (const [i, [name, args]] of plan.entries()) {
    out({ type: 'stream_event', event: { type: 'content_block_start', index: i + 1, content_block: { type: 'tool_use', id: `toolu_${i}`, name: `mcp__vitals__${name}`, input: {} } }, parent_tool_use_id: null, session_id: sessionId });
    const r = await client.callTool({ name, arguments: args });
    results.push(`${name}:${r.structuredContent?.status ?? (r.isError ? 'error' : 'ok')}`);
  }
  await client.close();
  textStart();
  answer = `tools ${names.length}; ${results.join(', ')}`;
  delta(answer);
} else {
  textStart();
  const parts = [`turn ${turn}: `, `you said ${JSON.stringify(text.split('\n').at(-1))}`, images.length ? ` with ${images.join(',')}` : ''];
  for (const p of parts.filter(Boolean)) {
    delta(p);
    answer += p;
  }
}
out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: answer }] }, parent_tool_use_id: null, session_id: sessionId });
out({ type: 'result', subtype: 'success', is_error: false, result: answer, session_id: sessionId });
process.exit(0);
