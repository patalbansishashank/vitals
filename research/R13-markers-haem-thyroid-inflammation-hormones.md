# R13d · Marker dossiers: haemoglobin, ferritin, B12, vitamin D, hs-CRP, TSH, free T3, testosterone, cortisol

Date: 2026-10-02 · Plan item 9 (blood markers) · Index: `plan/02-next/research-blood-markers.md` · Evidence policy: plan/01 R5 (mechanism decides use; grade sets band width and wording, never gates) · Companion data: `R13-haem-thyroid-inflammation-hormones.json` (generated from the same data as the tables below; 101 interaction rows, 53 rules).

**How the sources were handled.** Every numbered source was opened this session (abstract at minimum, full text where marked: S1, S11, S66, S79, S84, S97). Numbers come from abstracts unless stated. Where a common figure could not be traced to an opened source, the text says "not sourced this session" and the claim is graded D or left out of the JSON. Source ids are global (S1–S108) so the JSON can cite them; each marker section lists the ones it uses.

**Depth.** Hb, ferritin, B12, 25(OH)D, hs-CRP, TSH and testosterone are covered in depth. Free T3 and cortisol are shorter: free T3 is optional and mainly a REDs signal; cortisol is shown only.

## Summary and decisions
1. **Haemoglobin.** WHO cut-offs, 13.0 g/dL for men and 12.0 g/dL for women (S1, S2). Below the cut-off the plan does three things:
   - Caps the deficit 5 points lower.
   - Keeps fasts to 24 h or less.
   - Asks for ferritin and B12 (W-L-HB-1..3).

   Below 8 g/dL the user is told to see a clinician and the plan holds at maintenance. Endurance training lowers Hb by diluting the blood (S6, S7), so the warning says this.
2. **Ferritin.** Iron deficiency is below 15 µg/L, or below 70 µg/L when inflammation is present (WHO 2020, S11). Training plans use 30 µg/L (S12, S13).
   - Ferritin below 30 does three things: it keeps the deficit moderate for endurance plans, times tea and coffee away from meals (S14, S15), and pairs vitamin C with plant iron (S23).
   - Iron is offered as an option, with clinician advice (S19).
   - If CRP is above 5, a ferritin below 70 is re-asked.
   - Above 200 (men) or 150 (women) with a normal CRP, the app stops suggesting iron and adds a clinician note.
3. **B12.** Below 200 pg/mL, B12 is suggested for everyone, not only vegetarians. Metformin and PPIs also lower B12 (S25–S27).
   - At 200–300 pg/mL the app asks about medicines and suggests an MMA test.
   - Below 135 pg/mL (100 pmol/L) the user is told to see a clinician.
4. **25(OH)D.** The app acts only below 12 ng/mL, by suggesting D3 (S36, S38). It does not push routine retests (S34).
   - Above 100 ng/mL it stops suggesting vitamin D and adds a clinician note.
   - Weight loss raises 25(OH)D by itself (S45).
   - The Indian 40–60 ng/mL consensus (S39) is not adopted.
5. **hs-CRP.** Above 10 mg/L the result is treated as illness:
   - Fasts are capped at 24 h for 4 weeks.
   - The user is asked to repeat the test in 2 weeks (S48).
   - Two values above 10 mean a clinician.

   Above 3 mg/L, weight loss, fibre and training rank higher (S53, S54, S58). A keto diet does not lower CRP apart from weight loss (S57).
6. **TSH.** Outside the lab range, the app shows a clinician note and the plan continues. Above 10 µIU/mL in an untreated person, fasts are capped at 24 h until a clinician has seen it.
   - Levothyroxine users get timing rules for coffee, calcium and iron (S66, S77).
   - Ashwagandha users who have a thyroid condition get a warning (S78). Biotin users are reminded to stop it before a thyroid test (S79).
7. **Free T3.** It falls within 1–3 days of fasting or very-low-carb eating. This is expected (S70, S71, S73). A low value only means something when combined:
   - With low energy availability: suggest a diet break (S75).
   - With low testosterone: cap the deficit at moderate.
8. **Testosterone (men).** A single value below 264 ng/dL prompts a repeat morning test (S80–S82). Two low values mean a clinician. When it is low:
   - With a large deficit: the deficit is capped at moderate (S88, S89).
   - With short sleep: sleep is shown as the first lever (S92).
   - Protein is kept at or below 3.4 g/kg (S85).
   - With overweight: weight loss is preferred (S87).
9. **Cortisol.** Shown only. Below 5 µg/dL the user is told to see a clinician and fasts are capped at 12 h (S97).

## Where this differs from the index (research-blood-markers.md)
| Index statement | This dossier | Why |
|---|---|---|
| §1.9 / §3: high protein lowers testosterone ("↓ M") | No effect at 1.25–3.4 g/kg/day; the −5.23 nmol/L applies to ≥ 35 %E protein low-carb diets | Whittaker 2023 (S85); Whittaker 2022 (S84). The app's 1.6–2.2 g/kg target is below the effect zone |
| §1.9: cortisol rises in the first ~3 weeks of low-carb | Confirmed (SMD +0.41) | S84 |
| §6 L3: CALERIE T3 drop 10–20 % | Still unverified. The CALERIE abstract opened (Heilbronn 2006) does not report T3. Use Loucks (T3 −16 %, fT3 −9 % below EA 25 kcal/kg LBM) and the fasting data instead | S75, S70, S71 |
| §3: sleep debt and TSH (implied rise) | Partial sleep restriction for 14 days *lowered* TSH slightly | S74 |
| §1.6: B12 suggestion for vegetarians and eggetarians only | B12 is suggested to anyone below 200 pg/mL; the food preference applies to vegetarian patterns | Metformin and PPI users are also low (S25–S27) |
| §1.6: ferritin < 30 caps the deficit for endurance athletes | Same, made explicit as ≤ 20 % deficit while aerobic load is moderate or high | Practice threshold (S12); grade C |
| §1.8: ferritin with CRP > 5 is "falsely normal" | Kept, and WHO's < 70 µg/L cut-off under inflammation is added. The CRP > 5 trigger itself is grade C | WHO 2020 (S11) |
| §5: Hb rule "CLIP deficit −5 pts; capFast(24)" | Same. The grade is D for the size of the cap: no trial tests deficits in anaemic dieters | Mechanism (oxygen delivery) |
| §2: "TSH grossly abnormal" is clinician-only | Clinician-only above 10 µIU/mL or below the lab range. Fasts are capped at 24 h only when TSH > 10 and untreated | S64 |
| Rule ids W-L07, W-L08, W-L10, W-L11, W-L12 | Split into per-marker ids: W-L-HB-*, W-L-FERRITIN-*, W-L-CRP-*, W-L-TSH-*, W-L-FT3-*, W-L-TESTOSTERONE-* | Schema of this task. Mapping: W-L07 ⇢ HB-1/2, W-L08 ⇢ FERRITIN-1..4, W-L10 ⇢ CRP-1, W-L11 ⇢ HB-5/TSH-1/CORTISOL-1, W-L12 ⇢ FT3-1/3 and TESTOSTERONE-3 |

## Conventions
- **Lever ids** are those fixed in the task, plus `supp:<catalogue id>` from `src/content/catalogues/supplements.ts`. Supplement rows appear only where the catalogue item has a known pathway to the marker.
- **Grades** follow R5 / RESEARCH_PROTOCOL:
  - A: meta-analysis, or several concordant controlled trials.
  - B: a few RCTs, or consistent human data.
  - C: limited or indirect human data.
  - D: mechanism, animal data or expert opinion.

  Grades never gate a rule; they set wording and band width.
- **Units:** SI = conventional × factor.
- **Rule `when`.**
  - Extended with an optional `also` (a second predicate on another marker, on a profile/plan field, or `{repeat: true}`).
  - Symbolic values: `whoCutoff`, `labLow`, `labHigh`, `labRange`.
  - A3 should adopt or replace this extension when it fixes the markers contract.
- **Severity:** info < caution < see-clinician < stop-and-see.
- **Fasting cap targets.** Some caps target `fasting` (all tiers above the value in hours) rather than a single fast lever.

## Haemoglobin (Hb) (`hb`)

### Physiology and what it reflects
Hb is the oxygen-carrying protein of red cells. It sets oxygen delivery and therefore aerobic capacity and how hard endurance blocks feel. It falls with iron, B12 or folate deficiency, blood loss, chronic disease and haemoglobinopathy (thalassaemia trait is common in India). It also falls *without* any loss of red cells when plasma volume expands, as it does with endurance training ("sports anaemia", S6, S7). Red cells live about 120 days, so diet-driven change shows over 4–12 weeks; a response to iron shows within 2–4 weeks (S1).

### Units and conversions
Indian labs print g/dL (also "gm/dL"). SI is g/L: g/dL × 10. Some European labs use mmol/L (g/dL × 0.6206; standard molar conversion, not checked against a source this session). JSON: `si: g/L`, `conventional: g/dL`, `factor: 10`.

### Reference ranges and targets
| Population | Cut-off (anaemia below) | Source |
|---|---|---|
| Men ≥ 15 y | 13.0 g/dL | WHO via BSG 2021 (S1); WHO 2024 kept these values (S2 record) |
| Non-pregnant women ≥ 15 y | 12.0 g/dL | same |
| Pregnant women (2nd–3rd trimester) | 11.0 g/dL | S1 |
| Indian children 1–19 y | 1–2 g/dL below WHO (healthy-reference P5) | CNNS, S3; no adult Indian cut-off exists |

There is no ICMR/RSSDI adult cut-off; Indian programmes (Anaemia Mukt Bharat) use WHO values (programme documents not opened this session). Indian chain labs usually print 13.0–17.0 (M) and 12.0–15.0 (F). WHO 2024 adds altitude and smoking adjustments (not opened; secondary only).

### How each lever moves it
Direction is the change in the marker when the lever is applied or increased. Rows with "— (mechanism only)" are best mechanistic expectations with no outcome data found; they are grade D and are **not** exported to the JSON interaction table.

