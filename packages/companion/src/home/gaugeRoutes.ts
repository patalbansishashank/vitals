/**
 * Gauge data for Vitals (docs/SERVER.md "Gauge data for Vitals"): `GET /v1/gauge/*` answers the person's own Vitals
 * devices with exactly the JSON of the matching `gauge_*` tool (`./lumenTools.ts`), its arguments as query parameters.
 *
 *   /v1/gauge/availability                    gauge_data_availability
 *   /v1/gauge/series?kind=&from=&to=&bucket=&cursor=&limit=  gauge_metric_series (raw readings in pages: `next` → `cursor`)
 *   /v1/gauge/daily?date=                     gauge_daily_summary
 *   /v1/gauge/sleep?from=&to=                 gauge_sleep
 *   /v1/gauge/activity?from=&to=              gauge_activity
 *   /v1/gauge/scores?from=&to=&key=           gauge_scores
 *   /v1/gauge/device                          gauge_device_state
 *   /v1/gauge/short-video?from=&to=           gauge_short_video
 *   /v1/gauge/workouts?from=&to=              gauge_workouts (sessions overlapping the range)
 *   /v1/gauge/steps?from=&to=                 gauge_steps (steps-fuse/1, energy SPEC §2.3)
 *   /v1/gauge/timeline?date=                  gauge_timeline (the day minute by minute)
 *   /v1/gauge/hr-intervals?from=&to=&cursor=&limit=  gauge_hr_intervals (raw HR readings of ≤ 36 h with each one's
 *                                             hr-support/1 interval, in pages: exact zone time on the device)
 *   /v1/gauge/baselines?date=                 gauge_baselines (the 28 nights before the waking date)
 *   /v1/gauge/hc?type=&from=&to=&cursor=&limit=  gauge_hc (Health Connect records by type)
 *   POST /v1/gauge/steps/fuse                 gauge_steps with a JSON body { from, to, tz?, bucket?, activities?,
 *                                             corrections?, preference? } (FIX-CONTRACT F3): the same JSON as GET /steps
 *   POST /v1/gauge/fusion-context             (r063 S6) the person's step-fusion context { window: { start, end },
 *                                             activities?, corrections?, preference?, tz? }: stored per person (the
 *                                             lists replace what starts in the window); every fused read uses it.
 *                                             200 { revision, changed, … }, never cached
 *   GET  /v1/gauge/changes?since=&limit=      (r063 S13) the change feed of imported actuals (workouts, Health Connect
 *                                             exercise sessions and weights): revisions and deletions after a cursor
 *   GET  /v1/gauge/detections?since=&from=&to=&limit=  (r067) the server's automatic detections (detect/2): episodes
 *                                             written after the cursor, withdrawn ids, cursor, processedThrough
 *   GET  /v1/gauge/changes-state?refs=        (0.6.3 FX1) the state now of up to 100 imported records (kind:id, comma-
 *                                             separated): present, deleted or unknown (a client's resync pages it)
 *   GET  /v1/gauge/pulse?since=&wait=         (r069 sync) the Gauge pulse (`./gaugePulse.ts`), held up to `wait` s
 *                                             (0–25) while `since` is current: { token, boot, uploads, data,
 *                                             lastUploadAt, dataAt, serverNow }, never cached
 *
 * Every route also takes `tz` (an IANA zone): days, the 19:00 sleep rule and clock times use it; else the zone of the
 * newest ring `local_offset_min` in the range, else the person's zone, else UTC. Every answer's data names it (`tz`).
 *
 * Only Vitals device tokens pass (`device` kind): a Gauge `lumen` token or an agent token is 403 `wrong_kind` (agents
 * read the same tools on `/mcp`). The answer is the tool's envelope `{ ok, status, summary, data }`: 200 when it is ok,
 * 400 with the rejected envelope for bad parameters, 503 when the store could not be read.
 *
 * Polling: every 200 carries a weak `ETag` over the result without its `minutesSince…` counters (they move with the
 * clock, not with the data), `Last-Modified` (the person's last Gauge upload) and `Cache-Control: private, max-age=30`.
 * A matching `If-None-Match` answers 304 with no body. Every derived answer carries `inputsHash` (its input event ids and
 * revisions plus the algorithm versions), so a source revision or deletion changes the ETag too.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PersonContext } from './home.ts';
import type { LumenHub } from './lumen.ts';
import type { PersonRegistry } from './persons.ts';
import { HttpError, readJson, sendJson } from '../security.ts';
import { fusionContextUpdateOf, validZone } from './lumenTools.ts';
import { PULSE_MAX_WAIT_S } from './gaugePulse.ts';
import { rejected } from '../toolManifest.ts';

export const GAUGE_PREFIX = '/v1/gauge/';
export const GAUGE_MAX_AGE_S = 30;
export const GAUGE_ALLOW_HEADERS = 'authorization, content-type, if-none-match';
export const GAUGE_ALLOW_METHODS = 'GET, POST';
/** The POST routes: their tool and the body fields it takes. */
export const GAUGE_POST_ROUTES: Readonly<Record<string, { tool: string; fields: readonly string[] }>> = {
  'steps/fuse': { tool: 'gauge_steps', fields: ['from', 'to', 'tz', 'bucket', 'activities', 'corrections', 'preference', 'rolloverH'] },
};
const POST_MAX_BYTES = 512 * 1024;
/** (r063 S6) The context route and its body fields. */
export const GAUGE_CONTEXT_ROUTE = 'fusion-context';
const CONTEXT_FIELDS = ['window', 'activities', 'corrections', 'preference', 'tz'];
/** (r069 sync) The pulse route. */
export const GAUGE_PULSE_ROUTE = 'pulse';
/** A read at least this slow is logged (route and duration only). */
export const GAUGE_SLOW_MS = 250;

