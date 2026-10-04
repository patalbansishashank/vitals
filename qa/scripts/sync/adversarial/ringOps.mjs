const TZ = 'Asia/Kolkata';
const OFFSET_S = 19800;

export const ringContext = (ingestedAt) => ({
  tz: TZ,
  tzOffsetS: OFFSET_S,
  channel: 'ble:jstyle2301',
  device: { type: 'ring', manufacturer: 'J-Style', model: 'C-SYNCX test ring', tier: 'C' },
  decoder: 'jstyle2301/V0789@1',
  firmware: 'V0789',
  producer: { name: 'vitals-ble', version: '1' },
  ingestedAt,
  exportedAt: ingestedAt,
});

export const minuteAt = (date, i) => Date.parse(`${date}T01:00:00+05:30`) + i * 60_000;
export const minuteOf = (date, t) => Math.round((t - minuteAt(date, 0)) / 60_000);

export function hrEvents(date, from, to, value = (i) => 62 + (i % 21)) {
  return Array.from({ length: to - from }, (_, k) => {
    const i = from + k;
    return {
      type: 'sample',
      stream: 'hr',
      t: minuteAt(date, i),
      value: value(i),
      unit: 'bpm',
      origin: 'history',
    };
  });
}

/** Two fully classified readings of one night, with the same session start and changed stages. */
export function sleepEvent(date, revised = false) {
  const start = Date.parse(`${date}T00:00:00+05:30`) - 3600_000;
  const stages = Array.from({ length: 420 }, (_, i) => {
    const part = i % 90;
    if (revised) return part < 25 ? 'deep' : part < 60 ? 'light' : part < 80 ? 'rem' : 'awake';
    return part < 15 ? 'deep' : part < 70 ? 'light' : 'rem';
  });
  return { type: 'sleepEpochs', start, epochS: 60, stages, rawCodes: [], firmware: 'V0789', complete: true };
}

/** Mirrors biometrics.correct with the app's validation, device selection and document writer. */
export async function bioCorrect({ store, bio }, { target, value, now = new Date().toISOString() }) {
  const [{ checkCorrection, correctionKey, deviceRecordFor }, { mintWriteToken, revokeWriteToken }] =
    await Promise.all([
      import('../../../../src/commands/biometrics/correction.ts'),
      import('../../../../src/store/index.ts'),
    ]);
  const bad = checkCorrection({ target, value }, target.localDate);
  if (bad) throw new Error(`invalid correction: ${bad.path}: ${bad.message}`);
  const key = correctionKey(target);
  const records = await bio.store.records({ from: target.localDate, to: target.localDate });
  const replaced = deviceRecordFor(target, records, await bio.store.sources());
  const current = await store.get('bioCorrections', key);
  const active = current?.value?.clearedAt === null ? {} : { clearedAt: null };
  const doc = {
    correctionId: `corr:${key}@${now}`,
    key,
    target,
    value,
    createdAt: now,
    actor: 'user:C-SYNCX',
    replaced,
    ...active,
  };
  const token = mintWriteToken('derive', { label: 'C-SYNCX correction race' });
  try {
    await bio.docs.transact(token, (tx) => tx.put('bioCorrections', { ...doc, _id: key }));
  } finally {
    revokeWriteToken(token);
  }
  return { key, correctionId: doc.correctionId, replaced };
}

export async function bioResolve({ bio }, date) {
  const { resolveDays } = await import('../../../../src/biometrics/core/resolve.ts');
  const days = resolveDays(
    await bio.store.records({ from: date, to: date }),
    await bio.store.sources(),
    { from: date, to: date },
    await bio.store.corrections(),
  );
  const d = days.find((x) => x.localDate === date);
  return {
    asleepS: d?.mainSleep?.asleep_s ?? null,
    basis: d?.basisByMetric?.sleep ?? null,
    recordId: d?.mainSleep?.record_id ?? null,
  };
}
