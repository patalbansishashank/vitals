import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Search, X } from 'lucide-react';
import { Icon, IconKey, TextInput } from '@/components';

export interface SearchFieldProps {
  /** Committed query (from the URL). */
  value: string;
  /** Called 150 ms after typing stops, and at once on Enter / Escape / clear. */
  onCommit: (query: string) => void;
  /** `bar` = desktop context bar, `page` = in the mobile index. */
  where: 'bar' | 'page';
  inputRef?: RefObject<HTMLInputElement | null>;
  /** ↓ from the field: move into the results. */
  onArrowDown?: () => void;
  debounceMs?: number;
}

/** The library search well: icon, debounced input, clear key, "/" hint. */
export function SearchField({
  value,
  onCommit,
  where,
  inputRef,
  onArrowDown,
  debounceMs = 150,
}: SearchFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fallbackRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? fallbackRef;

  // The URL changed from outside (back/forward, a link): show it.
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  const schedule = (next: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(next), debounceMs);
  };
  const commitNow = (next: string) => {
    clearTimeout(timer.current);
    if (next !== value) onCommit(next);
  };

  return (
    <div className="ev-search" data-where={where} role="search">
      <label htmlFor={id} className="lm-sr">
        Search mechanisms, claims and metrics
      </label>
      <Icon icon={Search} size={18} className="ev-search__icon" />
      <TextInput
        ref={ref}
        id={id}
        type="search"
        className="ev-search__input"
        value={text}
        placeholder="search mechanisms or metrics"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        aria-keyshortcuts="/"
        aria-describedby={where === 'bar' && !text ? hintId : undefined}
        onChange={(e) => {
          setText(e.target.value);
          schedule(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text) {
            e.preventDefault();
            e.stopPropagation();
            setText('');
            commitNow('');
          } else if (e.key === 'Enter') {
            e.preventDefault();
            commitNow(text);
          } else if (e.key === 'ArrowDown' && onArrowDown) {
            e.preventDefault();
            commitNow(text);
            onArrowDown();
          }
        }}
      />
      {text ? (
        <IconKey
          size="sm"
          icon={X}
          label="Clear search"
          className="ev-search__clear"
          onClick={() => {
            setText('');
            commitNow('');
            ref.current?.focus();
          }}
        />
      ) : where === 'bar' ? (
        <kbd className="ev-search__kbd" id={hintId} aria-label="Press slash to search">
          /
        </kbd>
      ) : null}
    </div>
  );
}
