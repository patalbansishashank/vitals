# R13a · Lipid markers dossier: LDL-C, HDL-C, non-HDL-C, triglycerides, ApoB, Lp(a)

Date: 2026-10-02 · Plan item 9 · Index: `plan/02-next/research-blood-markers.md` (§1.1, §3, §5) · Policy: R5 (mechanism decides use; grade sets band width and wording, never blocks) · Machine-readable rows: `R13-lipids.json` (generated from the same data as the tables below).

**Grades** (research/RESEARCH_PROTOCOL.md): A = meta-analysis or several controlled human trials; B = few RCTs or consistent human mechanistic data; C = limited or indirect human data; D = mechanism or expert opinion only. A "derived" row (non-HDL computed as LDL + TG/5 from opened figures, or ApoB inferred from LDL) is one grade lower than the anchor's grade, following R5 indirectness.

**How sources were read.** Every source in the list was opened during this job (2026-10-02). Most were abstracts (PubMed/Europe PMC), and a few were full text; the source list records which. A figure that appears only in another paper's table is labelled "second-hand". Nothing comes from memory alone. Claims that could not be confirmed are listed in "Unverified" at the end.

**Arrow legend:** ↑ up, ↓ down, – no meaningful change, ↕ mixed (it depends on phase, dose or fat type, as the cell says). The direction always refers to the marker's own value. A rise in HDL is therefore "↑" even though HDL is not a treatment target.

---

## Summary for the implementer

1. **Eggs are not banned; saturated fat matters more.** One egg yolk adds about 2–4.5 mg/dL LDL per 100 mg of cholesterol, and the effect saturates [S3]. Each 1 %E of SFA that replaces carbohydrate adds 1.4 mg/dL [S1], so swapping 10 %E of SFA for PUFA moves LDL by about 22 mg/dL. With LDL ≥ 130 mg/dL the rules cap SFA below 10 %E (W-L-LDL-1) and prefer at most one yolk a day (W-L-LDL-2).
2. **Keto: mean effect small, tail large.** In mixed and obese populations LDL rises 4.6–6.2 mg/dL against low-fat [S5, S6]. In lean people it rose by 44 % in 3 weeks [S8], and by +70 mg/dL in 17 of 17 women in 4 weeks [S7]. Keto is never removed for high LDL. Instead the warning is moved ahead of the plan (W-L-LDL-5, W-L-HDL-4 for the lean high-HDL/low-TG profile), and a retest is set at about 8 weeks (W-L-LDL-6).
3. **TG is the lipid the plan helps most.** Carbohydrate restriction, weight loss, exercise and omega-3 each lower TG. Alcohol and sugar raise it. At TG ≥ 500 mg/dL a clinician card shows, fat is capped at 30 %E, keto is not *proposed* but stays choosable after a clinician, and alcohol is planned at zero (W-L-TG-5..7).
4. **Lp(a) has almost no diet lever.** Keto lowers it by about 15 %, and cutting SFA raises it by 9–23 % [S11, S28, S46]. Neither effect justifies a diet choice. A high Lp(a) raises the weight of the LDL/ApoB cautions and shows a clinician note. It is measured once.
5. **Fasting changes the test, not only the person.** LDL and ApoB rose about 65 % during a 7-day fast [S54]. Before using a lab drawn within 2 weeks of a fast longer than 48 h, the app re-asks (W-L-LDL-8).
6. **Retest:** lipids reach a new level 3–4 weeks after a diet change [S1, S7, S8], so the default retest is at 8 weeks (6 for TG). Lp(a) is not retested. HDL is read again only once weight is stable.

### Where this dossier differs from the index (`research-blood-markers.md`)

| # | Index says | This dossier | Why |
|---|---|---|---|
| 1 | LAI 2023 targets cited as `PMC11019331` | PMC11019331 is the **Cardiological Society of India (CSI) 2023** executive summary, not LAI. The LAI figures (< 50, ≤ 30 mg/dL) are confirmed from the LAI 2024 JAPI abstract [S68] | The source was opened and its identity checked |
| 2 | TG ≥ 500: "blocks high-fat/keto", "exclude" | Cap (fat ≤ 30 %E). Keto is not proposed but can be chosen after a clinician; alcohol is capped at 0; a clinician card shows | Owner rule: nothing is banned outright |
| 3 | Clinician at TG ≥ 880 mg/dL | Clinician card at ≥ 500 (ADA: needs medical therapy) and "soon" at ≥ 1000 (Endocrine Society severe) | 880 mg/dL was not found in any opened source; 500 and 1000 were |
| 4 | Eggs: about +6.7 mg/dL LDL on average (research/06 V2) | +1.9 (linear) to +4.5 (saturating) mg/dL LDL per 100 mg/d cholesterol [S3] | Newer and larger meta-analysis (55 RCTs) opened. The index figure is per a different exposure and was not re-opened |
| 5 | Weight loss lowers LDL by about 0.6 mg/dL per kg | Per-kg slope not confirmed. Interventions lower LDL by 7.7 mg/dL at 6–12 months [S56]; the correlation with kg lost is r = 0.29 [S55] | The opened abstracts give no slope |
| 6 | Lp(a): "diet barely moves it" | Kept. Added: diet-induced weight loss *raised* Lp(a) by 14.8 nmol/L in T2D [S65] | New source |
| 7 | Fasting 24–72 h: LDL "transiently ↑ W" | Kept, and extended: > 3 days of true fasting raised LDL and ApoB by ~65 % [S54]. This adds a re-ask before using a lab drawn after a long fast (W-L-LDL-8) | New sources |
| 8 | ESC 2019 ApoB goals < 65/80/100 (unverified) | Still unverified. The planner uses the EAS/EFLM flag ApoB ≥ 100 mg/dL [S74] as its only ApoB trigger | No opened page showed the ESC table |
| 9 | Lp(a) nmol/L threshold 125 (open question 3) | Kept at 125 nmol/L (EAS 2022, CSI). The ESC 2025 figure of 105 nmol/L is listed but low-confidence | S71 page identity not independently verified |

---

## 1. LDL cholesterol (LDL-C)

### Physiology and what it reflects
- LDL-C is the cholesterol carried in LDL particles. The liver secretes VLDL, which becomes LDL after lipolysis. Hepatic LDL receptors clear LDL, and their number sets most of the steady-state level.
- Diet acts mainly through the receptors. Saturated fat and dietary cholesterol down-regulate them, while viscous fibre (bile-acid loss) and PUFA up-regulate them [S1, S18].
- LDL-C is causal for ASCVD. Risk tracks the number of ApoB particles more closely than LDL cholesterol mass [S44, S45].
- Diet-driven changes settle within 2–4 weeks [S1, S7, S8].
- Reports give either direct LDL or calculated LDL (Friedewald). Friedewald is not valid above TG 400 mg/dL [S75]. The Sampson equation is accurate up to TG 800 [S81].

### Units and conversions
mg/dL = mmol/L × 38.67 (inverse of the CDC multiplier 0.02586) [S75]. Indian labs report mg/dL.

### Reference ranges and targets
| Region / body | Low | High | Target | Note | Source |
|---|---|---|---|---|---|
| US/India lab print | — | 100 | — | ATP III: < 100 optimal, 100–129 near optimal, 130–159 borderline high, 160–189 high, ≥ 190 very high (mg/dL). Printed on most Indian reports. | S80 |
| India | — | — | 100 | CSI 2023 goals: < 100 low/moderate risk, < 70 high, < 55 very high and extreme risk (mg/dL). | S66 |
| India | — | — | 50 | LAI: < 50 mg/dL for established ASCVD or diabetes with added risk factors; ≤ 30 optional for extreme risk (abstract). | S68 |
| Europe | — | — | 55 | ESC/EAS 2019: < 116 low, < 100 moderate, < 70 high, < 55 very high risk (mg/dL). | S70 |
| Diabetes (ADA) | — | — | 70 | ADA 2026: age 40–75 with diabetes < 70; with ASCVD < 55 mg/dL. | S79 |
| Non-fasting flag | — | 116 | — | EAS/EFLM: non-fasting LDL ≥ 3 mmol/L (≈ 116 mg/dL) is flagged; non-fasting LDL reads ≈ 8 mg/dL lower. | S74 |

Indian cut-offs are stricter than European ones at very high risk. LAI uses < 50 mg/dL (and ≤ 30 for extreme risk) where ESC/EAS and CSI use < 55 mg/dL [S66, S68, S70]. Following index open question 4, the app shows the lab's printed range and "your clinician sets your target", and never a personal target.

