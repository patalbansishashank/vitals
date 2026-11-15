/** Explanations shared by the Activity overview, day and period cards. */
import type { ReactNode } from 'react';
import { formatEnergy, formatNumber, type InfoSpec } from '@/components';
import type { RingDay } from '../day';
import { distanceParts } from '../model';

const RING_ENERGY = 'Ring energy';
const RING_ENERGY_TEXT = 'The ring’s own estimate, not the total Vitals books. The Energy page shows the model’s total and its components.';

export function movementFacts(day: RingDay, units: Parameters<typeof distanceParts>[1], energyUnit: Parameters<typeof formatEnergy>[1]): NonNullable<InfoSpec['terms']> {
  const a = day.daily?.activity;
  const distance = a?.distanceM != null ? distanceParts(a.distanceM, units) : null;
  return [
    ...(distance ? [{ term: 'Distance', text: `${distance.value} ${distance.unit}${a?.distanceSource === 'healthConnect' ? ' · Health Connect' : ' · Ring'}` }] : []),
    ...(a?.activeMinutes != null ? [{ term: 'Active time', text: `${formatNumber(a.activeMinutes, 0)} min · Ring` }] : []),
    ...(a?.caloriesKcal != null ? [{ term: RING_ENERGY, text: `~${formatEnergy(a.caloriesKcal, energyUnit)}` }] : []),
  ];
}

export function movementInfo(quiet: boolean, footer?: ReactNode, twin?: ReactNode, facts: InfoSpec['terms'] = []): InfoSpec {
  // the ring's energy is one term: its reading when there is one (the body says what it is), else what it is
  const shown = !quiet ? (facts ?? []) : [];
  const energy = shown.some((f) => f.term === RING_ENERGY);
  return {
    title: 'Steps, distance and energy',
    body: quiet
      ? 'Steps come from your ring and phone, using one source per period. Your goal comes from your plan, then your ring, then the default. Distance and active time are the ring’s. Its energy estimate can differ from the Energy page.'
      : 'Steps come from your ring and phone, using one source per period. Your goal comes from your plan, then your ring, else 10 000 steps. Distance and active time are the ring’s. Ring energy is its own estimate and can differ from the Energy page.',
    source: { kind: 'ring', words: 'Ring and phone' },
    evidence: { to: '/evidence/10-steps-and-health', label: 'Steps and health' },
    terms: [
      ...shown,
      ...(energy ? [] : [{ term: RING_ENERGY, text: RING_ENERGY_TEXT }]),
      {
        term: 'Steps through the day',
        text: 'Each bar covers fifteen minutes of counted steps. A gap means no source covered that period. Activity bands show when activities took place.',
      },
    ],
    footer,
    twin,
  };
}

export const workoutsInfo: InfoSpec = {
  title: 'Activities',
  body: 'Activities counted in your day include recorded sessions, detected activities and ones you logged. Possible activities are not counted until you add them. Duration and energy follow the counted activity.',
  source: { kind: 'engine', words: 'Counted activities' },
  terms: [
    {
      term: 'Automatic detection',
      text: 'Automatic detection uses supported movement and heart-rate evidence. Sessions with few steps, including air-bike and dumbbell sessions, may be missed. Log a session if it is missing.',
    },
  ],
};
