// Q5: one run per agent host. Each gets the same prompt and returns its transcript, the Vitals tools it called and its
// final answer. Secrets never enter the prompt; transcripts are stripped by run.mjs before they are written.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { runCmd } from './lib.mjs';

export const prompt = (tag, day) => `You are checking the Vitals MCP server named "vitals". Use only its tools. Do these steps in order, then report in four short numbered lines:
1. Call today_get (or plan_get) and say in one line which plan is running and what it prescribes today.
2. Call log_note with {"date":"${day}","text":"${tag}: water 250 ml"}.
3. Call plan_declare_event with {"kind":"busy","from":"${day}","to":"${day}","note":"${tag}"} and report the "status" of its result.
4. Look at your list of vitals tools (do not call any other tool) and say whether a tool named plan_end or plan_replace is available.`;

const lines = (s) => s.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

/** Codex JSONL (`codex exec --json`): mcp_tool_call items. Shared by the Codex CLI and the ChatGPT app's bundled host. */
function codexLike(id, bin) {
  return {
    id, ext: 'jsonl',
    async run({ tag, day, dir }) {
      mkdirSync(dir, { recursive: true });
      if (!existsSync(bin)) return { skipped: `${bin} not found`, transcript: '', cmdline: bin, code: -1, ms: 0 };
      const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--json', '-s', 'read-only', '-o', `${dir}/last.txt`, prompt(tag, day)];
      const r = await runCmd(bin, args, { cwd: dir, timeoutMs: 420000 });
      const ev = lines(r.stdout);
      const calls = ev.filter((e) => e.item?.type === 'mcp_tool_call' && e.type === 'item.completed').map((e) => `${e.item.server}.${e.item.tool}`);
      const final = ev.filter((e) => e.item?.type === 'agent_message').map((e) => e.item.text).pop() ?? '';
      return { ...r, transcript: r.stdout + (r.stderr ? `\n--- stderr\n${r.stderr.slice(-4000)}` : ''), calls, final, cmdline: `cd ${dir}; ${bin} ${args.slice(0, -1).join(' ')} "<prompt>"` };
    },
  };
}

export const agentRuns = [
  codexLike('codex', '/usr/bin/codex'),
  {
    id: 'opencode', ext: 'jsonl',
    async run({ tag, day, dir }) {
      mkdirSync(dir, { recursive: true });
      const model = process.env.Q5_OPENCODE_MODEL || 'opencode/nemotron-3-ultra-free';
      const args = ['run', '--standalone', '--auto', '--format', 'json', '-m', model, prompt(tag, day)];
      const r = await runCmd('opencode', args, { cwd: dir, timeoutMs: 420000 });
      const ev = lines(r.stdout);
      const calls = [];
      for (const e of ev) {
        const p = e.part ?? e.properties?.part ?? e;
        if (p?.type === 'tool' && p.tool) {
          const s = JSON.stringify(p.state?.input ?? p.input ?? {});
          // code mode: only `tools.vitals.<name>(…)` is a call; `search({ query: "plan_end" })` only looks the name up
          const named = [...s.matchAll(/tools\.vitals\.(\w+)\s*\(/g)].map((m) => m[1]);
          calls.push(...(named.length ? named : [p.tool]));
          if (/^vitals_/.test(p.tool)) calls.push(p.tool.replace(/^vitals_/, ''));
        }
      }
      const final = ev.filter((e) => (e.part ?? e)?.type === 'text').map((e) => (e.part ?? e).text).join('\n');
      return { ...r, transcript: r.stdout + (r.stderr ? `\n--- stderr\n${r.stderr.slice(-4000)}` : ''), calls: [...new Set(calls)], final, cmdline: `cd ${dir}; opencode ${args.slice(0, -1).join(' ')} "<prompt>"` };
    },
  },
  {
    id: 'claude', ext: 'jsonl',
    async run({ tag, day, dir }) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/prompt.txt`, prompt(tag, day));
      const H = homedir();
      const env = { HOME: H, USER: process.env.USER, LOGNAME: process.env.USER, LANG: 'en_US.UTF-8', TERM: 'xterm-256color', PATH: `${H}/.local/bin:/usr/local/bin:/usr/bin:/bin` };
      const inner = 'cd $argv[1]; and claude -p --allowedTools "mcp__vitals__*" --model claude-sonnet-5-5 --max-budget-usd 1 --output-format stream-json --verbose < $argv[1]/prompt.txt';
      const auth = await runCmd('fish', ['-l', '-c', 'claude auth status'], { env, timeoutMs: 60000 });
      const method = /"authMethod"\s*:\s*"([^"]+)"/.exec(auth.stdout)?.[1] ?? 'unknown';
      const r = await runCmd('fish', ['-l', '-c', inner, dir], { env, timeoutMs: 420000 });
      const ev = lines(r.stdout);
      const init = ev.find((e) => e.type === 'system' && e.subtype === 'init');
      const toolNames = (init?.tools ?? []).filter((t) => t.startsWith('mcp__vitals__'));
      const calls = ev.flatMap((e) => (e.type === 'assistant' ? e.message?.content ?? [] : [])).filter((c) => c.type === 'tool_use').map((c) => c.name.replace('mcp__vitals__', ''));
      const res = ev.find((e) => e.type === 'result');
      const servers = JSON.stringify(init?.mcp_servers?.filter((s) => s.name === 'vitals') ?? []);
      return { ...r, code: r.code === 0 && res && !res.is_error ? 0 : r.code || 1, transcript: `# auth method: ${method}; vitals server: ${servers}\n` + r.stdout + (r.stderr ? `\n--- stderr\n${r.stderr.slice(-4000)}` : ''), calls, toolNames, final: res?.result ?? '', cmdline: `env -i HOME USER LOGNAME LANG TERM PATH fish -l -c '${inner}' ${dir}   # authMethod ${method}` };
    },
  },
  codexLike('chatgpt', '/usr/lib/chatgpt/resources/codex'),
];
