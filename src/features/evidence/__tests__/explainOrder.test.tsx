import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { EVIDENCE_TOPICS } from '@/content/evidence';
import type { Mechanism } from '@/content/evidence/schema';
import { EvidenceRepository } from '../data/repository';
import { ExplainDrawer } from '../ExplainDrawer';
import { LEADING_MECHANISMS, orderForMetric, relevance } from '../explainOrder';
import { EvidenceRepositoryContext } from '../hooks';

async function allMechanisms(): Promise<Mechanism[]> {
  const out: Mechanism[] = [];
  for (const e of EVIDENCE_TOPICS) out.push(...(await e.load()).default.mechanisms);
  return out;
}

describe('explain order (QA 11)', () => {
  it('every curated lead id exists in the content and lists its metric', async () => {
    const byId = new Map((await allMechanisms()).map((m) => [m.id, m]));
    for (const [metric, ids] of Object.entries(LEADING_MECHANISMS)) {
      for (const id of ids) {
        const m = byId.get(id);
        expect(m, `${metric} → ${id}`).toBeDefined();
        expect(m!.relatedMetricIds, `${id} lists ${metric}`).toContain(metric);
      }
    }
  });

  it('leads blood ketones with ketogenesis and puts the protein question last', async () => {
    const list = (await allMechanisms()).filter((m) => m.relatedMetricIds.includes('bhb')).map((mechanism) => ({ mechanism }));
    const ordered = orderForMetric('bhb', list).map((r) => r.mechanism.id);
    expect(ordered[0]).toBe('05-hepatic-ketogenesis');
    const protein = ordered.indexOf('03-protein-and-ketosis');
    expect(protein).toBeGreaterThan(ordered.indexOf('05-exercise-and-ketones'));
    expect(protein).toBeGreaterThanOrEqual(ordered.length - 4);
  });

  it('ranks own-dossier and on-topic mechanisms above myths and moderators without a curated list', () => {
    const own = { id: '06-marker-dynamics-x', title: 'How LDL moves', status: 'proposed-fit' as const };
    const myth = { id: '06-does-it', title: 'Does fat raise LDL?', status: 'contested' as const };
    const moderator = { id: '16-individual-variability', title: 'People differ', status: 'proposed-fit' as const };
    expect(relevance('hdl', own)).toBeGreaterThan(relevance('hdl', myth));
    expect(relevance('hdl', own)).toBeGreaterThan(relevance('hdl', moderator));
  });
});

describe('ExplainDrawer reading', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <MemoryRouter>
        <EvidenceRepositoryContext.Provider value={new EvidenceRepository(EVIDENCE_TOPICS)}>
          <button type="button" onClick={() => setOpen(true)}>
            Explain
          </button>
          <ExplainDrawer
            open={open}
            onClose={() => setOpen(false)}
            metricId="bhb"
            reading={{ when: 'Tue 14 Oct 06:00', value: '1.42', unit: 'mmol/L', range: '0.95–2.10', note: 'Follows the crosshair.' }}
            drivers={[
              { label: 'net carbohydrate, last 24 h', value: '22', unit: 'g' },
              { label: 'fast', value: 'yes', note: '· hour 30 of a 72 h fast' },
            ]}
          />
        </EvidenceRepositoryContext.Provider>
      </MemoryRouter>
    );
  }

  it('shows the value at the crosshair, its range and what drives it, then the lead mechanism open', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Explain' }));
    const dialog = await screen.findByRole('dialog', { name: 'Blood ketones (BHB)' });
    const reading = within(dialog).getByRole('region', { name: 'Value at this point' });
    expect(within(reading).getByText('1.42')).toBeInTheDocument();
    expect(within(reading).getByText(/likely 0\.95–2\.10/)).toBeInTheDocument();
    expect(within(reading).getByText('net carbohydrate, last 24 h')).toBeInTheDocument();
    expect(within(reading).getByText(/hour 30 of a 72 h fast/)).toBeInTheDocument();
    const first = await within(dialog).findByRole('heading', { name: 'How the liver decides to make ketones', level: 3 });
    expect(first.closest('details')).toHaveAttribute('open');
    // the long tail sits behind a key
    expect(within(dialog).getByRole('button', { name: /Show \d+ more mechanisms/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: 'Does protein knock you out of ketosis?' })).toBeNull();
  });
});
