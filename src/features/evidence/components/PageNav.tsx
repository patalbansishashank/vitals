import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { ResponsivePanel, cx, type MenuItem } from '@/components';
import type { EvidenceTopic } from '@/content/evidence/schema';
import { mechanismHref, topicHref, type EvidenceNavState } from '../links';

export interface PageSection {
  id: string;
  /** The section's name as its heading says it ("Key numbers"). */
  label: string;
}

const NAV_STATE: EvidenceNavState = { from: 'evidence' };

/** Open every closed <details> that is, or holds, `el` (the sources and technical details start closed). */
export function revealInDetails(el: Element | null): void {
  if (!el) return;
  if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  let d = el.parentElement?.closest('details') ?? null;
  while (d) {
    if (!d.open) d.open = true;
    d = d.parentElement?.closest('details') ?? null;
  }
}

/** Scroll a section into view and put focus on its heading (no smooth scroll when motion is reduced). */
export function jumpToSection(id: string, reduced: boolean): void {
  const el = document.getElementById(id);
  if (!el) return;
  revealInDetails(el);
  el.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  focusSection(id);
  try {
    window.history.replaceState(window.history.state, '', `#${id}`);
  } catch {
    /* sandboxed */
  }
}

/** Put focus on a section's heading without scrolling (screen readers continue from there). */
export function focusSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const target = el.matches('h1,h2,h3,h4') ? el : (el.querySelector<HTMLElement>('h2,h3,h4') ?? el);
  if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

/**
 * Which section the reader is in: the last one whose top has passed the sticky
 * header. IntersectionObserver triggers the measurement; the page end selects the last.
 */
export function useActiveSection(ids: readonly string[], enabled = true): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');
  useEffect(() => {
    if (!enabled) return;
    const list = key ? key.split('|') : [];
    if (!list.length) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      const line = pad + 40;
      let current: string | null = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(atEnd && window.scrollY > 0 ? (list[list.length - 1] ?? null) : current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    schedule();
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(schedule, { rootMargin: '-96px 0px -55% 0px', threshold: [0, 1] })
        : null;
    for (const id of list) {
      const el = document.getElementById(id);
      if (el) io?.observe(el);
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      io?.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key, enabled]);
  return active;
}

/**
 * Whether the page's own title (the article's h2) has scrolled up under the header. The header shows the title only
 * then (as a large title collapses into the bar), so the two never sit on screen together.
 */
export function useTitleScrolledAway(watch: RefObject<HTMLElement | null>, key: unknown): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = watch.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lm-header-h')) || 64;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry) setAway(!entry.isIntersecting && entry.boundingClientRect.top < header);
      },
      { rootMargin: `-${Math.round(header)}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [watch, key]);
  return away;
}

/** Desktop (≥ 1280 px) "On this page": the article's sections as a vertical bank; the one in view is selected. */
export function OnThisPage({
  sections,
  active,
  onJump,
}: {
  sections: readonly PageSection[];
  active: string | null;
  onJump: (id: string) => void;
}) {
  return (
    <nav aria-label="On this page" className="ev-onpage">
      <p className="ev-sidehead" aria-hidden="true">
        On this page
      </p>
      <div className="lm-bank" data-orientation="vertical" data-block="true">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="lm-bank__key"
            aria-current={active === s.id ? 'true' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onJump(s.id);
            }}
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

/**
 * "On this page" below 1280 px: a header ⋯ item that opens the sections in a sheet (side panel from 1024 px). Jumping
 * closes it, then scrolls and moves focus to the section once the panel has handed focus back.
 */
export function useContents(
  sections: readonly PageSection[],
  active: string | null,
  onJump: (id: string) => void,
): { menuItem: MenuItem; panel: ReactElement } {
  const [open, setOpen] = useState(false);
  const menuItem = useMemo<MenuItem>(() => ({ id: 'ev-contents', label: 'On this page', onSelect: () => setOpen(true) }), []);
  const panel = (
    <ResponsivePanel scrim open={open} onClose={() => setOpen(false)} title="On this page" detents={['half', 'full']}>
      <nav aria-label="On this page">
        <ul className="ev-sheetnav">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-current={active === s.id ? 'true' : undefined}
                onClick={() => {
                  setOpen(false);
                  window.requestAnimationFrame(() => window.requestAnimationFrame(() => onJump(s.id)));
                  // the closing panel hands focus back to its trigger when it unmounts (320 ms): take it to the section after that
                  window.setTimeout(() => focusSection(s.id), 400);
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </ResponsivePanel>
  );
  return { menuItem, panel };
}

/** Scroll the sticky side column (not the page) so its current item is in view. */
function useCurrentInView(ref: RefObject<HTMLElement | null>, current: string | undefined): void {
  useEffect(() => {
    const nav = ref.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    const box = nav?.closest<HTMLElement>('.ev-sticky');
    if (!el || !box) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top > box.clientHeight * 0.6) box.scrollTop = top - box.clientHeight / 3;
  }, [ref, current]);
}

/** Left column on an article: the other mechanisms of its topic. */
export function TopicNav({ topic, currentId }: { topic: EvidenceTopic; currentId: string }) {
  const ref = useRef<HTMLElement>(null);
  useCurrentInView(ref, currentId);
  return (
    <nav ref={ref} aria-label={`Topic: ${topic.title}`} className="ev-sidenav">
      <p className="ev-sidehead">Topic</p>
      <Link to={topicHref(topic.slug)} state={NAV_STATE} className="ev-sidenav__topic">
        {topic.title}
      </Link>
      <ol className="ev-toc">
        {topic.mechanisms.map((m) => (
          <li key={m.id}>
            <Link
              to={mechanismHref(m.id)}
              state={NAV_STATE}
              aria-current={m.id === currentId ? 'page' : undefined}
            >
              {m.title}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Left column on a topic page: every topic. */
export function AllTopicsNav({
  entries,
  currentSlug,
}: {
  entries: ReadonlyArray<{ slug: string; title: string }>;
  currentSlug?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useCurrentInView(ref, currentSlug);
  return (
    <nav ref={ref} aria-label="Topics" className="ev-sidenav">
      <p className="ev-sidehead">Topics</p>
      <ol className="ev-toc">
        {entries.map((e) => (
          <li key={e.slug}>
            <Link
              to={topicHref(e.slug)}
              state={NAV_STATE}
              aria-current={e.slug === currentSlug ? 'page' : undefined}
            >
              {e.title}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Three-column reading grid: side (240, ≥ 1024) · main · aside (220, ≥ 1280). */
export function EvidenceLayout({
  side,
  aside,
  asideLabel,
  children,
  className,
}: {
  side?: ReactNode;
  aside?: ReactNode;
  asideLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx('ev-layout', className)}
      data-side={side ? 'true' : undefined}
      data-aside={aside ? 'true' : undefined}
    >
      {side ? (
        <div className="ev-col ev-col--side">
          <div className="ev-sticky">{side}</div>
        </div>
      ) : null}
      <div className="ev-col ev-col--main">{children}</div>
      {aside ? (
        <aside className="ev-col ev-col--aside" aria-label={asideLabel}>
          <div className="ev-sticky">{aside}</div>
        </aside>
      ) : null}
    </div>
  );
}
