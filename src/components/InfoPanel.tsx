import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { cx } from './lib/cx';
import { Icon } from './icons/Icon';
import { GradeBadge, type EvidenceGrade } from './GradeBadge';
import { MonoMeta } from './MonoMeta';
import { ResponsivePanel } from './SidePanel';
import './infopanel.css';

export type InfoSourceKind = 'ring' | 'phone' | 'estimate' | 'logged' | 'plan' | 'engine';

export interface InfoEvidence {
  /** A /evidence route. */
  to: string;
  label: string;
  grade?: EvidenceGrade;
}

/**
 * What the (i) of a card says (AUDIT §5.2). The text is what used to be subtext: plain, second person, 25 to 60 words.
 */
export interface InfoSpec {
  /** Default: the card's title. */
  title?: string;
  /** One reading paragraph, or sections with their own heading. */
  body: ReactNode | Array<{ heading?: string; body: ReactNode }>;
  /** The "where this comes from" line. */
  source?: { kind: InfoSourceKind; words?: string };
  /** The normal or goal range (a band table, a sentence). */
  range?: ReactNode;
  /** The old per-value popovers, as terms. */
  terms?: Array<{ term: string; text: string }>;
  /** The /evidence page behind the numbers; one or several. */
  evidence?: InfoEvidence | InfoEvidence[];
  /**
   * The existing Explain content (the ExplainDrawer body). A node, not ids: this layer never imports features, so the
   * page passes `<ExplainBody metricId=… />`.
   */
  explain?: ReactNode;
  /** The chart's Table twin (`<ChartTwin data={…} />`). The card's `T` key opens the panel at this section. */
  twin?: ReactNode;
  /** A foot action: "Remove from Today", "Add as widget". Never a commit: the panel's one way out is the ✕. */
  footer?: ReactNode;
}

export interface InfoPanelProps extends InfoSpec {
  open: boolean;
  onClose(): void;
  /** The card's title, for the default panel title. */
  cardTitle?: string;
  /** Open scrolled to this section (the `T` key asks for the twin). */
  section?: 'twin';
  /** Dock in the layout from 1280 px instead of overlaying. */
  dockAtXl?: boolean;
  className?: string;
}

const SOURCE_WORDS: Record<InfoSourceKind, string> = {
  ring: 'Your ring',
  phone: 'Your phone',
  estimate: 'An estimate',
  logged: 'What you logged',
  plan: 'Your plan',
  engine: 'The Vitals engine',
};

/** The sentence under "Where this comes from": the kind, then the card's own words. */
export const sourceText = (s: NonNullable<InfoSpec['source']>): string => `${SOURCE_WORDS[s.kind]}${s.words ? `. ${s.words}` : ''}`;

const sectionsOf = (body: InfoSpec['body']): Array<{ heading?: string; body: ReactNode }> => (Array.isArray(body) ? body : [{ body }]);

/**
 * The (i) panel (r071): a sheet on a phone and a 392 px side panel from 1024 (docked from 1280 on request), through
 * ResponsivePanel, so it springs and restores focus like every other panel. It commits nothing, so the one way out is the
 * ✕ (the One Way Out Rule); a foot action is allowed ("Remove from Today"). Sections, in order: the reading text
 * (15/23, 62ch), where it comes from, the range, terms, evidence, the Explain content, the Table twin.
 */
export function InfoPanel({ open, onClose, title, cardTitle, section, dockAtXl, className, body, source, range, terms, evidence, explain, twin, footer }: InfoPanelProps) {
  const twinId = useId();
  const twinRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || section !== 'twin') return;
    const el = twinRef.current;
    if (!el) return;
    el.scrollIntoView?.({ block: 'start' });
    (el.querySelector('[role="region"]') as HTMLElement | null)?.focus({ preventScroll: true });
  }, [open, section]);
  const evidences = evidence ? (Array.isArray(evidence) ? evidence : [evidence]) : [];
  return (
    <ResponsivePanel open={open} onClose={onClose} title={title ?? cardTitle ?? ''} dockAtXl={dockAtXl} footer={footer} className={cx('lm-infopanel', className)}>
      <div className="lm-infopanel__body">
        <div className="lm-infopanel__read">
          {sectionsOf(body).map((s, i) => (
            <div key={i} className="lm-infopanel__section">
              {s.heading ? <h3 className="lm-infopanel__heading">{s.heading}</h3> : null}
              {typeof s.body === 'string' ? <p className="lm-infopanel__text">{s.body}</p> : s.body}
            </div>
          ))}
        </div>
        {source ? (
          <div className="lm-infopanel__row">
            <MonoMeta>Where this comes from</MonoMeta>
            <p className="lm-infopanel__small">{sourceText(source)}</p>
          </div>
        ) : null}
        {range ? (
          <div className="lm-infopanel__row">
            <MonoMeta>Range</MonoMeta>
            <div className="lm-infopanel__small">{range}</div>
          </div>
        ) : null}
        {terms && terms.length ? (
          <dl className="lm-infopanel__terms">
            {terms.map((t) => (
              <div key={t.term} className="lm-infopanel__term">
                <dt>{t.term}</dt>
                <dd>{t.text}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {evidences.length ? (
          <ul className="lm-infopanel__evidence" aria-label="Evidence">
            {evidences.map((e) => (
              <li key={e.to}>
                <Link to={e.to} className="lm-infopanel__elink" onClick={onClose}>
                  {e.grade ? <GradeBadge grade={e.grade} size="sm" tooltip={false} /> : null}
                  <span className="lm-infopanel__elabel">{e.label}</span>
                  <Icon icon={ChevronRight} size={16} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {explain ? <div className="lm-infopanel__explain">{explain}</div> : null}
        {twin ? (
          <section ref={twinRef} className="lm-infopanel__row lm-infopanel__twin" aria-labelledby={`${twinId}-h`} data-section="twin">
            <MonoMeta id={`${twinId}-h`}>Data table</MonoMeta>
            {twin}
          </section>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}
