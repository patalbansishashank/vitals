# Roadmap / orchestration log

## Phase 1 — Evidence + foundations (done 2026-09-30)
- 19 research dossiers → `research/NN-*.md` (see index in `research/RESEARCH_PROTOCOL.md`)
- Design direction, tokens, screen specs, prototype → `design/`
- App scaffold (Vite + React + TS + Tailwind v4 + Zustand + Comlink workers + Vitest + Netlify config) — done

## Phase 2 — Model specification (done)
- Synthesise dossiers into `docs/MODEL_SPEC.md`: state vector, hourly/daily update equations, parameter table with citations and evidence grades, metric catalogue, safety rules
- Independent adversarial review of the spec against the dossiers (citation spot-checks, unit checks, conflicts between dossiers)
- `docs/ARCHITECTURE.md`: engine module contracts, planner design, worker protocol, data model

## Phase 3 — Parallel build (done)
- Engine modules + validation test-suite (published studies as unit tests)
- Planner/optimiser
- UI: Your body + avatar, Simulator schedule builder, results chart, Planner, Evidence library, settings/data

## Phase 4 — Verification (done for v0.1.0)
- Engine validation report vs published trials, code review, browser testing at mobile + desktop, accessibility, performance on mobile

## Phase 5 — Netlify deploy (done: v0.1.0 live at https://vitals.creative.desi on 2026-10-01)

## v0.2.0 — after launch (opened and started 2026-10-01; folder `plan/01-after-launch/`)
Twenty owner requests, scheduled in `plan/01-after-launch/IMPLEMENTATION.md` (phases R research, A architecture,
D design, E engineering, QA, REL). Target release: v0.2.0 via `pnpm release minor`. Detail per package: `docs/wp/*.md`,
`docs/COMMANDS.md`, `docs/CATALOGUES.md`, `docs/LIVING_PLAN.md`.

**Landed in the tree (2026-10-01)**
- Research R1-R11 and specs `docs/SUITE_SPEC.md` and `docs/PLANNER_V2_SPEC.md`; design for the new screens (D1).
- Plain-language sweep of internal references (item 5, E1), fasting prescription fixes (item 8, E2), PWA install and offline (item 15, E3).
- Activity intake: engine (E7a) and intake screens (E7b) (item 1).
- Command layer and local-first document store (E4, items 9 and 18); 146 commands registered, part still stubs.
- Catalogues: 170 exercises, equipment, supplements, stimulus mapping, equipment-aware composition, evidence labels (E8, items 11, 12, 14).
- Living plan: domain, assimilation and Today/Food/Train/Coach/Progress/Plan screens (E5, E13, items 6, 10, 13).
- AI provider wrapper and tool registry (E9a); Evolu sync, encrypted blob store, Companion relay (E11, item 18).
- Companion `serve`, `proxy`, Sign in with ChatGPT, `mcp`, pairing and keys; tool manifest; WebMCP and Companion client in the app (E12, items 9, 15, 19).
- Biometrics: importers, scores, Web Bluetooth drivers, policy, engine adapter (E10, items 16, 20).
- 3D figure with visceral view (E14, items 2-4), available on the `/dev/figure` route.
- Evidence library (E15, items 5, 14, 17, 20): six new topics (daily activity and maintenance energy, scores from wearable data, tracking and re-planning, training catalogue evidence, supplements, how Vitals weighs evidence), parameter cards with the two evidence labels and band inflation, and the validation page's planner-benchmarks section (schema and fixture; waits for the planner harness's results file) and activity-intake validation section.

**Remaining before v0.2.0**
- E6 planner v2: ladder (Hard/Medium/Easy) and Ideal plan, benchmark harness, evidence-coverage audit, re-plan; code exists, package not signed off (items 7, 17).
- E9b Coach on the AI layer (replace the mock adapter), multimodal logging, change review.
- Executors for the stub commands in sync, bio, catalogue and ai domains (`src/commands/{sync,bio,catalogue,ai}`), Settings devices and stream matrix, mounting the 3D figure on the Body page.
- Planner benchmark harness writes `docs/validation/planner-benchmarks.json` in the E15 schema (`src/content/evidence/validation/plannerBenchmarks.ts`) so the validation page can show it.
- I1 integration of all `wp/*` branches, Q1 and Q2 QA passes, then REL: `pnpm release minor`, push the tag, verify https://vitals.creative.desi, mark `01-after-launch` shipped in `plan/README.md` and open `02-...`.

**Owner-dependent, not blocking:** open-sourcing Vitals (ChatGPT plan-usage sign-in), tab names, Ideal-plan safety assumption, sync tenancy (one person per endpoint), a Bridge app versus importers first (deferred).
