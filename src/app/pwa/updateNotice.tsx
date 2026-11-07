import { Key } from '@/components/Key';
import { showNotice } from '@/app/shell/notices';
import { PWA_COPY } from './copy';
import { useSwState } from './swStatus';

export const UPDATE_NOTICE_ID = 'pwa-update';

/**
 * The "Reload" key shared by the banner (a gold text button, its one action) and the Settings row; shows busy while the
 * new version takes over.
 */
export function ReloadKey({ onReload, variant }: { onReload: () => void; variant?: 'text' }) {
  const { applying } = useSwState();
  return (
    <Key size="sm" variant={variant} loading={applying} onClick={onReload}>
      {PWA_COPY.updateKey}
    </Key>
  );
}

/**
 * "Update available · Reload": a banner in the shell's one banner slot under the header, with one action. It outranks
 * the other info banners. Dismissible; Settings › Install Vitals keeps offering the reload.
 */
export function showUpdateNotice(onReload: () => void): void {
  showNotice({
    id: UPDATE_NOTICE_ID,
    severity: 'info',
    priority: 1,
    title: PWA_COPY.updateTitle,
    dismissible: true,
    actions: <ReloadKey onReload={onReload} variant="text" />,
  });
}
