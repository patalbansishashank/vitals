import { createDocumentStore, createMemoryBackend } from '@/store';
import { deriveWriter } from '@/commands/bio/store';
import { InMemoryBioStore, InMemoryBlobStore } from '../memory';
import { DocBioStore } from '../docStore';
import { BioDocIndex } from '../docIndex';
import { bioStoreConformance } from './conformance';

bioStoreConformance('InMemoryBioStore', () => {
  const blobs = new InMemoryBlobStore();
  return { store: new InMemoryBioStore(blobs), blobs };
});

function docSubject(batchSize?: number) {
  const docs = createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' });
  const blobs = new InMemoryBlobStore();
  const store = new DocBioStore({ index: new BioDocIndex(docs), blobs, writer: deriveWriter(docs, 'conformance'), ...(batchSize ? { batchSize } : {}) });
  return { store, blobs, settle: () => store.flush() };
}

// buffered: reads come from this session's overlay until a flush, then from the shared index
bioStoreConformance('DocBioStore (buffered)', () => docSubject());
// every op committed at once: reads come from the document store through the index
bioStoreConformance('DocBioStore (write-through)', () => docSubject(1));
