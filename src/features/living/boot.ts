/**
 * Imported first by every Living screen (lazy chunks): installs the data source and actions and loads the screens'
 * stylesheet. Kept out of `routes.tsx` so the engine and the command bus never enter the main chunk.
 *
 * Mode, reads and writes switch together: when the app reads the live plan from the plan documents
 * (`installDocumentPlanSource`, App.tsx), the screens read the same documents (`./data/documents`) and write through
 * the commands (`./data/commands`); otherwise (tests and demos that mount routes on the in-memory plan) the in-memory
 * stand-in serves both sides.
 */
import './living.css';
import { installDefaultLiving, installLiving } from './data';
import { createCommandLivingActions } from './data/commands';
import { createDocumentLivingSource } from './data/documents';
import { usesDocumentPlan } from './mode';
import { setCorrectionDeviceLookup } from '@/ai/coach/cards';
import { deviceValueFor } from './data/useDeviceOwnership';

// Coach proposals to correct a reading say what the device recorded
setCorrectionDeviceLookup((kind, date) => deviceValueFor(kind, date));

let installed: 'documents' | 'stub' | null = null;

/** Install the Living data for the current plan source (idempotent; re-run when the plan source changed). */
export function bootLiving(): void {
  const want = usesDocumentPlan() ? 'documents' : 'stub';
  if (installed === want) return;
  installed = want;
  if (want === 'stub') {
    installDefaultLiving();
    return;
  }
  const source = createDocumentLivingSource();
  installLiving(source, createCommandLivingActions(source));
}

bootLiving();
