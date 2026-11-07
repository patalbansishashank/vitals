# Vitals design system — primitives (Ember)

A quiet charcoal instrument you read in seconds. The look is Lumen Health's **Ember**, refined in r071: a
near-black backdrop with fixed fine grain and a faint warm-gold wash from the top right; charcoal cards with the same
grain, 0.5 px gold hairlines, 20 px corners and no shadows, a card optionally carrying one soft glow in its domain hue;
ivory text with stone secondary; gold for the primary action, the selection and the moment, ivory for where you are,
eight domain hues for data; Geist for text, titles and numerals and Geist Mono caps for facts, tabular numerals wherever
a value changes in place; a gold pill for the primary key and rounded-rectangle controls in the card's language. Dark
only — there is no light theme and no theme switch.

- Source of truth: `.e6-tmp/unslop/SPEC.md` (§2 type, §3 material, §5 components),
  `.e6-tmp/unslop/lumen.md` (exact Ember values) and `.e6-tmp/unslop/research.md` (copy rules).
  r071 (type, colour, surfaces, motion): `r071/SPEC.md` (the owner's decisions), `r071/RESEARCH.md` and `r071/AUDIT.md`
  in the research folder; `DESIGN.md` carries the Revision r071 block and `design/tokens.css` every value.
- **Living gallery: `/dev/components`** — every primitive, variant and state. The r071 cards, pictures and layout have
  their own sheets there (Cards · Ticks, tracks and bars · Lines, scales, stacks, windows · Restyled pictures · Rail, card
  grid, card library), built from `src/app/dev/specimens/`.
- Import everything from `@/components`. Shell APIs (header, ⋯ menu, banner slot) come from
  `@/app/shell`; route helpers from `@/app/paths`; local-data registry from `@/state/persistence`.

```tsx
import { Faceplate, Key, KeyBank, StatusCapsule, Readout, Notice, toast } from '@/components';
```

---

## 0. The foundation (r068, revised by r071) — what page fixers lean on

**Type** (r071; replaces r068 U10). Two self-hosted variable fonts, latin + latin-ext (`src/styles/fonts.css`;
packages `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`, exact 5.3.0): **Geist** (`--lm-font-sans`,
Tailwind `font-sans`) for text, labels, keys, chips, tables, chart ticks, titles and numerals, and **Geist Mono**
(`--lm-font-mono`, `font-mono`) for facts. Titles and numerals take `--lm-font-display` / `--lm-font-title` (Tailwind
`font-display`, `font-title`, class `.lm-display`): the same family, with its 600-weight fallback face.
`--lm-font-title` is the one switch point if a serif is ever approved (the owner said no, SPEC Q3). Every `h1`–`h4`
takes the display face. Weights: Geist is declared 300–600 and Geist Mono 400–600, so nothing is heavier than 600 (a
bold request lands on 600): 400 text · 500 labels, keys and mono meta · 600 titles and values · 300 only for numerals of
36 px and up, and that 300 comes only from the numeral roles' `--lm-text-<role>--wt` tokens (hero, num-l, num, time): no
stylesheet writes a 300 itself and `tokens.test.ts` fails if one does. Metric-matched fallback faces (`Geist Fallback`,
`Geist Title Fallback`, `Geist Mono Fallback`) keep the swap from shifting layout. The arrow glyph U+2192 is in neither
font: use an icon. Role tokens carry size / line / tracking / weight / family:
`--lm-text-{display,headline,title-l,title-m,page,card,hero,num-l,num,time,stat,unit,body-l,body,body-s,read,label,label-s,meta}`
with `--lh`, `--ls`, `--wt` and `--font` suffixes (e.g. `font: var(--lm-text-title-m--wt) var(--lm-text-title-m)/var(--lm-text-title-m--lh) var(--lm-text-title-m--font)`).
The uppercase sans role `--lm-text-section` is gone.

| Role | Size / line · weight · face |
|---|---|
| display (welcome headline) | 32/38 · 600 · Geist |
| headline (big values) | 28/34 · 600 |
| page (the top bar's title, every page) | 24/28 · 600 |
| title-l (section heading) | 20/26 · 600 |
| title-m (card title in a Faceplate, sheet title) | 17/24 · 600 |
| card (the `CardHead` title) | 15/20 · 600; 16/22 from 1024 |
| hero · num-l · num (proportional figures) | 64 · 52 · 44 px, line 1 · 300; 88 · 64 · 52 from 1024 |
| time (the Next-up clock, tabular) | 36 · 300 |
| stat (a secondary number, tabular) | 15/20 · 500 |
| unit (beside a number, stone) | 15 · 400 |
| body-l / body / body-s | 16/24 · 14/21 · 12/18 · 400 |
| read (explanation text, at most 62ch) | 15/23 · 400; 16/24 from 1024 |
| label / label-s (keys, segments / chips) | 14/20 · 12/16 · 500 |
| meta (mono caps) | 11/14 · 500 · Geist Mono, UPPERCASE, +0.08em; 12/16 from 1024 |
| group label (`.lm-group-label`: Settings, More) | 13/18 · 600 · sentence case |

**Numerals.** Tabular figures are on the root. Hero, wide and tile numbers are proportional (`.lm-num-prop`,
`--lm-num-pnum`), because tabular figures loosen "1,096" and "11:11" at display size. Whatever changes in place, aligns in a
column or reads as a clock (legend values, tables, ticks, the 36 px time) stays tabular. Reserve the final string's width
(`min-width`) during a count-up so the unit beside it never moves.

**Mono caps** (`.lm-meta`, `--lm-text-meta`: Geist Mono 500, UPPERCASE, +0.08em, 11 px, 12 px from 1024) is the ONLY
uppercase text in the product, for facts only: a date, a range, a unit, a state, a legend label, a time, a tick. Never
above a heading (the top bar's date line is the one exception, SPEC Q4). `<MonoMeta>` is the component (§3, Numbers and
facts); `.lm-meta` and the token are for CSS that has no component. The card, picture and layout stylesheets declare
uppercase only in `mono.css` (the `.lm-mono` class `MonoMeta` draws), and `r071Css.test.ts` fails if another does.

**Spacing** (U11, r071). One rhythm: `--lm-gutter` 16 px phone / `--lm-gutter-lg` 24 px from 1024 · `--lm-stack` 16 px
between page sections · `--lm-card-pad` 18 px phone / 24 px from 1024 inside a card · `--lm-card-gap` 12 px phone / 16
px from 1024 BETWEEN cards (a `CardGrid`, a `<Stack gap="card">` of cards) · `--lm-card-inner-gap` 12 px phone / 16 px
from 1024 INSIDE a card (head → body, block → block; the `Faceplate` head, `Section` and a flush card's head and foot
read it) · `--lm-row-gap` 8 px between rows · `--lm-inline` 8 px between items on a line. Radii: card `--lm-card-radius`
20 px, sheet and dialog `--lm-radius-xl` 24 px, banner, date row and sidebar row `--lm-radius-field` 14 px, selector
track `--lm-radius-track` 12 px, secondary keys, text fields, selects and steppers `--lm-radius-md` 10 px. `Faceplate`,
`Section`, `Rule` and `CardGrid` already use the spacing tokens; use the tokens, not raw px. The two card gaps are never
swapped: the card material reads no `--lm-card-gap` (a test in `tokens.test.ts` pins it).

**Layout** (U4/U5). No page has a max-width; pages fill the column beside the sidebar.
- `<Page stack?>` — the column with the gutters (`width="narrow"` is a deprecated no-op).
- `<Stack gap="page|card|row">` — one column, 16 / 12 (16 from 1024) / 8 px apart. The default page layout.
- `<Columns from="lg|md|xl" ratio="equal|wide-start|wide-end" align="start|stretch">` — an explicit
  two-column grid that is one column below `from` (default 1024 px). Use it only where two columns
  read better; put a `<Stack>` in each column.
- `<CardGrid items>` — metric cards in the person's own order: full width on phones/native Android and in narrow card
  areas, with 12 layout tracks on wide desktops. `<Rail>` is the day's stops on one spine.

**Selectors** (U2, r071). `KeyBank`, `LinkBank` and `TabList` fill the width they are given by default
(equal segments) in the card's language: a rounded-rectangle well (`--lm-select-radius` = `--lm-radius-track`, 12 px,
hairline) with segments 3 px inside (`--lm-select-key-radius` 9 px). The labels are mono caps (the meta role); the
selected segment is the gold tile (`--lm-select-on` gold wash, `--lm-select-on-edge` gold edge) with an ivory label.
Pass `fit` (or `block={false}`) only for a bank that must size to its labels (a unit toggle inside
a field row, a dense chart toolbar). A bank in a card head drops to its own full-width row under the
title. Sizes: `sm` 28 · `md` 36 · `lg` 44 px; every segment is 44 px under a coarse pointer, small banks included. In
the top bar and the action bar the segments take the bar height (`shell.css`, "one control height in the bars").

**Keys** (U8, r071). `primary` is a **gold pill**: 48 / 40 / 32 px for `lg` / `md` / `sm`, label 15/600 (12/600 on `sm`),
an optional arrow after it (`arrow`, or `trailingIcon`: 18 px at stroke 2.25 on a primary; always an icon, because the
arrow glyph U+2192 is in neither Geist file), the corner `--lm-key-radius` (24 px: a full pill at those heights, not a
stadium when a block key's label wraps). Hover `--lm-signal-hover`, press scale .98, disabled a `--lm-raised` pill with a
pale-stone label. Every other key stays a rounded rectangle (`--lm-control-radius` 10 px; 8 px `sm`, 12 px `lg`);
icon-only keys stay round. `outlined`/`default` is the neutral tile (6 % ink fill, 1 px strong hairline, ivory label), the
ordinary button · `action` gold label on a 16 % gold tile · `text` gold label with a hover tint (in a card head or foot it
takes the action tile, so a card's main action never reads as loose text) · `danger` rose label on a rose tint. For a
main action that sits in a page body, use `primary` (one per view) or `outlined`, not `text`. `RunKey` is the same gold
pill shape (40 / 48 px, label 14/600).

**Chips** (U12, r071). Pills. A read-only `Chip` is a 22 px tag (6 % ink tint, stone 12 px label, no border);
`kind="status"` is only its dot and words; `kind="domain"` is a tag with a 6 px dot in the domain's solid (`domainColor`)
and stone words; pressable chips (`filter`, `onClick`, links) are 28 px pills with a hairline so they read as controls,
and 48 px under a coarse pointer below 768 px. Prefer fewer tags: a fact in a caption or a visual mark usually reads
better than a chip.

**Scrollbars** (U6/U7). None on touch, in the Android app or under 768 px. On desktop every inner
scroller has a thin thumb (`--lm-scrollbar-thumb`) on a transparent track; the page itself has no
native bar (Chromium paints its track as a flat black strip) and the shell draws an overlay thumb
instead (`src/app/shell/OverlayScrollbar.tsx`).

**Sidebar key** (U13). In the sidebar's own head, at its right end (expanded) or as the rail's
top key (collapsed: the mark, the expand icon on hover). Ctrl/⌘ + B as before. Not in the top bar.

**Navigation** (U14, `src/app/shell/nav.ts`, `modeNav.tsx`). Stable, never per page:
- Desktop sidebar: one list in labelled groups, the same in both modes — Today · Food · Train
  (Activities without a plan) · Ring · Progress / *Your plan*: Plan details / *Planning*: Body ·
  Simulate · Plan · Coach / *Library*: Evidence — and Settings alone at the foot. A place that
  needs a plan (Food, Plan details) is left out without one, never moved. The current row is a
  9 % ivory tint with an ivory icon and a 600 label (r071: no gold, no side stripe).
- Phone dock: five labelled keys — Living Today · Food · Train · Ring · More; Planning Today ·
  Plan · Ring · Activities · More (Plan stands for Body · Simulate · Plan and lights on each). The
  current key is an ivory capsule with a dark icon and a 600 label, drawn by one gliding thumb
  (r071); labels are 12 px.
- `/more` (`MorePage`): every place the dock has no key for, as grouped settings-style rows.
- The header ⋯ holds the page's own actions only (`<TopBar menu>`); with none, there is no ⋯.
  Never put a destination in it.

**Dialogs, toasts, disabled keys** (U8). Dialog keys are real keys (Cancel the neutral tile, a
destructive verb a filled danger key; stacked full width on phones, where the dialog sits at the
bottom edge). `toast()` shows a leading status icon (`icon`, default a gold check; `null` for
none) and sits at the content column's bottom-right on desktop. A disabled key keeps its own
shape at 42 % opacity.

**Motion** (U9, `src/app/motion.ts`). Lenis smooth scrolling on desktop fine pointers (website and
desktop app; never touch, Android or reduced motion). GSAP entrances: AppShell runs
`usePageEntrance` on every page change (cards `.lm-face`/`.lm-material` and `[data-enter]` in view
rise 10 px and fade in over 420 ms, staggered 35 ms; cleared after). For content that swaps in
place use `useEnter(ref, deps)`; imperative `enter(elements, { y, stagger, delay })`;
`data-motion="none"` opts an element out; `scrollPageTo(y, { immediate })` scrolls through Lenis;
`motionAllowed()` / `smoothScrollAllowed()` tell what may run. Everything is a no-op in jsdom and
under reduced motion (OS or Settings), and the libraries load lazily. The pictures' hooks (r071) are in §3.

**Domain colour, the card and the glow** (r071). Eight hues on one fixed wheel (heart, energy, food, steps, recovery, body,
sleep, videos) plus gold for the plan, each with four tokens: `--lm-hue-<domain>` (the solid, for marks), `-ink` (the soft
tint for text on a glow), `-deep` (the glow core only) and `-dim` (the unlit remainder). The types are in
`src/components/domain.ts` and come from `@/components`: `Domain` is the eight names plus `plan` and `neutral`, and
`DomainName` is `Exclude<Domain, 'neutral'>` (what `<Swatch domain>`, `<Chip kind="domain">` and `<DateControl domain>`
take). `domainColor(d: Domain)` returns the solid, `var(--lm-hue-energy)` for `energy` (`plan` is gold, `neutral` ivory),
beside `categoryColor`; `domainToken(domain, role)` gives the `solid`, `ink`, `deep` or `dim` one. The hues are hex on
purpose: the tests and the Android widgets parse them, and the widgets' palette (the eight hues with their four steps, each
card's glow, the card corner) is generated from the real `--lm-hue-*` and `--lm-glow-*` tokens by `pnpm android:design`
(`scripts/android-design.mjs`): after changing one, run it and commit the result (`androidDesign.test.ts` fails otherwise).

There is ONE card recipe. `data-domain` on a card (or on any element, for the variables alone) and `data-hue` on a picture
or a number are wired in `src/styles/components.css` ("domain wiring", "the glow") and nowhere else. They set `--lm-hue`,
`--lm-ink-h`, `--lm-deep`, `--lm-dim` and `--lm-tone-2` (the secondary text colour on that card) and, for a card, the
glow's inputs `--lm-glow-pos`, `-size` and `-a`. `Faceplate` (`.lm-face`), `.lm-material`, `.lm-card` and `GradientCard`
(`.lm-material`) draw the same material; `src/components/card.css` only lays out a `GradientCard` (head, body, foot, the
open link, `data-glow`, `data-reveal`), and `domain.css` and `foundation-fallback.css` no longer exist. A card opts into its domain
with `data-domain="energy"` on a `Faceplate`, `.lm-material` or `.lm-card`, or with `<GradientCard domain="energy">`: one
soft glow in that hue (one eased radial gradient in oklab over the grain, never a second gradient layer, never animated:
it fades in once; on a plain `Faceplate` or `.lm-material`, `data-glow="pending"` holds it at 0 and `data-glow="off"` switches it off),
and the variables its marks read. `--lm-glow-k` (0 to 1) scales or switches off every glow (no user setting). Text never
wears the solid; ivory text and marks are safe on any glow, small stone text and solid marks stay out of its core. A
banner (`Notice`) takes the card material with no glow. Gold marks the action, the selection and the moment and is no
longer a data colour; ivory marks where you are. The eight hues are never plotted together (all pairs fail the
colour-vision gates): a chart with several series uses a set derived from them (`--lm-stage-*`, `--lm-intensity-*`,
`--lm-hr-zone-1…5`, `--lm-macro-*`) or the category palette. The recipe is `design/COMPONENTS.md` §16; the components
that draw it are in §3 below (Cards, Numbers and facts, Pictures, Layout) and in `design/COMPONENTS.md` §18 to §20.

**Chrome** (r071). The top bar's title is the page role (24/28 600, one line; SPEC Q2: no large collapsing title) and its
`subtitle` is ONE fact in mono caps drawn ABOVE the title (SPEC Q4; the h1 stays first in the DOM and `order` draws the
date first; a phone tab page gives it its own row, so that bar is 66 px and every other 56 px). Pass the short form where a
`DateControl` follows ("Day 15 of 84"). The dock's current key is an ivory capsule with a dark icon and a 600 label, drawn by
ONE thumb (`.lm-tabbar__thumb`, `--lm-tabbar-i`) that glides to the pressed key by transform in 280 ms with the one damped
overshoot and jumps under reduced motion. The sidebar's current row is a 9 % ivory tint (14 px corners). Ivory is where you
are; gold is what you can do or chose. `DateControl` takes an optional `domain` (its calendar icon and the dots of days that
hold data wear that hue); its dates are mono caps, its row has the field radius (14) and its styles are
`src/features/living/components/dateControl.css`.

**Overlays** (r071). `Sheet` and `SidePanel` open on a spring (`--lm-ease-spring`, a damped oscillator sampled for
`linear()`: 320 ms, one 2.5 % overshoot, behind `@supports (transition-timing-function: linear(0, 1))`) and leave in 220 ms
ease-in; a hard 0-blur colour extension past the screen edge hides the overshoot gap (not a shadow); the scrim fades in
200 ms. Under reduced motion (the OS setting or Settings › Motion "reduce") sheets, panels and dialogs do not move: they
cross-fade in 100 ms (`REDUCED_EXIT_MS` in `lib/overlay.ts`). Sheet and dialog corners are 24 px. Focus returns to the
opener when a Sheet, a SidePanel or a Dialog closes (`useRestoreFocus`, `lib/focus.ts`: the opener is captured once per
opening, the restore retries for 1.5 s, a host that closes by unmounting still gets its focus back, a replaced opener
is found again by its id or its parent, and a sheet that closes as the next one opens hands its opener to it, so closing
the second goes back to the first's opener however long it was open). Under a coarse pointer fields, selects, steppers, switch rows, check rows, the
slider band and every bank segment are 44 px.

**Picture motion** (r071, `src/app/motion.ts`). `useInView`, `useCountUp`, `useSweep`, `useDrawIn`, `useGrow`, `usePulse`,
`useFlip` and `fadeCue`, with the `MOTION` and `EASE_OUT` constants (§3, Motion hooks). State, not decoration: every hook
returns its FINAL state on the first render wherever `motionAllowed()` is false. The cards and pictures use these shared
hooks and keep no motion code of their own (`useInView` for the first view, `useCountUp` in `HeroNumber`, `useFlip` in
`CardGrid` and `CardLibrary`, `enter` and `fadeCue` for an added card); `@/components` exports no hook, so import them from
`@/app/motion`. `.lm-live` is the live mark (a 10 px ivory dot with two rings that pulse twice, 4.8 s, then stop).

---

## 1. Tokens — the rules

| Need | Use | Never |
|---|---|---|
| Surfaces | `--lm-chassis` #090909 (page, under the grain) · `--lm-chassis-2` #11100F (sheets, side panels) · `--lm-face` #1B1916 (cards) · `--lm-well` #11100F (fields, inset wells, the segmented track) · `--lm-raised` #22201C (card-soft: disabled keys, grade badges, meter tracks) · `--lm-elevated` #2B2721 (dialogs, menus, toasts, tooltips) | white/black hex, Tailwind palette colours |
| Text | `--lm-ink` #F5F1E9 · `--lm-ink-2` #C3BCB0 (secondary, units, dates) · `--lm-ink-3` #AAA296 (tertiary, inactive icons) · `--lm-ink-faint` disabled only | grey hex values |
| Lines | `--lm-line` (0.5 px hairlines, card edges) · `--lm-line-strong` (field and outlined-key edges) | dashed lines unless they mean something, header dividers |
| Gold | `--lm-signal` #E3BF78 for the primary key (a pill), text keys, the selected segment, the "now" and state dot, focus; text on gold is `--lm-signal-ink` #090909 · `--lm-gold-wash` (selected segment / pressed key fill) · `--lm-gold-soft` (selected list row) | body text, large fills, decoration, a data series |
| Ivory (where you are) | `--lm-nav-on-bg` / `--lm-nav-on-fg`: the dock's current capsule; the sidebar's current row is `--lm-ink` at 9 % | gold on the current destination |
| Severity | `Notice`, `InlineWarning`, `StatusMark`, `Chip kind="status"`, `StatusCapsule tone` (its dot) — info / ok are quiet neutrals, caution is gold, danger is muted rose | blue info icons, coloured banners, coloured side stripes |
| Domain colour | `domainColor('energy')`, `<Swatch domain>`, `var(--lm-hue-<domain>)` (solid, for marks) · `-ink` (soft tint for text on a glow) · `-deep` (the glow only) · `-dim` (unlit remainder); inside a `data-domain` card or a `data-hue` picture `--lm-hue`, `--lm-ink-h`, `--lm-deep`, `--lm-dim`, `--lm-tone-2` (secondary text) | a solid as a text colour, plotting the eight together |
| Metric colour | `categoryColor('fuel')`, `<Swatch category>`, `var(--lm-cat-*)` (five alias a domain solid; fuel, cellular and hormones stay warm), `--lm-macro-*`, `--lm-stage-*`, `--lm-intensity-*`, `--lm-hr-zone-*`, `--lm-balance-*`, `--lm-plan-*` (never colour alone — keep labels) | colour by rank, generated hues |
| Depth | tone + hairline + grain. `--lm-shadow-*` are `none`; a `data-domain` card adds one soft glow, which is colour inside the card | shadows, bevels, blur on cards, a second gradient layer, a glow behind small text |
| Grain | `--lm-grain` / `--lm-grain-size` — the page backdrop and the card material only (`.lm-face`, `.lm-material`); a domain card paints its glow over the card grain | grain or gradients on anything else |
| Motion | `--lm-dur-instant/fast/base/slow/needle`, `--lm-ease-*`; for pictures `--lm-dur-count/draw/glow/bars/fill`, `--lm-stagger-tick/bar`, `--lm-dur-spring/exit/glide`, `--lm-ease-spring/in`, through the hooks in `src/app/motion.ts` | bounce, decorative entrances, animating layout or a gradient |

- Component CSS lives in `src/styles/components.css` (`lm-*` classes, tokens only).
- Numbers: `formatNumber(2540)` → `2 540`, `formatSigned(-4.4)` → `−4.4` (true minus),
  `formatRange(18.6, 21, 1)` → `18.6–21.0`. Tabular wherever a value changes in place (`.lm-num`, the
  root default; hero, wide and tile numbers are `.lm-num-prop`); units inline after the value, smaller
  and stone (`.lm-unit`): `72.4 kg`, `6 420 steps`.

### Type roles (SPEC §2, r071) — classes in `components.css`

| Role | Size / line, weight | How |
|---|---|---|
| Display — the welcome headline only | 32/38, 600, Geist | `text-display` (`--lm-text-display`) |
| Page title in the top bar (every page) | 24/28, 600 | `.lm-title` (TopBar renders it; on a phone's pushed page the bar steps it to title-m beside Back) |
| Headline — big values | 28/34, 600 | `.lm-headline`, `<Readout>` |
| Title-l — section heading | 20/26, 600 | `.lm-title-l` |
| Title-m — card heading | 17/24, 600 | `Faceplate title`, `.lm-h3` |
| Hero · number-l · number — big numerals | 64 · 52 · 44 px, 300, proportional (88 · 64 · 52 from 1024) | `text-hero`, `text-num-l`, `text-num` with `.lm-num-prop` |
| Time (the Next-up clock) | 36, 300, tabular | `text-time` |
| Stat · unit | 15/20, 500, tabular · 15, 400, stone | `text-stat`, `text-unit` |
| Body — default UI text | 14/21, 400 | (body default) |
| Fact line in the top bar (the date) | mono caps 11/14 (12/16 from 1024), 500, stone, one line, above the title | `<TopBar subtitle>` (`.lm-ctx__sub`) |
| Facts anywhere else (a range, a unit, a state, a legend label, a time) | mono caps, the same role | `.lm-meta`, `text-meta` (`--lm-text-meta`) |
| A fact beside content (the Results horizon) | 14/21, 400, stone | `.lm-fact` |
| Body-s — secondary lines, captions | 12/18, 400, stone | `.lm-eng` / `<Engraved>`, `.lm-body-s` |
| Label — buttons / label-s — chips | 14/20 · 12/16, 500 | `Key`, `Chip` |
| Group label over a settings-style card (Settings, More) | 13/18, 600, sentence case, stone | `.lm-group-label` |
| Muted / link | stone · gold, underlined | `.lm-muted` · `.lm-link` |

**Eyebrows are banned.** A line beside a heading exists only if it states a fact (a number, a
date, a state), and facts are mono caps: the only uppercase text in the product, never above a heading except the top
bar's date line. Weights in use: 300 (numerals of 36 px and up only), 400, 500, 600. No `font-stretch`, no width axis.

---

## 2. Layout patterns

- **Page column** — `<Page>` gives the page gutters; no max-width (r068 U5).
- **Card layout** — `<Stack>` (one column, 16 px apart) by default; `<Columns>` only where two
  columns read better (see §0). Give grid children `min-w-0`. A page of metric cards is a `<CardGrid>` in the person's
  order (§3, Layout), not a `Columns` of stacks; a day's stops are one `<Rail>`.
- **Never nest cards.** Inside one, structure with `<Section label>`, `<Rule>`, `<KeyValueList>`,
  `Notice layout="ruled"` (plain text) and spacing. A list of similar items becomes rows, not cards.
- **Mobile strips** — `<ScrollRail>`: snap, scroll-padding = gutter, the next cell peeks.
- **Sheets vs panels** — below 1024 px editors and explanations are bottom **Sheets** (detents
  35 / 60 / 92 %); from 1024 px **SidePanels** (392 px overlay; the page reflows beside it, no scrim unless `scrim` opts in for a panel over prose or cards), docked in-flow at
  ≥ 1280 px. `<ResponsivePanel>` chooses. **Dialog** only for destructive confirmation, import
  preview and first-run consent.
- **One ⋯ per screen** (the shell's header menu). A per-row ⋯ (`Menu`) only on object rows with
  two or more item actions; never a key and a ⋯ that open the same sheet. The ⋯ holds the page's
  own actions, never a place: places live in the dock and its More page (phones) and the sidebar
  (desktop), which list the same places. A focused flow that hides the dock keeps a way out in its
  header (`<TopBar back={{ close: true, label: 'setup', to }} />`: ✕ "Close setup"). The three
  planning steps' headers carry the Body · Simulate · Plan switcher below 1024 px on their own.
- **Floating layers** keep the page gutter from the screen's edge on phones (16 px), so a menu's
  edge lines up with the cards under it.
- **Notices** — one banner at a time in the shell's slot under the header; plan events are a
  `StatusCapsule` icon in the header; feedback on the person's own action is a `toast`. Nothing is
  injected between content sections.
- **Density** — touch: 44 px targets (48 on icon keys; fields, selects, steppers, switch and check rows, the slider band and every bank segment are 44; a chip that acts is 48 below 768 px). Pointer: 32 px minimum.

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
- **`Faceplate`** (the card) `variant="plain" | "inset" | "flush"`, `title` (title-m, sentence
  case), `caption` (**facts only** — a number, date or state; rendered under the title as body-s
  stone), `actions` (text keys, action pills, a segmented control), `footer`, `as`; any other attribute passes through, so
  `data-domain="energy"` opts the card into its domain glow (§0). Card material, 20 px corners, 18 px padding (24 on
  desktop), no header divider, no shadow.
- **`.lm-material`** — the card material (grain, wash, hairline, 20 px corners) without padding,
  for composite surfaces (settings groups, rows on a card surface); it takes `data-domain` too.
- **`FaceplateHeader`**, **`Rule`** (0.5 px hairline), **`Section label aside`** (14/500 label, no
  trailing rule), **`Stage`** (plain well; no dot grid), **`KeyValueList items`**, **`Engraved`**
  (body-s stone caption), **`Page`**, **`ScrollRail`**, **`VisuallyHidden`**.
- **Faceplate or GradientCard?** They draw the same material (`.lm-face` and `.lm-material` share one rule in
  `components.css`, with the same domain wiring and glow), so a `Faceplate` with `data-domain` and a `GradientCard` look
  alike. `Faceplate` stays the plain titled card (title, fact caption, actions, footer) for sections, forms, tools and
  every page that is not a metric card, and its markup does not change. `GradientCard` is the metric card: it adds the
  icon · title · (i) head, the foot, one whole-card open target and the glow's fade-in on first view. Never put either
  inside the other.

### Cards (r071)
`GradientCard`, `CardHead`, `InfoKey`, `InfoPanel`, `CardFoot` and `StateWord`, all from `@/components`. Specimens:
`/dev/components` › Cards. Entries: `design/COMPONENTS.md` §18.
- **`GradientCard`** `domain size variant glow head foot href | onOpen openLabel as animate`; any other `<article>`
  attribute passes through. It renders `class="lm-material lm-gcard"` and is labelled by its title.
  - `domain`: a hue, `plan` (gold) or `neutral` (the default: the gold-wash card, no glow). `size`: `hero` and `slim` fill
    a row, `card` (default) is half a row from 1024 px, `tile` a quarter (`CardGrid` reads the same word; `slim` lays the card out as
    one row). `variant`: `plain` (default) · `inset` (a flat well, no glow) · `flush` (no padding, for a chart or raster
    that bleeds).
  - `glow` moves the glow, never resizes it: `tl`, `tr`, `bl`, `br`, `bottom`, `none`, or `{ pos, size, a }`. Its state is
    on the card: `data-glow="tl|tr|bl|br|bottom|none|custom"` for the position (or off), and `data-reveal="pending"`
    while it waits for its first view. `animate` (default true) fades the glow in once at 20 % in
    view (900 ms); false, reduced motion and tests draw it at once.
  - `href` or `onOpen` (with `openLabel`): the whole card opens through its title, a stretched link or button; the (i),
    keys and fields sit above it. `as`: `article` (default), `section`, `li`, `div`.
  - `T`, with focus in the card (not in a field or a panel) and a `twin` in its head's `InfoSpec`, opens the (i) panel at
    the table.
- **`CardHead`** `icon title info meta as="h2|h3"`: the domain-hued icon (18 px), the title (one line, 15/20 600) and, at
  the right, the (i). Nothing else belongs in a head: no Details, Open or Table key. `info` is an `InfoSpec`; without it
  there is no (i). `meta` is a `MonoMeta` before the (i) for a live fact (LIVE, REC).
- **`InfoKey`** `label onClick expanded`: the (i): a 28 px circle (`--lm-info-size`) with a 48 px hit area
  (`--lm-info-hit`), filled `--lm-info-key-bg` (7 % ivory; `--lm-info-key-bg-hover` 13 %) with a `--lm-info-key-edge`
  hairline (14 %). It names itself "About {title}" and opens a dialog. These are its own tokens:
  `--lm-info-fg/-bg/-edge/-mark` are the "info" severity's (a notice), and a test fails if a token is declared twice.
- **`InfoPanel`** and **`InfoSpec`** `body source range terms evidence explain twin footer title`: what the (i) opens, a
  sheet below 1024 px and a 392 px side panel from it (`ResponsivePanel`; `dockAtXl` docks it from 1280). The text is what
  used to be subtext: plain, second person, 25 to 60 words. In order: the reading text (`body`, 15/23, at most 62ch; a
  node, or sections with headings), "Where this comes from" (`source: { kind, words }`, kind `ring | phone | estimate |
  logged | plan | engine`), "Range", `terms`, `evidence` (links to `/evidence`, with the grade), `explain` (the Explain
  content, passed as a node: this layer never imports features) and the "Data table" (`twin`: a `<ChartTwin data={…} />`).
  The panel commits nothing, so its one way out is the ✕; a `footer` action ("Remove from Today") is allowed.
- **`CardFoot`** `state right link children tone` and **`StateWord`** `word icon tone ink`: the foot. A state word on the
  left (a 6 px dot in the card's hue, or an `icon`, then the word in mono caps; `tone` `neutral | caution | danger`: never
  colour alone), the range or goal on the right (`right`, mono), optionally the card's one navigation (`link: { to |
  onClick, label }`, a small text key) and its one control (`children`: a `KeyBank` or one key). `tone="ink"` makes the
  foot ivory, for a foot that sits in a glow's core (a bottom glow). It replaces the Faceplate footer and the fact lines
  ("Goal met"), and renders nothing when it has nothing.

```tsx
import { Footprints } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, HeroNumber } from '@/components';

<GradientCard
  domain="steps"
  size="tile"
  head={<CardHead icon={Footprints} title="Steps" info={{ body: 'Steps counted today, from your phone.', source: { kind: 'phone' } }} />}
  foot={<CardFoot state={{ word: 'On plan' }} right="Goal 9 000" />}
>
  <HeroNumber value={7605} size="num" label="7,605 steps" />
</GradientCard>
```

The rules of a card: one hero number, its unit small and muted beside it; facts in mono caps; one glow, in the card's
domain hue (it says what the card is about, never how much); ivory text and marks on the glow, small stone text and solid
marks out of its core; gold only for the action, the selection and the moment (the foot's link, the primary key), never as
a data colour; a head of icon, title and (i) and nothing more; no card inside a card. A picture inside a `GradientCard`
wears the card's domain without a `hue` prop.

### Numbers and facts (r071)
- **`HeroNumber`** `value | parts size unit unitPlacement range numerals countUp format decimals quietWord hue label
  animate roll`: the one big number of a card: Geist 300 with proportional figures, the unit small and muted beside it.
  `size`: `hero` 64 px (88 from 1024) · `num-l` 52 (64) · `num` 44 (52) · `time` 36 (a clock, tabular) · `stat` 15/20 at
  500 (a secondary figure, tabular); `numerals` follows the size. `value` is a number (it counts up from 0 over 1.1 s on
  first view and from the shown value over 0.4 s on a change; on by default for `hero`, `num-l` and `num`, off with
  `countUp={false}`), a string ("16:30", "Weigh in": drawn as it is) or `null` (a dash). `parts` draws "7 h 56" with each
  piece counting on its own; `range` is the likely range under the number (required for an estimate: a pair reads "Likely
  lo–hi"); `unitPlacement="below"` puts the unit under the number; `roll` is a figure that ticks in place (a live
  readout): the digits that changed roll in and it never counts up; `quietWord` replaces every digit with a word, and
  `null` draws nothing. `label` is the final spoken value ("1,096 kilocalories"): the root is `role="img"` with that
  label and the digits are hidden from assistive technology, so nobody hears 0 to 1,096. The final width is held while it
  counts, so the unit never moves, and the settled markup is the static one (`animate={false}`, reduced motion and tests
  draw the final number at once). `Readout` draws its figure and unit as a `HeroNumber`. `RollingNumber` (its own module,
  `src/components/RollingNumber.tsx`, still exported from `@/components`) is what rolls the digits for `roll` and a clock.
- **`MonoMeta`** `items tone size as`: a fact in mono caps (Geist Mono 500, UPPERCASE by CSS so the DOM stays sentence
  case, +0.08em, 11 px, 12 from 1024). `items` joins several facts with " · " drawn by CSS; `tone` is `muted` (stone, the
  default), `ink` (ivory) or `hue` (the card's tint, `--lm-tone-2`); `size="sm"` stays 11 px. Only for facts (a date, a
  range, a unit, a state, a legend label, a time, a tick); never above a heading, never a sentence.
- **`StatusDot`** `tone label pulse hideLabel`: a 6 px dot and its word in mono meta, which replaces the dot-and-word
  chips. `tone`: `live` (gold, "now") · `ok` · `caution` · `danger` (the severity marks) · `neutral` (stone); a status is
  a mark plus a word, never colour alone. `pulse` breathes the dot (opacity 1 to 0.35, 1.1 s) only while a real process
  runs (a recording, a running fast) and does not breathe under reduced motion; `hideLabel` keeps the word for assistive
  technology only.

### Pictures (r071)
`/dev/components` › Ticks, tracks and bars; Lines, scales, stacks, windows; Restyled pictures. Entries:
`design/COMPONENTS.md` §19. Every new picture follows one contract: it takes `hue` (overrides the card's domain colours
for that picture; without it a picture wears the card's; `StackBar` and `WindowBar` accept it but nothing in them reads
it), `animate` (default true: a reveal on first view, 20 % in view; false draws the final frame), `quiet` (no digit in
the DOM or in aria: words only) and `twin` (a "Table" key and the table under the picture; on a card the (i) panel
usually hosts it instead, as `<ChartTwin data={radialTwin(props)} />` in `InfoSpec.twin`); it is one `role="img"` or
`role="meter"` named by one sentence; and it exports a pure model, a `spoken…` sentence and a `…Twin` function from
`@/components`. A picture reveals through CSS states keyed on `data-reveal="pending"`, set while `animate` is on and the
picture is not yet in view and absent wherever motion cannot run, so the final markup is the static markup. Focal marks
(the line, its end dot, lit ticks, the thumb) are ivory; the hue lives in the card's glow and in secondary marks.
Unknown is never zero: a missing value is drawn as nothing (no lit ticks, thumb, marker or bar) and the sentence says it
is unknown.
- **`RadialTicks`** (`radialModel`, `spokenRadial`, `radialTwin`): one reading in a bounded scale, or progress to a goal,
  as a ring of ticks lighting clockwise from 12 o'clock (72; 60 under 120 px; 24 at `xs`). `label`, `value`, `goal` with
  `goalKind` (`target | floor | limit`), `max`, `mark`, `band` (the likely range), `size` (`xs` 28 · `sm` 72 · `md` 120 ·
  `lg` 160, or any px), `count`, `fractional`, `lap2` (past the goal a second lap of inner dashes in the ink tint; never
  for a `limit`), `parts` (arcs with 8° gaps: the Day score), `centre` (a `HeroNumber` and a `MonoMeta`), `state`
  (`normal | learning | stale | none | loading | provisional | zero | unknown`). A screen carries one ring; the rest of
  the page uses the linear pictures.
- **`DottedTrack`** (`trackModel`, `spokenTrack`, `trackTwin`): progress toward a goal, one number, as dots (8 px pitch)
  with a 14 px ivory thumb. `label`, `value`, `goal`, `goalKind`, `valueText` (required) and `goalText`, `from` and `to`
  (a plan's days 0 to 84), `band`, `ghost` (the planned position), `marks`, `endLabels`, `litB` and `valueB` (a second
  tone), `hue` (tints the lit dots, never the thumb), `state` (`normal | provisional | unknown | loading`). Past the goal a
  second lap lights again from the start in the ink tint.
- **`HighlightBars`** (`barsModel`, `spokenBars`, `barsTwin`): a daily series, today in the domain solid and the other
  days in its ink tint at 40 %, bars at most 20 px wide. `dates`, `values`, `name` (required), `goal` (a hairline: it never
  recolours a bar), `average`, `highlight` (`'last' | index | null`), `stacks` with `limit`, `outline` (a dashed partial
  day), `variant="spark"`, `onScrub`. One tab stop: arrows, Home, End, Escape.
- **`GlowLine`** (`lineModel`, `spokenLine`, `lineTwin`): a value that moves over time: an ivory 2.25 px line with an end
  dot that, given `now`, pulses twice and stops. `label`, `series` (points `{ t, v }` or bare numbers; null breaks the line), `now`,
  `future` (the dotted projection), `band` (a flat wash, or `'iqr'`), `reference`, `spans`, `marks`, `xTicks`, `yTicks`,
  `endDot`, `smoothing` (`fine | night | spark`), `variant` (`full | spark`), `state`. Hover or focus reads a point;
  the keyboard walks them.
- **`RangeScale`** (`scaleModel`, `spokenRange`, `rangeTwin`): one reading against a range: 41 ticks (17 inline), the
  ticks of the person's `usual` range lit in the hue, a 3 px ivory marker. `label`, `value`, `min`, `max`, `bands` (each a
  `word` and a `severity`, always a mark and a word), `usual`, `unit`, `endLabels`, `size` (`full | inline`), `state`
  (`normal | stale | calibrating | none`).
- **`StackBar`** (`stackModel`, `spokenStack`, `stackTwin`): one whole in parts, as one 10 px bar (6 px at `sm`) with 2 px
  gaps and a legend that names every part. `label`, `rows` (the `ShareBar` rows: `id`, `label`, `valueText`, `share`, a
  token colour in `hue`), `total`, `size`, `legend` (`below | inline | none`).
- **`WindowBar`** (`windowModel`, `spokenWindow`, `windowTwin`): when something happened against when it usually does:
  `axis` (two instants), `usual` (a hairline band), `actual` (a solid ivory bar), `marks`, `tz`.
- The restyled pictures keep their API and gain additive props: **`Hypnogram`** `legend` (stage totals), `hatch` (a 45°
  texture per stage, the `chartPatterns` setting), `sessions` (a night in parts on one axis), `animate`; **`StateStrip`**
  `hue` (the ordinal ramp as four steps of a domain), `stateHues`, `labels` (the word inside each segment wide enough),
  `animate`; **`Stat`** `hue` (a 6 px dot by the mono-caps label); **`ShareBar`** `animate`; **`TwinTable`** and its
  `TwinKey` (a text key with the table icon; the table's markup is frozen). They are drawn from `viz.css`, which keeps its
  old contract; the seven new pictures have stylesheets of their own (`radial`, `track`, `bars`, `glow`, `scale`,
  `stack`, `window`, with `viz-base.css` beside them).

### Layout: Rail, CardGrid, CardLibrary (r071)
`/dev/components` › Rail, card grid, card library. Entries: `design/COMPONENTS.md` §20.
- **`Rail`** `timeAt="start|end" label`, **`RailRow`** `time node title meta trailing onOpen highlight` and
  **`RailNode`** `status segments lit glyph hue number size label onPress`: a day's stops (Today's plan, Food's meals,
  Train's exercises) on one hairline spine: a time (mono, tabular), a node, the stop (16/500) with its facts in `meta`
  (mono caps, several joined with " · "), and keys at the end (`trailing`). The node is a 28 px ring (`size={44}` for a
  44 px one) inside a 44 px press target: `status` `empty` (a ring) · `done` (a gold disc whose check draws itself) ·
  `partial` (half gold) · `skipped` (struck) · `assumed` (dashed: filled in for you); `segments` (2 to 12) draws one ring
  segment per set, `lit` of them gold; `onPress` makes the node a button, otherwise it is an image with the same `label`.
  `onOpen` makes the title a button whose target is the whole row, with the node and `trailing` above it. A rail where
  no row has a time drops the time column; `timeAt="end"` is the list-card form. Gold marks done; a hue only tints a
  glyph.
- **`CardGrid`** `items cols label equalRows editor keyboardEditing`: cards in saved DOM order. Omit `editor` in
  normal mode; ordinary links, information controls, text selection and charts then retain their normal interactions.
  Today supplies it only through the existing three-dot **Edit cards / Done editing cards** action. Editing reserves
  each editable card's content for dragging; wide desktop cards also expose a bottom-right resize corner. The hero
  remains locked. Leaving editing cancels any pending gesture, including its trailing click.
  Phones, native Android (including landscape), and narrow card areas display every card full width without resizing.
  Saved desktop widths are retained, not rewritten to match the phone. `node` may be a React node or a callback receiving
  the effective content size; use the callback for an expanded phone presentation of a saved desktop tile. Desktop
  `cols` hints do not override the mobile policy. `hero | wide | card | tile | slim` remain valid stored sizes.
  `equalRows` makes adjacent cards share height; null-rendering choices take no space. The gap is `--lm-card-gap`.
  `packRows` remains a separate greedy utility with optional widening; the component preserves explicit desktop widths.
  Add/remove/reorder/resize transitions use the existing motion and reduced-motion contracts.
- **`CardLibrary`** `open onOpenChange title items selected onChange onReset max quiet copy defaultSelected sizeLabels
  renderRowAction dockAtXl startAt`: the "Add a card" panel, to reorder, add, remove and size the cards a page shows.
  Every change applies at once, so its header is title · ✕. A bottom sheet on phones (60 and 92 % detents), a 392 px side
  panel from 1024 px. `items` are `LibraryItem`s (`id label hue group` and optionally `icon description preview sizes
  default locked unavailable valueText calibrating`); `selected` is `{ id, size? }[]` in order, and the hero (a `locked`
  item: always first, never stored) is left out of it. Rows have a 48 px grip, a hue dot and icon, the label with its
  one-line description, a size toggle where a card has more than one size and a 48 px remove key; the Add list is grouped
  by domain, with a search field above ten cards (`SEARCH_ABOVE`), and a card that cannot be had now is listed greyed with
  its reason. The foot reads "Showing 6 of 29" and Reset. Keyboard: Space picks a row up, arrows, Home and End move it,
  Space drops, Escape cancels, and a polite live region says where it went; pointer: drag the grip. `MonitorSheet` is a
  thin wrapper over it (`variant="monitor"`) for the Ring's Signals card.
  Today uses `organize={false}` and mounts this library only while editing: **Add a card** is hidden in normal mode;
  direct grid gestures handle order and desktop width. Today selection/order/widths belong to this device, not shared
  settings. Do not reintroduce a second Edit entry point or normal-mode editing sensors.

### Keys
- **`Key`** `variant`, `size="sm|md|lg"` (32 / 40 / 48), `icon`, `trailingIcon`, `arrow`, `shortcut`,
  `pressed` (gold wash + gold edge, aria-pressed), `loading`, `block`, `disabledReason` (stays
  focusable, explains why — prefer it over `disabled`). The primary is a gold pill (`--lm-key-radius`); every other key is
  a rounded rectangle (10 px; icon-only keys are round); no bevels or shadows; hover brightens, press scales .98.
  `arrow` is `trailingIcon={ArrowRight}` for a primary ("Log snack →"): use it where the key goes on or adds, not on
  every key; the glyph U+2192 is never used. `KeyLink` = router link with key looks.

  | `variant` | Look | Use |
  |---|---|---|
  | `primary` (aliases `solid`, `signal`) | gold pill, #090909 600 label (15 px; 12 on `sm`), 48 / 40 / 32 px, optional arrow; disabled = `--lm-raised` fill and a pale-stone label (a full-width key in a sheet's foot is 48) | the one primary action per view |
  | `action` | gold label on a 16 % gold tile, 32 px (28 on `sm`, 40 on `lg`) | secondary actions on cards ("Start fast", "Log") |
  | `outlined` (alias `default`, the default) | neutral tile: 6 % ink fill, 1 px strong hairline, ivory label | ordinary actions |
  | `text` (alias `quiet`) | gold label, hover tint; in a card head or foot the action tile; icon-only = stone icon, 48 px target | tertiary/inline |
  | `danger` | rose label on a rose tint, rose hairline | destructive |

  `indicator` and `shape` are deprecated no-ops (kept so callers compile).
- **`IconKey`** `icon label` (label required → tooltip + aria-label), `size`, `variant` (default
  `quiet`: stone icon; `action` / `primary`: gold disc).
- **`RunKey`** `onRun state="idle|stale|running" elapsed caption size="md|lg" disabledReason
  shortcut` — the gold primary pill (the Key's pill shape, 40 / 48 px, label 14/600) labelled "Run";
  stale adds a dark dot after the label, running shows an arc and the elapsed time. ⌘/Ctrl + Enter
  when `shortcut`.

### Choice
- **`KeyBank`** (alias `SegmentedControl`) — radio group of 2–6 segments in the card's language
  (§0): a rounded-rectangle well, segments 3 px inside; labels in mono caps; selected = the gold tile,
  ivory label; unselected pale stone. Full width by default; `fit` sizes it to its labels. No indicator dots. The segments always hold **one row** (one grid
  column each, never a second row, a label never wraps): equal while they fit — as wide as the
  longest label when the track fits its content, an equal share when the track is stretched (three
  options in a sheet are three equal columns) — then sized to their labels when the row is tight
  (short labels give their room to a long one), each at least 48 px (40 for `sm`); only when the
  labels themselves do not fit does the track scroll sideways, keeping the selected key in view.
  `options value onChange label|labelledBy size="sm|md|lg"` (28 / 36 / 44 px; 44 on touch for every size)
  `block` (default true) `fit` `orientation`. Option `badge` = 6 px gold "changed" dot.
- **`LinkBank`** — route sub-navigation on the same track (`aria-current="page"`), same one-row layout.
- **`Tabs` / `TabList` / `Tab` / `TabPanel`** — in-page tabs on the same track, same one-row layout.
- **`Switch`** — 40 × 24; gold track when on, ink-3 outline when off. `role="switch"`.
- **`Checkbox`**, **`RadioGroup`** — ink-3 outline; gold when chosen.
- **`Select`** — outlined field + chevron; popover listbox on desktop pointers, native picker on
  touch (`native` to force). More than 6 options; fewer → KeyBank.
- **`Chip`** `kind="plain|metric|domain|filter|status"` — pills (§0): a 22 px tag, 6 % ink tint, stone
  label-s, no border; `domain` = a 6 px dot in `domainColor(domain)` and stone words; `status` = a 6 px dot in the
  severity colour and the words, nothing around them; pressable chips keep a hairline at 28 px (48 on touch below 768 px).
  `filter` pressed = gold wash + gold edge. **`Swatch`** is the metric key glyph (`category`, `domain` or `color`).
- **`StatusCapsule`** `icon label attention pulse tone="signal|danger" onClick | to onMenuSelect` —
  the header status as an icon (SPEC §9): a 48 px round target, one 22 px stone line icon, no
  words; `label` ("Weekly check-in ready", "2 changes waiting") is its accessible name and its
  tooltip (hover, focus, long-press). `attention` adds a 6 px gold dot at the icon's top right;
  `pulse` makes it breathe, only for real ongoing activity. A button with `onClick` (opens the
  sheet), a link with `to`, else a press shows the tooltip. In a `TopBar` at most two show; the
  rest move into the ⋯ (`onMenuSelect` when the press needs the icon on screen).

### Fields and numbers
- **`Field label help error`** — label above (body-s stone), control, rose error text naming the
  fix; wires id / label / describedby for the control (`TextInput`, `NumberField`, `Stepper`,
  `Select`, `KeyBank` read it via `useField()`). Fields: 1 px strong outline, 10 px corners, well
  background, 2 px gold focus line.
- **`NumberField`** / **`Stepper`** — typing commits on Enter/blur, Escape reverts, ↑/↓ step
  (⇧ ×10), ± keys hold-to-repeat and clamp; out-of-range typing shows "Weight must be 30–300 kg."
- **`MeasureStepper quantity="mass|length|height"`** — values are metric; display follows
  Settings › Units; `unitToggle` adds a `kg | lb` bank.
- **`ScaleSlider`** (alias `TuningSlider`) — printed scale in a well, gold needle and thumb, gold
  likely-range underlay; native range underneath (keyboard, ARIA, wheel); rider readout while
  dragging. Zones: `deficit-1…4`, `surplus-1…4`, `neutral`, `caution`, `danger`. `onChange` for
  live visuals, `onCommit` for expensive work.
- **`ScaleRange`** (alias `RangeSlider`) — two needles, gold span, `minGap`, thumbs never cross.

### Readouts and evidence
- **`Readout label value unit decimals from range caption unknownCaption size="lg|md|sm"
  animate category`** — tabular value (32 / 28 / 20 px), unit smaller and stone, signed change,
  likely-range gauge (gold). The figure and its unit are a `HeroNumber` (tabular, no count-up) at the readout's own
  sizes, so a readout is named once, in the figure; `animate` rolls the digits that change (`HeroNumber`'s `roll`).
- **`RangeBar`**, **`ReadoutStrip`** (one flush card, hairline dividers), **`ReadoutInline`**.
- **`GradeBadge grade size onClick`** (alias `EvidenceBadge`) — a quiet stone text pill: letter +
  pips, meaning in the tooltip.

### Feedback
- **`Notice severity title actions layout="boxed|ruled" onDismiss collapsible announce`**
  (aliases `Banner`, `SeverityBanner`) — the banner: the card material with no glow, 0.5 px hairline, 14 px
  corners; title + one line + at most one action. Caution / danger keep their drawn mark (gold /
  rose); info / ok have no icon. `ruled` = plain text inside a card (no surface, no rules).
- **`InlineWarning severity action alert`**, **`StatusMark severity`**.
- **`toast(message, { action, duration, id })`** + `<Toaster>` (mounted by the shell) — snackbar:
  elevated, 12 px corners, ink text, at most one gold text action, one at a time (a new one
  replaces the last), bottom centre 12 px above the mobile dock (`--lm-dock-h`).
- **`Tooltip content role="description|label"`** — elevated, 400 ms (instant within 1 s), hover +
  keyboard focus, Escape. Never essential information.
- **`ProgressRule value?`** (2 px gold rule at the top of a `relative` region), **`Spinner`**,
  **`Meter`** (6 px gold pill).
- **`EmptyStage title action children art`** (alias `EmptyState`) — one fact (`title`) and one
  action, left-aligned; no art by default (pass `<EmptyRasterArt />` to show one), no stage
  (`perforated` is ignored). **`Skeleton`** (static; lists only).

### Overlays
- **`Dialog open onClose title footer dismissible closeKey role size initialFocus`** — elevated, 24 px
  corners, 24 px padding, 24 px headline title, stone body; footer keys render as gold text buttons
  (danger stays rose). Native `<dialog>` + focus trap + Escape; restores focus. Same header grammar
  as the Sheet: a dialog with footer keys (Cancel · verb) shows **no ✕** — its Cancel, Esc and the
  scrim close it; a read-only dialog (no footer) is title · ✕. `closeKey` forces the ✕ back only for
  a footer with no way out.
- **`Sheet open onClose title footer detent detents onDone doneLabel cancelLabel doneDisabled
  doneDisabledReason doneForm`** — bg-2, 24 px top corners, 32 × 4 drag handle, opens on a spring (§0). One grammar
  (`PanelHead`, r068 L1/L19), the title **left-aligned** like every page title:
  - a sheet that **commits** something passes `onDone` (or `doneForm`): title · **Cancel** (stone
    text, closes) in the head, and the commit as a real **filled primary key** (`doneLabel`: "Save",
    "Log", "Pause") — full width at the sheet's foot on phones, a small filled key after Cancel in a
    desktop side panel's head. `doneDisabled` / `doneDisabledReason` keep the key visible and
    focusable but inert (the reason is its tooltip). `doneForm="<form id>"` makes the key that form's
    submit button, so Enter in any field commits too and the form's `onSubmit` does the work;
  - a sheet with **nothing to commit** (read-only, or every choice applies at once): title · ✕.
  The panel draws the commit: no second Save in the body, no commit key in `footer` (`footer` is for
  stepped flows: Back · step · Next; the commit follows it in the same foot row). Peek is non-modal.
- **`SidePanel`** (alias `Drawer`) and **`ResponsivePanel`** — the same `PanelHead` and materials
  on desktop (overlay on bg-2 with a hairline edge, springing in from the right; `mode="docked"` on
  the card material, 20 px corners); both take the same confirm props. While an overlay panel is open the page reflows beside it (the shell
  pads `.lm-main` by `--lm-drawer-w` from 1024 px), so nothing lies under it.
- **`Popover`** + `usePopover()`; **`Menu trigger items label placement`** — elevated, 12 px
  corners, hairline, 44 px rows. `items` is a list of `MenuEntry`: items (`id label onSelect icon?
  disabled? tone? hint? separatorBefore?`), `{ kind: 'divider', id }` (a hairline between groups,
  e.g. page actions · global items) and `{ kind: 'section', id, label }` (a labelled `role="group"`).
  Floating layers portal to `<body>` — or into the open Dialog/Sheet (`PortalContainerContext`).

### Brand
- **`RingMark`** (`@/components/brand`) — the plan ring: an ivory ring open at four o'clock over a
  hairline bezel, with a gold dot inside. Default `tone="auto"`: ivory ring and bezel (`--lm-ink`), gold
  dot (`--lm-signal`), no edge; heavier cuts at 40 px and 24 px and under. `light` / `dark` are the shipped brand
  files' fixed palette; `mono` uses currentColor. **`LaunchScreen`** fades the start screen into the app.

### Icons
`<Icon icon={Copy} size={16|20} label?>` — Lucide or an authored glyph, always 1.5 px absolute
stroke. Authored: `Glyphs.AvatarFront, AvatarSide, Channels, RouteGlyph, BookGlyph, SlidersGlyph,
DumbbellPlate, Footsteps, RunGlyph, FastClock, MealDot, KetoneDrop, SleepArc,
GradePips, ProgramKey, ScaleRuler, Hatch, InfoMark, CautionMark, DangerMark, OkMark`.

### Hooks and helpers
`useMediaQuery(MQ.lg)`, `useReducedMotion()` (settings override > OS), `useControllableState`,
`usePressAndHold`, `useFocusTrap`, `useRestoreFocus`, `useAnchoredPosition`, `cx`, `formatNumber`,
`formatSigned`, `formatRange`, `formatBytes`, `parseNumber`, `snap`, `scaleTicks`, `niceStep`.
`useRestoreFocus(open, rootRef)` (called by Sheet, SidePanel and Dialog with their own element) captures the opener once per
opening and gives focus back when `open` turns false or the host unmounts; an overlay that closes while another is open
hands its opener to that one instead of taking focus from it. `domainColor(domain)` (the solid), `domainToken(domain,
role)` and the types `Domain`, `DomainName`, `HueDomain` and `DomainRole` (from `@/components`) are the domain counterpart
of `categoryColor`; `HUE_DOMAINS`, `DOMAINS`, `DOMAIN_LABEL`, `isDomain` and `isHueDomain` list and test them.

### Motion hooks (`@/app/motion`, r071)
State, not decoration. Every hook returns the FINAL state on the first render wherever `motionAllowed()` is false (jsdom,
reduced motion, Settings › Motion "reduce"), so tests, screenshots and people who asked for less see the content. They
animate `transform`, `opacity`, `clip-path`, `stroke-dashoffset` and the registered `--lm-glow-k` only (never a layout
property, never a gradient), start when 20 % of the picture is in view once per mount, and re-animate a changed value from
the old value, not from zero. Durations are the motion tokens (`--lm-dur-count` 1100, `--lm-dur-draw` 1200,
`--lm-dur-glow` 900, `--lm-dur-bars` 700, `--lm-dur-fill` 900, `--lm-stagger-tick` 14, `--lm-stagger-bar` 60,
`--lm-pulse-cycles` 2); the `MOTION` constant mirrors them in ms and `EASE_OUT` is `--lm-ease-out`. Components import
them from `@/app/motion`. `@/components` also exports `useReveal({ animate, threshold })` (returns `[ref, pending]`: put
`data-reveal="pending"` on the picture while `pending`), `useMotionEnabled(animate)`, `useCountUp(target, { enabled,
active, from, duration, updateDuration })` and `canAnimate()`: thin wrappers over `useInView`, `useCountUp` and
`motionAllowed()` (`src/components/lib/reveal.ts`, `lib/motion.ts`), kept for the pictures and page code that call them,
with no motion code of their own. New code may use either; the shared hooks are the one implementation.
- **Who uses them.** `useInView` is the first view of `GradientCard` (the glow), `HeroNumber` and every picture that animates;
  `useCountUp` is `HeroNumber`'s; `useFlip` is `CardGrid`'s and `CardLibrary`'s; `enter` and `fadeCue` are `CardGrid`'s for
  a card added after mount. The pictures reveal through CSS states keyed on `data-reveal="pending"` (set while `animate`
  is on and the picture is not yet in view, absent wherever motion cannot run), so the final markup is the static
  markup. No component calls `useSweep`, `useDrawIn`, `useGrow` or `usePulse`; they are for a picture drawn by hand, and
  the gallery's motion demo uses them.
- **`useInView(ref, { once, threshold })`** — true once 20 % of the element shows; true at once where motion cannot run.
  Pass it to the others' `start`.
- **`useCountUp(value, { from, duration, updateDuration, start, reserve })`** — a number counting up (1100 ms expo-out;
  400 ms from the shown value when `value` changes). Reserve the final string's width, give the element an `aria-label`
  with the final value and mark the animating digits `aria-hidden` (`HeroNumber` does all three).
- **`useSweep(count, { stagger, start })`** — how many of `count` ticks are lit while a gauge sweeps (14 ms a tick).
- **`useDrawIn(ref, { mode: 'clip' | 'dash', duration, delay, start })`** — a line draws left to right (1200 ms):
  a clip-path reveal, or `stroke-dashoffset` on a path.
- **`useGrow(ref, { selector, axis, stagger, duration, start })`** — bars grow from their baseline (700 ms, 60 ms apart).
- **`usePulse(times)`** — a boolean: true for `times` (default 2) pulses of 2.4 s from the first render, then false for
  good (a mark that must pulse again remounts with a new `key`). Put it in `data-pulse` on a `.lm-live` mark.
- **`useFlip(ref, key, { selector, duration })`** — children (`[data-flip]`) slide to their new places when `key` changes
  (280 ms on `--lm-ease-needle`). It measures them against `ref`'s own box, so scrolling the page is not a move, measures
  again when the box or a child is resized, and starts a new slide from where a still-running one had the child.
- **`fadeCue(el)`** — the 100 ms cross-fade a state change gets under reduced motion instead of a move.
- **`.lm-live`** (`components.css`) — the live mark: a 10 px ivory dot with two thin rings that pulse twice (4.8 s, under
  WCAG 2.2.2's five seconds) and stop. The mark never loops; a breathing status dot exists only while a real
  process runs.
- **`.lm-meta`**, **`.lm-num-prop`** — the mono caps role and proportional figures (§0).

---

## 4. Building composites

- Compose from these primitives; add feature CSS next to the feature using `var(--lm-*)` only.
- Interactive custom widgets: native element or ARIA pattern, `aria-valuetext` with units,
  44 px touch / 32 px pointer targets (`.lm-hit` adds an invisible 44 px hit area), the gold focus
  ring from the base layer (never remove outlines), `useReducedMotion()` for anything animated.
- Lists and groups: one card surface (`.lm-material`) with rows ≥ 56 px (64 in settings), a 22 px
  stone icon (no tinted tiles), title in body, trailing value body-s stone, chevron ink-3, 0.5 px
  dividers inset to the text column.
- Gold only for the action, the selection and the moment; data wears its domain hue.

## 5. Do / don't

| Do | Don't |
|---|---|
| Cards on the grained backdrop; spacing and hairlines inside | Nested cards, shadows, glass or blur on cards, gradient text |
| One glow per card from `data-domain`; domain colour on marks; ivory for where you are | A second gradient layer, a glow behind small text, gold as a data colour, uppercase outside mono facts |
| `GradientCard` for a metric card, `Faceplate` for sections, forms and tools | A card head rebuilt by hand beside a `GradientCard`, Details, Open or Table keys in a card head |
| One hero number per card, its unit small and muted; facts in mono caps; the card opens through its title | Two big numbers in one card, a unit as large as its number, a sentence where a state word and a range say it |
| Sentence-case labels; a line beside a heading only for a fact | Eyebrows, helper subtitles, restated labels, "01 / 02" numbering |
| Gold-wash selection on a rounded-rectangle track | Indicator dots, coloured highlight blocks |
| Units, likely ranges and grades on every projection | Single-number certainty, KPI hero tiles ×4 |
| One banner under the header, a status capsule for plan events, a snackbar for feedback | Notices between content sections, blue info icons, coloured side stripes |
| One ⋯ per screen; per-row ⋯ only on object rows | A second screen-level menu, a bar above the tab bar |
| Plain, specific, second-person copy; verb + object on buttons | Exclamation marks, emoji, "Here's", "Let's", "Just", "Tap to" |
| Sheets on mobile, side panels on desktop | Modals as a first resort |

## 6. Testing

Interaction tests live in `src/components/__tests__` (slider keyboard/ARIA, key-bank roving
focus, dialog/sheet focus trap + Escape, stepper clamping, menu groups and dividers, status
capsule, sheet header row, snackbar). jsdom has no `showModal`/`matchMedia`/layout: the
components fall back gracefully (dialogs set `open`, media queries read false). r071 adds `focusRestore.test.tsx` (focus
returns to the opener: one test per host), `primitivesR071.test.tsx`, `src/app/__tests__/motionHooks.test.tsx` (every
hook returns its final state with motion off) and the tests that pin the look as text, since jsdom computes no styles:
`src/styles/__tests__/{tokens,primitivesCss,q6Layout}.test.ts`.

The r071 cards, pictures and layout add, in `src/components/__tests__`: `cards.test.tsx` (the card is labelled by its
title, the (i) is a named dialog trigger whose panel has one way out, a number never lets assistive technology hear a
count, the final markup equals the animated one, quiet draws no digit, pictures inherit the card's domain),
`cardGrid.test.tsx` (the packing and the grid), `cardLibrary.test.tsx`, `rail.test.tsx`, `readoutHero.test.tsx`
(`Readout` on `HeroNumber`, `Faceplate`'s markup unchanged) and `r071Css.test.ts` (the card, picture and layout
stylesheets: tokens only, weights 300 to 600, uppercase only in `mono.css`, flat with no gradient, motion on
compositor-friendly properties only, a forced-colours block, and one source for the domain wiring and the glow).
`src/components/viz/__tests__/` has a file per new picture (the model, the sentence, the twin, the quiet form, and the
same final markup with `animate` on and off), `restyle.test.tsx` for the restyled five and `contract.test.tsx` for the
contract the pictures share; `fakeMotion()` in `motionHelpers.ts` makes jsdom behave like a browser that may animate, so
a test can see a picture pending and then revealed. The settings keys are pinned in
`src/state/internal/settingsModel.test.ts` and the intake model and pictures in
`src/features/living/{model,components}/__tests__`.
