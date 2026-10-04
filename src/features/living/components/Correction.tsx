/**
 * A device-fed stream on Today: the device value with its source and a Correct action (never a disabled log field), the
 * "corrected" marker with "Use the device value again", and the correction sheet ("Device: 5 h 10 min → Yours: 6 h 00 min").
 */
import { useState } from 'react';
import { Field, Key, Section, ResponsivePanel, TextInput, toast, cx } from '@/components';
import type { LocalDate } from '@/living';
import type { BioCorrection } from '@/biometrics/core/types';
import { clearCorrection, submitCorrection, type CorrectionValueInput } from '../data/corrections';
import { KIND_WORD, deviceValueFor, useCorrections, useOwnerLabels, type OwnedKind, type OwnedStream } from '../data/useDeviceOwnership';
import { fmtDay } from '../format';
import './correction.css';

const NOTE_MAX = 500;

/** "7 h 12 min" from hours. */
export function fmtDuration(hours: number): string {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
}

/** The value the way it reads on screen ("7 h 12 min", "8,421", "81.4 kg"). */
export function fmtOwned(kind: OwnedKind, v: number): string {
  return kind === 'sleep'
    ? fmtDuration(v)
    : kind === 'steps'
      ? Math.round(v).toLocaleString('en-US')
      : `${v.toFixed(1)} kg`;
}

/** "3 Oct 08:14" in the person's local time. */
export function fmtStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The value of a correction in the stream's own unit. */
export function correctionNumber(c: BioCorrection): number | null {
  const v = c.value as { asleepS?: number; fields?: { steps?: number }; value?: number };
  if (typeof v.asleepS === 'number') return v.asleepS / 3600;
  if (typeof v.fields?.steps === 'number') return v.fields.steps;
  return typeof v.value === 'number' ? v.value : null;
}

export const kindOfCorrection = (c: BioCorrection): OwnedKind | null =>
  c.target.kind === 'sleep'
    ? 'sleep'
    : c.target.kind === 'daily' && c.target.metric === 'steps'
      ? 'steps'
      : c.target.kind === 'spot' && c.target.metric === 'weight_kg'
        ? 'weight'
        : null;

function say(r: { ok: boolean; message?: string; undo?: () => Promise<unknown> }, ok: string) {
  if (!r.ok) return toast(r.message ?? 'That didn’t work. Try again.');
  toast(ok, r.undo ? { action: { label: 'Undo', onClick: () => void r.undo?.() } } : {});
}

