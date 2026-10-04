# `src/features/charts` — Vitals chart module

Everything that draws time series for the Simulator and Planner: the channel stack (lanes),
overlay, focus, plan comparison, 24 h day view, TDEE stack, weight-change decomposition,
optimiser convergence, schedule preview, and the table-view twin. Spec: `design/CHART_SPEC.md`
(+ `design/REVIEW_FINDINGS.md`, which wins where they disagree).

Import from `@/features/charts` (the index also loads `charts.css`). Demo route:
`ChartsDemoPage.tsx` (default export) — mount it at `/dev/charts`.

## Data contract (`types.ts`)

Engine-agnostic, columnar, zero-copy. Time unit everywhere: **days since the start** (float).

| Type | Shape |
|---|---|
| `ChartData` | `{ time, series, phases?, events?, intake?, states?, composition? }` |
| `TimeBase` | `{ days, startDate? }` — ISO date of day 0; without it labels read "day 12" |
| `ChartSeries` | `id, label, shortLabel?, unit, category (8), direction, grade A–D, format {decimals}, kind?, overlay?, overlayNote?, daily: Track, hourly?: Track, baseline?, thresholds?, reference?, domain?, mechanism?, stack?` |
| `Track` | `{ values: Float32Array, band?: { lo, hi } }` — 80 % likely range; `NaN` = gap |
| `Phase` | `{ startDay, endDay (excl.), label, shortLabel?, letter?, tone? }` — `shortLabel` must be an honest short form |
| `ChartEvent` | `{ day, hour?, type, label, severity? }` — `severity` caution/danger draws a line through every lane |
| `IntakeContext` | `grams` (5 macros × days), `kcal?` (derived 4/4/2/9/7), `maintenance`, `steps?`, `exercise?`, `meals?`, `eatingWindows?`, `sleep?` — always kcal; the views convert via their `energyUnit` prop |
| `StateTrack` | ordinal state per day / hour (ketosis: none · forming · nutritional · deep) |
| `ComparisonData` | `{ time, plans: [{ id: 'A'|'B'|'C', name, series }], goals: [{ rank, metricId, text, target? }], contextMetricIds? }` |
| `ConvergenceTrace` | `{ plan, scores: Float32Array }` |

Rules the chart relies on: `daily.values.length === days`; `hourly.values.length === days × 24`
(fast metrics only); units are already in the user's unit system; `baseline` is the value
*before* day 1 (defaults to `daily[0]`). 6-hourly data is derived (mean) and cached.

### Adapting engine output

`adapt.ts` maps a columnar engine result + the static METRICS catalogue without copying arrays:

```ts
import { adaptResult } from '@/features/charts';
const data = adaptResult(
  { days: r.meta.days, startDate, daily: r.daily, dailyBand: r.bands, hourly: r.hourly, hourlyBand: r.hourlyBands,
    baseline: r.baseline, events: r.events /* { tHours, type, label, severity } */, states: r.states },
  METRICS, // { id, label, unit, category, grade, decimals, thresholds, overlay, ... }
  { phases, intake },
);
```

If the engine's field names differ, write the few lines by hand — `toChartSeries(meta, result)` is the
per-metric unit. Convert series units (kg↔lb, mmol/L↔mg/dL, kcal↔kJ) *before* handing data over. The intake
context stays in kcal: pass `energyUnit="kJ"` to `ChartFrame` / `LaneStack` / `DayView` / `DataTable` (and
`buildTable(…, { energyUnit })`) so the intake and energy-balance lanes, meal labels, readouts and table columns follow
Settings › energy.

## Components

