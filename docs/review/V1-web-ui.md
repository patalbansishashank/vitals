# V1h — web UI review (pass 1)

Area: `src/features/**`, `src/app/**`, `src/components/**`. Branch `wp/V1h`, cut from `f672cb0`.

How the review was done: a browser sweep of 23 routes × 390/768/1440 × light/dark on a copy of the Q6 "full" profile
(a running plan), with console and page errors, controls with no accessible name, internal names on screen,
`undefined`/`NaN`/`null` text, horizontal overflow, missing h1 and duplicate ids
(`qa/scripts/V1h/sweep.mjs`); the same sweep with the energy unit set to kJ (`KJ=1`); edge routes and fast tab-bar
navigation (`qa/scripts/V1h/edges.mjs`); keyboard paths on a Today row sheet (`qa/scripts/V1h/keys.mjs`); then reading
the code behind each finding. Every fixed finding has a test that fails before the fix and passes after it.
The browser runs used `vite preview` of this branch on 127.0.0.1:5194, because the seeded profile's IndexedDB belongs to that origin.

## Findings

| ID | Severity | File:line | What is wrong | How confirmed | Fix or reason not fixed |
|---|---|---|---|---|---|
| V1h-01 | high | `src/features/living/today/TodayPage.tsx:290` (`noticesFor`) | On any day other than today (e.g. `/today/2031-05-05`), Today showed "Welcome back … Fill the 1675 missed days in as planned?". Its Yes key runs `log.bulk` for every day up to the viewed date, future days included, so future days would be logged as eaten "as planned" from a read-only screen | Seen in the browser; the data layer computes the lapse gap against the viewed date (`src/living/projection.ts:215`, `src/living/today.ts:116`). Test `today/__tests__/futureDay.test.tsx` | Fixed (c5e75d3): the notice shows only when the state is active/paused/safety pause, which means the date is today. The data-layer cause is listed under "For other areas" |
| V1h-02 | high | `src/features/intake/copy.ts:321-327`, `maintenanceView.ts:111` | In kJ mode the "Biggest unknown" line printed the kJ figure with the word "kcal" ("±310 kcal" where the value is 74 kcal), about 4× too large | kJ sweep on /body and /onboarding/activity; test in `intake/__tests__/maintenance.test.tsx` | Fixed (d3d4ec1): the copy takes the unit word |
| V1h-03 | high | `src/features/living/**` (Today rows and dial summary, Food targets/meal slots/recipe sheet/manual logger, Train rows and session energy, change-card meal and diff lines, `components/Estimate.tsx`) | The daily screens ignored Settings › Units › energy: kcal everywhere in kJ mode, against the product rule (kJ shown where kcal is; SUITE_SPEC §units "kJ display-only") | kJ sweep: 9 screens still showed kcal; test `living/__tests__/energyUnitLiving.test.tsx` | Fixed (1f01df1): `EstimateReadout` converts kcal values, ranges and unit text; string sites go through `energyInText`; the manual logger's energy field takes the person's unit and stores kcal. After the fix the kJ sweep shows no kcal on Today, Food, Train, Coach, Progress or Plan details |
| V1h-04 | medium | `src/components/lib/focus.ts:63` (`useRestoreFocus`) | In a real browser, closing a sheet or dialog with Escape left focus on `<body>`, not on the key that opened it. `showModal()` (a layout effect) moves focus into the dialog before the passive effect captured the "previous" element; the captured element was inside the dialog and gone on close. jsdom has no `showModal`, so the existing test passed | `keys.mjs`: focus `body` after Escape, opener "More for weigh in"; new test in `components/__tests__/overlays.test.tsx` with a browser-like `showModal` | Fixed (bd93957): capture in a layout effect, restore in the passive cleanup (after the focus trap lets go), retrying for up to 40 frames while the closing dialog keeps the page inert. Re-checked in the browser: focus returns to the opener |
| V1h-05 | medium | `src/features/onboarding/Disclaimer.tsx:147`, `SafetySummary.tsx:10` (+ `SafetyModeChip.tsx`, `planner/components/ResultTabs.tsx:295`) | The safety limits list (/safety, consent) and the plan-lock lines stayed in kcal in kJ mode | kJ sweep on /safety; test `onboarding/__tests__/limitsEnergyUnit.test.tsx` | Fixed (638ac8c): `energyInText` with the person's unit; `lockLines(locks, unit)` |
| V1h-06 | low | `src/features/living/today/TodayPage.tsx:105` | A date outside the plan read "day 1 of 112" (a date years before the start) or "day 112 of 112" (years after), because the number was clamped | Browser, `/today/2020-01-01` | Fixed (c5e75d3): outside the plan the line shows only the date |
| V1h-07 | low | `src/features/living/plan/PlanDetailsPage.tsx:246` | `/plan/active/versions/abc` had the title "Version NaN" | Browser; test in `plan/__tests__/planDetails.test.tsx` | Fixed (57f1644): title "Plan version" for an address that is not a positive whole number |
| V1h-08 | low | `src/app/routes.tsx:72` | The lazy intake route had no `HydrateFallback`: on a direct load of `/onboarding/*` the router warned "No HydrateFallback element provided" and rendered nothing until the chunk arrived | Console warning in the sweep; test `app/__tests__/routesFallback.test.ts` | Fixed (cefab90) |
| V1h-09 | medium | 28 sites, e.g. `src/features/settings/sections.tsx:61`, `features/body/components/BasicsFace.tsx:48`, `features/onboarding/FastingTierControls.tsx:50-52` | `void dispatch(...)` throws away the command result. A refused or failed edit gives no feedback, and Settings' `BankRow` flashes "saved" whatever the result | Code reading; not triggered in the sweep (the commands succeed with valid input) | Not fixed: a pattern across 28 sites, not a local fix. Suggest a shared `useDispatchWithFeedback` that toasts `result.error.message` |
| V1h-10 | low | `src/features/living/food/FoodPage.tsx`, `train/TrainPage.tsx` (date param) | `/food/xx` and `/train/zz` show today but keep the bad address; `/today/garbage` redirects to `/today`. The behaviour differs between the three pages | Browser | Not fixed (cosmetic); align with Today's redirect when the pages are next touched |
| V1h-11 | low | `src/features/evidence/ValidationReportPage.tsx` and `src/content/evidence/**` | Validation report and evidence text keep kcal in kJ mode | kJ sweep | Not fixed: scientific source text and engine test tables are in the engine's unit by design (SUITE_SPEC: engine units are kcal); converting quoted study figures would misquote the sources |

