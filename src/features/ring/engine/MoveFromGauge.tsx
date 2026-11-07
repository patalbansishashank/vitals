import { Faceplate, Key } from '@/components';
import { engine, isBusy, useGaugeEngine } from '@/state/gaugeEngine';
import { ENGINE_COPY as C } from './copy';
import { movePlan, type MoveStepId } from './moveSteps';
import { PermissionRows } from './PermissionRows';
import './engine.css';

const STEP_NO: Record<MoveStepId, number> = { uninstall: 1, takeOver: 2, permissions: 3 };

/**
 * (r070) "Finish moving from Gauge": the Gauge app is retired and its engine now runs inside Vitals. Shown on Today and in
 * Ring until it is all done. Three steps, one at a time, the one to act on open: send what Gauge holds and uninstall it;
 * take over the ring; allow what the ring needs. Nothing on the web or the desktop (no engine there).
 */
export function MoveFromGauge({
  className,
  except,
}: {
  className?: string;
  /** a step this screen already shows itself */ except?: MoveStepId;
}) {
  const eng = useGaugeEngine();
  const plan = movePlan(eng.state, eng.available);
  if (!plan.show || !plan.step || plan.step === except) return null;
  const step = plan.step;
  const failed =
    eng.error && (eng.error.action === 'uninstall' || eng.error.action === 'takeOver')
      ? eng.error.message
      : null;
  const { waiting, ready } = plan.uninstall;
  return (
    <Faceplate
      title={plan.moving ? C.moving : C.settingUp}
      caption={plan.moving ? C.stepOf(STEP_NO[step]) : undefined}
      className={['eg-move', className].filter(Boolean).join(' ')}
      data-step={step}
    >
      {plan.moving ? (
        <ol className="eg-steps" aria-label={C.stepsLabel}>
          {plan.steps.map((s) => (
            <li
              key={s.id}
              className="eg-steps__item"
              data-state={s.state}
              aria-current={s.state === 'current' ? 'step' : undefined}
            >
              <span className="eg-steps__bar" aria-hidden="true" />
              <span className="eg-steps__label">{C.steps[s.id]}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {step === 'uninstall' ? (
        <div className="eg-body">
          <p className="eg-line" role="status" aria-live="polite">
            {waiting === null
              ? C.unknownQueue
              : waiting > 0
                ? `${C.waiting(waiting)} ${C.waitingKeep}`
                : C.sentAll}
          </p>
          <div className="eg-keys">
            <Key
              variant="primary"
              loading={isBusy(eng, 'uninstall')}
              disabled={!ready}
              disabledReason={ready ? undefined : C.uninstallWaitingReason(waiting)}
              onClick={() => void engine.uninstallGauge()}
            >
              {C.uninstall}
            </Key>
            {waiting === null ? (
              <Key variant="text" onClick={() => void engine.uninstallGauge()}>
                {C.uninstallAnyway}
              </Key>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === 'takeOver' ? (
        <div className="eg-body">
          <p className="eg-line">{C.gaugeGone}</p>
          <div className="eg-keys">
            <Key variant="primary" loading={isBusy(eng, 'takeOver')} onClick={() => void engine.takeOver()}>
              {C.takeOver}
            </Key>
          </div>
        </div>
      ) : null}

      {step === 'permissions' ? <PermissionRows items={plan.items} /> : null}

      {failed ? (
        <p className="eg-error" role="status">
          {failed}
        </p>
      ) : null}
    </Faceplate>
  );
}
