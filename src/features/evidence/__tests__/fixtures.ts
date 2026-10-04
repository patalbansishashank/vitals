import type { EvidenceTopicEntry } from '@/content/evidence';
import type { EvidenceTopic } from '@/content/evidence/schema';
import { EvidenceRepository } from '../data/repository';

/** A mechanism with every optional field, one with none, plus a claim and references of every kind. */
export const topicFuel: EvidenceTopic = {
  dossier: '90',
  slug: 'test-fuel',
  title: 'Test fuel and water',
  scope: 'Glycogen, the water it holds and ketones, for tests.',
  mechanisms: [
    {
      id: '90-full',
      title: 'Glycogen holds water',
      category: 'fuel',
      summary:
        'Each gram of glycogen is stored with about 3 g of water, so glycogen loss shows up on the scale as roughly 4 times its weight.',
      howModelled: 'Water bound to glycogen is counted as three times the glycogen.',
      equation:
        'W_gly = k · G          (k = 3.0 g/g, range 2.7–4.0)\nScale weight = fat + lean + glycogen + water',
      keyNumbers: [
        {
          label: 'Water per gram of glycogen',
          value: '≈ 3 g/g (range 2.7–4)',
          note: 'Measured with biopsies.',
          referenceIds: ['olsson1970'],
        },
        { label: 'Refill time', value: '24–48 h', referenceIds: ['smith2001'] },
        { label: 'Overshoot after depletion', value: '+10–20 %' },
        { label: 'Fourth number', value: '42' },
      ],
      timeCourse: 'Depletes over 1–3 days of low carbohydrate; refills in 24–48 h.',
      moderators: 'Muscle mass and training.',
      grade: 'B',
      gradeReason: 'Several human studies measured water loss with glycogen depletion.',
      status: 'contested',
      caveats: 'The exact ratio varies between studies.',
      referenceIds: ['olsson1970', 'abs2010'],
      relatedMetricIds: ['glycogenTotal', 'scaleWeight'],
    },
    {
      id: '90-bare',
      title: 'Ketone production rises in a fast',
      category: 'fuel',
      summary: 'The liver makes ketones when its glycogen runs low.',
      howModelled: 'A saturating function of the hours since the last meal.',
      keyNumbers: [],
      grade: 'D',
      gradeReason: 'Mostly animal studies.',
      status: 'established',
      referenceIds: [],
      relatedMetricIds: [],
    },
    {
      id: '90-psmf',
      title: 'Protein-sparing modified fast',
      category: 'body',
      summary: 'Very low energy with enough protein keeps more lean tissue.',
      howModelled: 'Protein intake lowers the lean share of the energy gap.',
      keyNumbers: [{ label: 'Protein', value: '1.2–1.5 g/kg' }],
      grade: 'A',
      gradeReason: 'Several controlled trials agree.',
      status: 'proposed-fit',
      referenceIds: ['olsson1970'],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '90-myth-first-week',
      claim: 'The first week of weight loss is all fat.',
      verdict: 'not-supported',
      explanation: 'Mostly glycogen and the water it holds; fat loss follows the energy deficit.',
      referenceIds: ['olsson1970'],
    },
  ],
  openQuestions: ['How much water per gram of glycogen do women store?'],
  references: [
    {
      id: 'olsson1970',
      authors: 'Olsson KE, Saltin B',
      year: 1970,
      title: 'Variation in total body water with muscle glycogen changes in man',
      journal: 'Acta Physiol Scand',
      pmid: '5475323',
      doi: '10.1111/j.1748-1716.1970.tb04764.x',
      verification: 'unverified',
    },
    {
      id: 'abs2010',
      authors: 'Abs A, Bee B',
      year: 2010,
      title: 'Refeeding after fasting: a meta-analysis of randomized trials',
      journal: 'J Test Nutr',
      pmid: '12345',
      verification: 'abstract',
    },
    {
      id: 'smith2001',
      authors: 'Smith J',
      year: 2001,
      title: 'Glycogen and water in rats',
      journal: 'J Rodent Sci',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1000/',
      verification: 'full-text',
    },
    {
      id: 'evil2020',
      authors: 'Evil E',
      year: 2020,
      title: 'Not a real link',
      journal: 'Nowhere',
      url: 'javascript:alert(1)',
    },
  ],
};

export const topicHeart: EvidenceTopic = {
  dossier: '91',
  slug: 'test-heart',
  title: 'Test blood fats',
  scope: 'LDL for tests.',
  mechanisms: [
    {
      id: '91-ldl',
      title: 'Saturated fat raises LDL cholesterol',
      category: 'cardio',
      summary: 'Replacing unsaturated with saturated fat raises LDL.',
      howModelled: 'A linear term per percent of energy.',
      keyNumbers: [],
      grade: 'A',
      gradeReason: 'Meta-analyses of ward studies agree.',
      status: 'established',
      referenceIds: [],
      relatedMetricIds: ['ldl'],
    },
    {
      // lives in 91 although its prefix names dossier 90: resolution must fall back to a full scan
      id: '90-misplaced',
      title: 'A mechanism filed in the wrong dossier',
      category: 'hormones',
      summary: 'Used to test id resolution across topics.',
      howModelled: 'Not modelled.',
      keyNumbers: [],
      grade: 'C',
      gradeReason: 'Test only.',
      status: 'established',
      referenceIds: [],
      relatedMetricIds: [],
    },
  ],
  myths: [],
  openQuestions: [],
  references: [],
};

export interface FixtureRegistry {
  entries: EvidenceTopicEntry[];
  loads: Record<string, number>;
}

/** Registry over the fixture topics, counting loads; `fail` makes a topic's chunk reject. */
export function fixtureRegistry(options: { fail?: string[] } = {}): FixtureRegistry {
  const loads: Record<string, number> = {};
  const entry = (topic: EvidenceTopic): EvidenceTopicEntry => ({
    dossier: topic.dossier,
    slug: topic.slug,
    title: topic.title,
    load: () => {
      loads[topic.slug] = (loads[topic.slug] ?? 0) + 1;
      return options.fail?.includes(topic.slug)
        ? Promise.reject(new Error('chunk failed'))
        : Promise.resolve({ default: topic });
    },
  });
  return { entries: [entry(topicFuel), entry(topicHeart)], loads };
}

/** A repository over the fixtures with every topic already loaded. */
export async function loadedRepository(): Promise<EvidenceRepository> {
  const repo = new EvidenceRepository(fixtureRegistry().entries);
  await repo.loadAll();
  return repo;
}
