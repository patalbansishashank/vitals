// The server person: a test person on the real Vitals Server that joins the harness's sync group, read and written
// through the server's MCP endpoint with an agent token (the person worker answers from its own replica). Admin steps
// go over ssh to the server's CLI, as qa/scripts/Q8/lib.mjs does: only persons labelled `L-SYNC-…` are created or
// removed; the sync phrase goes on stdin and the agent token stays in memory, neither is ever printed.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CAND, ROOT, log } from './config.mjs';

export const LABEL_PREFIX = 'L-QA-R2J3-';
const VS = 'node ~/vitals-server/current/bin/vitals-server.mjs';
const PRIVATE = `${ROOT}/.e6-tmp/r2j3-harness`;

export function sshRun(sshHost, cmd, input = null, timeout = 60000) {
  return new Promise((resolve) => {
    const c = execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', sshHost, cmd], { timeout, maxBuffer: 4 << 20 }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    );
    if (input !== null) c.stdin.end(input);
    else c.stdin.end();
  });
}
const safeArg = (s) => {
  if (!/^[A-Za-z0-9 _./:-]+$/.test(s)) throw new Error('unsafe argument');
  return `'${s}'`;
};
const mustOwn = (label) => {
  if (!label.startsWith(LABEL_PREFIX)) throw new Error(`refusing to touch a person not labelled ${LABEL_PREFIX}…`);
};

export async function personsList(sshHost) {
  const r = await sshRun(sshHost, `${VS} persons list`);
  return r.stdout
    .split('\n')
    .map((l) => l.match(/^([0-9a-f]{16})\s+(.+?)\s+(\S+)$/))
    .filter(Boolean)
    .map((m) => ({ id: m[1], label: m[2], createdAt: m[3] }));
}

/** Adds an `L-SYNC-…` person that joins the sync group of `phrase` (24 words, on stdin). Returns its id. */
export async function addPerson(sshHost, label, phrase, tz = 'Asia/Kolkata') {
  mustOwn(label);
  const r = await sshRun(sshHost, `${VS} persons add ${safeArg(label)} --tz ${safeArg(tz)} --join`, `${phrase}\n`);
  const m = r.stdout.match(/([0-9a-f]{16})\s+L-QA-R2J3-/);
  if (!m) throw new Error(`persons add failed: ${r.stderr.split(phrase).join('[phrase]').slice(0, 200)}`);
  fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
  fs.appendFileSync(`${PRIVATE}/persons.txt`, `${m[1]} ${label}\n`, { mode: 0o600 });
  return m[1];
}

/** Agent token (scope log) for the person; `{ id, token }`, the token kept in memory only. */
export async function agentToken(sshHost, personId) {
  const r = await sshRun(sshHost, `${VS} agent-token create ${personId} --client claude --scope log --label 'L-QA-R2J3 harness'`);
  const lines = r.stdout.split('\n');
  const i = lines.findIndex((l) => /shown only once/.test(l));
  const id = lines[i]?.match(/, id ([^\s]+?)\. It is shown/)?.[1];
  const token = lines[i + 1]?.trim();
  if (i < 0 || !id || !token) throw new Error(`agent-token create failed (exit ${r.code})`);
  return { id, token };
}

/** Revokes the harness's agent token and devices, then removes the person (only `L-SYNC-…` labels). */
export async function removePerson(sshHost, personId, tokenId = null) {
  const p = (await personsList(sshHost)).find((x) => x.id === personId);
  if (!p) return 'not found';
  mustOwn(p.label);
  if (tokenId) await sshRun(sshHost, `${VS} agent-token revoke ${personId} ${safeArg(tokenId)}`);
  const r = await sshRun(sshHost, `${VS} persons remove ${personId}`);
  return r.stdout.trim() || r.stderr.trim().slice(0, 200);
}

const req = createRequire(join(CAND, 'packages/companion/package.json'));
let sdk = null;
async function loadSdk() {
  sdk ??= {
    Client: (await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')).href)).Client,
    Transport: (await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href)).StreamableHTTPClientTransport,
  };
  return sdk;
}

/**
 * MCP client on `<server>/mcp` with the agent token. `call(name, args)` returns the parsed result envelope. The client
 * name becomes the actor id of every call (it shows as `source.actorId` on logged entries).
 */
export async function mcpClient(serverBaseUrl, token, clientName = 'l-sync-harness') {
  const { Client, Transport } = await loadSdk();
  const c = new Client({ name: clientName, version: '1.0.0' });
  await c.connect(new Transport(new URL(`${serverBaseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return {
    async tools() {
      return (await c.listTools()).tools.map((t) => t.name);
    },
    async call(name, args = {}) {
      const r = await c.callTool({ name, arguments: args });
      const text = r.content?.[0]?.text ?? '{}';
      try {
        return JSON.parse(text);
      } catch {
        return { ok: false, raw: text.slice(0, 300) };
      }
    },
    close: () => c.close().catch(() => undefined),
  };
}

export { log };
