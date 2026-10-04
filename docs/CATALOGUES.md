# Catalogues (E8): exercises, equipment, foods, supplements, stimulus mapping, equivalence, evidence labels

PLAN items 11, 12, 14. Normative inputs: `docs/PLANNER_V2_SPEC.md` §8 and §9.4, `docs/SUITE_SPEC.md` §2.3.1 and §3.7, research
R3 (exercise and equipment), R4 (food, recipes, supplements) and R5 (evidence policy) in `plan/01-after-launch/research/`.

| Path | What |
|---|---|
| `src/catalogues/` | Pure TypeScript (tier P): types, validation, stimulus mapping, equivalence, composer, evidence helpers, food-table contract |
| `src/content/catalogues/` | Seed data as typed modules, the assembled `SEED_CATALOGUE`, a food test fixture |
| `src/catalogues/__tests__/`, `src/content/catalogues/__tests__/` | 82 tests (worked examples, properties, purity, data validation) |

Import from `@/catalogues` (functions and types) and `@/content/catalogues` (data). Nothing here touches React, state, the DOM,
the clock, randomness or the network (`purity.test.ts` enforces it until `eslint.config.js` adds the tier-P rule for
this path, see "Requests"). SUITE_SPEC writes the path as `src/catalogue/`; the package was built at `src/catalogues/` as
assigned, and SUITE_SPEC §5.6's `src/catalogue/food/estimate.ts` corresponds to `src/catalogues/foods.ts`.

## 1. Data

| Module | Content |
|---|---|
| `SEED_EXERCISES` | 170 exercises: gym 35, bodyweight 33, Indian 22, yoga 19, home 12, bands 12, odd-object 13, outdoor 11, kettlebell 8, mobility 5. Indian traditional training: mudgar/mugdar (two-hand, pair/jori), Indian clubs, gada and steel mace, sumtola (clean-press, squat), nal, gar nal (dand, baithak), dand, baithak, mallakhamb (pole, rope), rope climb, kushti drill and circuit, akhara digging, wrestler's bridge, Surya Namaskar, kabaddi, kho-kho, garba |
| `SEED_EQUIPMENT` | 64 items incl. mudgar (single, pair), Indian clubs, gada, steel mace, sumtola, nal, gar nal, mallakhamb pole and rope, akhara, and household items (chair, table, towel, door, backpack, water jug, bucket, wheel or rod) |
| `SEED_SUPPLEMENTS` | 23 supplements; `NO_EXPECTED_BENEFIT` 12 (BCAA, HMB, fat burners, …, with the null evidence); `SUPPLEMENT_ADVISORIES` 2 |
| `CATALOGUE_SOURCES` | 75 sources (R3's 24 plus the R4 references, de-duplicated by URL). Every entry above lists source keys; `internal: true` marks pointers into the research notes, which are never rendered |
| `SEED_MAPPINGS` | One R5 `MappingDef` per mapped exercise (59) |
| `FOOD_FIXTURE` | 12 foods for tests only (values rounded from memory of USDA SR Legacy, `verified: false`) |
| `SEED_CATALOGUE`, `SEED_INPUT`, `CATALOGUE_VERSION` | The assembled catalogue; logged sessions store `CATALOGUE_VERSION` |

Generated from the seeds and reviewed. Added on top of the seeds: `tags` per exercise (jumping, highImpact, overhead,
floor, noisy, supervised; for intake refusals such as "no jumping" or "nothing overhead"), `status` per exercise (R5 route:
mobility-only → `infoOnly`; ballistic, odd-object, C/D-grade and analog-MET items → `mapped`; others → `modelled`),
`loadFactor` {0.25, 0.5, 0.75} on ballistic items, a plain-language mechanism where the seed left it empty, normalised
supplement doses `{amount, unit, per, perKg, range, upperLimit, details}`, supplement diet compatibility, per-outcome
grades with direction (effect, null, harm), and each supplement's engine mapping (creatine → lever L7
`substances.creatineG`; omega-3 → L8 `macros.fatTypes.omega3G`; psyllium → L9 fibre; caffeine → L6; protein powders →
`macros.protein` + `proteinSource`; electrolytes, magnesium, potassium salt → `hydration.*`; the rest `infoOnly`). Internal
research pointers were removed from user-facing text (`leakScan` test).

