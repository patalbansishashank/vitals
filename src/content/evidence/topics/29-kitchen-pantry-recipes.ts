import type { EvidenceTopic, KeyNumber, Reference } from '../schema';

/*
 * Kitchen, pantry and recipes. Written from the kitchen-catalogue research note (equipment, cuisines, staples, pantry and
 * regional defaults). That note makes no health claims: it describes what the catalogue holds, how the lists are
 * grouped and pre-ticked, and how pantry items link to the food table. Sources are only those the note opened, with the
 * identifiers it gives; the encyclopaedia pages are descriptive and graded accordingly.
 */

const kn = (label: string, value: string, note?: string, referenceIds?: string[]): KeyNumber => ({
  label,
  value,
  ...(note ? { note } : {}),
  ...(referenceIds ? { referenceIds } : {}),
});

const cuisinePage = (id: string, name: string, slug: string): Reference => ({
  id,
  authors: `Descriptive encyclopaedia entry on ${name} cuisine.`,
  year: 2026,
  title: `${name} cuisine: staple grains, cooking fats, pulses and vessels, accessed 2026`,
  journal: 'Online encyclopaedia (descriptive, not a study)',
  url: `https://en.wikipedia.org/wiki/${slug}`,
  verification: 'unverified',
});

const topic: EvidenceTopic = {
  dossier: '29',
  slug: 'kitchen-pantry-recipes',
  title: 'Kitchen, pantry and recipes',
  scope:
    'How what you cook with (your equipment, the cuisines you cook most, your staple grains, pulses and fats, and what is in the kitchen right now) shapes the recipes the Coach offers, how the starting lists for each region are chosen, and how pantry items get nutrient values. None of this changes your energy or protein targets: it only changes which dishes are suggested to meet them. The regional lists are a convenience built from descriptions of regional cooking and a little survey data, so they carry a low grade.',
  mechanisms: [
    {
      id: '29-kitchen-shapes-recipes',
      title: 'Your kitchen decides which recipes are offered, not how much you eat',
      category: 'fuel',
      summary:
        'A recipe is only useful if you can cook it with what you own and what you have. Vitals keeps four lists you can edit: equipment (stove, pressure cooker sizes, oven or OTG, steamers, grinders, fridge and freezer), the cuisines you cook most in ranked order, your staples (the grains, pulses, fats and proteins you cook with most), and the pantry (what is in the kitchen now). The Coach reads these before it suggests a meal, so a kitchen without an oven is not offered a baked dish, and a recipe is built mostly from food you already have.',
      howModelled:
        'Before planning recipes, the Coach receives a short note: every piece of equipment you listed (with your own note, such as an oven size, and whether you own it but do not use it), your three most-cooked cuisines, your staples, and up to 60 pantry items, with a count of any more. It is told to cook with these and to ask before assuming anything else. When a pantry exists, recipes should mostly use pantry items. Staples and pantry entries that are the same food (paneer as a staple and paneer in the fridge) are counted once. Nothing here changes the day’s energy, protein, carbohydrate or fat targets, which come from your plan; the kitchen only changes the dishes chosen to meet them.',
      keyNumbers: [
        kn('Items in the catalogue', '181 equipment items, 139 cuisines, 288 staples, 546 pantry items'),
        kn('Pantry items passed to the Coach', 'up to 60, plus a count of the rest'),
        kn('Cuisines passed to the Coach', 'your top 3, most cooked first'),
        kn('A perishable item counts as unconfirmed after', '14 days', 'It is never removed automatically.'),
        kn(
          'Effect on targets',
          'none: energy and macro targets are unchanged',
          'The kitchen changes dish choice only.',
        ),
      ],
      timeCourse:
        'Takes effect on the next recipe request after you change a list. Nothing in the kitchen expires on its own: a perishable item you have not confirmed for 14 days stays on the list, and the Coach asks whether you still have it only when a recipe depends on it.',
      moderators:
        'How complete your lists are (an empty list means the Coach asks rather than assumes), the cooking time you allow, and your cooking skill when you have given it.',
      grade: 'D',
      gradeReason:
        'This is a design choice about how recipes are generated, not a measured effect, and it makes no health claim.',
      status: 'proposed-fit',
      caveats:
        'The Coach is a language model following instructions; it can still suggest a step your kitchen cannot do. Tell it, and it will adjust.',
      referenceIds: [],
      relatedMetricIds: [],
    },
    {
      id: '29-regional-defaults',
      title: 'Regional starting lists save typing; they are not a guess about your diet',
      category: 'fuel',
      summary:
        'A Kerala kitchen and a Punjabi kitchen start from different short lists: matta rice, coconut oil, an appam pan and a puttu maker against atta, basmati, mustard oil, a tawa and paneer. These starting lists come from descriptions of each regional cuisine (its staple grains, fats, pulses and vessels) and, for cooking oil, from a national survey in which mustard oil was the main household oil in about half of Indian homes. They only save typing: every pre-ticked item can be removed with one tap, and nothing perishable is ever pre-ticked.',
      howModelled:
        'There are 17 regions: 12 within India and 5 world regions. Each has three tiers. A short list is ticked on first view; a longer “common in your region” list is shown first in each group but not ticked; everything else is one tap away through the group list or search. The region comes from your own answer, otherwise from the region of your most-cooked cuisine; outside India with no clue, a general Western list is used, and inside India with no clue nothing is pre-ticked rather than guessing the wrong state. Two regions (a Tamil family living in Delhi, for example) combine as the union of both short lists, ordered by the first. Wood, coal and kerosene stoves are in the catalogue because many rural homes still cook on them; they are never pre-ticked.',
      keyNumbers: [
        kn('Regions', '17: 12 Indian and 5 world regions'),
        kn(
          'Pre-ticked per region',
          '11–20 equipment items, 16–24 staples, 12–18 pantry items',
          'Pantry pre-ticks are non-perishable basics only (salt, spices, a regional masala, a pickle).',
        ),
        kn(
          'Household cooking oil in India',
          'mustard oil the main oil in 51 % of households; refined oils in 32.4 %',
          'National figures read from the study abstract; the regional shares were not checked, so regional default oils rest on cuisine descriptions and judgement.',
          ['phn2021'],
        ),
        kn(
          'Households using clean cooking fuel in India',
          '63 % overall: 92.9 % urban, 49.3 % rural',
          'A news report of the 2022–23 government survey. This is why slow-heat stoves without an oven are handled.',
          ['cam2022'],
        ),
      ],
      timeCourse: 'Applies once, when you first open the kitchen lists; after that only your own edits count.',
      moderators: 'Which region you choose, the cuisines you rank first, and whether you live in or outside India.',
      grade: 'D',
      gradeReason:
        'Built from descriptive encyclopaedia pages, one survey abstract and judgement; no source on appliance ownership was found, so the pre-ticked equipment errs toward ticking too little.',
      status: 'proposed-fit',
      caveats:
        'Regional cooking varies within a state and between families, and some regions (Delhi, Tripura, Arunachal Pradesh) rest on neighbouring descriptions. Hindi and regional names are search aids and were not checked one by one.',
      referenceIds: [
        'phn2021',
        'cam2022',
        'wPunjabi',
        'wMaharashtrian',
        'wTamil',
        'wKerala',
        'wBengali',
        'wKashmiri',
        'wMediterranean',
      ],
      relatedMetricIds: [],
    },
    {
      id: '29-pantry-food-values',
      title: 'Pantry items get nutrient values from a measured food table, and Indian items are marked as estimates',
      category: 'fuel',
      summary:
        'Each staple and pantry item points at a food record so that a recipe built from it can be counted. Most point at a record in the US Department of Agriculture’s measured food composition table. Many Indian foods have no good match there: the best source is the Indian Food Composition Tables (2017), which Vitals is not yet licensed to use. Until then such items are either counted with the closest US record and marked as estimates, or not counted at all.',
      howModelled:
        'An item links to its food record by the record’s id. Where the US record is only a close stand-in for an Indian food (for example the common millet record standing in for ragi, bajra and the small millets, or carp for rohu and catla), the item is counted for energy, protein, carbohydrate and fat but marked as an estimate, and no vitamin or mineral statement is made from it. Where no honest stand-in exists (urad dal, poha, makhana, sattu, Indian gourds, regional masalas and pickles), the Coach can still cook with the item but its nutrients are not counted until a record exists. Staples point at raw food (dry grain, raw dal, raw meat), because the plan works in raw grams and converts to cooked weight itself.',
      keyNumbers: [
        kn(
          'Staple and pantry items with a food link',
          '467 distinct US records, each matched by exact description and checked by hand',
          'Spot-checked against the live database for three foods (egg, cheddar, pinto beans).',
          ['usdaSr2018'],
        ),
        kn('Indian items counted with a US stand-in and marked as estimates', '88'),
        kn('Indian items with no stand-in, not counted yet', '172'),
        kn(
          'Size of the error from a stand-in',
          'small for energy and macronutrients in most cases; unknown and possibly large for minerals',
          'Ragi’s minerals are widely reported to differ from the millet record used, so no calcium or iron claim is made from it.',
        ),
      ],
      timeCourse: 'Fixed until the licensed Indian table is added; then estimated items are replaced by measured values.',
      moderators:
        'How much of your diet is made of items marked as estimates or not counted; regional fish and rice varieties are the most common.',
      grade: 'C',
      gradeReason:
        'The values themselves are laboratory measurements from a national food table, but using a different food or species as a stand-in is a judgement, and its error is not measured.',
      status: 'established',
      caveats:
        'A few links are loose and under review (a pizza base points at a cooked cheese pizza). Fish fat content varies with season and species, so fish stand-ins are rough.',
      referenceIds: ['usdaSr2018'],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '29-myth-region-decides-diet',
      claim: 'Choosing a region means the app assumes what you eat.',
      verdict: 'not-supported',
      explanation:
        'The region only sets a short starting list of non-perishable basics and the order items appear in. Every item can be removed with one tap, everything else is one tap away, and the Coach works from your edited lists, not from the region.',
      referenceIds: [],
    },
    {
      id: '29-myth-any-table-fits-indian-food',
      claim: 'Any food table counts Indian foods accurately.',
      verdict: 'oversimplified',
      explanation:
        'Many Indian foods are missing from the US table, and some close matches are a different species (proso millet for ragi, butterfish for pomfret). Energy and macronutrients are usually close; minerals can differ, so those items are marked as estimates or left uncounted.',
      referenceIds: ['usdaSr2018'],
    },
  ],
  openQuestions: [
    'When will the Indian Food Composition Tables (2017) be licensed, so that estimated and uncounted Indian items get measured values?',
    'What share of households in each Indian region use each cooking oil? Only the national shares were checked.',
    'How common are pressure cookers, mixer-grinders, ovens and air fryers in Indian homes? No source was found, so the pre-ticked equipment is judgement.',
  ],
  references: [
    {
      id: 'usdaSr2018',
      authors: 'US Department of Agriculture, Agricultural Research Service',
      year: 2018,
      title: 'FoodData Central: SR Legacy food composition data (release 2018-04)',
      journal: 'USDA FoodData Central (public-domain dataset)',
      url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip',
      verification: 'full-text',
    },
    {
      id: 'phn2021',
      authors: 'Study in Public Health Nutrition (author list not recorded in our notes)',
      year: 2021,
      title: 'Association between mustard oil consumption and BMI in India',
      journal: 'Public Health Nutrition',
      pmid: '33190676',
      doi: '10.1017/S1368980020004632',
      verification: 'abstract',
    },
    {
      id: 'cam2022',
      authors: 'ThePrint (news report of a government survey)',
      year: 2026,
      title:
        '50% rural, 93% urban households in India use clean fuel for cooking, shows latest government survey (survey 2022–23), accessed 2026',
      journal: 'ThePrint (news report, not a study)',
      url: 'https://theprint.in/india/50-rural-93-urban-households-in-india-use-clean-fuel-for-cooking-shows-latest-govt-survey/2306271/',
      verification: 'unverified',
    },
    cuisinePage('wPunjabi', 'Punjabi', 'Punjabi_cuisine'),
    cuisinePage('wMaharashtrian', 'Maharashtrian', 'Maharashtrian_cuisine'),
    cuisinePage('wTamil', 'Tamil', 'Tamil_cuisine'),
    cuisinePage('wKerala', 'Kerala', 'Kerala_cuisine'),
    cuisinePage('wBengali', 'Bengali', 'Bengali_cuisine'),
    cuisinePage('wKashmiri', 'Kashmiri', 'Kashmiri_cuisine'),
    cuisinePage('wMediterranean', 'Mediterranean', 'Mediterranean_cuisine'),
  ],
};

export default topic;
