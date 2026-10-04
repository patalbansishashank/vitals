# Screen — Intake v3: answered list, question card, measured maintenance, pickers, blood markers (`/onboarding/:section`)

> v0.3 (batch 02, 2026-10-02). Revises `onboarding-intake-v2.md`. Where the two disagree, this
> file wins; v2's question tables (§6.1–6.5), answer → stored value table (§10.1) and copy rules
> still apply unless reworded here. PLAN 02 items 1, 2, 4, 5, 6, 7, 9. Components:
> `COMPONENTS.md §14` (new) and §13.1–13.2. Contracts: `docs/SUITE_SPEC.md §12` (A3).
> Code it binds to: `src/features/intake/IntakePage.tsx`, `components/ChapterProgress.tsx`,
> `components/IntakeTurn.tsx`, `components/Receipt.tsx`, `components/Maintenance.tsx`,
> `components/widgets/food.tsx`, `intake.css`; `src/features/body/BodyPage.tsx` (Maintenance panel).
> All numbers, names and dates are synthetic examples, not real data.

## 1. What changes from v2, and why

| v2 behaviour | Problem the owner saw | v3 |
|---|---|---|
| One active turn; answered turns collapse to short receipts that scroll away | No way back; answers not visible; vague follow-ups | The **answered list** is the main surface: every question in fixed order, answered ones with their answer and **Change**; the open question is a card in its place |
| No Back; returning re-derives "next question" | A different question appeared after leaving and returning | **Back / Ask me later / Next** on every card; returning opens the **first unanswered question in the fixed order** |
| Follow-ups like "How do you get there?" | No context | Every prompt is self-contained, and the card shows the **parent answer as a chip** |
| "Correct it" sheet on the maintenance card, with what-if handles and "Keep these" | Padding bugs; questions reached through it had no Back and no list | **No sheet.** Two ordinary questions after the maintenance result; same questions inline on the Body page |
| Progress bar squeezed against the title | Crammed | Own centred row on mobile; right-aligned on the title row ≥ 768 px |
| Summary key flush on the last divider; "asked later · nothing" row | Looked unpadded | Faceplate footer with the standard inset; empty "asked later" row hidden |
| 19 kitchen items, 16 cuisines, small staples and pantry lists | Too small for the recipe Coach | Grouped searchable pickers with region defaults, free text, notes and paste-a-list (`§14.5`) |
| One "I already take some" answer; overlapping dose inputs | Missed "have them at home"; layout broken | Two answers (taking / have at home) and the SupplementRow (`§14.4`) |
| — | — | New optional chapter **blood markers** between food and devices |

## 2. Chapters and order

Five chapters, in this order: **a normal day** (activity) · **training** · **food** · **blood
markers** (optional) · **devices**. The progress bar has five segments (v2 had four; the owner's
item 4 was about the four-segment bar of v0.2, and the fifth segment is the new chapter). The
blood-markers segment's empty track is drawn dashed (`1px dashed var(--lm-line-strong)`) because the
chapter is optional; skipping it fills the segment with the "asked later" hatch like any skip.

## 3. Chapter screen layout

### 3.1 Mobile (390 px)