**Food reference (later data task).** `FoodTable` is the contract (`get`, `search`, `all`, `version`); `createFoodTable`
builds one from `FoodRecord[]`. The bundle per R4 §2: about 2,000 USDA FoodData Central foods (SR Legacy + Foundation,
CC0; ≈ 155 KB gzip with 31 nutrients), Indian staples missing from USDA from IFCT 2017 only once NIN grants written
permission (else literature values flagged `verified: false`), hand-curated diet/allergen/Jain tags, `portions[]` with
ICMR-NIN katori sizes and the R4 §4.4 portion priors, `yieldRawToCooked`, `buyUnit`; lazy-loaded with the Food tab.

## 2. Schemas (`src/catalogues/types.ts`)

- `ExerciseRecord`: id, name, aliases, tradition, `equipmentAnyOf` (OR of AND-sets), pattern (32 R3 patterns), `regions`
  (1 direct, 0.5 indirect over the 9 engine regions), `loadType`, `intensityScale`, `volumeUnit`, `defaultDose`, `secPerRep`,
  `energy` {equation, metGross, metRange, compendiumCode, metSource}, `cardioModality`, `hybridCardioShare`,
  `mobilityTargets`, skill, injuryRisk, `contraTags`, `tags`, `mechanism`, `status`, `certainty`, `loadFactor?`, `sources`,
  `origin` (seed | ai-resolved | user).
- `EquipmentItem`: category, `ownershipKind` (normally owned vs accessed; not a claim about the user), `loadRangeKg`,
  `adjustable`, `enablesPatterns`, `priceTier` 0–4 (INR estimate), `space`, sources.
- `SupplementRecord`: status, goals, mechanism, normalised dose, timing, form, food-first alternative, contraindications
  `{flag, note}` (flags must map to the safety gate), interactions, cautions, diet compatibility, graded outcomes, engine
  mapping, sources, maintainer notes.
- `FoodRecord`, `Nutrients` (per 100 g, R4 §2.4 set; carbohydrate by difference, so net carbohydrate = carb − fibre),
  `FoodTable`, `NutrientTargets`, `MealTotals`.
- `EvidenceLabel` = `{ mechanism: { known, pathway, route: 'modelled'|'mapped'|'infoOnly'|'none' }, certainty: 'A'|'B'|'C'|'D' }`;
  `MappingDef`, `TauPrior`, `Indirectness` (R5 §3.1).
- `TrainingProfile` (PLANNER_V2 §8.1 plus R3 §7: `loadsKg`, `capacities`, `enjoy`, `cleared`, access `hours`).
- `PerformedExercise` (a logged or prescribed instance: sets or compact fields, minutes, MET, speed, grade, watts, steps,
  carried load), `StimulusVector`, `StimulusIntent`, `EquivalenceResult`, `ShortfallNote`, `ExerciseDraft`,
  `ExerciseResolver`, `UserCatalogue`.

Differences from the PLANNER_V2 §8.1 sketch: R3's vocabularies are used for `loadType` (external, bodyweight, odd-object,
ballistic, isometric, cardio, mobility), `intensityScale`, `priceTier` 0–4 and `space` (none … large), as the spec says it
is aligned with the R3 seed. `StimulusVector` and `EquivalenceResult` carry additive fields (below).

## 3. API by consumer

