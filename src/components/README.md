# Vitals design system — primitives

The instrument panel, in code. Braun/Ulm lineage: mineral-grey chassis, white faceplates
(anthracite in dark), lowercase engraved labels, tuning-scale sliders, key banks with yellow
indicator lights, one round yellow Run key. Chrome is achromatic; colour belongs to data.

- Source of truth: `design/DESIGN_DIRECTION.md`, `design/COMPONENTS.md`, the prototype
  (`design/prototype/`) and `design/REVIEW_FINDINGS.md` (wins where it disagrees).
- **Living gallery: `/dev/components`** — every primitive, variant and state, light and dark
  side by side (≥ 1280 px) or switchable. Open it before building a composite.
- Import everything from `@/components`. Shell APIs (TopBar, ActionBar, notices) come from
  `@/app/shell`; route helpers from `@/app/paths`; local-data registry from `@/state/persistence`.

```tsx
import { Faceplate, Key, KeyBank, ScaleSlider, Readout, Notice, toast } from '@/components';
import { TopBar, ActionBar } from '@/app/shell';
```

---

## 1. Tokens — the rules

| Need | Use | Never |
|---|---|---|
| Surfaces | `bg-chassis` `bg-chassis-2` `bg-face` `bg-well` `bg-raised` | white/black, `#fff`, Tailwind palette colours (they are removed) |
| Text | `text-ink` `text-ink-2` `text-ink-3` (≥ 4.5:1 on every surface in both themes) · `text-ink-faint` disabled only | grey hex values |
| Lines | `border-line` (hairlines inside faceplates) · `border-line-strong` (faceplate edge) · `border-edge` (control boundary ≥ 3:1) | dashed lines unless they mean something |
| Signal yellow | Run / Find plans key, indicator dots, now-hand, brand dot | text, warnings, large fills, data series |
| Severity | `Notice`, `InlineWarning`, `StatusMark`, `Chip kind="status"` — shape + label, colour on the **mark only** | blue-filled banners, coloured headings, coloured left borders |
| Metric colour | `categoryColor('fuel')`, `<Swatch category>`, `var(--lm-cat-*)`, `--lm-macro-*`, `--lm-plan-*` | colour by rank, generated hues |
| Evidence | `<GradeBadge grade>` (achromatic) | colouring grades |
| Shadows | `shadow-face` `shadow-key` `shadow-pop` `shadow-sheet` `shadow-drawer` `inset-shadow-well` | coloured glows, zero-blur offset shadows |
| Motion | `duration-instant/fast/base/slow/needle`, `ease-out/press/needle/sheet` | bounce, decorative entrances |

- Dark mode is automatic: tokens swap under `<html data-theme>` / the OS preference. **Do not
  write `dark:` variants.** For canvas/SVG read `getComputedStyle(el).getPropertyValue('--lm-…')`
  or use `var(--lm-…)` in SVG `fill`/`stroke`.
- `src/styles/tokens.css` and `tailwind-theme.css` are copies of `design/`; change the design
  source and re-copy. Component CSS lives in `src/styles/components.css` (`lm-*` classes, tokens only).
- Numbers: `formatNumber(2540)` → `2 540` (thin space), `formatSigned(-4.4)` → `−4.4` (true
  minus), `formatRange(18.6, 21, 1)` → `18.6–21.0`. Units one step smaller in ink-2 (`.lm-unit`).
  Live readouts use `.lm-num` (wide, tabular, slashed zero).

### Type roles
| Role | How |
|---|---|
| Screen title (display 120 %, 24 px) | `TopBar title` renders it; elsewhere `.lm-title` |
| Faceplate / section title 15/600 | `Faceplate title`, `.lm-h3` |
| Engraved label — lowercase 12/500 ink-2 | `<Engraved>` / `.lm-eng`. **Author the text lowercase.** |
| Readout | `<Readout>`, `.lm-num` |
| Axis / dense numerals | `text-2xs` + `wdth-condensed` |

---

## 2. Layout patterns

- **Page column** — `<Page>` gives 16 px gutters (mobile) / 24 px (desktop), max 1440. `width="narrow"`
  for settings-like reading columns.
- **Faceplate grid** — faceplates sit on the chassis in a grid with 16 px gaps
  (`grid gap-4`; desktop 12-col: `lg:grid-cols-12` + `lg:col-span-*`, or fixed rails such as
  `lg:grid-cols-[240px_minmax(0,720px)]`). Give grid children `min-w-0`.
