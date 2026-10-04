# src/engine/body: body estimation, regional allocation, avatar

This module implements `research/14-anthropometrics-fat-distribution.md` (M1-M12). It is pure TypeScript with no DOM access and no dependencies, and it is deterministic. Import it from `./body` (`index.ts`). All masses are in kg, lengths in cm and %BF in the DXA frame (NHANES/Hologic).

## Public API

| Function | Purpose (dossier section) |
|---|---|
| `estimateInitialState(inputs: BodyInputs, opts?: { bodyFatPctOverride? }): BodyEstimate` | Full initial state (M3, M5, M6, M8, M9, M11). `bodyFatPctOverride` re-partitions the body at a forced BF%, for ±1 SD robust evaluation or Monte-Carlo draws. |
| `estimateBodyFat(inputs): BodyFatFusion` | Constrained GLS fusion of CUN-BAE+DXA offset, RFM, Navy, visual sliders and known BF% (M3). Returns each observation's weight. |
| `allocateRegional(prev: RegionalComposition, target: { fatMassKg, skeletalMuscleKg, vatKg? }, opts?): RegionalComposition` | Regional fat/muscle update for each simulation step (M7). Uses the K_LOSS/K_GAIN susceptibilities and internal 0.05 kg sub-steps, so results do not depend on step size. Mass is conserved exactly. |
| `stateToAvatarParams(state: BodyState, { baseline? }): AvatarParams` | Circumferences, ellipse sections per landmark (front and side), definition and face-fullness drivers (M8, M10). |
| `lerpAvatarParams(from, to, t)` | Before-to-after morph (M10). |
| `circumferencesFor(state, baseline?)` | Displayed circumferences: the measured anchor plus the geometric change, with ψ = 0.83 applied to waist loss (M8). |
| `defaultSliderPositions(body)`, `slidersFromEstimate(est)`, `liveEstimate(inputs)`, `sliderToBodyFat` / `bodyFatToSlider`, `sliderToFfmi` / `ffmiToSlider`, `bellySliderToZ` / `zToBellySlider`, `visualImpliedWeight` | Forward and inverse slider helpers (M2, M3). |
| `adiposityAnchorTable(sex, age)`, `muscularityAnchorTable(sex, age)`, `FAT_ANCHORS`, `FFMI_ANCHORS`, `*_DESCRIPTORS`, `SLIDER_RANGES` | UI data from tables T2 and T3, including typical and athletic FFMI and age-specific percentiles. |
| `lmsValue` / `lmsZ` / `lmsPercentile`, `cunBae`, `rfm`, `navyMetric` / `navyInches`, `deurenberg1991`, `gallagher2000`, `kagawa`, `jacksonPollock3`, `watsonTbw`, `dxaFrameOffset`, `ETHNICITY_ADJUSTMENTS`, `BODY_SAFETY_FLOORS` | Building blocks and reference data (M1, M4, sec. 9). |

`BodyEstimate extends BodyState`, so an estimate can be passed directly to `allocateRegional` and to `stateToAvatarParams`.

## Evidence status

Every constant carries a comment giving the dossier section and its source. Constants the dossier marks as unverified or proposed are tagged `// UNVERIFIED` or `// PROPOSED` (including `PROPOSED FIT`). Additions of my own, where the dossier is silent, are tagged `PROPOSED (own)`.

- **Evidence-backed (grades A–B):**
  - the CUN-BAE, RFM, Navy, Deurenberg and Gallagher equations;
  - the Kelly 2009 LMS tables and percentiles;
  - VAT allometry with k = 1.3 (Hallgreen & Hall 2008);
  - the waist and MUAC geometry, calibrated to NHANES 2015–18 and CALERIE-2;
  - Cunningham RMR, FFM hydration of 0.73, and the Kim 2002 SM–ALM relationship.
- **Proposed or unverified (grades C–D):**
  - the DXA-frame offsets and visual-slider sigmas, the correlation structure and the training prior;
  - VAT constants and age terms, the K tables, and depot and regional-muscle shares;
  - the hip model and every chest, neck, thigh and calf constant;
  - all avatar ratios and landmarks;
  - the glycogen conversion and liver glycogen of 90 g;
  - the female FFMI ceiling of 20.6.