Counts: blocker 0 · high 3 · medium 3 · low 5 (11 in total); fixed 8 (all 3 high, 2 of 3 medium, 3 of 5 low).

## Verified fine (pass 2 need not redo)

- No console errors or page errors on any of the 23 routes × 3 widths × 2 themes (only the Chromium `bluetooth` Permissions-Policy warning, the Playwright service-worker block and WebGL "GPU stall" performance notes on Body).
- No horizontal overflow at 390/768/1440 on any route; every page has one visible h1; no duplicate ids.
- No visible control without an accessible name (the one hit is the hidden `aria-hidden` file input behind Settings › Import).
- No internal names (§, R-xx, MODEL_SPEC, SUITE_SPEC, dossier, E/Q package ids, LIV-n) and no `undefined`/`NaN`/`null`/`[object Object]` in visible text, apart from V1h-07.
- Unknown routes: `/nope` shows Not found; unknown mechanism, topic, progress metric, Coach conversation, plan version and simulator id each show a plain "doesn't exist" state or a redirect, with no errors.
- Fast navigation: 15 tab-bar clicks 50 ms apart (Today → Food → Train → Coach → Progress, three times) end on the right page with no errors.
- Sheet keyboard path: the opener's Enter opens the sheet with focus inside; 25 Tabs keep focus in the sheet; Escape closes it; focus returns to the opener (after V1h-04).
- Charts, Planner, Body, Evidence explain drawer and the safety acknowledgement already honoured kJ (`formatEnergy`/`energyInText`).
- `/welcome` once consent is given sends the person to their last route (by design, `WelcomePage.tsx:127`).

## For other areas

| Pointer | What |
|---|---|
| `src/living/projection.ts:215`, `src/living/today.ts:116` (data layer) | `lapseState` and the `welcomeBack` notice use the viewed date as "today", so a future or past view gets a gap up to that date. The UI now hides it off-today (V1h-01), but the view should not offer a `log.bulk` over future days at all |
| `src/features/living/coach/mockAdapter.ts:27,129,147,397` (Coach stand-in, AI layer) | Coach reply text says "kcal" whatever the unit. Change-card diff lines are now converted in the UI, but chat sentences are not |
