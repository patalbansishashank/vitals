import { useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { Page } from '@/components';
import { MQ, useMediaQuery } from '@/components/lib/hooks';
import { TopBar } from '@/app/shell';
import {
  AboutSection,
  AppearanceSection,
  SafetySection,
  SECTIONS,
  sectionFromId,
  sectionTitle,
  SettingsSection,
  UnitsSection,
  type SectionId,
} from './sections';
import { SettingsIndex } from './SettingsIndex';
import { SavedLabel, SavedSlotContext, SettingsHeadingLevel } from './SettingRow';
import { DataSection } from './DataSection';
import { SyncSection } from './sync/SyncSection';
import { ServerSection } from './server/ServerSection';
import { AgentsSection } from './agents/AgentsSection';
import { AiSection } from './ai/AiSection';
import { ServerCoachSection } from './ai/ServerCoachSection';
import { SERVER_COACH_COPY } from './ai/copy';
import { useServerPairing } from './server/hooks';
import { SupplementsSection } from './supplements/SupplementsSection';
import { KitchenSection } from './KitchenSection';
import { InstallSettings } from './InstallSettings';
import { HeartRateSection } from './heart/HeartRateSection';
import { StepsSection } from './heart/StepsSection';
import { WidgetsSettings } from '@/features/widgets/WidgetsSettings';
import './settings.css';

/** Settings › Sync: pairing with the person's server first, then sync itself (the 24 words, Sync now, Stop). */
function SyncPage() {
  return (
    <SettingsSection id="sync" title="Sync">
      <ServerSection />
      <SyncSection />
    </SettingsSection>
  );
}

function SectionBody({ id, coachOnServer }: { id: SectionId; coachOnServer: boolean }) {
  switch (id) {
    case 'units':
      return <UnitsSection />;
    case 'appearance':
      return <AppearanceSection />;
    case 'heart':
      return <HeartRateSection />;
    case 'steps':
      return <StepsSection />;
    case 'kitchen':
      return <KitchenSection />;
    case 'supplements':
      return <SupplementsSection />;
    case 'data':
      return <DataSection />;
    case 'sync':
      return <SyncPage />;
    case 'coach':
      // paired: the Coach runs on the server, so no provider, model or key settings (they return unchanged unpaired)
      return coachOnServer ? <ServerCoachSection /> : <AiSection />;
    case 'agents':
      return <AgentsSection />;
    case 'widgets':
      return <WidgetsSettings />;
    case 'install':
      return <InstallSettings />;
    case 'safety':
      return <SafetySection />;
    case 'about':
      return <AboutSection />;
  }
}

/**
 * Settings (design/screens/settings-data.md; r068 S16).
 * - Phones: `/settings` is the index of groups; each section is its own pushed page at `/settings/:section` with Back to
 *   the index.
 * - Desktop (≥ 1024 px): master/detail. The index is a sticky column at the left (the open section selected) and the
 *   section fills the rest of the width; `/settings` opens the first section, and there is no Back.
 * Older links keep working: `/settings#data`, `/settings?section=server` and a pairing link
 * (`/settings?section=server#vitals-server:1?…`, whose code the Sync page reads from the fragment). Every control applies
 * instantly; "Saved" shows in the header for a second after a change went through.
 */
export default function SettingsPage() {
  const { hash, search } = useLocation();
  const { section } = useParams();
  const query = new URLSearchParams(search).get('section');
  const pairingLink = hash.startsWith('#vitals-server');
  const id =
    sectionFromId(section) ?? sectionFromId(query) ?? (pairingLink ? 'sync' : sectionFromId(hash.slice(1)));
  const [saved, setSaved] = useState(false);
  const coachOnServer = useServerPairing() !== null;
  const desktop = useMediaQuery(MQ.lg);
  const titleOf = (sid: SectionId) =>
    sid === 'coach' && coachOnServer ? SERVER_COACH_COPY.title : sectionTitle(sid);

  if (desktop) {
    const shown: SectionId = id ?? SECTIONS[0]!.id;
    const title = titleOf(shown);
    return (
      <SavedSlotContext.Provider value={setSaved}>
        <TopBar title="Settings" documentTitle={`${title} · Settings`} status={<SavedLabel on={saved} />} />
        <Page className="settings-page">
          <div className="settings-md">
            <div className="settings-md__index">
              <SettingsIndex variant="rail" current={shown} />
            </div>
            <div className="settings-md__detail" key={shown}>
              <h2 className="settings-md__title">{title}</h2>
              {/* the section's own h2 is above: its groups are h3 (on a phone the page's h1 is the title and they are h2) */}
              <SettingsHeadingLevel.Provider value={3}>
                <SectionBody id={shown} coachOnServer={coachOnServer} />
              </SettingsHeadingLevel.Provider>
            </div>
          </div>
        </Page>
      </SavedSlotContext.Provider>
    );
  }

  if (!id) {
    return (
      <>
        <TopBar title="Settings" back={{ mobileOnly: true }} compactOnMobile />
        <Page className="settings-page" data-index="">
          <SettingsIndex />
        </Page>
      </>
    );
  }
  const title = titleOf(id);
  return (
    <SavedSlotContext.Provider value={setSaved}>
      <TopBar
        title={title}
        documentTitle={`${title} · Settings`}
        back={{ to: '/settings', label: 'Settings' }}
        status={<SavedLabel on={saved} />}
      />
      <Page className="settings-page">
        <SectionBody id={id} coachOnServer={coachOnServer} />
      </Page>
    </SavedSlotContext.Provider>
  );
}