### How each lever moves it
| Lever | Dir. | Effect size (units, population) | Time course | Mechanism (one line) | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto (≤ 50 g/d) `vlc` | ↑ up | +0.12 mmol/L (+4.6 mg/dL) vs low-fat at ≥ 12 mo [S5]; +0.16 mmol/L (+6.2 mg/dL) at ≥ 6 mo [S6]. Lean adults: +44 % in 3 wk (range +5 to +107 %) [S8]; +1.82 mmol/L (+70 mg/dL) in 4 wk, rise in 17/17 women [S7]. Self-selected survey: mean +91 mg/dL (SD 103), −5.9 mg/dL per BMI unit [S9] — Overweight/obese RCT adults (mean); normal-weight young adults (tail) | 3 wk | More saturated fat lowers hepatic LDL-receptor activity; in lean people, more fat-carrying lipoprotein output (Lipid Energy Model, a hypothesis) | A | S5, S6, S7, S8, S9 |
| Moderate low-carb (≈ 20–45 %E) `lowcarb` | – none | +0.07 mmol/L (+2.7 mg/dL) vs low-fat at 6–12 mo [S12]; LDL fell 3.7 mg/dL less than on low-fat [S14]; −1.0 mg/dL vs usual diet at 6 mo [S13] — Overweight/obese adults, 23–121 RCTs | 26 wk | Smaller SFA rise than keto; weight loss offsets it | A | S12, S13, S14 |
| High protein (≥ 1.6 g/kg) `highprotein` | – none | −3.3 mg/dL (protein 25 %E vs carbohydrate diet, 6-wk feeding) [S15]; no difference in energy-restricted trials (mean 12 wk) [S16]; not significant across 74 trials [S17] — Adults with prehypertension (OmniHeart); overweight adults | 6 wk | Protein replacing refined carbohydrate; half plant protein in OmniHeart | A | S15, S16, S17 |
| Fasting 16:8 (TRE) `fast16_8` | – none | TRE + CR vs CR alone: +0.5 mg/dL (95 % CI −8.5 to 9.5) at 12 mo [S48]; +1.39 mg/dL (ns) across 6 RCTs [S49] — Adults with obesity | 52 wk | No effect beyond the energy deficit it produces | A | S48, S49 |
| Fasting 24 h `fast24` | ↑ up | +23 mg/dL after one 24-h water fast (second-hand figure from S51 table; abstract S50 reports total cholesterol up); pooled fasts ≤ 3 d: Hedges g +0.32 — Healthy adults, crossover | 1 d | Fasting lipolysis and lower insulin; reduced LDL clearance is the leading hypothesis (not established) | C | S50, S51 |
| Fasting 36–48 h `fast36_48` | ↑ up | Pooled water-only fasts ≤ 3 d: LDL Hedges g +0.32 (standardised, small-to-moderate) [S51]; no direct 36–48 h trial opened — Mixed adults, 22 studies | 2 d | As for 24 h; extrapolated | C | S51 |
| Extended fast > 48 h `fast48plus` | ↕ mixed | Zero-energy 7 d: 2.95 → 4.90 mmol/L (+66 %, +75 mg/dL) [S54]; pooled fasts > 3 d g +0.62, biphasic with a turning point near 10 d [S51]; 14-d 250 kcal/d modified fast: −0.72 mmol/L (−28 mg/dL) at day 14 [S53] — Non-obese healthy adults (S54, n = 10); clinic fasters (S53, n = 40) | 1 wk | Mobilised adipose lipid and reduced clearance during true fasting; falls again later in long modified fasts | B | S51, S53, S54 |
| Saturated fat `satfat` | ↑ up | +0.036 mmol/L (+1.4 mg/dL) per 1 %E SFA replacing carbohydrate; vs PUFA the swap differs by 0.058 mmol/L (2.2 mg/dL) per %E [S1]. Cutting SFA 15 → 6 %E lowered LDL 11 % in 8 wk [S27]. Coconut oil +10.5 mg/dL vs non-tropical oils [S29] — 165 diets / 2026 subjects (S1); 103 healthy adults (S27) | 3 wk | SFA lowers hepatic LDL-receptor activity, so LDL clearance falls | A | S1, S27, S29 |
| Dietary cholesterol / eggs `dietcholesterol` | ↑ up | +1.9 mg/dL per +100 mg/d (linear) to +4.5 mg/dL (non-linear, saturating) [S3]; total cholesterol +2.2 mg/dL per 100 mg/d [S2] — 55 RCTs, 2652 adults | 3 wk | Absorbed cholesterol suppresses hepatic LDL-receptor synthesis; saturable, with hypo- and hyper-responders | A | S2, S3, S4 |
| Fibre (soluble) `fibre` | ↓ down | −0.057 mmol/L (−2.2 mg/dL) per g soluble fibre at 2–10 g/d [S18]; oat β-glucan ≥ 3 g/d −0.25 mmol/L (−9.7 mg/dL) [S20] — Adults, 2–12 wk trials | 4 wk | Viscous fibre binds bile acids; the liver draws LDL cholesterol to make more | A | S18, S20 |
| Unsaturated fats `unsatfat` | ↓ down | Per 1 %E replacing carbohydrate: PUFA −0.022 mmol/L (−0.85 mg/dL), MUFA −0.009 mmol/L [S1]; nuts −4.8 mg/dL per daily serving [S21] — Controlled feeding trials (S1); 61 trials (S21) | 3 wk | PUFA up-regulates LDL-receptor activity; displaces SFA | A | S1, S21 |
| Alcohol `alcohol` | – none | LDL change not reported in the opened meta-analyses (they report HDL and TG) [S22, S23] — Adults, short feeding trials | 4 wk | No direct LDL-receptor pathway known; expectation is no change | D | S22, S23 |
| Caffeine / coffee `caffeine` | ↕ mixed | Coffee: LDL +5.4 mg/dL (95 % CI 1.4–9.5), larger for unfiltered and in hyperlipidaemia [S26]; filtered coffee "very little increase" [S25]. Caffeine 400 mg/d alone: no lipid change in one 8-wk RCT (cirrhosis) [S36] — 12 RCTs, 1017 Western adults (~45 d) | 6 wk | Unfiltered brew carries lipid-raising coffee oils; caffeine itself shows no effect (oil mechanism not re-opened here) | B | S25, S26, S36 |
| Creatine `creatine` | – none | +4.08 mg/dL (95 % CI −2.55 to 10.70, ns), 8 RCTs, very low-to-low certainty [S35] — Adults in 8 RCTs | 8 wk | No known pathway to LDL metabolism | C | S35 |
| Whey / protein supplements `wheyprotein` | – none | −0.08 mmol/L (−3 mg/dL; 95 % CI −0.23 to 0.07, ns), 13 RCTs [S34] — Adults, 13 RCTs | 8 wk | No expected effect beyond displacing other foods | B | S34 |
| Large deficit (> 25 %) `deficit_large` | ↕ mixed | VLCD 8 wk: LDL fell in weeks 1–3, then returned to baseline by week 8 [S57] — Severely obese adults (BMI 40) | 8 wk | Early fall with less intake; adipose cholesterol released during rapid loss (hypothesis) | C | S57 |
| Moderate deficit `deficit_moderate` | ↓ down | Weight-loss interventions: −0.20 mmol/L (−7.7 mg/dL) at 6–12 mo [S56]; alternate-day fasting −5.8 mg/dL with −4.3 kg [S52] — 83 RCTs (S56); 7 RCTs (S52) | 26 wk | Lower hepatic cholesterol synthesis and VLDL output as fat mass falls | A | S52, S56 |
| Surplus `surplus` | ↕ mixed | +1000 kcal/d for 3 wk raised LDL only when the surplus was saturated fat [S59]; +1250 kcal/d for 28 d: no LDL change [S58] — Healthy adults, 3–4 wk | 3 wk | Effect follows the fat type of the surplus (SFA → LDL-receptor down) | B | S58, S59 |
| Resistance training load `resistance_load` | ↓ down | −6.1 mg/dL (29 RCTs, ≥ 4 wk) [S62]; a 2025 pooled analysis found only HDL improved with resistance training [S61] — 1329 adults (S62) | 12 wk | Unclear; partly via body composition | B | S61, S62 |
| Aerobic training load `aerobic_load` | ↓ down | All exercise: −7.2 mg/dL (95 % CI −9.1 to −5.4; 178 studies); aerobic training lowers LDL [S61]; benefit tracks weekly volume more than intensity [S82] — 6867 adults (S61) | 12 wk | Higher lipoprotein lipase activity and lipid turnover | A | S61, S82 |
| Sleep debt `sleep_debt` | – none | Short sleep: RR 1.01 (0.93–1.10) for incident dyslipidaemia [S63]; experimental restriction lowered LDL in n = 14 [S64] — 30 033 adults (S63) | 4 wk | No consistent pathway in humans | C | S63, S64 |
| Weight loss itself `weight_loss` | ↓ down | −0.20 mmol/L (−7.7 mg/dL) at 6–12 mo [S56]; LDL fall correlates with kg lost (r = 0.29) [S55] — 70 studies (S55); 83 RCTs (S56) | 26 wk | Less hepatic cholesterol synthesis; smaller VLDL pool | A | S55, S56 |
| Supplement: omega-3 EPA+DHA `supp:omega3_epa_dha` | ↕ mixed | 4 g/d EPA+DHA can raise LDL in TG ≥ 500 mg/dL; EPA-only did not [S31]; dose-response curve J-shaped [S32] — Adults with hypertriglyceridaemia | 8 wk | DHA speeds VLDL → LDL conversion when VLDL is high | A | S31, S32 |
| Supplement: psyllium (isabgol) `supp:psyllium` | ↓ down | −0.33 mmol/L (−12.8 mg/dL; 95 % CI −0.38 to −0.27) at ~10 g/d [S19] — 28 trials, 1924 adults, ≥ 3 wk | 4 wk | Bile-acid binding (viscous fibre) | A | S19 |
| Supplement: plant (soy) protein `supp:plant_protein` | ↓ down | −4.76 mg/dL (≈ −3 to −4 %) at median 25 g/d soy protein, ~6 wk [S33] — Adults with LDL 110–201 mg/dL, 41 trials | 6 wk | Soy protein components raise LDL-receptor activity (mechanism debated) | A | S33 |
| Supplement: green-tea catechins `supp:green_tea_extract` | ↓ down | −2.19 mg/dL (95 % CI −3.16 to −1.21) [S37] — 14 RCTs, 1136 adults | 8 wk | Catechins reduce intestinal cholesterol absorption | A | S37 |
| Supplement: CLA (as weight-loss pill) `supp:cla_chitosan_glucomannan` | – none | CLA: LDL WMD +0.49 (ns) in 56 RCTs [S39]; an older analysis found −0.22 (units not stated) [S40] — Adults, 56 RCTs | 12 wk | No consistent effect; glucomannan was not assessed here | B | S39, S40 |
| Supplement: Garcinia / HCA `supp:garcinia` | – none | LDL not significant; total cholesterol −6.8 mg/dL [S41] — 14 RCTs, 623 adults | 8 wk | Unclear | C | S41 |
| Supplement: vitamin D3 `supp:vitamin_d3` | ↓ down | SMD −0.12 (small) [S42] — 41 RCTs, 3434 adults | 12 wk | Unclear; larger in deficiency | B | S42 |
| Supplement: magnesium `supp:magnesium` | – none | −0.01 mmol/L (ns) [S43] — Adults with/without diabetes | 12 wk | None expected | A | S43 |
| Supplement: exogenous ketones `supp:exogenous_ketones` | – none | No human trial found; rat study shows little lipid change over 28 d [S83] — Rats | 4 wk | Mechanistic expectation: none (no SFA or carbohydrate change) | D | S83 |

Not tabulated:
- Ashwagandha: no human lipid trial was found in Europe PMC (searched 2026-10-02).
- L-carnitine: LDL figures were not in the opened abstract.
- Ghee: no Indian trial was found. One Iranian NAFLD trial swapped ghee for rapeseed oil, but weight fell 4.3 kg and the reported changes are within-group, so it is not usable as an effect size [S85].

### What it constrains in the plan
| Id | When | Kind / severity | Acts on | Message (≤ 200 chars) | Grade | Sources | Index id |
|---|---|---|---|---|---|---|---|
| W-L-LDL-1 | ldl >= 130 mg/dL | cap / caution | `satfat` = 10 | Saturated fat is kept under 10 % of energy because your LDL was {value} mg/dL on {date}. Ghee, butter, coconut oil and fatty dairy are swapped for vegetable oils. | A | S1, S27, S29 | W-L05 |
| W-L-LDL-2 | ldl >= 130 mg/dL | prefer / info | `eggYolksPerDay` = 1 | Up to one egg yolk a day; extra eggs as whites, because your LDL was {value} mg/dL on {date}. Eggs are not removed; the effect is small but real. | A | S2, S3, S4 | — |
| W-L-LDL-3 | ldl >= 130 mg/dL | prefer / info | `fibre` = 10 | More soluble fibre (oats, dal, isabgol; aim ~10 g/day) because your LDL was {value} mg/dL on {date}. About 10 g psyllium lowers LDL by ~13 mg/dL. | A | S18, S19, S20 | — |
| W-L-LDL-4 | ldl >= 130 mg/dL | prefer / info | `unsatfat` | Nuts and unsaturated oils are preferred over saturated fats because your LDL was {value} mg/dL on {date}. | A | S1, S21 | — |
| W-L-LDL-5 | ldl >= 160 mg/dL | warn / caution | `vlc` | Very-low-carb raised LDL in every lean woman in one trial (+70 mg/dL in 4 weeks). Your LDL was {value} mg/dL on {date}. Plan a retest after 6–8 weeks. | B | S5, S7, S8, S9 | W-M09 (shown before the plan) |
| W-L-LDL-6 | ldl >= 0 mg/dL | retest / info | `vlc\|satfat>=15` = 8 | Your plan changes fat or carbohydrate a lot. LDL settles within 3–4 weeks; retest lipids at about 8 weeks to compare with {value} mg/dL on {date}. | A | S1, S7, S8 | — |
| W-L-LDL-7 | ldl >= 190 mg/dL | clinician / danger | `clinicianCard` | Your LDL was {value} mg/dL on {date}. At 190 or more, an inherited condition is possible. Please see a clinician; the plan continues with LDL cautions on. | A | S80 | W-L11 |
| W-L-LDL-8 | ldl >= 0 mg/dL | reask / info | `recentFastOver48h` | Was the {date} test within 2 weeks of a fast longer than 2 days? LDL rose 66 % during a 7-day fast, so that result may not be your usual level. | B | S51, S54 | — |
| W-L-LDL-9 | ldl >= 130 mg/dL | prefer / info | `caffeine` | Prefer filtered or instant coffee over boiled or unfiltered coffee, because your LDL was {value} mg/dL on {date}. Unfiltered coffee raises LDL ~5 mg/dL. | B | S25, S26 | — |

### Clinician-only thresholds
| Threshold | Message | Source |
|---|---|---|
| >= 190 mg/dL | LDL at or above 190 mg/dL can mean an inherited cholesterol condition. Please see a clinician; Vitals keeps planning but cannot assess this. | S80 |

### Retest interval
8 weeks after starting any plan that changes SFA, carbohydrate or energy a lot, within the range 6–12 (index §8). The rationale is that diet effects settle in 3–4 weeks [S1, S7, S8], and ESC re-evaluates at 4–12 weeks after a change [S70, partial]. Do not draw within 2 weeks after a fast longer than 48 h (W-L-LDL-8). With no plan change, retest yearly.

### Indian-population notes
- ICMR-INDIAB phase 1 (2042 adults with fasting lipids) found high LDL (≥ 130 mg/dL) in 11.8 % and any dyslipidaemia in 79 % [S76]. The 2023 national survey found dyslipidaemia in 81.2 % by ATP III criteria [S77].
- More than 90 % of Indians with diabetes have dyslipidaemia [S69].
- Chain-lab "Lipid profile" pages list total cholesterol, TG, HDL (direct), LDL (direct or calculated), VLDL (calculated) and ratios, with ATP III categories printed beside each value (index §4).
- Store whether LDL was direct or calculated. Common SFA sources in Indian diets are ghee, butter, full-fat dairy, paneer and coconut oil; coconut oil raises LDL by 10.5 mg/dL against non-tropical oils [S29].

---

## 2. HDL cholesterol (HDL-C)

### Physiology and what it reflects
- HDL carries cholesterol back from tissues. ApoA-I production and lipoprotein-lipase-driven exchange with TG-rich particles set its level, so low HDL usually travels with high TG and insulin resistance.
- Raising HDL is not a treatment target. CSI calls it "a risk marker, not a risk factor", and raising HDL with drugs is not recommended [S66].
- In the planner HDL has two jobs:
  - It is a predictor of the keto LDL response. High HDL with low TG and leanness predicts the largest LDL rises [S9].
  - It is a display marker.
