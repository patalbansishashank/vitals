/** Completion over recorded items only. Unlogged items are unknown, never zero. */
import { Check } from 'lucide-react';
import { CardFoot, ChartTwin, HeroNumber, HighlightBars, MonoMeta } from '@/components';
import type { LocalDate } from '@/living';
import { topicHref } from '@/features/evidence/links';
import { useLiving } from '../../data/source';
import { quietWord } from '../../format';
import { PROGRESS_COPY as C } from '../copy';
import { ProgressCard } from '../components/ProgressCard';

export interface AdherenceSectionProps {
  today: LocalDate;
  quiet: boolean;
}
export const recordedDaysText = (n: number): string =>
  `recorded ${Math.max(0, Math.min(7, Math.round(n)))}/7 days`;
export const recordedOfText = (n: number): string =>
  `${Math.max(0, Math.min(7, Math.round(n)))} of 7 days recorded`;

export function AdherenceSection({ today, quiet }: AdherenceSectionProps) {
  const s = useLiving((source) => source.adherence(today), [today]);
  const value = s.a7 !== null && Number.isFinite(s.a7) ? s.a7 : null;
  const known = s.blocks.filter((b) => b.mean !== null && Number.isFinite(b.mean));
  const lowest = known.reduce<(typeof known)[number] | null>(
    (a, b) => (a === null || b.mean! < a.mean! ? b : a),
    null,
  );
  const label = 'Adherence by part of the plan';
  return (
    <ProgressCard
      id="adherence"
      title={C.faces.adherence}
      icon={Check}
      domain="plan"
      info={{
        title: 'How adherence is counted',
        body: [
          { body: 'This is how much of your plan you completed over the last week, counting only items you recorded. A day with nothing logged is left out, never scored as zero. Each bar is one part of the plan; the brightest is the lowest. There are no streaks.' },
          ...s.learned.map((line) => ({ body: quiet ? line.replace(/\d+(?:[.,]\d+)*/g, 'some') : line })),
        ],
        source: { kind: 'logged', words: 'Meals, sessions, fasts and counted steps.' },
        range:
          'Completion runs from none to all of the recorded items. An empty slot means nothing was recorded for that part.',
        evidence: { to: topicHref('tracking-replanning'), label: 'Tracking and replanning' },
        twin: !quiet ? (
          <ChartTwin
            data={{
              title: `${label} table`,
              caption: label,
              head: ['Part', 'Completion', 'Recorded items'],
              rows: s.blocks.map((b) => [
                b.label,
                b.mean === null ? 'Not logged' : `${Math.round(b.mean)} %`,
                b.n,
              ]),
              fileName: 'adherence.csv',
              rowNoun: ['part', 'parts'],
            }}
          />
        ) : undefined,
      }}
      foot={
        <CardFoot
          state={{
            word: lowest
              ? `Lowest · ${lowest.label}${quiet ? '' : ` ${Math.round(lowest.mean!)} %`}`
              : 'Not logged',
          }}
        />
      }
    >
      <HeroNumber
        size="num-l"
        value={value}
        unit="%"
        quietWord={quiet || value === null ? quietWord(value) : undefined}
        label={
          quiet
            ? quietWord(value)
            : value === null
              ? 'Not enough logged'
              : `${Math.round(value)} % completion over the last 7 days`
        }
      />
      <MonoMeta>{quiet ? 'Last week' : `Last 7 days · ${recordedOfText(s.daysLogged7)}`}</MonoMeta>
      <div
        role="img"
        aria-label={`${label}: ${s.blocks.map((b) => `${b.label}, ${quiet ? quietWord(b.mean) : b.mean === null ? 'Not logged' : `${Math.round(b.mean)} percent`}`).join('; ')}. ${lowest ? `Lowest: ${lowest.label}.` : 'Nothing recorded.'}`}
      >
        <div aria-hidden="true">
          <HighlightBars
            name={label}
            dates={s.blocks.map((b) => b.label)}
            values={s.blocks.map((b) => b.mean)}
            max={100}
            highlight={lowest ? s.blocks.indexOf(lowest) : null}
            quiet={quiet}
            height={88}
            variant="spark"
            showAxis={false}
            spoken={(i) => {
              const b = s.blocks[i]!;
              return quiet
                ? `${b.label}: ${quietWord(b.mean)}`
                : `${b.label}: ${b.mean === null ? 'Not logged' : `${Math.round(b.mean)} %`}`;
            }}
          />
        </div>
      </div>
      <div className="lv-prog-parts" aria-hidden="true">
        {s.blocks.map((b) => (
          <div key={b.type}>
            <MonoMeta>{b.label}</MonoMeta>
            {quiet ? null : <MonoMeta>{b.mean === null ? '—' : `${Math.round(b.mean)} %`}</MonoMeta>}
          </div>
        ))}
      </div>
    </ProgressCard>
  );
}
