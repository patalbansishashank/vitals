import type { InstallPlatform } from './install';

/** User-facing strings for the installable-app and offline UI (Settings › Install Vitals, the update notice). */
export const PWA_COPY = {
  sectionTitle: 'Install',
  thisDeviceHeading: 'Install Vitals on this device',
  serverHeading: 'Your server',
  serverWhat: "Vitals can work with a server on a computer you own: it syncs your devices, runs the Coach for every device and receives your ring's data.",
  serverPaired: (state: string, version: string) => `${state}${version ? ` · ${version}` : ''}`,
  serverOld: (have: string, need: string) => `Your server runs ${have}; this page needs ${need}. Update the server.`,
  serverSettings: 'Server settings',
  serverPair: 'Pair a server',
  serverHowTo: 'How to set one up',

  installLabel: 'install',
  installHelp: 'Opens in its own window with its own icon. Your data stays on this device either way.',
  installHelpSynced: 'Opens in its own window with its own icon. Your data stays on your devices either way.',
  installKey: 'Install',
  installStatus: { installed: 'installed', notInstalled: 'not installed' },
  installedJustNow: 'Installed. Open Vitals from your apps or home screen.',
  declined: 'Not installed. You can still install any time from the browser menu.',

  offlineLabel: 'offline',
  offlineHelp: 'Works offline after the first visit.',
  offlineHelpSynced: "Works offline after the first visit. Changes made offline sync when you're back online.",
  offlineStatus: {
    ready: 'ready on this device',
    preparing: 'saving for offline use…',
    unavailable: 'not active here',
    unsupported: 'not supported by this browser',
  },

  updateLabel: 'update',
  updateHelp: 'A new version of Vitals is ready.',
  updateKey: 'Reload',
  updateTitle: 'Update available',
  updateBody: 'Reloading applies the new version. Your data stays on this device.',
} as const;

/** What to do by hand when the browser has not offered a one-tap install (yet, or ever). */
export const INSTALL_STEPS: Record<InstallPlatform, string> = {
  chromium: 'Open the browser menu and choose Install Vitals (on a phone: Add to Home screen). If the option is missing, this window cannot install web apps; private windows cannot.',
  'safari-ios': 'Tap the Share button, then Add to Home Screen, then Add.',
  'safari-mac': 'In Safari, choose File › Add to Dock.',
  firefox: "Firefox on a computer cannot install web apps, but Vitals works the same in a normal tab, offline included. On Android, open the menu and tap Install.",
  other: "Look for Install or Add to Home Screen in your browser's menu or address bar.",
};
