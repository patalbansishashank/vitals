import { Key } from '@/components/Key';
import { showNotice } from '@/app/shell/notices';
import { PWA_COPY } from './copy';
import { useSwState } from './swStatus';

export const UPDATE_NOTICE_ID = 'pwa-update';

/** The "Reload" key shared by the notice and the Settings row; shows busy while the new version takes over. */
export function ReloadKey({ onReload }: { onReload: () => void }) {
  const { applying } = useSwState();
  return (
    <Key size="sm" loading={applying} onClick={onReload}>
      {PWA_COPY.updateKey}
    </Key>
  );
}

/**
 * "Update available · Reload": a non-blocking global notice (the shell renders it under the context bar, like
 * every other app-wide notice). Dismissible; Settings › Install Vitals keeps offering the reload.
 */
export function showUpdateNotice(onReload: () => void): void {
  showNotice({
    id: UPDATE_NOTICE_ID,
    severity: 'info',
    title: PWA_COPY.updateTitle,
    body: PWA_COPY.updateBody,
    dismissible: true,
    actions: <ReloadKey onReload={onReload} />,
  });
}
