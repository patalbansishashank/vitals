# Screen — Plan ladder: Hard · Medium · Easy · Ideal (`/plan/results?rung=…&tab=…`, running state `/plan/run`)

> v0.2 (2026-10-01). Replaces `planner-results.md` (plans A/B/C) — that spec's layout grid, tab
> mechanics, print page and accessibility carry over where this one is silent. Contract:
> `docs/PLANNER_V2_SPEC.md` §1 (ladder, burdens, outcomes), §2 (Ideal, limit costs), §3.6 (fasting
> verdicts), §8.5 (things to buy), §9.2/§9.5 (result and UI); start: `docs/SUITE_SPEC.md §3.2, §6.3`.
> Components: `COMPONENTS.md §13.5–13.7, §13.19`. Chart: `CHART_SPEC.md §7.1` (v0.2 note).
> No "A/B/C" anywhere: not in copy, URLs, chart legends, exports or scenario names.
> All numbers, names and dates in this spec are synthetic examples, not real data.
> **v2 (batch 02, 2026-10-02): §12 below supersedes §4 (card grid), §6.2 effort, §6.4 collapsed
> slots, §7 "compare a row" and §11's "positions never shift". §1–11 are kept as v1 history.**

## 1. Purpose

Show the person a **ladder** of plans their own limits allow — the best result they can get
(**Hard**), the least change that still gets a worthwhile result (**Easy**), and the point between
where extra effort stops paying as much (**Medium**) — next to the **Ideal**: the same goals with
none of their practical limits, as a scientific ceiling that tells them which limit costs most.
Each plan shows what it achieves (with likely ranges), how long it takes, what makes it hard (seven
burdens, measured from today's habits to the person's own limits), what it presses against, what
would need buying, and why a fast was or wasn't used. Then **Start this plan**.

## 2. Entry points & exits

| In | Out |
|---|---|
| Finished planner run · Plan tab (finished run exists) · toast "Plans ready · Open" · Re-plan from scratch (`/plan/goals?from=active` → run) | **Start this plan** → Start sheet → Living mode `/today` · **Replace active plan…** (when one runs) → typed confirmation · Open in Simulator (copy as a scenario named "Hard plan · Deficit 22 % · 4 sessions") · Adjust goals · Ideal → **Adopt some of these limits** → new run · Export (JSON, printable) · Evidence links |

## 3. Layout — mobile (375 px)

```
┌──────────────────────────────────────────┐
│ ● vitals                         ◐   ⋯   │
├──────────────────────────────────────────┤
│ Plans for your goals        Adjust goals │ context row
│ 3 goals · 16 weeks · evidence: A–D ⓘ     │ engraved; evidence profile popover
├──────────────────────────────────────────┤
│ ┌ The ladder ──────────────────────────┐ │ LadderScale 72 h: rung markers on the
│ │ ceiling ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ −9.4       │ │ frontier + Ideal ceiling line; tapping a
│ │       ●E ──●M ────●H                 │ │ marker scrolls the rail to that card
│ │ effort 0 ─────────────────── 100     │ │
│ └──────────────────────────────────────┘ │
│ ┌ H ┐ Hard ─────────────── effort 64 ─┐▕ │ LadderCard rail: Hard · Medium · Easy ‖ Ideal
│ │ Deficit 22 % · 4 sessions · 16:8     │▕ │ 16 px peek of the next card
│ │ ▓▓▓▓▓│▓▓▓▓│▒▒▒                       │▕ │
│ │ goals ─────────────────────────────  │▕ │
│ │ 1 fat mass  −8.1 kg  6.9–9.2 ✓ 15 wk │▕ │
│ │ 2 lean mass −0.4 kg −0.9–0.1 ✓ kept  │▕ │
│ │ effort ────────────────────────────  │▕ │
│ │ deficit       ├──────────█──┤ 22 %   │▕ │ BurdenScale compact (7 rows)
│ │ hunger        ├───────────█─┤ high   │▕ │
│ │ …                                    │▕ │
│ │ day to day · fasting · to buy ·      │▕ │
│ │ limits it presses · safety           │▕ │
│ └──────────────────────────────────────┘▕ │
│        ● ○ ○ ┊ ○    hard medium easy ideal│ position dots; a gap before ideal
│ [overview|days|curves|limits|safety]     │ KeyBank tabs for the selected rung
│ … tab content                             │
├──────────────────────────────────────────┤
│ Hard selected        [Start this plan]   │ action bar: solid key (Ideal selected →
├──────────────────────────────────────────┤ "Adopt some of these limits", default key)
│  body    simulate    plan    evidence    │
└──────────────────────────────────────────┘
```