```
┌──────────────────────────────────────────┐
│ ‹  A normal day                          │ TopBar 56: back IconKey 40 · title 17/600
│    ━━━━━━━┃━━━━━━ ──── ──── ┄┄┄┄ ────    │ row 2 (height 32): ChapterProgress, centred,
│          a normal day · 4 of 11          │ width min(100% − 32 px, 360 px); label 11/500
├──────────────────────────────────────────┤
│ maintenance ≈ 2 740 · likely 2 390–3 090 ▾│ readout rail (chapter A only), 40 h, chassis-2
├──────────────────────────────────────────┤
│ A few questions about a normal week. …   │ chapter intro, 13 ink-2, 1–2 lines
│ ┌ Your answers ────────────── 3 of 11 ┐ │ AnsweredList faceplate (§14.2)
│ │ Do you work or study outside home?   │ │ question 13/500 ink-2
│ │ yes                          Change  │ │ answer 15/500 ink · Key quiet sm, right
│ │ ──────────────────────────────────── │ │ hairline --lm-line
│ │ ┃ What do you mostly do on a workday?│ │ child: 16 px indent + 1 px rule (tree line)
│ │ ┃ sitting at a desk or driving Change│ │
│ │ ┃ ────────────────────────────────── │ │
│ │ ┃ How many workdays a week, and how  │ │
│ │ ┃ many hours on each?                │ │
│ │ ┃ 5 days × 8 h                Change │ │
│ │ ┌ question 4 of 11 ────────────────┐ │ │ QuestionCard (§14.3) sits in the list at its
│ │ │ because you said: work outside ·  │ │ │ own position; inset region, not a faceplate
│ │ │ yes                               │ │ │ parent chip
│ │ │ How do you usually get to work or │ │ │ prompt 17/600, self-contained
│ │ │ study on a workday?               │ │ │
│ │ │ why we ask ▾                      │ │ │
│ │ │ [ride: car, bus, metro…] [walk …] │ │ │ AnswerKeys, 2 per row
│ │ │ [cycle] [I work from home]        │ │ │
│ │ │ if you skip: ride, 0 min walking  │ │ │ 12 ink-3
│ │ │ ───────────────────────────────── │ │ │
│ │ │ [‹ Back]   Ask me later   [Next ›]│ │ │ footer row, 44 h keys
│ │ └───────────────────────────────────┘ │ │
│ │ 7 more questions in this chapter      │ │ 12 ink-3; upcoming questions are not listed
│ └───────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ Skip this part              question 4/11│ ActionBar: quiet key · count 12 ink-2
└──────────────────────────────────────────┘
```

- Page gutter `--lm-gutter` (16). AnsweredList faceplate padding 16. The QuestionCard is an inset
  region inside it (`--lm-well` background, 1 px `--lm-line`, radius `--lm-radius-md`, padding 16,
  margin-block 12) so faceplates are never nested.
- The open card is scrolled so its prompt sits at 35 % of the viewport (as v2).
- A picker or a long table inside the card makes the card's footer sticky: it docks above the
  ActionBar (`position: sticky; bottom: calc(var(--lm-tabbar-h) + 8px)`), `--lm-well` fill, top
  hairline.

### 3.2 Tablet (768 px)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ‹  A normal day              ━━━━━┃━━━ ──── ──── ┄┄┄┄ ────                │ one row, 56 h:
│                              a normal day training food markers devices   │ progress right-aligned,
├──────────────────────────────────────────────────────────────────────────┤ width 360
│ maintenance ≈ 2 740 · likely 2 390–3 090 ▾                                │ readout rail stays
│            ┌ Your answers ───────────────────────── 3 of 11 ┐            │ single column, max 640,
│            │ … rows, open QuestionCard, "7 more" …            │            │ centred
│            └──────────────────────────────────────────────────┘            │
│ Skip this part                                         question 4 of 11   │ ActionBar
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Desktop (1440 px)

```
┌────┬────────────────────────────────────────────────────────────────────────────────────────────┐
│ ●  │ ‹ A normal day                 ━━━━━┃━━━ ──── ──── ┄┄┄┄ ────      Skip this part          │ 56 h
│    │                                a normal day training food markers devices                  │
├────┼────────────────────────────────────────────────────────────────────────────────────────────┤
│    │      ┌ Your answers ──────────── 3 of 11 ┐   ┌ Your picture so far ───────── 360 ┐        │
│    │      │ rows …                             │   │ maintenance about 2 740 kcal       │        │
│    │      │ ┌ question 4 of 11 ─────────────┐ │   │ DriverBar · biggest unknown        │        │
│    │      │ │ …                              │ │   │ training · food · markers · devices│        │
│    │      │ └────────────────────────────────┘ │   │ asked later: 1 question            │        │
│    │      │ 7 more questions in this chapter   │   └────────────────────────────────────┘        │
│    │      └──────────────────── max 640 ───────┘   sticky, top 72                               │
└────┴────────────────────────────────────────────────────────────────────────────────────────────┘
 grid: minmax(0, 640px) 360px, gap 32 (--lm-space-8), centred; aside hidden < 1024
```

