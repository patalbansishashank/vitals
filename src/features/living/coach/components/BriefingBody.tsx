/** "What the Coach knows": the standing briefing's sections, as plain lines (docked panel, side panel or sheet). */
import { Link } from 'react-router';
import { DottedTrack, HighlightBars, Section } from '@/components';
import { planTrackWords } from '../../model/planTrack';
import type { BriefingModel } from '../briefing';

export function BriefingBody({ model }: { model: BriefingModel }) {
  return (
    <div className="lv-coach-brief__body">
      {model.sections.map((s) => (
        <Section key={s.id} label={s.title} labelAs="h3">
          {s.viz?.kind === 'plan' ? (
            <DottedTrack
              label={s.title}
              {...s.viz.track}
              goal={s.viz.track.to}
              valueText={planTrackWords(s.viz.track)}
              hue="plan"
            />
          ) : null}
          {s.viz?.kind === 'week' ? (
            <HighlightBars
              name={s.title}
              dates={s.viz.dates}
              values={s.viz.values}
              hue="plan"
              highlight="last"
              height={64}
              quiet={s.viz.quiet}
              showAxis={!s.viz.quiet}
            />
          ) : null}
          <ul className="lv-coach-brief__lines">
            {s.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {s.link ? (
            <Link className="lm-link lv-coach-brief__link" to={s.link.to}>
              {s.link.label}
            </Link>
          ) : null}
        </Section>
      ))}
    </div>
  );
}
