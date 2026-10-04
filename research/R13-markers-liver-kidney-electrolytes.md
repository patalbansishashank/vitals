# R13c · Marker dossiers: liver enzymes, kidney markers, electrolytes

Date: 2026-10-02 · Plan item 9 (blood markers) · Job R13c · Index and prior decisions: `plan/02-next/research-blood-markers.md` (cited here as [S51]) · Evidence policy: `plan/01-after-launch/research/R5-evidence-policy.md`; grade letters follow `research/RESEARCH_PROTOCOL.md`: **A** = meta-analysis, validated model or several controlled human trials; **B** = a few human RCTs or consistent human mechanistic data; **C** = limited or indirect human data (observational, other population, case series); **D** = animal, in-vitro, expert opinion or mechanism only.

Markers: ALT, AST, GGT, creatinine with eGFR (CKD-EPI 2021), urine albumin-creatinine ratio (ACR), sodium, potassium. Machine-readable rows: `R13-liver-kidney-electrolytes.json` (same folder). Source numbers `[Sn]` match the JSON `sources` ids (`"S1"` …).

Every source in the list was opened in this session (PubMed abstract, PMC full text, or the guideline PDF). Where only the abstract was read, the list says so. Numbers that come only from the abstract are quoted only as far as the abstract gives them.

**Rules language.** Nothing is banned. Rule kinds are `cap` (upper limit on a lever), `warn` (shown with the plan), `reask` (ask the person to confirm a fact before the plan uses it), `clinician` (a "talk to a clinician" card; the plan continues inside the existing gentle or clinician-first locks), `retest` (a dated retest prompt) and `prefer` (the planner ranks a lever higher). Messages use the template "Because your X was Y on DATE …" and stay ≤ 200 characters.

---

## Where this dossier differs from the index [S51]

| Index statement | This dossier | Why |
|---|---|---|
| ALT "> 3× ULN: clinician" (which ULN not stated) | Use the **lab-printed** ULN for the 3× clinician threshold (fallback 40 U/L when no range is printed). Use the **healthy** ULN (33 U/L men, 25 U/L women; ACG [S1]) only for the gentler "above healthy" prefer/warn rules | 3 × 25 = 75 U/L would send many Indian women to a clinician for values their lab prints as normal; Indian histology-normal 95th percentiles are 38.6 (M) and 35.2 (F) U/L [S6]. The gentle rules still use the stricter number |
| AST/ALT "rise 1–3 days after hard training" | Both stay raised for **at least 7 days** after an unaccustomed 1-hour weightlifting session [S8] | Primary trial opened. The re-ask before accepting a high AST/ALT asks about hard or new lifting in the **7** days before the test |
| Creatine raises creatinine "+0.1–0.3 mg/dL" (marked unverified) | **+0.13 mg/dL (95 % CI 0.07–0.18)**, no difference in eGFR or urea (meta-analysis of 19 RCTs) [S30] | Now verified; the effect is at the low end of the index range |
| "Na < 135, or K < 3.5 or > 5.0 → BLOCK > 24 h fasts and VLC start" (W-L09) | Same thresholds, expressed as a **cap** (fasts ≤ 24 h) plus a **re-ask** before a very-low-carb start (repeat test or clinician confirmation) plus a clinician card | Product rule: nothing is blocked outright. The effect on the plan is the same until the person answers |
| ACR ≥ 30 sets the kidney flag immediately | Kept, but marked **provisional** with a retest prompt: KDIGO requires a repeat first-morning sample and ≥ 3 months for chronicity, and exercise, menstruation and infection raise ACR [S27] | A single ACR overstates CKD; the protein cap of 1.3 g/kg is mild enough to apply while waiting |
| CKD-EPI 2021 used as is | Kept as the computed value, with a note that in an Indian iohexol cohort CKD-EPI 2021 classified many CKD patients into higher (milder) GFR categories than an India-recalibrated equation [S42] | The app should not claim more precision than the equation has in Indians |

---

## 1. ALT (alanine aminotransferase; "SGPT")

### Physiology and what it reflects
ALT is a cytosolic enzyme concentrated in hepatocytes. It leaks into blood when liver cells are injured or overloaded, so it rises with liver fat (MASLD), alcohol, drugs and supplements, viral hepatitis and, to a lesser degree, muscle damage. Elevated ALT is associated with higher liver-related mortality [S1]. ALT does not reliably grade inflammation in MASLD: INASL states that AST and ALT do not correlate well with hepatic inflammation and should not be used to diagnose or exclude steatohepatitis [S4]. MASLD is steatotic liver disease with at least one cardiometabolic risk factor and no harmful alcohol intake [S3]. For the app, ALT is a **liver-fat state signal** (it seeds `L0` through research/06 §4.9) and an injury alarm.

### Units and conversions
| Unit | Used by | Conversion |
|---|---|---|
| U/L (= IU/L) | Indian labs, most labs worldwide | — |
| µkat/L | Some European labs (e.g. [S16]) | 1 µkat/L = 60 U/L; U/L × 0.0167 = µkat/L |

### Reference ranges and targets
| Source | Men | Women | Note |
|---|---|---|---|
| ACG 2017 "true healthy normal" [S1] | 29–33 U/L | 19–25 U/L | Values above this "should be assessed" |
| AASLD 2023 [S2] | > 30 U/L abnormal | > 30 U/L abnormal | "Normative values reported by most laboratories exceed what is considered a true normal" |
| Indian liver donors with normal histology, 95th percentile [S6] | 38.6 U/L | 35.2 U/L | n = 331; half of "healthy" donors had steatosis on biopsy |
| Indian lab printed ranges [S51] | often "< 45" or "< 50" U/L | lab-specific | From report-structure reading; varies by chain and method; use the printed value |
| LAI / ICMR / RSSDI | — | — | No ALT targets; LAI documents address lipids only |

Indian cut-offs differ: the histology-based Indian upper limits [S6] are higher than the ACG numbers and lower than many printed lab ranges. A community study in North India found 20.5 % of adults above 40 U/L [S7].

