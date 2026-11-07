/**
 * "Agents on your other computers" (SUITE_SPEC §14.4; design settings-sync-ai.md §13.4): the server's MCP address, agent
 * keys made through `POST /v1/agents/tokens` (shown once), one-line recipes per agent, and the list of keys with Revoke.
 * The key itself is never stored in this browser: it lives in React state only until the block is closed.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Copy, RefreshCw, Trash2 } from 'lucide-react';
import {
  Dialog,
  Field,
  Icon,
  IconKey,
  InlineWarning,
  Key,
  KeyLink,
  MonoMeta,
  RadioGroup,
  Select,
  StatusDot,
  TextInput,
  toast,
} from '@/components';
import { platformCaps } from '@/platform';
import type { AgentClient, AgentRecipe, AgentScope, AgentTokenCreated, AgentTokenInfo } from '@/net/server';
import { useServerClient, useServerConnection, useServerNow, useServerPairing } from '../server/hooks';
import { formatDay, relativeTime } from '../server/copy';
import { SettingsGroup, SettingsItem } from '../SettingRow';
import { AGENTS_COPY as C } from './copy';

const wrap = 'settings-wrap';
function agentInfo() {
  return {
    title: 'What an agent can do',
    body:
      'Read lets an agent see your plan, days and logs. Read and log adds meals, measurements and notes, with undo. Read, log and suggest adds plan changes, which arrive as proposals you apply. ' +
      (platformCaps().installedApp ? C.serverIntroApp : C.serverIntro),
  };
}
import '../server/linkStrip.css';
const CLIENTS: AgentClient[] = ['codex', 'opencode', 'claude', 'chatgpt-desktop', 'other'];

/** The remote recipes of §14.4, used when the server sends none. Snippets carry a placeholder, never the key. */
export function fallbackRecipes(url: string, client: AgentClient): AgentRecipe[] {
  const codex: AgentRecipe = {
    client: 'codex',
    title: 'Codex (and the ChatGPT desktop app, which reads the same file)',
    steps: ['Add this to ~/.codex/config.toml:'],
    config: {
      file: '~/.codex/config.toml',
      snippet: `[mcp_servers.vitals]\nurl = "${url}"\nbearer_token_env_var = "VITALS_TOKEN"`,
    },
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
    config: {
      file: '',
      snippet: `claude mcp add --transport http -s user vitals ${url} --header "Authorization: Bearer $VITALS_TOKEN"`,
    },
  };
  const all = [codex, opencode, claude];
  if (client === 'chatgpt-desktop') return [codex];
  const first = all.find((r) => r.client === client);
  return first ? [first, ...all.filter((r) => r !== first)] : all;
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast(C.copied),
    () => undefined,
  );
}

/** Agents on other computers: through the paired server only (pairing lives in Sync); until then, what they are and the way there. */
export function ServerAgentsCard() {
  const pairing = useServerPairing();
  if (!pairing) {
    return (
      <SettingsGroup label={C.serverHeading} info={agentInfo()}>
        <SettingsItem>
          <p className="settings-text">{C.serverNotPaired}</p>
          <div>
            <KeyLink to="/settings/sync" icon={RefreshCw}>
              {C.setUpSync}
            </KeyLink>
          </div>
        </SettingsItem>
      </SettingsGroup>
    );
  }
  return <PairedAgents mcpUrl={`${pairing.baseUrl}/mcp`} />;
}

