import { useId, useState } from 'react';
import { Field, Key, Select, Sheet, TextInput } from '@/components';
import { CONSTRAINT_UNITS, validateConstraintDef, type ConstraintDef, type ConstraintQuantity, type WeightBasis } from '@/lib/bodyContracts';
import type { RenalNutritionEnvelope, RenalScope } from '@/lib/renalScope';
import { useSafetyStore } from '@/state/safetyStore';
import { sendCommand } from '@/features/lib/sendCommand';
import { nowIso } from './clock';
import '@/commands/defs/safety';

type DraftBound = { quantity: ConstraintQuantity; comparator: 'cap' | 'floor'; value: string; window: 'day' | 'rolling' | 'event' | 'horizon'; days: string; applicability: ConstraintDef['applicability']; mandatory: boolean };
const freshBound = (): DraftBound => ({ quantity: 'proteinPerDay', comparator: 'cap', value: '', window: 'day', days: '', applicability: 'applicable', mandatory: true });
const quantityOptions: Array<{ value: ConstraintQuantity; label: string }> = [
  { value: 'proteinPerDay', label: 'Protein · g/day' }, { value: 'proteinPerKg', label: 'Protein · g/kg/day' },
  { value: 'sodiumPerDay', label: 'Sodium · mg/day' }, { value: 'potassiumPerDay', label: 'Potassium · mg/day' },
  { value: 'fluidPerDay', label: 'Fluid · mL/day' }, { value: 'carbPerDay', label: 'Carbohydrate · g/day' },
  { value: 'energyPctOfMaintenance', label: 'Energy · % of maintenance' }, { value: 'fatPctEnergy', label: 'Fat · % energy' },
];
const options = <const T extends readonly string[]>(values: T) => values.map((value) => ({ value: value as T[number], label: value }));

