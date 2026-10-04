# Screen — Simulator · Results (`/simulate/:sid/results`)

> Reference rendering: `prototype/index.html#results` (try `?view=overlay`, `?xi=45`,
> `?explain=ket`, `?view=focus&focus=ket`). Chart rules: `CHART_SPEC.md`. Morph: `AVATAR_SPEC.md §6`.

## 1. Purpose

Read the projection: what happens to every modelled channel, when, how sure we are, and why. The
screen leads with start → end for the outcomes people care most about, then the **channel stack**
— inputs and outcomes on one time axis with a single crosshair — plus the figure over time,
warnings, and an Explain drawer that links any curve to its mechanism and citations.

## 2. Entry points & exits

| In | Out |
|---|---|
| Run key (from schedule or here) · `schedule | results` KeyBank · deep links `?view=&m=&z=&explain=&xi=` · Evidence "show in my projection" | Schedule (edit, or warning "Fix" with days pre-selected) · Explain → Evidence mechanism · Export PNG/CSV · Planner (none directly) |

## 3. Layout — mobile (375 px)

```
┌──────────────────────────────────────────┐
│ ● vitals                       ◐   ⚙     │
├──────────────────────────────────────────┤
│ Spring cut ▾        [schedule|●results]  │
├──────────────────────────────────────────┤
│ ┌ fat mass ─────────┬ lean mass ────────┬│ ReadoutStrip rail, 200 px items
│ │ 24.1 → 19.7 kg    │ 60.8 → 59.8 kg    ││ start (ink-3) → end (ink), unit
│ │ −4.4 kg           │ −1.0 kg           ││ signed change
│ │ ├─█─┤ 18.6–20.9   │ ├─█┤ 58.9–60.7    ││ RangeBar + likely range
│ └───────────────────┴───────────────────┴│
│ ┌ chart ─────────────────────────────────┐│
│ │ [●lanes|overlay|focus] [●12wk|4wk|1wk] ││ toolbar row 1
│ │ [▲ 1 caution] [≡ Metrics 9] [▦]        ││ toolbar row 2
│ │ Thu 19 Nov · day 46 · fasting block    ││ docked crosshair readout (mtip)
│ │ fat 21.4 · lean 59.1 · weight 80.6 → … ││ horizontal scroll of values
│ │ fat-loss base │diet│ fasting block     ││ phase ribbon 28
│ │ ▲▮ ▲▮ ▲▮                                ││ event ribbon 22
│ │ Intake  kcal/d · P C F       2 470 kcal││ lane label row 20
│ │ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮  ││ inputs lane 60
│ │ ■ body composition                     ││ group header
│ │ — Fat mass  [A●●●●] kg        19.7 kg  ││ lane label row
│ │ 24┤‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲____            ││ lane 64
│ │ …                                      ││
│ │ wk 1        wk 4        wk 7      wk 10 ││ x-axis
│ │ Projections for an average person …    ││ disclaimer
│ └────────────────────────────────────────┘│
│ ┌ Figure over time ───────── day 84 ────┐ │
│ │ (front + side, ghost start outline)   │ │
│ │ [▷ Play]  fat 24.1 → 19.7 · lean …    │ │
│ └───────────────────────────────────────┘ │
│ ┌ Warnings ────────────────────── 2 ────┐ │
│ └───────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ last run 1.2 s · 84 days          (run)  │ action bar
├──────────────────────────────────────────┤
│  body    simulate    plan    evidence    │
└──────────────────────────────────────────┘
```

- Lane labels sit **above** each plot (20 px row) on mobile; plots use the full width minus a
  26 px tick column.
- Metrics picker and Explain open as full Sheets.
- Weight-change decomposition and the day view appear below the chart as their own Faceplates
  (collapsed by default: "Why did the scale move? ▾").

## 4. Layout — desktop (1440 px)

