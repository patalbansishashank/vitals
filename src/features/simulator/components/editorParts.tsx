/**
 * Small building blocks of the day editor: collapsible sections (open state remembered for the session), numeric
 * rows that show the engine default until touched (with a reset), a clock-time field, a switch row.
 */
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { Icon, IconKey, Stepper, StatusMark, Switch, cx, formatNumber, type Severity } from '@/components';
import { formatClock } from '../lib/calendar';

const openSections = new Map<string, boolean>();

export function EditorSection({
  id,
  title,
  aside,
  children,
  defaultOpen = true,
  severity,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** A caution/danger mark in the header when something inside needs attention. */
  severity?: Severity | null;
}) {
  const [open, setOpen] = useState(() => openSections.get(id) ?? defaultOpen);
  const bodyId = useId();
  return (
    <section className="sim-sec" data-open={open || undefined}>
      <div className="sim-sec__head">
        <button
          type="button"
          className="sim-sec__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            openSections.set(id, !open);
            setOpen(!open);
          }}
        >
          <Icon icon={ChevronDown} size={16} className="sim-sec__chev" />
          <h3 className="sim-sec__title">{title}</h3>
          {severity && severity !== 'info' ? (
            <StatusMark severity={severity} size={16} label={severity} />
          ) : null}
        </button>
        {aside ? <div className="sim-sec__aside">{aside}</div> : null}
      </div>
      {open ? (
        <div className="sim-sec__body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** A numeric input that reads "default" until the user sets it (engine defaults are shown, never hidden). */
export function DefaultedNumber({
  label,
  value,
  def,
  onChange,
  min,
  max,
  step = 1,
  decimals,
  unit,
  defNote,
}: {
  label: string;
  value: number | undefined;
  def: number;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  unit?: string;
  /** Replaces "default …" text (e.g. "thirst-driven"). */
  defNote?: string;
}) {
  const id = useId();
  const set = value !== undefined;
  return (
    <div className="sim-row" data-set={set || undefined}>
      <label className="sim-row__label" htmlFor={id}>
        {label}
        <span className="sim-row__def">
          {set
            ? `default ${formatNumber(def, decimals ?? 0)}${unit ? ` ${unit}` : ''}`
            : (defNote ?? 'default')}
        </span>
      </label>
      <div className="sim-row__ctl">
        <Stepper
          id={id}
          name={label}
          value={value ?? def}
          onChange={(v) => onChange(v)}
          min={min}
          max={max}
          step={step}
          decimals={decimals}
          unit={unit}
        />
        {set ? (
          <IconKey
            size="sm"
            variant="quiet"
            icon={RotateCcw}
            label={`Reset ${label} to default`}
            onClick={() => onChange(undefined)}
          />
        ) : (
          <span className="sim-row__spacer" />
        )}
      </div>
    </div>
  );
}

/** Clock time as a native time input (15-min steps), value in hours. */
export function TimeField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: number;
  onChange: (h: number) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx('sim-time', className)}>
      <label htmlFor={id} className="lm-eng">
        {label}
      </label>
      <input
        id={id}
        type="time"
        step={300}
        className="sim-time__input"
        value={formatClock(value)}
        onChange={(e) => {
          const [h, m] = e.currentTarget.value.split(':').map(Number);
          if (Number.isFinite(h) && Number.isFinite(m)) onChange(h! + m! / 60);
        }}
      />
    </div>
  );
}

export function SwitchRow({
  label,
  checked,
  onChange,
  note,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  note?: string;
}) {
  return (
    <div className="sim-switchrow">
      <Switch checked={checked} onChange={onChange} label={label} labelStyle="sentence" />
      {note ? <span className="sim-row__def">{note}</span> : null}
    </div>
  );
}
