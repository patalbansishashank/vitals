/**
 * Answer keys (COMPONENTS §13.1): single-choice keys are a group of buttons with roving focus — arrows move focus only,
 * Space/Enter commits, the chosen key carries aria-pressed (never a radiogroup: radios select on arrow keys, these
 * commit and advance). Multi-select keys are a checkbox group committed with Done.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Key, Stepper, TextInput, cx, useReducedMotion } from '@/components';
import { TURN } from '../copy';
import { isTextEntry, textOf, TEXT_PREFIX, type AnswerOption } from '../flow';

/** Commit delay after a one-tap answer so the pressed state is seen (design: 240 ms). */
export const COMMIT_DELAY_MS = 240;

function useRovingFocus(count: number, columns: number) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focus, setFocus] = useState(0);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const i = refs.current.findIndex((el) => el === document.activeElement);
    if (i < 0) return;
    let next: number;
    if (e.key === 'ArrowRight') next = i + 1;
    else if (e.key === 'ArrowLeft') next = i - 1;
    else if (e.key === 'ArrowDown') next = i + columns;
    else if (e.key === 'ArrowUp') next = i - columns;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    else return;
    e.preventDefault();
    next = Math.max(0, Math.min(count - 1, next));
    setFocus(next);
    refs.current[next]?.focus();
  };
  return { refs, focus, setFocus, onKeyDown };
}

/** The accessible name: label, examples ("— for example …") and the default tag. */
export const keyName = (o: AnswerOption, isDefault: boolean): string =>
  `${o.label}${o.examples ? ` — for example ${o.examples}` : ''}${isDefault ? ` (${TURN.defaultTag})` : ''}`;

export interface AnswerKeysProps {
  options: ReadonlyArray<AnswerOption>;
  value?: string;
  /** The option the skip default corresponds to (tagged "default"; never preselected). */
  defaultValue?: string;
  onCommit: (value: string) => void;
  /** Cards with examples: one per row on mobile, 72 px tall. */
  cards?: boolean;
  labelledBy?: string;
  /** Group name when there is no visible label. */
  label?: string;
  className?: string;
}

export function AnswerKeys({ options, value, defaultValue, onCommit, cards, labelledBy, label, className }: AnswerKeysProps) {
  const initial = Math.max(0, options.findIndex((o) => o.value === value));
  const { refs, focus, setFocus, onKeyDown } = useRovingFocus(options.length, cards ? 1 : 2);
  const [chosen, setChosen] = useState<string | undefined>(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => setFocus(initial), [initial, setFocus]);

  const choose = (v: string) => {
    setChosen(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(v), reduced ? 0 : COMMIT_DELAY_MS);
  };

  return (
    <div role="group" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} className={cx('lm-ik-keys', cards && 'lm-ik-keys--cards', className)} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          className="lm-ik-key"
          data-cards={cards || undefined}
          aria-pressed={chosen === o.value}
          aria-label={keyName(o, defaultValue === o.value)}
          tabIndex={i === focus ? 0 : -1}
          onFocus={() => setFocus(i)}
          onClick={() => choose(o.value)}
        >
          <span className="lm-ik-key__label">{o.label}</span>
          {o.examples ? <span className="lm-ik-key__examples">{o.examples}</span> : null}
          {defaultValue === o.value ? <span className="lm-ik-key__default">{TURN.defaultTag}</span> : null}
        </button>
      ))}
    </div>
  );
}

export interface MultiChipsProps {
  options: ReadonlyArray<AnswerOption>;
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Tap order is the rank (shown as a small numeral). */
  ranked?: boolean;
  labelledBy?: string;
  label?: string;
  className?: string;
}

