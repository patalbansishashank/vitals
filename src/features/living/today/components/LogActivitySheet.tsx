/**
 * "Log an activity" over Today (r068 V14, S9): Train's own log sheet (`ElsePanel` with no planned session), opened where
 * the key is instead of sending the person to Train. It reads the same training setup Train reads and saves through the
 * same `activity.logManual` path, with the same toast and Undo. While the setup loads the sheet waits closed.
 */
import '../../train/train.css';
import '../cards/sheets.css';
import { formatNumber, toast } from '@/components';
import type { LocalDate } from '@/living';
import { appClockH } from '@/living/todayReplay';
import { useLivingClock } from '../../clock';
import { EquivalenceQuietProvider } from '../../components/EquivalenceMeter';
import { ElsePanel, type ElseSaveInput } from '../../train/components/ElsePanel';
import { TRAIN_COPY } from '../../train/copy';
import { useTrainingSetup } from '../../train/setup';
import { useLogManualActivity } from '../../train/v3Adapter';

export function LogActivitySheet({
  date,
  today,
  quiet,
  onClose,
}: {
  date: LocalDate;
  today: LocalDate;
  quiet: boolean;
  onClose: () => void;
}) {
  const setupView = useTrainingSetup();
  const logManual = useLogManualActivity();
  const clock = useLivingClock();
  if (setupView.status !== 'ready') return null;
  const setup = {
    profile: setupView.profile,
    ctx: setupView.ctx,
    catalogue: setupView.catalogue,
    typicalBody: setupView.typicalBody,
  };
  const save = async (input: ElseSaveInput): Promise<string | null> => {
    if (!input.manual) return TRAIN_COPY.cantSave;
    const out = await logManual(input.manual);
    if (!out.ok) return out.message ?? TRAIN_COPY.cantSave;
    onClose();
    const undo = out.undo;
    const minutes = out.saved?.durationMin ?? input.manual.durationMin;
    toast(
      quiet
        ? TRAIN_COPY.else.loggedQuiet(input.record.name)
        : TRAIN_COPY.else.logged(input.record.name, formatNumber(minutes, 0)),
      undo ? { action: { label: TRAIN_COPY.toast.undo, onClick: () => void undo() } } : {},
    );
    return null;
  };
  return (
    <EquivalenceQuietProvider quiet={quiet}>
      <ElsePanel
        key="log"
        model={null}
        index={null}
        date={date}
        today={today}
        setup={setup}
        quiet={quiet}
        nowH={appClockH(clock.now().getTime(), clock.tz, clock.rolloverH).clockH}
        rolloverH={clock.rolloverH}
        onClose={onClose}
        onSave={save}
      />
    </EquivalenceQuietProvider>
  );
}
