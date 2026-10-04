import type { EvidenceTopic } from '../schema';

/** Evidence topic for research/04-carbohydrate-glycogen-insulin.md (pure data). */
const topic: EvidenceTopic = {
  dossier: '04',
  slug: 'carbohydrate-glycogen-insulin',
  title: 'Carbohydrate, glycogen and insulin',
  scope:
    "What happens to eaten carbohydrate between the gut and the body's fuel stores: how much glycogen the liver and muscles hold and how fast it is used and refilled, how much is burned, and when any is turned into fat. It also covers the glucose and insulin response to a meal, how insulin sensitivity changes, fructose and fibre, and how much carbohydrate the body really needs. Fat burning, ketosis and fasting are covered in other topics.",
  mechanisms: [
    {
      id: '04-glycogen-capacity-water-potassium',
      title: 'How much glycogen the body can store, and the water and potassium it carries',
      category: 'fuel',
      summary:
        "Glycogen is the body's stored carbohydrate. The liver holds a typical 80 g and the muscles about 500 g. Liver glycogen keeps blood glucose steady, while muscle glycogen is used almost only by the muscle that stores it. Glycogen is stored with water and potassium, which is why carbohydrate changes show up as quick weight changes on the scale.",
      howModelled:
        'The engine keeps a liver pool and a separate pool for each muscle group. Capacity is set from an upper limit per litre of liver and per kilogram of muscle, and glycogen water is counted as 3 g per gram (range 2–4). It also counts 0.45 mmol of potassium per gram, so fast water-weight swings are part of the picture.',
      equation: `G_L,max = C_L,max · V_liv · 0.162          (C_L,max = 500 mmol/L, about 115 g for 1.45 L)
G_M,max = Σ_j 0.162 · c_M,max · SMM_j     (c_M,max = 200 mmol/kg wet weight, range 180–290)
G_cap = G_L,max + G_M,max                  (sanity check: about 15 g per kg body mass)
W_G = h · (G_L + G_M)/1000                 (kg of bound water, h = 3.0 g/g)
ΔScaleWeight_glycogen = (1 + h) · ΔG_tot/1000   (kg)
K_G = 0.45 · (G_L + G_M)                   (mmol of potassium)`,
      keyNumbers: [
        {
          label: 'Typical stores',
          value: 'Liver about 80 g (range 0–160 g); muscle about 500 g (range 300–700 g)',
          referenceIds: ['murray2018'],
        },
        {
          label: 'Liver glycogen concentration (13C magnetic resonance)',
          value:
            '4 h after a meal 282 ± 60 mmol/L in healthy controls vs 131 ± 20 in type 2 diabetes; evening to morning 350 ± 18 → 207 ± 22 mmol/L',
          referenceIds: ['magnusson1992', 'taylor1996'],
        },
        {
          label: 'Muscle glycogen in meta-regression (181 studies, males)',
          value:
            '462 ± 132 mmol/kg dry weight (about 107 mmol/kg wet weight) at VO2max 53 ± 8; +102 ± 47 with high carbohydrate (6 g/kg/d or more for 3 days or more); −253 ± 30 with low carbohydrate plus depletion',
          note: 'Per +10 mL/kg/min of VO2max: +29 (low carbohydrate), +67 (normal) and +80 (high carbohydrate) mmol/kg dry weight. Dry weight is about 4.3 × wet weight.',
          referenceIds: ['areta2018'],
        },
        {
          label: 'Classic biopsy study (9 healthy men after exhaustive exercise)',
          value:
            'After 3 days: mixed diet 1.75, fat and protein 0.63, carbohydrate 3.31 g/100 g wet weight (about 108 / 39 / 204 mmol/kg); maximum reported 4.7 g/100 g (about 290 mmol/kg)',
          referenceIds: ['bergstrom1967'],
        },
        {
          label: 'Loading in a single day (8 endurance-trained men)',
          value:
            '95 → 180 mmol/kg wet weight after 24 h at 10 g/kg/d of high-glycaemic-index carbohydrate while inactive; no further rise at 72 h',
          referenceIds: ['bussau2002'],
        },
        {
          label: 'Whole-body glycogen capacity',
          value:
            'About 15 g/kg body mass; a gain of about 500 g above normal was accommodated before net lipid synthesis',
          note: '3 men, 7 days of carbohydrate overfeeding after depletion.',
          referenceIds: ['acheson1988'],
        },
        {
          label: 'Skeletal muscle mass (MRI, n = 468)',
          value: 'Men 33.0 kg (38.4% of body mass); women 21.0 kg (30.6%)',
          referenceIds: ['janssen2000'],
        },
        {
          label: 'Water per gram of glycogen: earlier estimates',
          value:
            '"3–4 g" (tritium dilution plus biopsies); 2.7–4 g quoted; animal liver 1.6–3.8 g/g; human evidence described as inconclusive',
          referenceIds: ['olsson1970', 'shiose2022'],
        },
        {
          label: 'Water per gram of glycogen: biopsy and whole-body data',
          value:
            'At least 3 g/g recovered with glycogen when fluid was restricted; 1:17 with full rehydration (extra water not bound to glycogen); about 2 g/g from whole-body deuterium-oxide data (derived)',
          note: 'In 8 men after 72 h at 12 g/kg/d, muscle glycogen rose 72.7 → 169.4 mmol/kg wet weight (about 440 g across about 28 kg of muscle, assumed) while total body water rose only 0.9 kg (39.3 → 40.2 kg). The precision of the water method is ±0.5 kg. The model uses 3.0 g/g (range 2–4).',
          referenceIds: ['fernandezelias2015', 'shiose2016'],
        },
        {
          label: 'Potassium stored with glycogen',
          value: '0.45 mmol per g',
          note: 'Measured as total body potassium in people on very-low-calorie diets.',
          referenceIds: ['kreitzman1992'],
        },
        {
          label: 'Scale-weight change with loading',
          value: '+1.0–1.5 kg of body water',
          referenceIds: ['shiose2022', 'shiose2016'],
        },
      ],
      timeCourse:
        'See the entries on fasting, exercise, repletion and supercompensation for how stores fill and empty over hours to days.',
      moderators:
        'Training raises resting and maximal muscle glycogen (+67 mmol/kg dry weight per +10 mL/kg/min of VO2max on a normal diet). Women have slightly higher concentrations but less muscle mass. Type 2 diabetes lowers liver glycogen (131 vs 282 mmol/L) and muscle glycogen (57 vs 69 mmol/L).',
      grade: 'B',
      gradeReason:
        'Stores and capacity are well supported by many biopsy and magnetic-resonance studies and a meta-analysis (grade A−), but the water ratio varies with hydration (grade B−).',
      status: 'established',
      caveats:
        'Liver volume scaling with fat-free mass is unverified. Water per gram of glycogen is uncertain, and it is hard to separate from the sodium and fluid effects of insulin covered in other topics.',
      referenceIds: [
        'murray2018',
        'magnusson1992',
        'taylor1996',
        'areta2018',
        'bergstrom1967',
        'bussau2002',
        'acheson1988',
        'janssen2000',
        'olsson1970',
        'shiose2022',
        'fernandezelias2015',
        'shiose2016',
        'kreitzman1992',
      ],
      relatedMetricIds: ['glycogenTotal', 'liverGlycogen', 'muscleGlycogen', 'glycogenWater'],
    },
    {
      id: '04-liver-glycogen-fasting-exercise',
      title: 'Liver glycogen during fasting and exercise',
      category: 'fuel',
      summary:
        'About 4–6 hours after a meal, the liver keeps blood glucose steady by breaking down glycogen and by making new glucose (gluconeogenesis). As the store shrinks, glycogen breakdown falls and gluconeogenesis takes over. Exercise speeds the drain, and eating carbohydrate during exercise spares it. Depleted liver glycogen is the main driver of rising ketone production.',
      howModelled:
        'Liver glycogen empties by a first-order process with a 24-hour time constant, held back while food is being absorbed. During exercise an extra drain depends on intensity and on the carbohydrate eaten. A small floor stays even after long fasts.',
      equation: `J_L,out(t) = (G_L − G_L,floor)/τ_L · (1 − σ_fed(t)) + J_L,ex(t)      [g/h]
dG_L/dt = S_L(t) − J_L,out(t)
σ_fed(t) = min(1, Ra_glc,total(t)/R_half),   R_half = 10 g/h
J_L,ex(t) = 30 · max(0, I − 0.20) · (G_L/G_L,ref)^0.5 · (1 − min(1, CHO_in,ex/1.2))    [g/h]
(I = fraction of VO2max, CHO_in,ex = carbohydrate eaten during exercise in g/min, G_L,ref = 80 g)`,
      keyNumbers: [
        {
          label: 'Share of glucose production from gluconeogenesis during a 68-hour fast',
          value: '64 ± 5% in the first 22 h, 82 ± 5% in the next 14 h, 96 ± 1% in a later 18 h',
          referenceIds: ['rothman1991'],
        },
        {
          label: 'Overnight tracer study',
          value:
            'Net liver glycogen depletion about 0.93 mg/kg/min (46% of glucose production of 2.19 mg/kg/min); at 60 h glucose production 1.43 mg/kg/min with 78% from gluconeogenesis',
          referenceIds: ['hellerstein1997'],
        },
        {
          label: 'Controls, 4 to 22.5 h after a meal',
          value:
            '282 → 98 mmol/L; mean fall 10.5 ± 2.0 mmol/(L·h), about 2.0 g/h (derived); net glycogenolysis 2.8 µmol/kg/min; gluconeogenesis 70% of glucose production',
          note: 'In type 2 diabetes, net glycogenolysis was 1.3 vs 2.8 µmol/kg/min and gluconeogenesis 88% of production; liver volume shrank about 23% over 67 h of fasting.',
          referenceIds: ['magnusson1992'],
        },
        {
          label: 'Evening meal plus 4 h to 06:00',
          value: '350 → 207 mmol/L (about −41% in about 10.5 h), about 3.2 g/h (derived)',
          referenceIds: ['taylor1996'],
        },
        {
          label: 'Overnight, 20:00 to 06:00',
          value: 'Liver glycogen −21 to −23%; muscle +2–3% (unchanged)',
          referenceIds: ['iwayama2021'],
        },
        {
          label: 'Fitted constants',
          value: 'τ_L = 24 h (18–36); G_L,floor = 5 g (0–15, unverified); R_half = 10 g/h (unverified)',
          note: 'An exponential with τ_L = 24 h gives −35% over 10.5 h (Taylor: −41%) and −54% over 18.5 h (Magnusson: −65%).',
          referenceIds: ['magnusson1992', 'taylor1996', 'iwayama2021', 'hellerstein1997', 'rothman1991'],
        },
        {
          label: 'Time course of depletion',
          value:
            'Half-life about 17 h; an overnight fast removes about 25–40%; at 24 h about 60–65% is gone (15–25 g left); at 48 h about 85–90% is gone',
          referenceIds: ['magnusson1992', 'taylor1996'],
        },
        {
          label: 'Liver glycogen during 3 h of exercise at 50% of peak power',
          value:
            'With water only 454 → 283 mmol/L (about −50 g, or about 17 g/h, derived); with 1.7 g/min of glucose or sucrose no decline (325 → 345; 321 → 348 mmol/L)',
          note: 'Eating more than 1.5 g/min prevents depletion during moderate exercise.',
          referenceIds: ['gonzalez2015', 'gonzalez2016'],
        },
        {
          label: 'Fasted running',
          value:
            '60 min at 70% VO2max before breakfast took liver glycogen from −23% (overnight) to −46% of the evening value, about 13 g/h extra (derived)',
          referenceIds: ['iwayama2021'],
        },
        {
          label: 'Fitted exercise drain',
          value:
            'About 9 g/h at 50%, 13.5 g/h at 65% and 19.5 g/h at 85% of VO2max; slope 30 g/h per unit intensity (±50%); threshold 0.20 (0.15–0.30, unverified); full sparing at 1.2–1.5 g/min of carbohydrate',
          referenceIds: ['iwayama2021', 'gonzalez2015', 'gonzalez2016'],
        },
      ],
      timeCourse:
        'Half-life about 17 hours in fasting. Liver glycogen is largely gone after 24–48 hours, which is when ketone production ramps up. Glucose output is suppressed within 30 minutes of a large glucose meal and back to basal by about 4–5 hours.',
      moderators:
        'Liver volume and body mass, type 2 diabetes (less glycogen and less glycogenolysis), exercise intensity and carbohydrate eaten during exercise.',
      grade: 'C',
      gradeReason:
        'Fasting depletion is supported by direct magnetic-resonance time series (grade A−), but the exercise drain is interpolated between two studies (grade C).',
      status: 'proposed-fit',
      caveats:
        'The equations are fits by Vitals. The floor value is grade C. Liver biopsy studies by Nilsson and Hultman were not accessed beyond the citation, so the model relies on magnetic-resonance studies.',
      referenceIds: [
        'rothman1991',
        'hellerstein1997',
        'magnusson1992',
        'taylor1996',
        'iwayama2021',
        'gonzalez2015',
        'gonzalez2016',
        'nilsson1973a',
        'nilsson1973b',
      ],
      relatedMetricIds: ['liverGlycogen', 'glycogenTotal'],
    },
    {
      id: '04-muscle-glycogen-use-exercise',
      title: 'Muscle glycogen use in endurance and resistance exercise',
      category: 'fuel',
      summary:
        'Muscle glycogen use rises steeply with exercise intensity, because more fast-twitch fibres are recruited. It is faster when the muscle starts with more glycogen and slows over time. Keto-adaptation cuts its use at moderate intensities by about a factor of four. Resistance training uses a share of the glycogen in the worked muscle that rises with the number of sets.',
      howModelled:
        'For endurance work, the rate per kilogram of active muscle rises as a power of intensity above 25% of VO2max, scaled by how full the muscle is and reduced by keto-adaptation. For resistance training, the fraction removed rises with sets and levels off at 40%. Muscle glycogen does not fall below about 10% of the starting value.',
      equation: `u_ex(I) = 0.9 · ((I − 0.25)/0.50)^1.5   for I > 0.25, else 0        [mmol/kg wet weight/min]
U_ex,j = u_ex(I) · (c_M,j/110)^0.5 · (1 − 0.75·A_keto)
D_RT,j = D_max · (1 − exp(−sets_j/s0)),   D_max = 0.40, s0 = 3 sets
c_M,j ← c_M,j · (1 − D_RT,j · (c_M,j/110)^0.3)`,
      keyNumbers: [
        {
          label: 'Use at about 75% of VO2max (mmol/kg wet weight/min)',
          value:
            '0.88 on a mixed diet, 0.54 after a fat-and-protein diet, 1.06 after a high-carbohydrate diet',
          referenceIds: ['bergstrom1967'],
        },
        {
          label: 'Use at 62–64% of VO2max in 5 trained cyclists',
          value:
            '0.61 on a mixed diet → 0.13 after 4 weeks of a very-low-carbohydrate diet (often called ketogenic)',
          note: 'The unit was reported without stating wet or dry weight, and wet weight is assumed (unverified).',
          referenceIds: ['phinney1983'],
        },
        {
          label: 'Elite ultra-endurance athletes at 64% of VO2max for 180 min',
          value:
            'Muscle glycogen −64% of pre-exercise, the same in keto-adapted and high-carbohydrate athletes',
          referenceIds: ['volek2016'],
        },
        {
          label: 'Running at 73% of VO2max',
          value: '5.0 (loaded) vs 3.1 (moderate) mmol/kg per km',
          referenceIds: ['sherman1981'],
        },
        {
          label: 'Cycling for 3 h at 50% of peak power with 1.7 g/min carbohydrate (13C magnetic resonance)',
          value: '101 → 60 mmol/L (about 0.23/min)',
          referenceIds: ['gonzalez2015'],
        },
        {
          label: 'Meta-regression, intensity and starting level',
          value:
            '+30% of VO2max intensity meant +87 to +134 mmol/kg dry weight extra use at 23–116 min; starting glycogen +200 mmol/kg dry weight meant more glycogen used',
          referenceIds: ['areta2018'],
        },
        {
          label: 'Fit to the data (mmol/kg/min)',
          value:
            'I = 0.50 → 0.32; 0.64 → 0.62; 0.75 → 0.90; 0.85 → 1.18 (data 0.23–0.32, 0.46–0.61, 0.88–1.06). At 70% of VO2max with about 13 kg of active leg muscle, about 1.6 g/min from muscle glycogen',
          note: 'Parameters: 0.9 at 75% (±30%); intensity exponent 1.5 (1.2–2); availability exponent 0.5 (0.3–1.9); keto-adaptation reduction 75% (60–80%, Phinney 79%). Active muscle is about 0.40 of skeletal muscle mass for cycling and running (unverified). All-out sprints can reach far higher rates.',
          referenceIds: ['bergstrom1967', 'sherman1981', 'phinney1983', 'murray2018'],
        },
        {
          label: 'Fuel mix by intensity',
          value:
            'At 25% of VO2max muscle glycogen oxidation is negligible and plasma fatty acids dominate; from 65% to 85% glycogen and plasma-glucose oxidation increase with intensity',
          referenceIds: ['romijn1993', 'vanloon2001'],
        },
        {
          label: 'Resistance training: biceps and leg',
          value:
            'Biceps −12% after 1 set and −24% after 3 sets at 80% of 1RM. Leg extension: 6 sets at 70% or 35% of 1RM with equal work gave the same −47 mmol/kg wet weight, at about twice the rate at 70%',
          referenceIds: ['macdougall1999', 'robergs1991'],
        },
        {
          label: 'Resistance training: whole sessions',
          value:
            '5 sets × 4 lower-body exercises (about 30 min): 160 → 118 mmol/kg wet weight (−26%). About 45 min of whole-body work in untrained men: −23% (type I), −40% (IIa), −44% (IIx). Review range −25 to −40%',
          note: 'No net resynthesis over 2 h of fasted recovery in untrained men; +14–22 mmol/kg in 2 h without food in trained men (lactate-derived).',
          referenceIds: ['tesch1986', 'koopman2006', 'robergs1991', 'murray2018'],
        },
        {
          label: 'Fit for resistance training',
          value:
            'D_max 0.40 (0.25–0.50); s0 = 3 sets (2–5): 1 set → 11% (observed 12%), 3 sets → 25% (24%), 6 sets → 35% (about 30–38%), 15 or more → 40% (Tesch 26%)',
          note: 'A leg day of 12 sets removes about 0.39 of leg glycogen, about 100–150 g.',
          referenceIds: ['macdougall1999', 'koopman2006', 'tesch1986'],
        },
      ],
      timeCourse:
        'Use continues through exercise and slows as stores fall; resistance sessions remove glycogen over the length of the session.',
      moderators:
        'Exercise intensity, starting glycogen, keto-adaptation, active muscle mass, number of sets and training status.',
      grade: 'B',
      gradeReason:
        'Many biopsy studies support the endurance rates (grade B) though pooled across protocols, and the resistance-training data are consistent small biopsy studies (grade B−).',
      status: 'proposed-fit',
      caveats:
        'Both equations are fits by Vitals. The active muscle mass by exercise type is unverified and belongs to the cardio topic; set counts come from the resistance-training topic.',
      referenceIds: [
        'bergstrom1967',
        'phinney1983',
        'volek2016',
        'sherman1981',
        'gonzalez2015',
        'areta2018',
        'murray2018',
        'romijn1993',
        'vanloon2001',
        'macdougall1999',
        'robergs1991',
        'tesch1986',
        'koopman2006',
      ],
      relatedMetricIds: ['muscleGlycogen', 'glycogenTotal'],
    },
    {
      id: '04-muscle-glycogen-rest-low-carb',
      title: 'Muscle glycogen at rest, on low carbohydrate and with keto-adaptation',
      category: 'fuel',
      summary:
        'Resting muscle hardly uses its own glycogen, and an overnight fast leaves it unchanged. On low carbohydrate intake, meals no longer refill it while a slow breakdown continues, so it drifts down over days. After months of keto-adaptation, athletes had resting glycogen similar to high-carbohydrate athletes.',
      howModelled:
        'In the fasted hours, muscle glycogen slowly leaks away at a small fraction of what is above a floor, less so when keto-adapted. The released carbon goes to lactate and then to the liver, and is booked as an input to glucose production, not as carbohydrate burned.',
      equation:
        'J_M,rest,j = k_Mr · (c_M,j − c_M,floor) · (1 − σ_fed(t)) · (1 − 0.5·A_keto)     [mmol/kg wet weight/h]',
      keyNumbers: [
        {
          label:
            '3 days of low carbohydrate, high fat (65% fat, 20% carbohydrate) vs high carbohydrate (70%), trained men',
          value: '439 → 358 mmol/kg dry weight (−18%) vs 407 → 498 (+22%)',
          referenceIds: ['tarry2025'],
        },
        {
          label: '3 days on a fat-and-protein diet after exhaustive exercise',
          value: 'Glycogen recovered to about 30% of the starting level (0.63 g/100 g)',
          referenceIds: ['bergstrom1967'],
        },
        {
          label: 'Very-low-carbohydrate diet for 4 weeks (under 20 g/d)',
          value: 'Resting glycogen roughly halved (143 → 76, unverified)',
          note: 'The abstract gives only use rates, so this number is not confirmed.',
          referenceIds: ['phinney1983'],
        },
        {
          label: 'Athletes keto-adapted for more than 6 months (about 10% carbohydrate)',
          value:
            'Resting glycogen not different from high-carbohydrate athletes; same depletion (−64%) and 2-hour repletion (−36% of pre-exercise)',
          referenceIds: ['volek2016'],
        },
        {
          label: 'Overnight and after a meal',
          value:
            'Overnight fast +2–3% (unchanged). After a meal, gastrocnemius glycogen rose 69 → 97 mmol/L at 240 min',
          referenceIds: ['iwayama2021', 'carey2003'],
        },
        {
          label: 'Fitted constants',
          value: 'k_Mr = 0.0035 per h (0.002–0.005); c_M,floor = 25 mmol/kg wet weight (15–40, unverified)',
          note: 'About −14% over 3 days at 20% of energy from carbohydrate with about 16 post-absorptive hours a day (observed −18%), and about −5% per day decay of supercompensated stores.',
          referenceIds: ['tarry2025', 'arnall2007'],
        },
      ],
      timeCourse:
        'On very low carbohydrate intake, liver glycogen empties in about 1–2 days and muscle falls about 15–30% in 3–7 days depending on activity. If keto-adaptation completes, muscle recovers towards 80–100% of normal over weeks to months (grade C).',
      moderators: 'Carbohydrate intake, activity level and the degree of keto-adaptation.',
      grade: 'C',
      gradeReason:
        'Few studies with varied protocols support it, and the key value from the 4-week very-low-carbohydrate study is unverified.',
      status: 'proposed-fit',
      caveats:
        'The keto-adapted restoration rests on one cross-sectional study. The rate constant and the keto terms are grade C or D.',
      referenceIds: [
        'tarry2025',
        'bergstrom1967',
        'phinney1983',
        'volek2016',
        'iwayama2021',
        'carey2003',
        'arnall2007',
      ],
      relatedMetricIds: ['muscleGlycogen', 'glycogenTotal'],
    },
    {
      id: '04-muscle-glycogen-repletion-supercompensation',
      title: 'Refilling muscle glycogen, and supercompensation',
      category: 'fuel',
      summary:
        'After glycogen-depleting exercise, refilling has a fast phase in the first 30–60 minutes that does not need insulin, then a slower insulin-dependent phase lasting hours. The rate depends on carbohydrate supply up to about 1.0–1.2 g per kilogram per hour. After a big carbohydrate load, stores can overshoot normal (supercompensation), and then decay back over days.',
      howModelled:
        'Repletion in each muscle group saturates with carbohydrate supply, is scaled by how full the muscle already is, is boosted after exercise by a fast and a slow component, and is scaled by insulin sensitivity and carbohydrate tolerance. Protein adds a small credit only when carbohydrate is low. The rate can never exceed the glucose left after the liver and oxidation.',
      equation: `S_M,j = S_max · Φ(R) · (1 − (c_M,j/c_M,cap)^4) · (1 + E_ex,j) · S_mus^0.5 · T_C^0.5      [mmol/kg wet weight/h]
Φ(R) = R_eff/(R_eff + K_R),   R_eff = R_CHO + 0.5·min(R_prot, 0.4)·[R_CHO < 1.0]     (g/kg body mass/h)
E_ex,j(t) = E_rapid·exp(−Δt/τ_E1) + E_slow·exp(−Δt/τ_E2),   c_M,cap = 200 mmol/kg wet weight
with no carbohydrate: S = 1.5 mmol/kg/h × exp(−Δt/1.5 h)`,
      keyNumbers: [
        {
          label: '2 g/kg carbohydrate immediately after exercise vs 2 h later',
          value:
            '7.7 vs 2.5 mmol/kg wet weight/h in the first 2 h; 4.3 vs 4.1 in hours 2–4 (delayed feeding still 45% slower)',
          referenceIds: ['ivy1988'],
        },
        {
          label: 'Highest reported rates',
          value:
            '1.0–1.85 g/kg/h of carbohydrate at 15–60 min intervals for up to 5 h; delay lowers the rate by about 50%. At 1.0–1.2 g/kg/h, 10–11 mmol/kg wet weight/h',
          note: 'The maximum of about 10 mmol/kg/h holds for about 4 h, then about 50% for hours 4–6; refilling 150 mmol/kg needs about 24 h.',
          referenceIds: ['jentjens2003', 'murray2018'],
        },
        {
          label: 'Daily carbohydrate and repletion',
          value:
            '10 g/kg/d of high-glycaemic-index carbohydrate over 24 h gave 106 mmol/kg wet weight (about 4.4/h) vs 72 with low glycaemic index; 24 h at 9.8 vs 1.9 g/kg/d restored 93% vs 13% of glycogen used in 2 h at 65% of VO2max',
          referenceIds: ['murray2018'],
        },
        {
          label: 'No carbohydrate',
          value: '1–2 mmol/kg wet weight/h from gluconeogenesis and lactate, and none after about 4 h',
          referenceIds: ['murray2018', 'fuchs2019'],
        },
        {
          label: 'Glucose or sucrose at 1.5 g/kg/h for 5 h',
          value: 'Muscle 85 → 140 vs 86 → 136 mmol/L (no difference)',
          referenceIds: ['fuchs2016'],
        },
        {
          label: 'Sedentary mixed meal (190 g carbohydrate)',
          value: 'Gastrocnemius 69 → 97 mmol/L at 240 min (about 7 mmol/L/h); type 2 diabetes 57 → 66',
          referenceIds: ['carey2003'],
        },
        {
          label: 'Insulin clamp',
          value:
            'Glycogen synthesis 183 ± 39 vs 78 ± 28 µmol/kg wet weight/min in normal vs type 2 diabetes; muscle glycogen synthesis was most of whole-body glucose uptake',
          referenceIds: ['shulman1990'],
        },
        {
          label: 'Fitted constants',
          value:
            'S_max = 7.5 mmol/kg wet weight/h (5–10); K_R = 0.3 g/kg/h (0.2–0.5); E_rapid = 1.0; τ_E1 = 1.5 h (1–3); E_slow = 0.3; τ_E2 = 36 h (24–48)',
          note: 'Enhanced insulin action persists at 48 h and is gone by 5 days. Protein credit: 0.5 g carbohydrate-equivalent per g of protein when carbohydrate is under 1.0 g/kg/h and protein up to 0.4 g/kg (magnitude unverified).',
          referenceIds: ['bussau2002', 'mikines1988', 'jentjens2003', 'burke2017', 'murray2018'],
        },
        {
          label: 'Loading protocols',
          value:
            'Classic 3 days low then 3 days high carbohydrate 207 mmol/kg wet weight; moderate protocol 203; 6 days at 50% carbohydrate 159. One day of 10 g/kg/d while inactive: 95 → 180 with no further gain on days 2–3. 72 h at 12 g/kg/d after depletion: 73 → 169',
          referenceIds: ['sherman1981', 'bussau2002', 'shiose2016'],
        },
        {
          label: 'Persistence after a 3-day load then a 60%-carbohydrate diet with limited activity',
          value:
            'Stores fall 34%, 20% and 46% from peak at 3, 5 and 7 days as summarised, and stay significantly elevated for up to 5 days; decay under a normal diet at rest is about 5% per day',
          note: 'The three percentages do not fall steadily, so treat this summary with caution. Loading adds +1.0–1.5 kg of body water.',
          referenceIds: ['arnall2007', 'shiose2022'],
        },
      ],
      timeCourse:
        'Fast phase for 30–60 minutes after exercise; insulin-dependent phase for hours; enhanced insulin action for about 36–48 hours. Both depletion-then-loading and simple loading reach about 180–210 mmol/kg within 24–72 hours.',
      moderators:
        'Carbohydrate supply and timing, prior exercise, current glycogen level, insulin sensitivity and carbohydrate tolerance.',
      grade: 'C',
      gradeReason:
        'The repletion rates are well supported by reviews and many trials (grade A−), but the exact functional form is our own fit (grade C).',
      status: 'proposed-fit',
      caveats:
        'The protein credit magnitude is unverified. Supercompensation needs a sharp saturation term plus the post-exercise boost to match both loading protocols.',
      referenceIds: [
        'ivy1988',
        'jentjens2003',
        'murray2018',
        'fuchs2019',
        'fuchs2016',
        'carey2003',
        'shulman1990',
        'bussau2002',
        'mikines1988',
        'burke2017',
        'sherman1981',
        'shiose2016',
        'arnall2007',
        'shiose2022',
      ],
      relatedMetricIds: ['muscleGlycogen', 'glycogenTotal'],
    },
    {
      id: '04-liver-glycogen-repletion-fructose',
      title: 'Refilling liver glycogen, and the role of fructose',
      category: 'fuel',
      summary:
        'About a fifth of an oral glucose meal ends up as extra liver glycogen. Fructose is taken up by the liver on its first pass and releases the enzyme glucokinase from its regulatory protein, which about doubles liver glycogen refilling when eaten with glucose. Muscle glycogen refilling is not changed by fructose.',
      howModelled:
        'Liver glycogen synthesis is a share of the glucose reaching the liver plus a share of fructose and galactose, up to a maximum rate, slowing as the liver fills. After exercise the glucose share is halved because muscle competes. Of the rest of the fructose, 40% is released as glucose an hour later and 45% is burned.',
      equation: `S_L = min( V_L,syn, α_glc·Ra_glc,portal + α_fru·(Ra_fru + Ra_gal) ) · (1 − G_L/G_L,max)^0.5      [g/h]
α_glc = 0.20 at rest, 0.10 when muscle is depleted after exercise
α_fru = 0.15 (direct glycogen); of the rest of fructose, 0.40 becomes glucose (1-hour delay) and 0.45 is oxidised`,
      keyNumbers: [
        {
          label: 'Liquid mixed meal with 139 g glucose',
          value:
            '+0.34 mmol/(L·min) (about 20 mmol/L/h, about 4.7 g/h), +28 g at peak, about 19% of the meal carbohydrate; 46% via the direct pathway at 2–4 h and 68% at 4–6 h',
          referenceIds: ['taylor1996'],
        },
        {
          label: 'After exercise, glucose only (0.9 g/kg/h or more)',
          value: 'About 3.5 g/h',
          referenceIds: ['fuchs2019'],
        },
        {
          label: 'After exercise, glucose plus fructose or sucrose',
          value: 'About 7.4 g/h, roughly double',
          referenceIds: ['fuchs2019', 'decombaz2011', 'fuchs2016'],
        },
        {
          label: 'Sucrose vs glucose at 1.5 g/kg/h for 5 h',
          value: 'Liver 53.6 → 86.8 g vs 49.3 → 65.7 g; sucrose added +3.4 g/h (95% CI 1.6–5.1)',
          referenceIds: ['fuchs2016'],
        },
        {
          label: '69 g/h maltodextrin plus fructose or galactose vs plus glucose',
          value: '24 ± 2 mmol/L/h with fructose, about twice glucose',
          referenceIds: ['decombaz2011'],
        },
        {
          label: '1 g/kg glucose vs sucrose after exercise',
          value: '+13 ± 8 g vs +25 ± 5 g of liver glycogen in 4 h; no muscle resynthesis',
          referenceIds: ['casey2000'],
        },
        {
          label: 'Fate of fructose within 3–6 h at rest',
          value:
            '45 ± 11% oxidised; 41 ± 11% converted to glucose; about 25% to lactate; at least 15% to liver glycogen; under 1% directly to plasma triglyceride',
          referenceIds: ['sun2012', 'fuchs2019'],
        },
        {
          label: 'Fitted constants',
          value:
            'α_glc 0.20 at rest (0.15–0.25) and 0.10 after exercise (0.05–0.15); α_fru 0.15 (0.07–0.30); V_L,syn 8 g/h (6–10)',
          note: 'The maximum observed rate was about 7.4 g/h.',
          referenceIds: ['taylor1996', 'fuchs2016', 'fuchs2019', 'sun2012'],
        },
      ],
      timeCourse:
        'Liver glycogen peaks about 5 hours after a large glucose meal; post-exercise refilling continues over hours.',
      moderators:
        'Type of carbohydrate (fructose, sucrose or galactose with glucose about doubles the rate), preceding exercise, and how full the liver already is.',
      grade: 'B',
      gradeReason: 'Several magnetic-resonance randomised trials agree, but the fractional split is fitted.',
      status: 'proposed-fit',
      caveats:
        'Intestinal first-pass clearance of small fructose doses (about 5 g) rests mostly on mouse data (grade D).',
      referenceIds: ['taylor1996', 'fuchs2019', 'decombaz2011', 'fuchs2016', 'casey2000', 'sun2012'],
      relatedMetricIds: ['liverGlycogen'],
    },
    {
      id: '04-carbohydrate-disposal-hourly',
      title: "Where a meal's carbohydrate goes hour by hour",
      category: 'fuel',
      summary:
        "Absorbed glucose goes first to the brain and red cells. The liver stores about a fifth. Insulin then shifts the body's fuel mix towards carbohydrate and away from fat. Muscle stores most of what is left, up to its capacity. Only when both liver and muscle are nearly full and intake still exceeds the most the body can burn does any carbohydrate become fat. Even a single 479 g starch meal was stored 72% as glycogen and burned 28% over 10 hours, with no net fat synthesis.",
      howModelled:
        "Each hour the engine spreads each meal's carbohydrate over time with a gamma-shaped curve, then allocates the glucose in order: liver glycogen, oxidation, muscle glycogen, and net fat synthesis only if total glycogen is at least 95% of capacity. The share of energy burned as carbohydrate depends on glycogen level and insulin.",
      equation: `Ra_glc(t) = Σ_m C_glc,m · (t − t_m)/θ_m² · exp(−(t − t_m)/θ_m)     (gamma curve with k = 2, θ_m = t_p,m)
cap: Ra_glc ≤ 60 g/h;  Ra_glc + Ra_fru ≤ 90–105 g/h
f_C,pa = clamp( 0.45 · (G_tot/G_ref)² · (1 − 0.75·A_keto), 0.05, 0.85 )
f_C(t) = f_C,pa + (f_C,max − f_C,pa) · Ins(t)²/(Ins(t)² + EC50_ox²)
CHOox(t) = f_C(t) · EE_np(t)/4.1 [g/h];   FATox(t) = (1 − f_C(t)) · EE_np(t)/9.4 [g/h]
allocation: liver glycogen → oxidation → muscle glycogen → DNL only if G_tot ≥ 0.95·G_cap
DNL_fat = DNL_glc/3.2;   heat = 0.28 · 4.1 · DNL_glc`,
      keyNumbers: [
        {
          label: 'Single 479 g starch meal after an overnight fast (6 men, 10 h in a calorimeter)',
          value:
            '72% stored as glycogen, 28% oxidised; carbohydrate oxidised 133 g, glycogen gain 346 g at 10 h, diet-induced thermogenesis 5.9%, non-protein respiratory quotient 0.91–0.98, no net fat synthesis',
          referenceIds: ['acheson1982'],
        },
        {
          label: 'Maximum absorption',
          value: 'Glucose about 1.0–1.1 g/min (60–66 g/h); glucose plus fructose about 1.5–1.75 g/min',
          note: 'Peak exogenous glucose oxidation is about 1.1 g/min.',
          referenceIds: ['fuchs2019'],
        },
        {
          label: 'Baseline share of energy burned as carbohydrate after absorption',
          value:
            'f_C,pa = 0.45 (0.35–0.55), from a fasting non-protein respiratory quotient of 0.83–0.84 on mixed diets; f_C,max = 0.95 (0.9–1.0)',
          referenceIds: ['magnusson1992', 'schwarz1995', 'acheson1982'],
        },
        {
          label: 'Insulin at which fatty-acid oxidation is half suppressed',
          value: 'EC50_ox = 54 µU/mL (324 pM, ±60 pM)',
          referenceIds: ['campbell1992'],
        },
        {
          label: 'Brain and obligatory glucose use in the fed state',
          value: '110–145 g/d (4.6–6 g/h)',
          referenceIds: ['owen1967'],
        },
        {
          label: 'Energy per gram of carbohydrate oxidised',
          value: '4.1–4.2 kcal',
          note: 'A standard value, not confirmed against a primary source.',
        },
        {
          label: 'Consistency check against the 479 g meal',
          value:
            'Non-protein expenditure about 750 kcal in 10 h × f_C about 0.7 gives about 128 g oxidised (observed 133 g); storage about 40–60 g in liver plus 280–300 g in muscle; net fat synthesis 0',
          referenceIds: ['acheson1982'],
        },
      ],
      timeCourse:
        'Time step of 1 hour, with 10–15 minute sub-steps for glucose and insulin curves. Surplus that cannot be stored or burned is carried to the next hour, raising blood glucose.',
      moderators:
        'Glycogen fullness, insulin, keto-adaptation, energy expenditure, fibre, and the type of carbohydrate.',
      grade: 'C',
      gradeReason:
        'The overall partition is grade B (tracer, calorimetry and magnetic-resonance data), but the individual coefficients are grade C.',
      status: 'proposed-fit',
      caveats:
        'The algorithm is proposed by Vitals; every coefficient comes from the tables in the glycogen entries.',
      referenceIds: ['acheson1982', 'fuchs2019', 'magnusson1992', 'schwarz1995', 'campbell1992', 'owen1967'],
      relatedMetricIds: ['glycogenTotal', 'choOxidation', 'dnl'],
    },
    {
      id: '04-daily-carbohydrate-balance',
      title: 'Daily carbohydrate balance: oxidation follows intake',
      category: 'fuel',
      summary:
        'Glycogen stores are small compared with what people eat, so carbohydrate burning tracks carbohydrate intake within about 1–3 days, working through glycogen level and insulin. Fat burning has no such direct drive: it is simply the energy left after carbohydrate and protein, so fat balance absorbs the error. This fast adjustment is why a change in carbohydrate intake shows up in fat burning within days.',
      howModelled:
        'For the daily fast mode, carbohydrate oxidation rises with the square of total glycogen (a Hall-type law), capped by energy needs and lowered by keto-adaptation. Fat burning is what is left after carbohydrate and protein. Glycogen settles at a level that scales with the square root of carbohydrate intake.',
      equation: `dG_tot/dt = CI_d + GNG_gly − C_ox,rest − C_ox,ex − DNL_glc      [g/d]
C_ox,rest = min( k_G · G_tot² · (1 − 0.75·A_keto), (TEE − EE_ex)/4.1 ),   k_G = CI_hab/G_ref²
GNG_gly = 0.10 × (fat oxidised, g/d)
FATox_d = TEE − 4.1·C_ox − 4.7·P_ox (− alcohol)
steady state: G_ss = G_ref · sqrt(CI/CI_hab);   linearised time constant τ = 1/(2·k_G·G_ss)`,
      keyNumbers: [
        {
          label: 'Day 7 of a high-carbohydrate diet vs a high-fat diet',
          value:
            'Carbohydrate oxidation vs intake had a slope of 0.99; fat oxidation vs intake a slope of 0.50 (lean people only; none in obese people)',
          referenceIds: ['thomas1992'],
        },
        {
          label: 'Steady-state glycogen for carbohydrate switches',
          value:
            'From about 350 to about 150 g/d (about 45% to 20% of energy; gram values assumed): −35%. Observed −18% in muscle after only 3 days at 20% of energy. For about 525 g/d (70%): +22% (observed +22%)',
          referenceIds: ['tarry2025', 'areta2018'],
        },
        {
          label: 'Time constant and fat balance after a carbohydrate cut',
          value:
            'For G_ref 500 g and carbohydrate 330 → 150 g/d: G_ss 337 g, τ about 1.1 d. Predicted daily fat balance +1.5, +0.9, +0.5 MJ on days 1–3 vs observed +1.06, +0.75, +0.55 MJ/d, with a new balance by day 7',
          note: 'Lean adults in energy balance in a chamber; the diet composition came from a companion study (55% → 25% of energy from carbohydrate).',
          referenceIds: ['schrauwen1997a'],
        },
        {
          label: 'Depletion then massive overfeeding',
          value:
            'Model carbohydrate oxidation at G = 250 g: 0.0012 × 250² = 75 g/d (observed 74 g/d on day 3 of low carbohydrate). Observed on day 1 of overfeeding: oxidation 398 g/d, storage 339 g/d; saturation after about 4 days at +770 g. G_ss at 1000 g/d intake about 913 g',
          referenceIds: ['acheson1988'],
        },
        {
          label: 'Very low carbohydrate (20 g/d)',
          value:
            'Not adapted: G_ss about 170 g (about 34% of normal; Bergström 30–36%), τ about 2.4 d. Keto-adapted (A_keto = 1): about 340 g, or 70% of normal',
          referenceIds: ['bergstrom1967', 'volek2016'],
        },
        {
          label: 'Activity and fat oxidation on a switch to high fat',
          value:
            'Glycogen-lowering exercise made fat oxidation match a new high-fat intake at once (within a 36 h chamber stay); physical activity also speeds the fall in respiratory quotient',
          referenceIds: ['schrauwen1997b', 'smith2000'],
        },
        {
          label: 'Ward study, 19 adults with obesity, −30% energy by cutting carbohydrate vs fat',
          value:
            'Cutting carbohydrate raised net fat oxidation by 463 ± 63 kcal/d and lowered carbohydrate oxidation by 595 ± 57 kcal/d by day 6; cutting fat changed fat oxidation only on day 1 (−96 kcal/d), with carbohydrate oxidation +147 kcal/d on day 1 and no sustained change in respiratory quotient',
          referenceIds: ['hall2015'],
        },
        {
          label: 'Parameters',
          value:
            'G_ref = initial total glycogen (about 500 g for a 75 kg man, ±30%); k_G about 0.0012 per d per g; keto-adaptation reduction 0.75 (0.6–0.9); oxidation time constant 1–3 d',
          referenceIds: ['flatt1995', 'flatt1988', 'hill1991', 'hall2011a', 'hall2010a'],
        },
      ],
      timeCourse:
        'Carbohydrate oxidation matches intake within about 1–3 days; fat balance returns to zero after about a week.',
      moderators:
        'Habitual carbohydrate intake, keto-adaptation, physical activity, and obesity (obese subjects did not match fat oxidation to fat intake over 7 days, so the time constant may be longer).',
      grade: 'C',
      gradeReason:
        'The qualitative law is well supported by several ward and chamber studies (grade A−), but the quadratic form and its parameters are grade B/C.',
      status: 'proposed-fit',
      caveats:
        'The exact published Hall form of the quadratic glycogen law was not verified here, and a linear or Hill-type law with keto-adaptation might fit as well. A convention is needed for booking glucose made from amino acids, so that it is not counted twice.',
      referenceIds: [
        'thomas1992',
        'tarry2025',
        'areta2018',
        'schrauwen1997a',
        'schrauwen1997b',
        'smith2000',
        'acheson1988',
        'bergstrom1967',
        'volek2016',
        'hall2015',
        'flatt1995',
        'flatt1988',
        'hill1991',
        'hall2011a',
        'hall2010a',
      ],
      relatedMetricIds: [],
    },
    {
      id: '04-respiratory-quotient',
      title: 'Respiratory quotient: reading fuel use from breath',
      category: 'energy',
      summary:
        'The respiratory quotient (RQ) is the ratio of carbon dioxide breathed out to oxygen breathed in, and it shows which fuels are being burned. At energy and macronutrient balance, the 24-hour RQ equals the food quotient of what is eaten. After a carbohydrate cut, RQ drifts down to the new food quotient as glycogen falls. A non-protein RQ above 1.0 means net fat is being made from carbohydrate.',
      howModelled:
        'The engine reports RQ as a derived output and uses it to check the sign of fat balance. Oxygen use and carbon dioxide output are built from the grams of carbohydrate, fat and protein burned, using standard per-gram factors.',
      equation: `Frayn (1983):  CHO_ox (g/min) = 4.55·VCO2 − 3.21·VO2 − 2.87·n;   FAT_ox (g/min) = 1.67·VO2 − 1.67·VCO2 − 1.92·n
               (VO2, VCO2 in L/min; n = urinary nitrogen in g/min)
VO2 = 0.829·C + 2.019·F + 0.966·P;   VCO2 = 0.829·C + 1.427·F + 0.781·P      (L; grams oxidised)
RQ_24h = VCO2/VO2;   FQ = same formula applied to intake;   NPRQ > 1.0 ⇔ net de novo lipogenesis`,
      keyNumbers: [
        {
          label: 'Fasting non-protein RQ after 5-day diets',
          value: '−50% carbohydrate 0.77; −25% 0.80; eucaloric 0.84; +25% 0.91; +50% 0.95',
          referenceIds: ['schwarz1995'],
        },
        {
          label: 'Isocaloric very-low-carbohydrate diet (often called ketogenic)',
          value: 'RQ −0.111 ± 0.003',
          referenceIds: ['hall2016'],
        },
        {
          label: 'Carbohydrate overfeeding with saturated stores',
          value: '24-hour non-protein RQ 1.15',
          referenceIds: ['acheson1988'],
        },
      ],
      timeCourse: 'RQ follows the changes in glycogen and fuel use described in the daily balance entry.',
      moderators: 'Macronutrient mix, glycogen level, energy balance and net fat synthesis.',
      grade: 'A',
      gradeReason: 'Textbook indirect-calorimetry theory that has been validated in chamber studies.',
      status: 'established',
      caveats:
        'The Frayn coefficients were quoted as widely used but not verified against the full text, and the per-gram factors are unverified here.',
      referenceIds: ['frayn1983', 'livesey1988', 'flatt1988', 'schwarz1995', 'hall2016', 'acheson1988'],
      relatedMetricIds: [],
    },
    {
      id: '04-de-novo-lipogenesis',
      title: 'Turning carbohydrate into fat (de novo lipogenesis)',
      category: 'fuel',
      summary:
        'De novo lipogenesis (DNL) is the making of fat from carbohydrate. In normal eating it is small, at most 5–10 g of fat a day, and it becomes large only when carbohydrate intake exceeds total energy expenditure and glycogen is full. Surplus carbohydrate mostly adds to body fat by sparing fat burning, not by conversion. In the liver, the fraction of new fat in blood triglyceride can rise a lot on sugar-rich diets without changing body fat by itself.',
      howModelled:
        'Net DNL is the carbohydrate beyond what can be burned or stored as glycogen, converted at about 3.2 g of carbohydrate per g of fat, with about 28% of the energy lost as heat. Separately, a liver fractional-DNL biomarker rises with carbohydrate share, energy surplus, sugar share and insulin resistance, but does not change fat mass.',
      equation: `DNL_fat [g/d] = DNL_glc/3.2        (475 g carbohydrate gave about 150 g lipid, i.e. 3.17 g/g)
heat cost of DNL = 28% of the carbohydrate energy
fDNL_fast [%] = 3.7 · exp(0.416·(CHO%E − 45)/10) · (1 + 1.5·max(0, EB%)/50) · m_sugar · m_IR
m_sugar = 0.5 + 2.0·(free-sugar share of carbohydrate);   m_IR = 1 + 2.5·max(0, 1 − S_hep);   cap 50%
absolute hepatic DNL [g/d] ≈ fDNL/100 · 28 g/d of VLDL fatty-acid output   (about 1–10 g/d)`,
      keyNumbers: [
        {
          label: '5-day diets (fasting, with fed values in brackets)',
          value:
            '−50% carbohydrate about 0.1%; −25% about 1.0%; +25% 10.6% (23.2%); +50% 20.1% (30.4%). Absolute hepatic DNL 3.3 ± 0.8 and 3.4 ± 0.4 g/d at +50% carbohydrate; 2.8 g glucose per g fatty acid',
          referenceIds: ['schwarz1995'],
        },
        {
          label: 'High-fat low-carbohydrate vs low-fat high-carbohydrate, 5 days, isoenergetic',
          value:
            'High fat: 1.6 ± 0.5% (lean), 2.3 ± 0.3% (obese, normal insulin), 8.5 ± 0.7% (obese, high insulin). Low fat: 13 ± 5.1% (lean), 12.8 ± 1.4% (obese, high insulin)',
          referenceIds: ['schwarz2003'],
        },
        {
          label: 'Liquid formula, 10% fat and 75% glucose polymers, 25 days',
          value:
            'Newly made fatty acids were 44 ± 10% of VLDL triglyceride; switching to solid food with 75% starch, sugar and fibre took it from 30–54% to 0–1%, but it stayed high with 75% sugar',
          referenceIds: ['hudgins1996', 'hudgins1998'],
        },
        {
          label: '+50% energy as sucrose or glucose for 96 h',
          value:
            'DNL 2–3 times control; VLDL DNL from 2 g/d to at most 10 g/d; fat balance about +275 g over 96 h; sucrose the same as glucose',
          referenceIds: ['mcdevitt2001'],
        },
        {
          label: '4 days at 175% of energy, 71% carbohydrate',
          value:
            'Net DNL after a 3.25 g/kg fat-free-mass glucose load: 35 → 156 mg/kg per 5 h (lean); 49 → 64 (overweight)',
          referenceIds: ['minehira2004'],
        },
        {
          label: 'Carbohydrate overfeeding at about 2.5 × expenditure',
          value:
            'RER 0.99 on day 1 and 1.15 on day 4; net fat synthesis on day 4 about 2.2 g/kg/d; hepatic secretion of new fatty acids rose 35-fold but was about 2% of the total',
          note: 'The abstract gave the units per minute, which looks typographic, so per day is assumed.',
          referenceIds: ['aarsland1997'],
        },
        {
          label: '7 days of massive carbohydrate overfeeding after depletion',
          value:
            'Net DNL about 150 g lipid/d from about 475 g carbohydrate/d once saturated; about 580 g in total over 6 days; 142 g/d in the last 3 days; 24-hour non-protein RQ 1.15',
          referenceIds: ['acheson1988'],
        },
        {
          label: 'Simple sugars and fructose over weeks',
          value:
            '+1000 kcal/d of simple sugars for 3 weeks: DNL +98%, liver fat +33% (saturated fat +55%, unsaturated +15%). 25% of energy as fructose vs glucose for 10 weeks: hepatic DNL and 23-hour triglyceride area rose only with fructose',
          referenceIds: ['luukkonen2018', 'stanhope2009'],
        },
        {
          label: 'Replacing fat with carbohydrate at equal energy',
          value:
            'Does not induce liver DNL to any substantial degree; surplus carbohydrate is mainly handled by sparing fat burning, not by converting it to fat',
          referenceIds: ['hellerstein1999', 'schwarz1995'],
        },
        {
          label: 'Fit anchors for the fractional biomarker',
          value:
            '30% carbohydrate about 2%; 75% about 13%; +25% carbohydrate and +28% energy 10.6% (fit 10.6); +50% and +67% energy 20.1% (fit 19.8)',
          referenceIds: ['schwarz2003', 'schwarz1995'],
        },
        {
          label: 'Heat cost',
          value:
            'About 28% of the carbohydrate energy (derived: 475 g × 4.1 kcal = 1950 kcal; 150 g × 9.4 = 1410 kcal); the theoretical 20–25% often cited is unverified',
          note: 'The heat of a 479 g carbohydrate meal was 5.9%; the glycogen storage cost is about 5–7% of energy (unverified).',
          referenceIds: ['acheson1988', 'acheson1982'],
        },
      ],
      timeCourse:
        'The liver fractional DNL responds within days (5-day diets change it more than 10-fold) and reverses within days when sugar is replaced by starch. Net DNL starts on day 2 of carbohydrate overfeeding after depletion.',
      moderators:
        'Insulin resistance and hyperinsulinaemia raise fractional DNL; overweight subjects showed less whole-body DNL and more glycogen synthesis after overfeeding; fructose is more lipogenic than glucose at 25% of energy, but sucrose equals glucose at +50% overfeeding.',
      grade: 'C',
      gradeReason:
        'The statement that DNL is minor unless carbohydrate exceeds expenditure and glycogen is saturated is well supported (grade A−), but the fractional-DNL fitting function is grade C.',
      status: 'proposed-fit',
      caveats:
        'The fractional DNL function is proposed by Vitals. The sugar-versus-starch multiplier ranges 0.1–3.4 across studies, a 30-fold spread.',
      referenceIds: [
        'schwarz1995',
        'schwarz2003',
        'hudgins1996',
        'hudgins1998',
        'mcdevitt2001',
        'minehira2004',
        'aarsland1997',
        'acheson1988',
        'acheson1982',
        'luukkonen2018',
        'stanhope2009',
        'hellerstein1999',
      ],
      relatedMetricIds: ['dnl', 'tdee'],
    },
    {
      id: '04-insulin-lipolysis-fat-oxidation',
      title: 'How insulin switches off fat release and fat burning after a meal',
      category: 'hormones',
      summary:
        'Fat cells release fatty acids (lipolysis), and this is extremely sensitive to insulin: half of it is suppressed at about fasting insulin levels. Suppressing fat burning needs three to four times more insulin. After a meal, blood fatty acids fall for several hours and then rebound. So carbohydrate lowers fat burning acutely, but over a day fat balance is set by total energy and carbohydrate balance.',
      howModelled:
        'Lipolysis is a steep curve of insulin, with a half-suppression point that rises when fat tissue is insulin resistant. Fat-burning suppression uses a higher insulin threshold. The number of hours per meal that lipolysis stays suppressed comes from the simulated insulin curve, or from a rough formula if insulin is not simulated.',
      equation: `λ(t) = Ins(t)^h/(Ins(t)^h + EC50_lip^h)          fraction of lipolysis suppressed
Lip(t) = Lip_max · (1 − λ(t))
EC50_lip = 10 µU/mL · S_adip^(−1)   (about 60 pM; literature 2–18 µU/mL);   h = 2 (unverified)
fatty-acid oxidation suppression uses EC50_ox = 54 µU/mL (324 pM)
D_supp = time with λ > 0.8;   heuristic: D_supp ≈ 0.076 · C^0.79 h   (C = digestible carbohydrate in g)`,
      keyNumbers: [
        {
          label: 'Insulin needed to half-suppress lipolysis (pancreatic clamp)',
          value:
            'About 12 pM free insulin (under 2 µU/mL); palmitate flux 2.5 (insulin withdrawal) → 0.17 µmol/kg/min at maximum suppression (−93%)',
          referenceIds: ['jensen1989'],
        },
        {
          label: 'Half-maximal insulin for different processes',
          value:
            'Lipolysis 106 ± 26, fatty-acid appearance 91 ± 20, re-esterification 80 ± 16, fatty-acid oxidation 324 ± 60 pM',
          note: 'A second study found systemic, adipose and muscle lipolysis at 51, 68 and 44 pM. The threshold for lipolysis correlates with triglyceride and insulin sensitivity.',
          referenceIds: ['campbell1992', 'stumvoll2000', 'jensen2007'],
        },
        {
          label: 'Liquid meal with 139 g glucose, 17 g fat and 29 g protein',
          value:
            'Fatty acids 449 → 137 µmol/L at 90 min, suppressed for more than 3 h, rebounding to 932 at 540 min',
          referenceIds: ['taylor1996'],
        },
        {
          label: '479 g starch meal',
          value: 'Insulin peak 139 µU/mL at 90 min and 22 µU/mL at 10 h; only 17 g of fat oxidised in 10 h',
          referenceIds: ['acheson1982'],
        },
        {
          label: 'Duration of suppression (emergent from the insulin curve)',
          value:
            '50 g carbohydrate about 3 h; 139 g about 4 h (observed over 3 h); 479 g about 10 h (observed at least 10 h of low fat oxidation)',
          note: 'The rough formula gives 25 g → 1.0 h, 50 g → 1.7 h, 100 g → 2.9 h, which is shorter for 50 g than the emergent 3 h. Protein-only meals give shorter windows.',
          referenceIds: ['taylor1996', 'acheson1982'],
        },
        {
          label: 'Modifiers',
          value:
            'Adipose insulin resistance shifts the half-suppression point to the right; a 4-week very-low-carbohydrate diet reduced insulin-mediated antilipolysis regardless of test meal; 5% weight loss gave the maximal improvement in adipose insulin sensitivity',
          referenceIds: ['jensen2007', 'rosenbaum2019', 'magkos2016'],
        },
      ],
      timeCourse:
        'Fatty acids fall within an hour of a large carbohydrate meal, stay suppressed for hours (longer for bigger meals), then rebound above baseline.',
      moderators:
        'Adipose insulin sensitivity, meal size and carbohydrate content, protein content, and keto-adaptation.',
      grade: 'C',
      gradeReason:
        'The dose-response is well measured in clamp studies (grade A−), but the meal-level durations are proposed fits (grade C).',
      status: 'proposed-fit',
      caveats:
        'The steepness constant h = 2 is unverified. The two duration estimates for a 50 g meal disagree (about 3 h vs 1.7 h). Mixed meals with fat involve chylomicron and adipose buffering effects that are simplified to insulin control of lipolysis.',
      referenceIds: [
        'jensen1989',
        'campbell1992',
        'stumvoll2000',
        'jensen2007',
        'taylor1996',
        'acheson1982',
        'rosenbaum2019',
        'magkos2016',
        'frayn2002',
      ],
      relatedMetricIds: ['fatOxidation', 'choOxidation', 'bhb'],
    },
    {
      id: '04-carbohydrate-insulin-model-verdict',
      title: 'Does insulin, not calories, decide body fat? The verdict',
      category: 'hormones',
      summary:
        'The carbohydrate-insulin model says that high-carbohydrate diets raise insulin, which pushes fuel into fat tissue and so drives hunger and lowers expenditure, meaning low-carbohydrate diets should raise expenditure and fat loss at equal calories. The energy-balance view says that at equal calories and protein, the carbohydrate-to-fat ratio has negligible effects on body fat. Controlled feeding studies favour the second view, with a slight tilt towards lower-fat diets.',
      howModelled:
        'Vitals has no insulin-driven partitioning term acting on fat mass: fat mass follows energy balance, with protein and lean partitioning from other topics. Diet differences show up through glycogen, water and sodium changes on the scale, through free-choice intake effects, and through the small expenditure effects in the energy topic. A labelled sensitivity option adds +50 kcal/d of expenditure per 10% of energy less carbohydrate and is marked as contested.',
      keyNumbers: [
        {
          label:
            'Ward study, 19 adults with obesity, 6 days each, −30% energy by cutting carbohydrate (about 140 g/d left) vs fat (8% fat), protein equal',
          value:
            'Fat loss 53 ± 6 vs 89 ± 6 g/d (cumulative 245 vs 463 g); insulin secretion −22.3 ± 7.0% only with the carbohydrate cut',
          note: 'The model predicted about 3 kg more fat loss over 6 months with the fat cut, and comparable fat loss with very low carbohydrate.',
          referenceIds: ['hall2015'],
        },
        {
          label:
            '17 men, 4 weeks at 50% carbohydrate then 4 weeks of an isocaloric very-low-carbohydrate diet (5%, often called ketogenic), ward',
          value:
            'Chamber expenditure +57 ± 13 kcal/d, sleeping +89 ± 14, doubly labelled water +151 ± 63; RQ −0.111; body-fat loss slowed; protein use and fat-free-mass loss increased',
          referenceIds: ['hall2016'],
        },
        {
          label: 'Reanalysis of the doubly labelled water method',
          value:
            'The excess of 209 kcal/d disappeared when RQ was adjusted for energy imbalance (+46 ± 65 kcal/d after removing outliers)',
          referenceIds: ['hall2019a'],
        },
        {
          label: 'Meta-analysis of 32 controlled feeding studies, protein equal',
          value: 'Expenditure +26 kcal/d and fat loss +16 g/d favouring lower-fat diets',
          referenceIds: ['hall2017'],
        },
        {
          label: 'Weight-loss maintenance trial (164 adults, 20 weeks, 20/40/60% carbohydrate)',
          value:
            'Total expenditure +52 kcal/d per 10% lower carbohydrate; low vs high carbohydrate +209 (91–326) kcal/d',
          referenceIds: ['ebbeling2018'],
        },
        {
          label: '21 adults, 4-week crossovers after weight loss',
          value:
            'Resting expenditure decline −205 (low fat) vs −138 (very low carbohydrate) kcal/d; total expenditure −423 vs −97',
          referenceIds: ['ebbeling2012'],
        },
        {
          label:
            'Ad libitum trial, 20 adults, 2 weeks each: plant-based low fat (75% carbohydrate) vs animal-based very-low-carbohydrate (10%, often called ketogenic)',
          value:
            'The low-fat diet led to 689 ± 73 kcal/d less intake (544 in week 2) despite higher glucose and insulin',
          referenceIds: ['hall2021'],
        },
        {
          label: 'Best estimate for the engine',
          value:
            'Isocaloric swap of carbohydrate for fat changes body-fat balance by 0 ± 20 g/d; the pooled sign slightly favours lower fat (+16 g/d fat loss, +26 kcal/d expenditure), at most about 0.5–3 kg over 6 months',
          note: 'Expenditure differences from doubly labelled water (+150–210 kcal/d) are sensitive to method and remain contested. The carbohydrate-insulin position is set out by its proponents.',
          referenceIds: ['hall2017', 'hall2019a', 'ebbeling2018', 'ludwig2021b', 'ludwig2022'],
        },
      ],
      timeCourse:
        'The predictions converge when carbohydrate is very low. There are no ward data beyond 6 months.',
      moderators: 'Energy balance, protein intake, and the method used to measure expenditure.',
      grade: 'A',
      gradeReason:
        'That insulin does not by itself determine fat balance at fixed energy is supported by ward studies and a meta-analysis; any residual expenditure effect is only grade C and is off by default.',
      status: 'contested',
      caveats:
        'Whether a residual expenditure advantage exists for low carbohydrate remains contested, and there are no controlled-feeding data beyond 6 months.',
      referenceIds: [
        'hall2015',
        'hall2016',
        'hall2019a',
        'hall2017',
        'ebbeling2018',
        'ebbeling2012',
        'hall2021',
        'ludwig2021b',
        'ludwig2022',
      ],
      relatedMetricIds: [],
    },
    {
      id: '04-glucose-insulin-response-curves',
      title: 'Glucose and insulin response to a meal',
      category: 'hormones',
      summary:
        'After a meal, blood glucose rises mainly according to how much carbohydrate there is and what type it is (its glycaemic index). These two factors explain about 90% of the variation in the average response to mixed meals in lean healthy people. The response rises less than in proportion to the dose, while insulin rises almost in proportion. Protein, fat, viscous fibre, meal order, vinegar and time of day modify the response, and people differ widely in their response to identical meals.',
      howModelled:
        'Each meal adds a smooth glucose peak and a smooth insulin peak on top of fasting levels, scaled by glycaemic load with saturation, reduced by protein, fat, viscous fibre, eating carbohydrate last and vinegar, and adjusted by insulin sensitivity and carbohydrate tolerance. Glucose variability outputs are computed from the 24-hour trace.',
      equation: `Glc(t) = Glc_f + M_tol · M_circ(t_m) · Σ_m ΔG_m(t);   Glc_f = 5.0 · S_hep^(−0.1)
ΔG_m(t) = A_m · x · exp(1 − x),   x = (t − t_m)/t_p,m
A_m = A_50 · [L_eff·(K_L + 50)]/[50·(K_L + L_eff)] · M_PF · M_fib · M_order · M_vin · S_mus^(−0.5);   cap 4.5 mmol/L
M_PF = 1 − 0.006·min(P,50) − 0.0025·min(F,30);   M_fib = 1 − 0.035·min(βglucan_viscous_g, 12);   M_order = 0.70;   M_vin = 0.80
Ins(t) = Ins_f + M_ins · Σ_m ΔI_m(t);   Ins_f = 7 · S_hep^(−0.9);   ΔI_m(t) = B_m · y · exp(1 − y),   y = (t − t_m)/(t_p,m + 0.25 h)
B_m = [B_max · L_I/(L_I + K_I) + b_P·P_m] · S_mus^(−0.7);   L_I = Σ (0.5 + 0.5·GI_i/100)·C_i`,
      keyNumbers: [
        {
          label: 'Dose-response of glucose and insulin',
          value:
            'Glucose area rose only 68% from 25 to 50 g and 38% from 50 to 100 g of carbohydrate, while insulin rose nearly linearly',
          referenceIds: ['lee1998'],
        },
        {
          label: 'What explains the response',
          value:
            'Amount and type of carbohydrate explain about 90% of the variance in mean responses to mixed meals in lean healthy people',
          referenceIds: ['wolever1996'],
        },
        {
          label: 'Glycaemic load',
          value:
            'Glycaemic load (glycaemic index × grams per 100) predicts responses stepwise across food doses; glycaemic index values come from published tables',
          referenceIds: ['brandmiller2003', 'atkinson2021'],
        },
        {
          label: 'Protein and fat',
          value:
            'They reduce the glycaemic response linearly over 0–30 g, protein about 2–3 times as much as fat per gram. In solid meals, adding 12.5–25 g of protein or up to 22 g of fat did not significantly change the response to 50 g of white-bread carbohydrate, whereas 50 g of protein did',
          referenceIds: ['moghaddam2006', 'meng2017'],
        },
        {
          label: 'Other modifiers',
          value:
            'Viscous β-glucan (about 4 g per 30–80 g of available carbohydrate) lowers glucose area by about 27 mmol·min/L. Carbohydrate last in type 2 diabetes: peaks −29% (30 min) and −37% (60 min), area −73%. Vinegar: glucose area standardised difference −0.60 (95% CI −1.08 to −0.11), insulin −1.30. Lower excursions at breakfast than lunch or dinner',
          referenceIds: ['tosh2013', 'shukla2015', 'shishehbor2017', 'saad2012'],
        },
        {
          label: 'Fitted constants (glucose)',
          value:
            'A_50 = 2.8 mmol/L (2.0–3.5, unverified typical value); K_L = 80 g (60–110); protein coefficient 0.006 per g; fat coefficient 0.0025 per g; peak times t_p 0.50 h (liquid glucose), 0.75 h (high-GI refined solid), 1.0 h (mixed meal), 1.25–1.5 h (low-GI, legumes, over 30 g fat, over 150 g carbohydrate)',
          note: 'The size of the carbohydrate-last (−30%), vinegar (−20%) and time-of-day (1.15 at lunch, dinner and late) effects in healthy people are unverified conversions from the studies above.',
          referenceIds: ['lee1998', 'moghaddam2006', 'saad2012'],
        },
        {
          label: 'Fitted constants (insulin)',
          value:
            'B_max = 250 µU/mL (±40%): a 75 g load gives about 50 µU/mL (unverified typical peak) and 479 g gives 154 (observed 139); K_I = 300 g (150–500); b_P = 0.6 µU/mL per g protein (0.3–1.0, unverified); fasting insulin of about 5–8 µU/mL in lean people (unverified)',
          note: 'Glucose and insulin scores correlate (r = 0.70); protein-rich foods and fat-plus-refined-carbohydrate foods give disproportionately high insulin. In type 2 diabetes insulin was 752 vs 372 pmol/L at 300 min after mixed meals.',
          referenceIds: ['acheson1982', 'holt1997', 'carey2003'],
        },
        {
          label: 'Healthy continuous-glucose-monitor reference',
          value:
            'Mean 98–99 mg/dL (5.4–5.5 mmol/L; 104 if over 60); time in 70–140 mg/dL 96% (IQR 93–98); CV 17 ± 3%; above 140 mg/dL 2.1% (about 30 min/d); below 70 mg/dL 1.1% (about 15 min/d)',
          note: 'A deterministic model underestimates variability, so a noise term (SD about 0.3 mmol/L, unverified) is added or only relative changes are reported. Some people with normal glucose have high-variability patterns.',
          referenceIds: ['shah2019', 'hall2018'],
        },
        {
          label: 'Checks',
          value:
            'A 139 g glucose, 29 g protein, 17 g fat liquid meal: model 3.6 mmol/L rise vs observed 5.2 → 8.6 (a 3.4 rise). A 479 g starch meal peaked at only 6.6 mmol/L at 90 min and stayed near 5.5 mmol/L for 8 h, so the 4.5 mmol/L cap still over-predicts',
          note: 'Meals of over 150 g of carbohydrate use a 1.5 h peak time with an extended tail. OGTT insulin area in trained middle-aged adults was about 2,240–3,729 µU·min/mL across days after exercise.',
          referenceIds: ['taylor1996', 'acheson1982', 'king1995'],
        },
        {
          label: 'Person-to-person variation',
          value:
            'Large for identical meals; gut microbiome and personal factors predict part of it, and individual prediction is poor (grade D)',
          referenceIds: ['zeevi2015'],
        },
      ],
      timeCourse:
        'Glucose peaks about 0.5–1.5 hours after a meal depending on type and size and returns to baseline in about 4–5 peak times; about 75% of the excursion falls within 2 hours.',
      moderators:
        'Carbohydrate amount and glycaemic index, protein and fat in the meal, viscous fibre, order of eating, time of day, insulin sensitivity, and carbohydrate tolerance after low-carbohydrate eating.',
      grade: 'C',
      gradeReason:
        'The determinants are grade B (glycaemic-index validation, dose-response and meta-analyses), but the exact curve shape and modifier sizes in healthy people are grade C.',
      status: 'proposed-fit',
      caveats:
        'The empirical curve is not a validated physiological model; the upgrade path is a published meal simulation model of the glucose–insulin system. Circadian and personal variability magnitudes are unverified.',
      referenceIds: [
        'lee1998',
        'wolever1996',
        'brandmiller2003',
        'atkinson2021',
        'moghaddam2006',
        'meng2017',
        'tosh2013',
        'shukla2015',
        'shishehbor2017',
        'saad2012',
        'acheson1982',
        'holt1997',
        'carey2003',
        'shah2019',
        'hall2018',
        'taylor1996',
        'king1995',
        'zeevi2015',
        'dallaman2007a',
      ],
      relatedMetricIds: ['glucose', 'insulin', 'fastingGlucose'],
    },
    {
      id: '04-insulin-sensitivity-state',
      title: 'Insulin sensitivity as a changing state',
      category: 'hormones',
      summary:
        'Insulin sensitivity has a liver part (how well insulin switches off glucose output, which sets fasting glucose) and a muscle part (how well insulin drives glucose into muscle, which sets post-meal tolerance). They change at different speeds. Energy deficit improves the liver part within 2 days to a week, weight loss improves the muscle part, a hard session raises insulin action for about 2 days, and inactivity, short sleep, saturated fat and sugar lower it.',
      howModelled:
        'Each part relaxes towards a target set by several multiplicative factors: liver fat, recent energy balance, sleep, saturated fat and sugar for the liver; fat mass, steps, fitness, recent exercise, sleep and saturated fat for muscle. The time constants are about 2 days (liver) and 3 days (muscle).',
      equation: `dS_hep/dt = (S_hep* − S_hep)/τ_hep;   dS_mus/dt = (S_mus* − S_mus)/τ_mus     (τ_hep = 2 d, τ_mus = 3 d)
S_hep* = F_LF · F_EBh · F_sleep · F_SFA · F_sugar
S_mus* = F_adip · F_steps · F_fit · F_exAcute · F_sleep · F_SFA
S_I = S_hep^0.4 · S_mus^0.6
HOMA-IR = Glc_f[mmol/L] · Ins_f[µU/mL]/22.5;   Matsuda ISI = 10000/sqrt(G0·I0·Gmean·Imean)`,
      keyNumbers: [
        {
          label: 'Energy deficit and the liver (48 hours)',
          value:
            '48 h at −1000 kcal/d lowered liver fat 30% (low carbohydrate) vs 9% (high carbohydrate) and basal glucose production 23% vs 7%, with no change in muscle glucose uptake',
          referenceIds: ['kirk2009'],
        },
        {
          label: '600 kcal/d in type 2 diabetes',
          value:
            'Hepatic insulin suppression of glucose output normalised within 1 week (43 → 74%; controls 68%) and fasting glucose (9.2 → 5.9 mmol/L)',
          referenceIds: ['lim2011'],
        },
        {
          label: 'About 8 kg of weight loss',
          value:
            'Intrahepatic lipid −81% and hepatic suppression normalised (29 → 99%) without change in peripheral uptake',
          referenceIds: ['petersen2005'],
        },
        {
          label: 'Weight loss and muscle sensitivity',
          value:
            '+25% at 5% weight loss, about 2 times at 11–16%; hepatic and adipose improvements plateau after 5%',
          referenceIds: ['magkos2016'],
        },
        {
          label: 'Acute exercise',
          value:
            'Insulin half-effect point 52 → 40–43 µU/mL; the effect persists at 48 h and is gone by 5 days; OGTT glucose area lowest 1–3 days after training and risen again by days 5–7 of inactivity',
          referenceIds: ['mikines1988', 'king1995'],
        },
        {
          label: 'Inactivity',
          value:
            'Cutting steps from 10,501 to 1,344 a day for 2 weeks lowered clamp glucose infusion by 17% (peripheral)',
          referenceIds: ['kroghmadsen2010'],
        },
        {
          label: 'Sleep loss',
          value:
            'One night of 4 h lowered glucose infusion rate about 25%; seven nights of 5 h lowered clamp sensitivity 11 ± 5.5% and IVGTT sensitivity 20 ± 24%',
          referenceIds: ['donga2010', 'buxton2010'],
        },
        {
          label: 'Saturated fat',
          value:
            'An isoenergetic saturated-fat-rich diet for 3 months lowered sensitivity 10% vs +2% on monounsaturated, only when total fat was under 37% of energy. +1000 kcal/d from saturated fat for 3 weeks raised HOMA-IR 23% and liver fat 55%',
          referenceIds: ['vessby2001', 'luukkonen2018'],
        },
        {
          label: 'Sugars',
          value:
            'High-fructose corn syrup at 25% of energy requirement for 2 weeks: Matsuda −8.4 ± 4.7%, predicted-M −5.9 ± 2.5%, linear dose-response. 25% of energy as fructose for 10 weeks lowered sensitivity',
          referenceIds: ['sigala2022', 'stanhope2009'],
        },
        {
          label: 'Time of day',
          value: 'Better tolerance and beta-cell responsiveness at breakfast than at lunch or dinner',
          referenceIds: ['saad2012'],
        },
        {
          label: 'Factor forms and anchors (all proposed)',
          value:
            'Liver fat: 1/(1 + 0.08·max(0, LF% − 3)), liver fat 12% → 0.58. Energy balance: deficit 1 + 0.25·min(1, −EB₃/1000), surplus 1 − 0.10·min(1, EB₃/1000). Fat mass: max(0.40, exp(−0.08·max(0, FM% − FM%_ref))) with reference 18% (men) or 28% (women), unverified: −2.6 points ⇒ +23% (observed +25%), −6.2 points ⇒ +64% (observed about +100%). Steps: 1 − 0.17·clamp((8000 − steps)/6700, 0, 1)',
          note: 'Fitness: clamp(1 + 0.01·(VO2max − 40), 0.85, 1.25), an unverified slope. Acute exercise: 1 + 0.25·E_is. Sleep: 1 − 0.06 per hour of sleep debt (up to 4), chronic 5 h/night ⇒ 0.85. Saturated fat: 1 − 0.012·max(0, SFA%E − 10). Sugar: 1 − 0.0034·sugar%E (25% of energy ⇒ −8.5%).',
          referenceIds: [
            'magkos2016',
            'kroghmadsen2010',
            'bird2016',
            'donga2010',
            'vessby2001',
            'sigala2022',
          ],
        },
        {
          label: 'Indices',
          value:
            'HOMA-IR = fasting glucose × fasting insulin / 22.5; reference HOMA at S_hep = 1 is 5.0 × 7 / 22.5 = 1.56; Matsuda index from a simulated 75 g OGTT',
          referenceIds: ['matthews1985', 'matsuda1999'],
        },
      ],
      timeCourse:
        'Liver sensitivity responds within 2 days to a week, muscle sensitivity over days to weeks; sleep effects recover in about a day, step effects over about 7 days and saturated-fat effects over about 21 days.',
      moderators:
        'Liver fat, adiposity, energy balance, sleep, steps, fitness, recent exercise, saturated fat, sugar and time of day. People with type 2 diabetes or obesity start lower.',
      grade: 'C',
      gradeReason:
        'Direction and time-scales are well supported by clamp and tracer trials (grade B), but the combined multiplicative index and its coefficients are proposed (grade C).',
      status: 'proposed-fit',
      caveats:
        'Interactions such as exercise plus energy deficit plus sleep are probably sub-additive. The fitness slope and the glycogen-depletion alternative are unverified in magnitude.',
      referenceIds: [
        'kirk2009',
        'lim2011',
        'petersen2005',
        'magkos2016',
        'mikines1988',
        'king1995',
        'kroghmadsen2010',
        'donga2010',
        'buxton2010',
        'vessby2001',
        'luukkonen2018',
        'sigala2022',
        'stanhope2009',
        'saad2012',
        'bird2016',
        'matthews1985',
        'matsuda1999',
      ],
      relatedMetricIds: ['insulinSensitivity', 'fastingGlucose'],
    },
    {
      id: '04-carbohydrate-tolerance-low-carb',
      title: 'Temporary glucose intolerance after low-carbohydrate eating',
      category: 'hormones',
      summary:
        'Days to weeks of low carbohydrate intake make muscles and the pancreas less ready for carbohydrate, so a carbohydrate challenge causes a larger glucose rise, even though fasting glucose and insulin are lower. This is an adaptive, reversible change. It partly reverses within days of eating carbohydrate again, and fully only over weeks.',
      howModelled:
        'A carbohydrate-tolerance state falls when recent carbohydrate intake is low and recovers when it is high, through a fast part (2.5-day time constant) and a slow part (14-day time constant). It scales the glucose rise after a meal up, and the insulin peak down. Fasting values are not worsened.',
      equation: `T_C* = clamp((CI_3d − 50)/100, 0, 1)                 (CI_3d = 3-day mean digestible carbohydrate, g/d)
T_C = 0.6·T_fast + 0.4·T_slow;   dT_fast/dt = (T_C* − T_fast)/τ_f,  τ_f = 2.5 d;   dT_slow/dt = (T_C* − T_slow)/τ_s,  τ_s = 14 d (range 10–25)
glucose rise multiplier M_tol = 1 + 0.6·(1 − T_C);   insulin peak multiplier M_ins = 1 − 0.2·(1 − T_C)`,
      keyNumbers: [
        {
          label:
            '3 days of low-carbohydrate, high-fat (about 69% fat) vs normal (22% fat), isoenergetic, 9 healthy men',
          value:
            'Higher glucose and glucose area in an OGTT (P = 0.024); lower first-phase insulin; higher GLP-1',
          referenceIds: ['numao2012'],
        },
        {
          label: '4 weeks of an isocaloric very-low-carbohydrate diet (5%, often called ketogenic)',
          value:
            'Higher glucose area to both test meals; fasting insulin and C-peptide lower; less insulin antilipolysis',
          referenceIds: ['rosenbaum2019'],
        },
        {
          label: '12-week free-living very-low-carbohydrate diet (often called ketogenic)',
          value:
            'Lower mean glycaemia and variability in week 1; fasting glucose −0.5 mmol/L (−0.2 to −0.8) at week 4; higher meal-test glucose area and peak at week 4, not significant at week 12; PDK4 up, GLUT4 and AMPK down',
          referenceIds: ['hengist2024'],
        },
        {
          label:
            'After a very-low-carbohydrate run-in with 15% weight loss, then 10 weeks at 57% carbohydrate',
          value:
            'Fasting, peak and 2-hour glucose kept falling from week 2 to 9; change point about 5 weeks (95% CI 3.2–7.7); slopes −0.04 to −0.10 mmol/L per week; abnormal OGTT 17 → 9 of 25',
          referenceIds: ['jansen2022'],
        },
        {
          label: 'Keto-adapted athletes and older data',
          value:
            'Athletes adapted for over 6 months had impaired glucose tolerance with lower GLUT4 and IRS1; glucose tolerance was abnormal for several weeks after 5 days under 50 g/d of carbohydrate (historical)',
          referenceIds: ['burke2021', 'jansen2022'],
        },
        {
          label: 'Fasting values',
          value: 'Not worsened: fasting glucose is 0.3 to 0.5 mmol/L lower on very low carbohydrate',
          referenceIds: ['hengist2024'],
        },
      ],
      timeCourse:
        'Tolerance drops within days and is largely restored within about 3 days for the fast part, while the slow part takes weeks: change point about 5 weeks.',
      moderators:
        'Recent carbohydrate intake and its duration; keto-adaptation length (the effect waned by 12 weeks despite continued ketosis in one study).',
      grade: 'C',
      gradeReason:
        'The direction is consistent across four randomised-type studies, but the magnitude and time constants are loosely fitted.',
      status: 'proposed-fit',
      caveats:
        'The size of the glucose multiplier is unverified (range 0.3–1.0). A glucose test within about 3 days of reintroducing carbohydrate after a period under about 100 g/d overstates intolerance, and a residual bias can last weeks. A long-term keto-adaptation offset may be needed.',
      referenceIds: ['numao2012', 'rosenbaum2019', 'hengist2024', 'jansen2022', 'burke2021'],
      relatedMetricIds: ['glucose'],
    },
    {
      id: '04-fructose-sucrose-fibre',
      title: 'Fructose, sucrose and fibre: what counts as usable carbohydrate',
      category: 'fuel',
      summary:
        'Fructose is cleared by the liver on first pass, bypassing insulin control, and gives a small glucose and insulin response. Its effects on liver fat and blood fats depend on dose and on energy balance: swapping it for other carbohydrate at equal calories shows no harm, while large amounts in energy surplus raise liver fat, triglyceride, LDL and uric acid. Only digestible carbohydrate drives blood glucose and glycogen, and fibre carries little energy.',
      howModelled:
        'Fructose to the liver follows the liver-glycogen split: 15% to glycogen, 40% released as glucose, 45% burned. It raises the fractional-DNL sugar multiplier. Warnings trigger when fructose-containing added sugars exceed 10% of energy in a surplus. Net carbohydrate excludes fibre, fermentable fibre is counted at 2 kcal/g, and only viscous soluble fibre lowers the glucose response.',
      equation: `net_CHO = total_CHO − fibre − polyols·(1 − polyol absorbed fraction)     (only if fibre is inside total carbohydrate on the label)
Energy_fibre = 2 kcal/g · fermentable fibre + 0 · insoluble fibre`,
      keyNumbers: [
        {
          label: 'Fate of fructose within 3–6 h at rest',
          value:
            '45 ± 11% oxidised; 41 ± 11% becomes glucose; about 25% lactate; at least 15% goes directly to glycogen; under 1% directly to plasma triglyceride',
          note: 'Fructose has a glycaemic index of 16 ± 4 (bread = 100) and an insulin index of 22 ± 3.',
          referenceIds: ['sun2012', 'fuchs2019', 'lee1998'],
        },
        {
          label: 'Isocaloric exchange of fructose for other carbohydrate (7 trials)',
          value: 'No effect on intrahepatocellular lipid or ALT',
          referenceIds: ['chiu2014'],
        },
        {
          label: 'Hypercaloric fructose (+21–35% energy, 104–220 g/d fructose; 6 trials)',
          value: 'Intrahepatocellular lipid standardised difference 0.45 (0.18–0.72); ALT +4.94 U/L',
          referenceIds: ['chiu2014'],
        },
        {
          label: 'Uric acid',
          value:
            'Isocaloric (21 trials in total) mean difference 0.56 µmol/L (−6.62 to 7.74), none; hypercaloric 213–219 g/d fructose: +31.0 µmol/L (15.4–46.5)',
          referenceIds: ['wang2012'],
        },
        {
          label: 'High-fructose corn syrup drinks at 0 / 10 / 17.5 / 25% of energy requirement for 2 weeks',
          value:
            'Postprandial triglyceride +0 / +22 / +25 / +37 mg/dL; fasting LDL −1.0 / +7.4 / +8.2 / +15.9 mg/dL; 24-hour uric acid −0.13 / +0.15 / +0.30 / +0.59 mg/dL; linear dose-response for liver fat (p = 0.015) and Matsuda −8.4% at 25%',
          referenceIds: ['stanhope2015', 'sigala2022'],
        },
        {
          label: '25% of energy as fructose vs glucose for 10 weeks (overweight or obese)',
          value:
            'Both gained similar weight; only fructose increased visceral fat, hepatic DNL, postprandial triglyceride and apoB/LDL, and lowered insulin sensitivity',
          referenceIds: ['stanhope2009'],
        },
        {
          label: 'Other sugar comparisons',
          value:
            'Sucrose and glucose gave the same DNL at +50% energy for 96 h; in very-low-fat diets, sugar kept fractional DNL high and starch-based solid food dropped it to 0–1%; after exercise sucrose or fructose doubled liver glycogen refilling',
          referenceIds: ['mcdevitt2001', 'hudgins1998', 'fuchs2016', 'decombaz2011'],
        },
        {
          label: 'Flag thresholds (proposed)',
          value:
            'Flag when fructose-containing added sugars exceed 10% of energy and energy balance is positive; strong flag above 25% of energy or more than 100 g/d of fructose in surplus; no liver-fat or uric-acid penalty for isocaloric exchange within about 50–100 g/d of fructose',
          referenceIds: ['stanhope2015', 'sigala2022', 'chiu2014', 'wang2012'],
        },
        {
          label: 'Fibre energy and digestibility',
          value:
            'About 2 kcal/g for fermentable fibre (a FAO convention, unverified against the primary report); fibre lowers the digestibility of fat and protein in mixed diets, so metabolisable energy falls as fibre rises. The measured energy of almonds is 4.6 ± 0.8 kcal/g vs 6.0–6.1 by standard factors, a 32% overestimate',
          referenceIds: ['baer1997', 'novotny2012'],
        },
        {
          label: 'Fibre and glucose',
          value:
            'Viscous β-glucan (4 g or more per 30–80 g of available carbohydrate) lowers glucose area by about 27 mmol·min/L, with a larger effect in intact grains. 4.8–9.6 g of oat-cereal fibre added to white bread had no significant effect',
          referenceIds: ['tosh2013', 'meng2017'],
        },
      ],
      timeCourse:
        'Blood triglyceride and LDL effects of high fructose appear within 2 weeks; the fractional DNL effect reverses within days when sugar is swapped for starch.',
      moderators:
        'Dose, whether energy balance is positive, and the food form (liquid versus solid, whole versus refined).',
      grade: 'B',
      gradeReason:
        'The distinction between isocaloric and hypercaloric intake is supported by meta-analyses (grade A−), and the dose-response and fibre effects by trials and balance studies (grade B).',
      status: 'established',
      caveats:
        'The intestinal first-pass clearance of small fructose doses rests mostly on mouse data (grade D). The fibre energy split between fermentable and insoluble fibre is unverified; fermentation details are in the fibre topic.',
      referenceIds: [
        'sun2012',
        'fuchs2019',
        'lee1998',
        'chiu2014',
        'wang2012',
        'stanhope2015',
        'sigala2022',
        'stanhope2009',
        'mcdevitt2001',
        'hudgins1998',
        'fuchs2016',
        'decombaz2011',
        'baer1997',
        'novotny2012',
        'tosh2013',
        'meng2017',
      ],
      relatedMetricIds: ['liverGlycogen', 'glucose'],
    },
    {
      id: '04-minimum-carbohydrate-brain-gng',
      title: 'How much carbohydrate the body needs, and the protein cost of making glucose',
      category: 'fuel',
      summary:
        "The brain burns 110–145 g of glucose a day in the fed state, but carbohydrate is not essential in the diet: glucose can be made from glycerol (from fat) and from amino acids (from protein). As ketones rise, they replace glucose as the brain's main fuel. Making glucose from protein has a cost: without carbohydrate and before ketone adaptation, the need is large enough to draw on muscle protein.",
      howModelled:
        "Glucose need shrinks as ketones supply more of the brain's fuel. Supply comes first from dietary carbohydrate, then glycogen, then glycerol (10% of fat burned), then amino acids at 1 g of glucose for 1.75 g of protein. Any shortfall is expressed as the protein needed for gluconeogenesis.",
      equation: `Glucose_need [g/d] = 120 · (1 − 1.2·K_brain) + 10        (K_brain = ketone share of brain oxygen use, 0–0.58)
Supply order: dietary CHO → glycogen → glycerol GNG (0.10 × fat oxidised) → amino-acid GNG (1 g glucose ← 1.75 g protein)
Protein_for_GNG [g/d] = max(0, Glucose_need − CI − glycogen_release − GNG_gly)/0.57`,
      keyNumbers: [
        {
          label: 'Brain glucose in short fasts',
          value: '110–145 g per 24 h',
          referenceIds: ['owen1967'],
        },
        {
          label: 'Brain fuel after 38–41 days of starvation (oxygen-equivalent share)',
          value:
            'Glucose about 28%, β-hydroxybutyrate plus acetoacetate about 58%, amino nitrogen about 14% (derived from 0.87, 1.77 and 0.42 of 3.06 mmol/L)',
          referenceIds: ['owen1967'],
        },
        {
          label: 'Glucose from protein',
          value: '57 g per 100 g of protein',
          referenceIds: ['owen1967'],
        },
        {
          label: 'Late starvation glucose synthesis',
          value:
            'About 19 g from glycerol (from about 1729 kcal of fat a day) plus about 14 g from 3.72 g N/d, about 33 g/d in total; the kidney becomes the main site',
          referenceIds: ['owen1967'],
        },
        {
          label: 'Glucose production and gluconeogenesis over a fast',
          value:
            'Glucose production 2.19 mg/kg/min overnight (36% gluconeogenesis) → 1.43 at 60 h (78%); gluconeogenesis share 64% (0–22 h), 82%, 96% (to 64 h)',
          referenceIds: ['hellerstein1997', 'rothman1991'],
        },
        {
          label: 'Dietary reference intake',
          value: 'RDA 130 g/d and EAR 100 g/d for adults, based on brain glucose use',
          note: 'The primary text of the 2005 report was not accessed; the values are quoted through two other sources.',
          referenceIds: ['institute2005', 'ha2021', 'murray2018'],
        },
        {
          label: 'Worked examples (derived)',
          value:
            'Zero carbohydrate before ketone adaptation: need about 130 g, glycerol supplies about 15–20 g, about 110 g from amino acids, about 190 g protein/d. After full brain ketone adaptation (K_brain about 0.58): need about 44 g, minus about 17 g from glycerol, about 27 g from amino acids, about 47 g protein/d',
          note: 'This matches the about 33 g/d glucose synthesis (about 23 g protein/d) seen in prolonged starvation. Most amino-acid carbon passes through glucose.',
          referenceIds: ['owen1967', 'jungas1992', 'cahillgf2006'],
        },
      ],
      timeCourse: 'The time course of brain ketone adaptation belongs to the ketosis topic.',
      moderators: 'Ketone level (K_brain), glycerol supply from fat burning, and dietary protein.',
      grade: 'B',
      gradeReason:
        'It rests on classic tracer and catheter physiology; the adaptation curve comes from the ketosis topic.',
      status: 'proposed-fit',
      caveats:
        'The equation is proposed by Vitals. At zero carbohydrate before adaptation, the protein need (about 190 g/d) exceeds most intakes, so muscle protein is drawn on.',
      referenceIds: [
        'owen1967',
        'hellerstein1997',
        'rothman1991',
        'institute2005',
        'ha2021',
        'murray2018',
        'jungas1992',
        'cahillgf2006',
      ],
      relatedMetricIds: ['fatOxidation', 'liverGlycogen'],
    },
    {
      id: '04-carbohydrate-performance-hormones',
      title: 'Carbohydrate, performance, training and hormones',
      category: 'performance',
      summary:
        'Muscle glycogen at the start sets how long moderate-to-hard endurance exercise can last, and carbohydrate during long events helps. For strength training in the fed state, carbohydrate intake made little difference at up to 10 sets per muscle group. Very-low-carbohydrate diets look worse for lean mass in some trials, but a large part of the gap is glycogen and water, not muscle protein. A few hormones respond to carbohydrate.',
      howModelled:
        'This topic supplies local muscle and liver glycogen to the performance topic. The engine only penalises lifting volume if local glycogen is under half of normal and planned sets are over 10 per muscle (proposed). It has no independent carbohydrate effect on muscle protein synthesis at equal protein and energy, and reports lean tissue and glycogen plus water separately.',
      keyNumbers: [
        {
          label: 'Time to exhaustion at about 75% of VO2max by starting glycogen',
          value:
            'About 1 h after a fat-and-protein diet, about 2 h on a mixed diet, about 3 h on a high-carbohydrate diet',
          referenceIds: ['bergstrom1967'],
        },
        {
          label: 'Carbohydrate during and around exercise',
          value:
            '30–60 g/h during exercise, up to 90 g/h for events over 2.5 h; daily intake guidelines 6–10 g/kg/d for high loads and 8–12 g/kg/d for very high loads',
          referenceIds: ['burke2011', 'murray2018'],
        },
        {
          label: 'Low-carbohydrate, high-fat adaptation',
          value:
            'Takes 5–6 days and impairs economy and high-intensity race performance by about 8% vs high carbohydrate; one day of carbohydrate restoration does not rescue it; de-adaptation occurs within 5 days. Submaximal (62–64% of VO2max) endurance was preserved after 4 weeks of ketosis',
          referenceIds: ['burke2021', 'phinney1983'],
        },
        {
          label: 'Resistance training (49 studies)',
          value:
            'Carbohydrate intake did not change strength-training performance in the fed state for workouts of 10 sets or fewer per muscle group; higher volumes, fasted or twice-daily sessions may benefit',
          referenceIds: ['henselmans2022'],
        },
        {
          label: 'Very-low-carbohydrate (ketogenic) diet with training vs other diets (13 trials, n = 244)',
          value:
            'Body mass −3.67 kg, fat mass −2.21 kg (−3.09 to −1.34), fat-free mass −1.26 kg (−1.82 to −0.70)',
          note: 'A glycogen drop of about 400 g carries about 1.2–1.6 kg of water, so much of the lean gap can be glycogen and water. An isocaloric very-low-carbohydrate diet increased protein use and fat-free-mass loss over 4 weeks.',
          referenceIds: ['ashtarylarky2022', 'hall2016'],
        },
        {
          label: 'Thyroid hormone',
          value:
            '800 kcal diets for 2 weeks: 0 g carbohydrate lowered T3 by 47%; 50 g/d or more of carbohydrate did not change T3',
          referenceIds: ['spaulding1976'],
        },
        {
          label: 'Testosterone and cortisol',
          value:
            'High-carbohydrate vs high-protein diet for 10 days at equal energy and fat: testosterone 468 vs 371 ng/dL, cortisol 7.74 vs 10.6 µg/dL. Low-fat vs high-fat diets lower testosterone (standardised difference −0.38, 95% CI −0.75 to −0.01)',
          note: 'A low-carbohydrate diet raises hepatic cortisol regeneration (11β-HSD1) without changing plasma cortisol.',
          referenceIds: ['anderson1987', 'whittaker2021', 'stimson2007'],
        },
        {
          label: 'Leptin and expenditure',
          value:
            '3 days of carbohydrate overfeeding raised leptin 28% and 24-hour expenditure 7%; fat overfeeding did not',
          referenceIds: ['dirlewanger2000'],
        },
      ],
      timeCourse:
        'Low-carbohydrate adaptation for performance takes 5–6 days; de-adaptation occurs within 5 days.',
      moderators:
        'Session volume and timing, fed or fasted state, event length, and how well adapted the athlete is.',
      grade: 'C',
      gradeReason:
        'The endurance performance data are strong (grade A−), but the resistance-training and muscle-retention data are grade C and the hormone data grade B−/C.',
      status: 'established',
      caveats:
        'The hormone findings come from small studies. The lean-mass difference on very-low-carbohydrate diets is partly a glycogen-and-water artefact in DXA or bioimpedance measurements.',
      referenceIds: [
        'bergstrom1967',
        'burke2011',
        'murray2018',
        'burke2021',
        'phinney1983',
        'henselmans2022',
        'ashtarylarky2022',
        'hall2016',
        'spaulding1976',
        'anderson1987',
        'whittaker2021',
        'stimson2007',
        'dirlewanger2000',
      ],
      relatedMetricIds: ['muscleGlycogen', 'enduranceCapacity'],
    },
  ],
  myths: [
    {
      id: '04-myth-carbs-turn-into-fat',
      claim: 'Carbs turn into body fat.',
      verdict: 'oversimplified',
      explanation:
        'Under normal eating this is false: liver fat synthesis is at most 5–10 g a day even at +50% carbohydrate overfeeding, and a 479 g starch meal was stored as glycogen with no net fat synthesis. Net conversion becomes large only when carbohydrate intake exceeds total energy expenditure and glycogen (about 15 g/kg) is full. Surplus carbohydrate still causes fat gain, mainly by sparing the burning of dietary fat.',
      referenceIds: ['schwarz1995', 'mcdevitt2001', 'acheson1982', 'acheson1988', 'hellerstein1999'],
    },
    {
      id: '04-myth-insulin-sets-body-fat',
      claim: 'Insulin, not calories, sets body fat, so low-carbohydrate diets have a metabolic advantage.',
      verdict: 'not-supported',
      explanation:
        'At equal energy and protein, ward studies show equal or less fat loss on low carbohydrate. A meta-analysis of 32 feeding studies found +16 g/d fat loss and +26 kcal/d expenditure favouring lower fat. Expenditure advantages of +150–210 kcal/d from doubly labelled water shrink when the RQ used in the calculation is corrected for energy imbalance. The carbohydrate-insulin view has proponents, so it stays labelled as contested, and the engine default is energy balance.',
      referenceIds: [
        'hall2015',
        'hall2016',
        'hall2017',
        'ebbeling2018',
        'hall2019a',
        'ludwig2021b',
        'ludwig2022',
      ],
    },
    {
      id: '04-myth-first-week-low-carb-is-fat',
      claim: "The first week's drop on low carbohydrate is fat loss.",
      verdict: 'not-supported',
      explanation:
        'It is mostly glycogen (about 300–500 g) with about 3 g of water per gram, plus sodium loss, giving 1–2 kg. In a ward study the low-carbohydrate arm lost more weight but less fat.',
      referenceIds: ['olsson1970', 'kreitzman1992', 'hall2011a', 'hall2015'],
    },
    {
      id: '04-myth-glycogen-3-4g-water',
      claim: 'Each gram of glycogen always holds 3–4 g of water.',
      verdict: 'oversimplified',
      explanation:
        'Measured ratios are at least 3 g/g when fluid is limited, 17 g/g with full rehydration (extra water not bound to glycogen), and about 2 g/g from whole-body deuterium-oxide data. A review calls the relationship inconclusive.',
      referenceIds: ['fernandezelias2015', 'shiose2016', 'shiose2022'],
    },
    {
      id: '04-myth-fasting-burns-muscle-glycogen',
      claim: 'Fasting burns muscle glycogen.',
      verdict: 'not-supported',
      explanation:
        'Overnight and short fasts deplete liver glycogen (−20–40% overnight, about 60% by 24 hours). Resting muscle glycogen does not change.',
      referenceIds: ['iwayama2021', 'murray2018'],
    },
    {
      id: '04-myth-carb-loading-needs-depletion',
      claim: 'Carbohydrate loading needs a depletion phase.',
      verdict: 'not-supported',
      explanation:
        'One day of about 10 g/kg/d of high-glycaemic-index carbohydrate while resting reached maximal stores, and a moderate taper protocol gave levels similar to the classic depletion protocol.',
      referenceIds: ['bussau2002', 'sherman1981'],
    },
    {
      id: '04-myth-fructose-toxic-any-dose',
      claim: 'Fructose is toxic at any dose.',
      verdict: 'oversimplified',
      explanation:
        'Swapping it for other carbohydrate at equal calories does not raise liver fat or uric acid. Harm appears with an energy surplus and high doses, and high-fructose corn syrup at 10% of energy or more raised triglyceride and LDL within 2 weeks. Both statements are true together.',
      referenceIds: ['chiu2014', 'wang2012', 'stanhope2015', 'sigala2022'],
    },
    {
      id: '04-myth-low-gi-always-low-glucose',
      claim: 'Low-glycaemic-index foods always give low blood glucose.',
      verdict: 'oversimplified',
      explanation:
        'Meal size, protein and fat, eating order, time of day and the individual all matter, and responses to identical meals vary widely between people.',
      referenceIds: ['wolever1996', 'zeevi2015'],
    },
    {
      id: '04-myth-spike-140-pathological',
      claim: 'Any glucose spike above 140 mg/dL in a healthy person is pathological.',
      verdict: 'not-supported',
      explanation: 'Healthy adults spend about 2% of the day (about 30 minutes) above 140 mg/dL.',
      referenceIds: ['shah2019'],
    },
    {
      id: '04-myth-keto-makes-you-diabetic',
      claim:
        'Very-low-carbohydrate ("keto") eating makes you diabetic, because your glucose tolerance test gets worse.',
      verdict: 'not-supported',
      explanation:
        'This is an adaptive, reversible fall in carbohydrate tolerance while fasting glucose and insulin are lower. It does distort diagnostic tests done shortly after carbohydrate returns.',
      referenceIds: ['jansen2022', 'hengist2024', 'rosenbaum2019'],
    },
    {
      id: '04-myth-must-eat-carbs-to-build-muscle',
      claim: 'You must eat carbohydrate to build muscle.',
      verdict: 'oversimplified',
      explanation:
        'Carbohydrate intake made no difference to strength-training performance for workouts of up to 10 sets per muscle group in the fed state. Fat-free-mass deficits on very-low-carbohydrate diets are partly glycogen water. Higher volumes may benefit.',
      referenceIds: ['henselmans2022', 'ashtarylarky2022'],
    },
    {
      id: '04-myth-brain-needs-130g',
      claim: 'The brain needs 130 g a day of dietary carbohydrate.',
      verdict: 'oversimplified',
      explanation:
        'The RDA reflects brain glucose use when not in ketosis. Gluconeogenesis and ketones cover the need when intake is lower, at a protein cost.',
      referenceIds: ['institute2005', 'owen1967'],
    },
    {
      id: '04-myth-metabolic-flexibility-burn-fat',
      claim: 'Metabolic flexibility means burning more fat.',
      verdict: 'not-supported',
      explanation:
        'Metabolic flexibility is the ability to switch fuels to match supply and demand, and insulin resistance impairs switching in both directions. The engine models it through the carbohydrate-share dynamics and insulin sensitivity.',
      referenceIds: ['galgani2008'],
    },
  ],
  openQuestions: [
    "The quadratic dependence of carbohydrate burning on glycogen is used without verifying Hall's exact published equation. It fits three studies reasonably, but a linear or Hill-type law with keto-adaptation might fit as well. Obese subjects did not match fat oxidation to fat intake over 7 days, so the time constant may be longer in obesity.",
    'Resting muscle glycogen on long-term very-low-carbohydrate diets in non-athletes is uncertain: the key value from the 4-week very-low-carbohydrate study could not be verified, the restoration in keto-adapted people rests on one cross-sectional study, and the rate constant and keto terms are grade C or D.',
    'The water held per gram of glycogen (2–4 g/g), how it depends on hydration, and how to separate it from the sodium and fluid effects of insulin, are unsettled.',
    'Whole-body muscle glycogen is inferred from values in two leg muscles multiplied by total muscle mass, so upper-body muscles and fibre-type differences are ignored.',
    'Liver volume scaling and liver biopsy norms are uncertain, because two biopsy studies were not accessed and the model relies on magnetic-resonance studies.',
    'The glucose model is an empirical curve, not a validated physiological model, and circadian and personal variability magnitudes are unverified. The upgrade path is a published meal simulation model.',
    'The insulin-sensitivity index has a proposed multiplicative structure and coefficients; interactions such as exercise plus energy deficit plus sleep are probably sub-additive.',
    'The size of the carbohydrate-tolerance effect (glucose rise up to +60%) and how it wanes after months of keto-adaptation are uncertain.',
    'Whether the carbohydrate-insulin view holds beyond 6 months under controlled feeding is unknown, since there are no ward data, and the disputes about doubly labelled water methods are unresolved.',
    'The liver fractional DNL function is poorly quantified for sugar versus starch, liquid versus solid, and fructose-specific effects, and the sugar multiplier spans a 30-fold range.',
    'The protein cost of gluconeogenesis uses classic stoichiometry (57 g glucose per 100 g protein), and the time course of brain ketone adaptation belongs to the ketosis topic.',
    'After-meal fat-oxidation suppression in mixed meals with fat, including chylomicron trafficking and adipose buffering, is simplified to insulin control of lipolysis and fatty-acid oxidation.',
  ],
  references: [
    {
      id: 'olsson1970',
      authors: 'Olsson KE, Saltin B',
      year: 1970,
      title: 'Variation in total body water with muscle glycogen changes in man',
      journal: 'Acta Physiol Scand',
      pmid: '5475323',
      doi: '10.1111/j.1748-1716.1970.tb04764.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/5475323/',
    },
    {
      id: 'fernandezelias2015',
      authors: 'Fernández-Elías VE, Ortega JF, Nelson RK, Mora-Rodriguez R',
      year: 2015,
      title:
        'Relationship between muscle water and glycogen recovery after prolonged exercise in the heat in humans',
      journal: 'Eur J Appl Physiol',
      pmid: '25911631',
      doi: '10.1007/s00421-015-3175-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25911631/',
    },
    {
      id: 'shiose2016',
      authors: 'Shiose K, Yamada Y, Motonaga K, et al.',
      year: 2016,
      title:
        'Segmental extracellular and intracellular water distribution and muscle glycogen after 72-h carbohydrate loading using spectroscopic techniques',
      journal: 'J Appl Physiol',
      pmid: '27231310',
      doi: '10.1152/japplphysiol.00126.2016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27231310/',
    },
    {
      id: 'shiose2022',
      authors: 'Shiose K, Takahashi H, Yamada Y',
      year: 2022,
      title: 'Muscle glycogen assessment and relationship with body hydration status: a narrative review',
      journal: 'Nutrients',
      pmid: '36615811',
      doi: '10.3390/nu15010155',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9823884/',
    },
    {
      id: 'kreitzman1992',
      authors: 'Kreitzman SN, Coxon AY, Szaz KF',
      year: 1992,
      title:
        'Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition',
      journal: 'Am J Clin Nutr',
      pmid: '1615908',
      doi: '10.1093/ajcn/56.1.292S',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1615908/',
    },
    {
      id: 'rothman1991',
      authors: 'Rothman DL, Magnusson I, Katz LD, Shulman RG, Shulman GI',
      year: 1991,
      title: 'Quantitation of hepatic glycogenolysis and gluconeogenesis in fasting humans with 13C NMR',
      journal: 'Science',
      pmid: '1948033',
      doi: '10.1126/science.1948033',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1948033/',
    },
    {
      id: 'magnusson1992',
      authors: 'Magnusson I, Rothman DL, Katz LD, Shulman RG, Shulman GI',
      year: 1992,
      title:
        'Increased rate of gluconeogenesis in type II diabetes mellitus. A 13C nuclear magnetic resonance study',
      journal: 'J Clin Invest',
      pmid: '1401068',
      doi: '10.1172/JCI115997',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC443176/',
    },
    {
      id: 'taylor1996',
      authors: 'Taylor R, Magnusson I, Rothman DL, et al.',
      year: 1996,
      title:
        'Direct assessment of liver glycogen storage by 13C nuclear magnetic resonance spectroscopy and regulation of glucose homeostasis after a mixed meal in normal subjects',
      journal: 'J Clin Invest',
      pmid: '8550823',
      doi: '10.1172/JCI118379',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC507070/',
    },
    {
      id: 'hellerstein1997',
      authors: 'Hellerstein MK, Neese RA, Linfoot P, et al.',
      year: 1997,
      title:
        'Hepatic gluconeogenic fluxes and glycogen turnover during fasting in humans. A stable isotope study',
      journal: 'J Clin Invest',
      pmid: '9276749',
      doi: '10.1172/JCI119644',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC508308/',
    },
    {
      id: 'nilsson1973a',
      authors: 'Nilsson LH, Hultman E',
      year: 1973,
      title:
        'Liver glycogen in man — the effect of total starvation or a carbohydrate-poor diet followed by carbohydrate refeeding',
      journal: 'Scand J Clin Lab Invest',
      pmid: '4771102',
      doi: '10.3109/00365517309084355',
      url: 'https://pubmed.ncbi.nlm.nih.gov/4771102/',
      verification: 'unverified',
    },
    {
      id: 'nilsson1973b',
      authors: 'Nilsson LH',
      year: 1973,
      title: 'Liver glycogen content in man in the postabsorptive state',
      journal: 'Scand J Clin Lab Invest',
      pmid: '4771101',
      doi: '10.3109/00365517309084354',
      url: 'https://pubmed.ncbi.nlm.nih.gov/4771101/',
      verification: 'unverified',
    },
    {
      id: 'iwayama2021',
      authors: 'Iwayama K, Tanabe Y, Tanji F, Ohnishi T, Takahashi H',
      year: 2021,
      title: 'Diurnal variations in muscle and liver glycogen differ depending on the timing of exercise',
      journal: 'J Physiol Sci',
      pmid: '34802419',
      doi: '10.1186/s12576-021-00821-1',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10717652/',
    },
    {
      id: 'gonzalez2015',
      authors: 'Gonzalez JT, Fuchs CJ, Smith FE, et al.',
      year: 2015,
      title:
        'Ingestion of glucose or sucrose prevents liver but not muscle glycogen depletion during prolonged endurance-type exercise in trained cyclists',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '26487008',
      doi: '10.1152/ajpendo.00376.2015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26487008/',
    },
    {
      id: 'gonzalez2016',
      authors: 'Gonzalez JT, Fuchs CJ, Betts JA, van Loon LJ',
      year: 2016,
      title: 'Liver glycogen metabolism during and after prolonged endurance-type exercise',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '27436612',
      doi: '10.1152/ajpendo.00232.2016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27436612/',
    },
    {
      id: 'fuchs2016',
      authors: 'Fuchs CJ, Gonzalez JT, Beelen M, et al.',
      year: 2016,
      title:
        'Sucrose ingestion after exhaustive exercise accelerates liver, but not muscle glycogen repletion compared with glucose ingestion in trained athletes',
      journal: 'J Appl Physiol',
      pmid: '27013608',
      doi: '10.1152/japplphysiol.01023.2015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27013608/',
    },
    {
      id: 'fuchs2019',
      authors: 'Fuchs CJ, Gonzalez JT, van Loon LJC',
      year: 2019,
      title: 'Fructose co-ingestion to increase carbohydrate availability in athletes',
      journal: 'J Physiol',
      pmid: '31166604',
      doi: '10.1113/JP277116',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6852172/',
    },
    {
      id: 'decombaz2011',
      authors: 'Décombaz J, Jentjens R, Ith M, et al.',
      year: 2011,
      title: 'Fructose and galactose enhance postexercise human liver glycogen synthesis',
      journal: 'Med Sci Sports Exerc',
      pmid: '21407126',
      doi: '10.1249/MSS.0b013e318218ca5a',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21407126/',
    },
    {
      id: 'casey2000',
      authors: 'Casey A, Mann R, Banister K, et al.',
      year: 2000,
      title:
        'Effect of carbohydrate ingestion on glycogen resynthesis in human liver and skeletal muscle, measured by 13C MRS',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '10644538',
      doi: '10.1152/ajpendo.2000.278.1.E65',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10644538/',
    },
    {
      id: 'murray2018',
      authors: 'Murray B, Rosenbloom C',
      year: 2018,
      title: 'Fundamentals of glycogen metabolism for coaches and athletes',
      journal: 'Nutr Rev',
      pmid: '29444266',
      doi: '10.1093/nutrit/nuy001',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6019055/',
    },
    {
      id: 'areta2018',
      authors: 'Areta JL, Hopkins WG',
      year: 2018,
      title:
        'Skeletal muscle glycogen content at rest and during endurance exercise in humans: a meta-analysis',
      journal: 'Sports Med',
      pmid: '29923148',
      doi: '10.1007/s40279-018-0941-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29923148/',
    },
    {
      id: 'bergstrom1967',
      authors: 'Bergström J, Hermansen L, Hultman E, Saltin B',
      year: 1967,
      title: 'Diet, muscle glycogen and physical performance',
      journal: 'Acta Physiol Scand',
      pmid: '5584523',
      doi: '10.1111/j.1748-1716.1967.tb03720.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/5584523/',
    },
    {
      id: 'bussau2002',
      authors: 'Bussau VA, Fairchild TJ, Rao A, Steele P, Fournier PA',
      year: 2002,
      title: 'Carbohydrate loading in human muscle: an improved 1 day protocol',
      journal: 'Eur J Appl Physiol',
      pmid: '12111292',
      doi: '10.1007/s00421-002-0621-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12111292/',
    },
    {
      id: 'sherman1981',
      authors: 'Sherman WM, Costill DL, Fink WJ, Miller JM',
      year: 1981,
      title:
        'Effect of exercise-diet manipulation on muscle glycogen and its subsequent utilization during performance',
      journal: 'Int J Sports Med',
      pmid: '7333741',
      doi: '10.1055/s-2008-1034594',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7333741/',
    },
    {
      id: 'arnall2007',
      authors: 'Arnall DA, Nelson AG, Quigley J, et al.',
      year: 2007,
      title: 'Supercompensated glycogen loads persist 5 days in resting trained cyclists',
      journal: 'Eur J Appl Physiol',
      pmid: '17120016',
      doi: '10.1007/s00421-006-0340-4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17120016/',
    },
    {
      id: 'jentjens2003',
      authors: 'Jentjens R, Jeukendrup A',
      year: 2003,
      title: 'Determinants of post-exercise glycogen synthesis during short-term recovery',
      journal: 'Sports Med',
      pmid: '12617691',
      doi: '10.2165/00007256-200333020-00004',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12617691/',
    },
    {
      id: 'ivy1988',
      authors: 'Ivy JL, Katz AL, Cutler CL, Sherman WM, Coyle EF',
      year: 1988,
      title: 'Muscle glycogen synthesis after exercise: effect of time of carbohydrate ingestion',
      journal: 'J Appl Physiol',
      pmid: '3132449',
      doi: '10.1152/jappl.1988.64.4.1480',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3132449/',
    },
    {
      id: 'burke2017',
      authors: 'Burke LM, van Loon LJC, Hawley JA',
      year: 2017,
      title: 'Postexercise muscle glycogen resynthesis in humans',
      journal: 'J Appl Physiol',
      pmid: '27789774',
      doi: '10.1152/japplphysiol.00860.2016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27789774/',
    },
    {
      id: 'carey2003',
      authors: 'Carey PE, Halliday J, Snaar JE, Morris PG, Taylor R',
      year: 2003,
      title:
        'Direct assessment of muscle glycogen storage after mixed meals in normal and type 2 diabetic subjects',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '12453829',
      doi: '10.1152/ajpendo.00471.2002',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12453829/',
    },
    {
      id: 'shulman1990',
      authors: 'Shulman GI, Rothman DL, Jue T, et al.',
      year: 1990,
      title:
        'Quantitation of muscle glycogen synthesis in normal subjects and subjects with non-insulin-dependent diabetes by 13C nuclear magnetic resonance spectroscopy',
      journal: 'N Engl J Med',
      pmid: '2403659',
      doi: '10.1056/NEJM199001253220403',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2403659/',
    },
    {
      id: 'janssen2000',
      authors: 'Janssen I, Heymsfield SB, Wang ZM, Ross R',
      year: 2000,
      title: 'Skeletal muscle mass and distribution in 468 men and women aged 18-88 yr',
      journal: 'J Appl Physiol',
      pmid: '10904038',
      doi: '10.1152/jappl.2000.89.1.81',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10904038/',
    },
    {
      id: 'robergs1991',
      authors: 'Robergs RA, Pearson DR, Costill DL, et al.',
      year: 1991,
      title: 'Muscle glycogenolysis during differing intensities of weight-resistance exercise',
      journal: 'J Appl Physiol',
      pmid: '2055849',
      doi: '10.1152/jappl.1991.70.4.1700',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2055849/',
    },
    {
      id: 'macdougall1999',
      authors: 'MacDougall JD, Ray S, Sale DG, et al.',
      year: 1999,
      title: 'Muscle substrate utilization and lactate production',
      journal: 'Can J Appl Physiol',
      pmid: '10364416',
      doi: '10.1139/h99-017',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10364416/',
    },
    {
      id: 'koopman2006',
      authors: 'Koopman R, Manders RJ, Jonkers RA, et al.',
      year: 2006,
      title:
        'Intramyocellular lipid and glycogen content are reduced following resistance exercise in untrained healthy males',
      journal: 'Eur J Appl Physiol',
      pmid: '16369816',
      doi: '10.1007/s00421-005-0118-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16369816/',
    },
    {
      id: 'tesch1986',
      authors: 'Tesch PA, Colliander EB, Kaiser P',
      year: 1986,
      title: 'Muscle metabolism during intense, heavy-resistance exercise',
      journal: 'Eur J Appl Physiol Occup Physiol',
      pmid: '3758035',
      doi: '10.1007/BF00422734',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3758035/',
    },
    {
      id: 'romijn1993',
      authors: 'Romijn JA, Coyle EF, Sidossis LS, et al.',
      year: 1993,
      title:
        'Regulation of endogenous fat and carbohydrate metabolism in relation to exercise intensity and duration',
      journal: 'Am J Physiol',
      pmid: '8214047',
      doi: '10.1152/ajpendo.1993.265.3.E380',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8214047/',
    },
    {
      id: 'vanloon2001',
      authors: 'van Loon LJ, Greenhaff PL, Constantin-Teodosiu D, Saris WH, Wagenmakers AJ',
      year: 2001,
      title: 'The effects of increasing exercise intensity on muscle fuel utilisation in humans',
      journal: 'J Physiol',
      pmid: '11579177',
      doi: '10.1111/j.1469-7793.2001.00295.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11579177/',
    },
    {
      id: 'phinney1983',
      authors: 'Phinney SD, Bistrian BR, Evans WJ, Gervino E, Blackburn GL',
      year: 1983,
      title:
        'The human metabolic response to chronic ketosis without caloric restriction: preservation of submaximal exercise capability with reduced carbohydrate oxidation',
      journal: 'Metabolism',
      pmid: '6865776',
      doi: '10.1016/0026-0495(83)90106-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6865776/',
      verification: 'abstract',
    },
    {
      id: 'volek2016',
      authors: 'Volek JS, Freidenreich DJ, Saenz C, et al.',
      year: 2016,
      title: 'Metabolic characteristics of keto-adapted ultra-endurance runners',
      journal: 'Metabolism',
      pmid: '26892521',
      doi: '10.1016/j.metabol.2015.10.028',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26892521/',
    },
    {
      id: 'tarry2025',
      authors: 'Tarry EK, Vestergaard SG, Petersen EA, et al.',
      year: 2025,
      title:
        'Divergent changes in peak fat oxidation and Fatmax following 3-day dietary interventions are related to muscle glycogen availability in men',
      journal: 'Scand J Med Sci Sports',
      pmid: '40922559',
      doi: '10.1111/sms.70132',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12417932/',
    },
    {
      id: 'burke2021',
      authors: 'Burke LM, Whitfield J, Heikura IA, et al.',
      year: 2021,
      title:
        'Adaptation to a low carbohydrate high fat diet is rapid but impairs endurance exercise metabolism and performance despite enhanced glycogen availability',
      journal: 'J Physiol',
      pmid: '32697366',
      doi: '10.1113/JP280221',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7891450/',
    },
    {
      id: 'acheson1982',
      authors: 'Acheson KJ, Flatt JP, Jéquier E',
      year: 1982,
      title: 'Glycogen synthesis versus lipogenesis after a 500 gram carbohydrate meal in man',
      journal: 'Metabolism',
      pmid: '6755166',
      doi: '10.1016/0026-0495(82)90010-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6755166/',
    },
    {
      id: 'acheson1988',
      authors: 'Acheson KJ, Schutz Y, Bessard T, et al.',
      year: 1988,
      title:
        'Glycogen storage capacity and de novo lipogenesis during massive carbohydrate overfeeding in man',
      journal: 'Am J Clin Nutr',
      pmid: '3165600',
      doi: '10.1093/ajcn/48.2.240',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3165600/',
    },
    {
      id: 'schwarz1995',
      authors: 'Schwarz JM, Neese RA, Turner S, Dare D, Hellerstein MK',
      year: 1995,
      title:
        'Short-term alterations in carbohydrate energy intake in humans. Striking effects on hepatic glucose production, de novo lipogenesis, lipolysis, and whole-body fuel selection',
      journal: 'J Clin Invest',
      pmid: '8675642',
      doi: '10.1172/JCI118342',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC185982/',
    },
    {
      id: 'schwarz2003',
      authors: 'Schwarz JM, Linfoot P, Dare D, Aghajanian K',
      year: 2003,
      title:
        'Hepatic de novo lipogenesis in normoinsulinemic and hyperinsulinemic subjects consuming high-fat, low-carbohydrate and low-fat, high-carbohydrate isoenergetic diets',
      journal: 'Am J Clin Nutr',
      pmid: '12499321',
      doi: '10.1093/ajcn/77.1.43',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12499321/',
    },
    {
      id: 'hudgins1996',
      authors: 'Hudgins LC, Hellerstein M, Seidman C, et al.',
      year: 1996,
      title: 'Human fatty acid synthesis is stimulated by a eucaloric low fat, high carbohydrate diet',
      journal: 'J Clin Invest',
      pmid: '8621798',
      doi: '10.1172/JCI118645',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC507283/',
    },
    {
      id: 'hudgins1998',
      authors: 'Hudgins LC, Seidman CE, Diakun J, Hirsch J',
      year: 1998,
      title: 'Human fatty acid synthesis is reduced after the substitution of dietary starch for sugar',
      journal: 'Am J Clin Nutr',
      pmid: '9537610',
      doi: '10.1093/ajcn/67.4.631',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9537610/',
    },
    {
      id: 'mcdevitt2001',
      authors: 'McDevitt RM, Bott SJ, Harding M, et al.',
      year: 2001,
      title:
        'De novo lipogenesis during controlled overfeeding with sucrose or glucose in lean and obese women',
      journal: 'Am J Clin Nutr',
      pmid: '11722954',
      doi: '10.1093/ajcn/74.6.737',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11722954/',
    },
    {
      id: 'minehira2004',
      authors: 'Minehira K, Vega N, Vidal H, Acheson K, Tappy L',
      year: 2004,
      title:
        'Effect of carbohydrate overfeeding on whole body macronutrient metabolism and expression of lipogenic enzymes in adipose tissue of lean and overweight humans',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '15303106',
      doi: '10.1038/sj.ijo.0802760',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15303106/',
    },
    {
      id: 'aarsland1997',
      authors: 'Aarsland A, Chinkes D, Wolfe RR',
      year: 1997,
      title: 'Hepatic and whole-body fat synthesis in humans during carbohydrate overfeeding',
      journal: 'Am J Clin Nutr',
      pmid: '9174472',
      doi: '10.1093/ajcn/65.6.1774',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9174472/',
      verification: 'abstract',
    },
    {
      id: 'hellerstein1999',
      authors: 'Hellerstein MK',
      year: 1999,
      title: 'De novo lipogenesis in humans: metabolic and regulatory aspects',
      journal: 'Eur J Clin Nutr',
      pmid: '10365981',
      doi: '10.1038/sj.ejcn.1600744',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10365981/',
    },
    {
      id: 'flatt1995',
      authors: 'Flatt JP',
      year: 1995,
      title: 'Use and storage of carbohydrate and fat',
      journal: 'Am J Clin Nutr',
      pmid: '7900694',
      doi: '10.1093/ajcn/61.4.952S',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7900694/',
    },
    {
      id: 'flatt1988',
      authors: 'Flatt JP',
      year: 1988,
      title: 'Importance of nutrient balance in body weight regulation',
      journal: 'Diabetes Metab Rev',
      pmid: '3065010',
      doi: '10.1002/dmr.5610040603',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3065010/',
    },
    {
      id: 'hill1991',
      authors: 'Hill JO, Peters JC, Reed GW, et al.',
      year: 1991,
      title: 'Nutrient balance in humans: effects of diet composition',
      journal: 'Am J Clin Nutr',
      pmid: '2058571',
      doi: '10.1093/ajcn/54.1.10',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2058571/',
    },
    {
      id: 'thomas1992',
      authors: 'Thomas CD, Peters JC, Reed GW, et al.',
      year: 1992,
      title:
        'Nutrient balance and energy expenditure during ad libitum feeding of high-fat and high-carbohydrate diets in humans',
      journal: 'Am J Clin Nutr',
      pmid: '1570800',
      doi: '10.1093/ajcn/55.5.934',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1570800/',
    },
    {
      id: 'schrauwen1997a',
      authors: 'Schrauwen P, van Marken Lichtenbelt WD, Saris WH, Westerterp KR',
      year: 1997,
      title: 'Changes in fat oxidation in response to a high-fat diet',
      journal: 'Am J Clin Nutr',
      pmid: '9250105',
      doi: '10.1093/ajcn/66.2.276',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9250105/',
    },
    {
      id: 'schrauwen1997b',
      authors: 'Schrauwen P, van Marken Lichtenbelt WD, Saris WH, Westerterp KR',
      year: 1997,
      title:
        'Role of glycogen-lowering exercise in the change of fat oxidation in response to a high-fat diet',
      journal: 'Am J Physiol',
      pmid: '9316454',
      doi: '10.1152/ajpendo.1997.273.3.E623',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9316454/',
    },
    {
      id: 'smith2000',
      authors: 'Smith SR, de Jonge L, Zachwieja JJ, et al.',
      year: 2000,
      title: 'Concurrent physical activity increases fat oxidation during the shift to a high-fat diet',
      journal: 'Am J Clin Nutr',
      pmid: '10871571',
      doi: '10.1093/ajcn/72.1.131',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10871571/',
    },
    {
      id: 'hall2015',
      authors: 'Hall KD, Bemis T, Brychta R, et al.',
      year: 2015,
      title:
        'Calorie for calorie, dietary fat restriction results in more body fat loss than carbohydrate restriction in people with obesity',
      journal: 'Cell Metab',
      pmid: '26278052',
      doi: '10.1016/j.cmet.2015.07.021',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4603544/',
    },
    {
      id: 'hall2016',
      authors: 'Hall KD, Chen KY, Guo J, et al.',
      year: 2016,
      title:
        'Energy expenditure and body composition changes after an isocaloric ketogenic diet in overweight and obese men',
      journal: 'Am J Clin Nutr',
      pmid: '27385608',
      doi: '10.3945/ajcn.116.133561',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4962163/',
    },
    {
      id: 'hall2019a',
      authors: 'Hall KD, Guo J, Chen KY, et al.',
      year: 2019,
      title:
        'Methodologic considerations for measuring energy expenditure differences between diets varying in carbohydrate using the doubly labeled water method',
      journal: 'Am J Clin Nutr',
      pmid: '31028699',
      doi: '10.1093/ajcn/nqy390',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6499509/',
    },
    {
      id: 'hall2021',
      authors: 'Hall KD, Guo J, Courville AB, et al.',
      year: 2021,
      title:
        'Effect of a plant-based, low-fat diet versus an animal-based, ketogenic diet on ad libitum energy intake',
      journal: 'Nat Med',
      pmid: '33479499',
      doi: '10.1038/s41591-020-01209-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33479499/',
    },
    {
      id: 'hall2017',
      authors: 'Hall KD, Guo J',
      year: 2017,
      title: 'Obesity energetics: body weight regulation and the effects of diet composition',
      journal: 'Gastroenterology',
      pmid: '28193517',
      doi: '10.1053/j.gastro.2017.01.052',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5568065/',
    },
    {
      id: 'hall2011a',
      authors: 'Hall KD, Sacks G, Chandramohan D, et al.',
      year: 2011,
      title: 'Quantification of the effect of energy imbalance on bodyweight',
      journal: 'Lancet',
      pmid: '21872751',
      doi: '10.1016/S0140-6736(11)60812-X',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/',
    },
    {
      id: 'hall2010a',
      authors: 'Hall KD',
      year: 2010,
      title: 'Predicting metabolic adaptation, body weight change, and energy intake in humans',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '19934407',
      doi: '10.1152/ajpendo.00559.2009',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/',
    },
    {
      id: 'ludwig2021b',
      authors: 'Ludwig DS, Aronne LJ, Astrup A, et al.',
      year: 2021,
      title: 'The carbohydrate-insulin model: a physiological perspective on the obesity pandemic',
      journal: 'Am J Clin Nutr',
      pmid: '34515299',
      doi: '10.1093/ajcn/nqab270',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8634575/',
    },
    {
      id: 'ludwig2022',
      authors: 'Ludwig DS, Apovian CM, Aronne LJ, et al.',
      year: 2022,
      title: 'Competing paradigms of obesity pathogenesis: energy balance versus carbohydrate-insulin models',
      journal: 'Eur J Clin Nutr',
      pmid: '35896818',
      doi: '10.1038/s41430-022-01179-2',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9436778/',
    },
    {
      id: 'ebbeling2018',
      authors: 'Ebbeling CB, Feldman HA, Klein GL, et al.',
      year: 2018,
      title:
        'Effects of a low carbohydrate diet on energy expenditure during weight loss maintenance: randomized trial',
      journal: 'BMJ',
      pmid: '30429127',
      doi: '10.1136/bmj.k4583',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6233655/',
    },
    {
      id: 'ebbeling2012',
      authors: 'Ebbeling CB, Swain JF, Feldman HA, et al.',
      year: 2012,
      title: 'Effects of dietary composition on energy expenditure during weight-loss maintenance',
      journal: 'JAMA',
      pmid: '22735432',
      doi: '10.1001/jama.2012.6607',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3564212/',
    },
    {
      id: 'jensen1989',
      authors: 'Jensen MD, Caruso M, Heiling V, Miles JM',
      year: 1989,
      title: 'Insulin regulation of lipolysis in nondiabetic and IDDM subjects',
      journal: 'Diabetes',
      pmid: '2573554',
      doi: '10.2337/diab.38.12.1595',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2573554/',
    },
    {
      id: 'campbell1992',
      authors: 'Campbell PJ, Carlson MG, Hill JO, Nurjhan N',
      year: 1992,
      title:
        'Regulation of free fatty acid metabolism by insulin in humans: role of lipolysis and reesterification',
      journal: 'Am J Physiol',
      pmid: '1476178',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1476178/',
    },
    {
      id: 'stumvoll2000',
      authors: 'Stumvoll M, Jacob S, Wahl HG, et al.',
      year: 2000,
      title:
        'Suppression of systemic, intramuscular, and subcutaneous adipose tissue lipolysis by insulin in humans',
      journal: 'J Clin Endocrinol Metab',
      pmid: '11061533',
      doi: '10.1210/jcem.85.10.6898',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11061533/',
    },
    {
      id: 'jensen2007',
      authors: 'Jensen MD, Nielsen S',
      year: 2007,
      title: 'Insulin dose response analysis of free fatty acid kinetics',
      journal: 'Metabolism',
      pmid: '17161228',
      doi: '10.1016/j.metabol.2006.08.022',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17161228/',
    },
    {
      id: 'frayn2002',
      authors: 'Frayn KN',
      year: 2002,
      title: 'Adipose tissue as a buffer for daily lipid flux',
      journal: 'Diabetologia',
      pmid: '12242452',
      doi: '10.1007/s00125-002-0873-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12242452/',
    },
    {
      id: 'frayn1983',
      authors: 'Frayn KN',
      year: 1983,
      title: 'Calculation of substrate oxidation rates in vivo from gaseous exchange',
      journal: 'J Appl Physiol',
      pmid: '6618956',
      doi: '10.1152/jappl.1983.55.2.628',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6618956/',
    },
    {
      id: 'livesey1988',
      authors: 'Livesey G, Elia M',
      year: 1988,
      title:
        'Estimation of energy expenditure, net carbohydrate utilization, and net fat oxidation and synthesis by indirect calorimetry: evaluation of errors with special reference to the detailed composition of fuels',
      journal: 'Am J Clin Nutr',
      pmid: '3281434',
      doi: '10.1093/ajcn/47.4.608',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3281434/',
    },
    {
      id: 'wolever1996',
      authors: 'Wolever TM, Bolognesi C',
      year: 1996,
      title:
        'Prediction of glucose and insulin responses of normal subjects after consuming mixed meals varying in energy, protein, fat, carbohydrate and glycemic index',
      journal: 'J Nutr',
      pmid: '8914952',
      doi: '10.1093/jn/126.11.2807',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8914952/',
    },
    {
      id: 'moghaddam2006',
      authors: 'Moghaddam E, Vogt JA, Wolever TM',
      year: 2006,
      title:
        'The effects of fat and protein on glycemic responses in nondiabetic humans vary with waist circumference, fasting plasma insulin, and dietary fiber intake',
      journal: 'J Nutr',
      pmid: '16988118',
      doi: '10.1093/jn/136.10.2506',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16988118/',
    },
    {
      id: 'brandmiller2003',
      authors: 'Brand-Miller JC, Thomas M, Swan V, et al.',
      year: 2003,
      title: 'Physiological validation of the concept of glycemic load in lean young adults',
      journal: 'J Nutr',
      pmid: '12949357',
      doi: '10.1093/jn/133.9.2728',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12949357/',
    },
    {
      id: 'atkinson2021',
      authors: 'Atkinson FS, Brand-Miller JC, Foster-Powell K, Buyken AE, Goletzke J',
      year: 2021,
      title: 'International tables of glycemic index and glycemic load values 2021: a systematic review',
      journal: 'Am J Clin Nutr',
      pmid: '34258626',
      doi: '10.1093/ajcn/nqab233',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34258626/',
    },
    {
      id: 'lee1998',
      authors: 'Lee BM, Wolever TM',
      year: 1998,
      title:
        'Effect of glucose, sucrose and fructose on plasma glucose and insulin responses in normal humans: comparison with white bread',
      journal: 'Eur J Clin Nutr',
      pmid: '9881888',
      doi: '10.1038/sj.ejcn.1600666',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9881888/',
    },
    {
      id: 'meng2017',
      authors: 'Meng H, Matthan NR, Ausman LM, Lichtenstein AH',
      year: 2017,
      title:
        'Effect of macronutrients and fiber on postprandial glycemic responses and meal glycemic index and glycemic load value determinations',
      journal: 'Am J Clin Nutr',
      pmid: '28202475',
      doi: '10.3945/ajcn.116.144162',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5366046/',
    },
    {
      id: 'shukla2015',
      authors: 'Shukla AP, Iliescu RG, Thomas CE, Aronne LJ',
      year: 2015,
      title: 'Food order has a significant impact on postprandial glucose and insulin levels',
      journal: 'Diabetes Care',
      pmid: '26106234',
      doi: '10.2337/dc15-0429',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4876745/',
    },
    {
      id: 'shishehbor2017',
      authors: 'Shishehbor F, Mansoori A, Shirani F',
      year: 2017,
      title:
        'Vinegar consumption can attenuate postprandial glucose and insulin responses; a systematic review and meta-analysis of clinical trials',
      journal: 'Diabetes Res Clin Pract',
      pmid: '28292654',
      doi: '10.1016/j.diabres.2017.01.021',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28292654/',
    },
    {
      id: 'tosh2013',
      authors: 'Tosh SM',
      year: 2013,
      title:
        'Review of human studies investigating the post-prandial blood-glucose lowering ability of oat and barley food products',
      journal: 'Eur J Clin Nutr',
      pmid: '23422921',
      doi: '10.1038/ejcn.2013.25',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23422921/',
    },
    {
      id: 'zeevi2015',
      authors: 'Zeevi D, Korem T, Zmora N, et al.',
      year: 2015,
      title: 'Personalized nutrition by prediction of glycemic responses',
      journal: 'Cell',
      pmid: '26590418',
      doi: '10.1016/j.cell.2015.11.001',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26590418/',
    },
    {
      id: 'shah2019',
      authors: 'Shah VN, DuBose SN, Li Z, et al.',
      year: 2019,
      title:
        'Continuous glucose monitoring profiles in healthy nondiabetic participants: a multicenter prospective study',
      journal: 'J Clin Endocrinol Metab',
      pmid: '31127824',
      doi: '10.1210/jc.2018-02763',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7296129/',
    },
    {
      id: 'hall2018',
      authors: 'Hall H, Perelman D, Breschi A, et al.',
      year: 2018,
      title: 'Glucotypes reveal new patterns of glucose dysregulation',
      journal: 'PLoS Biol',
      pmid: '30040822',
      doi: '10.1371/journal.pbio.2005143',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6057684/',
    },
    {
      id: 'holt1997',
      authors: 'Holt SH, Miller JC, Petocz P',
      year: 1997,
      title: 'An insulin index of foods: the insulin demand generated by 1000-kJ portions of common foods',
      journal: 'Am J Clin Nutr',
      pmid: '9356547',
      doi: '10.1093/ajcn/66.5.1264',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9356547/',
    },
    {
      id: 'saad2012',
      authors: 'Saad A, Dalla Man C, Nandy DK, et al.',
      year: 2012,
      title: 'Diurnal pattern to insulin secretion and insulin action in healthy individuals',
      journal: 'Diabetes',
      pmid: '22751690',
      doi: '10.2337/db11-1478',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3478548/',
    },
    {
      id: 'dallaman2007a',
      authors: 'Dalla Man C, Rizza RA, Cobelli C',
      year: 2007,
      title: 'Meal simulation model of the glucose-insulin system',
      journal: 'IEEE Trans Biomed Eng',
      pmid: '17926672',
      doi: '10.1109/TBME.2007.893506',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17926672/',
    },
    {
      id: 'lim2011',
      authors: 'Lim EL, Hollingsworth KG, Aribisala BS, et al.',
      year: 2011,
      title:
        'Reversal of type 2 diabetes: normalisation of beta cell function in association with decreased pancreas and liver triacylglycerol',
      journal: 'Diabetologia',
      pmid: '21656330',
      doi: '10.1007/s00125-011-2204-7',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3168743/',
    },
    {
      id: 'kirk2009',
      authors: 'Kirk E, Reeds DN, Finck BN, et al.',
      year: 2009,
      title:
        'Dietary fat and carbohydrates differentially alter insulin sensitivity during caloric restriction',
      journal: 'Gastroenterology',
      pmid: '19208352',
      doi: '10.1053/j.gastro.2009.01.048',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2677125/',
    },
    {
      id: 'petersen2005',
      authors: 'Petersen KF, Dufour S, Befroy D, et al.',
      year: 2005,
      title:
        'Reversal of nonalcoholic hepatic steatosis, hepatic insulin resistance, and hyperglycemia by moderate weight reduction in patients with type 2 diabetes',
      journal: 'Diabetes',
      pmid: '15734833',
      doi: '10.2337/diabetes.54.3.603',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2995496/',
    },
    {
      id: 'magkos2016',
      authors: 'Magkos F, Fraterrigo G, Yoshino J, et al.',
      year: 2016,
      title:
        'Effects of moderate and subsequent progressive weight loss on metabolic function and adipose tissue biology in humans with obesity',
      journal: 'Cell Metab',
      pmid: '26916363',
      doi: '10.1016/j.cmet.2016.02.005',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4833627/',
    },
    {
      id: 'mikines1988',
      authors: 'Mikines KJ, Sonne B, Farrell PA, Tronier B, Galbo H',
      year: 1988,
      title: 'Effect of physical exercise on sensitivity and responsiveness to insulin in humans',
      journal: 'Am J Physiol',
      pmid: '3126668',
      doi: '10.1152/ajpendo.1988.254.3.E248',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3126668/',
    },
    {
      id: 'king1995',
      authors: 'King DS, Baldus PJ, Sharp RL, et al.',
      year: 1995,
      title:
        'Time course for exercise-induced alterations in insulin action and glucose tolerance in middle-aged people',
      journal: 'J Appl Physiol',
      pmid: '7713807',
      doi: '10.1152/jappl.1995.78.1.17',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7713807/',
    },
    {
      id: 'kroghmadsen2010',
      authors: 'Krogh-Madsen R, Thyfault JP, Broholm C, et al.',
      year: 2010,
      title: 'A 2-wk reduction of ambulatory activity attenuates peripheral insulin sensitivity',
      journal: 'J Appl Physiol',
      pmid: '20044474',
      doi: '10.1152/japplphysiol.00977.2009',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20044474/',
    },
    {
      id: 'bird2016',
      authors: 'Bird SR, Hawley JA',
      year: 2016,
      title: 'Update on the effects of physical activity on insulin sensitivity in humans',
      journal: 'BMJ Open Sport Exerc Med',
      pmid: '28879026',
      doi: '10.1136/bmjsem-2016-000143',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5569266/',
    },
    {
      id: 'donga2010',
      authors: 'Donga E, van Dijk M, van Dijk JG, et al.',
      year: 2010,
      title:
        'A single night of partial sleep deprivation induces insulin resistance in multiple metabolic pathways in healthy subjects',
      journal: 'J Clin Endocrinol Metab',
      pmid: '20371664',
      doi: '10.1210/jc.2009-2430',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20371664/',
    },
    {
      id: 'buxton2010',
      authors: 'Buxton OM, Pavlova M, Reid EW, et al.',
      year: 2010,
      title: 'Sleep restriction for 1 week reduces insulin sensitivity in healthy men',
      journal: 'Diabetes',
      pmid: '20585000',
      doi: '10.2337/db09-0699',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2927933/',
    },
    {
      id: 'vessby2001',
      authors: 'Vessby B, Uusitupa M, Hermansen K, et al.',
      year: 2001,
      title:
        'Substituting dietary saturated for monounsaturated fat impairs insulin sensitivity in healthy men and women: the KANWU Study',
      journal: 'Diabetologia',
      pmid: '11317662',
      doi: '10.1007/s001250051620',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11317662/',
    },
    {
      id: 'luukkonen2018',
      authors: 'Luukkonen PK, Sädevirta S, Zhou Y, et al.',
      year: 2018,
      title:
        'Saturated fat is more metabolically harmful for the human liver than unsaturated fat or simple sugars',
      journal: 'Diabetes Care',
      pmid: '29844096',
      doi: '10.2337/dc18-0071',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7082640/',
    },
    {
      id: 'matthews1985',
      authors: 'Matthews DR, Hosker JP, Rudenski AS, et al.',
      year: 1985,
      title:
        'Homeostasis model assessment: insulin resistance and beta-cell function from fasting plasma glucose and insulin concentrations in man',
      journal: 'Diabetologia',
      pmid: '3899825',
      doi: '10.1007/BF00280883',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3899825/',
    },
    {
      id: 'matsuda1999',
      authors: 'Matsuda M, DeFronzo RA',
      year: 1999,
      title:
        'Insulin sensitivity indices obtained from oral glucose tolerance testing: comparison with the euglycemic insulin clamp',
      journal: 'Diabetes Care',
      pmid: '10480510',
      doi: '10.2337/diacare.22.9.1462',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10480510/',
    },
    {
      id: 'numao2012',
      authors: 'Numao S, Kawano H, Endo N, et al.',
      year: 2012,
      title:
        'Short-term low carbohydrate/high-fat diet intake increases postprandial plasma glucose and glucagon-like peptide-1 levels during an oral glucose tolerance test in healthy men',
      journal: 'Eur J Clin Nutr',
      pmid: '22669333',
      doi: '10.1038/ejcn.2012.58',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22669333/',
    },
    {
      id: 'jansen2022',
      authors: 'Jansen LT, Yang N, Wong JMW, et al.',
      year: 2022,
      title:
        'Prolonged glycemic adaptation following transition from a low- to high-carbohydrate diet: a randomized controlled feeding trial',
      journal: 'Diabetes Care',
      pmid: '35108378',
      doi: '10.2337/dc21-1970',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8918196/',
    },
    {
      id: 'hengist2024',
      authors: 'Hengist A, Davies RG, Walhin JP, et al.',
      year: 2024,
      title:
        'Ketogenic diet but not free-sugar restriction alters glucose tolerance, lipid metabolism, peripheral tissue phenotype, and gut microbiome: RCT',
      journal: 'Cell Rep Med',
      pmid: '39106867',
      doi: '10.1016/j.xcrm.2024.101667',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11384946/',
    },
    {
      id: 'sun2012',
      authors: 'Sun SZ, Empie MW',
      year: 2012,
      title: 'Fructose metabolism in humans — what isotopic tracer studies tell us',
      journal: 'Nutr Metab (Lond)',
      pmid: '23031075',
      doi: '10.1186/1743-7075-9-89',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3533803/',
    },
    {
      id: 'stanhope2009',
      authors: 'Stanhope KL, Schwarz JM, Keim NL, et al.',
      year: 2009,
      title:
        'Consuming fructose-sweetened, not glucose-sweetened, beverages increases visceral adiposity and lipids and decreases insulin sensitivity in overweight/obese humans',
      journal: 'J Clin Invest',
      pmid: '19381015',
      doi: '10.1172/JCI37385',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2673878/',
    },
    {
      id: 'stanhope2015',
      authors: 'Stanhope KL, Medici V, Bremer AA, et al.',
      year: 2015,
      title:
        'A dose-response study of consuming high-fructose corn syrup-sweetened beverages on lipid/lipoprotein risk factors for cardiovascular disease in young adults',
      journal: 'Am J Clin Nutr',
      pmid: '25904601',
      doi: '10.3945/ajcn.114.100461',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4441807/',
    },
    {
      id: 'sigala2022',
      authors: 'Sigala DM, Hieronimus B, Medici V, et al.',
      year: 2022,
      title:
        'The dose-response effects of consuming high fructose corn syrup-sweetened beverages on hepatic lipid content and insulin sensitivity in young adults',
      journal: 'Nutrients',
      pmid: '35458210',
      doi: '10.3390/nu14081648',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9030734/',
    },
    {
      id: 'chiu2014',
      authors: 'Chiu S, Sievenpiper JL, de Souza RJ, et al.',
      year: 2014,
      title:
        'Effect of fructose on markers of non-alcoholic fatty liver disease (NAFLD): a systematic review and meta-analysis of controlled feeding trials',
      journal: 'Eur J Clin Nutr',
      pmid: '24569542',
      doi: '10.1038/ejcn.2014.8',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3975811/',
    },
    {
      id: 'wang2012',
      authors: 'Wang DD, Sievenpiper JL, de Souza RJ, et al.',
      year: 2012,
      title: 'The effects of fructose intake on serum uric acid vary among controlled dietary trials',
      journal: 'J Nutr',
      pmid: '22457397',
      doi: '10.3945/jn.111.151951',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3327749/',
    },
    {
      id: 'baer1997',
      authors: 'Baer DJ, Rumpler WV, Miles CW, Fahey GC',
      year: 1997,
      title:
        'Dietary fiber decreases the metabolizable energy content and nutrient digestibility of mixed diets fed to humans',
      journal: 'J Nutr',
      pmid: '9109608',
      doi: '10.1093/jn/127.4.579',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9109608/',
    },
    {
      id: 'novotny2012',
      authors: 'Novotny JA, Gebauer SK, Baer DJ',
      year: 2012,
      title:
        'Discrepancy between the Atwater factor predicted and empirically measured energy values of almonds in human diets',
      journal: 'Am J Clin Nutr',
      pmid: '22760558',
      doi: '10.3945/ajcn.112.035782',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3396444/',
    },
    {
      id: 'owen1967',
      authors: 'Owen OE, Morgan AP, Kemp HG, et al.',
      year: 1967,
      title: 'Brain metabolism during fasting',
      journal: 'J Clin Invest',
      pmid: '6061736',
      doi: '10.1172/JCI105650',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC292907/',
    },
    {
      id: 'cahillgf2006',
      authors: 'Cahill GF Jr',
      year: 2006,
      title: 'Fuel metabolism in starvation',
      journal: 'Annu Rev Nutr',
      pmid: '16848698',
      doi: '10.1146/annurev.nutr.26.061505.111258',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16848698/',
    },
    {
      id: 'jungas1992',
      authors: 'Jungas RL, Halperin ML, Brosnan JT',
      year: 1992,
      title: 'Quantitative analysis of amino acid oxidation and related gluconeogenesis in humans',
      journal: 'Physiol Rev',
      pmid: '1557428',
      doi: '10.1152/physrev.1992.72.2.419',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1557428/',
    },
    {
      id: 'ha2021',
      authors: 'Ha K, Song Y',
      year: 2021,
      title: 'Low-carbohydrate diets in Korea: why does it matter, and what is next?',
      journal: 'J Obes Metab Syndr',
      pmid: '34504048',
      doi: '10.7570/jomes21051',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8526287/',
    },
    {
      id: 'institute2005',
      authors: 'Institute of Medicine',
      year: 2005,
      title:
        'Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids',
      journal: 'Washington DC: National Academies Press',
      url: 'https://nap.nationalacademies.org/catalog/10490',
      verification: 'unverified',
    },
    {
      id: 'burke2011',
      authors: 'Burke LM, Hawley JA, Wong SH, Jeukendrup AE',
      year: 2011,
      title: 'Carbohydrates for training and competition',
      journal: 'J Sports Sci',
      pmid: '21660838',
      doi: '10.1080/02640414.2011.585473',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21660838/',
    },
    {
      id: 'henselmans2022',
      authors: 'Henselmans M, Bjørnsen T, Hedderman R, Vårvik FT',
      year: 2022,
      title:
        'The effect of carbohydrate intake on strength and resistance training performance: a systematic review',
      journal: 'Nutrients',
      pmid: '35215506',
      doi: '10.3390/nu14040856',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8878406/',
    },
    {
      id: 'ashtarylarky2022',
      authors: 'Ashtary-Larky D, Bagheri R, Asbaghi O, et al.',
      year: 2022,
      title:
        'Effects of resistance training combined with a ketogenic diet on body composition: a systematic review and meta-analysis',
      journal: 'Crit Rev Food Sci Nutr',
      pmid: '33624538',
      doi: '10.1080/10408398.2021.1890689',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33624538/',
    },
    {
      id: 'whittaker2021',
      authors: 'Whittaker J, Wu K',
      year: 2021,
      title:
        'Low-fat diets and testosterone in men: systematic review and meta-analysis of intervention studies',
      journal: 'J Steroid Biochem Mol Biol',
      pmid: '33741447',
      doi: '10.1016/j.jsbmb.2021.105878',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33741447/',
    },
    {
      id: 'spaulding1976',
      authors: 'Spaulding SW, Chopra IJ, Sherwin RS, Lyall SS',
      year: 1976,
      title: 'Effect of caloric restriction and dietary composition of serum T3 and reverse T3 in man',
      journal: 'J Clin Endocrinol Metab',
      pmid: '1249190',
      doi: '10.1210/jcem-42-1-197',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1249190/',
    },
    {
      id: 'anderson1987',
      authors: 'Anderson KE, Rosner W, Khan MS, et al.',
      year: 1987,
      title:
        'Diet-hormone interactions: protein/carbohydrate ratio alters reciprocally the plasma levels of testosterone and cortisol and their respective binding globulins in man',
      journal: 'Life Sci',
      pmid: '3573976',
      doi: '10.1016/0024-3205(87)90086-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3573976/',
    },
    {
      id: 'stimson2007',
      authors: 'Stimson RH, Johnstone AM, Homer NZ, et al.',
      year: 2007,
      title:
        'Dietary macronutrient content alters cortisol metabolism independently of body weight changes in obese men',
      journal: 'J Clin Endocrinol Metab',
      pmid: '17785367',
      doi: '10.1210/jc.2007-0692',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17785367/',
    },
    {
      id: 'dirlewanger2000',
      authors: 'Dirlewanger M, di Vetta V, Guenat E, et al.',
      year: 2000,
      title:
        'Effects of short-term carbohydrate or fat overfeeding on energy expenditure and plasma leptin concentrations in healthy female subjects',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '11126336',
      doi: '10.1038/sj.ijo.0801395',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11126336/',
    },
    {
      id: 'galgani2008',
      authors: 'Galgani JE, Moro C, Ravussin E',
      year: 2008,
      title: 'Metabolic flexibility and insulin resistance',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '18765680',
      doi: '10.1152/ajpendo.90558.2008',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2584808/',
    },
    {
      id: 'rosenbaum2019',
      authors: 'Rosenbaum M, Hall KD, Guo J, et al.',
      year: 2019,
      title:
        'Glucose and lipid homeostasis and inflammation in humans following an isocaloric ketogenic diet',
      journal: 'Obesity (Silver Spring)',
      pmid: '31067015',
      doi: '10.1002/oby.22468',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6922028/',
    },
  ],
};

export default topic;
