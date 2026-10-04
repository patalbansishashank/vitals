import { useDesktopMcpHost } from '@/features/settings/agents/desktopMcpHost';
import { useWebMcpRegistration } from './webmcp';

/**
 * Keeps the agent surfaces of this tab running for as long as the app is open: WebMCP registration, only while its
 * device-local setting is on and E4 has called `setAgentDispatcher`, and in the desktop app the page half of its MCP
 * host (a no-op elsewhere). Agents on other computers reach Vitals through the person's server (SUITE_SPEC §14.4), not
 * through this tab. Renders nothing. Mount once in the app shell.
 */
export function AgentSurfaces() {
  useWebMcpRegistration();
  useDesktopMcpHost();
  return null;
}
