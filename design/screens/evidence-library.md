# Screen — Evidence library (`/evidence`, `/evidence/:mechanismId`)

> A **Read**-mode surface inside the instrument world: long-form, calm, well-typeset, with the same
> faceplates, engraved labels and grade badges. Content comes from the research dossiers (format
> in `research/RESEARCH_PROTOCOL.md`: mechanism → equation → parameter table → time dynamics →
> moderators → grade → interactions → citations).

## 1. Purpose

Let anyone check the calibration of the instrument: every mechanism the engine uses, what it says
in plain language, its equation, parameters and time constants, how strong the evidence is (A–D
and why), what it drives in the app, what's contested, and the sources. Reached mostly from
"Explain" on a curve, sometimes browsed directly by the curious.

## 2. Entry points & exits

| In | Out |
|---|---|
| Rail/tab "Evidence" · Explain drawer "Open in Evidence" · any GradeBadge (click) · Planner "why" popovers · metric picker (i) | "Used by" metric chips → Results with that metric focused (if a projection exists) · "Use as a goal" → Planner goals · citations (external links, new tab) |

## 3. Layout — mobile (375 px)

```
Index                                        Mechanism
┌──────────────────────────────────────┐    ┌──────────────────────────────────────┐
│ ● vitals                    ◐   ⚙    │    │ ‹ Evidence   Glycogen & water  [B●●●○]│ sticky mini-header 48
├──────────────────────────────────────┤    ├──────────────────────────────────────┤
│ Evidence                             │    │ ■ fuel & ketosis                      │
│ How Vitals' model works, and how sure│    │ Glycogen holds water                  │ title 24 display
│ we are about each part.              │    │ [B●●●○] a few human trials or …       │ grade + reason line
│ [ search mechanisms or metrics   ⌕ ] │    │                                       │
│ ■■■■■■■■  categories (chips, scroll) │    │ Each gram of glycogen is stored with  │ plain-language lead
│ [A] [B] [C] [D]   grade filter       │    │ about 3 g of water, so glycogen loss  │ 17/26, 68ch
│ ─────────────────────────────────────│    │ shows up on the scale as roughly 4×   │
│ ■ fuel & ketosis                  12 │    │ its weight.                           │
│ Glycogen holds water          [B●●●○]│    │ ┌ the equation ─────────────────────┐ │
│ Each gram of glycogen is stored…     │    │ │ water = k × glycogen, k ≈ 3 g/g    │ │
│ used by: glycogen · scale weight     │    │ └────────────────────────────────────┘ │
│ ─────────────────────────────────────│    │ parameters (table, scrolls sideways   │
│ Ketogenesis rises as liver …  [B●●●○]│    │  inside its own box)                  │
│ …                                    │    │ timing (response-curve mini diagram)  │
├──────────────────────────────────────┤    │ what changes it · used by · contested │
│  body   simulate   plan   evidence   │    │ sources (numbered)                    │
└──────────────────────────────────────┘    └──────────────────────────────────────┘
```

## 4. Layout — desktop (1440 px)

```
┌────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ●  │ Evidence                                  [ search mechanisms or metrics            ⌕ ]        │ 56
├────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│    │ ┌ filters ── 240 ┐ ┌ index / article ───────────── 720 (68ch prose) ─┐ ┌ on this page ─ 220 ┐   │
│    │ │ categories     │ │ Glycogen holds water                  [B●●●○]  │ │ mechanism           │   │
│    │ │ ■ body comp  9 │ │ ■ fuel & ketosis · last reviewed 30 Sep 2026   │ │ equation            │   │
│    │ │ ■ fuel      12 │ │                                                │ │ parameters          │   │
│    │ │ ■ energy     8 │ │ lead paragraph …                               │ │ timing              │   │
│    │ │ …              │ │ ┌ the equation in plain language ────────────┐ │ │ what changes it     │   │
│    │ │ grade          │ │ │ …  + formal equation (MathML)              │ │ │ used by             │   │
│    │ │ [A][B][C][D]   │ │ └────────────────────────────────────────────┘ │ │ contested           │   │
│    │ │ how grades work│ │ parameters table                               │ │ sources             │   │
│    │ └────────────────┘ │ timing diagram · moderators · used by · …      │ └─────────────────────┘   │
│    │                    └────────────────────────────────────────────────┘                            │
└────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
 grid: 240 | minmax(0, 720px) | 220 ; the right "on this page" index is sticky; hidden < 1280
```

- Index view uses the same grid; the centre column lists mechanisms grouped by category.
- **Grade definitions** live at `/evidence#grades` (also linked from every badge tooltip).

## 5. Regions & components

| Region | Components | Notes |
|---|---|---|
| Search | text field (well, 40 h) with search icon; results update as you type (150 ms debounce) | searches names, statements, metric names, aliases (e.g. "keto", "PSMF") |
| Filters | Chip `filter` (categories with hue swatch + count), GradeBadge chips (toggle), Key quiet "Clear" | multi-select |
| Mechanism row | engraved category, name (15/600), GradeBadge, one-line statement (15, ink-2), "used by" metric chips | row separated by hairlines, no card |
| Article | title (display 30/24), GradeBadge + reason line, lead (17/26), equation well, parameter DataTable, timing diagram (SVG), moderators list, used-by chips, contested box, interactions, sources | prose measure 68ch |
| Timing diagram | small SVG (320 × 120) response curve | onset lag, half-life, saturation annotated with thin leader lines |
| Sources | ordered list with study-type tags | tags: meta-analysis · RCT · ward study · cohort · model · animal · in vitro |
| On this page | sticky list of anchors | desktop ≥ 1280 |

