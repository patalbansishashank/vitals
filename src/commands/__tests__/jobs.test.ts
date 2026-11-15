/**
 * The in-memory job runner: a caller-chosen id names one job at a time, so a live job is never replaced (its cancel
 * and wait would otherwise reach the newcomer and leave it unstoppable).
 */
import { createJobRunner } from '../jobs';
import { CommandFailure } from '../registry';

/** A job that runs until its signal aborts or `release` is called. */
function held() {
  let release!: (v: string) => void;
  const done = new Promise<string>((r) => (release = r));
  const stopped = (signal: AbortSignal) =>
    new Promise<string>((_, no) => {
      const stop = () => no(new DOMException('stopped', 'AbortError'));
      // the runner starts the job a tick later, so a prompt cancel lands before this listens
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop);
    });
  return { release, run: (job: { signal: AbortSignal }) => Promise.race([done, stopped(job.signal)]) };
}

describe('job runner', () => {
  it('refuses a new job under the id of one still running, and the running one stays cancellable', async () => {
    const jobs = createJobRunner();
    const first = held();
    const onCancel = vi.fn();
    jobs.start('sim', first.run, { id: 'J1', onCancel });

    let thrown: unknown;
    try {
      jobs.start('sim', async () => 'second', { id: 'J1' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CommandFailure);
    expect((thrown as CommandFailure).error).toMatchObject({ code: 'busy', detail: { retryable: true } });

    expect(jobs.list()).toHaveLength(1);
    expect(jobs.cancel('J1')).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(await jobs.wait('J1')).toMatchObject({ jobId: 'J1', state: 'cancelled' });
  });

  it('reuses the id of a job that has settled', async () => {
    const jobs = createJobRunner();
    jobs.start('sim', async () => 'first', { id: 'J1' });
    expect(await jobs.wait('J1')).toMatchObject({ state: 'done' });

    jobs.start('sim', async () => 'second', { id: 'J1' });
    expect(await jobs.wait('J1')).toMatchObject({ state: 'done' });
    expect(jobs.result('J1')).toBe('second');
  });

  it('a cancelled job that settles after its id was reused does not report over the new job', async () => {
    const seen: Array<{ jobId: string; state: string }> = [];
    const jobs = createJobRunner((st) => seen.push({ jobId: st.jobId, state: st.state }));
    // work that does not stop at once when cancelled
    let finishOld!: () => void;
    const oldWork = new Promise<string>((r) => (finishOld = () => r('old')));
    jobs.start('sim', () => oldWork, { id: 'J1' });
    const oldSettled = jobs.wait('J1');
    expect(jobs.cancel('J1')).toBe(true);

    const second = held();
    jobs.start('sim', second.run, { id: 'J1' });
    finishOld();
    expect(await oldSettled).toMatchObject({ state: 'cancelled' });

    expect(seen.at(-1)).toEqual({ jobId: 'J1', state: 'running' });
    expect(jobs.status('J1')).toMatchObject({ state: 'running' });
    expect(jobs.cancel('J1')).toBe(true);
  });

  it('gives each job without an id its own', () => {
    const jobs = createJobRunner();
    const a = jobs.start('sim', held().run);
    const b = jobs.start('sim', held().run);
    expect(a.jobId).not.toBe(b.jobId);
    expect(jobs.list().map((s) => s.state)).toEqual(['running', 'running']);
  });
});
