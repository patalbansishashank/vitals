/**
 * Progress (`/progress`; living-mode.md §8): one scrolling page of faceplates — trend · goals · adherence · body · body
 * signals · log · check-ins · plan — with an anchor-chip rail on mobile and a sticky section index on desktop. Without a
 * plan only Body, Body signals and Log show (IA §2.1). Quiet mode (or the page's "show numbers") switches the
 * restriction-adjacent numbers to words.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Engraved, Key, KeyBank, Page, ScrollRail } from '@/components';
import { TopBar } from '@/app/shell';
import { useToday } from '../clock';
import { useLiving } from '../data/source';
import { useAppMode } from '../mode';
import { PROGRESS_COPY as C } from './copy';
import { TREND_RANGES, type TrendRange } from './model';
import { AdherenceSection } from './sections/AdherenceSection';
import { BodySection } from './sections/BodySection';
import { CheckInsSection } from './sections/CheckInsSection';
import { GoalsSection } from './sections/GoalsSection';
import { LogSection } from './sections/LogSection';
import { PlanSection } from './sections/PlanSection';
import { SignalsSection } from './sections/SignalsSection';
import { BodySignalsLink } from './ring/BodySignalsLink';
import { TrendSection } from './sections/TrendSection';
import { MarkerTrendsSection } from '@/markers/ui/MarkerTrends'; // E20: markers

export type ProgressSectionId = keyof typeof C.sections;
// E20: markers — the "blood markers" section sits after body signals
const WITH_PLAN: readonly ProgressSectionId[] = ['trend', 'goals', 'adherence', 'body', 'signals', 'activity', 'markers', 'log', 'checkins', 'plan'];
const WITHOUT_PLAN: readonly ProgressSectionId[] = ['body', 'signals', 'activity', 'markers', 'log'];

/** Scroll-spy: the last section whose top passed the sticky bars. */
function useSectionInView(ids: readonly ProgressSectionId[]): ProgressSectionId {
  const [active, setActive] = useState<ProgressSectionId>(ids[0]!);
  const key = ids.join(',');
  useEffect(() => {
    const list = key.split(',') as ProgressSectionId[];
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.matchMedia?.('(min-width: 64rem)').matches ? 110 : 170;
      let current = list[0]!;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(atEnd && window.scrollY > 0 ? list[list.length - 1]! : current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    frame = window.requestAnimationFrame(measure);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);
  return ids.includes(active) ? active : ids[0]!;
}

export function ProgressOverview() {
  const { plan } = useAppMode();
  const today = useToday();
  const { hash } = useLocation();
  const quietMode = useLiving((s) => s.today(today)?.quietMode ?? false, [today]);
  const [showNumbers, setShowNumbers] = useState(false);
  const quiet = quietMode && !showNumbers;
  const [range, setRange] = useState<TrendRange>('4wk');
  const ids = plan ? WITH_PLAN : WITHOUT_PLAN;
  const active = useSectionInView(ids);

  useEffect(() => {
    if (!hash) return;
    const go = () => document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
    const f = window.requestAnimationFrame(go);
    return () => window.cancelAnimationFrame(f);
  }, [hash]);

  return (
    <>
      <TopBar
        title={C.title}
        tabs={plan ? <Engraved className="lv-prog-plan">{plan.name}</Engraved> : undefined}
        actions={
          <>
            {plan ? (
              <KeyBank<TrendRange> size="sm" label={C.rangeLabel} value={range} onChange={setRange} options={TREND_RANGES.map((r) => ({ value: r, label: C.ranges[r] }))} />
            ) : null}
            {quietMode ? (
              <Key size="sm" variant="quiet" pressed={showNumbers} onClick={() => setShowNumbers((v) => !v)}>
                {showNumbers ? C.hideNumbers : C.showNumbers}
              </Key>
            ) : null}
          </>
        }
      />
      <nav aria-label={C.sectionsNav} className="lv-prog-rail">
        <ScrollRail gap={6} padding={16} bleed={false}>
          {ids.map((id) => (
            <a key={id} href={`#${id}`} className="lm-chip lv-prog-rail__chip" data-kind="filter" aria-current={active === id ? 'true' : undefined}>
              {C.sections[id]}
            </a>
          ))}
        </ScrollRail>
      </nav>
      <Page>
        <div className="lv-prog">
          <nav aria-label={C.sectionsNav} className="lv-prog-index">
            <div className="lv-prog-index__sticky">
              <p className="lm-eng lv-prog-index__label">{C.sectionsHeading}</p>
              <div className="lm-bank" data-orientation="vertical" data-block="true">
                {ids.map((id) => (
                  <a key={id} href={`#${id}`} className="lm-bank__key" aria-current={active === id ? 'true' : undefined}>
                    {C.sections[id]}
                  </a>
                ))}
              </div>
            </div>
          </nav>
          <div className="lv-prog-main">
            {plan ? (
              <>
                <TrendSection plan={plan} today={today} range={range} quiet={quiet} />
                <GoalsSection plan={plan} today={today} />
                <AdherenceSection plan={plan} today={today} quiet={quiet} />
              </>
            ) : null}
            <BodySection today={today} quiet={quiet} {...(quietMode ? { onShowNumbers: () => setShowNumbers(true) } : {})} />
            <SignalsSection quiet={quiet} />
            {/* plan 04: the ring's link card to Body signals (/signals), in place of the E29 steps and workouts */}
            <BodySignalsLink id="activity" />
            {/* E20: markers — readings against the plan's projection, retest due lines */}
            <MarkerTrendsSection plan={plan ?? null} />
            <LogSection plan={plan} today={today} quiet={quiet} />
            {plan ? (
              <>
                <CheckInsSection plan={plan} today={today} quiet={quiet} />
                <PlanSection />
              </>
            ) : null}
          </div>
        </div>
      </Page>
    </>
  );
}