- During active weight loss HDL falls (−0.007 mmol/L per kg) and then rises once weight is stable (+0.009 mmol/L per kg) [S55]. A mid-diet HDL is therefore not interpretable alone.

### Units and conversions
mg/dL = mmol/L × 38.67 [S75].

### Reference ranges and targets
| Region / body | Low | High | Target | Note | Source |
|---|---|---|---|---|---|
| US/India lab print | 40 | — | — | ATP III: < 40 low; ≥ 60 high. Metabolic-syndrome criterion < 40 men / < 50 women. | S80 |
| India | 40 | — | — | CSI 2023: desirable > 40 men, > 50 women; a risk marker, not a target; raising HDL with drugs not recommended. | S66 |
| Non-fasting flag | 40 | — | — | EAS/EFLM: ≤ 1 mmol/L (≈ 40 mg/dL) flagged. | S74 |

### How each lever moves it
| Lever | Dir. | Effect size (units, population) | Time course | Mechanism (one line) | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto (≤ 50 g/d) `vlc` | ↑ up | +0.09 mmol/L (+3.5 mg/dL) vs low-fat [S5]; +0.14 mmol/L (+5.4 mg/dL) [S6]; +13 mg/dL in a self-selected survey [S9] — Overweight/obese RCT adults | 4 wk | More dietary fat raises apoA-I production; less VLDL exchange | A | S5, S6, S9 |
| Moderate low-carb (≈ 20–45 %E) `lowcarb` | ↑ up | +0.05 mmol/L (+1.9 mg/dL) vs low-fat [S12]; +3.3 mg/dL vs low-fat [S14]; +2.3 mg/dL vs usual diet at 6 mo [S13] — Overweight/obese adults | 26 wk | As above, smaller | A | S12, S13, S14 |
| High protein (≥ 1.6 g/kg) `highprotein` | – none | −1.3 mg/dL (protein vs carbohydrate diet) [S15]; no difference in energy-restricted trials [S16] — Adults (OmniHeart; 12-wk trials) | 6 wk | None of note | A | S15, S16 |
| Fasting 16:8 (TRE) `fast16_8` | – none | TRE + CR vs CR: +1.6 mg/dL (95 % CI −1.1 to 4.3) at 12 mo [S48] — Adults with obesity | 52 wk | No effect beyond weight change | B | S48 |
| Fasting 24 h `fast24` | ↑ up | 54.4 → 57.4 mg/dL after a 24-h water fast (second-hand from S51; abstract S50 confirms HDL rose) — Healthy adults, crossover | 1 d | Acute shift in lipoprotein exchange with fasting lipolysis | C | S50, S51 |
| Fasting 36–48 h `fast36_48` | – none | Pooled fasts ≤ 3 d: Hedges g −0.01 [S51] — Mixed adults | 2 d | No change expected in the first 3 days | C | S51 |
| Extended fast > 48 h `fast48plus` | ↓ down | Pooled fasts > 3 d: g −0.33, threshold near 3 d [S51]; slight fall at 14 d with more large HDL particles [S53]; unchanged at 7 d (n = 10) [S54] — Mixed adults | 1 wk | Less dietary fat and apoA-I synthesis during prolonged fasting | B | S51, S53, S54 |
| Saturated fat `satfat` | ↑ up | +0.011 mmol/L (+0.43 mg/dL) per 1 %E replacing carbohydrate [S1]; cutting SFA 15 → 6 %E lowered HDL 11 % [S27]; coconut oil +4.0 mg/dL [S29] — Controlled feeding trials | 3 wk | Dietary fat raises apoA-I production | A | S1, S27, S29 |
| Dietary cholesterol / eggs `dietcholesterol` | ↑ up | +0.008 mmol/L (+0.3 mg/dL) per 100 mg/d [S2]; sex-dependent direction [S3] — 17 studies, 556 adults | 3 wk | Small | A | S2, S3 |
| Fibre (soluble) `fibre` | – none | HDL unchanged with soluble fibre [S18] and oat β-glucan [S20] — Adults, 2–12 wk | 4 wk | No pathway | A | S18, S20 |
| Unsaturated fats `unsatfat` | ↑ up | Per 1 %E replacing carbohydrate: MUFA +0.008, PUFA +0.006 mmol/L (+0.3 / +0.2 mg/dL) [S1] — Controlled feeding trials | 3 wk | Dietary fat raises apoA-I production | A | S1 |
| Alcohol `alcohol` | ↑ up | +3.99 mg/dL per 30 g ethanol/d [S22]; +0.094 mmol/L (+3.6 mg/dL), dose-dependent [S23] — 42–44 short feeding trials | 3 wk | Ethanol raises apoA-I and HDL production; this rise is not evidence of benefit | A | S22, S23 |
| Caffeine / coffee `caffeine` | – none | Coffee meta-analysis reported total and LDL cholesterol and TG, not an HDL change [S26]; caffeine alone: no lipid change [S36] — Adults | 6 wk | None expected | D | S26, S36 |
| Creatine `creatine` | – none | −0.68 mg/dL (ns) [S35] — 8 RCTs | 8 wk | None expected | C | S35 |
| Whey / protein supplements `wheyprotein` | – none | +0.01 mmol/L (ns) [S34] — 13 RCTs | 8 wk | None expected | B | S34 |
| Large deficit (> 25 %) `deficit_large` | ↓ down | VLCD 8 wk: 1.26 → 1.04 mmol/L (−8.5 mg/dL) [S57]; −0.007 mmol/L per kg while actively losing [S55] — Severely obese adults | 8 wk | Less dietary fat and apoA-I synthesis while intake is very low; reverses once weight is stable | B | S55, S57 |
| Moderate deficit `deficit_moderate` | ↕ mixed | −0.007 mmol/L per kg during active loss; +0.009 mmol/L per kg once weight is stable [S55] — 70 weight-loss studies | 12 wk | Falls during loss, rises after stabilising | A | S55 |
| Surplus `surplus` | ↑ up | +11 % with +1250 kcal/d for 28 d [S58]; rose in the SFA-overfeeding arm only [S59] — Healthy adults | 4 wk | More fat intake raises apoA-I | B | S58, S59 |
| Resistance training load `resistance_load` | – none | +0.7 mg/dL (ns) [S62]; modest rise in a 2025 pooled analysis [S61] — 29 RCTs | 12 wk | Small | B | S61, S62 |
| Aerobic training load `aerobic_load` | ↑ up | +2.53 mg/dL; threshold ≈ 900 kcal/wk or 120 min/wk; +1.4 mg/dL per extra 10 min/session [S60]; +2.11 mg/dL all exercise [S61] — 25 RCTs (S60) | 12 wk | Higher lipoprotein lipase and LCAT activity | A | S60, S61 |
| Sleep debt `sleep_debt` | – none | Large HDL particles lower in people reporting insufficient sleep (cohort); HDL-C change not quantified [S64]; no association with incident dyslipidaemia [S63] — Cohorts, n = 2739; n = 30 033 | 4 wk | Down-regulated cholesterol-transport genes (hypothesis) | C | S63, S64 |
| Weight loss itself `weight_loss` | ↕ mixed | −0.007 mmol/L per kg while losing; +0.009 mmol/L per kg at stable reduced weight [S55] — 70 studies | 12 wk | Phase-dependent | A | S55 |
| Supplement: omega-3 EPA+DHA `supp:omega3_epa_dha` | ↕ mixed | Dose-response curve J-shaped (non-linear) [S32] — 90 RCTs, 72 598 adults | 8 wk | Faster VLDL clearance shifts HDL composition | B | S32 |
| Supplement: CLA (as weight-loss pill) `supp:cla_chitosan_glucomannan` | ↕ mixed | HDL WMD −0.40 (−0.72 to −0.07), while the abstract text says "improved": internally inconsistent [S39] — 56 RCTs | 12 wk | Unclear | C | S39 |
| Supplement: Garcinia / HCA `supp:garcinia` | ↑ up | +2.95 mg/dL (2.01–3.89) [S41] — 14 RCTs, 623 adults | 8 wk | Unclear; small heterogeneous trials | C | S41 |
| Supplement: magnesium `supp:magnesium` | ↑ up | +1.21 mg/dL (0.58–1.85) [S84]; ns in an older analysis [S43] — Adults (dose-response meta-analysis) | 12 wk | Unclear | B | S43, S84 |

### What it constrains in the plan
| Id | When | Kind / severity | Acts on | Message (≤ 200 chars) | Grade | Sources | Index id |
|---|---|---|---|---|---|---|---|
| W-L-HDL-1 | M, hdl < 40 mg/dL | prefer / info | `aerobic_load` = 120 | Aerobic exercise of 120+ min/week is ranked higher because your HDL was {value} mg/dL on {date}; it raises HDL by about 2.5 mg/dL. | A | S60 | — |
| W-L-HDL-2 | F, hdl < 50 mg/dL | prefer / info | `aerobic_load` = 120 | Aerobic exercise of 120+ min/week is ranked higher because your HDL was {value} mg/dL on {date}; it raises HDL by about 2.5 mg/dL. | A | S60 | — |
| W-L-HDL-3 | hdl < 40 mg/dL | warn / info | `alcohol` | Alcohol raises HDL, but that is not a reason to drink: a higher HDL number from alcohol is not shown to protect the heart. Your HDL was {value} mg/dL on {date}. | B | S22, S23, S66 | — |
| W-L-HDL-4 | hdl >= 80 mg/dL and tg <= 70 mg/dL and bmi < 25 | warn / caution | `vlc` | Lean, with high HDL ({value} mg/dL on {date}) and low TG: on very-low-carb, people like this saw the largest LDL rises (median +146 mg/dL). Retest at 6–8 weeks. | C | S9 | — |
| W-L-HDL-5 | hdl >= 0 mg/dL | retest / info | `deficit_moderate\|deficit_large` = 0 | HDL often dips while you are losing weight and recovers once weight is stable. Compare with {value} mg/dL ({date}) after weight has been steady for a few weeks. | A | S55, S57 | — |

### Clinician-only thresholds
None found in an opened guideline. The app uses the clinician thresholds of the other lipid markers.

### Retest interval
HDL is measured with the lipid panel, so there is no separate retest. During a deficit, read it again only after weight has been stable for a few weeks (W-L-HDL-5).

### Indian-population notes
- Low HDL is the most common lipid abnormality in India: 72.3 % in ICMR-INDIAB phase 1, isolated low HDL in 44.9 % [S76].
- Indian reports print HDL as "HDL cholesterol – direct" with ATP III or sex-split ranges (< 40 men / < 50 women).
- Because low HDL is so common, the app must not treat it as an alarm. It only ranks aerobic training higher.

---

## 3. Non-HDL cholesterol

### Physiology and what it reflects
Non-HDL-C is total cholesterol minus HDL-C. It is the cholesterol in all ApoB-containing particles: LDL, VLDL, IDL, remnants and Lp(a).
- It is valid without fasting; a non-fasting value reads only about 8 mg/dL lower [S74].
- It does not depend on Friedewald, so it is the better LDL substitute when TG is high or LDL is calculated.
- LAI and CSI use it as a co-primary target with LDL [S66, S67].
- Vitals computes it from total cholesterol and HDL (index §2) rather than asking for it.
- When a lever's effect is known only for LDL and TG, the change is derived as ΔLDL + ΔTG/5 in mg/dL. Those rows are marked "derived" and are one grade lower than their source.

### Units and conversions
mg/dL = mmol/L × 38.67 [S75].

### Reference ranges and targets
| Region / body | Low | High | Target | Note | Source |
|---|---|---|---|---|---|
| India | — | — | 130 | CSI 2023 goals: < 130 low/moderate, < 100 high, < 85 very high and extreme risk (mg/dL). | S66 |
| Europe | — | — | 85 | ESC/EAS 2019: goal ≈ LDL goal + 30 mg/dL (exact table not confirmed this session). | S70 |
| Non-fasting flag | — | 150 | — | EAS/EFLM: ≥ 3.9 mmol/L (≈ 150 mg/dL) flagged. | S74 |