### E5 (living plan: daily log, adherence score, `toLoggedDay`)
```ts
resolveSession(log: PerformedExercise[], catalogue, ctx: StimulusContext): { doses: ExerciseDose[]; vector: StimulusVector; unresolved: PerformedExercise[] }
resolveStimulus(log: PerformedExercise | PerformedExercise[], catalogue, ctx): StimulusVector          // PLANNER_V2 §9.4
toEngineDose(doses: ExerciseDose[], startH: number): EngineTrainingDose  // {resistance: ResistanceSession|null, resistanceMet, cardio: CardioSession[], energy}
stimulusEquivalence(prescribed: StimulusVector, performed: StimulusVector, alpha?: StimulusIntent): EquivalenceResult
sessionEquivalence(prescribed: PerformedExercise[], performed: PerformedExercise[], catalogue, ctx, alpha?): EquivalenceResult
nutrientEquivalence(targets: NutrientTargets, actual: MealTotals): NutrientEquivalenceResult
weeklyDose(week: StimulusVector[]): WeeklyDose        // sets/region/wk, preset, below-minimum regions, 150 MEM, VO2 maintenance
intentFor(goal: 'muscle'|'strength'|'fatLoss'|'vo2max'|'mobility'), defaultIntent(prescribed)
```
`StimulusContext = { bodyMassKg, vo2max (mL/kg/min), heightM?, rmrKcalPerDay? }` (from the confirmed state). The adherence
credit of a session is `EquivalenceResult.credit` (1 at parity S ≥ 0.90, else S); nothing is rejected, and the engine
always simulates the logged stimulus (write `toEngineDose(...)` into the day). Hybrid and ballistic items compile into a
resistance part and a cardio part by `hybridCardioShare`; minutes without hard sets (stretching, flows) are booked as light
'other' activity at their own MET.

### E6 (planner)
```ts
trainingEnvelope(o: ComposeOptions & { weekday?, startH?, maxMinPerSession?, includePurchases? }): TrainingEnvelope
composeSession(rx: ResistancePrescription | CardioPrescription, o: ComposeOptions): ConcreteSession
composeSessions(rxs, o): ConcreteSession[]             // in order; earlier sessions rotate equal choices
shoppingList(rxs, o & { ideal?, limit? }): ShoppingItem[]
catalogueEdges(catalogue): CatalogueEdge[]            // evidence-graph edges, from.kind 'catalogue', τ for mapped items
SEED_MAPPINGS, exerciseMapping(ex), INTENT_DEFAULTS, CATALOGUE_PARAMS
```
`ResistancePrescription = { kind: 'resistance', weekday, startH, maxMin, setsByRegion (effective), loadPct1RM?, rir?, intent? }`,
`CardioPrescription = { kind: 'cardio', weekday, startH, modality, minutes, pctVo2max, maxMin?, intent? }`,
`ComposeOptions = { profile, catalogue, ctx, purchases?, history?, allowImpact?, fullCatalogue? }` (Ideal: `fullCatalogue`).
`ConcreteSession = { items: ConcreteItem[], minutes, delivered, target, equivalence, withinTolerance, shortfall, spill,
engine: EngineTrainingDose, purchasesUsed }`. Write `engine.resistance.setsByRegion` (counted fractionated sets; the engine
applies f_RIR, f_load, f_rest) and `engine.cardio` into the schedule so the simulated dose is what the person is told.
`withinTolerance` false = outside the envelope (treat as infeasible). `ShoppingItem.benefit` is left empty for the
planner's engine re-run (top 3, PLANNER_V2 §8.5).

### E7 (intake)
`TrainingProfile`; vocabularies `PATTERNS`, `TRADITIONS`, `CONTRA_TAGS`, `EXERCISE_TAGS`, `EQUIPMENT_CATEGORIES`,
`CARDIO_MODALITIES`, `REGION_LABEL`, `PATTERN_LABEL`; `SEED_EQUIPMENT` grouped by `category` for the chips (Indian group =
`category: 'indian'`); `catalogue.searchExercises(q)` (aliases: "bethak", "mugdar", "danda" …); `isWilling(ex, {profile})`.

### E9 (AI tools: log by talking, resolve on the spot)
```ts
resolveUnknown(name, description, { catalogue, resolver?: ExerciseResolver }): Promise<ExerciseDraft>   // catalogue → AI → heuristic
resolveUnknownSync(name, description, catalogue): ExerciseDraft
validateDraft(draft): string[];  draftToRecord(draft, { id, origin? }): ExerciseRecord   // mapped, certainty D, wider τ
resolveUnknownEquipment(name, catalogue, { id, patterns?, loadKg? }): EquipmentItem
createCatalogue(SEED_INPUT, user: Partial<UserCatalogue>): Catalogue                    // user entries win on id clashes
mealTotals(components, table), logBand(value, kind, nutrient?, restaurant?), LOG_SIGMA  // R4 §4.3 bands
```
`ExerciseResolver = { id; resolve(input: {name, description?}, ctx: {candidates}): ExerciseDraft | null | Promise<…> }`.
An invalid or failing AI result falls back to the heuristic; nothing is refused.

