/**
 * Secondary views (CHART_SPEC §7.3, §7.5): "Why did the scale move?" — weekly change in fat, lean tissue, glycogen
 * (with its bound water) and water (fluid shifts + gut contents), net change as a dot — with the whole-horizon
 * breakdown in words, and "Where the energy goes" — resting, digestion, movement and exercise stacked, with the
 * "without adaptation" line. On phones both start collapsed.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Faceplate,
  HeroNumber,
  InfoKey,
  InfoPanel,
  formatNumber,
  formatRange,
  formatSigned,
  type Domain,
} from '@/components';
import {
  TdeeStack,
  WeightDecomposition,
  type ChartController,
  type ChartData,
  type ChartSeries,
} from '@/features/charts';

export interface ScaleBreakdown {
  scale: number;
  fat: number;
  lean: number;
  glycogen: number;
  fluid: number;
  gut: number;
  unit: string;
}

export interface BreakdownProps {
  data: ChartData;
  controller: ChartController;
  breakdown: ScaleBreakdown | null;
  compositionBaseline?: Partial<Record<'fat' | 'lean' | 'glycogen' | 'water', number>>;
  collapsible: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  textures?: boolean;
}

const part = (label: string, v: number) => `${label} ${formatSigned(v, 1)}`;

export function scaleSentence(b: ScaleBreakdown, days: number): string {
  const parts = [
    part('fat', b.fat),
    part('lean tissue', b.lean),
    part('glycogen and its water', b.glycogen),
    part('fluid shifts', b.fluid),
    part('gut contents', b.gut),
  ];
  return `Over ${days} days the scale moves ${formatSigned(b.scale, 1)} ${b.unit}: ${parts.join(' · ')} ${b.unit}.`;
}

function Collapsible({
  id,
  title,
  caption,
  collapsible,
  open,
  onOpenChange,
  children,
  hero,
  domain,
  explanation,
}: {
  id: string;
  title: string;
  caption: string;
  collapsible: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  children: ReactNode;
  hero?: ReactNode;
  domain: Domain;
  explanation: string;
}) {
  const shown = !collapsible || open;
  const [info, setInfo] = useState(false);
  return (
    <Faceplate variant="flush" className="rs-bd" data-domain={domain} aria-labelledby={`${id}-t`}>
      <div className="rs-bd__bar">
        {collapsible ? (
          <button type="button" className="rs-bd__toggle" aria-expanded={shown} aria-controls={`${id}-b`} onClick={() => onOpenChange(!open)}>
            <h2 id={`${id}-t`} className="lm-h3">
              {title}
            </h2>
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" data-open={shown || undefined} />
          </button>
        ) : (
          <h2 id={`${id}-t`} className="lm-h3">
            {title}
          </h2>
        )}
        {shown ? <span className="lm-eng rs-bd__cap">{caption}</span> : null}
        <InfoKey label={`About ${title}`} onClick={() => setInfo(true)} />
      </div>
      <InfoPanel
        title={title}
        cardTitle={title}
        body={explanation}
        open={info}
        onClose={() => setInfo(false)}
      />
      {hero ? <div className="rs-bd__hero">{hero}</div> : null}
      {shown ? (
        <div id={`${id}-b`} className="rs-bd__body">
          {children}
        </div>
      ) : null}
    </Faceplate>
  );
}

export function Breakdown({
  data,
  controller,
  breakdown,
  compositionBaseline,
  collapsible,
  open,
  onOpenChange,
  textures,
}: BreakdownProps) {
  const tdee: ChartSeries | undefined = data.series.find((s) => s.id === 'tdee' && s.kind === 'stacked-area');
  const massUnit = breakdown?.unit ?? 'kg';
  const last = data.time.days - 1;
  const energyValue = tdee?.daily.values[last];
  const low = tdee?.daily.band?.lo[last];
  const high = tdee?.daily.band?.hi[last];
  const energyRange =
    low !== undefined && high !== undefined && Number.isFinite(low) && Number.isFinite(high)
      ? `range ${formatRange(low, high, 0)} ${tdee?.unit}`
      : 'No range';
  return (
    <div className="rs-bds">
      {data.composition ? (
        <Collapsible
          id="rs-bd-scale"
          title="Why did the scale move?"
          domain="body"
          explanation="Water in the chart is fluid shifts and gut contents together; scale weight is read on waking. The lead number is the nominal change across the whole plan. This breakdown does not provide a range for that change."
          caption={`weekly change · ${massUnit}`}
          collapsible={collapsible}
          open={open}
          onOpenChange={onOpenChange}
          hero={
            breakdown ? (
              <HeroNumber
                value={breakdown.scale}
                format={(v) => formatSigned(v, 1)}
                unit={massUnit}
                size="num"
                range="Whole plan · no range for this change"
                label={`Scale change ${formatSigned(breakdown.scale, 1)} ${massUnit}, whole plan, no range for this change`}
              />
            ) : null
          }
        >
          <WeightDecomposition
            composition={data.composition}
            time={data.time}
            baseline={compositionBaseline}
            height={220}
            legendUnit={false}
          />
          {breakdown ? <p className="rs-bd__text">{scaleSentence(breakdown, data.time.days)}</p> : null}
        </Collapsible>
      ) : null}
      {tdee ? (
        <Collapsible
          id="rs-bd-energy"
          title="Where the energy goes"
          domain="energy"
          explanation="The upper line is what expenditure would be without metabolic adaptation. The chart shows seven-day means; the lead number is expenditure on the last day. A range, when available, describes model variations rather than a probability for you."
          caption={`${tdee.unit} · 7-day mean`}
          collapsible={collapsible}
          open={open}
          onOpenChange={onOpenChange}
          hero={
            <HeroNumber
              value={energyValue !== undefined && Number.isFinite(energyValue) ? energyValue : null}
              unit={tdee.unit}
              size="num"
              range={energyRange}
              label={
                energyValue !== undefined && Number.isFinite(energyValue)
                  ? `Expenditure on the last day ${formatNumber(energyValue, 0)} ${tdee.unit}, ${energyRange}`
                  : 'Expenditure unavailable'
              }
            />
          }
        >
          <TdeeStack
            series={tdee}
            time={data.time}
            phases={data.phases}
            controller={controller}
            textures={textures}
            height={240}
            weeklyMean
          />
          <p className="rs-bd__text">
            Expenditure on day 1: {formatNumber(tdee.daily.values[0]!, 0)} {tdee.unit}; on the last day:{' '}
            {formatNumber(tdee.daily.values[data.time.days - 1]!, 0)} {tdee.unit}.{' '}
          </p>
        </Collapsible>
      ) : null}
    </div>
  );
}