function PairedAgents({ mcpUrl }: { mcpUrl: string }) {
  const client = useServerClient();
  const now = useServerNow();
  const { connection } = useServerConnection();
  const [tokens, setTokens] = useState<AgentTokenInfo[] | null>(null);
  const [rev, setRev] = useState(0);
  const [form, setForm] = useState(false);
  const [created, setCreated] = useState<(AgentTokenCreated & { label: string; client: AgentClient }) | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AgentTokenInfo | null>(null);
  const makeKey = useRef<HTMLButtonElement>(null);
  const focusAfterClose = useRef(false);
  const unreachable = connection.state === 'unreachable';

  useEffect(() => {
    if (created || !focusAfterClose.current) return;
    makeKey.current?.focus();
    focusAfterClose.current = false;
  }, [created, form]);

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
  const lastChecked = C.unreachable(
    relativeTime('lastContactAt' in connection ? connection.lastContactAt : null, new Date(now)),
  );
  return (
    <>
      <SettingsGroup label={C.serverHeading} info={agentInfo()}>
        <SettingsItem>
          <div className="settings-agent-address">
            <span className="settings-value">{C.addressKey}</span>
            <MonoMeta tone="ink" className={wrap}>
              {address}
            </MonoMeta>
            <IconKey
              icon={Copy}
              label={`${C.copy} ${C.addressKey.toLowerCase()}`}
              onClick={() => copyText(address)}
            />
          </div>
        </SettingsItem>
        <SettingsItem>
          {created ? (
            <ShownOnce
              created={created}
              onClose={() => {
                focusAfterClose.current = true;
                setCreated(null);
              }}
            />
          ) : form ? (
            <MakeKeyForm
              onCancel={() => {
                focusAfterClose.current = true;
                setForm(false);
              }}
              onCreated={(c) => {
                setForm(false);
                setCreated(c);
                setRev((n) => n + 1);
              }}
            />
          ) : (
            <div>
              <Key
                ref={makeKey}
                variant="primary"
                disabledReason={unreachable ? lastChecked : undefined}
                onClick={() => setForm(true)}
              >
                {C.make}
              </Key>
            </div>
          )}
          {error ? (
            <InlineWarning severity="danger" alert>
              {error}
            </InlineWarning>
          ) : null}
        </SettingsItem>
      </SettingsGroup>
      <SettingsGroup label={C.keysHeading}>
        {unreachable ? (
          <SettingsItem>
            <p className="settings-note">{lastChecked}</p>
          </SettingsItem>
        ) : null}
        {tokens && tokens.length === 0 ? (
          <SettingsItem>
            <p className="settings-note">{C.keysNone}</p>
          </SettingsItem>
        ) : null}
        {tokens && tokens.length ? (
          <ul className={`settings-list ${unreachable ? 'opacity-60' : ''}`}>
            {tokens.map((t) => {
              const label = t.label || C.clients[t.client as AgentClient] || t.client;
              return (
                <li key={t.id}>
                  <span className="settings-list__text">
                    <span className="settings-list__title">{label}</span>
                    <span
                      className="settings-freshness"
                      data-fresh={
                        (t.lastUsedAt && now - Date.parse(t.lastUsedAt) < 7 * 86_400_000) || undefined
                      }
                    >
                      {t.lastUsedAt ? (
                        <StatusDot tone="neutral" hideLabel label={C.used(relativeTime(t.lastUsedAt, new Date(now)))} />
                      ) : (
                        <Icon icon={AlertTriangle} size={14} />
                      )}
                      <MonoMeta>
                        {C.made(formatDay(t.createdAt))} ·{' '}
                        {t.lastUsedAt ? C.used(relativeTime(t.lastUsedAt, new Date(now))) : C.neverUsed}
                      </MonoMeta>
                    </span>
                  </span>
                  <IconKey icon={Trash2} label={C.revokeName(label)} onClick={() => setConfirm(t)} />
                </li>
              );
            })}
          </ul>
        ) : null}
        <Dialog
          open={confirm !== null}
          onClose={() => setConfirm(null)}
          role="alertdialog"
          title={
            confirm
              ? C.revokeTitle(confirm.label || C.clients[confirm.client as AgentClient] || confirm.client)
              : ''
          }
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
      </SettingsGroup>
    </>
  );
}

function MakeKeyForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (c: AgentTokenCreated & { label: string; client: AgentClient }) => void;
}) {
  const client = useServerClient();
  const form = useRef<HTMLDivElement>(null);
  const [agent, setAgent] = useState<AgentClient>('codex');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<AgentScope>('log');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => form.current?.querySelector<HTMLElement>('select, [role="combobox"]')?.focus(), []);
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
    <div ref={form} className="grid gap-3">
      <Field label={C.clientLabel}>
        <Select
          value={agent}
          options={CLIENTS.map((c) => ({ value: c, label: C.clients[c] }))}
          onChange={(v) => setAgent(v as AgentClient)}
        />
      </Field>
      <Field label={C.nameLabel} help={C.nameHelp}>
        <TextInput
          autoComplete="off"
          maxLength={60}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      <RadioGroup
        name="agent-scope"
        label={C.scopeLabel}
        value={scope}
        onChange={(v) => setScope(v as AgentScope)}
        options={(['read', 'log', 'edit'] as const).map((s) => ({
          value: s,
          label: C.scopes[s].label,
          help: C.scopes[s].help,
        }))}
      />
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
      <div className="settings-keys">
        <Key variant="solid" loading={busy} onClick={() => void create()}>
          {C.create}
        </Key>
        <Key onClick={onCancel}>{C.cancel}</Key>
      </div>
    </div>
  );
}

/** The key, shown once (COMPONENTS §15.2), with the recipes. Closing hides it for good. */
function ShownOnce({
  created,
  onClose,
}: {
  created: AgentTokenCreated & { label: string; client: AgentClient };
  onClose: () => void;
}) {
  const recipes =
    created.recipes.length > 0 ? created.recipes : fallbackRecipes(created.mcpUrl, created.client);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div role="region" aria-labelledby="agent-key-title" className="grid gap-3">
      <h4 ref={heading} tabIndex={-1} id="agent-key-title" className="settings-list__title m-0">
        {C.shownOnceTitle} · {created.label}
      </h4>
      <InlineWarning severity="caution">{C.shownOnce}</InlineWarning>
      <div className="flex flex-wrap items-center gap-2">
        <code className="settings-code" aria-label={C.keyLabel}>
          {created.token}
        </code>
        <Key
          size="sm"
          icon={Copy}
          aria-label={`${C.copy} ${C.keyLabel.toLowerCase()}`}
          onClick={() => copyText(created.token)}
        >
          {C.copy}
        </Key>
      </div>
      <p className="settings-note">{C.envHint}</p>
      <h5 className="settings-list__title m-0">{C.recipesTitle}</h5>
      <ul className="m-0 grid list-none gap-3 p-0">
        {recipes.map((r) => {
          const line = r.config?.snippet ?? '';
          return (
            <li key={`${r.client}-${r.title}`} className="grid gap-1 text-sm">
              <span className="settings-list__title">{r.title}</span>
              {r.steps.map((s) => (
                <span key={s} className="settings-list__meta">
                  {s}
                </span>
              ))}
              {line ? (
                <div className="flex flex-wrap items-start gap-2">
                  <pre className="settings-code min-w-0 flex-1">{line}</pre>
                  <Key
                    size="sm"
                    variant="quiet"
                    icon={Copy}
                    aria-label={`${C.copy} ${r.title}`}
                    onClick={() => copyText(line)}
                  >
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
