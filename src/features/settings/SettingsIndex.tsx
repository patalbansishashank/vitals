/**
 * Settings index (Lumen settings groups): sentence-case group labels over grouped rows, each row an icon, the section's
 * name, its current value and a chevron to the section's own page (`/settings/:section`). On desktop it is the master
 * column beside the open section (`variant="rail"`: compact rows, the open one selected, no values).
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { Bot, ChefHat, Database, Download, Eye, Footprints, HeartPulse, Info, LayoutGrid, Pill, RefreshCw, Ruler, ShieldCheck, Sparkles } from 'lucide-react';
import { StatusDot, type IconComponent } from '@/components';
import { getPreset } from '@/ai';
import { onAiConfigChange, readAiConfig } from '@/commands/ai';
import { APP_VERSION } from '@/app/version';
import { platformCaps } from '@/platform';
import { useQuietMode, useSettingsStore } from '@/state/settingsStore';
import { useSyncView } from '@/state/sync';
import { useBodyContext } from '@/state/profileStore';
import { toSectionV2 } from '@/catalogues/supplements';
import { useIntakeDoc } from '@/features/intake/doc';
import { MODE_SHORT } from '@/features/onboarding/copy';
import { useSafetyAccess } from '@/features/onboarding/useSafetyAccess';
import { SettingsGroup, SettingsLinkRow } from './SettingRow';
import { SECTIONS, type SectionId } from './sections';
import { useServerPairing } from './server/hooks';
import { describePill } from './sync/status';
import { usePendingProposals } from './agents/ProposalsList';
import { formatDay } from './server/copy';
import { SERVER_COACH_COPY } from './ai/copy';
import { useUpdateWaiting } from './UpdatesRow';
import { useHeartSettings } from './heart/v3Adapter';
import { useInstallState } from '@/app/pwa/install';
import { readAgentSettings } from '@/commands/ai/settings';
import { useWebMcpEnabled, useWebMcpSupported } from '@/agents/webmcp';
import { useKitchenView } from '@/features/food/pantryData';
import { stepsSummary } from './heart/StepsSection';
import { useWidgetStatus } from '@/features/widgets/status';

const ICON: Record<SectionId, IconComponent> = {
  units: Ruler,
  appearance: Eye,
  heart: HeartPulse,
  steps: Footprints,
  kitchen: ChefHat,
  supplements: Pill,
  data: Database,
  sync: RefreshCw,
  coach: Sparkles,
  agents: Bot,
  safety: ShieldCheck,
  widgets: LayoutGrid,
  install: Download,
  about: Info,
};

/** r068 S17: six groups by what a section is about; Safety sits with the general preferences, Install and About last. */
export const GROUPS: ReadonlyArray<{ label: string; ids: readonly SectionId[] }> = [
  { label: 'General', ids: ['units', 'appearance', 'safety'] },
  { label: 'Body and activity', ids: ['heart', 'steps'] },
  { label: 'Food', ids: ['kitchen', 'supplements'] },
  { label: 'Data', ids: ['data', 'sync'] },
  { label: 'Coach and agents', ids: ['coach', 'agents'] },
  { label: 'App', ids: ['widgets', 'install', 'about'] },
];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A section's state as a mark and a word: the gold dot is on, answered or in use, the hollow ring is off or not answered. */
const on = (label: string): ReactNode => <StatusDot tone="live" label={label} />;
const off = (label: string): ReactNode => <StatusDot tone="neutral" label={label} />;

/**
 * The one-word state of each section, read from what is already loaded (never a server call). Every row has one, so
 * the value column reads as a column (r068 V9).
 */
