/** Page-level recording entry: the widget deep link works even when Activities is removed from Today. */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useRecording } from '../activity/RecordBanner';
import { RecordSheet } from '../activity/RecordSheet';

export function useRecordActivity({
  isToday,
  recent = [],
}: {
  isToday: boolean;
  recent?: readonly string[];
}) {
  const recording = useRecording();
  const [search, setSearch] = useSearchParams();
  const requested = isToday && search.get('record') === '1';
  const [manualOpen, setManualOpen] = useState(false);
  const can = isToday && recording.available && !recording.rec;
  const clearRequest = useCallback(() => setSearch(
    (prev) => {
      const next = new URLSearchParams(prev);
      next.delete('record');
      return next;
    },
    { replace: true },
  ), [setSearch]);
  // Keep the deep link in the URL while availability (including local control permission) resolves. A running
  // recording consumes it without opening another start sheet; closing the sheet consumes it too.
  useEffect(() => {
    if (requested && recording.rec) clearRequest();
  }, [requested, recording.rec, clearRequest]);
  const open = manualOpen || (requested && can);
  return {
    can,
    open: () => setManualOpen(true),
    sheet: open ? <RecordSheet open onClose={() => { setManualOpen(false); if (requested) clearRequest(); }} recent={recent} /> : null,
  };
}
