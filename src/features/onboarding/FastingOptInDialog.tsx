import { useId, useState } from 'react';
import { Checkbox, Dialog, InlineWarning, Key, KeyBank, type KeyBankOption } from '@/components';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/safety'; // registers the commands dispatched here
import { nowIso } from './clock';
import { FASTING, FASTING_ACKS, FASTING_ACK_VERSION, STOP_RULES, TIER_LABEL, YES_NO } from './copy';
import { TIER_ACKNOWLEDGEMENTS, type FastingAckId, type FastingOptIn, type OptInTier } from './safetyRules';
import './onboarding.css';

export interface FastingOptInDialogProps {
  open: boolean;
  onClose: () => void;
  /** Tiers this profile may opt into (from the gate outcome). */
  eligibleTiers: readonly OptInTier[];
  /** Offer T4 (expert mode). Off until clinician review. */
  expertModeAvailable?: boolean;
  /** Pre-select a tier (e.g. T4 from the expert-mode switch). */
  initialTier?: OptInTier;
  /** Called after the opt-in is saved. */
  onSaved?: (tier: OptInTier) => void;
}

/**
 * Fasting opt-in (dossier §4.3): Q19 recent illness, a tolerated 24 h fast (T2 eligibility), the tier, and
 * the tier's acknowledgements A–D with the stop rules. T4 (expert mode) asks twice: acknowledgements and
 * refeeding plan first, then an explicit confirmation step (the "double acknowledgement").
 */
export function FastingOptInDialog({
  open,
  onClose,
  eligibleTiers,
  expertModeAvailable = false,
  initialTier,
  onSaved,
}: FastingOptInDialogProps) {
  // Remount the body per opening so every opt-in starts unticked.
  return open ? (
    <OptInBody
      onClose={onClose}
      eligibleTiers={eligibleTiers}
      expertModeAvailable={expertModeAvailable}
      initialTier={initialTier}
      onSaved={onSaved}
    />
  ) : null;
}

