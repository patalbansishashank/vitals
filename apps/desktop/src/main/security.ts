/**
 * The renderer's boundaries (SUITE_SPEC §15.6): a sandboxed, isolated page that can only ever show `app://vitals`;
 * links to the web open in the system browser; permissions are the few the app uses; no webviews; and every IPC
 * handler checks that the caller is our page. The decisions are pure functions (tested); `applySecurity` hooks them
 * into Electron.
 */
import { APP_ORIGIN } from '../shared/bridge';

export const APP_PREFIX = `${APP_ORIGIN}/`;

/** `webPreferences` for the one window. */
export const WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  backgroundThrottling: false,
  spellcheck: false,
} as const;

/** True for a URL inside our page. */
export function isAppUrl(url: string | undefined | null): boolean {
  return typeof url === 'string' && (url === APP_ORIGIN || url.startsWith(APP_PREFIX));
}

/** True for a URL the system browser may open. */
export function isWebUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** What to do with a navigation or `window.open`: stay (our page), open in the browser, or drop it. */
export function navigationAction(url: string): 'allow' | 'external' | 'deny' {
  if (isAppUrl(url)) return 'allow';
  return isWebUrl(url) ? 'external' : 'deny';
}

/** Permissions the page may have (requests from any other origin are refused regardless). */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'notifications', // reminders
  'clipboard-sanitized-write', // copy a link or the sync words
  'fullscreen',
  'media', // the camera for a pairing QR code (video only, below)
]);

export interface PermissionDetails {
  requestingUrl?: string;
  /** `media` requests: 'video' and/or 'audio'. */
  mediaTypes?: readonly string[];
  isMainFrame?: boolean;
}

/** The permission decision. Bluetooth is not a permission here: Chromium asks main for the device instead. */
export function permissionAllowed(permission: string, details: PermissionDetails = {}): boolean {
  if (details.requestingUrl !== undefined && !isAppUrl(details.requestingUrl)) return false;
  if (details.isMainFrame === false) return false;
  if (!ALLOWED_PERMISSIONS.has(permission)) return false;
  if (permission === 'media') return (details.mediaTypes ?? []).every((t) => t === 'video') && (details.mediaTypes?.length ?? 0) > 0;
  return true;
}

/** The sender of an IPC message is our page (used by every handler). */
export function isAppSender(event: { senderFrame?: { url: string } | null }): boolean {
  return isAppUrl(event.senderFrame?.url);
}

/** The slices of Electron that `applySecurity` wires. */
export interface SecurityElectron {
  app: { on(event: 'web-contents-created', listener: (event: unknown, contents: WebContentsSlice) => void): unknown };
  session: {
    defaultSession: {
      setPermissionRequestHandler(
        handler: (wc: unknown, permission: string, callback: (granted: boolean) => void, details: PermissionDetails) => void,
      ): void;
      setPermissionCheckHandler(handler: (wc: unknown, permission: string, origin: string, details: PermissionDetails) => boolean): void;
      setBluetoothPairingHandler?(
        handler: (details: { pairingKind: string; deviceId: string; pin?: string }, callback: (r: { confirmed: boolean; pin?: string | null }) => void) => void,
      ): void;
    };
  };
  shell: { openExternal(url: string): Promise<void> };
}

export interface WebContentsSlice {
  on(event: 'will-navigate' | 'will-redirect', listener: (event: { preventDefault(): void }, url: string) => void): unknown;
  on(event: 'will-attach-webview', listener: (event: { preventDefault(): void }) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
}

/** Hooks every webContents the app creates. Call once before the window exists. */
export function applySecurity(e: SecurityElectron): void {
  const openExternal = (url: string): void => {
    if (navigationAction(url) === 'external') void e.shell.openExternal(url).catch(() => undefined);
  };
  e.app.on('web-contents-created', (_event, contents) => {
    const onNavigate = (event: { preventDefault(): void }, url: string): void => {
      if (navigationAction(url) === 'allow') return;
      event.preventDefault();
      openExternal(url);
    };
    contents.on('will-navigate', onNavigate);
    contents.on('will-redirect', onNavigate);
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
  });
  const session = e.session.defaultSession;
  session.setPermissionRequestHandler((_wc, permission, callback, details) => callback(permissionAllowed(permission, details)));
  session.setPermissionCheckHandler((_wc, permission, origin, details) => permissionAllowed(permission, { ...details, requestingUrl: details.requestingUrl ?? origin }));
  // Linux and Windows ask main when a device wants to pair. A "confirm" prompt (Just Works) is accepted: the person asked
  // for this device a moment ago. A PIN cannot be shown to them from here, so that pairing is declined.
  session.setBluetoothPairingHandler?.((details, callback) => {
    callback(details.pairingKind === 'confirm' ? { confirmed: true } : { confirmed: false });
  });
}
