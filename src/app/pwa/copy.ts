import type { InstallPlatform } from './install';

/** User-facing strings for the update banner and its Reload key (Settings › Install has its own, InstallSettings.tsx). */
export const PWA_COPY = {
  updateKey: 'Reload',
  updateTitle: 'Update available',
} as const;

/** What to do by hand when the browser has not offered a one-tap install (yet, or ever). */
export const INSTALL_STEPS: Record<InstallPlatform, string> = {
  chromium: 'Open the browser menu and choose Install Vitals (on a phone: Add to Home screen). If the option is missing, this window cannot install web apps; private windows cannot.',
  'safari-ios': 'Tap the Share button, then Add to Home Screen, then Add.',
  'safari-mac': 'In Safari, choose File › Add to Dock.',
  firefox: "Firefox on a computer cannot install web apps, but Vitals works the same in a normal tab, offline included. On Android, open the menu and tap Install.",
  other: "Look for Install or Add to Home Screen in your browser's menu or address bar.",
};
