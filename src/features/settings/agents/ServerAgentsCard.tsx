/**
 * "Agents on your other computers" (SUITE_SPEC §14.4; design settings-sync-ai.md §13.4): the server's MCP address, agent
 * keys made through `POST /v1/agents/tokens` (shown once), one-line recipes per agent, and the list of keys with Revoke.
 * The key itself is never stored in this browser: it lives in React state only until the block is closed.
 */
import { useEffect, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { Dialog, Engraved, Field, InlineWarning, Key, KeyLink, RadioGroup, Select, TextInput, toast } from '@/components';
import type { AgentClient, AgentRecipe, AgentScope, AgentTokenCreated, AgentTokenInfo } from '@/net/server';
import { useServerClient, useServerConnection, useServerPairing } from '../server/hooks';
import { formatDay, relativeTime } from '../server/copy';
import { AGENTS_COPY as C } from './copy';

const wrap = 'break-words [overflow-wrap:anywhere]';
const CLIENTS: AgentClient[] = ['codex', 'opencode', 'claude', 'chatgpt-desktop', 'other'];

/** The remote recipes of §14.4, used when the server sends none. Snippets carry a placeholder, never the key. */
export function fallbackRecipes(url: string, client: AgentClient): AgentRecipe[] {
  const codex: AgentRecipe = {
    client: 'codex',
    title: 'Codex (and the ChatGPT desktop app, which reads the same file)',
    steps: ['Add this to ~/.codex/config.toml:'],
    config: { file: '~/.codex/config.toml', snippet: `[mcp_servers.vitals]\nurl = "${url}"\nbearer_token_env_var = "VITALS_TOKEN"` },
  };
  const opencode: AgentRecipe = {
    client: 'opencode',
    title: 'OpenCode',
    steps: ['Add this to ~/.config/opencode/opencode.json:'],
    config: {
      file: '~/.config/opencode/opencode.json',
      snippet: `"mcp": { "vitals": { "type": "remote", "url": "${url}", "headers": { "Authorization": "Bearer {env:VITALS_TOKEN}" }, "enabled": true } }`,
    },
  };
  const claude: AgentRecipe = {
    client: 'claude',
    title: 'Claude Code',
    steps: ['Run in a terminal (this writes the key into ~/.claude.json):'],
    config: { file: '', snippet: `claude mcp add --transport http -s user vitals ${url} --header "Authorization: Bearer $VITALS_TOKEN"` },
  };
  const all = [codex, opencode, claude];
  if (client === 'chatgpt-desktop') return [codex];
  const first = all.find((r) => r.client === client);
  return first ? [first, ...all.filter((r) => r !== first)] : all;
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast(C.copied), () => undefined);
}

export function ServerAgentsCard() {
  const pairing = useServerPairing();
  return (
    <div className="grid gap-3 border-t border-line pt-4">
      <div className="grid gap-1">
        <Engraved as="p" className="m-0">
          {C.serverHeading}
        </Engraved>
        <p className="m-0 text-xs leading-[1.45] text-ink-2">{pairing ? C.serverIntro : C.serverNotPaired}</p>
      </div>
      {pairing ? (
        <PairedAgents mcpUrl={`${pairing.baseUrl}/mcp`} />
      ) : (
        <div>
          <KeyLink size="sm" to="/settings/server">
            {C.pairServer}
          </KeyLink>
        </div>
      )}
    </div>
  );
}

