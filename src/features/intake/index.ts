/**
 * Intake v2 (design/screens/onboarding-intake-v2.md). Page: `IntakePage` at `/onboarding/:section` (lazy, via routes).
 * For other screens: the document reader, the Body pieces and the paths. Import from '@/features/intake'.
 */
export { useIntakeDoc, readIntake, turnsOf } from './doc';
export { IntakeReminderChip, MaintenanceFace, NormalDaySummary, SetupFace, useBodyFlowContext } from './BodyIntake';
export { intakePath, type IntakeFrom } from './paths';
export type {
  ActivitySection,
  ChapterAnswers,
  ChapterId,
  DevicesSection,
  DietProfile,
  DietSection,
  EquipmentProfile,
  FoodProfile,
  IntakeDoc,
  IntakeSectionId,
  KitchenProfile,
  StreamOptIns,
  StreamPolicy,
  SupplementsAnswer,
  TrainingPreferences,
  TrainingSection,
} from './types';