- **Never nest faceplates.** Inside one, structure with `<Section label>` (label + hairline),
  `<Rule>`, `<KeyValueList>`, `Notice layout="ruled"` and spacing.
- **Mobile strips** (readouts, program keys, plan cards, anchor chips) — `<ScrollRail>`: snap,
  scroll-padding = gutter, size cells so the next one peeks.
- **Sheets vs panels** — below 1024 px editors/explanations are bottom **Sheets** (detents
  35 / 60 / 92 %); from 1024 px they are **SidePanels** (392 px overlay, no scrim), docked in-flow
  at ≥ 1280 px. `<ResponsivePanel>` chooses for you. **Dialog** only for destructive confirmation,
  import preview and first-run consent.
- **Density** — setting screens: 44 px targets, 16–24 px between groups (`size="lg"` banks/keys on
  touch). Reading screens: 32 px pointer targets, `size="sm"` banks in toolbars.

### The app shell (`@/app/shell`)

```tsx
export default function SimulatePage() {
  return (
    <>
      <TopBar
        title={<ScenarioSwitcher />}          // or a string; rendered inside the h1
        documentTitle="Spring cut"
        tabs={<LinkBank label="Simulator section" items={[
          { to: paths.schedule(sid), label: 'schedule' },
          { to: paths.results(sid), label: 'results', badge: stale, badgeLabel: 'results out of date' },
        ]} />}
        params={<Engraved>5 Oct → 27 Dec</Engraved>}   // desktop only
        actions={<span className="max-lg:hidden"><RunKey state="stale" caption="84 days" onRun={run} shortcut /></span>}
      />
      <ActionBar>                                        {/* mobile only, above the tab bar */}
        <div className="min-w-0 flex-1 text-sm"><Engraved>painting with</Engraved> <b>A · training day</b></div>
        <RunKey size="lg" state="stale" onRun={run} />
      </ActionBar>
      <Page>…</Page>
    </>
  );
}
```

- `TopBar` portals into the sticky context bar (mobile: under the top bar; desktop: top of the
  main column) and sets `document.title`. `back={{ label: 'Evidence' }}` adds a back chevron
  (nested routes); `back={{ mobileOnly: true }}` + `compactOnMobile` puts the title into the
  mobile top bar (Settings).
- Completion scales use `TopBar progress`, which aligns them to the trailing content edge
  and gives them a separate centered row below 768 px. Keep section navigation in `tabs`.
- `<GlobalNotice id severity title body actions />` (or `showNotice()` / `dismissNotice()`) shows an
  app-wide notice under the context bar. `setNavBadge('simulate', true)` lights the stale dot on the
  rail and tab bar. `toast(message, { action })` for undoable/background confirmations.
- Routes and stable page paths: `src/app/routes.tsx`. Each feature default-exports
  `src/features/<name>/<Name>Page.tsx`; one page serves all of its feature's paths
  (`useParams`/`useMatch`). `/simulate` and `/plan` are redirect entries the feature resolves.
  Link with `paths.*` from `@/app/paths`.

### Persisting a store (`@/state/persistence`)

```ts
export const useScenarioStore = create<S>()(persist(init, { name: 'vitals.scenarios', version: 1, migrate }));
registerStore('vitals.scenarios', 1, {
  label: 'scenarios',
  describe: (s) => `${(s as S).list.length} scenarios`,   // shown in Settings › Your data
  validate: (s) => isScenarioState(s),                    // import rejects damaged state
  merge: (current, incoming) => mergeRenamingClashes(current, incoming), // "(imported)" suffixes
  rehydrate: () => useScenarioStore.persist.rehydrate(),
});
registerDatabase('vitals-projections'); // IndexedDB caches erased by "Reset everything"
```
Keys must start with `vitals.`. Export/import/erase are generic over every `vitals.*` key;
registration adds labels, validation, merge rules and rehydration.

---

## 3. Primitives

### Surfaces
- **`Faceplate`** `variant="plain" | "inset" | "flush"`, `title`, `caption` (engraved), `actions`,
  `footer`, `as`. **`FaceplateHeader`**, **`Rule`**, **`Section label aside`**, **`Stage`**
  (perforated dot grid), **`KeyValueList items`**, **`Engraved`**, **`Page`**, **`ScrollRail`**,
  **`VisuallyHidden`**.

