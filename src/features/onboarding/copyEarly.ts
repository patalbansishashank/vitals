/**
 * The part of the onboarding copy (./copy.ts, which re-exports all of it) that the safety gate and the safety store
 * need before first paint: the versions of acknowledged copy and the mode labels. Split out only so the app's initial
 * bundle does not carry the whole copy module; review it together with ./copy.ts.
 */
import type { AcknowledgementId, ModeName } from './safetyRules';

/* ============================================================================
   Versions of acknowledged copy
   ============================================================================ */

export const ACK_VERSIONS: Readonly<Record<AcknowledgementId, number>> = {
  /** First-run consent ("Vitals is a simulator" + I understand). */
  disclaimer: 1,
  /** Clinician-first interstitial before the Planner (dossier §4.2 "Warn"). */
  'clinician-first': 1,
};
/** Fasting tier acknowledgements A–D and stop rules. */
export const FASTING_ACK_VERSION = 1;
/** 4–6 h eating-window opt-in (HC-F5). */
export const SHORT_WINDOW_ACK_VERSION = 1;
/** Danger acknowledgement ("I understand this is a simulation, not a recommendation"). */
export const DANGER_ACK_VERSION = 1;

/* ============================================================================
   Mode labels
   ============================================================================ */

export const MODE_LABEL: Readonly<Record<ModeName, string>> = {
  standard: 'Standard mode',
  gentle: 'Gentle mode',
  'clinician-first': 'Clinician-first mode',
  'simulator-only': 'Simulator only',
  'adults-only': 'Adults only',
};
