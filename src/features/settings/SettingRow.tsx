import { createContext, createElement, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, ChevronRight } from 'lucide-react';
import { CardHead, GradientCard, Icon, InfoKey, InfoPanel, cx, type Domain, type IconComponent, type InfoSpec } from '@/components';

/*
 * Settings building blocks (Lumen settings groups, SPEC §5 "Lists/groups"): a sentence-case group label over one card
 * surface (20 px corners, 0.5 px hairline), rows of at least 64 px inside it, separated by inset hairlines aligned to the
 * text column. Index rows carry a 22 px stone icon, a title, a trailing value and a chevron; control rows a label (and
 * at most one fact line) with the control at the right, or (`wide`: selectors, fields, selects) in a control column of
 * one width on wider screens and under the label, full width, on phones (r068 S8, S19, S27).
 *
 * r071: a group may carry the round (i) in its head (`info`), a row beside its label (`SettingRow info`), and a section that
 * holds data shows it on a `SettingsCard` (a neutral GradientCard with its head, picture and foot). Every group rises
 * with the page (`data-enter`). A group's heading is an h2 under the page's h1; where the page already has an h2 for the
 * open section (the desktop detail) the page says so through `SettingsHeadingLevel` and the groups are h3.
 */

/** The level of a group's heading: 2 under the page's h1, 3 beneath the desktop detail's own h2 (AUDIT B P2-2). */
export const SettingsHeadingLevel = createContext<2 | 3>(2);

