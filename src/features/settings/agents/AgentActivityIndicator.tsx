import { cx, Key } from '@/components';
import { stopAgents, useAgentActive } from '@/agents/activity';
import '@/commands'; // the registry: registers the commands sent here
import { sendCommand } from '@/features/lib/sendCommand';
import { AGENTS_COPY } from './copy';

/**
 * "An agent is using Vitals" with a Stop key (its light lit), shown while an agent tool call finished in the last 60 s
 * (SUITE_SPEC §7.3). Stop turns WebMCP off on this device at once, and records WebMCP off
 * through `agents.configure` (Settings › Agents shows it). Renders nothing otherwise.
 * For the top bar (E13 mounts it).
 */
export function AgentActivityIndicator({ windowMs = 60_000, className }: { windowMs?: number; className?: string }) {
  const active = useAgentActive(windowMs);
  if (!active) return null;
  const stop = () => {
    stopAgents();
    void sendCommand('agents.configure', { webmcp: false });
  };
  return (
    <div role="status" className={cx('flex items-center gap-2 text-sm text-ink', className)}>
      <span>{AGENTS_COPY.indicator}</span>
      <Key size="sm" indicator aria-label={AGENTS_COPY.stopLabel} onClick={stop}>
        {AGENTS_COPY.stop}
      </Key>
    </div>
  );
}
