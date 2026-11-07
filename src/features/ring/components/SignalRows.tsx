/**
 * The pieces of the Signals card and of the Ring glance on Today (r071, AUDIT cards 3 and 31): the hero reading with its
 * day spark, a row (a reading on its `RangeScale`, or a plain value), and the age of a reading. The words are the ring's
 * own bands (`statusOf`), the scale is `metricScale`; quiet mode keeps the word and the marker's place, never a figure.
 */
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { GlowLine, HeroNumber, Icon, MonoMeta, RangeScale, StateWord } from '@/components';
import { useQuietMode } from '@/state/settingsStore';
import { useSeries } from '../data';
import { metricDomain } from '../domains';
import { METRICS, decimalsOf, statusOf, toDisplay, unitOf, valueText, type PersonalBaselines, type ReadingAgeView, type RingMetric, type Status, type UnitPrefs } from '../model';
import type { EntryValue } from '../monitor/values';
import type { MonitorEntry } from '../monitor/catalogue';
import { quietAge, wordsOnly } from '../quiet';
import { metricScale } from '../scales';
import { bandRange, statusTone, statusWord } from '../signalWords';
import { signalLine } from '../views/detailSeries';
import type { GaugeRawPoint } from '../types';

/** The signal's own word: V2's for the personal ones (the Sleep page's source), else the ring's band for the reading. */
export function signalStatus(e: MonitorEntry, v: EntryValue, base: PersonalBaselines) {
  return v.chip ?? (e.metric && v.reading !== null ? statusOf(e.metric, v.reading, base) : null);
}

/** The hero: the first signal in the list with something to show (in quiet mode, one that has a word, since the number is hidden). Pure. */
export function pickHero<T extends { v: EntryValue; word: string | null }>(facts: readonly T[], quiet: boolean): T | undefined {
  return facts.find((f) => f.v.text !== null && (!quiet || f.word !== null));
}


/**
 * A duration written "7 h 56", "8 h" or "45 min" as the hero's parts (each with its small unit, "7 h 56 m"); null for any other text
 * (a count, a clock time), which the hero draws as it is. Pure.
 */
export function heroParts(text: string | null): Array<{ value: string | number; unit: string }> | null {
  if (!text) return null;
  const hm = /^(\d+) h(?: (\d{2}))?$/.exec(text);
  if (hm) return hm[2] === undefined ? [{ value: Number(hm[1]), unit: 'h' }] : [{ value: Number(hm[1]), unit: 'h' }, { value: hm[2].startsWith('0') ? hm[2] : Number(hm[2]), unit: 'm' }];
  const min = /^(\d+) min$/.exec(text);
  return min ? [{ value: Number(min[1]), unit: 'min' }] : null;
}

/** A reading younger than this, on today, is live: its spark's end dot pulses (twice, then rests). */
export const LIVE_MINUTES = 15;

/** The age of a reading ("10 min ago"); a stale one carries the gold dot, and says so (a state is a mark and a word). Quiet: words. */
export function SignalAge({ age, quiet }: { age: ReadingAgeView; quiet: boolean }) {
  return (
    <MonoMeta className="rgo-age" data-stale={age.stale || undefined}>
      {age.stale ? <i className="rgo-age__dot" aria-hidden="true" /> : null}
      {quiet ? quietAge(age.ageMin) : age.text}
      {age.stale ? <span className="lm-sr">, stale</span> : null}
    </MonoMeta>
  );
}

/** A row's value: the light numeral with its unit small and muted. */
function Num({ text, unit }: { text: string; unit?: string | null }) {
  return (
    <span className="rgo-num">
      {text}
      {unit ? <span className="rgo-unit">{unit}</span> : null}
    </span>
  );
}

/** One signal with a reading: its name, its word and age, the reading, and where it sits on its scale; the row opens the signal's page. */
export function SignalRow({
  kind,
  label,
  to,
  value,
  base,
  age,
  prefs,
  status: given = null,
}: {
  kind: RingMetric;
  label: string;
  to: string;
  value: number;
  base: PersonalBaselines;
  age: ReadingAgeView | null;
  prefs: UnitPrefs;
  /** The word from V2's `vsUsual` for HRV and skin temperature (the Sleep page's source); else the metric's own rule. */
  status?: Status | null;
}) {
  const quiet = useQuietMode().on;
  const status = given ?? statusOf(kind, value, base);
  const scale = metricScale(kind, value, base, prefs, { stale: age?.stale ?? false });
  return (
    <li className="rgo-sig" data-hue={metricDomain(kind)} data-kind={kind}>
      <Link className="rgo-row" to={to}>
        <span className="rgo-row__main">
          <span className="rgo-row__label">{label}</span>
          <span className="rgo-row__meta">
            <StateWord word={statusWord(status, quiet)} tone={statusTone(status)} />
            {age ? <SignalAge age={age} quiet={quiet} /> : null}
          </span>
        </span>
        <span className="rgo-row__value">
          {quiet ? null : <Num text={valueText(kind, value, prefs)} unit={unitOf(kind, prefs)} />}
          {/* the row says it all in words; the scale is the picture of where the reading sits */}
          <span className="rgo-row__scale" aria-hidden="true">
            <RangeScale
              label={label}
              value={scale.value}
              min={scale.min}
              max={scale.max}
              bands={scale.bands}
              usual={scale.usual}
              unit={scale.unit}
              spokenUnit={scale.spokenUnit}
              decimals={scale.decimals}
              ticks={scale.ticks === 'bands' ? 'bands' : undefined}
              hue={metricDomain(kind)}
              size="inline"
              state={scale.state}
              quiet={quiet}
            />
          </span>
        </span>
        <Icon icon={ChevronRight} size={18} className="rgo-row__chev" />
      </Link>
    </li>
  );
}

