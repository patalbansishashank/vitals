import { useId, useState, type ReactNode } from 'react';
import { Checkbox, Dialog, InlineWarning, Key, Switch } from '@/components';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/safety'; // registers the commands dispatched here
import { nowIso } from './clock';
import { FASTING, SHORT_WINDOW_ACK_VERSION } from './copy';
import { FastingOptInDialog } from './FastingOptInDialog';
import { EXPERT_MODE_AVAILABLE, type FastingOptIn, type OptInTier } from './safetyRules';
import { useSafetyAccess, type SafetyBodyContext } from './useSafetyAccess';
import './onboarding.css';

function Row({ label, help, note, children }: { label: ReactNode; help?: ReactNode; note?: ReactNode; children: (ids: { labelId: string; helpId?: string }) => ReactNode }) {
  const id = useId();
  const labelId = `${id}-l`;
  const helpId = help ? `${id}-h` : undefined;
  return (
    <div className="lm-safety-row">
      <div className="lm-safety-row__text">
        <span className="lm-safety-row__label" id={labelId}>
          {label}
        </span>
        {help ? (
          <span className="lm-safety-row__help" id={helpId}>
            {help}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children({ labelId, helpId })}</div>
      {note ? <div className="lm-safety-row__note">{note}</div> : null}
    </div>
  );
}

export interface FastingTierControlsProps {
  /** Body facts (enables the T3/T4 body thresholds). */
  context?: SafetyBodyContext;
  /** Show the expert-mode (T4) row. Defaults to the EXPERT_MODE_AVAILABLE feature flag. */
  expertModeAvailable?: boolean;
  /** Called after any change (Settings flashes "saved"). */
  onSaved?: () => void;
}

/**
 * Opt-in tier controls (dossier §4.3, design §6.6 "Fasting tiers"): fasts over 24 h (T2/T3) with the
 * acknowledgement dialog, expert mode (T4, behind a flag), and 4–6 h eating windows (HC-F5). Rows in the
 * Settings grammar; used in Settings › Safety and on the Planner's safety summary.
 */
export function FastingTierControls({ context, expertModeAvailable = EXPERT_MODE_AVAILABLE, onSaved }: FastingTierControlsProps) {
  const access = useSafetyAccess(context);
  const clearFastingOptIn = () => sendCommand('safety.clearFastingOptIn', {}).then((r) => r.ok);
  const setFastingOptIn = (optIn: FastingOptIn) => sendCommand('safety.setFastingOptIn', { optIn: optIn as never }).then((r) => r.ok);
  const setShortWindow = (value: { version: number; at: string } | null) => sendCommand('safety.setShortWindow', { value }).then((r) => r.ok);
  const [dialog, setDialog] = useState<{ tier?: OptInTier } | null>(null);
  const [windowAsk, setWindowAsk] = useState(false);
  const [windowOk, setWindowOk] = useState(false);
  const { fasting, outcome } = access;

  const standard = outcome.modeName === 'standard';
  const longTiers = fasting.optInTiers.filter((t) => t !== 'T4');
  const on = fasting.optedTier !== null;
  const disabledReason = !access.ready
    ? undefined
    : !standard
      ? FASTING.notStandard
      : fasting.illnessDaysLeft > 0
        ? FASTING.illness(fasting.illnessDaysLeft)
        : longTiers.length === 0
          ? FASTING.notEligible
          : undefined;
  const help = disabledReason ?? (on && fasting.optedTier ? FASTING.onHelp(fasting.optedTier) : FASTING.switchHelp);
  const pendingConfirm = !on && !disabledReason && (fasting.legacyRequest || fasting.needsReconfirm);
  const expertOn = fasting.optedTier === 'T4';
  const showExpert = expertModeAvailable && standard && fasting.optInTiers.includes('T4');

  return (
    <div>
      <Row
        label={FASTING.switchLabel}
        help={help}
        note={
          pendingConfirm ? (
            <InlineWarning
              severity="info"
              action={
                <Key size="sm" className="ml-1" onClick={() => setDialog({ tier: fasting.optIn?.tier === 'T3' ? 'T3' : undefined })}>
                  {FASTING.legacyAction}
                </Key>
              }
            >
              {fasting.legacyRequest ? FASTING.legacy : FASTING.reconfirm}
            </InlineWarning>
          ) : null
        }
      >
        {({ labelId, helpId }) => (
          <Switch
            checked={on}
            disabled={disabledReason !== undefined || !access.ready}
            labelledBy={labelId}
            describedBy={helpId}
            onChange={(v) => {
              if (v) setDialog({});
              else {
                void clearFastingOptIn().then((ok) => ok && onSaved?.());
              }
            }}
          />
        )}
      </Row>
      {showExpert ? (
        <Row label={FASTING.expertLabel} help={FASTING.expertHelp}>
          {({ labelId, helpId }) => (
            <Switch
              checked={expertOn}
              labelledBy={labelId}
              describedBy={helpId}
              onChange={(v) => {
                if (v) setDialog({ tier: 'T4' });
                else if (fasting.optIn) {
                  void setFastingOptIn({ ...fasting.optIn, tier: 'T3', at: nowIso() }).then((ok) => ok && onSaved?.());
                }
              }}
            />
          )}
        </Row>
      ) : null}
      {fasting.shortWindowAvailable && access.ready ? (
        <Row label={FASTING.shortWindowLabel} help={FASTING.shortWindowHelp}>
          {({ labelId, helpId }) => (
            <Switch
              checked={fasting.shortWindowOn}
              labelledBy={labelId}
              describedBy={helpId}
              onChange={(v) => {
                if (v) {
                  setWindowOk(false);
                  setWindowAsk(true);
                } else {
                  void setShortWindow(null).then((ok) => ok && onSaved?.());
                }
              }}
            />
          )}
        </Row>
      ) : null}
      <FastingOptInDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        eligibleTiers={fasting.optInTiers}
        expertModeAvailable={expertModeAvailable}
        initialTier={dialog?.tier}
        onSaved={() => onSaved?.()}
      />
      <Dialog
        open={windowAsk}
        onClose={() => setWindowAsk(false)}
        title={FASTING.shortWindowTitle}
        footer={
          <>
            <Key onClick={() => setWindowAsk(false)}>{FASTING.cancel}</Key>
            <Key
              variant="solid"
              disabledReason={windowOk ? undefined : FASTING.shortWindowBlocked}
              onClick={() => {
                setWindowAsk(false);
                void setShortWindow({ version: SHORT_WINDOW_ACK_VERSION, at: nowIso() }).then((ok) => ok && onSaved?.());
              }}
            >
              {FASTING.shortWindowAllow}
            </Key>
          </>
        }
      >
        <p className="m-0">{FASTING.shortWindowBody}</p>
        <Checkbox checked={windowOk} onChange={setWindowOk} label={FASTING.shortWindowCheck} />
      </Dialog>
    </div>
  );
}

