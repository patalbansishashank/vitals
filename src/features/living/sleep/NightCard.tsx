/**
 * Last night (r071, AUDIT card 23): the night as ONE number in the page's one ring (`SleepHero lg`), drawn once as the
 * four-level hypnogram in the stage hues, the WHOLE recorded night with its break (a night in two parts keeps the hatched
 * "No stage" band between them), and once as the shares of its stages. What the night looked like around them is a few
 * facts in mono caps; the goal is the foot; the sleep index, which lives on Scores, is one link under it. Everything the
 * old subtext said is in the (i), with the stage table.
 */
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight, MoonStar } from 'lucide-react';
import { CardFoot, CardHead, ChartTwin, GradientCard, Icon, MonoMeta, StackBar, stackTwin } from '@/components';
import { Hypnogram, sessionStageSpans } from '@/features/ring/components/RingCharts';
import { minutesText, sleepBand } from '@/features/ring/model';
import { hypnogramTwin } from '@/features/ring/twins';
import type { GaugeSleepSession } from '@/features/ring/types';
import { SLEEP_COPY as C } from './copy';
import { nightInfo } from './info';
import { awakeBreakFacts, restorativeFacts, sleepGoalFoot, type NightView } from './model';
import { FactRow, LearningRow } from './parts';
import { SleepHero } from './SleepHero';
import './sleep.css';

export interface NightCardProps {
  v: NightView;
  /** "Last night" or "Night of 28 Oct". */
  title: string;
  goalMin: number;
  goalSource: 'plan' | 'default' | 'ring' | 'setting';
  /** Other sessions that end on the same day (a nap): said as a fact. */
  extra: readonly GaugeSleepSession[];
  quiet: boolean;
  /** The Sleep index of the night (its home is Scores, which the link opens). */
  index: { value: number | null; legacy: boolean } | null;
  scoresHref: string;
  /** Today's "Remove from Today" and the like, in the (i) panel's foot. */
  infoFooter?: ReactNode;
}

export function NightCard({ v, title, goalMin, goalSource, extra, quiet, index, scoresHref, infoFooter }: NightCardProps) {
  const twin = useMemo(() => {
    if (quiet) return undefined;
    const stages = hypnogramTwin({ label: 'Sleep stages', from: v.windowStart, to: v.windowEnd, segments: sessionStageSpans(v.session.blocks) });
    return (
      <>
        <ChartTwin data={stages} />
        <ChartTwin data={stackTwin({ label: 'Stages', rows: v.stages, total: v.tstText })} />
      </>
    );
  }, [quiet, v]);
  const facts: Array<Array<string>> = [];
  const restorative = quiet ? null : restorativeFacts(v);
  if (restorative) facts.push(restorative);
  for (const b of awakeBreakFacts(v.session, quiet)) facts.push([b]);
  if (v.noRemNote) facts.push([v.noRemNote]);
  if (v.incomplete && v.stageNote) facts.push([quiet ? 'Incomplete night' : v.stageNote]);
  if (v.session.source === 'healthConnect') facts.push([C.fromHealthConnect]);
  if (extra.length) facts.push([quiet ? 'Additional sleep during the day' : `${C.additional}: ${extra.map((s) => `${clock(s.start)}–${clock(s.end)} (${minutesText(s.asleepMinutes)})`).join(', ')}`]);
  const band = index?.value != null ? sleepBand(index.value) : null;
  return (
    <GradientCard
      as="section"
      domain="sleep"
      head={<CardHead as="h2" icon={MoonStar} title={title} info={nightInfo({ goalMin, goalSource, quiet, twin, footer: infoFooter })} />}
      foot={
        <>
          {/* quiet: the ring already says it in the same words */}
          <CardFoot state={quiet ? undefined : { word: sleepGoalFoot(v, goalMin, quiet) }} right={quiet ? undefined : C.goalWord(minutesText(goalMin))} />
          {index && band ? (
            <Link to={scoresHref} className="sl-index">
              <MonoMeta tone="hue">{C.sleepIndexLink(quiet ? null : index.value, band, index.legacy)}</MonoMeta>
              <Icon icon={ChevronRight} size={16} />
            </Link>
          ) : null}
        </>
      }
    >
      {v.learning ? <LearningRow learning={v.learning} quiet={quiet} /> : null}
      <SleepHero v={v} goalMin={goalMin} quiet={quiet} size="lg" />
      <Hypnogram session={v.session} from={v.windowStart} to={v.windowEnd} height={128} quiet={quiet} className="sl-night__plot" />
      <StackBar label="Stages" rows={v.stages} quiet={quiet} />
      {facts.length ? (
        <div className="sl-facts">
          {facts.map((items, i) => (
            <FactRow key={i} items={items} />
          ))}
        </div>
      ) : null}
    </GradientCard>
  );
}

/** "02:04" from a server instant (its own wall clock). */
const clock = (iso: string): string => /T(\d{2}:\d{2})/.exec(iso)?.[1] ?? '';