## Interpretations and deviations (details are in the code comments)

1. LMS tables are interpolated linearly between decades, as M4 specifies. The dossier prototype evidently used Kelly's per-year tables, so two strict checks miss and are kept as `it.fails`:
   - golden case #6: legs 9.570 vs 9.55 kg and SAT 10.881 vs 10.90 kg;
   - Kelly text check at 69 y: P10.02 vs P9.9.
2. V8 (NHANES waist) passes at age 40, the fit condition: max error 3.49 / 3.03 cm. Across ages 25–65 the maximum is 4.5 cm (men, 65 y, BMI 42). This is kept as `it.fails`.
3. When `knownBodyFatSource` is omitted, the source defaults to BIA (σ 3.5).
4. The obese sigma inflation (×1.2 when E1 > 40) and the Black-adult inflation (×1.2) come from the M1 bias table. They are absent from the M12 pseudo-code, but I implemented them.
5. The Hispanic (Mexican-American) offset of +0.7 (men) is implemented even though the dossier says "ignore for simplicity". The Asian VAT ×1.25 multiplier is also applied to South-East Asians.
6. Menopause status moves the women's VAT age pivot (48 y). `'pre'` after 48 keeps the shallow slope. This is my reading of "modulates the VAT age term".
7. Avatar extras (`chest`, `arms`, `face`) scale a share by (1 + 0.4·s) and renormalise. `face` scales the head share of FM, and `arms` scales the arm share of limb fat. The female trunk-SAT shares (.55 / .25 / .30) are renormalised to sum to 1.
8. Thigh and calf fat and muscle are applied per leg (leg depot ÷ 2). Neck fat is 0.3 × the head depot, and the chest band is 0.5 × trunk SM. The reference body for these girths is BMI 24 (men) / 22 (women) at age 30. All of these are own choices.
9. Female bideltoid is 0.95 × the dossier's single 0.259·H. Without this, women's shoulders came out as wide as men's.
10. Vascularity is `1 − smoothstep` (the dossier prints `smoothstep`). `BFeff` uses the trunk:limb z-score, which the M8 lean-sanity values confirm.
11. The fPot denominator is floored at 1 FFMI unit, so heavy people whose expected FFMI approaches the ceiling stay defined.
12. Muscle regional change has no dossier exponents. It is shared by current mass × optional weights.

## Integration notes (for the core-contract architect)

- **Carry the state.** Simulation states must carry the `BodyState` fields: `fat`, `muscle`, `satShares`, `frameZ`, and FM/FFM/SM/weight/sex/age/height.
  - After FM or SM changes, call `allocateRegional`. FFM and SM dynamics are owned by dossiers 01, 03 and 09.
  - Pass tissue FFM, without acute glycogen or water swings, to the avatar.
- **Avatar calls.** For simulated states, always call `stateToAvatarParams(state, { baseline: estimate })`. `measuredCircumferences` belongs to the t = 0 estimate only; a simulated state that copies it and is rendered without a baseline would freeze at the measured values.
- **Training status.** `training.{ffmi, ffmiNormalized, ffmiUntrainedRef, trainingYears}` are the inputs to dossier 09's `TS0`. Per the M9 note, dossier 14's smaller `dFFMI_train` is used only as the BF prior shift. `fPot` is exposed for display.
- **Unused-slider rule.** The UI must pass `undefined` for sliders the user has not touched. Default positions are for display; feeding them back as observations shrinks the SD (see the tests).
- **Energy.** `energy.{rmrKcal, tdeeKcal, intake0Kcal}` uses Cunningham RMR × PAL (default 1.5) as the default. Dossier 02 owns the final RMR and PAL rules.
- **Type name clash.** `Sex = 'male' | 'female'` is defined locally with the same literal union as `src/engine/types`. Re-exporting both with `export *` would collide.

## Known limitations

- Percentiles use the White NHANES 1999–2004 reference, which is a generation old.
- Ethnicity affects only the BF offset, its sigma, and VAT.
- The avatar is D-grade: SVG-level fidelity, and chest, neck, thigh and calf are not calibrated. The dossier recommends an offline ANSUR II fit.
- Extreme-leanness android loss is under-predicted (V7: model −57 % trunk vs −68 % android observed).
- No regain-redistribution model.
