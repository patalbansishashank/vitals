# 08 — Autophagy & nutrient-sensing / longevity pathways (mTORC1, AMPK, sirtuins/NAD+, insulin/IGF-1, FGF21)

Dossier v1 · 2026-09-30 · research agent 08 · follows `research/RESEARCH_PROTOCOL.md`

> **Bottom line for the engine and the UI (read first)**
> 1. There is **no method that measures autophagy in a living person's organs**. The only validated human
>    *flux* assay works on blood mononuclear cells (PBMCs) treated ex vivo in whole blood (Bensalem 2021 [10]).
>    With it: 35 g protein did **not** change flux at 1 h [12]; 4 weeks of 10 % vs 20 % protein did **not**
>    change flux [14]; 6 months of intermittent fasting + early TRE gave a **post-hoc** difference vs control
>    (P = 0.04) with **no within-group increase** [13]; calorie restriction did nothing detectable [13];
>    a 5-day fasting-mimicking diet gave a borderline increase in a 30-person pilot [16].
> 2. In human skeletal muscle (static markers only), a **72 h** water fast raised LC3B-II ~30 % and cut mTOR
>    phosphorylation 40–50 % [1]; 36 h produced only modest, mixed changes [2,3]. **Exercise produces larger and
>    more consistent acute changes than fasting** (e.g., LC3-II x1.7 in muscle and PBMCs 3 h after a vigorous
>    bout in untrained men [29]; LC3b-II +554 % after a 24 h run [28]).
> 3. Therefore the chartable "autophagy" output is a **PROPOSED, relative, conditions-based Autophagy Signal
>    Index (ASI, 0–100; evidence grade C/D)** that encodes *when the conditions known to favour autophagy are
>    present*, not how much autophagy occurs. Its central time-constant (half-maximal fasting drive at
>    **48 h**, plausible range 24–96 h) is anchored to the sparse human data, not to mouse clocks.
> 4. Better-grounded companion outputs: **IGF-1 relative level** (grade B; fitted ODE in §4.12),
>    **muscle AMPK index** (grade B, exercise-driven; fasting does *not* activate AMPK in human muscle [4]),
>    **muscle mTORC1 index** (grade B/C).
> 5. Autophagy-favouring and muscle-building states are **temporally separable** within 24 h (mTORC1 is elevated
>    only ~2–4 h per protein feeding [36]); daily 14–16 h fasting windows are compatible with hypertrophy when
>    protein ≥1.6 g/kg/d is fitted into ≥3 feedings [61,89,90]; multi-day fasts, chronic CR and protein
>    restriction are in genuine conflict with muscle gain (§4.15).

**Where each commissioned question is answered:** Q1 human fasting-autophagy evidence → §4.1 · Q2 animal time
courses & scaling → §4.2 · Q3 mechanistic inputs (mTORC1/insulin/AMPK/glycogen/ketones/sirtuins) → §4.3–4.7 ·
Q4 exercise-induced autophagy → §4.8 · Q5 tissue specificity & mTOR trade-off / goal conflict → §4.14–4.15 ·
Q6 protein/methionine restriction, IGF-1 vs sarcopenia → §4.16 · Q7 CALERIE, FMD, IGF-1 → §4.17 (+§4.12) ·
Q8 compounds → §4.18 · Q9 measurable housekeeping outputs → §4.19, §4.11–4.13 · Q10 popular claims → §8 ·
Deliverable: PROPOSED ASI → §4.10; companion indices → §4.6, §4.11, §4.12; compatibility vs muscle gain → §4.15.

---

## 1. Scope

Covers autophagy and the nutrient-sensing network that controls it — mTORC1 (amino acids/leucine, insulin),
AMPK (energy stress, exercise, glycogen), sirtuins/NAD+, the GH/IGF-1 axis, FGF21 — as functions of what and
when a person eats and how they exercise. Covers human evidence quality, animal-to-human translation, the
calorie-restriction (CALERIE) and fasting-mimicking-diet literature, and supplements claimed to induce
autophagy (human evidence only). Delivers implementable equations for a **relative Autophagy Signal Index**,
companion **mTORC1, AMPK and IGF-1** indices, and the **goal-compatibility logic vs muscle gain** for the planner.
Out of lane (cross-referenced): glycogen/insulin kinetics (04), ketogenesis (05), fasting hour-by-hour (07,
20), MPS (03), training (09, 10), safety limits (17), planner algorithms (18), supplements catalogue (21).

---

## 2. State variables

| Engine id | Unit | Typical range | What it represents | Initial-value rule |
|---|---|---|---|---|
| `hFast` | h | 0–240+ | Hours since the start of the last *meaningful* intake event (resets on ≥10 g protein or ≥15 g digestible carbohydrate, §4.10) | Hours between the profile's habitual last meal and sim start; default 12 |
| `sNut` | 0–1 | 0–0.94 | Nutrient suppression of autophagy signalling (amino acid→mTORC1 and insulin→Akt→mTORC1/FoxO3) | 0 (post-absorptive) |
| `fDepth` | 0–1 | 0–0.97 | Fasting-depth drive (clock + liver-glycogen depletion + endogenous ketones) | Computed from `hFast` |
| `xEx` | arbitrary (0–1.5) | 0–1.5 | Acute exercise autophagy pulse (endurance + resistance), decays τ≈3 h | 0 |
| `cDef` | fraction of maintenance | 0–1 | 7-day EMA of energy deficit (fast day = 1.0) | 0 (or habitual deficit) |
| `asi` | index 0–100 | ~2–97 | **Autophagy Signal Index (headline, relative, grade C/D)** | 25 if `hFast`=12 |
| `asiMuscle` | index 0–100 | ~2–100 | Same core, larger exercise weight (muscle-specific view) | 25 |
| `mtorIdx` | index 0–100 | 10–100 | Muscle mTORC1 activity (anabolic signalling) | 20 (12 h post-absorptive) |
| `ampkIdx` | index 0–100 | 15–90 | Muscle AMPK (α2) activity | 20 (rest, normal glycogen) |
| `igf1Rel` | ratio to personal baseline | 0.2–1.05 | Circulating total IGF-1 relative to the person's habitual-diet level | 1.0 |
| `igfProt` | ratio | 0.5–1.0 | Slow protein-intake factor feeding `igf1Rel` | 1.0 at habitual protein |

Derived (not integrated): `fastingClockH` (= `hFast`, displayed), `asiWeeklyMean`, `asiDeepHoursWeek`,
`igf1Abs` (ng/mL = `igf1Rel` × baseline; baseline from user lab value or age/sex norms, dossier 16).

---

## 3. Inputs that drive it

| Input | Unit | Source module / bus signal | How it enters |
|---|---|---|---|
| Meal events: protein, leucine (or protein quality), digestible carbohydrate, fat, alcohol, clock time | g, h | `HourInput` (compileSchedule) | Reset rule for `hFast`; fallback AA/insulin kernels if bus signals missing |
| Plasma insulin | µU/mL (or relative, 1 = fasting basal) | `insulinProxy` (dossier 04) | `S_ins` (Hill, §4.4); sub-basal values optionally into F |
| Plasma leucine / EAA | fold vs post-absorptive | `leucineProxy` or derived from `mpsStimulus` (dossier 03) | `S_aa` (Hill, §4.3) |
| Liver glycogen | fraction of capacity | `liverGlycogenFrac` (dossier 04) | `F_glyc` (§4.5) |
| **Endogenous** β-hydroxybutyrate | mmol/L | `bhbMmol` minus exogenous-ketone component (dossiers 05, 15, 21) | `F_ket` (§4.5). Exogenous ketones must NOT count (§4.5, [42]) |
| Muscle glycogen | mmol/kg dw or fraction | dossier 04/10 | AMPK index resting term (§4.6) |
| Exercise sessions: type, %VO2max (or HR/RPE→%VO2max, dossier 10), duration, RT sets | %, min, sets | `HourInput.exercise` | `xEx` pulses (§4.8), AMPK index (§4.6), mTOR index RT term |
| Energy intake vs maintenance | fraction | dossiers 01/02 (`energyBalanceKcalH`) | `cDef` EMA (§4.9) |
| Daily protein intake | g/kg/d | compileSchedule | `igfProt` (§4.12) |
| Training status | untrained / recreational / endurance-trained | profile | Exercise-pulse damping (§4.8) |
| Age, sex | y, M/F | profile | **No effect on ASI by default** (evidence conflicting, §4.10); protein floors (§9) |

---

## 4. Mechanisms & equations

### 4.1 What has actually been measured in humans (Q1) — and why static markers mislead

**Static vs flux.** Autophagy is a *flux*: autophagosomes (LC3-II-decorated) form, fuse with lysosomes and are
degraded. A single-time-point LC3-II level is the balance of formation and degradation — a rise can mean
induction **or** blocked degradation; a fall can mean suppression **or** faster clearance. p62/SQSTM1 falls when
flux rises but is also transcriptionally induced (e.g., p62 mRNA rose after high-intensity exercise [25]).
ATG-gene mRNA is not activity. Serum "LC3"/"Beclin-1" ELISAs measure proteins that are intracellular and are
not accepted flux measures. Flux requires a lysosomal block (chloroquine, leupeptin, bafilomycin) with/without
comparison — impossible in human organs in vivo; feasible only ex vivo on blood cells [10] or cultured cells [5].
Authoritative guidance: Klionsky et al. 2021 guidelines [20]. Vendelbo et al. themselves could not exclude that
their fasting-induced LC3B-II rise reflected "autophagosome accumulation and autophagy inhibition" [1].

**Table 4.1a — Human nutrient/fasting studies with autophagy read-outs** (tabulated as requested: tissue,
fast duration, marker, change, n). "Static" = single-time-point protein; "Flux" = with lysosomal inhibition.

| Study | Tissue | Stimulus / duration | n, population | Marker(s) | Result (vs post-absorptive/control) | Read-out type |
|---|---|---|---|---|---|---|
| Vendelbo 2014 [1] | Skeletal muscle | 72 h water fast vs overnight fast; ± 2 h insulin clamp (0.8 mU/kg/min) | 8 healthy men, 26±4 y, BMI 23.8 | LC3B-II, p62, mTOR Ser2448, ULK1 Ser757, 4EBP1, rpS6, FOXO3a, MuRF1/MAFbx | LC3B-II **+~30 %**; p62 +~10 %; mTOR phos **−40–50 %**; ULK1 Ser757 ↓; non-phos 4EBP1 ↑; insulin ↓ LC3B-II on both days; FOXO3a, MuRF1, MAFbx unchanged; net forearm phenylalanine release **+~100 %** | Static + tracer |
| Dethlefsen 2018 [2] | Vastus lateralis | 36 h fast, biopsies 2, 12, 24, 36 h after standard meal | Untrained vs trained men (n per group not extracted — UNVERIFIED) | LC3-I, LC3-II, p62, AMPK Thr172, ULK1 Ser555/757, Beclin-1 | LC3-I, LC3-II and p62 ↓ in **untrained only**; AMPK, ULK1 Ser555 lower in trained; authors: "only modestly affected" | Static |
| Møller 2015 [3] | Muscle | 36 h fast vs glucose infusion, each with 1 h cycling 50 % VO2max | Healthy (n not extracted — UNVERIFIED) | ULK1, p62, ULK1 Ser555/757, LC3B lipidation | Fasting ↑ total ULK1 and p62 protein; exercise effects independent of fasting | Static |
| Wijngaarden 2013 [4] | Muscle | 48 h fast | 12 lean + 14 obese | AMPK activity | **AMPK activity ↓ in lean**, unchanged in obese | Kinase activity |
| Pietrocola 2017 [5] | Blood leukocytes | Zero-calorie fast up to 4 d (water, tea, coffee allowed) | 9 (5 M/4 F, 24–54 y, BMI 20–25) | Protein acetylation, LC3B lipidation, LC3B puncta, ex vivo leupeptin flux | Acetylation ↓ from 24 h; **no in vivo LC3B lipidation change**; flux ↑ only in ex vivo culture ± leupeptin; only **neutrophils** showed ↑ puncta | Static + ex vivo flux |
| Jamshed 2019 [6] | Whole-blood cells | 4 d eTRF (08:00–14:00; ~18 h daily fast) vs 12 h window, crossover | 11 overweight (7 M/4 F) | mRNA | Morning **LC3A mRNA +22±5 %** (p=0.001), SIRT1 +10±3 %, ATG12 +5±2 % (ns after FDR); evening MTOR mRNA +9±3 %; BHB +0.03 mM | mRNA |
| Erlangga 2023 [7] (+2026 re-analysis [8]) | Blood | Ramadan (~14–16 h daily dawn–dusk fast), 4 wk | 25 young men | ULK1, ATG5, BECN1 mRNA | ULK1 and ATG5 ↑ at 2 and 4 wk, back to baseline 1 wk after; BECN1 ↑ at 2 wk; food intake/sleep not recorded | mRNA |
| Dastghaib 2025 [9] | PBMC + serum | Ramadan 30 d | 24 fasting vs 26 non-fasting (20–78 y) | Beclin-1, LC3β, p62 mRNA; serum ELISA | Beclin-1 mRNA ↑; LC3β and p62 mRNA ↓ | mRNA / serum (low validity) |
| Bensalem 2021 [10] | PBMC in whole blood | Ex vivo leucine 200 µM + insulin 400 nM | 10 | LC3B-II flux (CQ 150 µM, 1 h) | Flux ↓ (p=0.028; 2/10 rose); method reproducible across days/operators | **Flux** (ex vivo) |
| Bensalem 2023 [11] | PBMC | Cross-sectional | 114 adults at T2D risk | Basal flux | **Flux increased with age** (contrary to animal dogma) | **Flux** |
| Singh 2025 [12] | PBMC | 35 g protein after 12 h fast; sample at 1 h | 42 healthy (+15 mTORC1 sub-cohort) | LC3B-II flux (ELISA), S6 phosphorylation | **No change in flux**; plasma BCAA ↑, modest mTORC1 ↑; females > males | **Flux** |
| Bensalem 2025 [13] | PBMC | 6 mo: standard care vs CR (70 % needs) vs iTRE (30 % needs 08:00–12:00 then 20 h fast, 3 non-consecutive d/wk) [96] | 121 with obesity | LC3B-II flux | 2 mo: ns. 6 mo: iTRE vs SC **P = 0.04 (post hoc)**, partly due to SC decline; **no within-group rise**; CR vs SC ns; Δflux inversely related to ΔTG | **Flux** |
| Singh 2026 [14] | PBMC | 4 wk 10 % vs 20 % energy protein (0.7 g/kg vs ~1.4), energy balance, crossover | 63 completers, 29.5±7.2 y, BMI 24 | LC3B-II flux | **No difference**: −8.46 ng LC3B-II/mg/h (95 % CI −24.06 to 7.14; p=0.28) | **Flux** |
| Dang & Sargeant 2025 [15] | 19 leukocyte subsets | Ex vivo amino-acid starvation | Healthy donors | Flow-cytometry LC3B-II flux | Monocytes ↑ strongly with AA starvation, **more in older donors**; females > males (non-classical monocytes) | **Flux** (ex vivo) |
| Espinoza 2026 [16] | PBMC | 5-d FMD (1,100 kcal d1; 700–800 kcal d2–5) vs control | 30 (11/10/9), 49±12 y; sponsor L-Nutra | CQ-treated/untreated LC3B-II/I ratio | Δ to day 6: ProLon +1.9 (SD 2.9), FMD2 −0.1 (2.0), control −1.1 (2.0); abstract reports between-group p<0.05, extracted table p≈0.09 for 3-group test (verify); BHB +1.0–1.2 mM | **Flux** (ratio) |
| Kumar 2025 [17] | Subcutaneous adipose | 10-day inpatient fast; human explants | 7 fasted; 4 explant donors | Lysosomal/MiT-TFE transcripts; explant lipolysis | MITF/TFEC lysosomal programme modulated; lysosomal inhibitors ↓ lipolysis under nutrient restriction ex vivo (no magnitudes) | mRNA / ex vivo |
| Yang 2016 [18] | Muscle | Long-term self-imposed CR (3–15 y) vs controls | CR society members vs sedentary & athletes | LC3, Beclin-1, HSP70, Grp78 | Higher in CR (cross-sectional); cortisol 15.6±4.6 vs 12.3±3.9 ng/dL | Static, observational |
| Das 2023 (CALERIE) [19] | Muscle | ~12 % CR, 2 y RCT | 90 | RNA-seq | Proteostasis, FOXO3, mitochondrial-biogenesis, inflammation genes changed | mRNA |
| **Liver, brain, heart** | — | — | — | — | **No human in-vivo data located.** (A planned 23-h fat/PBMC flux time-course, NCT04842864, was withdrawn with 0 enrolled; a Charité periodic-fasting kinetics study, NCT04739852, has no posted results.) | — |

