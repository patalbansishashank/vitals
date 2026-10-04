/**
 * Empty scenario (simulator-schedule.md §6): a faceplate centred on the perforated stage with the starters.
 */
import { EmptyRasterArt, EmptyStage, Faceplate } from '@/components';
import { STARTERS, type StarterId } from '../presets';

export function StarterPicker({ onPick }: { onPick: (id: StarterId) => void }) {
  return (
    <EmptyStage
      className="sim-starter"
      art={<EmptyRasterArt />}
      title="Paint your first weeks."
      action={
        <Faceplate className="sim-starter__plate" aria-label="Starters">
          <ul className="sim-starter__list">
            {STARTERS.map((s) => (
              <li key={s.id}>
                <button type="button" className="sim-starter__key" onClick={() => onPick(s.id)}>
                  <b>{s.title}</b>
                  <span>{s.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        </Faceplate>
      }
    >
      Pick a starter to get programs and a first draft, or start blank. You can change everything.
    </EmptyStage>
  );
}
