import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { TableOfContents } from 'lucide-react';
import { GradeBadge, IconKey, Sheet, cx } from '@/components';
import type { EvidenceGrade, EvidenceTopic } from '@/content/evidence/schema';
import { mechanismHref, topicHref, type EvidenceNavState } from '../links';

export interface PageSection {
  id: string;
  /** Lowercase engraved label ("key numbers"). */
  label: string;
}

const NAV_STATE: EvidenceNavState = { from: 'evidence' };

const isDesktop = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 64rem)').matches;

/** Scroll a section into view and put focus on its heading (no smooth scroll when motion is reduced). */
export function jumpToSection(id: string, reduced: boolean): void {
  const el = document.getElementById(id);
  if (!el) return;
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
 * bars. IntersectionObserver triggers the measurement; the page end selects the last.
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
      const line = pad + (isDesktop() ? 0 : 48) + 40;
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

/** Desktop "on this page": a vertical key bank with the yellow light on the section in view. */
export function OnThisPage({
  sections,
  active,
  onJump,
  hint = true,
}: {
  sections: readonly PageSection[];
  active: string | null;
  onJump: (id: string) => void;
  hint?: boolean;
}) {
  return (
    <nav aria-label="On this page" className="ev-onpage">
      <p className="lm-eng ev-sidehead">on this page</p>
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
      {hint ? (
        <p className="ev-onpage__hint lm-eng">
          <kbd>j</kbd> <kbd>k</kbd> next and previous section
        </p>
      ) : null}
    </nav>
  );
}

/**
 * Mobile sticky mini-header: slides in under the top bar once the article title
 * has scrolled away — title, grade and a contents key (sheet).
 */
export function MiniHeader({
  title,
  grade,
  sections,
  active,
  onJump,
  watch,
}: {
  title: string;
  grade?: EvidenceGrade;
  sections: readonly PageSection[];
  active: string | null;
  onJump: (id: string) => void;
  watch: RefObject<HTMLElement | null>;
}) {
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = watch.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry) setShown(!entry.isIntersecting && entry.boundingClientRect.top < 120);
      },
      { rootMargin: '-112px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [watch]);
  return (
    <>
      <div className="ev-mini" data-shown={shown || undefined} aria-hidden={shown ? undefined : true}>
        <span className="ev-mini__title" aria-hidden="true">
          {title}
        </span>
        {grade ? <GradeBadge grade={grade} size="sm" tooltip={false} /> : null}
        <IconKey icon={TableOfContents} label="Contents" onClick={() => setOpen(true)} />
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="On this page" detents={['half', 'full']}>
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
                    // the closing sheet hands focus back to its key when it unmounts (320 ms): take it to the section after that
                    window.setTimeout(() => focusSection(s.id), 400);
                  }}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </Sheet>
    </>
  );
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
      <p className="lm-eng ev-sidehead">topic</p>
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
      <p className="lm-eng ev-sidehead">topics</p>
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

/** Three-column reading grid: side (240) · main (≤ 720) · aside (220, ≥ 1280). */
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