/** Each endpoint's tool and the query parameters it takes (the tool's arguments). */
export const GAUGE_ROUTES: Readonly<Record<string, { tool: string; params: readonly string[] }>> = {
  availability: { tool: 'gauge_data_availability', params: ['tz'] },
  series: { tool: 'gauge_metric_series', params: ['kind', 'from', 'to', 'bucket', 'cursor', 'limit', 'tz'] },
  daily: { tool: 'gauge_daily_summary', params: ['date', 'tz'] },
  sleep: { tool: 'gauge_sleep', params: ['from', 'to', 'tz'] },
  activity: { tool: 'gauge_activity', params: ['from', 'to', 'tz'] },
  scores: { tool: 'gauge_scores', params: ['from', 'to', 'key', 'tz'] },
  device: { tool: 'gauge_device_state', params: ['tz'] },
  'short-video': { tool: 'gauge_short_video', params: ['from', 'to', 'tz'] },
  workouts: { tool: 'gauge_workouts', params: ['from', 'to', 'tz'] },
  steps: { tool: 'gauge_steps', params: ['from', 'to', 'tz'] },
  timeline: { tool: 'gauge_timeline', params: ['date', 'tz'] },
  'hr-intervals': { tool: 'gauge_hr_intervals', params: ['from', 'to', 'cursor', 'limit', 'tz'] },
  baselines: { tool: 'gauge_baselines', params: ['date', 'tz'] },
  hc: { tool: 'gauge_hc', params: ['type', 'from', 'to', 'cursor', 'limit', 'tz'] },
  changes: { tool: 'gauge_changes', params: ['since', 'limit', 'tz'] },
  'changes-state': { tool: 'gauge_changes_state', params: ['refs', 'tz'] },
  detections: { tool: 'gauge_detections', params: ['since', 'from', 'to', 'limit', 'tz'] },
};

export interface GaugeRoutes {
  owns(path: string): boolean;
  handle(req: IncomingMessage, res: ServerResponse, path: string, query: string): Promise<void>;
}

export interface GaugeRoutesOptions {
  lumen: LumenHub;
  persons: PersonRegistry;
  /** `home.resolvePerson(req, ['device'])`. */
  resolve: (req: IncomingMessage) => Promise<PersonContext>;
}

/** The query as tool arguments: only the endpoint's parameters, each at most once; an empty value is left out. */
function argsOf(query: string, params: readonly string[]): Record<string, unknown> {
  const q = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const args: Record<string, unknown> = {};
  for (const key of new Set(q.keys())) {
    if (!params.includes(key)) throw new HttpError(400, 'bad_request', params.length ? `This endpoint takes ${params.join(', ')}` : 'This endpoint takes no parameters');
    const values = q.getAll(key);
    if (values.length > 1) throw new HttpError(400, 'bad_request', `Send ${key} once`);
    if (values[0]) args[key] = values[0];
  }
  return args;
}

const CLOCK_FIELDS = new Set(['minutesSinceLastUpload', 'minutesSinceLastReading']);
export const gaugeEtag = (body: unknown) =>
  `W/"${createHash('sha256').update(JSON.stringify(body, (k, v: unknown) => (CLOCK_FIELDS.has(k) ? undefined : v))).digest('base64url').slice(0, 27)}"`;