### How each lever moves it
| Lever | Dir. | Effect size (units, population) | Time course | Mechanism (one line) | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto (≤ 50 g/d) `vlc` | ↕ mixed | Derived (non-HDL ≈ LDL + TG/5): mixed populations ≈ +1 mg/dL (LDL +4.6, TG −16) [S5]; lean adults rise with LDL (+70 mg/dL LDL in 4 wk) [S7] — As for LDL | 3 wk | LDL rise partly offset by lower VLDL cholesterol | B | S5, S7 |
| Moderate low-carb (≈ 20–45 %E) `lowcarb` | – none | Derived: ≈ +1 mg/dL (LDL +2.7, TG −8.9 vs low-fat) [S12] — Overweight/obese adults | 26 wk | Opposing LDL and VLDL changes | B | S12 |
| High protein (≥ 1.6 g/kg) `highprotein` | ↓ down | Derived: ≈ −6 mg/dL (LDL −3.3, TG −15.7) [S15] — OmniHeart adults | 6 wk | Less VLDL from refined carbohydrate | B | S15 |
| Fasting 16:8 (TRE) `fast16_8` | – none | Derived from TRE vs CR: ≈ −0.7 mg/dL [S48] — Adults with obesity | 52 wk | Weight-dependent only | B | S48 |
| Fasting 24 h `fast24` | ↑ up | Derived: ≈ +15 mg/dL (LDL +23, TG −38, second-hand) [S50, S51] — Healthy adults | 1 d | LDL rise exceeds VLDL fall | C | S50, S51 |
| Fasting 36–48 h `fast36_48` | ↑ up | Total cholesterol g +0.15 with HDL unchanged (≤ 3 d) [S51] — Mixed adults | 2 d | Extrapolated | C | S51 |
| Extended fast > 48 h `fast48plus` | ↕ mixed | Zero-energy 7 d: total cholesterol +1.83 mmol/L with HDL unchanged → ≈ +71 mg/dL [S54]; 14-d modified fast: falls (LDL −28, TG −31 mg/dL) [S53] — Healthy adults | 1 wk | As for LDL | B | S53, S54 |
| Saturated fat `satfat` | ↑ up | Derived from total − HDL coefficients: +0.034 mmol/L (+1.3 mg/dL) per 1 %E replacing carbohydrate [S1] — Controlled feeding trials | 3 wk | LDL-receptor down-regulation | A | S1 |
| Dietary cholesterol / eggs `dietcholesterol` | ↑ up | Derived: +1.9 mg/dL per 100 mg/d (total +2.2, HDL +0.3) [S2] — 17 studies | 3 wk | As for LDL | A | S2 |
| Fibre (soluble) `fibre` | ↓ down | Psyllium ~10 g/d: −0.39 mmol/L (−15 mg/dL) [S19]; soluble fibre −1.7 mg/dL per g (derived, HDL unchanged) [S18] — Adults, ≥ 3 wk | 4 wk | Bile-acid binding | A | S18, S19 |
| Unsaturated fats `unsatfat` | ↓ down | Derived: PUFA −0.028 mmol/L (−1.1 mg/dL) per %E [S1]; nuts: total −4.7, ApoB −3.7 mg/dL per serving [S21] — Controlled feeding trials | 3 wk | LDL-receptor up-regulation | A | S1, S21 |
| Alcohol `alcohol` | ↕ mixed | TG +5.7 mg/dL per 30 g/d [S22] → ≈ +1 mg/dL; heavy intake raises VLDL (J-shaped) [S24] — Adults | 4 wk | More VLDL secretion at high intake | C | S22, S24 |
| Caffeine / coffee `caffeine` | ↑ up | Coffee, derived: ≈ +8 mg/dL (LDL +5.4, TG +12.6) [S26]; filtered ≈ none [S25] — Western adults | 6 wk | As for LDL | B | S25, S26 |
| Creatine `creatine` | – none | Derived: +3.6 mg/dL (ns components) [S35] — 8 RCTs | 8 wk | None expected | C | S35 |
| Whey / protein supplements `wheyprotein` | – none | Derived: ≈ −4.6 mg/dL (ns components) [S34] — 13 RCTs | 8 wk | None expected | B | S34 |
| Large deficit (> 25 %) `deficit_large` | ↓ down | VLCD 8 wk, derived: −0.32 mmol/L (−12 mg/dL) (total −0.54, HDL −0.22), with LDL and ApoB back to baseline by week 8 [S57] — Severely obese adults | 8 wk | Lower VLDL; LDL biphasic | C | S57 |
| Moderate deficit `deficit_moderate` | ↓ down | ADF, derived: ≈ −10 mg/dL (total −11.3, HDL −1.05) [S52]; ≈ −8.7 mg/dL from S56 LDL/TG — 7 RCTs (S52) | 26 wk | Weight-dependent fall in VLDL and LDL | A | S52, S56 |
| Surplus `surplus` | ↕ mixed | SFA surplus raised LDL; unsaturated or sugar surplus did not [S59]; 28-d mixed surplus: LDL and TG unchanged [S58] — Healthy adults | 3 wk | Fat type of the surplus | C | S58, S59 |
| Resistance training load `resistance_load` | ↓ down | −8.7 mg/dL (29 RCTs) [S62] — 1329 adults | 12 wk | Unclear | A | S62 |
| Aerobic training load `aerobic_load` | ↓ down | Derived from all exercise: ≈ −8 mg/dL (total −5.9, HDL +2.1) [S61] — > 200 studies | 12 wk | Lipoprotein lipase activity | B | S61 |
| Sleep debt `sleep_debt` | – none | No association with incident dyslipidaemia [S63] — 30 033 adults | 4 wk | None established | C | S63 |
| Weight loss itself `weight_loss` | ↓ down | Derived: ≈ −8.7 mg/dL (LDL −0.20, TG −0.13 mmol/L) [S56] — 83 RCTs | 26 wk | Weight-dependent | A | S56 |
| Supplement: omega-3 EPA+DHA `supp:omega3_epa_dha` | ↓ down | Approximately linear fall, most evident above 2 g/d in hyperlipidaemia [S32]; "modestly decreased" at 4 g/d [S31] — 90 RCTs | 8 wk | Lower hepatic VLDL secretion | A | S31, S32 |
| Supplement: psyllium (isabgol) `supp:psyllium` | ↓ down | −0.39 mmol/L (−15 mg/dL) at ~10 g/d [S19] — 28 trials | 4 wk | Bile-acid binding | A | S19 |
| Supplement: plant (soy) protein `supp:plant_protein` | ↓ down | Total cholesterol −6.4 mg/dL at 25 g/d soy protein (HDL not given; derived) [S33] — 43 trials | 6 wk | As for LDL | B | S33 |
| Supplement: green-tea catechins `supp:green_tea_extract` | ↓ down | Total cholesterol −7.2 mg/dL, HDL ns (derived) [S37] — 14 RCTs | 8 wk | Less cholesterol absorption | B | S37 |
| Supplement: Garcinia / HCA `supp:garcinia` | ↓ down | Derived: ≈ −9.7 mg/dL (total −6.8, HDL +3.0) [S41] — 14 small RCTs | 8 wk | Unclear | C | S41 |
| Supplement: vitamin D3 `supp:vitamin_d3` | ↓ down | Total cholesterol SMD −0.17 (small) [S42] — 41 RCTs | 12 wk | Unclear | B | S42 |
| Supplement: magnesium `supp:magnesium` | – none | Total cholesterol +0.03 mmol/L (ns) [S43] — Adults | 12 wk | None expected | A | S43 |

### What it constrains in the plan
Non-HDL rules apply **only when LDL is absent, or when TG ≥ 200 mg/dL makes a calculated LDL unreliable**. This stops the same cap being fired twice from LDL and non-HDL.

| Id | When | Kind / severity | Acts on | Message (≤ 200 chars) | Grade | Sources | Index id |
|---|---|---|---|---|---|---|---|
| W-L-NHDL-1 | nonhdl >= 160 mg/dL | cap / caution | `satfat` = 10 | Saturated fat is kept under 10 % of energy because your non-HDL cholesterol was {value} mg/dL on {date}. | A | S1, S66 | W-L05 |
| W-L-NHDL-2 | nonhdl >= 160 mg/dL | prefer / info | `fibre` = 10 | More soluble fibre (oats, dal, isabgol) because your non-HDL cholesterol was {value} mg/dL on {date}; ~10 g psyllium lowers it by ~15 mg/dL. | A | S19 | — |
| W-L-NHDL-3 | nonhdl >= 220 mg/dL | clinician / danger | `clinicianCard` | Your non-HDL cholesterol was {value} mg/dL on {date}. This is very high; please see a clinician. The plan continues with cholesterol cautions on. | D | S70, S80 | W-L11 |

### Clinician-only thresholds
| Threshold | Message | Source |
|---|---|---|
| >= 220 mg/dL | Non-HDL at or above 220 mg/dL (LDL 190 + 30) when LDL is not reported. Please see a clinician. Derived threshold. | S70 |

### Retest interval
Same as LDL (8 weeks after a large composition change).

### Indian-population notes
- Indian reports seldom print non-HDL. Compute it from the total cholesterol and HDL on the page.
- CSI goals: < 130 mg/dL at low or moderate risk, < 100 at high risk, < 85 at very high risk [S66].
- The editorial accompanying the CSI guideline notes that LAI treats non-HDL as a co-primary target [S67].

---

## 4. Triglycerides (TG)

### Physiology and what it reflects
Fasting TG is mostly VLDL-TG from the liver. Its main drivers are:
- de-novo lipogenesis from carbohydrate and sugar,
- liver fat,
- alcohol, which raises VLDL secretion and impairs lipolysis [S24],
- the energy surplus.

Clearance is through lipoprotein lipase, which exercise raises.

TG rises after meals: a non-fasting TG reads about 26 mg/dL higher [S74].

It is the lipid that the plan's own levers move most, and quickest (days to weeks): carbohydrate restriction, weight loss, exercise and omega-3.

Very high TG (≥ 500, and especially ≥ 1000 mg/dL) carries a risk of acute pancreatitis and needs medical therapy [S72, S79].

### Units and conversions
mg/dL = mmol/L × 88.57 (inverse of the CDC multiplier 0.01129) [S75].

### Reference ranges and targets
| Region / body | Low | High | Target | Note | Source |
|---|---|---|---|---|---|
| US/India lab print | — | 150 | — | NCEP: < 150 normal, 150–199 borderline high, 200–499 high, ≥ 500 very high (mg/dL). | S73 |
| Endocrine Society | — | 150 | — | Mild 150–199, moderate 200–999, severe 1000–1999, very severe ≥ 2000 mg/dL (categories via S73). | S72 |
| India | — | 150 | — | CSI 2023: < 150 desirable; drug therapy considered for fasting TG > 500. | S66 |
| Diabetes (ADA) | — | 500 | — | ADA 2026: TG ≥ 500 needs medical therapy (pancreatitis risk). | S79 |
| Non-fasting flag | — | 175 | — | EAS/EFLM: non-fasting ≥ 2 mmol/L (≈ 175 mg/dL) flagged; non-fasting TG reads ≈ 26 mg/dL higher. | S74 |

