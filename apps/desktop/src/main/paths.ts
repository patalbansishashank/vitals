/**
 * Where things are: the command that starts this very app (for AI tools and autostart), the package kind (which
 * decides how updates work) and the bundled resources. Pure functions over an injected environment, so tests pass
 * fakes; `index.ts` calls the `*FromProcess` forms.
 */
import path from 'node:path';
import type { PackageKind } from './updates';

export type { PackageKind };

export interface SelfCommand {
  path: string;
  args: string[];
}

export interface SelfInput {
  /** `process.env.APPIMAGE`: the AppImage file when running from one. */
  appImage?: string;
  /** `app.isPackaged`. */
  packaged: boolean;
  /** `process.execPath`: the app binary when packaged, the electron binary in development. */
  execPath: string;
  /** `app.getAppPath()`: the folder with package.json (the asar when packaged). */
  appPath: string;
}

/** The command an AI tool or a login start runs to launch this app. */
export function selfCommand(i: SelfInput): SelfCommand {
  if (i.appImage) return { path: i.appImage, args: [] };
  if (i.packaged) return { path: i.execPath, args: [] };
  return { path: i.execPath, args: [i.appPath] };
}

export interface KindInput {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  packaged: boolean;
}

/** How this copy was installed. The deb and dmg kinds cannot update in place (updates.ts). */
export function packageKind(i: KindInput): PackageKind {
  if (!i.packaged) return 'dev';
  if (i.env.APPIMAGE) return 'appimage';
  if (i.platform === 'win32') return 'nsis';
  if (i.platform === 'darwin') return 'dmg';
  return 'deb';
}

export interface ResourcePaths {
  /** The web app (the root Vite build, copied in by scripts/build.mjs). */
  webDir: string;
  preload: string;
  /** The stdio MCP bridge run with `--mcp` (dist/mcp.cjs). */
  mcpScript: string;
  /** The window icon (Linux needs one at run time; Windows and macOS take it from the package). */
  appIcon: string;
  /** The tray icon for this platform (macOS: a template image the menu bar tints). */
  trayIcon: string;
}

/** Everything the app loads at run time lives under `<appPath>/dist` (inside the asar when packaged). */
export function resourcePaths(appPath: string, platform: NodeJS.Platform): ResourcePaths {
  const dist = path.join(appPath, 'dist');
  const icons = path.join(dist, 'icons');
  return {
    webDir: path.join(dist, 'web'),
    preload: path.join(dist, 'preload.cjs'),
    mcpScript: path.join(dist, 'mcp.cjs'),
    appIcon: path.join(icons, 'icon.png'),
    trayIcon: platform === 'darwin' ? path.join(icons, 'trayTemplate.png') : path.join(icons, platform === 'win32' ? 'tray-32.png' : 'tray-16.png'),
  };
}

/** The file the window geometry is kept in. */
export function windowStateFile(userData: string): string {
  return path.join(userData, 'window-state.json');
}

/** The file main keeps the AI tools' agent tokens in (encrypted with Electron safeStorage). */
export function secretsFile(userData: string): string {
  return path.join(userData, 'secrets.json');
}

export const DOWNLOAD_URL = 'https://github.com/patalbansishashank/vitals/releases/latest';
