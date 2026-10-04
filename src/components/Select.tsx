import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from './lib/cx';
import { MQ, useMediaQuery } from './lib/hooks';
import { Icon } from './icons/Icon';
import { Popover } from './Popover';
import { useField } from './Field';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  value: V | undefined;
  onChange: (value: V) => void;
  options: ReadonlyArray<SelectOption<V>>;
  /** Accessible name when not inside a Field. */
  label?: string;
  placeholder?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  invalid?: boolean;
  /**
   * `auto` (default): native <select> on touch or narrow screens, the popover
   * list on desktop pointers (COMPONENTS §2). Force with true/false.
   */
  native?: boolean | 'auto';
  id?: string;
  className?: string;
}

/**
 * Well field with a trailing chevron. Desktop opens a popover listbox (selected
 * option shows a check); mobile uses the native picker. More than 6 choices —
 * fewer belong in a KeyBank.
 */
export function Select<V extends string = string>(props: SelectProps<V>) {
  const wide = useMediaQuery(MQ.md);
  const fine = useMediaQuery(MQ.finePointer);
  const useNative = props.native === 'auto' || props.native === undefined ? !(wide && fine) : props.native;
  return useNative ? <NativeSelect {...props} /> : <ListboxSelect {...props} />;
}

function NativeSelect<V extends string>({ value, onChange, options, label, placeholder, size = 'md', disabled, invalid, id, className }: SelectProps<V>) {
  const field = useField();
  return (
    <span className={cx('lm-select-native', className)}>
      <select
        id={id ?? field?.id}
        className="lm-select"
        data-size={size}
        value={value ?? ''}
        disabled={disabled ?? field?.disabled}
        aria-label={field ? undefined : label}
        aria-invalid={invalid || field?.invalid || undefined}
        aria-describedby={field?.describedBy}
        onChange={(e) => onChange(e.target.value as V)}
      >
        {value === undefined ? (
          <option value="" disabled>
            {placeholder ?? 'Choose…'}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon icon={ChevronDown} size={16} className="lm-select__chev" />
    </span>
  );
}

function ListboxSelect<V extends string>({ value, onChange, options, label, placeholder, size = 'md', disabled, invalid, id, className }: SelectProps<V>) {
  const field = useField();
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number>(-1);
  const typed = useRef({ text: '', at: 0 });
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];
  const isDisabled = disabled ?? field?.disabled ?? false;

  const enabledIdx = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const step = (from: number, dir: 1 | -1) => {
    if (enabledIdx.length === 0) return from;
    const pos = enabledIdx.indexOf(from);
    if (pos === -1) return dir > 0 ? enabledIdx[0]! : enabledIdx[enabledIdx.length - 1]!;
    return enabledIdx[Math.min(enabledIdx.length - 1, Math.max(0, pos + dir))]!;
  };

  const openList = () => {
    if (isDisabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : (enabledIdx[0] ?? -1));
    setOpen(true);
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const typeahead = (key: string) => {
    const now = performance.now();
    typed.current.text = now - typed.current.at > 700 ? key : typed.current.text + key;
    typed.current.at = now;
    const q = typed.current.text.toLowerCase();
    const from = open ? active : selectedIndex;
    for (let k = 1; k <= options.length; k++) {
      const i = (from + k + options.length) % options.length;
      const o = options[i];
      if (o && !o.disabled && o.label.toLowerCase().startsWith(q)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (isDisabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        const i = typeahead(e.key);
        const o = options[i];
        if (o) onChange(o.value);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => step(a, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => step(a, -1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(enabledIdx[0] ?? -1);
        break;
      case 'End':
        e.preventDefault();
        setActive(enabledIdx[enabledIdx.length - 1] ?? -1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(active);
        break;
      case 'Tab':
        if (active >= 0) choose(active);
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const i = typeahead(e.key);
          if (i >= 0) setActive(i);
        }
    }
  };

  const optId = (i: number) => `${listId}-o${i}`;

  return (
    <>
      <button
        ref={buttonRef}
        id={id ?? field?.id}
        type="button"
        role="combobox"
        className={cx('lm-select', className)}
        data-size={size}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-label={field ? undefined : label}
        aria-labelledby={field ? `${field.labelId} ${id ?? field.id}` : undefined}
        aria-describedby={field?.describedBy}
        aria-invalid={invalid || field?.invalid || undefined}
        aria-disabled={isDisabled || undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="lm-select__value" data-placeholder={!selected || undefined}>
          {selected ? selected.label : (placeholder ?? 'Choose…')}
        </span>
        <Icon icon={ChevronDown} size={16} className="lm-select__chev" />
      </button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={buttonRef} role="listbox" id={listId} label={label} matchWidth offset={4} autoFocus={false}>
        <div className="lm-listbox" role="presentation">
          {options.map((o, i) => (
            <div
              key={o.value}
              id={optId(i)}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              className="lm-listbox__opt"
              data-active={i === active || undefined}
              onPointerEnter={() => !o.disabled && setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span className="lm-listbox__check">{o.value === value ? <Icon icon={Check} size={16} /> : null}</span>
              <span>{o.label}</span>
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}