function useValues(): Partial<Record<SectionId, ReactNode>> {
  const units = useSettingsStore((s) => s.units);
  const energy = useSettingsStore((s) => s.energyUnit);
  const lastExportAt = useSettingsStore((s) => s.lastExportAt);
  const quiet = useQuietMode();
  const sync = useSyncView();
  const server = useServerPairing();
  const ai = useSyncExternalStore(onAiConfigChange, readAiConfig, readAiConfig);
  const supplements = toSectionV2(useIntakeDoc().supplements)?.rows.length ?? 0;
  const safety = useSafetyAccess(useBodyContext());
  const pending = usePendingProposals().items?.length ?? 0;
  const updateWaiting = useUpdateWaiting();
  const heart = useHeartSettings();
  const maxOverride = heart.hrProfile.hrMaxOverride ?? null;
  const kitchen = useKitchenView().view;
  const kitchenItems = kitchen ? kitchen.equipment.length + kitchen.cuisines.length + kitchen.staples.length : null;
  const install = useInstallState();
  const [webmcpEnabled] = useWebMcpEnabled();
  const webmcpSupported = useWebMcpSupported();
  const webmcpOn = webmcpEnabled && webmcpSupported;
  const widgets = useWidgetStatus();
  // the MCP clients this person has let in (the browser's own agents are the `webmcp` key)
  const clients = Object.keys(readAgentSettings().clients).filter((k) => k !== 'webmcp').length;
  return {
    units: `${units === 'imperial' ? 'Imperial' : 'Metric'} · ${energy}`,
    appearance: quiet.on ? 'Quiet mode' : 'Standard',
    heart: maxOverride !== null ? `Max ${maxOverride} bpm` : 'From your age',
    steps: stepsSummary(heart),
    kitchen: kitchenItems === null ? undefined : kitchenItems ? count(kitchenItems, 'item', 'items') : 'Not set',
    supplements: supplements ? count(supplements, 'supplement', 'supplements') : 'None',
    data: lastExportAt ? `Exported ${formatDay(lastExportAt)}` : 'Not exported',
    sync: sync.paired ? on(describePill(sync.status)?.text ?? 'On') : server ? on('Paired') : off('Not paired'),
    // paired: the Coach runs on the server (no provider is chosen here)
    coach: server ? on(SERVER_COACH_COPY.value) : ai ? on(getPreset(ai.presetId)?.label ?? 'Custom endpoint') : off('Off'),
    agents: pending ? on(`${pending} waiting`) : clients ? on(`${clients} connected`) : server ? on('On your server') : webmcpOn ? on('In this browser') : off('Needs Sync'),
    install: install.phase === 'installed' ? on('Installed') : off('Not installed'),
    safety: safety.gate.status === 'first-run' ? off('Not answered') : on(MODE_SHORT[safety.outcome.modeName]),
    // Android only: how many of the widgets are on the home screen (the shell's own count)
    widgets: widgets?.placed ? on(`${widgets.placed} placed`) : off('None placed'),
    // Android: a downloaded app update waits for the owner's tap (Settings › About)
    about: updateWaiting ? on('Update ready') : APP_VERSION,
  };
}

export function SettingsIndex({ variant = 'list', current }: { variant?: 'list' | 'rail'; current?: SectionId }) {
  const values = useValues();
  const coachOnServer = useServerPairing() !== null;
  const titleOf = (id: SectionId) => (id === 'coach' && coachOnServer ? SERVER_COACH_COPY.title : SECTIONS.find((s) => s.id === id)!.title);
  // the Android and desktop apps are installed already: nothing to install; Widgets exists in the Android app only
  const caps = platformCaps();
  const hidden = new Set<SectionId>([...(caps.installedApp ? (['install'] as const) : []), ...(caps.platform === 'android' ? [] : (['widgets'] as const))]);
  const rail = variant === 'rail';
  return (
    <nav aria-label="Settings sections" className="settings-section settings-index" data-variant={variant}>
      {GROUPS.map((g) => (
        <SettingsGroup key={g.label} label={g.label} icons>
          {g.ids
            .filter((id) => !hidden.has(id))
            .map((id) => (
              <SettingsLinkRow key={id} to={`/settings/${id}`} icon={ICON[id]} title={titleOf(id)} value={rail ? undefined : values[id]} current={rail ? id === current : undefined} />
            ))}
        </SettingsGroup>
      ))}
    </nav>
  );
}
