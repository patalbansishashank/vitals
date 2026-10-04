import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '13',
  slug: 'transitions-periodisation',
  title: 'Diet transitions, fasting and periodisation',
  scope:
    'What the body does in the days and weeks after a change in eating pattern (for example from very-low-carbohydrate to high-carbohydrate, or into and out of a fast), and why the scale swings before fat does. It also covers protein-sparing and very-low-calorie diets, diet breaks and refeeds, fasting, train-low strategies and physique cycles, and whether deliberately sequencing eating patterns beats a steady plan.',
  mechanisms: [
    {
      id: '13-scale-weight-decomposition',
      title: 'Why the scale moves before fat does',
      category: 'body',
      summary:
        'After any diet switch the scale moves first through fast-changing compartments: glycogen and the water bound to it, sodium-linked body water, gut contents and plasma volume. Fat and protein change slowly. Vitals therefore plots scale weight and fat mass separately, and treats DXA or BIA “lean” as including glycogen and water. In a 1-week diet break, DXA fat-free mass rose 0.7 kg with no change in fat.',
      howModelled:
        'Displayed scale weight is the true tissue weight (fat plus the fat-free core) plus glycogen with its bound water, carbohydrate-sensitive body water, sodium-linked water, gut content relative to a reference, plasma-volume and menstrual terms, and smaller creatine, hydration and post-fast swelling terms. The weekly rhythm and random day-to-day noise are not simulated.',
      equation:
        'W_scale(t) = W_true(t) + G(t)/1000 · (1 + h) + E_cna(t) + S_na(t)/140 + (M_gut(t) − M_gut,ref) + P_ex(t) + W_mc(t) + R_week(dow) · W_true + ε(t)\nε ~ N(0, (σ · W_true)²)\nIsosmotic rule: 140 mmol Na retained ≈ 1 L extracellular water ≈ 1 kg',
      keyNumbers: [
        {
          label: 'h, water bound per gram of glycogen',
          value: '3.0 g/g (range 2.7–4.0)',
          note: 'At least 3:1 when water was restricted; earlier ranges 3–4 and 2.7–4.',
          referenceIds: ['fernandezelias2015', 'kreitzman1992', 'shiose2016', 'olsson1970'],
        },
        {
          label: 'σ, day-to-day noise',
          value: '0.35 % of body weight (range 0.25–0.6 %)',
          note: 'Proposed. One study found a coefficient of variation of 0.6 % over 2–4 weeks, which includes true change.',
          referenceIds: ['lipsitz1985'],
        },
        {
          label: 'Weekly rhythm',
          value: '0.35 % peak-to-trough, highest Sunday or Monday, lowest Friday (n = 1,421)',
          referenceIds: ['turicchi2020', 'orsama2014'],
        },
        {
          label: 'Holiday (Christmas) step',
          value: '+1.35 %, not fully reversed',
          referenceIds: ['turicchi2020'],
        },
        {
          label: 'Sodium and water',
          value: 'About 70 mEq/d extra sodium reabsorption ≈ 0.5 L/d of water retention after a 24-h fast',
          referenceIds: ['heyman2020'],
        },
        {
          label: '1-week diet break after 12 weeks of restriction',
          value: 'DXA “fat-free mass” +0.7 kg with no fat change',
          referenceIds: ['peos2021b'],
        },
      ],
      timeCourse:
        'Days to a week for the labile terms; fat and protein change over weeks. The weekly rhythm repeats every 7 days.',
      moderators:
        'Carbohydrate, sodium and fibre intake, exercise, menstrual cycle, and how the person is weighed.',
      grade: 'C',
      gradeReason:
        'Glycogen-bound water and the weekly rhythm are grade B, but the additive decomposition as a whole is C because each term was checked separately and never all together.',
      status: 'proposed-fit',
      caveats:
        'The noise size and weekly amplitude are proposed for a free-living realism mode, which Vitals does not have, so they are not applied.',
      referenceIds: [
        'fernandezelias2015',
        'kreitzman1992',
        'shiose2016',
        'olsson1970',
        'lipsitz1985',
        'turicchi2020',
        'orsama2014',
        'heyman2020',
        'peos2021b',
      ],
      relatedMetricIds: ['scaleWeight', 'waterWeight', 'leanMass'],
    },
    {
      id: '13-glycogen-water-on-switches',
      title: 'Glycogen and its water on a diet switch',
      category: 'fuel',
      summary:
        'Glycogen is stored with about 3 g of water per gram, so cutting carbohydrate can drop the scale by 1.2–2.0 kg within days, and adding carbohydrate brings it back within 1–5 days. In a ward study of men switching from 50 % to 5 % carbohydrate at the same energy, there was a rapid extra loss of 1.6 ± 0.2 kg, while fat loss over the first 15 days was only 0.2 ± 0.1 kg. Muscle glycogen can be refilled to its maximum within 24 h at about 10 g/kg/day of carbohydrate.',
      howModelled:
        'The glycogen pools come from the carbohydrate module. The mass change from glycogen is (1 + h) times the glycogen change, about four times. Carbohydrate re-entry restores it quickly at high intakes.',
      equation:
        'ΔW_gw = h · ΔG\nTotal labile mass change from glycogen = (1 + h) · ΔG ≈ 4 · ΔG\nConversion: 1 mmol glucosyl = 0.162 g',
      keyNumbers: [
        {
          label: 'Loss of glycogen and its water on cutting carbohydrate',
          value: '−0.3 to −0.5 kg glycogen → −1.2 to −2.0 kg scale weight (× (1 + h), h ≈ 3)',
          note: 'Liver glycogen empties in about 1–2 days, muscle in 2–5 days. Refill takes 24 h or less at about 10 g/kg/d, or 2–4 days at moderate intake.',
          referenceIds: ['kreitzman1992', 'hall2016', 'bussau2002', 'rothman1991'],
        },
        {
          label: '17 men in a ward, 50 % → 5 % carbohydrate at the same energy',
          value:
            'Rapid extra loss 1.6 ± 0.2 kg; fat −0.2 ± 0.1 kg over days 1–15 vs −0.5 ± 0.1 kg over the last 15 days of baseline; urinary nitrogen +1.5 g/d early',
          note: 'With a glycogen change of about −300 g, (1 + h) × ΔG ≈ −1.2 kg; the remaining ~0.4 kg is carbohydrate-sensitive body water.',
          referenceIds: ['hall2016'],
        },
        {
          label: 'Muscle glycogen after 1 day at 10 g carbohydrate/kg/d',
          value: '95 → 180 mmol/kg wet muscle (15.4 → 29.2 g/kg); no further gain on days 2–3',
          referenceIds: ['bussau2002'],
        },
        {
          label: 'Depletion, then 3 high-carbohydrate days (with a 5-day depletion-taper exercise sequence)',
          value:
            '3 d at 15 % then 3 d at 70 % carbohydrate → 207 mmol/kg wet weight; 3 d at 50 % then 3 d at 70 % → 203; 6 d at 50 % → 159',
          note: 'The high-carbohydrate days, not the low-carbohydrate phase, drive the overshoot (about +30 % over a moderate diet). Performance in a 20.9-km run did not improve.',
          referenceIds: ['sherman1981'],
        },
        {
          label: '72 h at 12 g/kg/d after depletion',
          value: '72.7 → 169.4 mmol/kg wet weight; total body water (D₂O) 39.3 → 40.2 kg',
          referenceIds: ['shiose2016'],
        },
        {
          label: '6 → 10 g/kg/d for 72 h without exercise',
          value: 'Glycogen +23 %; body mass, fat-free mass and water increased',
          referenceIds: ['kojima2025'],
        },
        {
          label: 'Whole-body check',
          value:
            'Capacity ≈ 0.029 kg per kg muscle → ~0.85 kg for 30 kg of muscle; typical mixed-diet store ≈ 0.45–0.5 kg',
          note: 'Derived from the 1-day loading study.',
          referenceIds: ['bussau2002'],
        },
        {
          label: 'Liver glycogen in a fast',
          value:
            'Net glycogen release supplies 36 % of glucose output over the first 22 h, 18 % over the next 14 h and ~4 % thereafter',
          referenceIds: ['rothman1991'],
        },
        {
          label: 'Rebound on going back to carbohydrate',
          value: '+1 to +3 kg over 1–5 days',
          note: 'DXA lean +4.8 % in 1 week after a 10-week ketone-raising diet; a diet break gave +0.6 kg body weight and +0.7 kg fat-free mass.',
          referenceIds: ['wilson2020', 'peos2021b', 'shiose2016'],
        },
        {
          label: 'Glycogen supercompensation',
          value: 'Muscle 95 → 180 mmol/kg wet weight in 24 h; plateau by 24–72 h; total body water +0.9 kg',
          referenceIds: ['bussau2002', 'sherman1981', 'shiose2016'],
        },
      ],
      timeCourse:
        'Hours to start. Liver glycogen empties in about 1–2 days and muscle in 2–5 days. The scale rebounds within 1–5 days of carbohydrate returning.',
      moderators:
        'Carbohydrate intake, muscle mass (the store is bigger with more muscle), and training that empties the worked muscles.',
      grade: 'B',
      gradeReason:
        "Several controlled human studies agree on the water ratio and refill speed (graded A/B in Vitals' evidence review).",
      status: 'established',
      caveats:
        'Glycogen dynamics themselves belong to the carbohydrate module; this article covers how they show up on the scale.',
      referenceIds: [
        'kreitzman1992',
        'hall2016',
        'bussau2002',
        'sherman1981',
        'shiose2016',
        'kojima2025',
        'rothman1991',
        'wilson2020',
        'peos2021b',
      ],
      relatedMetricIds: ['glycogenWater', 'scaleWeight', 'glycogenTotal'],
    },
    {
      id: '13-carb-sensitive-natriuresis',
      title: 'Salt and water lost when carbohydrate falls',
      category: 'body',
      summary:
        'Low insulin, fasting and carbohydrate restriction make the kidneys excrete sodium, and body water follows. Early fasting weight loss averaged 0.9 kg a day in the first week and was described as mainly due to negative sodium balance. Adding carbohydrate reverses this abruptly, at about +70 mEq of sodium and 0.5 L of water a day.',
      howModelled:
        'A body-water term moves towards a target set by carbohydrate intake: zero above about 100 g a day, down to −0.6 L at none, and deeper when energy intake is almost zero. It falls with a 1.5-day time constant and recovers with 0.7 days.',
      equation:
        'E*_cna = −E_max · max(0, 1 − C / C_ref) · (1 + k_fast · I[EI < 0.1 · TDEE])\ndE_cna/dt = (E*_cna − E_cna) / τ, with τ = τ_down if E* < E_cna, else τ_up',
      keyNumbers: [
        {
          label: 'C_ref, carbohydrate at which the effect vanishes',
          value: '100 g/d (range 50–150)',
          note: 'Proposed. Natriuresis is evident on ketone-raising or fasting states and absent on mixed diets.',
          referenceIds: ['yang1976', 'hall2016', 'kerndt1982'],
        },
        {
          label: 'E_max',
          value: '0.6 L (range 0.3–1.0)',
          note: 'Fitted: the residual after glycogen in the ward study was about 0.4 L. Water loss on the ketone-raising diet exceeded that on the mixed diet by ≈ 1.8 kg over 10 days, of which ≈ 1.2–1.4 kg was glycogen-linked.',
          referenceIds: ['hall2016', 'yang1976'],
        },
        {
          label: 'k_fast',
          value: '0.5 (range 0–1)',
          note: 'Fasting adds natriuresis beyond carbohydrate restriction.',
          referenceIds: ['heyman2020', 'kerndt1982'],
        },
        {
          label: 'τ_down / τ_up',
          value: '1.5 d (1–3) / 0.7 d (0.3–1.5)',
          note: 'Peak natriuresis within the first days of fasting; abrupt reversal following glucose.',
          referenceIds: ['heyman2020', 'kerndt1982'],
        },
        {
          label: 'Fasting patient',
          value:
            'Peak natriuresis 68 mEq/d with −0.9 L fluid and −0.9 kg; moving from a 24-h fast to meals adds ~70 mEq/d sodium uptake ≈ +0.5 L/d',
          referenceIds: ['heyman2020'],
        },
        {
          label: 'Early fasting weight loss',
          value: '≈ 0.9 kg/d in week 1, slowing to ≈ 0.3 kg/d by week 3',
          note: 'Described as primarily due to negative sodium balance.',
          referenceIds: ['kerndt1982'],
        },
        {
          label: '800 kcal ketone-raising vs mixed diet, water lost per day over 10 days',
          value: '61.2 % of 466.6 g/d (= 286 g/d) vs 37.1 % of 277.9 g/d (= 103 g/d)',
          referenceIds: ['yang1976'],
        },
      ],
      timeCourse:
        'Onset within 12–24 h, with a time constant of about 1.5 days. Reversal on carbohydrate takes about 0.7 days.',
      moderators: 'Carbohydrate intake and fasting. Sex and age moderators are unknown.',
      grade: 'C',
      gradeReason:
        'The mechanism is well established, but the lumped size and time constants are fitted to few human data points.',
      status: 'proposed-fit',
      caveats: 'The size and time constants rest on very few quantitative human data.',
      referenceIds: ['yang1976', 'hall2016', 'kerndt1982', 'heyman2020'],
      relatedMetricIds: ['ecfShift', 'scaleWeight'],
    },
    {
      id: '13-sodium-steps',
      title: 'Salt intake steps and body water',
      category: 'body',
      summary:
        'A step up in salt intake is excreted with a lag, so body sodium and water rise briefly. At a new steady state total body water is not measurably higher: going from 50 to 550 mmol/day of sodium raised plasma volume by 315 mL but not total body water or body mass. A +100 mmol/day step (about +2.3 g sodium) gives a peak of about +0.4–0.5 kg on days 1–3, gone by about 2 weeks.',
      howModelled:
        "Retained sodium builds with the gap between today's intake and the habitual level the kidney has adapted to, and drains over a day or two: the engine uses the hydration and substances topic's slightly slower 1.5-day time constant rather than 1 day. The habitual level drifts towards intake over 5 days, but only halfway, following that topic's partial-habituation rule, so a lasting rise in salt keeps some extra water. Each 140 mmol of retained sodium counts as 1 L of water.",
      equation:
        'dS_na/dt = (Na_in − Na_hab) − S_na / τ_Na  (mmol/d)\ndNa_hab/dt = (Na_in − Na_hab) / τ_hab\nwater_salt = S_na / 140  (L)',
      keyNumbers: [
        { label: 'τ_Na', value: '1.0 d (range 0.5–2)', note: 'Proposed: renal escape within days.' },
        {
          label: 'τ_hab',
          value: '5 d (range 3–10)',
          note: 'Proposed. It forces body water back to baseline at steady state.',
        },
        {
          label: 'NaCl 50 → 550 mmol/d at steady state',
          value: 'Plasma volume +315 mL; total body water and body mass unchanged',
          referenceIds: ['heer2000'],
        },
        {
          label: '+100 mmol/d step (≈ +2.3 g Na, ≈ +5.8 g salt)',
          value: 'Peak ≈ +50–70 mmol → +0.4–0.5 kg on days 1–3, gone by ~2 weeks',
        },
        {
          label: 'Sodium excretion at constant intake',
          value: 'A ~7-day rhythm',
          referenceIds: ['birukov2016'],
        },
      ],
      timeCourse: 'Peak on days 1–3, with a time constant of about 1 day and habituation over about 5 days.',
      moderators: "Size of the change in intake and the person's habitual intake.",
      grade: 'C',
      gradeReason:
        "The direction is grade B but the parameters are proposed, and Vitals' evidence review rates this C/D; the grade shown here, C, reflects indirect human data.",
      status: 'proposed-fit',
      caveats:
        'The time constants are proposed. Steady-state high salt did not raise total body water, so the effect is transient only.',
      referenceIds: ['heer2000', 'birukov2016'],
      relatedMetricIds: ['ecfShift', 'scaleWeight'],
    },
    {
      id: '13-gut-content-mass',
      title: 'Gut content and the morning weigh-in',
      category: 'body',
      summary:
        'Food residue, fibre, bacteria and water in the colon add to morning weight. Food mass and fibre can differ by more than 1 kg a day and about 58 g a day between eating patterns, so moving from a zero-fibre to a high-fibre pattern, or starting a fast, moves the scale independently of tissue. For a woman, going from 0 to 40 g of fibre raises gut content from about 0.25 to about 0.85 kg (about 0.6–0.8 kg allowing for faster transit).',
      howModelled:
        'Gut content moves towards a target based on stool mass and transit time. Stool mass is a base value plus 5 g per gram of non-starch polysaccharide (fibre). It fills at half the transit time and empties with a 1.5-day time constant when intake is near zero.',
      equation:
        'M_gut*(t) = (S_0 + 5 · NSP_g) · T_tr / 1000  (kg, morning post-void weigh-in)\ndM_gut/dt = (M_gut* − M_gut) / τ_gut, with τ_gut = T_tr/2 when filling and τ_empty = 1.5 d when EI ≈ 0',
      keyNumbers: [
        {
          label: 'S_0, stool on a low-fibre white-bread diet',
          value: 'Men 162 g/d, women 83 g/d (SE ±11)',
          referenceIds: ['stephen1986'],
        },
        { label: 'Stool per gram of fibre', value: '5 g per g of NSP', referenceIds: ['stephen1986'] },
        {
          label: 'T_tr, transit time',
          value: '2.0 d (men), 3.0 d (women); range 1.5–3.5',
          note: '48.6 h in non-methane producers vs 84.6 h in methane producers; the sex difference was explained by transit.',
          referenceIds: ['stephen1986'],
        },
        {
          label: 'Fasted colon volume',
          value: '≈ 0.56 L (203, 198 and 160 mL by segment)',
          referenceIds: ['pritchard2014'],
        },
        {
          label: 'Difference between eating patterns',
          value: 'Food mass 1,296 ± 215 g/d and fibre 58 ± 6 g/d in the first 2 weeks',
          referenceIds: ['sciarrillo2024'],
        },
        {
          label: 'Size of the effect',
          value: '±0.2–0.7 kg, with a time constant of ≈ 1–1.5 d',
        },
      ],
      timeCourse: 'Onset in 1–2 days, with a time constant of about 1–1.5 days. The change is symmetric.',
      moderators: 'Fibre intake, food mass, fasting and sex (through transit time).',
      grade: 'C',
      gradeReason: 'The size comes from a proposed fit to stool-mass data from a single fibre study.',
      status: 'proposed-fit',
      caveats:
        'The model uses data from one wheat-fibre study, and morning gut mass after meat-only versus plant-heavy patterns has not been measured directly.',
      referenceIds: ['stephen1986', 'pritchard2014', 'sciarrillo2024'],
      relatedMetricIds: ['gutContent', 'scaleWeight'],
    },
    {
      id: '13-exercise-menstrual-water',
      title: 'Exercise, the menstrual cycle and other short-term water shifts',
      category: 'body',
      summary:
        'One hard interval session expanded plasma volume by 4.5 ± 0.7 mL/kg (about 10 %) at 24 h. Women report fluid retention that peaks on day 1 of menses and rises over the ~11 days around ovulation, but objective studies found no significant change in body weight or total body water across the cycle. Claims that dieting cortisol causes hidden water retention have no quantitative human data, so Vitals does not model them.',
      howModelled:
        'Each hard session adds +4.5 mL/kg of plasma volume that decays with a 2-day time constant. Eccentric-damage swelling (0.1–0.3 kg) is not modelled. The menstrual term applies only when cycle tracking is on and is small: 0.2 kg (range 0–0.5), peaking on day 1 of flow. Weekly and holiday rhythms are not simulated.',
      keyNumbers: [
        {
          label: 'Session of 8 × 4 min at 85 % VO₂max',
          value: 'Plasma volume +4.5 ± 0.7 mL/kg (10 %) at 24 h',
          note: 'Proposed decay time constant 2 d. Training-induced plasma expansion occurs “immediately”, red-cell expansion over weeks.',
          referenceIds: ['gillen1991', 'sawka2000', 'convertino2007'],
        },
        {
          label: 'Eccentric-damage limb swelling',
          value: 'Peaks at 48–72 h (thigh circumference +6.6 mm on day 3)',
          note: 'The whole-body mass effect is not quantified; optional 0.1–0.3 kg, grade D.',
          referenceIds: ['lin2025'],
        },
        {
          label: 'Self-reported fluid retention over the cycle (765 cycles)',
          value: 'Peaks on day 1 of menses and rises over the ~11 days around ovulation',
          referenceIds: ['white2011'],
        },
        {
          label: 'Objective studies',
          value:
            'No significant change in body weight or total body water across phases; no luteal renal sodium retention',
          note: 'Ovarian hormones shift osmoregulation with only a minor effect on total body water.',
          referenceIds: ['takano2026', 'bisson1992', 'stachenfeld2008'],
        },
        {
          label: 'Default menstrual amplitude',
          value: '0.2 kg (range 0–0.5), peak day 1 of flow',
          note: 'Unverified; grade D.',
        },
      ],
      timeCourse:
        'Exercise plasma volume: hours to peak, time constant about 2 days. Menstrual term: a cycle of about 28 days.',
      moderators: 'Exercise intensity and cycle day.',
      grade: 'C',
      gradeReason:
        'The exercise plasma-volume effect is grade B, while the menstrual effect is C/D and the cortisol-water idea is D.',
      status: 'proposed-fit',
      caveats:
        'Self-reported and objective menstrual findings disagree. The widely claimed cortisol-driven water retention has no quantitative human data, so it is not modelled (grade D).',
      referenceIds: [
        'gillen1991',
        'sawka2000',
        'convertino2007',
        'lin2025',
        'white2011',
        'takano2026',
        'bisson1992',
        'stachenfeld2008',
      ],
      relatedMetricIds: ['waterWeight', 'scaleWeight'],
    },
    {
      id: '13-early-weight-loss-energy-density',
      title: 'Early weight loss is mostly not fat',
      category: 'body',
      summary:
        'Early weight loss is rich in water and glycogen, so its energy content is low and rises over about 4–6 weeks. In a metabolic study of six obese adults on 800 kcal/day, a ketone-raising version lost 466.6 ± 51.3 g/day and a mixed version 277.9 ± 32.1 g/day, yet fat loss was the same (about 163 vs 165 g/day). The energy content of weight lost rose from 4,858 ± 388 kcal/kg at week 4 to 6,041 ± 376 at week 6.',
      howModelled:
        'Fat change always comes from the body-weight (energy-balance) model. This module only adds the water and glycogen terms, so the interface can say, for example, that of 2.4 kg lost this week about 0.5 kg is fat.',
      keyNumbers: [
        {
          label: '800 kcal ketone-raising diet, 10 days (6 obese adults)',
          value: '466.6 ± 51.3 g/d lost: water 61.2 %, fat 35.0 %, protein 3.8 %',
          referenceIds: ['yang1976'],
        },
        {
          label: '800 kcal mixed diet, 10 days',
          value: '277.9 ± 32.1 g/d lost: water 37.1 %, fat 59.5 %, protein 3.4 %',
          referenceIds: ['yang1976'],
        },
        {
          label: 'Derived, ketone-raising vs mixed',
          value: 'Fat loss 163 vs 165 g/d (identical); protein 17.7 vs 9.4 g/d; water 286 vs 103 g/d',
          referenceIds: ['yang1976'],
        },
        {
          label: 'Energy content of weight lost',
          value:
            '4,858 ± 388 kcal/kg at week 4 → 6,041 ± 376 at week 6, stable thereafter; women 6,804 vs men 6,119 kcal/kg',
          note: 'In a Kiel cohort.',
          referenceIds: ['heymsfield2012'],
        },
        {
          label: 'Energy per kg lost',
          value: 'Depends on initial fat and the size of the loss',
          referenceIds: ['hall2008'],
        },
      ],
      timeCourse: 'Energy density of the weight lost rises over about 4–6 weeks.',
      moderators: 'Initial fat mass, sex and the size of loss.',
      grade: 'B',
      gradeReason: "Vitals' evidence review rates this A/B: controlled human data agree.",
      status: 'established',
      caveats: 'The fat change itself is computed elsewhere from energy balance.',
      referenceIds: ['yang1976', 'heymsfield2012', 'hall2008'],
      relatedMetricIds: ['scaleWeight', 'waterWeight', 'leanMass'],
    },
    {
      id: '13-carb-tolerance-adaptation',
      title: 'Glucose tolerance after cutting carbohydrate',
      category: 'fuel',
      summary:
        "Cutting carbohydrate lowers the muscle's ability to take up and burn glucose, and lowers first-phase insulin release. When carbohydrate returns, glucose spikes are exaggerated until the machinery re-adapts. There are two time scales, days and weeks. After 14–15 weeks of a very-low-carbohydrate diet, the 2-hour glucose in an oral glucose tolerance test (OGTT) was 8.1–8.7 mmol/L, and after switching to a high-carbohydrate diet it kept falling by 0.07–0.10 mmol/L a week over weeks 2–9. So a glucose test can over-read for weeks.",
      howModelled:
        "The engine runs this through the carbohydrate topic's tolerance model, which has the same two-speed structure: a fast state (time constant about 2–2.5 days) and a slow state (28 days, taken from this topic) move towards a target set by the average carbohydrate of the last three days. Their gaps add up to a predicted shift in 2-hour glucose and in the rise after a carbohydrate meal. The interface flags that a glucose test is not representative while the gaps remain.",
      equation:
        'A*(C) = min(1, [C / (C + K_A)] / [C_ref / (C_ref + K_A)]), C = mean carbohydrate g/d over the last 24 h\ndA_f/dt = (A* − A_f) / τ_f; dA_s/dt = (A* − A_s) / τ_s\nΔG_2h = a_f · (1 − A_f) + a_s · (1 − A_s)  (mmol/L)\nΔiAUC_meal_rel = b_f · (1 − A_f) + b_s · (1 − A_s)',
      keyNumbers: [
        {
          label: 'K_A / C_ref',
          value: '100 g/d (range 50–150) / 250 g/d',
          note: 'Proposed: impairment already at about 30 % of energy from carbohydrate.',
          referenceIds: ['numao2012', 'goedecke1999'],
        },
        {
          label: 'τ_f / τ_s',
          value: '2 d (1–3) / 28 d (21–42)',
          note: 'Fast: 3 d in one study, 5 d in another, and a 5–6 d washout in a third. Slow: change-point about 5 weeks with a decline continuing to week 9.',
          referenceIds: ['numao2012', 'goedecke1999', 'burke2021', 'jansen2022'],
        },
        {
          label: 'a_f / a_s',
          value: '1.0 mmol/L (unverified, from iAUC data only) / 1.0 mmol/L (range 0.6–1.2)',
          note: 'The slow value follows a decline of about 0.7–0.8 mmol/L over weeks 2–9. b_f and b_s are 0.3 and 0.3 (unverified).',
          referenceIds: ['jansen2022'],
        },
        {
          label: '3 days of a ~69 %-fat eucaloric diet, healthy young men',
          value: 'OGTT glucose iAUC up and first-phase insulin down',
          note: 'Replicated in two further studies; exercise on the day did not normalise the OGTT.',
          referenceIds: ['numao2012', 'numao2013', 'numao2016'],
        },
        {
          label: '5 days of a 69 %-fat diet, cyclists',
          value: '30-min OGTT glucose up, persisting at days 10 and 15',
          referenceIds: ['goedecke1999'],
        },
        {
          label: 'Isocaloric 4-week ketone-raising diet',
          value: 'Glucose AUC raised to both mixed and ketone-raising test meals',
          referenceIds: ['rosenbaum2019'],
        },
        {
          label: 'After 14–15 weeks of a very-low-carbohydrate diet with 15 % weight loss',
          value:
            '2-h OGTT glucose 8.1–8.7 mmol/L; abnormal (≥ 7.8) in 17 of 25 who then switched to 57 % carbohydrate',
          note: 'On the high-carbohydrate diets 2-h glucose fell 0.07–0.10 mmol/L per week over weeks 2–9 (change-point ≈ 5 weeks), and abnormal OGTTs fell from 17 to 9 of 25. The group staying very-low-carbohydrate stayed 10 of 16 abnormal.',
          referenceIds: ['jansen2022'],
        },
        {
          label: 'The classic “≥ 150 g carbohydrate a day for 3 days before an OGTT”',
          value: 'Holds on ordinary diets, not after months of very-low-carbohydrate intake',
          note: 'In pregnant women on usual diets the preparatory diet made no difference; 150 vs 300 g/d gave equivalent results in another study. The historic basis is an old series of OGTTs after various carbohydrate intakes.',
          referenceIds: ['wilkerson1960', 'crowe2000', 'hughes1975', 'jansen2022'],
        },
        {
          label: 'Some ketone-raising-diet changes at week 4 (fasting glucose, ApoB, CRP)',
          value: 'No longer apparent at week 12 despite sustained ketosis',
          referenceIds: ['hengist2024'],
        },
        {
          label: 'Readiness flags',
          value:
            'Test not representative while (1 − A_f) > 0.1 or (1 − A_s) > 0.2; ready when both gaps are below those',
        },
      ],
      timeCourse:
        'The fast component normalises in about 3–7 days of at least 150–250 g/d of carbohydrate. The slow component has a change-point near 5 weeks, and about half was normalised at 10 weeks.',
      moderators:
        'Days and months of carbohydrate restriction; weight loss and energy balance (carbohydrate module). Exercise on the day does not normalise the test.',
      grade: 'B',
      gradeReason: 'The direction and the two time scales are grade B, and the magnitudes are C.',
      status: 'proposed-fit',
      caveats:
        'The slow component is fitted to one trial in weight-reduced adults, and whether 1–2 weeks of restriction already loads it is unknown. The size of the fast component is unverified (iAUC data only).',
      referenceIds: [
        'numao2012',
        'numao2013',
        'numao2016',
        'goedecke1999',
        'rosenbaum2019',
        'jansen2022',
        'wilkerson1960',
        'crowe2000',
        'hughes1975',
        'hengist2024',
        'burke2021',
      ],
      relatedMetricIds: ['glucose'],
    },
    {
      id: '13-fat-adaptation-washout',
      title: 'Fat adaptation: gain and loss',
      category: 'fuel',
      summary:
        'Eating very little carbohydrate and a lot of fat raises fat burning during exercise and lowers carbohydrate burning within about 5 days, and reversal takes a similar time. In elite race walkers, 5–6 days on under 50 g/day of carbohydrate raised exercise fat oxidation by more than 200 %, to about 1.43 g/min, and cost 5–8 % more oxygen at race pace. One day of high carbohydrate did not restore it: carbohydrate burning reached only 61–78 % of earlier values. High-intensity performance was impaired while adapted.',
      howModelled:
        "Not modelled as a separate index. Vitals uses the ketosis topic's fast adaptation state instead: it follows the carbohydrate absorbed over the last 24 hours, rising over about two days and fading over a similar time. That state shifts exercise fuel towards fat, cuts the muscle glycogen used during exercise and raises the oxygen cost of hard exercise by up to 6.5 % (the performance topic's figure). This topic's own index (1.7-day on and 2.0-day off time constants, fat oxidation up by 1.2 times the index, maximal carbohydrate oxidation down by 30 %) is not used.",
      equation:
        'F*_carb = clamp((5.0 − C_kg) / (5.0 − 0.7), 0, 1), C_kg = carbohydrate g/kg/d\nF*_fat = clamp((fat%E − 30) / (65 − 30), 0, 1)\nF* = min(F*_carb, F*_fat)\ndF_ad/dt = (F* − F_ad) / τ, τ_on = 1.7 d, τ_off = 2.0 d\nFatOx_ex = FatOx_ex,0 · (1 + k_fo · F_ad), k_fo = 1.2\nCHOox_max = CHOox_max,0 · (1 − 0.3 · F_ad)\nO2cost_race = O2cost_0 · (1 + 0.065 · F_ad)',
      keyNumbers: [
        {
          label: '13 world-class race walkers, 5–6 d of < 50 g/d carbohydrate, 2.2 g/kg protein, 80 % fat',
          value:
            'Exercise fat oxidation > 200 % higher, to ~1.43 g/min; oxygen cost +8 % (50-km pace) and +5 % (20-km pace)',
          note: 'After 24 h of high carbohydrate plus 2 g/kg before the race, carbohydrate oxidation reached only 61 % and 78 % of prior values, and 6 of 7 low-carbohydrate athletes were slower (2.2 ± 3.4 %) while all high-carbohydrate athletes improved (5.7 ± 5.6 %). Substrate use returned to baseline after 5–6 days of a high-carbohydrate diet.',
          referenceIds: ['burke2021'],
        },
        {
          label: '25 days of low-carbohydrate, high-fat eating',
          value: 'Fat oxidation 0.6 → 1.3 g/min; 10-km race −2.3 % vs +4.8 % (high-carbohydrate 8.6 g/kg/d)',
          note: '2.5 weeks of carbohydrate restoration gave no rebound benefit, and it replicated an earlier economy and performance impairment.',
          referenceIds: ['burke2020', 'burke2017'],
        },
        {
          label: '5 days high-fat (4.6 g/kg fat, 67 % of energy) plus 1 day carbohydrate restoration',
          value:
            'Fat oxidation +45 %, carbohydrate oxidation −30 %, PDH activity 1.69 vs 2.39 mmol/kg wet weight/min despite equal glycogen (873 vs 868 mmol/kg dry weight)',
          note: 'Persistence despite restored glycogen was also seen in another study.',
          referenceIds: ['stellingwerff2006', 'burke2002'],
        },
        {
          label: '4 weeks under 20 g carbohydrate, eucaloric',
          value:
            'Endurance at 62–64 % VO₂max preserved (147 → 151 min); RQ 0.83 → 0.72; muscle glycogen use down 4-fold',
          referenceIds: ['phinney1983'],
        },
        {
          label: 'Resting fat-oxidation matching after an isocaloric switch to high fat',
          value: 'Positive fat balance 1.06, 0.75, 0.55 MJ/d on days 1–3; balanced by day 7',
          note: "Glycogen-lowering exercise gave immediate matching, and higher activity sped it. The model's fit gives an imbalance ≈ 1.47·e^(−t/3.0) MJ/d, which should emerge from the glycogen module rather than be a separate state.",
          referenceIds: ['schrauwen1997a', 'schrauwen1997b', 'smith2000'],
        },
        {
          label: 'τ_on / τ_off and k_fo',
          value: '1.7 d / 2.0 d; k_fo 1.2 (range 1.2–2.0)',
          note: 'Proposed fit. Check: after 24 h of carbohydrate restoration the index is ≈ 0.61 and carbohydrate-oxidation capacity ≈ 82 % (observed 61–78 %); after 5–6 days the index is ≈ 0.06.',
          referenceIds: ['burke2021', 'burke2020'],
        },
        {
          label: 'High-intensity performance while fat-adapted',
          value: '−2 to −7 % race performance vs high carbohydrate; submaximal endurance preserved',
          referenceIds: ['burke2021', 'burke2020', 'burke2017', 'phinney1983'],
        },
      ],
      timeCourse:
        'Adaptation builds with a time constant of 1.7 days (plateau by 5–6 days) and is lost with about 2 days, back to baseline after 5–6 days.',
      moderators:
        'Carbohydrate per kg and fat share of energy; glycogen-lowering exercise and higher activity speed resting matching.',
      grade: 'B',
      gradeReason:
        'Several controlled studies agree, but elite male athletes dominate the data and women and untrained people are under-represented.',
      status: 'proposed-fit',
      caveats: 'Data are mostly from elite male athletes. The equations are a proposed fit.',
      referenceIds: [
        'burke2021',
        'burke2020',
        'burke2017',
        'stellingwerff2006',
        'burke2002',
        'phinney1983',
        'schrauwen1997a',
        'schrauwen1997b',
        'smith2000',
      ],
      relatedMetricIds: [],
    },
    {
      id: '13-induction-symptoms',
      title: 'Induction symptoms when carbohydrate drops',
      category: 'performance',
      summary:
        'In the first days of very-low-carbohydrate eating some people get flu-like symptoms (“keto flu”): headache, fatigue, nausea, dizziness, brain fog. In an analysis of 300 forum users, symptoms peaked in the first week and dwindled after 4 weeks, with a median time to resolution of 4.5 days (IQR 3–15). Submaximal endurance was preserved after about 4 weeks, but high-intensity performance is impaired while fat-adapted.',
      howModelled:
        'A symptom intensity rises and falls after carbohydrate drops below 50 g a day, peaking at about 2.5 days. Its size scales with how big the drop in carbohydrate is, and is reduced by 30 % when sodium is at least 2 g a day. A quarter of simulated users get a slower, 6-day profile.',
      equation:
        'Φ_ind(t) = Φ_max · (Δt / τ_p) · exp(1 − Δt / τ_p), Δt = days since carbohydrate fell below 50 g/d\nΦ_max = clamp((C_prev − C_new) / C_prev, 0, 1) · (1 − 0.3 · I[Na ≥ 2 g/d])\nτ_p = 2.5 d; 25 % of simulated users follow τ_p = 6 d',
      keyNumbers: [
        {
          label: '300 forum users',
          value: 'Resolution between days 3 and 30; median 4.5 d (IQR 3–15)',
          note: 'Symptoms peaked in the first week and dwindled after 4 weeks. 101 of 300 reported symptoms, which is not a prevalence.',
          referenceIds: ['bostock2020'],
        },
        {
          label: 'Ketone-raising very-low-energy diet',
          value: 'Hunger up at day 3 and at 5 % weight loss (about day 12) before appetite settled',
          referenceIds: ['nymo2017'],
        },
        {
          label: 'Side-effects of a protein-sparing modified fast',
          value:
            'Headache, fatigue, orthostatic hypotension, cramps, cold intolerance, constipation, diarrhoea, halitosis, menstrual changes, hair thinning',
          note: '“Most transient and may be alleviated by adjusting fluid, salt and supplement intake.”',
          referenceIds: ['chang2014'],
        },
        {
          label: 'Submaximal endurance after ~4 weeks',
          value: 'Preserved',
          referenceIds: ['phinney1983'],
        },
        {
          label: '3 months of an ad libitum ketone-raising diet in lifters',
          value: 'Strength not different from usual diet despite −2.26 kg lean mass and −3.26 kg body mass',
          referenceIds: ['greene2018'],
        },
        {
          label: 'τ_p and sodium mitigation',
          value: '2.5 d (6 d for 25 % of users); −30 % with sodium ≥ 2 g/d',
          note: 'Proposed. The sodium effect is grade D. A carbohydrate refeed re-triggers symptoms in the model, scaled to its depth (grade D, no data).',
        },
      ],
      timeCourse:
        'Onset on days 1–3, peak at about 2–4 days, median resolution 4.5 days, and dwindling by 4 weeks.',
      moderators: 'Size of the drop in carbohydrate, and possibly sodium intake (grade D).',
      grade: 'C',
      gradeReason: 'The evidence is self-reported and clinical description.',
      status: 'proposed-fit',
      caveats:
        'The self-report data come from forum users, so they show how symptoms resolve, not how common they are.',
      referenceIds: ['bostock2020', 'nymo2017', 'chang2014', 'phinney1983', 'greene2018'],
      relatedMetricIds: ['ketoInduction', 'moodTier'],
    },
    {
      id: '13-hormone-transients',
      title: 'Thyroid and leptin at diet switches',
      category: 'hormones',
      summary:
        'Two hormone signals move quickly with a diet switch. T3, the active thyroid hormone, falls with deep deficits and with very little carbohydrate, and returned to baseline within a week of a mixed diet. Leptin, made by fat cells, falls sharply in a fast (−64 % in normal-weight and −72 % in obese people at 52 h) and rises with a few days of carbohydrate overfeeding (+28 %), tracking cumulative energy balance over about 3 days. A 1–2 day carbohydrate refeed raises leptin a little and it decays within about 3 days.',
      howModelled:
        "Vitals uses the hormones topic's models rather than these hooks. T3 keeps this topic's 50 g carbohydrate threshold inside the hormones topic's T3 model, which also responds to the deficit (falling over about 2 days and recovering over about 3). Leptin follows the hormones topic's model of fat mass and recent energy balance, in which extra carbohydrate raises leptin more than extra fat; this topic's 3-day cumulative-balance form is not used.",
      equation:
        'T3_rel* = 1 − 0.5 · (1 − min(1, C/50)) · s_def − (deficit term from the hormones topic); τ_T3 ≈ 4 d\nleptin_rel = f(FM) · exp(k_L · B_cum_CHO)',
      keyNumbers: [
        {
          label: 'Total fast 7–18 days',
          value: 'T3 −53 %, rT3 +58 %',
          note: '800 kcal with no carbohydrate for 2 weeks: T3 −47 % (rT3 unchanged). Isocaloric diets with 50 g or more carbohydrate: no T3 change.',
          referenceIds: ['spaulding1976'],
        },
        {
          label: '28-day very-low-calorie diet, low- vs high-carbohydrate',
          value:
            'T3 −34.6 % vs −17.9 %; T3 and rT3 back to baseline within 1 week on a 1,000 kcal mixed diet',
          referenceIds: ['mathieson1986'],
        },
        {
          label: 'Carbohydrate-for-fat substitution at weight maintenance',
          value: 'Raises T3',
          referenceIds: ['danforth1979'],
        },
        {
          label: '52-h fast',
          value: 'Leptin −64 % (normal weight) and −72 % (obese); prevented by clamping glucose at basal',
          referenceIds: ['boden1996'],
        },
        {
          label: '3 days at 70 % vs 130 % of energy needs',
          value: 'Leptin 88 % vs 135 % of baseline after a eucaloric washout day',
          note: 'Restored only after the complementary period restored cumulative energy balance.',
          referenceIds: ['chinchance2000'],
        },
        {
          label: '3-day carbohydrate overfeeding',
          value: 'Leptin +28 %, 24-h energy expenditure +7 %; fat overfeeding: no change',
          referenceIds: ['dirlewanger2000'],
        },
        {
          label: 'A single day of an 8 %-carbohydrate diet',
          value: 'Lowered leptin vs a low-sugar diet',
          referenceIds: ['hengist2023'],
        },
        {
          label: 'Carbohydrate refeed of 1–2 days',
          value: 'Leptin +~20–30 % transiently, decaying within ~3 days',
          note: 'No durable effect should be modelled.',
          referenceIds: ['dirlewanger2000', 'chinchance2000'],
        },
      ],
      timeCourse:
        'T3 takes about 1–2 weeks to reach its low and returns to baseline within a week of a mixed diet (time constant about 4 days). Leptin integrates about 3 days of cumulative balance. Hormonal recovery after extreme leanness takes 3–5 months.',
      moderators: 'Carbohydrate intake, depth of the deficit and cumulative energy balance.',
      grade: 'B',
      gradeReason: 'The controlled human data are grade B; the hooks are proposed.',
      status: 'proposed-fit',
      caveats:
        'These hooks differ in form from the fuller thyroid and leptin models in the hormones topic. That topic uses a 130 g carbohydrate knee for T3 and follows the majority of studies, while this one treats 50 g or more as protective at 800 kcal.',
      referenceIds: [
        'spaulding1976',
        'mathieson1986',
        'danforth1979',
        'boden1996',
        'chinchance2000',
        'dirlewanger2000',
        'hengist2023',
      ],
      relatedMetricIds: ['t3'],
    },
    {
      id: '13-lipid-transients',
      title: 'Blood fats at diet switches',
      category: 'cardio',
      summary:
        'Entering very-low-carbohydrate, high-fat eating raises LDL cholesterol in many people. Three weeks on under 20 g/day of carbohydrate in normal-weight young adults raised LDL-C from 2.2 to 3.1 mmol/L (+44 % vs control; individual range 5–107 %), with ApoB up and triglycerides unchanged. Lean people with low triglycerides and high HDL were the largest responders. Entering a very-low-fat, sugar-rich pattern raises triglycerides because the liver makes more fat from carbohydrate.',
      howModelled:
        "Hooks into the lipids topic. The LDL change follows the lipids-topic target with a 7–10 day time constant, reaching a plateau by about 3 weeks. Triglycerides follow the lipids topic's own terms for swapping fat for carbohydrate and for sugar and fructose, with that topic's time constant of about 4 days rather than 5–7 days; this topic's rule based on carbohydrate above 55 % of energy is not used. Reversal on the opposite switch is assumed symmetric.",
      equation: 'ΔTG* ∝ max(0, CHO%E − 55) · (sugar share); τ_TG ≈ 5–7 d\nτ_LDL ≈ 7–10 d',
      keyNumbers: [
        {
          label: '3 weeks under 20 g/d carbohydrate, normal-weight young adults',
          value:
            'LDL-C 2.2 → 3.1 mmol/L, +44 % vs control (individual range 5–107 %); ApoB up; triglycerides unchanged',
          referenceIds: ['retterstol2018'],
        },
        {
          label: 'Isocaloric 4-week ketone-raising diet',
          value: 'Total and LDL cholesterol up, triglycerides down, CRP up',
          referenceIds: ['rosenbaum2019'],
        },
        {
          label: '8 %-carbohydrate diet',
          value: 'LDL-C rises detectably within 24 h',
          referenceIds: ['hengist2023'],
        },
        {
          label: '“Lean mass hyper-responders”',
          value: 'Mean LDL-C 272 mg/dL after a mean of 4.7 years',
          note: 'Lean people with low triglycerides and high HDL are the largest responders.',
          referenceIds: ['budoff2024'],
        },
        {
          label: 'Eucaloric 10 %-fat / 75 %-carbohydrate, sugar-rich diets',
          value:
            'Liver fat synthesis (de novo lipogenesis) 37–43 % of VLDL-triglyceride fatty acids vs 6–12 % on 30 % fat; fasting and 24-h triglycerides rise in proportion',
          note: 'VLDL enrichment was evident by day 10.',
          referenceIds: ['hudgins1996', 'hudgins2000'],
        },
        {
          label: 'Carbohydrate reintroduction after a 10-week ketone-raising diet',
          value: 'Triglycerides up within 1 week',
          referenceIds: ['wilson2020'],
        },
        {
          label: 'Is carbohydrate-induced high triglyceride transient?',
          value: 'Unresolved',
          referenceIds: ['parks2000'],
        },
      ],
      timeCourse:
        'LDL-C is detectable within 24 h and reaches a plateau by about 3 weeks. Triglycerides rise over days to 1–2 weeks.',
      moderators: 'Leanness, baseline triglycerides and HDL, and sugar share of carbohydrate.',
      grade: 'B',
      gradeReason: "Vitals' evidence review rates the lipid transients B, from controlled human studies.",
      status: 'proposed-fit',
      caveats:
        'Symmetric reversal on carbohydrate re-entry is assumed and unverified. The size of the triglyceride response comes from the lipids topic and is unverified here.',
      referenceIds: [
        'retterstol2018',
        'rosenbaum2019',
        'hengist2023',
        'budoff2024',
        'hudgins1996',
        'hudgins2000',
        'wilson2020',
        'parks2000',
      ],
      relatedMetricIds: ['ldl', 'triglycerides'],
    },
    {
      id: '13-appetite-gut-carryover',
      title: 'Appetite, gut capacity and diet order',
      category: 'energy',
      summary:
        'How much people eat freely depends on food weight and energy density as well as macronutrients. In an inpatient crossover with two weeks on each diet, a very-low-fat, high-carbohydrate diet (~1 kcal/g) led to 689 ± 73 kcal/day lower intake than a very-low-carbohydrate, high-fat diet (~2 kcal/g). The order of diets mattered: people who ate more food mass and fibre in weeks 1–2 ate more in weeks 3–4, which suggests the gut adapts to a capacity. The gut microbial community shifted within 1 day of a diet change.',
      howModelled:
        'Not modelled: Vitals always simulates the intake you enter and has no free-eating mode, so gut adaptation to food mass does not change intake, and no microbiome index is shown. The Planner does raise fibre gradually, limiting increases to about 5–10 g a day per week (expert opinion, grade D).',
      equation: 'dU_food/dt = (FoodMass − U_food) / 7 d',
      keyNumbers: [
        {
          label: 'Inpatient crossover, 2 weeks each: very-low-fat vs very-low-carbohydrate',
          value:
            '689 ± 73 kcal/d lower intake on the very-low-fat diet (10 % fat, 75 % carbohydrate, ~1 kcal/g vs 75.8 % fat, 10 % carbohydrate, ~2 kcal/g)',
          referenceIds: ['hall2021'],
        },
        {
          label: 'Diet order (28 days, no washout)',
          value:
            'Low-carbohydrate first lost 2.9 ± 1.1 kg more weight and 1.5 ± 0.6 kg more fat than low-fat first',
          note: 'Intake differed by −1,610 ± 312 kcal/d only in the last 2 weeks. In the first 2 weeks food mass differed by 1,296 ± 215 g/d and fibre by 58 ± 6 g/d. The low-carbohydrate-first group lost −2.2 ± 0.7 kg in weeks 1–2, of which fat-free mass −1.9 ± 0.5 and fat −0.2 ± 0.4 kg.',
          referenceIds: ['sciarrillo2024'],
        },
        {
          label: 'Ketone-raising very-low-energy diet',
          value:
            'Hunger up on days 1–~12, then not up while ketotic to 17 % weight loss; rises after refeeding',
          note: 'Ketones fell from 0.48 to 0.19 mmol/L after 2 weeks of food reintroduction, with ghrelin and appetite up. A meta-analysis found a small but significant hunger reduction in ketosis.',
          referenceIds: ['nymo2017', 'sumithran2013', 'gibson2015'],
        },
        {
          label: '36-h fast (~12 MJ deficit)',
          value: 'Next-day free intake 12.2 vs 10.2 MJ, only ≈ 17 % compensation',
          referenceIds: ['johnstone2002'],
        },
        {
          label: '5-day animal-only vs plant-only diets',
          value:
            'Gut microbial community shifted within 1 day of the diet reaching the gut and reverted 2 days after the animal diet ended',
          note: 'Composition changed within 24 h but the enterotype stayed stable over 10 days.',
          referenceIds: ['david2014', 'wu2011'],
        },
      ],
      timeCourse:
        'Gut adaptation takes about 1–2 weeks. Microbial composition shifts within about a day and reverts in about 2 days.',
      moderators: 'Food weight, fibre and energy density of the new pattern; diet order.',
      grade: 'B',
      gradeReason:
        'The inpatient randomised trials are grade B, while the gut-capacity carry-over mechanism is C.',
      status: 'proposed-fit',
      caveats:
        'The carry-over mechanism is proposed from one study, and the gut-mass model would be used only in a free-eating mode, which Vitals does not have.',
      referenceIds: [
        'hall2021',
        'sciarrillo2024',
        'nymo2017',
        'sumithran2013',
        'gibson2015',
        'johnstone2002',
        'david2014',
        'wu2011',
      ],
      relatedMetricIds: [],
    },
    {
      id: '13-gallstone-risk',
      title: 'Gallstone risk in very-low-fat and rapid weight loss',
      category: 'cardio',
      summary:
        'Rapid weight loss makes bile more cholesterol-rich, and meals with under about 10 g of fat fail to empty the gallbladder. In one trial, 520 kcal with under 2 g of fat a day led to gallstones in 4 of 6 people, against 0 of 7 on 900 kcal with 30 g of fat including one 10 g-fat meal. Symptomatic gallstones were 152 vs 44 per 10,000 person-years for a 500 kcal diet vs a 1,200–1,500 kcal diet (HR 3.4, 1.8–6.3).',
      howModelled:
        "The engine has no gallstone-risk multiplier. The safety topic's warnings cover the same ground: loss above 1.5 kg a week, low average fat, fat under 10 g a day for a week, and large cumulative loss. The Planner keeps at least one meal a day with 10 g of fat or more whenever the deficit is 20 % or larger, rather than when expected loss is above 1.0 kg a week.",
      equation:
        'GB_risk = 1 · (1 + 1.5 · I[rate > 1.5 kg/wk, after week 2]) · (1 + 1.5 · I[max meal fat < 10 g]) · (1 + 1.0 · I[cumulative loss > 20 %]), capped at 6',
      keyNumbers: [
        {
          label: 'Gallbladder emptying threshold',
          value: '10 g of fat in a meal',
          referenceIds: ['festi2000'],
        },
        {
          label: '520 kcal with < 2 g fat/d vs 900 kcal with 30 g fat/d (one 10 g-fat meal); both lost 22 %',
          value: 'Gallbladder emptying 35 % vs maximal (66 %); gallstones 4/6 vs 0/7',
          note: 'The trial was stopped.',
          referenceIds: ['gebhard1996'],
        },
        {
          label: '8–16 weeks of low-calorie diet',
          value: 'New gallstones in 10–12 %',
          note: 'Risk factors: loss over 24 % of initial weight, rate over 1.5 kg/week, a very-low-calorie diet with no fat, a long overnight fast, and high triglycerides. Ursodeoxycholic acid was protective.',
          referenceIds: ['erlinger2000'],
        },
        {
          label: '3 months of 500 kcal vs 1,200–1,500 kcal (3,320 matched pairs)',
          value: 'Symptomatic gallstones 152 vs 44 per 10,000 person-years; HR 3.4 (1.8–6.3); NNH 92',
          note: 'One-year weight −11.1 vs −8.1 kg.',
          referenceIds: ['johansson2014'],
        },
        {
          label: 'Protein-sparing modified fast',
          value: 'Fat from protein foods (45–70 g/d) is considered enough for gallbladder contraction',
          referenceIds: ['chang2014'],
        },
      ],
      timeCourse:
        'Risk builds over weeks with the rate and percentage of loss, and falls after weight stabilises.',
      moderators: 'Rate of loss, cumulative loss, fat per meal, triglycerides, and long overnight fasting.',
      grade: 'B',
      gradeReason: 'The risk factors are grade B from trials and cohorts; the form of the multiplier is C.',
      status: 'proposed-fit',
      caveats: "The multiplier's form is proposed. Baseline absolute risk comes from the safety topic.",
      referenceIds: ['festi2000', 'gebhard1996', 'erlinger2000', 'johansson2014', 'chang2014'],
      relatedMetricIds: [],
    },
    {
      id: '13-nitrogen-balance-vlcd',
      title: 'Protein balance on very-low-energy diets',
      category: 'body',
      summary:
        'On very low energy intakes the body loses nitrogen (protein) early, and how much depends on both protein and carbohydrate intake. At 1.5 g protein per kg of ideal body weight on about 500 kcal, nitrogen balance reached 0 after 3 weeks. At 0.8 g/kg plus 0.7 g/kg of carbohydrate it stayed at −2 g N/day. Carbohydrate and protein each spare protein, and their effects add.',
      howModelled:
        "Not modelled as a nitrogen-balance rule. On very-low-energy diets that contain protein, Vitals uses the same lean-share-of-loss partition as for any deficit, which responds to protein, deficit size, leanness, activity and age. Only when both energy and protein are nearly absent does it switch to the protein topic's very-low-intake rule, and water-only fasts use the extended-fasting model.",
      equation:
        'p = clamp((P_IBW − 0.8) / 0.7, 0, 1); q = clamp(C / 75, 0, 1)\nN_bal(t) [g N/d] = min(0, −2.0 + 2.0 · p + 1.0 · q · (1 − p)) − 1.0 · exp(−t / 10 d)\nlean tissue change [kg/d] ≈ N_bal · 6.25 / 1000 / 0.22',
      keyNumbers: [
        {
          label: '1.3 g protein/kg ideal body weight (3 obese patients with type 2 diabetes)',
          value: 'Nitrogen balance maintained chronically',
          note: 'Insulin was withdrawn after 0–19 days (mean 6.5 d).',
          referenceIds: ['bistrian1976'],
        },
        {
          label: 'Egg-white protein-sparing fast, 1.5 g/kg ideal body weight',
          value:
            'Nitrogen balance improved weekly over 3 weeks; a 1-week total fast was significantly negative; resuming meat gave positive balance',
          referenceIds: ['bistrian1977'],
        },
        {
          label: '500 kcal, 5–8 weeks, 17 obese women',
          value:
            '1.5 g protein/kg IBW: nitrogen balance 0 after 3 weeks; 0.8 g/kg plus 0.7 g/kg carbohydrate: −2 g N/d',
          note: '3-methylhistidine fell 25–30 % after week 1 in both.',
          referenceIds: ['hoffer1984a', 'hoffer1984b'],
        },
        {
          label: '600 kcal/d for 28 days, 48 women',
          value:
            'Carbohydrate 76–86 g vs 10 g/d cut cumulative nitrogen loss from 3,611 to 1,869 mmol (≈ 51 → 26 g N); 50 vs 70 g protein/d: 3,171 vs 2,326 mmol (not significant)',
          note: 'Carbohydrate and protein are independent, additive protein-sparers.',
          referenceIds: ['vazquez1995'],
        },
        {
          label: '600 kcal, 8 g N/d, 4 weeks',
          value: 'Nitrogen balance −50.4 g (ketone-raising) vs −18.8 g (non-ketone-raising)',
          referenceIds: ['vazquez1992'],
        },
        {
          label: 'Fit check against those data',
          value:
            '1.5 g/kg IBW → 0 g N/d (observed 0); 0.8 g/kg + 0.7 g/kg carbohydrate → −1.4 (observed −2.0); 50 g protein, ketone-raising → ≈ −59 g N over 28 d (observed −50.4); non-ketone-raising → ≈ −36 (observed −18.8)',
          note: 'The fit over-predicts losses at low protein plus carbohydrate, which is acceptable as a conservative planner model.',
        },
        {
          label: 'Early nitrogen balance in very-low-calorie diets and fasts',
          value: '≈ −1 to −3 g N/d early; → 0 at 1.5 g/kg IBW after ~3 weeks (time constant ≈ 10 d)',
          note: 'Positive on refeeding or a protein-sparing fast after a deficit.',
          referenceIds: ['bistrian1977', 'hoffer1984a', 'vazquez1995', 'vazquez1992'],
        },
      ],
      timeCourse:
        'Early loss of about 1–3 g N/d fades with a time constant of about 10 days, and reaches zero at 1.5 g/kg IBW after about 3 weeks.',
      moderators: 'Protein per kg of ideal body weight, carbohydrate, and whether ketosis is present.',
      grade: 'B',
      gradeReason:
        'Several controlled metabolic studies agree, though the populations are obese clinical groups.',
      status: 'proposed-fit',
      caveats:
        'The equation is a proposed fit that coordinates with the protein topic. It over-predicts losses at low protein and carbohydrate.',
      referenceIds: [
        'bistrian1976',
        'bistrian1977',
        'hoffer1984a',
        'hoffer1984b',
        'vazquez1995',
        'vazquez1992',
      ],
      relatedMetricIds: [],
    },
    {
      id: '13-psmf-vlcd-outcomes',
      title: 'Protein-sparing modified fasts and very-low-calorie diets',
      category: 'energy',
      summary:
        'Two supervised clinical approaches deliver about 600–900 kcal a day: a protein-sparing modified fast (PSMF: 1.2–1.5 g protein per kg of ideal body weight, under 20–50 g of carbohydrate, no added fat) and a mixed-macronutrient formula diet (about 800–850 kcal a day). Both are effective clinical therapy for obesity, with 1–3 kg a week on a PSMF and, in the DiRECT trial, 46 % remission of type 2 diabetes at 12 months against 4 %. Long-term loss is similar to milder diets. Sudden deaths from arrhythmia occurred with 300–400 kcal a day largely-protein regimens. These are not validated tools in lean trained people.',
      howModelled:
        'Blocks are defined by absolute energy, protein per kg of ideal body weight, carbohydrate and fat, with duration limits, exit ramps and supervision flags. The Planner never proposes them: they can only be simulated, in expert mode, by people with a BMI of 30 or more. Lean users can use the shorter mini-cut block instead.',
      keyNumbers: [
        {
          label: 'PSMF definition',
          value:
            'Protein 1.2–1.5 g/kg IBW of high biological value; carbohydrate < 20 g/d (or < 20–50 g); no added fat (45–70 g/d from protein foods); typically 600–900 kcal/d; ketonuria within 24–72 h',
          referenceIds: ['bistrian1976', 'chang2014'],
        },
        {
          label: 'Formula diet definition',
          value: '≤ 800–850 kcal/d, mixed macronutrients',
          note: 'DiRECT 825–853 kcal/d for 12–20 weeks plus 2–8 weeks of stepped food reintroduction; DROPLET 810 kcal/d for 8 weeks plus 4 weeks of reintroduction.',
          referenceIds: ['lean2018', 'lean2019', 'astbury2018', 'astbury2021'],
        },
        {
          label: 'Cleveland PSMF programme',
          value:
            '1–3 kg/week in the intensive phase (more in weeks 1–2), total 8–40 kg; plateau within 6 months; refeeding over 6–8 weeks; partial regain at 1 year; back to baseline at 5 years',
          note: 'Refeeding: month 1 up to 45 g carbohydrate, month 2 up to 90 g.',
          referenceIds: ['chang2014'],
        },
        {
          label: '668 outpatients (71 % above ideal weight), PSMF 17 ± 12 weeks',
          value:
            '−21 ± 13 kg at nadir; −19 ± 13 kg after 9 ± 17 weeks of maintenance; blood pressure and triglycerides fell',
          note: 'Uric acid +0.4 mg/dL; gout in under 1 %.',
          referenceIds: ['palgi1985'],
        },
        {
          label: 'Cleveland Clinic cohort (1,403 patients, 879 started a PSMF)',
          value:
            '+3 % more weight loss averaged over 5 years (adjusted); no difference by year 4 (1.6 vs 1.3 %)',
          note: 'At least 5 % loss at 1 year 55 % vs 20 %; at 5 years 34 % vs 29 % (not significant).',
          referenceIds: ['pfoh2020'],
        },
        {
          label: 'Very-low-calorie vs low-calorie diets, meta-analysis',
          value:
            'Short-term 16.1 ± 1.6 % vs 9.7 ± 2.4 %; long-term (1 year or more) 6.3 ± 3.2 % vs 5.0 ± 4.0 % (not significant)',
          referenceIds: ['tsai2006'],
        },
        {
          label: 'DiRECT (12 and 24 months)',
          value:
            '12 months: −10.0 vs −1.0 kg, remission 46 % vs 4 %; 24 months: remission 36 % vs 3 %, weight difference −5.4 kg',
          referenceIds: ['lean2018', 'lean2019'],
        },
        {
          label: 'DROPLET (12 months and 3 years)',
          value:
            '12 months: −10.7 vs −3.1 kg (10 % loss or more in 45 % vs 15 %); 3 years: −6.2 vs −2.7 kg, with regain from 6 months to 3 years of +8.9 vs +1.2 kg',
          referenceIds: ['astbury2018', 'astbury2021'],
        },
        {
          label: 'Share of loss that is fat-free mass',
          value: 'Grows with the degree of restriction (r² = 0.31) and is reduced by exercise',
          referenceIds: ['chaston2007'],
        },
        {
          label: 'Resting metabolic rate',
          value:
            '28-day very-low-calorie diet with thrice-weekly exercise: −12.4 % (low-carbohydrate) and −20.8 % (high-carbohydrate), significant from week 3; 10-day near-total fast: BMR −12 %',
          referenceIds: ['mathieson1986', 'laurens2021'],
        },
        {
          label: 'Supervision in the Cleveland protocol',
          value:
            'Baseline history, examination and ECG; dietitian every 2 weeks in month 1, then monthly; physician every 6–8 weeks; metabolic panel and uric acid at baseline, every 2 weeks in month 1, then monthly',
          note: 'Daily: multivitamin/mineral; potassium 16–20 mEq; calcium 1,000–1,200 mg; magnesium 400–500 mg; sodium 1,500–2,000 mg; at least 64 oz (≈ 1.9 L) of fluid. Potassium and magnesium supplements were stopped after week 2 in that protocol.',
          referenceIds: ['chang2014'],
        },
        {
          label: 'Contraindications listed',
          value:
            'BMI < 27; recent heart attack, angina, significant arrhythmia, decompensated heart failure, recent stroke, end-stage renal disease, liver failure, malignancy, major psychiatric illness, pregnancy or lactation, wasting disorders; age < 16 or > 65; type 1 diabetes generally not advised; relative: gallstones, gout',
          referenceIds: ['chang2014'],
        },
        {
          label: 'Historical sudden deaths',
          value:
            '17 sudden arrhythmic deaths after a median of 5 months on ~300–400 kcal/d largely-protein regimens',
          note: 'Independent of supervision type, potassium dose and protein quality. Common factors were marked obesity, prolonged extreme restriction and rapid large loss. QT prolongation was reported.',
          referenceIds: ['sours1981', 'isner1979'],
        },
      ],
      timeCourse:
        'Fast weight loss over 8–20 weeks, then a stepped return to food over 2–8 weeks (formula diets) or 6–8 weeks (PSMF). Regain follows over months to years.',
      moderators: 'BMI, degree of restriction, exercise, and supervision.',
      grade: 'B',
      gradeReason:
        "Trials in people with obesity are strong, but Vitals' evidence review grades the extension to lean trained people C/D.",
      status: 'established',
      caveats:
        'Sudden arrhythmic deaths occurred historically with very low intakes. Formula diets have grade A evidence for remission of type 2 diabetes but PSMF long-term results are similar to milder diets. This is not a validated tool in lean trained people.',
      referenceIds: [
        'bistrian1976',
        'chang2014',
        'lean2018',
        'lean2019',
        'astbury2018',
        'astbury2021',
        'palgi1985',
        'pfoh2020',
        'tsai2006',
        'chaston2007',
        'mathieson1986',
        'laurens2021',
        'sours1981',
        'isner1979',
      ],
      relatedMetricIds: [],
    },
    {
      id: '13-rapid-loss-lean-trained',
      title: 'Short aggressive cuts in lean, trained people',
      category: 'body',
      summary:
        'No controlled trial of a true protein-sparing fast exists in lean trained people. The closest evidence is 2–4 week deficits of about 40 % with high protein. With 2.3 vs 1.0 g protein/kg, lean mass fell −0.3 vs −1.6 kg over 2 weeks. With resistance training plus 2.4 vs 1.2 g/kg protein, lean mass rose 1.2 kg vs 0.1 kg over 4 weeks. Athletes with 10 % body fat or more preserved lean mass; those below did not reliably.',
      howModelled:
        'A mini-cut block: energy 55–70 % of maintenance, bounded by the maximal-deficit cap, protein 2.3–2.4 g/kg body weight, carbohydrate at least 2 g/kg on training days, fat 0.5–0.8 g/kg with at least 10 g in one meal, and resistance training at least 3 sessions a week. It lasts 2–4 weeks, followed by at least 4 weeks at maintenance. It is for men with body fat 10 % or more and women 18 % or more (proposed), aged 18–65 with no eating-disorder history.',
      keyNumbers: [
        {
          label: '1 week at 18 kcal/kg in weight lifters',
          value: 'Protein 1.6 g/kg: nitrogen balance +4.13 g/d; 0.8 g/kg plus high carbohydrate: −3.19 g/d',
          note: 'Quadriceps endurance fell in the lower-carbohydrate group.',
          referenceIds: ['walberg1988'],
        },
        {
          label: '2 weeks at 60 % of habitual energy, protein 2.3 vs 1.0 g/kg',
          value: 'Lean mass −0.3 vs −1.6 kg; total −1.5 vs −3.0 kg; performance unchanged',
          note: 'Fatigue ratings were higher on high protein.',
          referenceIds: ['mettler2010'],
        },
        {
          label:
            '4 weeks at a ~40 % deficit (33 kcal/kg LBM) with lifting plus HIIT 6 d/wk, protein 2.4 vs 1.2 g/kg',
          value: 'Lean body mass +1.2 vs +0.1 kg; fat −4.8 vs −3.5 kg',
          referenceIds: ['longland2016'],
        },
        {
          label:
            '4 weeks, deficit 750 vs 300 kcal/d (carbohydrate −130 g/d, high protein), jumpers and sprinters',
          value: '−2.2 kg body mass, −1.7 kg fat, fat-free mass preserved; jump height +2.6 cm',
          note: 'Athletes with 10 % body fat or more preserved fat-free mass.',
          referenceIds: ['huovinen2015'],
        },
        {
          label: '0.7 %/wk vs 1.4 %/wk body-weight loss (−19 vs −30 % energy)',
          value: 'Lean mass +2.1 % vs −0.2 %; fat −31 % vs −21 %',
          referenceIds: ['garthe2011'],
        },
      ],
      timeCourse: 'Evidence covers 1–4 weeks.',
      moderators: 'Protein intake, body fat, resistance training and carbohydrate on training days.',
      grade: 'C',
      gradeReason:
        "Vitals' evidence review rates the lean-trained extension C/D: it is an extrapolation from short deficits and not a true trial.",
      status: 'proposed-fit',
      caveats:
        'No controlled trial of a true PSMF exists in lean trained people, and the block rules are extrapolations from 2–4 week deficits of about 40 %.',
      referenceIds: ['walberg1988', 'mettler2010', 'longland2016', 'huovinen2015', 'garthe2011'],
      relatedMetricIds: [],
    },
    {
      id: '13-rate-of-loss-deficit-cap',
      title: 'Fast vs slow loss and the largest safe deficit',
      category: 'energy',
      summary:
        "At equal total weight lost, rapid and gradual loss led to the same regain: 70.5 % vs 71.2 % at 144 weeks. Faster loss costs slightly more lean mass and resting metabolic rate. The most fat the body can supply per day is about 290 ± 25 kJ per kg of fat mass (≈ 69 ± 6 kcal/kg), and deficits beyond it draw directly on lean tissue. Vitals shows a caution when a deficit passes three quarters of that; the Planner's rate-of-loss caps come from the safety topic rather than the 1.0–1.5 % of body weight a week proposed here.",
      howModelled:
        "Not applied as written. When the 7-day deficit passes 0.75 times the fat-supply limit, the Simulator shows a caution but caps nothing. The Planner's limits come from the safety topic instead: a weekly rate of loss, as a percentage of body weight, that is lower for leaner and older people, and never more than 1.5 kg a week. The engine never converts weight to energy with 7,700 kcal per kg.",
      equation:
        'D_max = min( 0.75 · 69 · FM_kg, r_max · W · 7700 / 7 )  (kcal/d)\nr_max = 1.0 %BW/wk if (men BF ≤ 15 % or women BF ≤ 25 %), 1.5 %BW/wk otherwise (after week 2); never more than 1.5 kg/wk',
      keyNumbers: [
        {
          label: '200 people aiming for 15 % loss: 12-week rapid vs 36-week gradual',
          value:
            '81 % vs 50 % reached ≥ 12.5 %; regain at 144 weeks 70.5 % vs 71.2 % (completers; 76.3 % in both on intention to treat)',
          note: 'One cholecystitis in the rapid arm.',
          referenceIds: ['purcell2014'],
        },
        {
          label: '500 kcal × 5 weeks vs 1,250 kcal × 12 weeks',
          value: '−9.0 vs −8.2 kg; fat-free mass loss 8.8 % vs 1.3 %; regain at 9 months 4.5 vs 4.2 kg',
          note: 'The percentage of fat-free mass lost correlated with regain (r = 0.325).',
          referenceIds: ['vink2016'],
        },
        {
          label: '5 % loss in 5 vs 15 weeks',
          value: 'Rapid lost more total body water, lean mass, fat-free mass and RMR; slow lost more fat',
          referenceIds: ['ashtarylarky2017'],
        },
        {
          label: 'Meta-analysis at equal loss, gradual vs rapid',
          value:
            'Fat −1.0 kg (−1.70, −0.29) and body-fat percentage −0.83 more; RMR better preserved by ≈ 407 kJ/d (≈ 97 kcal/d)',
          note: 'The published confidence interval for RMR is internally inconsistent, so treat its size as uncertain. The fat-free mass difference was not significant.',
          referenceIds: ['ashtarylarky2020'],
        },
        {
          label: 'Maximal fat-energy transfer',
          value: '290 ± 25 kJ/kg fat mass/d (≈ 69 ± 6 kcal/kg FM/d)',
          note: 'Derived from under-fed, moderately active subjects; grade C.',
          referenceIds: ['alpert2005'],
        },
        {
          label: 'Worked caps (limit / 0.75 × limit, kcal/d)',
          value:
            '80 kg man, 10 % fat: 552 / 414; 80 kg man, 15 % fat: 828 / 621; 80 kg man, 25 % fat: 1,380 / 1,035; 65 kg woman, 22 % fat: 987 / 740; 110 kg man, 35 % fat: 2,657 / 1,993',
        },
        {
          label: 'Cross-check',
          value:
            'A 4-week 750 kcal/d deficit preserved fat-free mass in athletes with ≥ 10 % fat, although the limit at 10 % fat of ~75 kg is only ≈ 500–550 kcal/d',
          note: 'Over 2–4 weeks with high protein the limit looks conservative, or reported deficits overstate true deficits. Athletes below 10 % fat did not reliably preserve fat-free mass, and a 30 % deficit halted lean gain.',
          referenceIds: ['huovinen2015', 'garthe2011'],
        },
      ],
      timeCourse: 'Applies from week 2 of a deficit; regain data cover 144 weeks.',
      moderators: 'Body fat, sex, protein and resistance training.',
      grade: 'C',
      gradeReason:
        "Vitals' evidence review rates this section C because the cap is a proposed synthesis, even though the equal-regain finding is grade A/B.",
      status: 'proposed-fit',
      caveats:
        'The fat-transfer limit comes from starvation-era data, and using it as a planner cap is a synthesis (grade C).',
      referenceIds: [
        'purcell2014',
        'vink2016',
        'ashtarylarky2017',
        'ashtarylarky2020',
        'alpert2005',
        'huovinen2015',
        'garthe2011',
      ],
      relatedMetricIds: [],
    },
    {
      id: '13-breaks-refeeds-cycling',
      title: 'Breaks, refeeds and calorie cycling at equal weekly energy',
      category: 'energy',
      summary:
        'At equal weekly energy and protein, non-linear intake (diet breaks, refeeds, calorie or carbohydrate cycling) does not change fat or lean trajectories beyond noise: pooled fat-free-mass effects had opposite signs and were under 1 kg. Breaks reduce hunger and disinhibition, which is the most consistent real benefit. Meta-analyses find a smaller fall in resting metabolic rate with breaks.',
      howModelled:
        'The engine uses the same fat and protein balance as steady intake and adds the glycogen, water and sodium swings to scale weight. Adaptive thermogenesis relaxes during maintenance blocks of one week or more, with no separate bonus. The appetite benefit of 1–2 week breaks enters the Planner as an adherence score, not as a physiological term.',
      keyNumbers: [
        {
          label:
            '51 men with obesity: 16 weeks at 67 % of maintenance, intermittent (8 × 2-week blocks alternating with 7 × 2-week balance blocks over 30 weeks) vs continuous',
          value:
            'Weight −14.1 ± 5.6 vs −9.1 ± 2.9 kg; fat −12.3 vs −8.0 kg; fat-free mass −1.8 vs −1.2 (not significant); adjusted REE fall −360 vs −749 kJ/d',
          note: 'Intermittent arm first. Weight change in the balance blocks was 0.0 ± 0.3 kg.',
          referenceIds: ['byrne2018'],
        },
        {
          label:
            '61 resistance-trained adults (32 women): 4 × 3 weeks of restriction plus 3 × 1 week of balance vs 12 weeks continuous',
          value:
            'No difference in fat mass (15.3 vs 18.0 kg, p = 0.32), fat-free mass, strength, REE, leptin, T3 or testosterone; lower hunger (p = 0.002), higher satisfaction and PYY',
          referenceIds: ['peos2021a'],
        },
        {
          label: '1-week break at maintenance (carbohydrate up) after 12 weeks',
          value:
            'Body weight +0.6 kg, “fat-free mass” +0.7 kg, fat 0; REE 7,000 → 7,200 kJ/d; leg muscle endurance up; hunger and irritability down',
          referenceIds: ['peos2021b'],
        },
        {
          label:
            '38 resistance-trained women, 25 % restriction, 6 weeks continuous vs 1 week balance after every 2 weeks (8 weeks); protein 1.8 g/kg',
          value:
            'No difference in body composition or RMR; disinhibition up with continuous, down with breaks',
          referenceIds: ['siedler2023'],
        },
        {
          label:
            '27 resistance-trained adults, about 25 % restriction for 7 weeks: 2 consecutive high-carbohydrate days a week vs continuous',
          value: 'Fat-free mass −0.4 vs −1.3 kg; RMR −38 vs −78 kcal/d',
          note: 'A re-analysis found only dry fat-free mass differed.',
          referenceIds: ['campbell2020', 'peos2020'],
        },
        {
          label: 'Meta-analysis of 12 RCTs, 881 participants, diet breaks vs continuous',
          value: 'No difference in body mass, fat or fat-free mass; a smaller RMR reduction with breaks',
          note: 'The RMR benefit was larger in overweight than in trained people.',
          referenceIds: ['poon2025'],
        },
        {
          label:
            'Meta-analysis of 9 RCTs (n = 782), regular intermittent restriction (restriction interspersed with maintenance days)',
          value: 'Lean mass −0.86 kg (−1.62, −0.10) worse than continuous; other outcomes not significant',
          referenceIds: ['roman2019'],
        },
        {
          label: '35 obese adults, 33 % restriction for 12 weeks, intermittent vs continuous',
          value:
            '≈ 12.5 % loss in both; same body composition; RMR fell and exercise efficiency rose in both; no difference in compensatory responses',
          referenceIds: ['coutinho2018'],
        },
        {
          label: 'Behavioural programme with prescribed 2-week or 6-week breaks',
          value: 'Breaks did not reduce overall 5- or 11-month loss',
          referenceIds: ['wing2003'],
        },
        {
          label: '74 overweight adults, 11 days of restriction plus 3 days of self-selected eating, × 3',
          value: 'Small, low-quality trial; better adherence reported',
          referenceIds: ['davoodi2014'],
        },
        {
          label: 'Review of intermittent vs continuous restriction',
          value: 'No consistent physiological benefit',
          referenceIds: ['seimon2015'],
        },
      ],
      timeCourse:
        'Breaks of 1–2 weeks at maintenance relax adaptive thermogenesis; scale weight rises 0.5–1.0 kg over 2–4 days.',
      moderators:
        'Deficit size and adiposity (MATADOR vs ICECAP and Siedler disagree on efficiency), the length of the break, and whether food was provided.',
      grade: 'B',
      gradeReason:
        'That non-linear intake gives no body-composition advantage is grade A/B; the appetite benefit is B.',
      status: 'contested',
      caveats:
        "Trials disagree on whether breaks improve fat-loss efficiency, and pooled fat-free-mass effects point in opposite directions. Female data are limited. The second trial's participant count differs from the hormones topic's description of it (74 here, 60 there).",
      referenceIds: [
        'byrne2018',
        'peos2021a',
        'peos2021b',
        'siedler2023',
        'campbell2020',
        'peos2020',
        'poon2025',
        'roman2019',
        'coutinho2018',
        'wing2003',
        'davoodi2014',
        'seimon2015',
      ],
      relatedMetricIds: [],
    },
    {
      id: '13-fasting-entry-and-refeed',
      title: 'Fasting: entry, the fast and the refeed',
      category: 'body',
      summary:
        'In a 7-day water-only fast (12 adults), people lost 5.7 ± 0.8 kg: lean mass 3.6 ± 0.49 kg and fat 1.6 ± 1.3 kg. After 3 days of eating freely the lean deficit shrank from −3.6 to −0.69 ± 0.49 kg while the fat loss stayed at −1.85 ± 0.34 kg. So most of the lean loss in a fast is water and glycogen that returns within days. From a high-carbohydrate state, the first 1–2 days drop the scale by about 1.5–2.5 kg, mostly not fat.',
      howModelled:
        'Entry, fast and refeed transients come from the labile-water terms (glycogen, natriuresis, gut content) on top of energy balance. The expected first-days loss is 1.5–2.5 kg from a high-carbohydrate state and 0.5–1.0 kg (proposed) from a very-low-carbohydrate state. After a 3–7 day fast, a carbohydrate-rich refeed gives a rebound of 1.5–3 kg within 3–5 days.',
      keyNumbers: [
        {
          label: 'Entry from a high-carbohydrate state',
          value:
            'Liver glycogen largely exhausted by ~40–50 h; scale loss on days 1–2 ≈ 1.5–2.5 kg, of which fat ≈ 0.15–0.25 kg/d',
          note: 'Gluconeogenesis supplies 64 % of glucose output in the first 22 h, 82 % over the next 14 h and 96 % over the next 18 h.',
          referenceIds: ['rothman1991'],
        },
        {
          label: 'Entry from a very-low-carbohydrate state',
          value:
            '≈ 0.5–1.0 kg smaller first-days drop (proposed) and earlier high ketones; fat loss per fasting day is essentially the same',
        },
        {
          label: '52-h fast',
          value: 'BHB 1.8 ± 0.4 mmol/L; leptin fell 64–72 %',
          referenceIds: ['boden1996'],
        },
        {
          label: 'Early weight loss in a total fast',
          value: '≈ 0.9 kg/d in week 1, ≈ 0.3 kg/d by week 3, “primarily negative sodium balance”',
          referenceIds: ['kerndt1982'],
        },
        {
          label: '7-day water-only fast (12 adults, BMI 25.4 ± 4.1)',
          value: '−5.7 ± 0.8 kg; lean mass −3.6 ± 0.49 kg; fat −1.6 ± 1.3 kg',
          note: 'Blood protein (proteome) changes appeared only after about 3 days.',
          referenceIds: ['pietzner2024'],
        },
        {
          label: '10-day fast with 200–250 kcal/d and up to 3 h/d light activity (16 men, BMI 26.2)',
          value:
            '−5.9 ± 0.2 kg (−7 %); fat −2.3 kg (40 %); lean soft tissue −3.53 kg (60 %): 44 % extracellular water, 14 % glycogen plus water, 42 % metabolically active tissue',
          note: 'Protein oxidation −41 % by day 5 then stable; BMR −12 %; strength maintained or improved.',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'T3 and rT3 after 7–18 days of total fasting',
          value: 'T3 −53 %, rT3 +58 %',
          referenceIds: ['spaulding1976'],
        },
        {
          label: 'Muscle protein breakdown in a 72-h fast',
          value: 'Lower in obese than in lean people',
          referenceIds: ['bak2016'],
        },
        {
          label: 'After 3 days of free eating post 7-day fast',
          value: 'Lean deficit −3.6 → −0.69 ± 0.49 kg; fat loss persisted (−1.85 ± 0.34 kg)',
          note: 'A 3-day refeed of 800 → 1,600 kcal/d after a 10-day fast kept the weight loss, and at 3 months body weight was still below baseline.',
          referenceIds: ['pietzner2024', 'laurens2021'],
        },
        {
          label: 'Carbohydrate-rich refeed',
          value:
            'Glycogen refills in ~24–48 h; ≈ +70 mEq/d sodium ≈ +0.5 L/d; gut refills over ~2–3 days; expected rebound +1.5–3 kg within 3–5 days after a 3–7 day fast',
          referenceIds: ['heyman2020'],
        },
        {
          label: 'Low-carbohydrate or protein-first refeed',
          value: 'Smaller and slower water and glycogen rebound (mechanistic, grade C/D)',
          note: 'No trial has compared refeed compositions for body composition.',
        },
        {
          label: 'Appetite after a 36-h fast',
          value: 'Compensates only ≈ 17 % the next day',
          referenceIds: ['johnstone2002'],
        },
        {
          label:
            'Lean adults, 3 weeks: alternate-day fasts with 150 % on feed days (0:150) vs daily 75 % intake',
          value:
            'Body mass −1.60 vs −1.91 kg; fat −0.74 vs −1.75 kg; fasting without net restriction (0:200) lost no fat',
          note: 'Fasting adds no fat loss at equal energy, and it shifts more of the loss into lean or labile mass in lean people.',
          referenceIds: ['templeman2021'],
        },
        {
          label:
            'Fasting-mimicking 5-day block once a month × 3 (≈ 4,600 kJ ≈ 1,100 kcal on day 1; ≈ 3,000 kJ ≈ 720 kcal on days 2–5; 9–11 % protein)',
          value: '−2.6 ± 2.5 kg vs −0.1 ± 2.1 kg; total and trunk fat down; absolute lean mass slightly down',
          note: 'Benefits persisted 5–7 days after return to a normal diet.',
          referenceIds: ['wei2017'],
        },
        {
          label: 'Supervised 4–21 day fasts at 200–250 kcal/d (1,422 people)',
          value: 'Adverse effects under 1 %; 93.2 % reported no hunger',
          referenceIds: ['wilhelmi2019'],
        },
      ],
      timeCourse:
        'Entry over the first 1–2 days, weight loss slowing from about 0.9 kg a day in week 1 to about 0.3 kg a day by week 3, and a refeed rebound over 3–5 days.',
      moderators:
        'Carbohydrate state going in (high vs very low), leanness, refeed composition, and how long the fast lasts.',
      grade: 'B',
      gradeReason:
        'Body-composition trajectories are grade B from small but controlled cohorts; the entry and refeed composition effects are C.',
      status: 'established',
      caveats:
        'The 3-month follow-up of the 10-day fast may show fat returning towards baseline while weight stayed lower, and needs verification before being used as a target (unverified). Physiology of fasting beyond sequencing is covered in the fasting topics.',
      referenceIds: [
        'rothman1991',
        'boden1996',
        'kerndt1982',
        'pietzner2024',
        'laurens2021',
        'spaulding1976',
        'bak2016',
        'heyman2020',
        'johnstone2002',
        'templeman2021',
        'wei2017',
        'wilhelmi2019',
      ],
      relatedMetricIds: ['scaleWeight', 'waterWeight'],
    },
    {
      id: '13-refeeding-syndrome-risk',
      title: 'Refeeding syndrome risk after very low intake',
      category: 'recovery',
      summary:
        'Refeeding syndrome is a dangerous shift in phosphate, potassium and magnesium after energy is reintroduced to someone who has eaten very little. The UK NICE criteria, as reproduced in a review, call someone high risk if one of these applies: BMI under 16, unintentional loss over 15 % in 3–6 months, little or no intake for more than 10 days, or low potassium, phosphate or magnesium before feeding. Two or more of BMI under 18.5, loss over 10 %, little or no intake for more than 5 days, or alcohol misuse or certain drugs also mean high risk.',
      howModelled:
        "The engine does not apply these criteria. After a fast of more than 3 days it warns that food should be restarted gradually (about half the usual energy for the first 2 days), and planned long fasts include a graded refeed. The guideline's thresholds (for high-risk people, refeeding at 10 kcal/kg/day or less, 5 or less if BMI is 14 or below or intake was negligible for 2 weeks or more, with phosphate, potassium and magnesium watched in the first 5 days) are for clinicians and are shown for context.",
      keyNumbers: [
        {
          label: 'High risk if ONE of',
          value:
            'BMI < 16; unintentional loss > 15 % in 3–6 months; little or no intake for > 10 days; low K, PO₄ or Mg before feeding',
          referenceIds: ['mehanna2008'],
        },
        {
          label: 'High risk if TWO of',
          value:
            'BMI < 18.5; loss > 10 %; little or no intake for > 5 days; alcohol misuse or drugs (insulin, chemotherapy, antacids, diuretics)',
          referenceIds: ['mehanna2008'],
        },
        {
          label: 'Starting energy for high-risk refeeding',
          value: '≤ 10 kcal/kg/d (≤ 5 kcal/kg/d if BMI ≤ 14 or negligible intake ≥ 2 weeks)',
          referenceIds: ['mehanna2008'],
        },
        {
          label: 'ASPEN 2020 definition',
          value:
            '10–30 %+ falls in phosphate, potassium or magnesium (or organ dysfunction) within 5 days of reintroducing energy',
          referenceIds: ['dasilva2020'],
        },
        {
          label: 'N_lowintake counter',
          value: 'Consecutive days with intake under ~10 kcal/kg',
        },
      ],
      timeCourse: 'The first 5 days of reintroducing energy are the risk window.',
      moderators:
        'BMI, weight loss, length of low intake, alcohol misuse, and medicines such as insulin or diuretics.',
      grade: 'A',
      gradeReason:
        "Vitals' evidence review grades these as rules (A): they are consensus criteria rather than results of trials.",
      status: 'established',
      caveats:
        'The criteria are guideline consensus. Fasts longer than 72 h are simulation-only in Vitals, and the safety topic holds the full contraindication list.',
      referenceIds: ['mehanna2008', 'dasilva2020'],
      relatedMetricIds: [],
    },
    {
      id: '13-cyclical-low-carb-ketosis-reentry',
      title: 'Cyclical low-carbohydrate eating and ketosis re-entry',
      category: 'fuel',
      summary:
        'After 7 days of a ketone-raising diet, one 72 g carbohydrate breakfast dropped fasting breath acetone from 8.2 to 5.7 ppm, and stable ketosis took 5 days to re-establish: 2 days in people with low fasting insulin, 5 in medium and not at all in high-insulin people. A weekly 2-day carbohydrate load therefore leaves most low days in transition. In one 8-week trial, 5 low-carbohydrate days plus 2 high-carbohydrate days lost less fat than a balanced diet at the same deficit.',
      howModelled:
        'Each carbohydrate meal in ketosis costs 2–5 days of re-entry, and a weekly carbohydrate load adds 1–3 kg of scale oscillation per cycle. The engine shows the costs but gives no credit for cycling. “Targeted” carbohydrate around training within a very-low-carbohydrate diet has no controlled trial (grade D).',
      keyNumbers: [
        {
          label: '72 g carbohydrate breakfast after 7 days of a ketone-raising diet',
          value:
            'Fasting breath acetone 8.2 → 5.7 ppm; stable ketosis re-established in 5 days (2 in low-insulin, 5 in medium-insulin, not re-established in high-insulin people)',
          referenceIds: ['kempf2024'],
        },
        {
          label: 'Ketone level after 2 weeks of refeeding',
          value: 'BHB 0.48 → 0.19 mmol/L',
          referenceIds: ['sumithran2013'],
        },
        {
          label:
            '8-week trial, 25 trained young men, both at −500 kcal/d: cyclical (5 days ≤ 30 g carbohydrate + 1.6 g/kg protein, then 2 days at 8–10 g carbohydrate/kg fat-free tissue) vs balanced',
          value:
            'Cyclical: body mass −4.6 kg, fat −1.9 kg, lean body mass −1.8 kg (significant), body water −2.2 kg; balanced: fat −4.0 kg, lean mass kept',
          note: 'Strength and VO₂peak did not improve on the cyclical diet, while the balanced diet improved lat pull-down, leg press and VO₂peak. Measures were by BIA, and timing relative to the load days is a confounder.',
          referenceIds: ['kysel2020'],
        },
      ],
      timeCourse: 'Each carbohydrate meal in ketosis costs 2–5 days of re-entry.',
      moderators: 'Fasting insulin (re-entry time), and the size of the carbohydrate load.',
      grade: 'C',
      gradeReason:
        'The ketosis re-entry timing is grade B from one controlled study, and the cyclical-diet outcome comes from a single trial (C).',
      status: 'contested',
      caveats:
        'The cyclical-diet trial is a single small study with BIA measures. Re-entry into stable ketosis was not achieved in people with high fasting insulin.',
      referenceIds: ['kempf2024', 'sumithran2013', 'kysel2020'],
      relatedMetricIds: ['hoursInKetosis', 'scaleWeight'],
    },
    {
      id: '13-train-low-sleep-low',
      title: 'Train-low and sleep-low carbohydrate timing',
      category: 'performance',
      summary:
        'Training with low carbohydrate availability, or re-timing carbohydrate around sessions, can help sub-elite endurance athletes but not consistently. In a 3-week study at 6 g/kg/day of carbohydrate, an evening high-intensity session with carbohydrate, carbohydrate withheld overnight, and a fasted low-intensity session next morning raised delta efficiency by 11 % vs 1.4 % and improved 10-km run time by 2.9 % vs 0.1 %. Elite athletes showed no superior adaptations.',
      howModelled:
        "Listed in the Planner's block library but not used in this version, because it needs carbohydrate timing around individual sessions and an event date. As described: the same daily carbohydrate (about 6 g/kg), an evening high-intensity session with carbohydrate, no carbohydrate overnight, and a next-morning low-intensity fasted session, followed by refuelling, 3 cycles a week for 1–3 weeks. It earns no fat-loss credit.",
      keyNumbers: [
        {
          label: '3 weeks at 6 g/kg/d, sleep-low vs control',
          value:
            'Delta efficiency +11 % vs +1.4 %; 10-km run −2.9 % vs −0.1 %; supramaximal time +12.5 % vs +1.6 % (p = 0.06); fat mass −8.5 % vs −2.6 %; lean mass unchanged',
          referenceIds: ['marquet2016a'],
        },
        {
          label: '1-week version',
          value: '20-km time trial +3.2 %',
          referenceIds: ['marquet2016b'],
        },
        {
          label: 'Elite athletes, 4 weeks, manipulation 3 days a week',
          value: 'No superior adaptations',
          referenceIds: ['gejl2017'],
        },
        {
          label: 'Periodised carbohydrate in elite race walkers',
          value: '+2.2 % (p = 0.09) vs +4.8 % with high carbohydrate',
          referenceIds: ['burke2020'],
        },
        {
          label: 'Review of train-low studies',
          value:
            'Augments cell signalling in ~75 % of studies but improves performance in only 37 % of 11 studies',
          referenceIds: ['impey2018'],
        },
      ],
      timeCourse: 'Studied over 1–3 weeks.',
      moderators: 'Training level (sub-elite vs elite) and how the carbohydrate is timed.',
      grade: 'B',
      gradeReason:
        'Endurance-performance findings in sub-elite athletes are grade B; the body-composition claims are C.',
      status: 'contested',
      caveats:
        'Studies disagree, and elite athletes showed no benefit. The body-composition claims come from small trials.',
      referenceIds: ['marquet2016a', 'marquet2016b', 'gejl2017', 'burke2020', 'impey2018'],
      relatedMetricIds: [],
    },
    {
      id: '13-physique-cycles',
      title: 'Physique cycles: gaining, cutting and recovering',
      category: 'body',
      summary:
        'Physique athletes cycle gaining and cutting phases. Gaining with +10–20 % energy and 0.25–0.5 % of body weight a week suits novice and intermediate lifters, and a surplus beyond about +15–20 % adds mainly fat: over 4 weeks at 67.5 vs 50.1 kcal/kg/day, muscle rose +2.7 vs +1.1 % but fat +7.4 vs +0.8 %. Cutting at 0.5–1 % of body weight a week preserves lean mass better than 1.4 %. After contest-level leanness, hormones took 3–5 months to recover. Reverse dieting has not been shown to help.',
      howModelled:
        'A gain block uses 110–120 % of maintenance. A cut uses 0.5–1 % of body weight a week. After contest-level leanness (men under 8 % body fat, women under 15 %, proposed thresholds) a maintenance phase of at least 3–4 months (enforced for at least 12 weeks) follows, with an immediate return to maintenance rather than a reverse-diet ramp.',
      keyNumbers: [
        {
          label: 'Gaining phase',
          value:
            '+10–20 % energy; +0.25–0.5 % of body weight a week (less for advanced); protein 1.6–2.2 g/kg; fat 0.5–1.5 g/kg; carbohydrate ≥ 3–5 g/kg',
          referenceIds: ['iraki2019'],
        },
        {
          label: '4 weeks at 67.5 vs 50.1 kcal/kg/d in bodybuilders',
          value: 'Muscle +2.7 vs +1.1 %; fat +7.4 vs +0.8 %',
          referenceIds: ['ribeiro2019'],
        },
        {
          label: 'Cutting phase',
          value:
            '0.5–1 % of body weight a week; protein 2.3–3.1 g/kg lean body mass; fat 15–30 % of energy; 0.7 %/wk beats 1.4 %/wk for lean mass and strength',
          referenceIds: ['helms2014', 'garthe2011'],
        },
        {
          label: 'Male contest-preparation case (6 months of prep, 6 months of recovery)',
          value:
            'Body fat 14.8 → 4.5 %; testosterone 9.22 → 2.27 ng/mL; resting heart rate 53 → 27 bpm; mood disturbance 6 → 43',
          note: 'Afterwards testosterone 9.91 ng/mL, body fat back to 14.6 %, resting heart rate 46 within 1 month; strength not fully recovered at 6 months.',
          referenceIds: ['rossow2013'],
        },
        {
          label: 'Male case, 26 weeks, 2 elevated-carbohydrate days a week',
          value: '88.6 → 73.3 kg (linear, R² = 0.99); body fat 17.5 → 7.4 %; resting heart rate 71 → 44',
          referenceIds: ['kistler2014'],
        },
        {
          label: 'Male case, 8 months of prep and 5 months of recovery',
          value:
            '−9.1 kg; DXA body fat 13.8 → 5.1 → 13.8 % at month 13; intake 3,860 → 1,724 kcal/d; testosterone 623 → 173 ng/dL; T3 123 → 40 ng/dL; RMR 107 → 81 % of predicted; peak power 753 → 537 W',
          note: 'Largely, not entirely, reversed by month 13.',
          referenceIds: ['pardue2017'],
        },
        {
          label: '27 women vs 23 controls, ~4 months of dieting and 3–4 months of recovery',
          value:
            'Body weight −12 %, fat −35–50 %; leptin, T3, testosterone and oestradiol fell; menstrual irregularity rose',
          note: 'Weight and most hormones recovered in 3–4 months, except T3 and testosterone.',
          referenceIds: ['hulmi2016'],
        },
        {
          label: 'Woman, 8 months, 2 contests',
          value:
            'Body fat 20.3 → 12.2 → 11.6 %; fat-free mass +2.1 → +4.6 %; 965–1,610 kcal/d; RMR 1,345 → 1,119 → 1,435 kcal/d; rate of force development −57 %, still −39 % at the end',
          note: 'RMR recovered; neuromuscular performance did not.',
          referenceIds: ['tinsley2019'],
        },
        {
          label: '51 competitors, 22 ± 9 weeks of prep',
          value: 'Placed men started with more carbohydrate (5.1 vs 3.7 g/kg)',
          referenceIds: ['chappell2018'],
        },
        {
          label: 'Reverse dieting, 49 resistance-trained adults after 5 % loss (15 weeks)',
          value:
            'Relative regain 3.68 ± 2.75 % (reverse: +8.5 %/wk men, +11.7 %/wk women) vs 2.73 ± 3.14 % (immediate estimated maintenance) vs 1.30 ± 2.3 % (free eating), p = 0.053',
          note: 'Not superior. This is a preliminary analysis published as a conference abstract; metabolic adaptation is reviewed elsewhere.',
          referenceIds: ['rodriguez2025', 'trexler2014'],
        },
      ],
      timeCourse:
        'Hormonal recovery after extreme leanness took 3–5 months, with T3 and testosterone sometimes lagging.',
      moderators: 'Training status, size of the surplus or deficit, and how lean the person gets.',
      grade: 'C',
      gradeReason:
        'This rests on narrative reviews and case reports, with mini-cuts at grade D and reverse dieting at C.',
      status: 'contested',
      caveats:
        "Much of the evidence is male case data. Mini-cuts (2–6 week aggressive deficits inside a gaining phase) have no controlled trial (grade D). One case shows a resting heart rate of 27 bpm, a figure Vitals' evidence review repeats but which looks unusually low.",
      referenceIds: [
        'iraki2019',
        'ribeiro2019',
        'helms2014',
        'garthe2011',
        'rossow2013',
        'kistler2014',
        'pardue2017',
        'hulmi2016',
        'tinsley2019',
        'chappell2018',
        'rodriguez2025',
        'trexler2014',
      ],
      relatedMetricIds: [],
    },
    {
      id: '13-metabolic-flexibility',
      title: 'Does alternating diets train metabolic flexibility?',
      category: 'fuel',
      summary:
        'Metabolic flexibility is the capacity to switch between burning carbohydrate and fat as availability and demand change. It is impaired in obesity and type 2 diabetes and improved by exercise and weight loss. But no human trial compared variable with constant macronutrient ratios at equal averages. Fuel use re-adapts within about 5–7 days in either direction, to the current diet, with no residual training effect reported after reversal.',
      howModelled:
        'There is no bonus term for variety. Every switch simply incurs the transients described in the other articles in this topic.',
      keyNumbers: [
        {
          label: 'Re-adaptation of substrate oxidation',
          value: 'About 5–7 days in either direction',
          note: 'The adaptation is to the current diet, with no residual training effect reported after reversal.',
          referenceIds: ['schrauwen1997a', 'goedecke1999', 'burke2021'],
        },
        {
          label: 'Carbohydrate handling while on very-low-carbohydrate intake',
          value: 'Reduced (higher PDK4, lower GLUT4, lower glucose tolerance)',
          referenceIds: ['hengist2024', 'jansen2022'],
        },
        {
          label: 'A prior fat-adaptation block before high-carbohydrate performance',
          value: 'Did not improve it',
          referenceIds: ['burke2020'],
        },
        {
          label: 'Definition and clinical context',
          value: 'Impaired in obesity and type 2 diabetes; improved by exercise and weight loss',
          referenceIds: ['goodpaster2017'],
        },
      ],
      timeCourse: 'Re-adaptation in about 5–7 days each way.',
      moderators: 'Exercise and weight loss improve flexibility; alternating diets show no added benefit.',
      grade: 'D',
      gradeReason:
        "Vitals' evidence review rates any benefit of alternating diets D (absence of evidence), while the transients themselves are B.",
      status: 'contested',
      caveats: 'No human trial compared variable and constant macronutrient ratios at equal averages.',
      referenceIds: [
        'schrauwen1997a',
        'goedecke1999',
        'burke2021',
        'hengist2024',
        'jansen2022',
        'burke2020',
        'goodpaster2017',
      ],
      relatedMetricIds: [],
    },
    {
      id: '13-periodisation-verdicts',
      title: 'Which ways of sequencing diets have any real benefit?',
      category: 'energy',
      summary:
        "Vitals' evidence review rates each way of sequencing eating patterns as a benefit, neutral, harmful or unknown against a plain steady plan at equal weekly energy and protein. None shows a fat-loss or lean-mass advantage that survives replication. Best-case effects are small (resting metabolic rate by tens of kcal a day, lean mass by about ±0.5–0.9 kg) and inconsistent in sign. The most consistent real effect is less hunger with diet breaks.",
      howModelled:
        'The Planner gives no physiological bonus to a strategy rated neutral or unknown. Blocks change fat and lean trajectories only through their own energy, protein and training content and through the transients described in the other articles. Sequencing rules include: a very-low-carbohydrate block of at least 21 days when chosen for ketosis or appetite, and no alternation more often than every 14 days unless forced; refeeds at most 2 days a week; exit ramps after protein-sparing and formula-diet blocks; no fast of 48 h or more followed at once by a day at 120 % or more; at least 10 g of fat in one meal a day when expected loss exceeds 1.0 kg a week; a maximum-deficit cap; no very-low-carbohydrate block within 7 days before a high-intensity endurance target; glucose tests only when adaptation gaps are small; diet breaks offered after every 4–12 weeks of deficit; and at least 12 weeks of recovery after contest-level leanness.',
      keyNumbers: [
        {
          label: 'Alternating very-low-carbohydrate and high-carbohydrate blocks (1–4 weeks) at equal energy',
          value:
            'Fat loss neutral; lean neutral to harmful; performance harmful; markers harmful to neutral; adherence unknown (grade B)',
          note: 'Planner rule: allow only if the user chooses it, display the transition costs, and never justify it by “metabolic flexibility”. Fat loss is set by energy balance, and each switch costs the transients.',
          referenceIds: [
            'yang1976',
            'hall2016',
            'sciarrillo2024',
            'burke2021',
            'vazquez1995',
            'vazquez1992',
            'jansen2022',
            'numao2012',
          ],
        },
        {
          label: 'Protein-sparing or very-low-calorie block, BMI 30 or more (or 27 with a comorbidity)',
          value:
            'Fat loss benefit (speed); lean neutral to harmful; markers benefit; adherence benefit short-term, regain later (grade A/B)',
          note: '1–3 kg/wk; −21 kg over 17 wk; type 2 diabetes remission 46 % at 1 year; long-term loss about the same as a low-calorie diet. Planner rule: supervision flag, ECG, electrolytes, at most 26 weeks, gallbladder rule.',
          referenceIds: ['palgi1985', 'lean2018', 'tsai2006', 'pfoh2020', 'chaston2007', 'vink2016'],
        },
        {
          label: 'Aggressive block in lean trained people (1–4 weeks)',
          value:
            'Fat loss benefit (speed); lean harmful if protein under 2 g/kg or body fat below ~10 % in men, neutral with 2.3–2.4 g/kg plus lifting (grade C)',
          note: 'No true-PSMF trial. Planner rule: cap by the deficit rule, at most 14 days if carbohydrate is under 50 g/d, and require lifting plus at least 2.3 g/kg protein.',
          referenceIds: ['mettler2010', 'longland2016', 'garthe2011', 'huovinen2015', 'walberg1988'],
        },
        {
          label: 'Fast vs slow loss at equal total',
          value:
            'Slight benefit for slow on fat and lean; regain 70.5 vs 71.2 %; slow keeps ~97 kcal/d more RMR (grade A/B)',
          note: 'Planner rule: default 0.5–1 % of body weight a week; rapid allowed for obesity goals.',
          referenceIds: ['purcell2014', 'vink2016', 'ashtarylarky2020', 'garthe2011'],
        },
        {
          label: 'Diet breaks (1–2 weeks at maintenance every 2–12 weeks)',
          value:
            'Fat loss neutral per week of restriction (slower per calendar week); lean neutral; adherence benefit (grade B)',
          note: 'MATADOR +5 kg loss per same restriction weeks; ICECAP and Siedler no difference; meta-analysis a smaller RMR fall. Planner rule: offer as an adherence tool.',
          referenceIds: ['byrne2018', 'peos2021a', 'siedler2023', 'poon2025', 'peos2021b'],
        },
        {
          label: 'Refeeds (1–2 days of high carbohydrate a week)',
          value:
            'Neutral on fat and lean; performance plausible benefit for glycogen-dependent sessions (grade C)',
          note: 'Planner rule: at most 2 days a week, no durable hormonal credit; breaks ketosis for 2–5 days.',
          referenceIds: ['campbell2020', 'peos2020', 'dirlewanger2000', 'kempf2024'],
        },
        {
          label: 'Calorie cycling or zig-zag at equal weekly energy',
          value: 'Neutral on fat; lean neutral to harmful (grade B)',
          note: 'Regular intermittent restriction: lean −0.86 kg. Planner rule: neutral; allow for preference.',
          referenceIds: ['roman2019', 'davoodi2014'],
        },
        {
          label: 'Carbohydrate cycling to training',
          value: 'Neutral on fat and lean; possible benefit for hard sessions (grade C)',
          note: 'A mechanistic framework with mixed performance data.',
          referenceIds: ['impey2018'],
        },
        {
          label: 'Two low-energy days a week (non-consecutive, about 25 % of energy needs; often called 5:2)',
          value: 'Neutral (short-term possible benefit) (grade A/B)',
          note: '−6.4 vs −5.6 kg at 6 months; 2 days under 40 g carbohydrate: fat −3.7 vs −2.0 kg at 3 months; long-term about the same as continuous restriction.',
          referenceIds: ['harvie2011', 'harvie2013', 'headland2016', 'headland2020', 'elortegui2023'],
        },
        {
          label: 'Alternate-day fasting',
          value: 'Neutral for obesity; harmful per kg lost in lean people (grade A/B)',
          note: '−6.0 vs −5.3 % at 12 months, dropout 38 vs 29 %, LDL +11.5 mg/dL; zero-calorie versions about the same as restriction; lean: fat −0.74 vs −1.75 kg. Planner rule: neutral for obese; discourage in lean muscle-gain goals.',
          referenceIds: ['trepanowski2017', 'catenacci2016', 'templeman2021', 'semnaniazad2025'],
        },
        {
          label: 'Weekly 24-h water-only fast',
          value: 'Neutral on fat via the deficit; performance harmful on the fast day (grade B/C)',
          note: 'Next-day compensation about 17 %. Planner rule: at most 1–2 a week in eligible adults.',
          referenceIds: ['johnstone2002', 'templeman2021'],
        },
        {
          label: 'Monthly 48–72 h fast or a 5-day low-energy block',
          value: 'Neutral via the deficit; transient lean loss mostly regained (grade B/C)',
          note: 'Fasting-mimicking −2.6 kg over 3 cycles; protein (proteome) changes appear only after about 3 days. Planner rule: 72 h allowed with warnings, at most monthly.',
          referenceIds: ['wei2017', 'pietzner2024'],
        },
        {
          label: 'About 7-day water-only fast',
          value: 'Neutral on fat (≈ 1.6–2.3 kg); lean loss transient; performance harmful during (grade B)',
          note: '−5.7 kg with 63 % of it lean during the fast; lean largely back after a 3-day refeed and fat −1.85 kg kept. Planner rule: simulate only; not prescribable.',
          referenceIds: ['pietzner2024', 'laurens2021', 'wilhelmi2019'],
        },
        {
          label: 'Cyclical very-low-carbohydrate (5 low days plus 2 carbohydrate-load days)',
          value: 'Fat, lean and performance harmful vs a balanced diet in one trial (grade C)',
          note: 'Fat −1.9 vs −4.0 kg; lean −1.8 kg; ketosis re-entry takes 2–5 days. Planner rule: allowed only if chosen; flag the costs.',
          referenceIds: ['kysel2020', 'kempf2024'],
        },
        {
          label: '“Targeted” carbohydrate within a very-low-carbohydrate diet',
          value: 'Unknown on every outcome (grade D)',
          note: 'No controlled trials. Planner rule: neutral; the ketone dip is modelled in the ketosis topic.',
        },
        {
          label: 'Keto-adapt then restore carbohydrate before a race',
          value: 'Performance harmful for high-intensity events (grade B)',
          note: '−2.2 % despite restored glycogen; no rebound after 2.5 weeks. Planner rule: never prescribe for performance goals.',
          referenceIds: ['burke2021', 'burke2020'],
        },
        {
          label: 'Train-low or sleep-low at the same daily carbohydrate',
          value: 'Neutral on fat and lean; benefit for sub-elite endurance, neutral in elites (grade B)',
          note: '10-km −2.9 % vs −0.1 %; elite: no effect. Planner rule: allowed for endurance goals; no fat-loss credit.',
          referenceIds: ['marquet2016a', 'marquet2016b', 'gejl2017'],
        },
        {
          label: 'Carbohydrate loading before an event over 90 minutes',
          value: 'Performance benefit (grade A/B)',
          note: '1 day at 10 g/kg saturates muscle. Planner rule: allowed; show +1–2 kg on the scale.',
          referenceIds: ['bussau2002'],
        },
        {
          label: 'Gain → cut cycles (surplus 10–20 % then a deficit of 0.5–1 % a week)',
          value: 'Goal-dependent on fat; lean benefit for hypertrophy in trained people (grade B/C)',
          note: 'Muscle +2.7 vs +1.1 % but fat +7.4 vs +0.8 % with the larger surplus; a slow cut preserves lean mass. Planner rule: allowed for muscle-gain goals; limit surplus to 20 %.',
          referenceIds: ['ribeiro2019', 'garthe2011'],
        },
        {
          label: 'Mini-cuts (2–6 week aggressive deficit within a gain phase)',
          value:
            'Fat benefit (speed) if the mini-cut rules hold; lean unknown; performance harmful short-term (grade D)',
          note: 'No trials. Planner rule: model as the aggressive-block regime.',
        },
        {
          label: 'Reverse dieting',
          value: 'Neutral on fat, lean and performance; adherence possibly worse (grade C)',
          note: 'Regain 3.68 vs 2.73 vs 1.30 %, not significant. Planner rule: neutral; default is an immediate return to maintenance.',
          referenceIds: ['rodriguez2025'],
        },
        {
          label: 'Maintenance and recovery phase after extreme leanness (3–4 months or more)',
          value: 'Lean, performance and hormonal benefit (grade C)',
          note: 'Hormones recover in 3–5 months, with T3 and testosterone sometimes lagging. Planner rule: required after contest-level leanness.',
          referenceIds: ['rossow2013', 'pardue2017', 'hulmi2016'],
        },
        {
          label: 'Protein-first or low-carbohydrate refeed after a fast or protein-sparing diet',
          value: 'Neutral on fat; smaller water rebound and slower glucose re-tolerance (grade C/D)',
          note: 'Mechanistic only; carbohydrate itself spares protein. Planner rule: allowed; show the smaller rebound and the glucose-test caveat.',
          referenceIds: ['vazquez1995'],
        },
        {
          label: 'Alternating macronutrients to “train metabolic flexibility”',
          value: 'Neutral on fat and lean; performance harmful (transitions); no bonus (grade D)',
          note: 'No trials; adaptation is to the current diet.',
          referenceIds: ['schrauwen1997a', 'burke2021', 'hengist2024'],
        },
        {
          label: 'Formula diet for 8–20 weeks with stepped food reintroduction (type 2 diabetes, obesity)',
          value: 'Fat loss benefit for 1–3 years; lean neutral; type 2 diabetes remission benefit (grade A)',
          note: 'Planner rule: allowed with a supervision flag for eligible users.',
          referenceIds: ['lean2018', 'lean2019', 'astbury2018', 'astbury2021'],
        },
      ],
      timeCourse: 'Not applicable; each strategy has its own time course in the other articles.',
      moderators:
        'Goal (fat loss, muscle gain, endurance), body fat, training status and whether the person is under medical supervision.',
      grade: 'B',
      gradeReason:
        'Most rows are grade B; individual strategies range from A (formula diets) to D (targeted carbohydrate, mini-cuts, metabolic-flexibility claims).',
      status: 'proposed-fit',
      caveats:
        "The verdict and Planner rules are Vitals' own synthesis. A verdict of neutral means no difference from a steady plan at equal weekly energy and protein, although a strategy may still be used for preference or adherence.",
      referenceIds: [
        'yang1976',
        'hall2016',
        'sciarrillo2024',
        'burke2021',
        'vazquez1995',
        'vazquez1992',
        'jansen2022',
        'numao2012',
        'palgi1985',
        'lean2018',
        'tsai2006',
        'pfoh2020',
        'chaston2007',
        'vink2016',
        'mettler2010',
        'longland2016',
        'garthe2011',
        'huovinen2015',
        'walberg1988',
        'purcell2014',
        'ashtarylarky2020',
        'byrne2018',
        'peos2021a',
        'siedler2023',
        'poon2025',
        'peos2021b',
        'campbell2020',
        'peos2020',
        'dirlewanger2000',
        'kempf2024',
        'roman2019',
        'davoodi2014',
        'impey2018',
        'harvie2011',
        'harvie2013',
        'headland2016',
        'headland2020',
        'elortegui2023',
        'trepanowski2017',
        'catenacci2016',
        'templeman2021',
        'semnaniazad2025',
        'johnstone2002',
        'wei2017',
        'pietzner2024',
        'laurens2021',
        'wilhelmi2019',
        'kysel2020',
        'burke2020',
        'marquet2016a',
        'marquet2016b',
        'gejl2017',
        'bussau2002',
        'ribeiro2019',
        'rodriguez2025',
        'rossow2013',
        'pardue2017',
        'hulmi2016',
        'hengist2024',
        'schrauwen1997a',
        'astbury2018',
        'lean2019',
        'astbury2021',
      ],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '13-myth-week-one-keto-burns-fat',
      claim: 'The first week of very-low-carbohydrate eating burns a lot of fat.',
      verdict: 'not-supported',
      explanation:
        'Water made up 61 % of the loss, and fat loss equalled a mixed diet at the same energy. In a ward study there was a rapid extra loss of 1.6 kg of mainly water after the switch.',
      referenceIds: ['yang1976', 'hall2016'],
    },
    {
      id: '13-myth-regain-after-refeed-is-fat',
      claim: 'Weight regained after a refeed or diet break is fat.',
      verdict: 'not-supported',
      explanation:
        'After a 1-week diet break, body weight rose 0.6 kg and DXA fat-free mass 0.7 kg, with no change in fat. The gain is glycogen and water.',
      referenceIds: ['peos2021b', 'kreitzman1992', 'shiose2016'],
    },
    {
      id: '13-myth-refeeds-reset-leptin',
      claim: 'Refeeds or carb-ups reset leptin and metabolism.',
      verdict: 'oversimplified',
      explanation:
        'Leptin rises transiently with a carbohydrate surplus and tracks cumulative energy balance. Resting metabolic rate differences are at most about 100 kcal a day and often null.',
      referenceIds: [
        'dirlewanger2000',
        'chinchance2000',
        'peos2021a',
        'campbell2020',
        'siedler2023',
        'poon2025',
      ],
    },
    {
      id: '13-myth-rapid-loss-regained-faster',
      claim: 'Rapid weight loss is regained faster.',
      verdict: 'not-supported',
      explanation:
        'Regain was equal after rapid and gradual loss. Long-term loss on very-low-calorie diets was about the same as on low-calorie diets.',
      referenceIds: ['purcell2014', 'vink2016', 'tsai2006'],
    },
    {
      id: '13-myth-rapid-loss-harmless-for-muscle',
      claim: 'Rapid loss is harmless for muscle.',
      verdict: 'not-supported',
      explanation:
        'The share of loss that is fat-free mass rises with the severity of the deficit, and slower loss was better in athletes. The cost is small.',
      referenceIds: ['chaston2007', 'vink2016', 'garthe2011'],
    },
    {
      id: '13-myth-reverse-dieting-prevents-regain',
      claim: 'Reverse dieting prevents fat regain.',
      verdict: 'unproven',
      explanation:
        'A preliminary randomised trial found no advantage over an immediate return to maintenance.',
      referenceIds: ['rodriguez2025'],
    },
    {
      id: '13-myth-keto-adapt-then-carb-load',
      claim: 'Keto-adapt, then carb-load, gives the best of both fuels.',
      verdict: 'not-supported',
      explanation:
        'Performance and economy were impaired despite restored glycogen, and 2.5 weeks of high carbohydrate gave no rebound benefit. This holds for high-intensity events.',
      referenceIds: ['burke2021', 'burke2020', 'stellingwerff2006'],
    },
    {
      id: '13-myth-150g-normalises-ogtt',
      claim: 'Three days of at least 150 g of carbohydrate always normalises a glucose tolerance test.',
      verdict: 'oversimplified',
      explanation:
        'That holds on ordinary diets, but not after months of very-low-carbohydrate eating, when weeks may be needed.',
      referenceIds: ['crowe2000', 'hughes1975', 'jansen2022'],
    },
    {
      id: '13-myth-alternating-diets-metabolic-flexibility',
      claim: 'Alternating diets trains metabolic flexibility.',
      verdict: 'unproven',
      explanation:
        'Fuel use follows the current diet within about 5–7 days, and no residual benefit has been found.',
      referenceIds: ['hengist2024', 'burke2021', 'schrauwen1997a'],
    },
    {
      id: '13-myth-fasting-burns-fat-faster',
      claim: 'Fasting burns fat faster than the same deficit spread out.',
      verdict: 'not-supported',
      explanation:
        'Alternate-day fasting with 150 % intake on feed days lost less fat than a daily 75 % intake, and fasting without net restriction lost none.',
      referenceIds: ['templeman2021'],
    },
    {
      id: '13-myth-week-fast-destroys-muscle',
      claim: 'A week-long fast destroys muscle.',
      verdict: 'oversimplified',
      explanation:
        'The lean loss is mostly water and glycogen and largely returns within 3 days of eating. Some real protein loss does occur.',
      referenceIds: ['pietzner2024', 'laurens2021'],
    },
    {
      id: '13-myth-psmf-preserves-all-muscle',
      claim: 'A protein-sparing modified fast preserves all muscle.',
      verdict: 'oversimplified',
      explanation:
        'Nitrogen balance reached about zero only after about 3 weeks at 1.5 g/kg of ideal body weight, with early losses, and more fat-free mass is lost at deeper deficits.',
      referenceIds: ['hoffer1984a', 'chaston2007'],
    },
    {
      id: '13-myth-salt-retains-water-permanently',
      claim: 'Salt makes you retain water permanently.',
      verdict: 'not-supported',
      explanation: 'Steady high salt intake did not raise total body water. The effect is transient.',
      referenceIds: ['heer2000'],
    },
    {
      id: '13-myth-women-cyclical-water',
      claim: 'Women carry 1–2 kg of cyclical water before menses.',
      verdict: 'unproven',
      explanation:
        'Self-reported bloating peaks on day 1 of flow, but objective body weight and total body water did not change significantly. It is unsupported as a general rule.',
      referenceIds: ['white2011', 'takano2026', 'bisson1992'],
    },
    {
      id: '13-myth-cyclical-keto-stays-in-ketosis',
      claim: 'Cyclical ketogenic dieting keeps you in ketosis while allowing carbohydrate days.',
      verdict: 'not-supported',
      explanation:
        'Re-entry takes 2–5 days after one carbohydrate meal, and outcomes were inferior in one randomised trial.',
      referenceIds: ['kempf2024', 'kysel2020'],
    },
    {
      id: '13-myth-periodisation-beats-steady-plan',
      claim: 'Cycling calories or carbohydrate beats a steady plan at the same weekly energy and protein.',
      verdict: 'not-supported',
      explanation:
        'No sequencing strategy has shown a fat-loss or lean-mass advantage over a steady plan that survives replication. Best-case effects are small and change sign between studies, while diet breaks reliably lower hunger.',
      referenceIds: ['roman2019', 'campbell2020', 'poon2025', 'byrne2018', 'peos2021a'],
    },
  ],
  openQuestions: [
    'How long does the slow part of glucose-tolerance adaptation take, and does 1–2 weeks of restriction already load it? It is fitted to one trial in weight-reduced adults, and the size of the fast part is unverified because only iAUC data exist.',
    'How big are the salt-and-water effects of low carbohydrate? The size and time constants rest on very few quantitative human data, and sex and age effects are unknown.',
    'How well does the gut-content model hold? It uses stool-mass data from one wheat-fibre study, and morning gut mass after meat-only versus plant-heavy patterns has not been measured directly.',
    'How large is the menstrual-cycle water effect? Self-reported and objective findings disagree, so the default is kept small and is unverified.',
    'What does a protein-sparing fast do in lean trained people? There are no controlled data, and the mini-cut rules are extrapolations from 2–4 week deficits of about 40 %.',
    'Does refeed composition after a fast or protein-sparing diet (carbohydrate versus protein-first) change body composition? It has never been compared.',
    'Does repeated cycling between very-low-carbohydrate and high-carbohydrate eating have cumulative harms (glucose tolerance, LDL exposure) or habituation of induction symptoms? It is unstudied.',
    'Do diet breaks make fat loss more efficient? MATADOR (obese men, 2-week blocks) disagrees with ICECAP and Siedler (trained people, 1-week breaks), so the effect may depend on deficit size and adiposity, and female data are limited.',
    'Is the fat-supply limit of about 69 kcal per kg of fat mass a good cap? It comes from starvation-era data, and using it as a Planner cap is a synthesis (grade C).',
    'What happens to fat after the 10-day fast at 3 months? The full text suggests fat mass returned towards baseline in the 12 people re-measured while weight stayed lower, which needs verification (unverified).',
    "Do women respond the same way? Much of the athlete evidence is male (race walkers, cyclists, lifters), so women's transition kinetics are under-studied.",
  ],
  references: [
    {
      id: 'yang1976',
      authors: 'Yang MU, Van Itallie TB.',
      year: 1976,
      title:
        'Composition of weight lost during short-term weight reduction. Metabolic responses of obese subjects to starvation and low-calorie ketogenic and nonketogenic diets',
      journal: 'J Clin Invest',
      pmid: '956398',
      doi: '10.1172/JCI108519',
      url: 'https://pubmed.ncbi.nlm.nih.gov/956398/',
    },
    {
      id: 'kreitzman1992',
      authors: 'Kreitzman SN, Coxon AY, Szaz KF.',
      year: 1992,
      title:
        'Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition',
      journal: 'Am J Clin Nutr',
      pmid: '1615908',
      doi: '10.1093/ajcn/56.1.292S',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1615908/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/27385608/',
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
      id: 'sciarrillo2024',
      authors: 'Sciarrillo CM, Guo J, Hengist A, et al.',
      year: 2024,
      title:
        'Diet order significantly affects energy balance for diets varying in macronutrients but not ultraprocessing in crossover studies without a washout period',
      journal: 'Am J Clin Nutr',
      pmid: '39163976',
      doi: '10.1016/j.ajcnut.2024.08.013',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39163976/',
    },
    {
      id: 'fernandezelias2015',
      authors: 'Fernández-Elías VE, Ortega JF, Nelson RK, et al.',
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
      journal: 'J Appl Physiol (1985)',
      pmid: '27231310',
      doi: '10.1152/japplphysiol.00126.2016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27231310/',
    },
    {
      id: 'olsson1970',
      authors: 'Olsson KE, Saltin B.',
      year: 1970,
      title: 'Variation in total body water with muscle glycogen changes in man',
      journal: 'Acta Physiol Scand',
      pmid: '5475323',
      doi: '10.1111/j.1748-1716.1970.tb04764.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/5475323/',
    },
    {
      id: 'bussau2002',
      authors: 'Bussau VA, Fairchild TJ, Rao A, et al.',
      year: 2002,
      title: 'Carbohydrate loading in human muscle: an improved 1 day protocol',
      journal: 'Eur J Appl Physiol',
      pmid: '12111292',
      doi: '10.1007/s00421-002-0621-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12111292/',
    },
    {
      id: 'sherman1981',
      authors: 'Sherman WM, Costill DL, Fink WJ, et al.',
      year: 1981,
      title:
        'Effect of exercise-diet manipulation on muscle glycogen and its subsequent utilization during performance',
      journal: 'Int J Sports Med',
      pmid: '7333741',
      doi: '10.1055/s-2008-1034594',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7333741/',
    },
    {
      id: 'rothman1991',
      authors: 'Rothman DL, Magnusson I, Katz LD, et al.',
      year: 1991,
      title: 'Quantitation of hepatic glycogenolysis and gluconeogenesis in fasting humans with 13C NMR',
      journal: 'Science',
      pmid: '1948033',
      doi: '10.1126/science.1948033',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1948033/',
    },
    {
      id: 'jansen2022',
      authors: 'Jansen LT, Yang N, Wong JMW, et al.',
      year: 2022,
      title:
        'Prolonged Glycemic Adaptation Following Transition From a Low- to High-Carbohydrate Diet: A Randomized Controlled Feeding Trial',
      journal: 'Diabetes Care',
      pmid: '35108378',
      doi: '10.2337/dc21-1970',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35108378/',
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
      id: 'crowe2000',
      authors: 'Crowe SM, Mastrobattista JM, Monga M.',
      year: 2000,
      title: 'Oral glucose tolerance test and the preparatory diet',
      journal: 'Am J Obstet Gynecol',
      pmid: '10819825',
      doi: '10.1067/mob.2000.105391',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10819825/',
    },
    {
      id: 'hughes1975',
      authors: 'Hughes RO.',
      year: 1975,
      title:
        'Reduced carbohydrate intake in the preparatory diet and the reliability of the oral glucose tolerance test',
      journal: 'Aviat Space Environ Med',
      pmid: '1131138',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1131138/',
    },
    {
      id: 'wilkerson1960',
      authors: 'WILKERSON HL, HYMAN H, KAUFMAN M, et al.',
      year: 1960,
      title:
        'Diagnostic evaluation of oral glucose tolerance tests in nondiabetic subjects after various levels of carbohydrate intake',
      journal: 'N Engl J Med',
      pmid: '13844739',
      doi: '10.1056/NEJM196005262622101',
      url: 'https://pubmed.ncbi.nlm.nih.gov/13844739/',
    },
    {
      id: 'goedecke1999',
      authors: 'Goedecke JH, Christie C, Wilson G, et al.',
      year: 1999,
      title: 'Metabolic adaptations to a high-fat diet in endurance cyclists',
      journal: 'Metabolism',
      pmid: '10599981',
      doi: '10.1016/s0026-0495(99)90238-x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10599981/',
    },
    {
      id: 'rosenbaum2019',
      authors: 'Rosenbaum M, Hall KD, Guo J, et al.',
      year: 2019,
      title:
        'Glucose and Lipid Homeostasis and Inflammation in Humans Following an Isocaloric Ketogenic Diet',
      journal: 'Obesity (Silver Spring)',
      pmid: '31067015',
      doi: '10.1002/oby.22468',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31067015/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/39106867/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/32697366/',
    },
    {
      id: 'burke2020',
      authors: 'Burke LM, Sharma AP, Heikura IA, et al.',
      year: 2020,
      title:
        'Crisis of confidence averted: Impairment of exercise economy and performance in elite race walkers by ketogenic low carbohydrate, high fat (LCHF) diet is reproducible',
      journal: 'PLoS One',
      pmid: '32497061',
      doi: '10.1371/journal.pone.0234027',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32497061/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/28012184/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/16188909/',
    },
    {
      id: 'burke2002',
      authors: 'Burke LM, Hawley JA, Angus DJ, et al.',
      year: 2002,
      title:
        'Adaptations to short-term high-fat diet persist during exercise despite high carbohydrate availability',
      journal: 'Med Sci Sports Exerc',
      pmid: '11782652',
      doi: '10.1097/00005768-200201000-00014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11782652/',
    },
    {
      id: 'phinney1983',
      authors: 'Phinney SD, Bistrian BR, Evans WJ, et al.',
      year: 1983,
      title:
        'The human metabolic response to chronic ketosis without caloric restriction: preservation of submaximal exercise capability with reduced carbohydrate oxidation',
      journal: 'Metabolism',
      pmid: '6865776',
      doi: '10.1016/0026-0495(83)90106-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6865776/',
    },
    {
      id: 'wilson2020',
      authors: 'Wilson JM, Lowery RP, Roberts MD, et al.',
      year: 2020,
      title:
        'Effects of Ketogenic Dieting on Body Composition, Strength, Power, and Hormonal Profiles in Resistance Training Men',
      journal: 'J Strength Cond Res',
      pmid: '28399015',
      doi: '10.1519/JSC.0000000000001935',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28399015/',
    },
    {
      id: 'bostock2020',
      authors: 'Bostock ECS, Kirkby KC, Taylor BV, et al.',
      year: 2020,
      title: 'Consumer Reports of "Keto Flu" Associated With the Ketogenic Diet',
      journal: 'Front Nutr',
      pmid: '32232045',
      doi: '10.3389/fnut.2020.00020',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32232045/',
    },
    {
      id: 'heyman2020',
      authors: 'Heyman SN, Bursztyn M, Szalat A, et al.',
      year: 2020,
      title: 'Fasting-Induced Natriuresis and SGLT: A New Hypothesis for an Old Enigma',
      journal: 'Front Endocrinol (Lausanne)',
      pmid: '32457696',
      doi: '10.3389/fendo.2020.00217',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32457696/',
    },
    {
      id: 'kerndt1982',
      authors: 'Kerndt PR, Naughton JL, Driscoll CE, et al.',
      year: 1982,
      title: 'Fasting: the history, pathophysiology and complications',
      journal: 'West J Med',
      pmid: '6758355',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6758355/',
    },
    {
      id: 'numao2013',
      authors: 'Numao S, Kawano H, Endo N, et al.',
      year: 2013,
      title:
        'Effects of a single bout of aerobic exercise on short-term low-carbohydrate/high-fat intake-induced postprandial glucose metabolism during an oral glucose tolerance test',
      journal: 'Metabolism',
      pmid: '23764436',
      doi: '10.1016/j.metabol.2013.05.005',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23764436/',
    },
    {
      id: 'retterstol2018',
      authors: 'Retterstøl K, Svendsen M, Narverud I, et al.',
      year: 2018,
      title:
        'Effect of low carbohydrate high fat diet on LDL cholesterol and gene expression in normal-weight, young adults: A randomized controlled study',
      journal: 'Atherosclerosis',
      pmid: '30408717',
      doi: '10.1016/j.atherosclerosis.2018.10.013',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30408717/',
    },
    {
      id: 'budoff2024',
      authors: 'Budoff M, Manubolu VS, Kinninger A, et al.',
      year: 2024,
      title:
        'Carbohydrate Restriction-Induced Elevations in LDL-Cholesterol and Atherosclerosis: The KETO Trial',
      journal: 'JACC Adv',
      pmid: '39372369',
      doi: '10.1016/j.jacadv.2024.101109',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39372369/',
    },
    {
      id: 'kempf2024',
      authors: 'Kempf K, Martin S.',
      year: 2024,
      title: 'Effects of a Carbohydrate Meal on Lipolysis',
      journal: 'Nutrients',
      pmid: '39458525',
      doi: '10.3390/nu16203531',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39458525/',
    },
    {
      id: 'nymo2017',
      authors: 'Nymo S, Coutinho SR, Jørgensen J, et al.',
      year: 2017,
      title: 'Timeline of changes in appetite during weight loss with a ketogenic diet',
      journal: 'Int J Obes (Lond)',
      pmid: '28439092',
      doi: '10.1038/ijo.2017.96',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28439092/',
    },
    {
      id: 'sumithran2013',
      authors: 'Sumithran P, Prendergast LA, Delbridge E, et al.',
      year: 2013,
      title: 'Ketosis and appetite-mediating nutrients and hormones after weight loss',
      journal: 'Eur J Clin Nutr',
      pmid: '23632752',
      doi: '10.1038/ejcn.2013.90',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23632752/',
    },
    {
      id: 'gibson2015',
      authors: 'Gibson AA, Seimon RV, Lee CM, et al.',
      year: 2015,
      title: 'Do ketogenic diets really suppress appetite? A systematic review and meta-analysis',
      journal: 'Obes Rev',
      pmid: '25402637',
      doi: '10.1111/obr.12230',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25402637/',
    },
    {
      id: 'schrauwen1997a',
      authors: 'Schrauwen P, van Marken Lichtenbelt WD, Saris WH, et al.',
      year: 1997,
      title: 'Changes in fat oxidation in response to a high-fat diet',
      journal: 'Am J Clin Nutr',
      pmid: '9250105',
      doi: '10.1093/ajcn/66.2.276',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9250105/',
    },
    {
      id: 'schrauwen1997b',
      authors: 'Schrauwen P, van Marken Lichtenbelt WD, Saris WH, et al.',
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
      id: 'hudgins1996',
      authors: 'Hudgins LC, Hellerstein M, Seidman C, et al.',
      year: 1996,
      title: 'Human fatty acid synthesis is stimulated by a eucaloric low fat, high carbohydrate diet',
      journal: 'J Clin Invest',
      pmid: '8621798',
      doi: '10.1172/JCI118645',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8621798/',
    },
    {
      id: 'hudgins2000',
      authors: 'Hudgins LC, Hellerstein MK, Seidman CE, et al.',
      year: 2000,
      title:
        'Relationship between carbohydrate-induced hypertriglyceridemia and fatty acid synthesis in lean and obese subjects',
      journal: 'J Lipid Res',
      pmid: '10744780',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10744780/',
    },
    {
      id: 'parks2000',
      authors: 'Parks EJ, Hellerstein MK.',
      year: 2000,
      title:
        'Carbohydrate-induced hypertriacylglycerolemia: historical perspective and review of biological mechanisms',
      journal: 'Am J Clin Nutr',
      pmid: '10648253',
      doi: '10.1093/ajcn/71.2.412',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10648253/',
    },
    {
      id: 'festi2000',
      authors: 'Festi D, Colecchia A, Larocca A, et al.',
      year: 2000,
      title: 'Review: low caloric intake and gall-bladder motor function',
      journal: 'Aliment Pharmacol Ther',
      pmid: '10903004',
      doi: '10.1046/j.1365-2036.2000.014s2051.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10903004/',
    },
    {
      id: 'gebhard1996',
      authors: 'Gebhard RL, Prigge WF, Ansel HJ, et al.',
      year: 1996,
      title: 'The role of gallbladder emptying in gallstone formation during diet-induced rapid weight loss',
      journal: 'Hepatology',
      pmid: '8781321',
      doi: '10.1002/hep.510240313',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8781321/',
    },
    {
      id: 'erlinger2000',
      authors: 'Erlinger S.',
      year: 2000,
      title: 'Gallstones in obesity and weight loss',
      journal: 'Eur J Gastroenterol Hepatol',
      pmid: '11192327',
      doi: '10.1097/00042737-200012120-00015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11192327/',
    },
    {
      id: 'johansson2014',
      authors: 'Johansson K, Sundström J, Marcus C, et al.',
      year: 2014,
      title:
        'Risk of symptomatic gallstones and cholecystectomy after a very-low-calorie diet or low-calorie diet in a commercial weight loss program: 1-year matched cohort study',
      journal: 'Int J Obes (Lond)',
      pmid: '23736359',
      doi: '10.1038/ijo.2013.83',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23736359/',
    },
    {
      id: 'bistrian1976',
      authors: 'Bistrian BR, Blackburn GL, Flatt JP, et al.',
      year: 1976,
      title:
        'Nitrogen metabolism and insulin requirements in obese diabetic adults on a protein-sparing modified fast',
      journal: 'Diabetes',
      pmid: '1278601',
      doi: '10.2337/diab.25.6.494',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1278601/',
    },
    {
      id: 'bistrian1977',
      authors: 'Bistrian DR, Winterer J, Blackburn GL, et al.',
      year: 1977,
      title:
        'Effect of a protein-sparing diet and brief fast on nitrogen metabolism in mildly obese subjects',
      journal: 'J Lab Clin Med',
      pmid: '858966',
      url: 'https://pubmed.ncbi.nlm.nih.gov/858966/',
    },
    {
      id: 'hoffer1984a',
      authors: 'Hoffer LJ, Bistrian BR, Young VR, et al.',
      year: 1984,
      title: 'Metabolic effects of very low calorie weight reduction diets',
      journal: 'J Clin Invest',
      pmid: '6707202',
      doi: '10.1172/JCI111268',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6707202/',
    },
    {
      id: 'hoffer1984b',
      authors: 'Hoffer LJ, Bistrian BR, Young VR, et al.',
      year: 1984,
      title: 'Metabolic effects of carbohydrate in low-calorie diets',
      journal: 'Metabolism',
      pmid: '6472116',
      doi: '10.1016/0026-0495(84)90108-2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6472116/',
    },
    {
      id: 'vazquez1995',
      authors: 'Vazquez JA, Kazi U, Madani N.',
      year: 1995,
      title:
        'Protein metabolism during weight reduction with very-low-energy diets: evaluation of the independent effects of protein and carbohydrate on protein sparing',
      journal: 'Am J Clin Nutr',
      pmid: '7598072',
      doi: '10.1093/ajcn/62.1.93',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7598072/',
    },
    {
      id: 'vazquez1992',
      authors: 'Vazquez JA, Adibi SA.',
      year: 1992,
      title:
        'Protein sparing during treatment of obesity: ketogenic versus nonketogenic very low calorie diet',
      journal: 'Metabolism',
      pmid: '1556948',
      doi: '10.1016/0026-0495(92)90076-m',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1556948/',
    },
    {
      id: 'palgi1985',
      authors: 'Palgi A, Read JL, Greenberg I, et al.',
      year: 1985,
      title:
        'Multidisciplinary treatment of obesity with a protein-sparing modified fast: results in 668 outpatients',
      journal: 'Am J Public Health',
      pmid: '4037162',
      doi: '10.2105/ajph.75.10.1190',
      url: 'https://pubmed.ncbi.nlm.nih.gov/4037162/',
    },
    {
      id: 'chang2014',
      authors: 'Chang J, Kashyap SR.',
      year: 2014,
      title: 'The protein-sparing modified fast for obese patients with type 2 diabetes: what to expect',
      journal: 'Cleve Clin J Med',
      pmid: '25183847',
      doi: '10.3949/ccjm.81a.13128',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25183847/',
    },
    {
      id: 'pfoh2020',
      authors: 'Pfoh ER, Lowenthal G, Jeffers L, et al.',
      year: 2020,
      title: 'The Effect of Starting the Protein-Sparing Modified Fast on Weight Change over 5 years',
      journal: 'J Gen Intern Med',
      pmid: '31916212',
      doi: '10.1007/s11606-019-05535-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31916212/',
    },
    {
      id: 'sours1981',
      authors: 'Sours HE, Frattali VP, Brand CD, et al.',
      year: 1981,
      title: 'Sudden death associated with very low calorie weight reduction regimens',
      journal: 'Am J Clin Nutr',
      pmid: '7223697',
      doi: '10.1093/ajcn/34.4.453',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7223697/',
    },
    {
      id: 'isner1979',
      authors: 'Isner JM, Sours HE, Paris AL, et al.',
      year: 1979,
      title:
        'Sudden, unexpected death in avid dieters using the liquid-protein-modified-fast diet. Observations in 17 patients and the role of the prolonged QT interval',
      journal: 'Circulation',
      pmid: '498466',
      doi: '10.1161/01.cir.60.6.1401',
      url: 'https://pubmed.ncbi.nlm.nih.gov/498466/',
    },
    {
      id: 'tsai2006',
      authors: 'Tsai AG, Wadden TA.',
      year: 2006,
      title: 'The evolution of very-low-calorie diets: an update and meta-analysis',
      journal: 'Obesity (Silver Spring)',
      pmid: '16988070',
      doi: '10.1038/oby.2006.146',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16988070/',
    },
    {
      id: 'lean2018',
      authors: 'Lean ME, Leslie WS, Barnes AC, et al.',
      year: 2018,
      title:
        'Primary care-led weight management for remission of type 2 diabetes (DiRECT): an open-label, cluster-randomised trial',
      journal: 'Lancet',
      pmid: '29221645',
      doi: '10.1016/S0140-6736(17)33102-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29221645/',
    },
    {
      id: 'lean2019',
      authors: 'Lean MEJ, Leslie WS, Barnes AC, et al.',
      year: 2019,
      title:
        'Durability of a primary care-led weight-management intervention for remission of type 2 diabetes: 2-year results of the DiRECT open-label, cluster-randomised trial',
      journal: 'Lancet Diabetes Endocrinol',
      pmid: '30852132',
      doi: '10.1016/S2213-8587(19)30068-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30852132/',
    },
    {
      id: 'astbury2018',
      authors: 'Astbury NM, Aveyard P, Nickless A, et al.',
      year: 2018,
      title:
        'Doctor Referral of Overweight People to Low Energy total diet replacement Treatment (DROPLET): pragmatic randomised controlled trial',
      journal: 'BMJ',
      pmid: '30257983',
      doi: '10.1136/bmj.k3760',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30257983/',
    },
    {
      id: 'astbury2021',
      authors: 'Astbury NM, Edwards RM, Ghebretinsea F, et al.',
      year: 2021,
      title:
        'Extended follow-up of a short total diet replacement programme: results of the Doctor Referral of Overweight People to Low Energy total diet replacement Treatment (DROPLET) randomised controlled trial at 3 years',
      journal: 'Int J Obes (Lond)',
      pmid: '34302120',
      doi: '10.1038/s41366-021-00915-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34302120/',
    },
    {
      id: 'chaston2007',
      authors: "Chaston TB, Dixon JB, O'Brien PE.",
      year: 2007,
      title: 'Changes in fat-free mass during significant weight loss: a systematic review',
      journal: 'Int J Obes (Lond)',
      pmid: '17075583',
      doi: '10.1038/sj.ijo.0803483',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17075583/',
    },
    {
      id: 'purcell2014',
      authors: 'Purcell K, Sumithran P, Prendergast LA, et al.',
      year: 2014,
      title:
        'The effect of rate of weight loss on long-term weight management: a randomised controlled trial',
      journal: 'Lancet Diabetes Endocrinol',
      pmid: '25459211',
      doi: '10.1016/S2213-8587(14)70200-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25459211/',
    },
    {
      id: 'vink2016',
      authors: 'Vink RG, Roumans NJ, Arkenbosch LA, et al.',
      year: 2016,
      title:
        'The effect of rate of weight loss on long-term weight regain in adults with overweight and obesity',
      journal: 'Obesity (Silver Spring)',
      pmid: '26813524',
      doi: '10.1002/oby.21346',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26813524/',
    },
    {
      id: 'ashtarylarky2017',
      authors: 'Ashtary-Larky D, Ghanavati M, Lamuchi-Deli N, et al.',
      year: 2017,
      title:
        'Rapid Weight Loss vs. Slow Weight Loss: Which is More Effective on Body Composition and Metabolic Risk Factors?',
      journal: 'Int J Endocrinol Metab',
      pmid: '29201070',
      doi: '10.5812/ijem.13249',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29201070/',
    },
    {
      id: 'ashtarylarky2020',
      authors: 'Ashtary-Larky D, Bagheri R, Abbasnezhad A, et al.',
      year: 2020,
      title:
        'Effects of gradual weight loss v. rapid weight loss on body composition and RMR: a systematic review and meta-analysis',
      journal: 'Br J Nutr',
      pmid: '32576318',
      doi: '10.1017/S000711452000224X',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32576318/',
    },
    {
      id: 'garthe2011',
      authors: 'Garthe I, Raastad T, Refsnes PE, et al.',
      year: 2011,
      title:
        'Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '21558571',
      doi: '10.1123/ijsnem.21.2.97',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21558571/',
    },
    {
      id: 'huovinen2015',
      authors: 'Huovinen HT, Hulmi JJ, Isolehto J, et al.',
      year: 2015,
      title:
        'Body composition and power performance improved after weight reduction in male athletes without hampering hormonal balance',
      journal: 'J Strength Cond Res',
      pmid: '25028999',
      doi: '10.1519/JSC.0000000000000619',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25028999/',
    },
    {
      id: 'mettler2010',
      authors: 'Mettler S, Mitchell N, Tipton KD.',
      year: 2010,
      title: 'Increased protein intake reduces lean body mass loss during weight loss in athletes',
      journal: 'Med Sci Sports Exerc',
      pmid: '19927027',
      doi: '10.1249/MSS.0b013e3181b2ef8e',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19927027/',
    },
    {
      id: 'longland2016',
      authors: 'Longland TM, Oikawa SY, Mitchell CJ, et al.',
      year: 2016,
      title:
        'Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss: a randomized trial',
      journal: 'Am J Clin Nutr',
      pmid: '26817506',
      doi: '10.3945/ajcn.115.119339',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26817506/',
    },
    {
      id: 'walberg1988',
      authors: 'Walberg JL, Leidy MK, Sturgill DJ, et al.',
      year: 1988,
      title:
        'Macronutrient content of a hypoenergy diet affects nitrogen retention and muscle function in weight lifters',
      journal: 'Int J Sports Med',
      pmid: '3182156',
      doi: '10.1055/s-2007-1025018',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3182156/',
    },
    {
      id: 'alpert2005',
      authors: 'Alpert SS.',
      year: 2005,
      title: 'A limit on the energy transfer rate from the human fat store in hypophagia',
      journal: 'J Theor Biol',
      pmid: '15615615',
      doi: '10.1016/j.jtbi.2004.08.029',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15615615/',
    },
    {
      id: 'helms2014',
      authors: 'Helms ER, Aragon AA, Fitschen PJ.',
      year: 2014,
      title:
        'Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation',
      journal: 'J Int Soc Sports Nutr',
      pmid: '24864135',
      doi: '10.1186/1550-2783-11-20',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24864135/',
    },
    {
      id: 'heymsfield2012',
      authors: 'Heymsfield SB, Thomas D, Martin CK, et al.',
      year: 2012,
      title: 'Energy content of weight loss: kinetic features during voluntary caloric restriction',
      journal: 'Metabolism',
      pmid: '22257646',
      doi: '10.1016/j.metabol.2011.11.012',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22257646/',
    },
    {
      id: 'hall2008',
      authors: 'Hall KD.',
      year: 2008,
      title: 'What is the required energy deficit per unit weight loss?',
      journal: 'Int J Obes (Lond)',
      pmid: '17848938',
      doi: '10.1038/sj.ijo.0803720',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17848938/',
    },
    {
      id: 'byrne2018',
      authors: 'Byrne NM, Sainsbury A, King NA, et al.',
      year: 2018,
      title:
        'Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study',
      journal: 'Int J Obes (Lond)',
      pmid: '28925405',
      doi: '10.1038/ijo.2017.206',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28925405/',
    },
    {
      id: 'peos2021a',
      authors: 'Peos JJ, Helms ER, Fournier PA, et al.',
      year: 2021,
      title:
        'Continuous versus Intermittent Dieting for Fat Loss and Fat-Free Mass Retention in Resistance-trained Adults: The ICECAP Trial',
      journal: 'Med Sci Sports Exerc',
      pmid: '33587549',
      doi: '10.1249/MSS.0000000000002636',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33587549/',
    },
    {
      id: 'peos2021b',
      authors: 'Peos JJ, Helms ER, Fournier PA, et al.',
      year: 2021,
      title:
        'A 1-week diet break improves muscle endurance during an intermittent dieting regime in adult athletes: A pre-specified secondary analysis of the ICECAP trial',
      journal: 'PLoS One',
      pmid: '33630880',
      doi: '10.1371/journal.pone.0247292',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33630880/',
    },
    {
      id: 'campbell2020',
      authors: 'Campbell BI, Aguilar D, Colenso-Semple LM, et al.',
      year: 2020,
      title:
        'Intermittent Energy Restriction Attenuates the Loss of Fat Free Mass in Resistance Trained Individuals. A Randomized Controlled Trial',
      journal: 'J Funct Morphol Kinesiol',
      pmid: '33467235',
      doi: '10.3390/jfmk5010019',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33467235/',
    },
    {
      id: 'peos2020',
      authors: 'Peos J, Brown AW, Vorland CJ, et al.',
      year: 2020,
      title:
        'Contrary to the Conclusions Stated in the Paper, Only Dry Fat-Free Mass Was Different between Groups upon Reanalysis. Comment on: "Intermittent Energy Restriction Attenuates the Loss of Fat-Free Mass in Resistance Trained Individuals. A Randomized Controlled Trial"',
      journal: 'J Funct Morphol Kinesiol',
      pmid: '33467300',
      doi: '10.3390/jfmk5040085',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33467300/',
    },
    {
      id: 'siedler2023',
      authors: 'Siedler MR, Lewis MH, Trexler ET, et al.',
      year: 2023,
      title:
        'The Effects of Intermittent Diet Breaks during 25% Energy Restriction on Body Composition and Resting Metabolic Rate in Resistance-Trained Females: A Randomized Controlled Trial',
      journal: 'J Hum Kinet',
      pmid: '37181269',
      doi: '10.5114/jhk/159960',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37181269/',
    },
    {
      id: 'poon2025',
      authors: 'Poon ET, Tsang JH, Sun F, et al.',
      year: 2025,
      title:
        'Effects of intermittent dieting with break periods on body composition and metabolic adaptation: a systematic review and meta-analysis',
      journal: 'Nutr Rev',
      pmid: '38193357',
      doi: '10.1093/nutrit/nuad168',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38193357/',
    },
    {
      id: 'roman2019',
      authors: 'Roman YM, Dominguez MC, Easow TM, et al.',
      year: 2019,
      title:
        'Effects of intermittent versus continuous dieting on weight and body composition in obese and overweight people: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'Int J Obes (Lond)',
      pmid: '30206335',
      doi: '10.1038/s41366-018-0204-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30206335/',
    },
    {
      id: 'seimon2015',
      authors: 'Seimon RV, Roekenes JA, Zibellini J, et al.',
      year: 2015,
      title:
        'Do intermittent diets provide physiological benefits over continuous diets for weight loss? A systematic review of clinical trials',
      journal: 'Mol Cell Endocrinol',
      pmid: '26384657',
      doi: '10.1016/j.mce.2015.09.014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26384657/',
    },
    {
      id: 'davoodi2014',
      authors: 'Davoodi SH, Ajami M, Ayatollahi SA, et al.',
      year: 2014,
      title: 'Calorie shifting diet versus calorie restriction diet: a comparative clinical trial study',
      journal: 'Int J Prev Med',
      pmid: '24829732',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24829732/',
    },
    {
      id: 'wing2003',
      authors: 'Wing RR, Jeffery RW.',
      year: 2003,
      title: 'Prescribed "breaks" as a means to disrupt weight control efforts',
      journal: 'Obes Res',
      pmid: '12582226',
      doi: '10.1038/oby.2003.43',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12582226/',
    },
    {
      id: 'coutinho2018',
      authors: 'Coutinho SR, Halset EH, Gåsbakk S, et al.',
      year: 2018,
      title:
        'Compensatory mechanisms activated with intermittent energy restriction: A randomized control trial',
      journal: 'Clin Nutr',
      pmid: '28446382',
      doi: '10.1016/j.clnu.2017.04.002',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28446382/',
    },
    {
      id: 'harvie2011',
      authors: 'Harvie MN, Pegington M, Mattson MP, et al.',
      year: 2011,
      title:
        'The effects of intermittent or continuous energy restriction on weight loss and metabolic disease risk markers: a randomized trial in young overweight women',
      journal: 'Int J Obes (Lond)',
      pmid: '20921964',
      doi: '10.1038/ijo.2010.171',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20921964/',
    },
    {
      id: 'harvie2013',
      authors: 'Harvie M, Wright C, Pegington M, et al.',
      year: 2013,
      title:
        'The effect of intermittent energy and carbohydrate restriction v. daily energy restriction on weight loss and metabolic disease risk markers in overweight women',
      journal: 'Br J Nutr',
      pmid: '23591120',
      doi: '10.1017/S0007114513000792',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23591120/',
    },
    {
      id: 'trepanowski2017',
      authors: 'Trepanowski JF, Kroeger CM, Barnosky A, et al.',
      year: 2017,
      title:
        'Effect of Alternate-Day Fasting on Weight Loss, Weight Maintenance, and Cardioprotection Among Metabolically Healthy Obese Adults: A Randomized Clinical Trial',
      journal: 'JAMA Intern Med',
      pmid: '28459931',
      doi: '10.1001/jamainternmed.2017.0936',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28459931/',
    },
    {
      id: 'catenacci2016',
      authors: 'Catenacci VA, Pan Z, Ostendorf D, et al.',
      year: 2016,
      title:
        'A randomized pilot study comparing zero-calorie alternate-day fasting to daily caloric restriction in adults with obesity',
      journal: 'Obesity (Silver Spring)',
      pmid: '27569118',
      doi: '10.1002/oby.21581',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27569118/',
    },
    {
      id: 'templeman2021',
      authors: 'Templeman I, Smith HA, Chowdhury E, et al.',
      year: 2021,
      title:
        'A randomized controlled trial to isolate the effects of fasting and energy restriction on weight loss and metabolic health in lean adults',
      journal: 'Sci Transl Med',
      pmid: '34135111',
      doi: '10.1126/scitranslmed.abd8034',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34135111/',
    },
    {
      id: 'headland2016',
      authors: 'Headland M, Clifton PM, Carter S, et al.',
      year: 2016,
      title:
        'Weight-Loss Outcomes: A Systematic Review and Meta-Analysis of Intermittent Energy Restriction Trials Lasting a Minimum of 6 Months',
      journal: 'Nutrients',
      pmid: '27338458',
      doi: '10.3390/nu8060354',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27338458/',
    },
    {
      id: 'headland2020',
      authors: 'Headland ML, Clifton PM, Keogh JB.',
      year: 2020,
      title:
        'Impact of intermittent vs. continuous energy restriction on weight and cardiometabolic factors: a 12-month follow-up',
      journal: 'Int J Obes (Lond)',
      pmid: '31937907',
      doi: '10.1038/s41366-020-0525-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31937907/',
    },
    {
      id: 'elortegui2023',
      authors: 'Elortegui Pascual P, Rolands MR, Eldridge AL, et al.',
      year: 2023,
      title:
        'A meta-analysis comparing the effectiveness of alternate day fasting, the 5:2 diet, and time-restricted eating for weight loss',
      journal: 'Obesity (Silver Spring)',
      pmid: '36349432',
      doi: '10.1002/oby.23568',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36349432/',
    },
    {
      id: 'semnaniazad2025',
      authors: 'Semnani-Azad Z, Khan TA, Chiavaroli L, et al.',
      year: 2025,
      title:
        'Intermittent fasting strategies and their effects on body weight and other cardiometabolic risk factors: systematic review and network meta-analysis of randomised clinical trials',
      journal: 'BMJ',
      pmid: '40533200',
      doi: '10.1136/bmj-2024-082007',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40533200/',
    },
    {
      id: 'marquet2016a',
      authors: 'Marquet LA, Brisswalter J, Louis J, et al.',
      year: 2016,
      title: 'Enhanced Endurance Performance by Periodization of Carbohydrate Intake: "Sleep Low" Strategy',
      journal: 'Med Sci Sports Exerc',
      pmid: '26741119',
      doi: '10.1249/MSS.0000000000000823',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26741119/',
    },
    {
      id: 'marquet2016b',
      authors: 'Marquet LA, Hausswirth C, Molle O, et al.',
      year: 2016,
      title: 'Periodization of Carbohydrate Intake: Short-Term Effect on Performance',
      journal: 'Nutrients',
      pmid: '27897989',
      doi: '10.3390/nu8120755',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27897989/',
    },
    {
      id: 'gejl2017',
      authors: 'Gejl KD, Thams LB, Hansen M, et al.',
      year: 2017,
      title: 'No Superior Adaptations to Carbohydrate Periodization in Elite Endurance Athletes',
      journal: 'Med Sci Sports Exerc',
      pmid: '28723843',
      doi: '10.1249/MSS.0000000000001377',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28723843/',
    },
    {
      id: 'impey2018',
      authors: 'Impey SG, Hearris MA, Hammond KM, et al.',
      year: 2018,
      title:
        'Fuel for the Work Required: A Theoretical Framework for Carbohydrate Periodization and the Glycogen Threshold Hypothesis',
      journal: 'Sports Med',
      pmid: '29453741',
      doi: '10.1007/s40279-018-0867-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29453741/',
    },
    {
      id: 'kysel2020',
      authors: 'Kysel P, Haluzíková D, Doležalová RP, et al.',
      year: 2020,
      title:
        'The Influence of Cyclical Ketogenic Reduction Diet vs. Nutritionally Balanced Reduction Diet on Body Composition, Strength, and Endurance Performance in Healthy Young Males: A Randomized Controlled Trial',
      journal: 'Nutrients',
      pmid: '32947920',
      doi: '10.3390/nu12092832',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32947920/',
    },
    {
      id: 'greene2018',
      authors: 'Greene DA, Varley BJ, Hartwig TB, et al.',
      year: 2018,
      title:
        'A Low-Carbohydrate Ketogenic Diet Reduces Body Mass Without Compromising Performance in Powerlifting and Olympic Weightlifting Athletes',
      journal: 'J Strength Cond Res',
      pmid: '30335720',
      doi: '10.1519/JSC.0000000000002904',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30335720/',
    },
    {
      id: 'rossow2013',
      authors: 'Rossow LM, Fukuda DH, Fahs CA, et al.',
      year: 2013,
      title: 'Natural bodybuilding competition preparation and recovery: a 12-month case study',
      journal: 'Int J Sports Physiol Perform',
      pmid: '23412685',
      doi: '10.1123/ijspp.8.5.582',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23412685/',
    },
    {
      id: 'kistler2014',
      authors: 'Kistler BM, Fitschen PJ, Ranadive SM, et al.',
      year: 2014,
      title: 'Case study: Natural bodybuilding contest preparation',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '24901578',
      doi: '10.1123/ijsnem.2014-0016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24901578/',
    },
    {
      id: 'pardue2017',
      authors: 'Pardue A, Trexler ET, Sprod LK.',
      year: 2017,
      title:
        'Case Study: Unfavorable But Transient Physiological Changes During Contest Preparation in a Drug-Free Male Bodybuilder',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '28770669',
      doi: '10.1123/ijsnem.2017-0064',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28770669/',
    },
    {
      id: 'chappell2018',
      authors: 'Chappell AJ, Simper T, Barker ME.',
      year: 2018,
      title: 'Nutritional strategies of high level natural bodybuilders during competition preparation',
      journal: 'J Int Soc Sports Nutr',
      pmid: '29371857',
      doi: '10.1186/s12970-018-0209-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29371857/',
    },
    {
      id: 'hulmi2016',
      authors: 'Hulmi JJ, Isola V, Suonpää M, et al.',
      year: 2016,
      title:
        'The Effects of Intensive Weight Reduction on Body Composition and Serum Hormones in Female Fitness Competitors',
      journal: 'Front Physiol',
      pmid: '28119632',
      doi: '10.3389/fphys.2016.00689',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28119632/',
    },
    {
      id: 'tinsley2019',
      authors: 'Tinsley GM, Trexler ET, Smith-Ryan AE, et al.',
      year: 2019,
      title:
        'Changes in Body Composition and Neuromuscular Performance Through Preparation, 2 Competitions, and a Recovery Period in an Experienced Female Physique Athlete',
      journal: 'J Strength Cond Res',
      pmid: '30036283',
      doi: '10.1519/JSC.0000000000002758',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30036283/',
    },
    {
      id: 'trexler2014',
      authors: 'Trexler ET, Smith-Ryan AE, Norton LE.',
      year: 2014,
      title: 'Metabolic adaptation to weight loss: implications for the athlete',
      journal: 'J Int Soc Sports Nutr',
      pmid: '24571926',
      doi: '10.1186/1550-2783-11-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24571926/',
    },
    {
      id: 'iraki2019',
      authors: 'Iraki J, Fitschen P, Espinar S, et al.',
      year: 2019,
      title: 'Nutrition Recommendations for Bodybuilders in the Off-Season: A Narrative Review',
      journal: 'Sports (Basel)',
      pmid: '31247944',
      doi: '10.3390/sports7070154',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31247944/',
    },
    {
      id: 'ribeiro2019',
      authors: 'Ribeiro AS, Nunes JP, Schoenfeld BJ, et al.',
      year: 2019,
      title:
        'Effects of Different Dietary Energy Intake Following Resistance Training on Muscle Mass and Body Fat in Bodybuilders: A Pilot Study',
      journal: 'J Hum Kinet',
      pmid: '31915482',
      doi: '10.2478/hukin-2019-0038',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31915482/',
    },
    {
      id: 'rodriguez2025',
      authors: 'Rodriguez Da Silva V, Muniz M, Shelton G, et al.',
      year: 2025,
      title:
        'The effects of reverse dieting on mitigating weight regain after a caloric deficit: a preliminary analysis',
      journal: 'J Int Soc Sports Nutr',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12381988/',
      verification: 'abstract',
    },
    {
      id: 'goodpaster2017',
      authors: 'Goodpaster BH, Sparks LM.',
      year: 2017,
      title: 'Metabolic Flexibility in Health and Disease',
      journal: 'Cell Metab',
      pmid: '28467922',
      doi: '10.1016/j.cmet.2017.04.015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28467922/',
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
      id: 'wu2011',
      authors: 'Wu GD, Chen J, Hoffmann C, et al.',
      year: 2011,
      title: 'Linking long-term dietary patterns with gut microbial enterotypes',
      journal: 'Science',
      pmid: '21885731',
      doi: '10.1126/science.1208344',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21885731/',
    },
    {
      id: 'stephen1986',
      authors: 'Stephen AM, Wiggins HS, Englyst HN, et al.',
      year: 1986,
      title:
        'The effect of age, sex and level of intake of dietary fibre from wheat on large-bowel function in thirty healthy subjects',
      journal: 'Br J Nutr',
      pmid: '2823871',
      doi: '10.1079/bjn19860116',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2823871/',
    },
    {
      id: 'pritchard2014',
      authors: 'Pritchard SE, Marciani L, Garsed KC, et al.',
      year: 2014,
      title:
        'Fasting and postprandial volumes of the undisturbed colon: normal values and changes in diarrhea-predominant irritable bowel syndrome measured using serial MRI',
      journal: 'Neurogastroenterol Motil',
      pmid: '24131490',
      doi: '10.1111/nmo.12243',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24131490/',
    },
    {
      id: 'heer2000',
      authors: 'Heer M, Baisch F, Kropp J, et al.',
      year: 2000,
      title: 'High dietary sodium chloride consumption may not induce body fluid retention in humans',
      journal: 'Am J Physiol Renal Physiol',
      pmid: '10751219',
      doi: '10.1152/ajprenal.2000.278.4.F585',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10751219/',
    },
    {
      id: 'birukov2016',
      authors: 'Birukov A, Rakova N, Lerchl K, et al.',
      year: 2016,
      title:
        'Ultra-long-term human salt balance studies reveal interrelations between sodium, potassium, and chloride intake and excretion',
      journal: 'Am J Clin Nutr',
      pmid: '27225435',
      doi: '10.3945/ajcn.116.132951',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27225435/',
    },
    {
      id: 'gillen1991',
      authors: 'Gillen CM, Lee R, Mack GW, et al.',
      year: 1991,
      title: 'Plasma volume expansion in humans after a single intense exercise protocol',
      journal: 'J Appl Physiol (1985)',
      pmid: '1761491',
      doi: '10.1152/jappl.1991.71.5.1914',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1761491/',
    },
    {
      id: 'convertino2007',
      authors: 'Convertino VA.',
      year: 2007,
      title: 'Blood volume response to physical activity and inactivity',
      journal: 'Am J Med Sci',
      pmid: '17630597',
      doi: '10.1097/MAJ.0b013e318063c6e4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17630597/',
    },
    {
      id: 'turicchi2020',
      authors: "Turicchi J, O'Driscoll R, Horgan G, et al.",
      year: 2020,
      title:
        'Weekly, seasonal and holiday body weight fluctuation patterns among individuals engaged in a European multi-centre behavioural weight loss maintenance intervention',
      journal: 'PLoS One',
      pmid: '32353079',
      doi: '10.1371/journal.pone.0232152',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32353079/',
    },
    {
      id: 'orsama2014',
      authors: 'Orsama AL, Mattila E, Ermes M, et al.',
      year: 2014,
      title: 'Weight rhythms: weight increases during weekends and decreases during weekdays',
      journal: 'Obes Facts',
      pmid: '24504358',
      doi: '10.1159/000356147',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24504358/',
    },
    {
      id: 'lipsitz1985',
      authors: 'Lipsitz LA, Storch HA, Minaker KL, et al.',
      year: 1985,
      title: 'Intra-individual variability in postural blood pressure in the elderly',
      journal: 'Clin Sci (Lond)',
      pmid: '4064574',
      doi: '10.1042/cs0690337',
      url: 'https://pubmed.ncbi.nlm.nih.gov/4064574/',
    },
    {
      id: 'white2011',
      authors: 'White CP, Hitchcock CL, Vigna YM, et al.',
      year: 2011,
      title: 'Fluid Retention over the Menstrual Cycle: 1-Year Data from the Prospective Ovulation Cohort',
      journal: 'Obstet Gynecol Int',
      pmid: '21845193',
      doi: '10.1155/2011/138451',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21845193/',
    },
    {
      id: 'takano2026',
      authors: 'Takano Y, Shirai T, Tanaka Y, et al.',
      year: 2026,
      title:
        'The difference between subjective symptoms and objective symptom of edema during the menstrual cycle',
      journal: 'Sci Rep',
      pmid: '42225881',
      doi: '10.1038/s41598-026-55554-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42225881/',
    },
    {
      id: 'bisson1992',
      authors: "Bisson DL, Dunster GD, O'Hare JP, et al.",
      year: 1992,
      title:
        'Renal sodium retention does not occur during the luteal phase of the menstrual cycle in normal women',
      journal: 'Br J Obstet Gynaecol',
      pmid: '1534995',
      doi: '10.1111/j.1471-0528.1992.tb14507.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1534995/',
    },
    {
      id: 'stachenfeld2008',
      authors: 'Stachenfeld NS.',
      year: 2008,
      title: 'Sex hormone effects on body fluid regulation',
      journal: 'Exerc Sport Sci Rev',
      pmid: '18580296',
      doi: '10.1097/JES.0b013e31817be928',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18580296/',
    },
    {
      id: 'pietzner2024',
      authors: 'Pietzner M, Uluvar B, Kolnes KJ, et al.',
      year: 2024,
      title: 'Systemic proteome adaptions to 7-day complete caloric restriction in humans',
      journal: 'Nat Metab',
      pmid: '38429390',
      doi: '10.1038/s42255-024-01008-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38429390/',
    },
    {
      id: 'laurens2021',
      authors: 'Laurens C, Grundler F, Damiot A, et al.',
      year: 2021,
      title:
        'Is muscle and protein loss relevant in long-term fasting in healthy men? A prospective trial on physiological adaptations',
      journal: 'J Cachexia Sarcopenia Muscle',
      pmid: '34668663',
      doi: '10.1002/jcsm.12766',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34668663/',
    },
    {
      id: 'wilhelmi2019',
      authors: 'Wilhelmi de Toledo F, Grundler F, Bergouignan A, et al.',
      year: 2019,
      title:
        'Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects',
      journal: 'PLoS One',
      pmid: '30601864',
      doi: '10.1371/journal.pone.0209353',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30601864/',
    },
    {
      id: 'wei2017',
      authors: 'Wei M, Brandhorst S, Shelehchi M, et al.',
      year: 2017,
      title:
        'Fasting-mimicking diet and markers/risk factors for aging, diabetes, cancer, and cardiovascular disease',
      journal: 'Sci Transl Med',
      pmid: '28202779',
      doi: '10.1126/scitranslmed.aai8700',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28202779/',
    },
    {
      id: 'bak2016',
      authors: 'Bak AM, Møller AB, Vendelbo MH, et al.',
      year: 2016,
      title:
        'Differential regulation of lipid and protein metabolism in obese vs. lean subjects before and after a 72-h fast',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '27245338',
      doi: '10.1152/ajpendo.00464.2015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27245338/',
    },
    {
      id: 'johnstone2002',
      authors: 'Johnstone AM, Faber P, Gibney ER, et al.',
      year: 2002,
      title: 'Effect of an acute fast on energy compensation and feeding behaviour in lean men and women',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '12461679',
      doi: '10.1038/sj.ijo.0802151',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12461679/',
    },
    {
      id: 'mehanna2008',
      authors: 'Mehanna HM, Moledina J, Travis J.',
      year: 2008,
      title: 'Refeeding syndrome: what it is, and how to prevent and treat it',
      journal: 'BMJ',
      pmid: '18583681',
      doi: '10.1136/bmj.a301',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18583681/',
    },
    {
      id: 'dasilva2020',
      authors: 'da Silva JSV, Seres DS, Sabino K, et al.',
      year: 2020,
      title: 'ASPEN Consensus Recommendations for Refeeding Syndrome',
      journal: 'Nutr Clin Pract',
      pmid: '32115791',
      doi: '10.1002/ncp.10474',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32115791/',
    },
    {
      id: 'spaulding1976',
      authors: 'Spaulding SW, Chopra IJ, Sherwin RS, et al.',
      year: 1976,
      title: 'Effect of caloric restriction and dietary composition of serum T3 and reverse T3 in man',
      journal: 'J Clin Endocrinol Metab',
      pmid: '1249190',
      doi: '10.1210/jcem-42-1-197',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1249190/',
    },
    {
      id: 'mathieson1986',
      authors: 'Mathieson RA, Walberg JL, Gwazdauskas FC, et al.',
      year: 1986,
      title:
        'The effect of varying carbohydrate content of a very-low-caloric diet on resting metabolic rate and thyroid hormones',
      journal: 'Metabolism',
      pmid: '3702673',
      doi: '10.1016/0026-0495(86)90126-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3702673/',
    },
    {
      id: 'danforth1979',
      authors: "Danforth E, Horton ES, O'Connell M, et al.",
      year: 1979,
      title: 'Dietary-induced alterations in thyroid hormone metabolism during overnutrition',
      journal: 'J Clin Invest',
      pmid: '500814',
      doi: '10.1172/JCI109590',
      url: 'https://pubmed.ncbi.nlm.nih.gov/500814/',
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
      id: 'boden1996',
      authors: 'Boden G, Chen X, Mozzoli M, et al.',
      year: 1996,
      title: 'Effect of fasting on serum leptin in normal human subjects',
      journal: 'J Clin Endocrinol Metab',
      pmid: '8784108',
      doi: '10.1210/jcem.81.9.8784108',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8784108/',
    },
    {
      id: 'chinchance2000',
      authors: 'Chin-Chance C, Polonsky KS, Schoeller DA.',
      year: 2000,
      title:
        'Twenty-four-hour leptin levels respond to cumulative short-term energy imbalance and predict subsequent intake',
      journal: 'J Clin Endocrinol Metab',
      pmid: '10946866',
      doi: '10.1210/jcem.85.8.6755',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10946866/',
    },
    {
      id: 'hengist2023',
      authors: 'Hengist A, Davies RG, Rogers PJ, et al.',
      year: 2023,
      title:
        'Restricting sugar or carbohydrate intake does not impact physical activity level or energy intake over 24 h despite changes in substrate use: a randomised crossover study in healthy men and women',
      journal: 'Eur J Nutr',
      pmid: '36326863',
      doi: '10.1007/s00394-022-03048-x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36326863/',
    },
    {
      id: 'kojima2025',
      authors: 'Kojima C, Namma-Motonaga K, Kamei A, et al.',
      year: 2025,
      title: 'Dynamics of muscle glycogen increase in brachial and thigh muscles with carbohydrate loading',
      journal: 'Eur J Appl Physiol',
      pmid: '40285856',
      doi: '10.1007/s00421-025-05777-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40285856/',
    },
    {
      id: 'lin2025',
      authors: 'Lin SD, Chen TC, Wang HH.',
      year: 2025,
      title:
        'Cryocompression Therapy for Recovery from Eccentric Exercise-Induced Muscle Damage in Healthy Young Men',
      journal: 'Sports (Basel)',
      pmid: '41003596',
      doi: '10.3390/sports13090290',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41003596/',
    },
    {
      id: 'numao2016',
      authors: 'Numao S, Kawano H, Endo N, et al.',
      year: 2016,
      title:
        'Short-term high-fat diet alters postprandial glucose metabolism and circulating vascular cell adhesion molecule-1 in healthy males',
      journal: 'Appl Physiol Nutr Metab',
      pmid: '27454856',
      doi: '10.1139/apnm-2015-0702',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27454856/',
    },
    {
      id: 'sawka2000',
      authors: 'Sawka MN, Convertino VA, Eichner ER, et al.',
      year: 2000,
      title:
        'Blood volume: importance and adaptations to exercise training, environmental stresses, and trauma/sickness',
      journal: 'Med Sci Sports Exerc',
      pmid: '10694114',
      doi: '10.1097/00005768-200002000-00012',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10694114/',
    },
  ],
};

export default topic;
