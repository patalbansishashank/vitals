/**
 * Basics on Your body (r071): five summary rows with "Edit" on a phone or tablet in normal mode, the inline form (the
 * figure beside it follows the steppers) on a desktop and in first-run setup. jsdom has no matchMedia, so the window is
 * stood in for here; without it the page keeps the inline form.
 */
import { act, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { freshState } from '@/commands/__tests__/harness';
import { sendCommand } from '@/features/lib/sendCommand';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { flushBodyPersistence, useProfileStore } from '@/state/profileStore';

vi.setConfig({ testTimeout: 40_000 });
configure({ asyncUtilTimeout: 15_000 });

window.scrollTo = (() => undefined) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

const original = window.matchMedia;
/** A window `px` wide: min-width queries up to that width match, max-width queries from it down. */
function windowWidth(px: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*([\d.]+)rem/.exec(query);
    const max = /max-width:\s*([\d.]+)rem/.exec(query);
    const matches = min ? Number(min[1]) * 16 <= px : max ? px <= Number(max[1]) * 16 : false;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

const store = () => useProfileStore.getState();
const basics = () => document.getElementById('body-basics')!;

function seedBody() {
  act(() => {
    store().resetBody();
    store().setSex('male');
    store().setAge(36);
    store().setHeight(178);
    store().setWeight(84.9);
    store().setSetup('done');
  });
}

beforeEach(() => {
  freshState();
  seedClearedSafety();
  seedBody();
});

afterEach(() => {
  window.matchMedia = original;
  flushBodyPersistence();
});

const open = async (path = '/body') => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

describe('Basics on a phone, normal mode', () => {
  it('is five rows, a foot link and an (i); the form waits in a panel', async () => {
    windowWidth(390);
    await open();
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const rows = Array.from(basics().querySelectorAll('.lm-body-kv > div')).map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toHaveLength(5);
    expect(rows.join('|')).toMatch(/Male/);
    expect(rows.join('|')).toMatch(/36 yrs/);
    expect(rows.join('|')).toMatch(/178\s?cm/);
    expect(rows.join('|')).toMatch(/84\.9\s?kg/);
    expect(rows.join('|')).toMatch(/Metric/);
    // nothing to type until Edit
    expect(within(basics()).queryByRole('spinbutton')).toBeNull();
    expect(within(basics()).getByRole('button', { name: 'About Basics' })).toBeInTheDocument();
    expect(within(basics()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('opens the same form in a panel, and a change there moves the row', async () => {
    windowWidth(390);
    await open();
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    await userEvent.click(within(basics()).getByRole('button', { name: 'Edit' }));
    const panel = await screen.findByRole('dialog', { name: 'Basics' });
    expect(within(panel).getByRole('radiogroup', { name: 'Units' })).toBeInTheDocument();
    expect(within(panel).getByRole('radiogroup', { name: 'Sex' })).toBeInTheDocument();
    for (const name of ['Age', 'Height', 'Weight']) expect(within(panel).getByRole('spinbutton', { name })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('radio', { name: 'Imperial' }));
    const kv = () => basics().querySelector<HTMLElement>('.lm-body-kv')!;
    await waitFor(() => expect(within(kv()).getByText('Imperial')).toBeInTheDocument());
    // 178 cm is 5 ft 10 in, 84.9 kg is 187.2 lb
    expect(kv().textContent).toMatch(/5\s?ft 10\s?in/);
    expect(kv().textContent).toMatch(/187\.2\s?lb/);
  });

  it('the whole card opens the editor through its title, with a name that says so', async () => {
    windowWidth(390);
    await open();
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    await userEvent.click(within(basics()).getByRole('button', { name: 'Edit basics' }));
    expect(await screen.findByRole('dialog', { name: 'Basics' })).toBeInTheDocument();
  });

  it('quiet: the weight row says it is set and never what it is; the editor still holds the input', async () => {
    windowWidth(390);
    await act(async () => {
      await sendCommand('settings.update', { patch: { quietMode: true } });
    });
    await open();
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const kv = basics().querySelector('.lm-body-kv')!;
    expect(kv.textContent).toContain('Set');
    expect(kv.textContent).not.toMatch(/84\.9|187/);
    await userEvent.click(within(basics()).getByRole('button', { name: 'Edit' }));
    const panel = await screen.findByRole('dialog', { name: 'Basics' });
    expect(within(panel).getByRole('spinbutton', { name: 'Weight' })).toHaveValue('84.9');
  });

  it('without a weight the row says Not set under quiet, and shows the typical value with its word otherwise', async () => {
    windowWidth(390);
    act(() => {
      store().resetBody();
      store().setSex('female');
      store().setSetup('done');
    });
    await open();
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const kv = basics().querySelector('.lm-body-kv')!;
    expect(kv.textContent).toMatch(/Typical/i);
    expect(kv.querySelectorAll('.lm-body-typical').length).toBeGreaterThanOrEqual(3);
  });
});

describe('Basics on a desktop and in first-run setup', () => {
  it('keeps the inline form at 1440 px: the steppers are on the page, no Edit link', async () => {
    windowWidth(1440);
    await open();
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    for (const name of ['Age', 'Height', 'Weight']) expect(within(basics()).getByRole('spinbutton', { name })).toBeInTheDocument();
    expect(within(basics()).getByRole('radiogroup', { name: 'Units' })).toBeInTheDocument();
    expect(within(basics()).queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('keeps the inline form on a phone in the first-run basics step', async () => {
    windowWidth(390);
    act(() => store().resetBody());
    await open('/body?setup=basics');
    await screen.findByRole('list', { name: 'Setup progress' });
    for (const name of ['Age', 'Height', 'Weight']) expect(within(basics()).getByRole('spinbutton', { name })).toBeInTheDocument();
    expect(basics().querySelector('.lm-body-kv')).toBeNull();
  });
});