/** RFC 9110 weak comparison: any listed tag (or `*`) equal to ours, ignoring `W/`. */
function matches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const ours = etag.replace(/^W\//, '');
  return ifNoneMatch.split(',').some((t) => {
    const tag = t.trim();
    return tag === '*' || tag.replace(/^W\//, '') === ours;
  });
}

export function createGaugeRoutes(o: GaugeRoutesOptions): GaugeRoutes {
  /** (r063 S6) `POST /v1/gauge/fusion-context`: stores the person's fusion context (a write: no ETag, never cached). */
  async function putContext(req: IncomingMessage, res: ServerResponse, query: string): Promise<void> {
    if (req.method !== 'POST') throw new HttpError(405, 'method', 'Use POST', { Allow: 'POST' });
    if (query && query !== '?') throw new HttpError(400, 'bad_request', 'Send the parameters in the JSON body');
    const ctx = await o.resolve(req);
    const body = await readJson(req, POST_MAX_BYTES);
    for (const k of Object.keys(body)) if (!CONTEXT_FIELDS.includes(k)) throw new HttpError(400, 'bad_request', `This endpoint takes ${CONTEXT_FIELDS.join(', ')}`);
    const person = await o.persons.get(ctx.personId);
    const tz = body.tz === undefined ? (person?.timeZone ?? 'UTC') : validZone(body.tz);
    if (tz === null) throw new HttpError(400, 'bad_request', 'tz is a time zone (IANA, e.g. Asia/Kolkata)');
    const u = fusionContextUpdateOf(body, tz);
    const noStore = { 'Cache-Control': 'no-store' };
    if (typeof u === 'string') return sendJson(res, 400, rejected('invalid_input', u), noStore);
    const r = o.lumen.fusionContext.put(ctx.personId, u, Date.now());
    const data = { revision: r.revision, changed: r.changed, updatedAt: r.context.updatedAt, activities: r.context.activities.length, corrections: r.context.corrections.length };
    sendJson(res, 200, { ok: true, status: 'applied', summary: r.changed ? 'Fusion context updated.' : 'Fusion context unchanged.', data }, noStore);
  }

  /** (r069 sync) `GET /v1/gauge/pulse?since=&wait=`: held while nothing moved, then the pulse now (never cached). */
  async function pulse(req: IncomingMessage, res: ServerResponse, query: string): Promise<void> {
    if (req.method !== 'GET') throw new HttpError(405, 'method', 'Use GET', { Allow: 'GET' });
    const ctx = await o.resolve(req);
    const args = argsOf(query, ['since', 'wait']);
    const since = typeof args.since === 'string' ? args.since : null;
    if (since !== null && !/^[A-Za-z0-9_-]{1,16}\.\d{1,12}\.\d{1,12}$/.test(since)) throw new HttpError(400, 'bad_request', 'since is a pulse token');
    const wait = typeof args.wait === 'string' ? args.wait : '0';
    if (!/^\d{1,2}$/.test(wait) || Number(wait) > PULSE_MAX_WAIT_S) throw new HttpError(400, 'bad_request', `wait is 0–${PULSE_MAX_WAIT_S} seconds`);
    const s = await o.lumen.pulse.wait(ctx.personId, since, Number(wait) * 1000, res);
    if (res.destroyed || res.writableEnded) return;
    sendJson(res, 200, { ...s, serverNow: new Date().toISOString() }, { 'Cache-Control': 'no-store' });
  }

  return {
    owns: (path) => path.startsWith(GAUGE_PREFIX),
    async handle(req, res, path, query) {
      const name = path.slice(GAUGE_PREFIX.length);
      if (name === GAUGE_CONTEXT_ROUTE) return putContext(req, res, query);
      if (name === GAUGE_PULSE_ROUTE) return pulse(req, res, query);
      const post = Object.hasOwn(GAUGE_POST_ROUTES, name) ? GAUGE_POST_ROUTES[name]! : null;
      const route = Object.hasOwn(GAUGE_ROUTES, name) ? GAUGE_ROUTES[name]! : null;
      if (!route && !post) throw new HttpError(404, 'not_found', 'Not found');
      if (post && req.method !== 'POST') throw new HttpError(405, 'method', 'Use POST', { Allow: 'POST' });
      if (route && req.method !== 'GET') throw new HttpError(405, 'method', 'Use GET', { Allow: 'GET' });
      const ctx = await o.resolve(req);
      let args: Record<string, unknown>;
      if (post) {
        if (query && query !== '?') throw new HttpError(400, 'bad_request', 'Send the parameters in the JSON body');
        const body = await readJson(req, POST_MAX_BYTES);
        for (const k of Object.keys(body)) if (!post.fields.includes(k)) throw new HttpError(400, 'bad_request', `This endpoint takes ${post.fields.join(', ')}`);
        args = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      } else args = argsOf(query, route!.params);
      const tool = post ? post.tool : route!.tool;
      const person = await o.persons.get(ctx.personId);
      const started = performance.now();
      const envelope = await o.lumen.toolsFor(ctx.personId, person?.timeZone ?? 'UTC').call(tool, args);
      // every read runs on the main thread (r063): name the slow ones, never their data
      const tookMs = Math.round(performance.now() - started);
      if (tookMs >= GAUGE_SLOW_MS) ctx.log(`gauge: ${name} took ${tookMs} ms`);
      if (!envelope.ok) {
        const internal = envelope.error?.code !== 'invalid_input';
        return sendJson(res, internal ? 503 : 400, envelope, internal ? { 'Retry-After': '30' } : {});
      }
      const etag = gaugeEtag(envelope);
      const lastUpload = (o.lumen.peek(ctx.personId)?.installations() ?? []).map((i) => i.lastIngestAt).filter((x): x is string => Boolean(x)).sort().at(-1);
      const headers: Record<string, string> = {
        ETag: etag,
        'Cache-Control': `private, max-age=${GAUGE_MAX_AGE_S}`,
        Vary: 'Origin, Authorization',
        ...(lastUpload ? { 'Last-Modified': new Date(lastUpload).toUTCString() } : {}),
      };
      if (matches(typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined, etag)) {
        res.writeHead(304, headers).end();
        return;
      }
      sendJson(res, 200, envelope, headers);
    },
  };
}
