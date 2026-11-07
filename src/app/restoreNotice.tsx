/** Another window replaced the local snapshot: keep this tab read-only until the person reloads it. */
import { externalRestoreRequired, onExternalRestore } from '@/state/writeBarrier';
import { ReloadKey } from './pwa/updateNotice';
import { dismissNotice, showNotice } from './shell/notices';

export const RESTORE_NOTICE_ID = 'data-restored-elsewhere';
export function startRestoreNotice(reload = () => window.location.reload()): () => void {
  const update = () => {
    if (!externalRestoreRequired()) return;
    showNotice({
      id: RESTORE_NOTICE_ID,
      severity: 'info',
      priority: 2, // danger, agent Stop and existing update notices keep their priorities
      title: 'Data was replaced in another window. Reload to continue.',
      dismissible: false,
      collapsible: false,
      actions: <ReloadKey onReload={reload} variant="text" />,
    });
  };
  update();
  const off = onExternalRestore(update);
  return () => { off(); dismissNotice(RESTORE_NOTICE_ID); };
}