### How each lever moves it
| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | ↓ (via liver fat) | Liver fat −55 ± 14 % vs −28 ± 23 % with calorie restriction at similar weight loss (≈ 4 kg); ALT itself did not fall significantly in 2 weeks, AST did (n = 18 NAFLD) | Liver fat 2 wk; ALT lags | Less hepatic de novo lipogenesis, more β-oxidation and ketogenesis | B (liver fat), C (ALT) | [S11], [S12] |
| Moderate low-carb | ↓ (via liver fat) | Isocaloric low-carb, higher-protein diet produced "rapid and dramatic" liver-fat falls (obese NAFLD, abstract gives no %) | 2 wk | Lower DNL substrate | C | [S12] |
| High protein (≥ 1.6 g/kg) | none | Milk-protein supplements (65 RCTs): no effect on ALT | 4–24 wk | No hepatic load at these intakes | A (for supplements) | [S24] |
| Fasting 16:8 | ↓ (via deficit only) | Time-restricted eating 8 am–4 pm = daily calorie restriction for liver fat (−8.3 % vs −8.1 % IHTG at 6 mo; obese NAFLD, China) | 6–12 mo | Energy deficit; timing adds nothing measurable | B | [S17] |
| Fasting 24 h | unknown | No trial found | — | Expected: no change after one day (mechanism) | D | [S16] |
| Fasting 36–48 h | small ↑ (expected) | No trial at this length; see > 48 h | days | Expected start of the transamination rise seen in longer fasts | D | [S16] |
| Extended fasts > 48 h | ↑ mild, within range | 0.5 → 0.7 µkat/L (≈ 30 → 42 U/L), 4–21-day 200–250 kcal Buchinger fasts, n = 1422 | During fast; peak reported in week 3 of zero-calorie fasts | Amino-acid transamination for gluconeogenesis | B | [S16] |
| Saturated fat | ↑ (via liver fat) | +1000 kcal/d SFA for 3 wk: liver fat +55 % vs +15 % for unsaturated fat (overweight adults); ALT not given in the abstract | 3 wk | More adipose lipolysis, ceramides, insulin resistance | B (liver fat), C (ALT) | [S13] |
| Dietary cholesterol / eggs | none known | No data found; the index marks no effect | — | — | D | [S51] |
| Fibre | ↓ small (expected) | No trial opened; INASL diet advice favours whole foods, fruit and vegetables and curbing fructose | months | Via weight and insulin | D | [S4] |
| Unsaturated fats | none on ALT; ↓ GGT | Omega-3 (20 RCTs, 1615 NAFLD): ALT and AST unchanged, GGT −5.4 U/L; overfeeding unsaturated fat raised liver fat only +15 % | 3–12 mo | Lower lipolysis; less lipotoxicity | A (omega-3), B (overfeeding) | [S18], [S13] |
| Alcohol | ↑ | Moderate drinkers (< 40 g/d) have higher ALT than abstainers; the effect grows with BMI (n = 2164) | weeks | Ethanol hepatotoxicity plus fat synergy | B | [S22], [S2] |
| Caffeine (coffee) | ↓ (association) | > 2 cups/d: OR 0.56 for raised ALT (high-risk US adults); ≥ 3 cups/d: OR 0.75; decaffeinated coffee similar (OR 0.62) | habitual | Coffee polyphenols; the decaf result means caffeine is not the active part | C | [S14], [S15], [S2] |
| Creatine | none | 5–10 g/d for 21 months: no clinically significant change in liver enzymes | months | Not hepatically active at these doses | B | [S25] |
| Whey / protein supplements | none | 65 RCTs: no effect on ALT | 4–24 wk | — | A | [S24] |
| Large deficit (> 25 %) | mixed | 800 kcal/d for 8 wk (median −12.1 kg): ALT fell in men, rose mildly and transiently in women (n = 147) | rise at end of the low-calorie phase, normal by 32 wk | Rapid lipolysis loads the liver with fatty acids | B | [S10] |
| Moderate deficit | ↓ | Calorie restriction of 30 % or 500–1000 kcal/d is the INASL recommendation; weight loss of 3–5 % improves steatosis | 8–24 wk | Less liver fat | A | [S4], [S2] |
| Surplus | ↑ | Doubling intake with fast food for 4 wk: ALT 22 → peak 97 U/L (range 19–447); 11/18 above the limit; sugar intake correlated with the rise | 1–4 wk | Liver fat, DNL from sugar | B | [S9] |
| Resistance training load | acute ↑; chronic ↓ | 1 h of unaccustomed weightlifting: ALT and AST raised for ≥ 7 days (healthy men). Long-term exercise in NAFLD: ALT SMD −0.78 | acute 1–7+ days; chronic 8–24 wk | Muscle release of ALT; chronic loss of liver fat | B | [S8], [S21] |
| Aerobic training load | ↓ (chronic) | Long-term exercise in NAFLD (18 RCTs): ALT SMD −0.78 (−1.15 to −0.40) | 8–24 wk | Liver fat and insulin resistance fall | B | [S21] |
| Sleep debt | ↑ (genetic association) | Mendelian randomisation: insomnia → ALT OR 2.79 | years | Insulin resistance (proposed) | C | [S26] |
| Weight loss itself | ↓ | 3–5 % improves steatosis; ≥ 7–10 % improves steatohepatitis and fibrosis | 3–12 mo | Less liver fat | A | [S2], [S4] |
| supp:omega3_epa_dha | none on ALT | As unsaturated fats (ALT unchanged; GGT −5.4 U/L) | 3–12 mo | — | A | [S18] |
| supp:green_tea_extract | ↑ (rare, idiosyncratic) | Hepatocellular injury in case reports at 140 to ~1000 mg EGCG/d; worse when taken fasting | weeks | EGCG bioavailability rises on an empty stomach | C | [S19] |
| supp:ashwagandha | ↑ (rare) | 5 cases of cholestatic or mixed injury with jaundice; latency 2–12 wk; recovery in 1–5 mo | 2–12 wk | Idiosyncratic | C | [S20] |
| supp:creatine_monohydrate | none | As creatine | — | — | B | [S25] |
| supp:whey_protein | none | As whey | — | — | A | [S24] |
| supp:caffeine | none known (pill) | Coffee's association is not explained by caffeine [S15]; no data for caffeine pills | — | — | D | [S15] |

### What it constrains in the plan
| Rule | Threshold | Kind, severity | Message (template) | Grade |
|---|---|---|---|---|
| W-L-ALT-1 | ALT > 33 U/L (men) or > 25 U/L (women) and ≤ 3× lab ULN | `prefer` deficit_moderate, lowcarb/vlc, weight-loss target 7–10 % (3–5 % minimum); info | "Because your ALT was {v} U/L on {date}, above the healthy limit of {33/25}, the plan favours steady fat loss and less sugar." | A |
| W-L-ALT-2 | same as ALT-1 | `cap` alcohol ≤ 20 g/d (women) / 30 g/d (men), AASLD "mild" band; caution | "Because your ALT was {v} U/L on {date}, the plan keeps alcohol to {20/30} g a day or less. Less is better for the liver." | B |
| W-L-ALT-3 | ALT above lab ULN | `reask` before using the value: "hard or new weight training in the 7 days before the test?" If yes, mark the value "may read high" | "Heavy or new lifting can raise ALT and AST for a week. Did you train hard in the 7 days before {date}?" | B |
| W-L-ALT-4 | ALT above healthy ULN and a surplus phase planned | `cap` surplus ≤ 10 % above maintenance; caution | "Because your ALT was {v} U/L on {date}, the plan keeps the surplus small. Big surpluses raise ALT within weeks." | C |
| W-L-ALT-5 | ALT above lab ULN and green tea extract or ashwagandha logged | `warn`; caution | "Because your ALT was {v} U/L on {date}: green tea extract and ashwagandha can rarely injure the liver. Consider pausing it and retesting." | C |
| W-L-ALT-6 | ALT > 3× lab ULN | `clinician` (index W-L11); `cap` deficit ≤ 25 % and fasts ≤ 24 h until reviewed | "Because your ALT was {v} U/L on {date}, more than 3 times your lab's limit, please see a clinician. The plan stays gentle until then." | C (threshold is expert consensus) |
| W-L-ALT-7 | any ALT above healthy ULN | `retest` at 12 weeks | "Retest ALT around {date+12w} to see whether the plan is helping. Avoid hard lifting for 7 days before." | B |

### Clinician-only thresholds
- ALT > 3× the lab's upper limit (index [S51]).
- FIB-4 ≥ 1.3 when platelets, AST, ALT and age are all present: AASLD uses < 1.3 to rule out advanced fibrosis (not accurate under 35 years) [S2]. Display only, with a clinician card; open question 5 in [S51] stays open.
- Any jaundice, dark urine or abdominal pain reported by the person (USP wording for green tea extract) [S19].

### Retest interval
12 weeks after a plan change when raised (time for liver fat to fall [S2], [S4]); 12 months when normal. Avoid hard or new lifting for 7 days before the draw [S8].

### Indian-population notes
- MASLD/NAFLD affects 38.6 % of Indian adults (28.1 % average-risk, 52.8 % high-risk) [S5]; lean NAFLD is 6.5 % of the community [S4].
- INASL recommends 7–10 % weight loss, calorie restriction of 30 % or 500–1000 kcal/d, ≥ 200 min/week of aerobic or resistance exercise, and notes that the Indian habit of sugar and milk in coffee may cancel coffee's benefit [S4].
- Reports print "SGPT" or "ALT (SGPT)" in U/L, usually in a "Liver function test" panel next to SGOT, GGT, ALP, bilirubin and proteins [S51].

---

## 2. AST (aspartate aminotransferase; "SGOT")

### Physiology and what it reflects
AST is in liver, skeletal muscle, heart and red cells, so it is less liver-specific than ALT. It rises after muscle damage (hard or new training), with alcohol, with liver fat and with haemolysis of the sample. AST is an input to FIB-4 [S2], [S4]. The app uses AST as a display value, a FIB-4 input and a training-artefact detector, not as a planning lever on its own.

### Units and conversions
Same as ALT: U/L (= IU/L); 1 µkat/L = 60 U/L.

### Reference ranges and targets
| Source | Men | Women | Note |
|---|---|---|---|
| Indian liver donors with normal histology, 95th percentile [S6] | 33.8 U/L | 31 U/L | |
| Indian lab printed ranges | lab-specific | lab-specific | No source opened for typical AST ranges; use the printed value |
| LAI / ICMR / RSSDI | — | — | None |