/** The round (i) of a group head, a row label or a card: opens its panel (a sheet on a phone, a side panel from 1024). */
export function SettingInfo({ title, info, className }: { title: string; info: InfoSpec; className?: string }) {
  const [open, setOpen] = useState(false);
  const name = info.title ?? title;
  return (
    <>
      <InfoKey label={`About ${name}`} expanded={open} onClick={() => setOpen(true)} className={className} />
      <InfoPanel {...info} title={name} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export interface SettingsGroupProps {
  /** The group's label above the card (sentence case). */
  label?: ReactNode;
  /** Content at the right end of the label row (a status chip). */
  aside?: ReactNode;
  /** The (i) at the very end of the label row: what used to be a paragraph under the rows. */
  info?: InfoSpec;
  /** Rows start with a 22 px icon: the dividers then start at the text column. */
  icons?: boolean;
  className?: string;
  children: ReactNode;
}

/** One settings group: label, then the card that holds its rows. */
export function SettingsGroup({ label, aside, info, icons = false, className, children }: SettingsGroupProps) {
  const id = useId();
  const level = useContext(SettingsHeadingLevel);
  return (
    <div className={cx('settings-block', className)} data-enter="" role={label ? 'group' : undefined} aria-labelledby={label ? id : undefined}>
      {label !== undefined || aside !== undefined || info ? (
        <div className="settings-block__head">
          {label !== undefined ? createElement(`h${level}`, { id, className: 'lm-group-label' }, label) : null}
          {aside !== undefined || info ? (
            <div className="settings-block__aside">
              {aside}
              {info ? <SettingInfo title={typeof label === 'string' ? label : 'this section'} info={info} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="settings-group" data-icons={icons || undefined}>
        {children}
      </div>
    </div>
  );
}

/** A free-form row inside a group (a key row, a list, a form): the group's padding and divider, no fixed layout. */
export function SettingsItem({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('settings-item', className)}>{children}</div>;
}

export interface SettingsLinkRowProps {
  to: string;
  icon: IconComponent;
  title: ReactNode;
  /** Current value at the right (a fact: "Metric", "Not paired"). */
  value?: ReactNode;
  /** The section shown beside the index (desktop master/detail): the selected row, no chevron. */
  current?: boolean;
}

/** An index row: icon · title · value · chevron, opening a pushed page (or, beside the detail on desktop, selecting it). */
export function SettingsLinkRow({ to, icon, title, value, current }: SettingsLinkRowProps) {
  return (
    <Link to={to} className="settings-row" aria-current={current === undefined ? undefined : current ? 'page' : undefined}>
      <Icon icon={icon} size={22} className="settings-row__icon" />
      <span className="settings-row__title">{title}</span>
      {value ? <span className="settings-row__value">{value}</span> : null}
      <Icon icon={ChevronRight} size={18} className="settings-row__chev" />
    </Link>
  );
}

/**
 * A row that opens its body in place, inside the same group (a kitchen list, other ways to join sync, licences). Closed
 * by default; the body is not rendered while closed.
 */
export function SettingsDisclosure({
  title,
  value,
  defaultOpen = false,
  open: openProp,
  onToggle,
  children,
}: {
  title: ReactNode;
  value?: ReactNode;
  defaultOpen?: boolean;
  /** Controlled: open state and toggle (one list open at a time). */
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  return (
    <div className="settings-disclosure">
      <button type="button" className="settings-row settings-row--button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle ?? (() => setInner((o) => !o))}>
        <span className="settings-row__title">{title}</span>
        {value ? <span className="settings-row__value">{value}</span> : null}
        <Icon icon={ChevronRight} size={18} className="settings-row__chev" />
      </button>
      {open ? (
        <div id={bodyId} className="settings-disclosure__body">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface SettingRowProps {
  /** Sentence-case label on the left. */
  label: ReactNode;
  /** One short line under the label, only when it adds a fact the label lacks. */
  help?: ReactNode;
  /** The round (i) beside the label, for a row whose effect reaches past itself (quiet mode, reduced motion). */
  info?: InfoSpec;
  /**
   * A control that takes room (a selector, a number field, a select): on phones it drops under the label at full width;
   * from 768 px it fills one fixed control column at the right, so every such control in a section has the same width
   * and right edge. Switches and plain values stay compact at the right.
   */
  wide?: boolean;
  /** Render prop receives the ids to wire aria-labelledby / aria-describedby. */
  children: (ids: { labelId: string; helpId: string | undefined }) => ReactNode;
}

/** A control row: label (+ one line) left, control right (`wide`: see above). */
export function SettingRow({ label, help, info, wide = false, children }: SettingRowProps) {
  const id = useId();
  const labelId = `${id}-l`;
  const helpId = help ? `${id}-h` : undefined;
  const labelNode = (
    <span id={labelId} className="settings-control__label">
      {label}
    </span>
  );
  return (
    <div className="settings-control" data-wide={wide || undefined}>
      <div className="settings-control__text">
        {/* the (i) sits outside the labelled span, so the control's name stays the label's words */}
        {info ? (
          <span className="settings-control__line">
            {labelNode}
            <SettingInfo title={typeof label === 'string' ? label : 'this setting'} info={info} />
          </span>
        ) : (
          labelNode
        )}
        {help ? (
          <span id={helpId} className="settings-control__help">
            {help}
          </span>
        ) : null}
      </div>
      <div className="settings-control__control">{children({ labelId, helpId })}</div>
    </div>
  );
}

export interface SettingsCardProps {
  icon: IconComponent;
  title: string;
  /** The one (i) of the head: the explanation the card does not print. */
  info?: InfoSpec;
  /** The card's glow. Settings is neutral; a card that holds one domain's data (heart zones) may wear it. */
  domain?: Domain;
  /** A `CardFoot` (a state word, a fact, the card's one link). */
  foot?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * A Settings card that holds data (the storage total, the server link, the heart zones, the version): a GradientCard with
 * its head (icon, title, the (i)), its picture and its foot. Neutral by default (no glow: Settings stays monochrome and
 * gold). It sits between the groups of rows with the same material, radius and hairline, so a form and a picture read as
 * one page.
 */
export function SettingsCard({ icon, title, info, domain = 'neutral', foot, className, children }: SettingsCardProps) {
  const level = useContext(SettingsHeadingLevel);
  return (
    <GradientCard as="section" domain={domain} size="hero" className={cx('settings-card', className)} head={<CardHead icon={icon} title={title} info={info} as={level === 2 ? 'h2' : 'h3'} />} foot={foot}>
      {children}
    </GradientCard>
  );
}

/** "Saved" for 1 s after any change that went through (settings-data.md §7). */
export function useSavedFlash(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = () => {
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), 1000);
  };
  return [on, flash];
}

/**
 * The settings page shows "Saved" in its header (status slot); a section reports its flash here. Without a provider (a
 * section rendered on its own) the section shows the label itself.
 */
export const SavedSlotContext = createContext<((on: boolean) => void) | null>(null);

export function useSavedSlot(saved: boolean): boolean {
  const report = useContext(SavedSlotContext);
  useEffect(() => {
    if (!report) return;
    report(saved);
  }, [report, saved]);
  useEffect(() => (report ? () => report(false) : undefined), [report]);
  return report !== null;
}

/** "Saved" with a check, for a second after a change went through; it keeps the bar's gutter (r068 S10). */
export function SavedLabel({ on }: { on: boolean }) {
  return (
    <span className="settings-saved" data-on={on || undefined} aria-live="polite">
      {on ? (
        <>
          <Icon icon={Check} size={16} />
          Saved
        </>
      ) : (
        ''
      )}
    </span>
  );
}
