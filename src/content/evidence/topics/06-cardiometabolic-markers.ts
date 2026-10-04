import type { EvidenceTopic } from '../schema';

/** Evidence topic for research/06-lipids-cardiometabolic-biomarkers.md (pure data). */
const topic: EvidenceTopic = {
  dossier: '06',
  slug: 'cardiometabolic-markers',
  title: 'Blood fats and other cardiometabolic markers',
  scope:
    'How what you eat, how much you weigh, whether you are in ketosis and how you exercise move common blood markers: LDL and HDL cholesterol, ApoB, triglycerides, blood pressure, glucose, insulin, HbA1c, hs-CRP, liver fat, a liver enzyme, uric acid and visceral fat. Each marker follows a target and a time lag, and results are shown as change from your own starting value. The topic models nutrients rather than named diets, and it does not model diseases or events.',
  mechanisms: [
    {
      id: '06-marker-dynamics',
      title: 'How every blood marker moves towards its target',
      category: 'cardio',
      summary:
        "Each marker has a steady-state target set by today's diet, weight, ketosis and exercise. The measured value then drifts towards that target rather than jumping to it. Where several drivers act at different speeds, the engine keeps one state per driver, so reversing one driver reverses only its own share. Results are shown as change from your own starting value, because the engine does not know your lab results.",
      howModelled:
        'Targets are built by adding terms for LDL, HDL, blood pressure, fasting glucose and uric acid, and by multiplying terms for triglycerides, insulin, hs-CRP, liver fat and the liver enzyme ALT. Each day the marker closes part of the gap to its target. Person-to-person differences come from one persistent random draw per marker, plus a response multiplier for responses with a long tail. The draws are correlated so that a simulated person is internally consistent.',
      equation: `X*(t) = steady-state target given today's drivers
dX/dt = (X*(t) − X(t)) / τ_X
X(t+1) = X(t) + (X*(t) − X(t)) · (1 − exp(−1/τ_X))
X0_i = X0(sex, age, BMI) + s · z_i      (ln scale for TG, insulin, hs-CRP, ALT)`,
      keyNumbers: [
        {
          label: 'Correlations between markers after adjusting for age and BMI',
          value:
            'TG–HDL −0.43; TG–LDL +0.38; insulin–HDL −0.32; insulin–TG +0.29; fasting glucose–HbA1c +0.75',
          note: 'Computed by Vitals from NHANES 2017–2020 (1888 fasting adults without diabetes or lipid or blood-pressure medication). The glucose–HbA1c link is partly due to undiagnosed diabetes.',
          referenceIds: ['cdc2020'],
        },
        {
          label: 'Response to a carbohydrate-restricted diet in lean people',
          value:
            'Drawn independently of baseline LDL; positively linked to baseline HDL, negatively to baseline TG and BMI',
          note: 'In the survey, people with very large LDL rises and the rest had the same LDL before the diet (148 versus 145 mg/dL). Prior HDL beta +0.6 and prior TG beta −0.17 mg/dL per mg/dL.',
          referenceIds: ['norwitz2022a'],
        },
        {
          label: 'LDL particle turnover',
          value: 'LDL apoB fractional catabolic rate 0.50 ± 0.10 pools/day in controls, about 2 days',
          note: 'So the multi-week time to a new steady state reflects the liver adjusting its cholesterol handling, not particle turnover.',
          referenceIds: ['millar2005'],
        },
        {
          label: 'Time constants used (proposed)',
          value:
            'LDL 7 days (composition), 10 days (lean-responder term, food components); HDL 10 days (diet), 30 days (exercise, weight); TG 4 days (composition, ketosis), 14 days (omega-3), 30–45 days (weight), 21 days (exercise); HbA1c 50 days; hs-CRP 30–60 days; liver fat 12 days down and 21 days up; ALT 21 days; uric acid 5–7 days (ketones), 30 days (weight)',
          note: 'Inferred from trial durations, single time-course studies and mechanism, not from dense time series for every marker.',
        },
      ],
      timeCourse:
        'Each marker approaches its target with a first-order lag. Reversal uses the same time constants, except for liver fat, which is noted to rise more slowly than it falls.',
      moderators:
        'Sex, age, BMI, baseline level, and a persistent individual draw. A response multiplier makes the heavy-tailed responses, such as LDL on carbohydrate restriction and blood pressure on sodium, more realistic.',
      grade: 'C',
      gradeReason:
        'A modelling convention whose time constants are inferred from trial durations and a handful of time-course studies (no separate grade was given).',
      status: 'proposed-fit',
      caveats:
        'Hysteresis is not documented for these markers except where stated (the hs-CRP threshold and the liver-fat asymmetry). Terms are assumed to add; how far they really add is known only qualitatively.',
      referenceIds: ['cdc2020', 'norwitz2022a', 'millar2005'],
      relatedMetricIds: ['ldl', 'triglycerides', 'sbp', 'crp'],
    },
    {
      id: '06-fatty-acid-exchange-lipids',
      title: 'Swapping carbohydrate for saturated, mono- or polyunsaturated fat',
      category: 'cardio',
      summary:
        'In tightly controlled feeding trials, replacing carbohydrate with saturated fat raises LDL cholesterol (the cholesterol carried on LDL particles), raises HDL and lowers triglycerides. Replacing it with polyunsaturated fat lowers LDL, raises HDL and lowers triglycerides more. Monounsaturated fat sits in between and lowers LDL slightly. A mix of saturated fats raises LDL about twice as much as polyunsaturated fat lowers it.',
      howModelled:
        'Each 1 % of energy moved from carbohydrate into a fat class shifts the target for LDL, HDL, triglycerides and total cholesterol by a fixed amount. The coefficients act on changes from a habitual diet, so the engine first sets that baseline. LDL coefficients are scaled up when starting LDL is high and down when it is low.',
      equation: `LDL coefficient multiplier = clip(1 + 0.35·(LDL0 − 112)/40, 0.7, 1.4)
Change per 1 % of energy replacing carbohydrate, isocaloric (mmol/L): LDL +0.036 SFA, −0.009 MUFA, −0.022 PUFA`,
      keyNumbers: [
        {
          label: 'LDL cholesterol per 1 % of energy replacing carbohydrate (mmol/L, 95 % CI)',
          value:
            'Saturated +0.036 (0.030, 0.043) [+1.39 mg/dL]; monounsaturated −0.009 (−0.014, −0.003) [−0.35]; polyunsaturated −0.022 (−0.028, −0.015) [−0.85]',
          note: 'From 74 controlled feeding trials, 177 diets, 2172 volunteers (65 % men, mean age 39, mean BMI 24.3; feeding periods 13–91 days; trans fat under 2 % of energy). Mean intakes were fat 34 %, saturated 9.8 %, monounsaturated 13.6 %, polyunsaturated 8.4 % of energy.',
          referenceIds: ['mensink2016'],
        },
        {
          label: 'HDL cholesterol, same swaps (mmol/L)',
          value:
            'Saturated +0.011 (0.010, 0.013) [+0.43 mg/dL]; monounsaturated +0.008 (0.007, 0.010) [+0.31]; polyunsaturated +0.006 (0.004, 0.008) [+0.23]',
          referenceIds: ['mensink2016'],
        },
        {
          label: 'Triglycerides, same swaps (mmol/L)',
          value:
            'Saturated −0.012 (−0.015, −0.008) [−1.06 mg/dL]; monounsaturated −0.015 (−0.018, −0.011) [−1.33]; polyunsaturated −0.021 (−0.025, −0.017) [−1.86]',
          referenceIds: ['mensink2016'],
        },
        {
          label: 'Total cholesterol, same swaps (mmol/L)',
          value:
            'Saturated +0.045 (0.038, 0.051) [+1.74 mg/dL]; monounsaturated −0.004 (−0.010, 0.001) [−0.15]; polyunsaturated −0.022 (−0.028, −0.016) [−0.85]',
          referenceIds: ['mensink2016'],
        },
        {
          label: 'Total-to-HDL cholesterol ratio, same swaps',
          value:
            'Saturated −0.002 (−0.009, 0.005); monounsaturated −0.029 (−0.035, −0.023); polyunsaturated −0.036 (−0.043, −0.029)',
          referenceIds: ['mensink2016'],
        },
        {
          label: 'LDL when saturated fat is the starting point (per 1 % of energy replaced, mmol/L)',
          value:
            'To carbohydrate −0.033 (−0.039, −0.027); to monounsaturated −0.042 (−0.047, −0.037); to polyunsaturated −0.055 (−0.061, −0.050)',
          note: 'Worked example: replacing 5 % of energy from saturated fat with polyunsaturated fat lowers LDL by 5 × 0.055 = 0.275 mmol/L (10.6 mg/dL, about 9 % of 115 mg/dL).',
          referenceIds: ['mensink2016'],
        },
        {
          label:
            'Specific fatty acids per 1 % of energy replacing carbohydrate (91 diets, 37 studies; mmol/L)',
          value:
            'Oleic: TC −0.013, LDL −0.014, HDL +0.009, TG −0.015. Linoleic: TC −0.028, LDL −0.023, HDL +0.005, TG −0.021. Alpha-linolenic: TC −0.049, LDL −0.039 (−0.063, −0.014), HDL 0.000 (−0.006, 0.006), TG −0.023. Saturated subset: TC +0.039, LDL +0.036, HDL +0.010, TG −0.012',
          note: 'The third fat column is printed "SFA → PUFA" in the source but is linoleic acid. Alpha-linolenic acid is only about 10 % of polyunsaturated fat in these diets and its interval overlaps that of linoleic acid.',
          referenceIds: ['mensink2016'],
        },
        {
          label: 'Larger effects when baseline lipids are higher',
          value:
            'Carb → saturated, LDL +0.029 (below-median baseline) versus +0.041 mmol/L per % of energy (above median); carb → polyunsaturated, LDL −0.018 versus −0.024; TC +0.035 versus +0.050',
          note: 'Median baseline of the standardised fat-free diet: TC 4.45, LDL 2.89, HDL 0.97, TG 1.48 mmol/L. The scaling formula is a proposed fit to the two subgroups (0.029 versus 0.041 around a mean of 0.036 at LDL about 3.4 mmol/L).',
          referenceIds: ['mensink2016'],
        },
        {
          label: 'Earlier equations agree within about 30 %',
          value:
            '1992 equation (27 trials): ΔLDL (mmol/L) = 0.033 carb→saturated − 0.006 carb→mono − 0.014 carb→poly; ΔHDL = 0.012, 0.009, 0.007; ΔTG = −0.025, −0.022, −0.028',
          note: 'The 1992, 2003 and 2016 data sets agree within about 30 %.',
          referenceIds: ['mensink1992'],
        },
        {
          label: 'Time to a new steady state',
          value:
            'τ_LDL = 7 days (95 % complete by 3 weeks, 99 % by 5 weeks); τ_HDL = 10 days; τ_TG = 4 days; reversal symmetric',
          note: 'Proposed. The response was complete within the shortest trials (2–4 weeks) with no dependence on duration. The median metabolic-ward experiment lasted 1 month.',
          referenceIds: ['mensink2016', 'clarke1997'],
        },
        {
          label: 'Historical equations (Keys and Hegsted), not used as the main model',
          value:
            "Keys 1965 as reproduced in a secondary review: ΔTC (mg/dL) = 1.2·(2·ΔSFA − ΔPUFA) + 1.5·ΔZ. Keys' swap of saturated for polyunsaturated fat would be −3.6 mg/dL = −0.093 mmol/L per % of energy, about 45 % larger than the 2016 data",
          note: "Keys and Hegsted overestimate the saturated and polyunsaturated effects by about 30–50 % and cannot predict HDL or triglycerides. The commonly quoted Hegsted form (2.16, −1.65, 0.097) is unverified. Hegsted's 1986 statement (roughly linear over 0–400 mg cholesterol per 1000 kcal) was verified. Keys' equation was read from a secondary review.",
          referenceIds: ['keys1965', 'hegsted1965', 'hegsted1986', 'hegsted1993'],
        },
      ],
      timeCourse:
        'The response is complete within 2–4 weeks; the engine uses a 7-day time constant for LDL, 10 days for HDL and 4 days for triglycerides.',
      moderators:
        'Baseline lipid level (larger effects when it is higher). The trials were 65 % men with a mean age of 39, so extrapolation to post-menopausal women is uncertain. Whether the LDL-raising effect of saturated fat differs by sex is unverified, and ApoE genotype may modify the response (E4 higher; unverified).',
      grade: 'A',
      gradeReason:
        'A meta-regression of 74 controlled feeding trials, and three generations of the analysis agree.',
      status: 'established',
      caveats:
        'The baseline scaling and the time constants are proposed fits. The trials fed mostly younger men, so effects in older adults and post-menopausal women are extrapolated.',
      referenceIds: [
        'mensink2016',
        'mensink1992',
        'clarke1997',
        'keys1965',
        'hegsted1965',
        'hegsted1986',
        'hegsted1993',
      ],
      relatedMetricIds: ['ldl', 'hdl', 'triglycerides', 'apoB'],
    },
    {
      id: '06-individual-saturated-fats-and-trans',
      title: 'Individual saturated fats and trans fat',
      category: 'cardio',
      summary:
        'Saturated fats do not all act alike. Lauric, myristic and palmitic acids raise LDL and HDL. Stearic acid has little effect on LDL. Industrial trans fat raises LDL and ApoB and has no net effect on HDL in the main data set. The food that carries the fat also matters: cheese raised LDL less than butter with the same saturated fat, and coconut oil raised LDL.',
      howModelled:
        'The engine uses per-acid coefficients only when the user specifies per-acid intake, for example dairy versus palm versus coconut. Otherwise it uses the total saturated-fat coefficient. An optional multiplier of 0.75 lowers the saturated-fat effect for cheese and fermented dairy. Medium-chain fats (8:0 and 10:0) are given zero effect.',
      keyNumbers: [
        {
          label: 'Lauric acid (12:0), per 1 % of energy replacing carbohydrate (mmol/L)',
          value: 'LDL +0.052 (0.026, 0.078); HDL +0.027 (0.021, 0.033); TG −0.019 (−0.028, −0.011)',
          note: 'From 60 controlled trials, 159 diets and 1672 volunteers. Minus signs were lost in the PDF text and were restored from the symmetric confidence intervals.',
          referenceIds: ['mensink2003'],
        },
        {
          label: 'Myristic acid (14:0)',
          value: 'LDL +0.048 (0.027, 0.069); HDL +0.018 (0.013, 0.023); TG −0.017 (−0.027, −0.006)',
          referenceIds: ['mensink2003'],
        },
        {
          label: 'Palmitic acid (16:0)',
          value: 'LDL +0.039 (0.027, 0.051); HDL +0.010 (0.007, 0.013); TG −0.017 (−0.023, −0.011)',
          referenceIds: ['mensink2003'],
        },
        {
          label: 'Stearic acid (18:0)',
          value: 'LDL −0.004 (−0.019, 0.011); HDL +0.002 (−0.001, 0.006); TG −0.017 (−0.024, −0.010)',
          referenceIds: ['mensink2003'],
        },
        {
          label: 'Industrial trans fat (trans monounsaturated)',
          value: 'LDL +0.040 (0.020, 0.060); HDL 0.000 (−0.007, 0.006); TG 0.000 (−0.012, 0.012)',
          note: 'An HDL-lowering effect reported in earlier single trials is unverified here.',
          referenceIds: ['mensink2003'],
        },
        {
          label: 'ApoB per 1 % of energy replacing carbohydrate (mg/L)',
          value:
            '12:0 +5.6 (−2.6, 13.8) not significant; 14:0 +1.9 not significant; 16:0 +4.2 (−0.5, 8.9); 18:0 −3.8 not significant; trans +5.4 (2.3, 8.5); all saturated (2003 set) +2.6 not significant; cis-monounsaturated −4.8 (−8.1, −1.5); cis-polyunsaturated −7.7 (−11.3, −4.2)',
          referenceIds: ['mensink2003'],
        },
        {
          label: 'Saturated-fat mix at typical intakes',
          value:
            'Weighted LDL coefficient 0.029 mmol/L per % of energy, against 0.036 for total saturated fat',
          note: 'Using NHANES-like intakes of 0.38 % of energy from 12:0, 0.97 from 14:0, 6.4 from 16:0 and 2.8 from 18:0.',
        },
        {
          label:
            'Cheese versus butter at equal saturated fat (12.4–12.6 % of energy, 4 weeks, 92 abdominally obese adults)',
          value:
            'LDL 3.3 % lower after cheese than butter; against a carbohydrate diet, LDL +2.6 % (cheese) and +6.1–16.2 % (butter versus carbohydrate, monounsaturated and polyunsaturated diets)',
          note: 'The butter–cheese gap appeared only at high baseline LDL.',
          referenceIds: ['brassard2017'],
        },
        {
          label: 'Coconut oil (rich in lauric acid) against non-tropical vegetable oils (16 trials)',
          value: 'LDL +10.5 mg/dL (95 % CI 3.0, 17.9); HDL +4.0 mg/dL',
          referenceIds: ['neelakantan2020'],
        },
      ],
      timeCourse: 'The same as the overall fat-swap response: a time constant of 7 days for LDL.',
      moderators: 'Chain length of the fatty acid, the food it comes in (the matrix), and baseline LDL.',
      grade: 'B',
      gradeReason:
        "A meta-analysis of 60 trials supports the pattern, but single fatty acids are estimated less precisely and the food-matrix modifiers are graded B/C (Vitals' evidence review gives A/B).",
      status: 'established',
      caveats:
        'The 2003 tables lost their minus signs in the source text, and the HDL P-value row is misaligned; Vitals restored the signs from the confidence intervals. The 0.75 multiplier for cheese is optional and low confidence, and the zero effect for medium-chain fats is unverified.',
      referenceIds: ['mensink2003', 'brassard2017', 'neelakantan2020'],
      relatedMetricIds: ['ldl', 'hdl'],
    },
    {
      id: '06-dietary-cholesterol',
      title: 'Cholesterol in food',
      category: 'cardio',
      summary:
        'Cholesterol eaten in food raises blood cholesterol by a small amount, and the effect levels off at higher intakes. People vary a great deal. Some respond little and some respond strongly, and part of that difference is a stable trait. Lipid trials cannot say anything about heart-disease outcomes.',
      howModelled:
        'A square-root law from Keys is scaled to match three meta-analyses. Total cholesterol changes by 1.5 times the change in the square root of cholesterol per 1000 kcal. LDL takes 77 % of that change and HDL 14 %. The effect is capped above 900 mg/day. Each person also gets a response multiplier with mean 1.',
      equation: `dTC (mg/dL) = 1.5 · ( √(chol_new·1000/kcal_new) − √(chol_base·1000/kcal_base) )
dLDL = 0.77 · dTC
dHDL = 0.14 · dTC
Cap the effect above 900 mg/day.`,
      keyNumbers: [
        {
          label: 'Metabolic-ward experiments (395 experiments, median 1 month)',
          value:
            'Avoiding 200 mg/day of dietary cholesterol lowers TC by 0.13 (SE 0.02) and LDL by 0.10 (0.02) mmol/L',
          referenceIds: ['clarke1997'],
        },
        {
          label: 'Eggs meta-analysis (17 trials, 556 subjects, at least 14 days)',
          value:
            '+100 mg/day raises TC by 0.056 mmol/L (2.2 mg/dL; 95 % CI 0.046–0.065), HDL by 0.008 mmol/L and TC:HDL by 0.020',
          referenceIds: ['weggemans2001'],
        },
        {
          label: 'Later meta-analysis (19 trials, 632 subjects)',
          value:
            'TC +11.2 mg/dL (6.4–15.9), LDL +6.7 mg/dL (1.7–11.7), HDL +3.2 mg/dL; LDL response no longer significant above 900 mg/day; TG and VLDL unchanged',
          note: 'The authors state explicitly that these lipid data allow no conclusion about cardiovascular outcomes.',
          referenceIds: ['berger2015'],
        },
        {
          label: "Keys' original square-root finding",
          value:
            'ΔChol = 1.5 (Z2 − Z1), r = 0.95 across 19 comparisons; from 250 mg/1000 kcal to zero cholesterol an average fall of about 24 mg/dL; a 50 % cut about 7 mg/dL',
          note: "Hegsted's 1986 re-evaluation found the response roughly linear over 0–400 mg/1000 kcal, about 0.1 mg/dL TC per 1 mg/1000 kcal, or about 4 mg/dL per 100 mg/day at 2500 kcal.",
          referenceIds: ['keys1965', 'hegsted1986'],
        },
        {
          label: 'Check of the equation',
          value: '300 → 500 mg/day at 2000 kcal gives dTC = +5.3 mg/dL = 0.14 mmol/L',
          note: 'Compare 0.13 per 200 mg (Clarke) and 0.11 (Weggemans).',
          referenceIds: ['clarke1997', 'weggemans2001'],
        },
        {
          label: 'Person-to-person differences (34 healthy adults, 500 mg/day change over 3 weeks)',
          value:
            'SD of response 0.35–0.42 mmol/L (14–16 mg/dL) around a mean fall of 0.16–0.31 mmol/L (6–12 mg/dL); individual responses from −1.0 to +0.5 mmol/L; correlation between two trials 6 years apart r = 0.32 (P < 0.05)',
          note: 'Low responders had higher BMI and lower HDL2. Responsiveness correlated negatively with habitual cholesterol intake (r = −0.62) and with BMI (r = −0.50). The engine uses a lognormal multiplier (mean 1, CV 1.0, truncated to 0–3); its shape is unverified.',
          referenceIds: ['katan1987', 'beynen1985'],
        },
      ],
      timeCourse:
        'The response is complete within about a month (the median duration of the ward experiments).',
      moderators:
        'Habitual cholesterol intake and BMI (both reduce responsiveness), and a stable individual trait.',
      grade: 'B',
      gradeReason:
        'Three meta-analyses agree on the size (no separate grade was given), but the saturating equation is a fit and the shape of individual responses is unverified.',
      status: 'proposed-fit',
      caveats:
        'The saturating equation is a proposed fit to the square-root law and three meta-analytic points. No conclusion about cardiovascular outcomes can be drawn from lipid data alone.',
      referenceIds: [
        'clarke1997',
        'weggemans2001',
        'berger2015',
        'keys1965',
        'hegsted1986',
        'katan1987',
        'beynen1985',
      ],
      relatedMetricIds: ['ldl'],
    },
    {
      id: '06-protein-swap-lipids-bp',
      title: 'Swapping carbohydrate for protein or unsaturated fat',
      category: 'cardio',
      summary:
        'In one large feeding trial in people with raised blood pressure, a diet with more protein, or more unsaturated fat, gave slightly lower triglycerides and blood pressure than a carbohydrate-rich diet. LDL fell a little with protein and did not change with unsaturated fat.',
      howModelled:
        'The engine uses the trial to give per-percent-of-energy coefficients for protein replacing carbohydrate. Plant and animal protein are not separated here.',
      keyNumbers: [
        {
          label: 'Trial design',
          value:
            '164 adults with prehypertension or stage-1 hypertension, three 6-week feeding periods, weight constant, all diets low in saturated fat (about 6 % of energy)',
          referenceIds: ['appel2005'],
        },
        {
          label:
            'Protein-rich diet (protein 15 → 25 % of energy, half from plants) against the carbohydrate diet',
          value:
            'LDL −3.3 mg/dL (−0.09 mmol/L); HDL −1.3 mg/dL; TG −15.7 mg/dL; SBP −1.4 mmHg (−3.5 in hypertensives)',
          referenceIds: ['appel2005'],
        },
        {
          label: 'Unsaturated-fat diet (mainly monounsaturated; carbohydrate −10 % of energy)',
          value: 'LDL 0 (not significant); HDL +1.1; TG −9.6; SBP −1.3 (−2.9 in hypertensives)',
          referenceIds: ['appel2005'],
        },
        {
          label: 'Per 1 % of energy of protein replacing carbohydrate',
          value: 'LDL −0.0085, HDL −0.0034, TG −0.0177 mmol/L; SBP −0.14 mmHg',
          referenceIds: ['appel2005'],
        },
      ],
      timeCourse: 'The trial measured effects after 6 weeks on each diet.',
      moderators: 'Blood pressure status: the effects on blood pressure were larger in hypertensives.',
      grade: 'B',
      gradeReason:
        'A single large controlled trial, consistent with the fat-swap meta-regression for monounsaturated fat.',
      status: 'established',
      caveats:
        'This rests on one trial. Effects of plant versus animal protein are otherwise unquantified here.',
      referenceIds: ['appel2005'],
      relatedMetricIds: ['ldl', 'triglycerides', 'sbp'],
    },
    {
      id: '06-apob-from-non-hdl',
      title: 'Estimating ApoB from other cholesterol measures',
      category: 'cardio',
      summary:
        'ApoB counts the number of atherogenic particles in the blood, since each LDL or VLDL particle carries one. Nobody expects the user to know their ApoB, so the engine estimates it from non-HDL cholesterol, which is LDL plus the cholesterol in triglyceride-rich particles. Saturated fat raises LDL cholesterol more than it raises ApoB.',
      howModelled:
        'ApoB changes by 0.587 times the change in non-HDL cholesterol, where non-HDL is estimated as LDL plus one fifth of the triglyceride level in mg/dL. For changes driven by saturated fat, the engine can shrink the ApoB change by a factor of 0.6.',
      equation: `ApoB = 11.09 + 0.587 · nonHDL      (resid SD 8.4 mg/dL)
nonHDL ≈ LDL + TG/5
dApoB = 0.587 · dNonHDL   (optional ×0.6 for the saturated-fat-driven part)`,
      keyNumbers: [
        {
          label: 'Relationships in US adults (NHANES 2013–14, 2347 fasting adults)',
          value:
            'Mean ApoB 90 mg/dL (men 91.7, women 88.3), SD 25; ApoB = 11.09 + 0.587 × nonHDL-C (r = 0.94, residual SD 8.4); ApoB = 19.65 + 0.627 × LDL-C (r = 0.89, residual SD 11.7)',
          note: 'Computed by Vitals from public NHANES files.',
          referenceIds: ['cdc2020'],
        },
        {
          label: 'Direct ApoB coefficients (2003 data set, per 1 % of energy)',
          value:
            'Saturated +2.6 mg/L (not significant), cis-monounsaturated −4.8, cis-polyunsaturated −7.7 (about +0.26, −0.48, −0.77 mg/dL)',
          note: 'Small and imprecise.',
          referenceIds: ['mensink2003'],
        },
        {
          label:
            'High-saturated-fat diet in 53 adults with small dense LDL (3 weeks; saturated fat 8 → 18 % of energy, carbohydrate 55 → 39 %)',
          value:
            'LDL cholesterol +16.7 % versus −8.7 % on the low-saturated-fat arm; ApoB +9.5 % versus −6.8 %; small LDL particles +6.1 % versus −20.8 %',
          note: 'The ratio of ApoB rise to LDL rise is 0.57, which gives the 0.6 shrink factor (proposed).',
          referenceIds: ['chiu2017'],
        },
      ],
      timeCourse: 'ApoB follows LDL and triglycerides with their time constants.',
      moderators:
        'Composition of the fat eaten. In the trial, which recruited adults with a small-dense-LDL pattern, saturated fat raised LDL cholesterol more than it raised ApoB.',
      grade: 'B',
      gradeReason:
        'The NHANES relationships are strong and the trial supports the shrink factor; the direct ApoB coefficients are small and imprecise.',
      status: 'proposed-fit',
      caveats:
        'The shrink factor is proposed from a single trial in people with a particular LDL pattern. The regression comes from a US cross-section from 2013–14.',
      referenceIds: ['cdc2020', 'mensink2003', 'chiu2017'],
      relatedMetricIds: ['apoB'],
    },
    {
      id: '06-low-carb-ldl-average',
      title: 'Very-low-carbohydrate diets and average LDL',
      category: 'cardio',
      summary:
        'Across randomised trials, mostly in people with obesity who lose weight, LDL ends up slightly higher on very-low-carbohydrate diets than on low-fat diets, by about 0.07–0.16 mmol/L (roughly 3–6 mg/dL). Triglycerides are lower and HDL is higher. These averages hide very large differences between people, which the next entry covers.',
      howModelled:
        'The average difference is already produced by the fat-swap terms, the weight-loss terms and the triglyceride terms working together. The engine adds a separate term only for the tail of large responders in lean people.',
      keyNumbers: [
        {
          label:
            'Very-low-carbohydrate (50 g or less) versus low-fat, 12 months or longer (13 RCTs, n = 1255 for LDL)',
          value: 'LDL +0.12 mmol/L (95 % CI 0.04, 0.20) (+4.6 mg/dL); TG −0.18; HDL +0.09; DBP −1.4',
          referenceIds: ['bueno2013'],
        },
        {
          label:
            'Carbohydrate under 20 % of energy versus low-fat, 6 months or longer (11 RCTs, 1369 people)',
          value: 'LDL +0.16 mmol/L (0.003, 0.33) (+6 mg/dL); HDL +0.14; TG −0.26; weight −2.2 kg',
          referenceIds: ['mansoor2016'],
        },
        {
          label: 'Carbohydrate 45 % of energy or less versus fat 30 % or less (23 RCTs, 2788 people)',
          value:
            'The low-carbohydrate arm lowered LDL 3.7 mg/dL less than low-fat (95 % CI 1.0–6.4); HDL +3.3 mg/dL; TG −14.0 mg/dL',
          referenceIds: ['hu2012'],
        },
        {
          label: '6–12 months (38 RCTs, 6499 people)',
          value: 'LDL +0.07 mmol/L (0.02, 0.12) versus low-fat; TG −0.10; HDL +0.05; weight −1.3 kg',
          referenceIds: ['chawla2020'],
        },
        {
          label: 'Network meta-analysis of 121 RCTs (21,942 overweight or obese adults, 6 months)',
          value:
            'LDL change against usual diet: low-carbohydrate −1.0 mg/dL (low certainty), low-fat −7.1, moderate −5.2; HDL +2.3 versus −1.9 (low-fat)',
          referenceIds: ['ge2020'],
        },
        {
          label: 'Fully provided food, BMI 38.9, matched weight loss of about 10.5 %, 42 adults',
          value:
            'LDL −10 (very-low-carbohydrate), −22 (Mediterranean-style) and −8 mg/dL (very-low-fat); ApoB −6, −15 and −9; no difference between diets (P = 0.44 for LDL)',
          note: 'Very-low-carbohydrate eating did not raise LDL here.',
          referenceIds: ['petersen2026'],
        },
        {
          label: 'Overweight men losing 5.1 kg on carbohydrate 54, 39 or 26 % of energy (178 men, BMI 29.2)',
          value:
            'Carbohydrate restriction improved atherogenic dyslipidaemia (TG, ApoB, small LDL) but the benefits vanished after weight loss; LDL fell less on the diet with 15 % of energy from saturated fat because of a rise in large LDL',
          referenceIds: ['krauss2006'],
        },
      ],
      timeCourse:
        'The meta-analyses cover 6–12 months and longer, so they describe the steady state rather than the first weeks.',
      moderators:
        'BMI (the effect changes sign with BMI, see the next entry), weight loss, and saturated-fat intake.',
      grade: 'A',
      gradeReason: 'Five meta-analyses agree, with LDL +0.07 to +0.16 mmol/L against low-fat diets.',
      status: 'established',
      caveats:
        'Populations are mostly people with obesity who lose weight during the study. The averages say little about lean people.',
      referenceIds: [
        'bueno2013',
        'mansoor2016',
        'hu2012',
        'chawla2020',
        'ge2020',
        'petersen2026',
        'krauss2006',
      ],
      relatedMetricIds: ['ldl', 'apoB'],
    },
    {
      id: '06-lean-mass-hyper-responder',
      title: 'The lean-responder tail: very high LDL on low-carbohydrate diets',
      category: 'cardio',
      summary:
        'In a minority of lean, insulin-sensitive people, a few weeks of very-low-carbohydrate eating can raise LDL by 50–250 mg/dL, with high HDL and low triglycerides. The rise gets smaller as BMI increases. One proposed explanation, the "Lipid Energy Model", is that in lean people the liver carries more of the body\'s fuel fat in lipoprotein particles. That explanation has not been proven in controlled trials, and what the high LDL means for risk is unresolved.',
      howModelled:
        'An extra term is added to the LDL target: the ketosis state times a personal multiplier times a BMI-dependent amount (45 mg/dL at BMI 22, falling 4.5 mg/dL for each BMI unit, so zero at BMI 32.2) times an energy-balance modifier. The energy modifier is optional. The term is labelled as speculative in the app.',
      equation: `LEM_term (mg/dL) = s_keto · m_i · max(0, A_LEM − b_LEM·(BMI − 22)) · E_mod
A_LEM = 45 mg/dL at BMI 22;  b_LEM = 4.5 mg/dL per BMI unit
s_keto ∈ [0, 1] from the ketosis topic (BHB from about 0.5 mM, saturating at 1.5 mM or more)
m_i ~ lognormal(μ = 0, σ = 0.6)   (P(m > 2) = 12 %)
E_mod = clip(1 − 2·(EI/EE − 1), 0, 1.5)    (deficits raise, surpluses lower LDL; grade D, optional)`,
      keyNumbers: [
        {
          label: '3 weeks under 20 g carbohydrate a day in 30 normal-weight young adults (parallel RCT)',
          value: 'LDL 2.2 ± 0.4 → 3.1 ± 0.8 mmol/L (+44 % against control); individual rises 5 to 107 %',
          note: 'ApoB, total cholesterol, HDL and uric acid rose too. Weight, blood pressure and CRP did not change.',
          referenceIds: ['retterstol2018'],
        },
        {
          label: '4 weeks in 17 healthy normal-weight young women (crossover feeding)',
          value:
            'Diet of 4 % carbohydrate, 77 % fat, 19 % protein versus 44/33/19: LDL treatment effect +1.82 mmol/L (+70 mg/dL), increased in every participant',
          note: 'ApoB, small dense and large buoyant LDL all rose. Weight −3 kg versus −1 kg. The saturated-fat share of that diet is unverified.',
          referenceIds: ['buren2021'],
        },
        {
          label:
            'Web survey of 548 people on carbohydrate-restricted diets (mean 27 g carbohydrate a day, BMI 24.1 ± 4.0)',
          value:
            'LDL 145 ± 59 → 236 ± 107 mg/dL; change mean +91, SD 103, median +72, 5th percentile −29, 95th +302; HDL +13, TG −26',
          note: 'Self-selected, with a mean interval of 724 days between lipid tests. In the subgroup with LDL 200 or more, HDL 80 or more and TG 70 or less (n = 100, 18 %), BMI was 22.0 versus 24.6, LDL 320 ± 115 and the median change +146 versus +61.',
          referenceIds: ['norwitz2022a'],
        },
        {
          label: 'Regression in the same survey',
          value: 'BMI beta −5.9 mg/dL per BMI unit; ΔLDL = 242.5 − 4.5 × (prior TG/HDL) − 5.9 × BMI',
          note: 'Only for people already choosing carbohydrate restriction. A low prior TG/HDL predicts a larger rise, and the line reaches about zero near BMI 38.',
          referenceIds: ['norwitz2022a'],
        },
        {
          label: 'Saturated fat alone does not explain the tail',
          value:
            'The 2016 fat-swap model predicts about +0.5 mmol/L (about +18 mg/dL) for a switch from 12 to 25 % of energy from saturated fat, against +35 to +170 mg/dL observed',
          referenceIds: ['mensink2016'],
        },
        {
          label:
            'Coronary imaging in 80 people with very high LDL on a low-carbohydrate diet (mean 4.7 years, mean LDL 272, maximum 591)',
          value:
            'Plaque burden no different from matched controls with LDL 123; no correlation between LDL and plaque',
          note: 'Not evidence of safety: cross-sectional, self-selected, low power, no hard outcomes.',
          referenceIds: ['budoff2024'],
        },
        {
          label:
            '5-day very-low-carbohydrate diets at 1135, 2278 and 4116 kcal a day (two single-person experiments plus a case series of 24)',
          value:
            'LDL and ApoB rose with calorie restriction and fell with overfeeding, despite more saturated fat',
          note: 'Grade D for the energy-balance modifier. Case reports describe the same phenotype on a low-saturated-fat diet.',
          referenceIds: ['feldman2022', 'norwitz2022b'],
        },
        {
          label: 'Matched-weight-loss comparison at BMI 39',
          value:
            'LDL −10 mg/dL and ApoB −6 mg/dL on a very-low-carbohydrate diet, the sign opposite to lean people',
          note: 'The engine must flip sign with BMI. Trials in obese populations give +5 mg/dL against low-fat at 6 months or more.',
          referenceIds: ['petersen2026'],
        },
        {
          label: 'Fit of the amplitude A_LEM',
          value: '45 mg/dL, in the middle of a range of 10–65',
          note: 'Burén at BMI about 22: total +70 mg/dL, of which the fat-swap terms are about +25 (assuming saturated fat of about 30 % of energy, which is unverified), leaving about 45. Retterstøl: +35 mg/dL mean, term about 10–15. The population mean over a BMI 18–40 mix is +5 to +20 mg/dL, as in the meta-analyses.',
          referenceIds: ['buren2021', 'retterstol2018', 'norwitz2022a'],
        },
        {
          label: 'Endurance runners (as cited in the survey paper)',
          value:
            'LDL 161 versus 88 mg/dL on 10 % versus 57 % of energy from carbohydrate (20 runners, cross-section)',
          referenceIds: ['norwitz2022a'],
        },
        {
          label: 'Risk is tied to particle number',
          value: 'Risk is proportional to ApoB, whatever the origin of the particles',
          note: 'Mendelian randomisation argues that particle number matters more than the diet that produced it.',
          referenceIds: ['ference2019'],
        },
      ],
      timeCourse:
        'LDL rises within 1–3 weeks (three weeks in one trial, four in another, and within 5 days in the case data). The model uses a time constant of 10 days. LDL falls over weeks after carbohydrate returns, but that timing is unverified.',
      moderators:
        'BMI (strong, inverse); a low TG/HDL ratio (larger rise); sex (the survey had 61 % men among non-responders against 45 % among responders); leanness and high training volume; saturated-fat intake (adds); energy balance (the modifier is unproven).',
      grade: 'C',
      gradeReason:
        'The existence of large rises in lean people rests on two small controlled trials plus observational data (B), but the size-versus-BMI equation and the mechanism rest on a self-selected survey and single-person experiments (C/D).',
      status: 'contested',
      caveats:
        'The Lipid Energy Model is a hypothesis. The clinical meaning of these LDL values is unresolved: the coronary imaging is reassuring only at low power. The energy-balance modifier rests on two single-person experiments plus a case series of 24.',
      referenceIds: [
        'retterstol2018',
        'buren2021',
        'norwitz2022a',
        'norwitz2022b',
        'mensink2016',
        'budoff2024',
        'feldman2022',
        'petersen2026',
        'ference2019',
      ],
      relatedMetricIds: ['ldl', 'apoB'],
    },
    {
      id: '06-viscous-fibre-ldl',
      title: 'Gel-forming fibre lowers LDL',
      category: 'cardio',
      summary:
        'Viscous (gel-forming) soluble fibres, found in oats, barley, psyllium and konjac, bind bile acids in the gut. The liver then draws more cholesterol from the blood to make replacements. LDL falls by about 0.25–0.35 mmol/L at intakes from about 3 g to about 10 g a day. HDL and triglycerides do not change.',
      howModelled:
        "The engine uses a saturating curve of extra viscous fibre in grams a day. The curve has a ceiling of 0.45 mmol/L and reaches half of it at 2.5 g/day. It is scaled by the user's baseline LDL relative to 115 mg/dL. It should not be extrapolated beyond about 15 g/day.",
      equation: `dLDL_vf (mmol/L) = −Emax_f · d/(d + D50_f),   d = extra viscous fibre, g/day
Emax_f = 0.45 mmol/L,  D50_f = 2.5 g/day
scale by (LDL0/115)`,
      keyNumbers: [
        {
          label: 'Soluble fibre (pectin, oat bran, guar, psyllium; 67 trials), 2–10 g/day',
          value:
            'LDL −0.057 mmol/L per g (−0.070, −0.044) [−2.2 mg/dL per g]; TC −0.045 mmol/L per g; TG and HDL unchanged',
          note: 'Independent of design, duration and baseline fat intake.',
          referenceIds: ['brown1999'],
        },
        {
          label: 'Oat beta-glucan (28 RCTs), 3 g/day or more (3.0–12.4 g/day)',
          value: 'LDL −0.25 mmol/L (−0.30, −0.20); TC −0.30; no dose dependence across 3–12 g/day',
          note: 'Durations 2–12 weeks. The effect was greater at higher baseline LDL and greater in diabetes.',
          referenceIds: ['whitehead2014'],
        },
        {
          label: 'Barley beta-glucan (14 RCTs, n = 615), median 6.5 g/day for 4 weeks',
          value: 'LDL −0.25 mmol/L (−0.30, −0.20); non-HDL −0.31; ApoB no change',
          referenceIds: ['ho2016'],
        },
        {
          label: 'Psyllium (28 RCTs, n = 1924), median about 10.2 g/day for 3 weeks or more',
          value: 'LDL −0.33 mmol/L (−0.38, −0.27); non-HDL −0.39; ApoB −0.05 g/L (5 mg/dL)',
          note: 'With or without high cholesterol.',
          referenceIds: ['jovanovski2018'],
        },
        {
          label: 'Psyllium in high cholesterol on a low-fat diet (8 RCTs), 10.2 g/day for 8 weeks or more',
          value: 'TC −4 %; LDL −7 %; ApoB/ApoA-I −6 %; HDL and TG unchanged',
          referenceIds: ['anderson2000'],
        },
        {
          label: 'Viscous versus cereal (non-viscous) fibre (89 trials, n = 4755)',
          value: 'LDL −0.26 mmol/L (−0.30, −0.22); non-HDL −0.33; ApoB −0.04 g/L',
          referenceIds: ['jovanovski2023'],
        },
        {
          label: 'Konjac glucomannan (12 studies, n = 370), about 3 g/day',
          value: 'LDL −0.35 mmol/L (−0.46, −0.25) (about −10 %); non-HDL −0.32; ApoB none',
          referenceIds: ['ho2017'],
        },
        {
          label: 'Curve check',
          value: 'd = 3 g: −0.245; 6.5 g: −0.325; 10.2 g: −0.36 mmol/L',
          note: 'Proposed fit. These sit inside the intervals for oat, psyllium and konjac, and 0.025 mmol/L beyond the interval for barley. The curve overestimates the linear low-dose slope below about 2 g/day (−0.11 versus −0.20 mmol/L at 2 g).',
        },
      ],
      timeCourse:
        'LDL responds within 2–4 weeks. Trials lasted 2–12 weeks and the effect did not depend on duration. The engine uses a time constant of 10 days (proposed).',
      moderators:
        'Baseline LDL (a larger absolute fall at higher LDL) and diabetes (larger beta-glucan and ApoB effects). Between-person spread of the response was not reported in the abstracts; the engine assumes a spread of 40 % of the mean (unverified).',
      grade: 'A',
      gradeReason: 'Multiple large dose-response meta-analyses agree.',
      status: 'proposed-fit',
      caveats: 'The saturating curve is a fit and is not valid past about 15 g/day.',
      referenceIds: [
        'brown1999',
        'whitehead2014',
        'ho2016',
        'jovanovski2018',
        'anderson2000',
        'jovanovski2023',
        'ho2017',
      ],
      relatedMetricIds: ['ldl', 'apoB'],
    },
    {
      id: '06-plant-sterols-ldl',
      title: 'Plant sterols and stanols lower LDL',
      category: 'cardio',
      summary:
        'Plant sterols and stanols block cholesterol absorption in the gut. LDL falls by about 6 % at 0.6 g a day and about 12 % at 3.3 g a day. The effect levels off at about 3 g a day.',
      howModelled:
        'A saturating curve in grams a day with a ceiling of 20 % and a half-way point at 2.5 g/day, applied on top of the fat-swap term.',
      equation: `dLDL_ps (%) = −Emax_s · d/(d + D50_s),   Emax_s = 20 %,  D50_s = 2.5 g/day`,
      keyNumbers: [
        {
          label: 'Dose-response (124 studies, 201 strata)',
          value: '0.6 / 1.1 / 1.7 / 2.1 / 2.6 / 3.3 g/day → −5.7 / −6.4 / −7.6 / −8.4 / −10.3 / −12.4 % LDL',
          note: 'All 95 % intervals exclude zero. Sterols and stanols were equally effective. The effect plateaus at about 3 g/day (average 12 %).',
          referenceIds: ['ras2014'],
        },
        {
          label: 'Continuous dose-response (84 trials)',
          value: 'Mean 2.15 g/day → −0.34 mmol/L (−8.8 %)',
          note: 'A two-parameter saturating curve. The absolute drop was larger at higher baseline LDL.',
          referenceIds: ['demonty2009'],
        },
        {
          label: 'Curve check',
          value:
            '0.6 g: −3.9; 1.1: −6.1; 1.7: −8.1; 2.1: −9.1; 2.6: −10.2; 3.3: −11.4 % (against −5.7, −6.4, −7.6, −8.4, −10.3, −12.4 observed)',
          note: 'Proposed fit. The largest error is 1.8 percentage points at 0.6 g/day.',
        },
      ],
      timeCourse: 'LDL responds within 2–4 weeks; the engine uses a time constant of 10 days (proposed).',
      moderators: 'Baseline LDL: the absolute fall is larger when LDL starts higher.',
      grade: 'A',
      gradeReason: 'Large dose-response meta-analyses agree.',
      status: 'proposed-fit',
      caveats: 'The curve underestimates the effect at the lowest dose.',
      referenceIds: ['ras2014', 'demonty2009'],
      relatedMetricIds: ['ldl', 'apoB'],
    },
    {
      id: '06-nuts-ldl',
      title: 'Nuts lower LDL',
      category: 'cardio',
      summary:
        'Eating nuts lowers LDL modestly, and the effect is stronger at higher intakes. It does not depend on the type of nut. Each 28.4 g serving a day lowers LDL by about 4.8 mg/dL.',
      howModelled:
        "LDL falls by 4.8 mg/dL for each serving up to 2 servings a day, and by 5.5 mg/dL per serving for the third. The effect is capped at 3 servings and scaled by the user's baseline LDL relative to 115 mg/dL.",
      equation: `dLDL_nut (mg/dL) = −4.8·n   for n servings (28.4 g)/day, n ≤ 2
for 2 < n ≤ 3 use −5.5 per serving;  cap at 3 servings;  scale by (LDL0/115)`,
      keyNumbers: [
        {
          label: 'Tree nuts, dose-response of 61 trials (n = 2582, 3–26 weeks), per 28.4 g serving a day',
          value: 'LDL −4.8 mg/dL (−5.5, −4.2); TC −4.7; ApoB −3.7 (−5.2, −2.3); TG −2.2',
          note: 'The relationship is non-linear and stronger at 60 g/day or more. Nut type made no difference.',
          referenceIds: ['delgobbo2015'],
        },
        {
          label: 'Pooled individual data from 25 trials (n = 583), 67 g/day',
          value:
            'TC −10.9 mg/dL (5.1 %); LDL −10.2 mg/dL (7.4 %); TG −20.6 mg/dL only if baseline TG was 150 or more',
          note: 'The effect was larger with high LDL, low BMI and a Western diet.',
          referenceIds: ['sabate2010'],
        },
      ],
      timeCourse: 'Effects appear within 2–4 weeks; the engine uses a time constant of 10 days (proposed).',
      moderators: 'Baseline LDL (positive) and BMI (the effect is larger at low BMI).',
      grade: 'A',
      gradeReason: 'Large dose-response meta-analyses agree.',
      status: 'proposed-fit',
      caveats: "The engine's piecewise rule and its cap at 3 servings are proposed.",
      referenceIds: ['delgobbo2015', 'sabate2010'],
      relatedMetricIds: ['ldl'],
    },
    {
      id: '06-soy-protein-and-portfolio',
      title: 'Soy protein, and combining cholesterol-lowering foods',
      category: 'cardio',
      summary:
        'Soy protein lowers LDL a little, more in older people with high cholesterol and less in healthy people. Combining viscous fibre, plant sterols, soy protein and almonds, the "portfolio" pattern, lowered LDL by about 17 % in a pooled analysis and by more in one small one-month trial. Combined effects add up to less than the sum of the parts.',
      howModelled:
        "Soy protein lowers LDL by 0.10 mg/dL per gram a day, capped at 8 mg/dL for healthy people with normal lipids. Effects of different components are combined as a sub-additive product: the total fraction is 1 minus the product of (1 minus each component's fraction of baseline LDL).",
      equation: `dLDL_soy (mg/dL) = −0.10 · (g soy protein/day), capped at −8 mg/dL for healthy people with normal lipids
total (non-composition) = 1 − ∏(1 − f_i),   f_i = |d_i|/LDL0`,
      keyNumbers: [
        {
          label: 'Soy protein (38 controlled trials), about 47 g/day',
          value:
            'TC −23.2 mg/dL (9.3 %); LDL −21.7 mg/dL (12.9 %); TG −13.3 mg/dL; HDL +2.4 % (not significant)',
          note: 'Effect proportional to baseline cholesterol, in older, hypercholesterolaemic populations.',
          referenceIds: ['anderson1995'],
        },
        {
          label: 'Soya products at typical intakes (35 studies, 4 weeks to 1 year)',
          value:
            'LDL −4.8 mg/dL (−7.3, −2.3); TG −4.9; HDL +1.4; whole-soy foods −11.1 versus extracts −3.2 mg/dL; hypercholesterolaemic −7.5 versus healthy −3.0 mg/dL; isoflavone supplements no effect',
          note: 'Between-study heterogeneity was very high (I² of 92–99 %).',
          referenceIds: ['tokede2015'],
        },
        {
          label: 'Portfolio pattern (7 trials, 439 people, NCEP Step II background), at least 3 weeks',
          value: 'LDL −0.73 mmol/L (−0.89, −0.56), about −17 %',
          note: 'Sterols 1.0 g, soy 21.4 g, viscous fibre 9.8 g and almonds 14 g per 1000 kcal. Non-HDL, ApoB, TC, TG, SBP/DBP, CRP and estimated 10-year risk also fell; HDL and body weight did not change.',
          referenceIds: ['chiavaroli2018'],
        },
        {
          label: 'One-month outpatient trial (n = 46, hypercholesterolaemic, mean age 59, BMI 27.6)',
          value:
            'LDL −28.6 % (control −8.0 %; lovastatin 20 mg −30.9 %); CRP −28.2 % (statin −33.3 %); no difference between portfolio and statin',
          referenceIds: ['jenkins2003'],
        },
      ],
      timeCourse:
        'LDL responses appear within 2–4 weeks; the engine uses a time constant of 10 days (proposed).',
      moderators:
        'Baseline LDL, type of soy (whole-soy foods do more than extracts) and background saturated-fat intake (the portfolio was tested on a low-saturated-fat background).',
      grade: 'B',
      gradeReason:
        'Soy has a small, heterogeneous effect, and the portfolio rests on seven trials plus one small one-month trial.',
      status: 'proposed-fit',
      caveats:
        'The cap for healthy people shrinks the older hypercholesterolaemic result (proposed, grade B/C). How far the components add is known only qualitatively: −17 % pooled against −28.6 % in the small trial.',
      referenceIds: ['anderson1995', 'tokede2015', 'chiavaroli2018', 'jenkins2003'],
      relatedMetricIds: ['ldl'],
    },
    {
      id: '06-triglyceride-drivers',
      title: 'What sets fasting triglycerides',
      category: 'cardio',
      summary:
        'Fasting triglycerides reflect how much fat the liver packs into particles, from sugar, from fatty acids arriving from fat tissue and from alcohol, minus how fast enzymes clear them. Trading carbohydrate for fat, or for protein, lowers them. Weight loss and exercise lower them too. The next entries cover sugar, alcohol, omega-3 and very-low-carbohydrate eating.',
      howModelled:
        'Each driver is a term on the natural-log scale, with its own state and time constant. The fat-for-carbohydrate exchange uses the Mensink coefficients divided by the mean triglyceride level in the data. Weight and exercise terms are proposed from trials.',
      equation: `ln TG* += c_rel · ΔE     (c_rel = Mensink TG coefficient / 1.2 mmol/L)
d ln TG (weight) = −0.015 per kg lost (BMI 25–30);  −0.020 per kg (BMI ≥ 30)
d ln TG (exercise) = −0.06 · min(1, METs·h per week / 15)`,
      keyNumbers: [
        {
          label: 'Relative effect of swapping carbohydrate for fat, per 1 % of energy',
          value:
            'Saturated −1.0 %, monounsaturated −1.25 %, polyunsaturated −1.75 % (alpha-linolenic −1.9 %)',
          note: 'The effect is only slightly larger at higher baseline (saturated −0.011 versus −0.013; polyunsaturated −0.020 versus −0.022 mmol/L per %, below versus above median). Valid for fat of 4.5–53 % of energy.',
          referenceIds: ['mensink2016'],
        },
        {
          label: 'Protein for carbohydrate',
          value: '−0.0177 mmol/L per % of energy (about −1.7 % per % at TG 106)',
          referenceIds: ['appel2005'],
        },
        {
          label: 'Weight loss',
          value: 'd ln TG −0.015 per kg (BMI 25–30), −0.020 per kg (BMI 30 or more)',
          note: 'Proposed from Magkos (TG 153 → 130 → 110 → 97 mg/dL at −5, −11, −16 % weight, i.e. −15, −28, −37 %, about −2.1 % per kg at BMI 40), Zomer (−0.13 mmol/L over 6–12 months) and Look AHEAD (median −12 mg/dL for −4.8 kg).',
          referenceIds: ['magkos2016', 'zomer2016', 'wing2011'],
        },
        {
          label: 'Aerobic training (31 trials, 4 weeks or more)',
          value: 'TG −0.08 mmol/L (−7 mg/dL) (0.02, 0.14); LDL −0.10; HDL +0.05 mmol/L',
          referenceIds: ['halbert1999'],
        },
        {
          label: 'Progressive resistance training (29 trials, n = 1329)',
          value: 'TG −8.1 mg/dL (−14.5, −1.8); LDL −6.1; non-HDL −8.7; HDL +0.7 (not significant)',
          note: 'Diet alone, or diet plus exercise, beat exercise alone for LDL, whereas exercise alone lowered only triglycerides.',
          referenceIds: ['kelley2009', 'kelley2012'],
        },
        {
          label: 'Inactivity after training (a training study, 15 days without exercise)',
          value:
            'LDL, LDL particle number and small dense LDL rose; moderate-intensity training sustained the VLDL-TG lowering for 15 days',
          note: 'The acute hours-to-days lowering after a single session is real but not simulated.',
          referenceIds: ['slentz2007'],
        },
        {
          label: 'Exercise term',
          value: 'd ln TG = −0.06 · min(1, METs·h per week / 15), time constant 21 days',
          note: 'Proposed. 6 % is about 7 mg/dL at TG 110.',
        },
        {
          label: 'Very low sodium (contested, off by default)',
          value:
            'Cutting sodium from 201 to 66 mmol/day raised TG +7.0 mg/dL (+6.3 %) and cholesterol +5.6 mg/dL (2.9 %); another review found no significant lipid change (TC +0.05 mmol/L, not significant)',
          referenceIds: ['graudal2017', 'he2013'],
        },
        {
          label: 'Time constants (proposed)',
          value:
            '4 days (carbohydrate, energy, alcohol, sugar); 30–45 days (weight); 14 days (omega-3, unverified); 21 days (exercise)',
          note: 'TG halves within a week of a very-low-calorie diet. Carbohydrate-induced high triglycerides build within days on refeeding.',
        },
      ],
      timeCourse:
        'Composition effects act within about 4 days, exercise over about 3 weeks and fat-mass effects over 1–1.5 months. Reversal uses the same time constants.',
      moderators:
        'Baseline TG (effects are proportional, on the log scale), BMI and insulin resistance, sex (women have lower TG), alcohol status and PNPLA3 genotype.',
      grade: 'A',
      gradeReason:
        'The fat-for-carbohydrate exchange rests on the meta-regression (A); the weight and exercise terms are graded B.',
      status: 'proposed-fit',
      caveats:
        'The weight and exercise coefficients are proposed from a few trials. The sodium effect on lipids is contested and switched off by default.',
      referenceIds: [
        'mensink2016',
        'appel2005',
        'magkos2016',
        'zomer2016',
        'wing2011',
        'halbert1999',
        'kelley2009',
        'kelley2012',
        'slentz2007',
        'graudal2017',
        'he2013',
      ],
      relatedMetricIds: ['triglycerides'],
    },
    {
      id: '06-sugar-fructose-triglycerides',
      title: 'Sugar, fructose and triglycerides',
      category: 'cardio',
      summary:
        'Fructose swapped for other carbohydrate at the same calories had no effect on triglycerides in 51 trials. Fructose added on top of usual intake, at 21–35 % of energy, raised them by about 0.26 mmol/L. Higher-sugar diets raised triglycerides by about 0.11 mmol/L, most in trials where weight stayed stable. Large amounts of liquid sugar over months had bigger effects.',
      howModelled:
        'The engine adds up to 0.26 mmol/L when fructose or sugar supplies a large energy surplus. In energy balance it adds a small amount, 0.006 mmol/L for each percent of energy from free sugars above 10 %. The second term is a compromise and is graded C.',
      equation: `dTG_sugar (mmol/L) = 0.26 · min(1, excess_%E/28) · 1[energy surplus] + 0.006 · max(0, free_sugars_%E − 10) · 1[energy-balanced]
decayed with the composition time constant (4 days)`,
      keyNumbers: [
        {
          label: 'Fructose swapped for other carbohydrate at equal energy (51 trials, n = 943)',
          value: 'No effect on TG',
          referenceIds: ['chiavaroli2015'],
        },
        {
          label: 'Extra fructose (+21–35 % of energy, 8 trials, n = 125)',
          value: 'TG +0.26 mmol/L (0.11, 0.41) (+23 mg/dL); ApoB +0.18 mmol/L',
          referenceIds: ['chiavaroli2015'],
        },
        {
          label: 'Higher versus lower free-sugar diets (37 trials)',
          value: 'TG +0.11 mmol/L (0.07, 0.15); LDL +0.12; TC +0.16; HDL +0.02',
          note: 'The effect was largest in energy-balanced studies without weight change.',
          referenceIds: ['temorenga2014'],
        },
        {
          label:
            'Fructose-sweetened versus glucose-sweetened drinks (25 % of energy for 10 weeks, overfeeding, overweight and obese)',
          value:
            'Fructose raised DNL, post-meal TG area, fasting ApoB and LDL, lowered insulin sensitivity and increased visceral fat; glucose raised fasting TG by about 10 % but not ApoB or LDL',
          note: 'DNL is de novo lipogenesis, the liver making fat from sugar.',
          referenceIds: ['stanhope2009'],
        },
        {
          label: '1 L/day of sucrose-sweetened cola for 6 months, against milk, diet cola or water',
          value: 'TG +32 %; TC +11 %; liver fat +132–143 %',
          referenceIds: ['maersk2012'],
        },
      ],
      timeCourse: 'Triglycerides respond within days, with a time constant of 4 days in the engine.',
      moderators:
        'Whether energy intake exceeds needs (the main modifier), the source of sugar (sugar-sweetened drinks matter most), and baseline TG.',
      grade: 'B',
      gradeReason:
        'The finding that isocaloric fructose has no effect and excess energy does is graded A, but the compromise coefficients are graded B/C.',
      status: 'proposed-fit',
      caveats:
        'The equation is a compromise between the sugar meta-analysis and the isocaloric null result. Liquid sugar seems to act more strongly over months than the fit allows.',
      referenceIds: ['chiavaroli2015', 'temorenga2014', 'stanhope2009', 'maersk2012'],
      relatedMetricIds: ['triglycerides'],
    },
    {
      id: '06-alcohol-triglycerides-hdl',
      title: 'Alcohol, triglycerides and HDL',
      category: 'cardio',
      summary:
        'Alcohol raises both triglycerides and HDL cholesterol. In experimental studies, 30 g of ethanol a day raised triglycerides by about 6 mg/dL and HDL by about 4 mg/dL. Above about 60 g a day, liver output of triglyceride-rich particles is thought to climb faster, but that part is unverified.',
      howModelled:
        'Triglycerides rise by 0.19 mg/dL for each gram of ethanol a day, up to 60 g/day. Above that the engine does not extrapolate. It warns beyond 100 g/day, the top of the studied range.',
      equation: `dTG (mg/dL) = 0.19 · g_alcohol per day,   up to 60 g/day`,
      keyNumbers: [
        {
          label: '30 g of ethanol a day (42 experimental studies, 1–9 weeks, up to 100 g/day)',
          value: 'TG +5.7 mg/dL (2.5, 8.9); HDL +4.0 mg/dL (3.3, 4.7); ApoA-I +8.8 mg/dL',
          referenceIds: ['rimm1999'],
        },
        {
          label: 'Above 60 g/day',
          value: 'Liver overproduction of triglyceride-rich particles is expected to escalate non-linearly',
          note: 'Unverified; based on clinical experience and AHA statements rather than a located dose-response.',
        },
      ],
      timeCourse: 'Triglycerides follow with a time constant of 4 days.',
      moderators: 'Baseline TG and beverage. The dose range in the studies was up to 100 g/day.',
      grade: 'A',
      gradeReason:
        'The 5.7 mg/dL per 30 g/day effect in the moderate range is well supported; beyond that range the grade is C.',
      status: 'established',
      caveats: 'Non-linear escalation at high intakes is not quantified.',
      referenceIds: ['rimm1999'],
      relatedMetricIds: ['triglycerides', 'hdl'],
    },
    {
      id: '06-omega-3-triglycerides',
      title: 'Fish-oil fats (EPA and DHA) lower triglycerides',
      category: 'cardio',
      summary:
        'The omega-3 fats EPA and DHA lower triglycerides in proportion to dose. In a large dose-response analysis the fall was about 19 mg/dL at 1 g a day, 43 at 2 g and 69 at 3 g. The fall is larger when triglycerides start high. Two meta-analyses disagree about how steep the response is, so the engine offers a conservative and a steeper setting.',
      howModelled:
        'The fall is a percentage that grows with dose above 0.5 g/day and with baseline TG, capped at 40 %. A toggle switches the slope from 0.09 (conservative) to 0.12 per gram (closer to the large dose-response analysis).',
      equation: `dTG% = −0.09 · max(0, d − 0.5) · (TG0/200)^0.4,   capped at −40 %,   d = EPA + DHA, g/day
(steeper option: 0.12 per g in place of 0.09)`,
      keyNumbers: [
        {
          label: 'Dose-response of 90 RCTs (72,598 people, median 13 weeks, spline)',
          value:
            'TG −19.2 (−32.0 to −6.4) mg/dL at 1 g/day; −42.6 (−53.4 to −31.8) at 2 g/day; −68.9 (−98.4 to −39.4) at 3 g/day',
          note: 'Roughly linear above 2 g/day, steeper in high triglycerides (−23, −50, −81 mg/dL) and in overweight or obesity, and plateauing near −40 mg/dL in people without high lipids. EPA and DHA were equally effective. HDL +3.5 mg/dL at about 1.75 g/day; LDL +2.9 mg/dL in a J-shape peaking near 1.75 g/day.',
          referenceIds: ['wang2023'],
        },
        {
          label: 'Dose comparison in men with TG 150–500 mg/dL (n = 26, 8 weeks)',
          value: '0.85 g/day: no effect; 3.4 g/day: TG −27 % (237 → 173 mg/dL)',
          referenceIds: ['skulasray2011'],
        },
        {
          label: 'Meta-analysis of 47 studies, 3.25 g/day',
          value: 'TG −0.34 mmol/L (−30 mg/dL); LDL +0.06 mmol/L',
          note: 'The reduction correlated with dose and baseline TG.',
          referenceIds: ['eslick2009'],
        },
        {
          label: 'Review of 21 fish-oil trials',
          value: 'TG −27 mg/dL (−33, −20); HDL +1.6; LDL +6',
          referenceIds: ['balk2006'],
        },
        {
          label: 'American Heart Association advisory',
          value:
            'At least 30 % TG reduction with 4 g/day in TG of 500 mg/dL or more; LDL rises with EPA + DHA in very high TG but not with EPA alone',
          referenceIds: ['skulasray2019'],
        },
        {
          label: 'Model fit (proposed)',
          value:
            'd = 3.4 g: −26 % at TG0 200; d = 2 g: −13.5 %; d = 4 g: −31 %; 0.85 g about 0 (−3 % predicted)',
          note: 'The large dose-response analysis is about 50 % steeper at 2 g/day than the conservative fit. Other changes with EPA + DHA: HDL about +1.5 mg/dL and LDL about +3 mg/dL per 2 g/day.',
        },
      ],
      timeCourse:
        'The effect is generally established by 2–4 weeks; the engine uses a time constant of 14 days (unverified).',
      moderators: 'Baseline TG (proportional), BMI and insulin resistance (stronger effect at higher BMI).',
      grade: 'A',
      gradeReason:
        'A large dose-response meta-analysis and several others agree on the mean; the shape below 1 g/day and in normal lipids is graded B.',
      status: 'proposed-fit',
      caveats:
        'The meta-analyses conflict on the slope: −43 mg/dL at 2 g/day in one, −27 to −30 mg/dL at about 3.25 g/day in others. Two settings are provided.',
      referenceIds: ['wang2023', 'skulasray2011', 'eslick2009', 'balk2006', 'skulasray2019'],
      relatedMetricIds: ['triglycerides'],
    },
    {
      id: '06-carb-restriction-triglycerides',
      title: 'Triglycerides fall fast on very low carbohydrate or energy',
      category: 'cardio',
      summary:
        'Triglycerides drop within days of very low carbohydrate or very low energy intake. The liver stops converting sugar to fat within about a day. In one trial they halved within the first week of a 600 kcal-a-day diet. At the same weight loss, very-low-carbohydrate eating cut fasting triglycerides more than the other diets tested.',
      howModelled:
        'While the user is in ketosis, the engine applies an extra multiplier on triglycerides, exp(−0.35 × ketosis state), with a time constant of 4 days. Together with the weight-loss term it reproduces the trial results.',
      equation: `TG multiplier = exp(−0.35 · s_keto),   time constant 4 days`,
      keyNumbers: [
        {
          label: '600 kcal a day in type 2 diabetes',
          value: 'TG 2.4 → 1.2 mmol/L within week 1, with −3.9 kg',
          referenceIds: ['lim2011'],
        },
        {
          label:
            'Isocaloric diet (3115 kcal a day) under 30 g carbohydrate for 14 days (10 adults with fatty liver)',
          value: 'Plasma TG −48 %; VLDL-TG −57 %; de novo lipogenesis −80 %',
          referenceIds: ['mardinoglu2018'],
        },
        {
          label:
            'Matched 10.5 % weight loss in 42 adults with BMI 39 (very-low-carbohydrate versus Mediterranean-style versus very-low-fat)',
          value: 'Fasting TG −45 % / −24 % / −14 %; 24-hour TG −23 % / −23 % / −17 %',
          referenceIds: ['petersen2026'],
        },
        {
          label: 'Check of the multiplier',
          value: 'exp(−0.35) = 0.70',
          note: 'Proposed fit. With the weight-loss term it reproduces −45 % on the very-low-carbohydrate diet against −14 to −24 % on the others at equal weight loss, and the −48 % isocaloric result.',
        },
      ],
      timeCourse:
        'Significant changes appear within days; the time constant is 4 days, and triglycerides return on the same time scale when carbohydrate does.',
      moderators: 'Ketosis state, baseline TG and weight loss.',
      grade: 'B',
      gradeReason:
        "Several controlled studies agree, but the multiplier is fitted to a few of them (Vitals' evidence review gives B/C).",
      status: 'proposed-fit',
      caveats: 'The multiplier is a fit to three studies of quite different design.',
      referenceIds: ['lim2011', 'mardinoglu2018', 'petersen2026'],
      relatedMetricIds: ['triglycerides'],
    },
    {
      id: '06-hdl-responses',
      title: 'What moves HDL cholesterol',
      category: 'cardio',
      summary:
        'HDL cholesterol rises with fat in place of carbohydrate, with aerobic training, with alcohol and with EPA and DHA. It dips while weight is being lost and rises above baseline once weight is stable. It is 10 mg/dL higher in women and falls with BMI.',
      howModelled:
        'Each driver adds a steady-state shift to HDL. Diet effects have a time constant of 10 days and exercise and weight effects 30 days. The weight-stable rise builds over 4–8 weeks after weight stabilises.',
      keyNumbers: [
        {
          label: 'Carbohydrate → saturated, monounsaturated, polyunsaturated fat, per 1 % of energy',
          value: '+0.43 / +0.31 / +0.23 mg/dL (+0.011 / +0.008 / +0.006 mmol/L)',
          referenceIds: ['mensink2016'],
        },
        {
          label: 'Carbohydrate → 12:0 / 14:0 / 16:0 / 18:0 / trans, per 1 % of energy',
          value: '+1.04 / +0.70 / +0.39 / +0.08 (not significant) / 0.0 mg/dL',
          referenceIds: ['mensink2003'],
        },
        {
          label: 'Protein for carbohydrate',
          value: '−0.13 mg/dL per % of energy (−1.3 mg/dL for 10 %)',
          referenceIds: ['appel2005'],
        },
        {
          label: 'Alcohol, 30 g/day',
          value: '+3.99 mg/dL (3.25, 4.73); ApoA-I +8.8 mg/dL',
          referenceIds: ['rimm1999'],
        },
        {
          label: 'Aerobic training (4 weeks or more)',
          value:
            '+0.05 mmol/L (+1.9 mg/dL) in one meta-analysis; +2.53 mg/dL (P < 0.001, 25 trials) in another',
          note: 'Minimal volume about 900 kcal a week (120 min/week). +1.4 mg/dL per additional 10 minutes per session. Larger if BMI is under 28 and TC is 220 or more (extra +2.1 mg/dL). Intensity and frequency were not significant.',
          referenceIds: ['halbert1999', 'kodama2007'],
        },
        {
          label: 'Resistance training',
          value: '+0.7 mg/dL (not significant)',
          referenceIds: ['kelley2009'],
        },
        {
          label: 'Weight loss (70 studies)',
          value:
            '−0.007 mmol/L (−0.27 mg/dL) per kg while actively losing; +0.009 mmol/L (+0.35 mg/dL) per kg lost once weight is stable',
          note: 'Consistent with the cross-sectional fall of 0.70 mg/dL per BMI unit (about +1.1 mg/dL per BMI unit after stable weight loss).',
          referenceIds: ['dattilo1992'],
        },
        {
          label: 'EPA + DHA',
          value: '+1.6 mg/dL (fish oil, 21 trials); +3.5 mg/dL at about 1.75 g/day (spline)',
          referenceIds: ['balk2006', 'wang2023'],
        },
        {
          label: 'Low-carbohydrate versus low-fat diets, 6–12 months or more',
          value:
            '+3.3 mg/dL; +0.09 mmol/L; +0.14 mmol/L; +0.05 mmol/L in four meta-analyses; +2.6 versus +0.4 mg/dL in the DIETFITS trial; +2 versus −2 and −4 mg/dL in the matched-weight-loss trial',
          referenceIds: ['hu2012', 'bueno2013', 'mansoor2016', 'chawla2020', 'gardner2018', 'petersen2026'],
        },
        {
          label: 'Dietary cholesterol, +100 mg/day',
          value: '+0.008 mmol/L (+0.3 mg/dL)',
          referenceIds: ['weggemans2001'],
        },
        {
          label: 'Soy',
          value: '+1.4 mg/dL',
          referenceIds: ['tokede2015'],
        },
        {
          label: 'Fifteen days of inactivity in trained people',
          value:
            'LDL, LDL particle number and small dense LDL rose; HDL gains in the high-volume group persisted for 15 days',
          referenceIds: ['slentz2007'],
        },
      ],
      timeCourse:
        'Diet effects settle with a time constant of 10 days, exercise and weight effects in about 30 days. The weight-stable rise takes 4–8 weeks after stabilisation (proposed).',
      moderators:
        'Sex (women about 10 mg/dL higher), BMI (−0.70 mg/dL per BMI unit), whether weight is falling or stable, alcohol, training and diet composition.',
      grade: 'A',
      gradeReason:
        'The responses come from several large meta-analyses (Mensink, Kodama, Dattilo and others).',
      status: 'established',
      caveats:
        'The timing of the weight-stable component is a proposal: the source separates active from stable loss but reports no kinetics.',
      referenceIds: [
        'mensink2016',
        'mensink2003',
        'appel2005',
        'rimm1999',
        'halbert1999',
        'kodama2007',
        'kelley2009',
        'dattilo1992',
        'balk2006',
        'wang2023',
        'hu2012',
        'bueno2013',
        'mansoor2016',
        'chawla2020',
        'gardner2018',
        'petersen2026',
        'weggemans2001',
        'tokede2015',
        'slentz2007',
      ],
      relatedMetricIds: ['hdl'],
    },
    {
      id: '06-hdl-weak-causal-target',
      title: 'Why raising HDL is a weak goal',
      category: 'cardio',
      summary:
        'People with higher HDL cholesterol tend to have less heart disease, but genetic studies suggest that raising HDL itself does not lower the risk. Particle-count measures such as ApoB track the risk more closely. For this reason the app shows HDL as a descriptive number and does not offer it as a planner goal.',
      howModelled:
        'HDL and the total-to-HDL ratio are shown with low weight. ApoB and non-HDL cholesterol are the lipid goal measures.',
      keyNumbers: [
        {
          label: 'A gene variant that raised HDL by 0.14 mmol/L',
          value: 'Predicted heart-attack odds ratio 0.87, but observed 0.99 (0.88, 1.11)',
          referenceIds: ['voight2012'],
        },
        {
          label: 'A 14-variant score for HDL alone, per 1 SD higher HDL',
          value: 'Heart-attack odds ratio 0.93 (0.68, 1.26); the LDL score gave 2.13 (1.69, 2.69) per SD',
          referenceIds: ['voight2012'],
        },
        {
          label: 'ApoB mendelian randomisation (654,783 people)',
          value:
            'Risk per 10 mg/dL lower ApoB-containing particles is the same through variants that lower triglycerides or LDL (odds ratio 0.77 for both)',
          note: 'After adjusting for ApoB, triglycerides and LDL cholesterol lose their association.',
          referenceIds: ['ference2019'],
        },
      ],
      moderators:
        'The observational HDL association is plausibly confounded by insulin sensitivity, triglycerides, BMI and alcohol.',
      grade: 'B',
      gradeReason:
        'Mendelian randomisation with two independent genetic instruments; concordance with HDL-raising drug trials was not checked and is not cited.',
      status: 'established',
      caveats:
        'Genetic evidence is indirect. No trials of HDL-raising drugs are cited here, so the argument rests on genetic data alone.',
      referenceIds: ['voight2012', 'ference2019'],
      relatedMetricIds: ['hdl', 'apoB'],
    },
    {
      id: '06-weight-loss-coefficients',
      title: 'Per-kilogram effects of weight change on each marker',
      category: 'body',
      summary:
        "Losing fat, and especially fat in the liver and around the organs, improves insulin sensitivity, lowers the liver's output of triglyceride-rich particles, and lowers blood pressure. Blood pressure, triglycerides, glucose, insulin and liver fat respond much more than LDL does. The coefficients below apply once weight is stable, and a separate entry covers the extra effects of an energy deficit itself.",
      howModelled:
        'Every weight-related effect is a per-kilogram (or per-percent) coefficient acting on a fat-mass state that lags with the fat-mass time constant from the body-weight model, or 30–45 days if that is unavailable.',
      equation: `b_FPG = clip(0.7 + 2.3·(FPG0 − 100)/53, 0.5, 3.5)  mg/dL per kg
ln INS: −0.030 per 1 % of weight lost
ln IHTG: −0.075 per 1 % of weight lost
ln CRP: −0.07 per BMI unit lost, full slope only for weight loss beyond about 8 %, 30 % of the slope below`,
      keyNumbers: [
        {
          label: 'Blood pressure',
          value: 'SBP −1.05 and DBP −0.92 mmHg per kg lost',
          note: 'Grade A. The diastolic response is larger in populations on antihypertensives (−5.3 versus −2.9 mmHg per study).',
          referenceIds: ['neter2003'],
        },
        {
          label: 'LDL cholesterol',
          value:
            '−0.6 mg/dL per kg (range 0 to −1.3); zero in a lean responder to very-low-carbohydrate eating',
          note: 'Grade B/C.',
          referenceIds: ['poobalan2004', 'zomer2016', 'wing2011', 'gardner2018', 'petersen2026'],
        },
        {
          label: 'HDL cholesterol',
          value:
            '+0.35 mg/dL per kg once weight is stable; −0.27 mg/dL per kg while the rate of loss exceeds 0.25 % a week',
          referenceIds: ['dattilo1992'],
        },
        {
          label: 'Triglycerides',
          value: 'ln TG −0.015 per kg (BMI 25–30), −0.020 per kg (BMI 30 or more)',
          referenceIds: ['magkos2016', 'zomer2016', 'wing2011'],
        },
        {
          label: 'Fasting glucose',
          value: '−0.7 mg/dL per kg near FPG 100, rising linearly to −3.0 mg/dL per kg near FPG 150',
          referenceIds: ['gardner2018', 'magkos2016', 'wing2011'],
        },
        {
          label: 'HbA1c',
          value: '−0.08 % per kg in type 2 diabetes; about −0.02 % per kg in non-diabetic adults',
          referenceIds: ['wing2011', 'zomer2016', 'petersen2026'],
        },
        {
          label: 'Fasting insulin',
          value: 'ln INS −0.030 per 1 % of weight lost (−15 %, −31 %, −48 % at 5, 11, 16 % loss)',
          referenceIds: ['magkos2016', 'gardner2018'],
        },
        {
          label: 'hs-CRP',
          value:
            'ln CRP −0.07 per BMI unit lost (about −0.023 per kg at 1.75 m), with a threshold: full slope only beyond about 8 % weight loss',
          note: 'Grade B/C. In one trial CRP did not change at 5 % and 11 % loss and fell 33 % at 16 %.',
          referenceIds: ['selvin2007', 'magkos2016'],
        },
        {
          label: 'Liver fat, liver enzyme and visceral fat',
          value:
            'ln IHTG −0.075 per 1 % of weight lost; ln ALT with an elasticity of 0.5 against liver fat; visceral fat change = about 1.2 × the change in fat mass',
          referenceIds: ['magkos2016'],
        },
        {
          label: 'Uric acid',
          value: '−0.06 mg/dL per kg (range −0.02 to −0.22)',
          note: 'Very rapid loss or ketosis can transiently raise it.',
          referenceIds: ['dessein2000', 'nielsen2017'],
        },
        {
          label: 'Meta-analysis of 25 trials of weight loss (n = 4874)',
          value:
            '−5.1 kg (95 % CI −6.03, −4.25) gave SBP −4.44 (−5.93, −2.95) and DBP −3.57 (−4.88, −2.25) mmHg; per kg SBP −1.05 (−1.43, −0.66) and DBP −0.92 (−1.28, −0.55)',
          note: 'Loss over 5 kg: −6.63/−5.12 mmHg; 5 kg or less: −2.70/−2.01.',
          referenceIds: ['neter2003'],
        },
        {
          label: 'Meta-analysis of 83 trials, 6–12 months',
          value:
            'SBP −2.68 (−3.37, −2.11); DBP −1.34; LDL −0.20 mmol/L (−0.29, −0.10) [−7.7 mg/dL]; TG −0.13 mmol/L (−0.22, −0.03) [−11.5 mg/dL]; fasting glucose −0.32 mmol/L [−5.8 mg/dL]; HbA1c −0.40 % (−0.52, −0.28)',
          note: 'Mostly persistent at 2 years. The mean weight loss was not visible in the abstract (unverified).',
          referenceIds: ['zomer2016'],
        },
        {
          label: 'Long-term studies (13 studies, BMI 28 or more, over 2 years)',
          value: 'TC falls 0.23 mmol/L per 10 kg lost (r = 0.89 across studies)',
          referenceIds: ['poobalan2004'],
        },
        {
          label: 'Look AHEAD (n = 5145, type 2 diabetes, 1 year)',
          value:
            'Weight −4.77 kg: SBP −4.8, DBP −2.4 mmHg, glucose −14.3 mg/dL, HbA1c −0.39 %, HDL +2.4, LDL −5.5 (unrelated to weight loss; statins), TG median −12 mg/dL',
          note: 'Graded improvements across weight-loss groups of −3.5, −7.25, −12.1 and −21.3 kg. A loss of 5–10 % gave odds of 3.5 for an HbA1c drop of 0.5 % or more and 2.2 for a TG drop of 40 mg/dL or more.',
          referenceIds: ['wing2011'],
        },
        {
          label: 'Weight-stable trial in BMI about 40 (at −5.1, −10.8 and −16.4 % weight)',
          value:
            'Fat mass 50.3 → 45.4 → 41.1 → 36.9 kg; intra-abdominal fat 1656 → 1501 → 1277 → 1154 cm³; liver fat 8.5 → 7.4 → 4.1 → 3.0 %; insulin 18.3 → 15.5 → 12.6 → 9.5 µU/mL; TG 153 → 130 → 110 → 97 mg/dL; ALT 18 → 15 → 11 → 11 U/L; CRP 4.69 → 4.74 → 5.47 → 3.14 mg/L; LDL 115 → 98 → 101 → 91 and HDL 43 → 41 → 42 → 44 mg/dL (not significant); glucose 92.7 → 89.4 → 89.3 → 88.6 mg/dL (not significant)',
          note: 'Nine completers. Only the 16 % step was significant for CRP. Leptin 43 → 18.6; adiponectin rose only at 16 %.',
          referenceIds: ['magkos2016'],
        },
        {
          label: 'Matched weight loss of about 10.5 % (BMI 38.9)',
          value:
            'Fasting insulin 27.7 → 13.1 (very-low-carbohydrate) versus 27.1 → 17.0 and 28.2 → 17.9; HOMA-IR 6.7 → 2.8 versus 6.8 → 4.1 and 6.8 → 4.0; HbA1c 5.6 → 5.0 versus 5.4 → 5.3 and 5.7 → 5.3; SBP −5 to −11 mmHg; LDL −8 to −22 mg/dL',
          referenceIds: ['petersen2026'],
        },
        {
          label: 'CRP across 33 studies',
          value:
            'Each 1 kg lost lowered CRP by 0.13 mg/L across all interventions including surgery (r = 0.85); in lifestyle-only studies the slope was 0.06 mg/L per kg (r = 0.30)',
          referenceIds: ['selvin2007'],
        },
        {
          label: 'Twelve-month diet trial (−5.3 low-fat, −6.0 kg low-carbohydrate)',
          value:
            'Glucose −3.7 / −2.1 mg/dL; insulin −2.6 / −2.3 µU/mL; SBP −3.2 / −3.7; DBP −1.9 / −2.6; LDL −2.1 / +3.6; TG −10 / −28; HDL +0.4 / +2.6',
          referenceIds: ['gardner2018'],
        },
        {
          label: 'Association of weight loss with lipids across 70 studies',
          value: 'Weight loss correlated with TC (r = 0.32), LDL (0.29), VLDL-C (0.38) and TG (0.32)',
          referenceIds: ['dattilo1992'],
        },
      ],
      timeCourse:
        'Effects follow the fat-mass state. If the fat-mass time constant is unavailable, the engine uses 30–45 days.',
      moderators:
        'Baseline level (for example glucose and TG), diabetes status, blood pressure treatment, and whether weight is still falling or stable.',
      grade: 'B',
      gradeReason:
        'Blood pressure and HDL coefficients are graded A and the others B or C; the table as a whole is graded B.',
      status: 'proposed-fit',
      caveats:
        "Several per-kg values combine mixed studies. Zomer's mean weight loss was not visible in the abstract. Look AHEAD is people with diabetes, many on statins. The uric acid figures come partly from 13 people with gout. The CRP threshold rests on one trial with 9 completers at the 16 % step.",
      referenceIds: [
        'neter2003',
        'poobalan2004',
        'zomer2016',
        'wing2011',
        'gardner2018',
        'petersen2026',
        'dattilo1992',
        'magkos2016',
        'selvin2007',
        'dessein2000',
        'nielsen2017',
      ],
      relatedMetricIds: ['ldl', 'triglycerides', 'sbp', 'fastingGlucose'],
    },
    {
      id: '06-energy-deficit-acute-effects',
      title: 'Effects of an energy deficit itself, before weight is lost',
      category: 'cardio',
      summary:
        'During an energy deficit, triglycerides, glucose, insulin and liver fat fall within days, before much weight is lost. HDL dips, uric acid can rise, and LDL may rise on high-fat diets. After the first month, the slower effect of the lost fat mass dominates.',
      howModelled:
        'Each weight-related effect is split into an acute deficit state and a fat-mass state. The acute part has a time constant of 3–7 days and is active only when the deficit exceeds 20 % of energy needs. Its size grows with the deficit beyond that.',
      equation: `Deficit D_def = 1 − EI/EE, active only when D_def > 0.2
acute amplitudes:
ln TG: −0.6·(D_def − 0.2)⁺
FPG (type 2 diabetes only): −0.3·(FPG0 − 100)·(D_def − 0.2)⁺/0.5 mg/dL
ln INS: −0.8·(D_def − 0.2)⁺
ln IHTG: −0.9·(D_def − 0.2)⁺`,
      keyNumbers: [
        {
          label: '600 kcal a day for 1 week in type 2 diabetes (−3.9 kg, 61 % fat)',
          value: 'Fasting glucose 9.2 → 5.9 mmol/L; TG halved (2.4 → 1.2 mmol/L); liver fat −30 %',
          referenceIds: ['lim2011'],
        },
        {
          label: '48 hours of energy restriction',
          value: 'Liver fat falls by 9–30 %',
          referenceIds: ['kirk2009'],
        },
        {
          label: 'HDL during active loss',
          value: '−0.27 mg/dL per kg while losing, then +0.35 mg/dL per kg once stable',
          referenceIds: ['dattilo1992'],
        },
        {
          label: 'Other transient effects',
          value:
            'LDL: no consistent transient, though very-low-carbohydrate diets can raise it in lean people; blood pressure falls even during active loss; CRP shows a threshold; uric acid can rise transiently after bariatric surgery or very rapid loss',
          note: 'Weight regain reverses each component with the same time constants. There is no evidence of hysteresis except that HDL and liver-fat benefits are lost within weeks of overfeeding.',
          referenceIds: ['nielsen2017'],
        },
      ],
      timeCourse:
        'Acute effects have time constants of 3–7 days and are active while the deficit exceeds 20 % of energy needs. After the first month the fat-mass state dominates.',
      moderators:
        'Depth of the energy deficit (the fraction below needs), diabetes status for glucose, and baseline glucose.',
      grade: 'C',
      gradeReason:
        'The acute amplitudes are proposed from a few small studies, mostly one in type 2 diabetes.',
      status: 'proposed-fit',
      caveats:
        'The acute amplitudes are proposed and graded C. The liver-fat amplitude comes from one study with a −30 % fall in week 1 at a deficit of about 75 %.',
      referenceIds: ['lim2011', 'kirk2009', 'dattilo1992', 'nielsen2017'],
      relatedMetricIds: ['triglycerides', 'fastingGlucose', 'liverFat'],
    },
    {
      id: '06-bp-sodium',
      title: 'Sodium and blood pressure',
      category: 'cardio',
      summary:
        'Eating less sodium lowers blood pressure in a nearly straight-line way across the whole range studied, with no flattening. The effect is about 2.8 times larger in people with high blood pressure than in people with normal blood pressure. People differ a lot in how salt-sensitive they are. The full effect builds over roughly 4–12 weeks.',
      howModelled:
        'The blood-pressure effect per gram of sodium rises smoothly with starting systolic pressure. Normotensive people with starting pressure below 130 mmHg are given no measurable effect below 2 g/day. The effect is reduced by up to 55 % on a fully DASH-style pattern, scaled by a personal salt-sensitivity multiplier, and lagged with a time constant of 21 days.',
      equation: `β_Na,SBP = 1.0 + 1.8 · sigmoid((SBP0 − 135)/8)      [mmHg per g sodium; 1.3 at SBP0 = 122; 2.4 at 145]
β_Na,DBP = 0.42 · β_Na,SBP
Na_eff = max(Na, 2.0) if SBP0 < 130, otherwise Na
dSBP_Na* = m_Na · β_Na,SBP · (Na_eff − Na_base) · (1 − 0.55·DASH_fraction)`,
      keyNumbers: [
        {
          label:
            'Dose-response of 85 trials (sodium 0.4–7.6 g/day, 4 weeks or more), per 100 mmol/day (2.3 g sodium, 5.8 g salt) lower sodium',
          value:
            'SBP −5.56 mmHg (−4.52, −6.59); DBP −2.33 (−1.66, −3.00) overall. Normotensive SBP −2.30 (−1.33, −3.27), DBP −0.80; hypertensive SBP −6.50 (−5.22, −7.79), DBP −3.00',
          note: 'Approximately linear with no flattening. Trials of dietary change gave steeper effects than sodium-supplementation trials (−4.47/−1.90). Women were steeper than men. At 6 g/day versus 2 g/day, SBP was +3.99 (0.80, 7.18) mmHg in normotensives and +10.31 (7.86, 12.75) in hypertensives. There was little effect in normotensives below 2 g/day.',
          referenceIds: ['filippini2021'],
        },
        {
          label: 'Cochrane review of 34 trials (3230 people, 4 weeks or more)',
          value:
            'A fall of 75 mmol/24 h gave SBP −4.18, DBP −2.06; per 100 mmol, SBP −5.8 mmHg (2.5, 9.2); hypertensive −5.39/−2.82; normotensive −2.42/−1.00',
          note: 'Renin rose by 0.26 ng/mL/h, aldosterone by 73 pmol/L and noradrenaline also rose. There was no significant lipid change.',
          referenceIds: ['he2013'],
        },
        {
          label: 'Cochrane review of 185 studies, sodium from 201 to 66 mmol/day',
          value:
            'SBP/DBP −1.1/0 (white normotensives); −5.5/−2.9 (white hypertensives); Black hypertensives −6.6/−2.9; Asian hypertensives −7.8/−2.7',
          note: 'Renin +55 %, aldosterone +127 %, cholesterol +2.9 % and TG +6.3 % (the lipid signal is contested).',
          referenceIds: ['graudal2017'],
        },
        {
          label: 'Summary per gram of sodium',
          value:
            'SBP −2.4 mmHg per g overall, −1.0 in normotensives, −2.8 in hypertensives; DBP −1.0, −0.35 and −1.3',
          referenceIds: ['filippini2021'],
        },
        {
          label: 'Salt sensitivity',
          value:
            'Response correlated with baseline pressure (r = 0.61) and with initial sodium excretion (r = 0.27); hypertensives more often sensitive (P < 0.001)',
          note: 'Sodium-sensitive people were older, with lower renin and higher baseline pressure. The commonly quoted prevalence of about 25 % in normotensives and about 50 % in hypertensives is unverified here. The model uses a multiplier m_Na ~ lognormal(0, 0.6) with mean one; the sigma is unverified and between-trial heterogeneity was 68–75 %.',
          referenceIds: ['weinberger1986', 'elijovich2016'],
        },
        {
          label: 'Time course (412 adults, 4-week periods, weekly blood pressure)',
          value:
            'On the control diet, high sodium gave no change (−0.04/+0.06 mmHg per week) while low sodium fell −0.94/−0.70 mmHg per week with no plateau at 4 weeks; on DASH, low sodium fell −0.42/−0.54 per week',
          note: 'Another analysis found no difference between trials of 4–11 weeks and 12 weeks or more, so the full effect arrives within about 4–12 weeks. The 21-day time constant is proposed.',
          referenceIds: ['juraschek2017', 'filippini2021'],
        },
      ],
      timeCourse:
        'Blood pressure keeps falling for at least 4 weeks after a sodium cut, with no plateau seen at 4 weeks in the time-course trial. The full effect arrives within 4–12 weeks; the engine uses a time constant of 21 days.',
      moderators:
        'Starting blood pressure, hypertension (effect about 2.8 times larger), sex (women steeper than men), salt sensitivity (older, lower renin), DASH-style pattern (halves the sodium slope), ethnicity and how the sodium is changed.',
      grade: 'A',
      gradeReason: 'Several large meta-analyses of controlled trials agree on the dose-response.',
      status: 'proposed-fit',
      caveats:
        'The equation is a proposed fit. Benefits below 2 g/day in normotensives are unproven. Very low sodium raises renin, aldosterone and noradrenaline, and the lipid effect of low sodium is contested.',
      referenceIds: [
        'filippini2021',
        'he2013',
        'graudal2017',
        'weinberger1986',
        'elijovich2016',
        'juraschek2017',
      ],
      relatedMetricIds: ['sbp'],
    },
    {
      id: '06-bp-dash-pattern',
      title: 'The DASH eating pattern and blood pressure',
      category: 'cardio',
      summary:
        'A pattern rich in fruit, vegetables and low-fat dairy, called DASH, lowered blood pressure in controlled feeding trials, with weight and sodium held constant. Most of the effect appeared within the first week. DASH roughly halves the blood-pressure slope for sodium.',
      howModelled:
        'The engine takes a DASH-likeness fraction from 0 to 1 and subtracts a systolic effect that grows with starting pressure. Systolic pressure responds with a 4-day time constant and diastolic with about 16 days.',
      equation: `dSBP_DASH* = −(3.5 + 8.0·sigmoid((SBP0 − 135)/8)) · DASH_fraction
dDBP_DASH* = −(2.1 + 3.4·sigmoid((SBP0 − 135)/8)) · DASH_fraction
τ_DASH,SBP = 4 days;  τ_DASH,DBP = 7/−ln(1 − 0.36) = 16 days
Protein and unsaturated fat: dSBP = −0.14 per % of energy protein; −0.13 per % of energy monounsaturated fat`,
      keyNumbers: [
        {
          label: 'DASH trial (459 adults, 8 weeks, weight and sodium constant)',
          value:
            'Combination diet −5.5/−3.0 mmHg against control (hypertensives −11.4/−5.5; normotensives −3.5/−2.1); fruit-and-vegetable diet −2.8/−1.1',
          referenceIds: ['appel1997'],
        },
        {
          label: 'DASH-Sodium (412 adults, 30-day periods)',
          value:
            'Control diet, high to intermediate sodium −2.1 mmHg, intermediate to low −4.6 (total −6.7); DASH diet −1.3 and −1.7 (total −3.0); DASH at low sodium against control at high sodium −7.1 (normotensive) and −11.5 mmHg (hypertensive)',
          note: 'So DASH roughly halves the sodium slope (3.0/6.7 = 0.45).',
          referenceIds: ['sacks2001'],
        },
        {
          label: 'Time course of the DASH effect',
          value: 'SBP/DBP −4.36/−1.07 mmHg by week 1, with no further weekly change',
          note: 'Diastolic pressure reached only 36 % of its effect by week 1, which gives the 16-day time constant.',
          referenceIds: ['juraschek2017'],
        },
        {
          label: 'Protein-rich and monounsaturated-rich DASH-like diets, against a carbohydrate-rich one',
          value: 'A further SBP −1.4 and −1.3 mmHg (−3.5 and −2.9 in hypertensives)',
          referenceIds: ['appel2005'],
        },
      ],
      timeCourse:
        'Most of the systolic effect appears in the first week, and diastolic pressure follows more slowly.',
      moderators: 'Starting blood pressure (larger effect in hypertensives) and sodium intake.',
      grade: 'A',
      gradeReason: 'Two large controlled feeding trials and a time-course analysis agree.',
      status: 'proposed-fit',
      caveats:
        'The sigmoid amplitudes are proposed fits. The DASH-fraction scale, from 0 to 1, is an engine convention.',
      referenceIds: ['appel1997', 'sacks2001', 'juraschek2017', 'appel2005'],
      relatedMetricIds: ['sbp'],
    },
    {
      id: '06-bp-potassium',
      title: 'Potassium and blood pressure',
      category: 'cardio',
      summary:
        'More potassium in the diet lowers blood pressure in people with high blood pressure, but not clearly in people with normal blood pressure. The dose-response is U-shaped: pressure falls with a moderate increase and stops falling, then rises, at very high net intakes. The effect is stronger when sodium intake is higher.',
      howModelled:
        'Systolic pressure falls by 0.08 mmHg per mmol of extra potassium up to 40 mmol, scaled by how hypertensive the person is and by 0.4 when sodium is under 3 g/day. The effect is zero beyond an extra 80 mmol/day.',
      equation: `dSBP_K* = −0.08 · min(dK_mmol, 40) · hyper_factor(SBP0) · (Na_base ≥ 3 g/day ? 1 : 0.4)
hyper_factor = 1.0 for SBP0 ≥ 140, falling to 0.4 for normotensives;  effect 0 beyond +80 mmol/day (U-shape)
time constant 21 days (unverified)`,
      keyNumbers: [
        {
          label: 'Meta-analysis of 22 trials (1606 people)',
          value: 'SBP −3.49 mmHg (−5.15, −1.82); DBP −1.96',
          note: 'In hypertensives but not normotensives. The effect was largest at 90–120 mmol/day, without a dose-response.',
          referenceIds: ['aburto2013'],
        },
        {
          label: 'Dose-response meta-analysis of 32 trials',
          value:
            'U-shaped: blood pressure falls with supplementation up to about 30 mmol/day of net increase in urinary potassium, weakens above that, and rises above about 80 mmol/day net. Pooled SBP −3.9 (−5.2, −2.6); DBP −2.4 (−3.8, −1.1)',
          note: 'The effect was stronger with hypertension and with higher sodium intake, and much weaker below 3 g/day of sodium.',
          referenceIds: ['filippini2020'],
        },
      ],
      timeCourse: 'The engine uses a time constant of 21 days (unverified).',
      moderators:
        'Hypertension status (larger effect), sodium intake (larger effect at higher intake) and net potassium intake (U-shape).',
      grade: 'B',
      gradeReason:
        'Two meta-analyses agree on the direction, but the shape and the effect in normotensives are less certain.',
      status: 'proposed-fit',
      caveats: 'The equation is a proposed fit. The time constant is unverified.',
      referenceIds: ['aburto2013', 'filippini2020'],
      relatedMetricIds: ['sbp'],
    },
    {
      id: '06-bp-exercise',
      title: 'Exercise training and blood pressure',
      category: 'cardio',
      summary:
        'Regular endurance exercise lowers blood pressure by about 3.5/2.5 mmHg on average. The fall is far larger in people who start with high blood pressure. Resistance and isometric training also lower it. A single session lowers pressure for hours.',
      howModelled:
        'Endurance exercise lowers systolic pressure by an amount that grows with starting pressure and with minutes per week, up to 150 minutes. Resistance training works the same way with sets per week up to 12. Isometric work is an optional extra. The time constant is 30 days.',
      equation: `dSBP_ex* (endurance) = −(0.75 + 7.5·sigmoid((SBP0 − 135)/8)) · min(1, aerobic minutes per week/150)
dSBP_ex* (resistance) = −(0.5 + 5.5·sigmoid(…)) · min(1, sets per week/12)
isometric: optional −5 (unverified shrinkage of −10.9)`,
      keyNumbers: [
        {
          label: 'Meta-analysis of 93 trials (5223 people, 4 weeks or more)',
          value:
            'Endurance SBP −3.5 (−4.6, −2.3), DBP −2.5; dynamic resistance −1.8 (−3.7, −0.01) / −3.2 (−4.5, −2.0); isometric −10.9 (−14.5, −7.4) / −6.2 (5 groups, small studies); combined training SBP not significant, DBP −2.2',
          referenceIds: ['cornelissen2013'],
        },
        {
          label: 'Endurance training by starting blood pressure',
          value: 'Hypertensive −8.3/−5.2; prehypertensive −2.1/−1.7; normotensive −0.75/−1.1 mmHg',
          note: 'Resistance training was largest in prehypertensive people (−4.0/−3.8).',
          referenceIds: ['cornelissen2013'],
        },
        {
          label: 'Dynamic resistance training (64 studies)',
          value:
            '−3.0/−2.1 mmHg overall; about 6/5 in hypertensives, about 3/3 in prehypertensives, about 0/1 in normal',
          referenceIds: ['macdonald2016'],
        },
        {
          label: 'One session of exercise',
          value: 'SBP/DBP −4.8/−3.2 mmHg for hours (up to about 22 h)',
          referenceIds: ['pescatello2004', 'carpiorivera2016'],
        },
        {
          label: 'Stopping training',
          value: 'Lipid gains were lost within 7 weeks',
          note: 'Blood-pressure detraining kinetics are unverified; the engine uses a time constant of 21 days (unverified).',
          referenceIds: ['avilagandia2023'],
        },
      ],
      timeCourse:
        'The effect builds over 4–12 weeks (trials ran 4 weeks or more). The engine uses a 30-day time constant, and 21 days for detraining (unverified).',
      moderators:
        'Starting blood pressure (much larger in hypertensives), type of exercise, and weekly volume.',
      grade: 'A',
      gradeReason: 'Large meta-analyses of controlled trials agree on direction and size.',
      status: 'proposed-fit',
      caveats:
        'The equations are proposed fits. The isometric estimate comes from small studies and is shrunk in the engine.',
      referenceIds: [
        'cornelissen2013',
        'macdonald2016',
        'pescatello2004',
        'carpiorivera2016',
        'avilagandia2023',
      ],
      relatedMetricIds: ['sbp'],
    },
    {
      id: '06-bp-alcohol-and-sugar',
      title: 'Alcohol, sugar and blood pressure',
      category: 'cardio',
      summary:
        'Cutting back on alcohol lowers blood pressure only in people who drink more than about two drinks a day, and the fall grows with the amount cut. Higher free-sugar intake raised blood pressure in trials of 8 weeks or more, but with large differences between trials.',
      howModelled:
        'Alcohol adds 0.15 mmHg systolic per gram a day above 24 g/day, lagged by 10 days (unverified). Sugar is an optional term only.',
      equation: `dSBP_alc* = +0.15 · (alcohol_g − alcohol_g_base)   for the part above 24 g/day
(from −5.5 mmHg for a 36 g/day cut from 72 g/day)`,
      keyNumbers: [
        {
          label: 'Reducing alcohol (36 trials, 2865 people)',
          value:
            'No effect in people drinking two or fewer drinks a day; above that, a dose-dependent fall. In those drinking six or more drinks a day who cut intake by about half: SBP −5.50 (−6.70, −4.30), DBP −3.97 (−4.70, −3.25) mmHg',
          referenceIds: ['roerecke2017'],
        },
        {
          label: 'Higher versus lower free-sugar intake (trials of 8 weeks or more)',
          value: 'SBP +6.9 and DBP +5.6 mmHg',
          note: 'Large heterogeneity. Grade C; optional term only.',
          referenceIds: ['temorenga2014'],
        },
      ],
      timeCourse: 'Alcohol effects use a 10-day time constant (unverified).',
      moderators: 'Baseline alcohol intake (no effect at two drinks a day or fewer) and the size of the cut.',
      grade: 'A',
      gradeReason: 'The alcohol effect at high intakes is well supported (the sugar term is graded C).',
      status: 'proposed-fit',
      caveats: 'The sugar term is optional and rests on heterogeneous trials.',
      referenceIds: ['roerecke2017', 'temorenga2014'],
      relatedMetricIds: ['sbp'],
    },
    {
      id: '06-liver-fat-restriction',
      title: 'Liver fat falls within days of eating less or cutting carbohydrate',
      category: 'cardio',
      summary:
        'Liver fat (intrahepatic triglyceride, IHTG) falls very quickly with less energy or less carbohydrate, because the liver makes less new fat from sugar within a day and burns more fat. In several trials it fell by 30–55 % within one to two weeks. At the same weight loss, very-low-carbohydrate eating cut liver fat more in the short term.',
      howModelled:
        'Liver fat is tracked on the log scale. Weight loss cuts it by 7.5 % for each 1 % of weight lost, and ketosis adds a further factor. It falls with a 12-day time constant and rises with a 21-day one. ALT, a liver enzyme, follows half of the change in log liver fat.',
      equation: `L0 = 2.0 · exp(0.11·(BMI − 22)) · exp(0.9·z_L)      [% liver fat]
ln L*_slow = ln L0 + ln f_wl + ln f_cr + ln f_ex − ln(over)
f_wl = exp(−0.075 · %WL)
f_cr = exp(−0.40 · s_keto)
acute deficit term: −0.9·(D_def − 0.2)⁺ added to ln L*
ln ALT* = ln ALT0 + 0.5·(lnL_total − lnL0), floor 11 U/L (men) or 8 U/L (women), time constant 21 days`,
      keyNumbers: [
        {
          label: 'Hypocaloric high-carbohydrate versus low-carbohydrate diet (22 obese people, BMI 36.5)',
          value:
            '48 h: −8.9 % versus −29.6 %; at about 11 weeks (−7 % weight): −44.5 % versus −38.0 %, no longer different',
          note: 'Basal glucose production −23 % (low-carbohydrate) versus −7 % at 48 h.',
          referenceIds: ['kirk2009'],
        },
        {
          label:
            '2 weeks on 1200–1500 kcal versus under 20 g carbohydrate a day (18 people with fatty liver, BMI 35)',
          value: 'Weight −4.0 versus −4.6 kg; liver fat −28 % versus −55 % (P = 0.008)',
          note: 'The fall was related to ketones (r = 0.755) and respiratory quotient (r = −0.797).',
          referenceIds: ['browning2011'],
        },
        {
          label:
            'Isocaloric (3115 kcal a day) diet under 30 g carbohydrate for 14 days (10 obese people, liver fat 16.0 %)',
          value:
            'Liver fat −43.8 % (significant at day 1, p = 0.027); weight −1.8 %; plasma TG −48.4 %; VLDL-TG −56.7 %; de novo lipogenesis −79.8 %; BHB 4.9 times higher',
          note: 'Liver fat returned toward baseline (11.3 versus 13.8 %) 1–3 months after the usual diet resumed.',
          referenceIds: ['mardinoglu2018'],
        },
        {
          label: '600 kcal a day for 8 weeks (11 people with type 2 diabetes, BMI 33.6)',
          value:
            'Weight −15.3 kg; liver fat −30 % in week 1 and 12.8 → 2.9 % (−70 %) at 8 weeks; pancreas TG 8.0 → 6.2 %',
          note: 'Liver fat stayed at 2.9 → 3.0 % 12 weeks later despite +3.1 kg regain.',
          referenceIds: ['lim2011'],
        },
        {
          label: 'About 8 kg lost on a very-low-fat diet (8 people with type 2 diabetes)',
          value: 'Liver fat −81 ± 4 % (from 12.2 %); fasting glucose 8.8 → 6.4 mmol/L',
          referenceIds: ['petersen2005'],
        },
        {
          label: 'Weight-stable after 5, 11 and 16 % weight loss (BMI about 40)',
          value:
            'Median liver fat 8.5 → 7.4 → 4.1 → 3.0 %; −40 ± 21 % at 5 % loss (mean of individual percentages)',
          referenceIds: ['magkos2016'],
        },
        {
          label: 'Matched 10.5 % weight loss (42 adults, BMI 38.9, prediabetes and fatty liver)',
          value:
            'Liver fat 19.4 → 6.2 % (−68 %, very-low-carbohydrate) versus 18.1 → 10.3 % (−43 %, Mediterranean-style) versus 17.7 → 9.6 % (−46 %, very-low-fat); P = 0.011 for the difference',
          referenceIds: ['petersen2026'],
        },
        {
          label: 'Crossover with equal energy deficit and equal fat loss',
          value:
            'Liver fat −29 % versus −20 % (45 % greater); hepatic insulin sensitivity +59 % versus +21 %; serum insulin −54 % (very-low-carbohydrate only)',
          note: 'Hepatic mitochondrial redox +51 % and TCA cycle oxidation −34 % were also seen: a possible trade-off relevant to liver injury.',
          referenceIds: ['qadri2026'],
        },
        {
          label: 'One year of lifestyle change (293 people with fatty-liver inflammation)',
          value:
            'Weight loss of 10 % or more: 90 % resolution and 45 % fibrosis regression; 5 % or more: 58 % resolution',
          referenceIds: ['vilargomez2015'],
        },
        {
          label: 'Reference values',
          value:
            'Upper limit of normal 5.56 % (95th percentile of non-obese, non-diabetic, low-alcohol people); fatty liver in 33.6 % of Dallas County adults (n = 2349)',
          note: 'The baseline equation is graded C. Its shape comes from the 5.56 % limit, about 8.5 % at BMI 40 and 8.5 % in weight-matched controls at BMI about 34.',
          referenceIds: ['szczepaniak2005', 'magkos2016', 'lim2011'],
        },
        {
          label: 'Calibration',
          value:
            'Weight-loss factor: −4.3 % weight predicts −28 % (observed −28 %); −7 % predicts −41 % (observed −38 to −44.5 %); −10.8 % predicts −56 % (observed −52 %); the very-low-fat type 2 diabetes result is under-predicted (0.55 predicted against 0.19 observed). Ketosis factor: about −0.42 on the log scale on average, −0.40 used',
          note: 'The benefit over diets that do not produce ketosis is real at 10 % weight loss but absent at 11 weeks in one trial, so its sustained size is uncertain.',
          referenceIds: ['browning2011', 'kirk2009', 'magkos2016', 'petersen2005'],
        },
      ],
      timeCourse:
        'The fall begins within 24 hours and is significant at day 1. The time constant is about 12 days (−30 % in week 1 of a very-low-calorie diet; −55 % in 14 days under 20 g carbohydrate). The benefit is lost within 1–3 months of resuming the usual diet. Weight-loss maintenance keeps it.',
      moderators:
        'PNPLA3 148M genotype, baseline liver fat (effects are proportional), insulin resistance, sex and age.',
      grade: 'A',
      gradeReason:
        'Multiple controlled human trials measured with spectroscopy agree that liver fat falls rapidly; the size of the extra carbohydrate-restriction benefit is graded B.',
      status: 'proposed-fit',
      caveats:
        'The baseline liver-fat equation is graded C. The ALT elasticity is graded C. The sustained advantage of ketosis at equal weight loss is unresolved, and the mitochondrial signal from one crossover trial is a possible trade-off.',
      referenceIds: [
        'kirk2009',
        'browning2011',
        'mardinoglu2018',
        'lim2011',
        'petersen2005',
        'magkos2016',
        'petersen2026',
        'qadri2026',
        'vilargomez2015',
        'szczepaniak2005',
      ],
      relatedMetricIds: ['liverFat'],
    },
    {
      id: '06-liver-fat-overfeeding',
      title: 'Liver fat rises within weeks of overeating, most with saturated fat',
      category: 'cardio',
      summary:
        'Eating more than needed makes liver fat rise within about three weeks. In feeding trials the order was saturated fat first, then sugar, then unsaturated fat. Liquid sugar drunk over months had a large effect. Fat in the liver falls again when the surplus stops and calories are cut.',
      howModelled:
        'A slow state, with a 120-day time constant, accumulates liver fat in proportion to the daily energy surplus, with a rate that depends on the type of surplus. The state is added to the slow liver-fat target in the log domain.',
      equation: `dD/dt = g_type · S/1000 − D/120     [S = daily energy surplus in kcal, clipped to 0–1500]
g_SFA = 0.015/day,  g_CARB(sugar) = 0.014/day,  g_UNSAT = 0.0067/day,  g_n6PUFA = 0.0/day, per 1000 kcal of surplus
ln L_total = ln L_slow + D;   g_CARB = 0.020 for liquid sugars (proposed)`,
      keyNumbers: [
        {
          label:
            '3 weeks of 1000 kcal a day of extra saturated fat, unsaturated fat or simple sugar (38 overweight people, BMI 31, liver fat 4.7 %)',
          value:
            'Liver fat +55 % (saturated), +15 % (unsaturated), +33 % (sugar, with de novo lipogenesis +98 %)',
          note: 'Saturated fat also raised fat release, insulin resistance, endotoxin in the blood and ceramides.',
          referenceIds: ['luukkonen2018'],
        },
        {
          label:
            '3 weeks of carbohydrate overfeeding (over 1000 kcal a day; 16 overweight people, BMI 30.6), then 6 months of restriction',
          value:
            'Weight +1.8 kg (+2 %), liver fat +27 % (9.2 → 11.7 %), more than 10 times the relative weight change; after −3.2 kg (4 %), liver fat −25 % (11.7 → 8.8 %)',
          note: 'De novo lipogenesis rose in proportion. The rise was seen in PNPLA3 148II carriers but not 148MM carriers.',
          referenceIds: ['sevastianova2012'],
        },
        {
          label:
            '7 weeks of muffins high in palm oil (saturated) or sunflower oil (omega-6), equal weight gain (39 young normal-weight adults)',
          value:
            'Saturated fat markedly increased liver fat and gave a twofold larger rise in visceral fat, with less lean-tissue gain (the polyunsaturated arm gained about 3 times more lean tissue)',
          referenceIds: ['rosqvist2014'],
        },
        {
          label:
            '8 weeks of overfeeding saturated versus polyunsaturated fat (61 overweight or obese; +2.3 versus +2.0 kg), then 4 weeks of restriction',
          value:
            'Saturated fat: liver fat +50 % relative, with liver enzymes and ceramides up; polyunsaturated fat: no rise in liver fat or enzymes; reversed by calorie restriction',
          referenceIds: ['rosqvist2019'],
        },
        {
          label:
            '1 L a day of sucrose cola, isocaloric milk, diet cola or water for 6 months (47 overweight people)',
          value:
            'Liver fat +132–143 % relative to the others; visceral fat +24–31 %; TG +32 %; subcutaneous fat not different',
          referenceIds: ['maersk2012'],
        },
        {
          label: 'Fructose feeding (13 trials, 260 healthy people)',
          value:
            'Isocaloric exchange: no effect. Hypercaloric (+21–35 % of energy, +104–220 g a day): liver fat SMD +0.45 (0.18, 0.72); ALT +4.9 U/L (0.03, 9.85)',
          referenceIds: ['chiu2014'],
        },
        {
          label: 'Calibration',
          value:
            'Saturated fat over 3 weeks: predicted 0.29 on the log scale (observed 0.44), sugar 0.27 (0.29), unsaturated 0.13 (0.14); the sugar-carbohydrate study predicted 0.27 (observed +27 %, 0.24); 6 months of about 424 kcal a day of liquid sugar predicted 0.55 (observed 0.87); 8 weeks of saturated fat predicted 0.50 (observed 0.41, assuming about +750 kcal a day, unverified)',
          note: 'Sugar-sweetened drinks seem to have a larger long-term effect than the fit, hence g_CARB = 0.020 for liquid sugars.',
          referenceIds: ['luukkonen2018', 'sevastianova2012', 'maersk2012', 'rosqvist2019'],
        },
      ],
      timeCourse:
        'Liver fat rises within 3 weeks of overfeeding. The slow state has a 120-day time constant, and the benefit of restraint is reversed by calorie restriction over weeks.',
      moderators:
        'Type of surplus (saturated fat greatest, omega-6 fat none), PNPLA3 genotype, baseline liver fat and energy surplus.',
      grade: 'B',
      gradeReason:
        'Two independent trial groups (n = 38 and 61) plus one of 39 support the saturated-fat-first order.',
      status: 'proposed-fit',
      caveats:
        'The state equation is a proposed fit: it under-predicts saturated fat in the 3-week trial by about 35 %, and it under-predicts the 6-month liquid-sugar study.',
      referenceIds: [
        'luukkonen2018',
        'sevastianova2012',
        'rosqvist2014',
        'rosqvist2019',
        'maersk2012',
        'chiu2014',
      ],
      relatedMetricIds: ['liverFat'],
    },
    {
      id: '06-liver-fat-exercise',
      title: 'Exercise lowers liver fat even without weight loss',
      category: 'cardio',
      summary:
        'Regular aerobic exercise lowered liver fat in small trials even when body weight did not change. In one study, 4 weeks of cycling cut liver fat by about a fifth. Trials found no clear difference between exercise doses or intensities.',
      howModelled:
        'Exercise multiplies liver fat by up to exp(−0.25), reached at 10 METs·hours a week. Resistance training counts 1.5 times per METs·hour.',
      equation: `f_ex = exp(−0.25 · min(1, METs·h per week/10))     (aerobic, no weight change; resistance counts 1.5× per METs·h)`,
      keyNumbers: [
        {
          label: '4 weeks of cycling without weight change (19 obese people)',
          value: 'Liver fat −21 %; visceral fat −12 %; fatty acids in blood −14 %; HOMA-IR unchanged',
          referenceIds: ['johnson2009'],
        },
        {
          label:
            '8 weeks, 3–4 sessions a week at different doses and intensities (48 inactive overweight people)',
          value:
            'Liver fat −2.38, −2.62 and −0.84 percentage points against +1.10 for placebo; visceral fat −258, −387 and −213 cm³ against +93',
          note: 'No significant difference between doses or intensities.',
          referenceIds: ['keating2015'],
        },
        {
          label: 'Review of 23 studies comparing aerobic and resistance exercise',
          value:
            'Effective protocols were about 40–45 minutes, 3 times a week, for 12 weeks; resistance training reached it at lower intensity and energy cost (6470 versus 11,064 kcal)',
          referenceIds: ['hashida2017'],
        },
      ],
      timeCourse: 'Effects appear within 4–8 weeks in the trials.',
      moderators: 'Baseline liver fat and training volume, without any clear dose or intensity effect.',
      grade: 'B',
      gradeReason: 'Several small randomised trials and a systematic review agree.',
      status: 'proposed-fit',
      caveats: 'The trials are small, and the equation is a proposed fit.',
      referenceIds: ['johnson2009', 'keating2015', 'hashida2017'],
      relatedMetricIds: ['liverFat'],
    },
    {
      id: '06-visceral-fat',
      title: 'Visceral fat: weight loss, exercise and food',
      category: 'body',
      summary:
        'Visceral fat is fat packed around the organs. It is lost in proportion to overall fat, slightly faster in relative terms. Exercise reduces it even when weight does not change. Very-low-calorie diets take visceral fat preferentially at first, but that fades after about 12–14 weeks. Saturated fat and sugar-sweetened drinks add more visceral fat than other surpluses.',
      howModelled:
        'Visceral fat changes by a multiple of the change in total fat mass, higher during early rapid loss. Exercise adds a small independent fall, and a low-carbohydrate diet a small extra one. This entry supplies coefficients; the fat-distribution topic owns the partition itself.',
      equation: `%dVAT_wl = k_v(%WL) · %dFM       k_v = 1.3 for %WL ≤ 5; 1.1 at 10–15 %; +0.5 during the first 28 days of a very-low-calorie diet (D_def > 0.5)
exercise: d ln VAT per week = −0.005 · min(1, METs·h per week/10), floor −0.10 in total
low-carbohydrate diet (s_keto > 0.5): extra −0.05 on the log scale at 6 months (grade C)`,
      keyNumbers: [
        {
          label: 'Review of 61 studies (98 cohorts)',
          value:
            'Percent weight loss was the only factor linked to percent change in visceral versus subcutaneous fat (r = −0.29, P = 0.005)',
          note: 'Modest weight loss takes visceral fat preferentially, less so at larger loss. Very-low-calorie diets take exceptional preferential visceral fat in under 4 weeks, gone by 12–14 weeks.',
          referenceIds: ['chaston2008'],
        },
        {
          label: 'Meta-analysis of 89 studies',
          value:
            'Absolute subcutaneous fat loss exceeds absolute visceral loss, but percent visceral loss always exceeded percent subcutaneous loss',
          note: 'No strategy (diet plus exercise, drugs, surgery) preferentially targeted visceral fat.',
          referenceIds: ['merlotti2017'],
        },
        {
          label: 'Weight-stable trial at −5, −11 and −16 % weight (BMI about 40)',
          value:
            'Intra-abdominal fat −9 %, −23 %, −30 % (MRI; 1656 → 1501 → 1277 → 1154 cm³) against total fat mass −10 %, −18 %, −27 %',
          note: 'The ratio of percent visceral to percent fat-mass change was 1.0, 1.3, 1.1.',
          referenceIds: ['magkos2016'],
        },
        {
          label: 'Exercise without weight loss versus diet (117 studies, n = 4815)',
          value: 'Exercise reduced visceral fat by 6.1 % while diet reduced it by about 1.1 %',
          note: 'Diet caused more weight loss; exercise tended (P = 0.08) to reduce visceral fat more. The weight–visceral correlation R² was 0.74 after diet but 0.45 after exercise.',
          referenceIds: ['verheggen2016'],
        },
        {
          label: 'Exercise alone (15 studies, 852 people)',
          value:
            'SMD −0.50 (−0.66, −0.34); more than 30 cm² (women) and 40 cm² (men) lower visceral fat on CT after 12 weeks',
          note: 'Best with moderate or high-intensity aerobic training.',
          referenceIds: ['vissers2013'],
        },
        {
          label: 'Dose of exercise',
          value:
            'At least 10 METs·h a week needed; visceral reduction related to energy expenditure (r = −0.75, excluding people with metabolic problems)',
          referenceIds: ['ohkawara2007'],
        },
        {
          label: 'Short randomised trials',
          value: '4 weeks of cycling −12 % visceral fat; 8 weeks −213 to −387 cm³',
          referenceIds: ['johnson2009', 'keating2015'],
        },
        {
          label:
            'Twelve-month trial of low-carbohydrate versus low-fat diets (DXA-estimated visceral fat, n = 449)',
          value:
            'Low-carbohydrate reduced visceral fat more: 10.6 cm² (5.0, 16.2) at 6 months and 6.3 cm² (0.6, 12.0) at 12 months',
          note: 'Larger in men; insulin resistance did not modify.',
          referenceIds: ['follis2026'],
        },
        {
          label: 'Overfeeding and sugary drinks',
          value:
            'Saturated-fat overfeeding doubled the visceral gain against omega-6 fat at equal weight gain; fructose-sweetened drinks (25 % of energy, 10 weeks) increased visceral fat against glucose-sweetened despite equal weight gain; 1 L a day of sucrose cola raised it by 24–31 %',
          note: 'No controlled human data on alcohol and visceral fat were located.',
          referenceIds: ['rosqvist2014', 'stanhope2009', 'maersk2012'],
        },
      ],
      timeCourse:
        'Visceral fat follows total fat mass, with the fat-mass time constant of the body-weight model (weeks to months), not a separate fast process.',
      moderators:
        'Size and speed of weight loss, exercise volume, sex, and composition of any surplus (saturated-fat share).',
      grade: 'B',
      gradeReason:
        'Weight-loss partition is graded B and the direction of the exercise effect A; magnitudes are B/C and diet composition C.',
      status: 'proposed-fit',
      caveats:
        'DXA visceral fat is an algorithmic estimate that is systematically smaller than MRI, so use these coefficients for relative change only. Diet-composition effects are graded C.',
      referenceIds: [
        'chaston2008',
        'merlotti2017',
        'magkos2016',
        'verheggen2016',
        'vissers2013',
        'ohkawara2007',
        'johnson2009',
        'keating2015',
        'follis2026',
        'rosqvist2014',
        'stanhope2009',
        'maersk2012',
      ],
      relatedMetricIds: ['visceralFat'],
    },
    {
      id: '06-glucose-and-insulin',
      title: 'Fasting glucose and insulin',
      category: 'cardio',
      summary:
        'Fasting glucose and insulin fall with weight loss, and much sooner with an energy deficit or very-low-carbohydrate eating. In one trial the liver responded within 48 hours, while muscle insulin sensitivity improved only after about 7 % weight loss. The engine tracks insulin and derives HOMA-IR, a rough score of insulin resistance.',
      howModelled:
        'Insulin is tracked on the log scale, with a weight-loss term, a ketosis term and an acute deficit term. Glucose changes by a per-kilogram coefficient (see the weight-loss entry). HOMA-IR is glucose times insulin divided by 405. Exercise training has no direct term because it did not change HOMA-IR in a 4-week trial without weight change.',
      equation: `ln INS* = ln INS0 − 0.030·%WL − 0.30·s_keto·[weight-stable or in deficit] + acute −0.8·(D_def − 0.2)⁺
τ_INS,acute = 5 days;  τ_INS,weight = 30 days
HOMA_IR = FPG · INS / 405`,
      keyNumbers: [
        {
          label: '600 kcal a day for 1 week in type 2 diabetes',
          value: 'Fasting glucose 9.2 → 5.9 mmol/L',
          referenceIds: ['lim2011'],
        },
        {
          label:
            'Matched 10.5 % weight loss in prediabetes (BMI 39): very-low-carbohydrate versus two other diets',
          value:
            'Fasting glucose −12 versus −6 and −6 mg/dL; fasting insulin −53 % versus −37 % and −37 %; HOMA-IR −58 % versus −40 % and −41 %; 24-hour glucose area −20 % versus −8 % and −8 %; 24-hour insulin −74 % versus −44 % and −27 %',
          note: 'Hepatic insulin sensitivity improved 2–3 times more with very-low-carbohydrate eating; muscle insulin sensitivity improved by about 50 % in all groups.',
          referenceIds: ['petersen2026'],
        },
        {
          label: 'Liver versus muscle timing',
          value:
            'Hepatic effects at 48 h; muscle insulin-mediated glucose uptake rose 48 % only after 7 % weight loss',
          referenceIds: ['kirk2009'],
        },
        {
          label: 'Aerobic training without weight change (4 weeks)',
          value: 'HOMA-IR unchanged',
          referenceIds: ['johnson2009'],
        },
        {
          label: 'Fibre (umbrella review of 52 meta-analyses)',
          value:
            'Higher fibre lowered fasting glucose (effect size −0.55), insulin (−1.22), HOMA-IR (−0.43) and HbA1c (−0.38)',
          note: 'These are standardised effect sizes, not per gram, so they cannot be implemented here. Grade B.',
          referenceIds: ['fu2022'],
        },
        {
          label: 'Spread between people',
          value: 'Fasting glucose SD 16–18 mg/dL; insulin geometric SD 1.7–2.3; HOMA geometric SD 1.7–2.2',
          note: 'The glucose SD includes undiagnosed diabetes; among normoglycaemic adults aged 20–29 it is about 9–10.',
        },
      ],
      timeCourse:
        'Acute effects have a time constant of 5 days, the weight effect 30 days. Fasting glucose and insulin lead HbA1c by weeks.',
      moderators:
        'Diabetes status, baseline glucose, energy deficit, ketosis state and the amount of weight lost.',
      grade: 'B',
      gradeReason:
        'Weight, insulin and acute very-low-carbohydrate effects come from several controlled studies, though each has a modest sample size.',
      status: 'proposed-fit',
      caveats:
        'The insulin equation is a proposed fit. Fibre effects are not implementable because they are standardised. Baselines are US population cross-sections.',
      referenceIds: ['lim2011', 'petersen2026', 'kirk2009', 'johnson2009', 'fu2022'],
      relatedMetricIds: ['fastingGlucose', 'insulinSensitivity'],
    },
    {
      id: '06-hba1c-kinetics',
      title: 'HbA1c lags glucose by weeks',
      category: 'cardio',
      summary:
        'HbA1c is the share of the blood protein haemoglobin that has picked up sugar over the life of a red blood cell. Recent glucose counts more than old glucose. After glucose is brought under control, HbA1c falls with a half-time of about 35 days. So a 4-week change in diet shows only about 55 % of its eventual effect on HbA1c.',
      howModelled:
        'Each day HbA1c closes 1/50 of the gap to a target derived from estimated average glucose. Average glucose is baseline plus 1.3 times the change in fasting glucose.',
      equation: `A1c(t+1) = A1c(t) + (A1c*(t) − A1c(t))/50
A1c*(t) = (eAG*(t) + 46.7)/28.7
eAG(mg/dL) = 28.7 · A1c − 46.7
eAG* = baseline eAG + 1.3 · dFPG`,
      keyNumbers: [
        {
          label: 'Kinetics after abrupt glucose control in newly diagnosed type 2 diabetes (9 people)',
          value:
            'Fasting glucose half-time 6.3 ± 2.4 days; HbA1c fell linearly over the first 2 months with a half-time of 34.6 ± 10.1 days and more slowly after',
          note: 'Glycated albumin half-time 17.1 days, fructosamine 12.2 days. The weighting of past glucose on HbA1c extends back about 100 days.',
          referenceIds: ['tahara1995'],
        },
        {
          label: 'Mean glucose mapping (507 people including 80 without diabetes, 3 months)',
          value: 'eAG (mg/dL) = 28.7 × A1c − 46.7 (R² = 0.84)',
          referenceIds: ['nathan2008'],
        },
        {
          label: 'Red-cell age',
          value:
            'Mean age of circulating red cells 38–60 days (39–56 days in diabetes; 38–60 in non-diabetic controls)',
          note: 'Heterogeneity of about ±10 days in mean red-cell age would shift the non-diabetic HbA1c-above-baseline by about ±20 %. It is treated as a persistent personal offset only.',
          referenceIds: ['cohen2008'],
        },
        {
          label: 'Time constant',
          value: '34.6/ln 2 = 50 days',
          note: 'About 50 % of the current HbA1c reflects the last 35 days and about 90 % the last 115 days. The factor 1.3 for the glucose change is proposed, because 24-hour mean glucose fell 1.8 times fasting glucose on the very-low-carbohydrate arm and 1.3 times on the others.',
          referenceIds: ['tahara1995', 'petersen2026'],
        },
        {
          label: 'Check against the matched-weight-loss trial',
          value:
            'A fasting-glucose fall of −12 mg/dL predicts an HbA1c change of −0.54 (observed −0.6); −6 predicts −0.27 (observed −0.1 and −0.4)',
          referenceIds: ['petersen2026'],
        },
      ],
      timeCourse:
        'After a 4-week intervention only about 55 % of the eventual HbA1c change is visible. HbA1c falls linearly over the first 2 months, with a 50-day time constant.',
      moderators: 'Red-cell lifespan (38–60 days) and glycaemic status.',
      grade: 'B',
      gradeReason:
        "One physiology study with 9 people that fits red-cell biology, and a large mapping study (Vitals' evidence review grades the mechanism A and the constants B).",
      status: 'established',
      caveats:
        'The kinetics rest on one small study. The factor 1.3 that links fasting glucose to average glucose is proposed.',
      referenceIds: ['tahara1995', 'nathan2008', 'cohen2008', 'petersen2026'],
      relatedMetricIds: [],
    },
    {
      id: '06-crp-inflammation',
      title: 'hs-CRP, a marker of inflammation',
      category: 'cardio',
      summary:
        'CRP is made by the liver in response to inflammatory signals, and it leaves the blood with a half-life of about 19 hours. So circulating CRP simply follows the current level of underlying inflammatory drive, which changes slowly with fat mass, visceral fat, infection, sleep and smoking. In trials, losing 5–11 % of weight often did not move it; larger loss did.',
      howModelled:
        'CRP is an instantaneous function of a slow inflammatory-drive state with a time constant of 30–60 days. Weight loss acts with a threshold. Exercise, Mediterranean-style eating and, conditionally, omega-3 lower it. Fibre and omega-6 fat have no term.',
      equation: `ln CRP += −0.10 · min(1, aerobic minutes per week/150)     (exercise; time constant 60 days)
ln CRP += −0.10   only if CRP0 > 3 mg/L and EPA + DHA ≥ 2 g/day   (omega-3; proposed, grade C)`,
      keyNumbers: [
        {
          label: 'Weight loss',
          value:
            '−0.13 mg/L per kg across 33 studies; in the weight-stable trial CRP fell from 4.69 to 3.14 mg/L only at −16 % weight, and did not change at −5 % and −11 %',
          note: 'Petersen 2026: after 10.5 % weight loss, PAI-1 and TNF-alpha fell on the very-low-carbohydrate arm. The threshold rule is described in the weight-loss entry.',
          referenceIds: ['selvin2007', 'magkos2016', 'petersen2026'],
        },
        {
          label: 'Exercise (83 trials, 143 effects, n = 3769)',
          value:
            'Mean effect size 0.26 SD decrease (0.18, 0.34); with BMI decrease 0.38; without weight loss 0.19 (0.10, 0.28)',
          note: 'BMI and percent fat change contributed independently. Diet plus exercise tended to beat diet alone.',
          referenceIds: ['fedewa2017', 'khalafi2022'],
        },
        {
          label: 'Mediterranean-style pattern (17 trials, 12 weeks or more, n = 2300)',
          value: 'hs-CRP −0.98 mg/L (−1.48, −0.49); IL-6 −0.42 pg/mL; flow-mediated dilation +1.86 %',
          note: 'Heterogeneity was high (I² = 91 %). The portfolio pattern lowered CRP by 28 % in a 1-month trial and in the 7-trial pooled analysis.',
          referenceIds: ['schwingshackl2014', 'jenkins2003', 'chiavaroli2018'],
        },
        {
          label: 'Low-carbohydrate diets',
          value:
            '−0.18 mg/L on average but fragile (−0.14 (−0.28, 0.00) after removing one study); larger with baseline CRP above 4.5 mg/L (−0.70), BMI above 35 (−1.21) and age 50 or less',
          note: 'In a network meta-analysis no named diet improved CRP at 6 months. Very-low-carbohydrate eating in lean people left CRP unchanged.',
          referenceIds: ['khodarahmi2025', 'ge2020', 'retterstol2018'],
        },
        {
          label: 'Omega-3',
          value:
            'EPA −0.56 mg/L (−1.13, 0.00); DHA −0.5 mg/L (−1.0, −0.03), especially in dyslipidaemia and high baseline CRP',
          note: 'But 3.4 g/day of EPA + DHA for 8 weeks had no effect on hs-CRP or cytokines in men with moderately high triglycerides.',
          referenceIds: ['guo2019', 'skulasray2011'],
        },
        {
          label: 'Fibre (umbrella review of 52 meta-analyses)',
          value: 'CRP effect size −0.14 (−0.33, 0.05), not significant, while TNF-alpha improved',
          note: 'No fibre term for CRP.',
          referenceIds: ['fu2022'],
        },
        {
          label: 'Omega-6 fat (15 RCTs in healthy people)',
          value: 'No effect on CRP, fibrinogen, PAI-1, cytokines or adhesion molecules',
          note: 'No omega-6 term.',
          referenceIds: ['johnson2012'],
        },
        {
          label: 'How CRP behaves in the blood',
          value:
            'Half-life about 19 h in all conditions; peak about 48 h after an acute trigger; baseline CRP is stable and characteristic for each person',
          referenceIds: ['pepys2003'],
        },
        {
          label: 'Population values (NHANES 2017–2020, adults 20–79, MEC-weighted)',
          value:
            '68.6 % have hs-CRP above 1, 34.8 % above 3 and 7.1 % above 10 mg/L; between-person geometric SD 2.6–3.5 (log SD about 1.0)',
          note: 'The above-10 group is largely acute inflammation and should be left out of baseline draws. The spread is the widest of any marker here.',
          referenceIds: ['cdc2020'],
        },
      ],
      timeCourse:
        'CRP follows the slow inflammatory drive with a time constant of 30–60 days (weight-driven). In trials with 5–11 % weight loss over 3–7 months it did not move. Acute infection and hard-training spikes are out of scope.',
      moderators: 'Adiposity (the main driver), baseline CRP, BMI, exercise and diet pattern.',
      grade: 'B',
      gradeReason:
        'The direction of the weight-loss and exercise effects is well supported (A), but the threshold shape rests on one trial and the low-carbohydrate and omega-3 effects are graded C.',
      status: 'proposed-fit',
      caveats:
        'The threshold rests on one trial with 9 completers at the 16 % step. The low-carbohydrate effect is fragile and the omega-3 evidence is mixed.',
      referenceIds: [
        'selvin2007',
        'magkos2016',
        'petersen2026',
        'fedewa2017',
        'khalafi2022',
        'schwingshackl2014',
        'jenkins2003',
        'chiavaroli2018',
        'khodarahmi2025',
        'ge2020',
        'retterstol2018',
        'guo2019',
        'skulasray2011',
        'fu2022',
        'johnson2012',
        'pepys2003',
        'cdc2020',
      ],
      relatedMetricIds: ['crp'],
    },
    {
      id: '06-uric-acid',
      title: 'Uric acid: ketones, fructose, alcohol, weight and diet',
      category: 'cardio',
      summary:
        'Blood uric acid rises when the kidneys clear less of it or the body makes more. Ketones compete with uric acid for kidney clearance, so fasting and ketosis raise it, by 1.7–3.4 mg/dL in a large fasting cohort. Extra fructose, sugary drinks and alcohol raise it. Losing weight and eating a DASH-style pattern lower it.',
      howModelled:
        'The target adds terms for BHB level (+0.6 mg/dL per mmol/L, capped at +4), alcohol (by beverage), fructose in energy surplus, sugary-drink substitution, weight loss (−0.06 per kg), DASH-style eating (larger when uric acid starts high) and a plant-protein term. Rises use a 5-day time constant and falls 7 days, with weight and DASH terms at 30 days.',
      equation: `UA* = UA0 + 0.6·BHB(t) [cap 4] + 0.013·alcohol_g·bev_mult + 0.52·min(1, fructose_excess_%E/35)·1[energy surplus] + 0.16·(SSB_substitution_fraction) − 0.06·kg_lost − DASH_effect − 0.12·(protein_rich_plant_fraction)
DASH_effect = 0.25 · DASH_fraction · clip((UA0 − 5)/2.5, 0.3, 2.5)
bev_mult: beer 1.0, spirits 0.35, wine 0.10`,
      keyNumbers: [
        {
          label: 'Fasting for 4–21 days (1610 people on 75–250 kcal a day)',
          value:
            'Uric acid rose by +100 ± 4.5 µmol/L (low ketonuria) to +200 ± 4.9 µmol/L (high ketonuria), that is 1.7–3.4 mg/dL',
          note: 'The rise correlated with ketonuria and even more with blood ketones. One gout attack occurred among 1422 fasters.',
          referenceIds: ['grundler2024'],
        },
        {
          label: 'Ketone infusion',
          value: 'BHB and acetoacetate infusion caused the kidneys to retain uric acid',
          referenceIds: ['goldfinger1965'],
        },
        {
          label: 'Trials of diets very low in carbohydrate (6 randomised trials)',
          value:
            'Pooled +0.26 mg/dL (−0.47, 0.98; I² = 95 %; n = 267); the very-low-calorie subgroup −0.04 (−0.29, 0.22)',
          note: 'A 3-week trial under 20 g carbohydrate also found uric acid rose against control (the size was not in the abstract). The dose-response slope of 0.6 mg/dL per mmol/L of BHB is proposed (grade C): fasting BHB of 3–6 mM gives +1.8 to +3.6; nutritional ketosis of 0.5–1.5 mM gives +0.3 to +0.9.',
          referenceIds: ['gohari2023', 'retterstol2018'],
        },
        {
          label: 'Fructose and sugar',
          value:
            'Isocaloric fructose exchange +0.56 µmol/L (not significant; 21 trials, n = 425); hypercaloric +35 % of energy (213–219 g a day) +31 µmol/L (15.4, 46.5), that is +0.52 mg/dL; fructose-containing sugars in energy-matched substitution +0.16 mg/dL (0.06, 0.27), driven by sugar-sweetened drinks and sweets',
          note: '100 % fruit juice lowered uric acid in addition trials (47 trials, n = 2763).',
          referenceIds: ['wang2012', 'ayoubcharette2021'],
        },
        {
          label: 'Alcohol',
          value:
            '1.8 g of ethanol per kg a day for 8 days in 6 gout patients raised serum urate from 8.4 to 10.1 mg/dL, with 1.7 times higher daily uric acid turnover',
          note: 'Cohort data on gout risk: relative risk 1.32, 1.49, 1.96 and 2.53 for 10–14.9, 15–29.9, 30–49.9 and 50 g or more of alcohol a day against none; beer 1.49 per 12-oz serving a day, spirits 1.15 per drink, wine 1.04 (not significant). The slope of 0.013 mg/dL per g is unverified for people without gout.',
          referenceIds: ['faller1982', 'choi2004a'],
        },
        {
          label: 'Purines, meat and dairy',
          value:
            'Meat and seafood raise gout risk (top versus bottom fifth, relative risk 1.41 and 1.51); dairy lowers it (0.56); purine-rich vegetables and total protein do not',
          note: 'Qualitative only; serum urate magnitudes from trials were not extracted.',
          referenceIds: ['choi2004b'],
        },
        {
          label: 'DASH-style eating',
          value:
            '−0.25 mg/dL (−0.43, −0.08) against control over 8 weeks (baseline 5.7); −0.08 at under 5, −0.42 at 6–6.9 and −0.73 at 8 mg/dL or more; four DASH trials pooled −0.25 (−0.4, −0.1)',
          note: 'A protein-rich (half plant) DASH-style diet lowered it by 0.16 mg/dL from baseline (0.12 against carbohydrate-rich or unsaturated-fat diets).',
          referenceIds: ['juraschek2021', 'gohari2023', 'belanger2021'],
        },
        {
          label: 'Weight loss',
          value:
            '13 men with gout, BMI 30.5, 1600 kcal for 16 weeks: weight −7.7 kg, urate 0.57 → 0.47 mmol/L (−100 µmol/L = −1.7 mg/dL, −0.22 mg/dL per kg), gout attacks 2.1 → 0.6 a month',
          note: 'A review of 10 studies found changes from −168 to +30 µmol/L for weight loss of 3–34 kg, with a short-term temporary rise and gout attacks after bariatric surgery. Cross-sectionally, +0.06 mg/dL per BMI unit.',
          referenceIds: ['dessein2000', 'nielsen2017'],
        },
      ],
      timeCourse:
        'Ketone-driven rises use a 5-day time constant; falls after ketones drop 7 days (unverified); weight and DASH components 30 days.',
      moderators:
        'Baseline uric acid (DASH effect grows with it), sex (women 4.5–5.2 mg/dL, men about 6.0), BMI (+0.06 mg/dL per unit) and kidney or gout history.',
      grade: 'B',
      gradeReason:
        'Ketone and fasting effect is graded B, fructose and DASH A, alcohol B for direction and C for dose, weight loss C; overall B.',
      status: 'proposed-fit',
      caveats:
        'The ketone and alcohol slopes come from single cohorts or patient groups, and their time constants are unknown. The weight coefficient comes from mostly observational studies in people with gout.',
      referenceIds: [
        'grundler2024',
        'goldfinger1965',
        'gohari2023',
        'retterstol2018',
        'wang2012',
        'ayoubcharette2021',
        'faller1982',
        'choi2004a',
        'choi2004b',
        'juraschek2021',
        'belanger2021',
        'dessein2000',
        'nielsen2017',
      ],
      relatedMetricIds: ['uricAcid'],
    },
    {
      id: '06-omega-3-beyond-triglycerides',
      title: 'Omega-3 fats beyond triglycerides',
      category: 'cardio',
      summary:
        'Beyond lowering triglycerides, EPA and DHA slightly raise LDL cholesterol and HDL cholesterol, and may lower blood pressure a little in people with high lipids. Effects on CRP and glucose are small or mixed. Most of these are small compared with the triglyceride effect, so the engine keeps only triglycerides, HDL and an optional blood-pressure term.',
      howModelled:
        'The engine omits the smaller effects. It optionally lowers systolic blood pressure by 1 mmHg per gram of EPA + DHA up to 3 g, in people with high lipids and high blood pressure (proposed, grade C).',
      keyNumbers: [
        {
          label: 'LDL cholesterol',
          value:
            '+6 mg/dL at about 3 g/day; J-shaped, +2.9 mg/dL peak near 1.75 g/day; DHA raises it more than EPA alone',
          note: 'The American Heart Association advisory says EPA + DHA raises LDL in very high triglycerides but not EPA alone or in combination with statins.',
          referenceIds: ['balk2006', 'wang2023', 'skulasray2019'],
        },
        {
          label: 'HDL cholesterol',
          value: '+1.6 to +3.5 mg/dL',
          referenceIds: ['balk2006', 'wang2023'],
        },
        {
          label: 'Blood pressure (20 randomised trials)',
          value: 'EPA SBP −2.6 mmHg (−4.6, −0.5); DHA DBP −3.1 mmHg, in dyslipidaemia',
          referenceIds: ['guo2019'],
        },
        {
          label: 'CRP',
          value:
            '−0.5 mg/L in high-CRP or dyslipidaemic people only; nil at 3.4 g/day in moderate high triglycerides',
          referenceIds: ['guo2019', 'skulasray2011'],
        },
        {
          label: 'Glucose and HbA1c',
          value: 'Small non-significant increases (27 trials)',
          referenceIds: ['balk2006'],
        },
        {
          label: 'Non-HDL cholesterol and ApoB',
          value: 'Non-HDL about −4 to −8 mg/dL at 2–3 g/day; ApoB modestly lower at 4 g/day',
          referenceIds: ['wang2023', 'skulasray2019'],
        },
      ],
      timeCourse: 'Effects appear within 2–4 weeks in most trials.',
      moderators: 'Baseline triglycerides and lipids, and whether EPA or DHA is used.',
      grade: 'A',
      gradeReason:
        'The lipid effects are supported by large dose-response meta-analyses; the blood-pressure and CRP effects are smaller and less consistent.',
      status: 'established',
      caveats: 'These effects are small and heterogeneous, and the optional blood-pressure term is graded C.',
      referenceIds: ['balk2006', 'wang2023', 'skulasray2019', 'guo2019', 'skulasray2011'],
      relatedMetricIds: ['sbp'],
    },
    {
      id: '06-omega-6-and-the-ratio',
      title: 'Omega-6 fat, and whether the omega-6:omega-3 ratio matters',
      category: 'cardio',
      summary:
        'Eating more omega-6 fat (linoleic acid) lowers cholesterol and shows no harm to inflammation markers in trials. It did not raise arachidonic acid, the fat often blamed for inflammation. The omega-6:omega-3 ratio has theoretical and practical problems as a metric. What is really scarce in typical Western diets is the marine omega-3 fats EPA and DHA.',
      howModelled:
        'The engine does not use an omega-6:omega-3 ratio as a state or goal. Instead linoleic acid acts as a cholesterol-lowering fat class, alpha-linolenic acid has its own LDL coefficient, and EPA + DHA in grams a day drives triglycerides, HDL and blood pressure.',
      keyNumbers: [
        {
          label: 'Cochrane review of 19 trials (6461 people, 1–8 years)',
          value:
            'More omega-6: all-cause mortality RR 1.00 (0.88, 1.12); cardiovascular events RR 0.97 (0.81, 1.15); heart attack RR 0.88 (0.76, 1.02); total cholesterol −0.33 mmol/L (−0.50, −0.16) long term; no effect on TG (−0.01), HDL or adiposity (BMI −0.20 kg/m²)',
          referenceIds: ['hooper2018'],
        },
        {
          label: 'Recovered data of the Sydney Diet Heart Study (221 men with recent heart disease)',
          value:
            'Safflower oil and margarine replacing saturated fat: higher all-cause (HR 1.62), cardiovascular and coronary mortality; an updated meta-analysis showed no benefit',
          note: 'Confounding by trans fat in the margarine is often argued but is unverified here.',
          referenceIds: ['ramsden2013'],
        },
        {
          label: 'Consortium of 30 cohorts (68,659 people, 15,198 events)',
          value:
            'Higher linoleic acid in blood or fat tissue: lower total cardiovascular disease (HR 0.93 per interquintile range, 0.88–0.99), cardiovascular mortality 0.78, ischaemic stroke 0.88; arachidonic acid not linked to higher risk',
          referenceIds: ['marklund2019'],
        },
        {
          label: 'Linoleic acid and arachidonic acid',
          value:
            'Raising dietary linoleic acid up to 6-fold, or lowering it by up to 90 %, did not change arachidonic acid in plasma or red-cell fats (P = 0.72 and 0.39)',
          referenceIds: ['rett2011'],
        },
        {
          label: 'Linoleic acid and inflammation (15 RCTs in healthy people)',
          value: 'No effect on CRP, fibrinogen, PAI-1, cytokines, adhesion molecules or TNF-alpha',
          referenceIds: ['johnson2012'],
        },
        {
          label: 'The ratio itself',
          value:
            'Typical Western intakes (NHANES 2017–2020): linoleic acid 16–21 g/day, alpha-linolenic 1.8–2.2, EPA + DHA 0.08–0.11 (median 0.02); the ratio of about 9–10:1 comes from the absence of marine omega-3, not from excess linoleic acid',
          note: 'A "poor omega-3 status" indicator could use EPA + DHA against 0.25–0.5 g/day (thresholds unverified). One critical appraisal proposes the Omega-3 Index instead of the ratio.',
          referenceIds: ['harris2018', 'cdc2020'],
        },
      ],
      moderators: 'Baseline intake of marine omega-3.',
      grade: 'B',
      gradeReason:
        "Systematic reviews of randomised trials, though small and short, show no linoleic acid effect on arachidonic acid or inflammation; the ratio's irrelevance rests on appraisal and null trials (B/C).",
      status: 'established',
      caveats:
        "No randomised trial tests the ratio itself. The Sydney Diet Heart Study is a caution that Vitals' evidence review could not resolve.",
      referenceIds: [
        'hooper2018',
        'ramsden2013',
        'marklund2019',
        'rett2011',
        'johnson2012',
        'harris2018',
        'cdc2020',
      ],
      relatedMetricIds: ['ldl'],
    },
    {
      id: '06-low-fat-vs-low-carb-equal-loss',
      title: 'Low-fat versus low-carbohydrate at equal weight loss',
      category: 'cardio',
      summary:
        'At equal weight loss, in mixed or obese populations, weight, blood pressure, glucose, insulin and CRP do not differ between low-fat and low-carbohydrate diets. LDL is about 3–6 mg/dL higher and HDL 2–3 mg/dL higher on low-carbohydrate arms, and triglycerides 14–28 mg/dL lower. Liver fat and hepatic insulin sensitivity favoured very-low-carbohydrate eating at 10 % loss. ApoB did not differ.',
      howModelled:
        'The engine does not hard-wire a winner. Composition enters through its separate terms, and the summary risk view uses ApoB, non-HDL cholesterol, TG/HDL, HOMA-IR and liver fat together.',
      keyNumbers: [
        {
          label:
            'Twelve-month trial of healthy low-fat versus healthy low-carbohydrate diets (609 people, BMI 33)',
          value:
            'Weight −5.3 versus −6.0 kg (difference 0.7, −0.2 to 1.6); LDL −2.1 versus +3.6 mg/dL (difference −5.7 favouring low-fat, −9.4 to −2.1); HDL +0.4 versus +2.6; TG −10 versus −28 (difference +18 favouring low-carbohydrate); SBP −3.2/−3.7, DBP −1.9/−2.6 (not significant); glucose −3.7/−2.1, insulin −2.6/−2.3 (not significant)',
          note: 'Carbohydrate 48/29/21 versus 30/45/23 % of energy for carbohydrate/fat/protein. The respiratory exchange ratio fell by 0.008 versus 0.027; DXA visceral fat was 10.6 cm² lower at 6 months and 6.3 cm² at 12 months on low-carbohydrate. A reanalysis found glycaemic load reduction explained most weight loss.',
          referenceIds: ['gardner2018', 'follis2026', 'sotomota2023'],
        },
        {
          label: 'Four diets with different fat, protein and carbohydrate (811 people, 2 years)',
          value:
            'About 6 kg lost at 6 months on all diets; 2-year loss 2.9 kg (65 % carbohydrate) versus 3.4 kg (35 %), not significant; regain after 12 months',
          note: 'Attendance, not diet, predicted loss. Per-diet lipid values were not in the abstract.',
          referenceIds: ['sacks2009'],
        },
        {
          label: 'Meta-analyses of low-carbohydrate versus low-fat',
          value:
            'LDL +4.6 mg/dL (Bueno), +3.7 (Hu), +6 (Mansoor), +2.7 (Chawla; +0.07 mmol/L); Ge: −1.0 versus −7.1 against usual. HDL +3.3 (Hu), +3.5 (Bueno), +5.4 (Mansoor), +1.9 (Chawla). TG −14 (Hu), −23 (Mansoor), −9 (Chawla), −16 (Bueno)',
          note: 'Low-carbohydrate lost 0.9 to 2.2 kg more at 6–12 months or longer; the network analysis found equal loss at 6 months, with differences vanishing at 12. No named diet improved CRP at 6 months.',
          referenceIds: ['bueno2013', 'hu2012', 'mansoor2016', 'chawla2020', 'ge2020'],
        },
        {
          label:
            'Matched 10.5 % weight loss (42 adults, BMI 39, prediabetes and fatty liver, all food provided)',
          value:
            'LDL −10 / −22 / −8 mg/dL (very-low-carbohydrate / Mediterranean-style / very-low-fat); HDL +2 / −2 / −4; fasting TG −45 / −24 / −14 %; HbA1c −0.6 / −0.1 / −0.4; HOMA-IR −58 / −40 / −41 %; liver fat −68 versus −43 and −46 %; ApoB −6 / −15 / −9 (not significant)',
          referenceIds: ['petersen2026'],
        },
        {
          label: 'Crossover with equal deficit',
          value:
            'Serum insulin −54 % (very-low-carbohydrate only); liver fat −29 versus −20 %; hepatic redox +51 %, TCA cycle oxidation −34 %',
          note: 'A possible liver-injury-relevant trade-off.',
          referenceIds: ['qadri2026'],
        },
        {
          label:
            'Six days of restricted carbohydrate or fat at equal energy (19 adults with obesity, metabolic ward)',
          value:
            'Body-fat loss 89 ± 6 g/day (fat restriction) versus 53 ± 6 g/day (carbohydrate restriction)',
          note: 'Convergence is predicted with prolonged feeding.',
          referenceIds: ['hall2015'],
        },
        {
          label: '178 overweight men losing 5.1 kg',
          value:
            'LDL fell less on the 26 % carbohydrate diet after weight loss; TG, ApoB and small LDL improved with carbohydrate restriction, but the benefits did not add to those of weight loss',
          referenceIds: ['krauss2006'],
        },
      ],
      timeCourse: 'Trials cover 6 days to 2 years. At 12 months or more, the differences narrow.',
      moderators:
        'Baseline BMI and metabolic status (in lean people the low-carbohydrate arm can raise ApoB substantially), length of follow-up, and the degree of weight loss.',
      grade: 'B',
      gradeReason:
        'Weight, blood pressure and lipids at 6–12 months are graded A, hepatic and visceral differences B, and long-term or lean-person effects C; graded B overall.',
      status: 'established',
      caveats:
        'Most trials are in people with obesity. The liver advantage of very-low-carbohydrate eating is a composition or ketosis effect, not a weight effect. The long-term (over 12 months) and lean-person results are uncertain.',
      referenceIds: [
        'gardner2018',
        'follis2026',
        'sotomota2023',
        'sacks2009',
        'bueno2013',
        'hu2012',
        'mansoor2016',
        'chawla2020',
        'ge2020',
        'petersen2026',
        'qadri2026',
        'hall2015',
        'krauss2006',
      ],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '06-myth-dietary-cholesterol',
      claim: 'Cholesterol in eggs and other foods either does not matter at all, or is dangerous.',
      verdict: 'oversimplified',
      explanation:
        'Controlled trials show a small effect that levels off and varies a lot between people. Each extra 100 mg a day raised total cholesterol by 0.056 mmol/L, and LDL rose by 6.7 mg/dL on average in one analysis. The spread of response was 14–16 mg/dL per 500 mg a day, and part of it is a stable personal trait. The lipid data cannot say anything about heart-disease outcomes.',
      referenceIds: ['weggemans2001', 'berger2015', 'katan1987'],
    },
    {
      id: '06-myth-saturated-fat-and-ldl',
      claim: 'Saturated fat does not raise LDL cholesterol.',
      verdict: 'not-supported',
      explanation:
        'In controlled feeding trials, saturated fat raises LDL in proportion to intake, by 0.036 mmol/L per 1 % of energy against carbohydrate and by more against polyunsaturated fat (0.055). The size depends on the fatty acid (lauric to palmitic raise it, stearic does not), on the food it comes in (cheese less than butter) and on baseline LDL. The opposite claim, that saturated fat alone explains high LDL on very-low-carbohydrate diets, is also false: it cannot explain the large rises seen in lean people.',
      referenceIds: ['mensink2016', 'mensink2003', 'brassard2017'],
    },
    {
      id: '06-myth-low-carb-and-ldl',
      claim: 'Very-low-carbohydrate diets raise LDL cholesterol, or, equally, they lower it.',
      verdict: 'oversimplified',
      explanation:
        'Neither is generally true. In trials with mixed or obese populations the average is +5 to +6 mg/dL against low-fat diets. At BMI 39 during matched weight loss it was −10 mg/dL. In lean people, rises of +35 to +250 mg/dL have been reported. The answer depends heavily on BMI.',
      referenceIds: [
        'bueno2013',
        'mansoor2016',
        'hu2012',
        'chawla2020',
        'petersen2026',
        'norwitz2022a',
        'buren2021',
        'retterstol2018',
      ],
    },
    {
      id: '06-myth-high-ldl-benign-in-lean-responders',
      claim: 'Very high LDL in lean people on low-carbohydrate diets is harmless.',
      verdict: 'unproven',
      explanation:
        'It is unproven either way. Coronary imaging in 80 people (mean LDL 272) found no plaque difference from matched controls with LDL 123, but it found no link between LDL and plaque, and it tracked no outcomes. Genetic evidence says that the number of ApoB particles, not the diet that produced them, predicts risk. The app therefore shows ApoB and flags it.',
      referenceIds: ['budoff2024', 'ference2019'],
    },
    {
      id: '06-myth-raise-your-hdl',
      claim: 'Raising your HDL cholesterol will protect your heart.',
      verdict: 'not-supported',
      explanation:
        'Gene variants that raise HDL did not lower heart-attack risk (odds ratio 0.99 for a variant that raised HDL by 0.14 mmol/L, where 0.87 was predicted), while LDL variants behaved as expected. Exercise, weight loss and alcohol do raise HDL, but the app does not offer HDL as a goal. The evidence is genetic and indirect.',
      referenceIds: ['voight2012'],
    },
    {
      id: '06-myth-fructose-toxic',
      claim: 'Fructose is uniquely toxic.',
      verdict: 'oversimplified',
      explanation:
        'Swapping fructose for other carbohydrate at the same calories had no effect on triglycerides, ApoB, LDL, liver fat or uric acid. The harm comes from extra energy (21–35 % of energy on top of usual intake) and from sugar-sweetened drinks, for example +32 % triglycerides and more than double the liver fat with 1 L a day of sucrose cola over 6 months.',
      referenceIds: [
        'chiavaroli2015',
        'chiu2014',
        'wang2012',
        'stanhope2009',
        'maersk2012',
        'ayoubcharette2021',
      ],
    },
    {
      id: '06-myth-carbohydrate-always-raises-triglycerides',
      claim: 'Carbohydrate always raises triglycerides.',
      verdict: 'oversimplified',
      explanation:
        'It does so only relative to fat or protein at the margin (fat in place of carbohydrate lowers triglycerides by 0.012 to 0.021 mmol/L per 1 % of energy), and with energy excess or alcohol. Triglycerides fall with any weight loss.',
      referenceIds: ['mensink2016'],
    },
    {
      id: '06-myth-omega-ratio-drives-inflammation',
      claim: 'The omega-6 to omega-3 ratio drives inflammation.',
      verdict: 'not-supported',
      explanation:
        'Randomised trials of linoleic acid show no change in arachidonic acid or in inflammation markers. Blood levels of linoleic acid were inversely related to cardiovascular disease. The ratio is a poor metric. What is truly low in Western diets is EPA plus DHA, with a median intake of 0.02 g a day.',
      referenceIds: ['rett2011', 'johnson2012', 'marklund2019', 'harris2018'],
    },
    {
      id: '06-myth-salt-only-matters-in-hypertension',
      claim: 'Salt only matters if you have high blood pressure.',
      verdict: 'not-supported',
      explanation:
        'The straight-line dose-response also exists in people with normal pressure, about −1.0 mmHg systolic per gram of sodium. It is about 2.8 times smaller than in hypertensives. Benefits below 2 g a day in normotensives are unproven.',
      referenceIds: ['filippini2021'],
    },
    {
      id: '06-myth-low-carb-fat-loss-advantage',
      claim: 'Low-carbohydrate eating has a metabolic advantage for fat loss.',
      verdict: 'not-supported',
      explanation:
        'A 12-month trial and pooled analyses show equal weight and fat loss at 6–12 months, and the short ward study favoured fat restriction. The real advantage of very-low-carbohydrate eating at equal weight loss is in the liver (liver fat, HbA1c in prediabetes), which is a separate mechanism.',
      referenceIds: ['gardner2018', 'ge2020', 'hall2015', 'petersen2026', 'qadri2026'],
    },
    {
      id: '06-myth-weight-loss-lowers-ldl-a-lot',
      claim: 'Weight loss lowers LDL a lot.',
      verdict: 'not-supported',
      explanation:
        'LDL falls only modestly, about 0.6 mg/dL per kg, and did not fall with weight loss in one large diabetes trial. Triglycerides, glucose, insulin, blood pressure and liver fat respond much more.',
      referenceIds: ['wing2011', 'magkos2016', 'neter2003'],
    },
    {
      id: '06-myth-liver-fat-takes-months',
      claim: 'Liver fat takes months to fix.',
      verdict: 'not-supported',
      explanation:
        'It falls by 30–55 % within 1–2 weeks of energy or carbohydrate restriction, and it re-accumulates within 3 weeks of overfeeding.',
      referenceIds: [
        'kirk2009',
        'browning2011',
        'mardinoglu2018',
        'lim2011',
        'luukkonen2018',
        'sevastianova2012',
      ],
    },
    {
      id: '06-myth-hba1c-three-month-average',
      claim: 'HbA1c is the average of the last three months.',
      verdict: 'oversimplified',
      explanation:
        'It weights recent weeks much more, with a half-time of about 35 days. A 4-week change in diet shows only about 55 % of its eventual effect on HbA1c.',
      referenceIds: ['tahara1995'],
    },
    {
      id: '06-myth-exercise-without-weight-loss-does-nothing',
      claim: 'Exercise without weight loss does nothing.',
      verdict: 'not-supported',
      explanation:
        'Without weight loss, exercise lowered visceral fat by 6 %, liver fat by 21 %, blood pressure by 3.5/2.5 mmHg, and triglycerides by 7 mg/dL. It raised HDL by 2.5 mg/dL and lowered CRP by a standardised effect of 0.19.',
      referenceIds: [
        'verheggen2016',
        'johnson2009',
        'cornelissen2013',
        'kodama2007',
        'fedewa2017',
        'halbert1999',
      ],
    },
    {
      id: '06-myth-fasting-and-gout',
      claim: 'Fasting and ketosis are uniformly protective, and gout is not a concern for fasters.',
      verdict: 'not-supported',
      explanation:
        'Ketosis raised uric acid by 1.7–3.4 mg/dL within days to weeks in a large fasting cohort, and ketone infusion made the kidneys retain uric acid.',
      referenceIds: ['grundler2024', 'goldfinger1965'],
    },
    {
      id: '06-myth-any-weight-loss-lowers-crp',
      claim: 'Any weight loss lowers CRP.',
      verdict: 'oversimplified',
      explanation:
        'In insulin-resistant adults with BMI about 40, CRP did not change at 5 % and 11 % weight loss. Across studies the average slope is −0.13 mg/L per kg.',
      referenceIds: ['magkos2016', 'selvin2007'],
    },
  ],
  openQuestions: [
    'The lean-responder term (45 mg/dL at BMI 22, slope −4.5 per BMI unit, 10-day time constant, spread 0.6) rests on one self-selected survey of 548 people, two small feeding trials in lean adults, single-person experiments and trial means in obese groups. The energy-balance modifier (deficits raise LDL, surpluses lower it) is grade D. BMI is a stand-in: body fat, training, sex and baseline TG/HDL are all mixed together.',
    'How far the LDL terms add up (fat composition, lean-responder term, weight, food components) and how DASH interacts with sodium are assumed. Sub-additivity is known only qualitatively (about −17 % pooled against −28.6 % in the small one-month trial).',
    'Time constants for LDL (7–10 days), triglycerides (4–45 days by mechanism), blood-pressure sodium (21 days), liver fat (12 and 21 days, and 120 days for the overfeeding state), CRP (30–60 days) and uric acid (5–7 days) come from trial durations, a few time-course studies or mechanism, not from dense time series in each case.',
    "Per-kilogram coefficients for LDL, triglycerides and uric acid come from mixed studies. Zomer's mean weight loss was not visible in the abstract, Look AHEAD is people with diabetes on statins, and the uric acid figure comes from 13 gout patients. The CRP threshold rests on one trial with 9 completers at the 16 % step.",
    'The omega-3 triglyceride response below 1 g a day and in people with normal lipids is uncertain, and two meta-analyses conflict: −43 mg/dL at 2 g a day in one against −27 to −30 mg/dL at about 3.25 g a day in others. Two toggles are provided.',
    'The size of any lasting liver advantage of ketosis at equal weight loss is unresolved (gone at 11 weeks in one trial, present at about 10 % loss in another), as is the mitochondrial trade-off signal in one crossover trial.',
    'The Mensink coefficients come from feeding trials with 65 % men and a mean age of 39. Menopausal changes in the LDL-lowering response and differences by ethnicity are not modelled.',
    'Baselines come from US cross-sections (NHANES 2017–2020; ApoB from 2013–14; DXA visceral fat from 2017–18, ages 20–59 only). DXA visceral fat is an algorithmic estimate; medication use beyond lipid, blood-pressure and diabetes drugs, ethnicity and trends over time are not included; the fasting-glucose SD is inflated by undiagnosed diabetes.',
    'The Hegsted equation coefficients (2.16, −1.65, 0.097) could not be verified in a primary source. The HDL P-value row in the 2003 Mensink paper is misaligned in the source PDF, and minus signs in the extracted 2003 tables were restored by confidence-interval arithmetic (internally consistent).',
    'The uric-acid slope for ketones (0.6 mg/dL per mmol/L of BHB) and the alcohol slope (0.013 mg/dL per gram) come from single cohorts or patient groups, and their time constants are unknown.',
    'Effects of omega-3 on blood pressure and CRP are small and heterogeneous, so they are included only as optional terms.',
    'Effects of sleep, stress, smoking and medications on these markers were outside the sources retrieved for this topic.',
  ],
  references: [
    {
      id: 'aburto2013',
      authors: 'Aburto NJ, et al.',
      year: 2013,
      title:
        'Effect of increased potassium intake on cardiovascular risk factors and disease: systematic review and meta-analyses',
      journal: 'BMJ',
      pmid: '23558164',
      doi: '10.1136/bmj.f1378',
    },
    {
      id: 'anderson1995',
      authors: 'Anderson JW, et al.',
      year: 1995,
      title: 'Meta-analysis of the effects of soy protein intake on serum lipids',
      journal: 'N Engl J Med',
      pmid: '7596371',
      doi: '10.1056/NEJM199508033330502',
    },
    {
      id: 'anderson2000',
      authors: 'Anderson JW, et al.',
      year: 2000,
      title:
        'Psyllium adjunctive to diet therapy in hypercholesterolemia: meta-analysis of 8 controlled trials',
      journal: 'Am J Clin Nutr',
      pmid: '10648260',
    },
    {
      id: 'appel1997',
      authors: 'Appel LJ, et al.',
      year: 1997,
      title: 'A clinical trial of the effects of dietary patterns on blood pressure',
      journal: 'N Engl J Med',
      pmid: '9099655',
      doi: '10.1056/NEJM199704173361601',
    },
    {
      id: 'appel2005',
      authors: 'Appel LJ, et al.',
      year: 2005,
      title:
        'Effects of protein, monounsaturated fat, and carbohydrate intake on blood pressure and serum lipids: results of the OmniHeart randomized trial',
      journal: 'JAMA',
      pmid: '16287956',
      doi: '10.1001/jama.294.19.2455',
    },
    {
      id: 'avilagandia2023',
      authors: 'Avila-Gandia V et al.',
      year: 2023,
      title:
        'Training, detraining and retraining effects of moderate vs high intensity exercise training programme on cardiovascular risk factors',
      journal: 'J Hypertens',
      pmid: '36728639',
      doi: '10.1097/HJH.0000000000003346',
    },
    {
      id: 'ayoubcharette2021',
      authors: 'Ayoub-Charette S, et al.',
      year: 2021,
      title:
        'Different food sources of fructose-containing sugars and fasting blood uric acid levels: a systematic review and meta-analysis of controlled feeding trials',
      journal: 'J Nutr',
      pmid: '34087940',
      doi: '10.1093/jn/nxab144',
    },
    {
      id: 'balk2006',
      authors: 'Balk EM, et al.',
      year: 2006,
      title:
        'Effects of omega-3 fatty acids on serum markers of cardiovascular disease risk: a systematic review',
      journal: 'Atherosclerosis',
      pmid: '16530201',
      doi: '10.1016/j.atherosclerosis.2006.02.012',
    },
    {
      id: 'belanger2021',
      authors: 'Belanger MJ, et al.',
      year: 2021,
      title: 'Effects of dietary macronutrients on serum urate: results from the OmniHeart trial',
      journal: 'Am J Clin Nutr',
      pmid: '33668058',
      doi: '10.1093/ajcn/nqaa424',
    },
    {
      id: 'berger2015',
      authors: 'Berger S, Raman G, Vishwanathan R, Jacques PF, Johnson EJ',
      year: 2015,
      title: 'Dietary cholesterol and cardiovascular disease: a systematic review and meta-analysis',
      journal: 'Am J Clin Nutr',
      pmid: '26109578',
      doi: '10.3945/ajcn.114.100305',
    },
    {
      id: 'beynen1985',
      authors: 'Beynen AC, Katan MB',
      year: 1985,
      title:
        'Reproducibility of the variations between humans in the response of serum cholesterol to cessation of egg consumption',
      journal: 'Atherosclerosis',
      pmid: '3907645',
    },
    {
      id: 'brassard2017',
      authors: 'Brassard D, et al.',
      year: 2017,
      title:
        'Comparison of the impact of SFAs from cheese and butter on cardiometabolic risk factors: a randomized controlled trial',
      journal: 'Am J Clin Nutr',
      pmid: '28251937',
      doi: '10.3945/ajcn.116.150300',
    },
    {
      id: 'brown1999',
      authors: 'Brown L, et al.',
      year: 1999,
      title: 'Cholesterol-lowering effects of dietary fiber: a meta-analysis',
      journal: 'Am J Clin Nutr',
      pmid: '9925120',
      doi: '10.1093/ajcn/69.1.30',
    },
    {
      id: 'browning2011',
      authors: 'Browning JD, et al.',
      year: 2011,
      title:
        'Short-term weight loss and hepatic triglyceride reduction: evidence of a metabolic advantage with dietary carbohydrate restriction',
      journal: 'Am J Clin Nutr',
      pmid: '21367948',
      doi: '10.3945/ajcn.110.007674',
    },
    {
      id: 'budoff2024',
      authors: 'Budoff M, Manubolu VS, Kinninger A, et al.',
      year: 2024,
      title:
        'Carbohydrate restriction-induced elevations in LDL-cholesterol and atherosclerosis: the KETO trial',
      journal: 'JACC Adv',
      pmid: '39372369',
      doi: '10.1016/j.jacadv.2024.101109',
    },
    {
      id: 'bueno2013',
      authors: 'Bueno NB, de Melo IS, de Oliveira SL, da Rocha Ataide T',
      year: 2013,
      title:
        'Very-low-carbohydrate ketogenic diet v. low-fat diet for long-term weight loss: a meta-analysis of randomised controlled trials',
      journal: 'Br J Nutr',
      pmid: '23651522',
      doi: '10.1017/S0007114513000548',
    },
    {
      id: 'buren2021',
      authors: 'Burén J, Ericsson M, Damasceno NRT, Sjödin A',
      year: 2021,
      title:
        'A ketogenic low-carbohydrate high-fat diet increases LDL cholesterol in healthy, young, normal-weight women: a randomized controlled feeding trial',
      journal: 'Nutrients',
      pmid: '33801247',
      doi: '10.3390/nu13030814',
    },
    {
      id: 'carpiorivera2016',
      authors: 'Carpio-Rivera E et al.',
      year: 2016,
      title: 'Acute effects of exercise on blood pressure: a meta-analytic investigation',
      journal: 'Arq Bras Cardiol',
      pmid: '27168471',
      doi: '10.5935/abc.20160064',
    },
    {
      id: 'cdc2020',
      authors: 'CDC National Center for Health Statistics',
      year: 2020,
      title:
        "NHANES 2017-March 2020 pre-pandemic public-use files (DEMO, BMX, TCHOL, HDL, TRIGLY, GHB, GLU, INS, HSCRP, BIOPRO, BPXO, DIQ, BPQ, DR1TOT); NHANES 2013-14 and 2017-18 files as listed in Vitals' evidence review",
      journal: 'National Health and Nutrition Examination Survey (public-use data)',
      url: 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/',
    },
    {
      id: 'chaston2008',
      authors: 'Chaston TB, et al.',
      year: 2008,
      title:
        'Factors associated with percent change in visceral versus subcutaneous abdominal fat during weight loss: findings from a systematic review',
      journal: 'Int J Obes',
      pmid: '18180786',
      doi: '10.1038/sj.ijo.0803761',
    },
    {
      id: 'chawla2020',
      authors: 'Chawla S, Tessarolo Silva F, Amaral Medeiros S, Mekary RA, Radenkovic D',
      year: 2020,
      title:
        'The effect of low-fat and low-carbohydrate diets on weight loss and lipid levels: a systematic review and meta-analysis',
      journal: 'Nutrients',
      pmid: '33317019',
      doi: '10.3390/nu12123774',
    },
    {
      id: 'chiavaroli2015',
      authors: 'Chiavaroli L, et al.',
      year: 2015,
      title:
        'Effect of fructose on established lipid targets: a systematic review and meta-analysis of controlled feeding trials',
      journal: 'J Am Heart Assoc',
      pmid: '26358358',
      doi: '10.1161/JAHA.114.001700',
    },
    {
      id: 'chiavaroli2018',
      authors: 'Chiavaroli L, et al.',
      year: 2018,
      title:
        'Portfolio dietary pattern and cardiovascular disease: a systematic review and meta-analysis of controlled trials',
      journal: 'Prog Cardiovasc Dis',
      pmid: '29807048',
      doi: '10.1016/j.pcad.2018.05.004',
    },
    {
      id: 'chiu2014',
      authors: 'Chiu S, et al.',
      year: 2014,
      title:
        'Effect of fructose on markers of NAFLD: a systematic review and meta-analysis of controlled feeding trials',
      journal: 'Eur J Clin Nutr',
      pmid: '24569542',
      doi: '10.1038/ejcn.2014.8',
    },
    {
      id: 'chiu2017',
      authors: 'Chiu S, Williams PT, Krauss RM',
      year: 2017,
      title:
        'Effects of a very high saturated fat diet on LDL particles in adults with atherogenic dyslipidemia: a randomized controlled trial',
      journal: 'PLoS One',
      pmid: '28166253',
      doi: '10.1371/journal.pone.0170664',
    },
    {
      id: 'choi2004a',
      authors: 'Choi HK, et al.',
      year: 2004,
      title: 'Alcohol intake and risk of incident gout in men: a prospective study',
      journal: 'Lancet',
      pmid: '15094272',
      doi: '10.1016/S0140-6736(04)16000-5',
    },
    {
      id: 'choi2004b',
      authors: 'Choi HK, et al.',
      year: 2004,
      title: 'Purine-rich foods, dairy and protein intake, and the risk of gout in men',
      journal: 'N Engl J Med',
      pmid: '15014182',
      doi: '10.1056/NEJMoa035700',
    },
    {
      id: 'clarke1997',
      authors: 'Clarke R, Frost C, Collins R, Appleby P, Peto R',
      year: 1997,
      title: 'Dietary lipids and blood cholesterol: quantitative meta-analysis of metabolic ward studies',
      journal: 'BMJ',
      pmid: '9006469',
      doi: '10.1136/bmj.314.7074.112',
    },
    {
      id: 'cohen2008',
      authors: 'Cohen RM, et al.',
      year: 2008,
      title: 'Red cell life span heterogeneity in hematologically normal people is sufficient to alter HbA1c',
      journal: 'Blood',
      pmid: '18694998',
      doi: '10.1182/blood-2008-04-154112',
    },
    {
      id: 'cornelissen2013',
      authors: 'Cornelissen VA, et al.',
      year: 2013,
      title: 'Exercise training for blood pressure: a systematic review and meta-analysis',
      journal: 'J Am Heart Assoc',
      pmid: '23525435',
      doi: '10.1161/JAHA.112.004473',
    },
    {
      id: 'dattilo1992',
      authors: 'Dattilo AM, Kris-Etherton PM',
      year: 1992,
      title: 'Effects of weight reduction on blood lipids and lipoproteins: a meta-analysis',
      journal: 'Am J Clin Nutr',
      pmid: '1386186',
      doi: '10.1093/ajcn/56.2.320',
    },
    {
      id: 'delgobbo2015',
      authors: 'Del Gobbo LC, et al.',
      year: 2015,
      title:
        'Effects of tree nuts on blood lipids, apolipoproteins, and blood pressure: systematic review, meta-analysis, and dose-response of 61 controlled intervention trials',
      journal: 'Am J Clin Nutr',
      pmid: '26561616',
      doi: '10.3945/ajcn.115.110965',
    },
    {
      id: 'demonty2009',
      authors: 'Demonty I, et al.',
      year: 2009,
      title:
        'Continuous dose-response relationship of the LDL-cholesterol-lowering effect of phytosterol intake',
      journal: 'J Nutr',
      pmid: '19091798',
      doi: '10.3945/jn.108.095125',
    },
    {
      id: 'dessein2000',
      authors: 'Dessein PH, et al.',
      year: 2000,
      title:
        'Beneficial effects of weight loss associated with moderate calorie/carbohydrate restriction, and increased proportional intake of protein and unsaturated fat on serum urate and lipoprotein levels in gout: a pilot study',
      journal: 'Ann Rheum Dis',
      pmid: '10873964',
      doi: '10.1136/ard.59.7.539',
    },
    {
      id: 'elijovich2016',
      authors: 'Elijovich F, et al.',
      year: 2016,
      title: 'Salt sensitivity of blood pressure: a scientific statement from the American Heart Association',
      journal: 'Hypertension',
      pmid: '27443572',
      doi: '10.1161/HYP.0000000000000047',
      verification: 'unverified',
    },
    {
      id: 'eslick2009',
      authors: 'Eslick GD, et al.',
      year: 2009,
      title: 'Benefits of fish oil supplementation in hyperlipidemia: a systematic review and meta-analysis',
      journal: 'Int J Cardiol',
      pmid: '18774613',
      doi: '10.1016/j.ijcard.2008.03.092',
    },
    {
      id: 'faller1982',
      authors: 'Faller J, et al.',
      year: 1982,
      title:
        'Ethanol-induced hyperuricemia: evidence for increased urate production by activation of adenine nucleotide turnover',
      journal: 'N Engl J Med',
      pmid: '7144847',
      doi: '10.1056/NEJM198212233072602',
    },
    {
      id: 'fedewa2017',
      authors: 'Fedewa MV, et al.',
      year: 2017,
      title:
        'Effect of exercise training on C reactive protein: a systematic review and meta-analysis of randomised and non-randomised controlled trials',
      journal: 'Br J Sports Med',
      pmid: '27445361',
      doi: '10.1136/bjsports-2016-095999',
    },
    {
      id: 'feldman2022',
      authors: 'Feldman D et al.',
      year: 2022,
      title:
        'Short-term hyper-caloric high-fat feeding on a ketogenic diet can lower LDL cholesterol: the cholesterol drop experiment',
      journal: 'Curr Opin Endocrinol Diabetes Obes',
      pmid: '35938774',
      doi: '10.1097/MED.0000000000000762',
    },
    {
      id: 'ference2019',
      authors: 'Ference BA, et al.',
      year: 2019,
      title:
        'Association of triglyceride-lowering LPL variants and LDL-C-lowering LDLR variants with risk of coronary heart disease',
      journal: 'JAMA',
      pmid: '30694319',
      doi: '10.1001/jama.2018.20045',
    },
    {
      id: 'filippini2020',
      authors: 'Filippini T, et al.',
      year: 2020,
      title:
        'Potassium intake and blood pressure: a dose-response meta-analysis of randomized controlled trials',
      journal: 'J Am Heart Assoc',
      pmid: '32500831',
      doi: '10.1161/JAHA.119.015719',
    },
    {
      id: 'filippini2021',
      authors: 'Filippini T, et al.',
      year: 2021,
      title:
        'Blood pressure effects of sodium reduction: dose-response meta-analysis of experimental studies',
      journal: 'Circulation',
      pmid: '33586450',
      doi: '10.1161/CIRCULATIONAHA.120.050371',
    },
    {
      id: 'follis2026',
      authors: 'Follis S et al.',
      year: 2026,
      title:
        'Effect of low-carbohydrate vs low-fat diet intervention on visceral fat estimated from DXA in a 12-month randomized controlled trial',
      journal: 'Int J Obes',
      pmid: '41436888',
      doi: '10.1038/s41366-025-01989-x',
    },
    {
      id: 'fu2022',
      authors: 'Fu L, et al.',
      year: 2022,
      title:
        'Associations between dietary fiber intake and cardiovascular risk factors: an umbrella review of meta-analyses of randomized controlled trials',
      journal: 'Front Nutr',
      pmid: '36172520',
      doi: '10.3389/fnut.2022.972399',
    },
    {
      id: 'gardner2018',
      authors: 'Gardner CD, et al.',
      year: 2018,
      title:
        'Effect of low-fat vs low-carbohydrate diet on 12-month weight loss in overweight adults and the association with genotype pattern or insulin secretion: the DIETFITS randomized clinical trial',
      journal: 'JAMA',
      pmid: '29466592',
      doi: '10.1001/jama.2018.0245',
    },
    {
      id: 'ge2020',
      authors: 'Ge L, Sadeghirad B, Ball GDC, et al.',
      year: 2020,
      title:
        'Comparison of dietary macronutrient patterns of 14 popular named dietary programmes for weight and cardiovascular risk factor reduction in adults: systematic review and network meta-analysis of randomised trials',
      journal: 'BMJ',
      pmid: '32238384',
      doi: '10.1136/bmj.m696',
    },
    {
      id: 'gohari2023',
      authors: 'Gohari S et al.',
      year: 2023,
      title:
        'The effect of DASH and ketogenic diets on serum uric acid concentration: a systematic review and meta-analysis of RCTs',
      journal: 'Sci Rep',
      pmid: '37380733',
      doi: '10.1038/s41598-023-37672-2',
    },
    {
      id: 'goldfinger1965',
      authors: 'Goldfinger S, et al.',
      year: 1965,
      title: 'Renal retention of uric acid induced by infusion of beta-hydroxybutyrate and acetoacetate',
      journal: 'N Engl J Med',
      pmid: '14239117',
      doi: '10.1056/NEJM196502182720705',
    },
    {
      id: 'graudal2017',
      authors: 'Graudal NA, et al.',
      year: 2017,
      title:
        'Effects of low sodium diet versus high sodium diet on blood pressure, renin, aldosterone, catecholamines, cholesterol, and triglyceride',
      journal: 'Cochrane Database Syst Rev',
      pmid: '28391629',
      doi: '10.1002/14651858.CD004022.pub4',
    },
    {
      id: 'grundler2024',
      authors: 'Grundler F, et al.',
      year: 2024,
      title: 'Long-term fasting-induced ketosis in 1610 subjects: metabolic regulation and safety',
      journal: 'Nutrients',
      pmid: '38931204',
    },
    {
      id: 'guo2019',
      authors: 'Guo XF, et al.',
      year: 2019,
      title: 'Effects of EPA and DHA on blood pressure and inflammatory factors: a meta-analysis of RCTs',
      journal: 'Crit Rev Food Sci Nutr',
      pmid: '29993265',
      doi: '10.1080/10408398.2018.1492901',
    },
    {
      id: 'halbert1999',
      authors: 'Halbert JA, et al.',
      year: 1999,
      title:
        'Exercise training and blood lipids in hyperlipidemic and normolipidemic adults: a meta-analysis of randomized, controlled trials',
      journal: 'Eur J Clin Nutr',
      pmid: '10452405',
    },
    {
      id: 'hall2015',
      authors: 'Hall KD, et al.',
      year: 2015,
      title:
        'Calorie for calorie, dietary fat restriction results in more body fat loss than carbohydrate restriction in people with obesity',
      journal: 'Cell Metab',
      pmid: '26278052',
      doi: '10.1016/j.cmet.2015.07.021',
    },
    {
      id: 'harris2018',
      authors: 'Harris WS',
      year: 2018,
      title: 'The omega-6:omega-3 ratio: a critical appraisal and possible successor',
      journal: 'Prostaglandins Leukot Essent Fatty Acids',
      pmid: '29599053',
      doi: '10.1016/j.plefa.2018.03.003',
    },
    {
      id: 'hashida2017',
      authors: 'Hashida R, et al.',
      year: 2017,
      title: 'Aerobic vs. resistance exercise in non-alcoholic fatty liver disease: a systematic review',
      journal: 'J Hepatol',
      pmid: '27639843',
      doi: '10.1016/j.jhep.2016.08.023',
    },
    {
      id: 'he2013',
      authors: 'He FJ, Li J, MacGregor GA',
      year: 2013,
      title:
        'Effect of longer term modest salt reduction on blood pressure: Cochrane systematic review and meta-analysis of randomised trials',
      journal: 'BMJ',
      pmid: '23558162',
      doi: '10.1136/bmj.f1325',
    },
    {
      id: 'hegsted1965',
      authors: 'Hegsted DM, McGandy RB, Myers ML, Stare FJ',
      year: 1965,
      title: 'Quantitative effects of dietary fat on serum cholesterol in man',
      journal: 'Am J Clin Nutr',
      pmid: '5846902',
      verification: 'abstract',
    },
    {
      id: 'hegsted1986',
      authors: 'Hegsted DM',
      year: 1986,
      title: 'Serum-cholesterol response to dietary cholesterol: a re-evaluation',
      journal: 'Am J Clin Nutr',
      pmid: '3524188',
    },
    {
      id: 'hegsted1993',
      authors: 'Hegsted DM, Ausman LM, Johnson JA, Dallal GE',
      year: 1993,
      title: 'Dietary fat and serum lipids: an evaluation of the experimental data',
      journal: 'Am J Clin Nutr',
      pmid: '8503356',
    },
    {
      id: 'ho2016',
      authors: 'Ho HV, et al.',
      year: 2016,
      title: 'Barley beta-glucan on LDL-C, non-HDL-C and apoB',
      journal: 'Eur J Clin Nutr',
      pmid: '27273067',
      doi: '10.1038/ejcn.2016.89',
    },
    {
      id: 'ho2017',
      authors: 'Ho HVT, et al.',
      year: 2017,
      title: 'Konjac glucomannan on LDL-C, non-HDL-C and apoB',
      journal: 'Am J Clin Nutr',
      pmid: '28356275',
      doi: '10.3945/ajcn.116.142158',
    },
    {
      id: 'hooper2018',
      authors: 'Hooper L, et al.',
      year: 2018,
      title: 'Omega-6 fats for the primary and secondary prevention of cardiovascular disease',
      journal: 'Cochrane Database Syst Rev',
      pmid: '30488422',
      doi: '10.1002/14651858.CD011094.pub4',
    },
    {
      id: 'hu2012',
      authors: 'Hu T, Mills KT, Yao L, et al.',
      year: 2012,
      title:
        'Effects of low-carbohydrate diets versus low-fat diets on metabolic risk factors: a meta-analysis of randomized controlled clinical trials',
      journal: 'Am J Epidemiol',
      pmid: '23035144',
      doi: '10.1093/aje/kws264',
    },
    {
      id: 'jenkins2003',
      authors: 'Jenkins DJ, et al.',
      year: 2003,
      title:
        'Effects of a dietary portfolio of cholesterol-lowering foods vs lovastatin on serum lipids and C-reactive protein',
      journal: 'JAMA',
      pmid: '12876093',
      doi: '10.1001/jama.290.4.502',
    },
    {
      id: 'johnson2009',
      authors: 'Johnson NA, et al.',
      year: 2009,
      title:
        'Aerobic exercise training reduces hepatic and visceral lipids in obese individuals without weight loss',
      journal: 'Hepatology',
      pmid: '19637289',
      doi: '10.1002/hep.23129',
    },
    {
      id: 'johnson2012',
      authors: 'Johnson GH, et al.',
      year: 2012,
      title:
        'Effect of dietary linoleic acid on markers of inflammation in healthy persons: a systematic review of randomized controlled trials',
      journal: 'J Acad Nutr Diet',
      pmid: '22889633',
      doi: '10.1016/j.jand.2012.03.029',
    },
    {
      id: 'jovanovski2018',
      authors: 'Jovanovski E, et al.',
      year: 2018,
      title:
        'Effect of psyllium fiber on LDL cholesterol and alternative lipid targets, non-HDL cholesterol and apolipoprotein B: a systematic review and meta-analysis of RCTs',
      journal: 'Am J Clin Nutr',
      pmid: '30239559',
      doi: '10.1093/ajcn/nqy115',
    },
    {
      id: 'jovanovski2023',
      authors: 'Jovanovski E et al.',
      year: 2023,
      title: 'Are all fibres created equal with respect to lipid lowering?',
      journal: 'Br J Nutr',
      pmid: '35929339',
      doi: '10.1017/S0007114522002355',
    },
    {
      id: 'juraschek2017',
      authors: 'Juraschek SP, et al.',
      year: 2017,
      title: 'Time course of change in blood pressure from sodium reduction and the DASH diet',
      journal: 'Hypertension',
      pmid: '28993451',
      doi: '10.1161/HYPERTENSIONAHA.117.10017',
    },
    {
      id: 'juraschek2021',
      authors: 'Juraschek SP, et al.',
      year: 2021,
      title:
        'Effects of dietary patterns on serum urate: results from a randomized trial of the effects of diet on hypertension',
      journal: 'Arthritis Rheumatol',
      pmid: '33615722',
      doi: '10.1002/art.41614',
    },
    {
      id: 'katan1987',
      authors: 'Katan MB, Beynen AC',
      year: 1987,
      title: 'Characteristics of human hypo- and hyperresponders to dietary cholesterol',
      journal: 'Am J Epidemiol',
      pmid: '3544818',
    },
    {
      id: 'keating2015',
      authors: 'Keating SE, et al.',
      year: 2015,
      title: 'Effect of aerobic exercise training dose on liver fat and visceral adiposity',
      journal: 'J Hepatol',
      pmid: '25863524',
      doi: '10.1016/j.jhep.2015.02.022',
    },
    {
      id: 'kelley2009',
      authors: 'Kelley GA, et al.',
      year: 2009,
      title:
        'Impact of progressive resistance training on lipids and lipoproteins in adults: a meta-analysis of randomized controlled trials',
      journal: 'Prev Med',
      pmid: '19013187',
      doi: '10.1016/j.ypmed.2008.10.010',
    },
    {
      id: 'kelley2012',
      authors: 'Kelley GA, et al.',
      year: 2012,
      title:
        'Comparison of aerobic exercise, diet or both on lipids and lipoproteins in adults: a meta-analysis of RCTs',
      journal: 'Clin Nutr',
      pmid: '22154987',
      doi: '10.1016/j.clnu.2011.11.011',
    },
    {
      id: 'keys1965',
      authors: 'Keys A, Anderson JT, Grande F',
      year: 1965,
      title: 'Serum cholesterol response to changes in the diet. II. The effect of cholesterol in the diet',
      journal: 'Metabolism',
      pmid: '25286460',
      doi: '10.1016/0026-0495(65)90002-8',
    },
    {
      id: 'khalafi2022',
      authors: 'Khalafi M, et al.',
      year: 2022,
      title:
        'The impact of exercise training versus caloric restriction on inflammation markers: a systemic review and meta-analysis',
      journal: 'Crit Rev Food Sci Nutr',
      pmid: '33506692',
      doi: '10.1080/10408398.2021.1873732',
    },
    {
      id: 'khodarahmi2025',
      authors: 'Khodarahmi M et al.',
      year: 2025,
      title:
        'Effect of low-carbohydrate diets on C-reactive protein level in adults: a systematic review and meta-analysis of RCTs',
      journal: 'Food Sci Nutr',
      pmid: '40688603',
      doi: '10.1002/fsn3.70566',
    },
    {
      id: 'kirk2009',
      authors: 'Kirk E, et al.',
      year: 2009,
      title:
        'Dietary fat and carbohydrates differentially alter insulin sensitivity during caloric restriction',
      journal: 'Gastroenterology',
      pmid: '19208352',
      doi: '10.1053/j.gastro.2009.01.048',
    },
    {
      id: 'kodama2007',
      authors: 'Kodama S, et al.',
      year: 2007,
      title:
        'Effect of aerobic exercise training on serum levels of high-density lipoprotein cholesterol: a meta-analysis',
      journal: 'Arch Intern Med',
      pmid: '17533202',
      doi: '10.1001/archinte.167.10.999',
    },
    {
      id: 'krauss2006',
      authors: 'Krauss RM, et al.',
      year: 2006,
      title: 'Separate effects of reduced carbohydrate intake and weight loss on atherogenic dyslipidemia',
      journal: 'Am J Clin Nutr',
      pmid: '16685042',
      doi: '10.1093/ajcn/83.5.1025',
    },
    {
      id: 'lim2011',
      authors: 'Lim EL, et al.',
      year: 2011,
      title:
        'Reversal of type 2 diabetes: normalisation of beta cell function in association with decreased pancreas and liver triacylglycerol',
      journal: 'Diabetologia',
      pmid: '21656330',
      doi: '10.1007/s00125-011-2204-7',
    },
    {
      id: 'luukkonen2018',
      authors: 'Luukkonen PK, et al.',
      year: 2018,
      title:
        'Saturated fat is more metabolically harmful for the human liver than unsaturated fat or simple sugars',
      journal: 'Diabetes Care',
      pmid: '29844096',
      doi: '10.2337/dc18-0071',
    },
    {
      id: 'macdonald2016',
      authors: 'MacDonald HV, et al.',
      year: 2016,
      title: 'Dynamic resistance training as stand-alone antihypertensive lifestyle therapy: a meta-analysis',
      journal: 'J Am Heart Assoc',
      pmid: '27680663',
      doi: '10.1161/JAHA.116.003231',
    },
    {
      id: 'maersk2012',
      authors: 'Maersk M, et al.',
      year: 2012,
      title:
        'Sucrose-sweetened beverages increase fat storage in the liver, muscle, and visceral fat depot: a 6-mo randomized intervention study',
      journal: 'Am J Clin Nutr',
      pmid: '22205311',
      doi: '10.3945/ajcn.111.022533',
    },
    {
      id: 'magkos2016',
      authors: 'Magkos F, et al.',
      year: 2016,
      title:
        'Effects of moderate and subsequent progressive weight loss on metabolic function and adipose tissue biology in humans with obesity',
      journal: 'Cell Metab',
      pmid: '26916363',
      doi: '10.1016/j.cmet.2016.02.005',
    },
    {
      id: 'mansoor2016',
      authors: 'Mansoor N, Vinknes KJ, Veierød MB, Retterstøl K',
      year: 2016,
      title:
        'Effects of low-carbohydrate diets v. low-fat diets on body weight and cardiovascular risk factors: a meta-analysis of randomised controlled trials',
      journal: 'Br J Nutr',
      pmid: '26768850',
      doi: '10.1017/S0007114515004699',
    },
    {
      id: 'mardinoglu2018',
      authors: 'Mardinoglu A, et al.',
      year: 2018,
      title:
        'An integrated understanding of the rapid metabolic benefits of a carbohydrate-restricted diet on hepatic steatosis in humans',
      journal: 'Cell Metab',
      pmid: '29456073',
      doi: '10.1016/j.cmet.2018.01.005',
    },
    {
      id: 'marklund2019',
      authors: 'Marklund M, et al.',
      year: 2019,
      title: 'Biomarkers of dietary omega-6 fatty acids and incident cardiovascular disease and mortality',
      journal: 'Circulation',
      pmid: '30971107',
      doi: '10.1161/CIRCULATIONAHA.118.038908',
    },
    {
      id: 'mensink1992',
      authors: 'Mensink RP, Katan MB',
      year: 1992,
      title: 'Effect of dietary fatty acids on serum lipids and lipoproteins. A meta-analysis of 27 trials',
      journal: 'Arterioscler Thromb',
      pmid: '1386252',
      doi: '10.1161/01.atv.12.8.911',
    },
    {
      id: 'mensink2003',
      authors: 'Mensink RP, Zock PL, Kester AD, Katan MB',
      year: 2003,
      title:
        'Effects of dietary fatty acids and carbohydrates on the ratio of serum total to HDL cholesterol and on serum lipids and apolipoproteins: a meta-analysis of 60 controlled trials',
      journal: 'Am J Clin Nutr',
      pmid: '12716665',
      doi: '10.1093/ajcn/77.5.1146',
    },
    {
      id: 'mensink2016',
      authors: 'Mensink RP',
      year: 2016,
      title:
        'Effects of saturated fatty acids on serum lipids and lipoproteins: a systematic review and regression analysis',
      journal: 'World Health Organization, Geneva',
      url: 'https://www.foodstandards.gov.au/sites/default/files/publications/Documents/Supporting%20Document%201_Mensink_compiled%2018_July_RM.pdf',
    },
    {
      id: 'merlotti2017',
      authors: 'Merlotti C, et al.',
      year: 2017,
      title:
        'Subcutaneous fat loss is greater than visceral fat loss with diet and exercise, weight-loss promoting drugs and bariatric surgery: a critical review and meta-analysis',
      journal: 'Int J Obes',
      pmid: '28148928',
      doi: '10.1038/ijo.2017.31',
    },
    {
      id: 'millar2005',
      authors: 'Millar JS, et al.',
      year: 2005,
      title:
        'Complete deficiency of the low-density lipoprotein receptor is associated with increased apolipoprotein B-100 production',
      journal: 'Arterioscler Thromb Vasc Biol',
      pmid: '15637307',
      doi: '10.1161/01.ATV.0000155323.18856.a2',
    },
    {
      id: 'nathan2008',
      authors: 'Nathan DM, et al.',
      year: 2008,
      title: 'Translating the A1C assay into estimated average glucose values',
      journal: 'Diabetes Care',
      pmid: '18540046',
      doi: '10.2337/dc08-0545',
    },
    {
      id: 'neelakantan2020',
      authors: 'Neelakantan N, et al.',
      year: 2020,
      title:
        'The effect of coconut oil consumption on cardiovascular risk factors: a systematic review and meta-analysis of clinical trials',
      journal: 'Circulation',
      pmid: '31928080',
      doi: '10.1161/CIRCULATIONAHA.119.043052',
    },
    {
      id: 'neter2003',
      authors: 'Neter JE, Stam BE, Kok FJ, Grobbee DE, Geleijnse JM',
      year: 2003,
      title:
        'Influence of weight reduction on blood pressure: a meta-analysis of randomized controlled trials',
      journal: 'Hypertension',
      pmid: '12975389',
      doi: '10.1161/01.HYP.0000094221.86888.AE',
    },
    {
      id: 'nielsen2017',
      authors: 'Nielsen SM, et al.',
      year: 2017,
      title:
        'Weight loss for overweight and obese individuals with gout: a systematic review of longitudinal studies',
      journal: 'Ann Rheum Dis',
      pmid: '28866649',
      doi: '10.1136/annrheumdis-2017-211472',
    },
    {
      id: 'norwitz2022a',
      authors: 'Norwitz NG, Feldman D, Soto-Mota A, Kalayjian T, Ludwig DS',
      year: 2022,
      title:
        'Elevated LDL cholesterol with a carbohydrate-restricted diet: evidence for a "lean mass hyper-responder" phenotype',
      journal: 'Curr Dev Nutr',
      pmid: '35106434',
      doi: '10.1093/cdn/nzab144',
    },
    {
      id: 'norwitz2022b',
      authors: 'Norwitz NG et al.',
      year: 2022,
      title:
        'Case report: hypercholesterolemia "lean mass hyper-responder" phenotype presents in the context of a low saturated fat carbohydrate-restricted diet',
      journal: 'Front Endocrinol',
      pmid: '35498420',
      doi: '10.3389/fendo.2022.830325',
    },
    {
      id: 'ohkawara2007',
      authors: 'Ohkawara K, et al.',
      year: 2007,
      title:
        'A dose-response relation between aerobic exercise and visceral fat reduction: systematic review of clinical trials',
      journal: 'Int J Obes',
      pmid: '17637702',
      doi: '10.1038/sj.ijo.0803683',
    },
    {
      id: 'pepys2003',
      authors: 'Pepys MB, Hirschfield GM',
      year: 2003,
      title: 'C-reactive protein: a critical update',
      journal: 'J Clin Invest',
      pmid: '12813013',
      doi: '10.1172/JCI18921',
    },
    {
      id: 'pescatello2004',
      authors: 'Pescatello LS, et al.',
      year: 2004,
      title: 'ACSM position stand. Exercise and hypertension',
      journal: 'Med Sci Sports Exerc',
      pmid: '15076798',
      doi: '10.1249/01.mss.0000115224.88514.3a',
    },
    {
      id: 'petersen2005',
      authors: 'Petersen KF, et al.',
      year: 2005,
      title:
        'Reversal of nonalcoholic hepatic steatosis, hepatic insulin resistance, and hyperglycemia by moderate weight reduction in patients with type 2 diabetes',
      journal: 'Diabetes',
      pmid: '15734833',
      doi: '10.2337/diabetes.54.3.603',
    },
    {
      id: 'petersen2026',
      authors: 'Petersen MC et al.',
      year: 2026,
      title:
        'Effect of diet macronutrient content on the cardiometabolic response to weight loss: a randomized clinical trial',
      journal: 'Cell Metab',
      pmid: '42660124',
      doi: '10.1016/j.cmet.2026.07.020',
    },
    {
      id: 'poobalan2004',
      authors: 'Poobalan A, et al.',
      year: 2004,
      title:
        'Effects of weight loss in overweight/obese individuals and long-term lipid outcomes: a systematic review',
      journal: 'Obes Rev',
      pmid: '14969506',
      doi: '10.1111/j.1467-789x.2004.00127.x',
    },
    {
      id: 'qadri2026',
      authors: 'Qadri SF et al.',
      year: 2026,
      title:
        'Distinct effects of ketogenic and non-ketogenic weight-loss diets on hepatic steatosis and mitochondrial metabolism in MASLD',
      journal: 'J Hepatol',
      pmid: '41655910',
      doi: '10.1016/j.jhep.2026.02.001',
    },
    {
      id: 'ramsden2013',
      authors: 'Ramsden CE, et al.',
      year: 2013,
      title:
        'Use of dietary linoleic acid for secondary prevention of coronary heart disease and death: evaluation of recovered data from the Sydney Diet Heart Study and updated meta-analysis',
      journal: 'BMJ',
      pmid: '23386268',
      doi: '10.1136/bmj.e8707',
    },
    {
      id: 'ras2014',
      authors: 'Ras RT, et al.',
      year: 2014,
      title:
        'LDL-cholesterol-lowering effect of plant sterols and stanols across different dose ranges: a meta-analysis of randomised controlled studies',
      journal: 'Br J Nutr',
      pmid: '24780090',
      doi: '10.1017/S0007114514000750',
    },
    {
      id: 'rett2011',
      authors: 'Rett BS, et al.',
      year: 2011,
      title:
        'Increasing dietary linoleic acid does not increase tissue arachidonic acid content in adults consuming Western-type diets: a systematic review',
      journal: 'Nutr Metab (Lond)',
      pmid: '21663641',
      doi: '10.1186/1743-7075-8-36',
    },
    {
      id: 'retterstol2018',
      authors: 'Retterstøl K, et al.',
      year: 2018,
      title:
        'Effect of low carbohydrate high fat diet on LDL cholesterol and gene expression in normal-weight, young adults: a randomized controlled study',
      journal: 'Atherosclerosis',
      pmid: '30408717',
      doi: '10.1016/j.atherosclerosis.2018.10.013',
    },
    {
      id: 'rimm1999',
      authors: 'Rimm EB, et al.',
      year: 1999,
      title:
        'Moderate alcohol intake and lower risk of coronary heart disease: meta-analysis of effects on lipids and haemostatic factors',
      journal: 'BMJ',
      pmid: '10591709',
      doi: '10.1136/bmj.319.7224.1523',
    },
    {
      id: 'roerecke2017',
      authors: 'Roerecke M, et al.',
      year: 2017,
      title:
        'The effect of a reduction in alcohol consumption on blood pressure: a systematic review and meta-analysis',
      journal: 'Lancet Public Health',
      pmid: '29253389',
      doi: '10.1016/S2468-2667(17)30003-8',
    },
    {
      id: 'rosqvist2014',
      authors: 'Rosqvist F, et al.',
      year: 2014,
      title:
        'Overfeeding polyunsaturated and saturated fat causes distinct effects on liver and visceral fat accumulation in humans',
      journal: 'Diabetes',
      pmid: '24550191',
      doi: '10.2337/db13-1622',
    },
    {
      id: 'rosqvist2019',
      authors: 'Rosqvist F, et al.',
      year: 2019,
      title:
        'Overeating saturated fat promotes fatty liver and ceramides compared with polyunsaturated fat: a randomized trial',
      journal: 'J Clin Endocrinol Metab',
      pmid: '31369090',
      doi: '10.1210/jc.2019-00160',
    },
    {
      id: 'sabate2010',
      authors: 'Sabaté J, et al.',
      year: 2010,
      title: 'Nut consumption and blood lipid levels: a pooled analysis of 25 intervention trials',
      journal: 'Arch Intern Med',
      pmid: '20458092',
      doi: '10.1001/archinternmed.2010.79',
    },
    {
      id: 'sacks2001',
      authors: 'Sacks FM, et al.',
      year: 2001,
      title: 'Effects on blood pressure of reduced dietary sodium and the DASH diet',
      journal: 'N Engl J Med',
      pmid: '11136953',
      doi: '10.1056/NEJM200101043440101',
    },
    {
      id: 'sacks2009',
      authors: 'Sacks FM, et al.',
      year: 2009,
      title: 'Comparison of weight-loss diets with different compositions of fat, protein, and carbohydrates',
      journal: 'N Engl J Med',
      pmid: '19246357',
      doi: '10.1056/NEJMoa0804748',
    },
    {
      id: 'schwingshackl2014',
      authors: 'Schwingshackl L, et al.',
      year: 2014,
      title:
        'Mediterranean dietary pattern, inflammation and endothelial function: a systematic review and meta-analysis of intervention trials',
      journal: 'Nutr Metab Cardiovasc Dis',
      pmid: '24787907',
      doi: '10.1016/j.numecd.2014.03.003',
    },
    {
      id: 'selvin2007',
      authors: 'Selvin E, et al.',
      year: 2007,
      title: 'The effect of weight loss on C-reactive protein: a systematic review',
      journal: 'Arch Intern Med',
      pmid: '17210875',
      doi: '10.1001/archinte.167.1.31',
    },
    {
      id: 'sevastianova2012',
      authors: 'Sevastianova K, et al.',
      year: 2012,
      title:
        'Effect of short-term carbohydrate overfeeding and long-term weight loss on liver fat in overweight humans',
      journal: 'Am J Clin Nutr',
      pmid: '22952180',
      doi: '10.3945/ajcn.112.038695',
    },
    {
      id: 'skulasray2011',
      authors: 'Skulas-Ray AC, et al.',
      year: 2011,
      title:
        'Dose-response effects of omega-3 fatty acids on triglycerides, inflammation, and endothelial function in healthy persons with moderate hypertriglyceridemia',
      journal: 'Am J Clin Nutr',
      pmid: '21159789',
      doi: '10.3945/ajcn.110.003871',
    },
    {
      id: 'skulasray2019',
      authors: 'Skulas-Ray AC, et al.',
      year: 2019,
      title:
        'Omega-3 fatty acids for the management of hypertriglyceridemia: a science advisory from the American Heart Association',
      journal: 'Circulation',
      pmid: '31422671',
      doi: '10.1161/CIR.0000000000000709',
    },
    {
      id: 'slentz2007',
      authors: 'Slentz CA, et al.',
      year: 2007,
      title: 'Inactivity, exercise training and detraining, and plasma lipoproteins. STRRIDE',
      journal: 'J Appl Physiol',
      pmid: '17395756',
      doi: '10.1152/japplphysiol.01314.2006',
    },
    {
      id: 'sotomota2023',
      authors: 'Soto-Mota A et al.',
      year: 2023,
      title: 'Evidence for the carbohydrate-insulin model in a reanalysis of the DIETFITS trial',
      journal: 'Am J Clin Nutr',
      pmid: '36811468',
      doi: '10.1016/j.ajcnut.2022.12.014',
    },
    {
      id: 'stanhope2009',
      authors: 'Stanhope KL, et al.',
      year: 2009,
      title:
        'Consuming fructose-sweetened, not glucose-sweetened, beverages increases visceral adiposity and lipids and decreases insulin sensitivity in overweight/obese humans',
      journal: 'J Clin Invest',
      pmid: '19381015',
      doi: '10.1172/JCI37385',
    },
    {
      id: 'szczepaniak2005',
      authors: 'Szczepaniak LS, et al.',
      year: 2005,
      title:
        'Magnetic resonance spectroscopy to measure hepatic triglyceride content: prevalence of hepatic steatosis in the general population',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '15339742',
      doi: '10.1152/ajpendo.00064.2004',
    },
    {
      id: 'tahara1995',
      authors: 'Tahara Y, et al.',
      year: 1995,
      title:
        'Kinetics of HbA1c, glycated albumin, and fructosamine and analysis of their weight functions against preceding plasma glucose level',
      journal: 'Diabetes Care',
      pmid: '7497851',
      doi: '10.2337/diacare.18.4.440',
    },
    {
      id: 'temorenga2014',
      authors: 'Te Morenga LA, et al.',
      year: 2014,
      title:
        'Dietary sugars and cardiometabolic risk: systematic review and meta-analyses of randomized controlled trials of the effects on blood pressure and lipids',
      journal: 'Am J Clin Nutr',
      pmid: '24808490',
      doi: '10.3945/ajcn.113.081521',
    },
    {
      id: 'tokede2015',
      authors: 'Tokede OA, et al.',
      year: 2015,
      title: 'Soya products and serum lipids: a meta-analysis of randomised controlled trials',
      journal: 'Br J Nutr',
      pmid: '26268987',
      doi: '10.1017/S0007114515002603',
    },
    {
      id: 'verheggen2016',
      authors: 'Verheggen RJ, et al.',
      year: 2016,
      title:
        'A systematic review and meta-analysis on the effects of exercise training versus hypocaloric diet: distinct effects on body weight and visceral adipose tissue',
      journal: 'Obes Rev',
      pmid: '27213481',
      doi: '10.1111/obr.12406',
    },
    {
      id: 'vilargomez2015',
      authors: 'Vilar-Gomez E, et al.',
      year: 2015,
      title:
        'Weight loss through lifestyle modification significantly reduces features of nonalcoholic steatohepatitis',
      journal: 'Gastroenterology',
      pmid: '25865049',
      doi: '10.1053/j.gastro.2015.04.005',
    },
    {
      id: 'vissers2013',
      authors: 'Vissers D, et al.',
      year: 2013,
      title:
        'The effect of exercise on visceral adipose tissue in overweight adults: a systematic review and meta-analysis',
      journal: 'PLoS One',
      pmid: '23409182',
      doi: '10.1371/journal.pone.0056415',
    },
    {
      id: 'voight2012',
      authors: 'Voight BF, et al.',
      year: 2012,
      title: 'Plasma HDL cholesterol and risk of myocardial infarction: a mendelian randomisation study',
      journal: 'Lancet',
      pmid: '22607825',
      doi: '10.1016/S0140-6736(12)60312-2',
    },
    {
      id: 'wang2012',
      authors: 'Wang DD, et al.',
      year: 2012,
      title: 'The effects of fructose intake on serum uric acid vary among controlled dietary trials',
      journal: 'J Nutr',
      pmid: '22457397',
      doi: '10.3945/jn.111.151951',
    },
    {
      id: 'wang2023',
      authors: 'Wang T et al.',
      year: 2023,
      title:
        'Association between omega-3 fatty acid intake and dyslipidemia: a continuous dose-response meta-analysis of randomized controlled trials',
      journal: 'J Am Heart Assoc',
      pmid: '37264945',
      doi: '10.1161/JAHA.123.029512',
    },
    {
      id: 'weggemans2001',
      authors: 'Weggemans RM, Zock PL, Katan MB',
      year: 2001,
      title:
        'Dietary cholesterol from eggs increases the ratio of total cholesterol to HDL cholesterol in humans: a meta-analysis',
      journal: 'Am J Clin Nutr',
      pmid: '11333841',
      doi: '10.1093/ajcn/73.5.885',
    },
    {
      id: 'weinberger1986',
      authors: 'Weinberger MH, et al.',
      year: 1986,
      title: 'Definitions and characteristics of sodium sensitivity and blood pressure resistance',
      journal: 'Hypertension',
      pmid: '3522418',
      doi: '10.1161/01.hyp.8.6_pt_2.ii127',
    },
    {
      id: 'whitehead2014',
      authors: 'Whitehead A, et al.',
      year: 2014,
      title:
        'Cholesterol-lowering effects of oat beta-glucan: a meta-analysis of randomized controlled trials',
      journal: 'Am J Clin Nutr',
      pmid: '25411276',
      doi: '10.3945/ajcn.114.086108',
    },
    {
      id: 'wing2011',
      authors: 'Wing RR, et al.',
      year: 2011,
      title:
        'Benefits of modest weight loss in improving cardiovascular risk factors in overweight and obese individuals with type 2 diabetes',
      journal: 'Diabetes Care',
      pmid: '21593294',
      doi: '10.2337/dc10-2415',
    },
    {
      id: 'zomer2016',
      authors: 'Zomer E, et al.',
      year: 2016,
      title:
        'Interventions that cause weight loss and the impact on cardiovascular risk factors: a systematic review and meta-analysis',
      journal: 'Obes Rev',
      pmid: '27324830',
      doi: '10.1111/obr.12433',
    },
  ],
};

export default topic;