### How each lever moves it
| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | ↓ | AST fell significantly with 2 wk of < 20 g/d carbohydrate or calorie restriction (≈ 4 % weight loss, NAFLD) | 2 wk | Less liver fat | B | [S11] |
| Moderate low-carb | ↓ (expected) | As VLC via liver fat; no AST-specific number | 2–12 wk | Less DNL | C | [S12] |
| High protein (≥ 1.6 g/kg) | none | Milk-protein supplements: no effect on AST (65 RCTs) | 4–24 wk | — | A | [S24] |
| Fasting 16:8 | ↓ (via deficit) | No AST-specific number; TRE equals calorie restriction | 6–12 mo | Deficit | C | [S17] |
| Fasting 24 h | unknown | No data | — | — | D | [S16] |
| Fasting 36–48 h | small ↑ (expected) | No data at this length | days | Transamination | D | [S16] |
| Extended fasts > 48 h | ↑ mild, within range | 0.4 → 0.6 µkat/L (≈ 24 → 36 U/L), n = 1422, 4–21 days | during fast | Protein catabolism and transamination | B | [S16] |
| Saturated fat | ↑ (via liver fat) | Liver fat +55 % with SFA overfeeding; AST not in the abstract | 3 wk | As ALT | C | [S13] |
| Dietary cholesterol / eggs | none known | No data | — | — | D | [S51] |
| Fibre | none known | No data opened | — | — | D | [S4] |
| Unsaturated fats | none | Omega-3: AST unchanged | 3–12 mo | — | A | [S18] |
| Alcohol | none at moderate intake | Moderate (< 40 g/d) drinking did not change AST (ALT and GGT did) | — | AST rises mainly with heavier drinking | B | [S22] |
| Caffeine (coffee) | ↓ (association) | ≥ 3 cups/d: OR 0.82 for raised AST | habitual | Coffee constituents | C | [S15] |
| Creatine | none | No clinically significant change in muscle or liver enzymes, 21 mo | months | — | B | [S25] |
| Whey / protein supplements | none | No effect (65 RCTs) | — | — | A | [S24] |
| Large deficit (> 25 %) | mixed | 800 kcal/d: AST fell in men, rose mildly and transiently in women | end of LCD | Rapid lipolysis | B | [S10] |
| Moderate deficit | ↓ | Via liver fat | 8–24 wk | — | B | [S2] |
| Surplus | ↑ (expected) | ALT rose sharply with overfeeding [S9]; AST not in the abstract | 1–4 wk | Liver fat | C | [S9] |
| Resistance training load | acute ↑↑ | Unaccustomed 1-h weightlifting raised AST (and CK, myoglobin) for ≥ 7 days | 1–7+ days | Muscle release | B | [S8] |
| Aerobic training load | chronic ↓ | Long-term exercise in NAFLD: AST SMD −0.65 | 8–24 wk | Less liver fat | B | [S21] |
| Sleep debt | unknown | No AST data | — | — | D | [S26] |
| Weight loss itself | ↓ | Via liver fat | 3–12 mo | — | B | [S11], [S2] |
| supp:omega3_epa_dha | none | As above | — | — | A | [S18] |
| supp:green_tea_extract | ↑ (rare) | Hepatocellular injury pattern | weeks | EGCG | C | [S19] |
| supp:ashwagandha | ↑ (rare) | Cholestatic or mixed injury | 2–12 wk | Idiosyncratic | C | [S20] |

### What it constrains in the plan
| Rule | Threshold | Kind, severity | Message | Grade |
|---|---|---|---|---|
| W-L-AST-1 | AST above lab ULN with ALT normal or less raised | `reask` hard or new training in the 7 days before the test; if yes, the value is shown as "may read high from training" and not used for FIB-4 | "Because your AST was {v} U/L on {date}: did you lift hard or start new training in the 7 days before? Muscle can raise AST for a week." | B |
| W-L-AST-2 | AST above lab ULN | `retest` at 12 weeks with 7 days of no hard or new lifting before | "Retest AST and ALT around {date+12w}, with no hard lifting in the 7 days before." | B |
| W-L-AST-3 | AST > 3× lab ULN | `clinician` | "Because your AST was {v} U/L on {date}, more than 3 times your lab's limit, please see a clinician." | C |

### Clinician-only thresholds
AST > 3× lab ULN [S51]; FIB-4 ≥ 1.3 [S2].

### Retest interval
With ALT: 12 weeks when raised, 12 months when normal; 7 training-free days before.

### Indian-population notes
Printed as "SGOT" or "AST (SGOT)" in U/L. Indian histology-normal limits in [S6]. Many reports also print the SGOT/SGPT ratio; the app recomputes it and does not plan on it [S51].

---

## 3. GGT (gamma-glutamyl transferase)

### Physiology and what it reflects
GGT is a membrane enzyme of liver, bile ducts and kidney. Serum GGT is induced by alcohol, liver fat and oxidative stress, and is modulated by weight gain, exercise and coffee [S23]. It is a sensitive but non-specific marker of alcohol use; after heavy drinking stops it usually normalises within 2–3 weeks, and values that stay high suggest liver disease [S23]. In the app GGT is an **alcohol-lever amplifier** and a liver-fat co-signal.

### Units and conversions
U/L (= IU/L); 1 µkat/L = 60 U/L.

### Reference ranges and targets
| Source | Range | Note |
|---|---|---|
| Lab-printed ULN [S51] | typically < 55–60 U/L men, lower in women | Method- and sex-specific; use the printed value |
| Guideline targets (ACG, AASLD, INASL, LAI, ICMR) | none | No numeric target exists; GGT is interpreted against the lab range |

### How each lever moves it
| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | ↓ (expected) | No GGT-specific trial opened; follows liver fat | 2–12 wk | Less liver fat | D | [S11] |
| Moderate low-carb | ↓ (expected) | As above | weeks | — | D | [S12] |
| High protein (≥ 1.6 g/kg) | unknown | Milk-protein meta-analysis reported ALT and AST only | — | — | D | [S24] |
| Fasting 16:8 | ↓ (via deficit, expected) | No GGT number | months | Deficit | D | [S17] |
| Fasting 24 h | unknown | No data | — | — | D | [S16] |
| Fasting 36–48 h | ↓ (expected) | Extrapolated from longer fasts | days | — | D | [S16] |
| Extended fasts > 48 h | ↓ | 0.6 → 0.4 µkat/L (≈ 36 → 24 U/L), larger in longer fasts, n = 1422 | 4–21 days | Lower oxidative and hepatic load (proposed by authors) | B | [S16] |
| Saturated fat | ↑ (expected via liver fat) | No GGT number | weeks | — | D | [S13] |
| Dietary cholesterol / eggs | none known | No data | — | — | D | [S51] |
| Fibre | unknown | No data | — | — | D | [S4] |
| Unsaturated fats | ↓ | Omega-3 in NAFLD: −5.38 U/L (−9.16 to −1.61), 20 RCTs | 3–12 mo | Less hepatic lipid and oxidative stress | A (with publication bias noted) | [S18] |
| Alcohol | ↑ | Moderate (< 40 g/d) drinkers had higher GGT than abstainers (P < 0.001), more so at higher BMI | weeks; normalises 2–3 wk after stopping | Enzyme induction, oxidative stress | B | [S22], [S23] |
| Caffeine (coffee) | ↓ (association) | ≥ 3 cups/d: OR 0.69 for raised GGT; decaf OR 0.70 | habitual | Coffee constituents | C | [S15] |
| Creatine | none | No change in liver enzymes | months | — | B | [S25] |
| Whey / protein supplements | unknown | Not reported | — | — | D | [S24] |
| Large deficit (> 25 %) | ↓ (expected) | Fasting data suggest a fall | weeks | — | D | [S16] |
| Moderate deficit | ↓ (expected) | Via liver fat | weeks | — | D | [S2] |
| Surplus | ↑ (expected) | Via liver fat; no GGT number | weeks | — | D | [S9] |
| Resistance training load | none | GGT stayed normal after weightlifting that raised AST/ALT | 7 days | GGT is not in muscle in relevant amounts | B | [S8] |
| Aerobic training load | ↓ (association) | Exercise modulates GGT (review) | — | Less oxidative stress | C | [S23] |
| Sleep debt | unknown | — | — | — | D | [S26] |
| Weight loss itself | ↓ | Weight gain raises and loss lowers ethanol-sensitive markers (review) | months | — | C | [S23] |
| supp:omega3_epa_dha | ↓ | −5.38 U/L | 3–12 mo | — | A | [S18] |

