import { Key } from '@/components';
import { engine, isBusy, useGaugeEngine } from '@/state/gaugeEngine';
import { ENGINE_COPY as C } from './copy';
import './engine.css';

/**
 * (r071) "Android blocks the counter until you allow it": an app that came onto the phone as a file ("restricted setting",
 * Android 13+) cannot have its accessibility switch turned on until the person allows it in the app's own App info, so the
 * short-video counter's switch stays grey. Three steps and one key, the App info page; the person does the allowing, nothing is
 * allowed from here. Shown (`showAllowGuide`) under the permission rows and in the limit card, only while the counter is wanted
 * and off. Step 3's key is the one the screen already has (the row's "Open settings", the limit card's).
 */
export function RestrictedGuide() {
  const eng = useGaugeEngine();
  const failed = eng.error?.action === 'appInfo' ? eng.error.message : null;
  const [open, hold, back] = C.guide.steps;
  return (
    <section className="eg-guide" aria-label={C.guide.title}>
      <p className="eg-guide__title">{C.guide.title}</p>
      <ol className="eg-guide__steps">
        <li>
          {open}
          <div className="eg-keys">
            <Key
              variant="action"
              size="sm"
              loading={isBusy(eng, 'appInfo')}
              onClick={() => void engine.openAppInfo()}
            >
              {C.guide.openAppInfo}
            </Key>
          </div>
        </li>
        <li>{hold}</li>
        <li>{back}</li>
      </ol>
      <p className="eg-guide__note">{C.guide.note}</p>
      {failed ? (
        <p className="eg-error" role="status">
          {failed}
        </p>
      ) : null}
    </section>
  );
}
