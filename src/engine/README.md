# src/engine

Pure TypeScript simulation + planning engine. **No DOM, no React, no app state.** Everything here must
run unchanged in a Web Worker and in Node (Vitest). ESLint enforces the import boundary.

- `types/`   public data contracts (profile, schedule, results, metric catalogue)
- `model/`   physiology sub-models, one module per subsystem, each traceable to `docs/MODEL_SPEC.md`
- `planner/` goal-ranked regime optimiser that uses `simulate` as its forward model
- `simulate.ts` the forward simulation entry point
