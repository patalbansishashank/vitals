/**
 * Evolu schema, phase 1 (R7 §9.1): one generic `doc` table. Each row is one document of an E4 collection (SUITE_SPEC
 * §2.3). The row id is derived from `col/key`, so every device upserts the same row. Evolu keeps the newest `json` per
 * row; the adapter then merges per field: `json` holds an envelope with one clock per field (`fieldMerge.ts`), and a
 * device that receives a version missing its own newer fields writes the merged result back (SUITE_SPEC §2.3 LWW-F).
 * Phase 2 splits plans, logs, biometrics and conversations into their own tables (R7 §9.2, SUITE_SPEC §2.3). */
import { createIdFromString, id, NonNegativeInt, String as EvoluString } from '@evolu/common';

export const DocId = id('Doc');
export type DocId = typeof DocId.Output;

export const vitalsEvoluSchema = {
  doc: {
    id: DocId,
    col: EvoluString,
    key: EvoluString,
    /** JSON text of the per-field envelope `{ v: 2, fields, clocks, … }`; rows from before it hold the plain document value. */
    json: EvoluString,
    /** Document schema version (`_schema`). */
    schema: NonNegativeInt,
    /** DeviceId of the last writer. */
    device: EvoluString,
    /**
     * ISO instant the document was first written (`_created`). Evolu's own `createdAt` is rewritten by every upsert,
     * so the adapter keeps the first value here (I1). Rows written before this column existed fall back to `createdAt`.
     */
    created: EvoluString,
  },
};
export type VitalsEvoluSchema = typeof vitalsEvoluSchema;

export function docRowId(col: string, key: string): DocId {
  return DocId.orThrow(createIdFromString(`${col}/${key}`));
}
