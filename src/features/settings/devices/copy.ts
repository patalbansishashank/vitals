/** Settings › Devices and streams copy (design/screens/settings-sync-ai.md §8). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A `YYYY-MM-DD` day in the person's date style ("5 Oct 2026" or "Oct 5, 2026"); anything else is shown as given. */
export function formatDay(iso: string, style: 'day-month' | 'month-day'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) return iso;
  const day = Number(m[3]);
  return style === 'month-day' ? `${month} ${day}, ${m[1]}` : `${day} ${month} ${m[1]}`;
}

export const DEV = {
  title: 'Devices and streams',
  intro: 'Choose which devices bring data in and what each may be used for: your scores, your plan, and what the Coach can see. Nothing connects until you say so.',
  limits: 'A web page can’t read Apple Health or Health Connect directly or sync in the background. Import files, or add a ring below.',
  limitsApp: 'Vitals can’t read Apple Health or Health Connect directly. Import a file, or add a ring below.',
  none: 'No devices yet. Import a file or add a ring to bring body signals in.',
  loading: 'Reading your devices…',
  chooseInIntake: 'Choose devices and what they share',
  tier: {
    A: 'tier A · checked against medical devices',
    B: 'tier B · partly checked',
    C: 'tier C · not independently checked — heart-rate variability, autonomic load, SpO2 and temperature are shown only as change from your own normal',
  },
  kind: { ring: 'ring', watch: 'watch', band: 'band', phone: 'phone', scale: 'scale', strap: 'strap', manual: 'entered by hand', unknown: 'device' } as Record<string, string>,
  lastData: (d: string | null) => (d ? `last data ${d}` : 'no data yet'),
  records: (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`,
  remove: 'Remove this device…',
  removeTitle: (label: string) => `Remove ${label}?`,
  removeBody: 'Deletes this device’s data from Vitals (and from your synced devices). Your logs and plan stay. Scores rebuild without it.',
  removeWord: 'remove',
  removeKey: 'Remove device',
  cancel: 'Cancel',
  cols: { imported: 'bring in', scores: 'my scores', engine: 'my plan', coach: 'Coach sees' },
  policyTable: 'Stream sharing settings',
  coach: { hidden: 'hidden', daily: 'daily', 'daily+series': 'daily + detail' } as const,
  switchLabel: (col: string, stream: string) => `${col}: ${stream}`,
  vendorTitle: 'vendor scores',
  vendorHelp: 'Your device maker’s own scores (readiness, sleep, stress), shown beside ours as “Oura says …” and labelled as their opinion. Never used by your scores, your plan or adherence. Off unless you turn it on.',
  importTitle: 'import a file',
  importHelp: 'Apple Health export (.zip), Health Connect export, Health Auto Export (JSON), Gadgetbridge, a Vitals biometrics file (JSON or CSV), or events exported by the earlier version of the app.',
  importKey: 'Choose a file…',
  importing: (name: string, pct: number) => `Importing ${name} · ${pct} %`,
  imported: (r: { records: number; samples: number; duplicates: number; days: { from: string; to: string } | null }, style: 'day-month' | 'month-day' = 'day-month') => {
    const short = (iso: string) => formatDay(iso, style).replace(/,? \d{4}$/, '');
    const range = r.days ? `${r.days.from === r.days.to ? short(r.days.from) : `${short(r.days.from)} – ${short(r.days.to)}`}: ` : '';
    const counts = `${r.records} ${r.records === 1 ? 'record' : 'records'}, ${r.samples} ${r.samples === 1 ? 'reading' : 'readings'}.`;
    const dup = r.duplicates === 0 ? 'Nothing was a repeat.' : `${r.duplicates} ${r.duplicates === 1 ? 'was' : 'were'} already here and skipped.`;
    return `${range}${counts} ${dup}`;
  },
  failed: 'That didn’t work.',
  syncing: (pct: number) => `Reading the ring · ${pct} %`,
} as const;

/**
 * The rings block (SUITE_SPEC §15.2, plan 04 item 1): one card per ring from the ring service, and the scan list.
 * Rings are named by their driver label only, never by what they advertise; nothing here asks for a code (decision 13).
 */
export const RING = {
  title: 'rings',
  ringPage: 'Open the Ring page',
  seeData: 'See the data',
  unsupported: 'This browser can’t reach rings. Use the Vitals app for Android or your computer.',
  unsupportedApp: 'This device can’t reach rings: Bluetooth isn’t available to Vitals here.',
  bluetoothOff: 'Bluetooth is off',
  permission: 'Allow Bluetooth for Vitals',
  state: {
    idle: 'Not connected',
    searching: 'Looking for your ring…',
    connecting: 'Connecting…',
    connected: 'Connected',
  },
  reading: (pct: number | null) => (pct === null ? 'Reading your ring…' : `Reading your ring… ${pct} %`),
  elsewhere: (device: string, since: string | null) => `Connected to ${device}${since ? ` since ${since}` : ''}`,
  failed: 'That didn’t work. Try again.',
  battery: (pct: number, charging: boolean) => `Battery ${pct} %${charging ? ' · charging' : ''}`,
  lastRead: (ago: string, by: string | null) => `Last read ${ago}${by ? ` on ${by}` : ''}`,
  neverRead: 'Not read yet',
  liveHr: (bpm: number) => `Heart rate now ${bpm} bpm`,
  connect: 'Connect',
  syncNow: 'Sync now',
  connectHere: 'Connect here instead',
  disconnect: 'Disconnect',
  forget: 'Forget…',
  forgetTitle: (label: string) => `Forget ${label}?`,
  forgetBody: 'Vitals stops connecting to this ring on all your devices. What it already read stays in Vitals.',
  forgetKey: 'Forget ring',
  cancel: 'Cancel',
  add: 'Add a ring',
  looking: 'Looking for rings nearby…',
  osPrompt: (device: 'phone' | 'computer') => `Your ${device} may ask to pair with the ring. That’s expected; choose Pair.`,
  candidates: 'rings nearby',
  signal: (rssi: number | undefined) => (rssi === undefined ? null : rssi >= -65 ? 'close by' : rssi >= -80 ? 'nearby' : 'far away'),
  yours: 'Already yours',
  stop: 'Stop looking',
  noneFound: 'No ring found. Check that it is charged and close by, then look again.',
  lookAgain: 'Look again',
  which: 'Which of your rings is this?',
  match: (label: string, by: string | null, ago: string | null) =>
    `Your ${label}${by ? ` from ${by}` : ''}${ago ? `, last read ${ago}` : ''}`,
  newRing: 'A new ring',
  pairing: 'Connecting…',
  pairingHistory: 'Reading your ring’s history…',
  sharing: {
    label: 'Use my ring data in my plan and Coach',
    help: 'Your ring data is used for your plan and scores, and the Coach and your AI tools can see it. Turn it off here or per signal in Settings › Devices.',
    some: 'Some of it is shared.',
    someLink: 'See each signal',
    notice: 'Your ring data is now used for your plan and scores, and the Coach can see it. You can turn this off below.',
  },
} as const;

/** Plain names of E10's policy streams. */
export const STREAM_NAME: Record<string, string> = {
  hr: 'heart rate',
  hrv: 'heart-rate variability',
  ibi: 'beat-to-beat intervals',
  spo2: 'blood oxygen',
  skin_temp: 'skin temperature',
  body_temp: 'body temperature',
  resp_rate: 'breathing rate',
  steps: 'steps',
  distance: 'distance',
  active_kcal: 'active energy',
  sleep_stage: 'sleep stages',
  sleep_sessions: 'sleep',
  workouts: 'workouts',
  body: 'weight and body fat',
  daily_summary: 'daily summary',
  vendor_scores: 'vendor scores',
  accel: 'movement',
  stress: 'stress',
};

/** Plain names of the ring app's own scores (`vendor:<key>`); any other key is shown with spaces, never as an id. */
const VENDOR_NAME: Record<string, string> = {
  bp_sys_estimate: 'blood pressure estimate (upper)',
  bp_dia_estimate: 'blood pressure estimate (lower)',
  vascular_age: 'vascular age',
};

export const streamName = (s: string): string =>
  STREAM_NAME[s] ?? (s.startsWith('vendor:') ? `vendor: ${VENDOR_NAME[s.slice(7)] ?? s.slice(7).replace(/_/g, ' ')}` : s.replace(/_/g, ' '));