Searches did not locate a human autophagy-fasting study by "Bareja 2024" (the task's tentative citation); not included.

**Evidence grade for "fasting increases autophagy in humans": C.** Why: two small static-marker muscle studies
(one supportive at 72 h, one mixed at 36 h), mRNA studies, and flux studies that are null (protein, CR) or
borderline/post-hoc (iTRE, FMD). Direction plausible, magnitude and time-course unknown.

### 4.2 Animal time courses and why mouse hours ≠ human hours (Q2)

| Quantity | Mouse (~25 g) | Human (~70 kg) | Source |
|---|---|---|---|
| Mass-specific metabolic rate | ≈7.3 × human | 1 | Kleiber scaling M^0.75 [24]: (70/0.025)^0.25 = 7.27 |
| Weight loss during fast | ~20 % in 48 h | <2 % over 4 d (as reported) | Pietrocola 2017 [5] |
| Liver autophagosomes (GFP-LC3) | Peak at 24 h; "returned to almost the basal level" during next 24 h | Not measurable | Mizushima 2004 [21] |
| Skeletal muscle | Fast-twitch EDL: many dots at 24 h, sustained/slightly ↓ at 48 h; slow soleus: only at 48 h | 72 h: LC3B-II +30 % (static) [1] | [21], [1] |
| Heart | Progressive ↑ through 48 h | — | [21] |
| Brain | No GFP-LC3 induction at 48 h [21]; but "profound" neuronal autophagosome ↑ at 24–48 h food restriction with a different method [22] | — | [21,22] |
| Leukocytes | All subsets ↑ LC3B puncta at 48 h | Only neutrophils, up to 4 d | [5] |
| Feeding rhythm | Nocturnal; ~2/3 of food at night; an "overnight" (daytime) fast is an active-phase fast | Diurnal | Jensen 2013 [23] |

Principled scaling options:
1. **Metabolic-time scaling** (t_human ≈ t_mouse × 7.3): mouse 24 h liver peak ≈ ~7 d human. Upper bound —
   energy reserves do not scale identically (glycogen, fat fraction), so this overstates.
2. **State-equivalence scaling (adopted)**: compare *physiological states* — liver-glycogen depletion, insulin
   nadir, endogenous ketone level, fraction of energy reserve used — not clock hours. The ASI therefore takes
   `liverGlycogenFrac` and endogenous `bhbMmol` as inputs (§4.5).
3. **Empirical human anchors**: muscle static markers clearly changed at 72 h [1], mixed at 36 h [2,3];
   leukocyte flux changes at ~4 d [5]; borderline PBMC flux change at 6 d FMD [16].

Conclusion used for parameters: half-maximal fasting drive h50 = **48 h** (range **24–96 h**), grade D
(PROPOSED). Popular "peaks at 24 h" claims transplant the mouse-liver clock to humans (§8).

### 4.3 Mechanism M1 — Amino acids (leucine) → mTORC1 suppression of autophagy initiation

Mechanism: amino acids (dominantly leucine; also glutamine, tyrosine, phenylalanine in liver [39]) activate
mTORC1, which phosphorylates ULK1 Ser757 and blocks autophagy initiation; TFEB is held cytosolic. In perfused rat
liver, amino acids alone controlled macroautophagic proteolysis over its full range [39]. In human muscle, EAA +
carbohydrate after resistance exercise lowered LC3B-II [32]; 48 g whey raised S6K1/4EBP1 phosphorylation in parallel
with plasma EAA (+130 % at 120 min, +80 % at 180 min), whereas MPS returned to baseline after ~90–120 min
("muscle full") [36]. In PBMCs, 35 g protein modestly raised mTORC1 but **not** flux at 1 h [12].

Equation (PROPOSED; D for autophagy, B for the mTORC1 direction):
```
dL      = max(0, leucineProxy - 1)                   // fold above post-absorptive plasma leucine
S_aa    = dL^nL / (dL^nL + EC50_L^nL)
```
Fallback when the bus has no leucine signal (UNVERIFIED shapes; dossier 03 owns the real curve):
```
leu_g   = protein_g * leuFrac                         // leuFrac 0.08-0.11 (whey ~0.11), dossier 03
dL(t)   = sum_meals 1.5 * leu_g^2/(leu_g^2 + 2.0^2) * k(t - t_meal; tp)
k(t;tp) = (t/tp)^2 * exp(2*(1 - t/tp)) for t>0       // peak 1 at t = tp
tp      = 1.0 h (whey/liquid) … 1.5 h (mixed meal)    // ~10 % of peak by 3.3*tp
```
| Symbol | Value | Range (for Monte-Carlo) | Unit | Source / rationale |
|---|---|---|---|---|
| EC50_L | 0.5 | 0.25–1.0 | fold above baseline | PROPOSED; half-effect at +50 % leucine (post-meal peaks +100–150 % [36]) |
| nL | 1.5 | 1–2 | – | PROPOSED |
| w_aa (weight in S) | 0.6 | 0.3–0.8 | – | PROPOSED; muscle data [32] support, PBMC flux null [12] |
| Duration of mTORC1 elevation | ~3 h after whey; longer for mixed meals | 2–5 h | h | [36]; mixed-meal duration UNVERIFIED |

Moderators: none applied. Age "anabolic resistance" belongs to MPS (dossier 03), not to autophagy suppression.
**Evidence grade: C** (human muscle static data + mechanistic; PBMC flux contradicts an acute effect).

### 4.4 Mechanism M2 — Insulin → Akt → mTORC1/ULK1 and FoxO3 (postprandial suppression)

Mechanism: insulin activates Akt, which (a) activates mTORC1 (ULK1 Ser757 phosphorylation) and (b) excludes
FoxO3 from the nucleus (FoxO3 drives LC3/Bnip3 transcription and muscle autophagy [50]). Human muscle:
insulin clamp 4 h after exercise cut LC3-II/LC3-I ~80 % with ↑ ULK1 Ser757 [26]; insulin lowered LC3B-II in both
fed and 72 h-fasted states [1]. Muscle proteolysis (all pathways) is maximally suppressed (~50 %) by modest insulin:
raising insulin 5→30 mU/L halved leg protein breakdown with no further effect at 72 or 167 mU/L [37];
~15 µU/mL lowered it 47 % in young men but only 12 % in older men [38].

Equation (PROPOSED FIT to [37,38]; applied to autophagy signalling by analogy — grade C):
```
dI     = max(0, insulin_uU - insulinFastingBasal_uU)   // from insulinProxy (dossier 04)
S_ins  = dI^nI / (dI^nI + EC50_I^nI)
S      = 1 - (1 - w_aa*S_aa) * (1 - w_ins*S_ins)       // combined nutrient suppression, max 0.94
```
Data points used: ΔI ≈ +10 µU/mL → 47 % LPB suppression ≈ 94 % of the ~50 % maximum [38]; ΔI ≈ +25 → maximal [37].
| Symbol | Value | Range | Unit | Source |
|---|---|---|---|---|
| EC50_I | 5 | 3–15 | µU/mL above fasting basal | PROPOSED FIT [37,38] |
| nI | 1.5 | 1–2 | – | PROPOSED |
| w_ins | 0.8 | 0.6–0.9 | – | Insulin → LC3-II/I −80 % in human muscle [26] |
| insulinFastingBasal | person-specific (dossier 04) | – | µU/mL | e.g., 5.5±2.2 µU/mL at baseline in normal-weight adults, falling to 1.3±0.9 after 72 h fasting [82] |

Fallback insulin kernel if dossier 04 is absent (UNVERIFIED placeholder): ΔI(t) = Σ min(60, 0.5·carb_g + 0.2·protein_g) ·
k(t − t_meal; tp = 0.75 h). Time dynamics: suppression on within ~1 h, off as insulin returns to basal (≈2.5–4 h
after mixed meals; dossier 04). Moderator: age right-shifts insulin's anti-proteolytic effect [38] — **not applied**
to ASI (would raise older adults' fed-state ASI; interpretation unclear) — see §10.
**Evidence grade: C** (B for muscle proteolysis; C for extrapolation to autophagy; null in PBMC [12]).

### 4.5 Mechanism M3 — Fasting depth: insulin nadir, liver-glycogen depletion/glucagon, ketones

Mechanism: as the post-absorptive period lengthens, insulin falls below the overnight value (5.5→1.3 µU/mL at
72 h [82]), liver glycogen is depleted (gluconeogenesis supplies 64 % of glucose output in the first 22 h, 82 % in
the next 14 h, 96 % after [44]), glucagon/GH/cortisol rise, IGF-1 falls (§4.12), ketones rise (dossier 05), and in
muscle mTOR phosphorylation falls 40–50 % by 72 h with ULK1 Ser757 dephosphorylation [1]. Glucagon and cAMP
stimulate macroautophagy in hepatocytes (but have opposite effects in myocytes) [39].

**Ketone caveat (important).** β-hydroxybutyrate is a *marker* of fasting depth, not a proven human autophagy
driver. In human muscle, a ketone-ester drink during post-exercise recovery **increased** mTORC1 signalling (S6K1,
4E-BP1 phosphorylation) [42]; BHB infusion lowered leucine oxidation 30 % and raised muscle protein synthesis
~10 % [41]. BHB is an HDAC inhibitor inducing FOXO3A in mice [43] (D). Hence only **endogenous** BHB enters
the ASI (exogenous ketones/ketone esters/MCT-derived excess must be excluded), and with a small weight.

Equations (PROPOSED; grade D for weights; the inputs themselves are graded in 04/05):
```
F_clock = hFast^nh / (hFast^nh + h50^nh)
F_glyc  = clamp01(1 - liverGlycogenFrac / G_ref12)      // 0 while liver glycogen ≥ its 12-h post-absorptive value
F_ket   = bhbEndo^2 / (bhbEndo^2 + K_bhb^2)
F       = w_c*F_clock + w_g*F_glyc + w_k*F_ket          // fasting-depth drive, 0..1
```
`G_ref12` = the liver-glycogen fraction dossier 04 predicts 12 h after the last meal on the person's habitual
mixed diet (computed once at init; placeholder 0.5 if unavailable — UNVERIFIED).

| Symbol | Value | Range | Unit | Rationale / source |
|---|---|---|---|---|
| h50 | **48** | 24–96 (log-uniform) | h | Human anchors: 36 h modest [2,3], 72 h clear (static) [1], 4 d leukocytes [5]; mouse 24 h peak × state scaling (§4.2). PROPOSED, D |
| nh | 2 | 1.5–3 | – | Smooth sigmoid; no data. D |
| w_c / w_g / w_k | 0.6 / 0.2 / 0.2 | each ±50 %, renormalised | – | Clock is the only proxy with human anchors; glycogen/ketone terms let the index respond to diet composition and fasted exercise. D |
| K_bhb | 1.5 | 1.0–2.5 | mmol/L | Half weight at 1.5 mM (reached ~day 2 of water fast, dossier 05/20). D |
| Optional F_ins | clamp01((I_basal − I)/I_basal) | – | – | Use if dossier 04 models sub-basal insulin; then re-normalise weights. D |

Time dynamics: onset after the post-absorptive transition; no hysteresis in `hFast` (it resets on a meaningful
meal) but F_glyc and F_ket carry memory (a refed person with still-low liver glycogen/elevated ketones has a
higher ASI between meals — emergent, plausible, unproven). Saturation: F → ~0.95 after 5–7 d. Whether autophagy
*declines* after multi-day fasting (mouse liver returns toward basal by 48 h [21]; human whole-body proteolysis
falls as ketosis progresses — 3-methylhistidine rose to day 5 then fell [93]) is unknown; the model plateaus.
**Evidence grade: C** for direction (human muscle 72 h), **D** for shape and weights.

### 4.6 Mechanism M4 — AMPK: exercise and glycogen, not fasting (human muscle)

Mechanism: AMPK senses AMP/ADP and glycogen; phosphorylates ULK1 Ser555/Ser317 (pro-autophagy) and inhibits
mTORC1 via TSC2/Raptor. Human data:
- Intensity threshold: α2-AMPK **3–4-fold** immediately after 60 min at ~75 % VO2max; **no activation** after
  90 min at ~50 %; fully reversed **3 h** post-exercise [33].
- Glycogen: at rest, glycogen-depleted muscle (≈160 vs 900 mmol/kg dw) had α1 +60 % and α2 +45 % AMPK activity,
  and higher α2 during exercise [34].
- Fasting: 48 h fast **reduced** AMPK activity in lean men (unchanged in obese) [4]; AMPK
  Thr172 phosphorylation was lower in trained than untrained men during a 36 h fast [2]. → Fasting is **not** an
  AMPK activator in human muscle.
- ULK1 Ser555 phosphorylation after 1 h at 50 % VO2max correlated with AMPK Thr172 and inversely with LC3B
  lipidation [3]; but Fritzen found LC3-II/I decrease did not correlate with AMPK trimer activation and AICAR did not
  change LC3-II/I in mouse muscle [26] — AMPK's causal role in human muscle autophagy is unsettled.

AMPK index (companion output; PROPOSED FIT to [33,34,4]):
```
ampkIdx = 100 * clamp01( a0 * (1 + g_gly * dGly) * (1 - f_fast * F_clock)
                        + a_ex * sum_bouts fI_ampk(bout) * pulse(t; bout, tauA) )
fI_ampk = clamp( (I_frac - 0.55) / (0.75 - 0.55), 0, 1.3 )        // I_frac = fraction of VO2max
pulse   = ramp 0→1 over first 10 min of bout, hold to bout end, then exp(-(t - t_end)/tauA)
dGly    = clamp01( (G_norm - G_musc) / (G_norm - 150) )           // mmol/kg dw; G_norm = person's normal fed value (dossier 04)
```
| Symbol | Value | Range | Unit | Source |
|---|---|---|---|---|
| a0 | 0.20 | – | – | Normalisation: rest = 20 |
| a_ex | 0.50 | 0.4–0.6 | – | 75 % VO2max → 0.70 = 3.5× rest [33] |
| threshold / full-effect intensity | 0.55 / 0.75 | 0.45–0.60 / 0.70–0.80 | fraction VO2max | [33] (none at 50 %, 3–4× at 75 %) |
| tauA | 1.0 | 0.5–1.5 | h | "Totally reversed 3 h after exercise" [33] |
| g_gly | 0.5 | 0.3–0.7 | – | +45–60 % at rest when depleted [34] |
| f_fast | 0.2 | 0–0.4 | – | AMPK ↓ with 48 h fast in lean [4] |
Resistance exercise: treat each RT session as fI_ampk = 0.6 × min(1, sets/15) (UNVERIFIED; dossier 09/10).
**Evidence grade: B** (exercise intensity dependence, multiple human biopsy studies), C (glycogen, fasting).

### 4.7 Mechanism M5 — Sirtuins / NAD+

Human data are indirect: eTRF raised whole-blood SIRT1 mRNA 10±3 % [6]; 6 mo 25 % CR raised muscle SIRT1 and
PPARGC1A mRNA and mtDNA +35±5 % (CREX +21 %) without change in citrate synthase/COX activity [48]; endurance
training raised muscle NAMPT protein +127 % in 3 weeks (athletes ~2× sedentary) [45]. NAD+ precursors: nicotinamide
riboside 1 g/d for 21 d raised the muscle NAD+ metabolome without changing mitochondrial bioenergetics [46];
6 wk NR raised blood NAD+ in middle-aged/older adults [47]. No human study links any of these to autophagy flux.
**Not modelled as a separate state** — the ASI already responds to the upstream drivers (fasting, exercise).
**Evidence grade: D** for any sirtuin→autophagy mapping in humans.

### 4.8 Mechanism M6 — Exercise-induced autophagy in human skeletal muscle (Q4)

**Table 4.8a — Human exercise studies**
| Study | Exercise | Population | Timing | Result |
|---|---|---|---|---|
| Schwalm 2015 [25] | 2 h cycling, low vs high intensity, fed and fasted | Well-trained (C 8, LI 8, HI 7) | End, +1 h | LC3b-II and LC3b-II/I ↓ after LI and HI in both fed and fasted; p62 ↓ only 1 h after HI (= ↑ flux); LC3b, p62, GabarapL1, CTSL mRNA ↑ after HI only; AMPK Thr172/ACC Ser79 ↑ after HI. "Intensity more than diet." |
| Møller 2015 [3] | 1 h cycling at 50 % VO2max, during 36 h fast vs glucose infusion | Healthy | Post | ULK1 Ser555 ↑, LC3B lipidation ↓; Ser757 unchanged; **independent of nutritional state** |
| Fritzen 2016 [26] | One-legged exercise; 3 wk one-leg training; insulin clamp 4 h post | Healthy men | Post, +4 h | LC3-II ↓ ~50 %, LC3-II/I ↓ ~60 % (local contraction effect); insulin further ↓ LC3-II/I ~80 %; training ↑ LC3-I (capacity) |
| Brandt 2018 [27] | 60 min at 157±20 W ± 30 s sprints/10 min; 8 wk training | 12 moderately trained men, 25 y | 0, +2 h | AMPK Thr172, ULK Ser317 ↑ immediately; at +2 h LC3-I, LC3-II, BNIP3 ↑, p62 unchanged; training ↑ LC3-I, BNIP3, Parkin, OXPHOS-I |
| Jamart 2012 [28] | 24 h treadmill ultra-endurance (149.8±16.3 km) | 11 experienced men | Post | **LC3b-II +554±256 %**, ATG12–ATG5 +36±17 %, AMPK phos +247±170 %, Akt −74 %, mTOR Ser2448 −32±14 %, MuRF1 +55 % |
| Specht 2026 [29] | 60 min at 2nd ventilatory threshold | 7 endurance-trained, 5 untrained men | +3 h | Untrained: p62 FC 0.50 (PBMC) / 0.57 (muscle); LC3-II FC 1.74 (PBMC) / 1.69 (muscle). **Trained: no change** |
| Fry 2013 [30] | Acute resistance exercise | 16 young (27 y), 16 old (70 y) | +3, 6, 24 h | LC3B-II/I ↓ in both; MPB unchanged at 24 h; no age effect |
| Hentilä 2018 [31] | Acute RE; 21 wk RT | 12 young untrained, 8 older, 15 trained | up to 48 h; 21 wk | LC3-II ↑ **at 48 h** and after training in untrained young, not in older men; UPR ↑ at 48 h in both ages |
| Glynn 2010 [32] | RE then 20 g EAA + 30/90 g CHO | 13 men | post-nutrient | LC3B-II ↓ after nutrient ingestion |

Interpretation: acute endurance exercise *lowers* muscle LC3-II during/right after exercise (probably increased
lysosomal clearance and/or reduced lipidation) and raises LC3/BNIP3 and lowers p62 over 1–3 h of recovery;
intensity- and duration-dependent; blunted in trained people; unaffected by fasting vs fed. RE data are
inconsistent in direction (↓ at 3–24 h [30]; ↑ at 48 h in untrained young [31]). Mouse: exercise-induced
autophagy in muscle/heart required for exercise's glucose benefits (BCL2 AAA mice) [35] (D).

Exercise pulse (PROPOSED; used by `asi` and `asiMuscle`):
```
A_bout (endurance) = fI * fD * mT
    fI = clamp01( (I_frac - 0.40) / (0.80 - 0.40) )    // 50 % VO2max → 0.25; 65 % → 0.63; ≥80 % → 1
    fD = min(1.5, sqrt(duration_min / 60))              // 30 min → 0.71; 60 → 1; 120 → 1.41; ≥135 → 1.5
    mT = 1.0 untrained | 0.75 recreational | 0.5 endurance-trained
A_bout (resistance) = 0.5 * min(1, totalSets / 15) * (1.0 untrained | 0.7 trained)
xEx(t) = sum_bouts A_bout * ( ramp 0→1 during bout; exp(-(t - t_end)/tauEx) after )
asi contribution      = A_ex    * min(1.5, xEx)
asiMuscle contribution= A_ex_m  * min(1.5, xEx)
```
| Symbol | Value | Range | Unit | Source / rationale |
|---|---|---|---|---|
| A_ex (headline) | 15 | 5–25 | index points | PBMC LC3-II ×1.74 in untrained [29] ≈ larger than any fasting effect seen in PBMCs; kept moderate. D |
| A_ex_m (muscle) | 25 | 10–40 | index points | [25,27,28,29]. C/D |
| tauEx | 3 | 2–6 | h | AMPK reversed by 3 h [33]; LC3/p62 changes at 1–3 h [25,27,29] |
| intensity floor / full | 0.40 / 0.80 | ±0.1 | fraction VO2max | Some signal at 50 % [3]; strongest at high intensity [25,33] |
| Fed/fasted synergy | none (×1.0) | 1.0–1.2 | – | No potentiation by fasting [3,25] |
Delayed RE tail (LC3-II ↑ at 48 h in untrained young [31]) — **off by default** because [30] shows the opposite
direction at 24 h. **Evidence grade: C** (B that high-intensity/long exercise changes muscle autophagy markers).

### 4.9 Mechanism M7 — Chronic energy restriction and protein restriction (autophagy side)

- CR 6 mo (continuous, 70 % of needs): no PBMC flux change vs control [13].
- CR 2 y (~12 %): muscle transcriptome shifts in proteostasis/FOXO3/mitochondrial pathways [19]; long-term
  self-imposed CR (3–15 y): higher muscle LC3 and Beclin-1 (cross-sectional) [18].
- Protein restriction 10 % vs 20 % of energy for 4 weeks in energy balance: **no change** in PBMC flux [14].
- Methionine restriction: no human autophagy data (§4.16).

Chronic term (PROPOSED; small by design):
```
d(cDef)/dt = (clamp01(1 - intake_kcal/maintenance_kcal) - cDef) / tauCR     // evaluated daily; fast day = 1
asi_CR     = A_CR * clamp01(cDef / 0.25)
```
| Symbol | Value | Range | Unit | Source |
|---|---|---|---|---|
| A_CR | 3 | 0–8 | index points | Null CR flux [13] vs positive muscle data [18,19]; kept small so a CR-only arm stays within ~4 points of control (V9). D |
| tauCR | 7 | 3–14 | d | PROPOSED |
| Protein-restriction term | **0** | 0 | – | Null RCT [14] (B for the null) |
**Evidence grade: C/D.**

### 4.10 PROPOSED Autophagy Signal Index (ASI) — full specification

**What it is.** A relative, dimensionless 0–100 index of *autophagy-favouring conditions* integrated hourly.
It is **not** a measurement or prediction of autophagic flux in any tissue. **Overall grade: C/D.**

**Step 1 — Fasting clock.** `hFast += dt` each hour; `hFast := 0` at the start of any intake event with
**protein ≥ 10 g OR digestible (net) carbohydrate ≥ 15 g** (PROPOSED threshold, D; chosen so black coffee, tea,
electrolytes, a splash of milk, and pure-fat additions do not reset it, but a real meal or ~2 eggs do).
Sub-threshold intakes still create small S via the kernels. Pure fat does not reset (fat raises neither insulin
nor leucine meaningfully; FMDs that are low-protein/low-sugar/higher-fat produce fasting-like BHB and glucose
changes [16]); its energy still counts in `cDef` and in dossier 05's ketone model.

**Step 2 — Suppression** `S` (§4.3–4.4). **Step 3 — Fasting depth** `F` (§4.5).

**Step 4 — Combine.**
```
ASI_core  = 100 * (1 - S) * ( B0 + (1 - B0) * F )
asi       = clamp( ASI_core + A_ex   * min(1.5, xEx) + asi_CR , 0, 100 )
asiMuscle = clamp( ASI_core + A_ex_m * min(1.5, xEx) + asi_CR , 0, 100 )
```
`B0` is **calibrated, not chosen**: after wiring to dossiers 04/05, run the *reference scenario* (7 d of 3 mixed meals
at maintenance, protein 1.2 g/kg, last meal 19:00, then water-only fast 7 d) and set `B0 = (0.25 − F12)/(1 − F12)`,
where F12 = F at hFast = 12 h, so that **ASI = 25 at 12 h post-absorptive by definition** (every human study's
baseline). With the clock-only fallback (w_c = 1): B0 = 0.203.

**Step 5 — Check anchors** (reference scenario; must match within ±5 points after calibration; else adjust h50
within 36–60 h):

| Hours since last meal | 0–1 | 4 | 12 | 16 | 18 | 24 | 36 | 48 | 72 | 96 | 120 | 168 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ASI (central)** | 2–5 | 15–18 | **25** (def.) | 28 | 30 | 36 | 49 | 60 | 75 | 84 | 89 | 94 |
| P10–P90 band (h50 24–96 log-uniform, nh 1.5–3; 20k draws) | – | – | 25 | 26–33 | 26–37 | 28–49 | 34–69 | 41–81 | 56–92 | 67–96 | 76–98 | 86–99 |

Qualitative labels for UI (map from the central value): 0–15 "fed — suppressed"; 15–30 "post-absorptive
(baseline)"; 30–50 "extended/short fast"; 50–75 "prolonged fast"; 75–100 "multi-day fast".

**Illustrative daily patterns** (clock-only fallback, placeholder insulin/leucine kernels, 120 g protein /
220 g carbohydrate per day, steady state day 4; *to be regenerated once 03/04 are wired*):

| Pattern | Daily mean ASI | Daily peak | Hours ≥ 30 |
|---|---|---|---|
| 4 meals 08:00–19:00 | 13 | 26 | 0 |
| 3 meals 08/13/19 (12 h window) | 15 | 26 | 0 |
| 16:8 (12/16/20) | 16 | 28 | 0 |
| Early TRE 08:00/13:30 (6 h) | 18 | 30 | 0.5 |
| 18:6 (13/19) | 18 | 30 | 0 |
| 20:4 (16/19:30) | 19 | 32 | 2.5 |
| One meal/day (18:00) | 24 | 36 | 6 |
| Skip a whole day (36 h fast): the fasting calendar day | 30 | 41 (50 just before next breakfast) | 11 |
| Water-only fast, hours ~53–77 after last meal | 72 | 78 | 24 |
| Hard 60 min bout at ≥80 % VO2max (untrained), added | +15 at bout end, half-life ~2 h | | |
Honest implication for the UI: meal-timing variants move the daily mean by only a few points; the largest
excursions come from multi-day fasting and hard/long exercise — mirroring where human marker changes were seen.

**Uncertainty the engine must carry.** Monte-Carlo (or Latin-hypercube) over: h50 (24–96 h, log-uniform), nh
(1.5–3), EC50_I (3–15), EC50_L (0.25–1.0), w_aa (0.3–0.8), w_ins (0.6–0.9), w_c/w_g/w_k (±50 %), K_bhb (1–2.5),
A_ex (5–25), tauEx (2–6 h), A_CR (0–8). Re-calibrate B0 per draw (keeps 12 h = 25). Plot P10–P90 band.

**Moderators deliberately NOT applied** (and why): *Age* — PBMC basal flux rises with age [11]; older monocytes
respond more to AA starvation [15]; older men lacked RE-induced LC3-II rise [31]; insulin's anti-proteolytic effect
is blunted with age [38] → conflicting directions, no multiplier. *Sex* — females show higher PBMC flux [12,15],
but the index is relative within person → none. *Obesity* — blunted fasting fall in insulin [4] enters automatically
via `insulinProxy`. *Training status* — applied only to exercise pulses [2,29].

**Mandatory UI uncertainty statement** (display whenever ASI is charted or selected as a goal):
> "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is
> a *relative model signal* that shows when the conditions linked to autophagy in animal and a few small human
> studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent
> hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your
> health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein
> timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is:
> the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days."

### 4.11 Companion — muscle mTORC1 activity index

Mechanism: acute protein/leucine (dose-dependent, dossier 03) with insulin permissive; resistance exercise enhances
and prolongs the response (dossier 03/09); prolonged fasting lowers baseline (mTOR Ser2448 −40–50 % at 72 h [1]);
ultra-endurance lowers it (mTOR −32 % [28]); ketone ester post-exercise raises it [42].
```
mBase   = 0.20 * (1 - 0.65 * F_clock)                         // 72 h: 0.2*(1-0.65*0.69) = 0.11 ≈ -45 % [1]
mAcute  = S_aa * (0.77 + 0.23 * S_ins)                        // insulin permissive, small additive
mtorIdx = 100 * clamp01( mBase + (1 - mBase) * mAcute * (1 + kRE * reSens(t)) )
```
| Symbol | Value | Range | Source |
|---|---|---|---|
| 0.65 fasting baseline fall | 0.65 | 0.4–0.8 | −40–50 % at 72 h [1] |
| kRE | 0.3 | 0.1–0.5 | UNVERIFIED; prefer dossier 03's `mpsStimulus` sensitivity term |
| reSens(t) | from dossier 03/09 (decays over 24–48 h) | – | dossier 03 |
Note the MPS "muscle-full" discordance: MPS returns to baseline at ~2 h while S6K1/4EBP1 stay up to ≥3 h [36] —
`mtorIdx` tracks signalling, not MPS. **Recommendation:** implement from dossier 03's signals; display only in
an "advanced signalling" view. **Evidence grade: B** (direction/timing), C (magnitudes).

### 4.12 Companion — IGF-1 relative level (fitted ODE; best-grounded "longevity-axis" output)

Human data points used for the fit:
| Condition | Result | Source |
|---|---|---|
| 24 h fast (n=47) | IGF-1 **unchanged** (GH ~5-fold ↑) | Hollstein 2022 [81] |
| 72 h fast (n=14) | Total IGF-1 334→166 µg/L (**−50 %**); free IGF-1 −70 %; IGFBP-1 ×4.4; insulin 5.5→1.3 µU/mL | Chan 2008 [82] |
| 5 d fast (n=5, normal weight) | Somatomedin-C 1.85→0.67 U/mL (**0.36** of baseline) | Isley 1983 [78] |
| then 5 d normal diet | → 1.26 U/mL (**0.68**) | [78] |
| then 5 d isocaloric, protein 32 % of control | → 0.90 U/mL (**0.49**) | [78] |
| then 5 d protein + energy deficient | → 0.31 U/mL (0.17) | [78] |
| 10 d fast (7 obese men) | 0.83→0.21 U/mL (**0.25**) | Clemmons 1981 [79] |
| Protein 1.67→0.95 g/kg/d, 3 wk (6 CR practitioners) | 194→152 ng/mL (**0.78**) | Fontana 2008 [55] |
| Severe long-term CR (1 and 6 y), adequate protein | **No change** in IGF-1 or IGF-1:IGFBP-3 | [55] |
| CALERIE 2 y (~12 % CR) | **IGF-1 unchanged**; IGFBP-1 +21 %; IGF-1:IGFBP-1 −42 % | Fontana 2016 [56]; also [66] |
| FMD 3 cycles (5 d/month), measured 5–7 d after 3rd cycle | −21.7±46.2 vs +8.7±36.9 ng/mL (≈ **−13 %**) | Wei 2017 [71] |
| FMD 5 d, day 6 | −23 ng/mL (ns vs control −5) | Espinoza 2026 [16] |
| 16:8 TRF 8 wk + RT, isocaloric | IGF-1 decreased (p=0.04; magnitude not extracted) | Moro 2016 [90] |

Model (PROPOSED FIT; grid-fitted to the rows above):
```
s       = 1 / (1 + exp(-(hFast - LAG)/LW))                     // hepatic GH-resistance onset
T_E     = 1 - (1 - A_inf) * s                                  // fasting target
if hFast < 24:                                                 // protein factor only updates while eating
    d(igfProt)/dt = (TP(P7) / TP(P_habitual) - igfProt) / tauP
TP(P)   = clamp(1 - 0.306 * (1.67 - P), 0.5, 1.0)               // P7 = 7-day mean protein g/kg/d on eating days
T       = T_E * igfProt
d(igf1Rel)/dt = (T - igf1Rel) / (T < igf1Rel ? tauDown : tauUp)
```
| Symbol | Value | Range | Unit | Fit / source |
|---|---|---|---|---|
| LAG | 30 | 24–42 | h | 24 h unchanged [81]; fall by 72 h [82] |
| LW | 3 | 2–6 | h | fit |
| A_inf | 0.25 | 0.2–0.3 | – | 10 d fast [79] |
| tauDown | 44 | 30–60 | h | fit to 72 h/5 d [82,78] |
| tauUp | 173 | 120–240 | h | 5 d normal refeed 0.36→0.68 [78] — recovery ~4× slower than decline (hysteresis) |
| slope | 0.306 | 0.2–0.4 | per g/kg/d | 1.67→0.95 g/kg ⇒ 0.78 [55]; predicts a target of 0.60 at 32 % of control protein vs ≈0.62 back-calculated from [78] |
| tauP | 168 | 72–240 | h | compromise between [78] (fast) and FMD data [16,71] (slow) |
Fit quality (reference runs): 24 h 0.98 (obs ~1.0); 72 h 0.52 (0.50); 5 d 0.33 (0.36); 10 d 0.24 (0.25); normal
refeed 0.62 (0.68); protein-deficient refeed 0.58 (0.49); protein 0.95 g/kg ×3 wk 0.79 (0.78); FMD day 5 0.84
(~0.86–0.88). Energy restriction per se (while eating daily with adequate protein): **no term** (CR data [55,56]).
`igf1Abs = igf1Rel × baseline` if the user enters a lab value; otherwise show relative only.
**Evidence grade: B** for fasting and protein responses (several human studies, consistent), C for time-constants.
Health interpretation: **U-shaped** (§4.16) — the index is *informational*, not a "lower is better" goal.

### 4.13 FGF21 — why it is NOT offered as a chartable index

Human FGF21 varies ~250-fold between individuals; a 2-day fast or ketogenic diet did **not** change it; it rose
74 % only after **7 days** of fasting [83]. It rises "dramatically" after 28 d of a low-protein diet [84], acutely
**3.4-fold** 2 h after 75 g fructose (back to baseline by 5 h) [85] and after sucrose [86], and after exercise in
men but not women [87]. It is therefore dominated by fructose/sugar, alcohol and sex effects outside a
fasting-autophagy frame, and a fasting-driven FGF21 curve would mislead. Recommendation: do not chart; mention in the
Evidence library. **Grade C.**

### 4.14 Tissue specificity — is more autophagy always better? (Q5a)

- **Muscle:** basal autophagy is *required* to keep muscle mass (muscle-specific Atg7 deletion → atrophy, abnormal
  mitochondria, weakness; autophagy inhibition worsened muscle loss during fasting/denervation) [49], but excessive
  FoxO3-driven autophagy is a *driver* of atrophy [50]. In humans, a 72 h fast doubled net muscle phenylalanine
  release [1]; a 10 d fast (+ low-intensity activity, 200–250 kcal/d) lost 5.9 kg (7 %), of which lean soft tissue
  3.53 kg (42 % of that = metabolically active tissue), with plasma 3-methylhistidine rising to day 5 then falling
  [93]. → For muscle, "more" is not better beyond basal/exercise-related turnover.
- **Liver:** hepatic autophagy supplies amino acids for gluconeogenesis early in fasting (rat liver; amino acids
  are the primary regulators) [39]; ethanol inhibits rat hepatic autophagic proteolysis [40] (D).
- **Brain:** no human data; mouse results conflict (none at 48 h [21] vs profound neuronal induction [22]).
- **Adipose:** prolonged (10 d) fasting engages a lysosomal lipolysis programme; lysosome inhibition reduced
  lipolysis in human explants under nutrient restriction [17].
- **Blood:** PBMC flux rises with age [11] (a possible *stress response*), questioning "higher = younger".
- **Organism:** Atg5 over-expression extended mouse median lifespan 17.2 % [51]; in 960 genetically diverse mice,
  CR and IF extended lifespan in proportion to restriction, but metabolic improvements did not track lifespan,
  40 % CR cost lean mass/immune repertoire, and IF did not help heavier mice [52]. Health ≠ lifespan ≠ autophagy.
→ The UI must not imply "higher ASI = healthier". It is a *conditions* signal. **Grade D** for any human
dose-response between autophagy and health.

### 4.15 Goal compatibility: autophagy vs muscle gain (Q5b) — for the planner's conflict logic

**Are MPS and autophagy mutually exclusive over 24 h? No — they alternate.** After a protein feeding, muscle
mTORC1 signalling is elevated for ~2–4 h (S6K1/4EBP1 elevated through ≥180 min after 48 g whey; MPS back to
baseline by ~2 h) [36]; insulin suppresses muscle LC3-II within the hours of a clamp [1,26]. A day with 3 protein
feedings therefore has ~6–10 h of "anabolic/suppressed" state and 14–18 h of low-mTOR state. Hypertrophy depends
on accumulated MPS stimulus (training + ≥1.6 g/kg/d protein [61], distribution across feedings [92]) and energy
availability — not on the absence of fasting hours.

Human trials of compressed eating windows **with** resistance training and adequate protein:
- 8 wk, resistance-trained women, ~7.5 h window (12:00–20:00), 1.6 g/kg/d with whey: FFM +2–3 % and hypertrophy
  **equal** to a ~13 h window [89].
- 8 wk, resistance-trained men, 16:8 (13/16/20 h meals), isocaloric (~22 % protein): fat mass ↓, FFM, muscle area and
  strength **maintained**; testosterone and IGF-1 ↓ [90].
- Without RT (TREAT, 12 wk, 12:00–20:00): appendicular lean-mass index −0.16 kg/m² vs control (95 % CI −0.27 to
  −0.05) [91].
- Feeding distribution: over 12 h post-RE, 4×20 g every 3 h gave 31–48 % more MPS than 2×40 g every 6 h or
  8×10 g [92].

**Compatibility matrix (planner input; "cost" = expected penalty to the muscle-gain goal)**
| Lever | Effect on ASI (weekly mean, model) | Muscle-gain compatibility | Grade |
|---|---|---|---|
| 10–12 h eating window, 3–4 feedings | baseline (≈13–15) | Fully compatible | – |
| 8 h window, ≥3 feedings ≥0.3–0.4 g/kg, ≥1.6 g/kg/d, energy ≥ maintenance+surplus, RT | +1 to +3 | **Compatible** [89,90] | B |
| 6 h window (2–3 feedings) | +3 to +5 | Mild conflict (fewer/larger feedings; [92]) | C |
| ≤4 h window / one meal a day | +5 to +10 | **Conflict** (1–2 feedings; hard to reach surplus + distribution) | C |
| 24–36 h fast once a week | +2 to +4 | Moderate conflict (1/7 days without anabolic stimulus; deficit) | C/D |
| 48–72 h+ fasts | large transient (+40–60 during fast) | **Strong conflict** (net muscle protein loss ×2 at 72 h [1]; lean tissue loss [93]) | B |
| Continuous CR 10–25 % | +2 to +4 (cDef term + smaller meals) | **Conflict** with gain (CALERIE FFM −2.2 kg/2 y [66]) | A/B |
| Protein restriction ≤0.8 g/kg | ~0 (no flux effect [14]) | **Strong conflict** [61] | B |
| Hard endurance bouts ≥70 % VO2max | +10–25 transient | Compatible in moderate volume (interference: dossier 10) | B/C |
| Resistance training | small transient | Synergistic (required for gain) | A |
| Training fasted vs fed | no extra ASI [3,25] | Neutral/slightly negative for performance (dossier 10) | B |

**Planner rules (proposed):**
1. If *muscle gain* outranks *autophagy*: enforce protein ≥1.6 g/kg/d in ≥3 feedings spaced ≥3 h (⇒ eating window
   ≥ ~7–8 h), energy ≥ maintenance (+surplus per dossier 11), no fasts > 24 h; optimise ASI only by placing the
   fasting gap (e.g., earlier last meal) and by exercise intensity. Expected ASI gain small; say so.
2. If *autophagy* outranks *muscle gain*: allow 16–20 h daily windows and occasional 24–36 h fasts (within dossier
   17/20 limits), keep protein ≥1.2–1.6 g/kg/d on eating days, keep RT (≥2 sessions/wk) to limit lean loss; warn that
   hypertrophy will be slower or absent, and that the autophagy gain is a low-confidence modelled signal.
3. Never trade a grade A/B outcome (lean mass, bone, safety) for a grade C/D ASI gain unless the user ranked
   autophagy first **and** acknowledged the evidence statement.
4. Use a concave utility for ASI (e.g., U = max(0, 1 − exp(−(asiWeeklyMean − 13)/15))) so the optimiser does not chase
   ever-longer fasts (dossier 18).

### 4.16 Protein / methionine restriction, IGF-1 and longevity vs sarcopenia (Q6)

- **NHANES III (Levine 2014)** [54]: n = 6,381 aged ≥50, 18-y follow-up, **single 24-h recall**. Ages 50–65: high
  protein (≥20 % kcal) vs low (<10 %): all-cause HR **1.74** (1.02–2.97), cancer HR **4.33** (1.96–9.56); attenuated if
  protein plant-derived. Ages >65: high protein all-cause HR **0.72** (0.55–0.94). IGF-1 sub-cohort (n=2,253): cancer
  mortality HR ×1.09 per +10 ng/mL for high vs low protein. Limitations: one dietary recall, observational,
  residual confounding. **Grade C.**
- **Fontana 2008** [55]: CR without protein restriction does not lower IGF-1; protein 1.67→0.95 g/kg lowers it 22 %.
- **IGF-1 and mortality are U-shaped** (meta-analysis, 12 studies, 14,906 people): low IGF-1 HR 1.27 (1.08–1.49),
  high HR 1.18 (1.04–1.34); 10th vs 50th percentile HR 1.56, 90th vs 50th HR 1.29 [57]. **Grade B** (observational).
- **GH-receptor deficiency (Laron, Ecuador)** [58]: one non-lethal cancer and no diabetes vs 17 % cancer and 5 %
  diabetes in relatives; insulin 1.4 vs 4.4 µU/mL. The paper reports disease incidence, not lifespan extension.
- **Methionine restriction:** 16 wk at 2 mg/kg/d in 26 obese adults with metabolic syndrome: fat oxidation +12 %
  (vs −8 %), liver fat ↓, independent of the similar weight loss in both arms [62]; 8 wk MetR in humans did not change
  epigenetic clocks [63]. No human autophagy data. **Grade C.**
- **The other side (older adults):** PROT-AGE recommends ≥1.0–1.2 g/kg/d for >65 y, ≥1.2 if active, 1.2–1.5 with
  illness [59]; in Health ABC (70–79 y, n=2,066), the highest protein quintile lost ~40 % less lean mass over 3 y
  (−0.50 vs −0.88 kg) [60]; RT gains plateau at ~1.62 g/kg/d [61]. Protein restriction produced **no** autophagy
  (flux) benefit in young adults [14].

**How to express the trade-off honestly:** (i) protein restriction is **not** an autophagy lever in this app
(null human flux RCT); (ii) "lower IGF-1" is shown as informational with the U-shape caveat and is *not*
goal-eligible by default; (iii) age-dependent protein floors (§9) override any longevity-motivated restriction;
(iv) where a user insists on lower protein for IGF-1, show the predicted `igf1Rel` change *and* the predicted
lean-mass cost from dossier 03 side by side.

### 4.17 Calorie restriction in humans (CALERIE) and fasting-mimicking diets (Q7)

**CALERIE-2** (n=218 randomised 2:1, 21–50 y, BMI 22–28, 2 y, prescribed 25 % CR):
| Outcome | Result | Source |
|---|---|---|
| Achieved CR | **11.7±0.7 %** (Ravussin) / 11.9 % (2,467→2,170 kcal; Kraus); 19.5 % first 6 mo, 9.1 % next 18 mo | [64,65,56] |
| Weight | −10.4±0.4 % (−7.5 kg; 71 % fat, fat mass −5.3 kg) | [64,65] |
| Lean mass | FFM −2.2±0.2 vs −0.2 kg in controls; minor leg lean loss without strength change | [66,19] |
| Cardiometabolic | LDL-C, TC:HDL, SBP, DBP ↓ (all p≤0.001); CRP ↓ (p=0.012); insulin sensitivity ↑; MetS score ↓; robust to weight-loss adjustment | [65] |
| RMR / EE | RMR residual ↓ at 12 mo (p=.04), not 24 mo; T3 ↓; in the Pennington sub-study (~15 % CR, −8.7 kg) 24-h EE 80–120 kcal/d below prediction; F2-isoprostanes ↓ | [64,67] |
| Inflammation | TNF-α ↓ at 24 mo (p=.02) | [64] |
| IGF-1 | **Unchanged**; IGFBP-1 +21 %; cortisol ↑ at 1 y only | [56] |
| Bone | BMD at 24 mo: spine −0.013 vs +0.007 g/cm²; total hip −0.017 vs +0.001; femoral neck −0.015 vs −0.005 (all p≤0.03) | [66] |
| Pace of ageing | DunedinPACE d = −0.29 (12 mo), −0.25 (24 mo) ≈ **2–3 % slower**; no effect on PhenoAge/GrimAge clocks; post hoc | [68] |
| Thymus / immunity | ~14 % CR: improved thymopoiesis, ↓ PLA2G7 in adipose | [69] |
| Muscle transcriptome | proteostasis, FOXO3, mitochondrial-biogenesis, DNA-repair pathways altered | [19] |
| Safety | 3 withdrawn for safety; higher musculoskeletal/nervous/reproductive AEs in normal-weight vs overweight CR; monitor bone and anaemia | [70] |
Earlier 6-mo CALERIE (phase 1): mtDNA +35 %, SIRT1/PPARGC1A mRNA ↑, DNA damage ↓, 24-h EE −135 kcal/d [48].
**Grades:** cardiometabolic A/B; DunedinPACE B (single RCT, post hoc); IGF-1 null A/B; bone B.

**Fasting-mimicking diet (FMD)**: Wei 2017 [71]: n=100 randomised (48 control, 52 FMD); FMD ≈4,600 kJ day 1 (11 %
protein), ≈3,000 kJ days 2–5 (9 % protein); 3 monthly cycles: weight −2.6±2.5 kg, **absolute lean mass ↓ (p=0.004)**,
IGF-1 −21.7 ng/mL vs +8.7 (≈−13 %), fasting glucose and CRP ns overall (↓ only in at-risk subgroups);
dropouts 25 % vs 10 %.
**Brandhorst 2024 "−2.5 years biological age" [72] — critique:**
1. Secondary/exploratory analysis of the same trial; the biological-age estimate was a within-person pre–post change in
   the FMD arms (n=52; plus an uncontrolled second trial, n=34), not a randomised between-group contrast; the control
   arm contributing to that figure had n=16–19.
2. The composite (Klemera–Doubal type; albumin, alkaline phosphatase, creatinine, CRP, HbA1c, systolic BP, total
   cholesterol) moves mechanically with short-term weight loss, BP and glucose changes; it is not validated as an
   intervention surrogate for mortality.
3. Mean change ~1.5 y; the headline 2.5 y is the **median**; 31 % of FMD participants *increased* biological age.
4. Commercial conflict: FMD supplied by L-Nutra; USC licensed IP with royalty potential; two authors hold equity.
5. The same programme lowered absolute lean mass [71].
→ Treat as hypothesis-generating (**grade C**). Compare CALERIE's randomised DunedinPACE effect of 2–3 % [68].

### 4.18 Compounds and foods claimed to induce autophagy (Q8) — human evidence only

| Agent | Human evidence | Autophagy measured in humans? | Grade |
|---|---|---|---|
| Spermidine | Plasma spermidine rises with fasting/CR in humans; blocking synthesis blunted fasting autophagy in yeast, worms, human cells [73]. SmartAge RCT (n=100, 60–90 y, 0.9 mg/d, 12 mo): no effect on memory (−0.03; 95 % CI −0.11 to 0.05) or biomarkers [74] | No | D (for autophagy) |
| Coffee (caffeinated or decaf) | Mouse: LC3B lipidation ↑ and p62 ↓ 1–4 h after coffee in liver, muscle, heart [75] | No | D |
| Urolithin A | 66 older adults, 1 g/d 4 mo: primary end-points (6MWD, ATP_max) not met; endurance contractions ↑; acylcarnitines, CRP ↓ [76]. Middle-aged, 4 mo: strength ~+12 %, peak-power primary end-point not met; ↑ muscle mitophagy-related proteins [77]. Industry-sponsored | Mitophagy-related proteins only | C |
| NR / NAD+ precursors | Raise NAD+ metabolome; no bioenergetic change in muscle [46,47] | No | C (NAD+), D (autophagy) |
| Resveratrol, EGCG, curcumin, other polyphenols | No human autophagy-flux data located in this review | No | D |
| Exogenous ketones | Ketone ester ↑ muscle mTORC1 signalling post-exercise [42] | Opposite direction | C |
| Rapamycin, metformin, aspirin | Drugs — out of scope for a lifestyle planner; do not model or suggest | – | – |
**Model rule:** no compound raises the ASI. Coffee/tea without milk/sugar do not reset `hFast` (energy < thresholds;
fasting studies allowed them [5]). Full supplement catalogue: dossier 21.

### 4.19 Related, more measurable "housekeeping" outputs (Q9)

| Output | Best human anchor | Where modelled |
|---|---|---|
| IGF-1 (relative) | §4.12 (B) | **This dossier** |
| AMPK (muscle) | §4.6 (B) | **This dossier** |
| mTORC1 (muscle) | §4.11 (B/C) | This dossier / 03 |
| Mitochondrial biogenesis signal | Exercise ↑ PGC-1α transcription 10–40× and mRNA 7–10× peaking within 2 h [88]; CR ↑ mtDNA 35 % [48] | Dossier 10 |
| Inflammation (CRP, TNF-α) | CALERIE CRP ↓, TNF-α ↓ [64,65]; iTRE vs CR (6 mo, weight loss above median): CRP −1.36±0.47 mg/dL and TNF-α ↓ over time, no between-group difference [101] | Dossier 06 |
| Oxidative stress | F2-isoprostanes ↓ with 2 y CR [67] | Dossier 06 (optional) |
| Pace of ageing (DunedinPACE) | −2–3 % with ~12 % CR, 2 y [68] | **Not modelled** (single RCT; no dose model) |
| FGF21 | §4.13 | Not charted |

---

## 5. Interactions with other subsystems

**Needs (reads from the SignalBus):**
| From | Signal | Use here |
|---|---|---|
| 04 carbohydrate/glycogen/insulin | `insulinProxy` (µU/mL or relative), `insulinFastingBasal`, `liverGlycogenFrac`, `G_ref12` (12 h post-absorptive liver-glycogen fraction on habitual diet), muscle glycogen | S_ins (§4.4), F_glyc (§4.5), AMPK glycogen term (§4.6) |
| 03 protein/MPS | `leucineProxy` (fold vs basal) or AA appearance curve; `reSens` (RE-sensitised window) | S_aa (§4.3), mtorIdx (§4.11) |
| 05 ketosis | `bhbMmol` **split into endogenous vs exogenous** | F_ket (§4.5) — endogenous only |
| 07 / 20 fasting | fasting schedule, multi-day fast state, refeeding | hFast; F plateau; safety flags |
| 01 / 02 energy | maintenance kcal, intake kcal | cDef (§4.9) |
| 09 / 10 training | session type, %VO2max (from HR/RPE/pace), duration, RT sets, training status | xEx (§4.8), ampkIdx (§4.6), mtorIdx RT term |
| 14 / 16 profile | age, sex, training history; IGF-1 age/sex reference ranges | protein floors (§9); igf1Abs display |
| 15 / 21 substances | coffee/tea (no reset), ketone esters/salts/MCT (exclude from F_ket), alcohol (energy only) | reset rule, F_ket |

**Gives:**
| To | Signal | Note |
|---|---|---|
| UI / recorder | `asi`, `asiMuscle`, `fastingClockH`, `mtorIdx`, `ampkIdx`, `igf1Rel` (+`igf1Abs`) | hourly for asi/asiMuscle/mtorIdx/ampkIdx/fastingClockH; daily for igf1Rel |
| 10 cardio | `ampkIdx` (optional input to mitochondrial-adaptation signal) | avoid double counting with 10's own exercise-signal |
| 18 planner | `asiWeeklyMean`, `asiDeepHoursWeek`, goal-compatibility matrix (§4.15), concave utility | ASI weighted by evidence grade |
| 17 safety | "autophagy goal pushes fasting beyond limits" warning; protein-floor violations | §9 |
| 19 other outcomes | CR-related bone warning (CALERIE BMD) | §9 |

Execution order within the hourly step: after 04 (insulin, glycogen), 03 (leucine), 05 (BHB), 09/10 (exercise
bookkeeping); before recorder. No feedback from this module into energy balance or body composition (the
lean-mass costs of fasting are produced by dossiers 03/20, not by ASI).

---

## 6. Output metrics for the UI

| Metric id | Name (UI) | Unit | Direction of "good" | Computation | Evidence grade | Goal-eligible? |
|---|---|---|---|---|---|---|
| `fastingClockH` | Time since last meal | h | neutral (informational) | `hFast` | A (it is a clock) | No (use ASI) |
| `asi` | Autophagy signal (relative) | index 0–100 | higher = more autophagy-favouring **conditions** | §4.10 | **C/D** | **Yes**, as `asiWeeklyMean` with concave utility and mandatory statement |
| `asiWeeklyMean` | Weekly average autophagy signal | index | higher | 168-h rolling mean of `asi` | C/D | Yes (planner form) |
| `asiDeepHoursWeek` | Hours per week in "prolonged-fast" zone | h/wk | higher (with safety caps) | hours with `asi` ≥ 50 in trailing 7 d | D | Optional secondary |
| `asiMuscle` | Muscle autophagy signal (advanced) | index 0–100 | neutral/context | §4.10 | C/D | No |
| `mtorIdx` | Muscle growth signalling (mTORC1) | index 0–100 | context-dependent (anabolic) | §4.11 | B/C | No (muscle mass is the goal) |
| `ampkIdx` | Muscle energy-stress signal (AMPK) | index 0–100 | context (exercise marker) | §4.6 | B | No |
| `igf1Rel` | IGF-1 (relative to your usual) | ratio | **not monotonic** — U-shaped risk [57]; informational | §4.12 | B (response) / C (health meaning) | No by default; if user opts in, target band 0.8–1.0 of own baseline, never below age-appropriate protein floors |
| `igf1Abs` | IGF-1 | ng/mL | as above | igf1Rel × user lab baseline | B | No |

Chart styling guidance: draw `asi` with its P10–P90 band and a grade badge "C/D — low confidence"; never on the
same axis/scale as measured-quantity outputs (fat mass, glycogen) without a "modelled index" label.

---

## 7. Validation targets

| # | Study (conditions in) | Measured outcome | Engine must reproduce (tolerance) |
|---|---|---|---|
| V1 | Vendelbo 2014 [1]: 8 lean young men, 72 h water fast vs overnight fast | Muscle mTOR Ser2448 phos −40–50 %; LC3B-II +~30 % | `mtorIdx` baseline at 72 h = 0.50–0.65 × its 12 h value; `asiMuscle` at 72 h ≥ 60 (central 75) |
| V2 | Wojtaszewski 2000 [33]: 60 min at ~75 % VO2max vs 90 min at ~50 % | α2-AMPK 3–4× vs none; reversed by 3 h | `ampkIdx` end-of-bout ≥ 3.0× rest at 75 %; ≤ 1.3× at 50 %; ≤ 1.2× rest at +3 h |
| V3 | Wijngaarden 2013 [4]: 48 h fast, lean | AMPK activity ↓ | `ampkIdx` at 48 h ≤ rest value (no increase) |
| V4 | Hollstein 2022 [81]; Chan 2008 [82]; Isley 1983 [78]; Clemmons 1981 [79]: water fasts 24 h / 72 h / 5 d / 10 d; refeed 5 d | IGF-1 ≈1.0 / 0.50 / 0.36 / 0.25; refeed 0.68 | `igf1Rel` 24 h ≥ 0.93; 72 h 0.50±0.08; 5 d 0.36±0.08; 10 d 0.25±0.06; after 5 d normal refeed 0.68±0.10 |
| V5 | Fontana 2008 [55]; Fontana 2016 (CALERIE) [56]: protein 1.67→0.95 g/kg for 3 wk; 2 y ~12 % CR at unchanged protein % | IGF-1 0.78; CR no change | `igf1Rel` 0.78±0.06 at 3 wk; CALERIE-like run (12 % CR, 3 meals/d, same g/kg protein) `igf1Rel` 1.00±0.05 at 2 y |
| V6 | Wei 2017 [71]: FMD 5 d/month × 3 (≈1,100 then ≈720 kcal/d, 9–11 % protein), sampled 5–7 d after 3rd cycle | IGF-1 ≈ −13 % | `igf1Rel` 0.87±0.08 at that time point |
| V7 | Singh 2026 [14]: 4 wk 10 % vs 20 % protein, energy balance, same meal times | PBMC flux no difference | |Δ`asiWeeklyMean`| ≤ 3 points between arms |
| V8 | Jamshed 2019 [6]: eTRF 08:00–14:00 vs 08:00–20:00, 4 d | Morning LC3A mRNA +22 % (direction) | Pre-breakfast `asi` higher in eTRF (≈30 vs ≈25); daily mean higher (≈18 vs ≈15) |
| V9 | Bensalem 2025 [13]: 6 mo iTRE (3 d/wk 30 % needs 08:00–12:00 then 20 h fast) vs CR (70 % daily) vs standard care | Flux: iTRE > SC (post hoc), CR ≈ SC | Ordering of `asiWeeklyMean`: iTRE > CR ≥ SC; iTRE − SC ≥ 4 points; CR − SC ≤ 5 points (prototype, clock-only: SC 14.9, CR 18.7, iTRE 20.6) |

**Known non-reproducible result (document, do not tune away):** Singh 2025 [12] — 35 g protein did not change PBMC
flux at 1 h, whereas the ASI drops sharply after any protein meal (by design, from muscle data [1,26,32]). The UI
text must admit that the fed-state dip reflects signalling in muscle, not measured flux in blood.

---

## 8. Myths / contested claims (Q10)

| Claim | What the evidence shows | Grade |
|---|---|---|
| "Autophagy starts at 16 hours." | Autophagy is continuous (basal); no human study has identified an onset time. The only data near 16–18 h are mRNA: an ~18 h vs 12 h overnight fast raised blood LC3A mRNA 22 % [6]. No human flux measurement exists between 12 and 72 h in solid tissue. The model's signal rises smoothly (25 at 12 h → ~28 at 16 h). | C |
| "Autophagy peaks at 24 / 48 / 72 hours." | The 24 h peak is **mouse liver** [21]; mice have ~7× higher mass-specific metabolic rate and lose ~20 % body weight in 48 h [5,24]. Human muscle static markers changed at 72 h (+30 % LC3B-II) [1], modestly at 36 h [2]. No human peak has been measured. | C/D |
| "More than X g protein breaks the fast / stops autophagy." | No threshold exists. 35 g whey did not change PBMC flux at 1 h [12]; 4 weeks of halved protein did not raise flux [14]; in muscle, insulin and EAA+carbohydrate lower LC3-II [26,32]. Protein suppresses mTORC1-linked signalling transiently (~2–4 h) [36]. | B/C |
| "Coffee doesn't break a fast / coffee boosts autophagy." | Black coffee has negligible energy and fasting studies allowed it [5]; the autophagy-boost claim is from mice (1–4 h after coffee) [75]. No human autophagy data. | D |
| "Exogenous ketones / MCT give you the benefits of fasting." | Ketone ester **raised** mTORC1 signalling in human muscle [42]; BHB infusion is anti-catabolic [41]. The ASI ignores exogenous BHB. | C |
| "Fasting activates AMPK." | In human muscle a 48 h fast lowered AMPK activity in lean men [4]; AMPK is activated by exercise intensity (3–4× at 75 % VO2max) [33] and glycogen depletion [34]. | B |
| "Fasted training maximises autophagy." | Exercise-induced muscle autophagy markers were not potentiated by fasting [3,25]; intensity matters more. | B/C |
| "Autophagy declines with age in humans, so older people need more fasting." | Basal PBMC flux **increases** with age [11]; older monocytes respond more to AA starvation [15]; older men lacked the RE-induced LC3-II rise [31]. Mixed; and older adults need more protein [59,60]. | C |
| "Intermittent fasting is proven to increase autophagy in humans." | Best trial: iTRE vs standard care P = 0.04 post hoc at 6 mo, no within-group rise; CR null [13]; FMD pilot borderline, industry-funded [16]. | C |
| "Calorie restriction lowers IGF-1 in humans like in rodents." | Not without protein restriction (severe CR 1–6 y; CALERIE 2 y) [55,56]. | A/B |
| "Lower IGF-1 is always better for longevity." | U-shaped mortality [57]; protein-mortality association reverses after 65 [54]; GHRD protects from cancer/diabetes but lifespan extension not shown [58]. | B/C |
| "FMD reverses biological age by 2.5 years." | Median of within-person change in a secondary analysis with a composite of routine labs; mean ~1.5 y; 31 % worsened; industry conflicts; lean mass fell [71,72]. | C |
| "Serum LC3/Beclin levels or ATG gene expression show your autophagy." | Not valid flux measures [20]; LC3 is intracellular; mRNA ≠ activity. | A (methodological consensus) |
| "The longer the fast, the better." | Lean-tissue loss (10 d: −3.5 kg lean soft tissue) [93], net muscle protein loss doubles by 72 h [1], CR costs bone [66]; in mice, health gains and lifespan diverge and 40 % CR cost lean mass/immunity [52]. | B |

---

## 9. Safety bounds relevant to this topic

1. **The autophagy goal never justifies exceeding the fasting limits in dossier 17/20.** The planner must refuse
   regimes whose only rationale is a higher ASI when they breach duration/frequency/population limits; the simulator
   may simulate them with warnings (brief principle 5).
2. **Contraindicated for autophagy-motivated fasting/restriction** (defer the definitive list to dossier 17):
   pregnancy/lactation, type 1 diabetes or insulin/sulfonylurea use, history of eating disorders, BMI < 18.5,
   under-18s, frailty/sarcopenia, active cancer treatment (FMD/fasting during chemotherapy only under oncology
   supervision), significant kidney/liver disease, gout, recent illness.
3. **Protein floors override longevity/autophagy goals:** ≥0.8 g/kg/d (adults < 65, RDA) and ≥1.0–1.2 g/kg/d
   (≥ 65, PROT-AGE [59]; ≥1.2–1.5 with illness). No autophagy benefit of protein restriction is demonstrated [14].
4. **Chronic CR bone and lean-mass warnings:** show predicted BMD/lean-mass cost when sustained deficit ≥ 10 % for
   ≥ 6 months (CALERIE: hip BMD −0.017 g/cm², FFM −2.2 kg at 2 y [66]); anaemia monitoring [70].
5. **Multi-day fasts:** display lean-tissue loss (dossier 20; e.g., [93]) alongside the ASI rise; flag refeeding
   risk after ≥ 5 days (dossier 20).
6. **No drugs or supplements** are suggested to raise autophagy (rapamycin, metformin, spermidine, urolithin A,
   NR etc.); the app may *describe* evidence (§4.18) but not prescribe.
7. **IGF-1:** never optimise toward the lowest value; the planner must not select regimes producing sustained
   `igf1Rel` < 0.6 outside explicit supervised fasting (U-shaped risk [57]).
8. **Messaging:** never state or imply that the ASI treats, prevents or detects disease (cancer, dementia).

---

## 10. Open questions / weakest assumptions

1. **The whole ASI is a construct.** No human dataset links any dietary schedule to autophagic flux in a solid organ.
   The weights (w_c/w_g/w_k, A_ex, A_CR) are expert-set (grade D). The planner must treat ASI gains as low-confidence.
2. **h50 (48 h; 24–96 h)** is the single most influential parameter; it is bracketed by human muscle static markers
   (36 h mixed, 72 h clear) and state-scaled mouse data. A human flux time course (e.g., PBMC flux every 12 h over a
   5-day fast) would replace it — none published (NCT04842864 withdrawn; NCT04739852 no results).
3. **Fed-state suppression** is taken from muscle (insulin/AA lower LC3-II) but contradicted in PBMCs at 1 h [12].
   Tissue-specific S weights may be warranted.
4. **Static markers are ambiguous** (LC3-II ↑ could be blocked degradation) [1,20]; the 72 h anchor could be wrong in
   direction for flux.
5. **Exercise weight** (A_ex): PBMC and muscle LC3-II rose ~1.7× in *untrained* men after one vigorous bout [29] —
   a larger acute change than any fasting study in blood — but n = 12 and static markers. Resistance-exercise
   direction is inconsistent [30,31].
6. **Plateau vs decline in prolonged fasting:** mouse liver autophagy returns toward basal by 48 h [21]; human
   proteolysis declines after ~5 d [93]. The model plateaus; a decline term may be needed.
7. **Ketones:** treated as a fasting-depth marker; human data show ketones can *raise* muscle mTORC1 [42]. If dossier 05
   cannot separate endogenous from exogenous BHB, set w_k = 0.
8. **Age**: insulin's anti-proteolytic effect is blunted in older adults [38] and basal PBMC flux rises with age [11];
   whether either should shift the index is unresolved.
9. **IGF-1 model** mixes normal-weight (5 d) and obese (10 d) fasting data and small n (5–14 per study); protein time
   constant is a compromise between post-fast refeeding and FMD data (errors up to ±0.09).
10. **Health meaning**: whether higher autophagy (in any tissue) improves human health outcomes is unknown; DunedinPACE
    improvement with CR [68] is not attributable to autophagy.

---

## 11. References

1. Vendelbo MH, Møller AB, Christensen B, et al. Fasting increases human skeletal muscle net phenylalanine release and this is associated with decreased mTOR signaling. *PLoS One* 2014;9:e102031. PMID 25020061. DOI 10.1371/journal.pone.0102031. https://pmc.ncbi.nlm.nih.gov/articles/PMC4096723/
2. Dethlefsen MM, Bertholdt L, Gudiksen A, et al. Training state and skeletal muscle autophagy in response to 36 h of fasting. *J Appl Physiol* 2018. PMID 30161009. DOI 10.1152/japplphysiol.01146.2017. https://pubmed.ncbi.nlm.nih.gov/30161009/
3. Møller AB, Vendelbo MH, Christensen B, et al. Physical exercise increases autophagic signaling through ULK1 in human skeletal muscle. *J Appl Physiol* 2015. PMID 25678702. DOI 10.1152/japplphysiol.01116.2014. https://pubmed.ncbi.nlm.nih.gov/25678702/
4. Wijngaarden MA, van der Zon GC, van Dijk KW, Pijl H, Guigas B. Effects of prolonged fasting on AMPK signaling, gene expression, and mitochondrial respiratory chain content in skeletal muscle from lean and obese individuals. *Am J Physiol Endocrinol Metab* 2013. PMID 23512807. DOI 10.1152/ajpendo.00008.2013. https://pubmed.ncbi.nlm.nih.gov/23512807/
5. Pietrocola F, Demont Y, Castoldi F, et al. Metabolic effects of fasting on human and mouse blood in vivo. *Autophagy* 2017;13:567–578. PMID 28059587. DOI 10.1080/15548627.2016.1271513. https://pmc.ncbi.nlm.nih.gov/articles/PMC5361613/
6. Jamshed H, Beyl RA, Della Manna DL, Yang ES, Ravussin E, Peterson CM. Early time-restricted feeding improves 24-hour glucose levels and affects markers of the circadian clock, aging, and autophagy in humans. *Nutrients* 2019;11:1234. PMID 31151228. DOI 10.3390/nu11061234. https://pmc.ncbi.nlm.nih.gov/articles/PMC6627766/
7. Erlangga Z, et al. The effect of prolonged intermittent fasting on autophagy, inflammasome and senescence genes expressions: an exploratory study in healthy young males. *Hum Nutr Metab* 2023;32:200189. DOI UNVERIFIED (likely 10.1016/j.hnm.2023.200189). Summary: https://lifespan.io/news/intermittent-fasting-induces-changes-in-multiple-biomarkers/
8. Erlangga Z, Souita S, Hamdan I, et al. Baseline-dependent immunometabolic responses during prolonged intermittent fasting: a secondary integrative analysis. *Nutrients* 2026. PMID 42356340. DOI 10.3390/nu18121954.
9. Dastghaib S, Siri M, Rahmani-Kukia N, et al. Effect of 30-day Ramadan fasting on autophagy pathway and metabolic health outcome in healthy individuals. *Mol Biol Res Commun* 2025. PMID 40028479. DOI 10.22099/mbrc.2024.50105.1978. https://pmc.ncbi.nlm.nih.gov/articles/PMC11865935/
10. Bensalem J, Hattersley KJ, Hein LK, et al. Measurement of autophagic flux in humans: an optimized method for blood samples. *Autophagy* 2021. PMID 33164641. DOI 10.1080/15548627.2020.1846302. https://pmc.ncbi.nlm.nih.gov/articles/PMC8525931/
11. Bensalem J, Teong XT, Hattersley KJ, et al. Basal autophagic flux measured in blood correlates positively with age in adults at increased risk of type 2 diabetes. *GeroScience* 2023. PMID 37498479. DOI 10.1007/s11357-023-00884-5. https://pmc.ncbi.nlm.nih.gov/articles/PMC10643809/
12. Singh S, Fourrier C, Hattersley KJ, et al. High protein does not change autophagy in human PBMCs after 1 hour. *JCI Insight* 2025. PMID 40663500. DOI 10.1172/jci.insight.188845. https://pmc.ncbi.nlm.nih.gov/articles/PMC12406713/
13. Bensalem J, Teong XT, Hattersley KJ, et al. Intermittent time-restricted eating may increase autophagic flux in humans: an exploratory analysis. *J Physiol* 2025;603(10):3019–3032. PMID 40345145. DOI 10.1113/JP287938. https://pubmed.ncbi.nlm.nih.gov/40345145/
14. Singh S, Fourrier C, Hein LK, et al. Reduced dietary protein intake does not alter autophagy in human blood: a randomized crossover study in healthy adults. *Clin Nutr* 2026. PMID 42721581. DOI 10.1016/j.clnu.2026.106778. (Protocol: Fourrier C et al., medRxiv 2024, DOI 10.1101/2024.06.16.24308986.)
15. Dang LVP, Sargeant TJ. Cell type-specific autophagy in human leukocytes: signatures of aging, sex, and nutrient restriction. *Autophagy Rep* 2025. PMID 40843146. DOI 10.1080/27694127.2025.2543560. https://pmc.ncbi.nlm.nih.gov/articles/PMC12366816/
16. Espinoza SE, Park S, Connolly G, et al. Effect of fasting-mimicking diet on markers of autophagy and metabolic health in human subjects. *GeroScience* 2026. PMID 41372565. DOI 10.1007/s11357-025-02035-4. https://pmc.ncbi.nlm.nih.gov/articles/PMC13601415/
17. Kumar GVN, Wang RS, Sharma AX, et al. Non-canonical lysosomal lipolysis drives mobilization of adipose tissue energy stores with fasting. *Nat Commun* 2025;16:1330. PMID 39900947. DOI 10.1038/s41467-025-56613-3. https://pmc.ncbi.nlm.nih.gov/articles/PMC11790841/
18. Yang L, Licastro D, Cava E, et al. Long-term calorie restriction enhances cellular quality-control processes in human skeletal muscle. *Cell Rep* 2016. PMID 26774472. DOI 10.1016/j.celrep.2015.12.042.
19. Das JK, Banskota N, Candia J, et al. Calorie restriction modulates the transcription of genes related to stress response and longevity in human muscle: the CALERIE study. *Aging Cell* 2023. PMID 37823711. DOI 10.1111/acel.13963. https://pmc.ncbi.nlm.nih.gov/articles/PMC10726900/
20. Klionsky DJ, et al. Guidelines for the use and interpretation of assays for monitoring autophagy (4th edition). *Autophagy* 2021. PMID 33634751. DOI 10.1080/15548627.2020.1797280. https://pmc.ncbi.nlm.nih.gov/articles/PMC7996087/
21. Mizushima N, Yamamoto A, Matsui M, Yoshimori T, Ohsumi Y. In vivo analysis of autophagy in response to nutrient starvation using transgenic mice expressing a fluorescent autophagosome marker. *Mol Biol Cell* 2004;15:1101–1111. PMID 14699058. DOI 10.1091/mbc.e03-09-0704. https://pmc.ncbi.nlm.nih.gov/articles/PMC363084/
22. Alirezaei M, Kemball CC, Flynn CT, et al. Short-term fasting induces profound neuronal autophagy. *Autophagy* 2010. PMID 20534972. DOI 10.4161/auto.6.6.12376. https://pmc.ncbi.nlm.nih.gov/articles/PMC3106288/
23. Jensen TL, Kiersgaard MK, Sørensen DB, Mikkelsen LF. Fasting of mice: a review. *Lab Anim* 2013. PMID 24025567. DOI 10.1177/0023677213501659.
24. Kleiber M. Body size and metabolic rate. *Physiol Rev* 1947;27:511–541. PMID 20267758. DOI 10.1152/physrev.1947.27.4.511.
25. Schwalm C, Jamart C, Benoit N, et al. Activation of autophagy in human skeletal muscle is dependent on exercise intensity and AMPK activation. *FASEB J* 2015. PMID 25957282. DOI 10.1096/fj.14-267187.
26. Fritzen AM, Madsen AB, Kleinert M, et al. Regulation of autophagy in human skeletal muscle: effects of exercise, exercise training and insulin stimulation. *J Physiol* 2016. PMID 26614120. DOI 10.1113/JP271405.
27. Brandt N, Gunnarsson TP, Bangsbo J, Pilegaard H. Exercise and exercise training-induced increase in autophagy markers in human skeletal muscle. *Physiol Rep* 2018. PMID 29626392. DOI 10.14814/phy2.13651. https://pmc.ncbi.nlm.nih.gov/articles/PMC5889490/
28. Jamart C, Francaux M, Millet GY, et al. Modulation of autophagy and ubiquitin-proteasome pathways during ultra-endurance running. *J Appl Physiol* 2012. PMID 22345427. DOI 10.1152/japplphysiol.00952.2011.
29. Specht JW, Ducharme JB, Bailly AR, Deyhle MR. Autophagic responses to vigorous endurance exercise in men vary by training status but are similar in PBMCs and skeletal muscle: a pilot study. *Physiol Rep* 2026. PMID 42615877. DOI 10.14814/phy2.71064. https://pmc.ncbi.nlm.nih.gov/articles/PMC13488457/
30. Fry CS, Drummond MJ, Glynn EL, et al. Skeletal muscle autophagy and protein breakdown following resistance exercise are similar in younger and older adults. *J Gerontol A* 2013. PMID 23089333. DOI 10.1093/gerona/gls209. https://pmc.ncbi.nlm.nih.gov/articles/PMC3623482/
31. Hentilä J, Ahtiainen JP, Paulsen G, et al. Autophagy is induced by resistance exercise in young men, but unfolded protein response is induced regardless of age. *Acta Physiol* 2018. PMID 29608242. DOI 10.1111/apha.13069.
32. Glynn EL, Fry CS, Drummond MJ, et al. Muscle protein breakdown has a minor role in the protein anabolic response to essential amino acid and carbohydrate intake following resistance exercise. *Am J Physiol Regul Integr Comp Physiol* 2010. PMID 20519362. DOI 10.1152/ajpregu.00077.2010. https://pmc.ncbi.nlm.nih.gov/articles/PMC2928613/
33. Wojtaszewski JF, Nielsen P, Hansen BF, Richter EA, Kiens B. Isoform-specific and exercise intensity-dependent activation of 5'-AMP-activated protein kinase in human skeletal muscle. *J Physiol* 2000. PMID 11018120. DOI 10.1111/j.1469-7793.2000.t01-1-00221.x.
34. Wojtaszewski JF, MacDonald C, Nielsen JN, et al. Regulation of 5'AMP-activated protein kinase activity and substrate utilization in exercising human skeletal muscle. *Am J Physiol Endocrinol Metab* 2003. PMID 12488245. DOI 10.1152/ajpendo.00436.2002.
35. He C, Bassik MC, Moresi V, et al. Exercise-induced BCL2-regulated autophagy is required for muscle glucose homeostasis. *Nature* 2012. PMID 22258505. DOI 10.1038/nature10758. https://pmc.ncbi.nlm.nih.gov/articles/PMC3518436/
36. Atherton PJ, Etheridge T, Watt PW, et al. Muscle full effect after oral protein: time-dependent concordance and discordance between human muscle protein synthesis and mTORC1 signaling. *Am J Clin Nutr* 2010. PMID 20844073. DOI 10.3945/ajcn.2010.29819.
37. Greenhaff PL, Karagounis LG, Peirce N, et al. Disassociation between the effects of amino acids and insulin on signaling, ubiquitin ligases, and protein turnover in human muscle. *Am J Physiol Endocrinol Metab* 2008. PMID 18577697. DOI 10.1152/ajpendo.90411.2008. https://pmc.ncbi.nlm.nih.gov/articles/PMC2536736/
38. Wilkes EA, Selby AL, Atherton PJ, et al. Blunting of insulin inhibition of proteolysis in legs of older subjects may contribute to age-related sarcopenia. *Am J Clin Nutr* 2009. PMID 19740975. DOI 10.3945/ajcn.2009.27543.
39. Mortimore GE, Pösö AR, Lardeux BR. Mechanism and regulation of protein degradation in liver. *Diabetes Metab Rev* 1989. PMID 2649336. DOI 10.1002/dmr.5610050105.
40. Pösö AR, Surmacz CA, Mortimore GE. Inhibition of intracellular protein degradation by ethanol in perfused rat liver. *Biochem J* 1987. PMID 3496083. DOI 10.1042/bj2420459.
41. Nair KS, Welle SL, Halliday D, Campbell RG. Effect of beta-hydroxybutyrate on whole-body leucine kinetics and fractional mixed skeletal muscle protein synthesis in humans. *J Clin Invest* 1988. PMID 3392207. DOI 10.1172/JCI113570.
42. Vandoorne T, De Smet S, Ramaekers M, et al. Intake of a ketone ester drink during recovery from exercise promotes mTORC1 signaling but not glycogen resynthesis in human muscle. *Front Physiol* 2017. PMID 28588499. DOI 10.3389/fphys.2017.00310.
43. Shimazu T, Hirschey MD, Newman J, et al. Suppression of oxidative stress by β-hydroxybutyrate, an endogenous histone deacetylase inhibitor. *Science* 2013. PMID 23223453. DOI 10.1126/science.1227166.
44. Rothman DL, Magnusson I, Katz LD, Shulman RG, Shulman GI. Quantitation of hepatic glycogenolysis and gluconeogenesis in fasting humans with 13C NMR. *Science* 1991. PMID 1948033. DOI 10.1126/science.1948033.
45. Costford SR, Bajpeyi S, Pasarica M, et al. Skeletal muscle NAMPT is induced by exercise in humans. *Am J Physiol Endocrinol Metab* 2010. PMID 19887595. DOI 10.1152/ajpendo.00318.2009.
46. Elhassan YS, Kluckova K, Fletcher RS, et al. Nicotinamide riboside augments the aged human skeletal muscle NAD+ metabolome and induces transcriptomic and anti-inflammatory signatures. *Cell Rep* 2019. PMID 31412242. DOI 10.1016/j.celrep.2019.07.043.
47. Martens CR, Denman BA, Mazzo MR, et al. Chronic nicotinamide riboside supplementation is well-tolerated and elevates NAD+ in healthy middle-aged and older adults. *Nat Commun* 2018. PMID 29599478. DOI 10.1038/s41467-018-03421-7.
48. Civitarese AE, Carling S, Heilbronn LK, et al. Calorie restriction increases muscle mitochondrial biogenesis in healthy humans. *PLoS Med* 2007. PMID 17341128. DOI 10.1371/journal.pmed.0040076.
49. Masiero E, Agatea L, Mammucari C, et al. Autophagy is required to maintain muscle mass. *Cell Metab* 2009. PMID 19945408. DOI 10.1016/j.cmet.2009.10.008.
50. Mammucari C, Milan G, Romanello V, et al. FoxO3 controls autophagy in skeletal muscle in vivo. *Cell Metab* 2007. PMID 18054315. DOI 10.1016/j.cmet.2007.11.001.
51. Pyo JO, Yoo SM, Ahn HH, et al. Overexpression of Atg5 in mice activates autophagy and extends lifespan. *Nat Commun* 2013. PMID 23939249. DOI 10.1038/ncomms3300.
52. Di Francesco A, Deighan AG, Litichevskiy L, et al. Dietary restriction impacts health and lifespan of genetically diverse mice. *Nature* 2024;634:684–692. PMID 39385029. DOI 10.1038/s41586-024-08026-3.
53. Martinez-Lopez N, Tarabra E, Toledo M, et al. System-wide benefits of intermeal fasting by autophagy. *Cell Metab* 2017. PMID 29107505. DOI 10.1016/j.cmet.2017.09.020. (Mouse, isocaloric twice-a-day feeding; D.)
54. Levine ME, Suarez JA, Brandhorst S, et al. Low protein intake is associated with a major reduction in IGF-1, cancer, and overall mortality in the 65 and younger but not older population. *Cell Metab* 2014. PMID 24606898. DOI 10.1016/j.cmet.2014.02.006. https://pmc.ncbi.nlm.nih.gov/articles/PMC3988204/
55. Fontana L, Weiss EP, Villareal DT, Klein S, Holloszy JO. Long-term effects of calorie or protein restriction on serum IGF-1 and IGFBP-3 concentration in humans. *Aging Cell* 2008. PMID 18843793. DOI 10.1111/j.1474-9726.2008.00417.x.
56. Fontana L, Villareal DT, Das SK, et al. Effects of 2-year calorie restriction on circulating levels of IGF-1, IGF-binding proteins and cortisol in nonobese men and women: a randomized clinical trial. *Aging Cell* 2016. PMID 26443692. DOI 10.1111/acel.12400.
57. Burgers AM, Biermasz NR, Schoones JW, et al. Meta-analysis and dose-response metaregression: circulating insulin-like growth factor I (IGF-I) and mortality. *J Clin Endocrinol Metab* 2011. PMID 21795450. DOI 10.1210/jc.2011-1377.
58. Guevara-Aguirre J, Balasubramanian P, Guevara-Aguirre M, et al. Growth hormone receptor deficiency is associated with a major reduction in pro-aging signaling, cancer, and diabetes in humans. *Sci Transl Med* 2011. PMID 21325617. DOI 10.1126/scitranslmed.3001845.
59. Bauer J, Biolo G, Cederholm T, et al. Evidence-based recommendations for optimal dietary protein intake in older people: a position paper from the PROT-AGE Study Group. *J Am Med Dir Assoc* 2013. PMID 23867520. DOI 10.1016/j.jamda.2013.05.021.
60. Houston DK, Nicklas BJ, Ding J, et al. Dietary protein intake is associated with lean mass change in older, community-dwelling adults: the Health ABC Study. *Am J Clin Nutr* 2008. PMID 18175749. DOI 10.1093/ajcn/87.1.150.
61. Morton RW, Murphy KT, McKellar SR, et al. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. *Br J Sports Med* 2018. PMID 28698222. DOI 10.1136/bjsports-2017-097608.
62. Plaisance EP, Greenway FL, Boudreau A, et al. Dietary methionine restriction increases fat oxidation in obese adults with metabolic syndrome. *J Clin Endocrinol Metab* 2011. PMID 21346062. DOI 10.1210/jc.2010-2493.
63. Hernández-Arciga U, Stamenkovic C, Yadav S, et al. Dietary methionine restriction started late in life promotes healthy aging in a sex-specific manner. *Sci Adv* 2025. PMID 40238871. DOI 10.1126/sciadv.ads1532. (Includes 8-wk human MetR trial NCT04701346.)
64. Ravussin E, Redman LM, Rochon J, et al. A 2-year randomized controlled trial of human caloric restriction: feasibility and effects on predictors of health span and longevity. *J Gerontol A* 2015. PMID 26187233. DOI 10.1093/gerona/glv057.
65. Kraus WE, Bhapkar M, Huffman KM, et al. 2 years of calorie restriction and cardiometabolic risk (CALERIE): exploratory outcomes of a multicentre, phase 2, randomised controlled trial. *Lancet Diabetes Endocrinol* 2019. PMID 31303390. DOI 10.1016/S2213-8587(19)30151-2.
66. Villareal DT, Fontana L, Das SK, et al. Effect of two-year caloric restriction on bone metabolism and bone mineral density in non-obese younger adults: a randomized clinical trial. *J Bone Miner Res* 2016;31:40–51. PMID 26332798. DOI 10.1002/jbmr.2701.
67. Redman LM, Smith SR, Burton JH, et al. Metabolic slowing and reduced oxidative damage with sustained caloric restriction support the rate of living and oxidative damage theories of aging. *Cell Metab* 2018. PMID 29576535. DOI 10.1016/j.cmet.2018.02.019.
68. Waziry R, Ryan CP, Corcoran DL, et al. Effect of long-term caloric restriction on DNA methylation measures of biological aging in healthy adults from the CALERIE trial. *Nat Aging* 2023. PMID 37118425. DOI 10.1038/s43587-022-00357-y. https://pmc.ncbi.nlm.nih.gov/articles/PMC10148951/
69. Spadaro O, Youm Y, Shchukina I, et al. Caloric restriction in humans reveals immunometabolic regulators of health span. *Science* 2022. PMID 35143297. DOI 10.1126/science.abg7292.
70. Romashkan SV, Das SK, Villareal DT, et al. Safety of two-year caloric restriction in non-obese healthy individuals. *Oncotarget* 2016. PMID 26992237. DOI 10.18632/oncotarget.8093.
71. Wei M, Brandhorst S, Shelehchi M, et al. Fasting-mimicking diet and markers/risk factors for aging, diabetes, cancer, and cardiovascular disease. *Sci Transl Med* 2017. PMID 28202779. DOI 10.1126/scitranslmed.aai8700. https://pmc.ncbi.nlm.nih.gov/articles/PMC6816332/
72. Brandhorst S, Levine ME, Wei M, et al. Fasting-mimicking diet causes hepatic and blood markers changes indicating reduced biological age and disease risk. *Nat Commun* 2024. PMID 38378685. DOI 10.1038/s41467-024-45260-9. https://pmc.ncbi.nlm.nih.gov/articles/PMC10879164/
73. Hofer SJ, Daskalaki I, Bergmann M, et al. Spermidine is essential for fasting-mediated autophagy and longevity. *Nat Cell Biol* 2024. PMID 39117797. DOI 10.1038/s41556-024-01468-x.
74. Schwarz C, Benson GS, Horn N, et al. Effects of spermidine supplementation on cognition and biomarkers in older adults with subjective cognitive decline: a randomized clinical trial. *JAMA Netw Open* 2022. PMID 35616942. DOI 10.1001/jamanetworkopen.2022.13875.
75. Pietrocola F, Malik SA, Mariño G, et al. Coffee induces autophagy in vivo. *Cell Cycle* 2014. PMID 24769862. DOI 10.4161/cc.28929.
76. Liu S, D'Amico D, Shankland E, et al. Effect of urolithin A supplementation on muscle endurance and mitochondrial health in older adults: a randomized clinical trial. *JAMA Netw Open* 2022. PMID 35050355. DOI 10.1001/jamanetworkopen.2021.44279.
77. Singh A, D'Amico D, Andreux PA, et al. Urolithin A improves muscle strength, exercise performance, and biomarkers of mitochondrial health in a randomized trial in middle-aged adults. *Cell Rep Med* 2022. PMID 35584623. DOI 10.1016/j.xcrm.2022.100633.
78. Isley WL, Underwood LE, Clemmons DR. Dietary components that regulate serum somatomedin-C concentrations in humans. *J Clin Invest* 1983. PMID 6681614. DOI 10.1172/JCI110757.
79. Clemmons DR, Klibanski A, Underwood LE, et al. Reduction of plasma immunoreactive somatomedin C during fasting in humans. *J Clin Endocrinol Metab* 1981. PMID 7197688. DOI 10.1210/jcem-53-6-1247.
80. Thissen JP, Ketelslegers JM, Underwood LE. Nutritional regulation of the insulin-like growth factors. *Endocr Rev* 1994. PMID 8156941. DOI 10.1210/edrv-15-1-80.
81. Hollstein T, Basolo A, Unlu Y, et al. Effects of short-term fasting on ghrelin/GH/IGF-1 axis in healthy humans: the role of ghrelin in the thrifty phenotype. *J Clin Endocrinol Metab* 2022. PMID 35678263. DOI 10.1210/clinem/dgac353.
82. Chan JL, Williams CJ, Raciti P, et al. Leptin does not mediate short-term fasting-induced changes in growth hormone pulsatility but increases IGF-I in leptin deficiency states. *J Clin Endocrinol Metab* 2008. PMID 18445667. DOI 10.1210/jc.2008-0056. https://pmc.ncbi.nlm.nih.gov/articles/PMC2453057/
83. Gälman C, Lundåsen T, Kharitonenkov A, et al. The circulating metabolic regulator FGF21 is induced by prolonged fasting and PPARα activation in man. *Cell Metab* 2008. PMID 18680716. DOI 10.1016/j.cmet.2008.06.014.
84. Laeger T, Henagan TM, Albarado DC, et al. FGF21 is an endocrine signal of protein restriction. *J Clin Invest* 2014. PMID 25133427. DOI 10.1172/JCI74915.
85. Dushay JR, Toschi E, Mitten EK, et al. Fructose ingestion acutely stimulates circulating FGF21 levels in humans. *Mol Metab* 2015. PMID 25685689. DOI 10.1016/j.molmet.2014.09.008.
86. Søberg S, Sandholt CH, Jespersen NZ, et al. FGF21 is a sugar-induced hormone associated with sweet intake and preference in humans. *Cell Metab* 2017. PMID 28467924. DOI 10.1016/j.cmet.2017.04.009.
87. Peterson M, Richardson KA, Funderburk L. Effect of exercise on fibroblast growth factor 21 levels in healthy males and females. *PLoS One* 2025. PMID 40440637. DOI 10.1371/journal.pone.0321738.
88. Pilegaard H, Saltin B, Neufer PD. Exercise induces transient transcriptional activation of the PGC-1α gene in human skeletal muscle. *J Physiol* 2003. PMID 12563009. DOI 10.1113/jphysiol.2002.034850.
89. Tinsley GM, Moore ML, Graybeal AJ, et al. Time-restricted feeding plus resistance training in active females: a randomized trial. *Am J Clin Nutr* 2019. PMID 31268131. DOI 10.1093/ajcn/nqz126.
90. Moro T, Tinsley G, Bianco A, et al. Effects of eight weeks of time-restricted feeding (16/8) on basal metabolism, maximal strength, body composition, inflammation, and cardiovascular risk factors in resistance-trained males. *J Transl Med* 2016. PMID 27737674. DOI 10.1186/s12967-016-1044-0.
91. Lowe DA, Wu N, Rohdin-Bibby L, et al. Effects of time-restricted eating on weight loss and other metabolic parameters in women and men with overweight and obesity: the TREAT randomized clinical trial. *JAMA Intern Med* 2020. PMID 32986097. DOI 10.1001/jamainternmed.2020.4153.
92. Areta JL, Burke LM, Ross ML, et al. Timing and distribution of protein ingestion during prolonged recovery from resistance exercise alters myofibrillar protein synthesis. *J Physiol* 2013. PMID 23459753. DOI 10.1113/jphysiol.2012.244897.
93. Laurens C, Grundler F, Damiot A, et al. Is muscle and protein loss relevant in long-term fasting in healthy men? A prospective trial on physiological adaptations. *J Cachexia Sarcopenia Muscle* 2021. PMID 34668663. DOI 10.1002/jcsm.12766.
94. Bak AM, Vendelbo MH, Christensen B, et al. Prolonged fasting-induced metabolic signatures in human skeletal muscle of lean and obese men. *PLoS One* 2018. PMID 30183740. DOI 10.1371/journal.pone.0200817.
95. Fazeli PK, Steinhauser ML. A critical assessment of fasting to promote metabolic health and longevity. *Endocr Rev* 2025. PMID 40700575. DOI 10.1210/endrev/bnaf021.
96. Teong XT, Liu K, Vincent AD, et al. Exploring the impact of intermittent fasting plus time-restricted eating versus calorie restriction on eating behavior, mood, sleep, quality of life in adults with obesity. *Clin Nutr* 2026. PMID 42208206. DOI 10.1016/j.clnu.2026.106686. (Describes the iTRE/CR/SC protocol used in [13]; NCT03689608.)
97. Hein LK, Hattersley KJ, Bensalem J, Sargeant TJ. Measurement of physiological autophagic flux in the human peripheral blood mononuclear cell pool. *Methods Mol Biol* 2026. PMID 41082113. DOI 10.1007/978-1-0716-4844-5_6.
98. ClinicalTrials.gov NCT04842864, "Time Course for Fasting-induced Autophagy in Humans" (withdrawn; 0 enrolled). https://clinicaltrials.gov/study/NCT04842864
99. ClinicalTrials.gov NCT04739852, "The Kinetics of Autophagy During Periodic Fasting…" (Charité; status unknown; no results posted). https://clinicaltrials.gov/study/NCT04739852
100. Carosi JM, Martin A, Hein LK, et al. Autophagy across tissues of aging mice. *PLoS One* 2025. PMID 40465797. DOI 10.1371/journal.pone.0325505. (Mouse: ageing ↓ heart flux, ↑ blood flux in males; D.)
101. Turner L, Zhao L, Liu K, et al. Impact of achieved weight loss by intermittent fasting plus early time-restricted eating and calorie restriction on systemic and adipose tissue markers of inflammation in adults at risk of type 2 diabetes: an exploratory sub-study. *J Hum Nutr Diet* 2025. PMID 41063446. DOI 10.1111/jhn.70137.
