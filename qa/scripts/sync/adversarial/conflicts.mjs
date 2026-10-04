// Conflict probes against a C-SYNCX test person on the real relay. Replicas use the app's own Evolu adapter.
const asText = (v) => (v === undefined ? 'missing' : JSON.stringify(v));

export default async function conflicts({ A, B, C, S, r, wait, sleep, day, ulid }) {
  const replicas = [A, B, C];
  const all = [A, B, C, S];
  const checkVisible = async (name, query, predicate, limitMs = 30000) => {
    const t0 = Date.now();
    const observed = await Promise.all(
      all.map(async (replica) => {
        const result = await wait(
          async () => {
            const docs = await replica.read(query);
            return Boolean(predicate(docs));
          },
          { timeoutMs: limitMs, every: replica === S ? 1100 : 100 },
        );
        r.time(`${name} ${replica.name}`, result.ms);
        return { name: replica.name, ...result, elapsed: Date.now() - t0 };
      }),
    );
    r.check(
      name,
      observed.every((x) => x.ok && x.ms <= limitMs),
      observed.map((x) => `${x.name}=${x.ok ? x.ms : 'missing'}ms`).join(', '),
    );
    return observed;
  };
  const q = (date) => ({ col: 'dailyLogs', date });

  // Two races at once: on one id the fast clock deletes, on the other it edits.
  const raceDay = day(41);
  const deleteWins = ulid();
  const editWins = ulid();
  await A.write({ op: 'logFood', id: deleteWins, date: raceDay, text: 'C-SYNCX delete race' });
  await A.write({ op: 'logFood', id: editWins, date: raceDay, text: 'C-SYNCX edit race' });
  await checkVisible(
    'delete/edit baselines reached all replicas',
    q(raceDay),
    (d) => d[deleteWins] && d[editWins],
  );
  await Promise.all([A.goOffline(), B.goOffline()]);
  try {
    await A.invoke('delete', { col: 'dailyLogs', id: deleteWins });
    await A.write({ op: 'patch', col: 'dailyLogs', id: editWins, fields: { text: 'C-SYNCX fast edit' } });
    await B.write({ op: 'patch', col: 'dailyLogs', id: deleteWins, fields: { text: 'C-SYNCX slow edit' } });
    await B.invoke('delete', { col: 'dailyLogs', id: editWins });
    const a = await A.read(q(raceDay));
    const b = await B.read(q(raceDay));
    r.check(
      'offline delete/edit race holds divergent local states',
      !a[deleteWins] &&
        a[editWins]?.text === 'C-SYNCX fast edit' &&
        b[deleteWins]?.text === 'C-SYNCX slow edit' &&
        !b[editWins],
    );
    await B.goOnline();
    await sleep(1200);
    await A.goOnline();
    await checkVisible(
      'both concurrent deletes converge within 30 s',
      q(raceDay),
      (d) => !d[deleteWins] && !d[editWins],
    );
    const raw = await Promise.all(replicas.map((x) => x.invoke('get', { col: 'dailyLogs', id: deleteWins })));
    r.check(
      'delete winner is a tombstone on all three clients',
      raw.every((d) => d?._deleted === true),
      raw.map((d) => asText(d?._deleted)).join(', '),
    );
    r.check(
      'delete winner leaves no duplicate live record',
      (await Promise.all(all.map((x) => x.read(q(raceDay))))).every((d) => Object.keys(d).length === 0),
    );
  } finally {
    await Promise.all([A.goOnline(), B.goOnline()]);
    await Promise.all(replicas.map((x) => x.clock(0)));
  }
  if (process.env.SYNC_CONFLICT_RACE_ONLY === '1') return r.save();

  // Three replicas edit the same field while disconnected, with ordinary clocks and reverse arrival order.
  const normalDay = day(42);
  const normalId = ulid();
  await A.write({ op: 'logFood', id: normalId, date: normalDay, text: 'C-SYNCX normal baseline' });
  await checkVisible(
    'normal-clock three-way baseline',
    q(normalDay),
    (d) => d[normalId]?.text === 'C-SYNCX normal baseline',
  );
  await Promise.all(replicas.map((x) => x.goOffline()));
  try {
    await A.write({ op: 'patch', col: 'dailyLogs', id: normalId, fields: { text: 'C-SYNCX normal A' } });
    await sleep(20);
    await B.write({ op: 'patch', col: 'dailyLogs', id: normalId, fields: { text: 'C-SYNCX normal B' } });
    await sleep(20);
    await C.write({ op: 'patch', col: 'dailyLogs', id: normalId, fields: { text: 'C-SYNCX normal C' } });
    await A.goOnline();
    await sleep(500);
    await B.goOnline();
    await sleep(500);
    await C.goOnline();
    await checkVisible(
      'normal-clock three-way edit converges on newest C within 30 s',
      q(normalDay),
      (d) => d[normalId]?.text === 'C-SYNCX normal C',
    );
    r.check(
      'normal-clock conflict leaves one record per replica',
      (await Promise.all(all.map((x) => x.read(q(normalDay))))).every(
        (d) => Object.keys(d).length === 1 && Boolean(d[normalId]),
      ),
    );
    await A.write({
      op: 'patch',
      col: 'dailyLogs',
      id: normalId,
      fields: { text: 'C-SYNCX normal causal correction' },
    });
    await checkVisible(
      'observed causal correction visible within 5 s',
      q(normalDay),
      (d) => d[normalId]?.text === 'C-SYNCX normal causal correction',
      5000,
    );
  } finally {
    await Promise.all(replicas.map((x) => x.goOnline()));
  }

  // Three concurrent replacements of one field. A has the fast clock, but connects last.
  const threeDay = day(40);
  const threeId = ulid();
  await A.write({ op: 'logFood', id: threeId, date: threeDay, text: 'C-SYNCX original' });
  await checkVisible(
    'three-way baseline reached all replicas',
    q(threeDay),
    (d) => d[threeId]?.text === 'C-SYNCX original',
  );
  await Promise.all(replicas.map((x) => x.goOffline()));
  await Promise.all([A.clock(10 * 60_000), B.clock(-10 * 60_000), C.clock(0)]);
  try {
    await A.write({ op: 'patch', col: 'dailyLogs', id: threeId, fields: { text: 'C-SYNCX fast A' } });
    await B.write({ op: 'patch', col: 'dailyLogs', id: threeId, fields: { text: 'C-SYNCX slow B' } });
    await C.write({ op: 'patch', col: 'dailyLogs', id: threeId, fields: { text: 'C-SYNCX normal C' } });
    const local = await Promise.all(replicas.map((x) => x.read(q(threeDay))));
    r.check(
      'three offline replicas hold distinct same-field edits',
      local.map((d) => d[threeId]?.text).join('|') === 'C-SYNCX fast A|C-SYNCX slow B|C-SYNCX normal C',
    );
    await C.goOnline();
    await sleep(1200);
    await B.goOnline();
    await sleep(1200);
    const t0 = Date.now();
    await A.goOnline();
    const seen = await checkVisible(
      'fast clock wins on all four despite reconnecting last within 30 s',
      q(threeDay),
      (d) => d[threeId]?.text === 'C-SYNCX fast A',
    );
    r.observe('three-way reconnect elapsed ms', Date.now() - t0);
    if (seen.some((x) => !x.ok)) {
      r.observe(
        'three-way final texts',
        await Promise.all(
          all.map(async (x) => ({ name: x.name, text: (await x.read(q(threeDay)))[threeId]?.text ?? null })),
        ),
      );
      const states = await Promise.all(
        replicas.map(async (x) => {
          const s = await x.status();
          return {
            name: x.name,
            state: s.state,
            pendingChanges: s.pendingChanges,
            lastError: s.lastError?.code ?? null,
          };
        }),
      );
      r.observe('three-way client states', states);
      r.check(
        'quarantined replicas expose clock drift instead of claiming synced',
        states
          .filter((x) => x.name !== A.name)
          .every((x) => x.state === 'error' && x.lastError === 'clock_drift'),
      );
      r.observe(
        'drift quarantine',
        await Promise.all(
          replicas.map(async (x) => ({ name: x.name, rows: await x.invoke('quarantine', {}) })),
        ),
      );
    }
    r.check(
      'same-field conflict leaves exactly one record per replica',
      (await Promise.all(all.map((x) => x.read(q(threeDay))))).every(
        (d) => Object.keys(d).length === 1 && Boolean(d[threeId]),
      ),
    );

    // Once B has observed A's future clock, its next edit must advance the logical clock and win.
    if (seen.find((x) => x.name === B.name)?.ok) {
      await B.write({
        op: 'patch',
        col: 'dailyLogs',
        id: threeId,
        fields: { text: 'C-SYNCX observed then corrected B' },
      });
      await checkVisible(
        'edit after observing fast clock wins on all four within 5 s',
        q(threeDay),
        (d) => d[threeId]?.text === 'C-SYNCX observed then corrected B',
        5000,
      );
    }
  } finally {
    await Promise.all(replicas.map((x) => x.goOnline()));
  }

  return r.save();
}
