import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '23',
  slug: 'wearable-scores',
  title: 'Scores from wearable data',
  scope:
    'Rings, watches and straps record heart rate, heart-rate variability, movement, temperature and sleep. Vitals turns those raw recordings into its own scores, each one a fixed, versioned formula that is shown in full. This topic explains what goes into each score, how the three device tiers change the uncertainty, what validation exists for the parts and what does not exist for the whole, and why a vendor’s own readiness or recovery number is displayed as that vendor’s opinion and never used as a measurement.',
  mechanisms: [
    {
      id: '23-device-tiers-and-bands',
      title: 'Device tiers: how much a reading can be trusted depends on the device',
      category: 'recovery',
      summary:
        'Not every ring or watch has been checked against a laboratory reference. Vitals sorts sources into three tiers. Tier A devices have been independently compared with ECG or overnight sleep recording. Tier B devices have partial checks. Tier C devices, such as cheap rings, have none, so their heart-rate variability, stress and blood-oxygen readings are used only to follow your own trend and never as absolute numbers.',
      howModelled:
        'Every score reads the tier of the source that supplied its data and carries a band of uncertainty that depends on it. The band is wider for tier B and wider again for tier C. Within one source, a device’s constant bias cancels when you compare you with yourself, so baselines are always built from one source and one measurement window; a new device starts a new baseline and the old one is kept for display. A score’s confidence is never higher than the least confident input it used. When a person has recorded the cheap device next to a reference device, the measured bias can replace the tier C assumption for that model.',
      equation:
        'confidence of a score = the lowest confidence among its inputs\n7-day mean: random error ÷ √(nights), systematic device bias kept',
      keyNumbers: [
        {
          label: 'Nightly heart rate, tier A band (95 %)',
          value: '±3 bpm',
          note: 'Tier B ±4 bpm; tier C ±5 bpm, or ±10 bpm when fewer than 24 samples exist. Tier B and C are proposed fits.',
          referenceIds: ['dial2025'],
        },
        {
          label: 'Nightly RMSSD, tier A band (95 %)',
          value: '±12 ms (or 6–8 % error); tier B 10–16 % error',
          note: 'Tier C vendor values: trend only, absolute value ignored.',
          referenceIds: ['dial2025'],
        },
        {
          label: 'Skin-temperature noise floor',
          value: 'tier A 0.3 °C, tier B 0.4 °C, tier C 0.5 °C',
          note: 'Smaller deviations are treated as noise. These are proposed fits.',
        },
        {
          label: 'Sleep time (TST) band (95 %)',
          value: 'tier A ±30 min, tier B ±40 min, tier C ±60 min',
          note: 'Every device underestimates wakefulness.',
        },
        {
          label: 'Independent validation of cheap rings',
          value:
            'None found in the peer-reviewed literature for the Colmi R02–R11, J-Style, Yawell/QRing, Samsung Galaxy Ring, Ultrahuman or RingConn',
          note: 'Oura is the only ring with independent ECG and sleep-recording validation.',
        },
        {
          label: 'Pulse-rate variability is not heart-rate variability',
          value: 'Agreement acceptable at rest and asleep, worse standing, stressed or moving',
          note: 'Pulse-wave timing varies from heartbeat timing.',
        },
        {
          label: 'Red/infrared blood-oxygen readings in darker skin',
          value: 'Occult hypoxaemia 11.7 % versus 3.6 %',
          note: 'The difference between Black and white patients in a hospital study.',
          referenceIds: ['sjoding2020'],
        },
      ],
      moderators:
        'Motion (the biggest daytime error), cold fingers and low blood flow, how snugly it fits, ambient light, skin pigmentation, and wearing it during sleep versus activity.',
      grade: 'C',
      gradeReason:
        'The tier A figures come from comparison studies, but the tier B and C bands are engineering assumptions until each device is checked against a reference.',
      status: 'proposed-fit',
      caveats:
        'Tier C bands are assumptions, not measurements. A short side-by-side recording with a chest strap or a validated ring would replace them for one device model. Some figures for ring makers come from vendor-run tests that were not independently confirmed.',
      referenceIds: ['dial2025', 'sjoding2020', 'bent2020'],
      relatedMetricIds: [],
    },
    {
      id: '23-sleep-length-and-regularity',
      title: 'Sleep length, wake and regularity from the recorded sleep period',
      category: 'recovery',
      summary:
        'Vitals uses the sleep period that the device reports, then adds up asleep time, works out how much of the period was spent asleep, how much was awake in the middle, when sleep was centred, and how regular the timing is from day to day. It does not stage sleep itself; vendor stages are shown and labelled as the vendor’s opinion and give no points to any score. The regularity index compares whether you were asleep or awake at the same clock minute on consecutive days.',
      howModelled:
        'Time asleep is the sum of asleep minutes in the main sleep; minutes the device left unknown stay unknown and are never counted as asleep or awake. Efficiency is asleep time divided by the whole sleep period, because rings do not know when you got into bed. Wake after sleep onset is the awake time inside the period and is biased low on every wearable. Midpoint is a circular mean of the clock times. Social jet lag is the gap between the midpoints on free days and on work days. The regularity index needs at least five usable pairs of days in a 14-day window and is shown against published population percentiles rather than invented cut-offs.',
      equation:
        'efficiency = time asleep ÷ sleep period\nregularity index = −100 + 200 × (share of clock minutes with the same asleep/awake state on consecutive days)\n100 = identical timing every day, 0 = random',
      keyNumbers: [
        {
          label: 'Asleep versus awake against laboratory recording (Oura Gen3, 421,045 epochs)',
          value: 'Sleep sensitivity 94.4–94.5 %; wake specificity 73.0–74.6 %; accuracy ≈ 91.7 %',
          referenceIds: ['svensson2024'],
        },
        {
          label: 'Asleep versus awake, two-stage (Oura Gen2, 106 people, 440 nights)',
          value: '94 % with movement only, 96 % full model',
          note: 'Authors affiliated with Oura. Four-stage accuracy was 57 % from movement alone and 79 % with autonomic and circadian features.',
          referenceIds: ['altini2021'],
        },
        {
          label: 'Deep sleep in three devices (35 people, one night)',
          value:
            'Oura stage sensitivity 76–79.5 %; Apple deep sleep 50.5 % (deep underestimated by 43 min); Fitbit deep 61.7 %',
          referenceIds: ['robbins2024'],
        },
        {
          label: 'Regularity index in the UK Biobank (n = 60,977, age 62.8)',
          value: 'Median 81.0 (interquartile range 73.8–86.3)',
          note: 'The top four fifths by regularity had 20–48 % lower all-cause mortality than the least regular fifth.',
          referenceIds: ['windred2024'],
        },
        {
          label: 'Regularity beats duration for mortality in the same data',
          value: 'The regularity index predicted mortality better than sleep duration',
          note: 'Observational; association, not proof of cause.',
          referenceIds: ['windred2024'],
        },
        {
          label: 'Valid day-pairs needed',
          value: 'at least 5 in a 14-day window',
          note: 'A Vitals engineering choice.',
        },
      ],
      timeCourse:
        'Per night for length and wake; the regularity index and social jet lag need about two weeks of nights to mean anything.',
      moderators:
        'Which source supplied the sleep period, whether the device was worn outside sleep, shift work and free-day detection (weekends by default, since alarm use is unknown).',
      grade: 'B',
      gradeReason:
        'Sleep-versus-wake detection is validated against laboratory recording for good devices and the regularity link to mortality is consistent but observational.',
      status: 'established',
      caveats:
        'Every wearable underestimates wake, so wake after sleep onset reads low and efficiency reads high. Four-stage sleep from wrist or ring is much less reliable than asleep versus awake, which is why Vitals does not stage sleep. The circadian-misalignment mechanism is supported by the original timing study but the outcomes evidence is observational.',
      referenceIds: ['altini2021', 'svensson2024', 'robbins2024', 'phillips2017', 'windred2024'],
      relatedMetricIds: [],
    },
    {
      id: '23-sleep-debt',
      title: 'Sleep debt from measured sleep',
      category: 'recovery',
      summary:
        'When a device gives real sleep time, Vitals uses it in place of the sleep length you planned. Each night the shortfall against a reference of 7.5 hours feeds two running totals: a fast one that rises and clears within days and a slow one that builds and clears over about a week. The fast total is what the app shows as debt.',
      howModelled:
        'The shortfall for a night is the larger of zero and the sleep need minus time asleep. The fast and slow debts each move a fraction of the way towards that shortfall each night, climbing faster than they recover. Both are capped at four hours, and a missing night leaves the state unchanged rather than treating it as zero sleep. A fast debt above 1.5 hours blocks starting a long fast and lowers the next session’s intensity by a level.',
      equation:
        'shortfall = max(0, need − time asleep)\ndebt ← debt + (1 − e^(−1/τ)) × (shortfall − debt)\nfast debt τ = 1 day rising, 2 days falling; slow debt τ = 3 days rising, 5 days falling; cap 4 h',
      keyNumbers: [
        {
          label: 'Reference sleep',
          value: '7.5 h of actual sleep',
          note: 'From a controlled trial in which the well-rested arm got 7.5 h of actual sleep.',
          referenceIds: ['nedeltcheva2010'],
        },
        {
          label: 'Time constants (fast / slow)',
          value: '1 d rising and 2 d falling / 3 d rising and 5 d falling',
          note: 'Proposed fits.',
        },
        {
          label: 'Debt cap',
          value: '4 h',
          note: 'A proposed fit.',
        },
        {
          label: 'Fast-debt threshold that blocks a new long fast',
          value: '1.5 h',
          note: 'A Vitals planning rule, not a trial result.',
        },
      ],
      timeCourse: 'Fast component days; slow component about a week.',
      moderators:
        'Sleep need (default 7.5 h; individual need varies), measurement band on time asleep (±30 to ±60 min by tier).',
      grade: 'C',
      gradeReason:
        'The effect of short sleep is supported by controlled trials, but the time constants are Vitals modelling choices.',
      status: 'proposed-fit',
      caveats:
        'The score inherits the uncertainty in time asleep from the device. A person’s true need may be higher or lower than 7.5 hours; the app only moves the need after at least 14 nights of unconstrained sleep, and never above 9 hours.',
      referenceIds: ['nedeltcheva2010', 'windred2024'],
      relatedMetricIds: ['sleepQuality'],
    },
    {
      id: '23-resting-heart-rate',
      title: 'Resting heart rate: the nightly average and its drift',
      category: 'cardio',
      summary:
        'Resting heart rate is the average heart rate across the main sleep. It falls as fitness rises and goes up with infection, alcohol, heat, a late large meal and some medicines. The app tracks how tonight compares with your own median of previous nights, which tells you more than the absolute number.',
      howModelled:
        'Resting heart rate is the mean of heart-rate samples across the main sleep, with a minimum number of samples required. The trend is tonight minus the median of earlier nights over the last 60 days, using at least seven nights from the same source. A seven-day mean of that deviation is used for the longer fitness trend. The model’s fitness-related resting heart rate takes this as an observation.',
      equation:
        'resting heart rate = mean heart rate over the main sleep\ndrift = tonight − median(previous nights, up to 60 days)',
      keyNumbers: [
        {
          label: 'Nightly heart rate against ECG (35 people), 5-minute values',
          value: 'r = 0.993; bias −0.44 bpm; limits of agreement −2.81 to +1.93 bpm',
          referenceIds: ['cao2022'],
        },
        {
          label: 'Nightly heart rate against a chest strap (13 adults, 536 nights)',
          value:
            'Oura Gen3 concordance 0.97 (mean absolute error 1.67 %); Gen4 0.98; WHOOP 0.91; Polar watch 0.86',
          referenceIds: ['dial2025'],
        },
        {
          label: 'Weekly resting heart rate against performance',
          value: 'r = −0.62',
          note: 'In elite endurance athletes.',
          referenceIds: ['plews2013b'],
        },
        {
          label: 'Minimum samples in the sleep period',
          value: '12',
          note: 'A Vitals engineering choice; matters for rings that sample every 5–60 minutes.',
        },
      ],
      moderators:
        'Fitness, alcohol, acute illness, heat and altitude, time zone, late meals and some medicines. Device sampling rate.',
      grade: 'B',
      gradeReason:
        'The measurement agrees with ECG for good devices and the link to fitness and to acute illness is consistent.',
      status: 'established',
      caveats:
        'As a marker of overreaching, resting heart rate alone was judged unreliable in a review of the literature (grade C for that use; details unverified). Rings that sample only every few minutes give a noisier average.',
      referenceIds: ['cao2022', 'dial2025', 'plews2013b', 'bosquet2008'],
      relatedMetricIds: [],
    },
    {
      id: '23-hrv-baseline-status',
      title: 'Heart-rate variability: a nightly value, a 7-day mean and your own normal range',
      category: 'recovery',
      summary:
        'Heart-rate variability is the beat-to-beat variation in the gap between heartbeats. Overnight, the standard measure RMSSD reflects how active the calming branch of the nervous system is. Vitals follows the natural log of nightly RMSSD, averages the last seven nights and compares that with a normal range built from your previous 60 days. A week below the range is a signal to go easier.',
      howModelled:
        'The nightly value is the natural log of RMSSD. When beat-to-beat intervals are available, RMSSD is the mean of 5-minute windows after rejecting impossible gaps (outside 300–2000 ms or more than 20 % from the local median) and windows with more than 20 % of beats rejected; otherwise the device’s own nightly RMSSD is used. Each source keeps a single measurement window and baselines never mix devices, window types or the SDNN measure. The status compares the 7-day mean (at least three nights) with the mean ± 0.5 standard deviations of the previous 60 days (at least 14 nights). A status is not declared when the 80 % interval straddles a boundary; it shows borderline. A second warning, accumulating strain, fires when the week-to-week variability of the nightly value rises beyond its own history while the mean is falling.',
      equation:
        'nightly value = ln(RMSSD)\nnormal range = 60-day mean ± 0.5 × 60-day standard deviation\nstatus: below, within or above the range, using the last 7 nights',
      keyNumbers: [
        {
          label: 'Nightly RMSSD against ECG (35 people)',
          value: 'r = 0.962; bias −15.9 ms (limits −33 to +1.5)',
          note: 'Older Oura model; low- and high-frequency measures were poor (r 0.36–0.70).',
          referenceIds: ['cao2022'],
        },
        {
          label: 'Nightly RMSSD against a chest strap',
          value:
            'Oura Gen4 concordance 0.99 (error 5.96 %); Gen3 0.97 (7.15 %); WHOOP 0.94; Garmin 0.87; Polar 0.82 (16.3 %)',
          referenceIds: ['dial2025'],
        },
        {
          label: 'Weekly average versus single days',
          value: 'Weekly averages tracked training adaptation with r 0.72–0.76; single days were trivial',
          referenceIds: ['plews2013a'],
        },
        {
          label: 'Variability-guided training in cyclists',
          value:
            'Peak power +5.1 %; second ventilatory threshold power +13.9 %; 40-minute time trial +7.3 %; no significant difference between groups',
          note: 'The rule used (mean ± 0.5 standard deviations of a 4-week baseline) comes from this trial; details are from a search extract of the full text.',
          referenceIds: ['javaloyes2019'],
        },
        {
          label: 'Baseline window',
          value: '60 days',
          note: 'A Vitals practice choice; the trial used 4 weeks.',
        },
      ],
      timeCourse:
        'A week of nights for the status; 14 nights before any status is given, about 60 for a steady baseline.',
      moderators:
        'Device and measurement window, alcohol, illness, late meals, sleep length, time of the recording.',
      grade: 'B',
      gradeReason:
        'Overnight RMSSD from good devices matches ECG closely and weekly averages follow training load, though guided training did not beat standard training.',
      status: 'established',
      caveats:
        'Absolute values differ between devices by tens of percent, so numbers are never compared across sources. The 60-day window, the 0.5 standard-deviation range and the strain rule are Vitals choices (the strain rule is grade C). Vendor-defined HRV on cheap rings is a trend only. Within-person night-to-night spread of 0.1–0.2 on the log scale in athletes is an unverified figure.',
      referenceIds: ['cao2022', 'dial2025', 'plews2013a', 'plews2013b', 'javaloyes2019'],
      relatedMetricIds: [],
    },
    {
      id: '23-illness-flag',
      title: 'Illness and strain flag from resting heart rate',
      category: 'recovery',
      summary:
        'A rise in overnight heart rate a few days before symptoms is one of the earliest wearable signs of infection. Vitals ports a published open-source method that watches the overnight average and turns yellow or red when it stays well above your usual. The message is that your body is under strain, not a diagnosis, because alcohol, travel and stress trigger it too.',
      howModelled:
        'Each night the overnight average heart rate (midnight to 7 am, minutes without steps) is compared with the running median of all earlier nights, after the first seven. A night counts as one of three symbols: below the median plus 3 bpm, exactly 3 above, or 4 or more above. A six-state machine moves through green, yellow and red; two consecutive nights at 4 or more above gives red. A later version adds temperature rise, lower variability, higher breathing rate and disturbed sleep as corroborators, with amber and red levels. On red, the plan makes training easy or rest and pauses or ends planned fasts; the app asks about confounders such as alcohol, travel, late meals and a hard session.',
      equation:
        'night symbol: a if average < median + 3, b if = median + 3, c if ≥ median + 4 (whole bpm)\nred = two nights in a row at symbol c',
      keyNumbers: [
        {
          label: 'Published online method (3,318 participants, 84 infected)',
          value: 'Sensitivity 80 % (67/84); nightly specificity 87.7 %',
          note: 'Two comparison methods reached 72 % and 69 %. Median alert 3 days before symptoms.',
          referenceIds: ['alavi2022'],
        },
        {
          label: 'False alerts in healthy people',
          value:
            'About 1 alert night in 8; 1.15 versus 3.42 alert days per person (non-infection events versus infection)',
          note: 'Also triggered by alcohol, stress and travel.',
          referenceIds: ['alavi2022'],
        },
        {
          label: 'Smartwatch data in 32 COVID cases (about 5,300 participants)',
          value: '26/32 (81 %) showed alterations; 63 % detectable before symptoms in real time',
          referenceIds: ['mishra2020'],
        },
        {
          label: 'Multimodal wearable model',
          value: 'ROC AUC 0.819',
          note: 'The operating point could not be confirmed.',
          referenceIds: ['mason2022'],
        },
        {
          label: 'Respiratory rate (WHOOP)',
          value: '20 % flagged in the 2 days before symptoms; 80 % by symptom day 3',
          referenceIds: ['miller2020'],
        },
        {
          label: 'Corroborator thresholds',
          value:
            'skin temperature +0.4 °C; log RMSSD 1 SD below the 60-day mean; breathing rate +1 per minute; sleep 1.5 SD from usual',
          note: 'Proposed fits, not literature values.',
        },
      ],
      timeCourse: 'Two nights to red; the baseline needs at least seven nights from the same source.',
      moderators:
        'Alcohol, late meals, travel, hard training, vaccination, the luteal phase, sensor sampling rate.',
      grade: 'B',
      gradeReason:
        'The core flag has published sensitivity and specificity from a large wearable cohort; the corroborator combination is a Vitals proposal at grade C.',
      status: 'proposed-fit',
      caveats:
        'It flags strain of any kind and cannot say what caused it. One alert night in eight is expected in healthy people. Temperature-based fever detection before symptoms rests on a press summary that could not be confirmed.',
      referenceIds: ['alavi2022', 'mishra2020', 'mason2022', 'miller2020', 'smarr2020'],
      relatedMetricIds: [],
    },
    {
      id: '23-overreaching-and-autonomic-load',
      title: 'Overreaching flag and resting autonomic deviation',
      category: 'recovery',
      summary:
        'Two scores look for accumulated strain without claiming to read your mind. The overreaching flag needs a sustained fall in overnight heart-rate variability, or rising variability swings alongside rising training load. The autonomic deviation score compares tonight’s variability and heart rate with your own usual and is called autonomic load, never stress.',
      howModelled:
        'The overreaching flag is raised when the accumulating-strain signal is present on at least five of seven days with the acute load above the chronic load and no illness red, or when the variability status has been below for seven days in a row. Resting heart rate alone never raises it. The autonomic deviation is a weighted sum of two z-scores from sleep or still windows only: lower variability counts for 0.6 and higher resting heart rate for 0.4, then a logistic curve maps it to 0–100 with 50 meaning usual. Each z-score uses the median and a spread estimated from the interquartile range, with floors of 10 % of the median or 3 ms for variability and 3 bpm for heart rate.',
      equation:
        'deviation = −0.6 × z(HRV) + 0.4 × z(resting heart rate)\nshown = 100 ÷ (1 + e^(−1.2 × deviation)); 50 = usual\nz = (value − median) ÷ max(IQR ÷ 1.349, floor), clipped to ±3',
      keyNumbers: [
        {
          label: 'Accumulating-strain days needed for the flag',
          value: '5 of 7 days, with acute-to-chronic load above 1',
          note: 'Proposed fits.',
        },
        {
          label: 'Variability below range for the other route',
          value: '7 consecutive days',
          note: 'A proposed fit.',
        },
        {
          label: 'Weights of the deviation score',
          value: 'variability 0.6, resting heart rate 0.4',
          note: 'Taken from a prior app implementation; an engineering choice.',
        },
        {
          label: 'Vendor stress scores',
          value: 'Track laboratory HRV changes; no cortisol or psychological validation found for any vendor',
          note: 'Grade D for the word "stress".',
          referenceIds: ['garminstress2025'],
        },
      ],
      timeCourse: 'The flag needs a week or more of data; the deviation is computed per night.',
      moderators: 'Illness, alcohol, sleep disruption, device tier (tier C is within-person trend only).',
      grade: 'C',
      gradeReason:
        'The underlying signals have a physiological basis, but the rules that combine them have not been validated as detectors.',
      status: 'proposed-fit',
      caveats:
        'The mechanism is sustained vagal withdrawal under rising load; that is plausible but contested as a reliable marker of overreaching. Vitals does not call any of this psychological stress. Heart rate alone was judged unreliable for overreaching in a review (details unverified).',
      referenceIds: ['plews2013b', 'bosquet2008', 'garminstress2025'],
      relatedMetricIds: [],
    },
    {
      id: '23-night-vitals',
      title: 'Night-time blood oxygen and skin temperature',
      category: 'recovery',
      summary:
        'Rings and watches report overnight blood oxygen (SpO2) and a skin temperature deviation. Vitals shows both as trends and uses neither to change your plan on its own. Skin temperature helps corroborate illness and the menstrual-cycle phase; low blood oxygen only prompts a suggestion to talk to a clinician.',
      howModelled:
        'Blood oxygen: the nightly mean and minimum in the main sleep are stored; a flag fires when the minimum is under 88 % on at least three of seven nights, or the mean falls at least 2 points below the 60-day median. The flag only says the pattern is worth discussing with a clinician. Skin temperature: tonight’s mean minus the median of earlier nights over 60 days from the same source, relative only; a deviation under the tier noise floor is ignored, and +0.4 °C or more counts as elevated.',
      equation:
        'temperature deviation = tonight’s mean skin temperature − median of previous nights (60 days)\nblood-oxygen flag: minimum < 88 % on ≥ 3 of 7 nights, or mean ≥ 2 points below the 60-day median',
      keyNumbers: [
        {
          label: 'Blood-oxygen band (95 %)',
          value: 'tier A ±3 %, tier C ±5 %',
          note: 'Proposed fits; tier C has a positive bias in darker skin.',
          referenceIds: ['sjoding2020'],
        },
        {
          label: 'Hidden low oxygen by skin tone in hospital readings',
          value: '11.7 % versus 3.6 %',
          referenceIds: ['sjoding2020'],
        },
        {
          label: 'Elevated temperature deviation',
          value: '+0.4 °C versus the 60-day median',
          note: 'A proposed fit. Typical luteal rise 0.3–0.7 °C (unverified).',
          referenceIds: ['maijala2019'],
        },
        {
          label: 'Temperature before symptoms',
          value: 'Fever before symptoms in 38 of 50 cases',
          note: 'From a press summary; unverified.',
          referenceIds: ['smarr2020'],
        },
        {
          label: 'Baseline length',
          value: 'at least 14 nights',
        },
      ],
      moderators:
        'Cold fingers and room temperature, skin pigmentation, sensor fit, the luteal phase, fever.',
      grade: 'C',
      gradeReason:
        'The temperature mechanism is established but the device figures are partly unverified, and Vitals’ flag rules for blood oxygen are proposals.',
      status: 'proposed-fit',
      caveats:
        'Neither score changes the model; blood oxygen is information only. Consumer rings are not held to medical-oximeter accuracy standards, and the flag is never a diagnosis.',
      referenceIds: ['sjoding2020', 'maijala2019', 'smarr2020'],
      relatedMetricIds: [],
    },
    {
      id: '23-training-load',
      title: 'Training load from heart rate and perceived effort',
      category: 'performance',
      summary:
        'Vitals measures how hard a session was in two separate ways and never adds them together. One integrates minute-by-minute heart rate, weighting high effort exponentially more. The other multiplies how hard you rate the session by its length. Acute and chronic running averages smooth the daily loads; their ratio is shown only as context, never as an injury threshold.',
      howModelled:
        'Heart-rate load sums, minute by minute, the fraction of your heart-rate reserve used, scaled by an exponential weight with different constants for men and women; averaging heart rate first would understate hard intervals. It needs tier A or B heart rate on at least 60 % of the minutes; ring-only five-minute heart rate is not used. Perceived-effort load is the 0–10 rating times the minutes and is preferred for resistance training and intervals. Both feed 7-day and 28-day exponentially weighted averages. Weekly monotony and strain follow the published definitions.',
      equation:
        'heart-rate load = Σ over minutes of f × k × e^(b × f), f = (HR − resting HR) ÷ (max HR − resting HR)\nmen: k = 0.64, b = 1.92; women: k = 0.86, b = 1.67\nperceived-effort load = 0–10 rating × minutes\naverage ← λ × today + (1 − λ) × yesterday’s average, λ = 2 ÷ (N + 1), N = 7 (acute) or 28 (chronic)',
      keyNumbers: [
        {
          label: 'Perceived-effort method',
          value: '0–10 rating × session minutes',
          referenceIds: ['foster2001'],
        },
        {
          label: 'Smoothing windows',
          value: '7 days acute, 28 days chronic',
          referenceIds: ['williams2017'],
        },
        {
          label: 'Minimum heart-rate coverage',
          value: '60 % of workout minutes',
          note: 'A proposed fit.',
        },
        {
          label: 'Volume progression cap',
          value: 'chronic load + 10 % a week',
          note: 'A Vitals engineering choice, not a published threshold.',
        },
      ],
      moderators: 'Maximum and resting heart rate accuracy, sex, modality, device sampling rate.',
      grade: 'B',
      gradeReason:
        'Heart-rate and perceived-effort loads correlate with internal training load by a clear mechanism, though the acute-to-chronic ratio has no predictive validity.',
      status: 'established',
      caveats:
        'The acute-to-chronic ratio has been criticised as mathematically coupled and lacking predictive validity for injury (details unverified), so it is never used as a threshold. A 0–21 scale like a vendor strain score is not offered because it would be an invented scale.',
      referenceIds: ['foster2001', 'williams2017'],
      relatedMetricIds: [],
    },
    {
      id: '23-vo2max-estimate',
      title: 'VO2max: a best estimate with a band, from several imperfect methods',
      category: 'performance',
      summary:
        'Aerobic fitness (VO2max) is rarely measured in a laboratory, so Vitals combines several estimates. It starts from a prediction using age, sex, size and activity, then updates it with heart-rate-and-pace estimates from runs and walks, a ratio of maximum to resting heart rate and any test you enter. The result always carries a band, a single hot or hilly run cannot jump it, and a laboratory test counts most.',
      howModelled:
        'VO2max is treated as a hidden quantity that changes slowly. Each estimate is a measurement with its own error and the estimates are combined with a Kalman filter; the posterior is what the app shows. Starting prior: the non-exercise equation with a spread of 5.7 ml/kg/min. Heart-rate-and-pace segments need steady speed and heart rate for at least 3 minutes with 50–90 % of heart-rate reserve in use, and convert the oxygen cost of the pace to VO2max by dividing by the fraction of reserve used. Updates farther than 3 standard deviations from the state are gated. The heart-rate ratio method is applied at most monthly because its errors are correlated. A vendor VO2max number is never an input.',
      equation:
        'segment estimate = 3.5 + (oxygen cost of pace − 3.5) ÷ f, f = fraction of heart-rate reserve in use\nheart-rate ratio estimate = 15.3 × max HR ÷ resting HR\nCooper = (distance in m − 504.9) ÷ 44.73',
      keyNumbers: [
        {
          label: 'Non-exercise prediction',
          value: 'standard error 5.7 ml/kg/min',
          referenceIds: ['jackson1990'],
        },
        {
          label: 'Heart-rate ratio method (46 well-trained men)',
          value:
            'factor 15.3 ± 0.7; error 2.7 ml/kg/min (4.5 %) with measured max HR; 4.7 (7.8 %) with age-predicted',
          referenceIds: ['uth2004'],
        },
        {
          label: 'Heart-rate-and-pace estimate (vendor white paper, 79 runners, 2,690 runs)',
          value:
            'Mean absolute error about 5 %; 4.3 % with true max HR; about 9 % if max HR is 15 bpm too low, 7 % if too high',
          note: 'Vendor-authored.',
          referenceIds: ['firstbeat2017'],
        },
        {
          label: 'Apple Watch (n = 30)',
          value: 'Mean absolute error 13.3 %; bias −6.1 ml/kg/min',
          referenceIds: ['lambe2025'],
        },
        {
          label: 'Garmin Forerunner models',
          value: '7–8 % general and 9.4–10.4 % athletes (FR245); 18.4 % (FR265)',
          note: 'Error varies by model and population.',
        },
        {
          label: 'Heart-rate reserve window and max-HR spread',
          value: '50–90 % of reserve; spread of predicted max HR ≈ 10 bpm',
          note: 'The max-HR formula was not re-checked against its original paper.',
        },
        {
          label: 'Entered laboratory value',
          value: 'about 3 % error',
          note: 'Proposed fit (3–5 %).',
        },
      ],
      moderators:
        'Max-HR accuracy (a 15 bpm error costs 7–9 %), terrain, heat, device model, body mass (ml/kg/min changes with weight).',
      grade: 'C',
      gradeReason:
        'The heart-rate and oxygen-uptake relationship is physiological, but the estimates have errors of 5–18 % and the vendor figures are not independent.',
      status: 'proposed-fit',
      caveats:
        'The fusion step and the process noise are modelling choices. Tier C rings are never used for the heart-rate segments. The field-test error figure is unverified.',
      referenceIds: ['jackson1990', 'uth2004', 'firstbeat2017', 'lambe2025', 'kline1987'],
      relatedMetricIds: ['vo2max'],
    },
    {
      id: '23-convenience-indexes',
      title: 'Sleep index and readiness: labelled convenience indexes, formula shown',
      category: 'recovery',
      summary:
        'Vitals has two composite numbers that combine several parts into one: a sleep index and a readiness index. Both are labelled convenience indexes with their formulas shown. They are not validated as composites; only the components are. They are for display and never drive the plan directly; the plan reacts to the validated components.',
      howModelled:
        'Sleep index: a weighted average of three parts over those available, 0.5 for duration against a target of 8 hours, 0.25 for continuity (efficiency from 70 % rising to full marks at 85 %) and 0.25 for timing (how far the sleep midpoint sits from your own recent midpoint, losing all points at 2 hours). Stages give no points. Readiness: a weighted average of at least two parts, each turned into a 0–100 score from a z-score against your own baseline through a logistic curve: variability 0.25 (capped at +1), resting heart rate 0.15, sleep index 0.30, temperature 0.10, prior-day load 0.10 and prior-day nutrition 0.10. Confidence is never high; a day can be scored without variability or resting heart rate, in which case confidence is low.',
      equation:
        'index = Σ weight × part ÷ Σ weight, over available parts\npart from a z-score: 100 ÷ (1 + e^(−1.2 × z)), z clipped to ±3\nsleep index parts: duration 0.50, continuity 0.25, timing 0.25',
      keyNumbers: [
        {
          label: 'Sleep index weights',
          value: 'duration 0.50; continuity 0.25; timing 0.25',
          note: 'Engineering choices carried over from an earlier version for continuity.',
        },
        {
          label: 'Readiness weights',
          value:
            'variability 0.25; resting heart rate 0.15; sleep 0.30; temperature 0.10; load 0.10; nutrition 0.10',
          note: 'Engineering choices. A normal day typically lands near 60–70.',
        },
        {
          label: 'Candidate replacement for the timing part',
          value: 'regularity index scaled between 41 and 86',
          note: 'The 5th percentile (41) is from a search extract; the 75th percentile is 86.',
          referenceIds: ['windred2024'],
        },
        {
          label: 'Vendor composite weights',
          value: 'None published by any vendor',
          note: 'Oura, WHOOP, Garmin, Fitbit, Apple, Ultrahuman, Samsung and Polar disclose inputs and some baseline windows only.',
        },
      ],
      grade: 'D',
      gradeReason:
        'The weights are engineering choices that nobody has validated as a composite, though each component has its own evidence.',
      status: 'proposed-fit',
      caveats:
        'A composite can hide which part moved, so the parts are always shown. Whether the readiness score should keep its nutrition part is an open design question, since its link to next-day autonomic state is weak.',
      referenceIds: ['windred2024'],
      relatedMetricIds: [],
    },
    {
      id: '23-vendor-scores-as-opinion',
      title: 'Vendor scores are the vendor’s opinion, shown but never used',
      category: 'recovery',
      summary:
        'Oura readiness, WHOOP recovery, Garmin body battery, Fitbit and Samsung readiness-type scores and the like are shown in Vitals and labelled with the maker’s name. They are never fed into the model as a measurement and never drive the plan. No vendor publishes how its score is weighted, and no composite score has been validated against an outcome; only the components such as night heart rate, nightly RMSSD, asleep versus awake and VO2max from heart rate and pace have been.',
      howModelled:
        'Vendor numbers are stored as display-only records. They appear as "Oura says ..." and are excluded from every formula; a vendor VO2max is explicitly barred as an input. The same ingredients are rebuilt from raw data with open formulas instead: nightly heart rate and variability against a 2–8-week personal baseline, sleep duration and timing consistency, temperature deviation and recent load. Because scores are versioned recomputable functions, results change only when the formula version changes, and every use in advice is logged with its version.',
      keyNumbers: [
        {
          label: 'Vendors that publish their score weights',
          value: 'None of the eight checked',
          note: 'Oura, WHOOP, Garmin, Fitbit, Apple, Ultrahuman, Samsung and Polar.',
        },
        {
          label: 'Sleep-stage agreement of wrist devices with the laboratory (six devices)',
          value:
            'Kappa 0.53 Apple Watch Series 8, 0.42 Fitbit Sense, 0.37 WHOOP 4.0, 0.21 Garmin Vivosmart 4; wake specificity 29–52 %',
          note: 'Kappa 1 would be perfect agreement. Source: a 2025 comparison in Sleep Advances.',
        },
        {
          label: 'WHOOP recovery bands',
          value: 'green at 67 or above; red at 33 or below',
          note: 'From a vendor page seen only in a search extract; unverified.',
        },
        {
          label: 'Oura readiness balance windows',
          value: '14-day weighted average versus the previous ~2 months',
        },
        {
          label: 'Polar nightly recharge reference',
          value: 'own last 28 days',
        },
      ],
      moderators:
        'Which vendor, firmware version and window, and which inputs the vendor uses (for example, previous-day activity).',
      grade: 'D',
      gradeReason:
        'Without published formulas or outcome validation the composites cannot be graded higher than expert opinion.',
      status: 'proposed-fit',
      caveats:
        'A vendor score can be useful to the person who trusts it; Vitals shows it for that reason but cannot reproduce it, check it or explain a change in it. The vendor stage numbers show that even the components can be weak.',
      referenceIds: [],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '23-myth-vendor-score-truth',
      claim: 'My ring’s readiness or recovery score tells me exactly how recovered I am.',
      verdict: 'unproven',
      explanation:
        'The weights are unpublished and no vendor composite has been validated against an outcome. The parts it uses, such as night heart rate and nightly RMSSD, are validated on good devices. Vitals shows the vendor number as the maker’s opinion and builds its own transparent scores from the parts.',
      referenceIds: ['dial2025'],
    },
    {
      id: '23-myth-stages',
      claim: 'My wearable accurately splits the night into deep, light and REM sleep.',
      verdict: 'oversimplified',
      explanation:
        'Asleep versus awake is reliable on good devices, but stage agreement is much weaker, especially for deep sleep and wake. Four-stage accuracy was 79 % with the best methods and 57 % from movement alone in one validation, and deep sleep was underestimated by 43 minutes in another. Vitals does not score stages.',
      referenceIds: ['altini2021', 'robbins2024'],
    },
    {
      id: '23-myth-hrv-absolute',
      claim:
        'A higher heart-rate variability number is always better, and my number can be compared with other people’s.',
      verdict: 'not-supported',
      explanation:
        'Values depend on the device and the measurement window, with a device-specific bias of up to about 16 ms between a ring and ECG. Only changes against your own baseline from the same source mean something.',
      referenceIds: ['cao2022', 'dial2025'],
    },
    {
      id: '23-myth-stress-score',
      claim: 'The stress score on my watch measures my psychological stress.',
      verdict: 'not-supported',
      explanation:
        'Vendor stress scores track heart-rate variability changes in the laboratory, but no cortisol or psychological validation was found for any vendor. Vitals calls its own version autonomic load.',
      referenceIds: ['garminstress2025'],
    },
    {
      id: '23-myth-rhr-alert',
      claim: 'A raised overnight heart rate means I am ill.',
      verdict: 'oversimplified',
      explanation:
        'It detected 80 % of infections a few days before symptoms in a large cohort, but also fired about one night in eight in healthy people and after alcohol, stress and travel.',
      referenceIds: ['alavi2022'],
    },
  ],
  openQuestions: [
    'How wrong is a cheap ring? No independent validation of the Colmi, J-Style and similar rings exists, so the tier C bands are assumptions until one is recorded side by side with a chest strap or a validated ring for a few weeks.',
    'Should readiness keep its nutrition term? The pathway from yesterday’s food to tonight’s autonomic state is weak.',
    'Can open-source sleep staging from heartbeat intervals and movement reach acceptable agreement per device? Staging needs beat-level data and device-specific validation, and is deferred.',
    'How should free days be detected for social jet lag and chronotype, from the user’s calendar, a weekend default or asking?',
    'What are the full state-transition rules of the published illness detector beyond the worked example in the paper? Vitals needs them taken from the open code.',
    'Do the proposed combination rules for illness and overreaching hold up against a person’s own labelled illness and overload episodes?',
  ],
  references: [
    {
      id: 'altini2021',
      authors: 'Altini M, Kinnunen H.',
      year: 2021,
      title:
        'The promise of sleep: a multi-sensor approach for accurate sleep stage detection using the Oura ring',
      journal: 'Sensors 21:4302',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8271886/',
    },
    {
      id: 'svensson2024',
      authors: 'Svensson T, et al.',
      year: 2024,
      title:
        'Validity and reliability of the Oura Ring Generation 3 (Gen3) with Oura sleep staging algorithm 2.0 (OSSA 2.0) when compared to multi-night ambulatory polysomnography: A validation study of 96 participants and 421,045 epochs',
      journal: 'Sleep Med',
      pmid: '38382312',
      doi: '10.1016/j.sleep.2024.01.020',
      url: 'https://www.sciencedirect.com/science/article/pii/S1389945724000200',
      verification: 'abstract',
    },
    {
      id: 'robbins2024',
      authors: 'Robbins R, et al.',
      year: 2024,
      title: 'Accuracy of three commercial wearable devices for sleep tracking in healthy adults',
      journal: 'Sensors',
      pmid: '39460013',
      doi: '10.3390/s24206532',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11511193/',
      verification: 'abstract',
    },
    {
      id: 'cao2022',
      authors: 'Cao R, et al.',
      year: 2022,
      title:
        'Accuracy assessment of Oura Ring nocturnal heart rate and heart rate variability in comparison with electrocardiography',
      journal: 'JMIR 24:e27487',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8808342/',
    },
    {
      id: 'dial2025',
      authors: 'Dial MB, et al.',
      year: 2025,
      title: 'Validation of nocturnal resting heart rate and heart rate variability in consumer wearables',
      journal: 'Physiol Rep 13',
      pmid: '40834291',
      doi: '10.14814/phy2.70527',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12367097/',
      verification: 'abstract',
    },
    {
      id: 'phillips2017',
      authors: 'Phillips AJK, et al.',
      year: 2017,
      title:
        'Irregular sleep/wake patterns are associated with poorer academic performance and delayed circadian and sleep/wake timing',
      journal: 'Sci Rep 7:3216',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5468315/',
      verification: 'full-text',
    },
    {
      id: 'windred2024',
      authors: 'Windred DP, et al.',
      year: 2024,
      title:
        'Sleep regularity is a stronger predictor of mortality risk than sleep duration: a prospective cohort study',
      journal: 'Sleep 47:zsad253',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10782501/',
    },
    {
      id: 'nedeltcheva2010',
      authors: 'Nedeltcheva AV, Kilkus JM, Imperial J, Schoeller DA, Penev PD',
      year: 2010,
      title: 'Insufficient sleep undermines dietary efforts to reduce adiposity',
      journal: 'Ann Intern Med',
      pmid: '20921542',
      doi: '10.7326/0003-4819-153-7-201010050-00006',
    },
    {
      id: 'plews2013a',
      authors: 'Plews DJ, Laursen PB, Kilding AE, Buchheit M.',
      year: 2013,
      title: 'Evaluating training adaptation with heart-rate measures: a methodological comparison',
      journal: 'Int J Sports Physiol Perform',
      pmid: '23479420',
      doi: '10.1123/ijspp.8.6.688',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23479420/',
      verification: 'abstract',
    },
    {
      id: 'plews2013b',
      authors: 'Plews DJ, Laursen PB, Stanley J, Kilding AE, Buchheit M.',
      year: 2013,
      title:
        'Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring',
      journal: 'Sports Med',
      pmid: '23852425',
      doi: '10.1007/s40279-013-0071-8',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23852425/',
      verification: 'abstract',
    },
    {
      id: 'javaloyes2019',
      authors: 'Javaloyes A, Sarabia JM, Lamberts RP, Moya-Ramon M.',
      year: 2019,
      title: 'Training prescription guided by heart-rate variability in cycling',
      journal: 'Int J Sports Physiol Perform',
      pmid: '29809080',
      doi: '10.1123/ijspp.2018-0122',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29809080/',
      verification: 'abstract',
    },
    {
      id: 'bosquet2008',
      authors: 'Bosquet L, et al.',
      year: 2008,
      title:
        'Is heart rate a convenient tool to monitor over-reaching? A systematic review of the literature',
      journal: 'Br J Sports Med',
      pmid: '18308872',
      doi: '10.1136/bjsm.2007.042200',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18308872/',
      verification: 'abstract',
    },
    {
      id: 'alavi2022',
      authors: 'Alavi A, et al.',
      year: 2022,
      title: 'Real-time alerting system for COVID-19 and other stress events using wearable data',
      journal: 'Nat Med',
      doi: '10.1038/s41591-021-01593-2',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8799466/',
    },
    {
      id: 'mishra2020',
      authors: 'Mishra T, et al.',
      year: 2020,
      title: 'Pre-symptomatic detection of COVID-19 from smartwatch data',
      journal: 'Nat Biomed Eng',
      pmid: '33208926',
      doi: '10.1038/s41551-020-00640-6',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9020268/',
      verification: 'abstract',
    },
    {
      id: 'mason2022',
      authors: 'Mason AE, et al.',
      year: 2022,
      title:
        'Detection of COVID-19 using multimodal data from a wearable device: results from the first TemPredict study',
      journal: 'Sci Rep',
      pmid: '35236896',
      doi: '10.1038/s41598-022-07314-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35236896/',
      verification: 'abstract',
    },
    {
      id: 'miller2020',
      authors: 'Miller DJ, et al.',
      year: 2020,
      title: 'Analyzing changes in respiratory rate to predict the risk of COVID-19 infection',
      journal: 'PLoS One 15:e0243693',
      pmid: '33301493',
      doi: '10.1371/journal.pone.0243693',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33301493/',
      verification: 'abstract',
    },
    {
      id: 'smarr2020',
      authors: 'Smarr BL, et al.',
      year: 2020,
      title: 'Feasibility of continuous fever monitoring using wearable devices',
      journal: 'Sci Rep',
      pmid: '33318528',
      doi: '10.1038/s41598-020-78355-6',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33318528/',
      verification: 'abstract',
    },
    {
      id: 'maijala2019',
      authors: 'Maijala A, et al.',
      year: 2019,
      title:
        'Nocturnal finger skin temperature in menstrual cycle tracking: ambulatory pilot study using a wearable Oura ring',
      journal: 'BMC Womens Health',
      pmid: '31783840',
      doi: '10.1186/s12905-019-0844-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31783840/',
      verification: 'abstract',
    },
    {
      id: 'sjoding2020',
      authors: 'Sjoding MW, et al.',
      year: 2020,
      title: 'Racial bias in pulse oximetry measurement',
      journal: 'N Engl J Med',
      url: 'https://www.nejm.org/doi/full/10.1056/NEJMc2029240',
    },
    {
      id: 'bent2020',
      authors: 'Bent B, et al.',
      year: 2020,
      title: 'Investigating sources of inaccuracy in wearable optical heart rate sensors',
      journal: 'npj Digit Med',
      doi: '10.1038/s41746-020-0226-6',
    },
    {
      id: 'garminstress2025',
      authors: 'Rosenbach H, Itzkovitch A, Gidron Y, Schonberg T.',
      year: 2025,
      title:
        'Assessing Garmin Stress Level Score Against Heart Rate Variability Measurements (preprint; Garmin Vivosmart 4 vs Polar H10 chest-strap ECG)',
      journal: 'bioRxiv',
      doi: '10.1101/2025.01.06.630177',
      verification: 'abstract',
    },
    {
      id: 'foster2001',
      authors: 'Foster C, et al.',
      year: 2001,
      title: 'A new approach to monitoring exercise training',
      journal: 'J Strength Cond Res',
      pmid: '11708692',
    },
    {
      id: 'williams2017',
      authors: 'Williams S, et al.',
      year: 2017,
      title: 'Better way to determine the acute:chronic workload ratio?',
      journal: 'Br J Sports Med',
      pmid: '27650255',
      doi: '10.1136/bjsports-2016-096589',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27650255/',
      verification: 'abstract',
    },
    {
      id: 'jackson1990',
      authors: 'Jackson AS, Blair SN, Mahar MT et al.',
      year: 1990,
      title: 'Prediction of functional aerobic capacity without exercise testing',
      journal: 'Med Sci Sports Exerc',
      pmid: '2287267',
      doi: '10.1249/00005768-199012000-00021',
    },
    {
      id: 'uth2004',
      authors: 'Uth N, et al.',
      year: 2004,
      title: 'Estimation of VO2max from the ratio between HRmax and HRrest: the heart rate ratio method',
      journal: 'Eur J Appl Physiol',
      pmid: '14624296',
    },
    {
      id: 'firstbeat2017',
      authors: 'Firstbeat Technologies',
      year: 2017,
      title: 'Automated fitness level (VO2max) estimation with heart rate and speed data (white paper)',
      journal: 'Vendor white paper',
      url: 'https://www.firstbeat.com/wp-content/uploads/2017/06/white_paper_VO2max_30.6.2017.pdf',
    },
    {
      id: 'lambe2025',
      authors: 'Lambe R, et al.',
      year: 2025,
      title: 'Investigating the accuracy of Apple Watch VO2 max measurements: A validation study',
      journal: 'PLoS One',
      pmid: '40373042',
      doi: '10.1371/journal.pone.0323741',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40373042/',
      verification: 'abstract',
    },
    {
      id: 'kline1987',
      authors: 'Kline GM, et al.',
      year: 1987,
      title: 'Estimation of VO2max from a one-mile track walk, gender, age, and body weight',
      journal: 'Med Sci Sports Exerc',
      pmid: '3600239',
    },
  ],
};

export default topic;