### What it constrains in the plan
| Rule | Threshold | Kind, severity | Message | Grade |
|---|---|---|---|---|
| W-L-GGT-1 | GGT above lab ULN | `reask` weekly alcohol intake (drinks or grams) | "Because your GGT was {v} U/L on {date}, which often rises with alcohol, how much do you usually drink in a week?" | B |
| W-L-GGT-2 | GGT above lab ULN | `cap` alcohol ≤ 20 g/d (women) / 30 g/d (men); stronger "reduce" wording on the alcohol lever | "Because your GGT was {v} U/L on {date}, the plan cuts alcohol. GGT usually falls within 2–3 weeks of drinking less." | B |
| W-L-GGT-3 | GGT above lab ULN | `retest` 4–6 weeks after alcohol is reduced | "Retest GGT around {date+6w}. If it is still high after weeks of little or no alcohol, see a clinician." | C |
| W-L-GGT-4 | GGT above lab ULN at the retest after ≥ 4 weeks with ≤ 1 drink/week | `clinician` | "Your GGT stayed high on {date} after weeks of little alcohol. Please see a clinician to check your liver." | C |

### Clinician-only thresholds
GGT that stays above the lab range after ≥ 4 weeks of abstinence or near-abstinence [S23]. No numeric multiple is given by the opened sources.

### Retest interval
4–6 weeks after an alcohol change [S23]; otherwise with the liver panel (12 weeks if raised, 12 months if normal).

### Indian-population notes
Printed as "GAMMA GLUTAMYL TRANSFERASE (GGT)" in U/L inside the liver panel [S51]. Not in every camp profile; absence is "not in your report", not an error.

---

## 4. Creatinine and eGFR (CKD-EPI 2021)

### Physiology and what it reflects
Creatinine comes from creatine: about 1–2 % of muscle creatine is converted to creatinine each day and excreted in urine [S25]. Serum creatinine therefore rises when GFR falls, but also with more muscle, a cooked-meat meal and creatine supplements, and falls with muscle loss and low meat intake. KDIGO lists low-protein, keto, vegetarian and high-protein diets and creatine supplements as non-GFR determinants of creatinine, and asks that dietary intake be considered when interpreting it [S27]. Cystatin C is not affected by meals [S32], and creatinine-plus-cystatin-C equations are the most accurate [S28].

**CKD-EPI 2021 (creatinine, race-free)** [S28]: eGFR = 142 × min(Scr/κ, 1)^α × max(Scr/κ, 1)^−1.200 × 0.9938^age × 1.012 (if female); Scr in mg/dL; κ = 0.7 (F) / 0.9 (M); α = −0.241 (F) / −0.302 (M).

### Units and conversions
| Quantity | Conventional (Indian labs) | SI | Factor |
|---|---|---|---|
| Creatinine | mg/dL | µmol/L | µmol/L = mg/dL × 88.4 |
| eGFR | mL/min/1.73 m² | same | 1 |

### Reference ranges and targets
| Source | Category | Note |
|---|---|---|
| KDIGO 2024 [S27] | G1 ≥ 90; G2 60–89; G3a 45–59; G3b 30–44; G4 15–29; G5 < 15 mL/min/1.73 m² | CKD needs ≥ 3 months of abnormality; a single low eGFR is not CKD (Practice Point 1.1.3.2) |
| KDIGO 2024 protein [S27] | 0.8 g/kg/d suggested for CKD G3–G5; avoid > 1.3 g/kg/d in adults with CKD at risk of progression | Basis of W-M05/HC-M2 |
| KDIGO 2024 sodium [S27] | < 2 g sodium/d (< 5 g salt) in CKD | |
| Lab-printed creatinine | lab-specific, sex-specific | Method-dependent (Jaffe or enzymatic); use the printed range |
| India [S42] | No Indian guideline target found. In 1174 Indians with iohexol-measured GFR, recalibrated EKFC equations moved 30–67 % of CKD patients into lower GFR categories than CKD-EPI 2021 | CKD-EPI 2021 may read high (milder) in Indians |
| LAI / RSSDI | not verified this session | RSSDI recommendations were not opened; do not cite |

### How each lever moves it
Direction is for **serum creatinine** unless stated; ↑ creatinine means ↓ eGFR.

| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | creatinine slightly ↓, eGFR ↑ | Low-carb high-protein vs low-fat for 2 y: creatinine −4.2 %, cystatin C −8.4 % at 3 mo, creatinine clearance +15.8 mL/min; no harm to GFR or albuminuria (obese adults, n = 307). Kidney stones: 5.9 % pooled incidence on keto (7.9 % in adults), half uric acid | 3–24 mo; stones over years | Weight loss; ketoacid and urate load for stones | B | [S34], [S37], [S27] |
| Moderate low-carb | eGFR ↑ | DIRECT, 2 y: eGFR +5.3 % (low-carb), similar to Mediterranean and low-fat; gain larger with baseline eGFR < 60 (+7.1 %) | 6–24 mo | Lower insulin and blood pressure | B | [S35] |
| High protein (≥ 1.6 g/kg) | none on GFR change; meals ↑ creatinine acutely | Meta-analysis (28 RCTs, n = 1358): change in GFR not different (SMD 0.11, −0.05 to 0.27). A cooked-meat meal raised creatinine 80.5 → 101 µmol/L and cut eGFR 84 → 59.5 at 1–2 h | GFR: weeks; meal artefact: hours | Hyperfiltration is small; meat contains creatine/creatinine | A (GFR), B (meal) | [S29], [S32] |
| Fasting 16:8 | none | Ramadan fasting in CKD and transplant (32 studies): no consistent change in creatinine or eGFR | 1 mo | Dawn-to-dusk dry fasting is a harsher test than 16:8 | C | [S38] |
| Fasting 24 h | unknown | No data | — | Expected: none if hydrated | D | [S16] |
| Fasting 36–48 h | unknown | No data | — | Expected: small ↑ as below | D | [S16] |
| Extended fasts > 48 h | ↑ small | 71.9 → 76.4 µmol/L (+0.05 mg/dL), within range; urea fell 4.7 → 3.1 mmol/L (n = 1422, with 3 L water/d) | 4–21 days | Protein catabolism; volume shifts | B | [S16] |
| Saturated fat | none known | No data | — | — | D | [S51] |
| Dietary cholesterol / eggs | none known | No data | — | — | D | [S51] |
| Fibre | none short-term | Higher vegetable intake: OR 0.79 for incident CKD (cohorts, low certainty) | years | — | C | [S39] |
| Unsaturated fats | none known | No data | — | — | D | [S51] |
| Alcohol | none / slightly protective association | Moderate drinking: RR 0.86 for incident CKD (cohorts, low certainty) | years | Confounded; not a reason to drink | C | [S39] |
| Caffeine | not reviewed | No source opened this session | — | — | — | — |
| Creatine | creatinine ↑, eGFR artefact | +0.13 mg/dL (0.07–0.18), 19 RCTs; no difference in urea or eGFR (−5.2, −15.0 to 4.6). Rare interstitial nephritis case reports | days to weeks; persists while taking | More creatine → more creatinine; not a GFR change | A | [S30], [S31], [S27] |
| Whey / protein supplements | as high protein | As above | — | — | B | [S29] |
| Large deficit (> 25 %) | mixed | In CKD, non-surgical weight loss cut proteinuria (−1.31 g/24 h) with no further GFR fall over 7.4 mo; creatinine falls if muscle is lost | months | Less hyperfiltration; less muscle | C | [S36] |
| Moderate deficit | eGFR ↑ | DIRECT: +4.0 to +5.3 % in 2 y, all diets | 6–24 mo | Insulin and BP fall | B | [S35] |
| Surplus | creatinine ↑ if muscle is gained (expected) | No trial | months | More muscle creatine turnover | D | [S25] |
| Resistance training load | creatinine ↑ with more muscle | KDIGO: muscle mass is a non-GFR determinant of creatinine | months | More muscle | C | [S27] |
| Aerobic training load | none | 100-km race: creatinine and urea almost unchanged (n = 51). Being active: OR 0.82 for incident CKD | race: hours; activity: years | — | B (acute), C (long term) | [S40], [S39] |
| Sleep debt | not reviewed | No source opened | — | — | — | — |
| Weight loss itself | mixed | Severe obesity with hyperfiltration (GFR > 125): surgery lowered GFR by 25.6 mL/min toward normal; in moderate obesity eGFR rises 4–7 % | months | Hyperfiltration resolves; BP and insulin fall | B | [S36], [S35] |
| supp:creatine_monohydrate | creatinine ↑ (artefact) | +0.13 mg/dL | days–weeks | — | A | [S30] |

