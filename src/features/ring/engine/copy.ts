/** Words for the ring engine's screens (r070): plain, sentence case, a fact or a verb, no helper text a label already says. */
import type { PermissionKey, Perm, RingConnection } from '@/platform/gaugeEngine';
import { RING_STATE_WORD } from '@/platform/gaugeEngine';

export const ENGINE_COPY = {
  moving: 'Finish moving from the old ring app',
  settingUp: 'Finish setting up the ring',
  stepsLabel: 'Steps',
  steps: {
    uninstall: 'Uninstall old ring app',
    takeOver: 'Take over the ring',
    permissions: 'Allow what the ring needs',
  },
  stepOf: (n: number) => `Step ${n} of 3`,
  waiting: (n: number) =>
    n === 1 ? 'The old ring app still has 1 reading to send.' : `The old ring app still has ${n} readings to send.`,
  waitingKeep: 'Keep the old ring app open and online.',
  sentAll: 'The old ring app has sent everything.',
  unknownQueue: 'The old ring app has not said what it still holds. Open the old ring app once, then come back.',
  uninstall: 'Uninstall old ring app',
  uninstallWaitingReason: (n: number | null) =>
    n === null
      ? 'Waiting for the old ring app to say what it holds'
      : `Waiting for the old ring app to send ${n} ${n === 1 ? 'reading' : 'readings'}`,
  uninstallAnyway: 'Uninstall anyway',
  gaugeGone: 'The old ring app is gone. Vitals can now connect to the ring itself.',
  takeOver: 'Take over the ring',

  permissions: {
    bluetooth: 'Bluetooth',
    healthConnect: 'Health Connect',
    activityRecognition: 'Physical activity',
    notifications: 'Notifications',
    shortVideoAccessibility: 'Short-video limit',
    batteryUnrestricted: 'Battery unrestricted',
  } satisfies Record<PermissionKey, string>,
  optional: 'Optional',
  allow: 'Allow',
  allowRest: 'Allow the rest',
  openSettings: 'Open settings',
  allowed: 'Allowed',
  on: 'On',
  state: {
    granted: 'Allowed',
    denied: 'Not allowed',
    partial: 'Partly allowed',
    unavailable: 'Not available',
  } satisfies Record<Perm, string>,
  off: 'Off',

  device: 'Ring device',
  deviceKey: 'Device',
  ring: 'Ring',
  status: 'Status',
  name: 'Name',
  battery: 'Battery',
  lastSync: 'Last sync',
  never: 'Not yet',
  syncNow: 'Sync now',
  syncing: 'Syncing the ring…',
  synced: 'Synced',
  syncNeedsRing: 'The ring is not connected',
  ringAccessPending: 'Ring data unavailable',
  ringAccessFailed: 'Could not read ring',
  ringAccessMissingBody: 'Vitals cannot read this ring yet. A Vitals update may be needed.',
  ringAccessRejectedBody: 'Vitals could not read this ring. A Vitals update may be needed.',
  ringAccessBlocked: 'Ring data is not available yet',
  authenticating: 'Authenticating ring…',
  authenticatingWait: 'Wait for the ring to finish authenticating',
  scan: 'Scan for rings',
  scanOther: 'Connect another ring',
  forget: 'Forget ring',
  forgetTitle: 'Forget this ring?',
  forgetBody:
    'The ring stays on your finger; Vitals just stops talking to it. Readings already sent stay on your server.',
  cancel: 'Cancel',
  noRing: 'No ring is connected to this phone.',
  ringError: (e: string) => `The ring said: ${e}`,
  measure: 'Measure now',
  measureTitle: 'Measure',
  measureLabel: 'What to measure',
  measuring: 'Measuring on the ring. Keep it still.',
  measureNotStarted: 'The ring did not start the measurement.',
  measureNeedsRing: 'The ring is not connected',
  kinds: { hr: 'HR', spo2: 'SpO2', hrv: 'HRV', temp: 'Temp', stress: 'Stress' } as const,
  upload: 'Upload to your server',
  waitingToSend: 'Waiting to send',
  lastSent: 'Last sent',
  lastError: 'Last error',
  notPaired: 'This phone is not connected to your server yet.',
  connectServer: 'Connect it',
  permissionsTitle: 'Permissions',

  findRing: 'Find your ring',
  connect: 'Connect',
  scanning: 'Looking for rings…',
  scanAgain: 'Scan again',
  noneFound: 'No rings found. Put the ring on its charger to wake it, then scan again.',
  signal: (rssi: number) => (rssi >= -60 ? 'Strong signal' : rssi >= -80 ? 'Fair signal' : 'Weak signal'),

  limit: 'Daily limit',
  limitOff: 'Off',
  limitVideos: (n: number) => `${n} videos a day`,
  limitSheet: 'Short-video limit',
  limitSwitch: 'Limit short videos',
  limitChange: 'Change',
  limitSave: 'Save',
  todayCounts: 'Today',
  instagram: 'Instagram',
  youtube: 'YouTube',
  total: 'Total',
  limitNeedsAccess: 'The limit needs the accessibility permission to count videos.',

  /**
   * (r071) Android holds back an app that came onto the phone as a file until it is allowed in the app's own App info, so
   * the counter's switch in Accessibility stays grey: three steps, plain words, one key (the App info page).
   */
  guide: {
    title: 'Android blocks the counter until you allow it',
    steps: [
      "Open Vitals' app info.",
      "Tap the three dots (⋮) at the top right, then Allow restricted settings. Confirm with your phone's lock.",
      'Come back and turn on Vitals short-video counter in Accessibility settings.',
    ],
    openAppInfo: 'Open app info',
    note: 'No Allow restricted settings under the dots? Open Accessibility settings, tap Vitals short-video counter once, then look again.',
  },
} as const;

export const ringStateWord = (s: RingConnection): string => RING_STATE_WORD[s];

const pad = (n: number) => String(n).padStart(2, '0');

/** "17:16" today, "yesterday 17:16", else "3 days ago"; "Not yet" when none. */
export function whenText(iso: string | null | undefined, now: number): string {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return ENGINE_COPY.never;
  const d = new Date(ms);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const midnight = (t: number) => {
    const x = new Date(t);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  };
  const days = Math.round((midnight(now) - midnight(ms)) / 86_400_000);
  return days <= 0 ? hm : days === 1 ? `yesterday ${hm}` : `${days} days ago`;
}
