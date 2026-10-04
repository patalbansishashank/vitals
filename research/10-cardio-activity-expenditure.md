# 10 — Cardio, daily movement & activity energy expenditure

> Evidence dossier for the Vitals simulation engine. Owner: research agent 10.
> Written 2026-09-30. Every quantitative claim carries a bracketed key `[Author##]` that resolves in
> section 11 (PMID/DOI/URL). `UNVERIFIED` = number not located in a source I could open;
> `PROPOSED FIT` = my own parametrisation of cited data points (data points listed).
> Cross-refs: 01 body-weight models, 02 RMR/NEAT/adaptive thermogenesis, 03 protein/MPS, 04 carbohydrate &
> glycogen, 05 fat oxidation/ketosis, 06 lipids/liver fat, 07 fasting/timing, 09 resistance training,
> 12 appetite hormones, 16 sleep/sex/age modifiers, 17 safety.

## 1. Scope

Aerobic exercise and everyday movement as **inputs** to the simulator: (i) how many kcal a bout / a day of
walking, running, cycling, swimming, HIIT, sport and lifting costs; (ii) how much of that shows up as extra
TDEE versus is offset by metabolic and appetite compensation; (iii) which fuel is burned (fat / carbohydrate /
muscle glycogen) and what fasted or low-carbohydrate states change; (iv) slow adaptations that become
**state variables** (VO2max, mitochondrial oxidative capacity, insulin sensitivity) with gain/decay
time-constants; (v) interference with resistance training, appetite and lean-mass effects, visceral/liver fat,
step-count health metrics, activity baselines, timing and low-energy-availability limits.
Not covered here (see other dossiers): RMR equations & NEAT baseline (02), glycogen store dynamics (04),
ketone kinetics (05), MPS (03), hypertrophy dose-response (09).

**Bottom line for the engineer (12 rules)**
1. Gross exercise cost = `MET_std x 3.5 ml/kg/min x mass` (Compendium) or a locomotion equation; *net* cost subtracts the person's own
   resting VO2, not 3.5 [Byrne05][Herrmann24-corrMET]. No consumer wrist device reached < 20 % median error in energy expenditure; do not calibrate to them [Shcherbina17].
2. Level walking net cost is ~0.44 kcal/kg per 1000 steps (gross ~0.60): ~33 kcal net / 46 gross per 1000 steps for a 75 kg adult
   (derived from [Ludlow16]). Running net cost ~0.9 kcal/kg/km (range 0.8-1.0).
3. EPOC is 6-15 % of the net cost of a session only after long/hard sessions; usually 2-5 %; "afterburn" is not a fat-loss strategy [LaForgia06].
4. Not all exercise energy becomes TDEE: recommended total compensation ~ 30-65 % at 12-40 wk for 100-400 kcal/d of exercise,
   split into a metabolic part (default 15 % of net exercise energy, literature range 0-28 %) and a saturating appetite
   part (max ~100 kcal/d, half-saturation ~150 kcal/d) [Careau21][Martin19][Flack18].
5. Fat-oxidation-vs-intensity is bell-shaped in absolute g/min (Fatmax ~ 48 % VO2max untrained, ~ 64 % trained cyclists,
   ~ 70 % keto-adapted athletes) but **carbohydrate/fat mix during a session does not determine fat-mass change**; energy balance does.
6. Fasted vs fed cardio: +~3 g fat oxidised per session [Vieira16]; no difference in fat/lean mass change in hypocaloric trials [Schoenfeld14][Hackett17].
7. HIIT vs MICT: equal fat-mass loss per week when energy is not matched (Keating17 fat mass -1.38 vs -0.91 kg, n.s.) [Keating17][Wewege17];
   HIIT saves ~40 % time. The Viana 2019 BJSM meta-analysis claiming +28.5 % more fat-mass loss with interval training carries a BJSM Expression of Concern (27 Jun 2019) [Viana19][Viana19-EoC]; do not use it as a parameter source.
8. VO2max: t1/2 of gain ~10-11 d at a fixed stimulus (tau ~15 d) [Hickson81]; mean gain +18 % (SD 9 %-points) in 20 wk of ~3 x 30-50 min at
   55-75 % [Bouchard99][Ross19]; detraining -7 % at 21 d and -16 % at 56 d in athletes [Coyle84] unless intensity is maintained [Madsen93].
9. Mitochondrial content: rises within 1 wk, +20 % (2 wk HIIT) to +40-50 % (high-volume HIIT); citrate synthase decays with t1/2 ~12 d, plateaus ~50 % above sedentary in athletes [Coyle84][Granata16b][Egan13].
10. Concurrent training: no interference for hypertrophy (SMD -0.01) or max strength (-0.06); explosive strength -0.28, worse same-session; fibre-level -0.23 [Schumann22][Lundberg22].
11. Steps: mortality HR 0.53 at 7000 vs 2000 steps/day [Ding25]; plateau ~6-8k (>=60 y) / 8-10k (<60 y) [Paluch22]. Association, not proven causation.
12. Low energy availability warning at < 30 kcal/kg FFM/day (LH pulsatility disrupted below this in young women) but risk rises linearly, no hard threshold [Loucks03][Lieberman18].

## 2. State variables

| Name | Unit | Typical range | Represents | Initial-value rule |
|---|---|---|---|---|
| `vo2max` (V) | ml/kg/min | F 13-56, M 16-66 (FRIEND 5th-95th pct across decades) [Kaminsky15] | maximal aerobic capacity, mass-specific | non-exercise equation (Jackson PA-R or Nes) [Jackson90][Peterman20]; if user gives a test value use it |
| `gFast`, `gSlow` | fraction of V_sed | 0-0.33 each (sum <= 0.60) | training-induced VO2max gain, central/blood-volume pool (tau ~15 d) and slow structural pool (capillaries, Hb mass; tau ~60 d PROPOSED) | 0 unless training history given (then split 55/45) |
| `vSed` | ml/kg/min | as V | detrained ("floor") VO2max for age/sex/BMI | Jackson/Nes with PA-R = 0-1, age-decline ~10 %/decade [Kaminsky15][Hawkins03] |
| `mitoContent` (M_c) | index, sedentary = 1.0 | 1.0-1.5 (athletes to ~2) | citrate-synthase-like mitochondrial content | 1.0 (+0.1 per PA-R level above 2, capped 1.5; PROPOSED) |
| `mitoResp` (M_r) | index | 1.0-1.4 | respiratory capacity per mitochondrion (intensity-driven; dissociable from content) [Granata18] | 1.0 |
| `siAcute` | fractional gain in muscle insulin sensitivity | 0-0.5 | exercise-bout effect, decays over 24-72 h | 0 |
| `siChronic` | fractional gain | 0-0.85 in overweight adults after 6 mo [Houmard04] | training adaptation of insulin action | from training history / PA-R |
| `epocPool[k]` | kcal | 0-60 per bout | unspent post-exercise excess energy per bout | 0 |
| `tddeComp` | fraction of net exercise energy | 0-0.28 | metabolic compensation (non-exercise EE reduction) | 0 |
| `apComp` | kcal/day | 0-125 | appetite-driven extra intake drive | 0 |
| `mem7d` | moderate-equivalent min/wk | 0-900 | rolling weekly aerobic dose (weights in 4.8) | from user's habitual activity |
| `steps7d`, `sitH` | steps/d, h/d | 2k-20k; 4-14 h | habitual ambulation, sedentary time | from activity-level selector (4.14) |
| `runKm7d`, `rtSess7d` | km/wk, sessions/wk | | inputs to interference multiplier | from schedule |
| `trainYears` | y | 0-30 | retention floor of adaptations (rho) | user input |
| `glyDeficitLocal` | fraction of resting glycogen in worked muscle | 0-1 | output handed to module 04 | 0 |
| `EA7d` | kcal/kg FFM/day | 10-60 | energy availability, rolling 7 d | computed |

## 3. Inputs that drive it

| Input | Unit | How it enters |
|---|---|---|
| `bodyMass`, `height`, `sex`, `age`, `ffm`, `rmr` (from 02) | kg, m, -, y, kg, kcal/d | scales all mass-specific costs; net = gross - rmr share; VO2max start; EA denominator |
| `steps` per day (or activity-level selector) | steps/d | ambulatory net energy (4.1.4); health metric (4.13) |
| Bout list: `activity`, `minutes`, `intensity`, `grade`, `load` | - | gross energy (4.1), EPOC (4.2), substrates (4.4-4.5), dose (4.8-4.9) |
| Intensity units | km/h, min/km, W, %VO2max, MET, RPE-band | converted to relative VO2 `x = VO2_gross/VO2max` |
| `fedState` (fasted / postprandial), `hoursSinceMeal`, `carbAdaptation` (0-1 from 05) | - | RER offset (4.4), fat oxidation, hunger |
| `clockStart` | h | post-meal walking benefit (4.10, 4.15); no time-of-day energy term |
| Resistance sessions (sets, load, rest, `sessionMinutes`) | - | RT energy (4.1.7), interference (4.11), glycogen (4.5) |
| `energyIntake` (from schedule) | kcal/d | energy availability (4.16); appetite-comp only reported as drive if intake is user-fixed |
| `bmi`/`fatMass` | kg/m2 | compensation adiposity modifier (4.3) |
| `trainingStatus` | 0-1 | fat-oxidation preset, EPOC recovery speed, VO2max ceiling |

## 4. Mechanisms & equations

### 4.1 Exercise energy expenditure (gross, net, per-km, per-step, per-session)

**Mechanism.** Mechanical work + muscle inefficiency + postural/baseline cost = whole-body O2 uptake; energy = VO2 x energy-per-litre
(which rises with RQ). Weight-bearing locomotion cost scales with total body mass; cycling/rowing with external power.

#### 4.1.1 Units and conversions (verified)
- 1 MET (Compendium standard) = 3.5 ml O2/kg/min; kcal/min = MET x 3.5 x kg / 200 (=> 1 MET = 1.05 kcal/kg/h; the Compendium also quotes 1 MET = 1 kcal/kg/h - 5 % difference, pick one and be consistent) [Herrmann24-units].
- Energy per litre O2 depends on RQ: `kcalPerLO2(RQ) = 4.686 + (RQ - 0.707) x 0.361/0.293` (4.686 at RQ 0.707, 5.047 at 1.00; 4.86 at 0.85) [Manini10].
- Stoichiometry for substrates (g/min from VO2, VCO2 in L/min; no protein): low-moderate intensity `CHO = 4.210 VCO2 - 2.962 VO2`, `Fat = 1.695 VO2 - 1.701 VCO2` (as reproduced in [Ahn22]/[Jung23]; the higher-intensity CHO pair 4.344/3.061 is from a secondary summary of [Jeukendrup05], flagged UNVERIFIED at source). Derived energy densities: fat 9.62 kcal/g, CHO 4.04 kcal/g oxidised (from the two equations above and kcalPerLO2).
- Speed: 1 mph = 26.8 m/min = 1.609 km/h; 1 W = 6.118 kg.m/min; 1 kcal = 4184 J.

#### 4.1.2 Compendium of Physical Activities 2024 (adult, 19-59 y)
1114 activities (912 measured, 202 estimated), 22 headings, 2356 values from 701 papers; MET = measured VO2/3.5 [Herrmann24]. Values below are copied from the
web tables (pacompendium.com category pages, fetched 2026-09-30); codes are the Compendium's.

| Activity (code) | MET | | Activity (code) | MET |
|---|---|---|---|---|
| Sleeping (07030) | 1.0 | | Running 4.3-4.8 mph (12029) | 7.8 |
| Sitting quietly / TV (07021, 07020) | 1.0 | | Running 5.0-5.2 mph, 12 min/mi (12030) | 8.5 |
| Sitting, computer work (11582) | 1.3 | | Running 5.5-5.8 mph (12045) | 9.0 |
| Standing quietly (07040) | 1.3 | | Running 6-6.3 mph, 10 min/mi (12050) | 9.3 |
| Sitting, fidgeting (07022) | 1.5 | | Running 6.7 mph, 9 min/mi (12060) | 10.5 |
| Treadmill desk 1-2 mph (11004) | 2.8 | | Running 7 mph (12070) | 11.0 |
| Walking, household (17150) | 2.3 | | Running 8 mph (12090) | 12.0 |
| Walking 2.0-2.4 mph firm (17152) | 2.8 | | Running 9 mph (12110) | 13.0 |
| Walking 2.5 mph firm level (17170) | 3.0 | | Running 10 mph (12120) | 14.8 |
| Walking 2.8-3.4 mph moderate (17190) | 3.8 | | Running 12 mph (12132) | 18.5 |
| Walking 3.5-3.9 mph brisk (17200) | 4.8 | | Running uphill 6 mph 5 % (12260) | 13.3 |
| Walking 4.0-4.4 mph very brisk (17220) | 5.5 | | Jogging, general (12020) | 7.5 |
| Walking 4.5-4.9 mph (17230) | 7.0 | | Bicycling <10 mph leisure (01010) | 4.0 |
| Walking, treadmill 3.0-3.4 mph 0 % (17355) | 3.8 | | Bicycling 10-11.9 mph (01020) | 6.8 |
| Walking, to work/class (17270) | 4.0 | | Bicycling 12-13.9 mph (01030) | 8.0 |
| Hiking, cross-country (17080) | 6.0 | | Bicycling 14-15.9 mph (01040) | 10.0 |
| Stair climbing, general (17131) | 6.8 | | Bicycling 16-19 mph racing (01050) | 12.0 |
| Backpacking (17010) | 7.0 | | Stationary bike 50 W (01214) | 4.0 |
| Swimming freestyle slow (18240) | 5.8 | | Stationary bike 90-100 W (01220) | 6.0 |
| Swimming freestyle fast (18230) | 9.8 | | Stationary bike 126-150 W (01228) | 8.0 |
| Swimming crawl ~50 yd/min (18290) | 8.0 | | Stationary bike 200-229 W (01236) | 10.8 |
| Swimming crawl ~75 yd/min (18280) | 10.5 | | Stationary bike 230-250 W (01240) | 12.5 |
| Swimming backstroke rec / training (18255/18250) | 4.8 / 9.5 | | Stationary bike >325 W (01248) | 16.3 |
| Swimming breaststroke rec / training (18265/18260) | 5.3 / 10.3 | | Spin class (01270) | 9.0 |
| Swimming butterfly (18270) | 13.8 | | HIIT cycling (01305) | 8.8 |
| Water aerobics (18355) | 5.5 | | HIIT, moderate effort (02210) | 7.0 |
| Rowing ergometer <100 W / 100-149 W / >=200 W (02071/02072/02074) | 5.0 / 7.5 / 14.0 | | HIIT burpees/Tabata (02214) | 11.0 |
| Elliptical moderate / vigorous (02048/02049) | 5.0 / 9.0 | | Circuit training incl. kettlebells (02040) | 7.5 |
| Resistance, multiple exercises 8-15 reps (02054) | 3.5 | | Resistance, squats/deadlift (02052) | 5.0 |
| Resistance, vigorous / powerlifting / bodybuilding (02050) | 6.0 | | Resistance, circuit/supersets (02055) | 5.8 |
| Calisthenics moderate / vigorous (02022/02020) | 3.8 / 7.5 | | Jump rope (02068) | 11.0 |
| Yoga hatha (02150) / power yoga (02160) | 2.3 / 4.0 | | Pilates general (02105) | 2.8 |
| Soccer casual / competitive (15610/15605) | 7.0 / 9.5 | | Basketball game (15040) | 8.0 |
| Tennis singles (15690) / doubles (15680) | 8.0 / 6.0 | | Badminton social / competitive (15030/15025) | 5.5 / 9.0 |
| Golf walking, carrying clubs (15265) | 4.3 | | Golf with cart (15290) | 3.5 |
| Boxing sparring (15120) | 7.8 | | Martial arts moderate pace (15430) | 10.3 |
| Rock climbing low-moderate (15537) | 5.8 | | Volleyball (15710) | 4.0 |
| Zumba (02310) | 6.5 | | Aerobic dance low / high impact (02005/02006) | 4.8 / 8.0 |

Sedentary anchors used by the 02 module baseline: sitting 1.0-1.5, standing 1.3-1.5, office work 1.3-1.5 (Compendium 07/11).
Compendium cycling-by-watts rows imply a gross metabolic power of `206 W + 3.85 x P` for a 75 kg reference person (R2 = 0.99, 11 rows, **PROPOSED FIT**;
net efficiency 26 %; baseline = 2.4 x RMR): 50 W -> 4.0 MET, 100 W -> 6.4, 150 W -> 8.0, 215 W -> 10.8, 250 W -> 12.5, 325 W -> 16.3.