### What it constrains in the plan
| Rule (index id) | Threshold | Kind, severity | Message | Grade |
|---|---|---|---|---|
| W-L-EGFR-1 (W-L01) | eGFR < 60 | `cap` protein ≤ 1.3 g/kg/d; RESTRICT | "Because your eGFR was {v} on {date}, the plan keeps protein at or below 1.3 g per kg a day, as kidney guidelines advise." | A |
| W-L-EGFR-2 (W-L01, HC-M12) | eGFR < 60 | `cap` creatine and potassium salt substitute not suggested (hidden from suggestions; can still be logged); clinician card | "Because your eGFR was {v} on {date}, we don't suggest creatine or potassium salt. Ask your doctor before using them." | B |
| W-L-EGFR-3 | eGFR < 60, first time entered | `retest` at 3 months, and `reask` the pre-test conditions (fasting or no cooked meat that day, creatine in the last 2 weeks) | "A single low eGFR is not a diagnosis. Retest around {date+3m}, without cooked meat that morning and off creatine for 2 weeks." | A |
| W-L-EGFR-4 | eGFR < 60 and a VLC/keto block or fasts > 24 h chosen | `warn` + `clinician` card; fasts capped at 24 h until reviewed | "Because your eGFR was {v} on {date}, check with your doctor before keto or fasts over 24 h (kidney stones, fluid and salt shifts)." | C |
| W-L-CREAT-1 (W-L02) | eGFR 60–89, or creatinine above the lab range, with creatine ≥ 3 g/d, a meat meal before the test, or high muscle mass | `warn` (info); suggest cystatin C; no restriction | "Your creatinine on {date} may read high from creatine, muscle or a meat meal. A cystatin C test gives a cleaner kidney estimate." | A |
| W-L-EGFR-5 | eGFR fall > 25 % from the previous entry with no creatine or meat explanation | `clinician` | "Your eGFR fell from {old} to {v} between {d1} and {d2}. Please ask a clinician to check it." | C (KDIGO uses > 20–30 % falls as a referral trigger in treated CKD) |
| W-L-EGFR-6 (W-L11) | eGFR < 30 | `clinician` (specialist referral); plan stays in clinician-first mode | "Because your eGFR was {v} on {date}, please see a kidney specialist. The plan stays gentle until you have." | A |
| guard (golden L5) | eGFR ≥ 60 and ACR < 30 | **no rule fires**; protein ceiling stays W-M04 | — | A |

### Clinician-only thresholds
eGFR < 30; sustained fall > 20–30 %; persistent abnormal potassium (KDIGO Figure 48) [S27].

### Retest interval
Abnormal first value: 3 months to confirm chronicity [S27]. G3a without albuminuria: 1×/year; G3a A2: 2×/year; G3b: 2–3×/year (KDIGO monitoring grid) [S27]. Normal, at risk (diabetes, hypertension): 12 months. Draw fasting or without cooked meat that morning, 2 weeks off creatine if a clean value is wanted [S32], [S30].

### Indian-population notes
- SEEK-India (n = 5588): CKD prevalence 17.2 %, about 6 % at stage 3 or worse [S33].
- CKD-EPI 2021 may overestimate GFR in Indians compared with an Indian-recalibrated EKFC equation [S42]. The app shows "estimated (CKD-EPI 2021)" and accepts the lab's printed eGFR.
- Reports print "CREATININE – SERUM" in mg/dL and often "EST. GLOMERULAR FILTRATION RATE (eGFR)" with the CKD-EPI bands, plus urea, BUN and ratios that the app does not plan on [S51].
- Vegetarian diets lower creatinine (KDIGO non-GFR determinant) [S27]: a lacto-vegetarian with low muscle may read a falsely high eGFR.

---

## 5. Urine albumin-creatinine ratio (ACR)

### Physiology and what it reflects
Albumin in urine means the glomerular barrier (or the vessel wall more generally) is damaged. ACR divides urine albumin by urine creatinine to correct for concentration. It marks kidney damage at any eGFR and is a strong risk marker. Exercise, menstruation, haematuria and urinary infection raise it falsely; women have lower urine creatinine and so higher ACR [S27].

### Units and conversions
| Unit | Used by | Conversion |
|---|---|---|
| mg/g (= µg/mg) | Indian labs, US | — |
| mg/mmol | UK, Europe | mg/mmol = mg/g ÷ 8.84 (KDIGO rounds 30 mg/g ≈ 3 mg/mmol) |

### Reference ranges and targets
| Source | Category | Note |
|---|---|---|
| KDIGO 2024 [S27] | A1 < 30 mg/g (< 3 mg/mmol) normal to mildly increased; A2 30–300 moderately increased; A3 > 300 severely increased | Confirm a random ACR ≥ 30 with a first-morning sample |
| Indian practice | Same categories; CURES used 30–299 µg/mg for microalbuminuria [S41] | No separate Indian cut-off found |

### How each lever moves it
| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | none | Low-carb high-protein for 2 y: no harmful effect on albuminuria (obese adults) | 3–24 mo | — | B | [S34] |
| Moderate low-carb | ↓ (if raised) | DIRECT: ACR improved similarly on all diets; −24.8 mg/g in those with microalbuminuria | 2 y | Weight, insulin, BP | B | [S35] |
| High protein (≥ 1.6 g/kg) | none in healthy kidneys | As VLC row (LC-HP diet ~ high protein) | 2 y | — | B | [S34] |
| Fasting 16:8 | unknown | Ramadan meta-analysis listed proteinuria as an outcome; no pooled effect reported in the abstract | — | — | D | [S38] |
| Fasting 24 h | unknown | No data | — | — | D | [S38] |
| Fasting 36–48 h | unknown | No data | — | — | D | [S38] |
| Extended fasts > 48 h | unknown | No data | — | — | D | [S16] |
| Saturated fat | not reviewed | — | — | — | — | — |
| Dietary cholesterol / eggs | not reviewed | — | — | — | — | — |
| Fibre | not reviewed | — | — | — | — | — |
| Unsaturated fats | not reviewed | — | — | — | — | — |
| Alcohol | association only | Secondary CKD outcomes, including albuminuria, consistent with the primary (moderate drinking RR 0.86 for CKD; low certainty) | years | Confounded | C | [S39] |
| Caffeine | not reviewed | — | — | — | — | — |
| Creatine | none known | No urinalysis differences over 21 mo (ACR not reported) | months | — | C | [S25] |
| Whey / protein supplements | none | As high protein | — | — | C | [S34] |
| Large deficit (> 25 %) | ↓ | Weight loss in CKD: proteinuria −1.31 g/24 h; surgery in hyperfiltration lowered microalbuminuria | months | Less hyperfiltration, lower BP | B | [S36] |
| Moderate deficit | ↓ (if raised) | DIRECT result above | 2 y | — | B | [S35] |
| Surplus | not reviewed | — | — | — | — | — |
| Resistance training load | ↑ transient (expected) | KDIGO: exercise raises urine albumin | hours–1 day | Haemodynamic, glomerular | B | [S27] |
| Aerobic training load | ↑ transient | 100-km race: glomerular-type proteinuria in 11.4 % at 6 h | hours | As above | B | [S40], [S27] |
| Sleep debt | not reviewed | — | — | — | — | — |
| Weight loss itself | ↓ | As deficit rows | months | — | B | [S36] |
| supp:potassium_salt_substitute | ↓ (via sodium cut, in CKD) | KDIGO: lowering dietary sodium lowered BP and albuminuria in CKD trials up to 36 wk | weeks | Lower intraglomerular pressure | B | [S27] |

### What it constrains in the plan
| Rule (index id) | Threshold | Kind, severity | Message | Grade |
|---|---|---|---|---|
| W-L-ACR-1 (W-L01) | ACR ≥ 30 mg/g | `cap` protein ≤ 1.3 g/kg/d (provisional kidney flag); RESTRICT | "Because your urine ACR was {v} mg/g on {date}, the plan keeps protein at or below 1.3 g per kg a day until a repeat test." | A |
| W-L-ACR-2 | ACR ≥ 30 mg/g | `retest` within 3 months: first-morning sample, no hard exercise for 24 h, not during a period or infection | "Retest urine ACR by {date+3m} on a first-morning sample: no hard exercise the day before, not during a period or infection." | A |
| W-L-ACR-3 | ACR ≥ 30 mg/g | `prefer` sodium < 2 g/d and weight loss when overweight | "Because your urine ACR was {v} mg/g on {date}, the plan favours less salt and steady weight loss, which lower it." | B |
| W-L-ACR-4 | ACR ≥ 30 mg/g and VLC/keto block chosen | `warn` (stones; fluids ≥ 2.5 L/d) + clinician card | "Because your ACR was {v} mg/g on {date}: keto raises kidney-stone risk (about 8 in 100 adults). Drink well and check with your doctor." | C |
| W-L-ACR-5 | ACR ≥ 300 mg/g | `clinician` | "Because your urine ACR was {v} mg/g on {date}, severely increased, please see a clinician soon." | A |

