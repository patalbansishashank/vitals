/*
 * The operating system of this device, read from the user agent (and `userAgentData` where the browser has it).
 * Only the downloads block and the Ring page's wording use it; the platform itself never comes from here.
 */

export type OsName = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'chromeos' | 'other';

interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
}

export function detectOs(nav: NavigatorLike): OsName {
  const ua = nav.userAgent ?? '';
  const hint = (nav.userAgentData?.platform ?? '').toLowerCase();
  if (/\bCrOS\b/.test(ua) || hint === 'chrome os') return 'chromeos';
  if (/\bAndroid\b/i.test(ua) || hint === 'android') return 'android';
  if (/\b(iPhone|iPad|iPod)\b/.test(ua) || hint === 'ios') return 'ios';
  // iPadOS 13+ asks for the desktop site and says "Macintosh"; only a touch screen tells it from a Mac
  if (/\bMacintosh\b/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/\bWindows\b/i.test(ua) || hint === 'windows') return 'windows';
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua) || hint === 'macos') return 'macos';
  if (/\b(Linux|X11)\b/.test(ua) || hint === 'linux') return 'linux';
  return 'other';
}
