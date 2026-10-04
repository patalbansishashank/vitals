# 05 — Dietary fat handling, fat oxidation, ketogenesis & ketosis dynamics

> Dossier for the Vitals simulation engine. Follows `research/RESEARCH_PROTOCOL.md`.
> Every number carries a source; `UNVERIFIED` marks numbers that could not be confirmed against a primary text;
> `PROPOSED FIT` marks equations/parameters fitted by this dossier to the cited data points; `DERIVED` marks arithmetic on cited numbers.
> Calibration of the ketone sub-model was done numerically (reference Python implementation, 5-min Euler step) against the
> validation targets in §7; the resulting parameter values are those listed in §4.

---

## 1. Scope

- Whole-body handling of dietary fat (absorption, storage, "fat oxidation as the residual fuel", postprandial lipaemia, maximal fat oxidation/lipolysis limits) and the minimum-fat constraints (essential fatty acids, fat-soluble vitamin/carotenoid absorption, gallstones, sex hormones).
- A mechanistic, hour-resolved **ketone sub-model** that outputs blood β-hydroxybutyrate (BHB, mmol/L) from liver glycogen, an insulin proxy, plasma free-fatty-acid (FFA) supply, protein intake, energy deficit, exercise, MCT/exogenous ketones and two **keto-adaptation state variables** (fast: days; slow: weeks).
- Entry, steady state, exit, re-entry and cycling of ketosis; transition ("keto flu") phenomena; whether ketosis *per se* changes appetite, protein sparing, energy expenditure or fat loss; safety thresholds.
- Out of scope (cross-referenced): glycogen & insulin kinetics (04), energy balance/fat mass models (01), EE adaptation (02), lipids (06), fasting timing/circadian (07), water/electrolytes (13/15), safety rules (17), performance (19).

---

## 2. State variables

| Name | Unit | Typical range | Represents | Initial-value rule |
|---|---|---|---|---|
| `TKB` | mmol/L | 0.05–8 | Total blood ketone bodies (BHB + acetoacetate, AcAc); the kinetic pool | Mixed diet, overnight fasted: 0.25; on a very-low-carb diet (VLCD) start from 3-day history if known |
| `BHB` (output) | mmol/L | 0.02–6.5 | Blood D-β-hydroxybutyrate as read by a capillary meter | `BHB = TKB·R/(1+R)`, `R = 1.5 + 0.3·TKB` (§4.5) |
| `FFA` | mmol/L | 0.05–1.6 | Plasma non-esterified fatty acids (ketogenic substrate) | 0.5 (overnight fasted, mixed diet) |
| `G_L` | g | 0–100·FFM/60 | Liver glycogen (**owned by dossier 04**; fallback in §4.4) | 70% of `G_Lmax` after a mixed-diet day |
| `G_M` | g | 0–400·FFM/60 | Muscle glycogen (**owned by 04/10**; fallback in §4.4) | 0.85·`G_Mmax` on a mixed diet |
| `I` | dimensionless | 0.3–12 | Insulin proxy, 1.0 = overnight-fasted insulin on a mixed diet (~8–10 µU/mL) (**owned by 04**; fallback §4.4) | 1.0 |
| `P_ew` | g/day | 0–250 | Exponentially-weighted recent protein intake (τ = 8 h) | habitual protein g/day |
| `X_post` | dimensionless | 0–0.4 | Post-exercise lipolytic drive (decays τ = 3 h) | 0 |
| `A_f` | 0–1 | 0–1 | **Fast keto-/fat-adaptation** (muscle fat-oxidation "retooling", hepatic ketogenic enzyme induction); τ_up 48 h, τ_down 40 h | 0 for habitual mixed diet; 1 if habitually <50 g carb/day |
| `A_s` | 0–1 | 0–1 | **Slow ketone-kinetics adaptation** (reduced muscle ketone uptake, sustained hepatic ketogenic output) driven by sustained high TKB; τ 120 h | 0 |
| `FatOxCap` (derived) | g/min | 0.2–1.7 | Exercise maximal fat oxidation capacity = baseline × (1 + 1.3·A_f) | from sex/FFM/VO2max (§4.15) |

---

## 3. Inputs that drive it

| Input | Unit | How it enters |
|---|---|---|
| Net (glycaemic) carbohydrate per meal | g | Absorption rate `Ra_C(t)` (gamma kernel, peak 0.75 h) → insulin proxy ↑ → FFA ↓ (antilipolysis) and liver/muscle glycogen ↑ → hepatic ketogenic partition φ ↓; also 24-h carb total drives `A_f*` |
| Protein per meal | g | `Ra_P(t)` (peak 1.5 h) → small insulin ↑; gluconeogenic flux to liver glycogen (10%); `P_ew` → production × exp(−0.15·P_ew/90) |
| Fat per meal (long-chain) | g | Energy only (energy-deficit term) — dietary LCT is **not** directly ketogenic in the model; fat handling in §4.15 |
| MCT (C8, C10 triglyceride) | g | Portal delivery → direct hepatic ketogenesis (`y_C8` = 0.5, `y_C10` = 0.17 mol TKB per mol fatty acid), ×0.5 if a >50 g meal within 3 h |
| Exogenous ketones (ester/salt) | g BHB | Absorbed pool (peak 0.5 h fasted, 0.75 h fed); salts: only the D-isomer (~50%) counts for meters |
| Energy intake last 24 h vs TEE | kcal | Deficit fraction `d = max(0, 1 − EI24/TEE)` → FFA × (1 + 1.5·d) |
| Exercise intensity `x` | fraction of VO2max | During: FFA × (1 + 0.4x), insulin × (1 − 0.3x), ketone clearance × (1 + x) (only when TKB < ~3 mM), liver glycogen drain + 30·x g/h, muscle glycogen use 200·x² g/h; after: clearance × 0.6 for 2 h, `X_post` decays τ 3 h |
| Body: BW, FFM, sex, insulin-resistance factor `IR` | kg, –, – | Scale Vd (0.25 L/kg BW), clearance & production (∝ FFM), glycogen capacities (∝ FFM); `IR` multiplies insulin proxy (1.0 lean insulin-sensitive, 1.2–1.4 obese/insulin-resistant) |
| Time of day | h | Only via meal timing (diurnal BHB pattern emerges from meals; §4.5) |

---

## 4. Mechanisms & equations

### 4.0 Architecture (read first)

```
 carbs, protein ──► insulin proxy I ──┐                    ┌──► liver glycogen G_L ──► hepatic partition φ(G_L)
                                     ▼                    │
 energy deficit d, exercise, ──► FFA supply (τ 1–1.5 h) ──┴──► hepatic ketogenesis P = kP·FFM·(FFA+F_hep)·φ·h(I)·π(protein)
 muscle-glycogen deficit,                                                     + MCT + exogenous
 ketone feedback                                                                      │
                                                                                      ▼
                        TKB pool (Vd = 0.25·BW)  ◄── dTKB/dt = (P − U − renal)/Vd
                                                     U = Vmax·TKB/(Km+TKB)·(exercise)·(1 − 0.35·A_s)
 slow states: A_f (48 h/40 h) scales φ;  A_s (120 h) scales φ and U
 output: BHB = TKB·R/(1+R);   brain ketone share;  ketone energy flux;  urinary ketone loss
```

- Integrate with Δt = 5 min (explicit Euler is stable: fastest time constant is ketone clearance, t½ ≈ 20–25 min at low TKB); report hourly.
- The model computes **total ketone bodies (TKB)** because all tracer kinetics (Balasse, Owen, Reichard) are for TKB; BHB is derived.
- Physiological backbone: ketone production is primarily determined by FFA delivery to the liver (Miles 1983: raising FFA 0.32→1.4 mM at clamped basal insulin/glucagon raised ketone production 2.2→11.4 µmol·kg⁻¹·min⁻¹ [44]); the hepatic *fraction* of FFA directed into ketogenesis rises when carbohydrate/glycogen and insulin fall (fasting partition roughly doubles, DERIVED from [3,44]); insulin lowers ketones by (i) antilipolysis, (ii) a direct hepatic restraint and (iii) enhanced peripheral utilisation (Keller 1989 review [45]); ketones restrain their own production (negative feedback, Balasse & Neef 1975 [42]); peripheral uptake saturates as concentration rises (Balasse 1979 [3]; Owen 1973 [5]).

### 4.1 Ketone distribution and clearance (utilisation)

**Mechanism.** Ketones are taken up mainly by muscle, heart, brain and kidney. Uptake is linear with concentration below ~2 mM and saturates above; in prolonged fasting, muscle ketone extraction falls (muscle switches to FFA), so the metabolic clearance rate (MCR) falls further and ketones are "spared" for the brain.

**Equations.**
```
Vd   = 0.25 · BW                               [L]
CL0  = 0.0134 · FFM                            [L/min]   (low-concentration clearance)
Vmax = CL0 · Km                                [mmol/min]
U    = Vmax · TKB/(Km + TKB) · M_ex · (1 − a_m·A_s)          [mmol/min]
Renal = r_ren · BW · max(0, TKB − T_thr)       [mmol/min]
dTKB/dt = (P_total − U − Renal)/Vd             [mmol·L⁻¹·min⁻¹]
```

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| Vd | 0.25 | L/kg BW | range 0.18–0.31 | Owen 1973: volume of distribution 18–31% of body weight [5] |
| fractional utilisation at low TKB | 2.9 %/min (all subjects); 2.1 %/min (obese, overnight) | min⁻¹ | — | Owen 1973 [5] |
| CL0 (per kg FFM) | 0.0134 | L·min⁻¹·kg FFM⁻¹ | ±30% | DERIVED: 0.029 min⁻¹ × 0.25 L/kg × BW for obese subjects (BW≈110, FFM≈60) |
| Km | 6.0 | mmol/L TKB | 4–12 | PROPOSED FIT to: (a) Owen 1973 fractional utilisation 2.9 → 1.5 → 0.6 %/min at overnight/3-d/24-d fast [5]; (b) Balasse 1979 plateau TKB 7.09 ± 0.32 mM with production 1908 ± 80 µmol/min and urinary loss 167 ± 14 µmol/min [3]; (c) linear utilisation below 2 mM [5] |
| a_m | 0.35 | – | 0.2–0.5 | Balasse 1979: starvation lowers MCR by 35% vs acutely infused subjects at 3–10 mM [3] |
| r_ren, T_thr | 0.00025 L·min⁻¹·kg⁻¹; 1.0 mM | – | ±50% | PROPOSED FIT: reproduces 167 µmol/min urinary TKB at 7.1 mM in ~110-kg obese [3]; urinary loss "always below 10% of total turnover under physiologic conditions" [4] |
| M_ex (exercise) | 1 + 1.0·x/(1+(TKB/3)⁴) during; ×0.6 for 2 h after | – | ±50% | Féry & Balasse 1986: MCR +40–50% during 2 h at 50% VO2max when ketonaemia <0.6 mM, abolished when >3–4 mM [38]; Féry & Balasse 1983: MCR falls below pre-exercise in recovery [37] |

**Time dynamics.** At low TKB the clearance half-life is ln2/(CL0/Vd) ≈ 20–25 min (DERIVED from 2.9 %/min [5]); at 3-day-fast levels ~46 min (1.5 %/min); at 24-day levels ~115 min (0.6 %/min). After exogenous ketone ester, the apparent BHB elimination half-life is 0.8–3.1 h (includes ongoing absorption; Clarke 2012 [51]).

**Moderators.** Uptake capacity scales with metabolically active tissue (FFM). Endurance training up-regulates muscle ketolytic enzymes/MCT1 (animal data, 2–3-fold oxidation in trained rat muscle, reviewed in Evans 2017 [41]) — grade D, not modelled.

**Evidence grade: A−** (multiple human tracer studies; the saturable form and Km are fitted).

### 4.2 Hepatic ketogenesis

**Mechanism.** Hepatic ketogenesis = (FFA delivered to liver) × (fraction routed to β-oxidation → HMG-CoA pathway rather than re-esterification/TCA). The fraction rises when liver glycogen is depleted and insulin is low (malonyl-CoA ↓, CPT-1 disinhibited, glucagon ↑). Protein intake (insulinogenic, glucagonogenic, anaplerotic/gluconeogenic) modestly restrains it. Energy deficit raises FFA supply. Ketones inhibit their own production (antilipolysis).

**Equations.**
```
φ      = [φ_min + (1 − φ_min) / (1 + (G_L/G50)^nG)] · (1 + a_h·A_f) · (1 + a_hs·A_s)
h(I)   = 1 / (1 + k_Ih · I)                                  (direct hepatic insulin restraint)
π      = exp(−k_prot · P_ew / 90)                            (protein; P_ew in g/day)
P_end  = kP · FFM · (FFA + F_hep) · φ · h(I) · π            [mmol TKB/min]
P_total = P_end + P_MCT + P_exo                              (§4.12)
```
with `G50 = 55·FFM/60` g, `G_Lmax = 100·FFM/60` g.

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| kP | 0.010 | mmol·min⁻¹·kg FFM⁻¹·(mM FFA)⁻¹ | ±25% | PROPOSED FIT to fasting and diet targets (§7); cross-check: postabsorptive production 1.5–3.6 µmol·kg⁻¹·min⁻¹ (Miles 1983 [44]; Keller 1988 [43]); starvation plateau 1.0–1.9 mmol/min in obese (Reichard 1974: max ~150 g/24 h [7]; Balasse 1979: 1908 µmol/min [3]); model: 1.84 mmol/min at day 24 in a 110-kg obese man |
| F_hep | 0.15 | mM-equivalent | 0.05–0.2 | PROPOSED FIT: non-plasma-FFA hepatic substrate (intrahepatic TG, remnants) so that production is not abolished after a carbohydrate load (exit data, Deru 2024 [46]) |
| φ_min | 0.12 | – | 0.05–0.3 | PROPOSED FIT |
| G50 | 55 (per 60 kg FFM) | g liver glycogen | 40–65 | PROPOSED FIT to entry timing (0.5 mM at ~21 h of fasting, Deru 2021 [13]; 0.9 mM at 30 h in men, Haymond 1982 [12]) given liver glycogen falling ~3–4.5 g/h early in a fast (Rothman 1991: gluconeogenesis 64 ± 5% of glucose output over the first 22 h, i.e. glycogenolysis ~36% (DERIVED) [17]) |
| nG | 2.5 | – | 2–3 | PROPOSED FIT |
| k_Ih | 0.15 | per unit I | 0–0.3 | Keller 1988: at matched high FFA, insulin ~110 µU/mL cut ketone production from 8.2 to 3.8 µmol·kg⁻¹·min⁻¹ vs ~13 µU/mL [43]. **Contested:** Miles 1983 found no direct hepatic insulin effect [44] — grade C |
| k_prot | 0.15 | per 90 g/day protein | 0–0.69 | Hall 2010 model uses 0.69 ("a protein-modified fast decreases circulating ketone levels by one-half compared with fasting alone") [1]; diet data (1.2–2.2 g/kg protein still giving 0.8–1.5 mM, §4.8) fit better with a weak effect; best joint fit 0–0.15 — grade C |
| τ_prot | 8 h | – | 6–24 h | PROPOSED |
| a_h | 0.35 | – | 0.2–0.5 | PROPOSED FIT (rise of BHB over the first week of a ketogenic diet, Harvey 2018 [21]) |
| a_hs | 0.5 | – | 0.3–0.8 | PROPOSED FIT: continued rise of ketonaemia over 2–3 weeks of fasting (plateau after ~17 days, Owen 1969 [8]; TKB 6.8 mM at 24 d, Owen & Reichard 1971 [6]) |

