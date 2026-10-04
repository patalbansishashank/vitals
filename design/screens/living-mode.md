# Screens — Living mode: Today, Food, Train, Coach, Progress (`/today`, `/food`, `/train`, `/coach`, `/progress`, `/plan/active`)

> v0.2 (2026-10-01). Navigation and the mode rules: `INFORMATION_ARCHITECTURE.md §3.4–§3.7, §4.7–
> §4.12`. Contracts: `docs/SUITE_SPEC.md` §3 (lifecycle, prescription, log, adherence, drift,
> `TodayView`), §5 (Coach, change review, photo logging), §6 (modes, routes), §8 (catalogues,
> equivalence). Research: living plan and conversational logging (R11), equipment (R3), food and
> supplements (R4), AI providers (R8). Components: `COMPONENTS.md §13.8–13.13, §13.16–13.18`.
> Tab names Today / Food / Train / Coach / Progress are provisional until the owner confirms.
> All numbers, names and dates in this spec are synthetic examples, not real data.

## 1. Purpose

Once a plan is started, Vitals stops being a planning bench and becomes a daily instrument: what
to eat and do today, a ten-second way to say what happened, an honest reading of whether it is
working, and a coach that can do anything the person can — always showing what it changed and
letting them undo it. The rules that shape every screen here:
- **Logging is tiered and forgiving.** Ten seconds of taps is a complete day; more detail is
  optional; a gap is "unknown", never "failed", and never lowers a score.
- **One verdict, one action.** Drift is ahead / on track / behind with a date range and a cause,
  never red, never "make up for yesterday".
- **Everything estimated carries its source and range.** "≈ 640 kcal (510–780) · Coach · photo".
- **Nothing changes behind the person's back.** Automatic changes only ever lower load and show on
  Today with Undo; anything else is a proposal.

## 2. Mode, navigation and shared elements

- **Living mode** exists while a plan is scheduled, active or paused. Tabs: **Today** (home) ·
  **Food** · **Train** · **Coach** · **Progress**; Evidence, Planning tools and Settings are in the
  rail's lower group (desktop) or the overflow menu (mobile). Full rules: IA §3.4–§3.6.
