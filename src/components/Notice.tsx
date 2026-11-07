import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cx } from './lib/cx';
import { Icon } from './icons/Icon';
import { CautionMark, DangerMark, InfoMark, OkMark } from './icons/glyphs';
import { IconKey } from './Key';

export type Severity = 'info' | 'caution' | 'danger' | 'ok';

const MARK = { info: InfoMark, caution: CautionMark, danger: DangerMark, ok: OkMark } as const;
const WORD: Record<Severity, string> = { info: 'Note', caution: 'Caution', danger: 'Warning', ok: 'Done' };

export interface StatusMarkProps {
  severity: Severity;
  size?: 16 | 20;
  /** Spoken label; omit when adjacent text already states the severity. */
  label?: string;
  className?: string;
}

/**
 * The drawn status mark — info circle, caution triangle, danger octagon, ok
 * check. The shape carries the meaning; the severity colour lives only here.
 */
export function StatusMark({ severity, size = 20, label, className }: StatusMarkProps) {
  return (
    <span className={cx('lm-status-mark inline-flex', className)} data-severity={severity}>
      <Icon icon={MARK[severity]} size={size} label={label} />
    </span>
  );
}

export interface NoticeProps {
  severity: Severity;
  /** First line states the risk or fact (14/500, ink). */
  title: ReactNode;
  /** One line: what to do (14 px, stone). */
  children?: ReactNode;
  /** At most one remedy key (`<Key size="sm" variant="text">Set energy to 75 %</Key>`). */
  actions?: ReactNode;
  /**
   * `boxed` (default): the banner — the card material with no glow, 0.5 px hairline, 14 px corners (the shell's banner slot,
   * sheets). `ruled`: inside a card, plain text with no surface and no rules.
   */
  layout?: 'boxed' | 'ruled';
  /** Dismiss (info and ok only — cautions and dangers stay while the condition holds). */
  onDismiss?: () => void;
  /** Danger/caution banners can collapse to their title line. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Announce on appearance: danger → role=alert, others → role=status. Default false. */
  announce?: boolean;
  className?: string;
}

/**
 * Banner (SPEC §4/§5): title + one line + at most one action on a card-soft
 * surface. Caution and danger keep their drawn mark (gold triangle, rose
 * octagon); info and ok carry no icon. Never a coloured border or fill. One
 * banner at a time, directly under the header — never between content sections.
 */
export function Notice({
  severity,
  title,
  children,
  actions,
  layout = 'boxed',
  onDismiss,
  collapsible = false,
  defaultCollapsed = false,
  announce = false,
  className,
}: NoticeProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const bodyId = useId();
  const canDismiss = Boolean(onDismiss) && (severity === 'info' || severity === 'ok');
  const role = announce ? (severity === 'danger' ? 'alert' : 'status') : undefined;
  const marked = severity === 'caution' || severity === 'danger';
  return (
    <div
      className={cx('lm-notice', className)}
      data-severity={severity}
      data-layout={layout}
      data-mark={marked || undefined}
      data-collapsed={collapsed || undefined}
      role={role}
    >
      {marked ? (
        <span className="lm-notice__mark">
          <Icon icon={MARK[severity]} size={20} />
        </span>
      ) : null}
      <p className="lm-notice__title">
        <span className="lm-sr">{WORD[severity]}: </span>
        {title}
      </p>
      {(canDismiss || collapsible) && (
        <div className="lm-notice__side">
          {collapsible ? (
            <IconKey
              size="sm"
              icon={collapsed ? ChevronDown : ChevronUp}
              label={collapsed ? 'Show details' : 'Collapse to one line'}
              aria-expanded={!collapsed}
              aria-controls={bodyId}
              onClick={() => setCollapsed((c) => !c)}
            />
          ) : null}
          {canDismiss ? <IconKey size="sm" icon={X} label="Dismiss" onClick={onDismiss} /> : null}
        </div>
      )}
      {!collapsed && children ? (
        <div className="lm-notice__body" id={bodyId}>
          {children}
        </div>
      ) : null}
      {!collapsed && actions ? <div className="lm-notice__acts">{actions}</div> : null}
    </div>
  );
}

/** Alias: the spec calls it Banner / SeverityBanner. */
export const Banner = Notice;
export const SeverityBanner = Notice;

export interface InlineWarningProps {
  severity: Severity;
  children: ReactNode;
  /** Optional fix link/key after the sentence. */
  action?: ReactNode;
  /** role=alert for errors that need immediate attention (e.g. inside dialogs). */
  alert?: boolean;
  className?: string;
}

/** Inside controls and sections: 16 px mark + one sentence (14 px). */
export function InlineWarning({ severity, children, action, alert, className }: InlineWarningProps) {
  return (
    <div className={cx('lm-inline-warn', className)} data-severity={severity} role={alert ? 'alert' : undefined}>
      <Icon icon={MARK[severity]} size={16} />
      <span>
        <span className="lm-sr">{WORD[severity]}: </span>
        {children}
        {action ? <> {action}</> : null}
      </span>
    </div>
  );
}