- The rail starts scrolled to **Medium** (the selected rung on arrival); the first swipe left
  shows Hard, right shows Easy, then a 24 px gap with the engraved label "beyond your limits",
  then Ideal. The rail uses `scroll-padding-inline` equal to the 16 px gutter so a snapped card
  sits flush with the gutter and the next card peeks (REVIEW_FINDINGS #7).
- A KeyBank `cards · table` under the ladder strip switches to the comparison table (§6.9).

## 4. Layout — desktop (1440 px)

```
┌────┬──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ●  │ Plans for your goals  3 goals · 16 weeks · evidence A–D ⓘ   [cards|table]   Adjust goals          │
├────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
│    │ ┌ The ladder ── LadderScale 96 h, full width ─────────────────────────────────────────────────┐ │
│    │ │ How it's built: Hard is the best result your limits allow · Easy the least change that       │ │
│    │ │ still gets at least half of it · Medium where more effort stops paying as much ·             │ │
│    │ │ Ideal drops your practical limits (safety still applies).                                    │ │
│    │ └──────────────────────────────────────────────────────────────────────────────────────────────┘ │
│    │ ┌ H Hard ──────┐ ┌ M Medium ────┐ ┌ E Easy ──────┐ ┊ ┌┄ I Ideal ┄┄┄┄┄┄┐                      │
│    │ │ effort 64     │ │ effort 41     │ │ effort 18     │ ┊ ┆ scientific ceiling ┆                  │
│    │ │ goals …       │ │ goals …       │ │ goals …       │ ┊ ┆ goals …          ┆  rows line up     │
│    │ │ effort …      │ │ effort …      │ │ effort …      │ ┊ ┆ effort … (past   ┆  across all four  │
│    │ │ day to day …  │ │ …             │ │ …             │ ┊ ┆  your limits)    ┆  cards (subgrid)  │
│    │ │ fasting …     │ │               │ │               │ ┊ ┆ what your limits ┆                   │
│    │ │ to buy …      │ │               │ │               │ ┊ ┆ cost (top 3)     ┆                   │
│    │ │ limits …      │ │               │ │               │ ┊ ┆                  ┆                   │
│    │ │ safety …      │ │               │ │               │ ┊ ┆ [Adopt some of   ┆                   │
│    │ │               │ │ [Start this   │ │               │ ┊ ┆  these limits]   ┆                   │
│    │ │               │ │  plan] (sel.) │ │               │ ┊ └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘                   │
│    │ └───────────────┘ └───────────────┘ └───────────────┘ ┊  "beyond your limits" engraved on the rule│
│    │ [overview | days | curves | limits | safety]   ← tabs for the selected rung                       │
│    │ ┌ tab content (full width) ──────────────────────────────────────────────────────────────────┐ │
│    │ └────────────────────────────────────────────────────────────────────────────────────────────┘ │
└────┴──────────────────────────────────────────────────────────────────────────────────────────────────┘
 cards: repeat(3, minmax(300px,1fr)) 1px minmax(300px,1fr), gap 16; the 1 px column is the limits rule
```

- **≥ 1320**: four columns as drawn, cards min 280 (4 × 280 + rule + gaps = 1 185 px fits the
  1 196 px content width at 1320); burden text truncates to values below 1440 (full text in
  Overview).
- **1024–1319**: 2 × 2 grid — Hard, Medium / Easy, Ideal — with the limits rule drawn as a
  horizontal hairline above the Ideal; rows still align within each grid row.
- The only solid key in the view is **Start this plan** on the selected card (desktop) or in the
  mobile action bar; the context bar carries no Start key.
- **768–1023**: 2-up rail with snap.

## 5. Regions & components

| Region | Components | Content |
|---|---|---|
| Context bar | ContextBar, KeyBank `cards · table`, Key quiet "Adjust goals", Key quiet "Find the best possible plan" (desktop, §8) | run summary, evidence profile popover; no Start key here |
| Ladder strip | Faceplate, LadderScale, one-line "How it's built" | `COMPONENTS §13.5` |
| Cards | LadderCard × 1–4, PhaseTimeline, RangeBar, BurdenScale, LimitCostRow, StatusMark | `COMPONENTS §13.6–13.7` |
| Tabs | KeyBank `overview · days · curves · limits · safety` | for the selected rung (Ideal included) |
| Start | StartPlanSheet (`COMPONENTS §13.19`), Dialog (replace) | `SUITE_SPEC §3.2` |
| Adopt limits | ResponsivePanel with Checkbox list per binding limit group + Key `signal` "Find plans with these limits" | Ideal only |
| Running | OptimiserProgress (4 slots), provisional LadderCards | §8 |

## 6. Content & copy

### 6.1 Header
- Title "Plans for your goals"; engraved line: "3 goals · 16 weeks · searched 12 400 plans" (tier
  S/M/L/X shown as "quick · standard · thorough · exhaustive" in the popover, never the letter).
- **Evidence profile** (replaces v0.1 "model confidence"; grades never rank or weight plans):
  GradeBadge of the lowest certainty + text "evidence A–D ⓘ"; popover: per goal outcome
  "fat mass · grade A", "autophagy signal · grade D — wide ranges, read the shape", and "counted by
  mechanism: mudgar swings (as loaded rotational work), dand (as push-ups)".

### 6.2 Card anatomy and copy (one card per rung; rows align across cards)

**Title block**: rung key (H/M/E in rung colour, inverse letter; Ideal hollow "I") · title
**Hard / Medium / Easy / Ideal** · effort readout "effort 64" (`D × 100`, tabular) · subtitle, the
measurable name from the engine: "Deficit 22 % · 4 sessions · 16:8 window", "Deficit 12 % · 3
sessions · 24-h fast weekly", "Maintenance · 3 sessions". Ideal adds the engraved line "scientific
ceiling — your practical limits removed, safety kept". Never a diet-brand name; never "the best
plan" or "recommended".

**goals** (rank order, never re-sorted; same rows in every card):
| Kind | Row |
|---|---|
| target, reached | "1 fat mass · −8.1 kg · likely 6.9–9.2 · ✓ reached in 15 weeks · 82 % chance" |
| target, not in horizon | "1 fat mass · −5.6 kg · likely 4.6–6.7 · ○ about 23 weeks at this plan's effort" |
| keep | "2 lean mass · −0.4 kg · likely −0.9–0.1 · ✓ kept" |
| directional | "3 autophagy signal · ↑ 62 % of what's possible · grade D" |
| beyond two years | "1 fat mass · ○ more than two years at this plan's effort" |
Each value carries a RangeBar (P10–P90 from the separate check runs). Time to target per rung:
"reached in about 15 weeks" (own run) or "about 23 weeks at this plan's effort" (route beyond the
horizon). Hard's sentence equals the goal screen's pre-run hint when Hard runs at the fastest safe
rate. Below each goal row except on Hard: a quiet difference "vs Hard −2.5 kg".

**effort** — BurdenScale, seven rows in fixed order, each from today's habit (left) to your limit
(right tick): **deficit** "18 % below maintenance, your limit 25 %" · **hunger** "peaks 74 of 100
in week 9" · **training time** "4 h a week, 2 h more than now" · **fasting load** "one 24-h fast a
week" / "none" · **eating window** "8 h, 3 h shorter than now" · **daily decisions** "2 kinds of
day, 1 new supplement" · **change from now** "moderate". Header: "effort 64 / 100 · hardest part:
hunger". Inactive rows: "no room to change here — your limit is where you are now." Footnote
(Overview only): "Effort averages all seven parts. When several limits are tight, effort stays low
even for the hardest plan you can do."

**day to day** — "hunger: high on fast days · 4 h training a week · window 8 h (12:00–20:00) ·
3 meals". The Overview tab expands it.

**fasting** — one line from the fasting verdict:
- used: "a 24-h fast on Mondays" / "time-restricted eating, 16:8" (a window ≤ 8 h is **never**
  called a fast);
- not used, with a rival: "no fast · a weekly 24-h fast was considered ›" — the › opens a popover
  with the full sentence (§6.5);
- not offered: "no fast · fasting wasn't considered: muscle gain ranks above your autophagy goal".

**to make it work** — "nothing to buy" / ShoppingItem rows: "resistance bands · ₹ · adds 0.3 kg
muscle" (price tier as ₹ to ₹₹₹₹ or $ to $$$$; required items first, marked "needed"). With no
purchase allowance, rungs never require purchases; the row then reads "uses only what you have".

**limits it presses** — "3 training days (on 71 % of days) · eating window 8 h · protein floor"
from `bindingLimits`; "none" when nothing binds. This row is what tells the person which of
*their* choices shape the plan.

**safety** — "✓ within safety limits" (ok mark) / "▲ 1 caution ›" (caution mark → Safety tab).

**actions** — selected startable card: **Start this plan** (solid; the only solid key in the view; below 768 px it moves to the action bar and the card shows none)
and Open in Simulator (quiet). Unselected cards: the card itself selects. Ideal: **Adopt some of
these limits** (default key) — never Start.

### 6.3 The Ideal card, extra content

**what your limits cost** (LimitCostRow × top 3, sorted by goal priority):
> allowing **5 training days** instead of 3 · **+0.6 kg** fat loss by week 16 · effort +9
> allowing a **10-hour** eating window instead of 8 · +0.2 kg fat loss · effort +4
> buying **a pull-up bar** · +0.4 kg muscle
> together, through interactions: +0.3 kg

- If nothing binds: "**Your limits cost nothing measurable for these goals.** Hard already
  matches the ceiling."
- **What it changes** (relaxed list): "training days 3 → up to 6 · sessions up to 90 min · eating
  window from wake + 30 min to 3 h before bed · steps up to 12 000 · sleep 8 h at a regular time ·
  longest fast up to your opt-in (24 h)".
- **Also advised, not counted in the numbers** (visually separated by a hairline and ink-2 text):
  "sleep midpoint around 03:00 if your work allows · no caffeine within 6 h of bed · cool, dark
  bedroom". Credited levers move numbers; advised ones never do, and the card says so.
- **What it keeps**: "Your food rules, allergies, safety answers and opt-ins still apply."

### 6.4 Collapsed and missing rungs (`ladder.collapsed[]`)
The column stays (order never shifts); it shows a 1-line slot:
- "medium · not distinct · Easy already reaches 95 % of Hard's fat loss; a harder plan buys little."
- "easy · same as Hard · Your goal is small enough that the easiest plan already reaches it."
- "medium, easy · your limits leave one plan · Loosen a limit to see alternatives — the Ideal
  shows which one matters most."
Copy comes from the engine (`text`); the UI adds only the engraved rung name.

### 6.5 Fasting explanations ("considered and rejected because…")
Popover from the card's fasting line and a section in the Overview tab. Sentences come from the
engine; the UI shows the numbers as readouts beside them:
| Reason | Sentence (engine template; numbers from data) |
|---|---|
| goal loss | "A plan with a 72-hour fast was considered. It raised the autophagy signal by 0.08 but cost 0.6 kg of fat loss, which you ranked higher." |
| safety margin | "A plan with weekly 24-hour fasts was considered, but on training weeks it would take energy availability below the safe floor (28 kcal per kg lean mass on day 23)." |
| no gain | "A plan with 24-hour fasts gave the same fat loss within 0.1 kg, with higher hunger peaks (+12 points) and 1.3 kg more lean-tissue loss, so this plan was kept." |
| difficulty | "A plan with a 48-hour fast reaches 0.4 kg more fat loss but is harder than Easy allows — see Hard." (links to the Hard card) |
| chance | "A plan with a 48-hour fast was considered, but in too many of the check runs it crossed a safety margin, so it wasn't used." |
| validator | "A plan with a 72-hour fast was considered, but the final safety check rejected it: {detail}." |
| not checked | "A fasting plan wasn't checked in a quick search. On a computer, "Find the best possible plan" compares one." |
| not offered | "Fasting wasn't considered: {reason}." e.g. "muscle gain ranks above your autophagy goal" / "none of your goals gains from fasting" |
Under the sentence: a 3-row mini table "with the fast vs this plan": goal deltas, hunger peak
delta, lean-tissue delta — each a signed number with unit.

### 6.6 Tabs (for the selected rung)
- **overview**: PhaseTimeline 44 h with week scale; phase table (phase · weeks · energy · macro
  split · window · training · steps · notes); the seven burdens in full text; time-to-target
  sentences; fasting explanation; "what stays the same"; decision stability when available
  ("Hard stays ahead of this plan in 88 % of model variations"); for target goals P(target met)
  rounded to 10 % on quick searches; and the **figure and visceral view, start → end** for the
  selected rung (`body-figure-v2.md §6.5`; front view, 3D or SVG, no Play). The Ideal's Overview
  has no figure — the ceiling is shown in numbers only. Cards carry no figure silhouettes in v0.2.
- **days**: as v0.1 (week selector, 7-row table, day types with ClockRings, print) plus **this
  week's sessions** — concrete exercises on the person's equipment ("mudgar two-hand swing 6 × 20,
  60 s rest, ≈ 95 kcal").
- **curves**: comparison small multiples per ranked goal (CHART_SPEC §7.1 v0.2): Hard / Medium /
  Easy lines in rung colours with half-alpha bands, the Ideal as a dashed ink line, the target line;
  direct end labels "Hard −8.1", "Medium −6.9", "Easy −4.2", "Ideal −9.4".
- **limits** (new): for a rung — each binding limit with its share of days and what relaxing it
  would buy (from the Ideal's limit costs); for the Ideal — the full limit-cost list, the relaxed
  list and the advised list.
- **safety**: cautions, what the planner excluded for safety, and the standing line "These plans
  stay within Vitals' safety limits. They are projections, not medical advice."

### 6.7 Start this plan
**Start sheet** (`COMPONENTS §13.19`), title "Start Hard":
> Name: [ Hard plan · October        ] (default "{rung} plan · {start month}"; editable, e.g. "Spring cut")
> Start date: [today] [● tomorrow] [next Monday] [pick a date]
> *Starting on Thursday skips the first 3 days of week 1; your goal date moves by 3 days.*
> Weekly check-in: [Mon … ● Thu …] · Weigh-in time: 07:00 · Training days: Mon Wed Fri Sat
> If I miss a session: [● do it the next day] [skip it] [do a shorter one]
> Before day 1: buy resistance bands (needed) · groceries for the first 3 days (list ›)
> [Start plan] (solid)

- Plan already running: the footer key is **Replace active plan…** → Dialog "Replace Spring cut?
  It ends today and is kept in your history; you can restore it for 7 days. Type **replace** to
  confirm." [Cancel] [Replace plan] (danger).
- Success: mode switches to Living, `/today`; toast "Hard plan · October starts tomorrow · Undo" (24 h, while
  nothing is logged).

### 6.8 Adopt some of these limits (Ideal)
Panel title "Which limits could you change?" Rows = binding limit groups with their cost:
> ☐ training days: 3 → **5** · +0.6 kg fat loss · effort +9
> ☐ eating window: 8 h → **10 h** · +0.2 kg · effort +4
> ☐ equipment: buy **a pull-up bar** (₹) · +0.4 kg muscle
Each row can take an intermediate value (Stepper/KeyBank bounded by the Ideal's value). Footer:
yellow **Find plans with these limits** (signal pill — this is a planner run) → the goals screen's
limits update (visible, undoable) and a warm re-run produces a new ladder.

### 6.9 Comparison table (`cards · table`)
The contract's comparison view: rows × rungs in this order — **effort** (0–100 + the seven burden
values) · one row per goal (value, likely range, verdict) · time to target · hunger · weekly
training time · eating window · fasting · things to buy · limits it presses · safety — and, in the
Ideal column only, **what your limits cost**. Sticky first column and header; 13 px condensed
tabular numbers; the selected rung's column has a 2 px ink edge. On mobile the table scrolls
horizontally inside its faceplate (an explicit rail) with the row labels sticky. Cards lead with
goals because the decision is about results; the table keeps the contract's effort-first order.

## 7. Interactions

- **Select**: click/tap a card or a LadderScale marker; ←/→ between cards when focused; the
  selected card gets a 2 px ink edge, pressed rung key and yellow dot; tabs re-render (200 ms fade).
- **Default selection**: Medium if present, else Hard. Nothing is labelled "recommended".
- **Compare a row**: hovering any row highlights the same row in all four cards (ink-faint wash).
- **Why links**: every "why" sentence has an (i) to the mechanism in Evidence.
- **Start / Replace / Open in Simulator / Export** as §6.7; Open in Simulator copies the rung as a
  scenario ("Hard plan · Deficit 22 % · 4 sessions"); Toast with Undo.
- **Print**: the selected rung's printable page plus a one-page ladder summary table.

## 8. States

| State | Behaviour & copy |
|---|---|
| Running (`/plan/run`) | OptimiserProgress with 4 slots; provisional rung cards appear in place as found (values in ink-2, "provisional", no Start); a slot that collapses shows its reason; the Ideal fills last; "Stop and keep what's found" |
| Complete | as drawn |
| Stopped early | Info Notice "Stopped at 58 %. Hard and Easy are ready; range checks were skipped, so ranges may be too narrow." Limit costs may be partial: "Some limit costs weren't checked." |
| No safe plan (`noSafePlan`) | no rung cards; a Faceplate in their place: "**No safe plan reaches −10 kg fat in 16 weeks within your limits.**" + engine reasons + the Ideal card if it exists: "Without your practical limits it's reachable — here's what blocks it:" (limit costs) + [Extend to 23 weeks] [Adopt some of these limits] |
| Blocked (`blocked`) | "The Planner can't make plans for this profile." + the safety-mode explanation (no internal codes) + "The Simulator still works." |
| Invalid | "These goals can't be planned as they are." + the goal that needs fixing → Adjust goals |
| Only Hard | one card + collapsed slots + Ideal |
| Ideal off or none | three columns, no limits rule; "limits" tab shows binding limits only |
| Stale | dim 60 % + Notice "Your goals changed since these plans were found · Find plans again" (or "Your body changed on 12 Oct") |
| Outside current safety mode | caution mark on the card; Start disabled with reason "This plan uses fasts over 24 hours, which your current safety settings don't allow." |
| Exhaustive search | desktop only; started only by **Find the best possible plan** ("Searches for 15–60 minutes using all your processor cores. You can keep using Vitals.") → runs in the background with a progress chip in the context bar ("exhaustive search · 40 % · about 9 min left") and its convergence chart in the run view; results update in place; when two rounds bring no improvement the chip offers **Continue** or **Stop here**; a paused search resumes on the next visit ("Resume the exhaustive search · 40 % done"); a checkpoint from older goals is discarded with "An earlier long search was for different goals, so it was set aside." |
| Gentle mode | no deficit or weight-loss rows; weight-type numbers behind "show numbers"; deficit and fasting burdens inactive; figure silhouettes off |

## 9. Accessibility

- Cards are `article`s (not radios, so the keys and links inside stay reachable); each card's
  title row is a toggle button "Select Medium plan" with `aria-pressed`, named with the rung and
  goal 1 ("Medium plan: fat mass minus 6.9 kilograms, effort 41 of 100"). The LadderScale markers
  are the same toggles. The Ideal is announced as "Ideal, a reference without your practical
  limits; it can't be started".
- Rung identity never by colour alone: letters H/M/E/I, titles, and the Ideal's dashed edge.
- BurdenScale rows are a description list with full text ("training time: 4 hours a week, 2 more
  than now; your limit 6").
- LadderScale and curves have text summaries and table views.
- Mobile rail: hidden prev/next buttons for screen readers; position dots labelled "Plan 2 of 4".
- Start sheet and replace dialog follow COMPONENTS Dialog/Sheet focus rules; the typed word is
  explained with `aria-describedby`.

## 10. What the engine supplies

| Need | Source |
|---|---|
| Ladder, rungs, collapses, Ideal | `PlannerResultV2 { status, complete, stoppedAt, rungs: Partial<Record<'hard'\|'medium'\|'easy', RungPlan>>, ladder{collapsed[{rung, reason, text}], checks}, ideal: IdealPlanV2 \| null, feasibility, relations, noSafePlanReasons, message, fasting{offered, reason, servedGoal, tierMaxH}, convergence, provenance }` |
| Card content | `RungSummary { kind, title, subtitle, difficulty: {D, Dmax, components[7]}, outcomes: GoalOutcome[], weeklyTrainingMin, meanWindowH, hunger, fasting: FastingVerdict, bindingLimits[], equipment{required, optional}, safetyItems }` |
| Ideal extras | `IdealExtras { relaxed[], advised[], limitCosts: LimitCost[], gapVsHard[], interactionRemainder[] }` |
| Progress | `PlannerProgressV2 { stage, fraction, provisional{hard?, medium?, easy?, ideal?}, changed, convergence }` |
| Start | `plan.start { source: {rung}, startDate, intentions }` (anchoring note from `anchorNotes`); `plan.replace` (destructive, typed confirmation) |
| Adopt limits | `planner.find { tier, overrides }` with the chosen limit groups |
| Never rendered | `structureId`, `euSpent`, `maintainerRef`, internal rule ids, tier letters |
| Copy | every sentence in §6.4–6.5 comes from the engine; numbers are never hard-coded in UI strings |

## 11. Decisions & rationale

- **Fixed order Hard · Medium · Easy ‖ Ideal.** Results fall left to right inside your limits; the
  Ideal stands apart behind a rule labelled "beyond your limits", drawn achromatic and dashed so it
  reads as a reference, not a fourth choice. Positions never shift when a rung collapses.
- **Effort is seven measured burdens, not a word.** Each bar runs from today's habit to the
  person's own limit, so "hard" means "close to the limits you set" — explainable, and it never
  collides with the rung names.
- **Medium is selected first, not recommended.** It is the knee of the trade-off, which is a fact
  about the plans; the person decides.
- **The Ideal can't be started; it can be adopted from.** Its job is to price each limit in goal
  units and turn that into a concrete re-run.
- **Every fasting outcome is explained.** "No fast" is often the evidence-backed answer for fat
  loss; saying why — with the numbers of the rejected rival — turns a suspicious gap into a reason.

## 12. v2 (batch 02, 2026-10-02) — same-scale effort, no duplicate Ideal, no gaps

PLAN 02 item 10 (and 11 for hover). Evidence from the owner: `plan/02-next/ref/ladder-collapsed-rungs.webp`
(Medium and Easy shrank to one-line slots that kept full-height columns, leaving a gap; Ideal
identical to Hard) and `ref/ladder-effort-scales-hover.png` (same values drawn shorter on the Ideal
because `ladder.css` divides its fills by 1.5 and moves the tick to 66.7 %). Engine side (rung
carry-forward, dedicated Easy search, `ideal.sameAsHard`, convergence data) is A3/E21.

### 12.1 Effort bars on one scale

```
 every card (Hard, Medium, Easy, Ideal)          the Ideal, only when a value passes a limit
 effort                     now ├──┤ your limit   effort                now ├──┤ your limit ▨ past it
 deficit        ├██████████████│  21 % below …   deficit       ├██████████████│▨▨▨▨▨       28 % below …
 hunger         ├█▌            │  about 10 / 100  hunger        ├█▌            │            about 10 / 100
 training time  ├██████▌       │  4 h a week …    training time ├██████████████│▨▨▨▨▨▨▨▨▨▨ 7 h a week …
 …                                                …
 effort 35 is the average of these seven parts.   effort 52 is the average of these seven parts.
 └ track T: habit → your limit, same px width on every card ┘└ overflow zone 0.5 T, Ideal only ┘
```
- **Track width T** is one value for every card in the view: `--lp-burden-track: 112px` compact
  (cards), `160px` full (Overview). Fill = `value × T`; the limit tick is a 1 px ink line at the
  track's right end on **every** card. The `/ 1.5` squeeze and the 66.7 % tick are removed.
- **Overflow**: only on the Ideal and only when that row's `over > 0`: a hatched segment
  (`repeating-linear-gradient(45deg, var(--lm-ink) 0 1px, transparent 1px 4px)`, 1 px ink outline)
  starts at the tick and is `over × T` long, capped at 0.5 T; beyond the cap the segment ends in a
  4 px chevron and the text carries the number. The Ideal reserves the 0.5 T column **only if at
  least one row overflows**; otherwise its rows are laid out exactly like Hard's.
- **Legend on cards** (compact, under the "effort" section label, right-aligned, 11/500 ink-3):
  "now ├──┤ your limit", plus "▨ past your limit" on the Ideal when it overflows. The full-size
  legend under the scale stays in the Overview tab and the table view.
- **Footer line on each card** under the seven rows (12/400 ink-2): "effort {N} is the average of
  these seven parts." In the Overview the v1 footnote follows it ("When several limits are tight,
  effort stays low even for the hardest plan you can do.").
- Inactive burdens keep v1's dashed hairline and text.
- The Ideal section label stays "effort (past your limits)" only when something overflows; else
  plain "effort".

### 12.2 When the Ideal equals Hard

When the engine flags `ideal.sameAsHard` (no limit binds; same plan), **no Ideal card is drawn**.
On the Hard card, directly under the subtitle, one line (13/400 ink, with a 12 px info mark):
> None of your limits is binding; the Ideal is this same plan. **10 limits lifted without effect ›**

The › opens a Popover listing the lifted limits ("training days 3 → up to 6", …). The ladder strip's
ceiling line is labelled "ceiling = Hard −6.0 kg". The caption under the strip adds: "The Ideal is
not meant to be harder, only free of your practical limits." The "beyond your limits" rule column
disappears with the card. The table view drops the Ideal column and shows the same line above the
table.

### 12.3 Collapsed rungs become chips; the grid holds only real cards

```
 ┌ The ladder ───────────────────────────────────────────────────────────────────────────────┐
 │ (graph, §12.4)                                                                             │
 │ How it's built: … The Ideal is not meant to be harder, only free of your practical limits. │
 │ [M medium · would repeat Hard or Easy with small changes ›]  [E easy · would repeat Hard ›]│ chips row
 └────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌ H Hard ─────────┐ ┌ I Ideal ┄┄┄┄┄┄┐                ← 2 cards, each 280–440 px, left-aligned
```
- **Collapsed-rung chip**: Chip 32 h (44 hit on touch), `--lm-face` fill, 1 px dashed
  `--lm-line-strong`, hollow 16 px rung key with the letter in the rung colour (identity key
  exception), text "{rung} · {engine reason}" 13/400 ink-2, truncated at one line with the full
  reason in a Popover on click (and as the accessible name). Chips sit in a row under the graph,
  wrapping; on mobile each chip takes the full width.
- Only Hard present: the chips may instead render **inline on the Hard card**, under its title,
  as a 12 px ink-2 line "Medium and Easy would repeat this plan with small changes ›" (same popover).
  Use inline when the ladder strip is collapsed or in print.
- **Carried-forward rung** (kept from the quick search because the longer search collapsed it):
  a normal card with an engraved tag under the title "from the quick search · 12 Oct, 10:42" and a
  dashed 1 px top rule on the card. A longer search never shows fewer cards than the shorter one.
- **Grid reflow** (`.lp-ladder`): columns = the cards that exist, in order Hard · Medium · Easy ‖
  Ideal; the 1 px "your limits" rule column exists only when a distinct Ideal card exists.

| Width | n = cards | Layout |
|---|---|---|
| ≥ 1320 | 1–4 | `grid-template-columns: repeat(n_inside, minmax(280px, 440px)) [1px minmax(280px, 440px)]`, `justify-content: start`, gap 16; no empty columns |
| 1024–1319 | 1–4 | 2 columns of `minmax(280px, 1fr)`; Ideal starts a new row after a horizontal limits rule when n is odd |
| 768–1023 | 1–2 static 2-up; 3–4 snap rail at `calc(50% - 8px)` | — |
| < 768 | 1: full width, no rail, no dots; 2–4: snap rail `calc(100% - 28px)`, 16 px peek, dots for existing cards only | — |

  Row alignment (subgrid) holds across the cards that exist. A collapsed rung never reserves height.

### 12.4 The graph: ladder scale or convergence curve

- **≥ 2 rung markers**: LadderScale as v1, with the x axis **labelled in words**: tick labels "0 ·
  how you live now", "50", "100 · at every limit you set" (11/500 ink-3), axis title "effort"
  (12 engraved). Never a bare "100 effort".
- **< 2 markers, or an exhaustive search ran**: the strip shows the **convergence curve**
  (`LadderConvergence`) instead: x = plans searched (axis title "plans searched", ticks 0 · 100 k ·
  200 k …), y = goal 1 change in its unit (axis title "goal 1 · fat mass"), a 1.5 px ink step line
  of the best Hard found so far, Hard's final value as a 10 px rung-colour marker with a direct label
  "Hard −6.0", the Ideal ceiling dashed. A KeyBank `sm` "ladder · search" switches between the two
  when both exist. The convergence line is **never** drawn on the effort axis.
- A11y: `role="img"` with a sentence ("The search tried 276 000 plans; the best result stopped
  improving after about 180 000 at −6.0 kg") plus a table twin.

### 12.5 Hover inside cards (item 11)
Per `COMPONENTS §14.1`: rows that open the Explain drawer (goal rows, effort rows, fasting, safety)
are buttons with `--lm-face-hover` (on the Ideal: 6 % ink mixed into its own surface); all other
rows have no hover; text colour never changes; the v1 "compare a row" wash across cards is removed.

### 12.6 States (additions)
| State | v2 behaviour |
|---|---|
| Loading / running | provisional cards appear as found; collapsed rungs appear as chips (not slots) as soon as the engine states the reason |
| Empty (no safe plan) | v1 copy; no chips row |
| Ideal equals Hard | §12.2 |
| Error (results unreadable) | Faceplate "These results couldn't be shown. Find plans again." [Find plans] |
| Dark/light | hatched overflow uses `--lm-ink` lines in both themes; check the dashed chip outline (`--lm-line-strong`) is visible on `--lm-face` in dark |

### 12.7 Acceptance checklist (Q6)
- [ ] Hard and Ideal with the same numbers draw identical bar lengths at 390, 768 and 1440 (measure in px).
- [ ] The limit tick is at the track's right end on every card; no tick at 66.7 %.
- [ ] Hatched overflow appears only on the Ideal and only on rows with a value past the limit.
- [ ] Every card shows the "now ├──┤ your limit" legend and the "effort N is the average…" line.
- [ ] Ideal equals Hard: no Ideal card; the one-line statement and "limits lifted without effect" on Hard.
- [ ] Collapsed rungs show as chips under the graph (or inline on Hard) with their reason; no empty column or gap at any width.
- [ ] After "Find the best possible plan", the number of cards is ≥ the quick search's; carried rungs show "from the quick search".
- [ ] With one marker, the graph shows the convergence curve with worded axes; the effort axis never reads a bare "100 effort".
- [ ] Row hover only on rows that open Explain; text contrast ≥ 4.5:1 on hover in both themes.
