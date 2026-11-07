/**
 * The Coach adapter while this device is paired with the person's home server (server-coach contract): the server runs
 * the conversation in a temporary session and reads the data through its own /mcp tools, so nothing here calls an AI
 * service. One session at a time is open: its turns live in memory only (never in the synced conversations or messages
 * collections) and its id in the tab's storage, so a reload reattaches until the server deletes it. A `404` on the
 * session means it expired: a new one starts and the message is sent again.
 *
 * Streamed events: `delta` → the reply's text; `tool` → one progress line while it runs; `proposal` → an edit card in
 * the existing pending/approval flow (`coach.applyPending` / `coach.discardPending`, as the person).
 */
import type { Actor, CommandResult } from '@/commands/types';
import { CoachError, type CoachAttachment, type CoachServerStatus, type ServerCoachClient } from '@/net/coach';
import { proposalCard } from './cards';
import {
  type BriefingModelView,
  type CardAction,
  type CardView,
  type CoachAdapterShape,
  type CoachStatusView,
  type ConversationSummaryView,
  type SendInputView,
  type ServerChatView,
  type StreamEventView,
  type TurnView,
} from './types';

/** Tab storage key of the open session's id (no secret; not a `vitals.` key, so never exported or synced). */
export const SERVER_SESSION_KEY = 'vitals-coach.session';

export const SERVER_COACH_TEXT = {
  provider: 'your server',
  offline: 'You’re offline. Your message is kept; send it when you’re back.',
  checking: 'Checking the Coach on your server…',
  off: 'The Coach on your server is off.',
  unreachable: 'Your server can’t be reached.',
  notSupported: 'Your server doesn’t run the Coach yet.',
  unauthorized: 'This device is no longer connected to your server. Connect it again in Settings › Sync.',
  busy: (s?: number) => (s ? `Your server is busy. Try again in ${s} s.` : 'Your server is busy. Try again in a minute.'),
  failed: 'The Coach on your server couldn’t answer. Nothing was changed; try again.',
  notImage: 'Only photos can go to the Coach on your server.',
  photoAlt: 'Your photo',
  proposalTitle: 'Plan change',
  notHereYet: 'That proposal hasn’t reached this device yet. Try again in a moment.',
  gone: 'That card is no longer here.',
  cantNow: 'That can’t be done now.',
  askAgain: 'Ask the Coach for a fresh proposal.',
  noChat: 'No chat is open.',
} as const;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

export interface ServerCoachBus {
  dispatch(id: string, input: unknown, opts?: { actor?: Actor }): Promise<CommandResult>;
  getCommand?(id: string): { title?: string } | undefined;
}

export interface ServerCoachAdapterDeps {
  client: ServerCoachClient;
  /** The command bus: proposals are read (`coach.pending`) and decided (`coach.applyPending` / `coach.discardPending`). */
  bus: ServerCoachBus;
  /** The tab's storage (sessionStorage) for the open session's id; null keeps it in memory only. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Whether the server's Coach can answer (`setCoachAvailable`). */
  setAvailable?: (on: boolean) => void;
  /** The standing "What the Coach knows" panel (the UI injects it). */
  briefing?: () => BriefingModelView;
  now?: () => Date;
  newId?: () => string;
  isOnline?: () => boolean;
  /** Re-check the status this often while the Coach can't answer (default 60 s; 0 = never). */
  recheckMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  thumbnail?: (file: File) => string;
}

export interface ServerCoachAdapter extends CoachAdapterShape {
  server: NonNullable<CoachAdapterShape['server']>;
  /** Re-read `/v1/coach/status`. */
  refreshStatus(): Promise<void>;
  /** Resolves once a session kept from before a reload is reattached (or found gone). */
  ready(): Promise<void>;
  dispose(): void;
}

let seq = 0;
function defaultId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `id-${Date.now().toString(36)}-${(++seq).toString(36)}`;
}

function defaultThumbnail(f: File): string {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : '';
  } catch {
    return '';
  }
}

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** "gauge_sleep" → "Looking at sleep…", "log_meal" → "Logging meal…", "thinking" → "Thinking…". */
export function toolProgress(name: string): string {
  if (name === 'thinking') return 'Thinking…';
  const words = name
    .replace(/^(gauge|vitals|lumen)_/, '')
    .replace(/_(get|list|read)$/, '')
    .replace(/[_.-]+/g, ' ')
    .trim();
  if (/^log /.test(words)) return `Logging ${words.slice(4)}…`;
  return `Looking at ${words || 'your data'}…`;
}