/** A checkbox group of answer chips (44 px). Exclusive options ("none") clear the others and are cleared by them. */
export function MultiChips({ options, value, onChange, ranked, labelledBy, label, className }: MultiChipsProps) {
  const { refs, focus, setFocus, onKeyDown } = useRovingFocus(options.length, 2);
  const toggle = (o: AnswerOption) => {
    const on = value.includes(o.value);
    if (on) return onChange(value.filter((v) => v !== o.value));
    if (o.exclusive) return onChange([o.value]);
    const exclusive = new Set(options.filter((x) => x.exclusive).map((x) => x.value));
    onChange([...value.filter((v) => !exclusive.has(v)), o.value]);
  };
  return (
    <div role="group" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} className={cx('lm-ik-chips', className)} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = value.includes(o.value);
        const rank = ranked && on ? value.filter((v) => !isTextEntry(v)).indexOf(o.value) + 1 : 0;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="checkbox"
            aria-checked={on}
            className="lm-ik-chip"
            tabIndex={i === focus ? 0 : -1}
            onFocus={() => setFocus(i)}
            onClick={() => toggle(o)}
            onKeyDown={(e) => {
              // Enter = Done (the turn's fieldset handles it); Space toggles
              if (e.key === 'Enter') e.preventDefault();
            }}
          >
            {rank ? (
              <span className="lm-ik-chip__rank" aria-hidden="true">
                {rank}
              </span>
            ) : (
              <span className="lm-ik-chip__box" aria-hidden="true" />
            )}
            <span>{o.label}</span>
            {o.examples ? <span className="lm-ik-chip__examples">{o.examples}</span> : null}
            {rank ? <span className="lm-sr">{`, ranked ${rank}`}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Free-text entries of a multi answer ("other allergy", "something else"), kept as typed. */
export function OtherEntries({ value, onChange, label, placeholder }: { value: readonly string[]; onChange: (value: string[]) => void; label: string; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const texts = value.filter(isTextEntry);
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...value.filter((v) => v !== 'none'), `${TEXT_PREFIX}${t}`]);
    setDraft('');
  };
  return (
    <div className="lm-ik-other">
      <div className="lm-ik-other__row">
        <TextInput
          aria-label={label}
          placeholder={placeholder ?? TURN.otherPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              add();
            }
          }}
        />
        <Key size="sm" onClick={add} disabledReason={draft.trim() ? undefined : label}>
          {TURN.add}
        </Key>
      </div>
      {texts.length ? (
        <ul className="lm-ik-other__list">
          {texts.map((t) => (
            <li key={t}>
              <span>{textOf(t)}</span>
              <Key size="sm" variant="quiet" aria-label={TURN.remove(textOf(t))} onClick={() => onChange(value.filter((v) => v !== t))}>
                ×
              </Key>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface NumberAnswerProps {
  value?: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  name: string;
  presets: readonly number[];
  presetLabel?: (n: number) => string;
  defaultValue?: number;
  onCommit: (n: number) => void;
  labelledBy?: string;
}

/** Stepper with a row of preset keys; a preset tap commits, the exact number commits with Done. */
export function NumberAnswer({ value, min, max, step, unit, name, presets, presetLabel, defaultValue, onCommit, labelledBy }: NumberAnswerProps) {
  const [n, setN] = useState<number | null>(value ?? null);
  return (
    <div className="lm-ik-number">
      <AnswerKeys
        labelledBy={labelledBy}
        options={presets.map((p) => ({ value: String(p), label: presetLabel ? presetLabel(p) : `${p}` }))}
        value={value !== undefined && presets.includes(value) ? String(value) : undefined}
        defaultValue={defaultValue !== undefined ? String(defaultValue) : undefined}
        onCommit={(v) => onCommit(Number(v))}
        className="lm-ik-keys--presets"
      />
      <div className="lm-ik-number__exact">
        <Stepper name={name} value={n} onChange={setN} min={min} max={max} step={step} unit={unit} inputMode="numeric" />
        <Key size="md" onClick={() => n !== null && onCommit(n)} disabledReason={n === null ? TURN.exact : undefined}>
          {TURN.done}
        </Key>
      </div>
    </div>
  );
}

export function TurnActions({ children }: { children: ReactNode }) {
  return <div className="lm-ik-actions">{children}</div>;
}
