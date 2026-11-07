import type { ReactNode } from 'react';
import {
  CalendarDays,
  Flame,
  Footprints,
  HeartPulse,
  Moon,
  Scale,
  Utensils,
  Activity,
  ChartNoAxesColumn,
  Video,
  Radio,
} from 'lucide-react';
import { CardHead, GradientCard, type CardSize, type Domain, type IconComponent } from '@/components';
import { RingSleepToday, RingGlance, RingShortVideos } from '@/features/ring';
import { SoFarFace, WeightFace, PlanlessWeightFace } from '../components/Faces';
import {
  EnergyCard,
  EnergyBurnedCard,
  StepsCard,
  HeartPointsCard,
  ActivitiesCard,
  EnergyKindsCard,
  StepsDayCard,
} from './ActivityCards';
import { extraTodayCards } from './ExtraCards';
import { RemoveFromToday, withRemoveFoot } from './RemoveFromToday';
import type { TodayCardCtx } from './types';

export interface TodayCardDef {
  id: string;
  title: string;
  icon: IconComponent;
  domain: Domain;
  group: string;
  description: string;
  sizes: CardSize[];
  defaultSize: CardSize;
  presence: 'locked' | 'default' | 'library';
  available(ctx: TodayCardCtx): { ok: true } | { ok: false; reason: string };
  render(ctx: TodayCardCtx, size: CardSize, onRemove?: () => void): ReactNode;
}
const yes = () => ({ ok: true as const });
const happened = (ctx: TodayCardCtx) =>
  ctx.date <= ctx.today ? yes() : { ok: false as const, reason: 'This day is ahead' };
const plan = (ctx: TodayCardCtx) =>
  ctx.plan ? happened(ctx) : { ok: false as const, reason: 'Needs a plan' };
const energy = (ctx: TodayCardCtx) =>
  ctx.quiet ? { ok: false as const, reason: 'Hidden in quiet mode' } : happened(ctx);
const ring = (ctx: TodayCardCtx) =>
  ctx.ring === 'ready' ? happened(ctx) : { ok: false as const, reason: 'Needs ring data' };

