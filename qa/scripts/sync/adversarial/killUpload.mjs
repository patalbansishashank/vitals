import { hrEvents, minuteOf, ringContext } from './ringOps.mjs';

/** Kill a replica after an upload has sent bytes, while the relay still awaits the rest of the body. */
export default async function killUpload({ A, B, S, r, wait, sleep, day }) {
  const seedDate = day(20);
  const date = day(19);
  const seed = await A.ring({
    op: 'read',
    events: hrEvents(seedDate, 0, 2),
    ctx: ringContext(new Date().toISOString()),
  });
  const sourceKey = seed.sources[0];
  r.check('upload kill: ring source is ready', Boolean(sourceKey));
  if (!sourceKey) return;
  await A.ring({ op: 'share', sourceKey, streams: { hr: 'daily+series' } });
  await A.ring({ op: 'flush' });
  const seeded = await wait(async () => {
    const v = await B.bioView({ sourceKey, stream: 'hr', date: seedDate });
    return v.samples.length === 2 && !v.partial;
  });
  r.check('upload kill: B can read the seed before the interrupted upload', seeded.ok);

  await A.goOffline();
  await sleep(300);
  const read = await A.ring({
    op: 'read',
    events: hrEvents(date, 0, 40),
    ctx: ringContext(new Date().toISOString()),
  });
  r.check(
    'upload kill: offline ring read created 40 samples and pending bytes',
    read.samples === 40 && read.pendingUploads > 0,
  );
  const offlineB = await B.bioView({ sourceKey, stream: 'hr', date });
  r.check('upload kill: B has no samples while A is offline', offlineB.samples.length === 0);

  A.pauseNextBlobUpload();
  await A.goOnline();
  const pendingFlush = A.ring({ op: 'flush' }).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error: error.message }),
  );
  const paused = await A.waitForPausedBlobUpload(20000);
  r.check(
    'upload kill: proxy observed an active partial PUT before killing A',
    paused.started && paused.bytesForwarded > 0,
    JSON.stringify(paused),
  );
  if (!paused.started) {
    A.releasePausedBlobUpload();
    await pendingFlush;
    return;
  }
  const partial = await wait(
    async () => {
      const v = await B.bioView({ sourceKey, stream: 'hr', date });
      return v.live.length >= 1 ? { ok: true, view: v } : false;
    },
    { timeoutMs: 20000 },
  );
  r.check('upload kill: B sees the manifest while the bytes are held', partial.ok);
  if (partial.ok) {
    const v = partial.value.view;
    r.check(
      'upload kill: missing bytes do not crash the non-strict reader',
      v.readError === null,
      v.readError ?? '',
    );
    r.observe('upload kill: partial before kill', { partial: v.partial, samples: v.samples.length });
  }

  await A.kill();
  const interrupted = await pendingFlush;
  A.releasePausedBlobUpload();
  r.check('upload kill: in-flight flush was interrupted by process death', !interrupted.ok);
  const t0 = Date.now();
  await A.restart();
  const retry = await A.ring({ op: 'flush' });
  r.check(
    'upload kill: restart retries pending chunk bytes',
    retry.uploaded >= 1 && retry.pending === 0 && retry.lastError === null,
    JSON.stringify(retry),
  );
  let views;
  const recovered = await wait(
    async () => {
      const [a, b] = await Promise.all([A, B].map((x) => x.bioView({ sourceKey, stream: 'hr', date })));
      views = { a, b };
      return [a, b].every(
        (v) => v.samples.length === 40 && !v.partial && v.readError === null && v.strictError === null,
      );
    },
    { timeoutMs: 45000 },
  );
  r.time('upload kill: restart to both complete readers', Date.now() - t0);
  r.check(
    'upload kill: both replicas recover all 40 samples within 30 s',
    recovered.ok && Date.now() - t0 <= 30000,
  );
  if (views)
    for (const [name, v] of Object.entries(views)) {
      const keys = new Set(v.samples.map((x) => `${x.origin}|${x.t}`));
      const byMinute = new Map(v.samples.map((x) => [minuteOf(date, x.t), x.value]));
      r.check(
        `upload kill: ${name} has the exact 40 expected samples once`,
        v.samples.length === 40 &&
          keys.size === 40 &&
          byMinute.size === 40 &&
          Array.from({ length: 40 }, (_, i) => i).every((i) => byMinute.get(i) === 62 + (i % 21)),
      );
    }
  const server = await wait(
    async () => {
      const v = await S.bio({ metric: 'hr', date });
      const byMinute = new Map(v.points.map((p) => [minuteOf(date, Date.parse(p.t)), p.value]));
      return (
        v.points.length === 40 &&
        byMinute.size === 40 &&
        Array.from({ length: 40 }, (_, i) => i).every((i) => byMinute.get(i) === 62 + (i % 21))
      );
    },
    { timeoutMs: 45000, every: 1100 },
  );
  r.time('upload kill: restart to complete server view', Date.now() - t0);
  r.check('upload kill: server recovers all 40 samples within 30 s', server.ok && Date.now() - t0 <= 30000);
}