/** A signal with no scale (sleep times, steps, scores, energy): name, value with its unit, one word; it opens its page. */
export function PlainRow({ label, to, value, unit, chip }: { label: string; to: string; value: string | null; unit?: string | null; chip?: Status | null }) {
  // (0.6.3) quiet mode: no figure, and the chip only when it is words ("Near usual"; never "4 min short")
  const quiet = useQuietMode().on;
  const word = chip ? (quiet ? wordsOnly(chip.word) : chip.word) : null;
  return (
    <li className="rgo-sig">
      <Link className="rgo-row" to={to}>
        <span className="rgo-row__main">
          <span className="rgo-row__label">{label}</span>
          {chip && word ? <span className="rgo-row__meta">{chip.severity === 'info' ? <MonoMeta>{word}</MonoMeta> : <StateWord word={word} tone={statusTone(chip)} />}</span> : null}
        </span>
        <span className="rgo-row__value">{quiet ? null : value !== null ? <Num text={value} unit={unit} /> : <span className="rgo-num">—</span>}</span>
        <Icon icon={ChevronRight} size={18} className="rgo-row__chev" />
      </Link>
    </li>
  );
}

/** The day's readings of a signal as a spark: a smoothed line and its end dot, no labels (the figures are the hero's). */
function SignalSpark({ kind, date, live, quiet, prefs }: { kind: 'hr' | 'spo2' | 'stress'; date: string; live: boolean; quiet: boolean; prefs: UnitPrefs }) {
  const q = useSeries(kind, date, date, 'raw');
  const series = useMemo(
    () => (q.status === 'ready' ? signalLine((q.data.points as GaugeRawPoint[]).map((p) => ({ t: Date.parse(p.at), v: p.value == null || !Number.isFinite(p.value) ? null : toDisplay(kind, p.value, prefs) }))) : []),
    [q, kind, prefs],
  );
  if (series.length < 2) return null;
  return (
    <GlowLine
      label={`${METRICS[kind].label} today`}
      unit={unitOf(kind, prefs)}
      series={series}
      variant="spark"
      smoothing="fine"
      height={56}
      endDot={live ? 'pulse' : 'static'}
      decimals={decimalsOf(kind)}
      hue={metricDomain(kind)}
      quiet={quiet}
    />
  );
}

/**
 * The card's one big reading: the first signal in the person's list that has one. The number, the spark of the day beside
 * it (heart rate, blood oxygen, stress) or its scale (HRV, skin temperature), then its name and age, and its word with the
 * range that word stands for. Quiet: the word where the number was.
 */
export function SignalHero({
  entry,
  value,
  status,
  date,
  today,
  base,
  prefs,
  quiet,
}: {
  entry: MonitorEntry;
  value: EntryValue;
  status: Status | null;
  date: string;
  today: string;
  base: PersonalBaselines;
  prefs: UnitPrefs;
  quiet: boolean;
}) {
  const kind = entry.metric;
  const reading = value.reading;
  const stale = value.age?.stale ?? false;
  const live = !!value.age && !stale && value.age.ageMin < LIVE_MINUTES && date === today;
  const word = status ? statusWord(status, quiet) : null;
  const range = !quiet && kind && reading !== null ? bandRange(kind, reading, prefs) : null;
  const scale = kind && reading !== null ? metricScale(kind, reading, base, prefs, { stale }) : null;
  const sparkKind = kind === 'hr' || kind === 'spo2' || kind === 'stress' ? kind : null;
  const unit = value.unit ?? undefined;
  const parts = kind ? null : heroParts(value.text);
  const spoken = `${entry.label}${value.text !== null ? `, ${value.text}${scale ? ` ${scale.spokenUnit}` : unit ? ` ${unit}` : ''}` : ''}`;
  let picture: ReactNode = null;
  if (sparkKind) picture = <SignalSpark kind={sparkKind} date={date} live={live} quiet={quiet} prefs={prefs} />;
  else if (scale && kind)
    picture = (
      <RangeScale label={entry.label} value={scale.value} min={scale.min} max={scale.max} bands={scale.bands} usual={scale.usual} unit={scale.unit} spokenUnit={scale.spokenUnit} decimals={scale.decimals} hue={metricDomain(kind)} size="inline" state={scale.state} quiet={quiet} />
    );
  return (
    <div className="rgo-hero" data-hue={kind ? metricDomain(kind) : undefined}>
      <div className="rgo-hero__top">
        <HeroNumber
          {...(parts ? { parts } : { value: kind && reading !== null ? toDisplay(kind, reading, prefs) : value.text })}
          decimals={kind ? decimalsOf(kind) : 0}
          unit={parts ? undefined : unit}
          size="num"
          label={quiet ? (word ?? entry.label) : spoken}
          quietWord={quiet ? (word ?? null) : undefined}
        />
        {picture ? <div className="rgo-hero__pic">{picture}</div> : null}
      </div>
      <div className="rgo-hero__facts">
        <span className="rgo-hero__line">
          <MonoMeta tone="ink"><span>{entry.label}</span></MonoMeta>
          {value.age ? <SignalAge age={value.age} quiet={quiet} /> : null}
        </span>
        {/* quiet mode: the word is the hero already, said once */}
        {!quiet && (word || range) ? (
          <span className="rgo-hero__line">
            {word && status ? <StateWord word={word} tone={statusTone(status)} /> : null}
            {range ? <MonoMeta>{range}</MonoMeta> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
