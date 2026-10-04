/*
 * "Share to Vitals" (SUITE_SPEC §15.7 Files), owned by L-ANDROID: files shared to the Android app, or opened with it,
 * go to the same import as Settings › Devices › Import a file: staged with `stageFile`, then `bio.import` as a job,
 * with the job's result in a toast. One file at a time, in the order they arrived.
 */
import { onAndroid, onSharedFiles } from './androidShell';

export interface IntakeDeps {
  /** Import one file; defaults to `importSharedFile`. */
  importFile(file: File): Promise<void>;
  /** Called when shared files could not be read; defaults to a toast. */
  unreadable(count: number): void;
}

/** Same id as Settings › Devices' job toasts, so one import never shows two toasts. */
const JOB_TOAST = { id: 'devices-job' };

/** Settings › Devices' "Import a file" without the picker: `bio.import` through the bus, the outcome in a toast. */
export async function importSharedFile(file: File): Promise<void> {
  // loaded on first use: the command registry (which installs the `bio` port) and the toast are not needed on the web
  const [{ dispatch, jobs }, { stageFile }, { toast }, { DEV }, { useSettingsStore }] = await Promise.all([
    import('@/commands'),
    import('@/biometrics/app/handoff'),
    import('@/components/Toast'),
    import('@/features/settings/devices/copy'),
    import('@/state/settingsStore'),
  ]);
  try {
    toast(`Importing ${file.name}…`, JOB_TOAST);
    const r = await dispatch('bio.import', { fileRef: stageFile(file, file.name) });
    if (!r.ok) {
      toast(r.error.message || DEV.failed, JOB_TOAST);
      return;
    }
    if (!('job' in r)) return;
    const st = await jobs.wait(r.job.jobId);
    if (st.state === 'done') {
      toast(DEV.imported(jobs.result(r.job.jobId) as Parameters<typeof DEV.imported>[0], useSettingsStore.getState().dateStyle), JOB_TOAST);
    } else if (st.state === 'failed') toast(st.error?.message ?? DEV.failed, JOB_TOAST);
  } catch (e) {
    // the bus or the job runner threw: say so, like the failed-job case, instead of leaving "Importing…" on screen
    toast(e instanceof Error && e.message ? e.message : DEV.failed, JOB_TOAST);
  }
}

/** A shared file that never reached the import (the copy in the app's cache could not be read): say so. */
async function tellUnreadable(): Promise<void> {
  try {
    const [{ toast }, { DEV }] = await Promise.all([import('@/components/Toast'), import('@/features/settings/devices/copy')]);
    toast(DEV.failed, JOB_TOAST);
  } catch {
    // no toast to show it with
  }
}

let installed: (() => void) | null = null;

/** On Android, import every shared file as it arrives (and those waiting at start). Idempotent; nothing on the web. */
export function installAndroidIntake(deps: Partial<IntakeDeps> = {}): () => void {
  if (installed) return installed;
  if (!onAndroid()) return () => {};
  const importFile = deps.importFile ?? importSharedFile;
  let queue: Promise<void> = Promise.resolve();
  const stop = onSharedFiles(
    (files) => {
      for (const file of files) queue = queue.then(() => importFile(file)).catch(() => console.warn('Vitals: a shared file could not be imported.'));
    },
    (count) => (deps.unreadable ?? (() => void tellUnreadable()))(count),
  );
  const uninstall = () => {
    if (installed !== uninstall) return;
    installed = null;
    stop();
  };
  installed = uninstall;
  return uninstall;
}