```
┌────┬───────────────────────────────────────────────────────────────────────────────────────────────┐
│ ●  │ Spring cut ▾ [schedule|●results]                     last run 1.2 s · 84 days · 41 ch   Run (●) │
├────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
│    │ ┌ fat mass ───┬ lean mass ──┬ scale weight ┬ waist ──────┬ maintenance ┬ (pinned metric) ──┐ │ strip
│    │ │24.1 → 19.7kg│60.8 → 59.8  │84.9 → 79.6   │90.7 → 85.1  │2 540 → 2 378│                   │ │
│    │ └─────────────┴─────────────┴──────────────┴─────────────┴─────────────┴───────────────────┘ │
│    │ ┌ chart ───────────────────────────────────────────────────────────┐ ┌ Figure over time ─316┐│
│    │ │[●lanes|overlay|focus][●12wk|4wk|1wk] ‹ ›   ▲1 caution  ≡Metrics 9 ▦ ⤓│ │  front   side       ││
│    │ │ schedule blocks │ fat-loss base      │diet│ fasting block  │maint. │ │  (morph, ghost)     ││
│    │ │ ketosis·events  │           ▲▮ ▲▮ ▲▮ ▲▮ ▲▮                    │ │ [▷ Play] fat 24.1→… ││
│    │ │ Intake          │ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮ stacked P/C/F + maintenance│ └──────────────────────┘│
│    │ │ ■ body composition                                               │ ┌ Warnings ───────── 2 ┐│
│    │ │ Fat mass [A] kg │24┤‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲______                        │ │ ▲ 36 h fasts follow  ││
│    │ │ 19.7 kg         │20┤                                             │ │   lifting days …     ││
│    │ │ Lean mass [B]   │  …                                             │ │   [Show] [Move fasts]││
│    │ │ …  (168 gutter) │  (plot, 32 px tick column + data)              │ │ ⓘ Wide range …       ││
│    │ │ x-axis: wk 1 · 5 Oct  wk 2 · 12 Oct …                            │ └──────────────────────┘│
│    │ │ Projections for an average person with your inputs … disclaimer  │                          │
│    │ └───────────────────────────────────────────────────────────────────┘                          │
└────┴───────────────────────────────────────────────────────────────────────────────────────────────┘
 grid: minmax(0,1fr) | 316, gap 16 · Metric picker: docked left 280 (collapsible to 44) · Explain: right 392
```

- With the **Metric picker docked** (default ≥ 1440, remembered): picker 280 | chart | aside 316.
  Below 1440 the picker collapses to a 44 px swatch strip; "Metrics" key expands it as an overlay.
- **Explain drawer** docks right 392 px: at ≥ 1440 it replaces the aside column (figure and
  warnings move below the chart); 1024–1439 it overlays with `--lm-shadow-drawer`.
- **1024–1279**: aside moves below the chart as two columns (figure | warnings).

## 5. Regions & components

| Region | Components | Content | Tokens |
|---|---|---|---|
| Context bar | ContextBar, ScenarioSwitcher, KeyBank, RunKey | last-run summary | — |
| Readout strip | ReadoutStrip (5 + 1 pinned) | start → end, change, RangeBar, likely range | `--lm-readout-sm`, category swatches |
| Chart toolbar | KeyBank (view), KeyBank (zoom), IconKey ‹ ›, Chip (caution), Key "Metrics n", IconKey table/export, pinned chip | — | sticky, `--lm-face` |
| Channel stack | ChartFrame, PhaseBand, EventMarker, Lane ×n, CrosshairReadout, LegendChip (overlay) | CHART_SPEC §4 | category hues, `--lm-chart-*` |
| Metric picker | MetricPicker | 8 category groups, search, grade filters | category swatches, GradeBadge |
| Figure over time | BodyAvatar `morph`, Key Play | state at crosshair, ghost start | `--lm-avatar-ghost` |
| Warnings | WarningsPanel | caution/danger/info rows with Show / Fix | severity tokens |
| Explain | Drawer/Sheet | CHART_SPEC §5.5 | GradeBadge, `.eq` well |
| Decomposition | Faceplate + chart (CHART_SPEC §7.5) | weekly Δ fat / lean / glycogen / water | — |
| Day view | Faceplate + ClockRing + 24 h strip (CHART_SPEC §7.2) | shown at zoom ≤ 2 days | — |
| Table view | DataTable | visible metrics × days | tabular nums |