| Component | Key props |
|---|---|
| `ChartFrame` | `data, laneIds?/defaultLaneIds?/onLaneIdsChange?, overlayIds?, view?/defaultView?/onViewChange? ('lanes'|'overlay'|'focus'), focusId?/onFocusChange?, status? ('idle'|'running'|'stale'), statusText?, sweepKey?, textures?, toolbarSlot?, onExplain?(id), controller?, disclaimer?, dayView? (default true), focusResolution?` — the results chart: sticky toolbar, active view, table twin (`T`), CSV export, day view at ≤ 2-day zoom, disclaimer. |
| `LaneStack` | `data, controller, laneIds, onLaneIdsChange?, focusId?, onFocusChange?, showInputs?, showEnergy?, textures?, status?, onExplain?, onCommand?, readout? ('auto'|'float'|'dock'), sweepKey?` |
| `OverlayView` | `data, controller, metricIds (≤ 6; ineligible ones are listed as excluded), status?, sweepKey?, readout?` |
| `FocusView` | `LaneStack` props + `focusId, resolution? ('auto'|'hourly')` |
| `CompareView` | `data: ComparisonData, selected?: PlanId, controller?, height? (160)` |
| `DayView` | `data, day, onDayChange?, metricIds?, controller?, laneHeight?` · `ClockDial` `{ data, day, controller?, size? }` |
| `TdeeStack` | `series (stacked-area with stack.components/counterfactual), time, phases?, controller?, height?, textures?` |
| `WeightDecomposition` | `composition, time, baseline?, height?` |
| `ConvergenceChart` | `traces, height? (120), caption?` |
| `PreviewStrip` | `fat, ketosis?, unit?, height? (48)` |
| `DataTable` | `time, series, x0, x1, res, intake?, caption?, fileName?, onClose?` |
| `LegendChip`, `KeyGlyph` | legend key with dash + marker; click isolates, Alt-click hides |

State: `ChartController` (`useChartController(days, opts)`) holds the target zoom (`zoom` store),
the displayed window + resolution (`view` store, animated), the crosshair (`cursor` store) and the
pointer. Pass one controller to several views to share zoom and crosshair (the frame does this
across lanes / overlay / focus).

Picker **data logic** lives here (`lib/picker.ts`: `pickerGroups`, `toggleMetric`, `matchesQuery`,
`capacityText`, `DEFAULT_LANE_IDS`); the picker UI belongs to the Simulator/Planner features.

## Interaction (CHART_SPEC §5)

- Pointer: hover = crosshair snapped to the sample (day / 6 h / hour); click pins/unpins;
  double-click resets zoom; `Ctrl/⌘ + wheel` or trackpad pinch zooms around the pointer (plain
  wheel scrolls the page); `⇧`-drag pans.
- Time ruler: drag = brush a range; when zoomed it becomes the overview mini-map with a draggable
  window frame; double-click a week = zoom to it; double-tap = zoom in one level.
- Touch: horizontal intent (> 8 px, |dx| > |dy|) scrubs, vertical scrolls; lift or tap pins; tap
  elsewhere unpins; double-tap resets; two fingers pinch / pan. `touch-action: pan-y` on the body.
- Keyboard (chart body is one tab stop): ←/→ sample, `⇧` ×7, Home/End, PgUp/PgDn events,
  `+`/`−` zoom, Enter pins, `T` table, `F` focus, `Esc` exits focus / unpins. The readout is
  mirrored to a polite live region (400 ms debounce).
- Lanes: menu (Focus · Explain · Move up/down · From zero · Hide), drag the grip to reorder within
  a category (arrow keys on the grip too).

## Rendering and performance

- One **uPlot** instance per plot (`core/plotEngine.ts`) used as a DPR-aware canvas renderer:
  uPlot strokes the line paths; our hooks draw layers 1–7 (phase bands, grid, printed y-scale,
  likely-range band, thresholds/reference, markers, severity lines). uPlot's cursor/legend/axes
  are off — the frame owns one pointer layer, so the crosshair is synced through the controller,
  not `cursor.sync` (it also has to serve gutters, ribbons, keyboard, touch intent and pinning).
- Lanes mount their canvas only within the viewport ± 1 screen (IntersectionObserver) and skip
  redraws while off-screen; `content-visibility: auto` skips their style/layout; the value box
  in each gutter is size-contained.