### 3.4 Header and progress (`ChapterProgress`, item 4)

| Width | Title row | Progress |
|---|---|---|
| < 768 | back · title, left | own row under the title, 32 px tall, **centred**, `width: min(100% - 32px, 360px)`; one label under the bar: current chapter name + "4 of 11" (11/500, ink-2, centred) |
| 768–1023 | back · title left; progress right | same row, `margin-left: auto`, width 360; all five labels under their segments (11/500; current in ink + 600, others ink-3) |
| ≥ 1024 | back · title · progress · Skip this part (quiet sm) | progress width 440, 24 px gap before Skip this part |

- Segment: 4 px bar (`--lm-well` track with `--lm-shadow-well`, radius full), gap 6 px. Fill
  (`--lm-ink`) = answered share of that chapter's questions, in fixed order; deferred share is a
  45° hatch (ink 1 px / 3 px). The **current segment** shows one 1 px `--lm-face` notch per question
  boundary when the chapter has ≤ 14 questions, so progress reads per question.
- The yellow 6 px indicator dot sits left of the current label (the only signal colour here).
- `role="progressbar"`, `aria-valuetext="A normal day, question 4 of 11; 1 of 5 chapters done"`.
  Labels are `aria-hidden` (the value text carries them).
- Dark/light: tokens only; the track's well shadow is the only depth cue in both themes.

### 3.5 States of the chapter screen

| State | What shows |
|---|---|
| Empty (chapter not started) | AnsweredList with no rows: the faceplate header "Your answers · 0 of 11", then the first QuestionCard directly; no empty-state illustration |
| Answering | as drawn |
| Changing (Change pressed on a row) | that row is replaced in place by its QuestionCard in **change mode** (§14.3); the previously open card closes back to "7 more questions" (its draft is kept for 10 min); nothing else moves |
| Returned later | rows as answered; the open card is the **first unanswered question in fixed order**; the screen announces "Continuing at question 4 of 11" |
| Branch changed | children that no longer apply stay listed in ink-3 with "not used: you said you work from home" and a Change key; children newly needed appear directly under their parent and are asked next, then the card returns to where the person was ("Back to question 7") |
| Error (save failed) | the card stays open with the answer pressed; InlineWarning danger under the answer keys: "Couldn't save this answer. Try again." [Try again]; Next disabled with that reason |
| Loading (questions not ready, slow device) | AnsweredList rows render; the card area shows a 3-line skeleton (well fills, no shimmer under reduced motion) for ≤ 1 s, then "Still loading the questions…" |
| Chapter done | the chapter end receipt (§3.7) replaces the open card |

### 3.6 Keyboard and screen readers (chapter screen)

- Tab order: back · progress (not focusable) · Skip this part · AnsweredList rows' Change keys in
  list order · open card (parent chip → answer group → why we ask → Back → Ask me later → Next).
- Shortcuts inside the open card: `Enter` = Next (when enabled) · `Alt+←` = Back · `L` = Ask me
  later · `Esc` in change mode = Cancel. Shortcuts are listed in the card's `aria-keyshortcuts`.
- The AnsweredList is an ordered list; each row is a `li` with the question as text and the answer
  in a `<p>`; the Change key is named "Change: How do you usually get to work, ride".
- After Next, focus moves to the next card's legend; a polite live region says "Saved: ride. Question
  5 of 11." After Back, focus moves to the previous card's legend and the live region says
  "Question 3 of 11, answered: 5 days × 8 h."

### 3.7 Chapter end receipt

Replaces the open card at the bottom of the AnsweredList (inset region, same metrics as the card):

```
 A normal day · done                                     11 answered · 1 asked later
 Plans use these answers from now on. You can change any of them here or in Body › Your setup.
 [Next: training ›] (solid)                                            Review asked-later (1)
```
- The "asked later" link opens the first asked-later question as a card in change mode; hidden when
  zero. In chapter A the receipt follows the maintenance result and its two questions (§4).

