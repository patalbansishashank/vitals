import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '25',
  slug: 'training-catalogue',
  title: 'Training catalogue evidence',
  scope:
    'Vitals keeps a library of exercises, from barbell squats and kettlebell swings to dand, baithak, mudgar and mallakhamb. This topic explains how any exercise, listed, logged or invented, is turned into the same few numbers the simulator already understands: hard sets per muscle region, how heavy the effort was, how close to failure, and how much energy it cost. It also covers how a substitute is credited when equipment is missing, and how sure we are of each mapping. Items with no trial behind them are kept in, mapped by mechanism and graded D, with wider uncertainty bands.',
  mechanisms: [
    {
      id: '25-one-stimulus-currency',
      title: 'Every exercise is counted in hard sets per muscle region',
      category: 'performance',
      summary:
        'However an exercise is named, Vitals asks the same question: which muscle regions did it work, and how hard? A region the exercise loads directly counts one set per set done, a region that only assists counts half a set, and a hard set is one taken fairly close to failure. Cardio and mobility work count as zero sets because they are credited by their own routes.',
      howModelled:
        "Each exercise record lists the nine muscle regions it trains (chest, upper back, shoulders, arms, core, glutes, quads, hamstrings, calves), each marked 1 for a direct share or 0.5 for an indirect one. Forearm and grip work is booked to the arms at 0.5, and the back muscles that hold the spine are booked to the core. Every set is multiplied by that region weight and then by the simulator's own discounts for how many repetitions were left in reserve, how heavy the load was and how long the rest was. Sets of swinging (ballistic) work and holds that stop well short of failure are discounted further, as described in the other mechanisms here. The weekly total per region is what drives modelled muscle gain, so a dand, a push-up and a bench press all feed the same pot.",
      equation:
        'effective sets in region r = Σ over sets of [ region weight (1 or 0.5) × RIR factor × load factor × rest factor × set-type factor ]\nset-type factor = 1 for weights, bodyweight and odd objects; 0.5 for swinging work (range 0.25–0.75); for holds, 1 if the hold ends within about 10 s of failure, else 0.5; 0 for cardio and mobility',
      keyNumbers: [
        {
          label: 'Weight of an indirect (assisting) set',
          value: '0.5 of a direct set',
          note: 'Counting assisting sets fractionally predicted growth better than counting only direct sets or counting every set in full.',
          referenceIds: ['pelland2026'],
        },
        {
          label: 'Smallest weekly dose with a detectable growth response',
          value: '≥ 4 effective sets per region per week, in at least one session',
          referenceIds: ['pelland2026'],
        },
        {
          label: 'Maintenance dose (model)',
          value: '3 sets per region per week up to age 50; 9 at age 70',
          note: 'Grade C; an interpolation from small studies of keeping muscle once built.',
        },
        {
          label: 'Set-type factor for swinging work',
          value: '0.5 (range 0.25–0.75)',
          note: 'A Vitals modelling choice: no trial measures growth per swinging set.',
        },
        {
          label: 'Hold that does not end near failure',
          value: 'counts half a set',
          note: 'A Vitals modelling choice. Studies of holds at specific joint angles were not reviewed.',
        },
        {
          label: 'Sets to build 1RM strength in trained people',
          value: '1 set of 6–12 repetitions at 70–85 %1RM, 2–3 times a week, per lift',
          note: 'Abstract-level check only.',
          referenceIds: ['androulakis2020'],
        },
      ],
      timeCourse:
        'Sets count towards the rolling seven days. The growth that follows is described in the resistance-training topic.',
      moderators:
        'Age (maintenance dose rises with age), training status, and how close to failure each set was taken.',
      grade: 'B',
      gradeReason:
        'The 0.5 weight for assisting sets has a Bayesian model comparison behind it (grade A), but the region lists of individual exercises are mechanistic judgement and the set-type factors are Vitals choices.',
      status: 'established',
      caveats:
        'Which regions an exercise trains, and at what weight, is joint-action reasoning for most items, not measurement. The neck has no region of its own, so neck work earns no set credit. Injury-risk and skill scores attached to items are engineering judgement.',
      referenceIds: ['pelland2026', 'androulakis2020'],
      relatedMetricIds: ['rtMuscleGain', 'strength'],
      relatedParamIds: [
        'muscle.wIndirect',
        'catalogue.medHypertrophySetsWk',
        'catalogue.isometricNonFailureFactor',
        'catalogue.ballisticSetFactor',
      ],
    },
    {
      id: '25-load-from-reps-to-failure',
      title: 'Bodyweight and odd-object work is placed on the load scale by repetitions to failure',
      category: 'performance',
      summary:
        'A push-up or a stone lift has no percentage-of-one-rep-max on the label. Vitals works out an equivalent load from how many repetitions you could manage in total: the more you could do, the lighter the effort. Because growth does not depend on load once sets are taken near failure, this only needs to be roughly right.',
      howModelled:
        'Repetitions to failure is the repetitions done plus the repetitions left in reserve. The equivalent load is then read off an inverted form of a common coaching formula. The result is fed into the same load and effort discounts used for barbell work. Prescriptions keep repetitions to failure at or below 30 for muscle growth and at or below 8 when maximal strength is the goal. If the hardest variant a person owns still takes more than 30 repetitions, that muscle region is called load-limited, which is what drives the equipment shopping list.',
      equation:
        'repetitions to failure R = reps + RIR\nequivalent load (%1RM) = 100 / (1 + R/30)\nexamples: R = 10 → 75 %; R = 20 → 60 %; R = 30 → 50 %; R = 56 → 35 %',
      keyNumbers: [
        {
          label: 'Divisor in the conversion',
          value: '30 repetitions (plausible range 25–40)',
          note: 'The formula is a coaching rule of thumb with no peer-reviewed primary source located. Repetitions at a given percentage differ by exercise and person.',
        },
        {
          label: 'Load above which every near-failure set counts in full',
          value: '35 %1RM, equal to about 56 repetitions to failure',
          referenceIds: ['lasevicius2018'],
        },
        {
          label: 'Cap on repetitions to failure in hypertrophy prescriptions',
          value: '30 repetitions',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Cap for maximal-strength intent',
          value: '8 repetitions (about 80 %1RM or more)',
          note: 'A Vitals modelling choice, grade C.',
        },
      ],
      timeCourse: 'Not applicable; this is a per-set conversion.',
      moderators:
        'Exercise (lower-body and machine lifts allow more repetitions at a given percentage than the formula implies) and how honestly RIR is judged.',
      grade: 'C',
      gradeReason:
        'The principle that load barely matters near failure is grade A, but the repetition-to-percentage conversion is an approximate coaching formula.',
      status: 'proposed-fit',
      caveats:
        'A per-exercise divisor (25 to 40) would be more exact; the data exist but were not extracted. People who are poor at judging how many repetitions they have left will mis-state R.',
      referenceIds: ['lasevicius2018'],
      relatedMetricIds: ['rtMuscleGain'],
      relatedParamIds: [
        'catalogue.epleyDivisor',
        'catalogue.maxRepsToFailureHyp',
        'catalogue.maxRepsToFailureStrength',
        'muscle.loadFullPct',
        'muscle.fLoad20',
      ],
    },
    {
      id: '25-load-independence-bodyweight-bands',
      title: 'Push-ups and bands can build muscle like weights if sets end near failure',
      category: 'performance',
      summary:
        'Trials that matched effort found that a push-up, a resistance band and a bench press produce similar growth and strength. What matters is working close to failure, not the object in your hands. That is why home and bodyweight exercises earn full credit in Vitals when they are hard enough.',
      howModelled:
        'Push-ups, band work and similar items are treated as ordinary resistance sets with an equivalent load from the previous mechanism. They earn full credit only when the set ends within about three repetitions of failure. Bands under-load the stretched position, so when the aim is long-muscle-length work the planner prefers a free weight.',
      keyNumbers: [
        {
          label: 'Push-up versus bench press at about 40 %1RM',
          value: 'similar muscle growth',
          referenceIds: ['kikuchi2017'],
        },
        {
          label: 'Band push-up versus bench press at matched muscle activity',
          value: 'similar strength gains',
          referenceIds: ['calatayud2015'],
        },
        {
          label: 'Elastic versus conventional resistance (8 trials)',
          value: 'no difference in strength',
          referenceIds: ['lopes2019'],
        },
        {
          label: 'Light versus heavy loads with volume matched',
          value: 'growth similar from 20–80 %1RM when taken near failure',
          note: 'Strength favoured the heavier loads.',
          referenceIds: ['lasevicius2018'],
        },
        {
          label: 'Effort threshold for full credit',
          value: 'RIR of 3 or fewer',
          note: 'A Vitals modelling choice.',
        },
      ],
      timeCourse: 'Weeks to months, as for any resistance training.',
      moderators:
        'Training status (a beginner finds a push-up hard; a strong person may run out of load), muscle length at which tension peaks, and effort.',
      grade: 'A',
      gradeReason:
        'Consistent randomised trials and meta-analyses support load independence for push-ups and bands; the reference notes only verified the trial abstracts.',
      status: 'established',
      caveats:
        'The push-up evidence is from one muscle group in a small trial. Beyond a certain strength, bodyweight variants stop being hard enough and the region becomes load-limited, so equipment matters for stronger people.',
      referenceIds: ['kikuchi2017', 'calatayud2015', 'lopes2019', 'lasevicius2018'],
      relatedMetricIds: ['rtMuscleGain', 'strength'],
      relatedParamIds: ['catalogue.defaultRir', 'catalogue.effortRirThreshold'],
    },
    {
      id: '25-ballistic-hybrid-sessions',
      title: 'Swinging work is split between strength and cardio',
      category: 'performance',
      summary:
        'Kettlebell swings, clubs, maces and fast bodyweight cycles are both a strength stimulus and a conditioning stimulus. Vitals splits the time of such a bout into a cardio part and a resistance part, counts the resistance sets at half weight, and books the energy once so nothing is double counted.',
      howModelled:
        'A bout of T minutes of an item with energy cost M and cardio share h becomes two sessions: h × T minutes of cardio and (1 − h) × T minutes of resistance, both at the same energy cost M, so total energy is M × T. The cardio part earns aerobic credit at the intensity implied by M. A bout of at least 20 seconds at effort of 7 out of 10 or more counts as one set times 0.5 times the region weight. Without a logged load, the resistance part is taken as 50 %1RM at 3 repetitions in reserve.',
      equation:
        'cardio minutes = h × T; resistance minutes = (1 − h) × T; energy = M × T in total\nfraction of VO₂max = M × 3.5 / VO₂max (mL/kg/min)',
      keyNumbers: [
        {
          label: 'Two-handed kettlebell swing, 16 kg for 12 minutes',
          value: '≈ 65 % VO₂max and 87 % of maximal heart rate',
          note: 'The Compendium lists the swing at 9.8 MET.',
          referenceIds: ['farrar2010', 'herrmann2024'],
        },
        {
          label: 'Six weeks of kettlebell swing training',
          value: 'maximal strength +9.8 %; explosive strength +19.8 %',
          note: 'No trial measured muscle size.',
          referenceIds: ['lake2012'],
        },
        {
          label: 'Set factor for swinging work',
          value: '0.5 (range 0.25–0.75)',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Cardio share by item (model)',
          value: 'swing 0.6; swing intervals 0.7; baithak 0.5; mudgar and gada 0.5; dand 0.3',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Shortest bout counted as a set',
          value: '20 s',
          note: 'A Vitals modelling choice.',
        },
      ],
      timeCourse: 'Strength changes in the trial appeared within 6 weeks.',
      moderators: "Kettlebell mass, cadence, technique, and the person's VO₂max.",
      grade: 'B',
      gradeReason:
        'Energy and strength for the kettlebell swing are supported by small trials, but the set factor and cardio shares are Vitals estimates.',
      status: 'proposed-fit',
      caveats:
        'The swing papers could be confirmed only through secondary pages; no database ID was found for either. The 0.5 factor and the cardio shares stand in for data that do not exist. Other swinging items inherit the swing figures by analogy.',
      referenceIds: ['farrar2010', 'lake2012', 'herrmann2024'],
      relatedMetricIds: ['exerciseEE', 'vo2max', 'strength'],
      relatedParamIds: [
        'catalogue.ballisticSetFactor',
        'catalogue.ballisticMinWorkSec',
        'catalogue.ballisticDefaultLoadPct',
        'catalogue.ballisticDefaultRir',
        'activity.hardX',
      ],
    },
    {
      id: '25-energy-cost-met-and-equations',
      title: 'Energy cost comes from MET values, and from equations when speed or load is known',
      category: 'energy',
      summary:
        'Each exercise carries an energy cost in METs from the Compendium of Physical Activities, multiplied by time and body mass. Where the person logs speed, incline, power or a carried load, a physiological equation replaces the table value. Items the Compendium does not list are given the cost of the closest listed activity, with a deliberately wide range.',
      howModelled:
        'For a typical item, energy is its MET times 3.5 mL of oxygen per kg per minute times body mass, converted at about 5 kcal per litre of oxygen; the net figure subtracts the person\'s own resting energy. Walking uses a speed-and-height equation, grade adds a term from the American College of Sports Medicine equations, running and stepping use the same family, cycling uses watts, and carrying a load uses a classic load-carriage formula with a terrain factor. Resistance training is costed per session, not per working set, and the app never adds a "during the set" figure on top of the session minutes.',
      equation:
        'gross kcal/min = MET × 3.5 × body mass (kg) / 200\nnet kcal/min = (MET − 1) × 3.5 × body mass (kg) / 200\nwalking: VO₂ = rest + 3.85 + 5.97 × V² / H (V in m/s, H = leg length in m)\nstepping: VO₂ = 0.2 × f + 1.33 × 1.8 × H × f + 3.5 (f steps per min, H step height in m)',
      keyNumbers: [
        {
          label: 'Resistance training session energy cost',
          value:
            '3.5 MET general; 5.0 squats and deadlifts; 6.0 vigorous; 5.8 circuit; 3.0 or 6.5 bodyweight; 9.8 kettlebell swings',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Calisthenics and conditioning (vigorous / moderate / light)',
          value: '7.5 / 3.8 / 2.8 MET',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Surya Namaskar (Compendium)',
          value: '3.5 MET',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Wrestling, competitive',
          value: '6.0 MET',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Activities with no Compendium row',
          value:
            'mudgar, gada, Indian clubs, sumtola, nal, mallakhamb, kabaddi, kho-kho, garba, resistance bands, suspension trainers',
          note: 'Each is given the cost of the closest listed activity (named in the record) and a range that brackets the plausible values.',
        },
        {
          label: 'Terrain factor for load carriage',
          value: '1.0 road; 1.1 dirt; 1.2 light brush; 1.5 heavy brush',
          note: 'Quoted from memory of the original paper and its standard reproductions.',
          referenceIds: ['pandolf1977'],
        },
        {
          label: 'Hard working sets at light loads versus heavy leg work',
          value: '3–10 kcal/min at light loads; above 20 kcal/min at 80 %1RM leg work',
          note: 'Shown only as context; session MET is what drives the books.',
        },
      ],
      timeCourse: 'Not applicable; per-session cost.',
      moderators: 'Body mass, fitness, cadence, load carried, terrain, and gradient.',
      grade: 'A',
      gradeReason:
        'The Compendium and the walking and cycling equations are well established, though analogue costs for uncatalogued items are estimates.',
      status: 'established',
      caveats:
        'The mudgar, gada, club and akhara costs are analogue estimates: no one has measured oxygen use during them, and a single laboratory measurement would lift those items from D to B. The stepping and walking-incline equations were taken from a university teaching handout rather than the guidelines text.',
      referenceIds: ['herrmann2024', 'ludlow2016', 'acsm2013', 'pandolf1977'],
      relatedMetricIds: ['exerciseEE', 'tdee'],
      relatedParamIds: [
        'activity.kcalPerLO2',
        'catalogue.pandolfEtaRoad',
        'catalogue.pandolfEtaDirt',
        'catalogue.pandolfEtaLightBrush',
        'catalogue.pandolfEtaHeavyBrush',
        'catalogue.stairStepHeightM',
      ],
    },
    {
      id: '25-indian-strength-staples',
      title: 'Dand, baithak and the odd-object lifts, described by what they do',
      category: 'performance',
      summary:
        'Dand (the Hindu push-up), baithak (the Hindu squat) and the akhara lifts with the sumtola, the nal and the gar nal have almost no outcome trials of their own. Vitals does not guess from the name. It reads each as a movement pattern, assigns the same muscle regions as the nearest studied exercise, and gives the result a wider uncertainty band.',
      howModelled:
        'Dand is a push pattern: the pike-to-cobra arc adds shoulder flexion and loaded spinal extension, so the shoulders get a full share and the chest a full share, and it adds mobility minutes. It is credited like a push-up variant. Baithak is a knee-dominant squat on the forefoot, with calves at half weight. At kushti cadence of about one repetition every two seconds, in the hundreds of repetitions, it is mostly an endurance and conditioning stimulus, so half of its minutes go to cardio, and it earns growth credit only when sets end within three repetitions of failure. Sumtola (a front-rack barbell-like load), nal (a stone cylinder lifted like a deadlift and clean) and gar nal (a neck ring that adds load to dand and baithak) use the barbell mapping for the same pattern, with full strength transfer from the matching barbell lift. Gar nal loads the neck, so people with neck problems are not offered it.',
      keyNumbers: [
        {
          label: 'Dand energy cost (analogue of vigorous calisthenics)',
          value: '7.5 MET (range 5.6–9.4)',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Baithak energy cost at kushti cadence',
          value: '7.5 MET (range 3.8–9.0); 3.8 MET at an easy pace',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Strength transfer from the matching barbell lift',
          value: '1.0 for same pattern and same implement; 0.8 for same pattern with a different implement',
          note: 'A Vitals modelling choice (grade C).',
        },
        {
          label: 'Grades of these mappings',
          value: 'dand, baithak and the gar nal variants C; sumtola and nal D',
        },
        {
          label: 'Anchor for the push pattern',
          value: 'push-up at about 40 %1RM bench-press equivalent gave similar growth',
          referenceIds: ['kikuchi2017'],
        },
      ],
      timeCourse: 'As for resistance training; no trial of these items exists.',
      moderators:
        'Cadence and repetition count (baithak), neck and wrist health, grip strength (nal), and the weight of the load.',
      grade: 'C',
      gradeReason:
        'The mapping to a push-up or squat is sound by mechanism and by the load-independence evidence, but no trial tests these items, and sumtola and nal are mechanism only (grade D).',
      status: 'proposed-fit',
      caveats:
        'The descriptions of these implements come from a general descriptive source on wrestling training, not a study. Calisthenics-vigorous costs are borrowed. Hundreds of repetitions at kushti cadence were not measured in the lab.',
      referenceIds: ['kikuchi2017', 'herrmann2024', 'pehlwani'],
      relatedMetricIds: ['rtMuscleGain', 'exerciseEE'],
      relatedParamIds: [
        'catalogue.cSamePatternSameImplement',
        'catalogue.cSamePattern',
        'catalogue.maxRepsToFailureHyp',
      ],
    },
    {
      id: '25-swing-implements-mudgar-gada-clubs',
      title: 'Mudgar, jori, gada and Indian clubs are mapped as loaded swings',
      category: 'performance',
      summary:
        'Heavy clubs and maces are swung behind the back and around the body. The load sits far from the hand, so the movement stretches the shoulder and the lats under load, works the grip and forearm, and makes the trunk resist twisting. Light clubs are used for shoulder mobility. There are no outcome trials for the heavy implements.',
      howModelled:
        'The heavy mudgar and the gada are credited as swinging work to the shoulders, upper back and core at a full share and to the arms (grip) at half, then discounted by the swinging set factor of 0.5. A pair of lighter clubs (jori) works the shoulders directly and the rest indirectly. Light club circles are counted as mobility for the shoulder and wrist, with no set credit. Half of the minutes are treated as cardio, and the energy cost is borrowed from vigorous calisthenics with an upper bound at the kettlebell swing.',
      keyNumbers: [
        {
          label: 'Mudgar, gada and club energy',
          value: 'mudgar and gada 7.5 MET (range 3.8–9.8); jori 6.0 MET (range 3.8–7.5); light clubs 3.8 MET',
          note: 'Analogue estimates; none of these has a Compendium row.',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Eight minutes of Indian club swinging in a pilot',
          value: 'acute rise in shoulder peak torque in a diagonal pattern',
          note: 'A conference abstract, not a peer-reviewed full paper.',
          referenceIds: ['clubPilot'],
        },
        {
          label: 'Set factor for swinging work',
          value: '0.5 (range 0.25–0.75)',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Grades of these mappings',
          value: 'heavy mudgar, jori and gada D; light club mobility C',
        },
      ],
      timeCourse: 'Not studied.',
      moderators: 'Implement mass and lever length, shoulder health, and lower-back health.',
      grade: 'D',
      gradeReason:
        'There are no outcome trials or energy measurements for the heavy implements; the mapping is by joint action alone.',
      status: 'proposed-fit',
      caveats:
        'This is the weakest part of the catalogue. The energy figure is borrowed, the set factor is a guess, and the club result is a single pilot abstract. A direct measurement of oxygen use during mudgar swings would be the most useful single study.',
      referenceIds: ['clubPilot', 'pehlwani', 'herrmann2024'],
      relatedMetricIds: ['exerciseEE'],
      relatedParamIds: ['catalogue.ballisticSetFactor'],
    },
    {
      id: '25-mallakhamb-kushti-akhara-sport',
      title: 'Mallakhamb, kushti drills, akhara digging and traditional sport',
      category: 'performance',
      summary:
        'Mallakhamb (climbing and holds on a pole or rope), partner wrestling drills, digging the akhara pit, and games such as kabaddi, kho-kho and garba are whole-body and often skilled. The catalogue maps them to the muscle regions they load and to an energy figure from the nearest listed activity. Only mallakhamb has small trials, and those report fitness changes rather than muscle size.',
      howModelled:
        'Mallakhamb, kushti drilling and akhara digging are whole-body efforts credited to the regions they load directly at a full share, and the rest at half, with large cardio shares (about 0.3 for mallakhamb, 0.7 for kushti drills and digging). Kabaddi and garba are treated as continuous cardio of the stated intensity, with a little credit to the legs and trunk. Neck bridging is treated as supervised-only and carries the highest injury-risk score because it loads the neck.',
      keyNumbers: [
        {
          label: 'Rope mallakhamb for 4 weeks in adolescent girls',
          value: 'respiratory indices +5–13 %',
          note: 'Small regional-journal trial, abstract seen only.',
          referenceIds: ['mallaResp'],
        },
        {
          label: 'Mallakhamb versus tai chi training in kabaddi players',
          value: 'strength and flexibility changes reported',
          note: 'Regional journal, abstract seen only.',
          referenceIds: ['mallaStr'],
        },
        {
          label: 'Wrestling, competitive (used for kushti drills)',
          value: '6.0 MET (range 5.3–10.3)',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Rope mallakhamb energy (analogue: martial arts, slow or novice)',
          value: '5.3 MET (range 3.8–8.0)',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Kabaddi (analogue: wrestling) and garba (analogue: low-impact aerobic dance)',
          value: 'kabaddi 6.0 MET (range 5.0–9.0); garba 4.8 MET (range 4.8–8.0)',
          note: 'Estimates; neither has a Compendium row.',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Grades of these mappings',
          value: 'mallakhamb, kushti drilling and akhara digging C; kabaddi and garba D',
        },
      ],
      timeCourse: 'The mallakhamb respiratory result appeared within 4 weeks; the rest is unstudied.',
      moderators:
        'Skill (mallakhamb is the most skilled item in the catalogue), supervision, and neck, shoulder and knee health.',
      grade: 'C',
      gradeReason:
        'Small trials of mallakhamb exist but are abstract-only and regional; energy figures for the other items are analogue estimates (grade D).',
      status: 'proposed-fit',
      caveats:
        'The digging cost uses a gardening row that was not re-checked. Injury-risk and skill scores are engineering judgement. None of these items is excluded for lack of evidence; they simply carry wider bands.',
      referenceIds: ['mallaResp', 'mallaStr', 'herrmann2024', 'pehlwani'],
      relatedMetricIds: ['exerciseEE', 'vo2max'],
      relatedParamIds: ['catalogue.bandFloorC', 'catalogue.bandFloorD'],
    },
    {
      id: '25-surya-namaskar',
      title: 'Surya Namaskar is light by the table, and harder at a fast pace',
      category: 'performance',
      summary:
        'The sun salutation is a flowing sequence of squats, planks and bends. At the table value it is a light activity, but measured in trained practitioners at a brisk pace it was much harder, and a 24-week programme raised upper-body strength in untrained adults. Vitals scales its energy cost with how many rounds are done per minute.',
      howModelled:
        'Energy runs from 3.5 MET at an easy pace up to 7.4 MET at a fast pace, rising with rounds per minute. Strength credit is small and low-load, so the muscle regions it touches (chest, shoulders, arms, core and quads) are each credited at half weight, and a cardio share of 0.6 is booked. The mobility minutes it adds are credited to the hamstrings, hip flexors, spine and shoulders.',
      keyNumbers: [
        {
          label: 'Compendium value',
          value: '3.5 MET',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Measured in trained practitioners',
          value: '≈ 26 mL/kg/min of oxygen (about 7.4 MET) at 80 % of maximal heart rate',
          referenceIds: ['mody2011'],
        },
        {
          label: '24 rounds, 6 days a week, 24 weeks',
          value: 'bench-press and shoulder-press 1RM rose in untrained adults',
          note: 'Size of the rise not reported in the sources we hold.',
          referenceIds: ['bhutkar2011'],
        },
        {
          label: 'Shortest and longest pace in the model',
          value: '3.5–7.4 MET',
        },
      ],
      timeCourse: 'Strength gains over 24 weeks of near-daily practice.',
      moderators: 'Pace (rounds per minute), training status, and wrist and lower-back health.',
      grade: 'B',
      gradeReason:
        'Energy cost has a laboratory measurement and the Compendium; the strength result is one trial in untrained adults (grade B to C).',
      status: 'established',
      caveats:
        'The strength result applies to untrained adults and would not carry over to trained people. The pace-to-energy scaling between the two anchors is a Vitals choice.',
      referenceIds: ['herrmann2024', 'mody2011', 'bhutkar2011'],
      relatedMetricIds: ['exerciseEE', 'strength'],
      relatedParamIds: ['catalogue.bandFloorB'],
    },
    {
      id: '25-equivalence-credit',
      title: 'Crediting a different exercise: how close is close enough',
      category: 'performance',
      summary:
        'When you do something other than what was planned, Vitals scores how well it matches on a scale from 0 to 1, weighting what the plan was for. At 0.90 or more it counts fully. Between 0.60 and 0.90 it counts partly with a plain note on what is short. Below 0.60 it is logged as a different kind of session and credited for what it actually trains. Nothing is ever refused, and the simulator always sees what was really done.',
      howModelled:
        'The score is a weighted average of five parts: how much of the planned volume per region was delivered, how well the strength demand was matched, how much aerobic credit and high-intensity time was matched, how many calories were spent, and how much mobility time was done. The weights depend on the goal, for example muscle gain weights volume 0.6, strength 0.15 and energy 0.25. Strength carries a transfer coefficient that falls from 1.0 to 0.2 as the new movement moves away from the planned one. Over-delivery is capped at 1 for the score, but extra muscle work is still booked and shown as "also trained". Suggestions such as "add 1 set" or "8 more minutes" are worked out from what was just done.',
      equation:
        'score = Σ weight × component, over parts the goal cares about, re-scaled to sum to 1\nvolume part = Σ priority × min(logged sets, planned sets) / Σ priority × planned sets\nstrength part = transfer × min(1, load credit of logged / load credit of planned)\ntransfer = 1.0 same pattern and implement; 0.8 same pattern, different implement; 0.5 neighbouring pattern; 0.2 anything else',
      keyNumbers: [
        {
          label: 'Full credit threshold',
          value: 'score of 0.90 or more',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Partial credit band',
          value: '0.60 to 0.90',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Goal weights, muscle gain (volume / strength / aerobic / energy / mobility)',
          value: '0.6 / 0.15 / 0 / 0.25 / 0',
          note: 'Other goals: strength 0.3 / 0.6 / 0 / 0.1 / 0; fat loss 0.4 / 0.1 / 0.2 / 0.3 / 0; aerobic fitness 0 / 0 / 0.7 / 0.3 / 0; mobility 0 / 0 / 0 / 0 / 1.',
        },
        {
          label: 'Strength transfer between movements (Vitals defaults)',
          value: '1.0 / 0.8 / 0.5 / 0.2',
          note: 'Strength is task-specific, which is well known, but no numeric transfer matrix was sourced.',
        },
        {
          label:
            'Worked example: 3 × 25 dand at RIR 2 in place of 3 × 10 dumbbell bench at RIR 2 (80 kg user)',
          value: 'volume part 0.96; strength part 0.61; energy part 1; score 0.92, full credit',
        },
        {
          label: 'Worked example: 20 min of two-handed mudgar in place of a 20 min run',
          value: 'score 0.47, a different stimulus; a 12-minute brisk walk would close the gap',
        },
      ],
      timeCourse: 'Scored per session.',
      moderators: 'The goal (it sets the weights), the planned region priorities, and RIR.',
      grade: 'D',
      gradeReason:
        'The score, its cut-offs, the weights and the transfer coefficients are Vitals modelling choices; only the physiology they draw on is evidence-based.',
      status: 'proposed-fit',
      caveats:
        'The score is a display for adherence, not a physiological quantity. The simulator itself is never changed by it. Whether the thresholds feel fair to users is untested.',
      referenceIds: ['kikuchi2017', 'lasevicius2018'],
      relatedMetricIds: ['adherence'],
      relatedParamIds: [
        'catalogue.creditFull',
        'catalogue.creditPartial',
        'catalogue.cSamePatternSameImplement',
        'catalogue.cSamePattern',
        'catalogue.cNeighbourPattern',
        'catalogue.cOtherPattern',
        'catalogue.effortRirThreshold',
      ],
    },
    {
      id: '25-substitution-and-shopping',
      title: 'Planning around the equipment you have, and what to buy next',
      category: 'performance',
      summary:
        'The planner first removes anything the person cannot do: no kit, refused, or ruled out by an injury. From the rest it picks the exercises that cover the target muscles at the lowest time cost, leaning to what the person owns, enjoys and can do safely. If a plan has a gap, such as no pulling movement without a bar, it names the cheapest item that would close it.',
      howModelled:
        "Each candidate gets a usefulness score: availability counts most (owned 1.0, accessible 0.8, 0.5 if the access is outside the person's time window), then enjoyment, then how well it covers the slot, minus time, injury risk and any skill gap. A session is filled greedily until each region hits its weekly target. The shopping list ranks each missing item by how much it would raise the plan's score per unit of price tier, and the top three are checked by re-running the simulator. Items that add almost nothing are left off.",
      equation:
        'usefulness = 3 × availability + 1 × enjoyment + 2 × coverage − 0.5 × minutes/10 − 0.5 × (injury risk − 1) − 0.3 × skill gap\nshopping rank = gain in best-plan usefulness / (price tier + 1)',
      keyNumbers: [
        {
          label: 'Weights in the usefulness score',
          value:
            '3 availability; 1 enjoyment; 2 coverage; −0.5 per 10 min; −0.5 per injury step; −0.3 per skill step',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Availability of an owned, accessible or time-limited item',
          value: '1.0 owned; 0.8 accessible; 0.5 accessible outside the time window',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Smallest gain worth listing for a purchase',
          value: '0.05',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Gaps for bodyweight-only users (mechanism)',
          value:
            'vertical pull, hamstring curls, loading for strong legs, heavy strength work, and high-intensity cardio',
          note: 'The cheapest patch is free, for example an inverted table row or a towel row; the cheapest purchase is a doorframe pull-up bar, a long loop band or kettlebell, or a skipping rope.',
        },
        {
          label: 'Price tiers',
          value: '0 free; 1 under ₹1,000; 2 ₹1,000–5,000; 3 ₹5,000–25,000; 4 over ₹25,000 or gym only',
          note: 'Estimates; real prices were not fetched.',
        },
      ],
      timeCourse: 'Replanned whenever availability, injuries or goals change.',
      moderators:
        'Equipment owned, gym or akhara access and its hours, injuries and conditions (for example uncontrolled high blood pressure rules out inversions and heavy breath-held lifts), time, and enjoyment.',
      grade: 'D',
      gradeReason:
        'The weights, tiers and gap list are Vitals engineering judgement; only the underlying stimulus evidence is graded higher.',
      status: 'proposed-fit',
      caveats:
        'Nothing in this mechanism is validated against outcomes. Safety screens take precedence: a "yes" to a condition that needs clearance caps intensity at moderate until cleared.',
      referenceIds: ['lasevicius2018', 'pelland2026'],
      relatedMetricIds: ['adherence'],
      relatedParamIds: [
        'catalogue.uAvail',
        'catalogue.uEnjoy',
        'catalogue.uCover',
        'catalogue.uMinutesPer10',
        'catalogue.uInjury',
        'catalogue.uSkillGap',
        'catalogue.availOwned',
        'catalogue.availAccess',
        'catalogue.availAccessOutsideWindow',
        'catalogue.shopMinDeltaU',
      ],
    },
    {
      id: '25-certainty-and-wider-bands',
      title: 'Less evidence widens the band; it never removes the exercise',
      category: 'performance',
      summary:
        "Every item carries a grade for how well its mapping is supported. Grade A and B mappings ride on trials; grade C and D rely on mechanism. A lower grade does not exclude an exercise: it makes the simulator's uncertainty range wider and softens the wording. An item enters the simulator as long as there is a plausible path from the movement to something the model tracks, unless trials show no effect or harm.",
      howModelled:
        "An unstudied item is attached to a studied one that works by the same mechanism, for example dand to the push-up. The more the two differ in population, intervention and outcome, the lower the item's grade and the wider its transfer band. A grade sets a minimum width for the uncertainty on the numbers used for the item and never narrows an existing band. The centre of the band does not move, so the best guess stays the same while the range grows.",
      equation:
        'minimum relative spread by grade: A 5 %, B 10 %, C 20 %, D 35 %\nspread of transfer factor = 0.10 + 0.50 × (1 − similarity to the studied anchor), plus a small share of "transfers poorly"',
      keyNumbers: [
        {
          label: 'Minimum relative spread by grade',
          value: 'A 5 %; B 10 %; C 20 %; D 35 %',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Weight of the "transfers poorly" component',
          value:
            '0.10 when every link is shown in humans; 0.25 when a link is assumed or an AI proposed the item',
          note: 'A Vitals modelling choice.',
        },
        {
          label: 'Grades of items in the library',
          value:
            'A for push-up and the main weight lifts; B for kettlebell and Surya Namaskar; C for dand, baithak, clubs and mallakhamb; D for mudgar, gada, sumtola, nal and kabaddi',
        },
        {
          label: 'Items made up by the AI from free text',
          value: 'always grade D, with a stated mechanism',
        },
      ],
      timeCourse: 'Not applicable.',
      moderators: 'Similarity to the studied anchor, and whether direct human evidence agrees in direction.',
      grade: 'D',
      gradeReason: 'The band widths and weights are Vitals modelling choices, selected to be conservative.',
      status: 'proposed-fit',
      caveats:
        'A direct human trial that agrees in direction with the mapping can raise an item by one grade. The traditional implements have no such trial, so none gets that lift.',
      referenceIds: ['kikuchi2017', 'pehlwani'],
      relatedMetricIds: [],
      relatedParamIds: [
        'catalogue.bandFloorA',
        'catalogue.bandFloorB',
        'catalogue.bandFloorC',
        'catalogue.bandFloorD',
        'catalogue.tauSigmaBase',
        'catalogue.tauSigmaSlope',
        'catalogue.tauWShown',
        'catalogue.tauWAssumed',
      ],
    },
  ],
  myths: [
    {
      id: '25-myth-heavy-only',
      claim: 'Only heavy weights build muscle, so bodyweight and band work is a poor substitute.',
      verdict: 'not-supported',
      explanation:
        'When sets are taken close to failure, light and heavy loads grew muscle similarly in trials with volume matched, and push-ups and band work matched bench-press results in the studies reviewed. Heavier loads do favour maximal strength, and bodyweight variants stop being hard enough for strong people, which is what equipment is for.',
      referenceIds: ['lasevicius2018', 'kikuchi2017', 'calatayud2015', 'lopes2019'],
    },
    {
      id: '25-myth-traditional-proven',
      claim: 'Traditional Indian exercises such as the mudgar and gada are proven by centuries of use.',
      verdict: 'unproven',
      explanation:
        'Long use shows people do them, not what they achieve. Outcome trials of heavy mudgar and gada work do not exist, and their energy cost has not been measured. Vitals counts them by mechanism, as shoulder, back and trunk work, and gives them wide uncertainty rather than leaving them out.',
      referenceIds: ['pehlwani', 'clubPilot'],
    },
    {
      id: '25-myth-surya-namaskar-burns-little',
      claim: 'A sun salutation is only gentle stretching and burns almost nothing.',
      verdict: 'oversimplified',
      explanation:
        'The table value is a light 3.5 MET, but trained practitioners at a brisk pace were measured at about 7.4 MET, and a 24-week programme raised upper-body strength in untrained adults. The effort depends on pace and the person.',
      referenceIds: ['herrmann2024', 'mody2011', 'bhutkar2011'],
    },
    {
      id: '25-myth-hundreds-of-baithaks',
      claim: 'Hundreds of baithaks a day will build big legs.',
      verdict: 'oversimplified',
      explanation:
        "At that many repetitions, bodyweight squats are a light load, so growth credit applies only if each set really ends within a few repetitions of failure. At wrestlers' cadence the main gains are endurance and conditioning, which is how Vitals counts them.",
      referenceIds: ['lasevicius2018', 'herrmann2024'],
    },
    {
      id: '25-myth-same-calories-same-benefit',
      claim: 'If two workouts burn the same calories they are interchangeable.',
      verdict: 'not-supported',
      explanation:
        'Energy cost is only one of five parts of the match score. A calorie-matched session can miss the planned muscles, the load or the aerobic intensity, so Vitals credits a substitute for what it actually trains.',
      referenceIds: ['herrmann2024'],
    },
  ],
  openQuestions: [
    'How many oxygen litres per minute does a 10 kg mudgar or a gada swing really use? A single laboratory measurement would move these items from grade D to grade B.',
    'Is half a set the right value for a swinging set? No trial has measured muscle growth per kettlebell swing, club swing or mace swing.',
    'Should the repetition-to-load conversion use a different divisor for each exercise? Lower-body and machine lifts allow more repetitions at a given percentage, and the data exist but were not extracted.',
    'How much does strength transfer between a barbell lift and its bodyweight or odd-object cousin? The 1.0, 0.8, 0.5 and 0.2 steps are a reasoned default, not a measured matrix.',
    'What credit should holds such as planks, wall sits and yoga postures earn? Studies of holds at specific joint angles were not reviewed.',
    'What are the real prices in rupees of the equipment on the shopping list? The tiers are estimates.',
  ],
  references: [
    {
      id: 'herrmann2024',
      authors: 'Herrmann SD, Willis EA, Ainsworth BE, et al.',
      year: 2024,
      title:
        '2024 Adult Compendium of Physical Activities: a third update of the energy costs of human activities',
      journal: 'J Sport Health Sci',
      pmid: '38242596',
      doi: '10.1016/j.jshs.2023.10.010',
      url: 'https://pacompendium.com/conditioning-exercise/',
    },
    {
      id: 'pelland2026',
      authors: 'Pelland JC, Remmert JF, Robinson ZP, Hinson SR, Zourdos MC.',
      year: 2026,
      title:
        'The resistance training dose response: meta-regressions exploring the effects of weekly volume and frequency on muscle hypertrophy and strength gains',
      journal: 'Sports Med',
      pmid: '41343037',
      doi: '10.1007/s40279-025-02344-w',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41343037/',
    },
    {
      id: 'lasevicius2018',
      authors: 'Lasevicius T, Ugrinowitsch C, Schoenfeld BJ, et al.',
      year: 2018,
      title:
        'Effects of different intensities of resistance training with equated volume load on muscle strength and hypertrophy',
      journal: 'Eur J Sport Sci',
      pmid: '29564973',
      doi: '10.1080/17461391.2018.1450898',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29564973/',
    },
    {
      id: 'kikuchi2017',
      authors: 'Kikuchi N, Nakazato K.',
      year: 2017,
      title: 'Low-load bench press and push-up induce similar muscle hypertrophy and strength gain',
      journal: 'J Exerc Sci Fit 15:37-42',
      pmid: '29541130',
      doi: '10.1016/j.jesf.2017.06.003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29541130/',
      verification: 'abstract',
    },
    {
      id: 'calatayud2015',
      authors: 'Calatayud J, Borreani S, Colado JC, Martin F, Tella V, Andersen LL.',
      year: 2015,
      title:
        'Bench press and push-up at comparable levels of muscle activity results in similar strength gains',
      journal: 'J Strength Cond Res 29:246-253',
      pmid: '24983847',
      doi: '10.1519/jsc.0000000000000589',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24983847/',
      verification: 'abstract',
    },
    {
      id: 'lopes2019',
      authors: 'Lopes JSS, Machado AF, Micheletti JK, de Almeida AC, Cavina AP, Pastre CM.',
      year: 2019,
      title:
        'Effects of training with elastic resistance versus conventional resistance on muscular strength: A systematic review and meta-analysis',
      journal: 'SAGE Open Med 7:2050312119831116',
      pmid: '30815258',
      doi: '10.1177/2050312119831116',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6383082/',
      verification: 'abstract',
    },
    {
      id: 'androulakis2020',
      authors: 'Androulakis-Korakakis P, Fisher JP, Steele J.',
      year: 2020,
      title:
        'The Minimum Effective Training Dose Required to Increase 1RM Strength in Resistance-Trained Men: A Systematic Review and Meta-Analysis',
      journal: 'Sports Med',
      pmid: '31797219',
      doi: '10.1007/s40279-019-01236-0',
      url: 'https://www.ufrgs.br/sees-initiative/pmid31797219/',
      verification: 'abstract',
    },
    {
      id: 'farrar2010',
      authors: 'Farrar RE, Mayhew JL, Koch AJ.',
      year: 2010,
      title: 'Oxygen cost of kettlebell swings',
      journal: 'J Strength Cond Res 24:1034–1036',
      pmid: '20300022',
      doi: '10.1519/jsc.0b013e3181d15516',
      url: 'https://www.unm.edu/~lkravitz/Article%20folder/kettlebellresearch.html',
      verification: 'abstract',
    },
    {
      id: 'lake2012',
      authors: 'Lake JP, Lauder MA.',
      year: 2012,
      title: 'Kettlebell swing training improves maximal and explosive strength',
      journal: 'J Strength Cond Res 26:2228–2233',
      pmid: '22580981',
      doi: '10.1519/jsc.0b013e31825c2c9b',
      url: 'https://eprints.chi.ac.uk/id/eprint/266/',
      verification: 'abstract',
    },
    {
      id: 'ludlow2016',
      authors: 'Ludlow LW, Weyand PG',
      year: 2016,
      title:
        'Energy expenditure during level human walking: seeking a simple and accurate predictive solution',
      journal: 'J Appl Physiol',
      pmid: '26679617',
      doi: '10.1152/japplphysiol.00864.2015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26679617/',
    },
    {
      id: 'pandolf1977',
      authors: 'Pandolf KB, Givoni B, Goldman RF.',
      year: 1977,
      title: 'Predicting energy expenditure with loads while standing or walking very slowly',
      journal: 'J Appl Physiol 43:577–581',
      pmid: '908672',
      doi: '10.1152/jappl.1977.43.4.577',
      url: 'https://doi.org/10.1152/jappl.1977.43.4.577',
      verification: 'abstract',
    },
    {
      id: 'acsm2013',
      authors: 'American College of Sports Medicine metabolic equations (university teaching handout).',
      year: 2013,
      title: 'Metabolic calculations for walking, running, leg and arm ergometry, and stepping',
      journal: 'Teaching handout; the guidelines text itself was not accessed',
      url: 'https://www.depts.ttu.edu/ksm/_documents/grad/acsm_comps/6c-23-2013_HFI_Metabolic_Calculations.pdf',
      verification: 'unverified',
    },
    {
      id: 'mody2011',
      authors: 'Mody BS.',
      year: 2011,
      title: 'Acute effects of Surya Namaskar on the cardiovascular & metabolic system',
      journal: 'J Bodyw Mov Ther 15:343-347',
      pmid: '21665111',
      doi: '10.1016/j.jbmt.2010.05.001',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21665111/',
      verification: 'abstract',
    },
    {
      id: 'bhutkar2011',
      authors: 'Bhutkar MV, Bhutkar PM, Taware GB, Surdi AD.',
      year: 2011,
      title:
        'How effective is sun salutation in improving muscle strength, general body endurance and body composition?',
      journal: 'Asian J Sports Med 2:259-266',
      pmid: '22375247',
      doi: '10.5812/asjsm.34742',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3289222',
      verification: 'abstract',
    },
    {
      id: 'clubPilot',
      authors: 'Phillips S, Rothstein A.',
      year: 2022,
      title:
        'Effects of acute Indian club swinging on strength, endurance, and mobility (conference abstract)',
      journal: 'Int J Exerc Sci 15(5) (conference proceedings)',
      url: 'https://digitalcommons.wku.edu/ijesab/vol15/iss5/25',
      verification: 'abstract',
    },
    {
      id: 'mallaResp',
      authors: 'Bal B, Singh K.',
      year: 2010,
      title: 'Effects of 4-week rope mallakhamb training on respiratory indices in adolescent girls',
      journal: 'Biomed Hum Kinet 2:70-73',
      doi: '10.2478/v10101-0017-7',
      url: 'https://doaj.org/article/e646b94f0f504347a1e6345b01ff93f5',
      verification: 'abstract',
    },
    {
      id: 'mallaStr',
      authors: 'Natarajan D.',
      year: 2018,
      title:
        'Mallakhamb and tai chi training on selected physical fitness variables among men intercollegiate kabaddi players',
      journal: 'Int J Physiol Nutr Phys Educ 3(2):1096-1100',
      url: 'https://www.journalofsports.com/archives/2018/vol3/issue2/3-2-172',
      verification: 'abstract',
    },
    {
      id: 'pehlwani',
      authors: 'Descriptive encyclopaedia entry on Pehlwani wrestling training.',
      year: 2026,
      title:
        'Pehlwani: training implements (gada, jori, nal, gar nal, sumtola, dand, baithak), accessed 2026',
      journal: 'Online encyclopaedia (descriptive, not a study)',
      url: 'https://en.wikipedia.org/wiki/Pehlwani',
      verification: 'unverified',
    },
  ],
};

export default topic;
