import type { ReactNode } from 'react';
import { cx, Key } from '@/components';
import { stopAgents, useAgentActive } from '@/agents/activity';
import '@/commands'; // the registry: registers the commands sent here
import { sendCommand } from '@/features/lib/sendCommand';
import { AGENTS_COPY } from './copy';

/**
 * "An agent is using Vitals" with a Stop key, shown while an agent tool call finished in the last 60 s
 * (SUITE_SPEC §7.3). Stop turns WebMCP off on this device at once, and records WebMCP off
 * through `agents.configure` (Settings › Agents shows it). Renders nothing otherwise.
 * For the top bar (E13 mounts it).
 */
export interface AgentUpdatePresentation {
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
}

export function AgentActivityIndicator({ windowMs = 60_000, className, update }: { windowMs?: number; className?: string; update?: AgentUpdatePresentation }) {
  const active = useAgentActive(windowMs);
  if (!active) return null;
  const stop = () => {
    stopAgents();
    void sendCommand('agents.configure', { webmcp: false });
  };
  return (
    <div role="status" className={cx('lm-agent-indicator flex items-center gap-2 text-sm text-ink', className)} data-update={Boolean(update) || undefined}>
      <div className="lm-agent-indicator__copy">
        {update ? <span className="lm-agent-indicator__update-title">{update.title}</span> : null}
        {update?.body ? <span className="lm-agent-indicator__update-body">{update.body}</span> : null}
        <span className="lm-agent-indicator__status">{AGENTS_COPY.indicator}</span>
      </div>
      <div className="lm-agent-indicator__keys">
        {update?.actions}
        <Key size="sm" aria-label={AGENTS_COPY.stopLabel} onClick={stop}>
          {AGENTS_COPY.stop}
        </Key>
      </div>
    </div>
  );
}
