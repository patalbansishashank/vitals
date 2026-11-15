// @vitest-environment node
/**
 * deploy/vitals-watchdog.sh's decisions (r087 S5): it runs under plain `sh` with fake `curl` and `systemctl` on PATH
 * and a fake /proc, one run per simulated minute, so each case reads as the minutes the server went through.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = new URL('../../../deploy/vitals-watchdog.sh', import.meta.url).pathname;
const PID = 4242;
const HZ = Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout.trim()) || 100;

interface Minute {
  /** /health answered in time. */
  answers: boolean;
  /** CPU the server's main thread used since the previous minute (ms). */
  cpuMs?: number;
  /** The MainPID systemd reports (default PID). */
  pid?: number;
  /** Seconds since the unit became active (default 3600). */
  age?: number;
  /** What `systemctl is-active` says (default active). */
  active?: string;
  /** No /proc entry for the thread. */
  noProc?: boolean;
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function harness(env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vitals-watchdog-'));
  dirs.push(root);
  const bin = join(root, 'bin');
  const proc = join(root, 'proc');
  const state = join(root, 'state');
  mkdirSync(bin);
  mkdirSync(proc);
  const fake = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // the fakes read the minute's answers from files the test writes
  fake('curl', `[ "$(cat "${root}/answers")" = yes ]`);
  fake(
    'systemctl',
    [
      `echo "$*" >>"${root}/systemctl.log"`,
      'case "$*" in',
      `  *is-active*) cat "${root}/active" ;;`,
      `  *MainPID*) cat "${root}/pid" ;;`,
      `  *ActiveEnterTimestampMonotonic*) echo 0 ;;`,
      'esac',
    ].join('\n'),
  );
  let ticks = 1000;
  const run = (m: Minute) => {
    const pid = m.pid ?? PID;
    writeFileSync(join(root, 'answers'), m.answers ? 'yes' : 'no');
    writeFileSync(join(root, 'active'), m.active ?? 'active');
    writeFileSync(join(root, 'pid'), String(pid));
    // uptime = age, since the unit "entered active" at 0
    writeFileSync(join(proc, 'uptime'), `${m.age ?? 3600}.00 1.00\n`);
    ticks += Math.round(((m.cpuMs ?? 0) * HZ) / 1000);
    rmSync(join(proc, String(pid)), { recursive: true, force: true });
    if (!m.noProc) {
      mkdirSync(join(proc, String(pid), 'task', String(pid)), { recursive: true });
      // a command name with spaces and a parenthesis, as a thread name may have
      writeFileSync(join(proc, String(pid), 'task', String(pid), 'stat'), `${pid} (node main) x) R 1 ${pid} ${pid} 0 -1 4194560 100 0 0 0 ${ticks - 300} 300 0 0 20 0 11 0 5 0 0\n`);
    }
    const r = spawnSync('sh', [SCRIPT], {
      encoding: 'utf8',
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, XDG_STATE_HOME: state, VITALS_WATCHDOG_PROC: proc, ...env },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return r.stdout;
  };
  const restarts = () => (existsSync(join(root, 'systemctl.log')) ? readFileSync(join(root, 'systemctl.log'), 'utf8').split('\n').filter((l) => l.includes('restart')).length : 0);
  const log = () => readFileSync(join(state, 'vitals-server', 'watchdog.log'), 'utf8');
  return { run, restarts, log, state: join(state, 'vitals-server') };
}

const minutes = (h: ReturnType<typeof harness>, ms: Minute[]) => ms.map((m) => h.run(m));

describe('vitals-watchdog.sh', () => {
  it('restarts a server whose main thread stands still after 3 failed checks', () => {
    const h = harness();
    minutes(h, [{ answers: true, cpuMs: 200 }, { answers: false, cpuMs: 0 }, { answers: false, cpuMs: 10 }]);
    expect(h.restarts()).toBe(0);
    h.run({ answers: false, cpuMs: 0 });
    expect(h.restarts()).toBe(1);
    expect(h.log()).toContain('restarting vitals-server after 3 failed health checks (3 stalled)');
  });

  it('leaves a busy server alone while its main thread keeps working', () => {
    const h = harness();
    // a two-minute burst of reads and more: /health is late every minute, the loop thread is working the whole time
    minutes(h, [{ answers: true, cpuMs: 500 }, ...Array.from({ length: 5 }, () => ({ answers: false, cpuMs: 45_000 })), { answers: true, cpuMs: 30_000 }]);
    expect(h.restarts()).toBe(0);
    expect(h.log()).toContain('busy: main thread used 45000 ms of CPU');
    expect(h.log()).toContain('health check answered again after 5 failure(s)');
    expect(existsSync(join(h.state, 'watchdog.failures'))).toBe(false);
  });

  it('still restarts a loop that spins without answering for VITALS_WATCHDOG_BUSY_FAILURES checks', () => {
    const h = harness({ VITALS_WATCHDOG_BUSY_FAILURES: '4' });
    minutes(h, [{ answers: true }, ...Array.from({ length: 3 }, () => ({ answers: false, cpuMs: 60_000 }))]);
    expect(h.restarts()).toBe(0);
    h.run({ answers: false, cpuMs: 60_000 });
    expect(h.restarts()).toBe(1);
    expect(h.log()).toContain('restarting vitals-server after 4 failed health checks (0 stalled)');
  });

  it('defaults to 6 failures in a row for a busy loop', () => {
    const h = harness();
    minutes(h, [{ answers: true }, ...Array.from({ length: 5 }, () => ({ answers: false, cpuMs: 60_000 }))]);
    expect(h.restarts()).toBe(0);
    h.run({ answers: false, cpuMs: 60_000 });
    expect(h.restarts()).toBe(1);
  });

  it('counts stalls in a row only: a busy minute in between resets them', () => {
    const h = harness();
    minutes(h, [{ answers: true }, { answers: false, cpuMs: 0 }, { answers: false, cpuMs: 0 }, { answers: false, cpuMs: 20_000 }, { answers: false, cpuMs: 0 }, { answers: false, cpuMs: 0 }]);
    expect(h.restarts()).toBe(0);
    h.run({ answers: false, cpuMs: 0 });
    expect(h.restarts()).toBe(1);
  });

  it('treats CPU it cannot compare as stalled (no earlier sample, new pid, no /proc)', () => {
    const h = harness();
    minutes(h, [{ answers: false, cpuMs: 60_000, noProc: true }, { answers: false, cpuMs: 60_000 }, { answers: false, cpuMs: 60_000, pid: PID + 1 }]);
    expect(h.restarts()).toBe(1);
    expect(h.log()).toContain('main thread used unknown ms');
  });

  it('honours VITALS_WATCHDOG_BUSY_CPU_MS', () => {
    const h = harness({ VITALS_WATCHDOG_BUSY_CPU_MS: '5000' });
    minutes(h, [{ answers: true }, { answers: false, cpuMs: 2000 }, { answers: false, cpuMs: 2000 }, { answers: false, cpuMs: 2000 }]);
    expect(h.restarts()).toBe(1);
  });

  it('does not count failures in the grace period or while the unit is not active', () => {
    const h = harness();
    minutes(h, [{ answers: false, age: 30 }, { answers: false, age: 90 }, { answers: false, age: 150 }]);
    expect(h.log()).toContain('not counted');
    minutes(h, [{ answers: false, active: 'activating' }, { answers: false, active: 'failed' }, { answers: false, active: 'inactive' }]);
    expect(h.restarts()).toBe(0);
    expect(existsSync(join(h.state, 'watchdog.failures'))).toBe(false);
  });

  it('reads a failure count left by the previous watchdog', () => {
    const h = harness();
    mkdirSync(h.state, { recursive: true });
    writeFileSync(join(h.state, 'watchdog.failures'), '2\n');
    h.run({ answers: false });
    expect(h.log()).toContain('health check failed (3 in a row, 1 of 3 stalled');
    expect(h.restarts()).toBe(0);
  });
});