### How each lever moves it
| Lever | Dir. | Effect size (units, population) | Time course | Mechanism (one line) | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto (≤ 50 g/d) `vlc` | ↓ down | −0.18 mmol/L (−16 mg/dL) vs low-fat at ≥ 12 mo [S5]; −0.26 mmol/L (−23 mg/dL) [S6]; −26 mg/dL in a survey [S9] — Overweight/obese RCT adults | 2 wk | Less carbohydrate → less hepatic de-novo lipogenesis and VLDL-TG output | A | S5, S6, S9 |
| Moderate low-carb (≈ 20–45 %E) `lowcarb` | ↓ down | −0.10 mmol/L (−8.9 mg/dL) vs low-fat [S12]; −14 mg/dL vs low-fat [S14] — Overweight/obese adults | 4 wk | As above, smaller | A | S12, S14 |
| High protein (≥ 1.6 g/kg) `highprotein` | ↓ down | −15.7 mg/dL (protein 25 %E vs carbohydrate) [S15]; −0.23 mmol/L (−20 mg/dL) in energy-restricted trials [S16] — Adults (6–12 wk) | 6 wk | Less carbohydrate-driven VLDL | A | S15, S16, S17 |
| Fasting 16:8 (TRE) `fast16_8` | ↓ down | TRE vs regular diet: −11.6 mg/dL (19 trials) [S47]; no extra fall vs equal CR (−5.9, ns) [S48] — Overweight/obese adults | 8 wk | Through weight loss and a longer post-absorptive period | A | S47, S48 |
| Fasting 24 h `fast24` | ↓ down | 132 → 94 mg/dL; still lower at 48 h (figures second-hand from S51; direction in abstract S50) — Healthy adults, crossover | 1 d | No meal-derived chylomicrons; lower VLDL output | B | S50, S51 |
| Fasting 36–48 h `fast36_48` | ↓ down | Pooled fasts ≤ 3 d: g −0.34 (ns); estimated turning point ≈ 2.5 d [S51] — Mixed adults | 2 d | As for 24 h | C | S51 |
| Extended fast > 48 h `fast48plus` | ↕ mixed | Pooled fasts > 3 d: g +0.19 (ns) [S51]; 7-d zero-energy: unchanged [S54]; 14-d modified fast: −0.35 mmol/L (−31 mg/dL) [S53] — Mixed adults | 1 wk | Adipose fatty acids re-packaged as VLDL by the liver during long fasts | C | S51, S53, S54 |
| Saturated fat `satfat` | ↓ down | −0.012 mmol/L (−1.1 mg/dL) per 1 %E replacing carbohydrate [S1]; cutting SFA 15 → 9 %E (carbohydrate up) raised TG ≈ 9 % [S27] — Controlled feeding trials | 3 wk | Effect is from the carbohydrate it displaces, not the SFA | A | S1, S27 |
| Dietary cholesterol / eggs `dietcholesterol` | – none | TG not reported as changing in the opened analyses [S2, S3] — Adults | 3 wk | No pathway expected | D | S2, S3 |
| Fibre (soluble) `fibre` | – none | TG unchanged with soluble fibre [S18] and oat β-glucan [S20] — Adults | 4 wk | No pathway | A | S18, S20 |
| Unsaturated fats `unsatfat` | ↓ down | Per 1 %E replacing carbohydrate: MUFA −0.015, PUFA −0.021 mmol/L (−1.3 / −1.9 mg/dL) [S1]; nuts −2.2 mg/dL per serving [S21] — Controlled feeding trials | 3 wk | Displaces carbohydrate; PUFA lowers VLDL output | A | S1, S21 |
| Alcohol `alcohol` | ↑ up | +5.7 mg/dL per 30 g/d (2.5–8.9) [S22]; no effect in another analysis [S23]; J-shaped, worse with obesity and in hypertriglyceridaemia [S24] — Adults | 2 wk | Ethanol raises VLDL secretion and impairs lipolysis | B | S22, S23, S24 |
| Caffeine / coffee `caffeine` | ↕ mixed | Coffee: +12.6 mg/dL, larger for unfiltered [S26]; caffeine alone: no change [S36] — Western adults | 6 wk | Coffee oils (unfiltered brew) | B | S26, S36 |
| Creatine `creatine` | – none | +7.95 mg/dL (−13.7 to 29.6, ns) [S35] — 8 RCTs | 8 wk | None expected | C | S35 |
| Whey / protein supplements `wheyprotein` | ↓ down | −0.11 mmol/L (−9.7 mg/dL, borderline); absent in leaner people and at low dose [S34] — 13 RCTs | 8 wk | Displaces carbohydrate (assumed) | B | S34 |
| Large deficit (> 25 %) `deficit_large` | ↓ down | VLCD 8 wk: 1.46 → 1.06 mmol/L (−35 mg/dL) [S57] — Severely obese adults | 4 wk | Less substrate for VLDL; less liver fat | B | S57 |
| Moderate deficit `deficit_moderate` | ↓ down | −0.13 mmol/L (−11.5 mg/dL) at 6–12 mo [S56]; ADF −11.3 mg/dL [S52] — 83 RCTs; 7 RCTs | 12 wk | Less liver fat and VLDL output | A | S52, S56 |
| Surplus `surplus` | ↕ mixed | TG unchanged with +1000–1250 kcal/d for 3–4 wk [S58, S59]; more sugar raises TG +0.11 mmol/L (+9.7 mg/dL) even at equal energy [S30] — Healthy adults | 3 wk | Depends on how much of the surplus is sugar | B | S30, S58, S59 |
| Resistance training load `resistance_load` | ↓ down | −8.1 mg/dL (29 RCTs) [S62] — 1329 adults | 12 wk | Muscle TG uptake; body composition | A | S62 |
| Aerobic training load `aerobic_load` | ↓ down | All exercise: −8.0 mg/dL (95 % CI −10.5 to −5.6) [S61]; more weekly volume, more benefit [S82] — 8081 adults | 8 wk | Lipoprotein lipase activity up | A | S61, S82 |
| Sleep debt `sleep_debt` | – none | No association with incident dyslipidaemia [S63] — 30 033 adults | 4 wk | None established | C | S63 |
| Weight loss itself `weight_loss` | ↓ down | −0.13 mmol/L (−11.5 mg/dL) [S56]; correlates with kg lost (r = 0.32) [S55] — 83 RCTs; 70 studies | 12 wk | Less liver fat | A | S55, S56 |
| Supplement: omega-3 EPA+DHA `supp:omega3_epa_dha` | ↓ down | 4 g/d: ≥ 30 % fall when TG ≥ 500 mg/dL [S31]; roughly linear dose-response, clearest above 2 g/d [S32] — Adults with hypertriglyceridaemia | 4 wk | EPA/DHA lower hepatic VLDL-TG secretion and raise clearance | A | S31, S32 |
| Supplement: psyllium (isabgol) `supp:psyllium` | – none | TG unchanged with soluble fibre [S18] — Adults | 4 wk | No pathway | B | S18 |
| Supplement: CLA (as weight-loss pill) `supp:cla_chitosan_glucomannan` | – none | CLA: TG WMD +1.76 (ns) [S39] — 56 RCTs | 12 wk | None | B | S39 |
| Supplement: Garcinia / HCA `supp:garcinia` | ↓ down | −24.2 mg/dL (−37.8 to −10.6) [S41] — 14 small RCTs | 8 wk | Unclear; heterogeneous trials | C | S41 |
| Supplement: vitamin D3 `supp:vitamin_d3` | ↓ down | SMD −0.12 (small) [S42] — 41 RCTs | 12 wk | Unclear | B | S42 |
| Supplement: magnesium `supp:magnesium` | – none | −0.10 mmol/L (ns) [S43] — Adults | 12 wk | None expected | A | S43 |

### What it constrains in the plan
| Id | When | Kind / severity | Acts on | Message (≤ 200 chars) | Grade | Sources | Index id |
|---|---|---|---|---|---|---|---|
| W-L-TG-1 | tg >= 150 mg/dL | prefer / info | `lowcarb` | Lower-carb and lower-sugar options rank higher because your triglycerides were {value} mg/dL on {date}; cutting carbohydrate lowers them. | A | S5, S12, S30 | — |
| W-L-TG-2 | tg >= 150 mg/dL | cap / caution | `addedSugarPctE` = 10 | Added sugar is kept under 10 % of energy because your triglycerides were {value} mg/dL on {date}. | A | S30 | — |
| W-L-TG-3 | tg >= 150 mg/dL | warn / caution | `alcohol` | Alcohol raises triglycerides, more so at higher intakes. Your triglycerides were {value} mg/dL on {date}; the plan counts drinks against this. | B | S22, S24 | — |
| W-L-TG-4 | tg >= 200 mg/dL | prefer / info | `supp:omega3_epa_dha` | Omega-3 (fish or algal oil) is offered in the supplement list because your triglycerides were {value} mg/dL on {date}. Doses over 2 g/day: ask a clinician. | A | S31, S32 | — |
| W-L-TG-5 | tg >= 500 mg/dL | cap / danger | `fatPctE` = 30 | Fat is held at or below 30 % of energy and keto is not proposed, because your triglycerides were {value} mg/dL on {date}. You can choose keto after seeing a clinician. | C | S72, S79 | W-L04 (block → cap + clinician opt-in) |
| W-L-TG-6 | tg >= 500 mg/dL | cap / danger | `alcohol` = 0 | Alcohol is planned at zero because your triglycerides were {value} mg/dL on {date}; at this level clinicians advise stopping. | B | S24, S79 | W-L04 |
| W-L-TG-7 | tg >= 500 mg/dL | clinician / danger | `clinicianCard` | Your triglycerides were {value} mg/dL on {date}. At 500 or more they need medical treatment because of pancreatitis risk. Please see a clinician. | A | S72, S79 | W-L11 |
| W-L-TG-8 | tg >= 175 mg/dL and fasting == false | reask / info | `fasting` | Your triglycerides ({value} mg/dL, {date}) were measured after eating, which adds about 26 mg/dL. Consider a fasting retest before the plan relies on it. | B | S74 | — |
| W-L-TG-9 | tg >= 400 mg/dL | reask / info | `ldlMethod` | With triglycerides at {value} mg/dL ({date}), a calculated LDL is not valid. Vitals uses non-HDL or ApoB; a direct LDL, if your report has one, is better. | A | S75, S81 | — |

The fat cap of 30 %E at TG ≥ 500 is **grade C**. The index's stricter "fat < 20 g/d for severe HTG" came from an NHS leaflet and a guidelinecentral summary, which this job did not reopen. The cap is a planner ceiling and the clinician sets the real prescription.

### Clinician-only thresholds
| Threshold | Message | Source |
|---|---|---|
| >= 500 mg/dL | Triglycerides at or above 500 mg/dL need medical treatment because of pancreatitis risk. Please see a clinician before changing your diet. | S79 |
| >= 1000 mg/dL | Triglycerides at or above 1000 mg/dL are severe. Please contact a clinician soon. | S72 |

### Retest interval
6 weeks after a change in carbohydrate, alcohol or energy balance. TG responds within days to weeks [S5, S50]. Draw fasting (10–12 h) when the value will drive rules (W-L-TG-8). A fasting draw is also needed for a valid calculated LDL.

### Indian-population notes
- High TG (≥ 150 mg/dL) was found in 29.5 % of adults in ICMR-INDIAB phase 1 [S76].
- The usual Indian "high-TG, low-HDL" pattern on refined-carbohydrate diets is the profile that the plan's carbohydrate-quality and weight-loss levers help most.
- Reports print NCEP bands (< 150 / 150–199 / 200–499 / ≥ 500).

---

## 5. Apolipoprotein B (ApoB)

### Physiology and what it reflects
Every VLDL, IDL, LDL and Lp(a) particle carries exactly one ApoB, so ApoB is a direct count of atherogenic particles [S45].

Mendelian randomisation shows that TG-lowering and LDL-lowering variants cut CHD risk by the same amount per unit of ApoB change. After adjusting for ApoB, TG and LDL-C add nothing [S44]. ApoB is therefore the preferred lipid outcome when entered (index §1.1), and the dossier ranks it ahead of LDL for display (W-L-APOB-3).

SFA raises LDL-C (cholesterol per particle) more than it raises particle number. ApoB per-%E coefficients were **not** in the opened Mensink regression [S1], so most lever rows below are inferred from LDL (grade C/D).

### Units and conversions
mg/dL = g/L × 100. Indian reports print mg/dL, usually in an "Apolipoprotein ratio" panel with Apo A1 and the ApoB/A1 ratio (index §4).

### Reference ranges and targets
| Region / body | Low | High | Target | Note | Source |
|---|---|---|---|---|---|
| Non-fasting flag | — | 100 | — | EAS/EFLM: ApoB ≥ 1.0 g/L (100 mg/dL) flagged. | S74 |
| India | — | — | — | CSI 2023: no universal ApoB target stated. | S66 |
| Europe | — | — | — | ESC/EAS 2019 ApoB goals (< 65 / < 80 / < 100 mg/dL by risk, as quoted in the index) NOT confirmed in an opened page. | S70 |

