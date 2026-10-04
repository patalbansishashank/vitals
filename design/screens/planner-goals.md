# Screen — Planner · Goals & constraints (`/plan/goals`, running state `/plan/run`)

> Algorithm facts from research dossier 18 (read 2026-09-30): ≤ 6 ordered goals, horizon
> 28–183 days, ε-lexicographic optimisation with 5 % degradation tolerance per rank, desirability
> "% of what is possible", anytime results (plan A provisional at ≈ 30 % of budget, B and C after
> the diversity stage), wall-time targets 10 s desktop / 20 s mobile, conflict/synergy from the
> evaluation archive. Components: `COMPONENTS.md §8`.

## 1. Purpose

Say what you want, in order, and what you won't do. The user ranks up to six goals from the
metric catalogue (some with targets, some directional), sets the horizon and practical
constraints, sees conflicts and feasibility hints before running, then presses **Find plans**.
While the optimiser works (seconds), the screen shows honest progress and the first usable plan
as early as possible.

## 2. Entry points & exits

| In | Out |
|---|---|
| Rail/tab "Plan" · Welcome "Find a plan for my goals" · Evidence mechanism "Use as a goal" · Results lane menu "Make this a goal" | Find plans → running state → `/plan/results` · Your body (if body incomplete) · Settings › Safety (edit screening) |

## 3. Layout — mobile (375 px)

```
┌──────────────────────────────────────────┐
│ ● vitals                       ◐   ⚙     │
├──────────────────────────────────────────┤
│ Plan                                     │ context row (title 24)
├──────────────────────────────────────────┤
│ ┌ Goals ─────────────── 3 of 6 ────────┐ │ Faceplate
│ │ ⠿ 1 ■ Fat mass      lose  [10.0 kg ] │ │ GoalRankList rows 56 (2-line on mobile:
│ │      must ▾    by wk 16          ×   │ │  row 1 = rank, metric, type, target;
│ │  ┊ pulls against #3 — fasting vs …   │ │  row 2 = strength, deadline, remove)
│ │ ⠿ 2 ■ Lean mass     keep  ±0.5 kg    │ │ conflict connector (ink-3 bracket)
│ │      should ▾                    ×   │ │
│ │ ⠿ 3 ■ Autophagy sig. raise ↑         │ │
│ │      nice ▾   [D] exploratory    ×   │ │
│ │ [+ Add a goal]                        │ │
│ └───────────────────────────────────────┘ │
│ ┌ Horizon ─────────────────────────────┐ │
│ │ [1|2|3|●4|6 months]  5 Oct → 1 Feb   │ │
│ └───────────────────────────────────────┘ │
│ ┌ Practical limits ────────────────────┐ │ Constraints
│ │ training days / week  [0 1 2 ●3 4 5…]│ │
│ │ longest session       [ −  75 min + ]│ │
│ │ eating window         ▕══════▏ 6–10 h │ │ ScaleRange
│ │ eating between        (clock span)    │ │ ClockRing display, drag span
│ │ longest fast I'd do   [none|16h|●24h|…]│ │
│ │ won't do  ☐ fasting days ☑ running …  │ │
│ │ protein at least      1.6 g/kg (floor)│ │
│ └───────────────────────────────────────┘ │
│ ┌ Before you run ─────────────────────┐ │ feasibility hints (InlineWarnings)
│ │ ▲ −10 kg fat in 16 weeks is at the   │ │
│ │   edge of a safe rate …              │ │
│ └───────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ 3 goals · 17 weeks        [Find plans ●] │ action bar: signal pill 48 h
├──────────────────────────────────────────┤
│  body    simulate    plan    evidence    │
└──────────────────────────────────────────┘
```

## 4. Layout — desktop (1440 px)

```
┌────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ●  │ Plan                                   4 months · 5 Oct → 1 Feb        (Find plans ●)          │ 56
├────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│    │ ┌ Goals ───────────────────────────── 3 of 6 ┐ ┌ Practical limits ───────────── 400 ┐          │
│    │ │ ⠿ 1 ■ Fat mass     [lose|keep|gain] [10.0 kg]│ │ training days / week  KeyBank 0–7  │          │
│    │ │        must ▾   by wk 16 ▾             ×    │ │ longest session       Stepper       │          │
│    │ │   ┊ pulls against #3 · fasting vs muscle ⓘ   │ │ eating window         ScaleRange    │          │
│    │ │ ⠿ 2 ■ Lean mass    [lose|●keep|gain] ±0.5 kg │ │ eating between   ClockRing 200 px   │          │
│    │ │   ┊ helps #1 · protein and lifting           │ │ longest fast          KeyBank       │          │
│    │ │ ⠿ 3 ■ Autophagy    [●raise|lower]  [D]       │ │ won't do              checklist     │          │
│    │ │ [+ Add a goal]   suggested: ■ Hunger ↓ …     │ │ protein at least      ScaleSlider   │          │
│    │ └──────────────────────────────── ~720 ───────┘ │ explore beyond tested regimes [○]   │          │
│    │ ┌ Horizon ────────────────────────────────────┐ └─────────────────────────────────────┘          │
│    │ └─────────────────────────────────────────────┘ ┌ Before you run ─────────────────────┐          │
│    │                                                  │ feasibility + conflict summary     │          │
│    │                                                  └─────────────────────────────────────┘          │
└────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
 grid: minmax(0, 720px) | 400, gap 16, centred in the 1440 content width
```

