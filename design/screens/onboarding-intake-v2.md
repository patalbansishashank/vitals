# Screen — Intake v2: a normal day, training, food, devices (`/onboarding/:section`)

> v0.2 (2026-10-01). Sections: `activity` · `training` · `diet` · `kitchen` · `supplements` ·
> `devices` (`docs/SUITE_SPEC.md §2.3.1, §6.2`), presented as **four chapters**: *a normal day*
> (activity), *training and equipment* (training), *food and kitchen* (diet + kitchen +
> supplements), *devices and data* (devices). Research behind the questions: activity intake (R1),
> exercise and equipment (R3), food, recipes and supplements (R4), wearables and score streams.
> Components: `COMPONENTS.md §13.1–13.2, §13.15`. Copy obeys PLAN item 5: no research-file names,
> section signs or rule ids ever reach the screen.
> All numbers, names and dates in this spec are synthetic examples, not real data.

## 1. Purpose

Learn how this person actually lives — a normal day, what training they will do and with what, what
they eat and cook, what they wear on their wrist or finger — in about five minutes, mostly with
one tap per question, so that maintenance, plans, recipes and sessions fit their life rather than a
population average. It must feel like answering a calm, well-informed coach, not filling in a form:
one question at a time, the previous answers visible as a short record, the instrument's readouts
reacting as you answer, and every question skippable with its default shown.

## 2. Entry points & exits

| In | Out |
|---|---|
| First run, after Your body · shape (`?from=setup`) · Body › Your setup › any chapter (`?from=body`) · a "needs …" chip anywhere (deep link to the question: `/onboarding/activity#steps`) · Coach "Answer by chatting instead" (the Coach runs the same questions) | Next chapter · **What we'll use** summary (`/onboarding/summary`, first run) → *Choose a start* · back to where it was opened (`from=body`) · Settings › Devices and streams (from devices) |

Chapters can be done in any order from Body › Your setup; the first run walks them in order.

## 3. Layout — mobile (375 px)

```
┌──────────────────────────────────────────┐
│ ‹  A normal day      ━━━━─────────────── │ top bar: back · chapter · 4-segment scale
│                                          │ (4 segments: a normal day · training · food · devices;
│                                          │  only the current chapter is named, never abbreviated)
├──────────────────────────────────────────┤
│ maintenance ≈ 2 740 · likely 2 390–3 090 ▾│ live readout rail (sticky 40 h, chassis-2);
├──────────────────────────────────────────┤ ▾ opens the DriverBar sheet
│ do you work or study outside home        │ receipts: answered turns, 1 line each,
│ · yes ······························ change│ tap "change" to reopen in place
│ on a work day · desk or driving ··· change│
│ ─────────────────────────────────────────│
│ How many days a week, and about          │ ACTIVE TURN — prompt 17/600
│ how long?                                │
│ why we ask ▾                             │
│ days   [ −    5    + ]                   │ Stepper
│ hours  [4] [6] [●8] [10] [12]            │ preset chips (one tap commits the pair)
│ if you skip: 5 days × 8 h                │ default line, ink-3
│                          ask me later    │ quiet key
│                                          │
│ (next turns are not shown until reached) │
├──────────────────────────────────────────┤
│ Skip this part            3 of 10        │ action bar: quiet "Skip this part" · count
└──────────────────────────────────────────┘
```

- No tab bar during setup (`?from=setup`); with `?from=body` the normal shell shows.
- The active turn sits at ~35 % of the viewport; receipts above it scroll away naturally.
- Answer keys stack 2 per row; cards with examples (job types) stack 1 per row, 72 px tall.

## 4. Layout — desktop (1440 px)

