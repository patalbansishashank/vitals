/**
 * Ring: Gauge's screens inside Vitals (step 1). The section itself is the lazy `RingPage` (`/ring…`, mounted by
 * `src/app/routes.tsx`); Today shows `RingTodayFaces`, or the cards one by one (r071: `RingSleepToday`, `RingGlance`,
 * `ShortVideoCard`, `RingStepsToday`, `RingTodayNote`, `DayScoreCard`).
 */
export {
  RING_NOTE_WORDS,
  RING_TODAY_WORDS,
  RingGlance,
  RingShortVideos,
  RingSleepToday,
  RingStepsToday,
  RingTodayFaces,
  RingTodayNote,
  useRingNightHours,
  useRingTodayState,
  type RingTodayState,
} from './RingToday';
export { DayScoreCard } from './views/DayScoreCard';
export { ShortVideoCard } from './views/ShortVideoCard';
export { energyPath, ringPaths, sleepPath, type RingTab } from './paths';
export { MoveFromGauge } from './engine';