### Clinician-only thresholds
ACR ≥ 300 mg/g (A3), especially with blood in the urine, or a consistent ACR > 700 mg/g (KDIGO referral list) [S27].

### Retest interval
Confirm within 3 months [S27]; then by the KDIGO grid (G1–G2 A2: 1×/year; G3a A2: 2×/year; any A3: 3×/year) [S27]; diabetes: at least yearly [S27].

### Indian-population notes
CURES (Chennai, T2D, n = 1716): microalbuminuria 26.9 %, overt nephropathy 2.2 % [S41]. SEEK: 79.5 % of people with CKD had proteinuria [S33]. ACR is usually absent from camp profiles; it appears in diabetes panels as "Microalbumin/Creatinine ratio" in mg/g or µg/mg [S51].

---

## 6. Sodium (serum)

### Physiology and what it reflects
Serum sodium reflects **water balance relative to body sodium**, set by thirst and vasopressin; in healthy people it says little about dietary salt. Low sodium (< 135 mmol/L) is the most common electrolyte disorder [S43] and is usually dilutional: too much water for the solute available (endurance drinking, beer or low-solute diets) [S44], [S49]. Ketosis causes natriuresis early in fasting; later ammonium replaces sodium as the urinary cation [S16].

### Units and conversions
mmol/L = mEq/L (factor 1). Reported by ion-selective electrode in the "Electrolytes" or "Serum electrolytes" panel.

### Reference ranges and targets
| Source | Range | Note |
|---|---|---|
| ESE/ESICM/ERBP guideline [S43] | hyponatraemia < 135 mmol/L | |
| Exercise-associated hyponatraemia [S44] | < 135 mmol/L during or up to 24 h after exercise | |
| Lab-printed | typically 135–145 mmol/L | Upper limit from the lab |
| Intake targets | KDIGO: < 2 g sodium/d in CKD [S27]; Indian mean intake 3.49 g sodium (9.0 g salt)/d [S47] | ICMR-NIN 2020 figures were not opened this session |

### How each lever moves it
| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | small ↓ (expected) | Ketosis-linked natriuresis early; no serum number for VLC alone | first 1–2 wk | Ketoanions carry sodium into urine | D | [S16] |
| Moderate low-carb | none known | — | — | — | D | [S16] |
| High protein (≥ 1.6 g/kg) | protective (expected) | Low-solute diets are a cause of potomania; protein adds urea solute | — | More solute lets the kidney excrete water | D | [S49] |
| Fasting 16:8 | none expected | — | — | — | D | [S16] |
| Fasting 24 h | none expected | — | — | — | D | [S16] |
| Fasting 36–48 h | small ↓ (expected) | — | — | Natriuresis | D | [S16] |
| Extended fasts > 48 h | ↓ | 140.1 → 138.7 mmol/L; 6/1422 mild hyponatraemia (lowest 127), corrected with salt; fasters drank 3 L/d | 4–21 days | Natriuresis plus high water intake | B | [S16] |
| Saturated fat, dietary cholesterol, fibre, unsaturated fats | none expected | Not reviewed; no mechanism | — | — | — | — |
| Alcohol | ↓ (heavy beer, low food) | Beer potomania: dilutional hyponatraemia in case reports, sometimes with seizures | days–weeks | Large hypotonic fluid with little solute | C | [S49] |
| Caffeine | not reviewed | — | — | — | — | — |
| Creatine, whey | none expected | — | — | — | — | — |
| Large deficit (> 25 %) | ↓ risk if low solute | Restrictive diets are a reported cause of potomania | weeks | Low solute + high fluid | C | [S49] |
| Moderate deficit | none expected | — | — | — | D | [S49] |
| Surplus | none expected | — | — | — | — | — |
| Resistance training load | none expected | — | — | — | — | — |
| Aerobic training load (long sessions) | ↓ | 100-km race: 136.9 → 131.1 mmol/L at the finish (n = 51) | hours | Overdrinking hypotonic fluid, non-osmotic vasopressin | B | [S40], [S44] |
| Sleep debt | not reviewed | — | — | — | — | — |
| Weight loss itself | none expected | — | — | — | — | — |
| supp:electrolytes_fasting | ↑ (corrects) | Salt corrected all 6 hyponatraemia cases in the fasting cohort | hours–days | Replaces sodium | C | [S16] |
| supp:electrolytes_sweat_lowcarb | ↑ (corrects) | As above | — | — | C | [S16] |

### What it constrains in the plan
| Rule (index id) | Threshold | Kind, severity | Message | Grade |
|---|---|---|---|---|
| W-L-NA-1 (W-L09) | Na < 135 mmol/L | `cap` fasts ≤ 24 h | "Because your sodium was {v} mmol/L on {date}, below 135, fasts are kept to 24 hours or less." | B |
| W-L-NA-2 (W-L09) | Na < 135 mmol/L | `reask` before a VLC/keto start: "repeat test normal, or clinician agreed?" | "Because your sodium was {v} mmol/L on {date}, start keto only after a normal repeat test or your doctor's OK. Have you had either?" | C |
| W-L-NA-3 (W-L11) | Na < 135 or > 145 mmol/L | `clinician` | "Because your sodium was {v} mmol/L on {date}, outside the normal range, please see a clinician. Headache, confusion or vomiting: seek care now." | A |
| W-L-NA-4 | Na < 135 and aerobic sessions > 2 h planned | `warn`: drink to thirst, do not gain weight during sessions | "Because your sodium was {v} mmol/L on {date}: in long sessions drink to thirst, not by schedule. Gaining weight during exercise means overdrinking." | B |
| W-L-NA-5 | no sodium value and a fast > 72 h or PSMF chosen | `retest` (baseline electrolytes before starting; index VLED prerequisite) | "Fasts over 3 days need a recent sodium and potassium test. Please test before {start date}." | C |

### Clinician-only thresholds
Any value outside the lab range [S51]; < 135 mmol/L with symptoms needs urgent care [S43], [S44].

### Retest interval
Out of range: as the clinician directs (days to weeks). Before a fast > 72 h or a PSMF: within the previous 4 weeks (proposed, D). Normal: 12 months, or after a long fast if symptoms occurred.

### Indian-population notes
Indian adults eat about 9.0 g salt (3.49 g sodium) a day; 61 % exceed recommendations [S47]. Many camp profiles have no electrolytes [S51]; reports that do print "SODIUM" in mmol/L or mEq/L, ISE method, inside "Electrolytes" or "KIDPRO".

---

## 7. Potassium (serum)

### Physiology and what it reflects
About 98 % of potassium is inside cells. Serum potassium is set by kidney excretion (aldosterone, distal sodium delivery) and by shifts into cells (insulin, β2-adrenergic stimulation, alkalosis). Refeeding after starvation drives potassium, phosphate and magnesium into cells (refeeding syndrome) [S48]. High potassium is mostly a kidney or medication problem; dietary potassium matters mainly when kidney function is low [S45], [S27].

### Units and conversions
mmol/L = mEq/L (factor 1).

### Reference ranges and targets
| Source | Range | Note |
|---|---|---|
| Lab-printed | typically 3.5–5.0 or 3.5–5.1 mmol/L | |
| KDIGO 2024 action bands [S27] | ≤ 4.8; 4.9–5.5; > 5.5 mmol/L (hyperkalaemia actions); > 6 severe | Used for RAS-inhibitor and MRA decisions |
| Diet | KDIGO: in CKD, prefer limiting processed foods and potassium-chloride salt substitutes over restricting fresh plant foods [S27] | |

