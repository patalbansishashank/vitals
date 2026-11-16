/**
 * Ring: Gauge's screens inside Vitals (step 1). The section itself is the lazy `RingPage` (`/ring…`, mounted by
 * `src/app/routes.tsx`); Today shows its cards one by one (r071: `RingSleepToday`, `RingGlance`, `RingSocialTime`,
 * `RingTodayNote`, `DayScoreCard`).
 */
export {
  RING_NOTE_WORDS,
  RING_TODAY_WORDS,
  RingGlance,
  RingSocialTime,
  RingSleepToday,
  RingTodayNote,
  useRingNightHours,
  useRingTodayState,
  type RingTodayState,
} from './RingToday';
export { DayScoreCard } from './views/DayScoreCard';
export { SocialCard } from './social/SocialCard';
export { energyPath, ringPaths, sleepPath, type RingTab } from './paths';
export { MoveFromGauge } from './engine';