function PairedAgents({ mcpUrl }: { mcpUrl: string }) {
  const client = useServerClient();
  const { connection } = useServerConnection();
  const [tokens, setTokens] = useState<AgentTokenInfo[] | null>(null);
  const [rev, setRev] = useState(0);
  const [form, setForm] = useState(false);
  const [created, setCreated] = useState<(AgentTokenCreated & { label: string; client: AgentClient }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AgentTokenInfo | null>(null);
  const unreachable = connection.state === 'unreachable';

  useEffect(() => {
    let live = true;
    void client.agentTokens().then(
      (t) => live && setTokens(t),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [client, rev]);

  const revoke = async (t: AgentTokenInfo) => {
    setConfirm(null);
    try {
      await client.revokeAgentToken(t.id);
      setRev((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const address = created?.mcpUrl || mcpUrl;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="lm-eng">{C.addressKey}</span>
        <span className={`tabular-nums text-ink ${wrap}`}>{address}</span>
        <Key size="sm" variant="quiet" icon={Copy} aria-label={`${C.copy} ${C.addressKey}`} onClick={() => copyText(address)}>
          {C.copy}
        </Key>
      </div>
      {created ? (
        <ShownOnce created={created} onClose={() => setCreated(null)} />
      ) : form ? (
        <MakeKeyForm
          onCancel={() => setForm(false)}
          onCreated={(c) => {
            setForm(false);
            setCreated(c);
            setRev((n) => n + 1);
          }}
        />
      ) : (
        <div>
          <Key disabledReason={unreachable ? C.unreachable(relativeTime('lastContactAt' in connection ? connection.lastContactAt : null)) : undefined} onClick={() => setForm(true)}>
            {C.make}
          </Key>
        </div>
      )}
      <div className={`grid gap-2 border-t border-line pt-3 ${unreachable ? 'opacity-60' : ''}`}>
        <Engraved as="p" className="m-0">
          {C.keysHeading}
        </Engraved>
        {unreachable ? <p className="m-0 text-xs text-ink-2">{C.unreachable(relativeTime('lastContactAt' in connection ? connection.lastContactAt : null))}</p> : null}
        {tokens && tokens.length === 0 ? <p className="m-0 text-xs text-ink-2">{C.keysNone}</p> : null}
        <ul className="m-0 grid list-none gap-2 p-0">
          {(tokens ?? []).map((t) => {
            const label = t.label || C.clients[t.client as AgentClient] || t.client;
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                <span className={`min-w-0 ${wrap}`}>
                  <span className="font-[550] text-ink">{label}</span>
                  <span className="text-xs text-ink-2">
                    {' '}
                    · {C.made(formatDay(t.createdAt))} · {t.lastUsedAt ? C.used(relativeTime(t.lastUsedAt)) : C.neverUsed}
                  </span>
                </span>
                <Key size="sm" variant="quiet" icon={Trash2} aria-label={C.revokeName(label)} onClick={() => setConfirm(t)}>
                  {C.revoke}
                </Key>
              </li>
            );
          })}
        </ul>
      </div>
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        role="alertdialog"
        title={confirm ? C.revokeTitle(confirm.label || C.clients[confirm.client as AgentClient] || confirm.client) : ''}
        footer={
          <>
            <Key onClick={() => setConfirm(null)}>{C.cancel}</Key>
            <Key variant="danger" onClick={() => confirm && void revoke(confirm)}>
              {C.revoke}
            </Key>
          </>
        }
      >
        <p className="m-0">{C.revokeBody}</p>
      </Dialog>
    </div>
  );
}

function MakeKeyForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (c: AgentTokenCreated & { label: string; client: AgentClient }) => void }) {
  const client = useServerClient();
  const [agent, setAgent] = useState<AgentClient>('codex');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<AgentScope>('log');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = label.trim() || C.clients[agent];
      const c = await client.createAgentToken({ client: agent, label: name, scope });
      onCreated({ ...c, label: name, client: agent });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3 rounded-md border border-line p-3">
      <Field label={C.clientLabel}>
        <Select value={agent} options={CLIENTS.map((c) => ({ value: c, label: C.clients[c] }))} onChange={(v) => setAgent(v as AgentClient)} />
      </Field>
      <Field label={C.nameLabel} help={C.nameHelp}>
        <TextInput autoComplete="off" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <RadioGroup
        name="agent-scope"
        label={C.scopeLabel}
        value={scope}
        onChange={(v) => setScope(v as AgentScope)}
        options={(['read', 'log', 'edit'] as const).map((s) => ({ value: s, label: s, help: C.scopes[s] }))}
      />
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Key variant="solid" loading={busy} onClick={() => void create()}>
          {C.create}
        </Key>
        <Key onClick={onCancel}>{C.cancel}</Key>
      </div>
    </div>
  );
}

/** The key, shown once (COMPONENTS §15.2), with the recipes. Closing hides it for good. */
function ShownOnce({ created, onClose }: { created: AgentTokenCreated & { label: string; client: AgentClient }; onClose: () => void }) {
  const recipes = created.recipes.length > 0 ? created.recipes : fallbackRecipes(created.mcpUrl, created.client);
  return (
    <div role="region" aria-labelledby="agent-key-title" className="grid gap-3 rounded-md border border-line p-3">
      <h3 id="agent-key-title" className="lm-eng m-0">
        {C.shownOnceTitle} · {created.label}
      </h3>
      <InlineWarning severity="caution">{C.shownOnce}</InlineWarning>
      <div className="flex flex-wrap items-center gap-2">
        <code className={`rounded-sm bg-well px-2 py-1 font-mono text-sm text-ink ${wrap}`} aria-label={C.keyLabel}>
          {created.token}
        </code>
        <Key size="sm" icon={Copy} onClick={() => copyText(created.token)}>
          {C.copy}
        </Key>
      </div>
      <p className="m-0 text-xs leading-[1.45] text-ink-2">{C.envHint}</p>
      <Engraved as="p" className="m-0">
        {C.recipesTitle}
      </Engraved>
      <ul className="m-0 grid list-none gap-3 p-0">
        {recipes.map((r) => {
          const line = r.config?.snippet ?? '';
          return (
            <li key={`${r.client}-${r.title}`} className="grid gap-1 text-sm">
              <span className="font-[550] text-ink">{r.title}</span>
              {r.steps.map((s) => (
                <span key={s} className="text-xs text-ink-2">
                  {s}
                </span>
              ))}
              {line ? (
                <div className="flex flex-wrap items-start gap-2">
                  <pre className={`m-0 min-w-0 flex-1 whitespace-pre-wrap rounded-sm bg-well px-2 py-1 font-mono text-xs text-ink ${wrap}`}>{line}</pre>
                  <Key size="sm" variant="quiet" icon={Copy} aria-label={`${C.copy} ${r.title}`} onClick={() => copyText(line)}>
                    {C.copy}
                  </Key>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div>
        <Key onClick={onClose}>{C.done}</Key>
      </div>
    </div>
  );
}