- Resolution follows the span (daily > 21 d, 6-hourly 7–21 d, hourly ≤ 7 d); anything with more
  samples than 2 × plot width is **M4-decimated** (`lib/downsample.ts`) — e.g. focus view with
  "hourly" at the whole horizon.
- The crosshair never re-renders React: stores → imperative `textContent`/`transform` writes,
  redundant writes skipped; the readout's size is cached by a ResizeObserver (no forced layout).
- Measured in Chromium at 1440 × 900, 183 days × 44 metrics (52 rows): crosshair step
  **2.9 ms median / 3.3 ms p90** (script + style + layout); Ctrl-wheel zoom frame **5.7 ms / 8.6 ms**.
- Theme: `core/theme.ts` reads `--lm-*` once per theme change (html `data-theme` / `data-motion`,
  OS colour scheme, forced colours, font load) and every plot redraws; `--lm-dur-slow` ≈ 0 ⇒
  reduced motion (no zoom tween, no y-rescale tween, no playhead sweep).

## Accessibility

Every lane is `role="img"` with a generated summary ("Fat mass, kilograms, grade A. Falls from
24.1 to 20.2 (likely …) over 12 weeks; fastest in weeks 1 to 2. Press T for the data table.").
Table twin with CSV for every view; identity is never colour-alone (names, dash patterns +
marker shapes in the overlay, plan letters on end labels, macro letters in the intake legend);
opt-in textures (`textures`) and automatic hatching/system colours in forced-colors mode.

## Chart-local tokens (promote to `design/tokens.css` when convenient)

Defined in `charts.css`, validated with the dataviz script:
`--lmc-energy-ramp-1..4` (TDEE stack, ordinal teal, lowest-contrast step at the bottom) and
`--lmc-decomp-fat|lean|glycogen|water` (all-pairs PASS in both themes).

## Deviations from CHART_SPEC (deliberate)

- **Decomposition colours** (§7.5): the specified cobalt / cobalt-300 / copper / sky set fails
  validation (lean ↔ water ΔE 4.9 normal vision). Used a macro-semantic set instead — stored fat
  = fat colour, lean = protein colour, glycogen = carbohydrate colour, water = sky — all-pairs PASS.
- **TDEE ramp order** (§7.3): lowest-contrast step at the bottom (BMR) so the large resting area
  stays quiet; spec listed 700 → 250 bottom → top.
- **Threshold domains** (§4.3): zero-anchored only for near-zero data (min < ½ max), extending to
  1.2 × the highest threshold the data comes near; other threshold lanes (BP, LDL) hug the data
  and include nearby thresholds, so 124–131 mmHg is not flattened on a 0–156 axis.
- **Event ribbon**: beyond 4 weeks it shows safety / fast-start / diet-break glyphs only (the
  ketosis band already carries ketosis on/off); labels sit on their own line under the band.
- **Energy lane**: added an energy-vs-maintenance lane (diverging columns in the energy-balance
  tints); in dark, fast days are hatched rather than white (REVIEW_FINDINGS 4).
- **Focus lane height**: 280 / 260 / 220 px (tokens) rather than §5.4's 300 px.
- **Double-click / double-tap on a plot resets the zoom** (task brief); §5.2's "double-tap ruler =
  zoom in one level" is kept on the ruler.
- **PNG export** (§11): `lib/pngExport.ts` redraws the chosen lanes (not a DOM screenshot — off-screen
  lanes have no canvas) with name, unit, grade, end value, printed y ticks, likely-range band, the
  schedule blocks row, a time axis and the disclaimer, in the live theme; `ChartFrame` offers it next to
  CSV (`exportTitle`, `exportSubtitle`, `exportNote`). Canvas → Blob → download, no dependency.
- **Phase balance** (R-MAINT): `Phase.balance` ("deficit 18 %") is appended to the block name in the
  ruler when it fits and always shown in the tooltip.
- **Not implemented**: y-rescale animation during continuous wheel zoom (discrete zooms and "from
  zero" tween). The Explain drawer lives in `@/features/evidence`, the picker UI in the Simulator.

## Tests

`pnpm vitest run src/features/charts` — pure logic (formatting, ticks, downsampling, transforms,
cursor ↔ index, zoom reducer, domains, labels, table/CSV, picker, summaries, fixtures determinism,
controller) and jsdom mounts of every component (`test/setupDom.ts` shims canvas, Path2D,
ResizeObserver, IntersectionObserver and matchMedia; import it first).

## Living-mode charts

`living/` holds the charts of the daily instrument (CHART_SPEC §7.8–7.10, COMPONENTS §13.9): small
bespoke SVG charts, independent of the channel stack's controller. Data types are in
`living/types.ts` (`TrendLaneData`, `DialItem`, `CalendarDay`, `BlockBar`, `ScoreHistoryData`) — plain
arrays indexed by day from `startDate`, `NaN` = gap, units already in the user's system. Each
component imports `living/living-charts.css` itself, so importing from the file directly (as the
Living screens do) needs nothing else; everything is also exported from `@/features/charts`.

| Component | Key props |
|---|---|
| `TrendLane` | `data: TrendLaneData, size? ('today' 64–96 px, default 88 · 'progress' 240 / 180 under 640 px wide · 'checkin' 160; default progress), height?, quiet?, readout? (ReactNode \| false), title?, className?` |
| `AdherenceCalendar` | `month ('YYYY-MM'), days: CalendarDay[], today (ISO, from the app clock), onSelect?(date), selected?, quiet?, weekStart? ('mon' \| 'sun'), caption? (ReactNode \| false), label?, className?` |
| `BlockBars` | `bars: BlockBar[], costliest? (sentence from the source), quiet?, quietWord?(mean), caption?, className?` |
| `ScoreHistory` | `data: ScoreHistoryData, height? (200 / 160 under 640 px), label? (metric name for summary and table), title?, className?` |
| `AdherenceDial` | `items, score, size? ('glyph' 16 · 'sm' 64 · 'md' 120), final?, coverageText?, quietWord?, onArcClick?, label?` (geometry: `dialArcs`, `dialSentence`) |

- **TrendLane** marks, bottom → top: pause hatch · grid + printed tick column (32 px, 26 px under
  500 px; 2–3 nice ticks inside the hugged domain; unit over the column) · realistic band
  (`--lm-cat-body` at band alpha) + optional p50 hairline · as-prescribed band as a 1 px dashed
  (`3 3`, ink-3) outline · goal (1 px ink + engraved label) · weigh-ins (4 px body-hue dots at 35 %;
  flagged = hollow ring, never removed) · trend (2 px, round joins, NaN = gap) · version / reset
  hairlines with engraved labels · the yellow now-hand (1.5 px + 6 px counterweight; the only
  yellow) · crosshair. X: dates ("1 Oct"), every 1st–7th day counted back from today up to 14
  days, Mondays beyond; the goal-date range is a bracket on the x-axis ("likely 21–30 Dec"),
  clipped to the window with an arrow. The domain hugs bands, dots and trend (+10 %); the goal
  stretches it only on `progress` — elsewhere a far goal becomes an edge label ("goal 79.5 kg ↓").
- **Interaction** (TrendLane, ScoreHistory): the plot is one tab stop, `role="img"` with a generated
  summary (`trendSummary`: "Weight trend 83.1 kilograms, expected today 82.8 to 83.6; 9 weigh-ins in
  the last 14 days; goal date likely 21 to 30 December."). Hover / tap / ←→ (⇧ ×7, Home/End, Esc)
  move a day crosshair with a small readout (docked as one line on `today`), mirrored to a polite
  live region after 400 ms. A quiet "table" key (or `T`) toggles the table twin with CSV.
- **Quiet mode**: no y numerals, no unit, no weights in readout, summary or crosshair ("trend going
  down"); the table key is hidden (the screen's "show numbers" key lifts quiet). Calendar labels and
  BlockBars use the dial's vocabulary (≥ 85 "as planned" · 60–84 "mostly" · 30–59 "partly" · < 30
  "a little"; `quietScoreWord`).
- **Calendar**: in-plan days are keys (44 px touch / 36 px fine pointer) with the date and a 16 px
  dial glyph when scored; unscored past days a hollow dot; assumed days a dashed outline; paused
  days struck; future days the number only, faint; out-of-plan days blank; today the yellow
  indicator dot. Labels: "Wed 14 Oct, adherence 84" · "…, filled in as planned, not scored" · quiet
  "…, adherence mostly". Roving tab stop; arrows / Home / End move focus.
- **BlockBars**: 8 px well track, ink fill to the mean, printed ticks at 0 / 50 / 100 (numerals once
  under the bars), value at the end ("84" or "not logged"), **no target line**, the costliest item in
  text underneath. A list: each row reads "training 84 out of 100".
- **ScoreHistory**: nightly dots (category hue, 35 %), 7-day mean 2 px in `--lm-cat-recovery` /
  `-performance` / `-cardio`, personal normal range as an ink band (12 %), version lines with
  engraved labels, a new device as a dashed join of the mean line plus an engraved mark, optional
  dashed compare line.
- **Pure helpers** (`living/trend.ts`): `trendDomain`, `trendLayout`, `trendSummary`,
  `trendReadoutText`, `trendPointParts`, `trendTableRows`, `trendTableCSV`, **`trendToChartData`**
  (weigh-ins, trend and both forecasts as `ChartSeries` with bands, so `DataTable` / `buildTable` /
  lanes can show the trend), `scoreLayout`, `scoreSummary`, `scoreTableRows`, `quietScoreWord`,
  `placeLabels`, ISO date helpers. Nothing here computes scores, bands, drift states or goal dates —
  they arrive in the data.

### Deviations (living charts)

- **SVG, not LaneStack**: the uPlot lanes cannot draw the dashed as-prescribed outline band, the
  raw weigh-in dot layer with hollow flagged dots, or the x-axis goal-date bracket, so the trend lane
  and the score history are bespoke SVG (like `WeightDecomposition` / `PreviewStrip`) with their own
  small React-state crosshair; the §8.2 imperative-crosshair budget is for the channel stack.
- **Table twin** is a plain table with the spec's columns (date · weigh-in · trend · expected range ·
  event) and CSV, not `DataTable`: the event column and the "unusual, kept" flag do not fit its
  series × time model. `trendToChartData` is there when a `DataTable` or lane is wanted.
- **Far-goal edge label** sits at the lower left (the open side of a falling trend; upper left for a
  goal above) instead of the right, so it never lies under the now-hand; an in-range goal label stays
  right-aligned and steps left of the now-hand when they would meet.
- **Goal-date range beyond the window** shares the date row (arrow + label at the edge; the dates it
  would overprint are dropped) rather than taking its own 16 px row — the Today lane is only 64–96 px.
  On Today this usually hides today's own date label; the now-hand marks it.
- **Event labels** are placed greedily and dropped rather than overprinted (§4.5); the text stays in
  the crosshair readout, the table and the summary.
- **Flagged weigh-ins** are a hollow ring at 80 % stroke opacity — at the dots' 35 % a 1 px ring
  disappears.
- **ScoreHistoryData** carries no metric name: `ScoreHistory` takes a `label` prop for the summary
  and table. The compare line uses the category hue dashed `4 3` (identity within a category = hue +
  dash, §3.1).
- **Calendar**: future in-plan days are keys too (they open a read-only preview); today without a
  score shows no mark (the day is not over); `selected` outlines the open day in ink; the grid caps
  at 560 px.
- **BlockBars** use list semantics with full text per row instead of `role="img"`.
- **CSS**: the trend / calendar / bars / score rules live in `@layer components` (the dial's rules
  above them predate this and stay unlayered). The ISO date helpers in `living/trend.ts` duplicate a
  few lines of `@/living/dates` on purpose: the chart module does not import the Living feature.
