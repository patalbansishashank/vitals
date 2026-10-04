import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '24',
  slug: 'tracking-replanning',
  title: 'Tracking and re-planning',
  scope:
    'How a running plan stays honest once real life starts: how daily weigh-ins are turned into a trend that ignores water noise, how a hidden gap between what is logged and what the body actually does is estimated, when the underlying model is moved to match reality, how adherence is scored without punishing missed logs, and how often a plan is revised. Most of the numbers are engineering choices tuned to be cautious, not measured values, and each mechanism says which.',
  mechanisms: [
    {
      id: '24-weigh-in-noise',
      title: 'A single weigh-in is noisy by about half a percent of body mass, even under good conditions',
      category: 'body',
      summary:
        'Morning weight bounces by water, gut contents and the scale itself. In the longest published run of standardised weighing, one healthy man had a day-to-day spread of 0.53 % of body mass, about 0.4 kg at 75 kg. Real users who weigh at different times will be noisier, so the app assumes a little more for them. Before the trend is estimated, the model subtracts the water it can predict (glycogen and its water, sodium and gut contents), so a carbohydrate change does not look like fat loss.',
      howModelled:
        'Each weigh-in is treated as the true tissue mass plus a random error whose size is a fixed share of body mass: 0.5 % for a morning weigh-in after voiding on the same scale, and 0.65 % otherwise. The scale reading first has the engine’s predicted water removed, and the left-over (the residual) is what the filter sees.',
      equation:
        'observation = scale weight − predicted water\nnoise SD = share × body mass; share = 0.5 % standardised, 0.65 % unstandardised',
      keyNumbers: [
        {
          label: 'Within-person day-to-day spread, standardised morning weighing',
          value: '0.53 % of body mass at one day; 0.69 % at seven days',
          note: 'One healthy man, 9,521 days; so likely lower than for free-living users.',
          referenceIds: ['singlePerson2023'],
        },
        {
          label: 'Default noise share (standardised)',
          value: '0.5 % of body mass (range 0.4–0.8 %)',
          note: 'About 0.375 kg at 75 kg.',
          referenceIds: ['singlePerson2023'],
        },
        {
          label: 'Default noise share (unstandardised, any time of day)',
          value: '0.65 % of body mass (range 0.6–0.7 %)',
          note: 'A proposed fit, a Vitals modelling choice, not a measured value.',
        },
        {
          label: 'Water that moves with carbohydrate changes',
          value:
            'about 2.7 g of water per g of glycogen, up to about 1–2 kg in the first week of low carbohydrate',
          note: 'Taken from the engine’s own water model rather than from a study on tracking.',
        },
      ],
      moderators:
        'Time of day, whether the bladder is empty, the scale and its position, sodium and carbohydrate intake, alcohol, menstrual phase, illness and travel.',
      grade: 'C',
      gradeReason:
        'The 0.53 % figure is a measured value but from one person, and the unstandardised value is a proposed fit.',
      status: 'proposed-fit',
      caveats:
        'Gut-content and weekly-cycle magnitudes were not confirmed against primary data (unverified). The noise share may be higher in a population, and the correct value for free-living users is an open question.',
      referenceIds: ['singlePerson2023'],
      relatedMetricIds: ['scaleWeight', 'waterWeight', 'glycogenWater', 'gutContent'],
      relatedParamIds: ['assimilation.sigmaRel', 'assimilation.sigmaRelUnstd'],
    },
    {
      id: '24-local-linear-trend-filter',
      title: 'A trend filter tracks both weight and its rate of change, with no nine-day lag',
      category: 'body',
      summary:
        'A simple moving average smooths the scale but trails real changes. A local linear trend (Kalman) filter estimates two things at once, the underlying weight and how fast it is changing, and updates them with each weigh-in, trusting each reading only as much as its noise level warrants. With the default settings it behaves like a moving average for the level but also gives a rate estimate and no lag.',
      howModelled:
        'The hidden state is trend weight and rate. Each day the weight carries forward by the rate; small random shocks are allowed to both (to the weight, 0.03 kg a day at 75 kg, and to the rate, 0.005 kg a day per day), scaled with body mass. A weigh-in nudges the state by a gain set by how noisy the reading is compared with the shocks. A missing day only moves the prediction forward, and uncertainty grows with the gap. The filter starts with a rate uncertainty of 0.05 kg a day (0.35 kg a week).',
      equation:
        'state = [trend weight, rate]; next day: weight + rate, rate unchanged\nweigh-in noise² = (noise share × body mass)²; shocks scale linearly with body mass (defaults refer to 75 kg)\ntrend update = prediction + gain × (observation − prediction)',
      keyNumbers: [
        {
          label: 'Shock to weight each day',
          value: '0.03 kg/d at 75 kg (range 0.02–0.05)',
          note: 'A proposed fit. Real mass jitters beyond the rate in ways the model does not track.',
        },
        {
          label: 'Shock to rate each day',
          value: '0.005 kg/d per day at 75 kg (range 0.003–0.01)',
          note: 'A proposed fit. The rate can change over weeks, not over days.',
        },
        {
          label: 'Reference body mass for these shocks',
          value: '75 kg',
        },
        {
          label: 'Starting uncertainty of the rate',
          value: '0.05 kg/d (range 0.02–0.1)',
          note: 'That is 0.35 kg a week.',
        },
        {
          label: 'Steady-state result with the defaults (computed in the design)',
          value: 'gain on weight 0.161; trend SD 0.16 kg; rate SD 0.13 kg/week',
          note: 'At a noise level of 0.4 kg. Behaves like an exponential average of about α = 0.16 for level.',
        },
      ],
      timeCourse:
        'The level responds within days; the rate estimate sharpens over two to four weeks of regular weigh-ins.',
      moderators:
        'Body mass (shocks scale with it), weigh-in frequency, and how much real weight change is happening.',
      grade: 'D',
      gradeReason:
        'The filter form is standard, but the shock sizes are engineering choices to be tuned on logged data, not measured values.',
      status: 'proposed-fit',
      caveats:
        'The first version uses only weight; weight alone cannot separate fat from lean, so the fat and lean split always comes from the physiology engine, never from the filter.',
      referenceIds: ['singlePerson2023'],
      relatedMetricIds: ['scaleWeight', 'fatMass', 'leanMass'],
      relatedParamIds: [
        'assimilation.qW',
        'assimilation.qR',
        'assimilation.refMassKg',
        'assimilation.rateInitSdKgD',
      ],
    },
    {
      id: '24-outliers-events-gaps',
      title: 'Odd weigh-ins, declared events and long gaps make the filter more cautious, never delete data',
      category: 'body',
      summary:
        'A hotel breakfast, a stomach bug or a long run can move the scale by a kilogram without changing body fat. The filter reacts by trusting such readings much less. Nothing is ever thrown away: odd readings are flagged and shown, so the person can say what happened.',
      howModelled:
        'If a reading differs from the prediction by more than 3.5 times its expected spread (about 1.4 kg), its noise is multiplied by 10 for that point and it is flagged. When the person declares an event (illness, travel, a creatine start, a diet break, a new training block), noise is multiplied by 4 for the next 4 days. After 14 or more days without a weigh-in, the trend uncertainty is reset to 1 kg at the next one.',
      keyNumbers: [
        {
          label: 'Unusual reading threshold',
          value: '3.5 standard deviations of the prediction error (range 3–4)',
          note: 'Roughly 1.4 kg at the default settings. A proposed fit, a Vitals modelling choice.',
        },
        {
          label: 'Noise multiplier for an unusual reading',
          value: '× 10',
        },
        {
          label: 'Noise multiplier after a declared event',
          value: '× 4 for 4 days (range 3–5 days)',
        },
        {
          label: 'Gap that resets the trend uncertainty',
          value: '14 days; trend SD set to 1 kg',
        },
      ],
      moderators: 'Illness, travel, alcohol, creatine, salt, menstrual phase, new training.',
      grade: 'D',
      gradeReason: 'Every threshold is a Vitals modelling choice, chosen to be robust, not a measured value.',
      status: 'proposed-fit',
      caveats:
        'The thresholds should be tuned on logged data; real events are partly predictable (creatine water is modelled elsewhere), so the multiplier may be reduced as those models improve.',
      referenceIds: [],
      relatedMetricIds: ['scaleWeight', 'ecfShift'],
      relatedParamIds: [
        'assimilation.outlierSigma',
        'assimilation.outlierRMult',
        'assimilation.eventRMult',
        'assimilation.eventDays',
        'assimilation.gapResetDays',
        'assimilation.gapResetSdKg',
      ],
    },
    {
      id: '24-weekly-cycle-display-trend',
      title: 'Weekends run heavier, and the line the user sees is a plain smoothed average',
      category: 'body',
      summary:
        'Weight tends to be higher on some weekdays than others, with weekends heavier and weekdays compensating. Once there are about six weeks of data the filter learns a small day-of-week offset. The line drawn on the chart is a simple exponentially smoothed average, which is easy to explain but trails real changes by about nine days, so it is never used for estimation.',
      howModelled:
        'After 42 days of data, each day of the week gets an offset, pulled strongly toward zero (as if every offset had seven prior weigh-ins at zero), so sparse data cannot invent a pattern. The chart line moves each day a tenth of the way toward the latest weigh-in; the lag is 9 days, and the line is about 0.23 times as noisy as the raw scale.',
      equation:
        'display trend today = yesterday’s trend + 0.1 × (today’s weight − yesterday’s trend)\nlag = (1 − α) ÷ α = 9 days; noise = √(α ÷ (2 − α)) × weigh-in noise ≈ 0.23 ×',
      keyNumbers: [
        {
          label: 'Days of data before offsets are estimated',
          value: '42 days',
        },
        {
          label: 'Shrinkage of each offset toward zero',
          value: '7 weigh-ins (range 3–14)',
          note: 'A proposed fit, a Vitals modelling choice.',
        },
        {
          label: 'Display smoothing',
          value: 'α = 0.1 (range 0.1–0.2); lag 9 days; noise × 0.23',
          note: 'The ten percent rule of a well-known weight-tracking method; a commercial app documents a recency-weighted average too.',
        },
        {
          label: 'Lag bias at 0.5 kg/week loss and 75 kg',
          value: '≈ 0.6 kg',
          note: 'Acceptable for display, not for estimation.',
        },
      ],
      moderators: 'Work pattern, eating out on weekends, menstrual phase.',
      grade: 'C',
      gradeReason:
        'The smoothing arithmetic is exact and the weekly pattern is documented in published weigh-in series, but the size of the weekly offset was not extracted and the settings are proposed fits.',
      status: 'proposed-fit',
      caveats:
        'The weekly-cycle and menstrual-cycle sizes are unverified. Linear interpolation across gaps is used for display only.',
      referenceIds: [],
      relatedMetricIds: ['scaleWeight'],
      relatedParamIds: ['assimilation.dowMinDays', 'assimilation.dowShrink', 'assimilation.ewmaAlpha'],
    },
    {
      id: '24-rate-detectability-and-gates',
      title: 'A real change in rate needs weeks to show, so the plan waits for enough data before it moves',
      category: 'body',
      summary:
        'With a day-to-day noise of 0.4 kg, a straight line through a week of weigh-ins has a slope uncertain by about 0.5 kg a week. After two weeks it is about 0.2, and after four weeks about 0.07. A rate error worth acting on, say 400 kcal a day, therefore takes two weeks to see, and one of 130 kcal a day takes four. The app therefore insists on enough weigh-ins and enough logged intake before it changes anything.',
      howModelled:
        'A weekly check-in only runs if there were at least 4 weigh-ins in the last 7 days or at least 10 in 14 days. The energy-gap estimate uses a 20-day window (14–28), needs at least 10 weigh-ins in it, and at least 4 logged intake days in each of the last two weeks. If any gate fails, the previous estimate is kept.',
      equation:
        'slope uncertainty (kg/week) at noise 0.4 kg: 7 d 0.53; 14 d 0.19; 21 d 0.10; 28 d 0.07\n1 kg of body mass change per week ≈ 7,000 kcal/week order (the engine’s own fat and lean mix, not a flat 7,700)',
      keyNumbers: [
        {
          label: 'Slope uncertainty at 0.4 kg noise, daily data',
          value: '7 d 0.53 kg/wk; 14 d 0.19; 21 d 0.10; 28 d 0.07',
          note: 'Computed in the research design from standard regression arithmetic.',
        },
        {
          label: 'Smallest detectable rate error',
          value: '14 d ≈ 0.4 kg/wk (≈ 400 kcal/d); 28 d ≈ 0.13 kg/wk (≈ 130 kcal/d)',
        },
        {
          label: 'Weigh-ins needed for a check-in',
          value: '4 in 7 days, or 10 in 14 days',
          note: 'A proposed fit, a Vitals modelling choice.',
        },
        {
          label: 'Energy-gap window',
          value: '20 days (range 14–28); at least 10 weigh-ins; at least 4 logged days in each of two weeks',
          note: 'Copied from a commercial app that documents a window of about 20 days and pauses updates when more than 3 of 7 days are unlogged.',
        },
      ],
      moderators: 'How often the user weighs in, scale noise, and how much real change there is.',
      grade: 'C',
      gradeReason:
        'The detectability numbers are plain arithmetic (grade A), but the gates themselves are copied from industry practice and proposed fits.',
      status: 'proposed-fit',
      caveats:
        'Rate changes smaller than about 0.4 kg a week are not detectable within 14 days, so no re-plan is ever triggered by them.',
      referenceIds: [],
      relatedMetricIds: ['scaleWeight', 'energyBalance'],
      relatedParamIds: [
        'assimilation.checkInMin7',
        'assimilation.checkInMin14',
        'assimilation.biasWindowDays',
        'assimilation.biasMinWeighIns',
        'assimilation.biasMinIntakeDays',
      ],
    },
    {
      id: '24-energy-balance-bias',
      title: 'A hidden gap between logged intake and what the body does is estimated and kept small',
      category: 'energy',
      summary:
        'People under-report what they eat, and any expenditure estimate is imprecise, so logged intake minus predicted expenditure will not match how weight actually moves. The app estimates a single correction in kcal a day for the combined gap, working backwards from the weight trend (energy balance equals intake minus expenditure, and its rate of change in tissue mass tells you the balance). It is held to a small value with a cautious prior.',
      howModelled:
        'The observed slope of residual weight minus the engine’s predicted slope, converted to kcal using the energy density of the engine’s own fat and lean mix, gives a measurement of the gap with its own uncertainty. This is combined with the previous estimate (prior spread 150 kcal a day) by precision weighting. The correction is capped at 300 kcal a day, may change by at most 100 kcal a day per week, and is updated once a week at the check-in. When more than 70 % of logged energy was estimated by AI, the prior spread is widened by 50 kcal a day. The correction cannot separate under-reported intake from over-estimated expenditure, and is applied as a single number.',
      equation:
        'gap (kcal/day) = (observed rate of tissue change − engine rate) × energy density + gap already applied\nupdated gap = precision-weighted mean of the previous gap (spread 150 kcal/d) and the measurement\nclamp: |gap| ≤ 300 kcal/d; weekly step ≤ 100 kcal/d',
      keyNumbers: [
        {
          label: 'Prior spread of the correction',
          value: '150 kcal/d (range 100–200)',
          note: 'A proposed fit, a Vitals modelling choice, not a measured value.',
        },
        {
          label: 'Largest correction',
          value: '300 kcal/d',
        },
        {
          label: 'Largest change per week',
          value: '100 kcal/d',
        },
        {
          label: 'Extra prior spread when AI-estimated energy dominates',
          value: '+50 kcal/d when more than 70 % of logged energy is AI-estimated',
        },
        {
          label: 'Measurement uncertainty of the gap',
          value: '≈ 190 kcal/d at 14 days; ≈ 66 kcal/d at 28 days',
          note: 'From the regression arithmetic in the design.',
        },
        {
          label: 'Self-reported intake in a diet-resistant group',
          value: 'under-reported by 47 ± 16 %',
          referenceIds: ['lichtman1992'],
        },
        {
          label: 'AI energy estimates from photos or text',
          value: 'about 26–36 % error, about 14 % with ingredient detail',
          note: 'Headline error ranges from recent studies surfaced by search; unverified in detail.',
        },
      ],
      timeCourse: 'Updated weekly; two to four weeks of data are needed before the correction means much.',
      moderators:
        'How completely intake is logged, how it is estimated (typed grams, database match or AI estimate), body size and activity.',
      grade: 'D',
      gradeReason:
        'The principle of working back from weight is standard, but the prior, caps and step limits are engineering choices, not measured values.',
      status: 'proposed-fit',
      caveats:
        'The correction mixes intake error and expenditure error and cannot tell them apart from weight alone. Steps and biometrics from wearables may later help to split them.',
      referenceIds: ['lichtman1992'],
      relatedMetricIds: ['energyBalance', 'inEnergy', 'maintenance', 'tdee'],
      relatedParamIds: [
        'assimilation.biasPriorSdKcal',
        'assimilation.biasClampKcal',
        'assimilation.biasMaxStepKcal',
        'assimilation.biasAiSdBumpKcal',
        'assimilation.biasAiShare',
      ],
    },
    {
      id: '24-composition-readings',
      title: 'Waist, scale body fat and DXA only nudge the fat and lean split, never the mass',
      category: 'body',
      summary:
        'Self-measured waist circumference is fairly repeatable (correlations of at least 0.87), but a real change at half a kilogram of loss a week is only millimetres per week. A consumer smart-scale body-fat reading moves more with hydration than with the week’s true change. So these are used as weekly means with wide noise, only to confirm direction over several weeks and to nudge the fat and lean split. A clinical DXA scan is treated as the best available reading and is allowed to move composition more.',
      howModelled:
        'Each type of reading is treated as a noisy observation of a hidden value. Waist: weekly means of repeated measures, with 0.8 cm of noise, and at least 3 weekly means before the split is nudged. Smart-scale body fat: noise 2.5 percentage points, and it may close at most 30 % of the gap with the model’s own estimate. DXA: noise 1.25 percentage points. The model’s own body-fat estimate is treated as uncertain by 2 percentage points at each check-in.',
      keyNumbers: [
        {
          label: 'Self-measured circumferences',
          value: 'intraclass correlation ≥ 0.87; technical error of measurement ≈ 0.2–1.9 cm',
          referenceIds: ['springer2016'],
        },
        {
          label: 'Noise of a weekly waist mean',
          value: '0.8 cm (range 0.7–1.0)',
          referenceIds: ['springer2016'],
        },
        {
          label: 'Weekly waist means needed',
          value: '3 weeks (range 3–4)',
        },
        {
          label: 'Noise of a weekly smart-scale body-fat mean',
          value: '2.5 percentage points (range 2–4)',
          note: 'Magnitude unverified; hydration moves it more than the weekly true change.',
        },
        {
          label: 'Largest share of the gap a smart-scale reading may close',
          value: '0.3 (range 0.2–0.5)',
          note: 'A proposed fit, a Vitals modelling choice.',
        },
        {
          label: 'Noise of a DXA or clinical body-fat reading',
          value: '1.25 percentage points (range 1–1.5)',
        },
        {
          label: 'Uncertainty of the model’s own body-fat estimate',
          value: '2 percentage points (range 1.5–3)',
          note: 'A proposed fit.',
        },
      ],
      moderators: 'Hydration, measurement landmark and time of day, device, and body fat level.',
      grade: 'C',
      gradeReason:
        'Waist repeatability is published, but the consumer-device noise is unverified and the use-limits are proposed fits.',
      status: 'proposed-fit',
      caveats:
        'A single girth or smart-scale reading is never allowed to overwrite the mass-balance state; waist measurement across studies ranges widely (about 0.7 to 9.2 cm of observer error), which is why repeats and weekly means are used.',
      referenceIds: ['springer2016'],
      relatedMetricIds: ['waist', 'bodyFatPct', 'fatMass'],
      relatedParamIds: [
        'assimilation.girthSdCm',
        'assimilation.girthMinWeeks',
        'assimilation.biaSdPct',
        'assimilation.biaMaxGain',
        'assimilation.dxaSdPct',
        'assimilation.modelBfSdPct',
      ],
    },
    {
      id: '24-reanchor-and-cadence',
      title:
        'The model is re-anchored weekly from the trend, and the plan is revised on a schedule or an event',
      category: 'body',
      summary:
        'Between check-ins the daily data update only the trend filter. At the weekly check-in, the underlying physiology model is moved so that its total mass matches the filtered trend, and the leftover difference is shared between fat and lean by the engine’s own rules, not entirely to fat. After that the plan is re-computed from the new state over the remaining horizon, so it adjusts rather than starting afresh.',
      howModelled:
        'Daily, the filter updates and the engine replays the logged past. Weekly, the energy-gap estimate and the new anchor are set, a drift verdict is judged against the forecast’s 80 % band (ahead, on track or behind), and a full re-plan runs. A verdict only changes after two weekly check-ins outside the band. Events (an illness over 2 days, travel of 5 or more days off plan, a diet break, a fast of 48 hours or more ending, a new training block, 14 or more days without a weigh-in, or an engine change) force an immediate re-anchor. Automatic re-plans may only ease load; raising load needs the user’s consent.',
      keyNumbers: [
        {
          label: 'Daily nudge limit',
          value: 'at most ± 10 % of energy on the next day, for overshoot only',
          note: 'A proposed fit; there is no make-up for yesterday inside the same day.',
        },
        {
          label: 'Drift verdict band',
          value: 'forecast 80 % interval; verdict changes after two weekly check-ins outside it',
        },
        {
          label: 'Goal date shift shown',
          value: 'only when at least 3 days and outside the band',
        },
        {
          label: 'Decision vocabulary for adaptive support',
          value: 'decision points, tailoring variables, options (ease, hold, ask) and rules',
          referenceIds: ['nahumShani2018'],
        },
      ],
      timeCourse:
        'Daily state update; weekly re-anchor and re-plan; immediate re-plan on a triggering event.',
      moderators: 'Weigh-in coverage, logged intake coverage, declared events and engine version changes.',
      grade: 'D',
      gradeReason:
        'The cadence follows common practice in coaching products and a published framework for adaptive support, but the thresholds are engineering choices.',
      status: 'proposed-fit',
      caveats:
        'Whether weekly is the right cadence for each user is untested; the stability penalty between old and new plans is designed so adherence swings do not churn the plan.',
      referenceIds: ['nahumShani2018'],
      relatedMetricIds: ['scaleWeight', 'fatMass', 'leanMass'],
      relatedParamIds: [],
    },
    {
      id: '24-adherence-and-self-monitoring',
      title: 'Adherence is scored by benefit retained, and a missing log is unknown, not a failure',
      category: 'recovery',
      summary:
        'Self-monitoring predicts results, but people drop it quickly: in a six-month programme, the median time to stop consistent weight logging was about 4 weeks, diet logging 10 weeks, and activity logging 19.5 weeks. The score therefore weights each plan item by how much it contributes to the goal, gives credit for equivalent swaps, drops unlogged items from the score and shows coverage, rather than punishing gaps.',
      howModelled:
        'A day’s score is 100 × the weighted share of planned benefit that was delivered. An item’s weight is its counterfactual contribution to the weighted goal score; a swap that gives the same stimulus earns full credit; extra work is capped at full credit and does not offset another item. Unknown items are dropped, and a day with under 40 % coverage gets no score. A running 7-day average and a 28-day trend are shown with coverage, never a run-of-days counter that resets to zero after one miss. Per-block completion is tracked as a probability that updates with each day (half-life 21 days, starting at 0.75), and a block that is persistently skipped is swapped for a lighter equivalent. This is a Vitals design, not a published measure.',
      equation:
        'day score = 100 × Σ(weight × credit) ÷ Σ(weight), over items with a known status\ncredit = fraction of the item’s benefit delivered by what was done (0 to 1)\nprior for completion of a block: Beta(6, 2), mean 0.75',
      keyNumbers: [
        {
          label: 'Time to stop consistent logging (6-month programme, n = 54)',
          value: 'weight 4 weeks; diet 10 weeks; activity 19.5 weeks (median)',
          note: 'Strict 7-of-7-day criterion; small, mostly women.',
          referenceIds: ['krukowski2022'],
        },
        {
          label: 'Each extra consistent week of weight logging',
          value: '≈ −0.33 kg; diet −0.29 kg; activity no association',
          referenceIds: ['krukowski2022'],
        },
        {
          label: 'Monitoring progress and goal attainment (138 studies, n = 19,951)',
          value: 'd+ = 0.40',
          referenceIds: ['harkin2016'],
        },
        {
          label: 'Dietary self-monitoring and weight loss',
          value: 'more consistent and complete logs went with more loss (15 studies)',
          note: 'Observational; known from a search summary only, unverified.',
          referenceIds: ['burke2011'],
        },
        {
          label: 'Self-reported adherence versus diet type, correlation with loss',
          value: 'r = 0.60 versus r = 0.07',
          referenceIds: ['dansinger2005'],
        },
        {
          label: 'Minimum scored days for the 7-day average',
          value: '3 days',
          note: 'A proposed fit, a Vitals modelling choice.',
        },
      ],
      moderators:
        'Coaching contact, burden of logging, app design, and tendencies toward all-or-nothing thinking.',
      grade: 'C',
      gradeReason:
        'Self-monitoring evidence is observational (grade B/C), and the scoring rule itself is an unpublished design (grade D).',
      status: 'proposed-fit',
      caveats:
        'A numeric score may not suit people prone to disordered eating, so a quiet mode that shows categories without a number is under consideration. Self-compassion after a lapse reduces the all-or-nothing response in lab studies, so lapse messages are forward-looking.',
      referenceIds: ['krukowski2022', 'harkin2016', 'burke2011', 'dansinger2005', 'adams2007'],
      relatedMetricIds: ['adherence'],
      relatedParamIds: [],
    },
  ],
  myths: [
    {
      id: '24-myth-daily-weight-is-fat',
      claim: 'A rise on the scale from one day to the next means you gained fat.',
      verdict: 'not-supported',
      explanation:
        'Day-to-day spread is about 0.5 % of body mass (about 0.4 kg at 75 kg) in good conditions, and water from carbohydrate, salt and gut contents can move it by a kilogram or more. The trend, not a single reading, is what counts.',
      referenceIds: ['singlePerson2023'],
    },
    {
      id: '24-myth-3500-rule',
      claim: 'Every 7,700 kcal of deficit is exactly one kilogram of fat lost.',
      verdict: 'oversimplified',
      explanation:
        'The energy in tissue depends on the mix of fat and lean lost, so the engine converts the observed weight change using its own estimate of that mix, about 7,000 kcal a kilogram in order of magnitude, not a flat number.',
      referenceIds: [],
    },
    {
      id: '24-myth-missed-log-fail',
      claim: 'A day without a log counts as a failure, and one missed day ruins progress.',
      verdict: 'not-supported',
      explanation:
        'Logging gaps are common and usually reflect effort, not outcome. An unlogged day is treated as unknown and left out of scores, and a perceived break can trigger an all-or-nothing response that causes more harm than the gap.',
      referenceIds: ['krukowski2022', 'adams2007'],
    },
    {
      id: '24-myth-weekly-fast-correction',
      claim: 'If weight stalls for a few days the plan should be changed straight away.',
      verdict: 'not-supported',
      explanation:
        'With normal noise, a week of data cannot distinguish a real slowdown from chance, and even two weeks detect only changes of roughly 400 kcal a day. The plan waits for the weekly check-in and enough data.',
      referenceIds: [],
    },
  ],
  openQuestions: [
    'What is the real weigh-in noise in free-living users who weigh at varying times, since the main published figure comes from one standardised weigher?',
    'How large are the weekly-cycle and menstrual-phase offsets, so that they can be modelled directly rather than shrunk toward zero?',
    'Can steps and wearable measures help to separate under-reported intake from over-estimated expenditure inside the single correction?',
    'What is the right cost of a missed item in the adherence score, and how can a cached approximation of each item’s contribution stay accurate?',
    'Should the numeric adherence score be hidden for users at risk of disordered eating?',
    'How accurately can an AI estimate of a meal be calibrated against the user’s own later edits?',
  ],
  references: [
    {
      id: 'singlePerson2023',
      authors: 'Schneditz D, Hofmann P, Krenn S, Waller M, Mussnig S, et al.',
      year: 2023,
      title: 'Day-to-day variability in euvolemic body mass',
      journal: 'Ren Fail 45:2273421',
      pmid: '37955103',
      doi: '10.1080/0886022x.2023.2273421',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10653631/',
      verification: 'abstract',
    },
    {
      id: 'krukowski2022',
      authors: 'Carpenter CA, Eastman A, Ross KM.',
      year: 2022,
      title:
        'Consistency With and Disengagement From Self-monitoring of Weight, Dietary Intake, and Physical Activity in a Technology-Based Weight Loss Program: Exploratory Study',
      journal: 'JMIR Formative Research',
      pmid: '35179513',
      doi: '10.2196/33603',
      url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8900900/',
      verification: 'abstract',
    },
    {
      id: 'harkin2016',
      authors: 'Harkin B, et al.',
      year: 2016,
      title:
        'Does monitoring goal progress promote goal attainment? A meta-analysis of the experimental evidence',
      journal: 'Psychological Bulletin',
      pmid: '26479070',
      doi: '10.1037/bul0000025',
      url: 'https://eprints.whiterose.ac.uk/id/eprint/87431/',
      verification: 'abstract',
    },
    {
      id: 'burke2011',
      authors: 'Burke LE, Wang J, Sevick MA',
      year: 2011,
      title: 'Self-monitoring in weight loss: a systematic review of the literature',
      journal: 'Journal of the American Dietetic Association',
      pmid: '21185970',
      doi: '10.1016/j.jada.2010.10.008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21185970/',
      verification: 'abstract',
    },
    {
      id: 'dansinger2005',
      authors: 'Dansinger ML, et al.',
      year: 2005,
      title:
        'Comparison of the Atkins, Ornish, Weight Watchers, and Zone diets for weight loss and heart disease risk reduction: a randomized trial',
      journal: 'JAMA',
      pmid: '15632335',
      doi: '10.1001/jama.293.1.43',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15632335/',
      verification: 'abstract',
    },
    {
      id: 'lichtman1992',
      authors: 'Lichtman SW, et al.',
      year: 1992,
      title: 'Discrepancy between self-reported and actual caloric intake and exercise in obese subjects',
      journal: 'New England Journal of Medicine',
      pmid: '1454084',
      url: 'https://europepmc.org/article/MED/1454084',
    },
    {
      id: 'springer2016',
      authors: 'Barrios P, Martin-Biggers J, Quick V, Byrd-Bredbenner C.',
      year: 2016,
      title: 'Reliability and criterion validity of self-measured waist, hip, and neck circumferences',
      journal: 'BMC Medical Research Methodology',
      pmid: '27145829',
      doi: '10.1186/s12874-016-0150-2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27145829/',
      verification: 'abstract',
    },
    {
      id: 'nahumShani2018',
      authors: 'Nahum-Shani I, et al.',
      year: 2018,
      title:
        'Just-in-time adaptive interventions in mobile health: key components and design principles for ongoing health behavior support',
      journal: 'Annals of Behavioral Medicine',
      pmid: '27663578',
      doi: '10.1007/s12160-016-9830-8',
      url: 'https://academic.oup.com/abm/article/52/6/446/4733473',
      verification: 'abstract',
    },
    {
      id: 'adams2007',
      authors: 'Adams CE, Leary MR',
      year: 2007,
      title: 'Promoting self-compassionate attitudes toward eating among restrictive and guilty eaters',
      journal: 'Journal of Social and Clinical Psychology',
      doi: '10.1521/jscp.2007.26.10.1120',
      url: 'https://self-compassion.org/wp-content/uploads/publications/AdamsLearyeating_attitudes.pdf',
      verification: 'abstract',
    },
  ],
};

export default topic;
