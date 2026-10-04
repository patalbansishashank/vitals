import { canonical } from '../lib/docs.mjs';
import { effectiveEntries } from '../../../../src/living/logs.ts';

export default async function mcp({ A, B, C, S, r, wait, day, ulid }) {
  for (let round = 0; round < 2; round++) {
    const date = day(65 + round);
    const original = ulid();
    await A.write({ op: 'logFood', id: original, date, text: 'C-SYNCX original meal' });
    const ready = await wait(async () => Boolean((await S.read({ col: 'dailyLogs', date }))[original]), {
      every: 1100,
    });
    r.check(`round ${round}: original meal reaches server`, ready.ok);
    await A.goOffline();
    const base = (await A.read({ col: 'dailyLogs', date }))[original];
    // log.edit appends a replacement with a new id; replay that exact persistence contract on the offline device.
    const deviceEdit = ulid();
    await A.write({
      op: 'put',
      col: 'dailyLogs',
      id: deviceEdit,
      value: {
        ...base,
        supersedes: original,
        at: new Date().toISOString(),
        clockH: 13,
        text: 'C-SYNCX device edit',
      },
    });
    const tOnline = Date.now();
    const answer = await S.call('log_edit', {
      entryId: original,
      patch: { text: 'C-SYNCX MCP edit', clockH: 14 },
    });
    const serverEdit = (answer.data ?? answer.output)?.entryId;
    r.check(
      `round ${round}: concurrent MCP edit commits`,
      answer.ok !== false && Boolean(serverEdit),
      answer.error?.code ?? '',
    );
    if (!serverEdit) {
      await A.goOnline();
      continue;
    }
    const onlineSeen = await Promise.all(
      [B, C].map((x) =>
        wait(async () => Boolean((await x.read({ col: 'dailyLogs', date }))[serverEdit]), {
          timeoutMs: 10000,
        }),
      ),
    );
    const onlineMs = Date.now() - tOnline;
    r.time(`round ${round}: MCP edit visible online`, onlineMs);
    r.check(
      `round ${round}: MCP edit reaches online replicas within 5 s`,
      onlineSeen.every((x) => x.ok) && onlineMs <= 5000,
    );
    const reconnectAt = Date.now();
    await A.goOnline();
    await A.reconnect();
    const rawConverged = await wait(
      async () => {
        const views = await Promise.all([A, B, C].map((x) => x.read({ col: 'dailyLogs', date })));
        return views.every(
          (view) =>
            view[original] && view[deviceEdit] && view[serverEdit] && canonical(view) === canonical(views[0]),
        );
      },
      { timeoutMs: 35000 },
    );
    r.time(`round ${round}: reconnect raw documents converge`, Date.now() - reconnectAt);
    r.check(
      `round ${round}: all three raw records converge without loss within 30 s`,
      rawConverged.ok && Date.now() - reconnectAt <= 30000,
    );
    const serverVisible = await wait(
      async () => {
        const docs = await S.read({ col: 'dailyLogs', date });
        return docs[deviceEdit] ? { ok: true, docs } : false;
      },
      { timeoutMs: 30000, every: 1100 },
    );
    const serverDocs = serverVisible.value?.docs ?? {};
    const deviceDocs = await A.read({ col: 'dailyLogs', date });
    const effective = effectiveEntries(Object.entries(deviceDocs).map(([id, body]) => ({ ...body, id })));
    r.observe(`round ${round}: edit fork counts`, {
      stored: Object.keys(deviceDocs).length,
      deviceEffective: effective.length,
      serverEffective: Object.keys(serverDocs).length,
    });
    // SUITE_SPEC §2.5 deliberately retains both sibling edits until the person resolves the conflict.
    r.check(
      `round ${round}: device retains exactly two sibling edits for resolution`,
      effective.length === 2 && effective.every((entry) => entry.supersedes === original),
    );
    r.check(
      `round ${round}: server retains the same two sibling edits for resolution`,
      Object.keys(serverDocs).length === 2 && Boolean(serverDocs[deviceEdit] && serverDocs[serverEdit]),
    );
    r.check(
      `round ${round}: original meal stays hidden after edits`,
      !serverDocs[original] && !effective.some((entry) => entry.id === original),
    );
  }
}