### How each lever moves it
| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | small ↓ (expected) | No serum number found | first weeks | Natriuresis raises aldosterone and urinary potassium loss | D | [S16] |
| Moderate low-carb | none expected | — | — | — | D | [S16] |
| High protein (≥ 1.6 g/kg) | none expected | Not reviewed | — | — | — | — |
| Fasting 16:8, 24 h, 36–48 h | none expected | No data at these lengths | — | — | D | [S16] |
| Extended fasts > 48 h | stable during; ↓ on refeeding | 4.4 → 4.4 mmol/L (statistically small fall) during 4–21-day fasts with broth and juice. Refeeding syndrome: 10–30 %+ fall in K, P or Mg within 5 days of refeeding | fast: none; refeed: days 1–5 | Insulin drives potassium into cells | B | [S16], [S48] |
| Saturated fat, dietary cholesterol, unsaturated fats | none expected | Not reviewed | — | — | — | — |
| Fibre / vegetables | none in healthy kidneys | KDIGO: bioavailable potassium from fresh plant foods is lower than assumed; higher potassium intake associates with lower CKD odds (OR 0.78) | — | — | C | [S27], [S39] |
| Alcohol | not reviewed | — | — | — | — | — |
| Caffeine | ↓ at very high intake | Case: ≥ 480 mg/d from energy drinks, K 2.0 mmol/L with rhabdomyolysis | days–weeks | β2-adrenergic shift into cells | D | [S50] |
| Creatine, whey | none expected | No electrolyte changes over 21 mo of creatine | months | — | B (creatine) | [S25] |
| Large deficit (> 25 %) | ↓ on refeeding (if very low intake) | Refeeding syndrome risk applies after prolonged very low intake | refeed days 1–5 | As above | B | [S48] |
| Moderate deficit, surplus | none expected | — | — | — | — | — |
| Resistance training load | none expected | — | — | — | — | — |
| Aerobic training load (long sessions) | ↓ | 100-km race: 4.8 → 4.0 mmol/L 6 h after (n = 51), within range | hours | Sweat loss, catecholamines | B | [S40] |
| Sleep debt, weight loss | not reviewed | — | — | — | — | — |
| supp:potassium_salt_substitute | ↑ small | 25 % KCl salt (rural China, older, hypertensive; serious kidney disease excluded): serious hyperkalaemia events 3.35 vs 3.30 per 1000 person-years (no difference). KDIGO: KCl substitutes are a high-absorption potassium source in CKD | months | Added absorbable potassium | B | [S46], [S27] |

### What it constrains in the plan
| Rule (index id) | Threshold | Kind, severity | Message | Grade |
|---|---|---|---|---|
| W-L-K-1 (W-L09) | K < 3.5 mmol/L | `cap` fasts ≤ 24 h; `reask` before VLC start (repeat test or clinician OK) | "Because your potassium was {v} mmol/L on {date}, below 3.5, fasts are kept to 24 hours and keto waits for a normal repeat test." | B |
| W-L-K-2 (W-L09) | K > 5.0 mmol/L (or above lab ULN) | `cap` potassium salt substitute and potassium-containing electrolyte mixes not suggested; fasts ≤ 24 h | "Because your potassium was {v} mmol/L on {date}, we don't suggest potassium salt or potassium electrolyte mixes. Ask your doctor." | B |
| W-L-K-3 (W-L11) | K < 3.5 or > 5.0 mmol/L | `clinician` | "Because your potassium was {v} mmol/L on {date}, outside the normal range, please see a clinician." | A |
| W-L-K-4 | K > 5.5 mmol/L | `clinician`, urgent wording | "Because your potassium was {v} mmol/L on {date}, above 5.5, please contact a clinician today." | A |
| W-L-K-5 | fast > 48 h or PSMF planned | `warn` refeeding: break the fast gently; `retest` baseline electrolytes if none recent | "After fasts over 2 days, potassium can drop in the first days of eating. Break the fast with small meals and stop if weak or palpitating." | B |
| W-L-K-6 | caffeine > 400 mg/d logged and K < 3.5 | `cap` caffeine ≤ 400 mg/d | "Because your potassium was {v} mmol/L on {date}, the plan keeps caffeine under 400 mg a day. Very high caffeine can lower potassium." | D |

### Clinician-only thresholds
Any value outside the lab range [S51]; > 5.5 mmol/L urgent (KDIGO action band) [S27]; persistent abnormal potassium is a KDIGO referral reason [S27].

### Retest interval
Out of range: clinician-directed. Before fasts > 72 h or PSMF: within 4 weeks (proposed, D). With eGFR < 60: per KDIGO grid [S27]. Normal: 12 months.

### Indian-population notes
Reported as "POTASSIUM" in mmol/L or mEq/L next to sodium and chloride. Often absent from camp profiles [S51]. Potassium-enriched "low-sodium" salts are sold in India; the catalogue entry `potassium_salt_substitute` already lists CKD, ACE/ARB/K-sparing drugs and past hyperkalaemia as contraindications.

---

## Honest gaps

| Gap | Effect on rules |
|---|---|
| No trial data for fasting 24–48 h on ALT, AST, GGT, creatinine, Na or K; expectations are extrapolated from 4–21-day fasts [S16] | Grade D rows; no rule depends on them |
| Caffeine, sleep debt and the fat-type levers were not reviewed for kidney markers and electrolytes | Rows marked "not reviewed"; left out of the JSON |
| ICMR-NIN 2020 sodium and potassium intake figures, RSSDI CKD-screening recommendations and LAI documents were not opened | Not cited. RSSDI should be checked before E20 copies any Indian diabetes-kidney wording |
| The EAH consensus (Hew-Butler 2015) could not be opened (403); the definition is taken from a case report that quotes it [S44] | Threshold < 135 is also in [S43] |
| GGT, ACR and electrolyte ranges vary by lab; no Indian population reference intervals were opened | Rules use the lab-printed range |
| Garcinia and "fat burner" products were not researched for liver injury | No rule; R13 follow-up if wanted |

---

## Sources

