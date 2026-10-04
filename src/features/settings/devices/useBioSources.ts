/**
 * `bio.sources`, read again whenever a biometrics document changes. Settings › Devices and the ring sharing switch (also
 * on the Ring page) read it through here.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CommandResult } from '@/commands/types';
import { sendCommand } from '@/features/lib/sendCommand';
import { getDocumentStore } from '@/state/runtime';
import { sharedBioIndex } from '@/biometrics/store/docIndex';

export const output = <T,>(r: CommandResult): T | null => (r.ok && 'output' in r ? (r.output as T) : null);

/** The `bio.sources` output this folder reads; `ringSharing` and `ringDefaultsNotice` may be missing (older builds). */
export function useBioSources<T>(): { view: T | null; refresh: () => void } {
  const [view, setView] = useState<T | null>(null);
  const [rev, setRev] = useState(0);
  const refresh = useCallback(() => setRev((r) => r + 1), []);
  useEffect(() => sharedBioIndex(getDocumentStore()).subscribe(refresh), [refresh]);
  useEffect(() => {
    let live = true;
    void sendCommand('bio.sources', {}, { silent: true }).then((r) => {
      const v = output<T>(r);
      if (live && v) setView(v);
    });
    return () => {
      live = false;
    };
  }, [rev]);
  return { view, refresh };
}