/** Manual clinician instructions retain entered quantities and superseding history. */
export function NutritionGuidanceForm({ scope, onSaved }: { scope: RenalScope; onSaved?: () => void }) {
  const stored = useSafetyStore((s) => s.nutritionGuidance);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [condition, setCondition] = useState<'ckd' | 'other'>('ckd');
  const [stage, setStage] = useState('');
  const [dialysis, setDialysis] = useState<NonNullable<RenalNutritionEnvelope['dialysis']>>('unknown');
  const [stability, setStability] = useState<RenalNutritionEnvelope['stability']>('unknown');
  const [frailty, setFrailty] = useState<NonNullable<RenalNutritionEnvelope['frailty']>>('unknown');
  const [basis, setBasis] = useState<WeightBasis>('actual');
  const [kg, setKg] = useState('');
  const [kgOn, setKgOn] = useState('');
  const [kgKind, setKgKind] = useState<NonNullable<RenalNutritionEnvelope['basisWeightKind']>>('other');
  const [assessed, setAssessed] = useState('');
  const [review, setReview] = useState('');
  const [source, setSource] = useState<RenalNutritionEnvelope['source']>('selfEnteredClinician');
  const [document, setDocument] = useState('');
  const [provenance, setProvenance] = useState('');
  const [bounds, setBounds] = useState<DraftBound[]>([freshBound()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const patch = (index: number, part: Partial<DraftBound>) => setBounds((rows) => rows.map((row, k) => k === index ? { ...row, ...part } : row));
  const edit = (env?: RenalNutritionEnvelope) => {
    setEditing(env?.id ?? null); setCondition(env?.condition ?? 'ckd'); setStage(env?.stage ?? '');
    setDialysis(env?.dialysis ?? 'unknown'); setStability(env?.stability ?? 'unknown'); setFrailty(env?.frailty ?? 'unknown');
    setBasis(env?.weightBasis ?? 'actual'); setKg(env?.basisWeightKg === undefined ? '' : String(env.basisWeightKg)); setKgOn(env?.basisWeightOn ?? ''); setKgKind(env?.basisWeightKind ?? 'other');
    setAssessed(env?.assessedAt ?? ''); setReview(env?.reviewBy ?? ''); setSource(env?.source ?? 'selfEnteredClinician'); setDocument(env?.sourceDocument ?? ''); setProvenance(env?.provenance ?? '');
    setBounds(env?.bounds.map((b) => ({ quantity: b.quantity, comparator: b.comparator, value: String(b.value), window: b.window.kind, days: b.window.kind === 'rolling' ? String(b.window.days) : '', applicability: b.applicability, mandatory: b.mandatory })) ?? [freshBound()]);
    setError(''); setOpen(true);
  };
  const save = async () => {
    if (saving) return;
    if (!assessed) { setError('Enter the clinician’s assessment date.'); return; }
    if (review && review < assessed) { setError('Review date must follow the assessment date.'); return; }
    if (kg && (!Number.isFinite(Number(kg)) || Number(kg) <= 0 || !kgOn)) { setError('Enter the named weight in kg and its date.'); return; }
    const at = nowIso(); const id = `nutrition:${at}`;
    const defs: ConstraintDef[] = bounds.map((b, k) => ({ id: `${id}:${k}`, quantity: b.quantity, comparator: b.comparator, value: b.value.trim() ? Number(b.value) : Number.NaN, unit: CONSTRAINT_UNITS[b.quantity], basis: b.quantity === 'proteinPerKg' ? basis : 'notApplicable', scope: 'total', window: b.window === 'rolling' ? { kind: 'rolling', days: Number(b.days) } : { kind: b.window }, applicability: b.applicability, mandatory: b.mandatory, source: { kind: 'clinician', ref: id, enteredAt: at }, policyVersion: 1 }));
    if (defs.some((b) => validateConstraintDef(b))) { setError('Enter every bound with a valid value, basis and window.'); return; }
    const envelope: RenalNutritionEnvelope = { id, condition, ...(stage.trim() ? { stage: stage.trim() } : {}), ...(condition === 'ckd' ? { dialysis, frailty } : {}), stability, weightBasis: basis, ...(kg ? { basisWeightKg: Number(kg), basisWeightOn: kgOn, basisWeightKind: kgKind } : {}), assessedAt: assessed, ...(review ? { reviewBy: review } : {}), source, ...(document.trim() ? { sourceDocument: document.trim() } : {}), ...(provenance.trim() ? { provenance: provenance.trim() } : {}), bounds: defs };
    setSaving(true);
    const result = editing ? await sendCommand('safety.updateNutritionGuidance', { id: editing, envelope: envelope as unknown as Record<string, unknown>, at }) : await sendCommand('safety.addNutritionGuidance', { envelope: envelope as unknown as Record<string, unknown>, at });
    setSaving(false);
    if (result.ok) { setOpen(false); onSaved?.(); } else setError('Guidance was not saved. Your entries are still here.');
  };
  return <section className="grid gap-3 border-t border-line py-3" aria-label="Clinician nutrition guidance">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-base font-medium">Nutrition guidance</h3><span className="text-sm text-ink-2">{scope.label ?? 'Incomplete'}</span></div>
    {scope.bounds.filter((b) => b.status === 'enforceable').map((b) => <div key={`${b.envelopeId}:${b.def.id}`} className="text-sm tabular-nums">{quantityOptions.find((q) => q.value === b.def.quantity)?.label.split(' · ')[0] ?? b.def.quantity} {b.def.comparator === 'cap' ? '≤' : '≥'} {b.def.value} {b.def.unit}</div>)}
    <div className="flex flex-wrap gap-2"><Key size="sm" onClick={() => edit()}>Add guidance</Key><Key size="sm" variant="text" onClick={() => setDetails(true)}>Details</Key></div>
    <Sheet open={details} onClose={() => setDetails(false)} title="Nutrition guidance">
      <div className="grid gap-4 p-4">{(stored ?? []).length === 0 ? <p className="m-0 text-sm text-ink-2">No clinician instruction entered.</p> : (stored ?? []).map((env) => <div key={env.id} className="grid min-w-0 gap-2 border-b border-line pb-3">
        <div className="text-sm">{env.condition === 'ckd' ? 'Kidney' : 'Other condition'} · {env.assessedAt} · {env.revokedAt ? `Withdrawn ${env.revokedAt}` : scope.needsReview.some((r) => r.envelope.id === env.id) ? 'Review' : scope.incomplete.some((r) => r.envelope.id === env.id) ? 'Incomplete' : 'Entered'}</div>
        {env.bounds.map((b) => <div key={b.id} className="text-sm tabular-nums">{b.quantity} {b.comparator} {b.value} {b.unit} · {b.basis} · {b.window.kind}{b.window.kind === 'rolling' ? ` ${b.window.days} days` : ''}</div>)}
        {env.basisWeightKg !== undefined && <div className="text-sm text-ink-2">{env.basisWeightKind ?? env.weightBasis} {env.basisWeightKg} kg · {env.basisWeightOn ?? 'Date unknown'}</div>}
        <div className="break-words text-sm text-ink-2">{env.sourceDocument ?? env.source}{env.provenance ? ` · ${env.provenance}` : ''}</div>
        {scope.needsReview.find((r) => r.envelope.id === env.id)?.reasons.map((r) => <div key={r} className="text-sm text-ink-2">{r}</div>)}
        {!env.revokedAt && <div className="flex flex-wrap gap-2"><Key size="sm" variant="text" onClick={() => { setDetails(false); edit(env); }}>Update</Key><Key size="sm" variant="text" onClick={async () => { const r = await sendCommand('safety.revokeNutritionGuidance', { id: env.id, at: nowIso() }); if (r.ok) onSaved?.(); }}>Withdraw</Key></div>}
      </div>)}<p className="m-0 text-sm text-ink-2">Entered bounds govern only their own quantity and window. Missing or changed clinical context needs review; activity and logging remain available.</p></div>
    </Sheet>
    <Sheet open={open} onClose={() => setOpen(false)} title={editing ? 'Update guidance' : 'Add guidance'} doneForm={formId} doneLabel="Save" doneDisabled={saving} doneDisabledReason={saving ? 'Saving guidance.' : undefined}>
      <form id={formId} onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid gap-4 p-4">
        <Field label="Condition"><Select value={condition} onChange={setCondition} options={[{ value: 'ckd', label: 'Kidney disease' }, { value: 'other', label: 'Other condition' }]} /></Field>
        <Field label="Clinician-entered stage (if known)"><TextInput value={stage} onChange={(e) => setStage(e.target.value)} /></Field>
        {condition === 'ckd' && <><Field label="Dialysis"><Select value={dialysis} onChange={setDialysis} options={options(['unknown', 'none', 'hemodialysis', 'peritoneal'])} /></Field><Field label="Frailty"><Select value={frailty} onChange={setFrailty} options={options(['unknown', 'yes', 'no'])} /></Field></>}
        <Field label="Clinical stability"><Select value={stability} onChange={setStability} options={options(['unknown', 'stable', 'unstable'])} /></Field>
        <Field label="Assessment date" required><TextInput type="date" value={assessed} onChange={(e) => setAssessed(e.target.value)} /></Field>
        <Field label="Review by (if specified)"><TextInput type="date" value={review} onChange={(e) => setReview(e.target.value)} /></Field>
        {bounds.map((b, k) => <fieldset key={k} className="grid min-w-0 gap-3 border-0 border-t border-line p-0 pt-3"><legend className="text-sm">Bound {k + 1}</legend>
          <Field label="Quantity and original unit"><Select value={b.quantity} onChange={(quantity) => patch(k, { quantity })} options={quantityOptions} /></Field>
          <Field label="Bound"><Select value={b.comparator} onChange={(comparator) => patch(k, { comparator })} options={[{ value: 'cap', label: 'Maximum' }, { value: 'floor', label: 'Minimum' }]} /></Field>
          <Field label={`Value · ${CONSTRAINT_UNITS[b.quantity]}`} required><TextInput type="number" min="0" step="any" value={b.value} onChange={(e) => patch(k, { value: e.target.value })} /></Field>
          <Field label="Window"><Select value={b.window} onChange={(window) => patch(k, { window })} options={options(['day', 'rolling', 'event', 'horizon'])} /></Field>
          {b.window === 'rolling' && <Field label="Rolling days"><TextInput type="number" min="1" step="1" value={b.days} onChange={(e) => patch(k, { days: e.target.value })} /></Field>}
          <Field label="Applicability"><Select value={b.applicability} onChange={(applicability) => patch(k, { applicability })} options={options(['applicable', 'unresolved', 'notApplicable'])} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.mandatory} onChange={(e) => patch(k, { mandatory: e.target.checked })} />Mandatory instruction</label>
          {bounds.length > 1 && <Key size="sm" variant="text" onClick={() => setBounds((rows) => rows.filter((_, i) => i !== k))}>Remove bound</Key>}
        </fieldset>)}
        <Key size="sm" variant="text" onClick={() => setBounds((rows) => [...rows, freshBound()])}>Add bound</Key>
        {bounds.some((b) => b.quantity === 'proteinPerKg') && <><Field label="Named weight basis"><Select value={basis} onChange={setBasis} options={options(['actual', 'reference', 'ffm', 'clinicianEntered'])} /></Field><Field label="Named weight · kg"><TextInput type="number" min="0" step="any" value={kg} onChange={(e) => setKg(e.target.value)} /></Field><Field label="Weight date"><TextInput type="date" value={kgOn} onChange={(e) => setKgOn(e.target.value)} /></Field><Field label="Weight kind"><Select value={kgKind} onChange={setKgKind} options={options(['dry', 'adjusted', 'ideal', 'usual', 'other'])} /></Field></>}
        <Field label="Source"><Select value={source} onChange={setSource} options={[{ value: 'selfEnteredClinician', label: 'Clinician instruction I entered' }, { value: 'document', label: 'Source document' }]} /></Field>
        <Field label="Source document or reference"><TextInput value={document} onChange={(e) => setDocument(e.target.value)} /></Field>
        <Field label="Provenance or clinician note"><TextInput value={provenance} onChange={(e) => setProvenance(e.target.value)} /></Field>
        {error && <p role="alert" className="m-0 text-sm text-danger-fg">{error}</p>}
      </form>
    </Sheet>
  </section>;
}