- **Add a goal**: desktop Popover (480 × 560) anchored to the key; mobile full Sheet. Same
  content as the MetricPicker, filtered to goal-able metrics, with goal types per metric.
- **Running state** replaces the two columns with the OptimiserProgress Faceplate (centred,
  max 720) and keeps a compact read-only goal list beside it (desktop) / above it (mobile).

## 5. Regions & components

| Region | Components | Notes |
|---|---|---|
| Context bar | ContextBar, Key `signal` pill "Find plans" (48 h) | desktop; mobile uses the action bar |
| Goals | Faceplate, GoalRankList, Chip (metric), KeyBank (goal type), Stepper (target), Select (strength, deadline), GradeBadge | ≤ 6 goals (dossier 18) |
| Suggested goals | Chip row | empty state and under the list |
| Horizon | HorizonPicker (1, 2, 3, 4, 6 months = 28–183 days) | end date caption |
| Practical limits | Constraints: KeyBank, Stepper, ScaleRange, ClockRing (display + span drag), Checkbox list, ScaleSlider, Switch | — |
| Before you run | InlineWarning list, conflict summary | computed from anchors / heuristics before the full run |
| Running | OptimiserProgress, ProgressRule, Key quiet "Stop" | anytime slots A/B/C |

## 6. Content & copy

**Empty state** (Goals Faceplate over a perforated stage):
> **What do you want to change?**
> Pick up to six goals and put them in order. Vitals keeps your first goal close to its best and
> uses what's left to help the next.
> Suggested: `Fat mass ↓` `Lean mass: keep` `Hunger ↓` `VO₂max ↑` `Strength ↑` `LDL ↓`

**Goal types** (by metric kind):
- Masses: `lose · keep · gain` + target Stepper (kg or lb) — "keep" shows a tolerance "±0.5 kg".
- Directional indices/biomarkers: `raise · lower` (no target) or `reach` + target.
- Bands: `stay within` + range (e.g. blood pressure < 130 mmHg).
- Timing option per goal: `by the end` (default) · `by week n` · `on average` (dossier 18 §4.5:
  "fat mass at the end" vs "average autophagy index").
- Strength Select: `must` (hard floor: plans that miss it are shown as "not achievable") · `should`
  (default: ε-lexicographic) · `nice` (tie-breaker only).

**Grade D goals**: addable, with chip "exploratory" and helper "Based on animal and cell studies.
The Planner weights it lightly and won't trade a higher goal for it."

**Conflict/synergy connectors** (between rows; ink-3 bracket for conflict, ok-fg for synergy):
- "pulls against #3 · fasting vs muscle" → popover: "Muscle growth needs frequent protein and
  energy; the autophagy signal needs long gaps without them. Your ranking puts muscle first, so
  plans keep fasts under 20 h."
- "helps #1 · protein and lifting" → popover: "Keeping lean mass lets you keep more expenditure,
  which helps fat loss."
Before a run these come from a static synergy table (confirm with dossier 18 §4.13); after a
run, from the computed κ matrix.

**Practical limits**
- `training days / week` 0–7 (default from Habits) · `longest session` 20–150 min.
- `eating window` ScaleRange 4–16 h ("6–10 h") · `eating between` clock span (default 08:00–21:00).
- `longest fast I'd do` `none · 16 h · 24 h · 36 h · 72 h` (72 h requires safety screening
  cleared; otherwise disabled with "Not available in safety mode").
- `won't do` checklist: "fasting days", "running", "counting grams every day" (plans use ≤ 3 day
  types), "alcohol changes", "supplements (creatine, caffeine)", "training on weekends",
  "eating after 20:00".
- `protein at least` ScaleSlider 1.2–2.4 g/kg; floor at the evidence minimum (1.2 in a deficit —
  confirm dossier 03); cannot go lower.
- Switch `explore beyond tested regimes` (off by default): "Let the Planner combine building
  blocks outside the tested range. Results are flagged and carry lower confidence."

