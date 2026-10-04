/** `markers.*` through the command bus on an in-memory store (E20, SUITE_SPEC §13.5.6). */
import { bodyOf } from '@/store';
import { createMemoryBlobStore, getBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import type { MarkerExtraction, MarkersDoc, MarkersView } from '@/markers/types';
import { dispatch, getCommand, jobs, manifest, settleCommits, type CommandResult } from '@/commands';
import { AI, freshState } from '@/commands/__tests__/harness';
import { clearPendingExtractions, setMarkerExtractor, type ExtractFn } from '..';

const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};
const errOf = (r: CommandResult) => (r.ok ? null : r.error);

const stored = (): MarkersDoc | null => {
  const d = getDocumentStore().peek<MarkersDoc>('markers', 'me');
  return d ? (bodyOf(d) as unknown as MarkersDoc) : null;
};
const labEntries = () =>
  getDocumentStore()
    .peekAll<Record<string, unknown>>('measurements')
    .map((d) => ({ ...bodyOf(d), id: d._id }) as Record<string, unknown>)
    .filter((e) => String(e.metric).startsWith('lab:'));

const EXTRACTION: MarkerExtraction & { pages: number } = {
  pages: 1,
  extractionId: '01JEXTRACTION0000000000001',
  route: 'textLayer',
  sampleDate: '2026-09-12',
  rows: [
    { row: 0, markerId: 'ldl', nameOnReport: 'LDL Cholesterol, Direct', value: 162, unit: 'mg/dL', labRange: '< 100', method: 'direct', calculated: false, confidence: 0.97, issues: [] },
    { row: 1, markerId: 'hdl', nameOnReport: 'HDL Cholesterol', value: 38, unit: 'mg/dL', labRange: '40 - 60', calculated: false, confidence: 0.95, issues: [] },
    { row: 2, markerId: 'hba1c', nameOnReport: 'HbA1c', value: 59, unit: 'mmol/mol', calculated: false, confidence: 0.6, issues: ['value unclear'] },
    { row: 3, markerId: null, nameOnReport: 'Mystery', value: 1, unit: 'x', calculated: false, confidence: 0.3, issues: [] },
  ],
  displayOnly: [{ name: 'MCV', value: '88', unit: 'fL', range: '80 - 100', date: '2026-09-12' }],
  notInReport: ['apoB'],
};

let calls: Array<Parameters<ExtractFn>> = [];

beforeEach(async () => {
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  clearPendingExtractions();
  calls = [];
  setMarkerExtractor(async (input, deps) => {
    calls.push([input, deps]);
    return structuredClone(EXTRACTION);
  });
  await (await getBlobStore()).put(new TextEncoder().encode('%PDF-1.4 fake report'), { purpose: 'photo', aadId: 'report-1' });
});
afterAll(() => setMarkerExtractor(null));

async function importReport(actor = undefined as typeof AI | undefined): Promise<MarkerExtraction> {
  const r = await dispatch('markers.import', { attachmentId: 'report-1' }, actor ? { actor, idempotencyKey: `${actor.conversationId}:imp` } : {});
  if (!r.ok || !('job' in r)) throw new Error(JSON.stringify(r));
  const st = await jobs.wait(r.job.jobId);
  expect(st.state).toBe('done');
  return jobs.result(r.job.jobId) as MarkerExtraction;
}

describe('registry', () => {
  it('declares the five commands with their classes and surfaces', () => {
    const c = (id: string) => getCommand(id)!;
    expect([c('markers.get').perm, c('markers.set').perm, c('markers.set').impact]).toEqual(['read', 'write', 'consequential']);
    expect([c('markers.import').impact, c('markers.import').longRunning?.kind]).toEqual(['low', 'job']);
    expect([c('markers.confirm').impact, c('markers.confirm').surfaces]).toEqual(['consequential', ['ui']]);
    expect(c('markers.remove').impact).toBe('low');
    const ai = manifest('ai').map((t) => t.commandId);
    expect(ai).toEqual(expect.arrayContaining(['markers.get', 'markers.set', 'markers.import', 'markers.remove']));
    expect(ai).not.toContain('markers.confirm');
  });
});

