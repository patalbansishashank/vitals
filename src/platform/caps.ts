import { isWebBluetoothAvailable } from '@/biometrics/ble/webBluetooth';
import { detectPlatform, type Platform } from './detect';
import { detectOs, type OsName } from './os';

export interface PlatformCaps {
  platform: Platform;
  /** Which ring transport the ring service builds; null when this device cannot reach a ring. */
  ble: 'web-bluetooth' | 'capacitor' | 'electron' | null;
  /** The link may outlive the visible window (Android foreground service, desktop tray). */
  keepAlive: boolean;
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
  const ble =
    platform === 'android' ? 'capacitor' : platform === 'electron' ? 'electron' : isWebBluetoothAvailable() ? 'web-bluetooth' : null;
  return {
    platform,
    ble,
    keepAlive: platform === 'android' || platform === 'electron',
    installedApp: platform === 'android' || platform === 'electron',
    mcpHost: platform === 'electron',
    os,
  };
}
