# Widget fixtures

Shared test data for the Android home-screen widgets (r071), read by both sides of the snapshot contract:

- `snapshot-numbers.json` is a whole snapshot as the web app publishes it (every card, series and stage runs, weight with the
  opt-in): a fixed point of `sanitizeSnapshot(s, { weight: true })` (`src/features/widgets/__tests__/contract.test.ts`), and what
  the native parser reads (`WidgetSnapshotTest.kt`).
- `snapshot-quiet.json` is the same snapshot with quiet mode on, written by hand from the quiet rules: no energy, no figure, no
  line or bar, words with a digit left out, the night's stages, the ratios and the instants kept, weight as its state only.
  Both sides must produce it from the numbers one: the web sanitiser, and the native parser (a quiet snapshot keeps no
  figure even when it still carries them).

Synthetic data only (the figures are the ones RESEARCH.md uses for its cards, `now` is Wed 28 Oct 2026 13:20 in Asia/Kolkata, and the app's day ends at 04:00 the next morning, `today.until`).
