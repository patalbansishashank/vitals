import '../lib/tsResolve.mjs';
import fs from 'node:fs';
import { ROOT, harnessConfig, results, runDir, sleep, log } from '../lib/config.mjs';
import { openReplica } from '../lib/replica.mjs';
import { addPerson, agentToken, removePerson } from '../lib/server.mjs';
import { todayIn } from '../lib/docs.mjs';

const { newOwnerSecret, secretToWords } = await import('../../../../src/sync/pairing.ts');
const { ulid } = await import('../../../../src/store/ids.ts');

export async function wait(fn, { timeoutMs = 30000, every = 100 } = {}) {
  const start = Date.now();
  let value = null;
  while (Date.now() - start < timeoutMs) {
    value = await fn();
    if (value === true || value?.ok) return { ok: true, ms: Date.now() - start, value };
    await sleep(every);
  }
  return { ok: false, ms: Date.now() - start, value };
}

export async function withGroup(name, scenario) {
  const cfg = harnessConfig();
  const run = `C-SYNCX-${name}-${Date.now()}`;
  const dir = runDir(run);
  const secret = newOwnerSecret();
  const reps = [];
  let person = null;
  let token = null;
  let cleaning = null;
  const r = results(name, {
    server: 'real candidate',
    replicas: 'three Node app adapters and server MCP',
    synthetic: true,
  });
  const cleanup = () =>
    (cleaning ??= (async () => {
      await Promise.allSettled(reps.map((x) => x.close()));
      if (person) {
        await removePerson(cfg.sshHost, person, token?.id);
        log(`${name}: test person removed`);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    })());
  const signal = () => cleanup().finally(() => process.exit(130));
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    person = await addPerson(cfg.sshHost, run, secretToWords(secret).join(' '));
    token = await agentToken(cfg.sshHost, person);
    const S = await openReplica('server', {
      name: 'S',
      serverBaseUrl: cfg.serverBaseUrl,
      token: token.token,
    });
    reps.push(S);
    await S.read({ col: 'settings' });
    const createLate = async (name = 'D') => {
      const replica = await openReplica('node', {
        name: `CX-${name}-${Date.now()}`,
        secret,
        relayTarget: cfg.serverBaseUrl,
        dir: `${dir}/${name}`,
      });
      reps.push(replica);
      return replica;
    };
    const A = await createLate('A');
    const B = await createLate('B');
    const C = await createLate('C');
    const ready = await wait(async () =>
      (await Promise.all([A, B, C].map((x) => x.status()))).every((s) => s.state === 'synced'),
    );
    r.check('initial replicas connect to the real relay', ready.ok);
    const day = (n = 0) => {
      const d = new Date(`${todayIn('Asia/Kolkata')}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    await scenario({ A, B, C, S, r, wait, sleep, day, ulid, createLate, cfg, run });
  } catch (error) {
    // Do not copy transport URLs or connection credentials into tracked evidence.
    r.check(
      'scenario completes',
      false,
      String(error.message)
        .replace(/https?:\/\/\S+/g, '[server]')
        .slice(0, 300),
    );
  } finally {
    try {
      await cleanup();
      r.check('isolated test person and replicas removed', true);
    } catch {
      r.check('isolated test person removed', false, 'Cleanup failed; inspect private harness ledger');
    }
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
  }
  return r.save();
}

export { ROOT };
