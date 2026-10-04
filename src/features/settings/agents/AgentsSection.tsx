import { useCallback, useMemo, useState } from 'react';
import { useAgentActivity } from '@/agents/activity';
import { Engraved, InlineWarning, Switch } from '@/components';
import { dispatch } from '@/commands';
import { readAgentSettings, type AgentSettings } from '@/commands/ai/settings';
import { useWebMcpEnabled, useWebMcpSupported } from '@/agents/webmcp';
import { SettingsSection } from '../sections';
import { SettingRow, useSavedFlash } from '../SettingRow';
import { AGENTS_COPY } from './copy';
import { ProposalsList } from './ProposalsList';
import { ServerAgentsCard } from './ServerAgentsCard';

/** The device-local agent switch of this browser (WebMCP). */
export function useAgentsSettings() {
  const [webmcp, setWebmcp] = useWebMcpEnabled();
  return { webmcp, setWebmcp };
}

type Configure = (input: { webmcp?: boolean; clients?: Record<string, { directApply: boolean }> }) => Promise<boolean>;

/**
 * Settings › Agents: WebMCP in this browser, agents on other computers through the person's server (address and
 * agent keys, SUITE_SPEC §14.4), which agents may apply plan changes directly, and the proposals waiting. The agent
 * permissions go through `agents.configure` (recorded in `uiPrefs/me.agents`, undoable); the WebMCP switch of this
 * device follows once the command succeeded.
 */
export function AgentsSection() {
  const [saved, flash] = useSavedFlash();
  const [settings, setSettings] = useState<AgentSettings>(() => readAgentSettings());
  const [error, setError] = useState<string | null>(null);
  const configure = useCallback<Configure>(
    async (input) => {
      setError(null);
      const r = await dispatch('agents.configure', input);
      if (!r.ok) {
        setError(r.error.message || AGENTS_COPY.saveFailed);
        return false;
      }
      if ('output' in r && r.output) setSettings(r.output as AgentSettings);
      flash();
      return true;
    },
    [flash],
  );
  return (
    <SettingsSection id="agents" title="Agents" saved={saved}>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="m-0 text-sm leading-[1.5] text-ink">{AGENTS_COPY.intro}</p>
          <p className="m-0 text-xs leading-[1.45] text-ink-2">{AGENTS_COPY.rules}</p>
        </div>
        <WebMcpRow configure={configure} />
        <ServerAgentsCard />
        <DirectApplyList settings={settings} configure={configure} />
        {error ? (
          <InlineWarning severity="danger" alert>
            {error}
          </InlineWarning>
        ) : null}
        <ProposalsList />
      </div>
    </SettingsSection>
  );
}

function WebMcpRow({ configure }: { configure: Configure }) {
  const { webmcp, setWebmcp } = useAgentsSettings();
  const supported = useWebMcpSupported();
  return (
    <SettingRow label={AGENTS_COPY.webmcpLabel} help={supported ? AGENTS_COPY.webmcpHelp : AGENTS_COPY.webmcpUnsupported}>
      {({ labelId, helpId }) => (
        <Switch
          checked={supported && webmcp}
          disabled={!supported}
          labelledBy={labelId}
          describedBy={helpId}
          onChange={(v) => {
            void configure({ webmcp: v }).then((ok) => {
              if (ok) setWebmcp(v);
            });
          }}
        />
      )}
    </SettingRow>
  );
}

/** Per agent (the ones with a setting, and MCP clients seen this session): may it apply plan changes directly. */
function DirectApplyList({ settings, configure }: { settings: AgentSettings; configure: Configure }) {
  const activity = useAgentActivity();
  const { webmcp } = useAgentsSettings();
  const names = useMemo(() => {
    const seen = new Set(Object.keys(settings.clients));
    if (webmcp) seen.add('webmcp');
    for (const a of activity) seen.add(a.surface === 'webmcp' ? 'webmcp' : a.actor);
    return [...seen].sort((a, b) => (a === 'webmcp' ? -1 : b === 'webmcp' ? 1 : a.localeCompare(b)));
  }, [settings, activity, webmcp]);
  if (names.length === 0) return null;
  return (
    <div className="grid gap-3 border-t border-line pt-4">
      <div className="grid gap-1">
        <Engraved as="p" className="m-0">
          {AGENTS_COPY.directHeading}
        </Engraved>
        <p className="m-0 text-xs leading-[1.45] text-ink-2">{AGENTS_COPY.directHelp}</p>
      </div>
      {names.map((name) => (
        <SettingRow key={name} label={AGENTS_COPY.directLabel(name)}>
          {({ labelId }) => (
            <Switch
              checked={settings.clients[name]?.directApply === true}
              labelledBy={labelId}
              onChange={(v) => void configure({ clients: { [name]: { directApply: v } } })}
            />
          )}
        </SettingRow>
      ))}
    </div>
  );
}

