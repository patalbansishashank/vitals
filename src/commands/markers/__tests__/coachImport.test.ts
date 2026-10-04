/**
 * The Coach reads a blood test report (E20, SUITE_SPEC §13.5.6): the person attaches a file → the model calls
 * `markers_import` → the review card → the person applies it (`markers.confirm`, as themselves) → the `markers` document.
 * Real command bus and document store; scripted provider (fake fetch). The provider never receives patient details.
 * (Lives with the commands: `src/ai` may not import the state layer the store setup needs.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bodyOf } from '@/store';
import { createMemoryBlobStore, getBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { allCommands, buildManifest, dispatch, getCommand, on, settleCommits } from '@/commands';
import { installAiPorts } from '@/commands/aiPorts';
import { freshState } from '@/commands/__tests__/harness';
import { clearPendingExtractions, setMarkerExtractor } from '@/commands/markers';
import { extractFromFile } from '@/markers/extract';
import { extractTextItems, loadPdfjsLegacy } from '@/markers/extract/pdf';
import type { MarkersDoc } from '@/markers/types';
import { createChatModel, getPreset, presetCapabilities, type Capabilities } from '@/ai/providers';
import { fakeFetch, instantSleep, sse, type FakeReply } from '@/ai/testing/fakeFetch';
import { createCoachAdapter } from '@/ai/coach/adapter';
import { createMarkerVisionPort } from '@/ai/coach/markers';
import type { CoachBus } from '@/ai/coach/tools';
import type { CardView, StreamEventView } from '@/ai/coach/types';

const DIR = join(import.meta.dirname, '../../../../qa/fixtures/markers');
const fixture = (name: string) => new Uint8Array(readFileSync(join(DIR, name)));
const expected = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8')) as { sampleDate: string; patient: Record<string, string> };

const bus: CoachBus = {
  dispatch: (id, input, opts) => dispatch(id, input, opts),
  manifest: () => buildManifest('ai'),
  getCommand: (id) => getCommand(id),
  commandIds: () => allCommands().map((d) => d.id),
  on: (l) => on(l),
};

const toolTurn = (name: string, args: unknown): FakeReply => ({
  text: sse(
    { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-imp', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    'data: [DONE]\n\n',
  ),
});
const textTurn = (t: string): FakeReply => ({ text: sse({ choices: [{ index: 0, delta: { content: t }, finish_reason: 'stop' }] }, 'data: [DONE]\n\n') });
const jsonTurn = (o: unknown): FakeReply => textTurn(JSON.stringify(o));

let lastFF: ReturnType<typeof fakeFetch> | null = null;
function coach(replies: FakeReply[], caps: Partial<Capabilities>) {
  const ff = fakeFetch(replies);
  lastFF = ff;
  const preset = getPreset('openrouter')!;
  const model = createChatModel({ preset, model: 'anthropic/claude-sonnet-5.5', apiKey: 'test-key', capabilities: { ...presetCapabilities(preset), tools: true, vision: false, ...caps }, deps: { fetch: ff.fetch, sleep: instantSleep().sleep, random: () => 0 } });
  if (caps.vision) installAiPorts({ markerVision: createMarkerVisionPort(model) });
  let n = 0;
  const adapter = createCoachAdapter({
    bus,
    model,
    provider: { name: 'OpenRouter', model: 'Claude' },
    newId: () => `n${++n}`,
    sleep: async () => undefined,
    putPhoto: async (file) => {
      const { chunkId } = await (await getBlobStore()).put(new Uint8Array(await file.arrayBuffer()), { purpose: 'photo', aadId: 'report-att-1' });
      return { attachmentId: chunkId, url: 'blob:thumb' };
    },
  });
  return { ff, adapter };
}

async function sendFile(adapter: ReturnType<typeof coach>['adapter'], file: File): Promise<CardView> {
  const events: StreamEventView[] = [];
  await adapter.send({ conversationId: 'coach', text: 'Here is my blood test report', photo: file }, (e) => events.push(e), new AbortController().signal);
  const card = events.flatMap((e) => (e.type === 'card' ? [e.card] : []))[0];
  if (!card) throw new Error(JSON.stringify(events) + JSON.stringify((lastFF?.requests[1]?.body as { messages: Array<{ role: string }> } | undefined)?.messages.filter((m) => m.role === 'tool')));
  return card;
}

const stored = (): MarkersDoc | null => {
  const d = getDocumentStore().peek<MarkersDoc>('markers', 'me');
  return d ? (bodyOf(d) as unknown as MarkersDoc) : null;
};

/** Every string of the patient block, as printed on the synthetic report. */
const leaks = (body: string, patient: Record<string, string>) => Object.values(patient).filter((v) => v && body.includes(v));

