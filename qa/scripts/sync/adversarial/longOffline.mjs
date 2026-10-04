import { canonical } from '../lib/docs.mjs';

export default async function longOffline({ A, B, C, S, r, wait, sleep, day, ulid, createLate }) {
  const durationMs = Number(process.env.SYNC_LONG_OFFLINE_S ?? 1800) * 1000;
  const count = 160;
  const dates = Array.from({ length: 20 }, (_, i) => day(40 + i));
  const sentinel = ulid();
  let start = Date.now();
  await B.write({ op: 'logFood', id: sentinel, date: day(), text: 'C-SYNCX online sentinel' });
  const online = await Promise.all(
    [A, C, S].map(async (x) => {
      const seen = await wait(
        async () => Boolean((await x.read({ col: 'dailyLogs', date: day() }))[sentinel]),
        { timeoutMs: 10000, every: x === S ? 1100 : 100 },
      );
      return { replica: x.name, ms: Date.now() - start, ok: seen.ok };
    }),
  );
  for (const x of online) {
    r.time(`online ${x.replica}`, x.ms);
    r.check(`online sentinel visible within 5 s on ${x.replica}`, x.ok && x.ms <= 5000);
  }

  await A.goOffline();
  const offlineAt = Date.now();
  const ids = Array.from({ length: count }, () => ulid());
  for (let i = 0; i < count; i++)
    await A.write({
      op: 'logFood',
      id: ids[i],
      date: dates[i % dates.length],
      text: `C-SYNCX offline row ${i}`,
      kcal: 100,
    });
  for (let round = 1; round <= 4; round++) {
    for (let i = 0; i < count; i++)
      await A.write({
        op: 'patch',
        col: 'dailyLogs',
        id: ids[i],
        fields: { text: `C-SYNCX offline row ${i} revision ${round}` },
      });
  }
  const expected = await A.read({ col: 'dailyLogs' });
  const meanwhile = [];
  for (let i = 0; i < dates.length; i++) {
    const id = ulid();
    meanwhile.push(id);
    await B.write({ op: 'logFood', id, date: dates[i], text: `C-SYNCX meanwhile row ${i}` });
  }
  r.check(
    'offline replica cannot see online writes',
    meanwhile.every((id) => !expected[id]),
  );
  r.check('online replica cannot see offline writes', !(await C.read({ col: 'dailyLogs' }))[ids[0]]);
  r.observe('offline workload', {
    records: count,
    edits: count * 5,
    meanwhileRecords: meanwhile.length,
    requestedOfflineMs: durationMs,
  });
  // A real elapsed outage, no clock acceleration. Progress every minute keeps the long run observable.
  let nextProgress = Date.now();
  while (Date.now() - offlineAt < durationMs) {
    if (Date.now() >= nextProgress) {
      console.log(`Long offline: ${Math.floor((Date.now() - offlineAt) / 1000)} seconds elapsed`);
      nextProgress = Date.now() + 60000;
    }
    await sleep(Math.min(1000, durationMs - (Date.now() - offlineAt)));
  }
  r.time('actual offline duration', Date.now() - offlineAt);
  r.check('outage lasts the requested duration', Date.now() - offlineAt >= durationMs);
  await S.read({ col: 'settings' }); // warm the person worker before measuring relay delivery
  start = Date.now();
  await A.goOnline();
  // The real app receives an online event and forces this reconnect (R20-OUTBOX-01).
  await A.reconnect();
  const same = (docs) =>
    ids.every((id) => canonical(docs[id]) === canonical(expected[id])) && meanwhile.every((id) => docs[id]);
  const tasks = [A, B, C].map(async (x) => {
    const seen = await wait(async () => same(await x.read({ col: 'dailyLogs' })), { timeoutMs: 35000 });
    const elapsed = Date.now() - start;
    r.time(`reconnect full history ${x.name}`, elapsed);
    r.check(
      `all offline revisions and online writes visible within 30 s on ${x.name}`,
      seen.ok && elapsed <= 30000,
    );
  });
  tasks.push(
    (async () => {
      const serverDocs = {};
      for (const date of dates) {
        const seen = await wait(
          async () => {
            const docs = await S.read({ col: 'dailyLogs', date });
            Object.assign(serverDocs, docs);
            return (
              !docs.truncated &&
              ids
                .filter((_, i) => dates[i % dates.length] === date)
                .every((id) => canonical(docs[id]) === canonical(expected[id]))
            );
          },
          { timeoutMs: Math.max(1000, 35000 - (Date.now() - start)), every: 0 },
        );
        if (!seen.ok) break;
      }
      const elapsed = Date.now() - start;
      r.time('reconnect full history server MCP', elapsed);
      r.check(
        'server holds every final revision and meanwhile record without duplication within 30 s',
        same(serverDocs) && Object.keys(serverDocs).length === count + meanwhile.length && elapsed <= 30000,
      );
    })(),
  );
  await Promise.all(tasks);
  const lateAt = Date.now();
  const D = await createLate();
  const late = await wait(async () => same(await D.read({ col: 'dailyLogs' })), { timeoutMs: 35000 });
  const elapsed = Date.now() - lateAt;
  r.time('late join full history', elapsed);
  r.check(
    'late replica receives all 181 records and final revisions within 30 s',
    late.ok &&
      elapsed <= 30000 &&
      Object.keys(await D.read({ col: 'dailyLogs' })).length === count + meanwhile.length + 1,
  );
  const views = await Promise.all([A, B, C, D].map((x) => x.read({ col: 'dailyLogs' })));
  r.check(
    'late replica and original replicas converge field for field',
    views.every((view) => canonical(view) === canonical(views[0])),
  );
}
