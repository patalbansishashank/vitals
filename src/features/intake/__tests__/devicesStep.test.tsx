/**
 * The devices step on screen: the "how will each device's data reach Vitals" card has no "Later" key (Next always moves
 * on, with or without a ring connected), and "Use recommended" sets every stream shown to the shared ring default with
 * the Coach seeing daily + detail; there is no separate "Coach can see daily summaries" key.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '@/app/App';
import { resetBusState, resetHistory } from '@/commands';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { useProfileStore } from '@/state/profileStore';
import { setDocumentStore } from '@/state/runtime';
import { withSystemWrite } from '@/state/scope';
import { readIntake, turnsOf } from '../doc';
import { DEFAULT_CONTEXT } from '../flow';
import { saveChapter, settleIntakeSaves } from '../persist';
import { STREAM_ORDER, streamsFor } from '../chapters/devices';
import type { StreamPolicy } from '../types';

window.scrollTo = (() => undefined) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const sctx = { ...DEFAULT_CONTEXT, safety: null, now: '2026-10-02T09:00:00.000Z', stepDevice: true };
const card = () => document.querySelector<HTMLElement>('.lm-ik-card')!;
const prompt = () => within(card()).getByText((_, el) => el?.tagName === 'LEGEND').textContent;

/** The devices chapter answered up to the phone question, so the how-data-arrives card is the open one. */
async function seedRing(brand = 'J-Style ring') {
  await saveChapter('devices', { values: { has: ['ring'], models: { ring: brand }, platform: 'android', 'meta.stepDevice': true }, status: { has: 'answered', models: 'answered', platform: 'answered' } }, sctx);
  await settleIntakeSaves();
}

beforeEach(() => {
  localStorage.clear();
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' }));
  resetHistory();
  resetBusState();
  seedClearedSafety();
  withSystemWrite(() => useProfileStore.getState().resetBody());
  act(() => {
    const s = useProfileStore.getState();
    s.setSex('female');
    s.setAge(34);
    s.setHeight(162);
    s.setWeight(64);
    s.setSetup('done');
  });
});

afterEach(async () => {
  await settleIntakeSaves();
  cleanup();
});

describe('devices step: how the data arrives', () => {
  it('has no "Later" key; Next is enabled with a ring chosen and not connected, and moves on', async () => {
    await seedRing();
    renderAt('/onboarding/devices');
    await screen.findByRole('heading', { level: 1, name: 'Devices and data' });
    await waitFor(() => expect(prompt()).toBe("How will each device's data reach Vitals?"));
    expect(within(card()).queryByRole('button', { name: 'Later' })).toBeNull();
    // the card's text says where a ring is set up; nothing promises a later prompt
    expect(within(card()).getByText(/Nothing connects from here/)).toBeInTheDocument();
    expect(within(card()).getByRole('link', { name: 'Ring page' })).toHaveAttribute('href', '/ring');
    expect(within(card()).queryByRole('button', { name: /Ask me later/ })).toBeNull();
    const next = within(card()).getByRole('button', { name: /Next/ });
    expect(next).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(next);
    await waitFor(() => expect(prompt()).toBe('For each kind of data your device records, what may Vitals do with it?'));
    await settleIntakeSaves();
    expect(turnsOf(readIntake(), 'devices').status.routes).toBe('answered');
  }, 30_000);

  it('a device that is not a ring points to Settings only', async () => {
    await saveChapter('devices', { values: { has: ['scale'], models: { scale: 'Withings' }, platform: 'ios', 'meta.stepDevice': false }, status: { has: 'answered', models: 'answered', platform: 'answered' } }, { ...sctx, stepDevice: false });
    await settleIntakeSaves();
    renderAt('/onboarding/devices');
    await screen.findByRole('heading', { level: 1, name: 'Devices and data' });
    await waitFor(() => expect(prompt()).toBe("How will each device's data reach Vitals?"));
    expect(within(card()).queryByRole('link', { name: 'Ring page' })).toBeNull();
    expect(within(card()).getByRole('link', { name: 'Settings › Devices and streams' })).toHaveAttribute('href', '/settings#devices');
    expect(within(card()).getByRole('button', { name: /Next/ })).not.toHaveAttribute('aria-disabled', 'true');
  }, 30_000);
});

describe('devices step: Use recommended', () => {
  it('has no "Coach can see daily summaries" key and sets every stream to the ring default, Coach daily + detail', async () => {
    await seedRing();
    renderAt('/onboarding/devices');
    await screen.findByRole('heading', { level: 1, name: 'Devices and data' });
    await waitFor(() => expect(prompt()).toBe("How will each device's data reach Vitals?"));
    await userEvent.click(within(card()).getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(prompt()).toBe('For each kind of data your device records, what may Vitals do with it?'));
    expect(screen.queryByRole('button', { name: 'Coach can see daily summaries' })).toBeNull();
    expect(within(card()).getByText(/lets the Coach see daily summaries and detail/)).toBeInTheDocument();

    // the sharing notes sit here, folded under the choices they describe
    const howUsed = within(card()).getByRole('button', { name: /How your data is used/ });
    expect(howUsed).toHaveAttribute('aria-expanded', 'false');
    expect(within(card()).getByText(/A ring you connect through Vitals shares its data with your plan, your scores and the Coach from the start/)).not.toBeVisible();
    await userEvent.click(howUsed);
    expect(howUsed).toHaveAttribute('aria-expanded', 'true');
    expect(within(card()).getByText(/A ring you connect through Vitals shares its data with your plan, your scores and the Coach from the start/)).toBeVisible();
    expect(within(card()).getByText(/Data from files and other apps stays off until you turn it on/)).toBeVisible();
    expect(within(card()).getByText(/only when you talk to it/)).toBeVisible();

    await userEvent.click(within(card()).getByRole('button', { name: 'Use recommended' }));
    // every stream's Coach bank shows "daily + detail"
    const streams = streamsFor(['ring']);
    const banks = within(card()).getAllByRole('radiogroup', { name: /^What the Coach sees of / });
    expect(banks).toHaveLength(streams.length);
    for (const bank of banks) expect(within(bank).getByRole('radio', { name: 'daily + detail' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(within(card()).getByRole('button', { name: /^Done/ }));
    await settleIntakeSaves();
    const saved = turnsOf(readIntake(), 'devices').values.streams as StreamPolicy[];
    expect(saved.map((p) => p.stream)).toEqual(STREAM_ORDER.filter((s) => streams.includes(s)));
    expect(saved.every((p) => p.imported && p.coach === 'daily+series')).toBe(true);
    expect(saved.find((p) => p.stream === 'sleep_sessions')).toMatchObject({ scores: true, engine: true });
    expect(saved.find((p) => p.stream === 'hrv')).toMatchObject({ scores: true, engine: true });
    expect(saved.find((p) => p.stream === 'spo2')).toMatchObject({ scores: true, engine: false });
  }, 30_000);
});
