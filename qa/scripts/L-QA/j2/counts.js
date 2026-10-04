// Counts only (no values): what the ring import left in the phone's store, read through the read-only QA hook (?qa=1).
const V = window.__vitals; if (!V) return { error: 'no QA hook (open with ?qa=1)' };
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const src = await V.read('bio.sources', {});
const sources = src.ok ? src.output.sources.map((x) => ({ label: x.label, kind: x.kind, driver: x.driver, channel: x.channel, records: x.records, streams: x.streams.length, firstDate: x.firstDate, lastDate: x.lastDate })) : src;
const d = await V.read('bio.daily', { from: day(13), to: day(0) });
const days = d.ok ? d.output.days : [];
const has = (m) => days.filter((r) => JSON.stringify(r).includes(`"${m}`)).length;
const out = { sources, daily: d.ok ? { days: days.length, withSleep: has('sleep'), withRestingHr: has('resting_hr') } : d };
for (const m of ['hr', 'spo2', 'hrv', 'steps']) {
  const r = await V.read('bio.series', { metric: m, from: day(1), to: day(0), resolution: 'raw' });
  out[`raw_${m}_last2days`] = r.ok ? { points: r.output.points.length, truncated: r.output.truncated } : r.error?.code;
}
return out;
