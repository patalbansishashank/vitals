# 09 — Resistance training → hypertrophy, strength, lean-mass retention, detraining

> Dossier for the Vitals mechanistic engine. Written for a software engineer: every equation is
> implementable; every number carries a citation `[n]` (see §11) and an evidence grade.
> `PROPOSED FIT` = our own curve fitted to the listed published data points.
> `UNVERIFIED` = figure from memory / secondary source that we could not confirm in a primary source.
> Last literature check: 2026-09-30 (includes Pelland 2026 Sports Med meta-regression and the 2026 ACSM RT
> Position Stand).

---

## 1. Scope

Resistance training (RT) as a daily input, per muscle region: sets (direct / indirect), proximity to failure
(RIR), load, rest, range of motion, frequency, session timing. Outputs: training-attributable lean mass
(whole body and per region), apparent muscle size (incl. early oedema), a post-exercise muscle-protein-
synthesis (MPS) signal for dossier 03, strength, training status, detraining/retraining, lean-mass retention in
an energy deficit, session energy cost. The module does **not** own protein kinetics (03), whole-body energy
partitioning (01/11), glycogen/water (04), cardio (10) or anthropometric mapping (14). It supplies them
terms with defined hand-off interfaces (§5).

---

## 2. State variables

Index `r` = muscle region (default 9 regions, §4.15). All daily states are updated once per simulated day
unless noted; `S_mps` may be evaluated hourly.

| Name | Unit | Typical range | Represents | Initial-value rule |
|---|---|---|---|---|
| `V_r` | effective sets / 7 d | 0 – 40 | Rolling 7-day sum of *effective* hard sets for region r (§4.1) | Sum of the user's habitual week (0 if untrained) |
| `F_r` | sessions / 7 d | 0 – 7 | Number of days in the last 7 with ≥1 effective set for region r | From habitual week |
| `S_mps,r(t)` | fraction above basal MPS | 0 – 1.6 | Acute exercise-induced MPS elevation (§4.4); decays over 12–48 h | 0 |
| `H_r` | 0 – 1 | 0 – 1 | Habituation / repeated-bout state: fraction of MPS "refined" toward hypertrophy rather than repair (§4.5) | 1 if trained continuously in last 8 wk, else 0 |
| `W_r` | fraction of regional muscle volume | 0 – 0.05 | Oedema / swelling pseudo-hypertrophy (§4.5) | 0 |
| `M_acc,r` | kg lean (FFM-equivalent) | 0 – `G_pot,r` | Lean mass attributable to training above the person's untrained set-point (§4.6) | `TS₀·G_pot,r` from training history / FFMI (§4.6 "Initialisation") |
| `M_peak,r` | kg | ≥ `M_acc,r` | Highest `M_acc,r` ever reached (muscle-memory reference, §4.10) | = `M_acc,r(0)` (or user-declared past peak) |
| `T_low,r` | days | 0 – ∞ | Consecutive days with `V_r` below maintenance dose (§4.10) | 0 if training, else large |
| `N` | fraction | 0 – 0.35 | Neural / skill contribution to strength above untrained (§4.14) | `0.8·N_max(TS₀)` if currently training; 0 if untrained |
| `Fat_acute` | 0 – 1 | 0 – 1 | Acute neuromuscular fatigue (performance only, §4.11) | 0 |
| **Derived** `TS_r = M_acc,r / G_pot,r` | 0 – 1 | 0 – 0.95 | Training status = fraction of trainable potential realised | computed |
| **Derived** `TS = Σ M_acc,r / Σ G_pot,r` | 0 – 1 | | Whole-body training status | computed |
| **Derived** `G_pot = ΔFFMI_pot · h²` | kg | 8 – 25 | Genetic trainable lean-mass potential (§4.6) | from sex, height |

Categorical mapping for the UI: novice `TS < 0.30`, intermediate `0.30–0.65`, advanced `0.65–0.90`,
near-ceiling `> 0.90` (PROPOSED, consistent with the heuristic tables in §4.6).

---

## 3. Inputs that drive it

| Input | Unit | Source | How it enters |
|---|---|---|---|
| Sets per region per session (direct) | sets | user schedule | ×1.0 into effective sets (§4.1) |
| Sets per region (indirect, e.g. triceps in bench press) | sets | user / exercise library | ×0.5 ("fractional" counting) [3] |
| Proximity to failure | RIR (reps in reserve) | user (or preset) | `f_RIR` multiplier (§4.1) |
| Load | %1RM or rep range | user (or preset) | `f_load` (hypertrophy), `f_loadS` (strength) |
| Inter-set rest | s | user (or preset) | `f_rest` |
| Range of motion / muscle length emphasis | categorical | optional | `f_ROM` |
| Simple descriptor (if user does not enter sets) | preset | user | maps to `V_r` (§4.1 table) |
| Session clock time, duration, fed/fasted | h, min | user | energy cost (§4.13); fasted high-volume penalty (§4.12); MPS kernel timing for 03 |
| Energy balance `e = (EI − TDEE)/TDEE` | fraction | 01/02 | `f_E` (§4.8) |
| Protein intake | g·kg⁻¹·d⁻¹ | 03 | `f_P`, `ρ(P)` (§4.8) |
| Body-fat mass / % | kg, % | 01/14 | via 01's Forbes/Hall partition of non-RT lean change (§4.8) |
| Sex, age, height | — | profile | `G_pot`, `f_age`, maintenance dose |
| Training history | years consistent RT, or FFMI | profile | initial `M_acc`, `TS` (§4.9) |
| Sleep, alcohol, illness | — | 15/16 | optional multipliers on `A_r` (§5) |
| Concurrent cardio | — | 10 | hypertrophy multiplier 1.0 (§4.12) |

---

## 4. Mechanisms & equations

### 4.1 Effective-set stimulus scalar (collapsing volume, failure, load, rest, ROM)

**Mechanism.** Hypertrophy is driven by mechanical tension on high-threshold motor units; the best single
predictor across the literature is the number of *hard* sets per muscle per week. Proximity to failure, very
light loads, very short rest and short-length partial ROM each reduce the stimulus per set; load between
~30 % and ~90 % 1RM does not matter when sets are taken close to failure [7, 8, 13]. We therefore collapse
all set-level variables into one scalar "effective set".

```
e_set = w_dir · f_RIR(RIR, L) · f_load(L) · f_rest(t_rest) · f_ROM(ROM) · f_fastHV
V_r(t) = Σ_{d = t−6 … t} Σ_{sets on day d hitting region r} e_set          (rolling 7-day sum)

w_dir    = 1.0 direct set, 0.5 indirect set                                          [3]
f_RIR    = clamp(1 − k_RIR(L) · RIR, 0, 1)
           k_RIR = 0.059 per RIR (moderate loads 60–80 %1RM)                          [9] (fit below)
           k_RIR = 0.045 if L ≥ 80 %1RM ; 0.075 if L < 60 %1RM   (PROPOSED: [9] reports the RIR slope
           is less steep with heavier loads, direction only)
f_load   = 1.0 if L ≥ 35 %1RM (sets near failure)                                    [7, 8, 20]
           0.45 at L = 20 %1RM; linear between 20 and 35 %                            [20] (fit below)
           0.35 if L < 20 %1RM  (UNVERIFIED extrapolation)
f_rest   = 0.88 if rest ≤ 60 s ; 0.95 if 60–90 s ; 1.0 if ≥ 90 s                       [12] (fit below)
f_ROM    = 1.0 full ROM ; 1.0 partial ROM at long muscle length ; 0.75 partial ROM at short
           muscle length ; ×1.2 for a bi-articular head trained at long length          [15–19] PROPOSED
f_fastHV = 0.95 for sets beyond the 10th per region in one session when training fasted/
           glycogen-depleted; else 1.0                                                 [81] PROPOSED
```

**Fit details / data points.**
- `k_RIR`: Robinson 2024 exploratory meta-regression (26 studies, 140 hypertrophy effects, mean duration
  8.3 wk). Its OSF marginal-means table for hypertrophy (response ratio) gives: 0 RIR = 8.77 %,
  1 = 8.25, 2 = 7.73, 3 = 7.22, 5 = 6.19, 10 = 3.67, 17 ≈ 0.24 % [9]. Linear slope 0.516 %/RIR ÷ 8.77 % =
  **0.059 per RIR relative** (95 % CI of the published slope −0.78 to −0.18 %/RIR ⇒ relative
  0.02–0.09). Direct trials show 1–2 RIR ≈ failure [10, 11] — consistent with a shallow slope near 0.
- `f_load`: Lasevicius 2018, volume-matched, 12 wk: CSA vastus lateralis +8.9 % (20 %1RM) vs +20.5 / 20.4 /
  19.5 % (40/60/80 %1RM); elbow flexors +11.4 % vs +25.3 / 25.1 / 25.0 % [20] ⇒ 20 %1RM ≈ 0.45 of the
  stimulus. Low-vs-high load meta-analyses (sets to failure): hypertrophy similar [7]; network meta-analysis
  (28 studies, 747 adults) no hypertrophy difference among low (>15RM), moderate (9–15RM), high (≤8RM) [8].
- `f_rest`: Bayesian meta-analysis (9 studies): within-group SMD short (≤60 s) 0.48 vs longer 0.56 (ratio
  0.86); controlled contrasts favour longer rest in arm 0.13 and thigh 0.17 SMD; no further benefit beyond
  ~90 s [12].
- `f_ROM`: full > partial ROM for lower-limb hypertrophy, ES 0.88 [15]; later meta-analysis: trivial SMD
  0.12 favouring full ROM, but partial ROM *at long muscle lengths* trends better than full (−0.28, 95 % CI
  −0.81 to 0.16) [16]; seated vs prone leg curl whole-hamstrings +14 % vs +9 % [17]; overhead vs neutral
  elbow extension long head +28.5 % vs +19.6 % (1.5×) [18]; knee-extension partial ROM at long lengths
  > short-length partial [19].

**Simple-descriptor presets (if the user does not enter sets).** Values are *effective* sets per major region
per week (PROPOSED; mapping of typical programmes to the dose axis of [3]):

| Preset | Typical programme | `V_r` | `F_r` |
|---|---|---|---|
| None | — | 0 | 0 |
| Minimal | 1×/wk full body, 1 set/exercise, RIR 2–3 | 2.5 | 1 |
| Light | 2×/wk full body, 2 sets, RIR 2–4 | 5 | 2 |
| Moderate (literature median) | 3×/wk full body or upper/lower, 2–3 sets, RIR 1–3 | 11 | 2–3 |
| High | 4–5×/wk split, RIR 0–2 | 18 | 2 |
| Very high | 5–6×/wk, specialised | 27 | 2–3 |

Parameter table

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| `w_dir` indirect | 0.5 | — | "fractional" beat "total"/"direct" (2·logBF 9.5–10.8) | [3] |
| `k_RIR` | 0.059 | /RIR | 0.02–0.09 | [9] |
| `f_load(20 %1RM)` | 0.45 | — | 0.4–0.6 | [20] |
| `f_rest(≤60 s)` | 0.88 | — | 0.8–1.0 | [12] |
| `f_ROM` short partial | 0.75 | — | 0.6–1.0 | [15, 16] PROPOSED |

**Time dynamics:** instantaneous (per set). **Moderators:** trained status does not change the load
independence [102]. **Evidence grade:** volume counting & load independence **A** (multiple meta-analyses);
RIR slope **B** (one exploratory meta-regression with estimated RIR + consistent trials); rest **B**; ROM /
long-length **C** (few trials, CIs cross zero).

---

### 4.2 Weekly volume → hypertrophy dose-response

**Mechanism.** More weekly hard sets per muscle → more hypertrophy, with diminishing returns; no clear
plateau up to ~40 sets in current data; strength saturates at far lower volumes [1, 3].

**Exact reproduction of the Pelland 2026 best-fit model** (square-root form, "fractional" sets,
35 studies / 220 effects / 1 032 participants; adjusted for duration, frequency and training status; mean
duration 10.4 wk) [3]. From the authors' OSF pairwise-comparison table (control-adjusted marginal means vs
0 sets) we fitted:

```
G(V) = exp( β · (sqrt(V + 1) − 1) ) − 1          β = 0.01768   (max abs error 0.005 %-points, V = 1…45)
%Δ muscle size over ~10.4 wk (vs non-training control) = 100 · G(V)
```

Hand-check values (published table → our formula): V = 1: 0.74 %; 4: 2.21 %; 10: 4.18 %; 20: 6.54 %;
30: 8.41 %; 40: 10.03 %; 45: 10.77 % (95 % CrI at 20 sets: 3.87–9.12 %).

**Engine multiplier** (relative to the literature median dose of ~12 fractional sets/wk [3]):

```
f_V(V) = G(min(V, V_cap)) / G(12)          V_cap = 40
```

| V (eff. sets/wk) | 0 | 1 | 2 | 4 | 6 | 8 | 10 | 12 | 15 | 20 | 25 | 30 | 35 | 40 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `f_V` | 0 | 0.16 | 0.28 | 0.47 | 0.63 | 0.76 | 0.89 | 1.00 | 1.16 | 1.39 | 1.59 | 1.78 | 1.96 | 2.13 |

Efficiency tiers published with the model (smallest detectable effect 2.05 %): minimum effective dose
**4 sets/wk**; 5–10 sets: ~6 extra sets per detectable increment; 11–18: ~8.5; 19–29: ~10.75; 30–42: ~12.5;
≥43: insufficient data [3].

**Corroborating data.**
- Schoenfeld 2017 meta-regression (15 studies, 34 groups): each additional weekly set +0.023 ES ≈ +0.37 %
  hypertrophy; higher vs lower volume ES difference 0.241 (≈3.9 %) [1]. Pelland's marginal slope at the mean
  (12.25 sets) is 0.24 %/set (95 % CrI 0.15–0.33) [3].
- Baz-Valle 2022 (trained young men, 6 studies): 12–20 vs >20 sets no difference for quadriceps (p = 0.19)
  and biceps (p = 0.59); >20 better for triceps (p = 0.01) [2].
- Per-day rates (novice elbow flexors, Wernbom 2007 review as summarised in [107]): CSA +0.17 / 0.24 / 0.18 %
  per day for 3–3.5 / 4–6 / ≥9 sets per session, i.e. ≈ +12–17 % in 10 wk — the order of magnitude our
  regional growth must reach in novices.