### E13 (UI) and E15 (Evidence library)
`ConcreteItem.text` ("Mudgar swing, single heavy club two-handed: 6 × 20 (60 s rest, about 100 kcal)"), `ShortfallNote.text` ("Chest work is
short: add 1 set."), `ShoppingItem.text`, `swapOptions(prescribed, o & {weekday, startH, alpha?, limit?}): SwapOption[]`
(ranked by credit, then utility), `exerciseLabels(ex)`, `supplementLabels(s)`, `evidenceClause(label, anchorName?)`,
`inclusionReason(labels)`, `hedge(certainty)`, `inflateBand(...)`. All copy is plain language and never says
"speculative"; tests scan it for internal references.

## 4. Formulas and decisions

**Stimulus (R3 §3).** Per set E = region weight × f_RIR(RIR, L) × f_load(L) × f_rest(rest) × f_type, with the muscle
module's own factors read from its registry (tests compare against `src/engine/model/muscle/equations.ts`). Load: logged
%1RM, else kg/1RM, else L_eq = 100/(1 + (reps + RIR)/30). f_type: 1; ballistic 0.5 (bouts ≥ 20 s or with reps, not at
RPE < 7); holds 0.5, or 1 when held near failure (applied to every hold, also bodyweight planks). RIR from RPE as 10 − RPE.
Minutes = sets × (work + rest); a log of minutes only scales the default set count; round-based flows (Surya Namaskar) and
minute-only resistance items (mallakhamb, circuits) count one hard set per 2.5 resistance minutes (engine default).
Energy: MET × 3.5 × kg/200 per minute, or the item's equation when its inputs are logged (Ludlow walk, ACSM walk/run/step,
cycling by watts, Pandolf); band from the MET range, or from R5's certainty floor of the equation's grade. Cardio: x =
MET·3.5/VO2max, MEM = engine memWeight(x) × minutes, high-intensity minutes at x ≥ 0.85.

**Equivalence (R3 §5, PLANNER_V2 §8.6).** S = Σ α_k S_k / Σ α_k over terms the prescription has. S_hyp = Σ π_r min(E_log,
E_pre)/Σ π_r E_pre with π_r from `regionPriority`; a prescription built from catalogue items defaults π_r to their region
roles (direct 1, indirect 0.5), a planner slot to 1. Rationale: R3's worked examples weigh the prime movers; with π = 1
throughout, example 3 (baithak for back squat) lands at S = 0.597, a hair under the partial band the spec's test table
requires; with roles it is 0.625 (partial) and example 1 stays at full credit (0.92). S_str = Σ over prescribed strength work
of best c(pattern, implement) × min(1, f_loadS ratio), c = 1.0 / 0.8 / 0.5 / 0.2 (neighbours: horizontal↔vertical push,
horizontal↔vertical pull (added by symmetry), squat↔lunge, hinge↔ballistic hinge). S_card, S_kcal, S_mob as R3; logged
"general" mobility minutes fill any target's gap. Bands 0.90 / 0.60. Meals: each targeted nutrient scores 1 inside R4
§3.5's tolerance (protein and fibre overshoot score 1), tapering linearly to 0 over a further 50 % of target (an
engineering default, `unverified`; E5 should prefer the engine-sensitivity taper), weights 4/3/2/2/1.5 (R4 §3.4).

