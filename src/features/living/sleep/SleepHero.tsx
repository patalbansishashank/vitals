/**
 * The night's hero (r071, AUDIT "Sleep"): time asleep as ONE number, and when the night began and ended. One component, three
 * sizes, so the Ring's Sleep tab, the Overview's Sleep card and Today's Sleep card say it the same way.
 *
 * - `lg` (the Sleep tab): the page's one ring (`RadialTicks`, lit to the time asleep against the goal; past the goal a second
 *   lap), the number inside it, and beside it (under it on a phone) when the night began and ended.
 * - `md` (the Overview) and `compact` (Today): the number and a fact line, no ring (one ring a screen: AUDIT §5.4); the card's
 *   foot says the goal.
 *
 * An incomplete night (the ring left minutes unrecorded) shows its lower bound with the range under it ("Between 7 h 10 and
 * 7 h 40"), the ring's lit ticks plain to the lower bound and a faint arc to the upper one: never a number the ring did not
 * see. Quiet: the goal in words instead of the number, the ring lit by ratio, the times as parts of the day.
 */
import { HeroNumber, MonoMeta, RadialTicks } from '@/components';
import { clockOf, minutesText } from '@/features/ring/model';
import { partOfDay, sleepGoalWord } from '@/features/ring/quiet';
import { hoursSpoken, type NightView } from './model';
import './sleep-hero.css';

export type SleepHeroSize = 'lg' | 'md' | 'compact';

export interface SleepHeroProps {
  v: NightView;
  /** The night's goal in minutes. */
  goalMin: number;
  quiet?: boolean;
  size: SleepHeroSize;
  /** False draws the final frame at once (a test, a widget preview). */
  animate?: boolean;
}

/** "7 h 56" as the hero's parts: hours and minutes, each counting up on its own; under an hour just minutes. Pure. */
export function sleepHeroParts(min: number): Array<{ value: string | number; unit: string }> {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return [{ value: m, unit: 'min' }];
  const minutes = m < 10 ? { value: `0${m}`, unit: 'm' } : { value: m, unit: 'm' };
  return m === 0 ? [{ value: h, unit: 'h' }] : [{ value: h, unit: 'h' }, minutes];
}

/** The facts beside the number: when the night began and ended, in the person's words or, in quiet mode, in parts of the day. Pure. */
export function sleepHeroFacts(v: NightView, quiet: boolean): string[] {
  if (quiet) return [`Fell asleep ${partOfDay(v.metrics?.onset ?? v.session.start)}`, `Woke ${partOfDay(v.metrics?.finalWake ?? v.session.end)}`];
  const onset = v.metrics?.onset;
  const wake = v.metrics?.finalWake;
  if (onset && wake) return [`Fell asleep ${clockOf(onset)}`, `Woke ${clockOf(wake)}`];
  return [`${clockOf(v.session.start)}–${clockOf(v.session.end)}`];
}

export function SleepHero({ v, goalMin, quiet = false, size, animate = true }: SleepHeroProps) {
  const lower = v.tstLower;
  const upper = v.tstUpper;
  const range = v.incomplete && upper > lower;
  const word = sleepGoalWord(lower, goalMin, upper);
  const spoken = range ? `${hoursSpoken(lower / 60)} to ${hoursSpoken(upper / 60)} asleep` : `${hoursSpoken(lower / 60)} asleep`;
  const facts = sleepHeroFacts(v, quiet);
  const goal = quiet ? null : `Of ${minutesText(goalMin)}`;
  const hero = (
    <HeroNumber
      parts={sleepHeroParts(lower)}
      size={size === 'md' ? 'num-l' : size === 'lg' ? 'time' : 'num'}
      numerals="proportional"
      quietWord={quiet ? word : undefined}
      label={quiet ? word : spoken}
      animate={animate}
    />
  );
  // A range is essential uncertainty: keep both bounds in a wrapping line, outside the radial centre.
  const rangeLine = range && !quiet ? <MonoMeta className="sl-hero__range"><span>Between {minutesText(lower)} and {minutesText(upper)}</span></MonoMeta> : null;
  if (size === 'lg')
    return (
      <div className="sl-hero" data-size="lg">
        <div className="sl-hero__row">
          <RadialTicks
            label="Asleep"
            value={lower}
            goal={goalMin}
            valueText={v.tstText}
            goalText={minutesText(goalMin)}
            size="lg"
            band={range ? [lower, upper] : undefined}
            quiet={quiet}
            quietFill="ratio"
            quietWord={word}
            animate={animate}
            centre={
              <>
                {hero}
                {goal ? <MonoMeta tone="hue">{goal}</MonoMeta> : null}
              </>
            }
          />
          <div className="sl-hero__facts" data-layout="stack">
            {facts.map((f) => (
              <MonoMeta key={f}>{quiet ? <span>{f}</span> : f}</MonoMeta>
            ))}
          </div>
        </div>
        {rangeLine}
      </div>
    );
  return (
    <div className="sl-hero" data-size={size}>
      {hero}
      {rangeLine}
      <MonoMeta as="div" className="sl-hero__facts" items={facts} />
    </div>
  );
}
