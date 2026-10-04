/** The Coach's conversation store over the conversation documents: settled turns only, latest view wins, reload resumes. */
import { createDocumentStore, createMemoryBackend } from '@/store';
// eslint-disable-next-line no-restricted-imports -- the test installs an in-memory document store
import { setDocumentStore } from '@/state/runtime';
import { listConversations, listTurns } from '@/commands/coach';
import type { ChatMessage } from '../../providers/types';
import { createCoachAdapter } from '../adapter';
import { createDocumentConversationStore } from '../documentStore';
import type { CoachBus } from '../tools';
import type { TurnView } from '../types';

beforeEach(() => {
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000001' }), validation: 'off' }));
});

const you: TurnView = { id: 'you-1', role: 'you', at: '2026-10-01T08:00:00.000Z', text: 'Two eggs and toast', cards: [], segment: 0 };
const coach: TurnView = { id: 'coach-1', role: 'coach', at: '2026-10-01T08:00:01.000Z', text: '', cards: [], streaming: true, segment: 0 };

describe('document conversation store', () => {
  it('writes a turn once it settles, then appends later views; readers see real messages only', async () => {
    const s = createDocumentConversationStore();
    await s.saveConversation({ id: 'coach', title: 'Coach', kind: 'coach', createdAt: you.at, updatedAt: you.at, segment: 0 });
    await s.appendTurn('coach', you);
    await s.appendTurn('coach', coach);
    await s.updateTurn('coach', { ...coach, text: 'Logg' });
    expect((await listTurns('coach')).map((t) => t.text)).toEqual(['Two eggs and toast']);
    // turn ids aren't document keys: every stored message has a ULID key
    expect((await listTurns('coach')).every((t) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(t.id))).toBe(true);
    await s.updateTurn('coach', { ...coach, text: 'Logged it.', streaming: false });
    await s.updateTurn('coach', { ...coach, text: 'Logged it.', streaming: false, stopped: true });
    expect((await listTurns('coach')).map((t) => [t.role, t.text])).toEqual([
      ['user', 'Two eggs and toast'],
      ['assistant', 'Logged it.'],
    ]);
    const restored = await createDocumentConversationStore().listTurns('coach');
    expect(restored.map((t) => t.id)).toEqual(['you-1', 'coach-1']);
    expect(restored[1]).toMatchObject({ text: 'Logged it.', stopped: true });
    expect((await listConversations())[0]).toMatchObject({ id: 'coach', turnCount: 2 });
  });

  it('keeps model messages per segment without images, and structured day summaries', async () => {
    const s = createDocumentConversationStore();
    const msgs: ChatMessage[] = [{ role: 'user', parts: [{ type: 'text', text: 'hi' }, { type: 'image', mediaType: 'image/jpeg', data: 'AAAA' } as unknown as ChatMessage['parts'][number]] }];
    await s.appendMessages('coach', 1, msgs);
    expect(await s.listMessages('coach', 1)).toEqual([{ role: 'user', parts: [{ type: 'text', text: 'hi' }, { type: 'text', text: '[photo]' }] }]);
    expect(await s.listMessages('coach', 2)).toEqual([]);
    const day = { date: '2026-09-30', decisions: ['rest Thursday'], logged: ['lunch'], openQuestions: [], userPrefsLearned: ['no fish'] };
    await s.saveSummaries('coach', 1, [day]);
    expect(await s.listSummaries('coach')).toEqual([day]);
  });

  it('a new adapter resumes the stored conversation (reload)', async () => {
    const s = createDocumentConversationStore();
    await s.saveConversation({ id: 'coach', title: 'Coach', kind: 'coach', createdAt: you.at, updatedAt: you.at, segment: 0 });
    await s.appendTurn('coach', you);
    const adapter = createCoachAdapter({ bus: {} as CoachBus, model: null, store: createDocumentConversationStore() });
    expect(adapter.history('coach')).toEqual([]);
    await vi.waitFor(() => expect(adapter.history('coach').map((t) => t.text)).toEqual(['Two eggs and toast']));
  });
});
