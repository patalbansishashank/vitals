/**
 * The AI provider configuration (non-secret: keys live in the KeyVault, never here or in any log). Written by
 * `ai.configure` from Settings › AI provider; the Coach runtime (`src/ai/coach`) subscribes and rebuilds its model.
 *
 * Persistence: the device-local `uiPrefs/me` document, field `aiProvider` (never synced: the key it pairs with lives on
 * this device only; exported with the other device preferences, and it holds no secret). Bound to the document store on
 * first use and kept in step with it (undo of `ai.configure`, imports, erase).
 */
import type { AdapterKind, Effort } from '@/ai/providers/types';
import { mintWriteToken, revokeWriteToken, type Doc, type DocumentStore } from '@/store';
import { getDocumentStore } from '@/state/runtime';

export interface AiProviderConfig {
  /** A preset id from `src/ai/providers/presets.ts`, or 'custom'. */
  presetId: string;
  /** Custom endpoint (preset 'custom' or an overridden base URL). */
  baseUrl?: string;
  /** API style of a custom endpoint (preset 'custom'); presets carry their own. */
  adapter?: AdapterKind;
  model: string;
  /** Optional separate model for photos; absent → the main model when it has vision. */
  visionModel?: string;
  /** Reasoning effort (settings-sync-ai.md §5.5); absent → medium. */
  effort?: Effort;
  /** "Small edits without asking" (low-impact edits apply with undo instead of a proposal). Default off. */
  smallEditsWithoutAsking: boolean;
  /** Monthly spend cap in USD; the Coach warns at 80 % and stops at 100 % when `stopAtCap`. */
  spendCapUsdMonthly?: number;
  /** Stop the Coach at the cap (default off: warn only). */
  stopAtCap?: boolean;
}

/** Field names that could carry a secret; never accepted in, or persisted with, the config. */
export const SECRET_FIELD = /^(key|api[-_]?key|secret|client[-_]?secret|token|access[-_]?token|password|authorization|auth)$/i;

const ADAPTERS: readonly AdapterKind[] = ['openai-chat', 'openai-responses', 'anthropic-messages'];
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];

/** Keeps only the known, well-typed fields; null when the shape is unusable. */
export function sanitizeAiConfig(v: unknown): AiProviderConfig | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.presetId !== 'string' || !o.presetId || typeof o.model !== 'string' || !o.model) return null;
  const out: AiProviderConfig = { presetId: o.presetId, model: o.model, smallEditsWithoutAsking: o.smallEditsWithoutAsking === true };
  if (typeof o.baseUrl === 'string' && o.baseUrl) out.baseUrl = o.baseUrl;
  if (typeof o.adapter === 'string' && (ADAPTERS as readonly string[]).includes(o.adapter)) out.adapter = o.adapter as AdapterKind;
  if (typeof o.visionModel === 'string' && o.visionModel) out.visionModel = o.visionModel;
  if (typeof o.effort === 'string' && (EFFORTS as readonly string[]).includes(o.effort)) out.effort = o.effort as Effort;
  if (typeof o.spendCapUsdMonthly === 'number' && Number.isFinite(o.spendCapUsdMonthly) && o.spendCapUsdMonthly > 0) out.spendCapUsdMonthly = o.spendCapUsdMonthly;
  if (o.stopAtCap === true) out.stopAtCap = true;
  return out;
}

const COL = 'uiPrefs' as const;
const DOC_ID = 'me';
const FIELD = 'aiProvider';

let current: AiProviderConfig | null = null;
let boundTo: DocumentStore | null = null;
let unwatch: (() => void) | null = null;
let pending: Promise<void> = Promise.resolve();
/** A local write happened since binding: the store's boot copy must not overwrite it (the change feed brings it). */
let dirty = false;
const listeners = new Set<(c: AiProviderConfig | null) => void>();

const same = (a: AiProviderConfig | null, b: AiProviderConfig | null) => JSON.stringify(a) === JSON.stringify(b);

function setCurrent(next: AiProviderConfig | null): void {
  if (same(current, next)) return;
  current = next;
  listeners.forEach((l) => l(current));
}

function fromDoc(doc: Doc<unknown> | null): AiProviderConfig | null {
  if (!doc || (doc as { _deleted?: unknown })._deleted) return null;
  return sanitizeAiConfig((doc as unknown as Record<string, unknown>)[FIELD]);
}

/**
 * Follows `uiPrefs/me.aiProvider` in the current document store (rebinds when tests or sync swap the store). Called by
 * every reader, so the config loads at boot as soon as anything asks for it; resolves once the store is ready.
 */
export function bindAiConfig(): Promise<void> {
  const store = getDocumentStore();
  if (store !== boundTo) {
    unwatch?.();
    boundTo = store;
    dirty = false;
    current = fromDoc(store.peek(COL, DOC_ID));
    unwatch = store.subscribe((change) => {
      if (change.col === COL && change.id === DOC_ID) setCurrent(fromDoc(change.doc));
    });
    pending = store.ready.then(
      () => {
        if (boundTo === store && !dirty) setCurrent(fromDoc(store.peek(COL, DOC_ID)));
      },
      () => undefined,
    );
  }
  return pending;
}

export function readAiConfig(): AiProviderConfig | null {
  void bindAiConfig();
  return current;
}

/** The merge patch that stores `next` in its document (null removes the field). */
export function aiConfigPatch(next: AiProviderConfig | null): Record<string, unknown> {
  return { [FIELD]: next ? sanitizeAiConfig(next) : null };
}

/**
 * Sets the config now and persists it in the background (a derive write). `ai.configure` writes through its own
 * change set instead (`aiConfigPatch` + `ctx.docs`) so the change is undoable; use `aiConfigSettled()` to await.
 */
export function writeAiConfig(next: AiProviderConfig | null, opts: { persist?: boolean } = {}): void {
  void bindAiConfig();
  dirty = true;
  setCurrent(next ? sanitizeAiConfig(next) : null);
  if (opts.persist === false) return;
  const store = getDocumentStore();
  pending = pending.then(async () => {
    await store.ready;
    const token = mintWriteToken('derive', { label: 'ai.config' });
    try {
      await store.transact(token, (tx) => tx.patch(COL, DOC_ID, aiConfigPatch(next)).then(() => undefined));
    } catch {
      /* the in-memory value still applies this session */
    } finally {
      revokeWriteToken(token);
    }
  });
}

/** Resolves when the config is loaded and every background write has landed. */
export function aiConfigSettled(): Promise<void> {
  void bindAiConfig();
  return pending;
}

export function onAiConfigChange(fn: (c: AiProviderConfig | null) => void): () => void {
  void bindAiConfig();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
