import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { GRADE_TEXT } from '@/components';
import { BaselineGauge, ScoreTile, SignalsStrip, isRelativeOnly } from '../../components/ScoreTile';
import { createStubScoresSource, type ScoreTileModel } from '../../data/scores';

const scores = createStubScoresSource('2026-10-01');
const tile = (id: string): ScoreTileModel => {
  const t = scores.tiles('lastNight').find((x) => x.scoreId === id) ?? scores.detail(id)?.tile;
  if (!t) throw new Error(`no tile ${id}`);
  return t;
};

function renderTile(t: ScoreTileModel, onUndo?: (id: string) => void) {
  return render(
    <MemoryRouter>
      <ul>
        <ScoreTile tile={t} {...(onUndo ? { onUndo } : {})} />
      </ul>
    </MemoryRouter>,
  );
}

describe('ScoreTile', () => {
  it('shows the version chip, the grade and the value with its likely range', () => {
    renderTile(tile('sleep.tst'));
    expect(screen.getByRole('link', { name: 'Version 1.0: what changed' })).toHaveTextContent('v1.0');
    expect(screen.getByRole('img', { name: GRADE_TEXT.B })).toBeInTheDocument();
    expect(screen.getByText('7 h 10 asleep')).toBeInTheDocument();
    expect(screen.getByText(/likely 6 h 10–8 h 10/, { ignore: '.lm-sr' })).toBeInTheDocument();
    expect(screen.getByText(/^Sleep: 7 h 10 asleep, likely 6 h 10–8 h 10\. ring · Colmi R10 · tier C\. Version 1\.0, evidence grade B\.$/)).toHaveClass('lm-sr');
    expect(screen.getByText('ring · Colmi R10 · tier C')).toBeInTheDocument();
  });

  it('shows tier C heart-rate variability as change from normal only, marked trend only', () => {
    const { container } = renderTile(tile('hrv.status'));
    expect(screen.getByText('within your normal')).toBeInTheDocument();
    expect(screen.getByText('ring · Colmi R10 · tier C · trend only')).toBeInTheDocument();
    expect(screen.getByText('7-day +3 % vs your normal')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bms\b/);
    expect(screen.getByText('Oura says “balanced” · vendor opinion')).toBeInTheDocument();
  });

  it('never shows an absolute number for a tier C temperature, even when the source sends one', () => {
    const t = tile('temp.deviation');
    expect(isRelativeOnly(t)).toBe(true);
    renderTile({ ...t, trendOnly: false });
    expect(screen.getByText('+0.3 °C vs your normal')).toBeInTheDocument();
    expect(screen.queryByText('0.3 °C')).not.toBeInTheDocument();
  });

  it('withholds a value with a printed count scale (14 ticks, 9 inked), never a guess', () => {
    const { container } = renderTile(tile('fitness.vo2max'));
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('needs 14 nights · 9 so far')).toBeInTheDocument();
    const ticks = container.querySelectorAll('[data-count-tick]');
    expect(ticks).toHaveLength(14);
    expect(container.querySelectorAll('[data-count-tick][data-inked="true"]')).toHaveLength(9);
    expect(container.querySelector('svg[aria-label="9 of 14 nights"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/\d+\s*ml\/kg\/min/);
    expect(screen.getByText('estimate')).toBeInTheDocument();
  });

  it('shows a flag as a mark and a word, never its level code, with the plan link and Undo', async () => {
    const undo = vi.fn();
    const { container } = renderTile(tile('illness.nightsignal'), undo);
    expect(screen.getAllByText('signs of strain').length).toBeGreaterThan(0);
    expect(screen.getByText('signs of strain · 2 nights')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/amber|yellow|\bred\b/i);
    screen.getByRole('button', { name: 'Undo: this week’s fasts are paused' }).click();
    expect(undo).toHaveBeenCalledWith('chg-fasts-paused');
  });

  it('labels a convenience index as not a measurement', () => {
    renderTile(tile('readiness.index'));
    expect(screen.getByText('index · not a measurement')).toBeInTheDocument();
    expect(screen.getByText('64 / 100')).toBeInTheDocument();
    expect(screen.getByText(/from 4 of 6 parts/, { ignore: '.lm-sr' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: GRADE_TEXT.D })).toBeInTheDocument();
  });

  it('shows the normal range forming instead of a band while the baseline builds', () => {
    renderTile(tile('sleep.sri'));
    expect(screen.getByText('normal range forming · 9 of 14 nights')).toBeInTheDocument();
  });
});

describe('BaselineGauge', () => {
  it('draws the normal band, the 7-day mean, last night and a borderline bracket with a text equivalent', () => {
    const { container } = render(<BaselineGauge min={30} max={60} normal={{ lo: 38, hi: 47 }} mean7={42} lastNight={44} borderline={{ lo: 36, hi: 40 }} unit="ms" decimals={0} width={320} />);
    const svg = screen.getByRole('img', { name: /your normal 38 to 47 ms; 7-day mean 42 ms; last night 44 ms/ });
    expect(svg).toHaveAttribute('width', '320');
    expect(container.querySelector('.lv-gauge__normal')).not.toBeNull();
    expect(container.querySelector('.lv-gauge__mean')).not.toBeNull();
    expect(container.querySelector('.lv-gauge__last')).not.toBeNull();
    expect(container.querySelector('.lv-gauge__bracket')).not.toBeNull();
    expect(container.querySelectorAll('.lv-gauge__tick').length).toBeGreaterThan(3);
  });
});

describe('SignalsStrip', () => {
  it('puts every tile inside one faceplate as list items', () => {
    const tiles = scores.tiles('lastNight');
    const { container } = render(
      <MemoryRouter>
        <SignalsStrip tiles={tiles} />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('.lm-face')).toHaveLength(1);
    const face = screen.getByRole('region', { name: 'Body signals' });
    expect(within(face).getAllByRole('listitem')).toHaveLength(tiles.length);
  });

  it("Today's scope has sleep, HRV status, resting heart rate and the active flag", () => {
    expect(scores.tiles('today').map((t) => t.scoreId)).toEqual(['sleep.tst', 'hrv.status', 'hr.rhr_night', 'illness.nightsignal']);
  });

  it('shows an empty stage when there are no body signals', () => {
    render(
      <MemoryRouter>
        <SignalsStrip tiles={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('No body signals yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a device' })).toHaveAttribute('href', '/settings/devices');
  });
});
