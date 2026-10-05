/**
 * A write that saved nothing because one answer is missing: `log.meal` answering `status: 'ask'` (an unknown food, a
 * low-confidence meal), or any write that says `logged: false`. An agent gets `needs_choice`, `saved: false`, the foods
 * it can pick from and plain words, never "done". Shared by the agent dispatcher and the Coach's executor.
 */

/** A table food the agent can pick for a component (the command's `FoodChoice`). */
export interface Candidate {
  component: string;
  foodId: string;
  name: string;
}

export interface NeedsChoice {
  status: 'needs_choice';
  saved: false;
  summary: string;
  candidates?: Candidate[];
}

const MAX_CANDIDATES = 8;
const MAX_QUESTION = 240;

const isCandidate = (c: unknown): c is Candidate => {
  const x = c as Partial<Candidate> | null;
  return typeof x === 'object' && x !== null && typeof x.component === 'string' && typeof x.foodId === 'string' && typeof x.name === 'string';
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const candidatesOf = (v: unknown): Candidate[] => (Array.isArray(v) ? v.filter(isCandidate) : []);

/** What `log_bulk` answered per entry (`{status: 'logged' | 'ask' | 'skipped' | 'error', …}`), counted; null when the output is not that. */
function bulkTally(tool: string, output: unknown) {
  if (tool !== 'log_bulk' || !Array.isArray(output) || output.length === 0 || !output.every((r) => isRecord(r) && typeof r.status === 'string')) return null;
  const rows = output as Array<Record<string, unknown>>;
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  const asked = rows.filter((r) => r.status === 'ask');
  // the foods the table could not place (a component without a foodId), and what the agent can pick from
  const names = [...new Set(asked.flatMap((r) => (Array.isArray(r.components) ? r.components.filter((c) => isRecord(c) && typeof c.name === 'string' && !c.foodId).map((c) => String((c as { name: string }).name).slice(0, 40)) : [])))].slice(0, 5);
  const candidates = [...new Map(asked.flatMap((r) => candidatesOf(r.candidates)).map((c) => [`${c.component}|${c.foodId}`, c])).values()].slice(0, MAX_CANDIDATES);
  const parts = [
    asked.length ? `${asked.length} ${asked.length === 1 ? 'needs' : 'need'} a food choice${names.length ? `: ${names.map((n) => `"${n}"`).join(', ')}` : ''}` : '',
    count('skipped') ? `${count('skipped')} skipped` : '',
    count('error') ? `${count('error')} failed` : '',
  ].filter(Boolean);
  const next = asked.length
    ? ` Nothing was saved for ${asked.length === 1 ? 'that entry' : 'those entries'}. ${candidates.length ? 'Pick a food for each (or ask the person)' : 'Ask the person'} and call ${tool} again with only ${asked.length === 1 ? 'that entry' : 'those entries'}${candidates.length ? ' and the chosen foodId' : ''}.`
    : '';
  const logged = count('logged');
  return { total: rows.length, logged, asked: asked.length, candidates, summary: `${logged} of ${rows.length} logged${parts.length ? `; ${parts.join('; ')}` : ''}.${next}` };
}

/** `log_bulk` logged some entries but not all: the honest counts for the summary (the status stays `applied`); null when all were logged. */
export function partlyLogged(tool: string, output: unknown): { summary: string; candidates?: Candidate[] } | null {
  const t = bulkTally(tool, output);
  if (!t || t.logged === t.total) return null;
  return { summary: t.summary, ...(t.candidates.length ? { candidates: t.candidates } : {}) };
}

/** The `needs_choice` part of an envelope when a write's own output says it saved nothing; otherwise null. `tool` is the tool name (`log_meal`). */
export function needsChoice(tool: string, output: unknown): NeedsChoice | null {
  const bulk = bulkTally(tool, output);
  if (bulk) return bulk.logged === 0 && bulk.asked > 0 ? { status: 'needs_choice', saved: false, summary: bulk.summary, ...(bulk.candidates.length ? { candidates: bulk.candidates } : {}) } : null;
  if (typeof output !== 'object' || output === null) return null;
  const o = output as { status?: unknown; logged?: unknown; question?: unknown; candidates?: unknown };
  if (o.status !== 'ask' && o.logged !== false) return null;
  const question = (typeof o.question === 'string' && o.question ? o.question : 'One answer is needed from the person.').slice(0, MAX_QUESTION);
  const candidates = candidatesOf(o.candidates).slice(0, MAX_CANDIDATES);
  // the photo tool takes no foodId: the retry goes through log_meal with the components
  const photo = tool === 'log_meal_from_photo';
  const next = candidates.length
    ? `Pick one of these foods (or ask the person) and call ${photo ? 'log_meal with the components and the chosen foodId' : `${tool} again with its foodId`}.`
    : `Ask the person, then call ${photo ? 'log_meal with the components and their answer' : `${tool} again with the answer`}.`;
  return { status: 'needs_choice', saved: false, summary: `Nothing logged yet. ${question} ${next}`, ...(candidates.length ? { candidates } : {}) };
}