### How each lever moves it
| Lever | Dir. | Effect size (units, population) | Time course | Mechanism (one line) | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto (≤ 50 g/d) `vlc` | ↑ up | Rose (p < 0.001) with LDL +1.82 mmol/L in lean women, 4 wk [S7]; rose in normal-weight adults, 3 wk [S8]; median 178 mg/dL in 100 people with keto-induced high LDL [S10]. Mixed-population size not available — Normal-weight young adults | 3 wk | Each LDL particle carries one ApoB; more particles retained when LDL-receptor activity falls | B | S7, S8, S10 |
| Moderate low-carb (≈ 20–45 %E) `lowcarb` | – none | LDL particle number did not differ between 20 %, 40 % and 60 % carbohydrate diets over 20 wk [S11] — 164 adults after weight loss | 20 wk | Weight-stable; SFA rise offset by lower VLDL | B | S11 |
| High protein (≥ 1.6 g/kg) `highprotein` | ↓ down | Expected to follow non-HDL (≈ −6 mg/dL non-HDL) [S15]; no direct ApoB figure opened — OmniHeart adults | 6 wk | Fewer VLDL particles | C | S15 |
| Fasting 16:8 (TRE) `fast16_8` | – none | No ApoB data opened; LDL and TG do not change beyond CR [S48] — Adults with obesity | 52 wk | Mechanistic expectation: follows weight loss only | D | S48 |
| Fasting 24 h `fast24` | ↑ up | No ApoB data opened; LDL rises after 24 h [S50, S51] — Healthy adults | 1 d | Mechanistic expectation: follows LDL | D | S50, S51 |
| Fasting 36–48 h `fast36_48` | ↑ up | No ApoB data opened; LDL g +0.32 for fasts ≤ 3 d [S51] — Mixed adults | 2 d | Mechanistic expectation: follows LDL | D | S51 |
| Extended fast > 48 h `fast48plus` | ↕ mixed | 7-d zero-energy fast: 0.84 → 1.37 g/L (+65 %) [S54]; 14-d 250 kcal/d fast: unchanged [S53] — Healthy adults | 1 wk | Fewer particles cleared during true fasting | B | S53, S54 |
| Saturated fat `satfat` | ↑ up | No ApoB coefficient in the opened regression; LDL +1.4 mg/dL per %E [S1]. Risk tracks ApoB, not the diet that produced it [S44] — Controlled feeding trials | 3 wk | LDL-receptor down-regulation retains particles; SFA raises LDL-C more than particle count (expected smaller % change) | B | S1, S44 |
| Dietary cholesterol / eggs `dietcholesterol` | ↑ up | No ApoB figure opened; LDL +1.9–4.5 mg/dL per 100 mg/d [S3] — Adults | 3 wk | Mechanistic expectation: follows LDL, smaller | C | S3 |
| Fibre (soluble) `fibre` | ↓ down | Psyllium ~10 g/d: −0.05 g/L (−5 mg/dL) [S19] — 28 trials | 4 wk | Bile-acid binding raises LDL-receptor activity | A | S19 |
| Unsaturated fats `unsatfat` | ↓ down | Nuts: −3.7 mg/dL per daily serving [S21] — 61 trials | 3 wk | LDL-receptor up-regulation | A | S21 |
| Alcohol `alcohol` | – none | No ApoB data in the opened analyses (ApoA-I rose) [S22, S23] — Adults | 4 wk | Mechanistic expectation: none at moderate intake | D | S22, S23 |
| Caffeine / coffee `caffeine` | ↑ up | No ApoB figure opened; unfiltered coffee raises LDL +5.4 mg/dL [S26] — Western adults | 6 wk | Mechanistic expectation: follows LDL | C | S26 |
| Creatine `creatine` | – none | No ApoB data; lipids unchanged [S35] — 8 RCTs | 8 wk | None expected | D | S35 |
| Whey / protein supplements `wheyprotein` | – none | No ApoB data; LDL unchanged [S34] — 13 RCTs | 8 wk | None expected | D | S34 |
| Large deficit (> 25 %) `deficit_large` | ↕ mixed | VLCD: ApoB fell in weeks 1–3, then returned to baseline by week 8 [S57] — Severely obese adults | 8 wk | Biphasic, as LDL | C | S57 |
| Moderate deficit `deficit_moderate` | ↓ down | No ApoB figure opened; LDL −7.7 and TG −11.5 mg/dL [S56] — 83 RCTs | 26 wk | Mechanistic expectation: fewer VLDL and LDL particles | C | S56 |
| Surplus `surplus` | ↕ mixed | No ApoB figure opened; SFA surplus raised LDL [S59] — Healthy adults | 3 wk | Follows the fat type of the surplus | C | S59 |
| Resistance training load `resistance_load` | ↓ down | No ApoB figure opened; non-HDL −8.7 mg/dL [S62] — 29 RCTs | 12 wk | Mechanistic expectation: follows non-HDL | C | S62 |
| Aerobic training load `aerobic_load` | ↓ down | No ApoB figure opened; high-volume training improved lipoprotein variables more than low volume [S82] — 111 sedentary dyslipidaemic adults | 26 wk | Fewer VLDL particles | C | S82 |
| Sleep debt `sleep_debt` | – none | No ApoB data; no dyslipidaemia association [S63] — Cohorts | 4 wk | None established | D | S63 |
| Weight loss itself `weight_loss` | ↓ down | No ApoB figure opened; LDL and TG fall with loss [S56] — 83 RCTs | 26 wk | Mechanistic expectation: fewer particles | C | S56 |
| Supplement: omega-3 EPA+DHA `supp:omega3_epa_dha` | ↓ down | "Modestly decreased" at 4 g/d in the largest trials (no figure in abstract) [S31] — Adults with hypertriglyceridaemia | 8 wk | Fewer VLDL particles secreted | B | S31 |
| Supplement: psyllium (isabgol) `supp:psyllium` | ↓ down | −0.05 g/L (−5 mg/dL) at ~10 g/d [S19] — 28 trials | 4 wk | Bile-acid binding | A | S19 |
| Supplement: CLA (as weight-loss pill) `supp:cla_chitosan_glucomannan` | – none | ApoB WMD −0.73 (−9.9 to 8.4, ns) [S39] — 56 RCTs | 12 wk | None | B | S39 |

### What it constrains in the plan
When both are entered, ApoB rules replace the LDL rules of the same kind. The engine takes the stricter of the two caps and never stacks them.

| Id | When | Kind / severity | Acts on | Message (≤ 200 chars) | Grade | Sources | Index id |
|---|---|---|---|---|---|---|---|
| W-L-APOB-1 | apob >= 100 mg/dL | cap / caution | `satfat` = 10 | Saturated fat is kept under 10 % of energy because your ApoB was {value} mg/dL on {date}. | B | S1, S44, S74 | W-L05 |
| W-L-APOB-2 | apob >= 100 mg/dL | warn / caution | `vlc` | Very-low-carb raised ApoB with LDL in lean adults within 3–4 weeks. Your ApoB was {value} mg/dL on {date}. Plan a retest after 6–8 weeks. | B | S7, S8 | W-M09 (shown before the plan) |
| W-L-APOB-3 | apob >= 0 mg/dL | prefer / info | `primaryLipidMarker` | ApoB counts the particles that cause plaque, so Vitals tracks your ApoB ({value} mg/dL on {date}) ahead of LDL. | A | S44, S45 | — |
| W-L-APOB-4 | apob >= 100 mg/dL | prefer / info | `fibre` = 10 | More soluble fibre (oats, dal, isabgol) because your ApoB was {value} mg/dL on {date}; ~10 g psyllium lowers ApoB ~5 mg/dL. | A | S19 | — |

### Clinician-only thresholds
None found in an opened guideline. The app uses the clinician thresholds of the other lipid markers.

### Retest interval
Same as LDL (8 weeks after a large composition change). ApoB is not affected by fasting status [S74].

### Indian-population notes
- ApoB is not in the standard Indian lipid profile. It appears in add-on "cardiac risk" panels, and CSI sets no universal ApoB target [S66].
- No Indian prevalence figure for high ApoB was opened.
- Typical method label: immunoturbidimetry.

---

## 6. Lipoprotein(a) [Lp(a)]

### Physiology and what it reflects
Lp(a) is an LDL-like particle with apolipoprotein(a) attached.
- More than 90 % of its concentration is genetically determined, and adult levels are reached by about age 5 [S46].
- In men it is stable through adult life. In women it tends to rise at menopause.
- It rises in nephrotic syndrome (3–5×) and hypothyroidism (falls 5–20 % with treatment). It may fall in liver impairment [S46].
- Statins may raise it slightly. PCSK9 inhibitors lower it 15–30 % [S46].
- It is an independent causal risk factor. A high Lp(a) amplifies the risk carried by LDL/ApoB, which is why it changes the *weight* of LDL cautions, not the diet itself.

The mechanism for diet effects is unknown. The best mechanistic expectation is "almost none", with two documented exceptions, both about 10–20 %:
- low-carbohydrate high-SFA diets lower Lp(a),
- SFA reduction raises it.

**Evidence on diet is thin (grade C/D for most levers).**

### Units and conversions
mg/dL (mass) or nmol/L (particle number). The two are **not interconvertible by a fixed factor**, because apo(a) isoform size varies [S46]. Store values exactly as entered and use unit-specific thresholds:

| Unit | Risk-enhancer threshold |
|---|---|
| mg/dL | > 50 |
| nmol/L | > 125 |

The JSON `factor` is `null`. Indian labs mostly report mg/dL (immunoturbidimetry).

### Reference ranges and targets
| Region / body | Low | High | Target | Note | Source |
|---|---|---|---|---|---|
| EAS 2022 | 30 | 50 | — | < 30 mg/dL (< 75 nmol/L) lower risk; > 50 mg/dL (> 125 nmol/L) higher risk. mg/dL ↔ nmol/L conversion is isoform-dependent and not reliable. | S46 |
| India | — | 50 | — | CSI 2023: desirable < 50 mg/dL; measure at least once in a lifetime; about 1 in 4 South Asians above 50 mg/dL (> 125 nmol/L). | S66 |
| Europe | — | 180 | — | ESC/EAS 2019: > 180 mg/dL carries risk similar to heterozygous familial hypercholesterolaemia. | S70 |
| Europe 2025 | — | 50 | — | ESC/EAS 2025 focused update: > 50 mg/dL (≥ 105 nmol/L) clinically relevant (low confidence: page identity not independently verified). | S71 |

### How each lever moves it
| Lever | Dir. | Effect size (units, population) | Time course | Mechanism (one line) | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto (≤ 50 g/d) `vlc` | ↓ down | −14.7 % (95 % CI −19.5 to −9.5) on 20 % carbohydrate / 21 % SFA for 20 wk [S11]; EAS: a low-carbohydrate high-fat diet may lower Lp(a) 10–15 % [S46]; no change vs control at 3 wk [S8] — 164 adults after weight loss (S11) | 20 wk | Unknown; higher SFA and lower carbohydrate reduce apo(a) production (hypothesis) | B | S8, S11, S46 |
| Moderate low-carb (≈ 20–45 %E) `lowcarb` | – none | −2.1 % (ns) on 40 % carbohydrate / 14 % SFA [S11] — 164 adults | 20 wk | Too small a shift | B | S11 |
| High protein (≥ 1.6 g/kg) `highprotein` | – none | OmniHeart: Lp(a) rose 8–18 % on all three low-SFA diets, including the protein diet [S28] — OmniHeart adults | 6 wk | Rise attributed to the low SFA of all arms, not to protein | C | S28 |
| Fasting 16:8 (TRE) `fast16_8` | – none | No data opened; EAS lists fasting as "none" [S46] — — | 12 wk | Genetically fixed production rate | D | S46 |
| Fasting 24 h `fast24` | – none | No data; EAS lists fasting as "none" [S46] — — | 1 d | Genetically fixed production rate | D | S46 |
| Fasting 36–48 h `fast36_48` | – none | No data; EAS lists fasting as "none" [S46] — — | 2 d | Genetically fixed production rate | D | S46 |
| Extended fast > 48 h `fast48plus` | – none | Unchanged after a 14-d 250 kcal/d fast [S53] — 40 adults | 2 wk | Genetically fixed production rate | B | S53 |
| Saturated fat `satfat` | ↓ down | Replacing SFA raises Lp(a) 9–23 % (DELTA: +15 % for SFA 16 → 5 %E with carbohydrate; +11 % with MUFA) [S27, S28, S46] — Healthy adults, 8-wk feeding periods | 8 wk | Unknown; this is the "Lp(a) paradox" and is never a reason to eat more SFA (LDL and ApoB rise more) | B | S27, S28, S46 |
| Dietary cholesterol / eggs `dietcholesterol` | – none | No data opened; EAS: lifestyle has minimal impact [S46] — — | 8 wk | Mechanistic expectation: none | D | S46 |
| Fibre (soluble) `fibre` | – none | No data opened; EAS: lifestyle has minimal impact [S46] — — | 8 wk | Mechanistic expectation: none | D | S46 |
| Unsaturated fats `unsatfat` | ↑ up | Replacing SFA with MUFA: +11 % (DELTA-2) [S28] — Healthy adults | 8 wk | Mirror of the SFA row | B | S28 |
| Alcohol `alcohol` | – none | No data opened; EAS: lifestyle has minimal impact [S46] — — | 8 wk | Mechanistic expectation: none | D | S46 |
| Caffeine / coffee `caffeine` | – none | No data opened [S46] — — | 8 wk | Mechanistic expectation: none | D | S46 |
| Creatine `creatine` | – none | No data opened [S46] — — | 8 wk | Mechanistic expectation: none | D | S46 |
| Whey / protein supplements `wheyprotein` | – none | No data opened [S46] — — | 8 wk | Mechanistic expectation: none | D | S46 |
| Large deficit (> 25 %) `deficit_large` | ↑ up | Diet-induced ~10 % weight loss: +14.8 nmol/L despite lower LDL; no change after bariatric surgery [S65] — 131 adults with obesity and T2D, 3–4 mo | 14 wk | Unknown; possibly lower SFA during dieting | C | S65 |
| Moderate deficit `deficit_moderate` | ↑ up | As above: +14.8 nmol/L with diet-induced loss [S65] — 131 adults with obesity and T2D | 14 wk | Unknown | C | S65 |
| Surplus `surplus` | – none | No data opened [S46] — — | 4 wk | Mechanistic expectation: none | D | S46 |
| Resistance training load `resistance_load` | – none | EAS: physical activity none or minimal [S46] — — | 12 wk | Genetically fixed | C | S46 |
| Aerobic training load `aerobic_load` | – none | EAS: physical activity none or minimal [S46] — — | 12 wk | Genetically fixed | C | S46 |
| Sleep debt `sleep_debt` | – none | No data opened [S46] — — | 4 wk | Mechanistic expectation: none | D | S46 |
| Weight loss itself `weight_loss` | ↕ mixed | +14.8 nmol/L after diet-induced loss [S65]; −14.7 % on a low-carb maintenance diet after loss [S11] — Adults with obesity | 14 wk | Depends on the diet used, not the kilograms | C | S11, S65 |
| Supplement: L-carnitine `supp:l_carnitine` | ↓ down | Oral: −9.0 mg/dL; overall −8.82 mg/dL (−10.09 to −7.55) [S38] — Pooled RCTs to 2015 | 12 wk | Unknown | B | S38 |
| Supplement: CLA (as weight-loss pill) `supp:cla_chitosan_glucomannan` | ↑ up | CLA > 24 wk: SMD +0.24 (0.01–0.47) [S40] — 21 RCTs | 24 wk | Unknown | C | S40 |

