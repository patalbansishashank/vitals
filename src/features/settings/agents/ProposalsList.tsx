import { useCallback, useEffect, useState } from 'react';
import { InlineWarning, Key } from '@/components';
import { dispatch, getCommand, on, type Actor } from '@/commands';
import { SettingsGroup, SettingsItem } from '../SettingRow';
import { formatSyncTime } from '../sync/status';

export const PROPOSALS_COPY = {
  heading: (n: number) => (n === 1 ? '1 change waiting' : `${n} changes waiting`),
  apply: 'Apply',
  dismiss: 'Dismiss',
  applyFailed: 'That proposal could not be applied.',
  loadFailed: 'Could not read the proposals.',
  validUntil: (when: string) => `valid until ${when}`,
  listLabel: 'Proposals waiting',
} as const;

export interface PendingProposal {
  pendingId: string;
  commandId: string;
  actor: Partial<Actor> & Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  input?: unknown;
  preview?: unknown;
}

/**
 * Product names for the MCP client ids agents send (`clientInfo.name`, QA Q5-02); the server uses the same map
 * (`clientDisplayName` in packages/companion/src/agentHub.ts). Codex CLI and the ChatGPT desktop app share
 * `~/.codex/config.toml` and both say `codex-mcp-client`. Unknown ids pass through unchanged.
 */
const AGENT_PRODUCT_NAMES: Record<string, string> = {
  'codex-mcp-client': 'Codex or the ChatGPT app',
  cli: 'OpenCode',
  opencode: 'OpenCode',
  'claude-code': 'Claude Code',
  chatgpt: 'ChatGPT',
};

export function agentProductName(id: string): string {
  return Object.hasOwn(AGENT_PRODUCT_NAMES, id) ? AGENT_PRODUCT_NAMES[id]! : id;
}

/** Who proposed it, in plain words ("the Coach", "Claude Code through your server", …). */
export function proposerName(actor: PendingProposal['actor']): string {
  const id = typeof actor.id === 'string' && actor.id ? agentProductName(actor.id) : 'an agent';
  switch (actor.kind) {
    case 'ai':
      return 'the Coach';
    case 'webmcp':
      return 'an agent in this browser';
    case 'mcp':
    case 'companion':
      return `${id} through your server`;
    default:
      return id;
  }
}

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const plain = (v: unknown): string | null =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;

/** What the proposal would change, from its input ("kind busy · from 2026-10-02 · note …"), so it is not applied blind. */
export function proposalDetail(input: unknown, max = 200): string {
  if (!input || typeof input !== 'object') return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const one = plain(v);
    if (one !== null) parts.push(`${words(k)} ${one}`);
    else if (v && typeof v === 'object' && !Array.isArray(v))
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        const two = plain(v2);
        if (two !== null) parts.push(`${words(k2)} ${two}`);
      }
  }
  const text = parts.join(' · ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function titleOf(p: PendingProposal): string {
  const fromPreview = (p.preview as { title?: unknown } | null | undefined)?.title;
  return getCommand(p.commandId)?.title ?? (typeof fromPreview === 'string' ? fromPreview : p.commandId);
}

/** The pending proposals, read through `coach.pending` and read again whenever something is committed or staged. */
export function usePendingProposals() {
  const [items, setItems] = useState<PendingProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    dispatch('coach.pending', {})
      .then((r) => {
        if (!alive) return;
        if (r.ok && 'output' in r && Array.isArray(r.output)) {
          setItems(r.output as PendingProposal[]);
          setError(null);
        } else setError(r.ok ? PROPOSALS_COPY.loadFailed : r.error.message || PROPOSALS_COPY.loadFailed);
      })
      .catch(() => alive && setError(PROPOSALS_COPY.loadFailed));
    return () => {
      alive = false;
    };
  }, [tick]);
  useEffect(() => {
    // reads are announced too (no ChangeSet): only writes, undos and newly staged proposals refresh
    const off = on((e) => {
      if (e.type === 'pending' || e.type === 'undone' || (e.type === 'committed' && e.changeSet)) refresh();
    });
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);
  return { items, error, refresh };
}

/**
 * Settings › Agents › the changes waiting: staged agent and Coach changes, each with Apply / Dismiss. Shown only while
 * there is one (or the list could not be read); nothing otherwise.
 */
export function ProposalsList() {
  const { items, error: loadError, refresh } = usePendingProposals();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (pendingId: string, apply: boolean) => {
    setBusy(pendingId);
    setError(null);
    try {
      const r = apply ? await dispatch('coach.applyPending', { pendingId }) : await dispatch('coach.discardPending', { pendingId });
      if (!r.ok) setError(r.error.message || PROPOSALS_COPY.applyFailed);
      else if (apply && 'output' in r) {
        // the proposal's own command can refuse (it then stays waiting): say why
        const out = r.output as { applied?: boolean; error?: { message?: string } } | null;
        if (out && out.applied === false) setError(out.error?.message || PROPOSALS_COPY.applyFailed);
      }
    } catch {
      setError(PROPOSALS_COPY.applyFailed);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const n = items?.length ?? 0;
  const problem = error ?? loadError;
  if (!n && !problem) return null;
  return (
    <SettingsGroup label={n ? PROPOSALS_COPY.heading(n) : undefined}>
      {n ? (
        <ul className="settings-list" aria-label={PROPOSALS_COPY.listLabel}>
          {items!.map((p) => (
            <li key={p.pendingId}>
              <div className="settings-list__text">
                <span className="settings-list__title">{titleOf(p)}</span>
                {proposalDetail(p.input) ? <span className="settings-list__meta text-ink">{proposalDetail(p.input)}</span> : null}
                <span className="settings-list__meta">
                  {proposerName(p.actor)} · {formatSyncTime(p.createdAt)} · {PROPOSALS_COPY.validUntil(formatSyncTime(p.expiresAt))}
                </span>
              </div>
              <div className="settings-keys">
                <Key size="sm" variant="quiet" disabled={busy !== null} onClick={() => void act(p.pendingId, false)}>
                  {PROPOSALS_COPY.dismiss}
                </Key>
                <Key size="sm" variant="action" loading={busy === p.pendingId} disabled={busy !== null && busy !== p.pendingId} onClick={() => void act(p.pendingId, true)}>
                  {PROPOSALS_COPY.apply}
                </Key>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <SettingsItem>
          <InlineWarning severity="danger" alert>
            {problem}
          </InlineWarning>
        </SettingsItem>
      ) : null}
    </SettingsGroup>
  );
}
