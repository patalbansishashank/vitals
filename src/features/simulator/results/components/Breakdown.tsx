/**
 * Secondary views (CHART_SPEC §7.3, §7.5): "Why did the scale move?" — weekly change in fat, lean tissue, glycogen
 * (with its bound water) and water (fluid shifts + gut contents), net change as a dot — with the whole-horizon
 * breakdown in words, and "Where the energy goes" — resting, digestion, movement and exercise stacked, with the
 * "without adaptation" line. On phones both start collapsed.
 */
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Faceplate, formatNumber, formatSigned } from '@/components';
import { TdeeStack, WeightDecomposition, type ChartController, type ChartData, type ChartSeries } from '@/features/charts';

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
  const parts = [part('fat', b.fat), part('lean tissue', b.lean), part('glycogen and its water', b.glycogen), part('fluid shifts', b.fluid), part('gut contents', b.gut)];
  return `Over ${days} days the scale moves ${formatSigned(b.scale, 1)} ${b.unit}: ${parts.join(' · ')} ${b.unit}.`;
}

function Collapsible({ id, title, caption, collapsible, open, onOpenChange, children }: { id: string; title: string; caption: string; collapsible: boolean; open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode }) {
  const shown = !collapsible || open;
  return (
    <Faceplate variant="flush" className="rs-bd" aria-labelledby={`${id}-t`}>
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
      </div>
      {shown ? (
        <div id={`${id}-b`} className="rs-bd__body">
          {children}
        </div>
      ) : null}
    </Faceplate>
  );
}

export function Breakdown({ data, controller, breakdown, compositionBaseline, collapsible, open, onOpenChange, textures }: BreakdownProps) {
  const tdee: ChartSeries | undefined = data.series.find((s) => s.id === 'tdee' && s.kind === 'stacked-area');
  const massUnit = breakdown?.unit ?? 'kg';
  return (
    <div className="rs-bds">
      {data.composition ? (
        <Collapsible id="rs-bd-scale" title="Why did the scale move?" caption={`weekly change · ${massUnit}`} collapsible={collapsible} open={open} onOpenChange={onOpenChange}>
          <WeightDecomposition composition={data.composition} time={data.time} baseline={compositionBaseline} height={220} />
          {breakdown ? (
            <p className="rs-bd__text">
              {scaleSentence(breakdown, data.time.days)} <span className="rs-bd__muted">Water in the chart is fluid shifts and gut contents together; scale weight is read on waking.</span>
            </p>
          ) : null}
        </Collapsible>
      ) : null}
      {tdee ? (
        <Collapsible id="rs-bd-energy" title="Where the energy goes" caption={`${tdee.unit} · daily`} collapsible={collapsible} open={open} onOpenChange={onOpenChange}>
          <TdeeStack series={tdee} time={data.time} phases={data.phases} controller={controller} textures={textures} height={240} />
          <p className="rs-bd__text">
            Expenditure on day 1: {formatNumber(tdee.daily.values[0]!, 0)} {tdee.unit}; on the last day: {formatNumber(tdee.daily.values[data.time.days - 1]!, 0)} {tdee.unit}.{' '}
            <span className="rs-bd__muted">The upper line is what expenditure would be without metabolic adaptation.</span>
          </p>
        </Collapsible>
      ) : null}
    </div>
  );
}