### What it constrains in the plan
| Id | When | Kind / severity | Acts on | Message (≤ 200 chars) | Grade | Sources | Index id |
|---|---|---|---|---|---|---|---|
| W-L-LPA-1 | lpa > 50 mg/dL | warn / caution | `vlc\|satfat` | Your Lp(a) was {value} mg/dL on {date}, which raises the weight of any LDL rise. LDL cautions for keto or high saturated fat are shown before the plan. | B | S46, S66 | W-L05 |
| W-L-LPA-2 | lpa > 125 nmol/L | warn / caution | `vlc\|satfat` | Your Lp(a) was {value} nmol/L on {date}, which raises the weight of any LDL rise. LDL cautions for keto or high saturated fat are shown before the plan. | B | S46, S66 | W-L05 |
| W-L-LPA-3 | lpa > 50 mg/dL | clinician / caution | `clinicianNote` | Lp(a) is mostly inherited and diet barely moves it. Yours was {value} mg/dL on {date}; ask a clinician how it changes your overall heart risk. | A | S46, S66 | — |
| W-L-LPA-4 | lpa > 50 mg/dL | prefer / info | `fibre\|unsatfat` | Diet cannot lower Lp(a) much, so the plan works on LDL instead (fibre, unsaturated fats), because your Lp(a) was {value} mg/dL on {date}. | B | S19, S46 | — |
| W-L-LPA-5 | lpa >= 180 mg/dL | clinician / danger | `clinicianCard` | Your Lp(a) was {value} mg/dL on {date}. At 180 or more the risk is like inherited high cholesterol. Please see a clinician. | A | S70 | W-L11 |

### Clinician-only thresholds
| Threshold | Message | Source |
|---|---|---|
| >= 180 mg/dL | Lp(a) at or above 180 mg/dL carries risk similar to inherited high cholesterol. Please discuss it with a clinician. | S70 |

### Retest interval
Once in a lifetime. EAS says repeat measurement does not improve risk prediction in stable conditions [S46]; CSI says measure at least once [S66].

Exceptions:
- After menopause, a second measurement is reasonable [S71, low confidence].
- With new kidney or thyroid disease, retest.

JSON `retestWeeks: null`.

### Indian-population notes
- About 25 % of South Asians have Lp(a) > 50 mg/dL, against about 20 % of White people [S66, S67, S78].
- UK Biobank medians: South Asian 31 nmol/L, White 19, Chinese 16, Black 75 [S46, S78].
- In INTERHEART, high Lp(a) carried an MI odds ratio of 2.14 in South Asians [S78].
- Indian camp panels increasingly include "LIPOPROTEIN (A) [LP(A)]" in mg/dL.

---

## Simulation hooks (for E20)
- Generate the planner interaction table from `R13-lipids.json → interactions`. A test must assert that every fixed lever exists for every marker, and that every `sources[]` id resolves to the list below. The generator used for this file already checks both.
- `effectSize` is display text. The engine coefficients stay in `research/06` / `constants.ts`. Where this dossier and research/06 disagree (eggs, weight per kg), E20 keeps the engine coefficient and widens the band. It does not silently change the coefficient.
- Golden personas:
  - LDL 165, lean, keto: W-L-LDL-5 and W-L-LDL-6 fire, and keto stays available.
  - TG 620: W-L-TG-5..7 fire, keto is not proposed, and the user can opt in after a clinician.
  - Lp(a) 140 nmol/L with normal LDL: W-L-LPA-2 and the clinician note fire, with no diet cap.
  - Non-fasting TG 190: the re-ask fires.

## Unverified (could not be confirmed in an opened source)
- ESC/EAS 2019 explicit non-HDL (< 85/100/130) and ApoB (< 65/80/100 mg/dL) goals; the 8 ± 4 week recheck wording; Lp(a) > 430 nmol/L.
- The LAI 2023 J Clin Lipidol goal table (paywalled). Only the LAI 2024 JAPI abstract figures are used.
- The ADA 2025 and RSSDI 2022 lipid targets (pages did not load). ADA 2026 is used instead.
- Per-kg LDL and TG slopes for weight loss (Dattilo, Zomer abstracts).
- Horne 2013 24-h fast lipid figures, taken second-hand from S51's table. The abstracts disagree on n (30 vs 16).
- The omega-3 mg/dL dose-response figures (−5.9 mg/dL per g; −42.6 at 2 g/d).
- The coffee diterpene (cafestol) mechanism, which was not re-opened.
- Exogenous ketones, ashwagandha and caffeine-only lipid effects in healthy humans: no usable human data found.
- CLA abstract [S39], which is internally inconsistent on HDL direction.
- The ApoB magnitude in Burén 2021 (abstract gives significance only).

## Sources
All were opened on 2026-10-02. "abs" means the abstract only (PubMed or Europe PMC); "full" means the full text. Some titles are descriptive paraphrases; the DOI, PMID and URL identifiers are exact.

