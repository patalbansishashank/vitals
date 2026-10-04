# Screen — Welcome, safety screening & safety surfaces (`/welcome`, app-wide)

> Rules source: research dossier 17 (`research/17-safety-guardrails.md`, draft 2026-09-30):
> planner hard constraints HC-*, simulator warnings W-* (≤ 200-character messages), user modes
> `M0` standard · `R1` ED-risk restricted · `R2` clinician-first · `H` hard stop. Its §4 (question
> wording, tiered fasting detail, full disclaimer) was not yet written when this spec was made:
> **align final question text with dossier 17 §4.1 when it lands**; structure and behaviour here
> are final.

## 1. Purpose

Welcome the user, set honest expectations (projection, not prescription), and ask the few
questions that change what is safe to show or prescribe — kindly, briefly, without making anyone
feel accused. Then carry safety through the whole app: a mode chip, inline warnings, danger
acknowledgements, and a disclaimer that is always present but never in the way.

## 2. Entry points & exits

| In | Out |
|---|---|
| First visit (`/` with no stored consent) · Settings › Safety › "Review my answers" · a newer disclaimer version (re-consent) | → Your body setup (`/body?setup=basics`) · hard stop screen (under 18) · Settings › Safety |

## 3. Layout — mobile (375 px)

```
Step 1 · intro                      Step 2 · screening                 Step 3 · consent
┌──────────────────────────────┐  ┌──────────────────────────────┐  ┌──────────────────────────────┐
│ ● vitals                     │  │ ‹  About you     ━━━━━━─── 2/3│  │ ‹  Before you start  ━━━━━━━━│
├──────────────────────────────┤  ├──────────────────────────────┤  ├──────────────────────────────┤
│                              │  │ A few questions that change  │  │ Vitals is a simulator.       │
│   (perforated stage with a   │  │ what's safe to suggest.      │  │                              │
│    3-lane mini recording and │  │ Answers stay on this device. │  │ ① It projects trends for an  │
│    a small two-layer figure) │  │                              │  │   average person like you —  │
│                              │  │ ┌ Are you 18 or older? ─────┐│  │   with ranges, not promises. │
│ See what a plan does         │  │ │ [ yes ]  [ no ]           ││  │ ② It is not medical advice   │
│ before you live it.          │  │ └───────────────────────────┘│  │   and can't diagnose.        │
│                              │  │ ┌ Pregnant, trying, or      ┐│  │ ③ It will show you risky     │
│ Vitals projects your body    │  │ │ breastfeeding?            ││  │   plans if you build them —  │
│ forward day by day from what │  │ │ [ yes ] [ no ]            ││  │   and say why they're risky. │
│ you eat, how you train, move │  │ └───────────────────────────┘│  │                              │
│ and sleep. Every curve shows │  │ … (one card per question)    │  │ ☐ I understand                │
│ its range and its evidence.  │  │                              │  │                              │
│                              │  │ Why we ask ›                 │  │ Full disclaimer ›            │
├──────────────────────────────┤  ├──────────────────────────────┤  ├──────────────────────────────┤
│ [ Get started ]   (solid)    │  │ [ Continue ]                 │  │ [ Continue ]  (disabled until│
└──────────────────────────────┘  └──────────────────────────────┘  │  checked)                    │
                                                                    └──────────────────────────────┘
```

- Full-screen steps without the tab bar (setup context); top bar shows a back chevron and a
  3-segment progress scale (not numbers).
