// Shared settings of the sync harness. Host names never live in tracked files: the server origin and the ssh alias come
// from the git-ignored qa/local.config.json (L-PUB's shape, qa/local.config.example.json: `serverUrl`, `serverSsh`)
// merged with the environment (VITALS_QA_SERVER_URL, VITALS_QA_SERVER_SSH win over the file; VITALS_QA_CONFIG points at
// the file elsewhere). This is a local
// stand-in for qa/scripts/lib/localConfig.mjs (not in this tree yet); switching to it is one import.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
process.env.TMPDIR = process.env.TMPDIR || `${ROOT}/.e6-tmp`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

/** `{ serverBaseUrl, sshHost }`; throws a plain message when neither the file nor the environment names them. */
export function harnessConfig() {
  // VITALS_QA_CONFIG names another copy of the file (a worktree whose .gitignore does not list qa/local.config.json yet)
  const file = process.env.VITALS_QA_CONFIG || `${ROOT}/qa/local.config.json`;
  let cfg = {};
  if (fs.existsSync(file)) cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const env = process.env;
  // older names (serverBaseUrl, sshHost, VITALS_QA_SERVER, VITALS_QA_SSH) still read
  const serverBaseUrl =
    env.VITALS_QA_SERVER_URL || env.VITALS_QA_SERVER || cfg.serverUrl || cfg.serverBaseUrl;
  const sshHost = env.VITALS_QA_SERVER_SSH || env.VITALS_QA_SSH || cfg.serverSsh || cfg.sshHost;
  if (!serverBaseUrl)
    throw new Error(
      'No server address: set serverUrl in qa/local.config.json (see qa/local.config.example.json) or VITALS_QA_SERVER_URL.',
    );
  if (!sshHost)
    throw new Error('No ssh alias: set serverSsh in qa/local.config.json or VITALS_QA_SERVER_SSH.');
  return { serverBaseUrl: serverBaseUrl.replace(/\/$/, ''), sshHost };
}

/** Run directory for replica data: .e6-tmp/sync-harness/<run>/ (git-ignored). */
export function runDir(run) {
  const dir = `${ROOT}/.e6-tmp/sync-harness/${run}`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** PASS/FAIL rows for one scenario, written to qa/results/sync/<scenario>.json. */
export function results(scenario, meta = {}) {
  const rows = [];
  const timings = {};
  const observed = {};
  const check = (name, ok, detail = '') => {
    rows.push({ name, ok: Boolean(ok), detail: String(detail ?? '').slice(0, 400) });
    log(`${ok ? 'PASS' : 'FAIL'} ${scenario}: ${name}${detail ? ` (${String(detail).slice(0, 300)})` : ''}`);
    return Boolean(ok);
  };
  const time = (name, ms) => {
    timings[name] = ms === null ? null : Math.round(ms);
    return ms;
  };
  /** A value the scenario records without asserting it (counts, flags). */
  const observe = (name, value) => {
    observed[name] = value;
    log(`OBSERVED ${scenario}: ${name} = ${JSON.stringify(value)}`);
    return value;
  };
  const save = (extra = {}) => {
    const resultGroup = process.env.SYNC_RESULT_GROUP ?? 'sync';
    if (!/^[A-Za-z0-9-]+$/.test(resultGroup)) throw new Error('Invalid result group');
    const dir = `${ROOT}/qa/results/${resultGroup}`;
    fs.mkdirSync(dir, { recursive: true });
    const failed = rows.filter((r) => !r.ok).length;
    const out = {
      scenario,
      at: new Date().toISOString(),
      ...meta,
      passed: rows.length - failed,
      failed,
      timingsMs: timings,
      ...(Object.keys(observed).length ? { observed } : {}),
      ...extra,
      checks: rows,
    };
    fs.writeFileSync(`${dir}/${scenario}.json`, JSON.stringify(out, null, 1) + '\n');
    return out;
  };
  return { rows, timings, observed, check, time, observe, save };
}