**Composer (PLANNER_V2 §8.3).** Candidates: available (owned 1, access 0.8 / 0.5 outside its hours, plan purchase 0.5;
all 1 with `fullCatalogue`), not refused (id, pattern, tradition, equipment or tag; enjoy −2), no uncleared contraindication,
skill ≤ user + 1, no high impact when barred. Greedy fill by U = 3·avail + enjoy + 2·cover − 0.5·min/10 − 0.5·(risk − 1)
− 0.3·skillGap, sets ≤ 5 rounded to the deficit, ≤ 2 exercises per pattern, warm-up 5 min, until every region is within
0.5 effective set; then one 1-swap pass that may not enlarge the shortfall. Loads: loadable items get reps from the target
%1RM and RIR; bodyweight items use the person's reps to failure when known, else the default dose. Tolerance is judged
on shortfall; spill to untargeted regions is reported in `spill`. Cardio slots prefer the prescribed modality when any
available item delivers it, at a MET clamped to the item's range. Shopping list: candidate bundles are the ≤ 3 purchasable
items an exercise lacks; ΔU = U*(with) − U*(without) where U* = Σ sessions [2·S − 0.5·(minutes / S)/10] (time per unit of
coverage, so delivering more of the prescribed dose is not penalised); ranked by ΔU/(priceTier + 1), ΔU < 0.05 omitted;
the best bundle that restores feasibility is `required`, the others are alternatives; free household items are listed as
"use what you have" and never count against the allowance.

**Evidence (R5).** Inclusion = some label with a known pathway that reaches the engine (`modelled` or `mapped`), unless
direct null/harm evidence; certainty is never read for inclusion (tested over every item). Band: σ_floor = f[grade]·|value|
(5/10/20/35 %), k = max(1, σ_floor/σ_band), centre fixed, clipped to bounds, log-space option. Mapped certainty = anchor −
indirectness (floor D, +1 for an agreeing direct trial up to the anchor). τ ~ (1 − w)·LogNormal(ln median, 0.10 + 0.50·(1 −
S)) + w·U(0, 0.5), w 0.10 (links shown) / 0.25 (link assumed or AI). R5's gada and sattu worked examples and the jeera-water
counter-example are tests.

## 5. Discrepancies and items for review

1. Ballistic credit: R3 and PLANNER_V2 §8.3 count a ballistic set at 0.5; R5's gada example implies about 0.8 (f_load
   triangle mode). Nominal follows the spec (0.5, `catalogue.ballisticSetFactor`); R5's triangle is kept in the evidence
   test and noted on the param.
2. Certainty of Indian implements: R3 grades gada and heavy mudgar D; R5's policy computes C for hypertrophy (anchor A − 2).
   `ExerciseRecord.certainty` keeps R3's grade; `mapIntervention` computes R5's per outcome.
3. π_r default and the composer's lexicographic swap rule (§4) are interpretations needed to meet the spec's own worked
   examples; both are single constants or one function to change.
4. R3's example 2 fix line ("a 12-minute brisk walk closes the gap") does not follow from its own numbers; the shortfall
   text here is computed from the logged activity's MEM per minute.
5. Two supplement entries (electrolytes for fasting, electrolytes for low-carb/sweat) cite only internal research notes;
   validation reports this as a warning. A public reference should be added.
6. Price tiers, injury risk, skill, hybrid shares and the tag lists are engineering estimates (grade D), as R3 states.

## 6. Requests to other packages

- **Engine (E2):** additive `ResistanceSession.met?: number` (R3 open question 1). Until then `EngineTrainingDose.resistance.style`
  is the nearest Compendium style and `resistanceMet` carries the exact MET; mudgar at 7.5 MET is booked as
  'bodybuilding' 6.0 on its resistance part.
- **PLANNER_V2 §8.1/§8.6 (A2):** adopt the additive `StimulusVector` fields (`regionPriority`, `strength`, `perSetCredit`,
  `netKcalPerMin`, `memPerMin`, `meanRir`, `minutes`, `exerciseIds`), `EquivalenceResult.score/band/alsoTrained`, and R3's
  vocabularies for `loadType`, `intensityScale`, `priceTier`, `space`.
- **SUITE_SPEC (A1):** path `src/catalogues/` instead of `src/catalogue/`; add `src/catalogues/**` and
  `src/content/catalogues/**` to the tier-P ESLint block (`eslint.config.js`, owned by E4).
- **Data tasks:** the food bundle (§1); INR price check; one lab measurement of mudgar/gada oxygen uptake (moves their MET
  from analog to measured); per-pattern Epley divisors (R3 open question 3).

## 7. Batch 02 (v0.3): kitchen and pantry (E17), supplement states (E18)

Normative: `docs/SUITE_SPEC.md` §13.3 and §13.2; hand-backs `docs/wp/E17.md` and `docs/wp/E18.md`; research R12
(`plan/02-next/research/R12-kitchen-cuisine-pantry.md`, `R12-seed.json`).