## 6. Content & copy

- Readout strip items: engraved name ("fat mass") with category swatch; `24.1 → 19.7 kg`;
  `−4.4 kg`; RangeBar with ghost start tick; `likely 18.6–20.9`. Pinned slot (desktop): "+ Pin a
  metric" quiet key until the user pins one from a lane menu.
- Toolbar: `lanes · overlay · focus` · `12 wk · 4 wk · 1 wk · day` · "1 caution" (chip, caution
  colours + icon; "2 cautions", "1 danger" uses danger colours) · "Metrics 9".
- Lane gutter: name (sentence case) · GradeBadge + unit ("kg", "mmol/L", "index") · value at
  crosshair (or the end value) · grade D lanes append "· exploratory".
- Overlay gutter: "Change from start" · "% or index points" · "7-day average. Ketones vary
  ten-fold, so they stay in lanes."
- Crosshair readout header: "Thu 19 Nov · day 46" · phase name; first row "0 kcal · intake · D
  water-only fast"; rows "21.4 kg · Fat mass · 20.7–22.1"; footer events "ketosis entered · 36 h
  fast right after a lifting day".
- Mobile hint (before first scrub): "**Tap and drag across the chart** to read every channel on one
  day."
- Figure over time: title + "day 84 · 27 Dec"; caption "fat 24.1 → **19.7 kg** · lean 60.8 →
  **59.8**"; Play key.
