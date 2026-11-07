/**
 * The Coach surface's boundary (living-mode.md, Coach; docs/SUITE_SPEC.md: conversations, change review and undo,
 * multimodal logging, safety rules for AI actions). The page renders only what a `CoachAdapter` hands it: the
 * conversation, the cards each turn produced, the provider's status and the standing briefing. The chat logic and the
 * provider calls live behind it — nothing in this folder talks to a network.
 *
 * The real adapter over `src/ai` is `createCoachAdapter` (src/ai/coach/adapter.ts), installed at the app root by
 * `<CoachRuntimeProvider>` once a provider is configured; without one the default is `noProviderAdapter`.
 */
import { useContext, useMemo, useSyncExternalStore } from 'react';
import { useLivingClock } from '../clock';
import { useLivingSource } from '../data/source';
import type { ChangeAction, ChangeCardModel } from '../model/changeCard';
import type { ChangeActionExtra, ChangeCardView } from '../components/ChangeCard';
import { useCoachOnServer, useCoachProblem } from './availability';
import { COACH_COPY } from './copy';
import { briefingFromLiving, type BriefingModel } from './briefing';
import { CoachAdapterContext } from './adapterContext';

export type { BriefingModel, BriefingSection } from './briefing';

export type CoachStatusKind =
  | 'ready'
  | 'noProvider'
  | 'offline'
  | 'keyRefused'
  | 'outOfCredit'
  | 'rateLimited'
  | 'cors'
  | 'noTools'
  | 'basic'
  | 'safetyNoPlanning'
  /** The Coach runs on the paired server and can't answer now (`problem` says why; none while it is being checked). */
  | 'serverUnavailable';

export interface CoachStatus {
  kind: CoachStatusKind;
  /** "Anthropic", "OpenAI", "a model on your computer". */
  provider?: string;
  /** "Claude Sonnet 5.5". */
  model?: string;
  keyOwner?: 'your key' | 'local';
  /** The model can read photos (the photo key is hidden otherwise). */
  vision: boolean;
  /** Rate limited: seconds until the adapter tries again on its own. */
  retryInS?: number;
  /** No provider because the configured one couldn't be set up: what went wrong, in plain words. */
  problem?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  kind: 'coach' | 'onboarding';
  /** ISO instant of the last turn. */
  updatedAt: string;
}

export interface CoachTurn {
  id: string;
  role: 'you' | 'coach';
  /** ISO instant. */
  at: string;
  text: string;
  /** Your photo (96 px thumbnail); the alt text comes from the "what I saw" summary once the Coach has looked. */
  photo?: { url: string; alt: string };
  /** What the Coach looked at (a card of class `read`), shown as one collapsed line. */
  reads?: ChangeCardModel;
  /** Cards this turn produced (log, edit, destructive, blocked, uiOnly). */
  cards: ChangeCardView[];
  streaming?: boolean;
  stopped?: boolean;
  error?: { kind: string; message: string };
  /** Conversation segment (after about 30 turns earlier days are summarised for the Coach). */
  segment?: number;
  /** While streaming: what the Coach is doing now ("Looking at sleep…"), one short line. */
  progress?: string;
}

export type CoachStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'read'; card: ChangeCardModel }
  | { type: 'card'; card: ChangeCardView }
  | { type: 'done' }
  | { type: 'error'; kind: string; message: string };

export interface CoachSendInput {
  conversationId: string;
  text: string;
  photo?: File;
  /** Where the message came from (Today's log bar, a Food slot, a Train item). */
  context?: { date?: string; slot?: string; slotName?: string; screen?: string };
}

export interface CoachAdapter {
  status(): CoachStatus;
  conversations(): ConversationSummary[];
  history(conversationId: string): CoachTurn[];
  /** Streams one reply. Resolves when the reply is complete, stopped (`signal`) or failed. */
  send(input: CoachSendInput, onEvent: (e: CoachStreamEvent) => void, signal: AbortSignal): Promise<void>;
  /**
   * A person's decision on a card (Undo, Apply, Discard, an alternative, edited grams…). Destructive cards are never
   * completed here: the page runs the typed confirmation and only reports `{ outcome: 'confirmed' }` afterwards.
   */
  act(cardId: string, action: ChangeAction, extra?: ChangeActionExtra): Promise<{ ok: boolean; message?: string }>;
  briefing(): BriefingModel;
  subscribe(listener: () => void): () => void;
  revision(): number;
  /** Only when the Coach runs on the paired server: its temporary chats. */
  server?: ServerCoachControls;
}

