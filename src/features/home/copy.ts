/** Words on the "Get the app" block. */
import type { AssetKey } from './release';

export const DOWNLOADS = {
  title: 'Get the app',
  keepWebsite: 'Or keep using the website',
  version: (v: string) => `Version ${v}`,
  onlySystem: (label: string) => `Download for ${label}`,
  otherSystems: 'Other systems',
  chooseSystem: 'Choose your system',
  unavailable: 'The first download is not ready yet. Until then, keep using the website.',
  allReleases: 'All releases',
  iphone: 'On iPhone, use the website and add it to your home screen.',
  /** What the person sees once, for a build that is not signed. */
  unsigned: {
    windows: 'Windows may warn that the app is from an unknown publisher. Choose More info, then Run anyway.',
    macos: 'The Mac app is not checked by Apple yet. Open it once; when the Mac refuses, go to System Settings > Privacy & Security and choose Open Anyway.',
    android: 'Your phone will ask to allow installs from your browser, once. Choose Allow.',
    'linux-appimage': 'To start it, allow the file to run as a program (right click, Properties), then open it.',
    'linux-deb': 'Install it with your software centre, or with sudo apt install ./ and the file name.',
  } satisfies Record<AssetKey, string>,
} as const;