- Warnings rows: title (severity colour, 13.5/600) + one-paragraph body + `Show` (moves crosshair to
  the first affected day and scrolls the chart into view) + a specific fix key ("Move fasts to
  Tuesdays", "Raise protein to 1.8 g/kg") that edits the schedule and returns to it with the days
  selected.
- Disclaimer line (always): "Projections for an average person with your inputs. Not medical
  advice. Individual results differ: see the range on each curve."

**Explain drawer** (example, Blood ketones): category + name + GradeBadge · one-sentence
definition · value at crosshair/end with likely range and start · "what drives it in this
scenario" (ranked bars: fasting days 64 %, glycogen depletion 27 %, low net carbs 9 %) · "the
mechanism, in plain language" (well) · "timing" · "uncertainty" · "sources" (numbered) · key
"Open in Evidence".

## 7. Interactions

- **Crosshair**: pointer hover (desktop) — snaps to day (or hour ≤ 7 days), updates every lane
  dot, gutter value, the floating readout, and the figure over time. Click pins/unpins
  (pinned chip "pinned · Thu 19 Nov ×"). Touch: horizontal-intent drag (> 8 px, |dx| > |dy|)
  scrubs; readout docks on top; vertical drags scroll the page. Keyboard: chart body is one tab
  stop; ←/→ day, `⇧` week, PgUp/PgDn events, Home/End.
- **Zoom/pan**: toolbar presets centre on the crosshair; ‹ › pan by one window; `⌘/Ctrl + wheel`
  or pinch zooms around the pointer; drag on the phase ribbon brushes a range; double-click a
  week label zooms to it. At ≤ 2 days the day view Faceplate opens under the chart.
- **Views**: lanes (default) · overlay (≤ 6 metrics, indexed, 7-day average over 21 days) · focus
  (one lane 280 px, others 26 px strips; `F` / `Esc`).
- **Series control**: lane label click → Explain; lane menu (hover icon / long-press): Focus,
  Explain, Move up/down, From zero, Pin to strip, Hide. Overlay legend chips isolate/hide.
- **Metrics**: picker toggles lanes; overlay refuses a 7th ("Overlay shows up to 6 metrics. Switch
  to Lanes to see more.").
- **Play**: animates the crosshair day 1 → 84 over 2.2 s (ease-in-out), morphing the figure; press
  again to stop. Reduced motion: jumps start → end.
- **Run** (here): holds the current render at 40 %, progress rule, then the playhead sweep.
- **Export**: PNG of the current view (title, dates, legend, grades, disclaimer), CSV of the table.

## 8. States

| State | Behaviour & copy |
|---|---|
| Never run | Perforated EmptyStage in the chart area: "**Run your first projection.** Vitals will simulate 84 days across 41 channels. It takes about a second." + RunKey 56 px centred. Strip shows "—". |
| Running | Previous render at 40 % opacity; 2 px ProgressRule; toolbar "Running · 1.2 s"; RunKey shows the ink arc; nothing reflows. First run: lane scaffolding (labels + empty plots), no skeleton blocks. |
| Done | Cross-fade to 100 % (200 ms) → playhead sweep (700 ms, yellow line left → right) → strip digits roll. |
| Stale | Info Banner under the strip: "Schedule changed since this run · Run again" [Run]; curves at 40 %. |
| Worker error | Danger Banner in the chart area: "**The simulation stopped at day 37.** Glycogen went out of range (below 0 g). This is our bug, not your plan." [Run again] [Copy details]. Previous render stays dimmed. |
| Danger warning | Per dossier 17 §3: before results render, the chart area shows an **acknowledgement panel** (danger-bg Faceplate): the W-rule title and message (≤ 200 chars), "☐ I understand this is a simulation, not a recommendation", [Show the projection]. After acknowledging (per scenario and rule, until the schedule changes) the results render with a persistent 28 px strip at the top of the chart — icon + "Simulation — not a recommendation" (danger fg on danger bg) — plus danger event lines through all lanes; exports carry the same text. The strip is not dismissable while the condition holds. |
| Wide ranges | Lane gutter "wide range" note when band > ±25 %; Explain names the source. |
| 6-month horizon | Default zoom "whole"; x-axis every 3 weeks on mobile; hourly data only from 1 wk zoom. |
| 40 lanes selected | Lanes virtualised; group headers sticky within the chart; picker shows "40 lanes · long page — try Focus". |
| Gentle mode | Weight/fat readouts collapsed behind "show numbers"; figure hidden; default lanes lead with energy, hunger, sleep, strength. |
| No warnings | Warnings Faceplate shows "No cautions for this schedule." (ok icon) |

## 9. Accessibility

- Every lane `role="img"` with an `aria-label` summary (CHART_SPEC §9); the chart body is a
  focusable region with keyboard crosshair and a polite live region mirroring the readout
  (debounced 400 ms).
- Table view (`T` / ▦) is the complete, accessible equivalent, with CSV download.
- Identity never colour-alone: lane names, overlay end labels + dash + marker shapes, macro legend.
- Warnings have icon + title + text; the danger acknowledgement panel receives focus when shown
  (its heading), and the "simulation" strip is plain text in the chart's accessible name.
- Any caution/danger scenario ends the Warnings panel with the persistent help line (dossier 17):
  "Stop and get help if you feel faint, have chest pain or an irregular heartbeat, are confused,
  keep vomiting, or have severe headache, cramps or abdominal pain." 
- Drawer/Sheet focus management per COMPONENTS §10; `Esc` closes Explain, then exits focus mode.
- Touch targets: toolbar keys 32 px with 44 px hit areas on mobile; lane gutters are full-height
  buttons.
- Reduced motion: no sweep, no digit roll, no Play animation.

## 10. Decisions & rationale

- **Readout strip, not KPI cards**: one faceplate divided by hairlines keeps start→end numbers
  compact and scannable, and avoids the hero-metric template.
- **Lanes first, overlay second** (CHART_SPEC §2): native units by default; overlay only for
  timing and direction, capped and smoothed.
- **The figure follows the crosshair**, so scrubbing time animates the body — the most direct
  way to connect curves to the body they describe.
- **Warnings carry specific fixes** that edit the schedule, turning critique into one action.
- **The disclaimer is a quiet line under every chart**, never a modal: always present, never in
  the way.