### Keys
- **`Key`** `variant="default|solid|quiet|danger|signal"`, `size="sm|md|lg"`, `icon`,
  `trailingIcon`, `indicator` (true = lit yellow, false = hollow), `shortcut`, `pressed` (toggle,
  Braun pressed cap), `loading`, `shape="pill"`, `block`, `disabledReason` (stays focusable,
  explains why — prefer it over `disabled`). `KeyLink` = router link with key looks.
  One `solid` key per view at most; `signal` only for **Find plans**.
- **`IconKey`** `icon label` (label required → ink tooltip + aria-label), `size`, `variant`.
- **`RunKey`** `onRun state="idle|stale|running" elapsed caption size="md|lg" disabledReason
  shortcut` — the only round primary; ⌘/Ctrl + Enter when `shortcut`. Caption is context
  ("84 days"), never the word "Run" again.

### Choice
- **`KeyBank`** (alias `SegmentedControl`) — radio group of 2–6 keys: `options value onChange
  label|labelledBy size="sm|md|lg" block orientation`. Arrows move + select, Home/End.
  Option `badge` = ink dot, `icon`, `iconOnly`, `disabled`.
- **`LinkBank`** — route sub-navigation drawn as a bank (`aria-current="page"`).
- **`Tabs` / `TabList` / `Tab` / `TabPanel`** — in-page tabs, bank-styled.
- **`Switch`** `checked onChange label labelStyle labelledBy describedBy` — `role="switch"`.
- **`Checkbox`**, **`RadioGroup`** — lists (won't-do list, consent, import mode).
- **`Select`** `options value onChange` — popover listbox on desktop pointers, native picker on
  touch (`native` to force). More than 6 options; fewer → KeyBank.
- **`Chip`** `kind="plain|metric|filter|status"`, `category`, `swatch`, `pressed/onPressedChange`,
  `severity`, `onRemove removeLabel`. **`Swatch`** is the metric key glyph.

### Fields and numbers
- **`Field label help error`** wires id / label / describedby for the control inside
  (`TextInput`, `NumberField`, `Stepper`, `Select`, `KeyBank` read it via `useField()`).
- **`NumberField`** / **`Stepper`** `value onChange min max step decimals unit name` — typing
  commits on Enter/blur, Escape reverts, ↑/↓ step (⇧ ×10), ± keys hold-to-repeat and clamp;
  out-of-range typing shows "Weight must be 30–300 kg." and is not committed.
- **`MeasureStepper quantity="mass|length|height"`** — values are always metric (kg, cm);
  display follows Settings › Units (or `system`); imperial height is ft + in; `unitToggle` adds
  a `kg | lb` bank.
- **`ScaleSlider`** (alias `TuningSlider`) — the tuning window. `label value onChange onCommit
  min max step minorStep majorStep labels format unit valueText zones likelyRange reference size
  note locked lockedReason`. Native range underneath; mouse jumps to the pointer, touch drags
  relatively (no accidental jumps); rider readout while dragging; needle settles with the damped
  ease; ←/→ step, ⇧ ×10, PgUp/PgDn major tick, Home/End, Enter or double-click readout to type;
  horizontal wheel while focused. Zones: `deficit-1…4`, `surplus-1…4`, `neutral`, `caution`, `danger`.
  Use `onChange` for live visuals (avatar), `onCommit` for expensive work (engine).
- **`ScaleRange`** (alias `RangeSlider`) — two needles, span bar, `minGap`, thumbs never cross.

### Readouts and evidence
- **`Readout label value unit decimals from range caption unknownCaption size="lg|md|sm" animate
  category`** — "24.1 → 19.7 kg", signed change, likely-range gauge, digit roll when `animate`.
- **`RangeBar low high value ghost min max width`** — axis with printed ticks, 4 px range, ink tick.
- **`ReadoutStrip items label`** — one flush faceplate, hairline dividers, mobile snap rail.
- **`ReadoutInline`** — a value inside a sentence.
- **`GradeBadge grade size onClick`** (alias `EvidenceBadge`) — A–D + pips, meaning in tooltip.

### Feedback
- **`Notice severity title actions layout="boxed|ruled" onDismiss collapsible announce`** (aliases
  `Banner`, `SeverityBanner`). Risk first, then what to do, then the option. Cautions/dangers
  cannot be dismissed while the condition holds; dangers may collapse to one line.
- **`InlineWarning severity action alert`**, **`StatusMark severity`**.
- **`toast(message, { action, duration, id })`** + `<Toaster>` (mounted by the shell).
- **`Tooltip content role="description|label"`** — ink, 400 ms (instant within 1 s), hover +
  keyboard focus, Escape. Never essential information.
- **`ProgressRule value?`** (2 px at the top of a `relative` region; text with reduced motion),
  **`Spinner size`**, **`Meter value max valueText label`**.
- **`EmptyStage title action art`** (alias `EmptyState`), **`Skeleton`** (static; lists only).

### Overlays
- **`Dialog open onClose title footer dismissible role size initialFocus`** — native `<dialog>`
  (top layer, inert page) + focus trap + Escape; restores focus.
- **`Sheet open onClose title footer detent detents`** — bottom sheet, drag handle, peek is non-modal.
- **`SidePanel open onClose title footer mode="overlay|docked"`** (alias `Drawer`), **`ResponsivePanel`**.
- **`Popover open onOpenChange anchorRef placement`** + `usePopover()`, **`Menu trigger items label`**.
  Floating layers portal to `<body>` — or into the open Dialog/Sheet (`PortalContainerContext`).

### Icons
`<Icon icon={Copy} size={16|20} label?>` — Lucide or an authored glyph, always 1.5 px absolute
stroke. Authored: `Glyphs.AvatarFront, AvatarSide, Channels, RouteGlyph, BookGlyph, SlidersGlyph,
ThemeGlyph, DumbbellPlate, Footsteps, RunGlyph, FastClock, MealDot, KetoneDrop, SleepArc,
GradePips, ProgramKey, ScaleRuler, Hatch, InfoMark, CautionMark, DangerMark, OkMark`.

### Hooks and helpers
`useMediaQuery(MQ.lg)`, `useReducedMotion()` (settings override > OS), `useControllableState`,
`usePressAndHold`, `useFocusTrap`, `useRestoreFocus`, `useAnchoredPosition`, `cx`, `formatNumber`,
`formatSigned`, `formatRange`, `formatBytes`, `parseNumber`, `snap`, `scaleTicks`, `niceStep`.

---

## 4. Building composites (macro triangle, clock ring, raster painter, metric picker, plan card…)

- Compose from these primitives; add feature CSS next to the feature using `var(--lm-*)` only.
- Interactive custom widgets: native element or ARIA pattern, `aria-valuetext` with units,
  44 px touch / 32 px pointer targets (`.lm-hit` adds an invisible 44 px hit area), focus ring
  from the base layer (never remove outlines), `useReducedMotion()` for anything animated.
- Needles/readouts that settle: `transition: left var(--lm-dur-needle) var(--lm-ease-needle)`.
- Colour only in data; chrome stays achromatic; one yellow key per view.

## 5. Do / don't (DESIGN_DIRECTION §5, REVIEW_FINDINGS)

| Do | Don't |
|---|---|
| Faceplates on the chassis; hairlines inside | Nested cards, glass, gradient text, glowing rings |
| Lowercase engraved captions, sentence-case headings | Uppercase tracked micro-labels, eyebrows, "01 / 02" numbering |
| Pressed-key selection with a yellow indicator light | Coloured highlight pills, sliding selection indicators |
| Printed tick scales on sliders and range gauges | Progress donuts, gauges, decorative sparklines |
| Units, likely ranges and grades on every projection | Single-number certainty, KPI hero tiles ×4 |
| Notices: faceplate text + status mark, remedy keys | Blue-filled banners, coloured headings, thick coloured left borders |
| Plain, specific, second-person copy | Moral food language, body labels, exclamation marks, emoji |
| Sheets on mobile, side panels on desktop | Modals as a first resort |
| One authored motion moment per surface | Bounce, confetti, load choreography |
| Full labels (or honest short forms + tooltip) | Clipping labels into a different meaning ("diet break" → "diet") |

## 6. Testing

Interaction tests live in `src/components/__tests__` (slider keyboard/ARIA, key-bank roving
focus, dialog/sheet focus trap + Escape, stepper clamping) and `src/app/__tests__` (theme
switching, persistence round-trip). jsdom has no `showModal`/`matchMedia`/layout: the
components fall back gracefully (dialogs set `open`, media queries read false).
