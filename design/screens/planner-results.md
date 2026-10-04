# Screen — Planner · Results (`/plan/results?plan=a|b|c&tab=overview|days|curves|safety`)

> **Superseded in v0.2 (2026-10-01) by `plan-ladder.md`** (Hard · Medium · Easy ‖ Ideal; no A/B/C
> anywhere). Kept for the layout grid, print page and accessibility rules the ladder spec reuses.

> Output metrics per research dossier 18 §6: goal attainment (% of what is possible), target met +
> P(target met), projection bands P10–P90, priority cost, conflict class, required horizon, binding
> constraints, hunger burden, complexity, decision stability, model confidence (A–D).
> Chart: `CHART_SPEC.md §7.1`. Plan colours: `--lm-plan-a/b/c` (all-pairs validated).

## 1. Purpose

Choose between 2–3 genuinely different regimes that honour the goal order. Each plan shows its
phase timeline, what it achieves for each goal in priority order, how hard it will feel, what it
asks day to day, and its safety notes. The user compares curves, reads why the plans differ, then
opens one in the Simulator (to tweak) or exports it.

## 2. Entry points & exits

| In | Out |
|---|---|
| Finished optimiser run · Plan tab (when a finished run exists) · Toast "Plans ready · Open" | "Open in Simulator" → new scenario "from Plan B · 30 Sep" at `/simulate/:sid/schedule` · Export (JSON, printable page) · Back to goals ("Adjust goals") · Evidence (grade badges, "why" links) |

## 3. Layout — mobile (375 px)

```
┌──────────────────────────────────────────┐
│ ● vitals                       ◐   ⚙     │
├──────────────────────────────────────────┤
│ Plans for your goals        Adjust goals │ context row
│ 3 goals · 17 weeks · model confidence B  │ engraved
├──────────────────────────────────────────┤
│ ┌[A] Steady deficit, carb-periodised ───┐│ PlanCard, 343 wide, snap rail
│ │ 17 wk · 3 phases · difficulty ●●●○○   ││ 16 px peek of card B at right
│ │ ▓▓▓▓▓▓▓│▓▓▓│▒▒▒▒▒▒▒▒▒│▓▓              ││ PhaseTimeline 28
│ │ 1 Fat mass −10 kg   ✓ reached  −10.4   ││ scorecard in rank order
│ │ 2 Lean mass keep    ✓ −0.3 kg          ││
│ │ 3 Autophagy ↑       ◐ 62 % of possible ││
│ │ hunger: moderate · 3 lifts · no fasts  ││
│ │ safety: no flags                       ││
│ │ [Compare] (Open in Simulator)          ││
│ └───────────────────────────────────────┘│
│              ● ○ ○                        │ position dots
│ [overview | days | curves | safety]       │ KeyBank tabs for the selected plan
│ ┌ Why these plans differ ──────────────┐ │
│ │ …                                    │ │
│ └───────────────────────────────────────┘ │
│ … tab content                             │
├──────────────────────────────────────────┤
│ Plan A selected       (Open in Simulator)│ action bar: solid key
├──────────────────────────────────────────┤
│  body    simulate    plan    evidence    │
└──────────────────────────────────────────┘
```

## 4. Layout — desktop (1440 px)

```
┌────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ●  │ Plans for your goals   3 goals · 17 weeks · confidence B     Adjust goals   (Open in Simulator)│
├────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│    │ ┌[A] Steady deficit ─────── 360 ┐┌[B] Weekly 36 h fasts, high protein ┐┌[C] Recomp at maint. ┐ │
│    │ │ 17 wk · 3 phases · ●●●○○       ││ 17 wk · 2 phases · ●●●●○             ││ 17 wk · 1 phase ●●○○○│ │
│    │ │ ▓▓▓▓▓│▓▓│▒▒▒▒▒▒│▓▓             ││ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▒▒▒              ││ ░░░░░░░░░░░░░░░░░░░░ │ │
│    │ │ 1 Fat −10 kg   ✓ −10.4 (9.1–11)││ 1 ✓ −10.1                             ││ 1 ◐ −6.2 (5.1–7.3)   │ │
│    │ │ 2 Lean keep    ✓ −0.3          ││ 2 ◐ −0.9                              ││ 2 ✓ +0.8             │ │
│    │ │ 3 Autophagy ↑  ◐ 62 %          ││ 3 ✓ 91 %                              ││ 3 ○ 20 %             │ │
│    │ │ hunger moderate · 3 lifts/wk   ││ hunger high on fast days · 3 lifts    ││ hunger low · 4 lifts │ │
│    │ │ safety: no flags               ││ safety: 1 caution                     ││ safety: no flags     │ │
│    │ └──────────────── selected ─────┘└─────────────────────────────────────┘└──────────────────────┘ │
│    │ ┌ Why these plans differ ───────────────────────────────────────────────────────────────────┐ │
│    │ │ goal 1 is held within 5 % of its best in A and B; C trades fat loss for muscle …          │ │
│    │ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│    │ [overview | days | curves | safety]   ← tabs for the selected plan (A)                        │
│    │ ┌ tab content (full width) ─────────────────────────────────────────────────────────────────┐ │
│    │ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
└────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
 cards: 3 × 1fr (min 320) gap 16 · tabs below span full width
```