## 4. Measured maintenance as ordinary questions (item 1)

### 4.1 Order at the end of chapter A

A1–A10 (v2 §6.1, reworded per §7) → **maintenance result card** → **M1** → **M1a** (if yes) →
chapter end receipt. The result card updates in place when M1a is answered. Nothing opens a sheet;
there is no "Correct it", no what-if handles and no "Keep these" anywhere in the intake.

### 4.2 Maintenance result card

An inset region in the AnsweredList, after the A10 row (same metrics as a QuestionCard, no footer):

```
 Your maintenance                                                   [B ●●●○]
 about 2 740 kcal a day                         likely 2 390–3 090      Readout md + RangeBar
 ▕█████████████████████▌▓▓▓▌▒▒▌░▌▒▒▒▒▒▒▒▕                                DriverBar (§13.2)
 resting metabolism 1 855 · everyday living 278 · steps 266 · …          table twin; each row's
                                                                         "change" opens that question
 Biggest unknown: your steps are a guess. A 2–4-week average from a watch or phone would narrow
 this by about ±120 kcal.
 This is a starting estimate. Once you follow a plan, your weigh-ins and logs correct it.
```
- **Drivers**: DriverBar with its table twin; a defaulted driver keeps its dashed outline. Each
  table row's "change" opens that question **as a card in change mode in this same list** (never a
  sheet).
- **Band**: the 80 % likely range, rounded to 10 kcal. **Biggest unknown**: shown only when fixing it
  narrows the range by ≥ 20 kcal (v2 rule).
- After M1a is answered: an extra line "Your measurement: 1 720 kcal resting · metabolic cart ·
  Mar 2026 · {use sentence from the engine, e.g. "used as your resting energy" or "shown, not used: a calculator estimates, it doesn't measure"}". The use sentence (whether and how far the method
  narrows the range) comes from `profile.explainMaintenance` / `resolveActivity` (A3 contract); the
  UI never decides how much a method is trusted.
- Quiet mode: as v2 (kcal behind "show numbers").

### 4.3 The two questions

| # | Prompt (self-contained) | Answers | If you skip |
|---|---|---|---|
| M1 (`activity.measuredEver`) | Have you ever had your resting energy or your maintenance calories measured, for example in a clinic, a lab or with a scan? | no · yes, my resting energy (lying still) · yes, my maintenance (a whole day) | no |
| M1a (`activity.measured`) | What was your measured figure, and how was it measured? | figure: NumberField + unit KeyBank `kcal a day · kJ a day`; how: AnswerKeys **breath test with a mask or hood** (metabolic cart) · **calculated from a DXA scan** · **a smart-scale reading** · **an online or app calculator** · **weeks of logging what I ate while my weight stayed the same**; when: month + year | — |

- M1a's card shows the parent chip "because you said: measured before · resting energy".
- Validation: figure outside 800–6 000 kcal (3 350–25 100 kJ) → InlineWarning "Is 9 000 right? That
  is outside what Vitals accepts for a day." Next disabled until fixed. A date in the future → error.
- How each method is used is A3's binding (`docs/SUITE_SPEC.md`, measured maintenance): only a
  metabolic-cart resting figure replaces the resting estimate; DXA, scale and calculator figures are
  shown as estimates and not used; a logged maintenance figure becomes an observation at plan start.
  The result card says which, in the engine's words; nothing on screen implies a method is more
  exact than the contract treats it.
- Stored per A3 (`resolveActivity` input, method, date); appears as two rows in the AnsweredList
  with Change.

### 4.4 Body page › Maintenance panel (same questions, inline)

```
 ┌ Maintenance ─────────────────────────────────────────── [B ●●●○] ┐
 │ about 2 740 kcal a day · likely 2 390–3 090                        │
 │ DriverBar + table twin (each "change" → /onboarding/activity#q, from=body)
 │ ────────────────────────────────────────────────────────────────── │
 │ Measured before?                                                    │ AnswerRow (§14.2) or,
 │ yes · 1 720 kcal resting · breath test · Mar 2026          Change   │ when unanswered, the
 └────────────────────────────────────────────────────────────────────┘ QuestionCard inline
```
- Unanswered: M1 renders as an inline QuestionCard (inset region, footer without Back: Ask me later ·
  Next). Change on the row turns the row into the same card in change mode, inside the panel.