**Comparison with the Hall (2010) whole-body model [1].** Hall models *daily* ketogenesis as
`KTG = ρK·DF·[A_K·(DF/D̂F)/(K_K + DF/D̂F)]·exp(−kP·PI/PIb)·exp(−kG·G/Ginit)` with ρK = 4.45 kcal/g, A_K = 0.8, K_K = 1, kP = kG = 0.69, D̂F = 140 g/day baseline lipolysis; ketone excretion 0 below 70 g/day ketogenesis, rising linearly to K_Umax = 20 g/day at KTG_max = 400 g/day; ketogenesis efficiency ε_k = 0.81 enters RMR [1]. It yields daily fluxes only — no concentration — which is why this dossier adds the concentration-kinetic layer (Hall's earlier 2006 semistarvation model [2] has no ketone term). Engineers may use Hall's daily flux as a cross-check of the integrated `P_end` (1 mmol TKB ≈ 0.103 g; DERIVED).

**Evidence grade: B** (strong human tracer physiology for the FFA dependence and feedback; the glycogen/partition function and its parameters are fitted).

### 4.3 FFA supply

**Mechanism.** Plasma FFA is set by adipose lipolysis (insulin is the dominant restraint), catecholamines (exercise), and energy deficit; ketones are antilipolytic.

```
lipo(I)  = 1 / (0.25 + 0.75 · I^1.2)                     (=1 at I=1; 0.18 at I=5; 1.8 at I=0.47)
δ_M      = max(0, (0.85·G_Mmax − G_M)/(0.85·G_Mmax))    (muscle-glycogen deficit)
FFA*     = F0 · lipo(I) · (1 + e_def·d) · (1 + X_post) · (1 + k_mgF·δ_M) / (1 + TKB/K_FB)
X_post   = ex_F·x during exercise; afterwards dX_post/dt = −X_post/τ_post
dFFA/dt  = (FFA* − FFA)/τ_F     (τ_F = 1.0 h rising, 1.5 h falling)
```

| Symbol | Value | Source / data points |
|---|---|---|
| F0 | 0.50 mM | Overnight-fasted FFA on mixed diet: 0.44–0.52 (Rosenbaum 2019 [19]); 0.51 (Owen & Reichard 1971 [6]); 0.6 (McDougal 2018 [14]) |
| lipo(I) shape | PROPOSED FIT | Klein 1993: glycerol Ra 2.08→4.36 and palmitate Ra 1.63→3.26 µmol·kg⁻¹·min⁻¹ from 12 to 72 h of fasting while insulin fell 64.6→30.1 pmol/L, 70% of the fall within 24 h [16]; FFA 0.6→1.1 mM over 72 h [14]; ketogenic diet FFA 0.76–0.84 vs 0.44–0.52 mM with fasting insulin −20% [19] |
| e_def | 1.5 | PROPOSED FIT (needed to reproduce higher ketonaemia under hypocaloric ketogenic diets, Johnstone 2008 [27], vs eucaloric, Hall 2016/Rosenbaum 2019 [18,19]) |
| K_FB | 15 mM TKB | Balasse & Neef 1975: raising ketones 47–92% in fasted obese lowered FFA 13.5% and endogenous ketogenesis to 67–90% of control [42]. Note: ketone ester at ~3 mM BHB lowered FFA AUC 44% in the fed/OGTT state (Myette-Côté 2018 [53]) — the model under-predicts acute exogenous-ketone antilipolysis |
| ex_F, τ_post | 0.4; 3 h | PROPOSED FIT to Féry & Balasse 1983 (TKB 0.20→0.39 mM over 2 h at ~50% VO2max; +0.73 mM 30 min into recovery) [37] |
| k_mgF | 3.0 | PROPOSED FIT (grade D) so that trained athletes on <50 g carb/day with daily training reach ~1.2 mM (Burke 2021 [32]) and exercise at the start of a fast advances ketosis by ~3.6 h (Deru 2021 [13]) |
| τ_F | 1.0 h up / 1.5 h down | PROPOSED; FFA fell 1.07→0.61 mM over 4 h of continuous carbohydrate refeeding after a 10–14-day fast (Gray 1989 [48]) |

**Evidence grade: B−** (direction and order of magnitude well supported; functional forms fitted).

### 4.4 Interfaces to glycogen and insulin (owned by 04) + fallback

The ketone model needs `G_L`, `G_M` and `I` every step. Use dossier 04's modules. If they are unavailable, this fallback reproduces the validation targets:

```
I_b   = 0.45 + 0.55 · min(1, G_L/(60·FFM/60))^0.5
I     = IR · (I_b + 0.12·Ra_C + 0.04·Ra_P) · (1 − 0.3·x)            (Ra in g/h)
out_L = 4.5·G_L/(G_L+10)·max(0, 1 − Ra_C/10) + 30·x·G_L/(G_L+10)     [g/h]
m_L   = 3.0 · δ_M · G_L/(G_L+10)                                     [g/h] liver glucose used for muscle glycogen resynthesis
dG_L/dt = 0.30·Ra_C + 0.10·Ra_P − out_L − m_L,   0 ≤ G_L ≤ 100·FFM/60
dG_M/dt = 0.5·Ra_C·min(1,(G_Mmax−G_M)/(0.15·G_Mmax)) + m_L − 200·x²·G_M/G_Mmax,   G_Mmax = 400·FFM/60
Absorption kernels: gamma(shape 2): carbs peak 0.75 h, protein 1.5 h, C8 1.0 h, C10 1.2 h, ketone ester 0.5 h (fasted)/0.75 h (fed)
```
Anchors: a 4-day isocaloric, isoproteinic replacement of carbohydrate by fat lowered insulin 44 ± 6% and raised glucagon 39 ± 10% with glucose −16.5% (Fery 1982 [49]); fasting glucose production 11.0 → 8.3 µmol·kg⁻¹·min⁻¹ from 12 to 72 h (Klein 1993 [16]); gluconeogenesis 64 ± 5% of glucose production in the first 22 h, 82% in the next 14 h and 96% thereafter (Rothman 1991 [17]); fasting insulin −50% by 72 h (Klein 1993 [16]); ketogenic-diet fasting insulin ~−20% (7.1–7.8 → 6.1 mIU/mL, Rosenbaum 2019 [19]). The scaling of glycogen capacity with FFM (while brain glucose demand is roughly fixed) is what makes smaller bodies (women, children) enter ketosis faster in the model. **Grade C** (the fallback is a crude stand-in for 04).

**Coupling note.** Dossier 04's liver-glycogen module (G_L,max ≈115 g for a 1.45-L liver; ~35–60 g after an overnight fast; ~15–25 g after 24 h) is of the same magnitude as this fallback (100 g per 60 kg FFM). When coupling, express the partition half-point relative to capacity (`G50 = 0.55·G_L,max`) and re-run V1–V6.

### 4.5 BHB:AcAc ratio, measurement and diurnal pattern

- `R = BHB/AcAc = 1.5 + 0.3·TKB` — PROPOSED FIT to arterial whole-blood data in obese fasting subjects: overnight BHB 0.185 / AcAc 0.106 (R 1.75); 3-day 2.233/0.829 (R 2.7); 24-day 5.291/1.515 (R 3.5) (Owen & Reichard 1971 [6]). On an isocaloric ketogenic diet plasma AcAc ≈ BHB (0.81–0.83 vs 0.77 mM; Rosenbaum 2019 [19]), so R can be ~1 in diet-induced ketosis — uncertainty ±40%. In DKA R rises from ~1:1 to as high as 10:1 (Laffel 1999 [75]).
- Capillary meters measure D-BHB (the model output). Urine strips detect AcAc only (nitroprusside) and are semi-quantitative (Laffel 1999 [75]).
- **Diurnal pattern on a stable ketogenic diet** (12 healthy adults, week 6; 74% fat, 19.5% protein, 6.2% carbohydrate): lowest blood BHB 0.33 ± 0.17 mM at 10:00, highest 0.70 ± 0.62 mM at 03:00; urine ketones most reliably detected at 07:00, 22:00 and 03:00 (>90% detection) (Urbain & Bertz 2016 [24]). The model reproduces a ~2.3-fold trough-to-peak swing driven by meals (trough 2–3 h after meals, peak at the end of the overnight fast). **Report both "morning fasting BHB" and "24-h mean BHB"; most trials report morning fasting values, which exceed the 24-h mean by ~40–60% in the model.**

### 4.6 Time course in total fasting (validation data + model)

Classic syntheses of starvation physiology: Cahill 1970 [10], Cahill 2006 [11]. The table uses primary measurements only.

| Time since last meal | Observed BHB (mM) | Population | Source | Model (lean man 75 kg/FFM 60) |
|---|---|---|---|---|
| 12 h | 0.1 ± 0.0 | 6 healthy men, BMI 20–27.9 | McDougal 2018 [14] | 0.10 |
| overnight | 0.185 ± 0.017 (whole blood) | 8 obese | Owen & Reichard 1971 [6] | — |
| ≤12 h reference | ≤0.4 | clinical lab reference ("should not exceed 0.4 mmol/L following an overnight fast") | Mayo Clinic Laboratories test catalogue (secondary; UNVERIFIED primary) | — |
| 21 ± 3 h | time to reach 0.5 mM | 20 adults (11 M/9 F), capillary | Deru 2021 [13] | 23.3 h (men), 19.8 h (women) |
| 24 h (from a ~630-kcal dinner) | 0.56 ± 0.28 | 27 overweight/obese adults | Deru 2024 [46] | 0.46 (overweight, IR 1.3) |
| 30 h | men 0.9 ± 0.2; women 1.7 ± 0.2; children (6 y) 3.7 ± 0.4 | 10 M, 10 F, 15 children | Haymond 1982 [12] | men 0.99; women 1.28; children not supported |
| 36 h (AUC 0–36 h) | 19.19 ± 2.59 mmol·h/L | 20 adults | Deru 2021 [13] | 15.8 (men) / 20.4 (women) |
| 48 h | lean 3.7; obese 1.9 (capillary) | 16 lean vs 16 obese | Neudorf 2025 [15] | lean man 1.87; obese (IR 1.2) 1.50 |
| 72 h | 2.3 ± 0.5 | 6 men | McDougal 2018 [14] | 2.45 |
| 3 d | 2.23 ± 0.33 (BHB), TKB 3.06 | 8 obese | Owen & Reichard 1971 [6] | obese 1.96 |
| ~5 d | kinetics begin to plateau | normal subjects | Balasse & Féry 1989 [4] | — |
| 17 d | FFA, BHB, AcAc reach plateau | 11 obese | Owen 1969 [8] | — |
| 24 d | BHB 5.29 ± 0.47, AcAc 1.52 (TKB 6.8) | 8 obese | Owen & Reichard 1971 [6] | obese 4.99 (TKB 6.44) |
| plateau (≥3 d) | TKB 7.09 ± 0.32 mM; production 1908 ± 80 µmol/min; urine 167 ± 14 µmol/min | 23 obese | Balasse 1979 [3] | TKB 6.44; P 1.84 mmol/min |

**Moderators (quantified).**
- **Sex:** at 30 h women 1.7 vs men 0.9 mM (Haymond 1982 [12]); glucose lower in women (64 vs 72 mg/dL). Model handles this via smaller glycogen capacity relative to fixed brain glucose demand (reproduces only ~35–40% of the difference: 1.28 vs 0.99 mM; an optional female production multiplier of ~1.3 would close the gap but has no mechanistic source — grade C).
- **Children:** 3.7 mM at 30 h (6-year-olds, Haymond 1982 [12]); neonates/infants ketone flux 17–21 µmol·kg⁻¹·min⁻¹ (Bougnères 1986, PMC423306 [106]). **The model is not valid for children** (it under-predicts by ~2×); the app should not simulate under-18s.
- **Adiposity / insulin resistance:** obesity blunts fasting ketosis despite similar FFA rise: 48-h capillary BHB 1.9 (obese) vs 3.7 mM (lean), with relative hyperinsulinaemia (Neudorf 2025 [15]). Model: `IR` 1.2–1.4 gives obese/lean ratio 0.68–0.80 at 48 h (under-captures the observed 0.51) — grade C.
- **Age:** older (>50 y) overweight sedentary adults reached only 0.31 ± 0.21 mM after a 24-h fast begun with an 84-g-carbohydrate shake, vs 0.50 ± 0.28 after a 6-g-carbohydrate shake (0.54 at 12 h) (Gipson 2025 [47]).
- **Prior meal composition:** a low-carbohydrate pre-fast meal advances ketosis by ~12 h in older adults (Gipson 2025 [47]).
- **Exercise at the start of a fast:** time to 0.5 mM 17.5 ± 1.7 h vs 21.1 ± 3.0 h; BHB AUC 27.5 vs 19.2 mmol·h/L; glucagon and insulin/glucagon ratio changed (Deru 2021 [13]).

**Evidence grade: A** for the time course (multiple controlled human studies); **B** for moderators.

### 4.7 Very-low-carbohydrate diets: time to ketosis and steady-state dose-response

**Mechanism.** With food present, ketogenesis is restrained by (a) meal-driven insulin pulses (antilipolysis), (b) hepatic glycogen partly maintained by dietary carbohydrate and gluconeogenesis from protein/glycerol, (c) energy supply. The result is that eucaloric ketogenic diets give ~0.5–1 mM morning BHB — far below the 2–5 mM of fasting — and BHB falls steeply as carbohydrate rises from ~20 to ~125 g/day.

**Observed data (all morning fasting values unless noted).**

| Study | Population | Carbohydrate | Protein | Energy status | Duration | BHB result |
|---|---|---|---|---|---|---|
| Hall 2016 / Rosenbaum 2019 [18,19] | 17 men, BMI 25–35, metabolic ward | 5% of energy (≈34 g/day at ~2,700 kcal; DERIVED) | 15% (≈100 g) | "isocaloric" but actual deficit ≈300 kcal/day | 4 wk | weeks 3–4: 0.77 ± 0.49 and 0.77 ± 0.45 mM (baseline diet 0.09–0.11); AcAc 0.81–0.83; FFA 0.76–0.84 mM |
| Harvey 2019 (Nutrition X) [22] | 77 healthy adults (25 M/52 F), 39 y, BMI 27 | 5% / 15% / 25% of energy | 1.4 g/kg advised | prescribed near-maintenance (lead-in intake) | 3 wk (daily waking capillary) | mean increase 0.62 ± 0.49 / 0.41 ± 0.38 / 0.27 ± 0.32 mM; only 5% arm had 95% CI consistently ≥0.5; 15–25% arms can reach mean ≥0.5 "sporadically" |
| Harvey 2018 (J Nutr Metab) [21] | 28 healthy adults (almost all women) | 3–6% of 1,800 (F)/2,200 (M) kcal (≈14–33 g; DERIVED) | 1.4 g/kg | prescribed | 20 d | mean ≥0.5 mM reached on day 4 (sunflower-oil control) vs day 2 (MCT 3×30 mL/d); % reaching ≥0.5 on day 1: 0% vs 17%, day 2: 18% vs 33%; at 7 d 70% (control) vs 90% (MCT) |
| Urbain & Bertz 2016 [24] | 12 healthy, BMI 23 | 6.2% | 19.5% | ad libitum | wk 6 | 24-h range 0.33 (10:00) – 0.70 (03:00) |
| Johnstone 2008 [27] | 17 obese men, residential | 4% (≈17 g; DERIVED from 7.25 MJ/d) | 30% (≈130 g) | ad libitum, large deficit (6.34 kg lost in 4 wk) | 4 wk | plasma BHB 1.52 mM (urine 2.99 mM) |
| Veldhorst 2010 [28] | 23 normal-weight, 23 y | 0% | 30% | energy balance, after glycogen-lowering exercise | 1 day | next-morning BHB 1349 ± 653 µM vs 332 ± 102 (30% protein/40% carb) and ~230 (10% protein/60% carb) |
| Burke 2021 [32] | 7 elite male race walkers | <50 g/day | 2.2 g/kg | eucaloric, heavy training | 5–6 d | resting BHB (2 h post-meal) 1.2 ± 0.79 mM; up to 1.7 ± 0.9 during a 25-km walk |
| Hallberg 2018 (Virta) [26] | 262 adults with T2D, BMI 40 | <30 g/day typically; titrated | 1.5 g/kg reference BW | ad libitum, weight −13.8 kg/1 y | 1 y | lab BHB 0.17 → 0.54 ± 0.04 (70 d) → 0.31 ± 0.03 (1 y); 96% had ≥1 home reading ≥0.5 |
| Kephart 2018 [107] | 12 CrossFit trainees | self-selected ketogenic | — | ad libitum | 12 wk | BHB 2.8–9.5-fold higher than controls (weekly) |
| Harvey 2019 PeerJ [23] | same cohort as [22] | 5/15/25% | — | ad libitum after wk 3 | 12 wk | adherence easier at 15–25%; weight −3.7 kg overall, no between-group difference |
| Hall 2021 [20] | 20 adults, inpatient | 10% of energy, ad libitum | — | ad libitum (689 ± 73 kcal/day more than low-fat diet) | 2 wk | circulating ketones 3.01 vs 0.21 mM (as reported by Fernández-Verdejo 2023 [60]; primary value not checked — UNVERIFIED) |

**Model dose-response surface (PROPOSED; 80-kg/62-kg-FFM adult, protein ≈1.3 g/kg, 3 meals, week-4 values; morning = 07:00 fasting; mean = 24-h mean).**

| Net carbs (g/day) | Eucaloric: morning / 24-h mean (mM) | 25% deficit: morning / 24-h mean | Day first morning ≥0.5 (eucal / deficit) |
|---|---|---|---|
| 0 | 0.71 / 0.53 | 1.26 / 0.92 | 2 / 1 |
| 20 | 0.67 / 0.45 | 1.11 / 0.74 | 2 / 2 |
| 30 | 0.64 / 0.43 | 1.04 / 0.68 | 2 / 2 |
| 50 | 0.59 / 0.37 | 0.91 / 0.56 | 3 / 2 |
| 75 | 0.51 / 0.31 | 0.74 / 0.44 | 8 / 3 |
| 100 | 0.43 / 0.25 | 0.60 / 0.34 | never / 4 |
| 130 | 0.33 / 0.18 | 0.44 / 0.24 | never / never |
| 175 | 0.10 / 0.06 | 0.14 / 0.07 | never / never |

Implementation note: the surface is an *output* of the mechanistic model, not an input. It shows (i) a soft threshold around 50–100 g/day (weight- and activity-dependent), (ii) that a 25% energy deficit raises BHB ~1.6–1.8×, (iii) that ≥0.5 mM morning values are reached in 1–3 days at <50 g/day. Full fasting reaches 0.5 mM in ~20–25 h.

**Time dynamics.** First entry (eucaloric, <30 g/day): morning BHB ~0.3 (day 1), ~0.5 (day 2), then a slow creep over 1–3 weeks (A_f then A_s); Harvey 2018 reports symptom resolution by day 4–5 when mean BHB was 0.8–0.9 mM [21].

**Evidence grade: B** (several controlled trials; dose-response at 50–130 g relies mainly on one RCT [22] and the model).

### 4.8 Does high protein (≥2 g/kg) lower ketones?

- **For suppression:** Hall's validated model encodes that a protein-modified fast halves ketonaemia relative to total fasting (kP = 0.69) [1]; protein is insulinogenic and supplies gluconeogenic carbon. Whittaker & Harris (2022 meta-analysis) found high-protein (≥35%) low-carb diets lower testosterone — unrelated to ketones but shows high-protein LC diets differ endocrinologically [104].
- **Against strong suppression:** 30% protein diets still produced 1.35–1.52 mM (Veldhorst 2010 [28]; Johnstone 2008 [27]); 2.2 g/kg in athletes gave 1.2 mM (Burke 2021 [32]); at 40% carbohydrate, 30% protein raised BHB slightly vs 10% protein (332 vs ~230 µM) [28]. No human RCT isolating protein dose at fixed (<50 g) carbohydrate and energy was found — **open question**.
- **Model:** `π = exp(−0.15·P_ew/90)`; predicted week-4 morning BHB at 30 g carb, eucaloric: 60 g protein 0.74; 100 g 0.65; 140 g 0.59; 180 g 0.54 mM (i.e. ≈ −25% from 0.75 to 2.2 g/kg). **Grade C.**

### 4.9 Exit from ketosis, re-entry, and cyclical patterns

**Mechanism.** A carbohydrate load raises insulin within ~30 min → FFA falls to ~0.1 mM (antilipolysis) → hepatic production collapses; clearance continues with t½ ≈ 20–30 min at <2 mM, so BHB halves within ~1 h. Liver (and muscle) glycogen refilled by the carbohydrate then delays re-accumulation. Muscle fat-oxidation adaptation (A_f) persists for >24 h after carbohydrate restoration (Burke 2021 [32]; Carey 2001 [33]; Stellingwerff 2006 [34]).

**Observed exit data (Deru 2024 [46], 27 overweight/obese sedentary adults, 24-h fast interrupted by a shake = 25% of daily energy ≈ 629 ± 103 kcal; HC/LF 70% carbohydrate as dextrose (≈110 g; DERIVED), 20% casein protein, 10% fat; LC/HF 10% carbohydrate, 20% protein, 70% fat of which half MCT powder):**

| Condition | 24 h (pre-shake) | 25 h | 28 h | 38 h (next morning) |
|---|---|---|---|---|
| Water only | 0.56 ± 0.28 | 0.63 ± 0.31 | 0.70 ± 0.42 | 0.85 |
| HC/LF shake | 0.59 ± 0.28 | **0.28 ± 0.19** | **0.19 ± 0.16** | 0.44 ± 0.28 |
| LC/HF shake | 0.53 ± 0.29 | 0.44 ± 0.16 | 0.38 ± 0.16 | 0.51 ± 0.27 |

→ A ~110 g carbohydrate load **halves BHB in 1 h and brings it to ~1/3 of pre-load by 4 h; 14 h later BHB has re-accumulated to ~75% of the pre-load value** (still <0.5 on average). Model (IR 1.3): HC 0.46 → 0.18 → 0.09 → 0.46; LC/HF 0.46 → 0.46 → 0.39 → 0.84 (the model is ~10–20 percentage points too fast at 1–4 h and over-predicts LC/HF recovery — tolerance ±0.15 mM).

**Model predictions for keto-adapted users (80 kg; 4 weeks <30 g/day; morning BHB 0.66 mM) — PROPOSED, no direct human data found:**

| Perturbation | BHB response |
|---|---|
| Single 100-g carbohydrate lunch | 0.44 → 0.19 (1 h) → 0.11 (3 h) → 0.23 (6 h) → 0.31 (12 h); next morning 0.48, back to 0.61 by day 2 |
| One full high-carb day (300 g) | next morning 0.18; day 2: 0.46; day 3: 0.59 (≈90% of pre-refeed); A_f falls 0.97 → 0.59 |
| Cyclical 5 d at 30 g + 2 d at 350 g (weekly) | each low-carb block: 0.11 → 0.35 (day 1) → 0.55 (day 2) → 0.58–0.61 (days 3–5); refeed mornings 0.11–0.13; A_f oscillates 0.34–0.89 |

**Re-entry vs first entry.** In the model re-entry after a 1–2-day refeed takes ~2 days (vs 2–3 days for first entry) because (i) liver glycogen must be drained again (dominant), (ii) A_f decays only partially (τ 40 h). Human data specific to re-entry: none located (open question). Cyclical ketogenic diets in trained men (5 d ≤30 g carbohydrate, 1.6 g/kg protein; 2 d 8–10 g/kg carbohydrate; −500 kcal/day; 8 weeks) produced similar weight loss to a balanced reduction diet but no strength/endurance gains and a small lean-mass/body-water loss (Kysel 2020 [105]) — ketone trajectories were not reported.

**Evidence grade:** exit kinetics **B** (one well-controlled crossover plus tracer physiology); re-entry/cycling **C/D** (model extrapolation).

### 4.10 Exercise

**Mechanisms and data.**
1. **During exercise (overnight-fasted, low ketones):** ketone turnover +125% after 2 h at ~50% VO2max, MCR up, TKB 0.20 → 0.39 mM (Féry & Balasse 1983 [37]); when basal ketonaemia <0.6 mM, exercise raises production and MCR 40–50%; stimulatory effects wane above 2.5 mM and are abolished/reversed above 3–4 mM (Féry & Balasse 1986 [38]; 1988 [39]).
2. **During exercise (fasted 3+ days, high ketones):** TKB falls ~20% (Ra −22%, Rd +30% initially; 17.6% → 10.1% of CO2 from ketones) — exercise energy comes mainly from other fuels (Balasse, Féry & Neef 1978 [40]). Ketone oxidation provides 2–10% of energy during exercise after an overnight fast and is negligible at >2.5 mM fasting ketosis (review, Evans 2017 [41]).
3. **Post-exercise ketosis:** +0.73 mM within 30 min of stopping (MCR falls below pre-exercise while ketogenesis stays high) (Féry & Balasse 1983 [37]); generally 0.3–2.0 mM depending on intensity, duration, fitness and nutrition; blunted (not abolished) in trained individuals; abolished by prior carbohydrate feeding (Evans 2017 review of Johnson 1969/1972, Rennie 1974, Koeslag 1980 [41,108]).
4. **Accelerated entry:** aerobic exercise at the start of a 36-h fast shortened time to 0.5 mM by 3.6 h (95% PPI −2.1 to 10.9) and raised BHB AUC 43% (Deru 2021 [13]); one day of a carbohydrate-free, 30%-protein diet preceded by glycogen-lowering exercise gave 1.35 mM next morning (Veldhorst 2010 [28]); lean subjects adjust fat oxidation to fat intake within a 36-h chamber stay only when glycogen was first lowered by exhaustive exercise (Schrauwen 1997 [85]).
5. **Trained athletes on LCHF:** 1.2 mM at rest and up to 1.7 mM in a 25-km walk after 5–6 days (Burke 2021 [32]).

**Model implementation:** see §4.1 (M_ex), §4.3 (ex_F, X_post, k_mgF), §4.4 (ex_gly, muscle glycogen use/resynthesis). Model results: Féry-1983 protocol TKB 0.17 → 0.51 (end of 2 h) → 0.91 (30 min recovery); Deru-2021 protocol (1 h at 65% after dinner absorption) t0.5 22.2 → 18.7 h; Burke-2021 protocol 1.04 mM; a sedentary adult starting <30 g/day with 1 h/day at 65% VO2max: mornings 0.37, 0.68, 0.84, 1.0, 1.15 mM (days 1–5) vs 0.32, 0.52, 0.56, 0.58, 0.60 without exercise. Veldhorst-2010 target under-predicted (0.54 vs 1.35).

**Evidence grade: B** for direction and acute magnitudes; **C** for the multi-day exercise × diet interaction.

### 4.11 Keto-adaptation (fast and slow state variables)

**4.11.1 Fast adaptation `A_f` (days) — muscle fat-oxidation retooling + hepatic induction.**
```
fC     = 4·C24 / max(EI24, 500)                (carbohydrate share of the last 24 h energy; fasting → 0)
A_f*   = 1 / (1 + (fC/0.20)^3)                 (≈ 1/(1+(C24/100 g)^3) at 2,000 kcal; calibration used C50 = 100 g/day)
dA_f/dt = (A_f* − A_f)/τ,  τ = 48 h if A_f* > A_f else 40 h
Effects: hepatic partition × (1 + 0.35·A_f);  exercise max fat oxidation × (1 + 1.3·A_f);
         max CHO oxidation at high intensity × (1 − 0.3·A_f);  O2 cost at >75% VO2max × (1 + 0.07·A_f)   (→ dossiers 10/19)
```
| Datum | Value | Source |
|---|---|---|
| Fat oxidation after 5–6 d LCHF (<50 g carb, 2.2 g/kg protein) | >200% increase; mean ≈1.43 g/min; O2 cost +8% and +5% at 50-km and 20-km race speeds | Burke 2021 [32] |
| 3 wk LCHF (<50 g, 78% fat) | peak fat oxidation 1.57 ± 0.32 g/min at ~80% VO2peak; 10-km performance not improved (HCHO +6.6%, periodised +5.3%) | Burke 2017 [31] |
| Habitual LC (10% carb, 20 months, 9–36) vs HC ultra-athletes | peak fat oxidation 1.54 ± 0.18 vs 0.67 ± 0.14 g/min, at 70.3 ± 6.3 vs 54.9 ± 7.8% VO2max; submaximal 1.21 vs 0.76 g/min (88 vs 56% of energy); resting muscle glycogen, −64% after 180 min and −36% after 120 min recovery similar between groups | Volek 2016 [30] |
| Time course (non-ketogenic high-fat, 69% fat) | shift CHO→fat oxidation within 5–10 d; not further enhanced to 15 d; CAT activity 0.45 → 0.54 µmol/g/min by day 10; muscle glycogen oxidation 1.5 → 1.0 g/min | Goedecke 1999 [35] |
| Persistence after CHO restoration | after 24 h high CHO: fat oxidation still elevated, CHO oxidation only 61% and 78% of baseline at race-relevant speeds; substrate use back to baseline after 5–6 d HCHO | Burke 2021 [32] |
| Persistence (non-ketogenic, 6 d fat-adapt + 1 d CHO) | RER 0.78 (fat-adapt, day 8) vs 0.85; fat oxidation 171 vs 119 g during 4 h cycling after CHO restoration | Carey 2001 [33] |
| Mechanism | PDH activity lower (1.69 vs 2.39 mmol·kg ww⁻¹·min⁻¹), glycogenolysis lower, HSL +20% after 5 d fat + 1 d CHO | Stellingwerff 2006 [34] |
| 4-wk ketogenic diet, trained cyclists | endurance time 147 → 151 min at 62–64% VO2max; RQ 0.83 → 0.72; glucose oxidation 15.1 → 5.1 mg/kg/min; muscle glycogen use 0.61 → 0.13 mmol/kg/min | Phinney 1983 [29] |
| Long-term LCHF cyclists (>8 months) | lower glucose production and hepatic glycogenolysis (exercise EGP 6.0 vs 7.8 mg/kg/min), unchanged gluconeogenesis (2.8 vs 2.5) | Webster 2016 [36] |

→ τ_up = 48 h gives 92% adaptation at 5 d (matches [32,35]); τ_down = 40 h gives ~55% remaining after 24 h (matches partial restoration [32,33]) and 5% at 5 d (matches full reversal by 5–6 d [32]). **Grade B** (time constants), **C** (effect multipliers).

**4.11.2 Slow adaptation `A_s` (weeks) — ketone-kinetics adaptation.**
```
A_s* = clamp((TKB − 0.5)/2.0, 0, 1);   dA_s/dt = (A_s* − A_s)/120 h
Effects: clearance × (1 − 0.35·A_s);  hepatic partition × (1 + 0.5·A_s)
```
Data: muscle (forearm) extraction of AcAc 40% → 25% → 11% and of BHB 12% → 4% → net release at overnight / 3-day / 24-day fasting; FFA become the principal muscle fuel by 24 d (Owen & Reichard 1971 [6]); MCR −35% in fasted vs acutely infused at the same concentration (Balasse 1979 [3]); plateau of BHB/AcAc/FFA only after 17 d (Owen 1969 [8]); Balasse & Féry attribute most of the MCR fall to saturation of muscle uptake, with the hormonal milieu playing "only a minor role" [4] — **contested; grade C**. On eucaloric ketogenic diets (TKB ~1 mM) A_s stays ≲0.1 in the model, i.e. the "ketone-sparing muscle" phenomenon is essentially a prolonged-fasting phenomenon; claims that it occurs on nutritional ketosis are not supported by located human tracer data (grade D).

**4.11.3 Brain ketone use vs BHB (output metric).**
`f_brain_ket = 0.70 · TKB/(TKB + 1.5)` — PROPOSED FIT to: MCT-induced mean TKB 0.29 mM → estimated 8–9% of brain energy (Courchesne-Loyer 2013 [56]); 4-day ketogenic diet (8-fold ketone rise) → CMR_AcAc 17% and total ketones ≈33% of brain energy, with CMRa correlated with plasma ketones r = 0.93 (Courchesne-Loyer 2017 [57]); cerebral ketone utilisation rises nearly proportionally with plasma ketones in the 0.7–1.7 mM range, transport being rate-limiting (Blomqvist 2002 [58]); ketones the "predominant" brain fuel after 5–6 weeks of starvation (Owen 1967 [9]; the frequently quoted ~60–70% share is UNVERIFIED here). **Grade C.**

**4.11.4 Optional very slow state `A_L` (months).** Muscle glycogen normalises on long-term LCHF (Volek 2016 [30]); glucose tolerance may worsen with >6 months LCHF (Webster 2020, as summarised by Burke 2021 [32]; primary not checked). Suggested τ ≈ 4 weeks, effect on 04's glycogen set-point only. **Grade D.**

**Urinary ketones decline with adaptation.** Urinary loss is <10% of turnover under physiological conditions [4] and depends on the renal threshold (model: renal clearance above 1 mM). Stable dieters at week 6 still show ketonuria (>90% detection at 07:00/22:00/03:00) (Urbain 2016 [24]); 97% of days had positive urine ketones over a 6-week ketogenic diet (Urbain 2017 [25]). The widely repeated claim that urine strips turn negative after "keto-adaptation" despite blood ketosis could not be verified with human data (UNVERIFIED).

### 4.12 MCT and exogenous ketones

```
P_MCT = m_meal · (0.5 · 6.37 · Ra_C8 + 0.17 · 5.41 · Ra_C10) / 60      [mmol TKB/min; Ra in g TG/h]
        6.37 and 5.41 = mmol fatty acid per g tricaprylin / tricaprin (DERIVED from molecular weights 470.7 and 554.8)
        m_meal = 0.5 if a meal >50 g within the previous 3 h, else 1
P_exo = (absorbed D-BHB, mmol/min) · (1.0 fasted; 0.75 fed);  kernel peak 0.5 h fasted, 0.75 h fed; salts count 50% (L-isomer)
```
| Datum | Value | Source |
|---|---|---|
| Relative ketogenicity | C8 ≈3× C10 ≈6× C12; plasma ketone response ~2-fold higher without an accompanying meal | St-Pierre 2019 [54] |
| 2 × 20 mL C8 (with breakfast; 4 h later without lunch) | day-long mean +295 ± 155 µM TKB above control; coconut oil peak +200 µM (25% of C8 peak) | Vandenberghe 2017 [55] — model +0.29 mM |
| 20 → 30 g/day MCT, 4 doses, 4 wk | TKB peak 476 µM, day mean 290 µM | Courchesne-Loyer 2013 [56] |
| 48 g MCT vs 45 g LCT | BHB ~0.6 mM vs no change | Seaton, as reported in Fernández-Verdejo 2023 [60] |
| MCT 3×30 mL/day on a ketogenic diet | +0.2 ± 0.7 (days 1–6), +0.8 ± 0.7 mM (days 7–19) morning BHB; GI pain more frequent | Harvey 2018 [21] — model only +0.10 (**known miss**) |
| MCT tolerance | 50–60 g doses caused GI distress in 100% (Ivy et al., cited in [21]); ~30 g/dose usually tolerated | [21] |
| Ketone ester ~12 or ~24 g BHB | D-BHB Cmax 2.8 mM (ester) vs 1.0 mM (salts); baseline in 3–4 h; food lowers Cmax 33% (fed 2.2 vs fasted 3.3 mM); urinary loss <1.5% of dose | Stubbs 2017 [50] |
| Ketone ester 140/357/714 mg/kg | Cmax BHB 3.30 mM, AcAc 1.19 mM at 714 mg/kg within 1–2 h; BHB elimination t½ 0.8–3.1 h | Clarke 2012 [51] |
| Ketone ester 0.45 mL/kg, 30 min before 75-g OGTT | BHB 3.2 ± 0.6 mM within 30 min; glucose AUC −17%, NEFA AUC −44% | Myette-Côté 2018 [53] |
| Ketone ester 1.9 kcal/kg | BHB 0.2 → 3.3 mM at 60 min; lower ghrelin, hunger and desire to eat 1.5 h later vs dextrose | Stubbs 2018 [109] |
| Ketone ester in athletes | ketosis decreased muscle glycolysis and plasma lactate and increased intramuscular TG oxidation, even with co-ingested carbohydrate | Cox 2016 [52] |
| Model: 25 g BHB ester fasted | 2.08 (0.5 h) → 3.26 (1 h) → 1.95 (2 h) → 0.28 (4 h) | — |

**Evidence grade: B** (PK well characterised; chronic MCT effect uncertain).

### 4.13 Transition symptoms ("keto flu"), natriuresis and water

- **Symptoms:** commonest reports "flu", headache, fatigue, nausea, dizziness, "brain fog", GI discomfort, reduced energy, faintness, palpitations; reports peak in week 1 and dwindle after 4 weeks; resolution reported between days 3 and 30 (median 4.5, IQR 3–15; n = 8 users); severity mild 15/60, moderate 23/60, severe 22/60 users (online-forum analysis, Bostock 2020 [63] — **low-quality evidence**). In an RCT, symptom sums rose in all low-carb arms (5%/15%/25% energy: +1.49 ± 2.47, +0.65 ± 2.70, +0.18 ± 3.3; p = 0.26); headache, constipation, diarrhoea, halitosis, cramps, weakness and light-headedness increased slightly; sugar/starch craving and bloating improved (Harvey 2019 [22]). Symptoms ameliorated by day 4 (MCT) to day 5 (control) when mean BHB was 0.8–0.9 mM (Harvey 2018 [21]).
- **Model output (PROPOSED, grade C):** `KetoFlu(t) = S_max · A_trans(t) · (1 − BHB_n)`, where `A_trans = max(0, A_f − A_f(t−72 h))` (recent rapid adaptation) and `BHB_n = min(1, BHB/0.8)`; peak ≈ day 2–3, resolved by ≈ day 5–7 for most, prolonged when intake oscillates (cycling restarts the transition).
- **Natriuresis/water (coordinate with 13/15):** insulin fall is the key driver of fasting natriuresis (Kolanowski 1981 [65]; also Veverbrants & Arky 1969 [64]); glucagon enhances renal ketone and sodium loss. Glycogen is stored with 3–4 g water per g and 0.45 mmol K/g, so glycogen depletion produces rapid early weight loss and carbohydrate reloading rapid regain (Kreitzman 1992 [66]). Specific mmol/day sodium figures from the fasting literature could not be extracted from primary texts here (UNVERIFIED — dossier 15 owns them).

### 4.14 Does ketosis *per se* change appetite, protein balance, EE or fat loss?

| Question | Best evidence | Quantitative estimate | Grade |
|---|---|---|---|
| Appetite | Meta-analysis (VAS, before vs during ketosis): VLED → less hunger, more fullness; ketogenic low-carb diets → less hunger and lower desire to eat; absolute changes "small", main benefit = preventing the usual rise in appetite during weight loss (Gibson 2015 [59]; pooled mm values not accessible — UNVERIFIED). Inpatient ad libitum crossover: low-fat diet produced 689 ± 73 kcal/day **less** intake than an animal-based ketogenic diet over 2 wk (544 ± 68 in week 2) (Hall 2021 [20]). Residential ad libitum crossover in obese men: ketogenic (4% carb, 30% protein) 7.25 vs 7.95 MJ/day on 35% carb, lower hunger, weight −6.34 vs −4.35 kg in 4 wk (Johnstone 2008 [27]). Exogenous ketone ester acutely lowers ghrelin/hunger (Stubbs 2018 [109]). | Model a *small* hunger-suppression term: hunger × (1 − 0.15·min(1, BHB/1.0)) (PROPOSED; → dossier 12). Do **not** model a large intake reduction from ketosis per se. | C |
| Protein sparing | Ketone (Na-BHB) infusion lowered plasma alanine 21–37% and urinary N by 30% in 5–10-wk fasted subjects (Sherwin 1975 [67]); BHB infusion reduced leucine oxidation ~30% and raised muscle protein synthesis ~10% (Nair 1988 [68]). But at equal protein & energy (600 kcal, 8 g N/day, 4 wk, metabolic ward) the ketogenic VLCD produced **more** negative N balance (−50.4 ± 4.4 vs −18.8 ± 5.7 g over 4 wk) (Vazquez & Adibi 1992 [69]); Hall 2016 KD coincided with increased protein utilisation and FFM loss [18]; 1.5 g/kg vs 0.8 g/kg + 0.7 g/kg carb at 500 kcal: N balance 0 vs −2 g/day after 3 wk (protein dose matters more) (Hoffer 1984 [70]). | No net protein-sparing credit for ketosis at matched protein; transient extra N loss in week 1–2 of carbohydrate withdrawal (→ 03). | B |
| Energy expenditure | Isocaloric KD: chamber EE +57 ± 13 kcal/day, sleeping EE +89 ± 14, DLW +151 ± 63 kcal/day, RQ −0.111; body-fat loss slowed (Hall 2016 [18]); chamber TEE ~+100 kcal/day transient over the first 2 wk then returned to baseline (per Fernández-Verdejo 2023 [60]). Meta-analysis of 32 isocaloric feeding studies: EE +26 kcal/day and fat loss +16 g/day with **lower-fat** diets (Hall & Guo 2017 [61]). Weight-maintenance RCT: TEE +52 kcal/day per 10% decrease in carbohydrate (95% CI 23–82); low (20%) vs high (60%) carb +209 kcal/day (91–326) ITT (Ebbeling 2018 [62]) — contested (see §8). | Transient +50–100 kcal/day for ~2 weeks after carbohydrate withdrawal, decaying to ~0 (→ 02). Energy cost of ketogenesis via ε_k = 0.81 (Hall 2010 [1]). | B (contested) |
| Fat loss at equal kcal & protein | Carbohydrate restriction increased fat oxidation but lost 53 ± 6 g fat/day vs 89 ± 6 g/day with fat restriction over 6 days (Hall 2015 [80]); pooled +16 g/day favouring lower-fat (Hall & Guo 2017 [61]). | No fat-loss advantage from ketosis at equal energy/protein; small short-term disadvantage (→ 01/04). | A− |

### 4.15 Whole-body dietary fat handling

**4.15.1 Absorption and storage efficiency.** Dietary long-chain fat is ~95% absorbed (Atwater-based convention; Southgate & Durnin 1970 [110] — exact coefficient UNVERIFIED here; coordinate with 01/15). Absorbed fat is stored with very little energetic cost (no conversion step), unlike carbohydrate converted by DNL (→ 04/11).

**4.15.2 Fat balance and "fat oxidation as the residual fuel" (Flatt).**
```
FatBalance_day = FatAbsorbed + DNL_fat − FatOx
FatOx (kcal/day) = TEE − CarbOx − ProtOx − AlcoholOx − KetoneLoss_urine      (identity; CarbOx, ProtOx from 04/03)
Ketone flux counts inside FatOx (ketones derive from FFA). Urinary ketone energy ≈ 0.46 kcal/mmol (DERIVED from ρK 4.45 kcal/g × 0.104 g/mmol [1]).
```
Evidence: adding 106 ± 6 g/day fat (987 kcal) for 36 h did not change 24-h EE (2,783 vs 2,820 kcal) or fat oxidation (1,032 vs 1,042 kcal/day); energy balance correlated with fat balance (r = 0.96) not carbohydrate balance (Schutz 1989 [78]). Fat oxidation is regulated primarily by the carbohydrate economy; adjustment to fat intake occurs as fat-balance errors accumulate and alter adipose mass/FFA/insulin sensitivity (Flatt 1995 [79]). On day 7 of a high-carbohydrate diet carbohydrate oxidation matched intake (slope 0.99), but on a high-fat diet fat oxidation vs intake slope was only 0.50 (lean only; none in obese) (Thomas 1992 [83]); substrate oxidation shifts "rapidly" toward diet composition within 7 days (Hill 1991 [84]); a switch from 37% to 50% fat for 4 days caused positive fat balance predicted by insulin and VO2max (Smith 2000a [81]); concurrent physical activity (1.8 vs 1.4 × RMR) sped the fall in 24-h RQ (Smith 2000b [82]); exhaustive glycogen-lowering exercise allowed fat oxidation to match fat intake within a 36-h chamber stay (Schrauwen 1997 [85]).

**PROPOSED FIT (grade C):** when fat intake share rises, fat oxidation approaches intake with τ_FO ≈ 3–5 days in sedentary lean adults, ≈1 day after glycogen-depleting exercise, and incompletely (slope ~0.5 at 7 d) in obese/insulin-resistant people. In an engine that already computes CarbOx from glycogen (04), this τ emerges automatically and need not be imposed.

**4.15.3 Postprandial lipaemia and meal-fat fate.**
- Triglycerides after habitual meals: maximal mean change +0.3 mmol/L at 1–6 h (Nordestgaard 2016 [90]). Standardised fat-tolerance test (75 g fat, 25 g carbohydrate, 10 g protein): a single TG sample at 4 h is representative; desirable peak ≤2.5 mmol/L (Kolovou 2011 [91]). PROPOSED: ΔTG(t) = 0.01 mmol·L⁻¹·g⁻¹ × fat_g × k(t), where k is a shape-3 gamma curve normalised to a peak of 1 at 3.5 h (≈ +0.3 mM for a 30-g-fat meal, +0.75 mM for the 75-g fat-tolerance test), returning to baseline by ~8 h (→ 06 owns lipids).
- 24 h after a mixed meal, the fraction of meal fat found in subcutaneous adipose tissue: women 38 ± 3%, men 24 ± 3% (Romanski 2000 [89]); dietary (chylomicron) fatty acids are preferentially taken up by adipose and muscle vs plasma NEFA (Bickerton 2007 [88]); abdominally obese men show markedly impaired adipose storage of meal fat, a putative driver of ectopic fat (McQuaid 2011 [87]); adipose tissue buffers daily lipid flux by suppressing NEFA release and trapping LPL-derived fatty acids (Frayn 2002 [86]). Effect of one meal's fat on the next meal ("second-meal"/spillover) — qualitative only here (UNVERIFIED magnitude).

**4.15.4 Maximal rates.**
- Exercise maximal fat oxidation (MFO): 300 healthy adults — 7.8 ± 0.13 mg·kg FFM⁻¹·min⁻¹ at 48.3 ± 0.9% VO2max; men 7.4 vs women 8.3 mg·kg FFM⁻¹·min⁻¹; Fatmax 45 vs 52% VO2max; body fatness not a predictor (Venables 2005 [92]). 1,121 athletes: 0.59 ± 0.18 g/min (0.17–1.27) at 49.3 ± 14.8% VO2max; men 0.61, women 0.50 g/min (Randell 2017 [93]). Keto-adapted: 1.43–1.57 g/min [30–32].
  `MFO (g/min) = 0.0078 · FFM · s_sex · (1 + 0.3·Fit) · (1 + 1.3·A_f)` with s_sex = 0.95 (M) / 1.06 (F), Fit ∈ [0,1] training status (PROPOSED; grade B for base, C for multipliers).
- Rest/fasting lipolysis: glycerol Ra 2.08 → 4.36 µmol·kg⁻¹·min⁻¹ from 12 to 72 h of fasting (Klein 1993 [16]) ≈ 190 → 400 g TG/day for 75 kg (DERIVED).
- Upper limit of energy transfer from the fat store in hypophagia: 290 ± 25 kJ·kg fat⁻¹·day⁻¹ (≈69 kcal·kg fat⁻¹·day⁻¹, DERIVED); deficits beyond this deplete FFM (Alpert 2005 [94]; → 01 owns the implementation).

**Evidence grade:** fat-balance physiology **A−**; adaptation τ **C**; MFO **A** (base) / **B** (keto-adapted).

### 4.16 Minimum fat intake constraints

| Constraint | Threshold / effect | Source | Grade |
|---|---|---|---|
| Essential fatty acids | AI linoleic acid 17 g/day (men) / 12 g/day (women); α-linolenic acid 1.6 / 1.1 g/day | IOM/NASEM 2005 DRI [95] (values confirmed via secondary citation PMC5579635) | A (reference values) |
| Fat-soluble vitamin & carotenoid absorption | 3 g vs 36 g fat with a meal did not change vitamin E (+20% vs +23%) or α/β-carotene response, but lutein-ester response 88% vs 207% (Roodenburg 2000 [96]); salads with 0 g oil → negligible carotenoid absorption; 6 g < 28 g canola oil (Brown 2004 [97]) | [96,97] | B |
| Gallstones during rapid weight loss | VLCD with 3.0 g vs 12.2 g fat/day (535–577 kcal, 3 mo): gallstones 6/11 (54.5%) vs 0/11 (Festi 1998 [98]); 520 kcal <2 g fat/day vs 900 kcal 30 g fat/day incl. one 10-g-fat meal (maximal gallbladder emptying): gallstones 4/6 vs 0/7 (Gebhard 1996 [99]); meta-analysis: higher-fat weight-loss diets RR 0.09 (95% CI 0.01–0.61); UDCA RR 0.33 (0.18–0.60) (Stokes 2014 [100]); VLCD (500 kcal) vs LCD (1,200–1,500 kcal): symptomatic gallstones HR 3.4 (1.8–6.3), 152 vs 44 per 10,000 person-years (Johansson 2014 [101]) | [98–101] | B |
| → Rule | During deficits producing >~1 kg/week loss, require ≥1 meal/day with ≥10 g fat and total ≥12 g fat/day (PROPOSED from [98,99]) | — | B− |
| Sex hormones (men) | Low- vs high-fat diets: total testosterone SMD −0.38 (95% CI −0.75 to −0.01), free T −0.37 (−0.63 to −0.11), DHT −0.30; stronger in European/North American men (−0.52); 6 studies, n = 206 (Whittaker & Wu 2021 [102]; corrigendum published 2025, content not reviewed). Contrary: 11 RCTs, n = 888 — no significant difference in testosterone, estradiol, SHBG etc. between low-fat (≤30% energy) and high-fat diets; low certainty (Soltani 2025 [103]). | Model at most a small effect: total T −5 to −10% when fat <20% of energy for ≥4 wk (PROPOSED; → 12) | C (contested) |

### 4.17 Reference implementation of the ketone sub-model (TypeScript-style pseudo-code)

This is a line-by-line transcription of the calibrated reference model (Python, 5-min Euler) that produced every "model" number in this dossier. When dossier 04 supplies `G_L`, `G_M`, `I`, replace the fallback blocks marked `FALLBACK`, then re-check §7 targets (retune `kP`, `G50` only).

```ts
// ---- parameters (final calibration) ----
const K = {
  VdPerBW: 0.25, clFFM: 0.0134, Km: 6.0, a_m: 0.35, renal: 0.00025, T_thr: 1.0,          // clearance
  kP: 0.010, F_hep: 0.15, phi_min: 0.12, G50: 55, nG: 2.5, kI_hep: 0.15,                // production
  a_h: 0.35, a_hs: 0.5, k_prot: 0.15, P_ref: 90, tauProt: 8,
  F0: 0.50, tauF_up: 1.0, tauF_down: 1.5, kFB: 15, e_def: 1.5, k_mgF: 3.0,               // FFA
  ex_F: 0.4, tau_postF: 3.0, ex_CL: 1.0, post_CL: 0.6, post_dur: 2.0, ex_I: 0.3,        // exercise
  I_floor: 0.45, Iexp: 0.5, Gref: 60, a_c: 0.12, a_p: 0.04,                              // FALLBACK insulin
  Gmax: 100, f_liver: 0.30, f_gng: 0.10, k_gly: 4.5, Kgly: 10, ex_gly: 30,               // FALLBACK liver glycogen
  MGmax: 400, f_musc: 0.5, k_mgl: 3.0, mg_ex: 200,                                       // FALLBACK muscle glycogen
  C50: 100, tauAf_up: 48, tauAf_dn: 40, As_lo: 0.5, As_span: 2.0, tauAs: 120,             // adaptation
  y_C8: 0.5, y_C10: 0.17, mctMealFactor: 0.5,                                             // MCT
};
// gamma(shape 2) absorption density, area 1, peak at tpk hours
const kern = (t: number, tpk: number) => t <= 0 ? 0 : (t * Math.exp(-t / tpk)) / (tpk * tpk);

function step(s: State, inp: Inputs, body: Body, dtH = 1 / 12) {
  const { BW, FFM, IR, TEE } = body;
  const Vd = K.VdPerBW * BW, CL0 = K.clFFM * FFM, Vmax = CL0 * K.Km;           // L, L/min, mmol/min
  const Gmax = K.Gmax * FFM / 60, G50 = K.G50 * FFM / 60, Gref = K.Gref * FFM / 60, MGmax = K.MGmax * FFM / 60;
  // absorption rates (g/h) from meals in the last 12 h
  const RaC = Σ meal.netCarb * kern(t - meal.t, 0.75), RaP = Σ meal.protein * kern(t - meal.t, 1.5);
  const RaC8 = Σ meal.mctC8 * kern(t - meal.t, 1.0), RaC10 = Σ meal.mctC10 * kern(t - meal.t, 1.2);
  const C24 = carbs eaten in last 24 h (g), EI24 = energy eaten in last 24 h (kcal; 4/4/9, MCT 8.3);
  const fedRecent = a meal with >50 g macronutrients started <3 h ago;
  const x = current exercise intensity (fraction VO2max) or 0; const post = within 2 h after an exercise bout;
  // protein memory
  s.Pew += (24 * RaP - s.Pew) * dtH / K.tauProt;
  // insulin proxy (FALLBACK — prefer dossier 04)
  const Ib = K.I_floor + (1 - K.I_floor) * Math.pow(Math.min(1, s.GL / Gref), K.Iexp);
  const I = IR * (Ib + K.a_c * RaC + K.a_p * RaP) * (1 - K.ex_I * x);
  // FFA
  const lipo = 1 / (0.25 + 0.75 * Math.pow(I, 1.2));
  const d = Math.max(0, 1 - EI24 / TEE);
  s.Xpost = x > 0 ? K.ex_F * x : s.Xpost * Math.exp(-dtH / K.tau_postF);
  const dMG = Math.max(0, (0.85 * MGmax - s.GM) / (0.85 * MGmax));
  const Fstar = K.F0 * lipo * (1 + K.e_def * d) * (1 + s.Xpost) * (1 + K.k_mgF * dMG) / (1 + s.TKB / K.kFB);
  s.FFA += (Fstar - s.FFA) * dtH / (Fstar > s.FFA ? K.tauF_up : K.tauF_down);
  // liver & muscle glycogen (FALLBACK — prefer dossier 04/10)
  const sat = s.GL / (s.GL + K.Kgly);
  const outL = K.k_gly * sat * Math.max(0, 1 - RaC / 10) + K.ex_gly * x * sat;             // g/h
  const mgUse = K.mg_ex * x * x * (s.GM / MGmax);
  const mgFromCarb = K.f_musc * RaC * clamp((MGmax - s.GM) / (0.15 * MGmax), 0, 1);
  const mgFromLiver = K.k_mgl * dMG * sat;
  s.GM = clamp(s.GM + (mgFromCarb + mgFromLiver - mgUse) * dtH, 0, MGmax);
  s.GL = clamp(s.GL + (K.f_liver * RaC + K.f_gng * RaP - outL - mgFromLiver) * dtH, 0, Gmax);
  // adaptation states
  const AfStar = 1 / (1 + Math.pow(C24 / K.C50, 3));
  s.Af += (AfStar - s.Af) * dtH / (AfStar > s.Af ? K.tauAf_up : K.tauAf_dn);
  const AsStar = clamp((s.TKB - K.As_lo) / K.As_span, 0, 1);
  s.As += (AsStar - s.As) * dtH / K.tauAs;
  // hepatic production (mmol TKB/min)
  const phi = (K.phi_min + (1 - K.phi_min) / (1 + Math.pow(s.GL / G50, K.nG))) * (1 + K.a_h * s.Af) * (1 + K.a_hs * s.As);
  const hI = 1 / (1 + K.kI_hep * I);
  const piP = Math.exp(-K.k_prot * s.Pew / K.P_ref);
  let P = K.kP * FFM * (s.FFA + K.F_hep) * phi * hI * piP;
  P += (fedRecent ? K.mctMealFactor : 1) * (K.y_C8 * 6.37 * RaC8 + K.y_C10 * 5.41 * RaC10) / 60;
  P += Σ ketoneDrink.gBHB_Disomer / 104.1 * 1000 * kern(t - drink.t, drink.fed ? 0.75 : 0.5) * (drink.fed ? 0.75 : 1) / 60;
  // utilisation & excretion (mmol/min)
  let M = 1 + K.ex_CL * x / (1 + Math.pow(s.TKB / 3, 4));
  if (post && x === 0) M *= K.post_CL;
  const U = Vmax * s.TKB / (K.Km + s.TKB) * M * (1 - K.a_m * s.As);
  const Ren = K.renal * BW * Math.max(0, s.TKB - K.T_thr);
  s.TKB = Math.max(0.01, s.TKB + (P - U - Ren) * dtH * 60 / Vd);
  // outputs
  const R = 1.5 + 0.3 * s.TKB;
  return { BHB: s.TKB * R / (1 + R), AcAc: s.TKB / (1 + R), ketoneProd_mmolMin: P, ketoneUrine_mmolMin: Ren,
           brainKetoneShare: 0.70 * s.TKB / (s.TKB + 1.5), FFA: s.FFA, Af: s.Af, As: s.As };
}
```
Initial state for a habitual mixed-diet user: `TKB 0.25, FFA 0.5, GL 0.7·Gmax, GM 0.85·MGmax, Af 0, As 0, Pew = habitual protein, Xpost 0`. For a habitual very-low-carb user: run a 14-day burn-in on their stated diet before the schedule starts (recommended for every user to remove initial-condition artefacts).

---

## 5. Interactions with other subsystems

| Needs from | What | Gives to | What |
|---|---|---|---|
| 04 carbohydrate/glycogen/insulin | `G_L`, `G_M`, insulin proxy `I`, carbohydrate absorption `Ra_C` | 04 | Ketone-induced glucose sparing (brain ketone share reduces brain glucose need: glucose demand × (1 − f_brain_ket)); ketone ester lowers OGTT glucose AUC 17% [53] |
| 01 energy balance / body composition | TEE, energy intake, FFM, FM, lipolysis limit (Alpert) | 01 | Ketone energy lost in urine (≈0.46 kcal/mmol); ketogenesis inefficiency (ε_k 0.81 [1]); fat oxidation identity |
| 03 protein/MPS | protein intake timing (`Ra_P`) | 03 | No protein-sparing credit for ketosis at matched protein; flag early carbohydrate-withdrawal N loss (Vazquez & Adibi [69]; Hall 2016 [18]) |
| 02 energy expenditure | — | 02 | Transient EE +50–100 kcal/day for ~2 wk after carbohydrate withdrawal (grade B, contested) |
| 07 fasting / meal timing | meal times, fasting windows | 07 | BHB time course inside eating windows; time-to-ketosis for extended fasts |
| 10 cardio / 09 resistance | exercise bouts (intensity, duration) | 10/19 | `A_f` → max fat oxidation ×(1+1.3A_f), high-intensity CHO oxidation ×(1−0.3A_f), O2 cost +7%·A_f; post-exercise ketosis |
| 12 appetite/hormones | — | 12 | Small hunger reduction term with BHB (§4.14); low-fat → possible small testosterone effect (contested) |
| 13 transitions / 15 water-electrolytes | — | 13/15 | Glycogen-bound water (3–4 g/g) and insulin-driven natriuresis during entry; carbohydrate refeed water regain; keto-flu index |
| 06 lipids | fat types, meal fat | 06 | Postprandial TG kernel (§4.15.3) |
| 17 safety | medications (SGLT2i, insulin), diagnoses (T1D), pregnancy/lactation | 17 | BHB thresholds, warnings (§9) |

---

## 6. Output metrics for the UI

| Metric | Unit | Direction of good | Computation | Grade |
|---|---|---|---|---|
| Blood BHB (hourly curve) | mmol/L | goal-dependent | `BHB` (§4.5) | B |
| Morning fasting BHB | mmol/L | goal-dependent | BHB at 07:00 (or 1 h before first meal) | B |
| 24-h mean BHB | mmol/L | goal-dependent | mean of hourly BHB | B |
| Ketosis state (categorical) | – | – | <0.2 "none"; 0.2–0.5 "light"; 0.5–3.0 "nutritional ketosis"; 3.0–6 with no food intake "fasting ketosis"; >3.0 while eating or >6 at any time → **warning** | A (0.5–3.0 convention [26,60]; DKA BHB ≥3.0 [72]) |
| Hours in nutritional ketosis per day | h/day | goal-dependent | count of hours with BHB ≥ 0.5 | B |
| Time to ketosis (from schedule start / from last meal) | h | shorter if goal is ketosis | first time BHB ≥ 0.5 | B |
| Keto-adaptation (fast) | % | goal-dependent | `100·A_f` | B (time course) |
| Ketone-kinetics adaptation (slow) | % | – | `100·A_s` | C |
| Brain energy from ketones | % | goal-dependent | `100·0.70·TKB/(TKB+1.5)` | C |
| Exercise max fat oxidation | g/min | ↑ for ultra-endurance goals | §4.15.4 | B |
| High-intensity performance penalty | % | ↓ | 7·A_f (% O2 cost at >75% VO2max) | B |
| Fat balance / fat oxidation | g/day | goal-dependent | §4.15.2 identity | A− |
| Keto-flu index | 0–1 | ↓ | §4.13 | C |
| Ketone energy lost in urine | kcal/day | – | 0.46·Ren·1440 | B |
| Gallstone-risk flag | flag | off | deficit >~1 kg/wk AND (fat <12 g/day OR no meal ≥10 g fat) | B |

---

## 7. Validation targets

Tolerance: ±30% or ±0.15 mM (whichever is larger) for BHB concentrations; ±3 h for time-to-threshold. "Model" = current calibration.

| # | Study (subjects) | Conditions in | Observed out | Model |
|---|---|---|---|---|
| V1 | McDougal 2018 [14] (6 healthy men, BMI 20–27.9) | water-only fast from a meal | BHB 0.1 ± 0.0 at 12 h; 2.3 ± 0.5 at 72 h; FFA 0.6 → 1.1 mM | 0.10; 2.45 |
| V2 | Haymond 1982 [12] (10 men, 10 women) | fast | BHB at 30 h: men 0.9 ± 0.2, women 1.7 ± 0.2 | men 0.99; women 1.28 (−25%, inside ±30% tolerance) |
| V3 | Deru 2021 [13] (11 M/9 F) | 36-h fast ± treadmill exercise at start | time to 0.5 mM 21.1 ± 3.0 h (rest) vs 17.5 ± 1.7 h (exercise); AUC 19.2 vs 27.5 mmol·h/L | 23.3 (M)/19.8 (F) h; with exercise 18.7 h; AUC 15.8 (M)/20.4 (F) → 24.9 |
| V4 | Owen & Reichard 1971 [6]; Balasse 1979 [3] (obese) | prolonged fast | 3 d BHB 2.23; 24 d BHB 5.29, TKB 6.8; plateau TKB 7.09 mM, production 1908 µmol/min | 1.96; 4.99; TKB 6.44; P 1.84 mmol/min |
| V5 | Hall 2016 / Rosenbaum 2019 [18,19] (17 overweight men, ward) | 4 wk at 5% carb, 15% protein, ~−300 kcal/day | fasting BHB 0.77 ± 0.49 (wk 3–4); baseline 0.09–0.11 | 0.69; 0.10 |
| V6 | Harvey 2019 [22] (75 adults) | 3 wk at 5 / 15 / 25% energy from carbohydrate | ΔBHB +0.62 / +0.41 / +0.27 mM | +0.62 / +0.43 / +0.21 |
| V7 | Deru 2024 [46] (27 overweight adults) | 24-h fast then ~110 g dextrose shake | 0.59 → 0.28 (1 h) → 0.19 (4 h) → 0.44 (14 h) | 0.46 → 0.18 → 0.09 → 0.46 (exit ~15% too fast) |
| V8 | Gipson 2025 [47] (24 adults >50 y, BMI ≥27) | 24-h fast begun with 6 g vs 84 g carbohydrate shake | LC: 0.54 (12 h), 0.50 (24 h); HC: 0.32 (12 h), 0.31 (24 h) | LC 0.37 / 0.89; HC 0.16 / 0.57 (ordering and 12-h values acceptable; 24-h values too high — **fails** tolerance; older adults may need IR ≥1.4 and an age term) |
| V9 | Urbain & Bertz 2016 [24] | stable ketogenic diet wk 6 | 24-h min 0.33 (10:00), max 0.70 (03:00) | min 0.30, max 0.69 (timing depends on meal clock) |
| V10 | Féry & Balasse 1983 [37] | 2 h walking ~50% VO2max after overnight fast | TKB 0.20 → 0.39; +0.73 mM at 30 min recovery | 0.17 → 0.51 → 0.91 |
| V11 | Stubbs 2017 [50] / Myette-Côté 2018 [53] | ketone ester ~0.3–0.5 g/kg fasted | Cmax 2.8–3.3 mM at 0.5–1 h; baseline by 3–4 h; fed Cmax −33% | 25 g: 3.26 mM at 1 h, 0.28 at 4 h; fed −58% (too strong) |
| V12 | Vandenberghe 2017 [55] | 2 × ~19 g C8 (breakfast, +4 h fasted) | day-long mean TKB +0.295 ± 0.155 mM vs control | +0.29 |
| V13 | Burke 2021 [32] (elite walkers) | 5–6 d <50 g carb, 2.2 g/kg protein, heavy training | resting BHB 1.2 ± 0.79 mM; fat oxidation ≈1.43 g/min; reverts after 5–6 d HCHO; partial after 24 h | 1.04 mM; A_f 0.85 at day 6; 55% A_f left after 24 h |
| V14 | Johnstone 2008 [27] (17 obese men) | ad libitum 4% carb, 30% protein, 4 wk | plasma BHB 1.52 mM | 0.98 (**known under-prediction**) |
| V15 | Veldhorst 2010 [28] | 1 day 0% carb/30% protein after glycogen-lowering exercise | BHB 1.35 ± 0.65 mM | 0.54 (**known under-prediction**) |

---

## 8. Myths / contested claims

1. **"Ketosis needs <20 g carbohydrate."** Mean BHB ≥0.5 mM occurs at 5% energy from carbohydrate consistently and at 15–25% sporadically (Harvey 2019 [22]); the threshold depends on body size, activity and energy deficit (§4.7 surface).
2. **"High protein kicks you out of ketosis (gluconeogenesis 'like chocolate cake')."** Diets with 30% protein or 2.2 g/kg produced 1.2–1.5 mM [27,28,32]; the effect of protein at fixed carbohydrate is modest (model −25% from 0.75 to 2.2 g/kg) and untested in a dedicated RCT.
3. **"Higher ketones = more fat burning."** BHB concentration reflects the balance of production and clearance; fat loss is set by energy balance. Isocaloric carbohydrate restriction did not increase fat loss (53 vs 89 g/day for fat restriction, Hall 2015 [80]; meta-analysis +16 g/day favouring lower-fat, Hall & Guo 2017 [61]). Exogenous ketones *lower* FFA and endogenous fat mobilisation [42,53].
4. **"Keto boosts metabolism by 300 kcal/day."** Controlled ward data: +57 kcal/day (chamber), +89 (sleeping), +151 ± 63 (DLW), transient [18]; Ebbeling 2018 reported +209 kcal/day at 20% vs 60% carbohydrate during maintenance [62], contested on DLW methodology (Hall 2019, "Mystery or method?", PLoS One [111]; not reviewed in detail here).
5. **"Keto-adaptation takes weeks-to-months before fat oxidation rises."** Maximal fat oxidation reaches chronic-keto levels in 5–6 days [32,35]; what may take longer is recovery of training quality and muscle glycogen, not fat-oxidation capacity. Conversely, adaptation is lost in ~5 days of high-carbohydrate eating and is only partly reversed by 1 day [32,33].
6. **"Keto-adapted athletes perform better."** Improved fat oxidation came with worse economy (+5–8% O2 cost) and no 10-km improvement vs high/periodised carbohydrate in elite walkers [31,32]; submaximal endurance unchanged in 5 cyclists after 4 weeks [29].
7. **"Ketosis spares muscle."** Ketone infusions reduce leucine oxidation/N loss in fasting [67,68], but ketogenic vs non-ketogenic VLCDs at equal protein showed worse N balance with ketosis [69]; protein dose dominates [70].
8. **"Nutritional ketosis is dangerous like ketoacidosis."** Nutritional ketosis (0.5–3 mM) and even 24-day starvation (BHB ~5 mM) keep bicarbonate generally ≥18 mEq/L; DKA involves BHB ≥3 mM plus acidosis, usually with insulin deficiency; median DKA BHB ~9 mM [71,72]. *But* ketoacidosis can occur without diabetes in lactation, and with SGLT2 inhibitors (§9).
9. **"Urine strips stop working once you are keto-adapted."** Not supported by located human data; urinary AcAc remained detectable >90% of the time at wk 6 [24,25].
10. **"Very-low-fat diets are harmless for weight loss."** VLCDs with ≤3 g fat/day produced gallstones in 54.5% vs 0% at 12.2 g/day [98]; fat also needed for carotenoid absorption [97].

---

## 9. Safety bounds

| Situation | Rule for the engine | Source |
|---|---|---|
| BHB ≥3.0 mmol/L while eating, or any BHB ≥3.0 with glucose ≥200 mg/dL or known diabetes | Hard warning: DKA criterion is BHB ≥3.0 mmol/L (>90% sensitivity/specificity) with glucose ≥200 mg/dL or diabetes history and pH <7.3 / bicarbonate <18 mmol/L; ~10% of DKA is euglycaemic (<200 mg/dL) | Umpierrez 2024 consensus [72]; Kitabchi 2009 [71] |
| Planner targets | Never prescribe regimens whose simulated BHB exceeds 3.0 mM with food intake, or prolonged fasts (>72 h) without medical supervision (→ 17) | this dossier / 17 |
| Type 1 diabetes, insulin-treated T2D, SGLT2-inhibitor users | Planner must not prescribe ketogenic or fasting regimens; simulator shows red warning. Risk factors for DKA on SGLT2i include very-low-carbohydrate diets and prolonged fasting | [72,73] |
| Lactation | Warning: ketoacidosis (pH 7.20, base excess −19) reported after 10 days of an LCHF diet in a non-diabetic breastfeeding woman | von Geijer 2015 [74] |
| Starvation ketosis vs DKA | Starvation ketosis suggested by intake <500 kcal/day history; bicarbonate usually not <18 mEq/L | [71,72] |
| Pregnancy, children, inborn errors of fat oxidation/ketolysis, porphyria, pancreatitis, liver failure | Exclude from ketogenic planning; the model is not validated for children (§4.6) | Kossoff 2018 consensus [76] (paediatric; full contraindication list → dossier 17) |
| Kidney stones | Pooled incidence 5.9% (95% CI 4.6–7.6) on ketogenic diets over 3.7 ± 2.9 y (children 5.8%, adults 7.9%); ~49% uric acid stones → hydration/citrate advice | Acharya 2021 [77] |
| Rapid weight loss with very-low-fat intake | Enforce ≥12 g fat/day with ≥1 meal containing ≥10 g fat when predicted loss >~1 kg/wk | [98–101] |
| Essential fatty acids | Enforce LA ≥12–17 g/day and ALA ≥1.1–1.6 g/day averaged over a week (sex-specific AIs) | [95] |
| MCT dosing | Cap single MCT doses at ~30 g (GI distress common at 50–60 g) | [21] |
| High-intensity athletes | Warn that A_f >0.5 impairs high-intensity economy for ≥1 day after carbohydrate restoration | [31,32] |

---

## 10. Open questions / weakest assumptions

1. **Hepatic partition function φ(G_L)** and the insulin proxy are fitted; they inherit any bias in dossier 04's liver-glycogen model. Retune `kP` and `G50` against V1–V6 after coupling.
2. **Protein effect** (k_prot 0–0.69) is the largest structural uncertainty for high-protein low-carb regimens; no isolating RCT found.
3. **Energy-deficit effect** (e_def = 1.5) is fitted to few studies; hypocaloric ketogenic diets (V14) are under-predicted by ~35%.
4. **Exercise × low-carbohydrate interaction** (k_mgF) is fitted to athlete data and under-predicts V15; muscle-glycogen coupling should come from 04/10.
5. **Obesity/insulin-resistance blunting** of fasting ketosis is only partly captured (obese/lean 48-h ratio 0.7–0.8 vs 0.51 observed [15]).
6. **Sex difference** only ~35–40% captured (women 1.28 vs observed 1.7 mM at 30 h); children not supported.
7. **Chronic MCT** effect on morning BHB (+0.8 mM in [21]) not reproduced (+0.1); acute MCT PK is reproduced.
8. **Re-entry and cyclical ketogenic patterns**: no human BHB trajectories located; all numbers in §4.9 table 2 are model predictions.
9. **Slow adaptation A_s** (muscle ketone sparing) evidence is from prolonged fasting in obese subjects and is contested (saturation vs true adaptation [3,4]).
10. **BHB:AcAc ratio** differs between fasting (R 2.7–3.5) and eucaloric ketogenic diets (R ~1 [19]); BHB output could be biased ±30% in diet-induced ketosis.
11. **Diurnal pattern** is driven only by meals; circadian (dawn) effects on lipolysis/ketogenesis not modelled (→ 07).
12. **Appetite effect of ketosis** conflicts across trials (Johnstone 2008 vs Hall 2021) — kept small.
13. Gibson 2015 pooled effect sizes, Hall 2021 BHB values, fat digestibility coefficient and fasting natriuresis magnitudes were not verified from primary full texts (marked UNVERIFIED).

---

## 11. References

(PMID; DOI; URL. All abstracts were retrieved from PubMed/E-utilities; full texts from PMC where a PMCID is given.)

1. Hall KD. Predicting metabolic adaptation, body weight change, and energy intake in humans. Am J Physiol Endocrinol Metab 2010;298:E449–E466. PMID 19934407; doi:10.1152/ajpendo.00559.2009; https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/
2. Hall KD. Computational model of in vivo human energy metabolism during semistarvation and refeeding. Am J Physiol Endocrinol Metab 2006;291:E23–E37. PMID 16449298; doi:10.1152/ajpendo.00523.2005; https://pmc.ncbi.nlm.nih.gov/articles/PMC2377067/ (no ketone term; cited for context)
3. Balasse EO. Kinetics of ketone body metabolism in fasting humans. Metabolism 1979;28:41–50. PMID 759825; doi:10.1016/0026-0495(79)90166-5
4. Balasse EO, Féry F. Ketone body production and disposal: effects of fasting, diabetes, and exercise. Diabetes Metab Rev 1989;5:247–270. PMID 2656155; doi:10.1002/dmr.5610050304
5. Owen OE, Reichard GA Jr, Markus H, Boden G, Mozzoli MA, Shuman CR. Rapid intravenous sodium acetoacetate infusion in man. Metabolic and kinetic responses. J Clin Invest 1973;52:2606–2616. PMID 4729054; doi:10.1172/JCI107453; https://pmc.ncbi.nlm.nih.gov/articles/PMC302521/
6. Owen OE, Reichard GA Jr. Human forearm metabolism during progressive starvation. J Clin Invest 1971;50:1536–1545. PMID 5090067; doi:10.1172/JCI106639; https://pmc.ncbi.nlm.nih.gov/articles/PMC292094/
7. Reichard GA Jr, Owen OE, Haff AC, Paul P, Bortz WM. Ketone-body production and oxidation in fasting obese humans. J Clin Invest 1974;53:508–515. PMID 11344564; doi:10.1172/JCI107584; https://pmc.ncbi.nlm.nih.gov/articles/PMC301493/
8. Owen OE, Felig P, Morgan AP, Wahren J, Cahill GF Jr. Liver and kidney metabolism during prolonged starvation. J Clin Invest 1969;48:574–583. PMID 5773093; doi:10.1172/JCI106016
9. Owen OE, Morgan AP, Kemp HG, Sullivan JM, Herrera MG, Cahill GF Jr. Brain metabolism during fasting. J Clin Invest 1967;46:1589–1595. PMID 6061736; doi:10.1172/JCI105650
10. Cahill GF Jr. Starvation in man. N Engl J Med 1970;282:668–675. PMID 4915800; doi:10.1056/NEJM197003192821209 (context; values not extracted)
11. Cahill GF Jr. Fuel metabolism in starvation. Annu Rev Nutr 2006;26:1–22. PMID 16848698; doi:10.1146/annurev.nutr.26.061505.111258 (context)
12. Haymond MW, Karl IE, Clarke WL, Pagliara AS, Santiago JV. Differences in circulating gluconeogenic substrates during short-term fasting in men, women, and children. Metabolism 1982;31:33–42. PMID 7043160
13. Deru LS, Bikman BT, Davidson LE, et al. The effects of exercise on β-hydroxybutyrate concentrations over a 36-h fast: a randomized crossover study. Med Sci Sports Exerc 2021;53:1987–1998. PMID 33731648; doi:10.1249/MSS.0000000000002655
14. McDougal DH, Darpolor MM, DuVall MA, et al. Glial acetate metabolism is increased following a 72-h fast in metabolically healthy men and correlates with susceptibility to hypoglycemia. Acta Diabetol 2018;55:1029–1036. PMID 29931424; doi:10.1007/s00592-018-1180-5; https://pmc.ncbi.nlm.nih.gov/articles/PMC6153507/
15. Neudorf H, Sandilands RE, Ursel S, et al. Altered immunometabolic response to fasting in humans living with obesity. iScience 2025;28:112872. PMID 40662191; doi:10.1016/j.isci.2025.112872; https://pmc.ncbi.nlm.nih.gov/articles/PMC12256293/
16. Klein S, Sakurai Y, Romijn JA, Carroll RM. Progressive alterations in lipid and glucose metabolism during short-term fasting in young adult men. Am J Physiol 1993;265:E801–E806. PMID 8238506; doi:10.1152/ajpendo.1993.265.5.E801
17. Rothman DL, Magnusson I, Katz LD, Shulman RG, Shulman GI. Quantitation of hepatic glycogenolysis and gluconeogenesis in fasting humans with 13C NMR. Science 1991;254:573–576. PMID 1948033; doi:10.1126/science.1948033
18. Hall KD, Chen KY, Guo J, et al. Energy expenditure and body composition changes after an isocaloric ketogenic diet in overweight and obese men. Am J Clin Nutr 2016;104:324–333. PMID 27385608; doi:10.3945/ajcn.116.133561
19. Rosenbaum M, Hall KD, Guo J, et al. Glucose and lipid homeostasis and inflammation in humans following an isocaloric ketogenic diet. Obesity 2019;27:971–981. PMID 31067015; doi:10.1002/oby.22468; https://pmc.ncbi.nlm.nih.gov/articles/PMC6922028/ (Table 3 ketone values)
20. Hall KD, Guo J, Courville AB, et al. Effect of a plant-based, low-fat diet versus an animal-based, ketogenic diet on ad libitum energy intake. Nat Med 2021;27:344–353. PMID 33479499; doi:10.1038/s41591-020-01209-1
21. Harvey CJDC, Schofield GM, Williden M, McQuillan JA. The effect of medium chain triglycerides on time to nutritional ketosis and symptoms of keto-induction in healthy adults: a randomised controlled clinical trial. J Nutr Metab 2018;2018:2630565. PMID 29951312; doi:10.1155/2018/2630565; https://pmc.ncbi.nlm.nih.gov/articles/PMC5987302/
22. Harvey CJDC, Schofield GM, Zinn C, Thornley S. Effects of differing levels of carbohydrate restriction on mood achievement of nutritional ketosis, and symptoms of carbohydrate withdrawal in healthy adults: a randomized clinical trial. Nutrition X 2019;67–68S:100005. PMID 34332710; doi:10.1016/j.nutx.2019.100005
23. Harvey CJDC, Schofield GM, Zinn C, Thornley SJ, Crofts C, Merien FLR. Low-carbohydrate diets differing in carbohydrate restriction improve cardiometabolic and anthropometric markers in healthy adults: a randomised clinical trial. PeerJ 2019;7:e6273. PMID 30740270; doi:10.7717/peerj.6273
24. Urbain P, Bertz H. Monitoring for compliance with a ketogenic diet: what is the best time of day to test for urinary ketosis? Nutr Metab (Lond) 2016;13:77. PMID 27822291; doi:10.1186/s12986-016-0136-4
25. Urbain P, Strom L, Morawski L, et al. Impact of a 6-week non-energy-restricted ketogenic diet on physical fitness, body composition and biochemical parameters in healthy adults. Nutr Metab (Lond) 2017;14:17. PMID 28239404; doi:10.1186/s12986-017-0175-5
26. Hallberg SJ, McKenzie AL, Williams PT, et al. Effectiveness and safety of a novel care model for the management of type 2 diabetes at 1 year. Diabetes Ther 2018;9:583–612. PMID 29417495; doi:10.1007/s13300-018-0373-9; https://pmc.ncbi.nlm.nih.gov/articles/PMC6104272/
27. Johnstone AM, Horgan GW, Murison SD, Bremner DM, Lobley GE. Effects of a high-protein ketogenic diet on hunger, appetite, and weight loss in obese men feeding ad libitum. Am J Clin Nutr 2008;87:44–55. PMID 18175736; doi:10.1093/ajcn/87.1.44
28. Veldhorst MA, Westerterp KR, van Vught AJ, Westerterp-Plantenga MS. Presence or absence of carbohydrates and the proportion of fat in a high-protein diet affect appetite suppression but not energy expenditure in normal-weight human subjects fed in energy balance. Br J Nutr 2010;104:1395–1405. PMID 20565999; doi:10.1017/S0007114510002060
29. Phinney SD, Bistrian BR, Evans WJ, Gervino E, Blackburn GL. The human metabolic response to chronic ketosis without caloric restriction: preservation of submaximal exercise capability with reduced carbohydrate oxidation. Metabolism 1983;32:769–776. PMID 6865776; doi:10.1016/0026-0495(83)90106-3
30. Volek JS, Freidenreich DJ, Saenz C, et al. Metabolic characteristics of keto-adapted ultra-endurance runners. Metabolism 2016;65:100–110. PMID 26892521; doi:10.1016/j.metabol.2015.10.028
31. Burke LM, Ross ML, Garvican-Lewis LA, et al. Low carbohydrate, high fat diet impairs exercise economy and negates the performance benefit from intensified training in elite race walkers. J Physiol 2017;595:2785–2807. PMID 28012184; doi:10.1113/JP273230
32. Burke LM, Whitfield J, Heikura IA, et al. Adaptation to a low carbohydrate high fat diet is rapid but impairs endurance exercise metabolism and performance despite enhanced glycogen availability. J Physiol 2021;599:771–790. PMID 32697366; doi:10.1113/JP280221; https://pmc.ncbi.nlm.nih.gov/articles/PMC7891450/
33. Carey AL, Staudacher HM, Cummings NK, et al. Effects of fat adaptation and carbohydrate restoration on prolonged endurance exercise. J Appl Physiol 2001;91:115–122. PMID 11408421; doi:10.1152/jappl.2001.91.1.115
34. Stellingwerff T, Spriet LL, Watt MJ, et al. Decreased PDH activation and glycogenolysis during exercise following fat adaptation with carbohydrate restoration. Am J Physiol Endocrinol Metab 2006;290:E380–E388. PMID 16188909; doi:10.1152/ajpendo.00268.2005
35. Goedecke JH, Christie C, Wilson G, et al. Metabolic adaptations to a high-fat diet in endurance cyclists. Metabolism 1999;48:1509–1517. PMID 10599981; doi:10.1016/s0026-0495(99)90238-x
36. Webster CC, Noakes TD, Chacko SK, Swart J, Kohn TA, Smith JA. Gluconeogenesis during endurance exercise in cyclists habituated to a long-term low carbohydrate high-fat diet. J Physiol 2016;594:4389–4405. PMID 26918583; doi:10.1113/JP271934
37. Féry F, Balasse EO. Ketone body turnover during and after exercise in overnight-fasted and starved humans. Am J Physiol 1983;245:E318–E325. PMID 6353933; doi:10.1152/ajpendo.1983.245.4.E318
38. Féry F, Balasse EO. Response of ketone body metabolism to exercise during transition from postabsorptive to fasted state. Am J Physiol 1986;250:E495–E501. PMID 3518484; doi:10.1152/ajpendo.1986.250.5.E495
39. Féry F, Balasse EO. Effect of exercise on the disposal of infused ketone bodies in humans. J Clin Endocrinol Metab 1988;67:245–250. PMID 3392162; doi:10.1210/jcem-67-2-245
40. Balasse EO, Féry F, Neef MA. Changes induced by exercise in rates of turnover and oxidation of ketone bodies in fasting man. J Appl Physiol 1978;44:5–11. PMID 627499; doi:10.1152/jappl.1978.44.1.5
41. Evans M, Cogan KE, Egan B. Metabolism of ketone bodies during exercise and training: physiological basis for exogenous supplementation. J Physiol 2017;595:2857–2871. PMID 27861911; doi:10.1113/JP273185; https://pmc.ncbi.nlm.nih.gov/articles/PMC5407977/
42. Balasse EO, Neef MA. Inhibition of ketogenesis by ketone bodies in fasting humans. Metabolism 1975;24:999–1007. PMID 1152676; doi:10.1016/0026-0495(75)90092-x
43. Keller U, Gerber PP, Stauffacher W. Fatty acid-independent inhibition of hepatic ketone body production by insulin in humans. Am J Physiol 1988;254:E694–E699. PMID 3287950; doi:10.1152/ajpendo.1988.254.6.E694
44. Miles JM, Haymond MW, Nissen SL, Gerich JE. Effects of free fatty acid availability, glucagon excess, and insulin deficiency on ketone body production in postabsorptive man. J Clin Invest 1983;71:1554–1561. PMID 6134753; doi:10.1172/jci110911
45. Keller U, Lustenberger M, Müller-Brand J, Gerber PP, Stauffacher W. Human ketone body production and utilization studied using tracer techniques: regulation by free fatty acids, insulin, catecholamines, and thyroid hormones. Diabetes Metab Rev 1989;5:285–298. PMID 2656157; doi:10.1002/dmr.5610050306
46. Deru LS, Gipson EZ, Hales KE, et al. The effects of a high-carbohydrate versus a high-fat shake on biomarkers of metabolism and glycemic control when used to interrupt a 38-h fast: a randomized crossover study. Nutrients 2024;16:164. PMID 38201992; doi:10.3390/nu16010164; https://pmc.ncbi.nlm.nih.gov/articles/PMC10780935/ (Table 2 BHB values)
47. Gipson EZ, Deru LS, Graves PG, Jacobsen CG, Peterson NE, Bailey BW. The effects of initiating a 24-hour fast with a low versus a high carbohydrate shake on glycemic control in older adults: a randomized crossover study. Nutr Metab (Lond) 2025;22:32. PMID 40234969; doi:10.1186/s12986-025-00920-5; https://pmc.ncbi.nlm.nih.gov/articles/PMC11998415/
48. Gray DS, Takahashi M, Fisler JS, et al. Effect of carbohydrate refeeding on free fatty acids after a fast in obese diabetic and obese non-diabetic females. Metabolism 1989;38:208–214. PMID 2645502; doi:10.1016/0026-0495(89)90077-2
49. Fery F, Bourdoux P, Christophe J, Balasse EO. Hormonal and metabolic changes induced by an isocaloric isoproteinic ketogenic diet in healthy subjects. Diabete Metab 1982;8:299–305. PMID 6761185 (4-day KD: insulin −44%, glucagon +39%, T3 ↓, glucose −16.5%)
50. Stubbs BJ, Cox PJ, Evans RD, et al. On the metabolism of exogenous ketones in humans. Front Physiol 2017;8:848. PMID 29163194; doi:10.3389/fphys.2017.00848
51. Clarke K, Tchabanenko K, Pawlosky R, et al. Kinetics, safety and tolerability of (R)-3-hydroxybutyl (R)-3-hydroxybutyrate in healthy adult subjects. Regul Toxicol Pharmacol 2012;63:401–408. PMID 22561291; doi:10.1016/j.yrtph.2012.04.008
52. Cox PJ, Kirk T, Ashmore T, et al. Nutritional ketosis alters fuel preference and thereby endurance performance in athletes. Cell Metab 2016;24:256–268. PMID 27475046; doi:10.1016/j.cmet.2016.07.010
53. Myette-Côté É, Neudorf H, Rafiei H, Clarke K, Little JP. Prior ingestion of exogenous ketone monoester attenuates the glycaemic response to an oral glucose tolerance test in healthy young individuals. J Physiol 2018;596:1385–1395. PMID 29446830; doi:10.1113/JP275709
54. St-Pierre V, Vandenberghe C, Lowry CM, et al. Plasma ketone and medium chain fatty acid response in humans consuming different medium chain triglycerides during a metabolic study day. Front Nutr 2019;6:46. PMID 31058159; doi:10.3389/fnut.2019.00046
55. Vandenberghe C, St-Pierre V, Pierotti T, et al. Tricaprylin alone increases plasma ketone response more than coconut oil or other medium-chain triglycerides: an acute crossover study in healthy adults. Curr Dev Nutr 2017;1:e000257. PMID 29955698; doi:10.3945/cdn.116.000257
56. Courchesne-Loyer A, Fortier M, Tremblay-Mercier J, et al. Stimulation of mild, sustained ketonemia by medium-chain triacylglycerols in healthy humans: estimated potential contribution to brain energy metabolism. Nutrition 2013;29:635–640. PMID 23274095; doi:10.1016/j.nut.2012.09.009
57. Courchesne-Loyer A, Croteau E, Castellano CA, et al. Inverse relationship between brain glucose and ketone metabolism in adults during short-term moderate dietary ketosis: a dual tracer quantitative PET study. J Cereb Blood Flow Metab 2017;37:2485–2493. PMID 27629100; doi:10.1177/0271678X16669366
58. Blomqvist G, Alvarsson M, Grill V, et al. Effect of acute hyperketonemia on the cerebral uptake of ketone bodies in nondiabetic subjects and IDDM patients. Am J Physiol Endocrinol Metab 2002;283:E20–E28. PMID 12067838; doi:10.1152/ajpendo.00294.2001
59. Gibson AA, Seimon RV, Lee CM, et al. Do ketogenic diets really suppress appetite? A systematic review and meta-analysis. Obes Rev 2015;16:64–76. PMID 25402637; doi:10.1111/obr.12230
60. Fernández-Verdejo R, Mey JT, Ravussin E. Effects of ketone bodies on energy expenditure, substrate utilization, and energy intake in humans. J Lipid Res 2023;64:100442. PMID 37703994; doi:10.1016/j.jlr.2023.100442; https://pmc.ncbi.nlm.nih.gov/articles/PMC10570604/
61. Hall KD, Guo J. Obesity energetics: body weight regulation and the effects of diet composition. Gastroenterology 2017;152:1718–1727.e3. PMID 28193517; doi:10.1053/j.gastro.2017.01.052
62. Ebbeling CB, Feldman HA, Klein GL, et al. Effects of a low carbohydrate diet on energy expenditure during weight loss maintenance: randomized trial. BMJ 2018;363:k4583. PMID 30429127; doi:10.1136/bmj.k4583
63. Bostock ECS, Kirkby KC, Taylor BV, Hawrelak JA. Consumer reports of "keto flu" associated with the ketogenic diet. Front Nutr 2020;7:20. PMID 32232045; doi:10.3389/fnut.2020.00020
64. Veverbrants E, Arky RA. Effects of fasting and refeeding. I. Studies on sodium, potassium and water excretion on a constant electrolyte and fluid intake. J Clin Endocrinol Metab 1969;29:55–62. PMID 5762322; doi:10.1210/jcem-29-1-55 (abstract not available; values not extracted)
65. Kolanowski J. Influence of insulin and glucagon on sodium balance in obese subjects during fasting and refeeding. Int J Obes 1981;5 Suppl 1:105–114. PMID 6113218
66. Kreitzman SN, Coxon AY, Szaz KF. Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition. Am J Clin Nutr 1992;56(1 Suppl):292S–293S. PMID 1615908; doi:10.1093/ajcn/56.1.292S
67. Sherwin RS, Hendler RG, Felig P. Effect of ketone infusions on amino acid and nitrogen metabolism in man. J Clin Invest 1975;55:1382–1390. PMID 1133179; doi:10.1172/JCI108057
68. Nair KS, Welle SL, Halliday D, Campbell RG. Effect of β-hydroxybutyrate on whole-body leucine kinetics and fractional mixed skeletal muscle protein synthesis in humans. J Clin Invest 1988;82:198–205. PMID 3392207; doi:10.1172/JCI113570
69. Vazquez JA, Adibi SA. Protein sparing during treatment of obesity: ketogenic versus nonketogenic very low calorie diet. Metabolism 1992;41:406–414. PMID 1556948; doi:10.1016/0026-0495(92)90076-m
70. Hoffer LJ, Bistrian BR, Young VR, Blackburn GL, Matthews DE. Metabolic effects of very low calorie weight reduction diets. J Clin Invest 1984;73:750–758. PMID 6707202; doi:10.1172/JCI111268
71. Kitabchi AE, Umpierrez GE, Miles JM, Fisher JN. Hyperglycemic crises in adult patients with diabetes. Diabetes Care 2009;32:1335–1343. PMID 19564476; doi:10.2337/dc09-9032; https://pmc.ncbi.nlm.nih.gov/articles/PMC2699725/
72. Umpierrez GE, Davis GM, ElSayed NA, et al. Hyperglycemic crises in adults with diabetes: a consensus report. Diabetes Care 2024;47:1257–1275. PMID 39052901; doi:10.2337/dci24-0032; https://pmc.ncbi.nlm.nih.gov/articles/PMC11272983/
73. Peters AL, Buschur EO, Buse JB, Cohan P, Diner JC, Hirsch IB. Euglycemic diabetic ketoacidosis: a potential complication of treatment with sodium–glucose cotransporter 2 inhibition. Diabetes Care 2015;38:1687–1693. PMID 26078479; doi:10.2337/dc15-0843
74. von Geijer L, Ekelund M. Ketoacidosis associated with low-carbohydrate diet in a non-diabetic lactating woman: a case report. J Med Case Rep 2015;9:224. PMID 26428083; doi:10.1186/s13256-015-0709-2
75. Laffel L. Ketone bodies: a review of physiology, pathophysiology and application of monitoring to diabetes. Diabetes Metab Res Rev 1999;15:412–426. PMID 10634967
76. Kossoff EH, Zupec-Kania BA, Auvin S, et al. Optimal clinical management of children receiving dietary therapies for epilepsy: updated recommendations of the International Ketogenic Diet Study Group. Epilepsia Open 2018;3:175–192. PMID 29881797; doi:10.1002/epi4.12225
77. Acharya P, Acharya C, Thongprayoon C, et al. Incidence and characteristics of kidney stones in patients on ketogenic diet: a systematic review and meta-analysis. Diseases 2021;9:39. PMID 34070285; doi:10.3390/diseases9020039
78. Schutz Y, Flatt JP, Jéquier E. Failure of dietary fat intake to promote fat oxidation: a factor favoring the development of obesity. Am J Clin Nutr 1989;50:307–314. PMID 2756918; doi:10.1093/ajcn/50.2.307
79. Flatt JP. Use and storage of carbohydrate and fat. Am J Clin Nutr 1995;61(4 Suppl):952S–959S. PMID 7900694; doi:10.1093/ajcn/61.4.952S
80. Hall KD, Bemis T, Brychta R, et al. Calorie for calorie, dietary fat restriction results in more body fat loss than carbohydrate restriction in people with obesity. Cell Metab 2015;22:427–436. PMID 26278052; doi:10.1016/j.cmet.2015.07.021
81. Smith SR, de Jonge L, Zachwieja JJ, et al. Fat and carbohydrate balances during adaptation to a high-fat diet. Am J Clin Nutr 2000;71:450–457. PMID 10648257; doi:10.1093/ajcn/71.2.450
82. Smith SR, de Jonge L, Zachwieja JJ, et al. Concurrent physical activity increases fat oxidation during the shift to a high-fat diet. Am J Clin Nutr 2000;72:131–138. PMID 10871571; doi:10.1093/ajcn/72.1.131
83. Thomas CD, Peters JC, Reed GW, Abumrad NN, Sun M, Hill JO. Nutrient balance and energy expenditure during ad libitum feeding of high-fat and high-carbohydrate diets in humans. Am J Clin Nutr 1992;55:934–942. PMID 1570800; doi:10.1093/ajcn/55.5.934
84. Hill JO, Peters JC, Reed GW, Schlundt DG, Sharp T, Greene HL. Nutrient balance in humans: effects of diet composition. Am J Clin Nutr 1991;54:10–17. PMID 2058571; doi:10.1093/ajcn/54.1.10
85. Schrauwen P, van Marken Lichtenbelt WD, Saris WH, Westerterp KR. Role of glycogen-lowering exercise in the change of fat oxidation in response to a high-fat diet. Am J Physiol 1997;273:E623–E629. PMID 9316454; doi:10.1152/ajpendo.1997.273.3.E623
86. Frayn KN. Adipose tissue as a buffer for daily lipid flux. Diabetologia 2002;45:1201–1210. PMID 12242452; doi:10.1007/s00125-002-0873-y
87. McQuaid SE, Hodson L, Neville MJ, et al. Downregulation of adipose tissue fatty acid trafficking in obesity: a driver for ectopic fat deposition? Diabetes 2011;60:47–55. PMID 20943748; doi:10.2337/db10-0867
88. Bickerton AS, Roberts R, Fielding BA, et al. Preferential uptake of dietary fatty acids in adipose tissue and muscle in the postprandial period. Diabetes 2007;56:168–176. PMID 17192479; doi:10.2337/db06-0822
89. Romanski SA, Nelson RM, Jensen MD. Meal fatty acid uptake in adipose tissue: gender effects in nonobese humans. Am J Physiol Endocrinol Metab 2000;279:E455–E462. PMID 10913047; doi:10.1152/ajpendo.2000.279.2.E455
90. Nordestgaard BG, Langsted A, Mora S, et al. Fasting is not routinely required for determination of a lipid profile… joint consensus statement from the EAS and EFLM. Eur Heart J 2016;37:1944–1958. PMID 27122601; doi:10.1093/eurheartj/ehw152
91. Kolovou GD, Mikhailidis DP, Kovar J, et al. Assessment and clinical relevance of non-fasting and postprandial triglycerides: an expert panel statement. Curr Vasc Pharmacol 2011;9:258–270. PMID 21314632; doi:10.2174/157016111795495549
92. Venables MC, Achten J, Jeukendrup AE. Determinants of fat oxidation during exercise in healthy men and women: a cross-sectional study. J Appl Physiol 2005;98:160–167. PMID 15333616; doi:10.1152/japplphysiol.00662.2003
93. Randell RK, Rollo I, Roberts TJ, et al. Maximal fat oxidation rates in an athletic population. Med Sci Sports Exerc 2017;49:133–140. PMID 27580144; doi:10.1249/MSS.0000000000001084
94. Alpert SS. A limit on the energy transfer rate from the human fat store in hypophagia. J Theor Biol 2005;233:1–13. PMID 15615615; doi:10.1016/j.jtbi.2004.08.029
95. Institute of Medicine (Food and Nutrition Board). Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids. National Academies Press, 2005; doi:10.17226/10490; https://nap.nationalacademies.org/catalog/10490. AI values confirmed via secondary citation: PMID 28783061, https://pmc.ncbi.nlm.nih.gov/articles/PMC5579635/
96. Roodenburg AJ, Leenen R, van het Hof KH, Weststrate JA, Tijburg LB. Amount of fat in the diet affects bioavailability of lutein esters but not of α-carotene, β-carotene, and vitamin E in humans. Am J Clin Nutr 2000;71:1187–1193. PMID 10799382; doi:10.1093/ajcn/71.5.1187
97. Brown MJ, Ferruzzi MG, Nguyen ML, et al. Carotenoid bioavailability is higher from salads ingested with full-fat than with fat-reduced salad dressings as measured with electrochemical detection. Am J Clin Nutr 2004;80:396–403. PMID 15277161; doi:10.1093/ajcn/80.2.396
98. Festi D, Colecchia A, Orsini M, et al. Gallbladder motility and gallstone formation in obese patients following very low calorie diets. Use it (fat) to lose it (well). Int J Obes 1998;22:592–600. PMID 9665682; doi:10.1038/sj.ijo.0800634
99. Gebhard RL, Prigge WF, Ansel HJ, et al. The role of gallbladder emptying in gallstone formation during diet-induced rapid weight loss. Hepatology 1996;24:544–548. PMID 8781321; doi:10.1002/hep.510240313
100. Stokes CS, Gluud LL, Casper M, Lammert F. Ursodeoxycholic acid and diets higher in fat prevent gallbladder stones during weight loss: a meta-analysis of randomized controlled trials. Clin Gastroenterol Hepatol 2014;12:1090–1100. PMID 24321208; doi:10.1016/j.cgh.2013.11.031
101. Johansson K, Sundström J, Marcus C, Hemmingsson E, Neovius M. Risk of symptomatic gallstones and cholecystectomy after a very-low-calorie diet or low-calorie diet in a commercial weight loss program: 1-year matched cohort study. Int J Obes 2014;38:279–284. PMID 23736359; doi:10.1038/ijo.2013.83
102. Whittaker J, Wu K. Low-fat diets and testosterone in men: systematic review and meta-analysis of intervention studies. J Steroid Biochem Mol Biol 2021;210:105878. PMID 33741447; doi:10.1016/j.jsbmb.2021.105878. Corrigendum: 2026;255:106880, PMID 41139558 (content not reviewed).
103. Soltani S, Hejazi M, Meshkini F, et al. The effect of low-fat diets versus high-fat diet on sex hormones: a systematic review and meta-analysis of randomized controlled trials. J Food Sci 2025;90:e70266. PMID 40387562; doi:10.1111/1750-3841.70266
104. Whittaker J, Harris M. Low-carbohydrate diets and men's cortisol and testosterone: systematic review and meta-analysis. Nutr Health 2022;28:543–554. PMID 35254136; doi:10.1177/02601060221083079
105. Kysel P, Haluzíková D, Doležalová RP, et al. The influence of cyclical ketogenic reduction diet vs. nutritionally balanced reduction diet on body composition, strength, and endurance performance in healthy young males: a randomized controlled trial. Nutrients 2020;12:2832. PMID 32947920; doi:10.3390/nu12092832
106. Bougnères PF, Lemmel C, Ferré P, Bier DM. Ketone body transport in the human neonate and infant. J Clin Invest 1986;77:42–48. PMID 3944260; https://pmc.ncbi.nlm.nih.gov/articles/PMC423306/
107. Kephart WC, Pledge CD, Roberson PA, et al. The three-month effects of a ketogenic diet on body composition, blood parameters, and performance metrics in CrossFit trainees: a pilot study. Sports 2018;6:1. PMID 29910305; doi:10.3390/sports6010001 (BHB 2.8–9.5-fold higher than control; not used quantitatively)
108. Johnson RH, Walton JL. The effect of exercise upon acetoacetate metabolism in athletes and non-athletes. Q J Exp Physiol 1972;57:73–79. PMID 4482033; and Johnson RH, Walton JL, Krebs HA, Williamson DH. Metabolic fuels during and after severe exercise in athletes and non-athletes. Lancet 1969;2:452–455. PMID 4183902 (magnitudes via [41])
109. Stubbs BJ, Cox PJ, Evans RD, Cyranka M, Clarke K, de Wet H. A ketone ester drink lowers human ghrelin and appetite. Obesity 2018;26:269–273. PMID 29105987; doi:10.1002/oby.22051
110. Southgate DA, Durnin JV. Calorie conversion factors. An experimental reassessment of the factors used in the calculation of the energy value of human diets. Br J Nutr 1970;24:517–535. PMID 5452702; doi:10.1079/bjn19700050 (digestibility coefficient not extracted — UNVERIFIED)
111. Hall KD. Mystery or method? Evaluating claims of increased energy expenditure during a ketogenic diet. PLoS One 2019;14:e0225944. PMID 31815947; doi:10.1371/journal.pone.0225944