- **Curves** tab on desktop shows all three plans (A/B/C) in comparison small multiples,
  regardless of the selected plan; the selected plan's lines are 2.5 px, others 2 px.
- **1024–1279**: cards in a 3-column grid at min 300 (text wraps); **768–1023**: 2 columns + the
  third below; mobile: snap rail.

## 5. Regions & components

| Region | Components | Content |
|---|---|---|
| Header | ContextBar, Key quiet "Adjust goals", Key `solid` "Open in Simulator" | run summary, model confidence (GradeBadge of the lowest goal/lever grade) |
| Plan cards | PlanCard ×2–3, PhaseTimeline, DifficultyMeter, scorecard rows | see COMPONENTS §8 |
| Why they differ | Faceplate, prose + conflict table | from κ matrix + ablations |
| Overview tab | PhaseTimeline (detail 44 h), phase cards (list, not cards-in-cards: a table), practical summary | — |
| Days tab | Week table + "a typical day" ClockRing per day type; printable | grams + % energy, window, meals, training, walking, fasting |
| Curves tab | Comparison small multiples (CHART_SPEC §7.1), LegendChip A/B/C, target lines, synced crosshair | per ranked goal + 2 context metrics (hunger, weight) |
| Safety tab | Banner/InlineWarning list per plan, "what we excluded and why" | — |

## 6. Content & copy

**Plan names** are generated from mechanism, never diet brands: "Steady deficit, carb-periodised",
"Weekly 36 h fasts, high protein", "Recomposition at maintenance", "Protein-sparing start, then
diet break", "Alternate-day energy, lifting 4×". Rule: `[energy pattern], [distinctive lever]`.

**Card header**: letter key in plan colour (24 px round-cornered square, inverse letter) + name
(15/600) + "17 weeks · 3 phases" + DifficultyMeter (5 pips + word).

**Scorecard rows** (rank order, never re-sorted):
| Status | Glyph + label | Example |
|---|---|---|
| reached | check + "reached" | "1 Fat mass −10 kg · reached · −10.4 kg (likely 9.1–11.0) · 78 % chance" |
| partial | half disc + "partial" | "3 Autophagy signal ↑ · partial · 62 % of what's possible" |
| not reachable | open circle + "not reachable" | "1 Fat mass −10 kg · not reachable in 17 weeks · −6.2 kg; about 23 weeks needed" |
Directional goals report "% of what's possible" (desirability); targets report value + range +
P(target met).

**Practical summary line**: "hunger: moderate (peaks wk 9) · 3 lifts a week · 8–10 k steps ·
window 8 h · no fasts" ; "hunger: high on fast days · weekly 36 h fast · 3 lifts".

**Safety line**: "safety: no flags" (ok icon) / "safety: 1 caution" (caution icon; tap → Safety tab).

