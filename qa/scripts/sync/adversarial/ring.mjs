import { hrEvents, minuteOf, ringContext, sleepEvent } from './ringOps.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const revisedValue = (i) => (i === 8 || i === 9 ? 112 + i : 62 + (i % 21));

async function until(fn, timeoutMs = 30000) {
  const start = Date.now();
  let value;
  let error;
  while (Date.now() - start < timeoutMs) {
    try {
      value = await fn();
      if (value) return { ok: true, ms: Date.now() - start, value };
    } catch (e) {
      error = e.message;
    }
    await sleep(150);
  }
  return { ok: false, ms: null, value, error };
}

/** Complete-to-complete revision of the same physical night on two disconnected readers. */
export default async function ring({ A, B, S, r, day }) {
  const seedDate = day(24);
  const seed = await A.ring({
    op: 'read',
    events: [...hrEvents(seedDate, 0, 3), sleepEvent(seedDate)],
    ctx: ringContext(new Date().toISOString()),
  });
  const sourceKey = seed.sources[0];
  r.check(
    'ring seed has a stable source and one complete sleep record',
    Boolean(sourceKey) && seed.sleep?.record_id && seed.records >= 1,
  );
  if (!sourceKey) return;
  await A.ring({ op: 'share', sourceKey, streams: { hr: 'daily+series', sleep_sessions: 'daily' } });
  await A.ring({ op: 'flush' });
  const seedOnB = await until(async () => {
    const v = await B.bioView({ sourceKey, stream: 'hr', date: seedDate });
    return v.records.length === 1 && v.samples.length === 3 && !v.partial ? v : false;
  });
  r.time('ring seed A to B', seedOnB.ms);
  r.check('ring source and sharing reach B before the race', seedOnB.ok);

  for (const [label, date, first, second] of [
    ['A then B', day(23), A, B],
    ['B then A', day(22), B, A],
  ]) {
    await A.goOffline();
    await B.goOffline();
    await sleep(300);
    const a = await A.ring({
      op: 'read',
      events: [...hrEvents(date, 0, 24), sleepEvent(date)],
      ctx: ringContext(new Date().toISOString()),
    });
    const b = await B.ring({
      op: 'read',
      events: [...hrEvents(date, 0, 31, revisedValue), sleepEvent(date, true)],
      ctx: ringContext(new Date(Date.now() + 2000).toISOString()),
    });
    r.check(
      `${label}: reclassified complete night keeps its record id and advances its version`,
      Boolean(
        a.sleep &&
        b.sleep &&
        a.sleep.record_id === b.sleep.record_id &&
        b.sleep.version > a.sleep.version &&
        a.sleep.asleep_s !== b.sleep.asleep_s,
      ),
      JSON.stringify({ a: a.sleep, b: b.sleep }),
    );
    const leakA = await A.bioView({ sourceKey, stream: 'hr', date });
    const leakB = await B.bioView({ sourceKey, stream: 'hr', date });
    r.check(
      `${label}: offline readers hold their own independent histories`,
      leakA.samples.length === 24 &&
        leakB.samples.length === 31 &&
        leakA.records[0]?.version === a.sleep?.version &&
        leakB.records[0]?.version === b.sleep?.version,
    );

    await first.goOnline();
    await first.ring({ op: 'flush' });
    await sleep(1200);
    const t0 = Date.now();
    await second.goOnline();
    await second.ring({ op: 'flush' });
    let views;
    const arrived = await until(async () => {
      const [va, vb] = await Promise.all(
        [A, B].map((x) => x.bioView({ sourceKey, stream: 'hr', date, recordId: b.sleep.record_id })),
      );
      views = { A: va, B: vb };
      return [va, vb].every(
        (v) =>
          v.records.length === 1 &&
          v.records[0].version === b.sleep.version &&
          v.samples.length === 31 &&
          v.partial === false &&
          v.strictError === null,
      )
        ? views
        : false;
    }, 45000);
    r.time(`${label}: second reconnect to both readers`, arrived.ok ? Date.now() - t0 : null);
    r.check(
      `${label}: both readers converge within 30 s of second reconnect`,
      arrived.ok && Date.now() - t0 <= 30000,
      arrived.error ?? '',
    );
    if (!views) continue;
    for (const [name, v] of Object.entries(views)) {
      const byMinute = new Map(v.samples.map((x) => [minuteOf(date, x.t), x.value]));
      const keys = new Set(v.samples.map((x) => `${x.origin}|${x.t}`));
      r.check(
        `${label}: ${name} has one visible night with the revised total`,
        v.records.length === 1 &&
          v.records[0].version === b.sleep.version &&
          v.records[0].asleep_s === b.sleep.asleep_s,
      );
      r.check(
        `${label}: ${name} retains each sample once and the revised values`,
        v.samples.length === 31 &&
          keys.size === 31 &&
          Array.from({ length: 31 }, (_, i) => i).every((i) => byMinute.get(i) === revisedValue(i)),
        `samples ${v.samples.length}, distinct ${keys.size}`,
      );
      r.check(
        `${label}: ${name} has no missing chunk or reader error`,
        v.partial === false && v.readError === null && v.strictError === null,
      );
    }
    r.check(`${label}: readers agree on all samples`, same(views.A.samples, views.B.samples));
    const server = await until(async () => {
      const v = await S.bio({ metric: 'hr', date });
      const byMinute = new Map(v.points.map((p) => [minuteOf(date, Date.parse(p.t)), p.value]));
      return v.points.length === 31 &&
        byMinute.size === 31 &&
        Array.from({ length: 31 }, (_, i) => i).every((i) => byMinute.get(i) === revisedValue(i))
        ? v
        : false;
    }, 45000);
    r.time(`${label}: second reconnect to server samples`, server.ok ? Date.now() - t0 : null);
    r.check(
      `${label}: server holds each sample once with the same revised values within 30 s`,
      server.ok && Date.now() - t0 <= 30000,
      server.error ?? '',
    );
    const daily = await until(async () => {
      const v = await S.bio({ daily: date });
      return typeof v.day?.sleep?.asleepH === 'number' &&
        Math.abs(v.day.sleep.asleepH - b.sleep.asleep_s / 3600) < 0.02
        ? v
        : false;
    }, 30000);
    r.check(
      `${label}: server daily view resolves the reclassified complete night`,
      daily.ok,
      daily.error ?? '',
    );
  }

  // A person corrects an existing device night while B receives a new version of that night offline.
  const correctionDate = day(21);
  const initial = await A.ring({
    op: 'read',
    events: [sleepEvent(correctionDate)],
    ctx: ringContext(new Date().toISOString()),
  });
  const initialOnB = await until(async () => {
    const v = await B.bioView({ sourceKey, stream: 'hr', date: correctionDate });
    return v.records[0]?.record_id === initial.sleep?.record_id ? v : false;
  });
  r.check('correction race: initial device night reached both replicas', initialOnB.ok);
  await A.goOffline();
  await B.goOffline();
  await sleep(300);
  const target = { kind: 'sleep', localDate: correctionDate };
  const correctedS = 5 * 3600;
  const correction = await A.invoke('bioCorrect', { target, value: { asleepS: correctedS } });
  const device = await B.ring({
    op: 'read',
    events: [sleepEvent(correctionDate, true)],
    ctx: ringContext(new Date(Date.now() + 3000).toISOString()),
  });
  r.check(
    'correction race: B stored a newer device version of the same night',
    device.sleep?.record_id === initial.sleep?.record_id && device.sleep?.version > initial.sleep?.version,
  );
  await B.goOnline();
  await sleep(1200);
  const t0 = Date.now();
  await A.goOnline();
  const resolved = await until(async () => {
    const [a, b] = await Promise.all([A, B].map((x) => x.invoke('bioResolve', { date: correctionDate })));
    return a.asleepS === correctedS &&
      b.asleepS === correctedS &&
      a.basis === 'correction' &&
      b.basis === 'correction'
      ? { a, b }
      : false;
  }, 45000);
  r.time('correction race: second reconnect to resolved values', resolved.ok ? Date.now() - t0 : null);
  r.check(
    'correction race: correction wins on both replicas within 30 s of second reconnect',
    resolved.ok && Date.now() - t0 <= 30000,
    resolved.error ?? '',
  );
  const raw = await Promise.all([A, B].map((x) => x.read({ col: 'bioCorrections', id: correction.key })));
  r.check(
    'correction race: both replicas retain the exact correction document',
    raw.every(
      (docs) =>
        docs[correction.key]?.value?.asleepS === correctedS &&
        !docs[correction.key]?.clearedAt &&
        docs[correction.key]?.correctionId === correction.correctionId,
    ),
  );
  const deviceStored = await Promise.all(
    [A, B].map((x) => x.bioView({ sourceKey, stream: 'hr', date: correctionDate })),
  );
  r.check(
    'correction race: the newer device record remains stored underneath the correction',
    deviceStored.every((v) => v.records.length === 1 && v.records[0].version === device.sleep.version),
  );
  const effectiveServer = await until(async () => {
    const v = await S.bio({ daily: correctionDate });
    return Math.abs((v.day?.sleep?.asleepH ?? 0) - correctedS / 3600) < 0.02 ? v : false;
  }, 45000);
  r.check(
    'correction race: server daily view uses the correction within 30 s',
    effectiveServer.ok && Date.now() - t0 <= 30000,
    effectiveServer.error ?? '',
  );
}