**Before you run** (feasibility hints; each an InlineWarning):
- caution: "**−10 kg fat in 16 weeks is at the edge of a safe rate** (about 0.9 % of body weight a
  week). Expect plan A to reach 8–10 kg." [Extend to 20 weeks]
- info: "**Autophagy and muscle gain pull apart.** Plans will favour muscle (your #2)."
- caution: "**Training 5 days with 'no training on weekends'** leaves no rest day." [Edit limits]

**Find plans** key (signal pill): "Find plans"; disabled reasons as tooltip: "Add at least one
goal", "Finish Your body first".

**Running (OptimiserProgress)**
- Title: "Finding plans…" · subtitle "3 goals · 17 weeks · usually 10–20 seconds on this device".
- Slots: `A` `B` `C` outlined keys in plan colours; a slot fills when its plan exists: A shows
  "provisional" at ≈ 30 %, "ready" after the ranking stage; B and C after the diversity stage.
- Convergence chart (120 px, plan colours, direct end labels "A 0.82").
- Counters (readout style): "plans tried 1 840 · safe 1 212 · 4.1 s".
- Stage line (engraved): "checking what's possible → honouring goal 1 → goal 2 → finding
  different options → testing against uncertainty".
- Key quiet "Stop and keep what's found" (after A exists) / "Cancel" (before).

## 7. Interactions

- **Reorder**: drag the ⠿ handle (pointer: lift after 4 px; touch: long-press 250 ms). Rows
  slide 200 ms; ranks renumber live; connectors re-attach. Keyboard: focus handle → Space → ↑/↓
  → Space; live region: "Fat mass moved to rank 1 of 3".
- **Add**: picker grouped by the 8 categories; tapping a metric adds it at the bottom with its
  default type; a 7th is refused: "Up to six goals. Remove one to add another."
- **Edit target**: Stepper with units; `⇧` ×10; typing allowed; invalid target (e.g. gain 30 kg in
  8 weeks) → the "Before you run" hint updates rather than blocking.
- **Constraints** apply immediately and re-evaluate hints (debounced 300 ms, heuristic only).
- **Find plans** (`⌘Enter`): the screen transitions (200 ms cross-fade) into the running state;
  the optimiser runs in workers; UI stays responsive; navigating away keeps it running (a
  progress dot appears on the Plan tab/rail key) and a Toast announces completion: "Plans ready ·
  Open".
- **Stop**: keeps best-so-far; results page states which stages were skipped.

## 8. States

| State | Behaviour & copy |
|---|---|
| Empty | Suggested goals; limits pre-filled from Habits; Find plans disabled. |
| Body incomplete | Banner (info): "The Planner needs your body first." [Set up your body] — everything else disabled. |
| Goal needs data | Chip on the row "needs waist measurement" → deep link to Your body waist. |
| Contradictory limits | Caution hint + "Edit limits"; run allowed (the optimiser reports binding constraints). |
| Safety mode | Excluded levers are shown disabled with the reason ("Fasts over 24 h aren't available in safety mode: pregnancy"). |
| Running | OptimiserProgress; goals read-only; Stop available once A exists. |
| Slow device | After 20 s: "Taking longer than usual. Plan A is ready now; B and C are still being found." [See plan A] |
| Timed out / failed | If ≥ 1 plan: results with "Stopped early" note. If none: Danger Banner "No safe plan satisfies goal #1 with these limits." + the binding constraints list + suggestions ("allow 24 h fasts", "extend to 20 weeks"). |
| Worker crash | "The Planner stopped unexpectedly. Your goals are saved." [Try again] [Copy details] |
| Stale | After a run, changing goals/limits/body shows "Changed since the last run · Find plans again". |

## 9. Accessibility

- GoalRankList: `role="list"`, rows `role="listitem"`, handle is a button "Reorder Fat mass, rank
  1 of 3"; keyboard drag as above; ranks are text, not only position.
- Connectors are text ("pulls against #3") with an icon; popovers reachable by keyboard.
- Constraints are native controls or ARIA sliders/radios with units in `aria-valuetext`.
- OptimiserProgress: `role="status"` with polite updates at stage changes only (not every tick);
  the convergence chart is decorative (`aria-hidden`), counters are text.
- Reduced motion: no row slide animation; progress rule static with elapsed seconds.

## 10. Decisions & rationale

- **Numbered ranks** are allowed here (the order is information) — unlike decorative section
  numbers elsewhere.
- **Strength (must/should/nice)** exposes the algorithm's hard floor vs ε-tolerance vs tie-break
  in plain words, so "priority" has a precise meaning.
- **Feasibility before running** saves users a wasted run and sets expectations; the full run
  then confirms with numbers.
- **Anytime slots** match dossier 18's pipeline: users see plan A early and can stop.
- **"Explore beyond tested regimes" is off by default** — the model is least trustworthy outside
  the evidence envelope, and the optimiser will exploit model error if allowed.