**Why these plans differ** (template, deterministic text per dossier 18 §4.17):
> **All three keep fat loss near its best, then spend what's left differently.**
> Plan A adds carb periodisation around lifting, which keeps lean mass (#2) steady.
> Plan B adds a weekly 36 h fast, which raises the autophagy signal (#3) to 91 % of what's
> possible, at the cost of 0.6 kg more lean-mass loss and higher hunger on fast days.
> Plan C stays at maintenance and builds muscle; it reaches only 62 % of the fat-loss target in
> 17 weeks.
> **Conflict**: autophagy vs lean mass — holding lean mass near its best leaves about 40 % of the
> autophagy gain on the table.

**Overview tab**: PhaseTimeline 44 h with week scale; a phase table: phase · weeks · energy ·
macro split (P/C/F % + g/kg protein) · window · training · steps · notes; "What stays the same:
protein 2.0 g/kg, sleep 7.5 h". Also: required horizon ("to reach −10 kg with plan C: about 23
weeks"), binding constraints ("limited by: no fasts over 24 h · 3 training days"), decision
stability ("A stays best in 88 % of model variations").

**Days tab**: week selector (KeyBank weeks 1–17, scrollable) → a 7-row table: day · day type
letter · energy (kcal, %) · protein / net carbs / fat g · fibre · window · meals · training ·
steps. Above it, "Day types in this plan" — up to 3 per phase, each with a 120 px ClockRing and
macro micro-bar. "Print this plan" (quiet key) → printable page (one week per page, black on
white, no charts, disclaimer footer).

**Curves tab**: title "How the plans compare"; each small multiple titled with rank + metric +
goal ("1 · Fat mass · lose 10 kg"); target line labelled "target −10 kg"; direct end labels
"A −10.4", "B −10.1", "C −6.2"; bands at half alpha.

**Safety tab**: per plan, cautions and what the Planner excluded: "Excluded because of your
limits: fasts over 24 h (you set 24 h max)"; "Excluded for safety: energy under 1 200 kcal on
more than 2 consecutive days". Plan-level safety note always present: "These plans stay within
Vitals' safety limits. They are projections, not medical advice."

**Model confidence** (header): GradeBadge + text "confidence B — lowest grade among your goals
and the levers these plans use (autophagy is grade D and weighted lightly)".

## 7. Interactions

- **Select a plan**: click/tap card (or ←/→ between cards when focused); selected card gets a
  2 px ink edge and pressed letter key; tabs below re-render for it (200 ms cross-fade).
- **Compare**: "Compare" on a card opens the Curves tab scrolled to top; the crosshair syncs across
  small multiples (pointer hover / touch scrub / keyboard).
- **Open in Simulator**: creates a new scenario (copy), navigates to its schedule; Toast "Plan B
  opened as a new scenario · Undo" (undo deletes the scenario).
- **Export**: JSON (plan + provenance: seed, budget used, versions) and printable page.
- **Adjust goals**: back to `/plan/goals` with the list intact; results stay until a new run.
- **Why links**: every "why" statement has an (i) that opens an Explain-style popover naming the
  mechanism and linking to Evidence.

## 8. States

| State | Behaviour & copy |
|---|---|
| 3 plans | As above. |
| Only 2 plans | "Two meaningfully different plans were found. A third would have repeated plan A with small changes." |
| 1 plan | Card + note "Only one plan fits all your limits. Loosen a limit to see alternatives." [Adjust limits] |
| No plan meets goal #1 (must) | Danger-free, honest: Faceplate "**No safe plan reaches −10 kg fat in 17 weeks.** The fastest safe plan reaches 6.2 kg (likely 5.1–7.3). About 23 weeks would be needed." [Extend to 23 weeks] [Keep 17 weeks and see plans] |
| Stopped early | Info Banner "Stopped at 58 %. Plans A and B are complete; robustness checks were skipped, so ranges may be too narrow." |
| Stale | Info Banner "Your goals changed since these plans were found · Find plans again". Cards dimmed 60 %. |
| Body changed | Same stale Banner with "Your body changed on 12 Oct". |
| Directional-only goals | Scorecards show "% of what's possible" for each; no "reached" states. |
| Gentle mode | Scorecard hides weight-type numbers behind "show numbers"; figure silhouettes off. |

## 9. Accessibility

- Cards are `role="radio"` in a `role="radiogroup"` "Plans"; the selected plan announced with its
  name; letter keys have text, colour is secondary.
- Scorecard status uses glyph + word + number; never colour alone.
- Curves: each small multiple has an `aria-label` summary per plan ("Plan A reaches −10.4 kg,
  plan B −10.1, plan C −6.2; target −10") and the table view.
- Tabs: KeyBank as `role="tablist"`; content `role="tabpanel"`.
- Mobile snap rail: arrow buttons (hidden visually, available to screen readers) and position
  dots with `aria-label="Plan 1 of 3"`.
- Printable page: semantic tables, 12 pt minimum.

## 10. Decisions & rationale

- **Cards side by side** because the decision is comparative; the scorecard stays in the user's
  rank order in every card so rows line up across plans.
- **"% of what's possible"** for directional goals (dossier 18 desirability) avoids fake
  precision on indices.
- **Why-they-differ prose** is deterministic templates from the optimiser's archive — no LLM, no
  backend — so it is reproducible and auditable.
- **Open in Simulator copies** the plan: the plan remains a stable reference; the scenario is the
  user's to change.
- **Difficulty is its own meter** (hunger + complexity), because adherence decides real outcomes
  more than the last 0.3 kg.
