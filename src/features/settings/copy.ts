/**
 * Settings copy.
 *
 * Safety, disclaimer and support wording lives in ONE module for clinician/counsel review:
 * src/features/onboarding/copy.ts (final text from research/17-safety-guardrails.md §4.5–§4.7). It is
 * re-exported here so Settings reads the same words as onboarding, results and the Safety & limits page.
 * The safety mode is no longer a constant: it comes from the screening answers (useSafetyAccess).
 */
import { DISCLAIMER, HELP } from '@/features/onboarding/copy';

export { DISCLAIMER, HELP, SETTINGS_SAFETY } from '@/features/onboarding/copy';

export const COPY_IS_INTERIM = false;

/** Short disclaimer shown above the full text in Settings › About (dossier §4.6 short footer). */
export const DISCLAIMER_TEXT = DISCLAIMER.footer;

/** Help-card summary (dossier DS-8); the full card with helplines is <HelpCard>. */
export const SUPPORT_TEXT = `${HELP.title} ${HELP.body}`;

export const LICENCES: ReadonlyArray<{ name: string; licence: string }> = [
  { name: 'Archivo', licence: 'SIL Open Font License 1.1' },
  { name: 'Lucide icons', licence: 'ISC' },
  { name: 'uPlot', licence: 'MIT' },
  { name: 'React, React Router, Zustand', licence: 'MIT' },
  { name: 'Body mesh', licence: 'derived from MakeHuman (CC0)' },
];

export const PRIVACY_TEXT = "No accounts, no analytics, no cookies. Your data stays in this browser's local storage and IndexedDB.";
/** With sync on (design/screens/settings-sync-ai.md §9): the data is no longer on this device only. */
export const PRIVACY_TEXT_SYNCED =
  'No accounts, no analytics, no cookies. Data stays on your devices. With sync, encrypted copies go to your own server. With the Coach, the conversation goes to the AI provider you chose.';
export const DATA_LINE = {
  local: 'Stored on this device only. Nothing is sent to a server.',
  synced: "Stored on your devices and your sync server (scrambled; the server can't read it). Nothing is sent to Vitals.",
} as const;
