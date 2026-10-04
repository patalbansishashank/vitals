import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '16',
  slug: 'sleep-sex-age',
  title: 'Sleep, stress, sex, menstrual cycle, menopause, age and other person-level moderators',
  scope:
    'This topic covers the person-level and lifestyle factors that change how the core model behaves: sleep, stress, sex, the menstrual cycle and menopause, age, starting body fat, and how much people differ from the average. It also covers how caffeine, alcohol, evening meals and diet affect sleep. These factors adjust other mechanisms rather than replace them, and sleep is the only lifestyle factor with effects big enough to change an 8–12-week projection.',
  mechanisms: [
    {
      id: '16-sleep-deficit-dynamics',
      title: 'Sleep debt: how Vitals counts short sleep and how fast it builds and clears',
      category: 'recovery',
      summary:
        'Vitals turns each night into a sleep debt: how many hours you slept below 7 hours of actual sleep (this topic suggests 7.5), plus a fixed add-on for fragmented sleep or shift work. Two running averages follow that debt. A fast one drives appetite and next-day performance. A slow one drives insulin sensitivity, muscle protein building and testosterone. Debt builds within days and clears more slowly, and sleeping more than 7.5 hours earns no credit.',
      howModelled:
        'You enter your sleep times or hours per night. The default (23:00 to 07:00) adds no debt, and only nights shorter than 7 hours count, rather than the 7.5 hours suggested here. Poor sleep quality adds 0.75 hours of “equivalent debt” and a shift-work flag adds 1.0 hour. Each night the debt is blended into the fast and slow averages, using a faster time constant when debt is rising than when it is falling. Both averages are capped at 4 hours (5 for testosterone). Other mechanisms in this topic read these two numbers.',
      equation:
        'd_t = max(0, 7.5 − sleepHours_t) + qualityEq\na(τ) = 1 − exp(−1/τ)\ndF_t = dF_{t−1} + a(τ_F) × (d_t − dF_{t−1}),  τ_F = 1 d if d_t > dF_{t−1}, else 2 d   (appetite, performance)\ndS_t = dS_{t−1} + a(τ_S) × (d_t − dS_{t−1}),  τ_S = 3 d if d_t > dS_{t−1}, else 5 d   (insulin sensitivity, muscle protein synthesis, testosterone, P-ratio)\nCaps: dF ≤ 4, dS ≤ 4 (5 for testosterone). Sleep above 7.5 h earns no credit.',
      keyNumbers: [
        {
          label: 'Reference sleep',
          value: '7.5 h of actual sleep (range 7–8)',
          note: 'The well-rested arm of one trial got 7 h 25 min of actual sleep on 8.5 h in bed. Adult guidelines of 7–9 h were not checked against a source.',
          referenceIds: ['nedeltcheva2010'],
        },
        {
          label: 'Time in bed vs actual sleep',
          value: '8.5 h in bed gave 7 h 25 min of sleep; 5.5 h in bed gave 5 h 14 min',
          note: 'For 4–5 h in bed the model assumes about 3.8–4.7 h of actual sleep (about 95 % efficiency); this is unverified.',
          referenceIds: ['nedeltcheva2010'],
        },
        {
          label: 'Time constants',
          value: 'Fast debt τ 1 d on / 2 d off; slow debt τ 3 d on / 5 d off (each ±50 %)',
          note: 'Inferred from a handful of fixed-length protocols: one night of 4 h sleep raised next-day intake by 559 kcal; recovery sleep immediately lowered intake and hunger; fat-cell insulin signalling changed by 4 nights and whole-body insulin sensitivity by 7 nights; 2 recovery nights did not restore insulin sensitivity; weekend recovery failed to prevent its loss.',
          referenceIds: [
            'buxton2010',
            'broussard2012',
            'markwald2013',
            'brondel2010',
            'depner2019',
            'ness2019',
          ],
        },
        {
          label: 'Worked example: 5 h a night for 7 nights (debt 2.5 h)',
          value: 'Slow debt 0.71, 1.22, 1.58, 1.84, 2.03, 2.16 and 2.26 h on nights 1–7',
          note: 'Calculated with the model’s onset smoothing factor of 0.283.',
        },
        {
          label: 'Weekly clamp studies under a 1.3 h/night deficit (19 men, 3 weeks)',
          value: 'Insulin-sensitivity changes were non-monotonic over 3 weeks',
          referenceIds: ['robertson2013'],
        },
      ],
      timeCourse:
        'Fast debt: builds with a time constant of 1 day and clears over 2 days. Slow debt: builds over 3 days and clears over 5 days. Two recovery nights removed about a third of the slow debt in the model, in line with the trial that found insulin sensitivity was not restored.',
      moderators:
        'Sleep duration, sleep quality and shift work (through the equivalent-debt add-ons). Sleep above 7.5 h does not bank credit; it only repays existing debt.',
      grade: 'B',
      gradeReason:
        'The existence and rough time scales are supported by several human studies, but the exact time constants are grade C because no dense time-course exists.',
      status: 'proposed-fit',
      caveats:
        'The structure is a proposal for Vitals, not a published model. Time constants are inferred from a few fixed-duration protocols, and nobody has measured recovery over weeks after chronic restriction.',
      referenceIds: [
        'nedeltcheva2010',
        'buxton2010',
        'broussard2012',
        'markwald2013',
        'brondel2010',
        'depner2019',
        'ness2019',
        'robertson2013',
      ],
      relatedMetricIds: ['insulinSensitivity', 'hunger', 'cortisol', 'testosterone'],
    },
    {
      id: '16-sleep-energy-intake-hunger',
      title: 'Short sleep raises appetite and unplanned eating',
      category: 'hormones',
      summary:
        'Short sleep does not slow your metabolism. Measured energy expenditure stays the same, or rises about 5 % because you are awake longer. What changes is eating: when people are free to eat, they take in more, mostly as late-evening snacks that are richer in fat and lower in protein. Several meta-analyses and one objectively measured trial agree on the direction and rough size.',
      howModelled:
        'Vitals always simulates the intake you enter, so no unplanned calories are added (the free-eating version, extra intake of 4 % of maintenance per hour of fast sleep debt capped at 16 %, is not built). Instead each hour of fast sleep debt, up to 4 hours, adds about 100 kcal a day of extra appetite to the hunger score, which also lowers the modelled chance of sticking to the plan. Hormones such as leptin and ghrelin are not used as drivers.',
      equation:
        'ΔEI = min(0.16, 0.04 × dF) × maintenance kcal   (band 0.025–0.06 per hour)\nHunger VAS += 4 × dF points (cap +16)\nOptional outputs (grade C/D): leptin × (1 − 0.03 × dS); ghrelin × (1 + 0.03 × dS)\nDefault composition of extra intake (low confidence): 45 % fat, 45 % carbohydrate, 10 % protein by energy, mostly 19:00–04:00',
      keyNumbers: [
        {
          label: 'Meta-analysis, partial sleep deprivation (11 RCTs with data, n = 172)',
          value:
            '+385 kcal/d (95 % CI 252–517); expenditure unchanged; more fat, less protein, no change in carbohydrate',
          referenceIds: ['alkhatib2017'],
        },
        {
          label: 'Meta-analysis, sleep restriction (41 RCTs)',
          value:
            '+252.8 kcal/d (p = 0.011); hunger +13.4 mm on a 100-mm scale; weight +0.34 kg; insulin sensitivity SMD −0.70; no consistent leptin, ghrelin or expenditure effect',
          note: 'SMD is a standardised mean difference, a unit-free effect size.',
          referenceIds: ['zhu2019'],
        },
        {
          label: 'Meta-analysis, partial deprivation (6 studies)',
          value: '+149.9 kcal/d (95 % CI 10–290)',
          referenceIds: ['gonzalezortiz2020'],
        },
        {
          label: 'One night of about 4 h vs about 8 h (12 men)',
          value: '+559 ± 617 kcal (22 %) next day; pre-meal hunger up',
          referenceIds: ['brondel2010'],
        },
        {
          label: 'Two-week ad libitum study (11 adults), 5.5 vs 8.5 h in bed',
          value:
            'Snack calories 1,087 vs 866 (+221); meals unchanged; total expenditure 2,526 vs 2,390 kcal (not significant)',
          referenceIds: ['nedeltcheva2009'],
        },
        {
          label: '8 nights at two-thirds of usual sleep',
          value: '+559 kcal/d vs control −118 (net +677, 148–1,206); activity energy unchanged',
          referenceIds: ['calvin2013'],
        },
        {
          label: '14 days inpatient, 4 h vs 9 h (12 adults)',
          value: 'Net +308 kcal/d (59–557); +17 % vs +6 % from baseline; protein intake up 13 %, fat 17 %',
          referenceIds: ['covassin2022'],
        },
        {
          label: '5 days at 5 h vs 9 h (16 adults)',
          value:
            'Total expenditure about +5 %; excess intake especially after dinner; weight +0.82 ± 0.47 kg in 5 days',
          referenceIds: ['markwald2013'],
        },
        {
          label: '5 nights at 4 h vs 10 h (225 people)',
          value:
            'Weight +0.97 ± 1.4 kg vs +0.11 ± 1.9 (d = 0.51); late-night (22:00–03:59) intake +552.9 ± 265.8 kcal',
          referenceIds: ['spaeth2013'],
        },
        {
          label: 'Sleep extension in habitual short sleepers (80 adults, BMI 25–29.9, 2 weeks)',
          value:
            '+1.2 h/night (1.0–1.4) gave −270 kcal/d (−393 to −147), a slope of −162 kcal/d per extra hour (−247 to −78); expenditure unchanged; weight −0.87 kg (−1.39 to −0.35) vs control',
          note: 'Intake measured with doubly labelled water and weighed food.',
          referenceIds: ['tasali2022'],
        },
        {
          label: 'Two nights at 4 h vs 10 h in bed (12 men, controlled intake)',
          value:
            'Leptin −18 %; ghrelin +28 %; hunger +24 %; appetite +23 %; craving for calorie-dense carbohydrate +33–45 %',
          referenceIds: ['spiegel2004'],
        },
        {
          label: 'Model check at 2,400 kcal maintenance',
          value:
            'Predicts 336 kcal for a debt of about 3.5 h (meta-analysis: 385); 288 for about 3 h (253); 384 at the cap for about 4.5 h (308); 192 for about 2 h (150); −115 for a 1.2 h change (−270 in the extension trial)',
          note: 'The real-life extension slope sits at or above the top of the band, so the interface shows the upper edge.',
        },
        {
          label: 'Epidemiology (context)',
          value:
            'Adults with short sleep: OR 1.55 for obesity (95 % CI 1.43–1.68); −0.35 BMI units per hour of sleep',
          note: 'Cross-sectional, so it cannot show cause.',
          referenceIds: ['cappuccio2008'],
        },
      ],
      timeCourse:
        'One night of short sleep raised intake the next day. The fast debt has a time constant of 1 day on and 2 days off, and recovery sleep immediately lowers intake and hunger.',
      moderators:
        'No sex or BMI multiplier is applied. Women lost dietary restraint and gained weight in one trial, men gained more in another, and women’s weekend intake returned to baseline while men’s did not. Most lab samples were normal-weight; the extension trial was in overweight adults.',
      grade: 'A',
      gradeReason:
        'Several meta-analyses and one objectively measured randomised trial agree on direction and order of magnitude; the exact size per hour is only grade B because trials are heterogeneous and lab protocols extreme.',
      status: 'proposed-fit',
      caveats:
        "An earlier systematic review also concluded that experimental restriction raises intake and expenditure with inconsistent net effects on weight. The model does not drive intake from leptin and ghrelin changes, because meta-analytic support is weak and ad libitum trials found none; ghrelin did rise under deficit plus short sleep in one trial. Unplanned intake is never added: Vitals has no free-eating mode, and the Planner's robustness check varies model parameters, not intake.",
      referenceIds: [
        'alkhatib2017',
        'zhu2019',
        'gonzalezortiz2020',
        'capers2015',
        'tasali2022',
        'spiegel2004',
        'markwald2013',
        'covassin2022',
        'nedeltcheva2009',
        'brondel2010',
        'calvin2013',
        'spaeth2013',
        'depner2019',
        'cappuccio2008',
      ],
      relatedMetricIds: ['hunger'],
    },
    {
      id: '16-sleep-fat-loss-composition',
      title: 'Short sleep and what a diet takes off: fat or lean mass?',
      category: 'body',
      summary:
        'In a small crossover trial, people on the same reduced-calorie diet lost less fat and more lean mass when they slept 5.5 hours instead of 8.5 hours. A larger second trial found no difference in the amount of fat or lean mass lost, only in a ratio. So the effect is plausible but not replicated at full size. Vitals applies half of the first trial’s effect and shows a range that includes zero.',
      howModelled:
        'When you are in an energy deficit, the engine nudges the share of weight lost as lean tissue upward by 0.04 (on the “P-ratio”, the fraction of weight change that is protein energy) for each hour of slow sleep debt, capped at 0.12. The nudge scales down for deficits smaller than 15 % of maintenance and does not apply in surplus. Energy balance itself is left unchanged.',
      equation:
        'P = 0.21 × FFM_g × 4.32 / (0.21 × FFM_g × 4.32 + FM_g × 9.46)   (P-ratio; 21 % protein in fat-free mass, 4.32 kcal/g protein, 9.46 kcal/g fat)\npRatioShift = +0.04 × dS × min(1, deficitFraction/0.15), cap +0.12, applied only when energy balance is negative',
      keyNumbers: [
        {
          label:
            'Crossover trial (10 adults, 3 women, age 41, BMI 27.4; 14 d at 90 % of resting rate, about 1,450 kcal/d)',
          value:
            '8.5 h vs 5.5 h in bed: weight loss about 3 kg in both; fat lost 1.4 ± 0.9 vs 0.6 ± 0.6 kg (−55 %, P = 0.043); fat-free mass lost 1.5 vs 2.4 kg (+60 %, P = 0.002); fat share of weight lost 56 % vs 25 %',
          note: 'Actual sleep 7 h 25 min vs 5 h 14 min. Composition implied about 400 kcal/d lower expenditure, but doubly labelled water could not confirm it.',
          referenceIds: ['nedeltcheva2010'],
        },
        {
          label: 'Second trial (36 adults, 80 % women, age 45, 8 weeks at 95 % of resting rate)',
          value:
            'Weight −3.3 ± 3.2 vs −3.2 ± 2.5 kg; fat −1.9 ± 2.1 vs −1.8 ± 1.7 kg; lean −0.71 ± 0.93 vs −0.72 ± 1.2 kg (no absolute differences)',
          note: 'Only the proportion of mass lost as fat differed: median 82.7 % (IQR 58.6–111.6) vs 58.4 % (−12.7 to 73.6), p = 0.016. The groups differed at baseline (BMI 31.3 vs 35.1) and sleep was cut by only about 24 min a day.',
          referenceIds: ['wang2018'],
        },
        {
          label: 'Observational, 296 adults in a 12-month behavioural programme',
          value:
            'Baseline short sleep (under 6 h): 4.5 ± 1.3 % less weight loss (mean loss 6.9 %); poor sleep quality 2.2 ± 1.2 % less',
          note: 'The abstract does not say whether the percentages are points or relative.',
          referenceIds: ['kline2026'],
        },
        {
          label: 'P-ratio in the two trials',
          value:
            'First trial 0.093 vs 0.277 (ΔP = +0.18 for about 2.2 h less sleep); second trial 0.035 vs 0.037 (ΔP about 0)',
          note: 'Lean soft tissue on DXA (a body-composition scan) was used as a proxy for fat-free mass in the second trial.',
        },
        {
          label: 'Model prediction',
          value:
            'At a slow debt of 2.3 h, a baseline P-ratio of 0.09 rises to about 0.18 (first trial about 0.28); uncertainty 0 to +0.08 per hour',
          note: 'The lower edge is zero and must be displayed.',
        },
        {
          label: 'Overfeeding',
          value: 'No difference in DXA fat or lean gain between short and normal sleep',
          referenceIds: ['covassin2022'],
        },
      ],
      timeCourse:
        'The trials ran 14 days and 8 weeks; the effect follows the slow sleep debt, which builds over about 3 days.',
      moderators:
        'Size of the deficit (the shift scales up to a 15 % deficit), sleep debt, and energy balance (no effect in surplus).',
      grade: 'C',
      gradeReason:
        'Only 10 and 36 people, with conflicting endpoint patterns, one baseline imbalance and no larger replication.',
      status: 'contested',
      caveats:
        'No third randomised trial with a body-composition endpoint under a controlled deficit was found. The plausible mechanism (ghrelin and respiratory-quotient shifts, lower muscle protein synthesis) is supported by other studies, but the size is a judgement call. A third trial is the most valuable missing evidence. The roughly 400 kcal/d of “missing expenditure” in the first trial is unconfirmed and is not modelled.',
      referenceIds: ['nedeltcheva2010', 'wang2018', 'saner2020', 'lamon2021', 'covassin2022', 'kline2026'],
      relatedMetricIds: ['leanTissue', 'fatMass'],
    },
    {
      id: '16-sleep-insulin-sensitivity',
      title: 'Short sleep lowers insulin sensitivity',
      category: 'cardio',
      summary:
        'Insulin sensitivity, how well the body clears sugar for a given amount of insulin, falls within four to seven nights of short sleep. It falls in fat cells, the liver and muscle. Catching up on two nights of long sleep did not restore it. Vitals reduces sensitivity by 7 % for each hour of slow sleep debt, up to 4 hours.',
      howModelled:
        'The engine multiplies insulin sensitivity by a factor that falls linearly with slow sleep debt. The result feeds the glucose and insulin dynamics and the HOMA-IR output (an insulin-resistance index). Because slow debt clears more slowly than it builds, the factor recovers slowly after sleep improves. The person-to-person spread is large, so the interface shows a band.',
      equation: 'siMult = 1 − 0.07 × min(dS, 4)   (0.03–0.10 per hour)',
      keyNumbers: [
        {
          label: '5 h vs 10 h in bed for 7 nights (20 men aged 20–35, diet controlled)',
          value:
            'Insulin sensitivity (intravenous glucose tolerance test) −20 ± 24 % (P = 0.001); clamp −11 ± 5.5 % (P < 0.04); insulin secretion unchanged; salivary cortisol +51 %',
          referenceIds: ['buxton2010'],
        },
        {
          label: '4.5 vs 8.5 h in bed for 4 nights (7 adults)',
          value:
            'Fat-cell half-maximal pAkt insulin dose 0.71 vs 0.24 nM (about 3×); pAkt area under curve −30 %; whole-body sensitivity lower (P = 0.02)',
          referenceIds: ['broussard2012'],
        },
        {
          label: 'Repeated restriction (36 adults, 5 h for 9 nights, with and without weekend recovery)',
          value:
            'Whole-body insulin sensitivity −13 % with restriction; with weekend recovery, whole-body, liver and muscle sensitivity −9 % to −27 % during recurring restriction',
          referenceIds: ['depner2019'],
        },
        {
          label: '5 nights at 5 h then 2 nights at 10 h (15 men)',
          value:
            'Insulin sensitivity lower (P = 0.002); the disposition index was not recovered after 2 recovery nights',
          referenceIds: ['ness2019'],
        },
        {
          label: 'Meta-analysis (41 RCTs)',
          value: 'Insulin sensitivity SMD −0.70 (p < 0.01)',
          referenceIds: ['zhu2019'],
        },
        {
          label: 'Slow-wave sleep suppression with total sleep time unchanged',
          value:
            'Marked fall in insulin sensitivity without adequate insulin compensation; the change tracked the change in slow-wave sleep',
          note: 'The numeric size is unverified because the abstract gives none.',
          referenceIds: ['tasali2008'],
        },
        {
          label: 'Sleep restriction plus circadian disruption (3 weeks at 5.6 h per 24 h, with 28-hour days)',
          value:
            'Insulin secretion to a meal −32 %; post-meal glucose up; resting rate −8 %; effects were the same in young and older adults',
          referenceIds: ['buxton2012'],
        },
        {
          label: 'Model checks',
          value:
            '5 h for 7 nights (slow debt about 2.3 h) → −16 %; 4.5 h in bed for 4 nights → −17 %; 4 h for 5 nights → up to −25 %; night 7 of 5 h gives 0.84 (band 0.77–0.93; measured 0.80–0.89); after 2 recovery nights about 67 % of the debt remains (2.26 → 1.52 h)',
          note: 'Between-person SD is large (±24 %).',
        },
      ],
      timeCourse:
        'Fat-cell signalling changed by 4 nights and whole-body sensitivity by 7 nights of restriction. Recovery is slower than onset: two long nights did not restore sensitivity, and weekend recovery did not prevent its loss.',
      moderators:
        'Number and depth of short nights, and person-to-person differences. The trials were small, inpatient studies, mostly in men.',
      grade: 'B',
      gradeReason:
        'The direction is supported by a meta-analysis of 41 RCTs, but the size per hour comes from four small inpatient studies, mostly in men.',
      status: 'proposed-fit',
      caveats:
        'Weekend catch-up sleep is not an effective repair according to these data. Insulin sensitivity changes over 3 weeks of mild home restriction were non-monotonic in one study, so the linear rule is a simplification.',
      referenceIds: [
        'zhu2019',
        'buxton2010',
        'broussard2012',
        'depner2019',
        'ness2019',
        'robertson2013',
        'buxton2012',
        'tasali2008',
      ],
      relatedMetricIds: ['insulinSensitivity', 'fastingGlucose'],
    },
    {
      id: '16-sleep-muscle-protein-testosterone',
      title: 'Short sleep lowers muscle protein building and testosterone',
      category: 'body',
      summary:
        'In two small human studies, short sleep cut the rate at which muscle builds new protein by 18–19 %, while breakdown did not change. In young men, a week of 5-hour nights lowered daytime testosterone by 10–13 %. A single night of no sleep dropped testosterone by 24 % and raised cortisol. How much of this shows up as lost muscle over months is unknown.',
      howModelled:
        'The engine scales the muscle-building response after meals and training by a factor that falls 5 % per hour of slow sleep debt, capped at 20 %. Testosterone in men falls by the same rate per hour, capped at 25 %. The proposed option to restore muscle protein synthesis when at least three high-intensity interval sessions are done in five days is not built. Women get the muscle factor but no testosterone term. Cortisol is shown only as a range and is never a driver.',
      equation:
        'mpsMult = 1 − 0.05 × min(dS, 4)   (cap −20 %)\ntestosteroneMult (men) = 1 − 0.05 × min(dS, 5)   (cap −25 %)',
      keyNumbers: [
        {
          label: 'Myofibrillar protein synthesis after 5 nights of 4 h in bed (24 men)',
          value:
            '1.24 ± 0.21 %/d vs 1.53 ± 0.09 with normal sleep (−19 %); with 3 high-intensity interval sessions 1.61 ± 0.14 (restored)',
          note: 'No change in signalling proteins p-AKT, p-mTOR, FOXO or LC3.',
          referenceIds: ['saner2020'],
        },
        {
          label: 'One night of total sleep deprivation (13 people, 7 men)',
          value:
            'Muscle protein synthesis after a meal 0.072 → 0.059 %/h (−18 %, p = 0.040); cortisol +21 % (p = 0.030); testosterone −24 % (p = 0.029)',
          referenceIds: ['lamon2021'],
        },
        {
          label: '5 h vs 10 h in bed (10 men, 8 nights)',
          value:
            'Daytime testosterone 16.5 vs 18.4 nmol/L (−10 %, P = 0.049); 14:00–22:00 15.5 vs 17.9 (−13 %, P = 0.02); cortisol profile unchanged; vigour score 28 → 19',
          referenceIds: ['leproult2011'],
        },
        {
          label: 'Model checks',
          value:
            'Testosterone ≈ 0.87–0.88 at night 7–8 of 5 h; muscle factor 0.85 at night 5 of 4 h in bed (0.815 at steady state; measured 0.81)',
          note: 'Rates per hour: 0.05 (range 0.03–0.07) for both.',
        },
        {
          label: 'Cortisol',
          value: '+0 to +20 % at slow debt of 2.5 h or more',
          note: 'Results conflict: salivary +51 % in one study, +21 % acute in another, unchanged in a third.',
          referenceIds: ['buxton2010', 'lamon2021', 'leproult2011'],
        },
      ],
      timeCourse:
        'Muscle protein synthesis was lower within 5 nights of restriction; testosterone within 8 nights; both followed the slow debt in the model (built over 3 days, cleared over 5).',
      moderators:
        'Sex: no chronic sleep-restriction hormone data were found for women, so women get the muscle factor but no testosterone term. High-intensity interval exercise restored synthesis in one trial.',
      grade: 'B',
      gradeReason:
        'Two controlled human studies agree on an 18–19 % fall in muscle protein synthesis, but both are small and short; the effect on muscle mass over months is grade C.',
      status: 'proposed-fit',
      caveats:
        'The muscle factor applies to the response term of muscle protein synthesis, because breakdown did not change in either trial. The one chronic lean-mass finding comes from a single small diet study (see the fat-loss mechanism). Cortisol data conflict, so it is never used to drive other parts of the model.',
      referenceIds: ['nedeltcheva2010', 'buxton2010', 'saner2020', 'lamon2021', 'leproult2011'],
      relatedMetricIds: ['mps', 'rtMuscleGain', 'testosterone'],
    },
    {
      id: '16-sleep-energy-expenditure',
      title: 'Sleep and energy expenditure: no drop, except with shift work',
      category: 'energy',
      summary:
        'Short sleep by itself does not lower measured energy expenditure. Most studies find no change, and one found about 5 % more because of extra time awake. Expenditure did fall in studies that combined short sleep with a disrupted body clock, and on night-shift days. Vitals therefore applies no change for plain short sleep, and shift work enters only as extra sleep debt.',
      howModelled:
        'For short sleep alone, total daily energy expenditure is unchanged. The proposed shift-work adjustments (×0.97 on night-shift days, ×0.85 on the thermic effect of a late dinner, and ×0.92 on resting rate after 14 days of at least 2 hours of slow debt) are not applied; shift work enters only as extra sleep debt.',
      keyNumbers: [
        {
          label: '5 days at 5 h (16 adults)',
          value: 'Total expenditure about +5 % (extra wakefulness); intake exceeded it',
          referenceIds: ['markwald2013'],
        },
        {
          label: 'Meta-analyses and trials',
          value: 'No significant change in total expenditure or resting rate; activity energy unchanged',
          referenceIds: ['alkhatib2017', 'zhu2019', 'covassin2022', 'calvin2013'],
        },
        {
          label: '3 nights at 4 h vs 8 h (10 women, whole-room calorimeter)',
          value:
            'Resting rate 1.01 vs 0.97 kcal/min (not significant); thermic effect of food unchanged; fasting respiratory quotient lower after short sleep',
          referenceIds: ['shechter2014'],
        },
        {
          label: 'Short sleep during a deficit',
          value: 'Resting rate lower after 5.5 h in bed (P = 0.01)',
          referenceIds: ['nedeltcheva2010'],
        },
        {
          label: 'Sleep restriction with circadian disruption (3 weeks at 5.6 h)',
          value: 'Resting rate −8 %; partial recovery after 9 days',
          referenceIds: ['buxton2012'],
        },
        {
          label: 'Simulated night shift (14 adults)',
          value:
            'Total expenditure +4 % on the transition day and −3 % on night-shift days 2–3; −12–16 % during daytime sleep; lower thermic effect after a late dinner',
          referenceIds: ['mchill2014'],
        },
      ],
      timeCourse:
        'The shift-work resting-rate reduction applies only after 14 days or more at a slow debt of 2 hours or more; partial recovery took 9 days in the one study that measured it.',
      moderators: 'Shift-work or circadian-misalignment flag; sleep debt size and duration.',
      grade: 'B',
      gradeReason:
        'The finding of no drop in expenditure with short sleep alone is well supported (grade A for “not decreased”); the shift-work terms are only grade C.',
      status: 'established',
      caveats:
        'The extra awake energy cost (about 5 % of about 2,500 kcal) is real but tiny compared with the intake effect, so it is ignored. The 0.85 scaling of the late-dinner thermic effect is a proposal: its direction comes from one simulated-shift study and its size is unverified.',
      referenceIds: [
        'nedeltcheva2010',
        'alkhatib2017',
        'zhu2019',
        'markwald2013',
        'covassin2022',
        'calvin2013',
        'shechter2014',
        'buxton2012',
        'mchill2014',
      ],
      relatedMetricIds: [],
    },
    {
      id: '16-sleep-fat-distribution',
      title: 'Short sleep and where fat goes',
      category: 'body',
      summary:
        'In one 14-day study of ad libitum eating, short and normal sleep gave the same total, lean and android fat on DXA (body-composition) scans. But CT scans showed about 9 % more abdominal fat, with visceral fat (around the organs) up about 11 %. Vitals does not add this shift; new fat is shared between depots without a sleep term.',
      howModelled:
        'Not modelled: new fat is shared between depots without a sleep term. The proposal was a visceral share 0.05 higher (absolute) per hour of slow sleep debt for fat gained in maintenance or surplus.',
      equation: 'vatShareOfGain += 0.05 × dS   (absolute; band 0–0.10 per hour)',
      keyNumbers: [
        {
          label: '14 days at 4 h vs 9 h, ad libitum (12 adults, 9 men): CT abdominal fat',
          value:
            'Total abdominal fat +9 % (net +15.2 cm², 95 % CI 3.6–26.8, P = 0.011); subcutaneous +8 % vs +4 % (net 7.4 cm²); visceral about +11 % (P = 0.042 between conditions)',
          note: 'DXA total fat, lean mass and android fat did not differ (P > 0.14).',
          referenceIds: ['covassin2022'],
        },
      ],
      grade: 'C',
      gradeReason: 'A single study of 12 people (9 men) over 14 days.',
      status: 'proposed-fit',
      caveats:
        'The rule extrapolates one small, short study to any period of sleep debt. The band runs from no effect to double the central value.',
      referenceIds: ['covassin2022'],
      relatedMetricIds: [],
    },
    {
      id: '16-sleep-training-performance',
      title: 'Short sleep and next-day training performance',
      category: 'performance',
      summary:
        'After a night of lost sleep, strength, power and endurance all drop, with strength holding up best. Across 69 publications the average drop was about 7.6 %. Morning tasks were largely unaffected, and the loss is bigger when sleep is cut short by early waking than by a late bedtime.',
      howModelled:
        'Not modelled: sleep debt does not change modelled strength, power or endurance. The proposed multipliers (strength 1 − 0.008 and power and endurance 1 − 0.015 per hour of fast sleep debt, capped at 4 hours, halved for sessions before 12:00) are not applied. There is no separate recovery multiplier because none has verified data.',
      equation:
        'strengthMult = 1 − 0.008 × min(dF, 4)\npowerEnduranceMult = 1 − 0.015 × min(dF, 4)\nHalve the effect if the session starts before 12:00',
      keyNumbers: [
        {
          label: 'Overall effect (meta-analysis of 69 publications, 227 outcomes, 89 % male)',
          value: '−7.56 % (95 % CI −11.9 to −3.13); heterogeneity I² = 98 %',
          referenceIds: ['craven2022'],
        },
        {
          label: 'By type of performance',
          value:
            'Strength −2.85 % (−4.47 to −1.23); anaerobic power −6.26 % (−9.10 to −3.41); endurance −5.55 % (−8.12 to −2.99); high-intensity interval exercise −6.15 % (−10.5 to −1.77)',
          referenceIds: ['craven2022'],
        },
        {
          label: 'By protocol',
          value:
            'Full deprivation: strength −3.00 %. Early restriction (delayed bedtime): strength −1.16 % (−2.57 to +0.25). Late restriction (early waking): strength −4.45 % (−9.30 to +0.41), high-intensity interval exercise −11.5 %',
          note: 'About 0.4 % performance loss per hour awake before the task; morning tasks were largely unaffected.',
          referenceIds: ['craven2022'],
        },
      ],
      moderators:
        'Time of day of the session (morning sessions are largely unaffected) and how the sleep was lost (early waking hurts more than a late bedtime).',
      grade: 'B',
      gradeReason:
        'Based on a meta-analysis, but with very high heterogeneity (I² = 98 %) and mostly male participants.',
      status: 'proposed-fit',
      caveats:
        'The per-hour multipliers are Vitals proposals with a range of ±50 %. The consequences for recovery and muscle growth are carried by the muscle-protein factor instead.',
      referenceIds: ['craven2022'],
      relatedMetricIds: [],
    },
    {
      id: '16-sleep-quality-timing-shift-work',
      title: 'Sleep quality, late bedtimes and shift work',
      category: 'recovery',
      summary:
        'Poor sleep quality, a delayed bedtime and shift work each add to the effects of short sleep. Suppressing deep sleep lowered insulin sensitivity even when total sleep time was unchanged. Late bedtimes brought in extra late-night eating. A 12-hour shift of the body clock worsened blood sugar, blood pressure and appetite hormones in a small lab study.',
      howModelled:
        'Fragmented sleep adds 0.75 hours (range 0.5–1.5) of “equivalent debt” to each night, and the shift-work flag adds 1.0 hour. There is no separate timing parameter, and no extra late-night eating is added, because Vitals simulates the intake you enter. Long sleep (over 9 hours) and naps are not modelled.',
      keyNumbers: [
        {
          label: 'Slow-wave sleep suppression',
          value: 'Lowers insulin sensitivity without changing total sleep time',
          referenceIds: ['tasali2008'],
        },
        {
          label: 'Sleep quality and weight loss (observational)',
          value: 'Poor sleep quality 2.2 ± 1.2 % less weight loss, vs 4.5 ± 1.3 % for short duration',
          referenceIds: ['kline2026'],
        },
        {
          label: 'Delayed bedtime',
          value: 'Extra intake of about 553 kcal between 22:00 and 03:59, and 130 % of requirement',
          note: 'The body clock also shifted later after restriction.',
          referenceIds: ['markwald2013', 'spaeth2013', 'depner2019'],
        },
        {
          label: '12-hour circadian misalignment (10 people)',
          value:
            'Leptin −17 %; glucose +6 % with insulin +22 %; cortisol rhythm reversed; sleep efficiency −20 %; mean arterial pressure +3 %; 3 of 8 subjects reached prediabetic post-meal glucose',
          referenceIds: ['scheer2009'],
        },
        {
          label: 'Equivalent debt add-ons',
          value: 'Fragmented sleep 0.75 h; shift work +1.0 h',
          note: 'Band 0.5–1.5 h. The shift-work add-on is a proposal; the fragmented-sleep value is about half the short-sleep effect.',
        },
      ],
      grade: 'C',
      gradeReason:
        'Small lab studies and one observational study; epidemiology for shift work is handled elsewhere.',
      status: 'proposed-fit',
      caveats:
        'These add-ons are Vitals proposals. The lab studies were small, and the epidemiology of shift work is covered by the fasting and circadian topic.',
      referenceIds: ['markwald2013', 'spaeth2013', 'depner2019', 'scheer2009', 'tasali2008', 'kline2026'],
      relatedMetricIds: ['insulinSensitivity', 'hunger'],
    },
    {
      id: '16-sleep-extension-recovery',
      title: 'Sleeping more, and why weekend catch-up does not fully repair',
      category: 'recovery',
      summary:
        'In habitual short sleepers, sleeping longer reduced intake and body weight. Catching up on the weekend, however, did not stop insulin sensitivity from falling, and two long nights did not bring it back. Vitals gets both results from the same sleep-debt rule without extra parameters.',
      howModelled:
        'Extending sleep lowers the fast sleep debt, so the hunger score falls. Because slow debt clears more slowly than it builds, recovery of insulin sensitivity lags behind sleep. There is no “sleep bank”.',
      keyNumbers: [
        {
          label: 'Sleep extension in habitual short sleepers',
          value: 'Lower intake and lower body weight (−270 kcal/d and −0.87 kg vs control in 2 weeks)',
          referenceIds: ['tasali2022'],
        },
        {
          label: 'Weekend recovery sleep',
          value: 'Did not prevent the loss of insulin sensitivity (−9 to −27 % persisted)',
          referenceIds: ['depner2019'],
        },
        {
          label: 'Two recovery nights',
          value: 'Insulin sensitivity and the disposition index were not restored',
          referenceIds: ['ness2019'],
        },
      ],
      grade: 'B',
      gradeReason: 'Supported by a randomised extension trial and two inpatient studies of recovery.',
      status: 'established',
      caveats:
        'Recovery kinetics after weeks of restriction have not been measured, and the asymmetric time constants are inferred from two short recovery studies.',
      referenceIds: ['tasali2022', 'depner2019', 'ness2019'],
      relatedMetricIds: ['hunger', 'insulinSensitivity'],
    },
    {
      id: '16-caffeine-and-sleep',
      title: 'Caffeine: how much is left at bedtime and what it costs in sleep',
      category: 'recovery',
      summary:
        'Caffeine clears slowly, with a half-life of about 5.4 hours, so an afternoon coffee is still partly in the body at bedtime. A meta-analysis of 24 studies found caffeine cuts total sleep time by about 45 minutes. Vitals tracks how much caffeine is left when you go to bed and turns the amount above a threshold of about 37 mg into minutes of lost sleep. It shows this as an impact estimate rather than changing the sleep hours you enter.',
      howModelled:
        'Each dose decays by half every 5.4 hours (7.9 hours with a combined oral contraceptive; ×0.56 for smokers). The amount left at your bedtime is compared with 37 mg. Sleep lost is 0.40 minutes per milligram above that, up to 120 minutes, which lowers the sleep-quality score; sleep-onset delay, night waking, sleep efficiency and deep sleep are not tracked separately. The caffeine mechanism in the substances topic supplies doses and times. Feeding the loss back into your entered sleep hours is off, to avoid counting it twice.',
      equation:
        'C(t) = Σ_i dose_i × 2^(−(t − t_i)/t½),  t½ = 5.4 h (7.9 h with combined oral contraceptive; × 0.56 if smoker)\nR = C(t_bed)\nTSTloss_min = min(120, 0.40 × max(0, R − 37))\nSleep-onset delay +0.20 × TSTloss; night waking +0.27 × TSTloss; sleep efficiency −0.155 percentage points per minute of TSTloss; deep sleep (N3) −0.25 × TSTloss',
      keyNumbers: [
        {
          label: 'Pooled effect on the next sleep (24 studies)',
          value:
            'Total sleep time −45 min; sleep efficiency −7 %; sleep-onset latency +9 min; wake after sleep onset +12 min; light sleep (N1) +6.1 min (+1.7 %); deep sleep (N3) −11.4 min (−1.4 %)',
          referenceIds: ['gardiner2023'],
        },
        {
          label: 'Cut-off times to avoid lost sleep',
          value:
            'Coffee (107 mg per 250 mL) at least 8.8 h before bed; pre-workout (217.5 mg) at least 13.2 h before bed',
          note: 'These correspond to about 34 mg and 40 mg still in the body, which is why the threshold is about 37 mg (range 34–40 mg). That agreement is the main support for the fit.',
          referenceIds: ['gardiner2023'],
        },
        {
          label: 'Home trial with 400 mg at 0, 3 or 6 h before habitual bedtime',
          value: 'Each timing significantly disturbed sleep vs placebo',
          note: 'The numeric sleep losses could not be extracted from the abstract or full text.',
          referenceIds: ['drake2013'],
        },
        {
          label: 'Half-life in healthy non-smoking women (162 mg)',
          value: '5.37 h (clearance 1.75 mL/min/kg, volume of distribution 0.75 L/kg)',
          note: 'Small sample.',
          referenceIds: ['abernethy1985'],
        },
        {
          label: 'Combined oral contraceptive users',
          value: 'Half-life 7.88 h (×1.47); clearance 1.05 mL/min/kg',
          referenceIds: ['abernethy1985'],
        },
        {
          label: 'Smokers',
          value: 'Clearance 114 ± 40 vs 64 ± 20 mL/min in non-smokers (about ×1.8), so half-life ×0.56',
          referenceIds: ['joeres1988'],
        },
        {
          label: 'Person-to-person variation',
          value:
            '89 % of the variance in exposure is genetic (the liver enzyme CYP1A2) once smokers and contraceptive users are excluded; sex has no significant effect on CYP1A2 activity',
          note: 'Twin data as summarised in a review. The individual half-life range is unverified.',
          referenceIds: ['grzegorzewski2022'],
        },
        {
          label: 'Model checks',
          value:
            '400 mg at 6 h before bed leaves 184 mg → −59 min; at 3 h leaves 272 mg → −94 min; at 0 h reaches the cap. Slope 0.40 min per mg (range 0.25–0.55)',
          note: 'The slope was chosen so a typical residual of about 150 mg gives the pooled −45 minutes.',
        },
      ],
      timeCourse:
        'The effect is set at bedtime by what is left in the body, with first-order decay. Sleep loss is capped at 120 minutes.',
      moderators:
        'Combined oral contraceptive use (half-life ×1.47), smoking (×0.56), genetics, and dose and timing. No sex effect on the enzyme that clears caffeine was found.',
      grade: 'B',
      gradeReason:
        'The existence and timing logic rest on a meta-analysis and a randomised trial (B), but the slope between the anchor points is grade C.',
      status: 'proposed-fit',
      caveats:
        'The slope is a fit to two cut-off points and one pooled effect, not a measured dose–response curve. The half-life comes from a small study of women, and the individual range is unverified.',
      referenceIds: ['gardiner2023', 'drake2013', 'abernethy1985', 'joeres1988', 'grzegorzewski2022'],
      relatedMetricIds: ['sleepQuality'],
    },
    {
      id: '16-alcohol-and-sleep',
      title: 'Alcohol and sleep',
      category: 'recovery',
      summary:
        'A meta-analysis found REM sleep delayed and reduced even at about two standard drinks, and worse with more. Time to fall asleep shortens only at about five drinks, and that probably worsens REM disruption later in the night. Heart rate rises and vagal tone falls overnight, in proportion to dose.',
      howModelled:
        "Vitals does not calculate lost sleep time for alcohol, because the size of the effect on total sleep, efficiency and waking is too uncertain. Instead the sleep-quality score takes a next-night penalty that grows with the day's alcohol dose per kg of body weight. The timing of drinks (such as within 4 hours of bed) is not used, and the Planner never includes alcohol. Energy and hydration effects of alcohol are handled elsewhere.",
      keyNumbers: [
        {
          label: 'REM sleep (meta-analysis of 27 studies)',
          value:
            'REM onset delayed and REM duration reduced; disruption occurs even at 0.50 g/kg or less (about 2 standard drinks) and worsens with dose',
          referenceIds: ['gardiner2025'],
        },
        {
          label: 'Sleep-onset and deep-sleep latency',
          value: 'Shortened only at 0.85 g/kg or more (about 5 drinks)',
          note: 'Effects on total sleep time, sleep efficiency and waking were too uncertain to quantify.',
          referenceIds: ['gardiner2025'],
        },
        {
          label:
            'Autonomic effects (26 adults, 11 women): 1–2 drinks (BAC about 0.02 %) vs 3–4 drinks (about 0.05 %)',
          value:
            'Overnight heart rate up; HRV (vagal tone) down; baroreflex sensitivity down; sympathetic activity up; all dose-dependent',
          referenceIds: ['dezambotti2021'],
        },
        {
          label: 'Flag threshold',
          value: 'Dose of 0.25 g/kg or more within 4 h of bed',
        },
      ],
      grade: 'A',
      gradeReason:
        'The direction of the effect is well supported (grade A); the size of the effect is only grade D, so it is used as a flag rather than an equation.',
      status: 'established',
      caveats:
        'Because no equation is used, the modelled effect is a warning and a score term, not a number of lost minutes.',
      referenceIds: ['gardiner2025', 'dezambotti2021'],
      relatedMetricIds: ['sleepQuality'],
    },
    {
      id: '16-evening-meals-and-sleep',
      title: 'Evening meals and sleep',
      category: 'recovery',
      summary:
        'Small studies link what and when you eat in the evening to how quickly you fall asleep and how deep the sleep is. The findings are mixed and mostly associations. No study separates a large late meal from total intake. Vitals does not use these findings in its sleep-quality score.',
      howModelled:
        "No simulated effect, and these foods do not enter Vitals' sleep-quality score, which reflects only caffeine and alcohol.",
      keyNumbers: [
        {
          label:
            'High- vs low-glycaemic-index meal, 4 h before bed (12 men, equal 768 kcal carbohydrate-rich meals)',
          value:
            'Sleep-onset latency 9.0 ± 6.2 min after the high-GI meal vs 17.5 ± 6.2 after the low-GI meal (P = 0.009); high-GI meal 1 h before bed 14.6 ± 9.9 min (worse than at 4 h, P = 0.01)',
          note: 'No other sleep variable changed.',
          referenceIds: ['afaghi2007'],
        },
        {
          label: 'Meta-analysis (11 articles, 27 trials)',
          value:
            'Carbohydrate quantity and glycaemic load explain part of the variance in sleep-onset latency (R² = 25.9 % and 50.8 %); carbohydrate quality did not change sleep stages',
          referenceIds: ['vlahoyiannis2021'],
        },
        {
          label: 'Late-night intake and sleep (52 adults, cross-sectional)',
          value:
            'Dinner and late-snack intake correlated with worse latency, efficiency and waking, with sex-specific correlations',
          referenceIds: ['crispim2011'],
        },
        {
          label: 'Inpatient study (26 adults)',
          value:
            'An ad libitum eating day vs a controlled diet gave less slow-wave sleep (P = 0.043) and longer latency (P = 0.0085); more fibre went with less light sleep and more slow-wave sleep; more saturated fat with less slow-wave sleep; more sugar and other non-fibre carbohydrate with more arousals',
          note: 'Associations only.',
          referenceIds: ['stonge2016'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Small studies with mostly associational designs; no study isolates a large late meal from total intake.',
      status: 'proposed-fit',
      caveats:
        'The score weights are not physiologically calibrated and the score is a user-interface aid only.',
      referenceIds: ['afaghi2007', 'vlahoyiannis2021', 'crispim2011', 'stonge2016'],
      relatedMetricIds: ['sleepQuality'],
    },
    {
      id: '16-very-low-carbohydrate-and-sleep',
      title: 'Very low carbohydrate intake and sleep stages',
      category: 'recovery',
      summary:
        'In a 48-hour study, a diet with almost no carbohydrate raised slow-wave (deep) sleep and lowered REM sleep compared with a mixed diet. A meta-analysis of low- vs high-carbohydrate diets agrees. Nobody has tested whether this lasts through weeks of keto-adaptation, and the studies do not show any change in how long people sleep.',
      howModelled:
        'No effect on sleep hours is modelled. The finding is reported as information about sleep architecture only.',
      keyNumbers: [
        {
          label:
            '48 h of less than 1 % carbohydrate, 61 % fat, 38 % protein vs a mixed diet (14 healthy non-obese men, 2,400 kcal)',
          value:
            'Slow-wave sleep 17.7 % (acute) and 17.8 % (ketosis phase) vs 13.9 % (P = 0.02); REM % lower (P = 0.006 acute, n = 11; P = 0.05 ketosis, n = 14)',
          referenceIds: ['afaghi2008'],
        },
        {
          label: 'Meta-analysis, low vs high carbohydrate',
          value:
            'Deep sleep (N3) duration ES 0.37 (95 % CI 0.18–0.56); proportion ES 0.51 (0.33–0.69); shorter REM',
          note: 'ES is an effect size.',
          referenceIds: ['vlahoyiannis2021'],
        },
      ],
      grade: 'B',
      gradeReason:
        'A short controlled trial and a meta-analysis agree for the short term; long-term effects are grade D.',
      status: 'established',
      caveats:
        'Only 48 hours were studied, so adaptation over weeks is untested. Nothing here implies a change in total sleep time.',
      referenceIds: ['afaghi2008', 'vlahoyiannis2021'],
      relatedMetricIds: [],
    },
    {
      id: '16-energy-deficit-and-sleep',
      title: 'Does eating less disturb sleep?',
      category: 'recovery',
      summary:
        'In a two-year trial in non-obese adults, a moderate calorie deficit did not harm sleep. It slightly improved sleep duration at 12 months, and greater weight loss went with better sleep quality. Extreme leanness is a different situation: a single case report of contest preparation shows large drops in testosterone and mood, though sleep was not reported.',
      howModelled:
        'No sleep penalty is applied for a deficit. Very low energy availability triggers a flag that it may worsen sleep, mood and hormones. In a small trial, short sleep during a deficit raised hunger. The reverse direction, where a deficit causes night hunger and shorter sleep, has no quantified human evidence.',
      keyNumbers: [
        {
          label:
            'Two-year trial in 220 adults (BMI 22–28); the calorie-restriction group lost 7.6 kg vs 0.4 kg',
          value:
            'Sleep duration improved at 12 months (PSQI, a sleep-quality questionnaire, duration difference −0.26, 95 % CI −0.49 to −0.02); greater weight loss correlated with better sleep quality (ρ = 0.28); mood and tension also improved',
          note: 'Self-reported sleep.',
          referenceIds: ['martin2016'],
        },
        {
          label: 'Case report of natural bodybuilding preparation',
          value:
            'Body fat 14.8 % → 4.5 %; testosterone 9.22 → 2.27 ng/mL; total mood disturbance 6 → 43; resting heart rate 53 → 27 bpm',
          note: 'Sleep was not reported in the abstract.',
          referenceIds: ['rossow2013'],
        },
        {
          label: 'Energy availability below 30 kcal/kg lean body mass per day',
          value: 'Disrupts pulsatile release of luteinising hormone (sleep was not measured)',
          referenceIds: ['loucks2003'],
        },
      ],
      grade: 'B',
      gradeReason:
        'A single large randomised trial with self-reported sleep supports the moderate-deficit finding; the extreme-leanness evidence is grade D.',
      status: 'established',
      caveats:
        'A moderate deficit in non-obese adults does not impair sleep according to this trial. The bodybuilding finding is one person and cannot be generalised.',
      referenceIds: ['nedeltcheva2010', 'martin2016', 'rossow2013', 'loucks2003'],
      relatedMetricIds: [],
    },
    {
      id: '16-exercise-timing-and-sleep-quality-score',
      title: 'Exercise timing and the sleep-quality score',
      category: 'recovery',
      summary:
        "Evening exercise did not harm sleep overall in a meta-analysis, though very vigorous exercise ending within an hour of bed may lower sleep efficiency and increase waking. Regular activity gives small to moderate benefits. Vitals' 0–100 sleep-quality score does not include exercise timing; it reflects only caffeine and alcohol. The score is a display aid and never feeds back into the simulation.",
      howModelled:
        "The engine's score starts at 100 and is lowered only by caffeine-related lost sleep and by the next-night effect of alcohol. The other proposed contributions (a large meal or hard exercise close to bed, fibre, saturated fat, free sugar and regular exercise, around a starting value of 75) are not included. The weights are not calibrated to physiology.",
      equation:
        'sleepQualityScore = 75 − TSTloss_caffeine_min/3 − 6 × (alcohol g/kg ÷ 0.25 within 4 h of bed, cap 20) − 5 × [largest meal ≤ 2 h before bed] − 5 × [vigorous exercise ending ≤ 1 h before bed] + 3 × [fibre ≥ 25 g] − 3 × [saturated fat > 12 % of energy] − 3 × [free sugar > 10 % of energy] + 3 × [regular exercise ≥ 150 min/wk], clamped to 0–100',
      keyNumbers: [
        {
          label: 'Evening exercise (meta-analysis of 23 studies)',
          value:
            'REM latency +7.7 min; slow-wave sleep +1.3 percentage points; light sleep (N1) −0.9 points; no adverse effect overall',
          note: 'Vigorous exercise ending 1 h or less before bed may lower sleep efficiency (−3.2 points for higher relative exercise stress) and increase waking (+21.9 min); these moderators vanished when one study was removed.',
          referenceIds: ['stutz2019'],
        },
        {
          label: 'Physical activity and sleep (meta-analysis of 66 studies)',
          value:
            'Acute exercise: small benefits for total sleep time, latency, efficiency, light sleep and slow-wave sleep, moderate for waking. Regular exercise: small-to-medium for latency, moderate for sleep quality',
          referenceIds: ['kredlow2015'],
        },
      ],
      grade: 'D',
      gradeReason:
        'The score weights are a proposed heuristic that is not physiologically calibrated, even though the exercise meta-analyses behind some terms are grade B.',
      status: 'proposed-fit',
      caveats: 'The score is for display only and must not be read as a measured sleep outcome.',
      referenceIds: ['stutz2019', 'kredlow2015'],
      relatedMetricIds: ['sleepQuality'],
    },
    {
      id: '16-psychological-stress',
      title: 'Stress, eating and body fat',
      category: 'hormones',
      summary:
        'Stress changes eating in mixed ways, and the effect on how much people eat is small. Over years, stress explains almost none of the change in body fat. Cortisol from hair is linked to waist size, but only in snapshot studies that cannot show which came first. Vitals does not model these effects yet: the stress setting is recorded but changes no output.',
      howModelled:
        'Not modelled: the stress setting (an advanced option; the default is “typical”) is recorded but changes no output. The proposed effects of “high sustained stress” (free-eating intake up by 2 % of maintenance, about 55–65 kcal, daily adherence noise multiplied by 1.5 and hunger up by 2 points) are not built, and the Planner does not use it as a risk flag yet. There is no effect on fat partition, water balance, resting rate or muscle protein synthesis.',
      equation:
        'High sustained stress (free-eating mode): ΔEI = +0.02 × maintenance (band 0–0.04); adherence-noise SD × 1.5 (range 1.0–2.0); hunger VAS +2',
      keyNumbers: [
        {
          label: 'Stress and eating in healthy adults (54 studies, N = 119,820)',
          value: 'Overall intake Hedges g 0.114; unhealthy food g 0.116; healthy food g −0.111',
          note: 'The only moderator found was dietary restraint, with large unexplained heterogeneity. Hedges g is a standardised effect size.',
          referenceIds: ['hill2022'],
        },
        {
          label: 'Stress and later body fat (14 longitudinal cohorts)',
          value:
            'Pooled r = 0.014 (95 % CI 0.002–0.025); 69 % of analyses not significant; stronger in men, with longer follow-up and better-quality studies',
          note: 'The authors called the effects very small.',
          referenceIds: ['wardle2011'],
        },
        {
          label: 'Hair cortisol and body fat (146 cohorts, n = 34,342, cross-sectional)',
          value:
            'Hair cortisol–BMI r = 0.10 (0.08–0.13); hair cortisone–waist r = 0.18 (0.11–0.24; 11.0 cm waist per unit log10 hair cortisone)',
          referenceIds: ['vandervalk2022'],
        },
        {
          label: 'Cortisol awakening response vs hair cortisol and obesity',
          value: 'Long-term (hair) cortisol correlates with BMI and waist; the awakening response does not',
          referenceIds: ['ostinelli2021'],
        },
        {
          label: 'Lab stress and body shape (59 premenopausal women, cross-sectional)',
          value:
            'Women with a higher waist-to-hip ratio had greater cortisol reactivity; lean high-ratio women failed to habituate',
          referenceIds: ['epel2000'],
        },
        {
          label: 'Wound healing (13 caregivers vs 13 controls)',
          value: '48.7 ± 2.9 vs 39.3 ± 3.0 days (+24 % slower)',
          referenceIds: ['kiecoltglaser1995'],
        },
        {
          label: 'Model derivation',
          value: 'g ≈ 0.11 × an assumed between-person intake SD of about 500–600 kcal ≈ +55–65 kcal',
          note: 'The assumed SD is unverified.',
          referenceIds: ['hill2022'],
        },
      ],
      moderators:
        'Dietary restraint moderated the effect of stress on eating, but the direction is unclear, so no adjustment is made for restrained eaters.',
      grade: 'C',
      gradeReason:
        'The direction of the intake effect is grade B, but the size is tiny, the effect on body fat is very small (r = 0.014), and everything else is cross-sectional.',
      status: 'proposed-fit',
      caveats:
        'Everything beyond a small intake and adherence drift is either cross-sectional (cortisol and fat), too small, or has no human data located: stress-related water retention and a stress-specific recovery multiplier are not modelled.',
      referenceIds: [
        'hill2022',
        'wardle2011',
        'vandervalk2022',
        'ostinelli2021',
        'epel2000',
        'kiecoltglaser1995',
      ],
      relatedMetricIds: [],
    },
    {
      id: '16-sex-resting-and-total-expenditure',
      title: 'Sex and energy expenditure: mostly body composition',
      category: 'energy',
      summary:
        'Men burn more energy than women at rest, but nearly all of that is because men carry more fat-free mass. Once fat-free mass and fat mass are accounted for, the remaining difference is small: about 3 % lower resting rate in women in one study, and none in a large study of total expenditure in adults aged 20–60. Vitals therefore adds no extra sex term.',
      howModelled:
        'The engine uses an equation based on fat-free mass and fat mass and does not multiply by sex. If a formula that already contains a sex term is used, that term is left as it is.',
      equation: 'TEE (MJ/d) = 0.677 × FFM^0.708   (r² = 0.83; Pontzer 2021)',
      keyNumbers: [
        {
          label: 'Resting metabolic rate, 328 men and 194 women',
          value:
            'Measured 1,740 vs 1,348 kcal/d (+23 % in men); after controlling for fat-free mass, fat mass and peak VO₂, women’s rate was 3 % lower (1,563 vs 1,613 kcal/d)',
          note: 'Adjusted SDs 153 and 127 kcal/d, about 8–10 %. A co-author of this 1993 paper was later found to have falsified data in other papers; this record carries no retraction notice, but it is used only as supporting evidence.',
          referenceIds: ['arciero1993'],
        },
        {
          label: 'Doubly labelled water study (n = 6,421, 29 countries)',
          value:
            'Total expenditure is predicted by fat-free mass; in adults aged 20–60, sex had no detectable effect once fat-free mass and fat mass were in the model; leftover person-to-person variation is at least ±20 %',
          referenceIds: ['pontzer2021'],
        },
        {
          label: 'Organ-level specific rates',
          value:
            'Liver 200, brain 240, heart and kidneys 440, skeletal muscle 13, adipose tissue 4.5, residual 12 kcal/kg/d; about 3 % lower after age 50',
          referenceIds: ['wang2010'],
        },
      ],
      grade: 'A',
      gradeReason: 'A large doubly labelled water dataset and an older measured-rate study agree.',
      status: 'established',
      caveats:
        'The person-to-person residual of at least ±20 % includes measurement error and is shown as a range, not a sex effect.',
      referenceIds: ['arciero1993', 'pontzer2021', 'wang2010'],
      relatedMetricIds: [],
    },
    {
      id: '16-sex-substrate-use',
      title: 'Sex and which fuel is burned in exercise',
      category: 'fuel',
      summary:
        'During moderate endurance exercise, women burn proportionally more fat than men. In 300 adults, peak fat oxidation per kilogram of fat-free mass was 12 % higher in women, and it peaked at a higher intensity. Nothing convincing shows a sex difference at rest.',
      howModelled:
        "No sex term is applied to fuel use: the engine's fuel mix, at rest and in exercise, follows the same rules for women and men, and the proposed ×1.12 on women’s peak fat oxidation per kilogram of fat-free mass (range 1.05–1.20) is not applied. No numeric sex multiplier is applied to insulin sensitivity.",
      keyNumbers: [
        {
          label: 'Maximal fat oxidation (300 adults, 157 men and 143 women)',
          value:
            '7.8 ± 0.13 mg/kg fat-free mass/min overall; women 8.3 ± 0.2 vs men 7.4 ± 0.2 (P < 0.01, +12 %)',
          referenceIds: ['venables2005'],
        },
        {
          label: 'Intensity at which fat oxidation peaks (Fatmax)',
          value: '52 ± 1 vs 45 ± 1 % of VO₂max',
          note: 'Activity level, VO₂max and sex explained only 12 % of the variance; body fat was not a predictor.',
          referenceIds: ['venables2005'],
        },
        {
          label: 'Submaximal endurance exercise',
          value:
            'Women oxidise proportionally more fat (lower respiratory exchange ratio, higher muscle fat stores, lower leucine oxidation)',
          referenceIds: ['tarnopolsky2000', 'lundsgaard2014'],
        },
      ],
      moderators:
        'Sex applies to exercise only, and insulin sensitivity has no supportable numeric multiplier.',
      grade: 'B',
      gradeReason: 'Consistent findings from a large sample and reviews.',
      status: 'established',
      caveats:
        'Women’s muscle tends to be more insulin sensitive, with higher muscle fat stores, leptin and adiponectin, but that finding is grade C, so no multiplier is applied.',
      referenceIds: ['tarnopolsky2000', 'venables2005', 'lundsgaard2014'],
      relatedMetricIds: [],
    },
    {
      id: '16-sex-fat-distribution',
      title: 'Sex and where fat is stored and lost',
      category: 'body',
      summary:
        'At the same BMI, women carry about 10 percentage points more body fat than men. When both lose weight, men lose relatively more visceral (around the organs) fat and less subcutaneous fat for the same weight or waist loss, though total abdominal fat loss is equal. Both sexes lose visceral fat preferentially.',
      howModelled:
        "Not modelled as a sex multiplier: the body-measurement topic's model shares fat loss between depots with the same visceral susceptibility for both sexes, so the proposed 1.3 for men and 0.8 for women is not applied; sex enters through each person's starting fat distribution. Essential-fat floors are deferred to other topics because no primary source was verified.",
      equation:
        'vatShareOfLossMult = 1.3 (men) / 0.8 (women) on the baseline visceral share of fat loss   (proposed)',
      keyNumbers: [
        {
          label: 'Body fat at equal BMI (665 adults)',
          value: '10.4 percentage points more body fat in women',
          referenceIds: ['jackson2002'],
        },
        {
          label: 'MRI study, 81 men and 72 women',
          value:
            'For a given weight or waist loss, men lose more visceral fat and less subcutaneous fat; total abdominal loss is equal; the differences widen with larger loss',
          referenceIds: ['kuk2009'],
        },
        {
          label: 'Energy restriction with or without exercise (24 obese women)',
          value: 'Preferential visceral fat loss (visceral-to-subcutaneous ratio down)',
          referenceIds: ['ross1994'],
        },
        {
          label: 'Regional biology',
          value: 'Gluteofemoral storage and sex-steroid effects reviewed qualitatively',
          referenceIds: ['karastergiou2012'],
        },
        {
          label: 'Essential-fat floors',
          value: 'Commonly quoted about 3–5 % for men and about 10–13 % for women',
          note: 'Unverified. No primary source was found, so this is deferred.',
        },
      ],
      grade: 'C',
      gradeReason:
        'The direction is supported by MRI studies, but the size of the multipliers is unverified.',
      status: 'proposed-fit',
      caveats: 'The 1.3 and 0.8 multipliers are proposals whose magnitude is unverified.',
      referenceIds: ['kuk2009', 'ross1994', 'karastergiou2012', 'jackson2002'],
      relatedMetricIds: [],
    },
    {
      id: '16-sex-weight-loss-composition',
      title: 'Do men and women lose different kinds of weight?',
      category: 'body',
      summary:
        'Two large studies of fast weight loss disagree. In one, women lost a bigger share of their weight as fat-free mass. In the other, men lost more early on. Vitals therefore adds no sex term and lets the leaner starting composition of men create differences on its own, with a wide range.',
      howModelled:
        "The engine uses the protein topic's partition, built on the Forbes relationship between fat mass and the fat-free share of weight change, with no separate sex multiplier; sex enters only in where the body-fat thresholds for “lean” sit. It shows a band of ±0.10 on the fat-free share of loss (80 % interval).",
      keyNumbers: [
        {
          label: 'PREVIEW trial (2,224 overweight adults with prediabetes; 8 weeks at 810 kcal/d)',
          value:
            'Weight loss 11.8 % (men) vs 10.3 % (women); fat −9.3 vs −7.1 kg; fat-free mass −1.9 vs −3.2 kg; fat-free share of weight loss 16.1 % (men) vs 31.4 % (women), mean 25 %; HOMA-IR (an insulin-resistance index) fell −1.50 vs −1.35',
          note: '1,504 women and 720 men; the differences remained after adjusting for percentage weight loss; body composition was measured by mixed DXA and bioimpedance (BIA) across 8 sites.',
          referenceIds: ['christensen2018'],
        },
        {
          label: 'Commercial-diet study (287 adults, 210 women, DXA, 2 and 6 months)',
          value:
            'Baseline fat-free mass share of excess weight 40 % (men) vs 27 % (women); at 2 months men lost twice the weight and three times the fat-free mass of women; between 2 and 6 months the share fell to 7 % (men) and 5 % (women); no diet effect',
          referenceIds: ['millward2014'],
        },
        {
          label: 'Expectation from body-fat theory',
          value: 'A leaner starting composition (men) gives a larger fat-free share of early loss',
          note: 'This is Vitals’ own inference; the second study’s abstract does not invoke it.',
          referenceIds: ['hall2007'],
        },
      ],
      grade: 'C',
      gradeReason: 'The two large studies point in opposite directions and use different methods.',
      status: 'contested',
      caveats:
        'The first study may reflect method differences (BIA vs DXA), a very low-energy diet, and water or glycogen shifts counted inside fat-free mass. Men lose more absolute weight mostly because their absolute deficits are larger, which the energy-balance model already handles. No adjudication is possible without harmonised body-composition methods.',
      referenceIds: ['christensen2018', 'millward2014', 'hall2007'],
      relatedMetricIds: [],
    },
    {
      id: '16-sex-ketone-production',
      title: 'Sex, contraception and ketone levels',
      category: 'fuel',
      summary:
        'Women have slightly higher fasting ketone (β-hydroxybutyrate) levels than men and a higher response to a fat meal. Combined oral contraceptive use raises ketones by 45 % and menopause lowers them by 11 %. Very lean people also make about twice as many ketones early in a fast. Vitals does not apply the proposed multipliers.',
      howModelled:
        'Not modelled as a separate multiplier: ketone production has no sex, contraception or menopause term, and the proposed ×1.10 for women, a further ×1.45 with a combined oral contraceptive and ×0.89 after menopause are not applied. Differences between people come through body size, lean mass and liver glycogen.',
      equation:
        'ketoneProdMult = 1.10 (women; range 1.0–1.4);  × 1.45 if combined oral contraceptive;  × 0.89 if postmenopausal   (proposed)',
      keyNumbers: [
        {
          label: 'Fasting β-hydroxybutyrate (n = 6,102)',
          value:
            'Women 123 vs men 119 µmol/L (P < 0.001); combined oral contraceptive +45 %; postmenopausal −11 %; in men +1 %/yr with age',
          referenceIds: ['knol2026'],
        },
        {
          label: 'After an oral fat load',
          value: 'Incremental area under the curve 1.37 ± 0.49 in women vs 0.98 ± 0.43 mmol·h/L in men',
          referenceIds: ['halkes2003'],
        },
        {
          label: '38-hour fast',
          value:
            'Women had higher free fatty acids and lipolysis and lower glucose, with the same insulin-mediated glucose uptake',
          referenceIds: ['soeters2007'],
        },
        {
          label: 'Leanness confound',
          value: 'Lean subjects show about 2× the early-starvation ketone level of obese subjects',
          referenceIds: ['elia1999'],
        },
      ],
      grade: 'D',
      gradeReason:
        'The multipliers are extrapolations from single-time-point associations; no controlled multi-day fasting study compared the sexes.',
      status: 'proposed-fit',
      caveats:
        'These are extrapolations from fasting and after-meal measurements, and the range for women is wide (1.0–1.4).',
      referenceIds: ['soeters2007', 'knol2026', 'halkes2003', 'elia1999'],
      relatedMetricIds: [],
    },
    {
      id: '16-sex-leptin-per-kg-fat',
      title: 'Leptin per kilogram of fat differs by sex',
      category: 'hormones',
      summary:
        'Leptin is a hormone made by fat tissue that signals energy stores to the brain. At the same BMI, women’s blood leptin is about twice that of men, and the difference persists after adjusting for body fat. Leptin also tracks percentage body fat closely.',
      howModelled:
        "Not modelled as a separate multiplier: the hormones topic's leptin model sets each person's starting leptin from fat mass with its own sex-specific equation, which already gives women more leptin per kilogram of fat, so the proposed ×1.5 (range 1.2–2.0) is not applied on top. The appetite topic owns the dynamics.",
      keyNumbers: [
        {
          label: 'Leptin at equal BMI (32 men, 63 women; body fat 49 % vs 36 %)',
          value:
            'About 2× higher in women; secretion per unit of adipose tissue in men about two-thirds of women’s; the difference persists after adjusting for body fat',
          referenceIds: ['hellstrom2000'],
        },
        {
          label: 'Leptin and body fat',
          value:
            'Serum leptin correlates with % body fat (r = 0.85); 31.3 vs 7.5 ng/mL in obese vs lean people',
          referenceIds: ['considine1996'],
        },
      ],
      grade: 'B',
      gradeReason: 'Consistent human data in two studies, though the sample sizes are modest.',
      status: 'established',
      referenceIds: ['hellstrom2000', 'considine1996'],
      relatedMetricIds: [],
    },
    {
      id: '16-sex-muscle-gain',
      title: 'Muscle gain: equal relative growth, smaller absolute gain in women',
      category: 'performance',
      summary:
        'Women and men gain muscle at the same relative rate from resistance training. Because women start with less muscle, the absolute kilograms gained are smaller. Women gain more relative upper-body strength.',
      howModelled:
        'The hypertrophy rate is the same for both sexes (multiplier 1.00). Absolute gain is then proportional to baseline muscle mass.',
      keyNumbers: [
        {
          label: 'Meta-analysis (10 studies, 12 outcomes)',
          value:
            'Hypertrophy effect-size difference men–women 0.07 ± 0.06 (P = 0.31); relative upper-body strength gain favours women (ES −0.60 ± 0.16); lower body not significant',
          referenceIds: ['roberts2020'],
        },
        {
          label: '585 adults, 12 weeks of elbow-flexor training',
          value:
            'Cross-sectional area change ranged from −2 % to +59 %; men had 2.5 % greater relative area gain (P < 0.01), women greater relative strength gains; coefficient of variation 0.48 (men) and 0.51 (women)',
          referenceIds: ['hubal2005'],
        },
      ],
      grade: 'A',
      gradeReason: 'A meta-analysis and a large single study agree.',
      status: 'established',
      caveats:
        'Response varies enormously between individuals of either sex (a cross-sectional area change of −2 % to +59 %).',
      referenceIds: ['roberts2020', 'hubal2005'],
      relatedMetricIds: [],
    },
    {
      id: '16-sex-protein-and-energy-availability',
      title: 'Protein needs by sex, and the energy availability safety line for women',
      category: 'hormones',
      summary:
        'No sex-specific protein requirement per kilogram is established. Women’s reproductive hormones respond to very low energy availability, which is the energy left after exercise, per kilogram of lean mass. In 29 women, pulsatile release of luteinising hormone was intact at 30 kcal/kg lean mass per day and disrupted below it. Vitals warns when planned energy availability falls under that line.',
      howModelled:
        'Protein is expressed per kilogram of fat-free mass without a sex multiplier. If a woman’s planned energy availability (intake minus exercise energy, per kg lean mass) is under 30 kcal/kg lean mass per day, the app shows a safety warning. No equivalent threshold for men was located.',
      keyNumbers: [
        {
          label:
            'Energy availability and luteinising hormone (29 regularly menstruating sedentary women; 5 days in the early follicular phase; exercise 15 kcal/kg lean mass/d)',
          value:
            'Pulsatility unaffected at 30 kcal/kg lean mass/d and disrupted below (pulse frequency down, amplitude up), worse in women with short luteal phases',
          note: '45 kcal/kg lean mass/d was the control level.',
          referenceIds: ['loucks2003'],
        },
        {
          label: 'Protein and sex',
          value:
            'No sex-specific per-kg requirement established; women’s lower leucine oxidation is a mechanistic observation only',
          referenceIds: ['tarnopolsky2000'],
        },
      ],
      grade: 'B',
      gradeReason:
        'A single mechanistic study of this design; any sex-specific protein multiplier would be grade D.',
      status: 'established',
      caveats:
        'The threshold comes from a 5-day exposure in one study. Any threshold used in the Planner is set by the safety topic, not here.',
      referenceIds: ['tarnopolsky2000', 'loucks2003'],
      relatedMetricIds: [],
    },
    {
      id: '16-menstrual-cycle-and-contraception',
      title: 'The menstrual cycle, hormonal contraception and eating, weight and training',
      category: 'hormones',
      summary:
        'Hunger and intake are on average higher in the second half of the cycle (the luteal phase), by about 168 kcal a day across studies. Resting metabolic rate may rise slightly. Scale weight and water effects are small, inconsistent in direction and specific to the person. Performance, fuel use and training adaptation show no reliable differences by phase. Hormonal contraception does not cause weight gain in randomised trials.',
      howModelled:
        'Cycle modelling is an optional, advanced toggle, off by default. When on for a regular cycle without hormonal contraception, the luteal phase adds to the hunger score (worth 168 kcal a day, averaged to zero over the cycle) and slightly raises resting rate (also averaged to zero), and scale weight follows a small menstrual water curve. Vitals simulates the intake you enter, so no calories are added. Fuel use, performance and muscle growth are left unchanged. With combined hormonal contraception the cycle toggle is disabled and only the slower caffeine clearance applies; there is no ketone term. Progestin-only methods and hormonal IUDs are treated as “no cycle toggle”.',
      equation:
        'lutealFlag_t = 1 if cycleDay in [ceil(L/2)+1 .. L] else 0   (about days 15–28 for L = 28)\nhungerVas += 5 × lutealFlag_t   (proposed)\nΔEI (free eating) = +168 × lutealFlag_t kcal/d   (band +50 to +300)\nscaleNoiseKg = 0.3   (± display band, not a deterministic curve)',
      keyNumbers: [
        {
          label: 'Energy intake (meta-analysis, 15 datasets, 330 women, age 26)',
          value: 'Luteal above follicular, SMD 0.69 (P = 0.039), crude +168 kcal/d',
          note: 'Many methodological inconsistencies. A review found more carbohydrate and fat cravings in the luteal phase and reported that oestrogen inhibits and progesterone and testosterone stimulate intake; a counter-example in 21 women found carbohydrate higher in the early follicular phase (234 g) than mid-luteal (209 g). SMD is a standardised mean difference.',
          referenceIds: ['tucker2025', 'davidsen2007', 'wagner2026', 'hirschberg2012'],
        },
        {
          label: 'Resting metabolic rate (meta-analysis, 26 studies, 318 women)',
          value:
            'Luteal above follicular, ES 0.33 (0.17–0.49), I² = 3.8 %; since 2000 ES 0.23 (−0.00 to 0.47, p = 0.055); 47 % of 30 studies found an increase; 21 women: no difference (p = 0.148)',
          note: 'The calorie effect was not reported in the abstracts, so it cannot be converted; older literature suggests a few percent (unverified).',
          referenceIds: ['benton2020', 'wagner2026'],
        },
        {
          label: 'Self-reported fluid retention (62 women, 765 cycles, 0–4 scale)',
          value:
            'Peak on day 1 of flow (0.9 ± 0.1), lowest mid-follicular, rise 0.22 → 0.50 over the 11 days around ovulation; not associated with oestradiol or progesterone',
          referenceIds: ['white2011'],
        },
        {
          label: 'Plasma volume (45 women)',
          value: '2,276 mL early follicular → 2,232 late follicular → 2,228 mid-luteal (about −2 %)',
          referenceIds: ['aguree2020'],
        },
        {
          label: 'Body mass and water by phase',
          value:
            '30 women: mass higher mid-luteal, total body water and fat unchanged; 21 women: weight lower mid-luteal (65.2 → 64.9 kg, p = 0.029); 29 women: no difference in weight or total body water, trunk water higher in the luteal phase; 25 women weighed daily: phase differences related to sodium intake',
          note: 'Sign inconsistent across studies.',
          referenceIds: ['kosar2022', 'wagner2026', 'takano2026', 'gleichauf1989'],
        },
        {
          label: 'Fuel use',
          value:
            'Peak fat oxidation 0.379 / 0.375 / 0.382 g/min (mid-follicular / late-follicular / mid-luteal, 19 women), Fatmax not significant; a meta-analysis found no phase difference in relative carbohydrate or fat oxidation at rest or during exercise',
          referenceIds: ['frandsen2020', 'dsouza2023'],
        },
        {
          label: 'Exercise performance',
          value:
            '78 studies: trivial reduction in the early follicular phase, ES −0.06 (95 % credible interval −0.16 to 0.04), low evidence quality; an umbrella review found no influence on strength performance or training adaptations',
          referenceIds: ['mcnulty2020', 'colensosemple2023'],
        },
        {
          label: 'Hormonal contraceptives',
          value:
            'Cochrane review of 49 RCTs: no evidence of a causal weight effect; performance in 42 studies (590 women): trivial and variable; 12-week training (N = 32): pill users had larger arm lean mass (+5.5 ± 3.9 vs +2.9 ± 2.8 %) and thigh muscle area (+10.0 ± 4.1 vs +5.3 ± 4.4 %), no lower-body strength difference, and slept 42 min longer',
          note: 'An earlier review on hypertrophy was conflicting. Insulin-sensitivity effects across the cycle are described as subtle, with no meta-analysis in non-diabetic women.',
          referenceIds: ['elliottsale2020', 'thompson2020', 'engstad2025', 'gallo2014'],
        },
      ],
      timeCourse:
        'The luteal phase is roughly days 15–28 of a 28-day cycle and is modelled as a square wave.',
      moderators:
        'Cycle length, use of hormonal contraception (which turns the cycle toggle off), and individual variation, which is large for scale-weight effects.',
      grade: 'C',
      gradeReason:
        'Intake is about grade B−, resting rate B (small), and water C/D, while fuel use and performance are A/B but of low quality; only hunger has a robust size.',
      status: 'contested',
      caveats:
        'The scale-weight literature disagrees on the sign, so no deterministic curve is used. Hunger and intake effects rest on self-reported diaries. Whether hormonal contraceptives change hypertrophy is unresolved (one randomised trial in favour, one review conflicting).',
      referenceIds: [
        'tucker2025',
        'benton2020',
        'davidsen2007',
        'white2011',
        'aguree2020',
        'kosar2022',
        'wagner2026',
        'takano2026',
        'gleichauf1989',
        'frandsen2020',
        'dsouza2023',
        'mcnulty2020',
        'elliottsale2020',
        'colensosemple2023',
        'thompson2020',
        'engstad2025',
        'gallo2014',
        'hirschberg2012',
      ],
      relatedMetricIds: ['rmr'],
    },
    {
      id: '16-pregnancy-and-lactation',
      title: 'Pregnancy and breastfeeding: why Vitals does not simulate them',
      category: 'energy',
      summary:
        'Pregnancy and exclusive breastfeeding add substantial energy demands. Pregnancy costs about 90, 287 and 466 kcal a day in trimesters 1–3, and breastfeeding adds about 454 kcal a day after the body mobilises some of its own tissue. Vitals does not simulate deficits, fasting or other regimes during either.',
      howModelled:
        'A checklist item makes the app refuse to simulate. For lactation the warning reads that it adds about 450–630 kcal/day of energy demand and that deficit diets and fasting are not simulated. Energy expenditure adjusted for fat-free and fat mass does not change in pregnancy, so changes in expenditure are driven by body size.',
      keyNumbers: [
        {
          label: 'Total energy cost of a 12 kg gestational weight gain',
          value:
            'About 321–325 MJ; about 375, 1,200 and 1,950 kJ/d (90, 287 and 466 kcal/d) in trimesters 1–3',
          referenceIds: ['butte2005'],
        },
        {
          label: 'Exclusive lactation',
          value:
            'Milk energy about 2.62 MJ/d (626 kcal/d) at 749 g/d, efficiency 0.80; net extra requirement about 1.9 MJ/d (454 kcal/d) after mobilising about 0.72 MJ/d (172 kcal/d) from tissue',
          referenceIds: ['butte2005'],
        },
        {
          label: 'Expenditure adjusted for body composition',
          value: 'Unchanged in pregnancy',
          referenceIds: ['pontzer2021'],
        },
      ],
      grade: 'B',
      gradeReason: 'The figures come from factorial estimates, not direct trials.',
      status: 'established',
      caveats: 'This is a hard exclusion for safety reasons; the final policy lives in the safety topic.',
      referenceIds: ['pontzer2021', 'butte2005'],
      relatedMetricIds: [],
    },
    {
      id: '16-menopause',
      title: 'Menopause: where fat goes more than how much',
      category: 'hormones',
      summary:
        'Around menopause, falling oestrogen shifts fat toward the abdomen, slightly lowers fat oxidation and accelerates bone loss. Most “menopausal weight gain” is actually ageing and lower activity. In a large cohort, fat mass rose faster and lean mass dipped slightly during the transition, then levelled off. Over a few months, these changes are far smaller than the effect of a deficit or surplus.',
      howModelled:
        'Menopause status is derived from age and can be overridden. It shapes the starting visceral-fat estimate, switches off the cycle terms and lowers baseline leptin after menopause. The transition-window fat and lean drifts are defined but not yet applied to body composition, and the larger visceral share of new fat, the optional lower resting-energy term and the hormone-therapy toggle are not modelled.',
      equation:
        'Transition window (years −2 to +1.5 around the final period): fatDriftExtra = +0.20 kg/yr (≈ +0.7 pp/yr); leanDriftExtra = −0.12 kg/yr (≈ −0.4 pp/yr); vatShareOfGain += 0.10; optional sleepingEEExtra = −0.65 %/yr (default off)\nHormone therapy: abdominalFat × 0.93; HOMA-IR × 0.87\nDefault status: under 50 pre; 50–53 peri; 54 and over post (user override allowed)',
      keyNumbers: [
        {
          label:
            'Body composition across menopause (1,246 women; baseline age 47.1; mean final period age 52.2; DXA)',
          value:
            'Fat mass +1.0 %/yr (+0.25 kg/yr) before menopause, +1.7 %/yr (+0.45 kg/yr) during the transition (about 2 years before to 1.5 years after the final period; total about +6 %, +1.6 kg over 3.5 years), then near zero; lean mass +0.2 → −0.2 %/yr (total about −0.5 %, −0.2 kg), then near zero; weight itself climbs linearly without acceleration',
          referenceIds: ['greendale2019'],
        },
        {
          label: 'Four-year follow-up (156 women; calorimetry in 34)',
          value:
            'Only women who became postmenopausal (n = 51) gained body fat and visceral fat (all gained subcutaneous fat); sleeping energy expenditure fell 7.9 % vs 5.3 % in those who stayed premenopausal (1.5×); fat oxidation −32 %; leisure activity fell 2 years before menopause',
          referenceIds: ['lovejoy2008'],
        },
        {
          label: 'Post- vs premenopause (201 cross-sectional and 11 longitudinal studies)',
          value:
            'Body fat +2.88 percentage points; waist +4.63 cm; waist-to-hip ratio +0.04; visceral fat +26.9 cm²; trunk fat +5.49 points; leg fat −3.19 points',
          note: 'Changes attributable mainly to age; menopause adds a distribution shift, not quantity.',
          referenceIds: ['ambikairajah2019'],
        },
        {
          label: 'Review of weight and the transition',
          value:
            'Weight gain per se is not attributable to the transition; total and abdominal fat increase; oestrogen therapy eases abdominal fat gain',
          referenceIds: ['davis2012'],
        },
        {
          label: 'Menopausal hormone therapy (107 RCTs)',
          value:
            'Abdominal fat −6.8 % (95 % CI −11.8 to −1.9); HOMA-IR −12.9 %; new-onset diabetes RR 0.7; oral (not transdermal) raises C-reactive protein (CRP) by 37.6 %',
          referenceIds: ['salpeter2006'],
        },
        {
          label: 'Bone loss across the transition',
          value:
            'Loss begins about 1 year before the final period and is fastest until about 2 years after: cumulative 10-year lumbar spine −10.6 % (7.38 % within the transmenopause, about 2.5 %/yr) and femoral neck −9.1 % (5.8 %, about 1.9 %/yr); higher BMI gave slower loss; Chinese and Japanese women lost faster',
          referenceIds: ['greendale2012', 'karlamangla2018'],
        },
      ],
      timeCourse:
        'The transition window runs from about 2 years before to 1.5 years after the final period. Bone loss is fastest for about 3 years.',
      moderators:
        'Age, BMI (higher BMI gave slower bone loss), ethnicity for bone loss, and hormone therapy use.',
      grade: 'B',
      gradeReason:
        'Fat and lean drift rest on a single large cohort (B), the resting-rate term is grade C, bone loss is B, and hormone therapy effects are A/B.',
      status: 'proposed-fit',
      caveats:
        'The cohort averages include behaviour change, such as lower activity beginning 2 years before the final period. The resting-rate effect (−2.6 percentage points over 4 years, 34 women) is weak. One frequently quoted 1995 paper reporting a resting-rate drop of about 100 kcal/d after menopause was retracted in 2003 and is not used anywhere in this model. Over a 3–6 month simulation the fat and lean offsets are about ±0.1 kg. Whether to use hormone therapy is a medical decision, and Vitals gives no advice on it.',
      referenceIds: [
        'lovejoy2008',
        'greendale2019',
        'ambikairajah2019',
        'davis2012',
        'salpeter2006',
        'greendale2012',
        'karlamangla2018',
      ],
      relatedMetricIds: ['fatMass', 'leanTissue'],
    },
    {
      id: '16-age-energy-expenditure',
      title: 'Age and energy expenditure: flat until about 63, then a slow decline',
      category: 'energy',
      summary:
        'After adjusting for fat-free mass and fat mass, daily energy expenditure stays flat from about 20 to 60 years of age, even in pregnancy. It then declines by about 0.7 % a year. The feeling that metabolism slows in the 40s is mostly a change in body composition.',
      howModelled:
        'Not applied as a separate factor. The resting-rate equations Vitals uses already include age, and fat-free mass is tracked directly, so the proposed factor (exactly 1.0 up to age 63, then 0.7 % lower for each year after) would count ageing twice.',
      equation: 'ageRmrMult = 1 − 0.007 × max(0, age − 63)   (age 75 → 0.916; age 85 → 0.846)',
      keyNumbers: [
        {
          label: 'Doubly labelled water study (n = 6,421)',
          value:
            'Adjusted total expenditure stable at 20–60 years (even in pregnancy); break point 63.0 years (95 % CI 60.1–65.9); after that −0.7 ± 0.1 %/yr; about 26 % below middle-aged adults in the nineties',
          note: 'Adjusted basal expenditure declines similarly, but its break point (46.5 years, CI 40.6–52.4) is imprecise because few basal data cover ages 45–65. Absolute expenditure also falls as fat-free and fat mass fall after about 60.',
          referenceIds: ['pontzer2021'],
        },
        {
          label: 'Organ-level specific rates',
          value: 'About 3 % lower after age 50',
          referenceIds: ['wang2010'],
        },
        {
          label: 'Unadjusted slowing in midlife',
          value:
            'Sleeping energy expenditure fell 5.3 % over 4 years in premenopausal women alongside changes in fat-free and fat mass',
          referenceIds: ['lovejoy2008'],
        },
      ],
      grade: 'A',
      gradeReason: 'A large doubly labelled water dataset validated across ages.',
      status: 'established',
      caveats:
        'The linear rule overshoots the published decline at very old ages: it gives about 0.81 at age 90, while the paper implies about 0.74 for the nineties, an overshoot of about 7 percentage points.',
      referenceIds: ['pontzer2021', 'wang2010', 'lovejoy2008'],
      relatedMetricIds: [],
    },
    {
      id: '16-age-muscle-mass-strength-drift',
      title: 'Age and the slow loss of muscle mass and strength',
      category: 'body',
      summary:
        'Muscle mass declines by roughly 0.4–0.5 % a year in cross-sectional data and by about 0.6–1 % a year in follow-up studies at around age 75. Strength falls two to five times faster than mass. This matters mainly for multi-year projections.',
      howModelled:
        "The engine uses the protein topic's age drift instead of these rates: lean tissue falls by a small amount each day from age 45, more with increasing age, and regular resistance training offsets most of it. The rates here (from 0.37 % a year for women or 0.47 % for men at 50, to 0.65 % or 0.90 % at 75) are not applied. The drift matters only for runs of several years.",
      equation:
        'muscleDriftPerYr(age, sex) = 0 for age < 50; linear ramp from 0.0037 (F) / 0.0047 (M) at 50 to 0.0065 (F) / 0.0090 (M) at 75; constant above',
      keyNumbers: [
        {
          label: 'Cross-sectional median loss of muscle mass',
          value: '0.47 %/yr in men and 0.37 %/yr in women',
          referenceIds: ['mitchell2012'],
        },
        {
          label: 'Longitudinal loss at about age 75',
          value:
            'Mass 0.80–0.98 %/yr (men) and 0.64–0.70 %/yr (women); strength 3–4 %/yr (men) and 2.5–3 %/yr (women)',
          note: 'Strength falls 2–5 times faster than mass. The commonly quoted 3–8 % per decade fits: 3.7–4.7 % per decade cross-sectionally to about 8–9 % per decade in follow-up at 75. The original single-source figure is unverified.',
          referenceIds: ['mitchell2012'],
        },
      ],
      grade: 'B',
      gradeReason: 'A quantitative review of cross-sectional and longitudinal studies.',
      status: 'established',
      caveats: 'Cross-sectional and longitudinal figures differ, so the ramp is a compromise between them.',
      referenceIds: ['mitchell2012'],
      relatedMetricIds: ['leanTissue', 'skeletalMuscle'],
    },
    {
      id: '16-age-anabolic-resistance',
      title: 'Older muscle needs more protein per meal to switch on fully',
      category: 'body',
      summary:
        'Basal muscle protein building is the same in older and younger men, but older men need a larger protein dose in a meal to reach the maximum response. Older muscle also responds less to a given amount of resistance exercise. This blunted response is called anabolic resistance. Obesity adds to it in older men.',
      howModelled:
        "The engine uses the protein topic's version in its muscle-protein-synthesis display: the protein needed per meal for a half-maximal response rises steadily between ages 30 and 70, on a smooth saturating curve rather than this capped straight line (0.24 g/kg at 40 to 0.40 g/kg at 70). The display does not change modelled muscle growth, which uses daily protein and the resistance-training topic's age factor.",
      equation:
        'proteinPlateauGPerKg = 0.24 + 0.16 × clamp((age − 40)/30, 0, 1)\nMPS response = min(1, dose / plateau)',
      keyNumbers: [
        {
          label: 'Pooled tracer data, healthy men about 71 vs about 22 years (0–40 g protein bolus)',
          value:
            'Basal muscle protein synthesis equal (0.027 vs 0.028 %/h); plateau at 0.40 ± 0.19 g/kg (old) vs 0.24 ± 0.06 g/kg (young) (p = 0.055), or 0.60 ± 0.29 vs 0.25 ± 0.13 g/kg lean mass (p < 0.01); the slope of the rising part is lower in older men',
          note: 'Retrospective analysis.',
          referenceIds: ['moore2015'],
        },
        {
          label: 'Exercise intensity and synthesis (25 young men aged 24 vs 25 older men aged 70)',
          value:
            'Synthesis rises with intensity to a plateau at 60–90 % of one-repetition maximum, and is blunted in older men; signalling proteins are also blunted at 60–90 %; synthesis returns to near basal by 2–4 hours in both',
          referenceIds: ['kumar2009'],
        },
        {
          label: 'Obesity in older men (aged 55–75)',
          value:
            'Insulin plus amino-acid infusion raised muscle protein synthesis only in healthy-weight (BMI 23.4) and not obese (BMI 31.9) men; post-meal leg glucose disposal was 63 % lower; lean mass and strength were equal',
          referenceIds: ['murton2015'],
        },
        {
          label: 'Protein guidance for adults over 65',
          value:
            'At least 1.0–1.2 g/kg/d; at least 1.2 g/kg/d if exercising; 1.2–1.5 g/kg/d with acute or chronic disease; exception if eGFR is below 30 mL/min/1.73 m² and not on dialysis',
          referenceIds: ['bauer2013'],
        },
      ],
      moderators: 'Age, obesity and exercise. The data are men only, 22 vs 71 years.',
      grade: 'B',
      gradeReason:
        'Small acute tracer studies give consistent results, but long-term trial translation is mixed.',
      status: 'proposed-fit',
      caveats:
        'The age at which the ramp starts (40 years) is a proposal: the data are men aged 22 and 71. Women and middle age are unmeasured, and the interpolation between the two ages is untested.',
      referenceIds: ['moore2015', 'kumar2009', 'bauer2013', 'murton2015'],
      relatedMetricIds: ['mps'],
    },
    {
      id: '16-age-hypertrophy-trainability',
      title: 'Older muscle still grows with training, at about 0.7 of the young rate',
      category: 'performance',
      summary:
        'Older adults gain muscle from resistance training, though somewhat less than young adults. In a 16-week trial, type II muscle fibres grew 23 % in older adults vs 32 % in young adults. A large meta-analysis found lean mass gains shrink by about 0.03 kg for each extra year of age. Strength gains were large in all groups.',
      howModelled:
        "The engine uses the resistance-training topic's age factor, which has a similar shape: 1.0 up to age 40, then falling steadily to about three-quarters of the young rate at 70, with a floor of 0.6. This topic's line (1.0 at 40 to 0.72 at 70 and above, range 0.5–1.0; the 0.72 comes from 23/32 in the fibre-growth trial) is not applied on top.",
      equation: 'hypertrophyRateMult = 1 − 0.28 × clamp((age − 40)/30, 0, 1)   (0.72 at age 70 and above)',
      keyNumbers: [
        {
          label: '16 weeks, 3 days a week (25 older adults aged 60–75 vs 24 young adults aged 20–35)',
          value:
            'Type II fibre size +23 % (older) vs +32 % (young); type IIa +16 % vs +25 %; type I +18 % in young only; type I +25 % in young men vs +4 % in older men',
          referenceIds: ['kosek2006'],
        },
        {
          label: 'Meta-analysis of 49 studies (1,328 adults aged 50 or older)',
          value:
            'Lean mass +1.1 kg (0.9–1.2); higher-volume programmes more (β = 0.05); older participants less (β = −0.03 kg per year of age, P = 0.01); I² = 84 %',
          referenceIds: ['peterson2011'],
        },
        {
          label: 'Meta-analyses in older adults only',
          value:
            '28 RCTs (age 65 or older): muscle size SMD 0.34 (0.16–0.52); fibre area 0.54 (0.24–0.84); leg lean mass not significant; age not significant within the older group. Heavy vs moderate loads: hypertrophy small (μ 0.056–0.136), strength gains similar if repetitions were enough',
          note: 'SMD is a standardised mean difference, a unit-free effect size.',
          referenceIds: ['csapo2016', 'desantana2024'],
        },
        {
          label: 'Nine weeks of heavy training, young and 65–75 year olds, both sexes',
          value: 'One-repetition maximum rose 27–39 % in all groups',
          note: 'Fibre-type responses differed by age and sex.',
          referenceIds: ['martel2006'],
        },
      ],
      moderators: 'Age, sex (men and women differ within older groups), and training volume.',
      grade: 'C',
      gradeReason:
        'One direct young-vs-older fibre trial and one meta-regression, with men and women pooled.',
      status: 'proposed-fit',
      caveats:
        'The ramp start at age 40 and the 0.72 multiplier come from a single trial’s fibre data plus a meta-regression. Men and women differ within older groups.',
      referenceIds: ['martel2006', 'kosek2006', 'peterson2011', 'csapo2016', 'desantana2024'],
      relatedMetricIds: [],
    },
    {
      id: '16-age-deficits-lean-and-bone',
      title: 'Dieting in older adults: a larger lean and bone cost',
      category: 'body',
      summary:
        'In obese adults aged 65 and older losing about 10 % of body weight over a year, one third of the weight lost was lean mass with diet alone, but only about a fifth with diet plus exercise. Hip bone density fell about 3 % with diet alone and about 1 % with exercise added.',
      howModelled:
        "Not applied as written: instead of multiplying the lean share of loss by 1.3 (range 1.0–1.6) from age 65, or by 0.85 with resistance training, the protein topic's partition raises the lean share gradually with age, and resistance training protects lean tissue through the training model. Hip bone density falls 0.3 % per 1 % weight loss with diet only, and 0.1 % with exercise. Bone is handed to the bone and performance topic.",
      equation:
        'leanShareOfLossMult = 1.3 (age 65 and over, diet only);  × 0.85 if resistance training present\nHip BMD: −0.3 % per 1 % weight loss (diet only); −0.1 % per 1 % (with exercise)',
      keyNumbers: [
        {
          label: 'One-year trial in 107 obese adults aged 65 or older: diet',
          value:
            'Weight −9.7 ± 5.4 kg (−10 %); lean −3.2 ± 2.0 kg (−5 %), so lean mass was 33 % of weight lost',
          referenceIds: ['villareal2011'],
        },
        {
          label: 'Diet plus exercise',
          value:
            'Weight −8.6 ± 3.8 kg (−9 %); lean −1.8 ± 1.7 kg (−3 %), so lean mass was 21 % of weight lost; exercise only: lean +1.3 kg (+2 %)',
          referenceIds: ['villareal2011'],
        },
        {
          label: 'Bone and function in the same trial',
          value:
            'Hip bone density −3 % (diet) vs −1 % (diet plus exercise) (P < 0.05); Physical Performance Test +12 % (diet), +15 % (exercise), +21 % (both); peak VO₂ +10 %, +8 %, +17 %',
          referenceIds: ['villareal2011'],
        },
        {
          label: 'Systematic review of losses over 10 kg',
          value:
            'Percentage of fat-free mass lost rises with the degree of energy restriction (r² = 0.31) and falls with exercise',
          referenceIds: ['chaston2007'],
        },
        {
          label: 'Typical lean share of diet-induced loss in adults',
          value: 'About 25 %',
          referenceIds: ['christensen2018', 'karakasis2025'],
        },
      ],
      moderators: 'Age, obesity, degree of energy restriction and exercise.',
      grade: 'C',
      gradeReason: 'A single randomised trial in obese older adults.',
      status: 'proposed-fit',
      caveats:
        'Applying the 0.85 factor on top of 1.3 gives a lean share of about 0.28, against 0.21 measured with exercise in the trial.',
      referenceIds: ['christensen2018', 'villareal2011', 'chaston2007', 'karakasis2025'],
      relatedMetricIds: ['leanTissue', 'hipBmdChange'],
    },
    {
      id: '16-age-aerobic-glucose-hormones',
      title: 'Age and aerobic fitness, blood sugar, testosterone and fasting',
      category: 'cardio',
      summary:
        'Peak oxygen uptake, a measure of aerobic fitness, falls about 3–6 % per decade in the 20s and 30s and more than 20 % per decade from the 70s. After age 60, blood sugar two hours after a sugar drink is about 1.1 mmol/L higher, independent of fatness and fitness. Testosterone in men falls by about 1–2 % a year. There are no verified numbers for fasting tolerance or exercise recovery in older adults.',
      howModelled:
        'Peak oxygen uptake at the start is estimated from age and other factors, but it is not aged during a run, so the decline rates here (0.45 %/yr from 25–40, 1.0 %/yr from 40–60, 1.5 %/yr from 60–70 and 2.2 %/yr above 70, an interpolation, ±30 %) are not applied. The proposed +1.1 mmol/L offset on two-hour glucose after age 60 is not applied either. No multipliers are used for fasting tolerance or exercise recovery in older adults.',
      keyNumbers: [
        {
          label: 'Peak VO₂ (810 adults aged 21–87; median 7.9-year follow-up)',
          value:
            'Longitudinal decline 3–6 % per decade in the 20s–30s, accelerating to more than 20 % per decade in the 70s and beyond; larger in men from the 40s, regardless of activity',
          referenceIds: ['fleg2005'],
        },
        {
          label: 'Cross-sectional summary and training',
          value:
            'About 10 % per decade; high-intensity training may reduce the loss by up to 50 % in young and middle-aged men, but not older men',
          referenceIds: ['hawkins2003'],
        },
        {
          label: '2-hour glucose after a sugar drink (743 healthy participants aged 17–92)',
          value:
            'Men (young / middle / old) 6.61 / 6.78 / 7.83 mmol/L; women 6.22 / 6.22 / 7.28; age 60 or more still adds about +1.1 mmol/L (±0.4)',
          note: 'The young-to-middle difference is explained by fatness, fitness and fat distribution. Sleep restriction plus circadian disruption had the same effect on post-meal glucose in young and older adults.',
          referenceIds: ['buxton2012', 'shimokata1991'],
        },
        {
          label: 'Testosterone in men',
          value: 'Normal aging lowers it by roughly 1–2 % per year',
          note: 'A statement in a letter; an independent primary source was not retrieved.',
          referenceIds: ['leproult2011'],
        },
        {
          label: 'Fasting ketones',
          value: 'Fasting β-hydroxybutyrate rises about 1 %/yr with age in men',
          referenceIds: ['knol2026'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The endpoints are grade B, but the interpolation between them and the testosterone figure are only grade C.',
      status: 'proposed-fit',
      caveats:
        'The peak oxygen uptake rates between the measured endpoints are an interpolation. Bone is covered by the menopause and older-adult deficit mechanisms.',
      referenceIds: ['leproult2011', 'buxton2012', 'knol2026', 'fleg2005', 'hawkins2003', 'shimokata1991'],
      relatedMetricIds: [],
    },
    {
      id: '16-adolescents-exclusion',
      title: 'Under 18: why adult equations do not apply',
      category: 'body',
      summary:
        'Growing bodies burn energy differently, are still building peak bone mass, and are at risk from weight-focused messaging. Every adult equation in Vitals would be invalid for a maturing body, so under-18s are excluded. People aged 18–24 get a note that growth and bone maturation may be incomplete.',
      howModelled:
        'Ages under 18 are a hard exclusion. Ages 18–24 show a warning. Final policy is set in the safety topic.',
      keyNumbers: [
        {
          label: 'Expenditure adjusted for body composition',
          value:
            'Not at adult level until about age 20 (break point 20.5 years, 95 % CI 19.8–21.2); about 148 % of the adult level at 1–2 years, falling about 2.8 %/yr',
          referenceIds: ['pontzer2021'],
        },
        {
          label: 'Bone mass accrual',
          value:
            'Total-body bone mineral content plateaus at about 18 years in girls and 20 in boys; about 39 % of adult content is accrued in the circumpubertal years; peak bone mass is reached by the end of the second or early third decade',
          referenceIds: ['baxterjones2011'],
        },
        {
          label: 'Psychological risk',
          value:
            'Weight-focused messaging in teenagers risks eating disorders; guidance emphasises a healthy lifestyle rather than weight',
          referenceIds: ['golden2016'],
        },
      ],
      grade: 'B',
      gradeReason:
        'The physiological facts are grade B; the exclusion itself is a policy decision, not an evidence claim.',
      status: 'established',
      caveats:
        'An energy-availability deficit can permanently lower peak bone mass. All other data in this topic (sleep, cycle, protein) are adult, and paediatric BMI-percentile and growth-velocity logic is out of scope.',
      referenceIds: ['pontzer2021', 'baxterjones2011', 'golden2016'],
      relatedMetricIds: [],
    },
    {
      id: '16-body-fat-level-moderator',
      title: 'How your starting body fat changes the response',
      category: 'body',
      summary:
        'Starting body fat determines how much of a weight change is lean tissue, and it changes how the body handles starvation. Lean people lose relatively more protein and make about twice as many ketones in the first days of a fast. Leptin tracks body fat closely. Extreme leanness carries hormonal and mood costs, which triggers safety flags.',
      howModelled:
        "The partition of weight change follows the protein topic's Forbes-based partition, so sex and age differences in composition arise largely on their own. The proposed early-ketone multiplier for fasting days 1–3 (×1.0 at higher body fat to ×2.0 at low body fat) is not applied. Anabolic resistance in obesity has no verified multiplier for muscle growth; it appears only in the muscle-protein-synthesis display, and no separate flag is raised. Safety flags apply below 10 % body fat in men and 18 % in women.",
      equation:
        'ketoEarlyMult = 1 + clamp((BFhi − BF%) / (BFhi − BFlo), 0, 1),  (BFhi, BFlo) = (30 %, 12 %) men, (40 %, 22 %) women\nobeseAnabolicMult = 1.0',
      keyNumbers: [
        {
          label: 'Partition of weight change',
          value:
            'The fat-free fraction of a weight change is a function of initial fat mass (Forbes; extended by Hall through the P-ratio)',
          referenceIds: ['hall2007'],
        },
        {
          label: 'Lean vs obese subjects in total starvation',
          value:
            'Protein loss and protein’s share of energy 2–3 times lower in obese; urea share of urinary nitrogen 2 times lower; protein contribution to glucose production about half; early ketones typically 2 times greater in lean; glucose tolerance impaired more in lean',
          note: 'Older metabolic-ward literature.',
          referenceIds: ['elia1999'],
        },
        {
          label: 'Leptin and body fat',
          value: 'Serum leptin correlates with % body fat (r = 0.85)',
          referenceIds: ['considine1996'],
        },
        {
          label: 'Obesity and anabolic resistance in older men',
          value: 'Multiplier fixed at 1.0 with a flag for BMI of 30 or more at age 55 or over',
          referenceIds: ['murton2015'],
        },
        {
          label: 'Extreme leanness (case report, 4.5 % body fat)',
          value: 'Testosterone −75 %; mood disturbance ×7',
          note: 'One person. The safety cut-offs (below 10 % body fat in men, below 18 % in women) are UI proposals.',
          referenceIds: ['rossow2013'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Older metabolic-ward studies and a proposed linear multiplier anchored to a single ratio.',
      status: 'proposed-fit',
      caveats:
        'A body-fat term alone would predict lower ketone levels in women at equal BMI, while observed data show women equal or higher, so both the body-fat and the sex terms are kept, with large uncertainty.',
      referenceIds: ['rossow2013', 'considine1996', 'hall2007', 'elia1999', 'murton2015'],
      relatedMetricIds: ['leanTissue', 'fatMass'],
    },
    {
      id: '16-individual-variability-ethnicity',
      title: 'People differ: variability, genetics and ethnicity',
      category: 'body',
      summary:
        'Identical twins overfed by the same amount gained anywhere from 4.3 to 13.3 kg. Muscle growth from the same training varied from −2 % to +59 %. Some of that spread is measurement error, but part is genetic and real. Vitals therefore shows likely ranges, not single numbers. Ethnicity is used only for converting BMI into body fat and for visceral fat risk display, not for energy expenditure.',
      howModelled:
        'Bands (80 % likely ranges) are drawn around the mechanistic mean and are deliberately wider than the sleep, stress and cycle effects, to avoid false precision. Ethnicity feeds only the BMI-to-body-fat conversion and the visceral-fat display, with no multiplier on resting rate, total expenditure or weight-change partition.',
      equation:
        '80 % likely-range widths (proposed): fat-mass change ±35 %; lean-mass change ±50 %; hypertrophy ±64 %; resting rate ±13 %; total expenditure ±26 %; weight gain in surplus ±36 %; free-living 12-month weight change ±(60–100) %',
      keyNumbers: [
        {
          label:
            'Identical overfeeding of 84,000 kcal (12 identical male twin pairs, +1,000 kcal/d for 84 days)',
          value:
            'Mean weight gain 8.1 kg, range 4.3–13.3 kg; about 3 times more variance between pairs than within pairs (r ≈ 0.5); visceral and regional fat distribution about 6 times (r ≈ 0.7)',
          referenceIds: ['bouchard1990'],
        },
        {
          label: '12-month weight change (609 adults on a low-fat or low-carbohydrate diet)',
          value:
            'Mean −5.3 kg (low-fat) vs −6.0 kg (low-carbohydrate); individual changes spanned about −30 to +10 kg within each group; no genotype-pattern × diet and no insulin-secretion × diet interaction',
          note: 'The range comes from the journal text.',
          referenceIds: ['gardner2018'],
        },
        {
          label: 'Muscle growth (585 adults, 12 weeks of elbow-flexor training)',
          value:
            'Cross-sectional area change −2 % to +59 %; one-repetition maximum 0 to +250 %; coefficient of variation 0.48 (men) and 0.51 (women)',
          referenceIds: ['hubal2005'],
        },
        {
          label: 'Fitness trainability (481 sedentary adults, 20 weeks)',
          value:
            'Mean VO₂max gain about +400 mL/min, from about 0 to over 1,000 mL/min; heritability up to 47 %; 2.5 times more variance between than within families',
          referenceIds: ['bouchard1999'],
        },
        {
          label: 'Energy expenditure',
          value:
            'Total expenditure residual of at least ±20 % after adjusting for fat-free mass, fat mass, sex and age (includes measurement error); adjusted resting rate SD about 8–10 % (men 127, women 153 kcal/d)',
          referenceIds: ['arciero1993', 'pontzer2021'],
        },
        {
          label: 'Statistical caveat',
          value:
            'Observed variation overstates true individual response (measurement error, within-person variation), but a genetic contribution to exercise response is well supported',
          referenceIds: ['hecksteden2015', 'ross2019'],
        },
        {
          label: 'Ethnicity and body fat',
          value:
            'Asian populations have 3–5 percentage points more body fat at the same BMI (about 3–4 BMI units lower for the same body fat); women carry 10.4 points more at equal BMI',
          referenceIds: ['jackson2002', 'deurenberg2002'],
        },
        {
          label: 'BMI-to-body-fat equations',
          value: 'Need sex, age and ethnic group (n = 1,626; standard error 2.8–5.4 % fat)',
          referenceIds: ['gallagher2000'],
        },
        {
          label: 'Visceral fat by ethnic group (n = 822)',
          value:
            'BMI underestimates visceral fat in Chinese, South Asian and Aboriginal Canadian people vs Europeans; Chinese have progressively more visceral fat above 9.1 kg total fat; South Asians more below about 37 kg fat; Aboriginal about equal to European',
          referenceIds: ['lear2007'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Ethnicity findings are grade B (cross-sectional), but the likely-range widths are pragmatic composites of coefficients of variation from short trials, graded C or D.',
      status: 'proposed-fit',
      caveats:
        'True individual variance is smaller than the observed coefficients of variation suggest, but heritable components are real. The bands must stay wider than the sleep, stress and cycle moderators. No ethnicity multiplier on expenditure or partition was tested in the sources read.',
      referenceIds: [
        'hubal2005',
        'arciero1993',
        'pontzer2021',
        'jackson2002',
        'bouchard1990',
        'bouchard1999',
        'gardner2018',
        'deurenberg2002',
        'lear2007',
        'hecksteden2015',
        'gallagher2000',
        'ross2019',
      ],
      relatedMetricIds: ['bodyFatPct'],
    },
    {
      id: '16-medicines-and-conditions',
      title: 'Medicines and conditions that break the average model',
      category: 'energy',
      summary:
        'For some medicines and conditions the average human model is no longer a fair guide. Thyroid disease and its treatment change expenditure. Newer weight-loss medicines replace the hunger pathway with appetite suppression. SGLT2 inhibitors push the body toward ketone production. Anabolic steroids put muscle growth far outside the normal range. Vitals shows a banner and, where noted, blocks certain features rather than simulating them.',
      howModelled:
        'A required checklist acts as a safety gate: hard exclusion, warning, or an “average model not valid” banner. Weight-loss medicines are not modelled in the first version. If a toggle were added, the drive to eat would be multiplied by 0.75 (band 0.6–0.9), the lean share of loss would be 1.0–1.15 times normal, resting rate per kg lean mass would be unchanged, and hunger outputs would be invalid.',
      keyNumbers: [
        {
          label: 'Thyroid hormone replacement (9 patients on chronic levothyroxine)',
          value:
            'Resting energy expenditure per unit fat-free mass fell about 15 % as TSH rose from 0.1 to 10 mU/L',
          note: 'Resting rate band ±15 %; no source was read for hyperthyroidism.',
          referenceIds: ['aladsani1997'],
        },
        {
          label: 'Polycystic ovary syndrome (PCOS)',
          value: 'Lifestyle intervention: weight −1.68 kg (95 % CI −2.66 to −0.70; 9 RCTs, low quality)',
          note: 'Resting-expenditure differences vs women without PCOS are inconsistent (preprint, not peer-reviewed).',
          referenceIds: ['lim2019', 'kirwan2026'],
        },
        {
          label: 'SGLT2 inhibitor (empagliflozin, type 2 diabetes)',
          value:
            'β-hydroxybutyrate 246 → 561 µmol/L after 4 weeks; more lipolysis, lipid oxidation and endogenous glucose production',
          note: 'Regulatory warnings on ketoacidosis with low-carbohydrate eating or fasting are unverified here.',
          referenceIds: ['ferrannini2016'],
        },
        {
          label: 'Semaglutide 2.4 mg, 68 weeks (N = 1,961)',
          value: 'Weight −14.9 % vs −2.4 % with placebo',
          referenceIds: ['wilding2021'],
        },
        {
          label: 'Tirzepatide, 72 weeks (N = 2,539)',
          value: 'Weight −15.0 / −19.5 / −20.9 % vs −3.1 % with placebo',
          referenceIds: ['jastreboff2022'],
        },
        {
          label: 'Semaglutide 1.0 mg, 12 weeks (N = 30)',
          value:
            'Free-eating intake −24 % (−3,036 kJ, about −726 kcal); resting rate and lean mass unchanged; −5.0 kg mostly fat',
          referenceIds: ['blundell2017'],
        },
        {
          label: 'Composition of weight lost on these medicines',
          value:
            'Tirzepatide DXA substudy (n = 160): weight −21.3 %, fat −33.9 %, lean −10.9 % (placebo −5.3 / −8.2 / −2.6), about 75 % fat and 25 % lean in both arms; a 22-RCT meta-analysis about 25 %; a 35-study review median 28.3 % (IQR 15.9–39.9) from muscle-based indices; the range across studies is 15 % to 40–60 %',
          note: 'The DXA figures from the semaglutide 2.4 mg trial are unverified (not retrievable).',
          referenceIds: ['look2025', 'neeland2024', 'karakasis2025', 'batsis2026'],
        },
        {
          label: 'Testosterone therapy (43 men, 600 mg testosterone enanthate per week for 10 weeks)',
          value:
            'Fat-free mass +6.1 kg with training; quadriceps cross-sectional area +1,174 mm² with training vs +607 without training vs −131 with placebo',
          referenceIds: ['bhasin1996'],
        },
        {
          label: 'Other conditions',
          value:
            'Type 2 diabetes on insulin or sulfonylureas: soft exclusion of ketogenic and fasting features. Type 1 diabetes, eating-disorder history, kidney disease (eGFR below 30), liver disease, cancer cachexia and bariatric surgery: hard exclusion or banner',
          note: 'No effect sizes were verified for glucocorticoids, insulin and sulfonylureas, or for antipsychotics, mirtazapine, valproate, beta-blockers, diuretics, stimulants and lithium.',
          referenceIds: ['bauer2013'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Anchors range from randomised trials (A) to single small studies (C), and several drug classes have no verified numbers at all.',
      status: 'established',
      caveats:
        'This list works as a disclaimer, not as a model. Glucocorticoids and many other drug classes carry a banner because no numbers were verified.',
      referenceIds: [
        'bauer2013',
        'wilding2021',
        'jastreboff2022',
        'look2025',
        'neeland2024',
        'karakasis2025',
        'batsis2026',
        'blundell2017',
        'aladsani1997',
        'lim2019',
        'ferrannini2016',
        'bhasin1996',
        'kirwan2026',
      ],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '16-myth-short-sleep-slows-metabolism',
      claim: 'Short sleep slows your metabolism.',
      verdict: 'not-supported',
      explanation:
        'Measured energy expenditure is unchanged, or up by about 5 %, with short sleep. The harm shows up elsewhere: people eat about 250–385 kcal a day more when free to, insulin sensitivity falls, and in a deficit the mix of weight lost may shift.',
      referenceIds: ['alkhatib2017', 'zhu2019', 'markwald2013', 'covassin2022', 'calvin2013', 'shechter2014'],
    },
    {
      id: '16-myth-sleep-restriction-halves-fat-loss',
      claim: 'Sleep restriction halves fat loss.',
      verdict: 'unproven',
      explanation:
        'The claim comes from one crossover trial of 10 people. A second trial of 36 people found no difference in the amount of fat or lean mass lost, only in the proportion, with a wide spread and groups that differed at baseline. The effect is plausible but has not been replicated at that size.',
      referenceIds: ['nedeltcheva2010', 'wang2018'],
    },
    {
      id: '16-myth-weekend-catch-up-sleep',
      claim: 'You can catch up on sleep at the weekend.',
      verdict: 'not-supported',
      explanation:
        'Weekend recovery sleep did not prevent the loss of insulin sensitivity (−9 to −27 %), and two recovery nights did not restore it in another study.',
      referenceIds: ['depner2019', 'ness2019'],
    },
    {
      id: '16-myth-luteal-water-hides-fat-loss',
      claim: 'Water retention in the second half of the cycle hides fat loss by kilograms.',
      verdict: 'not-supported',
      explanation:
        'Objective studies disagree on whether weight goes up or down and the average is under about 0.5 kg. Plasma volume is highest in the early follicular phase, and self-reported bloating peaks on the first day of flow and is unrelated to oestradiol or progesterone. One study often cited on this measured self-reported symptoms, not scale weight.',
      referenceIds: ['white2011', 'aguree2020', 'kosar2022', 'wagner2026', 'takano2026'],
    },
    {
      id: '16-myth-periodise-by-cycle-phase',
      claim: 'Women should periodise diet and training by menstrual cycle phase.',
      verdict: 'unproven',
      explanation:
        'Training adaptation, performance and fuel use show no reliable phase effects. Only intake, about 168 kcal a day higher in the luteal phase, has meta-analytic support, and it comes with methodological caveats.',
      referenceIds: ['tucker2025', 'dsouza2023', 'mcnulty2020', 'colensosemple2023'],
    },
    {
      id: '16-myth-stress-hormones-make-you-fat',
      claim: 'Stress hormones make you fat or hold water.',
      verdict: 'oversimplified',
      explanation:
        'Over time, stress explains almost none of the change in body fat (r = 0.014). Hair-cortisol links to body fat come from snapshot studies that cannot show cause. No human evidence was found for stress-driven water retention.',
      referenceIds: ['wardle2011', 'vandervalk2022'],
    },
    {
      id: '16-myth-women-build-muscle-slower',
      claim: 'Women build muscle more slowly.',
      verdict: 'not-supported',
      explanation:
        'Relative muscle growth is equal between sexes (effect-size difference 0.07 ± 0.06). Because women start with less muscle, the absolute kilograms gained are smaller.',
      referenceIds: ['roberts2020'],
    },
    {
      id: '16-myth-metabolism-collapses-at-30-40-menopause',
      claim: 'Metabolism collapses at 30, at 40 or at menopause.',
      verdict: 'not-supported',
      explanation:
        'Expenditure adjusted for body composition is flat from 20 to 60 and then falls about 0.7 % a year. Menopause changes where fat is stored more than how much, and most of the gain is age-related.',
      referenceIds: ['pontzer2021', 'greendale2019', 'ambikairajah2019'],
    },
    {
      id: '16-myth-1995-menopause-study-rmr',
      claim: 'The 1995 menopause study shows that resting metabolic rate drops by 100 kcal a day.',
      verdict: 'not-supported',
      explanation:
        'The paper behind that figure was retracted in 2003 and should not be used as evidence. Vitals does not use it.',
      referenceIds: [],
    },
    {
      id: '16-myth-older-adults-cannot-build-muscle',
      claim: 'Older adults cannot build muscle.',
      verdict: 'not-supported',
      explanation:
        'They can. In a 16-week trial their fibre growth was about 0.7 times the young rate, and they needed about 0.4 g/kg of protein per meal for a full muscle response, compared with about 0.24 g/kg when young.',
      referenceIds: ['moore2015', 'kosek2006'],
    },
    {
      id: '16-myth-alcohol-helps-sleep',
      claim: 'Alcohol helps you sleep.',
      verdict: 'not-supported',
      explanation:
        'REM sleep is disrupted from about two drinks. Falling asleep faster shows up only at about five drinks, and that probably worsens REM disruption later in the night.',
      referenceIds: ['gardiner2025'],
    },
    {
      id: '16-myth-afternoon-coffee-harmless',
      claim: 'Caffeine’s half-life is 5–6 hours, so afternoon coffee is harmless.',
      verdict: 'not-supported',
      explanation:
        'After 8.8 hours about a third of a 107 mg dose remains (about 34 mg), roughly the residual associated with no lost sleep. Sooner than that, sleep suffers: 400 mg taken 6 hours before bed still disrupted sleep. Combined oral contraceptive users clear caffeine about 1.5 times more slowly.',
      referenceIds: ['gardiner2023', 'drake2013', 'abernethy1985'],
    },
    {
      id: '16-myth-keto-causes-insomnia',
      claim: 'Very low carbohydrate eating causes insomnia.',
      verdict: 'unproven',
      explanation:
        'In 48 hours of very low carbohydrate intake, deep sleep rose from 13.9 % to 17.7 % and REM sleep fell. Long-term data are lacking, and nothing here shows a change in how long people sleep.',
      referenceIds: ['afaghi2008', 'vlahoyiannis2021'],
    },
    {
      id: '16-myth-genetics-picks-your-diet',
      claim: 'Your genetics tell you which diet will work for you.',
      verdict: 'not-supported',
      explanation:
        'A 12-month trial in 609 adults found no interaction between genotype pattern or insulin secretion and the type of diet on weight loss.',
      referenceIds: ['gardner2018'],
    },
  ],
  openQuestions: [
    'Does short sleep really shift a diet toward lean-mass loss? The evidence is one trial of 10 people and one of 36 people with conflicting endpoints, and the 0.04-per-hour figure Vitals uses is a judgement call. A third trial is the most valuable missing evidence.',
    'How well do the sleep findings apply to women? The studies of testosterone, muscle protein and insulin sensitivity were all-male or nearly so, the performance meta-analysis was 89 % male, and sex effects in the appetite studies are inconsistent. Women’s testosterone, muscle-protein and insulin-sensitivity responses are largely unknown.',
    'How quickly do sleep effects build and clear? The time constants are inferred from a handful of fixed-duration protocols, and recovery over weeks after chronic restriction has not been measured.',
    'Do lab results carry over to real life? Lab restriction of 4–5 hours is extreme, and the real-life extension trial’s slope (−162 kcal/d per hour) exceeds the lab-derived 100 kcal/d per hour. It is unclear whether effects level off below about 4 hours or in people who are already short sleepers.',
    'Cycle effects remain unclear: the sign of scale-weight changes conflicts, the resting-rate effect cannot be converted into calories, intake results rely on self-reported diaries, insulin sensitivity across the cycle is unestablished in non-diabetic women, and the effect of hormonal contraception on muscle growth is unresolved.',
    'Menopause vs age: population averages include behaviour change, the resting-rate effect is weak, and the only paper reporting a resting-rate drop of about 100 kcal/d was retracted.',
    'Age and muscle growth: the ramp starting at age 40 and the 0.72 multiplier come from one trial’s fibre data plus a meta-regression, and men and women differ within older groups.',
    'Anabolic resistance: the 40-to-70-year ramp interpolates between men aged 22 and 71. Women and middle age are unmeasured.',
    'Sex and the lean share of weight loss: the two large studies contradict each other, and adjudication would need harmonised body-composition methods.',
    'Stress: the effect on intake is tiny and heterogeneous, and the assumed between-person intake SD of 500–600 kcal is unverified.',
    'Ketone multipliers for sex and hormonal contraception are extrapolated from single-time fasting and after-meal associations, because no controlled multi-day fasting study compared the sexes.',
    'The likely-range widths (±35, ±50, ±64, ±13, ±26 %) are pragmatic composites of coefficients of variation from short trials. True individual variance is smaller than observed, but heritable components are real.',
    'Not searched or verified: essential-fat floors, DXA figures for the semaglutide 2.4 mg trial, effect sizes for glucocorticoids and for insulin and sulfonylureas, fasting tolerance in older adults, ageing multipliers for exercise recovery, and hyperthyroid effects on resting rate.',
  ],
  references: [
    {
      id: 'nedeltcheva2010',
      authors: 'Nedeltcheva AV, Kilkus JM, Imperial J, Schoeller DA, Penev PD',
      year: 2010,
      title: 'Insufficient sleep undermines dietary efforts to reduce adiposity',
      journal: 'Ann Intern Med',
      pmid: '20921542',
      doi: '10.7326/0003-4819-153-7-201010050-00006',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20921542/',
      verification: 'full-text',
    },
    {
      id: 'wang2018',
      authors: 'Wang X, Sparks JR, Bowyer KP, Youngstedt SD',
      year: 2018,
      title: 'Influence of sleep restriction on weight loss outcomes associated with caloric restriction',
      journal: 'Sleep',
      pmid: '29438540',
      doi: '10.1093/sleep/zsy027',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29438540/',
      verification: 'full-text',
    },
    {
      id: 'alkhatib2017',
      authors: 'Al Khatib HK, Harding SV, Darzi J, Pot GK',
      year: 2017,
      title:
        'The effects of partial sleep deprivation on energy balance: a systematic review and meta-analysis',
      journal: 'Eur J Clin Nutr',
      pmid: '27804960',
      doi: '10.1038/ejcn.2016.201',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27804960/',
      verification: 'abstract',
    },
    {
      id: 'zhu2019',
      authors: 'Zhu B, Shi C, Park CG, Zhao X, Reutrakul S',
      year: 2019,
      title:
        'Effects of sleep restriction on metabolism-related parameters in healthy adults: a comprehensive review and meta-analysis of randomized controlled trials',
      journal: 'Sleep Med Rev',
      pmid: '30870662',
      doi: '10.1016/j.smrv.2019.02.002',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30870662/',
      verification: 'abstract',
    },
    {
      id: 'gonzalezortiz2020',
      authors: 'González-Ortiz A, López-Bautista F, Valencia-Flores M, Espinosa Cuevas Á',
      year: 2020,
      title:
        'Partial sleep deprivation on dietary energy intake in healthy population: a systematic review and meta-analysis',
      journal: 'Nutr Hosp',
      pmid: '32960623',
      doi: '10.20960/nh.03108',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32960623/',
      verification: 'abstract',
    },
    {
      id: 'capers2015',
      authors: 'Capers PL, Fobian AD, Kaiser KA, Borah R, Allison DB',
      year: 2015,
      title:
        'A systematic review and meta-analysis of randomized controlled trials of the impact of sleep duration on adiposity and components of energy balance',
      journal: 'Obes Rev',
      pmid: '26098388',
      doi: '10.1111/obr.12296',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26098388/',
      verification: 'abstract',
    },
    {
      id: 'tasali2022',
      authors: 'Tasali E, Wroblewski K, Kahn E, Kilkus J, Schoeller DA',
      year: 2022,
      title:
        'Effect of sleep extension on objectively assessed energy intake among adults with overweight in real-life settings: a randomized clinical trial',
      journal: 'JAMA Intern Med',
      pmid: '35129580',
      doi: '10.1001/jamainternmed.2021.8098',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35129580/',
      verification: 'full-text',
    },
    {
      id: 'spiegel2004',
      authors: 'Spiegel K, Tasali E, Penev P, Van Cauter E',
      year: 2004,
      title:
        'Sleep curtailment in healthy young men is associated with decreased leptin levels, elevated ghrelin levels, and increased hunger and appetite',
      journal: 'Ann Intern Med',
      pmid: '15583226',
      doi: '10.7326/0003-4819-141-11-200412070-00008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15583226/',
      verification: 'abstract',
    },
    {
      id: 'buxton2010',
      authors: 'Buxton OM, Pavlova M, Reid EW, Wang W, Simonson DC, Adler GK',
      year: 2010,
      title: 'Sleep restriction for 1 week reduces insulin sensitivity in healthy men',
      journal: 'Diabetes',
      pmid: '20585000',
      doi: '10.2337/db09-0699',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20585000/',
      verification: 'abstract',
    },
    {
      id: 'broussard2012',
      authors: 'Broussard JL, Ehrmann DA, Van Cauter E, Tasali E, Brady MJ',
      year: 2012,
      title:
        'Impaired insulin signaling in human adipocytes after experimental sleep restriction: a randomized, crossover study',
      journal: 'Ann Intern Med',
      pmid: '23070488',
      doi: '10.7326/0003-4819-157-8-201210160-00005',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23070488/',
      verification: 'abstract',
    },
    {
      id: 'markwald2013',
      authors: 'Markwald RR, Melanson EL, Smith MR, et al.',
      year: 2013,
      title: 'Impact of insufficient sleep on total daily energy expenditure, food intake, and weight gain',
      journal: 'Proc Natl Acad Sci USA',
      pmid: '23479616',
      doi: '10.1073/pnas.1216951110',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23479616/',
      verification: 'abstract',
    },
    {
      id: 'saner2020',
      authors: 'Saner NJ, Lee MJ, Pitchford NW, et al.',
      year: 2020,
      title:
        'The effect of sleep restriction, with or without high-intensity interval exercise, on myofibrillar protein synthesis in healthy young men',
      journal: 'J Physiol',
      pmid: '32078168',
      doi: '10.1113/JP278828',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32078168/',
      verification: 'abstract',
    },
    {
      id: 'lamon2021',
      authors: 'Lamon S, Morabito A, Arentson-Lantz E, et al.',
      year: 2021,
      title:
        'The effect of acute sleep deprivation on skeletal muscle protein synthesis and the hormonal environment',
      journal: 'Physiol Rep',
      pmid: '33400856',
      doi: '10.14814/phy2.14660',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33400856/',
      verification: 'abstract',
    },
    {
      id: 'leproult2011',
      authors: 'Leproult R, Van Cauter E',
      year: 2011,
      title: 'Effect of 1 week of sleep restriction on testosterone levels in young healthy men',
      journal: 'JAMA',
      pmid: '21632481',
      doi: '10.1001/jama.2011.710',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21632481/',
      verification: 'full-text',
    },
    {
      id: 'covassin2022',
      authors: 'Covassin N, Singh P, McCrady-Spitzer SK, et al.',
      year: 2022,
      title:
        'Effects of experimental sleep restriction on energy intake, energy expenditure, and visceral obesity',
      journal: 'J Am Coll Cardiol',
      pmid: '35361348',
      doi: '10.1016/j.jacc.2022.01.038',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35361348/',
      verification: 'full-text',
    },
    {
      id: 'nedeltcheva2009',
      authors: 'Nedeltcheva AV, Kilkus JM, Imperial J, et al.',
      year: 2009,
      title: 'Sleep curtailment is accompanied by increased intake of calories from snacks',
      journal: 'Am J Clin Nutr',
      pmid: '19056602',
      doi: '10.3945/ajcn.2008.26574',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19056602/',
      verification: 'abstract',
    },
    {
      id: 'brondel2010',
      authors: 'Brondel L, Romer MA, Nougues PM, Touyarou P, Davenne D',
      year: 2010,
      title: 'Acute partial sleep deprivation increases food intake in healthy men',
      journal: 'Am J Clin Nutr',
      pmid: '20357041',
      doi: '10.3945/ajcn.2009.28523',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20357041/',
      verification: 'abstract',
    },
    {
      id: 'calvin2013',
      authors: 'Calvin AD, Carter RE, Adachi T, et al.',
      year: 2013,
      title: 'Effects of experimental sleep restriction on caloric intake and activity energy expenditure',
      journal: 'Chest',
      pmid: '23392199',
      doi: '10.1378/chest.12-2829',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23392199/',
      verification: 'abstract',
    },
    {
      id: 'spaeth2013',
      authors: 'Spaeth AM, Dinges DF, Goel N',
      year: 2013,
      title:
        'Effects of experimental sleep restriction on weight gain, caloric intake, and meal timing in healthy adults',
      journal: 'Sleep',
      pmid: '23814334',
      doi: '10.5665/sleep.2792',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23814334/',
      verification: 'abstract',
    },
    {
      id: 'shechter2014',
      authors: 'Shechter A, Rising R, Wolfe S, Albu JB, St-Onge MP',
      year: 2014,
      title: 'Postprandial thermogenesis and substrate oxidation are unaffected by sleep restriction',
      journal: 'Int J Obes',
      pmid: '24352294',
      doi: '10.1038/ijo.2013.239',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24352294/',
      verification: 'abstract',
    },
    {
      id: 'depner2019',
      authors: 'Depner CM, Melanson EL, Eckel RH, et al.',
      year: 2019,
      title:
        'Ad libitum weekend recovery sleep fails to prevent metabolic dysregulation during a repeating pattern of insufficient sleep and weekend recovery sleep',
      journal: 'Curr Biol',
      pmid: '30827911',
      doi: '10.1016/j.cub.2019.01.069',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30827911/',
      verification: 'abstract',
    },
    {
      id: 'ness2019',
      authors: 'Ness KM, Strayer SM, Nahmod NG, et al.',
      year: 2019,
      title:
        'Two nights of recovery sleep restores the dynamic lipemic response, but not the reduction of insulin sensitivity, induced by five nights of sleep restriction',
      journal: 'Am J Physiol Regul Integr Comp Physiol',
      pmid: '30892916',
      doi: '10.1152/ajpregu.00336.2018',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30892916/',
      verification: 'abstract',
    },
    {
      id: 'robertson2013',
      authors: 'Robertson MD, Russell-Jones D, Umpleby AM, Dijk DJ',
      year: 2013,
      title:
        'Effects of three weeks of mild sleep restriction implemented in the home environment on multiple metabolic and endocrine markers in healthy young men',
      journal: 'Metabolism',
      pmid: '22985906',
      doi: '10.1016/j.metabol.2012.07.016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22985906/',
      verification: 'abstract',
    },
    {
      id: 'craven2022',
      authors: 'Craven J, McCartney D, Desbrow B, et al.',
      year: 2022,
      title: 'Effects of acute sleep loss on physical performance: a systematic and meta-analytical review',
      journal: 'Sports Med',
      pmid: '35708888',
      doi: '10.1007/s40279-022-01706-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35708888/',
      verification: 'full-text',
    },
    {
      id: 'buxton2012',
      authors: "Buxton OM, Cain SW, O'Connor SP, et al.",
      year: 2012,
      title:
        'Adverse metabolic consequences in humans of prolonged sleep restriction combined with circadian disruption',
      journal: 'Sci Transl Med',
      pmid: '22496545',
      doi: '10.1126/scitranslmed.3003200',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22496545/',
      verification: 'full-text',
    },
    {
      id: 'scheer2009',
      authors: 'Scheer FAJL, Hilton MF, Mantzoros CS, Shea SA',
      year: 2009,
      title: 'Adverse metabolic and cardiovascular consequences of circadian misalignment',
      journal: 'Proc Natl Acad Sci USA',
      pmid: '19255424',
      doi: '10.1073/pnas.0808180106',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19255424/',
      verification: 'abstract',
    },
    {
      id: 'mchill2014',
      authors: 'McHill AW, Melanson EL, Higgins J, et al.',
      year: 2014,
      title: 'Impact of circadian misalignment on energy metabolism during simulated nightshift work',
      journal: 'Proc Natl Acad Sci USA',
      pmid: '25404342',
      doi: '10.1073/pnas.1412021111',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25404342/',
      verification: 'abstract',
    },
    {
      id: 'tasali2008',
      authors: 'Tasali E, Leproult R, Ehrmann DA, Van Cauter E',
      year: 2008,
      title: 'Slow-wave sleep and the risk of type 2 diabetes in humans',
      journal: 'Proc Natl Acad Sci USA',
      pmid: '18172212',
      doi: '10.1073/pnas.0706446105',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18172212/',
      verification: 'abstract',
    },
    {
      id: 'cappuccio2008',
      authors: 'Cappuccio FP, Taggart FM, Kandala NB, et al.',
      year: 2008,
      title: 'Meta-analysis of short sleep duration and obesity in children and adults',
      journal: 'Sleep',
      pmid: '18517032',
      doi: '10.1093/sleep/31.5.619',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18517032/',
      verification: 'abstract',
    },
    {
      id: 'kline2026',
      authors: 'Kline CE, Conroy MB, Brooks MM, Kriska AM, Barinas-Mitchell EJ',
      year: 2026,
      title:
        'Sleep duration and quality as predictors of weight loss and adherence during a behavioral weight loss intervention',
      journal: 'Behav Sleep Med',
      pmid: '41889166',
      doi: '10.1080/15402002.2026.2648510',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41889166/',
      verification: 'abstract',
    },
    {
      id: 'gardiner2023',
      authors: 'Gardiner C, Weakley J, Burke LM, et al.',
      year: 2023,
      title: 'The effect of caffeine on subsequent sleep: a systematic review and meta-analysis',
      journal: 'Sleep Med Rev',
      pmid: '36870101',
      doi: '10.1016/j.smrv.2023.101764',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36870101/',
      verification: 'abstract',
    },
    {
      id: 'drake2013',
      authors: 'Drake C, Roehrs T, Shambroom J, Roth T',
      year: 2013,
      title: 'Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed',
      journal: 'J Clin Sleep Med',
      pmid: '24235903',
      doi: '10.5664/jcsm.3170',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24235903/',
      verification: 'abstract',
    },
    {
      id: 'abernethy1985',
      authors: 'Abernethy DR, Todd EL',
      year: 1985,
      title:
        'Impairment of caffeine clearance by chronic use of low-dose oestrogen-containing oral contraceptives',
      journal: 'Eur J Clin Pharmacol',
      pmid: '4029248',
      doi: '10.1007/BF00544361',
      url: 'https://pubmed.ncbi.nlm.nih.gov/4029248/',
      verification: 'abstract',
    },
    {
      id: 'joeres1988',
      authors: 'Joeres R, Klinker H, Heusler H, et al.',
      year: 1988,
      title:
        'Influence of smoking on caffeine elimination in healthy volunteers and in patients with alcoholic liver cirrhosis',
      journal: 'Hepatology',
      pmid: '3371873',
      doi: '10.1002/hep.1840080323',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3371873/',
      verification: 'abstract',
    },
    {
      id: 'grzegorzewski2022',
      authors: 'Grzegorzewski J, Bartsch F, Köller A, König M',
      year: 2022,
      title:
        'Pharmacokinetics of caffeine: a systematic analysis of reported data for application in metabolic phenotyping and liver function testing',
      journal: 'Front Pharmacol',
      pmid: '35280254',
      doi: '10.3389/fphar.2021.752826',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35280254/',
      verification: 'abstract',
    },
    {
      id: 'gardiner2025',
      authors: 'Gardiner C, Weakley J, Burke LM, et al.',
      year: 2025,
      title:
        'The effect of alcohol on subsequent sleep in healthy adults: a systematic review and meta-analysis',
      journal: 'Sleep Med Rev',
      pmid: '39631226',
      doi: '10.1016/j.smrv.2024.102030',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39631226/',
      verification: 'abstract',
    },
    {
      id: 'dezambotti2021',
      authors: 'de Zambotti M, Forouzanfar M, Javitz H, et al.',
      year: 2021,
      title:
        'Impact of evening alcohol consumption on nocturnal autonomic and cardiovascular function in adult men and women: a dose-response laboratory investigation',
      journal: 'Sleep',
      pmid: '32663278',
      doi: '10.1093/sleep/zsaa135',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32663278/',
      verification: 'abstract',
    },
    {
      id: 'afaghi2007',
      authors: "Afaghi A, O'Connor H, Chow CM",
      year: 2007,
      title: 'High-glycemic-index carbohydrate meals shorten sleep onset',
      journal: 'Am J Clin Nutr',
      pmid: '17284739',
      doi: '10.1093/ajcn/85.2.426',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17284739/',
      verification: 'abstract',
    },
    {
      id: 'afaghi2008',
      authors: "Afaghi A, O'Connor H, Chow CM",
      year: 2008,
      title: 'Acute effects of the very low carbohydrate diet on sleep indices',
      journal: 'Nutr Neurosci',
      pmid: '18681982',
      doi: '10.1179/147683008X301540',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18681982/',
      verification: 'abstract',
    },
    {
      id: 'vlahoyiannis2021',
      authors: 'Vlahoyiannis A, Giannaki CD, Sakkas GK, Aphamis G, Andreou E',
      year: 2021,
      title:
        'A systematic review, meta-analysis and meta-regression on the effects of carbohydrates on sleep',
      journal: 'Nutrients',
      pmid: '33919698',
      doi: '10.3390/nu13041283',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33919698/',
      verification: 'abstract',
    },
    {
      id: 'crispim2011',
      authors: 'Crispim CA, Zimberg IZ, dos Reis BG, et al.',
      year: 2011,
      title: 'Relationship between food intake and sleep pattern in healthy individuals',
      journal: 'J Clin Sleep Med',
      pmid: '22171206',
      doi: '10.5664/jcsm.1476',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22171206/',
      verification: 'abstract',
    },
    {
      id: 'stonge2016',
      authors: 'St-Onge MP, Roberts A, Shechter A, Choudhury AR',
      year: 2016,
      title: 'Fiber and saturated fat are associated with sleep arousals and slow wave sleep',
      journal: 'J Clin Sleep Med',
      pmid: '26156950',
      doi: '10.5664/jcsm.5384',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26156950/',
      verification: 'abstract',
    },
    {
      id: 'stutz2019',
      authors: 'Stutz J, Eiholzer R, Spengler CM',
      year: 2019,
      title:
        'Effects of evening exercise on sleep in healthy participants: a systematic review and meta-analysis',
      journal: 'Sports Med',
      pmid: '30374942',
      doi: '10.1007/s40279-018-1015-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30374942/',
      verification: 'abstract',
    },
    {
      id: 'kredlow2015',
      authors: 'Kredlow MA, Capozzoli MC, Hearon BA, Calkins AW, Otto MW',
      year: 2015,
      title: 'The effects of physical activity on sleep: a meta-analytic review',
      journal: 'J Behav Med',
      pmid: '25596964',
      doi: '10.1007/s10865-015-9617-6',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25596964/',
      verification: 'abstract',
    },
    {
      id: 'martin2016',
      authors: 'Martin CK, Bhapkar M, Pittas AG, et al.',
      year: 2016,
      title:
        'Effect of calorie restriction on mood, quality of life, sleep, and sexual function in healthy nonobese adults: the CALERIE 2 randomized clinical trial',
      journal: 'JAMA Intern Med',
      pmid: '27136347',
      doi: '10.1001/jamainternmed.2016.1189',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27136347/',
      verification: 'abstract',
    },
    {
      id: 'rossow2013',
      authors: 'Rossow LM, Fukuda DH, Fahs CA, Loenneke JP, Stout JR',
      year: 2013,
      title: 'Natural bodybuilding competition preparation and recovery: a 12-month case study',
      journal: 'Int J Sports Physiol Perform',
      pmid: '23412685',
      doi: '10.1123/ijspp.8.5.582',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23412685/',
      verification: 'abstract',
    },
    {
      id: 'hill2022',
      authors: 'Hill D, Conner M, Clancy F, et al.',
      year: 2022,
      title: 'Stress and eating behaviours in healthy adults: a systematic review and meta-analysis',
      journal: 'Health Psychol Rev',
      pmid: '33913377',
      doi: '10.1080/17437199.2021.1923406',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33913377/',
      verification: 'abstract',
    },
    {
      id: 'wardle2011',
      authors: 'Wardle J, Chida Y, Gibson EL, Whitaker KL, Steptoe A',
      year: 2011,
      title: 'Stress and adiposity: a meta-analysis of longitudinal studies',
      journal: 'Obesity',
      pmid: '20948519',
      doi: '10.1038/oby.2010.241',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20948519/',
      verification: 'abstract',
    },
    {
      id: 'vandervalk2022',
      authors: 'van der Valk ES, Abawi O, Mohseni M, et al.',
      year: 2022,
      title:
        'Cross-sectional relation of long-term glucocorticoids in hair with anthropometric measurements and their possible determinants: a systematic review and meta-analysis',
      journal: 'Obes Rev',
      pmid: '34811866',
      doi: '10.1111/obr.13376',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34811866/',
      verification: 'abstract',
    },
    {
      id: 'ostinelli2021',
      authors: 'Ostinelli G, Scovronec A, Iceta S, et al.',
      year: 2021,
      title:
        'Deciphering the association between hypothalamus-pituitary-adrenal axis activity and obesity: a meta-analysis',
      journal: 'Obesity',
      pmid: '33783120',
      doi: '10.1002/oby.23125',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33783120/',
      verification: 'abstract',
    },
    {
      id: 'epel2000',
      authors: 'Epel ES, McEwen B, Seeman T, et al.',
      year: 2000,
      title:
        'Stress and body shape: stress-induced cortisol secretion is consistently greater among women with central fat',
      journal: 'Psychosom Med',
      pmid: '11020091',
      doi: '10.1097/00006842-200009000-00005',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11020091/',
      verification: 'abstract',
    },
    {
      id: 'kiecoltglaser1995',
      authors: 'Kiecolt-Glaser JK, Marucha PT, Malarkey WB, Mercado AM, Glaser R',
      year: 1995,
      title: 'Slowing of wound healing by psychological stress',
      journal: 'Lancet',
      pmid: '7475659',
      doi: '10.1016/s0140-6736(95)92899-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7475659/',
      verification: 'abstract',
    },
    {
      id: 'christensen2018',
      authors: 'Christensen P, Meinert Larsen T, Westerterp-Plantenga M, et al.',
      year: 2018,
      title:
        'Men and women respond differently to rapid weight loss: metabolic outcomes of a multi-centre intervention study after a low-energy diet in 2500 overweight individuals with pre-diabetes (PREVIEW)',
      journal: 'Diabetes Obes Metab',
      pmid: '30088336',
      doi: '10.1111/dom.13466',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30088336/',
      verification: 'full-text',
    },
    {
      id: 'millward2014',
      authors: 'Millward DJ, Truby H, Fox KR, Livingstone MB, Macdonald IA, Tothill P',
      year: 2014,
      title: 'Sex differences in the composition of weight gain and loss in overweight and obese adults',
      journal: 'Br J Nutr',
      pmid: '24103395',
      doi: '10.1017/S0007114513003103',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24103395/',
      verification: 'abstract',
    },
    {
      id: 'roberts2020',
      authors: 'Roberts BM, Nuckols G, Krieger JW',
      year: 2020,
      title: 'Sex differences in resistance training: a systematic review and meta-analysis',
      journal: 'J Strength Cond Res',
      pmid: '32218059',
      doi: '10.1519/JSC.0000000000003521',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32218059/',
      verification: 'abstract',
    },
    {
      id: 'hubal2005',
      authors: 'Hubal MJ, Gordish-Dressman H, Thompson PD, et al.',
      year: 2005,
      title: 'Variability in muscle size and strength gain after unilateral resistance training',
      journal: 'Med Sci Sports Exerc',
      pmid: '15947721',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15947721/',
      verification: 'abstract',
    },
    {
      id: 'tarnopolsky2000',
      authors: 'Tarnopolsky MA',
      year: 2000,
      title: 'Gender differences in substrate metabolism during endurance exercise',
      journal: 'Can J Appl Physiol',
      pmid: '10953068',
      doi: '10.1139/h00-024',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10953068/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/15333616/',
      verification: 'abstract',
    },
    {
      id: 'arciero1993',
      authors: 'Arciero PJ, Goran MI, Poehlman ET',
      year: 1993,
      title: 'Resting metabolic rate is lower in women than in men',
      journal: 'J Appl Physiol',
      pmid: '8125870',
      doi: '10.1152/jappl.1993.75.6.2514',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8125870/',
      verification: 'abstract',
    },
    {
      id: 'pontzer2021',
      authors: 'Pontzer H, Yamada Y, Sagayama H, et al.',
      year: 2021,
      title: 'Daily energy expenditure through the human life course',
      journal: 'Science',
      pmid: '34385400',
      doi: '10.1126/science.abe5017',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34385400/',
      verification: 'full-text',
    },
    {
      id: 'kuk2009',
      authors: 'Kuk JL, Ross R',
      year: 2009,
      title: 'Influence of sex on total and regional fat loss in overweight and obese men and women',
      journal: 'Int J Obes',
      pmid: '19274055',
      doi: '10.1038/ijo.2009.48',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19274055/',
      verification: 'abstract',
    },
    {
      id: 'ross1994',
      authors: 'Ross R, Rissanen J',
      year: 1994,
      title:
        'Mobilization of visceral and subcutaneous adipose tissue in response to energy restriction and exercise',
      journal: 'Am J Clin Nutr',
      pmid: '7942575',
      doi: '10.1093/ajcn/60.5.695',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7942575/',
      verification: 'abstract',
    },
    {
      id: 'karastergiou2012',
      authors: 'Karastergiou K, Smith SR, Greenberg AS, Fried SK',
      year: 2012,
      title: 'Sex differences in human adipose tissues – the biology of pear shape',
      journal: 'Biol Sex Differ',
      pmid: '22651247',
      doi: '10.1186/2042-6410-3-13',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22651247/',
      verification: 'abstract',
    },
    {
      id: 'hellstrom2000',
      authors: 'Hellström L, Wahrenberg H, Hruska K, Reynisdottir S, Arner P',
      year: 2000,
      title: 'Mechanisms behind gender differences in circulating leptin levels',
      journal: 'J Intern Med',
      pmid: '10792559',
      doi: '10.1046/j.1365-2796.2000.00678.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10792559/',
      verification: 'abstract',
    },
    {
      id: 'soeters2007',
      authors: 'Soeters MR, Sauerwein HP, Groener JE, et al.',
      year: 2007,
      title: 'Gender-related differences in the metabolic response to fasting',
      journal: 'J Clin Endocrinol Metab',
      pmid: '17566089',
      doi: '10.1210/jc.2007-0552',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17566089/',
      verification: 'abstract',
    },
    {
      id: 'knol2026',
      authors: 'Knol MGE, van der Vaart A, Kieneker L, et al.',
      year: 2026,
      title: 'Sex-specific determinants of the ketone body β-hydroxybutyrate in the general population',
      journal: 'J Clin Endocrinol Metab',
      pmid: '41159535',
      doi: '10.1210/clinem/dgaf587',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41159535/',
      verification: 'abstract',
    },
    {
      id: 'halkes2003',
      authors: 'Halkes CJ, van Dijk H, Verseyden C, et al.',
      year: 2003,
      title:
        'Gender differences in postprandial ketone bodies in normolipidemic subjects and in untreated patients with familial combined hyperlipidemia',
      journal: 'Arterioscler Thromb Vasc Biol',
      pmid: '12933534',
      doi: '10.1161/01.ATV.0000092326.00725.ED',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12933534/',
      verification: 'abstract',
    },
    {
      id: 'loucks2003',
      authors: 'Loucks AB, Thuma JR',
      year: 2003,
      title:
        'Luteinizing hormone pulsatility is disrupted at a threshold of energy availability in regularly menstruating women',
      journal: 'J Clin Endocrinol Metab',
      pmid: '12519869',
      doi: '10.1210/jc.2002-020369',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12519869/',
      verification: 'abstract',
    },
    {
      id: 'jackson2002',
      authors: 'Jackson AS, Stanforth PR, Gagnon J, et al.',
      year: 2002,
      title:
        'The effect of sex, age and race on estimating percentage body fat from body mass index: the Heritage Family Study',
      journal: 'Int J Obes',
      pmid: '12037649',
      doi: '10.1038/sj.ijo.0802006',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12037649/',
      verification: 'abstract',
    },
    {
      id: 'lundsgaard2014',
      authors: 'Lundsgaard AM, Kiens B',
      year: 2014,
      title:
        'Gender differences in skeletal muscle substrate metabolism – molecular mechanisms and insulin sensitivity',
      journal: 'Front Endocrinol',
      pmid: '25431568',
      doi: '10.3389/fendo.2014.00195',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25431568/',
      verification: 'abstract',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/20962155/',
      verification: 'abstract',
    },
    {
      id: 'considine1996',
      authors: 'Considine RV, Sinha MK, Heiman ML, et al.',
      year: 1996,
      title: 'Serum immunoreactive-leptin concentrations in normal-weight and obese humans',
      journal: 'N Engl J Med',
      pmid: '8532024',
      doi: '10.1056/NEJM199602013340503',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8532024/',
      verification: 'abstract',
    },
    {
      id: 'tucker2025',
      authors: 'Tucker JAL, McCarthy SF, Bornath DPD, Khoja JS, Hazell TJ',
      year: 2025,
      title: 'The effect of the menstrual cycle on energy intake: a systematic review and meta-analysis',
      journal: 'Nutr Rev',
      pmid: '39008822',
      doi: '10.1093/nutrit/nuae093',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39008822/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/32658929/',
      verification: 'full-text',
    },
    {
      id: 'davidsen2007',
      authors: 'Davidsen L, Vistisen B, Astrup A',
      year: 2007,
      title:
        'Impact of the menstrual cycle on determinants of energy balance: a putative role in weight loss attempts',
      journal: 'Int J Obes',
      pmid: '17684511',
      doi: '10.1038/sj.ijo.0803699',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17684511/',
      verification: 'abstract',
    },
    {
      id: 'white2011',
      authors: 'White CP, Hitchcock CL, Vigna YM, Prior JC',
      year: 2011,
      title: 'Fluid retention over the menstrual cycle: 1-year data from the Prospective Ovulation Cohort',
      journal: 'Obstet Gynecol Int',
      pmid: '21845193',
      doi: '10.1155/2011/138451',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21845193/',
      verification: 'abstract',
    },
    {
      id: 'aguree2020',
      authors: 'Aguree S, Bethancourt HJ, Taylor LA, Rosinger AY, Gernand AD',
      year: 2020,
      title:
        'Plasma volume variation across the menstrual cycle among healthy women of reproductive age: a prospective cohort study',
      journal: 'Physiol Rep',
      pmid: '32323928',
      doi: '10.14814/phy2.14418',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32323928/',
      verification: 'abstract',
    },
    {
      id: 'kosar2022',
      authors: 'Koşar ŞN, Güzel Y, Köse MG, Kin İşler A, Hazır T',
      year: 2022,
      title:
        'Whole and segmental body composition changes during mid-follicular and mid-luteal phases of the menstrual cycle in recreationally active young women',
      journal: 'Ann Hum Biol',
      pmid: '35696275',
      doi: '10.1080/03014460.2022.2088857',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35696275/',
      verification: 'abstract',
    },
    {
      id: 'wagner2026',
      authors: 'Wagner M, Wagner A, Löfberg I, et al.',
      year: 2026,
      title:
        'Menstrual cycle phase is associated with changes in body weight, bioimpedance, and carbohydrate intake, but not in resting metabolic rate in physically active females',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '42722363',
      doi: '10.1123/ijsnem.2026-0015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42722363/',
      verification: 'abstract',
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
      verification: 'abstract',
    },
    {
      id: 'gleichauf1989',
      authors: 'Gleichauf CN, Roe DA',
      year: 1989,
      title:
        "The menstrual cycle's effect on the reliability of bioimpedance measurements for assessing body composition",
      journal: 'Am J Clin Nutr',
      pmid: '2816797',
      doi: '10.1093/ajcn/50.5.903',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2816797/',
      verification: 'abstract',
    },
    {
      id: 'frandsen2020',
      authors: 'Frandsen J, Pistoljevic N, Quesada JP, et al.',
      year: 2020,
      title:
        'Menstrual cycle phase does not affect whole body peak fat oxidation rate during a graded exercise test',
      journal: 'J Appl Physiol',
      pmid: '32078462',
      doi: '10.1152/japplphysiol.00774.2019',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32078462/',
      verification: 'abstract',
    },
    {
      id: 'dsouza2023',
      authors: "D'Souza AC, Wageh M, Williams JS, et al.",
      year: 2023,
      title:
        'Menstrual cycle hormones and oral contraceptives: a multimethod systems physiology-based review of their impact on key aspects of female physiology',
      journal: 'J Appl Physiol',
      pmid: '37823207',
      doi: '10.1152/japplphysiol.00346.2023',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37823207/',
      verification: 'abstract',
    },
    {
      id: 'mcnulty2020',
      authors: 'McNulty KL, Elliott-Sale KJ, Dolan E, et al.',
      year: 2020,
      title:
        'The effects of menstrual cycle phase on exercise performance in eumenorrheic women: a systematic review and meta-analysis',
      journal: 'Sports Med',
      pmid: '32661839',
      doi: '10.1007/s40279-020-01319-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32661839/',
      verification: 'abstract',
    },
    {
      id: 'elliottsale2020',
      authors: 'Elliott-Sale KJ, McNulty KL, Ansdell P, et al.',
      year: 2020,
      title:
        'The effects of oral contraceptives on exercise performance in women: a systematic review and meta-analysis',
      journal: 'Sports Med',
      pmid: '32666247',
      doi: '10.1007/s40279-020-01317-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32666247/',
      verification: 'abstract',
    },
    {
      id: 'colensosemple2023',
      authors: "Colenso-Semple LM, D'Souza AC, Elliott-Sale KJ, Phillips SM",
      year: 2023,
      title:
        "Current evidence shows no influence of women's menstrual cycle phase on acute strength performance or adaptations to resistance exercise training",
      journal: 'Front Sports Act Living',
      pmid: '37033884',
      doi: '10.3389/fspor.2023.1054542',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37033884/',
      verification: 'abstract',
    },
    {
      id: 'thompson2020',
      authors: 'Thompson B, Almarjawi A, Sculley D, Janse de Jonge X',
      year: 2020,
      title:
        'The effect of the menstrual cycle and oral contraceptives on acute responses and chronic adaptations to resistance training: a systematic review of the literature',
      journal: 'Sports Med',
      pmid: '31677121',
      doi: '10.1007/s40279-019-01219-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31677121/',
      verification: 'abstract',
    },
    {
      id: 'engstad2025',
      authors: 'Engstad MK, Seynnes O, Vesterhus I, et al.',
      year: 2025,
      title: 'Effect of oral contraceptive use on muscle hypertrophy following strength training',
      journal: 'Scand J Med Sci Sports',
      pmid: '40219704',
      doi: '10.1111/sms.70052',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40219704/',
      verification: 'abstract',
    },
    {
      id: 'gallo2014',
      authors: 'Gallo MF, Lopez LM, Grimes DA, et al.',
      year: 2014,
      title: 'Combination contraceptives: effects on weight',
      journal: 'Cochrane Database Syst Rev',
      pmid: '24477630',
      doi: '10.1002/14651858.CD003987.pub5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24477630/',
      verification: 'abstract',
    },
    {
      id: 'hirschberg2012',
      authors: 'Hirschberg AL',
      year: 2012,
      title: 'Sex hormones, appetite and eating behaviour in women',
      journal: 'Maturitas',
      pmid: '22281161',
      doi: '10.1016/j.maturitas.2011.12.016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22281161/',
      verification: 'abstract',
    },
    {
      id: 'lovejoy2008',
      authors: 'Lovejoy JC, Champagne CM, de Jonge L, Xie H, Smith SR',
      year: 2008,
      title: 'Increased visceral fat and decreased energy expenditure during the menopausal transition',
      journal: 'Int J Obes',
      pmid: '18332882',
      doi: '10.1038/ijo.2008.25',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18332882/',
      verification: 'abstract',
    },
    {
      id: 'greendale2019',
      authors: 'Greendale GA, Sternfeld B, Huang M, et al.',
      year: 2019,
      title: 'Changes in body composition and weight during the menopause transition',
      journal: 'JCI Insight',
      pmid: '30843880',
      doi: '10.1172/jci.insight.124865',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30843880/',
      verification: 'full-text',
    },
    {
      id: 'ambikairajah2019',
      authors: 'Ambikairajah A, Walsh E, Tabatabaei-Jafari H, Cherbuin N',
      year: 2019,
      title: 'Fat mass changes during menopause: a metaanalysis',
      journal: 'Am J Obstet Gynecol',
      pmid: '31034807',
      doi: '10.1016/j.ajog.2019.04.023',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31034807/',
      verification: 'abstract',
    },
    {
      id: 'davis2012',
      authors: 'Davis SR, Castelo-Branco C, Chedraui P, et al.',
      year: 2012,
      title: 'Understanding weight gain at menopause',
      journal: 'Climacteric',
      pmid: '22978257',
      doi: '10.3109/13697137.2012.707385',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22978257/',
      verification: 'abstract',
    },
    {
      id: 'salpeter2006',
      authors: 'Salpeter SR, Walsh JM, Ormiston TM, et al.',
      year: 2006,
      title:
        'Meta-analysis: effect of hormone-replacement therapy on components of the metabolic syndrome in postmenopausal women',
      journal: 'Diabetes Obes Metab',
      pmid: '16918589',
      doi: '10.1111/j.1463-1326.2005.00545.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16918589/',
      verification: 'abstract',
    },
    {
      id: 'greendale2012',
      authors: 'Greendale GA, Sowers M, Han W, et al.',
      year: 2012,
      title:
        'Bone mineral density loss in relation to the final menstrual period in a multiethnic cohort: results from SWAN',
      journal: 'J Bone Miner Res',
      pmid: '21976317',
      doi: '10.1002/jbmr.534',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21976317/',
      verification: 'abstract',
    },
    {
      id: 'karlamangla2018',
      authors: 'Karlamangla AS, Burnett-Bowie SM, Crandall CJ',
      year: 2018,
      title: 'Bone health during the menopause transition and beyond',
      journal: 'Obstet Gynecol Clin North Am',
      pmid: '30401551',
      doi: '10.1016/j.ogc.2018.07.012',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30401551/',
      verification: 'abstract',
    },
    {
      id: 'mitchell2012',
      authors: 'Mitchell WK, Williams J, Atherton P, et al.',
      year: 2012,
      title:
        'Sarcopenia, dynapenia, and the impact of advancing age on human skeletal muscle size and strength; a quantitative review',
      journal: 'Front Physiol',
      pmid: '22934016',
      doi: '10.3389/fphys.2012.00260',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22934016/',
      verification: 'abstract',
    },
    {
      id: 'moore2015',
      authors: 'Moore DR, Churchward-Venne TA, Witard O, et al.',
      year: 2015,
      title:
        'Protein ingestion to stimulate myofibrillar protein synthesis requires greater relative protein intakes in healthy older versus younger men',
      journal: 'J Gerontol A Biol Sci Med Sci',
      pmid: '25056502',
      doi: '10.1093/gerona/glu103',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25056502/',
      verification: 'abstract',
    },
    {
      id: 'kumar2009',
      authors: 'Kumar V, Selby A, Rankin D, et al.',
      year: 2009,
      title:
        'Age-related differences in the dose-response relationship of muscle protein synthesis to resistance exercise in young and old men',
      journal: 'J Physiol',
      pmid: '19001042',
      doi: '10.1113/jphysiol.2008.164483',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19001042/',
      verification: 'abstract',
    },
    {
      id: 'martel2006',
      authors: 'Martel GF, Roth SM, Ivey FM, et al.',
      year: 2006,
      title: 'Age and sex affect human muscle fibre adaptations to heavy-resistance strength training',
      journal: 'Exp Physiol',
      pmid: '16407471',
      doi: '10.1113/expphysiol.2005.032771',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16407471/',
      verification: 'abstract',
    },
    {
      id: 'bauer2013',
      authors: 'Bauer J, Biolo G, Cederholm T, et al.',
      year: 2013,
      title:
        'Evidence-based recommendations for optimal dietary protein intake in older people: a position paper from the PROT-AGE Study Group',
      journal: 'J Am Med Dir Assoc',
      pmid: '23867520',
      doi: '10.1016/j.jamda.2013.05.021',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23867520/',
      verification: 'abstract',
    },
    {
      id: 'kosek2006',
      authors: 'Kosek DJ, Kim JS, Petrella JK, Cross JM, Bamman MM',
      year: 2006,
      title:
        'Efficacy of 3 days/wk resistance training on myofiber hypertrophy and myogenic mechanisms in young vs. older adults',
      journal: 'J Appl Physiol',
      pmid: '16614355',
      doi: '10.1152/japplphysiol.01474.2005',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16614355/',
      verification: 'abstract',
    },
    {
      id: 'peterson2011',
      authors: 'Peterson MD, Sen A, Gordon PM',
      year: 2011,
      title: 'Influence of resistance exercise on lean body mass in aging adults: a meta-analysis',
      journal: 'Med Sci Sports Exerc',
      pmid: '20543750',
      doi: '10.1249/MSS.0b013e3181eb6265',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20543750/',
      verification: 'abstract',
    },
    {
      id: 'csapo2016',
      authors: 'Csapo R, Alegre LM',
      year: 2016,
      title:
        'Effects of resistance training with moderate vs heavy loads on muscle mass and strength in the elderly: a meta-analysis',
      journal: 'Scand J Med Sci Sports',
      pmid: '26302881',
      doi: '10.1111/sms.12536',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26302881/',
      verification: 'abstract',
    },
    {
      id: 'desantana2024',
      authors: 'de Santana DA, Scolfaro PG, Marzetti E, Cavaglieri CR',
      year: 2024,
      title:
        'Lower extremity muscle hypertrophy in response to resistance training in older adults: systematic review, meta-analysis, and meta-regression of randomized controlled trials',
      journal: 'Exp Gerontol',
      pmid: '39579806',
      doi: '10.1016/j.exger.2024.112639',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39579806/',
      verification: 'abstract',
    },
    {
      id: 'fleg2005',
      authors: 'Fleg JL, Morrell CH, Bos AG, et al.',
      year: 2005,
      title: 'Accelerated longitudinal decline of aerobic capacity in healthy older adults',
      journal: 'Circulation',
      pmid: '16043637',
      doi: '10.1161/CIRCULATIONAHA.105.545459',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16043637/',
      verification: 'abstract',
    },
    {
      id: 'hawkins2003',
      authors: 'Hawkins S, Wiswell R',
      year: 2003,
      title:
        'Rate and mechanism of maximal oxygen consumption decline with aging: implications for exercise training',
      journal: 'Sports Med',
      pmid: '12974656',
      doi: '10.2165/00007256-200333120-00002',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12974656/',
      verification: 'abstract',
    },
    {
      id: 'shimokata1991',
      authors: 'Shimokata H, Muller DC, Fleg JL, et al.',
      year: 1991,
      title: 'Age as independent determinant of glucose tolerance',
      journal: 'Diabetes',
      pmid: '2015973',
      doi: '10.2337/diab.40.1.44',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2015973/',
      verification: 'abstract',
    },
    {
      id: 'villareal2011',
      authors: 'Villareal DT, Chode S, Parimi N, et al.',
      year: 2011,
      title: 'Weight loss, exercise, or both and physical function in obese older adults',
      journal: 'N Engl J Med',
      pmid: '21449785',
      doi: '10.1056/NEJMoa1008234',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21449785/',
      verification: 'full-text',
    },
    {
      id: 'chaston2007',
      authors: "Chaston TB, Dixon JB, O'Brien PE",
      year: 2007,
      title: 'Changes in fat-free mass during significant weight loss: a systematic review',
      journal: 'Int J Obes',
      pmid: '17075583',
      doi: '10.1038/sj.ijo.0803483',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17075583/',
      verification: 'abstract',
    },
    {
      id: 'baxterjones2011',
      authors: 'Baxter-Jones ADG, Faulkner RA, Forwood MR, Mirwald RL, Bailey DA',
      year: 2011,
      title: 'Bone mineral accrual from 8 to 30 years of age: an estimation of peak bone mass',
      journal: 'J Bone Miner Res',
      pmid: '21520276',
      doi: '10.1002/jbmr.412',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21520276/',
      verification: 'abstract',
    },
    {
      id: 'golden2016',
      authors:
        'Golden NH, Schneider M, Wood C; AAP Committee on Nutrition, Committee on Adolescence, Section on Obesity',
      year: 2016,
      title: 'Preventing obesity and eating disorders in adolescents',
      journal: 'Pediatrics',
      pmid: '27550979',
      doi: '10.1542/peds.2016-1649',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27550979/',
      verification: 'abstract',
    },
    {
      id: 'hall2007',
      authors: 'Hall KD',
      year: 2007,
      title: "Body fat and fat-free mass inter-relationships: Forbes's theory revisited",
      journal: 'Br J Nutr',
      pmid: '17367567',
      doi: '10.1017/S0007114507691946',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17367567/',
      verification: 'abstract',
    },
    {
      id: 'elia1999',
      authors: 'Elia M, Stubbs RJ, Henry CJ',
      year: 1999,
      title:
        'Differences in fat, carbohydrate, and protein metabolism between lean and obese subjects undergoing total starvation',
      journal: 'Obes Res',
      pmid: '10574520',
      doi: '10.1002/j.1550-8528.1999.tb00720.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10574520/',
      verification: 'abstract',
    },
    {
      id: 'murton2015',
      authors: 'Murton AJ, Marimuthu K, Mallinson JE, et al.',
      year: 2015,
      title:
        'Obesity appears to be associated with altered muscle protein synthetic and breakdown responses to increased nutrient delivery in older men, but not reduced muscle mass or contractile function',
      journal: 'Diabetes',
      pmid: '26015550',
      doi: '10.2337/db15-0021',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26015550/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/2336074/',
      verification: 'abstract',
    },
    {
      id: 'bouchard1999',
      authors: 'Bouchard C, An P, Rice T, et al.',
      year: 1999,
      title:
        'Familial aggregation of VO2max response to exercise training: results from the HERITAGE Family Study',
      journal: 'J Appl Physiol',
      pmid: '10484570',
      doi: '10.1152/jappl.1999.87.3.1003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10484570/',
      verification: 'abstract',
    },
    {
      id: 'gardner2018',
      authors: 'Gardner CD, Trepanowski JF, Del Gobbo LC, et al.',
      year: 2018,
      title:
        'Effect of low-fat vs low-carbohydrate diet on 12-month weight loss in overweight adults and the association with genotype pattern or insulin secretion: the DIETFITS randomized clinical trial',
      journal: 'JAMA',
      pmid: '29466592',
      doi: '10.1001/jama.2018.0245',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29466592/',
      verification: 'full-text',
    },
    {
      id: 'deurenberg2002',
      authors: 'Deurenberg P, Deurenberg-Yap M, Guricci S',
      year: 2002,
      title:
        'Asians are different from Caucasians and from each other in their body mass index/body fat per cent relationship',
      journal: 'Obes Rev',
      pmid: '12164465',
      doi: '10.1046/j.1467-789x.2002.00065.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12164465/',
      verification: 'abstract',
    },
    {
      id: 'lear2007',
      authors: 'Lear SA, Humphries KH, Kohli S, et al.',
      year: 2007,
      title:
        'Visceral adipose tissue accumulation differs according to ethnic background: results of the Multicultural Community Health Assessment Trial (M-CHAT)',
      journal: 'Am J Clin Nutr',
      pmid: '17684205',
      doi: '10.1093/ajcn/86.2.353',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17684205/',
      verification: 'abstract',
    },
    {
      id: 'hecksteden2015',
      authors: 'Hecksteden A, Kraushaar J, Scharhag-Rosenberger F, Theisen D, Senn S, Meyer T',
      year: 2015,
      title: 'Individual response to exercise training – a statistical perspective',
      journal: 'J Appl Physiol',
      pmid: '25663672',
      doi: '10.1152/japplphysiol.00714.2014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25663672/',
      verification: 'abstract',
    },
    {
      id: 'gallagher2000',
      authors: 'Gallagher D, Heymsfield SB, Heo M, et al.',
      year: 2000,
      title:
        'Healthy percentage body fat ranges: an approach for developing guidelines based on body mass index',
      journal: 'Am J Clin Nutr',
      pmid: '10966886',
      doi: '10.1093/ajcn/72.3.694',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10966886/',
      verification: 'abstract',
    },
    {
      id: 'wilding2021',
      authors: 'Wilding JPH, Batterham RL, Calanna S, et al.',
      year: 2021,
      title: 'Once-weekly semaglutide in adults with overweight or obesity (STEP 1)',
      journal: 'N Engl J Med',
      pmid: '33567185',
      doi: '10.1056/NEJMoa2032183',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33567185/',
      verification: 'abstract',
    },
    {
      id: 'jastreboff2022',
      authors: 'Jastreboff AM, Aronne LJ, Ahmad NN, et al.',
      year: 2022,
      title: 'Tirzepatide once weekly for the treatment of obesity (SURMOUNT-1)',
      journal: 'N Engl J Med',
      pmid: '35658024',
      doi: '10.1056/NEJMoa2206038',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35658024/',
      verification: 'abstract',
    },
    {
      id: 'look2025',
      authors: 'Look M, Dunn JP, Kushner RF, et al.',
      year: 2025,
      title:
        'Body composition changes during weight reduction with tirzepatide in the SURMOUNT-1 study of adults with obesity or overweight',
      journal: 'Diabetes Obes Metab',
      pmid: '39996356',
      doi: '10.1111/dom.16275',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39996356/',
      verification: 'abstract',
    },
    {
      id: 'neeland2024',
      authors: 'Neeland IJ, Linge J, Birkenfeld AL',
      year: 2024,
      title:
        'Changes in lean body mass with glucagon-like peptide-1-based therapies and mitigation strategies',
      journal: 'Diabetes Obes Metab',
      pmid: '38937282',
      doi: '10.1111/dom.15728',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38937282/',
      verification: 'abstract',
    },
    {
      id: 'karakasis2025',
      authors: 'Karakasis P, Patoulias D, Fragakis N, Mantzoros CS',
      year: 2025,
      title:
        'Effect of glucagon-like peptide-1 receptor agonists and co-agonists on body composition: systematic review and network meta-analysis',
      journal: 'Metabolism',
      pmid: '39719170',
      doi: '10.1016/j.metabol.2024.156113',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39719170/',
      verification: 'abstract',
    },
    {
      id: 'batsis2026',
      authors: 'Batsis JA, Gavras A, Gross DC, et al.',
      year: 2026,
      title:
        'Effect of incretin-based and nonpharmacologic weight loss on body composition: a systematic review',
      journal: 'Ann Intern Med',
      pmid: '41996180',
      doi: '10.7326/ANNALS-25-00478',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41996180/',
      verification: 'abstract',
    },
    {
      id: 'blundell2017',
      authors: 'Blundell J, Finlayson G, Axelsen M, et al.',
      year: 2017,
      title:
        'Effects of once-weekly semaglutide on appetite, energy intake, control of eating, food preference and body weight in subjects with obesity',
      journal: 'Diabetes Obes Metab',
      pmid: '28266779',
      doi: '10.1111/dom.12932',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28266779/',
      verification: 'abstract',
    },
    {
      id: 'aladsani1997',
      authors: 'al-Adsani H, Hoffer LJ, Silva JE',
      year: 1997,
      title:
        'Resting energy expenditure is sensitive to small dose changes in patients on chronic thyroid hormone replacement',
      journal: 'J Clin Endocrinol Metab',
      pmid: '9100583',
      doi: '10.1210/jcem.82.4.3873',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9100583/',
      verification: 'abstract',
    },
    {
      id: 'lim2019',
      authors: 'Lim SS, Hutchison SK, Van Ryswyk E, Norman RJ, Teede HJ, Moran LJ',
      year: 2019,
      title: 'Lifestyle changes in women with polycystic ovary syndrome',
      journal: 'Cochrane Database Syst Rev',
      pmid: '30921477',
      doi: '10.1002/14651858.CD007506.pub4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30921477/',
      verification: 'abstract',
    },
    {
      id: 'ferrannini2016',
      authors: 'Ferrannini E, Baldi S, Frascerra S, et al.',
      year: 2016,
      title:
        'Shift to fatty substrate utilization in response to sodium-glucose cotransporter 2 inhibition in subjects without diabetes and patients with type 2 diabetes',
      journal: 'Diabetes',
      pmid: '26861783',
      doi: '10.2337/db15-1356',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26861783/',
      verification: 'abstract',
    },
    {
      id: 'bhasin1996',
      authors: 'Bhasin S, Storer TW, Berman N, et al.',
      year: 1996,
      title:
        'The effects of supraphysiologic doses of testosterone on muscle size and strength in normal men',
      journal: 'N Engl J Med',
      pmid: '8637535',
      doi: '10.1056/NEJM199607043350101',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8637535/',
      verification: 'abstract',
    },
    {
      id: 'butte2005',
      authors: 'Butte NF, King JC',
      year: 2005,
      title: 'Energy requirements during pregnancy and lactation',
      journal: 'Public Health Nutr',
      pmid: '16277817',
      doi: '10.1079/phn2005793',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16277817/',
      verification: 'abstract',
    },
    {
      id: 'kirwan2026',
      authors: 'Kirwan R, Peele L, Nuckols G, et al.',
      year: 2026,
      title:
        'Resting energy expenditure of women with and without polycystic ovary syndrome: a systematic review and meta-analysis',
      journal: 'medRxiv preprint (not peer-reviewed)',
      pmid: '41409676',
      doi: '10.64898/2025.12.03.25341536',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41409676/',
      verification: 'abstract',
    },
    {
      id: 'ross2019',
      authors: 'Ross R, Goodpaster BH, Koch LG, et al.',
      year: 2019,
      title: 'Precision exercise medicine: understanding exercise response variability',
      journal: 'Br J Sports Med',
      pmid: '30862704',
      doi: '10.1136/bjsports-2018-100328',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30862704/',
      verification: 'abstract',
    },
  ],
};

export default topic;
