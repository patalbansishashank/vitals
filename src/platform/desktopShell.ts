/*
 * The desktop shell bridge (SUITE_SPEC §15.6), owned by L-DESKTOP: the page side of the Electron app's preload
 * (`window.vitalsDesktop`, apps/desktop/src/shared/bridge.ts) that is not the MCP host. Outside the desktop app every
 * call does nothing.
 */

/** The part of the preload's `vitalsDesktop` this file uses. */
interface DesktopGlobal {
  onSyncNow?(cb: () => void): () => void;
}

const none = (): (() => void) => () => undefined;

function desktop(): DesktopGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { vitalsDesktop?: DesktopGlobal }).vitalsDesktop;
}

/** The tray's "Sync now": the sync layer subscribes once at boot (a no-op outside the desktop app). */
export function onDesktopSyncNow(cb: () => void): () => void {
  return desktop()?.onSyncNow?.(cb) ?? none();
}
