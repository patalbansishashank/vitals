# Product

<!-- impeccable:product-schema 1 -->

> Product truth for design work. Carried over from `design/PRODUCT.md` (2026-09-30) and updated with the owner's
> answers of 2026-10-17 (manual-only since 0.6.0, ring steps and sleep imported from Gauge since 2026-10-27; the unslop
> redesign brief) and of 2026-10-30 (the r071 UI overhaul: the references and decisions in the brand section below).

## Platform

web

One React codebase ships as the website, the Electron desktop app (Linux, Windows, macOS) and the Capacitor Android
app. The wrappers add files out, the tray and the MCP bridge; the interface is the same web interface everywhere.

## Users

The owner first: a single person planning and living their own body-composition change, privately. More broadly,
health-curious, analytically minded adults who already log food and weigh in and want to see what a plan does before
living it. Two scenes: planning sessions at a laptop (long, exploratory) and quick daily checks and logs on a phone.

## Product Purpose

Vitals projects a person's physiology forward day by day from what they eat, how they train, move and sleep. It
answers "what happens if I do this?" (Simulator) and "what should I do to get this?" (Planner), then helps the person
live the chosen plan day by day (Today, Food, Train, Coach, Progress). Success: the person understands the
trade-offs, follows a plan, and logs a day in seconds.

## Positioning

Mechanistic, not diet-label based: grams, timing and training with carry-over between days. Every curve traces to a
mechanism with an evidence grade and citations. Average-human projection, honestly labelled. Local-first: no
accounts, no analytics; an optional self-hosted server syncs devices.

## Operating Context

Long horizons (1-6 months); a 24 h clock matters (eating window, fasts, training time). Daily use is short and
mostly on a phone; planning is on a laptop or the desktop app. An AI Coach and external AI tools (MCP) act through
the same commands as the interface.

## Capabilities and Constraints

- Features: Your body, Simulator, Planner, Evidence library, safety notices, the living plan (Today, Food, Train,
  Coach, Progress), kitchen and pantry, supplements, blood markers, settings, sync, onboarding intake.
- The Android app includes the ring engine: Bluetooth, phone steps, Health Connect, short-video counts and uploads to
  the person's home server. Web and desktop read the same server-derived readings. Steps, sleep and activities import
  automatically, with source deduplication and the person's own edits taking precedence. Heart rate supports activity
  estimates where the evidence permits it; displayed readings and model estimates remain clearly distinguished.
- Engine runs in Web Workers; simulations and optimisation take seconds.
- Mobile 360-412 px, desktop windows and wide browsers.
- Named diets appear only as presets defined by macro composition.

## Brand Commitments

- Name: Vitals. Tone: a precise instrument that is also humane. Never moralising about food or bodies. Honest about
  uncertainty.
- Binding visual reference (owner, 2026-10-17): Vitals takes the look of the owner's Android app Lumen Health,
  "Ember" (`/media/DEV/Hobby/LumenHealth/DESIGN.md`): near-black and charcoal surfaces, warm gold accent, fine static
  grain with a faint gold wash, hairline borders, a floating navigation pill, frosted headers. Lumen Health itself is
  not changed. The details this clause once listed (Manrope, small card corners, pill controls, an icon-only
  navigation pill) are superseded by the next paragraph and by `DESIGN.md`.
- Refined by the owner's references (r071, 2026-10-30): the two references the owner chose after the r068 rules (a
  monochrome tasks app with mono caps and light numerals; a running app with soft glow cards) refine Ember; they do not
  replace it. Vitals keeps its charcoal, grain, gold and hairlines, and takes from them mono caps for facts (set in
  Geist Mono), light numerals (Geist), 20 px cards, one soft glow in a card's domain hue, and an ivory mark for where
  you are. Where they disagree with the 2026-10-17 clause or the r068 rules, the newest owner signal wins
  ("unslopify, not slopify; one design we follow"). Safety, privacy and the no-shame tone do not change.
- Dark only. No light theme.
- Mark (owner, 2026-10-22): the plan ring, in the sister app Gauge's reading-ring family with the colour roles
  swapped. Gauge measures (a gold reading arc, an ivory dot where it stops); Vitals plans (an ivory ring left open at
  four o'clock where the plan is still to be lived, a gold dot inside aimed at it: the next thing to do). The two must
  never be confused side by side. One generator, `design/brand/vitals-mark.py`, draws every size and platform.
- Unslopped: no helper subtext or explainer copy that a label already says, nothing injected into the middle of
  content, one overflow menu per screen, no persistent bar that changes meaning per page.

## Evidence on Hand

No real users, testimonials or clinical claims. Research dossiers in `research/`. Numbers in design material are
synthetic and labelled as such.

## Product Principles

1. Show the mechanism, not a verdict.
2. Uncertainty is part of the answer, never hidden in a footnote.
3. The person decides; the product never shames a choice, but always warns about unsafe ones.
4. Every body is a valid starting point.
5. Readability before decoration; say it once, in the fewest words.

## Accessibility & Inclusion

WCAG 2.2 AA. Charts need table fallbacks and non-colour encodings. Icon-only controls keep accessible names. Body
representation is neutral and respectful across sexes, sizes and shapes.