## 12. v0.3 (batch 02): "Suggest from my answers" (PLAN 02 item 8)

Never automatic: the goals page still starts empty (or with the person's own goals); a suggestion
exists only after the person presses the key. Contract: `goals.suggest` → `goals.suggested` with
provenance (A3, E19). Code: `src/features/planner/GoalsView.tsx`.

### 12.1 The key
- **Suggest from my answers** — Key `default` md (secondary; the yellow Find plans stays the only
  signal key). Desktop: in the Goals faceplate header actions, left of the count. Mobile: under the
  empty-state text, and in the Goals header's ⋯ menu once goals exist.
- Disabled with reason (tooltip and `aria-describedby`): "Finish Your body first" when body basics
  are missing. With nothing else answered it still works and says what is missing (§12.3).

### 12.2 The proposal card
Appears above the Goals faceplate (desktop: spanning the left column; mobile: first in the page),
as a ChangeCard `edit` class (`COMPONENTS §13.11`) rendered as a Faceplate:

```
 ◇ Suggested goals · from your answers          rules · from your answers        [Clear]
 ranked goals ─────────────────────────────────────────────────────────────────────────────
 1 fat mass       lose 6.0 kg by week 15     body fat about 31 % (likely 28–34), above the healthy band
 2 lean mass      keep ±0.5 kg               you train 3 times a week; keeping muscle protects maintenance
 3 sleep          raise regularity           your ring shows bedtimes varying by about 90 min
 constraints ──────────────────────────────────────────────────────────────────────────────
 training days    3 → 3 (from your answers)  · eating between 08:00–21:00 → 09:00–20:00
 fasting          none (you haven't opted in)
 missing ──────────────────────────────────────────────────────────────────────────────────
 waist measurement — would sharpen the body-fat estimate              [Add] → Your body
 blood markers — none entered, so no marker goals                     [Add] → markers chapter
 [Apply] (solid)   [Add only new goals]   Clear (quiet)
```
- Goal rows: rank numeral · metric (Chip `metric`) · goal type and target (from the fastest safe
  reach estimate) · **one line why** (13 ink-2, from the suggester, with numbers and ranges; a
  marker-based goal carries a BecauseChip, `COMPONENTS §14.6`). Max 6 rows, as the goal list.
- Constraint rows: label · current → suggested (diff like ChangeCard items); unchanged rows say
  "(from your answers)". Fasting tiers appear only if already opted in.
- SourceChip: "rules · from your answers" (offline suggester) or "Coach · from your answers" (AI;
  may first ask one or two clarifying questions inline as QuestionCards, `§14.3`, inside the card).
- Actions: **Apply** replaces the goal list and the listed constraints (Undo toast 30 s; if goals
  already exist the key reads "Replace my 2 goals" and the card states it) · **Add only new goals**
  (appends goals not already listed, up to 6) · **Clear** discards the proposal. Nothing runs
  until the person presses Find plans; after Apply every goal is editable as usual and the goals
  carry the engraved tag "suggested" until edited.

### 12.3 States
| State | Behaviour |
|---|---|
| Loading | rules: instant (no spinner unless > 300 ms, then a 12 px spinner in the key, width locked); Coach: ProgressRule in the card + "Reading your answers…" with Cancel |
| Unanswered profile | the card shows no goals: "Not enough answered to suggest goals." + the missing list with [Add] links |
| Partially answered | goals shown + missing list |
| Error | Coach failed → falls back to the rules suggester with the line "The Coach couldn't answer, so this comes from the built-in rules." |
| Stale | answers changed after the suggestion → caution mark "Your answers changed since this was suggested." [Suggest again] |
| Applied / cleared | card collapses to one ink-3 line "Suggestion applied · Undo" / disappears |

Layout at widths: 390 — full width, rows stack (metric + target on line 1, why on line 2); 768 —
single column max 720; 1440 — left column (≤ 720) above Goals. Keyboard: the key is in the tab
order before the goal list; on open, focus moves to the card title; Apply is never pre-focused.
Screen readers: the card is an `article` named "Suggested goals"; rows are a list with full
sentences. Dark/light: tokens only (the hollow-diamond mark is ink).

### 12.4 Acceptance checklist (Q6)
- [ ] On first visit no goals are filled; the key is secondary (not yellow).
- [ ] Pressing the key shows ranked goals each with a one-line reason, targets, constraints and a missing list.
- [ ] Apply, Add only new goals and Clear behave as §12.2; Undo restores the previous goals.
- [ ] An unanswered profile shows the missing list and no invented goals.
- [ ] At 390 px reasons wrap under their goal without overlapping the target.
