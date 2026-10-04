/**
 * Copy for the Ring page's frame, connection card, pairing flow and the top-bar ring key
 * (design/screens/ring-pages.md §4.2, §5.2, §5.5; the words are final there). Plain words, sentence case, lowercase
 * engraved labels, a thin space between a number and its unit. The sections (Check now, today rows, sharing, ring
 * settings) keep their words in ./copySections.
 *
 * Never in any of these strings: the ring's advertised name, a brand, or a password, passcode, PIN, key or
 * "advanced" field (decision 13); never the transport's words for how the link works.
 */
import { THIN_SPACE } from '@/components/lib/format';

/** "72 %" (thin space). */
export const percent = (n: number): string => `${Math.round(n)}${THIN_SPACE}%`;

export const RING_PAGE_COPY = {
  pageTitle: 'Ring',

  /* ---- relative time (relativeTime.ts) ---------------------------------------------------------- */
  time: {
    justNow: 'just now',
    minutesAgo: (m: number) => `${m} min ago`,
    hoursAgo: (h: number) => `${h} h ago`,
    yesterday: (clock: string) => `yesterday ${clock}`,
  },

  /* ---- connection card (§5.2) -------------------------------------------------------------------- */
  card: {
    /** Two rings with the same driver label differ by the end of their id (as in the scan list). */
    labelWithTail: (label: string, tail: string) => `${label} · ending ${tail}`,
    /** The card's title where rings can't be reached and none is known yet. */
    noRingLabel: 'Your ring',
    rows: { battery: 'battery', lastRead: 'last read', on: 'on' },
    batteryUnknown: 'battery not read yet',
    batteryLow: 'low · charge it soon',
    batteryCharging: 'charging',
    batteryWhenLastRead: 'when last read',
    batteryLabel: (p: number) => `battery ${percent(p)}`,
    lastReadNever: 'not read yet',
    lastReadOn: (when: string, device: string) => `${when} on ${device}`,
    withClock: (when: string, clock: string) => `${when} · ${clock}`,
    state: {
      unsupported: 'can’t connect here',
      bluetooth_off: 'Bluetooth is off',
      permission_needed: 'needs permission',
      idle: 'not connected',
      searching: 'looking for your ring…',
      connecting: 'connecting…',
      connected: 'connected',
      syncing: (progress?: number) => (progress === undefined ? 'reading your ring' : `reading your ring · ${percent(progress * 100)}`),
      elsewhere: (device: string) => `connected to ${device}`,
      error: 'couldn’t connect',
    },
    /** Spoken with the caution mark beside a stale ring's state word. */
    staleMark: 'not read for over a day',
    body: {
      unsupported:
        'This browser can’t reach Bluetooth rings. Use the Vitals app for Android or your computer, or Chrome on a computer. Your ring’s data still shows here once another device reads it.',
      bluetoothOff: 'Turn on Bluetooth to reach your ring.',
      bluetoothOffComputer: 'Turn on Bluetooth in your computer’s settings to reach your ring.',
      permissionAndroid: 'Vitals needs the Nearby devices permission to find your ring. Allow it in Android settings for Vitals.',
      permissionWeb: 'Your browser needs your permission to connect. Choose your ring in the list it shows.',
      searchingLong: 'Keep it close. If it doesn’t appear, put it on its charger for a moment to wake it.',
      elsewhere: (device: string, since: string) => `Your ring talks to one device at a time. It’s connected to ${device} since ${since}.`,
      waitingFor: (device: string) => `waiting for ${device} to let go…`,
      stale: (day: string) => `Not read since ${day}. Days after that will be filled in when it next connects.`,
      errorFallback: 'Your ring may be connected to another app or phone. Close it there, then try again.',
      syncFailed: (reason: string) => `Couldn’t read the latest data: ${reason.replace(/[.\s]+$/, '')}.`,
    },
    progress: { connecting: 'Connecting to your ring', reading: 'Reading your ring' },
    keys: {
      getApp: 'Get the app',
      importFile: 'Import a file',
      turnOnBluetooth: 'Turn on Bluetooth',
      allow: 'Allow',
      openAppSettings: 'Open app settings',
      connect: 'Connect',
      stop: 'Stop',
      syncNow: 'Sync now',
      reading: 'reading…',
      disconnect: 'Disconnect',
      connectHere: 'Connect here instead',
      tryAgain: 'Try again',
      forget: 'Forget…',
      expand: (label: string) => `Show ${label}`,
      collapse: (label: string) => `Hide ${label}`,
    },
  },

  /* ---- pairing flow (§5.5) ----------------------------------------------------------------------- */
  pairing: {
    title: 'Connect your ring',
    intro: (near: string) =>
      `Put the ring on your finger or its charger and keep it near ${near}. If another app is connected to it (for example the ring’s own app), close that app first: a ring talks to one device at a time.`,
    chooserLine: 'Your browser will show a list of nearby devices. Choose your ring there.',
    lookForRings: 'Look for rings',
    cancel: 'Cancel',
    looking: 'looking for rings…',
    stopped: 'Stopped looking.',
    stop: 'Stop',
    lookAgain: 'Look again',
    listLabel: 'Rings nearby',
    notSeeing: 'Not seeing yours? Tap the ring or put it on its charger to wake it.',
    noneFound: (near: string) => `No rings found. Check it’s charged and close to ${near}, close any other app using it, then look again.`,
    candidate: (label: string, tail?: string) => (tail ? `${label} · ending ${tail}` : label),
    signal: { near: 'near', close: 'close', far: 'far' },
    yours: 'yours',
    connecting: (label: string) => `Connecting to ${label}…`,
    osPrompt: 'Your phone may ask to pair with the ring. That’s expected: tap Pair.',
    settingUp: 'Setting up…',
    reading: (progress?: number) => (progress === undefined ? 'Reading what your ring has stored' : `Reading what your ring has stored · ${percent(progress * 100)}`),
    /** "Connected. Read 7 nights and 9 days." when the service can say what it read; else just this. */
    done: 'Connected.',
    toast: 'Your ring is connected',
    failed: 'Couldn’t connect. Keep the ring close and try again.',
    tryAgain: 'Try again',
    chooseAnother: 'Choose another ring',
    progress: { connecting: 'Connecting to your ring', reading: 'Reading your ring' },
  },

  /* ---- the top-bar ring key (§4.2) --------------------------------------------------------------- */
  key: {
    connected: 'Ring: connected',
    reading: 'Ring: reading',
    elsewhere: (device: string) => `Ring: connected to ${device}`,
    off: 'Ring: not connected',
    attention: 'Ring: needs attention',
    none: 'Ring',
  },
} as const;

/** "this phone" while pairing on a phone, else "this computer" (a browser tab sits on a computer). */
export function nearWhat(here: string): string {
  return here === 'this phone' ? 'this phone' : 'this computer';
}