beforeEach(() => {
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  clearPendingExtractions();
  installAiPorts({});
});
afterAll(() => {
  setMarkerExtractor(null);
  installAiPorts({});
});

describe('Coach: markers_import', () => {
  it('a PDF report: tool call → review card → the person applies → saved; nothing about the patient is sent', async () => {
    setMarkerExtractor((input, deps) => extractFromFile(input, { ...deps, textItems: (b, o) => extractTextItems(b, { ...o, load: loadPdfjsLegacy }) }));
    const exp = expected('srl-style.expected.json');
    const { ff, adapter } = coach([toolTurn('markers_import', { attachmentId: 'report-att-1' }), textTurn('Your report is read; check the table below.')], { vision: false });
    const card = await sendFile(adapter, new File([fixture('srl-style.pdf')], 'srl-style.pdf', { type: 'application/pdf' }));

    expect(card).toMatchObject({ class: 'log', state: 'pending', title: 'Blood test report · not saved yet' });
    expect(card.markers?.sampleDate).toBe(exp.sampleDate);
    expect(card.markers!.rows.length).toBeGreaterThan(5);
    expect(card.items.some((i) => /mg\/dL/.test(i.after ?? ''))).toBe(true);
    expect(card.note).toMatch(/Nothing is saved until you confirm/);
    await settleCommits();
    expect(stored()).toBeNull();

    // the model never sees the file or the patient block; it may only render the card
    const bodies = ff.requests.map((r) => JSON.stringify(r.body));
    expect(bodies.flatMap((b) => leaks(b, exp.patient))).toEqual([]);
    expect(bodies.join('\n')).not.toContain('srl-style.pdf');
    expect((await dispatch('markers.confirm', { extractionId: card.markers!.extractionId, accept: [] }, { actor: { kind: 'ai', id: 't', conversationId: 'c', toolCallId: 'x' }, idempotencyKey: 'c:x' })).ok).toBe(false);

    // the person applies: the confident rows with the sample date (or the rows the review table passes)
    const creatinine = card.markers!.rows.find((r) => r.markerId === 'creatinine')!;
    const r = await adapter.act(card.id, 'apply', { markers: { accept: [{ row: creatinine.row, date: exp.sampleDate }] } });
    expect(r).toMatchObject({ ok: true });
    await settleCommits();
    const doc = stored()!;
    expect(doc.readings).toHaveLength(1);
    expect(doc.readings[0]).toMatchObject({ id: 'creatinine', value: 1.28, unit: 'mg/dL', date: exp.sampleDate, provenance: 'coach', confirmed: true, attachmentId: 'report-att-1' });
    expect(doc.chapter).toBe('report');
  });

  it('a photo goes to the vision model masked: no patient details, no file name in the request body', async () => {
    const exp = expected('photo-report.expected.json');
    // jsdom has no canvas: a stand-in codec (a white page) keeps the pipeline real from decode to request
    const codec = {
      decode: async () => ({ width: 400, height: 600, data: new Uint8ClampedArray(400 * 600 * 4).fill(255) }),
      encode: async () => ({ mime: 'image/jpeg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) }),
    };
    setMarkerExtractor((input, deps) => extractFromFile(input, { ...deps, imageCodec: codec }));
    const vision = { sampleDate: exp.sampleDate, rows: [{ marker: 'ldl', nameOnReport: 'LDL Cholesterol', value: 165, unit: 'mg/dL', labRange: '< 100', page: 1 }] };
    const { ff, adapter } = coach([toolTurn('markers_import', { attachmentId: 'report-att-1' }), jsonTurn(vision), textTurn('Read it; please check the table.')], { vision: true });
    const card = await sendFile(adapter, new File([fixture('photo-report.png')], 'photo-report.png', { type: 'image/png' }));

    expect(card.markers?.route).toBe('vision');
    expect(card.markers!.rows.find((r) => r.markerId === 'ldl')).toMatchObject({ value: 165, unit: 'mg/dL' });
    const visionReq = ff.requests.find((r) => JSON.stringify(r.body).includes('image/jpeg'));
    expect(visionReq).toBeDefined();
    const body = JSON.stringify(visionReq!.body);
    expect(leaks(body, exp.patient)).toEqual([]);
    expect(body).not.toContain('photo-report.png');
    expect(body).not.toContain('Here is my blood test report');
    expect(ff.requests.flatMap((r) => leaks(JSON.stringify(r.body), exp.patient))).toEqual([]);
  });
});
