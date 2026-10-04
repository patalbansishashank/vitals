import { canonical } from '../lib/docs.mjs';

/** A fresh replica joins after a thousand app-shaped food records are already on the relay. */
export default async function lateHistory({ A, B, C, S, r, wait, day, ulid, createLate }) {
  const count = 1000;
  const dates = Array.from({ length: 100 }, (_, i) => day(70 + i));
  const ids = Array.from({ length: count }, () => ulid());
  await A.goOffline();
  for (let i = 0; i < count; i++) {
    await A.write({
      op: 'logFood',
      id: ids[i],
      date: dates[i % dates.length],
      text: `C-SYNCX history ${i}`,
      kcal: 100 + (i % 300),
    });
    if ((i + 1) % 200 === 0) console.log(`Late history: ${i + 1} records stored locally`);
  }
  const expected = await A.read({ col: 'dailyLogs' });
  const expectedBody = new Map(ids.map((id) => [id, canonical(expected[id])]));
  r.check(
    'late history: writer holds all 1000 distinct records before reconnecting',
    Object.keys(expected).length === count &&
      expectedBody.size === count &&
      [...expectedBody.values()].every(Boolean),
  );
  const isFull = (docs) =>
    Object.keys(docs).length === count && ids.every((id) => canonical(docs[id]) === expectedBody.get(id));
  r.check(
    'late history: other replicas have none of the offline writes',
    [B, C].every(Boolean) &&
      !(await B.read({ col: 'dailyLogs' }))[ids[0]] &&
      !(await C.read({ col: 'dailyLogs' }))[ids[count - 1]],
  );

  const t0 = Date.now();
  await A.goOnline();
  await A.reconnect();
  const arrivals = await Promise.all(
    [B, C].map(async (replica) => {
      const seen = await wait(async () => isFull(await replica.read({ col: 'dailyLogs' })), {
        timeoutMs: 45000,
        every: 300,
      });
      return { name: replica.name, ok: seen.ok, ms: Date.now() - t0 };
    }),
  );
  for (const x of arrivals) {
    r.time(`late history: existing ${x.name} full history`, x.ms);
    r.check(
      `late history: existing ${x.name} receives all IDs and values within 30 s`,
      x.ok && x.ms <= 30000,
    );
  }

  // MCP has a per-answer result cap. Ten records per day keep answers untruncated. The first three days
  // provide a time-to-visible sample; the full paced sweep below is a completeness postcondition.
  const sampleDays = [0, 49, 99];
  const serverDocs = new Map();
  const serverErrors = [];
  const readServerDay = async (d) => {
    const date = dates[d];
    const docs = await S.read({ col: 'dailyLogs', date });
    const dayIds = ids.filter((_, i) => i % dates.length === d);
    const exact =
      !docs.truncated &&
      Object.keys(docs).length === dayIds.length &&
      dayIds.every((id) => canonical(docs[id]) === expectedBody.get(id));
    if (!exact)
      serverErrors.push({
        day: d + 1,
        expected: dayIds.length,
        seen: Object.keys(docs).length,
        truncated: Boolean(docs.truncated),
      });
    for (const [id, body] of Object.entries(docs)) serverDocs.set(id, canonical(body));
    return { exact, count: Object.keys(docs).length, truncated: Boolean(docs.truncated) };
  };
  let sampled = 0;
  for (const d of sampleDays) {
    const row = await readServerDay(d);
    sampled += 10;
    r.check(
      `late history: server MCP day ${d + 1} has all IDs and values without truncation`,
      row.exact && Date.now() - t0 <= 30000,
      `expected 10, seen ${row.count}, truncated ${row.truncated}`,
    );
  }
  r.observe('late history: server MCP time sample', {
    sampled,
    total: count,
    elapsedMs: Date.now() - t0,
    reason: 'three paced untruncated days',
  });

  const joinedAt = Date.now();
  const D = await createLate('lateHistoryD');
  const joined = await wait(async () => isFull(await D.read({ col: 'dailyLogs' })), {
    timeoutMs: 45000,
    every: 300,
  });
  const joinMs = Date.now() - joinedAt;
  r.time('late history: fresh replica joins and receives full history', joinMs);
  r.check(
    'late history: fresh replica receives all 1000 IDs and values within 30 s',
    joined.ok && joinMs <= 30000,
  );
  const final = await Promise.all([A, B, C, D].map((x) => x.read({ col: 'dailyLogs' })));
  r.check('late history: all four clients converge on every ID and value', final.every(isFull));

  const sweepAt = Date.now();
  for (let d = 0; d < dates.length; d++) if (!sampleDays.includes(d)) await readServerDay(d);
  const sweepMs = Date.now() - sweepAt;
  r.time('late history: remaining 97 server MCP days', sweepMs);
  r.check(
    'late history: full server MCP sweep has all 1000 IDs and values, ten per day, with no truncation',
    serverErrors.length === 0 &&
      serverDocs.size === count &&
      ids.every((id) => serverDocs.get(id) === expectedBody.get(id)),
    `errors ${JSON.stringify(serverErrors.slice(0, 3))}, seen ${serverDocs.size}`,
  );
}
