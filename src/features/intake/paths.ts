/** Intake routes (SUITE_SPEC §6.2 `/onboarding/:section`; design §2). */
import type { IntakeSectionId } from './types';

export type IntakeFrom = 'setup' | 'body';
export type IntakeRouteSection = IntakeSectionId | 'summary';

export const INTAKE_SECTIONS: readonly IntakeRouteSection[] = ['activity', 'training', 'diet', 'kitchen', 'supplements', 'markers', 'devices', 'summary'];

export const intakePath = (section: IntakeRouteSection, opts: { from?: IntakeFrom; anchor?: string } = {}): string =>
  `/onboarding/${section}${opts.from ? `?from=${opts.from}` : ''}${opts.anchor ? `#${opts.anchor}` : ''}`;

export const isIntakeSection = (s: string | undefined): s is IntakeRouteSection => (INTAKE_SECTIONS as readonly string[]).includes(s ?? '');
