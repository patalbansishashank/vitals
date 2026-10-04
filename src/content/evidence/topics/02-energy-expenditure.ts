import type { EvidenceTopic } from '../schema';

/** Evidence topic for research/02-energy-expenditure-adaptation.md (pure data). */
const topic: EvidenceTopic = {
  dossier: '02',
  slug: 'energy-expenditure',
  title: 'Energy expenditure and metabolic adaptation',
  scope:
    'How much energy a person burns each day, and how that changes with body size, food, activity and time. It covers resting metabolic rate, the heat produced by digesting food, everyday movement, exercise and its knock-on effects, and metabolic adaptation, the extra slowing or speeding of expenditure that follows eating less or more. It also covers what it costs the body to build or break down tissue, and how uncertain any prediction of daily energy use is.',
  mechanisms: [
    {
      id: '02-resting-rate-equations',
      title: 'Predicting resting metabolic rate from body size and composition',
      category: 'energy',
      summary:
        'Resting metabolic rate (RMR) is the energy the body burns lying still, fasted and comfortably warm. Most of it is set by fat-free mass (everything that is not fat), with small contributions from fat mass and age. Height, weight, age and sex work as predictors mainly because they stand in for fat-free mass. In 150 adults, 63% of the differences in basal rate between people were explained by fat-free mass.',
      howModelled:
        "Vitals uses the best information available. A measured RMR is used as it is. If body-fat percentage is known, it uses an equation based on fat-free mass (Müller's for most people, Cunningham's for people who train a lot). If body fat is unknown, it uses the Mifflin–St Jeor weight-and-height equation. The uncertainty band gets wider as the input gets less specific.",
      equation: `Mifflin–St Jeor (men):   10·W + 6.25·H − 5·A + 5
Mifflin–St Jeor (women): 10·W + 6.25·H − 5·A − 161
Cunningham (1980):       500 + 22·LBM
Katch–McArdle (= Cunningham 1991): 370 + 21.6·FFM
Müller FFM/FM-based (MJ/d, × 239.0 for kcal): 0.05192·FFM + 0.04036·FM + 0.869·S − 0.01181·A + 2.992
Nelson (kJ/d): 1114 + 90.4·FFM + 13.2·FM
(W kg, H cm, A years, S = 1 male / 0 female)`,
      keyNumbers: [
        {
          label: 'Where differences between people come from (150 adults)',
          value:
            '63% fat-free mass, 6% fat mass, 2% age, 26% unexplained; day-to-day variability 2% of the total',
          referenceIds: ['johnstone2005'],
        },
        {
          label: 'Mifflin–St Jeor in its unified form',
          value: '9.99·W + 6.25·H − 4.92·A + 166·S − 161; R² = 0.71; n = 498, ages 19–78 y, 234 with obesity',
          note: 'A fat-free-mass-only variant was 19.7·FFM + 413 (R² = 0.64).',
          referenceIds: ['mifflin1990'],
        },
        {
          label: 'Other published equations',
          value:
            'Harris–Benedict revised 1984, men: 88.362 + 13.397·W + 4.799·H − 5.677·A; women: 447.593 + 9.247·W + 3.098·H − 4.330·A. Athletes (ten Haaf and Weijs): REE (kJ) = 95.272·FFM + 2026.161, i.e. 22.77·FFM + 484.3 kcal',
          note: 'The original 1919 Harris–Benedict over-estimated measured REE by about 5% in the Mifflin sample, and its precision is about ±14%.',
          referenceIds: ['roza1984', 'mifflin1990', 'tenhaaf2014'],
        },
        {
          label: 'Accuracy of Mifflin in US adults aged 18–65 with BMI 25–40 (n = 338)',
          value: '79% within ±10% of measured; bias −1.0%; RMSE 136 kcal/d',
          note: 'For comparison: FAO/WHO/UNU weight equation in Dutch adults with overweight, 68% within ±10% (bias −2.5%, RMSE 178); Lazzer in Dutch adults with obesity, 69% (bias −3.0%, RMSE 215).',
          referenceIds: ['weijs2008'],
        },
        {
          label: 'Systematic review of resting-rate equations (non-obese and obese adults)',
          value: 'Mifflin had the highest share of predictions within ±10% and the narrowest range of error',
          note: 'The exact percentages usually quoted (about 82% in non-obese and 70–75% in obese adults) could not be confirmed against the original paper.',
          referenceIds: ['frankenfield2005'],
        },
        {
          label: 'Recreational athletes aged 18–35 (n = 90)',
          value:
            'Cunningham and the new fat-free-mass and weight equations were best; Harris–Benedict, WHO, Schofield, Mifflin and Owen were all under 50% within ±10%',
          referenceIds: ['tenhaaf2014'],
        },
        {
          label: 'Master athletes aged 35–84 (79 men, 34 women): share of men within ±10%',
          value: 'Harris–Benedict 48%, WHO 63%, Müller 66%, Müller-FFM 66%, Cunningham 68%, De Lorenzo 72%',
          note: 'Cunningham over-predicted by about 77 kcal/d (4%); Harris–Benedict under-predicted by about 175 kcal/d (12%).',
          referenceIds: ['fringsmeuthen2021'],
        },
        {
          label: 'Measurement floor',
          value:
            'Repeat-measurement CV of resting energy expenditure 5.0–5.6% (fat-free mass 1.3–1.6%); between-person CV of fat-free-mass-adjusted REE 10.4–13.6%; total error about 8%; residual SD after adjusting for body cell mass 89 kcal/d (5.5%)',
          referenceIds: ['bader2005', 'welle1990'],
        },
        {
          label: 'Worked check, man aged 35, 180 cm, 90 kg, 25% fat (FFM 67.5, FM 22.5)',
          value:
            'Mifflin 1855; revised Harris–Benedict 1959; Katch–McArdle 1828; Cunningham 1980 1985; Müller weight-based 1898; Müller FFM-based 1879; Oxford 1863 kcal/d',
          note: 'Woman aged 30, 165 cm, 65 kg, 30% fat: Mifflin 1370; revised Harris–Benedict 1430; Katch–McArdle 1353; Müller FFM-based 1383; Oxford 1348 kcal/d.',
          referenceIds: [
            'mifflin1990',
            'roza1984',
            'cunningham1980',
            'cunningham1991',
            'muller2004',
            'henry2005',
          ],
        },
        {
          label: 'Uncertainty assigned to the starting RMR (coefficient of variation)',
          value: '0.06 if measured; 0.08 if body fat is known; 0.10 if body fat is unknown',
          note: 'Even with the best equation, 21–32% of individuals fall outside ±10%.',
          referenceIds: ['weijs2008'],
        },
      ],
      timeCourse:
        'This is a starting value. It changes over time only through the body-composition, age and adaptation terms described in the other entries.',
      moderators:
        'Fat-free mass is the main driver, followed by fat mass, age and sex. Training status matters: fat-free-mass equations do better than weight equations in athletes. Organ size explains part of the rest: adding high-metabolic-rate organs and brain mass raised explained variance from 70% to 75% and removed age, sex and race effects, and smaller organ mass (3.1 kg against 3.4 kg) explained more than half of the lower fat-free-mass-adjusted REE of African-American compared with white adults.',
      grade: 'A',
      gradeReason:
        'Several validation studies and a systematic review agree that fat-free mass is the main driver and that Mifflin is the best weight-based equation; individual coefficients are grade B.',
      status: 'established',
      caveats:
        'Some coefficients were transcribed from secondary sources and are unverified: the Oxford/Henry equations, and the Müller weight-based constant, which is 3.21 in most sources but printed as 3.31 in one paper (a difference of 24 kcal/d). The switch to Cunningham at a fat-free-mass index of 20 or more for men (17 for women) is a proposed rule of thumb.',
      referenceIds: [
        'mifflin1990',
        'roza1984',
        'cunningham1980',
        'cunningham1991',
        'muller2004',
        'henry2005',
        'nelson1992',
        'frankenfield2005',
        'weijs2008',
        'tenhaaf2014',
        'fringsmeuthen2021',
        'johnstone2005',
        'bader2005',
        'welle1990',
        'javed2010',
        'gallagher2006',
      ],
      relatedMetricIds: ['rmr', 'tdee', 'maintenance'],
    },
    {
      id: '02-tissue-specific-resting-cost',
      title: 'What each kilogram of tissue costs at rest, and how resting rate updates',
      category: 'energy',
      summary:
        "Resting metabolism is the sum of what each organ burns. Per kilogram, heart and kidneys burn the most, then brain, then liver, and skeletal muscle burns about the same as the body's remaining tissue. Fat burns least. When weight changes, the resting rate moves by an amount that depends on which tissues change, and shifts in glycogen and water change fat-free mass with almost no metabolic effect.",
      howModelled:
        'Resting rate is updated each day from the starting value using a per-kilogram cost for fat-free mass, a separate cost for muscle gained through training, and a cost for fat mass. Glycogen, the water bound to it and extracellular fluid are excluded, because water has no metabolic rate.',
      equation:
        'RMR_mass(t) = RMR0 + γ_L·[(FFM_act(t) − SM_RT(t)) − FFM_act0] + γ_SM·SM_RT(t) + γ_F·(FM(t) − FM0)',
      keyNumbers: [
        {
          label: 'Organ rates (kcal per kg per day)',
          value:
            'Heart 440, kidneys 440, brain 240, liver 200, skeletal muscle 13, residual tissue 12, adipose tissue 4.5',
          referenceIds: ['wang2010', 'gallagher1998'],
        },
        {
          label: 'Marginal cost per kg of fat-free mass',
          value: 'γ_L = 22 kcal/kg/d (92 kJ), uncertainty 19.7–22.8',
          note: 'Regression from the Lancet model appendix, which used Nelson; Mifflin gives 19.7 and Cunningham 21.6–22.',
          referenceIds: ['hall2011a', 'nelson1992', 'mifflin1990', 'cunningham1980', 'cunningham1991'],
        },
        {
          label: 'Marginal cost per kg of fat mass',
          value: 'γ_F = 3.2 kcal/kg/d (13 kJ), uncertainty 3.1–4.5',
          note: 'Adipose tissue is 4.5 in the organ table, and the 2006 model used 4.5.',
          referenceIds: ['nelson1992', 'hall2011a', 'wang2010', 'hall2006'],
        },
        {
          label: 'Marginal cost per kg of skeletal muscle',
          value: 'γ_SM = 13 kcal/kg/d, uncertainty 12.6–13',
          referenceIds: ['wang2010'],
        },
        {
          label: 'Glycogen, its water and extracellular fluid',
          value: 'γ = 0 (a modelling choice)',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'Partial coefficients that carry their own sex and age terms',
          value: 'Müller FFM-based: FFM 12.4, FM 9.6 kcal/kg/d. Master athletes model 3: FFM 20.5, FM 4.6',
          note: 'These are not for updating resting rate as weight changes.',
          referenceIds: ['muller2004', 'fringsmeuthen2021'],
        },
        {
          label: 'Organ shrinkage after 3 weeks at −50% energy',
          value: 'Skeletal muscle −5%, liver −13%, kidneys −8%',
          referenceIds: ['muller2015'],
        },
        {
          label: 'Composition can look like adaptation (32 young men)',
          value:
            'After 21 d of restriction, adaptive thermogenesis adjusted for fat-free mass alone was −116 ± 127 kcal/d, but −83 to −122 after adjusting for organ and molecular composition. After 14 d of overfeeding it was +27 ± 115 (not significant) and +86 to +87 after adjusting',
          referenceIds: ['muller2021'],
        },
      ],
      timeCourse: 'Instant. The resting rate changes at once with body composition.',
      moderators:
        'Which tissue changes: organs shrink proportionally more than muscle in energy restriction. No other moderators are modelled.',
      grade: 'B',
      gradeReason:
        'The organ rates were validated against MRI and calorimetry and regression coefficients agree across studies, but excluding glycogen and water is a modelling choice (grade C).',
      status: 'established',
      caveats:
        'The engine does not track organ masses, so the true cost of a kilogram of fat-free mass lost may differ from 22 kcal/kg/d when organs shrink disproportionately. The adaptation parameters were fitted against data adjusted for fat-free mass, so the same per-kilogram cost is used for non-muscle fat-free mass throughout.',
      referenceIds: [
        'wang2010',
        'gallagher1998',
        'hall2011a',
        'nelson1992',
        'mifflin1990',
        'cunningham1980',
        'cunningham1991',
        'hall2006',
        'muller2004',
        'fringsmeuthen2021',
        'muller2015',
        'muller2021',
      ],
      relatedMetricIds: ['rmr'],
    },
    {
      id: '02-age-and-sex-effects',
      title: 'Age and sex effects on energy expenditure',
      category: 'energy',
      summary:
        'Once body composition is accounted for, energy expenditure is roughly steady from the twenties to the early sixties and then falls by a little under one per cent a year. Sex differences that remain after adjusting for fat-free and fat mass are small, and studies disagree about them.',
      howModelled:
        "If the chosen resting-rate equation already has an age term (Mifflin and Müller do), nothing extra is added. Otherwise a factor of 1 is used up to age 63 and a decline of 0.7% per year after that. No extra sex offset is added beyond the chosen equation's own sex term.",
      equation: `f_age(A) = 1                     for A ≤ 63
f_age(A) = 1 − 0.007·(A − 63)    for A > 63`,
      keyNumbers: [
        {
          label: 'Large doubly labelled water database (n = 6,421; ages 8 days to 95 years)',
          value:
            'Adjusted total expenditure stable from 20 to 60 y; break at 63.0 y (95% CI 60.1–65.9), then −0.7 ± 0.1 %/y',
          note: 'Adjusted basal expenditure falls at a similar rate with an earlier, imprecise break (46.5 y, 40.6–52.4). In the 90s, adjusted expenditure is about 26% below mid-life.',
          referenceIds: ['pontzer2021'],
        },
        {
          label: 'Organ rates after age 50',
          value: 'About 3% lower',
          referenceIds: ['wang2010'],
        },
        {
          label: 'Age slopes already inside the equations',
          value: 'Mifflin −5 kcal/d per year; Müller FFM/FM-based −2.8 kcal/d per year',
          referenceIds: ['mifflin1990', 'muller2004'],
        },
        {
          label: 'Sex after adjusting for fat-free and fat mass',
          value:
            'No effect on total expenditure in the life-course data; no significant effect on basal rate in 150 adults',
          referenceIds: ['pontzer2021', 'johnstone2005'],
        },
        {
          label: 'Chamber studies (235 studies)',
          value: 'Adjusted sedentary 24-hour expenditure was 124 ± 38 kcal/d lower in women (about 5–10%)',
          note: 'The Müller FFM-based equation carries +0.869 MJ (+208 kcal) for men.',
          referenceIds: ['ferraro1992', 'muller2004'],
        },
      ],
      timeCourse:
        "Negligible in simulations shorter than a year. For multi-year runs, age is updated daily using the chosen equation's age slope.",
      moderators: 'Age (after about 63 years), and sex through the chosen equation only.',
      grade: 'B',
      gradeReason:
        'The age pattern comes from a very large dataset (grade A), but applying it to resting rate is less certain and the sex evidence is conflicting (grade B).',
      status: 'established',
      caveats:
        'Different studies disagree on whether women burn less after adjustment, so the model adds no extra sex offset.',
      referenceIds: ['pontzer2021', 'wang2010', 'mifflin1990', 'muller2004', 'johnstone2005', 'ferraro1992'],
      relatedMetricIds: ['rmr'],
    },
    {
      id: '02-cycle-temperature-caffeine',
      title: 'Menstrual cycle, body temperature, caffeine and cold',
      category: 'energy',
      summary:
        'A few small factors nudge resting expenditure. Resting rate is somewhat higher in the second half of the menstrual cycle, rises with fever, and rises briefly after caffeine. Cold exposure raised expenditure in lean people in one study but not in people with obesity. All these effects are small compared with the uncertainty in baseline expenditure.',
      howModelled:
        'Each factor adds a small percentage or a fixed amount to resting expenditure: about 5% during the luteal phase, about 11% per degree Celsius of core temperature rise, and a per-milligram amount of caffeine up to 600 mg a day. The cycle effect is switched off with hormonal contraception or after menopause, and cold is only shown as a note.',
      equation: `ΔRMR_cycle(d) = a_lut · RMR · s(d),   a_lut = 0.05 (range 0.02–0.09)
    s(d) = 1 on luteal days (about day 15–28 of a 28-day cycle), 0 in the follicular phase, with 2-day ramps
ΔRMR_temp = 0.11 · RMR · ΔT_core (°C),   valid for |ΔT| ≤ 2 °C
ΔEE_caff = k_caff · min(caffeine_mg, 600),   k_caff = 0.25 kcal/mg (lean; 0.13 post-obese/obese)`,
      keyNumbers: [
        {
          label: 'Menstrual cycle meta-analysis (26 studies, 318 women)',
          value:
            'Resting rate higher in the luteal phase, effect size 0.33 (95% CI 0.17–0.49); in studies since 2000, 0.23 (−0.00 to 0.47, not significant)',
          referenceIds: ['benton2020'],
        },
        {
          label: 'Individual studies of the luteal phase',
          value:
            'Adjusted 24-hour expenditure +106 ± 39 kcal/d; +9% by direct calorimetry (8 of 10 women +8–16%); sleeping metabolic rate +6.1 (SD 2.7)% late-luteal vs late-follicular, 24-hour change not significant',
          referenceIds: ['ferraro1992', 'webb1986', 'bisdee1989'],
        },
        {
          label: 'Temperature',
          value: 'Each 1 °C rise in core temperature raises oxygen use by about 10–13%',
          note: 'From a secondary source citing classic data. Calorie restriction lowers core temperature (direction only).',
          referenceIds: ['landsberg2009', 'heilbronn2006'],
        },
        {
          label: 'Caffeine',
          value:
            '100 mg raises resting rate 3–4% for 150 min; 100 mg every 2 h for 12 h (600 mg/d) raised daytime expenditure 8–11%, with no effect at night, net +150 kcal/d (lean) and +79 kcal/d (post-obese)',
          note: 'The effect is dose-dependent over 100–400 mg.',
          referenceIds: ['dulloo1989', 'astrup1990'],
        },
        {
          label: 'Cold',
          value: '48 h at 16 °C vs 22 °C raised daytime expenditure in lean but not obese subjects',
          note: 'The change was related to reduced physical activity, and obese subjects mostly increased insulation. Not modelled quantitatively.',
          referenceIds: ['wijers2010'],
        },
      ],
      timeCourse:
        'The cycle term follows the luteal phase; caffeine acts for a few hours after each dose. Habituation to caffeine is not modelled because it is unknown.',
      moderators:
        "Cycle phase (off with hormonal contraception or after menopause: one woman's 14% luteal rise disappeared on the contraceptive pill), caffeine dose, and leanness (the caffeine effect was smaller in post-obese subjects).",
      grade: 'C',
      gradeReason:
        'The cycle effect has a meta-analysis (grade B), but the temperature and caffeine terms rest on small or acute studies, so we show the lower grade.',
      status: 'proposed-fit',
      caveats:
        'The cycle and caffeine equations are fits by Vitals to the data points above, and the temperature coefficient is a simple rule. These terms are small and may be dropped from a first release.',
      referenceIds: [
        'benton2020',
        'ferraro1992',
        'webb1986',
        'bisdee1989',
        'landsberg2009',
        'heilbronn2006',
        'dulloo1989',
        'astrup1990',
        'wijers2010',
      ],
      relatedMetricIds: ['rmr', 'tdee'],
    },
    {
      id: '02-thermic-effect-of-food',
      title: 'The energy cost of digesting food (thermic effect of food)',
      category: 'energy',
      summary:
        'Digesting, absorbing and storing food costs energy, and part of the cost comes from the nervous system. This is the thermic effect of food (TEF). By share of the energy eaten, alcohol costs the most, then protein, then carbohydrate, then fat. On a mixed diet the total is roughly a tenth of the energy eaten.',
      howModelled:
        'Each day the engine takes the energy in protein, carbohydrate, fat, alcohol and fibre, multiplies each by its own fraction, and adds them up. It then applies optional multipliers for insulin resistance and for ultra-processed food. It has no meal-frequency term, because 24-hour expenditure did not differ between few large meals and many small ones.',
      equation: `E_P = 4.0·P_g;  E_C = 4.0·C_avail_g;  E_F = 9.0·F_g;  E_alc = 7.0·alc_g;  E_fib = 2.0·fibre_g
TEF = m_IR · m_proc · [ 0.25·E_P + 0.075·E_C + E_F·(0.025 + 0.065·f_MCT) + 0.20·E_alc + 0.30·E_fib ]
m_IR = 1 − 0.25·IR        (insulin-resistance index IR from 0 to 1; proposed)
m_proc = 1 − 0.45·f_UPF·u  (f_UPF = energy share from ultra-processed food; u = 0 by default)`,
      keyNumbers: [
        {
          label: 'Protein',
          value: '0.25 of its energy (range 0.20–0.30)',
          referenceIds: ['hall2006', 'westerterp2004', 'tappy1996', 'fao2003'],
        },
        {
          label: 'Available carbohydrate',
          value: '0.075 (range 0.05–0.10)',
          referenceIds: ['hall2006', 'westerterp2004', 'tappy1996'],
        },
        {
          label: 'Fat (long-chain)',
          value: '0.025 (range 0–0.03); medium-chain fat 0.09 (range 0.05–0.10, proposed)',
          referenceIds: ['hall2006', 'westerterp2004', 'tappy1996', 'quatela2016'],
        },
        {
          label: 'Alcohol',
          value: '0.20 (range 0.10–0.30)',
          note: 'With 95.6 g/d of alcohol taken with meals, 24-hour expenditure rose 5.5 ± 1.2% and the thermic effect was 22.5 ± 4.7%; fasting, 17.1 ± 2.2%. Another study found no systematic inefficiency.',
          referenceIds: ['suter1994', 'weststrate1990', 'westerterp2004', 'fao2003'],
        },
        {
          label: 'Dietary fibre (counted at 2.0 kcal/g)',
          value: '0.30 (range 0–0.30, proposed); set to 0 if fibre is already counted at 1.4 kcal/g',
          referenceIds: ['fao2003'],
        },
        {
          label: 'Typical mixed diet',
          value: 'About 9–10% of energy intake (20/45/35 %E protein/carbohydrate/fat gives 9.2%)',
          referenceIds: ['westerterp2004'],
        },
        {
          label: 'Chamber check in lean women',
          value:
            '29/61/10 %E protein/carbohydrate/fat: 14.6 ± 2.9%; 9/30/61: 10.5 ± 3.8%. The formula gives 12.1% and 6.0%',
          note: 'Absolute chamber values are higher because chamber thermic effect is measured above sleeping metabolic rate rather than basal rate.',
          referenceIds: ['westerterpplantenga1999', 'westerterp2004'],
        },
        {
          label: 'Meal frequency and 24-hour expenditure',
          value:
            '3 vs 6 meals: 8.7 vs 8.6 MJ/d; 3 vs 14 meals: total 12.3 vs 12.1 MJ/d (not significant), thermic effect 1.3 vs 1.0 MJ/d (p = 0.094)',
          note: 'Acutely, a single large meal produces more than the same food as 4–6 small meals (p = 0.02).',
          referenceIds: ['ohkawara2013', 'munsters2012', 'bellisle1997', 'quatela2016'],
        },
        {
          label: 'Food processing (17 people)',
          value:
            'Whole-food sandwich meal 137 ± 14 kcal (19.9% of the meal) vs processed 73 ± 10 kcal (10.7%), so a multiplier of about 0.55 for a fully processed meal',
          note: 'One study, so the effect is off by default. In a 6-week whole-grain versus refined-grain trial, resting rate rose 43 ± 25 kcal/d and stool energy 57 kcal/d, a net 92 kcal/d (95% CI 28–156).',
          referenceIds: ['barr2010', 'karl2017'],
        },
        {
          label: 'Protein meta-analysis',
          value:
            'Acute higher- vs lower-protein meals: standardised difference 0.45 (0.26–0.65). Chronic (4 days to 1 year): total expenditure 0.29 (0.10–0.48), resting 0.18 (0.01–0.35), thermic effect 0.10 (not significant)',
          referenceIds: ['guarneiri2024'],
        },
        {
          label: 'Obesity and insulin resistance',
          value:
            'Of 29 well-matched lean-versus-obese studies, 22 found significantly lower thermic effect in obesity',
          referenceIds: ['dejonge1997', 'granata2002', 'tappy1996'],
        },
      ],
      timeCourse:
        "The response after a meal lasts more than 6 hours, especially in obesity. At daily resolution the engine treats it as immediate. For within-day curves, each meal's cost is spread over about 6 hours (proposed).",
      moderators:
        'Macronutrient mix, amount eaten (thermic effect rises about linearly with meal size: +1.1 kJ/h, adjusted 1.2, per +100 kJ eaten), obesity and insulin resistance, food processing, medium-chain fat, alcohol and fibre. Age and activity may also matter but are not quantified in the review cited here.',
      grade: 'B',
      gradeReason:
        'The ordering and the roughly 10% total are well supported (grade A) and the main coefficients are grade B, but the fibre, medium-chain fat, processing and insulin-resistance multipliers are grade C.',
      status: 'established',
      caveats:
        'The multipliers for insulin resistance, food processing, fibre and medium-chain fat are proposed and lack pooled human estimates. The insulin-resistance multiplier ranges from 0.7 to 1.0. Methods differ a lot between studies of obesity.',
      referenceIds: [
        'hall2006',
        'westerterp2004',
        'tappy1996',
        'quatela2016',
        'guarneiri2024',
        'suter1994',
        'weststrate1990',
        'dejonge1997',
        'granata2002',
        'barr2010',
        'karl2017',
        'bellisle1997',
        'munsters2012',
        'ohkawara2013',
        'fao2003',
        'westerterpplantenga1999',
        'calcagno2019',
      ],
      relatedMetricIds: ['tef', 'tdee'],
    },
    {
      id: '02-protein-turnover-cost',
      title: 'The extra resting cost of eating more protein',
      category: 'energy',
      summary:
        "Eating more protein speeds up the body's continual building and breaking down of its own protein, and this costs energy beyond the digestion cost. In overfeeding and chamber studies, higher protein intakes raised resting and sleeping expenditure by tens to a couple of hundred kilocalories a day.",
      howModelled:
        "The engine tracks a smoothed protein intake with a lag of about 2 days. The gap between that and the person's habitual intake raises or lowers resting expenditure by about 0.6 kcal for each extra gram of protein a day. It applies only between 0.4 and 3.5 g of protein per kg of body weight.",
      equation: `dP_eff/dt = (P(t) − P_eff)/τ_P,   τ_P = 2 d
ΔRMR_prot = k_P · (P_eff − P0),   k_P = 0.6 kcal per (g/d), range 0.3–1.1`,
      keyNumbers: [
        {
          label: 'Biochemical cost of protein turnover',
          value:
            'Synthesis 0.86 kcal/g, degradation 0.17 kcal/g: about 1.0 kcal per g turned over; turnover is about 20% of resting rate',
          referenceIds: ['hall2006', 'welle1990'],
        },
        {
          label: 'Overfeeding by 954 kcal/d for 8 weeks (25 adults) at 5 / 15 / 25 %E protein',
          value:
            'Weight +3.16 / +6.05 / +6.51 kg; resting expenditure +0 / +160 (102–218) / +227 (165–289) kcal/d; lean mass +2.87 / +3.18 kg (normal / high protein); fat gain similar in all',
          referenceIds: ['bray2012'],
        },
        {
          label: 'Four days at energy balance, 30 vs 10 %E protein',
          value: 'Sleeping metabolic rate 6.40 vs 6.12 MJ/d (+67 kcal); thermic effect 0.91 vs 0.69 MJ/d',
          referenceIds: ['lejeune2006'],
        },
        {
          label: 'Replacing carbohydrate with 17–18 %E pork protein',
          value: '24-hour expenditure +3.9% (+492 kJ, about 118 kcal)',
          referenceIds: ['mikkelsen2000'],
        },
        {
          label: 'Protein during restriction',
          value:
            'On 4.2 MJ/d, 36 %E protein attenuated the fall in 24-hour expenditure and sleeping metabolic rate compared with 15%; about 34 months after weight loss, 25 vs 15 %E protein abolished the below-predicted resting expenditure and produced negative energy balance',
          referenceIds: ['whitehead1996', 'drummen2020'],
        },
        {
          label: 'Data points behind k_P (kcal per extra g/d of protein)',
          value:
            '0.63 (Lejeune), 1.15 and 0.94 (Bray, normal and high vs low), 0.31 (Mikkelsen); mechanistic ceiling about 1.0',
          note: 'After removing the thermic effect and the lean-mass effect.',
          referenceIds: ['lejeune2006', 'bray2012', 'mikkelsen2000', 'hall2006'],
        },
        {
          label: 'Chamber overfeeding with fat vs protein',
          value:
            'Excess energy as fat did not raise 24-hour expenditure on day 1; excess with protein raised 24-hour and sleeping expenditure acutely in relation to protein intake',
          referenceIds: ['bray2015'],
        },
      ],
      timeCourse: 'Onset within 1 day, so the lag is set to 2 days.',
      moderators: 'Unknown.',
      grade: 'C',
      gradeReason:
        'It rests on a few controlled studies of different designs; the direction is better supported (grade B) than the size.',
      status: 'proposed-fit',
      caveats: 'The coefficient k_P is a fit by Vitals to four small studies with different designs.',
      referenceIds: [
        'hall2006',
        'welle1990',
        'bray2012',
        'bray2015',
        'lejeune2006',
        'mikkelsen2000',
        'whitehead1996',
        'drummen2020',
      ],
      relatedMetricIds: ['rmr', 'tdee'],
    },
    {
      id: '02-neat-activity-steps',
      title: 'Everyday movement (NEAT), activity levels and steps',
      category: 'energy',
      summary:
        'Non-exercise activity thermogenesis (NEAT) is the energy spent on everything that is not sleeping, eating or deliberate exercise: standing, walking around, fidgeting. It is large and varies a lot between people. In overfeeding it was the most variable part of the extra expenditure. In energy restriction, it tends to fall.',
      howModelled:
        'Baseline NEAT is what remains of total expenditure after resting rate, digestion and planned exercise. It scales with body weight, moves with the number of steps, and carries the adaptive part of the metabolic slowing in the adaptation entry.',
      equation: `NEAT0 = PAL0·RMR0 − RMR0 − TEF0 − EAT0    (floor 0.10·RMR0)
NEAT(t) = NEAT0·(BW(t)/BW0) + k_step·BW(t)·(steps(t) − steps0) + AT_N(t)
k_step = 0.00044 kcal per kg per step   (derived)`,
      keyNumbers: [
        {
          label: 'Size of activity expenditure (332 adults, five populations)',
          value:
            'About 600 kcal/d (about 27% of total expenditure) even at 0 accelerometer counts; adopting lean-type NEAT would add about 350 kcal/d',
          referenceIds: ['pontzer2016', 'levine2005'],
        },
        {
          label: 'Overfeeding by 1000 kcal/d for 8 weeks (16 non-obese adults)',
          value:
            'Weight +4.7 ± 1.8 kg; basal rate +0.33 ± 0.53 MJ/d (+79 kcal); digestion +0.58 ± 0.35 MJ/d (+139 kcal); NEAT +1.38 ± 1.08 MJ/d (+330 ± 258 kcal), two-thirds of the rise in expenditure',
          note: 'The change in NEAT predicted resistance to fat gain (r = 0.77), and fat gain varied about 10-fold. Individual NEAT changes from −98 to +692 kcal/d and fat gain of 0.36–4.23 kg come from secondary summaries and are unverified.',
          referenceIds: ['levine1999a', 'joosen2006'],
        },
        {
          label: 'Calorie restriction studies',
          value:
            'Free-living activity level fell at month 3 with 25% restriction and with an 890 kcal/d diet; body-composition-adjusted total expenditure −431 ± 51 (month 3) and −240 ± 83 kcal/d (month 6)',
          referenceIds: ['martin2007', 'redman2009'],
        },
        {
          label: 'Systematic review (36 studies, 1561 participants)',
          value:
            'NEAT compensation in 63% of diet-only, 27% of diet-plus-exercise and 23% of exercise-only arms; weight loss was about twice as large in those who compensated',
          referenceIds: ['silva2018'],
        },
        {
          label: 'Long-term restriction studies',
          value:
            'Biosphere 2 (2 years): adjusted 24-hour expenditure −6% and spontaneous activity −45%, both still lower 6 months after exit. Minnesota (−56% energy for 24 weeks): activity coefficient fell from 26 to 9 kcal/kg/d (−65%)',
          referenceIds: ['weyer2000', 'hall2006'],
        },
        {
          label: 'Muscle work efficiency',
          value:
            'At reduced weight, +26.5 ± 26.7%, accounting for about 35% of the fall in non-resting expenditure; at +10% weight, −17.8 ± 20.5%',
          referenceIds: ['rosenbaum2003'],
        },
        {
          label: 'Cost of a step (derived)',
          value:
            '0.0285 kcal per step, or about 0.00044 kcal/kg/step. From 8,973 to 29,588 steps/d, 24-hour expenditure rose 2228 to 2816 kcal (PAL 1.42 to 1.82) in 64.5 kg men',
          note: 'In 41 free-living adults, PAL (1.73 ± 0.15) was not correlated with step count (10,022 ± 2,605). Fewer than 5000 steps/d is a step-defined sedentary index.',
          referenceIds: ['ohkawara2011', 'tudorlocke2013'],
        },
        {
          label: 'Activity-level multipliers',
          value:
            'FAO/WHO/UNU 2004: sedentary/light 1.40–1.69, active 1.70–1.99, vigorous 2.00–2.40 (above 2.40 is hard to maintain). NASEM 2023: inactive 1.00–1.53, low active 1.53–1.68, active 1.68–1.85, very active 1.85–2.50',
          note: 'One category step is about 200–300 kcal/d.',
          referenceIds: ['fao2004', 'nasem2023'],
        },
        {
          label: 'Person-to-person spread',
          value: 'SD of the NEAT response to overfeeding about 0.26 × the change in intake',
          referenceIds: ['levine1999a', 'joosen2006'],
        },
      ],
      timeCourse:
        'Free-living activity fell by month 3 in restriction studies, so the adaptive NEAT term is built up over about 14 days in the adaptation entry.',
      moderators:
        'Occupation, posture, fidgeting (NEAT is also biologically modulated), body weight, step count and energy balance (NEAT tends to fall in deficit and rise in surplus, with wide variation).',
      grade: 'B',
      gradeReason:
        'NEAT size and variance, the direction of its fall in deficit, and the step cost are grade B, though the size of the deficit-related fall is grade C.',
      status: 'established',
      caveats:
        'Self-reported activity categories are easily misclassified, steps track activity level poorly, expenditure levels off at high activity, and activity levels scale expenditure with resting rate although real activity cost scales with body weight. The step cost is derived from one small calorimeter study.',
      referenceIds: [
        'pontzer2016',
        'levine2005',
        'levine2004',
        'levine1999a',
        'joosen2006',
        'martin2007',
        'redman2009',
        'silva2018',
        'weyer2000',
        'hall2006',
        'rosenbaum2003',
        'ohkawara2011',
        'tudorlocke2013',
        'fao2004',
        'nasem2023',
      ],
      relatedMetricIds: ['neat', 'tdee'],
    },
    {
      id: '02-constrained-energy-expenditure',
      title: 'Does exercise add calories one for one? (constrained expenditure)',
      category: 'energy',
      summary:
        'Some large datasets suggest the body compensates for extra activity by spending less elsewhere, so total expenditure rises by less than the activity adds. This compensation was larger at higher body fat. Trials of exercise programmes mostly find that people close the gap by eating more, not by burning less. So the evidence conflicts.',
      howModelled:
        "Extra activity energy is averaged over about 60 days. A share of that average, larger at higher BMI, is subtracted from resting expenditure. With unknown BMI the engine uses 0.28. The planner tests values from 0 to 0.46. The eating-more route is not modelled here, because Vitals' intake is set by the schedule.",
      equation: `A_extra(t) = max(0, NEAT(t) + EAT(t) − NEAT0 − EAT0)
dAbar/dt = (A_extra − Abar)/τ_c,   τ_c = 60 d (range 30–180)
C_comp = c(BMI) · Abar
c(BMI) = clamp( 0.30 + (0.46 − 0.30)·(BMI − 20)/15, 0.30, 0.46 )`,
      keyNumbers: [
        {
          label: 'Plateau of total expenditure with activity',
          value:
            'Rose only up to about 230 counts/min/d; above 219 counts/min, each +100 counts/min added less than 50 kcal/d',
          referenceIds: ['pontzer2016'],
        },
        {
          label: 'Energy compensation in 1,754 adults (IAEA database)',
          value:
            'TEE–BEE slope 0.723 ± 0.049 (95% CI 0.626–0.820), so compensation is 27.7% (about 18–37%), through reduced basal expenditure, similar by sex and age',
          note: 'Compensation rose with adiposity: 29.7% at the 10th percentile of BMI and 45.7% at the 90th.',
          referenceIds: ['careau2021'],
        },
        {
          label: 'After large weight loss with vigorous exercise',
          value:
            'At 6 years, weight-loss maintainers had increased physical activity by 160 ± 23% vs 34 ± 25% in regainers',
          note: 'The persistent resting suppression in a well-known televised weight-loss cohort has been reinterpreted as compensation for a large sustained rise in activity.',
          referenceIds: ['hall2022', 'kerns2017'],
        },
        {
          label: 'Trials showing little compensation in expenditure',
          value:
            '10 months of aerobic training (400 or 600 kcal/session, 5 d/wk): no compensatory fall in non-exercise expenditure. 24 weeks (8 or 20 kcal/kg/wk): compensation of 1.5 and 2.7 kg explained by higher intake (+91 and +124 kcal/d); resting rate and non-exercise activity unchanged',
          referenceIds: ['willis2014', 'martin2019'],
        },
        {
          label: 'Other randomised trial evidence',
          value:
            'In a 24-week trial, 48% of exercisers showed compensation (−308 ± 158 kcal/d) with no metabolic adaptation in 24-hour, sleep or resting expenditure. Across 23 training studies, the initial imbalance (about 2 MJ/d) decays exponentially to about 0 by about 1 year, most likely through intake',
          referenceIds: ['flanagan2024', 'westerterp2018'],
        },
        {
          label: 'Settings used by the planner',
          value: 'Default 0.28 when BMI is unknown; compensation share tested between 0 and 0.46',
          referenceIds: ['careau2021'],
        },
      ],
      timeCourse: 'The 60-day averaging time is a guess (range 30–180 days) with no direct data.',
      moderators:
        'Body fat or BMI (compensation is larger at higher adiposity), and the size and duration of the extra activity.',
      grade: 'C',
      gradeReason:
        'Large datasets support partial compensation (grade B), but the within-person time course and size in prospective trials are grade C because randomised trials conflict.',
      status: 'contested',
      caveats:
        'The time constant and the mapping from BMI percentiles to BMI 20 and 35 are unverified guesses. Compensation through eating more is not modelled here.',
      referenceIds: [
        'pontzer2016',
        'careau2021',
        'hall2022',
        'kerns2017',
        'willis2014',
        'martin2019',
        'flanagan2024',
        'westerterp2018',
      ],
      relatedMetricIds: [],
    },
    {
      id: '02-adaptive-thermogenesis-deficit',
      title: 'Metabolic adaptation when eating less',
      category: 'energy',
      summary:
        'Adaptive thermogenesis (metabolic adaptation) is a fall in energy expenditure beyond what the loss of body tissue explains. It has a resting part, from the nervous system, thyroid, insulin and the shrinking of organs, and a non-resting part, from less everyday movement and more efficient muscles. It is real but modest: typically 50–150 kcal/d at rest. It is hard to measure, because it is a leftover from several error-prone measurements.',
      howModelled:
        'The engine takes 14% of the change in intake from the weight-stable baseline as the target adaptation, and splits it 40% resting and 60% non-resting. The resting part builds with a time constant of 7 days and the non-resting part with 14 days. Both relax back with a time constant of 14 days once the target shrinks. At a new lower weight, the maintenance intake is still below the old baseline, so some adaptation remains until intake returns to baseline.',
      equation: `ΔEI(t) = EI(t) − EI0
AT*(t) = β_AT · ΔEI(t),   β_AT = 0.14
AT_R* = (1 − σ)·AT*,   AT_N* = σ·AT*,   σ = 0.6
AT_R ← AT_R + (AT_R* − AT_R)·(1 − exp(−Δt/τ_R)),   τ_R = 7 d if building, τ_off = 14 d otherwise
AT_N ← AT_N + (AT_N* − AT_N)·(1 − exp(−Δt/τ_N)),   τ_N = 14 d if building, τ_off = 14 d otherwise`,
      keyNumbers: [
        {
          label: 'Adaptation gain',
          value: 'β_AT = 0.14 (uncertainty 0.05–0.40)',
          note: 'From a steady-state analysis of 8 longitudinal weight-loss studies (157 subjects). Higher values fit some controlled studies; lower values fit the one-year and diet-break trials.',
          referenceIds: ['hall2011a', 'hall2008b'],
        },
        {
          label: 'Share going to non-resting expenditure',
          value: 'σ = 0.6 (0.4–0.8)',
          note: 'The 2006 model allocated 60% to physical-activity expenditure and 40% to resting rate.',
          referenceIds: ['hall2006'],
        },
        {
          label: 'Time constants',
          value: 'τ_R = 7 d (3–14); τ_N = 14 d (7–30); τ_off = 14 d (14–42)',
          note: 'Significant adaptation appeared within 3 days in one study and was full at 1 week in another; activity fell by month 3 in another. The reversal time is proposed from a halving within 4 weeks and from 2-week balance blocks that roughly halved the fall.',
          referenceIds: ['muller2015', 'heinitz2020', 'martin2007', 'martins2020', 'byrne2018'],
        },
        {
          label: 'Person-to-person spread (proposed)',
          value: 'SD = 0.11 × |ΔEI|, about 100–140 kcal/d at deficits of 1000–1500 kcal',
          referenceIds: ['martins2020', 'heinitz2020', 'muller2021'],
        },
        {
          label: 'Maintained weight loss of 10–20% (ward, liquid formula)',
          value:
            'Total expenditure −6 ± 3 (never-obese) and −8 ± 5 (obese) kcal per kg fat-free mass per day; resting and non-resting each −3 to −4',
          referenceIds: ['leibel1995', 'rosenbaum2010'],
        },
        {
          label:
            '6-month trial of overweight adults (25% restriction, restriction plus exercise, 890 kcal/d)',
          value:
            'Sedentary 24-hour expenditure −135 ± 42 / −117 ± 52 / −125 ± 35 kcal/d (about 6%); composition-adjusted total expenditure −431 ± 51 (month 3) and −240 ± 83 kcal/d (month 6)',
          referenceIds: ['heilbronn2006', 'redman2009'],
        },
        {
          label: '2 years at about 15% restriction (−8.7 kg)',
          value: '24-hour and sleeping expenditure 80–120 kcal/d below expected',
          referenceIds: ['redman2018'],
        },
        {
          label: 'Minnesota revisited (32 non-obese young men)',
          value:
            'Resting expenditure −266 kcal/d, of which adaptation 108 kcal/d (48% of the fall), or 72 after fat-free-mass composition; significant within 3 days; related to the fall in insulin (r = 0.92)',
          referenceIds: ['muller2015'],
        },
        {
          label: '6 weeks at −50% in 11 inpatients with obesity',
          value:
            '24-hour adaptation −178 ± 137 kcal/d at week 1, stable to week 6; each −100 kcal/d of adaptation meant 8195 kcal less deficit and 2.0 kg less loss',
          referenceIds: ['heinitz2020'],
        },
        {
          label:
            'Adaptation fades with energy balance (71 adults with obesity, 1000 kcal/d for 8 weeks then 4 weeks of stabilisation)',
          value:
            'Resting adaptation −92 ± 110 (week 9), −38 ± 124 (week 13), −7 ± 129 kcal/d (1 year, not significant); not related to regain',
          referenceIds: ['martins2020'],
        },
        {
          label: 'Other studies of the timeline',
          value:
            'Resting rate first falls at 5% weight loss (day 12, SEM 8); adaptation is transient at 10% loss (day 32, SEM 8): −460 (SEM 690) kJ/d (−110 kcal/d). In 65 women at 800 kcal/d to BMI 25 or below: −46 ± 113 kcal/d, which predicts a longer time to goal',
          referenceIds: ['nymo2018', 'martins2022'],
        },
        {
          label: 'Very large loss with vigorous exercise (televised weight-loss cohort)',
          value:
            'Resting adaptation −244 ± 231 (week 6), −504 ± 171 (week 30), −499 ± 207 at 6 years despite 41 kg regain',
          note: 'Adaptation correlated with energy imbalance (r = 0.55) and the fall in leptin (r = 0.47) in a comparison with gastric bypass.',
          referenceIds: ['johannsen2012', 'fothergill2016', 'knuth2014'],
        },
        {
          label: 'Long restriction and refeeding',
          value:
            'Biosphere 2 (2 years): adjusted 24-hour expenditure −6%, persisting 6 months after regain. Minnesota reanalysis: adaptation related to fat-mass depletion (r = 0.5), not fat-free-mass depletion',
          note: 'A review put the fall in 24-hour expenditure at 20–25%, i.e. 10–15% below composition-predicted (about 300–400 kcal/d), persisting.',
          referenceIds: ['weyer2000', 'dulloo1998', 'rosenbaum2008', 'rosenbaum2010'],
        },
        {
          label:
            'Diet breaks: 16 weeks at 67% of needs, continuous vs 8 blocks of 2 weeks (51 men with obesity)',
          value:
            'Adjusted resting expenditure −749 ± 498 (continuous) vs −360 ± 502 kJ/d (intermittent), i.e. −179 vs −86 kcal/d; weight loss 9.1 vs 14.1 kg; fat-free-mass loss equal',
          note: 'Two later trials in trained people found no difference in body composition or resting rate (61 resistance-trained adults over 12 weeks; 38 trained women with a balance week after every 2 weeks). A small trial with a 2-day carbohydrate refeed each week saw resting rate change of −38 vs −78 kcal/d, with fat-free mass better kept. A 142-person behavioural programme found breaks slowed loss but overall loss was equal.',
          referenceIds: ['byrne2018', 'peos2021', 'siedler2023', 'campbell2020', 'wing2003'],
        },
        {
          label: 'Optional fat-depletion component (default off)',
          value:
            'κ_F between 0 and 0.3; fat reference relaxes with τ_ref = 365 d; component follows with τ = 28 d',
          note: 'Motivated by adaptation tracking fat depletion, the leptin fall and persistence after regain. No validated value exists.',
          referenceIds: ['dulloo1998', 'knuth2014', 'weyer2000'],
        },
      ],
      timeCourse:
        'About 63% of the resting target is reached within 7 days and the non-resting part within 14. It scales linearly with the intake change. At a new lower weight it persists at β_AT × (maintenance intake − baseline intake) and returns to zero only when intake returns to the baseline, for example after regain. Raising intake toward baseline relaxes it with the 14-day time constant.',
      moderators:
        'Size of the intake change (linear). Adaptation is intrinsically hard to quantify because it is a residual of several error-prone measurements. Leanness is not in the default model, because one study found no dependence on adiposity and another found dependence on fat depletion. Very large exercise volumes produce apparent extra suppression, but the model attributes that to constrained expenditure, not to adaptation.',
      grade: 'B',
      gradeReason:
        'Its existence and typical resting size of 50–150 kcal/d are replicated in controlled trials, and β_AT and the time constants come from a validated model, but persistence, reversal speed and diet-break effects are grade C.',
      status: 'contested',
      caveats:
        'Whether adaptation is driven by intake change, energy imbalance or fat depletion is open, and these give different behaviour at reduced weight. The model predicts a small benefit of 1–2-week diet breaks on fat loss per week of dieting, closer to the trials that found no benefit than to the one positive trial. Several controlled studies imply larger adaptation and others smaller, so the true value probably varies with leanness, deficit severity and activity.',
      referenceIds: [
        'hall2011a',
        'hall2008b',
        'hall2006',
        'muller2015',
        'heinitz2020',
        'martin2007',
        'martins2020',
        'byrne2018',
        'muller2021',
        'leibel1995',
        'rosenbaum2010',
        'heilbronn2006',
        'redman2009',
        'redman2018',
        'nymo2018',
        'martins2022',
        'johannsen2012',
        'fothergill2016',
        'knuth2014',
        'weyer2000',
        'dulloo1998',
        'rosenbaum2008',
        'peos2021',
        'siedler2023',
        'campbell2020',
        'wing2003',
        'dulloo2012',
      ],
      relatedMetricIds: ['metabolicAdaptation', 'rmr', 'neat', 'tdee'],
    },
    {
      id: '02-adaptation-in-surplus',
      title: 'Does the body burn off extra food? (adaptation in surplus)',
      category: 'energy',
      summary:
        'When people eat more than they need, expenditure rises. Most of the rise is explained by a bigger body and the cost of digesting more food. Whether the body actively burns off the surplus (once called luxus consumption) is doubtful: if any such adaptation exists, it is too small to measure reliably. The exception is everyday movement, which varies a lot between people.',
      howModelled:
        'The same adaptation equation as in deficit applies to a positive intake change, with a wide person-to-person spread in the everyday-movement part. The planner tests an adaptation gain between 0 and 0.35.',
      keyNumbers: [
        {
          label: 'Maintaining +10% weight',
          value:
            'Total expenditure +9 ± 7 (never-obese) and +8 ± 4 (obese) kcal per kg fat-free mass per day; digestion +1–2 and non-resting expenditure +8–9',
          referenceIds: ['leibel1995'],
        },
        {
          label: 'Review of 16 overfeeding studies',
          value:
            '5 claimed adaptive thermogenesis; 11 found rises explained by larger body size and larger intake (digestion)',
          referenceIds: ['joosen2006'],
        },
        {
          label: '9 days at 1.6 × maintenance (+8.0 MJ/d)',
          value:
            'Basal rate +622 kJ/d, one-third of the 24-hour rise (+2038 kJ/d); about 25% of the excess dissipated and 75% stored',
          note: 'The authors found no evidence for luxus consumption.',
          referenceIds: ['ravussin1985'],
        },
        {
          label: '42 days at +50% (+6.2 MJ/d)',
          value:
            '+7.6 kg (58% fat); basal rate +0.9 MJ/d, calorimetric expenditure +1.8 MJ/d, doubly labelled water +1.4 ± 2.0 MJ/d, all consistent with theoretical costs',
          referenceIds: ['diaz1992'],
        },
        {
          label: '12 pairs of identical twins, +1000 kcal/d for 84 days',
          value:
            'Weight +8.1 kg (range 4.3–13.3); about 3 times more variance between pairs than within pairs',
          referenceIds: ['bouchard1990'],
        },
        {
          label: 'Everyday movement in overfeeding',
          value:
            '+330 ± 258 kcal/d at +1000 kcal/d, the most variable channel; SD about 0.26 × the intake change',
          referenceIds: ['levine1999a'],
        },
        {
          label: '14 days of overfeeding after restriction',
          value:
            'Fat-free-mass-adjusted adaptation +27 ± 115 (not significant), +86 after fat-free-mass composition adjustment',
          referenceIds: ['muller2021'],
        },
        {
          label: 'Storage of excess energy',
          value: 'Fat overfeeding stores 90–95% of the excess, carbohydrate overfeeding 75–85%',
          referenceIds: ['horton1995'],
        },
      ],
      timeCourse: 'The same time constants as in the adaptation-in-deficit entry.',
      moderators:
        "Body size, amount of excess, and (most of all) the individual's everyday-movement response.",
      grade: 'C',
      gradeReason:
        'Studies are inconsistent: the average adaptation is small and the person-to-person variance is large.',
      status: 'contested',
      caveats:
        'The Lancet model treats adaptation as symmetric between deficit and surplus, while the 2010 daily-flux model has almost none in overfeeding.',
      referenceIds: [
        'leibel1995',
        'joosen2006',
        'ravussin1985',
        'diaz1992',
        'bouchard1990',
        'levine1999a',
        'muller2021',
        'horton1995',
        'hall2011a',
      ],
      relatedMetricIds: ['metabolicAdaptation', 'neat', 'tdee'],
    },
    {
      id: '02-macronutrient-composition-expenditure',
      title: 'Carbohydrate versus fat at equal calories and protein',
      category: 'energy',
      summary:
        'Some people claim that eating less carbohydrate raises energy expenditure by hundreds of calories a day. Controlled feeding studies find much smaller effects, roughly zero to a few tens of kilocalories per day. A few early results looked larger but shrank on reanalysis. Vitals treats the carbohydrate-to-fat ratio as having a small effect on expenditure and labels it contested.',
      howModelled:
        'The engine accounts for the automatic differences already covered: the digestion cost of food and the cost of making glucose from amino acids. It adds a separate long-term low-carbohydrate term that is set to zero by default. The planner may test it at +50 kcal/d per 10% of energy less carbohydrate.',
      equation: `ΔTEF: from the thermic-effect entry (shifting 10 %E from fat to carbohydrate at 2500 kcal/d gives +12.5 kcal/d)
ΔEE_GNG = (1 − ε_g)·ΔGNG_kcal,   ε_g = 0.8
ΔEE_CIM = κ_CHO · max(0, (C%E0 − C%E(t))/10) · g(t),   κ_CHO = 0 default (sensitivity +50)
g(t) = 1 − exp(−t_since_change/17 d)`,
      keyNumbers: [
        {
          label:
            'Isocaloric ward study (17 men): 4 weeks at 50/35/15 %E carbohydrate/fat/protein, then 4 weeks at 5/80/15',
          value:
            'Chamber expenditure +57 ± 13 kcal/d, sleeping +89 ± 14, doubly labelled water +151 ± 63; body-fat loss slowed',
          note: 'On reanalysis: chamber +24 ± 30 (not significant); energy-balance −141 ± 118 (not significant); doubly labelled water +209 ± 83 unadjusted, +139 ± 89 with diet-specific RQ, +46 ± 65 after RQ adjustment and removing 2 outliers, so the differences were artefacts of assumptions about RQ.',
          referenceIds: ['hall2016', 'hall2019a'],
        },
        {
          label: '6-day ward crossover, isocaloric',
          value: 'Fat loss 53 ± 6 g/d with carbohydrate restriction vs 89 ± 6 g/d with fat restriction',
          referenceIds: ['hall2015'],
        },
        {
          label: 'Meta-analysis of 32 controlled feeding studies',
          value: 'Expenditure 26 kcal/d higher, and fat loss 16 g/d greater, with lower-fat diets',
          referenceIds: ['hall2017'],
        },
        {
          label: 'Weight-loss maintenance trial (n = 164, 20 weeks)',
          value:
            'Total expenditure +52 kcal/d (23–82) per 10 %E less carbohydrate; low vs high carbohydrate +209 (91–326) as randomised, +278 (144–411) per protocol; +308 and +478 in the highest insulin-secretion tertile',
          note: 'Reanalysis by the pre-registered plan: expenditure fell 240 ± 64 / 322 ± 66 / 356 ± 67 kcal/d (low / moderate / high carbohydrate), p = 0.43, no diet effect. An earlier 3-way crossover (4 weeks each, n = 21) found falls of −423 (low-fat), −297 (low-glycaemic-index) and −97 (very-low-carbohydrate) kcal/d.',
          referenceIds: ['ebbeling2018', 'hall2019b', 'ebbeling2012'],
        },
        {
          label: 'Updated meta-analysis (29 trials, 617 participants, median 4 days)',
          value:
            'Short trials (under 2.5 weeks): −50.0 kcal/d (−77.4 to −22.6) on lower carbohydrate. 6 longer trials: +135.4 kcal/d (72.0–198.7). Per 10 %E less carbohydrate: −14.5 (short) and +50.4 kcal/d (long)',
          referenceIds: ['ludwig2021a'],
        },
        {
          label: 'Best estimate used',
          value:
            'About 0 ± 50 kcal/d per 10 %E, beyond thermic-effect and glucose-production terms; plausible range −15 to +50 kcal/d per 10 %E',
          referenceIds: ['ludwig2021a', 'hall2019b'],
        },
        {
          label: 'Onset of the proposed long-term term',
          value: 'About 2.5 weeks (17-day time constant, proposed)',
          referenceIds: ['ludwig2021a'],
        },
      ],
      timeCourse:
        'Short trials (under 2.5 weeks) and longer trials give opposite signs, so any long-term effect would take several weeks to appear.',
      moderators:
        'Length of the study, and possibly insulin secretion (the highest tertile showed the largest effect in one trial, which the pre-registered reanalysis did not confirm).',
      grade: 'B',
      gradeReason:
        'Several ward studies support a small effect (under about 100 kcal/d), but any sustained low-carbohydrate advantage is grade C.',
      status: 'contested',
      caveats:
        "The sustained-advantage term is off by default, and Vitals' planner does not use it to generate plans. An example glucose-production figure (60–80 g/d on a very-low-carbohydrate diet) is illustrative and could not be confirmed against the original paper.",
      referenceIds: [
        'hall2016',
        'hall2019a',
        'hall2015',
        'hall2017',
        'ebbeling2018',
        'hall2019b',
        'ebbeling2012',
        'ludwig2021a',
      ],
      relatedMetricIds: ['tdee', 'tef'],
    },
    {
      id: '02-tissue-deposition-cost',
      title: 'The energy cost of building and breaking down tissue',
      category: 'energy',
      summary:
        'Building new fat or lean tissue costs energy on top of what the tissue stores, and making fat from carbohydrate costs more than storing dietary fat. Breaking tissue down yields its stored energy. These costs are small next to the energy stored, but they explain why gaining a kilogram takes more calories than losing a kilogram gives back.',
      howModelled:
        'The engine adds a cost for fat and lean tissue being built, a cost for converting carbohydrate to fat (only above baseline, to avoid counting it twice), and a cost for making glucose above baseline.',
      equation:
        'EE_dep = η_F·dFM/dt + η_L·dFFM_protein/dt + (1 − ε_d)·DNL_kcal + (1 − ε_g)·(GNG_kcal − GNG0_kcal)',
      keyNumbers: [
        {
          label: 'Energy density of tissue change',
          value:
            'Fat 39.5 MJ/kg = 9,440 kcal/kg; lean tissue 7.6 MJ/kg = 1,816 kcal/kg; glycogen 17.6 MJ/kg = 4,206 kcal/kg (stored with about 2.7 g of water per g)',
          referenceIds: ['hall2011a', 'hall2008a'],
        },
        {
          label: 'Cost of building fat and lean tissue',
          value:
            'Fat η_F = 750 kJ/kg = 180 kcal per kg (about 1.9% of stored energy); lean η_L = 960 kJ/kg = 230 kcal per kg',
          referenceIds: ['hall2011a', 'hall2010b'],
        },
        {
          label: 'Stoichiometric costs',
          value:
            'Triglyceride synthesis 0.18 kcal/g (8 ATP per triglyceride); glycogen 0.21 kcal/g; protein synthesis 0.86 kcal/g; protein degradation 0.17 kcal/g; 19 kcal oxidised per mol ATP',
          referenceIds: ['hall2006'],
        },
        {
          label: 'Conversion efficiencies',
          value: 'Carbohydrate to fat ε_d = 0.8 (20% of energy lost); gluconeogenesis ε_g = 0.8',
          referenceIds: ['hall2006'],
        },
        {
          label: 'Derived cost per kg of fat deposited',
          value:
            'From dietary fat about 9,620 kcal (about 98% efficient); from carbohydrate via de novo lipogenesis about 11,980 kcal (about 79%)',
          note: 'Check: with massive carbohydrate overfeeding and saturated glycogen, about 475 g carbohydrate/d produced about 150 g lipid/d, giving about 74%. Glycogen capacity is about 15 g/kg body weight, and about 500 g can be gained before net lipogenesis.',
          referenceIds: ['acheson1988'],
        },
        {
          label: 'Storage of excess energy in whole-diet overfeeding (14 days, lean and obese men)',
          value: 'Fat overfeeding stored 90–95% of the excess vs carbohydrate 75–85%',
          referenceIds: ['horton1995'],
        },
        {
          label: 'Lean tissue',
          value:
            'About 2,050 kcal per kg lean (1,816 + 230, Hall); a rat-derived upper estimate for muscle (about 20% protein) is about 2,540 kcal per kg (derived, grade D)',
          referenceIds: ['hall2011a', 'pullar1977'],
        },
        {
          label: 'Rat costs of deposition (animal data, grade D)',
          value:
            '2.25 kJ metabolisable energy per kJ protein deposited; 1.36 per kJ fat deposited (about 53 kJ per g for both)',
          referenceIds: ['pullar1977'],
        },
      ],
      timeCourse:
        'The costs enter expenditure with the sign of the rate of tissue change, so they act as tissue is being built or broken down.',
      moderators:
        'The mix of tissue gained or lost, the source of the energy (dietary fat or carbohydrate), and how far glycogen stores are full.',
      grade: 'B',
      gradeReason:
        'Biochemical stoichiometry and model validation support the values, and human overfeeding balance data support the carbohydrate-to-fat efficiency.',
      status: 'established',
      caveats:
        'The 7,700 kcal/kg (3,500 kcal/lb) rule holds only for people with more than about 30 kg of initial fat. Leaner people need a smaller deficit per kg because more of the loss is lean tissue. The rat-derived numbers are animal data.',
      referenceIds: [
        'hall2011a',
        'hall2008a',
        'hall2010b',
        'hall2006',
        'acheson1988',
        'horton1995',
        'pullar1977',
      ],
      relatedMetricIds: ['tdee'],
    },
    {
      id: '02-tdee-uncertainty-band',
      title: 'How uncertain is a prediction of daily energy use?',
      category: 'energy',
      summary:
        "Even the best equations predict a person's daily energy expenditure only to within several hundred kilocalories. This starting uncertainty is bigger than most of the dynamic effects in the model, such as metabolic adaptation. So Vitals shows daily expenditure with a range, and narrows it when the person enters more information or a few weeks of weight and intake data.",
      howModelled:
        "The range starts as a percentage of baseline expenditure that depends on how well the person's body and activity are known. It widens with the size of the intake change, with a surplus, and with the uncertainty in exercise compensation. Vitals shows one standard deviation as the band and 1.96 standard deviations as a fainter band.",
      equation: `σ_TDEE0 = TDEE0 · cv0
σ_TDEE(t) = sqrt( σ_TDEE0² + (0.11·ΔEI)² + (0.26·max(0,ΔEI))²·w_surplus + (0.28·Abar·0.5)² )
NASEM DLW equation, men inactive:  753.07 − 10.83·A + 6.50·H + 14.10·W    (and similar for other groups)
NASEM DLW equation, women inactive: 584.90 − 7.01·A + 5.72·H + 11.71·W`,
      keyNumbers: [
        {
          label: 'NASEM 2023 equations for adults 19 y and over: men',
          value: 'R² 0.73; RMSE 339 kcal/d; mean absolute percentage error 9.4%; MAE 266',
          note: 'The standard error of one predicted individual value for men is 342 kcal/d, so a 95% prediction interval of about ±670 kcal/d.',
          referenceIds: ['nasem2023'],
        },
        {
          label: 'NASEM 2023 equations: women',
          value: 'R² 0.71; RMSE 246 kcal/d; mean absolute percentage error 8.7%; MAE 191',
          referenceIds: ['nasem2023'],
        },
        {
          label: 'IAEA doubly labelled water equation (6,497 measures, ages 4–96)',
          value:
            'Example, a 35-year-old white man of 90 kg and 180 cm: predicted 13.63 MJ (3,258 kcal/d); 95% prediction interval 2,064–5,025 kcal/d',
          note: '94.6% of 598 held-out measures fell inside the interval. It under-predicts athletes and pregnant or lactating women.',
          referenceIds: ['bajunaid2025'],
        },
        {
          label: 'Resting-rate equations',
          value:
            '21–32% of individuals fall outside ±10% even with the best equation; repeat-measurement CV about 5%',
          referenceIds: ['weijs2008', 'bader2005'],
        },
        {
          label: 'Metabolic adaptation and NEAT spread',
          value:
            'Individual SD of adaptation about 110–140 kcal/d; NEAT response SD 258 kcal/d at +1000 kcal/d',
          referenceIds: ['martins2020', 'muller2021', 'heinitz2020', 'levine1999a'],
        },
        {
          label: 'Starting coefficient of variation (cv0)',
          value:
            '0.12 with no body composition and self-reported activity; 0.10 if body fat is known; 0.08 if RMR is measured; 0.05 when calibrated with at least 28 days of intake log and weight trend',
          note: 'These are proposals. 0.12 is about the NASEM error divided by mean expenditure.',
          referenceIds: ['nasem2023'],
        },
      ],
      timeCourse:
        'The range narrows when the person logs intake and weight for 2–4 weeks or more, because water fluctuations average out over that time.',
      moderators:
        'Quality of body-composition and activity inputs, size and direction of the intake change, and compensation for extra activity.',
      grade: 'A',
      gradeReason:
        'The size of prediction error is well measured in very large datasets; the band formula is our own proposal.',
      status: 'proposed-fit',
      caveats:
        "The way the components are combined into a band is proposed by Vitals. Calibration from a user's own weight trend is the single largest gain in accuracy.",
      referenceIds: [
        'nasem2023',
        'bajunaid2025',
        'weijs2008',
        'bader2005',
        'martins2020',
        'muller2021',
        'heinitz2020',
        'levine1999a',
      ],
      relatedMetricIds: ['tdee', 'maintenance'],
    },
    {
      id: '02-integrated-daily-expenditure',
      title: 'Adding it up: daily expenditure and maintenance calories',
      category: 'energy',
      summary:
        "Daily expenditure is the sum of resting rate, the cost of digesting food, everyday movement, exercise, and the cost of building or breaking down tissue. From these Vitals shows two different maintenance figures: the intake that balances today's expenditure, and the intake that will balance once adaptation has settled. Because expenditure falls as a person diets, the real deficit is smaller than the planned one.",
      howModelled:
        'Each day the engine updates the adaptation, protein and compensation states, then recomputes each component and adds them up. The starting values come from the resting-rate selection rule, the activity level the person chooses, and habitual protein intake.',
      equation: `TDEE(t) = RMR(t) + TEF(t) + NEAT(t) + EAT(t) + EE_dep(t)
Instantaneous maintenance: EI_inst = (RMR + NEAT + EAT + EE_dep_other) / (1 − α_mix)
Settled maintenance:       EI_m = (B − β_AT·EI0) / (1 − α_mix − β_AT),   B = RMR + NEAT + EAT with AT_R = AT_N = 0`,
      keyNumbers: [
        {
          label: 'Worked example: man aged 35, 180 cm, 90 kg, 25% fat, PAL 1.60',
          value:
            'RMR0 1879 (Müller FFM-based); TDEE0 3006; habitual protein 150 g/d; TEF0 278; NEAT0 849 kcal/d',
          referenceIds: ['muller2004', 'fao2004'],
        },
        {
          label: 'Same man on a 25% deficit (2255 kcal, 30/40/30 %E)',
          value:
            'TEF 254; intake change −752; adaptation target −105 (resting −42, non-resting −63); day-1 expenditure 2976',
          referenceIds: ['hall2011a', 'hall2006'],
        },
        {
          label: 'Same man at week 12 (−5 kg fat, −1.5 kg active fat-free mass, 83 kg)',
          value:
            'Mass term −49, NEAT 783, protein term +11: expenditure about 2773, so the real deficit has shrunk from 752 to about 518 kcal/d',
          referenceIds: ['hall2011a', 'wang2010'],
        },
        {
          label: 'Maintenance for that man',
          value:
            'Instantaneous 2839 kcal/d; settled 2948 kcal/d (the higher-protein diet raises the digestion share α_mix to 11.3%)',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'Rules for the starting value',
          value:
            'Mid-category PAL: FAO sedentary 1.55, active 1.85, vigorous 2.2. If PAL-based and NASEM values differ by more than 15%, average them and widen cv0 to 0.15',
          note: 'The non-step share of NEAT defaults to 0.15 × RMR0 (proposed), calibrated to PAL 1.4 at 5,000 steps/d.',
          referenceIds: ['fao2004', 'nasem2023'],
        },
      ],
      timeCourse:
        "The adaptation states carry over between days, so today's expenditure depends on the last weeks of intake and activity.",
      moderators:
        'All the moderators in the individual entries: body composition, intake, protein, activity, cycle phase, temperature and caffeine.',
      grade: 'B',
      gradeReason:
        'The level of daily expenditure is well supported (grade A) but the dynamics are grade B, and several terms are proposed.',
      status: 'proposed-fit',
      caveats:
        "This is Vitals' recommended way to combine the terms, and several parts are proposed (compensation, protein turnover, cycle, and default NEAT share). The worked example is illustrative, not validated.",
      referenceIds: ['muller2004', 'fao2004', 'nasem2023', 'hall2011a', 'hall2006', 'wang2010'],
      relatedMetricIds: ['tdee', 'maintenance', 'energyBalance'],
    },
  ],
  myths: [
    {
      id: '02-myth-muscle-100-kcal',
      claim: 'A kilogram of muscle burns about 100 kcal a day.',
      verdict: 'not-supported',
      explanation:
        'Skeletal muscle burns about 13 kcal per kilogram per day at rest, which is about 6 kcal per pound. Gaining 2 kg of muscle raises resting expenditure by only about 26 kcal per day.',
      referenceIds: ['wang2010'],
    },
    {
      id: '02-myth-metabolism-declines-from-20s',
      claim: 'Your metabolism declines steadily from your twenties.',
      verdict: 'not-supported',
      explanation:
        'After adjusting for fat-free and fat mass, total energy expenditure is flat from 20 to 60 years. A decline of about 0.7% a year begins around age 60–63.',
      referenceIds: ['pontzer2021'],
    },
    {
      id: '02-myth-starvation-mode',
      claim: '"Starvation mode" stops fat loss when you eat less.',
      verdict: 'not-supported',
      explanation:
        'Metabolic adaptation is typically 50–150 kcal a day at rest and at most 10–15% of total expenditure even in extreme cases. It slows loss but does not stop it while there is a real deficit.',
      referenceIds: ['leibel1995', 'martins2020', 'muller2015', 'heilbronn2006'],
    },
    {
      id: '02-myth-metabolic-damage-permanent',
      claim: 'Metabolic damage from dieting is permanent.',
      verdict: 'oversimplified',
      explanation:
        'In one study, the resting slowdown halved within 4 weeks of energy balance and was about zero a year later after partial regain. The very large persistent values in a televised weight-loss cohort are plausibly compensation for high activity. Some persistence at a reduced weight is real, though, as studies at more than one year and at two years show.',
      referenceIds: ['martins2020', 'hall2022', 'kerns2017', 'rosenbaum2008', 'redman2018'],
    },
    {
      id: '02-myth-six-small-meals',
      claim: 'Eating six small meals a day stokes your metabolism.',
      verdict: 'not-supported',
      explanation:
        'Twenty-four-hour energy expenditure was the same for 3 meals as for 6 or 14 meals in the studies that measured it. A meal-frequency term is not needed.',
      referenceIds: ['bellisle1997', 'munsters2012', 'ohkawara2013'],
    },
    {
      id: '02-myth-low-carb-metabolic-advantage',
      claim: 'Eating low-carbohydrate gives a 300–400 kcal a day metabolic advantage.',
      verdict: 'not-supported',
      explanation:
        'Ward studies found a chamber difference of about 0–60 kcal a day. Meta-analyses conflict (−50 kcal a day short-term against +135 long-term), and the large effect reported in one trial was not robust to its pre-registered analysis.',
      referenceIds: [
        'hall2016',
        'hall2019a',
        'hall2015',
        'hall2017',
        'ludwig2021a',
        'ebbeling2018',
        'hall2019b',
      ],
    },
    {
      id: '02-myth-diet-breaks-reset-metabolism',
      claim: 'Diet breaks reset metabolism and speed up fat loss.',
      verdict: 'unproven',
      explanation:
        'One trial found a benefit. Two trials in trained people found no difference in body composition or resting rate. Breaks did not harm overall loss in another programme and may reduce hunger.',
      referenceIds: ['byrne2018', 'peos2021', 'siedler2023', 'wing2003'],
    },
    {
      id: '02-myth-exercise-calories-one-to-one',
      claim: 'Every calorie burned in exercise adds one for one to your deficit.',
      verdict: 'oversimplified',
      explanation:
        'Across a large database, compensation averaged about 28% and was up to about 46% at high body fat. In exercise trials, compensation was mainly through eating more.',
      referenceIds: ['careau2021', 'martin2019', 'westerterp2018'],
    },
    {
      id: '02-myth-alcohol-calories-dont-count',
      claim: "Alcohol calories don't count.",
      verdict: 'not-supported',
      explanation:
        'The thermic effect of alcohol is about 17–22% of its energy, so about 80% is usable. One other study found no inefficiency at all.',
      referenceIds: ['suter1994', 'weststrate1990'],
    },
    {
      id: '02-myth-fat-burners',
      claim: 'Caffeine or green-tea fat burners raise metabolism a lot.',
      verdict: 'oversimplified',
      explanation:
        '600 mg of caffeine a day raised expenditure by about 79–150 kcal a day in short studies. Whether the effect lasts with regular use is untested.',
      referenceIds: ['dulloo1989'],
    },
    {
      id: '02-myth-protein-only-tef',
      claim: "Protein's only extra calorie cost is its thermic effect.",
      verdict: 'oversimplified',
      explanation:
        'Higher protein also raises sleeping and resting expenditure, probably through protein turnover, by about 0.3–1.1 kcal per extra gram a day.',
      referenceIds: ['bray2012', 'bray2015', 'lejeune2006'],
    },
    {
      id: '02-myth-luteal-eat-more',
      claim: 'Women burn more in the luteal phase, so they should eat much more.',
      verdict: 'oversimplified',
      explanation:
        'The effect is about +2–9%, or roughly +50–150 kcal a day, and it is small and inconsistent in modern studies.',
      referenceIds: ['benton2020', 'ferraro1992', 'webb1986', 'bisdee1989'],
    },
    {
      id: '02-myth-3500-rule',
      claim: '3,500 kcal equals one pound, or 7,700 kcal equals one kilogram, always.',
      verdict: 'not-supported',
      explanation:
        'The energy in a kilogram lost depends on initial body fat, and lean people need less deficit per kilogram because more of the loss is lean tissue.',
      referenceIds: ['hall2008a'],
    },
  ],
  openQuestions: [
    'The adaptation gain (β_AT = 0.14) and the split between resting and non-resting parts (σ = 0.6) come from two different models fitted to different datasets. Several controlled studies imply larger adaptation and others smaller, so the true value is probably not the same for everyone: it may depend on leanness, deficit severity and activity.',
    'How fast adaptation reverses, and whether it leaves lasting effects, is poorly measured, and the evidence on diet breaks is inconsistent.',
    'What drives adaptation is unsettled: the change in intake, the energy imbalance, or fat depletion and leptin. These give different predictions at a reduced weight. The default uses the change in intake, and the fat-depletion option is unvalidated.',
    'How exercise compensation works within one person is unclear: the large cross-sectional datasets suggest about 28%, but trials over 6–10 months show little compensation in expenditure. The averaging time and the BMI mapping are guesses.',
    'The protein-turnover term rests on four or five small studies with different designs.',
    'The digestion multipliers for insulin resistance, food processing, fibre and medium-chain fat have no pooled human estimates.',
    'Two inputs were taken from secondary sources: the Müller 2004 weight-equation constant (3.21 against 3.31) and the Oxford coefficients.',
    'The cost of a kilogram of fat-free mass lost may differ from 22 kcal/kg/d when organs shrink out of proportion, and the engine does not track organ masses.',
    "Without feedback from the user, the uncertainty in daily expenditure (about ±12%, or ±300–400 kcal/d as one standard deviation) outweighs all the dynamic effects discussed here. Calibrating from the user's weight trend is the biggest accuracy gain.",
    'The cycle, caffeine and temperature terms are small and may be dropped from a first release.',
  ],
  references: [
    {
      id: 'mifflin1990',
      authors: 'Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO',
      year: 1990,
      title: 'A new predictive equation for resting energy expenditure in healthy individuals',
      journal: 'Am J Clin Nutr',
      pmid: '2305711',
      doi: '10.1093/ajcn/51.2.241',
      verification: 'abstract',
    },
    {
      id: 'roza1984',
      authors: 'Roza AM, Shizgal HM',
      year: 1984,
      title: 'The Harris Benedict equation reevaluated: resting energy requirements and the body cell mass',
      journal: 'Am J Clin Nutr',
      pmid: '6741850',
      doi: '10.1093/ajcn/40.1.168',
      url: 'https://en.wikipedia.org/wiki/Harris%E2%80%93Benedict_equation',
      verification: 'abstract',
    },
    {
      id: 'cunningham1980',
      authors: 'Cunningham JJ',
      year: 1980,
      title: 'A reanalysis of the factors influencing basal metabolic rate in normal adults',
      journal: 'Am J Clin Nutr',
      pmid: '7435418',
      doi: '10.1093/ajcn/33.11.2372',
      verification: 'abstract',
    },
    {
      id: 'cunningham1991',
      authors: 'Cunningham JJ',
      year: 1991,
      title:
        'Body composition as a determinant of energy expenditure: a synthetic review and a proposed general prediction equation',
      journal: 'Am J Clin Nutr',
      pmid: '1957828',
      doi: '10.1093/ajcn/54.6.963',
      verification: 'abstract',
    },
    {
      id: 'muller2004',
      authors: 'Müller MJ, Bosy-Westphal A, Klaus S, et al.',
      year: 2004,
      title:
        'World Health Organization equations have shortcomings for predicting resting energy expenditure in persons from a modern, affluent population: generation of a new reference standard from a retrospective analysis of a German database of resting energy expenditure',
      journal: 'Am J Clin Nutr',
      pmid: '15531690',
      doi: '10.1093/ajcn/80.5.1379',
      verification: 'unverified',
    },
    {
      id: 'henry2005',
      authors: 'Henry CJ',
      year: 2005,
      title: 'Basal metabolic rate studies in humans: measurement and development of new equations',
      journal: 'Public Health Nutr',
      pmid: '16277825',
      doi: '10.1079/phn2005801',
      verification: 'unverified',
    },
    {
      id: 'wang2010',
      authors: 'Wang Z, Ying Z, Bosy-Westphal A, et al.',
      year: 2010,
      title:
        'Specific metabolic rates of major organs and tissues across adulthood: evaluation by mechanistic model of resting energy expenditure',
      journal: 'Am J Clin Nutr',
      pmid: '20962155',
      doi: '10.3945/ajcn.2010.29885',
      verification: 'abstract',
    },
    {
      id: 'gallagher1998',
      authors: 'Gallagher D, Belmonte D, Deurenberg P, et al.',
      year: 1998,
      title: 'Organ-tissue mass measurement allows modeling of REE and metabolically active tissue mass',
      journal: 'Am J Physiol',
      pmid: '9688626',
      doi: '10.1152/ajpendo.1998.275.2.E249',
      verification: 'abstract',
    },
    {
      id: 'frankenfield2005',
      authors: 'Frankenfield D, Roth-Yousey L, Compher C',
      year: 2005,
      title:
        'Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults: a systematic review',
      journal: 'J Am Diet Assoc',
      pmid: '15883556',
      doi: '10.1016/j.jada.2005.02.005',
      verification: 'abstract',
    },
    {
      id: 'weijs2008',
      authors: 'Weijs PJ',
      year: 2008,
      title:
        'Validity of predictive equations for resting energy expenditure in US and Dutch overweight and obese class I and II adults aged 18-65 y',
      journal: 'Am J Clin Nutr',
      pmid: '18842782',
      doi: '10.1093/ajcn/88.4.959',
      verification: 'abstract',
    },
    {
      id: 'tenhaaf2014',
      authors: 'ten Haaf T, Weijs PJ',
      year: 2014,
      title:
        'Resting energy expenditure prediction in recreational athletes of 18-35 years: confirmation of Cunningham equation and an improved weight-based alternative',
      journal: 'PLoS One',
      pmid: '25275434',
      doi: '10.1371/journal.pone.0108460',
      verification: 'abstract',
    },
    {
      id: 'fringsmeuthen2021',
      authors: 'Frings-Meuthen P, Henkel S, Boschmann M, et al.',
      year: 2021,
      title:
        'Resting energy expenditure of master athletes: accuracy of predictive equations and primary determinants',
      journal: 'Front Physiol',
      pmid: '33828487',
      doi: '10.3389/fphys.2021.641455',
      verification: 'full-text',
    },
    {
      id: 'nelson1992',
      authors: 'Nelson KM, Weinsier RL, Long CL, Schutz Y',
      year: 1992,
      title: 'Prediction of resting energy expenditure from fat-free mass and fat mass',
      journal: 'Am J Clin Nutr',
      pmid: '1415003',
      doi: '10.1093/ajcn/56.5.848',
      verification: 'abstract',
    },
    {
      id: 'johnstone2005',
      authors: 'Johnstone AM, Murison SD, Duncan JS, Rance KA, Speakman JR',
      year: 2005,
      title:
        'Factors influencing variation in basal metabolic rate include fat-free mass, fat mass, age, and circulating thyroxine but not sex, circulating leptin, or triiodothyronine',
      journal: 'Am J Clin Nutr',
      pmid: '16280423',
      doi: '10.1093/ajcn/82.5.941',
      verification: 'abstract',
    },
    {
      id: 'bader2005',
      authors: 'Bader N, Bosy-Westphal A, Dilba B, Müller MJ',
      year: 2005,
      title:
        'Intra- and interindividual variability of resting energy expenditure in healthy male subjects — biological and methodological variability of resting energy expenditure',
      journal: 'Br J Nutr',
      pmid: '16277790',
      doi: '10.1079/bjn20051551',
      verification: 'abstract',
    },
    {
      id: 'welle1990',
      authors: 'Welle S, Nair KS',
      year: 1990,
      title: 'Relationship of resting metabolic rate to body composition and protein turnover',
      journal: 'Am J Physiol',
      pmid: '2360629',
      doi: '10.1152/ajpendo.1990.258.6.E990',
      verification: 'abstract',
    },
    {
      id: 'hall2011a',
      authors: 'Hall KD, Sacks G, Chandramohan D, et al.',
      year: 2011,
      title: 'Quantification of the effect of energy imbalance on bodyweight',
      journal: 'Lancet',
      pmid: '21872751',
      doi: '10.1016/S0140-6736(11)60812-X',
      verification: 'full-text',
    },
    {
      id: 'hall2006',
      authors: 'Hall KD',
      year: 2006,
      title: 'Computational model of in vivo human energy metabolism during semistarvation and refeeding',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '16449298',
      doi: '10.1152/ajpendo.00523.2005',
      verification: 'full-text',
    },
    {
      id: 'hall2008b',
      authors: 'Hall KD, Jordan PN',
      year: 2008,
      title: 'Modeling weight-loss maintenance to help prevent body weight regain',
      journal: 'Am J Clin Nutr',
      pmid: '19064508',
      doi: '10.3945/ajcn.2008.26333',
      verification: 'abstract',
    },
    {
      id: 'hall2010b',
      authors: 'Hall KD',
      year: 2010,
      title: 'Mathematical modelling of energy expenditure during tissue deposition',
      journal: 'Br J Nutr',
      pmid: '20132585',
      doi: '10.1017/S0007114510000206',
      verification: 'abstract',
    },
    {
      id: 'hall2008a',
      authors: 'Hall KD',
      year: 2008,
      title: 'What is the required energy deficit per unit weight loss?',
      journal: 'Int J Obes',
      pmid: '17848938',
      doi: '10.1038/sj.ijo.0803720',
      verification: 'abstract',
    },
    {
      id: 'westerterp2004',
      authors: 'Westerterp KR',
      year: 2004,
      title: 'Diet induced thermogenesis',
      journal: 'Nutr Metab (Lond)',
      pmid: '15507147',
      doi: '10.1186/1743-7075-1-5',
      verification: 'full-text',
    },
    {
      id: 'tappy1996',
      authors: 'Tappy L',
      year: 1996,
      title: 'Thermic effect of food and sympathetic nervous system activity in humans',
      journal: 'Reprod Nutr Dev',
      pmid: '8878356',
      doi: '10.1051/rnd:19960405',
      verification: 'abstract',
    },
    {
      id: 'quatela2016',
      authors: 'Quatela A, Callister R, Patterson A, MacDonald-Wicks L',
      year: 2016,
      title:
        'The energy content and composition of meals consumed after an overnight fast and their effects on diet induced thermogenesis: a systematic review, meta-analyses and meta-regressions',
      journal: 'Nutrients',
      pmid: '27792142',
      doi: '10.3390/nu8110670',
      verification: 'full-text',
    },
    {
      id: 'guarneiri2024',
      authors: 'Guarneiri LL, Adams CG, Garcia-Jackson B, Koecher K, Wilcox ML, Maki KC',
      year: 2024,
      title:
        'Effects of varying protein amounts and types on diet-induced thermogenesis: a systematic review and meta-analysis',
      journal: 'Adv Nutr',
      pmid: '39486625',
      doi: '10.1016/j.advnut.2024.100332',
      verification: 'full-text',
    },
    {
      id: 'suter1994',
      authors: 'Suter PM, Jéquier E, Schutz Y',
      year: 1994,
      title: 'Effect of ethanol on energy expenditure',
      journal: 'Am J Physiol',
      pmid: '8184963',
      doi: '10.1152/ajpregu.1994.266.4.R1204',
      verification: 'abstract',
    },
    {
      id: 'weststrate1990',
      authors: 'Weststrate JA, Wunnink I, Deurenberg P, Hautvast JG',
      year: 1990,
      title: 'Alcohol and its acute effects on resting metabolic rate and diet-induced thermogenesis',
      journal: 'Br J Nutr',
      pmid: '2121268',
      doi: '10.1079/bjn19900042',
      verification: 'abstract',
    },
    {
      id: 'dejonge1997',
      authors: 'de Jonge L, Bray GA',
      year: 1997,
      title: 'The thermic effect of food and obesity: a critical review',
      journal: 'Obes Res',
      pmid: '9449148',
      doi: '10.1002/j.1550-8528.1997.tb00584.x',
      verification: 'abstract',
    },
    {
      id: 'granata2002',
      authors: 'Granata GP, Brandon LJ',
      year: 2002,
      title: 'The thermic effect of food and obesity: discrepant results and methodological variations',
      journal: 'Nutr Rev',
      pmid: '12199298',
      doi: '10.1301/002966402320289359',
      verification: 'abstract',
    },
    {
      id: 'barr2010',
      authors: 'Barr SB, Wright JC',
      year: 2010,
      title:
        'Postprandial energy expenditure in whole-food and processed-food meals: implications for daily energy expenditure',
      journal: 'Food Nutr Res',
      pmid: '20613890',
      doi: '10.3402/fnr.v54i0.5144',
      verification: 'abstract',
    },
    {
      id: 'karl2017',
      authors: 'Karl JP, Meydani M, Barnett JB, et al.',
      year: 2017,
      title:
        'Substituting whole grains for refined grains in a 6-wk randomized trial favorably affects energy-balance metrics in healthy men and postmenopausal women',
      journal: 'Am J Clin Nutr',
      pmid: '28179223',
      doi: '10.3945/ajcn.116.139683',
      verification: 'abstract',
    },
    {
      id: 'bellisle1997',
      authors: 'Bellisle F, McDevitt R, Prentice AM',
      year: 1997,
      title: 'Meal frequency and energy balance',
      journal: 'Br J Nutr',
      pmid: '9155494',
      doi: '10.1079/bjn19970104',
      verification: 'abstract',
    },
    {
      id: 'munsters2012',
      authors: 'Munsters MJ, Saris WH',
      year: 2012,
      title:
        'Effects of meal frequency on metabolic profiles and substrate partitioning in lean healthy males',
      journal: 'PLoS One',
      pmid: '22719910',
      doi: '10.1371/journal.pone.0038632',
      verification: 'full-text',
    },
    {
      id: 'ohkawara2013',
      authors: 'Ohkawara K, Cornier MA, Kohrt WM, Melanson EL',
      year: 2013,
      title: 'Effects of increased meal frequency on fat oxidation and perceived hunger',
      journal: 'Obesity',
      pmid: '23404961',
      doi: '10.1002/oby.20032',
      verification: 'abstract',
    },
    {
      id: 'calcagno2019',
      authors: 'Calcagno M, Kahleova H, Alwarith J, et al.',
      year: 2019,
      title: 'The thermic effect of food: a review',
      journal: 'J Am Coll Nutr',
      pmid: '31021710',
      doi: '10.1080/07315724.2018.1552544',
      verification: 'abstract',
    },
    {
      id: 'fao2003',
      authors: 'FAO',
      year: 2003,
      title: 'Food energy — methods of analysis and conversion factors',
      journal: 'FAO Food and Nutrition Paper 77, Rome',
      url: 'https://www.fao.org/4/y5022e/y5022e04.htm',
    },
    {
      id: 'westerterpplantenga1999',
      authors: 'Westerterp-Plantenga MS, Rolland V, Wilson SA, Westerterp KR',
      year: 1999,
      title:
        'Satiety related to 24 h diet-induced thermogenesis during high protein/carbohydrate vs high fat diets measured in a respiration chamber',
      journal: 'Eur J Clin Nutr',
      pmid: '10403587',
      doi: '10.1038/sj.ejcn.1600782',
      verification: 'abstract',
    },
    {
      id: 'levine1999a',
      authors: 'Levine JA, Eberhardt NL, Jensen MD',
      year: 1999,
      title: 'Role of nonexercise activity thermogenesis in resistance to fat gain in humans',
      journal: 'Science',
      pmid: '9880251',
      doi: '10.1126/science.283.5399.212',
      verification: 'abstract',
    },
    {
      id: 'levine2005',
      authors: 'Levine JA, Lanningham-Foster LM, McCrady SK, et al.',
      year: 2005,
      title: 'Interindividual variation in posture allocation: possible role in human obesity',
      journal: 'Science',
      pmid: '15681386',
      doi: '10.1126/science.1106561',
      verification: 'abstract',
    },
    {
      id: 'levine2004',
      authors: 'Levine JA',
      year: 2004,
      title: 'Nonexercise activity thermogenesis (NEAT): environment and biology',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '15102614',
      doi: '10.1152/ajpendo.00562.2003',
      verification: 'abstract',
    },
    {
      id: 'pontzer2016',
      authors: 'Pontzer H, Durazo-Arvizu R, Dugas LR, et al.',
      year: 2016,
      title:
        'Constrained total energy expenditure and metabolic adaptation to physical activity in adult humans',
      journal: 'Curr Biol',
      pmid: '26832439',
      doi: '10.1016/j.cub.2015.12.046',
      verification: 'full-text',
    },
    {
      id: 'careau2021',
      authors: 'Careau V, Halsey LG, Pontzer H, et al.; IAEA DLW database group',
      year: 2021,
      title: 'Energy compensation and adiposity in humans',
      journal: 'Curr Biol',
      pmid: '34453886',
      doi: '10.1016/j.cub.2021.08.016',
      verification: 'full-text',
    },
    {
      id: 'flanagan2024',
      authors: 'Flanagan EW, Sanchez-Delgado G, Martin CK, Ravussin E, Pontzer H, Redman LM',
      year: 2024,
      title: 'No evidence for metabolic adaptation during exercise-related energy compensation',
      journal: 'iScience',
      pmid: '38947494',
      doi: '10.1016/j.isci.2024.109842',
      verification: 'abstract',
    },
    {
      id: 'willis2014',
      authors: 'Willis EA, Herrmann SD, Honas JJ, Lee J, Donnelly JE, Washburn RA',
      year: 2014,
      title: 'Nonexercise energy expenditure and physical activity in the Midwest Exercise Trial 2',
      journal: 'Med Sci Sports Exerc',
      pmid: '24694746',
      doi: '10.1249/MSS.0000000000000354',
      verification: 'abstract',
    },
    {
      id: 'martin2019',
      authors: 'Martin CK, Johnson WD, Myers CA, et al.',
      year: 2019,
      title:
        'Effect of different doses of supervised exercise on food intake, metabolism, and non-exercise physical activity: the E-MECHANIC randomized controlled trial',
      journal: 'Am J Clin Nutr',
      pmid: '31172175',
      doi: '10.1093/ajcn/nqz054',
      verification: 'abstract',
    },
    {
      id: 'westerterp2018',
      authors: 'Westerterp KR',
      year: 2018,
      title: 'Exercise, energy balance and body composition',
      journal: 'Eur J Clin Nutr',
      pmid: '30185845',
      doi: '10.1038/s41430-018-0180-4',
      verification: 'abstract',
    },
    {
      id: 'silva2018',
      authors: 'Silva AM, Júdice PB, Carraça EV, King N, Teixeira PJ, Sardinha LB',
      year: 2018,
      title:
        'What is the effect of diet and/or exercise interventions on behavioural compensation in non-exercise physical activity and related energy expenditure of free-living adults? A systematic review',
      journal: 'Br J Nutr',
      pmid: '29845903',
      doi: '10.1017/S000711451800096X',
      verification: 'abstract',
    },
    {
      id: 'ohkawara2011',
      authors: 'Ohkawara K, Ishikawa-Takata K, Park JH, Tabata I, Tanaka S',
      year: 2011,
      title:
        'How much locomotive activity is needed for an active physical activity level: analysis of total step counts',
      journal: 'BMC Res Notes',
      pmid: '22114990',
      doi: '10.1186/1756-0500-4-512',
      verification: 'full-text',
    },
    {
      id: 'fao2004',
      authors: 'FAO/WHO/UNU',
      year: 2004,
      title: 'Human energy requirements',
      journal:
        'Report of a Joint FAO/WHO/UNU Expert Consultation, Rome 2001 (Food and Nutrition Technical Report Series 1, 2004)',
      url: 'https://www.fao.org/4/y5686e/y5686e07.htm',
    },
    {
      id: 'nasem2023',
      authors: 'National Academies of Sciences, Engineering, and Medicine',
      year: 2023,
      title: 'Dietary Reference Intakes for Energy',
      journal: 'Washington DC: National Academies Press',
      pmid: '36693139',
      doi: '10.17226/26818',
      url: 'https://www.nationalacademies.org/read/26818/chapter/7',
      verification: 'abstract',
    },
    {
      id: 'bajunaid2025',
      authors: 'Bajunaid R, Niu C, Hambly C, et al.',
      year: 2025,
      title:
        'Predictive equation derived from 6,497 doubly labelled water measurements enables the detection of erroneous self-reported energy intake',
      journal: 'Nat Food',
      pmid: '39806218',
      doi: '10.1038/s43016-024-01089-5',
      verification: 'full-text',
    },
    {
      id: 'pontzer2021',
      authors: 'Pontzer H, Yamada Y, Sagayama H, et al.; IAEA DLW Database Consortium',
      year: 2021,
      title: 'Daily energy expenditure through the human life course',
      journal: 'Science',
      pmid: '34385400',
      doi: '10.1126/science.abe5017',
      verification: 'full-text',
    },
    {
      id: 'leibel1995',
      authors: 'Leibel RL, Rosenbaum M, Hirsch J',
      year: 1995,
      title: 'Changes in energy expenditure resulting from altered body weight',
      journal: 'N Engl J Med',
      pmid: '7632212',
      doi: '10.1056/NEJM199503093321001',
      verification: 'abstract',
    },
    {
      id: 'rosenbaum2008',
      authors: 'Rosenbaum M, Hirsch J, Gallagher DA, Leibel RL',
      year: 2008,
      title:
        'Long-term persistence of adaptive thermogenesis in subjects who have maintained a reduced body weight',
      journal: 'Am J Clin Nutr',
      pmid: '18842775',
      doi: '10.1093/ajcn/88.4.906',
      verification: 'abstract',
    },
    {
      id: 'rosenbaum2010',
      authors: 'Rosenbaum M, Leibel RL',
      year: 2010,
      title: 'Adaptive thermogenesis in humans',
      journal: 'Int J Obes',
      pmid: '20935667',
      doi: '10.1038/ijo.2010.184',
      verification: 'full-text',
    },
    {
      id: 'rosenbaum2003',
      authors: 'Rosenbaum M, Vandenborne K, Goldsmith R, et al.',
      year: 2003,
      title:
        'Effects of experimental weight perturbation on skeletal muscle work efficiency in human subjects',
      journal: 'Am J Physiol Regul Integr Comp Physiol',
      pmid: '12609816',
      doi: '10.1152/ajpregu.00474.2002',
      verification: 'abstract',
    },
    {
      id: 'fothergill2016',
      authors: 'Fothergill E, Guo J, Howard L, et al.',
      year: 2016,
      title: 'Persistent metabolic adaptation 6 years after "The Biggest Loser" competition',
      journal: 'Obesity',
      pmid: '27136388',
      doi: '10.1002/oby.21538',
      verification: 'abstract',
    },
    {
      id: 'johannsen2012',
      authors: 'Johannsen DL, Knuth ND, Huizenga R, Rood JC, Ravussin E, Hall KD',
      year: 2012,
      title: 'Metabolic slowing with massive weight loss despite preservation of fat-free mass',
      journal: 'J Clin Endocrinol Metab',
      pmid: '22535969',
      doi: '10.1210/jc.2012-1444',
      verification: 'abstract',
    },
    {
      id: 'knuth2014',
      authors: 'Knuth ND, Johannsen DL, Tamboli RA, et al.',
      year: 2014,
      title:
        'Metabolic adaptation following massive weight loss is related to the degree of energy imbalance and changes in circulating leptin',
      journal: 'Obesity',
      pmid: '25236175',
      doi: '10.1002/oby.20900',
      verification: 'abstract',
    },
    {
      id: 'hall2022',
      authors: 'Hall KD',
      year: 2022,
      title: 'Energy compensation and metabolic adaptation: "The Biggest Loser" study reinterpreted',
      journal: 'Obesity',
      pmid: '34816627',
      doi: '10.1002/oby.23308',
      verification: 'abstract',
    },
    {
      id: 'kerns2017',
      authors: 'Kerns JC, Guo J, Fothergill E, et al.',
      year: 2017,
      title:
        'Increased physical activity associated with less weight regain six years after "The Biggest Loser" competition',
      journal: 'Obesity',
      pmid: '29086499',
      doi: '10.1002/oby.21986',
      verification: 'abstract',
    },
    {
      id: 'martins2020',
      authors: 'Martins C, Roekenes J, Salamati S, Gower BA, Hunter GR',
      year: 2020,
      title:
        'Metabolic adaptation is an illusion, only present when participants are in negative energy balance',
      journal: 'Am J Clin Nutr',
      pmid: '32844188',
      doi: '10.1093/ajcn/nqaa220',
      verification: 'abstract',
    },
    {
      id: 'martins2022',
      authors: 'Martins C, Gower BA, Hunter GR',
      year: 2022,
      title: 'Metabolic adaptation delays time to reach weight loss goals',
      journal: 'Obesity',
      pmid: '35088553',
      doi: '10.1002/oby.23333',
      verification: 'abstract',
    },
    {
      id: 'nymo2018',
      authors: 'Nymo S, Coutinho SR, Torgersen LH, et al.',
      year: 2018,
      title:
        'Timeline of changes in adaptive physiological responses, at the level of energy expenditure, with progressive weight loss',
      journal: 'Br J Nutr',
      pmid: '29733003',
      doi: '10.1017/S0007114518000922',
      verification: 'abstract',
    },
    {
      id: 'muller2015',
      authors: 'Müller MJ, Enderle J, Pourhassan M, et al.',
      year: 2015,
      title:
        'Metabolic adaptation to caloric restriction and subsequent refeeding: the Minnesota Starvation Experiment revisited',
      journal: 'Am J Clin Nutr',
      pmid: '26399868',
      doi: '10.3945/ajcn.115.109173',
      verification: 'abstract',
    },
    {
      id: 'muller2021',
      authors: 'Müller MJ, Heymsfield SB, Bosy-Westphal A',
      year: 2021,
      title: 'Are metabolic adaptations to weight changes an artefact?',
      journal: 'Am J Clin Nutr',
      pmid: '34134143',
      doi: '10.1093/ajcn/nqab184',
      verification: 'abstract',
    },
    {
      id: 'dulloo1998',
      authors: 'Dulloo AG, Jacquet J',
      year: 1998,
      title:
        'Adaptive reduction in basal metabolic rate in response to food deprivation in humans: a role for feedback signals from fat stores',
      journal: 'Am J Clin Nutr',
      pmid: '9734736',
      doi: '10.1093/ajcn/68.3.599',
      verification: 'abstract',
    },
    {
      id: 'dulloo2012',
      authors: 'Dulloo AG, Jacquet J, Montani JP, Schutz Y',
      year: 2012,
      title:
        'Adaptive thermogenesis in human body weight regulation: more of a concept than a measurable entity?',
      journal: 'Obes Rev',
      pmid: '23107264',
      doi: '10.1111/j.1467-789X.2012.01041.x',
      verification: 'abstract',
    },
    {
      id: 'heilbronn2006',
      authors: 'Heilbronn LK, de Jonge L, Frisard MI, et al.',
      year: 2006,
      title:
        'Effect of 6-month calorie restriction on biomarkers of longevity, metabolic adaptation, and oxidative stress in overweight individuals: a randomized controlled trial',
      journal: 'JAMA',
      pmid: '16595757',
      doi: '10.1001/jama.295.13.1539',
      verification: 'abstract',
    },
    {
      id: 'martin2007',
      authors: 'Martin CK, Heilbronn LK, de Jonge L, et al.',
      year: 2007,
      title: 'Effect of calorie restriction on resting metabolic rate and spontaneous physical activity',
      journal: 'Obesity',
      pmid: '18198305',
      doi: '10.1038/oby.2007.354',
      verification: 'abstract',
    },
    {
      id: 'redman2009',
      authors: 'Redman LM, Heilbronn LK, Martin CK, et al.',
      year: 2009,
      title:
        'Metabolic and behavioral compensations in response to caloric restriction: implications for the maintenance of weight loss',
      journal: 'PLoS One',
      pmid: '19198647',
      doi: '10.1371/journal.pone.0004377',
      verification: 'abstract',
    },
    {
      id: 'redman2018',
      authors: "Redman LM, Smith SR, Burton JH, Martin CK, Il'yasova D, Ravussin E",
      year: 2018,
      title:
        'Metabolic slowing and reduced oxidative damage with sustained caloric restriction support the rate of living and oxidative damage theories of aging',
      journal: 'Cell Metab',
      pmid: '29576535',
      doi: '10.1016/j.cmet.2018.02.019',
      verification: 'abstract',
    },
    {
      id: 'weyer2000',
      authors: 'Weyer C, Walford RL, Harper IT, et al.',
      year: 2000,
      title: 'Energy metabolism after 2 y of energy restriction: the Biosphere 2 experiment',
      journal: 'Am J Clin Nutr',
      pmid: '11010936',
      doi: '10.1093/ajcn/72.4.946',
      verification: 'abstract',
    },
    {
      id: 'heinitz2020',
      authors: 'Heinitz S, Hollstein T, Ando T, et al.',
      year: 2020,
      title:
        'Early adaptive thermogenesis is a determinant of weight loss after six weeks of caloric restriction in overweight subjects',
      journal: 'Metabolism',
      pmid: '32599082',
      doi: '10.1016/j.metabol.2020.154303',
      verification: 'abstract',
    },
    {
      id: 'byrne2018',
      authors: 'Byrne NM, Sainsbury A, King NA, Hills AP, Wood RE',
      year: 2018,
      title:
        'Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study',
      journal: 'Int J Obes',
      pmid: '28925405',
      doi: '10.1038/ijo.2017.206',
      verification: 'abstract',
    },
    {
      id: 'peos2021',
      authors: 'Peos JJ, Helms ER, Fournier PA, et al.',
      year: 2021,
      title:
        'Continuous versus intermittent dieting for fat loss and fat-free mass retention in resistance-trained adults: the ICECAP trial',
      journal: 'Med Sci Sports Exerc',
      pmid: '33587549',
      doi: '10.1249/MSS.0000000000002636',
      verification: 'abstract',
    },
    {
      id: 'siedler2023',
      authors: 'Siedler MR, Lewis MH, Trexler ET, et al.',
      year: 2023,
      title:
        'The effects of intermittent diet breaks during 25% energy restriction on body composition and resting metabolic rate in resistance-trained females: a randomized controlled trial',
      journal: 'J Hum Kinet',
      pmid: '37181269',
      doi: '10.5114/jhk/159960',
      verification: 'abstract',
    },
    {
      id: 'campbell2020',
      authors: 'Campbell BI, Aguilar D, Colenso-Semple LM, et al.',
      year: 2020,
      title:
        'Intermittent energy restriction attenuates the loss of fat free mass in resistance trained individuals. A randomized controlled trial',
      journal: 'J Funct Morphol Kinesiol',
      pmid: '33467235',
      doi: '10.3390/jfmk5010019',
      verification: 'abstract',
    },
    {
      id: 'wing2003',
      authors: 'Wing RR, Jeffery RW',
      year: 2003,
      title: 'Prescribed "breaks" as a means to disrupt weight control efforts',
      journal: 'Obes Res',
      pmid: '12582226',
      doi: '10.1038/oby.2003.43',
      verification: 'abstract',
    },
    {
      id: 'joosen2006',
      authors: 'Joosen AM, Westerterp KR',
      year: 2006,
      title: 'Energy expenditure during overfeeding',
      journal: 'Nutr Metab (Lond)',
      pmid: '16836744',
      doi: '10.1186/1743-7075-3-25',
      verification: 'full-text',
    },
    {
      id: 'ravussin1985',
      authors: 'Ravussin E, Schutz Y, Acheson KJ, Dusmet M, Bourquin L, Jéquier E',
      year: 1985,
      title: 'Short-term, mixed-diet overfeeding in man: no evidence for "luxuskonsumption"',
      journal: 'Am J Physiol',
      pmid: '4061637',
      doi: '10.1152/ajpendo.1985.249.5.E470',
      verification: 'abstract',
    },
    {
      id: 'diaz1992',
      authors: 'Diaz EO, Prentice AM, Goldberg GR, Murgatroyd PR, Coward WA',
      year: 1992,
      title: 'Metabolic response to experimental overfeeding in lean and overweight healthy volunteers',
      journal: 'Am J Clin Nutr',
      pmid: '1414963',
      doi: '10.1093/ajcn/56.4.641',
      verification: 'abstract',
    },
    {
      id: 'bouchard1990',
      authors: 'Bouchard C, Tremblay A, Després JP, et al.',
      year: 1990,
      title: 'The response to long-term overfeeding in identical twins',
      journal: 'N Engl J Med',
      pmid: '2336074',
      doi: '10.1056/NEJM199005243222101',
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
      id: 'hall2019a',
      authors: 'Hall KD, Guo J, Chen KY, et al.',
      year: 2019,
      title:
        'Methodologic considerations for measuring energy expenditure differences between diets varying in carbohydrate using the doubly labeled water method',
      journal: 'Am J Clin Nutr',
      pmid: '31028699',
      doi: '10.1093/ajcn/nqy390',
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
      id: 'hall2019b',
      authors: 'Hall KD, Guo J, Speakman JR',
      year: 2019,
      title: 'Do low-carbohydrate diets increase energy expenditure?',
      journal: 'Int J Obes',
      pmid: '31548574',
      doi: '10.1038/s41366-019-0456-3',
      verification: 'full-text',
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
      id: 'ludwig2021a',
      authors: 'Ludwig DS, Dickinson SL, Henschel B, Ebbeling CB, Allison DB',
      year: 2021,
      title:
        'Do lower-carbohydrate diets increase total energy expenditure? An updated and reanalyzed meta-analysis of 29 controlled-feeding studies',
      journal: 'J Nutr',
      pmid: '33274750',
      doi: '10.1093/jn/nxaa350',
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
      id: 'ebbeling2012',
      authors: 'Ebbeling CB, Swain JF, Feldman HA, et al.',
      year: 2012,
      title: 'Effects of dietary composition on energy expenditure during weight-loss maintenance',
      journal: 'JAMA',
      pmid: '22735432',
      doi: '10.1001/jama.2012.6607',
      verification: 'abstract',
    },
    {
      id: 'bray2012',
      authors: 'Bray GA, Smith SR, de Jonge L, et al.',
      year: 2012,
      title:
        'Effect of dietary protein content on weight gain, energy expenditure, and body composition during overeating: a randomized controlled trial',
      journal: 'JAMA',
      pmid: '22215165',
      doi: '10.1001/jama.2011.1918',
      verification: 'full-text',
    },
    {
      id: 'bray2015',
      authors: 'Bray GA, Redman LM, de Jonge L, et al.',
      year: 2015,
      title: 'Effect of protein overfeeding on energy expenditure measured in a metabolic chamber',
      journal: 'Am J Clin Nutr',
      pmid: '25733634',
      doi: '10.3945/ajcn.114.091769',
      verification: 'abstract',
    },
    {
      id: 'mikkelsen2000',
      authors: 'Mikkelsen PB, Toubro S, Astrup A',
      year: 2000,
      title:
        'Effect of fat-reduced diets on 24-h energy expenditure: comparisons between animal protein, vegetable protein, and carbohydrate',
      journal: 'Am J Clin Nutr',
      pmid: '11063440',
      doi: '10.1093/ajcn/72.5.1135',
      verification: 'abstract',
    },
    {
      id: 'lejeune2006',
      authors: 'Lejeune MP, Westerterp KR, Adam TC, Luscombe-Marsh ND, Westerterp-Plantenga MS',
      year: 2006,
      title:
        'Ghrelin and glucagon-like peptide 1 concentrations, 24-h satiety, and energy and substrate metabolism during a high-protein diet and measured in a respiration chamber',
      journal: 'Am J Clin Nutr',
      pmid: '16400055',
      doi: '10.1093/ajcn/83.1.89',
      verification: 'abstract',
    },
    {
      id: 'whitehead1996',
      authors: 'Whitehead JM, McNeill G, Smith JS',
      year: 1996,
      title: 'The effect of protein intake on 24-h energy expenditure during energy restriction',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '8856395',
      verification: 'abstract',
    },
    {
      id: 'drummen2020',
      authors: 'Drummen M, Tischmann L, Gatta-Cherifi B, et al.',
      year: 2020,
      title:
        'High compared with moderate protein intake reduces adaptive thermogenesis and induces a negative energy balance during long-term weight-loss maintenance in participants with prediabetes in the postobese state: a PREVIEW study',
      journal: 'J Nutr',
      pmid: '31754687',
      doi: '10.1093/jn/nxz281',
      verification: 'abstract',
    },
    {
      id: 'horton1995',
      authors: 'Horton TJ, Drougas H, Brachey A, Reed GW, Peters JC, Hill JO',
      year: 1995,
      title: 'Fat and carbohydrate overfeeding in humans: different effects on energy storage',
      journal: 'Am J Clin Nutr',
      pmid: '7598063',
      doi: '10.1093/ajcn/62.1.19',
      verification: 'abstract',
    },
    {
      id: 'acheson1988',
      authors: 'Acheson KJ, Schutz Y, Bessard T, Anantharaman K, Flatt JP, Jéquier E',
      year: 1988,
      title:
        'Glycogen storage capacity and de novo lipogenesis during massive carbohydrate overfeeding in man',
      journal: 'Am J Clin Nutr',
      pmid: '3165600',
      doi: '10.1093/ajcn/48.2.240',
      verification: 'abstract',
    },
    {
      id: 'pullar1977',
      authors: 'Pullar JD, Webster AJ',
      year: 1977,
      title: 'The energy cost of fat and protein deposition in the rat',
      journal: 'Br J Nutr',
      pmid: '861188',
      doi: '10.1079/bjn19770039',
      verification: 'abstract',
    },
    {
      id: 'benton2020',
      authors: 'Benton MJ, Hutchins AM, Dawes JJ',
      year: 2020,
      title: 'Effect of menstrual cycle on resting metabolism: a systematic review and meta-analysis',
      journal: 'PLoS One',
      pmid: '32658929',
      doi: '10.1371/journal.pone.0236025',
      verification: 'abstract',
    },
    {
      id: 'webb1986',
      authors: 'Webb P',
      year: 1986,
      title: '24-hour energy expenditure and the menstrual cycle',
      journal: 'Am J Clin Nutr',
      pmid: '3766447',
      doi: '10.1093/ajcn/44.5.614',
      verification: 'abstract',
    },
    {
      id: 'bisdee1989',
      authors: 'Bisdee JT, James WP, Shaw MA',
      year: 1989,
      title: 'Changes in energy expenditure during the menstrual cycle',
      journal: 'Br J Nutr',
      pmid: '2706224',
      doi: '10.1079/bjn19890108',
      verification: 'abstract',
    },
    {
      id: 'ferraro1992',
      authors: 'Ferraro R, Lillioja S, Fontvieille AM, Rising R, Bogardus C, Ravussin E',
      year: 1992,
      title: 'Lower sedentary metabolic rate in women compared with men',
      journal: 'J Clin Invest',
      pmid: '1522233',
      doi: '10.1172/JCI115951',
      verification: 'abstract',
    },
    {
      id: 'dulloo1989',
      authors: 'Dulloo AG, Geissler CA, Horton T, Collins A, Miller DS',
      year: 1989,
      title:
        'Normal caffeine consumption: influence on thermogenesis and daily energy expenditure in lean and postobese human volunteers',
      journal: 'Am J Clin Nutr',
      pmid: '2912010',
      doi: '10.1093/ajcn/49.1.44',
      verification: 'abstract',
    },
    {
      id: 'astrup1990',
      authors: 'Astrup A, Toubro S, Cannon S, Hein P, Breum L, Madsen J',
      year: 1990,
      title:
        'Caffeine: a double-blind, placebo-controlled study of its thermogenic, metabolic, and cardiovascular effects in healthy volunteers',
      journal: 'Am J Clin Nutr',
      pmid: '2333832',
      doi: '10.1093/ajcn/51.5.759',
      verification: 'abstract',
    },
    {
      id: 'landsberg2009',
      authors: 'Landsberg L, Young JB, Leonard WR, Linsenmeier RA, Turek FW',
      year: 2009,
      title:
        'Do the obese have lower body temperatures? A new look at a forgotten variable in energy balance',
      journal: 'Trans Am Clin Climatol Assoc',
      pmid: '19768183',
      verification: 'full-text',
    },
    {
      id: 'wijers2010',
      authors: 'Wijers SL, Saris WH, van Marken Lichtenbelt WD',
      year: 2010,
      title: 'Cold-induced adaptive thermogenesis in lean and obese',
      journal: 'Obesity',
      pmid: '20360754',
      doi: '10.1038/oby.2010.74',
      verification: 'abstract',
    },
    {
      id: 'tudorlocke2013',
      authors: 'Tudor-Locke C, Craig CL, Thyfault JP, Spence JC',
      year: 2013,
      title: 'A step-defined sedentary lifestyle index: <5000 steps/day',
      journal: 'Appl Physiol Nutr Metab',
      pmid: '23438219',
      doi: '10.1139/apnm-2012-0235',
      verification: 'abstract',
    },
    {
      id: 'javed2010',
      authors: 'Javed F, He Q, Davidson LE, et al.',
      year: 2010,
      title:
        'Brain and high metabolic rate organ mass: contributions to resting energy expenditure beyond fat-free mass',
      journal: 'Am J Clin Nutr',
      pmid: '20164308',
      doi: '10.3945/ajcn.2009.28512',
      verification: 'abstract',
    },
    {
      id: 'gallagher2006',
      authors: 'Gallagher D, Albu J, He Q, et al.',
      year: 2006,
      title:
        'Small organs with a high metabolic rate explain lower resting energy expenditure in African American than in white adults',
      journal: 'Am J Clin Nutr',
      pmid: '16685047',
      doi: '10.1093/ajcn/83.5.1062',
      verification: 'abstract',
    },
  ],
};

export default topic;
