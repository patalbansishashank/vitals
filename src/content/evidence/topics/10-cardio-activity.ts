import type { EvidenceTopic } from '../schema';

/** Evidence topic for research/10-cardio-activity-expenditure.md (pure data). */
const topic: EvidenceTopic = {
  dossier: '10',
  slug: 'cardio-activity',
  title: 'Cardio, daily movement and activity energy',
  scope:
    'How much energy walking, running, cycling, swimming, sport and lifting cost, and how much of it really shows up as extra daily energy use. The topic also covers which fuel is burned, the slow gains in aerobic fitness and muscle mitochondria and how they fade, and how cardio interacts with strength training and appetite. It closes with step counts, everyday activity levels and the limits set by low energy availability. Health links to steps and fitness are associations from cohort studies, not proof of cause.',
  mechanisms: [
    {
      id: '10-mets-and-net-cost',
      title: 'Counting exercise energy: METs, gross and net cost',
      category: 'energy',
      summary:
        "A MET is a multiple of resting energy use. By convention, 1 MET is 3.5 ml of oxygen per kg per minute. Measured resting use is lower, about 2.6 ml/kg/min in 769 adults, so the convention overstates rest. The engine separates gross cost (everything spent during exercise) from net cost (above the person's own resting use), and it does not credit the resting energy that would have been spent anyway.",
      howModelled:
        "Gross energy comes from METs × 3.5 × body mass ÷ 200, or from a walking, running or cycling equation. Net cost subtracts resting use over the same minutes. The increment to daily energy also subtracts the energy the person would have spent on the sedentary time that exercise replaced (0.2 × RMR by default). Corrected METs use the person's own RMR. They change how intensity is classified and the net cost, but not the gross kilocalories.",
      equation: `kcal/min = MET × 3.5 × kg / 200
kcalPerLO2(RQ) = 4.686 + (RQ − 0.707) × 0.361/0.293
Net = Gross − RMR/1440 × minutes
Corrected MET = MET_std × 3.5 / VO2rest_indiv,   VO2rest_indiv = RMR_kcal_day/1440/5 × 1000/mass
Fuel use (g/min, gas exchange in L/min, low-to-moderate intensity): CHO = 4.210·VCO2 − 2.962·VO2;  Fat = 1.695·VO2 − 1.701·VCO2`,
      keyNumbers: [
        {
          label: 'The MET convention',
          value: '1 MET = 3.5 ml O2/kg/min, so kcal/min = METs × 3.5 × kg / 200 and 1 MET = 1.05 kcal/kg/h',
          note: 'The Compendium also quotes 1 MET = 1 kcal/kg/h, a 5 % difference. The engine picks one and uses it throughout.',
          referenceIds: ['compendium2024a'],
        },
        {
          label: 'Energy per litre of oxygen',
          value: '4.686 kcal/L at RQ 0.707; 5.047 at 1.00; 4.86 at 0.85',
          note: 'The choice among 10 published equations changes results by up to 5.2 %.',
          referenceIds: ['manini2010', 'kipp2018'],
        },
        {
          label: 'Derived energy per gram of fuel oxidised',
          value: 'Fat 9.62 kcal/g; carbohydrate 4.04 kcal/g',
          note: 'Derived by Vitals from the two gas-exchange equations. The higher-intensity carbohydrate pair (4.344 and 3.061) came from a secondary summary and is unverified at source; the low-to-moderate pair was confirmed in two later papers.',
          referenceIds: ['ahn2022', 'jung2023', 'jeukendrup2005'],
        },
        {
          label: 'Compendium of Physical Activities, 2024 (adults 19–59)',
          value:
            '1114 activities (912 measured, 202 estimated) under 22 headings; 2356 values from 701 papers',
          note: 'Examples in METs: sleeping 1.0; sitting computer work 1.3; walking 2.5 mph 3.0; walking 3.5–3.9 mph 4.8; running 5.0–5.2 mph 8.5; running 6–6.3 mph 9.3; running 7 mph 11.0; bicycling 12–13.9 mph 8.0; HIIT cycling 8.8; freestyle swimming slow 5.8 and fast 9.8; hatha yoga 2.3. Sitting is 1.0–1.5, standing 1.3–1.5 and office work 1.3–1.5.',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'True resting oxygen use',
          value:
            '2.6 ± 0.4 ml/kg/min (0.84 kcal/kg/h) in 769 adults (642 women, 127 men, aged 18–74, 35–186 kg)',
          note: 'So 3.5 is on average 35 % too high, and more so in obese and older people.',
          referenceIds: ['byrne2005'],
        },
        {
          label: 'Standard METs against individually referenced METs',
          value:
            'Standard METs under-estimate the individual value 89 % of the time and misclassify intensity 12.2 % of the time',
          note: 'Worse in women, overweight, older and unfit people. The figures are cited from a 2010 study that was not checked against the original paper.',
          referenceIds: ['compendium2024b'],
        },
        {
          label: 'Worked corrections (Harris–Benedict RMR)',
          value:
            '35-year-old man, 175 cm, 75 kg: RMR 1737 → VO2rest 3.22 → factor 1.09. 55-year-old woman, 165 cm, 85 kg: RMR 1516 → VO2rest 2.48 → factor 1.41',
          note: "Vitals' own arithmetic. Only when a person's measured mass-specific oxygen use differs (for example walking about 10 % higher per kg in obesity) does gross cost change.",
          referenceIds: ['compendium2024b'],
        },
      ],
      timeCourse: 'Not a time-dependent process; the energy is counted per bout.',
      moderators:
        'Body mass, individual resting metabolic rate, obesity, sex and age (all change net cost and MET classification).',
      grade: 'A',
      gradeReason:
        'Units and METs are published standards validated against calorimetry; the corrected-MET and displaced-baseline steps are conventions.',
      status: 'established',
      caveats:
        'The displaced-baseline default of 0.2 × RMR is a proposal. Resting oxygen use averaged lower than the 3.5 convention, so energy above rest depends on which rest is subtracted.',
      referenceIds: [
        'compendium2024a',
        'compendium2024b',
        'manini2010',
        'kipp2018',
        'ahn2022',
        'jung2023',
        'jeukendrup2005',
        'herrmann2024',
        'byrne2005',
      ],
      relatedMetricIds: ['exerciseEE', 'tdee', 'energyAvailability'],
    },
    {
      id: '10-walking-energy',
      title: 'What walking costs, per kilometre and per step',
      category: 'energy',
      summary:
        'Level walking costs about 0.44 kcal per kg of body mass per 1000 steps above rest, or about 0.61 kcal per kg counting rest. For a 75 kg adult that is roughly 33 kcal net or 46 kcal gross per 1000 steps. The common ACSM walking equation under-predicts published values by about 20 %. A steeper hill multiplies the cost sharply.',
      howModelled:
        "The engine uses the Ludlow and Weyand equation with the person's height and speed. Step length is set to 0.415 × height and cadence to about 110 steps a minute. Hills above a 2 % grade multiply the cost by a ratio from a published cost curve, and grade is kept within ±15 %. Walking in obesity costs about 10 % more per kg.",
      equation: `VO2_total = VO2_rest + 3.85 + 5.97 · V²/H        (ml/kg/min; V in m/s, H = height in m)
ACSM: VO2 = 0.1·S + 1.8·S·G + 3.5      (S in m/min, G = grade as a fraction)
step length SL = 0.415·H;  net kcal per step per kg = [3.85 + 5.97·V²/H] / c × 5/1000      (c = cadence)
Minetti walking cost: Cw(G) = 280.5·G⁵ − 58.7·G⁴ − 76.8·G³ + 51.9·G² + 19.6·G + 2.5   J/kg/m   (coefficients unverified)`,
      keyNumbers: [
        {
          label: 'How well the equations predict (127 published population means, 0.4–1.9 m/s)',
          value:
            'Ludlow–Weyand R² 0.90 against 0.63 for one-component models; SEE 1.13 versus 4.51 ml/kg/min for ACSM; ACSM mean error 18 ± 13 % against 8 %',
          note: 'The ACSM walking equation is validated for 50–100 m/min. An extension for speed, grade and load reached an SEE of 1.06 ml/kg/min over 90 conditions. A military graded-walking equation exists but its coefficients were not retrieved.',
          referenceIds: ['ludlow2016', 'weyand2013', 'ludlow2017', 'ttu2013', 'hall2004', 'looney2019'],
        },
        {
          label: 'Net cost per kg per km (Ludlow–Weyand at heights 1.6 / 1.7 / 1.8 m; ACSM; Compendium)',
          value:
            '4 km/h: 0.63 / 0.61 / 0.60; ACSM 0.50; Compendium 0.50. 5 km/h: 0.66 / 0.64 / 0.62; ACSM 0.50; Compendium 0.56. 6.4 km/h: 0.73 / 0.70 / 0.67; ACSM 0.50; Compendium about 0.64',
          note: 'Recommended: net 0.61–0.66 kcal/kg/km at 4–5 km/h and about 0.70 at 6.4 km/h. The two approaches agree to about 10 % in gross terms (75 kg at 5 km/h: 299 versus 299 kcal/h) and differ mainly in what is subtracted as rest.',
          referenceIds: ['ludlow2016', 'ttu2013', 'herrmann2024'],
        },
        {
          label: 'Net kcal per 1000 steps at a cadence of 110 (75 kg)',
          value:
            '31 (1.55 m tall), 33 (1.65 m), 34 (1.75 m), 35 (1.85 m), 36 (1.95 m); at 55 kg 23–26; at 110 kg 46–53',
          note: 'Rule: net = 0.44 × mass in kg (range 0.36–0.50) and gross = 0.61 × mass, nearly independent of cadence (75 kg, 1.70 m: 32.6–34.8 kcal for 80–130 steps a minute). ACSM would give 26 kcal, 20 % lower. Cross-check: Compendium brisk walking of 3.8 MET for an hour is 285 kcal gross, about 6,900 steps, so 41 kcal per 1000 steps gross against 46 here. Cost per 1000 steps is uncertain by about ±20 % for an individual.',
          referenceIds: ['ludlow2016', 'herrmann2024', 'tudorlocke2011'],
        },
        {
          label: 'Obesity and sex',
          value:
            'Net walking cost per kg about 10 % higher in class-II obesity than in normal weight, and about 10 % higher in women than men',
          note: '39 adults walking at 0.5–1.75 m/s.',
          referenceIds: ['browning2006'],
        },
        {
          label: 'Minetti walking cost at the extremes',
          value: 'Minimum 1.64 J/kg/m at 1.0 m/s level; 17.33 at +45 %; 0.81 at −10 %; 3.46 at −45 %',
          note: 'The recalled polynomial reproduces these end-points within 4 % (17.6 against 17.33 at +45 %; 3.61 against 3.46 at −45 %).',
          referenceIds: ['minetti2002'],
        },
        {
          label: 'Cost relative to level walking, by grade (Minetti)',
          value: '−20 % 0.43; −10 % 0.45; −5 % 0.66; +5 % 1.44; +10 % 1.96; +15 % 2.54; +20 % 3.15',
          note: 'The ACSM multiplier (1 + 18 G) goes negative downhill, which is physically wrong, and over-predicts uphill walking by about 30 % at 5 %. Its values: below 0, below 0, 0.1, 1.90, 2.80, 3.70, 4.60.',
          referenceIds: ['minetti2002', 'ttu2013'],
        },
      ],
      timeCourse: 'Not a time-dependent process; the cost applies while walking.',
      moderators: 'Body mass, height, speed, grade, carried load, obesity and sex.',
      grade: 'B',
      gradeReason:
        "The equation is published and validated (A), but the per-step figures are Vitals' arithmetic on it (B).",
      status: 'proposed-fit',
      caveats:
        'The Minetti coefficients were recalled from the paper and only end-point-checked; the source should be verified before shipping. The step-length rule 0.415 × height is a heuristic.',
      referenceIds: [
        'ludlow2016',
        'ludlow2017',
        'weyand2013',
        'hall2004',
        'ttu2013',
        'minetti2002',
        'browning2006',
        'herrmann2024',
        'tudorlocke2011',
        'looney2019',
      ],
      relatedMetricIds: ['neat', 'exerciseEE'],
    },
    {
      id: '10-running-energy',
      title: 'What running costs',
      category: 'energy',
      summary:
        'Running costs about 0.9 kcal per kg of body mass per kilometre above rest, with a plausible range of 0.8–1.0. That is about 1.3–1.7 times the cost of walking the same distance. Uphill running costs more and steep downhill costs less, then more again.',
      howModelled:
        'Net cost is 0.9 times the ACSM running cost, which is 0.2 ml/kg per metre. Grade is applied as a ratio to level cost and kept within ±15 %, with the band widened to ±25 %. The result is shown with a ±15 % range.',
      equation: `ACSM running: VO2 = 0.2·S + 0.9·S·G + 3.5          (S ≥ 134 m/min, or ≥ 80 m/min when jogging)
default net cost = 0.90 kcal/kg/km   (efficiency factor 0.9 × ACSM, range 0.80–1.00)
Minetti running cost: Cr(G) = 155.4·G⁵ − 30.4·G⁴ − 43.3·G³ + 46.3·G² + 19.5·G + 3.6   J/kg/m   (coefficients unverified)`,
      keyNumbers: [
        {
          label: 'ACSM running cost',
          value: '0.2 ml/kg/m, that is 1.0 kcal/kg/km net',
          note: 'It agrees well with measured energy at 2.82 m/s, but is less precise than newer models for level running (RMSD 1.82 versus 1.27–1.44 W/kg).',
          referenceIds: ['ttu2013', 'hall2004', 'looney2026'],
        },
        {
          label: 'Other estimates of net cost per kg per km',
          value:
            'Compendium (MET − 1)/speed 0.83–0.91 at 6.6–12.9 km/h; Minetti level cost 3.4 ± 0.24 J/kg/m = 0.81 kcal/kg/km, independent of speed in 10 trained runners',
          note: 'Cost of transport rose 9.6–12.8 % between 3.58 and 5.14 m/s in sub-elite runners and was linear in average runners. Over the 10 published oxygen-to-energy equations the choice matters up to 5.2 %.',
          referenceIds: ['herrmann2024', 'minetti2002', 'batliner2018', 'kipp2018'],
        },
        {
          label: 'Net kcal per km at 0.90 kcal/kg/km',
          value: '60 kg 54; 75 kg 68; 90 kg 81; 110 kg 99',
          note: 'A 75 kg runner at 10 km/h for 30 minutes spends about 330 kcal net (efficiency 0.9) or about 365 (ACSM); the Compendium (10 MET) gives 394 gross and 357 net.',
        },
        {
          label: 'Running against walking',
          value:
            'Measured gross energy for 1600 m: 471 versus 373 kJ (run at 160 m/min versus walk at 86 m/min), that is 1.26 ×',
          note: '30 adults, 71 kg, VO2max 41.5. By the defaults, running per km costs about 1.4–1.7 times walking.',
          referenceIds: ['wilkin2012'],
        },
        {
          label: 'Cost relative to level running, by grade (Minetti)',
          value: '−20 % 0.50; −10 % 0.60; −5 % 0.76; +5 % 1.30; +10 % 1.66; +15 % 2.06; +20 % 2.50',
          note: 'ACSM (1 + 4.5 G) gives 0.10, 0.55, 0.78, 1.23, 1.45, 1.67, 1.90. End-point check of the running polynomial: 19.4 against 18.93 at +45 %; 1.80 against 1.73 at −20 %; 4.03 against 3.92 at −45 %. Minetti under-predicts uphill running against newer models (RMSD 2.18 versus 1.41–1.45 W/kg).',
          referenceIds: ['minetti2002', 'looney2026'],
        },
      ],
      timeCourse: 'Not a time-dependent process; cost applies during the run.',
      moderators: 'Body mass, speed, grade, running economy and fitness.',
      grade: 'B',
      gradeReason:
        'The ACSM equation is validated, but the 0.9 efficiency default is a proposed central value (B).',
      status: 'proposed-fit',
      caveats:
        'The central value of 0.90 is proposed. The Minetti coefficients were recalled from memory and end-point-checked only.',
      referenceIds: [
        'ttu2013',
        'hall2004',
        'looney2026',
        'herrmann2024',
        'minetti2002',
        'batliner2018',
        'kipp2018',
        'wilkin2012',
      ],
      relatedMetricIds: ['exerciseEE', 'tdee'],
    },
    {
      id: '10-cycling-swimming-sport-energy',
      title: 'Cycling, swimming, rowing and sport',
      category: 'energy',
      summary:
        'Cycling energy rises in a straight line with power output on top of a fixed baseline cost, so gross efficiency looks better at higher power. For swimming, rowing and sport, the engine uses published MET values, with wider uncertainty because skill, stroke and stop-start play change the cost.',
      howModelled:
        'Cycling gross metabolic power is 2.4 times resting metabolic rate plus power divided by 0.26. Outdoor cycling, swimming, rowing, elliptical and team sports use Compendium METs, with a ±25 % band for swimming and sport.',
      equation: `Cycling: gross metabolic power = 2.4 × RMR_W + P / 0.26      (proposed fit)
        equivalently 206 W + 3.85 × P for a 75 kg reference person
ACSM leg ergometry: VO2 = 1.8 × W_kgm/min / mass + 7   (ml/kg/min)`,
      keyNumbers: [
        {
          label: 'Fit to 11 Compendium stationary-cycling rows (R² = 0.99)',
          value: '50 W → 4.0 MET; 100 W → 6.4; 150 W → 8.0; 215 W → 10.8; 250 W → 12.5; 325 W → 16.3',
          note: 'Proposed fit with net efficiency 26 % (range 0.23–0.28) and baseline 2.4 × RMR. At 100 W the gross cost is about 8.4 kcal/min for a 75 kg adult.',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Cycling efficiency and the ACSM equation',
          value:
            'Energy is linear in work rate; about 91 % of variance comes from work rate. ACSM at 100 W and 75 kg gives 474 kcal/h, 6 % below the Compendium fit of 506 kcal/h',
          note: 'Gross efficiency therefore rises with power because the zero-load cost is diluted. Absolute efficiency values were not in the abstract (unverified).',
          referenceIds: ['ettema2009', 'ttu2013'],
        },
        {
          label: 'Outdoor cycling and machines',
          value:
            'Cycling 10–11.9 mph 6.8 MET up to 16–19 mph 12.0; e-bike 4.0–6.8; mountain 8.5–16; rowing ergometer 5.0–14.0 by watts; elliptical 5.0 and 9.0; stair treadmill 9.3',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Swimming',
          value: 'Freestyle 5.8 MET (slow) to 14.5 (elite), with a ±25 % skill band',
          note: 'The cost per distance is far higher than on land, because drag and propelling efficiency are worse, and it differs by stroke, sex and skill. No validated correction for buoyancy by body fat exists (unverified), so none is applied.',
          referenceIds: ['herrmann2024', 'zamparo2020'],
        },
        {
          label: 'Team and racquet sport',
          value:
            'Compendium METs, for example soccer 7.0 (casual) and 9.5 (competitive); tennis singles 8.0; basketball game 8.0; with a ±25 % band',
          note: 'The casual and general rows already average play and rest; the duty cycle varies widely.',
          referenceIds: ['herrmann2024'],
        },
      ],
      timeCourse: 'Not a time-dependent process; costs apply during the activity.',
      moderators: 'Power output (cycling), stroke and skill (swimming), body mass, and duty cycle (sport).',
      grade: 'B',
      gradeReason:
        'METs are well established (A), but the cycling equation is a fit and the sport duty cycle is graded C.',
      status: 'proposed-fit',
      caveats:
        'Sport and swimming carry a ±25 % band. The cycling fit was made to Compendium tabulated values rather than to raw measurements.',
      referenceIds: ['herrmann2024', 'ettema2009', 'ttu2013', 'zamparo2020'],
      relatedMetricIds: ['exerciseEE', 'tdee'],
    },
    {
      id: '10-resistance-session-energy',
      title: 'What a strength session costs',
      category: 'energy',
      summary:
        'A moderate hour of lifting costs about 4 METs including rest between sets, with a plausible range of 3–6. Energy in the sets is partly anaerobic and is missed by oxygen measurement, so the estimate is uncertain by about ±30 %. Afterwards, hard sessions did not raise resting metabolism at 12–48 hours.',
      howModelled:
        'A default of 4.0 MET is applied to the whole session duration, rest included. The extra afterburn after lifting is set at about 5 % of net cost.',
      keyNumbers: [
        {
          label: 'Compendium values',
          value:
            '3.5 MET (8–15 reps, multiple exercises); 5.0 (squat and deadlift); 5.8 (circuit or supersets); 6.0 (vigorous, powerlifting or bodybuilding)',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'A 70-minute circuit against 49 minutes of cycling at 70 % VO2max (men, about 80 kg)',
          value:
            '448 ± 21 kcal gross (about 4.6 MET) against 546 ± 16 kcal; 24-hour energy use and fuel oxidation were similar',
          note: 'The circuit was 4 × 10 exercises at 70 % of one-repetition maximum.',
          referenceIds: ['melanson2002'],
        },
        {
          label: 'Single-set ACSM protocol (8 exercises of 15RM)',
          value: '3.9–4.2 MET; 135 kcal in men and 82 kcal in women',
          referenceIds: ['phillips2003'],
        },
        {
          label: 'How well lifting can be measured',
          value:
            'A 166-study review found values "widely varying" and recommended MET or lactate-corrected estimates',
          note: 'Sets are anaerobic, so indirect calorimetry underestimates their cost. In leg exercises the working-set cost is 3–10 kcal/min at 12–24 % of one-repetition maximum and above 20 kcal/min at 80 % (exhaustive sets only).',
          referenceIds: ['mitchell2024', 'reis2017'],
        },
        {
          label: 'Afterburn after hard lifting',
          value:
            'Two hard sessions (10,000 and 20,000 kg volume; 247 and 484 kcal during) gave no significant RMR elevation at 12–48 hours',
          referenceIds: ['abboud2013'],
        },
        {
          label: 'Long-term training effect on RMR',
          value: '+96 kcal/day (95 % CI 45–147), mostly through fat-free mass',
          note: 'This belongs to the energy expenditure and resistance-training topics.',
          referenceIds: ['mackenzieshalders2020'],
        },
      ],
      timeCourse: 'Afterburn is small; RMR is unchanged at 12–48 hours after hard sessions.',
      moderators: 'Load, rest between sets, exercise choice and session length.',
      grade: 'C',
      gradeReason:
        'Anaerobic cost is not captured by oxygen measurement, so the values are uncertain and the MET choice is a judgement.',
      status: 'proposed-fit',
      caveats: 'The energy cost is uncertain by about ±30 %. The 4.0 MET default is a chosen central value.',
      referenceIds: [
        'herrmann2024',
        'melanson2002',
        'phillips2003',
        'mitchell2024',
        'reis2017',
        'abboud2013',
        'mackenzieshalders2020',
      ],
      relatedMetricIds: ['exerciseEE', 'tdee'],
    },
    {
      id: '10-wearable-calorie-error',
      title: 'How accurate are wrist devices at counting calories?',
      category: 'energy',
      summary:
        'No consumer wrist device kept its median error in energy expenditure under 20 % in a validation study of a diverse group of people. Errors were worst for walking, best for cycling, and larger at higher BMI. The app therefore shows ranges, and it does not calibrate to wearables.',
      howModelled:
        'The engine shows exercise energy with a ±15 % band for equation-based activities and ±25 % for sport, swimming and lifting.',
      keyNumbers: [
        {
          label: 'Consumer wrist devices',
          value:
            'None reached less than 20 % median error in energy expenditure; Apple Watch was best and Samsung worst; walking was worst and cycling best; error was higher at higher BMI',
          referenceIds: ['shcherbina2017'],
        },
        {
          label: 'Standard METs against individually referenced METs',
          value: 'Standard METs under-estimate 89 % of the time',
          referenceIds: ['compendium2024b'],
        },
      ],
      timeCourse: 'Not a time-dependent process.',
      moderators: 'Activity type and body mass index.',
      grade: 'B',
      gradeReason: 'A single, well-designed validation study in a diverse cohort.',
      status: 'established',
      caveats: 'One study of specific devices available at the time; new devices may differ.',
      referenceIds: ['shcherbina2017', 'compendium2024b'],
      relatedMetricIds: ['exerciseEE'],
    },
    {
      id: '10-epoc',
      title: 'The "afterburn": extra oxygen use after exercise',
      category: 'energy',
      summary:
        "After exercise, oxygen use stays above resting for a while. After light exercise it is back to normal in 10–15 minutes. After long, hard sessions, the extra energy is about 6–15 % of the session's net cost. A 30-minute HIIT session typically produces only about 25–40 kcal of afterburn. It is not a fat-loss strategy.",
      howModelled:
        'Afterburn is a fraction of the net session cost that rises steeply once intensity passes about 68 % of maximal oxygen use and grows with duration up to 45 minutes. It is capped at 15 % (20 % for intervals). It is released over hours in two phases, faster in trained people.',
      equation: `epocKcal = φ × netKcal
φ = max(φ_floor, φ_max × S(x) × Dfac(dur))
S(x) = 1/(1 + exp(−(x − 0.68)/0.06));   Dfac = min(1, dur/45)^0.7
φ_max = 0.15 (continuous) or 0.20 (intervals incl. sprint);   φ_floor = 0.02
EPOC(t) = epocKcal × [a1·exp(−t/τ1) + (1 − a1)·exp(−t/τ2)]
vigorous: a1 = 0.6, τ1 = 0.4 h, τ2 = 4 h;  light: a1 = 1, τ1 = 0.15 h;  trained people: τ × 0.75`,
      keyNumbers: [
        {
          label: 'Review of controlled studies',
          value:
            'Prolonged EPOC (3–24 h) needs at least 50 min at 70 % VO2max or more, or at least 6 min at 105 % or more; even then it is 6–15 % of the net oxygen cost of the exercise',
          note: 'The review states that earlier optimism about afterburn and weight loss is generally unfounded.',
          referenceIds: ['laforgia2006'],
        },
        {
          label: '45 min of cycling at 72.8 ± 5.8 % VO2max, 10 men, metabolic chamber',
          value:
            'Net exercise cost 519 ± 61 kcal; +190 kcal above resting over the next 14 h (+37 %, an upper outlier)',
          referenceIds: ['knab2011'],
        },
        {
          label: 'Systematic review of 22 studies',
          value:
            'Up to 3 h: about 101 kJ (24 kcal) after moderate continuous exercise against about 136 kJ (33 kcal) after HIIT; sprint interval about 241 kJ (58 kcal) against 151 kJ (36 kcal) after moderate continuous; beyond 3 h: 289 kJ (69 kcal) HIIT against 159 kJ (38 kcal)',
          referenceIds: ['panissa2021'],
        },
        {
          label: '8 active men, 2 hours afterwards',
          value:
            'EPOC 8.6 ± 4.7 L (30 min at 85 % VO2max; about 43 kcal at 5 kcal/L) and 10.0 ± 4.2 L (4 × 30 s sprints; about 50 kcal), both above 30 min at 65 %',
          note: 'Fat oxidation afterwards was highest after sprint intervals (+0.115 g/min).',
          referenceIds: ['islam2018'],
        },
        {
          label: 'One sprint session (4–6 × 30 s Wingate) in a whole-room calorimeter',
          value: 'TDEE +946 ± 62 kJ/day (about 226 kcal, about +10 %); RMR next morning unchanged',
          referenceIds: ['sevits2013'],
        },
        {
          label: 'Walking and running 1600 m',
          value: 'Energy use back to resting within about 10 minutes (walk) and 15 minutes (run)',
          referenceIds: ['wilkin2012'],
        },
        {
          label: 'Lifting and a 24-hour chamber comparison',
          value:
            'Two hard lifting bouts: no significant RMR elevation at 12–48 h. Cycling 49 min against a 70 min circuit gave comparable 24-hour energy use',
          note: 'A review notes more prolonged afterburn after hard than moderate lifting but no dose-response, and faster recovery in trained people.',
          referenceIds: ['abboud2013', 'melanson2002', 'borsheim2003'],
        },
        {
          label: 'Default φ by session type (range)',
          value:
            'Walking or light under 50 % VO2max 0.02 (0–0.04); moderate 50–65 %, 30–60 min 0.04–0.06 (0.02–0.08); vigorous continuous 70–85 %, 45 min or more 0.10–0.14 (0.06–0.15; outlier 0.37); HIIT 0.10–0.15 (0.06–0.25); sprint sessions 40–60 kcal per session; lifting 0.05 (0–0.10)',
          note: 'A 30-minute HIIT session of about 300 kcal gross (about 250 net) yields about 25–40 kcal of afterburn, roughly 10–15 % of its net cost.',
        },
      ],
      timeCourse:
        'Light exercise: 10–15 minutes. Vigorous: 36 % of the extra energy remaining at 1 hour, 25 % at 2 hours, 5 % at 8 hours and 1 % at 14 hours.',
      moderators: 'Intensity, duration, exercise mode and training status (trained people recover faster).',
      grade: 'B',
      gradeReason:
        "A review and several chamber studies agree on the size (Vitals' evidence review gives A−/B); the release kinetics are graded C and most studies are small, in young men.",
      status: 'proposed-fit',
      caveats:
        'The 45-minute cycling study is a 37 % outlier. The φ function and release times are proposed fits.',
      referenceIds: [
        'laforgia2006',
        'knab2011',
        'panissa2021',
        'islam2018',
        'sevits2013',
        'wilkin2012',
        'abboud2013',
        'melanson2002',
        'borsheim2003',
      ],
      relatedMetricIds: ['exerciseEE', 'tdee'],
    },
    {
      id: '10-exercise-energy-compensation',
      title: 'How much of exercise energy becomes extra daily energy use',
      category: 'energy',
      summary:
        'Not all the energy a person spends in exercise adds to daily energy use. In trials of 12–40 weeks with 100–400 kcal a day of exercise, total compensation was about 30–65 %. Most of it came through eating more, not through a lower resting metabolism, and weight loss was about half of what the exercise energy predicts. People do not eat back the energy the same day.',
      howModelled:
        'Two parts. A metabolic part lowers non-exercise energy use by 15 % of net exercise energy (range 0–28 %, higher with more body fat), with a lag of 14 days and a cap of −5 % of RMR. An appetite part adds up to 100 kcal a day of extra hunger drive, following a saturating curve with a constant of 150 kcal a day and a lag of 28 days. In ad libitum mode the appetite part becomes extra intake.',
      equation: `dTDEE_comp = −c_met(BMI) × Enet         (Enet = 7-day mean net exercise energy above baseline, kcal/day)
c_met = 0.15 + 0.010 × clamp(BMI − 25, −5, 8)      (proposed)
apComp = A_max × (1 − exp(−Enet/K)),   A_max = 100 kcal/day,  K = 150 kcal/day
total compensation (%) = 100 × (c_met × Enet + apComp) / Enet
individual variation: c_i ~ N(1, 0.6) truncated to [0, 2]`,
      keyNumbers: [
        {
          label: '24-week trial, 198 adults with BMI 31.5 (171 analysed), 8 versus 20 kcal/kg/week',
          value:
            'Weight compensation 1.5 kg and 2.7 kg; intake by doubly labelled water +90.7 kcal/day (CI 35–146) and +123.6 (64–183) against −2.3 in controls; RMR and non-exercise activity unchanged',
          referenceIds: ['martin2019'],
        },
        {
          label: 'Sub-studies of the same trial using doubly labelled water and a calorimeter chamber',
          value:
            'At 20 kcal/kg/week weight loss was −2.1 kg, half of expected; free-living TDEE +about 4 %, but chamber 24-hour energy use −about 4 %. 48 % showed exercise-related energy compensation (TDEE shortfall −308 ± 158 kcal/day) with no change in sleeping, resting or 24-hour energy use',
          note: 'The shortfall correlated with baseline TDEE (r = −0.50).',
          referenceIds: ['broskey2021', 'flanagan2024'],
        },
        {
          label: '12 weeks, 36 overweight adults, 300 versus 600 kcal per session, 5 days a week',
          value:
            'Compensation 943 (CI −164 to 2050) and 1007 (32–1982) kcal/week, that is 62.9 % versus 33.6 % of exercise energy',
          note: 'RMR and self-reported intake were unchanged; acyl-ghrelin rose while GLP-1 and food reinforcement fell. Only the 3000 kcal/week dose reduced fat.',
          referenceIds: ['flack2018'],
        },
        {
          label: '12 weeks, 6 versus 2 sessions a week (2753 versus 1491 kcal/week)',
          value: 'About 50 % compensated, regardless of dose',
          note: 'A smaller fall in leptin predicted less compensation. Changes in resting energy or respiratory quotient did not contribute.',
          referenceIds: ['flack2020'],
        },
        {
          label:
            'MET-2 trial: 10 months, 141 young overweight adults, 400 versus 600 kcal per session, 5 days a week, supervised',
          value:
            'Weight −3.9 ± 4.9 kg and −5.2 ± 5.6 kg against +0.5 kg in controls; about 35 % and 31 % of the expected weight loss (expected about 11 and 17 kg)',
          note: 'Mean intake, RMR and non-exercise activity were unchanged on average. 40 people were responders and 34 non-responders. Non-responder men ate more and moved less, and women ate more at the 600 kcal dose at 3.5 and 7 months.',
          referenceIds: ['donnelly2013', 'washburn2015', 'willis2014', 'herrmann2015'],
        },
        {
          label: 'Systematic review of 61 studies (928 people)',
          value:
            'Compensation averaged 18 % ± 93 %, explained by fat mass, age and duration; it approaches 84 % by about 80 weeks (an extrapolation)',
          note: 'Sex, frequency, intensity and dose were not predictors. The spread of compensation between people was about 90 % of the mean.',
          referenceIds: ['riou2015'],
        },
        {
          label: 'Energy-balance review of exercise trials',
          value:
            'Low weight loss reflected low prescribed doses plus higher intake; RMR was 7 % below the fat-free-mass prediction (bias −81 kcal/day, CI −148 to −13) in one confined study; about 92 % (12 of 13) of half-marathon trainees increased intake',
          note: 'Energy-balance calculations agreed with a chamber within 80–145 kcal/day. The 3500-kcal-per-pound rule and prescribed-versus-actual exercise energy overstate the expected deficit.',
          referenceIds: ['thomas2012'],
        },
        {
          label: 'Supervised trial with monitored intake (52 obese men, 3 months)',
          value:
            'Exercise-induced weight loss −7.5 kg, equal to diet; the achieved imbalance (−701 kcal/day) matched the prescribed exercise energy (−700)',
          note: 'Near-full expression when exercise is supervised and intake monitored.',
          referenceIds: ['ross2000'],
        },
        {
          label: 'One bout of exercise and the next meal',
          value:
            'Absolute intake unchanged (effect size 0.14, CI −0.005 to 0.29); relative intake −1.35 SD; no same-day food compensation (29 studies, 51 trials)',
          referenceIds: ['schubert2013', 'deighton2014'],
        },
        {
          label: 'Model against trials (total compensation, observed / model)',
          value:
            '8 kcal/kg/week 65 % / 63 %; 20 kcal/kg/week 47 % / 46 %; Flack 2018 1500 kcal/week 63 % / 50 %; 3000 kcal/week 34 % / 37 %; Flack 2020 (1491 / 2753) 50 % and 50 % / 51 % and 39 %; cross-sectional TEE-only 28 % / 15 % (range 0–28)',
          note: 'The model misses the lowest Flack dose (50 % against 63 %) and the second Flack 2020 dose (39 % against 50 %). Four parameter sets with c_met of 0, 0.10, 0.15 and 0.28 all reproduce total compensation of 40–65 %, so the split cannot be identified from weight totals.',
          referenceIds: ['martin2019', 'flack2018', 'flack2020', 'careau2021'],
        },
        {
          label: 'Person-to-person differences',
          value:
            'Some people compensate fully; men who were non-responders ate more; women at high dose ate more',
          referenceIds: ['king2008', 'melanson2013', 'herrmann2015', 'washburn2015'],
        },
      ],
      timeCourse:
        'The metabolic part has a 14-day lag and the appetite part a 28-day lag (both proposals, the second grade D). Long-term drift towards about 84 % compensation at about 80 weeks is off by default.',
      moderators:
        'Body fat (more compensation with more adiposity), supervision, exercise dose and individual differences.',
      grade: 'B',
      gradeReason:
        'Several randomised trials with doubly labelled water agree on total compensation of 30–65 %; the split between metabolic and appetite parts is graded C.',
      status: 'proposed-fit',
      caveats:
        'The split between metabolic and appetite compensation is not identifiable from the data. The adiposity modifier comes from one cross-sectional analysis. The lags are guesses.',
      referenceIds: [
        'martin2019',
        'broskey2021',
        'flanagan2024',
        'flack2018',
        'flack2020',
        'donnelly2013',
        'washburn2015',
        'willis2014',
        'herrmann2015',
        'riou2015',
        'thomas2012',
        'ross2000',
        'schubert2013',
        'deighton2014',
        'careau2021',
        'king2008',
        'melanson2013',
      ],
      relatedMetricIds: ['tdee', 'rmr', 'hunger'],
    },
    {
      id: '10-constrained-energy-expenditure',
      title: 'Does the body cap total daily energy use as activity rises?',
      category: 'energy',
      summary:
        'Some studies find that total daily energy use stops rising once activity passes a moderate level, as if the body trims energy use elsewhere. Others find that exercise adds to daily energy use by more than its own cost in untrained people. The strongest intervention trials show people eating more, with no drop in resting metabolism. The question is unsettled, so the engine runs with a middle setting and can show both views.',
      howModelled:
        'The default metabolic compensation is 15 % of net exercise energy, within a sensitivity range of 0 to 28 %. It is raised a little with body fat, and it never lowers RMR by more than 5 %. A sensitivity run shows both the additive and the constrained view.',
      keyNumbers: [
        {
          label: '332 adults in 5 populations, doubly labelled water against accelerometer counts',
          value:
            'TEE rises with activity below a change-point of 230 counts/min/day (95 % CI 44–428; TEE_adj = 1.12 × counts + 2336 kcal/day), then plateaus at about 2600 kcal/day (slope 0.21 ± 0.35, p = 0.54, n = 92)',
          note: 'RMR was uncorrelated with activity. Above about 219 counts a minute, each further +100 counts gives under 50 kcal a day.',
          referenceIds: ['pontzer2016'],
        },
        {
          label: 'Doubly labelled water database, 1,754 adults (activity level 1.74 ± 0.27; BMI 12.5–61.7)',
          value:
            'TEE-on-BEE slope 0.723 ± 0.049 (CI 0.626–0.820), that is 27.7 % compensation; activity energy slope −0.349 ± 0.044; compensation 29.7 % at the 10th BMI percentile against 45.7 % at the 90th',
          note: 'No sex or age effect. Within-person data (68 people aged 70–90, repeated 7 years later) gave a within-person slope of 0.15 ± 0.17, close to full compensation. The analysis is cross-sectional. The BMI values at those percentiles are unverified (assumed about 20 and 33).',
          referenceIds: ['careau2021'],
        },
        {
          label: 'Counter-view in reviews',
          value:
            'In untrained people exercise raises TEE by more than the training cost; sustainable activity levels are 1.1–1.2 to 2.0–2.5; professional endurance athletes reach about 4.0',
          referenceIds: ['westerterp2013', 'westerterp2017'],
        },
        {
          label: 'Non-exercise physical activity across 10 trials (44 effects)',
          value:
            'Does not change with training (effect size 0.02, CI −0.09 to 0.13); an initial dip attenuates with time',
          referenceIds: ['fedewa2017'],
        },
        {
          label: 'Exercise training and RMR (18 trials)',
          value: 'Aerobic +82 kcal/day (CI −58 to 221, not significant); resistance +96 kcal/day (45–147)',
          referenceIds: ['mackenzieshalders2020'],
        },
        {
          label: 'Strongest human intervention trials',
          value: 'Support intake compensation with no change in RMR or non-exercise activity',
          referenceIds: ['martin2019', 'flanagan2024', 'thomas2012'],
        },
      ],
      timeCourse:
        'Compensation builds with a lag; a 14-day lag is used for the metabolic part (a guess, grade D).',
      moderators:
        'Body fat (more compensation at higher BMI in the cross-sectional data), age and habitual activity.',
      grade: 'C',
      gradeReason:
        'Cross-sectional and interventional evidence point in different directions, and the split is not identifiable.',
      status: 'contested',
      caveats:
        'The constrained-energy model and the additive model both have support. The cross-sectional slope may reflect individual traits rather than a within-person effect. Long-term drift is off by default.',
      referenceIds: [
        'pontzer2016',
        'careau2021',
        'westerterp2013',
        'westerterp2017',
        'fedewa2017',
        'mackenzieshalders2020',
        'martin2019',
        'flanagan2024',
        'thomas2012',
      ],
      relatedMetricIds: ['tdee', 'rmr'],
    },
    {
      id: '10-fat-oxidation-by-intensity',
      title: 'Which fuel you burn as exercise gets harder',
      category: 'fuel',
      summary:
        'Fat burning in grams per minute peaks at moderate intensity, around half of maximal oxygen use in untrained people and about two thirds in trained cyclists, then falls to nearly nothing at very hard effort. The peak is higher in women, in trained people and in those adapted to very low carbohydrate. But the mix of fuel burned during a session does not decide fat loss: energy balance does.',
      howModelled:
        'The respiratory exchange ratio (RER, the CO2-to-O2 ratio that shows the fuel mix) rises with relative intensity along a curve set by training and diet presets, with a small offset after a meal and a slow downward drift over long sessions. Fat and carbohydrate grams follow from the gas-exchange equations.',
      equation: `RER(x) = max(0.707, RERlo + (1.10 − RERlo) · x^n),    x = VO2_gross / VO2max
fatOx (g/min) = VO2 · (1.695 − 1.701 · min(RER, 1))
choOx = VO2 · (4.210·RER − 2.962)  for x < 0.75;   VO2 · (4.344·RER − 3.061)  for x ≥ 0.75
duration drift at 65–75 % VO2max: dRER = −0.05 · (1 − exp(−t/120 min))`,
      keyNumbers: [
        {
          label: '300 healthy adults (treadmill test)',
          value:
            'Peak fat oxidation 7.8 ± 0.13 mg/kg FFM/min at 48.3 ± 0.9 % VO2max; women 8.3 versus men 7.4; Fatmax 52 versus 45 %',
          note: 'Peak fat oxidation was predicted by activity, VO2max and sex (R² = 0.12).',
          referenceIds: ['venables2005'],
        },
        {
          label: '18 moderately trained cyclists',
          value: 'Fatmax 64 ± 4 % VO2max (74 % of maximal heart rate); zone 55–72 %; negligible above 89 %',
          note: 'Fat contributes about 0 % of energy above 85–90 % VO2max in trained cyclists. Fat release from fat tissue is highest at the lowest intensities, and use of fat inside muscle appears only at higher intensities.',
          referenceIds: ['achten2002', 'vanloon2001', 'romijn1993'],
        },
        {
          label: '1,121 athletes (933 men, 188 women)',
          value: 'Peak 0.59 ± 0.18 g/min (0.17–1.27) at 49.3 ± 14.8 % VO2max; men 0.61 and women 0.50 g/min',
          note: 'More than half the variation was unexplained by body composition or fitness.',
          referenceIds: ['randell2017'],
        },
        {
          label: 'Age, sex and obesity',
          value:
            'Peak fat oxidation is higher in young women than men, with the gap smaller after age 45 (435 adults); in obesity it is 0.27–0.33 g/min with Fatmax at 61–66 % of peak heart rate (64 papers)',
          referenceIds: ['frandsen2021', 'chavez2023'],
        },
        {
          label: 'Training',
          value:
            '12 months of jogging or walking 3 × 45 min in 17 sedentary adults raised peak fat oxidation from 0.26 to 0.33 g/min and its position from 35 to 50 % VO2max',
          referenceIds: ['scharhag2010'],
        },
        {
          label:
            'Ultra-endurance runners adapted to very low carbohydrate, against high-carbohydrate runners (10 each)',
          value:
            'Peak fat oxidation 1.54 ± 0.18 versus 0.67 ± 0.14 g/min at 70.3 versus 54.9 % VO2max; fat supplied 88 versus 56 % of energy at 64 % for 180 min',
          note: 'Muscle glycogen use (−64 %) and repletion were similar in both groups.',
          referenceIds: ['volek2016'],
        },
        {
          label: 'Fed and fasted',
          value:
            'Fasted exercise oxidises 3.08 g (CI 0.79–5.38) more fat per session; respiratory quotient 0.86 fasted versus 0.90 fed at 60 % VO2max for 60 min',
          note: 'Fatty-acid levels in the blood were equal; glucose and insulin were higher when fed (27 studies, 273 people).',
          referenceIds: ['vieira2016', 'bachman2016'],
        },
        {
          label:
            'Presets (VO2max in L/min; low-intensity RER; curve shape n; Fatmax; peak fat oxidation in g/min)',
          value:
            'Untrained 3.2; 0.75; 2.0; 48 %; 0.43. Moderately trained 4.0; 0.855; 5.4; 64 %; 0.52. Athletes 4.2; 0.75; 2.1; 49 %; 0.59. High-carbohydrate elite 4.7; 0.795; 3.05; 55 %; 0.67. Elite adapted to very low carbohydrate 5.3; 0.715; 6.5; 70 %; 1.54',
          note: 'Proposed fit to published group means. Fat burning falls to zero at 84 %, 90 %, 85 %, 87 % and 95 % of VO2max respectively. Low-intensity RER and curve shape trade off, so the fits are not unique. Effect of long sessions: RER 0.85 fell to 0.80 over 3 hours in one study.',
          referenceIds: ['venables2005', 'achten2002', 'randell2017', 'volek2016', 'coyle1986'],
        },
        {
          label:
            'Test vectors (fasted): fat g/min (share of energy) and carbohydrate g/min at x = 0.30 / 0.50 / 0.65 / 0.80',
          value:
            'Untrained: 0.35 (74 %) 0.31 | 0.43 (54 %) 0.90 | 0.35 (33 %) 1.70 | 0.10 (7 %) 3.00. Moderately trained: 0.29 (47 %) 0.77 | 0.46 (46 %) 1.32 | 0.52 (39 %) 1.92 | 0.37 (22 %) 3.11. Adapted to very low carbohydrate (5.3 L/min): 0.76 (98 %) 0.08 | 1.25 (96 %) 0.18 | 1.51 (89 %) 0.51 | 1.38 (65 %) 1.85',
          note: 'A postprandial offset of +0.015 in RER at 60 % VO2max in a trained person lowers fat oxidation from 0.51 to about 0.46 g/min (30.8 to about 27.4 g in an hour, −3.4 g, matching −3.08 g). An offset of +0.04 gives −9 g.',
        },
        {
          label: 'Effects of sex, training and time of day',
          value:
            'Women: +12 % fat oxidation per kg FFM and Fatmax +7 percentage points, disappearing after age 45; training: peak +27 % and Fatmax +15 percentage points in 12 months',
          note: 'Evening peak fat oxidation is reported in some studies, not universally.',
          referenceIds: ['frandsen2021', 'scharhag2010', 'rubiovalles2025'],
        },
      ],
      timeCourse:
        'Fat share rises with session length, as RER drifts down by about 0.05 over 2–3 hours. Adaptation to very low carbohydrate takes weeks to months.',
      moderators:
        'Sex, age, training status, diet (very low carbohydrate raises fat use), fed state, session duration, obesity and time of day.',
      grade: 'A',
      gradeReason:
        'The bell shape and the effects of diet, training and sex are supported by large datasets and validated stoichiometry; the presets are fits to means (B).',
      status: 'proposed-fit',
      caveats:
        'Presets fit group means, and individual variation is large (SD 0.18 g/min in athletes). They are not unique fits. Fat oxidation during a session is not a proxy for fat loss.',
      referenceIds: [
        'venables2005',
        'achten2002',
        'vanloon2001',
        'romijn1993',
        'randell2017',
        'frandsen2021',
        'chavez2023',
        'scharhag2010',
        'volek2016',
        'vieira2016',
        'bachman2016',
        'coyle1986',
        'rubiovalles2025',
      ],
      relatedMetricIds: [],
    },
    {
      id: '10-glycogen-use-in-exercise',
      title: 'Muscle glycogen used during exercise',
      category: 'fuel',
      summary:
        'Muscle glycogen is the main fuel at 65–100 % of maximal oxygen use. Use rises with intensity and with starting stores, falls with training and is slightly lower in women and in running than in cycling. Very-low-carbohydrate adaptation does not spare glycogen in trained athletes.',
      howModelled:
        'The exercise topic supplies the demand: carbohydrate burned per minute from the fuel curve, split between muscle and blood sources. The carbohydrate topic owns the stores. The muscle share falls from 0.90 at the start to about 0.67 at 3 hours, and use is throttled as the store empties.',
      equation: `f_mg(t) = 0.90 − 0.30 · (1 − exp(−t/120 min))
a(g) = (g²/(g² + 0.2²)) / (1/(1 + 0.2²)),   g = G_muscle/G_rest
muscleGlycogenUse (g/min) = choOx × f_mg(t) × a(g);   liver and blood glucose = choOx × (1 − f_mg)
D_loc = used_g / (workedMuscleMass_kg × 16 g/kg wet)     (worked muscle about 20 kg, proposed)`,
      keyNumbers: [
        {
          label: 'Resting vastus lateralis glycogen (men, normal carbohydrate, VO2max 53 ml/kg/min)',
          value:
            '462 ± 132 mmol/kg dry mass; high carbohydrate availability +102 (±47); low −253 (±30); +10 ml/kg/min VO2max adds +29 (low), +67 (normal), +80 (high carbohydrate)',
          note: '1 mmol glucosyl unit = 0.162 g of glycogen, so 462 mmol/kg dm is about 75 g/kg dm.',
          referenceIds: ['areta2018'],
        },
        {
          label: 'Meta-regression of 181 studies of cycling and running',
          value:
            '+30 % VO2max intensity → +87–134 mmol/kg dm more glycogen used at 23 min or more; +200 mmol/kg dm starting glycogen → +104 at 116 min and +143 at fatigue; women −30 (±29); running −70 (±32) against cycling',
          note: 'Carbohydrate ingestion and VO2max had trivial effects.',
          referenceIds: ['areta2018'],
        },
        {
          label: '7 endurance-trained cyclists at 71 ± 1 % VO2max to fatigue (3.02 h on placebo)',
          value:
            'Vastus glycogen fell 51.5 ± 5.4 mmol/kg wet/h in the first 2 hours and 23.0 ± 14.3 in the third; RER 0.85 → 0.80; fatigue with plasma glucose 2.5 mM',
          note: 'With carbohydrate feeding, endurance rose by 1 hour with little further muscle glycogen use (5 mmol/kg/h).',
          referenceIds: ['coyle1986'],
        },
        {
          label: 'Elite runners adapted to very low carbohydrate against high-carbohydrate runners',
          value:
            'Same relative muscle glycogen depletion (−64 % after 180 min at 64 % VO2max) and repletion (−36 % of pre at 120 min recovery)',
          referenceIds: ['volek2016'],
        },
        {
          label: 'Resistance exercise',
          value:
            'Six sets of leg extension degraded 47.0 ± 6.6 and 46.6 ± 6.0 mmol/kg wet of quadriceps glycogen at 70 % and 35 % of one-repetition maximum with equal external work; three leg exercises over about 39 min: 121 → 88 mmol/kg wet (−27 %) on placebo against 127 → 110 (−14 %) with carbohydrate',
          referenceIds: ['robergs1991', 'haff2000'],
        },
        {
          label: 'High-intensity intermittent exercise and liver glycogen',
          value:
            'Large glycogen reductions after short durations, heterogeneous by fibre type; whole-muscle averages can under-report fibre-level depletion. Trained athletes do not have higher basal liver glycogen; carbohydrate intake above 1.5 g/min prevents liver glycogen depletion in moderate exercise',
          referenceIds: ['vighlarsen2021', 'gonzalez2016'],
        },
        {
          label: 'Model test (trained, VO2max 4.6 L/min, 71 % intensity, no throttle)',
          value:
            'Carbohydrate 413 g and muscle glycogen 314 g in 3 hours (124, 101 and 88 g by hour), with carbohydrate burned falling from 2.6 to 2.1 g/min',
          note: "It reproduces total 3-hour depletion (about a full 420 g store in about 20 kg of working muscle, Vitals' estimate) but under-predicts the slowdown in hour 3 (0.78 against 0.45). The throttle closes part of the gap.",
        },
        {
          label: 'Session presets (grade D–C)',
          value:
            '60 min run at 65 % VO2max, 75 kg: carbohydrate about 100–120 g, muscle glycogen about 85–100 g. 30 min HIIT (about 315 kcal gross, carbohydrate about 70 % of energy including anaerobic): 45–55 g. 60 min moderate lifting (4 MET, carbohydrate about 60 %): about 40–50 g, with 25–35 % local depletion of worked muscle',
          referenceIds: ['robergs1991', 'haff2000'],
        },
      ],
      timeCourse: 'At 71 % VO2max, glycogen falls fastest in the first 2 hours and more slowly in the third.',
      moderators:
        'Intensity, starting glycogen (diet), training status, sex, mode (running or cycling) and fibre type.',
      grade: 'B',
      gradeReason:
        'A meta-analysis and classic studies support the magnitudes at 65–75 % VO2max; whole-body use in high-intensity and lifting sessions is model-based (C–D).',
      status: 'proposed-fit',
      caveats:
        'The model under-predicts the slowdown in hour 3. HIIT and lifting whole-body values need fibre-type-level data.',
      referenceIds: [
        'areta2018',
        'coyle1986',
        'volek2016',
        'robergs1991',
        'haff2000',
        'vighlarsen2021',
        'gonzalez2016',
      ],
      relatedMetricIds: [],
    },
    {
      id: '10-fasted-exercise-and-fat-loss',
      title: 'Exercising fasted: more fat burned in the session, not more fat lost',
      category: 'performance',
      summary:
        'Exercising after an overnight fast burns about 3 g more fat in the session and shifts fuel use over the following 24 hours. At the same energy intake, fat and weight loss over weeks were the same as when exercising fed. Fasted exercise may lower food intake later in the day while raising hunger.',
      howModelled:
        'Fasting state changes only the fuel mix during the session, the 24-hour split of fat and carbohydrate, and a small hunger drive. There is no direct fat-mass effect.',
      keyNumbers: [
        {
          label: 'Fasted against fed aerobic exercise (27 studies, 273 people)',
          value:
            '+3.08 g fat oxidised per session (CI 0.79–5.38); fatty acids in blood equal; glucose +0.78 mmol/L and insulin +105 pmol/L higher when fed',
          referenceIds: ['vieira2016'],
        },
        {
          label: '24-hour fat oxidation at equal energy in a chamber',
          value:
            'Before-breakfast 60 min at 50 % VO2max: 717 ± 64 versus 456 ± 61 (control), 446 (afternoon) and 432 (evening) kcal/day in 10 young men. 100 min at 65 % before breakfast: 1142 versus 609 kcal/day after lunch in 9 athletes',
          note: 'The 24-hour difference correlated with the transient energy and carbohydrate deficit (r = −0.72 and −0.40). Post-absorptive exercise saved carbohydrate with no difference in 24-hour energy use. These are shifts in which fuel is burned; energy balance is unchanged, so they do not imply extra fat loss.',
          referenceIds: ['iwayama2015b', 'iwayama2015a', 'shimada2013'],
        },
        {
          label: '4 weeks, 20 women on a reduced-calorie diet, 1 hour of steady exercise 3 times a week',
          value:
            'Both fasted and fed groups lost weight (p = 0.0005) and fat mass (p = 0.02), with no difference between groups',
          referenceIds: ['schoenfeld2014'],
        },
        {
          label: 'Meta-analysis (5 studies, 96 people)',
          value:
            'Trivial to small effects, and trivial differences between groups in body mass, percent fat and lean mass',
          note: 'The authors urge caution because of the small number of studies.',
          referenceIds: ['hackett2017'],
        },
        {
          label: 'Appetite: network meta-analysis of 17 papers',
          value:
            '24-hour intake lower after fasted exercise without a post-exercise meal (−2095 kJ, CI −3910 to −280), but hunger higher (+13–23 mm) and expenditure slightly lower; low confidence',
          note: 'In 12 active men, a fasted 60-minute run at 60 % VO2max cut 24-hour intake (15,312 versus 19,172 kJ).',
          referenceIds: ['frampton2022', 'bachman2016'],
        },
      ],
      timeCourse:
        'The fat-oxidation shift applies in the session and across 24 hours; body-composition trials lasted 4 weeks.',
      moderators: 'Time since the last meal, intensity, duration, and whether a meal is eaten afterwards.',
      grade: 'B',
      gradeReason:
        'A meta-analysis, a randomised trial and chamber studies agree; the body-composition trials are small.',
      status: 'established',
      caveats:
        'There are few body-composition trials, and appetite findings come from low-confidence analyses.',
      referenceIds: [
        'vieira2016',
        'iwayama2015b',
        'iwayama2015a',
        'shimada2013',
        'schoenfeld2014',
        'hackett2017',
        'frampton2022',
        'bachman2016',
      ],
      relatedMetricIds: [],
    },
    {
      id: '10-hiit-vs-continuous-fat-loss',
      title: 'Interval training against steady cardio for fat loss',
      category: 'body',
      summary:
        'Interval training and moderate steady cardio produced about the same fat loss in meta-analyses, with intervals taking about 40 % less time. Neither produced clinically large fat loss over the short term. Intensity matters for fitness and mitochondria more than for fat.',
      howModelled:
        'There is no intensity multiplier on fat loss. Fat mass follows energy balance plus the exercise-energy term. Intensity acts through the small afterburn, appetite, and fitness and mitochondrial adaptation.',
      keyNumbers: [
        {
          label: '31 studies of 4 weeks or more',
          value:
            'Within-group fat mass −1.38 kg (CI −1.99 to −0.77) with intervals against −0.91 kg (−1.45 to −0.37) with steady exercise; percent fat −1.26 versus −1.48; no difference between groups',
          note: 'Protocols with lower time or energy trended to favour steady exercise (p = 0.09). Neither produced clinically meaningful fat loss over the short term.',
          referenceIds: ['keating2017'],
        },
        {
          label: '13 trials (overweight or obese adults 18–45, about 10 weeks, 3 times a week)',
          value:
            'Equal reductions in fat mass and waist; intervals took about 40 % less time; running: fat-mass SMD −0.82 (intervals) and −0.85 (steady); cycling trials produced no fat loss',
          referenceIds: ['wewege2017'],
        },
        {
          label: 'Glucose control',
          value:
            'HOMA-IR SMD −0.49 against control and −0.35 against continuous training; HbA1c −0.19 % against control',
          referenceIds: ['jelleyman2015'],
        },
      ],
      timeCourse: 'Trials last about 4–12 weeks.',
      moderators: 'Mode of exercise (running against cycling) and time available.',
      grade: 'A',
      gradeReason: 'Multiple consistent meta-analyses.',
      status: 'established',
      caveats:
        'Trials are short, and fat-loss changes are small. Cycling trials produced no fat loss in either arm.',
      referenceIds: ['keating2017', 'wewege2017', 'jelleyman2015'],
      relatedMetricIds: [],
    },
    {
      id: '10-exercise-visceral-and-liver-fat',
      title: 'Exercise and fat around the organs and in the liver',
      category: 'body',
      summary:
        'Aerobic exercise takes a bit more visceral fat (the deep belly fat around the organs) and liver fat than its energy cost predicts, even with no weight loss. In one meta-analysis, exercise without weight loss cut visceral fat by 6 % while diet cut it by about 1 %. Some of the liver effect, in longer trials, was mostly explained by weight loss.',
      howModelled:
        'Extra visceral fat loss is 6 % over 12 weeks at 150 minutes a week or more of moderate exercise (range 0–12 %). Extra liver fat loss is 25 % in relative terms over 8–12 weeks, when baseline liver fat is at least 5 %. Resistance-only training adds nothing. When weight loss above 5 % dominates, the extra is reduced by half of the weight-loss effect.',
      equation: `extraVATloss (12 wk) = 0.06 × D_aer,     D_aer = min(1, mem7d/150)     (range 0–12 %)
extraLiverFat (8–12 wk) = −0.25 × D_aer     (relative; needs baseline liver fat ≥ 5 %)
when weight loss > 5 % dominates: extra = max(0, extra − 0.5 × weightLossEffect)
sedentary drift: +8.6 % per 6 months if mem7d < 60 and energy-balanced`,
      keyNumbers: [
        {
          label: '15 trials (852 people), no calorie restriction',
          value:
            "Visceral fat Hedges' g −0.497 (CI −0.655 to −0.340); moderate or high intensity most effective; more than 30 cm² (women) or 40 cm² (men) less on CT even at 12 weeks",
          referenceIds: ['vissers2013'],
        },
        {
          label: '117 studies (4815 people)',
          value:
            'Without weight loss, exercise reduced visceral fat by 6.1 % against 1.1 % with diet; diet caused more weight loss (p = 0.04) and exercise tended to remove more visceral fat (p = 0.08); weight–visceral fat R² was 0.74 after diet and 0.45 after exercise',
          referenceIds: ['verheggen2016'],
        },
        {
          label: '35 randomised trials',
          value:
            'Aerobic exercise against control effect size −0.33 (CI −0.52 to −0.14); resistance training against control +0.09 (not significant); aerobic against resistance directly (9 studies) 0.23 (p = 0.07, favouring aerobic)',
          referenceIds: ['ismail2012'],
        },
        {
          label: 'Randomised dose trial (6 months)',
          value:
            'Controls gained +8.6 ± 17.2 % visceral fat; 11 miles a week (walking or jogging) prevented gain; 20 miles a week of jogging reduced visceral fat by −6.9 ± 20.8 % and subcutaneous fat by −7.0 % with no change in intake',
          referenceIds: ['slentz2005'],
        },
        {
          label: '4 weeks of cycling in 19 obese adults, no weight change',
          value:
            'Visceral fat −12 % (p < 0.01); liver triglyceride −21 % (p < 0.05); fatty acids in blood −14 %',
          referenceIds: ['johnson2009'],
        },
        {
          label: 'Liver fat: meta-analyses',
          value:
            '12 trials: exercise against control effect size −0.37 (CI −0.06 to −0.69) with little or no weight loss and no effect on ALT. 19 trials (745 people): liver fat −2.85 % (intervals, CI −4.86 to −0.84) and −3.14 % (steady, CI −4.45 to −1.82) absolute against control; intervals equal to steady (−0.34 %, CI −2.20 to 1.52); total minutes or exercise kcal not related to change',
          referenceIds: ['keating2012', 'sabag2022'],
        },
        {
          label: 'Counter-evidence: 220 adults with fatty liver, 150 min/week, 12 months',
          value: 'Liver fat fell by 3.5–5.0 % absolute, but the effect was largely mediated by weight loss',
          referenceIds: ['zhang2016'],
        },
      ],
      timeCourse: 'Effects seen at 4–12 weeks; the sedentary drift in visceral fat is +8.6 % over 6 months.',
      moderators:
        'Weekly aerobic dose, baseline liver fat, and whether weight is lost (which reduces the independent effect).',
      grade: 'B',
      gradeReason: 'Several meta-analyses support visceral fat (B) and liver fat is graded B/C.',
      status: 'proposed-fit',
      caveats:
        "The liver-fat conversion (−3 percentage points from a baseline of about 12 %) is Vitals' own assumption. One long trial found the effect largely explained by weight loss.",
      referenceIds: [
        'vissers2013',
        'verheggen2016',
        'ismail2012',
        'slentz2005',
        'johnson2009',
        'keating2012',
        'sabag2022',
        'zhang2016',
      ],
      relatedMetricIds: ['visceralFat', 'liverFat'],
    },
    {
      id: '10-vo2max-baseline-and-norms',
      title: 'Estimating a starting VO2max, and what is typical for your age',
      category: 'performance',
      summary:
        'VO2max, the top rate at which the body can use oxygen, is best measured in a test. Without one, it can be estimated from age, sex, weight and a physical activity rating, with a typical error of about 5–6 ml/kg/min. It declines by roughly 10–14 % a decade, faster after 70. Reference tables show what is typical by age and sex.',
      howModelled:
        'The engine uses the Jackson equation with a 0–7 activity rating, or a user\'s test value if given. The detrained "floor" fitness is the 25th percentile for age and sex. Prediction equations are used for the baseline only, not to track change.',
      equation: `Jackson 1990: VO2max = 56.363 + 1.921·PAR − 0.381·age − 0.754·BMI + 10.987·sex        (men = 1, women = 0; R² 0.61, SEE 5.7)
Jackson 1990 (percent fat): 50.513 + 1.589·PAR − 0.289·age − 0.552·%fat + 5.863·sex      (R² 0.66, SEE 5.35)
Nes 2011 men: 100.27 − 0.296·age + 0.226·PAI − 0.369·WC − 0.155·RHR         (R² 0.61, SEE 5.70)
Nes 2011 women: 74.736 − 0.247·age + 0.198·PAI − 0.259·WC − 0.114·RHR       (R² 0.56, SEE 5.14)`,
      keyNumbers: [
        {
          label: 'Accuracy of non-exercise equations (27 equations, 987 adults)',
          value: 'SEE 4.1–6.1 ml/kg/min; they track individual changes poorly',
          note: 'Use them only for a baseline. The activity index scale in the Nes equations is unverified (not reproduced in the research summary).',
          referenceIds: ['peterman2020', 'nes2011'],
        },
        {
          label: 'Physical activity rating (PA-R, 0–7)',
          value:
            '0 avoids walking or exertion; 1 walks for pleasure or stairs; 2 modest activity 10–60 min/week; 3 more than 1 h/week; 4 runs under 1.5 km/week; 5 runs 1.5–8 km/week; 6 runs 8–16 km/week; 7 runs more than 16 km/week',
          note: 'Mapping: sedentary 0–1; light active 2; regular moderate activity 1–2 h/week 3; 30–60 vigorous min/week 4–5; 1–3 h vigorous/week 6; over 3 h 7. Check: man 30 y BMI 25 PA-R 3 gives 42.8 against a reference median of 42.4; woman 30 y BMI 23 PA-R 3 gives 33.4 against 30.2.',
          referenceIds: ['jackson1990', 'jackson1990b'],
        },
        {
          label: 'Reference VO2max in ml/kg/min, men (5th / 25th / 50th / 75th / 95th percentile)',
          value:
            '20–29: 29.0 / 40.1 / 48.0 / 55.2 / 66.3. 30–39: 27.2 / 35.9 / 42.4 / 49.2 / 59.8. 40–49: 24.2 / 31.9 / 37.8 / 45.0 / 55.6. 50–59: 20.9 / 27.1 / 32.6 / 39.7 / 50.7. 60–69: 17.4 / 23.7 / 28.2 / 34.5 / 43.0. 70–79: 16.3 / 20.4 / 24.4 / 30.4 / 39.7',
          note: 'Treadmill-measured values in apparently healthy US adults.',
          referenceIds: ['kaminsky2015'],
        },
        {
          label: 'Reference VO2max in ml/kg/min, women (5th / 25th / 50th / 75th / 95th percentile)',
          value:
            '20–29: 21.7 / 30.5 / 37.6 / 44.7 / 56.0. 30–39: 19.0 / 25.3 / 30.2 / 36.1 / 45.8. 40–49: 17.0 / 22.1 / 26.7 / 32.4 / 41.7. 50–59: 16.0 / 19.9 / 23.4 / 27.6 / 35.9. 60–69: 13.4 / 17.2 / 20.0 / 23.8 / 29.4. 70–79: 13.1 / 15.6 / 18.3 / 20.8 / 24.1',
          referenceIds: ['kaminsky2015'],
        },
        {
          label: 'Decline with age',
          value:
            'An update of 22,379 tests lowered treadmill standards by 1.5–4.6 ml/kg/min, with a mean decline of 13.5 % (4.0 ml/kg/min) a decade on the treadmill and 16.4 % (4.3) on the cycle; the earlier cohort showed about 10 % a decade with men about 27 % higher than women',
          note: 'Longitudinal decline in healthy adults accelerates from 3–6 % a decade in the 20s and 30s to over 20 % a decade in the 70s and beyond, independent of activity. Cross-sectionally the decline is about 10 % a decade regardless of activity, and high-intensity training may halve the loss in young and middle-aged men.',
          referenceIds: ['kaminsky2022', 'kaminsky2015', 'fleg2005', 'hawkins2003'],
        },
      ],
      timeCourse: 'A slow decline with age of about 10–14 % a decade.',
      moderators: 'Age, sex, BMI, activity level and body composition.',
      grade: 'B',
      gradeReason:
        'Published prediction equations and large reference datasets (B); equations track change poorly.',
      status: 'established',
      caveats:
        'Equations have errors of about 5–6 ml/kg/min. The reference values are from US treadmill tests in healthy adults.',
      referenceIds: [
        'jackson1990',
        'jackson1990b',
        'nes2011',
        'peterman2020',
        'kaminsky2015',
        'kaminsky2022',
        'fleg2005',
        'hawkins2003',
      ],
      relatedMetricIds: ['vo2max'],
    },
    {
      id: '10-vo2max-training-response',
      title: 'How much aerobic fitness training builds, and how fast',
      category: 'performance',
      summary:
        'In a large trial, 20 weeks of about three 30–50 minute sessions a week at 55–75 % of VO2max raised VO2max by 18 % on average, with a range from −5 % to +51 %. Half of the rise came within about 10 days at a fixed load. Some people responded little, but with more training nearly everyone responded. Response to training is partly inherited (about 47 %).',
      howModelled:
        'Weekly training is turned into "moderate-equivalent minutes" that weight harder minutes more. A saturating curve turns them into a target gain of up to 60 % of the detrained value. Gain moves towards the target through two pools: a fast one (time constant 15 days) and a slow one (60 days).',
      equation: `MEM = Σ minutes × w(x),  x = intensity relative to current VO2max:
  w = 0 (x < 0.40), 0.4 (0.40–0.55), 1.0 (0.55–0.70), 1.5 (0.70–0.85), 3.0 per minute of interval work at ≥ 85–90 %, 0.3 per minute of recovery inside intervals
g*(MEM) = min(0.60, gMax × z × sexF × D(MEM)),   D = MEM²/(MEM² + 130²),  gMax = 0.35
z ~ N(1, 0.5) truncated to [0.2, 2.0];   sexF = 0.95 (women; conflicting evidence)
dGf/dt = (0.55·g* − Gf)/τF,  dGs/dt = (0.45·g* − Gs)/τS,   τF = 15 d,  τS = 60 d`,
      keyNumbers: [
        {
          label:
            'HERITAGE (720 people; 481 in the 1999 analysis), 20 weeks, 3 sessions a week at 55–75 % VO2max for 30–50 min, cycling',
          value:
            '+384 ± 202 ml/min, that is +18 ± 9 % (range −5 to +51 %, −114 to +1097 ml/min); heritability of the response 47 %',
          note: 'Model at about 130 moderate-equivalent minutes: +16.8 %.',
          referenceIds: ['bouchard1999', 'ross2019'],
        },
        {
          label: 'Time course at a fixed load (9 subjects, 40 min a day, 6 days a week)',
          value:
            'VO2max rose for 3 weeks then plateaued; half-times 10.3 and 10.8 days; +23 % over 9 weeks with two load levels',
          note: 'This gives the fast pool a time constant of 15 days (half-time 10.4 days).',
          referenceIds: ['hickson1981'],
        },
        {
          label: 'Short, hard blocks',
          value:
            '14 days × 60 min at 80 % VO2peak in 8 sedentary men: +17.5 ± 3.8 % (model +14.6 %). 6 HIIT sessions in 2 weeks in 16 untrained people: +8 % (model +5.7 %)',
          referenceIds: ['egan2013', 'jacobs2013'],
        },
        {
          label: 'Meta-analyses',
          value:
            'Interval training (37 studies, 334 people, 6–13 weeks): +0.51 L/min (CI 0.43–0.60), longer intervals +0.8–0.9. 28 studies (723 adults): endurance +4.9 ± 1.4 ml/kg/min (about 12 %), HIT +5.5 ± 1.2, HIT against endurance +1.2 ± 0.9; lower baseline fitness +3.2 (HIT) or +1.4 (endurance); younger +2.4',
          note: 'Model: +11 % at 9 weeks (about +0.4 L/min); endurance at about 150 moderate-equivalent minutes 20 %, which over-predicts.',
          referenceIds: ['bacon2013', 'milanovic2015'],
        },
        {
          label: '310 postmenopausal women, 6 months, 50 % VO2max, 3–4 days a week, 4 / 8 / 12 kcal/kg/week',
          value:
            'VO2max +0.029 ± 0.144, +0.088 ± 0.129 and +0.106 ± 0.146 L/min (about 2, 5 and 6 %); non-response 44.9, 23.8 and 19.3 %',
          note: 'Model: 1.5, 5.2 and 9.4 %, which over-predicts the highest dose.',
          referenceIds: ['sisson2009'],
        },
        {
          label:
            'Amount and intensity (7–9 months, 19 km/week at 40–55 %, 19 km/week at 65–80 %, 32 km/week at 65–80 %)',
          value: 'All groups improved; high amount and high intensity beat the low-amount groups (p < 0.02)',
          note: 'The model reproduces the ordering.',
          referenceIds: ['duscha2005'],
        },
        {
          label: 'Dose and non-response (78 adults, 6 weeks, 1–5 sessions of 60 min a week)',
          value:
            'Non-response (change within ±3.96 % of maximal power) 69, 40, 29, 0 and 0 % at 60, 120, 180, 240 and 300 min a week; non-response was abolished universally by adding 120 min a week',
          note: 'The model over-predicts the mean gain at 120–300 min a week (12–22 % against a few percentage points), which is flagged.',
          referenceIds: ['montero2017'],
        },
        {
          label: 'Sex and age',
          value:
            'Meta-analysis (8 studies, 175 people): men +191 ml/min (CI 99–283) and +1.95 ml/kg/min (0.76–3.15) more than women. HERITAGE (633 people): no sex difference in ml/kg/min, women larger percent gain. HERITAGE ages 17–65: smaller absolute gain, the same percent gain in older people. Older sedentary adults (67 y): +3.78 ml/kg/min (CI 3.29–4.27)',
          note: 'The sex results conflict, giving sexF = 0.95. Haemoglobin mass is the strongest independent determinant of the training response.',
          referenceIds: ['diazcanestro2019', 'skinner2001', 'huang2016', 'montero2017'],
        },
      ],
      timeCourse:
        'Half of the gain arrives within about 10 days at a fixed load and it plateaus after about 3 weeks. With progressive loading, gains continue through 20–26 weeks.',
      moderators:
        'Weekly volume and intensity, baseline fitness, sex (conflicting), age (same percent gain) and inheritance (47 % of the response).',
      grade: 'B',
      gradeReason:
        'Mean responses are supported by meta-analyses and controlled trials (A); the fitted dose function and two-pool split are proposals (B/C).',
      status: 'proposed-fit',
      caveats:
        'The dose function over-predicts short, low-to-mid-dose gains and under-predicts very short HIIT studies. The two-pool split and the 60-day time constant are inferred. The sex effect is conflicting.',
      referenceIds: [
        'bouchard1999',
        'ross2019',
        'hickson1981',
        'egan2013',
        'jacobs2013',
        'bacon2013',
        'milanovic2015',
        'sisson2009',
        'duscha2005',
        'montero2017',
        'diazcanestro2019',
        'skinner2001',
        'huang2016',
      ],
      relatedMetricIds: ['vo2max'],
    },
    {
      id: '10-vo2max-detraining',
      title: 'How fast aerobic fitness fades',
      category: 'performance',
      summary:
        'Athletes who stopped training lost about 7 % of VO2max in 3 weeks and 16 % by 8 weeks, then levelled off, still above sedentary people. Recently gained fitness is lost completely. One high-intensity session a week for 4 weeks kept VO2max unchanged, though endurance time still fell by 21 %.',
      howModelled:
        'Fitness gain decays towards a floor that depends on years of training, with a time constant of 30 days. A weekly amount of high-intensity work of 30 minutes or more slows the decay by up to 90 %.',
      equation: `dG/dt = −(G − max(g*, ρ × G_peak)) / τDn × (1 − 0.9·m)
τDn = 30 d (range 20–40);   m = min(1, HIminPerWeek/30);   ρ = 0.45 × (1 − exp(−trainYears/2))
output cap: V ≤ 1.6 × vSed (typical); warn above 75 ml/kg/min`,
      keyNumbers: [
        {
          label: 'Endurance athletes stopping training',
          value:
            'VO2max −7 % at 21 days and −16 % at 56 days, stabilising 16 % below the trained value but above sedentary controls (50.8 versus 43.3 ml/kg/min after 84 days)',
          note: 'Stroke volume declined first and the difference in oxygen extraction by tissues later.',
          referenceIds: ['coyle1984'],
        },
        {
          label: 'Recently acquired fitness',
          value:
            'Completely lost, while the VO2max of athletes stays above controls; VO2max fell significantly within 2–4 weeks (blood volume and stroke volume first)',
          referenceIds: ['mujika2000b', 'neufer1989'],
        },
        {
          label: '4 weeks with one 35-minute high-intensity bout a week',
          value: 'VO2max unchanged (4.57 versus 4.54 L/min) while endurance capacity fell 21 %',
          note: 'Reduced-training strategies work if intensity is kept and volume can fall markedly.',
          referenceIds: ['madsen1993', 'mujika2000b'],
        },
        {
          label: 'Model checks',
          value:
            'Athlete peak 60.7 ml/kg/min: −7.0 % at 21 days, −12.6 % at 56 days, 51.9 at 84 days (observed −7, −16 and 50.8); a recent trainee retains about 1 % of the gain at 84 days; with maintenance (m = 1, 70 moderate-equivalent minutes a week) the 4-week change is −1.2 % (observed 0)',
          note: 'The model under-shoots the 56-day loss (−12.6 % against −16 %).',
        },
      ],
      timeCourse: 'Significant decline within 2–4 weeks, about 16 % by 8 weeks in athletes, then a plateau.',
      moderators: 'Years of training, and whether some high-intensity work is kept.',
      grade: 'B',
      gradeReason:
        'The direction of detraining is well supported by controlled studies and reviews (A); the fitted decay and floor are proposals (B/C).',
      status: 'proposed-fit',
      caveats:
        'The model under-predicts the 56-day loss. The retention floor is anchored on two data points.',
      referenceIds: ['coyle1984', 'mujika2000b', 'neufer1989', 'madsen1993'],
      relatedMetricIds: ['vo2max'],
    },
    {
      id: '10-vo2max-and-mortality',
      title: 'Aerobic fitness and mortality in population studies',
      category: 'cardio',
      summary:
        'People with higher aerobic fitness die less often in cohort studies: each extra MET (about 1 km/h of running speed) went with a relative risk of 0.87 for death from any cause. These are associations. Cohort data cannot show that raising a person\'s own VO2max lowers their risk. The app words this as "associated with", never as "your risk falls by".',
      howModelled:
        "The engine shows an associated relative risk of 0.87 raised to the power of the METs above the median for the person's age and sex, limited to the range 0.3–3. It is always labelled as observational.",
      equation: `assocHR = 0.87^(METs − METsMedian(age, sex)),   METs = V/3.5,   clipped to [0.3, 3]`,
      keyNumbers: [
        {
          label: '33 cohorts (102,980 participants, 6910 deaths)',
          value:
            'Each +1 MET: relative risk 0.87 (CI 0.84–0.90) for death from any cause and 0.85 (0.82–0.88) for heart and vascular disease; low (under 7.9 METs) against high (10.9 or more) fitness: 1.70 (1.51–1.92)',
          referenceIds: ['kodama2009'],
        },
        {
          label: '122,007 treadmill-tested patients (mean age 53, median follow-up 8.4 years)',
          value:
            'Elite against low fitness: adjusted HR 0.20 (0.16–0.24); elite against high 0.77 (0.63–0.95); below-average against above-average 1.41 (1.34–1.49), comparable to or greater than smoking (1.41) and diabetes (1.40); no upper limit of benefit',
          note: 'A clinical-referral population with estimated METs, and a retrospective design.',
          referenceIds: ['mandsager2018'],
        },
        {
          label: 'Scientific statement',
          value: 'The American Heart Association recommends assessing fitness as a clinical vital sign',
          referenceIds: ['ross2016'],
        },
      ],
      timeCourse: 'Follow-up in the largest treadmill cohort had a median of 8.4 years.',
      moderators: 'Age, sex and health status of the population studied.',
      grade: 'B',
      gradeReason:
        "Observational, with a dose-response pattern that is consistent across large cohorts (Vitals' evidence review gives B−).",
      status: 'established',
      caveats:
        "Association only: reverse causation and confounding remain, and these figures are not a prediction of an individual's risk.",
      referenceIds: ['kodama2009', 'mandsager2018', 'ross2016'],
      relatedMetricIds: [],
    },
    {
      id: '10-mitochondrial-adaptation',
      title: 'Building mitochondria with endurance training',
      category: 'cellular',
      summary:
        'Repeated training makes muscle cells build more mitochondria, the parts that burn fuel with oxygen. Volume of training mostly drives how many mitochondria there are, while relative intensity drives how well each one works. High-volume training raised a marker of mitochondrial content by 40–50 %, and it fell back in weeks when volume was cut. Athletes keep about 50 % more than sedentary people.',
      howModelled:
        'Two indices. A content index rises with weekly moderate-equivalent minutes up to a ceiling of 1.5, with a time constant of 21 days up and 17 days down. A respiratory-capacity index rises with weekly high-intensity minutes up to 1.3, with time constants of 14 days up and 10 days down. Their product, the oxidative capacity index, feeds fat oxidation, afterburn speed, glycogen use and endurance capacity.',
      equation: `M_c* = 1 + 0.5 × D_c(MEM_endur),   D_c = MEM²/(MEM² + 150²)     (τ_up = 21 d, τ_down = 17 d, half-time 12 d)
floor = 1 + ρ × (M_peak − 1)
M_r* = 1 + 0.30 × min(1, HIminPerWeek/30)                       (τ_up = 14 d, τ_down = 10 d)
oxidativeCapacityIndex = M_c × M_r`,
      keyNumbers: [
        {
          label: '8 sedentary men, 60 min a day at 80 % VO2peak for 14 days (VO2peak +17.5 %)',
          value:
            'Cytochrome c, COX IV and citrate synthase rose within the first week; the mitochondrial-to-nuclear DNA ratio was unchanged at 2 weeks',
          referenceIds: ['egan2013'],
        },
        {
          label: '16 untrained people, 6 HIIT sessions in 2 weeks',
          value:
            'VO2peak +8 %; COX activity +about 20 %; respiratory capacity up; haemoglobin mass and blood volume unchanged',
          referenceIds: ['jacobs2013'],
        },
        {
          label:
            '10 men: 4 weeks of HIIT three times a week, then 20 days of twice-daily HIIT, then 2 weeks of reduced volume',
          value:
            'The first phase changed nothing; then citrate synthase activity and respiration +40–50 %, electron-transport subunits +10–40 %, PGC-1α, NRF1, TFAM and p53 +65–170 %; after reduced volume (5 sessions) all markers returned to baseline except citrate synthase (+36 % above baseline)',
          referenceIds: ['granata2016b'],
        },
        {
          label: '29 men, 4 weeks (12 sessions)',
          value:
            'Sprint intervals (4–10 × 30 s all-out) raised maximal respiration +25 % and PGC-1α and p53 +60–90 %; HIIT (4–7 × 4 min at about 90 % of peak power) and steady sub-threshold exercise, matched for work, changed neither citrate synthase nor respiration',
          referenceIds: ['granata2016a'],
        },
        {
          label: 'Single-leg training matched for total work, 6 HIIT sessions in 2 weeks',
          value:
            'Higher citrate synthase (10.2 versus 8.4 mmol/kg protein/min) and respiration (complex I 23.4 versus 17.1; I+II 58.2 versus 42.2 pmol O2/s/mg) than steady exercise',
          note: 'Reviews conclude that intensity matters for mitochondrial adaptation beyond total work.',
          referenceIds: ['macinnis2017', 'macinnisgibala2017'],
        },
        {
          label: 'Consequences of more mitochondria',
          value: 'Slower glycogen and glucose use and more fat oxidation at a given load',
          note: 'In the model, glycogen use at fixed load falls to ×0.9 at an index of 1.4 (proposed). Endurance capacity can drop by 21 % after 4 weeks of detraining with VO2max unchanged, and respiratory exchange ratio rose from 0.89 to 0.91.',
          referenceIds: ['holloszy1984', 'madsen1993'],
        },
        {
          label: 'Fading after training stops',
          value:
            'Citrate synthase and succinate dehydrogenase decline with a half-time of 12 days, stabilising about 50 % above sedentary controls in long-term trained athletes; capillary density stays 50 % above sedentary',
          note: 'Volume-driven gains were reversed within 2 weeks of low volume.',
          referenceIds: ['coyle1984', 'granata2016b'],
        },
        {
          label: 'What controls the two indices',
          value:
            'Volume drives mitochondrial content; relative intensity drives respiratory function per unit of mitochondria; the two can dissociate',
          referenceIds: ['granata2018'],
        },
      ],
      timeCourse:
        'Content markers rise within a week and stabilise over weeks; they fall back with a half-time of about 12 days after training stops.',
      moderators: 'Training volume, relative intensity, sex (female data scarce) and years of training.',
      grade: 'C',
      gradeReason: 'The index is a composite of a few small biopsy studies (6–29 men).',
      status: 'proposed-fit',
      caveats:
        'The retention fraction and its link to years of training are anchored on two data points. Female data are scarce.',
      referenceIds: [
        'egan2013',
        'jacobs2013',
        'granata2016b',
        'granata2016a',
        'macinnis2017',
        'macinnisgibala2017',
        'holloszy1984',
        'madsen1993',
        'coyle1984',
        'granata2018',
      ],
      relatedMetricIds: ['enduranceCapacity'],
    },
    {
      id: '10-train-low',
      title: 'Training with low glycogen: more signals, no better performance',
      category: 'performance',
      summary:
        'Training with less carbohydrate on board, for example fasted or twice a day, boosts the cell signals and enzymes that drive adaptation. But it did not improve performance in most studies, and a meta-analysis found no benefit. Its main drawback was worse training quality. The engine adds no performance bonus.',
      howModelled:
        'No performance or VO2max bonus is applied. An optional "adaptation signal" output rises when muscle glycogen is under half of its resting level at the start of a session.',
      keyNumbers: [
        {
          label: 'Review of low-glycogen training studies',
          value:
            'Signalling was augmented in 73 % of 11 studies, gene expression in 75 % of 12 and oxidative enzyme content in 78 % of 9, but performance improved in only 37 % of 11 studies (63 % no change)',
          note: 'The effect was strongest when sessions started within a muscle-glycogen window.',
          referenceIds: ['impey2018'],
        },
        {
          label:
            'Meta-analysis of 9 studies in endurance athletes (VO2max at least 55 ml/kg/min in women and 60 in men)',
          value:
            'Periodised carbohydrate restriction at least 3 times a week: SMD 0.17 (CI −0.15 to 0.49, P = 0.29), no performance benefit',
          note: 'Compromised training quality or intensity is the main drawback.',
          referenceIds: ['gejl2021'],
        },
        {
          label: 'Elite race walkers, 3 weeks of a very-low-carbohydrate diet',
          value: 'Economy impaired and the performance gain negated, despite a rise in VO2peak',
          referenceIds: ['burke2017'],
        },
      ],
      timeCourse: 'Studies lasted weeks; signalling changes are acute.',
      moderators: 'Muscle glycogen at the start of the session, training intensity and quality.',
      grade: 'B',
      gradeReason:
        'The signalling effect is supported by a review (B) and the absence of a performance effect by a meta-analysis (A).',
      status: 'established',
      caveats: 'The signalling evidence is from small studies with mixed designs.',
      referenceIds: ['impey2018', 'gejl2021', 'burke2017'],
      relatedMetricIds: [],
    },
    {
      id: '10-exercise-insulin-sensitivity',
      title: 'Exercise and insulin sensitivity',
      category: 'cardio',
      summary:
        'A single bout of exercise improves how muscle responds to insulin for about 48 hours, and the effect is gone by 5 days. Training keeps it up. In one trial, total weekly time, not intensity or energy, was the key: about 170 minutes a week raised insulin sensitivity by about 85 %. A small bout of exercise made no difference to next-morning insulin resistance unless it burned roughly 900 kcal.',
      howModelled:
        "An acute term rises with the energy of the last bout and decays with a half-time of about 40 hours. A chronic term rises with weekly minutes at or above 40 % of VO2max, up to a ceiling of +85 %. Both raise skeletal-muscle glucose disposal only, not the liver's.",
      equation: `siAcute_peak = 0.40 × (1 − exp(−Enet/300 kcal)),  decays exp(−t/58 h)  (half-time 40 h: 44 % left at 48 h, 13 % at 120 h)
fasting HOMA multiplier = 1 − 0.32 × step(Enet − 900 kcal)   for 24 h
siChronic* = 0.85 × min(1, (minutes per week at ≥ 40 % VO2max / 170)^1.5);   τ_up = 21 d;  τ_down = 10 d (under 150 min/week) or 30 d (200 min/week or more)
insulinSensitivityMult = (1 + siChronic)(1 + siAcute)`,
      keyNumbers: [
        {
          label: 'One 60-minute bout at 150 W in 7 untrained men',
          value:
            'Apparent Km fell from 52 to 40–43 µU/mL and Vmax rose from 9.5 to 10.7–10.9 mg/min/kg; maximal glucose-to-glycogen conversion +26–40 % (5.7 → 7.2–8.0 mg/min/kg); glycogen synthase activity elevated for 48 hours; effect present at 48 hours and absent at 5 days (n = 3)',
          referenceIds: ['mikines1988'],
        },
        {
          label: '30 men, 60 % VO2peak for 30–120 min',
          value:
            'Fasting HOMA-IR −32 ± 24 % the next morning only if the bout burned more than about 3.77 MJ (about 900 kcal); no change below that (−2 ± 21 %)',
          note: 'The effect was larger at higher baseline HOMA-IR.',
          referenceIds: ['magkos2008'],
        },
        {
          label: 'Regular exercise in type 2 diabetes (meta-analysis)',
          value:
            'Effect size −0.588 (CI −0.816 to −0.359); still significant 48–72 h (−0.702) and beyond 72 h (−0.890) after the last session',
          referenceIds: ['way2016'],
        },
        {
          label: 'HIIT (meta-analysis)',
          value:
            'HOMA-IR SMD −0.49 against control and −0.35 against continuous training; fasting glucose −0.92 mmol/L in people at risk or with type 2 diabetes',
          referenceIds: ['jelleyman2015'],
        },
        {
          label: '154 overweight or obese adults, 6 months',
          value:
            'Insulin sensitivity +about 85 % with low-volume moderate exercise and with high-volume vigorous exercise (both listed at 170 min/week) against +about 40 % with low-volume vigorous exercise (115 min/week); controls declined',
          note: 'Weekly duration, not intensity or energy, was the key variable. After stopping, the gain stayed elevated at 15 days in the 200-minute-a-week programmes but fell to sedentary values in the 115-minute vigorous programme.',
          referenceIds: ['houmard2004', 'bajpeyi2009'],
        },
        {
          label: 'Training and muscle glycogen synthesis',
          value:
            '6 weeks of training doubled insulin-stimulated muscle glycogen synthesis in insulin-resistant and normal people',
          note: 'A review notes benefits from exercise can occur without a gain in VO2max and, in part, independent of weight loss.',
          referenceIds: ['perseghin1996', 'birdhawley2016'],
        },
      ],
      timeCourse:
        'Acute effect has a half-time of about 40 hours (present at 48 hours, gone at 5 days). Chronic gains build with a 21-day time constant.',
      moderators: 'Baseline insulin resistance, weekly duration, and the energy cost of the last bout.',
      grade: 'B',
      gradeReason: 'Meta-analyses and trials agree on the direction; the fitted curves are proposals.',
      status: 'proposed-fit',
      caveats:
        'The curves are proposed fits. The research summary lists both moderate and vigorous high-volume groups at 170 min/week, while a companion study refers to 200-minute programmes, so the exact volumes are unclear.',
      referenceIds: [
        'mikines1988',
        'magkos2008',
        'way2016',
        'jelleyman2015',
        'houmard2004',
        'bajpeyi2009',
        'perseghin1996',
        'birdhawley2016',
      ],
      relatedMetricIds: ['insulinSensitivity'],
    },
    {
      id: '10-post-meal-walking',
      title: 'Walking after meals and breaking up sitting',
      category: 'cardio',
      summary:
        'A short walk soon after a meal, or a few minutes of light walking every 20 minutes while seated, lowers the rise in blood glucose after eating by about a tenth to a quarter. The benefit shrinks with each extra minute of delay between meal and walk. Walking works better than standing.',
      howModelled:
        'A 10-minute walk within 30 minutes of a meal lowers the glucose response (area under the curve) by 12 %, up to 22 % after a high-carbohydrate evening meal. Two minutes of light walking every 20 minutes while seated lowers it by 24 %.',
      equation: `iAUC_glucose ×= 1 − 0.12   for a 10 min walk within 30 min of the meal (up to −0.22 after a high-carbohydrate evening meal)
iAUC_glucose ×= 1 − 0.24   for 2 min of light walking every 20 min while seated`,
      keyNumbers: [
        {
          label: 'Meta-analysis of 7 crossover trials (mostly overweight or obese)',
          value:
            'Light-walking breaks cut post-meal glucose (d = −0.72, CI −1.03 to −0.41) and insulin (d = −0.83, −1.18 to −0.48) against sitting; standing d = −0.31 (glucose only); walking better than standing (d −0.30 for glucose, −0.54 for insulin)',
          referenceIds: ['buffey2022'],
        },
        {
          label:
            '2 min of light or moderate walking every 20 min for 5 hours after a 75 g glucose and 50 g fat drink (19 overweight adults)',
          value:
            'Glucose area −24.1 % (light: 5.2 versus 6.9 mmol/L·h) and −29.6 % (moderate); insulin area −23 %',
          referenceIds: ['dunstan2012'],
        },
        {
          label: 'Type 2 diabetes (41 people): 10 min walking after each main meal against 30 min once a day',
          value: '3-hour glucose area ratio 0.88 (CI 0.78–0.99), and 0.78 (0.67–0.91) after the evening meal',
          referenceIds: ['reynolds2016'],
        },
        {
          label: 'Meta-analysis of 8 crossover trials (116 people)',
          value:
            'Post-meal exercise SMD 0.55 (CI 0.34–0.75) less glycaemic excursion than no exercise and 0.47 (0.23–0.70) less than pre-meal exercise; pre-meal exercise against control not significant (−0.13, CI −0.42 to 0.17); each extra minute of delay reduced the benefit (−0.0151 per minute, p = 0.001)',
          referenceIds: ['engeroff2023'],
        },
      ],
      timeCourse: 'The benefit is acute, over the meal and the following hours.',
      moderators: 'Delay between the meal and the walk, walking intensity, meal size and time of day.',
      grade: 'B',
      gradeReason:
        "Meta-analyses agree on the effect, but they are based on small crossover trials with a high risk of bias (Vitals' evidence review gives A/B).",
      status: 'established',
      caveats: 'Small trials with a high risk of bias; effect size shrinks with delay.',
      referenceIds: ['buffey2022', 'dunstan2012', 'reynolds2016', 'engeroff2023'],
      relatedMetricIds: ['glucose'],
    },
    {
      id: '10-concurrent-training',
      title: 'Does cardio blunt muscle and strength gains?',
      category: 'performance',
      summary:
        'Adding cardio to lifting did not reduce muscle growth or maximal strength in a pooled analysis of 43 trials. It slightly reduced explosive strength, more so when both were done in the same session, and it slightly reduced the size of slow-twitch fibres when the cardio was running. Acute studies show no interference in muscle-building signals.',
      howModelled:
        "The engine multiplies the strength topic's outputs by factors close to 1. Muscle growth is unchanged, or 0.95 with a lot of running. Maximal strength in trained lifters is 0.92 if done in the same session and 0.96 with 6 hours or more between. Explosive power is 0.90 in the same session and 0.95 with 3 hours or more apart. VO2max gain is 0.95 if done the same day as lifting.",
      keyNumbers: [
        {
          label: 'Acute molecular effects',
          value:
            'Concurrent bouts stimulated muscle-protein synthesis equally to single modes (myofibrillar 1.3-fold for resistance, 1.5 for aerobic, 1.4 for combined) with no interference in signalling or mRNA',
          note: 'The evidence for interference with hypertrophy is weaker than assumed.',
          referenceIds: ['donges2012', 'fyfe2014', 'murachbagley2016'],
        },
        {
          label: 'Meta-analysis of 43 randomised trials, concurrent against strength alone',
          value:
            'Maximal strength SMD −0.06 (CI −0.20 to 0.09); explosive strength −0.28 (−0.48 to −0.08); hypertrophy −0.01 (−0.16 to 0.18)',
          note: 'The attenuation of explosive strength was stronger in the same session (p = 0.043) than with at least 3 hours between (not significant). There was no moderation by cycling versus running, frequency, training status or age.',
          referenceIds: ['schumann2022'],
        },
        {
          label: 'Fibre-level hypertrophy (15 studies)',
          value:
            'Overall SMD −0.23 (CI −0.46 to −0.00, p = 0.050); type I −0.34 (−0.72 to 0.04); type II −0.13 (−0.39 to 0.12); type I with running −0.81 (−1.26 to −0.36) but not with cycling',
          referenceIds: ['lundberg2022'],
        },
        {
          label: 'Trained individuals',
          value:
            'Lower-body one-repetition maximum effect size −0.35 (p < 0.05) with concurrent training; unaffected in untrained and moderately trained; worse in the same session',
          referenceIds: ['petre2021'],
        },
        {
          label: 'Older meta-analysis (21 studies, 422 effects)',
          value:
            'Hypertrophy effect size 1.23 (lifting), 0.85 (concurrent), 0.27 (endurance); strength 1.76, 1.44, 0.78; power 0.91, 0.55, 0.11; running (not cycling) reduced hypertrophy and strength; correlations with endurance frequency −0.26 to −0.35 and duration −0.29 to −0.75',
          note: 'This older, more heterogeneous analysis found interference; the newer one does not for muscle size or one-repetition maximum.',
          referenceIds: ['wilson2012'],
        },
        {
          label: 'Recovery interval (58 rugby players, 7 weeks)',
          value:
            'Strength gains lower with 0 hours between sessions than with 6 hours, 24 hours or strength alone; VO2peak gain higher with 24 hours than with 0 or 6',
          referenceIds: ['robineau2016'],
        },
        {
          label: 'Model multipliers on strength-topic outputs (proposed)',
          value:
            'Whole-muscle hypertrophy 1.00 (0.95–1.05), 0.95 with more than 3 runs or 40 km a week; maximal strength untrained or moderately trained 1.00; trained lifters 0.92 same session and 0.96 if at least 6 hours apart; explosive strength 0.90 same session and 0.95 if at least 3 hours apart; VO2max gain 1.00 if at least 24 hours between, 0.95 same day',
          note: 'SMDs were converted to percentages assuming a standard deviation of relative change of about 15–20 %.',
          referenceIds: ['schumann2022', 'lundberg2022', 'petre2021', 'robineau2016'],
        },
      ],
      timeCourse:
        'Trials lasted 7 weeks to months; interference in explosive strength is greater in the same session.',
      moderators:
        'Running versus cycling, session spacing, training status and the strength quality measured.',
      grade: 'A',
      gradeReason:
        'A meta-analysis of 43 trials shows no interference for hypertrophy or maximal strength; the residual effects are graded B.',
      status: 'established',
      caveats:
        'The percentage multipliers are proposals derived from standardised effects. Findings for trained lifters and for type I fibres with running are less certain.',
      referenceIds: [
        'donges2012',
        'fyfe2014',
        'murachbagley2016',
        'schumann2022',
        'lundberg2022',
        'petre2021',
        'wilson2012',
        'robineau2016',
      ],
      relatedMetricIds: [],
    },
    {
      id: '10-exercise-and-appetite',
      title: 'Exercise, hunger and eating',
      category: 'hormones',
      summary:
        'After one bout of exercise, people do not eat more at the next meal, and hunger hormones shift in a way that favours less appetite for a while. Over weeks of training, daily intake usually does not change much, though fasting hunger rises a little. Individuals differ: some compensate fully.',
      howModelled:
        'Right after at least 30 minutes at 65 % of VO2max or more, hunger dips by 0.2 standard deviations for 0–2 hours. After very-high-intensity intervals it dips by 0.5. Over weeks, the appetite part of energy compensation raises a hunger drive. The hormones topic owns the hormone dynamics.',
      keyNumbers: [
        {
          label: 'Meta-analysis of 29 studies (51 trials)',
          value:
            'For 30–120 min at 36–81 % VO2max: absolute intake at the next meal effect size 0.14 (CI −0.005 to 0.29); relative intake (allowing for the energy spent) −1.35',
          note: 'People do not eat back the exercise energy the same day.',
          referenceIds: ['schubert2013'],
        },
        {
          label: 'Appetite hormones (20 studies, 241 people)',
          value:
            'Acyl-ghrelin effect size −0.20 (median −16.5 %); PYY +0.24 (+8.9 %); GLP-1 +0.275 (+13 %); pancreatic polypeptide +0.50 (+15 %); no moderators identified',
          referenceIds: ['schubert2014'],
        },
        {
          label: 'Very-high-intensity intermittent exercise (15 s at 170 % VO2peak), 17 overweight men',
          value: 'Lowered free intake, active ghrelin and free-living intake over 38 hours',
          referenceIds: ['sim2014'],
        },
        {
          label: 'Resistance and aerobic exercise',
          value: 'Both suppressed hunger and acyl-ghrelin during exercise; PYY rose with running',
          note: 'Land-based endurance exercise does not stimulate same-day compensation, so the daily balance is set mainly by the cost of exercise. Adiposity and sex do not modify appetite responses; higher habitual activity may improve matching.',
          referenceIds: ['broom2009', 'deighton2014', 'dorling2018'],
        },
        {
          label: '48 training studies (median 12 weeks)',
          value:
            'No significant before-and-after change in daily intake in fair and good quality studies; +102 kcal/day (CI 1–203) against control in 5 arms; a small rise in fasting hunger, less disinhibited eating, and some improved satiety and food reward',
          referenceIds: ['beaulieu2021'],
        },
        {
          label: 'Individual variability',
          value: 'Large; some people compensate fully',
          referenceIds: ['king2008', 'melanson2013'],
        },
      ],
      timeCourse: 'Acute effect over 0–2 hours; chronic effect builds over weeks.',
      moderators: 'Intensity, adiposity (little effect), habitual activity and individual disposition.',
      grade: 'B',
      gradeReason:
        'Meta-analyses agree on the acute and chronic effects, but individual differences are large.',
      status: 'proposed-fit',
      caveats: 'The hunger offsets of −0.2 and −0.5 SD are proposals from two sources.',
      referenceIds: [
        'schubert2013',
        'schubert2014',
        'sim2014',
        'broom2009',
        'deighton2014',
        'dorling2018',
        'beaulieu2021',
        'king2008',
        'melanson2013',
      ],
      relatedMetricIds: ['hunger'],
    },
    {
      id: '10-aerobic-exercise-lean-mass-in-deficit',
      title: 'Aerobic exercise and keeping lean mass while eating less',
      category: 'body',
      summary:
        'In middle-aged and older adults losing weight, adding aerobic exercise to a diet reduced how much of the weight lost was lean tissue. In one 4-month trial in adults averaging 67, fat-free mass fell 4.3 % with diet alone against 1.1 % with diet plus walking. The rule that a quarter of weight lost is lean is a heuristic that exercise and inactivity change. Lifting with protein does better, and belongs to other topics.',
      howModelled:
        'For aerobic exercise alone, the lean share of weight loss is multiplied by 1 − 0.5 × min(1, weekly moderate-equivalent minutes/150). Lifting effects belong to the resistance-training topic.',
      equation: `FFM share of weight loss ×= 1 − 0.5 × min(1, mem7d/150)      (aerobic exercise alone; older adults; proposed, grade C)`,
      keyNumbers: [
        {
          label: 'Systematic review of 52 studies in middle-aged and older adults with BMI over 25',
          value:
            '81 % of diet-only groups against 39 % of diet-plus-exercise groups (mainly aerobic) lost at least 15 % of body weight as fat-free mass',
          note: 'This follows the wording of the abstract; Vitals reads it as the share of lost weight that was fat-free mass.',
          referenceIds: ['weinheimer2010'],
        },
        {
          label:
            'Randomised trial, 29 adults aged about 67, 4 months, −9.1 to −9.2 % body weight in both arms',
          value:
            'Fat-free mass −4.3 ± 1.2 % with diet against −1.1 ± 1.0 % with diet plus walking 35–45 min, 3–5 times a week; type I fibre area −19.2 % against +3.4 %; thigh cross-sectional area −5.2 versus −3.0 % (not significant)',
          referenceIds: ['chomentowski2009'],
        },
        {
          label: 'Systematic review of 14 randomised trials',
          value:
            'Energy restriction plus exercise was better than restriction alone for fitness, and for preserving lean mass depending on the type of exercise',
          referenceIds: ['miller2013'],
        },
        {
          label: 'The "one quarter of weight loss is fat-free mass" rule',
          value: 'A critical review calls it a heuristic that exercise and inactivity modify',
          referenceIds: ['heymsfield2014'],
        },
      ],
      timeCourse: 'Trials lasted about 4 months.',
      moderators: 'Age, exercise type and weekly dose.',
      grade: 'C',
      gradeReason: 'Based on a few older-adult studies and reviews; the model factor is a proposal.',
      status: 'proposed-fit',
      caveats:
        'The trial data are mainly in older adults. Resistance training with protein is more effective and is handled elsewhere.',
      referenceIds: ['weinheimer2010', 'chomentowski2009', 'miller2013', 'heymsfield2014'],
      relatedMetricIds: ['leanTissue'],
    },
    {
      id: '10-steps-and-health',
      title: 'Daily steps and health: what cohort studies show',
      category: 'cardio',
      summary:
        'In cohort studies, people who take more steps a day die less often, with the largest gains between about 2000 and 7000 steps and a plateau at roughly 6000–8000 steps a day for people over 60 and 8000–10,000 for younger people. 7000 steps against 2000 went with a hazard ratio of 0.53 for death from any cause. These are associations, not proof of cause.',
      howModelled:
        'An associated hazard ratio relative to 2000 steps a day follows a saturating curve. It is turned into a 0–100 "activity health index" that is always labelled as an association from cohort studies.',
      equation: `assocHR(steps) = 0.40 + 0.60 · exp(−(max(steps, 2000) − 2000)/3270)          (relative to 2000 steps/day)
ActivityHealthIndex = 100 × (1 − (assocHR − 0.40)/(1.0 − 0.40))
2000 → 1.00; 3000 → 0.84; 4000 → 0.73; 5000 → 0.64; 6000 → 0.58; 7000 → 0.53; 8000 → 0.50; 10,000 → 0.45; 12,000 → 0.43; 15,000 → 0.41`,
      keyNumbers: [
        {
          label: 'Dose-response meta-analysis of 57 studies (35 cohorts), 7000 against 2000 steps a day',
          value:
            'All-cause mortality HR 0.53 (0.46–0.60); CVD incidence 0.75 (0.67–0.85); CVD mortality 0.53 (0.37–0.77); cancer incidence 0.94 (0.87–1.01, not significant); cancer mortality 0.63 (0.55–0.72); type 2 diabetes 0.86 (0.74–0.99); dementia 0.62 (0.53–0.73); depressive symptoms 0.78 (0.73–0.83); falls 0.72 (0.65–0.81)',
          note: 'The benefit is non-linear, with an inflection at about 5000–7000 steps a day for all-cause mortality, CVD incidence, dementia and falls, and linear for CVD and cancer mortality, cancer incidence, type 2 diabetes and depressive symptoms. GRADE certainty was moderate for most outcomes, low for CVD mortality, cancer incidence and function, and very low for falls.',
          referenceIds: ['ding2025'],
        },
        {
          label: '15 cohorts (47,471 people, 3013 deaths, median 7.1 years)',
          value:
            'Quartile median steps 3553 / 5801 / 7842 / 10,901 gave HR 1.0 / 0.60 (0.51–0.71) / 0.55 (0.49–0.62) / 0.47 (0.39–0.57); the benefit plateaued at 6000–8000 steps a day (age 60 and over) and 8000–10,000 (under 60)',
          note: 'After adjusting for total steps, peak 30-minute cadence was still associated (HR 0.67) but time at 100 steps a minute or more was not.',
          referenceIds: ['paluch2022'],
        },
        {
          label: '17 cohorts (226,889 people)',
          value:
            'Each +1000 steps HR 0.85 (0.81–0.91) for death from any cause; each +500 steps HR 0.93 (0.91–0.95) for cardiovascular death; benefit monotone to at least 20,000 steps a day in the spline',
          referenceIds: ['banach2023'],
        },
        {
          label: 'NHANES (4840 US adults, 10.1 years)',
          value:
            '8000 against 4000 steps a day HR 0.49 (0.44–0.55); 12,000 against 4000 HR 0.35 (0.28–0.45); step intensity was not significant after adjusting for total steps',
          referenceIds: ['saintmaurice2020'],
        },
        {
          label: 'Model against the data',
          value:
            'The curve matches 7000 against 2000 steps (0.53). Quartile ratios against the lowest quartile give 0.76 / 0.65 / 0.57 against 0.60 / 0.55 / 0.47 observed; 8000 against 4000 gives 0.68 against 0.49; the per-1000-step slope is 0.88 against 0.85',
          note: 'The model is deliberately conservative at low steps, because low-step groups include people who are ill.',
        },
      ],
      timeCourse: 'Cohort follow-up ranged from years to a decade.',
      moderators:
        'Age (the plateau is at a higher step count in younger people), and health status (reverse causation is possible).',
      grade: 'B',
      gradeReason:
        'Many consistent cohorts with GRADE certainty moderate for most outcomes, but all observational.',
      status: 'proposed-fit',
      caveats:
        "Residual confounding and reverse causation remain. The index is not a prediction of an individual's risk.",
      referenceIds: ['ding2025', 'paluch2022', 'banach2023', 'saintmaurice2020'],
      relatedMetricIds: [],
    },
    {
      id: '10-sitting-time-and-mortality',
      title: 'Sitting time, activity and mortality',
      category: 'cardio',
      summary:
        'In cohort studies, sitting a lot went with higher mortality, especially among the least active. About 60–75 minutes a day of moderate activity removed most of the excess. Light and moderate-to-vigorous activity were each associated with lower mortality. All of this is observational.',
      howModelled:
        'A sedentary-time penalty of 1.04 for each hour of sitting above 8 hours a day is offset by moderate-to-vigorous activity up to 60 minutes a day.',
      equation: `sedPenalty = 1.04^(max(0, sitH − 8))
offset = min(1, MVPAmin/60)`,
      keyNumbers: [
        {
          label: 'Accelerometer cohorts (8 cohorts, 36,383 people)',
          value:
            'HR by sedentary-time quartile 1.00 / 1.28 / 1.71 / 2.63; total activity 1.00 / 0.48 / 0.34 / 0.27; light activity 0.60 / 0.44 / 0.38; moderate-to-vigorous activity 0.64 / 0.55 / 0.52',
          referenceIds: ['ekelund2019'],
        },
        {
          label: 'Activity-adjusted meta-analysis (34 studies, 1.33 million people)',
          value:
            'Death from any cause: relative risk per extra hour a day of sitting 1.01 (up to 8 h/day) and 1.04 (over 8 h/day); the CVD threshold was 6 h/day',
          referenceIds: ['patterson2018'],
        },
        {
          label: 'Harmonised analysis of over 1 million people',
          value:
            'High sitting (over 8 h/day) with the lowest activity had an HR up to 1.59; about 60–75 min a day of moderate activity (over 35.5 MET-hours a week) removed the excess (HR 1.04, 0.99–1.10); TV of 3 hours a day or more stayed associated with higher mortality except in the most active quartile, where only 5 hours or more did (HR 1.16)',
          referenceIds: ['ekelund2016'],
        },
      ],
      timeCourse: 'Cohort follow-up spans years.',
      moderators: 'Total daily activity and type of sitting (for example TV).',
      grade: 'B',
      gradeReason: 'Large harmonised cohort analyses are consistent, but all are observational.',
      status: 'proposed-fit',
      caveats:
        "Cohort hazard ratios are confounded and are not a prediction of an individual's risk. Sitting effects beyond steps are modelled only through acute glucose effects.",
      referenceIds: ['ekelund2019', 'patterson2018', 'ekelund2016'],
      relatedMetricIds: [],
    },
    {
      id: '10-activity-baselines-and-pal',
      title: 'Everyday activity levels and physical activity level (PAL)',
      category: 'energy',
      summary:
        'The app maps a lifestyle choice to typical steps a day and to a physical activity level (PAL), total daily energy divided by resting energy. In studies, typical adults range from 4000 to 18,000 steps a day. PAL averages about 1.74, and 2.4 is hard to sustain. Steps explain only part of PAL.',
      howModelled:
        'Five lifestyle selectors carry default steps, PAL and activity ratings. Steps above the lifestyle baseline add energy at 0.44 kcal per kg per 1000 steps on top of the energy expenditure baseline, so nothing is counted twice.',
      equation: `dE = 0.44 kcal/kg/1000 steps × (steps − baselineSteps(selector))
selector (steps/day default, range; PAL default, range; PA-R):
1 sedentary 4000 (2500–5500); 1.45 (1.40–1.55); 0–1
2 lightly active 6500 (5000–7500); 1.60 (1.55–1.70); 2
3 moderately active 8500 (7500–10,000); 1.75 (1.70–1.85); 3–4
4 active 11,000 (10,000–12,500); 1.90 (1.85–2.00); 5
5 very active 15,000 (12,500–20,000); 2.20 (2.00–2.40); 6–7`,
      keyNumbers: [
        {
          label: 'Pedometer studies of adults',
          value:
            '42 studies (6199 people): mean 9448 steps/day (CI 8899–9996) excluding the Amish; under 65 years 9797; 65 and over 6565. US sample (1136 adults): 5117 steps/day',
          referenceIds: ['bohannon2007', 'bassett2010'],
        },
        {
          label: 'Old Order Amish (98 people)',
          value: 'Men 18,425 and women 14,196 steps a day',
          referenceIds: ['bassett2004'],
        },
        {
          label: 'How many steps are enough',
          value:
            'Healthy adults typically 4000–18,000 steps/day; 100 steps a minute is moderate; 7000–11,000 steps a day correspond to guidelines; 7000–8000 is a direct estimate of the minimum moderate-to-vigorous activity',
          referenceIds: ['tudorlocke2011'],
        },
        {
          label: 'Step zones',
          value:
            'Under 5000 sedentary; 5000–7499 low active; 7500–9999 somewhat active; 10,000–12,499 active; 12,500 or more highly active',
          note: 'The zone hierarchy is from a 2008 paper; only the 10,000–12,499 and 12,500-plus zones were visible in the abstract text retrieved, so the lower cut-offs are as Vitals recalled them (not confirmed against the paper).',
          referenceIds: ['tudorlocke2008'],
        },
        {
          label: 'Occupation',
          value:
            'Walking postal delivery workers 16,035 ± 4264 steps per 24 h on a workday against office postal workers 6709 ± 2808 (112 people, activPAL); the active group did not compensate with inactivity off work; in the same industry 53 % reached 10,000 steps a day',
          referenceIds: ['tigbe2011', 'chastin2009'],
        },
        {
          label: 'Physical activity level',
          value:
            'FAO/WHO/UNU: sedentary or light 1.40–1.69 (worked example 1.53); active or moderately active 1.70–1.99 (1.76); vigorous 2.00–2.40 (2.25); above 2.40 is hard to sustain. Doubly labelled water database (1754 people): mean 1.74 ± 0.27, with 90 % between 1.35 and 2.18',
          note: 'Sustainable range about 1.1–1.2 to 2.0–2.5; mean 1.7–1.8 at reproductive age; endurance professionals about 4.0.',
          referenceIds: ['fao2004', 'careau2021', 'westerterp2013'],
        },
        {
          label: 'Steps against energy',
          value:
            '10,000 steps a day is about +0.11–0.19 PAL for a 70–75 kg adult against a 4000-step baseline',
          note: "Vitals' arithmetic. Steps alone should not set PAL, since standing, load carrying, non-step movement and exercise add more.",
        },
      ],
      timeCourse: 'Not a time-dependent process; baselines are habitual levels.',
      moderators: 'Occupation, age and lifestyle.',
      grade: 'B',
      gradeReason:
        'Step distributions and PAL categories are well documented (B); occupation-specific defaults come from single samples (C).',
      status: 'established',
      caveats:
        'The lifestyle selector defaults are recommended numbers assembled from several sources. The lower step-zone cut-offs were recalled, not verified.',
      referenceIds: [
        'bohannon2007',
        'bassett2010',
        'bassett2004',
        'tudorlocke2011',
        'tudorlocke2008',
        'tigbe2011',
        'chastin2009',
        'fao2004',
        'careau2021',
        'westerterp2013',
      ],
      relatedMetricIds: ['neat', 'tdee', 'maintenance'],
    },
    {
      id: '10-exercise-timing',
      title: 'Morning or evening exercise',
      category: 'performance',
      summary:
        'Whether morning or evening exercise is better is unresolved. One trial found early exercisers lost more weight, but people had chosen their own times. In people with type 2 diabetes, a small trial found afternoon exercise better for glucose while another found the same for insulin sensitivity. Activity timing in a large cohort also showed some differences. The evidence is contradictory, so the engine has no time-of-day term.',
      howModelled:
        'Timing enters only through the meal-related state (fasted or fed, muscle glycogen at the start), the post-meal walk effect, the spacing of strength and cardio, and the sleep interaction. There is no clock-time term.',
      keyNumbers: [
        {
          label: 'Exercisers grouped by clock time after the fact (a randomised trial, 10 months)',
          value:
            'Early (07:00–11:59, 21 people) −7.2 ± 1.2 % body weight; late (15:00–19:00, 25 people) −2.1 ± 1.0 %; sporadic (24 people) −5.5 ± 1.2 %; control +0.5 %',
          note: 'No difference in TDEE, intake or non-exercise activity. Self-selection is likely and the mechanism is unknown.',
          referenceIds: ['willis2020'],
        },
        {
          label: 'Type 2 diabetes, small crossover (11 men, 2 weeks of HIIT)',
          value:
            'Afternoon HIIT lowered continuous-monitor glucose (6.2 versus 6.4 mmol/L before) while morning HIIT raised it (6.9)',
          referenceIds: ['savikj2019'],
        },
        {
          label: 'Metabolically compromised men (32 men, 12 weeks, retrospective, unequal groups)',
          value:
            'Afternoon training gave better peripheral insulin sensitivity (+5.2 versus −0.5 µmol/min/kg FFM), fasting glucose (−0.3 versus +0.5 mmol/L) and fat mass (−1.2 versus −0.2 kg) than morning training',
          note: 'This opposes the direction of the trial above.',
          referenceIds: ['mancilla2021'],
        },
        {
          label: 'UK Biobank activity clusters',
          value:
            'Late-morning activity against midday: coronary artery disease HR 0.84 (0.77–0.92) and stroke 0.83 (0.70–0.98); larger in women',
          referenceIds: ['albalak2023'],
        },
        {
          label: 'Fat oxidation and the body clock',
          value: 'Higher evening resting and maximal fat oxidation are reported in some studies, not all',
          note: '24-hour fat oxidation depends on fasted-versus-fed timing more than on clock time.',
          referenceIds: ['rubiovalles2025'],
        },
      ],
      timeCourse: 'Trials span 2 weeks to 10 months.',
      moderators: 'Fed or fasted state, sex and diabetes status.',
      grade: 'C',
      gradeReason: "Conflicting, small and mostly observational studies (Vitals' evidence review gives C–D).",
      status: 'contested',
      caveats: 'The trials pull in opposite directions and use different designs.',
      referenceIds: ['willis2020', 'savikj2019', 'mancilla2021', 'albalak2023', 'rubiovalles2025'],
      relatedMetricIds: [],
    },
    {
      id: '10-low-energy-availability',
      title: 'Low energy availability',
      category: 'recovery',
      summary:
        "Energy availability is what is left of intake for the body's own functions after exercise energy is taken out, per kg of fat-free mass. In sedentary young women, the pulse pattern of luteinising hormone was disturbed below about 30 kcal per kg of fat-free mass a day. In another study of women, menstrual problems became less likely with each extra unit, with no clear threshold. The engine warns below defined levels.",
      howModelled:
        'The engine tracks a 7-day energy availability. It calls values below 45 "reduced", below 30 a low-energy-availability warning (emphasis on women), and below 20 a strong warning. If it stays below 30 for more than 14 days with heavy training, the fitness gain is scaled by 0.8 and a fatigue flag is raised. The multiplier is proposed.',
      equation: `EA = (EI − EEE) / FFM      (kcal per kg FFM per day; EEE = exercise energy expenditure, net of resting)
EA7d < 45 "reduced";  < 30 low-energy-availability warning;  < 20 strong warning
if EA7d < 30 for more than 14 days and mem7d > 300: fitness and mitochondrial gain × 0.8, fatigue flag (proposed)`,
      keyNumbers: [
        {
          label:
            '29 sedentary young women, 5 days: exercise 15 kcal/kg lean mass/day at 70 % of aerobic capacity, energy availability 45 against 10, 20 and 30',
          value:
            'LH pulsatility unaffected at 30 kcal/kg lean mass/day; LH pulse frequency fell (amplitude rose) below 30',
          note: 'More extreme with short luteal phases. The effects paralleled glucose, β-hydroxybutyrate, growth hormone and cortisol.',
          referenceIds: ['loucks2003'],
        },
        {
          label: 'Earlier 4-day study (energy availability 10 against 45)',
          value: 'LH pulse frequency −10 %; carbohydrate share of exercise energy 73 % → 49 %',
          referenceIds: ['loucks1998'],
        },
        {
          label: '35 sedentary women, 3 menstrual cycles',
          value:
            'No energy-availability threshold for menstrual disturbance; the odds fell 9 % per +1 kcal/kg FFM/day (odds ratio 0.91, CI 0.84–0.98); tertiles 23.4–34.1, 34.9–40.7 and 41.2–50.1',
          referenceIds: ['lieberman2018'],
        },
        {
          label: 'Consensus statements',
          value:
            'The 2023 Olympic committee statement on relative energy deficiency in sport emphasises severity and risk stratification, low carbohydrate availability and males, not a single number; a concept review of energy availability also exists',
          referenceIds: ['mountjoy2023', 'loucks2011'],
        },
      ],
      timeCourse:
        'Hormone effects emerged within 4–5 days in the controlled studies; the model uses a 7-day window and a 14-day trigger.',
      moderators:
        'Sex (female emphasis; males less well defined), training load and how energy availability is calculated.',
      grade: 'B',
      gradeReason:
        'The 30 kcal/kg FFM anchor in young women is from controlled studies (B); the effects in men and the model multipliers are graded C.',
      status: 'contested',
      caveats:
        'Risk rises linearly and no hard threshold exists. The convention (net or gross exercise energy) should be fixed jointly with the safety topic; the choice of net of resting is unverified against the source papers.',
      referenceIds: ['loucks2003', 'loucks1998', 'lieberman2018', 'mountjoy2023', 'loucks2011'],
      relatedMetricIds: ['energyAvailability'],
    },
    {
      id: '10-overreaching-and-recovery',
      title: 'Overreaching and recovery cost',
      category: 'recovery',
      summary:
        'Overreaching is a short-term dip in performance after a hard training period, and overtraining syndrome is a longer-lasting one. No single marker meets all the criteria for diagnosing it, and low energy, carbohydrate or protein intake can contribute. Hard lifting did not measurably raise resting energy use afterwards.',
      howModelled:
        'Recovery cost of hard lifting or eccentric work is taken as zero, apart from the small afterburn. An overreaching flag is raised if weekly training load rises more than 50 % week on week while energy availability is under 45 or sleep debt is present, and fitness gains are capped at 0.8. Those numbers are proposals, since the consensus gives none.',
      keyNumbers: [
        {
          label: 'European and American sports medicine consensus',
          value:
            'Overreaching (functional or non-functional) is distinguished from overtraining syndrome ("prolonged maladaptation"); no marker meets all criteria; contributors include dietary energy restriction and insufficient carbohydrate or protein',
          referenceIds: ['meeusen2013'],
        },
        {
          label: 'Recovery cost of hard lifting',
          value: 'No measurable RMR elevation after hard sessions (10,000 and 20,000 kg volume)',
          referenceIds: ['abboud2013'],
        },
      ],
      timeCourse: 'Overreaching develops over days to weeks of high load.',
      moderators: 'Training load, energy availability, sleep and nutrition.',
      grade: 'C',
      gradeReason: 'A consensus statement without numbers, and a single small study of recovery cost.',
      status: 'proposed-fit',
      caveats:
        'The 50 % weekly load rise and the 0.8 cap are proposals; the consensus statement gives no numbers.',
      referenceIds: ['meeusen2013', 'abboud2013'],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '10-myth-fat-burning-zone',
      claim: 'There is a "fat-burning zone" of intensity that gives the most fat loss.',
      verdict: 'oversimplified',
      explanation:
        'Fat burned per minute does peak at about 48–70 % of VO2max depending on training and diet. But fat mass follows energy balance. Interval training and steady exercise gave equal fat-mass loss per week, and intervals only saved time.',
      referenceIds: ['keating2017', 'wewege2017', 'achten2002'],
    },
    {
      id: '10-myth-afterburn-hundreds-of-calories',
      claim: 'Hard workouts keep burning hundreds of extra calories for hours afterwards.',
      verdict: 'not-supported',
      explanation:
        "Afterburn is about 6–15 % of a session's net cost, and only after long or hard sessions. A typical HIIT session gives about 20–60 kcal. The largest figure, +190 kcal, came after 45 minutes at about 73 % of VO2max.",
      referenceIds: ['laforgia2006', 'panissa2021', 'knab2011'],
    },
    {
      id: '10-myth-fasted-cardio-burns-more-fat',
      claim: 'Fasted cardio burns more body fat.',
      verdict: 'oversimplified',
      explanation:
        'It burns about 3 g more fat during the session and shifts the 24-hour fuel mix at matched intake. Body-composition trials show no difference in fat lost, and fasted exercise may raise hunger.',
      referenceIds: ['vieira2016', 'schoenfeld2014', 'hackett2017', 'iwayama2015b', 'frampton2022'],
    },
    {
      id: '10-myth-exercise-calories-add-linearly',
      claim: 'Every calorie burned in exercise adds one calorie to your daily energy use.',
      verdict: 'oversimplified',
      explanation:
        'This is contested. Doubly labelled water data show about 28 % compensation, more with higher body fat, and a plateau above about 230 counts a minute. Trials show total compensation of 30–65 %, mostly through eating more. But supervised trials with monitored intake reach full expression.',
      referenceIds: ['careau2021', 'pontzer2016', 'martin2019', 'flack2018', 'ross2000', 'westerterp2013'],
    },
    {
      id: '10-myth-you-always-compensate-fully',
      claim: 'You always eat back everything you burn.',
      verdict: 'not-supported',
      explanation:
        'Same-day intake does not rise after a bout of exercise. Weight loss of 4–5 kg over 10 months with 2000–3000 kcal a week of exercise is achievable without dieting.',
      referenceIds: ['schubert2013', 'donnelly2013'],
    },
    {
      id: '10-myth-10000-steps',
      claim: '10,000 steps a day is a magic number.',
      verdict: 'oversimplified',
      explanation:
        'The mortality benefit plateaued at about 6000–8000 steps a day in people 60 and older and 8000–10,000 in younger people. 7000 against 2000 steps gave a hazard ratio of 0.53. All of this is observational.',
      referenceIds: ['paluch2022', 'ding2025'],
    },
    {
      id: '10-myth-cardio-kills-muscle-gains',
      claim: 'Cardio kills muscle gains.',
      verdict: 'oversimplified',
      explanation:
        'There was no interference for whole-muscle growth or maximal strength in a pooled analysis of 43 trials. Small effects remain for explosive strength and for slow-twitch fibre size with running. An older meta-analysis suggested more interference, and acute molecular studies show none.',
      referenceIds: ['schumann2022', 'lundberg2022', 'wilson2012', 'donges2012'],
    },
    {
      id: '10-myth-low-carb-adaptation-spares-glycogen',
      claim: 'Adapting to low carbohydrate spares glycogen and makes athletes faster.',
      verdict: 'not-supported',
      explanation:
        'Muscle glycogen depletion was identical in elite runners at 64 % of VO2max. Very-low-carbohydrate eating impaired economy and performance in elite walkers, and periodised carbohydrate restriction showed no performance benefit (SMD 0.17, CI −0.15 to 0.49).',
      referenceIds: ['volek2016', 'burke2017', 'gejl2021'],
    },
    {
      id: '10-myth-devices-measure-calories',
      claim: 'Cardio machines and wearables measure calories burned accurately.',
      verdict: 'not-supported',
      explanation:
        'No consumer device had less than 20 % median error. Standard MET values also bias individuals: they under-estimated the individually referenced value 89 % of the time.',
      referenceIds: ['shcherbina2017', 'compendium2024b'],
    },
    {
      id: '10-myth-non-responders-are-fixed',
      claim: 'Some people are fixed "non-responders" to aerobic training.',
      verdict: 'not-supported',
      explanation:
        'Non-response depends on dose: it could be abolished with more training. Heritability of the response is 47 %, so part of the difference is inherited.',
      referenceIds: ['montero2017', 'bouchard1999'],
    },
    {
      id: '10-myth-lifting-burns-fat-for-48-hours',
      claim: 'Lifting weights keeps burning fat for 48 hours.',
      verdict: 'not-supported',
      explanation:
        'Hard sessions did not raise resting metabolic rate at 12–48 hours. A review notes more prolonged afterburn after hard than moderate lifting, but no dose-response.',
      referenceIds: ['abboud2013', 'borsheim2003'],
    },
    {
      id: '10-myth-best-time-of-day',
      claim: 'Morning (or evening) exercise is best.',
      verdict: 'unproven',
      explanation:
        'Evidence conflicts across small, mostly observational studies, and the studies pull in different directions.',
      referenceIds: ['willis2020', 'savikj2019', 'mancilla2021', 'albalak2023'],
    },
  ],
  openQuestions: [
    'The split between metabolic and appetite compensation cannot be identified from weight-based totals. A cross-sectional study suggests 28 % compensation of total energy use, while the strongest trial shows none in resting metabolism or non-exercise activity but higher intake (+90–124 kcal/day). The default metabolic share of 0.15 is a compromise (grade C), and the lags of 14 and 28 days are guesses (grade D).',
    'The BMI values at the 10th and 90th percentiles in the compensation data are not stated in the paper text (assumed about 20 and 33; unverified). The direction, more compensation with more fat, is cross-sectional and may be an individual trait rather than a within-person effect.',
    'The long-term drift towards about 84 % compensation at about 80 weeks is a regression-based extrapolation and is off by default.',
    'The Minetti hill-cost coefficients were recalled from memory and only checked at their end-points. They should be verified against the paper before shipping; the ACSM alternative is retained.',
    'The step-length rule (0.415 × height) is a heuristic. Per-step cost is mildly sensitive to cadence and step length and needs checking against a gait dataset. Cost per 1000 steps is about ±20 % for an individual.',
    'The fat-oxidation presets are non-unique fits to group means, and individual variation is large (a spread of 0.18 g/min in athletes, with more than half the variance unexplained).',
    'The VO2max dose function over-predicts short, low-to-mid-dose gains and under-predicts very short HIIT studies. The two-pool split and the 60-day time constant are inferred. The sex effect conflicts between a meta-analysis and HERITAGE.',
    'The mitochondrial index is a composite from a few small biopsy studies (6–29 men). Female data are scarce, and the retained fraction and its link to years of training are anchored on two points (grade C).',
    'Whole-body glycogen use in HIIT and lifting is model-based and needs fibre-type-level data.',
    'The evidence on clock time of exercise is contradictory and is not modelled.',
    'Whether total energy expenditure really plateaus with activity (the constrained model) is still debated. A sensitivity run must show both views.',
    'Effects of sedentary time beyond steps (breaks, posture) enter only through acute glucose effects, and the cohort hazard ratios are confounded.',
    'Individual differences in response to bouts are expressed as random effects, not tied to genotype, and are offered as a Monte-Carlo option only.',
    'Lifting session energy is uncertain by ±30 %, because the anaerobic cost is not captured by indirect calorimetry.',
    "The energy availability convention, net or gross exercise energy, should be fixed jointly with the safety topic. The choice of net of resting is unverified against the source papers' convention.",
  ],
  references: [
    {
      id: 'abboud2013',
      authors: 'Abboud GJ, Greer BK, Campbell SC et al.',
      year: 2013,
      title:
        'Effects of load-volume on EPOC after acute bouts of resistance training in resistance-trained men',
      journal: 'Journal of strength and conditioning research',
      pmid: '23085971',
      doi: '10.1519/jsc.0b013e3182772eed',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23085971/',
    },
    {
      id: 'achten2002',
      authors: 'Achten J, Gleeson M, Jeukendrup AE',
      year: 2002,
      title: 'Determination of the exercise intensity that elicits maximal fat oxidation',
      journal: 'Medicine and science in sports and exercise',
      pmid: '11782653',
      doi: '10.1097/00005768-200201000-00015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11782653/',
    },
    {
      id: 'ahn2022',
      authors: 'Ahn HN, Lee MG, Jung WS',
      year: 2022,
      title:
        'Effects of gradient and age on energy expenditure and fat metabolism during aerobic exercise at equal intensity in women',
      journal: 'Physical activity and nutrition',
      pmid: '35510442',
      doi: '10.20463/pan.2022.0004',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35510442/',
    },
    {
      id: 'albalak2023',
      authors: 'Albalak G, Stijntjes M, van Bodegom D et al.',
      year: 2023,
      title:
        'Setting your clock: associations between timing of objective physical activity and cardiovascular disease risk in the general population',
      journal: 'European journal of preventive cardiology',
      pmid: '36372091',
      doi: '10.1093/eurjpc/zwac239',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36372091/',
    },
    {
      id: 'areta2018',
      authors: 'Areta JL, Hopkins WG',
      year: 2018,
      title:
        'Skeletal Muscle Glycogen Content at Rest and During Endurance Exercise in Humans: A Meta-Analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '29923148',
      doi: '10.1007/s40279-018-0941-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29923148/',
    },
    {
      id: 'bachman2016',
      authors: 'Bachman JL, Deitrick RW, Hillman AR',
      year: 2016,
      title: 'Exercising in the Fasted State Reduced 24-Hour Energy Intake in Active Male Adults',
      journal: 'Journal of nutrition and metabolism',
      pmid: '27738523',
      doi: '10.1155/2016/1984198',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27738523/',
    },
    {
      id: 'bacon2013',
      authors: 'Bacon AP, Carter RE, Ogle EA et al.',
      year: 2013,
      title: 'VO2max trainability and high intensity interval training in humans: a meta-analysis',
      journal: 'PloS one',
      pmid: '24066036',
      doi: '10.1371/journal.pone.0073182',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24066036/',
    },
    {
      id: 'bajpeyi2009',
      authors: 'Bajpeyi S, Tanner CJ, Slentz CA et al.',
      year: 2009,
      title:
        'Effect of exercise intensity and volume on persistence of insulin sensitivity during training cessation',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '19196913',
      doi: '10.1152/japplphysiol.91262.2008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19196913/',
    },
    {
      id: 'banach2023',
      authors: 'Banach M, Lewek J, Surma S et al.',
      year: 2023,
      title:
        'The association between daily step count and all-cause and cardiovascular mortality: a meta-analysis',
      journal: 'European journal of preventive cardiology',
      pmid: '37555441',
      doi: '10.1093/eurjpc/zwad229',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37555441/',
    },
    {
      id: 'bassett2004',
      authors: 'Bassett DR, Schneider PL, Huntington GE',
      year: 2004,
      title: 'Physical activity in an Old Order Amish community',
      journal: 'Medicine and science in sports and exercise',
      pmid: '14707772',
      doi: '10.1249/01.mss.0000106184.71258.32',
      url: 'https://pubmed.ncbi.nlm.nih.gov/14707772/',
    },
    {
      id: 'bassett2010',
      authors: 'Bassett DR, Wyatt HR, Thompson H et al.',
      year: 2010,
      title: 'Pedometer-measured physical activity and health behaviors in U.S. adults',
      journal: 'Medicine and science in sports and exercise',
      pmid: '20305579',
      doi: '10.1249/mss.0b013e3181dc2e54',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20305579/',
    },
    {
      id: 'batliner2018',
      authors: 'Batliner ME, Kipp S, Grabowski AM et al.',
      year: 2018,
      title: 'Does Metabolic Rate Increase Linearly with Running Speed in all Distance Runners?',
      journal: 'Sports medicine international open',
      pmid: '30539111',
      doi: '10.1055/s-0043-122068',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30539111/',
    },
    {
      id: 'beaulieu2021',
      authors: 'Beaulieu K, Blundell JE, van Baak MA et al.',
      year: 2021,
      title:
        'Effect of exercise training interventions on energy intake and appetite control in adults with overweight or obesity: A systematic review and meta-analysis',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '33949089',
      doi: '10.1111/obr.13251',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33949089/',
    },
    {
      id: 'birdhawley2016',
      authors: 'Bird SR, Hawley JA',
      year: 2016,
      title: 'Update on the effects of physical activity on insulin sensitivity in humans',
      journal: 'BMJ open sport & exercise medicine',
      pmid: '28879026',
      doi: '10.1136/bmjsem-2016-000143',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28879026/',
    },
    {
      id: 'bohannon2007',
      authors: 'Bohannon RW',
      year: 2007,
      title: 'Number of pedometer-assessed steps taken per day by adults: a descriptive meta-analysis',
      journal: 'Physical therapy',
      pmid: '17911274',
      doi: '10.2522/ptj.20060037',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17911274/',
    },
    {
      id: 'borsheim2003',
      authors: 'Børsheim E, Bahr R',
      year: 2003,
      title: 'Effect of exercise intensity, duration and mode on post-exercise oxygen consumption',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '14599232',
      doi: '10.2165/00007256-200333140-00002',
      url: 'https://pubmed.ncbi.nlm.nih.gov/14599232/',
    },
    {
      id: 'bouchard1999',
      authors: 'Bouchard C, An P, Rice T et al.',
      year: 1999,
      title:
        'Familial aggregation of VO(2max) response to exercise training: results from the HERITAGE Family Study',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '10484570',
      doi: '10.1152/jappl.1999.87.3.1003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10484570/',
    },
    {
      id: 'broom2009',
      authors: 'Broom DR, Batterham RL, King JA et al.',
      year: 2009,
      title:
        'Influence of resistance and aerobic exercise on hunger, circulating levels of acylated ghrelin, and peptide YY in healthy males',
      journal: 'American journal of physiology. Regulatory, integrative and comparative physiology',
      pmid: '18987287',
      doi: '10.1152/ajpregu.90706.2008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18987287/',
    },
    {
      id: 'broskey2021',
      authors: 'Broskey NT, Martin CK, Burton JH et al.',
      year: 2021,
      title: 'Effect of Aerobic Exercise-induced Weight Loss on the Components of Daily Energy Expenditure',
      journal: 'Medicine and science in sports and exercise',
      pmid: '34519717',
      doi: '10.1249/mss.0000000000002689',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34519717/',
    },
    {
      id: 'browning2006',
      authors: 'Browning RC, Baker EA, Herron JA et al.',
      year: 2006,
      title: 'Effects of obesity and sex on the energetic cost and preferred speed of walking',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '16210434',
      doi: '10.1152/japplphysiol.00767.2005',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16210434/',
    },
    {
      id: 'buffey2022',
      authors: 'Buffey AJ, Herring MP, Langley CK et al.',
      year: 2022,
      title:
        'The Acute Effects of Interrupting Prolonged Sitting Time in Adults with Standing and Light-Intensity Walking on Biomarkers of Cardiometabolic Health in Adults: A Systematic Review and Meta-analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '35147898',
      doi: '10.1007/s40279-022-01649-4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35147898/',
    },
    {
      id: 'burke2017',
      authors: 'Burke LM, Ross ML, Garvican-Lewis LA et al.',
      year: 2017,
      title:
        'Low carbohydrate, high fat diet impairs exercise economy and negates the performance benefit from intensified training in elite race walkers',
      journal: 'The Journal of physiology',
      pmid: '28012184',
      doi: '10.1113/jp273230',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28012184/',
    },
    {
      id: 'byrne2005',
      authors: 'Byrne NM, Hills AP, Hunter GR et al.',
      year: 2005,
      title: 'Metabolic equivalent: one size does not fit all',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '15831804',
      doi: '10.1152/japplphysiol.00023.2004',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15831804/',
    },
    {
      id: 'careau2021',
      authors: 'Careau V, Halsey LG, Pontzer H et al.',
      year: 2021,
      title: 'Energy compensation and adiposity in humans',
      journal: 'Current biology : CB',
      pmid: '34453886',
      doi: '10.1016/j.cub.2021.08.016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34453886/',
    },
    {
      id: 'chastin2009',
      authors: 'Chastin SF, Dall PM, Tigbe WW et al.',
      year: 2009,
      title:
        'Compliance with physical activity guidelines in a group of UK-based postal workers using an objective monitoring technique',
      journal: 'European journal of applied physiology',
      pmid: '19488779',
      doi: '10.1007/s00421-009-1090-x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19488779/',
    },
    {
      id: 'chavez2023',
      authors: 'Chávez-Guevara IA, Amaro-Gahete FJ, Ramos-Jiménez A et al.',
      year: 2023,
      title:
        'Toward Exercise Guidelines for Optimizing Fat Oxidation During Exercise in Obesity: A Systematic Review and Meta-Regression',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '37584843',
      doi: '10.1007/s40279-023-01897-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37584843/',
    },
    {
      id: 'chomentowski2009',
      authors: 'Chomentowski P, Dubé JJ, Amati F et al.',
      year: 2009,
      title:
        'Moderate exercise attenuates the loss of skeletal muscle mass that occurs with intentional caloric restriction-induced weight loss in older, overweight to obese adults',
      journal: 'The journals of gerontology. Series A, Biological sciences and medical sciences',
      pmid: '19276190',
      doi: '10.1093/gerona/glp007',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19276190/',
    },
    {
      id: 'compendium2024a',
      authors: 'Compendium of Physical Activities',
      year: 2024,
      title: 'Unit conversions (1 MET = 3.5 ml/kg/min; kcal/min = METs x 3.5 x kg / 200)',
      journal: 'Compendium of Physical Activities (website)',
      url: 'https://pacompendium.com/unite-conversions/',
    },
    {
      id: 'compendium2024b',
      authors: 'Compendium of Physical Activities',
      year: 2024,
      title:
        'Corrected METs - Adults (Harris-Benedict-based correction; cites Byrne 2005, Kozey 2010, Howley 2011)',
      journal: 'Compendium of Physical Activities (website)',
      url: 'https://pacompendium.com/corrected-mets/',
    },
    {
      id: 'coyle1984',
      authors: 'Coyle EF, Martin WH, Sinacore DR et al.',
      year: 1984,
      title: 'Time course of loss of adaptations after stopping prolonged intense endurance training',
      journal: 'Journal of applied physiology: respiratory, environmental and exercise physiology',
      pmid: '6511559',
      doi: '10.1152/jappl.1984.57.6.1857',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6511559/',
    },
    {
      id: 'coyle1986',
      authors: 'Coyle EF, Coggan AR, Hemmert MK et al.',
      year: 1986,
      title: 'Muscle glycogen utilization during prolonged strenuous exercise when fed carbohydrate',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '3525502',
      doi: '10.1152/jappl.1986.61.1.165',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3525502/',
    },
    {
      id: 'deighton2014',
      authors: 'Deighton K, Stensel DJ',
      year: 2014,
      title:
        'Creating an acute energy deficit without stimulating compensatory increases in appetite: is there an optimal exercise protocol?',
      journal: 'The Proceedings of the Nutrition Society',
      pmid: '24717417',
      doi: '10.1017/s002966511400007x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24717417/',
    },
    {
      id: 'diazcanestro2019',
      authors: 'Diaz-Canestro C, Montero D',
      year: 2019,
      title: 'Sex Dimorphism of VO2max Trainability: A Systematic Review and Meta-analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '31494865',
      doi: '10.1007/s40279-019-01180-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31494865/',
    },
    {
      id: 'ding2025',
      authors: 'Ding D, Nguyen B, Nau T et al.',
      year: 2025,
      title: 'Daily steps and health outcomes in adults: a systematic review and dose-response meta-analysis',
      journal: 'The Lancet. Public health',
      pmid: '40713949',
      doi: '10.1016/s2468-2667(25)00164-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40713949/',
    },
    {
      id: 'donges2012',
      authors: 'Donges CE, Burd NA, Duffield R et al.',
      year: 2012,
      title:
        'Concurrent resistance and aerobic exercise stimulates both myofibrillar and mitochondrial protein synthesis in sedentary middle-aged men',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '22492939',
      doi: '10.1152/japplphysiol.00166.2012',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22492939/',
    },
    {
      id: 'donnelly2013',
      authors: 'Donnelly JE, Honas JJ, Smith BK et al.',
      year: 2013,
      title:
        'Aerobic exercise alone results in clinically significant weight loss for men and women: midwest exercise trial 2',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '23592678',
      doi: '10.1002/oby.20145',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23592678/',
    },
    {
      id: 'dorling2018',
      authors: 'Dorling J, Broom DR, Burns SF et al.',
      year: 2018,
      title:
        'Acute and Chronic Effects of Exercise on Appetite, Energy Intake, and Appetite-Related Hormones: The Modulating Effect of Adiposity, Sex, and Habitual Physical Activity',
      journal: 'Nutrients',
      pmid: '30131457',
      doi: '10.3390/nu10091140',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30131457/',
    },
    {
      id: 'dunstan2012',
      authors: 'Dunstan DW, Kingwell BA, Larsen R et al.',
      year: 2012,
      title: 'Breaking up prolonged sitting reduces postprandial glucose and insulin responses',
      journal: 'Diabetes care',
      pmid: '22374636',
      doi: '10.2337/dc11-1931',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22374636/',
    },
    {
      id: 'duscha2005',
      authors: 'Duscha BD, Slentz CA, Johnson JL et al.',
      year: 2005,
      title:
        'Effects of exercise training amount and intensity on peak oxygen consumption in middle-age men and women at risk for cardiovascular disease',
      journal: 'Chest',
      pmid: '16236956',
      doi: '10.1378/chest.128.4.2788',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16236956/',
    },
    {
      id: 'egan2013',
      authors: "Egan B, O'Connor PL, Zierath JR et al.",
      year: 2013,
      title:
        'Time course analysis reveals gene-specific transcript and protein kinetics of adaptation to short-term aerobic exercise training in human skeletal muscle',
      journal: 'PloS one',
      pmid: '24069271',
      doi: '10.1371/journal.pone.0074098',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24069271/',
    },
    {
      id: 'ekelund2016',
      authors: 'Ekelund U, Steene-Johannessen J, Brown WJ et al.',
      year: 2016,
      title:
        'Does physical activity attenuate, or even eliminate, the detrimental association of sitting time with mortality? A harmonised meta-analysis of data from more than 1 million men and women',
      journal: 'Lancet (London, England)',
      pmid: '27475271',
      doi: '10.1016/s0140-6736(16)30370-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27475271/',
    },
    {
      id: 'ekelund2019',
      authors: 'Ekelund U, Tarp J, Steene-Johannessen J et al.',
      year: 2019,
      title:
        'Dose-response associations between accelerometry measured physical activity and sedentary time and all cause mortality: systematic review and harmonised meta-analysis',
      journal: 'BMJ (Clinical research ed.)',
      pmid: '31434697',
      doi: '10.1136/bmj.l4570',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31434697/',
    },
    {
      id: 'engeroff2023',
      authors: 'Engeroff T, Groneberg DA, Wilke J',
      year: 2023,
      title:
        'After Dinner Rest a While, After Supper Walk a Mile? A Systematic Review with Meta-analysis on the Acute Postprandial Glycemic Response to Exercise Before and After Meal Ingestion in Healthy Subjects and Patients with Impaired Glucose Tolerance',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '36715875',
      doi: '10.1007/s40279-022-01808-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36715875/',
    },
    {
      id: 'ettema2009',
      authors: 'Ettema G, Lorås HW',
      year: 2009,
      title: 'Efficiency in cycling: a review',
      journal: 'European journal of applied physiology',
      pmid: '19229554',
      doi: '10.1007/s00421-009-1008-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19229554/',
    },
    {
      id: 'fao2004',
      authors: 'FAO/WHO/UNU',
      year: 2004,
      title:
        'Human energy requirements. Report of a Joint FAO/WHO/UNU Expert Consultation (Rome 2001); chapter 5 (PAL categories and worked examples)',
      journal: 'FAO Food and Nutrition Technical Report Series 1',
      url: 'https://www.fao.org/4/y5686e/y5686e07.htm',
    },
    {
      id: 'fedewa2017',
      authors: 'Fedewa MV, Hathaway ED, Williams TD et al.',
      year: 2017,
      title:
        'Effect of Exercise Training on Non-Exercise Physical Activity: A Systematic Review and Meta-Analysis of Randomized Controlled Trials',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '27873191',
      doi: '10.1007/s40279-016-0649-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27873191/',
    },
    {
      id: 'flack2018',
      authors: 'Flack KD, Ufholz K, Johnson L et al.',
      year: 2018,
      title: 'Energy compensation in response to aerobic exercise training in overweight adults',
      journal: 'American journal of physiology. Regulatory, integrative and comparative physiology',
      pmid: '29897822',
      doi: '10.1152/ajpregu.00071.2018',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29897822/',
    },
    {
      id: 'flack2020',
      authors: 'Flack KD, Hays HM, Moreland J et al.',
      year: 2020,
      title: 'Exercise for Weight Loss: Further Evaluating Energy Compensation with Exercise',
      journal: 'Medicine and science in sports and exercise',
      pmid: '33064415',
      doi: '10.1249/mss.0000000000002376',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33064415/',
    },
    {
      id: 'flanagan2024',
      authors: 'Flanagan EW, Sanchez-Delgado G, Martin CK et al.',
      year: 2024,
      title: 'No evidence for metabolic adaptation during exercise-related energy compensation',
      journal: 'iScience',
      pmid: '38947494',
      doi: '10.1016/j.isci.2024.109842',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38947494/',
    },
    {
      id: 'fleg2005',
      authors: 'Fleg JL, Morrell CH, Bos AG et al.',
      year: 2005,
      title: 'Accelerated longitudinal decline of aerobic capacity in healthy older adults',
      journal: 'Circulation',
      pmid: '16043637',
      doi: '10.1161/circulationaha.105.545459',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16043637/',
    },
    {
      id: 'frampton2022',
      authors: 'Frampton J, Edinburgh RM, Ogden HB et al.',
      year: 2022,
      title:
        'The acute effect of fasted exercise on energy intake, energy expenditure, subjective hunger and gastrointestinal hormone release compared to fed exercise in healthy individuals: a systematic review and network meta-analysis',
      journal: 'International journal of obesity (2005)',
      pmid: '34732837',
      doi: '10.1038/s41366-021-00993-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34732837/',
    },
    {
      id: 'frandsen2021',
      authors: 'Frandsen J, Amaro-Gahete FJ, Landgrebe A et al.',
      year: 2021,
      title: 'The influence of age, sex and cardiorespiratory fitness on maximal fat oxidation rate',
      journal:
        'Applied physiology, nutrition, and metabolism = Physiologie appliquee, nutrition et metabolisme',
      pmid: '33848440',
      doi: '10.1139/apnm-2021-0080',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33848440/',
    },
    {
      id: 'fyfe2014',
      authors: 'Fyfe JJ, Bishop DJ, Stepto NK',
      year: 2014,
      title:
        'Interference between concurrent resistance and endurance exercise: molecular bases and the role of individual training variables',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '24728927',
      doi: '10.1007/s40279-014-0162-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24728927/',
    },
    {
      id: 'gejl2021',
      authors: 'Gejl KD, Nybo L',
      year: 2021,
      title:
        'Performance effects of periodized carbohydrate restriction in endurance trained athletes - a systematic review and meta-analysis',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '34001184',
      doi: '10.1186/s12970-021-00435-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34001184/',
    },
    {
      id: 'gonzalez2016',
      authors: 'Gonzalez JT, Fuchs CJ, Betts JA et al.',
      year: 2016,
      title: 'Liver glycogen metabolism during and after prolonged endurance-type exercise',
      journal: 'American journal of physiology. Endocrinology and metabolism',
      pmid: '27436612',
      doi: '10.1152/ajpendo.00232.2016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27436612/',
    },
    {
      id: 'granata2016a',
      authors: 'Granata C, Oliveira RS, Little JP et al.',
      year: 2016,
      title:
        'Training intensity modulates changes in PGC-1α and p53 protein content and mitochondrial respiration, but not markers of mitochondrial content in human skeletal muscle',
      journal:
        'FASEB journal : official publication of the Federation of American Societies for Experimental Biology',
      pmid: '26572168',
      doi: '10.1096/fj.15-276907',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26572168/',
    },
    {
      id: 'granata2016b',
      authors: 'Granata C, Oliveira RS, Little JP et al.',
      year: 2016,
      title:
        'Mitochondrial adaptations to high-volume exercise training are rapidly reversed after a reduction in training volume in human skeletal muscle',
      journal:
        'FASEB journal : official publication of the Federation of American Societies for Experimental Biology',
      pmid: '27402675',
      doi: '10.1096/fj.201500100r',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27402675/',
    },
    {
      id: 'granata2018',
      authors: 'Granata C, Jamnick NA, Bishop DJ',
      year: 2018,
      title:
        'Training-Induced Changes in Mitochondrial Content and Respiratory Function in Human Skeletal Muscle',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '29934848',
      doi: '10.1007/s40279-018-0936-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29934848/',
    },
    {
      id: 'hackett2017',
      authors: 'Hackett D, Hagstrom A',
      year: 2017,
      title:
        'Effect of Overnight Fasted Exercise on Weight Loss and Body Composition: A Systematic Review and Meta-Analysis',
      journal: 'J Funct Morphol Kinesiol',
      doi: '10.3390/jfmk2040043',
      url: 'https://www.mdpi.com/2411-5142/2/4/43',
    },
    {
      id: 'haff2000',
      authors: 'Haff GG, Koch AJ, Potteiger JA et al.',
      year: 2000,
      title:
        'Carbohydrate supplementation attenuates muscle glycogen loss during acute bouts of resistance exercise',
      journal: 'International journal of sport nutrition and exercise metabolism',
      pmid: '10997956',
      doi: '10.1123/ijsnem.10.3.326',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10997956/',
    },
    {
      id: 'hall2004',
      authors: 'Hall C, Figueroa A, Fernhall B et al.',
      year: 2004,
      title: 'Energy expenditure of walking and running: comparison with prediction equations',
      journal: 'Medicine and science in sports and exercise',
      pmid: '15570150',
      doi: '10.1249/01.mss.0000147584.87788.0e',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15570150/',
    },
    {
      id: 'hawkins2003',
      authors: 'Hawkins S, Wiswell R',
      year: 2003,
      title:
        'Rate and mechanism of maximal oxygen consumption decline with aging: implications for exercise training',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '12974656',
      doi: '10.2165/00007256-200333120-00002',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12974656/',
    },
    {
      id: 'herrmann2015',
      authors: 'Herrmann SD, Willis EA, Honas JJ et al.',
      year: 2015,
      title:
        'Energy intake, nonexercise physical activity, and weight loss in responders and nonresponders: The Midwest Exercise Trial 2',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '26193059',
      doi: '10.1002/oby.21073',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26193059/',
    },
    {
      id: 'herrmann2024',
      authors: 'Herrmann SD, Willis EA, Ainsworth BE et al.',
      year: 2024,
      title:
        '2024 Adult Compendium of Physical Activities: A third update of the energy costs of human activities',
      journal: 'Journal of sport and health science',
      pmid: '38242596',
      doi: '10.1016/j.jshs.2023.10.010',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38242596/',
    },
    {
      id: 'heymsfield2014',
      authors: 'Heymsfield SB, Gonzalez MC, Shen W et al.',
      year: 2014,
      title:
        'Weight loss composition is one-fourth fat-free mass: a critical review and critique of this widely cited rule',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '24447775',
      doi: '10.1111/obr.12143',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24447775/',
    },
    {
      id: 'hickson1981',
      authors: 'Hickson RC, Hagberg JM, Ehsani AA et al.',
      year: 1981,
      title: 'Time course of the adaptive responses of aerobic power and heart rate to training',
      journal: 'Medicine and science in sports and exercise',
      pmid: '7219130',
      doi: '10.1249/00005768-198101000-00012',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7219130/',
    },
    {
      id: 'holloszy1984',
      authors: 'Holloszy JO, Coyle EF',
      year: 1984,
      title: 'Adaptations of skeletal muscle to endurance exercise and their metabolic consequences',
      journal: 'Journal of applied physiology: respiratory, environmental and exercise physiology',
      pmid: '6373687',
      doi: '10.1152/jappl.1984.56.4.831',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6373687/',
    },
    {
      id: 'houmard2004',
      authors: 'Houmard JA, Tanner CJ, Slentz CA et al.',
      year: 2004,
      title: 'Effect of the volume and intensity of exercise training on insulin sensitivity',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '12972442',
      doi: '10.1152/japplphysiol.00707.2003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12972442/',
    },
    {
      id: 'huang2016',
      authors: 'Huang G, Wang R, Chen P et al.',
      year: 2016,
      title:
        'Dose-response relationship of cardiorespiratory fitness adaptation to controlled endurance training in sedentary older adults',
      journal: 'European journal of preventive cardiology',
      pmid: '25901000',
      doi: '10.1177/2047487315582322',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25901000/',
    },
    {
      id: 'impey2018',
      authors: 'Impey SG, Hearris MA, Hammond KM et al.',
      year: 2018,
      title:
        'Fuel for the Work Required: A Theoretical Framework for Carbohydrate Periodization and the Glycogen Threshold Hypothesis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '29453741',
      doi: '10.1007/s40279-018-0867-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29453741/',
    },
    {
      id: 'islam2018',
      authors: 'Islam H, Townsend LK, Hazell TJ',
      year: 2018,
      title:
        'Excess Postexercise Oxygen Consumption and Fat Utilization Following Submaximal Continuous and Supramaximal Interval Running',
      journal: 'Research quarterly for exercise and sport',
      pmid: '30325710',
      doi: '10.1080/02701367.2018.1513633',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30325710/',
    },
    {
      id: 'ismail2012',
      authors: 'Ismail I, Keating SE, Baker MK et al.',
      year: 2012,
      title:
        'A systematic review and meta-analysis of the effect of aerobic vs. resistance exercise training on visceral fat',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '21951360',
      doi: '10.1111/j.1467-789x.2011.00931.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21951360/',
    },
    {
      id: 'iwayama2015a',
      authors: 'Iwayama K, Kawabuchi R, Park I et al.',
      year: 2015,
      title: 'Transient energy deficit induced by exercise increases 24-h fat oxidation in young trained men',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '25554797',
      doi: '10.1152/japplphysiol.00697.2014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25554797/',
    },
    {
      id: 'iwayama2015b',
      authors: 'Iwayama K, Kurihara R, Nabekura Y et al.',
      year: 2015,
      title: 'Exercise Increases 24-h Fat Oxidation Only When It Is Performed Before Breakfast',
      journal: 'EBioMedicine',
      pmid: '26844280',
      doi: '10.1016/j.ebiom.2015.10.029',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26844280/',
    },
    {
      id: 'jackson1990',
      authors: 'Jackson AS, Blair SN, Mahar MT et al.',
      year: 1990,
      title: 'Prediction of functional aerobic capacity without exercise testing',
      journal: 'Medicine and science in sports and exercise',
      pmid: '2287267',
      doi: '10.1249/00005768-199012000-00021',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2287267/',
    },
    {
      id: 'jackson1990b',
      authors: 'Jackson AS et al.',
      year: 1990,
      title:
        'Physical Activity Rating (PA-R) 0-7 scale, as reproduced in the supplementary appendix of Ann Occup Environ Med (2018)',
      journal: 'Instrument reproduced in supplementary appendix, Ann Occup Environ Med 2018',
      url: 'https://www.aoemj.org/upload/media/40557_2018_240_MOESM1_ESM.docx',
    },
    {
      id: 'jacobs2013',
      authors: 'Jacobs RA, Flück D, Bonne TC et al.',
      year: 2013,
      title:
        'Improvements in exercise performance with high-intensity interval training coincide with an increase in skeletal muscle mitochondrial content and function',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '23788574',
      doi: '10.1152/japplphysiol.00445.2013',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23788574/',
    },
    {
      id: 'jelleyman2015',
      authors: "Jelleyman C, Yates T, O'Donovan G et al.",
      year: 2015,
      title:
        'The effects of high-intensity interval training on glucose regulation and insulin resistance: a meta-analysis',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '26481101',
      doi: '10.1111/obr.12317',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26481101/',
    },
    {
      id: 'jeukendrup2005',
      authors: 'Jeukendrup AE, Wallis GA',
      year: 2005,
      title: 'Measurement of substrate oxidation during exercise by means of gas exchange measurements',
      journal: 'International journal of sports medicine',
      pmid: '15702454',
      doi: '10.1055/s-2004-830512',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15702454/',
      verification: 'unverified',
    },
    {
      id: 'johnson2009',
      authors: 'Johnson NA, Sachinwalla T, Walton DW et al.',
      year: 2009,
      title:
        'Aerobic exercise training reduces hepatic and visceral lipids in obese individuals without weight loss',
      journal: 'Hepatology (Baltimore, Md.)',
      pmid: '19637289',
      doi: '10.1002/hep.23129',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19637289/',
    },
    {
      id: 'jung2023',
      authors: 'Jung WS, Sun Y, Park HY et al.',
      year: 2023,
      title:
        'Comparison of energy consumption and excess post-exercise oxygen consumption according to Taekwondo Taegeuk Poomsae performance in Taekwondo players',
      journal: 'Physical activity and nutrition',
      pmid: '37132209',
      doi: '10.20463/pan.2023.0005',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37132209/',
    },
    {
      id: 'kaminsky2015',
      authors: 'Kaminsky LA, Arena R, Myers J',
      year: 2015,
      title:
        'Reference Standards for Cardiorespiratory Fitness Measured With Cardiopulmonary Exercise Testing: Data From the Fitness Registry and the Importance of Exercise National Database',
      journal: 'Mayo Clinic proceedings',
      pmid: '26455884',
      doi: '10.1016/j.mayocp.2015.07.026',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26455884/',
    },
    {
      id: 'kaminsky2022',
      authors: 'Kaminsky LA, Arena R, Myers J et al.',
      year: 2022,
      title:
        'Updated Reference Standards for Cardiorespiratory Fitness Measured with Cardiopulmonary Exercise Testing: Data from the Fitness Registry and the Importance of Exercise National Database (FRIEND)',
      journal: 'Mayo Clinic proceedings',
      pmid: '34809986',
      doi: '10.1016/j.mayocp.2021.08.020',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34809986/',
    },
    {
      id: 'keating2012',
      authors: 'Keating SE, Hackett DA, George J et al.',
      year: 2012,
      title: 'Exercise and non-alcoholic fatty liver disease: a systematic review and meta-analysis',
      journal: 'Journal of hepatology',
      pmid: '22414768',
      doi: '10.1016/j.jhep.2012.02.023',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22414768/',
    },
    {
      id: 'keating2017',
      authors: 'Keating SE, Johnson NA, Mielke GI et al.',
      year: 2017,
      title:
        'A systematic review and meta-analysis of interval training versus moderate-intensity continuous training on body adiposity',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '28513103',
      doi: '10.1111/obr.12536',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28513103/',
    },
    {
      id: 'king2008',
      authors: 'King NA, Hopkins M, Caudwell P et al.',
      year: 2008,
      title:
        'Individual variability following 12 weeks of supervised exercise: identification and characterization of compensation for exercise-induced weight loss',
      journal: 'International journal of obesity (2005)',
      pmid: '17848941',
      doi: '10.1038/sj.ijo.0803712',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17848941/',
    },
    {
      id: 'kipp2018',
      authors: 'Kipp S, Byrnes WC, Kram R',
      year: 2018,
      title:
        'Calculating metabolic energy expenditure across a wide range of exercise intensities: the equation matters',
      journal:
        'Applied physiology, nutrition, and metabolism = Physiologie appliquee, nutrition et metabolisme',
      pmid: '29401411',
      doi: '10.1139/apnm-2017-0781',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29401411/',
    },
    {
      id: 'knab2011',
      authors: 'Knab AM, Shanely RA, Corbin KD et al.',
      year: 2011,
      title: 'A 45-minute vigorous exercise bout increases metabolic rate for 14 hours',
      journal: 'Medicine and science in sports and exercise',
      pmid: '21311363',
      doi: '10.1249/mss.0b013e3182118891',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21311363/',
    },
    {
      id: 'kodama2009',
      authors: 'Kodama S, Saito K, Tanaka S et al.',
      year: 2009,
      title:
        'Cardiorespiratory fitness as a quantitative predictor of all-cause mortality and cardiovascular events in healthy men and women: a meta-analysis',
      journal: 'JAMA',
      pmid: '19454641',
      doi: '10.1001/jama.2009.681',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19454641/',
    },
    {
      id: 'laforgia2006',
      authors: 'LaForgia J, Withers RT, Gore CJ',
      year: 2006,
      title: 'Effects of exercise intensity and duration on the excess post-exercise oxygen consumption',
      journal: 'Journal of sports sciences',
      pmid: '17101527',
      doi: '10.1080/02640410600552064',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17101527/',
    },
    {
      id: 'lieberman2018',
      authors: 'Lieberman JL, DE Souza MJ, Wagstaff DA et al.',
      year: 2018,
      title: 'Menstrual Disruption with Exercise Is Not Linked to an Energy Availability Threshold',
      journal: 'Medicine and science in sports and exercise',
      pmid: '29023359',
      doi: '10.1249/mss.0000000000001451',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29023359/',
    },
    {
      id: 'looney2019',
      authors: 'Looney DP, Santee WR, Hansen EO et al.',
      year: 2019,
      title: 'Estimating Energy Expenditure during Level, Uphill, and Downhill Walking',
      journal: 'Medicine and science in sports and exercise',
      pmid: '30973477',
      doi: '10.1249/mss.0000000000002002',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30973477/',
    },
    {
      id: 'looney2026',
      authors: 'Looney DP, Hoogkamer W, Kram R',
      year: 2026,
      title: 'Metabolic energy expenditure during level, uphill, and downhill running',
      journal: 'European journal of applied physiology',
      pmid: '41057734',
      doi: '10.1007/s00421-025-05999-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41057734/',
    },
    {
      id: 'loucks1998',
      authors: 'Loucks AB, Verdun M, Heath EM',
      year: 1998,
      title: 'Low energy availability, not stress of exercise, alters LH pulsatility in exercising women',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '9451615',
      doi: '10.1152/jappl.1998.84.1.37',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9451615/',
    },
    {
      id: 'loucks2003',
      authors: 'Loucks AB, Thuma JR',
      year: 2003,
      title:
        'Luteinizing hormone pulsatility is disrupted at a threshold of energy availability in regularly menstruating women',
      journal: 'The Journal of clinical endocrinology and metabolism',
      pmid: '12519869',
      doi: '10.1210/jc.2002-020369',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12519869/',
    },
    {
      id: 'loucks2011',
      authors: 'Loucks AB, Kiens B, Wright HH',
      year: 2011,
      title: 'Energy availability in athletes',
      journal: 'Journal of sports sciences',
      pmid: '21793767',
      doi: '10.1080/02640414.2011.588958',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21793767/',
    },
    {
      id: 'ludlow2016',
      authors: 'Ludlow LW, Weyand PG',
      year: 2016,
      title:
        'Energy expenditure during level human walking: seeking a simple and accurate predictive solution',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '26679617',
      doi: '10.1152/japplphysiol.00864.2015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26679617/',
    },
    {
      id: 'ludlow2017',
      authors: 'Ludlow LW, Weyand PG',
      year: 2017,
      title: 'Walking economy is predictably determined by speed, grade, and gravitational load',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '28729390',
      doi: '10.1152/japplphysiol.00504.2017',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28729390/',
    },
    {
      id: 'lundberg2022',
      authors: 'Lundberg TR, Feuerbacher JF, Sünkeler M et al.',
      year: 2022,
      title:
        'The Effects of Concurrent Aerobic and Strength Training on Muscle Fiber Hypertrophy: A Systematic Review and Meta-Analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '35476184',
      doi: '10.1007/s40279-022-01688-x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35476184/',
    },
    {
      id: 'macinnis2017',
      authors: 'MacInnis MJ, Zacharewicz E, Martin BJ et al.',
      year: 2017,
      title:
        'Superior mitochondrial adaptations in human skeletal muscle after interval compared to continuous single-leg cycling matched for total work',
      journal: 'The Journal of physiology',
      pmid: '27396440',
      doi: '10.1113/jp272570',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27396440/',
    },
    {
      id: 'macinnisgibala2017',
      authors: 'MacInnis MJ, Gibala MJ',
      year: 2017,
      title: 'Physiological adaptations to interval training and the role of exercise intensity',
      journal: 'The Journal of physiology',
      pmid: '27748956',
      doi: '10.1113/jp273196',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27748956/',
    },
    {
      id: 'mackenzieshalders2020',
      authors: 'MacKenzie-Shalders K, Kelly JT, So D et al.',
      year: 2020,
      title:
        'The effect of exercise interventions on resting metabolic rate: A systematic review and meta-analysis',
      journal: 'Journal of sports sciences',
      pmid: '32397898',
      doi: '10.1080/02640414.2020.1754716',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32397898/',
    },
    {
      id: 'madsen1993',
      authors: 'Madsen K, Pedersen PK, Djurhuus MS et al.',
      year: 1993,
      title:
        'Effects of detraining on endurance capacity and metabolic changes during prolonged exhaustive exercise',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '8282588',
      doi: '10.1152/jappl.1993.75.4.1444',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8282588/',
    },
    {
      id: 'magkos2008',
      authors: 'Magkos F, Tsekouras Y, Kavouras SA et al.',
      year: 2008,
      title:
        'Improved insulin sensitivity after a single bout of exercise is curvilinearly related to exercise energy expenditure',
      journal: 'Clinical science (London, England : 1979)',
      pmid: '17635103',
      doi: '10.1042/cs20070134',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17635103/',
    },
    {
      id: 'mancilla2021',
      authors: 'Mancilla R, Brouwers B, Schrauwen-Hinderling VB et al.',
      year: 2021,
      title:
        'Exercise training elicits superior metabolic effects when performed in the afternoon compared to morning in metabolically compromised humans',
      journal: 'Physiological reports',
      pmid: '33356015',
      doi: '10.14814/phy2.14669',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33356015/',
    },
    {
      id: 'mandsager2018',
      authors: 'Mandsager K, Harb S, Cremer P et al.',
      year: 2018,
      title:
        'Association of Cardiorespiratory Fitness With Long-term Mortality Among Adults Undergoing Exercise Treadmill Testing',
      journal: 'JAMA network open',
      pmid: '30646252',
      doi: '10.1001/jamanetworkopen.2018.3605',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30646252/',
    },
    {
      id: 'manini2010',
      authors: 'Manini TM',
      year: 2010,
      title: 'Energy expenditure and aging',
      journal: 'Ageing research reviews',
      pmid: '19698803',
      doi: '10.1016/j.arr.2009.08.002',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19698803/',
    },
    {
      id: 'martin2019',
      authors: 'Martin CK, Johnson WD, Myers CA et al.',
      year: 2019,
      title:
        'Effect of different doses of supervised exercise on food intake, metabolism, and non-exercise physical activity: The E-MECHANIC randomized controlled trial',
      journal: 'The American journal of clinical nutrition',
      pmid: '31172175',
      doi: '10.1093/ajcn/nqz054',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31172175/',
    },
    {
      id: 'meeusen2013',
      authors: 'Meeusen R, Duclos M, Foster C et al.',
      year: 2013,
      title:
        'Prevention, diagnosis, and treatment of the overtraining syndrome: joint consensus statement of the European College of Sport Science and the American College of Sports Medicine',
      journal: 'Medicine and science in sports and exercise',
      pmid: '23247672',
      doi: '10.1249/mss.0b013e318279a10a',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23247672/',
    },
    {
      id: 'melanson2002',
      authors: 'Melanson EL, Sharp TA, Seagle HM et al.',
      year: 2002,
      title: 'Resistance and aerobic exercise have similar effects on 24-h nutrient oxidation',
      journal: 'Medicine and science in sports and exercise',
      pmid: '12439085',
      doi: '10.1097/00005768-200211000-00016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12439085/',
    },
    {
      id: 'melanson2013',
      authors: 'Melanson EL, Keadle SK, Donnelly JE et al.',
      year: 2013,
      title: 'Resistance to exercise-induced weight loss: compensatory behavioral adaptations',
      journal: 'Medicine and science in sports and exercise',
      pmid: '23470300',
      doi: '10.1249/mss.0b013e31828ba942',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23470300/',
    },
    {
      id: 'mikines1988',
      authors: 'Mikines KJ, Sonne B, Farrell PA et al.',
      year: 1988,
      title: 'Effect of physical exercise on sensitivity and responsiveness to insulin in humans',
      journal: 'The American journal of physiology',
      pmid: '3126668',
      doi: '10.1152/ajpendo.1988.254.3.e248',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3126668/',
    },
    {
      id: 'milanovic2015',
      authors: 'Milanović Z, Sporiš G, Weston M',
      year: 2015,
      title:
        'Effectiveness of High-Intensity Interval Training (HIT) and Continuous Endurance Training for VO2max Improvements: A Systematic Review and Meta-Analysis of Controlled Trials',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '26243014',
      doi: '10.1007/s40279-015-0365-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26243014/',
    },
    {
      id: 'miller2013',
      authors: 'Miller CT, Fraser SF, Levinger I et al.',
      year: 2013,
      title:
        'The effects of exercise training in addition to energy restriction on functional capacities and body composition in obese adults during weight loss: a systematic review',
      journal: 'PloS one',
      pmid: '24409219',
      doi: '10.1371/journal.pone.0081692',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24409219/',
    },
    {
      id: 'minetti2002',
      authors: 'Minetti AE, Moia C, Roi GS et al.',
      year: 2002,
      title: 'Energy cost of walking and running at extreme uphill and downhill slopes',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '12183501',
      doi: '10.1152/japplphysiol.01177.2001',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12183501/',
      verification: 'unverified',
    },
    {
      id: 'mitchell2024',
      authors: 'Mitchell L, Wilson L, Duthie G et al.',
      year: 2024,
      title: 'Methods to Assess Energy Expenditure of Resistance Exercise: A Systematic Scoping Review',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '38896201',
      doi: '10.1007/s40279-024-02047-8',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38896201/',
    },
    {
      id: 'montero2017',
      authors: 'Montero D, Lundby C',
      year: 2017,
      title:
        "Refuting the myth of non-response to exercise training: 'non-responders' do respond to higher dose of training",
      journal: 'The Journal of physiology',
      pmid: '28133739',
      doi: '10.1113/jp273480',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28133739/',
    },
    {
      id: 'mountjoy2023',
      authors: 'Mountjoy M, Ackerman KE, Bailey DM et al.',
      year: 2023,
      title:
        "2023 International Olympic Committee's (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs)",
      journal: 'British journal of sports medicine',
      pmid: '37752011',
      doi: '10.1136/bjsports-2023-106994',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37752011/',
    },
    {
      id: 'mujika2000b',
      authors: 'Mujika I, Padilla S',
      year: 2000,
      title:
        'Detraining: loss of training-induced physiological and performance adaptations. Part II: Long term insufficient training stimulus',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '10999420',
      doi: '10.2165/00007256-200030030-00001',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10999420/',
    },
    {
      id: 'murachbagley2016',
      authors: 'Murach KA, Bagley JR',
      year: 2016,
      title:
        'Skeletal Muscle Hypertrophy with Concurrent Exercise Training: Contrary Evidence for an Interference Effect',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '26932769',
      doi: '10.1007/s40279-016-0496-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26932769/',
    },
    {
      id: 'nes2011',
      authors: 'Nes BM, Janszky I, Vatten LJ et al.',
      year: 2011,
      title: 'Estimating V·O 2peak from a nonexercise prediction model: the HUNT Study, Norway',
      journal: 'Medicine and science in sports and exercise',
      pmid: '21502897',
      doi: '10.1249/mss.0b013e31821d3f6f',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21502897/',
    },
    {
      id: 'neufer1989',
      authors: 'Neufer PD',
      year: 1989,
      title:
        'The effect of detraining and reduced training on the physiological adaptations to aerobic exercise training',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '2692122',
      doi: '10.2165/00007256-198908050-00004',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2692122/',
    },
    {
      id: 'paluch2022',
      authors: 'Paluch AE, Bajpai S, Bassett DR et al.',
      year: 2022,
      title: 'Daily steps and all-cause mortality: a meta-analysis of 15 international cohorts',
      journal: 'The Lancet. Public health',
      pmid: '35247352',
      doi: '10.1016/s2468-2667(21)00302-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35247352/',
    },
    {
      id: 'panissa2021',
      authors: 'Panissa VLG, Fukuda DH, Staibano V et al.',
      year: 2021,
      title:
        'Magnitude and duration of excess of post-exercise oxygen consumption between high-intensity interval and moderate-intensity continuous exercise: A systematic review',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '32656951',
      doi: '10.1111/obr.13099',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32656951/',
    },
    {
      id: 'patterson2018',
      authors: 'Patterson R, McNamara E, Tainio M et al.',
      year: 2018,
      title:
        'Sedentary behaviour and risk of all-cause, cardiovascular and cancer mortality, and incident type 2 diabetes: a systematic review and dose response meta-analysis',
      journal: 'European journal of epidemiology',
      pmid: '29589226',
      doi: '10.1007/s10654-018-0380-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29589226/',
    },
    {
      id: 'perseghin1996',
      authors: 'Perseghin G, Price TB, Petersen KF et al.',
      year: 1996,
      title:
        'Increased glucose transport-phosphorylation and muscle glycogen synthesis after exercise training in insulin-resistant subjects',
      journal: 'The New England journal of medicine',
      pmid: '8857019',
      doi: '10.1056/nejm199610313351804',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8857019/',
    },
    {
      id: 'peterman2020',
      authors: 'Peterman JE, Harber MP, Imboden MT et al.',
      year: 2020,
      title:
        'Accuracy of Nonexercise Prediction Equations for Assessing Longitudinal Changes to Cardiorespiratory Fitness in Apparently Healthy Adults: BALL ST Cohort',
      journal: 'Journal of the American Heart Association',
      pmid: '32458761',
      doi: '10.1161/jaha.119.015117',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32458761/',
    },
    {
      id: 'petre2021',
      authors: 'Petré H, Hemmingsson E, Rosdahl H et al.',
      year: 2021,
      title:
        'Development of Maximal Dynamic Strength During Concurrent Resistance and Endurance Training in Untrained, Moderately Trained, and Trained Individuals: A Systematic Review and Meta-analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '33751469',
      doi: '10.1007/s40279-021-01426-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33751469/',
    },
    {
      id: 'phillips2003',
      authors: 'Phillips WT, Ziuraitis JR',
      year: 2003,
      title: 'Energy cost of the ACSM single-set resistance training protocol',
      journal: 'Journal of strength and conditioning research',
      pmid: '12741877',
      doi: '10.1519/1533-4287(2003)017<0350:ecotas>2.0.co;2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12741877/',
    },
    {
      id: 'pontzer2016',
      authors: 'Pontzer H, Durazo-Arvizu R, Dugas LR et al.',
      year: 2016,
      title:
        'Constrained Total Energy Expenditure and Metabolic Adaptation to Physical Activity in Adult Humans',
      journal: 'Current biology : CB',
      pmid: '26832439',
      doi: '10.1016/j.cub.2015.12.046',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26832439/',
    },
    {
      id: 'randell2017',
      authors: 'Randell RK, Rollo I, Roberts TJ et al.',
      year: 2017,
      title: 'Maximal Fat Oxidation Rates in an Athletic Population',
      journal: 'Medicine and science in sports and exercise',
      pmid: '27580144',
      doi: '10.1249/mss.0000000000001084',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27580144/',
    },
    {
      id: 'reis2017',
      authors: 'Reis VM, Garrido ND, Vianna J et al.',
      year: 2017,
      title: 'Energy cost of isolated resistance exercises across low- to high-intensities',
      journal: 'PloS one',
      pmid: '28742112',
      doi: '10.1371/journal.pone.0181311',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28742112/',
    },
    {
      id: 'reynolds2016',
      authors: 'Reynolds AN, Mann JI, Williams S et al.',
      year: 2016,
      title:
        'Advice to walk after meals is more effective for lowering postprandial glycaemia in type 2 diabetes mellitus than advice that does not specify timing: a randomised crossover study',
      journal: 'Diabetologia',
      pmid: '27747394',
      doi: '10.1007/s00125-016-4085-2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27747394/',
    },
    {
      id: 'riou2015',
      authors: 'Riou MÈ, Jomphe-Tremblay S, Lamothe G et al.',
      year: 2015,
      title: 'Predictors of Energy Compensation during Exercise Interventions: A Systematic Review',
      journal: 'Nutrients',
      pmid: '25988763',
      doi: '10.3390/nu7053677',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25988763/',
    },
    {
      id: 'robergs1991',
      authors: 'Robergs RA, Pearson DR, Costill DL et al.',
      year: 1991,
      title: 'Muscle glycogenolysis during differing intensities of weight-resistance exercise',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '2055849',
      doi: '10.1152/jappl.1991.70.4.1700',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2055849/',
    },
    {
      id: 'robineau2016',
      authors: 'Robineau J, Babault N, Piscione J et al.',
      year: 2016,
      title:
        'Specific Training Effects of Concurrent Aerobic and Strength Exercises Depend on Recovery Duration',
      journal: 'Journal of strength and conditioning research',
      pmid: '25546450',
      doi: '10.1519/jsc.0000000000000798',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25546450/',
    },
    {
      id: 'romijn1993',
      authors: 'Romijn JA, Coyle EF, Sidossis LS et al.',
      year: 1993,
      title:
        'Regulation of endogenous fat and carbohydrate metabolism in relation to exercise intensity and duration',
      journal: 'The American journal of physiology',
      pmid: '8214047',
      doi: '10.1152/ajpendo.1993.265.3.e380',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8214047/',
    },
    {
      id: 'ross2000',
      authors: 'Ross R, Dagnone D, Jones PJ et al.',
      year: 2000,
      title:
        'Reduction in obesity and related comorbid conditions after diet-induced weight loss or exercise-induced weight loss in men. A randomized, controlled trial',
      journal: 'Annals of internal medicine',
      pmid: '10896648',
      doi: '10.7326/0003-4819-133-2-200007180-00008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10896648/',
    },
    {
      id: 'ross2016',
      authors: 'Ross R, Blair SN, Arena R et al.',
      year: 2016,
      title:
        'Importance of Assessing Cardiorespiratory Fitness in Clinical Practice: A Case for Fitness as a Clinical Vital Sign: A Scientific Statement From the American Heart Association',
      journal: 'Circulation',
      pmid: '27881567',
      doi: '10.1161/cir.0000000000000461',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27881567/',
    },
    {
      id: 'ross2019',
      authors: 'Ross R, Goodpaster BH, Koch LG et al.',
      year: 2019,
      title: 'Precision exercise medicine: understanding exercise response variability',
      journal: 'British journal of sports medicine',
      pmid: '30862704',
      doi: '10.1136/bjsports-2018-100328',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30862704/',
    },
    {
      id: 'rubiovalles2025',
      authors: 'Rubio-Valles M, Amaro-Gahete FJ, Creasy SA et al.',
      year: 2025,
      title:
        'Circadian Regulation of Fatty Acid Metabolism in Humans: Is There Evidence of an Optimal Time Window for Maximizing Fat Oxidation During Exercise?',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '39681771',
      doi: '10.1007/s40279-024-02154-6',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39681771/',
    },
    {
      id: 'sabag2022',
      authors: 'Sabag A, Barr L, Armour M et al.',
      year: 2022,
      title:
        'The Effect of High-intensity Interval Training vs Moderate-intensity Continuous Training on Liver Fat: A Systematic Review and Meta-Analysis',
      journal: 'The Journal of clinical endocrinology and metabolism',
      pmid: '34724062',
      doi: '10.1210/clinem/dgab795',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34724062/',
    },
    {
      id: 'saintmaurice2020',
      authors: 'Saint-Maurice PF, Troiano RP, Bassett DR et al.',
      year: 2020,
      title: 'Association of Daily Step Count and Step Intensity With Mortality Among US Adults',
      journal: 'JAMA',
      pmid: '32207799',
      doi: '10.1001/jama.2020.1382',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32207799/',
    },
    {
      id: 'savikj2019',
      authors: 'Savikj M, Gabriel BM, Alm PS et al.',
      year: 2019,
      title:
        'Afternoon exercise is more efficacious than morning exercise at improving blood glucose levels in individuals with type 2 diabetes: a randomised crossover trial',
      journal: 'Diabetologia',
      pmid: '30426166',
      doi: '10.1007/s00125-018-4767-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30426166/',
    },
    {
      id: 'scharhag2010',
      authors: 'Scharhag-Rosenberger F, Meyer T, Walitzek S et al.',
      year: 2010,
      title:
        'Effects of one year aerobic endurance training on resting metabolic rate and exercise fat oxidation in previously untrained men and women. Metabolic endurance training adaptations',
      journal: 'International journal of sports medicine',
      pmid: '20432193',
      doi: '10.1055/s-0030-1249621',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20432193/',
    },
    {
      id: 'schoenfeld2014',
      authors: 'Schoenfeld BJ, Aragon AA, Wilborn CD et al.',
      year: 2014,
      title: 'Body composition changes associated with fasted versus non-fasted aerobic exercise',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '25429252',
      doi: '10.1186/s12970-014-0054-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25429252/',
    },
    {
      id: 'schubert2013',
      authors: 'Schubert MM, Desbrow B, Sabapathy S et al.',
      year: 2013,
      title: 'Acute exercise and subsequent energy intake. A meta-analysis',
      journal: 'Appetite',
      pmid: '23274127',
      doi: '10.1016/j.appet.2012.12.010',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23274127/',
    },
    {
      id: 'schubert2014',
      authors: 'Schubert MM, Sabapathy S, Leveritt M et al.',
      year: 2014,
      title: 'Acute exercise and hormones related to appetite regulation: a meta-analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '24174308',
      doi: '10.1007/s40279-013-0120-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24174308/',
    },
    {
      id: 'schumann2022',
      authors: 'Schumann M, Feuerbacher JF, Sünkeler M et al.',
      year: 2022,
      title:
        'Compatibility of Concurrent Aerobic and Strength Training for Skeletal Muscle Size and Function: An Updated Systematic Review and Meta-Analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '34757594',
      doi: '10.1007/s40279-021-01587-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34757594/',
    },
    {
      id: 'sevits2013',
      authors: 'Sevits KJ, Melanson EL, Swibas T et al.',
      year: 2013,
      title:
        'Total daily energy expenditure is increased following a single bout of sprint interval training',
      journal: 'Physiological reports',
      pmid: '24303194',
      doi: '10.1002/phy2.131',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24303194/',
    },
    {
      id: 'shcherbina2017',
      authors: 'Shcherbina A, Mattsson CM, Waggott D et al.',
      year: 2017,
      title:
        'Accuracy in Wrist-Worn, Sensor-Based Measurements of Heart Rate and Energy Expenditure in a Diverse Cohort',
      journal: 'Journal of personalized medicine',
      pmid: '28538708',
      doi: '10.3390/jpm7020003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28538708/',
    },
    {
      id: 'shimada2013',
      authors: 'Shimada K, Yamamoto Y, Iwayama K et al.',
      year: 2013,
      title: 'Effects of post-absorptive and postprandial exercise on 24 h fat oxidation',
      journal: 'Metabolism: clinical and experimental',
      pmid: '23313101',
      doi: '10.1016/j.metabol.2012.12.008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23313101/',
    },
    {
      id: 'sim2014',
      authors: 'Sim AY, Wallman KE, Fairchild TJ et al.',
      year: 2014,
      title: 'High-intensity intermittent exercise attenuates ad-libitum energy intake',
      journal: 'International journal of obesity (2005)',
      pmid: '23835594',
      doi: '10.1038/ijo.2013.102',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23835594/',
    },
    {
      id: 'sisson2009',
      authors: 'Sisson SB, Katzmarzyk PT, Earnest CP et al.',
      year: 2009,
      title: 'Volume of exercise and fitness nonresponse in sedentary, postmenopausal women',
      journal: 'Medicine and science in sports and exercise',
      pmid: '19204597',
      doi: '10.1249/mss.0b013e3181896c4e',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19204597/',
    },
    {
      id: 'skinner2001',
      authors: 'Skinner JS, Jaskólski A, Jaskólska A et al.',
      year: 2001,
      title: 'Age, sex, race, initial fitness, and response to training: the HERITAGE Family Study',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '11299267',
      doi: '10.1152/jappl.2001.90.5.1770',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11299267/',
    },
    {
      id: 'slentz2005',
      authors: 'Slentz CA, Aiken LB, Houmard JA et al.',
      year: 2005,
      title:
        'Inactivity, exercise, and visceral fat. STRRIDE: a randomized, controlled study of exercise intensity and amount',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '16002776',
      doi: '10.1152/japplphysiol.00124.2005',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16002776/',
    },
    {
      id: 'thomas2012',
      authors: 'Thomas DM, Bouchard C, Church T et al.',
      year: 2012,
      title:
        'Why do individuals not lose more weight from an exercise intervention at a defined dose? An energy balance analysis',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '22681398',
      doi: '10.1111/j.1467-789x.2012.01012.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22681398/',
    },
    {
      id: 'tigbe2011',
      authors: 'Tigbe WW, Lean ME, Granat MH',
      year: 2011,
      title:
        'A physically active occupation does not result in compensatory inactivity during out-of-work hours',
      journal: 'Preventive medicine',
      pmid: '21575655',
      doi: '10.1016/j.ypmed.2011.04.018',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21575655/',
    },
    {
      id: 'ttu2013',
      authors: 'Texas Tech University',
      year: 2013,
      title:
        'HFI Metabolic Calculations (worked examples of ACSM walking, running and leg-ergometry equations)',
      journal:
        'Texas Tech University course document; primary source ACSM Guidelines for Exercise Testing and Prescription',
      url: 'https://www.depts.ttu.edu/ksm/_documents/grad/acsm_comps/6c-23-2013_HFI_Metabolic_Calculations.pdf',
    },
    {
      id: 'tudorlocke2008',
      authors: 'Tudor-Locke C, Hatano Y, Pangrazi RP et al.',
      year: 2008,
      title: 'Revisiting "how many steps are enough?"',
      journal: 'Medicine and science in sports and exercise',
      pmid: '18562971',
      doi: '10.1249/mss.0b013e31817c7133',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18562971/',
    },
    {
      id: 'tudorlocke2011',
      authors: 'Tudor-Locke C, Craig CL, Brown WJ et al.',
      year: 2011,
      title: 'How many steps/day are enough? For adults',
      journal: 'The international journal of behavioral nutrition and physical activity',
      pmid: '21798015',
      doi: '10.1186/1479-5868-8-79',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21798015/',
    },
    {
      id: 'vanloon2001',
      authors: 'van Loon LJ, Greenhaff PL, Constantin-Teodosiu D et al.',
      year: 2001,
      title: 'The effects of increasing exercise intensity on muscle fuel utilisation in humans',
      journal: 'The Journal of physiology',
      pmid: '11579177',
      doi: '10.1111/j.1469-7793.2001.00295.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11579177/',
    },
    {
      id: 'venables2005',
      authors: 'Venables MC, Achten J, Jeukendrup AE',
      year: 2005,
      title:
        'Determinants of fat oxidation during exercise in healthy men and women: a cross-sectional study',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '15333616',
      doi: '10.1152/japplphysiol.00662.2003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15333616/',
    },
    {
      id: 'verheggen2016',
      authors: 'Verheggen RJ, Maessen MF, Green DJ et al.',
      year: 2016,
      title:
        'A systematic review and meta-analysis on the effects of exercise training versus hypocaloric diet: distinct effects on body weight and visceral adipose tissue',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '27213481',
      doi: '10.1111/obr.12406',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27213481/',
    },
    {
      id: 'vieira2016',
      authors: 'Vieira AF, Costa RR, Macedo RC et al.',
      year: 2016,
      title:
        'Effects of aerobic exercise performed in fasted v. fed state on fat and carbohydrate metabolism in adults: a systematic review and meta-analysis',
      journal: 'The British journal of nutrition',
      pmid: '27609363',
      doi: '10.1017/s0007114516003160',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27609363/',
    },
    {
      id: 'vighlarsen2021',
      authors: 'Vigh-Larsen JF, Ørtenblad N, Spriet LL et al.',
      year: 2021,
      title: 'Muscle Glycogen Metabolism and High-Intensity Exercise Performance: A Narrative Review',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '33900579',
      doi: '10.1007/s40279-021-01475-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33900579/',
    },
    {
      id: 'vissers2013',
      authors: 'Vissers D, Hens W, Taeymans J et al.',
      year: 2013,
      title:
        'The effect of exercise on visceral adipose tissue in overweight adults: a systematic review and meta-analysis',
      journal: 'PloS one',
      pmid: '23409182',
      doi: '10.1371/journal.pone.0056415',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23409182/',
    },
    {
      id: 'volek2016',
      authors: 'Volek JS, Freidenreich DJ, Saenz C et al.',
      year: 2016,
      title: 'Metabolic characteristics of keto-adapted ultra-endurance runners',
      journal: 'Metabolism: clinical and experimental',
      pmid: '26892521',
      doi: '10.1016/j.metabol.2015.10.028',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26892521/',
    },
    {
      id: 'washburn2015',
      authors: 'Washburn RA, Honas JJ, Ptomey LT et al.',
      year: 2015,
      title: 'Energy and Macronutrient Intake in the Midwest Exercise Trial 2 (MET-2)',
      journal: 'Medicine and science in sports and exercise',
      pmid: '25574796',
      doi: '10.1249/mss.0000000000000611',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25574796/',
    },
    {
      id: 'way2016',
      authors: 'Way KL, Hackett DA, Baker MK et al.',
      year: 2016,
      title:
        'The Effect of Regular Exercise on Insulin Sensitivity in Type 2 Diabetes Mellitus: A Systematic Review and Meta-Analysis',
      journal: 'Diabetes & metabolism journal',
      pmid: '27535644',
      doi: '10.4093/dmj.2016.40.4.253',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27535644/',
    },
    {
      id: 'weinheimer2010',
      authors: 'Weinheimer EM, Sands LP, Campbell WW',
      year: 2010,
      title:
        'A systematic review of the separate and combined effects of energy restriction and exercise on fat-free mass in middle-aged and older adults: implications for sarcopenic obesity',
      journal: 'Nutrition reviews',
      pmid: '20591106',
      doi: '10.1111/j.1753-4887.2010.00298.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20591106/',
    },
    {
      id: 'westerterp2013',
      authors: 'Westerterp KR',
      year: 2013,
      title:
        'Physical activity and physical activity induced energy expenditure in humans: measurement, determinants, and effects',
      journal: 'Frontiers in physiology',
      pmid: '23637685',
      doi: '10.3389/fphys.2013.00090',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23637685/',
    },
    {
      id: 'westerterp2017',
      authors: 'Westerterp KR',
      year: 2017,
      title: 'Control of energy expenditure in humans',
      journal: 'European journal of clinical nutrition',
      pmid: '27901037',
      doi: '10.1038/ejcn.2016.237',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27901037/',
    },
    {
      id: 'wewege2017',
      authors: 'Wewege M, van den Berg R, Ward RE et al.',
      year: 2017,
      title:
        'The effects of high-intensity interval training vs. moderate-intensity continuous training on body composition in overweight and obese adults: a systematic review and meta-analysis',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '28401638',
      doi: '10.1111/obr.12532',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28401638/',
    },
    {
      id: 'weyand2013',
      authors: 'Weyand PG, Smith BR, Schultz NS et al.',
      year: 2013,
      title: 'Predicting metabolic rate across walking speed: one fit for all body sizes?',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '23928111',
      doi: '10.1152/japplphysiol.01333.2012',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23928111/',
    },
    {
      id: 'wilkin2012',
      authors: 'Wilkin LD, Cheryl A, Haddock BL',
      year: 2012,
      title: 'Energy expenditure comparison between walking and running in average fitness individuals',
      journal: 'Journal of strength and conditioning research',
      pmid: '22446673',
      doi: '10.1519/jsc.0b013e31822e592c',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22446673/',
    },
    {
      id: 'willis2014',
      authors: 'Willis EA, Herrmann SD, Honas JJ et al.',
      year: 2014,
      title: 'Nonexercise energy expenditure and physical activity in the Midwest Exercise Trial 2',
      journal: 'Medicine and science in sports and exercise',
      pmid: '24694746',
      doi: '10.1249/mss.0000000000000354',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24694746/',
    },
    {
      id: 'willis2020',
      authors: 'Willis EA, Creasy SA, Honas JJ et al.',
      year: 2020,
      title:
        'The effects of exercise session timing on weight loss and components of energy balance: midwest exercise trial 2',
      journal: 'International journal of obesity (2005)',
      pmid: '31289334',
      doi: '10.1038/s41366-019-0409-x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31289334/',
    },
    {
      id: 'wilson2012',
      authors: 'Wilson JM, Marin PJ, Rhea MR et al.',
      year: 2012,
      title:
        'Concurrent training:  a meta-analysis examining interference of aerobic and resistance exercises',
      journal: 'Journal of strength and conditioning research',
      pmid: '22002517',
      doi: '10.1519/jsc.0b013e31823a3e2d',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22002517/',
    },
    {
      id: 'zamparo2020',
      authors: 'Zamparo P, Cortesi M, Gatta G',
      year: 2020,
      title: 'The energy cost of swimming and its determinants',
      journal: 'European journal of applied physiology',
      pmid: '31807901',
      doi: '10.1007/s00421-019-04270-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31807901/',
    },
    {
      id: 'zhang2016',
      authors: 'Zhang HJ, He J, Pan LL et al.',
      year: 2016,
      title:
        'Effects of Moderate and Vigorous Exercise on Nonalcoholic Fatty Liver Disease: A Randomized Clinical Trial',
      journal: 'JAMA internal medicine',
      pmid: '27379904',
      doi: '10.1001/jamainternmed.2016.3202',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27379904/',
    },
  ],
};

export default topic;