```
┌────┬──────────────────────────────────────────────────────────────────────────────────────────┐
│ ●  │ A normal day        a normal day ━━━━ · training ──── · food ──── · devices ──── Skip this part│ context bar
├────┼──────────────────────────────────────────────────────────────────────────────────────────┤
│    │        ┌─ conversation column, max 640 ─────────────┐  ┌─ Your picture so far · 360 ──────┐ │
│    │        │ receipts …                                  │  │ maintenance                       │ │
│    │        │                                             │  │ about 2 740 kcal a day            │ │
│    │        │ On a work day, what are you mostly doing?   │  │ likely 2 390–3 090                │ │
│    │        │ ┌──────────┐┌──────────┐┌──────────┐        │  │ ▕███████▌▓▓▌▒▒▌░▕  DriverBar      │ │
│    │        │ │ sitting  ││ a mix of ││ on my    │        │  │ biggest unknown: your steps       │ │
│    │        │ │ at a desk││ sitting  ││ feet most│        │  │ ───────────────────────────────── │ │
│    │        │ │ or driving│ and moving│ of the day│       │  │ training   3 × 30 min · home kit  │ │
│    │        │ └──────────┘└──────────┘└──────────┘        │  │ food       vegetarian · Jain      │ │
│    │        │ ┌──────────┐┌──────────┐                    │  │ devices    ring · 4 streams       │ │
│    │        │ │ physical ││ heavy    │                    │  │ asked later  3 questions          │ │
│    │        │ │ work     ││ physical │                    │  └───────────────────────────────────┘ │
│    │        │ └──────────┘└──────────┘                    │   sticky; updates on every commit      │
│    │        │ if you skip: a mix ·  ask me later          │                                        │
│    │        └─────────────────────────────────────────────┘                                        │
└────┴──────────────────────────────────────────────────────────────────────────────────────────┘
 grid: minmax(0,640px) | 360, gap 32, centred; rail hidden < 1024 (becomes the sticky readout rail)
```

- **768–1023**: single column at 640 max; the readout rail from mobile stays.
- The "Your picture so far" faceplate is the instrument reacting: maintenance and its band move as
  activity answers land (needle ease on the readout, digit roll), the other lines fill in as later
  chapters are answered.

## 5. Regions & components

| Region | Components | Notes |
|---|---|---|
| Top/context bar | TopBar, 4-segment Progress scale, Key quiet "Skip this part" | segment = chapter; fill = answered + deferred share |
| Live readout | Readout `sm` + RangeBar, Popover/Sheet with DriverBar | mobile sticky rail; desktop right faceplate |
| Turns | IntakeTurn (prompt, why, AnswerKeys / Chips / Stepper / ScaleRange / rows), receipts | `COMPONENTS §13.1` |
| Maintenance result | Faceplate, Readout `md`, DriverBar + table twin, "Correct it" Sheet | end of chapter 1 |
| Equipment | Kit keys (presets) → grouped Chip checklist, weight chips | chapter 2 |
| Food | preset keys → Chip checklist, rank chips (cuisines) | chapter 3 |
| Devices | device keys, route cards, StreamMatrix, Key "Import a file", Key "Connect ring" | chapter 4 |
| Summary | Faceplate "What we'll use", KeyValueList, deferred list | `/onboarding/summary` |

## 6. Content & copy

General rules: questions use concrete nouns, times and counts — never "how active are you?".
Every question shows **"if you skip: …"** with the default it will use. "I don't know" is a real
answer where it exists. Examples on cards are local first (India locale shows Indian examples
first; others follow) and both sets are always available.

### 6.1 Chapter 1 · A normal day (`activity`) — 10 questions, about 90 s

Chapter intro (one line above the first turn): "A few questions about a normal week. They set how
much energy you use outside training — the number every plan is built on."