| Lever | Direction | Effect size (unit; population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | – none | no trial of Hb found (g/dL) | 12 wk | Low carbohydrate raises resting and post-exercise hepcidin (S17, S18), which lowers iron absorption; any Hb effect would take months and only in low-iron people (expectation) | D | S17, S18 |
| Moderate low-carb | – none | no data | — | Hepcidin effect seen only at ≤ 3 g/kg carbohydrate in athletes (expectation: smaller) | D | — (mechanism only) |
| High protein (≥ 1.6 g/kg) | ↑ up | no Hb trial; vegetarians have ferritin −29.7 µg/L vs omnivores; adults (cross-sectional) | 12 wk | Meat/fish protein brings haem iron; plant protein brings phytate-bound iron (expectation for Hb) | D | S20 |
| Fasting 16:8 | – none | no data | — | No pathway beyond total intake | D | — (mechanism only) |
| Fasting 24 h | – none | no data | — | A single 24 h fast does not change red-cell mass; Hb may read slightly higher if dehydrated (expectation) | D | — (mechanism only) |
| Fasting 36–48 h | – none | no data | — | As above | D | — (mechanism only) |
| Extended fast > 48 h | – none | no data in healthy adults; Hb < 8 g/dL is a reason not to fast (Ramadan review); patients | — | Fasting reduces iron, B12 and folate intake; harm in severe anaemia is expert opinion | D | S22 |
| Saturated fat | – none | no data | — | No pathway | D | — (mechanism only) |
| Dietary cholesterol / eggs | – none | no data | — | Eggs supply some B12 and iron; no Hb data | D | — (mechanism only) |
| Fibre | – none | no Hb data | — | Phytate in high-fibre grains and pulses binds non-haem iron (expectation; not sourced this session) | D | — (mechanism only) |
| Unsaturated fats | – none | no data | — | No pathway | D | — (mechanism only) |
| Alcohol | – none | no Hb data opened | — | Heavy use raises MCV and can cause folate deficiency (not sourced this session) | D | — (mechanism only) |
| Caffeine (tea/coffee) | ↓ down | coffee −39 %, tea −64 % non-haem iron absorption from the same meal; no effect 1 h before (% absorption); iron-replete adults, single meals | — | Polyphenols (chlorogenic acid, tannins) chelate non-haem iron in the gut; Hb falls only if stores run down (months) | C | S14, S15 |
| Creatine | – none | no data | — | No pathway | D | — (mechanism only) |
| Whey / protein supplements | – none | no data | — | Dairy calcium may slightly reduce iron absorption at the same meal (see supp:calcium) | D | — (mechanism only) |
| Large deficit (> 25 %) | – none | no effect of 25 % CR over 24 months on Hb or hepcidin (g/dL); non-obese adults with an 18 mg iron multivitamin | 104 wk | Red-cell production is protected when micronutrients are covered; untested without the multivitamin and in already-anaemic people | B | S10 |
| Moderate deficit | – none | as above (g/dL); as above | 104 wk | As above | B | S10 |
| Surplus | – none | no data | — | No pathway | D | — (mechanism only) |
| Resistance training load | – none | no data | — | No plasma-volume effect of note (expectation) | D | — (mechanism only) |
| Aerobic training load | ↓ down | ΔHb vs Δplasma volume r = −0.81; transient haemolysis after long runs (g/dL); endurance athletes | 4 wk | Training expands plasma volume (dilution) and foot-strike haemolysis destroys a few red cells; normalises 3–5 days after stopping | B | S6, S7, S8 |
| Sleep debt | – none | no data | — | No pathway | D | — (mechanism only) |
| Weight loss itself | – none | no effect over 24 months of CR (g/dL); non-obese adults | 104 wk | As deficit_large | B | S10 |
| Supplement `iron` | ↑ up | +0.42 g/dL (95 % CI 0.10–0.74); ≥ 1 g/dL in 2 weeks if iron-deficient (g/dL); active women; IDA patients | 4 wk | Supplies iron for erythropoiesis; alternate-day dosing raises fractional absorption (21.8 vs 16.3 %) | A | S9, S1, S19 |
| Supplement `vitamin_b12` | ↑ up | larger Hb rise at 4 and 8 weeks when B12 added to iron + folic acid (g/dL); Indian children with nutritional anaemia | 8 wk | B12 is needed for DNA synthesis in red-cell precursors; helps only if B12 is low | C | S106 |
| Supplement `folic_acid` | ↑ up | no adult trial opened | 8 wk | Folate is needed for red-cell DNA synthesis; helps only if folate is low (expectation) | D | — (mechanism only) |
| Supplement `calcium` | ↓ down | 300–600 mg calcium with a meal cuts iron absorption 50–60 % (% absorption); adults, single meals | — | Calcium inhibits both haem and non-haem iron uptake at the enterocyte; separate from iron-rich meals | C | S16 |

### What it constrains in the plan
No rule bans anything; each is a cap, warning, re-ask, clinician note, retest prompt or preference. `{value}` and `{date}` are filled from the entered result.

| Rule id | When | Kind → target | Severity | Message | Grade | Sources |
|---|---|---|---|---|---|---|
| W-L-HB-1 | < whoCutoff g/dL (13.0 men, 12.0 women) | cap → `deficit_large` = deficitPct − 5 | caution | Because your haemoglobin was {value} g/dL on {date}, below the usual cut-off, your deficit is capped 5 points lower than usual until a retest. | D | S1, S2 |
| W-L-HB-2 | < whoCutoff g/dL | cap → `fast36_48` = 24 | caution | Because your haemoglobin was {value} g/dL on {date}, fasts are kept to 24 hours or less until it is back in range. | D | S22 |
| W-L-HB-3 | < whoCutoff g/dL | reask → `ferritin` | info | Your haemoglobin was {value} g/dL on {date}. Low iron and low B12 are the common causes; add ferritin and B12 from the same report if you have them. | B | S1, S30 |
| W-L-HB-4 | < whoCutoff g/dL and plan.aerobic_load >= high | warn → `aerobic_load` | info | Endurance training dilutes the blood, so haemoglobin reads a little lower; your value of {value} g/dL on {date} is still below the cut-off, so a clinician check is worthwhile. | B | S6, S7 |
| W-L-HB-5 | < 8 g/dL | clinician → `plan` | stop-and-see | Because your haemoglobin was {value} g/dL on {date}, please see a clinician before starting a deficit or fasting. The plan stays at maintenance until then. | B | S22, S1 |
| W-L-HB-6 | < whoCutoff g/dL | retest → `hb` = 4 | info | Retest haemoglobin in 4 weeks if you start iron, otherwise in 12 weeks. | B | S1 |
| W-L-HB-7 | < whoCutoff g/dL | prefer → `caffeine` | info | Because your haemoglobin was {value} g/dL on {date}: drink tea or coffee at least an hour away from main meals; it blocks iron from food. | C | S14, S15 |

### Clinician-only thresholds
| Threshold | Message | Sources |
|---|---|---|
| < 8 g/dL | Haemoglobin below 8 g/dL is severe anaemia. Please see a clinician before any deficit or fast. | S22, S1 |
| > labHigh g/dL | Haemoglobin above your lab's range needs a clinician to look at it (dehydration, smoking, altitude or a blood disorder). | S2 |

### Retest interval
If below the cut-off and the person starts iron: recheck Hb at **4 weeks** (a rise of ≥ 1 g/dL in 2–4 weeks points to iron deficiency, S1). Otherwise every **12 weeks** during a long deficit or a heavy endurance block; vegetarian women every 12–26 weeks (index §8). JSON default: 12 weeks.

### Indian-population notes
- NFHS-5: 57.0 % of women and 25.0 % of men aged 15–49 are anaemic by WHO cut-offs; rural men 27.4 % vs urban 20.4 % (S4).
- CNNS suggests WHO cut-offs over-call anaemia in Indian children (30.0 % vs 10.8 % with Indian reference cut-offs, S3). No equivalent adult study was found, so the app keeps WHO cut-offs but words a mild shortfall (within 1 g/dL) as "slightly below the usual cut-off".
- B12 deficiency is a frequent co-cause in vegetarians (S30, S106), so a low Hb prompts for B12 as well as ferritin.
- Lab layout: "HEMOGLOBIN"/"HAEMOGLOBIN" in the hemogram block, method often "PHOTOMETRY" or "SLS", unit g/dL.

### Sources
S1. Snook J et al. 2021. British Society of Gastroenterology guidelines for the management of iron deficiency anaemia in adults. Gut. PMID 34497146; doi:10.1136/gutjnl-2021-325210. <https://pmc.ncbi.nlm.nih.gov/articles/PMC8515119/>. *Used for:* Hb cut-offs restating WHO (<130 g/L men, <120 g/L non-pregnant women); ferritin 15/45 µg/L; Hb rise ≥10 g/L in 2 weeks on oral iron; check Hb within 4 weeks; no routine ferritin monitoring; FBC 3-monthly for a year after correction.
S2. World Health Organization 2024. Guideline on haemoglobin cutoffs to define anaemia in individuals and populations. PMID 38530913. <https://www.who.int/publications/i/item/9789240088542>. *Used for:* Guideline record (abstract only opened; numbers taken from S1).
S3. Sachdev HS et al. 2021. Haemoglobin thresholds to define anaemia in a national sample of healthy children and adolescents aged 1–19 years in India (CNNS). Lancet Glob Health. PMID 33872581; doi:10.1016/S2214-109X(21)00077-2. <https://pubmed.ncbi.nlm.nih.gov/33872581/>. *Used for:* Indian healthy-reference P5 cut-offs 1–2 g/dL below WHO; prevalence 10.8 % vs 30.0 % (ages 1–19 only).
S4. IIPS / MoHFW 2021. National Family Health Survey (NFHS-5) 2019–21, India fact sheet. —. <https://dhsprogram.com/pubs/pdf/OF43/India_National_Fact_Sheet.pdf>. *Used for:* Anaemia 57.0 % of women 15–49, 25.0 % of men 15–49.
S6. Shaskey DJ, Green GA. 2000. Sports haematology. Sports Med. PMID 10688281; doi:10.2165/00007256-200029010-00003. <https://pubmed.ncbi.nlm.nih.gov/10688281/>. *Used for:* "Sports anaemia" is dilutional pseudoanaemia; normalises 3–5 days after training stops.
S7. Sitkowski D et al. 2018. Relationship between plasma volume, Hb and EPO in endurance athletes. Res Sports Med. PMID 29516744; doi:10.1080/15438627.2018.1447936. <https://pubmed.ncbi.nlm.nih.gov/29516744/>. *Used for:* ΔHb vs Δplasma volume r = −0.81.
S8. Deitrick RW. 1991. Intravascular haemolysis in the recreational runner. Br J Sports Med. PMID 1810610; doi:10.1136/bjsm.25.4.183. <https://pubmed.ncbi.nlm.nih.gov/1810610/>. *Used for:* Foot-strike haemolysis after 13 km; transient, benign.
S9. McCarthy E et al. 2026. Diet and supplements on iron status of active females: meta-analysis. Sports Med. PMID 42271116; doi:10.1007/s40279-026-02464-x. <https://pubmed.ncbi.nlm.nih.gov/42271116/>. *Used for:* Ferrous sulfate: Hb +0.42 g/dL (95 % CI 0.10–0.74), ferritin +12.6 ng/mL (8.3–16.9).
S10. Dugan C et al. 2026. Two years of caloric restriction and iron status (CALERIE 2). J Nutr. PMID 41825741; doi:10.1016/j.tjnut.2026.101474. <https://pubmed.ncbi.nlm.nih.gov/41825741/>. *Used for:* 25 % CR vs ad libitum, 24 months, n = 220 with 18 mg iron multivitamin: no effect on Hb, ferritin or hepcidin.
S14. Morck TA et al. 1983. Inhibition of food iron absorption by coffee. Am J Clin Nutr. PMID 6402915; doi:10.1093/ajcn/37.3.416. <https://pubmed.ncbi.nlm.nih.gov/6402915/>. *Used for:* Coffee with a meal −39 %, tea −64 % iron absorption; no effect when coffee taken 1 h before.
S15. Hurrell RF et al. 1999. Inhibition of non-haem iron absorption by polyphenol-containing beverages. Br J Nutr. PMID 10999016; doi:10.1017/S0007114599000537. <https://pubmed.ncbi.nlm.nih.gov/10999016/>. *Used for:* Black tea −79–94 %; dose-dependent.
S16. Hallberg L et al. 1991. Calcium: effect of different amounts on nonheme- and heme-iron absorption. Am J Clin Nutr. PMID 1984335; doi:10.1093/ajcn/53.1.112. <https://pubmed.ncbi.nlm.nih.gov/1984335/>. *Used for:* 300–600 mg calcium with a meal cuts iron absorption 50–60 %.
S17. Badenhorst CE et al. 2015. Acute dietary carbohydrate manipulation and the subsequent inflammatory and hepcidin responses to exercise. Eur J Appl Physiol. PMID 26335627; doi:10.1007/s00421-015-3252-3. <https://pubmed.ncbi.nlm.nih.gov/26335627/>. *Used for:* 24 h at 3 g/kg CHO vs 10 g/kg: higher baseline hepcidin and IL-6 in 12 endurance athletes.
S18. McKay AKA et al. 2022. Six days of low carbohydrate, not energy availability, alters the iron and immune response to exercise in elite athletes. Med Sci Sports Exerc. PMID 34690285; doi:10.1249/MSS.0000000000002819. <https://pubmed.ncbi.nlm.nih.gov/34690285/>. *Used for:* LCHF raised the post-exercise IL-6 and hepcidin response; low EA alone did not.
S19. Stoffel NU et al. 2017. Iron absorption from oral iron supplements given on consecutive versus alternate days. Lancet Haematol. PMID 29032957; doi:10.1016/S2352-3026(17)30182-5. <https://pubmed.ncbi.nlm.nih.gov/29032957/>. *Used for:* Alternate-day 60 mg: fractional absorption 21.8 % vs 16.3 % consecutive days (iron-depleted women).
S20. Haider LM et al. 2018. The effect of vegetarian diets on iron status in adults: systematic review and meta-analysis. Crit Rev Food Sci Nutr. PMID 27880062; doi:10.1080/10408398.2016.1259210. <https://pubmed.ncbi.nlm.nih.gov/27880062/>. *Used for:* Vegetarians ferritin −29.7 µg/L (95 % CI −39.7 to −19.7) vs non-vegetarians.
S22. Nasiri A et al. 2025. Ramadan fasting and haematological disorders. Clin Hematol Int. PMID 41394432; doi:10.46989/001c.150393. <https://pubmed.ncbi.nlm.nih.gov/41394432/>. *Used for:* Patients with Hb <8 g/dL advised not to fast.
S30. Yajnik CS et al. 2006. Vitamin B12 and folate concentrations and plasma homocysteine in rural and urban Indians. J Assoc Physicians India. PMID 17214273. <https://pubmed.ncbi.nlm.nih.gov/17214273/>. *Used for:* Pune men: median 110 pmol/L, 67 % <150 pmol/L; vegetarians OR 4.4.
S106. Chandelia S et al. 2012. Addition of cobalamin to iron and folic acid improves haemoglobin rise in nutritional anaemia. Indian J Pediatr. PMID 22415494; doi:10.1007/s12098-012-0725-9. <https://pubmed.ncbi.nlm.nih.gov/22415494/>. *Used for:* Indian children: larger Hb rise at 4 and 8 weeks when B12 added; 97.6 % of tested were B12 deficient.

## Serum ferritin (`ferritin`)

### Physiology and what it reflects
Ferritin is the iron-storage protein; the serum level tracks body iron stores when there is no inflammation. It is also an acute-phase reactant: infection, inflammation, liver disease, alcohol and obesity raise it, so a "normal" ferritin can hide iron deficiency (WHO 2020 uses < 70 µg/L as the deficiency cut-off when inflammation is present, S11). Iron absorption is regulated by hepcidin, which rises for 3–24 h after hard exercise (S5) and with low carbohydrate availability (S17, S18). Stores change over months; on oral iron ferritin rises by about 12 ng/mL over a typical trial (S9).

### Units and conversions
ng/mL = µg/L (factor 1). Indian labs print ng/mL; the method is usually CLIA/CMIA. JSON: `si: µg/L`, `conventional: ng/mL`, `factor: 1`.

### Reference ranges and targets
| Use | Threshold | Source |
|---|---|---|
| Iron deficiency, healthy adults | < 15 µg/L | WHO 2020 (S11) |
| Iron deficiency with inflammation | < 70 µg/L | WHO 2020 (S11), conditional, low certainty |
| Lab lower limit / practical cut-off | 15–30 µg/L; 45 µg/L best trade-off in practice | BSG 2021 (S1) |
| Athletes, low stores | < 30 µg/L (practice, not consensus); ~50 before altitude | S12, S13 |
| Possible iron overload (with normal CRP) | > 200 µg/L men, > 150 µg/L menstruating women; > 500 if unwell | WHO 2020 (S11); never on ferritin alone |

No ICMR adult ferritin cut-off was found. The index decision (< 30 for training plans, < 15 deficiency) stands. The index's "ferritin with CRP > 5 is falsely normal" is kept as the app trigger; WHO tells users to measure CRP alongside and to use < 70 µg/L under inflammation, but the CRP > 5 mg/L value itself was not read in the opened WHO text (grade C).

### How each lever moves it
Direction is the change in the marker when the lever is applied or increased. Rows with "— (mechanism only)" are best mechanistic expectations with no outcome data found; they are grade D and are **not** exported to the JSON interaction table.

| Lever | Direction | Effect size (unit; population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | ↓ down | no ferritin trial; hepcidin higher after 24 h at 3 g/kg CHO and after 6 days LCHF (hepcidin); trained endurance athletes | 12 wk | Low muscle glycogen raises exercise IL-6, which drives hepatic hepcidin and blocks iron absorption for hours after training | C | S17, S18 |
| Moderate low-carb | – none | no data | — | Expected smaller than VLC (expectation) | D | — (mechanism only) |
| High protein (≥ 1.6 g/kg) | ↕ mixed | vegetarians −29.7 µg/L vs omnivores (µg/L); adults, cross-sectional | 26 wk | Animal protein brings better-absorbed haem iron (classic physiology); plant protein does not; direction depends on the source | B | S20 |
| Fasting 16:8 | – none | no data | — | No pathway beyond intake | D | — (mechanism only) |
| Fasting 24 h | – none | no data | — | No pathway | D | — (mechanism only) |
| Fasting 36–48 h | – none | no data | — | No pathway | D | — (mechanism only) |
| Extended fast > 48 h | ↕ mixed | no data | — | Less iron intake (down over weeks) versus acute-phase rise if unwell (up); expectation only | D | — (mechanism only) |
| Saturated fat | – none | no data | — | No pathway | D | — (mechanism only) |
| Dietary cholesterol / eggs | – none | no data | — | Eggs carry iron of low bioavailability (expectation) | D | — (mechanism only) |
| Fibre | ↓ down | no ferritin trial | — | Phytate binds non-haem iron (expectation, not sourced this session) | D | — (mechanism only) |
| Unsaturated fats | – none | no data | — | No pathway | D | — (mechanism only) |
| Alcohol | ↑ up | ferritin and serum iron rise progressively with intake; beer more than wine or spirits (µg/L); 3375 adult twins | 8 wk | Alcohol suppresses hepcidin and injures liver cells; a high ferritin then overstates stores | B | S21 |
| Caffeine (tea/coffee) | ↓ down | coffee −39 %, tea −64 % (up to −94 % for black tea) of meal iron absorbed (% absorption); adults, single meals | 26 wk | Polyphenol chelation of non-haem iron in the gut; separating by ≥ 1 h removes the effect | B | S14, S15 |
| Creatine | – none | no data | — | No pathway | D | — (mechanism only) |
| Whey / protein supplements | – none | no data | — | Dairy calcium at the same meal reduces iron absorption (see supp:calcium) | D | — (mechanism only) |
| Large deficit (> 25 %) | – none | 25 % CR for 24 months: no ferritin or hepcidin change; LEA alone did not raise hepcidin over 6 days (µg/L); non-obese adults with multivitamin; elite race walkers | 104 wk | Stores are protected when iron intake is covered; less food means less iron if the diet is not iron-dense | B | S10, S18 |
| Moderate deficit | – none | as above (µg/L); as above | 104 wk | As above | B | S10 |
| Surplus | – none | no data | — | Obesity raises hepcidin and ferritin through inflammation (expectation) | D | — (mechanism only) |
| Resistance training load | – none | no data | — | Expected smaller hepcidin response than running (expectation) | D | — (mechanism only) |
| Aerobic training load | ↓ down | hepcidin 1.7–3.1× at 3–24 h after a 60-min run; iron deficiency in 15–35 % of female and 5–11 % of male athletes (hepcidin; % deficient); endurance athletes | 12 wk | Exercise IL-6 → hepcidin → less iron absorbed, plus sweat, gut and haemolysis losses | B | S5, S13 |
| Sleep debt | – none | no data | — | No pathway | D | — (mechanism only) |
| Weight loss itself | – none | no change over 24 months of CR (µg/L); non-obese adults | 104 wk | Loss of inflammatory fat could lower ferritin in obesity (expectation) | B | S10 |
| Supplement `iron` | ↑ up | +12.6 ng/mL (95 % CI 8.3–16.9); alternate-day 60 mg absorbs 21.8 % vs 16.3 % daily (ng/mL); active women; iron-depleted women | 12 wk | Direct repletion; daily dosing raises hepcidin and blunts the next day's absorption | A | S9, S19 |
| Supplement `calcium` | ↓ down | 300–600 mg calcium with a meal cuts iron absorption 50–60 % (% absorption); adults | — | Calcium inhibits enterocyte iron uptake; take calcium away from iron-rich meals | B | S16 |
| Supplement `multivitamin_low_energy` | – none | CALERIE used an 18 mg iron multivitamin; no ferritin change in either arm (µg/L); non-obese adults | 104 wk | Covers iron needs during restriction | C | S10 |

### What it constrains in the plan
No rule bans anything; each is a cap, warning, re-ask, clinician note, retest prompt or preference. `{value}` and `{date}` are filled from the entered result.

| Rule id | When | Kind → target | Severity | Message | Grade | Sources |
|---|---|---|---|---|---|---|
| W-L-FERRITIN-1 | < 30 ng/mL and plan.aerobic_load >= moderate | cap → `deficit_large` | caution | Because your ferritin was {value} ng/mL on {date}, your deficit is kept moderate (no more than 20 %) while you train for endurance. | C | S12, S13 |
| W-L-FERRITIN-2 | < 30 ng/mL | prefer → `caffeine` | info | Because your ferritin was {value} ng/mL on {date}: keep tea and coffee at least an hour away from meals; with meals they cut iron absorption by 40–60 %. | B | S14, S15 |
| W-L-FERRITIN-3 | < 30 ng/mL | prefer → `recipes.vitaminC_with_iron` | info | Because your ferritin was {value} ng/mL on {date}, recipes pair pulses and greens with a vitamin C food (lemon, amla, tomato) to absorb more iron. | B | S23 |
| W-L-FERRITIN-4 | < 30 ng/mL | prefer → `supp:iron` | info | Because your ferritin was {value} ng/mL on {date}, iron is shown in your supplement options; take it only with a clinician's advice, ideally on alternate days. | B | S11, S19 |
| W-L-FERRITIN-5 | < 30 ng/mL and supplements.calcium == true | warn → `supp:calcium` | info | Calcium blocks iron absorption; take calcium at a different meal from iron-rich food or iron tablets. | B | S16 |
| W-L-FERRITIN-6 | < 70 ng/mL and crp > 5 mg/L | reask → `ferritin` | info | Your CRP was raised when ferritin was measured on {date}; ferritin rises with inflammation, so {value} ng/mL may hide low iron. Retest when well. | C | S11 |
| W-L-FERRITIN-7 | < 15 ng/mL | clinician → `plan` | see-clinician | Because your ferritin was {value} ng/mL on {date}, your iron stores are empty. Please see a clinician about treatment and the cause. | A | S11, S1 |
| W-L-FERRITIN-8 | > 200 ng/mL and crp <= 5 mg/L | clinician → `supp:iron` | see-clinician | Because your ferritin was {value} ng/mL on {date} with a normal CRP, Vitals will not suggest iron; please ask a clinician about it. | B | S11 |
| W-L-FERRITIN-9 | < 30 ng/mL | retest → `ferritin` = 12 | info | Retest ferritin (with CRP) in 12 weeks, at least 2 weeks after any illness or hard race. | C | S1, S12 |

### Clinician-only thresholds
| Threshold | Message | Sources |
|---|---|---|
| < 15 ng/mL | Ferritin below 15 means your iron stores are empty. Please ask a clinician about iron treatment and the cause. | S11, S1 |
| > 200 ng/mL | Ferritin above 200 (men) or 150 (women) with a normal CRP needs a clinician to check for iron overload. Vitals stops suggesting iron. | S11 |

### Retest interval
**12 weeks** after starting iron or after a dietary change aimed at iron (BSG does not recommend routine ferritin monitoring on treatment and checks the full blood count every 3 months, S1; ferritin at 12 weeks is a practical default, grade C). Athletes: twice a year (S12). Do not retest within 2 weeks of an infection or a hard endurance event.

### Indian-population notes
- No national adult ferritin-deficiency prevalence was found; most Indian anaemia is presumed iron-related, and vegetarians average about 30 µg/L lower ferritin than omnivores (S20).
- Ferritin is often **absent** from Indian "camp" profiles; the UI should say "not in your report" and prompt for it when Hb is low.
- Tea with meals is a near-universal Indian habit; the timing advice (S14, S15) is the cheapest lever the app has.

### Sources
S1. Snook J et al. 2021. British Society of Gastroenterology guidelines for the management of iron deficiency anaemia in adults. Gut. PMID 34497146; doi:10.1136/gutjnl-2021-325210. <https://pmc.ncbi.nlm.nih.gov/articles/PMC8515119/>. *Used for:* Hb cut-offs restating WHO (<130 g/L men, <120 g/L non-pregnant women); ferritin 15/45 µg/L; Hb rise ≥10 g/L in 2 weeks on oral iron; check Hb within 4 weeks; no routine ferritin monitoring; FBC 3-monthly for a year after correction.
S5. Peeling P et al. 2009. Training surface and intensity: inflammation, hemolysis, and hepcidin expression. Int J Sport Nutr Exerc Metab. PMID 20175428; doi:10.1123/ijsnem.19.6.583. <https://pubmed.ncbi.nlm.nih.gov/20175428/>. *Used for:* Urinary hepcidin 1.7–3.1× pre-run at 3–24 h after a 60-min run.
S9. McCarthy E et al. 2026. Diet and supplements on iron status of active females: meta-analysis. Sports Med. PMID 42271116; doi:10.1007/s40279-026-02464-x. <https://pubmed.ncbi.nlm.nih.gov/42271116/>. *Used for:* Ferrous sulfate: Hb +0.42 g/dL (95 % CI 0.10–0.74), ferritin +12.6 ng/mL (8.3–16.9).
S10. Dugan C et al. 2026. Two years of caloric restriction and iron status (CALERIE 2). J Nutr. PMID 41825741; doi:10.1016/j.tjnut.2026.101474. <https://pubmed.ncbi.nlm.nih.gov/41825741/>. *Used for:* 25 % CR vs ad libitum, 24 months, n = 220 with 18 mg iron multivitamin: no effect on Hb, ferritin or hepcidin.
S11. World Health Organization 2020. Guideline on use of ferritin concentrations to assess iron status in individuals and populations. PMID 33909381. <https://www.ncbi.nlm.nih.gov/books/NBK569880/>. *Used for:* Iron deficiency <15 µg/L adults; <70 µg/L with inflammation; overload risk >150 µg/L (menstruating women), >200 µg/L (men), >500 µg/L (unwell); measure CRP and AGP alongside.
S12. Clénin G et al. 2015. Iron deficiency in sports – definition, influence on performance and therapy. Swiss Med Wkly. PMID 26512429; doi:10.4414/smw.2015.14196. <https://pubmed.ncbi.nlm.nih.gov/26512429/>. *Used for:* Athletes: <15 µg/L empty stores, 15–30 low; 30 µg/L cut-off; ~50 µg/L before altitude; check twice a year.
S13. Sim M et al. 2019. Iron considerations for the athlete: a narrative review. Eur J Appl Physiol. PMID 31055680; doi:10.1007/s00421-019-04157-y. <https://pubmed.ncbi.nlm.nih.gov/31055680/>. *Used for:* Iron deficiency 15–35 % of female and 5–11 % of male athlete cohorts; exercise hepcidin as a cause.
S14. Morck TA et al. 1983. Inhibition of food iron absorption by coffee. Am J Clin Nutr. PMID 6402915; doi:10.1093/ajcn/37.3.416. <https://pubmed.ncbi.nlm.nih.gov/6402915/>. *Used for:* Coffee with a meal −39 %, tea −64 % iron absorption; no effect when coffee taken 1 h before.
S15. Hurrell RF et al. 1999. Inhibition of non-haem iron absorption by polyphenol-containing beverages. Br J Nutr. PMID 10999016; doi:10.1017/S0007114599000537. <https://pubmed.ncbi.nlm.nih.gov/10999016/>. *Used for:* Black tea −79–94 %; dose-dependent.
S16. Hallberg L et al. 1991. Calcium: effect of different amounts on nonheme- and heme-iron absorption. Am J Clin Nutr. PMID 1984335; doi:10.1093/ajcn/53.1.112. <https://pubmed.ncbi.nlm.nih.gov/1984335/>. *Used for:* 300–600 mg calcium with a meal cuts iron absorption 50–60 %.
S17. Badenhorst CE et al. 2015. Acute dietary carbohydrate manipulation and the subsequent inflammatory and hepcidin responses to exercise. Eur J Appl Physiol. PMID 26335627; doi:10.1007/s00421-015-3252-3. <https://pubmed.ncbi.nlm.nih.gov/26335627/>. *Used for:* 24 h at 3 g/kg CHO vs 10 g/kg: higher baseline hepcidin and IL-6 in 12 endurance athletes.
S18. McKay AKA et al. 2022. Six days of low carbohydrate, not energy availability, alters the iron and immune response to exercise in elite athletes. Med Sci Sports Exerc. PMID 34690285; doi:10.1249/MSS.0000000000002819. <https://pubmed.ncbi.nlm.nih.gov/34690285/>. *Used for:* LCHF raised the post-exercise IL-6 and hepcidin response; low EA alone did not.
S19. Stoffel NU et al. 2017. Iron absorption from oral iron supplements given on consecutive versus alternate days. Lancet Haematol. PMID 29032957; doi:10.1016/S2352-3026(17)30182-5. <https://pubmed.ncbi.nlm.nih.gov/29032957/>. *Used for:* Alternate-day 60 mg: fractional absorption 21.8 % vs 16.3 % consecutive days (iron-depleted women).
S20. Haider LM et al. 2018. The effect of vegetarian diets on iron status in adults: systematic review and meta-analysis. Crit Rev Food Sci Nutr. PMID 27880062; doi:10.1080/10408398.2016.1259210. <https://pubmed.ncbi.nlm.nih.gov/27880062/>. *Used for:* Vegetarians ferritin −29.7 µg/L (95 % CI −39.7 to −19.7) vs non-vegetarians.
S21. Whitfield JB et al. 2001. Effects of alcohol consumption on indices of iron stores and of iron stores on alcohol intake markers. Alcohol Clin Exp Res. PMID 11505030; doi:10.1097/00000374-200107000-00014. <https://pubmed.ncbi.nlm.nih.gov/11505030/>. *Used for:* Ferritin and serum iron rise progressively with alcohol intake (n = 3375 twins).
S23. Teucher B et al. 2004. Enhancers of iron absorption: ascorbic acid and other organic acids. Int J Vitam Nutr Res. PMID 15743017; doi:10.1024/0300-9831.74.6.403. <https://pubmed.ncbi.nlm.nih.gov/15743017/>. *Used for:* Ascorbic acid:iron molar ratio 2:1 (≈20 mg vitamin C per 3 mg iron) for low-inhibitor meals, >4:1 for high-inhibitor meals.

## Vitamin B12 (serum cobalamin) (`b12`)

### Physiology and what it reflects
B12 is made only by bacteria and reaches people through animal foods (dairy, eggs, fish, meat) or supplements. It is a cofactor for methionine synthase and methylmalonyl-CoA mutase; deficiency causes megaloblastic anaemia and neuropathy, and raises homocysteine and methylmalonic acid (MMA). Serum B12 is a poor test on its own: there is no gold standard, and borderline values need MMA or homocysteine (BSH 2014, S28). Liver stores last years, so diet changes move serum B12 slowly; oral supplements at ~650–1000 µg/day correct mild deficiency over ~16 weeks (S24). Metformin (S25, S26) and long-term PPIs (S27) lower it.

### Units and conversions
Indian labs print pg/mL. pmol/L = pg/mL × 0.738 (100–300 pmol/L = 135–406 pg/mL, S24). Watch for the extraction artefact "pq/mL". JSON: `si: pmol/L`, `conventional: pg/mL`, `factor: 0.738`.

### Reference ranges and targets
| Use | Threshold | Source |
|---|---|---|
| Deficiency (usual) | < 200 pg/mL (≈ 148 pmol/L) | used by DPPOS as ≤ 203 pg/mL (S25); index decision |
| Borderline | 200–300 pg/mL; confirm with MMA or homocysteine | S25 (≤ 298 pg/mL borderline), S28 |
| Subclinical (biochemical) | < 200 pmol/L (≈ 271 pg/mL) | S29 |
| Proposed for young Indian vegetarians | 100 pmol/L (≈ 135 pg/mL) | S31 (single study) |

BSH says definitive cut-offs are not possible and local ranges apply (S28). Indian labs commonly print 197–771 or 211–911 pg/mL. No ICMR cut-off was found. The index decision (< 200 suggest B12 for vegetarians; 200–300 borderline) matches; this dossier extends the B12 suggestion to everyone below 200, not only vegetarians, because metformin and PPI users are also low.

### How each lever moves it
Direction is the change in the marker when the lever is applied or increased. Rows with "— (mechanism only)" are best mechanistic expectations with no outcome data found; they are grade D and are **not** exported to the JSON interaction table.

| Lever | Direction | Effect size (unit; population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | – none | no data | — | Keto patterns rich in eggs, dairy and meat raise intake; vegetarian keto may not (expectation) | D | — (mechanism only) |
| Moderate low-carb | – none | no data | — | As above | D | — (mechanism only) |
| High protein (≥ 1.6 g/kg) | ↑ up | plasma B12 plateaus at ~10 µg/day intake; dairy and fish the main contributors (pmol/L); Norwegian adults (n = 5937) | 12 wk | Animal protein foods carry B12; plant protein carries none | B | S33 |
| Fasting 16:8 | – none | no data | — | Large liver stores (years) buffer short fasts | D | — (mechanism only) |
| Fasting 24 h | – none | no data | — | As above | D | — (mechanism only) |
| Fasting 36–48 h | – none | no data | — | As above | D | — (mechanism only) |
| Extended fast > 48 h | – none | no data | — | As above | D | — (mechanism only) |
| Saturated fat | – none | no data | — | No pathway | D | — (mechanism only) |
| Dietary cholesterol / eggs | ↑ up | no egg-specific estimate found; vegetarians vs lacto-ovo | 26 wk | Eggs carry B12 (less bioavailable than dairy, expectation); lacto-ovo vegetarians fare better than vegans | D | S32 |
| Fibre | – none | no data | — | No pathway | D | — (mechanism only) |
| Unsaturated fats | – none | no data | — | No pathway | D | — (mechanism only) |
| Alcohol | – none | no data | — | Liver disease can raise serum B12 falsely (not sourced) | D | — (mechanism only) |
| Caffeine (tea/coffee) | – none | no data | — | No pathway | D | — (mechanism only) |
| Creatine | – none | no data | — | No pathway | D | — (mechanism only) |
| Whey / protein supplements | ↑ up | no whey-specific estimate; dairy B12 appears more bioavailable (pmol/L); adults | 12 wk | Whey is a dairy fraction carrying some B12 (expectation for magnitude) | C | S33 |
| Large deficit (> 25 %) | – none | no data | — | Lower intake of B12 foods over months if the deficit cuts dairy (expectation) | D | — (mechanism only) |
| Moderate deficit | – none | no data | — | As above | D | — (mechanism only) |
| Surplus | – none | no data | — | No pathway | D | — (mechanism only) |
| Resistance training load | – none | no data | — | No pathway | D | — (mechanism only) |
| Aerobic training load | – none | no data | — | No pathway | D | — (mechanism only) |
| Sleep debt | – none | no data | — | No pathway | D | — (mechanism only) |
| Weight loss itself | – none | no data | — | No pathway | D | — (mechanism only) |
| Supplement `vitamin_b12` | ↑ up | 647–1032 µg/day oral gives 80–90 % of the maximal MMA fall (% MMA); older adults with mild deficiency | 16 wk | Passive (non-intrinsic-factor) absorption of ~1 % of a large oral dose | B | S24 |
| Supplement `multivitamin_low_energy` | ↑ up | no estimate | 12 wk | Multivitamins carry a few µg B12; enough for prevention, not for repletion (expectation) | D | — (mechanism only) |
| Supplement `folic_acid` | – none | no effect on B12 | — | Folic acid can correct the anaemia of B12 deficiency while nerve damage continues (classic teaching; not sourced this session) | D | — (mechanism only) |

### What it constrains in the plan
No rule bans anything; each is a cap, warning, re-ask, clinician note, retest prompt or preference. `{value}` and `{date}` are filled from the entered result.

| Rule id | When | Kind → target | Severity | Message | Grade | Sources |
|---|---|---|---|---|---|---|
| W-L-B12-1 | < 200 pg/mL | prefer → `supp:vitamin_b12` | caution | Because your B12 was {value} pg/mL on {date}, vitamin B12 is suggested in your supplements. Dairy, eggs and fish also help. | B | S28, S24, S33 |
| W-L-B12-2 | between 200–300 pg/mL | reask → `medications` | info | Your B12 was {value} pg/mL on {date}, borderline. Do you take metformin or an acid-reducing medicine (PPI)? Both lower B12; a clinician can confirm with an MMA or homocysteine test. | B | S25, S26, S27, S28 |
| W-L-B12-3 | < 135 pg/mL | clinician → `plan` | see-clinician | Because your B12 was {value} pg/mL on {date}, very low, please see a clinician, sooner if you have numbness, tingling or memory problems. | C | S28, S31 |
| W-L-B12-4 | < 300 pg/mL and diet.pattern in vegetarian/eggetarian/vegan | prefer → `foods.b12_sources` | info | Because your B12 was {value} pg/mL on {date}, meals favour curd, milk, paneer and eggs where your diet allows. | B | S33, S30 |
| W-L-B12-5 | < 200 pg/mL | retest → `b12` = 12 | info | Retest B12 about 12 weeks after starting a supplement. | C | S24 |

### Clinician-only thresholds
| Threshold | Message | Sources |
|---|---|---|
| < 135 pg/mL | B12 this low (below about 100 pmol/L) should be treated by a clinician, sooner if you have numbness, tingling or memory problems. | S28, S31 |

### Retest interval
**12 weeks** after starting a supplement (S24 trial length 16 weeks; grade C for the interval). Otherwise yearly for vegetarians, metformin or PPI users. Biotin-free sampling is not needed for B12.

### Indian-population notes
- Pune: median B12 110 pmol/L in men, 67 % below 150 pmol/L; vegetarians had 4.4× the odds of low B12 (S30).
- Young vegetarian graduates: about half deficient by usual cut-offs (S31). North Indian clinic data: ~31–38 % (not opened in detail).
- Most Indian vegetarians are lacto-vegetarian; dairy is the main dietary B12 source (S33). Eggetarian patterns help a little.
- Lab layout: "VITAMIN B-12" in the "Vitamin D total and B12 combo" panel, CLIA/CMIA, pg/mL.

### Sources
S24. Eussen SJ et al. 2005. Oral cyanocobalamin supplementation in older people with vitamin B12 deficiency: a dose-finding trial. Arch Intern Med. PMID 15911731; doi:10.1001/archinte.165.10.1167. <https://pubmed.ncbi.nlm.nih.gov/15911731/>. *Used for:* 647–1032 µg/day gives 80–90 % of the maximal MMA fall over 16 weeks.
S25. Aroda VR et al. 2016. Long-term metformin use and vitamin B12 deficiency in the Diabetes Prevention Program Outcomes Study. J Clin Endocrinol Metab. PMID 26900641; doi:10.1210/jc.2015-3754. <https://pubmed.ncbi.nlm.nih.gov/26900641/>. *Used for:* Low B12 (≤203 pg/mL) 4.3 % vs 2.3 % at 5 years; ≤298 pg/mL used as borderline.
S26. Kakarlapudi Y et al. 2022. Metformin and vitamin B12 deficiency: meta-analysis. Cureus. PMID 36628003; doi:10.7759/cureus.32277. <https://pubmed.ncbi.nlm.nih.gov/36628003/>. *Used for:* OR 2.95 (2.18–4.00) for deficiency on metformin; dose and duration dependent.
S27. Lam JR et al. 2013. Proton pump inhibitor and histamine-2 receptor antagonist use and vitamin B12 deficiency. JAMA. PMID 24327038; doi:10.1001/jama.2013.280490. <https://pubmed.ncbi.nlm.nih.gov/24327038/>. *Used for:* ≥2 years of PPI: 12.0 % of deficient patients vs 7.2 % of controls.
S28. Devalia V et al. 2014. Guidelines for the diagnosis and treatment of cobalamin and folate disorders (BSH). Br J Haematol. PMID 24942828; doi:10.1111/bjh.12959. <https://pubmed.ncbi.nlm.nih.gov/24942828/>. *Used for:* No gold standard; serum B12 first, MMA second; treat on neurological features despite discordant labs.
S29. Hannibal L et al. 2016. Biomarkers and algorithms for the diagnosis of vitamin B12 deficiency. Front Mol Biosci. PMID 27446930; doi:10.3389/fmolb.2016.00027. <https://pubmed.ncbi.nlm.nih.gov/27446930/>. *Used for:* Subclinical deficiency usually defined as total B12 <200 pmol/L.
S30. Yajnik CS et al. 2006. Vitamin B12 and folate concentrations and plasma homocysteine in rural and urban Indians. J Assoc Physicians India. PMID 17214273. <https://pubmed.ncbi.nlm.nih.gov/17214273/>. *Used for:* Pune men: median 110 pmol/L, 67 % <150 pmol/L; vegetarians OR 4.4.
S31. Naik S et al. 2018. Defining vitamin B12 deficiency in young vegetarian Indians. Br J Nutr. PMID 29446340; doi:10.1017/S0007114518000090. <https://pubmed.ncbi.nlm.nih.gov/29446340/>. *Used for:* About half deficient by usual definitions; proposes 100 pmol/L for young Indian vegetarians.
S32. Pawlak R et al. 2013. How prevalent is vitamin B12 deficiency among vegetarians? Nutr Rev. PMID 23356638; doi:10.1111/nure.12001. <https://pubmed.ncbi.nlm.nih.gov/23356638/>. *Used for:* Deficiency common in vegetarians, higher in vegans and lifelong vegetarians.
S33. Vogiatzoglou A et al. 2009. Dietary sources of vitamin B-12 and their association with plasma vitamin B-12 concentrations. Am J Clin Nutr. PMID 19190073; doi:10.3945/ajcn.2008.26598. <https://pubmed.ncbi.nlm.nih.gov/19190073/>. *Used for:* Plasma B12 plateaus at ~10 µg/day intake; dairy and fish the significant contributors.

## 25-hydroxyvitamin D [25(OH)D] (`vitd`)

### Physiology and what it reflects
25(OH)D is the storage form of vitamin D, made in the liver from skin-synthesised or dietary vitamin D; it reflects supply over the previous 1–2 months (circulating half-life ≈ 15 days, S44). Its established role is calcium absorption and bone; trials of supplementation for non-skeletal outcomes in replete adults are largely null, and the Endocrine Society 2024 guideline advises against routine testing and sets no target (S34). It is diluted in a larger body (S46), so it rises when weight is lost (S45) and needs higher doses in obesity (S42).

### Units and conversions
Indian labs print ng/mL ("25-OH VITAMIN D (TOTAL)", CLIA). nmol/L = ng/mL × 2.496 (20 ng/mL = 50 nmol/L, S35; exact factor from molecular weight 400.6, not read in a source). JSON: `si: nmol/L`, `conventional: ng/mL`, `factor: 2.496`.

### Reference ranges and targets
| Body | Bands | Source |
|---|---|---|
| IOM 2011 | ≥ 20 ng/mL covers bone needs of nearly everyone; RDA 600 IU/day (1–70 y) | S35 |
| Endocrine Society 2024 | no routine testing, no target; no above-RDA dose for healthy adults < 75 | S34 |
| IAP 2021 (India, children) | deficiency < 12, insufficiency 12–20, sufficiency > 20 ng/mL; toxicity > 100 with hypercalcaemia | S36 |
| Indian review (2026) | > 12 ng/mL keeps PTH and calcium normal in Indians | S38 (advocacy-level) |
| Indian endocrinologist consensus (2025) | 40–60 ng/mL | S39 — **not adopted**: conflicts with S34 and outcome trials |
| Toxicity | > 150 ng/mL with hypercalcaemia | S37 |

Indian labs print "deficiency < 20, insufficiency 20–30, sufficiency 30–100, toxicity > 100". The app shows the lab's bands but acts on < 12 ng/mL (index decision, consistent with S36, S38). ICMR-NIN 2020 RDA is 600 IU/day (brief note, opened by a sub-agent; not listed as a numbered source here).

### How each lever moves it
Direction is the change in the marker when the lever is applied or increased. Rows with "— (mechanism only)" are best mechanistic expectations with no outcome data found; they are grade D and are **not** exported to the JSON interaction table.

| Lever | Direction | Effect size (unit; population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | ↑ up | 25(OH)D rose at 3 months on a ketogenic diet (ng/mL); children with epilepsy (indirect) | 12 wk | Unclear; possibly supplement use in the trial and fat loss (expectation) | D | S107 |
| Moderate low-carb | – none | no data | — | No pathway | D | — (mechanism only) |
| High protein (≥ 1.6 g/kg) | – none | no data | — | Fish and eggs carry small amounts (expectation) | D | — (mechanism only) |
| Fasting 16:8 | – none | no data | — | No pathway | D | — (mechanism only) |
| Fasting 24 h | – none | no data | — | No pathway | D | — (mechanism only) |
| Fasting 36–48 h | – none | no data | — | No pathway | D | — (mechanism only) |
| Extended fast > 48 h | – none | no data | — | Fat mobilisation could release stored vitamin D (expectation) | D | — (mechanism only) |
| Saturated fat | – none | no data | — | No pathway | D | — (mechanism only) |
| Dietary cholesterol / eggs | – none | no data | — | Egg yolk has ~40 IU each (expectation, small) | D | — (mechanism only) |
| Fibre | – none | no data | — | No pathway | D | — (mechanism only) |
| Unsaturated fats | – none | no data | — | Oily fish is a food source (expectation) | D | — (mechanism only) |
| Alcohol | – none | no data | — | No pathway found | D | — (mechanism only) |
| Caffeine (tea/coffee) | – none | no data | — | No pathway | D | — (mechanism only) |
| Creatine | – none | no data | — | No pathway | D | — (mechanism only) |
| Whey / protein supplements | – none | no data | — | No pathway | D | — (mechanism only) |
| Large deficit (> 25 %) | ↑ up | via weight loss: +3.3 ng/mL at 10–15 % and +7.7 at ≥ 15 % loss (ng/mL); postmenopausal women, 12 months | 52 wk | Volumetric dilution reverses as body size falls | C | S45, S46 |
| Moderate deficit | ↑ up | via weight loss: +2.1 to +2.7 ng/mL at < 10 % loss (ng/mL); postmenopausal women | 52 wk | As above | C | S45 |
| Surplus | ↓ down | obese vs normal-weight 25(OH)D −19.8 nmol/L (≈ −8 ng/mL) at the same dose (nmol/L); adults, observational | 52 wk | Larger body volume dilutes vitamin D | C | S42, S46 |
| Resistance training load | – none | no data | — | No pathway | D | — (mechanism only) |
| Aerobic training load | – none | exercise-only arm no different from control (ng/mL); postmenopausal women | 52 wk | Outdoor training adds sun exposure (expectation, not measured) | C | S45 |
| Sleep debt | – none | no data | — | No pathway | D | — (mechanism only) |
| Weight loss itself | ↑ up | +2.1/+2.7/+3.3/+7.7 ng/mL for < 5/5–10/10–15/≥ 15 % loss (ng/mL); postmenopausal women (n = 439), 12 months | 52 wk | Volumetric dilution | B | S45, S46 |
| Supplement `vitamin_d3` | ↑ up | ≈ +7 ng/mL per 1000 IU/day at baseline ~28 ng/mL; +4.8 per 1000 IU at low doses, flattening; obese need 2–3× the dose (ng/mL); adults (RCT and pooled observational) | 12 wk | Substrate supply to hepatic 25-hydroxylase; half-life 15 days, plateau in ~2–3 months | A | S41, S42, S43, S44 |
| Supplement `magnesium` | ↕ mixed | raised 25(OH)D near 30 ng/mL baseline, lowered it at 30–50 (ng/mL); adults (n = 180) | 12 wk | Magnesium is a cofactor for vitamin D hydroxylases and catabolism | B | S47 |
| Supplement `calcium` | – none | no data | — | Calcium lowers PTH, not 25(OH)D (expectation) | D | — (mechanism only) |

### What it constrains in the plan
No rule bans anything; each is a cap, warning, re-ask, clinician note, retest prompt or preference. `{value}` and `{date}` are filled from the entered result.

| Rule id | When | Kind → target | Severity | Message | Grade | Sources |
|---|---|---|---|---|---|---|
| W-L-VITD-1 | < 12 ng/mL | prefer → `supp:vitamin_d3` | caution | Because your vitamin D was {value} ng/mL on {date}, low by Indian and international cut-offs, vitamin D3 is suggested in your supplements. | B | S36, S38, S35 |
| W-L-VITD-2 | between 12–20 ng/mL | prefer → `supp:vitamin_d3` | info | Your vitamin D was {value} ng/mL on {date}. A daily 600–1000 IU supplement or regular midday sun is optional; most adults at this level do not need more. | B | S35, S34 |
| W-L-VITD-3 | > 100 ng/mL | clinician → `supp:vitamin_d3` = 0 | see-clinician | Because your vitamin D was {value} ng/mL on {date}, Vitals stops suggesting vitamin D. Please ask a clinician to check your calcium. | B | S36, S37 |
| W-L-VITD-4 | < 12 ng/mL and bmi >= 30 | warn → `supp:vitamin_d3` | info | At a higher body weight the same vitamin D dose raises blood levels less; your value was {value} ng/mL on {date}. | B | S42 |
| W-L-VITD-5 | < 12 ng/mL | retest → `vitd` = 12 | info | Optional: recheck vitamin D about 12 weeks after starting a supplement. Routine yearly testing is not needed. | C | S44, S34 |

### Clinician-only thresholds
| Threshold | Message | Sources |
|---|---|---|
| > 100 ng/mL | Vitamin D above 100 ng/mL is in the toxic range for some people. Stop vitamin D supplements and ask a clinician to check your calcium. | S36, S37 |

### Retest interval
No routine retest (S34). If the person starts vitamin D because the value was < 12 ng/mL, one optional recheck at **12 weeks** (≈ 5 half-lives, S44; interval grade C). JSON default 12, flagged optional.

### Indian-population notes
- Delhi NCR adults ≥ 30 y: urban median 7.7 ng/mL (71 % < 10), rural 16.2 ng/mL (S40). National "deficiency" on the < 20 cut-off is 70–100 % in most surveys, which is why the < 20 cut-off is contested (S38).
- Asian adults need about 2000 IU/day to reach 30 ng/mL in pooled trials vs ~730 IU for Europeans (S43); this is a dose note, not a target.
- Supplements sold in India are often 60 000 IU weekly sachets; the app's catalogue dose governs, and it never suggests above the upper limit.

### Sources
S34. Demay MB et al. 2024. Vitamin D for the prevention of disease: an Endocrine Society clinical practice guideline. J Clin Endocrinol Metab. PMID 38828931; doi:10.1210/clinem/dgae290. <https://pubmed.ncbi.nlm.nih.gov/38828931/>. *Used for:* Advises against routine 25(OH)D testing; no target level defined.
S35. Ross AC et al. 2011. The 2011 report on dietary reference intakes for calcium and vitamin D from the IOM. J Clin Endocrinol Metab. PMID 21118827; doi:10.1210/jc.2010-2704. <https://pubmed.ncbi.nlm.nih.gov/21118827/>. *Used for:* RDA 600 IU (1–70 y); 20 ng/mL (50 nmol/L) covers bone needs.
S36. Gupta P et al. 2022. IAP guideline on prevention and treatment of vitamin D deficiency and rickets. Indian Pediatr. PMID 34969941; doi:10.1007/s13312-022-2448-y. <https://pubmed.ncbi.nlm.nih.gov/34969941/>. *Used for:* Deficiency <12, insufficiency 12–20, sufficiency >20 ng/mL (children); toxicity >100 ng/mL with hypercalcaemia.
S37. Marcinowska-Suchowierska E et al. 2018. Vitamin D toxicity – a clinical perspective. Front Endocrinol. PMID 30294301; doi:10.3389/fendo.2018.00550. <https://pubmed.ncbi.nlm.nih.gov/30294301/>. *Used for:* 25(OH)D >150 ng/mL with hypercalcaemia is the hallmark of toxicity.
S38. Laik JK et al. 2026. Vitamin D deficiency thresholds in India: systematic review. Cureus. PMID 41502833; doi:10.7759/cureus.100877; PMC12770915. <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12770915/>. *Used for:* Argues >12 ng/mL keeps PTH and calcium normal in Indians (narrative-quality review).
S39. Kalra S et al. 2025. Vitamin D expert consensus (India). Indian J Endocrinol Metab. PMID 40181864; doi:10.4103/ijem.ijem_264_24. <https://pubmed.ncbi.nlm.nih.gov/40181864/>. *Used for:* Delphi of 41 endocrinologists recommends 40–60 ng/mL (not adopted here).
S40. Praveen PA et al. 2023. Vitamin D status of adults in Delhi NCR. WHO South-East Asia J Public Health. PMID 38848530; doi:10.4103/who-seajph.who-seajph_113_22. <https://pubmed.ncbi.nlm.nih.gov/38848530/>. *Used for:* Urban median 7.7 ng/mL, rural 16.2; 71 % urban <10 ng/mL.
S41. Heaney RP et al. 2003. Human serum 25-hydroxycholecalciferol response to extended oral dosing with cholecalciferol. Am J Clin Nutr. PMID 12499343; doi:10.1093/ajcn/77.1.204. <https://pubmed.ncbi.nlm.nih.gov/12499343/>. *Used for:* +0.70 nmol/L per µg/day (≈ +7 ng/mL per 1000 IU/day) over ~20 weeks in men.
S42. Ekwaru JP et al. 2014. The importance of body weight for the dose response relationship of oral vitamin D supplementation. PLoS One. PMID 25372709; doi:10.1371/journal.pone.0111265. <https://pubmed.ncbi.nlm.nih.gov/25372709/>. *Used for:* +12 nmol/L per 1000 IU at low doses, flattening; obese 2–3× dose needed.
S43. Mo M et al. 2019. Vitamin D supplementation dose to reach 75 nmol/L: meta-analysis by region. Eur J Clin Nutr. PMID 30872787; doi:10.1038/s41430-019-0417-x. <https://pubmed.ncbi.nlm.nih.gov/30872787/>. *Used for:* ≈2026 IU/day for Asian adults vs 729 IU/day European to reach 75 nmol/L.
S44. Jones G. 2008. Pharmacokinetics of vitamin D toxicity. Am J Clin Nutr. PMID 18689406; doi:10.1093/ajcn/88.2.582S. <https://pubmed.ncbi.nlm.nih.gov/18689406/>. *Used for:* Circulating 25(OH)D half-life ≈ 15 days.
S45. Mason C et al. 2011. Effects of weight loss on serum vitamin D in postmenopausal women. Am J Clin Nutr. PMID 21613554; doi:10.3945/ajcn.111.015552. <https://pubmed.ncbi.nlm.nih.gov/21613554/>. *Used for:* 25(OH)D +2.1/+2.7/+3.3/+7.7 ng/mL for <5/5–10/10–15/≥15 % weight loss over 12 months; exercise arm alone no change.
S46. Drincic AT et al. 2012. Volumetric dilution, rather than sequestration best explains the low vitamin D status of obesity. Obesity. PMID 22262154; doi:10.1038/oby.2011.404. <https://pubmed.ncbi.nlm.nih.gov/22262154/>. *Used for:* Body size explains low 25(OH)D in obesity.
S47. Dai Q et al. 2018. Magnesium status and supplementation influence vitamin D status and metabolism: RCT. Am J Clin Nutr. PMID 30541089; doi:10.1093/ajcn/nqy274. <https://pubmed.ncbi.nlm.nih.gov/30541089/>. *Used for:* Magnesium raised 25(OH)D near 30 ng/mL baseline, lowered it at higher baselines.
S107. Bergqvist AG et al. 2007. Vitamin D status in children with intractable epilepsy, and impact of the ketogenic diet. Epilepsia. PMID 17241209; doi:10.1111/j.1528-1167.2006.00803.x. <https://pubmed.ncbi.nlm.nih.gov/17241209/>. *Used for:* 25(OH)D rose at 3 months on keto in children (indirect).

## High-sensitivity C-reactive protein (hs-CRP) (`crp`)

### Physiology and what it reflects
CRP is made by the liver under IL-6 drive; it rises within hours of infection, injury or hard exercise and falls with a half-life of about a day (classic physiology). hs-CRP is the same protein measured with a low-range assay; between 0.3 and 10 mg/L it marks chronic low-grade inflammation and cardiovascular risk, largely from visceral fat and insulin resistance (S50). A single value is noisy (S52), so guidelines average two tests ≥ 2 weeks apart and discard values > 10 mg/L as acute (S48).

### Units and conversions
Indian labs print mg/L for hs-CRP; some print plain CRP in mg/dL (× 10 = mg/L). The parser must keep "CRP" and "HS-CRP" apart: plain CRP assays are not reliable below ~5 mg/L. JSON: `si: mg/L`, `conventional: mg/dL`, `factor: 10`.

### Reference ranges and targets
| Band | hs-CRP | Source |
|---|---|---|
| Low CV risk | < 1 mg/L | CDC/AHA 2003 via S48 |
| Average | 1–3 mg/L | same |
| High | > 3 mg/L | same |
| Risk enhancer (statin decisions) | ≥ 2 mg/L | ACC/AHA 2019 (S49) |
| Probable acute illness | > 10 mg/L: repeat in ~2 weeks, look for infection | S48 |

LAI does not use hs-CRP as a target (no LAI document opened for CRP; not found). Indian labs print the same 3 AHA bands. Indian Asians run about 17 % higher CRP than Europeans, explained by central obesity and insulin resistance (S50), so no separate Indian cut-off is used.

### How each lever moves it
Direction is the change in the marker when the lever is applied or increased. Rows with "— (mechanism only)" are best mechanistic expectations with no outcome data found; they are grade D and are **not** exported to the JSON interaction table.

| Lever | Direction | Effect size (unit; population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | – none | no significant CRP effect (44 RCTs); IL-6 and TNF-α fell (mg/L); adults | 12 wk | Ketosis may blunt inflammasome activity; CRP benefit tracks weight loss rather than carbohydrate | A | S57 |
| Moderate low-carb | – none | no data separate from VLC | — | As VLC (expectation) | D | — (mechanism only) |
| High protein (≥ 1.6 g/kg) | – none | no data | — | No pathway | D | — (mechanism only) |
| Fasting 16:8 | ↕ mixed | IF −0.29 mg/L in one meta-analysis; no effect in another (mg/L); overweight/obese adults, ≥ 8 weeks | 8 wk | Benefit mostly through weight loss | B | S55, S56 |
| Fasting 24 h | – none | no data | — | No pathway beyond weight loss | D | — (mechanism only) |
| Fasting 36–48 h | – none | no meta-analysis found | — | Ketosis is anti-inflammatory in models (expectation) | D | — (mechanism only) |
| Extended fast > 48 h | – none | no meta-analysis found | — | As above | D | — (mechanism only) |
| Saturated fat | ↑ up | −0.14 mg/L per 1 %E less SFA (cross-sectional); top SFA quartile OR 1.58 for raised CRP (mg/L); urban Asian Indian youth; US adults | 12 wk | SFA activates TLR4 signalling in fat and immune cells (mechanism moderate) | C | S51, S59 |
| Dietary cholesterol / eggs | – none | no data | — | No pathway | D | — (mechanism only) |
| Fibre | ↓ down | −0.37 mg/L (−0.74 to 0) when fibre rises ≥ 8 g/day (mg/L); overweight/obese adults, RCTs | 8 wk | Fermentation to short-chain fatty acids, lower gut-derived endotoxin, weight loss | B | S58, S59 |
| Unsaturated fats | ↓ down | marine n-3 lowers CRP (68 RCTs); magnitude in mg/L not extracted (mg/L); adults | 8 wk | n-3 fatty acids are precursors of pro-resolving mediators and reduce NF-κB signalling | C | S60 |
| Alcohol | – none | no CRP-specific meta-analysis opened | — | J-shape is commonly reported (not sourced this session) | D | — (mechanism only) |
| Caffeine (tea/coffee) | – none | no data | — | No pathway | D | — (mechanism only) |
| Creatine | – none | no data | — | No pathway | D | — (mechanism only) |
| Whey / protein supplements | – none | no data | — | No pathway | D | — (mechanism only) |
| Large deficit (> 25 %) | ↓ down | −0.13 mg/L per kg lost across all interventions (mg/L); adults, 33 studies | 12 wk | Less visceral fat → less IL-6 → less hepatic CRP | A | S53 |
| Moderate deficit | ↓ down | CR SMD −0.15; lifestyle slope ≈ −0.06 mg/L per kg (mg/L); overweight/obese adults | 12 wk | As above | B | S56, S53 |
| Surplus | ↑ up | no direct CRP data; overfeeding raised endotoxin markers | 8 wk | Fat gain raises adipose IL-6 (expectation from the weight-loss slope) | D | S53 |
| Resistance training load | ↓ down | training of all types: ES 0.26 (SMD); adults, 83 trials | 8 wk | Chronic training lowers IL-6 and visceral fat | B | S54 |
| Aerobic training load | ↕ mixed | chronic: ES 0.26 lower (0.38 with weight loss); acute marathon: raised from day 1 to day 3 (SMD; mg/L); adults; recreational runners | 8 wk | Training is anti-inflammatory over weeks; muscle damage after long or hard sessions drives an acute-phase rise | A | S54, S62 |
| Sleep debt | ↑ up | raised after 88 h awake and after 10 days at 4.2 h/night (mg/L not in abstract) (mg/L); healthy adults (n = 10 per arm) | 2 wk | Sleep loss activates sympathetic and IL-6 pathways | C | S61 |
| Weight loss itself | ↓ down | −0.13 mg/L per kg (all); ≈ −0.06 per kg with lifestyle only (mg/L); adults | 12 wk | Visceral fat loss | A | S53 |
| Supplement `omega3_epa_dha` | ↓ down | CRP lowered (68 RCTs); umbrella ES −0.40, very heterogeneous (SMD); adults | 8 wk | As unsatfat | B | S60 |
| Supplement `vitamin_d3` | ↕ mixed | −1.08 mg/L, larger if baseline ≥ 5 mg/L; another meta-analysis null (mg/L); adults | 12 wk | Vitamin D modulates immune cells; effect inconsistent | C | S63 |
| Supplement `psyllium` | ↓ down | covered by the fibre estimate (mg/L); overweight/obese adults | 8 wk | As fibre | C | S58 |

### What it constrains in the plan
No rule bans anything; each is a cap, warning, re-ask, clinician note, retest prompt or preference. `{value}` and `{date}` are filled from the entered result.

| Rule id | When | Kind → target | Severity | Message | Grade | Sources |
|---|---|---|---|---|---|---|
| W-L-CRP-1 | > 10 mg/L | cap → `fasting` = 24 | caution | Because your hs-CRP was {value} mg/L on {date}, which usually means a recent illness, fasts are kept to 24 hours or less for 4 weeks. | D | S48 |
| W-L-CRP-2 | > 10 mg/L | retest → `crp` = 2 | info | Repeat hs-CRP in about 2 weeks when you feel well; a value above 10 is usually from an infection. | B | S48 |
| W-L-CRP-3 | > 3 mg/L | prefer → `fibre` | info | Because your hs-CRP was {value} mg/L on {date}, the plan ranks weight loss, fibre and regular training higher; they lower it. | B | S53, S58, S54 |
| W-L-CRP-4 | > 3 mg/L | reask → `sampleContext` | info | Was the blood taken within 3 days of a hard race or session, or during a cold? Either can raise CRP for a few days. | C | S62, S48 |
| W-L-CRP-5 | > 3 mg/L | prefer → `satfat` | info | Because your hs-CRP was {value} mg/L on {date}, cooking fats lean toward mustard, groundnut or olive oil rather than ghee or coconut oil. | C | S51, S59 |
| W-L-CRP-6 | > 10 mg/L, confirmed on a repeat test | clinician → `plan` | see-clinician | Your hs-CRP has been above 10 mg/L on two tests ({date}). Please see a clinician to find the cause. | B | S48 |

### Clinician-only thresholds
| Threshold | Message | Sources |
|---|---|---|
| > 10 mg/L | hs-CRP above 10 on two tests a few weeks apart needs a clinician to look for the cause. | S48 |

### Retest interval
> 10 mg/L: repeat in **2 weeks** (S48). 3–10 mg/L: repeat once to average (S48, S52), then every **26 weeks** while losing weight. Never within 3 days of a race or very hard session (S62) or within 2 weeks of an infection.

### Indian-population notes
- Urban Asian Indian adolescents and young adults: mean CRP 1.3 mg/L, 9 % above 3 mg/L; saturated fat was the dominant dietary correlate (S51).
- UK Indian Asian men: CRP 17 % higher than European men, gone after adjusting for waist and insulin resistance (S50).
- Lab layout: "HIGH SENSITIVITY C-REACTIVE PROTEIN (HS-CRP)", immunoturbidimetry, mg/L, with the AHA risk table printed below.

### Sources
S48. Shishehbor MH, Hazen SL / Cleveland Clinic J Med 2003. Using C-reactive protein to assess cardiovascular disease risk (summary of the CDC/AHA 2003 statement). —. <https://www.ccjm.org/content/ccjom/70/7/634.full.pdf>. *Used for:* hs-CRP <1 / 1–3 / >3 mg/L; average two tests ≥2 weeks apart; >10 mg/L: look for infection and repeat.
S49. Arnett DK et al. 2019. ACC/AHA guideline on the primary prevention of cardiovascular disease. Circulation. PMID 30879355; doi:10.1161/CIR.0000000000000678. <https://pubmed.ncbi.nlm.nih.gov/30879355/>. *Used for:* hs-CRP ≥2.0 mg/L is a risk-enhancing factor.
S50. Chambers JC et al. 2001. C-reactive protein, insulin resistance, central obesity, and coronary heart disease risk in Indian Asians. Circulation. PMID 11447077; doi:10.1161/01.CIR.104.2.145. <https://pubmed.ncbi.nlm.nih.gov/11447077/>. *Used for:* CRP 17 % higher in UK Indian Asian men; explained by central obesity and insulin resistance.
S51. Arya S et al. 2006. Dietary pattern and hs-CRP in urban Asian Indian adolescents and young adults. Nutrition. PMID 16829027; doi:10.1016/j.nut.2006.05.002. <https://pubmed.ncbi.nlm.nih.gov/16829027/>. *Used for:* Mean CRP 1.3 mg/L, 9 % >3; −0.14 mg/L per 1 %E SFA lower (cross-sectional).
S52. Ockene IS et al. 2001. Variability and classification accuracy of serial hs-CRP measurements in healthy adults. Clin Chem. PMID 11238295; doi:10.1093/clinchem/47.3.444. <https://pubmed.ncbi.nlm.nih.gov/11238295/>. *Used for:* 63 % of repeat measures in same quartile; variability similar to cholesterol.
S53. Selvin E et al. 2007. The effect of weight loss on C-reactive protein: systematic review. Arch Intern Med. PMID 17210875; doi:10.1001/archinte.167.1.31. <https://pubmed.ncbi.nlm.nih.gov/17210875/>. *Used for:* −0.13 mg/L per kg lost (all interventions); lifestyle-only slope ≈ 0.06.
S54. Fedewa MV et al. 2017. Effect of exercise training on C reactive protein: systematic review and meta-analysis. Br J Sports Med. PMID 27445361; doi:10.1136/bjsports-2016-095999. <https://pubmed.ncbi.nlm.nih.gov/27445361/>. *Used for:* Training lowers CRP, ES 0.26 (83 trials); 0.38 with weight loss, 0.19 without.
S55. Wang X et al. 2020. Effects of intermittent fasting and energy-restricted diets on CRP: meta-analysis of 18 RCTs. Nutrition. PMID 32947129; doi:10.1016/j.nut.2020.110974. <https://pubmed.ncbi.nlm.nih.gov/32947129/>. *Used for:* IF −0.29 mg/L; CR alone ≈ 0; larger in overweight and ≥8-week trials.
S56. Aamir AB et al. 2025. Intermittent fasting vs caloric restriction and inflammatory markers. Obes Rev. PMID 39289905; doi:10.1111/obr.13838. <https://pubmed.ncbi.nlm.nih.gov/39289905/>. *Used for:* CR lowered CRP (SMD −0.15); IF did not.
S57. Ji J et al. 2025. Ketogenic diets and inflammatory markers: meta-analysis of 44 RCTs. Nutr Rev. PMID 38219223; doi:10.1093/nutrit/nuad175. <https://pubmed.ncbi.nlm.nih.gov/38219223/>. *Used for:* No significant effect on CRP; IL-6 and TNF-α fell.
S58. Jiao J et al. 2015. Effect of dietary fiber on circulating CRP in overweight and obese adults: meta-analysis of RCTs. Int J Food Sci Nutr. PMID 25578759; doi:10.3109/09637486.2014.959898. <https://pubmed.ncbi.nlm.nih.gov/25578759/>. *Used for:* −0.37 mg/L (−0.74 to 0); significant only with ≥8 g/day more fibre.
S59. King DE et al. 2003. Relation of dietary fat and fiber to elevation of CRP. Am J Cardiol. PMID 14636916; doi:10.1016/j.amjcard.2003.08.020. <https://pubmed.ncbi.nlm.nih.gov/14636916/>. *Used for:* NHANES: high fibre OR 0.58–0.64 for raised CRP; SFA Q3 OR 1.58.
S60. Li K et al. 2014. Effect of marine-derived n-3 PUFA on CRP, IL-6 and TNF-α: meta-analysis. PLoS One. PMID 24505395; doi:10.1371/journal.pone.0088103. <https://pubmed.ncbi.nlm.nih.gov/24505395/>. *Used for:* Marine n-3 lowered CRP (68 RCTs).
S61. Meier-Ewert HK et al. 2004. Effect of sleep loss on C-reactive protein. J Am Coll Cardiol. PMID 14975482; doi:10.1016/j.jacc.2003.07.050. <https://pubmed.ncbi.nlm.nih.gov/14975482/>. *Used for:* hs-CRP rose with 88 h total and 10 days of 4.2 h/night sleep.
S62. Takayama F et al. 2018. Marathon and post-race CRP. Open Access J Sports Med. PMID 30568518; doi:10.2147/OAJSM.S183274. <https://pubmed.ncbi.nlm.nih.gov/30568518/>. *Used for:* CRP peaked day 1 after a marathon and stayed raised to day 3.
S63. Chen N et al. 2014. Vitamin D supplementation and CRP: meta-analysis. Nutrients. PMID 24918698; doi:10.3390/nu6062206. <https://pubmed.ncbi.nlm.nih.gov/24918698/>. *Used for:* −1.08 mg/L, larger when baseline CRP ≥5 mg/L (other meta-analyses null).

## Thyroid-stimulating hormone (TSH) (`tsh`)

### Physiology and what it reflects
TSH is made by the pituitary in response to thyroid hormone feedback; it moves logarithmically with small changes in free T4, which makes it the single best screening test for primary thyroid disease (S64). High TSH means an under-active thyroid (Hashimoto's is the common cause), low TSH an over-active one or excess thyroid medicine. Diet and fasting move TSH only a little (fasting meta-analysis g = −0.58, S69; KD unchanged, S73); weight loss in obesity lowers it modestly (S67, S105). Levothyroxine users are the group whose TSH diet *can* move, through absorption: coffee, calcium and iron near the dose raise TSH (S66, S77). High-dose biotin falsely lowers TSH on some assays (S79).

### Units and conversions
µIU/mL = mIU/L (factor 1). Indian panels label it "TSH – ULTRASENSITIVE" (CLIA/CMIA). JSON: `si: mIU/L`, `conventional: µIU/mL`, `factor: 1`.

### Reference ranges and targets
| Source | Range / threshold |
|---|---|
| AACE/ATA 2012 (S64) | TSH is the screening test; treating TSH < 10 mIU/L is individual. (The commonly quoted 0.45–4.12 mIU/L NHANES range was not in the opened abstract; secondary only.) |
| Indian 8-city study (S65) | used TSH > 5.50 µIU/mL as its hypothyroid cut-off |
| Indian chain labs | typically 0.27–4.2 or 0.35–5.5 µIU/mL (assay dependent) |
| Indian pregnancy ranges | separate trimester ranges exist; out of scope (pregnancy is a clinician-first state) |

No adult Indian Thyroid Society reference interval was found. Decision (same as index): the app uses **the lab's printed range**; out-of-range is shown with "talk to a clinician" and the plan continues.

### How each lever moves it
Direction is the change in the marker when the lever is applied or increased. Rows with "— (mechanism only)" are best mechanistic expectations with no outcome data found; they are grade D and are **not** exported to the JSON interaction table.

| Lever | Direction | Effect size (unit; population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | – none | TSH unchanged (p = 0.27) after ≥ 3 weeks isocaloric keto (µIU/mL); healthy adults (n = 11) | 3 wk | Low insulin reduces T4→T3 conversion peripherally; pituitary set-point unaffected | B | S73 |
| Moderate low-carb | – none | no data | — | As VLC (expectation) | D | — (mechanism only) |
| High protein (≥ 1.6 g/kg) | – none | no data | — | No pathway | D | — (mechanism only) |
| Fasting 16:8 | – none | no data in euthyroid adults | — | Levothyroxine users must keep a fixed empty-stomach dose time; timing changes can shift TSH (expectation) | D | — (mechanism only) |
| Fasting 24 h | ↓ down | pooled fasting effect g = −0.58 (small); 60 h fast: TSH unchanged (SMD); adults, 10 studies | 84 h | Fasting lowers leptin and hypothalamic TRH | B | S69, S70 |
| Fasting 36–48 h | ↓ down | as above (SMD); adults | 84 h | As above | B | S69, S70 |
| Extended fast > 48 h | ↓ down | as above (SMD); adults | 1 wk | As above | B | S69 |
| Saturated fat | – none | no data | — | No pathway | D | — (mechanism only) |
| Dietary cholesterol / eggs | – none | no data | — | No pathway | D | — (mechanism only) |
| Fibre | – none | no data opened | — | High fibre near the dose can reduce levothyroxine absorption (not sourced this session) | D | — (mechanism only) |
| Unsaturated fats | – none | no data | — | No pathway | D | — (mechanism only) |
| Alcohol | – none | no data opened | — | Not established | D | — (mechanism only) |
| Caffeine (tea/coffee) | ↑ up | coffee with the dose cut levothyroxine absorption ~27–36 % (% absorption); women on levothyroxine | 6 wk | Coffee binds/sequesters T4 in the gut; TSH rises in treated users only | B | S77, S66 |
| Creatine | – none | no data | — | No pathway | D | — (mechanism only) |
| Whey / protein supplements | – none | no data | — | Dairy calcium near the dose (see supp:calcium) | D | — (mechanism only) |
| Large deficit (> 25 %) | – none | no TSH data for deficits as such | — | TSH tracks weight loss (below) more than the deficit | D | — (mechanism only) |
| Moderate deficit | – none | no data | — | As above | D | — (mechanism only) |
| Surplus | ↑ up | obese TSH 3.3 vs 2.1 µU/mL in lean controls (association) (µIU/mL); severe obesity | — | Leptin stimulates TRH; adipose inflammation | C | S105 |
| Resistance training load | – none | no data | — | No pathway | D | — (mechanism only) |
| Aerobic training load | – none | no data | — | Only via low energy availability (see fT3) | D | — (mechanism only) |
| Sleep debt | ↓ down | 14 days at 5.5 h: TSH modestly lower, mainly in women (µIU/mL); healthy adults (n = 11) | 2 wk | Partial sleep restriction blunts the nocturnal TSH surge (acute total loss acts differently) | C | S74 |
| Weight loss itself | ↓ down | 28 % loss: 2.33 → 1.82 µIU/mL; obese 3.3 → 2.1 after surgery (µIU/mL); bariatric patients | 52 wk | Falling leptin and fat mass | B | S67, S105 |
| Supplement `ashwagandha` | ↓ down | 8 weeks: TSH fell and T3/T4 rose vs placebo (µIU/mL); adults with subclinical hypothyroidism | 8 wk | Withanolides appear to stimulate thyroid hormone output; risk of over-treatment in people on levothyroxine | B | S78 |
| Supplement `calcium` | ↑ up | separate from levothyroxine (4 h is traditional, untested); levothyroxine users | 6 wk | Calcium carbonate binds T4 in the gut | B | S66 |
| Supplement `iron` | ↑ up | as calcium; levothyroxine users | 6 wk | Ferrous sulfate binds T4 | B | S66 |
| Supplement `multivitamin_low_energy` | ↓ down | 10 mg/day biotin: TSH falsely −34 % on Roche assays at 2 h; minimal on others (% (assay)); healthy adults (n = 13) | 0 h | Assay artefact (streptavidin–biotin), not a real change; 24 h washout | B | S79 |

### What it constrains in the plan
No rule bans anything; each is a cap, warning, re-ask, clinician note, retest prompt or preference. `{value}` and `{date}` are filled from the entered result.

| Rule id | When | Kind → target | Severity | Message | Grade | Sources |
|---|---|---|---|---|---|---|
| W-L-TSH-1 | outside lab range | clinician → `plan` | see-clinician | Because your TSH was {value} µIU/mL on {date}, outside your lab's range, please see a clinician. Your plan continues; it is not changed by this value. | B | S64, S65 |
| W-L-TSH-2 | > 10 µIU/mL and conditions.thyroidTreated == false | cap → `fasting` | caution | Because your TSH was {value} µIU/mL on {date} and you are not on treatment, fasts are kept to 24 hours or less until a clinician has seen it. | D | S64 |
| W-L-TSH-3 | any value and medications.levothyroxine == true | prefer → `caffeine` | info | Take levothyroxine with water 60 minutes before breakfast and coffee or tea; keep calcium and iron at least 4 hours away. | B | S66, S77 |
| W-L-TSH-4 | any value and supplements.ashwagandha == true | warn → `supp:ashwagandha` | caution | Ashwagandha can raise thyroid hormones. If you have a thyroid condition or take levothyroxine, check with your clinician first. | B | S78 |
| W-L-TSH-5 | any value and supplements.biotinHighDose == true | reask → `sampleContext` | info | High-dose biotin (hair and nail products) can make thyroid results wrong. Stop it at least 24 hours before your next blood test. | B | S79 |
| W-L-TSH-6 | outside lab range | retest → `tsh` = 8 | info | Repeat TSH in about 8 weeks, or as your clinician advises. | B | S66 |

### Clinician-only thresholds
| Threshold | Message | Sources |
|---|---|---|
| > 10 µIU/mL | TSH above 10 usually means an under-active thyroid that is treated. Please see a clinician. | S64 |
| < labLow µIU/mL | TSH below your lab's range can mean an over-active thyroid or too much thyroid medicine. Please see a clinician. | S64 |

### Retest interval
Out of range: repeat in **8 weeks** (steady state ~6 weeks after any change, S66). Levothyroxine users: 6–8 weeks after a dose change or after a big change in coffee/calcium/iron timing (S66). In range: no retest needed for planning (52 weeks).

### Indian-population notes
- 8 Indian cities: hypothyroidism 10.95 % (3.47 % previously undetected), subclinical 8.02 %, anti-TPO positive 21.85 %; women 15.9 % vs men 5.0 %; inland cities higher than coastal (S65).
- Universal salt iodisation has made iodine deficiency uncommon; the app does not push iodine supplements.
- Camp panels report **total** T3 and T4 plus TSH; free T3/T4 are separate tests.

### Sources
S64. Garber JR et al. 2012. Clinical practice guidelines for hypothyroidism in adults (AACE/ATA). Endocr Pract. PMID 23246686; doi:10.4158/EP12280.GL. <https://pubmed.ncbi.nlm.nih.gov/23246686/>. *Used for:* TSH is the best screening test; treating subclinical hypothyroidism with TSH <10 mIU/L is individual.
S65. Unnikrishnan AG et al. 2013. Prevalence of hypothyroidism in adults: epidemiological study in eight cities of India. Indian J Endocrinol Metab. PMID 23961480; doi:10.4103/2230-8210.113755. <https://pubmed.ncbi.nlm.nih.gov/23961480/>. *Used for:* Hypothyroidism 10.95 % (3.47 % undetected), subclinical 8.02 %, anti-TPO 21.85 %; cut-off TSH >5.50 µIU/mL.
S66. Jonklaas J et al. 2014. Guidelines for the treatment of hypothyroidism (ATA). Thyroid. PMID 25266247; doi:10.1089/thy.2014.0028. <https://pmc.ncbi.nlm.nih.gov/articles/PMC4267409/>. *Used for:* Steady-state TSH ~6 weeks after a change; separate levothyroxine from calcium and iron (4 h traditional, untested); espresso sequesters L-T4; take 60 min before breakfast.
S67. Tian Z et al. 2024. Thyroid function changes after bariatric surgery. Front Endocrinol. PMID 38352711; doi:10.3389/fendo.2024.1333033. <https://pubmed.ncbi.nlm.nih.gov/38352711/>. *Used for:* 28 % weight loss: TSH 2.33→1.82 µIU/mL, FT3 3.23→2.89 pg/mL, TT3 1.13→0.89 ng/mL.
S69. Ulupınar S et al. 2026. Fasting and thyroid hormones: meta-analysis of 15 studies. Front Endocrinol. PMID 42625622; doi:10.3389/fendo.2026.1876045. <https://pubmed.ncbi.nlm.nih.gov/42625622/>. *Used for:* FT3 g = −1.98, TSH g = −0.58, TT3 g = −1.34; FT4 unchanged.
S70. Merimee TJ, Fineberg ES. 1976. Starvation-induced alterations of circulating thyroid hormone concentrations in man. Metabolism. PMID 1246209; doi:10.1016/0026-0495(76)90162-1. <https://pubmed.ncbi.nlm.nih.gov/1246209/>. *Used for:* 60 h fast: total T3 −24 to −55 % (≈152→90 ng/dL women); TSH and T4 unchanged.
S73. Iacovides S et al. 2022. Could the ketogenic diet induce a shift in thyroid function? Isocaloric crossover. PLoS One. PMID 35658056; doi:10.1371/journal.pone.0269440. <https://pubmed.ncbi.nlm.nih.gov/35658056/>. *Used for:* Ketogenic: total T3 4.1 vs 4.8 pmol/L on HCLF; T4 up; TSH unchanged (n = 11, ≥3 weeks per arm).
S74. Kessler L et al. 2010. Changes in serum TSH and free T4 during prolonged sleep restriction. Sleep. PMID 20815195; doi:10.1093/sleep/33.8.1115. <https://pubmed.ncbi.nlm.nih.gov/20815195/>. *Used for:* 14 days at 5.5 h: TSH and FT4 modestly lower, mostly in women.
S77. Benvenga S et al. 2008. Altered intestinal absorption of L-thyroxine caused by coffee. Thyroid. PMID 18341376; doi:10.1089/thy.2007.0222. <https://pubmed.ncbi.nlm.nih.gov/18341376/>. *Used for:* Coffee cut levothyroxine absorption ~27–36 % (AUC).
S78. Sharma AK et al. 2018. Efficacy and safety of ashwagandha root extract in subclinical hypothyroid patients: RCT. J Altern Complement Med. PMID 28829155; doi:10.1089/acm.2017.0183. <https://pubmed.ncbi.nlm.nih.gov/28829155/>. *Used for:* 8 weeks: TSH fell, T3 and T4 rose vs placebo (p-values only).
S79. Ylli D et al. 2021. Biotin interference in assays for thyroid hormones, TSH and thyroglobulin. Thyroid. PMID 34042535; doi:10.1089/thy.2020.0866. <https://pmc.ncbi.nlm.nih.gov/articles/PMC8420951/>. *Used for:* 10 mg/day biotin: TSH falsely −34 %, total T3 +35 % on Roche at 2 h; 24 h washout.
S105. Juiz-Valiña P et al. 2019. Altered GH-IGF-1 axis and thyroid function in severe obesity and after bariatric surgery. Nutrients. PMID 31137484; doi:10.3390/nu11051121. <https://pubmed.ncbi.nlm.nih.gov/31137484/>. *Used for:* TSH 3.3 (obese) vs 2.1 µU/mL (controls); fell to 2.1 after surgery.

## Free triiodothyronine (free T3) (`ft3`)

### Physiology and what it reflects
T3 is the active thyroid hormone; about 80 % is made outside the thyroid by deiodinating T4. Deiodination falls quickly when carbohydrate and energy are short, so T3 drops and reverse T3 rises within 1–3 days of fasting (S70, S71) and when energy availability falls below ~25 kcal/kg lean mass/day (S75). This is an adaptation that saves energy, not thyroid disease: TSH and T4 stay normal. It reverses with refeeding (prompt recovery in military semistarvation, S88; human refeeding time course otherwise not found). With low testosterone and low energy availability it forms the REDs biomarker cluster (index §1.9). Short-term low energy availability does not always move T3 (S76), so a normal T3 does not rule out REDs.

### Units and conversions
Free T3: pg/mL × 1.536 = pmol/L (molecular weight 651; factor not read in a source). Total T3 (what Indian camp panels report): ng/dL × 0.01536 = nmol/L. Bariatric data report FT3 in pg/mL and TT3 in ng/mL (S67), so units vary by lab; the parser must keep free and total apart. JSON: `si: pmol/L`, `conventional: pg/mL`, `factor: 1.536`.

### Reference ranges and targets
No guideline target exists; labs print about 2.0–4.4 pg/mL (fT3) and 80–200 ng/dL (total T3), assay dependent. The app uses the lab's range and treats "low" as below the lower limit. No Indian reference interval was found (grade D for any Indian-specific statement).

### How each lever moves it
Direction is the change in the marker when the lever is applied or increased. Rows with "— (mechanism only)" are best mechanistic expectations with no outcome data found; they are grade D and are **not** exported to the JSON interaction table.

| Lever | Direction | Effect size (unit; population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | ↓ down | 800 kcal zero-carb 2 weeks: T3 −47 %; isocaloric keto: total T3 4.1 vs 4.8 pmol/L (% / pmol/L); obese adults; healthy adults | 1 wk | Low insulin and glucose cut type-1 deiodinase activity (T4→T3) | B | S71, S73 |
| Moderate low-carb | – none | no change in T3 with ≥ 50 g/day carbohydrate (hypocaloric) (%); obese adults | 2 wk | Enough carbohydrate preserves deiodination | C | S71 |
| High protein (≥ 1.6 g/kg) | – none | no data | — | No pathway independent of carbohydrate | D | — (mechanism only) |
| Fasting 16:8 | – none | no data | — | Daily refeeding expected to prevent a fall (expectation) | D | — (mechanism only) |
| Fasting 24 h | ↓ down | total T3 ≈ 152 → 131 ng/dL at 24 h (ng/dL); healthy women | 25 h | Deiodinase falls with glycogen depletion | B | S70 |
| Fasting 36–48 h | ↓ down | total T3 −24 to −55 % by 60 h; pooled fasting FT3 g = −1.98 (% / SMD); healthy adults | 50 h | As above; reverse T3 rises | B | S70, S69 |
| Extended fast > 48 h | ↓ down | 7–18 days total fast: T3 −53 %, rT3 +58 % (%); obese adults | 1 wk | As above | B | S71 |
| Saturated fat | – none | no data | — | No pathway | D | — (mechanism only) |
| Dietary cholesterol / eggs | – none | no data | — | No pathway | D | — (mechanism only) |
| Fibre | – none | no data | — | No pathway | D | — (mechanism only) |
| Unsaturated fats | – none | no data | — | No pathway | D | — (mechanism only) |
| Alcohol | – none | no data opened | — | Not established | D | — (mechanism only) |
| Caffeine (tea/coffee) | – none | no data | — | No pathway in euthyroid people | D | — (mechanism only) |
| Creatine | – none | no data | — | No pathway | D | — (mechanism only) |
| Whey / protein supplements | – none | no data | — | No pathway | D | — (mechanism only) |
| Large deficit (> 25 %) | ↓ down | T3 −16 %, fT3 −9 % when EA fell below ~25 kcal/kg LBM/day for 4 days; 8-week military deficit lowered T3 to near/below normal (%); exercising women; lean men | 101 h | Energy sensing (leptin, insulin) cuts T4→T3 conversion | B | S75, S88 |
| Moderate deficit | – none | no T3 change at EA ≥ 25 kcal/kg LBM/day; T3 stable in most short LEA studies (%); exercising women; athletes | 1 wk | Above the threshold, conversion is preserved | C | S75, S76 |
| Surplus | ↑ up | 3 weeks overfeeding raised T3 (%); healthy adults | 3 wk | Carbohydrate and energy raise deiodination | B | S72 |
| Resistance training load | – none | no data | — | Only via energy availability | D | — (mechanism only) |
| Aerobic training load | ↓ down | only when exercise drives EA below ~25 kcal/kg LBM (%); exercising women | 101 h | Low energy availability, not exercise itself | C | S75 |
| Sleep debt | – none | no T3 data opened | — | Partial sleep loss lowered TSH and FT4 modestly (S74); T3 not reported | D | S74 |
| Weight loss itself | ↓ down | 28 % loss: FT3 3.23 → 2.89 pg/mL; weight-loss meta-analysis FT3 lower, more with diet than surgery (pg/mL); bariatric and dieting adults | 26 wk | Smaller body and lower leptin | B | S67, S68 |
| Supplement `ashwagandha` | ↑ up | T3 rose vs placebo over 8 weeks; subclinical hypothyroid adults | 8 wk | Thyroid-stimulating effect of withanolides | B | S78 |
| Supplement `multivitamin_low_energy` | ↑ up | 10 mg/day biotin: total T3 falsely +35 % on Roche assays (% (assay)); healthy adults | 0 h | Assay artefact; 24 h washout | B | S79 |

### What it constrains in the plan
No rule bans anything; each is a cap, warning, re-ask, clinician note, retest prompt or preference. `{value}` and `{date}` are filled from the entered result.

| Rule id | When | Kind → target | Severity | Message | Grade | Sources |
|---|---|---|---|---|---|---|
| W-L-FT3-1 | < labLow pg/mL and energyAvailability < 30 | warn → `deficit_large` | caution | Because your free T3 was {value} pg/mL on {date}, low, while your energy intake is very low for your training, Vitals suggests a 1–2 week diet break at maintenance. | B | S75, S88 |
| W-L-FT3-2 | < labLow pg/mL and plan.fastOrVlcActive == true | warn → `fasting` | info | Your free T3 was {value} pg/mL on {date}. T3 falls during fasting and very-low-carb eating to save energy; this is expected and reverses when you eat normally. | B | S70, S71, S73 |
| W-L-FT3-3 | < labLow pg/mL and testosterone < 300 ng/dL | cap → `deficit_large` | caution | Because your free T3 ({value} pg/mL) and testosterone were both low on {date}, your deficit is capped at moderate and a diet break is scheduled. | C | S88, S75 |
| W-L-FT3-4 | any value and import.t3Kind == unknown | reask → `ft3` | info | Is this free T3 or total T3? Reports from camp panels usually show total T3 (in ng/dL). | D | S67 |
| W-L-FT3-5 | < labLow pg/mL | retest → `ft3` = 4 | info | Recheck free T3 about 4 weeks after a diet break or return to maintenance, not during a fast. | D | S88 |

### Clinician-only thresholds
| Threshold | Message | Sources |
|---|---|---|
| > labHigh pg/mL | Free T3 above your lab's range can mean an over-active thyroid. Please see a clinician. | S64 |

### Retest interval
Low during a deficit or fast: recheck **4 weeks** after a diet break or return to maintenance (S88 shows recovery on refeeding; interval grade D). Not useful to retest during an ongoing fast. JSON default 4.

### Indian-population notes
- Indian camp panels report total T3 ("TOTAL TRIIODOTHYRONINE (T3)", ng/dL) not free T3; free T3 is usually a separate order. The map must not merge them (index decision 1.5 d).
- No Indian data on T3 under fasting or Ramadan in healthy adults were found: grade D for population-specific magnitudes; the mechanism (deiodinase response to carbohydrate and energy) is expected to transfer.

### Sources
S64. Garber JR et al. 2012. Clinical practice guidelines for hypothyroidism in adults (AACE/ATA). Endocr Pract. PMID 23246686; doi:10.4158/EP12280.GL. <https://pubmed.ncbi.nlm.nih.gov/23246686/>. *Used for:* TSH is the best screening test; treating subclinical hypothyroidism with TSH <10 mIU/L is individual.
S67. Tian Z et al. 2024. Thyroid function changes after bariatric surgery. Front Endocrinol. PMID 38352711; doi:10.3389/fendo.2024.1333033. <https://pubmed.ncbi.nlm.nih.gov/38352711/>. *Used for:* 28 % weight loss: TSH 2.33→1.82 µIU/mL, FT3 3.23→2.89 pg/mL, TT3 1.13→0.89 ng/mL.
S68. Nayak et al. 2025. Weight loss and thyroid hormones: meta-analysis. Ann Med Surg. PMID 40852024; doi:10.1097/MS9.0000000000003428. <https://pubmed.ncbi.nlm.nih.gov/40852024/>. *Used for:* Weight loss lowers FT3, larger with dietary restriction than surgery.
S69. Ulupınar S et al. 2026. Fasting and thyroid hormones: meta-analysis of 15 studies. Front Endocrinol. PMID 42625622; doi:10.3389/fendo.2026.1876045. <https://pubmed.ncbi.nlm.nih.gov/42625622/>. *Used for:* FT3 g = −1.98, TSH g = −0.58, TT3 g = −1.34; FT4 unchanged.
S70. Merimee TJ, Fineberg ES. 1976. Starvation-induced alterations of circulating thyroid hormone concentrations in man. Metabolism. PMID 1246209; doi:10.1016/0026-0495(76)90162-1. <https://pubmed.ncbi.nlm.nih.gov/1246209/>. *Used for:* 60 h fast: total T3 −24 to −55 % (≈152→90 ng/dL women); TSH and T4 unchanged.
S71. Spaulding SW et al. 1976. Effect of caloric restriction and dietary composition on serum T3 and reverse T3 in man. J Clin Endocrinol Metab. PMID 1249190; doi:10.1210/jcem-42-1-197. <https://pubmed.ncbi.nlm.nih.gov/1249190/>. *Used for:* Total fast 7–18 d: T3 −53 %, rT3 +58 %; 800 kcal zero-carb 2 wk: T3 −47 %; ≥50 g carbohydrate: no change.
S72. Danforth E et al. 1979. Dietary-induced alterations in thyroid hormone metabolism during overnutrition. J Clin Invest. PMID 500814; doi:10.1172/JCI109590. <https://pubmed.ncbi.nlm.nih.gov/500814/>. *Used for:* 3 weeks overfeeding raised T3; carbohydrate-restricted hypocaloric diets mimic fasting.
S73. Iacovides S et al. 2022. Could the ketogenic diet induce a shift in thyroid function? Isocaloric crossover. PLoS One. PMID 35658056; doi:10.1371/journal.pone.0269440. <https://pubmed.ncbi.nlm.nih.gov/35658056/>. *Used for:* Ketogenic: total T3 4.1 vs 4.8 pmol/L on HCLF; T4 up; TSH unchanged (n = 11, ≥3 weeks per arm).
S74. Kessler L et al. 2010. Changes in serum TSH and free T4 during prolonged sleep restriction. Sleep. PMID 20815195; doi:10.1093/sleep/33.8.1115. <https://pubmed.ncbi.nlm.nih.gov/20815195/>. *Used for:* 14 days at 5.5 h: TSH and FT4 modestly lower, mostly in women.
S75. Loucks AB, Heath EM. 1994. Induction of low-T3 syndrome in exercising women occurs at a threshold of energy availability. Am J Physiol. PMID 8160876; doi:10.1152/ajpregu.1994.266.3.R817. <https://pubmed.ncbi.nlm.nih.gov/8160876/>. *Used for:* T3 −16 %, fT3 −9 % abruptly between EA 25 and 19 kcal/kg LBM/day over 4 days.
S76. Guisado-Cuadrado I et al. 2026. Short-term low energy availability and hormones: systematic review. Scand J Med Sci Sports. PMID 41794545; doi:10.1111/sms.70249. <https://pubmed.ncbi.nlm.nih.gov/41794545/>. *Used for:* 13 studies: leptin fell consistently, T3 stable in most.
S78. Sharma AK et al. 2018. Efficacy and safety of ashwagandha root extract in subclinical hypothyroid patients: RCT. J Altern Complement Med. PMID 28829155; doi:10.1089/acm.2017.0183. <https://pubmed.ncbi.nlm.nih.gov/28829155/>. *Used for:* 8 weeks: TSH fell, T3 and T4 rose vs placebo (p-values only).
S79. Ylli D et al. 2021. Biotin interference in assays for thyroid hormones, TSH and thyroglobulin. Thyroid. PMID 34042535; doi:10.1089/thy.2020.0866. <https://pmc.ncbi.nlm.nih.gov/articles/PMC8420951/>. *Used for:* 10 mg/day biotin: TSH falsely −34 %, total T3 +35 % on Roche at 2 h; 24 h washout.
S88. Friedl KE et al. 2000. Endocrine markers of semistarvation in healthy lean men in a multistressor environment. J Appl Physiol. PMID 10797147; doi:10.1152/jappl.2000.88.5.1820. <https://pubmed.ncbi.nlm.nih.gov/10797147/>. *Used for:* 8 weeks at 1000–1200 kcal/day deficit plus stressors: T and T3 to near or below normal; prompt recovery on refeeding.

## Total testosterone (men) (`testosterone`)

### Physiology and what it reflects
Testosterone is made by Leydig cells under LH drive; it peaks in the morning and falls with age, obesity, illness, sleep loss and energy deficit. Low values in dieters, soldiers and athletes are usually **functional**: central (hypothalamic) suppression that reverses with refeeding (S88, S89), not testicular failure. Obesity lowers it through insulin resistance and low SHBG, and weight loss raises it (S87). Because it varies day to day, guidelines diagnose deficiency only with symptoms and two low fasting morning values (S80, S82). Women: the app does not interpret testosterone; menstrual status (W-E18) is the better signal (index §1.9).

### Units and conversions
Indian labs print ng/dL (CLIA). nmol/L = ng/dL × 0.0347 (264 ng/dL = 9.2 nmol/L). Some print ng/mL (× 100 = ng/dL). JSON: `si: nmol/L`, `conventional: ng/dL`, `factor: 0.0347`.

### Reference ranges and targets
| Source | Value |
|---|---|
| Harmonised reference, non-obese men 19–39 y (S81) | 264–916 ng/dL (2.5th–97.5th percentile) |
| Endocrine Society 2018 (S80) | symptoms + unequivocally and consistently low fasting morning total T |
| AUA 2018 (S82) | < 300 ng/dL on two early-morning tests, same lab |

No Indian adult reference interval was found (an unsourced web figure was discarded). The app uses 264 ng/dL as "low" and 300 ng/dL as the AUA support line; it never diagnoses.

### How each lever moves it
Direction is the change in the marker when the lever is applied or increased. Rows with "— (mechanism only)" are best mechanistic expectations with no outcome data found; they are grade D and are **not** exported to the JSON interaction table.

| Lever | Direction | Effect size (unit; population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | ↕ mixed | isocaloric keto in trained men: +118 vs −36 ng/dL (10–11 wk); high-protein (≥ 35 %E) low-carb: −5.23 nmol/L (ng/dL; nmol/L); resistance-trained men; men in diet trials | 10 wk | Fat intake supports steroidogenesis; very high protein with low carbohydrate lowers T by an unclear route | B | S86, S84 |
| Moderate low-carb | – none | no separate estimate | — | As VLC with smaller dose (expectation) | D | — (mechanism only) |
| High protein (≥ 1.6 g/kg) | – none | no consistent effect at 1.25–3.4 g/kg/day; lower above ~3.4 g/kg (nmol/L); men | 8 wk | Possibly via reduced carbohydrate and hepatic adaptations; the app's 1.6–2.2 g/kg is below the effect zone | C | S85, S84 |
| Fasting 16:8 | ↕ mixed | 16:8 in trained men: T fell (size not reported); meta-analysis total T −0.88 ng/mL (ns), free T −4.9 pg/mL (ng/mL; pg/mL); resistance-trained men; adults | 8 wk | Energy deficit and LH pulsatility | B | S90, S91 |
| Fasting 24 h | – none | no data | — | Expected small (expectation) | D | — (mechanism only) |
| Fasting 36–48 h | ↓ down | 3.5-day fast cut LH production 2.1-fold in young men (T not in abstract) (LH); young men | 84 h | Fasting suppresses GnRH/LH pulses | C | S104 |
| Extended fast > 48 h | ↓ down | as above (LH); young men | 84 h | As above | C | S104 |
| Saturated fat | ↑ up | low-fat vs higher-fat diets: total T SMD −0.38 (−0.75 to −0.01) (SMD); men, 6 studies (n = 206) | 4 wk | Dietary fat (total, not specifically SFA) supports steroidogenesis; mechanism uncertain | C | S83 |
| Dietary cholesterol / eggs | – none | no data | — | Cholesterol is the steroid precursor, but synthesis is not substrate-limited (expectation) | D | — (mechanism only) |
| Fibre | – none | no data | — | No pathway | D | — (mechanism only) |
| Unsaturated fats | ↑ up | part of the same low-fat comparison (SMD); men | 4 wk | As satfat | C | S83 |
| Alcohol | ↓ down | no primary study opened | — | Heavy alcohol is toxic to Leydig cells (not sourced this session) | D | — (mechanism only) |
| Caffeine (tea/coffee) | – none | no data | — | No pathway | D | — (mechanism only) |
| Creatine | – none | DHT +56 %, DHT:T ratio +36 %; T itself not shown changed (%); rugby players (n = 20) | 3 wk | Unclear; single small trial, not replicated | C | S93 |
| Whey / protein supplements | – none | no data | — | As high protein | D | — (mechanism only) |
| Large deficit (> 25 %) | ↓ down | 8 weeks at 1000–1200 kcal/day deficit: T to near/below normal; contest prep 922 → 227 ng/dL (ng/dL); lean men; one bodybuilder | 8 wk | Low leptin and insulin suppress GnRH/LH; reverses with refeeding | B | S88, S89 |
| Moderate deficit | – none | caloric restriction: no meaningful T change (pooled) (ng/mL); adults | 8 wk | Above a threshold, the axis is preserved | C | S91 |
| Surplus | – none | no data | — | Fat gain lowers T over time (expectation, inverse of S87) | D | — (mechanism only) |
| Resistance training load | – none | no source opened for chronic resting T | — | Acute post-exercise rise is transient (not sourced) | D | — (mechanism only) |
| Aerobic training load | ↓ down | only with energy deficit and other stressors (ng/dL); lean men under multistress | 8 wk | Functional central suppression | D | S88 |
| Sleep debt | ↓ down | −10 to −15 % daytime T after 1 week at ~5 h/night (%); young healthy men (n = 10) | 1 wk | Testosterone is secreted mainly during sleep | B | S92 |
| Weight loss itself | ↑ up | +2.87 nmol/L (diet), +8.73 nmol/L (bariatric) (nmol/L); obese men, 24 trials | 26 wk | Less insulin resistance, more SHBG, less aromatase | A | S87 |
| Supplement `vitamin_d3` | ↕ mixed | +2.7 nmol/L over 1 year in deficient men losing weight; no effect in men with low T over 12 weeks (nmol/L); men | 52 wk | Unclear; probably only in deficiency | C | S94, S95 |
| Supplement `ashwagandha` | ↕ mixed | T rose in men but not significantly vs placebo; stressed adults (60 days) | 8 wk | Possible via lower cortisol | C | S96 |
| Supplement `creatine_monohydrate` | – none | as creatine (%); rugby players | 3 wk | As creatine | C | S93 |

### What it constrains in the plan
No rule bans anything; each is a cap, warning, re-ask, clinician note, retest prompt or preference. `{value}` and `{date}` are filled from the entered result.

| Rule id | When | Kind → target | Severity | Message | Grade | Sources |
|---|---|---|---|---|---|---|
| W-L-TESTOSTERONE-1 | < 264 ng/dL | retest → `testosterone` = 4 | info | Your testosterone was {value} ng/dL on {date}. One value is not enough: repeat a fasting test before 10 am within 4 weeks, at the same lab. | A | S80, S82 |
| W-L-TESTOSTERONE-2 | < 264 ng/dL, confirmed on a repeat test | clinician → `plan` | see-clinician | Your testosterone has been below 264 ng/dL on two morning tests ({date}). Please see a clinician. | A | S80, S81, S82 |
| W-L-TESTOSTERONE-3 | < 300 ng/dL and deficitPct > 25 | cap → `deficit_large` | caution | Because your testosterone was {value} ng/dL on {date} during a large deficit, the deficit is capped at moderate and a diet break is suggested; this usually recovers with more food. | B | S88, S89 |
| W-L-TESTOSTERONE-4 | < 300 ng/dL and sleepHours < 6 | warn → `sleep_debt` | caution | Because your testosterone was {value} ng/dL on {date} and you sleep under 6 hours, sleep is the first lever: one week of 5-hour nights lowers it 10–15 %. | B | S92 |
| W-L-TESTOSTERONE-5 | < 300 ng/dL | cap → `highprotein` = 3.4 | info | Because your testosterone was {value} ng/dL on {date}, protein stays at or below 3.4 g/kg and very-low-carb plans keep enough fat. | C | S85, S84, S83 |
| W-L-TESTOSTERONE-6 | < 300 ng/dL and bmi >= 27 | prefer → `weight_loss` | info | Because your testosterone was {value} ng/dL on {date}, losing weight is the lever most likely to raise it (about +3 nmol/L with diet). | A | S87 |

### Clinician-only thresholds
| Threshold | Message | Sources |
|---|---|---|
| < 264 ng/dL | Testosterone below 264 ng/dL on two morning tests needs a clinician, especially with low libido, low energy or loss of morning erections. | S80, S81, S82 |

### Retest interval
Low value: repeat a fasting sample before 10 am within **4 weeks**, same lab (S80, S82). After a diet break or the end of a large deficit: **8–12 weeks** (recovery after contest prep took months, S89). JSON default 4.

### Indian-population notes
- Indian prediabetic men: 38.8 % hypogonadal vs 25.2 % of normoglycaemic men (S108); obesity and diabetes are the main drivers in India as elsewhere.
- No population reference interval for Indian men was found (grade D for any claim that Indian ranges differ).
- Lab layout: "TESTOSTERONE TOTAL", ng/dL, often an age-banded range.

### Sources
S80. Bhasin S et al. 2018. Testosterone therapy in men with hypogonadism: Endocrine Society guideline. J Clin Endocrinol Metab. PMID 29562364; doi:10.1210/jc.2018-00229. <https://pubmed.ncbi.nlm.nih.gov/29562364/>. *Used for:* Diagnose only with symptoms and unequivocally, consistently low fasting morning total T.
S81. Travison TG et al. 2017. Harmonized reference ranges for circulating testosterone levels in men of four cohort studies. J Clin Endocrinol Metab. PMID 28324103; doi:10.1210/jc.2016-2935. <https://pubmed.ncbi.nlm.nih.gov/28324103/>. *Used for:* Non-obese men 19–39 y: 2.5th–97.5th percentile 264–916 ng/dL.
S82. Mulhall JP et al. 2018. Evaluation and management of testosterone deficiency: AUA guideline. J Urol. PMID 29601923; doi:10.1016/j.juro.2018.03.115. <https://www.auanet.org/guidelines-and-quality/guidelines/testosterone-deficiency-guideline>. *Used for:* <300 ng/dL supports diagnosis; two early-morning measurements, same lab.
S83. Whittaker J, Wu K. 2021. Low-fat diets and testosterone in men: systematic review and meta-analysis. J Steroid Biochem Mol Biol. PMID 33741447; doi:10.1016/j.jsbmb.2021.105878. <https://pubmed.ncbi.nlm.nih.gov/33741447/>. *Used for:* Low-fat vs higher-fat: total T SMD −0.38 (−0.75 to −0.01), 6 studies, 206 men.
S84. Whittaker J, Harris M. 2022. Low-carbohydrate diets and men's cortisol and testosterone: systematic review and meta-analysis. Nutr Health. PMID 35254136; doi:10.1177/02601060221083079; PMC9716400. <https://pmc.ncbi.nlm.nih.gov/articles/PMC9716400>. *Used for:* High-protein (≥35 %E) low-carb: resting total T −5.23 nmol/L; short-term low-carb cortisol SMD +0.41, back to baseline after ~3 weeks.
S85. Whittaker J. 2023. High-protein diets and testosterone. Nutr Health. PMID 36266956; doi:10.1177/02601060221132922; PMC10114259. <https://pubmed.ncbi.nlm.nih.gov/36266956/>. *Used for:* No consistent T effect at 1.25–3.4 g/kg/day; lower T above ~3.4 g/kg/day.
S86. Wilson JM et al. 2017/2020. Effects of ketogenic dieting on body composition, strength, power, and hormonal profiles in resistance training men. J Strength Cond Res. PMID 28399015; doi:10.1519/JSC.0000000000001935. <https://pubmed.ncbi.nlm.nih.gov/28399015/>. *Used for:* Isocaloric keto vs Western 10–11 weeks: total T +118 vs −36 ng/dL (n = 25).
S87. Corona G et al. 2013. Body weight loss reverts obesity-associated hypogonadotropic hypogonadism: meta-analysis. Eur J Endocrinol. PMID 23482592; doi:10.1530/EJE-12-0955. <https://pubmed.ncbi.nlm.nih.gov/23482592/>. *Used for:* Low-calorie diet +2.87 nmol/L, bariatric +8.73 nmol/L total T; weight lost is the main determinant.
S88. Friedl KE et al. 2000. Endocrine markers of semistarvation in healthy lean men in a multistressor environment. J Appl Physiol. PMID 10797147; doi:10.1152/jappl.2000.88.5.1820. <https://pubmed.ncbi.nlm.nih.gov/10797147/>. *Used for:* 8 weeks at 1000–1200 kcal/day deficit plus stressors: T and T3 to near or below normal; prompt recovery on refeeding.
S89. Rossow LM et al. 2013. Natural bodybuilding competition preparation and recovery: a 12-month case study. Int J Sports Physiol Perform. PMID 23412685. <https://pubmed.ncbi.nlm.nih.gov/23412685/>. *Used for:* One man, 6 months prep: T 922→227 ng/dL, recovered to 991 after.
S90. Moro T et al. 2016. Effects of eight weeks of time-restricted feeding (16/8) on basal metabolism, strength and risk factors in resistance-trained males. J Transl Med. PMID 27737674; doi:10.1186/s12967-016-1044-0. <https://pubmed.ncbi.nlm.nih.gov/27737674/>. *Used for:* T and IGF-1 fell with 16:8 (magnitude not in abstract); strength kept.
S91. Ghoreishy SM et al. 2026. Fasting and testosterone: meta-analysis. Food Sci Nutr. PMID 42434325; doi:10.1002/fsn3.72078. <https://pubmed.ncbi.nlm.nih.gov/42434325/>. *Used for:* Intermittent fasting: total T WMD −0.88 ng/mL (ns); free T −4.9 pg/mL; CR no meaningful effect.
S92. Leproult R, Van Cauter E. 2011. Effect of 1 week of sleep restriction on testosterone levels in young healthy men. JAMA. PMID 21632481; doi:10.1001/jama.2011.710. <https://pubmed.ncbi.nlm.nih.gov/21632481/>. *Used for:* ~5 h/night for 1 week: daytime T −10 to −15 %.
S93. van der Merwe J et al. 2009. Three weeks of creatine monohydrate supplementation affects dihydrotestosterone to testosterone ratio in college-aged rugby players. Clin J Sport Med. PMID 19741313; doi:10.1097/JSM.0b013e3181b8b52f. <https://pubmed.ncbi.nlm.nih.gov/19741313/>. *Used for:* DHT +56 % after loading, DHT:T +36 %.
S94. Pilz S et al. 2011. Effect of vitamin D supplementation on testosterone levels in men. Horm Metab Res. PMID 21154195; doi:10.1055/s-0030-1269854. <https://pubmed.ncbi.nlm.nih.gov/21154195/>. *Used for:* 83 µg/day for 1 year in deficient men on weight loss: T 10.7→13.4 nmol/L.
S95. Lerchbaum E et al. 2019. Effects of vitamin D supplementation on androgens in men with low testosterone. Eur J Nutr. PMID 30460609; doi:10.1007/s00394-018-1858-z. <https://pubmed.ncbi.nlm.nih.gov/30460609/>. *Used for:* 20 000 IU/week for 12 weeks: no effect on total T.
S96. Lopresti AL et al. 2019. An investigation into the stress-relieving and pharmacological actions of an ashwagandha extract. Medicine (Baltimore). PMID 31517876; doi:10.1097/MD.0000000000017186. <https://pubmed.ncbi.nlm.nih.gov/31517876/>. *Used for:* 240 mg/day 60 days: lower morning cortisol; T rose in men but not significantly vs placebo.
S104. Bergendahl M et al. 1998. Fasting suppresses pulsatile LH secretion and enhances orderliness of LH release in young but not older men. J Clin Endocrinol Metab. PMID 9626127; doi:10.1210/jcem.83.6.4856. <https://pubmed.ncbi.nlm.nih.gov/9626127/>. *Used for:* 3.5-day fast: 24-h cortisol +40 % (young), +47 % (older); LH production −2.1-fold in young men.
S108. Gupta H et al. 2026. Hypogonadism and erectile dysfunction in prediabetic men. Indian J Endocrinol Metab. PMID 41918609; doi:10.4103/ijem.ijem_842_25. <https://pubmed.ncbi.nlm.nih.gov/41918609/>. *Used for:* Indian prediabetic men 38.8 % hypogonadal vs 25.2 % euglycaemic.

## Morning serum cortisol (`cortisol`)

### Physiology and what it reflects
Cortisol follows a steep daily rhythm (peak shortly after waking, low at midnight) and rises acutely with stress, illness, hard exercise above ~60 % VO2max (S103), fasting (S104), calorie restriction (S99), sleep loss (S100) and caffeine (S101). Total cortisol also rises with oestrogen and oral contraceptives through binding globulin (classic teaching, not sourced this session). A single morning value therefore says little about "stress" or diet tolerance; it is clinically useful only at the extremes: very low suggests adrenal insufficiency (S97), and morning cortisol is not a screening test for Cushing's (S98). Decision (same as index): **shown only, never planned on**, except a clinician note at the low extreme.

### Units and conversions
Indian labs print µg/dL (CLIA). nmol/L = µg/dL × 27.59 (5 µg/dL ≈ 140 nmol/L, 18 µg/dL ≈ 500 nmol/L, S97). JSON: `si: nmol/L`, `conventional: µg/dL`, `factor: 27.59`.

### Reference ranges and targets
| Source | Value |
|---|---|
| Endocrine Society PAI 2016 (S97) | morning cortisol < 5 µg/dL (140 nmol/L) with ACTH suggests adrenal insufficiency; stimulated peak < 18 µg/dL (500 nmol/L) confirms (assay dependent) |
| Endocrine Society Cushing's 2008 (S98) | screen with urine free cortisol, late-night salivary cortisol or dexamethasone suppression, not a morning serum value |
| Indian labs | typically 6.2–19.4 µg/dL (8–10 am), assay dependent; not verified in a source |

### How each lever moves it
Direction is the change in the marker when the lever is applied or increased. Rows with "— (mechanism only)" are best mechanistic expectations with no outcome data found; they are grade D and are **not** exported to the JSON interaction table.

| Lever | Direction | Effect size (unit; population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto | ↑ up | short-term low-carb: cortisol SMD +0.41 (0.16–0.66), back to baseline after ~3 weeks (SMD); men | 3 wk | Lower glucose availability raises counter-regulatory cortisol until fat adaptation | B | S84 |
| Moderate low-carb | ↑ up | included in the same meta-analysis (SMD); men | 3 wk | As VLC | C | S84 |
| High protein (≥ 1.6 g/kg) | – none | no data | — | No pathway | D | — (mechanism only) |
| Fasting 16:8 | – none | no data opened | — | Daily rhythm may shift with meal timing (expectation) | D | — (mechanism only) |
| Fasting 24 h | ↑ up | no 24 h data; 3.5-day fast +40–47 % (%); men | 25 h | Gluconeogenic counter-regulation (expectation for 24 h: smaller) | D | S104 |
| Fasting 36–48 h | ↑ up | 24-h mean cortisol +40 % (young), +47 % (older) over 3.5 days (%); healthy men | 84 h | Counter-regulation to support glucose output | B | S104 |
| Extended fast > 48 h | ↑ up | as above (%); healthy men | 84 h | As above | B | S104 |
| Saturated fat | – none | no data | — | No pathway | D | — (mechanism only) |
| Dietary cholesterol / eggs | – none | no data | — | No pathway | D | — (mechanism only) |
| Fibre | – none | no data | — | No pathway | D | — (mechanism only) |
| Unsaturated fats | – none | no data | — | No pathway | D | — (mechanism only) |
| Alcohol | ↑ up | no source opened | — | Heavy use causes pseudo-Cushing's (not sourced this session) | D | — (mechanism only) |
| Caffeine (tea/coffee) | ↑ up | robust rise after abstinence; reduced but not eliminated at 300–600 mg/day (%); adults (n = 96) | 0 h | Adenosine antagonism activates the HPA axis; partial tolerance | B | S101 |
| Creatine | – none | no data | — | No pathway | D | — (mechanism only) |
| Whey / protein supplements | – none | no data | — | No pathway | D | — (mechanism only) |
| Large deficit (> 25 %) | ↑ up | 1200 kcal/day for 3 weeks raised total cortisol output; women (n = 121) | 3 wk | Energy restriction is a physiological stressor | B | S99 |
| Moderate deficit | – none | no data | — | Expected smaller (expectation) | D | — (mechanism only) |
| Surplus | – none | no data | — | No pathway | D | — (mechanism only) |
| Resistance training load | ↑ up | no RT-specific source opened | — | Acute rise with high-volume sessions (expectation) | D | — (mechanism only) |
| Aerobic training load | ↑ up | 30 min at 40/60/80 % VO2max: +5.7/+39.9/+83.1 % (%); men (n = 12) | 0 h | Intensity threshold near 60 % VO2max | B | S103 |
| Sleep debt | ↑ up | evening cortisol +37 % (partial) and +45 % (total sleep loss) (%); healthy adults | 25 h | Delayed HPA quiescence | B | S100 |
| Weight loss itself | – none | no data | — | Not established | D | — (mechanism only) |
| Supplement `ashwagandha` | ↓ down | serum cortisol reduced vs placebo (P = 0.0006); lower morning cortisol in a second RCT; stressed adults, 60 days | 8 wk | Adaptogen effect on the HPA axis (mechanism uncertain) | B | S102, S96 |
| Supplement `caffeine` | ↑ up | as caffeine (%); adults | 0 h | As caffeine | B | S101 |

### What it constrains in the plan
No rule bans anything; each is a cap, warning, re-ask, clinician note, retest prompt or preference. `{value}` and `{date}` are filled from the entered result.

| Rule id | When | Kind → target | Severity | Message | Grade | Sources |
|---|---|---|---|---|---|---|
| W-L-CORTISOL-1 | < 5 µg/dL | clinician → `plan` | stop-and-see | Because your morning cortisol was {value} µg/dL on {date}, very low, please see a clinician soon. Fasting is paused until then. | A | S97 |
| W-L-CORTISOL-2 | < 5 µg/dL | cap → `fasting` = 12 | caution | Because your morning cortisol was {value} µg/dL on {date}, fasts are capped at 12 hours until a clinician has reviewed it. | D | S97 |
| W-L-CORTISOL-3 | any value | warn → `display` | info | A single morning cortisol changes with sleep, caffeine, fasting and exercise, so Vitals shows it but does not plan on it. | B | S98, S100, S101, S104 |
| W-L-CORTISOL-4 | > labHigh µg/dL | reask → `sampleContext` | info | Was the sample taken after poor sleep, a fast, coffee, hard exercise, or while on steroid medicines or the pill? All raise cortisol. | B | S100, S101, S103, S104 |

### Clinician-only thresholds
| Threshold | Message | Sources |
|---|---|---|
| < 5 µg/dL | A morning cortisol below 5 µg/dL can mean the adrenal glands are not making enough. Please see a clinician soon, before any fasting. | S97 |
| > labHigh µg/dL | A high morning cortisol on its own is not a diagnosis. If your doctor ordered it, discuss it with them. | S98 |

### Retest interval
None for planning. If < 5 µg/dL or flagged by the lab: clinician (repeat is their decision). JSON retestWeeks: null.

### Indian-population notes
- No Indian population data were sought or found; the marker is rarely on camp panels and is shown only.
- Ashwagandha, a common Indian supplement, lowers measured cortisol (S102, S96); users should say so when a value is reviewed.

### Sources
S84. Whittaker J, Harris M. 2022. Low-carbohydrate diets and men's cortisol and testosterone: systematic review and meta-analysis. Nutr Health. PMID 35254136; doi:10.1177/02601060221083079; PMC9716400. <https://pmc.ncbi.nlm.nih.gov/articles/PMC9716400>. *Used for:* High-protein (≥35 %E) low-carb: resting total T −5.23 nmol/L; short-term low-carb cortisol SMD +0.41, back to baseline after ~3 weeks.
S96. Lopresti AL et al. 2019. An investigation into the stress-relieving and pharmacological actions of an ashwagandha extract. Medicine (Baltimore). PMID 31517876; doi:10.1097/MD.0000000000017186. <https://pubmed.ncbi.nlm.nih.gov/31517876/>. *Used for:* 240 mg/day 60 days: lower morning cortisol; T rose in men but not significantly vs placebo.
S97. Bornstein SR et al. 2016. Diagnosis and treatment of primary adrenal insufficiency: Endocrine Society guideline. J Clin Endocrinol Metab. doi:10.1210/jc.2015-1710; PMC4880116. <https://pmc.ncbi.nlm.nih.gov/articles/PMC4880116/>. *Used for:* Morning cortisol <140 nmol/L (5 µg/dL) with ACTH suggests adrenal insufficiency; stimulated peak <500 nmol/L (18 µg/dL) confirms (assay dependent).
S98. Nieman LK et al. 2008. The diagnosis of Cushing's syndrome: Endocrine Society guideline. J Clin Endocrinol Metab. PMID 18334580; doi:10.1210/jc.2008-0125. <https://pubmed.ncbi.nlm.nih.gov/18334580/>. *Used for:* Screen with urine free cortisol, late-night salivary cortisol or dexamethasone suppression; not a morning serum cortisol.
S99. Tomiyama AJ et al. 2010. Low calorie dieting increases cortisol. Psychosom Med. PMID 20368473; doi:10.1097/PSY.0b013e3181d9523c. <https://pubmed.ncbi.nlm.nih.gov/20368473/>. *Used for:* 1200 kcal/day for 3 weeks raised total cortisol output (121 women).
S100. Leproult R et al. 1997. Sleep loss results in an elevation of cortisol levels the next evening. Sleep. PMID 9415946; doi:10.1093/sleep/20.10.865. <https://pubmed.ncbi.nlm.nih.gov/9415946/>. *Used for:* Evening cortisol +37 % after partial and +45 % after total sleep loss.
S101. Lovallo WR et al. 2005. Caffeine stimulation of cortisol secretion across the waking hours. Psychosom Med. PMID 16204431; doi:10.1097/01.psy.0000181270.20036.06. <https://pubmed.ncbi.nlm.nih.gov/16204431/>. *Used for:* Robust rise after abstinence; reduced but not eliminated at 300–600 mg/day habitual intake.
S102. Chandrasekhar K et al. 2012. A prospective, randomized double-blind, placebo-controlled study of ashwagandha root in reducing stress. Indian J Psychol Med. PMID 23439798; doi:10.4103/0253-7176.106022. <https://pubmed.ncbi.nlm.nih.gov/23439798/>. *Used for:* 300 mg twice daily for 60 days reduced serum cortisol vs placebo (P = 0.0006).
S103. Hill EE et al. 2008. Exercise and circulating cortisol levels: the intensity threshold effect. J Endocrinol Invest. PMID 18787373; doi:10.1007/BF03345606. <https://pubmed.ncbi.nlm.nih.gov/18787373/>. *Used for:* 30 min at 40/60/80 % VO2max: cortisol +5.7/+39.9/+83.1 %.
S104. Bergendahl M et al. 1998. Fasting suppresses pulsatile LH secretion and enhances orderliness of LH release in young but not older men. J Clin Endocrinol Metab. PMID 9626127; doi:10.1210/jcem.83.6.4856. <https://pubmed.ncbi.nlm.nih.gov/9626127/>. *Used for:* 3.5-day fast: 24-h cortisol +40 % (young), +47 % (older); LH production −2.1-fold in young men.

## Unverified or not found (do not cite)
- WHO 2024 Hb guideline text and its severity bands: the WHO site blocked access. The cut-offs come via BSG 2021 (S1).
- Polycythaemia Hb cut-offs; ICMR or Anaemia Mukt Bharat adult cut-offs.
- Effects on Hb and ferritin of fasting, Ramadan, keto or alcohol (the alcohol–ferritin direction is sourced, S21; there is no number).
- Folic acid masking B12 deficiency; phytate/fibre effects on iron absorption; eggs as a B12 source (size of effect).
- The exact unit factors 2.496 (vitamin D), 1.536 (fT3) and 0.6206 (Hb mmol/L) were not read in a source. They are standard molar conversions.
- The 0.45–4.12 mIU/L TSH reference limits (secondary only); an Indian adult TSH reference interval; the ATA 2016 "TSH < 0.1" threshold.
- T3 results in Ebbeling 2012 and CALERIE; the human refeeding time course for T3; alcohol, soy and iodine-excess effects on thyroid tests.
- Ashwagandha thyrotoxicosis case reports (reviews mention the risk; no primary case was opened). Lopresti 2019 *Am J Mens Health* (+14.7 % T) could not be opened, so it is not cited.
- Alcohol, chronic resistance training and overtraining effects on testosterone and cortisol; the oral-contraceptive CBG effect on total cortisol; a normal morning cortisol range from a source.
- Alcohol J-shape for CRP; effects of surplus or prolonged fasting on CRP.

## Validation targets for E20 (reproduce from the JSON)
| # | Input | Expected | Source |
|---|---|---|---|
| H1 | Man, Hb 12.4 g/dL, plan deficit 25 % | W-L-HB-1 fires (deficit 20 %), HB-2 caps fasts at 24 h, HB-3 asks for ferritin | S1 |
| H2 | Woman, ferritin 22 ng/mL, endurance plan | FERRITIN-1/2/3/4 fire; deficit ≤ 20 % | S12, S14 |
| H3 | Ferritin 45, CRP 8 mg/L | FERRITIN-6 re-ask fires; FERRITIN-1 does not | S11 |
| H4 | B12 250 pg/mL | B12-2 asks about metformin/PPI; B12-1 does not fire | S25 |
| H5 | 25(OH)D 9 ng/mL, BMI 31 | VITD-1 and VITD-4 fire | S36, S42 |
| H6 | hs-CRP 14 mg/L | CRP-1 caps fasts at 24 h for 28 days; CRP-2 asks for a retest at 2 weeks; CLINICIAN only after a repeat value > 10 | S48 |
| H7 | TSH 12, untreated | TSH-1 clinician note; TSH-2 caps fasts at 24 h; the plan continues | S64 |
| H8 | fT3 below the lab range during a 48 h fast, EA normal | FT3-2 info only; no cap | S70 |
| H9 | Testosterone 240 ng/dL, single test, deficit 30 % | TESTOSTERONE-1 retest and TESTOSTERONE-3 cap fire; clinician only on repeat | S80, S88 |
| H10 | Cortisol 3.8 µg/dL | CORTISOL-1 clinician, CORTISOL-2 caps fasts at 12 h | S97 |
| H11 | Remove every `grade` field | Rule firing is unchanged (R5 audit) | R5 |
