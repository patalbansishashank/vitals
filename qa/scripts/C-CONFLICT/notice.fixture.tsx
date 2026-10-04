/** Synthetic, isolated browser fixture for the real conflict notice and CommandBus resolution. */
import '@/styles/index.css';
import '@/features/living/living.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Faceplate, Toaster } from '@/components';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { createCommandLivingActions } from '@/features/living/data/commands';
import { createDocumentLivingSource } from '@/features/living/data/documents';
import { LivingActionsProvider } from '@/features/living/data/actions';
import { LogConflict } from '@/features/living/components/LogConflict';
import { seedPlanDocs } from '@/features/living/__tests__/seedPlanDocs';
import { currentDay, systemClock } from '@/features/living/clock';
import { addDays, type LogEntry } from '@/living';
import { getDocumentStore } from '@/state/runtime';

const date = currentDay(systemClock);
const first = freshState({ cleared: true }).backend;
await seedPlanDocs({ startDate: addDays(date, -1), days: 3 });
const originalResult = await dispatch('log.meal', {
  date, slot: 'meal2', method: 'label', clockH: 12,
  components: [{ name: 'Rice and lentils', grams: 100, labelPer100g: { energyKcal: 420, proteinG: 21, carbG: 48, fatG: 13, fibreG: 5 } }],
});
if (!originalResult.ok || !('output' in originalResult)) throw new Error('Meal setup failed');
const original = (originalResult.output as { entryId: string }).entryId;
await settleCommits();
const baseline = (await Promise.all(['plans', 'planVersions', 'activePlan', 'dailyLogs'].map((col) => first.list(col)))).flat();
const firstEdit = await dispatch('log.edit', { entryId: original, patch: { clockH: 13 } });
if (!firstEdit.ok) throw new Error('First edit failed');
await settleCommits();
const firstRows = await first.list<Omit<LogEntry, 'id'>>('dailyLogs');
const second = freshState({ cleared: true }).backend;
await getDocumentStore().ready;
for (const row of baseline) second.remote(row);
await new Promise((resolve) => setTimeout(resolve, 0));
const secondEdit = await dispatch('log.edit', { entryId: original, patch: { clockH: 14 } });
if (!secondEdit.ok) throw new Error('Second edit failed');
await settleCommits();
for (const row of firstRows) second.remote(row);
await new Promise((resolve) => setTimeout(resolve, 0));

const source = createDocumentLivingSource();
const actions = createCommandLivingActions(source);
function Fixture() {
  const [revision, setRevision] = useState(0);
  useEffect(() => source.subscribe(() => setRevision((value) => value + 1)), []);
  const conflict = source.history(date, date)[0]?.conflicts?.[0];
  const wrapped = {
    ...actions,
    retract: async (entryId: string, keepEntryId?: string) => {
      const result = await actions.retract(entryId, keepEntryId);
      await settleCommits();
      setRevision((value) => value + 1);
      return result;
    },
  };
  return (
    <LivingActionsProvider value={wrapped}>
      <main data-revision={revision} style={{ maxWidth: 960, margin: '64px auto', padding: '0 16px' }}>
        <p style={{ fontSize: 14 }}>Progress / Log</p>
        <Faceplate title="Today’s log" className="lv-prog-face">
          {conflict ? <LogConflict conflict={conflict} /> : <p role="status">One chosen meal remains.</p>}
        </Faceplate>
      </main>
      <Toaster />
    </LivingActionsProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
