/**
 * Settings copy. Safety, disclaimer and support wording lives in ONE module for clinician/counsel review:
 * src/features/onboarding/copy.ts; Settings › Safety renders it through the onboarding panel.
 */
export const LICENCES: ReadonlyArray<{ name: string; licence: string }> = [
  { name: 'Geist', licence: 'SIL Open Font License 1.1' },
  { name: 'Geist Mono', licence: 'SIL Open Font License 1.1' },
  { name: 'Lucide icons', licence: 'ISC' },
  { name: 'uPlot', licence: 'MIT' },
  { name: 'React, React Router, Zustand', licence: 'MIT' },
  { name: 'Body mesh', licence: 'Derived from MakeHuman (CC0)' },
];

/** The BodyParts3D atlas behind the figure's bones and muscles is CC BY 4.0: this is its credit, kept out of the figure card. */
export const FIGURE_CREDIT = {
  text: '3D anatomy: BodyParts3D, © The Database Center for Life Science, CC BY 4.0.',
  link: 'Model sources and changes',
  /** Static file in public/ (under BASE_URL), not a router path. */
  file: 'figure/NOTICE.html',
} as const;

/** Said once, at the foot of Settings › Sync (where the data can leave this device). */
export const PRIVACY_TEXT =
  'No accounts, no analytics, no cookies. Data is saved on this device. The Coach may send your conversation to the AI provider you choose.';
/** With sync on (design/screens/settings-sync-ai.md §9): the data is no longer on this device only. */
export const PRIVACY_TEXT_SYNCED =
  'No accounts, no analytics, no cookies. Data is saved here and on your own server for paired devices; the server may hold a readable copy. The Coach may send your conversation to the AI provider you choose.';
/** Paired with the server, which runs the Coach (server-coach contract): no AI provider is chosen on this device. */
export const PRIVACY_COACH_ON_SERVER = 'The Coach runs on your server.';

/** The privacy line for the Sync page: where the data is, and where the Coach sends the conversation. */
export function privacyText(synced: boolean, coachOnServer: boolean): string {
  const base = synced ? PRIVACY_TEXT_SYNCED : PRIVACY_TEXT;
  return coachOnServer ? base.replace(/The Coach may send .*$/, PRIVACY_COACH_ON_SERVER) : base;
}

/** Native acquisition history is separate from the planning-data export/reset boundary. */
export const NATIVE_HISTORY_SCOPE = 'Ring and Health Connect history recorded on this phone stays unchanged.';
export const PLANNING_BACKUP_SCOPE = 'Backups include your plans, body profile, logs and preferences. Ring and Health Connect history recorded on this phone is kept separately and is not included.';

/** Human names for the document store's collections (never show internal collection ids). */
export const STORAGE_LABEL: Readonly<Record<string, string>> = {
  profile: 'Body profile',
  intake: 'Your answers',
  safety: 'Safety answers',
  goals: 'Goals',
  markers: 'Blood markers',
  scenarios: 'Simulations',
  plans: 'Plans',
  planVersions: 'Plan history',
  activePlan: 'Current plan',
  dailyLogs: 'Daily logs',
  dayStatus: 'Day records',
  measurements: 'Measurements',
  anchors: 'Plan snapshots',
  activityCandidates: 'Detected activities',
  activityCandidateRefs: 'Activity sources',
  bioChunks: 'Ring readings',
  conversations: 'Coach chats',
  messages: 'Coach messages',
  attachments: 'Attachments',
  catalogueCustom: 'Custom foods and exercises',
  recipes: 'Recipes',
  kitchen: 'Kitchen',
  pantry: 'Pantry',
  mealPlans: 'Meal plans',
  settings: 'Preferences',
  devices: 'Devices',
  pendingChanges: 'Waiting changes',
  providerKeys: 'Provider keys',
  deviceSettings: 'Device preferences',
  uiPrefs: 'Display preferences',
  secrets: 'Device keys',
  changeLog: 'Change history',
  commandLedger: 'Saved actions',
  jobs: 'Background tasks',
  aiUsage: 'Coach usage',
  derived: 'Saved calculations',
  syncState: 'Sync records',
};
