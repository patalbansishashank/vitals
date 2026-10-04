# Vitals — Project Brief (read this first)

## What we are building
A static, client-only web app (desktop + mobile browsers, deployed on Netlify, **no backend**). All
computation runs in the user's browser. Two features for now:

### Feature 1 — The Simulator ("what happens if I do this?")
The user enters their body (sex, age, height, weight, body-fat / fat distribution / muscularity via
graphical sliders, training history, etc.) and then builds a **schedule** of arbitrary length
(2, 3, 6 months...) where **every day (or block of days/weeks) is individually configurable**:
- energy intake as a % of maintenance (deficit / maintenance / surplus), or absolute kcal
- macronutrient composition: protein, fat (and fat types), carbohydrate (net carbs vs fibre, sugars...),
  plus anything else that mechanistically matters (sodium, water, alcohol, micronutrients, protein quality...)
- meal structure: number of meals (typically 2-3), eating window (4 h / 6 h / 8 h / 12 h ...), clock time
  of the window, extended fasts
- exercise: resistance training (volume/intensity), walking/steps, running, other cardio, timing relative to meals
- modifiers: sleep, stress, etc. — anything the evidence says materially changes outcomes

The engine then projects the whole period forward **mechanistically** and plots *everything on one
graph*: inputs (protein/fat/carb per day) and 20-50 outputs (fat mass, lean/muscle mass, glycogen,
water weight, ketone level/ketosis state, autophagy signal, metabolic adaptation, hunger, hormones,
blood lipids, insulin sensitivity, ... whatever the research supports).

The model must have **memory / carry-over between days**: e.g. entering ketosis takes ~2-4 days,
exiting is fast, re-entry depends on glycogen and adaptation state, keto-adaptation takes weeks,
glycogen supercompensation, metabolic adaptation builds slowly and reverses slowly, MPS is elevated
for 24-48 h after training, etc. Transitions between dietary patterns (e.g. very-low-carb -> high-carb
low-fat) must show realistic transients.

### Feature 2 — The Planner ("tell me what to do")
The user enters their body the same graphical way, then **ranks goals in priority order** chosen from
the 20-50 modelled outcomes (e.g. 1. lose 10 kg fat, 2. gain muscle, 3. maximise autophagy) and a time
horizon. An optimisation algorithm uses the Feature-1 engine as its forward model and searches over
day-by-day / week-by-week regimes (macro composition, energy level, eating window, meal timing,
exercise type and timing, periodisation such as a high-carb low-fat week followed by a
protein-sparing-modified-fast week) and returns **2-3 alternative regimes** with a day-by-day
prescription and the projected outcome curves. Because goals conflict (e.g. autophagy vs. muscle gain),
it must know which goals are compatible, honour the priority order, and tell the user what is and is
not achievable.

## Non-negotiable principles
1. **Mechanistic, not diet-label-based.** We never model "keto" or "paleo" as a category. We model
   what is physically eaten (grams of protein, net carbohydrate, fibre, fat types, timing...) and the
   physiology responds. Named diets only appear as *presets* or as search terms in the literature.
2. **Evidence-based.** Every equation, parameter and time-constant must trace to published human
   evidence (meta-analyses, metabolic-ward studies, RCTs, validated mathematical models). Where evidence
   is weak or only from animals, we say so and carry an explicit confidence grade into the UI.
3. **Average-human projection, honestly labelled.** Outputs are trends for an average person of the
   given sex/age/size, not guarantees. Inter-individual variance should be quantified where known.
4. **Dynamics matter.** Time-constants, lags, thresholds, hysteresis, saturation — capture them.
5. **Safety.** The planner must never prescribe clinically unsafe regimes; the simulator may simulate
   them but must warn.

## Tech stack (decided)
Vite + React + TypeScript (strict), Tailwind CSS v4 with CSS-variable design tokens, Zustand for state
(persisted to localStorage), simulation + optimisation engine as a pure TypeScript module
(`src/engine`, zero DOM dependencies) running inside Web Workers, Vitest for tests, static build to
`dist/` deployed on Netlify.

## Repository layout
- `docs/`      project brief, model spec, architecture
- `research/`  one evidence dossier per topic (see `research/RESEARCH_PROTOCOL.md`)
- `design/`    design direction, tokens, component specs
- `src/`       application code

## Addendum (owner, 2026-09-30): fasting is a first-class regime
Water-only fasting (water + electrolytes/essential micronutrients, **no energy and no protein**; not dry
fasting) must be fully supported as a schedulable regime in the Simulator and as a building block the
Planner can use: 24 h, 48 h, 72 h, week-long, and arbitrary durations, including repeated/periodic
fasts. The engine must therefore behave correctly at zero intake for many consecutive days (glycogen
exhaustion, ketosis plateau, protein-sparing adaptation, RMR change, electrolyte/water shifts, refeeding
transients). Any other evidence-based intervention that helps reach a user goal should also be
available as a lever.
