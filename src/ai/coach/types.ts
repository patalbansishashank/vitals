/**
 * The Coach's view types, structurally identical to the Coach surface's (`src/features/living/coach/adapter.ts`,
 * `src/features/living/model/changeCard.ts`, `src/features/living/components/ChangeCard.tsx`). `src/ai` is headless and
 * may not import the UI layers, so the shapes are restated here; `CoachRuntimeProvider.tsx` assigns the adapter built
 * here to the UI's `CoachAdapter` type, which keeps the two in step at compile time.
 */
import type { Actor } from '@/commands/types';

export type CardClass = 'read' | 'log' | 'edit' | 'destructive' | 'blocked' | 'uiOnly';
export type CardState = 'applied' | 'pending' | 'undone' | 'discarded' | 'expired' | 'stale';
export type CardAction = 'undo' | 'redo' | 'edit' | 'apply' | 'adjust' | 'discard' | 'review' | 'dismiss' | 'alternative' | 'open';

export interface CardModel {
  id: string;
  class: CardClass;
  title: string;
  source?: { label: string; confidence?: number; band?: string };
  createdAt: string;
  until?: string;
  items: Array<{ label: string; before: string | null; after: string | null }>;
  totals?: string;
  impact?: {
    goalDates: Array<{ label: string; before: [string, string] | null; after: [string, string] | null }>;
    metrics: Array<{ label: string; delta: number; unit: string; decimals?: number }>;
  };
  reads?: Array<{ label: string; summary?: string }>;
  confirm?: { consequence: string; word: string; actionLabel: string };
  blocked?: { rule: string; alternatives: Array<{ id: string; label: string }> };
  setting?: { label: string; to: string };
  state: CardState;
  refreshed?: Pick<CardModel, 'items' | 'impact'>;
  note?: string;
}

export interface MealComponentCard {
  id: string;
  name: string;
  portion?: string;
  grams: number;
  gramsLow: number;
  gramsHigh: number;
  kcal?: number;
  yours?: boolean;
}

export interface MealCard {
  photo?: { url: string; alt: string };
  components: MealComponentCard[];
  cue?: string;
  saw?: string[];
  unseen?: string[];
  review?: boolean;
  ask?: { componentId: string; question: string; options: Array<{ id: string; label: string }> };
}

/**
 * What a card remembers to complete the person's decisions (the command, its own undo or ChangeSet, a staged proposal).
 * Kept on the card itself, so it is stored with the conversation and a reload (a new executor) can still Undo within
 * the window (SUITE_SPEC §5.5). Not rendered.
 */
export interface CardRecordData {
  kind: 'log' | 'staged' | 'local' | 'destructive' | 'info';
  commandId: string;
  input: unknown;
  aiActor: Actor;
  changeSetId?: string;
  /** The command's own undo (`log.retract {entryId}` for meals), preferred over `history.undo`. */
  undo?: { command: string; input: unknown };
  pendingId?: string;
  meal?: { meta: { slot?: string; clockH?: number; photo?: { url: string; alt: string } }; fromPhoto: boolean };
}

/**
 * E20: the review table of a read blood test report (`markers.import`). Shown, never saved by the Coach: Apply sends
 * `markers.confirm` as the person (the confident rows with the sample date, or the rows the app's review table passes
 * in `CardActionExtra.markers`).
 */
export interface MarkersReviewCard {
  extractionId: string;
  attachmentId: string;
  route: 'textLayer' | 'vision';
  sampleDate?: string;
  rows: Array<{ row: number; markerId: string | null; name: string; value: number | null; unit: string | null; range?: string; confidence: number; calculated: boolean; issues: string[] }>;
  /** Rows kept for display only (blood count indices and the like). */
  displayOnly: number;
  notInReport: string[];
}

export type CardView = CardModel & { meal?: MealCard; markers?: MarkersReviewCard; record?: CardRecordData };

export interface CardActionExtra {
  alternativeId?: string;
  componentId?: string;
  grams?: number;
  optionId?: string;
  outcome?: 'confirmed';
  /** E20: the rows the person ticked in the review table of a blood test report card (`markers.confirm` input). */
  markers?: { accept: Array<{ row: number; markerId?: string; value?: number; unit?: string; date: string; fasting?: boolean }>; context?: Record<string, boolean> };
}

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
  | 'safetyNoPlanning';

export interface CoachStatusView {
  kind: CoachStatusKind;
  provider?: string;
  model?: string;
  keyOwner?: 'your key' | 'local';
  vision: boolean;
  retryInS?: number;
  problem?: string;
}

export interface ConversationSummaryView {
  id: string;
  title: string;
  kind: 'coach' | 'onboarding';
  updatedAt: string;
}

export interface TurnView {
  id: string;
  role: 'you' | 'coach';
  at: string;
  text: string;
  photo?: { url: string; alt: string };
  reads?: CardModel;
  cards: CardView[];
  streaming?: boolean;
  stopped?: boolean;
  error?: { kind: string; message: string };
  segment?: number;
}

export type StreamEventView =
  | { type: 'text'; delta: string }
  | { type: 'read'; card: CardModel }
  | { type: 'card'; card: CardView }
  | { type: 'done' }
  | { type: 'error'; kind: string; message: string };

export interface SendInputView {
  conversationId: string;
  text: string;
  photo?: File;
  context?: { date?: string; slot?: string; slotName?: string; screen?: string };
}

export interface BriefingSectionView {
  id: 'always' | 'about' | 'plan' | 'week' | 'signals' | 'ask' | 'sentTo';
  title: string;
  lines: string[];
  link?: { label: string; to: string };
}

export interface BriefingModelView {
  sections: BriefingSectionView[];
}

/** The adapter shape (`CoachAdapter`). */
export interface CoachAdapterShape {
  status(): CoachStatusView;
  conversations(): ConversationSummaryView[];
  history(conversationId: string): TurnView[];
  send(input: SendInputView, onEvent: (e: StreamEventView) => void, signal: AbortSignal): Promise<void>;
  act(cardId: string, action: CardAction, extra?: CardActionExtra): Promise<{ ok: boolean; message?: string }>;
  briefing(): BriefingModelView;
  subscribe(listener: () => void): () => void;
  revision(): number;
}

/** The one continuous conversation; a fixed valid ULID (the conversations collection keys by ULID). */
export const MAIN_CONVERSATION = '00000000000000000000000000';
