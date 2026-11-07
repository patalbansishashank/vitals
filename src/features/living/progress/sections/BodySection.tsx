/** Composition is an estimate with a conditional range; girths are logged tape readings. */
import { useState, type CSSProperties } from 'react';
import { ChevronRight, Ruler } from 'lucide-react';
import {
  CardFoot,
  ChartTwin,
  HeroNumber,
  Key,
  MonoMeta,
  StackBar,
  formatNumber,
  formatRange,
  formatSigned,
} from '@/components';
import { topicHref } from '@/features/evidence/links';
import type { LocalDate } from '@/living';
import { useLiving } from '../../data/source';
import { fmtDay } from '../../format';
import { MeasurementPanel, type MeasureKey } from '../components/MeasurementPanel';
import { ProgressCard } from '../components/ProgressCard';
import { PROGRESS_COPY as C } from '../copy';

export interface BodySectionProps {
  today: LocalDate;
  quiet: boolean;
  onShowNumbers?: () => void;
}
const GIRTHS: MeasureKey[] = ['waist', 'hip', 'neck', 'chest', 'arm', 'thigh'];
export function BodySection({ today, quiet, onShowNumbers }: BodySectionProps) {
  const comp = useLiving((s) => s.composition(), []);
  const [initial, setInitial] = useState<MeasureKey | null>(null);
  const rows = comp?.rows ?? [];
  const girths = comp?.girths ?? [];
  const fat = rows.find((r) => /^fat mass$/i.test(r.label));
  const lean = rows.find((r) => /^lean mass$/i.test(r.label));
  const bodyFat = rows.find((r) => /^body fat$/i.test(r.label));
  const hero = bodyFat ?? rows[0];
  const rangeOf = (r: (typeof rows)[number]) =>
    Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo
      ? formatRange(r.lo, r.hi, r.decimals)
      : null;
  const heroRange = hero ? rangeOf(hero) : null;
  const total = fat && lean ? fat.value + lean.value : 0;
  const firstFat = fat && fat.sinceStart !== null ? fat.value - fat.sinceStart : null;
  const firstLean = lean && lean.sinceStart !== null ? lean.value - lean.sinceStart : null;
  const firstShare =
    firstFat !== null && firstLean !== null && firstFat + firstLean > 0
      ? firstFat / (firstFat + firstLean)
      : null;
  const stack = [fat, lean]
    .filter((r) => r !== undefined)
    .map((r, i) => ({
      id: r.label,
      label: r.label,
      valueText: `${formatNumber(r.value, r.decimals)} ${r.unit}`,
      share: total > 0 ? r.value / total : 0,
      hue: i === 0 ? 'var(--lm-hue-body)' : 'var(--lm-hue-body-ink)',
    }));
  return (
    <ProgressCard
      id="body"
      title={C.faces.body}
      icon={Ruler}
      domain="body"
      info={{
        title: 'Body composition',
        body: 'Fat mass, lean mass and body fat are estimates from your logged weight and measurements, each with its range. ‘Since day one’ is how far each has moved from your first estimate. Girths are tape measurements; repeat readings are averaged. The ghost tick marks the composition at the start.',
        source: { kind: 'estimate', words: 'Composition from your logged measurements; girths as entered.' },
        range:
          'Composition ranges are conditional estimates, not calibrated prediction intervals. Tape readings have no modelled range.',
        evidence: { to: topicHref('body-composition-estimation'), label: 'Body composition estimation' },
        twin:
          !quiet && comp ? (
            <ChartTwin
              data={{
                title: 'Body composition and measurements table',
                caption: 'Composition estimates with ranges and logged tape measurements',
                head: ['Measurement', 'Value', 'Range', 'Since day 1', 'Date'],
                rows: [
                  ...rows.map((r) => [
                    r.label,
                    `${formatNumber(r.value, r.decimals)} ${r.unit}`,
                    rangeOf(r) ?? '—',
                    r.sinceStart === null ? '—' : `${formatSigned(r.sinceStart, r.decimals)} ${r.unit}`,
                    comp.asOf,
                  ]),
                  ...girths.map((g) => [
                    g.label,
                    `${formatNumber(g.value, 1)} cm`,
                    g.repeats > 1 ? C.meanOf(g.repeats) : 'Single reading',
                    '—',
                    g.date,
                  ]),
                ],
                fileName: 'body-measurements.csv',
                rowNoun: ['measurement', 'measurements'],
              }}
            />
          ) : undefined,
      }}
      foot={
        <CardFoot
          state={{ word: rows.length ? 'Estimate' : girths.length ? 'Logged' : 'No measurements' }}
          tone="ink"
        >
          <Key arrow onClick={() => setInitial('waist')}>
            {C.addMeasurement}
          </Key>
          {quiet && rows.length && onShowNumbers ? (
            <Key variant="text" size="sm" onClick={onShowNumbers}>
              {C.showNumbers}
            </Key>
          ) : null}
        </CardFoot>
      }
    >
      {hero ? (
        quiet ? (
          <MonoMeta>{C.quietComposition}</MonoMeta>
        ) : (
          <>
            <HeroNumber
              size="num-l"
              value={hero.value}
              decimals={hero.decimals}
              unit={hero.unit}
              label={`${hero.label} ${formatNumber(hero.value, hero.decimals)} ${hero.unit}${heroRange ? `, range ${heroRange}` : ''}`}
            />
            <MonoMeta>
              {hero.label}{heroRange ? ` · Range ${heroRange}` : ''} ·{' '}
              {comp ? fmtDay(comp.asOf) : ''} · Estimate
            </MonoMeta>
          </>
        )
      ) : !girths.length ? (
        <MonoMeta>{C.noMeasurements}</MonoMeta>
      ) : null}
      {fat && lean && total > 0 ? (
        <div className="lv-prog-composition">
          <StackBar label="Composition" rows={stack} quiet={quiet} />
          {firstShare !== null ? (
            <i
              className="lv-prog-composition__start"
              aria-hidden="true"
              style={{ '--start': `${Math.max(0, Math.min(1, firstShare)) * 100}%` } as CSSProperties}
            />
          ) : null}
        </div>
      ) : null}
      {girths.length ? (
        <div className="lv-prog-girths">
          {girths.map((g, i) => (
            <button
              key={`${g.label}:${g.date}:${i}`}
              type="button"
              className="lv-prog-girth"
              onClick={() => setInitial(GIRTHS.find((k) => k === g.label.toLowerCase()) ?? 'waist')}
              aria-label={`Add ${g.label} measurement`}
            >
              <span>
                {g.label}
                <MonoMeta>
                  {fmtDay(g.date)}
                  {!quiet && g.repeats > 1 ? ` · ${C.meanOf(g.repeats)}` : ''}
                </MonoMeta>
              </span>
              <span>{quiet ? 'Logged' : `${formatNumber(g.value, 1)} cm`}</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
      {initial ? (
        <MeasurementPanel
          key={initial}
          open
          onClose={() => setInitial(null)}
          date={today}
          initial={initial}
        />
      ) : null}
    </ProgressCard>
  );
}
