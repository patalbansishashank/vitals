import { useId, useState, type ReactNode } from 'react';
import { Checkbox, Faceplate, Key, StatusMark, cx, energyInText } from '@/components';
import { useSafetyStore } from '@/state/safetyStore';
import { useEnergyUnit } from '@/state/settingsStore';
import { nowIso } from './clock';
import { DANGER, DANGER_ACK_VERSION } from './copy';
import { StopAndGetHelp } from './Disclaimer';
import { isDangerAcknowledged } from './safetyRules';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/safety'; // registers the commands dispatched here
import './onboarding.css';

/** A danger-level warning to acknowledge (id from dossier §3, e.g. 'W-F04'; title + message from the warning engine). */
export interface DangerRule {
  id: string;
  /** First line states the risk: "Water fast of 5 days." */
  title: ReactNode;
  /** ≤ 200-character W-* message. */
  message: ReactNode;
}

export interface AcknowledgeDialogProps {
  rules: readonly DangerRule[];
  onAcknowledge: () => void;
  /** Heading level (default h2). */
  titleAs?: 'h2' | 'h3';
  className?: string;
}

/**
 * Danger acknowledgement (design §6.6, dossier §3 `danger`): shown IN PLACE of the results — in the chart
 * area, not as a modal (modals are not a first resort; DESIGN_DIRECTION §5) — until the user ticks
 * "I understand this is a simulation, not a recommendation" and presses "Show the projection".
 * Achromatic faceplate with danger marks (REVIEW_FINDINGS #5).
 */
export function AcknowledgeDialog({ rules, onAcknowledge, titleAs = 'h2', className }: AcknowledgeDialogProps) {
  const [checked, setChecked] = useState(false);
  const titleId = useId();
  const H = titleAs;
  // warning text states energy in kcal; Settings › energy unit decides the display
  const unit = useEnergyUnit();
  return (
    <Faceplate as="section" aria-labelledby={titleId} className={cx('lm-ack', className)}>
      <H id={titleId} className="lm-h3 m-0">
        {DANGER.heading(rules.length)}
      </H>
      <ul className="lm-ack__rules">
        {rules.map((r) => (
          <li key={r.id}>
            <StatusMark severity="danger" label="Warning" />
            <p className="lm-ack__rule-title">{typeof r.title === 'string' ? energyInText(r.title, unit) : r.title}</p>
            <p className="lm-ack__rule-body">{typeof r.message === 'string' ? energyInText(r.message, unit) : r.message}</p>
          </li>
        ))}
      </ul>
      <p className="lm-ack__lead">{DANGER.lead}</p>
      <StopAndGetHelp />
      <div className="lm-ack__foot">
        <Checkbox checked={checked} onChange={setChecked} label={DANGER.check} />
        <Key variant="solid" disabledReason={checked ? undefined : DANGER.showBlocked} onClick={onAcknowledge}>
          {DANGER.show}
        </Key>
      </div>
    </Faceplate>
  );
}

/** The persistent 28 px strip at the top of an acknowledged danger chart (and on exports). */
export function SimulationStrip({ className }: { className?: string }) {
  return (
    <div className={cx('lm-sim-strip', className)} role="note">
      <StatusMark severity="danger" size={16} />
      <span>{DANGER.strip}</span>
    </div>
  );
}

export interface AcknowledgeGateProps {
  /** Scenario the acknowledgement belongs to. */
  scenarioId: string;
  /** Changes whenever the schedule changes — a new hash asks again (spec: "until the schedule changes"). */
  scheduleHash: string;
  /** Danger rules active in the projection; empty = nothing to acknowledge. */
  rules: readonly DangerRule[];
  children: ReactNode;
}

/**
 * Results wrapper for the Simulator: danger rules → the acknowledgement panel first; once acknowledged
 * (per scenario, per rule, until the schedule changes) → the "Simulation — not a recommendation" strip on
 * top of the results. No danger → children unchanged.
 */
export function AcknowledgeGate({ scenarioId, scheduleHash, rules, children }: AcknowledgeGateProps) {
  const ack = useSafetyStore((s) => s.dangerAcks[scenarioId]);
  const ids = rules.map((r) => r.id);
  if (rules.length === 0) return <>{children}</>;
  if (!isDangerAcknowledged(ack, scheduleHash, ids, DANGER_ACK_VERSION)) {
    return <AcknowledgeDialog rules={rules} onAcknowledge={() => void sendCommand('safety.acknowledgeDanger', { scenarioId, ack: { scheduleHash, rules: ids, version: DANGER_ACK_VERSION, at: nowIso() } })} />;
  }
  return (
    <>
      <SimulationStrip />
      {children}
    </>
  );
}
