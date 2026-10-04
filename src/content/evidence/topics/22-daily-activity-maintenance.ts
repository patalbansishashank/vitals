import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '22',
  slug: 'daily-activity-maintenance',
  title: 'Daily activity and maintenance energy',
  scope:
    'How a handful of everyday answers (what you do at work, how many steps you take, how you get to work, what you do on a day off, how much time you spend on your feet at home, what sport you play outside planned training) become an estimate of maintenance energy, the calories that keep weight steady, and how wide the honest margin around that estimate is. It covers the published activity-level bands, the energy cost of standing, walking and manual work, what people report reliably and what they over- or under-report, and the checks the estimate has been run against. It is a starting point: logged weight and intake replace it after a few weeks (see Tracking and re-planning).',
  mechanisms: [
    {
      id: '22-pal-reference-bands',
      title: 'Activity level is a multiple of resting energy, and the published bands anchor the answers',
      category: 'energy',
      summary:
        'Total daily energy use divided by resting energy use is the physical activity level (PAL). Expert groups publish typical values for lifestyles, from about 1.4 for a seated, low-movement day to 2.0–2.4 for heavy manual work, and the 2023 US and Canadian energy report splits adults into four bands measured with doubly labelled water (a tracer method that measures real-life energy use over about two weeks). Vitals uses these bands as the yardstick its own answers must land inside, not as a label the person picks.',
      howModelled:
        'The questionnaire answers are converted to a daily energy figure; dividing it by the estimated resting energy gives a PAL, which is compared with the published bands. A PAL above 2.4 triggers a warning (hard to sustain for long), and the value is held at 2.5, the top of the published range. The bands are never offered as a menu to choose from, because no validated way exists for a person to classify their own activity level.',
      equation:
        'PAL = total daily energy ÷ resting energy\nbands (NASEM 2023): inactive < 1.53; low active 1.53–1.68; active 1.68–1.85; very active up to 2.5\nlifestyle PAL (FAO/WHO): seated 1.4–1.5; seated with some moving 1.6–1.7; standing work 1.8–1.9; strenuous work 2.0–2.4',
      keyNumbers: [
        {
          label: 'Upper limit of the "inactive" band',
          value: 'PAL 1.53',
          note: 'Low active ends at 1.68 and active at 1.85. The bands are roughly the quartiles of doubly labelled water measurements.',
          referenceIds: ['nasem2023'],
        },
        {
          label: 'Lifestyle PAL values',
          value: '1.4–1.5 seated; 1.6–1.7 seated with moving; 1.8–1.9 standing; 2.0–2.4 strenuous',
          referenceIds: ['faowho2004', 'endotext2022'],
        },
        {
          label: 'Sustainability limit',
          value: 'PAL above 2.40 is difficult to maintain long-term; top of the very active range 2.50',
          referenceIds: ['faowho2004', 'nasem2023'],
        },
        {
          label: 'Error of the energy equations even when the PAL band is known',
          value: 'mean absolute percentage error 8.7–9.4 %',
          note: 'The report also states that no valid tool exists to classify an individual’s activity level.',
          referenceIds: ['nasem2023'],
        },
      ],
      moderators:
        'Body size and sex set resting energy; occupation, leisure and age move the multiple. Doubly labelled water samples tend to be more active than the general population.',
      grade: 'A',
      gradeReason:
        'The bands come from tracer-measured energy use in large samples (grade A); the lifestyle table is an expert synthesis of the same kind of data (grade B).',
      status: 'established',
      caveats:
        'The lifestyle values describe groups. Two people in the same job can differ by a whole band, and misclassifying by one band is worth roughly 200–300 kcal a day.',
      referenceIds: ['nasem2023', 'faowho2004', 'endotext2022'],
      relatedMetricIds: ['tdee', 'maintenance'],
      relatedParamIds: [
        'activityIntake.nasemInactiveMax',
        'activityIntake.nasemLowActiveMax',
        'activityIntake.nasemActiveMax',
        'activityIntake.palWarn',
        'activityIntake.palCap',
      ],
    },
    {
      id: '22-occupation-class-energy',
      title: 'What you do at work is the largest everyday lever, and it is added on top of steps',
      category: 'energy',
      summary:
        'Standing, carrying and handling things cost more than sitting, hour for hour, and most people spend about a third of their day at work. A simple four-step question about the kind of job separates people better than any other single lifestyle question, and working in a physical job has been shown to cost over 100 kcal a day more than a typical desk job. The estimate adds an extra cost per hour of work, over and above the steps the person takes.',
      howModelled:
        'Five work classes (desk, a mix of sitting and moving, on feet, physical work, heavy physical work) each carry an extra cost per kilogram of body mass per hour above sitting, with steps excluded so they are not counted twice. Weekly work energy is body mass × hours × cost × workdays ÷ 7. The costs come from standard activity-cost tables minus an assumed share for walking and the fraction of the hour spent actually working. They are tuned so that typical people land inside the published lifestyle bands.',
      equation:
        'work energy (kcal/day) = body mass (kg) × work hours per day × cost class (kcal/kg/h) × workdays per week ÷ 7\ncost per class: desk 0; mixed 0.25; on feet 0.5; physical 1.0; heavy 2.0 kcal/kg/h',
      keyNumbers: [
        {
          label: 'Desk work above sitting',
          value: '0 kcal/kg/h (range 0–0.1)',
          note: 'Office and driving jobs rate 1.3–1.5 MET, about the seated reference.',
          referenceIds: ['compendium2024'],
        },
        {
          label: 'Mixed sitting and moving',
          value: '0.25 kcal/kg/h (range 0.10–0.45)',
          note: 'A proposed fit between quiet standing and standing tasks.',
          referenceIds: ['saeidifard2018', 'compendium2024'],
        },
        {
          label: 'On-feet work (retail, hospitality, nursing, teaching)',
          value: '0.5 kcal/kg/h (range 0.2–0.8)',
          note: 'Standing light tasks 1.8 MET and patient care 2.3–3.3 MET, less sitting at 1.3 MET and the walking share.',
          referenceIds: ['compendium2024'],
        },
        {
          label: 'Physical work (trades, warehouse, cleaning, moderate farming)',
          value: '1.0 kcal/kg/h (range 0.6–1.6)',
          note: 'Custodial 3.8, carpentry 4.3, manual labour 4.5 and moderate farming 4.8 MET, less walking share and duty cycle.',
          referenceIds: ['compendium2024'],
        },
        {
          label: 'Heavy physical work (construction, heavy farming)',
          value: '2.0 kcal/kg/h (range 1.2–3.0)',
          note: 'Carpentry heavy 7.0 and vigorous farming 7.8 MET with a working time of about 40–50 % of the hour. A weak, grade D coefficient.',
          referenceIds: ['compendium2024'],
        },
        {
          label: 'Fall in US work-related energy use, 1960–2006',
          value:
            'more than 100 kcal/d (142 kcal/d in men), as moderate-intensity jobs fell from about 50 % to under 20 %',
          note: 'A modelled estimate.',
          referenceIds: ['church2011'],
        },
        {
          label: 'Step of one job category in the Cambridge activity index',
          value: '≈ 110 kcal/d (men), ≈ 87 kcal/d (women) per category',
          note: 'Observed values are attenuated by misclassification, so the true gap is at least this large.',
          referenceIds: ['wareham2003', 'interact2012'],
        },
      ],
      moderators:
        'Hours per day and workdays per week (default 8 hours, 5 days). Retired, studying, caring or at-home people get no work term and use the home question instead.',
      grade: 'C',
      gradeReason:
        'The mechanism is well established, but each per-hour cost is a composite of activity-table values with assumed duty cycles, and no tracer study sorted by occupation class was found.',
      status: 'proposed-fit',
      caveats:
        'The mixed and physical classes are the least certain. Two of the model’s checks show that the mixed-job person falls slightly below the published band for that lifestyle (see the validation notes in the uncertainty mechanism).',
      referenceIds: [
        'compendium2024',
        'saeidifard2018',
        'church2011',
        'wareham2003',
        'interact2012',
        'faowho2004',
      ],
      relatedMetricIds: ['neat', 'tdee', 'maintenance'],
      relatedParamIds: [
        'activityIntake.occDesk',
        'activityIntake.occMixed',
        'activityIntake.occOnFeet',
        'activityIntake.occManualModerate',
        'activityIntake.occManualHeavy',
      ],
    },
    {
      id: '22-steps-cost-and-validity',
      title:
        'Steps cost about 0.44 kcal per kg per thousand, and where the count comes from matters more than the count',
      category: 'energy',
      summary:
        'Walking has a fairly predictable energy cost per step, which grows with body mass. But a step count is only as good as the device: a wrist watch is typically within 6–10 % of a reference thigh sensor, a phone app can be out by 30 %, and a guessed number has never been validated. Steps also do not capture standing, lifting, chores or sport, so they are one term in the estimate, not the whole of it.',
      howModelled:
        'Energy from steps = 0.44 kcal × body mass (kg) × steps ÷ 1,000. The uncertainty of the step term depends on the source: 10 % for a wrist device, 25 % for a phone carried most of the day, 35 % when the phone is often left behind, and 40 % for a rough guess or a number derived from other answers. A 10 % uncertainty on the cost per step is added on top. A walking commute is turned into steps at 105 steps a minute. A fresh baseline week of wearing a new device is not used because people move more when they know they are being watched; the last two to four weeks of existing history are preferred.',
      equation:
        'step energy (kcal/day) = 0.44 × body mass (kg) × steps ÷ 1,000\nuncertainty of the step term = √(source error² + 0.10²) × step energy',
      keyNumbers: [
        {
          label: 'Energy per 1,000 steps',
          value: '0.44 kcal/kg (range 0.36–0.50)',
          note: 'From respiration-chamber measurements, with the walking cost equation of Ludlow and Weyand.',
          referenceIds: ['ludlow2016'],
        },
        {
          label: 'Wrist device accuracy against a thigh sensor',
          value: 'mean absolute percentage error 6.4 % (Apple Watch) and 10.5 % (Galaxy Watch)',
          referenceIds: ['hong2024'],
        },
        {
          label: 'Phone app accuracy against the same sensor',
          value: 'mean absolute percentage error 29.6 %',
          note: 'Only the size of the error was read. Under-counting from the phone not being carried is plausible but unverified.',
          referenceIds: ['hong2024'],
        },
        {
          label: 'Step count while newly monitored',
          value: '+56–82 % in one week with a (sham) device in 60 men',
          note: 'A small convenience sample; treat as direction, not size.',
          referenceIds: ['hammad2026'],
        },
        {
          label: 'Cadence that counts as moderate walking',
          value: '105 steps/min (range 100–120)',
        },
      ],
      moderators:
        'Body mass (the cost scales with it), walking speed and stride, how the device is worn, and whether the person is newly monitoring.',
      grade: 'B',
      gradeReason:
        'The per-step cost and device errors are measured, but only in small groups and one device study; guessed counts have no validation at all (grade D for that source).',
      status: 'established',
      caveats:
        'Step count correlates poorly with total activity level in free-living groups (activity level was not correlated with about 10,000 steps a day in 41 adults), which is why it is only one term.',
      referenceIds: ['ludlow2016', 'hong2024', 'hammad2026'],
      relatedMetricIds: ['inSteps', 'neat', 'tdee'],
      relatedParamIds: [
        'activityIntake.stepKcalPerKgPer1000',
        'activityIntake.walkCadence',
        'activityIntake.cvStepCost',
        'activityIntake.cvStepsWrist',
        'activityIntake.cvStepsPhone',
        'activityIntake.cvStepsPhoneNotCarried',
        'activityIntake.cvStepsRough',
      ],
    },
    {
      id: '22-workday-offday-steps',
      title: 'Working days and days off differ, so the model keeps them apart',
      category: 'energy',
      summary:
        'Workplace studies report working and non-working days separately because they differ systematically: active workers often walk less on days off, while desk workers often walk more. When no step number is given, the app derives a plausible figure for each type of day from the kind of job and the type of day off.',
      howModelled:
        'The weekly average steps combine workdays and days off by the number of workdays. With no device figure, a workday uses a typical count for the job class plus the commute steps, and a day off uses a count for how the person spends it. All of these defaults carry a range of 0.6 to 1.5 times the central value.',
      equation: 'weekly mean steps = (workdays × workday steps + (7 − workdays) × day-off steps) ÷ 7',
      keyNumbers: [
        {
          label: 'Workday steps by job class',
          value: 'desk 6,000; mixed 8,000; on feet 11,000; physical 12,000; heavy 14,000 steps/d',
          note: 'Anchored on published step surveys: office postal workers 6,709 steps a day versus walking postal workers 16,035, with no compensation off work (Tigbe 2011, as cited in the research).',
        },
        {
          label: 'Day-off steps',
          value: 'mostly at home 4,500; a bit of both 7,000; out and about 10,000 steps/d',
          note: 'Anchored on a US adult mean of 5,117 (Bassett 2010) and an adult mean of 9,448 (Bohannon 2007), as cited in the research.',
        },
        {
          label: 'Workday versus non-workday behaviour in a work-based trial',
          value: 'reported separately because they differ; size not pinned for adults',
          referenceIds: ['edwardson2022'],
        },
      ],
      moderators: 'Job class, country, season, age, whether the person has a dog or small children.',
      grade: 'C',
      gradeReason:
        'Class averages are reasonable survey anchors, but the specific values are rounded Vitals defaults and the weekday-to-day-off difference has no reliable published size.',
      status: 'proposed-fit',
      caveats:
        'The weekly mean is used now; a day-by-day profile that moves with the working week is left for later. The defaults reflect US surveys and may be off for other regions.',
      referenceIds: ['edwardson2022'],
      relatedMetricIds: ['inSteps', 'neat'],
      relatedParamIds: [
        'activityIntake.stepsWorkDesk',
        'activityIntake.stepsWorkMixed',
        'activityIntake.stepsWorkOnFeet',
        'activityIntake.stepsWorkManualModerate',
        'activityIntake.stepsWorkManualHeavy',
        'activityIntake.stepsOffMostlyHome',
        'activityIntake.stepsOffMixed',
        'activityIntake.stepsOffOutAndAbout',
      ],
    },
    {
      id: '22-non-step-baseline',
      title: 'Everyday living, standing and chores add a small baseline that steps do not capture',
      category: 'energy',
      summary:
        'Even on a day with no walking, a person fidgets, stands, cooks and tidies. This non-exercise, non-step energy is a real part of the day, but it is small per hour: standing instead of sitting burns only about 0.15 kcal a minute more, or roughly 54 kcal over six hours at 65 kg. Chores and childcare on the feet cost more, and the answer is easily over-reported.',
      howModelled:
        'Three terms. First, a baseline of 15 % of resting energy for everyday living, calibrated so that a person with 5,000 steps a day and a desk job lands at an activity level of 1.4. Second, a home term of 0.5 kcal per kg per hour on the feet, for 0.5, 1.5 or 3 hours depending on whether the person answers "a little", "some" or "a lot". Third, the quiet-standing cost of 0.14 kcal/kg/h, which is not a separate term but anchors the work and home values. Fidgeting is not asked about, because there is no validated way to report it; it stays inside the margin.',
      equation:
        'everyday living = 0.15 × resting energy\nhome energy (kcal/day) = body mass (kg) × hours on feet at home × 0.5 kcal/kg/h',
      keyNumbers: [
        {
          label: 'Standing instead of sitting (meta-analysis)',
          value: '+0.15 kcal/min (95 % CI 0.12–0.17); men 0.19, women 0.10',
          note: 'Six hours a day at 65 kg gives +54 kcal/d, which is 0.14 kcal/kg/h.',
          referenceIds: ['saeidifard2018'],
        },
        {
          label: 'Quiet standing above sitting',
          value: '0.14 kcal/kg/h (range 0.11–0.16)',
          referenceIds: ['saeidifard2018'],
        },
        {
          label: 'Chores, cooking and childcare on the feet',
          value: '0.5 kcal/kg/h (range 0.15–0.9)',
          note: 'Household tasks are around 2.0–2.5 MET; the exact table codes were not re-checked, so this is unverified.',
          referenceIds: ['compendium2024'],
        },
        {
          label: 'Time on feet at home, by answer',
          value: 'a little 0.5 h; some 1.5 h; a lot 3 h per day',
          note: 'Defaults chosen for the three answer options, a Vitals modelling choice, not a measured value.',
        },
        {
          label: 'Everyday-living baseline',
          value: '15 % of resting energy',
          note: 'A proposed fit, calibrated to a PAL of 1.4 at 5,000 steps. Raising it would lift desk workers above the published 1.4–1.5.',
        },
      ],
      moderators: 'Household size, children, housing, climate, and whether the person works from home.',
      grade: 'C',
      gradeReason:
        'The cost of standing is a meta-analytic result (grade A), but the home values and the baseline fraction are fitted defaults.',
      status: 'proposed-fit',
      caveats:
        'People report standing time poorly (they under-report it), so hours standing at work are not asked about; the work class already includes the typical amount.',
      referenceIds: ['saeidifard2018', 'compendium2024', 'endotext2022'],
      relatedMetricIds: ['neat', 'rmr'],
      relatedParamIds: [
        'activityIntake.neatNonStepFrac',
        'activityIntake.quietStandKcalPerKgH',
        'activityIntake.homeKcalPerKgH',
        'activityIntake.homeHoursLittle',
        'activityIntake.homeHoursSome',
        'activityIntake.homeHoursALot',
      ],
    },
    {
      id: '22-commute-and-sport',
      title:
        'Active commuting and sport outside training are priced by intensity and added with wide margins',
      category: 'energy',
      summary:
        'Cycling to work and weekend sport add real energy, and are priced as multiples of resting energy (METs) taken from the standard Compendium of Physical Activities, net of the one MET of sitting still. Because exercise is over-reported in surveys, these terms carry the widest uncertainty of any answer.',
      howModelled:
        'Cycling to work at 6.8 MET, and sport as light 3.5, moderate 5 or vigorous 8 MET, each with the one MET of resting energy subtracted. The extra energy is body mass × (MET − 1) × time. Anything the person already counts as planned training is kept out, so a session is never counted twice. Uncertainty: 30 % on the cycling commute, 50 % on recreation and 20 % on planned sessions.',
      equation:
        'extra energy (kcal) = body mass (kg) × (MET − 1) × hours\nweekly sport is averaged over seven days',
      keyNumbers: [
        {
          label: 'Cycling to or from work',
          value: '6.8 MET (range 4.0–8.0)',
          note: 'The exact table value was not re-read, so it is unverified.',
          referenceIds: ['compendium2024'],
        },
        {
          label: 'Sport, light / moderate / vigorous',
          value: '3.5 / 5 / 8 MET (each ±30 %)',
          referenceIds: ['compendium2024'],
        },
        {
          label: 'Over-reporting of exercise in diet-resistant obesity',
          value: 'exercise over-reported by +51 ± 75 %',
          referenceIds: ['lichtman1992'],
        },
        {
          label: 'Uncertainty applied',
          value: 'cycling commute 30 %; recreation 50 %; planned training sessions 20 %',
          note: 'Vitals modelling choices, grade C, from the reliability data in the self-report mechanism.',
        },
      ],
      moderators: 'Intensity actually reached (people over-estimate it), session length, and body mass.',
      grade: 'B',
      gradeReason:
        'Intensity values are standard published figures (grade B), but how long and how hard a given person really goes is self-reported and over-stated.',
      status: 'established',
      caveats:
        'A person who later replaces a regular game with planned runs could be credited twice unless the game is declared stopped.',
      referenceIds: ['compendium2024', 'lichtman1992'],
      relatedMetricIds: ['exerciseEE', 'neat', 'tdee'],
      relatedParamIds: [
        'activityIntake.metCycleCommute',
        'activityIntake.metSportLight',
        'activityIntake.metSportModerate',
        'activityIntake.metSportVigorous',
        'activityIntake.cvCycleCommute',
        'activityIntake.cvRecreation',
        'activityIntake.cvTraining',
      ],
    },
    {
      id: '22-skipped-answers-prior',
      title: 'Skipped questions fall back on a population mix, not on the most sedentary job',
      category: 'energy',
      summary:
        'If someone skips the job question, the honest answer is "probably an average mix of jobs", not "an office desk". The estimate then uses a weighted blend of the five job classes, which lands at an activity level of about 1.57 (the low-active band) with a margin near 12 %.',
      howModelled:
        'Each unanswered job class is replaced by shares: desk 45 %, mixed 25 %, on feet 20 %, physical 8 % and heavy 2 %. With the step default and the "some" answer for home, this gives a mean work cost of about 0.28 kcal/kg/h with a spread of 0.40, and the larger margin shows on the result.',
      equation: 'mean work cost = Σ share × class cost ≈ 0.28 kcal/kg/h (spread 0.40)',
      keyNumbers: [
        {
          label: 'Shares of job classes when skipped',
          value: 'desk 0.45; mixed 0.25; on feet 0.20; physical 0.08; heavy 0.02',
          note: 'Only the anchor that fewer than 20 % of US jobs are moderate-intensity is sourced; the shares themselves are a proposed fit and US-flavoured.',
          referenceIds: ['church2011'],
        },
        {
          label: 'Resulting skip-all activity level',
          value: 'PAL ≈ 1.57, margin ≈ 12 %',
        },
      ],
      moderators: 'Country and region (the shares differ), age, and the labour market.',
      grade: 'D',
      gradeReason:
        'Only a single anchor figure is sourced; the shares are a Vitals modelling choice, not a measured value.',
      status: 'proposed-fit',
      caveats:
        'This also corrects a bias of the older default, which placed everyone near PAL 1.43–1.48 and so under-estimated maintenance by roughly 5–18 % against published energy equations.',
      referenceIds: ['church2011', 'nasem2023'],
      relatedMetricIds: ['maintenance', 'tdee'],
      relatedParamIds: [
        'activityIntake.priorShareDesk',
        'activityIntake.priorShareMixed',
        'activityIntake.priorShareOnFeet',
        'activityIntake.priorShareManualModerate',
        'activityIntake.priorShareManualHeavy',
      ],
    },
    {
      id: '22-maintenance-uncertainty-band',
      title:
        'The margin around maintenance is built from the margins of every answer, and never goes below about 10 %',
      category: 'energy',
      summary:
        'A maintenance figure is only as sure as its weakest input. The estimate adds up the uncertainty of resting energy, steps, job class, chores, sport and sessions, and then refuses to claim better than the best published equations manage even with a measured activity level.',
      howModelled:
        'The component margins are combined as independent errors (the square root of the sum of squares), then converted to a maintenance margin and floored. The floor is 10 % when questions are answered, 12 % when they are skipped, 10 % when body fat is known, 8 % when resting energy is measured, and shrinks to 5 % after about four weeks of logged weight and intake. Component margins: resting-energy equation 10 %; measured resting energy 5 %; chores 60 %; step cost 10 %.',
      equation:
        'margin² = (10 % of everyday + resting)² + (step energy × √(source error² + 10 %²))² + (work spread)² + (60 % × home)² + (50 % × sport)² + (30 % × cycling)² + (20 % × sessions)²\nmaintenance margin = max(√margin² ÷ (1 − digestion share), floor × maintenance)',
      keyNumbers: [
        {
          label: 'Resting-energy equation error',
          value: '10 % (21–32 % of people fall outside ±10 %)',
          note: 'Applied to resting energy plus everyday living.',
        },
        {
          label: 'Day-to-day biological variation of resting energy',
          value: '≈ 5 %',
        },
        {
          label: 'Energy equations given a measured activity category',
          value: 'mean absolute error 8.7–9.4 %',
          referenceIds: ['nasem2023'],
        },
        {
          label: 'Floors on the margin',
          value: '10 % answered; 12 % skip-all; 10 % body fat known; 8 % resting energy measured',
          referenceIds: ['nasem2023'],
        },
        {
          label: 'Validation row: skip-all synthetic adults',
          value: 'median bias against an international tracer-based equation about −5 to −12 % expected',
          note: 'Tracer samples skew active.',
        },
      ],
      timeCourse:
        'The margin shrinks to about 5 % after roughly four weeks of weigh-ins and logged intake, when maintenance is measured from the person’s own data.',
      moderators:
        'Quality of step source, whether body fat or resting energy is known, and how many questions are answered.',
      grade: 'B',
      gradeReason:
        'The floors rest on published equation errors (grade A) but combining the component margins in this way is a Vitals modelling choice.',
      status: 'proposed-fit',
      caveats:
        'Validation exists and is reported openly: the estimate has been run against the lifestyle bands, the 2023 US/Canadian energy equations, an international tracer-based equation, the standing and step costs, a postal-worker comparison and an invariance check. Known misses are logged, not hidden: desk workers with little movement come out at 1.39 against a band of 1.4–1.5, on-feet retail workers at 1.68 against 1.7–1.9, mixed-job people at about 1.56 against 1.6–1.7 (open), and the lowest skip-all adult at 1.49 against 1.50. Most of these come from the digestion share being a little lower in the model than in the research arithmetic.',
      referenceIds: ['nasem2023', 'sharifzadeh2020', 'sasai2018', 'prado2024'],
      relatedMetricIds: ['tdee', 'maintenance'],
      relatedParamIds: [
        'activityIntake.cvRmrEquation',
        'activityIntake.cvRmrMeasured',
        'activityIntake.cvHome',
        'activityIntake.floorAnswered',
        'activityIntake.floorSkipped',
        'activityIntake.floorBodyFat',
        'activityIntake.floorMeasuredRmr',
      ],
    },
    {
      id: '22-self-report-reliability',
      title: 'People report some things reliably and others badly, so the questions are concrete',
      category: 'energy',
      summary:
        'Activity questionnaires rank people reasonably but measure energy poorly. Job class and desk sitting time are reported well; standing is under-reported; walking and heavy labour at work, and exercise, are over-reported; remembered intake is under-reported. The questions are therefore built on counts, hours and examples, never on a "how active are you?" scale.',
      howModelled:
        'Reliable answers (job class) are used directly. Over-reported answers (walking at work, heavy labour hours, sport) are replaced by steps, capped, or given wide margins. Standing hours are not asked, because the work class already includes typical standing. Sleep duration is not a maintenance input, since total energy use is unchanged by short sleep; it only sets the waking window. A known maintenance intake is not used at the start, because self-reported intake runs low; it is learned later from logs.',
      keyNumbers: [
        {
          label: 'Questionnaires against doubly labelled water (38 studies, 78 questionnaires)',
          value:
            'pooled total energy bias −243 kJ/d (not significant, I² 97.9 %); activity energy under-estimated by 415 kJ/d; agreement acceptable for individuals in 2 of 13 studies',
          referenceIds: ['sharifzadeh2020'],
        },
        {
          label: 'Seven Japanese questionnaires',
          value:
            'total energy ρ 0.57–0.84; activity energy ρ 0.02–0.54; activity-energy bias −547 to +77 kcal/d',
          referenceIds: ['sasai2018'],
        },
        {
          label: 'Work-time questionnaire against accelerometry (n = 401)',
          value: 'intraclass correlation: sitting 0.84; standing 0.64; walking 0.50; heavy labour 0.28',
          referenceIds: ['maes2020'],
        },
        {
          label: 'Time-use recall against past-year questionnaire',
          value: 'four 24-hour recalls ρ 0.48–0.60 versus past-year questionnaire ρ 0.16–0.34',
          note: 'Recalls were within 3–10 % of tracer-measured energy at group level.',
          referenceIds: ['matthews2018'],
        },
        {
          label: 'Cambridge short index against measured activity energy (n = 1,941, 10 countries)',
          value: 'r = 0.33; repeatability kappa 0.6',
          referenceIds: ['wareham2003', 'interact2012'],
        },
        {
          label: 'Intake self-report in a diet-resistant group',
          value: 'under-reported by 47 ± 16 %',
          note: 'Typical under-reporting of 10–30 % in general populations is not re-verified here.',
          referenceIds: ['lichtman1992'],
        },
      ],
      moderators: 'Age, body weight, whether the group is clinical, and how the question is worded.',
      grade: 'A',
      gradeReason:
        'Several meta-analyses and large validation studies agree that questionnaires have weak individual validity.',
      status: 'established',
      caveats:
        'The direction of phone-app step error and the size of weekday-weekend differences were not confirmed. Sleep neutrality of maintenance is a model rule, checked by changing bed and wake times and confirming that maintenance does not move.',
      referenceIds: [
        'sharifzadeh2020',
        'sasai2018',
        'maes2020',
        'matthews2018',
        'wareham2003',
        'interact2012',
        'lichtman1992',
        'troiano2008',
      ],
      relatedMetricIds: ['maintenance', 'tdee'],
      relatedParamIds: ['activityIntake.cvHome', 'activityIntake.cvRecreation'],
    },
  ],
  myths: [
    {
      id: '22-myth-ten-thousand-steps',
      claim: 'A step count tells you your total daily calorie burn.',
      verdict: 'oversimplified',
      explanation:
        'Steps cost about 0.44 kcal per kg per thousand and are only one term. Standing, lifting, chores and sport do not show up as steps, and counts differ by device (about 6–10 % for a wrist device, about 30 % for a phone).',
      referenceIds: ['hong2024', 'ludlow2016'],
    },
    {
      id: '22-myth-standing-desk',
      claim: 'Standing at your desk all day burns a lot of extra calories.',
      verdict: 'oversimplified',
      explanation:
        'Standing instead of sitting adds about 0.15 kcal a minute, or about 54 kcal over six hours at 65 kg. Standing work with tasks costs more, but quiet standing is a small effect.',
      referenceIds: ['saeidifard2018'],
    },
    {
      id: '22-myth-sleep-burn',
      claim: 'Sleeping less lets you burn more calories during the day.',
      verdict: 'not-supported',
      explanation:
        'Total daily energy use is essentially unchanged by short sleep, while appetite and intake rise. Sleep is not part of the maintenance estimate except for setting the hours the day is spread over.',
      referenceIds: ['nasem2023'],
    },
    {
      id: '22-myth-self-rated-activity',
      claim: 'You can classify yourself as lightly, moderately or very active and read off your calories.',
      verdict: 'not-supported',
      explanation:
        'The national energy report states that no valid way exists for an individual to classify their own activity level, and being one band off is worth about 200–300 kcal a day. Concrete questions about hours, days and counts are used instead.',
      referenceIds: ['nasem2023', 'sharifzadeh2020'],
    },
  ],
  openQuestions: [
    'Would a tracer-based energy study sorted by job class replace the composite per-hour work costs, especially for the mixed and physical classes?',
    'How large is the weekday-to-day-off step difference in adults, and how much does it depend on job type?',
    'Do phone step counts under-count mainly because the phone is not carried, and by how much, so that a correction could be applied instead of a wider margin?',
    'Should the default job-class shares be set by country rather than from US surveys?',
    'How should a person who stops a regular sport be asked to declare it so the estimate is not double-credited?',
    'Is a day-by-day activity profile worth the extra complexity, given that energy balance averages over a week?',
  ],
  references: [
    {
      id: 'nasem2023',
      authors: 'National Academies of Sciences, Engineering, and Medicine',
      year: 2023,
      title:
        'Dietary Reference Intakes for Energy (chapter 7: physical activity levels and energy equations)',
      journal: 'National Academies Press',
      doi: '10.17226/26818',
      url: 'https://www.nationalacademies.org/read/26818/chapter/9',
      verification: 'abstract',
    },
    {
      id: 'faowho2004',
      authors: 'FAO/WHO/UNU Expert Consultation',
      year: 2004,
      title: 'Human energy requirements: report of a joint FAO/WHO/UNU expert consultation',
      journal: 'FAO Food and Nutrition Technical Report Series 1',
      url: 'https://www.fao.org/4/y5686e/y5686e00.htm',
      verification: 'abstract',
    },
    {
      id: 'endotext2022',
      authors: 'von Loeffelholz C, Birkenfeld AL',
      year: 2022,
      title:
        'Non-exercise activity thermogenesis in human energy homeostasis (table of lifestyle PAL, after Black 1996)',
      journal: 'Endotext',
      pmid: '25905303',
      url: 'https://www.ncbi.nlm.nih.gov/sites/books/NBK279077/table/non-exrcse-thrmo-obs.T.physical_activity/',
      verification: 'abstract',
    },
    {
      id: 'compendium2024',
      authors: 'Herrmann SD, Willis EA, Ainsworth BE, et al.',
      year: 2024,
      title:
        '2024 Adult Compendium of Physical Activities: a third update of the energy costs of human activities (occupation codes at pacompendium.com)',
      journal: 'J Sport Health Sci 13:6-12',
      pmid: '38242596',
      doi: '10.1016/j.jshs.2023.10.010',
      url: 'https://pacompendium.com/occupation/',
      verification: 'abstract',
    },
    {
      id: 'saeidifard2018',
      authors: 'Saeidifard F, et al.',
      year: 2018,
      title:
        'Differences of energy expenditure while sitting versus standing: a systematic review and meta-analysis',
      journal: 'European Journal of Preventive Cardiology',
      pmid: '29385357',
      url: 'https://europepmc.org/article/MED/29385357',
    },
    {
      id: 'ludlow2016',
      authors: 'Ludlow LW, Weyand PG',
      year: 2016,
      title:
        'Energy expenditure during level human walking: seeking a simple and accurate predictive solution',
      journal: 'Journal of Applied Physiology',
      pmid: '26679617',
      doi: '10.1152/japplphysiol.00864.2015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26679617/',
      verification: 'abstract',
    },
    {
      id: 'church2011',
      authors: 'Church TS, et al.',
      year: 2011,
      title:
        'Trends over 5 decades in US occupation-related physical activity and their associations with obesity',
      journal: 'PLoS One',
      pmid: '21647427',
      url: 'https://europepmc.org/article/MED/21647427',
    },
    {
      id: 'wareham2003',
      authors: 'Wareham NJ, et al.',
      year: 2003,
      title:
        'Validity and repeatability of a simple index derived from the short physical activity questionnaire used in the European Prospective Investigation into Cancer and Nutrition (EPIC) study',
      journal: 'Public Health Nutrition',
      pmid: '12795830',
      doi: '10.1079/phn2002439',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12795830/',
      verification: 'abstract',
    },
    {
      id: 'interact2012',
      authors: 'InterAct Consortium, Peters T, et al.',
      year: 2012,
      title: 'Validity of a short questionnaire to assess physical activity in 10 European countries',
      journal: 'European Journal of Epidemiology',
      pmid: '22089423',
      doi: '10.1007/s10654-011-9625-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22089423/',
      verification: 'abstract',
    },
    {
      id: 'maes2020',
      authors: 'Maes I, et al.',
      year: 2020,
      title:
        'The occupational sitting and physical activity questionnaire (OSPAQ): a validation study with accelerometer-assessed measures',
      journal: 'BMC Public Health',
      pmid: '32631292',
      doi: '10.1186/s12889-020-09180-9',
      url: 'https://europepmc.org/article/MED/32631292',
      verification: 'abstract',
    },
    {
      id: 'matthews2018',
      authors: 'Matthews CE, et al.',
      year: 2018,
      title: 'Measurement of Active and Sedentary Behavior in Context of Large Epidemiologic Studies',
      journal: 'Medicine and Science in Sports and Exercise',
      pmid: '28930863',
      doi: '10.1249/mss.0000000000001428',
      url: 'https://europepmc.org/article/MED/28930863',
      verification: 'abstract',
    },
    {
      id: 'sharifzadeh2020',
      authors: 'Sharifzadeh M, Bagheri M, Speakman JR, Djafarian K.',
      year: 2020,
      title:
        'Comparison of total and activity energy expenditure estimates from physical activity questionnaires and doubly labelled water: a systematic review and meta-analysis',
      journal: 'British Journal of Nutrition',
      pmid: '32718378',
      doi: '10.1017/s0007114520003049',
      url: 'https://www.cambridge.org/core/journals/british-journal-of-nutrition/article/comparison-of-total-and-activity-energy-expenditure-estimates-from-physical-activity-questionnaires-and-doubly-labelled-water-a-systematic-review-and-metaanalysis/06F17750B5B738E59A02ACA00414E81A',
      verification: 'abstract',
    },
    {
      id: 'sasai2018',
      authors: 'Sasai H, et al.',
      year: 2018,
      title:
        'Simultaneous Validation of Seven Physical Activity Questionnaires Used in Japanese Cohorts for Estimating Energy Expenditure: A Doubly Labeled Water Study',
      journal: 'Journal of Epidemiology',
      pmid: '29709888',
      doi: '10.2188/jea.je20170129',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29709888',
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
      id: 'troiano2008',
      authors: 'Troiano RP, et al.',
      year: 2008,
      title: 'Physical activity in the United States measured by accelerometer',
      journal: 'Medicine and Science in Sports and Exercise',
      pmid: '18091006',
      doi: '10.1249/mss.0b013e31815a51b3',
      url: 'https://europepmc.org/article/MED/18091006',
      verification: 'abstract',
    },
    {
      id: 'hong2024',
      authors: 'Hong KR, et al.',
      year: 2024,
      title:
        'Apple Watch 6 vs. Galaxy Watch 4: A Validity Study of Step-Count Estimation in Daily Activities',
      journal: 'Sensors',
      pmid: '39066055',
      doi: '10.3390/s24144658',
      url: 'https://europepmc.org/article/MED/39066055',
      verification: 'abstract',
    },
    {
      id: 'hammad2026',
      authors: 'Hammad S, et al.',
      year: 2026,
      title:
        'Hawthorne Effect in Screening Ambulatory Activity Status Using Wearable Pedometers Varies Across Age Groups',
      journal: 'AJPM Focus',
      pmid: '42597719',
      doi: '10.1016/j.focus.2026.100496',
      url: 'https://europepmc.org/article/MED/42597719',
      verification: 'abstract',
    },
    {
      id: 'edwardson2022',
      authors: 'Edwardson CL, et al.',
      year: 2022,
      title:
        'Effectiveness of an intervention for reducing sitting time and improving health in office workers: three arm cluster randomised controlled trial',
      journal: 'BMJ',
      pmid: '35977732',
      doi: '10.1136/bmj-2021-069288',
      url: 'https://europepmc.org/article/MED/35977732',
      verification: 'abstract',
    },
    {
      id: 'prado2024',
      authors: 'Prado-Nóvoa O, et al.',
      year: 2024,
      title: 'Validity of predictive equations for total energy expenditure against doubly labeled water',
      journal: 'Scientific Reports',
      pmid: '38977928',
      doi: '10.1038/s41598-024-66767-7',
      url: 'https://www.nature.com/articles/s41598-024-66767-7',
      verification: 'abstract',
    },
  ],
};

export default topic;