### 7.1 Kitchen and pantry catalogue (E17)

| Path | What |
|---|---|
| `scripts/kitchen-catalogue.mjs` → `src/content/catalogues/kitchen.ts` | Generated from the R12 seed: one item per line plus `KITCHEN_COUNTS`. `--check` mode; a test asserts the module equals the seed and is byte-identical to the generator's output |
| `src/content/catalogues/kitchenCatalogue.ts` | `loadKitchen()`: lazy chunk (407 kB, 58 kB gzip), one catalogue and search index per app; a failed load can be retried |
| `src/catalogues/kitchen/` | Pure library: types and documents, catalogue and groups, validation, region defaults, search, free-text resolver and paste-a-list parser, food-reference resolution, list edits, the "still have it?" rule, v0.2 migration, Coach block and recipe constraints |

| Equipment | Cuisines | Staples | Pantry | Regions |
|---|---|---|---|---|
| 181 (cooking 87 · prep 65 · storage 18 · serving 11) | 139 (Indian 78) | 288 | 546 | 17 (12 Indian, 5 world) |

Ids are namespaced so the four lists share one search index: `eq.*`, `cu.*`, `st.*`, `pa.*`; an item that matches nothing
is `custom:<slug>`. Food links are carried as delivered: `fixtureId` on 19 items, a USDA SR Legacy id on 616,
`ifctPending` on 260. Each region has `defaults` ("common here", shown first in each group, not ticked) and `preTick`
(ticked on first view).

**Documents** (both LWW-F, synced, exported; commands in `docs/COMMANDS.md` §9c):

