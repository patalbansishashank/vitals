import { detectPlatform, type Platform } from './detect';
import { detectOs, type OsName } from './os';

export interface PlatformCaps {
  platform: Platform;
  /** The app itself: no downloads block, no PWA install section. */
  installedApp: boolean;
  /** Only the desktop app hosts the MCP. */
  mcpHost: boolean;
  os: OsName;
}

export function platformCaps(): PlatformCaps {
  const platform = detectPlatform();
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  const os = platform === 'android' ? 'android' : detectOs(nav);
  return {
    platform,
    installedApp: platform === 'android' || platform === 'electron',
    mcpHost: platform === 'electron',
    os,
  };
}