function OptInBody({
  onClose,
  eligibleTiers,
  expertModeAvailable,
  initialTier,
  onSaved,
}: Omit<FastingOptInDialogProps, 'open'>) {
  const setFastingOptIn = (optIn: FastingOptIn) => sendCommand('safety.setFastingOptIn', { optIn: optIn as never }).then((r) => r.ok);
  const reportRecentIllness = (at: string) => void sendCommand('safety.reportIllness', { at });
  const offered = eligibleTiers.filter((t) => t !== 'T4' || expertModeAvailable);
  const [illness, setIllness] = useState<'yes' | 'no' | undefined>();
  const [prior, setPrior] = useState<'yes' | 'no' | undefined>();
  const [tier, setTier] = useState<OptInTier>(
    initialTier && offered.includes(initialTier) ? initialTier : 'T2',
  );
  const [acks, setAcks] = useState<Set<FastingAckId>>(new Set());
  const [refeed, setRefeed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const illnessId = useId();
  const priorId = useId();
  const tierId = useId();

  const needed = TIER_ACKNOWLEDGEMENTS[tier];
  const complete =
    illness === 'no' && prior === 'yes' && needed.every((a) => acks.has(a)) && (tier !== 'T4' || refeed);
  const toggle = (a: FastingAckId, on: boolean) =>
    setAcks((prev) => {
      const next = new Set(prev);
      if (on) next.add(a);
      else next.delete(a);
      return next;
    });

  const close = () => {
    // Q19 "yes" pauses fasts over 24 h for 4 weeks (dossier §4.1).
    if (illness === 'yes') reportRecentIllness(nowIso());
    onClose();
  };

  const save = () => {
    void setFastingOptIn({
      tier,
      acknowledged: [...acks].filter((a) => needed.includes(a)),
      ackVersion: FASTING_ACK_VERSION,
      priorFastTolerated: true,
      refeedingPlanAccepted: tier === 'T4' ? refeed : undefined,
      at: nowIso(),
    }).then((ok) => ok && onSaved?.(tier));
    onClose();
  };

  const tierOptions: KeyBankOption<OptInTier>[] = (['T2', 'T3', 'T4'] as const)
    .filter((t) => t !== 'T4' || expertModeAvailable)
    .map((t) => ({ value: t, label: TIER_LABEL[t], disabled: !offered.includes(t) }));

  if (confirming) {
    return (
      <Dialog
        open
        onClose={() => setConfirming(false)}
        title={FASTING.expertTitle}
        footer={
          <>
            <Key onClick={() => setConfirming(false)}>{FASTING.cancel}</Key>
            <Key variant="solid" onClick={save}>
              {FASTING.expertConfirm}
            </Key>
          </>
        }
      >
        <p className="m-0 font-semibold">{FASTING.expertConfirmTitle}</p>
        <p className="m-0">{FASTING.expertConfirmBody}</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={close}
      title={tier === 'T4' ? FASTING.expertTitle : FASTING.dialogTitle}
      footer={
        <>
          <Key onClick={close}>{FASTING.cancel}</Key>
          <Key
            variant="solid"
            disabledReason={complete ? undefined : FASTING.allowBlocked}
            onClick={() => (tier === 'T4' ? setConfirming(true) : save())}
          >
            {tier === 'T4' ? FASTING.expertContinue : FASTING.allow}
          </Key>
        </>
      }
    >
      <div className="grid gap-5">
        <p className="m-0">{tier === 'T4' ? FASTING.expertIntro : FASTING.intro}</p>
        <fieldset className="lm-onb-fs">
          <legend className="lm-onb-follow__legend" id={illnessId}>
            {FASTING.illnessQuestion}
          </legend>
          <KeyBank
            labelledBy={illnessId}
            value={illness}
            onChange={setIllness}
            options={[
              { value: 'yes', label: YES_NO.yes },
              { value: 'no', label: YES_NO.no },
            ]}
          />
          {illness === 'yes' ? (
            <InlineWarning severity="caution">{FASTING.illnessBlocked}</InlineWarning>
          ) : null}
        </fieldset>
        {illness === 'yes' ? null : (
          <>
            <fieldset className="lm-onb-fs">
              <legend className="lm-onb-follow__legend" id={priorId}>
                {FASTING.priorQuestion}
              </legend>
              <KeyBank
                labelledBy={priorId}
                value={prior}
                onChange={setPrior}
                options={[
                  { value: 'yes', label: YES_NO.yes },
                  { value: 'no', label: YES_NO.no },
                ]}
              />
              {prior === 'no' ? <InlineWarning severity="info">{FASTING.priorBlocked}</InlineWarning> : null}
            </fieldset>
            {prior === 'yes' ? (
              <>
                <div className="lm-onb-fs">
                  <span className="lm-onb-follow__legend" id={tierId}>
                    {FASTING.tierLabel}
                  </span>
                  <KeyBank labelledBy={tierId} value={tier} onChange={setTier} options={tierOptions} />
                  {!offered.includes('T3') ? (
                    <p className="m-0 text-xs text-ink-2">{FASTING.t3Unavailable}</p>
                  ) : null}
                </div>
                <fieldset className="lm-onb-fs">
                  <legend className="lm-onb-follow__legend">{FASTING.acknowledgementsLabel}</legend>
                  <Checkbox checked={acks.has('A')} onChange={(v) => toggle('A', v)} label={FASTING_ACKS.A} />
                  <Checkbox checked={acks.has('B')} onChange={(v) => toggle('B', v)} label={FASTING_ACKS.B} />
                  <ul className="lm-safety-list -mt-1 ml-7" aria-label={FASTING.stopRulesLabel}>
                    {STOP_RULES.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {needed.includes('C') ? (
                    <Checkbox
                      checked={acks.has('C')}
                      onChange={(v) => toggle('C', v)}
                      label={FASTING_ACKS.C}
                    />
                  ) : null}
                  {needed.includes('D') ? (
                    <Checkbox
                      checked={acks.has('D')}
                      onChange={(v) => toggle('D', v)}
                      label={FASTING_ACKS.D}
                    />
                  ) : null}
                  {tier === 'T4' ? (
                    <Checkbox checked={refeed} onChange={setRefeed} label={FASTING.expertRefeed} />
                  ) : null}
                </fieldset>
              </>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
