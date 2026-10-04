/**
 * The night summary strip (design/screens/ring-pages.md §7.3.1) and the numbers of a week, month or year (§6.2): a
 * readout strip divided by hairlines (2 per row at 390, 4 at 768, one row at 1440). Missing values read "no data",
 * never 0. The ring maker's score shows only when vendor scores are on, as "your ring says … (their estimate)".
 */
import { Faceplate, Readout } from '@/components';
import { fmtDay } from '@/features/living/format';
import { coverageText, type PeriodKind } from '../models';
import { SLEEP_COPY as S, clockRange, durLong } from './copySleep';
import { ChartShell, TwinTable } from './kit';
import { clockAt } from './ringData';
import { sixToClock, type SleepNight, type SleepStats } from './sleepModels';
import './sleep.css';

export interface StripItem {
  id: string;
  label: string;
  /** null = "no data". */
  text: string | null;
  caption?: string;
}

/** Readouts in the strip look (no faceplate of its own, so it can sit inside one). */
export function SleepStrip({ items, label }: { items: readonly StripItem[]; label: string }) {
  return (
    <div className="lm-strip sl-strip" role="group" aria-label={label}>
      {items.map((it) => (
        <div key={it.id} className="lm-strip__item" data-item={it.id}>
          <Readout size="sm" label={it.label} value={0} decimals={0} format={() => it.text ?? S.noData} caption={it.caption} />
        </div>
      ))}
    </div>
  );
}

export interface NightSummaryProps {
  night: SleepNight | null;
  /** The ring maker's sleep score for the date. */
  vendorSleep: number | null;
  /** Vendor scores are on (Settings › Devices). */
  showVendor: boolean;
}

/** §7.3.1: asleep · in bed · awake · unknown (only if > 0) · your ring says (vendor, if on). */
export function NightSummary({ night, vendorSleep, showVendor }: NightSummaryProps) {
  const items: StripItem[] = [
    { id: 'asleep', label: S.strip.asleep, text: night ? durLong(night.asleepMin) : null, ...(night?.provisional ? { caption: S.stillChanging } : {}) },
    {
      id: 'inbed',
      label: S.strip.inBed,
      text: night && night.bed !== null && night.wake !== null ? clockRange(clockAt(night.bed, night.offsetS), clockAt(night.wake, night.offsetS)) : null,
    },
    { id: 'awake', label: S.strip.awake, text: night && night.awakeMin !== null ? durLong(night.awakeMin) : null },
  ];
  if (night && night.stack.unknown > 0) items.push({ id: 'unknown', label: S.strip.unknown, text: durLong(night.stack.unknown), caption: S.strip.unknownCaption });
  if (showVendor && vendorSleep !== null) items.push({ id: 'vendor', label: S.strip.vendor, text: String(Math.round(vendorSleep)), caption: S.strip.vendorCaption });
  return (
    <Faceplate variant="flush" className="sl-summary">
      <SleepStrip items={items} label={S.strip.label} />
      {night?.provisional ? <p className="sl-note sl-summary__note">{S.provisional}</p> : null}
    </Faceplate>
  );
}

export interface PeriodNumbersProps {
  kind: Exclude<PeriodKind, 'day'>;
  stats: SleepStats;
}

/** The numbers faceplate of a week, month or year: the strip and its table twin. */
export function PeriodNumbers({ kind, stats }: PeriodNumbersProps) {
  const rec = stats.recorded;
  const usual = stats.medianBed !== null && stats.medianWake !== null ? clockRange(sixToClock(stats.medianBed), sixToClock(stats.medianWake)) : null;
  const items: StripItem[] = [
    { id: 'avg', label: S.num.avgAsleep, text: stats.avgAsleepMin === null ? null : durLong(stats.avgAsleepMin), ...(rec ? { caption: S.num.avgAsleepCaption(rec) } : {}) },
    { id: 'usual', label: S.num.usual, text: usual, ...(usual ? { caption: S.num.usualCaption } : {}) },
    { id: 'awake', label: S.num.avgAwake, text: stats.avgAwakeMin === null ? null : durLong(stats.avgAwakeMin) },
  ];
  if (kind === 'year') {
    items.push({ id: 'nights', label: S.num.nights, text: `${rec} of ${stats.slots}` });
  } else {
    items.push(
      { id: 'longest', label: S.num.longest, text: stats.longest ? durLong(stats.longest.asleepMin) : null, ...(stats.longest ? { caption: fmtDay(stats.longest.date) } : {}) },
      { id: 'shortest', label: S.num.shortest, text: stats.shortest ? durLong(stats.shortest.asleepMin) : null, ...(stats.shortest ? { caption: fmtDay(stats.shortest.date) } : {}) },
    );
  }
  if (stats.naps > 0) items.push({ id: 'naps', label: S.num.naps, text: String(stats.naps), caption: S.num.napsCaption });
  const coverage = coverageText(rec, stats.slots, 'nights');
  const summary = `${S.title.numbers}: ${items.map((it) => `${it.label} ${it.text ?? S.noData}`).join(', ')}; ${coverage}`;
  return (
    <ChartShell
      title={S.title.numbers}
      header={<span className="sl-head">{coverage}</span>}
      summary={summary}
      height={0}
      table={
        <TwinTable
          caption={S.tableNumbers}
          head={[S.col.measure, S.col.value, S.col.basis]}
          rows={items.map((it) => [it.label, it.text ?? S.noData, it.caption ?? ''])}
        />
      }
    >
      <SleepStrip items={items} label={S.num.label} />
    </ChartShell>
  );
}
