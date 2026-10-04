/** "What the Coach knows": the standing briefing's sections, as plain lines (docked panel, side panel or sheet). */
import { Link } from 'react-router';
import { Section } from '@/components';
import type { BriefingModel } from '../briefing';

export function BriefingBody({ model }: { model: BriefingModel }) {
  return (
    <div className="lv-coach-brief__body">
      {model.sections.map((s) => (
        <Section key={s.id} label={s.title} labelAs="h3">
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
