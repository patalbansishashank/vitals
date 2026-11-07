/** Goal leads the plan story. Weight and Energy share a window; every card keeps its anchor. */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { Scale } from 'lucide-react';
import { CardFoot, DottedTrack, MQ, Page, useMediaQuery } from '@/components';
import { TopBar, type MenuEntry } from '@/app/shell';
import { useQuietMode } from '@/state/settingsStore';
import { useMarkersDoc } from '@/markers/ui/markersDoc';
import { useToday } from '../clock';
import { useLiving } from '../data/source';
import { useAppMode } from '../mode';
import { addDays } from '@/living/dates';
import { PROGRESS_COPY as C } from './copy';
import type { TrendRange } from './model';
import { AdherenceSection } from './sections/AdherenceSection';
import { BodySection } from './sections/BodySection';
import { CheckInsSection } from './sections/CheckInsSection';
import { GoalsSection } from './sections/GoalsSection';
import { LogSection } from './sections/LogSection';
import { LogWeight, TrendSection, WeighInsSection, WeightGhost } from './sections/TrendSection';
import { EnergySection } from './sections/EnergySection';
import { HeartPointsSection } from './sections/HeartPointsSection';
import { OvernightSection } from './sections/OvernightSection';
import { StepsSection } from './sections/StepsSection';
import { MarkerTrendsSection } from '@/markers/ui/MarkerTrends';
import { GaugeFreshnessNotice, GaugeFreshnessProvider } from './components/GaugeFreshness';
import { ProgressCard } from './components/ProgressCard';

export function ProgressOverview() {
  const today = useToday();
  const sourceQuiet = useLiving((s) => s.today(today)?.quietMode ?? false, [today]);
  const settingQuiet = useQuietMode().on;
  const quietMode = sourceQuiet || settingQuiet;
  // A temporary reveal never survives leaving and re-entering quiet mode.
  return <GaugeFreshnessProvider><ProgressContent key={String(quietMode)} quietMode={quietMode} /></GaugeFreshnessProvider>;
}
function ProgressContent({ quietMode }: { quietMode: boolean }) {
  const { plan } = useAppMode();
  const today = useToday();
  const { hash } = useLocation();
  const [showNumbers, setShowNumbers] = useState(false);
  const quiet = quietMode && !showNumbers;
  const [range, setRange] = useState<TrendRange>('4wk');
  const desk = useMediaQuery(MQ.lg);
  const measurements = useLiving((s) => s.composition(), []);
  const hasWeight = useLiving(
    (s) => (s.trend(addDays(today, -181), today)?.weighIns.length ?? 0) > 0,
    [today],
  );
  const markers = useMarkersDoc();
  const empty =
    !plan &&
    !hasWeight &&
    !(measurements?.rows.length || measurements?.girths.length) &&
    !markers.readings.length;
  useEffect(() => {
    if (!hash) return;
    const f = window.requestAnimationFrame(() =>
      document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' }),
    );
    return () => window.cancelAnimationFrame(f);
  }, [hash]);
  const menu = useMemo<MenuEntry[] | undefined>(
    () =>
      quietMode
        ? [
            {
              id: 'numbers',
              label: showNumbers ? C.hideNumbers : C.showNumbers,
              onSelect: () => setShowNumbers((v) => !v),
            },
          ]
        : undefined,
    [quietMode, showNumbers],
  );
  const body = (
    <BodySection
      key="body"
      today={today}
      quiet={quiet}
      {...(quietMode ? { onShowNumbers: () => setShowNumbers(true) } : {})}
    />
  );
  const checkins = plan ? <CheckInsSection key="checkins" plan={plan} today={today} quiet={quiet} /> : null;
  return (
    <>
      <TopBar title={C.title} {...(menu ? { menu } : {})} />
      <Page>
        <GaugeFreshnessNotice />
        {empty ? (
          <ProgressCard
            title="Progress starts with a weigh-in"
            icon={Scale}
            domain="body"
            size="hero"
            id="progress-start"
            info={{
              body: 'Log a weight to begin your history. Later weigh-ins help separate your trend from day-to-day changes in water and gut contents. You can also add tape measurements or blood results. Once you have a plan, Progress compares the measurements you log with its forecast.',
              source: { kind: 'logged' },
              range: 'No readings yet.',
            }}
            foot={
              <CardFoot state={{ word: 'Your starting point' }} tone="ink">
                <LogWeight today={today} />
              </CardFoot>
            }
          >
            <WeightGhost />
            <DottedTrack
              label="Your progress"
              value={null}
              goal={1}
              valueText="No weigh-in yet"
              quiet
              quietWord="Your starting point"
            />
          </ProgressCard>
        ) : plan ? (
          <div className="lv-prog">
            <div className="lv-prog__hero">
              <GoalsSection plan={plan} today={today} quiet={quiet} />
            </div>
            <div className="lv-prog__col">
              <TrendSection plan={plan} today={today} range={range} onRange={setRange} quiet={quiet} />
              <EnergySection plan={plan} today={today} range={range} quiet={quiet} />
              {desk ? (
                <StepsSection today={today} quiet={quiet} />
              ) : (
                <AdherenceSection today={today} quiet={quiet} />
              )}
              <LogSection plan={plan} today={today} quiet={quiet} />
              {checkins}
              {desk ? null : (
                <>
                  <StepsSection today={today} quiet={quiet} />
                  <HeartPointsSection today={today} quiet={quiet} />
                  <OvernightSection today={today} quiet={quiet} />
                </>
              )}
            </div>
            <div className="lv-prog__col">
              {desk ? (
                <>
                  <AdherenceSection today={today} quiet={quiet} />
                  <HeartPointsSection today={today} quiet={quiet} />
                  <OvernightSection today={today} quiet={quiet} />
                </>
              ) : null}
              {body}
              <MarkerTrendsSection plan={plan} quiet={quiet} />
            </div>
          </div>
        ) : (
          <div className="lv-prog" data-single="true">
            <div className="lv-prog__col">
              <WeighInsSection today={today} range={range} onRange={setRange} quiet={quiet} />
              {body}
              <MarkerTrendsSection plan={null} quiet={quiet} />
            </div>
          </div>
        )}
      </Page>
    </>
  );
}
