import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { Page, ScrollRail } from '@/components';
import { TopBar } from '@/app/shell';
import { AboutSection, AppearanceSection, SafetySection, SECTIONS, UnitsSection, type SectionId } from './sections';
import { DevicesSection } from './devices/DevicesSection';
import { DataSection } from './DataSection';
import { InstallSection } from '@/app/pwa/InstallSection';
import { SyncSection } from './sync/SyncSection';
import { ServerSection } from './server/ServerSection';
import { AgentsSection } from './agents/AgentsSection';
import { ConnectTools } from './agents/ConnectTools';
import { platform } from '@/platform';
import { AiSection } from './ai/AiSection';
import { SupplementsSection } from './supplements/SupplementsSection';
import { KitchenSection } from './KitchenSection';
import './settings.css';

/** `/settings/:section` deep links (SUITE_SPEC §6.2), with the design's aliases (`data-sources` → devices). */
const SECTION_ALIASES: Readonly<Record<string, SectionId>> = { ai: 'coach', 'data-sources': 'devices' };

function sectionFromPath(section: string | undefined): SectionId | null {
  if (!section) return null;
  const id = SECTION_ALIASES[section] ?? section;
  return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : null;
}

/** Which section is in view (scroll-spy for the index / anchor chips): the last one whose top passed the sticky bars. */
function useSectionInView(): SectionId {
  const [active, setActive] = useState<SectionId>('units');
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.matchMedia?.('(min-width: 64rem)').matches ? 110 : 150;
      let current: SectionId = SECTIONS[0]!.id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) current = s.id;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(atEnd ? SECTIONS[SECTIONS.length - 1]!.id : current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return active;
}

/**
 * Settings & data (design/screens/settings-data.md): units, appearance, the
 * local data (export / import / reset), safety and about. Every control applies
 * instantly; a "saved" label flashes in the section header.
 */
export default function SettingsPage() {
  const active = useSectionInView();
  const { hash, search } = useLocation();
  const { section } = useParams();
  const query = new URLSearchParams(search).get('section');
  // a pairing link (`?section=server#vitals-server:1?…`) carries its code in the fragment: the section is the target
  const target = hash && !hash.startsWith('#vitals-server') ? hash.slice(1) : sectionFromPath(section ?? query ?? undefined);

  useEffect(() => {
    if (!target) return;
    const go = () => document.getElementById(target)?.scrollIntoView({ block: 'start' });
    go();
    // Sections above the target finish loading after the jump (kitchen pickers, supplements, devices) and move it by
    // up to thousands of pixels (Q6: /settings/agents left Agents 4 750 px below the screen). Re-align on every size
    // change of the section column until the layout settles (3 s) or the person scrolls, taps or types.
    let done = false;
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    const column = document.getElementById(target)?.parentElement;
    const ro = typeof ResizeObserver === 'undefined' || !column ? null : new ResizeObserver(() => !done && go());
    const stop = () => {
      done = true;
      ro?.disconnect();
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, stop);
    };
    if (column) ro?.observe(column);
    for (const e of events) window.addEventListener(e, stop, { passive: true });
    const timer = window.setTimeout(stop, 3000);
    // and once web fonts have settled the layout above the target
    void document.fonts?.ready.then(() => !done && window.requestAnimationFrame(go));
    return stop;
  }, [target]);

  // mobile: keep the lit chip inside the chip rail (Q6: on /settings/ai the rail still showed units … your data)
  const chips = useRef<HTMLElement>(null);
  useEffect(() => {
    const chip = chips.current?.querySelector<HTMLElement>(`a[href="#${active}"]`);
    const rail = chip?.parentElement;
    if (!chip || !rail || rail.scrollWidth <= rail.clientWidth) return;
    const c = chip.getBoundingClientRect();
    const r = rail.getBoundingClientRect();
    if (c.left >= r.left && c.right <= r.right) return;
    rail.scrollTo({ left: rail.scrollLeft + c.left - r.left - 16 });
  }, [active]);

  return (
    <>
      <TopBar title="Settings" back={{ mobileOnly: true }} compactOnMobile />
      {/* mobile: anchor chips, sticky under the top bar */}
      <nav
        ref={chips}
        aria-label="Settings sections"
        className="sticky z-[var(--lm-z-lane-label)] border-b border-line bg-chassis py-2 lg:hidden"
        style={{ top: 'calc(var(--lm-topbar-h) + var(--lm-safe-top))' }}
      >
        <ScrollRail gap={6} bleed={false} padding={16} className="!py-0">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="lm-chip"
              data-kind="filter"
              aria-current={active === s.id ? 'true' : undefined}
              style={{ minWidth: 44, height: 44, paddingInline: 12 }}
            >
              {s.label}
            </a>
          ))}
        </ScrollRail>
      </nav>
      <Page className="settings-page">
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
          {/* desktop: vertical key bank with the yellow light on the section in view */}
          <nav aria-label="Settings sections" className="hidden lg:block">
            <div className="sticky" style={{ top: 'calc(var(--lm-topbar-h) + 20px)' }}>
              <p className="lm-eng mb-2 mt-0">sections</p>
              <div className="lm-bank" data-orientation="vertical" data-block="true">
                {SECTIONS.map((s) => (
                  <a key={s.id} href={`#${s.id}`} className="lm-bank__key" aria-current={active === s.id ? 'true' : undefined}>
                    {s.label}
                  </a>
                ))}
              </div>
            </div>
          </nav>
          <div className="grid min-w-0 gap-4">
            <UnitsSection />
            <AppearanceSection />
            <KitchenSection />
            <SupplementsSection />
            <DataSection />
            <ServerSection />
            <SyncSection />
            <DevicesSection />
            <AiSection />
            <AgentsSection />
            {platform() === 'electron' ? <ConnectTools /> : null}
            <InstallSection />
            <SafetySection />
            <AboutSection />
          </div>
        </div>
      </Page>
    </>
  );
}
