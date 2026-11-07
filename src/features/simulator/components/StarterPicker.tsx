/**
 * Empty scenario (simulator-schedule.md §6): one card listing the starters (Blank among them). Picking one paints the
 * first weeks; everything stays editable.
 */
import { Faceplate } from '@/components';
import { STARTERS, type StarterId } from '../presets';

export function StarterPicker({ onPick }: { onPick: (id: StarterId) => void }) {
  return (
    <Faceplate className="sim-starter" title="Pick a starter">
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
  );
}
