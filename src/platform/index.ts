/*
 * Where this copy of Vitals runs and what that device can do; owned by L-WEB (SUITE_SPEC §15.1). Features import
 * this, never Capacitor or Electron directly.
 */

import { detectPlatform } from './detect';

export { detectPlatform, setPlatformForTests } from './detect';
export type { Platform } from './detect';
export { platformCaps } from './caps';
export type { PlatformCaps } from './caps';
export { detectOs } from './os';
export type { OsName } from './os';
export { shell } from './shell';
export type { ShellBridge } from './shell';

/** The same as `detectPlatform()`; the name the first callers use. */
export const platform = detectPlatform;
