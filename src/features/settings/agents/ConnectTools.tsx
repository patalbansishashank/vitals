import { Faceplate, FaceplateHeader } from '@/components';

/**
 * "Connect your AI tools": adds the Vitals MCP to the AI tools on this computer, one key per tool (desktop app only;
 * owned by L-DESKTOP). Placeholder until the desktop shell can do it.
 */
export function ConnectTools() {
  return (
    <Faceplate as="section" id="connect-tools" aria-labelledby="settings-connect-tools-title" className="scroll-mt-2">
      <FaceplateHeader title="Connect your AI tools" titleId="settings-connect-tools-title" />
      <p className="m-0 text-sm text-ink-2">Coming soon.</p>
    </Faceplate>
  );
}