## 6. Content & copy

**Index header**: "Evidence" · "How Vitals' model works, and how sure we are about each part."

**Grades** (`/evidence#grades`, also the badge tooltip text):
| Grade | Badge | Meaning (UI) |
|---|---|---|
| A | solid ink, 4 pips | "Strong: meta-analyses, validated models or several controlled human trials agree." |
| B | grey, 3 pips | "Good: a few human trials or consistent human mechanistic data." |
| C | outlined, 2 pips | "Limited: indirect or small human studies. Read the shape, not the exact number." |
| D | dashed, 1 pip | "Speculative: animal or cell studies, or expert judgement. Shown for exploration; the Planner weights it lightly." |

**Mechanism article template** (worked example: *Glycogen holds water*, dossier 04/13):
1. Engraved: "■ fuel & ketosis · last reviewed 30 Sep 2026 · dossier 04".
2. Title: "Glycogen holds water".
3. GradeBadge B + reason: "Grade B — several human studies measured water loss with glycogen
   depletion; the exact ratio varies (2.7–4 g/g)."
4. Lead: "Each gram of glycogen is stored with about 3 g of water, so glycogen loss shows up on
   the scale as roughly 4× its weight. That's why the first week of a low-carb or fasting phase
   can drop 1–2 kg that returns within days of eating carbs again."
5. **The equation in plain language** (well): "Water bound to glycogen ≈ 3 × glycogen. Scale
   weight = fat + lean tissue + glycogen + its water." Below it, the formal equation rendered as
   MathML (fallback: HTML with `<var>`): `W_gly = k · G`, `k = 3.0 g/g (2.7–4.0)`.
6. **Parameters** (DataTable, 13 px tabular): symbol · value · unit · uncertainty · source. Rows
   link to the numbered sources.
7. **Timing** — diagram + text: "Depletes over 1–3 days of low carbohydrate or fasting; refills in
   24–48 h with ≥ 5 g/kg carbs; can overshoot (supercompensation) by 10–20 % after depletion."
   Diagram: glycogen vs time with a depletion phase, refill and overshoot; annotated
   "half-life ≈ 20 h" and "overshoot +15 %".
8. **What changes it** (moderators): "Muscle mass (more muscle stores more) · training (depletes
   the worked muscles) · sex (similar per kg muscle)".
9. **Used by**: metric chips "Glycogen", "Scale weight", "Body water", "Blood ketones" (→ Results
   focus) + "Use as a goal" (only for goal-able metrics).
10. **Contested** (Faceplate `inset`, not a card-in-card: a hairline-bounded box): "Myth: 'the
    first week's loss is fat.' Mostly glycogen and water; fat loss follows the energy deficit."
11. **In your projection** (only when a projection exists): "In *Spring cut*, glycogen swings
    between 190 g and 520 g; about 1.3 kg of scale-weight change in week 5 is glycogen and water."
    [Show in results]
12. **Sources**: "1. Olsson KE, Saltin B. Variation in total body water with muscle glycogen
    changes in man. *Acta Physiol Scand* 1970. doi:… · study type: ward study". External link
    icon; opens in a new tab.

**Empty search**: "No mechanism matches 'x'. Try a metric name, like *ketones* or *hunger*."

**Grade D banner** (on D articles, info style): "Exploratory. Mostly animal or cell evidence. The
Simulator shows it; the Planner won't trade a higher goal for it."

## 7. Interactions

- Search + filters combine (AND across groups, OR within a group); URL reflects them
  (`?q=&cat=&grade=`), so back/forward works.
- Mechanism rows: whole row is the link; "used by" chips are separate links (stopPropagation).
- Article: "On this page" highlights the current section (IntersectionObserver); `j/k` jump
  sections on desktop.
- From Explain: opens the article scrolled to "the equation in plain language"; a back link
  "‹ Back to Spring cut results" returns to the exact chart state (URL state preserved).
- Citations: DOI/PMID links; a copy-citation icon key copies APA-style text (Toast "Citation
  copied").

## 8. States

| State | Behaviour |
|---|---|
| Content missing for a mechanism (dossier pending) | Article shows title, category, "Evidence write-up in progress" (info) and whatever parameters exist; grade shown as "—" with tooltip "not graded yet". Never fake text. |
| No projection | "In your projection" section hidden; "Used by" chips link to Results without focus. |
| Long tables on mobile | Parameter tables scroll horizontally inside their own region with a right-edge fade and "scroll →" hint; the page never scrolls sideways. |
| Offline | Everything is bundled; external citation links show "opens a website" hint. |

## 9. Accessibility

- Semantic article: `h1` title, `h2` sections, `table` with `th scope`, `ol` for sources.
- Equations: MathML with an `aria-label` plain-language reading; the plain-language box comes
  first so screen readers get meaning before notation.
- GradeBadge text is read as "Evidence grade B" (not "B, four dots").
- Diagram: `role="img"` with a caption that states the numbers.
- Prose 17/26 px, 68ch; links underlined with 3 px offset; visited links distinct (ink-2).
- Reduced motion: no smooth scroll.

## 10. Decisions & rationale

- **Read mode, same world**: the library uses the instrument's typography and badges, but trades
  density for measure and rhythm — it must be pleasant to read for ten minutes.
- **Plain language before notation** in every article; notation is there for the analytically
  minded, never as a gate.
- **Grades are achromatic** so they never look like severity and never compete with data colour.
- **"In your projection"** connects abstract mechanisms to the user's own curves — the reason
  anyone opens the library.
- **No fabricated content**: missing dossier text is shown as missing.