/** A chat kept on the paired server (temporary: deleted `retentionHours` after its last message). */
export interface ServerChat {
  id: string;
  title?: string;
  createdAt: string;
  expiresAt: string;
}

export interface ServerCoachControls {
  current(): { id: string; expiresAt: string } | null;
  retentionHours(): number;
  list(): Promise<ServerChat[]>;
  open(id: string): Promise<{ ok: boolean; message?: string }>;
  keep(): Promise<{ ok: boolean; message?: string; expiresAt?: string }>;
  remove(id?: string): Promise<{ ok: boolean; message?: string }>;
  fresh(): void;
}

/** The one conversation (day after day); onboarding conversations get their own ids. */
/** The one continuous conversation; a fixed valid ULID (the conversations collection keys by ULID). */
export const MAIN_CONVERSATION = '00000000000000000000000000';

const NO_PROVIDER_STATUS: CoachStatus = { kind: 'noProvider', vision: false };
const NO_CONVERSATIONS: ConversationSummary[] = [];
const NO_TURNS: CoachTurn[] = [];

/** The Coach on the paired server while its adapter loads: nothing to send yet, and no "connect a provider". */
const SERVER_LOADING_STATUS: CoachStatus = { kind: 'serverUnavailable', provider: 'your server', vision: false };

/** No provider connected: an empty conversation, nothing sent anywhere; the briefing still shows what it would know. */
export function createNoProviderAdapter(opts: { briefing?: () => BriefingModel; problem?: string | null; onServer?: boolean } = {}): CoachAdapter {
  const briefing = opts.briefing ?? (() => briefingFromLiving(null, null));
  const status: CoachStatus = opts.onServer ? SERVER_LOADING_STATUS : opts.problem ? { ...NO_PROVIDER_STATUS, problem: opts.problem } : NO_PROVIDER_STATUS;
  return {
    status: () => status,
    conversations: () => NO_CONVERSATIONS,
    history: () => NO_TURNS,
    send: async (_input, onEvent) => {
      onEvent({ type: 'error', kind: 'noProvider', message: COACH_COPY.noProvider.title });
    },
    act: async () => ({ ok: false, message: COACH_COPY.noProvider.title }),
    briefing,
    subscribe: () => () => undefined,
    revision: () => 0,
  };
}

/** The app default until the AI layer exists. */
export const noProviderAdapter: CoachAdapter = createNoProviderAdapter();

export { CoachAdapterContext };

/**
 * The installed adapter, or the no-provider adapter whose briefing is generated from the living source (so "What the
 * Coach knows" is truthful even before a provider is connected).
 */
export function useCoachAdapter(): CoachAdapter {
  const installed = useContext(CoachAdapterContext);
  const source = useLivingSource();
  const clock = useLivingClock();
  const problem = useCoachProblem();
  const onServer = useCoachOnServer();
  const fallback = useMemo(() => createNoProviderAdapter({ briefing: () => briefingFromLiving(source, clock), problem, onServer }), [source, clock, problem, onServer]);
  // the server's Coach reads the data itself: "What the Coach knows" is the same picture, built here from the living source
  const withBriefing = useMemo<CoachAdapter | null>(() => {
    if (!installed?.server) return null;
    const a = installed;
    return {
      ...a,
      briefing: () => {
        const s = a.status();
        return briefingFromLiving(source, clock, { provider: { name: s.provider ?? 'your server', model: s.model ?? 'its AI' } });
      },
    };
  }, [installed, source, clock]);
  return withBriefing ?? installed ?? fallback;
}

/** Re-render on every adapter change; returns the adapter's revision (key memoised reads on it). */
export function useCoachRevision(adapter: CoachAdapter): number {
  return useSyncExternalStore(
    (l) => adapter.subscribe(l),
    () => adapter.revision(),
    () => adapter.revision(),
  );
}