| # | Prompt | Answers (one tap unless noted) | If you skip | Branching |
|---|---|---|---|---|
| A1 | Do you work or study outside the home most weeks? | yes · no (retired, at home, caring for family) · it varies | unknown | no → skip A2–A4, work = not working; "it varies" → A3 asks "on average" |
| A2 | On a work day, what are you mostly doing? | 5 cards: **sitting at a desk or driving** (office, driving, call centre, seated shop counter) · **a mix of sitting and moving** (lab, teaching, field sales, managing a floor) · **on my feet most of the time** (retail, hospitality, nursing, salon, security) · **physical work: lifting, carrying** (trades, warehouse, cleaning, delivery) · **heavy physical work** (construction, farm work, loading, removals) | a mix (most common) | — |
| A3 | How many days a week, and about how long? | days Stepper 1–7 (default 5) + hours chips 4 · 6 · 8 · 10 · 12 | 5 days × 8 h | — |
| A4 | How do you get there? | ride (car, two-wheeler, auto, bus, train, metro) · walk part of it · cycle · I work from home; walk/cycle → "minutes a day, both ways" chips 10 · 20 · 30 · 45 · 60 | ride, 0 min | with a step-counting device, walking minutes are not added again (the device counts them); cycling minutes always count |
| A5 | Do you know your daily steps? | yes, from a watch or ring · yes, from my phone · roughly · no | no | yes → A5a; phone → A5b; roughly → steps scale; no → steps come from A2, A4, A6 |
| A5a | About how many a day, over the last 2–4 weeks? | chips 3 000 · 5 000 · 7 000 · 9 000 · 12 000 · 15 000 + exact Stepper; "work days and days off differ" → two Steppers; "I'll import it" (→ chapter 4 revises it) | — | — |
| A5b | Is your phone with you most of the day? | mostly · not really | mostly | "not really" widens the range |
| A6 | On a day off, you're mostly… | at home, taking it easy · a bit of both · out and about, on my feet | a bit of both | — |
| A7 | At home, how much are you on your feet — cooking, cleaning, washing, children, caring? | a little (under 1 h) · some (1–2 h) · a lot (3 h or more) | some | — |
| A8 | Any sport or active hobby that isn't your planned training? (cricket, badminton, football, dancing, hiking, gardening) | none · add: name + light / moderate / hard + minutes a week (rows) | none | listing gym, running, yoga, dand-baithak → "That sounds like training — count it there instead?" [Move to training] [Keep it here] |
| A9 | Do you train now, on purpose? | not now · 1–2 times a week · 3–4 · 5 or more; then "mostly" lifting · mixed · mostly cardio | not now | sets current training (kept "as usual" in every plan) |
| A10 | When do you usually sleep, and how well? | chips 22–06 · 23–07 · 00–08 · 01–09 · other (ScaleRange bed/wake); then "usually" poor · fair · good | 23:00–07:00, fair | timing and quality only; neither changes maintenance |

**Why we ask** lines (one per question, shown on demand):
- A2: "Your job sets about a third of the energy you use outside training. People describe their
  work best by example, so pick the card that sounds most like yours."
- A5: "Steps from a watch or ring are within about 10 % of the truth; phone counts and guesses are
  much looser, so we widen the range."
- A8: "Sport you already play is part of your normal week. Planned training is counted separately,
  so nothing is counted twice."
- A10: "Plans place meals and training around your sleep. It doesn't change your maintenance."

### 6.2 Maintenance result (end of chapter 1)

```
 ┌ Your maintenance ──────────────────────────────────────────────────────┐
 │ about 2 740 kcal a day                       likely 2 390–3 090         │ Readout md (32 wide)
 │ ▕█████████████████████▌▓▓▓▌▒▒▌░▌▒▒▒▒▒▒▒▕                                 │ DriverBar
 │ resting metabolism 1 855 · everyday living 278 · steps 266 · home 68 ·  │ table twin (mobile:
 │ digesting food 274                                                       │ always a list)
 │ ─────────────────────────────────────────────────────────────────────── │
 │ Biggest unknown: your steps are a guess. A 2–4-week average from a watch │
 │ or phone would narrow this by about ±120 kcal.          [Add steps]      │
 │ Similar to people described as "low active".                            │ comparison line
 │ This is a starting estimate. Once you follow a plan, your weigh-ins and  │
 │ logs correct it — usually within 3–4 weeks.                              │
 │ [Looks right — continue]   Correct it                                    │
 └─────────────────────────────────────────────────────────────────────────┘
```
- Headline: "Your maintenance: about 2 740 kcal a day — likely 2 390–3 090." Rounded to 10 kcal;
  the range is the 80 % likely range used everywhere in Vitals.