describe('markers.set', () => {
  it('saves typed readings as manual and confirmed, with history entries in canonical units', async () => {
    const v = out<MarkersView>(await dispatch('markers.set', { readings: [{ id: 'ldl', value: 162, unit: 'mg/dL', date: '2026-09-12', fasting: true }, { id: 'hba1c', value: 5.9, unit: '%', date: '2026-09-12' }] }));
    await settleCommits();
    const doc = stored()!;
    expect(doc.chapter).toBe('manual');
    const ldl = doc.readings.find((r) => r.id === 'ldl')!;
    expect(ldl).toMatchObject({ value: 162, unit: 'mg/dL', unitCanonical: 'mmol/L', provenance: 'manual', confirmed: true, fasting: true });
    expect(ldl.valueCanonical).toBeCloseTo(4.19, 2);
    expect(v.current.map((s) => s.markerId).sort()).toEqual(['hba1c', 'ldl']);
    const h = labEntries();
    expect(h.map((e) => e.metric).sort()).toEqual(['lab:hba1c', 'lab:ldl']);
    expect(h.find((e) => e.metric === 'lab:ldl')).toMatchObject({ date: '2026-09-12', value: ldl.valueCanonical, method: 'lab' });
  });

  it('a second value for the same marker and date replaces the first (history supersedes)', async () => {
    await dispatch('markers.set', { readings: [{ id: 'ldl', value: 162, unit: 'mg/dL', date: '2026-09-12' }] });
    await settleCommits();
    await dispatch('markers.set', { readings: [{ id: 'ldl', value: 4.0, unit: 'mmol/L', date: '2026-09-12' }] });
    await settleCommits();
    expect(stored()!.readings.filter((r) => r.id === 'ldl').map((r) => r.value)).toEqual([4.0]);
    const h = labEntries();
    expect(h).toHaveLength(2);
    expect(h.some((e) => typeof e.supersedes === 'string')).toBe(true);
  });

  it('refuses a unit outside the table and saves nothing', async () => {
    const e = errOf(await dispatch('markers.set', { readings: [{ id: 'ldl', value: 3, unit: 'g/L', date: '2026-09-12' }] }));
    expect(e).toMatchObject({ code: 'invalid_input', detail: { path: '/readings/0/unit' } });
    expect(e!.message).toMatch(/unit not recognised/);
    await settleCommits();
    expect(stored()).toBeNull();
  });

  it('refuses implausible values (block bounds) and future dates; soft bounds pass with a notice', async () => {
    expect(errOf(await dispatch('markers.set', { readings: [{ id: 'ldl', value: 5000, unit: 'mg/dL', date: '2026-09-12' }] }))).toMatchObject({ code: 'invalid_input', detail: { path: '/readings/0/value' } });
    expect(errOf(await dispatch('markers.set', { readings: [{ id: 'ldl', value: 120, unit: 'mg/dL', date: '2099-01-01' }] }))).toMatchObject({ code: 'invalid_input', detail: { path: '/readings/0/date' } });
    const soft = await dispatch('markers.set', { readings: [{ id: 'ldl', value: 400, unit: 'mg/dL', date: '2026-09-12' }] });
    expect(soft.ok).toBe(true);
    expect(soft.ok && soft.notices.some((n) => n.level === 'caution')).toBe(true);
  });

  it('records the chapter answer and the sample context without readings', async () => {
    out(await dispatch('markers.set', { readings: [], chapter: 'skipped', context: { creatineLast2w: true } }));
    await settleCommits();
    expect(stored()).toMatchObject({ chapter: 'skipped', context: { creatineLast2w: true }, readings: [] });
    out(await dispatch('markers.set', { readings: [], context: { ppi: true } }));
    await settleCommits();
    expect(stored()!.context).toEqual({ creatineLast2w: true, ppi: true });
  });

  it('skipping the chapter after saving readings keeps them (Q3-J1-05: skip never deletes data)', async () => {
    out(await dispatch('markers.set', { readings: [{ id: 'ldl', value: 162, unit: 'mg/dL', date: '2026-09-12' }] }));
    await settleCommits();
    out(await dispatch('markers.set', { readings: [], chapter: 'skipped' }));
    await settleCommits();
    expect(stored()!.chapter).toBe('skipped');
    expect(stored()!.readings).toEqual([expect.objectContaining({ id: 'ldl', value: 162, unit: 'mg/dL', date: '2026-09-12' })]);
  });

  it('from the Coach is staged as a proposal; nothing changes until the person applies it', async () => {
    const r = await dispatch('markers.set', { readings: [{ id: 'ldl', value: 162, unit: 'mg/dL', date: '2026-09-12' }] }, { actor: AI, idempotencyKey: `${AI.conversationId}:set` });
    expect(r.ok && 'pending' in r).toBe(true);
    await settleCommits();
    expect(stored()).toBeNull();
    const pendingId = r.ok && 'pending' in r ? r.pending.pendingId : '';
    expect((await dispatch('coach.applyPending', { pendingId })).ok).toBe(true);
    await settleCommits();
    expect(stored()!.readings.map((x) => x.id)).toEqual(['ldl']);
  });
});

describe('markers.get', () => {
  it('reads the document (Body page lab values migrated in before the first save)', async () => {
    const v = out<MarkersView>(await dispatch('markers.get', {}));
    expect(v.doc).toMatchObject({ _schema: 1, readings: [], chapter: null });
    await dispatch('markers.set', { readings: [{ id: 'tg', value: 150, unit: 'mg/dL', date: '2026-09-01' }] });
    await settleCommits();
    const v2 = out<MarkersView>(await dispatch('markers.get', {}, { actor: AI }));
    expect(v2.current[0]).toMatchObject({ markerId: 'tg', stale: false });
  });
});