| Id | Source | Identifier |
|---|---|---|
| S1 | Mensink RP. Updated systematic review examining the effect of fatty acids on serum lipids (WHO regression update), FSANZ Supporting Document 1, 2016. full | https://www.foodstandards.gov.au/sites/default/files/publications/Documents/Supporting%20Document%201_Mensink_compiled%2018_July_RM.pdf |
| S2 | Weggemans RM et al. Dietary cholesterol from eggs increases the ratio of total cholesterol to HDL cholesterol in humans: a meta-analysis. Am J Clin Nutr 2001. abs | DOI 10.1093/ajcn/73.5.885; PMID 11333841 |
| S3 | Vincent MJ et al. Meta-regression analysis of the effects of dietary cholesterol intake on LDL and HDL cholesterol. Am J Clin Nutr 2019. abs | DOI 10.1093/ajcn/nqy273; PMID 30596814 |
| S4 | Carson JAS et al. Dietary cholesterol and cardiovascular risk: AHA science advisory. Circulation 2020;141:e39. abs | DOI 10.1161/CIR.0000000000000743; PMID 31838890 |
| S5 | Bueno NB et al. Very-low-carbohydrate ketogenic diet v. low-fat diet for long-term weight loss: meta-analysis. Br J Nutr 2013. abs | DOI 10.1017/S0007114513000548; PMID 23651522 |
| S6 | Mansoor N et al. Effects of low-carbohydrate diets v. low-fat diets on body weight and CV risk factors: meta-analysis. Br J Nutr 2016. abs | DOI 10.1017/S0007114515004699; PMID 26768850 |
| S7 | Burén J et al. A ketogenic LCHF diet increases LDL cholesterol in healthy, young, normal-weight women: randomized controlled feeding trial. Nutrients 2021. abs | DOI 10.3390/nu13030814; PMID 33801247 |
| S8 | Retterstøl K et al. Effect of low carbohydrate high fat diet on LDL cholesterol and gene expression in normal-weight, young adults: RCT. Atherosclerosis 2018. abs | DOI 10.1016/j.atherosclerosis.2018.10.013; PMID 30408717 |
| S9 | Norwitz NG et al. Elevated LDL cholesterol with a carbohydrate-restricted diet: evidence for a "lean mass hyper-responder" phenotype. Curr Dev Nutr 2022. full | DOI 10.1093/cdn/nzab144; PMID 35106434; PMC8796252 |
| S10 | Soto-Mota A et al. Plaque begets plaque, ApoB does not: KETO-CTA longitudinal study. JACC Adv 2025. abs | DOI 10.1016/j.jacadv.2025.101686; PMID 40192608 |
| S11 | Ebbeling CB et al. Effects of a low-carbohydrate diet on insulin-resistant dyslipoproteinemia: randomized controlled feeding trial. Am J Clin Nutr 2022. abs | DOI 10.1093/ajcn/nqab287; PMID 34582545 |
| S12 | Chawla S et al. The effect of low-fat and low-carbohydrate diets on weight loss and lipid levels: systematic review and meta-analysis. Nutrients 2020. abs | DOI 10.3390/nu12123774; PMID 33317019 |
| S13 | Ge L et al. Comparison of dietary macronutrient patterns of 14 popular named dietary programmes: network meta-analysis. BMJ 2020. abs | DOI 10.1136/bmj.m696; PMID 32238384 |
| S14 | Hu T et al. Effects of low-carbohydrate diets versus low-fat diets on metabolic risk factors: meta-analysis. Am J Epidemiol 2012. abs | DOI 10.1093/aje/kws264; PMID 23035144 |
| S15 | Appel LJ et al. Effects of protein, monounsaturated fat, and carbohydrate intake on blood pressure and serum lipids: OmniHeart. JAMA 2005. abs | PMID 16287956 |
| S16 | Wycherley TP et al. Effects of energy-restricted high-protein, low-fat compared with standard-protein, low-fat diets: meta-analysis. Am J Clin Nutr 2012. abs | PMID 23097268 |
| S17 | Santesso N et al. Effects of higher- versus lower-protein diets on health outcomes: systematic review and meta-analysis. Eur J Clin Nutr 2012. abs | PMID 22510792 |
| S18 | Brown L et al. Cholesterol-lowering effects of dietary fiber: a meta-analysis. Am J Clin Nutr 1999. abs | PMID 9925120 |
| S19 | Jovanovski E et al. Effect of psyllium fiber on LDL-C and alternative lipid targets, non-HDL-C and ApoB: meta-analysis. Am J Clin Nutr 2018. abs | DOI 10.1093/ajcn/nqy115; PMID 30239559 |
| S20 | Whitehead A et al. Cholesterol-lowering effects of oat β-glucan: meta-analysis of RCTs. Am J Clin Nutr 2014. abs | PMID 25411276 |
| S21 | Del Gobbo LC et al. Effects of tree nuts on blood lipids, apolipoproteins, and blood pressure: meta-analysis of 61 trials. Am J Clin Nutr 2015. abs | PMID 26561616 |
| S22 | Rimm EB et al. Moderate alcohol intake and lower risk of CHD: meta-analysis of effects on lipids and haemostatic factors. BMJ 1999. abs | PMID 10591709 |
| S23 | Brien SE et al. Effect of alcohol consumption on biological markers associated with risk of CHD: meta-analysis of interventional studies. BMJ 2011. abs | PMID 21343206 |
| S24 | Klop B et al. Alcohol and plasma triglycerides. Curr Opin Lipidol 2013. abs | DOI 10.1097/MOL.0b013e3283606845; PMID 23511381 |
| S25 | Jee SH et al. Coffee consumption and serum lipids: a meta-analysis of randomized controlled clinical trials. Am J Epidemiol 2001;153:353. abs | DOI 10.1093/aje/153.4.353; PMID 11207153 |
| S26 | Cai L et al. The effect of coffee consumption on serum lipids: a meta-analysis of RCTs. Eur J Clin Nutr 2012. abs | DOI 10.1038/ejcn.2012.68; PMID 22713771 |
| S27 | Ginsberg HN et al. Effects of reducing dietary saturated fatty acids on plasma lipids and lipoproteins in healthy subjects: DELTA Study, protocol 1. Arterioscler Thromb Vasc Biol 1998. abs | DOI 10.1161/01.atv.18.3.441; PMID 9514413 |
| S28 | Enkhmaa B, Berglund L. Non-genetic influences on lipoprotein(a) concentrations. Atherosclerosis 2022;349:53. full | DOI 10.1016/j.atherosclerosis.2022.04.006; PMID 35606076; PMC9549811 |
| S29 | Neelakantan N et al. The effect of coconut oil consumption on cardiovascular risk factors: systematic review and meta-analysis. Circulation 2020. abs | PMID 31928080 |
| S30 | Te Morenga LA et al. Dietary sugars and cardiometabolic risk: meta-analyses of RCTs on blood pressure and lipids. Am J Clin Nutr 2014. abs | PMID 24808490 |
| S31 | Skulas-Ray AC et al. Omega-3 fatty acids for the management of hypertriglyceridemia: AHA science advisory. Circulation 2019. abs | DOI 10.1161/CIR.0000000000000709; PMID 31422671 |
| S32 | Wang T et al. Association between omega-3 fatty acid intake and dyslipidemia: continuous dose-response meta-analysis of RCTs. J Am Heart Assoc 2023. abs | DOI 10.1161/JAHA.123.029512; PMID 37264945 |
| S33 | Blanco Mejia S et al. A meta-analysis of 46 studies identified by the FDA demonstrates that soy protein decreases circulating LDL and total cholesterol concentrations in adults. J Nutr 2019. abs | DOI 10.1093/jn/nxz020; PMID 31006811 |
| S34 | Zhang JW et al. Effect of whey protein on blood lipid profiles: a meta-analysis of RCTs. Eur J Clin Nutr 2016. abs | DOI 10.1038/ejcn.2016.39; PMID 27026427 |
| S35 | Gimenez FVM et al. Does creatine affect lipid profile? Systematic review and meta-analysis. Front Nutr 2026. abs | DOI 10.3389/fnut.2026.1787009; PMID 42180567 |
| S36 | Caffeine 400 mg/d vs placebo, 8-wk RCT in 50 patients with cirrhosis. BMC Nutr 2025. abs | DOI 10.1186/s40795-025-01217-9; PMID 41345894 |
| S37 | Zheng XX et al. Green tea intake lowers fasting serum total and LDL cholesterol in adults: meta-analysis of 14 RCTs. Am J Clin Nutr 2011. abs | DOI 10.3945/ajcn.110.010926; PMID 21715508 |
| S38 | Serban MC et al. Impact of L-carnitine on plasma lipoprotein(a) concentrations: meta-analysis. Sci Rep 2016. abs | DOI 10.1038/srep19188; PMID 26754058 |
| S39 | The effects of conjugated linoleic acid supplementation on lipid profile in adults: dose-response meta-analysis. Front Nutr 2022. abs | DOI 10.3389/fnut.2022.953012; PMID 36438733 |
| S40 | Derakhshandeh-Rishehri SM et al. (CLA, CRP and Lp(a) meta-analysis of 21 RCTs). Iran J Med Sci 2019; and Public Health Nutr 2015 (CLA LDL). abs | DOI 10.30476/ijms.2019.44949, PMID 31582860; DOI 10.1017/S1368980014002262, PMID 25379623 |
| S41 | Amini MR et al. The effects of Garcinia cambogia (hydroxycitric acid) on lipid profile: meta-analysis. Phytother Res 2024. abs | DOI 10.1002/ptr.8102; PMID 38151892 |
| S42 | Dibaba DT. Effect of vitamin D supplementation on serum lipid profiles: meta-analysis. Nutr Rev 2019. abs | DOI 10.1093/nutrit/nuz037; PMID 31407792 |
| S43 | Simental-Mendía LE et al. Effect of magnesium supplementation on lipid profile: meta-analysis. Eur J Clin Pharmacol 2017. abs | DOI 10.1007/s00228-017-2212-8; PMID 28180945 |
| S44 | Ference BA et al. Association of triglyceride-lowering LPL variants and LDL-C-lowering LDLR variants with risk of CHD. JAMA 2019. abs | DOI 10.1001/jama.2018.20045; PMID 30694319 |
| S45 | Sniderman AD et al. Apolipoprotein B particles and cardiovascular disease: a narrative review. JAMA Cardiol 2019. abs | DOI 10.1001/jamacardio.2019.3780; PMID 31642874 |
| S46 | Kronenberg F et al. Lipoprotein(a) in atherosclerotic cardiovascular disease and aortic stenosis: EAS consensus statement. Eur Heart J 2022;43:3925. full | DOI 10.1093/eurheartj/ehac361; PMID 36036785; PMC9639807 |
| S47 | Moon S et al. Beneficial effects of time-restricted eating on metabolic diseases: systematic review and meta-analysis. Nutrients 2020. abs | DOI 10.3390/nu12051267; PMID 32365676 |
| S48 | Liu D et al. Calorie restriction with or without time-restricted eating in weight loss. N Engl J Med 2022;386:1495. full (Table 3) | DOI 10.1056/NEJMoa2114833; PMID 35443107 |
| S49 | Sun JC et al. Effects of time-restricted eating plus calorie restriction vs calorie restriction: meta-analysis. Eur J Clin Nutr 2023;77:1014. full | https://pmc.ncbi.nlm.nih.gov/articles/PMC10630127/ |
| S50 | Horne BD et al. Randomized cross-over trial of short-term water-only fasting: metabolic and cardiovascular consequences. Nutr Metab Cardiovasc Dis 2013. abs | DOI 10.1016/j.numecd.2012.09.007; PMID 23220077 |
| S51 | Çamli A et al. Water-only fasting and lipids: meta-analysis and threshold meta-regression. Front Nutr 2026;13:1772246. full | DOI 10.3389/fnut.2026.1772246; PMID 41994097; PMC13079636 |
| S52 | Cui Y et al. Health effects of alternate-day fasting in adults: systematic review and meta-analysis. Front Nutr 2020. full | DOI 10.3389/fnut.2020.586036; PMID 33330587 |
| S53 | Grundler F et al. Long-term fasting improves lipoprotein-associated atherogenic risk in humans. Eur J Nutr 2021. abs | DOI 10.1007/s00394-021-02578-0; PMID 33963431 |
| S54 | Sävendahl L, Underwood LE. Fasting increases serum total cholesterol, LDL cholesterol and apolipoprotein B in healthy, nonobese humans. J Nutr 1999;129:2005. abs | DOI 10.1093/jn/129.11.2005; PMID 10539776 |
| S55 | Dattilo AM, Kris-Etherton PM. Effects of weight reduction on blood lipids and lipoproteins: a meta-analysis. Am J Clin Nutr 1992. abs | DOI 10.1093/ajcn/56.2.320; PMID 1386186 |
| S56 | Zomer E et al. Interventions that cause weight loss and the impact on cardiovascular risk factors: meta-analysis. Obes Rev 2016. abs | DOI 10.1111/obr.12433; PMID 27324830 |
| S57 | Parenti M et al. Lipid, lipoprotein and apolipoprotein assessment during an 8-wk very-low-calorie diet. Am J Clin Nutr 1992;56:268S. abs | DOI 10.1093/ajcn/56.1.268s; PMID 1615898 |
| S58 | Heilbronn LK et al. Overfeeding (+1250 kcal/d, 28 d) in healthy adults. Obesity 2013. abs | DOI 10.1002/oby.20508; PMID 23640727 |
| S59 | Ruuth M et al. Overfeeding saturated fat, unsaturated fat or sugar for 3 weeks and LDL. Arterioscler Thromb Vasc Biol 2021. full | DOI 10.1161/atvbaha.120.315766; PMID 34470478; PMC8545249 |
| S60 | Kodama S et al. Effect of aerobic exercise training on serum levels of HDL cholesterol: meta-analysis. Arch Intern Med 2007. abs | DOI 10.1001/archinte.167.10.999; PMID 17533202 |
| S61 | Smart NA et al. Exercise training and blood lipids: meta-analysis. Sports Med 2025;55:67. full | DOI 10.1007/s40279-024-02115-z; PMID 39331324; PMC11787149 |
| S62 | Kelley GA, Kelley KS. Impact of progressive resistance training on lipids and lipoproteins in adults: meta-analysis of RCTs. Prev Med 2009. abs | DOI 10.1016/j.ypmed.2008.10.010; PMID 19013187 |
| S63 | Kruisbrink M et al. Association of sleep duration and quality with blood lipids: systematic review and meta-analysis of prospective studies. BMJ Open 2017. abs | DOI 10.1136/bmjopen-2017-018585; PMID 29247105 |
| S64 | Aho V et al. Prolonged sleep restriction induces changes in pathways involved in cholesterol metabolism and inflammatory responses. Sci Rep 2016. abs | DOI 10.1038/srep24828; PMID 27102866 |
| S65 | Berk KA et al. Effect of diet-induced weight loss on lipoprotein(a) levels in obese individuals with and without type 2 diabetes. Diabetologia 2017. abs | DOI 10.1007/s00125-017-4246-y; PMID 28386638 |
| S66 | Sawhney JPS et al. Cardiological Society of India dyslipidaemia guidelines 2023: executive summary. Indian Heart J. full | DOI 10.1016/j.ihj.2023.11.271; https://pmc.ncbi.nlm.nih.gov/articles/PMC11019331/ |
| S67 | Editorial: Indian dyslipidaemia guidelines: need of the hour. Indian Heart J 2024. full | https://pmc.ncbi.nlm.nih.gov/articles/PMC11019334/ |
| S68 | Lipid Association of India expert opinion: Does adopting Western LDL-C targets expose Indians to higher risk? J Assoc Physicians India 2024. abs | DOI 10.59556/japi.72.0692; PMID 39390866 |
| S69 | Lipid Association of India consensus on diabetic dyslipidaemia. J Clin Lipidol 2022/23. abs | DOI 10.1016/j.jacl.2022.11.002; PMID 36577628 |
| S70 | Mach F et al. 2019 ESC/EAS guidelines for the management of dyslipidaemias. Eur Heart J 2020;41:111. partial full text | DOI 10.1093/eurheartj/ehz455; https://academic.oup.com/eurheartj/article/41/1/111/5556353 |
| S71 | 2025 focused update of the 2019 ESC/EAS dyslipidaemia guidelines. Eur Heart J 2025. abs + article page (identity low-confidence) | DOI 10.1093/eurheartj/ehaf190; PMID 40878289 |
| S72 | Berglund L et al. Evaluation and treatment of hypertriglyceridemia: Endocrine Society clinical practice guideline. J Clin Endocrinol Metab 2012;97:2969. abs | DOI 10.1210/jc.2011-3213; PMID 22962670 |
| S73 | AAFP practice guideline summary: Endocrine Society hypertriglyceridemia guideline (and NCEP categories). Am Fam Physician 2013. full | https://www.aafp.org/pubs/afp/issues/2013/0715/p142.html |
| S74 | Nordestgaard BG et al. Fasting is not routinely required for determination of a lipid profile: EAS/EFLM joint consensus. Eur Heart J 2016;37:1944. abs | DOI 10.1093/eurheartj/ehw152; PMID 27122601 |
| S75 | CDC NCHS. NHANES 2017–March 2020 P_TRIGLY documentation (conversion factors; Friedewald limit). full | https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/P_TRIGLY.htm |
| S76 | Joshi SR et al. Prevalence of dyslipidemia in urban and rural India: the ICMR-INDIAB study. PLoS One 2014;9:e96808. full | DOI 10.1371/journal.pone.0096808; PMID 24817067 |
| S77 | Anjana RM et al. Metabolic non-communicable disease health report of India: ICMR-INDIAB national cross-sectional study (ICMR-INDIAB-17). Lancet Diabetes Endocrinol 2023. abs | DOI 10.1016/S2213-8587(23)00119-5; PMID 37301218 |
| S78 | Patel D et al. Lipoprotein(a) in South Asians (review). J Am Heart Assoc 2025. full | DOI 10.1161/JAHA.124.040361; PMID 40654252; PMC13055799 |
| S79 | ADA. 10. Cardiovascular disease and risk management: Standards of Care in Diabetes—2026. Diabetes Care 2026. full | DOI 10.2337/dc26-s010; PMID 41358899; PMC12690187 |
| S80 | NCEP ATP III Executive Summary. JAMA 2001;285:2486. full | DOI 10.1001/jama.285.19.2486; PMID 11368702; https://www.nhlbi.nih.gov/files/docs/guidelines/atp3xsum.pdf |
| S81 | Sampson M et al. A new equation for calculation of LDL-C in patients with normolipidemia and/or hypertriglyceridemia. JAMA Cardiol 2020. full | https://jamanetwork.com/journals/jamacardiology/fullarticle/2761953 |
| S82 | Kraus WE et al. Effects of the amount and intensity of exercise on plasma lipoproteins (STRRIDE). N Engl J Med 2002;347:1483. abs | DOI 10.1056/NEJMoa020194; PMID 12421890 |
| S83 | Exogenous ketone supplementation in rats, 28 d (lipid biomarkers). Nutr Metab 2016. abs | DOI 10.1186/s12986-016-0069-y; PMID 26855664 |
| S84 | Magnesium supplementation and lipid profile: dose-response meta-analysis. Nutr J 2025. abs | DOI 10.1186/s12937-025-01085-w; PMID 39905454 |
| S85 | Replacing ghee with rapeseed oil in NAFLD, 12-wk trial, 110 patients (Iran). Br J Nutr 2024. abs | DOI 10.1017/S0007114524000564; PMID 38501177 |
