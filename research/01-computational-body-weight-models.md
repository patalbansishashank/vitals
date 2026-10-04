# 01 — Computational body-weight, body-composition and macronutrient-flux models

Dossier owner: research agent 01. Status: complete draft (2026-09-30).
Unit conventions: 1 kcal = 4.184 kJ; 1 MJ = 239 kcal. Hall 2010 works in kcal/day and grams; Hall 2011 (Lancet /
NIDDK Body Weight Planner) works in MJ/day and kg. Every equation below is given in the units of its source paper;
convert once at the module boundary. "[n]" = reference number in §11. "PROPOSED FIT" = our fit to cited data, not a
published equation. "UNVERIFIED" = could not be confirmed from a primary source during this review.
"DERIVED" = arithmetic we did on published equations (reproducible; code in §4.12).

---

## 1. Scope

- Extracts, in implementable form, the validated whole-body models of energy/macronutrient balance and body
  composition: Hall 2010 macronutrient-flux model (8 ODEs) [1], its predecessor Hall 2006 [2], Hall 2011 Lancet /
  NIDDK Body Weight Planner two-compartment model [3], Chow & Hall 2008 dynamical-systems reduction [4], Forbes /
  Hall 2007 partition law and the P-ratio [5,7,9], Thomas/Pennington models [11-17], older models (Antonetti,
  Westerterp, Kozusko, Alpert, Payne & Dugdale, Christiansen, Flatt, Speakman-Westerterp) [23-33].
- Quantifies energy density of tissue change (why 3500 kcal/lb fails), early rapid weight loss (glycogen, water,
  sodium/ECF), Alpert's fat-transfer limit, and gives minimal fast-timescale sub-models (glucose-insulin, ketones,
  muscle protein turnover) that can be bolted onto an hourly engine.
- Lists validation data sets with numbers (unit tests), recommends the engine state vector and timestep, and
  enumerates what these models do NOT capture (hand-offs to dossiers 02-17).
- Out of scope (only interfaces given): RMR prediction equations and adaptive thermogenesis details (02), MPS/protein
  dosing (03), glycogen/insulin detail (04), ketosis detail (05), RT hypertrophy (09), appetite (12).

---

## 2. State variables

