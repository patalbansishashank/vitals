/**
 * Naps and other sleep of one date (design/screens/ring-pages.md §7.3.5): rows "nap · 14:10 – 14:40 · 30 min". A nap
 * is a session other than the main night, under 3 h, ending after 09:00 and before 21:00; any other second session is
 * "another sleep". Neither is added to the night's bar or to "asleep".
 */
import { Engraved } from '@/components';
import { SLEEP_COPY as S, clockRange, durLong } from './copySleep';
import { clockAt } from './ringData';
import type { OtherSleep } from './sleepModels';
import './sleep.css';

export function sessionText(o: OtherSleep): string {
  const range = o.start !== null && o.end !== null ? clockRange(clockAt(o.start, o.offsetS), clockAt(o.end, o.offsetS)) : null;
  return S.sessionRow(o.kind === 'nap' ? S.nap : S.another, range, durLong(o.minutes));
}

export function NapList({ others }: { others: readonly OtherSleep[] }) {
  return (
    <div className="sl-naps">
      <Engraved as="p" className="sg-chart__title">
        {S.title.naps}
      </Engraved>
      <ul className="sl-naps__list">
        {others.map((o, i) => (
          <li key={`${o.start ?? 'x'}-${i}`} data-kind={o.kind}>
            {sessionText(o)}
          </li>
        ))}
      </ul>
    </div>
  );
}
