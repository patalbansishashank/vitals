import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cx } from './lib/cx';
import './overflow.css';

export interface OverflowTextProps {
  /** One complete fact. Keep its number, range and unit together. */
  text: string;
  className?: string;
}

/** A fact that travels only when its full line is wider than the available space. */
export function OverflowText({ text, className }: OverflowTextProps) {
  const viewport = useRef<HTMLSpanElement>(null);
  const item = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [visible, setVisible] = useState(true);
  const [suppressTabStop, setSuppressTabStop] = useState(false);
  const [duration, setDuration] = useState(12);

  useLayoutEffect(() => {
    const view = viewport.current;
    const content = item.current;
    if (!view || !content) return;
    const measure = () => {
      const width = view.clientWidth;
      const contentWidth = content.scrollWidth;
      setOverflow(width > 0 && contentWidth > width + 1);
      setDuration(Math.max(8, (contentWidth + 24) / 36));
    };
    setSuppressTabStop(Boolean(view.parentElement?.closest('a, button, label, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"]), [aria-hidden="true"]')));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    observer.observe(content);
    return () => observer.disconnect();
  }, [text]);

  useLayoutEffect(() => {
    if (!overflow) return;
    const view = viewport.current;
    if (!view) return;
    let inView = true;
    const update = () => setVisible(inView && document.visibilityState !== 'hidden');
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      inView = Boolean(entry?.isIntersecting);
      update();
    });
    observer?.observe(view);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [overflow]);

  return (
    <span
      ref={viewport}
      className={cx('lm-overflow', className)}
      data-overflow={overflow || undefined}
      data-visible={visible}
      tabIndex={overflow && !suppressTabStop ? 0 : undefined}
      aria-label={overflow && !suppressTabStop ? text : undefined}
      style={{ '--lm-overflow-duration': `${duration}s` } as CSSProperties}
    >
      <span className="lm-overflow__track">
        <span ref={item} className="lm-overflow__item">{text}</span>
        {overflow ? <span className="lm-overflow__item lm-overflow__copy" aria-hidden="true">{text}</span> : null}
      </span>
    </span>
  );
}
