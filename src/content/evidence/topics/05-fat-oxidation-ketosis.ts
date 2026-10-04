import type { EvidenceTopic } from '../schema';

/** Evidence topic for research/05-fat-oxidation-ketosis.md (pure data). */
const topic: EvidenceTopic = {
  dossier: '05',
  slug: 'fat-oxidation-ketosis',
  title: 'Fat oxidation and ketosis',
  scope:
    'How the body handles dietary fat and how it makes and clears ketones, the fuel molecules the liver builds from fat when carbohydrate is scarce. This topic covers the hour-by-hour ketone model, how ketosis starts, ends and returns, the limits on how fast fat can be burned, and the minimum fat the body needs. It also covers whether ketosis by itself changes appetite, muscle protein, energy use or fat loss.',
  mechanisms: [
    {
      id: '05-ketone-clearance',
      title: 'How fast the body clears ketones',
      category: 'fuel',
      summary:
        'Ketones are fuel molecules made by the liver from fat. Muscle, heart, brain and kidney take them up from the blood. Below about 2 mmol/L, uptake rises in step with the blood level. Above that, the uptake machinery starts to saturate, so the level can climb higher. In a long fast, muscle takes up less, which leaves more for the brain.',
      howModelled:
        'The engine tracks total blood ketones as one pool, sized at a quarter of body weight in litres. Four times an hour it removes ketones at a saturating rate: proportional to the level when low, capped when high. The cap is lowered in prolonged fasting. Exercise speeds clearance while it lasts and slows it for two hours afterwards. The kidneys lose a small amount in urine once the level passes 1 mmol/L.',
      equation: `V_d = 0.25 · BW
CL_0 = 0.0134 · FFM
V_max = CL_0 · K_m
U = V_max · TKB/(K_m + TKB) · M_ex · (1 − a_m·A_s)
Renal = r_ren · BW · max(0, TKB − T_thr)
dTKB/dt = (P_total − U − Renal)/V_d`,
      keyNumbers: [
        {
          label: 'Volume the ketones spread through',
          value: '0.25 L per kg body weight (range 0.18–0.31)',
          note: 'Owen 1973 measured a volume of distribution of 18–31 % of body weight.',
          referenceIds: ['owen1973'],
        },
        {
          label: 'Fraction cleared per minute at low ketone levels',
          value: '2.9 %/min (all subjects); 2.1 %/min (obese, overnight fasted)',
          referenceIds: ['owen1973'],
        },
        {
          label: 'Clearance per kg fat-free mass',
          value: 'CL_0 = 0.0134 L·min⁻¹·kg FFM⁻¹ (±30 %)',
          note: 'Derived by Vitals: 0.029 min⁻¹ × 0.25 L/kg × BW for obese subjects (BW ≈ 110 kg, FFM ≈ 60 kg).',
          referenceIds: ['owen1973'],
        },
        {
          label: 'Level at which uptake is half-saturated',
          value: 'K_m = 6.0 mmol/L total ketones (range 4–12)',
          note: 'Proposed fit. It reproduces three things: fractional use falling from 2.9 to 1.5 to 0.6 %/min at overnight, 3-day and 24-day fasts; a plateau level of 7.09 ± 0.32 mM with production of 1908 ± 80 µmol/min and urinary loss of 167 ± 14 µmol/min; and linear use below 2 mM.',
          referenceIds: ['owen1973', 'balasse1979'],
        },
        {
          label: 'Fall in clearance in starvation',
          value: 'a_m = 0.35 (range 0.2–0.5)',
          note: 'Starvation lowered clearance by 35 % compared with acutely infused subjects at 3–10 mM.',
          referenceIds: ['balasse1979'],
        },
        {
          label: 'Urinary loss of ketones',
          value: 'r_ren = 0.00025 L·min⁻¹·kg⁻¹ above T_thr = 1.0 mmol/L (±50 %)',
          note: 'Proposed fit, chosen to reproduce 167 µmol/min in urine at 7.1 mM in a roughly 110 kg obese person. Urinary loss is always below 10 % of total turnover under physiological conditions.',
          referenceIds: ['balasse1979', 'balasse1989'],
        },
        {
          label: 'Effect of exercise on clearance',
          value: 'M_ex = 1 + 1.0·x/(1 + (TKB/3)⁴) during exercise; × 0.6 for 2 h afterwards (±50 %)',
          note: 'x is exercise intensity as a fraction of VO2max. Clearance rose 40–50 % during 2 h at 50 % VO2max when blood ketones were under 0.6 mM, and the rise vanished above 3–4 mM. In recovery, clearance fell below its pre-exercise value.',
          referenceIds: ['fery1986', 'fery1983'],
        },
      ],
      timeCourse:
        'At low levels the clearance half-life is about 20–25 minutes (derived from 2.9 %/min). At 3-day-fast levels it is about 46 minutes (1.5 %/min). At 24-day levels it is about 115 minutes (0.6 %/min). After a ketone-ester drink, the apparent half-life of BHB (β-hydroxybutyrate, the main blood ketone) is 0.8–3.1 h, which includes ongoing absorption.',
      moderators:
        'Uptake capacity scales with fat-free mass. Endurance training may raise the muscle enzymes and transporters that use ketones, but the support is animal data (2–3-fold higher oxidation in trained rat muscle), so it is not modelled.',
      grade: 'A',
      gradeReason:
        "Several human tracer studies agree on the shape of clearance; the saturating form and its half-saturation level are fitted (graded A− in Vitals' evidence review).",
      status: 'proposed-fit',
      caveats:
        'The half-saturation level, the urinary term and the exercise term are fitted to a handful of studies rather than measured directly. The steady-state ketone level in long fasts depends heavily on the fitted K_m.',
      referenceIds: [
        'owen1973',
        'balasse1979',
        'balasse1989',
        'fery1983',
        'fery1986',
        'clarke2012',
        'evans2017',
      ],
      relatedMetricIds: ['bhb', 'hoursInKetosis'],
    },
    {
      id: '05-hepatic-ketogenesis',
      title: 'How the liver decides to make ketones',
      category: 'fuel',
      summary:
        "The liver builds ketones from fatty acids that arrive from fat tissue. How much of that fat becomes ketones depends on how full the liver's carbohydrate store (glycogen) is and on how much insulin is around. Low glycogen and low insulin send more fat down the ketone route. Eating protein restrains it a little, and ketones already in the blood restrain it slightly too.",
      howModelled:
        'Production is the supply of fatty acids, times the share sent down the ketone route, times a small insulin brake, times a small protein brake. The share follows an S-shaped curve of liver glycogen, with its midpoint near 55 g of glycogen per 60 kg of fat-free mass. Fast and slow adaptation (see the two adaptation entries) raise it. The engine adds ketones from MCT oil or ketone drinks on top (see the MCT entry).',
      equation: `φ = [φ_min + (1 − φ_min)/(1 + (G_L/G50)^nG)] · (1 + a_h·A_f) · (1 + a_hs·A_s)
h(I) = 1/(1 + k_Ih · I)
π = exp(−k_prot · P_ew/90)
P_end = kP · FFM · (FFA + F_hep) · φ · h(I) · π
P_total = P_end + P_MCT + P_exo`,
      keyNumbers: [
        {
          label: 'Effect of fatty-acid supply on ketone production',
          value:
            'Raising plasma fatty acids from 0.32 to 1.4 mM raised production from 2.2 to 11.4 µmol·kg⁻¹·min⁻¹',
          note: 'Measured at clamped basal insulin and glucagon.',
          referenceIds: ['miles1983'],
        },
        {
          label: 'Production scale',
          value: 'kP = 0.010 mmol·min⁻¹·kg FFM⁻¹ per mM of fatty acids (±25 %)',
          note: 'Proposed fit to the fasting and diet targets. Cross-checks: after an overnight fast production is 1.5–3.6 µmol·kg⁻¹·min⁻¹; the starvation plateau in obese people is 1.0–1.9 mmol/min (Reichard 1974: at most about 150 g per 24 h; Balasse 1979: 1908 µmol/min). The model gives 1.84 mmol/min at day 24 in a 110 kg obese man.',
          referenceIds: ['miles1983', 'keller1988', 'reichard1974', 'balasse1979'],
        },
        {
          label: 'Fatty-acid supply from sources other than plasma',
          value: 'F_hep = 0.15 mM-equivalent (range 0.05–0.2)',
          note: 'Proposed fit. It stands for fat stored in the liver and fat from meal remnants, so that production is not switched off entirely after a carbohydrate load.',
          referenceIds: ['deru2024'],
        },
        {
          label: 'Smallest share of fat sent to ketones',
          value: 'φ_min = 0.12 (range 0.05–0.3)',
          note: 'Proposed fit.',
        },
        {
          label: 'Liver-glycogen midpoint and steepness',
          value: 'G50 = 55 g per 60 kg fat-free mass (range 40–65); nG = 2.5 (range 2–3)',
          note: 'Proposed fit to entry timing: 0.5 mM after about 21 h of fasting, and 0.9 mM at 30 h in men. It assumes liver glycogen falls by roughly 3–4.5 g/h early in a fast. That rate is derived from gluconeogenesis supplying 64 ± 5 % of glucose output over the first 22 h, which leaves glycogen breakdown at about 36 %.',
          referenceIds: ['deru2021', 'haymond1982', 'rothman1991'],
        },
        {
          label: 'Direct restraint by insulin',
          value: 'k_Ih = 0.15 per unit of insulin proxy (range 0–0.3)',
          note: 'At matched high fatty-acid levels, insulin of about 110 µU/mL cut production from 8.2 to 3.8 µmol·kg⁻¹·min⁻¹ compared with about 13 µU/mL. Contested: another study found no direct effect of insulin on the liver.',
          referenceIds: ['keller1988', 'miles1983'],
        },
        {
          label: 'Restraint by protein',
          value:
            'k_prot = 0.15 per 90 g/day protein (range 0–0.69); memory time τ_prot = 8 h (6–24 h, proposed)',
          note: "Hall's 2010 model uses 0.69, which halves ketone levels when protein is eaten during a fast. Diet data with 1.2–2.2 g/kg protein still gave 0.8–1.5 mM and fit a much weaker effect. The best joint fit is 0–0.15.",
          referenceIds: ['hall2010'],
        },
        {
          label: 'Boost from adaptation',
          value: 'a_h = 0.35 (0.2–0.5) for fast adaptation; a_hs = 0.5 (0.3–0.8) for slow adaptation',
          note: 'Both proposed fit. The first matches the rise of BHB over the first week of a very-low-carbohydrate diet. The second matches the continued rise over 2–3 weeks of fasting, with a plateau after about 17 days and total ketones of 6.8 mM at 24 days.',
          referenceIds: ['harvey2018', 'owen1969', 'owen1971'],
        },
        {
          label: 'Hall 2010 daily version',
          value:
            'ρ_K = 4.45 kcal/g, A_K = 0.8, K_K = 1, kP = kG = 0.69, baseline lipolysis 140 g/day; ketone excretion 0 below 70 g/day of ketogenesis, rising linearly to 20 g/day at 400 g/day; efficiency ε_k = 0.81',
          note: "This gives daily amounts only, with no blood level. It can be used to cross-check the integrated production (1 mmol total ketones ≈ 0.103 g, derived). Hall's earlier 2006 model has no ketone term.",
          referenceIds: ['hall2010', 'hall2006'],
        },
      ],
      timeCourse:
        'Production follows fatty-acid supply and glycogen within hours. The adaptation boosts build over days (fast adaptation, time constant 48 h) and over weeks (slow adaptation, time constant 120 h, which is 5 days).',
      moderators:
        'Fat-free mass (production scales with it), insulin resistance (which raises the insulin proxy), energy deficit (which raises fatty-acid supply), protein intake, and any ketones added from MCT oil or drinks. Insulin lowers ketones by three routes: it slows fat release, it restrains the liver directly, and it speeds use in tissues. Ketones in turn restrain their own production.',
      grade: 'B',
      gradeReason:
        'Human tracer studies clearly show the dependence on fatty acids and the feedback from ketones; the glycogen curve and most of its parameters are fitted.',
      status: 'proposed-fit',
      caveats:
        'The direct effect of insulin on the liver is contested. The protein effect is the biggest structural uncertainty. The glycogen curve inherits any bias in the carbohydrate module.',
      referenceIds: [
        'miles1983',
        'keller1988',
        'keller1989',
        'balasse1975',
        'reichard1974',
        'balasse1979',
        'deru2021',
        'deru2024',
        'haymond1982',
        'rothman1991',
        'harvey2018',
        'owen1969',
        'owen1971',
        'hall2010',
        'hall2006',
      ],
      relatedMetricIds: ['bhb', 'ketosisState'],
    },
    {
      id: '05-ffa-supply',
      title: 'Fatty acids released from fat tissue',
      category: 'fuel',
      summary:
        'Fat cells release fatty acids into the blood. They are called free fatty acids (FFA), or non-esterified fatty acids. Insulin is the main brake on that release. So the level rises as insulin falls in a fast or on a very-low-carbohydrate day, and it rises further in an energy deficit and during exercise. Ketones turn the release down slightly.',
      howModelled:
        'A target FFA level is set from the overnight baseline, the insulin brake, the energy deficit, exercise, any shortfall of muscle glycogen caused by exercise, and the ketone brake. The actual level then moves towards the target with a time constant of 1 hour when rising and 1.5 hours when falling.',
      equation: `lipo(I) = 1/(0.25 + 0.75 · I^1.2)   (= 1 at I = 1; 0.18 at I = 5; 1.8 at I = 0.47)
δ_M = max(0, (0.85·G_Mmax − G_M)/(0.85·G_Mmax))
FFA* = F0 · lipo(I) · (1 + e_def·d) · (1 + X_post) · (1 + k_mgF·δ_M) / (1 + TKB/K_FB)
X_post = ex_F·x during exercise; afterwards dX_post/dt = −X_post/τ_post
dFFA/dt = (FFA* − FFA)/τ_F   (τ_F = 1.0 h rising, 1.5 h falling)`,
      keyNumbers: [
        {
          label: 'Overnight-fasted level on a mixed diet',
          value: 'F0 = 0.50 mmol/L',
          note: 'Measured values: 0.44–0.52 mM, 0.51 mM and 0.6 mM in three studies.',
          referenceIds: ['rosenbaum2019', 'owen1971', 'mcdougal2018'],
        },
        {
          label: 'Fat release during a fast',
          value:
            'Glycerol release 2.08 → 4.36 and palmitate release 1.63 → 3.26 µmol·kg⁻¹·min⁻¹ from 12 to 72 h',
          note: 'Insulin fell from 64.6 to 30.1 pmol/L over the same time, 70 % of the fall within 24 h. Plasma FFA rose from 0.6 to 1.1 mM over 72 h in a separate study. The insulin-brake curve is a proposed fit to these data.',
          referenceIds: ['klein1993', 'mcdougal2018'],
        },
        {
          label: 'FFA on a very-low-carbohydrate diet',
          value:
            '0.76–0.84 mM versus 0.44–0.52 mM on the baseline diet, with fasting insulin about 20 % lower',
          referenceIds: ['rosenbaum2019'],
        },
        {
          label: 'Extra release in an energy deficit',
          value: 'e_def = 1.5',
          note: 'Proposed fit. It is needed to reproduce the higher ketone levels seen on reduced-energy diets than on maintenance-energy diets.',
          referenceIds: ['johnstone2008', 'hall2016', 'rosenbaum2019'],
        },
        {
          label: 'Ketone feedback on fat release',
          value: 'K_FB = 15 mmol/L total ketones',
          note: 'Raising ketones by 47–92 % in fasted obese people lowered FFA by 13.5 % and endogenous ketone production to 67–90 % of control. In the fed state, a ketone ester giving about 3 mM BHB lowered the FFA response to a glucose drink by 44 %, so the model under-predicts the acute antilipolytic effect of drinks.',
          referenceIds: ['balasse1975', 'myettecote2018'],
        },
        {
          label: 'Exercise effect on fat release',
          value: 'ex_F = 0.4; decays with time constant 3 h',
          note: 'Proposed fit to total ketones rising from 0.20 to 0.39 mM over 2 h at about 50 % VO2max, and by a further 0.73 mM 30 minutes into recovery.',
          referenceIds: ['fery1983'],
        },
        {
          label: 'Extra release when muscle glycogen is low',
          value: 'k_mgF = 3.0',
          note: 'Proposed fit and grade D. It lets trained athletes eating under 50 g carbohydrate a day with daily training reach about 1.2 mM, and lets exercise at the start of a fast bring ketosis forward by about 3.6 h.',
          referenceIds: ['burke2021', 'deru2021'],
        },
        {
          label: 'Response time',
          value: 'τ_F = 1.0 h rising, 1.5 h falling (proposed)',
          note: 'FFA fell from 1.07 to 0.61 mM over 4 h of continuous carbohydrate feeding after a 10–14-day fast.',
          referenceIds: ['gray1989'],
        },
      ],
      timeCourse:
        'FFA follows its target within an hour or two. During a fast, most of the fall in insulin happens in the first 24 h.',
      moderators:
        'Insulin (itself set by recent carbohydrate and protein), energy deficit, exercise intensity, how depleted muscle glycogen is, and blood ketone level.',
      grade: 'B',
      gradeReason:
        "The direction and size of the effects are well supported by human studies; the exact curve shapes are fitted (graded B− in Vitals' evidence review).",
      status: 'proposed-fit',
      caveats:
        'The insulin brake, the deficit term and the muscle-glycogen term are fitted to few studies. The model under-predicts how strongly ketone drinks switch off fat release.',
      referenceIds: [
        'rosenbaum2019',
        'owen1971',
        'mcdougal2018',
        'klein1993',
        'johnstone2008',
        'hall2016',
        'balasse1975',
        'myettecote2018',
        'fery1983',
        'burke2021',
        'deru2021',
        'gray1989',
      ],
      relatedMetricIds: ['bhb'],
    },
    {
      id: '05-glycogen-insulin-interface',
      title: 'Borrowing glycogen and insulin from the carbohydrate model',
      category: 'fuel',
      summary:
        'The ketone model needs three inputs at every step: liver glycogen, muscle glycogen and an insulin level. In the full engine these come from the carbohydrate part of the model. A simpler stand-in is included so the ketone model can run and be checked on its own. Because brain glucose demand stays roughly fixed while glycogen stores scale with lean mass, smaller bodies run out of glycogen sooner and reach ketosis earlier.',
      howModelled:
        "Vitals does not run this stand-in. Liver and muscle glycogen come from the carbohydrate topic's stores. Insulin comes from the shared meal-absorption model, but the ketone equations read it through the stand-in's own formula, because they were calibrated on it: a basal level that falls towards 45 % of the fasted value as liver glycogen empties (or along the measured fasting insulin curve, whichever is lower), plus jumps with carbohydrate and protein absorption, scaled up for insulin resistance.",
      equation: `I_b = 0.45 + 0.55 · min(1, G_L/(60·FFM/60))^0.5
I = IR · (I_b + 0.12·Ra_C + 0.04·Ra_P) · (1 − 0.3·x)
out_L = 4.5·G_L/(G_L+10)·max(0, 1 − Ra_C/10) + 30·x·G_L/(G_L+10)
m_L = 3.0 · δ_M · G_L/(G_L+10)
dG_L/dt = 0.30·Ra_C + 0.10·Ra_P − out_L − m_L,   0 ≤ G_L ≤ 100·FFM/60
dG_M/dt = 0.5·Ra_C·min(1, (G_Mmax − G_M)/(0.15·G_Mmax)) + m_L − 200·x²·G_M/G_Mmax,   G_Mmax = 400·FFM/60`,
      keyNumbers: [
        {
          label: 'Glycogen capacity in the stand-in',
          value: 'Liver 100 g and muscle 400 g per 60 kg of fat-free mass',
          note: 'The carbohydrate topic uses a liver capacity of about 115 g for a 1.45 L liver, about 35–60 g after an overnight fast and about 15–25 g after 24 h. That is the same order of magnitude. When the two are joined, the glycogen midpoint is expressed as 0.55 of capacity and the fasting targets are re-checked.',
        },
        {
          label: 'Four-day swap of carbohydrate for fat at equal energy and protein',
          value: 'Insulin −44 ± 6 %, glucagon +39 ± 10 %, glucose −16.5 %',
          referenceIds: ['fery1982'],
        },
        {
          label: 'Glucose production during a fast',
          value: '11.0 → 8.3 µmol·kg⁻¹·min⁻¹ from 12 to 72 h; fasting insulin about −50 % by 72 h',
          referenceIds: ['klein1993'],
        },
        {
          label: 'Share of glucose output from gluconeogenesis in a fast',
          value: '64 ± 5 % in the first 22 h, 82 % in the next 14 h, 96 % after that',
          referenceIds: ['rothman1991'],
        },
        {
          label: 'Fasting insulin on a very-low-carbohydrate diet',
          value: 'About −20 % (7.1–7.8 → 6.1 mIU/mL)',
          referenceIds: ['rosenbaum2019'],
        },
      ],
      timeCourse:
        'Liver glycogen falls over the first day of a fast and is refilled within hours of a carbohydrate meal. Muscle glycogen changes more slowly and mostly with training.',
      moderators:
        'Fat-free mass sets glycogen capacity. Insulin resistance (a multiplier on the insulin proxy, 1.0 for a lean insulin-sensitive person and 1.2–1.4 for someone obese or insulin-resistant) raises insulin at any given intake.',
      grade: 'C',
      gradeReason:
        'The stand-in is a crude substitute for the full carbohydrate model, tuned to reproduce the ketone targets.',
      status: 'proposed-fit',
      caveats:
        'This is a placeholder. When the carbohydrate module supplies glycogen and insulin, the ketone model should be re-tuned (only the production scale and the glycogen midpoint).',
      referenceIds: ['fery1982', 'klein1993', 'rothman1991', 'rosenbaum2019'],
      relatedMetricIds: [],
    },
    {
      id: '05-bhb-acac-and-diurnal-pattern',
      title: 'Reading ketones: BHB, acetoacetate and the daily swing',
      category: 'fuel',
      summary:
        'Blood holds two main ketones, BHB (β-hydroxybutyrate) and acetoacetate (AcAc). Finger-prick meters read BHB. Urine strips read only AcAc and are semi-quantitative. The BHB share rises as total ketones rise, and it is lower on a very-low-carbohydrate diet than in a fast. Blood BHB also swings across the day, following meals.',
      howModelled:
        'The engine tracks total ketones and splits them into BHB and AcAc with a ratio that grows with the total. It reports two numbers: BHB at 07:00 (or an hour before the first meal) and the 24-hour mean. The daily swing comes only from meal timing.',
      equation: `R = BHB/AcAc = 1.5 + 0.3 · TKB
BHB = TKB · R/(1 + R)
AcAc = TKB/(1 + R)`,
      keyNumbers: [
        {
          label: 'BHB and AcAc in fasting obese people (whole blood)',
          value:
            'Overnight 0.185 / 0.106 (ratio 1.75); 3 days 2.233 / 0.829 (ratio 2.7); 24 days 5.291 / 1.515 (ratio 3.5) mM',
          note: 'The ratio equation is a proposed fit to these three points.',
          referenceIds: ['owen1971'],
        },
        {
          label: 'Ratio on a very-low-carbohydrate diet at maintenance energy',
          value: 'AcAc 0.81–0.83 versus BHB 0.77 mM, a ratio of about 1',
          note: 'So the fitted ratio can be off by about ±40 % in diet-induced ketosis. In diabetic ketoacidosis the ratio rises from about 1:1 to as high as 10:1.',
          referenceIds: ['rosenbaum2019', 'laffel1999'],
        },
        {
          label: 'Daily pattern at week 6 of a stable very-low-carbohydrate diet',
          value: 'Lowest blood BHB 0.33 ± 0.17 mM at 10:00; highest 0.70 ± 0.62 mM at 03:00',
          note: '12 healthy adults eating 74 % fat, 19.5 % protein and 6.2 % carbohydrate. Urine ketones were detected most reliably at 07:00, 22:00 and 03:00, more than 90 % of the time.',
          referenceIds: ['urbain2016'],
        },
        {
          label: 'Model swing from trough to peak',
          value: 'About 2.3-fold, with morning fasting BHB about 40–60 % above the 24-hour mean',
          note: 'Trough 2–3 h after meals, peak at the end of the overnight fast. Most trials report morning fasting values, which therefore overstate the daily average.',
        },
      ],
      timeCourse: 'BHB bottoms out 2–3 hours after a meal and peaks at the end of the overnight fast.',
      moderators:
        'Meal timing and size, and how long the person has been in ketosis. The BHB share is higher in fasting ketosis than in diet-induced ketosis.',
      grade: 'C',
      gradeReason:
        'The ratio is fitted to one set of fasting data in obese people and may be about 40 % off in diet-induced ketosis (no separate grade was given; graded here from the evidence it describes).',
      status: 'proposed-fit',
      caveats:
        'Circadian (dawn) effects on fat release and ketone production are not modelled, so the daily pattern reflects meals only. BHB in diet-induced ketosis could be biased by about ±30 %.',
      referenceIds: ['owen1971', 'rosenbaum2019', 'laffel1999', 'urbain2016'],
      relatedMetricIds: ['bhb'],
    },
    {
      id: '05-fasting-ketosis-time-course',
      title: 'Ketones during a fast, hour by hour',
      category: 'fuel',
      summary:
        'After the last meal, blood ketones stay near 0.1–0.2 mmol/L for the first half-day. They reach 0.5 mmol/L after about 21 hours on average, then climb to roughly 2 mmol/L by day 3 and to a plateau of about 7 mmol/L over the following weeks. Women and lean people tend to rise faster than men and obese people, and children rise fastest.',
      howModelled:
        'No timetable is imposed. The curve emerges from the liver, fat-release and clearance entries working together as glycogen empties and insulin falls. The model is checked against published fasting data, and where it misses, the misses are listed below.',
      keyNumbers: [
        {
          label: 'BHB at 12 hours',
          value: '0.1 ± 0.0 mM (6 healthy men, BMI 20–27.9)',
          note: 'Model: 0.10.',
          referenceIds: ['mcdougal2018'],
        },
        {
          label: 'BHB after an overnight fast in obese adults',
          value: '0.185 ± 0.017 mM (whole blood, 8 people)',
          referenceIds: ['owen1971'],
        },
        {
          label: 'Time to reach 0.5 mM',
          value: '21 ± 3 h (20 adults, 11 men and 9 women, capillary blood)',
          note: 'Model: 23.3 h for men and 19.8 h for women.',
          referenceIds: ['deru2021'],
        },
        {
          label: 'BHB at 24 hours after a roughly 630 kcal dinner',
          value: '0.56 ± 0.28 mM (27 overweight or obese adults)',
          note: 'Model: 0.46 for an overweight person with insulin resistance factor 1.3.',
          referenceIds: ['deru2024'],
        },
        {
          label: 'BHB at 30 hours',
          value: 'Men 0.9 ± 0.2; women 1.7 ± 0.2; 6-year-old children 3.7 ± 0.4 mM',
          note: 'Model: men 0.99, women 1.28 (a miss of −25 %, inside the ±30 % tolerance). Children are not supported. Glucose was also lower in women (64 versus 72 mg/dL).',
          referenceIds: ['haymond1982'],
        },
        {
          label: 'BHB area under the curve over 36 hours',
          value: '19.19 ± 2.59 mmol·h/L (20 adults)',
          note: 'Model: 15.8 for men and 20.4 for women.',
          referenceIds: ['deru2021'],
        },
        {
          label: 'BHB at 48 hours, lean versus obese',
          value: 'Lean 3.7 mM; obese 1.9 mM (16 people in each group, capillary blood)',
          note: 'Model: lean man 1.87, obese person (insulin resistance factor 1.2) 1.50.',
          referenceIds: ['neudorf2025'],
        },
        {
          label: 'BHB at 72 hours',
          value: '2.3 ± 0.5 mM (6 men)',
          note: 'Model: 2.45. FFA rose from 0.6 to 1.1 mM.',
          referenceIds: ['mcdougal2018'],
        },
        {
          label: 'BHB and total ketones at 3 days in obese adults',
          value: 'BHB 2.23 ± 0.33 mM, total ketones 3.06 mM (8 people)',
          note: 'Model: 1.96.',
          referenceIds: ['owen1971'],
        },
        {
          label: 'Kinetics begin to plateau',
          value:
            'About day 5 in normal subjects; fatty acids, BHB and AcAc reach a plateau at about 17 days in obese subjects',
          referenceIds: ['balasse1989', 'owen1969'],
        },
        {
          label: 'BHB at 24 days in obese adults',
          value: 'BHB 5.29 ± 0.47 mM, AcAc 1.52 mM, total ketones 6.8 mM (8 people)',
          note: 'Model: 4.99 (total 6.44).',
          referenceIds: ['owen1971'],
        },
        {
          label: 'Plateau (from about 3 days in 23 obese subjects)',
          value:
            'Total ketones 7.09 ± 0.32 mM; production 1908 ± 80 µmol/min; urinary loss 167 ± 14 µmol/min',
          note: 'Model: total ketones 6.44 mM; production 1.84 mmol/min.',
          referenceIds: ['balasse1979'],
        },
        {
          label: 'Effect of exercise at the start of a fast',
          value:
            'Time to 0.5 mM 17.5 ± 1.7 h versus 21.1 ± 3.0 h; BHB area under the curve 27.5 versus 19.2 mmol·h/L',
          referenceIds: ['deru2021'],
        },
        {
          label: 'Older adults after a 24 h fast',
          value:
            'Overweight, sedentary adults over 50 reached 0.31 ± 0.21 mM after starting with an 84 g carbohydrate shake, versus 0.50 ± 0.28 after a 6 g shake (0.54 at 12 h)',
          note: 'A low-carbohydrate pre-fast meal brought ketosis forward by about 12 h in this group. The model over-predicts the 24 h values here (see caveats).',
          referenceIds: ['gipson2025'],
        },
        {
          label: 'Newborns and infants',
          value: 'Ketone flux of 17–21 µmol·kg⁻¹·min⁻¹',
          note: 'Far higher than in adults, which is one reason the model is not valid for children.',
          referenceIds: ['bougneres1986'],
        },
      ],
      timeCourse:
        'Ketones are near baseline for about 12 hours, cross 0.5 mM at about 21 hours, reach roughly 2 mM by 72 hours, and flatten from about day 5 with a slow further rise to a plateau near 17–24 days. Classic reviews of starvation physiology tell the same story.',
      moderators:
        'Sex (women rise faster), age (in one study, older adults reached only 0.31–0.50 mM after 24 h), adiposity and insulin resistance (obesity blunts fasting ketosis even though fatty acids rise similarly), what was eaten before the fast (a carbohydrate-heavy last meal delays ketosis), and exercise at the start of the fast.',
      grade: 'A',
      gradeReason:
        "Several controlled human studies agree on the time course; the moderator effects are graded B in Vitals' evidence review.",
      status: 'established',
      caveats:
        "The model captures only about 35–40 % of the sex difference (women 1.28 versus 1.7 mM observed at 30 h). An optional female multiplier of about 1.3 would close the gap but has no mechanistic source. It under-predicts children by about 2-fold and is not valid for them. It captures only part of the obesity effect (obese-to-lean ratio 0.68–0.80 at 48 h versus 0.51 observed). For older adults its 24 h values are too high and fail the tolerance. Cahill's classic reviews of starvation were used for context only.",
      referenceIds: [
        'mcdougal2018',
        'owen1971',
        'deru2021',
        'deru2024',
        'haymond1982',
        'neudorf2025',
        'balasse1989',
        'owen1969',
        'balasse1979',
        'gipson2025',
        'bougneres1986',
        'cahill1970',
        'cahill2006',
      ],
      relatedMetricIds: ['bhb', 'ketosisState', 'hoursInKetosis'],
    },
    {
      id: '05-very-low-carb-ketosis',
      title: 'Ketone levels on very-low-carbohydrate diets',
      category: 'fuel',
      summary:
        'When food is eaten, ketone levels stay well below fasting levels. Morning BHB on a very-low-carbohydrate diet at maintenance energy is typically about 0.5–1 mmol/L, against 2–5 mmol/L in a fast. Levels drop steeply as carbohydrate rises from about 20 to 125 g a day, and they rise when the person also eats less energy.',
      howModelled:
        'The dose-response is an output of the liver, fat-release and adaptation entries, not an input. It shows a soft threshold at roughly 50–100 g of carbohydrate a day, depending on body size and activity. A 25 % energy deficit raises BHB by about 1.6–1.8 times.',
      keyNumbers: [
        {
          label: 'Ward study, 4 weeks at 5 % of energy from carbohydrate',
          value:
            'Weeks 3–4 morning BHB 0.77 ± 0.49 and 0.77 ± 0.45 mM, versus 0.09–0.11 on the baseline diet',
          note: '17 men with BMI 25–35 in a metabolic ward. Carbohydrate was about 34 g/day at about 2,700 kcal (derived), protein 15 % (about 100 g). The diet was intended to match energy but there was an actual deficit of about 300 kcal/day. AcAc 0.81–0.83 mM and FFA 0.76–0.84 mM.',
          referenceIds: ['hall2016', 'rosenbaum2019'],
        },
        {
          label: 'Three-week trial at 5 %, 15 % and 25 % of energy from carbohydrate',
          value: 'Mean rise in BHB 0.62 ± 0.49, 0.41 ± 0.38 and 0.27 ± 0.32 mM',
          note: '77 healthy adults (25 men, 52 women) advised 1.4 g/kg protein, near-maintenance intake, daily waking capillary readings. Only the 5 % arm had a 95 % interval consistently at or above 0.5 mM; the 15 % and 25 % arms could reach a mean of 0.5 or more only sporadically.',
          referenceIds: ['harvey2019a'],
        },
        {
          label: 'Time to a mean of 0.5 mM',
          value:
            'Day 4 (sunflower-oil control) versus day 2 (MCT 3 × 30 mL/day); at 7 days 70 % versus 90 % were at or above 0.5 mM',
          note: '28 healthy adults, almost all women, 3–6 % of energy from carbohydrate (about 14–33 g, derived), 20 days. On day 1, 0 % versus 17 % had reached 0.5 mM; on day 2, 18 % versus 33 %.',
          referenceIds: ['harvey2018'],
        },
        {
          label: 'Stable diet, week 6',
          value: '24-hour range 0.33 mM (10:00) to 0.70 mM (03:00)',
          note: '12 healthy adults at 6.2 % of energy from carbohydrate, eating freely.',
          referenceIds: ['urbain2016'],
        },
        {
          label: 'Large deficit, eating freely',
          value: 'Plasma BHB 1.52 mM',
          note: '17 obese men in a residential study, 4 weeks at about 17 g carbohydrate (derived) and 30 % protein (about 130 g). They lost 6.34 kg. The model gives 0.98, a known under-prediction of about 35 %.',
          referenceIds: ['johnstone2008'],
        },
        {
          label: 'One day at 0 % carbohydrate, after exercise that lowered glycogen',
          value:
            'Next-morning BHB 1349 ± 653 µM, versus 332 ± 102 (30 % protein, 40 % carbohydrate) and about 230 (10 % protein, 60 % carbohydrate)',
          note: '23 normal-weight adults eating at energy balance. The model gives 0.54 mM, a known under-prediction.',
          referenceIds: ['veldhorst2010'],
        },
        {
          label: 'Elite walkers, 5–6 days under 50 g carbohydrate a day',
          value: 'Resting BHB 1.2 ± 0.79 mM (2 h after a meal); up to 1.7 ± 0.9 mM during a 25 km walk',
          note: '7 elite male race walkers, 2.2 g/kg protein, heavy training. Model: 1.04 mM.',
          referenceIds: ['burke2021'],
        },
        {
          label: 'One-year clinic programme in type 2 diabetes',
          value:
            'Laboratory BHB 0.17 → 0.54 ± 0.04 (70 days) → 0.31 ± 0.03 (1 year); 96 % had at least one home reading at or above 0.5 mM',
          note: '262 adults with BMI about 40, under 30 g/day carbohydrate typically, eating freely, losing 13.8 kg in a year.',
          referenceIds: ['hallberg2018'],
        },
        {
          label: 'Inpatient two-week trial at 10 % of energy from carbohydrate',
          value: 'Circulating ketones 3.01 versus 0.21 mM on a low-fat diet',
          note: 'Unverified. This is the value as reported in a later review; the primary value was not checked. 20 adults ate freely and took in 689 ± 73 kcal/day more on the low-carbohydrate diet.',
          referenceIds: ['hall2021', 'fernandezverdejo2023'],
        },
        {
          label: 'Twelve-week studies',
          value:
            'BHB 2.8–9.5-fold higher than controls in 12 trainees on a self-selected very-low-carbohydrate diet; weight −3.7 kg overall with no difference between 5 %, 15 % and 25 % carbohydrate arms',
          note: 'The trainee study is a small pilot and is not used quantitatively. Adherence was easier at 15–25 %.',
          referenceIds: ['kephart2018', 'harvey2019b'],
        },
        {
          label: 'Model, maintenance energy: morning / 24-hour mean BHB (mM) by net carbohydrate',
          value:
            '0 g: 0.71 / 0.53; 20 g: 0.67 / 0.45; 30 g: 0.64 / 0.43; 50 g: 0.59 / 0.37; 75 g: 0.51 / 0.31; 100 g: 0.43 / 0.25; 130 g: 0.33 / 0.18; 175 g: 0.10 / 0.06',
          note: 'Proposed. For an 80 kg adult with 62 kg fat-free mass, protein about 1.3 g/kg, three meals, week-4 values.',
        },
        {
          label: 'Model, 25 % energy deficit: morning / 24-hour mean BHB (mM)',
          value:
            '0 g: 1.26 / 0.92; 20 g: 1.11 / 0.74; 30 g: 1.04 / 0.68; 50 g: 0.91 / 0.56; 75 g: 0.74 / 0.44; 100 g: 0.60 / 0.34; 130 g: 0.44 / 0.24; 175 g: 0.14 / 0.07',
          note: 'Proposed.',
        },
        {
          label: 'Model, day of the first morning at or above 0.5 mM (maintenance / deficit)',
          value:
            '0 g: 2 / 1; 20 g: 2 / 2; 30 g: 2 / 2; 50 g: 3 / 2; 75 g: 8 / 3; 100 g: never / 4; 130 g and 175 g: never / never',
          note: 'Full fasting reaches 0.5 mM in about 20–25 h.',
        },
      ],
      timeCourse:
        'At under 30 g of carbohydrate a day and maintenance energy, morning BHB is about 0.3 mM on day 1 and about 0.5 mM on day 2. It then creeps up over 1–3 weeks as adaptation builds. In one trial, symptoms had eased by day 4–5 when mean BHB was 0.8–0.9 mM.',
      moderators:
        'Body size, activity level, energy deficit, carbohydrate amount, and protein (weakly). Low-carbohydrate adherence and measurement timing matter, because morning values run higher than the daily mean.',
      grade: 'B',
      gradeReason:
        'Several controlled trials agree; the dose-response between 50 and 130 g a day rests mainly on one randomised trial and on the model.',
      status: 'proposed-fit',
      caveats:
        "The dose-response table is the model's output, not a set of measurements. The model under-predicts two studies (large-deficit eating, 0.98 versus 1.52 mM; glycogen-lowering exercise day, 0.54 versus 1.35 mM). The two-week inpatient value is unverified.",
      referenceIds: [
        'hall2016',
        'rosenbaum2019',
        'harvey2019a',
        'harvey2019b',
        'harvey2018',
        'urbain2016',
        'johnstone2008',
        'veldhorst2010',
        'burke2021',
        'hallberg2018',
        'hall2021',
        'fernandezverdejo2023',
        'kephart2018',
      ],
      relatedMetricIds: ['bhb', 'hoursInKetosis', 'ketosisState', 'ketoAdaptation'],
    },
    {
      id: '05-protein-and-ketones',
      title: 'Does eating protein lower ketones?',
      category: 'fuel',
      summary:
        'Protein nudges insulin up and supplies carbon for making glucose, so in theory it should restrain ketone production. Studies of people eating 30 % of energy as protein, or 2.2 g/kg, still found blood ketones of 1.2–1.5 mmol/L. The effect of protein at a fixed low carbohydrate intake and fixed energy has not been isolated in a trial.',
      howModelled:
        'The engine keeps a running average of recent protein intake (memory of about 8 hours) and multiplies ketone production by a factor that falls gently as that average rises. The strength is set weak, because diet data fit a weak effect better than the strong one in an earlier published model.',
      equation: `π = exp(−k_prot · P_ew/90)      (P_ew = recent protein, g/day; k_prot = 0.15)`,
      keyNumbers: [
        {
          label: 'Model prediction: week-4 morning BHB at 30 g carbohydrate, maintenance energy',
          value: '60 g protein 0.74; 100 g 0.65; 140 g 0.59; 180 g 0.54 mM',
          note: 'About −25 % from 0.75 to 2.2 g/kg. Grade C; this is a model output, not a measurement.',
        },
        {
          label: "Strong version in Hall's published model",
          value: 'k_prot = 0.69, so a protein-modified fast halves ketone levels compared with fasting alone',
          referenceIds: ['hall2010'],
        },
        {
          label: 'Diets with 30 % protein',
          value: 'Blood ketones of 1.35–1.52 mM',
          referenceIds: ['veldhorst2010', 'johnstone2008'],
        },
        {
          label: 'Athletes eating 2.2 g/kg protein',
          value: '1.2 mM',
          referenceIds: ['burke2021'],
        },
        {
          label: 'Protein at 40 % carbohydrate',
          value: '30 % protein raised BHB slightly compared with 10 % protein (332 versus about 230 µM)',
          referenceIds: ['veldhorst2010'],
        },
        {
          label: 'Related finding on hormones',
          value: 'High-protein (35 % or more) low-carbohydrate diets lowered testosterone in a meta-analysis',
          note: 'Unrelated to ketones, but it shows that high-protein low-carbohydrate diets differ hormonally.',
          referenceIds: ['whittaker2022'],
        },
      ],
      timeCourse:
        'The protein memory in the model has a time constant of about 8 hours (plausible range 6–24 hours).',
      moderators: 'Carbohydrate intake, energy balance and how recently the protein was eaten.',
      grade: 'C',
      gradeReason:
        'Diet studies point to a weak effect and one published model assumes a strong one; no human trial isolates protein dose at fixed carbohydrate and energy.',
      status: 'contested',
      caveats:
        'This is the largest structural uncertainty for high-protein, low-carbohydrate regimens. The plausible strength of the protein effect ranges from none to the strong published value.',
      referenceIds: ['hall2010', 'veldhorst2010', 'johnstone2008', 'burke2021', 'whittaker2022'],
      relatedMetricIds: ['bhb'],
    },
    {
      id: '05-ketosis-exit-and-reentry',
      title: 'Leaving ketosis, and coming back',
      category: 'fuel',
      summary:
        "A carbohydrate meal raises insulin within about half an hour. Fat release falls, ketone production collapses, and blood ketones halve within about an hour because clearance carries on. Refilled glycogen then delays their return. The muscles' extra ability to burn fat fades much more slowly than the ketone level does.",
      howModelled:
        'Nothing special is added for exit. The insulin rise cuts fat release and production in the liver and muscle entries, while clearance continues. Re-entry after a short refeed takes about 2 days in the model, against 2–3 days for a first entry, mainly because liver glycogen must be drained again. The fast adaptation state decays only partly in that time.',
      keyNumbers: [
        {
          label: 'BHB after a fast broken with a shake (27 overweight or obese adults)',
          value: 'Water only 0.56 ± 0.28 → 0.63 ± 0.31 → 0.70 ± 0.42 → 0.85 mM at 24, 25, 28 and 38 h',
          note: 'Every shake supplied 25 % of daily energy (about 629 ± 103 kcal).',
          referenceIds: ['deru2024'],
        },
        {
          label: 'High-carbohydrate, low-fat shake',
          value: '0.59 ± 0.28 → 0.28 ± 0.19 → 0.19 ± 0.16 → 0.44 ± 0.28 mM at 24, 25, 28 and 38 h',
          note: '70 % carbohydrate as dextrose (about 110 g, derived), 20 % casein protein, 10 % fat. It halved BHB in 1 hour and took it to about a third of its starting level by 4 hours. 14 hours later BHB had recovered to about 75 % of the pre-shake value, still under 0.5 mM on average.',
          referenceIds: ['deru2024'],
        },
        {
          label: 'Low-carbohydrate, high-fat shake',
          value: '0.53 ± 0.29 → 0.44 ± 0.16 → 0.38 ± 0.16 → 0.51 ± 0.27 mM at 24, 25, 28 and 38 h',
          note: '10 % carbohydrate, 20 % protein, 70 % fat, half of it MCT powder.',
          referenceIds: ['deru2024'],
        },
        {
          label: 'Model against those data (insulin resistance factor 1.3)',
          value: 'High-carbohydrate 0.46 → 0.18 → 0.09 → 0.46; low-carbohydrate 0.46 → 0.46 → 0.39 → 0.84 mM',
          note: 'The model is about 10–20 percentage points too fast at 1–4 h, and it over-predicts recovery after the low-carbohydrate shake. Its tolerance is ±0.15 mM.',
        },
        {
          label: 'Model prediction: one 100 g carbohydrate lunch in a fat-adapted person',
          value:
            '0.44 → 0.19 (1 h) → 0.11 (3 h) → 0.23 (6 h) → 0.31 (12 h) mM; next morning 0.48, back to 0.61 by day 2',
          note: 'Proposed. For an 80 kg person after 4 weeks under 30 g/day, morning BHB 0.66 mM. No direct human data were found.',
        },
        {
          label: 'Model prediction: one full high-carbohydrate day (300 g)',
          value:
            'Next morning 0.18; day 2 0.46; day 3 0.59 mM (about 90 % of the pre-refeed level); fast adaptation falls from 0.97 to 0.59',
          note: 'Proposed. No direct human data were found.',
        },
        {
          label: 'Model prediction: weekly cycle of 5 days at 30 g and 2 days at 350 g',
          value:
            'Each low-carbohydrate block: 0.11 → 0.35 (day 1) → 0.55 (day 2) → 0.58–0.61 (days 3–5); refeed mornings 0.11–0.13; fast adaptation swings between 0.34 and 0.89',
          note: 'Proposed. No direct human data were found.',
        },
        {
          label: 'Trial of a cycled pattern in trained young men',
          value:
            '5 days at 30 g or less carbohydrate (1.6 g/kg protein), 2 days at 8–10 g/kg, −500 kcal/day, 8 weeks',
          note: 'Weight loss was similar to a balanced reduction diet. There were no strength or endurance gains and a small loss of lean mass and body water. Ketone levels were not reported.',
          referenceIds: ['kysel2020'],
        },
        {
          label: 'How long the extra fat-burning ability lasts after carbohydrate returns',
          value: 'Still elevated after 24 h of high carbohydrate; back to baseline after 5–6 days',
          referenceIds: ['burke2021', 'carey2001', 'stellingwerff2006'],
        },
      ],
      timeCourse:
        "Ketone levels halve within about an hour of a large carbohydrate load, because clearance has a half-life of 20–30 minutes at levels under 2 mmol/L. They stay low for several hours. After a single refeed day, the model returns to about 90 % of the previous level in about 3 days. The muscles' fat-burning adaptation persists for more than 24 h after carbohydrate is restored.",
      moderators:
        'Size of the carbohydrate load, fat and MCT content of the meal, degree of adaptation, and body size.',
      grade: 'C',
      gradeReason:
        'Exit rests on one well-controlled crossover trial plus tracer physiology (grade B), but re-entry and cycling are model extrapolation with no human ketone data (C/D), so the entry as a whole is graded C.',
      status: 'proposed-fit',
      caveats:
        'Every number for re-entry and for cyclical patterns is a model prediction. The model exits ketosis faster than the crossover trial did and over-predicts recovery after the low-carbohydrate shake.',
      referenceIds: ['deru2024', 'kysel2020', 'burke2021', 'carey2001', 'stellingwerff2006'],
      relatedMetricIds: ['hoursInKetosis', 'ketosisState', 'ketoAdaptation', 'bhb'],
    },
    {
      id: '05-exercise-and-ketones',
      title: 'Exercise and blood ketones',
      category: 'fuel',
      summary:
        'Exercise changes ketones in different ways depending on how high they already are. When ketones are low, exercise raises production and clearance, and ketones rise in the hour after you stop. When ketones are already high, exercise lowers them a little. Exercise at the start of a fast brings ketosis forward by a few hours.',
      howModelled:
        'Exercise adds to fat release while it lasts and for a few hours after (time constant 3 hours), lowers insulin, speeds ketone clearance when ketones are low, and slows it for 2 hours afterwards. It also drains liver and muscle glycogen, which raises the share of fat sent to ketones.',
      keyNumbers: [
        {
          label: 'Two hours at about 50 % of VO2max after an overnight fast',
          value:
            'Ketone turnover +125 %; total ketones 0.20 → 0.39 mM; a further +0.73 mM within 30 min of stopping',
          note: 'Model: 0.17 → 0.51 → 0.91 mM.',
          referenceIds: ['fery1983'],
        },
        {
          label: 'Exercise when ketones are low or high',
          value:
            'Under 0.6 mM: production and clearance up 40–50 %. The stimulus wanes above 2.5 mM and is abolished or reversed above 3–4 mM',
          referenceIds: ['fery1986', 'fery1988'],
        },
        {
          label: 'Exercise after 3 or more days of fasting',
          value:
            'Total ketones fall by about 20 % (production −22 %, uptake +30 % at first); the share of CO2 output coming from ketones fell from 17.6 % to 10.1 %',
          note: 'Exercise energy comes mainly from other fuels.',
          referenceIds: ['balasse1978'],
        },
        {
          label: 'Share of exercise energy from ketones',
          value: '2–10 % after an overnight fast; negligible above 2.5 mM of fasting ketosis',
          referenceIds: ['evans2017'],
        },
        {
          label: 'Ketosis after exercise',
          value: 'Generally 0.3–2.0 mM depending on intensity, duration, fitness and nutrition',
          note: 'It is blunted, not abolished, in trained people, and abolished by carbohydrate eaten beforehand (as reviewed from earlier work).',
          referenceIds: ['evans2017', 'johnson1972', 'johnson1969'],
        },
        {
          label: 'Exercise at the start of a 36 h fast',
          value:
            'Time to 0.5 mM shortened by 3.6 h (95 % interval −2.1 to 10.9); BHB area under the curve +43 %',
          referenceIds: ['deru2021'],
        },
        {
          label: 'One carbohydrate-free, 30 % protein day after glycogen-lowering exercise',
          value: 'Next-morning BHB 1.35 mM',
          note: 'The model gives 0.54 mM, a known under-prediction.',
          referenceIds: ['veldhorst2010'],
        },
        {
          label: 'Lean subjects in a 36 h chamber',
          value:
            'Fat oxidation adjusted to fat intake only when glycogen had first been lowered by exhaustive exercise',
          referenceIds: ['schrauwen1997'],
        },
        {
          label: 'Trained athletes on a very-low-carbohydrate diet',
          value: '1.2 mM at rest and up to 1.7 mM in a 25 km walk after 5–6 days',
          note: 'Model: 1.04 mM.',
          referenceIds: ['burke2021'],
        },
        {
          label: 'Model: sedentary adult starting under 30 g/day with 1 h/day at 65 % VO2max',
          value:
            'Mornings 0.37, 0.68, 0.84, 1.0, 1.15 mM (days 1–5), against 0.32, 0.52, 0.56, 0.58, 0.60 without exercise',
          note: 'Proposed. For a 36 h fast the model gives 22.2 h to reach 0.5 mM without exercise and 18.7 h with a 1 h bout at 65 % of VO2max.',
        },
      ],
      timeCourse:
        'Ketones rise during exercise if they start low and can rise further for about half an hour afterwards. Extra fat release fades with a time constant of about 3 hours. Clearance is slowed for 2 hours after exercise.',
      moderators:
        'Starting ketone level, intensity and duration, fitness (post-exercise ketosis is blunted in trained people), and prior carbohydrate feeding (which abolishes it).',
      grade: 'B',
      gradeReason:
        "The direction and acute size of the effects are well supported; the multi-day interaction between exercise and diet is graded C in Vitals' evidence review.",
      status: 'proposed-fit',
      caveats:
        'Exercise and glycogen coupling rests on fitted terms. The model under-predicts the glycogen-lowering exercise day (0.54 versus 1.35 mM).',
      referenceIds: [
        'fery1983',
        'fery1986',
        'fery1988',
        'balasse1978',
        'evans2017',
        'johnson1972',
        'johnson1969',
        'deru2021',
        'veldhorst2010',
        'schrauwen1997',
        'burke2021',
      ],
      relatedMetricIds: ['bhb'],
    },
    {
      id: '05-fast-fat-adaptation',
      title: 'Muscles learn to burn more fat (fast adaptation)',
      category: 'fuel',
      summary:
        'After a few days on very little carbohydrate, muscle burns much more fat and much less carbohydrate. The liver also becomes better at making ketones. This shift is nearly complete within 5–6 days and is lost again in about the same time when carbohydrate returns. The price is a slightly higher oxygen cost at hard effort.',
      howModelled:
        "A single adaptation state between 0 and 1 moves towards a target set by how much carbohydrate was absorbed over the last 24 hours. It rises with a time constant of 48 hours and falls with 40 hours. It shifts the fuel mix towards fat at rest and in exercise, cuts the muscle glycogen used during exercise, raises the liver's ketone output and adds a little to the oxygen cost of hard exercise. It is the only fat-adaptation state in the engine.",
      equation: `f_C = 4·C24 / max(EI24, 500)
A_f* = 1/(1 + (f_C/0.20)³)
dA_f/dt = (A_f* − A_f)/τ,  τ = 48 h if A_f* > A_f, otherwise 40 h
Effects: hepatic share × (1 + 0.35·A_f); max fat oxidation × (1 + 1.3·A_f);
max carbohydrate oxidation at high intensity × (1 − 0.3·A_f); O₂ cost above 75 % VO2max × (1 + 0.07·A_f)`,
      keyNumbers: [
        {
          label: 'Elite race walkers after 5–6 days under 50 g carbohydrate a day',
          value:
            'Fat oxidation up by more than 200 %, mean about 1.43 g/min; oxygen cost +8 % and +5 % at 50 km and 20 km race speeds',
          referenceIds: ['burke2021'],
        },
        {
          label: 'Three weeks under 50 g carbohydrate a day (78 % fat)',
          value: 'Peak fat oxidation 1.57 ± 0.32 g/min at about 80 % of VO2peak',
          note: '10 km performance did not improve on this diet (the high-carbohydrate group improved 6.6 % and the periodised-carbohydrate group 5.3 %).',
          referenceIds: ['burke2017'],
        },
        {
          label:
            'Ultra-endurance runners on 10 % carbohydrate for 20 months, versus high-carbohydrate runners',
          value:
            'Peak fat oxidation 1.54 ± 0.18 versus 0.67 ± 0.14 g/min, at 70.3 ± 6.3 versus 54.9 ± 7.8 % of VO2max; submaximal 1.21 versus 0.76 g/min (88 versus 56 % of energy)',
          note: 'Resting muscle glycogen and its change after exercise (−64 % after 180 min, −36 % after 120 min of recovery) were similar between the groups.',
          referenceIds: ['volek2016'],
        },
        {
          label: 'Time course on a high-fat diet that did not produce ketosis (69 % fat)',
          value:
            'Shift from carbohydrate to fat burning within 5–10 days, not enhanced further to 15 days; muscle glycogen oxidation 1.5 → 1.0 g/min',
          note: 'The enzyme CAT rose from 0.45 to 0.54 µmol/g/min by day 10.',
          referenceIds: ['goedecke1999'],
        },
        {
          label: 'After 24 h of high carbohydrate',
          value:
            'Fat oxidation still elevated; carbohydrate oxidation only 61 % and 78 % of baseline at race-relevant speeds; back to baseline after 5–6 days of high carbohydrate',
          referenceIds: ['burke2021'],
        },
        {
          label: '6 days of fat adaptation then 1 day of carbohydrate',
          value: 'Respiratory ratio 0.78 versus 0.85; fat oxidation 171 versus 119 g during 4 h of cycling',
          referenceIds: ['carey2001'],
        },
        {
          label: 'What changes in muscle after 5 days of fat plus 1 day of carbohydrate',
          value:
            'PDH activity lower (1.69 versus 2.39 mmol·kg wet weight⁻¹·min⁻¹), glycogen breakdown lower, HSL +20 %',
          note: 'PDH is the enzyme that lets carbohydrate-derived fuel enter the energy cycle; HSL is the enzyme that releases fat inside cells.',
          referenceIds: ['stellingwerff2006'],
        },
        {
          label: 'Four weeks of a diet very low in carbohydrate in trained cyclists',
          value:
            'Endurance time 147 → 151 min at 62–64 % of VO2max; respiratory quotient 0.83 → 0.72; glucose oxidation 15.1 → 5.1 mg/kg/min; muscle glycogen use 0.61 → 0.13 mmol/kg/min',
          referenceIds: ['phinney1983'],
        },
        {
          label: 'Cyclists on a long-term low-carbohydrate diet (over 8 months)',
          value:
            'Lower glucose production and liver glycogen breakdown in exercise (6.0 versus 7.8 mg/kg/min); gluconeogenesis unchanged (2.8 versus 2.5)',
          referenceIds: ['webster2016'],
        },
        {
          label: 'Time constants check',
          value:
            'τ_up = 48 h gives 92 % adaptation at 5 days; τ_down = 40 h leaves about 55 % after 24 h and 5 % at 5 days',
          note: 'These match the persistence and full reversal seen in the race-walker data.',
          referenceIds: ['burke2021', 'goedecke1999'],
        },
      ],
      timeCourse:
        'Adaptation is about 92 % complete after 5 days at very low carbohydrate. It fades with a half-life of roughly a day: about 55 % remains after 24 hours of carbohydrate, and about 5 % after 5 days.',
      moderators:
        'Carbohydrate intake over the last 24 hours relative to energy intake (half-way point at about 100 g/day in the calibration), training status, and how long the adaptation has lasted.',
      grade: 'B',
      gradeReason:
        'The time constants are backed by several human studies (B), but the size of the effects on exercise metabolism is supported more thinly (C).',
      status: 'proposed-fit',
      caveats:
        'Effect multipliers (for fat oxidation, carbohydrate oxidation and oxygen cost) are fitted to a few athlete studies and are graded C. The performance findings come mostly from elite walkers and runners and may not carry over to other people.',
      referenceIds: [
        'burke2021',
        'burke2017',
        'volek2016',
        'goedecke1999',
        'carey2001',
        'stellingwerff2006',
        'phinney1983',
        'webster2016',
      ],
      relatedMetricIds: ['ketoAdaptation', 'fatOxidation', 'bhb'],
    },
    {
      id: '05-slow-ketone-adaptation',
      title: 'Muscle spares ketones in long fasts (slow adaptation)',
      category: 'fuel',
      summary:
        'In fasts lasting weeks, muscle takes up progressively fewer ketones and relies on fatty acids instead, which leaves ketones for the brain. It is not clear whether this is a true adaptation or simply saturated uptake at high ketone levels. It appears to matter only when ketones stay high for a long time, not in the mild ketosis of eating very little carbohydrate.',
      howModelled:
        "A second adaptation state rises when total ketones stay above 0.5 mM and reaches its maximum near 2.5 mM. It moves with a time constant of 120 hours. When it is high it lowers ketone clearance by up to 35 % and raises the liver's ketone share by up to 50 %.",
      equation: `A_s* = clamp((TKB − 0.5)/2.0, 0, 1)
dA_s/dt = (A_s* − A_s)/120 h
Effects: clearance × (1 − 0.35·A_s); hepatic share × (1 + 0.5·A_s)`,
      keyNumbers: [
        {
          label: 'Forearm muscle extraction of ketones at overnight, 3-day and 24-day fasts',
          value: 'AcAc 40 % → 25 % → 11 %; BHB 12 % → 4 % → net release',
          note: 'Fatty acids became the main muscle fuel by 24 days.',
          referenceIds: ['owen1971'],
        },
        {
          label: 'Clearance in fasted versus acutely infused people at the same level',
          value: '35 % lower in the fasted',
          referenceIds: ['balasse1979'],
        },
        {
          label: 'When the plateau is reached',
          value: 'Only after about 17 days',
          referenceIds: ['owen1969'],
        },
        {
          label: 'Model on a maintenance-energy very-low-carbohydrate diet (about 1 mM)',
          value: 'A_s stays at about 0.1 or below',
          note: 'So the ketone-sparing effect is essentially a prolonged-fasting phenomenon.',
        },
      ],
      timeCourse:
        'The state builds with a time constant of 120 hours (5 days) and needs ketones held above 0.5 mM to grow. Plateaus in ketones and fatty acids appear only after about 17 days of fasting.',
      moderators:
        'Blood ketone level and how long it has stayed high. The evidence is from obese people fasting for weeks.',
      grade: 'C',
      gradeReason:
        'The evidence comes from prolonged fasting in obese subjects, and its interpretation (true adaptation or saturation) is disputed.',
      status: 'contested',
      caveats:
        'Balasse and Féry attribute most of the fall in clearance to saturation of muscle uptake, with hormones playing only a minor part. Claims that muscle ketone sparing occurs in nutritional ketosis are not supported by the human tracer data that could be located (grade D).',
      referenceIds: ['owen1971', 'balasse1979', 'owen1969', 'balasse1989'],
      relatedMetricIds: ['bhb'],
    },
    {
      id: '05-brain-ketone-use',
      title: "How much of the brain's fuel is ketones",
      category: 'fuel',
      summary:
        'The brain runs mostly on glucose but can burn ketones too. The more ketones are in the blood, the more of its energy they supply, and the more glucose it needs to find elsewhere. Uptake into the brain is limited by transport, so use rises about in proportion to blood level over the 0.7–1.7 mM range. Even a mild rise from MCT oil supplies a measurable share.',
      howModelled:
        'The share of brain energy from ketones is a saturating function of total blood ketones with a ceiling of 70 %. The carbohydrate part of the model reduces its brain glucose demand by the same share.',
      equation: `f_brain_ket = 0.70 · TKB/(TKB + 1.5)
brain glucose demand × (1 − f_brain_ket)`,
      keyNumbers: [
        {
          label: 'Mild ketosis from MCT oil',
          value: 'Mean total ketones 0.29 mM gave an estimated 8–9 % of brain energy',
          referenceIds: ['courchesneloyer2013'],
        },
        {
          label: 'Four days of a diet very low in carbohydrate, with an 8-fold rise in ketones',
          value:
            "Acetoacetate supplied 17 % and total ketones about 33 % of brain energy; the brain's ketone uptake rate (CMRa) correlated with plasma ketones (r = 0.93)",
          referenceIds: ['courchesneloyer2017'],
        },
        {
          label: 'Acute rise in ketones',
          value:
            'Cerebral ketone use rose nearly in proportion to plasma ketones over 0.7–1.7 mM, with transport the limiting step',
          referenceIds: ['blomqvist2002'],
        },
        {
          label: 'After 5–6 weeks of starvation',
          value: 'Ketones the predominant brain fuel',
          note: 'The frequently quoted 60–70 % share is unverified here.',
          referenceIds: ['owen1967'],
        },
      ],
      timeCourse:
        'Brain use follows the blood level within hours and needs no separate build-up in the model.',
      moderators:
        "Blood ketone level and the brain's glucose demand. Brain ketone use appears to move inversely with brain glucose use.",
      grade: 'C',
      gradeReason:
        'A few small human imaging and tracer studies show the relationship, but the fitted curve extrapolates beyond them.',
      status: 'proposed-fit',
      caveats:
        'The curve is a proposed fit to the MCT, four-day and acute-infusion studies. The 60–70 % share often quoted for starvation could not be verified.',
      referenceIds: ['courchesneloyer2013', 'courchesneloyer2017', 'blomqvist2002', 'owen1967'],
      relatedMetricIds: ['fatOxidation', 'choOxidation'],
    },
    {
      id: '05-very-slow-adaptation',
      title: 'A months-long drift in muscle glycogen and glucose tolerance',
      category: 'fuel',
      summary:
        'On a very-low-carbohydrate diet lasting many months, muscle glycogen returns to normal levels. Glucose tolerance may also worsen after more than six months. This is an optional, speculative extra layer, and it would only shift where the carbohydrate part of the model sets its glycogen target.',
      howModelled:
        'It is not part of the core model. If added, it would be a third adaptation state with a time constant of about 4 weeks, acting only on the muscle-glycogen target in the carbohydrate module.',
      keyNumbers: [
        {
          label: 'Muscle glycogen after long-term low-carbohydrate eating',
          value: 'Normalises',
          note: 'Seen in ultra-endurance runners who had eaten this way for 20 months (range 9–36).',
          referenceIds: ['volek2016'],
        },
        {
          label: 'Glucose tolerance after more than 6 months',
          value: 'May worsen',
          note: 'As summarised by Burke 2021 from Webster 2020; the primary study was not checked.',
          referenceIds: ['burke2021'],
        },
        {
          label: 'Suggested time constant',
          value: 'About 4 weeks',
        },
      ],
      timeCourse: 'Suggested time constant of about 4 weeks, acting over months.',
      moderators: 'Not established.',
      grade: 'D',
      gradeReason: 'Speculative: one small athlete study and a second-hand summary of another.',
      status: 'proposed-fit',
      caveats:
        'The time constant and effect size are suggestions rather than fitted values. The glucose-tolerance finding was not verified from the primary paper.',
      referenceIds: ['volek2016', 'burke2021'],
      relatedMetricIds: [],
    },
    {
      id: '05-mct-and-exogenous-ketones',
      title: 'MCT oil and ketone drinks',
      category: 'fuel',
      summary:
        'MCT oil is made of medium-chain fats that go straight to the liver, where they are turned into ketones quickly. Ketone drinks deliver ketones directly. Both raise blood ketones within an hour without any change in what the body is doing with its own fat. Chronic effects of MCT oil on morning ketone levels are less certain.',
      howModelled:
        'The engine converts the grams of the medium-chain fats C8 (caprylic) and C10 (capric) into ketones with fixed yields, spread over 1–1.2 hours after the dose. The yield is halved when a large meal was eaten in the last 3 hours. Ketone drinks are added as an absorbed pool that peaks at 0.5 hours fasted or 0.75 hours fed, and salts count for only half (the D-form registers on meters).',
      equation: `P_MCT = m_meal · (0.5 · 6.37 · Ra_C8 + 0.17 · 5.41 · Ra_C10) / 60   [mmol total ketones/min; Ra in g of triglyceride per hour]
m_meal = 0.5 if a meal over 50 g in the previous 3 h, else 1
P_exo = absorbed D-BHB (mmol/min) · (1.0 fasted; 0.75 fed);  salts count 50 %`,
      keyNumbers: [
        {
          label: 'Yield of ketones per fatty acid',
          value:
            'C8 0.5 and C10 0.17 mol total ketones per mol; 6.37 and 5.41 mmol fatty acid per g of tricaprylin and tricaprin',
          note: 'The last two are derived from molecular weights of 470.7 and 554.8.',
        },
        {
          label: 'Relative ketogenic strength',
          value:
            'C8 about 3 times C10, about 6 times C12; the ketone response is about twice as high without a meal',
          referenceIds: ['stpierre2019'],
        },
        {
          label: 'Two 20 mL doses of C8 (one with breakfast, one 4 h later without lunch)',
          value:
            'Day-long mean total ketones +295 ± 155 µM above control; coconut oil peaked at +200 µM (25 % of the C8 peak)',
          note: 'Model: +0.29 mM.',
          referenceIds: ['vandenberghe2017'],
        },
        {
          label: '20 to 30 g/day MCT in 4 doses for 4 weeks',
          value: 'Total ketones peaked at 476 µM, day mean 290 µM',
          referenceIds: ['courchesneloyer2013'],
        },
        {
          label: '48 g MCT versus 45 g of ordinary fat',
          value: 'BHB about 0.6 mM versus no change',
          note: 'As reported in a review.',
          referenceIds: ['fernandezverdejo2023'],
        },
        {
          label: 'MCT 3 × 30 mL/day added to a very-low-carbohydrate diet',
          value:
            'Morning BHB +0.2 ± 0.7 mM (days 1–6) and +0.8 ± 0.7 mM (days 7–19); stomach pain more frequent',
          note: 'The model gives only +0.10, a known miss.',
          referenceIds: ['harvey2018'],
        },
        {
          label: 'Tolerance',
          value:
            'Doses of 50–60 g caused stomach upset in 100 % of those tested; about 30 g per dose is usually tolerated',
          note: 'The 50–60 g result comes from earlier work cited in the Harvey 2018 paper.',
          referenceIds: ['harvey2018'],
        },
        {
          label: 'Ketone ester, about 12 or about 24 g of BHB',
          value:
            'Peak D-BHB 2.8 mM (ester) versus 1.0 mM (salts); back to baseline in 3–4 h; food lowers the peak by 33 % (2.2 versus 3.3 mM); under 1.5 % of the dose lost in urine',
          referenceIds: ['stubbs2017'],
        },
        {
          label: 'Ketone ester at 140, 357 and 714 mg/kg',
          value: 'Peak BHB 3.30 mM and AcAc 1.19 mM at 714 mg/kg within 1–2 h; BHB half-life 0.8–3.1 h',
          referenceIds: ['clarke2012'],
        },
        {
          label: 'Ketone ester 0.45 mL/kg, 30 min before a 75 g glucose test',
          value: 'BHB 3.2 ± 0.6 mM within 30 min; glucose area under the curve −17 %; fatty-acid area −44 %',
          referenceIds: ['myettecote2018'],
        },
        {
          label: 'Ketone ester 1.9 kcal/kg',
          value:
            'BHB 0.2 → 3.3 mM at 60 min; lower ghrelin, hunger and desire to eat 1.5 h later than with a dextrose drink',
          referenceIds: ['stubbs2018'],
        },
        {
          label: 'Ketone ester in athletes',
          value:
            'Decreased muscle glycolysis and plasma lactate; increased fat oxidation inside muscle, even with carbohydrate taken at the same time',
          referenceIds: ['cox2016'],
        },
        {
          label: 'Model: 25 g BHB ester taken fasted',
          value: '2.08 (0.5 h) → 3.26 (1 h) → 1.95 (2 h) → 0.28 (4 h) mM',
          note: 'Fed, the model lowers the peak by 58 %, which is too strong against the 33 % measured.',
        },
      ],
      timeCourse:
        'MCT ketones peak within about 1–1.2 hours of the dose. Ketone-ester BHB peaks within 30–60 minutes and is back to baseline in 3–4 hours.',
      moderators:
        'Which fatty acids the oil contains (C8 is the most ketogenic), whether food is eaten with it, dose, and whether a drink is an ester or a salt.',
      grade: 'B',
      gradeReason:
        'The blood-level behaviour of ketone drinks and MCT oil is well characterised in human trials; the chronic effect of MCT oil is less certain.',
      status: 'established',
      caveats:
        'The model reproduces acute MCT results but not the chronic rise in morning BHB seen in one trial (+0.8 versus +0.1 mM). The fed-state reduction for ketone esters is too strong, and the model under-predicts how strongly a ketone drink switches off fat release.',
      referenceIds: [
        'stpierre2019',
        'vandenberghe2017',
        'courchesneloyer2013',
        'fernandezverdejo2023',
        'harvey2018',
        'stubbs2017',
        'clarke2012',
        'myettecote2018',
        'stubbs2018',
        'cox2016',
      ],
      relatedMetricIds: ['bhb', 'ketosisState'],
    },
    {
      id: '05-transition-symptoms',
      title: 'The first week: transition symptoms and water loss',
      category: 'fuel',
      summary:
        'In the first days of cutting carbohydrate, some people feel unwell: headache, tiredness, nausea, dizziness, muscle cramps or "brain fog". This is often called the "keto flu". Reports peak in week 1 and fade after about 4 weeks. Glycogen loss and falling insulin also make the body shed sodium and water, so weight drops quickly at first.',
      howModelled:
        "Vitals does not use this index. Its induction-symptom score comes from the transitions topic's model instead: it starts when carbohydrate drops below about 50 g a day, peaks after a few days and then fades, is larger for bigger drops in carbohydrate and smaller when sodium intake is adequate. Each fresh switch to very low carbohydrate starts it again.",
      equation: `KetoFlu(t) = S_max · A_trans(t) · (1 − BHB_n)
A_trans = max(0, A_f − A_f(t − 72 h))
BHB_n = min(1, BHB/0.8)`,
      keyNumbers: [
        {
          label: 'Reported time to resolution in an online-forum analysis',
          value: 'Resolved between days 3 and 30 (median 4.5, IQR 3–15; 8 users)',
          note: 'Severity: mild 15/60, moderate 23/60, severe 22/60 users. Low-quality evidence.',
          referenceIds: ['bostock2020'],
        },
        {
          label:
            'Symptom score change in a randomised trial at 5 %, 15 % and 25 % of energy from carbohydrate',
          value: '+1.49 ± 2.47, +0.65 ± 2.70 and +0.18 ± 3.3 (p = 0.26)',
          note: 'Headache, constipation, diarrhoea, bad breath, cramps, weakness and light-headedness rose slightly; sugar and starch cravings and bloating improved.',
          referenceIds: ['harvey2019a'],
        },
        {
          label: 'When symptoms eased',
          value: 'By day 4 (MCT) to day 5 (control), when mean BHB was 0.8–0.9 mM',
          referenceIds: ['harvey2018'],
        },
        {
          label: 'Water stored with glycogen',
          value: '3–4 g water per g of glycogen and 0.45 mmol potassium per g',
          note: 'So glycogen loss gives rapid early weight loss and reloading gives rapid regain.',
          referenceIds: ['kreitzman1992'],
        },
        {
          label: 'Drivers of sodium loss in fasting',
          value: 'The fall in insulin is the key driver; glucagon enhances renal ketone and sodium loss',
          note: 'The magnitudes in mmol/day could not be extracted from primary texts and are owned by the fibre, hydration and substances topic (unverified here). One older paper was cited without its data.',
          referenceIds: ['kolanowski1981', 'veverbrants1969'],
        },
      ],
      timeCourse:
        'Symptom reports peak in week 1 and dwindle after 4 weeks. In the model the peak is at day 2–3 and most people are clear by day 5–7.',
      moderators:
        'How quickly carbohydrate is cut, how steadily the new pattern is kept, and how quickly ketones rise.',
      grade: 'C',
      gradeReason:
        'The symptom evidence is a forum analysis and one trial with non-significant differences, and the symptom index is proposed by Vitals.',
      status: 'proposed-fit',
      caveats:
        'The symptom index formula is proposed. The sodium figures were not verified. Cycling between low- and high-carbohydrate days restarts the transition each time.',
      referenceIds: [
        'bostock2020',
        'harvey2019a',
        'harvey2018',
        'kreitzman1992',
        'kolanowski1981',
        'veverbrants1969',
      ],
      relatedMetricIds: [],
    },
    {
      id: '05-ketosis-and-appetite',
      title: 'Does ketosis itself reduce appetite?',
      category: 'hormones',
      summary:
        'Reviews suggest that diets very low in carbohydrate lower hunger and the desire to eat, mostly by preventing the usual rise in appetite during weight loss. The absolute changes are small. Two well-controlled free-eating trials disagree about whether people on such diets end up eating less. A ketone drink can lower hunger and the hunger hormone ghrelin for a couple of hours.',
      howModelled:
        "Ketosis never changes the intake Vitals simulates. It lowers the hunger score through the hormones-and-appetite topic's rule: once blood ketones have stayed raised for several days, overall hunger pressure is damped by an amount that grows with the ketone level.",
      equation: `hunger × (1 − 0.15 · min(1, BHB/1.0))`,
      keyNumbers: [
        {
          label: 'Meta-analysis of hunger ratings before versus during ketosis',
          value:
            'Very-low-energy diets: less hunger, more fullness; very-low-carbohydrate diets: less hunger and lower desire to eat; changes described as small',
          note: 'The pooled values in millimetres were not accessible (unverified).',
          referenceIds: ['gibson2015'],
        },
        {
          label: 'Inpatient free-eating crossover, 2 weeks',
          value:
            'A low-fat diet led to 689 ± 73 kcal/day less intake than an animal-based diet very low in carbohydrate (544 ± 68 in week 2)',
          referenceIds: ['hall2021'],
        },
        {
          label: 'Residential free-eating crossover in obese men, 4 weeks',
          value:
            '7.25 versus 7.95 MJ/day on the very-low-carbohydrate (4 % carbohydrate, 30 % protein) versus a 35 % carbohydrate diet; lower hunger; weight −6.34 versus −4.35 kg',
          referenceIds: ['johnstone2008'],
        },
        {
          label: 'Ketone ester drink',
          value: 'Lower ghrelin, hunger and desire to eat 1.5 h later than dextrose',
          referenceIds: ['stubbs2018'],
        },
        {
          label: 'Model hunger term',
          value: 'Hunger × (1 − 0.15·min(1, BHB/1.0))',
          note: 'Proposed, and handed to the hormones and appetite topic.',
        },
      ],
      timeCourse:
        'A ketone drink acts within 1.5 hours. Diet effects on hunger appear over the first weeks of weight loss.',
      moderators:
        'Energy balance, protein share, and whether the person is losing weight, since the main benefit is to blunt the usual rise in hunger.',
      grade: 'C',
      gradeReason: 'A meta-analysis with unverified pooled values and two free-eating trials that conflict.',
      status: 'contested',
      caveats:
        'The two free-eating crossover trials point in opposite directions about intake. The engine therefore never changes intake for ketosis.',
      referenceIds: ['gibson2015', 'hall2021', 'johnstone2008', 'stubbs2018'],
      relatedMetricIds: ['hunger'],
    },
    {
      id: '05-ketosis-and-protein-sparing',
      title: 'Does ketosis spare muscle protein?',
      category: 'body',
      summary:
        'Infusing ketones into people who had fasted for weeks lowered their nitrogen loss and their breakdown of the amino acid leucine. But in a ward study, a very-low-energy diet that produced ketosis led to more nitrogen loss than a matched diet without ketosis. Protein dose mattered more than ketosis.',
      howModelled:
        'In fed diets the engine gives no muscle-protein credit or penalty for ketosis at matched protein and energy, and the extra nitrogen loss of the first 1–2 weeks of carbohydrate withdrawal is not modelled. In water-only fasts, the extended-fasting model lets protein loss ease as ketones rise, and a ketone drink taken during a fast lowers it further.',
      keyNumbers: [
        {
          label: 'Sodium BHB infusion in people fasted for 5–10 weeks',
          value: 'Plasma alanine −21–37 %; urinary nitrogen −30 %',
          referenceIds: ['sherwin1975'],
        },
        {
          label: 'BHB infusion',
          value: 'Leucine oxidation about −30 %; muscle protein synthesis about +10 %',
          referenceIds: ['nair1988'],
        },
        {
          label:
            'Very-low-energy diet with versus without ketosis, at equal protein and energy (600 kcal, 8 g nitrogen/day, 4 weeks, metabolic ward)',
          value: 'Nitrogen balance −50.4 ± 4.4 versus −18.8 ± 5.7 g over 4 weeks',
          note: 'More negative with ketosis.',
          referenceIds: ['vazquez1992'],
        },
        {
          label: 'Isocaloric very-low-carbohydrate diet',
          value: 'Coincided with more protein use and loss of fat-free mass',
          referenceIds: ['hall2016'],
        },
        {
          label: 'Protein dose at 500 kcal for 3 weeks',
          value:
            '1.5 g/kg gave a nitrogen balance of 0 g/day; 0.8 g/kg plus 0.7 g/kg carbohydrate gave −2 g/day',
          note: 'Protein dose mattered more than ketosis.',
          referenceIds: ['hoffer1984'],
        },
      ],
      timeCourse: 'The extra nitrogen loss is transient, in weeks 1–2 of carbohydrate withdrawal.',
      moderators: 'Protein dose and energy intake matter more than ketone level.',
      grade: 'B',
      gradeReason:
        'Controlled human studies exist on both sides, and the most direct comparison at matched protein shows no benefit.',
      status: 'contested',
      caveats:
        'Ketone infusions do reduce protein breakdown in long fasts, so the direction depends on the setting. The engine ignores the infusion effect at matched protein because the ward comparison showed the opposite.',
      referenceIds: ['sherwin1975', 'nair1988', 'vazquez1992', 'hall2016', 'hoffer1984'],
      relatedMetricIds: [],
    },
    {
      id: '05-ketosis-and-energy-expenditure',
      title: 'Does low-carbohydrate eating burn extra energy?',
      category: 'energy',
      summary:
        'Controlled trials find that cutting carbohydrate at the same calories raises energy expenditure by a small amount, roughly 50–150 kcal a day. This is mostly a short-lived effect over the first two weeks. A larger effect reported in one long trial is contested on methodological grounds.',
      howModelled:
        "Not modelled as a separate term: Vitals adds no temporary rise in expenditure when carbohydrate is withdrawn. Expenditure differs only through the thermic effect of the foods eaten (fat costs less to process than carbohydrate or protein) and through ketones lost in urine, which count as energy not used. The body-weight model's 0.81 ketone-efficiency factor is not used.",
      keyNumbers: [
        {
          label: 'Ward study of an isocaloric very-low-carbohydrate diet',
          value:
            'Chamber energy expenditure +57 ± 13 kcal/day; sleeping +89 ± 14; doubly labelled water +151 ± 63 kcal/day; respiratory quotient −0.111',
          note: 'Body-fat loss slowed.',
          referenceIds: ['hall2016'],
        },
        {
          label: 'Chamber energy expenditure over time',
          value: 'About +100 kcal/day over the first 2 weeks, then back to baseline',
          note: 'As summarised in a later review.',
          referenceIds: ['fernandezverdejo2023'],
        },
        {
          label: 'Meta-analysis of 32 isocaloric feeding studies',
          value: 'Energy expenditure +26 kcal/day and fat loss +16 g/day with lower-fat diets',
          referenceIds: ['hall2017'],
        },
        {
          label: 'Weight-maintenance randomised trial',
          value:
            '+52 kcal/day per 10 % decrease in carbohydrate (95 % CI 23–82); 20 % versus 60 % carbohydrate +209 kcal/day (91–326)',
          note: 'Intention-to-treat result. The doubly labelled water method used has been challenged.',
          referenceIds: ['ebbeling2018', 'hall2019'],
        },
        {
          label: 'Efficiency of ketone production',
          value: 'ε_k = 0.81',
          referenceIds: ['hall2010'],
        },
        {
          label: 'Energy lost as ketones in urine',
          value: 'About 0.46 kcal per mmol',
          note: 'Derived by Vitals from 4.45 kcal/g × 0.104 g/mmol.',
          referenceIds: ['hall2010'],
        },
      ],
      timeCourse: 'Any extra expenditure is transient, over about 2 weeks, then decays towards zero.',
      moderators: 'Size of the carbohydrate cut, measurement method, and length of the study.',
      grade: 'B',
      gradeReason:
        'Several controlled studies and a meta-analysis exist, but the size and permanence of the effect are contested.',
      status: 'contested',
      caveats:
        'The +209 kcal/day trial finding is disputed on how energy expenditure was measured. The engine adds neither value.',
      referenceIds: ['hall2016', 'fernandezverdejo2023', 'hall2017', 'ebbeling2018', 'hall2019', 'hall2010'],
      relatedMetricIds: [],
    },
    {
      id: '05-ketosis-and-fat-loss-at-equal-energy',
      title: 'Does ketosis speed fat loss at equal calories?',
      category: 'body',
      summary:
        'When calories and protein are matched, restricting carbohydrate raises fat burning but does not increase fat lost from the body. In the tightest test, cutting fat lost more body fat than cutting carbohydrate over 6 days. Pooled across studies, lower-fat diets came out slightly ahead.',
      howModelled:
        'The engine gives ketosis no fat-loss advantage at equal energy and protein. In the very short term, the model leaves a small disadvantage in place.',
      keyNumbers: [
        {
          label: 'Six days of restricted carbohydrate versus restricted fat at equal energy',
          value: '53 ± 6 g/day of body fat lost versus 89 ± 6 g/day',
          note: 'Carbohydrate restriction increased fat oxidation but did not increase fat lost.',
          referenceIds: ['hall2015'],
        },
        {
          label: 'Pooled result across isocaloric feeding studies',
          value: 'About +16 g/day of fat loss favouring lower-fat diets',
          referenceIds: ['hall2017'],
        },
      ],
      timeCourse: 'The controlled ward comparison lasted 6 days.',
      moderators: 'Whether energy and protein are matched. The finding applies only when both are equal.',
      grade: 'A',
      gradeReason:
        "A tightly controlled ward study and a meta-analysis agree (graded A− in Vitals' evidence review).",
      status: 'established',
      caveats:
        'The differences are small and short-term. Trials that let people eat freely are a separate question, addressed in the appetite entry.',
      referenceIds: ['hall2015', 'hall2017'],
      relatedMetricIds: [],
    },
    {
      id: '05-fat-balance-and-oxidation',
      title: 'Fat absorption, storage and fat balance',
      category: 'energy',
      summary:
        'About 95 % of dietary fat is absorbed, and it is stored at almost no energy cost. The body burns a mix of fuels, and fat is the residual fuel: what remains of energy needs after carbohydrate, protein and alcohol have been accounted for. Adding fat to a meal does not by itself make the body burn more of it. Fat burning shifts towards fat intake slowly, over days.',
      howModelled:
        'Fat oxidation is worked out as the energy left over after the other fuels. Because the engine already computes carbohydrate burning from glycogen, the slow shift towards a higher-fat intake emerges by itself and does not need a separate time constant.',
      equation: `FatBalance_day = FatAbsorbed + DNL_fat − FatOx
FatOx (kcal/day) = TEE − CarbOx − ProtOx − AlcoholOx − KetoneLoss_urine
Ketone flux counts inside FatOx (ketones derive from fatty acids).`,
      keyNumbers: [
        {
          label: 'Absorption of dietary long-chain fat',
          value: 'About 95 %',
          note: 'An energy-conversion convention. The exact coefficient is unverified here.',
          referenceIds: ['southgate1970'],
        },
        {
          label: 'Adding 106 ± 6 g/day of fat (987 kcal) for 36 hours',
          value: '24 h energy expenditure 2,783 versus 2,820 kcal; fat oxidation 1,032 versus 1,042 kcal/day',
          note: 'Energy balance correlated with fat balance (r = 0.96), not carbohydrate balance.',
          referenceIds: ['schutz1989'],
        },
        {
          label: 'Day 7 of a high-fat versus a high-carbohydrate diet',
          value:
            'Carbohydrate oxidation matched intake (slope 0.99); fat oxidation against fat intake had a slope of only 0.50',
          note: 'The fat effect was seen in lean people only, and not in obese people.',
          referenceIds: ['thomas1992'],
        },
        {
          label: 'Time to shift towards diet composition',
          value: 'Substrate oxidation shifts rapidly within 7 days',
          referenceIds: ['hill1991'],
        },
        {
          label: 'Switch from 37 % to 50 % fat for 4 days',
          value: 'Positive fat balance, predicted by insulin and VO2max',
          referenceIds: ['smith2000a'],
        },
        {
          label: 'Concurrent physical activity (1.8 versus 1.4 × RMR)',
          value: 'Sped the fall in 24 h respiratory quotient',
          referenceIds: ['smith2000b'],
        },
        {
          label: 'Glycogen-lowering exercise before a fat increase',
          value: 'Fat oxidation matched fat intake within a 36 h chamber stay',
          referenceIds: ['schrauwen1997'],
        },
        {
          label: 'Fat oxidation shift after a rise in fat share (proposed fit)',
          value:
            'τ_FO ≈ 3–5 days in sedentary lean adults; about 1 day after glycogen-depleting exercise; incomplete (slope about 0.5 at 7 days) in obese or insulin-resistant people',
          referenceIds: ['flatt1995'],
        },
      ],
      timeCourse:
        'Fat oxidation moves towards fat intake over about 3–5 days in sedentary lean adults, about 1 day after glycogen-depleting exercise, and only incompletely in people with obesity or insulin resistance.',
      moderators: 'Glycogen status, activity, insulin sensitivity and body fat.',
      grade: 'A',
      gradeReason:
        "Multiple controlled human studies support the fat-balance physiology (graded A− in Vitals' evidence review); the adaptation time constant is graded C.",
      status: 'established',
      caveats:
        'The 3–5 day time constant is a proposed fit. Fat oxidation is regulated mainly by the carbohydrate economy, and it adjusts to fat intake only as fat-balance errors accumulate.',
      referenceIds: [
        'southgate1970',
        'schutz1989',
        'flatt1995',
        'thomas1992',
        'hill1991',
        'smith2000a',
        'smith2000b',
        'schrauwen1997',
      ],
      relatedMetricIds: ['fatOxidation', 'fatMass'],
    },
    {
      id: '05-postprandial-lipaemia',
      title: 'Blood fat after a meal, and where meal fat goes',
      category: 'cardio',
      summary:
        "After a meal containing fat, blood triglycerides (the main fat in blood) rise for a few hours, peak at about 3.5 hours and return to baseline by about 8 hours. Fat from a meal is taken up preferentially by fat tissue and muscle. Women store a bigger share of a meal's fat in under-skin fat than men.",
      howModelled:
        "Not modelled hour by hour: Vitals' triglyceride output is the lipids topic's slowly changing blood level, and no after-meal rise is drawn. Meal fat enters the blood through the shared gut-absorption model and is counted as energy.",
      equation: `ΔTG(t) = 0.01 mmol·L⁻¹·g⁻¹ × fat_g × k(t)
k(t): shape-3 gamma curve normalised to peak 1 at 3.5 h, back to baseline by about 8 h`,
      keyNumbers: [
        {
          label: 'Triglycerides after habitual meals',
          value: 'Maximal mean change +0.3 mmol/L at 1–6 hours',
          referenceIds: ['nordestgaard2016'],
        },
        {
          label: 'Standard fat-tolerance test (75 g fat, 25 g carbohydrate, 10 g protein)',
          value: 'A single sample at 4 h is representative; desirable peak at or below 2.5 mmol/L',
          referenceIds: ['kolovou2011'],
        },
        {
          label: 'Model rise in triglycerides',
          value: 'About +0.3 mM for a 30 g fat meal; +0.75 mM for the 75 g test',
          note: 'Proposed.',
        },
        {
          label: 'Share of meal fat found in under-skin fat after 24 hours',
          value: 'Women 38 ± 3 %; men 24 ± 3 %',
          referenceIds: ['romanski2000'],
        },
        {
          label: 'Uptake of meal fat',
          value:
            'Fat from the meal (in chylomicrons) is taken up preferentially by fat tissue and muscle rather than from plasma fatty acids',
          referenceIds: ['bickerton2007'],
        },
        {
          label: 'Abdominally obese men',
          value:
            'Markedly impaired storage of meal fat in fat tissue, a possible driver of fat in other organs',
          referenceIds: ['mcquaid2011'],
        },
        {
          label: 'Fat tissue as a buffer',
          value:
            'It buffers the daily flow of fat by suppressing fatty-acid release and trapping fatty acids from circulating fat',
          referenceIds: ['frayn2002'],
        },
        {
          label: "Effect of one meal's fat on the next meal",
          value: 'Qualitative only',
          note: 'The size of this "second-meal" effect is unverified.',
        },
      ],
      timeCourse:
        'Triglycerides rise over 1–6 hours after a meal, peak at about 3.5 hours, and are back to baseline by about 8 hours.',
      moderators:
        "Fat load, sex (women store more of a meal's fat under the skin), and abdominal obesity (which impairs storage).",
      grade: 'C',
      gradeReason:
        'Consensus statements and physiology studies support the shape of the response; the size per gram of fat is a proposed fit.',
      status: 'proposed-fit',
      caveats:
        'The triglyceride kernel is proposed. The size of any carry-over from one meal to the next is unverified.',
      referenceIds: [
        'nordestgaard2016',
        'kolovou2011',
        'romanski2000',
        'bickerton2007',
        'mcquaid2011',
        'frayn2002',
      ],
      relatedMetricIds: [],
    },
    {
      id: '05-max-fat-oxidation',
      title: 'The most fat you can burn during exercise',
      category: 'performance',
      summary:
        'During exercise, fat burning peaks at moderate intensity, around half of maximum aerobic capacity. Healthy adults peak at about 0.5–0.6 g/min, women slightly higher per kg of lean mass. People adapted to very low carbohydrate can reach more than double that.',
      howModelled:
        "Not modelled as a separate limit. During exercise the carbohydrate topic's rules set how much carbohydrate is burned, from glycogen, insulin and the fast adaptation state, and fat covers the rest of the energy need. There is no lean-mass, sex or training-status term for peak fat burning.",
      equation: `MFO (g/min) = 0.0078 · FFM · s_sex · (1 + 0.3·Fit) · (1 + 1.3·A_f)
s_sex = 0.95 (male) or 1.06 (female); Fit is training status from 0 to 1`,
      keyNumbers: [
        {
          label: '300 healthy adults',
          value:
            '7.8 ± 0.13 mg·kg FFM⁻¹·min⁻¹ at 48.3 ± 0.9 % of VO2max; men 7.4 versus women 8.3; peak intensity 45 versus 52 % of VO2max',
          note: 'Body fatness was not a predictor.',
          referenceIds: ['venables2005'],
        },
        {
          label: '1,121 athletes',
          value: '0.59 ± 0.18 g/min (range 0.17–1.27) at 49.3 ± 14.8 % of VO2max; men 0.61, women 0.50 g/min',
          referenceIds: ['randell2017'],
        },
        {
          label: 'Adapted to very low carbohydrate',
          value: '1.43–1.57 g/min',
          referenceIds: ['volek2016', 'burke2017', 'burke2021'],
        },
      ],
      timeCourse:
        'Adaptation towards higher fat oxidation takes about 5–6 days and reverses in about the same time when carbohydrate returns.',
      moderators: 'Sex, lean mass, training status and carbohydrate adaptation.',
      grade: 'B',
      gradeReason:
        "Large human datasets give the baseline; the adaptation multiplier rests on smaller athlete studies (Vitals' evidence review is inconsistent here: A/B in one place, B/C in another).",
      status: 'proposed-fit',
      caveats:
        'The training and adaptation multipliers are proposed. The baseline is supported by large datasets.',
      referenceIds: ['venables2005', 'randell2017', 'volek2016', 'burke2017', 'burke2021'],
      relatedMetricIds: [],
    },
    {
      id: '05-fat-mobilisation-ceiling',
      title: 'A ceiling on how fast body fat can be released',
      category: 'body',
      summary:
        'At rest and during fasting, fat release from fat cells doubles between 12 and 72 hours. There is also an upper limit on how fast energy can be drawn from the fat store when someone eats far too little. Deficits beyond it are covered partly by fat-free tissue.',
      howModelled:
        'The engine does not cap energy taken from fat. When the 7-day deficit passes three-quarters of about 69 kcal per kg of fat per day, it shows a caution instead, and the partition model keeps splitting the loss between fat and lean tissue as usual.',
      keyNumbers: [
        {
          label: 'Fat release in fasting',
          value: 'Glycerol release 2.08 → 4.36 µmol·kg⁻¹·min⁻¹ from 12 to 72 hours',
          note: 'Equivalent to about 190 → 400 g of triglyceride per day for a 75 kg person (derived).',
          referenceIds: ['klein1993'],
        },
        {
          label: 'Upper limit of energy transfer from the fat store in hypophagia',
          value: '290 ± 25 kJ per kg of fat per day (about 69 kcal per kg of fat per day)',
          note: 'The kcal figure is derived. Deficits beyond this deplete fat-free mass.',
          referenceIds: ['alpert2005'],
        },
      ],
      timeCourse: 'Fat release roughly doubles across a 12–72 h fast.',
      moderators: 'Amount of body fat and depth of the energy deficit.',
      grade: 'C',
      gradeReason:
        'One published analysis supports the ceiling (no separate grade was given; graded here from the evidence it describes).',
      status: 'established',
      caveats: 'In the engine the ceiling only triggers a caution (see the body-weight models topic).',
      referenceIds: ['klein1993', 'alpert2005'],
      relatedMetricIds: [],
    },
    {
      id: '05-essential-fatty-acids',
      title: 'Essential fats the body cannot make',
      category: 'fuel',
      summary:
        'Two fats, linoleic acid (an omega-6) and alpha-linolenic acid (an omega-3), cannot be made by the body and must come from food. Official adequate-intake values are set for each. Vitals checks them indirectly, through average fat intake.',
      howModelled:
        'Vitals does not track linoleic or alpha-linolenic acid separately. Its micronutrient check flags essential fats when the 7-day average of total fat is low, and more strongly when fat stays very low for several weeks. Averaging over a week means a single low day does not trigger the check.',
      keyNumbers: [
        {
          label: 'Adequate intake of linoleic acid',
          value: '17 g/day (men); 12 g/day (women)',
          referenceIds: ['iom2005'],
        },
        {
          label: 'Adequate intake of alpha-linolenic acid',
          value: '1.6 g/day (men); 1.1 g/day (women)',
          referenceIds: ['iom2005'],
        },
      ],
      moderators: 'Sex: the adequate intakes are higher for men than for women.',
      grade: 'A',
      gradeReason: 'Official reference values, though they were confirmed only through a secondary citation.',
      status: 'established',
      caveats: 'The values were confirmed via a secondary citation rather than the primary report.',
      referenceIds: ['iom2005'],
      relatedMetricIds: [],
    },
    {
      id: '05-fat-soluble-nutrient-absorption',
      title: 'Fat helps absorb some vitamins and plant pigments',
      category: 'fuel',
      summary:
        'Fat in a meal helps the gut absorb fat-soluble compounds such as vitamin E and carotenoids. The amount needed depends on the compound. A salad with no oil gives negligible carotenoid absorption, and more oil gave more absorption.',
      howModelled:
        'Absorption itself is not modelled. The micronutrient check shows a flag when meals contain very little fat.',
      keyNumbers: [
        {
          label: 'Meal with 3 g versus 36 g of fat',
          value:
            'No difference in vitamin E (+20 % versus +23 %) or alpha- and beta-carotene response; lutein-ester response 88 % versus 207 %',
          referenceIds: ['roodenburg2000'],
        },
        {
          label: 'Salads with different amounts of oil',
          value: '0 g of oil gave negligible carotenoid absorption; 6 g gave less than 28 g of canola oil',
          referenceIds: ['brown2004'],
        },
      ],
      moderators: 'Which compound, and how much fat comes with the meal.',
      grade: 'B',
      gradeReason: 'Controlled human studies show the effect, though only for a few compounds.',
      status: 'established',
      caveats: 'Different compounds respond differently to the amount of fat.',
      referenceIds: ['roodenburg2000', 'brown2004'],
      relatedMetricIds: [],
    },
    {
      id: '05-gallstones-in-rapid-loss',
      title: 'Gallstones during rapid weight loss on very little fat',
      category: 'body',
      summary:
        'The gallbladder empties when fat is eaten. On very-low-calorie diets with almost no fat, it empties rarely and gallstones can form. In small trials, diets that included a meal with about 10 g of fat produced no gallstones. This is mainly a concern with deficits producing more than about 1 kg of loss a week.',
      howModelled:
        "The rule described here (a flag when the deficit would cause more than about 1 kg of loss a week and fat falls below 12 g/day or there is no meal with at least 10 g of fat) is not applied as written. The engine's gallstone-related warnings come from the safety topic: a caution when average fat is low, a stronger warning when fat stays under 10 g a day for a week, and separate warnings when loss exceeds 1.5 kg a week or total loss becomes large. The Planner keeps at least one meal a day with 10 g of fat or more during larger deficits.",
      keyNumbers: [
        {
          label: 'Very-low-calorie diets with 3.0 g versus 12.2 g fat/day (535–577 kcal, 3 months)',
          value: 'Gallstones in 6/11 (54.5 %) versus 0/11',
          referenceIds: ['festi1998'],
        },
        {
          label:
            '520 kcal with under 2 g fat/day versus 900 kcal with 30 g fat/day including one 10 g fat meal',
          value: 'Gallstones in 4/6 versus 0/7',
          referenceIds: ['gebhard1996'],
        },
        {
          label: 'Meta-analysis of randomised trials',
          value:
            'Higher-fat weight-loss diets RR 0.09 (95 % CI 0.01–0.61); ursodeoxycholic acid RR 0.33 (0.18–0.60)',
          referenceIds: ['stokes2014'],
        },
        {
          label: 'Very-low-calorie diet (500 kcal) versus low-calorie diet (1,200–1,500 kcal)',
          value: 'Symptomatic gallstones HR 3.4 (1.8–6.3); 152 versus 44 per 10,000 person-years',
          referenceIds: ['johansson2014'],
        },
        {
          label: 'Engine rule',
          value:
            'Where loss exceeds about 1 kg a week, at least 1 meal a day with 10 g of fat or more and at least 12 g of fat a day',
          note: 'Proposed from the first two studies above.',
          referenceIds: ['festi1998', 'gebhard1996'],
        },
      ],
      timeCourse:
        'In the small trial with 3 g of fat a day, gallstones formed within 3 months of a very-low-calorie diet.',
      moderators: 'Depth of energy deficit and fat content of meals.',
      grade: 'B',
      gradeReason:
        "Small trials and a meta-analysis agree on the direction; the rule itself is proposed (graded B− in Vitals' evidence review).",
      status: 'established',
      caveats: "The trials were small, and the engine's numerical rule is proposed rather than tested.",
      referenceIds: ['festi1998', 'gebhard1996', 'stokes2014', 'johansson2014'],
      relatedMetricIds: [],
    },
    {
      id: '05-low-fat-testosterone',
      title: 'Very low fat intake and testosterone in men',
      category: 'hormones',
      summary:
        'One meta-analysis found that men eating low-fat diets had lower testosterone than men eating higher-fat diets. A more recent meta-analysis found no significant difference. The two disagree, and both note low certainty.',
      howModelled:
        'At most a small effect: total testosterone drops 5–10 % when fat is below 20 % of energy for 4 or more weeks. The hormone part of the model owns the detail.',
      keyNumbers: [
        {
          label: 'Low-fat versus high-fat diets (6 studies, n = 206)',
          value:
            'Total testosterone SMD −0.38 (95 % CI −0.75 to −0.01); free testosterone −0.37 (−0.63 to −0.11); DHT −0.30; −0.52 in European and North American men',
          note: 'A corrigendum was later published and its content was not reviewed.',
          referenceIds: ['whittaker2021'],
        },
        {
          label: 'Low-fat (30 % of energy or less) versus high-fat diets (11 randomised trials, n = 888)',
          value: 'No significant difference in testosterone, oestradiol, SHBG and others; low certainty',
          referenceIds: ['soltani2025'],
        },
        {
          label: 'Model effect (proposed)',
          value: 'Total testosterone −5 to −10 % when fat is under 20 % of energy for 4 weeks or more',
        },
      ],
      timeCourse: 'The model effect applies after 4 or more weeks of fat under 20 % of energy.',
      moderators:
        'Region of the study population (the effect was stronger in European and North American men).',
      grade: 'C',
      gradeReason: 'Two meta-analyses reach different conclusions and the certainty is low.',
      status: 'contested',
      caveats:
        'The first meta-analysis carries a corrigendum that was not reviewed. The second found no effect.',
      referenceIds: ['whittaker2021', 'soltani2025'],
      relatedMetricIds: ['testosterone'],
    },
  ],
  myths: [
    {
      id: '05-myth-under-20g-carbohydrate',
      claim: 'You must eat under 20 g of carbohydrate a day to be in ketosis.',
      verdict: 'oversimplified',
      explanation:
        'There is no single cut-off. In a three-week trial, average blood BHB stayed at or above 0.5 mmol/L consistently when carbohydrate gave 5 % of energy, and only now and then at 15–25 %. Where ketosis fades depends on body size, activity and energy deficit. In the model, morning BHB slides from 0.71 mM at 0 g a day to 0.10 mM at 175 g, with a soft threshold around 50–100 g.',
      referenceIds: ['harvey2019a'],
    },
    {
      id: '05-myth-protein-ends-ketosis',
      claim: 'Eating protein turns into glucose and knocks you out of ketosis.',
      verdict: 'oversimplified',
      explanation:
        'Diets with 30 % of energy as protein, or 2.2 g/kg, still gave blood ketones of 1.2–1.5 mmol/L. Protein does seem to lower ketones a little: the model puts the drop at about 25 % between 0.75 and 2.2 g/kg. But no trial has tested protein dose alone at fixed carbohydrate and energy, so the size of the effect is unsettled.',
      referenceIds: ['veldhorst2010', 'johnstone2008', 'burke2021'],
    },
    {
      id: '05-myth-higher-ketones-more-fat-loss',
      claim: 'The higher your ketones, the more body fat you are burning.',
      verdict: 'not-supported',
      explanation:
        'Blood ketones reflect the balance of production and clearance, not how much fat is being lost. Fat loss follows energy balance. At equal calories, carbohydrate restriction lost 53 g of body fat a day while fat restriction lost 89 g. Pooled across studies, lower-fat diets came out about 16 g/day ahead. Ketone drinks actually lower fat release from fat tissue.',
      referenceIds: ['hall2015', 'hall2017', 'balasse1975', 'myettecote2018'],
    },
    {
      id: '05-myth-300-kcal-metabolic-boost',
      claim: 'Cutting carbohydrate boosts your metabolism by 300 kcal a day.',
      verdict: 'not-supported',
      explanation:
        'In ward studies the rise was +57 kcal/day in a chamber, +89 while asleep and +151 ± 63 by doubly labelled water, and it was transient. A long trial reported +209 kcal/day for 20 % versus 60 % carbohydrate, but that result is disputed on how energy expenditure was measured.',
      referenceIds: ['hall2016', 'ebbeling2018', 'hall2019'],
    },
    {
      id: '05-myth-adaptation-takes-months',
      claim: 'It takes weeks or months of very low carbohydrate before your body burns fat well.',
      verdict: 'oversimplified',
      explanation:
        'Maximal fat oxidation reached its chronic level within 5–6 days in trained athletes. What may take longer is recovering training quality and muscle glycogen. The adaptation is also lost within about 5 days of eating carbohydrate again, and is only partly reversed after 1 day.',
      referenceIds: ['burke2021', 'goedecke1999', 'carey2001'],
    },
    {
      id: '05-myth-fat-adapted-athletes-perform-better',
      claim: 'Athletes who adapt to burning fat perform better.',
      verdict: 'not-supported',
      explanation:
        'Elite race walkers burned more fat but needed 5–8 % more oxygen at race pace, and did not improve their 10 km time relative to high-carbohydrate or periodised-carbohydrate eating. In 5 cyclists, endurance at a moderate effort was unchanged after 4 weeks.',
      referenceIds: ['burke2017', 'burke2021', 'phinney1983'],
    },
    {
      id: '05-myth-ketosis-spares-muscle',
      claim: 'Being in ketosis protects your muscle.',
      verdict: 'oversimplified',
      explanation:
        'Ketone infusions reduced leucine burning and nitrogen loss in people fasting for weeks. But in a ward comparison at equal protein and energy, the diet that produced ketosis lost more nitrogen. Protein dose mattered more than ketosis.',
      referenceIds: ['sherwin1975', 'nair1988', 'vazquez1992', 'hoffer1984'],
    },
    {
      id: '05-myth-ketosis-is-ketoacidosis',
      claim: 'Nutritional ketosis is as dangerous as diabetic ketoacidosis.',
      verdict: 'oversimplified',
      explanation:
        'Nutritional ketosis (0.5–3 mM) and even 24 days of starvation (BHB about 5 mM) generally keep bicarbonate at 18 mEq/L or above. Diabetic ketoacidosis means BHB of 3 mM or more together with acidosis, usually with a lack of insulin; the median is about 9 mM. There are exceptions: ketoacidosis has occurred without diabetes in a breastfeeding woman, and it can occur in people taking SGLT2 inhibitors.',
      referenceIds: ['kitabchi2009', 'umpierrez2024', 'vongeijer2015', 'peters2015'],
    },
    {
      id: '05-myth-urine-strips-stop-working',
      claim: 'Urine ketone strips stop working once you are adapted.',
      verdict: 'not-supported',
      explanation:
        'In people on a stable very-low-carbohydrate diet at week 6, urine ketones were still detected more than 90 % of the time at 07:00, 22:00 and 03:00. Over six weeks, 97 % of days had positive urine ketones. The commonly repeated claim of a negative strip despite blood ketosis could not be verified with human data. Strips detect only acetoacetate and are semi-quantitative.',
      referenceIds: ['urbain2016', 'urbain2017', 'laffel1999'],
    },
    {
      id: '05-myth-very-low-fat-harmless',
      claim: 'Cutting fat almost to zero is harmless for weight loss.',
      verdict: 'oversimplified',
      explanation:
        'Very-low-calorie diets with 3 g of fat a day or less produced gallstones in 54.5 % of people, against 0 % at 12.2 g a day. Fat is also needed to absorb carotenoids from vegetables.',
      referenceIds: ['festi1998', 'brown2004'],
    },
  ],
  openQuestions: [
    'The link between liver glycogen and ketone production, and the insulin stand-in, are fitted rather than measured. Any bias in the carbohydrate module carries over, so the production scale and the glycogen midpoint need re-tuning against the fasting targets after the two are joined.',
    'How much protein lowers ketones is the largest structural uncertainty for high-protein, low-carbohydrate regimens (the strength is anywhere from 0 to 0.69). No trial isolates protein dose at fixed carbohydrate and energy.',
    'The extra ketone production in an energy deficit (a factor of 1.5) is fitted to a few studies. Reduced-energy very-low-carbohydrate diets are under-predicted by about 35 %.',
    'The interaction of exercise with low carbohydrate is fitted to athlete data and under-predicts the glycogen-lowering exercise day. Muscle-glycogen coupling should come from the carbohydrate and exercise topics.',
    'Obesity and insulin resistance blunt fasting ketosis more than the model captures (obese-to-lean ratio at 48 hours of 0.7–0.8 in the model versus 0.51 observed).',
    'The sex difference is only about 35–40 % captured (women 1.28 versus 1.7 mM observed at 30 h). Children are not supported.',
    'The chronic effect of MCT oil on morning BHB (+0.8 mM in one trial) is not reproduced (+0.1). The acute effect is.',
    'Re-entry after a refeed and cyclical patterns have no human BHB trajectories. Every number for them is a model prediction.',
    'Slow adaptation, meaning muscle sparing of ketones, comes from prolonged fasting in obese subjects and is contested (saturation versus true adaptation).',
    'The BHB-to-AcAc ratio differs between fasting (2.7–3.5) and maintenance-energy very-low-carbohydrate diets (about 1). BHB output could be biased by about ±30 % in diet-induced ketosis.',
    'The daily pattern is driven by meals only. Circadian (dawn) effects on fat release and ketone production are not modelled.',
    'Appetite effects of ketosis conflict across trials (Johnstone 2008 versus Hall 2021), so the effect is kept small.',
    'Several values were not verified from primary full texts: the pooled effect sizes in the appetite meta-analysis, the ketone values in the inpatient two-week trial, the fat digestibility coefficient and the sodium losses in fasting.',
  ],
  references: [
    {
      id: 'hall2010',
      authors: 'Hall KD',
      year: 2010,
      title: 'Predicting metabolic adaptation, body weight change, and energy intake in humans',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '19934407',
      doi: '10.1152/ajpendo.00559.2009',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/',
    },
    {
      id: 'hall2006',
      authors: 'Hall KD',
      year: 2006,
      title: 'Computational model of in vivo human energy metabolism during semistarvation and refeeding',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '16449298',
      doi: '10.1152/ajpendo.00523.2005',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2377067/',
    },
    {
      id: 'balasse1979',
      authors: 'Balasse EO',
      year: 1979,
      title: 'Kinetics of ketone body metabolism in fasting humans',
      journal: 'Metabolism',
      pmid: '759825',
      doi: '10.1016/0026-0495(79)90166-5',
      verification: 'abstract',
    },
    {
      id: 'balasse1989',
      authors: 'Balasse EO, Féry F',
      year: 1989,
      title: 'Ketone body production and disposal: effects of fasting, diabetes, and exercise',
      journal: 'Diabetes Metab Rev',
      pmid: '2656155',
      doi: '10.1002/dmr.5610050304',
      verification: 'abstract',
    },
    {
      id: 'owen1973',
      authors: 'Owen OE, Reichard GA Jr, Markus H, Boden G, Mozzoli MA, Shuman CR',
      year: 1973,
      title: 'Rapid intravenous sodium acetoacetate infusion in man. Metabolic and kinetic responses',
      journal: 'J Clin Invest',
      pmid: '4729054',
      doi: '10.1172/JCI107453',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC302521/',
    },
    {
      id: 'owen1971',
      authors: 'Owen OE, Reichard GA Jr',
      year: 1971,
      title: 'Human forearm metabolism during progressive starvation',
      journal: 'J Clin Invest',
      pmid: '5090067',
      doi: '10.1172/JCI106639',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC292094/',
    },
    {
      id: 'reichard1974',
      authors: 'Reichard GA Jr, Owen OE, Haff AC, Paul P, Bortz WM',
      year: 1974,
      title: 'Ketone-body production and oxidation in fasting obese humans',
      journal: 'J Clin Invest',
      pmid: '11344564',
      doi: '10.1172/JCI107584',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC301493/',
    },
    {
      id: 'owen1969',
      authors: 'Owen OE, Felig P, Morgan AP, Wahren J, Cahill GF Jr',
      year: 1969,
      title: 'Liver and kidney metabolism during prolonged starvation',
      journal: 'J Clin Invest',
      pmid: '5773093',
      doi: '10.1172/JCI106016',
      verification: 'abstract',
    },
    {
      id: 'owen1967',
      authors: 'Owen OE, Morgan AP, Kemp HG, Sullivan JM, Herrera MG, Cahill GF Jr',
      year: 1967,
      title: 'Brain metabolism during fasting',
      journal: 'J Clin Invest',
      pmid: '6061736',
      doi: '10.1172/JCI105650',
      verification: 'abstract',
    },
    {
      id: 'cahill1970',
      authors: 'Cahill GF Jr',
      year: 1970,
      title: 'Starvation in man',
      journal: 'N Engl J Med',
      pmid: '4915800',
      doi: '10.1056/NEJM197003192821209',
      verification: 'abstract',
    },
    {
      id: 'cahill2006',
      authors: 'Cahill GF Jr',
      year: 2006,
      title: 'Fuel metabolism in starvation',
      journal: 'Annu Rev Nutr',
      pmid: '16848698',
      doi: '10.1146/annurev.nutr.26.061505.111258',
      verification: 'abstract',
    },
    {
      id: 'haymond1982',
      authors: 'Haymond MW, Karl IE, Clarke WL, Pagliara AS, Santiago JV',
      year: 1982,
      title:
        'Differences in circulating gluconeogenic substrates during short-term fasting in men, women, and children',
      journal: 'Metabolism',
      pmid: '7043160',
      verification: 'abstract',
    },
    {
      id: 'deru2021',
      authors: 'Deru LS, Bikman BT, Davidson LE, et al.',
      year: 2021,
      title:
        'The effects of exercise on β-hydroxybutyrate concentrations over a 36-h fast: a randomized crossover study',
      journal: 'Med Sci Sports Exerc',
      pmid: '33731648',
      doi: '10.1249/MSS.0000000000002655',
      verification: 'abstract',
    },
    {
      id: 'mcdougal2018',
      authors: 'McDougal DH, Darpolor MM, DuVall MA, et al.',
      year: 2018,
      title:
        'Glial acetate metabolism is increased following a 72-h fast in metabolically healthy men and correlates with susceptibility to hypoglycemia',
      journal: 'Acta Diabetol',
      pmid: '29931424',
      doi: '10.1007/s00592-018-1180-5',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6153507/',
    },
    {
      id: 'neudorf2025',
      authors: 'Neudorf H, Sandilands RE, Ursel S, et al.',
      year: 2025,
      title: 'Altered immunometabolic response to fasting in humans living with obesity',
      journal: 'iScience',
      pmid: '40662191',
      doi: '10.1016/j.isci.2025.112872',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12256293/',
    },
    {
      id: 'klein1993',
      authors: 'Klein S, Sakurai Y, Romijn JA, Carroll RM',
      year: 1993,
      title:
        'Progressive alterations in lipid and glucose metabolism during short-term fasting in young adult men',
      journal: 'Am J Physiol',
      pmid: '8238506',
      doi: '10.1152/ajpendo.1993.265.5.E801',
      verification: 'abstract',
    },
    {
      id: 'rothman1991',
      authors: 'Rothman DL, Magnusson I, Katz LD, Shulman RG, Shulman GI',
      year: 1991,
      title: 'Quantitation of hepatic glycogenolysis and gluconeogenesis in fasting humans with 13C NMR',
      journal: 'Science',
      pmid: '1948033',
      doi: '10.1126/science.1948033',
      verification: 'abstract',
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
      verification: 'abstract',
    },
    {
      id: 'rosenbaum2019',
      authors: 'Rosenbaum M, Hall KD, Guo J, et al.',
      year: 2019,
      title:
        'Glucose and lipid homeostasis and inflammation in humans following an isocaloric ketogenic diet',
      journal: 'Obesity',
      pmid: '31067015',
      doi: '10.1002/oby.22468',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6922028/',
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
      verification: 'abstract',
    },
    {
      id: 'harvey2018',
      authors: 'Harvey CJDC, Schofield GM, Williden M, McQuillan JA',
      year: 2018,
      title:
        'The effect of medium chain triglycerides on time to nutritional ketosis and symptoms of keto-induction in healthy adults: a randomised controlled clinical trial',
      journal: 'J Nutr Metab',
      pmid: '29951312',
      doi: '10.1155/2018/2630565',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5987302/',
    },
    {
      id: 'harvey2019a',
      authors: 'Harvey CJDC, Schofield GM, Zinn C, Thornley S',
      year: 2019,
      title:
        'Effects of differing levels of carbohydrate restriction on mood achievement of nutritional ketosis, and symptoms of carbohydrate withdrawal in healthy adults: a randomized clinical trial',
      journal: 'Nutrition X',
      pmid: '34332710',
      doi: '10.1016/j.nutx.2019.100005',
      verification: 'abstract',
    },
    {
      id: 'harvey2019b',
      authors: 'Harvey CJDC, Schofield GM, Zinn C, Thornley SJ, Crofts C, Merien FLR',
      year: 2019,
      title:
        'Low-carbohydrate diets differing in carbohydrate restriction improve cardiometabolic and anthropometric markers in healthy adults: a randomised clinical trial',
      journal: 'PeerJ',
      pmid: '30740270',
      doi: '10.7717/peerj.6273',
      verification: 'abstract',
    },
    {
      id: 'urbain2016',
      authors: 'Urbain P, Bertz H',
      year: 2016,
      title:
        'Monitoring for compliance with a ketogenic diet: what is the best time of day to test for urinary ketosis?',
      journal: 'Nutr Metab (Lond)',
      pmid: '27822291',
      doi: '10.1186/s12986-016-0136-4',
      verification: 'abstract',
    },
    {
      id: 'urbain2017',
      authors: 'Urbain P, Strom L, Morawski L, et al.',
      year: 2017,
      title:
        'Impact of a 6-week non-energy-restricted ketogenic diet on physical fitness, body composition and biochemical parameters in healthy adults',
      journal: 'Nutr Metab (Lond)',
      pmid: '28239404',
      doi: '10.1186/s12986-017-0175-5',
      verification: 'abstract',
    },
    {
      id: 'hallberg2018',
      authors: 'Hallberg SJ, McKenzie AL, Williams PT, et al.',
      year: 2018,
      title: 'Effectiveness and safety of a novel care model for the management of type 2 diabetes at 1 year',
      journal: 'Diabetes Ther',
      pmid: '29417495',
      doi: '10.1007/s13300-018-0373-9',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6104272/',
    },
    {
      id: 'johnstone2008',
      authors: 'Johnstone AM, Horgan GW, Murison SD, Bremner DM, Lobley GE',
      year: 2008,
      title:
        'Effects of a high-protein ketogenic diet on hunger, appetite, and weight loss in obese men feeding ad libitum',
      journal: 'Am J Clin Nutr',
      pmid: '18175736',
      doi: '10.1093/ajcn/87.1.44',
      verification: 'abstract',
    },
    {
      id: 'veldhorst2010',
      authors: 'Veldhorst MA, Westerterp KR, van Vught AJ, Westerterp-Plantenga MS',
      year: 2010,
      title:
        'Presence or absence of carbohydrates and the proportion of fat in a high-protein diet affect appetite suppression but not energy expenditure in normal-weight human subjects fed in energy balance',
      journal: 'Br J Nutr',
      pmid: '20565999',
      doi: '10.1017/S0007114510002060',
      verification: 'abstract',
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
      verification: 'abstract',
    },
    {
      id: 'burke2017',
      authors: 'Burke LM, Ross ML, Garvican-Lewis LA, et al.',
      year: 2017,
      title:
        'Low carbohydrate, high fat diet impairs exercise economy and negates the performance benefit from intensified training in elite race walkers',
      journal: 'J Physiol',
      pmid: '28012184',
      doi: '10.1113/JP273230',
      verification: 'abstract',
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
      id: 'carey2001',
      authors: 'Carey AL, Staudacher HM, Cummings NK, et al.',
      year: 2001,
      title: 'Effects of fat adaptation and carbohydrate restoration on prolonged endurance exercise',
      journal: 'J Appl Physiol',
      pmid: '11408421',
      doi: '10.1152/jappl.2001.91.1.115',
      verification: 'abstract',
    },
    {
      id: 'stellingwerff2006',
      authors: 'Stellingwerff T, Spriet LL, Watt MJ, et al.',
      year: 2006,
      title:
        'Decreased PDH activation and glycogenolysis during exercise following fat adaptation with carbohydrate restoration',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '16188909',
      doi: '10.1152/ajpendo.00268.2005',
      verification: 'abstract',
    },
    {
      id: 'goedecke1999',
      authors: 'Goedecke JH, Christie C, Wilson G, et al.',
      year: 1999,
      title: 'Metabolic adaptations to a high-fat diet in endurance cyclists',
      journal: 'Metabolism',
      pmid: '10599981',
      doi: '10.1016/s0026-0495(99)90238-x',
      verification: 'abstract',
    },
    {
      id: 'webster2016',
      authors: 'Webster CC, Noakes TD, Chacko SK, Swart J, Kohn TA, Smith JA',
      year: 2016,
      title:
        'Gluconeogenesis during endurance exercise in cyclists habituated to a long-term low carbohydrate high-fat diet',
      journal: 'J Physiol',
      pmid: '26918583',
      doi: '10.1113/JP271934',
      verification: 'abstract',
    },
    {
      id: 'fery1983',
      authors: 'Féry F, Balasse EO',
      year: 1983,
      title: 'Ketone body turnover during and after exercise in overnight-fasted and starved humans',
      journal: 'Am J Physiol',
      pmid: '6353933',
      doi: '10.1152/ajpendo.1983.245.4.E318',
      verification: 'abstract',
    },
    {
      id: 'fery1986',
      authors: 'Féry F, Balasse EO',
      year: 1986,
      title:
        'Response of ketone body metabolism to exercise during transition from postabsorptive to fasted state',
      journal: 'Am J Physiol',
      pmid: '3518484',
      doi: '10.1152/ajpendo.1986.250.5.E495',
      verification: 'abstract',
    },
    {
      id: 'fery1988',
      authors: 'Féry F, Balasse EO',
      year: 1988,
      title: 'Effect of exercise on the disposal of infused ketone bodies in humans',
      journal: 'J Clin Endocrinol Metab',
      pmid: '3392162',
      doi: '10.1210/jcem-67-2-245',
      verification: 'abstract',
    },
    {
      id: 'balasse1978',
      authors: 'Balasse EO, Féry F, Neef MA',
      year: 1978,
      title: 'Changes induced by exercise in rates of turnover and oxidation of ketone bodies in fasting man',
      journal: 'J Appl Physiol',
      pmid: '627499',
      doi: '10.1152/jappl.1978.44.1.5',
      verification: 'abstract',
    },
    {
      id: 'evans2017',
      authors: 'Evans M, Cogan KE, Egan B',
      year: 2017,
      title:
        'Metabolism of ketone bodies during exercise and training: physiological basis for exogenous supplementation',
      journal: 'J Physiol',
      pmid: '27861911',
      doi: '10.1113/JP273185',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5407977/',
    },
    {
      id: 'balasse1975',
      authors: 'Balasse EO, Neef MA',
      year: 1975,
      title: 'Inhibition of ketogenesis by ketone bodies in fasting humans',
      journal: 'Metabolism',
      pmid: '1152676',
      doi: '10.1016/0026-0495(75)90092-x',
      verification: 'abstract',
    },
    {
      id: 'keller1988',
      authors: 'Keller U, Gerber PP, Stauffacher W',
      year: 1988,
      title: 'Fatty acid-independent inhibition of hepatic ketone body production by insulin in humans',
      journal: 'Am J Physiol',
      pmid: '3287950',
      doi: '10.1152/ajpendo.1988.254.6.E694',
      verification: 'abstract',
    },
    {
      id: 'miles1983',
      authors: 'Miles JM, Haymond MW, Nissen SL, Gerich JE',
      year: 1983,
      title:
        'Effects of free fatty acid availability, glucagon excess, and insulin deficiency on ketone body production in postabsorptive man',
      journal: 'J Clin Invest',
      pmid: '6134753',
      doi: '10.1172/jci110911',
      verification: 'abstract',
    },
    {
      id: 'keller1989',
      authors: 'Keller U, Lustenberger M, Müller-Brand J, Gerber PP, Stauffacher W',
      year: 1989,
      title:
        'Human ketone body production and utilization studied using tracer techniques: regulation by free fatty acids, insulin, catecholamines, and thyroid hormones',
      journal: 'Diabetes Metab Rev',
      pmid: '2656157',
      doi: '10.1002/dmr.5610050306',
      verification: 'abstract',
    },
    {
      id: 'deru2024',
      authors: 'Deru LS, Gipson EZ, Hales KE, et al.',
      year: 2024,
      title:
        'The effects of a high-carbohydrate versus a high-fat shake on biomarkers of metabolism and glycemic control when used to interrupt a 38-h fast: a randomized crossover study',
      journal: 'Nutrients',
      pmid: '38201992',
      doi: '10.3390/nu16010164',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10780935/',
    },
    {
      id: 'gipson2025',
      authors: 'Gipson EZ, Deru LS, Graves PG, Jacobsen CG, Peterson NE, Bailey BW',
      year: 2025,
      title:
        'The effects of initiating a 24-hour fast with a low versus a high carbohydrate shake on glycemic control in older adults: a randomized crossover study',
      journal: 'Nutr Metab (Lond)',
      pmid: '40234969',
      doi: '10.1186/s12986-025-00920-5',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11998415/',
    },
    {
      id: 'gray1989',
      authors: 'Gray DS, Takahashi M, Fisler JS, et al.',
      year: 1989,
      title:
        'Effect of carbohydrate refeeding on free fatty acids after a fast in obese diabetic and obese non-diabetic females',
      journal: 'Metabolism',
      pmid: '2645502',
      doi: '10.1016/0026-0495(89)90077-2',
      verification: 'abstract',
    },
    {
      id: 'fery1982',
      authors: 'Fery F, Bourdoux P, Christophe J, Balasse EO',
      year: 1982,
      title:
        'Hormonal and metabolic changes induced by an isocaloric isoproteinic ketogenic diet in healthy subjects',
      journal: 'Diabete Metab',
      pmid: '6761185',
      verification: 'abstract',
    },
    {
      id: 'stubbs2017',
      authors: 'Stubbs BJ, Cox PJ, Evans RD, et al.',
      year: 2017,
      title: 'On the metabolism of exogenous ketones in humans',
      journal: 'Front Physiol',
      pmid: '29163194',
      doi: '10.3389/fphys.2017.00848',
      verification: 'abstract',
    },
    {
      id: 'clarke2012',
      authors: 'Clarke K, Tchabanenko K, Pawlosky R, et al.',
      year: 2012,
      title:
        'Kinetics, safety and tolerability of (R)-3-hydroxybutyl (R)-3-hydroxybutyrate in healthy adult subjects',
      journal: 'Regul Toxicol Pharmacol',
      pmid: '22561291',
      doi: '10.1016/j.yrtph.2012.04.008',
      verification: 'abstract',
    },
    {
      id: 'cox2016',
      authors: 'Cox PJ, Kirk T, Ashmore T, et al.',
      year: 2016,
      title: 'Nutritional ketosis alters fuel preference and thereby endurance performance in athletes',
      journal: 'Cell Metab',
      pmid: '27475046',
      doi: '10.1016/j.cmet.2016.07.010',
      verification: 'abstract',
    },
    {
      id: 'myettecote2018',
      authors: 'Myette-Côté É, Neudorf H, Rafiei H, Clarke K, Little JP',
      year: 2018,
      title:
        'Prior ingestion of exogenous ketone monoester attenuates the glycaemic response to an oral glucose tolerance test in healthy young individuals',
      journal: 'J Physiol',
      pmid: '29446830',
      doi: '10.1113/JP275709',
      verification: 'abstract',
    },
    {
      id: 'stpierre2019',
      authors: 'St-Pierre V, Vandenberghe C, Lowry CM, et al.',
      year: 2019,
      title:
        'Plasma ketone and medium chain fatty acid response in humans consuming different medium chain triglycerides during a metabolic study day',
      journal: 'Front Nutr',
      pmid: '31058159',
      doi: '10.3389/fnut.2019.00046',
      verification: 'abstract',
    },
    {
      id: 'vandenberghe2017',
      authors: 'Vandenberghe C, St-Pierre V, Pierotti T, et al.',
      year: 2017,
      title:
        'Tricaprylin alone increases plasma ketone response more than coconut oil or other medium-chain triglycerides: an acute crossover study in healthy adults',
      journal: 'Curr Dev Nutr',
      pmid: '29955698',
      doi: '10.3945/cdn.116.000257',
      verification: 'abstract',
    },
    {
      id: 'courchesneloyer2013',
      authors: 'Courchesne-Loyer A, Fortier M, Tremblay-Mercier J, et al.',
      year: 2013,
      title:
        'Stimulation of mild, sustained ketonemia by medium-chain triacylglycerols in healthy humans: estimated potential contribution to brain energy metabolism',
      journal: 'Nutrition',
      pmid: '23274095',
      doi: '10.1016/j.nut.2012.09.009',
      verification: 'abstract',
    },
    {
      id: 'courchesneloyer2017',
      authors: 'Courchesne-Loyer A, Croteau E, Castellano CA, et al.',
      year: 2017,
      title:
        'Inverse relationship between brain glucose and ketone metabolism in adults during short-term moderate dietary ketosis: a dual tracer quantitative PET study',
      journal: 'J Cereb Blood Flow Metab',
      pmid: '27629100',
      doi: '10.1177/0271678X16669366',
      verification: 'abstract',
    },
    {
      id: 'blomqvist2002',
      authors: 'Blomqvist G, Alvarsson M, Grill V, et al.',
      year: 2002,
      title:
        'Effect of acute hyperketonemia on the cerebral uptake of ketone bodies in nondiabetic subjects and IDDM patients',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '12067838',
      doi: '10.1152/ajpendo.00294.2001',
      verification: 'abstract',
    },
    {
      id: 'gibson2015',
      authors: 'Gibson AA, Seimon RV, Lee CM, et al.',
      year: 2015,
      title: 'Do ketogenic diets really suppress appetite? A systematic review and meta-analysis',
      journal: 'Obes Rev',
      pmid: '25402637',
      doi: '10.1111/obr.12230',
      verification: 'abstract',
    },
    {
      id: 'fernandezverdejo2023',
      authors: 'Fernández-Verdejo R, Mey JT, Ravussin E',
      year: 2023,
      title:
        'Effects of ketone bodies on energy expenditure, substrate utilization, and energy intake in humans',
      journal: 'J Lipid Res',
      pmid: '37703994',
      doi: '10.1016/j.jlr.2023.100442',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10570604/',
    },
    {
      id: 'hall2017',
      authors: 'Hall KD, Guo J',
      year: 2017,
      title: 'Obesity energetics: body weight regulation and the effects of diet composition',
      journal: 'Gastroenterology',
      pmid: '28193517',
      doi: '10.1053/j.gastro.2017.01.052',
      verification: 'abstract',
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
      verification: 'abstract',
    },
    {
      id: 'bostock2020',
      authors: 'Bostock ECS, Kirkby KC, Taylor BV, Hawrelak JA',
      year: 2020,
      title: 'Consumer reports of "keto flu" associated with the ketogenic diet',
      journal: 'Front Nutr',
      pmid: '32232045',
      doi: '10.3389/fnut.2020.00020',
      verification: 'abstract',
    },
    {
      id: 'veverbrants1969',
      authors: 'Veverbrants E, Arky RA',
      year: 1969,
      title:
        'Effects of fasting and refeeding. I. Studies on sodium, potassium and water excretion on a constant electrolyte and fluid intake',
      journal: 'J Clin Endocrinol Metab',
      pmid: '5762322',
      doi: '10.1210/jcem-29-1-55',
      verification: 'unverified',
    },
    {
      id: 'kolanowski1981',
      authors: 'Kolanowski J',
      year: 1981,
      title:
        'Influence of insulin and glucagon on sodium balance in obese subjects during fasting and refeeding',
      journal: 'Int J Obes',
      pmid: '6113218',
      verification: 'abstract',
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
      verification: 'abstract',
    },
    {
      id: 'sherwin1975',
      authors: 'Sherwin RS, Hendler RG, Felig P',
      year: 1975,
      title: 'Effect of ketone infusions on amino acid and nitrogen metabolism in man',
      journal: 'J Clin Invest',
      pmid: '1133179',
      doi: '10.1172/JCI108057',
      verification: 'abstract',
    },
    {
      id: 'nair1988',
      authors: 'Nair KS, Welle SL, Halliday D, Campbell RG',
      year: 1988,
      title:
        'Effect of β-hydroxybutyrate on whole-body leucine kinetics and fractional mixed skeletal muscle protein synthesis in humans',
      journal: 'J Clin Invest',
      pmid: '3392207',
      doi: '10.1172/JCI113570',
      verification: 'abstract',
    },
    {
      id: 'vazquez1992',
      authors: 'Vazquez JA, Adibi SA',
      year: 1992,
      title:
        'Protein sparing during treatment of obesity: ketogenic versus nonketogenic very low calorie diet',
      journal: 'Metabolism',
      pmid: '1556948',
      doi: '10.1016/0026-0495(92)90076-m',
      verification: 'abstract',
    },
    {
      id: 'hoffer1984',
      authors: 'Hoffer LJ, Bistrian BR, Young VR, Blackburn GL, Matthews DE',
      year: 1984,
      title: 'Metabolic effects of very low calorie weight reduction diets',
      journal: 'J Clin Invest',
      pmid: '6707202',
      doi: '10.1172/JCI111268',
      verification: 'abstract',
    },
    {
      id: 'kitabchi2009',
      authors: 'Kitabchi AE, Umpierrez GE, Miles JM, Fisher JN',
      year: 2009,
      title: 'Hyperglycemic crises in adult patients with diabetes',
      journal: 'Diabetes Care',
      pmid: '19564476',
      doi: '10.2337/dc09-9032',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2699725/',
    },
    {
      id: 'umpierrez2024',
      authors: 'Umpierrez GE, Davis GM, ElSayed NA, et al.',
      year: 2024,
      title: 'Hyperglycemic crises in adults with diabetes: a consensus report',
      journal: 'Diabetes Care',
      pmid: '39052901',
      doi: '10.2337/dci24-0032',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11272983/',
    },
    {
      id: 'peters2015',
      authors: 'Peters AL, Buschur EO, Buse JB, Cohan P, Diner JC, Hirsch IB',
      year: 2015,
      title:
        'Euglycemic diabetic ketoacidosis: a potential complication of treatment with sodium–glucose cotransporter 2 inhibition',
      journal: 'Diabetes Care',
      pmid: '26078479',
      doi: '10.2337/dc15-0843',
      verification: 'abstract',
    },
    {
      id: 'vongeijer2015',
      authors: 'von Geijer L, Ekelund M',
      year: 2015,
      title:
        'Ketoacidosis associated with low-carbohydrate diet in a non-diabetic lactating woman: a case report',
      journal: 'J Med Case Rep',
      pmid: '26428083',
      doi: '10.1186/s13256-015-0709-2',
      verification: 'abstract',
    },
    {
      id: 'laffel1999',
      authors: 'Laffel L',
      year: 1999,
      title:
        'Ketone bodies: a review of physiology, pathophysiology and application of monitoring to diabetes',
      journal: 'Diabetes Metab Res Rev',
      pmid: '10634967',
      verification: 'abstract',
    },
    {
      id: 'schutz1989',
      authors: 'Schutz Y, Flatt JP, Jéquier E',
      year: 1989,
      title:
        'Failure of dietary fat intake to promote fat oxidation: a factor favoring the development of obesity',
      journal: 'Am J Clin Nutr',
      pmid: '2756918',
      doi: '10.1093/ajcn/50.2.307',
      verification: 'abstract',
    },
    {
      id: 'flatt1995',
      authors: 'Flatt JP',
      year: 1995,
      title: 'Use and storage of carbohydrate and fat',
      journal: 'Am J Clin Nutr',
      pmid: '7900694',
      doi: '10.1093/ajcn/61.4.952S',
      verification: 'abstract',
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
      verification: 'abstract',
    },
    {
      id: 'smith2000a',
      authors: 'Smith SR, de Jonge L, Zachwieja JJ, et al.',
      year: 2000,
      title: 'Fat and carbohydrate balances during adaptation to a high-fat diet',
      journal: 'Am J Clin Nutr',
      pmid: '10648257',
      doi: '10.1093/ajcn/71.2.450',
      verification: 'abstract',
    },
    {
      id: 'smith2000b',
      authors: 'Smith SR, de Jonge L, Zachwieja JJ, et al.',
      year: 2000,
      title: 'Concurrent physical activity increases fat oxidation during the shift to a high-fat diet',
      journal: 'Am J Clin Nutr',
      pmid: '10871571',
      doi: '10.1093/ajcn/72.1.131',
      verification: 'abstract',
    },
    {
      id: 'thomas1992',
      authors: 'Thomas CD, Peters JC, Reed GW, Abumrad NN, Sun M, Hill JO',
      year: 1992,
      title:
        'Nutrient balance and energy expenditure during ad libitum feeding of high-fat and high-carbohydrate diets in humans',
      journal: 'Am J Clin Nutr',
      pmid: '1570800',
      doi: '10.1093/ajcn/55.5.934',
      verification: 'abstract',
    },
    {
      id: 'hill1991',
      authors: 'Hill JO, Peters JC, Reed GW, Schlundt DG, Sharp T, Greene HL',
      year: 1991,
      title: 'Nutrient balance in humans: effects of diet composition',
      journal: 'Am J Clin Nutr',
      pmid: '2058571',
      doi: '10.1093/ajcn/54.1.10',
      verification: 'abstract',
    },
    {
      id: 'schrauwen1997',
      authors: 'Schrauwen P, van Marken Lichtenbelt WD, Saris WH, Westerterp KR',
      year: 1997,
      title:
        'Role of glycogen-lowering exercise in the change of fat oxidation in response to a high-fat diet',
      journal: 'Am J Physiol',
      pmid: '9316454',
      doi: '10.1152/ajpendo.1997.273.3.E623',
      verification: 'abstract',
    },
    {
      id: 'frayn2002',
      authors: 'Frayn KN',
      year: 2002,
      title: 'Adipose tissue as a buffer for daily lipid flux',
      journal: 'Diabetologia',
      pmid: '12242452',
      doi: '10.1007/s00125-002-0873-y',
      verification: 'abstract',
    },
    {
      id: 'mcquaid2011',
      authors: 'McQuaid SE, Hodson L, Neville MJ, et al.',
      year: 2011,
      title:
        'Downregulation of adipose tissue fatty acid trafficking in obesity: a driver for ectopic fat deposition?',
      journal: 'Diabetes',
      pmid: '20943748',
      doi: '10.2337/db10-0867',
      verification: 'abstract',
    },
    {
      id: 'bickerton2007',
      authors: 'Bickerton AS, Roberts R, Fielding BA, et al.',
      year: 2007,
      title:
        'Preferential uptake of dietary fatty acids in adipose tissue and muscle in the postprandial period',
      journal: 'Diabetes',
      pmid: '17192479',
      doi: '10.2337/db06-0822',
      verification: 'abstract',
    },
    {
      id: 'romanski2000',
      authors: 'Romanski SA, Nelson RM, Jensen MD',
      year: 2000,
      title: 'Meal fatty acid uptake in adipose tissue: gender effects in nonobese humans',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '10913047',
      doi: '10.1152/ajpendo.2000.279.2.E455',
      verification: 'abstract',
    },
    {
      id: 'nordestgaard2016',
      authors: 'Nordestgaard BG, Langsted A, Mora S, et al.',
      year: 2016,
      title:
        'Fasting is not routinely required for determination of a lipid profile… joint consensus statement from the EAS and EFLM',
      journal: 'Eur Heart J',
      pmid: '27122601',
      doi: '10.1093/eurheartj/ehw152',
      verification: 'abstract',
    },
    {
      id: 'kolovou2011',
      authors: 'Kolovou GD, Mikhailidis DP, Kovar J, et al.',
      year: 2011,
      title:
        'Assessment and clinical relevance of non-fasting and postprandial triglycerides: an expert panel statement',
      journal: 'Curr Vasc Pharmacol',
      pmid: '21314632',
      doi: '10.2174/157016111795495549',
      verification: 'abstract',
    },
    {
      id: 'venables2005',
      authors: 'Venables MC, Achten J, Jeukendrup AE',
      year: 2005,
      title:
        'Determinants of fat oxidation during exercise in healthy men and women: a cross-sectional study',
      journal: 'J Appl Physiol',
      pmid: '15333616',
      doi: '10.1152/japplphysiol.00662.2003',
      verification: 'abstract',
    },
    {
      id: 'randell2017',
      authors: 'Randell RK, Rollo I, Roberts TJ, et al.',
      year: 2017,
      title: 'Maximal fat oxidation rates in an athletic population',
      journal: 'Med Sci Sports Exerc',
      pmid: '27580144',
      doi: '10.1249/MSS.0000000000001084',
      verification: 'abstract',
    },
    {
      id: 'alpert2005',
      authors: 'Alpert SS',
      year: 2005,
      title: 'A limit on the energy transfer rate from the human fat store in hypophagia',
      journal: 'J Theor Biol',
      pmid: '15615615',
      doi: '10.1016/j.jtbi.2004.08.029',
      verification: 'abstract',
    },
    {
      id: 'iom2005',
      authors: 'Institute of Medicine (Food and Nutrition Board)',
      year: 2005,
      title:
        'Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids',
      journal: 'National Academies Press',
      doi: '10.17226/10490',
      url: 'https://nap.nationalacademies.org/catalog/10490',
      verification: 'unverified',
    },
    {
      id: 'roodenburg2000',
      authors: 'Roodenburg AJ, Leenen R, van het Hof KH, Weststrate JA, Tijburg LB',
      year: 2000,
      title:
        'Amount of fat in the diet affects bioavailability of lutein esters but not of α-carotene, β-carotene, and vitamin E in humans',
      journal: 'Am J Clin Nutr',
      pmid: '10799382',
      doi: '10.1093/ajcn/71.5.1187',
      verification: 'abstract',
    },
    {
      id: 'brown2004',
      authors: 'Brown MJ, Ferruzzi MG, Nguyen ML, et al.',
      year: 2004,
      title:
        'Carotenoid bioavailability is higher from salads ingested with full-fat than with fat-reduced salad dressings as measured with electrochemical detection',
      journal: 'Am J Clin Nutr',
      pmid: '15277161',
      doi: '10.1093/ajcn/80.2.396',
      verification: 'abstract',
    },
    {
      id: 'festi1998',
      authors: 'Festi D, Colecchia A, Orsini M, et al.',
      year: 1998,
      title:
        'Gallbladder motility and gallstone formation in obese patients following very low calorie diets. Use it (fat) to lose it (well)',
      journal: 'Int J Obes',
      pmid: '9665682',
      doi: '10.1038/sj.ijo.0800634',
      verification: 'abstract',
    },
    {
      id: 'gebhard1996',
      authors: 'Gebhard RL, Prigge WF, Ansel HJ, et al.',
      year: 1996,
      title: 'The role of gallbladder emptying in gallstone formation during diet-induced rapid weight loss',
      journal: 'Hepatology',
      pmid: '8781321',
      doi: '10.1002/hep.510240313',
      verification: 'abstract',
    },
    {
      id: 'stokes2014',
      authors: 'Stokes CS, Gluud LL, Casper M, Lammert F',
      year: 2014,
      title:
        'Ursodeoxycholic acid and diets higher in fat prevent gallbladder stones during weight loss: a meta-analysis of randomized controlled trials',
      journal: 'Clin Gastroenterol Hepatol',
      pmid: '24321208',
      doi: '10.1016/j.cgh.2013.11.031',
      verification: 'abstract',
    },
    {
      id: 'johansson2014',
      authors: 'Johansson K, Sundström J, Marcus C, Hemmingsson E, Neovius M',
      year: 2014,
      title:
        'Risk of symptomatic gallstones and cholecystectomy after a very-low-calorie diet or low-calorie diet in a commercial weight loss program: 1-year matched cohort study',
      journal: 'Int J Obes',
      pmid: '23736359',
      doi: '10.1038/ijo.2013.83',
      verification: 'abstract',
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
      verification: 'abstract',
    },
    {
      id: 'soltani2025',
      authors: 'Soltani S, Hejazi M, Meshkini F, et al.',
      year: 2025,
      title:
        'The effect of low-fat diets versus high-fat diet on sex hormones: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'J Food Sci',
      pmid: '40387562',
      doi: '10.1111/1750-3841.70266',
      verification: 'abstract',
    },
    {
      id: 'whittaker2022',
      authors: 'Whittaker J, Harris M',
      year: 2022,
      title:
        "Low-carbohydrate diets and men's cortisol and testosterone: systematic review and meta-analysis",
      journal: 'Nutr Health',
      pmid: '35254136',
      doi: '10.1177/02601060221083079',
      verification: 'abstract',
    },
    {
      id: 'kysel2020',
      authors: 'Kysel P, Haluzíková D, Doležalová RP, et al.',
      year: 2020,
      title:
        'The influence of cyclical ketogenic reduction diet vs. nutritionally balanced reduction diet on body composition, strength, and endurance performance in healthy young males: a randomized controlled trial',
      journal: 'Nutrients',
      pmid: '32947920',
      doi: '10.3390/nu12092832',
      verification: 'abstract',
    },
    {
      id: 'bougneres1986',
      authors: 'Bougnères PF, Lemmel C, Ferré P, Bier DM',
      year: 1986,
      title: 'Ketone body transport in the human neonate and infant',
      journal: 'J Clin Invest',
      pmid: '3944260',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC423306/',
    },
    {
      id: 'kephart2018',
      authors: 'Kephart WC, Pledge CD, Roberson PA, et al.',
      year: 2018,
      title:
        'The three-month effects of a ketogenic diet on body composition, blood parameters, and performance metrics in CrossFit trainees: a pilot study',
      journal: 'Sports',
      pmid: '29910305',
      doi: '10.3390/sports6010001',
      verification: 'abstract',
    },
    {
      id: 'johnson1972',
      authors: 'Johnson RH, Walton JL',
      year: 1972,
      title: 'The effect of exercise upon acetoacetate metabolism in athletes and non-athletes',
      journal: 'Q J Exp Physiol',
      pmid: '4482033',
      verification: 'unverified',
    },
    {
      id: 'johnson1969',
      authors: 'Johnson RH, Walton JL, Krebs HA, Williamson DH',
      year: 1969,
      title: 'Metabolic fuels during and after severe exercise in athletes and non-athletes',
      journal: 'Lancet',
      pmid: '4183902',
      verification: 'unverified',
    },
    {
      id: 'stubbs2018',
      authors: 'Stubbs BJ, Cox PJ, Evans RD, Cyranka M, Clarke K, de Wet H',
      year: 2018,
      title: 'A ketone ester drink lowers human ghrelin and appetite',
      journal: 'Obesity',
      pmid: '29105987',
      doi: '10.1002/oby.22051',
      verification: 'abstract',
    },
    {
      id: 'southgate1970',
      authors: 'Southgate DA, Durnin JV',
      year: 1970,
      title:
        'Calorie conversion factors. An experimental reassessment of the factors used in the calculation of the energy value of human diets',
      journal: 'Br J Nutr',
      pmid: '5452702',
      doi: '10.1079/bjn19700050',
      verification: 'unverified',
    },
    {
      id: 'hall2019',
      authors: 'Hall KD',
      year: 2019,
      title: 'Mystery or method? Evaluating claims of increased energy expenditure during a ketogenic diet',
      journal: 'PLoS One',
      pmid: '31815947',
      doi: '10.1371/journal.pone.0225944',
      verification: 'abstract',
    },
  ],
};

export default topic;