- Screening questions are **one card per question** on a single scrolling page (not one question
  per screen — fewer taps, and people can see what's coming). Follow-up questions expand inline.

## 4. Layout — desktop (1440 px)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ● vitals                                                                                       │
│                                                                                                 │
│   ┌──────────────────────────── 560 ─────────────┐   ┌──────────────── 520 ─────────────────┐   │
│   │ See what a plan does before you live it.     │   │  perforated stage:                    │   │
│   │ (display 44/48, 120 % width)                 │   │  a 3-lane channel recording (fat,     │   │
│   │                                              │   │  glycogen, ketones) that draws itself │   │
│   │ Vitals projects your body forward day by day…│   │  once (1.2 s) with the playhead       │   │
│   │                                              │   │  sweep, next to the two-layer figure  │   │
│   │ [ Get started ]                              │   │  shrinking slightly                   │   │
│   │ Already have data? Import a file             │   │  (synthetic, labelled "example")      │   │
│   └──────────────────────────────────────────────┘   └───────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
 Screening and consent: single centred column, max 640, Faceplate per question group.
```

- Welcome is the one place with a **display-size** line (44 px, `wdth 120`, weight 600) — the
  memorable first viewport. The illustration is a real mini render of the chart components with
  synthetic data, labelled "example".

## 5. Regions & components

| Region | Components | Notes |
|---|---|---|
| Intro | Faceplate-free hero (chassis), Key `solid` "Get started", Key `quiet` "Import a file" | mini chart + figure, `aria-hidden`, with a text alternative |
| Screening | Faceplate per question, KeyBank (`yes · no` / `yes · no · prefer not to say`), Checkbox lists, InlineWarning/Banner for consequences | answers stored locally, versioned |
| Consent | Faceplate, Checkbox, Key `solid` "Continue", link to full disclaimer | no pre-checked box |
| Hard stop | Faceplate centred, no navigation | under 18 |
| Safety chip (app-wide) | Chip `status` info | context bar / top bar |
| Danger acknowledgement (results) | Faceplate in chart area, Checkbox, Key | dossier 17 §3 |
| Disclaimer line | text | every results surface |

## 6. Content & copy

### 6.1 Intro
> **See what a plan does before you live it.**
> Vitals projects your body forward day by day from what you eat, how you train, move and sleep.
> It shows trends for an average person like you — with ranges, not promises — and the evidence
> behind every curve. Everything stays on this device.
> [Get started] · Already have data? [Import a file]

### 6.2 Screening ("About you")
Header: "A few questions that change what's safe to suggest. Answers stay on this device. You can
change them any time in Settings."

| # | Question (card title) | Answers | Effect (mode / action) | Copy shown on the effect-triggering answer |
|---|---|---|---|---|
| Q1 | Are you 18 or older? | yes · no | no → `H` BLOCK_APP (HC-P1) | → hard stop screen (§6.4) |
| Q2 | Are you pregnant, trying to get pregnant, or breastfeeding? | yes · no · prefer not to say | yes/prefer → Planner off, Simulator with danger notices (HC-P2, W-P01) | "Vitals isn't designed for pregnancy or breastfeeding, so the Planner is turned off. You can still explore the Simulator; it will flag anything that isn't advised." |
| Q3 | Has eating, food or weight ever been a real struggle for you — for example an eating disorder, now or in the past? | yes · no · prefer not to say | yes/prefer → `R1` gentle mode (HC-P3) | "Thank you for telling us. We'll use **gentle mode**: plans stay at maintenance or above, no fasting over 12 hours, and body-weight numbers are tucked away unless you ask. Support is available any time — see the help card." |
| Q4 | Four quick questions about eating (SCOFF-adapted; shown to everyone who answered "no" to Q3): *Do you make yourself sick because you feel uncomfortably full? · Do you worry you've lost control over how much you eat? · Do you believe yourself to be fat when others say you're too thin? · Would you say food dominates your life?* | yes · no each | ≥ 2 yes → `R1` (HC-P3) | same as Q3, with "Based on your answers, we'll use gentle mode." |
| Q5 | Do you have diabetes, or take any of these: insulin, sulfonylureas (e.g. gliclazide), meglitinides, SGLT2 inhibitors (e.g. empagliflozin, dapagliflozin)? | checklist + "none of these" | type 1 or any listed drug → Planner off (HC-P6); Simulator danger notices (W-P04) | "Some diabetes medicines can cause low blood sugar or ketoacidosis with fasting, low-carb eating or big deficits. The Planner is off; the Simulator will flag risky days. Please plan changes with your clinician." |
| Q6 | Do any of these apply? heart condition or irregular heartbeat · high blood pressure (treated) · kidney disease · liver disease · gout, kidney stones or gallstones · pancreatitis · a condition affecting how you process fat | checklist + "none" | any → `R2` clinician-first (HC-P7) | "We'll use **clinician-first mode**: smaller deficits, no fasts over 24 hours, and a reminder to check changes with your clinician." |
| Q7 | Do you take any of these? diuretics · ACE inhibitors or ARBs · lithium · medicines that affect heart rhythm · chemotherapy | checklist + "none" | any → `R2` (W-P07) | same as Q6, naming the medicine group |
| Q8 | Has a doctor said you should only do medically supervised activity, or do you get chest pain, dizziness or faintness when active? | yes · no | yes → exercise limited to light–moderate (HC-X4, W-X05) | "We'll keep exercise light to moderate in plans. Vigorous sessions in the Simulator will show a notice." |

Derived (no question): age 65–74 → restricted deficits/fasting (HC-P8); ≥ 75 → no deficit
(HC-P9); BMI < 20 at start → no deficit in Planner (HC-P4). These appear on the Safety summary.

**Why we ask** (disclosure under the header): "These answers change what the Planner may suggest
and which warnings the Simulator shows. They are never sent anywhere."

**Safety summary** (end of screening, before consent): a Faceplate listing the resulting mode in
plain words, e.g. "**Standard mode.** The Planner can suggest deficits up to 25 % of maintenance
and fasts up to 24 hours; longer fasts need your opt-in." / "**Gentle mode.** …" / "**Clinician-
first mode.** …" / "**Simulator only.** …".

### 6.3 Consent ("Before you start")
> **Vitals is a simulator.**
> 1. It projects trends for an average person with your inputs — with ranges, not promises.
> 2. It is not medical advice and can't diagnose or treat anything.
> 3. It will show you risky plans if you build them, and say why they're risky. The Planner never
>    suggests plans outside its safety limits.
> ☐ I understand
> [Continue] · Full disclaimer ›

The numbered list is allowed here: the order is the argument. The checkbox is never pre-checked;
Continue stays disabled (with tooltip "Tick 'I understand' to continue") until checked.

### 6.4 Hard stop (under 18)
> **Vitals is for adults.**
> Projections and plans like these aren't suitable under 18. If you'd like to talk about food,
> sport or your body, a GP or school nurse is a good place to start.
> [I entered my age by mistake]
No navigation, no data stored except the answer (so the screen persists). The "mistake" key
returns to Q1.

### 6.5 Help card (gentle mode, app-wide in Settings › Safety and the overflow menu)
> **Support, any time.** If eating or body image feels hard, you deserve care at any weight.
> Talk to your GP, or contact a local eating-disorder helpline (UK: Beat 0808 801 0677; US: call
> or text 988). Vitals is not a crisis service.
(Region-specific numbers from the locale; verify before launch.)

### 6.6 Safety across the app

| Surface | Behaviour |
|---|---|
| **Mode chip** | Context bar (desktop) / top bar (mobile) when mode ≠ standard: Chip `status` info — "Gentle mode", "Clinician-first mode", "Simulator only". Tap → Popover explaining what it changes + "Review my answers". |
| **Schedule** | Per-day flags on cells (caution/danger icons), editor InlineWarnings (W-* messages, ≤ 200 chars). |
| **Results — caution** | WarningsPanel rows + event lines + toolbar chip. |
| **Results — danger** | Before results render: an **acknowledgement panel** in the chart area (danger-bg Faceplate): title from the W-rule, message, "☐ I understand this is a simulation, not a recommendation", [Show the projection]. After acknowledging (per scenario, per rule, until the schedule changes): results render with a persistent 28 px strip at the top of the chart "Simulation — not a recommendation" (danger fg on danger bg, icon) and the same text on exports (dossier 17 §3). |
| **Persistent help line** | Any scenario with a caution or danger shows at the bottom of the Warnings panel: "Stop and get help if you feel faint, have chest pain or an irregular heartbeat, are confused, keep vomiting, or have severe headache, cramps or abdominal pain." |
| **Planner** | Never outputs a plan outside HC-*; excluded options are listed on the Safety tab with the reason; infeasible goals say the earliest feasible date and the binding limit (HC-G1). |
| **Fasting tiers** | ≤ 24 h allowed; 24–48 h and 48–72 h require an opt-in Switch in Settings › Safety ("Allow fasts over 24 hours in plans") with an acknowledgement; 3–7 days only in the Simulator with danger notices; > 7 days: Simulator danger, never planned. |
| **Disclaimer line** | Every results surface: "Projections for an average person with your inputs. Not medical advice. Individual results differ: see the range on each curve." |
| **Exports** | JSON and printouts carry the mode and, for danger scenarios, the watermark text. |

### 6.7 Wording rules (from dossier 17, applied everywhere)
- Risk first, then what to do, then the option. No moralising, no diagnosis, no guarantees.
- Never "you should lose weight", "unhealthy", "bad", "cheat". Never praise restriction.
- In gentle mode, never show weight-loss goals, "calories burned" framing, or before/after figures.
- Messages ≤ 200 characters in banners and flags; longer explanations live in Explain/Evidence.

## 7. Interactions

- Steps advance with the solid key; back chevron returns without losing answers.
- KeyBank answers are single-press; checklist items include "none of these" which clears others.
- Answers that trigger a mode show their consequence inline immediately (Banner info, 200 ms
  expand) — no surprise at the end.
- Consent requires the checkbox; `Enter` on the checkbox toggles; `⌘Enter` continues when valid.
- Re-consent: when the disclaimer version changes, the next launch shows Step 3 only, with a
  "What changed" line.
- Settings › Safety › "Review my answers" re-opens Step 2 in place (no consent repeat unless the
  mode becomes less restrictive, which asks for a confirmation: "Turn off gentle mode?").

## 8. States

| State | Behaviour |
|---|---|
| Partial answers | Continue disabled until every visible question has an answer (prefer-not-to-say counts). |
| Mode changes after plans exist | Existing plans that violate the new mode are marked "outside your current safety mode" and cannot be opened in the Simulator without a notice; scenarios remain (Simulator may simulate anything). |
| Storage blocked | Screening still works; a caution Banner says answers won't persist and the mode resets each visit. |
| Import from a file | Imported safety answers are shown for confirmation before the mode applies. |

## 9. Accessibility

- Each question is a `fieldset` with `legend`; KeyBanks are radio groups; checklists are checkbox
  groups with a "none of these" exclusive option.
- Consequence Banners use `role="status"` (polite); the hard stop uses a heading and plain text,
  focus moved to the heading.
- The consent checkbox has a visible label; the disabled Continue is `aria-disabled` with the
  reason exposed.
- Welcome illustration is `aria-hidden` with a one-sentence text alternative in the copy.
- Language is plain (target reading age ~12); medical terms have examples in brackets.

## 10. Decisions & rationale

- **One scrolling page of question cards** rather than a wizard per question: faster, and
  transparent about what's asked.
- **"Prefer not to say" routes to the safer mode** (dossier 17 HC-P3), and the copy says so kindly.
- **Consequences shown inline**, so the user understands the mode as they answer.
- **Danger needs an explicit acknowledgement** before results render, and results carry a quiet
  "simulation, not a recommendation" strip — respecting autonomy while making the risk unmissable.
- **No streaks, no nudges to "get back on track"** — anywhere; safety is information, not pressure.
