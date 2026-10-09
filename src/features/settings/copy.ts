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

/** The BodyParts3D atlas behind the figure's bones and muscles is CC BY 4.0: this is its credit, kept out of the figure card. */
export const FIGURE_CREDIT = {
  text: '3D anatomy: BodyParts3D, © The Database Center for Life Science, CC BY 4.0.',
  link: 'Model sources and changes',
  /** Static file in public/ (under BASE_URL), not a router path. */
  file: 'figure/NOTICE.html',
} as const;

export const PRIVACY_TEXT = 'No accounts, no analytics, no cookies. Data is saved on this device. Coach may send your conversation to the AI provider you choose.';
/** With sync on (design/screens/settings-sync-ai.md §9): the data is no longer on this device only. */
export const PRIVACY_TEXT_SYNCED =
  'No accounts, no analytics, no cookies. Data is saved here and on your own server for paired devices. Coach may send your conversation to the AI provider you choose.';
export const DATA_LINE = {
  local: 'Stored on this device. Connect your own server to sync with other devices.',
  synced: 'Stored on your devices and your own server. Your server may hold a readable copy of synced data.',
} as const;