export const todayCardRegistry: TodayCardDef[] = [
  {
    id: 'hero',
    title: 'Today',
    icon: CalendarDays,
    domain: 'plan',
    group: 'Plan',
    description: 'What is next in your day',
    sizes: ['hero'],
    defaultSize: 'hero',
    presence: 'locked',
    available: yes,
    render: () => null,
  },
  {
    id: 'eaten',
    title: 'Eaten so far',
    icon: Utensils,
    domain: 'food',
    group: 'Food',
    description: 'Food and protein against your plan',
    sizes: ['tile', 'card', 'wide'],
    defaultSize: 'card',
    presence: 'default',
    available: plan,
    render: (ctx, size, onRemove) =>
      ctx.view ? (
        <SoFarFace
          cardSize={size}
          view={ctx.view}
          quiet={ctx.quiet}
          size="sm"
          title={ctx.isToday ? 'Eaten so far' : 'Day total'}
          over={!ctx.isToday}
          onRemove={onRemove}
          onArc={ctx.focusPlan}
        />
      ) : null,
  },
  {
    id: 'energy',
    title: 'Energy',
    icon: Flame,
    domain: 'energy',
    group: 'Energy',
    description: 'What your day has burned',
    sizes: ['tile', 'card', 'wide'],
    defaultSize: 'card',
    presence: 'default',
    available: energy,
    render: (ctx, size, onRemove) => <EnergyCard ctx={ctx} size={size} onRemove={onRemove} />,
  },
  {
    id: 'sleep',
    title: 'Sleep',
    icon: Moon,
    domain: 'sleep',
    group: 'Sleep',
    description: 'Last night, from your ring',
    sizes: ['tile', 'card', 'wide'],
    defaultSize: 'card',
    presence: 'default',
    available: ring,
    render: (ctx, _size, onRemove) => (
      <RingSleepToday date={ctx.date} today={ctx.today}
        infoFooter={onRemove ? <RemoveFromToday onRemove={onRemove} title="Sleep" /> : undefined} />
    ),
  },
  {
    id: 'steps',
    title: 'Steps',
    icon: Footprints,
    domain: 'steps',
    group: 'Movement',
    description: 'Steps against your daily goal',
    sizes: ['tile', 'card', 'wide'],
    defaultSize: 'tile',
    presence: 'default',
    available: happened,
    render: (ctx, size, onRemove) => <StepsCard ctx={ctx} size={size} onRemove={onRemove} />,
  },
  {
    id: 'weight',
    title: 'Weight',
    icon: Scale,
    domain: 'body',
    group: 'Body',
    description: 'Your weight trend and likely range',
    sizes: ['tile', 'card', 'wide'],
    defaultSize: 'tile',
    presence: 'default',
    available: happened,
    render: (ctx, size, onRemove) =>
      ctx.view ? (
        <WeightFace
          view={ctx.view}
          trend={ctx.trend}
          quiet={ctx.quiet}
          compact={size === 'tile'}
          isToday={ctx.isToday}
          cardSize={size === 'tile' ? 'tile' : 'card'}
          onRemove={onRemove}
        />
      ) : (
        <PlanlessWeightFace
          trend={ctx.trend}
          date={ctx.date}
          quiet={ctx.quiet}
          cardSize={size === 'tile' ? 'tile' : 'card'}
          onRemove={onRemove}
        />
      ),
  },
  {
    id: 'energy-burned',
    title: 'Energy burned',
    icon: Flame,
    domain: 'energy',
    group: 'Energy',
    description: 'Daily totals and the model breakdown',
    sizes: ['tile', 'card', 'wide'],
    defaultSize: 'card',
    presence: 'library',
    available: energy,
    render: (ctx, size, onRemove) => <EnergyBurnedCard ctx={ctx} size={size} onRemove={onRemove} />,
  },
  {
    id: 'energy-kinds',
    title: 'Energy by kind',
    icon: ChartNoAxesColumn,
    domain: 'energy',
    group: 'Energy',
    description: 'Where your burned energy comes from',
    sizes: ['card', 'wide'],
    defaultSize: 'card',
    presence: 'library',
    available: energy,
    render: (ctx, size, onRemove) => <EnergyKindsCard ctx={ctx} size={size} onRemove={onRemove} />,
  },
  {
    id: 'heart-points',
    title: 'Heart Points',
    icon: HeartPulse,
    domain: 'heart',
    group: 'Heart',
    description: 'Your movement through the week',
    sizes: ['tile', 'card', 'wide'],
    defaultSize: 'tile',
    presence: 'library',
    available: happened,
    render: (ctx, size, onRemove) => <HeartPointsCard ctx={ctx} size={size} onRemove={onRemove} />,
  },
  {
    id: 'activities',
    title: "Today's activities",
    icon: Activity,
    domain: 'steps',
    group: 'Movement',
    description: 'Your counted and recorded activities',
    sizes: ['card', 'wide'],
    defaultSize: 'card',
    presence: 'library',
    available: happened,
    render: (ctx, size, onRemove) => <ActivitiesCard ctx={ctx} size={size} onRemove={onRemove} />,
  },
  {
    id: 'steps-day',
    title: 'Steps through the day',
    icon: Footprints,
    domain: 'steps',
    group: 'Movement',
    description: 'When your steps were counted',
    sizes: ['card', 'wide'],
    defaultSize: 'card',
    presence: 'library',
    available: happened,
    render: (ctx, size, onRemove) => <StepsDayCard ctx={ctx} size={size} onRemove={onRemove} />,
  },
  {
    id: 'ring',
    title: 'Ring signals',
    icon: Radio,
    domain: 'heart',
    group: 'Heart',
    description: 'Your chosen signals at a glance',
    sizes: ['card', 'wide'],
    defaultSize: 'card',
    presence: 'library',
    available: ring,
    render: (ctx, _size, onRemove) => (
      <RingGlance date={ctx.date} today={ctx.today}
        infoFooter={onRemove ? <RemoveFromToday onRemove={onRemove} title="Ring signals" /> : undefined} />
    ),
  },
  {
    id: 'videos',
    title: 'Short videos',
    icon: Video,
    domain: 'videos',
    group: 'Short videos',
    description: 'Your short video use this week',
    sizes: ['slim'],
    defaultSize: 'slim',
    presence: 'library',
    available: ring,
    render: (ctx, _size, onRemove) => (
      <RingShortVideos date={ctx.date}
        infoFooter={onRemove ? <RemoveFromToday onRemove={onRemove} title="Short videos" /> : undefined} />
    ),
  },
  {
    id: 'plan',
    title: 'Whole-day plan',
    icon: CalendarDays,
    domain: 'plan',
    group: 'Plan',
    description: 'Every stop, in time order',
    sizes: ['card', 'wide'],
    defaultSize: 'card',
    presence: 'library',
    available: plan,
    render: () => null,
  },
  ...extraTodayCards,
];

export function wholeDayCard(content: ReactNode, onRemove?: () => void) {
  return (
    <GradientCard
      domain="plan"
      aria-label="Whole-day plan"
      head={
        <CardHead
          icon={CalendarDays}
          title="Whole-day plan"
          info={withRemoveFoot(
            {
              body: 'Your plan for this day, in time order. Tap the circle to mark a stop as planned; tap its name to say how it went. Whole-day marks are available after the last timed stop.',
            },
            onRemove,
            'Whole-day plan',
          )}
        />
      }
    >
      {content}
    </GradientCard>
  );
}
