import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Info } from 'lucide-react';
import { cx } from './lib/cx';
import { Icon, type IconComponent } from './icons/Icon';
import { useCardContext } from './cardContext';
import { InfoPanel, type InfoSpec } from './InfoPanel';
import './card.css';

export interface CardHeadProps {
  icon: IconComponent;
  title: string;
  /** What used to be subtext: opens an InfoPanel from the (i) key. Without it the head has no key. */
  info?: InfoSpec;
  /** A MonoMeta before the (i), for a live fact such as LIVE or REC. */
  meta?: ReactNode;
  as?: 'h2' | 'h3';
}

/**
 * The card head (r071): the domain-hued icon, the title and, at the right, the (i) key. Nothing else belongs here:
 * no Details, Open or Table key (the foot carries the one navigation, the (i) panel carries the Table twin).
 */
export function CardHead({ icon, title, info, meta, as: H = 'h3' }: CardHeadProps) {
  const card = useCardContext();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<'twin' | undefined>(undefined);
  const hasTwin = Boolean(info?.twin);
  useEffect(() => {
    if (!card || !hasTwin) return;
    return card.registerInfo(() => {
      setSection('twin');
      setOpen(true);
    });
  }, [card, hasTwin]);
  const label = card?.href ? (
    <Link to={card.href} className="lm-gcard__open" aria-label={card.openLabel}>
      {title}
    </Link>
  ) : card?.onOpen ? (
    <button type="button" className="lm-gcard__open" aria-label={card.openLabel} onClick={card.onOpen}>
      {title}
    </button>
  ) : (
    title
  );
  return (
    <>
      <header className="lm-cardhead">
        <span className="lm-cardhead__ic" aria-hidden="true">
          <Icon icon={icon} size={18} />
        </span>
        <H className="lm-cardhead__title" id={card?.titleId} title={title}>
          {label}
        </H>
        {meta ? <span className="lm-cardhead__meta">{meta}</span> : null}
        {info ? (
          <InfoKey
            label={`About ${title}`}
            expanded={open}
            onClick={() => {
              setSection(undefined);
              setOpen(true);
            }}
          />
        ) : null}
      </header>
      {info ? <InfoPanel {...info} cardTitle={title} open={open} section={section} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export interface InfoKeyProps {
  /** "About Steps" */
  label: string;
  onClick: () => void;
  expanded?: boolean;
  className?: string;
}

/** A quiet information glyph with a 48 px hit area. Its surface appears on hover or keyboard focus. */
export function InfoKey({ label, onClick, expanded, className }: InfoKeyProps) {
  return (
    <button type="button" className={cx('lm-info', className)} aria-label={label} aria-haspopup="dialog" aria-expanded={expanded ? true : undefined} onClick={onClick}>
      <Icon icon={Info} size={14} />
    </button>
  );
}
