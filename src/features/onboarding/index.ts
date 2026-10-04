/**
 * Onboarding + safety layer. Import from '@/features/onboarding'.
 *
 * - Pure rules (dossier 17 gate): `evaluateScreening`, types for `plannerLocks`, fasting tiers, flags.
 * - Access for feature pages: `useSafetyAccess(bodyContext)`, `<SafetyGate feature="planner|simulator">`.
 * - Danger scenarios: `<AcknowledgeGate>` / `<AcknowledgeDialog>` + `<SimulationStrip>`.
 * - Disclaimers next to the numbers: `<DisclaimerLine>` (every results surface), `<PlannerDisclaimer>`
 *   (each plan card), `<StopAndGetHelp>` (bottom of the Warnings panel), `<DisclaimerFooter>`.
 * - `<SafetyModeChip>` for the context bar; `<FastingTierControls>` for opt-ins.
 * - All copy: ./copy.ts (one module for clinician/counsel review).
 * Pages (lazy, via routes): WelcomePage (/welcome), SafetyLimitsPage (/safety), SafetyDemoPage (/dev/safety).
 */
export * from './safetyRules';
export { useSafetyAccess } from './useSafetyAccess';
export type { SafetyAccess, SafetyBodyContext } from './useSafetyAccess';
export { SafetyGate } from './SafetyGate';
export type { SafetyGateProps } from './SafetyGate';
export { AcknowledgeDialog, AcknowledgeGate, SimulationStrip } from './AcknowledgeDialog';
export type { AcknowledgeDialogProps, AcknowledgeGateProps, DangerRule } from './AcknowledgeDialog';
export { DisclaimerLine, DisclaimerFooter, DisclaimerFull, PlannerDisclaimer, StopAndGetHelp, LimitsList } from './Disclaimer';
export { SafetySummary, lockLines } from './SafetySummary';
export { SafetyModeChip } from './SafetyModeChip';
export { FastingTierControls } from './FastingTierControls';
export { FastingOptInDialog } from './FastingOptInDialog';
export { HelpCard } from './HelpCard';
export { OnboardingGate } from './OnboardingGate';
export { gateRedirect, gateStatus } from './gate';
export type { GateInput, GateStatus, ReviewReason } from './gate';
export { ACK_VERSIONS, DANGER_ACK_VERSION, FASTING_ACK_VERSION, SHORT_WINDOW_ACK_VERSION } from './copy';