describe('markers.remove', () => {
  it('removes one reading and retracts its history entry', async () => {
    await dispatch('markers.set', { readings: [{ id: 'ldl', value: 162, unit: 'mg/dL', date: '2026-03-01' }, { id: 'ldl', value: 140, unit: 'mg/dL', date: '2026-09-12' }] });
    await settleCommits();
    const v = out<MarkersView>(await dispatch('markers.remove', { markerId: 'ldl', date: '2026-09-12' }));
    await settleCommits();
    expect(stored()!.readings.map((r) => r.date)).toEqual(['2026-03-01']);
    expect(v.current[0]!.reading.date).toBe('2026-03-01');
    expect(labEntries().filter((e) => e.kind === 'retract')).toHaveLength(1);
    expect(errOf(await dispatch('markers.remove', { markerId: 'ldl', date: '2026-09-12' }))).toMatchObject({ code: 'not_found' });
  });
});

describe('markers.import → markers.confirm', () => {
  it('reads the attachment as a job and saves nothing until confirm', async () => {
    const ex = await importReport();
    expect(ex.rows).toHaveLength(4);
    expect(calls[0]![0].mime).toBe('application/pdf');
    expect(calls[0]![1].allowVision).toBe(false);
    await settleCommits();
    expect(stored()).toBeNull();
  });

  it('saves only the accepted rows, with provenance, confidence, attachment, display-only rows and context', async () => {
    const ex = await importReport();
    const v = out<MarkersView>(
      await dispatch('markers.confirm', {
        extractionId: ex.extractionId,
        accept: [
          { row: 0, date: '2026-09-12' },
          { row: 2, value: 7.5, unit: '%', date: '2026-09-12' },
        ],
        context: { recentIllness: false },
      }),
    );
    await settleCommits();
    const doc = stored()!;
    expect(doc.readings.map((r) => r.id).sort()).toEqual(['hba1c', 'ldl']);
    expect(doc.readings.find((r) => r.id === 'ldl')).toMatchObject({ provenance: 'pdf', confirmed: true, confidence: 0.97, attachmentId: 'report-1', method: 'direct', labRange: { high: 100, unit: 'mg/dL' } });
    expect(doc.readings.find((r) => r.id === 'hba1c')).toMatchObject({ value: 7.5, unit: '%' });
    expect(doc.displayOnly).toEqual(EXTRACTION.displayOnly);
    expect(doc.context).toEqual({ recentIllness: false });
    expect(doc.chapter).toBe('report');
    expect(v.current).toHaveLength(2);
    expect(labEntries()).toHaveLength(2);
    // a replay does not save twice
    out(await dispatch('markers.confirm', { extractionId: ex.extractionId, accept: [{ row: 1, date: '2026-09-12' }] }));
    await settleCommits();
    expect(stored()!.readings).toHaveLength(2);
  });

  it('refuses unmatched rows without a marker, unknown rows and units outside the table', async () => {
    const ex = await importReport();
    expect(errOf(await dispatch('markers.confirm', { extractionId: ex.extractionId, accept: [{ row: 3, date: '2026-09-12' }] }))).toMatchObject({ code: 'invalid_input', detail: { path: '/accept/0/markerId' } });
    expect(errOf(await dispatch('markers.confirm', { extractionId: ex.extractionId, accept: [{ row: 9, date: '2026-09-12' }] }))).toMatchObject({ code: 'invalid_input' });
    const e = errOf(await dispatch('markers.confirm', { extractionId: ex.extractionId, accept: [{ row: 3, markerId: 'tsh', date: '2026-09-12' }] }));
    expect(e?.message).toMatch(/unit not recognised/);
    expect(errOf(await dispatch('markers.confirm', { extractionId: 'nope', accept: [] }))).toMatchObject({ code: 'not_found' });
  });

  it('the Coach may import (vision allowed by default) but never confirm', async () => {
    const ex = await importReport(AI);
    expect(calls[0]![1].allowVision).toBe(false); // no vision port installed: never sent
    const r = await dispatch('markers.confirm', { extractionId: ex.extractionId, accept: [{ row: 0, date: '2026-09-12' }] }, { actor: AI, idempotencyKey: `${AI.conversationId}:c` });
    expect(errOf(r)).toMatchObject({ code: 'surface_forbidden' });
    // the person confirms an import the Coach started: provenance coach
    out(await dispatch('markers.confirm', { extractionId: ex.extractionId, accept: [{ row: 0, date: '2026-09-12' }] }));
    await settleCommits();
    expect(stored()!.readings[0]!.provenance).toBe('coach');
  });

  it('refuses a missing attachment and a file that is not a report', async () => {
    const r = await dispatch('markers.import', { attachmentId: 'missing' });
    expect(errOf(r)).toMatchObject({ code: 'not_found' });
    await (await getBlobStore()).put(new TextEncoder().encode('hello'), { purpose: 'photo', aadId: 'txt' });
    expect(errOf(await dispatch('markers.import', { attachmentId: 'txt' }))).toMatchObject({ code: 'invalid_input' });
  });
});
