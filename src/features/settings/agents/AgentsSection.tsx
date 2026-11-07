import { useCallback, useMemo, useState } from 'react';
import { useAgentActivity } from '@/agents/activity';
import { InlineWarning, Switch } from '@/components';
import { dispatch } from '@/commands';
import { readAgentSettings, type AgentSettings } from '@/commands/ai/settings';
import { useWebMcpEnabled, useWebMcpSupported } from '@/agents/webmcp';
import { platform, platformCaps } from '@/platform';
import { SettingsSection } from '../sections';
import { SettingRow, SettingsGroup, useSavedFlash } from '../SettingRow';
import { AGENTS_COPY } from './copy';
import { ConnectTools } from './ConnectTools';
import { ProposalsList } from './ProposalsList';
import { ServerAgentsCard } from './ServerAgentsCard';

/** The device-local agent switch of this browser (WebMCP). */
export function useAgentsSettings() {
  const [webmcp, setWebmcp] = useWebMcpEnabled();
  return { webmcp, setWebmcp };
}

type Configure = (input: {
  webmcp?: boolean;
  clients?: Record<string, { directApply: boolean }>;
}) => Promise<boolean>;

/**
 * Settings › Agents: the proposals waiting (first, and only when there are some), WebMCP in this browser (only where the
 * browser offers it), agents on other computers through the person's server (address and agent keys, SUITE_SPEC
 * §14.4), the AI tools on this computer (desktop app), and which agents may apply plan changes directly. The agent
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
      <ProposalsList />
      <WebMcpGroup configure={configure} />
      <ServerAgentsCard />
      {platform() === 'electron' ? <ConnectTools /> : null}
      <DirectApplyList settings={settings} configure={configure} />
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
    </SettingsSection>
  );
}

/** Agents built into this browser (WebMCP): the switch only where the browser can share tools; nothing otherwise. */
function WebMcpGroup({ configure }: { configure: Configure }) {
  const { webmcp, setWebmcp } = useAgentsSettings();
  const supported = useWebMcpSupported();
  const app = platformCaps().installedApp;
  const C = AGENTS_COPY;
  if (!supported) return null;
  return (
    <SettingsGroup>
      <SettingRow label={app ? C.webmcpLabelApp : C.webmcpLabel} help={app ? C.webmcpHelpApp : C.webmcpHelp}>
        {({ labelId, helpId }) => (
          <Switch
            checked={webmcp}
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
    </SettingsGroup>
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
    <>
      <SettingsGroup
        label={AGENTS_COPY.directHeading}
        info={{ title: AGENTS_COPY.directHeading, body: AGENTS_COPY.directHelp }}
      >
        {names.map((name) => (
          <SettingRow key={name} label={AGENTS_COPY.directLabel(name, platformCaps().installedApp)}>
            {({ labelId }) => (
              <Switch
                checked={settings.clients[name]?.directApply === true}
                labelledBy={labelId}
                onChange={(v) => void configure({ clients: { [name]: { directApply: v } } })}
              />
            )}
          </SettingRow>
        ))}
      </SettingsGroup>
    </>
  );
}