- **Today menu** (⋯ in Today's context row; also reachable from Plan details): Re-plan the rest
  (same goals) · Re-plan from scratch · Check in now (from 2 days before check-in day) · Pause
  plan · End plan… · Plan details · Planning tools.
- **Date strip** (`COMPONENTS §13.8`) on Today, Food and Train: same selected date across the three
  (moving to Thu on Food shows Thu on Train). Past dates are editable (backfill); future dates are
  read-only previews ("Preview · the plan may still change").
- **Coach log bar** — the single-line CoachComposer above the tab bar on Today (mobile) / at the
  foot of Today's left column (desktop): "Tell the Coach what you did…" + photo key.
- **Quiet mode** — when on (default in gentle mode — provisional until the owner confirms): remaining energy, adherence numbers, weight
  and meal kcal become words (`COMPONENTS §13.9` vocabulary); "show numbers" reveals them per view.
- **No push notifications in v0.2.** Everything is in-app; at most one weekly prompt (check-in).

## 3. Notices on Living screens (priority order, max 2 visible, then "+n more")

1. Safety pause (danger; cannot be dismissed while it holds).
2. Danger warnings on the forecast (verbatim rule text, risk first).
3. Proposals waiting (ChangeCard `edit`, from re-plans, scores or the Coach).
4. Applied automatic changes from today (ChangeCard `log`-style with Undo: "Tomorrow's food is
   5 % lower to absorb yesterday's dinner · Undo").
5. Check-in due.
6. Welcome back / minimal mode / plan complete / sync problems / "edited on two devices".

---

## 4. Today (`/today`, `/today/:date`)

### 4.1 Layout — mobile (375 px)
```
┌──────────────────────────────────────────┐
│ ● vitals  Today                  ◔  ⋯    │ top bar: sync pill (icon) · overflow
├──────────────────────────────────────────┤
│ Wed 15 Oct · day 15 of 84            ⋯   │ context row · Today menu
│ Spring cut · medium                      │ engraved
│ mon tue [wed] thu fri sat sun    ‹ ›     │ DateStrip
│  13  14   15   16  17  18  19            │
│  ◔   ◕    ◍    ·   ·   ·   ·             │
├──────────────────────────────────────────┤
│ ◇ Proposal · an easier session today  ›  │ notices zone (≤ 2)
├──────────────────────────────────────────┤
│ ┌ Today's plan ─────── [Mark day ✓] ───┐ │ Faceplate · header key = T0 "all as planned"
│ │           ╭─ 00 ─╮                    │ │ ClockRing 200: eating window, meals,
│ │      18 ─ │fast  │ ─ 06               │ │ session tick, sleep arc, yellow now-hand
│ │           │2 h to│                    │ │ centre: fast state / "eat until 20:00"
│ │           ╰─ 12 ─╯                    │ │
│ │ 07:00 ⚖ weigh in    [ 83.4 kg ]  [✓] │ │ PrescriptionRows (time order)
│ │ 12:30 ◍ lunch  640 kcal · 40 g   [ ] ›│ │
│ │ 17:30 ⊟ lift 45 min · mudgar,    [ ] ›│ │
│ │         dand, baithak                 │ │
│ │ 19:30 ◍ dinner 820 kcal · 55 g   [ ] ›│ │
│ │ ── untimed ───────────────────────── │ │
│ │ ⌁ steps 9 000     6 120 · ring   [◐]  │ │
│ │ ◷ sleep 7 h 10 · ring            [✓]  │ │
│ │ ◫ creatine 5 g                    [ ]  │ │
│ │ how hard was today?  1 2 3 4 5         │ │ shown after 18:00 or once ≥ 3 rows are ticked
│ └────────────────────────────────────────┘ │
│ ┌ So far ──────────────────────────────┐ │
│ │ ◍ 62     so far · based on 4 of 6     │ │ AdherenceDial sm + coverage
│ │ eaten   ≈ 1 240 of 2 050 kcal          │ │ EstimateReadout (likely 1 090–1 390)
│ │ protein ≈ 88 of 150 g                  │ │
│ │ 6 of the last 7 days logged            │ │
│ └────────────────────────────────────────┘ │
│ ┌ Against the forecast ────────────────┐ │
│ │ ▁▂▂▃▂▂▁ trend 83.1 kg                 │ │ 7-day TrendLane (CHART_SPEC §7.8)
│ │ expected today 82.8–83.6 · on track   │ │
│ │ goal date likely 21–30 Dec            │ │
│ └────────────────────────────────────────┘ │
│ ┌ Body signals ────────────────────────┐ │ ScoreTile strip (3), only if streams are on
│ └────────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ Tell the Coach what you did…     ⌷   ➤  │ log bar
├──────────────────────────────────────────┤
│ Today  Food  Train  Coach  Progress      │
└──────────────────────────────────────────┘
```

### 4.2 Layout — desktop (1440 px)
```
┌──────────┬────────────────────────────────────────────────────────────────────────────────────────────┐
│ ●        │ Today · Wed 15 Oct      day 15 of 84 · Spring cut (medium)            ◔ synced 14:02   ⋯   │
│ day 15/84├────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ DateStrip (full width, 7 days + week arrows)                                                │
│ today    │ ┌ Today's plan ─────────────────────── 7 col ┐ ┌ notices ─────────────────── 5 col ┐       │
│ food     │ │ ClockRing 240 │ PrescriptionRows             │ │ proposal / applied change cards    │       │
│ train    │ │               │ …                            │ └────────────────────────────────────┘       │
│ coach    │ │               │ how hard was today? 1–5      │ ┌ So far ────────────────────────────┐       │
│ progress │ └──────────────────────────────────────────────┘ │ AdherenceDial md · eaten · protein  │       │
│──────────│ ┌ Tell the Coach ───────────────────────────────┐ └────────────────────────────────────┘       │
│ evidence │ │ CoachComposer + the last 3 change cards        │ ┌ Against the forecast ──────────────┐       │
│ planning │ │ ("Logged lunch · Undo", …)                     │ │ TrendLane 14 days + drift line      │       │
│ settings │ └────────────────────────────────────────────────┘ └────────────────────────────────────┘       │
│          │                                                    ┌ Body signals ───────────────────────┐       │
│          │                                                    └────────────────────────────────────┘       │
└──────────┴────────────────────────────────────────────────────────────────────────────────────────────┘
 grid: 12 columns, 7 | 5, gap 16; ≥ 1280 the ClockRing sits left of the rows inside one faceplate;
 rail labels are full words, never abbreviated
```
- **1024–1279**: 7 | 5 still; ClockRing 200 above the rows. **768–1023**: single column, order as
  mobile, the log bar becomes a faceplate at the end.
- First viewport target (1440 × 900): plan, So far and Against the forecast fully visible.
  "Today must read in 5 seconds."

### 4.3 Content & copy
- **Context row**: "Wed 15 Oct · day 15 of 84" (tabular) + plan name and rung (engraved).
- **Today's plan** faceplate title "Today's plan"; header key "Mark day as planned" (T0 `all`);
  intentions line under the title, once per day: "Weigh in at 07:00 before breakfast · missed a
  session? do it tomorrow".
- **Rows** (PrescriptionRow): label = what to do, target = numbers or the concrete plan ("lift 45
  min · mudgar two-hand swing, dand, baithak"); › opens the row sheet: **as planned · partly ·
  skipped · something else**, plus the item editor (meal: open in Food; session: open in Train;
  fast: "broke it at 14:30"; weigh-in: Stepper; steps/sleep: value + source).
- **Fast** row and centre readout: "fast · 14 h done, 2 to go" / "eating window 12:00–20:00" /
  "fast broken at 14:30 — 18 of 24 h counted". Never "failed".
- **So far**: dial + "62 so far · based on 4 of 6 items" (coverage line only when < 0.6) + eaten
  and protein vs targets with ranges + headline "6 of the last 7 days logged" (never a streak).
  Tap the dial → item breakdown: "the 45-min lift is still open — it carries 30 % of today".
- **Against the forecast**: "trend 83.1 kg · expected today 82.8–83.6 · on track" + "goal date
  likely 21–30 Dec". A weigh-in far outside the expected range is flagged, never removed: "This
  weigh-in is unusual (+1.6 kg). Salt, travel, a late meal or illness? It's kept but weighs less."
- **Body signals**: up to three ScoreTiles (sleep, HRV status, resting HR) with "plan assumed 7.5 h,
  you slept 6 h 10 — tomorrow's session is lighter · Undo" (load-lowering changes apply with Undo
  while "Let the plan ease itself" is on — the default; otherwise they wait as proposals).
- **How hard was today?** 1–5 KeyBank: "1 easy · 3 OK · 5 very hard" (feeds learning; optional).
- Quiet mode: "eaten: about half of today's food" / "adherence: mostly"; trend shown as "on track"
  without kilograms.

### 4.4 Interactions
- **T0 (≤ 10 s)**: tick rows or "Mark day as planned"; type a weigh-in (Stepper, `W` focuses).
  Each tick dispatches the row's command; tapping the tick again within 5 s undoes it; later, Undo
  is in the toast and history.
- **T1 (≤ 60 s)**: › on a row → partly / skipped / something else.
- **T2**: the log bar (text, photo); Food and Train for detail.
- **Day rollover** at 04:00: yesterday becomes "so far → final" when confirmed or at next rollover;
  an unconfirmed day is labelled "so far" in history.
- **Light re-plans** (a departed day): the change appears as an applied notice with Undo ("You ate
  about 400 kcal more yesterday. Tomorrow and Friday are 5 % lower. · Undo") — never same-day
  compensation, never more than 10 % over 1–3 days.
- `[` `]` move days; `Space` on a row = as planned; `⇧Space` = row sheet.

### 4.5 Weekly check-in (card on Today → sheet)
Card: "Weekly check-in · Thursday · 4 weigh-ins this week" [Check in] (available up to 2 days
early). Sheet sections:
1. **Trend**: 14-day TrendLane with the forecast band; "trend −0.6 kg this week (likely −0.3 to
   −0.9); the forecast expected −0.5".
2. **Verdict** (one): on track / ahead / behind with goal date range and shift ("moved by +9 days,
   ±6"), cause sentence ("Mostly adherence: two of three sessions were skipped." / "You followed
   the plan; your body is burning about 120 kcal a day less than assumed. The plan is updated.").
3. **Adherence**: per-block bars (training · protein · energy · fasting · steps) and the item that
   cost most ("Thursday's lift carried 30 % and was skipped twice").
4. **This week's proposal**: ChangeCard `edit` (diff + goal-date range before → after); Apply /
   Keep the plan.
5. Next check-in date.
Not enough weigh-ins: "We need at least 4 weigh-ins in 7 days, or 10 in 14 days, to read your trend (you have 2).
Adherence is below. Weigh in on 2 more mornings." — the verdict section is replaced, not faked.

### 4.6 Today states
| State | What Today shows |
|---|---|
| Scheduled (start ahead) | Faceplate "**Spring cut starts tomorrow (Thu 16 Oct).**" + Before day 1: things to buy (needed first), groceries for the first 3 days (→ Food), "first weigh-in tomorrow 07:00, after the bathroom, before eating"; a read-only preview of day 1 (ClockRing + rows); [Change start date] [Discard plan] (24 h, nothing logged) |
| Active | as drawn |
| Paused | Notice "**Paused since Mon 13 Oct.** Your usual days until you resume; what you log still counts." [Resume] (proposal shows the new end date "now ends 2 Jan") |
| Safety pause | danger Notice with the rule's title and message, then "Your plan is paused. Only you can resume it." [See what changed] [Resume…] (acknowledgement dialog) |
| Welcome back (≥ 2 days away) | "**Welcome back. Nothing to catch up on.** Today's plan is below." + "Fill the 3 missed days in as planned?" [Yes, as planned] [Leave them empty] (backfilled days are marked assumed and never scored) |
| Minimal mode | "Today shows just the essentials: tick what you did and weigh in. The plan still works with that." [Show everything] — shown once; the Coach says the same once a week at most |
| Plan complete | "**Spring cut is complete.** Fat mass −7.2 kg (likely 6.1–8.3) in 12 weeks; adherence averaged 81." [Keep the result] (maintenance scenario) [Plan again] |
| Past date (`/today/:date`) | same layout, "Fri 10 Oct · day 10" + rows editable (backfill) + "this day's plan as it was" (frozen prescription) |
| Future date | read-only preview, "the plan may still change" |
| Engine/forecast failure | logging still works; Against the forecast reads "Forecast not updated · Try again"; nothing is lost |
| Edited on two devices | Notice "Lunch on Tue was edited on two devices." [Keep phone's] [Keep laptop's] |
| Quiet mode | numbers → words; "show numbers" per view |

---

## 5. Food (`/food`, `/food/:date`)

### 5.1 Layout — mobile
```
┌──────────────────────────────────────────┐
│ Food · Wed 15 Oct                    ⋯   │ ⋯: Use what's in my kitchen · Pantry · Things that won't help
│ DateStrip                                 │
├──────────────────────────────────────────┤
│ ┌ Targets ─────────────────────────────┐ │
│ │ 2 050 kcal · protein 150 g ·          │ │ prescription (no band) + eaten so far (band)
│ │ carbs 180 g · fat 70 g · fibre 30 g   │ │
│ │ ▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒░░░░░ eaten ≈ 1 240     │ │ macro micro-bar target vs eaten
│ └───────────────────────────────────────┘ │
│ ┌ Meals ───────────────── [Plan my day] ┐ │ default key; needs an AI provider
│ │ 12:30 lunch · 640 kcal · 40 g protein  │ │ slot header
│ │  Paneer bhurji, 2 rotis, cucumber raita│ │ suggested recipe (collapsed)
│ │  20 min · tawa · fits targets          │ │
│ │  [Accept] [Swap]                  ›    │ │
│ │ ───────────────────────────────────── │ │
│ │ 19:30 dinner · 820 kcal · 55 g protein │ │
│ │  accepted: Chana masala, rice, salad   │ │
│ │  [I ate this] [I ate something else] › │ │
│ └───────────────────────────────────────┘ │
│ ┌ Groceries · next 3 days ──── 14 items ┐ │
│ └───────────────────────────────────────┘ │
│ ┌ Supplements ──────────────────────────┐ │
│ │ creatine 5 g · any time        [taken]│ │
│ │ vitamin B12 — consider testing ›      │ │
│ └───────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ Today  Food  Train  Coach  Progress      │
└──────────────────────────────────────────┘
```
Desktop (≥ 1024): two columns — left 8: Targets + Meals; right 4: Groceries, Supplements, Pantry.

- Mobile action bar (only when the grocery list has items): "Groceries · 14 items ›" → scrolls to
  the list.

### 5.2 Meals and recipes
- Each **meal slot** comes from the day's prescription: time, slot name, energy and protein (and
  carbs/fat in the detail). Without a recipe the slot shows **plain targets** ("about 40 g protein,
  70 g carbs, 20 g fat — for example dal, rice and curd") — this always works, with or without AI.
- **Plan my day** (default key; needs an AI provider): generates recipes for the open slots from
  allowed foods only; progress rule per slot ("lunch… dinner…"); recipes are fitted by the app, not
  the model.
- **Recipe card (collapsed)**: dish name · cuisine · active time · equipment · the portion line in
  household units ("2 rotis + 1 katori dal + 1 katori sabzi + 150 g curd") · fit ("fits targets" /
  "closest: protein short by 8 g").
- **Recipe sheet** (›): title, cuisine, servings, active + passive minutes, equipment; ingredients
  (household unit + grams raw; "kitchen scale" users see grams only); steps (≤ 6 / ≤ 10 by skill);
  per serving: energy, protein, carbs, fat, fibre with likely ranges; "estimated composition" mark
  when a food's values are unverified ("Some values for paneer are estimates; ranges are wider.");
  "why this fits" ("adds 150 g curd to reach your protein").
- **Actions** — two distinct meanings, never merged:
  - **Accept** = plan this recipe for the slot (groceries update). **Swap** = a different dish for
    this slot only (other slots fixed; the slot's target is what remains); after a swap: "Don't
    suggest paneer bhurji again?" [Don't suggest] [It's fine].
  - **I ate this** = log the meal as planned (source "as planned", ±10 %). **I ate something else**
    = the contextual Coach composer (text or photo) or the manual logger (search foods, recents,
    "same as yesterday's lunch", grams or household units). A different dish with the same
    nutrients fulfils the meal — credit is by nutrients, never by dish.
- **Family-food mode** (someone else cooks): slots show portions and add-ons instead of dishes —
  "Eat 2 rotis, 1 katori dal, 1 katori sabzi; add 150 g curd; skip the papad".
- Logged meals show as rows with EstimateReadout + SourceChip; tap a number to edit (edits narrow
  the range and switch the source to "your grams").
- **Trust ledger** (Food footer, weekly): "This week: 9 meals as planned · 6 typed by you · 5
  estimated by the Coach." When most energy is Coach-estimated: "Most of this week's food was
  estimated from photos and text, so the weekly check-in treats it as less certain."

### 5.3 Groceries
- Horizon KeyBank `today · 3 days · week`; grouped by aisle (vegetables · dairy · staples ·
  protein · spices); buy units ("paneer 200 g pack × 2", "eggs × 12", "atta 1 kg"); checkboxes;
  "already have" marks items from the pantry; Share (text) and Print.
- Budget is not priced; the first time the list is made, the lazy question appears inline: "Roughly
  what's your food budget? tight · normal · flexible" (ask me later).

### 5.4 Supplements
- **Food first**: no products; only safety-relevant flags as text: "Vegetarian diets are often low
  in vitamin B12 — consider a test; ask a doctor." and food-first suggestions ("add 200 g curd").
- **Open**: cards for supplements relevant to the goals, each: name · dose ("3–5 g a day") · when
  · why for your goals in evidence wording ("does help muscle with training", grade A) · cautions
  ("adds 0.5–1.5 kg water on the scale — your trend accounts for it") · food-first alternative ·
  the standing line "Choose a product with third-party batch testing (for example Informed Sport or
  NSF). Vitals can't check brands." · a **taken** tick (logs it).
- Contraindicated items never show as a card: "Not shown because of your safety answers — ask your
  doctor." "Things that won't help your goals ›" lists the no-benefit items with the reason.
- Supplements the person takes change the plan (creatine, caffeine, protein) only through the
  normal proposal path.

### 5.5 Food states
| State | Behaviour |
|---|---|
| No AI provider | plain targets per slot + manual logging + groceries from accepted plain meals; one line: "Connect an AI provider to get recipes." |
| Food intake not answered | "Tell us what you eat to get recipes" → intake chapter; targets still shown |
| Generation failed | slot shows plain targets + "Couldn't make a recipe this time. Try again" |
| Closest achievable | fit line "closest: protein short by 18 g" + "add a protein-rich side?" suggestion |
| Pantry only, impossible | "Your kitchen doesn't cover today's protein. Add 2 items from the shop?" |
| Fast day | slots outside the window are hidden; "fast day — water, tea, coffee; electrolytes if over 24 h" |
| Quiet mode | portions and dishes stay; kcal and macros hidden behind "show numbers" |
| Unverified food values | "estimated composition" mark; wider ranges |

---

## 6. Train (`/train`, `/train/:date`)

### 6.1 Layout — mobile
```
┌──────────────────────────────────────────┐
│ Train · Wed 15 Oct            [today|week]│
│ DateStrip                                 │
├──────────────────────────────────────────┤
│ ┌ Lift · 45 min · home ─── ≈ 280 kcal ─┐ │ session faceplate; energy with range
│ │ with your 10 kg mudgar and mat        │ │
│ │ ─────────────────────────────────── │ │
│ │ mudgar two-hand swing                 │ │ exercise row
│ │ 6 × 20 · rest 60 s · ≈ 95 kcal        │ │
│ │ set  1 [20] 2 [20] 3 [ ] 4 5 6   [✓]  │ │ set chips (reps) by log style
│ │                            Swap ›     │ │
│ │ ─────────────────────────────────── │ │
│ │ dand (Hindu push-up)                  │ │
│ │ 3 × 15 · leave 2 reps in the tank     │ │
│ │                        [✓]  Swap ›    │ │
│ │ ─────────────────────────────────── │ │
│ │ baithak (Hindu squat) 3 × 40          │ │
│ │ [Session done]   I did something else │ │
│ └───────────────────────────────────────┘ │
│ ┌ Your equipment ───────────── Edit ───┐ │
│ │ mudgar 10 kg · mat · backpack · stairs│ │
│ │ Would help: a pull-up bar (₹) — adds  │ │
│ │ back work, +0.4 kg muscle  [Bought it]│ │
│ └───────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```
Desktop: session left 8 columns, equipment + this week right 4.

- Mobile action bar while a session is running: "lift · 12:30 elapsed" (tabular) + **Session done**;
  the timer is optional — **Start session** in the session header starts it, nothing requires it.

### 6.2 Sessions and logging
- Header: type · minutes · place · energy "≈ 280 kcal (220–340)"; the line "with your 10 kg
  mudgar and mat" names the equipment used.
- Exercise rows: name (+ local name in brackets on first use), prescription in plain words
  ("6 × 20 · rest 60 s · leave 2 reps in the tank"), energy for cardio-like items, and log
  controls chosen by the exercise's intensity scale and the person's log style: quick (reps per set
  chips), detailed (kg, reps, reps left), duration (minutes), speed/incline for treadmill.
- Per-exercise tick = as planned; **Session done** = all remaining as planned; partial shows the
  summary before saving: "3 of 4 exercises · counted 80 %".
- **I did something else** → pick or type what you did (catalogue search or free text: "wooden
  wheel rollouts 3 × 10"); the app (or the Coach for free text) resolves it into what it trains,
  shows the EquivalenceMeter verdict and saves. Unknown items are added to your catalogue — never
  rejected.
- After saving: "Counts as today's lift · 96 %" or "Partly · add 1 set of dand to make it count
  fully" or "Different work — credited to shoulders and upper back; today's run is still open."
  plus "also trained: core".

### 6.3 Swap (sheet)
Title "Swap mudgar two-hand swing". List of alternatives on **your** equipment, each with an
EquivalenceMeter, sorted by credit, then by what you like:
> kettlebell swing · needs a kettlebell (you don't have one)  — hidden unless "show all"
> gada swing · 10 kg gada · same stimulus 94 % · counts as today's swing
> backpack swing · 8 kg backpack · 78 % · partly — add 2 sets
> brisk stair climb 12 min · 52 % · different work — credited to legs and energy
Footer: "Something else…" (type it) · "Ask the Coach for options". A swap applies to today only;
"Use this swap on every Monday" is a proposal to the plan, not an instant change.

### 6.4 Equipment and things to buy
- What you have (chips; Edit → intake chapter 2); places and days.
- **Would help** (from the plan's shopping list): item · price tier (₹ to ₹₹₹₹) · what it unlocks
  · benefit in goal units ("+0.4 kg muscle by week 12") · "needed for this plan" for required items.
- **Bought it** adds the item to your equipment and produces a proposal ("Use the pull-up bar from
  Monday: 2 sessions change · goal date unchanged"). Never auto-applied: it raises load.

### 6.5 Train states
| State | Behaviour |
|---|---|
| Rest day | "Rest day. Steps target 9 000." + any mobility item from the plan |
| Session from a device | a matched workout fills the session ("Matched from your watch: run 32 min, avg HR 148") — accept or change |
| Injury filter | footnote "Overhead work is left out for your shoulder (your setup)" |
| No equipment answered | sessions use bodyweight; "Tell us what you have" → intake |
| Week view | 7 rows: day · session · minutes · status glyph; tap → that day |
| Quiet mode | energy numbers hidden; sets and reps stay |

---

## 7. Coach (`/coach`, `/coach/:conversationId`)

### 7.1 Layout
```
desktop ≥ 1280
┌──────┬────────────────────────────────────────────────────────────┬───────────────────────────┐
│ rail │ Coach · Claude Sonnet 5.5 · your key        search  ⋯       │ What the Coach knows      │
│      ├────────────────────────────────────────────────────────────┤ (docked 360, toggle <1280) │
│      │ ─── Tue 14 Oct ───────────────────────────────────────────  │ always                    │
│      │ you    had dal, rice and two eggs for lunch                 │ about you                 │
│      │ coach  Logged. That puts you at about 1 240 kcal so far…    │ your plan                 │
│      │        ⌕ looked at · today's log · plan v3               ▸  │ last 7 days               │
│      │        ┌ ✓ Logged lunch · 13:10 ── Coach · text ── 23 h ┐   │ body signals it can see   │
│      │        │ dal 1 katori ≈ 150 g (110–200) …                │   │ still to ask              │
│      │        │ total ≈ 640 kcal (450–830) · protein 33 g       │   │ sent to                   │
│      │        │ [Edit] [Undo]                                    │   │                           │
│      │        └──────────────────────────────────────────────────┘ │                           │
│      │ ─── Wed 15 Oct ───────────────────────────────────────────  │                           │
│      │ you    I'm busy Thu to Sat, no training                     │                           │
│      │ coach  Here's what that would do. Nothing changes until…    │                           │
│      │        ┌ ◇ Proposal · no training Thu–Sat ─── 23 h ──────┐  │                           │
│      │        │ diff · goal date 21–30 Dec → 23 Dec–2 Jan         │  │                           │
│      │        │ [Apply] [Adjust] [Discard]                        │  │                           │
│      │        └───────────────────────────────────────────────────┘ │                           │
│      │ [log breakfast as planned] [why is my weight up?]           │                           │
│      │ ┌ Tell the Coach what you did… ──────────────────┐ ⌷ ➤      │                           │
└──────┴────────────────────────────────────────────────────────────┴───────────────────────────┘
mobile: single column; "What it knows" is a key in the context row opening a full sheet; a chip
"1 proposal waiting" pins under the context row when a proposal is off-screen.
```
- The conversation is one Faceplate `flush` (column max 760); turns are rows separated by
  hairlines — no chat bubbles. Speaker labels are engraved ("you", "coach") in a 64 px gutter
  (desktop) or above the text (mobile). Day dividers are engraved dates.
- Change cards sit inside the conversation as inset regions (`COMPONENTS §13.11`).

### 7.2 Change review by confirmation class
| Class | What the person sees | When it takes effect |
|---|---|---|
| **read** | a collapsed line "⌕ looked at · today's log · 14 nights of sleep · plan v3" (expand to see each call and a 2-line summary of its result) | immediately; nothing changes |
| **log** | an applied card with values, source, likely range; **Edit** and **Undo** (24 h, then from history) | immediately, with Undo; confidence 0.4–0.7 → one chip on the weakest field first; < 0.4 → one question first |
| **edit** | a proposal card: diff, goal-date range before → after, metric impacts; **Apply** (solid, never pre-focused) · **Adjust** (asks the Coach to change it, or opens the editor) · **Discard**; expires in 24 h; turns **stale** with a refreshed preview if something changed underneath | only on Apply (the "Let the Coach make small plan edits without asking" setting — off by default, provisional — applies moves of up to 3 days that add no load and change no safety setting, with Undo) |
| **destructive** | a confirm card "Needs your confirmation · end Spring cut" with the consequence and **Review and confirm…**, which opens the typed-confirmation Dialog | only when the person completes the dialog; the Coach can never complete it, batch it, or ask twice in one turn |
| **safety-blocked** | a blocked card naming the rule in plain words and offering the allowed alternatives as keys | never; the Coach relays, it doesn't argue |
| **UI-only** (screening, opt-ins, device sharing, sync, keys, agents) | the Coach says "Only you can change that" + a link to the setting | never through the Coach |

Every card also appears in Settings › Agents › Activity. Undoing a log-class card retracts the
entry; the card shows "undone" with Redo.

### 7.3 Food photo flow ("what I saw")
1. The person attaches a photo (photo key, or paste); their turn shows the thumbnail (96 px) and
   the line "Sent to Anthropic for this message only; the photo stays on this device."
2. The Coach replies with a **What I saw** card (log class):
```
 ┌ ✓ Logged lunch · 13:10 ─────────── Coach · photo ──┐
 │ [photo 72]  dal tadka   1 katori ≈ 150 g (100–210)  │  each amount is an editable chip
 │             rice        1 plate ≈ 250 g (180–330)   │
 │             roti        2 ≈ 70 g (60–85)            │
 │             looks glossy: about 2 tsp oil added     │  visible-fat cue
 │ saw: steel plate (about 26 cm), a katori            │  reference objects
 │ couldn't see: how deep the katori is                │  uncertainties
 │ total ≈ 720 kcal (470–970) · protein 24 g (12–36)   │
 │ [Looks right] [Edit] [Undo]                          │
 └──────────────────────────────────────────────────────┘
```
   - Confidence ≥ 0.7 and nothing flagged → logged at once (card as drawn; "Looks right" just
     dismisses the highlight).
   - 0.4–0.7 → the card is **pending** with one chip set on the weakest field ("rice: small ·
     usual · large") and logs when answered.
   - < 0.4 → one question first ("Was the dal made with ghee or oil — none, 1 tsp or 1 tbsp?").
   - At most one question at a time, and only when the answer would move the meal by more than
     15 % of the day's energy or decides whether a planned meal counts.
3. Editing a gram chip switches the source to "photo + your grams" and narrows the range
   (photo only ±35 % energy → your grams ±15 %).
4. Labels and screenshots: a nutrition label is transcribed ("from the label"); a scale or watch
   screenshot becomes a measurement ("Weight 83.4 kg from your scale screenshot · Undo").
5. Without vision: the photo key is hidden; a pasted image gets "This model can't see photos.
   Describe the meal in words, or choose a model with vision in Settings."
6. If the provider fails: "Couldn't reach Anthropic. Your note is saved as 'to review' and counts as
   not logged yet, never as zero." [Try again]

### 7.4 What the Coach knows (standing briefing, visible)
Panel sections (plain language, generated from the same data the Coach receives):
- **Always**: "How Vitals works, its safety rules and how it asks before changing your plan. It
  can't change your safety answers, fasting opt-ins, device sharing, sync or keys."
- **About you**: age band, height, trend weight, safety mode name, food rules, equipment,
  supplements.
- **Your plan**: name, rung, day 15 of 84, today's plan, goal-date ranges, drift, adherence.
- **Last 7 days**: one line each.
- **Body signals it can see**: per stream ("sleep: daily summaries · HRV: hidden · change ›").
- **Still to ask**: deferred intake questions.
- **Sent to**: "Anthropic (Claude Sonnet 5.5): this conversation and the results of what the Coach
  looks up. Not your name or email. Photos only in the message you attach them to."

### 7.5 Coach states
| State | Behaviour |
|---|---|
| No provider | empty conversation with: "**The Coach needs an AI provider.** Use your own OpenAI, Anthropic or other key, or a model on your computer." [Set up a provider] + "You can log everything by hand on Today, Food and Train." |
| Streaming | text arrives in place; the send key becomes **Stop**; a running job shows "simulating… 4 s" |
| Stopped | "Stopped. Proposals already made are still waiting below." |
| Key refused | "Your key was refused by OpenAI. Check it in Settings › AI provider." |
| Out of credit / plan limit | "Your provider says you're out of credit (or at your plan's limit). Nothing was logged." |
| Rate limited | "The provider is busy — trying again in 20 s." (automatic, 4 tries) |
| Browser blocked (CORS) | "This provider doesn't accept requests from a web page. [How to fix] or use the Vitals Companion." |
| Offline | "You're offline. Your message is kept; send it when you're back." [Send now] disabled |
| Model can't use tools | "This model can answer and suggest logs, but can't change anything in Vitals. Logs it suggests appear as cards for you to confirm." |
| Basic model (small or local) | "This model can log and answer questions, but not change your plan or run simulations." |
| Long conversation | segment boundary note: "Earlier days are summarised for the Coach. You can still read and search them here." |
| Quiet / gentle mode | the Coach avoids calorie talk, weight-loss suggestions and numeric scores; cards show portions without kcal unless "show numbers" |
| Safety mode without planning (planner off) | the Coach explains and logs but has no plan-changing tools: "In your current safety mode, plans can't be changed here. I can still log and explain."; danger warnings are quoted word for word |
| Planning mode | same route from the top bar; onboarding and what-if conversations; no Living tools when no plan is active |

---

## 8. Progress (`/progress`, `/progress/:metric`)

### 8.1 Layout
Single scrolling page of Faceplates with an anchor-chip rail (mobile) / sticky section index
(desktop, like Settings): **trend · goals · adherence · body · body signals · log · check-ins ·
plan**. Both rails use `scroll-padding-inline` equal to the gutter.
Context row: "Progress · Spring cut" + range KeyBank `2 wk · 4 wk · 12 wk · all`.

### 8.2 Sections
1. **Trend** — TrendLane (CHART_SPEC §7.8): the filtered trend line (hero, 2 px, body hue), raw
   weigh-ins as faint dots, the **as-prescribed** forecast band (dashed outline) and the
   **realistic** forecast band (filled, at your actual adherence), the goal line, and the goal-date
   range on the x-axis. Readout: "trend 83.1 kg (±0.3) · since day 1 −2.4 kg (likely −2.0 to −2.8)".
   Flagged weigh-ins are hollow, never removed.
2. **Goals** — one drift card per ranked goal: state mark + word (**ahead** / **on track** /
   **behind** — ok mark, ok mark, info mark; never red), goal date "likely 21–30 Dec, moved by +9
   days (±6)" (shown only when ≥ 3 days and outside the band), cause sentence, and **one** action:
   keep going (no key) · **See easier options** (opens the proposal) · **Re-plan the rest**.
3. **Adherence** — "last 7 days 84" and "last 28 days 81" readouts with "steady" or an arrow,
   "scored 22 of 28 days";
   a month calendar of AdherenceDial glyphs (assumed days dashed, paused days struck); per-block
   bars (training · protein · energy · fasting · steps) with the costliest item named; **what the
   plan has learned**: "Thursday lifts happen 1 time in 4. The plan can move them — see proposal."
   Never a streak count.
4. **Body** — composition from the latest anchored state (fat mass, lean mass, body fat %, each
   with likely range and "since day 1"); girths table (mean of repeats, method, date); the visceral
   view `sm` with the day-1 ghost; the figure (if shown) with the day-1 ghost. [Add a measurement]
   → sheet (weight, waist, hip, neck, chest, arm, thigh, body fat reading, blood pressure,
   ketones, glucose, labs) with "repeat 2–3 times; we use the average" for girths and method
   (tape, scale, DXA, BIA…). Consumer body-fat readings carry "kept as a rough reading (±2
   points)"; a DXA reading says "This resets your composition estimate."
5. **Body signals** — the ScoreTile strip for the person's streams → `scores.md`.
6. **Log** — calendar (dot per logged day, dial glyph when scored) + day list; tap a day →
   `/today/:date` (backfill); each entry with SourceChip; "edited on two devices" resolve.
7. **Check-ins** — weekly reports, newest first: verdict, trend, what changed (adopted versions).
8. **Plan** — version list ("v1 · started · Thu 2 Oct", "v2 · small adjustment · Sun 5 Oct —
   tomorrow −5 % energy", "v3 · weekly check-in · Thu 9 Oct — Thursday lift moved to Friday"; the
   reason words are: started · small adjustment · weekly check-in · after an event · your change ·
   Coach's change · paused · resumed · safety) → `/plan/active/versions/:n` (diff and
   reasons); Pause / End live in the Today menu.

### 8.3 Progress states
| State | Behaviour |
|---|---|
| Under a week of weigh-ins | trend replaced by "Your trend starts after about a week of weigh-ins (3 so far)." raw dots still drawn |
| No weigh-ins for 14 days | "No weigh-ins for 2 weeks — the trend restarts from your next one." |
| Estimate reset (illness, travel, a long fast, DXA, a model update) | engraved marker on the trend at the date with a tooltip "estimate reset: illness over 2 days" |
| Rescoring after an update | chip "updating scores to v1.3…" (background, interruptible) |
| Quiet mode | weight axis hidden; trend direction words only; composition behind "show numbers" |

---

## 9. Plan details (`/plan/active`, `/plan/active/versions/:n`)
Faceplate list: plan name, rung, start and planned end, status, check-in day, intentions (edit),
Switch **Let the plan ease itself** (on by default): "When your data says to go easier — poor
sleep, signs of strain, a missed day — the plan makes the lighter change at once and shows it on
Today with Undo. Off: every change waits for you." (Not the Coach's "small edits" switch in
Settings › AI provider, which is about the Coach.) ·
versions with reason and date · selecting a version shows its diff table ("Thu lift → Fri lift ·
reason: Thursday sessions were done 1 time in 4") and its forecast goal dates · actions: Pause ·
Resume · End plan… (typed confirmation) · Re-plan.

## 10. Re-plan paths

| From | Path | Result |
|---|---|---|
| Today menu "Re-plan the rest" | `plan.replan` job ("Re-planning the remaining 69 days… 6 s") | a proposal card on Today (diff + goal dates); Apply → new version; stays in Living mode |
| Drift card / check-in | the one action key | proposal |
| Today menu "Re-plan from scratch" | planning override on (plan strip shows); `/plan/goals?from=active` with goals, limits, today's state prefilled | Find plans → ladder → **Replace active plan…** (typed confirmation) → Living with the new plan; the old one is kept and linked |
| Planning tools (rail / overflow) | planning override on; any Planning screen | nothing changes the active plan unless "Replace active plan…" is confirmed; "Back to Today" clears the override |

## 11. Accessibility
- Every Living screen has one `h1` (the context title); faceplates are `section`s with headings.
- PrescriptionRow tick keys are buttons with full names ("Mark lunch as planned"); the row sheet is
  a radio group; state changes are announced ("Lunch marked as planned. Undo available").
- The ClockRing keeps its text summary under it (COMPONENTS §4); the AdherenceDial has a sentence
  and table; TrendLane has a table view (date, weigh-in, trend, expected range).
- The conversation is a `log` region (`aria-live="polite"` only for completed assistant turns, not
  each streamed token); change cards are articles with labelled actions; Stop is reachable by
  keyboard while streaming.
- Photo thumbnails have alt text from the "what I saw" summary.
- Touch targets 44 px; the log bar input is 16 px on mobile; all colour meaning has a shape or word.

## 12. What the engine supplies

| Screen | Source |
|---|---|
| Today | `today.get` → `TodayView` (prescription snapshot, logged entries and totals with `Est`, item statuses and credits, fast state, remaining (null in quiet mode), checklist with one-tap commands, adherence {today, a7, a28, daysLogged7}, drift, trendWeight {kg, sd, todayExpected p10/p50/p90, measured}, checkIn, biometrics {lastNight, restingHr, hrv, flags}, notices, coachPrompts) |
| Logging | `log.markDay`, `log.confirmDay`, `log.meal`, `log.mealFromPhoto`, `log.session`, `log.fast`, `log.measurement`, `log.steps/sleep/supplement/subjective/note`, `log.edit`, `log.retract`, `log.bulk` (backfill) |
| Check-in, drift | `plan.checkIn` → `CheckInReport`; `plan.drift` → `DriftReport` (state, goalDate range and shift, causes with shares, one action) |
| Plan changes | `plan.replan`, `plan.shift`, `plan.declareEvent`, `plan.pause/resume`, `plan.end`, `plan.replace`, `plan.adoptVersion/rejectVersion`, `plan.versions` → `VersionProposal {goalDates, impact, notes}` |
| Food | `food.dayTargets`, `food.candidates`, `food.planDay` → `PortionFitResult {withinTolerance, deltas, binding[]}`, `food.recipes`, `food.groceryList`, `food.parse`, `catalogue.supplements` |
| Train | `train.session`, `train.alternatives`, `train.shoppingList`, `plan.swapExercise` → `EquivalenceResult {credit, parity, perTerm, shortfall}`, `catalogue.equivalence`, `catalogue.addExercise` |
| Coach | `coach.conversations`, `coach.history`, `coach.pending`, `coach.applyPending` (UI only), `coach.discardPending`; `ChangeCard` view model; photo extraction → app-computed nutrients with bands |
| Progress | `plan.adherence` → `AdherenceSeries`, `log.get`, `bio.scores`, measurement filter updates, `ProjectionDigest {asPrescribed, realistic, goals[dateRange]}` |
| Never computed in the UI | scores, credits, bands, drift states, goal dates, nutrient totals — the UI renders them |

## 13. Decisions & rationale
- **Today is a plan you tick, not a feed.** The day's prescription on a clock, ticked in ten
  seconds, is the whole daily habit; everything else is optional depth.
- **The adherence number is honest and quiet.** It is weighted by what each item contributes, shows
  coverage, says "so far", never counts streaks and never celebrates; in quiet mode it is a word.
- **Every AI write is visible where it happened and reversible from there.** Read calls collapse,
  logs apply with Undo, edits wait for Apply, destructive acts need the person's typed word.
- **"Accept" and "I ate this" are different buttons.** Planning a meal and eating it are different
  facts; merging them would corrupt both the grocery list and the log.
- **Swaps are credited, never refused.** Whatever was actually done counts by what it trains, with
  the one fix that would close the gap stated plainly.
- **The briefing is visible.** The person can always see what the Coach knows and where it is sent.
