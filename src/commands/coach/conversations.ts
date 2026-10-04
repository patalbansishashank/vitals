/** `coach.conversations`, `coach.history`, `coach.searchNotes`, `coach.delete` (E9b), over `./store.ts`. */
import { fail } from '../registry';
import { implementLate as implement } from './late';
import { deleteConversation, getConversation, listConversations, listSummaries, listTurns, type Turn } from './store';

const BY = 'E9b';

implement('coach.conversations', async () => {
  const list = await listConversations();
  return list.map((c) => ({ conversationId: c.id, title: c.title, kind: c.kind, createdAt: c.createdAt, lastAt: c.lastAt, turnCount: c.turnCount, segment: c.segment, ...(c.archived ? { archived: true } : {}) }));
}, BY);

implement('coach.history', async (_ctx, input: { conversationId: string; before?: string; limit?: number }) => {
  if (!(await getConversation(input.conversationId))) fail('not_found', 'That conversation does not exist.', { path: '/conversationId' });
  const limit = input.limit ?? 50;
  // one extra to learn whether older messages remain
  const page = await listTurns(input.conversationId, { ...(input.before ? { before: input.before } : {}), limit: limit + 1 });
  const hasMore = page.length > limit;
  const turns = hasMore ? page.slice(1) : page;
  return turns.map((t, i) => ({ ...t, ...(i === 0 && hasMore ? { hasMore: true } : {}) }));
}, BY);

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

function snippet(text: string, terms: readonly string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const low = flat.toLowerCase();
  const at = Math.max(0, Math.min(...terms.map((t) => low.indexOf(t)).filter((i) => i >= 0)));
  const from = Math.max(0, at - 40);
  return `${from > 0 ? '…' : ''}${flat.slice(from, from + 160)}${from + 160 < flat.length ? '…' : ''}`;
}

implement('coach.searchNotes', async (_ctx, input: { q: string }) => {
  const terms = [...new Set(words(input.q))];
  if (terms.length === 0) return [];
  const convs = await listConversations({ includeArchived: true });
  const hits: Array<{ kind: 'summary' | 'turn'; conversationId: string; id: string; at: string; date?: string; role?: Turn['role']; snippet: string; score: number }> = [];
  const score = (text: string): number => {
    const w = words(text);
    if (w.length === 0) return 0;
    let s = 0;
    for (const t of terms) {
      const tf = w.filter((x) => x === t || x.startsWith(t)).length;
      if (tf > 0) s += 1 + Math.log(tf);
    }
    return s === 0 ? 0 : (s * terms.length) / (terms.length + Math.log(1 + w.length / 50));
  };
  for (const c of convs) {
    for (const s of await listSummaries(c.id)) {
      const sc = score(s.text);
      // summaries are the distilled notes: they outrank raw turns on an equal match
      if (sc > 0) hits.push({ kind: 'summary', conversationId: c.id, id: s.id, at: s.at, date: s.date, snippet: snippet(s.text, terms), score: sc * 1.5 });
    }
    for (const t of await listTurns(c.id)) {
      if (t.role === 'tool') continue;
      const sc = score(t.text);
      if (sc > 0) hits.push({ kind: 'turn', conversationId: c.id, id: t.id, at: t.at, role: t.role, snippet: snippet(t.text, terms), score: sc });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || (a.at < b.at ? 1 : -1))
    .slice(0, 20)
    .map((h) => ({ ...h, score: Math.round(h.score * 100) / 100 }));
}, BY);

implement('coach.delete', async (ctx, input: { conversationId: string }) => ({ deleted: await deleteConversation(input.conversationId, ctx.docs) }), BY);