- Trained men, 8 wk, 1/3/5 sets per exercise 3×/wk: elbow-extensor MT +1.1 % (6 sets/wk) vs +5.5 %
  (30 sets/wk); mid-thigh +3.4 % (9) vs +12.5 % (45); lateral thigh +5.0 % vs +13.7 % [100].
- Counter-example: squatting-trained lifters, 8 wk, 12 vs 18 vs 24 lower-body sets/wk: ΣMT +7.7 / 6.7 / 6.1 %,
  no group difference [101].
- ACSM 2026 overview of 137 systematic reviews: hypertrophy enhanced by ≥10 sets/wk and eccentric
  overload; failure training, periodisation, equipment not consistently influential [14].

**Maintenance volume.** After 16 wk of 3×/wk training, 32 wk at **1/3 or 1/9 of the training dose preserved
myofibre hypertrophy in young (20–35 y) but not older (60–75 y) adults**; 1/3 dose even gave further growth in
the young; detraining reversed it [4]. (The absolute sets/wk this corresponds to — roughly 3 sets/wk for the
knee extensors at 1/9 dose — is our reading of the protocol, `UNVERIFIED`.) Engine: `V_maint(age)` in §4.10.

**Strength dose-response (same meta-regression, reciprocal model)** [3]:

```
%Δ 1RM-type strength over ~10.4 wk = 100 · (exp(0.14635 · V/(V+1)) − 1)
   V = 1: 7.6 % ; 2: 10.3 % ; 4: 12.4 % ; 6: 13.4 % ; 10: 14.2 % ; 20: 15.0 % ; 30: 15.2 %
```
(max abs error of our fit 0.005 %-points). Minimum effective dose 1 set; no detectable gains beyond ~4–5
fractional sets/wk [3]. Used in §4.14.

**Time dynamics:** volume acts through the 7-day window; effect accrues daily (§4.9). **Moderators:** none
reliably moderated the volume slope in exploratory analyses [3]; older adults: higher-volume programmes
associated with larger LBM gains (β = 0.05) [24]. **Evidence grade A** for a positive, diminishing
dose-response up to ~20–25 sets; **C** beyond ~30 sets (few studies; compatible with plateau or
inverted-U [3]).

---

### 4.3 Frequency

**Mechanism.** With weekly volume equated, how many sessions it is split into has little effect on
hypertrophy; it matters more for strength (practice) [3, 5, 6].