Recommended state vector for the body-composition core (superset of Hall 2010's 8 ODE states [1] plus the Hall 2011
adaptive-thermogenesis state [3]; extra states marked NEW are needed by other dossiers and are NOT in Hall's models).

| Name | Unit | Typical range | What it represents | Initial-value rule |
|---|---|---|---|---|
| `F` (fat mass, triglyceride) | kg (Hall 2010: g) | 3-80 kg | Body triacylglycerol store (energy density 9.44 kcal/g [1]; 39.5 MJ/kg [3]) | From user %BF (dossier 14) or Jackson eq. (4.2.3) |
| `P` (intracellular protein) | kg | 6-15 kg | Lean-tissue protein; each g carries h_P = 1.6 g water [1,6] | P = 0.25 x LCM, LCM = FFM - BM - ECF - ECP [1] |
| `G` (glycogen, whole body) | g | 100-1000 g | Liver + muscle glycogen; carries h_G = 2.7 g water/g [1,3] | 500 g [1,3] (scale per 4.9) |
| `G_liv`, `G_mus` (NEW split of G) | g | liver 0-150, muscle 100-900 | Needed for fasting/exercise dynamics (dossier 04) | Split of G (dossier 04) |
| `ECF` | L (Hall 2010: g) | 12-25 L | Extracellular fluid; sodium-driven | Silva 2007 regression [80] (dossier 14/15) |
| `dECF_slow` | L | +-2 L | Slow ECF increment tracking weight change, tau 1000 d [1] | 0 |
| `T` (adaptive thermogenesis, dimensionless) or `AT` | - or MJ/d | T: -0.4..+0.05; AT: -1..+0.3 MJ/d | Adaptive thermogenesis beyond composition effects | 0 at energy balance |
| `L_diet` | - | 0.9-3.8 | Carbohydrate-driven lipolysis multiplier (tau 1.44 d) [1] | 1 at baseline diet (see 4.1.5 note) |
| `P_sig` | - | -1..+3 | Protein-intake signal driving protein oxidation (tau 1.1 d) [1] | 0 |
| `MPS_RT` (NEW) | fractional elevation | 0-1.2 | Post-resistance-exercise MPS elevation (PROPOSED, 4.10.4; owner dossier 03/09) | 0 |
| `KetoAdapt` (NEW) | 0-1 | 0-1 | Multi-week keto-adaptation state (owner dossier 05) | 0 |
| `BHB` (NEW) | mmol/L | 0.05-7 | Plasma beta-hydroxybutyrate (PROPOSED, 4.10.3; owner dossier 05) | 0.07 mM [43] |
| Gut pools `Q_sto,Q_gut` (NEW, hourly) | g | 0-150 g | Stomach/gut glucose for meal Ra (Dalla Man structure [72]) | 0 |
| `Gp, X, I` (NEW, hourly) | mg/dl, 1/min, uU/ml | 70-200; 0-0.05; 2-100 | Minimal-model glucose, remote insulin action, insulin [70] | Fasting basal (dossier 04) |

Derived (algebraic, not integrated): body weight BW, fat-free mass FFM, lean tissue L, total body water, TEE and
components, oxidation rates, DNL, GNG, ketogenesis, RQ, nitrogen balance.

---

## 3. Inputs that drive it

| Input | Unit | How it enters |
|---|---|---|
| Carbohydrate intake CI (digestible; net of fibre) | kcal/d (hourly: g/h) | Carb balance; suppresses lipolysis (L_diet), GNG_P; drives DNL, glycogen, ECF (sodium retention) [1,3] |
| Fat intake FI | kcal/d | 95.2% of TG energy to fat balance, 4.7% (glycerol) to GNG_F [1] |
| Protein intake PI | kcal/d | Protein balance; P_sig -> protein oxidation; GNG_P; TEF 25% [1] |
| Total energy intake EI = CI+FI+PI (+alcohol NEW) | kcal/d | TEF, adaptive thermogenesis (via dEI) [1,3] |
| Dietary sodium change dNa_diet | mg/d | ECF equation [1,3] |
| Non-exercise activity coefficient delta | kcal/kg/d | PAE = delta(1+sigma T)BW [1]; delta [3] |
| Exercise coefficient upsilon | kcal/kg/d | PAE += upsilon BW; lipolysis L_PA; protein-oxidation suppression S_A [1] |
| Resistance-training dose (NEW) | sets/session etc. | NOT in Hall models; drives MPS_RT / hypertrophy (dossier 09) |
| Meal times, eating window (NEW) | clock h | NOT in Hall models (daily averaged); hourly layer only |
| Sex, age, height, initial BW, initial %BF | - | Initial conditions: F0, FFM0, ECF0, RMR; Forbes constants; Mifflin RMR for delta [3] |
| Baseline (maintenance) intake and macro split CI_b, FI_b, PI_b | kcal/d | Normalises every flux; sets E_c/K by energy balance at t=0 [1,3] |

---

## 4. Mechanisms & equations

### 4.0 Architecture of the literature (what to use for what)

| Model | States | Macronutrients? | Validated against | Use in our engine |
|---|---|---|---|---|
| Hall 2010 [1] (and 2006 [2]) | G, F, P, ECF, dECF, T, L_diet, P_sig (8 ODEs) | Yes, full flux | Minnesota (fit), Jebb 1996, CALERIE-1, Rumpler 1991, de Boer 1986, Diaz 1992, Tremblay 1992, Schrauwen 1997, Smith 2000 (not used for fitting) | **Core daily-flux engine** (macronutrient-resolved) |
| Hall 2011 / NIDDK BWP [3] | F, L, G, ECF, AT | Carbs only via glycogen/ECF | CALERIE-1 (3 arms), inpatient VLCD, 30-d fasts; CALERIE-2 2-yr [18,19] | **Reduced model** for planner screening + regression tests |
| Chow & Hall 2008 [4] | F, L (or 1-D) | No | Theory | Stability analysis; p-ratio justification |
| Forbes 1987 / Hall 2007 [5,7] | algebraic | No | Cross-sectional + 20+ intervention data sets | Default partition law when protein/RT inputs are neutral |
| Thomas 2011 / PBRC Weight Loss Predictor [11,12] | F (1-D) | No | CALERIE-1, Bouchard twins; CALERIE-2 [18] | Cross-check only (biased in CALERIE-2 [18]) |
| Speakman & Westerterp 2013 [32]; Song & Thomas 2007 [31] | F, protein, glycogen | No | Hunger strikes, therapeutic fasts | Total-fast safety bounds |
| Torres et al. 2018 [33] | energy balance + hypertrophy | No | Elderly RT cohort (fit) | Template for dossier 09 extension |

Review of the modelling field: Hall 2012 [84]. Evidence grade for choosing Hall 2010 + Hall 2011 as backbone: **A** (validated against multiple independent
metabolic-ward and free-living studies with no re-fitting [1,3,18,19]).

---

### 4.1 Hall 2010 macronutrient-flux model (full) [1]

Plain language: the body stores energy as glycogen (G), fat (F) and protein (P). Each store's rate of change is
intake minus oxidation plus/minus inter-conversion fluxes (de novo lipogenesis DNL, gluconeogenesis from glycerol
GNG_F and amino acids GNG_P, glycerol-3-phosphate G3P, ketogenesis KTG). Total energy expenditure TEE = TEF + PAE +
RMR, where RMR includes organ metabolism plus the ATP cost of every flux. TEE (net of fixed fluxes) is split between
carbohydrate, fat and protein oxidation by weights that depend on glycogenolysis, lipolysis and proteolysis rates.
Eight ODEs; integrated in the paper with RK4, dt = 0.1 d. The model is explicitly **daily-averaged**: the author states it targets day-to-day
changes, not within-day fluctuations of metabolism [1].

Model code: the paper's Berkeley Madonna source is a PMC supplement
(`https://pmc.ncbi.nlm.nih.gov/articles/instance/2838532/bin/00559.2009_HallAJPModelCode.mmd`); it sits behind an
NCBI bot-check and was NOT retrieved for this review. Equations below are transcribed from the published appendix
(MathML), with transcription issues flagged.

#### 4.1.1 Macronutrient balance (Eq. 1 of [1])

```
rho_C * dG/dt = CI - DNL + GNG_P + GNG_F - G3P - CarbOx
rho_F * dF/dt = (3*M_FFA/M_TG)*FI + eps_d*DNL - KU_excr - (1 - eps_k)*KTG - FatOx
rho_P * dP/dt = PI - GNG_P - ProtOx
```
- rho_C = 4.18 kcal/g, rho_F = 9.44 kcal/g, rho_P = 4.7 kcal/g; M_TG = 860 g/mol, M_FFA = 273 g/mol
  (3*273/860 = 0.952 of dietary-fat energy goes to the fat store; the glycerol 4.7% goes to GNG_F).
- eps_d = 0.835 (energy retained when 1 g glucose -> 0.37 g fat); eps_k = 0.81 (4.5 mol acetoacetate from 1 mol
  stearate). CI, FI = digestible energy intakes; PI = digestible protein energy "corrected for the obligatory
  formation of ammonia" [1].
- Useful simplification (DERIVED by substituting Eq. 25 below): `rho_C dG/dt = CI - DNL - f_C*TEE~` and
  `rho_P dP/dt = PI - GNG_P - f_P*TEE~`.

#### 4.1.2 Body-composition bookkeeping (Eq. 2)
```
FFM = BM + ECF + ECP + LCM
    = BM + ECF + ECP + ICW^ + P*(1 + h_P) + G*(1 + h_G) + ICS
BW  = FFM + F
```
- BM (bone mineral) = 4% of initial BW; ECP (extracellular protein) constant from initial BM and ECF via Wang 2003
  [ref 108 of 1]. P/LCM = 0.25 and ICW/LCM = 0.70 at t = 0; ICW^ = constant chosen so that with G = 500 g,
  h_G = 2.7, h_P = 1.6 the initial composition is matched [1]. (Hall 2006 used P/CM = 0.2, h_P = 2 [2].)
- Implication: every 1 g glycogen lost removes 3.7 g body mass; every 1 g protein lost removes 2.6 g.

#### 4.1.3 Extracellular fluid and sodium (Eq. 3)
```
dECF/dt       = (1/[Na]) * ( dNa_diet - xi_Na*(ECF - ECF_init) - xi_CI*(1 - CI/CI_b) ) + dECF_slow
tau_BW * d(dECF_slow)/dt = xi_BW*(BW - BW_init) - dECF_slow
```
| Symbol | Value | Unit | Source / derivation |
|---|---|---|---|
| [Na] | 3.22 | mg/ml | [1] |
| xi_Na | 3 (= 3000 mg/L/d in [3]) | mg/ml/d | 5000 mg/d natriuresis after 1.7 L saline (Andersen 2002) [1] |
| xi_CI | 4000 | mg/d | Removing dietary carb doubles Na excretion vs very-low-Na diet (Stinebaugh & Schloeder 1966) [1] |
| xi_BW | 0.16 | ml/kg/d | Matches Silva ECF-weight regression at steady state [1] |
| tau_BW | 1000 | d | [1] |

Time dynamics (DERIVED): sodium time constant = [Na]/xi_Na = 3.22/3 = 1.07 d. Steady-state ECF change for a carb
cut (dNa = 0): dECF = -(xi_CI/xi_Na)(1 - CI/CI_b) L = -1.33 L x (fractional carb reduction); -0.53 L for a 40% carb
cut, -1.33 L for zero carbohydrate. Grade **C** (two small older studies calibrate xi; mechanism = insulin's
anti-natriuretic effect [3]).

#### 4.1.4 Total energy expenditure (Eqs. 4-10)
```
TEE = TEF + PAE + RMR
TEF = alpha_F*FI + alpha_P*PI + alpha_C*CI                  alpha_F=0.025, alpha_P=0.25, alpha_C=0.075
tau_T * dT/dt = lambda1*(dEI/EI_b) - T   if EI < EI_b        tau_T = 7 d, lambda1 = 0.74
              = lambda2*(dEI/EI_b) - T   otherwise           lambda2 = 0.02
PAE = delta*(1 + sigma*T)*BW + upsilon*BW                    sigma = 0.52
RMR = E_c + gamma_B*M_B + gamma_FFM*[FFM - M_B - dG*(1+h_G) - (ECF - ECF_init)] + gamma_F*F
      + (1-eps_d)*DNL + (1-eps_g)*(GNG_F + GNG_P) + (1-eps_k)*KTG + eta_N*N_excr
      + (eta_P + eps_P)*D_P + eta_P*dP/dt + eta_F*D_F + eta_F*dF/dt + eta_G*D_G + eta_G*dG/dt
gamma_FFM = gamma^_FFM * [1 + (1 - sigma)*T]
gamma^_FFM = sum_i gamma_i * dM_i/dFFM = 19 kcal/kg/d
```
Organ table used for gamma^_FFM (Elia 1992 via [1]):

| Organ | gamma_i (kcal/kg/d) | M_i (kg) | dM_i/dFFM |
|---|---|---|---|
| Skeletal muscle | 13 | 28 | 0.59 |
| Liver | 200 | 1.8 | 0.017 |
| Kidney | 440 | 0.31 | 0.0038 |
| Heart | 440 | 0.33 | 0.0029 |
| Residual lean | 12 | 23.2 | 0.37 |
| Brain (fixed mass, not in gamma^_FFM) | gamma_B = 240 | M_B = 1.4 | 0 |
| Adipose | gamma_F = 4.5 | - | - |

- eps_g = 0.8 (gluconeogenesis efficiency). Turnover costs (ATP-derived; 19 kcal of oxidation per mol ATP):
  eta_F = 0.18 kcal/g (8 ATP/TG), eta_G = 0.21 kcal/g (2 ATP/glycosyl), eta_P = 0.86 kcal/g (4 ATP/peptide bond +
  1 ATP transport), eps_P = 0.17 kcal/g (1 ATP/bond hydrolysed), eta_N = 5.4 kcal/g N (4 ATP/N, urea) [1].
- E_c is a constant solved so that the baseline diet is in the specified balance (Eq. 32); E_c = -435 kcal/d for the
  average Minnesota subject [1].
- Steady-state size of adaptive thermogenesis (DERIVED): a 50% intake cut gives T = -0.37, i.e. gamma_FFM -17.8% and
  NEAT coefficient -19%. lambda2 = 0.02 means essentially no adaptive thermogenesis in overfeeding.
- ALGEBRAIC LOOP (implementation note): RMR contains dF/dt, dP/dt, dG/dt, which themselves depend on TEE through
  the oxidation split (4.1.10). Everything is linear in TEE, so solve in closed form each step:
  `TEE*(1 + sum_X eta_X*f_X/rho_X) = A + sum_X eta_X*(a_X + f_X*b)/rho_X`, where A = TEE terms without the eta*dX/dt
  terms, a_X = the non-oxidative numerator of rho_X dX/dt, b = TEE - TEE~ (Eq. 26). (Hall 2011 does the same, Eq. 9
  in 4.2.)

Grade **A** for the structure (validated) / **B** for individual coefficients (ATP stoichiometry, Elia organ rates).

#### 4.1.5 Lipolysis (Eqs. 11-14)
```
D_F   = D^_F * (F/F_Keys)^(2/3) * [L_diet + L_PA]                 D^_F = 140 g/d
tau_L * dL_diet/dt = (see note)                                   tau_L = 1/ln2 = 1.44 d
k_L   = ln( (A_L - B_L)/(1 - B_L) )                               A_L = 3.8, B_L = 0.9  ->  k_L = 3.37
L_PA  = psi * ( (delta + upsilon)/(delta_init + upsilon_init) - 1 )   psi = 0.4
```
- As printed in [1]: `tau_L dL_diet/dt = K_L^S_L * [1 + (A_L-B_L)*exp(-k_L*CI/CI_b) + B_L] / (K_L^S_L + MAX{0,(F/F_Keys-1)^S_L}) - L_diet`,
  K_L = 4, S_L = 2. **Transcription issue:** at CI = CI_b the bracket (A_L-B_L)e^-k_L + B_L equals 1 by
  construction of k_L, so the printed form gives L_diet = 2 at baseline, contradicting the text (k_L is stated to normalise
  lipolysis on the baseline diet) and the baseline constraint Eq. 36 (which requires
  D_F = D^_F (F/F_Keys)^(2/3), i.e. L_diet = 1). The form consistent with the text, with Hall 2006 Eq. 11 [2] and
  with Eq. 36 is (our reading, use this):
```
tau_L * dL_diet/dt = 1 + K_L^S_L * [ (A_L - B_L)*exp(-k_L*CI/CI_b) + B_L - 1 ]
                         / ( K_L^S_L + MAX{0, F/F_Keys - 1}^S_L )  -  L_diet
```
- Behaviour (DERIVED): zero carbohydrate -> L_diet -> 3.8 (lean), halving carbohydrate -> 1.44 (text: "factor of
  1.4" [1]). Obesity attenuation K^2/(K^2 + (F/F_Keys-1)^2): 0.94 at 2x F_Keys, 0.80 at 3x, 0.50 at 5x.
- A_L = 3.1/[1 - exp(-2.5/tau_L)] = 3.76 converts the 3.1-fold glycerol Ra rise after a 60-h fast (Carlson 1994)
  into the steady-state amplitude of the first-order lag [1]. B_L: 33% vs 66% carb meal FFA AUC (Wolever 1995).
- The 2/3 power: basal lipolysis scales with adipocyte surface area (Bjorntorp 1969) [1].
- F_Keys = initial fat mass of the average Minnesota subject (Hall 2006 Fig. 3 legend: "the original 9 kg of body
  fat mass" [2]); exact value used in the code UNVERIFIED.
- Grade **B** (human tracer data; single-study calibrations).

#### 4.1.6 Ketogenesis, excretion, ketone oxidation (Eqs. 15-17)
```
KTG     = rho_K * D_F * [ A_K * (x/(K_K + x)) * exp(-k_P*PI/PI_b) * exp(-k_G*G/G_init) ],  x = D_F/D^_F
KU_excr = 0                                                    if KTG/rho_K < KTG_thresh
        = rho_K * KU_max * (KTG/rho_K - KTG_thresh)/(KTG_max - KTG_thresh)   otherwise
KetOx   = KTG - KU_excr
```
| Symbol | Value | Meaning / source [1] |
|---|---|---|
| rho_K | 4.45 kcal/g | BHB:AcAc 2:1 combustion enthalpy |
| A_K | 0.8 | max fraction of lipolysed FFA -> ketones when PI = G = 0 (Balasse & Fery 1989 [76]) |
| k_P | 0.69 = ln(0.8/0.4) | protein-modified fast halves ketones vs fasting (Vazquez 1985) |
| k_G | 0.69 = ln(0.4/0.2) | normal glycogen halves again |
| K_K | 1 | gives 10% of FFA -> ketones at baseline |
| KTG_thresh / KU_max / KTG_max | 70 / 20 / 400 g/d | renal threshold, max urinary loss, max production (Wildenhoff 1977; Sapir & Owen 1975) |

- Baseline KTG (DERIVED): 4.45 x 140 x 0.1 = 62 kcal/d (about 14 g/d).
- The model outputs a **flux**, not a plasma concentration; no keto-adaptation time course (weeks) is represented.
  Grade **C** (anchors are qualitative ratios). Hand-off: dossier 05 must supply BHB concentration and adaptation.

#### 4.1.7 Proteolysis, glycogenolysis, synthesis (Eqs. 18-20)
```
D_P = D^_P * [ P/P_Keys + chi*(dPI/PI_b) ]          D^_P = 300 g/d, chi = 0 (kept as a hook)
D_G = D^_G * (G/G_init)                              D^_G = 180 g/d (70% hepatic, 30% muscle)
Synth_X = D_X + dX/dt   for X in {F, P, G}
```
Grade **B** (whole-body tracer turnover averages).

#### 4.1.8 Glycerol, G3P and gluconeogenesis (Eqs. 21-23)
```
G3P   = rho_C * Synth_F * (M_G/M_TG)                              M_G = 92 g/mol
GNG_F = FI*(rho_C*M_G)/(rho_F*M_TG) + D_F*rho_C*(M_G/M_TG)        (all glycerol -> glucose; Trimmer)
GNG_P = GNG^_P * [ P/P_Keys - Gamma_C*(dCI/CI_b) + (Gamma_P + chi)*(dPI/PI_b) ]
```
GNG^_P = 300 kcal/d (net amino-acid GNG, Jungas 1992); Gamma_C = 0.39 (N balance -4 g/d on removing carbs, Hoffer
1984); Gamma_P = 0.32 (GNG +56% with 2.5x protein and -20% carbs, Linn 2000) [1]. Basal glycerol GNG energy cost only
25 kcal/d [1]. Grade **B/C**.

#### 4.1.9 De novo lipogenesis (Eq. 24)
```
DNL = CI * (G/G_init)^d / ( (G/G_init)^d + K_DNL^d )        K_DNL = 2, d = 4
```
At baseline G = G_init: DNL = CI/17 (DERIVED; about 107 kcal/d on the Minnesota 1826 kcal/d carbohydrate diet,
consistent with "basal DNL about 100 kcal/d" [2]). Calibrated to Aarsland 1997, Acheson 1988, Hudgins 2000,
Strawford 2004 [1]. Grade **B**.

#### 4.1.10 Oxidation partition (Eqs. 25-27)
```
CarbOx  = GNG_F + GNG_P - G3P + f_C * TEE~
FatOx   = KetOx + f_F * TEE~
ProtOx  = f_P * TEE~
TEE~    = TEE - (1-eps_d)*DNL - (1-eps_k)*KTG - KetOx - GNG_F - GNG_P + G3P

f_C = [ w_G*(D_G/D^_G) + w_C*MAX{0, 1 + S_C*dCI/CI_b} * G/(G_min + G) ] / Z
f_F = [ w_F*(D_F/D^_F) ] / Z
f_P = [ w_P*MAX{0, 1 + P_sig} + (D_P/D^_P)*S_A*exp(-k_A*(delta+upsilon)/(delta_b+upsilon_b)) ] / Z
Z   = sum of the three numerators;   k_A = ln(S_A);   G_min = 10 g
tau_PI * dP_sig/dt = S_P * dPI/PI_b - P_sig,  S_P = S_P+ if dPI > 0 else S_P-,   tau_PI = 1.1 d
```
Physiology encoded: lipolysis drives fat oxidation; carbohydrate intake and glycogen drive carbohydrate oxidation;
protein intake drives protein oxidation (with 1.1-d lag, Rand 1976); dietary fat does NOT stimulate its own
oxidation; more activity lowers the protein share of oxidation [1]. Grade **A/B** (validated RQ time courses:
Schrauwen 30->60% fat; Smith 37->50% fat; Jebb 12-d chamber [1]).

#### 4.1.11 Gas exchange and nitrogen (Eqs. 28-31)
```
VO2  = 0.831*CarbOx/rho_C + 2.03*FatOx/rho_F + 0.966*ProtOx/rho_P + 0.133*(GNG_F - G3P)/rho_C + 0.33*KU_excr/rho_K
VCO2 = 0.831*CarbOx/rho_C + 1.43*FatOx/rho_F + 0.782*ProtOx/rho_P - 0.126*GNG_P/rho_P + 0.238*DNL/rho_C
RQ   = VCO2/VO2
N_excr = (ProtOx + GNG_P)/(6.25*rho_P)
```
(In the published stoichiometry line "1 g fat + 2.03 liters CO2" is a typo for O2 [1]; the VO2 equation uses 2.03
for O2.) Use: RQ and nitrogen balance outputs; DLW/indirect-calorimetry unit tests.

#### 4.1.12 Initialisation and parameter constraints (Eqs. 32-67)
Algorithm for a new user (from [1]; weights are subject-specific, not constants):
1. Set F0, FFM0, ECF0 (Silva regression [80]), BM = 0.04 BW0, ECP (Wang 2003), G_init = 500 g, P_init = 0.25 LCM.
2. Choose baseline intakes CI_b, FI_b, PI_b and imbalance terms F_imbal, G_imbal, P_imbal (0 for weight-stable).
3. Evaluate baseline fluxes (D_F, D_P, D_G, DNL_b, KTG_b, GNG_b, G3P_b) and baseline oxidation (Eq. 33):
   `CarbOx_b = CI_b - DNL_b + GNG^_P + GNG^_F - G3P_b - G_imbal`,
   `FatOx_b = 0.952 FI_b + eps_d DNL_b - (1-eps_k) KTG_b - F_imbal`, `ProtOx_b = PI_b - GNG^_P - P_imbal`.
4. Required baseline fractions zeta_C, zeta_F, zeta_P (Eq. 34-35); robust equivalent: f_X,b = (Ox_X,b minus the
   fixed terms of Eq. 25)/TEE~_b.
5. Solve weights (our clean algebra from Eq. 36; the printed Eq. 37 is garbled in the HTML):
   `w_G = (zeta_C/zeta_P) * (p + w_P) / (g + w_CG * c)`, `w_C = w_CG * w_G`,
   `w_F = (zeta_F/(1-zeta_F)) * (1 + zeta_C/zeta_P) * (p + w_P) / f`,
   with p = P_init/P_Keys, g = G_init/G_Keys, c = G_init/(G_init + G_min), f = (F_init/F_Keys)^(2/3),
   w_P = 1.1, w_CG = 0.93.
6. S_C = 0.85 and S_P+ = 3.8 are constants (carbohydrate- and protein-perturbation constraints, Eqs. 38-61, from
   Horton 1995: kappa_C = 0.5 of +1500 kcal/d CHO stored as glycogen initially; Oddoye & Margen 1979: 90% of extra
   protein N excreted, kappa_P = 0.1). S_A from the bed-rest constraint (Eq. 66: N balance -2 g/d over 17 d, Stein
   1999): `S_A = MAX{1, (P_Keys/P_init)*[Xi/(1-Xi)*(w_C + w~_G + w~_F) - w_P]}`.
7. E_c from the energy-balance identity Eq. 32 (baseline TEE + imbalances = EI_b).
Note a normalisation inconsistency in [1]: Eq. 19 uses G/G_init, Eq. 36 uses G_init/G_Keys; identical when
G_init = G_Keys = 500 g (Hall's default). Keep G_init = 500 g x (scaling in 4.9 only if dossier 04 insists).

#### 4.1.13 Parameter tables (verbatim values from [1])
Table 1 (literature): rho_F 9.44 kcal/g; rho_P 4.7; rho_G 4.18; rho_K 4.45; h_P 1.6 g/g; h_G 2.7 g/g; eta_F 0.18
kcal/g; eta_P 0.86; eps_P 0.17; eta_G 0.21; eta_N 5.4 kcal/gN; eps_d 0.835; eps_g 0.8; eps_k 0.81; alpha_F 0.025;
alpha_C 0.075; alpha_P 0.25; gamma_F 4.5 kcal/kg/d; gamma^_FFM 19; xi_BW 0.16; xi_CI 4000 mg/d; xi_Na 3 mg/ml/d;
tau_BW 1000 d; tau_T 7 d; D^_G 180 g/d; K_DNL 2; d 4; D^_F 140 g/d; A_L 3.8; B_L 0.9; tau_L 1.44 d; K_L 4; S_L 2;
psi 0.4; A_K 0.8; k_P 0.69; k_G 0.69; K_K 1; KTG_thresh 70 g/d; KU_max 20 g/d; KTG_max 400 g/d; D^_P 300 g/d; chi 0;
GNG^_P 300 kcal/d; Gamma_C 0.39; Gamma_P 0.32; tau_PI 1.1 d.
Table 2 (fit to Minnesota; weights on BW 0.2 kg, FM 0.5 kg, RMR 50 kcal/d): lambda1 0.74; lambda2 0.02; sigma 0.52;
w_P 1.1; w_CG 0.93; S_P- 1.7.
Table 3 (constraints; Minnesota subject values): S_P+ 3.8; S_C 0.85; w_G 9.4; w_F 14.8; E_c -435 kcal/d.
Hall 2006 [2] differences (for reference only): rho_C 4.2, rho_F 9.4, h_P 2, gamma^_BCM 24 kcal/kg/d, A_L 3.1,
GNG^_P 100 kcal/d, Gamma_C 0.5, Gamma_P 0.3, eps_d 0.8, single lambda 0.8, sigma 0.6, delta_b 26 and delta_s 9
kcal/kg/d (activity fell linearly during Minnesota semistarvation).

#### 4.1.14 Moderators captured / not captured by Hall 2010
Captured: initial body fat (lipolysis ~F^(2/3) and obesity attenuation; partition emerges from fluxes), dietary
macronutrient mix, protein intake (P_sig, GNG_P), sodium, activity level (PAE, lipolysis, protein oxidation).
Not captured: sex (except via initial composition), age, training status, resistance exercise, meal timing,
hormones explicitly (the author notes insulin effects are only implicit [1]), alcohol,
fibre, appetite.

---
### 4.2 Hall 2011 Lancet two-compartment model = NIDDK Body Weight Planner (web appendix [3])

Plain language: body weight = fat (F) + lean tissue (L) + glycogen with its water + ECF. An energy imbalance (after
subtracting what goes into glycogen) is split between fat and lean by the Forbes-derived partition p = C/(C+F).
Energy expenditure = constant + tissue-specific RMR terms + weight-proportional physical activity + change in TEF +
adaptive thermogenesis + synthesis costs of new tissue. All in MJ, kg, days.

#### 4.2.1 Fast compartments (web appendix Eqs. 1-2)
```
rho_G * dG/dt = CI - k_G * G^2              rho_G = 17.6 MJ/kg, k_G = CI_b / G_init^2, G_init ~ 0.5 kg
dECF/dt = (1/[Na]) * ( dNa_diet - xi_Na*(ECF - ECF_init) - xi_CI*(1 - CI/CI_b) )
          [Na] = 3.22 mg/ml, xi_Na = 3000 mg/L/d, xi_CI = 4000 mg/d
```
- Quadratic sink chosen so that ~3-fold CI increase raises glycogen ~1.8-fold (Aarsland 1997, Acheson 1988) [3].
  Each g glycogen carries 2.7 g water (McBride 1941) [3].
- Steady state (DERIVED): G_ss = G_init * sqrt(CI/CI_b). Linearised time constant tau_G = rho_G*G_init/(2*CI_b)
  = 0.70 d for CI_b = 6.3 MJ/d (50% of 12.65 MJ/d). So a 40% carbohydrate cut removes 0.11 kg glycogen + 0.31 kg
  water within ~2-3 days, plus 0.53 L ECF (tau 1.07 d).

#### 4.2.2 Energy partitioning (Eq. 3)
```
rho_F * dF/dt = (1 - p) * (EI - EE - rho_G*dG/dt)
rho_L * dL/dt =      p  * (EI - EE - rho_G*dG/dt)
p = C/(C + F),   C = 10.4 kg * rho_L/rho_F = 2.0 kg (DERIVED)
rho_F = 39.5 MJ/kg,  rho_L = 7.6 MJ/kg
```
p is an energy fraction (the P-ratio). The corresponding mass fraction of lean in the weight change is Forbes'
10.4/(10.4 + F).

#### 4.2.3 Initial fat mass if not measured (Eq. 4; Jackson et al. 2002 [78])
```
F_men   = (BW/100) * [0.14*age + 37.31*ln(BW/H^2) - 103.94]
F_women = (BW/100) * [0.14*age + 39.96*ln(BW/H^2) - 102.01]       BW kg, H m, age y
L0 = BW0 - F0 - ECF0 - G0*(1 + 2.7)
```

#### 4.2.4 Energy expenditure (Eqs. 5-9)
```
EE  = K + gamma_F*F + gamma_L*L + delta*BW + TEF + AT + eta_L*dL/dt + eta_F*dF/dt
TEF = beta_TEF * dEI                       beta_TEF = 0.1  (change from baseline only; baseline TEF inside K)
tau_AT * dAT/dt = beta_AT * dEI - AT       beta_AT = 0.14, tau_AT = 14 d
delta = [ (1 - beta_TEF)*PAL - 1 ] * RMR / BW      RMR by Mifflin-St Jeor [77]; sedentary PAL 1.5 -> delta ~ 30 kJ/kg/d
gamma_F = 13 kJ/kg/d, gamma_L = 92 kJ/kg/d (Nelson 1992 regression [85]); eta_F = 750 kJ/kg, eta_L = 960 kJ/kg (Hall 2010 BJN [22])
K from EE(t=0) = EI_b.
Closed form (Eq. 9):
EE = [ K + gamma_F*F + gamma_L*L + delta*BW + TEF + AT + (EI - rho_G*dG/dt)*(p*eta_L/rho_L + (1-p)*eta_F/rho_F) ]
     / [ 1 + p*eta_L/rho_L + (1-p)*eta_F/rho_F ]
```
beta_AT = 0.14 came from Hall & Jordan 2008 (8 longitudinal weight-loss studies, 157 subjects, 7-54 kg stable
losses; R^2 0.83 for weight change) [21].

#### 4.2.5 Linearised long-term dynamics (Eqs. 10-18)
After ~several weeks glycogen/ECF are stable and AT -> beta_AT*dEI, giving
```
rho * dBW/dt = dEI - eps*(BW - BW0)
rho = (eta_F + rho_F + alpha*eta_L + alpha*rho_L) / ((1 - beta)*(1 + alpha))
eps = (1/(1 - beta)) * [ (gamma_F + alpha*gamma_L)/(1 + alpha) + delta ]
tau = rho/eps = (eta_F + rho_F + alpha*(eta_L + rho_L)) / (gamma_F + delta + alpha*(gamma_L + delta))
alpha = dL/dF = 10.4/F0 (kg),   beta = beta_AT + beta_TEF = 0.24
Steady state: dBW = [ (1 - beta)*dEI - BW_init*d_delta ] / [ delta_init + d_delta + gamma_L - Phi*(gamma_L - gamma_F) ],
Phi = dF/dBW
Diet-vs-activity break-even: Gamma = (beta/(1-beta)) * [ delta_init + Phi*gamma_F + (1-Phi)*gamma_L ] * BW_init
```
Below Gamma an energy-equivalent activity increase (d_delta = Gamma/BW_init) loses more weight than the same diet
cut; above it the diet cut wins [3]. tau falls with more activity (delta only in denominator) and rises with fatness.

DERIVED values (sedentary delta = 0.030 MJ/kg/d):

| F0 (kg) | p (energy) | lean mass fraction 10.4/(10.4+F) | effective energy density of weight change (MJ/kg; kcal/kg) | tau (d) | half-life (d) | eps (kJ/kg/d) |
|---|---|---|---|---|---|---|
| 5 | 0.286 | 0.675 | 18.0; 4292 | 196 | 136 | 127 |
| 10 | 0.167 | 0.510 | 23.2; 5554 | 289 | 201 | 110 |
| 20 | 0.091 | 0.342 | 28.6; 6832 | 420 | 291 | 92 |
| 30 | 0.063 | 0.257 | 31.3; 7478 | 507 | 351 | 83 |
| 40 | 0.048 | 0.206 | 32.9; 7867 | 568 | 394 | 78 |
| 60 | 0.032 | 0.148 | 34.8; 8314 | 651 | 451 | 72 |

(Energy density column excludes synthesis costs and the 1/(1-beta) factor; it is the pure tissue energy per kg.)
Published rules of thumb [3]: every 100 kJ/d (24 kcal/d) sustained intake change -> ~1 kg eventual weight change
(10 kcal/d per lb); half of it in ~1 y, 95% in ~3 y (overweight adult). Population slope 100 kJ/kg/d (model) vs
94 +- 6 kJ/kg/d (cross-sectional DLW regression) [3].

The same linearisation, solved for intake, underlies the weight-based intake calculator (see [19,20]; Thomas 2010 [13]
uses DXA/DLW-based back-calculation of intake). Individual-level linear parameters actually used in validations:
- Sanghvi 2015 (CALERIE-2, n = 140, age 21-51, BMI 21-29, PAL assumed ~1.6): rho = 8840 +- 450 kcal/kg,
  eps = 25.8 +- 1.0 kcal/kg/d; `dEI = rho*dBW/dt + eps*dBW` [19].
- Guo, Brager & Hall 2018 (CALERIE-2 means, NIH BWP linearised): women rho 9916 kcal/kg, eps 24 kcal/kg/d, tau 414 d;
  men rho 9383, eps 28, tau 340 d, extra adaptation f = 0. PBRC WLP linearised: women rho 8860, eps 38, f 106 kcal/d,
  tau 230 d; men rho 8230, eps 43, f 134, tau 190 d [18].
Grade **A** (validated in controlled and 2-year free-living data [3,18,19]).

#### 4.2.6 Reimplementation check (DERIVED; code in 4.12)
Our Python reimplementation of Eqs. 1-9 (ECF0 set to 0.2*BW as a placeholder because the Silva regression was not
reproduced; carbohydrate 50% of intake) reproduces the paper's worked example (100 kg, 1.80 m, 23-y sedentary man;
baseline 12.65 MJ/d; -5 MJ/d for 180 d, then 10.9 MJ/d): BW 79.96 kg at day 180, 80.7 kg at days 365-730 (paper:
lose 20 kg in 6 months then maintain at 10.9 MJ/d [3]). For a permanent -2 MJ/d step: BW 87.1 kg at 1 y, 79.3 kg at
3 y, 78.1 kg at 10 y (94.5% of the final change by 3 y; paper: plateau "about 75 kg", 95% by ~3 y [3]). The ~3 kg
difference in the plateau is unexplained (probably ECF initialisation or unpublished implementation details) - use
+-3 kg tolerance in regression tests. First-week loss in the -5 MJ/d case: 1.83 kg, of which 0.11 kg glycogen +
0.30 kg glycogen water + 0.53 L ECF.

---

### 4.3 Forbes curve, Hall 2007 extension, P-ratio (Dugdale & Payne), Chow & Hall energy-partition model

#### 4.3.1 Forbes (1987, 2000) [7,8]
```
FFM = 10.4 * ln(FM) + 14.2          (women of similar stature, kg; cross-sectional)  [5]
dFFM/dBW = 10.4 / (10.4 + FM)       (infinitesimal weight change)                   [5]
```
Also written FFM = 10.4 ln(F/D), D ~ 2.55 (women); men: FFM = 13.8 ln(F/S), S ~ 0.29 (NHANES-based, ~200 men of
average stature, Thomas et al. [11,14]). Forbes 2000 summary: in overfeeding >= 3 weeks, weight gain of thin people is
60-70% lean, of obese 30-40%; lean fraction of loss rises as energy intake is reduced further; the same holds for
exercise-induced loss; in discordant twins lean is ~1/2 of the weight difference in thin and ~1/4 in obese [8].

#### 4.3.2 Hall 2007 macroscopic extension [5] and Hall 2008 energy density [6]
Moving along the Forbes curve for a finite change dBW (derivation reproduced and checked):
```
FM_f = 10.4 * W( (1/10.4) * exp(dBW/10.4) * FM_i * exp(FM_i/10.4) )           W = Lambert-W function
dFFM/dBW = 1 + FM_i/dBW - (10.4/dBW) * W( (1/10.4) * exp(dBW/10.4) * FM_i * exp(FM_i/10.4) )
dE/dBW   = rho_F + (rho_L - rho_F) * dFFM/dBW       rho_F = 39.5 MJ/kg, rho_L = 7.6 MJ/kg   [6]
P-ratio  PR = (dFFM/dBW) / [ dFFM/dBW + a*(1 - dFFM/dBW) ],   a = 9.05 (FM:FFM energy-density ratio, Dulloo) [5]
```
- Larger losses take a larger lean fraction (Forbes' original equation under-predicts FFM loss after bariatric
  surgery: Das 2003 measured 11.3 kg vs Forbes 6.7 kg vs Hall-2007 9.9 kg) [5].
- Hall 2008 energy density of weight loss (DERIVED from the formula; MJ/kg for losses of 5 / 15 / 25 kg):
  FM_i 10 kg: 22.2 / 20.0 / 17.9; 20 kg: 28.0 / 26.5 / 24.7; 30 kg: 30.9 / 30.0 / 28.8; 40 kg: 32.6 / 32.0 / 31.2;
  60 kg: 34.6 / 34.3 / 33.9. The 3500 kcal/lb rule = 32.2 MJ/kg is matched only when FM_i > ~30-40 kg [6].
  NOTE: the paper's worked example ("15 kg loss, 20 kg initial fat -> 24.7 MJ/kg") matches our evaluation of its own
  formula only for a 25 kg loss (15 kg gives 26.5 MJ/kg); treat the example as a typo, use the formula.
- rho_L = 7.6 MJ/kg rests on h = 1.6 g water/g protein (osmotically unresponsive water, 1.1-2.2 g/g); alternatives:
  h = 3.8 (TBW/protein) -> 4.0 MJ/kg; h = 2.8 (ICW/protein) -> 5.6 MJ/kg [6]; Speakman uses 6.5-8.5 MJ/kg, Alpert
  8.5 MJ/kg [32]. Predictions are fairly insensitive (a 15 kg loss from 20 kg fat changes by 6.5% between h = 1.6 and
  3.8 [6]).
Grade **A** for obese/overweight group means, **B** for lean individuals.

#### 4.3.3 P-ratio (Dugdale & Payne 1977 [9,10]) and energy-partition models (Chow & Hall 2008 [4])
- P-ratio = fraction of an energy imbalance accounted for by body protein change (Dugdale & Payne; originally assumed
  constant per individual) [5]. Dulloo's Minnesota reanalysis (reviewed in [50]): P-ratio varies widely between men, is correlated
  within an individual between semistarvation and refeeding, and is predicted mainly by initial %fat (higher fat ->
  lower P-ratio) [47,49].
- Chow & Hall reduce the three-compartment flux model (fat F, glycogen G, protein P) to two dimensions using
  dG/dt ~ 0 on time scales > 1 day:
```
rho_F dF/dt = I_F - f*E ;   rho_L dL/dt = I_L - (1 - f)*E ;  rho_L = rho_P/(1 + h_P) = 7.6 MJ/kg
f = fraction of expenditure from fat;  I_L = I_P + I_C
Energy-partition form (f from Forbes):  rho_F dF/dt = (1 - p)(I - E);  rho_L dL/dt = p(I - E);  p = 1/(1 + alpha), alpha = (rho_F/rho_L)(F/10.4)
1-D along Forbes path: dF/dt = F / (rho_F*F + 10.4*rho_L) * [ I - E(F, 10.4*ln(F/D)) ]
Constant-p linearisation: rho_M dM/dt = mu - eps*(M - M0),  rho_M = rho_F*rho_L / (rho_L + (rho_F - rho_L)*p)
```
- Key theoretical result: any energy-partition model (p a function of body composition) has an **invariant manifold**
  (a continuum of body compositions consistent with the same intake) rather than a unique fixed point; the
  macronutrient-flux form has a unique stable fixed point only if f increases with F and decreases with L; existing
  data cannot distinguish the two [4]. Engineering consequence: a pure-Forbes engine has no restoring force for body
  composition after a transient (e.g. RT-induced lean gain persists indefinitely unless another term removes it).
Grade **B**.

#### 4.3.4 How partitioning changes with fatness, deficit size, protein, resistance training
| Moderator | Direction | Quantification | In Hall models? |
|---|---|---|---|
| Initial fatness | More fat -> smaller lean fraction | Forbes/Hall 2007 table above; Speakman: R_fat = 0.489 + 0.547*P_fat (energy fraction from fat vs fat fraction of body energy; 592 adults, R^2 0.98) [32] | Yes |
| Size of deficit / weight loss | Bigger loss -> larger lean fraction | Hall 2007 Lambert-W form [5]; Forbes 2000 [8] | 2007 form yes; BWP only via F |
| Protein intake | More protein -> more lean retained / gained | Longland 2016: 40% deficit + RT/HIIT 6 d/wk, 4 wk, young men: 2.4 vs 1.2 g/kg/d -> LBM +1.2 +- 1.0 vs +0.1 +- 1.0 kg; FM -4.8 +- 1.6 vs -3.5 +- 1.4 kg [63]. Overfeeding (+954 kcal/d, 8 wk): 5% protein gained 3.16 kg vs 6.05 (15%) and 6.51 kg (25%); lean +2.87 / +3.18 kg with 15% / 25%; fat gain similar [60] | Hall 2010 partly (P_sig, GNG_P); BWP no |
| Resistance training | Preserves/gains lean in deficit | Meta-regression: deficit of ~500 kcal/d prevents RT lean gains (ES -0.57 vs non-deficit) but strength gains preserved [64]; athletes losing 0.7%/wk gained 2.1% LBM vs -0.2% at 1.4%/wk [65] | **No** (Hall et al. state that exercise effects on body composition were not yet modelled [3]) |
| Rate of loss | Slower -> better lean retention (with RT) | Garthe 2011 [65] | No |
| Sex | Women's weight change more fat per kg at same BW | Kiel: energy content of loss 6804 +- 226 (women) vs 6119 +- 240 kcal/kg (men) [35]; Hall 2008 [6] | Only via initial composition |

Flag for dossiers 03 and 09: protein dose, per-meal distribution, RT volume, training status and age must modify
the partition (p or the protein-balance equation). The Hall/Forbes partition should be treated as the
"no-training, habitual-protein" default.

---

### 4.4 Thomas / Pennington models (PBRC Weight Loss Predictor) [11-17]

#### 4.4.1 Thomas et al. 2011 J Biol Dyn ("Heymsfield model"; basis of the PBRC predictor) [11]
```
R = I - E = c_l * dFFM/dt + c_f * dF/dt            c_l = 1100 kcal/kg, c_f = 9500 kcal/kg
FFM = polynomial(F, age, height) (NHANES DXA; 4th order):
 women: FFM = -72.1 + 2.5F - 0.04A + 0.7H - 0.002A - 0.01F*H - 0.04F^2 + 0.0003F^2*A + 0.0000004F^4 + 0.0002F^3 + 0.0003F^2*H - 0.000002F^3*H
 men:   FFM = -71.7 + 3.6F - 0.04A + 0.7H - 0.002F*A - 0.01F*H + 0.00003F^2*A - 0.07F^2 + 0.0006F^3 - 0.000002F^4 + 0.0003F^2*H - 0.000002F^3*H
 (F kg, H cm, A = A0 + t/365 y; printed as in [11]; the women's "-0.002A" term is printed without F and is probably F*A)
E = DIT + PA + RMR + SPA
DIT = beta*I ; beta = 0.075 baseline; 1.0 multiplier CR, 1.19 overfeeding (0.075-0.086 range)
PA  = m*W,  m = PA(0)/W(0);   PA(0) = TEE(0) - DIT(0) - SPA(0) - RMR(0) (floored at 0)
RMR = (1 - a) * (a_i*W^p_i - y_i*(A0 + t/365))   Livingston-Kohlstadt [79]: a_M 293, a_F 248, p_M 0.4330, p_F 0.4356, y_M 5.92, y_F 5.09
      a = 0.02 metabolic adaptation in CR (0 in overfeeding)
SPA = (s/(1 - s)) * (DIT + PA + RMR) + C,  SPA(0) = 0.326*E(0);  s = 0.67 underfeeding, 0.56 overfeeding
Baseline E from IOM DLW regression: E_F = 0.0278W^2 + 9.2893W + 1528.9 ; E_M = -0.0971W^2 + 40.853W + 323.59 (kcal/d)
```
Validation: CALERIE-1 CR + VLCD subjects (intake from DXA+DLW): mean 24-wk weight predicted 73.9 vs observed 72.6 kg;
individual MAE 1.8 +- 1.3 kg (max 4.3) vs 4.5 +- 3.3 kg (max 12) for the Chow-Hall 1-D model with E = 238.85(0.14 FFM +
0.05 F + 1.55) [11]. Model valid only if intake exceeds expenditure at zero fat (numerically fails below roughly
1000 kcal/d) [11]. Earlier version (Thomas 2009 [12]): linear FFM = alpha1*F + b, NEAT change = r * total EE change
(r from Levine 1999: dNEAT = 2/3 dE), storage efficiency e ~ 0.82-0.83 (Christiansen-Garby-Sorensen [29]).

#### 4.4.2 Adherence model (Thomas 2014) [17]
- Same dynamic model; intake on each day is the prescription with probability = monthly adherence, otherwise a
  back-calculated over/under amount (uniform random variable). Reproduces the 6-month plateau of free-living trials
  with realistic adherence; adding 5-10% extra EE suppression beyond the model's adaptation raises the plateau weight
  (10% -> +11% plateau weight) but does NOT move the plateau earlier (still 1-2 y) [17].
- Validation: CALERIE-1 (n = 23) 3 mo R^2 0.99, bias 0.4 kg (95% LoA -2.4, 3.2); 6 mo R^2 0.96, bias 2.2 kg (-2.4,
  6.8); Bouchard twins overfeeding R^2 0.93, bias 0.9 kg (-3.7, 5.5) [17].
- Weight-loss half-life depends on PAL, energy densities (9500 and 1020 kcal/kg), Forbes slope 10.4, Mifflin weight
  coefficient and FM0 [17].

#### 4.4.3 Head-to-head comparison (Guo, Brager & Hall 2018, CALERIE-2, 78 women, 35 men, 2 y) [18]
| Metric (mean bias, model - measured) | NIH BWP (Hall 2011) | PBRC WLP (Thomas 2011) |
|---|---|---|
| Body weight change | -0.47 (-0.92, -0.015) kg | +3.8 (3.5, 4.2) kg (under-predicts loss) |
| Fat mass change | +0.78 (0.48, 1.1) kg | +3.0 (2.7, 3.3) kg |
| Energy expenditure change | -14 (-28, 0.03) kcal/d | -45 (-60, -31) kcal/d |
- Cause: PBRC assumes two-thirds of the EE change is SPA; with 25% less SPA sensitivity its eps falls to 23/26
  kcal/kg/d (women/men), close to NIH BWP [18].
- Measurement error explained ~55-58% of the individual variance of weight change and ~48% of fat change [18].
Also: Thomas 2013 (7 supervised studies, 103 adults, 64.8 +- 23.6 d, deficit 1439 +- 784 kcal/d): actual loss
20.1 +- 11.3 lb vs 3500-kcal rule 27.6 +- 16.0 lb; dynamic model 18.4 +- 13.8 lb vs actual 17.0 +- 11.0 lb in the
5 simulable studies [15].
Grade: NIH BWP **A**; PBRC **B** (biased in 2-y data).

---

### 4.5 Other published models (for comparison; not recommended as core)
| Model | Core idea | Key numbers | Verdict |
|---|---|---|---|
| Antonetti 1973 [26] | Early one-compartment energy-balance ODE | Chow & Hall class it with constant-p energy-partition models [4]; equations UNVERIFIED (full text not accessed) | Historical |
| Payne & Dugdale 1977 [10] | Constant P-ratio partition model | P-ratio per individual [9] | Superseded by F-dependent p |
| Alpert 1979 two-reservoir [25]; Alpert 2005 [23] | Fat + lean reservoirs; capped fat transfer | 290 +- 25 kJ/kg FM/d cap; hypophagic RMR slope 249 +- 25 kJ/kg FFM/d [23] | See 4.6 |
| Westerterp et al. 1995 [27] | FM/FFM changes as functions of EI/EE ratio and composition; BMR from FFM, FM; PA as multiple of BMR | Validated vs 3 studies within measurement precision [27]; equations UNVERIFIED | Alternative, less mechanistic |
| Kozusko 2001 [28] | Set-point model; RMR via Kleiber W^0.75 with metabolic adaptation; applied to Minnesota individuals | Abstract only [28] | Set-point assumption not needed |
| Christiansen, Garby & Sorensen 2005 [29] | Energy cost of storage | storage efficiency ~0.83 (women), 0.82 (men) as used by [12] | Hall uses eta_F/eta_L instead |
| Flatt 2004 [30] | Two-compartment carbohydrate-fat model with glycogen | - | Subsumed by Hall 2010 |
| Song & Thomas 2007 [31] | Starvation model with fat, lean and ketone-body masses; fitted to 7 d of fasting | - | Fasting extension idea |
| Speakman & Westerterp 2013 [32] | Total starvation: (1+lambda)E_bee = -(E_gly + E_fat + E_prot); R_fat = 0.489 + 0.547 P_fat; death at BMI ~12-13 | Glycogen store ETOT_gly = 0.01355 BW^0.76 + 0.002437 BW^0.62 (kg; muscle + liver) | Safety bounds; fasting |
| Torres et al. 2018 [33] | Extends an energy-balance model with RE-induced hypertrophy; fit to elderly RE cohort | Parameters not accessed | Template for dossier 09 |

---

### 4.6 Alpert 2005: limit on energy transfer from the fat store [23]
- Claim: in hypophagia the fat store can supply at most **290 +- 25 kJ per kg fat mass per day** (= 69.3 kcal/kg
  FM/d = 31.4 kcal/lb FM/d, DERIVED conversion), deduced from underfed subjects "maintaining moderate activity
  levels" (young active men of the Minnesota experiment). A deficit larger than the cap is met by immediate FFM
  depletion; below the cap FFM is not depleted. Alpert derives an exact solution for FFM decline in the capped
  regime (steady-state term, slow moderated decline, final rapid unprotected decline). He also reports hypophagic RMR
  falling linearly with FFM at 249 +- 25 kJ/kg/d, which disagrees with cross-sectional slopes [23]. Alpert used 8.5
  MJ/kg for lean tissue and lumped glycogen with protein [32]. Alpert 2007 [24] argued (as summarised in [32]) that by
  day 40 of severe restriction basal expenditure was only 66% of the expected level.
- Implementable form (as a rule, not a published ODE; PROPOSED):
```
FatSupplyMax = 290 kJ/kg/d * F                       (kJ/d)
Deficit D = EE - EI  (kJ/d)
if D <= FatSupplyMax:  dF/dt = -D/rho_F ; dFFM/dt = 0 (Alpert) -- or keep Forbes/Hall partition (recommended)
else:                  dF/dt = -FatSupplyMax/rho_F ; dFFM/dt = -(D - FatSupplyMax)/rho_FFM   (rho_FFM ~ 8.5 MJ/kg per Alpert)
```
- Critiques / evidence:
  1. Single data source (lean young men, Minnesota) and derivation by construction: our arithmetic on Hall 2006
     numbers (FM ~9 kg falling to 34% of initial over 24 wk) gives ~55 kcal/kg FM/d average fat supply, i.e. about
     80% of the cap - consistent, but not independent validation (DERIVED, approximate).
  2. It contradicts the empirical continuum that the lean fraction of loss rises smoothly with deficit size and falls
     smoothly with fatness (Forbes/Hall 2007) rather than switching at a threshold [5,8]; Dulloo's reanalysis shows
     large between-subject P-ratio variation at the same deficit [47].
  3. Speakman & Westerterp explicitly assume no mobilisation limit and still predict hunger-strike and therapeutic-fast
     outcomes reasonably (early loss under-predicted, very long fasts over-predicted) [32].
  4. Obese adults fasting or on large deficits do not approach the cap: Hall 2015 subjects (FM 42 kg) lost 89 g
     fat/d = 840 kcal/d = 20 kcal/kg FM/d (29% of the cap) [43] (DERIVED).
  5. Hall 2010 has no hard ceiling: lipolysis scales as F^(2/3) with up to 3.8x stimulation in fasting [1]; since
     lipolysis is far above net fat oxidation (re-esterification), lipolysis capacity is not the binding constraint.
  6. No later controlled human study found testing the cap directly (literature search of citing papers: Hall models,
     Speakman 2013, Dulloo 2021, Torres 2018; none report a direct test).
- Recommendation: do NOT use as a hard constraint; use as a **warning heuristic** in the UI ("deficit exceeds
  estimated fat-supply rate; expect disproportionate lean loss") and let the Forbes/Hall partition plus protein/RT
  modifiers (dossiers 03/09) do the actual partitioning. Evidence grade **C** (one derivation, lean men only).

---

### 4.7 Energy density of tissue change; why 3500 kcal/lb is wrong
- Metabolisable energy densities: fat 39.5 MJ/kg (9.44 kcal/g), protein 19.7 MJ/kg (4.7 kcal/g), glycogen 17.6
  MJ/kg (4.18 kcal/g) [6]; lean-tissue change 7.6 MJ/kg (1820 kcal/kg) with water [6]; fat-mass change 39.5 MJ/kg
  (the endogenous fat metabolised, not "adipose tissue", which contains water and protein) [6].
- 3500 kcal/lb (7716 kcal/kg = 32.3 MJ/kg) originates from assuming loss of adipose tissue of ~87% fat (Wishnofsky
  1958) [6,37]. Two separate errors [16]: (a) the energy density of weight change depends on initial fat and
  magnitude of loss (4.3.2); (b) the energy deficit is not static - EE falls as weight falls; Hall & Chow stress that
  substituting a "corrected" energy density does not fix the rule unless the deficit dynamics are modelled [16]. Static
  rule predicts 22 kg first-year loss for a 100 kg man at -2 MJ/d, "about 100% greater" than the dynamic model [3].
- Time course of energy content of weight lost (early vs late):
  - Phase I of weight loss: half-life < 1 week, duration 4-6 weeks; magnitude moderated by sex, activity, baseline and
    diet nutrients (especially carbohydrate/sodium) [34].
  - CALERIE-1 (DXA): dEC/dW = 4858 +- 388 kcal/kg at week 4, rising to 6041 +- 376 at week 6 and flat thereafter; Kiel
    13-wk study: women 6804 +- 226 vs men 6119 +- 240 kcal/kg [35].
  - Hall 2015 metabolic ward, 6 d at -800 kcal/d: carbohydrate-restricted diet -1.85 +- 0.15 kg body weight but only
    245 +- 21 g fat; fat-restricted -1.30 +- 0.16 kg with 463 +- 37 g fat [43] -> 13-36% of early weight loss is fat.
  - Jebb 1996: 12 d at -67% intake (3.5 MJ/d): -3.18 kg; fat balance accounted for 84.0% of the energy deficit
    (74.1% of surplus in +33% overfeeding: +2.90 kg) [58].
- Energy cost of deposition: Diaz 1992, +50% intake for 42 d: 28.7 +- 4.4 MJ per kg gained (theoretical 26.0),
  gain 7.6 +- 1.6 kg of which 58 +- 18% fat [57]. Hall's synthesis costs: eta_F = 750 kJ/kg fat, eta_L = 960 kJ/kg
  lean [3,22].
Grade **A**.

---

### 4.8 Glycogen, glycogen-bound water, ECF (fast components of early weight change)
| Quantity | Value | Source | Grade |
|---|---|---|---|
| Whole-body glycogen at baseline | ~500 g (model default) | [1,3] | B |
| Glycogen storage capacity | ~15 g/kg body weight; ~500 g can be added before net lipogenesis dominates; saturated stores + massive carbs -> ~150 g/d lipid from ~475 g/d CHO | Acheson 1988 (n = 3) [40] | C |
| Allometric glycogen estimate | 0.01355 BW^0.76 + 0.002437 BW^0.62 kg (muscle + liver; ~0.38 kg at 70 kg) | [32] | C |
| Water per g glycogen | 2.7 g (liver, McBride 1941 [42]; used by Hall) [1,3]; "3 to 4 parts water" plus 0.45 mmol K/g (Kreitzman 1992) [38]; >= 3 g/g in muscle biopsies, up to 17 g/g when excess water given (Fernandez-Elias 2015, n = 9 trained men) [39]; Olsson & Saltin 1970 [41] | B |
| Glycogen time constant (Lancet model) | ~0.7 d (DERIVED) | [3] | B |
| ECF time constant; carb-cut steady state | 1.07 d; -1.33 L x fractional carb cut (DERIVED) | [1,3] | C |
| Protein-associated water | h_P = 1.6 g/g (range 1.1-2.2) | [1,6] | B |
- Hall 2015 noted the fat-restricted diet produced more weight loss than the model predicted, which the authors attribute
  to body-water losses through mechanisms the model lacks [43] - water handling is the
  weakest part of these models.
- Recommend (for dossier 04/15 to confirm): split G into liver (fasting-sensitive, empties in ~1-2 d of fasting,
  UNVERIFIED here) and muscle (exercise-sensitive) with h_G = 2.7-3 g/g.

---

### 4.9 Measured time constants that set the engine's timestep
| Process | Time constant / timing | Source | Grade |
|---|---|---|---|
| Plasma glucose-insulin regulation | minutes (minimal-model rate constants per min) | [70,73] | A (structure) |
| Meal MPS pulse | FSR 0.03 -> 0.10 %/h at 45-90 min after 48 g whey; back to baseline by ~2-3 h despite high plasma EAA | [68] | B |
| Post-resistance-exercise MPS | +112% at 3 h, +65% at 24 h, +34% at 48 h (untrained, fasted; FBR +31%, +18%, 0%) | [66] | B |
| | +50% at 4 h, +109% at 24 h, within 14% (ns) of control at 36 h | [67] | B |
| Whole-body glycogen (Lancet model) | tau ~0.7 d (DERIVED) | [3] | B |
| ECF-sodium | tau 1.07 d (DERIVED) | [1,3] | C |
| Protein-oxidation adaptation to protein intake | tau_PI = 1.1 d | [1] (Rand 1976) | B |
| Lipolysis adaptation to carbohydrate | tau_L = 1.44 d (half-time ln2*tau_L = 1 d; paper: lipolysis reaches half its maximum after ~2 d of fasting) | [1] | B |
| Carbohydrate oxidation matching intake | ~5 d to near balance (12-d chamber) | [58] | A |
| Fat oxidation adaptation after isocaloric carb cut | plateau after several days | [43] | A |
| Adaptive thermogenesis onset | tau_T = 7 d [1]; tau_AT = 14 d [3] | [1,3] | B |
| Early (phase I) weight loss | half-life < 1 wk; lasts 4-6 wk | [34] | B |
| Body weight to new steady state | tau ~200-650 d depending on F0 (half-life ~1 y for overweight) | [3], table 4.2.5 | A |
| Slow ECF-weight coupling | tau_BW = 1000 d | [1] | C |

### 4.10 Fast-timescale sub-models for an hourly engine (simplified forms)
These are NOT part of the Hall models. They are the minimum needed to resolve meals, eating windows and training
timing. Detailed calibration belongs to dossiers 03, 04, 05, 07; here we give structure and anchor data.

#### 4.10.1 Glucose-insulin: Bergman minimal model [69-71] + oral appearance [73,74]
```
dGp/dt = -(S_G + X)*Gp + S_G*G_b + Ra(t)/V            Gp mg/dl, Ra mg/kg/min, V dl/kg
dX/dt  = -p2*X + p3*(I - I_b)                          X 1/min;  S_I = p3/p2  (insulin sensitivity)
Ra(t)  = oral appearance: piecewise-linear (8 breakpoints) in the oral minimal model [73,74], or the two-compartment
         stomach (solid, triturated) + gut model with glucose-dependent gastric emptying of Dalla Man 2007 [72]
```
- Insulin: the meal simulation model uses two-compartment insulin kinetics (liver, plasma) and beta-cell secretion
  with a dynamic (proportional to dG/dt) and a static (delayed, proportional to G above threshold) component;
  endogenous glucose production is suppressed linearly by glucose, portal insulin and a delayed insulin signal;
  insulin-dependent utilisation is Michaelis-Menten in a remote compartment [72,75].
- In the oral minimal model V and S_G are not identifiable and are fixed to population values [74]; typical values
  (V ~ 1.45 dl/kg, S_G ~ 0.025 1/min) are UNVERIFIED here -> dossier 04 must supply verified values and normal S_I.
- Implementation for our engine: integrate this block with 1-5 min sub-steps inside each hourly step (or quasi-
  steady-state: hourly mean insulin as a saturating function of hourly carbohydrate appearance, PROPOSED). Its only
  outputs consumed by the body-composition core are (a) an insulin signal that replaces Hall's daily CI/CI_b in the
  lipolysis, GNG_P and ECF-sodium terms, and (b) glucose disposal into glycogen vs oxidation.
- Consistency constraint (PROPOSED, mandatory): for any daily menu, the 24-h integral of the hourly insulin-driven
  terms must reproduce Hall 2010's daily-averaged fluxes within +-5%. This anchors the hourly layer to the validated
  daily model.
Grade: structure **A** (decades of validation in glucose tolerance tests); use for body-weight prediction **D**
(never validated for that purpose).

#### 4.10.2 Lipolysis at hourly resolution (PROPOSED)
Hall's L_diet (tau 1.44 d) captures multi-day carbohydrate adaptation; add a fast post-prandial suppression term
driven by the insulin signal (tau ~1-2 h), calibrated so the daily mean equals Hall's D_F. Anchor: D^_F = 140 g/d is
defined as 2/3 x fed + 1/3 x overnight-fasted lipolysis (Jensen 1999) [1], i.e. Hall's own
parameter already encodes a fed/fasted mixture that the hourly layer must reproduce.

#### 4.10.3 Ketones (PROPOSED; owner dossier 05)
- Production flux: Hall's KTG (4.1.6), evaluated hourly with hourly D_F, hourly protein intake signal and liver
  glycogen (use G_liv/G_liv,init instead of G/G_init because hepatic glycogen, not muscle glycogen, gates hepatic
  ketogenesis - biological reasoning, grade C).
- Concentration pool: `V_K * dBHB/dt = KTG(t)/rho_K_molar - Vmax*BHB/(Km + BHB) - renal(BHB)`; parameters to be fitted
  by dossier 05 to fasting and ketogenic-diet time courses. Anchor points available here: overnight-fasted BHB
  0.068 +- 0.009 mM on a 50% carbohydrate eucaloric diet; +0.088 mM after 6 d of a 30%-energy-restricted diet with
  ~140 g/d carbohydrate (no nutritional ketosis) [43]; renal excretion begins above KTG ~70 g/d [1].
- Hall 2010 caps production at 400 g/d and excretion at 20 g/d [1].

#### 4.10.4 Muscle protein turnover (PROPOSED; owners dossiers 03 and 09)
- Daily whole-body layer (Hall 2010): D_P = 300 g/d x P/P_Keys; synthesis = D_P + dP/dt; synthesis cost 0.86 kcal/g,
  degradation 0.17 kcal/g [1].
- Resistance-exercise signal (PROPOSED FIT to [66]; data points 3 h: +112%, 24 h: +65%, 48 h: +34%):
```
MPS_RT(t) = A * exp(-(t - t_RT)/tau_RT),   A = 1.22 (122% above rest), tau_RT = 37.7 h  (fit reproduces 112, 64, 34%)
```
  MacDougall 1995 shows a later peak (+109% at 24 h) and faster return by 36 h [67] -> use a gamma-shaped kernel if
  dossier 09 prefers; the two data sets bracket the uncertainty.
- Meal signal: pulse of myofibrillar FSR peaking 45-90 min after a protein bolus and returning to baseline by ~2-3 h
  even with elevated amino acids ("muscle full" refractoriness) [68]; dose-response and per-meal saturation belong
  to dossier 03.
- Coupling to the core: daily integral of (synthesis - breakdown) in muscle replaces or modifies Hall's protein
  balance for the skeletal-muscle fraction of P (dM_SM/dFFM = 0.59 [1]); energy costs (eta_P, eps_P) stay as in Hall.

### 4.11 Recommended engine design (state vector and timestep)

**Recommendation: hybrid, one master clock of 1 hour.**
1. Slow core = Hall 2010 macronutrient-flux model (4.1) with states F, P (split P = P_muscle + P_other, NEW), G
   (split G_liv + G_mus, NEW), ECF, dECF_slow, T (or AT), L_diet, P_sig; integrate every hour with explicit RK4 (or
   Euler) at dt = 1/24 d. Stability: the fastest slow-core time constant is ~0.7 d (glycogen), so dt/tau = 0.06 -
   accurate (Hall used RK4 at 0.1 d [1]).
2. Fast layer (NEW): gut pools, Gp/X/I, BHB, MPS signals, integrated with 5-10 min sub-steps (6-12 per hour) or a
   semi-implicit step; outputs hourly means to the core (insulin signal, glucose disposal, amino-acid availability,
   ketone flux/concentration).
3. Reduced model = Hall 2011 BWP (4.2) with the same F/L/G/ECF/AT states, used (a) by the planner for fast screening
   (daily step, ~180 steps per 6-month candidate), (b) as a regression oracle: for macronutrient-neutral scenarios the
   full engine's BW and F must stay within tolerance of the BWP (e.g. +-1.5 kg at 6 months; PROPOSED).
4. Timekeeping: inputs defined per day/block are expanded to hourly meal and exercise events; outputs sampled
   daily for charts; hourly traces available for "day view" (glucose, insulin proxy, BHB, MPS).
5. Initialisation: t = -14 d "burn-in" at the user's habitual diet so fast states (G, ECF, L_diet, P_sig) settle
   before the schedule starts; slow states F, P fixed from user inputs.
6. Algebraic loop: solve TEE in closed form each step (4.1.4 note; Hall 2011 Eq. 9).

Why not daily only: meal timing, eating windows, fasting hours, post-exercise MPS windows and ketone entry (hours
to days) are invisible at daily resolution (Hall: daily-average model [1]). Why not minute-level everywhere: the
body-composition states change by < 0.1% per hour and the planner needs thousands of forward simulations.
Rough compute budget (engineering estimate, not physiology): 6 months hourly = 4,320 core steps + ~50,000 fast
sub-steps -> milliseconds per simulation in a Web Worker; the BWP screening model is ~24-300x cheaper.

### 4.12 Reference implementation of the Hall 2011 model (test oracle; Python, DERIVED)
```python
import math
def bwp(sex='m', BW0=100., H=1.80, age=23., PAL=1.5, EI_fn=None, carbfrac=0.5, days=730, dt=0.05, ECF0=None):
    rhoF, rhoL, rhoG = 39.5, 7.6, 17.6                   # MJ/kg
    gF, gL, etaF, etaL = 0.013, 0.092, 0.750, 0.960      # MJ/kg/d, MJ/kg
    bTEF, bAT, tauAT, hG = 0.1, 0.14, 14.0, 2.7
    C = 10.4*rhoL/rhoF
    Na, xiNa, xiCI = 3.22, 3000., 4000.
    F = BW0/100*(0.14*age + (37.31 if sex=='m' else 39.96)*math.log(BW0/H**2) - (103.94 if sex=='m' else 102.01))
    rmr = (10*BW0 + 6.25*H*100 - 5*age + (5 if sex=='m' else -161))*4.184e-3   # Mifflin-St Jeor, MJ/d
    delta = ((1-bTEF)*PAL - 1)*rmr/BW0
    EI0 = PAL*rmr; G = 0.5; ECF = ECF0 or 0.2*BW0; ECFi = ECF      # ECF0 placeholder: use Silva 2007
    L = BW0 - F - ECF - G*(1+hG); CIb = carbfrac*EI0; kG = CIb/G**2; AT = 0.0
    K = EI0 - (gF*F + gL*L + delta*BW0)
    out = []
    for i in range(int(days/dt)+1):
        t = i*dt; EI = EI_fn(t) if EI_fn else EI0; CI = carbfrac*EI; dEI = EI - EI0
        BW = F + L + G*(1+hG) + ECF
        dG = (CI - kG*G*G)/rhoG; p = C/(C+F); s = p*etaL/rhoL + (1-p)*etaF/rhoF
        EE = (K + gF*F + gL*L + delta*BW + bTEF*dEI + AT + (EI - rhoG*dG)*s)/(1 + s)
        dF = (1-p)*(EI - EE - rhoG*dG)/rhoF; dL = p*(EI - EE - rhoG*dG)/rhoL
        dECF = (-xiNa*(ECF-ECFi) - xiCI*(1 - CI/CIb))/(Na*1000); dAT = (bAT*dEI - AT)/tauAT
        out.append((t, BW, F, L, G, ECF, EE))
        F += dF*dt; L += dL*dt; G += dG*dt; ECF += dECF*dt; AT += dAT*dt
    return out
# Test: bwp(EI_fn=lambda t: 7.65 if t < 180 else 10.9) -> BW ~80.0 kg at t=180 d and ~80.7 kg at t=365-730 d
```

### 4.13 What the Hall-type (and Thomas/Forbes) models omit - hand-off list
| # | Phenomenon | Status in Hall 2010 [1] / Hall 2011 BWP [3] | Must be added by |
|---|---|---|---|
| 1 | Resistance-training-driven hypertrophy, detraining, training status | Absent (exercise = energy cost; activity only lowers protein-oxidation share via S_A; BWP states exercise effects on composition not modelled) | 09 (hypertrophy term on P_muscle), 03 |
| 2 | Protein dose per meal, distribution, leucine/quality, "muscle full", age-related anabolic resistance | Daily protein intake only (P_sig, tau 1.1 d; 90% of extra protein oxidised, kappa_P = 0.1); BWP ignores protein | 03 |
| 3 | Protein effect on partitioning in deficit/surplus (e.g. Longland 2016, Bray 2012) | Partly emergent in Hall 2010; absent in BWP (p depends on F only) | 03, 11 |
| 4 | Meal timing, number of meals, eating window, overnight fast, circadian effects | Absent (daily-averaged fluxes) | 07 (with 04, 05) |
| 5 | Plasma glucose/insulin/FFA dynamics; insulin sensitivity changes | Implicit via CI/CI_b | 04, 06 |
| 6 | Plasma ketone concentration, entry/exit kinetics, keto-adaptation (weeks) | Only ketogenesis flux (kcal/d) with caps | 05 |
| 7 | Liver vs muscle glycogen; exercise depletion; supercompensation | Single G pool | 04, 10 |
| 8 | Adaptive thermogenesis persistence, hysteresis, diet breaks/refeeds; fat-store feedback (Dulloo) | T/AT driven only by dEI (returns to 0 when intake returns to baseline) | 02, 12, 13 |
| 9 | NEAT compensation, exercise-induced intake compensation | NEAT scaled by T; no behavioural compensation | 02, 10, 12 |
| 10 | Appetite / intake feedback (~100 kcal/d per kg lost [62]) | Intake is an input | 12 |
| 11 | Alcohol (~7 kcal/g Atwater factor, UNVERIFIED here; oxidation priority), fibre fermentation energy, net vs total carbohydrate | Not represented | 04, 15 |
| 12 | Water beyond glycogen + simple sodium-ECF (menstrual cycle, creatine, cortisol, potassium) | Simple ECF model; misses some water loss [43] | 15, 16 |
| 13 | Sex, age, menopause, sleep, stress moderators of RMR/partition | Only via initial composition (Thomas: age in RMR) | 16, 02 |
| 14 | Regional fat (visceral, liver fat), bone mineral change | Absent | 14, 06, 19 |
| 15 | Brown adipose tissue, cold exposure | Absent (flagged as future work in [1]) | 02 |
| 16 | Individual variability | Only through initial conditions (+-5% baseline EE uncertainty [3]) | 18 (uncertainty bands), 16 |
| 17 | Autophagy, mTOR/AMPK, hormones (leptin, T3, cortisol, sex hormones) | Absent | 08, 12 |
| 18 | DNL/fat storage specifics of fructose vs glucose; ultra-processing | Absent | 04, 15 |

---

## 5. Interactions with other subsystems
| This module needs | From dossier |
|---|---|
| RMR equations, adaptive thermogenesis magnitude/persistence/reversal (replace or refine T/AT), NEAT and exercise energy cost | 02, 10 |
| Protein dose/timing effects on protein balance; MPS kinetics; protein quality | 03 |
| Glycogen compartments (liver/muscle), glucose-insulin parameters, DNL detail, fibre/net carbs | 04 |
| Ketogenesis-to-BHB concentration, keto-adaptation time course, ketone clearance | 05 |
| Meal timing / fasting hour-by-hour physiology; circadian modifiers | 07 |
| RT-driven hypertrophy term acting on P_muscle; detraining | 09 |
| Overfeeding partition by macronutrient and training | 11 |
| Appetite feedback (~100 kcal/d more intake per kg lost [62]) for planner realism/adherence | 12 |
| Transition/refeed transients (water, glycogen) | 13 |
| Initial composition (F0, FFM0, ECF0), visceral fat split | 14 |
| Sodium, water, alcohol, creatine effects on ECF/ICW/weight | 15 |
| Sex, age, menopause, sleep moderators of partition and EE | 16 |
| Safety thresholds | 17 |

| This module gives | To |
|---|---|
| F, FFM, lean tissue, BW, glycogen, ECF, water weight, energy balance, TEE components, fuel oxidation, RQ, DNL, GNG, ketogenesis flux, protein balance / N balance | All output dossiers; planner (18) |
| Effective energy density, time constant, steady-state weight for "what is achievable" messages | 18 |
| Reduced BWP model for fast optimisation | 18 |

---

## 6. Output metrics for the UI
| Metric | Unit | Better | Computation | Grade |
|---|---|---|---|---|
| Body weight | kg | goal-dependent | F + FFM (Eq. 2) | A |
| Fat mass / body-fat % | kg / % | lower (to healthy floor) | F; 100*F/BW | A |
| Fat-free mass | kg | higher | Eq. 2 | A (group) |
| Lean tissue (protein + its water) | kg | higher | P*(1 + h_P) (+ muscle split) | B |
| Glycogen | g | context | G (G_liv, G_mus) | B |
| "Water weight" (glycogen water + ECF deviation) | kg | informational | 2.7*(G - G0)/1000 + (ECF - ECF0) | B/C |
| Energy balance | kcal/d | goal-dependent | EI - TEE | A |
| TEE, RMR, PAE, TEF | kcal/d | informational | Eqs. 4-10 | A/B |
| Adaptive thermogenesis | kcal/d | closer to 0 | RMR and PAE contributions of T | B |
| Fat oxidation / carbohydrate oxidation / RQ | g/d, - | informational | Eqs. 25, 30 | A |
| De novo lipogenesis | g/d | lower | DNL/rho_F | B |
| Ketogenesis rate (and BHB from dossier 05) | g/d (mM) | goal-dependent | Eq. 15 | C |
| Nitrogen / protein balance | g N/d | >= 0 | PI/(6.25 rho_P) - N_excr | B |
| Share of weight change that is fat | % | higher in loss | dF/dBW over window | A/B |
| Projected steady-state weight and time to 50%/95% | kg, days | - | 4.2.5 linearisation | A |
| Deficit vs Alpert fat-supply estimate | ratio | < 1 | (EE - EI)/(290 kJ/kg/d x F) | C |

---

## 7. Validation targets (unit tests)
Run each with the documented inputs; tolerances PROPOSED.

1. **Minnesota semistarvation and refeeding** (Keys 1950, via Hall 2006 [2,46]). 32 healthy young men, BMI 21.7 +-
   1.7 [17]. Baseline diet CI 1826, FI 1343, PI 461 kcal/d; 24 wk semistarvation CI 1100, FI 290, PI 195 kcal/d
   (plus decline in voluntary activity: Hall used delta falling from 26 to 9 kcal/kg/d [2]). Outcomes: BW -> 76% and
   FM -> 34% of initial at 24 wk; ~16-17 kg lost [5,6]; 12 wk controlled refeeding -> BW and FM ~80% of initial; after
   8 wk ad libitum refeeding BW 104% and FM 145% (fat overshoot); simulated DNL ~100 kcal/d at baseline, 24 kcal/d in
   week 1 of semistarvation, 600-700 kcal/d during refeeding; RMR lower in semistarvation than refeeding at equal
   lean mass (51.3 +- 1.5 kg) [2]. Tolerance: BW +-2 kg, FM +-1 kg.
2. **Jebb 1996 12-d whole-body calorimetry** [58]. 6 lean men. Overfeeding 16.5 MJ/d (+33%, n = 3): +2.90 kg, TEE
   +6.2%; underfeeding 3.5 MJ/d (-67%, n = 3): -3.18 kg, TEE -10.5%. Carbohydrate oxidation 551 and 106 g/d by day 12
   (intakes 540 and 83 g/d), near balance by day 5; fat oxidation 59 and 177 g/d (intakes 150 and 20 g/d); fat balance
   = 74.1% / 84.0% of imbalance. Tolerance: BW +-0.5 kg; carb oxidation +-15%.
3. **CALERIE-1, 6 months** [51,52]. 48 overweight adults (BMI 27.8 +- 0.7, age 36.8 +- 1.0). Weight change: control
   -1.0 +- 1.1%; CR 25%: -10.4 +- 0.9%; CR 12.5% + exercise 12.5%: -10.0 +- 0.8%; VLCD 890 kcal/d to -15% then
   maintenance: -13.9 +- 0.8%. TDEE at M3: CR -454 +- 76, LCD -633 +- 66 kcal/d; body-composition-adjusted TDEE
   -431 +- 51 (M3) and -240 +- 83 kcal/d (M6); sedentary 24-h EE adjusted -135 +- 42 (CR), -117 +- 52 (CR+EX),
   -125 +- 35 kcal/d (VLCD) = ~6% "metabolic adaptation" [51]. Hall 2010 and 2011 models match BW/FM without refit
   [1,3]. Tolerance: BW +-1.5 kg at 6 mo.
4. **CALERIE-2, 2 years** [18,19,53]. 218 randomised, age 21-51, BMI 21.9-28.0; achieved CR 11.7 +- 0.7% with
   10.4 +- 0.4% weight loss maintained [53]. Intake change (DLW/DXA): -480 +- 20 (wk 0-26), -274 +- 19 (26-52),
   -224 +- 21 kcal/d (52-78); model from weight only: -455, -257, -203 kcal/d; individual RMS deviation 191-227 kcal/d
   [19]. NIH BWP bias: BW -0.47 kg, FM +0.78 kg, EE -14 kcal/d [18]. Test: feed the measured intake trajectory and
   reproduce the 2-y BW within +-1 kg (group mean).
5. **Hall 2015 isocaloric fat vs carbohydrate restriction** [43]. 19 adults with obesity (10 M, 9 F; BMI 35.9 +-
   1.1; FM 42 +- 2.8 kg), inpatient, daily treadmill 1 h; baseline 2740 +- 100 kcal/d (50% C, 35% F, 15% P); then 6 d
   of -810 kcal/d by removing only carbohydrate (RC; ~140 g/d carbs, 29% energy) or only fat (RF; fat ~8% energy).
   Results RC vs RF: BW -1.85 +- 0.15 vs -1.30 +- 0.16 kg; cumulative fat loss 245 +- 21 vs 463 +- 37 g (53 vs 89 g/d at
   steady state); net fat oxidation +403 +- 30 vs -31 +- 31 kcal/d; 24-h EE -97.7 +- 23 vs -49.6 +- 24 kcal/d; 24-h RQ
   -0.055 vs +0.005; urinary N +0.75 vs -2.43 g/d; fasting BHB +0.088 vs +0.006 mM. Model predicted fat oxidation
   well, and predicted RF > RC fat loss persisting to 6 months (~3 kg more fat loss with RF) [43]. Tolerance: fat loss
   +-60 g over 6 d; RQ +-0.01.
6. **Hall 2016 isocaloric ketogenic diet** [44]. 17 men with overweight/obesity, 4 wk high-carbohydrate baseline then
   4 wk isocaloric KD, protein clamped; overall deficit ~300 kcal/d. KD vs baseline: EE chamber +57 +- 13, sleeping EE
   +89 +- 14, DLW +151 +- 63 kcal/d; RQ -0.111 +- 0.003; body fat loss slowed; protein utilisation and FFM loss rose.
   Test: engine must NOT produce faster fat loss on the isocaloric KD; EE difference within 0-160 kcal/d.
7. **Overfeeding** - (a) Bouchard 1990 twins [55]: 12 MZ male pairs, +1000 kcal/d, 6 d/wk, 84 d in 100 d (84,000
   kcal): +8.1 kg (range 4.3-13.3). Tremblay 1992 (same protocol, 23 men) [82]: of 353 MJ surplus 222 MJ stored;
   maintenance cost rose 52 MJ; 4 months later 82% of weight gain, 74% of fat gain and 100% of FFM gain were lost.
   Hall 2010 simulation of the 100-d study: BW 60.3 -> 69.7 kg (measured 68.4 +- 8.2), FM 6.9 -> 12.3 (measured 12.3
   +- 4.5), RMR 1850 (measured 1793 +- 190 kcal/d) [1]. (b) Diaz 1992 [57]: +50% (6.2 MJ/d) for 42 d, 6 lean + 3
   overweight men: +7.6 +- 1.6 kg, 58 +- 18% fat, BMR +0.9 MJ/d. (c) Horton 1995 [59]: +50% for 14 d: 75-85% of
   excess stored with carbohydrate, 90-95% with fat. (d) Bray 2012 [60]: +954 kcal/d for 8 wk: 5% / 15% / 25% protein
   -> +3.16 / +6.05 / +6.51 kg; lean +~0 / +2.87 / +3.18 kg; REE +0 / +160 / +227 kcal/d; fat gain similar.
   (e) Levine 1999 [56]: +1000 kcal/d, 8 wk, 16 non-obese: two-thirds of the TEE increase was NEAT; NEAT change
   predicted fat gain (r = 0.77). Tolerance: BW +-1.5 kg.
8. **Friedlander 2005 (3 wk, -40% energy, protein maintained)** [81]: ~4 kg BW lost, slightly under half as fat;
   negative N balance despite maintained protein; Hall 2006 predicted without refit [2].
9. **Biosphere 2** [54]: 8 adults, 2 y, low-fat (9% energy) 7000-11000 kJ/d: -9.1 +- 6.6 kg; after exit 24-h EE
   adjusted -6% and spontaneous activity -45% vs 152 controls; still lower 6 months after weight was regained.
   Test for adaptive-thermogenesis persistence (contested; dossier 02).
10. **Leibel 1995** [61]: maintenance at >= 10% below usual weight lowered TEE by 6 +- 3 (never-obese) and 8 +- 5
    kcal/kg FFM/d (obese); at +10%, TEE +9 +- 7 and +8 +- 4 kcal/kg FFM/d.
11. **Model-to-model regression** (DERIVED from [3]): 100 kg, 1.80 m, 23-y man, PAL 1.5: -5 MJ/d for 180 d -> ~80 kg,
    then 10.9 MJ/d holds ~80-81 kg; permanent -2 MJ/d -> ~87 kg at 1 y, 94-95% of final change by 3 y, plateau 75-78
    kg.
12. **Negative control - what the core must NOT do without dossier 09/03 modules**: Longland 2016 [63] (40% deficit,
    RT + HIIT, 2.4 g/kg protein: LBM +1.2 kg in 4 wk) cannot be reproduced by Hall/Forbes partitioning (which predicts
    lean LOSS in any deficit). A passing engine reproduces it only with the RT/protein extensions switched on.

13. **Free-living intake inference (Hall 2010 [1], Svetkey 2008 data [83])**: 341 adults in an outpatient programme;
    to reproduce the observed loss/regain the model requires intake -800 kcal/d for only ~6 wk, then a gradual return
    to baseline by ~10 months; holding the 6-month loss would have needed a permanent -170 kcal/d. Use as a
    regression test of the intake-inference mode (dEI = rho dBW/dt + eps dBW [19]).
14. **Ad libitum diet comparison (not a direct physics test)**: Hall 2021 [45], 20 adults (BMI 27.8 +- 1.3), 2-wk
    crossover: plant-based low-fat (10.3% fat, 75.2% carb) vs animal-based ketogenic (75.8% fat, 10.0% carb) diets;
    energy intake 689 +- 73 kcal/d lower on low-fat over 2 wk (544 +- 68 in week 2). Intake is an output of appetite
    (dossier 12); given the measured intakes, the core should reproduce the measured weight/fat changes.

---

## 8. Myths / contested claims
- **"3500 kcal = 1 lb, so a 500 kcal/d deficit loses 1 lb/week forever."** Wrong twice: energy density of weight
  change varies (4,300-8,300 kcal/kg depending on body fat, table 4.2.5) and expenditure falls as weight falls, giving
  an exponential approach with ~1-y half-life [3,6,15,16].
- **"The 6-month plateau proves metabolism shut down."** Controlled-feeding weight loss is nearly linear for 6 months
  and model plateaus occur only after 1-2+ years; plateaus at 6 months are explained by waning adherence (estimated
  intake drop of ~800 kcal/d sustained only ~6 wk, back to baseline by ~10 mo in Svetkey 2008 data) [1,3,17].
  Metabolic adaptation changes the plateau level, not its timing [17].
- **"A calorie is a calorie, so macronutrients never matter"** vs **"carbohydrate restriction uniquely burns fat via
  insulin."** Isocaloric carbohydrate restriction raised fat oxidation but produced LESS fat loss than fat restriction
  over 6 d (245 vs 463 g) [43]; an isocaloric KD slowed fat loss and increased protein loss [44]. Models predict body
  fat is relatively insensitive to carbohydrate:fat ratio at fixed calories and protein (the body minimises the
  difference) while weight (water, glycogen) is not [43]. Macronutrients DO matter for protein balance, water, and
  appetite (dossier 12).
- **"One quarter of weight lost is FFM."** Only a rough average; the fraction depends on initial fatness, size of the
  loss, exercise, age and measurement method [36] (e.g. ~15% at 60 kg initial fat vs ~54% at 10 kg for a 5 kg loss,
  DERIVED, 4.3.2).
- **"You can lose at most X kcal of fat per day (Alpert)."** A single-dataset derivation from lean men; not a
  physiological law; use as a warning only (4.6).
- **"Exercise and diet deficits are interchangeable."** Activity expenditure scales with weight, so energy-equivalent
  activity and diet changes produce different trajectories; for small interventions activity yields slightly more
  loss, for large ones diet does [3]. Real-world compensation (intake, NEAT) is outside the model [3].
- **"Rapid early loss on low-carb is fat."** Phase I loss (t1/2 < 1 wk, 4-6 wk) is disproportionately glycogen, water
  and sodium-driven ECF; energy content of loss rises from ~4,900 to ~6,000 kcal/kg over weeks 4-6 [34,35,43].
- **Contested - persistence of adaptive thermogenesis:** Leibel [61], Biosphere 2 [54] and Minnesota [48] show
  persistent reductions; yet the NIH BWP with no extra adaptation term (f = 0) fitted 2-y CALERIE-2 data better than a
  model with explicit extra adaptation [18]. Best estimate for the core: beta_AT = 0.14 of dEI with tau 14 d [3];
  dossier 02 decides persistence/hysteresis.

---

## 9. Safety bounds relevant to this topic
- Validity range of the core: Hall models are validated for 30-d total fasts in obese adults, 24-wk semistarvation
  in lean men and 2-y moderate CR [2,3,18]; beyond these, flag "extrapolation". Thomas' 1-D model becomes invalid
  (negative fat) at intakes roughly < 1000 kcal/d [11].
- Starvation limit: death occurs around BMI 12-13 in total starvation (Speakman & Westerterp use BMI <= 13 as the end
  point; cites Leiter & Marliss 1982 and others) [32]. Any simulated trajectory approaching BMI 15 must hard-warn
  (threshold choice for dossier 17).
- Lean-loss warning: when (EE - EI) > 290 kJ/kg/d x F (Alpert heuristic) or when the simulated lean fraction of
  weight loss exceeds ~50% (PROPOSED threshold), warn about disproportionate FFM loss (grade C).
- Refeeding after prolonged severe restriction: model reproduces the Minnesota fat overshoot (FM 145% of baseline
  after ad-libitum refeeding) [2] - warn users of post-diet fat overshoot risk.
- Heavy ketosis: modelled ketone production above 70 g/d implies urinary ketone loss [1]; dossier 05/17 to set BHB
  warning thresholds (e.g. euglycaemic ketoacidosis risk with SGLT2 drugs, type 1 diabetes).
- Carbohydrate removal lowers ECF by up to ~1.3 L in the model (DERIVED) - orthostatic symptoms and sodium needs are
  dossier 15/17 topics.
- Hypoglycaemia: one participant withdrew from a very-low-carbohydrate arm for hypoglycaemia [45].

---

## 10. Open questions / weakest assumptions
1. **Resistance training and protein dose are absent** from all validated whole-body models (Hall states exercise
   effects on composition were not modelled [3]); Torres 2018 is the only extension found and was fit, not
   validated [33]. Our RT/protein modules will be the least-validated part of the core.
2. **Water**: glycogen hydration (2.7 vs 3-4 g/g), ECF-sodium coefficients (two small studies), and the RF-diet water
   loss the model missed [43]. Early-phase weight predictions carry +-0.5-1 kg uncertainty.
3. **Adaptive thermogenesis**: magnitude (beta_AT = 0.14 from steady-state data), time constant (7 vs 14 d), asymmetry
   (lambda1 0.74 vs lambda2 0.02), and persistence after intake normalises (Hall's T returns to 0 when EI = EI_b,
   whereas Leibel/Dulloo suggest composition-linked persistence).
4. **Individual variation**: baseline EE is known only to ~5% without DLW, giving +-4 kg spread after years for a
   -2 MJ/d intervention [3]; measurement error explains ~half of observed inter-individual variance [18]. Present
   bands, not points.
5. **Lean, trained, older, female-specific validation** is thin (Minnesota lean men; CALERIE mostly overweight
   adults).
6. **Hall 2010 transcription issues**: lipolysis Eq. 12 normalisation (4.1.5), garbled Eq. 37 (re-derived), G_init vs
   G_Keys normalisation, unreported Minnesota reference masses (F_Keys ~9 kg per [2]; P_Keys, G_Keys not tabulated).
   Obtaining the Berkeley Madonna source (4.1) would remove these ambiguities.
7. **Hourly downscaling** of daily-validated fluxes is unvalidated; the +-5% daily-consistency rule is our proposal.
8. **Alpert limit** has no independent test.
9. **Invariant-manifold problem** [4]: Forbes-type partition gives no restoring force for composition; whether the
   body defends lean mass after RT-induced gain (detraining) must come from dossier 09 data.
10. **Appetite**: models take intake as input; in reality ~100 kcal/d extra intake per kg lost [62] is 3x the EE
    adaptation - relevant to planner feasibility, not to the simulator's physics.

---

## 11. References
1. Hall KD. Predicting metabolic adaptation, body weight change, and energy intake in humans. Am J Physiol Endocrinol Metab. 2010;298(3):E449-E466. PMID 19934407. DOI 10.1152/ajpendo.00559.2009. PMC2838532. https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/
2. Hall KD. Computational model of in vivo human energy metabolism during semistarvation and refeeding. Am J Physiol Endocrinol Metab. 2006;291(1):E23-E37. PMID 16449298. DOI 10.1152/ajpendo.00523.2005. PMC2377067. https://pmc.ncbi.nlm.nih.gov/articles/PMC2377067/
3. Hall KD, Sacks G, Chandramohan D, Chow CC, Wang YC, Gortmaker SL, Swinburn BA. Quantification of the effect of energy imbalance on bodyweight. Lancet. 2011;378(9793):826-837. PMID 21872751. DOI 10.1016/S0140-6736(11)60812-X. PMC3880593. Web appendix: https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf
4. Chow CC, Hall KD. The dynamics of human body weight change. PLoS Comput Biol. 2008;4(3):e1000045. PMID 18369435. DOI 10.1371/journal.pcbi.1000045. PMC2266991. https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1000045
5. Hall KD. Body fat and fat-free mass inter-relationships: Forbes's theory revisited. Br J Nutr. 2007;97(6):1059-1063. PMID 17367567. DOI 10.1017/S0007114507691946. PMC2376748.
6. Hall KD. What is the required energy deficit per unit weight loss? Int J Obes (Lond). 2008;32(3):573-576. PMID 17848938. DOI 10.1038/sj.ijo.0803720. PMC2376744. https://pmc.ncbi.nlm.nih.gov/articles/PMC2376744/
7. Forbes GB. Lean body mass-body fat interrelationships in humans. Nutr Rev. 1987;45(8):225-231. PMID 3306482. DOI 10.1111/j.1753-4887.1987.tb02684.x.
8. Forbes GB. Body fat content influences the body composition response to nutrition and exercise. Ann N Y Acad Sci. 2000;904:359-365. PMID 10865771. DOI 10.1111/j.1749-6632.2000.tb06482.x.
9. Dugdale AE, Payne PR. Pattern of lean and fat deposition in adults. Nature. 1977;266(5600):349-351. PMID 859600. DOI 10.1038/266349a0.
10. Payne PR, Dugdale AE. A model for the prediction of energy balance and body weight. Ann Hum Biol. 1977;4(6):525-535. PMID 596818. DOI 10.1080/03014467700002521.
11. Thomas DM, Martin CK, Heymsfield S, Redman LM, Schoeller DA, Levine JA. A simple model predicting individual weight change in humans. J Biol Dyn. 2011;5(6):579-599. PMID 24707319. DOI 10.1080/17513758.2010.508541. PMC3975626.
12. Thomas DM, Ciesla A, Levine JA, Stevens JG, Martin CK. A mathematical model of weight change with adaptation. Math Biosci Eng. 2009;6(4):873-887. PMID 19835433. DOI 10.3934/mbe.2009.6.873. PMC2764961.
13. Thomas DM, Schoeller DA, Redman LA, Martin CK, Levine JA, Heymsfield SB. A computational model to determine energy intake during weight loss. Am J Clin Nutr. 2010;92(6):1326-1331. PMID 20962159. DOI 10.3945/ajcn.2010.29687. PMC2980958.
14. Thomas D, Das SK, Levine JA, Martin CK, Mayer L, McDougall A, Strauss BJ, Heymsfield SB. New fat free mass - fat mass model for use in physiological energy balance equations. Nutr Metab (Lond). 2010;7:39. PMID 20459692. DOI 10.1186/1743-7075-7-39. PMC2879256.
15. Thomas DM, Martin CK, Lettieri S, Bredlau C, Kaiser K, Church T, Bouchard C, Heymsfield SB. Can a weight loss of one pound a week be achieved with a 3500-kcal deficit? Int J Obes (Lond). 2013;37(12):1611-1613. PMID 23628852. DOI 10.1038/ijo.2013.51. PMC4024447.
16. Hall KD, Chow CC. Why is the 3500 kcal per pound weight loss rule wrong? Int J Obes (Lond). 2013;37(12):1614. PMID 23774459. DOI 10.1038/ijo.2013.112. PMC3859816.
17. Thomas DM, Martin CK, Redman LM, Heymsfield SB, Lettieri S, Levine JA, Bouchard C, Schoeller DA. Effect of dietary adherence on the body weight plateau: a mathematical model incorporating intermittent compliance with energy intake prescription. Am J Clin Nutr. 2014;100(3):787-795. PMID 25080458. DOI 10.3945/ajcn.113.079822. PMC4135489.
18. Guo J, Brager DC, Hall KD. Simulating long-term human weight-loss dynamics in response to calorie restriction. Am J Clin Nutr. 2018;107(4):558-565. PMID 29635495. DOI 10.1093/ajcn/nqx080. PMC6248630.
19. Sanghvi A, Redman LM, Martin CK, Ravussin E, Hall KD. Validation of an inexpensive and accurate mathematical method to measure long-term changes in free-living energy intake. Am J Clin Nutr. 2015;102(2):353-358. PMID 26040640. DOI 10.3945/ajcn.115.111070. PMC4515869.
20. Hall KD, Chow CC. Estimating changes in free-living energy intake and its confidence interval. Am J Clin Nutr. 2011;94(1):66-74. PMID 21562087. DOI 10.3945/ajcn.111.014399. PMC3127505. (Located; full text not accessed.)
21. Hall KD, Jordan PN. Modeling weight-loss maintenance to help prevent body weight regain. Am J Clin Nutr. 2008;88(6):1495-1503. PMID 19064508. DOI 10.3945/ajcn.2008.26333.
22. Hall KD. Mathematical modelling of energy expenditure during tissue deposition. Br J Nutr. 2010;104(1):4-7. PMID 20132585. DOI 10.1017/S0007114510000206.
23. Alpert SS. A limit on the energy transfer rate from the human fat store in hypophagia. J Theor Biol. 2005;233(1):1-13. PMID 15615615. DOI 10.1016/j.jtbi.2004.08.029. (Abstract and secondary descriptions only.)
24. Alpert SS. The cross-sectional and longitudinal dependence of the resting metabolic rate on the fat-free mass. Metabolism. 2007;56(3):363-372. PMID 17292725. DOI 10.1016/j.metabol.2006.10.018.
25. Alpert SS. A two-reservoir energy model of the human body. Am J Clin Nutr. 1979;32(8):1710-1718. DOI 10.1093/ajcn/32.8.1710.
26. Antonetti VW. The equations governing weight change in human beings. Am J Clin Nutr. 1973;26(1):64-71. PMID 4682818. DOI 10.1093/ajcn/26.1.64.
27. Westerterp KR, Donkers JH, Fredrix EW, Boekhoudt P. Energy intake, physical activity and body weight: a simulation model. Br J Nutr. 1995;73(3):337-347. PMID 7766558. DOI 10.1079/bjn19950037.
28. Kozusko FP. Body weight setpoint, metabolic adaption and human starvation. Bull Math Biol. 2001;63(2):393-403. PMID 11276532. DOI 10.1006/bulm.2001.0229.
29. Christiansen E, Garby L, Sorensen TI. Quantitative analysis of the energy requirements for development of obesity. J Theor Biol. 2005;234(1):99-106. PMID 15721039. DOI 10.1016/j.jtbi.2004.11.012.
30. Flatt JP. Carbohydrate-fat interactions and obesity examined by a two-compartment computer model. Obes Res. 2004;12(12):2013-2022. PMID 15687403. DOI 10.1038/oby.2004.252.
31. Song B, Thomas DM. Dynamics of starvation in humans. J Math Biol. 2007;54(1):27-43. PMID 16960688. DOI 10.1007/s00285-006-0037-7.
32. Speakman JR, Westerterp KR. A mathematical model of weight loss under total starvation: evidence against the thrifty-gene hypothesis. Dis Model Mech. 2013;6(1):236-251. PMID 22864023. DOI 10.1242/dmm.010009. PMC3529354.
33. Torres M, Trexler ET, Smith-Ryan AE, Reynolds A. A mathematical model of the effects of resistance exercise-induced muscle hypertrophy on body composition. Eur J Appl Physiol. 2018;118(2):449-460. PMID 29256047. DOI 10.1007/s00421-017-3787-6. (Correction: PMID 29948197.)
34. Heymsfield SB, Thomas D, Nguyen AM, et al. Voluntary weight loss: systematic review of early phase body composition changes. Obes Rev. 2011;12(5):e348-e361. PMID 20524998. DOI 10.1111/j.1467-789X.2010.00767.x.
35. Heymsfield SB, Thomas D, Martin CK, et al. Energy content of weight loss: kinetic features during voluntary caloric restriction. Metabolism. 2012;61(7):937-943. PMID 22257646. DOI 10.1016/j.metabol.2011.11.012. PMC3810417.
36. Heymsfield SB, Gonzalez MC, Shen W, Redman L, Thomas D. Weight loss composition is one-fourth fat-free mass: a critical review and critique of this widely cited rule. Obes Rev. 2014;15(4):310-321. PMID 24447775. DOI 10.1111/obr.12143. PMC3970209.
37. Wishnofsky M. Caloric equivalents of gained or lost weight. Am J Clin Nutr. 1958;6(5):542-546. PMID 13594881. DOI 10.1093/ajcn/6.5.542.
38. Kreitzman SN, Coxon AY, Szaz KF. Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition. Am J Clin Nutr. 1992;56(1 Suppl):292S-293S. PMID 1615908. DOI 10.1093/ajcn/56.1.292S.
39. Fernandez-Elias VE, Ortega JF, Nelson RK, Mora-Rodriguez R. Relationship between muscle water and glycogen recovery after prolonged exercise in the heat in humans. Eur J Appl Physiol. 2015;115(9):1919-1926. PMID 25911631. DOI 10.1007/s00421-015-3175-z.
40. Acheson KJ, Schutz Y, Bessard T, Anantharaman K, Flatt JP, Jequier E. Glycogen storage capacity and de novo lipogenesis during massive carbohydrate overfeeding in man. Am J Clin Nutr. 1988;48(2):240-247. PMID 3165600. DOI 10.1093/ajcn/48.2.240.
41. Olsson KE, Saltin B. Variation in total body water with muscle glycogen changes in man. Acta Physiol Scand. 1970;80(1):11-18. PMID 5475323. DOI 10.1111/j.1748-1716.1970.tb04764.x. (Located; not read.)
42. McBride J, Guest M, Scott E. The storage of the major liver components; emphasizing the relationship of glycogen to water in the liver and the hydration of glycogen. J Biol Chem. 1941;139:943-952. (As cited in [1,3].)
43. Hall KD, Bemis T, Brychta R, et al. Calorie for calorie, dietary fat restriction results in more body fat loss than carbohydrate restriction in people with obesity. Cell Metab. 2015;22(3):427-436. PMID 26278052. DOI 10.1016/j.cmet.2015.07.021. PMC4603544.
44. Hall KD, Chen KY, Guo J, et al. Energy expenditure and body composition changes after an isocaloric ketogenic diet in overweight and obese men. Am J Clin Nutr. 2016;104(2):324-333. PMID 27385608. DOI 10.3945/ajcn.116.133561. PMC4962163. (Abstract-level data used.)
45. Hall KD, Guo J, Courville AB, et al. Effect of a plant-based, low-fat diet versus an animal-based, ketogenic diet on ad libitum energy intake. Nat Med. 2021;27(2):344-353. PMID 33479499. DOI 10.1038/s41591-020-01209-1.
46. Keys A, Brozek J, Henschel A, Mickelsen O, Taylor HL. The Biology of Human Starvation. Minneapolis: University of Minnesota Press; 1950. (Data via [2,5,6,47-50].)
47. Dulloo AG, Jacquet J, Girardier L. Autoregulation of body composition during weight recovery in human: the Minnesota Experiment revisited. Int J Obes Relat Metab Disord. 1996;20(5):393-405. PMID 8696417.
48. Dulloo AG, Jacquet J. Adaptive reduction in basal metabolic rate in response to food deprivation in humans: a role for feedback signals from fat stores. Am J Clin Nutr. 1998;68(3):599-606. PMID 9734736. DOI 10.1093/ajcn/68.3.599.
49. Dulloo AG, Jacquet J. The control of partitioning between protein and fat during human starvation: its internal determinants and biological significance. Br J Nutr. 1999;82(5):339-356. PMID 10673906. DOI 10.1017/S0007114599001580.
50. Dulloo AG. Physiology of weight regain: lessons from the classic Minnesota Starvation Experiment on human body composition regulation. Obes Rev. 2021;22(Suppl 2):e13189. PMID 33543573. DOI 10.1111/obr.13189.
51. Heilbronn LK, de Jonge L, Frisard MI, et al. Effect of 6-month calorie restriction on biomarkers of longevity, metabolic adaptation, and oxidative stress in overweight individuals: a randomized controlled trial. JAMA. 2006;295(13):1539-1548. PMID 16595757. DOI 10.1001/jama.295.13.1539. PMC2692623.
52. Redman LM, Heilbronn LK, Martin CK, et al. Metabolic and behavioral compensations in response to caloric restriction: implications for the maintenance of weight loss. PLoS One. 2009;4(2):e4377. PMID 19198647. DOI 10.1371/journal.pone.0004377. PMC2634841.
53. Ravussin E, Redman LM, Rochon J, et al. A 2-year randomized controlled trial of human caloric restriction: feasibility and effects on predictors of health span and longevity. J Gerontol A Biol Sci Med Sci. 2015;70(9):1097-1104. PMID 26187233. DOI 10.1093/gerona/glv057. PMC4841173.
54. Weyer C, Walford RL, Harper IT, Milner M, MacCallum T, Tataranni PA, Ravussin E. Energy metabolism after 2 y of energy restriction: the Biosphere 2 experiment. Am J Clin Nutr. 2000;72(4):946-953. PMID 11010936. DOI 10.1093/ajcn/72.4.946.
55. Bouchard C, Tremblay A, Despres JP, et al. The response to long-term overfeeding in identical twins. N Engl J Med. 1990;322(21):1477-1482. PMID 2336074. DOI 10.1056/NEJM199005243222101.
56. Levine JA, Eberhardt NL, Jensen MD. Role of nonexercise activity thermogenesis in resistance to fat gain in humans. Science. 1999;283(5399):212-214. PMID 9880251. DOI 10.1126/science.283.5399.212.
57. Diaz EO, Prentice AM, Goldberg GR, Murgatroyd PR, Coward WA. Metabolic response to experimental overfeeding in lean and overweight healthy volunteers. Am J Clin Nutr. 1992;56(4):641-655. PMID 1414963. DOI 10.1093/ajcn/56.4.641.
58. Jebb SA, Prentice AM, Goldberg GR, Murgatroyd PR, Black AE, Coward WA. Changes in macronutrient balance during over- and underfeeding assessed by 12-d continuous whole-body calorimetry. Am J Clin Nutr. 1996;64(3):259-266. PMID 8780332. DOI 10.1093/ajcn/64.3.259.
59. Horton TJ, Drougas H, Brachey A, Reed GW, Peters JC, Hill JO. Fat and carbohydrate overfeeding in humans: different effects on energy storage. Am J Clin Nutr. 1995;62(1):19-29. PMID 7598063. DOI 10.1093/ajcn/62.1.19.
60. Bray GA, Smith SR, de Jonge L, et al. Effect of dietary protein content on weight gain, energy expenditure, and body composition during overeating: a randomized controlled trial. JAMA. 2012;307(1):47-55. PMID 22215165. DOI 10.1001/jama.2011.1918. PMC3777747.
61. Leibel RL, Rosenbaum M, Hirsch J. Changes in energy expenditure resulting from altered body weight. N Engl J Med. 1995;332(10):621-628. PMID 7632212. DOI 10.1056/NEJM199503093321001.
62. Polidori D, Sanghvi A, Seeley RJ, Hall KD. How strongly does appetite counter weight loss? Quantification of the feedback control of human energy intake. Obesity (Silver Spring). 2016;24(11):2289-2295. PMID 27804272. DOI 10.1002/oby.21653. PMC5108589.
63. Longland TM, Oikawa SY, Mitchell CJ, Devries MC, Phillips SM. Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss: a randomized trial. Am J Clin Nutr. 2016;103(3):738-746. PMID 26817506. DOI 10.3945/ajcn.115.119339.
64. Murphy C, Koehler K. Energy deficiency impairs resistance training gains in lean mass but not strength: a meta-analysis and meta-regression. Scand J Med Sci Sports. 2022;32(1):125-137. PMID 34623696. DOI 10.1111/sms.14075.
65. Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. Int J Sport Nutr Exerc Metab. 2011;21(2):97-104. PMID 21558571. DOI 10.1123/ijsnem.21.2.97.
66. Phillips SM, Tipton KD, Aarsland A, Wolf SE, Wolfe RR. Mixed muscle protein synthesis and breakdown after resistance exercise in humans. Am J Physiol. 1997;273(1 Pt 1):E99-E107. PMID 9252485. DOI 10.1152/ajpendo.1997.273.1.E99.
67. MacDougall JD, Gibala MJ, Tarnopolsky MA, MacDonald JR, Interisano SA, Yarasheski KE. The time course for elevated muscle protein synthesis following heavy resistance exercise. Can J Appl Physiol. 1995;20(4):480-486. PMID 8563679. DOI 10.1139/h95-038.
68. Atherton PJ, Etheridge T, Watt PW, et al. Muscle full effect after oral protein: time-dependent concordance and discordance between human muscle protein synthesis and mTORC1 signaling. Am J Clin Nutr. 2010;92(5):1080-1088. PMID 20844073. DOI 10.3945/ajcn.2010.29819.
69. Bergman RN, Phillips LS, Cobelli C. Physiologic evaluation of factors controlling glucose tolerance in man. J Clin Invest. 1981;68(6):1456-1467. PMID 7033284. DOI 10.1172/JCI110398. PMC370948.
70. Bergman RN, Ider YZ, Bowden CR, Cobelli C. Quantitative estimation of insulin sensitivity. Am J Physiol. 1979;236(6):E667-E677. PMID 443421. DOI 10.1152/ajpendo.1979.236.6.E667.
71. Bergman RN. Origins and history of the minimal model of glucose regulation. Front Endocrinol (Lausanne). 2020;11:583016. PMID 33658981. DOI 10.3389/fendo.2020.583016. PMC7917251.
72. Dalla Man C, Rizza RA, Cobelli C. Meal simulation model of the glucose-insulin system. IEEE Trans Biomed Eng. 2007;54(10):1740-1749. PMID 17926672. DOI 10.1109/TBME.2007.893506. (Structure via [75]; parameter table not accessed.)
73. Dalla Man C, Caumo A, Cobelli C. The oral glucose minimal model: estimation of insulin sensitivity from a meal test. IEEE Trans Biomed Eng. 2002;49(5):419-429. PMID 12002173. DOI 10.1109/10.995680.
74. Cobelli C, Dalla Man C, Toffolo G, Basu R, Vella A, Rizza R. The oral minimal model method. Diabetes. 2014;63(4):1203-1213. PMID 24651807. DOI 10.2337/db13-1198. PMC4179313.
75. Dalla Man C, Raimondo DM, Rizza RA, Cobelli C. GIM, simulation software of meal glucose-insulin model. J Diabetes Sci Technol. 2007;1(3):323-330. PMID 19885087. DOI 10.1177/193229680700100303. PMC2769591.
76. Balasse EO, Fery F. Ketone body production and disposal: effects of fasting, diabetes, and exercise. Diabetes Metab Rev. 1989;5(3):247-270. (As cited in [1].)
77. Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr. 1990;51(2):241-247. (As cited in [1,3].)
78. Jackson AS, Stanforth PR, Gagnon J, et al. The effect of sex, age and race on estimating percentage body fat from body mass index: The Heritage Family Study. Int J Obes Relat Metab Disord. 2002;26(6):789-796. (As cited in [1,3].)
79. Livingston EH, Kohlstadt I. Simplified resting metabolic rate-predicting formulas for normal-sized and obese individuals. Obes Res. 2005;13(7):1255-1262. PMID 16076996. DOI 10.1038/oby.2005.149.
80. Silva AM, Wang J, Pierson RN Jr, et al. Extracellular water across the adult lifespan: reference values for adults. Physiol Meas. 2007;28(5):489-502. PMID 17470983. DOI 10.1088/0967-3334/28/5/004.
81. Friedlander AL, Braun B, Pollack M, et al. Three weeks of caloric restriction alters protein metabolism in normal-weight, young men. Am J Physiol Endocrinol Metab. 2005;289(3):E446-E455. PMID 15870104. DOI 10.1152/ajpendo.00001.2005.
82. Tremblay A, Despres JP, Theriault G, Fournier G, Bouchard C. Overfeeding and energy expenditure in humans. Am J Clin Nutr. 1992;56(5):857-862. PMID 1415004. DOI 10.1093/ajcn/56.5.857.
83. Svetkey LP, Stevens VJ, Brantley PJ, et al. Comparison of strategies for sustaining weight loss: the weight loss maintenance randomized controlled trial. JAMA. 2008;299(10):1139-1148. PMID 18334689. DOI 10.1001/jama.299.10.1139.
84. Hall KD. Modeling metabolic adaptations and energy regulation in humans. Annu Rev Nutr. 2012;32:35-54. PMID 22540251. DOI 10.1146/annurev-nutr-071811-150705. (Located; not read.)
85. Nelson KM, Weinsier RL, Long CL, Schutz Y. Prediction of resting energy expenditure from fat-free mass and fat mass. Am J Clin Nutr. 1992;56(5):848-856. (As cited in [3].)