| # | Citation | ID | Read |
|---|---|---|---|
| S1 | Kwo PY, Cohen SM, Lim JK. ACG Clinical Guideline: Evaluation of Abnormal Liver Chemistries. Am J Gastroenterol 2017 | PMID 27995906 · doi:10.1038/ajg.2016.517 | abstract |
| S2 | Rinella ME et al. AASLD Practice Guidance on the clinical assessment and management of NAFLD. Hepatology 2023 | PMID 36727674 · doi:10.1097/HEP.0000000000000323 · PMC10735173 | full text |
| S3 | EASL-EASD-EASO Clinical Practice Guidelines on MASLD. J Hepatol 2024 | PMID 38851997 · doi:10.1016/j.jhep.2024.04.031 | abstract (background only) |
| S4 | Duseja A et al. INASL Guidance Paper on NAFLD. J Clin Exp Hepatol 2023 | PMID 36950481 · doi:10.1016/j.jceh.2022.11.014 · PMC10025685 | full text |
| S5 | Shalimar et al. Prevalence of NAFLD in India: systematic review and meta-analysis. J Clin Exp Hepatol 2022 | PMID 35677499 · doi:10.1016/j.jceh.2021.11.010 | abstract |
| S6 | Choudhary NS et al. Normal values of serum transaminases based on liver histology in healthy Asian Indians. J Gastroenterol Hepatol 2015 | PMID 25352365 · doi:10.1111/jgh.12836 | abstract |
| S7 | Aggarwal et al. Prevalence of elevated ALT in a community-based study from northern India. Indian J Gastroenterol 2020 | PMID 33098064 · doi:10.1007/s12664-020-01091-2 | abstract |
| S8 | Pettersson J et al. Muscular exercise can cause highly pathological liver function tests in healthy men. Br J Clin Pharmacol 2008 | PMID 17764474 · doi:10.1111/j.1365-2125.2007.03001.x | abstract |
| S9 | Kechagias S et al. Fast-food-based hyper-alimentation can induce rapid and profound elevation of serum ALT. Gut 2008 | PMID 18276725 · doi:10.1136/gut.2007.131797 | abstract |
| S10 | Gasteyger C et al. Effect of a dietary-induced weight loss on liver enzymes in obese subjects. Am J Clin Nutr 2008 | PMID 18469232 · doi:10.1093/ajcn/87.5.1141 | abstract |
| S11 | Browning JD et al. Short-term weight loss and hepatic triglyceride reduction: carbohydrate restriction. Am J Clin Nutr 2011 | PMID 21367948 · doi:10.3945/ajcn.110.007674 | abstract |
| S12 | Mardinoglu A et al. Rapid metabolic benefits of a carbohydrate-restricted diet on hepatic steatosis. Cell Metab 2018 | PMID 29456073 · doi:10.1016/j.cmet.2018.01.005 | abstract |
| S13 | Luukkonen PK et al. Saturated fat is more metabolically harmful for the human liver than unsaturated fat or simple sugars. Diabetes Care 2018 | PMID 29844096 · doi:10.2337/dc18-0071 | abstract |
| S14 | Ruhl CE, Everhart JE. Coffee and caffeine consumption reduce the risk of elevated serum ALT. Gastroenterology 2005 | PMID 15633120 · doi:10.1053/j.gastro.2004.09.075 | abstract |
| S15 | Xiao Q et al. Inverse associations of total and decaffeinated coffee with liver enzymes, NHANES 1999–2010. Hepatology 2014 | PMID 25124935 · doi:10.1002/hep.27367 | abstract |
| S16 | Wilhelmi de Toledo F et al. Safety, health improvement and well-being during a 4 to 21-day fasting period (1422 subjects). PLoS One 2019 | PMID 30601864 · doi:10.1371/journal.pone.0209353 · PMC6314618 | full text (tables 3–4) |
| S17 | Wei X et al. Time-restricted eating on NAFLD: TREATY-FLD RCT. JAMA Netw Open 2023 | PMID 36930148 · doi:10.1001/jamanetworkopen.2023.3513 | abstract |
| S18 | Kim et al. Omega-3 PUFA and NAFLD in adults: meta-analysis of RCTs. Clin Nutr 2025 | PMID 40441053 · doi:10.1016/j.clnu.2025.05.013 | abstract |
| S19 | Oketch-Rabah HA et al. USP comprehensive review of the hepatotoxicity of green tea extracts. Toxicol Rep 2020 | PMID 32140423 · doi:10.1016/j.toxrep.2020.02.008 | abstract |
| S20 | Björnsson HK et al. Ashwagandha-induced liver injury: case series. Liver Int 2020 | PMID 31991029 · doi:10.1111/liv.14393 | abstract |
| S21 | Guo et al. Long-term exercise on liver function and fatty liver in NAFLD: meta-analysis of RCTs. Front Nutr 2026 | PMID 41983068 · doi:10.3389/fnut.2026.1731510 | abstract |
| S22 | Alatalo PI et al. Effect of moderate alcohol consumption on liver enzymes increases with BMI. Am J Clin Nutr 2008 | PMID 18842799 · doi:10.1093/ajcn/88.4.1097 | abstract |
| S23 | Niemelä O. Biomarker-based approaches for assessing alcohol use disorders. Int J Environ Res Public Health 2016 | PMID 26828506 · doi:10.3390/ijerph13020166 · PMC4772186 | full text |
| S24 | Mohammadi et al. Milk protein supplementation on lipids, BP, oxidative stress and liver enzymes: meta-analysis. Nutr Rev 2026 | PMID 40471664 · doi:10.1093/nutrit/nuaf068 | abstract |
| S25 | Kreider RB et al. ISSN position stand: safety and efficacy of creatine supplementation. J Int Soc Sports Nutr 2017 | PMID 28615996 · doi:10.1186/s12970-017-0173-z · PMC5469049 | full text |
| S26 | Sun et al. NAFLD and sleep traits: bidirectional Mendelian randomisation. Front Endocrinol 2023 | PMID 37334291 · doi:10.3389/fendo.2023.1159258 | abstract |
| S27 | KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of CKD. Kidney Int 2024;105(4S):S117–S314 | PMID 38490803 · doi:10.1016/j.kint.2023.10.018 · https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf | full PDF (searched) |
| S28 | Inker LA et al. New creatinine- and cystatin C-based equations to estimate GFR without race. N Engl J Med 2021 | PMID 34554658 · doi:10.1056/NEJMoa2102953 · PMC8822996 | abstract + coefficient table |
| S29 | Devries MC et al. Changes in kidney function do not differ between healthy adults on higher vs lower protein diets: meta-analysis. J Nutr 2018 | PMID 30383278 · doi:10.1093/jn/nxy197 | abstract |
| S30 | Tsiaras et al. Creatine supplementation and kidney function: meta-analysis of RCTs. J Ren Nutr 2026 | PMID 42035842 · doi:10.1053/j.jrn.2026.04.010 | abstract |
| S31 | Naeini et al. Creatine supplementation and kidney function: systematic review and meta-analysis. BMC Nephrol 2025 | PMID 41199218 · doi:10.1186/s12882-025-04558-6 | abstract (its creatinine unit "µmol/L" for MD 0.07 looks like a typo for mg/dL; used only for the time pattern) |
| S32 | Preiss DJ et al. The influence of a cooked-meat meal on estimated GFR. Ann Clin Biochem 2007 | PMID 17270090 · doi:10.1258/000456307779595995 | abstract |
| S33 | Singh AK et al. Epidemiology and risk factors of CKD in India: SEEK study. BMC Nephrol 2013 | PMID 23714169 · doi:10.1186/1471-2369-14-114 | abstract |
| S34 | Friedman AN et al. Low-carbohydrate high-protein vs low-fat diets on the kidney. Clin J Am Soc Nephrol 2012 | PMID 22653255 · doi:10.2215/CJN.11741111 | abstract |
| S35 | Tirosh A et al. Renal function following three weight-loss diets during 2 years (DIRECT). Diabetes Care 2013 | PMID 23690533 · doi:10.2337/dc12-1846 | abstract |
| S36 | Navaneethan SD et al. Weight loss interventions in CKD: systematic review and meta-analysis. Clin J Am Soc Nephrol 2009 | PMID 19808241 · doi:10.2215/CJN.02250409 | abstract |
| S37 | Acharya P et al. Incidence and characteristics of kidney stones on ketogenic diet: meta-analysis. Diseases 2021 | PMID 34070285 · doi:10.3390/diseases9020039 | abstract |
| S38 | Bello et al. Ramadan fasting and kidney function in CKD and transplant: meta-analysis. BMJ Open 2024 | PMID 39572100 · doi:10.1136/bmjopen-2024-085329 | abstract |
| S39 | Kelly JT et al. Modifiable lifestyle factors for primary prevention of CKD: meta-analysis. J Am Soc Nephrol 2021 | PMID 32868398 · doi:10.1681/ASN.2020030384 | abstract |
| S40 | Gerth J et al. Prolonged physical exercise: renal function, electrolytes and muscle breakdown (100-km race). Clin Nephrol 2002 | PMID 12078945 · doi:10.5414/cnp57425 | abstract |
| S41 | Unnikrishnan RI et al. Prevalence and risk factors of diabetic nephropathy in urban South India (CURES-45). Diabetes Care 2007 | PMID 17488949 · doi:10.2337/dc06-2554 | abstract |
| S42 | Yadav et al. Recalibration of the EKFC eGFR equation for the Indian population. Kidney Int Rep 2026 | PMID 42254849 · doi:10.1016/j.ekir.2026.106543 | abstract |
| S43 | Spasovski G et al. Clinical practice guideline on diagnosis and treatment of hyponatraemia. Nephrol Dial Transplant 2014 | PMID 24569496 · doi:10.1093/ndt/gfu040 | abstract |
| S44 | Lewis et al. Considering exercise-associated hyponatraemia as a continuum. BMJ Case Rep 2018 (quotes the 2015 EAH consensus definition) | PMID 29523608 · doi:10.1136/bcr-2017-222916 · PMC5847945 | full text |
| S45 | Clase CM et al. Potassium homeostasis and management of dyskalemia in kidney diseases: KDIGO Controversies Conference. Kidney Int 2020 | PMID 31706619 · doi:10.1016/j.kint.2019.09.018 | abstract |
| S46 | Neal B et al. Effect of salt substitution on cardiovascular events and death (SSaSS). N Engl J Med 2021 | PMID 34459569 · doi:10.1056/NEJMoa2105675 | abstract |
| S47 | Patil et al. Systematic review and meta-analysis on salt and sodium intake in India. Indian J Public Health 2026 | PMID 42429521 · doi:10.4103/ijph.ijph_306_25 | abstract |
| S48 | da Silva JSV et al. ASPEN consensus recommendations for refeeding syndrome. Nutr Clin Pract 2020 | PMID 32115791 · doi:10.1002/ncp.10474 | abstract |
| S49 | Micoanski et al. Potomania and beer potomania: systematic review of case reports. Nutrients 2025 | PMID 40573123 · doi:10.3390/nu17122012 | abstract |
| S50 | Jensen et al. Energy drink-induced severe hypokalaemia and rhabdomyolysis. Ugeskr Laeger 2026 | PMID 42186885 · doi:10.61409/V11250922 | abstract (case report) |
| S51 | Vitals research index: `plan/02-next/research-blood-markers.md` (2026-10-02) | internal | full |