- 2 vs 1×/wk (not volume-equated): ES 0.49 vs 0.30 [5]. Volume-equated: no significant difference [6].
- Pelland 2026 reciprocal model (adjusted for volume): hypertrophy +1.61 % (1 session) , +2.15 % (2),
  +2.42 % (3), +2.77 % (6) vs 0 — posterior probability of positive slope only 91.3 % ("compatible with
  negligible"); strength +12.7 % (1), +17.3 % (2), +19.7 % (3), +22.8 % (6), probability 100 % [3].

Engine (PROPOSED from [3], relative to 2 sessions at 12 sets; differences 1→2 = −0.54 %, 2→3 = +0.27 %
against 4.72 % at 12 sets):
```
f_F(F_r) = 0 (F=0), 0.90 (F=1), 1.00 (F=2), 1.05 (F≥3)
Strength practice factor f_FS(F) = (exp(0.2395·F/(F+1)) − 1)/(exp(0.2395·2/3) − 1)   [3]
   F=1: 0.73 ; 2: 1.00 ; 3: 1.14 ; 4: 1.22 ; 6: 1.32
```
**Evidence grade:** hypertrophy **B** (no meaningful effect when volume-matched); strength frequency **B**.

---

### 4.4 Post-exercise MPS elevation kernel (feeds dossier 03)

**Mechanism.** A bout raises myofibrillar/mixed MPS within hours; in untrained muscle the elevation lasts
~36–48 h, in trained muscle it peaks higher/earlier and is back to baseline by ~28 h; overall synthetic
area is smaller in the trained state [37–41]. Fasted net balance stays negative without protein [40], so
this kernel must be combined with feeding by dossier 03.

Data points:

| Study | Population / state | Time post-exercise → MPS vs rest |
|---|---|---|
| Chesley 1992 [39] | untrained young men, biceps | 4 h +50 %; 24 h +109 % |
| MacDougall 1995 [38] | 6 young men, 12 sets elbow flexion | 36 h +14 % (n.s.) — "almost returned to baseline" |
| Phillips 1997 [40] | 8 untrained (4 M/4 F), fasted, 8×8 @80 % | 3 h +112 %; 24 h +65 %; 48 h +34 %; FBR +31 % (3 h), +18 % (24 h), baseline 48 h |
| Tang 2008 [41] | 10 young men, fed, after 8 wk unilateral training | 4 h: trained leg +162 %, untrained leg +108 %; 28 h: trained leg back to rest, untrained leg +70 % |
| Damas 2016 [35] | 10 untrained men, D₂O | integrated MyoPS response in wk 1 > wk 3 = wk 10; only wk-3/10 responses correlate with hypertrophy (r ≈ 0.9) |

**Kernel (PROPOSED FIT).** For region r, session at time `t_s` with `s` effective sets:
```
S_mps,r(t) = Σ_sessions  A(H_r) · a(s) · φ(t − t_s ; τ(H_r))
φ(Δ) = Δ / 3 h                         for 0 ≤ Δ < 3 h
     = exp( −(Δ − 3 h) / τ )           for Δ ≥ 3 h
A(H) = 1.0 + 0.6·H        (peak fractional elevation: ~+100 % untrained, ~+160 % habituated)
τ(H) = 30 h − 20 h·H      (untrained 30 h; habituated 10 h)
a(s) = 1 − exp(−s / 4)    (PROPOSED saturation with session volume; grade D)
Whole-body signal: S_mps,wb = Σ_r m_r·S_mps,r / Σ_r m_r   (m_r = regional muscle mass)
```
Check vs data: untrained, τ = 30 h: 24 h → 0.50 of peak (Phillips 0.58), 48 h → 0.23 (Phillips 0.30);
habituated τ = 10 h: 28 h → 0.08 of peak (Tang ≈ 0). Integrated area (per unit `a`): untrained
1.0·(1.5 + 30) = 31.5 h; habituated 1.6·(1.5 + 10) = 18.4 h ⇒ ~40 % smaller in the trained state, consistent
with the "dampened" response [37].

**Use.** This kernel is an *output* (chart "MPS elevation") and the *coupling* to 03 (post-exercise
sensitisation of meal-protein MPS). It is **not** integrated to produce growth — growth uses the empirically
calibrated weekly-volume mapping (§4.9), because acute MPS does not predict hypertrophy in untrained muscle
[35, 37]. **Evidence grade B** (consistent tracer studies, small n; kernel shape is a fit).

---

### 4.5 Early phase: habituation, oedema vs true hypertrophy, onset lag

**Mechanism.** In the first weeks of unaccustomed RT much of the MPS response is directed at damage repair;
muscle damage (Z-band streaming) is highest at week 1, lower at week 3, minimal at week 10; fibre CSA only
increased by week 10 [35]. Whole-muscle CSA rose ~2.7 % by week 3 but with a 17 % rise in echo-intensity
(oedema) — early CSA gains are largely swelling [34]. Others detect true CSA gains from ~3 wk (QF CSA
+3.5 %/+5.2 % at day 20, +6.5 %/+7.4 % at day 35; architecture changes from day 10) [36].
Previously trained muscle shows little damage from a novel eccentric bout (T2 +4–6 % vs +52 % in controls) [17].

```
Habituation:   dH_r/dt = (1 − H_r)/τ_H,up     if a session hit region r in the last 7 days
               dH_r/dt = −H_r/τ_H,down        otherwise
               τ_H,up = 14 d  (PROPOSED: "refined by 3 wk" [35]) ; τ_H,down = 60 d (UNVERIFIED; repeated-bout
               protection persists weeks–months)
Growth efficiency multiplier = H_r  (used in §4.9)

Oedema:        dW_r/dt = ( a_sw·(1 − H_r)·min(1, V_r/10) − W_r ) / τ_sw
               a_sw = 0.05 ; τ_sw = 7 d   (PROPOSED)
Apparent regional muscle size (ultrasound/MRI/circumference) = M_r·(1 + W_r)
```
Simulated novice (V = 10): H = 0.40 / 0.65 / 0.79 / 0.96 at day 7 / 14 / 21 / 42; W = 2.4 % / 2.2 % /
1.6 % / 0.4 %. Target: ~+2.7 % apparent CSA at wk 3 of which most is oedema, ~+10 % at wk 10 [34].

**Strength early:** 1RM rises by week 2–4 before measurable hypertrophy (men KE by wk 2, chest press by wk 6;
MTH chest/triceps significant by wk 6) [93]; MVC +38.9 % and EMG +34.8 % by day 35 [36] ⇒ neural state N
(§4.14) must rise faster than muscle.

**Evidence grade B** for the phenomenon (two independent human studies); **C** for time-constants.

---

### 4.6 Maximum gain rate, training status and the genetic ceiling — `maxGainRate()`

**Mechanism.** The rate of training-induced lean gain is highest in novices and falls as the person
approaches a genetically bounded ceiling. We model a first-order approach to a ceiling `G_pot` whose rate
constant is scaled by the stimulus and nutrition multipliers.

```
G_pot     = ΔFFMI_pot(sex) · h²                              [kg trainable lean above untrained set-point]
ΔFFMI_pot = 6.0 kg/m² (men; range 5–7) ; 4.3 kg/m² (women; range 3.3–5.3)          PROPOSED (grade D)
G_pot,r   = w_r · G_pot                                       (region weights §4.15)
TS_r      = M_acc,r / G_pot,r

maxGainRate_r (kg/day) = k_g · G_pot,r · (1 − TS_r) · f_age(age)
k_g       = 0.55 yr⁻¹ = 0.001507 d⁻¹                           PROPOSED FIT (calibration below)
```

**Calibration of `k_g` (PROPOSED FIT).** Targets under "average study conditions" (V ≈ 12, frequency 2–3,
protein ≈ 1.4 g/kg, energy balance ≈ 0, habituation ramp from day 0):
- Benito 2020, 111 studies / 1 927 healthy men 18–40 y, not in deficit, mean duration FFM studies
  10.4 ± 5.4 wk: FFM +1.56 kg overall; untrained +1.54 kg (95 % CI 1.12–1.96); trained (>1 y) +0.98 kg
  (0.17–1.79) [21]. Model: untrained +1.49 kg; TS₀ = 0.45: +0.99 kg.
- Morton 2018, 49 RCTs / 1 863 adults: RT alone (13 ± 8 wk) FFM +1.1 ± 1.2 kg; protein supplementation added
  +0.30 kg (0.09–0.52) [22]. (Mixed ages/sexes/volumes; model for young men predicts 1.6 kg — see §7.)
- Peterson 2011, 49 studies / 1 328 adults ≥50 y (mean 65.5 y), 20.5 ± 9.1 wk, 2.8 d/wk, ~75 %1RM: LBM
  +1.1 kg (0.9–1.2) [24]. Model (V = 8, P = 1.1, 50:50 sex): ≈ +1.15 kg.

Resulting rates (H = 1, e = 0). "Typical" = V 12, P 1.4 g/kg; "Optimal" = V 20, P ≥ 1.6, e = +0.10:

| Sex / height | Age | TS | `G_pot` kg | Typical kg/mo | Optimal kg/mo | Optimal % BW/mo |
|---|---|---|---|---|---|---|
| M 1.78 m (75 kg) | 25 | 0 | 19.0 | 0.75 | 1.39 | 1.85 |
| | | 0.25 | | 0.56 | 1.01 | 1.34 |
| | | 0.50 | | 0.37 | 0.65 | 0.87 |
| | | 0.75 | | 0.19 | 0.31 | 0.42 |
| | | 0.90 | | 0.07 | 0.12 | 0.16 |
| M 1.78 m | 60 | 0 / 0.5 / 0.75 | | 0.62 / 0.31 / 0.16 | 1.15 / 0.54 / 0.26 | 1.53 / 0.72 / 0.35 |
| F 1.65 m (60 kg) | 25 | 0 / 0.25 / 0.5 / 0.75 | 11.7 | 0.46 / 0.35 / 0.23 / 0.12 | 0.86 / 0.62 / 0.40 / 0.19 | 1.43 / 1.03 / 0.67 / 0.32 |
| F 1.65 m | 60 | 0 / 0.5 | | 0.38 / 0.19 | 0.71 / 0.33 | 1.18 / 0.55 |

Simulated whole years at "optimal" (male 1.78 m): year 1 ≈ +10.8–11.2 kg, year 2 ≈ +4.5, year 3 ≈ +1.9,
year 4 ≈ +0.8 kg (lean, incl. water/glycogen associated with muscle).

**Comparison with popular heuristics (HEURISTICS — expert opinion, not data; grade D):**

| Model | Novice | Intermediate | Advanced | Ceiling |
|---|---|---|---|---|
| McDonald (men) [32] | yr 1: 20–25 lb (9–11 kg), 1.5–2 lb/mo | yr 2: 10–12 lb (4.5–5.5 kg), 1 lb/mo | yr 3: 5–6 lb; yr 4: 2–3 lb | ~40–50 lb (18–23 kg) career; women ≈ half |
| Aragon / Helms [32] | 1–1.5 % BW/mo | 0.5–1 % BW/mo | 0.25–0.5 % BW/mo | — ; women ≈ half |
| Casey Butt frame model [33] | — | — | — | `LBM_max(lb) = H^1.5·(√W/22.6670 + √A/17.0104)·(%bf/224 + 1)`; H height (in), W wrist, A ankle circumference (in). Derived from ~300 drug-free title winners 1947–2010 (author's claim). 1.75 m, 7.0″ wrist, 8.7″ ankle, 10 % bf → 173.7 lb (78.8 kg) LBM ⇒ FFMI ≈ 25.6 |
| This model | 1.85 % BW/mo optimal at TS 0 | 0.87 % at TS 0.5 | 0.42 % at TS 0.75 | asymptote `G_pot`; 4 yr ≈ 18 kg |

The model's *typical* rates are ~50–55 % of the *optimal* column, reconciling average RCT gains [21, 22]
with heuristic "best case" numbers. Women: heuristics say ≈ half the absolute gain; RCTs show similar
*relative* hypertrophy (ES 0.07, n.s.) [23] and a small male advantage in CSA (+2.5 %-points; n = 585) [25];
our `ΔFFMI_pot` 4.3 gives relative rates ≈ 0.87× men (grade C).

**Ceiling (FFMI) evidence.** Kouri 1995 (157 male athletes; FFMI normalised to 1.8 m by
`+ 6.3·(1.80 − h)`): non-users extended to a "well-defined limit" of 25.0; 20 pre-steroid Mr America winners
mean 25.4; many users > 25, some > 30 [28]. Critiques/counter-data: 26.4 % of 235 NCAA football players
exceeded 25 (mean 23.7 ± 2.1; 97.5th pct 28.1; max 31.7; DXA) [29]; NCAA throwers mean 25.7 (men 21.5 ± 1.9,
women 17.9 ± 1.8 overall; ADP) [30]; female athletes 16.9 ± 1.7 (range 13.3–25.5) [31]. FFMI rises with
fat mass (Forbes [61]) and differs by method, so 25 is a *soft, lean-state* ceiling, not a hard cutoff
(**grade C**). Untrained-to-ceiling span of ~6 FFMI units (men) matches 19 → 25.

**Initialisation from history (PROPOSED):**
```
TS₀ = max( 1 − exp(−0.47·Y_eff) ,  clamp((FFMI_user − FFMI_untrained_ref(sex, bf))/ΔFFMI_pot, 0, 0.95) )
   Y_eff = years of consistent training (user); 0.47 yr⁻¹ = k_g at typical conditions × f_P(1.4)
   → 1 y: 0.37 ; 2 y: 0.61 ; 4 y: 0.85 ; 10 y: 0.99
M_acc,r(0) = TS₀·G_pot,r ; if FFMI_user > FFMI_untrained_ref + ΔFFMI_pot, raise ΔFFMI_pot to
   (FFMI_user − FFMI_untrained_ref)/0.95 (the user is above-average responder).
FFMI_untrained_ref(sex, bf): from dossier 14 (population FFMI by sex & fatness).
```

**Evidence grade:** novice/trained absolute rates **B** (meta-analyses, but DXA "FFM" includes water/glycogen;
heterogeneous programmes); first-order ceiling kinetics **C** (fits the year-on-year heuristic decay and the
trained < untrained contrast [21, 8]); ceiling magnitude **D/C**.

---

### 4.7 Sex, age and menstrual-cycle moderators

| Moderator | Evidence | Engine |
|---|---|---|
| Sex (relative hypertrophy) | 10 studies: ES 0.07 ± 0.06, p = 0.31 (similar); upper-body relative strength favours women (ES −0.60) [23]; 585 subjects, 12 wk elbow flexor: CSA change −2 to +59 %, men +2.5 %-points more CSA, women larger relative strength gains [25] | No sex multiplier on relative rate; sex enters via `G_pot` (ΔFFMI_pot) and via smaller FFM. Relative strength gain ×1.1 for women upper body (PROPOSED from [23]) |
| Age | Older adults LBM +1.1 kg / 20.5 wk; age β = −0.03 (older gain less) [24]; 16 wk 3×/wk: type II fibre hypertrophy older +23 % vs young +32 %; type I only young (+18 %) [27]; pooled 287 untrained 19–78 y: size +4.8 ± 6.1 %, no age/sex effect on *relative* response [26]; protein efficacy declines with age (−0.01 kg/yr) [22] | `f_age = 1` for age ≤ 40; `1 − 0.0086·(age − 40)` for age > 40, floor 0.6 (→ 0.74 at 70) PROPOSED from [27] ratio 0.72 and [24] |
| Older adults dose | Morphology best with 2–3 sets/exercise, 3×/wk, 7–9 reps, 51–69 %1RM; RT morphology SMD 0.42 (9 studies) vs strength 1.57 [99] | Same `f_V`; higher maintenance dose (§4.10) |
| Menstrual phase | Umbrella review: "premature to conclude" phase influences strength or hypertrophy adaptations [96]; narrative review argues follicular-phase-based RT may be superior (few small trials) [97] | `f_cycle = 1.0` (no effect) |
| Oral contraceptives | 8 studies, 325 women: hypertrophy 0.01 (−0.11, 0.13), strength 0.10 (−0.08, 0.28) [98] | `f_OC = 1.0` |

**Evidence grade:** sex **A/B**; age **B** (direction), **C** (functional form); menstrual/OC **B** (null).

---

### 4.8 Energy balance, protein and body fat — multipliers and lean retention in a deficit

**Mechanism.** An energy deficit lowers basal MPS (−27 % after 5 d at 30 kcal·kg FFM⁻¹) but a bout of RT
restores MPS to energy-balance levels, and protein after RT raises it further (+16 % / +34 % with 15 / 30 g)
[64]. Chronic RT gains in lean mass are impaired by deficits while strength gains are preserved [42].
Separately, RT reduces the fraction of weight lost as fat-free mass [56–59].

**Key data.**

| Study | Design | Result |
|---|---|---|
| Murphy & Koehler 2022 [42] | Meta-analysis/regression, RCTs ≥3 wk RT ± energy deficit (52 matched studies in analysis B) | LM gains impaired: ES −0.57 (p = 0.02); strength not (ES −0.31, p = 0.28). RT+ED ES −0.11 vs RT+CON +0.20. **~500 kcal/d** deficit ⇒ ES 0 (no gain) (abstract). Slope **0.031 ES per 100 kcal/d** (from a secondary summary of the full text; full text not accessed) |
| Longland 2016 [43] | Young men (40 total; baseline adiposity not verified), 4 wk, −40 % energy, RT + HIIT 6 d/wk, protein 2.4 vs 1.2 g/kg, 4-compartment | LBM **+1.2 ± 1.0 vs +0.1 ± 1.0 kg**; FM −4.8 ± 1.6 vs −3.5 ± 1.4 kg |
| Garthe 2011 [52] | Elite athletes, 4 RT/wk, −0.7 %/wk (−19 % EI, 8.5 wk) vs −1.4 %/wk (−30 % EI, 5.3 wk) | LBM **+2.1 ± 0.4 % vs −0.2 ± 0.7 %**; both −5.5 % BW |
| Josse 2011 [63] | Overweight women, 16 wk diet + daily exercise, protein 30 % vs 15 % energy | High-protein/dairy group *gained* lean; low-dairy lost lean |
| Helms 2023 [46] | 17 trained lifters, 8 wk, maintenance vs +5 % vs +15 % intended surplus | BM +0.4 / +3.3 / +3.3 kg; no group effect on MT or squat; larger BM gain → larger skinfold gain (R² 0.49); weak BM–biceps MT link (R² 0.24) |
| Garthe 2013 [48] | 39 elite athletes, 8–12 wk, counselled surplus (3 585 vs 2 964 kcal) | BW +3.9 vs +1.5 %; FM +15 vs +3 %; LBM gain not different |
| Rozenek 2002 [49] | 73 untrained men, 8 wk RT, +2 010 kcal/d supplement | BM +3.1 kg; FFM +2.9–3.4 kg vs control |
| Smith 2021 [50] | 21 trained men, 6 wk RT + overfeeding (target ≥0.45 kg/wk) | 4C FFM +4.8 ± 2.6 %; ~0.55 %BW/wk gain ⇒ all gain as FFM on average (wide scatter) |
| Ribeiro 2019 [47] | 11 bodybuilders, 4 wk, 67.5 vs 50.1 kcal/kg | muscle +2.7 vs +1.1 %; fat +7.4 vs +0.8 % |
| Iraki 2019 [51] | Review, natural bodybuilders off-season | surplus ~10–20 %, gain 0.25–0.5 % BW/wk (novice/intermediate), smaller for advanced |

**Energy multiplier on training accretion (PROPOSED FIT).** `e = (EI − TDEE)/TDEE` from 01/02; `P` = protein
g·kg⁻¹·d⁻¹ from 03.
```
Deficit (e < 0):   f_E = max(0, 1 + e/d0)            d0 = 0.30   (range 0.20–0.45)
                   f_EP = f_E + (1 − f_E)·ρ(P)
                   ρ(P) = ρ_max · clamp((P − 1.2)/(2.2 − 1.2), 0, 1)     ρ_max = 0.8 (range 0.5–1.0)
Surplus (e ≥ 0):   f_EP = 1 + b_s·(1 − TS_r)·min(e, e_sat)/e_sat     b_s = 0.15, e_sat = 0.10
Protein (all e):   f_P(P) = 0.44 + 0.56·clamp((P − 0.8)/(1.6 − 0.8), 0, 1)
                   → 0.8 g/kg: 0.44 ; 1.2: 0.72 ; 1.4: 0.86 ; ≥1.6: 1.00
```
- `f_P` data: breakpoint 1.62 g/kg (95 % CI 1.03–2.20) for RT-induced FFM gains; supplementation (+~0.3
  g/kg/d, from ~1.3–1.4 to ~1.8) raised FFM gain from 1.1 to 1.4 kg (+27 %) [22]. Dossier 03 owns protein and
  may replace `f_P` with its own function; keep the plateau at ~1.6 g/kg.
- `d0`, `ρ_max`: chosen so that (i) Murphy's zero-crossing at ~500 kcal/d (≈ −0.20 of a ~2 500 kcal TDEE)
  is reproduced *after* adding the retention term below (simulated net ΔLM +0.2 kg over 12 wk at 500 kcal/d,
  −0.4 kg at 750, −0.6 kg at 1 000); (ii) Longland high-protein > low-protein; (iii) Garthe slow > fast loss.
  Both (ii) and (iii) are still *under*-predicted (§7) — the protein rescue may be stronger than `ρ_max = 0.8`
  (grade C). Protein ~1.2–1.4 g/kg (typical of Murphy's studies) gives ρ ≤ 0.16, so the rescue term barely
  changes the Murphy calibration.
- Surplus bonus `b_s`: small and training-status dependent — novices gain well even at maintenance [21],
  trained lifters show no MT benefit of +5–15 % surpluses over 8 wk [46, 48]; extra energy beyond ~+10 % goes
  mainly to fat (hand-off to 11) [46, 48, 51]. Grade C.

**Lean retention in a deficit (RT effect on the energy-driven FFM loss).** Dossier 01 computes the
non-training partition of weight change (Forbes/Hall: fat-free fraction falls as body fat rises [61, 62];
"quarter-FFM rule" critique [60]). RT scales down the *loss* term:
```
ΔFFM_total/day = ΔFFM_nonRT · (1 − R_RT)   [only when ΔFFM_nonRT < 0]
               + Σ_r A_r − Σ_r D_r           (A_r accretion §4.9, D_r detraining §4.10)
R_RT  = R_max · clamp(V_wb / V_R(age), 0, 1)
R_max = 0.75   (range 0.5–0.95)
V_wb  = muscle-mass-weighted mean of V_r across regions
V_R   = 6 eff. sets/wk (age ≤ 50) rising linearly to 10 (age ≥ 70)      PROPOSED
```
Data for `R_max`:

| Source | Comparison | FFM share of weight lost / lean change |
|---|---|---|
| Ballor & Poehlman 1994 [58] | diet only vs diet + exercise (≈ −10 kg) | men 28 ± 4 % vs 13 ± 6 %; women 24 ± 2 % vs 11 ± 3 % ⇒ R ≈ 0.54 |
| Weinheimer 2010 [57] | 52 studies, ≥50 y, mostly aerobic | ≥15 % of loss as FFM in 81 % of diet-only vs 39 % of diet+exercise groups |
| Sardeli 2018 [56] | 6 RCTs, obese elderly, RT 3×/wk 12–24 wk | RT prevented **93.5 %** of CR-induced LBM loss (0.82 kg, 0.36–1.27) ⇒ R ≈ 0.9 |
| Villareal 2017 [59] | 160 obese older adults, 6 mo, −9 % BW | lean −2 % (58.1→57.1 kg) with RT vs −5 % (55.0→52.3) with aerobic |
| Weiss 2007 [55] | 50–60 y, 12 mo, CR vs exercise-induced (aerobic) weight loss | lean −3.5 % vs −2.2 % (n.s.); thigh muscle −6.9 % and knee strength −7.2 % in CR only |
| Clark 2015 [54] | 66 studies overfat adults | diet + RT best for FFM retention (ES 0.40) vs endurance or combined |
| Cava 2017 [53] | review | diet-only loss reduces muscle mass; RT preserves mass and improves strength |

**Body fat as moderator.** Enters through 01's partition (leaner people lose a larger FFM fraction [61, 62]);
recomposition (simultaneous fat loss and muscle gain) emerges naturally when `A_r` exceeds
`|ΔFFM_nonRT|·(1 − R_RT)` — most likely in novices, detrained, higher-fat and high-protein conditions
[43, 44, 52, 63]; a narrative review concludes it is also achievable in trained lifters with adequate protein
and progressive RT, but more slowly [44].

**Evidence grade:** deficit impairs lean gain / spares strength **A** (meta-analysis + RCTs); linear
dose-response in kcal **B**; protein rescue in deficit **B** (two RCTs, one meta-regression [22] excluded
deficits); `R_max` **B**; surplus effects **C**.

---

### 4.9 Core daily update (accretion, training status progression)

For each region r, each day:
```
A_r = k_g · G_pot,r · (1 − TS_r)                   # §4.6
      · f_V(V_r) · f_F(F_r)                         # §4.2–4.3
      · f_P(P) · f_EP(e, P, TS_r)                   # §4.8
      · f_age(age) · H_r · κ_mem,r                  # §4.7, §4.5, §4.10
      · ρ_reg,r · f_sleep · f_alcohol · f_illness    # §4.15; 16/15 hand-offs (default 1)
dM_acc,r/dt = A_r − D_r                             # D_r from §4.10
M_peak,r = max(M_peak,r, M_acc,r)
TS_r = M_acc,r / G_pot,r   (clamp 0 … 0.98)
```
`A_r` is in kg lean per day (FFM-equivalent, including the intracellular water/glycogen of new muscle;
skeletal-muscle-only change ≈ 0.7 × FFM change — Benito: FFM +1.56, SMM +1.11 kg, different study sets
[21]; grade C). Hand the whole-body sum `Σ A_r` to 01/03 as the RT accretion term; its energy cost is booked
by 01/11.

Reference simulation (PROPOSED FIT outputs, male 1.78 m, 25 y): 10.4 wk at V 12, P 1.4, e 0, untrained →
+1.49 kg; same, TS₀ 0.45 → +0.99 kg.

**Evidence grade:** C for the integrated model (components A–C); validated against §7.

---

### 4.10 Detraining, maintenance dose and muscle memory

**Data.**
- 3-wk breaks: no significant loss of CSA or 1RM; after retraining, 15- or 24-wk outcomes equal continuous
  training [65, 66]. Trained men, 2 wk off: strength and lean mass retained [75].
- 10 wk unilateral training (CSA +17 %, MT +10 %, strength +20 %) → 20 wk detraining: MT and CSA back to
  baseline; strength "remained elevated (~60 %)"; retraining response not different from the naive leg [67].
- 60 d training (+8.5 % CSA) then 40 d detraining: detraining time-course similar to training [76].
- Older adults (6 studies): RT d = +0.99; detraining 12–24 wk d = −0.60 (n.s.), 31–52 wk d = −1.11 [73].
  Older men, 12 wk detraining: strength/power −5 to −15 %; type II fCSA −17 % (trend); <8 wk retraining to
  regain 1RM [74]. Strength losses larger in older and inactive people; dose-response with duration [72].
- Maintenance: 1/3 and 1/9 of the training dose maintained myofibre hypertrophy for 32 wk in young, not old [4].
- Muscle memory: myonuclei gained with training retained after 16 wk detraining (+33 % vs control in type 2
  fibres) but no clear advantage on retraining [68]; meta-analysis finds myonuclei *not* permanent in humans
  with atrophy [69]; epigenetic memory (hypomethylation retained after unloading; larger gains on reloading)
  [70]; review [71]; periodic training cycles show faster regain during retraining [65].

**Equations (PROPOSED FIT).**
```
V_maint(age) = 3 eff. sets/wk for age ≤ 50 ; linear to 9 at age 70 ; 10 above 75        [4] PROPOSED
T_low,r      = consecutive days with V_r < V_maint(age)   (reset to 0 when V_r ≥ V_maint)
λ(T)         = clamp((T − 14)/14, 0, 1)                    # no loss for ~2 wk, full rate after 4 wk [65, 66, 75]
D_r          = λ(T_low,r) · (1 − min(1, V_r/V_maint)) · M_acc,r / τ_d
τ_d          = 70 d (young; range 42–140) ; same default for older (data conflicting [72–74])
κ_mem,r      = 1 + 0.3 · [M_acc,r < 0.95·M_peak,r]           (regain boost; set 1.0 for conservative runs)
```
Behaviour: after 20 wk without training, remaining training-attributable lean = exp(−(140 − ~21)/70) ≈ 18 %
(target [67]: back to baseline); after 3 wk ≈ 99 % (target [65, 66]). Regain is fast because `TS_r` falls with
`M_acc,r` (gap term) plus `κ_mem`.

Age-related loss of untrained muscle (sarcopenia) is owned by dossier 16 and is applied to the
untrained set-point, not to `M_acc`.

**Evidence grade:** 3-wk no-loss **B**; exponential loss time-constant **C**; memory boost **C**
(conflicting human data [67–70]).

---

### 4.11 Recovery, fatigue, deloads, overreaching

- Training to failure slows recovery of velocity/CMJ and CK by 24–48 h vs stopping at half the possible reps,
  even at matched volume [78]; 1–2 RIR gives similar hypertrophy with less acute fatigue [11].
- A 1-wk deload mid-way through 9 wk of high-volume training did not change hypertrophy but slightly reduced
  strength gains [77].
- Very high per-session volume: Benito's meta-regression found a small negative moderator of sets per workout
  (−0.03 kg per additional set/workout) [21]; Pelland's upper tier (≥43 sets/wk) is "unclear" [3].

**Engine (performance only; hypertrophy uses §4.9).** Banister-style fatigue for the strength output:
```
Fat_r(t+1) = Fat_r(t)·exp(−1/τ_fat) + c_fat · e_sets_r,today · (1 + 0.5·[any set to failure])
c_fat = 0.02 per effective set ; τ_fat = 2 d (1.5 d if no failure sets)
performance multiplier for region r = 1 − min(0.3, Fat_r) ; Fat_acute (whole body) = mass-weighted mean
                                                                                   PROPOSED, grade D
```
Planner rules (PROPOSED, grade C/D): ≤ 10–12 effective sets per region per session for novices; weekly volume
increases ≤ ~20 %/wk; schedule 48 h between failure sessions for the same region; deloads optional
(no hypertrophy cost [77]).

---

### 4.12 Carbohydrate / glycogen / ketogenic diets and concurrent cardio

- Systematic review (49 studies): higher carbohydrate did not improve strength performance in 13 of 19 acute
  studies; benefits mainly vs fasted controls and in sessions **> 10 sets per muscle group**; no long-term
  effect in 15 of 17 training studies [81].
- Ketogenic diets + RT (13 RCTs, 244 people): BM −3.67 kg, FM −2.21 kg, **FFM −1.26 kg (−1.82 to −0.70)** vs
  non-KD [82] — FFM difference plausibly includes glycogen-bound water (dossier 04) and lower energy intake.
  Trained men, 8 wk "surplus": KD lean +(−0.1) kg vs non-KD +1.3 kg [79]; natural bodybuilders 2 mo: lean
  mass rose only on the western diet, strength rose similarly [80].
- Glycogen use by RT: 6 sets leg extension degraded 47 mmol·kg⁻¹ wet wt regardless of load when work is
  matched [83] (≈ 7.6 g glucose-equivalent·kg⁻¹ muscle, i.e. **≈1.3 g·kg⁻¹ trained muscle per set**,
  PROPOSED hand-off to 04); a ~45-min session lowered fibre glycogen 23 % (type I) to 44 % (type IIx) [84].
- Concurrent aerobic + strength training (43 studies): hypertrophy SMD −0.01 (−0.16, 0.18), maximal strength
  −0.06, explosive strength −0.28 (worse when same session) [103].

Engine: no direct low-carb multiplier on true hypertrophy (`f_CHO = 1.0`, grade C); low carbohydrate acts
through (a) `f_fastHV` on high-volume sessions, (b) energy intake (`f_EP`), (c) 04's glycogen-water term in
reported lean mass. Concurrent cardio: `f_conc = 1.0` on hypertrophy (grade A); explosive-strength penalty is
dossier 19's. Meal timing: protein timing has no effect once total protein is controlled [104] ⇒ no
timing multiplier; timing only shifts the 03 meal × `S_mps` interaction.

---

### 4.13 Energy cost of a resistance-training session (coordinate with 02 and 10)

2024 Compendium of Physical Activities (METs include rest periods) [85]:

| Code | Description | MET |
|---|---|---|
| 02054 | Resistance (weight) training, multiple exercises, 8–15 reps at varied resistance | 3.5 |
| 02052 | Resistance training, squats, deadlift, slow or explosive effort | 5.0 |
| 02050 | Resistance (weight lifting, free weight, machines), power lifting or body building, vigorous | 6.0 |
| 02055 | Resistance training, circuit, reciprocal supersets | 5.8 |
| 02056 / 02057 | Body-weight resistance exercises, general / high intensity | 3.0 / 6.5 |

```
EE_session,net (kcal) = (MET − 1) · BM(kg) · duration(h)
   e.g. 80 kg, 60 min, MET 3.5 → 200 kcal net ; MET 6.0 → 400 kcal net
Default duration if only sets given: 2.5 min per set incl. rest (PROPOSED, grade D)
Post-exercise REE elevation: ΔREE = 0.05 · REE · (1 − 0.5·H_wb) while a session occurred in the last 72 h
   (not additive across sessions)                                              PROPOSED from [86, 87]
```
Data: isolated exercises cost ~3–10 kcal·min⁻¹ at low intensity and > 20 kcal·min⁻¹ at 80 %1RM leg work
[88]; reported range 3–30 (up to 40) kcal·min⁻¹ during exercise itself [89]. One-set (≈15 min) or three-set
(≈35 min) whole-body session raised REE ~5 % (~400 kJ ≈ 96 kcal·d⁻¹) at 24, 48 and 72 h in overweight young
adults [87]; EPOC measurable to 38 h after a heavy 31-min circuit [86]. **Evidence grade:** MET values
**A/B** (compendium); post-exercise REE **C** (small studies, novices).

---

### 4.14 Strength as an output

**Data.** Changes in agonist neural drive (30.6 %), quadriceps volume (18.7 %) and baseline strength
(10.6 %) explain ~60 % of variance in individual strength gains [91]; 9 wk: MVC +26 ± 11 %, PCSA +6 ± 4 %,
specific tension +17 ± 11 % [92]; contested view that hypertrophy contributes little [90]. Strength gains
are load-specific (high/moderate > low load, SMD 0.60–0.63 and 0.34–0.35) [8]; saturate at low volume [3,
100]; increase with frequency [3]; are preserved in a deficit [42]; neural component largely retained during
detraining [4, 67, 74]; untrained pooled 21.1 ± 11.5 % over typical programmes [26].

```
Strength index (per movement/region, relative to baseline):
Str_r / Str_r0 = (1 + N) · (M_r / M_r0)^α · (1 − Fat_acute)          α = 1.0 (UNVERIFIED; force ∝ CSA)
dN/dt  = (N_max · h_S(V_S) · f_loadS · f_FS(F) − N) / τ_N,up         if trained this week
dN/dt  = −N / τ_N,off                                                otherwise
N_max  = 0.05 + 0.20·(1 − TS)          (novice 0.25; advanced ~0.10)            PROPOSED
h_S(V) = (exp(0.14635·V/(V+1)) − 1) / (exp(0.14635·12/13) − 1)                   [3]
f_loadS = 1.0 (≥ 80 %1RM), 0.85 (60–80 %), 0.65 (< 60 %)                         PROPOSED from [8]
τ_N,up = 21 d ; τ_N,off = 280 d                                                 PROPOSED from [36, 67, 93]
```
Check: novice, 12 wk, V 12, heavy loads: N ≈ 0.245, muscle +5 % → strength +31 % (data 19–27 % 1RM at
12 wk [93]; MVC +26 % at 9 wk [92]). Hand-off: dossier 19 owns performance outputs; this supplies `N`,
`M_r` and fatigue. **Evidence grade B** (direction, retention), **C** (parameters).

---

### 4.15 Regional hypertrophy → body shape (avatar; coordinate with 14)

- Upper-body muscle thickness rose more and earlier than lower-body in novices: 12 wk, men +12–21 % upper vs
  +7–9 % lower; women +10–31 % vs +7–8 %; chest/triceps significant by week 6 [93].
- Hypertrophy is non-uniform along a muscle and follows region-specific activation [94]; quadriceps growth
  greatest distally at 2/10 femur length (+12 %) vs +3.5 % proximally [76].
- Men have 40 % more upper-body and 33 % more lower-body skeletal muscle than women; ageing losses are
  mainly lower-body after the 5th decade [95].

**Engine (PROPOSED; grade D weights — dossier 14 to replace with its reference distribution):**

| Region r | Default share `w_r` of trainable muscle | Responsiveness `ρ_reg,r` (novice) | Avatar parameter |
|---|---|---|---|
| Chest | 0.08 | 1.3 | chest depth/width |
| Upper back (lats, traps, rhomboids) + erectors | 0.17 | 1.2 | back width (V-taper) |
| Shoulders (deltoids) | 0.07 | 1.3 | shoulder width |
| Arms (biceps, triceps, forearms) | 0.10 | 1.3 | arm girth |
| Core / abdominals | 0.06 | 1.0 | waist (minor) |
| Glutes | 0.12 | 1.0 | hip/glute projection |
| Quadriceps | 0.20 | 1.0 | thigh girth |
| Hamstrings + adductors | 0.14 | 1.0 | thigh girth |
| Calves | 0.06 | 0.8 (UNVERIFIED) | calf girth |

```
ρ_reg,r(TS_r) = 1 + (ρ_reg,r,novice − 1)·(1 − TS_r)        (upper-body advantage fades with training)
Girth mapping: ΔC/C ≈ 0.5 · φ_m · ΔM_r/M_r   (φ_m = muscle fraction of limb cross-section from 14;
   circumference ∝ √area; add W_r for early swelling)
```
**Evidence grade:** upper > lower early response **B** [93]; weights and girth mapping **D**.

---

### 4.16 Inter-individual variability (for uncertainty bands)

- 585 adults, 12 wk: CSA −2 to +59 %, 1RM 0 to +250 %; CV of CSA change 0.48 (men) / 0.51 (women) [25].
- 287 untrained 19–78 y: size +4.8 ± 6.1 % (range −11 to +30 %), strength +21.1 ± 11.5 %; 29 % "low
  responders" for size vs controls [26].
- 66 adults, 16 wk: extreme / modest / non-responders +2 475 / +1 111 / −16 µm² myofibre growth (17/32/17 people)
  [106].

Engine: individual multiplier `u ~ LogNormal(0, σ = 0.45)` on `A_r` (PROPOSED from CV ≈ 0.5), applied
per simulated person; the UI band should show 10th–90th percentile (×0.56 to ×1.78). Grade B.

---

### 4.17 Pseudo-code (daily step, TypeScript-like)

```ts
function stepRT(s: RTState, d: DayInputs, ctx: Ctx): RTDayOut {
  // ctx: sex, age, heightM, bmKg, e (rel. energy balance), proteinGkg, deltaFFMnonRT (from 01), REE
  const out = {} as RTDayOut; let accSum = 0, detSum = 0;
  for (const r of REGIONS) {
    const sets = d.sets[r];                                  // effective sets today (§4.1)
    s.hist[r].push(sets); if (s.hist[r].length > 7) s.hist[r].shift();
    const V = sum(s.hist[r]); const F = s.hist[r].filter(x => x > 0).length;
    // habituation & swelling (§4.5)
    s.H[r] += F > 0 ? (1 - s.H[r]) / 14 : -s.H[r] / 60;
    s.W[r] += (0.05 * (1 - s.H[r]) * Math.min(1, V / 10) - s.W[r]) / 7;
    // accretion (§4.9)
    const Gp = W_REGION[r] * dFFMIpot(ctx.sex) * ctx.heightM ** 2;
    const TS = clamp(s.Macc[r] / Gp, 0, 0.98);
    const fEP = ctx.e < 0
      ? (() => { const fE = Math.max(0, 1 + ctx.e / 0.30);
                 return fE + (1 - fE) * 0.8 * clamp((ctx.proteinGkg - 1.2) / 1.0, 0, 1); })()
      : 1 + 0.15 * (1 - TS) * Math.min(ctx.e, 0.10) / 0.10;
    const kMem = s.Macc[r] < 0.95 * s.Mpeak[r] ? 1.3 : 1.0;
    const rho = 1 + (RHO_NOVICE[r] - 1) * (1 - TS);
    const A = (0.55 / 365) * Gp * (1 - TS) * fV(V) * fF(F) * fP(ctx.proteinGkg) * fEP
              * fAge(ctx.age) * s.H[r] * kMem * rho * ctx.uIndividual;
    // detraining (§4.10)
    const Vm = vMaint(ctx.age);
    s.Tlow[r] = V < Vm ? s.Tlow[r] + 1 : 0;
    const lam = clamp((s.Tlow[r] - 14) / 14, 0, 1);
    const D = lam * (1 - Math.min(1, V / Vm)) * s.Macc[r] / 70;
    s.Macc[r] += A - D; s.Mpeak[r] = Math.max(s.Mpeak[r], s.Macc[r]);
    accSum += A; detSum += D; out.V[r] = V;
  }
  const Vwb = massWeightedMean(out.V);
  const R = 0.75 * clamp(Vwb / vR(ctx.age), 0, 1);
  out.dFFM = (ctx.deltaFFMnonRT < 0 ? ctx.deltaFFMnonRT * (1 - R) : ctx.deltaFFMnonRT) + accSum - detSum;
  out.rtAccretionKg = accSum;   // → 01/03/11 (energy cost booked there)
  return out;
}
```
(MPS kernel `S_mps` and strength `N` are evaluated in the same loop; omitted for brevity — equations §4.4,
§4.14.)

---

## 5. Interactions with other subsystems

| Other dossier | This module NEEDS | This module GIVES |
|---|---|---|
| 01 body-weight models | `ΔFFM_nonRT` (energy-driven partition, Forbes/Hall [61, 62]), FM, TDEE-relative balance `e` | `Σ A_r` (kg/d RT lean accretion), `R_RT` (retention fraction), `D_r` (detraining loss). Energy cost of new tissue is booked by 01/11, not here |
| 02 energy expenditure | REE | session net kcal (§4.13) and post-RT ΔREE (≈5 % × REE for ≤72 h; do not double count with 02's FFM-driven RMR) |
| 03 protein / MPS | protein g/kg/d (and per-meal pattern if 03 wants to override `f_P`) | `S_mps,r(t)` kernel (§4.4) = sensitisation window for meal protein (untrained ~30 h, trained ~10 h decay); `f_P` default; `ρ(P)` deficit rescue. 03 must NOT add a second training effect on net protein balance — use `A_r` as the training-driven accretion and 03's terms for non-training balance |
| 04 carbohydrate / glycogen | glycogen state, fasted flag | glycogen use ≈ 1.3 g·kg⁻¹ trained muscle per effective set [83, 84]; FFM readout should add 04's glycogen-water to `M_acc` for "scale/DXA lean" |
| 05 ketosis | — | none directly (low-carb acts via energy intake and 04) [79, 80, 82] |
| 07 meal timing / fasting | eating-window schedule | no hypertrophy timing multiplier (protein timing null after total protein [104]); fasted high-volume sessions `f_fastHV` |
| 08 autophagy / mTOR | — | RT days = mTOR activation periods (qualitative; conflicts with "maximise autophagy" goals — planner) |
| 10 cardio | concurrent-training schedule | hypertrophy interference = none (SMD −0.01 [103]); explosive-strength penalty belongs to 19; RT METs (§4.13) to share one exercise-energy ledger |
| 11 surplus partitioning | surplus size | `A_r` is the lean part of a surplus *with* training; 11 should partition only the remainder (fat + obligatory non-muscle lean) to avoid double counting; RT raises lean fraction of weight gain mainly in novices [46, 48–50] |
| 12 hormones | — | none required (post-exercise systemic hormones do not predict hypertrophy [102]) |
| 13 transitions | diet-break / refeed schedule | detraining clock unaffected by diet; `H` decays during training breaks |
| 14 anthropometrics | FFMI reference (untrained, by sex & fatness), regional muscle distribution, limb muscle fraction `φ_m` | regional `M_r`, `W_r` for avatar (§4.15); FFMI vs cap |
| 16 sleep / stress / age / sex | sleep multiplier (1 night deprivation → MPS −18 % [105]), sarcopenia on untrained set-point, menopause | age & sex effects defined here (§4.7) — 16 should not re-apply them to `A_r` |
| 17 safety | contraindications | warnings (§9) |
| 18 planner | objective weights | decision variables: `V_r`, `F_r`, RIR, load; constraints §9; conflicts: max autophagy/fasting vs hypertrophy; aggressive deficit vs lean gain |
| 19 performance | — | `N`, `Str_r`, fatigue for strength/power outputs |

---

## 6. Output metrics for the UI (chartable; selectable as planner goals)

| Metric | Unit | Good direction | Computation | Grade |
|---|---|---|---|---|
| Training-attributable lean mass | kg | ↑ | `Σ_r M_acc,r` | B/C |
| Rate of muscle gain | kg/mo; % BW/mo | ↑ (context) | 30·Σ `A_r` − `D_r` | B/C |
| Total fat-free mass (with 01/04) | kg | ↑ | 01's FFM incl. `M_acc` + glycogen water | B |
| Skeletal-muscle gain estimate | kg | ↑ | 0.7 × ΔFFM_RT (§4.9) | C |
| Regional muscle change | % vs start | ↑ | `M_r / M_r0 − 1` | C |
| Apparent muscle size (incl. swelling) | % | — | `(M_r/M_r0)(1+W_r) − 1` | C |
| Training status | % of potential | ↑ | `TS × 100`; label novice/intermediate/advanced | C/D |
| FFMI vs natural ceiling | kg/m² | — | (FFM / h²) + 6.3·(1.80 − h) [28]; ceiling = untrained ref + ΔFFMI_pot | C/D |
| Weekly effective sets per region | sets/wk | within 10–20 for hypertrophy | `V_r` | A |
| MPS elevation (exercise) | % above basal | — | `100·S_mps,wb(t)` | B |
| Strength index | % of baseline | ↑ | `Str_r/Str_r0` (§4.14) | B/C |
| Lean fraction of weight lost | % | ↓ | −ΔFFM / −ΔBW during deficit | B |
| Recomposition index | ratio | ↑ | ΔFFM / (−ΔFM) over window (only if both favourable) | C |
| Detraining countdown | days | — | days until `λ > 0` (14 − `T_low`) and projected loss | C |
| RT session energy | kcal | — | §4.13 | B |
| Muscle-memory reserve | kg | — | `M_peak − M_acc` (regainable at boosted rate) | C |

---

## 7. Validation targets

"Model" = prototype of §4 with the default parameters (our simulation, 2026-09-30). Tolerances are for the
average-person projection.

| # | Study | Conditions in | Published outcome | Model | Tolerance / status |
|---|---|---|---|---|---|
| 1 | Benito 2020 [21] | healthy men 18–40 y, RT not in deficit, mean 10.4 wk (FFM studies), mean 3.5 d/wk | FFM +1.56 kg overall; untrained +1.54 (1.12–1.96); trained +0.98 (0.17–1.79) | untrained +1.49; TS₀ 0.45: +0.99 | ±0.4 kg — pass |
| 2 | Morton 2018 [22] | 49 RCTs, RT 13 ± 8 wk, protein ~1.4 g/kg (control) vs +~0.3–0.4 g/kg supplement | RT alone FFM +1.1 ± 1.2 kg; supplement +0.30 kg (0.09–0.52); plateau 1.62 g/kg | young men: 1.60 vs 2.01 kg (+0.41) | ratio supplemented/control 1.27 ± 0.15 — pass; absolute higher than mixed-population mean (older, women, low-volume arms) |
| 3 | Peterson 2011 [24] | ≥50 y (mean 65.5), 20.5 ± 9.1 wk, 2.8 d/wk, ~75 %1RM | LBM +1.1 kg (0.9–1.2) | +1.16 kg (V 8, P 1.1, mixed sex) | ±0.4 kg — pass |
| 4 | Murphy & Koehler 2022 [42] | RT with vs without prolonged deficit | ΔES = −0.031 per 100 kcal/d; ES 0 at ~500 kcal/d | net ΔLM over 12 wk: 0 kcal +1.44; 250 +0.83; 500 +0.22; 750 −0.41; 1 000 −0.58 kg | zero-crossing 500–700 kcal/d — pass |
| 5 | Longland 2016 [43] | young men, 4 wk, −40 % energy, RT + HIIT 6 d/wk, 2.4 vs 1.2 g/kg | LBM +1.2 ± 1.0 vs +0.1 ± 1.0 kg | +0.2 to +0.6 vs −0.25 kg (FM₀ assumed 25 kg, UNVERIFIED) | direction pass; magnitude under-predicted by ~0.7–1.0 kg (within 1 SD) — **weakest target** |
| 6 | Garthe 2011 [52] | elite athletes, 4 RT/wk, −19 % vs −30 % energy, 8.5 vs 5.3 wk, both −5.5 % BW | LBM +2.1 ± 0.4 % vs −0.2 ± 0.7 % | +0.7 % vs −0.2 % | FR pass; SR under-predicted (−1.4 %-pts) |
| 7 | Villareal 2017 [59] | 160 obese older adults, 6 mo, −9 % BW, RT vs aerobic | lean −1.0 kg (−2 %) RT vs −2.7 kg (−5 %) aerobic | −0.5 to −0.6 vs −1.9 kg | ratio RT/aerobic 0.3 (obs 0.37) — pass on ratio; absolute ±0.8 kg |
| 8 | Ballor & Poehlman 1994 [58] | diet vs diet + exercise, ≈ −10 kg | FFM share 24–28 % vs 11–13 % | R_RT 0.75 → FFM share ×0.25–0.5 | pass (range) |
| 9 | Helms 2023 [46] | trained, 8 wk, maintenance vs +5 % vs +15 % | BM +0.4 / +3.3 / +3.3 kg; no MT/1RM-squat differences | FFM +0.81 / 0.83 / 0.86 kg (≤6 % difference) | pass (no meaningful surplus effect on muscle) |
| 10 | Schoenfeld 2019 [100] | trained men, 8 wk, 6 vs 30 (arms) and 9 vs 45 (legs) sets/wk | elbow ext. MT +1.1 vs +5.5 %; mid-thigh +3.4 vs +12.5 %; lat. thigh +5.0 vs +13.7 % | high/low ratio 2.7 (arms), 2.4 (legs) | obs ratios 5.0 / 3.7 / 2.7 — partial pass (model follows the meta-regression [3], which already includes this trial) |
| 11 | Damas 2016 [34] + Seynnes 2007 [36] | untrained young men, 10 wk (and 35 d flywheel) | CSA +2.7 % at wk 3 with oedema; +10.4 % at wk 10; QF CSA +3.5–5.2 % day 20 | swelling 1.6–2.2 % + small true growth at wk 3; oedema ≈ 0 by wk 8 | qualitative pass |
| 12 | Ogasawara 2013/2011 [65, 66]; Psilander 2019 [67] | 3-wk breaks between 6-wk blocks; 20-wk detraining | no loss at 3 wk; 24-wk CSA equal to continuous; MT returns to baseline after 20 wk | 3 wk: −1 %; 20 wk: 82 % of `M_acc` lost | pass |
| 13 | Bickel 2011 [4] | 16 wk RT then 32 wk at 1/3 or 1/9 dose | hypertrophy maintained (young), not (old) | young V ≥ V_maint ⇒ no loss; old need ≥ 9 sets/wk | pass by construction |
| 14 | McDonald / Aragon–Helms heuristics [32] (grade D targets) | optimal training, men | yr1 9–11 kg, yr2 4.5–5.5, yr3 2.3–2.7, yr4 0.9–1.4 | 10.8–11.2 / 4.5 / 1.9 / 0.8 kg | pass (years 3–4 slightly low) |

Additional acute target for dossier 03 coupling: Phillips 1997 [40] fasted untrained FSR +112 % (3 h), +65 %
(24 h), +34 % (48 h); Tang 2008 [41] trained leg back to rest by 28 h — kernel §4.4 within ±20 %-points.

---

## 8. Myths / contested claims

| Claim | Evidence |
|---|---|
| "You must eat in a surplus to build muscle." | Novices gain at maintenance (Benito, not in deficit, +1.5 kg/10 wk [21]); trained lifters showed no MT benefit of +5–15 % surpluses over 8 wk, only more fat [46, 48]. Small surpluses may help advanced lifters marginally [45, 51]. |
| "You cannot gain muscle in a calorie deficit." | Deficits impair gains on average and ~500 kcal/d abolishes them [42], but novices, overweight people and high-protein conditions can gain lean mass while losing fat [43, 44, 52, 63]. |
| "More volume is always better" / "there is a hard optimum of 10–20 sets." | Diminishing returns with no clear plateau to ~40 sets in pooled data [3]; individual trained trials disagree (30–45 sets > lower [100] vs 12 = 24 sets [101]); 12–20 sets is a reasonable default [2]. |
| "Every set must go to failure." | Failure vs non-failure: trivial ES 0.19 (any definition), 0.12 n.s. (momentary failure) [10]; 1–2 RIR = failure for quadriceps growth in trained people [11]; failure slows recovery [78]. Stopping very far from failure (≥5–10 RIR) does reduce hypertrophy [9]. |
| "Heavy weights for size, light weights for tone." | Hypertrophy similar from ~30 % to ~90 %1RM when sets are hard [7, 8, 102]; 20 %1RM is sub-optimal [20]. Heavy loads matter for 1RM strength [7, 8]. |
| "Train each muscle 2–3×/wk for growth." | Volume-equated frequency has little/no effect on hypertrophy [3, 6]; frequency helps strength [3]. |
| "Post-workout hormone spikes drive growth." | Acute systemic hormone rises unrelated to hypertrophy or strength in trained men [102]. |
| "The anabolic window is 30–60 min." | Protein timing effect vanishes after adjusting for total protein [104]; MPS stays elevated 24–48 h in untrained muscle [38–40]. |
| "Early size gains in beginners are muscle." | First ~3–4 wk include substantial oedema [34, 35]. |
| "Muscle memory = permanent myonuclei." | Myonuclei retained after 16 wk detraining in one study [68] but not permanent across human atrophy studies [69]; retraining advantage unclear in humans [67, 68]; epigenetic evidence [70]. |
| "FFMI 25 is a hard natural limit." | A soft ceiling for lean, drug-free physique athletes [28]; heavier athletes with more fat exceed it (26 % of college football players > 25, max 31.7) [29]. |
| "Women get bulky / respond differently." | Relative hypertrophy similar (ES 0.07) [23]; absolute gains smaller (lower FFM); relative strength gains similar or larger [23, 25]. Menstrual phase and oral contraceptives: no demonstrated effect on adaptations [96, 98]. |
| "Ketogenic diets destroy muscle." | FFM −1.26 kg vs non-KD with RT [82], but part is glycogen-bound water and lower energy intake; strength gains similar [80]. Lean *gain* may be blunted [79, 80] (grade C). |
| "Cardio kills gains." | No hypertrophy or maximal-strength interference on average; explosive strength slightly impaired [103]. |
| "Muscle turns into fat when you stop." | Distinct tissues; training-attributable muscle is retained ~2–3 wk [65, 66, 75] then decays toward baseline over months [67, 73], while fat changes with energy balance (§4.10). |

---

## 9. Safety bounds (hand to 17 and the planner)

- **Volume ceiling:** planner default ≤ 20–25 effective sets/region/wk; hard cap 40 (end of evidence [3]).
  Novices: ≤ 10–12 sets/region/session and ramp volume ≤ ~20 %/wk (PROPOSED, grade D) — very high unaccustomed
  eccentric volume can cause severe muscle damage (exertional rhabdomyolysis case literature; UNVERIFIED here,
  see 17). Simulator: warn if a novice week exceeds 2× the previous week's `V_r` or > 20 sets/region/session.
- **Rate of weight loss with lean-mass goals:** warn above ~1 % BW/wk; 0.5–1 %/wk recommended for physique
  athletes [108]; 0.7 %/wk preserved/gained LBM whereas 1.4 %/wk did not [52]. Warn when `e < −0.30`
  (lean gain abolished even with high protein in the model).
- **Surplus:** ≤ 10–20 % above maintenance / 0.25–0.5 % BW/wk (smaller for advanced) [51]; larger surpluses
  mainly add fat [46, 48].
- **Protein:** plan 1.6–2.2 g/kg/d with RT [22]; ≥2.2–2.4 g/kg in aggressive deficits [43] (03/17 own upper
  safety limits, e.g. renal disease).
- **Recovery:** ≥48 h before repeating failure training for the same region [78]; flag schedules with
  failure training on consecutive days for the same region.
- **Older adults:** need higher maintenance dose [4]; supervised progression; screen with 17 (hypertension,
  cardiovascular disease, osteoporosis).
- **Contest-prep extremes:** natural bodybuilders show large falls in testosterone (9.2 → 2.3 ng/mL), strength
  and mood during 6-month preparation to 4.5 % body fat [109]; similar biopsychosocial strain in [110] —
  simulator warns when projected body fat < ~6 % (men) / < ~15 % (women) (thresholds from 17).
- The planner must never prescribe RT volume the user has not been exposed to without a ramp.

---

## 10. Open questions / weakest assumptions

1. **Ceiling magnitude `ΔFFMI_pot`** (6.0 men / 4.3 women) rests on FFMI surveys and heuristics [28–33];
   individual genetics dominate (responder CV ≈ 0.5 [25, 26]). Grade D.
2. **First-order approach to the ceiling** with one rate constant `k_g` = 0.55/yr is a PROPOSED FIT to RCT
   means (10–20 wk) and multi-year heuristics; no multi-year RCT tracks natural lean gain to the ceiling.
3. **High-volume region (>25–30 sets/wk)**: the square-root dose-response is extrapolated with wide intervals
   [3]; recovery limits not modelled beyond a fatigue proxy.
4. **Protein rescue in a deficit (`ρ_max`)**: Longland/Garthe are under-predicted; the true interaction may be
   stronger or may reflect 4C/DXA water shifts [43, 52].
5. **"FFM" is not muscle**: DXA/4C lean includes water and glycogen; trial FFM gains (and KD losses) are partly
   fluid [21, 82]; skeletal-muscle fraction 0.7 is weakly supported.
6. **RIR is estimated, not measured**, in the meta-regression [9]; people under-estimate their RIR, so
   user-reported RIR is noisy.
7. **Detraining time-constant** (70 d) and **muscle-memory boost** (1.3×) rest on few small trials with
   conflicting results [65–70, 73, 74].
8. **Age function** is linear from 40 y; data are mostly 60–75 y vs 20–35 y [24, 26, 27].
9. **Women** are under-represented in most datasets (Pelland 20.9 % female [3]); ceiling and rates for women are
   the least certain.
10. **MPS kernel** from 4 small tracer studies; does not integrate to predict growth [35, 37] — used only for
    03 coupling and display.
11. **Regional weights and responsiveness** for the avatar are placeholders (grade D) pending dossier 14.
12. **Post-exercise REE elevation** in trained people is poorly quantified; risk of double counting with 02.

---

## 11. References

1. Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis. J Sports Sci. 2017;35(11):1073-1082. PMID 27433992. doi:10.1080/02640414.2016.1210197. https://pubmed.ncbi.nlm.nih.gov/27433992/
2. Baz-Valle E, Balsalobre-Fernández C, Alix-Fages C, Santos-Concejero J. A systematic review of the effects of different resistance training volumes on muscle hypertrophy. J Hum Kinet. 2022;81:199-210. PMID 35291645. doi:10.2478/hukin-2022-0017. https://pubmed.ncbi.nlm.nih.gov/35291645/
3. Pelland JC, Remmert JF, Robinson ZP, Hinson SR, Zourdos MC. The resistance training dose response: meta-regressions exploring the effects of weekly volume and frequency on muscle hypertrophy and strength gains. Sports Med. 2026;56(2):481-505 (Epub 2025-12-04). PMID 41343037. doi:10.1007/s40279-025-02344-w. https://pubmed.ncbi.nlm.nih.gov/41343037/ — Preprint SportRxiv 2024 (https://sportrxiv.org/index.php/server/preprint/view/460); marginal-mean tables used for our fits: OSF https://osf.io/6z3xu (files "pairwise.comparisons.sets.week.fractional.hyp/str", "frequency.fractional.hyp/str").
4. Bickel CS, Cross JM, Bamman MM. Exercise dosing to retain resistance training adaptations in young and older adults. Med Sci Sports Exerc. 2011;43(7):1177-1187. PMID 21131862. doi:10.1249/MSS.0b013e318207c15d. https://pubmed.ncbi.nlm.nih.gov/21131862/
5. Schoenfeld BJ, Ogborn D, Krieger JW. Effects of resistance training frequency on measures of muscle hypertrophy: a systematic review and meta-analysis. Sports Med. 2016;46(11):1689-1697. PMID 27102172. doi:10.1007/s40279-016-0543-8. https://pubmed.ncbi.nlm.nih.gov/27102172/
6. Schoenfeld BJ, Grgic J, Krieger J. How many times per week should a muscle be trained to maximize muscle hypertrophy? J Sports Sci. 2019;37(11):1286-1295. PMID 30558493. doi:10.1080/02640414.2018.1555906. https://pubmed.ncbi.nlm.nih.gov/30558493/
7. Schoenfeld BJ, Grgic J, Ogborn D, Krieger JW. Strength and hypertrophy adaptations between low- vs. high-load resistance training: a systematic review and meta-analysis. J Strength Cond Res. 2017;31(12):3508-3523. PMID 28834797. doi:10.1519/JSC.0000000000002200. https://pubmed.ncbi.nlm.nih.gov/28834797/
8. Lopez P, Radaelli R, Taaffe DR, et al. Resistance training load effects on muscle hypertrophy and strength gain: systematic review and network meta-analysis. Med Sci Sports Exerc. 2021;53(6):1206-1216. PMID 33433148. doi:10.1249/MSS.0000000000002585. https://pubmed.ncbi.nlm.nih.gov/33433148/
9. Robinson ZP, Pelland JC, Remmert JF, et al. Exploring the dose-response relationship between estimated resistance training proximity to failure, strength gain, and muscle hypertrophy: a series of meta-regressions. Sports Med. 2024;54(9):2209-2231. PMID 38970765. doi:10.1007/s40279-024-02069-2. https://pubmed.ncbi.nlm.nih.gov/38970765/ — Preprint SportRxiv 295; marginal-means table (hypertrophy, response ratio): OSF https://osf.io/7knsj
10. Refalo MC, Helms ER, Trexler ET, Hamilton DL, Fyfe JJ. Influence of resistance training proximity-to-failure on skeletal muscle hypertrophy: a systematic review with meta-analysis. Sports Med. 2023;53(3):649-665. PMID 36334240. doi:10.1007/s40279-022-01784-y. https://pubmed.ncbi.nlm.nih.gov/36334240/
11. Refalo MC, Helms ER, Robinson ZP, Hamilton DL, Fyfe JJ. Similar muscle hypertrophy following eight weeks of resistance training to momentary muscular failure or with repetitions-in-reserve in resistance-trained individuals. J Sports Sci. 2024;42(1):85-101. PMID 38393985. doi:10.1080/02640414.2024.2321021. https://pubmed.ncbi.nlm.nih.gov/38393985/
12. Singer A, Wolf M, Generoso L, et al. Give it a rest: a systematic review with Bayesian meta-analysis on the effect of inter-set rest interval duration on muscle hypertrophy. Front Sports Act Living. 2024;6:1429789. PMID 39205815. doi:10.3389/fspor.2024.1429789. https://pubmed.ncbi.nlm.nih.gov/39205815/
13. Currier BS, Mcleod JC, Banfield L, et al. Resistance training prescription for muscle strength and hypertrophy in healthy adults: a systematic review and Bayesian network meta-analysis. Br J Sports Med. 2023;57(18):1211-1220. PMID 37414459. doi:10.1136/bjsports-2023-106807. https://pubmed.ncbi.nlm.nih.gov/37414459/
14. Currier BS, D'Souza AC, Singh MAF, et al. American College of Sports Medicine Position Stand. Resistance training prescription for muscle function, hypertrophy, and physical performance in healthy adults: an overview of reviews. Med Sci Sports Exerc. 2026;58(4):851-872. PMID 41843416. doi:10.1249/MSS.0000000000003897. https://pubmed.ncbi.nlm.nih.gov/41843416/
15. Pallarés JG, Hernández-Belmonte A, Martínez-Cava A, et al. Effects of range of motion on resistance training adaptations: a systematic review and meta-analysis. Scand J Med Sci Sports. 2021;31(10):1866-1881. PMID 34170576. doi:10.1111/sms.14006. https://pubmed.ncbi.nlm.nih.gov/34170576/
16. Wolf M, Androulakis-Korakakis P, Fisher J, Schoenfeld B, et al. Partial vs full range of motion resistance training: a systematic review and meta-analysis. Int J Strength Cond. 2023;3(1). doi:10.47206/ijsc.v3i1.182. https://journal.iusca.org/index.php/Journal/article/view/182
17. Maeo S, Huang M, Wu Y, et al. Greater hamstrings muscle hypertrophy but similar damage protection after training at long versus short muscle lengths. Med Sci Sports Exerc. 2021;53(4):825-837. PMID 33009197. doi:10.1249/MSS.0000000000002523. https://pubmed.ncbi.nlm.nih.gov/33009197/
18. Maeo S, Wu Y, Huang M, et al. Triceps brachii hypertrophy is substantially greater after elbow extension training performed in the overhead versus neutral arm position. Eur J Sport Sci. 2023;23(7):1240-1250. PMID 35819335. doi:10.1080/17461391.2022.2100279. https://pubmed.ncbi.nlm.nih.gov/35819335/
19. Pedrosa GF, Lima FV, Schoenfeld BJ, et al. Partial range of motion training elicits favorable improvements in muscular adaptations when carried out at long muscle lengths. Eur J Sport Sci. 2022;22(8):1250-1260. PMID 33977835. doi:10.1080/17461391.2021.1927199. https://pubmed.ncbi.nlm.nih.gov/33977835/
20. Lasevicius T, Ugrinowitsch C, Schoenfeld BJ, et al. Effects of different intensities of resistance training with equated volume load on muscle strength and hypertrophy. Eur J Sport Sci. 2018;18(6):772-780. PMID 29564973. doi:10.1080/17461391.2018.1450898. https://pubmed.ncbi.nlm.nih.gov/29564973/
21. Benito PJ, Cupeiro R, Ramos-Campo DJ, Alcaraz PE, Rubio-Arias JÁ. A systematic review with meta-analysis of the effect of resistance training on whole-body muscle growth in healthy adult males. Int J Environ Res Public Health. 2020;17(4):1285. PMID 32079265. PMCID PMC7068252. doi:10.3390/ijerph17041285. https://pmc.ncbi.nlm.nih.gov/articles/PMC7068252/
22. Morton RW, Murphy KT, McKellar SR, et al. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. Br J Sports Med. 2018;52(6):376-384. PMID 28698222. PMCID PMC5867436. doi:10.1136/bjsports-2017-097608. https://pmc.ncbi.nlm.nih.gov/articles/PMC5867436/
23. Roberts BM, Nuckols G, Krieger JW. Sex differences in resistance training: a systematic review and meta-analysis. J Strength Cond Res. 2020;34(5):1448-1460. PMID 32218059. doi:10.1519/JSC.0000000000003521. https://pubmed.ncbi.nlm.nih.gov/32218059/
24. Peterson MD, Sen A, Gordon PM. Influence of resistance exercise on lean body mass in aging adults: a meta-analysis. Med Sci Sports Exerc. 2011;43(2):249-258. PMID 20543750. PMCID PMC2995836. doi:10.1249/MSS.0b013e3181eb6265. https://pmc.ncbi.nlm.nih.gov/articles/PMC2995836/
25. Hubal MJ, Gordish-Dressman H, Thompson PD, et al. Variability in muscle size and strength gain after unilateral resistance training. Med Sci Sports Exerc. 2005;37(6):964-972. PMID 15947721. https://pubmed.ncbi.nlm.nih.gov/15947721/
26. Ahtiainen JP, Walker S, Peltonen H, et al. Heterogeneity in resistance training-induced muscle strength and mass responses in men and women of different ages. Age (Dordr). 2016;38(1):10. PMID 26767377. doi:10.1007/s11357-015-9870-1. https://pubmed.ncbi.nlm.nih.gov/26767377/
27. Kosek DJ, Kim JS, Petrella JK, Cross JM, Bamman MM. Efficacy of 3 days/wk resistance training on myofiber hypertrophy and myogenic mechanisms in young vs. older adults. J Appl Physiol. 2006;101(2):531-544. PMID 16614355. doi:10.1152/japplphysiol.01474.2005. https://pubmed.ncbi.nlm.nih.gov/16614355/
28. Kouri EM, Pope HG Jr, Katz DL, Oliva P. Fat-free mass index in users and nonusers of anabolic-androgenic steroids. Clin J Sport Med. 1995;5(4):223-228. PMID 7496846. doi:10.1097/00042752-199510000-00003. https://pubmed.ncbi.nlm.nih.gov/7496846/
29. Trexler ET, Smith-Ryan AE, Blue MNM, et al. Fat-free mass index in NCAA Division I and II collegiate American football players. J Strength Cond Res. 2017;31(10):2719-2727. PMID 27930454. doi:10.1519/JSC.0000000000001737. https://pubmed.ncbi.nlm.nih.gov/27930454/
30. Magee MK, Fields JB, Jagim AR, Jones MT. Fat-free mass index in a large sample of NCAA men and women athletes from a variety of sports. J Strength Cond Res. 2024;38(2):311-317. PMID 37815277. doi:10.1519/JSC.0000000000004621. https://pubmed.ncbi.nlm.nih.gov/37815277/
31. Blue MNM, Hirsch KR, Pihoker AA, Trexler ET, Smith-Ryan AE. Normative fat-free mass index values for a diverse sample of collegiate female athletes. J Sports Sci. 2019;37(15):1741-1745. PMID 30893018. doi:10.1080/02640414.2019.1591575. https://pubmed.ncbi.nlm.nih.gov/30893018/
32. McDonald L. What's my genetic muscular potential? BodyRecomposition.com (web article with McDonald and Aragon/Helms heuristic tables; expert opinion). https://bodyrecomposition.com/muscle-gain/whats-my-genetic-muscular-potential (accessed 2026-09-30).
33. Butt C. Your maximum muscular bodyweight and measurements. weightrainer.net (web article; heuristic). Archived: https://web.archive.org/web/2017/http://www.weightrainer.net/potential.html (accessed 2026-09-30).
34. Damas F, Phillips SM, Lixandrão ME, et al. Early resistance training-induced increases in muscle cross-sectional area are concomitant with edema-induced muscle swelling. Eur J Appl Physiol. 2016;116(1):49-56. PMID 26280652. doi:10.1007/s00421-015-3243-4. https://pubmed.ncbi.nlm.nih.gov/26280652/
35. Damas F, Phillips SM, Libardi CA, et al. Resistance training-induced changes in integrated myofibrillar protein synthesis are related to hypertrophy only after attenuation of muscle damage. J Physiol. 2016;594(18):5209-5222. PMID 27219125. doi:10.1113/JP272472. https://pubmed.ncbi.nlm.nih.gov/27219125/
36. Seynnes OR, de Boer M, Narici MV. Early skeletal muscle hypertrophy and architectural changes in response to high-intensity resistance training. J Appl Physiol. 2007;102(1):368-373. PMID 17053104. doi:10.1152/japplphysiol.00789.2006. https://pubmed.ncbi.nlm.nih.gov/17053104/
37. Damas F, Phillips S, Vechin FC, Ugrinowitsch C. A review of resistance training-induced changes in skeletal muscle protein synthesis and their contribution to hypertrophy. Sports Med. 2015;45(6):801-807. PMID 25739559. doi:10.1007/s40279-015-0320-0. https://pubmed.ncbi.nlm.nih.gov/25739559/
38. MacDougall JD, Gibala MJ, Tarnopolsky MA, et al. The time course for elevated muscle protein synthesis following heavy resistance exercise. Can J Appl Physiol. 1995;20(4):480-486. PMID 8563679. doi:10.1139/h95-038. https://pubmed.ncbi.nlm.nih.gov/8563679/
39. Chesley A, MacDougall JD, Tarnopolsky MA, Atkinson SA, Smith K. Changes in human muscle protein synthesis after resistance exercise. J Appl Physiol. 1992;73(4):1383-1388. PMID 1280254. doi:10.1152/jappl.1992.73.4.1383. https://pubmed.ncbi.nlm.nih.gov/1280254/
40. Phillips SM, Tipton KD, Aarsland A, Wolf SE, Wolfe RR. Mixed muscle protein synthesis and breakdown after resistance exercise in humans. Am J Physiol. 1997;273(1 Pt 1):E99-E107. PMID 9252485. doi:10.1152/ajpendo.1997.273.1.E99. https://pubmed.ncbi.nlm.nih.gov/9252485/
41. Tang JE, Perco JG, Moore DR, Wilkinson SB, Phillips SM. Resistance training alters the response of fed state mixed muscle protein synthesis in young men. Am J Physiol Regul Integr Comp Physiol. 2008;294(1):R172-R178. PMID 18032468. doi:10.1152/ajpregu.00636.2007. https://pubmed.ncbi.nlm.nih.gov/18032468/
42. Murphy C, Koehler K. Energy deficiency impairs resistance training gains in lean mass but not strength: a meta-analysis and meta-regression. Scand J Med Sci Sports. 2022;32(1):125-137. PMID 34623696. doi:10.1111/sms.14075. https://pubmed.ncbi.nlm.nih.gov/34623696/ (slope 0.031 ES per 100 kcal/d as reported in secondary summaries, e.g. https://www.strongerbyscience.com/?p=55775)
43. Longland TM, Oikawa SY, Mitchell CJ, Devries MC, Phillips SM. Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss: a randomized trial. Am J Clin Nutr. 2016;103(3):738-746. PMID 26817506. doi:10.3945/ajcn.115.119339. https://pubmed.ncbi.nlm.nih.gov/26817506/
44. Barakat C, Pearson J, Escalante G, Campbell B, et al. Body recomposition: can trained individuals build muscle and lose fat at the same time? Strength Cond J. 2020;42(5):7-21. doi:10.1519/SSC.0000000000000584.
45. Slater GJ, Dieter BP, Marsh DJ, et al. Is an energy surplus required to maximize skeletal muscle hypertrophy associated with resistance training. Front Nutr. 2019;6:131. PMID 31482093. doi:10.3389/fnut.2019.00131. https://pubmed.ncbi.nlm.nih.gov/31482093/
46. Helms ER, Spence AJ, Sousa C, et al. Effect of small and large energy surpluses on strength, muscle, and skinfold thickness in resistance-trained individuals: a parallel groups design. Sports Med Open. 2023;9(1):102. PMID 37914977. doi:10.1186/s40798-023-00651-y. https://pubmed.ncbi.nlm.nih.gov/37914977/
47. Ribeiro AS, Nunes JP, Schoenfeld BJ, Aguiar AF, Cyrino ES. Effects of different dietary energy intake following resistance training on muscle mass and body fat in bodybuilders: a pilot study. J Hum Kinet. 2019;70:125-134. PMID 31915482. doi:10.2478/hukin-2019-0038. https://pubmed.ncbi.nlm.nih.gov/31915482/
48. Garthe I, Raastad T, Refsnes PE, Sundgot-Borgen J. Effect of nutritional intervention on body composition and performance in elite athletes. Eur J Sport Sci. 2013;13(3):295-303. PMID 23679146. doi:10.1080/17461391.2011.643923. https://pubmed.ncbi.nlm.nih.gov/23679146/
49. Rozenek R, Ward P, Long S, Garhammer J. Effects of high-calorie supplements on body composition and muscular strength following resistance training. J Sports Med Phys Fitness. 2002;42(3):340-347. PMID 12094125. https://pubmed.ncbi.nlm.nih.gov/12094125/
50. Smith RW, Harty PS, Stratton MT, et al. Predicting adaptations to resistance training plus overfeeding using Bayesian regression: a preliminary investigation. J Funct Morphol Kinesiol. 2021;6(2):36. PMID 33919267. doi:10.3390/jfmk6020036. https://pubmed.ncbi.nlm.nih.gov/33919267/
51. Iraki J, Fitschen P, Espinar S, Helms E. Nutrition recommendations for bodybuilders in the off-season: a narrative review. Sports (Basel). 2019;7(7):154. PMID 31247944. doi:10.3390/sports7070154. https://pubmed.ncbi.nlm.nih.gov/31247944/
52. Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. Int J Sport Nutr Exerc Metab. 2011;21(2):97-104. PMID 21558571. doi:10.1123/ijsnem.21.2.97. https://pubmed.ncbi.nlm.nih.gov/21558571/
53. Cava E, Yeat NC, Mittendorfer B. Preserving healthy muscle during weight loss. Adv Nutr. 2017;8(3):511-519. PMID 28507015. doi:10.3945/an.116.014506. https://pubmed.ncbi.nlm.nih.gov/28507015/
54. Clark JE. Diet, exercise or diet with exercise: comparing the effectiveness of treatment options for weight-loss and changes in fitness for adults (18-65 years old) who are overfat, or obese; systematic review and meta-analysis. J Diabetes Metab Disord. 2015;14:31. PMID 25973403. doi:10.1186/s40200-015-0154-1. https://pubmed.ncbi.nlm.nih.gov/25973403/
55. Weiss EP, Racette SB, Villareal DT, et al. Lower extremity muscle size and strength and aerobic capacity decrease with caloric restriction but not with exercise-induced weight loss. J Appl Physiol. 2007;102(2):634-640. PMID 17095635. doi:10.1152/japplphysiol.00853.2006. https://pubmed.ncbi.nlm.nih.gov/17095635/
56. Sardeli AV, Komatsu TR, Mori MA, Gáspari AF, Chacon-Mikahil MPT. Resistance training prevents muscle loss induced by caloric restriction in obese elderly individuals: a systematic review and meta-analysis. Nutrients. 2018;10(4):423. PMID 29596307. doi:10.3390/nu10040423. https://pubmed.ncbi.nlm.nih.gov/29596307/
57. Weinheimer EM, Sands LP, Campbell WW. A systematic review of the separate and combined effects of energy restriction and exercise on fat-free mass in middle-aged and older adults: implications for sarcopenic obesity. Nutr Rev. 2010;68(7):375-388. PMID 20591106. doi:10.1111/j.1753-4887.2010.00298.x. https://pubmed.ncbi.nlm.nih.gov/20591106/
58. Ballor DL, Poehlman ET. Exercise-training enhances fat-free mass preservation during diet-induced weight loss: a meta-analytical finding. Int J Obes Relat Metab Disord. 1994;18(1):35-40. PMID 8130813. https://pubmed.ncbi.nlm.nih.gov/8130813/
59. Villareal DT, Aguirre L, Gurney AB, et al. Aerobic or resistance exercise, or both, in dieting obese older adults. N Engl J Med. 2017;376(20):1943-1955. PMID 28514618. doi:10.1056/NEJMoa1616338. https://pubmed.ncbi.nlm.nih.gov/28514618/
60. Heymsfield SB, Gonzalez MC, Shen W, Redman L, Thomas D. Weight loss composition is one-fourth fat-free mass: a critical review and critique of this widely cited rule. Obes Rev. 2014;15(4):310-321. PMID 24447775. doi:10.1111/obr.12143. https://pubmed.ncbi.nlm.nih.gov/24447775/
61. Forbes GB. Body fat content influences the body composition response to nutrition and exercise. Ann N Y Acad Sci. 2000;904:359-365. PMID 10865771. doi:10.1111/j.1749-6632.2000.tb06482.x. https://pubmed.ncbi.nlm.nih.gov/10865771/
62. Hall KD. Body fat and fat-free mass inter-relationships: Forbes's theory revisited. Br J Nutr. 2007;97(6):1059-1063. PMID 17367567. doi:10.1017/S0007114507691946. https://pubmed.ncbi.nlm.nih.gov/17367567/
63. Josse AR, Atkinson SA, Tarnopolsky MA, Phillips SM. Increased consumption of dairy foods and protein during diet- and exercise-induced weight loss promotes fat mass loss and lean mass gain in overweight and obese premenopausal women. J Nutr. 2011;141(9):1626-1634. PMID 21775530. doi:10.3945/jn.111.141028. https://pubmed.ncbi.nlm.nih.gov/21775530/
64. Areta JL, Burke LM, Camera DM, et al. Reduced resting skeletal muscle protein synthesis is rescued by resistance exercise and protein ingestion following short-term energy deficit. Am J Physiol Endocrinol Metab. 2014;306(8):E989-E997. PMID 24595305. doi:10.1152/ajpendo.00590.2013. https://pubmed.ncbi.nlm.nih.gov/24595305/
65. Ogasawara R, Yasuda T, Ishii N, Abe T. Comparison of muscle hypertrophy following 6-month of continuous and periodic strength training. Eur J Appl Physiol. 2013;113(4):975-985. PMID 23053130. doi:10.1007/s00421-012-2511-9. https://pubmed.ncbi.nlm.nih.gov/23053130/
66. Ogasawara R, Yasuda T, Sakamaki M, Ozaki H, Abe T. Effects of periodic and continued resistance training on muscle CSA and strength in previously untrained men. Clin Physiol Funct Imaging. 2011;31(5):399-404. PMID 21771261. doi:10.1111/j.1475-097X.2011.01031.x. https://pubmed.ncbi.nlm.nih.gov/21771261/
67. Psilander N, Eftestøl E, Cumming KT, et al. Effects of training, detraining, and retraining on strength, hypertrophy, and myonuclear number in human skeletal muscle. J Appl Physiol. 2019;126(6):1636-1645. PMID 30991013. doi:10.1152/japplphysiol.00917.2018. https://pubmed.ncbi.nlm.nih.gov/30991013/
68. Cumming KT, Reitzner SM, Hanslien M, et al. Muscle memory in humans: evidence for myonuclear permanence and long-term transcriptional regulation after strength training. J Physiol. 2024;602(17):4171-4193. PMID 39159314. doi:10.1113/JP285675. https://pubmed.ncbi.nlm.nih.gov/39159314/
69. Rahmati M, McCarthy JJ, Malakoutinia F. Myonuclear permanence in skeletal muscle memory: a systematic review and meta-analysis of human and animal studies. J Cachexia Sarcopenia Muscle. 2022;13(5):2276-2297. PMID 35961635. doi:10.1002/jcsm.13043. https://pubmed.ncbi.nlm.nih.gov/35961635/
70. Seaborne RA, Strauss J, Cocks M, et al. Human skeletal muscle possesses an epigenetic memory of hypertrophy. Sci Rep. 2018;8(1):1898. PMID 29382913. doi:10.1038/s41598-018-20287-3. https://pubmed.ncbi.nlm.nih.gov/29382913/
71. Snijders T, Aussieker T, Holwerda A, et al. The concept of skeletal muscle memory: evidence from animal and human studies. Acta Physiol (Oxf). 2020;229(3):e13465. PMID 32175681. doi:10.1111/apha.13465. https://pubmed.ncbi.nlm.nih.gov/32175681/
72. Bosquet L, Berryman N, Dupuy O, et al. Effect of training cessation on muscular performance: a meta-analysis. Scand J Med Sci Sports. 2013;23(3):e140-e149. PMID 23347054. doi:10.1111/sms.12047. https://pubmed.ncbi.nlm.nih.gov/23347054/
73. Grgic J. Use it or lose it? A meta-analysis on the effects of resistance training cessation (detraining) on muscle size in older adults. Int J Environ Res Public Health. 2022;19(21):14048. PMID 36360927. doi:10.3390/ijerph192114048. https://pubmed.ncbi.nlm.nih.gov/36360927/
74. Blocquiaux S, Gorski T, Van Roie E, et al. The effect of resistance training, detraining and retraining on muscle strength and power, myofibre size, satellite cells and myonuclei in older men. Exp Gerontol. 2020;133:110860. PMID 32017951. doi:10.1016/j.exger.2020.110860. https://pubmed.ncbi.nlm.nih.gov/32017951/
75. Hwang PS, Andre TL, McKinley-Barnard SK, et al. Resistance training-induced elevations in muscular strength in trained men are maintained after 2 weeks of detraining and not differentially affected by whey protein supplementation. J Strength Cond Res. 2017;31(4):869-881. PMID 28328712. doi:10.1519/JSC.0000000000001807. https://pubmed.ncbi.nlm.nih.gov/28328712/
76. Narici MV, Roi GS, Landoni L, Minetti AE, Cerretelli P. Changes in force, cross-sectional area and neural activation during strength training and detraining of the human quadriceps. Eur J Appl Physiol Occup Physiol. 1989;59(4):310-319. PMID 2583179. doi:10.1007/BF02388334. https://pubmed.ncbi.nlm.nih.gov/2583179/
77. Coleman M, Burke R, Augustin F, et al. Gaining more from doing less? The effects of a one-week deload period during supervised resistance training on muscular adaptations. PeerJ. 2024;12:e16777. PMID 38274324. doi:10.7717/peerj.16777. https://pubmed.ncbi.nlm.nih.gov/38274324/
78. Morán-Navarro R, Pérez CE, Mora-Rodríguez R, et al. Time course of recovery following resistance training leading or not to failure. Eur J Appl Physiol. 2017;117(12):2387-2399. PMID 28965198. doi:10.1007/s00421-017-3725-7. https://pubmed.ncbi.nlm.nih.gov/28965198/
79. Vargas S, Romance R, Petro JL, et al. Efficacy of ketogenic diet on body composition during resistance training in trained men: a randomized controlled trial. J Int Soc Sports Nutr. 2018;15(1):31. PMID 29986720. doi:10.1186/s12970-018-0236-9. https://pubmed.ncbi.nlm.nih.gov/29986720/
80. Paoli A, Cenci L, Pompei P, et al. Effects of two months of very low carbohydrate ketogenic diet on body composition, muscle strength, muscle area, and blood parameters in competitive natural body builders. Nutrients. 2021;13(2):374. PMID 33530512. doi:10.3390/nu13020374. https://pubmed.ncbi.nlm.nih.gov/33530512/
81. Henselmans M, Bjørnsen T, Hedderman R, Vårvik FT. The effect of carbohydrate intake on strength and resistance training performance: a systematic review. Nutrients. 2022;14(4):856. PMID 35215506. doi:10.3390/nu14040856. https://pubmed.ncbi.nlm.nih.gov/35215506/
82. Ashtary-Larky D, Bagheri R, Asbaghi O, et al. Effects of resistance training combined with a ketogenic diet on body composition: a systematic review and meta-analysis. Crit Rev Food Sci Nutr. 2022;62(21):5717-5732. PMID 33624538. doi:10.1080/10408398.2021.1890689. https://pubmed.ncbi.nlm.nih.gov/33624538/
83. Robergs RA, Pearson DR, Costill DL, et al. Muscle glycogenolysis during differing intensities of weight-resistance exercise. J Appl Physiol. 1991;70(4):1700-1706. PMID 2055849. doi:10.1152/jappl.1991.70.4.1700. https://pubmed.ncbi.nlm.nih.gov/2055849/
84. Koopman R, Manders RJ, Jonkers RA, et al. Intramyocellular lipid and glycogen content are reduced following resistance exercise in untrained healthy males. Eur J Appl Physiol. 2006;96(5):525-534. PMID 16369816. doi:10.1007/s00421-005-0118-0. https://pubmed.ncbi.nlm.nih.gov/16369816/
85. Herrmann SD, Willis EA, Ainsworth BE, et al. 2024 Adult Compendium of Physical Activities: a third update of the energy costs of human activities. J Sport Health Sci. 2024;13(1):6-12. PMID 38242596. doi:10.1016/j.jshs.2023.10.010. Activity codes: https://pacompendium.com/conditioning-exercise/
86. Schuenke MD, Mikat RP, McBride JM. Effect of an acute period of resistance exercise on excess post-exercise oxygen consumption: implications for body mass management. Eur J Appl Physiol. 2002;86(5):411-417. PMID 11882927. doi:10.1007/s00421-001-0568-y. https://pubmed.ncbi.nlm.nih.gov/11882927/
87. Heden T, Lox C, Rose P, Reid S, Kirk EP. One-set resistance training elevates energy expenditure for 72 h similar to three sets. Eur J Appl Physiol. 2011;111(3):477-484. PMID 20886227. doi:10.1007/s00421-010-1666-5. https://pubmed.ncbi.nlm.nih.gov/20886227/
88. Reis VM, Garrido ND, Vianna J, et al. Energy cost of isolated resistance exercises across low- to high-intensities. PLoS One. 2017;12(7):e0181311. PMID 28742112. doi:10.1371/journal.pone.0181311. https://pubmed.ncbi.nlm.nih.gov/28742112/
89. Reis VM, Júnior RS, Zajac A, Oliveira DR. Energy cost of resistance exercises: an uptade. J Hum Kinet. 2011;29A:33-39. PMID 23487150. doi:10.2478/v10078-011-0056-3. https://pubmed.ncbi.nlm.nih.gov/23487150/
90. Loenneke JP, Buckner SL, Dankel SJ, Abe T. Exercise-induced changes in muscle size do not contribute to exercise-induced changes in muscle strength. Sports Med. 2019;49(7):987-991. PMID 31020548. doi:10.1007/s40279-019-01106-9. https://pubmed.ncbi.nlm.nih.gov/31020548/
91. Balshaw TG, Massey GJ, Maden-Wilkinson TM, et al. Changes in agonist neural drive, hypertrophy and pre-training strength all contribute to the individual strength gains after resistance training. Eur J Appl Physiol. 2017;117(4):631-640. PMID 28239775. doi:10.1007/s00421-017-3560-x. https://pubmed.ncbi.nlm.nih.gov/28239775/
92. Erskine RM, Jones DA, Williams AG, Stewart CE, Degens H. Inter-individual variability in the adaptation of human muscle specific tension to progressive resistance training. Eur J Appl Physiol. 2010;110(6):1117-1125. PMID 20703498. doi:10.1007/s00421-010-1601-9. https://pubmed.ncbi.nlm.nih.gov/20703498/
93. Abe T, DeHoyos DV, Pollock ML, Garzarella L. Time course for strength and muscle thickness changes following upper and lower body resistance training in men and women. Eur J Appl Physiol. 2000;81(3):174-180. PMID 10638374. doi:10.1007/s004210050027. https://pubmed.ncbi.nlm.nih.gov/10638374/
94. Wakahara T, Fukutani A, Kawakami Y, Yanai T. Nonuniform muscle hypertrophy: its relation to muscle activation in training session. Med Sci Sports Exerc. 2013;45(11):2158-2165. PMID 23657165. doi:10.1249/MSS.0b013e3182995349. https://pubmed.ncbi.nlm.nih.gov/23657165/
95. Janssen I, Heymsfield SB, Wang ZM, Ross R. Skeletal muscle mass and distribution in 468 men and women aged 18-88 yr. J Appl Physiol. 2000;89(1):81-88. PMID 10904038. doi:10.1152/jappl.2000.89.1.81. https://pubmed.ncbi.nlm.nih.gov/10904038/
96. Colenso-Semple LM, D'Souza AC, Elliott-Sale KJ, Phillips SM. Current evidence shows no influence of women's menstrual cycle phase on acute strength performance or adaptations to resistance exercise training. Front Sports Act Living. 2023;5:1054542. PMID 37033884. doi:10.3389/fspor.2023.1054542. https://pubmed.ncbi.nlm.nih.gov/37033884/
97. Kissow J, Jacobsen KJ, Gunnarsson TP, Jessen S, Hostrup M. Effects of follicular and luteal phase-based menstrual cycle resistance training on muscle strength and mass. Sports Med. 2022;52(12):2813-2819. PMID 35471634. doi:10.1007/s40279-022-01679-y. https://pubmed.ncbi.nlm.nih.gov/35471634/
98. Nolan D, McNulty KL, Manninen M, Egan B. The effect of hormonal contraceptive use on skeletal muscle hypertrophy, power and strength adaptations to resistance exercise training: a systematic review and multilevel meta-analysis. Sports Med. 2024;54(1):105-125. PMID 37755666. doi:10.1007/s40279-023-01911-3. https://pubmed.ncbi.nlm.nih.gov/37755666/
99. Borde R, Hortobágyi T, Granacher U. Dose-response relationships of resistance training in healthy old adults: a systematic review and meta-analysis. Sports Med. 2015;45(12):1693-1720. PMID 26420238. doi:10.1007/s40279-015-0385-9. https://pubmed.ncbi.nlm.nih.gov/26420238/
100. Schoenfeld BJ, Contreras B, Krieger J, et al. Resistance training volume enhances muscle hypertrophy but not strength in trained men. Med Sci Sports Exerc. 2019;51(1):94-103. PMID 30153194. PMCID PMC6303131. doi:10.1249/MSS.0000000000001764. https://pmc.ncbi.nlm.nih.gov/articles/PMC6303131/
101. Aube D, Wadhi T, Rauch J, et al. Progressive resistance training volume: effects on muscle thickness, mass, and strength adaptations in resistance-trained individuals. J Strength Cond Res. 2022;36(3):600-607. PMID 32058362. doi:10.1519/JSC.0000000000003524. https://pubmed.ncbi.nlm.nih.gov/32058362/
102. Morton RW, Oikawa SY, Wavell CG, et al. Neither load nor systemic hormones determine resistance training-mediated hypertrophy or strength gains in resistance-trained young men. J Appl Physiol. 2016;121(1):129-138. PMID 27174923. doi:10.1152/japplphysiol.00154.2016. https://pubmed.ncbi.nlm.nih.gov/27174923/
103. Schumann M, Feuerbacher JF, Sünkeler M, et al. Compatibility of concurrent aerobic and strength training for skeletal muscle size and function: an updated systematic review and meta-analysis. Sports Med. 2022;52(3):601-612. PMID 34757594. doi:10.1007/s40279-021-01587-7. https://pubmed.ncbi.nlm.nih.gov/34757594/
104. Schoenfeld BJ, Aragon AA, Krieger JW. The effect of protein timing on muscle strength and hypertrophy: a meta-analysis. J Int Soc Sports Nutr. 2013;10(1):53. PMID 24299050. doi:10.1186/1550-2783-10-53. https://pubmed.ncbi.nlm.nih.gov/24299050/
105. Lamon S, Morabito A, Arentson-Lantz E, et al. The effect of acute sleep deprivation on skeletal muscle protein synthesis and the hormonal environment. Physiol Rep. 2021;9(1):e14660. PMID 33400856. doi:10.14814/phy2.14660. https://pubmed.ncbi.nlm.nih.gov/33400856/
106. Bamman MM, Petrella JK, Kim JS, Mayhew DL, Cross JM. Cluster analysis tests the importance of myogenic gene expression during myofiber hypertrophy in humans. J Appl Physiol. 2007;102(6):2232-2239. PMID 17395765. doi:10.1152/japplphysiol.00024.2007. https://pubmed.ncbi.nlm.nih.gov/17395765/
107. Wernbom M, Augustsson J, Thomeé R. The influence of frequency, intensity, volume and mode of strength training on whole muscle cross-sectional area in humans. Sports Med. 2007;37(3):225-264. PMID 17326698. doi:10.2165/00007256-200737030-00004. https://pubmed.ncbi.nlm.nih.gov/17326698/ — rates (elbow-flexor CSA +0.15–0.26 %/day by volume band) as summarised in Viecelli C, Aguayo D. Front Physiol. 2021;12:686119 (PMID 35069229, PMC8769283).
108. Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. J Int Soc Sports Nutr. 2014;11:20. PMID 24864135. doi:10.1186/1550-2783-11-20. https://pubmed.ncbi.nlm.nih.gov/24864135/
109. Rossow LM, Fukuda DH, Fahs CA, Loenneke JP, Stout JR. Natural bodybuilding competition preparation and recovery: a 12-month case study. Int J Sports Physiol Perform. 2013;8(5):582-592. PMID 23412685. doi:10.1123/ijspp.8.5.582. https://pubmed.ncbi.nlm.nih.gov/23412685/
110. Chappell AJ, Simper TN, Trexler ET, Helms ER. Biopsychosocial effects of competition preparation in natural bodybuilders. J Hum Kinet. 2021;79:259-276. PMID 34401005. doi:10.2478/hukin-2021-0082. https://pubmed.ncbi.nlm.nih.gov/34401005/
