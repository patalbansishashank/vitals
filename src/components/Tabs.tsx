import { Children, Fragment, createContext, isValidElement, useContext, useId, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './lib/cx';
import { useControllableState } from './lib/hooks';
import { bankSegments, useSelectedInView, type BankSize } from './KeyBank';

interface TabsCtx {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}
const Ctx = createContext<TabsCtx | null>(null);

function useTabs(): TabsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('Tab components must be inside <Tabs>');
  return c;
}

const safe = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '_');

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  children: ReactNode;
}

/**
 * In-page tabs (e.g. plan detail: overview · days · curves · safety). The tab
 * list is drawn as the segmented track, full width; arrows move and activate, Home/End jump.
 * For route sub-navigation use `LinkBank` instead.
 */
export function Tabs({ value, defaultValue = '', onChange, children }: TabsProps) {
  const [v, setV] = useControllableState(value, defaultValue, onChange);
  const baseId = useId();
  return <Ctx.Provider value={{ value: v, setValue: setV, baseId }}>{children}</Ctx.Provider>;
}

/** The number of tabs (fragments are looked into), for the equal-width segment track. */
function countTabs(children: ReactNode): number {
  let n = 0;
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    n += c.type === Fragment ? countTabs((c.props as { children?: ReactNode }).children) : 1;
  });
  return n;
}

export interface TabListProps {
  label: string;
  size?: BankSize;
  /** Fill the width it is given (default true; r068 U2). */
  block?: boolean;
  /** Size the track to its labels instead (the same as `block={false}`). */
  fit?: boolean;
  className?: string;
  children: ReactNode;
}

export function TabList({ label, size = 'md', block = true, fit = false, className, children }: TabListProps) {
  const fill = block && !fit;
  const track = useSelectedInView<HTMLDivElement>(useContext(Ctx)?.value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([aria-disabled="true"])'));
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || tabs.length === 0) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <div ref={track} role="tablist" aria-label={label} className={cx('lm-bank', className)} data-size={size} data-block={fill || undefined} onKeyDown={onKeyDown} {...bankSegments(countTabs(children))}>
      {children}
    </div>
  );
}

export interface TabProps {
  value: string;
  disabled?: boolean;
  badge?: boolean;
  children: ReactNode;
}

export function Tab({ value, disabled, badge, children }: TabProps) {
  const { value: current, setValue, baseId } = useTabs();
  const selected = current === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${safe(value)}`}
      aria-controls={selected ? `${baseId}-panel-${safe(value)}` : undefined}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      tabIndex={selected ? 0 : -1}
      className="lm-bank__key"
      data-selected={selected}
      onClick={() => {
        if (!disabled) setValue(value);
      }}
    >
      <span>{children}</span>
      {badge ? <span className="lm-bank__badge" aria-hidden="true" /> : null}
    </button>
  );
}

export interface TabPanelProps {
  value: string;
  className?: string;
  children: ReactNode;
  /** Keep the panel mounted (hidden) when inactive. Default false. */
  keepMounted?: boolean;
}

export function TabPanel({ value, className, children, keepMounted = false }: TabPanelProps) {
  const { value: current, baseId } = useTabs();
  const selected = current === value;
  if (!selected && !keepMounted) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${safe(value)}`}
      aria-labelledby={`${baseId}-tab-${safe(value)}`}
      hidden={!selected}
      tabIndex={0}
      className={cx('lm-tabpanel', className)}
    >
      {children}
    </div>
  );
}