/** "corrected · 3 Oct 08:14 · Use the device value again", with what the device said under it when asked. */
export function CorrectedMarker({
  correction,
  kind,
  date,
  deviceValue,
  showDevice = false,
  owner,
  className,
}: {
  correction: BioCorrection;
  kind: OwnedKind;
  date: LocalDate;
  deviceValue?: number | null;
  showDevice?: boolean;
  owner?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const stamp = fmtStamp(correction.createdAt);
  return (
    <span className={cx('lv-corrected', className)} data-corrected={kind}>
      <span>{stamp ? `corrected · ${stamp}` : 'corrected'}</span>
      <Key
        variant="quiet"
        size="sm"
        disabled={busy}
        aria-label={`Use the device value again for ${KIND_WORD[kind]} on ${fmtDay(date)}`}
        onClick={() => {
          setBusy(true);
          void clearCorrection(correction.key).then((r) => {
            setBusy(false);
            say(r, 'Using the device value again.');
          });
        }}
      >
        Use the device value again
      </Key>
      {showDevice ? (
        <span className="lv-corrected__was">
          {deviceValue != null
            ? `${owner ?? 'Device'} said ${fmtOwned(kind, deviceValue)}`
            : `${owner ?? 'Device'} had no reading`}
        </span>
      ) : null}
    </span>
  );
}

/** The row's value cell for an owned stream: device value · source, Correct, and the marker when corrected. */
export function FedBy({
  stream,
  date,
  readOnly,
  onCorrect,
}: {
  stream: OwnedStream;
  date: LocalDate;
  readOnly: boolean;
  onCorrect: () => void;
}) {
  const { kind, owner, value, deviceValue, correction } = stream;
  return (
    <span className="lv-fedby" data-owned={kind}>
      {value !== null ? (
        <span>
          <span className="lm-num">{fmtOwned(kind, value)}</span>{' '}
          <span className="lv-fedby__src">· {correction ? 'you' : owner}</span>
        </span>
      ) : (
        <span className="lv-fedby__src">No reading from {owner} yet</span>
      )}
      {!readOnly ? (
        <Key variant="quiet" size="sm" aria-label={`Correct ${KIND_WORD[kind]}`} onClick={onCorrect}>
          Correct
        </Key>
      ) : null}
      {correction ? (
        <CorrectedMarker
          correction={correction}
          kind={kind}
          date={date}
          deviceValue={deviceValue}
          owner={owner}
        />
      ) : null}
    </span>
  );
}

const toNum = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** An instant for a local clock time on a date (`dayOffset` -1 = the evening before). */
function at(date: LocalDate, hhmm: string, dayOffset = 0): string {
  const d = new Date(`${date}T${hhmm}:00`);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString();
}

export interface CorrectionSheetProps {
  stream: OwnedStream | null;
  date: LocalDate;
  onClose: () => void;
}

/** The correction sheet: Device → Yours, live as the person edits; Confirm applies, Cancel closes. */
export function CorrectionSheet({ stream, date, onClose }: CorrectionSheetProps) {
  if (!stream) return <ResponsivePanel open={false} onClose={onClose} title="" />;
  return <SheetBody key={`${stream.kind}:${date}`} stream={stream} date={date} onClose={onClose} />;
}

function SheetBody({ stream, date, onClose }: { stream: OwnedStream; date: LocalDate; onClose: () => void }) {
  const { kind, owner, deviceValue, value } = stream;
  const start = value ?? deviceValue;
  const [h, setH] = useState(
    kind === 'sleep' && start !== null ? String(Math.floor(Math.round(start * 60) / 60)) : '',
  );
  const [m, setM] = useState(kind === 'sleep' && start !== null ? String(Math.round(start * 60) % 60) : '');
  const [num, setNum] = useState(
    kind !== 'sleep' && start !== null
      ? kind === 'steps'
        ? String(Math.round(start))
        : start.toFixed(1)
      : '',
  );
  const [bed, setBed] = useState('');
  const [wake, setWake] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const yours: number | null =
    kind === 'sleep'
      ? h.trim() === '' && m.trim() === ''
        ? null
        : (toNum(h || '0') ?? NaN) + (toNum(m || '0') ?? NaN) / 60
      : toNum(num);
  const valid =
    yours !== null &&
    Number.isFinite(yours) &&
    (kind === 'sleep'
      ? yours > 0 && yours <= 24
      : kind === 'steps'
        ? yours >= 0 && yours <= 200000
        : yours >= 20 && yours <= 400);
  const word = KIND_WORD[kind];

  const confirm = async () => {
    if (!valid || yours === null) {
      setError(
        kind === 'sleep'
          ? 'Enter the hours and minutes you slept.'
          : kind === 'steps'
            ? 'Enter a whole number of steps.'
            : 'Enter your weight in kg.',
      );
      return;
    }
    if (note.length > NOTE_MAX) return setError(`Keep the note under ${NOTE_MAX} characters.`);
    let v: CorrectionValueInput;
    if (kind === 'sleep') {
      const times = bed && wake ? { bedAt: at(date, bed, bed > wake ? -1 : 0), wakeAt: at(date, wake) } : {};
      v = { kind: 'sleep', asleepS: Math.round(yours * 3600), ...times };
    } else if (kind === 'steps') v = { kind: 'steps', steps: Math.round(yours) };
    else v = { kind: 'weight', kg: Math.round(yours * 10) / 10 };
    setBusy(true);
    setError(null);
    const r = await submitCorrection(date, v, note);
    setBusy(false);
    if (!r.ok) return setError(r.message ?? 'That didn’t save. Try again.');
    say(r, `Your ${word} for ${fmtDay(date)} is corrected.`);
    onClose();
  };

  return (
    <ResponsivePanel open onClose={onClose} title={`Correct ${word}`} defaultDetent="half">
      <div className="lv-correct">
        <p className="lv-correct__line" aria-live="polite">
          Device: {deviceValue !== null ? fmtOwned(kind, deviceValue) : 'no reading'} → Yours:{' '}
          {valid && yours !== null ? fmtOwned(kind, yours) : '—'}
        </p>
        <p className="lv-sheet__target">
          {fmtDay(date)} · {owner}
        </p>
        {kind === 'sleep' ? (
          <>
            <div className="lv-correct__pair">
              <Field label="hours asleep">
                <TextInput
                  inputMode="numeric"
                  value={h}
                  onChange={(e) => setH(e.target.value)}
                  name="hours"
                />
              </Field>
              <Field label="minutes">
                <TextInput
                  inputMode="numeric"
                  value={m}
                  onChange={(e) => setM(e.target.value)}
                  name="minutes"
                />
              </Field>
            </div>
            <div className="lv-correct__pair">
              <Field label="went to bed (optional)">
                <TextInput type="time" value={bed} onChange={(e) => setBed(e.target.value)} name="bed time" />
              </Field>
              <Field label="woke up (optional)">
                <TextInput
                  type="time"
                  value={wake}
                  onChange={(e) => setWake(e.target.value)}
                  name="wake time"
                />
              </Field>
            </div>
          </>
        ) : (
          <Field label={kind === 'steps' ? 'steps' : 'weight (kg)'}>
            <TextInput
              inputMode={kind === 'steps' ? 'numeric' : 'decimal'}
              value={num}
              onChange={(e) => setNum(e.target.value)}
              name={word}
            />
          </Field>
        )}
        <Field
          label="note (optional)"
          help={note.length > NOTE_MAX - 50 ? `${note.length} / ${NOTE_MAX}` : undefined}
        >
          <TextInput
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            name="note"
            placeholder="e.g. the ring was off"
          />
        </Field>
        {error ? (
          <p role="alert" className="lv-correct__line">
            {error}
          </p>
        ) : null}
        <div className="lv-correct__actions">
          <Key variant="quiet" onClick={onClose}>
            Cancel
          </Key>
          <Key onClick={() => void confirm()} disabled={busy}>
            Confirm
          </Key>
        </div>
      </div>
    </ResponsivePanel>
  );
}

/** Progress: the readings the person corrected lately, each with its marker and the device's own value. */
export function CorrectedReadings() {
  const list = useCorrections()
    .map((c) => ({ c, kind: kindOfCorrection(c) }))
    .filter((x): x is { c: BioCorrection; kind: OwnedKind } => x.kind !== null)
    .slice(0, 8);
  const owners = useOwnerLabels();
  if (list.length === 0) return null;
  return (
    <Section label="Corrected by you">
    <ul className="lv-correct__list" aria-label="Readings you corrected">
      {list.map(({ c, kind }) => {
        const mine = correctionNumber(c);
        return (
          <li key={c.key}>
            <span className="lm-eng">
              {KIND_WORD[kind]} · {fmtDay(c.target.localDate)}
            </span>
            <div className="lm-num">{mine !== null ? fmtOwned(kind, mine) : ''}</div>
            <CorrectedMarker correction={c} kind={kind} date={c.target.localDate} showDevice owner={owners[kind]} deviceValue={deviceValueFor(kind, c.target.localDate)} />
          </li>
        );
      })}
    </ul>
    </Section>
  );
}
