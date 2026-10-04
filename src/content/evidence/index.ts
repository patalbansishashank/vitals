import type { EvidenceTopic } from './schema';

/** One entry per topic file in `topics/`. `load` is a lazy dynamic import, so each topic becomes its own chunk. */
export interface EvidenceTopicEntry {
  dossier: string;
  slug: string;
  title: string;
  load: () => Promise<{ default: EvidenceTopic }>;
}

export const EVIDENCE_TOPICS: EvidenceTopicEntry[] = [
  {
    dossier: '01',
    slug: 'body-weight-models',
    title: 'Body-weight and body-composition models',
    load: () => import('./topics/01-body-weight-models'),
  },
  {
    dossier: '02',
    slug: 'energy-expenditure',
    title: 'Energy expenditure and metabolic adaptation',
    load: () => import('./topics/02-energy-expenditure'),
  },
  {
    dossier: '03',
    slug: 'protein-muscle',
    title: 'Protein, muscle protein synthesis and lean-mass retention',
    load: () => import('./topics/03-protein-muscle'),
  },
  {
    dossier: '04',
    slug: 'carbohydrate-glycogen-insulin',
    title: 'Carbohydrate, glycogen and insulin',
    load: () => import('./topics/04-carbohydrate-glycogen-insulin'),
  },
  {
    dossier: '05',
    slug: 'fat-oxidation-ketosis',
    title: 'Fat oxidation and ketosis',
    load: () => import('./topics/05-fat-oxidation-ketosis'),
  },
  {
    dossier: '06',
    slug: 'cardiometabolic-markers',
    title: 'Blood fats and other cardiometabolic markers',
    load: () => import('./topics/06-cardiometabolic-markers'),
  },
  {
    dossier: '07',
    slug: 'fasting-meal-timing',
    title: 'Fasting, meal timing and eating windows',
    load: () => import('./topics/07-fasting-meal-timing'),
  },
  {
    dossier: '08',
    slug: 'autophagy-longevity',
    title: 'Autophagy and nutrient-sensing pathways',
    load: () => import('./topics/08-autophagy-longevity'),
  },
  {
    dossier: '09',
    slug: 'resistance-training',
    title: 'Resistance training and muscle',
    load: () => import('./topics/09-resistance-training'),
  },
  {
    dossier: '10',
    slug: 'cardio-activity',
    title: 'Cardio, daily movement and activity energy',
    load: () => import('./topics/10-cardio-activity'),
  },
  {
    dossier: '11',
    slug: 'energy-surplus',
    title: 'Energy surplus: where the extra energy goes',
    load: () => import('./topics/11-energy-surplus'),
  },
  {
    dossier: '12',
    slug: 'hormones-appetite',
    title: 'Hormones, appetite and sticking with a plan',
    load: () => import('./topics/12-hormones-appetite'),
  },
  {
    dossier: '13',
    slug: 'transitions-periodisation',
    title: 'Diet transitions, fasting and periodisation',
    load: () => import('./topics/13-transitions-periodisation'),
  },
  {
    dossier: '14',
    slug: 'body-composition-estimation',
    title: 'Estimating body composition and fat distribution',
    load: () => import('./topics/14-body-composition-estimation'),
  },
  {
    dossier: '15',
    slug: 'fibre-hydration-substances',
    title: 'Fibre, food form, hydration, micronutrients and common substances',
    load: () => import('./topics/15-fibre-hydration-substances'),
  },
  {
    dossier: '16',
    slug: 'sleep-sex-age',
    title: 'Sleep, stress, sex, menstrual cycle, menopause, age and other person-level moderators',
    load: () => import('./topics/16-sleep-sex-age'),
  },
  {
    dossier: '17',
    slug: 'safety-limits',
    title: 'Safety limits: what the Planner will not do, and why',
    load: () => import('./topics/17-safety-limits'),
  },
  {
    dossier: '19',
    slug: 'performance-wellbeing-bone',
    title: 'Performance, cognition and mood, bone, immunity, skin and other outcomes',
    load: () => import('./topics/19-performance-wellbeing-bone'),
  },
  {
    dossier: '20',
    slug: 'extended-water-fasting',
    title: 'Extended water-only fasting',
    load: () => import('./topics/20-extended-water-fasting'),
  },
  {
    dossier: '21',
    slug: 'other-levers',
    title: 'Other levers: what else a person can change',
    load: () => import('./topics/21-other-levers'),
  },
  {
    dossier: '22',
    slug: 'daily-activity-maintenance',
    title: 'Daily activity and maintenance energy',
    load: () => import('./topics/22-daily-activity-maintenance'),
  },
  {
    dossier: '23',
    slug: 'wearable-scores',
    title: 'Scores from wearable data',
    load: () => import('./topics/23-wearable-scores'),
  },
  {
    dossier: '24',
    slug: 'tracking-replanning',
    title: 'Tracking and re-planning',
    load: () => import('./topics/24-tracking-replanning'),
  },
  {
    dossier: '25',
    slug: 'training-catalogue',
    title: 'Training catalogue evidence',
    load: () => import('./topics/25-training-catalogue'),
  },
  {
    dossier: '26',
    slug: 'supplements',
    title: 'Supplements',
    load: () => import('./topics/26-supplements'),
  },
  {
    dossier: '27',
    slug: 'evidence-policy',
    title: 'How Vitals weighs evidence',
    load: () => import('./topics/27-evidence-policy'),
  },
  {
    dossier: '28',
    slug: 'blood-markers-and-diet',
    title: 'Blood markers and diet',
    load: () => import('./topics/28-blood-markers-and-diet'),
  },
  {
    dossier: '29',
    slug: 'kitchen-pantry-recipes',
    title: 'Kitchen, pantry and recipes',
    load: () => import('./topics/29-kitchen-pantry-recipes'),
  },
];