| Document | Schema | Content |
|---|---|---|
| `kitchen/me` | `vitals.kitchen/1` (`KitchenDoc`) | `equipment[]` `{id, label?, note? (≤ 80 chars), use: 'use' \| 'ownNotUsed', addedAt, source}`; `cuisines[]` `{id, rank}` (1 = most often); `staples[]` `{id, source}`; `regions?` (the picker's "Use another region" choice; additive to §13.3) |
| `pantry/me` | `vitals.pantry/1` (`PantryDoc`) | `items[]` `{id, label?, qtyApprox? (as written, never parsed into grams), source, addedAt, lastConfirmedAt?}` |

`source` is `picker | coach | paste`; AI and agent actors always write `coach`.

**Item states.**

| State | Meaning | Where it shows |
|---|---|---|
| Equipment `use` | Owned and used | Plain chip |
| Equipment `ownNotUsed` | Owned, not used ("· not used"); set with the "own it, don't use it" switch in the chip's note popover | Chip suffix; the Coach briefing lists it |
| Assumed | Picker UI state only (`PickerEntry.assumed`): a region pre-tick not yet touched, drawn with a dashed outline. A touch, an edit or Done confirms it; "Clear defaults" removes the entries still assumed. Never stored (the intake widget strips the flag on save) | Picker |
| Confirmed | Every stored entry. A pantry item is confirmed again by adding it again (`lastConfirmedAt`) or through "Still have these?" on `/food/pantry` | Picker, Settings › Kitchen, Food tab |
| "Still have it?" | A **perishable** pantry item whose `lastConfirmedAt ?? addedAt` is more than 14 days old (`STALE_DAYS`, `staleItems`; `pantry.get` returns them as `askStillHave`). The Coach may ask when a recipe depends on it | `/food/pantry`, Coach |

Nothing is ever removed by time (a test runs 400 simulated days). Perishables are never pre-ticked, even where the seed
lists them in `preTick` (13 items across 6 regions); they stay "common here".

**Decisions.** Search ranks 1 for the whole name or alias (plurals folded), 0.92 for a name prefix, 0.86 when every query
word is in the name, 0.85 for a word prefix, then token overlap, then 0.6 for a substring; free text is accepted at ≥ 0.8
(`ACCEPT_AT`), and on a tie pantry wins over staples. Food links never show numbers: the pantry view gives a status only
(`resolved` / `pending` (IFCT) / `notBundled` / `none`); only the 19 fixture-linked items resolve today. Migration from
the v0.2 intake (`intake/me.kitchen`, `diet.cuisines`, `diet.staples`) is lazy: reads return the migrated lists with
`fromIntake: true` and write nothing; the first write persists them with the edit.

**Open.** Map `usdaFdcId → FoodRecord.id` when the food bundle lands (`resolveFood(cat, id, table, fdcToFood)`); 172
IFCT-pending items wait for the licence. `food.candidates` and the grocery "already have" set still read the v0.2 pantry
(see `docs/LIVING_PLAN.md` §8.1).

### 7.2 Supplement states (E18; `src/catalogues/supplements/`)

The person's supplements are stored in the `supplements` section of `intake/me` as v2 (`SupplementsSectionV2 = {_v: 2,
stance, rows[]}`); commands `supplements.get` / `set` / `remove` (`docs/COMMANDS.md` §8).

| Stance | Answer text |
|---|---|
| `taking` | "I already take some" |
| `onHand` | "I have some at home but don't take them" |
| `open` | "None now, but I'm open to them" |
| `food_first` | "I'd rather get everything from food" |

| Row state | Meaning | Planner channel | Food tab / Coach |
|---|---|---|---|
| `taking` | Taken now; needs a dose and at least one time of day | Lever family in `optIns.levers` (consent); listed as `habitual` | "yours" row with a Taken key (`log.supplement`); catalogue cards skip it |
| `onHand` | At home, not taken | Lever family in `optIns.levers`; listed as `onHand` (meant for "never in things to buy") | Catalogue cards skip it |
| `notForMe` | Refused | Lever id in `constraints.excludedLevers` (the `SUPPLEMENT_REFUSALS` path; kept by the Ideal) | Never suggested |
| `unknown` | No decision | Stance `open` with no rows keeps the old default `['creatine']`; `food_first` offers nothing | Catalogue cards only when `open` |

Levers: creatine L7 (family `creatine`), omega-3 L8 (`omega3`), psyllium L9 (`fibre`), in that fixed order, so the
request hash of an unchanged v1 `open` stance is unchanged (tested). Other supplements are display-only (§1).

**Dose.** `dose` is the amount **each time**; the daily amount = dose × number of times (`dailyAmount`), and upper-limit
checks use the daily amount. Times of day: `morning`, `midday`, `evening`, `night`. Defaults are prefilled from the
catalogue's adult amount, except body-weight doses (caffeine mg/kg, bicarbonate g/kg) and rule doses (salt substitutes,
B12, calcium, iodine); times are never prefilled.

**Units.** Per catalogue item: the catalogue unit reduced to one you can type ("g protein" → g, "mg/kg" → mg, "mmol
nitrate" → mmol) plus the forms the item is sold in (`EXTRA_UNITS` in `dose.ts`: scoop for protein and creatine,
µg/tablet/capsule for vitamin D, …). Free-text rows offer g · mg · µg · IU · ml · scoop · tablet · capsule. Conversions:
g/mg/µg, and IU ↔ µg for vitamin D only (40 IU = 1 µg).

| Check | Kind |
|---|---|
| No amount or no time on a `taking` row; amount ≤ 0; an amount no product holds (per-unit cap, e.g. > 500 g); a unit the item is not sold in | Error (`invalid_input` with the field path) |
| Above the catalogue upper limit (caffeine 400 mg, magnesium 350 mg, vitamin D 4000 IU, iron 45 mg, calcium 2500 mg a day) | Warning in the row ("worth checking with a doctor or pharmacist"), never a refusal |

**Migration v1 → v2** (`toSectionV2`): `stance: 'open'` with a non-empty v1 `taking[]` → `stance: 'taking'`; each v1
entry → a `taking` row with `timesOfDay` from `clockH` (< 11 morning, < 16 midday, < 21 evening, else night); `food_first`
stays. Writes through `supplements.*` store the whole v2 section; a merge patch through `intake.answer` can leave a stale
v1 `taking` key next to `_v: 2`, which readers ignore.

**Not built.** The habitual hook in the engine (`taking` only grants consent; the request has no field for "in the
baseline and every rung"); the dose on Today; safety flags reaching the row's caution line (Food's `safetyFlags` is
still `[]`); free-text rows are not matched to the catalogue later.
