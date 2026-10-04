import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '15',
  slug: 'fibre-hydration-substances',
  title: 'Fibre, food form, hydration, micronutrients and common substances',
  scope:
    'This topic covers the parts of intake that are not simply protein, fat or carbohydrate grams but still change what the simulator shows: fibre and food form, sodium and water, vitamins and minerals, and common substances such as alcohol, caffeine and creatine. For each, it explains what the model does with it and how sure we are. Macronutrients, glycogen, ketosis and muscle protein are covered in their own topics.',
  mechanisms: [
    {
      id: '15-fibre-types-and-roles',
      title: 'Fibre: what it is and which kinds matter',
      category: 'fuel',
      summary:
        'Dietary fibre is the part of plant carbohydrate that gets past digestion in the small intestine. Once it reaches the large intestine, gut bacteria ferment some of it, and the rest adds bulk to stool. Different kinds of fibre do different jobs, but the model only needs total fibre plus, optionally, how much of it is the gel-forming (viscous) soluble kind.',
      howModelled:
        'Vitals tracks total fibre in grams per day, measured the standard laboratory way (AOAC). A typical Western diet is assumed to supply 8 g per 1,000 kcal. If you want detail, you can also enter viscous soluble fibre; when you do not, the model assumes it is 15 % of your total fibre. Other fibre types (insoluble, fermentable oligosaccharides, resistant starch) are described here but are not separate inputs.',
      keyNumbers: [
        {
          label: 'Typical Western fibre intake',
          value: '7.6 g per 1,000 kcal (median; IQR 6.6–10.4); 8 g per 1,000 kcal in a second study',
          referenceIds: ['corbin2023', 'karl2017'],
        },
        {
          label: 'Reference intake',
          value: '14 g per 1,000 kcal',
          note: 'Dietary Guidelines / IOM adequate intake, cited through a secondary source; the primary document was not opened.',
          referenceIds: ['mullins2021'],
        },
        {
          label: 'Intake with the largest risk reduction for non-communicable disease',
          value: '25–29 g/d',
          note: 'The authors suggested that more is better.',
          referenceIds: ['reynolds2019'],
        },
        {
          label: 'LDL cholesterol, per gram of soluble fibre',
          value: '−0.057 mmol/L per g (95 % CI −0.070 to −0.044), doses 2–10 g/d',
          referenceIds: ['brown1999'],
        },
        {
          label: 'LDL cholesterol, oat beta-glucan at 3 g/d or more',
          value: '−0.25 mmol/L',
          referenceIds: ['whitehead2014'],
        },
        {
          label: 'Appetite reduced in trial comparisons',
          value: '59 % of comparisons with viscous fibre vs 14 % with non-viscous fibre',
          referenceIds: ['wanders2011'],
        },
        {
          label: 'Default share of total fibre that is viscous soluble',
          value: '0.15 × total fibre',
          note: 'A default assumption, not a measured figure.',
        },
        {
          label: 'Englyst NSP relative to AOAC fibre',
          value: 'roughly 0.6–0.7 ×',
          note: 'Unverified. From the UK convention that 18 g NSP is about 30 g AOAC. Only matters when using the older stool-weight equation.',
        },
      ],
      moderators:
        'Class of fibre. Viscous soluble fibres (oat and barley beta-glucan, psyllium, guar, pectin, glucomannan) ferment well and drive the LDL and appetite effects. Insoluble fibres (wheat bran, cellulose, lignin) ferment little but add the most stool bulk and carry most of the “less absorbed energy” in whole-grain diets. Fermentable oligosaccharides (inulin, FOS, GOS) ferment fastest and are the least well tolerated per gram. Resistant starch (raw potato, green banana, cooked-and-cooled starch) feeds butyrate production but is not listed in nutrient databases.',
      grade: 'B',
      gradeReason:
        'The LDL and stool-bulk effects are grade A, but most other roles of each fibre class are supported at grade B.',
      status: 'established',
      caveats:
        'The 14 g per 1,000 kcal reference figure is taken from a secondary citation. Typical intakes fall well short of it, so the gap is a feature of ordinary diets rather than of any one eating pattern.',
      referenceIds: [
        'corbin2023',
        'karl2017',
        'topping2001',
        'mysonhimer2022',
        'wanders2011',
        'brown1999',
        'whitehead2014',
        'reynolds2019',
        'mullins2021',
      ],
      relatedMetricIds: [],
    },
    {
      id: '15-fibre-food-matrix-absorbed-energy',
      title: 'Fibre and food form change how many calories you absorb',
      category: 'energy',
      summary:
        'Food labels assume that almost everything you eat is absorbed. Whole, fibre-rich and coarsely ground foods are digested less completely, so some energy leaves in stool. In controlled feeding studies the standard energy factors overestimated absorbed energy by up to 4 % on refined diets and up to 11 % on low-fat, high-fibre diets. Whole nuts show the effect most clearly: their calories are only partly available until the cell walls are broken up.',
      howModelled:
        'The engine first recalculates your calories from grams of macronutrients, crediting fibre at 2 kcal per gram. It then subtracts 2.8 kcal for every gram of fibre above a typical amount (8 g per 1,000 kcal). Fibre intake is smoothed over about 3 days to mimic gut transit, and the correction is capped at a loss of 6 % or a gain of 3 % of intake. Nuts get their own correction: a share of the label calories (5–25 % depending on the nut and how it is prepared) is treated as not absorbed. Isolated fibre supplements get no correction by default.',
      equation:
        'E_eng = 4 × protein + 9 × fat + 4 × (carbohydrate − fibre) + 2.0 × fibre + 7 × alcohol\nFaecal energy: FE = FE₀ + k_F × F_eff, with k_F = 5.0 kcal per g fibre and FE₀ = 0 kcal/d\nNet correction: ΔME_fibre = −k_net × (F_eff − F_ref), where k_net = k_F − GE_fib + c_f = 5.0 − 4.2 + 2.0 = 2.8 kcal per g\nF_ref = 8 × E/1000 g/d; F_eff = running average of daily fibre with τ_F = 3 d\nLimits: −0.06 × E ≤ ΔME_fibre ≤ +0.03 × E\nNuts: ΔME_nut = −Σ δ_i × label kcal_i\nIsolated supplements: ΔME_supp = k_supp × supplement fibre g, with k_supp = 0 (range −1 to +2 kcal/g)',
      keyNumbers: [
        {
          label: 'Extra faecal energy per gram of fibre (k_F)',
          value: '5.0 kcal per g (95 % range 3.5–6.5)',
          note: 'Proposed fit to the post-intervention values of one trial; not published by its authors.',
          referenceIds: ['corbin2023', 'karl2017'],
        },
        {
          label: 'Net absorbed-energy correction (k_net)',
          value: '2.8 kcal per g fibre (range 1.3–4.3)',
          note: 'Derived. It depends on how much energy the label credits to fibre (c_f): 0.8 at 0 kcal/g, 2.8 at 2 kcal/g, 4.8 at 4 kcal/g.',
          referenceIds: ['karl2017', 'elia2007'],
        },
        {
          label: 'Whole-grain vs refined-grain trial (81 adults, 6 weeks, about 2,550 kcal)',
          value:
            'Fibre 40 ± 5 vs 21 ± 3 g/d; stool +76 ± 12 g/d; faecal energy +96 ± 18 kcal/d; combined net energy loss 92 kcal/d (95 % CI 28–156)',
          referenceIds: ['karl2017'],
        },
        {
          label: 'Ward crossover (17 adults): fibre-rich diet vs Western diet',
          value:
            'Host metabolisable energy 89.5 % (range 84.2–96.1) vs 95.4 % (94.1–97.0); 116 ± 56 kcal/d more lost in stool',
          note: 'The fibre intake on the two diets could not be verified.',
          referenceIds: ['corbin2023'],
        },
        {
          label: 'Standard factors overestimating absorbed energy',
          value: 'Up to 4 % (refined diets) and up to 11 % (low-fat, high-fibre diets)',
          referenceIds: ['zou2007'],
        },
        {
          label: 'Overestimate on a 2,800 kcal high-fibre diet',
          value: '6 % at 37 g fibre; 4.6 % at 16 g fibre',
          referenceIds: ['miles1988'],
        },
        {
          label: 'Worked example (2,550 kcal, 40 g fibre vs 20.4 g typical)',
          value: '−55 kcal/d (−2.2 %)',
          note: 'Calculated with the proposed fit. Adding the optional resting-rate rise of +43 kcal/d gives roughly the trial’s 100 kcal/d net effect.',
          referenceIds: ['karl2017'],
        },
        {
          label: 'Whole raw almonds',
          value: '4.42–4.6 kcal/g measured vs 6.0–6.1 label (0.24–0.27 of label calories not available)',
          referenceIds: ['novotny2012', 'gebauer2016'],
        },
        {
          label: 'Other almond forms',
          value:
            'Roasted 4.86 kcal/g (0.20); chopped 5.04 kcal/g (0.17); almond butter 6.53 kcal/g (about 0, not significant)',
          referenceIds: ['gebauer2016'],
        },
        {
          label: 'Other nuts',
          value:
            'Walnuts 5.22 vs 6.61 kcal/g (0.21); cashews 137 vs about 163 kcal per 28 g (0.16); pistachios 22.6 vs 23.7 kJ/g (0.05)',
          referenceIds: ['baer2012', 'baer2016', 'baer2018'],
        },
        {
          label: 'Peanuts, hazelnuts, pecans and seeds',
          value: 'assumed 0.10',
          note: 'Unverified. Not measured in the sources found.',
        },
        {
          label: 'Fat excretion with 84 g/d of almonds',
          value: '10.8 vs 1.7 g/d',
          referenceIds: ['novotny2012'],
        },
        {
          label: 'Typical effect of 28–56 g/d of almonds or walnuts',
          value: '−40 to −80 kcal/d',
        },
        {
          label: 'Range of energy value of unavailable carbohydrate',
          value: '−4.8 to +2.4 kcal/g, depending on how well it ferments',
          referenceIds: ['livesey1990'],
        },
      ],
      timeCourse:
        'Faecal energy follows fibre intake with the gut-transit lag of 2–3 days (whole-gut transit 60–70 h). Gut bacteria may take further weeks to adapt to a lasting change, but no one has measured how the energy effect develops. The model assumes the full effect by 2 weeks and a reversal as fast as the lag, in days.',
      moderators:
        'People differ a lot: host energy extraction ranged from 84.2 % to 96.1 % on the same diet, and the person-to-person spread of the effect is about half its average. Overfeeding shrinks the fraction lost in stool. One small study linked a 20 % rise in Firmicutes (with a matching fall in Bacteroidetes) to about 150 kcal more absorbed; that is an association in 21 people, not a cause. No sex or age effects were reported.',
      grade: 'B',
      gradeReason:
        'Four independent controlled-feeding studies point the same way, with an effect of 4–11 % of intake; the slope beyond 40 g/d is only grade C.',
      status: 'proposed-fit',
      caveats:
        'The slope is fitted to one two-arm trial (21 vs 40 g/d) and agrees with one ward study whose fibre intake could not be checked. The result shifts by 1 kcal per gram for every 1 kcal/g change in how the label credits fibre, and the engine assumes 2. The label convention of the trial diets was inferred, not stated. Nothing is known about intakes above about 60 g/d, isolated fibres, or fibre swaps inside low-carbohydrate eating. Cooking may raise starch and protein digestibility, but the evidence is mostly animal and modelling work; long-term raw-food eaters (70 % or more raw, n = 513) lost roughly 10–12 kg and many women had low BMI or missed periods, but that survey cannot separate lower absorption from lower intake. Cooking is therefore not modelled beyond a warning.',
      referenceIds: [
        'corbin2023',
        'karl2017',
        'zou2007',
        'baer1997',
        'miles1988',
        'livesey1990',
        'elia2007',
        'davis2026',
        'cummings1992',
        'jumpertz2011',
        'novotny2012',
        'gebauer2016',
        'baer2012',
        'baer2016',
        'baer2018',
        'koebnick1999',
        'carmody2009',
      ],
      relatedMetricIds: ['energyBalance', 'fatMass'],
    },
    {
      id: '15-fibre-stool-mass-and-gut-content',
      title: 'Fibre, stool weight and the scale',
      category: 'body',
      summary:
        'Stool is made of undigested fibre, the water that fibre holds, and bacteria. Across many controlled diets, stool weight rises in a straight line with fibre intake. Because the gut always contains some material, changing your fibre intake can shift the scale slightly for a few days. That shift is small and uncertain.',
      howModelled:
        'The engine predicts daily stool output from smoothed fibre intake. It can also add a small gut-content term to scale weight, but the recommended setup leaves that off here and uses the gut-content term from the diet-transitions topic instead, so the effect is not counted twice. On any fibre change, expect a scale shift of about 0.6 kg or less within 2–4 days.',
      equation:
        'Stool (g/d) = 38 + 5.3 × NSP   (mixed sources: 35 + 4.9 × NSP)\n≈ 38 + 4.0 × F_AOAC   (use this with F_eff)\nGut-content term (proposed, grade D): W_gut,fibre (kg) = 0.010 × (F_eff − F_ref)   (range 0.005–0.02 kg per g)',
      keyNumbers: [
        {
          label: 'Stool weight and non-starch polysaccharide (NSP) intake',
          value: '38 + 5.3 × NSP g/d (26 dietary periods, n = 206; NSP 4–32 g/d)',
          referenceIds: ['cummings1992'],
        },
        {
          label: 'Stool weight and AOAC fibre in one trial',
          value: '+76 ± 12 g/d for +19 g fibre (about 4.0 g per g)',
          referenceIds: ['karl2017'],
        },
        {
          label: 'UK adults on usual diets',
          value:
            'Median stool 106 g/d (men 104, women 99); whole-gut transit 60 h (men 55, women 72); under 50 g/d in 17 % of women and 1 % of men',
          referenceIds: ['cummings1992'],
        },
        {
          label: 'Colon volume when fasting (MRI, n = 75)',
          value: 'Ascending 203 ± 75 mL, transverse 198 ± 79 mL, descending 160 ± 86 mL (total about 560 mL)',
          note: 'Includes gas and fluid, so it overstates solid mass.',
          referenceIds: ['pritchard2014'],
        },
        {
          label: 'Possible scale-weight effect of a fibre change',
          value: '0.1–0.6 kg',
          note: 'Uncertain. +20 g fibre → +0.2 kg; zero fibre → about −0.15 kg (proposed, grade D).',
        },
      ],
      timeCourse:
        'Fibre intake reaches stool with the gut-transit delay, so most of the scale change appears within 2–4 days of a change in fibre.',
      moderators:
        'How fast food moves through the gut. Transit time and stool weight are closely linked, so if transit speeds up as stool gets heavier, the amount sitting in the colon barely changes.',
      grade: 'A',
      gradeReason:
        'The stool-weight slope comes from a meta-regression of controlled diets; the extra step to scale weight is only grade D and is small.',
      status: 'established',
      caveats:
        'How much colon content really changes scale weight depends on whether transit time stays fixed. If it does, a swing from 0 to 40 g NSP adds about 0.35–0.6 kg. If transit shortens as stool gets heavier, the change is 0.15 kg or less. Feeling bloated comes from gas and fluid and is not a weight effect. The middle estimate used here is a proposal, not a measurement.',
      referenceIds: ['karl2017', 'cummings1992', 'pritchard2014'],
      relatedMetricIds: ['gutContent', 'scaleWeight'],
    },
    {
      id: '15-fermentation-scfa-butyrate',
      title: 'Gut fermentation, short-chain fatty acids and zero-fibre eating',
      category: 'fuel',
      summary:
        'Bacteria in the large intestine ferment carbohydrate that reaches them and produce short-chain fatty acids (SCFAs), mainly acetate, propionate and butyrate. The body absorbs about 95 % of these and uses them as a small extra fuel supply. Fibre and carbohydrate both feed this process, so very low carbohydrate intake lowers butyrate sharply, even at similar fibre.',
      howModelled:
        'Vitals keeps two relative indices, where 1.0 means a typical Western diet: one for total fermentation and one for butyrate. Both rise with fermentable material (fibre plus resistant starch) and are scaled down by carbohydrate intake, averaged over 7 days. The model does not simulate microbiome diversity. Zero or very low fibre triggers a warning, not a state, because its long-term effects are unknown.',
      equation:
        'SCFA_raw = clamp((0.65 × F_eff + RS_g) / 14, 0.3, 1.8)\nSCFA_idx = SCFA_raw × s(c)     BUT_idx = SCFA_raw × b(c)\ns(c) = 0.42 + 0.58 × min(1, c/400)\nb(c) = 0.20 + 0.80 × min(1, c/400)\nc = carbohydrate in g/d (7-day average); RS_g = resistant starch, default 3–5 g/d; 0.65 = assumed fermentable share of AOAC fibre (unverified)',
      keyNumbers: [
        {
          label: 'Carbohydrate reaching the caecum',
          value:
            'About 20–40 g/d on Western diets; up to 50 g/d on cereal- or fruit-and-vegetable-rich diets',
          referenceIds: ['elia2007'],
        },
        {
          label: 'Acetate : propionate : butyrate ratio',
          value: 'From 75:15:10 to 40:40:20',
          referenceIds: ['bergman1990'],
        },
        {
          label: 'Share of SCFA absorbed',
          value: 'About 95 %',
          referenceIds: ['bergman1990'],
        },
        {
          label: 'Share of human energy needs supplied by SCFA',
          value: 'About 5–10 % (about 100–170 kcal/d in one model)',
          referenceIds: ['davis2026', 'mcneil1984', 'bergman1990'],
        },
        {
          label: 'Production from 15 g of inulin over 12 h',
          value: 'About 137 mmol acetate, 11 mmol propionate, 20 mmol butyrate (about 11 mmol SCFA per g)',
          note: 'Stable-isotope estimate that assumed absorption fractions. A conversion of about 8–11 mmol SCFA per g of fermented carbohydrate is unverified.',
          referenceIds: ['boets2015'],
        },
        {
          label: 'SCFA concentration along the colon (autopsy)',
          value: '131 mmol/kg in the caecum, falling to 80 mmol/kg in the descending colon',
          referenceIds: ['cummings1987'],
        },
        {
          label: 'Faecal SCFA when carbohydrate falls from 399 to 164 to 24 g/d',
          value: '114 → 74 → 56 mM total; butyrate 18 → 9 → 4 mM; Roseburia/E. rectale 11 → 8 → 3 %',
          note: 'Obese men, 4 weeks per diet, protein about 130–140 g/d. The fitted indices are 1.00/0.66/0.46 for total SCFA (observed 1.00/0.65/0.49) and 1.00/0.53/0.25 for butyrate (observed 1.00/0.50/0.22).',
          referenceIds: ['duncan2007'],
        },
        {
          label: 'Tolerable doses of isolated fibres',
          value:
            'Recommended ceilings from 3.75 g/d (alginate) to 25 g/d (soy fibre) across 103 trials (0.75–160 g/d)',
          referenceIds: ['mysonhimer2022'],
        },
        {
          label: 'Constipated patients who stopped fibre for 2 weeks (n = 63)',
          value:
            'Bowel frequency from 1 per 3.75 d to 1 per 1.0 d; those who kept a high-fibre diet stayed at 1 per 6.8 d',
          note: 'Uncontrolled and self-selected.',
          referenceIds: ['ho2012'],
        },
        {
          label: 'Survey of 2,029 adults eating only animal foods for 6 months or more (median 14 months)',
          value: 'GI symptoms in 3.1–5.5 %; mean LDL-C 172 mg/dL',
          note: 'Self-selected and self-reported, with no denominators.',
          referenceIds: ['lennerz2021'],
        },
        {
          label: 'Proposed warning for fast fibre increases',
          value:
            'Fibre up by more than 10 g/d within 7 days, or above 50 g/d; assume gut symptoms for 1–3 weeks',
          note: 'Proposed, grade D. Whole-food ramps have no trial-based rate.',
        },
      ],
      timeCourse:
        'Gut bacteria change composition within 24–48 hours of a switch between plant-only and animal-only diets, and the shift reverses when the diet stops. Butyrate and total SCFA follow the 7-day carbohydrate average in the model.',
      moderators:
        'Carbohydrate intake (very low carbohydrate cuts butyrate more than total SCFA), fibre amount and type, resistant starch intake, and colonic transit time.',
      grade: 'C',
      gradeReason:
        'The carbohydrate link rests on one controlled feeding series (grade B) and the per-gram SCFA conversion is grade C; diversity and health claims are grade D and are not modelled.',
      status: 'proposed-fit',
      caveats:
        'The two scaling curves are proposed fits to a single dataset. A 17-week high-fibre trial (18 per arm) changed the bacteria’s enzymes without changing diversity, while a fermented-food diet raised diversity, so Vitals does not simulate diversity. A very-low-carbohydrate diet also cut faecal ferulate and phenolic acids and raised N-nitroso compounds and branched-chain fatty acids. Constipation is not a predictable result of zero fibre, and the long-term effects on the colon and on cardiometabolic health are unknown.',
      referenceIds: [
        'elia2007',
        'davis2026',
        'mcneil1984',
        'bergman1990',
        'boets2015',
        'ho2012',
        'duncan2007',
        'russell2011',
        'david2014',
        'wastyk2021',
        'lennerz2021',
        'mysonhimer2022',
        'cummings1987',
      ],
      relatedMetricIds: [],
    },
    {
      id: '15-fibre-appetite-glycaemia-ldl',
      title: 'Fibre, fullness and health markers',
      category: 'hormones',
      summary:
        'Gel-forming fibre slows digestion and makes people feel fuller. Over weeks, higher fibre intake goes with slightly lower intake, slightly lower body weight, lower LDL cholesterol and lower blood pressure. In type 2 diabetes it also lowers blood sugar. Large observational studies link higher fibre intake to lower risk of several diseases.',
      howModelled:
        'Fibre nudges spontaneous intake in the appetite module, but only when the model is choosing how much you eat or scoring hunger and adherence. It never changes a calorie target you set yourself. LDL and blood-sugar effects are handed to the lipid and carbohydrate modules.',
      equation:
        'Spontaneous-intake multiplier = 1 − 0.0013 × clamp(F_eff − F_ref, −10, +30)   (about −2.6 % at +20 g; proposed from Wanders 2011)',
      keyNumbers: [
        {
          label: 'Acute appetite and intake with viscous vs non-viscous fibre',
          value:
            'Appetite lower in 59 % vs 14 % of comparisons; acute intake lower in 69 % vs 30 %; acute intake cut by 0.1–0.4 MJ (24–96 kcal) with viscous fibre',
          referenceIds: ['wanders2011'],
        },
        {
          label: 'Longer-term intake (3–19 week trials)',
          value: 'Average −0.15 MJ/d (−2.6 % of intake) and −0.39 kg per 4 weeks, not specific to fibre type',
          note: 'As summarised in a Nordic nutrition review.',
          referenceIds: ['wanders2011', 'carlsen2023'],
        },
        {
          label: 'Higher vs lower fibre in trials (27 trials)',
          value: 'Body weight −0.37 kg; systolic blood pressure −1.27 mmHg; total cholesterol −0.15 mmol/L',
          referenceIds: ['reynolds2019', 'carlsen2023'],
        },
        {
          label: 'Isolated soluble fibre supplements, no energy restriction',
          value:
            'Weight −2.52 kg (95 % CI −4.25 to −0.79); BMI −0.84; body fat −0.41 %; fasting glucose −0.17 mmol/L (12 RCTs, 2–17 weeks, very heterogeneous)',
          referenceIds: ['thompson2017'],
        },
        {
          label: 'Viscous fibre inside a calorie-restricted diet',
          value: 'Weight −0.81 kg (95 % CI −1.20 to −0.41), 15 RCTs',
          referenceIds: ['jovanovski2021'],
        },
        {
          label: 'Fibre intake and weight loss in a 750 kcal/d deficit (n = 345, 6 months)',
          value:
            'Strongest predictor of weight loss (standardised beta −0.37) and of macronutrient adherence',
          note: 'Secondary analysis.',
          referenceIds: ['miketinas2019'],
        },
        {
          label: 'Soluble fibre and LDL',
          value:
            '−0.057 mmol/L per g (95 % CI −0.070 to −0.044); oat beta-glucan at 3 g/d or more −0.25 mmol/L (−0.20 to −0.30), total cholesterol −0.30',
          referenceIds: ['brown1999', 'whitehead2014'],
        },
        {
          label: 'Fibre in type 2 diabetes (15 RCTs)',
          value: 'Fasting glucose −0.85 mmol/L; HbA1c −0.26 %',
          note: 'Type 2 diabetes only. For healthy people no effect is simulated beyond the glycaemic-index handling in the carbohydrate module.',
          referenceIds: ['post2012'],
        },
        {
          label: 'Highest vs lowest fibre intake (observational)',
          value:
            'All-cause mortality −15 %; type 2 diabetes RR 0.84 (0.78–0.90); colorectal cancer −16 %; CVD RR 0.91 per 7 g/d (0.88–0.94); best at 25–29 g/d',
          referenceIds: ['reynolds2019', 'threapleton2013', 'carlsen2023'],
        },
      ],
      timeCourse:
        'The trials in this row ran 2–19 weeks. Acute effects on appetite appear within a meal or a day.',
      moderators:
        'Fibre type (viscous fibre works best for fullness), whether energy is restricted, and diabetes status for the blood-sugar effect.',
      grade: 'B',
      gradeReason:
        'Most rows come from randomised trials and meta-analyses (grade B), with LDL at grade A and the intake multiplier a grade C conversion.',
      status: 'proposed-fit',
      caveats:
        'The disease-outcome figures come from observational studies. The intake multiplier is a conversion proposed for Vitals from one systematic review, and the fibre supplement results are very heterogeneous. The POUNDS Lost finding is from a secondary analysis, so it does not prove that fibre causes the weight loss.',
      referenceIds: [
        'wanders2011',
        'thompson2017',
        'jovanovski2021',
        'miketinas2019',
        'brown1999',
        'whitehead2014',
        'post2012',
        'reynolds2019',
        'threapleton2013',
        'carlsen2023',
      ],
      relatedMetricIds: ['hunger', 'ldl'],
    },
    {
      id: '15-ultra-processed-food-energy-density-intake',
      title: 'Highly processed food, energy density and how much you eat',
      category: 'hormones',
      summary:
        'Ultra-processed food is softer, denser in energy, quicker to eat and more palatable. In three trials where people could eat as much as they liked, they ate more of it and gained fat, even though the foods were matched on the nutrients that were presented. People did not report feeling hungrier. The extra eating seems to come from how the food is built, not from a felt need.',
      howModelled:
        'Vitals applies a modest intake multiplier only when it is deciding how much you eat freely (an “auto-intake” or ad libitum mode) and when it scores cravings and adherence (using a craving-control questionnaire score, CoEQ). Calories you set yourself are never changed. The default assumes ultra-processed food supplies 55 % of energy. If you override energy density directly, a second multiplier applies with a gentler exponent so the two effects are not double counted. Eating rate and chews per calorie are shown as explanations, not inputs.',
      equation:
        'M_UPF = 1 + γ_u × (ups_share − 0.55)   with γ_u = 0.15 per unit share (range 0.10–0.25)\nED_auto(u) = 1.15 + 0.35 × u   (kcal/g)\nM_ED = (ED / ED_auto(u))^ε   with ε = 0.5 (range 0.25–1.0); used only if the user overrides energy density\nCraving-control penalty = −11.7 CoEQ points per +0.7 ultra-processed share',
      keyNumbers: [
        {
          label: 'Ward crossover, 20 weight-stable adults, 2 weeks each',
          value:
            'Intake +508 ± 106 kcal/d on ultra-processed food; weight +0.9 ± 0.3 vs −0.9 ± 0.3 kg; fat mass +0.4 vs −0.3 kg',
          note: 'Energy density 1.36 vs 1.09 kcal/g (non-beverage 1.96 vs 1.06); eating rate +17 kcal/min (+7.4 g/min); hunger, fullness and pleasantness ratings not different.',
          referenceIds: ['hall2019'],
        },
        {
          label: 'Crossover in 9 overweight men, 1 week each',
          value: 'Intake +813 kcal/d (95 % CI 342–1285); weight +1.1 kg (0.2–2.0); fewer chews per kcal',
          referenceIds: ['hamano2024'],
        },
        {
          label: 'Eight-week crossover in 50 adults (UPDATE trial)',
          value:
            'Weight −2.06 % vs −1.05 % (difference −1.01 %, −1.87 to −0.14); fat mass −1.59 vs −0.61 kg (difference −0.98, −1.62 to −0.33)',
          note: 'Both diets followed the same national dietary guide. Energy density 1.25 vs 1.60 kcal/g. Hunger scores unchanged.',
          referenceIds: ['dicken2025'],
        },
        {
          label: 'Self-reported vs body-composition-derived intake difference (same trial)',
          value:
            'Self-reported −504 vs −290 kcal/d (difference −327); body-composition-derived −290 vs −120 kcal/d (difference −170)',
          note: 'Self-report roughly doubled the between-diet difference.',
          referenceIds: ['dicken2025'],
        },
        {
          label: 'Craving control score (CoEQ)',
          value: '+23.8 vs +12.1 (p = 0.019)',
          note: 'One trial.',
          referenceIds: ['dicken2025'],
        },
        {
          label: 'Blood lipids in the same trial',
          value:
            'LDL fell more on the ultra-processed diet (−0.38 vs −0.13 mmol/L, p = 0.016); triglycerides fell more on the minimally processed diet (−0.25 mmol/L difference, p = 0.004)',
          referenceIds: ['dicken2025'],
        },
        {
          label: 'Energy density and portion size, 24 women, 2 days',
          value:
            'Energy density −25 % → intake −24 % (−575 kcal/d); portion −25 % → −10 % (−231 kcal/d); effects were additive',
          referenceIds: ['rolls2006'],
        },
        {
          label: 'One-year weight-loss trial in 97 obese women (no calorie goal)',
          value: 'Lower-energy-density diet: −7.9 vs −6.4 kg, with less hunger',
          referenceIds: ['ellomartin2007'],
        },
        {
          label: 'Slower eating rate (22 studies)',
          value: 'Lower intake, SMD 0.45 (95 % CI 0.25–0.65); no hunger difference',
          referenceIds: ['robinson2014'],
        },
        {
          label: 'Eating rate and intake (secondary citation in the ward trial)',
          value: 'A 20 % change in eating rate is roughly a 10–13 % change in intake',
          referenceIds: ['hall2019'],
        },
        {
          label: 'Fit of the multiplier',
          value:
            'γ_u ≈ 0.24 from the ward trial (0 vs 83 % share, about +20 %); ≈ 0.22 from self-reported UPDATE data (+16 %) or ≈ 0.11 from body-composition data (+8 %)',
          note: 'Elasticity of intake to energy density: about 0.95 (Rolls, 2 days, lab), about 0.3 (ward trial), 0.3–0.65 (UPDATE).',
          referenceIds: ['rolls2009'],
        },
      ],
      timeCourse:
        'The intake difference is present from the first days; in the ward trial intake on the ultra-processed diet declined over time in a straight line. It persisted over 8 weeks in the larger trial, and it reverses immediately when the food environment changes. Body-composition changes follow from the energy-balance model.',
      moderators:
        'Baseline BMI and sex were not significant in the ward trial, and habitual ultra-processed share and weight were not linked to response in the larger trial. That trial used reformulated “healthier” ultra-processed food and portion-size labels, so its effect is probably conservative.',
      grade: 'B',
      gradeReason:
        'Three randomised trials of increasing size, one in a metabolic ward, point the same way, but the size of the effect is uncertain by about a factor of two.',
      status: 'proposed-fit',
      caveats:
        'Self-reported intake overstated the difference between diets by about twofold compared with measured body-composition change. Use the body-composition figure (−170 kcal/d) when calibrating to weight outcomes and the self-reported figure when calibrating to reported intake. The three trials used different populations and definitions of ultra-processed food, nobody knows whether the effect lasts beyond 8 weeks, and because hunger scores do not change, the mechanism (eating rate, energy density, palatability, texture) cannot be separated.',
      referenceIds: [
        'hall2019',
        'hamano2024',
        'dicken2025',
        'rolls2009',
        'rolls2006',
        'ellomartin2007',
        'robinson2014',
      ],
      relatedMetricIds: ['hunger'],
    },
    {
      id: '15-sodium-potassium-water-weight',
      title: 'Sodium, water and the scale',
      category: 'body',
      summary:
        'Your body holds water in proportion to its sodium, and the kidneys match sodium loss to intake over about 3–4 days. A saltier day can add a few hundred grams overnight, and a lower-sodium week can take some off. Fasting and very low carbohydrate intake make the kidneys shed extra sodium at first, and eating carbohydrate again makes them hold it. How much water a lasting change in sodium really shifts is contested.',
      howModelled:
        'The engine turns daily sodium intake into a smoothed “effective sodium” (intake minus sweat and, early in fasting or very low carbohydrate eating, the extra kidney loss). Water weight is the gap between this and your usual intake, multiplied by an uncertain coefficient κ. The interface will show a range, not one number. Potassium and magnesium have no state of their own; they trigger warnings only. The water-weight parts from glycogen, creatine, gut content, hydration and the menstrual cycle are added by a master sum.',
      equation:
        'I_Na = sodium_g × 1000 / 22.99 + supplement_Na   (mmol/d; 1 g Na = 43.5 mmol; 100 mmol Na = 2.3 g Na = 5.8 g salt)\nL_sweat = sweat_L × sweat_Na_mmolL   (sweat sodium 10–70 mmol/L, typically about 35)\nL_ket = A_nat × K_nat(t)   (kidney sodium loss in ketosis or fasting)\nI_eff = I_Na − L_sweat − L_ket\nI_lag = running average of I_eff with τ_Na = 1.5 d\nW_Na = κ × (I_lag − I_0) / 1000   (kg), κ = 6 g body mass per (mmol/d) = 0.006 kg per mmol/d (range 0–12)\nK_nat rises with τ_on = 2 d and falls with τ_off = 0.5 d on carbohydrate refeed; A_nat = 50 mmol/d (1.15 g Na), decaying with τ_nat = 5 d, with a 10 % tail while ketotic\nPartial habituation: Na_hab_eff = Na_0 + h × (Na_hab − Na_0); steady-state water = (1 − h) × τ_Na × ΔNa / 140 (litres); default h = 0.5\nTotal: W_water_excess = W_glycogen_water + W_Na + W_Cr + W_gut,fibre − H_def + W_cycle + W_refeed_oedema',
      keyNumbers: [
        {
          label: 'One week at 200 vs 50 mmol Na/d (70–78 healthy young men, ward crossover)',
          value:
            'Body weight 79.2 vs 80.6 kg (+1.4 kg, p < 0.001); extracellular fluid +1.2 ± 1.8 L; plasma sodium +2 mmol/L; systolic pressure +3 mmHg',
          note: 'Urinary sodium 38 ± 26 vs 230 ± 67 mmol/24 h; urine volume not different (1,835 vs 1,722 mL, p = 0.2); the fluid rise was larger at higher BMI (r = 0.36).',
          referenceIds: ['visser2009', 'vandenboschjjjon2021', 'krikken2012'],
        },
        {
          label: 'Ward study, 32 men, salt 50 to 200, 400 and 550 mEq/d',
          value: 'Plasma volume +315 ± 37 mL at 550 mEq/d, but total body water and body mass did not rise',
          referenceIds: ['heer2000'],
        },
        {
          label: 'Long space-station simulation (3 men, 135 days)',
          value:
            'Total-body sodium +2,973 to +7,324 mmol with weight +5.1 to +9.3 kg (1.3–1.7 g body mass per mmol retained vs 7.1 g/mmol if isotonic)',
          note: 'Sodium sometimes rose without weight gain, which led to the idea of an “osmotically inactive reservoir”.',
          referenceIds: ['titze2002'],
        },
        {
          label: 'Long space-flight simulations (10 men, 105 and 205 days, at 12, 9 and 6 g salt/d)',
          value:
            '+6 g salt/d raised urine osmolyte excretion but reduced free-water clearance (water conserved inside the body), which reduced drinking',
          note: 'Weekly aldosterone and cortisol rhythms were also seen.',
          referenceIds: ['rakova2017'],
        },
        {
          label: 'Salt and urine volume (104 hypertensive people plus a population study)',
          value: '24-h urine 2.2 L (277 mmol Na) vs 1.3 L (21 mmol); +367–454 mL urine/d per 100 mmol Na/d',
          referenceIds: ['he2001'],
        },
        {
          label: 'Extra 6 g salt/d for 2 weeks (40 healthy adults)',
          value:
            'Urinary sodium +2.29 g/d; no significant change in body composition, fluid intake, hydration or urine volume; diet-induced thermogenesis −1.3 %',
          referenceIds: ['mahler2022'],
        },
        {
          label: 'Rapid weight loss on lower salt in hospitalised kidney patients (n = 311, 5 g salt/d diet)',
          value: 'Median 0.7 kg (IQR 0–1.4) by day 4 and 1.0 kg (0.3–1.7) by day 7',
          note: 'Not healthy adults. Also quotes the classic finding that the kidney adjusts to a sudden change in about 3–4 days.',
          referenceIds: ['mihara2019'],
        },
        {
          label: 'Very-low-carbohydrate switch at a constant 2,400 kcal (17 overweight men)',
          value:
            'Carbohydrate 300 → 31 g/d, sodium 2.7 → 4.9 g/d: extra −1.6 ± 0.2 kg after the switch (mainly water); fat −0.2 ± 0.1 kg over 15 days; total −2.2 kg (−0.5 kg fat) over 28 days',
          referenceIds: ['hall2016'],
        },
        {
          label: 'Composition of loss, 800 kcal ketogenic vs mixed diet (6 obese people, 10 days)',
          value: 'Loss 467 vs 278 g/d; water 61 % vs 37 % of loss; fat 35 % vs 60 %',
          referenceIds: ['yang1976'],
        },
        {
          label: 'Sodium balance on a 400 kcal protein diet vs isocaloric mixed diet (7 obese people)',
          value:
            'Net sodium loss −382 ± 117 vs −25 ± 105 mmol; fall in standing systolic pressure −28 vs −18 mmHg, with symptoms in all; norepinephrine −40 %',
          note: 'Sodium intake in the protocol was not verified.',
          referenceIds: ['dehaven1980'],
        },
        {
          label: 'Sodium loss in fasting',
          value:
            'Sodium loss matched by organic-acid anion plus phosphate excretion (y = 0.73x + 19, r = 0.89); ammonium replaces sodium later; sodium excretion falls promptly on glucose refeeding',
          referenceIds: ['sigler1975'],
        },
        {
          label: 'Insulin and sodium',
          value: 'Urinary sodium excretion −47 % (401 → 213 µeq/min) at supraphysiological insulin',
          referenceIds: ['defronzo1975'],
        },
        {
          label: 'Ketogenic diet without energy restriction (9 lean men, 4 weeks, supplemented)',
          value: 'Weight and whole-body potassium unchanged over 5 weeks',
          referenceIds: ['phinney1983'],
        },
        {
          label: 'Glycogen carries water and potassium',
          value: '3–4 g water and 0.45 mmol potassium per g glycogen',
          note: 'Owned by the glycogen module.',
          referenceIds: ['kreitzman1992', 'fernandezelias2015'],
        },
        {
          label: 'Model prediction with default κ',
          value:
            'A salty day (+130 mmol Na) → about +0.4 kg next morning (range 0–0.8), fading over 3–4 days; sustained +130 mmol/d → about +0.8 kg after 4–7 days (0–1.6); 3 g to 1 g Na/d (−87 mmol/d) → about −0.5 kg (−0.2 to −1.0) in a week',
          note: 'Most of the first-week drop on a low-carbohydrate diet is glycogen water (about 1–2 kg), with sodium contributing about 0.3–0.6 kg.',
        },
        {
          label: 'Day-to-day scale noise in first-morning body mass (active men)',
          value: 'SD 0.51 ± 0.20 kg (CV 0.66 %)',
          note: 'Also a weekly rhythm: higher on Sunday and Monday, lowest on Friday and Saturday (80 adults; amplitude not given in the abstract).',
          referenceIds: ['orsama2014', 'cheuvront2004'],
        },
        {
          label: 'Intake reference values',
          value:
            'Sodium adequate intake 1,500 mg/d and chronic-disease-risk-reduction limit 2,300 mg/d; potassium adequate intake 3,400 mg (men) and 2,600 mg (women)',
          note: 'The 2005 potassium figure of 4.7 g/d has been superseded.',
          referenceIds: ['nasem2019', 'iom2005'],
        },
        {
          label: 'Magnesium on food alone (US adults not taking a multivitamin)',
          value: '304 mg/d, with 54.6 % below the estimated average requirement',
          note: 'Carbohydrate-restricted diets reduced magnesium and other intakes by 10–70 %.',
          referenceIds: ['churuangsuk2019', 'blumberg2017'],
        },
        {
          label: 'Low sodium warning thresholds',
          value:
            'Sodium below 1.5 g/d for more than 2 weeks; above 5 g/d in hypertension; below 3.0 g/d when carbohydrate is under 50 g/d in the first 3 weeks',
          note: 'Proposed rules. The simulator does not cap sodium.',
        },
        {
          label: 'Fluid warnings during fasting or intake under 800 kcal without added sodium',
          value: 'Warn above 3 L/d; hard warning above 5 L/d',
          note: 'Proposed, grade C/D. Low-solute intake limits the kidney’s ability to dilute urine; the model never simulates fluid loading as a strategy.',
        },
      ],
      timeCourse:
        'The kidney matches sodium output to intake with a lag of about 3–4 days after an abrupt change, so the model uses a time constant of 1.5 days. Fasting or very-low-carbohydrate sodium loss peaks in the first days and fades as ammonium replaces sodium in urine. After carbohydrate returns, sodium loss stops quickly; as a grade D assumption, for 2 days after carbohydrate rises by more than 100 g/d, renal sodium excretion is multiplied by 0.8.',
      moderators:
        'BMI (the fluid response was larger at higher BMI, so the upper range of κ is used from BMI 30), insulin and carbohydrate state, sweat loss, and kidney or heart disease and salt-sensitive hypertension (larger effects, out of scope and flagged).',
      grade: 'C',
      gradeReason:
        'The direction of the effect is certain, but the steady-state size is contested and the ketosis sodium loss is fitted to a single study.',
      status: 'contested',
      caveats:
        'Two well-controlled datasets disagree: the 7-day crossover found about 9.3 g of body mass per mmol/d, while the ward study found roughly none, and both differ from the “sodium reservoir” idea. They also disagree about urine volume. Because of this, κ carries a wide range (0–12 g per mmol/d) and the sodium module partially habituates (h = 0.5 by default) rather than returning fully to baseline. The 3–5 g sodium per day advice for low-carbohydrate eating comes from practitioner texts; no controlled trial tested electrolyte supplements for the early “keto flu”, so the numeric range is grade D, while the existence of extra sodium loss is grade B. Case reports show low blood sodium from high fluid intake with very low solute (44 case reports), and supervised 4–21-day fasts on about 200–250 kcal/d of broth and juice recorded adverse events in under 1 % of 1,422 people, so the risk applies to plain-water, very-low-solute fasts with large fluid volumes. Only one shared sodium and water model should run across the whole engine; the values here use partial habituation with a time constant of 1.5 days.',
      referenceIds: [
        'heer2000',
        'titze2002',
        'rakova2017',
        'he2001',
        'mihara2019',
        'mahler2022',
        'dehaven1980',
        'sigler1975',
        'defronzo1975',
        'yang1976',
        'phinney1983',
        'hall2016',
        'kreitzman1992',
        'fernandezelias2015',
        'goulet2013',
        'hewbutler2015',
        'orsama2014',
        'cheuvront2004',
        'micoanski2025',
        'wilhelmidetoledo2019',
        'nasem2019',
        'iom2005',
        'churuangsuk2019',
        'blumberg2017',
        'garrison2020',
        'visser2009',
        'vandenboschjjjon2021',
        'krikken2012',
      ],
      relatedMetricIds: ['ecfShift', 'scaleWeight'],
    },
    {
      id: '15-hydration-needs-and-performance',
      title: 'How much water you turn over, and when dehydration matters',
      category: 'performance',
      summary:
        'Total water turnover averages 4.3 litres a day in men aged 20–30 and 3.4 litres in women aged 20–55. That includes water in food and water made by metabolism. How much depends on body size, activity, heat, humidity and altitude. Exercise-related fluid loss of about 2 % of body mass starts to reduce power in fixed-effort tests, but not in self-paced time trials or in strength and thinking tasks.',
      howModelled:
        'The engine estimates your daily fluid need from a published turnover equation and assumes you drink to match it. If you enter low fluid or heavy sweating, a hydration deficit builds up and clears with thirst-driven recovery. That deficit slightly lowers fixed-intensity endurance performance. Strength, power and cognition get no hydration multiplier. The rule that everyone needs eight glasses a day is not modelled.',
      equation:
        'Water turnover (mL/d) = 1076 × PAL + 14.34 × BW_kg + 374.9 × Sex + 5.823 × Humidity_% + 1070 × Athlete + 104.6 × HDI + 0.4726 × Altitude_m − 0.3529 × Age² + 24.78 × Age + 1.865 × Temp_C² − 19.66 × Temp_C − 713.1\n(Sex: 0 female, 1 male; Athlete 0/1; HDI 0 high, 1 middle, 2 low; PAL = physical activity level, R² = 0.47)\nneed_fluid_L = max(1.2, 0.81 × WT/1000 − 0.3)   (proposed)\nH_def(t+1) = H_def(t) × exp(−1/τ_H) + max(0, need_fluid_L + sweat_L × (1 − refill_fraction) − fluid_L) × f_kidney\nτ_H = 0.5 d, f_kidney = 0.6, cap 2.5 kg\nEndurance multiplier (fixed intensity) = 1 − 0.0096 × max(0, dehydration_%)   (about −1.9 % at 2 %; time trials: 1.0 up to 4 %)',
      keyNumbers: [
        {
          label: 'Water turnover, isotope study of 5,604 people',
          value: 'Men aged 20–30: 4.3 L/d; women aged 20–55: 3.4 L/d',
          note: 'Example from the paper: a sedentary 70 kg man (PAL 1.75, 10 °C, sea level) about 3.2 L/d; a 60 kg woman about 2.7 L/d. The equation predicts population means (R² = 0.47), not individuals.',
          referenceIds: ['yamada2022'],
        },
        {
          label: 'Adequate total water intake',
          value: '3.7 L (men) and 2.7 L (women), of which 3.0 and 2.2 L from beverages',
          note: 'Food supplies about 19 % of intake; metabolic water is about 0.25–0.35 L/d (unverified).',
          referenceIds: ['iom2005'],
        },
        {
          label: 'Sweat',
          value:
            'Sweat rate 0.5–2.0 L/h (over 3 L/h in about 2 % of athletes); sweat sodium 10–70 mmol/L (0.23–1.6 g Na/L, typically about 0.8 g/L)',
          note: 'Each litre sweated is a 1 kg change in body mass.',
          referenceIds: ['baker2017'],
        },
        {
          label: 'Rehydration after exercise',
          value: 'Drink about 150 % of the mass lost',
          referenceIds: ['acsm2007', 'shirreffs1997'],
        },
        {
          label: 'Exercise-induced dehydration threshold',
          value: 'Keep below 2 % of body mass',
          referenceIds: ['acsm2007'],
        },
        {
          label: 'Power at fixed intensity with a deficit of 2 % or more',
          value: 'Lower by 1.91 ± 1.53 %',
          referenceIds: ['goulet2013'],
        },
        {
          label: 'Time-trial performance with a deficit of 4 % or less',
          value: '+0.09 ± 2.60 % (p = 0.9), no impairment',
          referenceIds: ['goulet2013'],
        },
        {
          label: 'Where a 2 % threshold holds',
          value: 'Endurance capacity through volume loss; not strength, power or cognition',
          referenceIds: ['cheuvront2014'],
        },
        {
          label: 'Dilute alcohol after exercise',
          value: 'Little diuretic effect at 1–4 % ABV; 4 % delays plasma-volume recovery',
          note: 'Not modelled. Caffeine diuresis: no evidence retrieved, so not modelled (unverified).',
          referenceIds: ['shirreffs1997', 'hobson2010'],
        },
      ],
      timeCourse:
        'Thirst-driven recovery has a time constant of about 0.5 days in the model, and the deficit is capped at 2.5 kg (about 3 % of 80 kg).',
      moderators:
        'Body size, sex, age, physical activity level, athlete status, air temperature, humidity, altitude and the country’s development level all enter the turnover equation. Sweat rate and sweat sodium vary greatly between and within people.',
      grade: 'B',
      gradeReason:
        'The turnover equation rests on a large isotope dataset (A) and the exercise thresholds on a protocol-dependent meta-analysis (B); the hydration-state parameters are grade D.',
      status: 'proposed-fit',
      caveats:
        'The parameters f_kidney and τ_H are placeholders. The fluid-need equation and the 81 % share of water coming from drinks are proposals built on the published figures. Advice to drink to thirst during exercise comes from the meta-analysis, and the consensus statement on exercise-associated low blood sodium was not read in full.',
      referenceIds: [
        'yamada2022',
        'acsm2007',
        'baker2017',
        'cheuvront2014',
        'goulet2013',
        'iom2005',
        'shirreffs1997',
        'hobson2010',
      ],
      relatedMetricIds: ['waterWeight', 'scaleWeight'],
    },
    {
      id: '15-micronutrient-adequacy-flags',
      title: 'Vitamins and minerals: rule-based adequacy flags',
      category: 'recovery',
      summary:
        'There is no human dose-response evidence that could predict blood vitamin or mineral levels from what someone eats. What can be done is estimate intake as nutrient density times energy, compare it with the estimated average requirement (EAR, the intake at which half of people are short), and flag patterns known to lower nutrient density. Many people in ordinary diets already fall short on vitamin D and E, so flags are informational.',
      howModelled:
        'Each nutrient gets a traffic-light flag and a probability of inadequacy, not a simulated deficiency. Intake is a typical density per 1,000 kcal, scaled by food quality and by the pattern of eating (low carbohydrate, very low fat, animal foods excluded), times your energy, plus any supplement. It is compared with the requirement for your sex and age. The exceptions are iron, where a persistent red flag can lower an “energy” score by 0.38 SD after 8 weeks, and a small set of add-on flags. Deficiency itself is only narrated with time horizons.',
      equation:
        'd_n = D_TYPICAL_n × QMULT[Q][n] × PATTERN_MULT_n(c, f, A)\nintake_n = d_n × E/1000 + SUPP_n\nR_n = intake_n / EAR_n(sex, age)   (fibre: R = F / (14 × E/1000); vitamin K and potassium: compared with the adequate intake)\nFlag: RED if R < 0.75; AMBER if R < 1.0; YELLOW if R < 1.3; GREEN otherwise\nP_inad = Φ((1 − R) / CV), CV = 0.10 (0.15 for iron)\nCompleteness score (interface only) = 100 − 6 × #RED − 3 × #AMBER',
      keyNumbers: [
        {
          label: 'US adults with usual intake below the EAR (n = 26,282; food and drinks)',
          value:
            'Vitamin D 95 % (usual intake 4.7 µg = 188 IU vs EAR 10 µg); E 84 % (9 mg vs 12 mg); A 45 %; C 46 % (83 mg vs EAR 60–70 mg); zinc 15 % (12 mg vs EAR 6.8–9.4 mg)',
          note: 'With supplements: D 65 %, E 60 %, A 35 %, C 33 %, zinc 11 %. Vitamin A intake was 639 µg vs EAR 500–625 µg.',
          referenceIds: ['reider2020'],
        },
        {
          label: 'US adults not taking a multivitamin (food only)',
          value:
            'Magnesium 304 mg/d, 54.6 % below EAR; calcium 986 mg/d, 40.5 %; vitamin A 620 µg, 47.8 %; C 83.9 mg, 46.3 %; D 4.8 µg, 95.6 %; E 8.3 mg, 86.9 %; zinc 11.7 mg, 15.1 %; folate 551 µg DFE, 10.5 %; thiamin 1.64 mg, 5.5 %; iron 15.3 mg, 4.3 %; B12 5.3 µg, 3.3 %',
          referenceIds: ['blumberg2017'],
        },
        {
          label: 'Multivitamin/mineral users (21 or more days per month)',
          value:
            '18.8 % still below the calcium EAR and 19.3 % below the magnesium EAR; vitamin D 3.9 % vs 95.6 % in non-users',
          referenceIds: ['blumberg2017'],
        },
        {
          label: 'Potassium and vitamin K on typical US intakes (NHANES 2003–2006)',
          value: 'Only 3 % exceeded the potassium adequate intake and 35 % the vitamin K adequate intake',
          referenceIds: ['fulgoni2011'],
        },
        {
          label: 'Suggested menus of four popular diet plans (mean 1,748 kcal)',
          value:
            '100 % of the Reference Daily Intake met for only 11.75 of 27 micronutrients; low in biotin, vitamin D, vitamin E, chromium, iodine and molybdenum',
          note: 'The paper does not identify a 1,200 kcal threshold.',
          referenceIds: ['calton2010'],
        },
        {
          label:
            'A TO Z trial, 291 women, 8 weeks (intake fell from about 1,935 to about 1,370–1,480 kcal/d)',
          value:
            'More women moved into a range of inadequacy on the 17 % carbohydrate arm (thiamin, folate, vitamin C, iron, magnesium), the 49 % carbohydrate arm (vitamin E, thiamin, magnesium) and the 63 % carbohydrate, 21 % fat arm (vitamin E, B12, zinc); the 42 % carbohydrate arm of nutrient-dense foods reduced risk for A, E, K and C',
          referenceIds: ['gardner2010'],
        },
        {
          label: 'Energy at which a typical-density diet reaches the EAR (women)',
          value:
            'Magnesium about 1,720 kcal; calcium about 1,800; vitamin A about 1,420; vitamin K about 1,400; zinc about 1,280; vitamin C about 1,200; folate about 1,160; thiamin about 1,080; iron about 1,050; B12 about 770; vitamin E about 2,550 (short at any energy); vitamin D about 4,550 (short from food alone)',
          note: 'Proposed derivation from 291 US women with 24-hour recalls. EARs are unverified except vitamins D, E, A, C and zinc. Men reach the EAR at higher energies for magnesium (about 2,270 kcal), vitamin A (about 1,775), zinc (about 1,770), C (about 1,500) and K (about 1,875), and at lower for iron (about 780).',
          referenceIds: ['gardner2010', 'reider2020'],
        },
        {
          label: 'Probability of inadequacy from the intake-to-EAR ratio (R)',
          value:
            'R = 1.0 → 50 %; R = 1.2 (about the RDA) → 2.3 %; R = 0.75 → 99.4 % (CV 0.10) or 95 % (CV 0.15)',
          note: 'Unverified this session, but the standard IOM method.',
        },
        {
          label: 'Carbohydrate-restricted diets (10 studies)',
          value:
            'Intakes of thiamin, folate, magnesium, calcium, iron and iodine fell 10–70 %, with no clinical deficiency reported; one diet at about 30 % carbohydrate raised moderate iodine deficiency from 15 to 73 % at 6 months',
          referenceIds: ['churuangsuk2019'],
        },
        {
          label: 'Pattern multipliers: carbohydrate under 100 g/d or 25 % of energy, food quality 1–2',
          value:
            'Fibre ×0.5; vitamin C ×0.6; folate ×0.65; thiamin ×0.75; potassium ×0.75; magnesium ×0.8; iodine ×0.85; iron ×0.9; calcium ×0.9; A, E and K ×1.0',
          note: 'Proposed, grade D, each with ±30 % uncertainty. Anchor: a fibre fall from 26 to 12 g/d in one ward trial.',
          referenceIds: ['hall2016', 'gardner2010', 'churuangsuk2019'],
        },
        {
          label: 'Pattern multipliers: no animal foods (vegan) without fortified foods or supplements',
          value: 'B12 ×0.1; calcium ×0.75; iodine ×0.6; zinc ×0.8; vitamin D ×0.8; EPA+DHA ×0.05',
          note: 'Proposed, grade D. Vegan B12 intake was 0.24–0.49 µg/d vs 2.4 recommended; calcium was under 750 mg/d in most; vitamins A, B1, B6, C, E, iron, phosphorus, magnesium, copper and folate were not low.',
          referenceIds: ['neufingerl2021', 'bakaloudi2021'],
        },
        {
          label: 'Pattern multipliers: vegetarian (dairy and eggs)',
          value: 'B12 ×0.5; zinc ×0.85; EPA+DHA ×0.2; plus an iron-absorption penalty',
          note: 'Vegetarian ferritin −29.7 µg/L (95 % CI −39.7 to −19.7).',
          referenceIds: ['neufingerl2021', 'haider2018'],
        },
        {
          label: 'Food quality multipliers',
          value:
            'Quality 3 (varied whole foods): ×1.35 on magnesium, potassium, folate, vitamin C, A, K and fibre; ×1.2 calcium and zinc; ×1.5 vitamin D if fish; ×1.5 vitamin E if nuts or seeds. Quality 1 (mostly refined or ultra-processed): ×0.8 on the same nutrients',
          note: 'Proposed. Modelled seven-day plans at 20, 40 and 100 g net carbohydrate exceeded RDA or EAR for most micronutrients (menu modelling, not measured intake).',
          referenceIds: ['hall2019', 'gardner2010', 'banner2024'],
        },
        {
          label: 'Fat-soluble absorption with very low fat',
          value:
            'Carotenoid absorption negligible with a fat-free dressing and higher with 28 g than 6 g oil; vitamin D3 peak 32 % higher with a 30 %-fat meal than fat-free; vitamin E absorption low with 2.7 g fat or none vs 17.5 g',
          referenceIds: ['brown2004', 'dawsonhughes2015', 'jeanes2004'],
        },
        {
          label: 'Iron in women',
          value:
            '9–11 % of US women aged 12–49 are iron deficient and 2–5 % anaemic; RDA 18 mg/d premenopausal vs 8 mg for men and post-menopausal women',
          note: 'The RDA values and menstrual blood loss of about 30–40 mL per cycle are unverified.',
          referenceIds: ['looker1997', 'pasricha2021'],
        },
        {
          label: 'Iron therapy in non-anaemic iron deficiency',
          value:
            'Self-reported fatigue SMD −0.38 (95 % CI −0.52 to −0.23; 4 trials, 714 people); VO₂max SMD 0.11; haemoglobin +4.0 g/L. In women with unexplained fatigue, 80 mg/d iron for 4 weeks lowered fatigue by 29 % vs 13 % on placebo, only when ferritin was 50 µg/L or below',
          referenceIds: ['verdon2003', 'houston2018'],
        },
        {
          label: 'Vitamin D and vitamin C facts used for flags',
          value:
            'Vitamin D supplements cut acute respiratory infection OR 0.88 (0.81–0.96), and OR 0.30 if baseline 25-OH-D was under 25 nmol/L, with no effect on fractures, falls or bone density in general adults; about 10 mg/d vitamin C prevents scurvy',
          referenceIds: ['carr2020', 'martineau2017', 'bolland2018'],
        },
        {
          label: 'Essential fatty acids',
          value:
            'A weekly 500 mL of 20 % lipid kept the Holman index below 0.2 in patients on home parenteral nutrition',
          note: 'Flag: AMBER if fat under 20 g/d; RED if under 15 g/d for more than 4 weeks.',
          referenceIds: ['jeppesen1998'],
        },
      ],
      timeCourse:
        'Deficits are narrated, not simulated. Iron stores deplete over months (unverified); B12 deficiency typically takes more than a year on a vegan diet without supplements (liver stores; unverified); thiamin can run short within weeks at very low energy plus alcohol (unverified); vitamin C signs usually appear after 1–3 months at near-zero intake (unverified); iodine and vitamin D over months. Nutrient intake in the model follows 7-day averages of energy, carbohydrate and fat.',
      moderators:
        'Energy intake, carbohydrate and fat level, food quality and variety, animal-food exclusion, supplement use, sex, age and menstruation (for iron).',
      grade: 'C',
      gradeReason:
        'The density-based projection rests on observational US intake data (grade C), the pattern and quality multipliers are expert-style scalings (grade D), and the individual facts they are anchored to are grade A or B.',
      status: 'proposed-fit',
      caveats:
        'The nutrient densities come from 291 US women using 24-hour recalls, which tend to under-report energy, and from a fortified US food supply. Most EAR values were not re-checked. The EAR is the median requirement, so half of people would be short at that intake. Time-to-deficiency figures are mostly unverified. Functional consequences differ by nutrient: iron lowers fatigue but not VO₂max; B12, thiamin, vitamin C, vitamin D, magnesium and iodine are flag-only; potassium, calcium and fibre are chronic-risk flags. Tone in the app should stay informational, since most ordinary diets trigger flags for vitamin D and E. Several source documents could not be opened during the literature review.',
      referenceIds: [
        'lennerz2021',
        'hall2019',
        'hall2016',
        'calton2010',
        'gardner2010',
        'churuangsuk2019',
        'neufingerl2021',
        'bakaloudi2021',
        'haider2018',
        'reider2020',
        'blumberg2017',
        'fulgoni2011',
        'verdon2003',
        'houston2018',
        'looker1997',
        'pasricha2021',
        'brown2004',
        'dawsonhughes2015',
        'jeanes2004',
        'jeppesen1998',
        'carr2020',
        'banner2024',
        'martineau2017',
        'bolland2018',
      ],
      relatedMetricIds: ['micronutrientScore'],
    },
    {
      id: '15-alcohol-metabolism-and-partitioning',
      title: 'Alcohol: how the body handles a drink',
      category: 'fuel',
      summary:
        'The body cannot store ethanol, so it burns it first and burns less fat while it does. Alcohol energy still counts. Fat is spared only in the short-term sense of fuel choice; body fat rises only if total intake exceeds needs. Alcohol also adds a little food intake, lowers muscle protein synthesis after training at high doses, and worsens the following night’s recovery.',
      howModelled:
        'Each drink is 14 g of ethanol and about 98 kcal (7 kcal per g). A queue of unoxidised ethanol clears at a fixed rate that depends on body weight and sex. While the queue is not empty, fat oxidation falls by about two thirds of the alcohol energy oxidised, without changing the energy that counts. The model adds roughly 80 kcal of extra food intake per drinking session, but only in free-eating mode. After training, a dose-based penalty reduces muscle protein synthesis for up to 8 hours. The planner defaults to zero alcohol and never prescribes it.',
      equation:
        'alc_g = drinks × 14   (1 drink = 98 kcal at 7 kcal/g)\nME_alc = alc_g × 7 × (1 − TEF_alc)   with TEF_alc = 0.10 (0.05–0.22)\nEtOH(t+dt) = EtOH(t) − min(EtOH(t), k_ox × BW × dt)   with k_ox = 0.10 g/kg/h (men), 0.085 g/kg/h (women)\nΔFatOx_kcal(day) = −φ × min(7 × alc_g_oxidised_today, FatOx_base)   with φ = 0.66 (range 0.66–0.9), about −4.6 kcal of fat oxidation per g ethanol\nLipolysis (NEFA) × 0.47 during clearance; carbohydrate and protein oxidation unchanged over 24 h\nKetone production × (1 − 0.5 × [EtOH > 0])   (assumption, grade D)\nMPS multiplier (from training end until ethanol cleared, max 8 h) = 1 − 0.16 × dose_g/kg with ≥ 0.3 g/kg protein within 2 h (floor −0.25); = 1 − 0.25 × dose_g/kg with no protein (floor −0.37)\nNext-night recovery penalty (fraction of the recovery scale) = 0.09 | 0.24 | 0.39 for dose ≤ 0.25 | ≤ 0.75 | > 0.75 g/kg',
      keyNumbers: [
        {
          label: 'Fate of 24 g ethanol (8 men)',
          value:
            'About 77 % of cleared ethanol becomes acetate in the liver; lipid oxidation −73 % over 6 h; NEFA release −53 %; hepatic de novo lipogenesis under 5 % of the dose',
          referenceIds: ['siler1999'],
        },
        {
          label: 'Calorimeter, 96 g/d ethanol (25 % of energy)',
          value:
            'Lipid oxidation −49.4 g/d (−36 %) when added; −44.1 g/d (−31 %) when it replaced fat or carbohydrate; 24-h energy expenditure +7 % or +4 %',
          note: 'Carbohydrate and protein oxidation unchanged; the effect occurred only in the hours when ethanol was being metabolised.',
          referenceIds: ['suter1992'],
        },
        {
          label: 'Intravenous ethanol (21.8 g oxidised in 4 h)',
          value: 'Fat oxidation −79 %; protein oxidation −39 %; glucose disposal −36 %',
          referenceIds: ['shelmet1988'],
        },
        {
          label: 'Is alcohol energy fully available? For',
          value:
            'Ethanol thermogenesis 22.5 % of ethanol energy with meals (17.1 % fasting) in 6 subjects, about 80 % metabolisable; a meal with 23 % of energy as ethanol raised diet-induced thermogenesis 27 % more than carbohydrate or fat meals (19 subjects)',
          referenceIds: ['suter1994', 'raben2003'],
        },
        {
          label: 'Is alcohol energy fully available? Against',
          value:
            '20 g ethanol had no effect on diet-induced thermogenesis; thermic effect similar to carbohydrate; in 48 adults over 16 weeks, replacing carbohydrate with 5 % of energy as ethanol left total energy expenditure unchanged',
          referenceIds: ['sonko1994', 'weststrate1990', 'rumpler1996'],
        },
        {
          label: 'Food intake after alcohol (22 studies, 701 people, aged 18–37)',
          value:
            'Food energy +343 kJ (+82 kcal; 95 % CI +38 to +125); total energy +1,072 kJ (+256 kcal; +196 to +316)',
          note: 'A meal rich in ethanol did not change ad libitum intake in the next 5 hours (19 people).',
          referenceIds: ['raben2003', 'kwok2019', 'yeomans2010'],
        },
        {
          label: 'Alcohol clearance',
          value:
            'Population mean 15 mg/100 mL/h (range 10–35); 14 g clears in about 1.75 h for an 80 kg man; 6 drinks in about 10 h',
          note: 'The Widmark factors behind the sex-specific rates (0.68 and 0.55) are unverified.',
          referenceIds: ['jones2010'],
        },
        {
          label: 'Standard drink',
          value: '14 g pure alcohol (US); UK unit 8 g and Australia 10 g',
          note: 'The UK and Australian values are unverified.',
          referenceIds: ['niaaa2026'],
        },
        {
          label:
            'Muscle protein synthesis after training (8 active men, 1.5 g/kg alcohol as about 12 standard drinks)',
          value:
            'Myofibrillar synthesis −24 % with 25 g whey and −37 % with carbohydrate, relative to whey alone; still 29–109 % above rest in all conditions',
          referenceIds: ['parr2014'],
        },
        {
          label: 'Hormones (controlled diet, 3 weeks, beer with dinner)',
          value:
            'At 40 g/d (men) or 30 g/d (women): testosterone −6.8 % in men (95 % CI −1.0 to −12.5), no change in women; DHEAS +16.5 %; HDL-C +11.7 %',
          note: 'Not modelled; warning only.',
          referenceIds: ['sierksma2004'],
        },
        {
          label: 'Sleep',
          value:
            'Any dose shortens sleep latency and adds early slow-wave sleep, then disrupts the second half; REM is reduced and delayed at moderate and high doses. HRV-derived recovery fell by 9.3, 24.0 and 39.2 percentage units after low (0.25 g/kg or less), moderate (0.25–0.75) and high (over 0.75 g/kg) doses (n = 4,098)',
          note: '0.25 g/kg is about 1.4 drinks and 0.75 g/kg about 4.3 drinks for 80 kg.',
          referenceIds: ['ebrahim2013', 'pietila2018'],
        },
        {
          label: 'Lipids at 30 g/d ethanol (42 feeding studies, 1–9 weeks)',
          value: 'HDL-C +3.99 mg/dL; apoA-I +8.82 mg/dL; triglycerides +5.69 mg/dL (2.49–8.89)',
          referenceIds: ['rimm1999'],
        },
        {
          label: 'Mortality risk (599,912 drinkers, 83 studies)',
          value:
            'Risk rises above about 100 g/week (7 US drinks); per extra 100 g/week: stroke 1.14 (1.10–1.17), heart failure 1.09 (1.03–1.15), fatal hypertensive disease 1.24 (1.15–1.33)',
          referenceIds: ['wood2018'],
        },
        {
          label: 'Hypoglycaemia when fasted',
          value: 'Warn if fasted for more than 16 h with low glycogen and 2 or more drinks',
          note: 'Mechanism paper only; ketone data at moderate doses were not retrieved.',
          referenceIds: ['field1963'],
        },
        {
          label: 'Fluid balance after exercise',
          value: 'Dilute alcohol (1–4 %) has little diuretic effect; 4 % delays plasma-volume recovery',
          note: 'Not modelled.',
          referenceIds: ['shirreffs1997', 'hobson2010'],
        },
      ],
      timeCourse:
        'Fat-oxidation suppression lasts only while ethanol is being cleared, which is about 1.75 hours per drink for an 80 kg man. The muscle-protein penalty applies from the end of training until ethanol clears, up to 8 hours. The recovery penalty applies to the next night.',
      moderators:
        'Dose and drinking pattern (with meal, evening, binge), body weight and sex (clearance rate), whether protein is eaten after training, fasting state and timing relative to bed.',
      grade: 'B',
      gradeReason:
        'Fat-oxidation suppression and the appetite effect rest on consistent small calorimetry and isotope studies and a meta-analysis (B), while the thermic effect, muscle penalty and sleep dose–response are grade C.',
      status: 'established',
      caveats:
        'Whether alcohol energy is fully available is contested, so the thermic share carries a wide range (5–22 %). The muscle-protein figure comes from a single small trial at about 12 drinks, and the model draws a straight line through the origin from that one high dose; there is no human dose–response below about 1 g/kg (grade C/D). The effects of alcohol on ketone levels in ketogenic eaters were not retrieved. Chronic heavy use causes liver fat build-up, but no quantitative source was retrieved (unverified). Warnings cover more than 7 drinks per week (100 g), more than 3 in a day, binge drinking (4 or more in 2 hours), drinking within 3 hours of bed, on a training day, during a fast longer than 16 h or on a very-low-energy diet, and with thiamin-poor intake. Alcohol is never simulated as a calorie-neutral or fat-loss tool.',
      referenceIds: [
        'siler1999',
        'suter1992',
        'suter1994',
        'shelmet1988',
        'sonko1994',
        'weststrate1990',
        'rumpler1996',
        'raben2003',
        'kwok2019',
        'yeomans2010',
        'parr2014',
        'sierksma2004',
        'ebrahim2013',
        'pietila2018',
        'rimm1999',
        'wood2018',
        'jones2010',
        'shirreffs1997',
        'hobson2010',
        'field1963',
        'niaaa2026',
      ],
      relatedMetricIds: ['fatOxidation', 'tdee'],
    },
    {
      id: '15-caffeine-energy-performance-sleep',
      title: 'Caffeine: a small energy boost, a real performance and sleep effect',
      category: 'performance',
      summary:
        'Caffeine blocks the brain’s adenosine receptors, raises stress hormones a little, and speeds energy use and fat release modestly. It helps endurance, strength and power, and it also delays sleep and reduces its depth for hours, because it clears slowly. The calorie effect is small; the sleep effect is not.',
      howModelled:
        'The engine tracks caffeine in the body with a single half-life of 5.4 hours. It adds a small energy-expenditure term relative to a 150 mg/day habit, reduced by tolerance that builds over about 14 days of daily use. It applies a small performance multiplier for endurance and strength based on dose per kilogram. It works out the amount of caffeine left at bedtime and hands that to the sleep module. Caffeine is not offered as a fat-loss lever. Green-tea catechins are treated as caffeine.',
      equation:
        'C_caf(t) = C_caf(t−dt) × 2^(−dt/t_half) + dose(t)   with t_half = 5.4 h\nΔEE_day = κ_c × (mg_today − mg_hab) × (1 − 0.5 × Tol_caf)   with κ_c = 0.10 kcal/mg (range 0.05–0.25), mg_hab = 150 mg\nTol_caf: 0 → 1 with τ = 14 d of daily use ≥ 200 mg\nEndurance multiplier = 1 + 0.03 × min(1, (mg/kg)/3) × (1 − 0.6 × Tol_perf)\nStrength multiplier = 1 + 0.015 × min(1, (mg/kg)/3) × (1 − 0.6 × Tol_perf)\nBedtime load: A_bed = Σ dose_i × 2^(−(t_bed − t_i)/t_half)\nNo-effect threshold R* ≈ 37 mg;  TST_loss_min = min(120, 0.40 × max(0, A_bed − 37))   (sleep equations owned by the sleep topic)',
      keyNumbers: [
        {
          label: 'Kinetics',
          value: 'Peak in blood 30–120 min; half-life typically 4–6 h (range 1.5–10 h); 5.4 h used',
          note: 'About 95 % is metabolised by the liver enzyme CYP1A2, and speed varies with genotype, smoking, hormones, liver disease, obesity and diet. The sleep topic adds ×1.47 with a combined oral contraceptive and ×0.56 in smokers.',
          referenceIds: ['guest2021', 'nehlig2018'],
        },
        {
          label: 'Energy expenditure: 100 mg and 600 mg',
          value:
            '100 mg raised resting rate 3–4 % over 150 min; 100 mg every 2 h for 12 h (600 mg) raised daytime energy expenditure 8–11 % and 24-h expenditure by 150 kcal (lean) or 79 kcal (post-obese), with no carry-over to the night',
          referenceIds: ['dulloo1989'],
        },
        {
          label: 'Chamber meta-analysis (6 studies, 18 conditions)',
          value:
            'Caffeine alone +429 kJ (+4.8 %) in 24-h energy expenditure, slope 0.44 kJ per mg (0.105 kcal/mg); catechin plus caffeine +428 kJ (+4.7 %) and +12.2 g/d (+16 %) fat oxidation (caffeine alone +9.5 g/d, +12.4 %, p = 0.11)',
          referenceIds: ['hursel2011'],
        },
        {
          label: 'Dose-response and body type',
          value:
            'Effects rose with 100, 200 and 400 mg, in step with plasma lactate and triglycerides; at 8 mg/kg (or coffee 4 mg/kg) metabolic rate rose, and fat oxidation rose only in lean people',
          referenceIds: ['astrup1990', 'acheson1980'],
        },
        {
          label: 'Fasted exercise (19 crossover studies, 2–7 mg/kg)',
          value:
            'Fat-oxidation rate SMD 0.73 (95 % CI 0.19–1.27); needed more than 3 mg/kg and worked better in untrained people',
          note: 'SMD is a standardised mean difference, a unit-free effect size. Not modelled beyond the 24-h chamber figure.',
          referenceIds: ['colladomateo2020'],
        },
        {
          label: 'Weight and appetite',
          value:
            'Weight trials heterogeneous (13 RCTs, I² 91–94 %); caffeine 0.5–4 h before a meal may reduce acute intake, coffee 3–4.5 h before has minimal effect',
          referenceIds: ['tabrizi2019', 'schubert2017'],
        },
        {
          label: 'Model energy effect',
          value:
            '400 mg vs 150: +25 kcal/d (+12 with full tolerance); 600 mg: +45 kcal/d; net effect 60 kcal/d or less for realistic intakes',
          note: 'Published upper bound +150 kcal/d at 600 mg in naive-to-moderate users.',
          referenceIds: ['dulloo1989'],
        },
        {
          label: 'Performance dosing',
          value:
            '3–6 mg/kg about 60 min before exercise; minimum effective about 2 mg/kg; 9 mg/kg gives side effects without extra benefit',
          referenceIds: ['guest2021'],
        },
        {
          label: 'Endurance time trials at 3–6 mg/kg (46 studies)',
          value: 'Time −2.22 ± 2.59 % (effect size 0.41); mean power +3.03 ± 3.07 % (effect size 0.23)',
          referenceIds: ['southward2018'],
        },
        {
          label: 'Strength and power',
          value: 'Strength SMD 0.20 (0.03–0.36), upper body only; power SMD 0.17 (0.00–0.34)',
          note: 'An umbrella review of 21 meta-analyses found caffeine ergogenic for aerobic endurance, muscle strength, muscle endurance and power (moderate-quality evidence). Converting SMD 0.2 to 1.5–2 % is unverified.',
          referenceIds: ['grgic2020', 'grgic2018'],
        },
        {
          label: 'Tolerance (18 low-habitual consumers, under 75 mg/d)',
          value:
            'Four weeks of 1.5–3 mg/kg/d removed the ergogenic benefit (external work 383 → 358 kJ, vs unchanged placebo group)',
          note: 'Habitual users seem to keep the benefit (mixed evidence). A habitual intake above 300 mg/d non-significantly blunted the catechin effect (−0.27 vs −1.60 kg, p = 0.09).',
          referenceIds: ['hursel2009', 'guest2021', 'beaumont2017'],
        },
        {
          label: 'Sleep (meta-analysis of 24 studies)',
          value:
            'Total sleep time −45 min; sleep efficiency −7 %; sleep-onset latency +9 min; wake after sleep onset +12 min; light sleep +6.1 min; deep sleep −11.4 min',
          referenceIds: ['gardiner2023'],
        },
        {
          label: 'Cut-off times before bed to avoid sleep loss',
          value:
            'Coffee (107 mg per 250 mL) at least 8.8 h before bed; pre-workout (217.5 mg) at least 13.2 h before bed',
          note: 'These leave 35 mg and 40 mg in the body at a half-life of 5.4 h, which sets the threshold of about 37 mg. 400 mg taken 6 h before bed gives about 60 min of lost sleep in the model.',
          referenceIds: ['gardiner2023'],
        },
        {
          label: 'Objective sleep after 400 mg',
          value: '400 mg taken 6 h before habitual bedtime still disrupted sleep',
          referenceIds: ['drake2013'],
        },
        {
          label: 'Green tea catechins',
          value:
            'Meta-analysis (11 studies): −1.31 kg (P < 0.001), smaller with high habitual caffeine; Cochrane (14 trials of 12 weeks or more): non-Japanese studies −0.04 kg (95 % CI −0.5 to 0.4), Japanese studies −0.2 to −3.5 kg, heterogeneous',
          referenceIds: ['hursel2009', 'jurgens2012'],
        },
        {
          label: 'Green tea chamber trial (10 men)',
          value:
            '90 mg EGCG + 50 mg caffeine three times a day raised 24-h energy expenditure 4 % (p < 0.01) and lowered the respiratory quotient from 0.88 to 0.85; 50 mg caffeine alone did nothing',
          note: 'High-dose extract hepatotoxicity warning at about 800 mg EGCG/d is unverified.',
          referenceIds: ['dulloo1999'],
        },
      ],
      timeCourse:
        'Caffeine peaks within 30–120 minutes and has a half-life of about 5.4 hours in the model. Tolerance to the energy and performance effects builds over roughly 14–28 days of daily use in low-habitual users. The sleep effect persists regardless of habit.',
      moderators:
        'Genotype, smoking, hormonal contraception, liver disease, obesity and diet change the half-life; habitual intake changes tolerance; body weight scales the dose per kilogram; training status and lean vs obese body type affect the fat-oxidation response.',
      grade: 'B',
      gradeReason:
        'The energy effect rests on chamber studies and one meta-analysis of six (B), performance and sleep effects are grade A, and tolerance and green tea are grade C or D.',
      status: 'established',
      caveats:
        'The energy slope is inconsistent between sources (0.105 kcal/mg pooled vs 0.25 kcal/mg in the single 600 mg study). Thermogenic tolerance has not been measured. The sleep dose–response shape between the two anchor points is an interpolation. The performance conversions are proposals. Safety limits: keep the bedtime load under 30 mg; single doses up to 3 mg/kg; warn above 400 mg/d (unverified) and lower in pregnancy (200 mg; unverified).',
      referenceIds: [
        'dulloo1989',
        'astrup1990',
        'acheson1980',
        'hursel2011',
        'hursel2009',
        'jurgens2012',
        'dulloo1999',
        'colladomateo2020',
        'tabrizi2019',
        'schubert2017',
        'grgic2020',
        'southward2018',
        'grgic2018',
        'guest2021',
        'gardiner2023',
        'drake2013',
        'beaumont2017',
        'nehlig2018',
      ],
      relatedMetricIds: ['rmr', 'sleepQuality'],
    },
    {
      id: '15-creatine-muscle-water-strength',
      title: 'Creatine: fills the muscle store, holds some water, adds a little strength',
      category: 'performance',
      summary:
        'Muscle takes up creatine through a transporter that fills to a ceiling. Higher stores help short, intense efforts and training volume. Creatine also draws water into muscle cells, so scale weight rises by about half a kilogram to a kilogram within days of loading, or about four weeks at a low daily dose. Body-scan “lean mass” gains of about 1 kg include much of that water; direct imaging shows only a very small extra muscle growth.',
      howModelled:
        'The engine keeps one state: how far muscle creatine has risen above baseline, up to about 20 % on a typical dose. It fills faster with higher daily doses and empties over about 30 days after stopping. Water weight is a fixed fraction of how full the store is. A scan-measured lean-mass change is the sum of that water plus a small true muscle gain scaled by the store level. The hypertrophy rate gets a small boost. Non-responders are shown as a lower range rather than a random draw.',
      equation:
        'x_target(D) = x_max × min(1, D/2.5)   (D = daily dose in g; x_max = 0.20, range 0.10–0.40)\nτ_up(D) = clamp(30/D, 1.5, 15) d   (proposed fit)\nτ_down = 10 d\ndx/dt = (x_target − x) / (τ_up if x_target > x, otherwise τ_down)\nNon-responders: x_max × 0.25\nCreatine water: W_Cr = 0.9 kg × (x / x_max)   (range 0.5–1.5 kg)\nScan lean mass: ΔLBM_DXA = W_Cr + m_true, with m_true = 0.3 kg per 12 weeks of resistance training × (x / x_max)   (0–0.6)\nHypertrophy-rate multiplier = 1 + 0.05 × (x / x_max)   (0–10 %)',
      keyNumbers: [
        {
          label: 'Muscle creatine level',
          value:
            'About 120 mmol/kg dry muscle, ceiling about 160; supplements raise creatine and phosphocreatine by 20–40 %',
          note: 'About 1–2 % of the muscle pool is broken down to creatinine daily, so the body needs about 1–3 g/d, half from diet and synthesis.',
          referenceIds: ['kreider2017'],
        },
        {
          label: 'Non-responders',
          value: '20–30 % of individuals show under 8 % increase',
          note: 'Prevalence comes from a secondary quote.',
          referenceIds: ['powers2003'],
        },
        {
          label: 'Loading and maintenance kinetics (31 men)',
          value:
            '20 g/d for 6 d raised muscle total creatine about 20 %; 2 g/d for 30 d maintained it; without maintenance it fell to baseline over about 30 d; 3 g/d reached the same 20 % rise in 28 d',
          referenceIds: ['hultman1996'],
        },
        {
          label: 'Standard protocol',
          value: '0.3 g/kg/d (5 g four times a day) for 5–7 d, then 3–5 g/d',
          referenceIds: ['kreider2017'],
        },
        {
          label: 'Body weight and water (32 trained adults, 25 g/d for 7 d then 5 g/d for 21 d)',
          value:
            'Body mass +0.75 kg at day 7 (not significant), significantly higher by day 28; total body water rose; extra- vs intracellular distribution unchanged',
          note: 'Loading produces about 0.5–1.0 L of fluid retention, proportional to the acute weight gain.',
          referenceIds: ['powers2003', 'kreider2017'],
        },
        {
          label: 'Adults under 50, training with or without creatine (12 RCTs)',
          value:
            'Lean body mass +1.14 kg (95 % CI 0.69–1.59); fat mass −0.73 kg (−1.34 to −0.11); body fat −0.88 % (−1.66 to −0.11)',
          note: 'About 7 g/d or 0.3 g/kg gave about +1 kg lean mass; no effect of training status or carbohydrate co-ingestion.',
          referenceIds: ['desai2024'],
        },
        {
          label: 'Older adults aged 57–70 (22 RCTs, 721 people, 7–52 weeks)',
          value:
            'Lean tissue mass +1.37 kg (0.97–1.76); chest press SMD 0.35 (0.16–0.53); leg press SMD 0.24 (0.05–0.43)',
          note: 'SMD is a standardised mean difference, a unit-free effect size.',
          referenceIds: ['chilibeck2017'],
        },
        {
          label: 'Direct imaging of muscle (10 RCTs, 6 weeks or more, MRI, CT or ultrasound)',
          value:
            'Pooled SMD 0.11 (95 % credible interval −0.02 to 0.25); muscle thickness +0.10–0.16 cm; slightly larger in young than old',
          referenceIds: ['burke2023'],
        },
        {
          label: 'Postmenopausal women (7 RCTs, 608 people)',
          value:
            'Lean mass +0.37 kg (0.05–0.69); leg-press 1RM +7.5 kg (2.2–12.8); benefit with 5 g/d or more plus training, none with 3 g/d or less without training; bone density unchanged',
          referenceIds: ['naddafha2026'],
        },
        {
          label: 'Strength conversion',
          value: 'About +3 to +8 % 1RM in trained users, scaled by x / x_max',
          note: 'Conversion from the effect sizes (SMD 0.24–0.35) is unverified.',
          referenceIds: ['chilibeck2017'],
        },
        {
          label: 'Safety',
          value:
            'Up to 30 g/d for 5 years was well tolerated in healthy people; 0.3–0.8 g/kg/d for up to 5 years without adverse effects',
          note: 'Serum creatinine rises modestly without loss of kidney filtration (an interpretation caveat, unverified); physician advice is recommended in kidney disease.',
          referenceIds: ['kreider2017'],
        },
      ],
      timeCourse:
        'At 20 g/d the store is about 95 % full in roughly 5 days (τ 1.5 d); at 3 g/d it takes about 28 days (τ 10 d). Water appears with loading within about a week, or after about 4 weeks at 3 g/d, and disappears about 30 days after stopping.',
      moderators:
        'Baseline creatine (the store may rise more from a low baseline, for example in vegetarians; unverified), responder status, daily dose, training, and age and sex (whether women and older adults follow the same kinetics is not known).',
      grade: 'B',
      gradeReason:
        'Strength and lean-mass effects are grade A and the time course grade B, but how much of the scan-measured gain is water is only grade C.',
      status: 'proposed-fit',
      caveats:
        "The gap between scan-measured lean mass (+1.1 to 1.4 kg, about 0.5–1 kg of it water) and directly imaged extra muscle growth (SMD 0.11, about 1–2 mm of thickness) was reconciled by Vitals' own reading of the evidence, not by the trials. Whether women and older adults follow the same time course is not established, and the non-responder prevalence comes from a secondary quote.",
      referenceIds: [
        'hultman1996',
        'powers2003',
        'kreider2017',
        'chilibeck2017',
        'desai2024',
        'burke2023',
        'naddafha2026',
      ],
      relatedMetricIds: ['scaleWeight', 'waterWeight', 'rtMuscleGain'],
    },
    {
      id: '15-other-supplements-verdicts',
      title: 'Other supplements: what has evidence and what does not',
      category: 'cardio',
      summary:
        'Most supplements have little or no measurable effect on the outcomes Vitals models. A few have solid evidence in a specific group: omega-3 fats when triglycerides are very high, and vitamin D when someone is deficient. The rest are described as having no modelled effect. Vitals treats protein powder as ordinary protein.',
      howModelled:
        'Omega-3 and vitamin D are simple on/off switches, both off by default. They feed a small triglyceride link in the lipid module and a deficiency rule in the micronutrient module. Medium-chain triglycerides (MCT) are an advanced input in grams per day, default zero, with a tiny weight and ketone effect. Branched-chain amino acids, fat burners, exogenous ketones and “detox” products get a one-line “no modelled effect” note.',
      keyNumbers: [
        {
          label: 'Omega-3 (EPA+DHA) at 4 g/d',
          value:
            'Lowers triglycerides by 30 % or more when they are very high (500 mg/dL or more); LDL may rise',
          referenceIds: ['skulasray2019'],
        },
        {
          label: 'Omega-3 and cardiovascular events (40 trials, 135,267 people)',
          value:
            'Heart attack RR 0.87 (0.80–0.96); coronary heart disease events RR 0.90 (0.84–0.97); dose-dependent',
          referenceIds: ['bernasconi2021'],
        },
        {
          label: 'Vitamin D and respiratory infections',
          value: 'OR 0.88 (0.81–0.96); OR 0.30 if baseline 25-OH-D was under 25 nmol/L',
          referenceIds: ['martineau2017'],
        },
        {
          label: 'Vitamin D and bone (81 RCTs)',
          value: 'Fractures RR 1.00 (0.93–1.07); hip fracture 1.11; falls 0.97',
          referenceIds: ['bolland2018'],
        },
        {
          label: 'Medium-chain triglycerides vs long-chain (13 trials, 749 people, over 3 weeks)',
          value:
            'Body weight −0.51 kg (−0.80 to −0.23); waist −1.46 cm; visceral fat SMD −0.55; blood lipids unchanged',
          note: 'Commercial bias was noted.',
          referenceIds: ['mumme2015'],
        },
        {
          label: 'Isolated viscous fibre such as psyllium',
          value: '−0.81 kg inside calorie restriction; −2.52 kg without restriction (very heterogeneous)',
          referenceIds: ['thompson2017', 'jovanovski2021'],
        },
        {
          label: 'Branched-chain amino acids',
          value:
            'No study shows oral BCAA alone stimulates muscle protein synthesis; intravenous BCAA lowered synthesis and breakdown',
          referenceIds: ['wolfe2017'],
        },
        {
          label: '“Fat burners” and thermogenic stimulants',
          value: 'Most supplements produce under 2 kg; stimulants carry adverse effects',
          referenceIds: ['manore2012'],
        },
        {
          label: 'Exogenous ketones',
          value:
            'Ketone ester peaks at 2.8 mM vs 1.0 mM for ketone salts and returns to baseline in 3–4 h; lowers glucose, free fatty acids and triglycerides; food lowers the peak by 33 %',
          note: 'No proven benefit for weight or performance.',
          referenceIds: ['stubbs2017'],
        },
        {
          label: 'Magnesium for muscle cramps',
          value: 'Not shown to help',
          note: 'Conclusion beyond the abstract is unverified.',
          referenceIds: ['garrison2020'],
        },
        {
          label: 'Sodium electrolytes',
          value: '0.23–1.6 g sodium per litre of sweat',
          note: 'Relevant during heavy sweating or the early low-carbohydrate transition; grade C/D.',
          referenceIds: ['baker2017'],
        },
      ],
      moderators: 'Baseline status (deficiency for vitamin D, very high triglycerides for omega-3) and dose.',
      grade: 'B',
      gradeReason:
        'Omega-3 and vitamin D effects rest on meta-analyses (A), MCT and viscous fibre on meta-analyses of modest quality (B/C), and the negative verdicts on reviews (B).',
      status: 'established',
      caveats:
        'Effects for omega-3 and vitamin D appear mainly in deficient people or those with very high triglycerides. Statements marked unverified should be checked before release. Green tea is covered in the caffeine mechanism and creatine has its own.',
      referenceIds: [
        'thompson2017',
        'jovanovski2021',
        'baker2017',
        'skulasray2019',
        'bernasconi2021',
        'martineau2017',
        'bolland2018',
        'mumme2015',
        'wolfe2017',
        'manore2012',
        'stubbs2017',
        'garrison2020',
      ],
      relatedMetricIds: ['triglycerides', 'micronutrientScore'],
    },
    {
      id: '15-bone-during-weight-loss',
      title: 'Bone density during weight loss, and what softens it',
      category: 'body',
      summary:
        'Losing weight through diet lowers bone density at the hip by about 1–1.5 % over 6 to 24 months, with no clear change in the spine. Bone-breakdown markers rise within 2–3 months. In one trial of older adults with obesity, hip bone density fell about 3 % with diet alone and about 1 % with diet plus exercise. In five trials, extra protein slightly raised spine density. Vitamin D supplements did not change fractures, falls or density in general adults.',
      howModelled:
        'The engine gives hip bone density change during weight loss as an output range (about −1 to −1.5 % over 6–24 months) for the performance and bone topic. It raises warnings if projected calcium intake falls below the requirement, if the energy deficit exceeds 25 % for more than 12 weeks, or if resistance-training load is low.',
      keyNumbers: [
        {
          label: 'Diet-induced weight loss (41 publications)',
          value:
            'Total-hip bone density −0.010 to −0.015 g/cm² at 6, 12 and 24 months (about 1–1.5 %); no change at lumbar spine or whole body, except total body −0.011 g/cm² at 6 months',
          referenceIds: ['zibellini2015'],
        },
        {
          label: 'Bone turnover markers at 2–3 months',
          value: 'Osteocalcin +0.26 nmol/L; CTX +4.72 nmol/L',
          referenceIds: ['zibellini2015'],
        },
        {
          label: 'Older adults with obesity (65 or older, 1 year, about 10 % weight loss)',
          value:
            'Hip bone density fell about 3 % with diet only vs about 1 % with diet plus exercise; lean mass −5 % vs −3 %',
          referenceIds: ['villareal2011'],
        },
        {
          label: 'Higher protein (5 RCTs)',
          value:
            'Lumbar-spine bone density +0.52 % (0.06–0.97); no change at hip, femoral neck or total body; no adverse effect',
          referenceIds: ['shamswhite2017'],
        },
        {
          label: 'Vitamin D supplements in general adults',
          value: 'No change in fractures, falls or bone density',
          referenceIds: ['bolland2018'],
        },
      ],
      timeCourse:
        'Bone-resorption markers rise at 2–3 months, and hip bone density is lower by about 1–1.5 % at 6, 12 and 24 months.',
      moderators:
        'Exercise (in older adults with obesity, hip loss was about 1 % with exercise vs about 3 % without), protein intake, and the size and length of the energy deficit (the model warns above a 25 % deficit for more than 12 weeks).',
      grade: 'A',
      gradeReason:
        'The weight-loss bone effect comes from a meta-analysis; the mitigating effects of exercise and protein are grade B.',
      status: 'established',
      caveats:
        'The weight-loss figures come from trials in overweight and obese adults. The exercise result comes from one 1-year trial in older adults and the protein result from 5 RCTs.',
      referenceIds: ['bolland2018', 'zibellini2015', 'villareal2011', 'shamswhite2017'],
      relatedMetricIds: ['hipBmdChange'],
    },
    {
      id: '15-non-nutritive-sweeteners',
      title: 'Zero-calorie sweeteners and body weight',
      category: 'energy',
      summary:
        'In trials, swapping sugar-sweetened drinks or foods for zero-calorie sweetened versions reduced energy intake and weight slightly. The benefit comes from the sugar energy that was displaced: there was no difference compared with drinking water. Observational studies show the opposite link, but those associations are likely confounded. Whether some sweeteners upset blood sugar in some people is unsettled.',
      howModelled:
        'The engine treats sweeteners as zero-calorie foods. It models no state and no direct effect on weight or insulin. A one-line note explains that any weight benefit is the displaced sugar energy.',
      keyNumbers: [
        {
          label: 'Short-term trials vs sugar-sweetened food or drink',
          value: 'Energy intake −94 kcal (95 % CI −122 to −66); no difference vs water (−2 kcal)',
          referenceIds: ['rogers2016'],
        },
        {
          label: 'Sustained RCTs (4 weeks to 40 months)',
          value:
            'Weight −1.35 kg (−2.28 to −0.42) vs sugar and −1.24 kg (−2.22 to −0.26) vs water (3 comparisons)',
          referenceIds: ['rogers2016'],
        },
        {
          label: 'Network meta-analysis (17 RCTs, 1,733 adults)',
          value:
            'Replacing sugar-sweetened drinks with low- or no-calorie versions: weight −1.06 kg (−1.71 to −0.41); BMI −0.32; body fat −0.60 %; no effect vs water',
          referenceIds: ['mcglynn2022'],
        },
        {
          label: 'Earlier meta-analysis of RCTs',
          value:
            'BMI −0.37 kg/m² (−1.10 to 0.36), not significant; positive associations in cohorts (likely reverse causation or confounding)',
          referenceIds: ['azad2017'],
        },
        {
          label: 'Glucose and insulin',
          value: '28 clinical trials give contradictory results',
          referenceIds: ['romoromo2016'],
        },
        {
          label: 'Two-week RCT (n = 120)',
          value:
            'Person-specific, microbiome-dependent glucose impairment with saccharin and sucralose, but not with aspartame or stevia at the tested dose',
          referenceIds: ['suez2022'],
        },
      ],
      grade: 'B',
      gradeReason:
        'Meta-analyses of randomised trials agree on the weight effect (B); the blood-sugar findings are contradictory and only grade C.',
      status: 'established',
      caveats:
        'The weight benefit reflects displaced sugar energy, not a special property of the sweetener. The blood-sugar findings are contradictory and person-specific effects come from a single two-week trial.',
      referenceIds: ['rogers2016', 'mcglynn2022', 'azad2017', 'romoromo2016', 'suez2022'],
      relatedMetricIds: [],
    },
    {
      id: '15-pre-meal-water',
      title: 'Drinking water before meals',
      category: 'hormones',
      summary:
        'Half a litre of water before a meal reduced how much older or overweight adults ate at that meal, by about 8–13 %. Over 12 weeks it added roughly 1–2 kg of extra weight loss when combined with a lower-calorie diet. Drinking water does not raise energy expenditure enough to matter.',
      howModelled:
        'The engine treats pre-meal water as a behavioural tip, not a mechanism. If you turn on “pre-meal water”, spontaneous meal intake in the appetite module falls by 8 % (range 5–13 %). It does not change any calorie target you have set, and it does not raise energy expenditure.',
      keyNumbers: [
        {
          label: '500 mL of water 30 min before a meal (24 obese adults aged 61)',
          value: 'Acute meal energy −13 % (574 → 500 kcal)',
          referenceIds: ['davy2008'],
        },
        {
          label:
            '12 weeks with 500 mL before each main meal added to a low-calorie diet (n = 48, aged 55–75)',
          value:
            'About 2 kg more weight loss; test-meal energy 498 vs 541 kcal at baseline and 480 vs 506 kcal at week 12 (p = 0.07)',
          referenceIds: ['dennis2010'],
        },
        {
          label: '84 adults with obesity',
          value: '−1.3 kg (−2.4 to −0.1) at 12 weeks',
          referenceIds: ['parretti2015'],
        },
        {
          label: 'Energy expenditure after drinking',
          value:
            '518 mL of distilled water or 0.9 % saline raised expenditure by 0 %; cold water +4.5 % over 60 min, less than the heat needed to warm it',
          referenceIds: ['brown2006'],
        },
        {
          label: 'Modelled intake reduction',
          value: '8 % of spontaneous meal intake (range 5–13 %)',
          note: 'Grade C, from older and overweight populations.',
        },
      ],
      grade: 'C',
      gradeReason:
        'The trials are small and involve older or overweight adults, and the long-term effect is small.',
      status: 'proposed-fit',
      caveats:
        'Results come from older and overweight adults; the 8 % figure is a proposed simplification of the meal-level range, and the 12-week meal-reduction difference was not statistically significant (p = 0.07).',
      referenceIds: ['dennis2010', 'parretti2015', 'davy2008', 'brown2006'],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '15-myth-alcohol-calories-dont-count',
      claim: 'Alcohol calories don’t count, or are wasted.',
      verdict: 'not-supported',
      explanation:
        'At moderate intakes, alcohol energy is used like other energy. In a 16-week study, swapping 5 % of carbohydrate energy for ethanol left total energy expenditure unchanged, so the drink was fully counted. Another study found its thermic effect similar to carbohydrate, with no sign of energy being burned off wastefully. One study did report a larger heat cost of about 20 %, so the exact share is contested, but not enough to make alcohol energy disappear.',
      referenceIds: ['suter1994', 'sonko1994', 'rumpler1996'],
    },
    {
      id: '15-myth-alcohol-turns-to-body-fat',
      claim: 'Alcohol is converted to body fat.',
      verdict: 'oversimplified',
      explanation:
        'Very little of a drink becomes new fat: liver fat-making took under 5 % of a 24 g dose. What alcohol does is push the body to burn ethanol first and burn less fat meanwhile, and it adds some extra eating. Body fat rises when total intake exceeds needs.',
      referenceIds: ['siler1999', 'kwok2019'],
    },
    {
      id: '15-myth-a-calorie-is-a-calorie',
      claim: 'A calorie is a calorie, so the label tells you exactly what you get.',
      verdict: 'oversimplified',
      explanation:
        'Labels assume near-complete absorption. Whole raw almonds delivered about 24–27 % fewer calories than labelled (the standard factors overestimated the measured value by 32 %), walnuts 21 % and cashews 16 %, while ground almonds and almond butter showed about none. High-fibre whole-food diets gave about 2–4 % fewer calories than labels that credit fibre at 2 kcal per gram; on the old standard factors the overestimate was up to 4 % on refined diets and up to 11 % on low-fat, high-fibre diets. Fibre is neither 0 kcal nor 4 kcal: even after a 2 kcal per gram credit, whole-food fibre is still over-credited by about 2.8 kcal per gram. Physically, an extra gram of fibre at constant digestible energy changes absorbed energy by about −0.8 kcal.',
      referenceIds: [
        'corbin2023',
        'karl2017',
        'zou2007',
        'novotny2012',
        'gebauer2016',
        'baer2012',
        'baer2016',
        'baer2018',
      ],
    },
    {
      id: '15-myth-ultra-processed-is-just-calories',
      claim: 'Ultra-processed food is just about calories and macros.',
      verdict: 'not-supported',
      explanation:
        'In two trials where the foods were matched on macronutrients, people ate about 500–800 kcal a day more of the ultra-processed diet, without saying they felt hungrier. Even reformulated “healthy” ultra-processed food produced about half the weight loss in an 8-week trial. Self-reported intake exaggerated the difference about twofold.',
      referenceIds: ['hall2019', 'hamano2024', 'dicken2025'],
    },
    {
      id: '15-myth-salt-permanent-water-gain',
      claim: 'Salt makes you gain water weight permanently.',
      verdict: 'not-supported',
      explanation:
        'The effect is transient and modest for most people. In healthy men, an extra 150 mmol of sodium a day added about 0.9 kg after a week, while a controlled ward study found about none. Either way, the change reverses within days of eating less salt.',
      referenceIds: ['heer2000', 'visser2009', 'vandenboschjjjon2021'],
    },
    {
      id: '15-myth-low-carb-loss-is-fat',
      claim: 'The fast early weight loss on a low-carbohydrate diet is fat.',
      verdict: 'not-supported',
      explanation:
        'First-week loss is mostly water. On an 800 kcal ketogenic diet, 61 % of the loss was water vs 37 % on an equal-calorie mixed diet. At a constant 2,400 kcal, a switch to very low carbohydrate cut 1.6 kg in about a week, with only 0.2 kg of it fat.',
      referenceIds: ['yang1976', 'hall2016'],
    },
    {
      id: '15-myth-electrolytes-fix-keto-flu',
      claim: 'Salt and electrolytes fix the “keto flu”.',
      verdict: 'unproven',
      explanation:
        'It is plausible, because the kidneys really do shed extra sodium early in fasting or very low carbohydrate eating. But no controlled trial has tested electrolyte supplements for these symptoms, so the claim should not be presented as proven.',
      referenceIds: ['dehaven1980', 'sigler1975'],
    },
    {
      id: '15-myth-water-boosts-metabolism',
      claim: 'Drinking water boosts your metabolism or flushes out fat.',
      verdict: 'not-supported',
      explanation:
        'A 518 mL drink of room-temperature water did not raise energy expenditure. What water before a meal does is reduce the next meal by about 8–13 % in older or overweight adults, and that added roughly 1–2 kg over 12 weeks.',
      referenceIds: ['dennis2010', 'parretti2015', 'davy2008', 'brown2006'],
    },
    {
      id: '15-myth-green-tea-burns-fat',
      claim: 'Green tea burns fat.',
      verdict: 'not-supported',
      explanation:
        'A Cochrane review found −0.04 kg outside Japan. The small energy effect seen in chamber studies is essentially the caffeine in the tea.',
      referenceIds: ['hursel2011', 'jurgens2012', 'dulloo1999'],
    },
    {
      id: '15-myth-caffeine-tolerance-no-benefit',
      claim: 'Once you build caffeine tolerance, it stops helping.',
      verdict: 'oversimplified',
      explanation:
        'People who normally have little caffeine lost its performance benefit after four weeks of daily use. Habitual users generally keep some benefit. Its effects on sleep persist whatever your habit, which is why timing matters.',
      referenceIds: ['guest2021', 'beaumont2017'],
    },
    {
      id: '15-myth-creatine-is-just-water',
      claim: 'Creatine is just water.',
      verdict: 'oversimplified',
      explanation:
        'Partly true: it adds 0.5–1.0 kg of water. But randomised trials also found 1.1–1.4 kg more lean mass and small strength gains. Direct imaging shows only a very small extra amount of muscle growth.',
      referenceIds: ['chilibeck2017', 'desai2024', 'burke2023'],
    },
    {
      id: '15-myth-bcaas-build-muscle',
      claim: 'BCAAs build muscle.',
      verdict: 'not-supported',
      explanation:
        'No study has shown that taking branched-chain amino acids alone by mouth stimulates muscle protein synthesis, and infused BCAAs actually lowered it.',
      referenceIds: ['wolfe2017'],
    },
    {
      id: '15-myth-sweeteners-raise-insulin-and-fat',
      claim: 'Artificial sweeteners raise insulin and make you fat.',
      verdict: 'not-supported',
      explanation:
        'Randomised trials show weight staying the same or falling when sweeteners replace sugar. Cohort studies suggest the opposite, but those links are likely confounded. One two-week trial did find person-specific blood-sugar problems with saccharin and sucralose, so the effect on blood sugar remains unsettled.',
      referenceIds: ['rogers2016', 'mcglynn2022', 'azad2017', 'suez2022'],
    },
    {
      id: '15-myth-zero-fibre-constipation',
      claim: 'Zero fibre means constipation.',
      verdict: 'oversimplified',
      explanation:
        'In self-selected constipated patients, stopping fibre improved bowel frequency. But butyrate and fibre-derived plant compounds fall on very low fibre and low carbohydrate, and the long-term effects are unknown.',
      referenceIds: ['ho2012', 'duncan2007', 'russell2011'],
    },
    {
      id: '15-myth-diverse-microbiome-high-fibre',
      claim: 'A diverse gut microbiome comes from a high-fibre diet.',
      verdict: 'not-supported',
      explanation:
        'A 17-week high-fibre diet changed the bacteria’s fibre-digesting enzymes but not the diversity of the community. A fermented-food diet raised diversity.',
      referenceIds: ['wastyk2021'],
    },
    {
      id: '15-myth-everyone-needs-3-4-litres',
      claim: 'Everyone needs 3–4 litres of water a day.',
      verdict: 'oversimplified',
      explanation:
        'Average water turnover was 4.3 L/d in men aged 20–30 and 3.4 L/d in women aged 20–55, and that includes water from food and made by metabolism; example predictions for sedentary adults were 2.7–3.2 L/d. Turnover depends on size, activity, climate, humidity and altitude. The rule of eight glasses a day has no objective support.',
      referenceIds: ['yamada2022'],
    },
    {
      id: '15-myth-calorie-restriction-means-deficiency',
      claim: 'Calorie-restricted diets are automatically deficient in nutrients.',
      verdict: 'oversimplified',
      explanation:
        'Only if food quality is poor. A typical-density diet falls short in magnesium and calcium below about 1,700 kcal, but nutrient-dense choices and a multivitamin close most gaps.',
      referenceIds: ['gardner2010', 'blumberg2017', 'banner2024'],
    },
  ],
  openQuestions: [
    'Is the fibre slope right? The estimate of 5.0 kcal of extra stool energy per gram (2.8 kcal net at a 2 kcal-per-gram label credit) is fitted to one two-arm study (21 vs 40 g/d) and matches one ward study whose fibre intake could not be checked. Nobody has tested it above 60 g/d, for isolated fibres, or for fibre swaps inside low-carbohydrate diets, and the time gut bacteria take to adapt is unmeasured.',
    'How many calories does a label credit to fibre? Typed-in label calories might credit fibre at 0, 2 or 4 kcal per gram, which shifts the correction between 0.8, 2.8 and 4.8 kcal per gram of fibre. Vitals assumes 2 and recomputes calories from macros, but the trial diets’ convention was inferred, not stated.',
    'How much water does extra sodium hold? One dataset gives about 0.009 kg per mmol/d (70–78 men) and another about zero (32 men); both differ from the “sodium reservoir” idea. The parameters for early natriuresis (50 mmol/d, τ of 5 days) rest on a single 1980 study and mechanism papers.',
    'How big is the ultra-processed food effect? Self-reported intake and body-composition-derived energy differ twofold, three trials used different populations and definitions, nobody knows whether it lasts beyond 8 weeks, and because hunger scores do not change, the mechanism (eating rate, energy density, palatability, texture) is not separable.',
    'How good are the micronutrient estimates? The densities come from 291 US women using 24-hour recalls; EAR values other than D, E, A, C and zinc were not re-verified; the pattern and quality multipliers only anchor the direction of effect; and time-to-deficiency numbers are largely unverified.',
    'Alcohol: the thermic effect (5–22 %) is contested; the muscle-protein effect comes from one small trial at about 12 drinks; and the effect at typical intakes, and on ketone levels in people eating very low carbohydrate, was not found.',
    'Caffeine: the energy dose–response is inconsistent (0.105 kcal/mg pooled vs 0.25 kcal/mg in the 600 mg study), thermogenic tolerance is unmeasured, and the sleep dose–response shape is an interpolation.',
    'Creatine: how much of the scan-measured lean mass is water vs tissue, whether women and older adults follow the same kinetics, and how common non-responders are (20–30 %, from a secondary quote).',
    'Hydration: the state parameters (f_kidney, τ_H) are placeholders, and the water-turnover equation predicts population averages (R² = 0.47), not individual needs.',
    'Cooking, raw food and food-matrix effects beyond nuts (starch gelatinisation, protein denaturation, cooled resistant starch) are not quantified in the human trials found.',
    'Several primary sources (NIH-ODS iron and magnesium, NASEM DRI tables, the EFSA caffeine opinion, the Dietary Guidelines PDF, the full text of the 2000 sodium ward study) were unreachable, so statements marked unverified should be re-checked before release.',
  ],
  references: [
    {
      id: 'corbin2023',
      authors: 'Corbin KD, Carnero EA, Dirks B, et al.',
      year: 2023,
      title:
        'Host-diet-gut microbiome interactions influence human energy balance: a randomized clinical trial',
      journal: 'Nature communications',
      pmid: '37258525',
      doi: '10.1038/s41467-023-38778-x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37258525/',
    },
    {
      id: 'karl2017',
      authors: 'Karl JP, Meydani M, Barnett JB, et al.',
      year: 2017,
      title:
        'Substituting whole grains for refined grains in a 6-wk randomized trial favorably affects energy-balance metrics in healthy men and postmenopausal women',
      journal: 'The American journal of clinical nutrition',
      pmid: '28179223',
      doi: '10.3945/ajcn.116.139683',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28179223/',
    },
    {
      id: 'zou2007',
      authors: 'Zou ML, Moughan PJ, Awati A, et al.',
      year: 2007,
      title:
        'Accuracy of the Atwater factors and related food energy conversion factors with low-fat, high-fiber diets when energy intake is reduced spontaneously',
      journal: 'The American journal of clinical nutrition',
      pmid: '18065582',
      doi: '10.1093/ajcn/86.5.1649',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18065582/',
    },
    {
      id: 'baer1997',
      authors: 'Baer DJ, Rumpler WV, Miles CW, et al.',
      year: 1997,
      title:
        'Dietary fiber decreases the metabolizable energy content and nutrient digestibility of mixed diets fed to humans',
      journal: 'The Journal of nutrition',
      pmid: '9109608',
      doi: '10.1093/jn/127.4.579',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9109608/',
    },
    {
      id: 'miles1988',
      authors: 'Miles CW, Kelsay JL, Wong NP',
      year: 1988,
      title: 'Effect of dietary fiber on the metabolizable energy of human diets',
      journal: 'The Journal of nutrition',
      pmid: '2843615',
      doi: '10.1093/jn/118.9.1075',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2843615/',
    },
    {
      id: 'livesey1990',
      authors: 'Livesey G',
      year: 1990,
      title: 'Energy values of unavailable carbohydrate and diets: an inquiry and analysis',
      journal: 'The American journal of clinical nutrition',
      pmid: '2138862',
      doi: '10.1093/ajcn/51.4.617',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2138862/',
    },
    {
      id: 'elia2007',
      authors: 'Elia M, Cummings JH',
      year: 2007,
      title: 'Physiological aspects of energy metabolism and gastrointestinal effects of carbohydrates',
      journal: 'European journal of clinical nutrition',
      pmid: '17992186',
      doi: '10.1038/sj.ejcn.1602938',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17992186/',
    },
    {
      id: 'davis2026',
      authors: 'Davis TL, Dirks B, Carnero EA, et al.',
      year: 2026,
      title:
        'Modeling the microbial contribution to human energy balance using the Digestion, Absorption, and Microbial Metabolism (DAMM) model',
      journal: 'PloS one',
      pmid: '42201874',
      doi: '10.1371/journal.pone.0347668',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42201874/',
    },
    {
      id: 'cummings1992',
      authors: 'Cummings JH, Bingham SA, Heaton KW, et al.',
      year: 1992,
      title:
        'Fecal weight, colon cancer risk, and dietary intake of nonstarch polysaccharides (dietary fiber)',
      journal: 'Gastroenterology',
      pmid: '1333426',
      doi: '10.1016/0016-5085(92)91435-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1333426/',
    },
    {
      id: 'mcneil1984',
      authors: 'McNeil NI',
      year: 1984,
      title: 'The contribution of the large intestine to energy supplies in man',
      journal: 'The American journal of clinical nutrition',
      pmid: '6320630',
      doi: '10.1093/ajcn/39.2.338',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6320630/',
    },
    {
      id: 'bergman1990',
      authors: 'Bergman EN',
      year: 1990,
      title:
        'Energy contributions of volatile fatty acids from the gastrointestinal tract in various species',
      journal: 'Physiological reviews',
      pmid: '2181501',
      doi: '10.1152/physrev.1990.70.2.567',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2181501/',
    },
    {
      id: 'topping2001',
      authors: 'Topping DL, Clifton PM',
      year: 2001,
      title:
        'Short-chain fatty acids and human colonic function: roles of resistant starch and nonstarch polysaccharides',
      journal: 'Physiological reviews',
      pmid: '11427691',
      doi: '10.1152/physrev.2001.81.3.1031',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11427691/',
    },
    {
      id: 'boets2015',
      authors: 'Boets E, Deroover L, Houben E, et al.',
      year: 2015,
      title: 'Quantification of in Vivo Colonic Short Chain Fatty Acid Production from Inulin',
      journal: 'Nutrients',
      pmid: '26516911',
      doi: '10.3390/nu7115440',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26516911/',
    },
    {
      id: 'pritchard2014',
      authors: 'Pritchard SE, Marciani L, Garsed KC, et al.',
      year: 2014,
      title:
        'Fasting and postprandial volumes of the undisturbed colon: normal values and changes in diarrhea-predominant irritable bowel syndrome measured using serial MRI',
      journal: 'Neurogastroenterology and motility',
      pmid: '24131490',
      doi: '10.1111/nmo.12243',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24131490/',
    },
    {
      id: 'ho2012',
      authors: 'Ho KS, Tan CY, Mohd Daud MA, et al.',
      year: 2012,
      title: 'Stopping or reducing dietary fiber intake reduces constipation and its associated symptoms',
      journal: 'World journal of gastroenterology',
      pmid: '22969234',
      doi: '10.3748/wjg.v18.i33.4593',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22969234/',
    },
    {
      id: 'duncan2007',
      authors: 'Duncan SH, Belenguer A, Holtrop G, et al.',
      year: 2007,
      title:
        'Reduced dietary intake of carbohydrates by obese subjects results in decreased concentrations of butyrate and butyrate-producing bacteria in feces',
      journal: 'Applied and environmental microbiology',
      pmid: '17189447',
      doi: '10.1128/aem.02340-06',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17189447/',
    },
    {
      id: 'russell2011',
      authors: 'Russell WR, Gratz SW, Duncan SH, et al.',
      year: 2011,
      title:
        'High-protein, reduced-carbohydrate weight-loss diets promote metabolite profiles likely to be detrimental to colonic health',
      journal: 'The American journal of clinical nutrition',
      pmid: '21389180',
      doi: '10.3945/ajcn.110.002188',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21389180/',
    },
    {
      id: 'david2014',
      authors: 'David LA, Maurice CF, Carmody RN, et al.',
      year: 2014,
      title: 'Diet rapidly and reproducibly alters the human gut microbiome',
      journal: 'Nature',
      pmid: '24336217',
      doi: '10.1038/nature12820',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24336217/',
    },
    {
      id: 'wastyk2021',
      authors: 'Wastyk HC, Fragiadakis GK, Perelman D, et al.',
      year: 2021,
      title: 'Gut-microbiota-targeted diets modulate human immune status',
      journal: 'Cell',
      pmid: '34256014',
      doi: '10.1016/j.cell.2021.06.019',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34256014/',
    },
    {
      id: 'lennerz2021',
      authors: 'Lennerz BS, Mey JT, Henn OH, et al.',
      year: 2021,
      title:
        'Behavioral Characteristics and Self-Reported Health Status among 2029 Adults Consuming a "Carnivore Diet"',
      journal: 'Current developments in nutrition',
      pmid: '34934897',
      doi: '10.1093/cdn/nzab133',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34934897/',
    },
    {
      id: 'jumpertz2011',
      authors: 'Jumpertz R, Le DS, Turnbaugh PJ, et al.',
      year: 2011,
      title:
        'Energy-balance studies reveal associations between gut microbes, caloric load, and nutrient absorption in humans',
      journal: 'The American journal of clinical nutrition',
      pmid: '21543530',
      doi: '10.3945/ajcn.110.010132',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21543530/',
    },
    {
      id: 'mysonhimer2022',
      authors: 'Mysonhimer AR, Holscher HD',
      year: 2022,
      title: 'Gastrointestinal Effects and Tolerance of Nondigestible Carbohydrate Consumption',
      journal: 'Advances in nutrition (Bethesda, Md.)',
      pmid: '36041173',
      doi: '10.1093/advances/nmac094',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36041173/',
    },
    {
      id: 'wanders2011',
      authors: 'Wanders AJ, van den Borne JJ, de Graaf C, et al.',
      year: 2011,
      title:
        'Effects of dietary fibre on subjective appetite, energy intake and body weight: a systematic review of randomized controlled trials',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '21676152',
      doi: '10.1111/j.1467-789x.2011.00895.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21676152/',
    },
    {
      id: 'thompson2017',
      authors: 'Thompson SV, Hannon BA, An R, et al.',
      year: 2017,
      title:
        'Effects of isolated soluble fiber supplementation on body weight, glycemia, and insulinemia in adults with overweight and obesity: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'The American journal of clinical nutrition',
      pmid: '29092878',
      doi: '10.3945/ajcn.117.163246',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29092878/',
    },
    {
      id: 'jovanovski2021',
      authors: 'Jovanovski E, Mazhar N, Komishon A, et al.',
      year: 2021,
      title:
        'Effect of viscous fiber supplementation on obesity indicators in individuals consuming calorie-restricted diets: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'European journal of nutrition',
      pmid: '32198674',
      doi: '10.1007/s00394-020-02224-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32198674/',
    },
    {
      id: 'miketinas2019',
      authors: 'Miketinas DC, Bray GA, Beyl RA, et al.',
      year: 2019,
      title:
        'Fiber Intake Predicts Weight Loss and Dietary Adherence in Adults Consuming Calorie-Restricted Diets: The POUNDS Lost (Preventing Overweight Using Novel Dietary Strategies) Study',
      journal: 'The Journal of nutrition',
      pmid: '31174214',
      doi: '10.1093/jn/nxz117',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31174214/',
    },
    {
      id: 'brown1999',
      authors: 'Brown L, Rosner B, Willett WW, et al.',
      year: 1999,
      title: 'Cholesterol-lowering effects of dietary fiber: a meta-analysis',
      journal: 'The American journal of clinical nutrition',
      pmid: '9925120',
      doi: '10.1093/ajcn/69.1.30',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9925120/',
    },
    {
      id: 'whitehead2014',
      authors: 'Whitehead A, Beck EJ, Tosh S, et al.',
      year: 2014,
      title: 'Cholesterol-lowering effects of oat β-glucan: a meta-analysis of randomized controlled trials',
      journal: 'The American journal of clinical nutrition',
      pmid: '25411276',
      doi: '10.3945/ajcn.114.086108',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25411276/',
    },
    {
      id: 'post2012',
      authors: 'Post RE, Mainous AG, King DE, et al.',
      year: 2012,
      title: 'Dietary fiber for the treatment of type 2 diabetes mellitus: a meta-analysis',
      journal: 'Journal of the American Board of Family Medicine : JABFM',
      pmid: '22218620',
      doi: '10.3122/jabfm.2012.01.110148',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22218620/',
    },
    {
      id: 'reynolds2019',
      authors: 'Reynolds A, Mann J, Cummings J, et al.',
      year: 2019,
      title: 'Carbohydrate quality and human health: a series of systematic reviews and meta-analyses',
      journal: 'Lancet (London, England)',
      pmid: '30638909',
      doi: '10.1016/s0140-6736(18)31809-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30638909/',
    },
    {
      id: 'threapleton2013',
      authors: 'Threapleton DE, Greenwood DC, Evans CE, et al.',
      year: 2013,
      title: 'Dietary fibre intake and risk of cardiovascular disease: systematic review and meta-analysis',
      journal: 'BMJ (Clinical research ed.)',
      pmid: '24355537',
      doi: '10.1136/bmj.f6879',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24355537/',
    },
    {
      id: 'carlsen2023',
      authors: 'Carlsen H, Pajari AM',
      year: 2023,
      title: 'Dietary fiber - a scoping review for Nordic Nutrition Recommendations 2023',
      journal: 'Food & nutrition research',
      pmid: '37920675',
      doi: '10.29219/fnr.v67.9979',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37920675/',
    },
    {
      id: 'novotny2012',
      authors: 'Novotny JA, Gebauer SK, Baer DJ',
      year: 2012,
      title:
        'Discrepancy between the Atwater factor predicted and empirically measured energy values of almonds in human diets',
      journal: 'The American journal of clinical nutrition',
      pmid: '22760558',
      doi: '10.3945/ajcn.112.035782',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22760558/',
    },
    {
      id: 'gebauer2016',
      authors: 'Gebauer SK, Novotny JA, Bornhorst GM, et al.',
      year: 2016,
      title: 'Food processing and structure impact the metabolizable energy of almonds',
      journal: 'Food & function',
      pmid: '27713968',
      doi: '10.1039/c6fo01076h',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27713968/',
    },
    {
      id: 'baer2012',
      authors: 'Baer DJ, Gebauer SK, Novotny JA',
      year: 2012,
      title: 'Measured energy value of pistachios in the human diet',
      journal: 'The British journal of nutrition',
      pmid: '21733319',
      doi: '10.1017/s0007114511002649',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21733319/',
    },
    {
      id: 'baer2016',
      authors: 'Baer DJ, Gebauer SK, Novotny JA',
      year: 2016,
      title:
        'Walnuts Consumed by Healthy Adults Provide Less Available Energy than Predicted by the Atwater Factors',
      journal: 'The Journal of nutrition',
      pmid: '26581681',
      doi: '10.3945/jn.115.217372',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26581681/',
    },
    {
      id: 'baer2018',
      authors: 'Baer DJ, Novotny JA',
      year: 2018,
      title: 'Metabolizable Energy from Cashew Nuts is Less than that Predicted by Atwater Factors',
      journal: 'Nutrients',
      pmid: '30586843',
      doi: '10.3390/nu11010033',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30586843/',
    },
    {
      id: 'koebnick1999',
      authors: 'Koebnick C, Strassner C, Hoffmann I, et al.',
      year: 1999,
      title:
        'Consequences of a long-term raw food diet on body weight and menstruation: results of a questionnaire survey',
      journal: 'Annals of nutrition & metabolism',
      pmid: '10436305',
      doi: '10.1159/000012770',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10436305/',
    },
    {
      id: 'carmody2009',
      authors: 'Carmody RN, Wrangham RW',
      year: 2009,
      title: 'The energetic significance of cooking',
      journal: 'Journal of human evolution',
      pmid: '19732938',
      doi: '10.1016/j.jhevol.2009.02.011',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19732938/',
    },
    {
      id: 'hall2019',
      authors: 'Hall KD, Ayuketah A, Brychta R, et al.',
      year: 2019,
      title:
        'Ultra-Processed Diets Cause Excess Calorie Intake and Weight Gain: An Inpatient Randomized Controlled Trial of Ad Libitum Food Intake',
      journal: 'Cell metabolism',
      pmid: '31105044',
      doi: '10.1016/j.cmet.2019.05.008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31105044/',
    },
    {
      id: 'hamano2024',
      authors: 'Hamano S, Sawada M, Aihara M, et al.',
      year: 2024,
      title:
        'Ultra-processed foods cause weight gain and increased energy intake associated with reduced chewing frequency: A randomized, open-label, crossover study',
      journal: 'Diabetes, obesity & metabolism',
      pmid: '39267249',
      doi: '10.1111/dom.15922',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39267249/',
    },
    {
      id: 'dicken2025',
      authors: 'Dicken SJ, Jassil FC, Brown A, et al.',
      year: 2025,
      title:
        'Ultraprocessed or minimally processed diets following healthy dietary guidelines on weight and cardiometabolic health: a randomized, crossover trial',
      journal: 'Nature medicine',
      pmid: '40760353',
      doi: '10.1038/s41591-025-03842-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40760353/',
    },
    {
      id: 'rolls2009',
      authors: 'Rolls BJ',
      year: 2009,
      title: 'The relationship between dietary energy density and energy intake',
      journal: 'Physiology & behavior',
      pmid: '19303887',
      doi: '10.1016/j.physbeh.2009.03.011',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19303887/',
    },
    {
      id: 'rolls2006',
      authors: 'Rolls BJ, Roe LS, Meengs JS',
      year: 2006,
      title:
        'Reductions in portion size and energy density of foods are additive and lead to sustained decreases in energy intake',
      journal: 'The American journal of clinical nutrition',
      pmid: '16400043',
      doi: '10.1093/ajcn/83.1.11',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16400043/',
    },
    {
      id: 'ellomartin2007',
      authors: 'Ello-Martin JA, Roe LS, Ledikwe JH, et al.',
      year: 2007,
      title:
        'Dietary energy density in the treatment of obesity: a year-long trial comparing 2 weight-loss diets',
      journal: 'The American journal of clinical nutrition',
      pmid: '17556681',
      doi: '10.1093/ajcn/85.6.1465',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17556681/',
    },
    {
      id: 'robinson2014',
      authors: 'Robinson E, Almiron-Roig E, Rutters F, et al.',
      year: 2014,
      title:
        'A systematic review and meta-analysis examining the effect of eating rate on energy intake and hunger',
      journal: 'The American journal of clinical nutrition',
      pmid: '24847856',
      doi: '10.3945/ajcn.113.081745',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24847856/',
    },
    {
      id: 'heer2000',
      authors: 'Heer M, Baisch F, Kropp J, et al.',
      year: 2000,
      title: 'High dietary sodium chloride consumption may not induce body fluid retention in humans',
      journal: 'American journal of physiology. Renal physiology',
      pmid: '10751219',
      doi: '10.1152/ajprenal.2000.278.4.f585',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10751219/',
      verification: 'abstract',
    },
    {
      id: 'titze2002',
      authors: 'Titze J, Maillet A, Lang R, et al.',
      year: 2002,
      title: 'Long-term sodium balance in humans in a terrestrial space station simulation study',
      journal: 'American journal of kidney diseases : the official journal of the National Kidney Foundation',
      pmid: '12200802',
      doi: '10.1053/ajkd.2002.34908',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12200802/',
    },
    {
      id: 'rakova2017',
      authors: 'Rakova N, Kitada K, Lerchl K, et al.',
      year: 2017,
      title: 'Increased salt consumption induces body water conservation and decreases fluid intake',
      journal: 'The Journal of clinical investigation',
      pmid: '28414302',
      doi: '10.1172/jci88530',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28414302/',
    },
    {
      id: 'he2001',
      authors: 'He FJ, Markandu ND, Sagnella GA, et al.',
      year: 2001,
      title: 'Effect of salt intake on renal excretion of water in humans',
      journal: 'Hypertension (Dallas, Tex. : 1979)',
      pmid: '11566897',
      doi: '10.1161/01.hyp.38.3.317',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11566897/',
    },
    {
      id: 'mihara2019',
      authors: 'Mihara Y, Kado H, Yokota I, et al.',
      year: 2019,
      title:
        'Rapid weight loss with dietary salt restriction in hospitalized patients with chronic kidney disease',
      journal: 'Scientific reports',
      pmid: '31217504',
      doi: '10.1038/s41598-019-45341-6',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31217504/',
    },
    {
      id: 'mahler2022',
      authors: 'Mähler A, Klamer S, Maifeld A, et al.',
      year: 2022,
      title:
        'Increased Salt Intake Decreases Diet-Induced Thermogenesis in Healthy Volunteers: A Randomized Placebo-Controlled Study',
      journal: 'Nutrients',
      pmid: '35057434',
      doi: '10.3390/nu14020253',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35057434/',
    },
    {
      id: 'dehaven1980',
      authors: 'DeHaven J, Sherwin R, Hendler R, et al.',
      year: 1980,
      title:
        'Nitrogen and sodium balance and sympathetic-nervous-system activity in obese subjects treated with a low-calorie protein or mixed diet',
      journal: 'The New England journal of medicine',
      pmid: '7351972',
      doi: '10.1056/nejm198002283020901',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7351972/',
    },
    {
      id: 'sigler1975',
      authors: 'Sigler MH',
      year: 1975,
      title: 'The mechanism of the natriuresis of fasting',
      journal: 'The Journal of clinical investigation',
      pmid: '236328',
      doi: '10.1172/jci107941',
      url: 'https://pubmed.ncbi.nlm.nih.gov/236328/',
    },
    {
      id: 'defronzo1975',
      authors: 'DeFronzo RA, Cooke CR, Andres R, et al.',
      year: 1975,
      title: 'The effect of insulin on renal handling of sodium, potassium, calcium, and phosphate in man',
      journal: 'The Journal of clinical investigation',
      pmid: '1120786',
      doi: '10.1172/jci107996',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1120786/',
    },
    {
      id: 'yang1976',
      authors: 'Yang MU, Van Itallie TB',
      year: 1976,
      title:
        'Composition of weight lost during short-term weight reduction. Metabolic responses of obese subjects to starvation and low-calorie ketogenic and nonketogenic diets',
      journal: 'The Journal of clinical investigation',
      pmid: '956398',
      doi: '10.1172/jci108519',
      url: 'https://pubmed.ncbi.nlm.nih.gov/956398/',
    },
    {
      id: 'phinney1983',
      authors: 'Phinney SD, Bistrian BR, Wolfe RR, et al.',
      year: 1983,
      title:
        'The human metabolic response to chronic ketosis without caloric restriction: physical and biochemical adaptation',
      journal: 'Metabolism: clinical and experimental',
      pmid: '6865775',
      doi: '10.1016/0026-0495(83)90105-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6865775/',
    },
    {
      id: 'hall2016',
      authors: 'Hall KD, Chen KY, Guo J, et al.',
      year: 2016,
      title:
        'Energy expenditure and body composition changes after an isocaloric ketogenic diet in overweight and obese men',
      journal: 'The American journal of clinical nutrition',
      pmid: '27385608',
      doi: '10.3945/ajcn.116.133561',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27385608/',
    },
    {
      id: 'kreitzman1992',
      authors: 'Kreitzman SN, Coxon AY, Szaz KF',
      year: 1992,
      title:
        'Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition',
      journal: 'The American journal of clinical nutrition',
      pmid: '1615908',
      doi: '10.1093/ajcn/56.1.292s',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1615908/',
    },
    {
      id: 'fernandezelias2015',
      authors: 'Fernández-Elías VE, Ortega JF, Nelson RK, et al.',
      year: 2015,
      title:
        'Relationship between muscle water and glycogen recovery after prolonged exercise in the heat in humans',
      journal: 'European journal of applied physiology',
      pmid: '25911631',
      doi: '10.1007/s00421-015-3175-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25911631/',
    },
    {
      id: 'yamada2022',
      authors: 'Yamada Y, Zhang X, Henderson MET, et al.',
      year: 2022,
      title: 'Variation in human water turnover associated with environmental and lifestyle factors',
      journal: 'Science (New York, N.Y.)',
      pmid: '36423296',
      doi: '10.1126/science.abm8668',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36423296/',
    },
    {
      id: 'acsm2007',
      authors: 'American College of Sports Medicine, Sawka MN, Burke LM, et al.',
      year: 2007,
      title: 'American College of Sports Medicine position stand. Exercise and fluid replacement',
      journal: 'Medicine and science in sports and exercise',
      pmid: '17277604',
      doi: '10.1249/mss.0b013e31802ca597',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17277604/',
    },
    {
      id: 'baker2017',
      authors: 'Baker LB',
      year: 2017,
      title:
        'Sweating Rate and Sweat Sodium Concentration in Athletes: A Review of Methodology and Intra/Interindividual Variability',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '28332116',
      doi: '10.1007/s40279-017-0691-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28332116/',
    },
    {
      id: 'cheuvront2014',
      authors: 'Cheuvront SN, Kenefick RW',
      year: 2014,
      title: 'Dehydration: physiology, assessment, and performance effects',
      journal: 'Comprehensive Physiology',
      pmid: '24692140',
      doi: '10.1002/cphy.c130017',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24692140/',
    },
    {
      id: 'goulet2013',
      authors: 'Goulet ED',
      year: 2013,
      title:
        'Effect of exercise-induced dehydration on endurance performance: evaluating the impact of exercise protocols on outcomes using a meta-analytic procedure',
      journal: 'British journal of sports medicine',
      pmid: '22763119',
      doi: '10.1136/bjsports-2012-090958',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22763119/',
    },
    {
      id: 'hewbutler2015',
      authors: 'Hew-Butler T, Rosner MH, Fowkes-Godek S, et al.',
      year: 2015,
      title:
        'Statement of the Third International Exercise-Associated Hyponatremia Consensus Development Conference, Carlsbad, California, 2015',
      journal:
        'Clinical journal of sport medicine : official journal of the Canadian Academy of Sport Medicine',
      pmid: '26102445',
      doi: '10.1097/jsm.0000000000000221',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26102445/',
      verification: 'abstract',
    },
    {
      id: 'orsama2014',
      authors: 'Orsama AL, Mattila E, Ermes M, et al.',
      year: 2014,
      title: 'Weight rhythms: weight increases during weekends and decreases during weekdays',
      journal: 'Obesity facts',
      pmid: '24504358',
      doi: '10.1159/000356147',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24504358/',
    },
    {
      id: 'cheuvront2004',
      authors: 'Cheuvront SN, Carter R, Montain SJ, et al.',
      year: 2004,
      title: 'Daily body mass variability and stability in active men undergoing exercise-heat stress',
      journal: 'International journal of sport nutrition and exercise metabolism',
      pmid: '15673099',
      doi: '10.1123/ijsnem.14.5.532',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15673099/',
    },
    {
      id: 'micoanski2025',
      authors: 'Micoanski KS, Soriano JM, Gozalbo MM',
      year: 2025,
      title: 'Potomania and Beer Potomania: A Systematic Review of Published Case Reports',
      journal: 'Nutrients',
      pmid: '40573123',
      doi: '10.3390/nu17122012',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40573123/',
    },
    {
      id: 'wilhelmidetoledo2019',
      authors: 'Wilhelmi de Toledo F, Grundler F, Bergouignan A, et al.',
      year: 2019,
      title:
        'Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects',
      journal: 'PloS one',
      pmid: '30601864',
      doi: '10.1371/journal.pone.0209353',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30601864/',
    },
    {
      id: 'nasem2019',
      authors: 'National Academies of Sciences, Engineering, and Medicine',
      year: 2019,
      title: 'Dietary Reference Intakes for Sodium and Potassium',
      journal: 'The National Academies Press, Washington DC',
      url: 'https://www.nationalacademies.org/read/25353/chapter/2',
    },
    {
      id: 'iom2005',
      authors: 'Institute of Medicine',
      year: 2005,
      title: 'Dietary Reference Intakes for Water, Potassium, Sodium, Chloride, and Sulfate',
      journal: 'The National Academies Press, Washington DC',
      url: 'https://www.nationalacademies.org/read/10925/chapter/2',
    },
    {
      id: 'dennis2010',
      authors: 'Dennis EA, Dengo AL, Comber DL, et al.',
      year: 2010,
      title:
        'Water consumption increases weight loss during a hypocaloric diet intervention in middle-aged and older adults',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '19661958',
      doi: '10.1038/oby.2009.235',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19661958/',
    },
    {
      id: 'parretti2015',
      authors: 'Parretti HM, Aveyard P, Blannin A, et al.',
      year: 2015,
      title:
        'Efficacy of water preloading before main meals as a strategy for weight loss in primary care patients with obesity: RCT',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '26237305',
      doi: '10.1002/oby.21167',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26237305/',
    },
    {
      id: 'davy2008',
      authors: 'Davy BM, Dennis EA, Dengo AL, et al.',
      year: 2008,
      title: 'Water consumption reduces energy intake at a breakfast meal in obese older adults',
      journal: 'Journal of the American Dietetic Association',
      pmid: '18589036',
      doi: '10.1016/j.jada.2008.04.013',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18589036/',
    },
    {
      id: 'brown2006',
      authors: 'Brown CM, Dulloo AG, Montani JP',
      year: 2006,
      title:
        'Water-induced thermogenesis reconsidered: the effects of osmolality and water temperature on energy expenditure after drinking',
      journal: 'The Journal of clinical endocrinology and metabolism',
      pmid: '16822824',
      doi: '10.1210/jc.2006-0407',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16822824/',
    },
    {
      id: 'calton2010',
      authors: 'Calton JB',
      year: 2010,
      title: 'Prevalence of micronutrient deficiency in popular diet plans',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '20537171',
      doi: '10.1186/1550-2783-7-24',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20537171/',
    },
    {
      id: 'gardner2010',
      authors: 'Gardner CD, Kim S, Bersamin A, et al.',
      year: 2010,
      title:
        'Micronutrient quality of weight-loss diets that focus on macronutrients: results from the A TO Z study',
      journal: 'The American journal of clinical nutrition',
      pmid: '20573800',
      doi: '10.3945/ajcn.2010.29468',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20573800/',
    },
    {
      id: 'churuangsuk2019',
      authors: 'Churuangsuk C, Griffiths D, Lean MEJ, et al.',
      year: 2019,
      title:
        'Impacts of carbohydrate-restricted diets on micronutrient intakes and status: A systematic review',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '31006978',
      doi: '10.1111/obr.12857',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31006978/',
    },
    {
      id: 'neufingerl2021',
      authors: 'Neufingerl N, Eilander A',
      year: 2021,
      title:
        'Nutrient Intake and Status in Adults Consuming Plant-Based Diets Compared to Meat-Eaters: A Systematic Review',
      journal: 'Nutrients',
      pmid: '35010904',
      doi: '10.3390/nu14010029',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35010904/',
    },
    {
      id: 'bakaloudi2021',
      authors: 'Bakaloudi DR, Halloran A, Rippin HL, et al.',
      year: 2021,
      title: 'Intake and adequacy of the vegan diet. A systematic review of the evidence',
      journal: 'Clinical nutrition (Edinburgh, Scotland)',
      pmid: '33341313',
      doi: '10.1016/j.clnu.2020.11.035',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33341313/',
    },
    {
      id: 'haider2018',
      authors: 'Haider LM, Schwingshackl L, Hoffmann G, et al.',
      year: 2018,
      title: 'The effect of vegetarian diets on iron status in adults: A systematic review and meta-analysis',
      journal: 'Critical reviews in food science and nutrition',
      pmid: '27880062',
      doi: '10.1080/10408398.2016.1259210',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27880062/',
    },
    {
      id: 'reider2020',
      authors: 'Reider CA, Chung RY, Devarshi PP, et al.',
      year: 2020,
      title: 'Inadequacy of Immune Health Nutrients: Intakes in US Adults, the 2005-2016 NHANES',
      journal: 'Nutrients',
      pmid: '32531972',
      doi: '10.3390/nu12061735',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32531972/',
    },
    {
      id: 'blumberg2017',
      authors: 'Blumberg JB, Frei BB, Fulgoni VL, et al.',
      year: 2017,
      title:
        'Impact of Frequency of Multi-Vitamin/Multi-Mineral Supplement Intake on Nutritional Adequacy and Nutrient Deficiencies in U.S. Adults',
      journal: 'Nutrients',
      pmid: '28792457',
      doi: '10.3390/nu9080849',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28792457/',
    },
    {
      id: 'fulgoni2011',
      authors: 'Fulgoni VL, Keast DR, Bailey RL, et al.',
      year: 2011,
      title: 'Foods, fortificants, and supplements: Where do Americans get their nutrients?',
      journal: 'The Journal of nutrition',
      pmid: '21865568',
      doi: '10.3945/jn.111.142257',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21865568/',
    },
    {
      id: 'verdon2003',
      authors: 'Verdon F, Burnand B, Stubi CL, et al.',
      year: 2003,
      title:
        'Iron supplementation for unexplained fatigue in non-anaemic women: double blind randomised placebo controlled trial',
      journal: 'BMJ (Clinical research ed.)',
      pmid: '12763985',
      doi: '10.1136/bmj.326.7399.1124',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12763985/',
    },
    {
      id: 'houston2018',
      authors: 'Houston BL, Hurrie D, Graham J, et al.',
      year: 2018,
      title:
        'Efficacy of iron supplementation on fatigue and physical capacity in non-anaemic iron-deficient adults: a systematic review of randomised controlled trials',
      journal: 'BMJ open',
      pmid: '29626044',
      doi: '10.1136/bmjopen-2017-019240',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29626044/',
    },
    {
      id: 'looker1997',
      authors: 'Looker AC, Dallman PR, Carroll MD, et al.',
      year: 1997,
      title: 'Prevalence of iron deficiency in the United States',
      journal: 'JAMA',
      pmid: '9091669',
      doi: '10.1001/jama.1997.03540360041028',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9091669/',
    },
    {
      id: 'pasricha2021',
      authors: 'Pasricha SR, Tye-Din J, Muckenthaler MU, et al.',
      year: 2021,
      title: 'Iron deficiency',
      journal: 'Lancet (London, England)',
      pmid: '33285139',
      doi: '10.1016/s0140-6736(20)32594-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33285139/',
    },
    {
      id: 'brown2004',
      authors: 'Brown MJ, Ferruzzi MG, Nguyen ML, et al.',
      year: 2004,
      title:
        'Carotenoid bioavailability is higher from salads ingested with full-fat than with fat-reduced salad dressings as measured with electrochemical detection',
      journal: 'The American journal of clinical nutrition',
      pmid: '15277161',
      doi: '10.1093/ajcn/80.2.396',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15277161/',
    },
    {
      id: 'dawsonhughes2015',
      authors: 'Dawson-Hughes B, Harris SS, Lichtenstein AH, et al.',
      year: 2015,
      title: 'Dietary fat increases vitamin D-3 absorption',
      journal: 'Journal of the Academy of Nutrition and Dietetics',
      pmid: '25441954',
      doi: '10.1016/j.jand.2014.09.014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25441954/',
    },
    {
      id: 'jeanes2004',
      authors: 'Jeanes YM, Hall WL, Ellard S, et al.',
      year: 2004,
      title: 'The absorption of vitamin E is influenced by the amount of fat in a meal and the food matrix',
      journal: 'The British journal of nutrition',
      pmid: '15522126',
      doi: '10.1079/bjn20041249',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15522126/',
    },
    {
      id: 'jeppesen1998',
      authors: 'Jeppesen PB, Høy CE, Mortensen PB',
      year: 1998,
      title: 'Essential fatty acid deficiency in patients receiving home parenteral nutrition',
      journal: 'The American journal of clinical nutrition',
      pmid: '9665106',
      doi: '10.1093/ajcn/68.1.126',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9665106/',
    },
    {
      id: 'carr2020',
      authors: 'Carr AC, Rowe S',
      year: 2020,
      title: 'Factors Affecting Vitamin C Status and Prevalence of Deficiency: A Global Health Perspective',
      journal: 'Nutrients',
      pmid: '32630245',
      doi: '10.3390/nu12071963',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32630245/',
    },
    {
      id: 'banner2024',
      authors: 'Banner L, Rice Bradley BH, Clinthorne J',
      year: 2024,
      title: 'Nutrient analysis of three low-carbohydrate diets differing in carbohydrate content',
      journal: 'Frontiers in nutrition',
      pmid: '39279895',
      doi: '10.3389/fnut.2024.1449109',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39279895/',
    },
    {
      id: 'siler1999',
      authors: 'Siler SQ, Neese RA, Hellerstein MK',
      year: 1999,
      title:
        'De novo lipogenesis, lipid kinetics, and whole-body lipid balances in humans after acute alcohol consumption',
      journal: 'The American journal of clinical nutrition',
      pmid: '10539756',
      doi: '10.1093/ajcn/70.5.928',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10539756/',
    },
    {
      id: 'suter1992',
      authors: 'Suter PM, Schutz Y, Jequier E',
      year: 1992,
      title: 'The effect of ethanol on fat storage in healthy subjects',
      journal: 'The New England journal of medicine',
      pmid: '1545851',
      doi: '10.1056/nejm199204093261503',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1545851/',
    },
    {
      id: 'suter1994',
      authors: 'Suter PM, Jéquier E, Schutz Y',
      year: 1994,
      title: 'Effect of ethanol on energy expenditure',
      journal: 'The American journal of physiology',
      pmid: '8184963',
      doi: '10.1152/ajpregu.1994.266.4.r1204',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8184963/',
    },
    {
      id: 'shelmet1988',
      authors: 'Shelmet JJ, Reichard GA, Skutches CL, et al.',
      year: 1988,
      title:
        'Ethanol causes acute inhibition of carbohydrate, fat, and protein oxidation and insulin resistance',
      journal: 'The Journal of clinical investigation',
      pmid: '3280601',
      doi: '10.1172/jci113428',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3280601/',
    },
    {
      id: 'sonko1994',
      authors: 'Sonko BJ, Prentice AM, Murgatroyd PR, et al.',
      year: 1994,
      title: 'Effect of alcohol on postmeal fat storage',
      journal: 'The American journal of clinical nutrition',
      pmid: '8116538',
      doi: '10.1093/ajcn/59.3.619',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8116538/',
    },
    {
      id: 'weststrate1990',
      authors: 'Weststrate JA, Wunnink I, Deurenberg P, et al.',
      year: 1990,
      title: 'Alcohol and its acute effects on resting metabolic rate and diet-induced thermogenesis',
      journal: 'The British journal of nutrition',
      pmid: '2121268',
      doi: '10.1079/bjn19900042',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2121268/',
    },
    {
      id: 'rumpler1996',
      authors: 'Rumpler WV, Rhodes DG, Baer DJ, et al.',
      year: 1996,
      title: 'Energy value of moderate alcohol consumption by humans',
      journal: 'The American journal of clinical nutrition',
      pmid: '8669405',
      doi: '10.1093/ajcn/64.1.108',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8669405/',
    },
    {
      id: 'raben2003',
      authors: 'Raben A, Agerholm-Larsen L, Flint A, et al.',
      year: 2003,
      title:
        'Meals with similar energy densities but rich in protein, fat, carbohydrate, or alcohol have different effects on energy expenditure and substrate metabolism but not on appetite and energy intake',
      journal: 'The American journal of clinical nutrition',
      pmid: '12499328',
      doi: '10.1093/ajcn/77.1.91',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12499328/',
    },
    {
      id: 'kwok2019',
      authors: 'Kwok A, Kwok A, Dordevic AL, et al.',
      year: 2019,
      title: 'Effect of alcohol consumption on food energy intake: a systematic review and meta-analysis',
      journal: 'The British journal of nutrition',
      pmid: '30630543',
      doi: '10.1017/s0007114518003677',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30630543/',
    },
    {
      id: 'yeomans2010',
      authors: 'Yeomans MR',
      year: 2010,
      title: 'Alcohol, appetite and energy balance: is alcohol intake a risk factor for obesity?',
      journal: 'Physiology & behavior',
      pmid: '20096714',
      doi: '10.1016/j.physbeh.2010.01.012',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20096714/',
    },
    {
      id: 'parr2014',
      authors: 'Parr EB, Camera DM, Areta JL, et al.',
      year: 2014,
      title:
        'Alcohol ingestion impairs maximal post-exercise rates of myofibrillar protein synthesis following a single bout of concurrent training',
      journal: 'PloS one',
      pmid: '24533082',
      doi: '10.1371/journal.pone.0088384',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24533082/',
    },
    {
      id: 'sierksma2004',
      authors: 'Sierksma A, Sarkola T, Eriksson CJ, et al.',
      year: 2004,
      title:
        'Effect of moderate alcohol consumption on plasma dehydroepiandrosterone sulfate, testosterone, and estradiol levels in middle-aged men and postmenopausal women: a diet-controlled intervention study',
      journal: 'Alcoholism, clinical and experimental research',
      pmid: '15166654',
      doi: '10.1097/01.alc.0000125356.70824.81',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15166654/',
    },
    {
      id: 'ebrahim2013',
      authors: 'Ebrahim IO, Shapiro CM, Williams AJ, et al.',
      year: 2013,
      title: 'Alcohol and sleep I: effects on normal sleep',
      journal: 'Alcoholism, clinical and experimental research',
      pmid: '23347102',
      doi: '10.1111/acer.12006',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23347102/',
    },
    {
      id: 'pietila2018',
      authors: 'Pietilä J, Helander E, Korhonen I, et al.',
      year: 2018,
      title:
        'Acute Effect of Alcohol Intake on Cardiovascular Autonomic Regulation During the First Hours of Sleep in a Large Real-World Sample of Finnish Employees: Observational Study',
      journal: 'JMIR mental health',
      pmid: '29549064',
      doi: '10.2196/mental.9519',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29549064/',
    },
    {
      id: 'rimm1999',
      authors: 'Rimm EB, Williams P, Fosher K, et al.',
      year: 1999,
      title:
        'Moderate alcohol intake and lower risk of coronary heart disease: meta-analysis of effects on lipids and haemostatic factors',
      journal: 'BMJ (Clinical research ed.)',
      pmid: '10591709',
      doi: '10.1136/bmj.319.7224.1523',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10591709/',
    },
    {
      id: 'wood2018',
      authors: 'Wood AM, Kaptoge S, Butterworth AS, et al.',
      year: 2018,
      title:
        'Risk thresholds for alcohol consumption: combined analysis of individual-participant data for 599 912 current drinkers in 83 prospective studies',
      journal: 'Lancet (London, England)',
      pmid: '29676281',
      doi: '10.1016/s0140-6736(18)30134-x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29676281/',
    },
    {
      id: 'jones2010',
      authors: 'Jones AW',
      year: 2010,
      title:
        'Evidence-based survey of the elimination rates of ethanol from blood with applications in forensic casework',
      journal: 'Forensic science international',
      pmid: '20304569',
      doi: '10.1016/j.forsciint.2010.02.021',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20304569/',
    },
    {
      id: 'shirreffs1997',
      authors: 'Shirreffs SM, Maughan RJ',
      year: 1997,
      title:
        'Restoration of fluid balance after exercise-induced dehydration: effects of alcohol consumption',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '9338423',
      doi: '10.1152/jappl.1997.83.4.1152',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9338423/',
    },
    {
      id: 'hobson2010',
      authors: 'Hobson RM, Maughan RJ',
      year: 2010,
      title: 'Hydration status and the diuretic action of a small dose of alcohol',
      journal: 'Alcohol and alcoholism (Oxford, Oxfordshire)',
      pmid: '20497950',
      doi: '10.1093/alcalc/agq029',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20497950/',
    },
    {
      id: 'field1963',
      authors: 'FIELD JB, WILLIAMS HE, MORTIMORE GE',
      year: 1963,
      title: 'Studies on the mechanism of ethanol-induced hypoglycemia',
      journal: 'The Journal of clinical investigation',
      pmid: '13945055',
      doi: '10.1172/jci104738',
      url: 'https://pubmed.ncbi.nlm.nih.gov/13945055/',
    },
    {
      id: 'niaaa2026',
      authors: 'National Institute on Alcohol Abuse and Alcoholism (NIAAA)',
      year: 2026,
      title: 'What is a standard drink?',
      journal: 'NIAAA web page (accessed 2026-09-30)',
      url: 'https://www.niaaa.nih.gov/alcohols-effects-health/overview-alcohol-consumption/what-standard-drink',
    },
    {
      id: 'dulloo1989',
      authors: 'Dulloo AG, Geissler CA, Horton T, et al.',
      year: 1989,
      title:
        'Normal caffeine consumption: influence on thermogenesis and daily energy expenditure in lean and postobese human volunteers',
      journal: 'The American journal of clinical nutrition',
      pmid: '2912010',
      doi: '10.1093/ajcn/49.1.44',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2912010/',
    },
    {
      id: 'astrup1990',
      authors: 'Astrup A, Toubro S, Cannon S, et al.',
      year: 1990,
      title:
        'Caffeine: a double-blind, placebo-controlled study of its thermogenic, metabolic, and cardiovascular effects in healthy volunteers',
      journal: 'The American journal of clinical nutrition',
      pmid: '2333832',
      doi: '10.1093/ajcn/51.5.759',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2333832/',
    },
    {
      id: 'acheson1980',
      authors: 'Acheson KJ, Zahorska-Markiewicz B, Pittet P, et al.',
      year: 1980,
      title:
        'Caffeine and coffee: their influence on metabolic rate and substrate utilization in normal weight and obese individuals',
      journal: 'The American journal of clinical nutrition',
      pmid: '7369170',
      doi: '10.1093/ajcn/33.5.989',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7369170/',
    },
    {
      id: 'hursel2011',
      authors: 'Hursel R, Viechtbauer W, Dulloo AG, et al.',
      year: 2011,
      title:
        'The effects of catechin rich teas and caffeine on energy expenditure and fat oxidation: a meta-analysis',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '21366839',
      doi: '10.1111/j.1467-789x.2011.00862.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21366839/',
    },
    {
      id: 'hursel2009',
      authors: 'Hursel R, Viechtbauer W, Westerterp-Plantenga MS',
      year: 2009,
      title: 'The effects of green tea on weight loss and weight maintenance: a meta-analysis',
      journal: 'International journal of obesity (2005)',
      pmid: '19597519',
      doi: '10.1038/ijo.2009.135',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19597519/',
    },
    {
      id: 'jurgens2012',
      authors: 'Jurgens TM, Whelan AM, Killian L, et al.',
      year: 2012,
      title: 'Green tea for weight loss and weight maintenance in overweight or obese adults',
      journal: 'The Cochrane database of systematic reviews',
      pmid: '23235664',
      doi: '10.1002/14651858.cd008650.pub2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23235664/',
    },
    {
      id: 'dulloo1999',
      authors: 'Dulloo AG, Duret C, Rohrer D, et al.',
      year: 1999,
      title:
        'Efficacy of a green tea extract rich in catechin polyphenols and caffeine in increasing 24-h energy expenditure and fat oxidation in humans',
      journal: 'The American journal of clinical nutrition',
      pmid: '10584049',
      doi: '10.1093/ajcn/70.6.1040',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10584049/',
    },
    {
      id: 'colladomateo2020',
      authors: 'Collado-Mateo D, Lavín-Pérez AM, Merellano-Navarro E, et al.',
      year: 2020,
      title:
        'Effect of Acute Caffeine Intake on the Fat Oxidation Rate during Exercise: A Systematic Review and Meta-Analysis',
      journal: 'Nutrients',
      pmid: '33255240',
      doi: '10.3390/nu12123603',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33255240/',
    },
    {
      id: 'tabrizi2019',
      authors: 'Tabrizi R, Saneei P, Lankarani KB, et al.',
      year: 2019,
      title:
        'The effects of caffeine intake on weight loss: a systematic review and dos-response meta-analysis of randomized controlled trials',
      journal: 'Critical reviews in food science and nutrition',
      pmid: '30335479',
      doi: '10.1080/10408398.2018.1507996',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30335479/',
    },
    {
      id: 'schubert2017',
      authors: 'Schubert MM, Irwin C, Seay RF, et al.',
      year: 2017,
      title: 'Caffeine, coffee, and appetite control: a review',
      journal: 'International journal of food sciences and nutrition',
      pmid: '28446037',
      doi: '10.1080/09637486.2017.1320537',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28446037/',
    },
    {
      id: 'grgic2020',
      authors: 'Grgic J, Grgic I, Pickering C, et al.',
      year: 2020,
      title:
        'Wake up and smell the coffee: caffeine supplementation and exercise performance-an umbrella review of 21 published meta-analyses',
      journal: 'British journal of sports medicine',
      pmid: '30926628',
      doi: '10.1136/bjsports-2018-100278',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30926628/',
    },
    {
      id: 'southward2018',
      authors: 'Southward K, Rutherfurd-Markwick KJ, Ali A',
      year: 2018,
      title:
        'The Effect of Acute Caffeine Ingestion on Endurance Performance: A Systematic Review and Meta-Analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '29876876',
      doi: '10.1007/s40279-018-0939-8',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29876876/',
    },
    {
      id: 'grgic2018',
      authors: 'Grgic J, Trexler ET, Lazinica B, et al.',
      year: 2018,
      title: 'Effects of caffeine intake on muscle strength and power: a systematic review and meta-analysis',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '29527137',
      doi: '10.1186/s12970-018-0216-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29527137/',
    },
    {
      id: 'guest2021',
      authors: 'Guest NS, VanDusseldorp TA, Nelson MT, et al.',
      year: 2021,
      title: 'International society of sports nutrition position stand: caffeine and exercise performance',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '33388079',
      doi: '10.1186/s12970-020-00383-4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33388079/',
    },
    {
      id: 'gardiner2023',
      authors: 'Gardiner C, Weakley J, Burke LM, et al.',
      year: 2023,
      title: 'The effect of caffeine on subsequent sleep: A systematic review and meta-analysis',
      journal: 'Sleep medicine reviews',
      pmid: '36870101',
      doi: '10.1016/j.smrv.2023.101764',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36870101/',
    },
    {
      id: 'drake2013',
      authors: 'Drake C, Roehrs T, Shambroom J, et al.',
      year: 2013,
      title: 'Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed',
      journal:
        'Journal of clinical sleep medicine : JCSM : official publication of the American Academy of Sleep Medicine',
      pmid: '24235903',
      doi: '10.5664/jcsm.3170',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24235903/',
    },
    {
      id: 'beaumont2017',
      authors: 'Beaumont R, Cordery P, Funnell M, et al.',
      year: 2017,
      title:
        'Chronic ingestion of a low dose of caffeine induces tolerance to the performance benefits of caffeine',
      journal: 'Journal of sports sciences',
      pmid: '27762662',
      doi: '10.1080/02640414.2016.1241421',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27762662/',
    },
    {
      id: 'nehlig2018',
      authors: 'Nehlig A',
      year: 2018,
      title: 'Interindividual Differences in Caffeine Metabolism and Factors Driving Caffeine Consumption',
      journal: 'Pharmacological reviews',
      pmid: '29514871',
      doi: '10.1124/pr.117.014407',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29514871/',
    },
    {
      id: 'hultman1996',
      authors: 'Hultman E, Söderlund K, Timmons JA, et al.',
      year: 1996,
      title: 'Muscle creatine loading in men',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '8828669',
      doi: '10.1152/jappl.1996.81.1.232',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8828669/',
    },
    {
      id: 'powers2003',
      authors: 'Powers ME, Arnold BL, Weltman AL, et al.',
      year: 2003,
      title: 'Creatine Supplementation Increases Total Body Water Without Altering Fluid Distribution',
      journal: 'Journal of athletic training',
      pmid: '12937471',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12937471/',
    },
    {
      id: 'kreider2017',
      authors: 'Kreider RB, Kalman DS, Antonio J, et al.',
      year: 2017,
      title:
        'International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '28615996',
      doi: '10.1186/s12970-017-0173-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28615996/',
    },
    {
      id: 'chilibeck2017',
      authors: 'Chilibeck PD, Kaviani M, Candow DG, et al.',
      year: 2017,
      title:
        'Effect of creatine supplementation during resistance training on lean tissue mass and muscular strength in older adults: a meta-analysis',
      journal: 'Open access journal of sports medicine',
      pmid: '29138605',
      doi: '10.2147/oajsm.s123529',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29138605/',
    },
    {
      id: 'desai2024',
      authors: 'Desai I, Wewege MA, Jones MD, et al.',
      year: 2024,
      title:
        'The Effect of Creatine Supplementation on Resistance Training-Based Changes to Body Composition: A Systematic Review and Meta-analysis',
      journal: 'Journal of strength and conditioning research',
      pmid: '39074168',
      doi: '10.1519/jsc.0000000000004862',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39074168/',
    },
    {
      id: 'burke2023',
      authors: 'Burke R, Piñero A, Coleman M, et al.',
      year: 2023,
      title:
        'The Effects of Creatine Supplementation Combined with Resistance Training on Regional Measures of Muscle Hypertrophy: A Systematic Review with Meta-Analysis',
      journal: 'Nutrients',
      pmid: '37432300',
      doi: '10.3390/nu15092116',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37432300/',
    },
    {
      id: 'naddafha2026',
      authors: 'Naddafha S, Antonio J, Kreider RB, et al.',
      year: 2026,
      title:
        'Creatine monohydrate for lean mass, strength, and bone density in postmenopausal women: a systematic review and meta-analysis',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '42141930',
      doi: '10.1080/15502783.2026.2668435',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42141930/',
    },
    {
      id: 'skulasray2019',
      authors: 'Skulas-Ray AC, Wilson PWF, Harris WS, et al.',
      year: 2019,
      title:
        'Omega-3 Fatty Acids for the Management of Hypertriglyceridemia: A Science Advisory From the American Heart Association',
      journal: 'Circulation',
      pmid: '31422671',
      doi: '10.1161/cir.0000000000000709',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31422671/',
    },
    {
      id: 'bernasconi2021',
      authors: 'Bernasconi AA, Wiest MM, Lavie CJ, et al.',
      year: 2021,
      title:
        'Effect of Omega-3 Dosage on Cardiovascular Outcomes: An Updated Meta-Analysis and Meta-Regression of Interventional Trials',
      journal: 'Mayo Clinic proceedings',
      pmid: '32951855',
      doi: '10.1016/j.mayocp.2020.08.034',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32951855/',
    },
    {
      id: 'martineau2017',
      authors: 'Martineau AR, Jolliffe DA, Hooper RL, et al.',
      year: 2017,
      title:
        'Vitamin D supplementation to prevent acute respiratory tract infections: systematic review and meta-analysis of individual participant data',
      journal: 'BMJ (Clinical research ed.)',
      pmid: '28202713',
      doi: '10.1136/bmj.i6583',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28202713/',
    },
    {
      id: 'bolland2018',
      authors: 'Bolland MJ, Grey A, Avenell A',
      year: 2018,
      title:
        'Effects of vitamin D supplementation on musculoskeletal health: a systematic review, meta-analysis, and trial sequential analysis',
      journal: 'The lancet. Diabetes & endocrinology',
      pmid: '30293909',
      doi: '10.1016/s2213-8587(18)30265-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30293909/',
    },
    {
      id: 'mumme2015',
      authors: 'Mumme K, Stonehouse W',
      year: 2015,
      title:
        'Effects of medium-chain triglycerides on weight loss and body composition: a meta-analysis of randomized controlled trials',
      journal: 'Journal of the Academy of Nutrition and Dietetics',
      pmid: '25636220',
      doi: '10.1016/j.jand.2014.10.022',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25636220/',
    },
    {
      id: 'wolfe2017',
      authors: 'Wolfe RR',
      year: 2017,
      title: 'Branched-chain amino acids and muscle protein synthesis in humans: myth or reality?',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '28852372',
      doi: '10.1186/s12970-017-0184-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28852372/',
    },
    {
      id: 'manore2012',
      authors: 'Manore MM',
      year: 2012,
      title:
        'Dietary supplements for improving body composition and reducing body weight: where is the evidence?',
      journal: 'International journal of sport nutrition and exercise metabolism',
      pmid: '22465867',
      doi: '10.1123/ijsnem.22.2.139',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22465867/',
    },
    {
      id: 'stubbs2017',
      authors: 'Stubbs BJ, Cox PJ, Evans RD, et al.',
      year: 2017,
      title: 'On the Metabolism of Exogenous Ketones in Humans',
      journal: 'Frontiers in physiology',
      pmid: '29163194',
      doi: '10.3389/fphys.2017.00848',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29163194/',
    },
    {
      id: 'garrison2020',
      authors: 'Garrison SR, Korownyk CS, Kolber MR, et al.',
      year: 2020,
      title: 'Magnesium for skeletal muscle cramps',
      journal: 'The Cochrane database of systematic reviews',
      pmid: '32956536',
      doi: '10.1002/14651858.cd009402.pub3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32956536/',
      verification: 'abstract',
    },
    {
      id: 'zibellini2015',
      authors: 'Zibellini J, Seimon RV, Lee CM, et al.',
      year: 2015,
      title:
        'Does Diet-Induced Weight Loss Lead to Bone Loss in Overweight or Obese Adults? A Systematic Review and Meta-Analysis of Clinical Trials',
      journal:
        'Journal of bone and mineral research : the official journal of the American Society for Bone and Mineral Research',
      pmid: '26012544',
      doi: '10.1002/jbmr.2564',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26012544/',
    },
    {
      id: 'villareal2011',
      authors: 'Villareal DT, Chode S, Parimi N, et al.',
      year: 2011,
      title: 'Weight loss, exercise, or both and physical function in obese older adults',
      journal: 'The New England journal of medicine',
      pmid: '21449785',
      doi: '10.1056/nejmoa1008234',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21449785/',
    },
    {
      id: 'shamswhite2017',
      authors: 'Shams-White MM, Chung M, Du M, et al.',
      year: 2017,
      title:
        'Dietary protein and bone health: a systematic review and meta-analysis from the National Osteoporosis Foundation',
      journal: 'The American journal of clinical nutrition',
      pmid: '28404575',
      doi: '10.3945/ajcn.116.145110',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28404575/',
    },
    {
      id: 'rogers2016',
      authors: 'Rogers PJ, Hogenkamp PS, de Graaf C, et al.',
      year: 2016,
      title:
        'Does low-energy sweetener consumption affect energy intake and body weight? A systematic review, including meta-analyses, of the evidence from human and animal studies',
      journal: 'International journal of obesity (2005)',
      pmid: '26365102',
      doi: '10.1038/ijo.2015.177',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26365102/',
    },
    {
      id: 'mcglynn2022',
      authors: 'McGlynn ND, Khan TA, Wang L, et al.',
      year: 2022,
      title:
        'Association of Low- and No-Calorie Sweetened Beverages as a Replacement for Sugar-Sweetened Beverages With Body Weight and Cardiometabolic Risk: A Systematic Review and Meta-analysis',
      journal: 'JAMA network open',
      pmid: '35285920',
      doi: '10.1001/jamanetworkopen.2022.2092',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35285920/',
    },
    {
      id: 'azad2017',
      authors: 'Azad MB, Abou-Setta AM, Chauhan BF, et al.',
      year: 2017,
      title:
        'Nonnutritive sweeteners and cardiometabolic health: a systematic review and meta-analysis of randomized controlled trials and prospective cohort studies',
      journal: "CMAJ : Canadian Medical Association journal = journal de l'Association medicale canadienne",
      pmid: '28716847',
      doi: '10.1503/cmaj.161390',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28716847/',
    },
    {
      id: 'romoromo2016',
      authors: 'Romo-Romo A, Aguilar-Salinas CA, Brito-Córdova GX, et al.',
      year: 2016,
      title:
        'Effects of the Non-Nutritive Sweeteners on Glucose Metabolism and Appetite Regulating Hormones: Systematic Review of Observational Prospective Studies and Clinical Trials',
      journal: 'PloS one',
      pmid: '27537496',
      doi: '10.1371/journal.pone.0161264',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27537496/',
    },
    {
      id: 'suez2022',
      authors: 'Suez J, Cohen Y, Valdés-Mas R, et al.',
      year: 2022,
      title: 'Personalized microbiome-driven effects of non-nutritive sweeteners on human glucose tolerance',
      journal: 'Cell',
      pmid: '35987213',
      doi: '10.1016/j.cell.2022.07.016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35987213/',
    },
    {
      id: 'mullins2021',
      authors: 'Mullins AP, Arjmandi BH',
      year: 2021,
      title: 'Health Benefits of Plant-Based Nutrition: Focus on Beans in Cardiometabolic Diseases',
      journal: 'Nutrients',
      pmid: '33562498',
      doi: '10.3390/nu13020519',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33562498/',
      verification: 'abstract',
    },
    {
      id: 'cummings1987',
      authors: 'Cummings JH, Pomare EW, Branch WJ, et al.',
      year: 1987,
      title: 'Short chain fatty acids in human large intestine, portal, hepatic and venous blood',
      journal: 'Gut',
      pmid: '3678950',
      doi: '10.1136/gut.28.10.1221',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3678950/',
    },
    {
      id: 'visser2009',
      authors: 'Visser FW, Krikken JA, Muntinga JH, et al.',
      year: 2009,
      title: 'Rise in extracellular fluid volume during high sodium depends on BMI in healthy men',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '19282825',
      doi: '10.1038/oby.2009.61',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19282825/',
    },
    {
      id: 'vandenboschjjjon2021',
      authors: 'van den Bosch JJJON, Hessels NR, Visser FW, et al.',
      year: 2021,
      title: 'Plasma sodium, extracellular fluid volume, and blood pressure in healthy men',
      journal: 'Physiological reports',
      pmid: '34921521',
      doi: '10.14814/phy2.15103',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34921521/',
    },
    {
      id: 'krikken2012',
      authors: 'Krikken JA, Dallinga-Thie GM, Navis G, et al.',
      year: 2012,
      title:
        'Short term dietary sodium restriction decreases HDL cholesterol, apolipoprotein A-I and high molecular weight adiponectin in healthy young men: relationships with renal hemodynamics and RAAS activation',
      journal: 'Nutrition, metabolism, and cardiovascular diseases : NMCD',
      pmid: '20678904',
      doi: '10.1016/j.numecd.2010.03.010',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20678904/',
    },
  ],
};

export default topic;