- **Biggest unknown** appears only when fixing it would narrow the shown range by ≥ 20 kcal;
  otherwise the calibration sentence stands alone.
- The comparison line never offers the category as something to choose; it is a description only.
- **Correct it** (Sheet / side panel), three honest paths:
  1. **Change an answer** — the driver table with a "change" key per row; what-if handles (steps
     slider, work card) update the bar live; "Keep these" commits.
  2. **I've had my resting metabolism measured** — Stepper (kcal/day) + "how: indirect calorimetry
     / a clinic test"; narrows the range.
  3. **I know what I eat to stay the same weight** — explained, not accepted: "We don't use a typed
     number here. Food diaries usually miss 10–45 % of what's eaten, so it would make your plans
     worse. Once your plan starts, your own weigh-ins and logs measure your maintenance — usually
     within 3–4 weeks." [Got it]
- Quiet mode: the kcal headline becomes "Set from your answers — open to see the numbers"; the
  driver bar shows parts without kcal; "show numbers" reveals them.

### 6.3 Chapter 2 · Training and equipment (`training`) — 10 questions, about 90 s

Intro: "What you'd be willing to do, and with what. Plans use what you already have first, and
say plainly if something would help."

| # | Prompt | Answers | If you skip |
|---|---|---|---|
| T0 | How long have you trained regularly? | never · under 1 year · 1–3 years · 3 years or more | under 1 year (beginner limits apply) |
| T1 | Which of these would you do? | 12 rows, each a 3-key bank **no · fine · like**: lifting weights · bodyweight · Indian traditional (dand, baithak, mudgar, gada) · yoga · walking · running · cycling · swimming · sports · dance · martial arts or kushti · hard intervals. Rows start unanswered; **Done** treats unanswered rows as "fine" (the default shown), so only exceptions need a tap. "no" means plans never use it. | all fine |
| T2 | Where can you train? | multi: home · a gym · a park with bars · an akhara · a pool · stairs in my building · a ground or court · a safe walking route; then (optional) "which days?" weekday chips per place | home |
| T3 | What do you have? (start from a kit, then adjust) | kit keys: **nothing yet (bodyweight)** · **a few home things** (chair, backpack, water jugs, mat) · **bands and a pull-up bar** · **dumbbells or a kettlebell** · **Indian traditional set** (mudgar, jori, gada) · **a full gym**; then the grouped checklist, pre-ticked by the kit: *weights* dumbbells, kettlebell, barbell and plates, sandbag, weighted vest · *bands and bars* mini band, tube band, long loop band, pull-up bar, dip bars, rings or suspension trainer, ab wheel · *cardio* treadmill, exercise bike, bicycle, rower, cross-trainer, skipping rope · *Indian* mudgar, mudgar pair (jori), Indian clubs, gada, steel mace, sumtola, gar nal, mallakhamb or rope · *at home* sturdy chair, table, stairs, backpack, water jugs, bucket, towel, mat · **something else** (type it — e.g. "a wooden wheel", "a sandbag I made") | nothing yet |
| T3a | How heavy? (for dumbbells, kettlebell, mudgar, gada, sandbag) | weight chips per item (e.g. 2.5 · 5 · 7.5 · 10 · 12.5 · 15 kg, multi) + "not sure" | not sure (plans use "reps to near failure" instead of kg) |
| T4 | How much time for training? | days a week 0–7 (default 3) + minutes per session 10 · 20 · 30 · 45 · 60 · 90 (default 30) + best time morning · midday · evening | 3 × 30 min, any time |
| T5 | Any pain or injury we should work around? | multi: shoulder · elbow · wrist · low back · neck · knee · ankle · hip · none; each picked → "Has a clinician cleared it for normal training?" yes · no | none |
| T6 | Do any of these apply? | multi: blood pressure that isn't under control · glaucoma · osteoporosis · pelvic-floor problems · none | none |
| T7 | Anything you won't do, or can't at home? | chips: jumping · floor work · lifting overhead · running · no noise (shared walls) · very small space + free text | nothing |
| T8 | If a plan worked better with a small purchase, would you buy it? | no · up to ₹1 000 · up to ₹5 000 · more (other locales: up to $15 · up to $60 · more) | no (plans never require purchases; only the Ideal lists them) |
| T9 | How do you want to log workouts? | just tell the Coach · quick sets × reps · detailed (weight, reps left in the tank) | quick |

