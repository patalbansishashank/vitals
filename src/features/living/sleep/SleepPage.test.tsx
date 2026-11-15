import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { addDays } from '@/living/dates';
import { calendarDate } from '@/features/ring/model';
import SleepPage from './SleepPage';

function Where() {
  const l = useLocation();
  return <p data-testid="at">{`${l.pathname}${l.search}`}</p>;
}

function at(path: string) {
  const { unmount } = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sleep" element={<SleepPage />} />
        <Route path="/sleep/:date" element={<SleepPage />} />
        <Route path="/ring/sleep" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  const where = screen.getByTestId('at').textContent;
  unmount();
  return where;
}

const today = calendarDate(Date.now());
const past = addDays(today, -3);

describe('/sleep opens Ring › Sleep on the same night or period', () => {
  it('keeps the night in the path or the query (Today’s sleep cards link with ?date=)', () => {
    expect(at(`/sleep/${past}`)).toBe(`/ring/sleep?date=${past}`);
    expect(at(`/sleep?date=${past}`)).toBe(`/ring/sleep?date=${past}`);
  });

  it('keeps a month (Today’s sleep history links with ?period=month&date=)', () => {
    const month = `${past.slice(0, 7)}-01`;
    expect(at(`/sleep?period=month&date=${past}`)).toBe(`/ring/sleep?period=month&date=${month}`);
  });

  it('opens today without a date, for today, or for a day still ahead', () => {
    expect(at('/sleep')).toBe('/ring/sleep');
    expect(at(`/sleep/${today}`)).toBe('/ring/sleep');
    expect(at(`/sleep?date=${addDays(today, 2)}`)).toBe('/ring/sleep');
  });
});