- A driver row's "change" deep-links to the chapter screen with that question open in change mode;
  Save or Cancel returns to `/body#maintenance` with focus on the changed row.
- The previous "add measurement" key and its sheet are removed.

## 5. Summary card "What we'll use" (`/onboarding/summary`, item 7)

```
 390 px                                         1440 px (max 720, centred)
 ┌──────────────────────────────────────┐      ┌ What we'll use ─────────────────────────────────┐
 │ What we'll use                        │      │ Here's what Vitals will work from.               │
 │ ──────────────────────────────────── │      │ a normal day                                      │
 │ Here's what Vitals will work from.    │      │ desk or driving · 5 × 8 h · about 6 700   change │
 │ a normal day                          │      │ steps · maintenance about 2 740 kcal             │
 │ desk or driving · 5 × 8 h ·    change │      │ ───────────────────────────────────────────────  │
 │ about 6 700 steps                     │      │ training …                                change │
 │ ──────────────────────────────────── │      │ food …                                    change │
 │ training …                     change │      │ blood markers · 7 values from 12 Aug 2026 change │
 │ food …                         change │      │ devices …                                 change │
 │ blood markers · skipped        change │      │ ─────────────────────────────────────────────── │ footer rule
 │ devices …                      change │      │ [Looks right — continue]                         │
 │ ──────────────────────────────────── │      └──────────────────────────────────────────────────┘
 │ [      Looks right — continue      ] │
 └──────────────────────────────────────┘
```