#### 4.1.3 Net vs gross, corrected METs
- **Gross** = total energy during the bout. **Net above resting** = gross - RMR/1440 x minutes. **Increment to TDEE** = net - energy the person would have spent
  on displaced sedentary time (0.2-0.5 x RMR/min; `displacedBaselineMET` default 0.2 x RMR, **PROPOSED**; keeps 02's PAL baseline from double counting).
- The 1-MET = 3.5 ml/kg/min convention overstates true resting VO2: 2.6 +/- 0.4 ml/kg/min (0.84 kcal/kg/h) in 769 adults (642 F, 127 M, 18-74 y, 35-186 kg); i.e. 3.5 is +35 % too high on average, more in obese/old people [Byrne05].
  Standard METs under-estimate individually-referenced METs 89 % of the time and misclassify intensity 12.2 % of the time (worse in women, overweight, old, unfit) [Herrmann24-corrMET] (source: Kozey 2010, cited there).
- **Corrected MET** = `MET_std x 3.5 / VO2rest_indiv`, `VO2rest_indiv = RMR_kcal_day / 1440 / 5 x 1000 / mass` (Compendium uses Harris-Benedict; use module 02's RMR instead)
  [Herrmann24-corrMET]. Worked examples (my arithmetic with Harris-Benedict as the Compendium prescribes): 35-y man 175 cm 75 kg: RMR 1737 -> VO2rest 3.22 -> factor 1.09;
  55-y woman 165 cm 85 kg: RMR 1516 -> VO2rest 2.48 -> factor 1.41.
- **Important implementation point:** corrected METs change classification and net cost, **not gross kcal**: `MET_c x RMR/1440` equals `MET_std x 3.5 x mass x 5/1000` identically.
  Only when the *measured* mass-specific VO2 of an activity differs (e.g., obese walking +10 %/kg [Browning06]) does gross change.
- Body-composition modifiers: net metabolic rate of walking per kg is ~10 % higher in class-II obese vs normal-weight adults and ~10 % higher in women than men (39 adults, 0.5-1.75 m/s) [Browning06].
  For cycling/rowing use power (not mass) as the driver (4.1.6).

#### 4.1.4 Walking: equations, per-km and per-step cost
Equations (speed S m/min, V m/s, grade G as fraction, H height m):
- **ACSM walking** (validated 50-100 m/min): `VO2 = 0.1 S + 1.8 S G + 3.5` ml/kg/min (worked examples confirmed in [TTU13]; constants also in [Hall04]).
  ACSM under-predicts most literature values (127 population means, 0.4-1.9 m/s; SEE 4.51 vs 1.13 ml/kg/min for the height-weight-speed model) [Ludlow16], mean error 18 +/- 13 % vs 8 % [Weyand13].
- **Recommended level walking (Ludlow & Weyand 2016):** `VO2_total = VO2_rest + 3.85 + 5.97 V^2 / H` (ml/kg/min; VO2_rest = the person's resting VO2, ~3.2 ml/kg/min for a 75 kg adult; R2 0.90 vs 0.63 for
  one-component models) [Ludlow16]. Speed/grade/load extension: walking VO2 rises in proportion to load and support-force requirements; RMSD SEE 1.06 ml/kg/min for 90 speed/grade/load conditions [Ludlow17].
  A military-age graded-walking equation exists (LCDA; SEE 0.42 W/kg incl. -40..+45 % grade) but coefficients not retrieved [Looney19].
- **Grade multiplier (recommended for |G| > 0.02):** ratio of the Minetti cost polynomial to its level value, `Cw(G) = 280.5 G^5 - 58.7 G^4 - 76.8 G^3 + 51.9 G^2 + 19.6 G + 2.5` J/kg/m [Minetti02].
  **Coefficients are recalled from the paper (not re-read): UNVERIFIED-COEFFS**; they reproduce the paper's reported end-points within 4 % (Cw(+0.45) = 17.6 vs 17.33; Cw(-0.45) = 3.61 vs 3.46 J/kg/m).
  Reported: minimum walking cost 1.64 J/kg/m at 1.0 m/s level, 17.33 at +45 %, 0.81 at -10 %, 3.46 at -45 % [Minetti02]. ACSM's 1.8 S G term is the simple alternative (over-predicts uphill vs Minetti by ~30 % at 5 %, my comparison).

**Per-km cost, net (above supine rest) kcal/kg/km at 5 kcal/L** (my calculation from the equations; heights 1.6/1.7/1.8 m):

| speed km/h | ACSM (0.1 ml/kg/m) | Ludlow-Weyand H 1.6 / 1.7 / 1.8 | Compendium (MET-1)/speed |
|---|---|---|---|
| 3.0 | 0.50 | 0.64 / 0.63 / 0.62 | ~0.50 (4.0 km/h, 3.0 MET) |
| 4.0 | 0.50 | 0.63 / 0.61 / 0.60 | 0.50 |
| 5.0 | 0.50 | 0.66 / 0.64 / 0.62 | 0.56 (3.8 MET) |
| 5.6 | 0.50 | 0.69 / 0.66 / 0.64 | ~0.60 |
| 6.4 | 0.50 | 0.73 / 0.70 / 0.67 | ~0.64 (4.8 MET at 5.95 km/h) |

Recommended: Ludlow-Weyand with the person's own height and speed (net 0.61-0.66 kcal/kg/km at 4-5 km/h, ~0.70 at 6.4 km/h); Compendium is the fallback (0.50-0.56 at 4-5 km/h with 1 kcal/kg/h per MET, 5 % more with 1.05). The two agree to ~10 % in gross terms (75 kg at 5 km/h: 299 vs 299 kcal/h) and differ mainly in what is subtracted as 'rest'. Gross = net + `VO2rest x mass x minutes` (~+0.8 kcal/kg/h).

**Per-step cost** (derive step length `SL = 0.415 H` and cadence c ~ 110 steps/min; **PROPOSED**: 0.415 H gives 100 spm at ~1.2 m/s for H 1.70 m, consistent with 100 spm = moderate walking [Tudor-Locke11]);
`net kcal/step/kg = [3.85 + 5.97 V^2/H] / c x 5/1000`, V = SL x c/60. Result - **net kcal per 1000 steps** (Ludlow, cadence 110):

| height \ mass kg | 55 | 65 | 75 | 85 | 95 | 110 |
|---|---|---|---|---|---|---|
| 1.55 m | 23 | 27 | 31 | 36 | 40 | 46 |
| 1.65 m | 24 | 28 | 33 | 37 | 41 | 48 |
| 1.75 m | 25 | 29 | 34 | 38 | 43 | 49 |
| 1.85 m | 26 | 30 | 35 | 40 | 44 | 51 |
| 1.95 m | 26 | 31 | 36 | 41 | 46 | 53 |

Gross (adds 3.5 ml/kg/min while walking): 1.75 m: 33 / 40 / 46 / 52 / 58 / 67. **Rule:** net = 0.44 x mass kcal/1000 steps (range 0.36-0.50 x mass), gross = 0.61 x mass; nearly cadence-independent (75 kg, 1.70 m: 32.6-34.8 kcal for 80-130 spm).
ACSM would give 26 kcal (net) for the same person (-20 %). Cross-check: Compendium brisk 3.8 MET x 75 kg x 1 h = 285 kcal gross for ~5 km/h = ~6,900 steps -> 41 kcal/1000 steps gross (this table: 46). Obese: +10 %/kg [Browning06].
Steps are only part of daily movement; do not double count with 02's PAL baseline (4.14).

#### 4.1.5 Running
- **ACSM running:** `VO2 = 0.2 S + 0.9 S G + 3.5` (>=134 m/min, or >=80 m/min when jogging) [TTU13]; good agreement with measured energy at 2.82 m/s [Hall04]; less precise than newer models for level running (RMSD 1.82 vs 1.27-1.44 W/kg) [Looney26].
- Net cost ACSM = 0.2 ml/kg/m = **1.0 kcal/kg/km**. Measured/derived alternatives: Compendium (MET-1)/speed = 0.83-0.91 (6.6-12.9 km/h) [Herrmann24, my calc]; Minetti level cost 3.4 +/- 0.24 J/kg/m = 0.81 kcal/kg/km, speed-independent in 10 trained runners [Minetti02];
  cost of transport rises 9.6-12.8 % between 3.58 and 5.14 m/s in sub-elite runners, linear in "average" runners [Batliner18].
  **Default: net 0.90 kcal/kg/km (efficiency factor 0.9 x ACSM), range 0.80-1.00** (`runEff` 0.85-1.0; PROPOSED central value).
- Grade: `Cr(G) = 155.4 G^5 - 30.4 G^4 - 43.3 G^3 + 46.3 G^2 + 19.5 G + 3.6` J/kg/m [Minetti02] (**UNVERIFIED-COEFFS**; end-point check: Cr(+0.45) = 19.4 vs 18.93; Cr(-0.20) = 1.80 vs 1.73; Cr(-0.45) = 4.03 vs 3.92). Downhill running is ~half-cost at -10..-20 %; steep downhill rises again.
- **Grade multipliers (net cost relative to level; Minetti polynomial ratio, UNVERIFIED-COEFFS; ACSM ratio for comparison)**:

| grade | -20 % | -10 % | -5 % | 0 | +5 % | +10 % | +15 % | +20 % |
|---|---|---|---|---|---|---|---|---|
| walking (Minetti) | 0.43 | 0.45 | 0.66 | 1.00 | 1.44 | 1.96 | 2.54 | 3.15 |
| running (Minetti) | 0.50 | 0.60 | 0.76 | 1.00 | 1.30 | 1.66 | 2.06 | 2.50 |
| walking (ACSM 1 + 18 G) | < 0 | < 0 | 0.1 | 1.00 | 1.90 | 2.80 | 3.70 | 4.60 |
| running (ACSM 1 + 4.5 G) | 0.10 | 0.55 | 0.78 | 1.00 | 1.23 | 1.45 | 1.67 | 1.90 |

  ACSM's vertical term goes negative downhill (physically wrong) and over-predicts uphill walking ~30 % at 5 %; Minetti under-predicts uphill running vs newer models (RMSD 2.18 vs 1.41-1.45 W/kg) [Looney26] - keep grade within +/-15 % and widen the band to +/-25 %.
- Energy-equation choice matters up to 5.2 % (10 published VO2/VCO2 -> kcal equations) [Kipp18]; use `kcalPerLO2(RQ)` above.
- Mass-specific: a 75 kg runner at 10 km/h for 30 min: net ~330 kcal (eff 0.9) / ~365 (ACSM); Compendium (10 MET) gross 394, net 357 (my calc).
- Example table, net kcal per km: 60 kg 54; 75 kg 68; 90 kg 81; 110 kg 99 (at 0.90 kcal/kg/km). Running net cost per km is ~1.4-1.7 x walking (ratio of the defaults above); measured gross energy for 1600 m was 471 vs 373 kJ (run at 160 m/min vs walk at 86 m/min; 30 adults, 71 kg, VO2max 41.5) i.e. 1.26 x [Wilkin12].

#### 4.1.6 Cycling, swimming, rowing, elliptical, sport
- **Cycling with power:** gross metabolic power `= 2.4 x RMR_W + P / 0.26` (**PROPOSED FIT** to 11 Compendium stationary-cycling rows, R2 = 0.99; 100 W -> ~8.4 kcal/min for a 75 kg adult).
  Ettema & Loras: energy expenditure is linear in work rate (Fenn effect), ~91 % of variance from work rate; gross efficiency therefore rises with power because the zero-load cost is diluted [Ettema09] (absolute efficiency values not in abstract; UNVERIFIED).
  ACSM leg ergometry: `VO2 = 1.8 x W_kgm/min / mass + 7` (ml/kg/min) [TTU13] - 100 W, 75 kg -> 474 kcal/h (my calc; 6 % below the Compendium fit of 506 kcal/h).
  Outdoor cycling by speed: use Compendium MET rows (10-11.9 mph 6.8 ... 16-19 mph 12.0); e-bike 4.0-6.8; mountain 8.5-16.
- **Swimming:** Compendium METs only (freestyle 5.8 slow ... 14.5 elite, table 4.1.2). Cost per distance is far higher than on land because drag/propelling efficiency are worse; differs by stroke, sex, skill [Zamparo20]. Add +/-25 % skill uncertainty band; no validated buoyancy-by-adiposity correction (UNVERIFIED) - skip.
- **Rowing / elliptical / stair machines:** Compendium (ergometer 5.0-14.0 by watts; elliptical 5.0/9.0; stair treadmill 9.3).
- **Team/racquet sport:** Compendium METs as listed (the 'casual/general' rows already average play and rest); use a +/-25 % band because duty cycle varies widely.

#### 4.1.7 Resistance-training session cost
- Compendium: 3.5 MET (8-15 reps varied resistance, multiple exercises), 5.0 (squat/deadlift), 5.8 (circuit/supersets), 6.0 (vigorous/powerlifting/bodybuilding) [Herrmann24]. Default **4.0 MET for a 60-min moderate-rest session (range 3.0-6.0)**, applied to *session duration* including rest.
- Measured: 70-min circuit, 4 x 10 exercises at 70 % 1RM = 448 +/- 21 kcal gross (men, ~80 kg; ~4.6 MET) vs 49 min cycling at 70 % VO2max = 546 +/- 16 kcal; 24-h EE and macronutrient oxidation were similar between the two [Melanson02].
  Single-set ACSM protocol (8 exercises x 15RM) = 3.9-4.2 MET, 135 kcal (men), 82 kcal (women) [Phillips03]. Sets are anaerobic: indirect calorimetry underestimates RT cost; a 166-study review found "widely varying" values and recommends METs/lactate-corrected estimates [Mitchell24].
  Working-set cost is 3-10 kcal/min at 12-24 % 1RM and > 20 kcal/min at 80 % 1RM in leg exercises (exhaustive sets only) [Reis17].
- EPOC after RT is small on average: two hard sessions (10,000 and 20,000 kg volume; 247 and 484 kcal during) produced no significant RMR elevation at 12-48 h [Abboud13] (see 4.2).
  Long-term RT adds ~+96 kcal/d RMR (95 % CI 45-147; mostly via FFM) [MacKenzie-Shalders20]; belongs to modules 02/09.

#### 4.1.8 Wearables and calories-burned displays
No consumer wrist device achieved < 20 % median EE error (Apple Watch best, Samsung worst; walking worst, cycling best; higher error with higher BMI) [Shcherbina17]. The app should show **ranges** (+/-15 % for equations, +/-25 % for sport/swim/RT).

**Evidence grade (4.1): A** for METs/units and ACSM/Ludlow equations (published, validated against calorimetry); **B** for per-step derivations (my arithmetic on a validated equation) and running default; **C** for sport duty-cycle and RT MET choice.

#### Parameter table 4.1
| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| MET_ref | 3.5 | ml/kg/min | resting truth 2.6 +/- 0.4 | [Herrmann24][Byrne05] |
| walkNet | 3.85 + 5.97 V^2/H | ml/kg/min above supine rest | SEE 1.13 | [Ludlow16] |
| runNet | 0.2 x 0.9 | ml/kg/m | 0.16-0.20 | [TTU13][Minetti02][Herrmann24] |
| cycleBaseline | 2.4 | x RMR | R2 0.99 | PROPOSED FIT to [Herrmann24] |
| cycleEff (net) | 0.26 | - | 0.23-0.28 | PROPOSED FIT |
| RT MET | 4.0 | METs over session | 3.0-6.0 | [Herrmann24][Melanson02] |
| stepsNet | 0.44 | kcal/kg/1000 steps | 0.36-0.50 | derived from [Ludlow16] |
| obesityWalkFactor | 1.10 | x per kg | 1.05-1.15 | [Browning06] |
| kcalPerLO2 | 4.686 + 1.232 (RQ-0.707) | kcal/L | - | [Manini10] |

### 4.2 EPOC (excess post-exercise oxygen consumption)

**Mechanism.** After exercise VO2 stays above resting (rapid component: O2-store/PCr/lactate/temperature/ventilation, minutes; prolonged component: triglyceride-fatty-acid cycling, substrate shift, hours).
Magnitude is curvilinear in intensity and ~linear in duration at high intensity; small or absent after low-intensity or short exercise; faster return to rest in trained people [Borsheim03].

**Quantitative anchors**
- Review of controlled studies: prolonged EPOC (3-24 h) needs >= 50 min at >= 70 % VO2max or >= 6 min at >= 105 % VO2max; even then EPOC = **6-15 % of the net O2 cost of the exercise**; "earlier optimism about EPOC and weight loss is generally unfounded" [LaForgia06].
- Metabolic chamber, 10 men, 45 min cycling at 72.8 +/- 5.8 % VO2max: net exercise cost 519 +/- 61 kcal; +190 kcal above resting over the following 14 h (= +37 %, upper outlier) [Knab11].
- Systematic review (22 studies): short-duration (<= 3 h) EPOC ~101 kJ (24 kcal) after moderate continuous vs ~136 kJ (33 kcal) after HIIE; sprint interval ~241 kJ (58 kcal) vs 151 kJ (36 kcal) after MICE; long-duration (> 3 h) EPOC 289 kJ (69 kcal) HIIE vs 159 kJ (38 kcal) MICE [Panissa21].
- 8 active men, 2-h post period: EPOC 8.6 +/- 4.7 L (30 min at 85 % VO2max; ~43 kcal at 5 kcal/L) and 10.0 +/- 4.2 L (4 x 30-s sprints; ~50 kcal), both greater than after 30 min at 65 % VO2max; fat oxidation post-exercise was highest after SIT (+0.115 g/min) [Islam18].
- One 4-6 x 30 s Wingate bout in a whole-room calorimeter raised TDEE by 946 +/- 62 kJ/d (~226 kcal, ~+10 %), RMR next morning unchanged [Sevits13].
- Walking/running 1600 m in 30 adults: post-exercise EE returned to resting within ~10 min (walk) and 15 min (run) [Wilkin12].
- Resistance: two hard RT bouts (85 % 1RM; 10,000 vs 20,000 kg) gave no significant RMR elevation 12-48 h [Abboud13]; a review notes more prolonged EPOC after hard vs moderate RT but no dose-response [Borsheim03].
- 24-h chamber, aerobic vs weights (49 min cycling vs 70 min circuit): comparable 24-h EE; post-exercise periods did not differ from control [Melanson02].

**Model (PROPOSED FIT to the anchors above).**
`epocKcal = phi x netKcal`, with
`phi = max(phiFloor, phiMax x S(x) x Dfac(dur))`,
`S(x) = 1 / (1 + exp(-(x - 0.68)/0.06))` (x = relative VO2 fraction), `Dfac = min(1, dur/45)^0.7`, `phiMax = 0.15` (continuous) or 0.20 (intervals incl. sprint), `phiFloor = 0.02`, capped at 0.15 (0.20 intervals) except a user-visible "unusual" flag for the Knab-type outlier (0.37).
| Session | phi (default) | plausible range | anchor |
|---|---|---|---|
| walking / light < 50 % VO2max | 0.02 | 0-0.04 | [Wilkin12][LaForgia06] |
| moderate 50-65 %, 30-60 min | 0.04-0.06 | 0.02-0.08 | [Borsheim03] |
| vigorous continuous 70-85 %, >= 45 min | 0.10-0.14 | 0.06-0.15 (outlier 0.37) | [LaForgia06][Knab11] |
| HIIT (work >= 85 %) | 0.10-0.15 | 0.06-0.25 | [Panissa21] |
| SIT (4-6 x 30 s) | absolute 40-60 kcal per session | | [Islam18][Panissa21] |
| resistance training | 0.05 | 0-0.10 | [Abboud13][Melanson02] |
Kinetics (PROPOSED, consistent with "minutes" for light exercise and 14 h for very hard exercise): `EPOC(t) = epocKcal x [a1 exp(-t/tau1) + (1-a1) exp(-t/tau2)]`, vigorous: a1 = 0.6, tau1 = 0.4 h, tau2 = 4 h (remaining: 36 % at 1 h, 25 % at 2 h, 5 % at 8 h, 1 % at 14 h);
light: a1 = 1, tau1 = 0.15 h (returns to baseline in 10-15 min [Wilkin12]). Trained individuals: tau x 0.75 [Borsheim03].

**Marketing vs reality.** A 30-min HIIT session (~300 kcal gross, ~250 net) yields ~25-40 kcal EPOC (about 10-15 % of the session's net cost). "Afterburn hundreds of calories" is only seen after ~45 min at ~73 % VO2max (Knab: +190 kcal) or very long sessions.
**Evidence grade: A-/B** (LaForgia 2006 review + several chamber studies; kinetics C). Small studies, mostly young men.

### 4.3 Energy compensation: how much exercise energy becomes extra TDEE?

**Mechanisms.** (a) *Metabolic/expenditure-side*: non-exercise energy expenditure (BMR, NEAT, other) falls as activity rises (constrained-TEE model). (b) *Behavioural/intake-side*: appetite, food reward, hunger rise (leptin down, acyl-ghrelin up) so people eat more.
(c) *Misestimation*: the 3500-kcal/lb (7700 kcal/kg) rule and prescribed-vs-actual exercise energy overstate the expected deficit [Thomas12]. Three definitions coexist: weight-based (expected vs observed body-energy change), TEE-based (extra TDEE vs exercise energy),
intake-based (extra intake) - do not mix them when calibrating.

**Evidence (human, quantitative)**
| Study | Design | Result |
|---|---|---|
| Pontzer 2016 [Pontzer16] | DLW TEE vs accelerometer, n = 332 adults, 5 populations | TEE rises with activity below a change-point of **230 counts/min/d (95 % CI 44-428)** (TEE_adj = 1.12 x CPM + 2336 kcal/d), plateaus at ~2600 kcal/d above (slope 0.21 +/- 0.35, p = 0.54, n = 92); RMR uncorrelated with activity; above ~219 CPM each +100 CPM gives < 50 kcal/d |
| Careau 2021 [Careau21] | IAEA DLW database, n = 1,754 adults (PAL 1.74 +/- 0.27; 90 % 1.35-2.18; FFM 24-97 kg; BMI 12.5-61.7) | TEE-on-BEE slope 0.723 +/- 0.049 (CI 0.626-0.820) => **27.7 % compensation**; AEE-on-BEE slope -0.349 +/- 0.044; compensation **29.7 % at the 10th BMI percentile vs 45.7 % at the 90th**; no sex or age effect; within-person (n = 68, 70-90 y, 7-y repeat) b_within 0.15 +/- 0.17 (almost full compensation) - cross-sectional, adjusted for FFM/FM/age/sex |
| Thomas 2012 [Thomas12] | systematic review; energy-balance analysis of exercise trials | most low weight loss = low prescribed doses + increased intake; RMR 7 % below FFM-predicted (bias -81 kcal/d, CI -148 to -13) in one confined isocaloric study (Bouchard); ~92 % (12/13) of half-marathon-trainees increased intake; energy-balance calc from body composition agreed with chamber within 80-145 kcal/d |
| Riou 2015 [Riou15] | 61 studies, n = 928, compensation = body-energy change / exercise EE | overall mean 18 % +/- 93 %; explained by fat mass x age x duration; compensation approaches 84 % by ~80 wk (extrapolation); sex, frequency, intensity, dose not predictors |
| Flack 2018 [Flack18] | 12 wk, 36 overweight adults, 300 vs 600 kcal/session x 5 d/wk (1500 vs 3000 kcal/wk) | compensation 943 (CI -164..2050) and 1007 (32..1982) kcal/wk = **62.9 % vs 33.6 %** of exercise EE; RMR and EI (self-report) unchanged; acyl-ghrelin up, GLP-1 and food reinforcement down; only 3000 kcal/wk reduced fat |
| Flack 2020 [Flack20] | 12 wk, 6 vs 2 sessions/wk (2753 vs 1491 kcal/wk) | ~50 % compensated regardless of dose; leptin AUC fall predicted less compensation; REE/RQ changes did not contribute |
| E-MECHANIC 2019 [Martin19] | 24 wk RCT, n = 198 (171 analysed), BMI 31.5, 8 vs 20 kcal/kg/wk (KKW) | weight compensation **1.5 kg (8 KKW) and 2.7 kg (20 KKW)**; DLW energy intake **+90.7 kcal/d (CI 35-146) and +123.6 kcal/d (64-183)** vs -2.3 in control; RMR and non-exercise PA unchanged |
| Broskey 2021 [Broskey21] | E-MECHANIC ancillary, n = 42, DLW + chamber | 20 KKW: weight loss -2.1 kg (half of expected); free-living TDEE +~4 % (attributed to exercise); chamber 24-h EE -~4 %; intake-balance EI unchanged |
| Flanagan 2024 [Flanagan24] | E-MECHANIC, DLW + chamber | 48 % showed "exercise-related energy compensation" (TDEE shortfall -308 +/- 158 kcal/d) with **no change in sleeping/resting/24-h EE**; ExEC correlated with baseline TDEE (r = -0.50) |
| MET-2 [Donnelly13][Washburn15][Willis14][Herrmann15] | 10 mo, 141 young overweight adults, 400 vs 600 kcal/session x 5 d/wk, supervised | weight -3.9 +/- 4.9 kg and -5.2 +/- 5.6 kg vs +0.5 kg control (static-rule expectation ~11 and ~17 kg => ~35 and ~31 % realised; my arithmetic); mean EI, RMR, NEPA and NEEx unchanged; 40 responders / 34 non-responders; non-responder men ate more and moved less; women ate more at 600 kcal at 3.5 and 7 mo |
| Fedewa 2017 [Fedewa17] | 10 RCTs, 44 effects | NEPA does not change with training (ES 0.02, CI -0.09..0.13); initial NEPA dip attenuates with time |
| MacKenzie-Shalders 2020 [MacKenzie-Shalders20] | 18 RCTs | aerobic RMR +82 kcal/d (CI -58..221, n.s.); resistance +96 kcal/d (45-147) |
| Westerterp 2013/2017 [Westerterp13][Westerterp17] | reviews | contrary/additive evidence: in untrained subjects exercise raises TEE by more than the training cost; PAL for sustainable lifestyles 1.1-1.2 to 2.0-2.5; professional endurance athletes ~4.0 |
| Ross 2000 [Ross00] | 3 mo RCT, 52 obese men | exercise-induced deficit produced weight loss (-7.5 kg) equal to diet-induced loss; achieved energy imbalance (-701 kcal/d) matched prescribed exercise energy (-700 kcal/d) in these men [Thomas12] - i.e., near-full expression when exercise is supervised and intake is monitored |
| Acute ad libitum meals [Schubert13][Deighton14] | 29 studies/51 trials | after a single bout, absolute intake unchanged (ES 0.14, CI -0.005..0.29); relative intake -1.35 SD: **no same-day food compensation** |

**Contested.** Constrained model (Pontzer/Careau) vs additive models; the strongest human intervention data (E-MECHANIC) support *intake* compensation with **no** RMR/NEAT change, whereas Careau's DLW regression is mostly between-person.
No single split is identifiable from weight-based totals (I tested four parameter sets - c_met 0/0.10/0.15/0.28 with matching appetite terms: all reproduce total compensation of 40-65 %).

**Recommended model (metabolic and appetite parts separately)**
Let `Enet` = 7-day mean of net exercise energy above baseline (kcal/d; includes step increment above the lifestyle baseline).
1. Expenditure (metabolic) part: `dTDEE_comp = -c_met(BMI) x Enet`, applied as a reduction of *non-exercise* EE (RMR/NEAT, implemented as `dRMR` in 02), first-order lag tau = 14 d (PROPOSED), capped at -5 % of RMR (Thomas12: -7 % in one confined study; MET/E-MECHANIC: 0 %).
   `c_met = 0.15` default; sensitivity range 0-0.28 [Careau21]; adiposity modifier `c_met = 0.15 + 0.010 x clamp(BMI - 25, -5, 8)` (PROPOSED: anchors Careau 29.7 % vs 45.7 % between 10th and 90th BMI percentile; the BMI values of those percentiles are UNVERIFIED (I assume ~20 and ~33; median 25.2)).
2. Appetite (intake) part: `apComp = A_max x (1 - exp(-Enet / K))`, `A_max = 100 kcal/d`, `K = 150 kcal/d`, lag tau = 28 d (lag PROPOSED, grade D).
   Reported to module 12 as extra hunger/drive; in an "ad libitum" schedule mode it becomes extra intake; with user-fixed intake it lowers energy availability/adherence and raises `hunger`.
   Fitted to: E-MECHANIC +91 kcal/d at ~105 kcal/d exercise and +124 kcal/d at ~263 kcal/d; Flack 2018 total compensation 135 and 144 kcal/d at 214 and 429 kcal/d.
3. Acute (same-day) compensation: none for steady endurance exercise; after very-high-intensity intermittent exercise appetite/intake **falls** (Sim14: ad libitum EI lower after HI/VHI vs rest; active ghrelin lower).
4. Individual variability: intervention compensation SD ~90 % of the mean [Riou15]; expose a "compensator" random effect (`c_i ~ N(1, 0.6)`, truncated to [0, 2]) in Monte-Carlo runs; men non-responders ate more, women at high dose ate more [Herrmann15][Washburn15].
5. Validation of the recommended set (total compensation = 100 x (c_met x Enet + apComp)/Enet):
| Target | Observed | Model (c_met 0.15, A_max 100, K 150) |
|---|---|---|
| E-MECHANIC 8 KKW (Enet ~105) | 65 % (1.5 kg) | 63 % |
| E-MECHANIC 20 KKW (Enet ~263) | 47 % (2.7 kg) | 46 % |
| Flack 2018, 1500 kcal/wk | 63 % | 50 % |
| Flack 2018, 3000 kcal/wk | 34 % | 37 % |
| Flack 2020, 1491 / 2753 kcal/wk | 50 % / 50 % | 51 % / 39 % |
| Careau 28 % (TEE only) | 28 % | 15 % (range 0-28) |
Long-term drift (> 6 mo, Riou extrapolation to ~84 % at 80 wk) is **not** included by default (option `longTermDrift`, grade D).

**Evidence grade: B/C.** Multiple RCTs with DLW (grade B for total compensation 30-65 %); the metabolic-vs-appetite split is contested (C); adiposity modifier from one cross-sectional analysis (C); dynamics D.

### 4.4 Substrate utilisation during exercise (fat vs carbohydrate)

**Mechanism.** Fat oxidation (absolute g/min) rises with intensity to Fatmax then falls as glycolytic flux, catecholamines and reduced free carnitine/CPT-1 limit fatty-acid oxidation; fat contributes ~0 % of energy above ~85-90 % VO2max in trained cyclists [Achten02][vanLoon01]. Peripheral lipolysis is maximal at the lowest intensities, muscle-TG use appears only at higher intensities [Romijn93].

**Key measurements**
- 300 healthy adults (157 M/143 F, treadmill incremental test): MFO 7.8 +/- 0.13 mg/kg FFM/min at **48.3 +/- 0.9 % VO2max** (61.5 % HRmax); women higher (8.3 vs 7.4 mg/kg FFM/min; Fatmax 52 vs 45 %); MFO predicted by activity, VO2max and sex (R2 = 0.12) [Venables05].
- 18 moderately trained cyclists: Fatmax **64 +/- 4 % VO2max (74 % HRmax)**; Fatmax zone (within 10 % of peak) 55-72 % VO2max; fat oxidation negligible above 89 % VO2max [Achten02].
- 1121 athletes (933 M/188 F): MFO **0.59 +/- 0.18 g/min (0.17-1.27)** at **49.3 +/- 14.8 % VO2max (22.6-88.8 %)**; males 0.61 vs females 0.50 g/min absolute; > 50 % of variance unexplained by body composition/fitness [Randell17].
- Sex/age: MFO higher in young women than men, difference attenuated after age 45 y (435 adults) [Frandsen21]; in obesity MFO 0.27-0.33 g/min, FATmax 61-66 % HRpeak (meta-regression of 64 papers; HR is a more stable anchor than %VO2) [Chavez23].
- Training: 12 months of jogging/walking 3 x 45 min in 17 sedentary adults raised MFO 0.26 -> 0.33 g/min and its location 35 -> 50 % VO2max [Scharhag10].
- Keto-adapted ultra-endurance athletes (n = 10 vs 10 high-carb): peak fat oxidation **1.54 +/- 0.18 vs 0.67 +/- 0.14 g/min** at **70.3 vs 54.9 % VO2max**; fat 88 vs 56 % of energy at 64 % VO2max for 180 min; muscle glycogen use (-64 %) and repletion similar [Volek16]. Ketogenic LCHF in elite race walkers raised fat oxidation but **increased O2 cost/reduced economy** at race pace, negating the performance benefit [Burke17].
- Fed vs fasted: fasted exercise oxidises 3.08 g (CI 0.79-5.38) more fat per session; NEFA equal; glucose and insulin higher in the fed state (27 studies, n = 273) [Vieira16]; RQ 0.86 fasted vs 0.90 fed at 60 % VO2max (60 min) [Bachman16].

**Model (PROPOSED FIT).** Relative intensity `x = VO2_gross / VO2max` (0.2-1.0).
`RER(x) = max(0.707, RERlo + (1.10 - RERlo) x^n)` with `RERlo` (low-intensity RER: 0.75-0.86 depending on preset, 0.72 keto-adapted, +0.015 postprandial [range 0.01-0.04: Vieira16 implies ~+0.01-0.02, Bachman16's RQ 0.86 vs 0.90 is the upper bound]) and `n` (curve shape: 2.0 untrained ... 6.5 keto-adapted).
`fatOx (g/min) = VO2 x (1.695 - 1.701 min(RER,1))`, `choOx = VO2 x (4.210 RER - 2.962)` (x < 0.75) or `VO2 x (4.344 RER - 3.061)` (x >= 0.75), VO2 in L/min = `VO2max_L x x`, energy from `kcalPerLO2(RER)`. Above RER 1.0 the extra CO2 is buffer/anaerobic: treat energy above VO2max as anaerobic glycolysis (glycogen; 4.5).
Duration drift at 65-75 % VO2max: `dRER = -0.05 (1 - exp(-t/120 min))` (Coyle 1986: RER 0.85 -> 0.80 over 3 h [Coyle86]; PROPOSED).
Presets fitted to published (Fatmax, MFO) pairs, RER cap at 1.0, `rer_hi = 1.10`:
| Preset | VO2max (L/min) | RERlo | n | Fatmax | MFO (g/min) | Fat->0 at | anchor |
|---|---|---|---|---|---|---|---|
| untrained mixed | 3.2 | 0.75 | 2.0 | 48 % | 0.43 | 84 % | [Venables05] |
| moderately trained (cyclists) | 4.0 | 0.855 | 5.4 | 64 % | 0.52 | 90 % | [Achten02] |
| athletes (mean) | 4.2 | 0.75 | 2.1 | 49 % | 0.59 | 85 % | [Randell17] |
| high-carb elite | 4.7 | 0.795 | 3.05 | 55 % | 0.67 | 87 % | [Volek16] HC |
| keto-adapted elite | 5.3 | 0.715 | 6.5 | 70 % | 1.54 | 95 % | [Volek16] LC |
Non-identifiability: RERlo and n trade off; MFO scales with VO2max (a 4.7 L/min keto-adapted athlete gets 1.36 g/min at 70 %, about -1 SD of Volek's group). Interpolate parameters (not outputs) with training index and with the ketosis/adaptation state `a` from module 05.
Test vectors (fasted, fat g/min | fat % of energy | CHO g/min at x = 0.30 / 0.50 / 0.65 / 0.80):
- untrained: 0.35 (74 %) 0.31 | 0.43 (54 %) 0.90 | 0.35 (33 %) 1.70 | 0.10 (7 %) 3.00
- moderately trained: 0.29 (47 %) 0.77 | 0.46 (46 %) 1.32 | 0.52 (39 %) 1.92 | 0.37 (22 %) 3.11
- keto-adapted (VO2max 5.3 L/min): 0.76 (98 %) 0.08 | 1.25 (96 %) 0.18 | 1.51 (89 %) 0.51 | 1.38 (65 %) 1.85 (RER floor 0.715; 89 % fat at 65 % matches Volek's 88 % at 64 %)
- postprandial offset +0.015 RER at 60 % VO2max (trained): fat 0.51 -> ~0.46 g/min (60 min: 30.8 -> ~27.4 g, i.e. -3.4 g, matching Vieira's -3.08 g); +0.04 (Bachman upper bound) gives -9 g.
**Moderators:** sex (F +12 % fat ox per kg FFM, Fatmax +7 %-points; disappears with age > 45 y), training (MFO +27 % and Fatmax +15 %-points in 12 mo), diet (LCHF), feeding state, duration (fat share rises with time), obesity (lower MFO absolute, Fatmax at 61-66 % HR peak), circadian (evening MFO possibly higher; not universal [Rubio-Valles25]).
**Evidence grade: A** for the qualitative bell shape and diet/training/sex effects (large cross-sectional datasets, validated stoichiometry); **B** for parameter presets (fits to means; wide inter-individual SD).

### 4.5 Glycogen use during exercise (coordinate with 04)

**Mechanism.** Muscle glycogen is the dominant fuel at 65-100 % VO2max; use rises with intensity and starting content, falls with training (per unit work), running < cycling, women slightly less than men; plasma glucose/liver glycogen supply a growing share with duration. Module 04 owns the pools and re-synthesis; this module supplies the *demand* (g CHO/min) and the muscle-vs-blood split.

**Quantitative anchors**
- Resting vastus lateralis glycogen in men with normal CHO availability and VO2max 53 ml/kg/min: **462 +/- 132 mmol/kg dry mass**; high-CHO availability +102 (CI +/-47); low-CHO -253 (+/-30); +10 ml/kg/min VO2max: +29 (low), +67 (normal), +80 (high CHO) mmol/kg dm; small increases in females and gastrocnemius [Areta18]. 1 mmol glucosyl unit = 0.162 g glycogen, so 462 mmol/kg dm ~ 75 g/kg dm.
- Utilisation modifiers (meta-regression of 181 studies of cycling/running): +30 % VO2max intensity -> +87-134 mmol/kg dm more glycogen used at >= 23 min (small +41 at 5 min); +200 mmol/kg dm starting glycogen -> +104 at 116 min and +143 at fatigue; females -30 (+/-29); running -70 (+/-32) vs cycling; CHO ingestion and VO2max ~trivial [Areta18].
- 7 endurance-trained cyclists at 71 +/- 1 % VO2max to fatigue (3.02 h on placebo): vastus glycogen fell **51.5 +/- 5.4 mmol GU/kg wet/h in the first 2 h and 23.0 +/- 14.3 in the third hour**; RER 0.85 -> 0.80; fatigue with plasma glucose 2.5 mM; with CHO feeding +1 h duration at little further muscle glycogen use (5 mmol/kg/h) [Coyle86].
- Keto-adapted vs high-CHO elite runners: same relative muscle-glycogen depletion (-64 % after 180 min at 64 % VO2max) and repletion (-36 % of pre at 120 min recovery) [Volek16]: **low-carb adaptation does not spare glycogen** in trained athletes.
- Resistance exercise: six sets of leg extension degraded 47.0 +/- 6.6 (70 % 1RM) and 46.6 +/- 6.0 mmol/kg wet (35 % 1RM) of quadriceps glycogen when external work was equated (rate ~2x at 70 %) [Robergs91]; 3 leg exercises, ~39 min: 121 -> 88 mmol/kg wet (-27 %) on placebo vs 127 -> 110 (-14 %) with 1.0 + 0.5 g CHO/kg/10 min [Haff00].
- High-intensity intermittent exercise: large glycogen reductions after short durations, heterogeneous by fibre type (fast > slow) and subcellular compartment; whole-muscle averages can under-report fibre-level depletion [VighLarsen21].
- Liver: trained athletes do not have higher basal liver glycogen; CHO ingestion > 1.5 g/min prevents liver glycogen depletion in moderate exercise [Gonzalez16].

**Model (PROPOSED FIT; consistent with the anchors within 20-25 %).**
1. CHO oxidation demand `choOx(t)` (g/min) from 4.4 (includes duration drift).
2. Muscle fraction `f_mg(t) = 0.90 - 0.30 (1 - exp(-t/120 min))` (falls as plasma glucose/lactate oxidation and liver output take over; 0.90 at start, 0.67 at 3 h).
3. Availability throttle `a(g) = (g^2/(g^2 + 0.2^2)) / (1/(1 + 0.2^2))` with `g = G_muscle/G_rest` from module 04 (use rate falls to ~63 % at 25 % of resting glycogen, ~21 % at 10 %), and `RER` falls with the same `g` (Coyle: fatigue with RER 0.80).
4. `muscleGlycogenUse (g/min) = choOx x f_mg(t) x a(g)`; `liverGlycogen/glucose = choOx x (1 - f_mg)` (drawn from 04's liver pool and dietary glucose).
5. Local depletion (output to 04/UI): `D_loc = used_g / (workedMuscleMass_kg x 16 g/kg wet)`; worked-muscle mass ~ 20 kg for running/cycling (PROPOSED); resting concentration ~ 100-130 mmol GU/kg wet (16-21 g/kg wet) [Coyle86][Haff00][Areta18].
Test (trained, VO2max 4.6 L/min, x = 0.71, preset (0.855, 5.4), no throttle): choOx 2.6 -> 2.1 g/min; CHO 413 g and muscle glycogen 314 g in 3 h (by hour: 124, 101, 88 g) vs Coyle's ~126 mmol/kg wet total (~ a full ~420 g store in ~20 kg working muscle; my estimate). The model reproduces total 3-h depletion but **under-predicts the slowdown in hour 3 (0.78 vs 0.45)**; the throttle in step 3 (module 04) closes part of that gap.
Session presets (PROPOSED, grade D-C): 60-min run at 65 % VO2max, 75 kg: choOx ~100-120 g, muscle glycogen ~85-100 g; 30-min HIIT (~315 kcal gross, CHO ~70 % of energy incl. anaerobic): 45-55 g; 60-min moderate resistance session (4 MET, CHO ~60 %): ~40-50 g, with 25-35 % local depletion of worked muscle [Robergs91][Haff00].
**Evidence grade: B** for magnitudes at 65-75 % VO2max (Coyle, Areta meta-analysis), **C-D** for HIIT/RT whole-body glycogen use.

### 4.6 Fasted exercise and intensity: do they change fat loss at equal energy?

**Fasted vs fed aerobic exercise**
- Acute substrate: +3.08 g fat oxidised per session (CI 0.79-5.38; n = 27 studies, 273 participants); NEFA equal; glucose +0.78 mmol/L and insulin +105 pmol/L higher in the fed state [Vieira16].
- 24-h fat oxidation under energy-balanced chamber conditions: pre-breakfast 60-min exercise at 50 % VO2max raised 24-h fat oxidation to 717 +/- 64 vs 456 +/- 61 (control), 446 (afternoon) and 432 (evening) kcal/d in 10 young men [Iwayama15b]; 100 min at 65 % VO2max before breakfast gave 1142 kcal/d fat oxidation vs 609 kcal/d after lunch in 9 athletes, correlating with the transient energy/carbohydrate deficit (r = -0.72 / -0.40) [Iwayama15a]; post-absorptive exercise saved carbohydrate with no difference in 24-h EE [Shimada13].
  These are **substrate-partition** effects over 24 h under matched intake; they do not imply extra fat *loss* because energy balance is unchanged.
- Body-composition trials: 4 wk, 20 women, 1 h steady-state x 3/wk under a hypocaloric diet, fasted vs fed: both lost weight (p = 0.0005) and fat mass (p = 0.02), **no between-group differences** [Schoenfeld14]. Meta-analysis (5 studies, 96 participants): trivial to small effect sizes, trivial between-group effects on body mass, %fat, lean mass; authors urge caution due to few studies [Hackett17].
- Appetite: network meta-analysis of 17 papers: 24-h intake lower after fasted exercise without a post-exercise meal (-2095 kJ, CI -3910..-280), but hunger higher (+13-23 mm) and expenditure slightly lower; low confidence [Frampton22]; 12 active men: fasted 60-min run at 60 % VO2max cut 24-h intake (15,312 vs 19,172 kJ) [Bachman16].
**Model consequence:** fasted state affects only (i) RER offset (4.4), (ii) 24-h fat/carbohydrate partition (module 05/07), (iii) hunger drive (+small), and (iv) muscle-glycogen deficit -> signalling (4.9). **No direct fat-mass term.** Grade **B**.

**Intensity (HIIT/SIT vs MICT) at unmatched vs matched energy**
- 31 studies (>= 4 wk): within-group fat mass -1.38 kg (CI -1.99..-0.77) HIIT/SIT vs -0.91 kg (-1.45..-0.37) MICT; %fat -1.26 vs -1.48; no between-group differences; protocols with lower time/energy trended to favour MICT (p = 0.09); neither produced clinically meaningful fat loss over the short term [Keating17].
- 13 trials (overweight/obese 18-45 y, ~10 wk x 3/wk): equal fat-mass and waist reductions; HIIT ~40 % less time; **running** SMD -0.82 (HIIT) / -0.85 (MICT) fat mass but **cycling** trials produced no fat loss [Wewege17].
- Viana 2019 BJSM (36 studies): SIT/interval "28.5 % greater" absolute fat-mass reduction; carries an Expression of Concern (27 Jun 2019) - not used [Viana19][Viana19-EoC].
- HIIT vs MICT glycaemia/insulin resistance: HOMA-IR SMD -0.49 vs control and -0.35 vs continuous training; HbA1c -0.19 % vs control [Jelleyman15].
**Model consequence:** fat mass changes follow energy balance (module 01) with the exercise-energy term from 4.1-4.3; **no intensity multiplier on fat loss**. Intensity matters through EPOC (small, 4.2), appetite (very high intensity may transiently suppress hunger; 4.12), and fitness/mitochondria (4.8-4.9). Grade **A** (multiple meta-analyses, consistent).

### 4.7 Exercise and visceral / liver fat independent of weight loss (coordinate with 06)

**Mechanism.** Aerobic exercise preferentially mobilises visceral (VAT) and hepatic triglyceride via increased lipolysis/oxidation, reduced FFA flux to liver and improved insulin action, beyond what its energy deficit predicts.

**Evidence**
- 15 trials (852 subjects, no caloric restriction): VAT Hedges' g -0.497 (CI -0.655..-0.340); aerobic exercise of moderate or high intensity most effective; ~> 30 cm2 (women) / > 40 cm2 (men) CT reduction even at 12 wk [Vissers13].
- 117 studies (n = 4815): without weight loss exercise reduced VAT 6.1 % vs 1.1 % with diet; diet caused bigger weight loss (p = 0.04), exercise a trend to bigger VAT loss (p = 0.08); weight vs VAT correlation R2 0.74 after diet, 0.45 after exercise [Verheggen16].
- 35 RCTs: aerobic vs control ES -0.33 (CI -0.52..-0.14); resistance training vs control +0.09 (n.s.); AEx vs PRT direct (9 studies) ES 0.23 (p = 0.07 favouring AEx) [Ismail12].
- STRRIDE: in 6 months controls gained VAT +8.6 +/- 17.2 %; 11 miles/wk (walking or jogging) prevented gain; 20 miles/wk jogging reduced VAT -6.9 +/- 20.8 % and SAT -7.0 % without changes in intake [Slentz05].
- 4-wk cycling in 19 obese adults, no weight change: VAT -12 % (p < 0.01), hepatic TG -21 % (p < 0.05), plasma FFA -14 % [Johnson09].
- Liver: 12 trials, exercise vs control ES -0.37 (CI -0.06..-0.69) with minimal/no weight loss, no effect on ALT [Keating12]; 19 trials/745 participants: liver fat -2.85 % (HIIT, CI -4.86..-0.84) and -3.14 % (MICT, CI -4.45..-1.82) absolute vs control; HIIT = MICT (-0.34 %, CI -2.20..1.52); total minutes or exercise kcal not related to change [Sabag22].
- Counter-evidence: 220 adults with NAFLD, 150 min/wk moderate or vigorous-moderate for 12 months reduced intrahepatic TG by 3.5-5.0 % (absolute) but the effect was **largely mediated by weight loss** [Zhang16].
**Model (PROPOSED, grade B for VAT, B/C for liver).**
`extraVATloss (12 wk) = 0.06 x D_aer` where `D_aer = min(1, mem7d/150)` (moderate-equivalent min/wk; 4.8) - i.e. -6 % VAT beyond weight-proportional loss (range 0-12 %); sedentary control drift +8.6 %/6 mo if `mem7d < 60` and energy-balanced (Slentz).
`extraLiverFat (8-12 wk) = -0.25 x D_aer` (relative; conversion of -3 percentage points from a ~12 % baseline is my assumption; requires baseline liver fat >= 5 %); no intensity term; no extra effect from resistance-only training (ES +0.09) but 09/06 may add RT effects.
When weight loss > 5 % dominates (diet + exercise), do not stack: `extra = max(0, extra - 0.5 x weightLossEffect)` to avoid double counting with 06 (PROPOSED).

### 4.8 VO2max: baseline estimation, dose-response, time course, detraining

**Mechanism.** Aerobic training raises VO2max through central adaptations (blood/plasma volume, stroke volume; fast, days-weeks) and peripheral adaptations (capillarisation, mitochondrial content, a-vO2 difference; slower); haemoglobin mass is the strongest independent determinant of the training response [Montero17]. Gains depend on dose (volume x intensity), baseline fitness, and a heritable responsiveness.

**A. Baseline VO2max estimation (no test available)**
- Jackson 1990: `VO2max = 56.363 + 1.921 PAR - 0.381 age - 0.754 BMI + 10.987 sex` (ml/kg/min; sex men = 1, women = 0; PA-R 0-7; R2 0.61, SEE 5.7) [Jackson90][Peterman20]. %fat version: `50.513 + 1.589 PAR - 0.289 age - 0.552 %fat + 5.863 sex` (R2 0.66, SEE 5.35).
- Nes 2011 (HUNT): men `100.27 - 0.296 age + 0.226 PAI - 0.369 WC(cm) - 0.155 RHR` (R2 0.61, SEE 5.70); women `74.736 - 0.247 age + 0.198 PAI - 0.259 WC - 0.114 RHR` (R2 0.56, SEE 5.14); PAI = HUNT physical-activity index (scale not reproduced here; UNVERIFIED) [Peterman20][Nes11].
  Prediction equations track individual *changes* poorly (27 equations, 987 adults; SEE 4.1-6.1) - use only for baseline, not for updating state [Peterman20].
- PA-R (Jackson) scale 0-7 (verified from the instrument): 0 avoids walking/exertion; 1 walks for pleasure/stairs/occasional heavy breathing; 2 modest activity 10-60 min/wk; 3 > 1 h/wk modest activity; 4 runs < 1.5 km/wk (or < 30 min/wk comparable vigorous); 5 runs 1.5-8 km/wk (30-60 min/wk); 6 8-16 km/wk (1-3 h/wk); 7 > 16 km/wk (> 3 h/wk) [PAR-instrument].
  Mapping from the app's habitual activity: sedentary -> 0-1; light active (walks, no exercise) -> 2; regular moderate activity ~1-2 h/wk -> 3; 30-60 vigorous min/wk -> 4-5; 1-3 h vigorous/wk -> 6; > 3 h -> 7.
  Check: man 30 y, BMI 25, PA-R 3: 42.8 vs FRIEND median 42.4; woman 30 y BMI 23 PA-R 3: 33.4 vs FRIEND 30.2 (my arithmetic).
- Reference distribution (FRIEND 2015, treadmill, measured VO2max, apparently healthy US adults; percentiles 5/25/50/75/95, ml/kg/min) [Kaminsky15]:
| Age | Men 5th | 25th | 50th | 75th | 95th | Women 5th | 25th | 50th | 75th | 95th |
|---|---|---|---|---|---|---|---|---|---|---|
| 20-29 | 29.0 | 40.1 | 48.0 | 55.2 | 66.3 | 21.7 | 30.5 | 37.6 | 44.7 | 56.0 |
| 30-39 | 27.2 | 35.9 | 42.4 | 49.2 | 59.8 | 19.0 | 25.3 | 30.2 | 36.1 | 45.8 |
| 40-49 | 24.2 | 31.9 | 37.8 | 45.0 | 55.6 | 17.0 | 22.1 | 26.7 | 32.4 | 41.7 |
| 50-59 | 20.9 | 27.1 | 32.6 | 39.7 | 50.7 | 16.0 | 19.9 | 23.4 | 27.6 | 35.9 |
| 60-69 | 17.4 | 23.7 | 28.2 | 34.5 | 43.0 | 13.4 | 17.2 | 20.0 | 23.8 | 29.4 |
| 70-79 | 16.3 | 20.4 | 24.4 | 30.4 | 39.7 | 13.1 | 15.6 | 18.3 | 20.8 | 24.1 |
  The 2022 update (22,379 tests) lowered treadmill standards by 1.5-4.6 ml/kg/min; mean decline 13.5 % (4.0 ml/kg/min) per decade (treadmill), 16.4 % (4.3) cycle [Kaminsky22]. Earlier 2015 cohort: ~10 %/decade; men ~27 % higher than women overall [Kaminsky15]. Longitudinal decline in healthy adults accelerates from 3-6 %/decade (20s-30s) to > 20 %/decade (70s+) independent of activity [Fleg05]; cross-sectional ~10 %/decade regardless of activity, high-intensity training may halve the loss in young/middle-aged men [Hawkins03].
  Engine: sample 5-95 % from the age/sex row when the user gives "fitness feel"; sedentary reference `vSed` = 25th percentile (PA-R 0-1).

**B. Dose-response (PROPOSED FIT; data points listed)**
Define moderate-equivalent minutes `MEM = sum_min w(x)` with x = intensity relative to *current* VO2max: `w = 0` (x < 0.40), 0.4 (0.40-0.55), 1.0 (0.55-0.70), 1.5 (0.70-0.85), 3.0 per minute of interval work at >= 85-90 %, 0.3 per minute of recovery inside intervals.
`g*(MEM) = min(0.60, gMax x z x sexF x D(MEM))`, `D = MEM^2/(MEM^2 + 130^2)`, `gMax = 0.35` (fraction of V_sed), responsiveness `z ~ N(1, 0.5)` truncated [0.2, 2.0], `sexF = 0.95` (women; conflicting evidence), cap 0.60 (HERITAGE max +51 %).
Data used / checks:
| Study | Conditions | Observed | Model |
|---|---|---|---|
| HERITAGE [Bouchard99][Ross19] | n = 720 (481 in 1999 analysis), 20 wk, 3 x/wk, 55-75 % VO2max, 30-50 min, cycling | +384 +/- 202 ml/min = **+18 +/- 9 %** (range -5..+51 %, -114..+1097 ml/min); heritability of response 47 % | MEM ~130 -> +16.8 % at 20 wk |
| Time course [Hickson81] | 9 subjects, 40 min/d, 6 d/wk, fixed load | VO2max rose for 3 wk then plateaued; **t1/2 10.3 and 10.8 d**; +23 % over 9 wk with two load levels | fast pool tau 15 d (= t1/2 10.4 d) |
| 14 d x 60 min at 80 % VO2peak [Egan13] | 8 sedentary men | +17.5 +/- 3.8 % | +14.6 % |
| 6 HIIT in 2 wk (8-12 x 60 s at 100 % Wpeak) [Jacobs13] | 16 untrained | +8 % VO2peak | +5.7 % |
| Interval training meta-analysis [Bacon13] | 37 studies, 334 subjects, 6-13 wk, >= 3 d/wk | +0.51 L/min (CI 0.43-0.60); longer intervals +0.8-0.9 L/min | +11 % at 9 wk (~+0.4 L/min) |
| Meta-analysis [Milanovic15] | 28 studies, 723 adults (25 y, 40.8 ml/kg/min) | endurance training +4.9 +/- 1.4 ml/kg/min (~12 %); HIT +5.5 +/- 1.2; HIT vs ET +1.2 +/- 0.9; lower baseline fitness +3.2 (HIT) / +1.4 (ET); younger +2.4; longer +2.2-3.0 | ET at MEM ~150: 20 % (over-predicts) |
| DREW [Sisson09] | 310 postmenopausal women, 6 mo, 50 % VO2max 3-4 d/wk, 4/8/12 kcal/kg/wk | dVO2max +0.029 +/- 0.144, +0.088 +/- 0.129, +0.106 +/- 0.146 L/min (~2, 5, 6 %); non-response (dVO2max <= 0) 44.9 / 23.8 / 19.3 % | 1.5 / 5.2 / 9.4 % |
| STRRIDE [Duscha05] | 7-9 mo, 19 km/wk at 40-55 %, 19 km/wk at 65-80 %, 32 km/wk at 65-80 % | all groups improved; high amount/high intensity > low amount groups (p < 0.02) | ordering reproduced |
| Dose test [Montero17] | 78 adults, 6 wk, 1-5 x 60 min/wk | non-response (change within +/-3.96 % of Wmax) 69 / 40 / 29 / 0 / 0 % for 60/120/180/240/300 min/wk; universally abolished by +120 min/wk | mean gain over-predicted at 120-300 min/wk (12-22 % vs a few %-points), flag |
| Sex [Diaz-Canestro19][Skinner01] | meta-analysis (8 studies, n = 175): men +191 ml/min (CI 99-283) and +1.95 ml/kg/min (0.76-3.15) more than women; HERITAGE (n = 633): no sex difference in ml/kg/min, women larger %-gain | conflicting | sexF 0.95 |
| Age [Skinner01][Huang16] | HERITAGE 17-65 y: smaller absolute gain, same % gain in older; older sedentary meta-analysis (n = 1257 exercisers, 67 y): +3.78 ml/kg/min (CI 3.29-4.27) | | % gain age-independent |
Responsiveness is heritable (47 %) and dose-dependent: non-response can be eliminated by more training [Bouchard99][Montero17]; consensus statement: response variability real, needs replicate designs [Ross19].

**C. Time dynamics (two-pool, PROPOSED).**
`dGf/dt = (0.55 g* - Gf)/tauF` if target above, `dGs/dt = (0.45 g* - Gs)/tauS`; `tauF = 15 d` (Hickson), `tauS = 60 d` (reconciles 3-wk plateau at fixed load with continuing gains through 20-26 wk under progressive loading).
Detraining (target below current): `dG/dt = -(G - max(g*, rho x G_peak))/tauDn x (1 - 0.9 m)`, `tauDn = 30 d` (20-40), `m = min(1, HIminPerWeek/30)` intensity-maintenance factor, `rho = 0.45 (1 - exp(-trainYears/2))`.
Anchors: athletes lost 7 % of VO2max in 21 d, 16 % by 56 d, stabilising 16 % below trained value but still above sedentary controls (50.8 vs 43.3 ml/kg/min after 84 d); SV declines first, a-vO2 difference later [Coyle84]; recently acquired gains completely lost, VO2max of athletes stays above control [Mujika00b]; significant VO2max reductions within 2-4 wk (blood volume/SV first) [Neufer89]; **but 4 wk with one 35-min high-intensity bout/wk left VO2max unchanged (4.57 vs 4.54 L/min) while endurance capacity fell 21 %** [Madsen93]; reduced-training strategies work if intensity is kept and volume can fall markedly [Mujika00b].
Model checks: athlete peak 60.7 -> -7.0 % at 21 d, -12.6 % at 56 d, 51.9 at 84 d (obs -7, -16, 50.8); recent trainee retains ~1 % of gain at 84 d; with m = 1 (70 MEM/wk) 4-wk change -1.2 % (obs 0).
Output caps: `V <= 1.6 x vSed`(typical), warn if > 75 ml/kg/min.

**D. VO2max and mortality (careful wording).** Higher cardiorespiratory fitness is *associated* with lower mortality; cohort/clinical data cannot prove that raising VO2max lowers an individual's risk.
- 33 cohorts (102,980 participants, 6910 deaths): each +1 MET (= +1 km/h running speed) RR 0.87 (CI 0.84-0.90) all-cause and 0.85 (0.82-0.88) CHD/CVD; low (< 7.9 METs) vs high (>= 10.9 METs) RR 1.70 (1.51-1.92) [Kodama09].
- 122,007 treadmill-tested patients (mean 53 y, median follow-up 8.4 y): elite vs low adjusted HR 0.20 (0.16-0.24); elite vs high 0.77 (0.63-0.95); below-average vs above-average 1.41 (1.34-1.49); comparable to/greater than smoking (1.41) and diabetes (1.40); no upper limit of benefit [Mandsager18]. Clinical-referral population, estimated METs, retrospective.
- AHA statement recommends CRF as a clinical vital sign [Ross16].
UI wording: "Fitness level associated with X % lower/higher mortality in population studies", never "your risk falls by".
Implementation: `assocHR = 0.87^(METs - METsMedian(age,sex))` (`METs = V/3.5`), clipped to [0.3, 3]; grade **B-** (observational, dose-response consistent).

**Evidence grade (4.8): A** for mean responses and detraining direction (meta-analyses, HERITAGE, controlled trials); **B/C** for the fitted dose function and two-pool split (PROPOSED); **C** for sex effect (conflict).

### 4.9 Mitochondrial biogenesis / oxidative capacity (including "train-low")

**Mechanism.** Repeated contractions activate AMPK/p38/CaMKII -> PGC-1alpha (and p53, NRF1/2, TFAM) -> more mitochondrial protein; **volume drives mitochondrial content**, **relative intensity drives respiratory function per unit mitochondria**; the two can dissociate [Granata18].

**Quantitative anchors**
- 8 sedentary men, 60 min/d at 80 % VO2peak x 14 d (VO2peak +17.5 %): Cyt c, COX IV and citrate synthase (CS) rose within the first week; mtDNA/nDNA ratio unchanged at 2 wk [Egan13].
- 16 untrained, 6 HIIT sessions in 2 wk: VO2peak +8 %, COX activity +~20 %, respiratory capacity up, Hb mass/blood volume unchanged [Jacobs13].
- 10 men (Granata 2016b): 4 wk HIIT 3 x/wk: no mitochondrial change; then 20 d twice-daily HIIT: **CS activity and respiration +40-50 %**, ETS subunits +10-40 %, PGC-1alpha/NRF1/TFAM/p53 +65-170 %; after 2 wk reduced volume (5 sessions) all markers except **CS (+36 % vs baseline)** returned to baseline [Granata16b].
- 29 men, 4 wk (12 sessions): SIT (4-10 x 30 s all-out) raised maximal respiration +25 % and PGC-1alpha/p53 +60-90 %; HIIT (4-7 x 4 min at ~90 % Wpeak) and sub-lactate-threshold continuous training (these two matched for total work) did not change CS or respiration [Granata16a].
- Single-leg model, work-matched: 6 HIIT sessions/2 wk gave higher CS (10.2 vs 8.4 mmol/kg protein/min) and respiration (complex I 23.4 vs 17.1; I+II 58.2 vs 42.2 pmol O2/s/mg) than MICT [MacInnis17]; review: intensity matters for mitochondrial adaptation beyond work [MacInnisGibala17]; classic: increases in mitochondrial content/respiratory capacity slow glycogen and glucose use and increase fat oxidation at a given load [Holloszy84].
- Detraining: citrate synthase and SDH decline with **t1/2 = 12 d** after stopping, stabilising ~50 % above sedentary controls in long-term trained athletes; capillarisation stays 50 % above sedentary [Coyle84]; volume-driven gains reversed within 2 wk of low volume [Granata16b].
**Model (PROPOSED FIT, grade C).**
`M_c* = 1 + 0.5 x D_c(MEMendur)`, `D_c = MEM^2/(MEM^2 + 150^2)` (volume of >= 40 % VO2max work; MEM as 4.8); `tauUp_c = 21 d`, `tauDn_c = 17 d` (t1/2 12 d) toward floor `1 + rho x (M_peak - 1)` with `rho` as 4.8C (plateau 1.5 in athletes; Coyle: +50 % retained).
`M_r* = 1 + 0.30 x min(1, HIminPerWeek/30)` (respiratory capacity per mitochondrion; SIT/HIIT-driven), `tauUp_r = 14 d`, `tauDn_r = 10 d`.
Outputs: `oxidativeCapacityIndex = M_c x M_r`; it (i) raises fat-oxidation preset (interpolate from 'untrained' toward 'moderately trained' by (M-1)/0.5), (ii) sets EPOC recovery speed (tau x 0.75 at index 1.4+), (iii) reduces glycogen use at fixed load (Holloszy) - small (`x 0.9` at index 1.4, PROPOSED), (iv) drives **endurance capacity** independent of VO2max (Madsen: -21 % after 4 wk with VO2max unchanged, RER 0.89 -> 0.91).

**Train-low (low-glycogen training).** Training with reduced CHO availability (fasted, twice-daily, post-exercise restriction, sleep-low) augments signalling (73 % of 11 studies), gene expression (75 % of 12) and oxidative enzyme content (78 % of 9) especially when sessions start within a muscle-glycogen window (glycogen threshold hypothesis), but performance improved in only 37 % of 11 studies (63 % no change) [Impey18]. Meta-analysis of 9 studies in athletes (VO2max >= 55/60 ml/kg/min F/M), periodised CHO restriction >= 3 x/wk: **SMD 0.17 (CI -0.15..0.49, P = 0.29) - no performance benefit**; compromised training quality/intensity is the main drawback [Gejl21]. Elite race walkers: 3 wk LCHF impaired economy and negated performance gain despite VO2peak increase [Burke17].
**Model consequence:** do **not** add a performance/VO2max bonus for train-low; optionally increase acute PGC-1alpha-like signalling metric (output "adaptation signal") when `G_muscle/G_rest < 0.5` at session start (glycogen threshold), grade **B** for signalling, **A** for no performance effect.

### 4.10 Insulin sensitivity: acute and chronic exercise effects, post-meal walking (coordinate with 04, 06)

**Acute bout.** Insulin-stimulated glucose uptake rises via lower apparent Km (52 -> 40-43 microU/mL) and higher Vmax (9.5 -> 10.7-10.9 mg/min/kg); maximal glucose->glycogen conversion +26-40 % (5.7 -> 7.2-8.0 mg/min/kg); glycogen-synthase-I activity remains elevated 48 h; **effect present at 48 h, absent at 5 days** (n = 3) after 60 min at 150 W in 7 untrained men [Mikines88]. A dose threshold exists for fasting HOMA-IR: -32 +/- 24 % next morning only if exercise expended > ~3.77 MJ (~900 kcal) (30 men, 60 % VO2peak for 30-120 min); no change below (-2 +/- 21 %); larger effect at higher baseline HOMA-IR [Magkos08].
**Chronic.** Meta-analysis in T2DM: exercise ES -0.588 (CI -0.816..-0.359); still significant 48-72 h (ES -0.702) and > 72 h (-0.890) after last session [Way16]. HIIT: HOMA-IR SMD -0.49 vs control, -0.35 vs continuous training; fasting glucose -0.92 mmol/L in at-risk/T2DM [Jelleyman15]. Overweight/obese adults (n = 154, 6 mo): SI (IVGTT) +~85 % in low-volume/moderate (170 min/wk) and high-volume/vigorous (170 min/wk) vs +~40 % in low-volume/vigorous (115 min/wk); controls declined -> **weekly duration, not intensity or kcal, was the key variable** [Houmard04]. After stopping, SI stayed elevated at 15 d in the 200-min/wk programmes but fell to sedentary values in 115-min/wk vigorous [Bajpeyi09]. Review: dose-response with energy and intensity (HIIT), benefits can occur without VO2max gain and (some) independent of weight loss [BirdHawley16].
**Model (PROPOSED FIT).**
- Acute: `siAcute_peak = 0.40 x (1 - exp(-Enet/300 kcal))`, decays `exp(-t/58 h)` (t1/2 40 h: 44 % left at 48 h, 13 % at 120 h). Fasting-HOMA readout `homaMult = 1 - 0.32 x step(Enet - 900 kcal)` for 24 h.
- Chronic: `siChronic* = 0.85 x min(1, (minPerWeek_at_>=40%VO2max/170)^1.5)`, `tauUp = 21 d` (Perseghin: 6-wk training doubled insulin-stimulated muscle glycogen synthesis in insulin-resistant and normal subjects [Perseghin96]); `tauDn = 10 d` if < 150 min/wk, 30 d if >= 200 min/wk.
Passes to 04/06 as `insulinSensitivityMult = (1 + siChronic)(1 + siAcute)` applied to skeletal-muscle glucose disposal only (not hepatic).
**Post-meal walking and interrupted sitting (glucose).**
- Meta-analysis (7 crossover trials, mostly overweight/obese): light-walking breaks cut postprandial glucose (d = -0.72, CI -1.03..-0.41) and insulin (d = -0.83, -1.18..-0.48) vs sitting; standing d = -0.31 (glucose only); walking better than standing (d -0.30 / -0.54) [Buffey22].
- 2-min light or moderate walking every 20 min for 5 h after 75 g glucose + 50 g fat drink: glucose iAUC -24.1 % (light, 5.2 vs 6.9 mmol/L.h) and -29.6 % (moderate); insulin iAUC -23 % (n = 19 overweight adults) [Dunstan12].
- T2DM (n = 41): 10 min walking after each main meal vs 30 min once daily: 3-h glucose iAUC ratio 0.88 (0.78-0.99), 0.78 (0.67-0.91) after the evening meal [Reynolds16].
- Meta-analysis (8 crossover trials, 116 participants): post-meal exercise SMD 0.55 (CI 0.34-0.75) less glycaemic excursion vs no exercise and 0.47 (0.23-0.70) vs pre-meal exercise; pre-meal exercise vs control n.s. (-0.13, CI -0.42..0.17); each extra minute of delay between meal and exercise reduced the benefit (estimate -0.0151 per min, p = 0.001) [Engeroff23].
**Model:** `iAUC_glucose x= 1 - 0.12` for a 10-min walk within 30 min of the meal (up to -0.22 after high-CHO evening meal); `-0.24` for 2-min light walking every 20 min while seated (any intensity, effect size shrinks with meal-to-walk delay); Grade **A/B** (meta-analyses but small crossover trials, high risk of bias [Engeroff23]).

### 4.11 Concurrent training: does cardio blunt hypertrophy and strength?

**Mechanism (proposed but not confirmed in humans).** Endurance signalling (AMPK/PGC-1alpha) may inhibit mTORC1/MPS and add fatigue; human acute studies do **not** show molecular interference: concurrent bouts stimulated myofibrillar (RE 1.3-fold, AE 1.5, CE 1.4) and mitochondrial FSR equivalently to single modes, with no interference in signalling or mRNA [Donges12][Fyfe14]; "interference" evidence for hypertrophy is weaker than assumed [MurachBagley16].
**Meta-analytic effects**
- 43 RCTs (Schumann 2022): concurrent vs strength alone: maximal strength SMD -0.06 (CI -0.20..0.09), **explosive strength -0.28 (-0.48..-0.08)**, **hypertrophy -0.01 (-0.16..0.18)**; explosive strength attenuation stronger same-session (p = 0.043) than with >= 3 h separation (n.s.); no moderation by aerobic type (cycling vs running), frequency, training status, age [Schumann22].
- Fibre level (15 studies): overall fibre hypertrophy SMD -0.23 (CI -0.46..-0.00, p = 0.050); type I -0.34 (-0.72..0.04), type II -0.13 (-0.39..0.12); **type I with running -0.81 (-1.26..-0.36)** but not cycling [Lundberg22].
- Trained individuals: lower-body 1RM ES -0.35 (p < 0.05) with concurrent training; not affected in untrained/moderately trained; worse in same-session [Petre21].
- Older meta-analysis (21 studies, 422 ES): ES hypertrophy 1.23 (RT), 0.85 (concurrent), 0.27 (endurance); strength 1.76/1.44/0.78; power 0.91/0.55/0.11; running (not cycling) reduced hypertrophy and strength; correlations with endurance frequency (-0.26..-0.35) and duration (-0.29..-0.75) [Wilson12].
- Recovery interval (58 rugby players, 7 wk): strength gains lower with 0 h between sessions than 6 h, 24 h or strength-only; VO2peak gain higher with 24 h than 0/6 h [Robineau16].
**Reconciliation:** Wilson (2012, older, heterogeneous) found interference; the newer 43-RCT analysis does not for whole-muscle size or 1RM; residual interference appears for explosive strength, for type I fibres with running, and for trained lifters' 1RM.
**Model multipliers on module 09 outputs (PROPOSED, converting SMD to % assuming SD of relative change ~15-20 %):**
| Outcome | Default multiplier | Condition | Source |
|---|---|---|---|
| whole-muscle hypertrophy rate | 1.00 (uncertainty 0.95-1.05) | any aerobic mode | [Schumann22] |
| ... with high-volume running (> 3 runs/wk or > 40 km/wk) | 0.95 | | [Lundberg22][Wilson12] |
| maximal strength, untrained/moderately trained | 1.00 | | [Schumann22][Petre21] |
| maximal strength, trained lifters | 0.92 same session; 0.96 if >= 6 h separation | | [Petre21][Robineau16] |
| explosive strength / power | 0.90 same session; 0.95 if >= 3 h apart | | [Schumann22] |
| VO2max gain when concurrent | 1.00 if >= 24 h between RT and cardio; 0.95 if same day | | [Robineau16] |
Practical scheduling: separate >= 3 h (>= 6 h for maximal strength in trained), avoid heavy legs within 24 h before hard intervals; choose cycling over running when leg-strength emphasis (type I fibre data). Grade **A** (no interference for hypertrophy/max strength), **B** for small residual effects.

### 4.12 Exercise, appetite and lean-mass retention in deficit

**Appetite: acute.** Meta-analysis (29 studies, 51 trials): exercise (30-120 min, 36-81 % VO2max) has trivial effect on absolute intake at the next meal (ES 0.14, CI -0.005..0.29) and large effect on *relative* intake (ES -1.35): people **do not eat back exercise energy the same day** [Schubert13]. Hormones (20 studies, 241 participants): acyl-ghrelin ES -0.20 (median -16.5 %), PYY +0.24 (+8.9 %), GLP-1 +0.275 (+13 %), PP +0.50 (+15 %); no moderators identified [Schubert14]. Very-high-intensity intermittent exercise (15 s at 170 % VO2peak) lowered ad libitum intake and active ghrelin and free-living intake over 38 h (17 overweight men) [Sim14]; resistance and aerobic exercise both suppressed hunger and acyl-ghrelin during exercise, PYY rose with running [Broom09]. Land-based endurance exercise does not stimulate same-day compensation; daily energy balance is primarily set by the cost of exercise [Deighton14]. Adiposity and sex do not modify appetite responses; higher habitual activity may improve intake matching [Dorling18].
**Appetite: chronic.** 48 training studies (median 12 wk): no significant pre-post change in daily intake in fair/good-quality studies, +102 kcal/d (CI 1-203) vs control in 5 arms; small increase in fasting hunger, decreased disinhibition, some improved satiety/food reward [Beaulieu21]. Individual variability large (some compensate fully) [King08][Melanson13]. See 4.3 for the recommended saturating model.
**Model:** acute `hungerDelta = -0.2 SD` (0-2 h) after >= 30 min at >= 65 % VO2max; `-0.5 SD` after very-high-intensity intervals (PROPOSED from Sim14/Schubert14); chronic hunger drive `+apComp/(K_hunger)` from 4.3; module 12 owns the hormone dynamics.
**Lean-mass retention in an energy deficit (aerobic exercise alone).** Systematic review of 52 studies (middle-aged/older, BMI > 25): 81 % of diet-only groups vs 39 % of diet+exercise groups (exercise mainly aerobic) lost >= 15 % of body weight as FFM (wording of the abstract; read as the share of lost weight that was FFM) [Weinheimer10]. RCT (n = 29, age 67, 4 mo, -9.1 to -9.2 % body weight both arms): FFM -4.3 +/- 1.2 % with diet vs -1.1 +/- 1.0 % with diet + walking 35-45 min 3-5 x/wk; type I fibre area -19.2 % vs +3.4 %; thigh CSA -5.2 vs -3.0 % (n.s.) [Chomentowski09]; 14 RCTs: ER + exercise better than ER alone for fitness and preserving lean mass depending on exercise type [Miller13]; RT + protein is more effective (03/09). The classical "25 % of weight loss is FFM" is a heuristic that exercise and inactivity modify [Heymsfield14].
**Model:** `FFM-share-of-weight-loss x= 1 - 0.5 x min(1, mem7d/150)` for aerobic exercise alone (older adults data; PROPOSED, grade C); RT effect belongs to 09.

### 4.13 Step counts, sedentary time and an honest "activity health" metric

**Evidence (all observational; residual confounding and reverse causation remain)**
- Ding 2025 (Lancet Public Health): 57 studies/35 cohorts, 31 studies/24 cohorts in meta-analysis; non-linear inverse dose-response with inflection at ~5000-7000 steps/d for all-cause mortality, CVD incidence, dementia, falls; linear for CVD/cancer mortality, cancer incidence, T2D, depressive symptoms. **7000 vs 2000 steps/d:** all-cause mortality HR 0.53 (0.46-0.60), CVD incidence 0.75 (0.67-0.85), CVD mortality 0.53 (0.37-0.77), cancer incidence 0.94 (0.87-1.01, n.s.), cancer mortality 0.63 (0.55-0.72), T2D 0.86 (0.74-0.99), dementia 0.62 (0.53-0.73), depressive symptoms 0.78 (0.73-0.83), falls 0.72 (0.65-0.81); GRADE moderate for most (low for CVD mortality, cancer incidence, function; very low for falls) [Ding25].
- Paluch 2022 (15 cohorts, n = 47,471, 3013 deaths, median 7.1 y): quartile medians 3553/5801/7842/10,901 steps -> HR 1.0/0.60 (0.51-0.71)/0.55 (0.49-0.62)/0.47 (0.39-0.57); benefit plateaus at 6000-8000 steps/d (age >= 60) and 8000-10,000 (age < 60); after adjusting for total steps, higher stepping rate still associated for peak-30-min cadence (HR 0.67) but not time at >= 100 steps/min [Paluch22].
- Banach 2023 (17 cohorts, n = 226,889): each +1000 steps HR 0.85 (0.81-0.91) all-cause; each +500 steps HR 0.93 (0.91-0.95) CV mortality; monotone benefit to at least 20,000 steps/d in the spline [Banach23].
- Saint-Maurice 2020 (NHANES, n = 4840, 10.1 y): 8000 vs 4000 steps/d HR 0.49 (0.44-0.55); 12,000 vs 4000: 0.35 (0.28-0.45); step intensity not significant after adjusting for total steps [SaintMaurice20].
- Sedentary time (8 accelerometer cohorts, n = 36,383): HR by sedentary-time quartile 1.00/1.28/1.71/2.63; total PA HR 1.00/0.48/0.34/0.27; light PA 0.60/0.44/0.38; MVPA 0.64/0.55/0.52 [Ekelund19]. PA-adjusted meta-analysis (34 studies, 1.33 M): all-cause RR per +1 h/d of sitting 1.01 (<= 8 h/d) and 1.04 (> 8 h/d); CVD threshold 6 h/d [Patterson18]. 1 M-person harmonised analysis: high sitting (> 8 h/d) with the lowest activity had HR up to 1.59, and ~60-75 min/d of moderate activity (> 35.5 MET-h/wk) removed the excess (HR 1.04, 0.99-1.10); TV viewing >= 3 h/d stayed associated with higher mortality except in the most active quartile (there only >= 5 h/d, HR 1.16) [Ekelund16].
**Model (PROPOSED FIT to Ding, Paluch, Saint-Maurice, Banach).** `assocHR(steps) = 0.40 + 0.60 exp(-(max(steps, 2000) - 2000)/3270)` relative to 2000 steps/d:
2000 -> 1.00; 3000 -> 0.84; 4000 -> 0.73; 5000 -> 0.64; 6000 -> 0.58; **7000 -> 0.53 (matches Ding 0.53)**; 8000 -> 0.50; 10,000 -> 0.45; 12,000 -> 0.43; 15,000 -> 0.41.
Misfit: Paluch quartile ratios vs Q1 give 0.76/0.65/0.57 vs observed 0.60/0.55/0.47; Saint-Maurice 8000 vs 4000 gives 0.68 vs observed 0.49 (the model is deliberately conservative at low steps - low-step groups include ill people); per-1000-step slope 0.88 vs Banach 0.85.
UI metric **ActivityHealthIndex** = `100 x (1 - (assocHR - 0.40)/(1.0 - 0.40))` (0 at 2000 steps, 100 at plateau); label "association in cohort studies". Combine with sedentary time as `sedPenalty = 1.04^(max(0, sitH - 8))` and offset `min(1, MVPAmin/60)` (Ekelund16: 60-75 min/d cancels the sitting excess). Not a prediction of an individual's risk; grade **B** (many cohorts, consistent; GRADE moderate).

### 4.14 Activity baselines by lifestyle and PAL mapping (selector -> numbers)

**Anchors**
- Adults, pedometer meta-analysis (42 studies, 6199 people): mean 9448 steps/d (CI 8899-9996) excluding Amish; < 65 y 9797, >= 65 y 6565 [Bohannon07]. US "America on the Move" sample (n = 1136 adults): **5117 steps/d** [Bassett10]. Old Order Amish (n = 98): men **18,425**, women **14,196** steps/d [Bassett04]. Healthy adults typically 4000-18,000 steps/d; 100 steps/min = moderate; 7000-11,000 steps/d correspond to guidelines; 7000-8000 direct estimate of minimal MVPA [Tudor-Locke11].
- Step-defined zones: < 5000 sedentary; 5000-7499 low active; 7500-9999 somewhat active; 10,000-12,499 active; >= 12,500 highly active (zone hierarchy from [Tudor-Locke08]; upper cutoffs as I recall them from that paper, only the 10,000-12,499 and >= 12,500 zones are visible in the abstract text I retrieved).
- Occupation: walking postal delivery workers 16,035 +/- 4264 steps/24 h (workday) vs office postal workers 6709 +/- 2808 (n = 112, activPAL); no compensatory inactivity in the active group off-work [Tigbe11]; in the same industry 53 % reached 10,000 steps/d [Chastin09].
- PAL (FAO/WHO/UNU 2004): sedentary/light 1.40-1.69 (worked example 1.53), active/moderately active 1.70-1.99 (example 1.76), vigorous 2.00-2.40 (example 2.25; > 2.40 hard to sustain) [FAO04]. DLW database (n = 1754): mean PAL 1.74 +/- 0.27, 90 % 1.35-2.18 [Careau21]. Sustainable range 1.1-1.2 to 2.0-2.5; mean 1.7-1.8 at reproductive age; endurance professionals ~4.0 [Westerterp13].
**Selector table (recommended defaults; steps from anchors; PAL from FAO + Careau; MVPA mapping from Tudor-Locke)**
| Selector | Typical day | Steps/d (default, range) | PAL (default, range) | PA-R (for VO2max prior) | Compendium exemplars |
|---|---|---|---|---|---|
| 1 Sedentary | desk job, car/transit, no exercise | 4000 (2500-5500) | 1.45 (1.40-1.55) | 0-1 | office 1.3-1.5 MET; sitting 1.0 |
| 2 Lightly active | mostly seated job, some walking / stairs, occasional exercise | 6500 (5000-7500) | 1.60 (1.55-1.70) | 2 | walking 2.5-3.5 MET, household 2.3 |
| 3 Moderately active | on-feet job (retail, teaching) or regular walking + some training | 8500 (7500-10,000) | 1.75 (1.70-1.85) | 3-4 | walking 3.8, standing 1.5-2.2 |
| 4 Active | on-feet/lifting job or daily exercise habit | 11,000 (10,000-12,500) | 1.90 (1.85-2.00) | 5 | brisk walk 4.8, cycling 6.8 |
| 5 Very active | manual labour / delivery, or > 1 h vigorous/day | 15,000 (12,500-20,000) | 2.20 (2.00-2.40) | 6-7 | Amish/postal walker range |
**Steps vs energy:** steps explain only part of PAL (standing, load carrying, non-step movement, exercise are extra). Energy from steps beyond the lifestyle baseline: `dE = 0.44 kcal/kg/1000 steps x (steps - baselineSteps(selector))` (4.1.4), added on top of module 02's PAL baseline; do not use steps alone to set PAL (10,000 steps/d ~ +0.11-0.19 PAL for a 70-75 kg adult vs a 4000-step baseline, my arithmetic).
**Evidence grade: B** for step distributions and PAL categories; **C** for occupation-specific defaults (single samples).

### 4.15 Exercise timing (morning vs evening; relative to meals)

- **Weight loss and time of day (observational within RCT):** in MET-2, exercisers categorised post hoc by clock time: Early (7:00-11:59; n = 21) lost -7.2 +/- 1.2 % body weight, Late (15:00-19:00; n = 25) -2.1 +/- 1.0 %, Sporadic (n = 24) -5.5 +/- 1.2 %, control +0.5 %; no difference in TDEE, intake or NEPA; mechanisms unknown, self-selection likely [Willis20].
- **Glycaemia in T2DM (small crossover/retrospective):** 2 wk of afternoon HIIT lowered CGM glucose (6.2 vs 6.4 pre) while morning HIIT raised it (6.9 mmol/L) in 11 men [Savikj19]; 12 wk afternoon training gave better peripheral insulin sensitivity (+5.2 vs -0.5 umol/min/kg FFM), fasting glucose (-0.3 vs +0.5 mmol/L) and fat mass (-1.2 vs -0.2 kg) than morning in 32 men (retrospective, unequal groups) [Mancilla21]. These oppose MET-2's direction.
- **CVD associations:** UK Biobank clusters: late-morning activity vs midday: CAD HR 0.84 (0.77-0.92), stroke 0.83 (0.70-0.98); larger in women [Albalak23].
- **Fat oxidation/circadian:** higher evening resting/maximal fat oxidation reported in some studies, not universal [Rubio-Valles25]; acute 24-h fat oxidation depends on fasted-vs-fed timing rather than clock time (4.6).
- **Relative to meals:** post-meal walking (4.10) is the best-supported timing effect; fasted-state exercise raises exercise fat oxidation by ~3 g and shifts 24-h substrate partition, not fat loss (4.6).
**Model:** no time-of-day term in energy expenditure, compensation, VO2max or mitochondrial states (conflicting, low-quality evidence; grade **C-D**). Timing enters through (i) meal-relative flags (fasted RER offset, glycogen start level), (ii) post-meal walk glucose multiplier (4.10), (iii) concurrent-training separation (4.11), (iv) sleep interaction (16).

### 4.16 Recovery cost, overtraining and low energy availability (coordinate with 17)

- **Energy availability (EA)** `= (EI - EEE)/FFM` kcal/kg FFM/day; EEE = exercise energy expenditure. Convention (recommended: net of resting, i.e. above the RMR that would have been spent anyway; the papers' exact convention should be checked in 17, UNVERIFIED).
- 29 sedentary young women, 5 d: exercise 15 kcal/kg LBM/d at 70 % aerobic capacity with EA 45 vs 10/20/30 kcal/kg LBM/d: LH pulsatility unaffected at 30 kcal/kg LBM/d, LH pulse frequency fell (amplitude rose) below 30; more extreme with short luteal phases; effects paralleled glucose, beta-hydroxybutyrate, GH, cortisol [Loucks03]; earlier 4-d study: at EA 10 vs 45, LH pulse frequency -10 %, CHO share of exercise energy 73 % -> 49 % [Loucks98].
- 35 sedentary women, 3 cycles: no EA threshold for menstrual disturbance; odds fall 9 % per +1 kcal/kg FFM/day (OR 0.91, CI 0.84-0.98); tertiles 23.4-34.1 / 34.9-40.7 / 41.2-50.1 [Lieberman18]. IOC 2023 REDs statement emphasises severity/risk stratification, low carbohydrate availability and males, not a single number [Mountjoy23]; concept review of EA [Loucks11].
- Overtraining: overreaching (functional/non-functional) vs overtraining syndrome ("prolonged maladaptation"); no marker meets all criteria; contributors include dietary energy restriction and insufficient CHO/protein [Meeusen13].
- Recovery cost of resistance/eccentric work: no measurable RMR elevation after hard RT [Abboud13]; treat as zero except via EPOC.
**Model / warnings:** `EA7d < 45` -> "reduced", `< 30` -> **LEA warning** (female emphasis; males less defined), `< 20` -> strong warning (17); if `EA7d < 30` for > 14 days and `mem7d > 300`: apply VO2max/mito gain multiplier 0.8 and add fatigue flag (PROPOSED; Meeusen names caloric restriction as a trigger but gives no numbers). Grade **B** for the 30 kcal/kg FFM anchor in young women (controlled), **C** for males and for the multipliers.

### 4.17 Function library specification (`src/engine/activity/*`, pure TypeScript, no DOM)

All functions are pure; state is passed in/out (`ActivityState`). Units: kg, m, min, kcal, ml/kg/min, g. Every constant below is a row in a `PARAMS` object with `{value, low, high, source, grade}`.

```ts
// ---------- constants.ts ----------
export const kcalPerLO2 = (rq: number) => 4.686 + (rq - 0.707) * 0.361 / 0.293;   // Manini10
export const restVo2 = (rmrKcalDay: number, massKg: number) => rmrKcalDay / 1440 / 5 * 1000 / massKg; // ml/kg/min
export const W_TO_KGM_MIN = 6.118;

export interface Body { sex: 'M'|'F'; ageY: number; heightM: number; massKg: number; ffmKg: number;
                        rmrKcalDay: number; bmi: number; vo2max: number /*ml/kg/min*/; }
export type Intensity =
  | { kind: 'speed'; kmh: number; grade?: number }        // walk, run
  | { kind: 'power'; watts: number }                       // cycling, rowing erg
  | { kind: 'met';   met: number }                         // any Compendium row
  | { kind: 'relVo2'; x: number }                          // fraction of current VO2max
  | { kind: 'intervals'; workMin: number; restMin: number; workX: number; restX: number };
export interface ActivitySpec { id: string; klass: 'walk'|'run'|'cycle'|'met'|'rt'|'hiit'|'swim'|'sport'; compendiumCode?: string; }
export interface Ctx { body: Body; fed: 'fasted'|'postprandial'; hoursSinceMeal: number;
                       ketoAdapt: number /*0-1 from 05*/; muscleGlycogenFrac: number /*G/G0 from 04*/;
                       trainingIdx: number /*0-1, from vo2max percentile & mito index*/; params: Params; }
export interface BoutResult {
  grossKcal: number; netKcal: number;          // net = above RMR
  incrementKcal: number;                       // net minus displaced baseline (to be scaled by 1-cMet)
  vo2Gross: number; relVo2: number; met: number;
  epocKcal: number; epocTauH: number[]; epocFrac: number[];
  fatG: number; choG: number; muscleGlycogenG: number; liverCarbG: number; rerMean: number;
  memWeighted: number; hiMin: number;           // dose for adaptation states
  rangeKcal: [number, number];                 // +/-15 % (equations) or +/-25 % (swim, sport, RT)
}
```

```ts
// ---------- exerciseEnergy.ts ----------
export function exerciseEnergy(act: ActivitySpec, minutes: number, inten: Intensity,
                               bodyMass: number, ctx: Ctx): BoutResult {
  const { body, params: P } = ctx;
  const rest = restVo2(body.rmrKcalDay, bodyMass);                         // ml/kg/min
  let netVo2: number;                                                     // ml/kg/min above supine rest
  let grossKcalOverride: number | undefined;
  switch (act.klass) {
    case 'walk': {
      const v = inten.kind === 'speed' ? inten.kmh / 3.6 : 1.3;
      const gm = inten.kind === 'speed' && inten.grade ? gradeMultWalk(inten.grade) : 1;   // Minetti ratio, UNVERIFIED-COEFFS
      const obesityF = body.bmi >= 35 ? P.obesityWalkFactor : 1;                         // +10 %/kg [Browning06]
      netVo2 = (3.85 + 5.97 * v * v / body.heightM) * gm * obesityF;                     // [Ludlow16]
      break; }
    case 'run': {
      const v = (inten as any).kmh / 3.6;
      const gm = (inten as any).grade ? gradeMultRun((inten as any).grade) : 1;
      netVo2 = P.runEff * 0.2 * v * 60 * gm;                                            // ACSM x 0.9
      break; }
    case 'cycle': {
      const watts = (inten as any).watts;
      const metabolicW = 2.4 * (body.rmrKcalDay / 1440 * 4184 / 60) + watts / 0.26;      // PROPOSED FIT to Compendium
      grossKcalOverride = metabolicW * 60 * minutes / 4184;
      netVo2 = (grossKcalOverride / minutes) / kcalPerLO2(0.88) * 1000 / bodyMass - rest;
      break; }
    default: {                                                                          // 'met','rt','hiit','swim','sport'
      const met = inten.kind === 'met' ? inten.met : metFromRelVo2(inten, body);
      netVo2 = met * 3.5 - rest;                                                        // gross MET x 3.5 minus own rest
    }
  }
  const vo2Gross = netVo2 + rest;                                                        // ml/kg/min
  const x = Math.min(1.2, vo2Gross / ctx.body.vo2max);                                   // relative intensity
  const rq = Math.min(1, rerCurve(Math.min(x, 1), ctx).rer);                             // for kcal/L
  const grossKcal = grossKcalOverride ?? vo2Gross * bodyMass * minutes / 1000 * kcalPerLO2(rq);
  const netKcal = grossKcal - body.rmrKcalDay / 1440 * minutes;
  const incrementKcal = netKcal - P.displacedBaseline * body.rmrKcalDay / 1440 * minutes; // default 0.2 x RMR
  const epoc = epocKcal(act, x, minutes, netKcal, ctx);                                  // 4.2
  const sub = substrateSplit(vo2Gross * bodyMass / 1000, Math.min(x, 1.0), minutes, ctx); // 4.4 (g/min -> g)
  const gly = glycogenUse(sub, x, minutes, ctx);                                         // 4.5
  const dose = doseWeights(act, x, minutes, inten);                                      // 4.8 (MEM, HImin)
  const band = ['swim','sport','rt'].includes(act.klass) ? 0.25 : 0.15;
  return { grossKcal, netKcal, incrementKcal, vo2Gross, relVo2: x, met: vo2Gross / 3.5, ...epoc, ...sub.totals(minutes), ...gly, ...dose,
           rangeKcal: [grossKcal * (1 - band), grossKcal * (1 + band)] };
}

// grade multipliers, ratio to level cost; Minetti02 coefficients (UNVERIFIED-COEFFS; end-points verified)
const cw = (i: number) => 280.5*i**5 - 58.7*i**4 - 76.8*i**3 + 51.9*i**2 + 19.6*i + 2.5;   // J/kg/m walking
const cr = (i: number) => 155.4*i**5 - 30.4*i**4 - 43.3*i**3 + 46.3*i**2 + 19.5*i + 3.6;   // J/kg/m running
export const gradeMultWalk = (g: number) => cw(Math.max(-0.45, Math.min(0.45, g))) / cw(0);
export const gradeMultRun  = (g: number) => cr(Math.max(-0.45, Math.min(0.45, g))) / cr(0);

// steps -> net energy above supine rest (4.1.4); SL = 0.415 H (PROPOSED), cadence default 110
export function stepsEnergy(steps: number, body: Body, cadence = 110) {
  const v = 0.415 * body.heightM * cadence / 60;
  const netMlKgStep = (3.85 + 5.97 * v * v / body.heightM) / cadence;
  const net = netMlKgStep * body.massKg * steps / 1000 * kcalPerLO2(0.85) * (body.bmi >= 35 ? 1.10 : 1);
  return { netKcal: net, grossKcal: net + restVo2(body.rmrKcalDay, body.massKg) * body.massKg * (steps / cadence) / 1000 * kcalPerLO2(0.85) };
}
```

```ts
// ---------- epoc.ts ---------- (4.2)
export function epocKcal(act: ActivitySpec, x: number, min: number, netKcal: number, ctx: Ctx) {
  const interval = act.klass === 'hiit' || (ctx as any).intervals;
  let phi: number;
  if (act.klass === 'rt') phi = ctx.params.epocRt;                                       // 0.05
  else {
    const S = 1 / (1 + Math.exp(-(x - 0.68) / 0.06));
    const Dfac = Math.min(1, min / 45) ** 0.7;
    const phiMax = interval ? 0.20 : 0.15;
    phi = Math.min(phiMax, Math.max(0.02, phiMax * S * Dfac));
  }
  const light = x < 0.5 && act.klass !== 'rt';
  const trainedTau = 1 - 0.25 * ctx.trainingIdx;
  const epocTauH = light ? [0.15 * trainedTau] : [0.4 * trainedTau, 4 * trainedTau];
  const epocFrac = light ? [1] : [0.6, 0.4];
  return { epocKcal: phi * netKcal, epocTauH, epocFrac };
}
// hourly release: EPOC_j(t) = epocKcal * sum_k epocFrac[k] * exp(-t/tau[k]) / tau[k]   (kcal/h)
```

```ts
// ---------- substrate.ts ---------- (4.4, 4.5)
export interface FatPreset { vo2maxRef: number; rerLo: number; n: number; }
export const PRESETS: Record<string, FatPreset> = {
  untrained:  { vo2maxRef: 3.2, rerLo: 0.75,  n: 2.0 },   // Fatmax 48 %, MFO 0.43 [Venables05]
  trained:    { vo2maxRef: 4.0, rerLo: 0.855, n: 5.4 },   // 64 %, 0.52 [Achten02]
  athlete:    { vo2maxRef: 4.2, rerLo: 0.75,  n: 2.1 },   // 49 %, 0.59 [Randell17]
  hcElite:    { vo2maxRef: 4.7, rerLo: 0.795, n: 3.05 },  // 55 %, 0.67 [Volek16]
  ketoAdapted:{ vo2maxRef: 5.3, rerLo: 0.715, n: 6.5 },   // 70 %, 1.54 [Volek16]
};
export function rerCurve(x: number, ctx: Ctx, tMin = 0) {
  const p = blendPreset(ctx);                                    // interpolate parameters by trainingIdx and ketoAdapt
  const fedOffset = ctx.fed === 'postprandial' ? 0.015 * Math.exp(-ctx.hoursSinceMeal / 4) : 0;  // [Vieira16] (0.01-0.04); decay PROPOSED
  const drift = x >= 0.55 && x <= 0.85 ? -0.05 * (1 - Math.exp(-tMin / 120)) : 0;               // [Coyle86]
  const thr = Math.min(1, ctx.muscleGlycogenFrac ?? 1);
  const lowGly = thr < 0.3 ? -0.03 * (1 - thr / 0.3) : 0;                                        // fall in RER near depletion (Coyle86: 0.80)
  const rer = Math.max(0.707, p.rerLo + fedOffset + (1.10 - p.rerLo) * x ** p.n + drift + lowGly);
  return { rer };
}
export function substrateSplit(vo2L: number /*L/min at this x*/, x: number, minutes: number, ctx: Ctx, tMin = 0) {
  const { rer } = rerCurve(x, ctx, tMin), rc = Math.min(rer, 1);
  const fatGmin = Math.max(0, vo2L * (1.695 - 1.701 * rc));
  const choGmin = x < 0.75 ? vo2L * (4.210 * rc - 2.962) : vo2L * (4.344 * rc - 3.061);
  const kcalMin = vo2L * kcalPerLO2(rc);
  return { fatGmin, choGmin: Math.max(0, choGmin), kcalMin, rer, fatShare: fatGmin * 9.62 / kcalMin,
           totals: (m: number) => ({ fatG: fatGmin * m, choG: Math.max(0, choGmin) * m, rerMean: rer }) };
}
// numerical duration integration: step 1 min, recompute rer with tMin and G/G0 from module 04
export function glycogenUse(sub: ReturnType<typeof substrateSplit>, x: number, minutes: number, ctx: Ctx) {
  let mus = 0, liv = 0, g = ctx.muscleGlycogenFrac;
  for (let t = 0; t < minutes; t++) {
    const fmg = 0.90 - 0.30 * (1 - Math.exp(-t / 120));                       // PROPOSED FIT [Coyle86]
    const a = (g * g / (g * g + 0.04)) * 1.04;                                 // availability throttle
    const cho = sub.choGmin;                                                   // (recomputed per minute in the real loop)
    mus += cho * fmg * a; liv += cho * (1 - fmg * a);
    g = Math.max(0, g - (cho * fmg * a) / ctx.body.ffmKg / 8.0);               // 04 owns G; ~8 g/kg FFM store (PROPOSED)
  }
  return { muscleGlycogenG: mus, liverCarbG: liv };
}
```

```ts
// ---------- compensation.ts ---------- (4.3)
export interface CompState { rmrComp: number /*kcal/d, <= 0*/; apComp: number /*kcal/d >= 0*/; }
export function updateCompensation(s: CompState, EnetMean7d: number, body: Body, P: Params, dtDays = 1): CompState {
  const cMet = Math.max(0, P.cMet + P.cMetPerBmi * Math.max(-5, Math.min(8, body.bmi - 25)));       // 0.15 + 0.01/BMI
  const targetRmr = Math.max(-0.05 * body.rmrKcalDay, -cMet * EnetMean7d);                            // cap -5 % RMR
  const targetAp = P.apMax * (1 - Math.exp(-EnetMean7d / P.apK));                                     // 100, 150
  return { rmrComp: s.rmrComp + (targetRmr - s.rmrComp) * (1 - Math.exp(-dtDays / P.tauRmr)),         // 14 d
           apComp:  s.apComp  + (targetAp  - s.apComp ) * (1 - Math.exp(-dtDays / P.tauAp)) };        // 28 d
}
// TDEE_exercise_day = sum(bout.incrementKcal) + stepIncrement + sum(EPOC released today);  RMR_effective = RMR + rmrComp
```

```ts
// ---------- fitness.ts ---------- (4.8, 4.9, 4.10, 4.11)
export interface FitState { vSed: number; vo2max: number; gF: number; gS: number; gPeak: number; mC: number; mR: number; mPeak: number;
                            siChronic: number; siAcute: number[]; trainYears: number; mem7d: number; hi7d: number; run7d: number; }
export const memWeight = (x: number) => x < 0.40 ? 0 : x < 0.55 ? 0.4 : x < 0.70 ? 1.0 : x < 0.85 ? 1.5 : 1.5; // intervals: 3.0/min of work >= 85-90 %, 0.3/min recovery
export function updateVo2max(s: FitState, memWeek: number, hiMinWeek: number, z: number, sexF: number, dtDays: number, P: Params) {
  const D = memWeek ** 2 / (memWeek ** 2 + P.K ** 2);
  const gStar = Math.min(0.60, P.gMax * D * z * sexF);
  const rho = 0.45 * (1 - Math.exp(-s.trainYears / 2));
  const m = Math.min(1, hiMinWeek / 30);
  const upd = (G: number, tauUp: number, share: number) => {
    const target = share * gStar;
    if (target >= G) return G + (target - G) * (1 - Math.exp(-dtDays / tauUp));
    const floor = rho * share * s.gPeak;
    const k = (1 / P.tauDn) * (1 - 0.9 * m);
    return G + (Math.max(target, floor) - G) * (1 - Math.exp(-k * dtDays));
  };
  const gF = upd(s.gF, 15, 0.55), gS = upd(s.gS, 60, 0.45);
  const gPeak = Math.max(s.gPeak, gF + gS);
  return { ...s, gF, gS, gPeak, vo2max: s.vSed * (1 + gF + gS) };
}
export function updateMito(s: FitState, memEndurWeek: number, hiMinWeek: number, dtDays: number) {
  const mCstar = 1 + 0.5 * (memEndurWeek ** 2 / (memEndurWeek ** 2 + 150 ** 2));
  const rho = 0.45 * (1 - Math.exp(-s.trainYears / 2));
  const floorC = 1 + rho * (s.mPeak - 1);
  const mC = mCstar >= s.mC ? s.mC + (mCstar - s.mC) * (1 - Math.exp(-dtDays / 21))
                             : s.mC + (Math.max(mCstar, floorC) - s.mC) * (1 - Math.exp(-dtDays / 17.3));
  const mRstar = 1 + 0.30 * Math.min(1, hiMinWeek / 30);
  const mR = mRstar >= s.mR ? s.mR + (mRstar - s.mR) * (1 - Math.exp(-dtDays / 14))
                             : s.mR + (mRstar - s.mR) * (1 - Math.exp(-dtDays / 10));
  return { ...s, mC, mR, mPeak: Math.max(s.mPeak, mC) };
}
export const siAcutePeak = (EnetKcal: number) => 0.40 * (1 - Math.exp(-EnetKcal / 300));      // decays exp(-t/58 h)
export const siChronicTarget = (minPerWeek: number) => 0.85 * Math.min(1, (minPerWeek / 170) ** 1.5);
export const homaMult = (EnetKcal: number) => EnetKcal > 900 ? 0.68 : 1;                       // next 24 h [Magkos08]
export function concurrentMult(o: { trained: boolean; sameSession: boolean; hoursApart: number; highRunVolume: boolean }) {
  const hyp = o.highRunVolume ? 0.95 : 1.0;
  const maxStr = o.trained ? (o.sameSession || o.hoursApart < 6 ? 0.92 : 0.96) : 1.0;
  const power = o.sameSession || o.hoursApart < 3 ? 0.90 : 0.95;
  return { hypertrophy: hyp, maxStrength: maxStr, explosive: power, vo2maxGain: o.hoursApart >= 24 ? 1.0 : 0.95 };
}
export const assocHR = (steps: number) => 0.40 + 0.60 * Math.exp(-(Math.max(steps, 2000) - 2000) / 3270);
export const activityHealthIndex = (steps: number) => 100 * (1 - (assocHR(steps) - 0.40) / 0.60);
export const energyAvailability = (eiKcal: number, eeeNetKcal: number, ffmKg: number) => (eiKcal - eeeNetKcal) / ffmKg;
// dose bookkeeping for one bout (4.8): continuous work -> memWeight(x) per minute; intervals -> 3.0/min of work at x >= 0.85, 0.3/min of recovery
export function doseWeights(act: ActivitySpec, x: number, minutes: number, inten: Intensity) {
  if (inten.kind === 'intervals') {
    const cycles = minutes / (inten.workMin + inten.restMin);
    const w = inten.workX >= 0.85 ? 3.0 : memWeight(inten.workX);
    return { memWeighted: cycles * (inten.workMin * w + inten.restMin * 0.3), hiMin: inten.workX >= 0.85 ? cycles * inten.workMin : 0 };
  }
  return { memWeighted: minutes * memWeight(x), hiMin: x >= 0.85 ? minutes : 0 };   // resistance training: memWeighted = 0 (not aerobic), counted in 09
}
export const estimateVo2max = (sex: 'M'|'F', age: number, bmi: number, parScore: number) =>
  56.363 + 1.921 * parScore - 0.381 * age - 0.754 * bmi + 10.987 * (sex === 'M' ? 1 : 0);     // [Jackson90], SEE 5.7
```

**Default `PARAMS` (value [low, high] source grade):** `K` 130 [100,170] PROPOSED C; `gMax` 0.35 [0.25,0.45] PROPOSED C; `cMet` 0.15 [0,0.28] [Careau21] C; `cMetPerBmi` 0.010 [0,0.02] C/D; `apMax` 100 [70,140] kcal/d [Martin19] B; `apK` 150 [100,250] B/C; `tauRmr` 14 d D; `tauAp` 28 d D; `tauDn` 30 d [20,40] [Coyle84] B; `runEff` 0.90 [0.80,1.0] B; `displacedBaseline` 0.2 x RMR D; `epocRt` 0.05 [0,0.10] C; `obesityWalkFactor` 1.10 [1.05,1.15] [Browning06] B.

**Unit-test fixtures (75 kg man, 1.75 m, RMR 1750 kcal/d, VO2max 42 ml/kg/min; tolerance +/-3 % unless stated).** Computed with a Python reference implementation of the equations above:
| # | Call | Expected |
|---|---|---|
| T1 | `walk 5 km/h, 60 min` | gross 299, net 228 kcal (Compendium 3.8 MET: 299 gross / 220 net) |
| T2 | `run 10 km/h, 30 min` | gross 366, net 331 kcal (Compendium 10 MET: 394 / 357; ACSM eff 1.0: 365 net) |
| T3 | `cycle 100 W, 60 min` / `200 W` | gross 506 / 837, net 433 / 764 kcal |
| T4 | `RT 4.0 MET, 60 min` | gross 315, net 242 |
| T5 | `crawl 8.0 MET, 45 min` | gross 472, net 418 (+/-25 % band) |
| T6 | EPOC `x=0.75, 45 min continuous` / `HIIT x=0.90 25 min` / `walk x=0.35 60 min` | phi 0.114 / 0.129 / 0.02 |
| T7 | `updateCompensation`, Enet 263 / 105 / 429 kcal/d, BMI 25 | rmr -39/-16/-64 ; appetite +83/+50/+94 kcal/d (total 46 / 63 / 37 %) |
| T8 | `stepsEnergy(10000)`; `6000` | net 337; 202 kcal |
| T9 | `siAcutePeak(500)` at 0/24/48/120 h | 0.324 / 0.215 / 0.142 / 0.041 |
| T10 | `assocHR` at 2000/4000/7000/10000 | 1.00 / 0.725 / 0.53 / 0.452 |
| T11 | `energyAvailability(2200, 500, 55)` ; `(1800, 700, 50)` | 30.9 ; 22.0 |
| T12 | `substrateSplit` trained preset, VO2max 4.0 L/min, x = 0.65 fasted | fat 0.52 g/min, 39 % of energy, CHO 1.92 g/min; at x = 0.60 fat 0.51 g/min fasted vs ~0.46 g/min postprandial (+0.015 RER; 30.8 vs ~27.4 g per 60 min) |
| T13 | `updateVo2max`, vSed 35, MEM 130/wk x 140 d, z = 1 | +6 wk 13.1 %, +12 wk 15.6 %, +20 wk 16.8 %; stop training after 20 wk (rho 0): -7.3 % at 21 d, -12.2 % at 56 d |
| T14 | `estimateVo2max('M',30,25,3)` / `('F',30,23,3)` | 42.8 / 33.4 |

## 5. Interactions with other subsystems

| Module | This module gives | This module needs |
|---|---|---|
| 01 body-weight model | daily `incrementKcal` (bouts + steps above baseline) x (1 - cMet), EPOC release schedule, `rmrComp` (<= 0), `apComp` (drive) | body mass each day (costs re-scale with mass), energy intake (for EA), body composition change |
| 02 RMR/NEAT/TEF | net exercise energy above RMR; MET-based resting correction | RMR (any equation; used for net cost, EA, corrected METs), baseline PAL/NEAT (so steps above baseline are not double counted), TEF, adaptive thermogenesis state (compensation `rmrComp` must be added to, not stacked with, adaptive thermogenesis under deficit: cap combined RMR reduction; agree with 02) |
| 03/09 protein, MPS, RT | RT session energy (4.0 MET default), aerobic FFM-retention factor (0.5 x at >= 150 min/wk), interference multipliers (hypertrophy 1.0, max strength trained 0.92-0.96, explosive 0.90-0.95), acute MPS unaffected by concurrent bout [Donges12] | RT volume/timing, RT effect on FFM in deficit, per-meal protein |
| 04 carbohydrate/glycogen/insulin | CHO oxidation demand (g/min), muscle-vs-blood split, local glycogen depletion `D_loc`, `insulinSensitivityMult` (acute + chronic), post-meal-walk glucose multiplier | glycogen pools `G/G0` (muscle, liver), meal times/CHO grams, dietary CHO availability (resting glycogen +102 / -253 mmol/kg dm) [Areta18] |
| 05 fat oxidation/ketosis | fat oxidation g/min by intensity, RER preset; exercise-induced fatty-acid flux for ketone models | ketone state -> `ketoAdapt` (0-1) to interpolate presets (LC preset requires weeks-months of adaptation [Volek16]; economy penalty [Burke17]) |
| 06 lipids/biomarkers | VAT and liver-fat extra loss, HOMA-IR next-day effect, insulin sensitivity, ActivityHealthIndex | baseline liver fat/VAT, weight change (avoid double counting) |
| 07 fasting/timing | fasted vs fed RER offset; 24-h fat-oxidation partition; no fat-mass term; hunger drive | meal windows, hours since last meal |
| 12 hormones/appetite | `apComp` as hunger drive; acute `hungerDelta`; leptin-mediated compensation hypothesis [Flack20] | leptin/ghrelin state (feedback: bigger fat loss -> more compensation) |
| 16 sleep/stress/sex/age | sex/age in VO2max, MFO, sexF | sleep restriction effects on training response; menstrual-cycle EA |
| 17 safety | EA warnings, PAL caps, dose caps, LEA-related multipliers | population contraindications |
| 18 planner | cost-benefit table per modality: kcal/h, EPOC, adherence-free effect on VO2max/mito/SI, time-efficiency (HIIT ~40 % less time for equal fat loss [Wewege17]) | goal weights |
| 19 performance/other | `vo2max`, oxidative-capacity index, endurance-capacity index, interference multipliers | strength/hypertrophy states |

Conflicts to resolve at integration time: (i) 02's NEAT-decline under deficit vs `rmrComp` (both may model the same phenomenon); (ii) 01's energy-partitioning of the compensation (fat vs FFM); (iii) 04's hepatic glucose output vs `liverCarbG`.

## 6. Output metrics for the UI

| Metric | Unit | Good direction | Computation | Grade |
|---|---|---|---|---|
| Exercise energy (gross/net), daily and weekly | kcal | context | sum of `BoutResult` + `stepsEnergy` (show +/-15-25 % band) | A/B |
| Extra TDEE actually added by exercise | kcal/d | up (if goal = expenditure) | `sum(increment) x (1 - cMet) + EPOC released` | B |
| Compensation (metabolic / appetite / total) | kcal/d, % of exercise energy | down | `-rmrComp`, `apComp`, sum/Enet | B/C |
| Steps/day; step energy | steps, kcal | up to plateau | input; `stepsEnergy` | A |
| ActivityHealthIndex (steps) | 0-100 | up | 4.13 (cohort association) | B |
| Sitting time and offset | h/d | down | input; `1.04^(h-8)` with MVPA offset (4.13) | B |
| VO2max | ml/kg/min; METs | up | state `vo2max`; `METs = V/3.5` | A/B |
| Fitness percentile / "fitness age" | %, y | up / down | FRIEND table by age/sex (4.8A); fitness age = age at which the median equals user's VO2max | B |
| Fitness-associated relative mortality (association only) | HR | down | `0.87^(METs - METsMedian)`; must be labelled observational (Kodama09, Mandsager18) | B- |
| Mitochondrial oxidative capacity index; endurance-capacity index | index (sedentary = 1) | up | `M_c x M_r`; endurance capacity ~ `M_c` (volume) | C |
| Fat oxidation during exercise; fat share of energy; Fatmax | g/session, %, % VO2max | context (not a goal proxy for fat loss) | `substrateSplit` integrated over bout | A/B |
| Muscle glycogen used per session; local depletion | g, % | context | 4.5 | B/C |
| Insulin-sensitivity multiplier (acute, chronic) | x | up | 4.10 | B |
| Post-meal walking glucose reduction | % iAUC | up | 4.10 | A/B |
| VAT / liver-fat extra reduction from exercise | % | up | 4.7 | B / B-C |
| Energy availability | kcal/kg FFM/d | >= 45 good; < 30 warn | `energyAvailability` | B (F), C (M) |
| Concurrent-training interference factors | x | 1.0 | `concurrentMult` | A/B |
| Hunger drive from exercise | kcal/d eq., SD | context | `apComp` | C |
| EPOC (kcal after session) | kcal | context | 4.2 | A/B |

Planner-goal notes: "maximise fat loss" must not reward fasted timing or intensity per se; "maximise VO2max" rewards MEM >= 150 min/wk with >= 30 HI min/wk and consistent adherence; "maximise mitochondria" rewards volume; "maximise insulin sensitivity" rewards >= 170 min/wk distributed over the week; "maximise longevity" -> steps to ~7-10k plus VO2max (associational).

## 7. Validation targets (engine must reproduce within tolerance)

| # | Inputs | Published outcome | Tolerance |
|---|---|---|---|
| V1 | 30 adults (71 kg), walk 1600 m at 86 m/min and run 1600 m at 160 m/min, treadmill | EE during exercise 372.5 +/- 78 kJ (walk) and 471 +/- 101 kJ (run); post-exercise EE back to baseline 10 / 15 min [Wilkin12] | gross within +/-15 %; EPOC tau 0.15 h |
| V2 | 75 kg adult, level walking 5 km/h 60 min | Compendium 3.8 MET -> 299 kcal gross; Ludlow model 299 gross / 228 net; ACSM equation gives ~20 % less [Herrmann24][Ludlow16][Weyand13] | +/-10 % |
| V3 | 45 min cycling at 73 % VO2max, 10 men | net exercise cost 519 kcal; post-exercise excess +190 kcal over 14 h [Knab11] | model EPOC (0.114-0.142 x net = 59-74 kcal) is inside the LaForgia 6-15 % range; Knab is flagged outlier (37 %) |
| V4 | sessions >= 50 min at >= 70 % VO2max | EPOC = 6-15 % of net O2 cost [LaForgia06] | phi in [0.06, 0.15] |
| V5 | resistance: 10,000 vs 20,000 kg sessions | 247 vs 484 kcal during; no significant RMR elevation 12-48 h [Abboud13] | EPOC <= 10 % |
| V6 | 24 wk, 8 vs 20 kcal/kg/wk supervised aerobic, BMI 31.5 | compensation 1.5 vs 2.7 kg (65 % vs 47 %); intake +90.7 vs +123.6 kcal/d; RMR unchanged [Martin19] | total compensation +/-10 %-points; intake part +/-35 kcal/d |
| V7 | 12 wk, 1500 vs 3000 kcal/wk | compensation 943 vs 1007 kcal/wk (62.9 % vs 33.6 %); only 3000 kcal/wk reduced fat [Flack18] | totals within +/-15 %-points |
| V8 | MET-2: 400 vs 600 kcal/session x 5 d/wk x 10 mo, ad libitum | weight -3.9 +/- 4.9 kg and -5.2 +/- 5.6 kg vs +0.5 kg control [Donnelly13]; EI, RMR, NEPA unchanged on average [Washburn15][Willis14] | mean weight loss within +/-1.5 kg given user-fixed intake matched to baseline |
| V9 | Careau DLW cohort | 27.7 % TEE-BEE compensation; 29.7 % at BMI p10, 45.7 % at p90 [Careau21] | metabolic-only sensitivity run c_met 0.28 reproduces 28 % |
| V10 | fat oxidation by intensity | Fatmax 64 +/- 4 % VO2max, zone 55-72 %, ~0 fat oxidation above 89 % (moderately trained cyclists) [Achten02]; 48.3 % and 7.8 mg/kg FFM/min (300 adults) [Venables05]; 0.59 g/min at 49 % (1121 athletes) [Randell17]; keto-adapted 1.54 vs 0.67 g/min and 88 % vs 56 % fat at 64 % VO2max [Volek16] | Fatmax +/-5 %-points, MFO +/-0.08 g/min for the matching preset |
| V11 | muscle glycogen at 71 % VO2max to fatigue | 51.5 mmol/kg wet/h for 2 h then 23 mmol/kg/h; fatigue at 3.02 h with RER 0.85 -> 0.80 [Coyle86]; resting 462 mmol/kg dm [Areta18] | 3-h total depletion within +/-25 %; hour-3 ratio flagged as known under-prediction |
| V12 | fasted vs fed exercise, hypocaloric | no between-group difference in fat/lean mass at 4 wk [Schoenfeld14]; +3.08 g fat oxidised per session [Vieira16]; 24-h fat oxidation 717 vs 456 kcal/d (pre-breakfast vs control) at matched energy [Iwayama15b] | fat-mass difference = 0 within energy-model noise; session fat +2-5 g |
| V13 | HIIT vs MICT | fat mass -1.38 vs -0.91 kg, no difference [Keating17]; HIIT ~40 % less time [Wewege17] | no intensity multiplier on fat loss |
| V14 | HERITAGE 20 wk | VO2max +18 +/- 9 % (+384 +/- 202 ml/min), range -5..+51 % [Bouchard99][Ross19] | Monte-Carlo mean +/-4 %-points, SD 7-11 |
| V15 | constant training | t1/2 of VO2max rise 10.3-10.8 d; plateau after ~3 wk at fixed load [Hickson81] | fast-pool tau 15 d |
| V16 | detraining, athletes | -7 % at 21 d, -16 % at 56 d; CS t1/2 12 d [Coyle84]; no VO2max loss with 1 high-intensity bout/wk for 4 wk but endurance capacity -21 % [Madsen93] | +/-4 %-points at 21 d; 0 +/-2 % with maintenance |
| V17 | high-volume HIIT | 20 d twice-daily: CS +40-50 %; after 2 wk reduced volume CS +36 % while other markers return to baseline [Granata16b] | M_c* 1.4-1.5 at MEM >= 400; M_r back to 1.0 in 2 wk |
| V18 | insulin | single 60-min bout: elevated at 48 h, gone at 5 d [Mikines88]; HOMA-IR -32 % only above ~900 kcal [Magkos08]; chronic SI +~85 % at ~170 min/wk vs +~40 % at 115 min/wk vigorous [Houmard04] | acute decay t1/2 ~40 h |
| V19 | concurrent training | SMD hypertrophy -0.01, max strength -0.06, explosive -0.28 [Schumann22]; fibre -0.23 [Lundberg22] | multipliers in 4.11 |
| V20 | steps | 7000 vs 2000 steps/d HR 0.53 all-cause; 0.75 CVD; 0.62 dementia [Ding25]; quartile HRs 0.60/0.55/0.47 [Paluch22]; +1000 steps HR 0.85 [Banach23] | `assocHR(7000)` = 0.53 +/- 0.02 |
| V21 | LEA | LH pulsatility unaffected at 30 kcal/kg LBM/d, disrupted below [Loucks03]; menstrual disturbance OR 0.91 per +1 unit EA [Lieberman18] | EA warning at 30 |
| V22 | visceral/liver fat | exercise without weight loss VAT -6.1 % (diet -1.1 %) [Verheggen16]; 4 wk: VAT -12 %, liver TG -21 % [Johnson09]; liver fat -2.85 % (HIIT) / -3.14 % (MICT) [Sabag22] | sign and order of magnitude |

## 8. Myths / contested claims

1. **"Fat-burning zone" for fat loss.** Fat oxidation per minute peaks at ~48-70 % VO2max depending on training/diet, but fat *mass* follows energy balance; HIIT and MICT give equal fat-mass loss per week and HIIT only saves time [Keating17][Wewege17][Achten02].
2. **"Afterburn" burns hundreds of calories.** EPOC is 6-15 % of net session cost and only after long/hard sessions; typical HIIT afterburn 20-60 kcal [LaForgia06][Panissa21]. Knab's +190 kcal came after 45 min at ~73 % VO2max [Knab11].
3. **Fasted cardio burns more fat.** Only during the session (~3 g) and in 24-h substrate partition at matched intake; body-composition trials show no difference; fasted state may raise hunger [Vieira16][Schoenfeld14][Hackett17][Iwayama15b][Frampton22].
4. **Exercise calories add linearly to TDEE.** Contested: DLW cross-sectional data show ~28 % compensation (more in higher adiposity) and a plateau above ~230 counts/min [Careau21][Pontzer16]; RCTs show total compensation 30-65 % mostly via intake [Martin19][Flack18]; but supervised trials with monitored intake reach full expression [Ross00][Westerterp13].
5. **You always compensate fully.** Same-day intake does not rise after a bout [Schubert13]; weight loss of 4-5 kg over 10 months with 2000-3000 kcal/wk is achievable without dieting [Donnelly13].
6. **10,000 steps is a magic number.** Mortality benefit plateaus at ~6,000-8,000 (>= 60 y) or 8,000-10,000 (< 60 y) [Paluch22]; 7000 vs 2000 gives HR 0.53 [Ding25]; observational.
7. **Cardio kills muscle gains.** No interference for whole-muscle hypertrophy or max strength; small for explosive strength and type I fibre size with running [Schumann22][Lundberg22]; older meta-analysis suggested more [Wilson12]; molecular studies show none acutely [Donges12].
8. **Low-carb adaptation spares glycogen / makes athletes faster.** Muscle glycogen depletion identical in elite runners at 64 % VO2max [Volek16]; LCHF impaired economy and performance in elite walkers [Burke17]; periodised carbohydrate restriction has no performance benefit (SMD 0.17, CI -0.15..0.49) [Gejl21].
9. **Cardio machines/wearables measure calories.** No consumer device < 20 % median error [Shcherbina17]; standard METs bias individuals (89 % under-estimated vs individually referenced) [Herrmann24-corrMET].
10. **VO2max "responders/non-responders" are fixed traits.** Non-response is dose-dependent and can be abolished with more training [Montero17]; heritability of response 47 % [Bouchard99].
11. **Resistance training "burns fat for 48 h".** Hard sessions did not raise RMR at 12-48 h [Abboud13]; a review notes more prolonged EPOC after hard vs moderate RT but with no dose-response [Borsheim03].
12. **Morning (or evening) exercise is best.** Evidence conflicts across small, mostly observational studies [Willis20][Savikj19][Mancilla21][Albalak23].

## 9. Safety bounds

- **PAL ceiling:** sustained PAL > 2.4 is "difficult to maintain" [FAO04]; sustainable 2.0-2.5 [Westerterp13] -> warn at PAL > 2.4; hard cap 3.0 unless an athlete flag is set (athletes ~4.0 [Westerterp13]).
- **Energy availability:** warn < 45 (reduced), < 30 (LEA); severe < 20 (17 decides the exact banding) [Loucks03][Lieberman18][Mountjoy23]; block planner regimens that hold EA < 30 for > 7 days.
- **Overreaching:** if `mem7d` rises > 50 % week-on-week while EA < 45 or sleep debt (16), raise an overreaching flag and cap VO2max/mito gain multipliers at 0.8 (PROPOSED; Meeusen13 gives no numbers).
- **Dose caps (PROPOSED guardrails):** single continuous bout > 4 h, > 150 km/wk running, or > 15 h/wk aerobic training -> "outside modelled range" banner; planner may not exceed 1.5x the user's 4-wk average weekly load in any single week (no citation; conventional practice).
- **Fasted or morning high-intensity exercise in diabetes:** morning HIIT raised CGM glucose in T2DM [Savikj19]; post-meal walking is the lower-risk option; insulin/sulfonylurea users: refer to 17.
- **Wearables vs equations:** always show ranges; never claim clinical accuracy [Shcherbina17].
- **Claims about mortality:** phrase as associations; do not state individual absolute risk reductions [Kodama09][Mandsager18][Ding25].
- **Ramp and injury:** no verified quantitative injury model was found; rely on 17 for medical screening (e.g., cardiovascular risk before vigorous exercise in inactive people).
- **Downhill and load:** ACSM grade term negative downhill is invalid; clamp grade to +/-15 % and use the Minetti ratio [Minetti02].

## 10. Open questions / weakest assumptions

1. **Compensation split.** Metabolic vs appetite share is not identifiable from weight-based totals; Careau (cross-sectional) suggests 28 % TEE compensation, E-MECHANIC shows none in RMR/NEAT but intake +90-124 kcal/d. Default c_met = 0.15 is a compromise (grade C). Lags (14 d, 28 d) are guesses (grade D).
2. **Compensation vs adiposity anchors.** BMI of the 10th/90th percentile in Careau are not stated in the text (UNVERIFIED 20/33); direction (more compensation with more fat) is cross-sectional and may be individual trait vs within-person effect.
3. **Long-term drift.** Riou's extrapolation to ~84 % compensation at ~80 wk is regression-based; off by default.
4. **Minetti coefficients** recalled from memory (endpoint-verified only). Verify against the paper before shipping; ACSM alternative retained.
5. **Step-length rule 0.415 H** is a heuristic; per-step cost mildly sensitive to cadence/step length; verify with a gait dataset. Cost per 1000 steps is ~+/-20 % individually.
6. **Fat-oxidation presets** are non-unique fits to group means; individual SD is large (MFO SD 0.18 g/min in athletes; > 50 % of variance unexplained) [Randell17].
7. **VO2max dose function** over-predicts short (6-wk) low/mid-dose gains (Montero) and under-predicts very short HIIT studies; two-pool split and tauS = 60 d are inferred. Sex effect conflicting (meta-analysis vs HERITAGE).
8. **Mitochondrial index** is a composite of a few small biopsy studies (n = 6-29 men); female data scarce; retained fraction rho and its dependence on years of training are 2-point anchored (grade C).
9. **HIIT/RT glycogen use** whole-body values are model-based; need fibre-type-level data.
10. **Timing of exercise** (clock time) evidence is contradictory; not modelled.
11. **Constrained TEE model validity** (does TEE plateau?) remains debated; sensitivity run must show both.
12. **Sedentary-time effects** beyond steps (breaks, posture) only via glucose acute effects; cohort HRs confounded.
13. **Bout-level individual heterogeneity** (responders) is expressed as random effects but not tied to genotype; Monte-Carlo option only.
14. **RT session energy** is uncertain by +/-30 % (anaerobic cost unmeasured by indirect calorimetry) [Mitchell24].
15. **EA convention** (net vs gross exercise energy) should be fixed jointly with 17; current choice net-of-resting is UNVERIFIED as to the source papers' convention.

## 11. References

Keys in square brackets are used throughout the text. Fetch dates 2026-09-30. PubMed URLs resolve to abstracts; full texts via Europe PMC/PMC where open.

**Non-PubMed sources**
- [Herrmann24-units] Compendium of Physical Activities, unit conversions page (1 MET = 3.5 ml/kg/min; kcal/min = METs x 3.5 x kg / 200). https://pacompendium.com/unite-conversions/
- [Herrmann24-corrMET] Compendium of Physical Activities, "Corrected METs - Adults" page (Harris-Benedict-based correction; cites Byrne 2005, Kozey 2010 J Phys Act Health 7(4):508-516 [not opened], Howley 2011 critique). https://pacompendium.com/corrected-mets/ ; category tables: https://pacompendium.com/walking/ , /running , /bicycling , /conditioning-exercise , /water-activities , /sports , /inactivity , /occupation , /transportation ; 2024 PDF https://pacompendium.com/wp-content/uploads/2025/02/1_2024-adult-compendium_1_2024.pdf
- [TTU13] Texas Tech University, "HFI Metabolic Calculations" (worked examples of ACSM walking, running and leg-ergometry equations, kcal/min = METs x 3.5 x kg / 200), 2013. https://www.depts.ttu.edu/ksm/_documents/grad/acsm_comps/6c-23-2013_HFI_Metabolic_Calculations.pdf (primary source: ACSM's Guidelines for Exercise Testing and Prescription; book not opened)
- [PAR-instrument] Jackson AS et al. 1990 Physical Activity Rating (PA-R) 0-7 scale as reproduced in the supplementary appendix of Ann Occup Environ Med (2018) https://www.aoemj.org/upload/media/40557_2018_240_MOESM1_ESM.docx
- [FAO04] FAO/WHO/UNU. Human energy requirements. Report of a Joint FAO/WHO/UNU Expert Consultation (Rome 2001), FAO Food and Nutrition Technical Report Series 1, 2004; chapter 5 (PAL categories and worked examples) https://www.fao.org/4/y5686e/y5686e07.htm
- [Hackett17] Hackett D, Hagstrom A. Effect of Overnight Fasted Exercise on Weight Loss and Body Composition: A Systematic Review and Meta-Analysis. J Funct Morphol Kinesiol 2017;2(4):43. doi:10.3390/jfmk2040043. https://www.mdpi.com/2411-5142/2/4/43 (abstract read via https://rune.une.edu.au/web/handle/1959.11/22896)
- Jeukendrup & Wallis high-intensity CHO coefficients (4.344 / 3.061) came from a secondary web summary: UNVERIFIED at source; low-intensity coefficients (4.210/2.962; 1.695/1.701) confirmed in [Ahn22] and [Jung23].

**PubMed-indexed sources (auto-formatted from PubMed/Europe PMC metadata)**
1. [Abboud13] Abboud GJ, Greer BK, Campbell SC et al. Effects of load-volume on EPOC after acute bouts of resistance training in resistance-trained men. Journal of strength and conditioning research 2013:1936-1941. doi:10.1519/jsc.0b013e3182772eed. PMID 23085971. https://pubmed.ncbi.nlm.nih.gov/23085971/
2. [Achten02] Achten J, Gleeson M, Jeukendrup AE. Determination of the exercise intensity that elicits maximal fat oxidation. Medicine and science in sports and exercise 2002:92-97. doi:10.1097/00005768-200201000-00015. PMID 11782653. https://pubmed.ncbi.nlm.nih.gov/11782653/
3. [Ahn22] Ahn HN, Lee MG, Jung WS. Effects of gradient and age on energy expenditure and fat metabolism during aerobic exercise at equal intensity in women. Physical activity and nutrition 2022:20-27. doi:10.20463/pan.2022.0004. PMID 35510442. https://pubmed.ncbi.nlm.nih.gov/35510442/
4. [Albalak23] Albalak G, Stijntjes M, van Bodegom D et al. Setting your clock: associations between timing of objective physical activity and cardiovascular disease risk in the general population. European journal of preventive cardiology 2023:232-240. doi:10.1093/eurjpc/zwac239. PMID 36372091. https://pubmed.ncbi.nlm.nih.gov/36372091/
5. [Areta18] Areta JL, Hopkins WG. Skeletal Muscle Glycogen Content at Rest and During Endurance Exercise in Humans: A Meta-Analysis. Sports medicine (Auckland, N.Z.) 2018:2091-2102. doi:10.1007/s40279-018-0941-1. PMID 29923148. https://pubmed.ncbi.nlm.nih.gov/29923148/
6. [Bachman16] Bachman JL, Deitrick RW, Hillman AR. Exercising in the Fasted State Reduced 24-Hour Energy Intake in Active Male Adults. Journal of nutrition and metabolism 2016:1984198. doi:10.1155/2016/1984198. PMID 27738523. https://pubmed.ncbi.nlm.nih.gov/27738523/
7. [Bacon13] Bacon AP, Carter RE, Ogle EA et al. VO2max trainability and high intensity interval training in humans: a meta-analysis. PloS one 2013:e73182. doi:10.1371/journal.pone.0073182. PMID 24066036. https://pubmed.ncbi.nlm.nih.gov/24066036/
8. [Bajpeyi09] Bajpeyi S, Tanner CJ, Slentz CA et al. Effect of exercise intensity and volume on persistence of insulin sensitivity during training cessation. Journal of applied physiology (Bethesda, Md. : 1985) 2009:1079-1085. doi:10.1152/japplphysiol.91262.2008. PMID 19196913. https://pubmed.ncbi.nlm.nih.gov/19196913/
9. [Banach23] Banach M, Lewek J, Surma S et al. The association between daily step count and all-cause and cardiovascular mortality: a meta-analysis. European journal of preventive cardiology 2023:1975-1985. doi:10.1093/eurjpc/zwad229. PMID 37555441. https://pubmed.ncbi.nlm.nih.gov/37555441/
10. [Bassett04] Bassett DR, Schneider PL, Huntington GE. Physical activity in an Old Order Amish community. Medicine and science in sports and exercise 2004:79-85. doi:10.1249/01.mss.0000106184.71258.32. PMID 14707772. https://pubmed.ncbi.nlm.nih.gov/14707772/
11. [Bassett10] Bassett DR, Wyatt HR, Thompson H et al. Pedometer-measured physical activity and health behaviors in U.S. adults. Medicine and science in sports and exercise 2010:1819-1825. doi:10.1249/mss.0b013e3181dc2e54. PMID 20305579. https://pubmed.ncbi.nlm.nih.gov/20305579/
12. [Batliner18] Batliner ME, Kipp S, Grabowski AM et al. Does Metabolic Rate Increase Linearly with Running Speed in all Distance Runners?. Sports medicine international open 2018:E1-E8. doi:10.1055/s-0043-122068. PMID 30539111. https://pubmed.ncbi.nlm.nih.gov/30539111/
13. [Beaulieu21] Beaulieu K, Blundell JE, van Baak MA et al. Effect of exercise training interventions on energy intake and appetite control in adults with overweight or obesity: A systematic review and meta-analysis. Obesity reviews : an official journal of the International Association for the Study of Obesity 2021:e13251. doi:10.1111/obr.13251. PMID 33949089. https://pubmed.ncbi.nlm.nih.gov/33949089/
14. [BirdHawley16] Bird SR, Hawley JA. Update on the effects of physical activity on insulin sensitivity in humans. BMJ open sport & exercise medicine 2016:e000143. doi:10.1136/bmjsem-2016-000143. PMID 28879026. https://pubmed.ncbi.nlm.nih.gov/28879026/
15. [Bohannon07] Bohannon RW. Number of pedometer-assessed steps taken per day by adults: a descriptive meta-analysis. Physical therapy 2007:1642-1650. doi:10.2522/ptj.20060037. PMID 17911274. https://pubmed.ncbi.nlm.nih.gov/17911274/
16. [Borsheim03] Børsheim E, Bahr R. Effect of exercise intensity, duration and mode on post-exercise oxygen consumption. Sports medicine (Auckland, N.Z.) 2003:1037-1060. doi:10.2165/00007256-200333140-00002. PMID 14599232. https://pubmed.ncbi.nlm.nih.gov/14599232/
17. [Bouchard99] Bouchard C, An P, Rice T et al. Familial aggregation of VO(2max) response to exercise training: results from the HERITAGE Family Study. Journal of applied physiology (Bethesda, Md. : 1985) 1999:1003-1008. doi:10.1152/jappl.1999.87.3.1003. PMID 10484570. https://pubmed.ncbi.nlm.nih.gov/10484570/
18. [Broom09] Broom DR, Batterham RL, King JA et al. Influence of resistance and aerobic exercise on hunger, circulating levels of acylated ghrelin, and peptide YY in healthy males. American journal of physiology. Regulatory, integrative and comparative physiology 2009:R29-35. doi:10.1152/ajpregu.90706.2008. PMID 18987287. https://pubmed.ncbi.nlm.nih.gov/18987287/
19. [Broskey21] Broskey NT, Martin CK, Burton JH et al. Effect of Aerobic Exercise-induced Weight Loss on the Components of Daily Energy Expenditure. Medicine and science in sports and exercise 2021:2164-2172. doi:10.1249/mss.0000000000002689. PMID 34519717. https://pubmed.ncbi.nlm.nih.gov/34519717/
20. [Browning06] Browning RC, Baker EA, Herron JA et al. Effects of obesity and sex on the energetic cost and preferred speed of walking. Journal of applied physiology (Bethesda, Md. : 1985) 2006:390-398. doi:10.1152/japplphysiol.00767.2005. PMID 16210434. https://pubmed.ncbi.nlm.nih.gov/16210434/
21. [Buffey22] Buffey AJ, Herring MP, Langley CK et al. The Acute Effects of Interrupting Prolonged Sitting Time in Adults with Standing and Light-Intensity Walking on Biomarkers of Cardiometabolic Health in Adults: A Systematic Review and Meta-analysis. Sports medicine (Auckland, N.Z.) 2022:1765-1787. doi:10.1007/s40279-022-01649-4. PMID 35147898. https://pubmed.ncbi.nlm.nih.gov/35147898/
22. [Burke17] Burke LM, Ross ML, Garvican-Lewis LA et al. Low carbohydrate, high fat diet impairs exercise economy and negates the performance benefit from intensified training in elite race walkers. The Journal of physiology 2017:2785-2807. doi:10.1113/jp273230. PMID 28012184. https://pubmed.ncbi.nlm.nih.gov/28012184/
23. [Byrne05] Byrne NM, Hills AP, Hunter GR et al. Metabolic equivalent: one size does not fit all. Journal of applied physiology (Bethesda, Md. : 1985) 2005:1112-1119. doi:10.1152/japplphysiol.00023.2004. PMID 15831804. https://pubmed.ncbi.nlm.nih.gov/15831804/
24. [Careau21] Careau V, Halsey LG, Pontzer H et al. Energy compensation and adiposity in humans. Current biology : CB 2021:4659-4666.e2. doi:10.1016/j.cub.2021.08.016. PMID 34453886. https://pubmed.ncbi.nlm.nih.gov/34453886/
25. [Chastin09] Chastin SF, Dall PM, Tigbe WW et al. Compliance with physical activity guidelines in a group of UK-based postal workers using an objective monitoring technique. European journal of applied physiology 2009:893-899. doi:10.1007/s00421-009-1090-x. PMID 19488779. https://pubmed.ncbi.nlm.nih.gov/19488779/
26. [Chavez23] Chávez-Guevara IA, Amaro-Gahete FJ, Ramos-Jiménez A et al. Toward Exercise Guidelines for Optimizing Fat Oxidation During Exercise in Obesity: A Systematic Review and Meta-Regression. Sports medicine (Auckland, N.Z.) 2023:2399-2416. doi:10.1007/s40279-023-01897-y. PMID 37584843. https://pubmed.ncbi.nlm.nih.gov/37584843/
27. [Chomentowski09] Chomentowski P, Dubé JJ, Amati F et al. Moderate exercise attenuates the loss of skeletal muscle mass that occurs with intentional caloric restriction-induced weight loss in older, overweight to obese adults. The journals of gerontology. Series A, Biological sciences and medical sciences 2009:575-580. doi:10.1093/gerona/glp007. PMID 19276190. https://pubmed.ncbi.nlm.nih.gov/19276190/
28. [Coyle84] Coyle EF, Martin WH, Sinacore DR et al. Time course of loss of adaptations after stopping prolonged intense endurance training. Journal of applied physiology: respiratory, environmental and exercise physiology 1984:1857-1864. doi:10.1152/jappl.1984.57.6.1857. PMID 6511559. https://pubmed.ncbi.nlm.nih.gov/6511559/
29. [Coyle86] Coyle EF, Coggan AR, Hemmert MK et al. Muscle glycogen utilization during prolonged strenuous exercise when fed carbohydrate. Journal of applied physiology (Bethesda, Md. : 1985) 1986:165-172. doi:10.1152/jappl.1986.61.1.165. PMID 3525502. https://pubmed.ncbi.nlm.nih.gov/3525502/
30. [Deighton14] Deighton K, Stensel DJ. Creating an acute energy deficit without stimulating compensatory increases in appetite: is there an optimal exercise protocol?. The Proceedings of the Nutrition Society 2014:352-358. doi:10.1017/s002966511400007x. PMID 24717417. https://pubmed.ncbi.nlm.nih.gov/24717417/
31. [Diaz-Canestro19] Diaz-Canestro C, Montero D. Sex Dimorphism of VO<sub>2max</sub> Trainability: A Systematic Review and Meta-analysis. Sports medicine (Auckland, N.Z.) 2019:1949-1956. doi:10.1007/s40279-019-01180-z. PMID 31494865. https://pubmed.ncbi.nlm.nih.gov/31494865/
32. [Ding25] Ding D, Nguyen B, Nau T et al. Daily steps and health outcomes in adults: a systematic review and dose-response meta-analysis. The Lancet. Public health 2025:e668-e681. doi:10.1016/s2468-2667(25)00164-1. PMID 40713949. https://pubmed.ncbi.nlm.nih.gov/40713949/
33. [Donges12] Donges CE, Burd NA, Duffield R et al. Concurrent resistance and aerobic exercise stimulates both myofibrillar and mitochondrial protein synthesis in sedentary middle-aged men. Journal of applied physiology (Bethesda, Md. : 1985) 2012:1992-2001. doi:10.1152/japplphysiol.00166.2012. PMID 22492939. https://pubmed.ncbi.nlm.nih.gov/22492939/
34. [Donnelly13] Donnelly JE, Honas JJ, Smith BK et al. Aerobic exercise alone results in clinically significant weight loss for men and women: midwest exercise trial 2. Obesity (Silver Spring, Md.) 2013:E219-28. doi:10.1002/oby.20145. PMID 23592678. https://pubmed.ncbi.nlm.nih.gov/23592678/
35. [Dorling18] Dorling J, Broom DR, Burns SF et al. Acute and Chronic Effects of Exercise on Appetite, Energy Intake, and Appetite-Related Hormones: The Modulating Effect of Adiposity, Sex, and Habitual Physical Activity. Nutrients 2018:E1140. doi:10.3390/nu10091140. PMID 30131457. https://pubmed.ncbi.nlm.nih.gov/30131457/
36. [Dunstan12] Dunstan DW, Kingwell BA, Larsen R et al. Breaking up prolonged sitting reduces postprandial glucose and insulin responses. Diabetes care 2012:976-983. doi:10.2337/dc11-1931. PMID 22374636. https://pubmed.ncbi.nlm.nih.gov/22374636/
37. [Duscha05] Duscha BD, Slentz CA, Johnson JL et al. Effects of exercise training amount and intensity on peak oxygen consumption in middle-age men and women at risk for cardiovascular disease. Chest 2005:2788-2793. doi:10.1378/chest.128.4.2788. PMID 16236956. https://pubmed.ncbi.nlm.nih.gov/16236956/
38. [Egan13] Egan B, O'Connor PL, Zierath JR et al. Time course analysis reveals gene-specific transcript and protein kinetics of adaptation to short-term aerobic exercise training in human skeletal muscle. PloS one 2013:e74098. doi:10.1371/journal.pone.0074098. PMID 24069271. https://pubmed.ncbi.nlm.nih.gov/24069271/
39. [Ekelund16] Ekelund U, Steene-Johannessen J, Brown WJ et al. Does physical activity attenuate, or even eliminate, the detrimental association of sitting time with mortality? A harmonised meta-analysis of data from more than 1 million men and women. Lancet (London, England) 2016:1302-1310. doi:10.1016/s0140-6736(16)30370-1. PMID 27475271. https://pubmed.ncbi.nlm.nih.gov/27475271/
40. [Ekelund19] Ekelund U, Tarp J, Steene-Johannessen J et al. Dose-response associations between accelerometry measured physical activity and sedentary time and all cause mortality: systematic review and harmonised meta-analysis. BMJ (Clinical research ed.) 2019:l4570. doi:10.1136/bmj.l4570. PMID 31434697. https://pubmed.ncbi.nlm.nih.gov/31434697/
41. [Engeroff23] Engeroff T, Groneberg DA, Wilke J. After Dinner Rest a While, After Supper Walk a Mile? A Systematic Review with Meta-analysis on the Acute Postprandial Glycemic Response to Exercise Before and After Meal Ingestion in Healthy Subjects and Patients with Impaired Glucose Tolerance. Sports medicine (Auckland, N.Z.) 2023:849-869. doi:10.1007/s40279-022-01808-7. PMID 36715875. https://pubmed.ncbi.nlm.nih.gov/36715875/
42. [Ettema09] Ettema G, Lorås HW. Efficiency in cycling: a review. European journal of applied physiology 2009:1-14. doi:10.1007/s00421-009-1008-7. PMID 19229554. https://pubmed.ncbi.nlm.nih.gov/19229554/
43. [Fedewa17] Fedewa MV, Hathaway ED, Williams TD et al. Effect of Exercise Training on Non-Exercise Physical Activity: A Systematic Review and Meta-Analysis of Randomized Controlled Trials. Sports medicine (Auckland, N.Z.) 2017:1171-1182. doi:10.1007/s40279-016-0649-z. PMID 27873191. https://pubmed.ncbi.nlm.nih.gov/27873191/
44. [Flack18] Flack KD, Ufholz K, Johnson L et al. Energy compensation in response to aerobic exercise training in overweight adults. American journal of physiology. Regulatory, integrative and comparative physiology 2018:R619-R626. doi:10.1152/ajpregu.00071.2018. PMID 29897822. https://pubmed.ncbi.nlm.nih.gov/29897822/
45. [Flack20] Flack KD, Hays HM, Moreland J et al. Exercise for Weight Loss: Further Evaluating Energy Compensation with Exercise. Medicine and science in sports and exercise 2020:2466-2475. doi:10.1249/mss.0000000000002376. PMID 33064415. https://pubmed.ncbi.nlm.nih.gov/33064415/
46. [Flanagan24] Flanagan EW, Sanchez-Delgado G, Martin CK et al. No evidence for metabolic adaptation during exercise-related energy compensation. iScience 2024:109842. doi:10.1016/j.isci.2024.109842. PMID 38947494. https://pubmed.ncbi.nlm.nih.gov/38947494/
47. [Fleg05] Fleg JL, Morrell CH, Bos AG et al. Accelerated longitudinal decline of aerobic capacity in healthy older adults. Circulation 2005:674-682. doi:10.1161/circulationaha.105.545459. PMID 16043637. https://pubmed.ncbi.nlm.nih.gov/16043637/
48. [Frampton22] Frampton J, Edinburgh RM, Ogden HB et al. The acute effect of fasted exercise on energy intake, energy expenditure, subjective hunger and gastrointestinal hormone release compared to fed exercise in healthy individuals: a systematic review and network meta-analysis. International journal of obesity (2005) 2022:255-268. doi:10.1038/s41366-021-00993-1. PMID 34732837. https://pubmed.ncbi.nlm.nih.gov/34732837/
49. [Frandsen21] Frandsen J, Amaro-Gahete FJ, Landgrebe A et al. The influence of age, sex and cardiorespiratory fitness on maximal fat oxidation rate. Applied physiology, nutrition, and metabolism = Physiologie appliquee, nutrition et metabolisme 2021:1241-1247. doi:10.1139/apnm-2021-0080. PMID 33848440. https://pubmed.ncbi.nlm.nih.gov/33848440/
50. [Fyfe14] Fyfe JJ, Bishop DJ, Stepto NK. Interference between concurrent resistance and endurance exercise: molecular bases and the role of individual training variables. Sports medicine (Auckland, N.Z.) 2014:743-762. doi:10.1007/s40279-014-0162-1. PMID 24728927. https://pubmed.ncbi.nlm.nih.gov/24728927/
51. [Gejl21] Gejl KD, Nybo L. Performance effects of periodized carbohydrate restriction in endurance trained athletes - a systematic review and meta-analysis. Journal of the International Society of Sports Nutrition 2021:37. doi:10.1186/s12970-021-00435-3. PMID 34001184. https://pubmed.ncbi.nlm.nih.gov/34001184/
52. [Gonzalez16] Gonzalez JT, Fuchs CJ, Betts JA et al. Liver glycogen metabolism during and after prolonged endurance-type exercise. American journal of physiology. Endocrinology and metabolism 2016:E543-53. doi:10.1152/ajpendo.00232.2016. PMID 27436612. https://pubmed.ncbi.nlm.nih.gov/27436612/
53. [Granata16a] Granata C, Oliveira RS, Little JP et al. Training intensity modulates changes in PGC-1α and p53 protein content and mitochondrial respiration, but not markers of mitochondrial content in human skeletal muscle. FASEB journal : official publication of the Federation of American Societies for Experimental Biology 2016:959-970. doi:10.1096/fj.15-276907. PMID 26572168. https://pubmed.ncbi.nlm.nih.gov/26572168/
54. [Granata16b] Granata C, Oliveira RS, Little JP et al. Mitochondrial adaptations to high-volume exercise training are rapidly reversed after a reduction in training volume in human skeletal muscle. FASEB journal : official publication of the Federation of American Societies for Experimental Biology 2016:3413-3423. doi:10.1096/fj.201500100r. PMID 27402675. https://pubmed.ncbi.nlm.nih.gov/27402675/
55. [Granata18] Granata C, Jamnick NA, Bishop DJ. Training-Induced Changes in Mitochondrial Content and Respiratory Function in Human Skeletal Muscle. Sports medicine (Auckland, N.Z.) 2018:1809-1828. doi:10.1007/s40279-018-0936-y. PMID 29934848. https://pubmed.ncbi.nlm.nih.gov/29934848/
56. [Haff00] Haff GG, Koch AJ, Potteiger JA et al. Carbohydrate supplementation attenuates muscle glycogen loss during acute bouts of resistance exercise. International journal of sport nutrition and exercise metabolism 2000:326-339. doi:10.1123/ijsnem.10.3.326. PMID 10997956. https://pubmed.ncbi.nlm.nih.gov/10997956/
57. [Hall04] Hall C, Figueroa A, Fernhall B et al. Energy expenditure of walking and running: comparison with prediction equations. Medicine and science in sports and exercise 2004:2128-2134. doi:10.1249/01.mss.0000147584.87788.0e. PMID 15570150. https://pubmed.ncbi.nlm.nih.gov/15570150/
58. [Hawkins03] Hawkins S, Wiswell R. Rate and mechanism of maximal oxygen consumption decline with aging: implications for exercise training. Sports medicine (Auckland, N.Z.) 2003:877-888. doi:10.2165/00007256-200333120-00002. PMID 12974656. https://pubmed.ncbi.nlm.nih.gov/12974656/
59. [Herrmann15] Herrmann SD, Willis EA, Honas JJ et al. Energy intake, nonexercise physical activity, and weight loss in responders and nonresponders: The Midwest Exercise Trial 2. Obesity (Silver Spring, Md.) 2015:1539-1549. doi:10.1002/oby.21073. PMID 26193059. https://pubmed.ncbi.nlm.nih.gov/26193059/
60. [Herrmann24] Herrmann SD, Willis EA, Ainsworth BE et al. 2024 Adult Compendium of Physical Activities: A third update of the energy costs of human activities. Journal of sport and health science 2024:6-12. doi:10.1016/j.jshs.2023.10.010. PMID 38242596. https://pubmed.ncbi.nlm.nih.gov/38242596/
61. [Heymsfield14] Heymsfield SB, Gonzalez MC, Shen W et al. Weight loss composition is one-fourth fat-free mass: a critical review and critique of this widely cited rule. Obesity reviews : an official journal of the International Association for the Study of Obesity 2014:310-321. doi:10.1111/obr.12143. PMID 24447775. https://pubmed.ncbi.nlm.nih.gov/24447775/
62. [Hickson81] Hickson RC, Hagberg JM, Ehsani AA et al. Time course of the adaptive responses of aerobic power and heart rate to training. Medicine and science in sports and exercise 1981:17-20. doi:10.1249/00005768-198101000-00012. PMID 7219130. https://pubmed.ncbi.nlm.nih.gov/7219130/
63. [Holloszy84] Holloszy JO, Coyle EF. Adaptations of skeletal muscle to endurance exercise and their metabolic consequences. Journal of applied physiology: respiratory, environmental and exercise physiology 1984:831-838. doi:10.1152/jappl.1984.56.4.831. PMID 6373687. https://pubmed.ncbi.nlm.nih.gov/6373687/
64. [Houmard04] Houmard JA, Tanner CJ, Slentz CA et al. Effect of the volume and intensity of exercise training on insulin sensitivity. Journal of applied physiology (Bethesda, Md. : 1985) 2004:101-106. doi:10.1152/japplphysiol.00707.2003. PMID 12972442. https://pubmed.ncbi.nlm.nih.gov/12972442/
65. [Huang16] Huang G, Wang R, Chen P et al. Dose-response relationship of cardiorespiratory fitness adaptation to controlled endurance training in sedentary older adults. European journal of preventive cardiology 2016:518-529. doi:10.1177/2047487315582322. PMID 25901000. https://pubmed.ncbi.nlm.nih.gov/25901000/
66. [Impey18] Impey SG, Hearris MA, Hammond KM et al. Fuel for the Work Required: A Theoretical Framework for Carbohydrate Periodization and the Glycogen Threshold Hypothesis. Sports medicine (Auckland, N.Z.) 2018:1031-1048. doi:10.1007/s40279-018-0867-7. PMID 29453741. https://pubmed.ncbi.nlm.nih.gov/29453741/
67. [Islam18] Islam H, Townsend LK, Hazell TJ. Excess Postexercise Oxygen Consumption and Fat Utilization Following Submaximal Continuous and Supramaximal Interval Running. Research quarterly for exercise and sport 2018:450-456. doi:10.1080/02701367.2018.1513633. PMID 30325710. https://pubmed.ncbi.nlm.nih.gov/30325710/
68. [Ismail12] Ismail I, Keating SE, Baker MK et al. A systematic review and meta-analysis of the effect of aerobic vs. resistance exercise training on visceral fat. Obesity reviews : an official journal of the International Association for the Study of Obesity 2012:68-91. doi:10.1111/j.1467-789x.2011.00931.x. PMID 21951360. https://pubmed.ncbi.nlm.nih.gov/21951360/
69. [Iwayama15a] Iwayama K, Kawabuchi R, Park I et al. Transient energy deficit induced by exercise increases 24-h fat oxidation in young trained men. Journal of applied physiology (Bethesda, Md. : 1985) 2015:80-85. doi:10.1152/japplphysiol.00697.2014. PMID 25554797. https://pubmed.ncbi.nlm.nih.gov/25554797/
70. [Iwayama15b] Iwayama K, Kurihara R, Nabekura Y et al. Exercise Increases 24-h Fat Oxidation Only When It Is Performed Before Breakfast. EBioMedicine 2015:2003-2009. doi:10.1016/j.ebiom.2015.10.029. PMID 26844280. https://pubmed.ncbi.nlm.nih.gov/26844280/
71. [Jackson90] Jackson AS, Blair SN, Mahar MT et al. Prediction of functional aerobic capacity without exercise testing. Medicine and science in sports and exercise 1990:863-870. doi:10.1249/00005768-199012000-00021. PMID 2287267. https://pubmed.ncbi.nlm.nih.gov/2287267/
72. [Jacobs13] Jacobs RA, Flück D, Bonne TC et al. Improvements in exercise performance with high-intensity interval training coincide with an increase in skeletal muscle mitochondrial content and function. Journal of applied physiology (Bethesda, Md. : 1985) 2013:785-793. doi:10.1152/japplphysiol.00445.2013. PMID 23788574. https://pubmed.ncbi.nlm.nih.gov/23788574/
73. [Jelleyman15] Jelleyman C, Yates T, O'Donovan G et al. The effects of high-intensity interval training on glucose regulation and insulin resistance: a meta-analysis. Obesity reviews : an official journal of the International Association for the Study of Obesity 2015:942-961. doi:10.1111/obr.12317. PMID 26481101. https://pubmed.ncbi.nlm.nih.gov/26481101/
74. [Jeukendrup05] Jeukendrup AE, Wallis GA. Measurement of substrate oxidation during exercise by means of gas exchange measurements. International journal of sports medicine 2005:S28-37. doi:10.1055/s-2004-830512. PMID 15702454. https://pubmed.ncbi.nlm.nih.gov/15702454/
75. [Johnson09] Johnson NA, Sachinwalla T, Walton DW et al. Aerobic exercise training reduces hepatic and visceral lipids in obese individuals without weight loss. Hepatology (Baltimore, Md.) 2009:1105-1112. doi:10.1002/hep.23129. PMID 19637289. https://pubmed.ncbi.nlm.nih.gov/19637289/
76. [Jung23] Jung WS, Sun Y, Park HY et al. Comparison of energy consumption and excess post-exercise oxygen consumption according to Taekwondo Taegeuk Poomsae performance in Taekwondo players. Physical activity and nutrition 2023:41-46. doi:10.20463/pan.2023.0005. PMID 37132209. https://pubmed.ncbi.nlm.nih.gov/37132209/
77. [Kaminsky15] Kaminsky LA, Arena R, Myers J. Reference Standards for Cardiorespiratory Fitness Measured With Cardiopulmonary Exercise Testing: Data From the Fitness Registry and the Importance of Exercise National Database. Mayo Clinic proceedings 2015:1515-1523. doi:10.1016/j.mayocp.2015.07.026. PMID 26455884. https://pubmed.ncbi.nlm.nih.gov/26455884/
78. [Kaminsky22] Kaminsky LA, Arena R, Myers J et al. Updated Reference Standards for Cardiorespiratory Fitness Measured with Cardiopulmonary Exercise Testing: Data from the Fitness Registry and the Importance of Exercise National Database (FRIEND). Mayo Clinic proceedings 2022:285-293. doi:10.1016/j.mayocp.2021.08.020. PMID 34809986. https://pubmed.ncbi.nlm.nih.gov/34809986/
79. [Keating12] Keating SE, Hackett DA, George J et al. Exercise and non-alcoholic fatty liver disease: a systematic review and meta-analysis. Journal of hepatology 2012:157-166. doi:10.1016/j.jhep.2012.02.023. PMID 22414768. https://pubmed.ncbi.nlm.nih.gov/22414768/
80. [Keating17] Keating SE, Johnson NA, Mielke GI et al. A systematic review and meta-analysis of interval training versus moderate-intensity continuous training on body adiposity. Obesity reviews : an official journal of the International Association for the Study of Obesity 2017:943-964. doi:10.1111/obr.12536. PMID 28513103. https://pubmed.ncbi.nlm.nih.gov/28513103/
81. [King08] King NA, Hopkins M, Caudwell P et al. Individual variability following 12 weeks of supervised exercise: identification and characterization of compensation for exercise-induced weight loss. International journal of obesity (2005) 2008:177-184. doi:10.1038/sj.ijo.0803712. PMID 17848941. https://pubmed.ncbi.nlm.nih.gov/17848941/
82. [Kipp18] Kipp S, Byrnes WC, Kram R. Calculating metabolic energy expenditure across a wide range of exercise intensities: the equation matters. Applied physiology, nutrition, and metabolism = Physiologie appliquee, nutrition et metabolisme 2018:639-642. doi:10.1139/apnm-2017-0781. PMID 29401411. https://pubmed.ncbi.nlm.nih.gov/29401411/
83. [Knab11] Knab AM, Shanely RA, Corbin KD et al. A 45-minute vigorous exercise bout increases metabolic rate for 14 hours. Medicine and science in sports and exercise 2011:1643-1648. doi:10.1249/mss.0b013e3182118891. PMID 21311363. https://pubmed.ncbi.nlm.nih.gov/21311363/
84. [Kodama09] Kodama S, Saito K, Tanaka S et al. Cardiorespiratory fitness as a quantitative predictor of all-cause mortality and cardiovascular events in healthy men and women: a meta-analysis. JAMA 2009:2024-2035. doi:10.1001/jama.2009.681. PMID 19454641. https://pubmed.ncbi.nlm.nih.gov/19454641/
85. [LaForgia06] LaForgia J, Withers RT, Gore CJ. Effects of exercise intensity and duration on the excess post-exercise oxygen consumption. Journal of sports sciences 2006:1247-1264. doi:10.1080/02640410600552064. PMID 17101527. https://pubmed.ncbi.nlm.nih.gov/17101527/
86. [Lieberman18] Lieberman JL, DE Souza MJ, Wagstaff DA et al. Menstrual Disruption with Exercise Is Not Linked to an Energy Availability Threshold. Medicine and science in sports and exercise 2018:551-561. doi:10.1249/mss.0000000000001451. PMID 29023359. https://pubmed.ncbi.nlm.nih.gov/29023359/
87. [Looney19] Looney DP, Santee WR, Hansen EO et al. Estimating Energy Expenditure during Level, Uphill, and Downhill Walking. Medicine and science in sports and exercise 2019:1954-1960. doi:10.1249/mss.0000000000002002. PMID 30973477. https://pubmed.ncbi.nlm.nih.gov/30973477/
88. [Looney26] Looney DP, Hoogkamer W, Kram R. Metabolic energy expenditure during level, uphill, and downhill running. European journal of applied physiology 2026:1621-1633. doi:10.1007/s00421-025-05999-5. PMID 41057734. https://pubmed.ncbi.nlm.nih.gov/41057734/
89. [Loucks03] Loucks AB, Thuma JR. Luteinizing hormone pulsatility is disrupted at a threshold of energy availability in regularly menstruating women. The Journal of clinical endocrinology and metabolism 2003:297-311. doi:10.1210/jc.2002-020369. PMID 12519869. https://pubmed.ncbi.nlm.nih.gov/12519869/
90. [Loucks11] Loucks AB, Kiens B, Wright HH. Energy availability in athletes. Journal of sports sciences 2011:S7-15. doi:10.1080/02640414.2011.588958. PMID 21793767. https://pubmed.ncbi.nlm.nih.gov/21793767/
91. [Loucks98] Loucks AB, Verdun M, Heath EM. Low energy availability, not stress of exercise, alters LH pulsatility in exercising women. Journal of applied physiology (Bethesda, Md. : 1985) 1998:37-46. doi:10.1152/jappl.1998.84.1.37. PMID 9451615. https://pubmed.ncbi.nlm.nih.gov/9451615/
92. [Ludlow16] Ludlow LW, Weyand PG. Energy expenditure during level human walking: seeking a simple and accurate predictive solution. Journal of applied physiology (Bethesda, Md. : 1985) 2016:481-494. doi:10.1152/japplphysiol.00864.2015. PMID 26679617. https://pubmed.ncbi.nlm.nih.gov/26679617/
93. [Ludlow17] Ludlow LW, Weyand PG. Walking economy is predictably determined by speed, grade, and gravitational load. Journal of applied physiology (Bethesda, Md. : 1985) 2017:1288-1302. doi:10.1152/japplphysiol.00504.2017. PMID 28729390. https://pubmed.ncbi.nlm.nih.gov/28729390/
94. [Lundberg22] Lundberg TR, Feuerbacher JF, Sünkeler M et al. The Effects of Concurrent Aerobic and Strength Training on Muscle Fiber Hypertrophy: A Systematic Review and Meta-Analysis. Sports medicine (Auckland, N.Z.) 2022:2391-2403. doi:10.1007/s40279-022-01688-x. PMID 35476184. https://pubmed.ncbi.nlm.nih.gov/35476184/
95. [MacInnis17] MacInnis MJ, Zacharewicz E, Martin BJ et al. Superior mitochondrial adaptations in human skeletal muscle after interval compared to continuous single-leg cycling matched for total work. The Journal of physiology 2017:2955-2968. doi:10.1113/jp272570. PMID 27396440. https://pubmed.ncbi.nlm.nih.gov/27396440/
96. [MacInnisGibala17] MacInnis MJ, Gibala MJ. Physiological adaptations to interval training and the role of exercise intensity. The Journal of physiology 2017:2915-2930. doi:10.1113/jp273196. PMID 27748956. https://pubmed.ncbi.nlm.nih.gov/27748956/
97. [MacKenzie-Shalders20] MacKenzie-Shalders K, Kelly JT, So D et al. The effect of exercise interventions on resting metabolic rate: A systematic review and meta-analysis. Journal of sports sciences 2020:1635-1649. doi:10.1080/02640414.2020.1754716. PMID 32397898. https://pubmed.ncbi.nlm.nih.gov/32397898/
98. [Madsen93] Madsen K, Pedersen PK, Djurhuus MS et al. Effects of detraining on endurance capacity and metabolic changes during prolonged exhaustive exercise. Journal of applied physiology (Bethesda, Md. : 1985) 1993:1444-1451. doi:10.1152/jappl.1993.75.4.1444. PMID 8282588. https://pubmed.ncbi.nlm.nih.gov/8282588/
99. [Magkos08] Magkos F, Tsekouras Y, Kavouras SA et al. Improved insulin sensitivity after a single bout of exercise is curvilinearly related to exercise energy expenditure. Clinical science (London, England : 1979) 2008:59-64. doi:10.1042/cs20070134. PMID 17635103. https://pubmed.ncbi.nlm.nih.gov/17635103/
100. [Mancilla21] Mancilla R, Brouwers B, Schrauwen-Hinderling VB et al. Exercise training elicits superior metabolic effects when performed in the afternoon compared to morning in metabolically compromised humans. Physiological reports 2021:e14669. doi:10.14814/phy2.14669. PMID 33356015. https://pubmed.ncbi.nlm.nih.gov/33356015/
101. [Mandsager18] Mandsager K, Harb S, Cremer P et al. Association of Cardiorespiratory Fitness With Long-term Mortality Among Adults Undergoing Exercise Treadmill Testing. JAMA network open 2018:e183605. doi:10.1001/jamanetworkopen.2018.3605. PMID 30646252. https://pubmed.ncbi.nlm.nih.gov/30646252/
102. [Manini10] Manini TM. Energy expenditure and aging. Ageing research reviews 2010:1-11. doi:10.1016/j.arr.2009.08.002. PMID 19698803. https://pubmed.ncbi.nlm.nih.gov/19698803/
103. [Martin19] Martin CK, Johnson WD, Myers CA et al. Effect of different doses of supervised exercise on food intake, metabolism, and non-exercise physical activity: The E-MECHANIC randomized controlled trial. The American journal of clinical nutrition 2019:583-592. doi:10.1093/ajcn/nqz054. PMID 31172175. https://pubmed.ncbi.nlm.nih.gov/31172175/
104. [Meeusen13] Meeusen R, Duclos M, Foster C et al. Prevention, diagnosis, and treatment of the overtraining syndrome: joint consensus statement of the European College of Sport Science and the American College of Sports Medicine. Medicine and science in sports and exercise 2013:186-205. doi:10.1249/mss.0b013e318279a10a. PMID 23247672. https://pubmed.ncbi.nlm.nih.gov/23247672/
105. [Melanson02] Melanson EL, Sharp TA, Seagle HM et al. Resistance and aerobic exercise have similar effects on 24-h nutrient oxidation. Medicine and science in sports and exercise 2002:1793-1800. doi:10.1097/00005768-200211000-00016. PMID 12439085. https://pubmed.ncbi.nlm.nih.gov/12439085/
106. [Melanson13] Melanson EL, Keadle SK, Donnelly JE et al. Resistance to exercise-induced weight loss: compensatory behavioral adaptations. Medicine and science in sports and exercise 2013:1600-1609. doi:10.1249/mss.0b013e31828ba942. PMID 23470300. https://pubmed.ncbi.nlm.nih.gov/23470300/
107. [Mikines88] Mikines KJ, Sonne B, Farrell PA et al. Effect of physical exercise on sensitivity and responsiveness to insulin in humans. The American journal of physiology 1988:E248-59. doi:10.1152/ajpendo.1988.254.3.e248. PMID 3126668. https://pubmed.ncbi.nlm.nih.gov/3126668/
108. [Milanovic15] Milanović Z, Sporiš G, Weston M. Effectiveness of High-Intensity Interval Training (HIT) and Continuous Endurance Training for VO2max Improvements: A Systematic Review and Meta-Analysis of Controlled Trials. Sports medicine (Auckland, N.Z.) 2015:1469-1481. doi:10.1007/s40279-015-0365-0. PMID 26243014. https://pubmed.ncbi.nlm.nih.gov/26243014/
109. [Miller13] Miller CT, Fraser SF, Levinger I et al. The effects of exercise training in addition to energy restriction on functional capacities and body composition in obese adults during weight loss: a systematic review. PloS one 2013:e81692. doi:10.1371/journal.pone.0081692. PMID 24409219. https://pubmed.ncbi.nlm.nih.gov/24409219/
110. [Minetti02] Minetti AE, Moia C, Roi GS et al. Energy cost of walking and running at extreme uphill and downhill slopes. Journal of applied physiology (Bethesda, Md. : 1985) 2002:1039-1046. doi:10.1152/japplphysiol.01177.2001. PMID 12183501. https://pubmed.ncbi.nlm.nih.gov/12183501/
111. [Mitchell24] Mitchell L, Wilson L, Duthie G et al. Methods to Assess Energy Expenditure of Resistance Exercise: A Systematic Scoping Review. Sports medicine (Auckland, N.Z.) 2024:2357-2372. doi:10.1007/s40279-024-02047-8. PMID 38896201. https://pubmed.ncbi.nlm.nih.gov/38896201/
112. [Montero17] Montero D, Lundby C. Refuting the myth of non-response to exercise training: 'non-responders' do respond to higher dose of training. The Journal of physiology 2017:3377-3387. doi:10.1113/jp273480. PMID 28133739. https://pubmed.ncbi.nlm.nih.gov/28133739/
113. [Mountjoy23] Mountjoy M, Ackerman KE, Bailey DM et al. 2023 International Olympic Committee's (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs). British journal of sports medicine 2023:1073-1097. doi:10.1136/bjsports-2023-106994. PMID 37752011. https://pubmed.ncbi.nlm.nih.gov/37752011/
114. [Mujika00b] Mujika I, Padilla S. Detraining: loss of training-induced physiological and performance adaptations. Part II: Long term insufficient training stimulus. Sports medicine (Auckland, N.Z.) 2000:145-154. doi:10.2165/00007256-200030030-00001. PMID 10999420. https://pubmed.ncbi.nlm.nih.gov/10999420/
115. [MurachBagley16] Murach KA, Bagley JR. Skeletal Muscle Hypertrophy with Concurrent Exercise Training: Contrary Evidence for an Interference Effect. Sports medicine (Auckland, N.Z.) 2016:1029-1039. doi:10.1007/s40279-016-0496-y. PMID 26932769. https://pubmed.ncbi.nlm.nih.gov/26932769/
116. [Nes11] Nes BM, Janszky I, Vatten LJ et al. Estimating V·O 2peak from a nonexercise prediction model: the HUNT Study, Norway. Medicine and science in sports and exercise 2011:2024-2030. doi:10.1249/mss.0b013e31821d3f6f. PMID 21502897. https://pubmed.ncbi.nlm.nih.gov/21502897/
117. [Neufer89] Neufer PD. The effect of detraining and reduced training on the physiological adaptations to aerobic exercise training. Sports medicine (Auckland, N.Z.) 1989:302-320. doi:10.2165/00007256-198908050-00004. PMID 2692122. https://pubmed.ncbi.nlm.nih.gov/2692122/
118. [Paluch22] Paluch AE, Bajpai S, Bassett DR et al. Daily steps and all-cause mortality: a meta-analysis of 15 international cohorts. The Lancet. Public health 2022:e219-e228. doi:10.1016/s2468-2667(21)00302-9. PMID 35247352. https://pubmed.ncbi.nlm.nih.gov/35247352/
119. [Panissa21] Panissa VLG, Fukuda DH, Staibano V et al. Magnitude and duration of excess of post-exercise oxygen consumption between high-intensity interval and moderate-intensity continuous exercise: A systematic review. Obesity reviews : an official journal of the International Association for the Study of Obesity 2021:e13099. doi:10.1111/obr.13099. PMID 32656951. https://pubmed.ncbi.nlm.nih.gov/32656951/
120. [Patterson18] Patterson R, McNamara E, Tainio M et al. Sedentary behaviour and risk of all-cause, cardiovascular and cancer mortality, and incident type 2 diabetes: a systematic review and dose response meta-analysis. European journal of epidemiology 2018:811-829. doi:10.1007/s10654-018-0380-1. PMID 29589226. https://pubmed.ncbi.nlm.nih.gov/29589226/
121. [Perseghin96] Perseghin G, Price TB, Petersen KF et al. Increased glucose transport-phosphorylation and muscle glycogen synthesis after exercise training in insulin-resistant subjects. The New England journal of medicine 1996:1357-1362. doi:10.1056/nejm199610313351804. PMID 8857019. https://pubmed.ncbi.nlm.nih.gov/8857019/
122. [Peterman20] Peterman JE, Harber MP, Imboden MT et al. Accuracy of Nonexercise Prediction Equations for Assessing Longitudinal Changes to Cardiorespiratory Fitness in Apparently Healthy Adults: BALL ST Cohort. Journal of the American Heart Association 2020:e015117. doi:10.1161/jaha.119.015117. PMID 32458761. https://pubmed.ncbi.nlm.nih.gov/32458761/
123. [Petre21] Petré H, Hemmingsson E, Rosdahl H et al. Development of Maximal Dynamic Strength During Concurrent Resistance and Endurance Training in Untrained, Moderately Trained, and Trained Individuals: A Systematic Review and Meta-analysis. Sports medicine (Auckland, N.Z.) 2021:991-1010. doi:10.1007/s40279-021-01426-9. PMID 33751469. https://pubmed.ncbi.nlm.nih.gov/33751469/
124. [Phillips03] Phillips WT, Ziuraitis JR. Energy cost of the ACSM single-set resistance training protocol. Journal of strength and conditioning research 2003:350-355. doi:10.1519/1533-4287(2003)017<0350:ecotas>2.0.co;2. PMID 12741877. https://pubmed.ncbi.nlm.nih.gov/12741877/
125. [Pontzer16] Pontzer H, Durazo-Arvizu R, Dugas LR et al. Constrained Total Energy Expenditure and Metabolic Adaptation to Physical Activity in Adult Humans. Current biology : CB 2016:410-417. doi:10.1016/j.cub.2015.12.046. PMID 26832439. https://pubmed.ncbi.nlm.nih.gov/26832439/
126. [Randell17] Randell RK, Rollo I, Roberts TJ et al. Maximal Fat Oxidation Rates in an Athletic Population. Medicine and science in sports and exercise 2017:133-140. doi:10.1249/mss.0000000000001084. PMID 27580144. https://pubmed.ncbi.nlm.nih.gov/27580144/
127. [Reis17] Reis VM, Garrido ND, Vianna J et al. Energy cost of isolated resistance exercises across low- to high-intensities. PloS one 2017:e0181311. doi:10.1371/journal.pone.0181311. PMID 28742112. https://pubmed.ncbi.nlm.nih.gov/28742112/
128. [Reynolds16] Reynolds AN, Mann JI, Williams S et al. Advice to walk after meals is more effective for lowering postprandial glycaemia in type 2 diabetes mellitus than advice that does not specify timing: a randomised crossover study. Diabetologia 2016:2572-2578. doi:10.1007/s00125-016-4085-2. PMID 27747394. https://pubmed.ncbi.nlm.nih.gov/27747394/
129. [Riou15] Riou MÈ, Jomphe-Tremblay S, Lamothe G et al. Predictors of Energy Compensation during Exercise Interventions: A Systematic Review. Nutrients 2015:3677-3704. doi:10.3390/nu7053677. PMID 25988763. https://pubmed.ncbi.nlm.nih.gov/25988763/
130. [Robergs91] Robergs RA, Pearson DR, Costill DL et al. Muscle glycogenolysis during differing intensities of weight-resistance exercise. Journal of applied physiology (Bethesda, Md. : 1985) 1991:1700-1706. doi:10.1152/jappl.1991.70.4.1700. PMID 2055849. https://pubmed.ncbi.nlm.nih.gov/2055849/
131. [Robineau16] Robineau J, Babault N, Piscione J et al. Specific Training Effects of Concurrent Aerobic and Strength Exercises Depend on Recovery Duration. Journal of strength and conditioning research 2016:672-683. doi:10.1519/jsc.0000000000000798. PMID 25546450. https://pubmed.ncbi.nlm.nih.gov/25546450/
132. [Romijn93] Romijn JA, Coyle EF, Sidossis LS et al. Regulation of endogenous fat and carbohydrate metabolism in relation to exercise intensity and duration. The American journal of physiology 1993:E380-91. doi:10.1152/ajpendo.1993.265.3.e380. PMID 8214047. https://pubmed.ncbi.nlm.nih.gov/8214047/
133. [Ross00] Ross R, Dagnone D, Jones PJ et al. Reduction in obesity and related comorbid conditions after diet-induced weight loss or exercise-induced weight loss in men. A randomized, controlled trial. Annals of internal medicine 2000:92-103. doi:10.7326/0003-4819-133-2-200007180-00008. PMID 10896648. https://pubmed.ncbi.nlm.nih.gov/10896648/
134. [Ross16] Ross R, Blair SN, Arena R et al. Importance of Assessing Cardiorespiratory Fitness in Clinical Practice: A Case for Fitness as a Clinical Vital Sign: A Scientific Statement From the American Heart Association. Circulation 2016:e653-e699. doi:10.1161/cir.0000000000000461. PMID 27881567. https://pubmed.ncbi.nlm.nih.gov/27881567/
135. [Ross19] Ross R, Goodpaster BH, Koch LG et al. Precision exercise medicine: understanding exercise response variability. British journal of sports medicine 2019:1141-1153. doi:10.1136/bjsports-2018-100328. PMID 30862704. https://pubmed.ncbi.nlm.nih.gov/30862704/
136. [Rubio-Valles25] Rubio-Valles M, Amaro-Gahete FJ, Creasy SA et al. Circadian Regulation of Fatty Acid Metabolism in Humans: Is There Evidence of an Optimal Time Window for Maximizing Fat Oxidation During Exercise?. Sports medicine (Auckland, N.Z.) 2025:49-65. doi:10.1007/s40279-024-02154-6. PMID 39681771. https://pubmed.ncbi.nlm.nih.gov/39681771/
137. [Sabag22] Sabag A, Barr L, Armour M et al. The Effect of High-intensity Interval Training vs Moderate-intensity Continuous Training on Liver Fat: A Systematic Review and Meta-Analysis. The Journal of clinical endocrinology and metabolism 2022:862-881. doi:10.1210/clinem/dgab795. PMID 34724062. https://pubmed.ncbi.nlm.nih.gov/34724062/
138. [SaintMaurice20] Saint-Maurice PF, Troiano RP, Bassett DR et al. Association of Daily Step Count and Step Intensity With Mortality Among US Adults. JAMA 2020:1151-1160. doi:10.1001/jama.2020.1382. PMID 32207799. https://pubmed.ncbi.nlm.nih.gov/32207799/
139. [Savikj19] Savikj M, Gabriel BM, Alm PS et al. Afternoon exercise is more efficacious than morning exercise at improving blood glucose levels in individuals with type 2 diabetes: a randomised crossover trial. Diabetologia 2019:233-237. doi:10.1007/s00125-018-4767-z. PMID 30426166. https://pubmed.ncbi.nlm.nih.gov/30426166/
140. [Scharhag10] Scharhag-Rosenberger F, Meyer T, Walitzek S et al. Effects of one year aerobic endurance training on resting metabolic rate and exercise fat oxidation in previously untrained men and women. Metabolic endurance training adaptations. International journal of sports medicine 2010:498-504. doi:10.1055/s-0030-1249621. PMID 20432193. https://pubmed.ncbi.nlm.nih.gov/20432193/
141. [Schoenfeld14] Schoenfeld BJ, Aragon AA, Wilborn CD et al. Body composition changes associated with fasted versus non-fasted aerobic exercise. Journal of the International Society of Sports Nutrition 2014:54. doi:10.1186/s12970-014-0054-7. PMID 25429252. https://pubmed.ncbi.nlm.nih.gov/25429252/
142. [Schubert13] Schubert MM, Desbrow B, Sabapathy S et al. Acute exercise and subsequent energy intake. A meta-analysis. Appetite 2013:92-104. doi:10.1016/j.appet.2012.12.010. PMID 23274127. https://pubmed.ncbi.nlm.nih.gov/23274127/
143. [Schubert14] Schubert MM, Sabapathy S, Leveritt M et al. Acute exercise and hormones related to appetite regulation: a meta-analysis. Sports medicine (Auckland, N.Z.) 2014:387-403. doi:10.1007/s40279-013-0120-3. PMID 24174308. https://pubmed.ncbi.nlm.nih.gov/24174308/
144. [Schumann22] Schumann M, Feuerbacher JF, Sünkeler M et al. Compatibility of Concurrent Aerobic and Strength Training for Skeletal Muscle Size and Function: An Updated Systematic Review and Meta-Analysis. Sports medicine (Auckland, N.Z.) 2022:601-612. doi:10.1007/s40279-021-01587-7. PMID 34757594. https://pubmed.ncbi.nlm.nih.gov/34757594/
145. [Sevits13] Sevits KJ, Melanson EL, Swibas T et al. Total daily energy expenditure is increased following a single bout of sprint interval training. Physiological reports 2013:e00131. doi:10.1002/phy2.131. PMID 24303194. https://pubmed.ncbi.nlm.nih.gov/24303194/
146. [Shcherbina17] Shcherbina A, Mattsson CM, Waggott D et al. Accuracy in Wrist-Worn, Sensor-Based Measurements of Heart Rate and Energy Expenditure in a Diverse Cohort. Journal of personalized medicine 2017:E3. doi:10.3390/jpm7020003. PMID 28538708. https://pubmed.ncbi.nlm.nih.gov/28538708/
147. [Shimada13] Shimada K, Yamamoto Y, Iwayama K et al. Effects of post-absorptive and postprandial exercise on 24 h fat oxidation. Metabolism: clinical and experimental 2013:793-800. doi:10.1016/j.metabol.2012.12.008. PMID 23313101. https://pubmed.ncbi.nlm.nih.gov/23313101/
148. [Sim14] Sim AY, Wallman KE, Fairchild TJ et al. High-intensity intermittent exercise attenuates ad-libitum energy intake. International journal of obesity (2005) 2014:417-422. doi:10.1038/ijo.2013.102. PMID 23835594. https://pubmed.ncbi.nlm.nih.gov/23835594/
149. [Sisson09] Sisson SB, Katzmarzyk PT, Earnest CP et al. Volume of exercise and fitness nonresponse in sedentary, postmenopausal women. Medicine and science in sports and exercise 2009:539-545. doi:10.1249/mss.0b013e3181896c4e. PMID 19204597. https://pubmed.ncbi.nlm.nih.gov/19204597/
150. [Skinner01] Skinner JS, Jaskólski A, Jaskólska A et al. Age, sex, race, initial fitness, and response to training: the HERITAGE Family Study. Journal of applied physiology (Bethesda, Md. : 1985) 2001:1770-1776. doi:10.1152/jappl.2001.90.5.1770. PMID 11299267. https://pubmed.ncbi.nlm.nih.gov/11299267/
151. [Slentz05] Slentz CA, Aiken LB, Houmard JA et al. Inactivity, exercise, and visceral fat. STRRIDE: a randomized, controlled study of exercise intensity and amount. Journal of applied physiology (Bethesda, Md. : 1985) 2005:1613-1618. doi:10.1152/japplphysiol.00124.2005. PMID 16002776. https://pubmed.ncbi.nlm.nih.gov/16002776/
152. [Thomas12] Thomas DM, Bouchard C, Church T et al. Why do individuals not lose more weight from an exercise intervention at a defined dose? An energy balance analysis. Obesity reviews : an official journal of the International Association for the Study of Obesity 2012:835-847. doi:10.1111/j.1467-789x.2012.01012.x. PMID 22681398. https://pubmed.ncbi.nlm.nih.gov/22681398/
153. [Tigbe11] Tigbe WW, Lean ME, Granat MH. A physically active occupation does not result in compensatory inactivity during out-of-work hours. Preventive medicine 2011:48-52. doi:10.1016/j.ypmed.2011.04.018. PMID 21575655. https://pubmed.ncbi.nlm.nih.gov/21575655/
154. [Tudor-Locke08] Tudor-Locke C, Hatano Y, Pangrazi RP et al. Revisiting "how many steps are enough?". Medicine and science in sports and exercise 2008:S537-43. doi:10.1249/mss.0b013e31817c7133. PMID 18562971. https://pubmed.ncbi.nlm.nih.gov/18562971/
155. [Tudor-Locke11] Tudor-Locke C, Craig CL, Brown WJ et al. How many steps/day are enough? For adults. The international journal of behavioral nutrition and physical activity 2011:79. doi:10.1186/1479-5868-8-79. PMID 21798015. https://pubmed.ncbi.nlm.nih.gov/21798015/
156. [vanLoon01] van Loon LJ, Greenhaff PL, Constantin-Teodosiu D et al. The effects of increasing exercise intensity on muscle fuel utilisation in humans. The Journal of physiology 2001:295-304. doi:10.1111/j.1469-7793.2001.00295.x. PMID 11579177. https://pubmed.ncbi.nlm.nih.gov/11579177/
157. [Venables05] Venables MC, Achten J, Jeukendrup AE. Determinants of fat oxidation during exercise in healthy men and women: a cross-sectional study. Journal of applied physiology (Bethesda, Md. : 1985) 2005:160-167. doi:10.1152/japplphysiol.00662.2003. PMID 15333616. https://pubmed.ncbi.nlm.nih.gov/15333616/
158. [Verheggen16] Verheggen RJ, Maessen MF, Green DJ et al. A systematic review and meta-analysis on the effects of exercise training versus hypocaloric diet: distinct effects on body weight and visceral adipose tissue. Obesity reviews : an official journal of the International Association for the Study of Obesity 2016:664-690. doi:10.1111/obr.12406. PMID 27213481. https://pubmed.ncbi.nlm.nih.gov/27213481/
159. [Viana19] Viana RB, Naves JPA, Coswig VS et al. Is interval training the magic bullet for fat loss? A systematic review and meta-analysis comparing moderate-intensity continuous training with high-intensity interval training (HIIT). British journal of sports medicine 2019:655-664. doi:10.1136/bjsports-2018-099928. PMID 30765340. https://pubmed.ncbi.nlm.nih.gov/30765340/
160. [Viana19-EoC] . Expression of concern: Is interval training the magic bullet for fat loss? A systematic review and meta-analysis comparing moderate-intensity continuous training with high-intensity training (HIIT). British journal of sports medicine 2019:bjsports-2018-099928eoc1. doi:10.1136/bjsports-2018-099928eoc1. PMID 31248869. https://pubmed.ncbi.nlm.nih.gov/31248869/
161. [Vieira16] Vieira AF, Costa RR, Macedo RC et al. Effects of aerobic exercise performed in fasted v. fed state on fat and carbohydrate metabolism in adults: a systematic review and meta-analysis. The British journal of nutrition 2016:1153-1164. doi:10.1017/s0007114516003160. PMID 27609363. https://pubmed.ncbi.nlm.nih.gov/27609363/
162. [VighLarsen21] Vigh-Larsen JF, Ørtenblad N, Spriet LL et al. Muscle Glycogen Metabolism and High-Intensity Exercise Performance: A Narrative Review. Sports medicine (Auckland, N.Z.) 2021:1855-1874. doi:10.1007/s40279-021-01475-0. PMID 33900579. https://pubmed.ncbi.nlm.nih.gov/33900579/
163. [Vissers13] Vissers D, Hens W, Taeymans J et al. The effect of exercise on visceral adipose tissue in overweight adults: a systematic review and meta-analysis. PloS one 2013:e56415. doi:10.1371/journal.pone.0056415. PMID 23409182. https://pubmed.ncbi.nlm.nih.gov/23409182/
164. [Volek16] Volek JS, Freidenreich DJ, Saenz C et al. Metabolic characteristics of keto-adapted ultra-endurance runners. Metabolism: clinical and experimental 2016:100-110. doi:10.1016/j.metabol.2015.10.028. PMID 26892521. https://pubmed.ncbi.nlm.nih.gov/26892521/
165. [Washburn15] Washburn RA, Honas JJ, Ptomey LT et al. Energy and Macronutrient Intake in the Midwest Exercise Trial 2 (MET-2). Medicine and science in sports and exercise 2015:1941-1949. doi:10.1249/mss.0000000000000611. PMID 25574796. https://pubmed.ncbi.nlm.nih.gov/25574796/
166. [Way16] Way KL, Hackett DA, Baker MK et al. The Effect of Regular Exercise on Insulin Sensitivity in Type 2 Diabetes Mellitus: A Systematic Review and Meta-Analysis. Diabetes & metabolism journal 2016:253-271. doi:10.4093/dmj.2016.40.4.253. PMID 27535644. https://pubmed.ncbi.nlm.nih.gov/27535644/
167. [Weinheimer10] Weinheimer EM, Sands LP, Campbell WW. A systematic review of the separate and combined effects of energy restriction and exercise on fat-free mass in middle-aged and older adults: implications for sarcopenic obesity. Nutrition reviews 2010:375-388. doi:10.1111/j.1753-4887.2010.00298.x. PMID 20591106. https://pubmed.ncbi.nlm.nih.gov/20591106/
168. [Westerterp13] Westerterp KR. Physical activity and physical activity induced energy expenditure in humans: measurement, determinants, and effects. Frontiers in physiology 2013:90. doi:10.3389/fphys.2013.00090. PMID 23637685. https://pubmed.ncbi.nlm.nih.gov/23637685/
169. [Westerterp17] Westerterp KR. Control of energy expenditure in humans. European journal of clinical nutrition 2017:340-344. doi:10.1038/ejcn.2016.237. PMID 27901037. https://pubmed.ncbi.nlm.nih.gov/27901037/
170. [Wewege17] Wewege M, van den Berg R, Ward RE et al. The effects of high-intensity interval training vs. moderate-intensity continuous training on body composition in overweight and obese adults: a systematic review and meta-analysis. Obesity reviews : an official journal of the International Association for the Study of Obesity 2017:635-646. doi:10.1111/obr.12532. PMID 28401638. https://pubmed.ncbi.nlm.nih.gov/28401638/
171. [Weyand13] Weyand PG, Smith BR, Schultz NS et al. Predicting metabolic rate across walking speed: one fit for all body sizes?. Journal of applied physiology (Bethesda, Md. : 1985) 2013:1332-1342. doi:10.1152/japplphysiol.01333.2012. PMID 23928111. https://pubmed.ncbi.nlm.nih.gov/23928111/
172. [Wilkin12] Wilkin LD, Cheryl A, Haddock BL. Energy expenditure comparison between walking and running in average fitness individuals. Journal of strength and conditioning research 2012:1039-1044. doi:10.1519/jsc.0b013e31822e592c. PMID 22446673. https://pubmed.ncbi.nlm.nih.gov/22446673/
173. [Willis14] Willis EA, Herrmann SD, Honas JJ et al. Nonexercise energy expenditure and physical activity in the Midwest Exercise Trial 2. Medicine and science in sports and exercise 2014:2286-2294. doi:10.1249/mss.0000000000000354. PMID 24694746. https://pubmed.ncbi.nlm.nih.gov/24694746/
174. [Willis20] Willis EA, Creasy SA, Honas JJ et al. The effects of exercise session timing on weight loss and components of energy balance: midwest exercise trial 2. International journal of obesity (2005) 2020:114-124. doi:10.1038/s41366-019-0409-x. PMID 31289334. https://pubmed.ncbi.nlm.nih.gov/31289334/
175. [Wilson12] Wilson JM, Marin PJ, Rhea MR et al. Concurrent training:  a meta-analysis examining interference of aerobic and resistance exercises. Journal of strength and conditioning research 2012:2293-2307. doi:10.1519/jsc.0b013e31823a3e2d. PMID 22002517. https://pubmed.ncbi.nlm.nih.gov/22002517/
176. [Zamparo20] Zamparo P, Cortesi M, Gatta G. The energy cost of swimming and its determinants. European journal of applied physiology 2020:41-66. doi:10.1007/s00421-019-04270-y. PMID 31807901. https://pubmed.ncbi.nlm.nih.gov/31807901/
177. [Zhang16] Zhang HJ, He J, Pan LL et al. Effects of Moderate and Vigorous Exercise on Nonalcoholic Fatty Liver Disease: A Randomized Clinical Trial. JAMA internal medicine 2016:1074-1082. doi:10.1001/jamainternmed.2016.3202. PMID 27379904. https://pubmed.ncbi.nlm.nih.gov/27379904/