function errorText(e: unknown): { kind: string; message: string } {
  if (e instanceof CoachError) {
    switch (e.code) {
      case 'unauthorized':
      case 'not_paired':
        return { kind: 'unauthorized', message: SERVER_COACH_TEXT.unauthorized };
      case 'busy':
        return { kind: 'rateLimited', message: SERVER_COACH_TEXT.busy(e.retryAfterS) };
      case 'unreachable':
        return { kind: 'offline', message: SERVER_COACH_TEXT.unreachable };
      case 'not_supported':
        return { kind: 'error', message: SERVER_COACH_TEXT.notSupported };
      default:
        return { kind: 'error', message: e.message && e.message !== e.code ? e.message : SERVER_COACH_TEXT.failed };
    }
  }
  return { kind: 'error', message: SERVER_COACH_TEXT.failed };
}

interface PendingInfo {
  pendingId: string;
  commandId: string;
  input: unknown;
  preview: unknown;
  expiresAt: string;
  actor: Actor;
}

const SERVER_ACTOR: Actor = { kind: 'ai', id: 'server-coach' } as Actor;
const USER = (onBehalfOf: Actor): Actor => ({ kind: 'user', id: 'local-user', onBehalfOf }) as Actor;

export function createServerCoachAdapter(deps: ServerCoachAdapterDeps): ServerCoachAdapter {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? defaultId;
  const storage = deps.storage ?? null;
  const thumb = deps.thumbnail ?? defaultThumbnail;
  const recheckMs = deps.recheckMs ?? 60_000;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));

  let status: { state: 'checking' } | { state: 'ok'; value: CoachServerStatus } | { state: 'error'; message: string } = { state: 'checking' };
  let session: { id: string; expiresAt: string } | null = null;
  let turns: TurnView[] = [];
  /** cardId → the staged proposal it decides. */
  const proposals = new Map<string, { pendingId: string; actor: Actor }>();
  const listeners = new Set<() => void>();
  let rev = 0;
  let disposed = false;
  let timer: unknown = null;
  let statusRun: Promise<void> | null = null;

  const bump = () => {
    rev++;
    listeners.forEach((l) => l());
  };
  const nowIso = () => now().toISOString();

  const readStored = (): string | null => {
    try {
      return storage?.getItem(SERVER_SESSION_KEY) ?? null;
    } catch {
      return null;
    }
  };
  const writeStored = (id: string | null) => {
    try {
      if (id) storage?.setItem(SERVER_SESSION_KEY, id);
      else storage?.removeItem(SERVER_SESSION_KEY);
    } catch {
      // private mode: the session stays in memory only
    }
  };
  const setSession = (s: { id: string; expiresAt: string } | null) => {
    session = s;
    writeStored(s?.id ?? null);
  };

  function available(): boolean {
    return status.state === 'ok' && status.value.available;
  }

  function schedule(): void {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (disposed || recheckMs <= 0 || available()) return;
    timer = setTimer(() => {
      timer = null;
      void refreshStatus();
    }, recheckMs);
  }

  function refreshStatus(): Promise<void> {
    statusRun ??= (async () => {
      try {
        const value = await deps.client.status();
        status = { state: 'ok', value };
      } catch (e) {
        const message = e instanceof CoachError && e.code === 'not_supported' ? SERVER_COACH_TEXT.notSupported : e instanceof CoachError && e.code === 'unauthorized' ? SERVER_COACH_TEXT.unauthorized : SERVER_COACH_TEXT.unreachable;
        status = { state: 'error', message };
      }
      if (disposed) return;
      deps.setAvailable?.(available());
      schedule();
      bump();
    })().finally(() => {
      statusRun = null;
    });
    return statusRun;
  }

  function baseStatus(): CoachStatusView {
    const common = { provider: SERVER_COACH_TEXT.provider, keyOwner: 'local' as const, vision: true };
    if (deps.isOnline && !deps.isOnline()) return { kind: 'offline', ...common };
    if (status.state === 'checking') return { kind: 'serverUnavailable', ...common, vision: false };
    if (status.state === 'error') return { kind: 'serverUnavailable', ...common, vision: false, problem: status.message };
    const v = status.value;
    if (!v.available) return { kind: 'serverUnavailable', ...common, vision: false, problem: v.reason || SERVER_COACH_TEXT.off };
    return { kind: 'ready', ...common, ...(v.model || v.backend ? { model: v.model || v.backend } : {}) };
  }

  const fromMessages = (messages: Array<{ role: 'user' | 'assistant'; text: string; at: string }>): TurnView[] =>
    messages.map((m) => ({ id: `${m.role === 'user' ? 'you' : 'coach'}-${newId()}`, role: m.role === 'user' ? ('you' as const) : ('coach' as const), at: m.at || nowIso(), text: m.text, cards: [] }));

  /** Reattach to a session: its messages replace the conversation. */
  async function attach(id: string): Promise<{ ok: boolean; message?: string }> {
    try {
      const d = await deps.client.session(id);
      setSession({ id: d.sessionId || id, expiresAt: d.expiresAt });
      turns = fromMessages(d.messages);
      proposals.clear();
      bump();
      return { ok: true };
    } catch (e) {
      if (e instanceof CoachError && e.code === 'expired') {
        if (readStored() === id) writeStored(null);
        return { ok: false, message: SERVER_COACH_TEXT.cantNow };
      }
      return { ok: false, message: errorText(e).message };
    }
  }

  const stored = readStored();
  const reattached: Promise<void> = stored ? attach(stored).then(() => undefined) : Promise.resolve();
  void refreshStatus();

  function push(t: TurnView): void {
    turns = [...turns, t];
    bump();
  }
  function update(id: string, f: (t: TurnView) => TurnView): void {
    turns = turns.map((t) => (t.id === id ? f(t) : t));
    bump();
  }

  /** The staged proposal behind a `proposal` event, when it has reached this device. */
  async function pendingOf(pendingId: string): Promise<PendingInfo | null> {
    try {
      const r = await deps.bus.dispatch('coach.pending', {});
      if (!r.ok || !('output' in r) || !Array.isArray(r.output)) return null;
      const p = (r.output as unknown[]).find((x) => isRec(x) && x.pendingId === pendingId);
      if (!isRec(p)) return null;
      return { pendingId, commandId: String(p.commandId ?? ''), input: p.input, preview: p.preview, expiresAt: String(p.expiresAt ?? ''), actor: (isRec(p.actor) ? p.actor : SERVER_ACTOR) as Actor };
    } catch {
      return null;
    }
  }

  async function proposalCardFor(ev: { id: string; summary: string }): Promise<CardView> {
    const p = await pendingOf(ev.id);
    const id = `proposal-${newId()}`;
    const title = (p && deps.bus.getCommand?.(p.commandId)?.title) || ev.summary || SERVER_COACH_TEXT.proposalTitle;
    proposals.set(id, { pendingId: ev.id, actor: p?.actor ?? SERVER_ACTOR });
    return proposalCard(id, title, p?.input ?? {}, p?.preview ?? null, {
      createdAt: nowIso(),
      ...(p?.expiresAt ? { until: p.expiresAt } : {}),
      ...(ev.summary ? { summary: ev.summary } : {}),
      ...(p?.commandId ? { commandId: p.commandId } : {}),
    });
  }

  async function ensureSession(input: SendInputView, signal: AbortSignal): Promise<void> {
    if (session) return;
    const created = await deps.client.createSession({ context: { screen: input.context?.screen ?? 'coach', ...(input.context?.date ? { date: input.context.date } : {}) } }, signal);
    setSession({ id: created.sessionId, expiresAt: created.expiresAt });
    if (created.greeting) {
      // the greeting comes first: before the message that opened the session
      const greeting: TurnView = { id: `coach-${newId()}`, role: 'coach', at: nowIso(), text: created.greeting, cards: [] };
      const lastYou = turns.findLastIndex((t) => t.role === 'you');
      turns = lastYou < 0 ? [...turns, greeting] : [...turns.slice(0, lastYou), greeting, ...turns.slice(lastYou)];
      bump();
    }
  }

  async function streamTurn(sessionId: string, coachId: string, body: { text: string; attachments?: CoachAttachment[] }, onEvent: (e: StreamEventView) => void, signal: AbortSignal): Promise<'done' | 'error'> {
    const running = new Map<string, string>();
    const progress = () => [...running.values()].at(-1);
    for await (const ev of deps.client.send(sessionId, body, signal)) {
      if (ev.type === 'delta') {
        update(coachId, (t) => ({ ...t, text: t.text + ev.text }));
        onEvent({ type: 'text', delta: ev.text });
      } else if (ev.type === 'tool') {
        if (ev.status === 'start') running.set(ev.name, toolProgress(ev.name));
        else running.delete(ev.name);
        const line = progress();
        update(coachId, (t) => {
          const { progress: _old, ...rest } = t;
          return line ? { ...rest, progress: line } : rest;
        });
      } else if (ev.type === 'proposal') {
        const card = await proposalCardFor(ev);
        update(coachId, (t) => ({ ...t, cards: [...t.cards, card] }));
        onEvent({ type: 'card', card });
      } else if (ev.type === 'error') {
        const error = { kind: 'error', message: ev.message || SERVER_COACH_TEXT.failed };
        update(coachId, (t) => {
          const { progress: _p, ...rest } = t;
          return { ...rest, streaming: false, error };
        });
        onEvent({ type: 'error', ...error });
        return 'error';
      } else if (ev.type === 'done') {
        break;
      }
    }
    // the session's clock restarts with every message (the server moves `expiresAt`; this is the client's estimate)
    const hours = status.state === 'ok' ? status.value.retentionHours : 24;
    if (session && session.id === sessionId) setSession({ id: sessionId, expiresAt: new Date(now().getTime() + hours * 3_600_000).toISOString() });
    return 'done';
  }

  async function send(input: SendInputView, onEvent: (e: StreamEventView) => void, signal: AbortSignal): Promise<void> {
    await reattached;
    const at = nowIso();
    const you: TurnView = { id: `you-${newId()}`, role: 'you', at, text: input.text, cards: [] };
    push(you);
    const fail = (kind: string, message: string) => {
      push({ id: `coach-${newId()}`, role: 'coach', at: nowIso(), text: '', cards: [], error: { kind, message } });
      onEvent({ type: 'error', kind, message });
    };
    if (deps.isOnline && !deps.isOnline()) return fail('offline', SERVER_COACH_TEXT.offline);

    let attachments: CoachAttachment[] | undefined;
    if (input.photo) {
      if (!input.photo.type.startsWith('image/')) return fail('error', SERVER_COACH_TEXT.notImage);
      update(you.id, (t) => ({ ...t, photo: { url: thumb(input.photo!), alt: SERVER_COACH_TEXT.photoAlt } }));
      attachments = [{ kind: 'image', mime: input.photo.type, data: await base64Of(input.photo) }];
    }
    const bits = [input.context?.screen && input.context.screen !== 'coach' && `from ${input.context.screen}`, input.context?.slot && `slot ${input.context.slot}${input.context.slotName ? ` (${input.context.slotName})` : ''}`, input.context?.date && `date ${input.context.date}`].filter(Boolean);
    const text = bits.length ? `${input.text}\n[context: ${bits.join(', ')}]` : input.text;
    const body = { text, ...(attachments ? { attachments } : {}) };

    const coachId = `coach-${newId()}`;
    push({ id: coachId, role: 'coach', at, text: '', cards: [], streaming: true });
    const finish = (patch: Partial<TurnView> = {}) =>
      update(coachId, (t) => {
        const { progress: _p, ...rest } = t;
        return { ...rest, streaming: false, ...patch };
      });

    for (let attempt = 0; ; attempt++) {
      try {
        await ensureSession(input, signal);
        const outcome = await streamTurn(session!.id, coachId, body, onEvent, signal);
        if (signal.aborted) {
          finish({ stopped: true });
          return;
        }
        if (outcome === 'done') {
          finish();
          onEvent({ type: 'done' });
        }
        return;
      } catch (e) {
        if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
          finish({ stopped: true });
          return;
        }
        if (e instanceof CoachError && e.code === 'expired' && attempt === 0) {
          // the server deleted it (24 h after its last message): its history is gone there too; start again
          setSession(null);
          proposals.clear();
          turns = turns.filter((t) => t.id === you.id || t.id === coachId);
          bump();
          continue;
        }
        const mapped = errorText(e);
        finish({ error: mapped });
        onEvent({ type: 'error', ...mapped });
        if (e instanceof CoachError && (e.code === 'unreachable' || e.code === 'not_supported')) void refreshStatus();
        return;
      }
    }
  }

  function findCard(cardId: string): { turn: TurnView; card: CardView } | null {
    for (const turn of turns) {
      const card = turn.cards.find((c) => c.id === cardId);
      if (card) return { turn, card };
    }
    return null;
  }

  function setCard(turnId: string, card: CardView): void {
    update(turnId, (t) => ({ ...t, cards: t.cards.map((c) => (c.id === card.id ? card : c)) }));
  }

  const failure = (r: Extract<CommandResult, { ok: false }>, notYet = false) => (notYet && r.error.code === 'not_found' ? SERVER_COACH_TEXT.notHereYet : r.error.message || SERVER_COACH_TEXT.cantNow);

  async function act(cardId: string, action: CardAction): Promise<{ ok: boolean; message?: string }> {
    const found = findCard(cardId);
    const rec = proposals.get(cardId);
    if (!found || !rec) return action === 'open' || action === 'adjust' ? { ok: true } : { ok: false, message: SERVER_COACH_TEXT.gone };
    const { turn, card } = found;
    switch (action) {
      case 'apply': {
        if (card.state !== 'pending') return { ok: false, message: SERVER_COACH_TEXT.cantNow };
        const r = await deps.bus.dispatch('coach.applyPending', { pendingId: rec.pendingId }, { actor: USER(rec.actor) });
        if (!r.ok) {
          if (r.error.code === 'conflict' && r.error.detail?.retryable) {
            setCard(turn.id, { ...card, state: 'stale', note: SERVER_COACH_TEXT.askAgain });
            return { ok: false, message: r.error.message };
          }
          return { ok: false, message: failure(r, true) };
        }
        const out = 'output' in r && isRec(r.output) ? r.output : {};
        if (out.applied === false) return { ok: false, message: isRec(out.error) && typeof out.error.message === 'string' ? out.error.message : SERVER_COACH_TEXT.cantNow };
        setCard(turn.id, { ...card, state: 'applied', createdAt: nowIso(), until: undefined });
        return { ok: true };
      }
      case 'discard':
      case 'dismiss': {
        if (card.state !== 'pending' && card.state !== 'stale') return { ok: false, message: SERVER_COACH_TEXT.cantNow };
        const r = await deps.bus.dispatch('coach.discardPending', { pendingId: rec.pendingId }, { actor: USER(rec.actor) });
        if (!r.ok && r.error.code !== 'not_found') return { ok: false, message: failure(r) };
        setCard(turn.id, { ...card, state: 'discarded' });
        return { ok: true };
      }
      case 'review':
        return { ok: false, message: SERVER_COACH_TEXT.askAgain };
      case 'open':
      case 'adjust':
        return { ok: true };
      default:
        return { ok: false, message: SERVER_COACH_TEXT.cantNow };
    }
  }

  function conversations(): ConversationSummaryView[] {
    if (!session || !turns.length) return [];
    return [{ id: session.id, title: 'Coach', kind: 'coach', updatedAt: turns.at(-1)!.at }];
  }

  const server: ServerCoachAdapter['server'] = {
    current: () => session,
    retentionHours: () => (status.state === 'ok' ? status.value.retentionHours : 24),
    async list(): Promise<ServerChatView[]> {
      const rows = await deps.client.sessions();
      return rows.filter((s) => !s.app || s.app === 'vitals').map((s) => ({ id: s.sessionId, ...(s.title ? { title: s.title } : {}), createdAt: s.createdAt, expiresAt: s.expiresAt }));
    },
    open: (id) => attach(id),
    async keep() {
      if (!session) return { ok: false, message: SERVER_COACH_TEXT.noChat };
      const id = session.id;
      try {
        const r = await deps.client.keep(id);
        const hours = status.state === 'ok' ? status.value.retentionHours : 24;
        const expiresAt = r.expiresAt ?? new Date(Math.max(Date.parse(session?.expiresAt ?? '') || 0, now().getTime()) + hours * 3_600_000).toISOString();
        if (session?.id === id) setSession({ id, expiresAt });
        bump();
        return { ok: true, expiresAt };
      } catch (e) {
        if (e instanceof CoachError && e.code === 'expired' && session?.id === id) {
          setSession(null);
          turns = [];
          proposals.clear();
          bump();
        }
        return { ok: false, message: errorText(e).message };
      }
    },
    async remove(id) {
      const target = id ?? session?.id;
      if (!target) return { ok: false, message: SERVER_COACH_TEXT.noChat };
      try {
        await deps.client.remove(target);
      } catch (e) {
        return { ok: false, message: errorText(e).message };
      }
      if (session?.id === target) {
        setSession(null);
        turns = [];
        proposals.clear();
      }
      bump();
      return { ok: true };
    },
    fresh() {
      setSession(null);
      turns = [];
      proposals.clear();
      bump();
    },
  };

  const EMPTY_BRIEFING: BriefingModelView = { sections: [] };

  return {
    status: baseStatus,
    conversations,
    history: () => turns,
    send,
    act,
    briefing: () => deps.briefing?.() ?? EMPTY_BRIEFING,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    revision: () => rev,
    server,
    refreshStatus,
    ready: () => reattached,
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      listeners.clear();
    },
  };
}
