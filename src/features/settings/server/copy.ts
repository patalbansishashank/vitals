/** Settings › Sync › Server copy (design/screens/server.md §6, reconciled with the server's pairing rules). Plain and short. */
export const SERVER_COPY = {
  title: 'Server',
  notPaired: 'Not paired · this device only',
  enterCode: 'Enter code',
  scan: 'Scan QR',
  /** A row in Sync's "No server yet" group (r068 V10), opening the server guide. */
  setUpServer: 'Set up a server',
  noServerUrl: 'https://github.com/patalbansishashank/vitals/blob/main/docs/SERVER.md',
  addressLabel: 'Server address',
  addressHelp: 'The https:// address your server prints when it starts.',
  addressPlaceholder: 'https://vitals.example.ts.net:8443',
  codeLabel: 'Pairing code',
  codeHelp: '8 digits · valid for 10 minutes',
  codeWhere: 'Where to find a code',
  codeWhereText: 'Run vitals-server devices code on your server, or open Settings › Sync › Add another device on a device that is already paired.',
  codeFirst: 'First 4 digits',
  codeLast: 'Last 4 digits',
  codeIncomplete: 'Enter all 8 digits of the code.',
  nameLabel: 'Device name',
  pair: 'Pair',
  pairThis: 'Pair this device',
  pairing: 'Pairing…',
  cancel: 'Cancel',
  linkAsk: (host: string) => `Connect this device to ${host}?`,
  stepReach: 'Reaching your server…',
  stepCode: 'Checking the code…',
  paired: (name: string) => `Paired with ${name}.`,
  attemptsLeft: (n: number) => (n === 1 ? 'One try left.' : `${n} tries left.`),
  scanTitle: "Scan the server's code",
  scanHelp: "Point the camera at the QR code on your server's screen or on another paired device.",
  scanNotServer: "That isn't a server pairing code. Enter the code instead.",
  pill: { reachable: 'Reachable', checking: 'Checking', unreachable: "Can't reach", busy: 'Busy', revoked: 'Removed', version: 'Update needed', unpaired: 'Not paired' },
  keys: { address: 'Address', person: 'Your data', answers: 'Answers now', lastContact: 'Last contact', version: 'Server version', role: 'Role', sync: 'Sync', device: 'This device' },
  answersYes: (ms: number) => `Yes · ${ms} ms`,
  answersYesPlain: 'Yes',
  answersChecking: 'Checking…',
  answersNo: 'No',
  never: 'Not yet',
  roleHome: 'Home server',
  syncOn: 'On',
  syncOff: 'Off on this device',
  syncStarting: 'Turning on…',
  syncThrough: (state: string, server: string) => `${state} · through ${server}`,
  alreadyOtherKey:
    "This device already syncs with another key, so it was left as it is. To use your server's instead, stop syncing on this device, then forget this server and pair again.",
  joinFailed: (message: string) => `Sync didn't start: ${message}`,
  revokeKeepsKey: "Removing a device stops it using your server. A device that already synced keeps the sync key, like anyone who has the 24 words, and can keep syncing. Locking it out takes a new sync key on every device, which this page can't make yet.",
  syncHint: 'Sync is off on this device. To bring your data across, join below with the 24 words or QR from another device.',
  checkNow: 'Check now',
  addDevice: 'Add another device',
  newCodeTitle: 'Pair a new device',
  newCodeHow: (address: string) => `On the new device: Settings › Sync › Scan QR, or enter the code and the address ${address}`,
  newCodeExpires: (left: string) => `Works once · expires in ${left}`,
  newCodeExpired: 'This code has expired. Make a new one.',
  newCodeCaution: 'Anyone with this code in the next 10 minutes can pair a device with your server.',
  newCodeCopy: 'Copy code',
  newCodeCopyLink: 'Copy link',
  newCodeCopied: 'Copied',
  newCodeMinute: 'One minute left on the pairing code.',
  newCodeAgain: 'Make a new code',
  done: 'Done',
  devicesTitle: 'Devices',
  devicesNone: 'No other devices yet.',
  thisDevice: 'this device',
  kindBrowser: 'Browser',
  kindPhone: 'Phone',
  kindDesktop: 'Desktop app',
  kindGauge: 'Ring app',
  kindAgent: 'Agent',
  pairedOn: (date: string) => `Paired ${date}`,
  seen: (when: string) => `seen ${when}`,
  revoke: 'Revoke',
  revokeName: (label: string) => `Revoke ${label}`,
  revokeTitle: (label: string) => `Remove ${label} from your server?`,
  revokeAgentTitle: (label: string) => `Revoke the agent key ${label}?`,
  revokeBody:
    'That device can no longer reach your server or use the Coach through it. Its own copy of your data stays on it until you clear it there. You can pair it again any time.',
  revokeAgentBody: 'That agent key stops working at once: the agent can no longer read or log through your server. You can make a new key in Settings › Agents.',
  revokeConfirm: 'Remove device',
  revokeAgentConfirm: 'Revoke key',
  removedNow: 'Removed just now',
  holdsTitle: 'What your server holds',
  holds: [
    'Your plan, logs, body data and Coach conversations, in one folder on that computer',
    'The Coach itself, which runs on that computer',
  ],
  holdsRead:
    "It can read all of this: that is how the Coach and agents work while your devices are off. Anyone who can open that computer's files can read it too.",
  forget: 'Forget this server',
  forgetHelp: 'This device stops using the server. Its data stays here.',
  forgetTitle: 'Forget your server on this device?',
  forgetBody:
    'This device stops syncing and stops using the Coach providers and agent address that go through your server. What is already on this device stays here.',
  forgetConfirm: 'Forget server',
  forgetSyncFailed: (message: string) => `Sync didn't stop: ${message} Stop syncing on this device below.`,
  forgotten: 'This device no longer uses your server. Its data is still here.',
  unreachable: "Can't reach your server. Everything still works on this device.",
  lastContactAt: (when: string) => `Last contact ${when}.`,
  tryAgain: 'Try again',
  revoked:
    "This device was removed from your server. The Coach's server providers and the agent address stopped here. Sync keeps running with the key this device holds until you stop it below. Your data on this device is kept.",
  connectAgain: 'Connect again',
  versionOld: (have: string, need: string) => `Your server runs ${have} and this page needs ${need} or later. Update the server, then check again.`,
} as const;

/** "just now", "5 min ago", "2 h ago", "yesterday", "3 Oct". */
export function relativeTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return SERVER_COPY.never;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return SERVER_COPY.never;
  const s = Math.max(0, (now.getTime() - t.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400 && t.getDate() === now.getDate()) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86_400) return 'yesterday';
  return formatDay(iso);
}

/** "3 Oct 2026". */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\bSept\b/, 'Sep');
}

/** "9:41" for a countdown. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