- T5/T6 answers show their effect inline (InlineWarning info): "We'll leave out overhead pressing
  and hanging work for your shoulder. If a clinician clears it, you can switch this off in Your
  setup." Pregnancy and heart questions are **not repeated** here — they come from the safety
  questions answered at the start, and the line says so ("Heart and pregnancy answers from your
  safety questions already apply.").
- Something else (T3): the typed item is kept as written and resolved later into what it trains
  (by the Coach when available, else by the person picking the closest catalogue item). Nothing is
  ever rejected.

### 6.4 Chapter 3 · Food and kitchen (`diet`, `kitchen`, `supplements`) — about 90 s

Intro: "What you eat, any rules you keep, and how you cook. Recipes only ever use what you've said
yes to." Lazy questions (budget, eating out, dislikes, intolerances, cooking skill, batch cooking,
what's in the pantry) are **not asked now**: they come up the first time they matter (first
grocery list, first swap, first weekly plan), and the chapter footer says so.

| # | Prompt | Answers | If you skip | Branching |
|---|---|---|---|---|
| F1 | Which of these do you eat? | start from: vegetarian (with dairy) · eggetarian · vegan · Jain · pescatarian · everything — then adjust chips: dairy · eggs · fish · shellfish · chicken · mutton or goat · beef · pork | nothing is assumed: food stays unset and recipes pause until it is answered (food rules are never guessed) | no animal food picked → "Do you avoid any dairy?" (vegan · ghee only · all dairy is fine); eggs → "Eggs as eggs, or only inside baked food?" |
| F2 | Any food allergies? | chips: gluten cereals · crustaceans · molluscs · milk · egg · fish · peanut · tree nuts · soy · sesame · mustard · celery · lupin · sulphites · other · none; any picked → "Even traces?" strict · normal | unanswered: recipes pause until answered ("none" counts only when picked) | — |
| F3 | Do you follow any of these? | Jain · no onion or garlic · halal · kosher · Hindu fasting days · Ramadan · Lent · none | unanswered: recipes pause until answered ("none" counts only when picked) | Jain → its own checklist (root vegetables · onion and garlic · honey · eating after sunset · fermented food · mushrooms · green leafy vegetables on certain days), each separately; Hindu fasting → days or periods (weekday chips + Ekadashi · Navratri · Shravan · custom) and "what do you eat then?" (vrat foods · fruit and milk only · nothing); Ramadan → hands the fasting window to the planner |
| F4 | Any days you skip meat or eggs? | weekday chips (shown only if meat or eggs are eaten) | none | — |
| F5 | Which food do you eat most often? | cuisine chips, ranked by tap order (first tap = most often): north Indian · south Indian · Gujarati · Bengali · Maharashtrian · Punjabi · Kerala · Goan · Indo-Chinese · Mediterranean · American · British · Mexican · East Asian · Middle Eastern · other (locale sorts the list) | locale default | — |
| F6 | Who cooks most of your meals? | I do · family · a paid cook · tiffin or mess · I mostly eat out · a mix | I do | family / cook / tiffin → "What does a normal lunch and dinner look like?" (free text) and **family-food mode**: plans adjust portions and add-ons, not dishes; F7–F8 are skipped |
| F7 | What can you cook with? | chips pre-ticked for the locale (India: pressure cooker, tawa, kadhai, gas, fridge; elsewhere: oven, fridge, freezer, blender) + induction · mixer-grinder · idli steamer · microwave · OTG oven · air fryer · rice cooker · Instant Pot · slow cooker · grill · freezer · kitchen scale | locale defaults | — |
| F8 | On a weekday, how long for a main meal? | under 10 min · 10–20 · 20–40 · 40+ | 10–20 | — |
| F9 | Do you drink alcohol? | no · now and then · most weeks (→ drinks a week) | not asked | Copy: "Plans count it like any other energy. No judgement either way." |
| S1 | Food first, or open to supplements? | **food first** · **open to supplements** · I already take some (→ pick from list with dose and time) | food first | food first → no products are ever suggested; safety flags (e.g. B12 for vegetarians) still appear as "consider testing — ask a doctor" |

