/**
 * `ConversationStore` over the conversation documents (`@/commands/coach` store: `conversations` + append-only
 * `messages`, SUITE_SPEC §2, §5.4), so the Coach survives a reload and `coach.history` / `coach.searchNotes` /
 * `coach.delete` see the same conversation.
 *
 * - A settled turn (not streaming) is one real `user` / `assistant` message (text + cards), id = the turn's id. While a
 *   reply streams nothing is written; later changes to a written turn (a card undone, applied, stopped) are appended as
 *   `note` messages carrying the new view (`coach: { view }`), latest wins.
 * - Model messages (tool calls, results, provider state) are `note` messages with `coach: { chat, segment }`; image
 *   parts are replaced by "[photo]" (photos stay in the blob store; object URLs are not persisted).
 * - Day summaries are summary notes with the structured `DaySummary` as `detail`.
 */
import * as docs from '@/commands/coach/store';
import type { DaySummary } from '../tools/budget';
import type { ChatMessage } from '../providers/types';
import type { ConversationStore, StoredConversation } from './conversation';
import type { TurnView } from './types';

interface CoachRecord {
  view?: TurnView;
  chat?: ChatMessage[];
  segment?: number;
}

const roleOf = (t: TurnView): 'user' | 'assistant' => (t.role === 'you' ? 'user' : 'assistant');

/** A view as persisted: object URLs die with the page, so only the alt text of a photo is kept. */
function persistable(t: TurnView): TurnView {
  const { photo, streaming: _s, ...rest } = t;
  void _s;
  return { ...rest, ...(photo ? { photo: { url: '', alt: photo.alt } } : {}) };
}

function stripImages(m: ChatMessage): ChatMessage {
  return { ...m, parts: m.parts.map((p) => (p.type === 'text' ? p : { type: 'text' as const, text: '[photo]' })) };
}

function summaryText(d: DaySummary): string {
  const line = (label: string, xs: readonly string[]) => (xs.length ? `${label}: ${xs.join('; ')}` : '');
  return [line('Decided', d.decisions), line('Logged', d.logged), line('Open', d.openQuestions), line('Learned', d.userPrefsLearned)].filter(Boolean).join('\n') || 'Nothing of note.';
}

function isDaySummary(v: unknown): v is DaySummary {
  return !!v && typeof v === 'object' && typeof (v as DaySummary).date === 'string' && Array.isArray((v as DaySummary).decisions);
}

export function createDocumentConversationStore(): ConversationStore {
  /** Turn ids already written as a real message. */
  const written = new Set<string>();

  async function writeTurn(conversationId: string, t: TurnView): Promise<void> {
    if (written.has(t.id)) return;
    written.add(t.id);
    const v = persistable(t);
    // the message gets its own ULID key; the turn's id lives in `coach.view` (turn ids aren't valid document keys)
    await docs.appendTurn(conversationId, { at: t.at, role: roleOf(t), text: t.text, ...(t.segment !== undefined ? { segment: t.segment } : {}), ...(t.cards.length ? { cards: t.cards } : {}), coach: { view: v } satisfies CoachRecord });
  }

  return {
    conversations: async () =>
      (await docs.listConversations({ includeArchived: true })).map((c): StoredConversation => ({ id: c.id, title: c.title, kind: c.kind, createdAt: c.createdAt, updatedAt: c.lastAt, segment: c.segment })),
    saveConversation: async (c) => {
      const existing = await docs.getConversation(c.id);
      if (!existing) await docs.createConversation({ id: c.id, title: c.title, kind: c.kind, now: c.createdAt });
      if (!existing || existing.segment !== c.segment) await docs.updateConversation(c.id, { segment: c.segment });
    },
    appendTurn: async (id, t) => {
      if (!t.streaming) await writeTurn(id, t);
    },
    updateTurn: async (id, t) => {
      if (t.streaming) return;
      if (!written.has(t.id)) return writeTurn(id, t);
      await docs.appendTurn(id, { role: 'note', text: '', coach: { view: persistable(t) } satisfies CoachRecord });
    },
    listTurns: async (id) => {
      const order: string[] = [];
      const views = new Map<string, TurnView>();
      for (const t of await docs.listTurns(id, { includeNotes: true })) {
        const rec = t.coach as CoachRecord | undefined;
        if (rec?.view) {
          if (!views.has(rec.view.id)) order.push(rec.view.id);
          views.set(rec.view.id, rec.view);
          written.add(rec.view.id);
        } else if ((t.role === 'user' || t.role === 'assistant') && !views.has(t.id)) {
          // written by another surface (an older build, an import): shown as plain text
          order.push(t.id);
          views.set(t.id, { id: t.id, role: t.role === 'user' ? 'you' : 'coach', at: t.at, text: t.text, cards: [], segment: t.segment });
        }
      }
      return order.map((k) => views.get(k)!);
    },
    appendMessages: async (id, segment, messages) => {
      if (!messages.length) return;
      await docs.appendTurn(id, { role: 'note', text: '', segment, coach: { chat: messages.map(stripImages), segment } satisfies CoachRecord });
    },
    listMessages: async (id, segment) =>
      (await docs.listTurns(id, { includeNotes: true })).flatMap((t) => {
        const rec = t.coach as CoachRecord | undefined;
        return rec?.chat && rec.segment === segment ? rec.chat : [];
      }),
    saveSummaries: async (id, segment, summaries) => {
      for (const d of summaries) await docs.saveSummary(id, { date: d.date, text: summaryText(d), turnsCovered: 0, tokensCovered: 0, segment, detail: d });
    },
    listSummaries: async (id) =>
      (await docs.listSummaries(id)).map((s) => (isDaySummary(s.detail) ? s.detail : { date: s.date, decisions: [s.text], logged: [], openQuestions: [], userPrefsLearned: [] })),
  };
}