| Part | Spec |
|---|---|
| Container | `Faceplate` with `title` and **`footer`** (not a `.lm-ik-actions` div in the body). Padding 16 (< 1024) / 18 × 20 (≥ 1024), the standard faceplate inset |
| Rows | `dl`, grid `minmax(0,1fr) auto`, gap 2 × 12, padding-block 12, hairline `--lm-line` between rows; **the last row has no bottom border** (the footer's rule is the only line above the key) |
| dt | chapter name, 12/500 `--lm-ink-2` |
| dd | the chapter line, 15/400 `--lm-ink`, wraps; never truncated |
| change | Key quiet sm, right column, `align-self: start` with `margin-top: 18px` so it sits on the first line of `dd`; accessible name "Change a normal day" |
| Footer | `.lm-face-foot`: margin-top 16, padding-top 16, 1 px `--lm-line` top rule; key solid md; its **left edge aligns with the row text** (both at the faceplate's content edge); < 480 the key is full width; ≥ 480 auto width, left-aligned |
| Asked later row | hidden when nothing was asked later; otherwise "asked later · 3 questions" with an "Answer now" quiet key in the change column |
| Blood markers row | "skipped" / "7 values from 12 Aug 2026 · 2 change your plan" |

States: loading (rows as skeleton lines for ≤ 1 s) · a chapter not answered ("not answered yet",
ink-3, key "Answer" instead of "change") · error saving setup ("Couldn't save. Try again.", danger
InlineWarning above the footer). Keyboard: Tab goes row by row through the change keys, then the
footer key. Dark and light: tokens only; check the footer rule is visible in dark (`--lm-line`
#333639 on `--lm-face` #1d1f22).

## 6. Food chapter additions (items 5 and 6)

### 6.1 Pickers inside question cards

| # | Prompt (self-contained) | Control | If you skip |
|---|---|---|---|
| F5 | Which cuisines do you cook or eat most often? | CataloguePicker `cuisines` (groups: Indian by region · Indian by community · world cuisines), rank by tap order (first = most often; a small rank numeral on the chip) | region default, marked "assumed" |
| F7 | What cooking equipment do you have in your kitchen? | CataloguePicker `equipment` (groups from R12: cooking · prep · storage · small appliances), region defaults ticked as "suggested", per-item notes ("OTG oven · small, 28 L") | region defaults |
| F7b | Which staples do you keep and cook with most? | CataloguePicker `staples` (grains and flours · pulses and legumes · proteins · dairy and alternatives · oils and fats · vegetables · fruit · nuts and seeds · sweeteners) | region defaults |
| F7c | What's in your kitchen right now? *(optional)* | CataloguePicker `pantry` (vegetables · fruit · dairy and cheese · eggs and meat · fish and seafood · pulses · grains · breads · condiments and sauces · spices and masalas · pickles and chutneys · nuts and seeds · beverages · frozen and ready) + paste-a-list | nothing; the Coach accepts "I have these at home" any time |

- F7c's card states the optional framing above the picker: "Optional. Skip this if you like — you
  can tell the Coach 'right now I have these at home' whenever you want." Its footer reads **Skip
  this list** (in place of Ask me later), Back, **Done (42)**. Skipping is recorded as answered
  "skipped, by choice", not as asked later, so it never nags.
- Item lists and regional defaults come from R12 (`research/R12-seed.json`); the design fixes only
  layout and behaviour (`§14.5`).

### 6.2 Supplements

| # | Prompt | Answers |
|---|---|---|
| S1 | Food first, or open to supplements? | **food first** · **open to supplements** · **I already take some** · **I have some at home but don't take them** |
| S2 | Which supplements do you take or have at home? (shown for either of the last two) | search + list from `catalogue.supplements` + "something else" text; each pick becomes a SupplementRow (`§14.4`) with its state preset from S1 (taking / have it, don't take) |

The S2 card lists the rows inside the card; Done is enabled with zero rows ("none after all").

## 7. Question wording (item 2, the no-vagueness test)

Each prompt must pass: *would a stranger know what is being asked without the previous screen?*
Rewrites for chapter A (E16 audits all chapters with the same test):

| v2 prompt | v3 prompt |
|---|---|
| A2 On a work day, what are you mostly doing? | What do you mostly do on a workday, at work or study? |
| A3 How many days a week, and about how long? | How many workdays do you have a week, and how many hours is each? |
| A4 How do you get there? | How do you usually get to work or study on a workday? |
| A4 follow-up minutes a day, both ways | How many minutes a day do you walk or cycle to and from work, in total? |
| A5a About how many a day, over the last 2–4 weeks? | About how many steps a day have you walked over the last 2–4 weeks? |
| A5b Is your phone with you most of the day? | Is the phone that counts your steps with you for most of the day? |
| A6 On a day off, you're mostly… | On a day off, what are you mostly doing? |

The parent chip shows the answer each follow-up depends on ("because you said: walk part of it").

## 8. Blood markers chapter (item 9)

### 8.1 Entry card (B0)

```
 ┌ question 1 of 1 ────────────────────────────────────────────────────────┐
 │ ⓘ This is the most detailed option; many values are involved.            │ Notice info, ruled
 │ Vitals is not medical advice; it does not diagnose, and anything your     │ 13 ink-2 under it
 │ lab marks as abnormal should be discussed with a doctor.                  │
 │ Do you have results from a recent blood test that you want Vitals to use? │ prompt 17/600
 │ why we ask ▾  Some results change what a plan may do, for example how much saturated fat
 │               or how long a fast it allows. Values only adjust the simulation and its safety checks.
 │ [No, skip this chapter]  [Type the values]  [Let the Coach read my report] │ AnswerKeys, 1 per row
 │                                                                            │ < 768, 3 across ≥ 768
 │ if you skip: plans start from typical values for your age and sex          │
 │ [‹ Back]                                                    [Next ›]       │ no Ask me later: "No,
 └────────────────────────────────────────────────────────────────────────────┘ skip" is the skip
```
- Both statements are shown **verbatim** as above, every time the chapter opens, before any choice.
  They are text in the card (Notice `layout="ruled"`, info mark), not a dismissible banner.
- "Let the Coach read my report" sub-line: "PDF or photo. Text PDFs are read on this device; photos
  need an AI provider." Without a provider the key stays enabled for PDFs; choosing a photo shows
  "Reading photos needs an AI provider. Connect one in Settings, or type the values."

### 8.2 Manual entry table (B1)

≥ 768 (a real `table`, inside the card, horizontally scrollable only below 640 px content width):

```
 lipids · tested on [12 Aug 2026 ▾] · fasting? [yes|no|not sure]                    clear group
 marker                 value        unit          your lab's range     date         
 LDL cholesterol        [ 158   ]    [mg/dL ▾]     [   ] – [ 100 ]      12 Aug 2026  above range ▲
 HDL cholesterol        [  46   ]    [mg/dL ▾]     [ 40 ] – [   ]       12 Aug 2026  in range
 triglycerides          [       ]    [mg/dL ▾]     [   ] – [   ]        —            not in your report
 ApoB                   …
 sugar · tested on …                                                                   ▸ (collapsed)
 + 7 more groups: liver · kidney · thyroid · blood · vitamin D · inflammation · training extras
```
- Columns: marker (15/500 + 12 ink-2 plain name "LDL cholesterol (bad cholesterol)") · value
  (NumberField 96 w, tabular, right-aligned) · unit (Select with the marker's alternatives; switching
  converts the typed value and shows "= 4.09 mmol/L" in 12 ink-3; Lp(a) mg/dL ↔ nmol/L never
  converts, it re-labels) · lab range (two 64 w fields, either may be empty; or a text field when
  the lab prints a category table) · date (the group's date in ink-3; "different date" quiet link
  makes it editable per row) · status text ("in range" / "above range" / "below range" with a
  caution mark only for out-of-range; achromatic text).
- Groups are DetailGroups; lipids open first. Each group has one date and, for lipids and sugar, one
  fasting KeyBank. Counts in the group header "lipids · 3 of 5 entered".
- < 768: each marker is a `fieldset` block: name line; value + unit on one row; lab range on the
  next; date + status on the last; 12 px between blocks, hairline between markers.
- Validation: outside plausibility bounds → field error (danger text under the field, `aria-invalid`):
  "Vitals accepts 20–5 000 mg/dL for triglycerides. Check the unit."; outside soft bounds → inline
  question "Is 412 mg/dL right?" [Yes, keep it] [Edit].
- Footer: Back · **Skip this table** · **Save 6 values** (solid; disabled at zero with reason
  "Enter at least one value, or skip"). Saved values become one AnsweredList row per group:
  "lipids · LDL 158, HDL 46 mg/dL · 12 Aug 2026" with Change.

### 8.3 Report reading and review table (B2)

1. **Choose file** (card): file key `PDF or photo`; under it "Your name and patient details are
   removed before anything is read. The file stays on this device; you can delete it after review."
2. **Reading** (loading): ProgressRule + "Reading page 3 of 25…"; Cancel (quiet). Text-layer PDFs
   are read on the device; pages without text go to the AI provider only after the line "Sending
   12 pages without text to {provider}. Patient details are cut off first." with [Send] [Type
   instead].
3. **Context questions** (above the table, one compact KeyBank each): test date (from the report,
   to confirm) · were you fasting? · creatine in the last 2 weeks? · ill in the last 2 weeks? · hard
   training in the last 48 h? · taking thyroid medicine, metformin or an acid-reducing medicine?
4. **Review table**:

```
 Confirm what Vitals read. Nothing is saved until you tick it.        Tick all high-confidence (9)
 ☐  marker            as read            converted     lab range      date         confidence   
 ☐  LDL cholesterol   158 mg/dL (direct) —             < 100          12 Aug 2026  [high]      Edit
 ☐  HbA1c             5.8 %              40 mmol/mol   4.0–5.6        12 Aug 2026  [medium]    Edit
 ☐  vitamin B12       190 pq/mL         190 pg/mL     211–911        12 Aug 2026  [┄low┄]     Edit
     "pq" read as pg; check this value
 fasting glucose · not in your report
 ▸ Shown, not used for planning (31): blood count indices, A/G ratio, ALP, bilirubin, …
 [‹ Back]   Delete the report file                                       [Save 9 confirmed values]
```
- Every row starts **unticked**; "Tick all high-confidence" ticks only `high` rows and is itself a
  visible action the person takes. Low-confidence rows carry the reason under them in 12 ink-2.
- Confidence chip: Chip `status` 24 h, text "high" / "medium" / "low"; low has a dashed outline
  (dash = uncertain, the system's vocabulary). Never colour alone.
- Edit turns the row's value, unit and range into fields in place. A calculated row from the lab is
  recomputed and listed under "shown, not used".
- < 768: one block per row (checkbox 44 hit at left; name and value line; converted and range line;
  date + confidence + Edit line).
- Error states: no text layer and no provider → "This PDF has no text Vitals can read on this device.
  Connect an AI provider to read it as images, or type the values." [Type the values]; wrong file →
  "This doesn't look like a lab report." [Choose another file]; partial → the rows found plus "12
  pages couldn't be read."

### 8.4 Chapter end receipt for markers

Rows per group as in §8.2, then a short list "What these change in your plan" with one line per
active rule, each with a BecauseChip (`§14.6`):
> {cap from the table} · very-low-carb plans show a warning first · retest in {interval from the
> table} — [because your LDL was 158 mg/dL on 12 Aug 2026]

Rule wording, thresholds and grades come from the interaction table (E20 from R13); the UI never
writes them. Clinician lines (eGFR < 30, Hb < 8 and the rest of the research list) render as a
Notice caution: "Your lab marked {marker} at a level a doctor should see soon." — never as a block.

## 9. Acceptance checklist (Q6 visual pass)

Check at 390, 768 and 1440 px in light and dark unless a line says otherwise.

**Chapter screen**
- [ ] 390: progress bar on its own row under the title, horizontally centred, ≤ 360 px wide, with one label "chapter · n of N".
- [ ] 768 and 1440: progress on the title row, right-aligned; 1440 has Skip this part to its right with a 24 px gap.
- [ ] Every answered question is listed with its answer and a Change key; branching children are indented 16 px with a tree rule.
- [ ] The open question card shows the parent-answer chip for every follow-up question.
- [ ] Back, Ask me later and Next are present on every card; Next is disabled until an answer exists.
- [ ] Answer, Back, change an earlier answer, leave the chapter, return: the same first-unanswered question opens.
- [ ] Change opens the card in place of its row; Cancel restores the row unchanged.
- [ ] No text overlaps or truncates in rows at 390 px; the long A1 question wraps to two lines.
- [ ] Focus ring visible on every key; Enter / Alt+← / L / Esc behave as §3.6.
- [ ] Error, loading, empty and branch-changed states render as §3.5.

**Maintenance**
- [ ] No sheet or slide-in panel opens anywhere in chapter A or from the Body page Maintenance panel.
- [ ] The result card shows drivers, the likely range and the biggest unknown (when it narrows ≥ 20 kcal).
- [ ] M1 and M1a appear as ordinary cards after the result, and as AnsweredList rows with Change once answered.
- [ ] The Body page panel shows M1/M1a inline; a driver "change" opens the question and returns to `/body#maintenance`.

**Summary**
- [ ] The footer key sits 16 px below a hairline, its left edge aligned with the row text; card padding 16 (390) / 20 (1440) on all sides.
- [ ] No double rule above the footer.
- [ ] "change" keys right-aligned on the first line of each row.
- [ ] The "asked later" row is absent when nothing was asked later.

**Food**
- [ ] Equipment, cuisine, staples and pantry cards use the picker (§14.5) with search, groups, counts and the region note.
- [ ] The pantry card reads as optional and its "Skip this list" key is in the footer.
- [ ] S1 shows both "I already take some" and "I have some at home but don't take them".
- [ ] Supplement rows meet the §14.4 checklist inside the S2 card.

**Blood markers**
- [ ] Both statements appear verbatim before the entry choice.
- [ ] Manual table: units, date, lab range, status text; plausibility errors block, soft bounds ask.
- [ ] Review table: every row unticked at first; confidence chips readable without colour; nothing saved before Save.
- [ ] "Not in your report" shown for absent markers, never as an error.
