# Product

<!-- impeccable:product-schema 4 -->

> Inferred from `docs/PROJECT_BRIEF.md` and the owner's design brief (2026-09-30). The owner asked not
> to be interviewed on design; every fact below is taken from those two sources, not from an
> interview. Lives in `design/` because the design lead may only write there.

## Platform

web

## Stack

Vite + React + TypeScript (strict), Tailwind CSS v4 with CSS-variable tokens, Zustand persisted to
localStorage, engine in Web Workers. Static build on Netlify. No backend.

## Users

Health-curious, analytically minded adults, from regular dieters to physique athletes. They already
track (food logs, scales, wearables), read about protein, fasting, ketosis, and want to see what a
plan does to their body before living it. Use happens in two scenes: planning sessions at a laptop
(long, exploratory, many toggles) and quick checks or tweaks on a phone.

## Product Purpose

Vitals projects a person's physiology forward, day by day, from what they actually eat, how they
train, move and sleep. It answers "what happens if I do this?" (Simulator) and "what should I do to
get this?" (Planner, 2-3 alternative regimes). Success: the user understands the trade-offs and the
uncertainty, and leaves with a plan they can follow.

## Positioning

Mechanistic, not diet-label based: it models grams, timing and training, with carry-over between
days (ketosis entry lag, glycogen, metabolic adaptation, MPS windows). Every curve traces to a
mechanism with an evidence grade A-D and citations. Average-human projection, honestly labelled.

## Operating Context

Long horizons (1-6 months) edited in blocks; 20-50 outcome metrics; a 24 h clock matters (eating
window, fasts, training time). Everything is local: persistence in the browser, JSON export/import.

## Capabilities and Constraints

- Features: Your body (profile with parametric avatar), Simulator (schedule builder + results),
  Planner (ranked goals -> optimiser -> 2-3 regimes), Evidence library, safety notices.
- Engine runs in a Web Worker; simulations take up to a few seconds; optimisation takes seconds.
- Mobile 375 px and desktop; light and dark themes.
- Named diets appear only as presets defined by macro composition, never as model categories.

## Brand Commitments

Name: Vitals. Tone: a precise scientific instrument that is also humane.
Never moralising about food or bodies. Honest about uncertainty.

## Evidence on Hand

No real users, testimonials or clinical claims exist. Research dossiers are being written in
`research/`. All numbers in design material are synthetic and must be labelled as such.

## Product Principles

1. Show the mechanism, not a verdict.
2. Uncertainty is part of the answer, never hidden in a footnote.
3. The user decides; the product never shames a choice, but it always warns about unsafe ones.
4. Every body is a valid starting point.

## Accessibility & Inclusion

WCAG 2.2 AA. Charts need table fallbacks and non-colour encodings. Body representation must be
neutral and respectful across sexes, sizes and shapes; sex options include a neutral base.
