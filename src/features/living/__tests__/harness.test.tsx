import { screen } from '@testing-library/react';
import { renderLiving } from '../testing';
import { useLiving } from '../data/source';

function Probe() {
  const v = useLiving((s) => s.today('2026-10-01'), []);
  return (
    <div>
      <h1>probe</h1>
      <p>
        {v?.plan?.name} day {v?.plan?.day} of {v?.plan?.of}
      </p>
      <p>meals {v?.prescription?.meals.length}</p>
      <p>a7 {String(v?.adherence.a7 !== null)}</p>
    </div>
  );
}

describe('living harness', () => {
  it('renders a probe against the fixture plan', async () => {
    renderLiving(<Probe />);
    expect(await screen.findByText('Spring cut day 15 of 84')).toBeInTheDocument();
    expect(screen.getByText('meals 3')).toBeInTheDocument();
    expect(screen.getByText('a7 true')).toBeInTheDocument();
  });
});
