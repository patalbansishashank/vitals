import { EVIDENCE_TOPICS } from '@/content/evidence';
import { dossierOf, EvidenceRepository } from '../data/repository';
import { fixtureRegistry } from './fixtures';

describe('EvidenceRepository: id → mechanism across topics', () => {
  it('loads only the topic the id prefix names', async () => {
    const { entries, loads } = fixtureRegistry();
    const repo = new EvidenceRepository(entries, { indexMetrics: false });
    const r = await repo.resolveMechanism('90-full');
    expect(r?.mechanism.title).toBe('Glycogen holds water');
    expect(r?.topic.slug).toBe('test-fuel');
    expect(r?.index).toBe(0);
    expect(loads).toEqual({ 'test-fuel': 1 });
    // cached: a second lookup is synchronous and loads nothing
    expect(repo.getMechanism('90-full')?.mechanism.id).toBe('90-full');
    await repo.resolveMechanism('90-bare');
    expect(loads).toEqual({ 'test-fuel': 1 });
  });

  it('falls back to every topic when the id is not where its prefix says', async () => {
    const { entries, loads } = fixtureRegistry();
    const repo = new EvidenceRepository(entries, { indexMetrics: false });
    const r = await repo.resolveMechanism('90-misplaced');
    expect(r?.topic.slug).toBe('test-heart');
    expect(loads).toEqual({ 'test-fuel': 1, 'test-heart': 1 });
  });

  it('resolves unknown ids to null after looking everywhere', async () => {
    const { entries } = fixtureRegistry();
    const repo = new EvidenceRepository(entries, { indexMetrics: false });
    await expect(repo.resolveMechanism('99-nothing')).resolves.toBeNull();
    await expect(repo.resolveMechanism('no-prefix')).resolves.toBeNull();
    expect(repo.getSnapshot().complete).toBe(true);
  });

  it('reports failed topics, keeps the others, and retries on demand', async () => {
    const { entries, loads } = fixtureRegistry({ fail: ['test-heart'] });
    const repo = new EvidenceRepository(entries, { indexMetrics: false });
    await repo.loadAll();
    const snap = repo.getSnapshot();
    expect(snap.loaded).toBe(1);
    expect(snap.failed).toEqual(['test-heart']);
    expect(snap.settled).toBe(true);
    expect(snap.complete).toBe(false);
    await expect(repo.resolveMechanism('91-ldl')).rejects.toThrow('chunk failed');
    await repo.retryFailed();
    expect(loads['test-heart']).toBe(3);
  });

  it('notifies subscribers as each topic arrives (progressive index)', async () => {
    const { entries } = fixtureRegistry();
    const repo = new EvidenceRepository(entries, { indexMetrics: false });
    const versions: number[] = [];
    repo.subscribe(() => versions.push(repo.getSnapshot().loaded));
    await repo.loadAll();
    expect(versions).toEqual([1, 2]);
    expect(repo.getSnapshot().index.mechanisms).toBe(5);
  });

  it('finds the mechanisms that drive a metric', async () => {
    const { entries } = fixtureRegistry();
    const repo = new EvidenceRepository(entries, { indexMetrics: false });
    await repo.loadAll();
    expect(repo.mechanismsForMetric('scaleWeight').map((r) => r.mechanism.id)).toEqual(['90-full']);
    expect(repo.mechanismsForMetric('ldl').map((r) => r.mechanism.id)).toEqual(['91-ldl']);
    expect(repo.mechanismsForMetric('hunger')).toEqual([]);
  });

  it('reads the dossier prefix of ids', () => {
    expect(dossierOf('04-liver-glycogen')).toBe('04');
    expect(dossierOf('20-myth-starvation-mode')).toBe('20');
    expect(dossierOf('liver')).toBeNull();
  });
});

describe('EvidenceRepository over the real registry', () => {
  it('resolves real mechanism ids from different topics, loading only those topics', async () => {
    const repo = new EvidenceRepository(EVIDENCE_TOPICS, { indexMetrics: false });
    const a = await repo.resolveMechanism('04-glycogen-capacity-water-potassium');
    expect(a?.topic.dossier).toBe('04');
    expect(a?.mechanism.category).toBe('fuel');
    const b = await repo.resolveMechanism('20-protein-loss-in-a-fast');
    expect(b?.topic.dossier).toBe('20');
    expect(repo.getSnapshot().loaded).toBe(2);
  }, 60_000);
});