- Allergy and rule answers are **hard filters**: the chapter states it once ("Recipes will never
  include these, not even as a garnish.").
- Medical diets (kidney, warfarin, diabetes) are never asked here; they come from the safety
  answers and appear read-only: "From your safety answers: low sodium."

### 6.5 Chapter 4 · Devices and data (`devices`) — about 60 s

Intro: "If you wear a ring or watch, or use a smart scale, Vitals can use its data. You choose,
stream by stream, what comes in and who sees it. Nothing leaves your devices unless you set up
sync or talk to the Coach."

| # | Prompt | Answers | If you skip |
|---|---|---|---|
| D1 | Do you wear or use any of these? | ring · watch · fitness band · smart scale · chest strap · just my phone · none | none (all streams stay off) |
| D2 | Which one? (per device) | search field with brand list (Oura, Apple Watch, Garmin, Samsung, Fitbit/Google, WHOOP, Polar, Amazfit/Zepp, Colmi, J-Style ring, Ultrahuman, RingConn, Withings, Polar H10, other) + "not sure"; then "your phone" Android · iPhone · computer only | not sure |
| D3 | How it reaches Vitals | a route card per device (computed, not a question): e.g. **Oura on Android** → "Oura writes to Health Connect. Vitals can't read Health Connect from a web page, so you export a file from it (or, later, a small helper app sends it)." [Import a file] [Later] · **Colmi ring + Chrome on Android/computer** → "Connect directly. Sync happens while Vitals is open; close the ring's own app first." [Connect ring] [Later] · **iPhone** → "Export from Apple Health, or use a Shortcut that saves a file each day." [How to] [Later] | later |
| D4 | What should Vitals do with each stream? | StreamMatrix (`COMPONENTS §13.15`) with **Use recommended** (bring in + scores + plan on where allowed; Coach hidden) and **Coach can see daily summaries** | recommended is **not** applied on skip — skipped means everything stays off |
| D5 | (after an import) | Import report: "Imported 182 days · 31 400 records · 112 duplicates skipped · sleep, heart rate, HRV, steps." + revisions: "Your watch says 7 820 steps a day over the last 28 days. Use this instead of 'roughly 6 000'?" [Use 7 820] [Keep mine] | — |

Privacy lines (always visible in this chapter):
- "Device data stays on your devices. There is no Vitals server for it."
- "The Coach sees a stream only if you choose 'daily' or 'daily + detail' for it, and only when
  you talk to it. It never sees vendor scores unless you allow them, and they're labelled as the
  vendor's opinion."
- "Ring and watch indexes are estimates, not measurements. Vitals computes its own scores from the
  raw data and shows how sure each one is."

### 6.6 What we'll use (`/onboarding/summary`, first run)

One Faceplate, a KeyValueList by chapter, each row with "change":
> **Here's what Vitals will work from.**
> a normal day · desk job 5 × 8 h, about 6 700 steps, home "some", 3 lifts a week · maintenance
> about 2 740 kcal (likely 2 390–3 090)
> training · home: dumbbells 5–10 kg, pull-up bar · 3 × 30 min · no jumping · shoulder: no overhead
> food · vegetarian with dairy and eggs · Jain: no root vegetables, no onion/garlic · north Indian,
> Gujarati · you cook, 10–20 min · food first
> devices · Colmi R10 ring: sleep, heart rate, steps in · Coach sees nothing yet
> asked later · 3 questions (Body › Your setup)
> [Looks right — continue] (solid)

## 7. Interactions

- **One tap commits** single-choice answers and advances after 240 ms. Multi-select and numbers
  commit with "Done" (or a preset chip). Enter = Done; Esc on a reopened receipt = cancel.
- **Change** on a receipt reopens that turn in place; later turns that depend on it (branching)
  re-evaluate: answers that no longer apply are kept but marked "not used" (never silently
  deleted), and newly needed questions insert after it.
- **Ask me later** on any turn; **Skip this part** in the chapter header (Dialog-free: a toast
  "Skipped 'training'. Plans use the defaults · Undo").
- **Autosave**: every commit dispatches `intake.answer` (low-impact write, undoable); the live
  readout updates from `profile.explainMaintenance` (≤ 16 ms, closed form).
- **Coach alternative**: "Answer by chatting instead" (when a provider is set) opens `/coach` with
  an onboarding conversation; answers it records come back as log-class change cards, and the
  chapter's receipts fill in.
- **Locale**: currency, examples and cuisine order follow the locale; units follow Settings › Units.
- Keyboard: Tab moves into the answer group; arrows move between answer keys; Space/Enter commits;
  `L` = ask me later.

## 8. States

| State | Behaviour |
|---|---|
| First run | chapters in order; summary at the end; no tab bar |
| Reopened from Body | starts at the first unanswered question of that chapter, receipts above |
| Question set updated (newer `questionSetVersion`) | answered questions keep their answers; new questions appear in Body › Your setup as "1 new question" (never forced) |
| Defaulted answers | receipts show "using … · asked later" with a hollow dot; the DriverBar outlines those segments dashed |
| Food skipped | Food tab recipes are paused: "Tell us what you eat to get recipes" (targets still shown as plain meals) |
| Devices skipped | every stream off; Progress › Body signals shows "Add a device" |
| Import fails (wrong file, too new, damaged) | InlineWarning danger in the D5 turn with the reason and "choose another file"; nothing is written |
| Web Bluetooth unavailable (Safari, Firefox, iOS) | the "Connect directly" route is replaced by the import route with one line: "Direct connection needs Chrome or Edge on Android or a computer." |
| Gentle mode | maintenance is shown without kcal by default; no weight is asked again; F9 alcohol is skipped |
| Storage unavailable | caution Notice: answers won't persist after this tab closes |

## 9. Accessibility

- Each turn is a `fieldset` with its prompt as `legend`. Single-choice answer keys are **buttons**
  in a group (roving focus: arrow keys move focus only; Space/Enter commits, and the chosen key
  gets `aria-pressed="true"`) — never a radiogroup, because a radiogroup selects on arrow keys and
  these commit and advance; multi-select keys are checkboxes. All have visible labels; examples are part of the accessible name ("sitting at a desk or driving —
  for example office, driving, call centre").
- Focus moves to the next turn's legend after a commit; the receipt is announced politely
  ("Saved: on a work day, desk or driving").
- The 4-segment progress is a `role="progressbar"` with `aria-valuetext="A normal day, 3 of 10"`.
- The DriverBar always has its table twin; segments are never identified by colour alone.
- The StreamMatrix is a table with row and column headers; switches carry full names ("Use HRV in
  my plan").
- Targets 44 px; answer cards ≥ 64 px tall; body text 15 px, inputs 16 px on mobile.
- Reading level ~12 years; medical words get plain examples.

## 10. What the engine supplies (and what the UI must not compute)

| Need | Source |
|---|---|
| Questions, order, branching, defaults, `missingFields` | `intake.nextQuestions {section}` → `IntakeQuestion[]`; completeness is decided by code, not the UI |
| Saving answers / skips | `intake.answer` / `intake.skip {section, answers}` → `IntakeView` (undoable) |
| Maintenance, band, drivers, biggest unknown | `profile.explainMaintenance` → `MaintenanceExplanation { tdee0Kcal, sigmaKcal, drivers: tdee0Drivers{rmr, dailyLiving, steps, work, home, commute, recreation, training, digestion}, defaulted: driverId[], biggestUnknown?: {driver, text, narrowsByKcal}, palBandLabel }` (UI shows 80 % = ±1.28 σ) |
| What-if (driver sheet) | `profile.explainMaintenance` with a draft `ActivityIntake` (no write) |
| Equipment list, kits, weights | `catalogue.equipment` (64 items, 15 categories; kits are UI presets that expand to ids) |
| Custom items ("a wooden wheel") | `catalogue.addEquipment` / `catalogue.addExercise` (origin user / ai-resolved) |
| Diet rules → hard filters | `DietProfile` (stored as given; the derived diet level is computed by `intake.answer`) |
| Supplements list | `catalogue.supplements` |
| Device routes | static table by device × platform × browser (`bio` capabilities); Web Bluetooth availability check |
| Stream consent | `bio.setPolicy {stream, policy}` — UI only; the Coach can never set it |
| Imports | `bio.import` (job) → `IngestReport` |
| Steps revision after import | `bio.daily` 28-day mean vs `ActivityIntake.steps` |

### 10.1 Answer → stored value (where the wording and the schema differ)

| Answer | Stored as |
|---|---|
| A1 "it varies" | working; A2 class as answered; A3 days "on average" (may be fractional, rounded to 0.5) |
| A4 "ride (car, two-wheeler, auto, bus, train, metro)" | `commute.mode = 'passive'` (`'mixed'` is not offered) |
| A5 watch or ring | `steps.source = 'wrist'` (rings count as wrist until the schema gains a ring source) |
| A8 intensity "hard" | `'vigorous'` |
| T0 never · under 1 year · 1–3 years · 3+ years | experience → skill 1 · 2 · 3 · 4 (beginner limits for the first two) |
| T1 no · fine · like | enjoy −2 (hard filter) · 0 · +1 |
| T5 cleared by a clinician = yes | injury kept for the record, no exercise filter |
| T6 "blood pressure that isn't under control" | the hypertension filter (controlled pressure is not asked) |
| T8 no · ₹1 000 · ₹5 000 · more | purchase allowance price tier 0 · ≤ 1 · ≤ 2 · ≤ 3, up to 2 items |
| F6 "I mostly eat out" | `whoCooks = 'mixed'` + eating out ≥ 7 meals a week (lazy question skipped) |
| F8 under 10 · 10–20 · 20–40 · 40+ | weekday time budgets (breakfast/lunch/dinner, min) 5/10/10 · 10/15/20 · 10/20/30 · 15/30/45; weekend = dinner + 15 |
| S1 "I already take some" | `supplements.stance = 'open'` + `taking[]` (a food-first person can still list what they take) |
| D1 smart scale · chest strap · just my phone | `scale` · `chestStrap` · `phoneOnly` |

Open with engineering (does not change the screens): the "hip" injury option has no exercise tags
yet in the catalogue; until it does, the receipt says "hip: noted — tell the Coach what hurts".

## 11. Decisions & rationale

- **Conversation, not chat.** Turns are questions with keys, not chat bubbles: it keeps one-tap
  answers, shows what's coming next only one step ahead, and leaves free-form talk to the Coach.
- **Defaults are visible, never preselected.** Showing "if you skip: …" respects the person's time;
  not preselecting keeps answers honest (people otherwise accept whatever is lit).
- **Current training is asked in "a normal day"**, not in the training chapter, because it is part
  of today's maintenance; the training chapter is about what plans may use.
- **Food rules are never defaulted.** Allergies and religious rules can't be guessed safely, so an
  unanswered food chapter pauses recipes instead of assuming.
- **A typed maintenance number is refused, kindly.** Self-reported intake is too unreliable; the
  person's own logs correct the estimate within weeks, and the screen says exactly that.
- **Consent is per stream and per use** (bring in · scores · plan · Coach), with the Coach hidden by
  default, because "I want my sleep in Vitals" is not "I want an AI to read my sleep".
