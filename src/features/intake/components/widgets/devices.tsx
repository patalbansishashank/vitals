/** Composite turns of chapter 4 (devices and data). Nothing connects or imports from here. */
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Key, Select, cx } from '@/components';
import { BRANDED, offPolicy, recommendedPolicy, routeOf, routeText, streamsFor } from '../../chapters/devices';
import { BRANDS, D, TURN } from '../../copy';
import type { DeviceKind, Platform, StreamId, StreamPolicy } from '../../types';
import { StreamMatrix } from '../StreamMatrix';
import type { WidgetProps } from '../widgetTypes';

const has = (values: Readonly<Record<string, unknown>>) => ((values.has as DeviceKind[] | undefined) ?? []).filter((d) => d !== 'none');

/** D2: brand per device ("not sure" allowed). */
export function ModelsWidget({ value, values, onCommit }: WidgetProps<Partial<Record<DeviceKind, string>>>) {
  const devices = has(values).filter((d) => BRANDED.includes(d));
  const [models, setModels] = useState<Partial<Record<DeviceKind, string>>>(() => ({ ...(value ?? {}) }));
  const options = [...BRANDS.map((b) => ({ value: b as string, label: b as string })), { value: D.which.notSure, label: D.which.notSure }];
  return (
    <div className="lm-ik-row">
      {devices.map((d) => (
        <div key={d} className="lm-ik-inline">
          <span className="lm-ik-row__label">{D.which.device(D.has.options[d])}</span>
          <Select label={D.which.device(D.has.options[d])} placeholder={D.which.search} value={models[d]} onChange={(b) => setModels((m) => ({ ...m, [d]: b }))} options={options} />
        </div>
      ))}
      <div className="lm-ik-done">
        <Key
          onClick={() => {
            const out: Partial<Record<DeviceKind, string>> = {};
            for (const d of devices) out[d] = models[d] ?? D.which.notSure;
            onCommit(out);
          }}
        >
          {TURN.done}
        </Key>
      </div>
    </div>
  );
}

const bluetoothAvailable = (): boolean => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

/** D3: how each device's data would reach Vitals (computed, not a question). The card's own Next moves on. */
export function RoutesWidget({ values }: WidgetProps<'seen'>) {
  const devices = has(values).filter((d) => BRANDED.includes(d));
  const models = (values.models ?? {}) as Partial<Record<DeviceKind, string>>;
  const platform = values.platform as Platform | undefined;
  const [bt] = useState(bluetoothAvailable);
  const ring = devices.includes('ring');
  const others = devices.some((d) => d !== 'ring');
  const settings = <Link to="/settings#devices">{D.route.settingsLink}</Link>;
  return (
    <div className="lm-ik-row">
      <ul className="lm-ik-routes">
        {devices.map((d) => {
          const brand = models[d] ?? D.which.notSure;
          const kind = routeOf(d, brand, platform, bt);
          return (
            <li key={d} className="lm-ik-route">
              <span className="lm-ik-route__name">
                {D.has.options[d]}
                {brand !== D.which.notSure ? ` · ${brand}` : ''}
              </span>
              <span className="lm-ik-route__text">{routeText(kind, brand)}</span>
            </li>
          );
        })}
      </ul>
      <p className="lm-ik-note">
        {D.route.nothingHere}
        {ring ? (
          <>
            {D.route.ringLead}
            <Link to="/ring">{D.route.ringLink}</Link>
            {others ? (
              <>
                {D.route.andOthers}
                {settings}
              </>
            ) : null}
          </>
        ) : (
          <>
            {D.route.anyLead}
            {settings}
          </>
        )}
        {D.route.end}
      </p>
    </div>
  );
}

/** "How your data is used": a closed disclosure next to the stream choices (the same pattern as "why we ask"). */
function HowUsed() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="lm-ik-turn__why">
      <button type="button" className="lm-ik-why" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {D.howUsed.key}
        <span aria-hidden="true" className={cx('lm-ik-why__chev', open && 'is-open')}>
          ▾
        </span>
      </button>
      <div id={id} className="lm-ik-howused" hidden={!open}>
        {D.howUsed.lines.map((line) => (
          <p key={line} className="lm-ik-why__text">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

/** D4: the stream matrix; "Use recommended" is the shortcut (the shared ring default, Coach sees daily + detail). */
export function StreamsWidget({ value, values, onCommit }: WidgetProps<StreamPolicy[]>) {
  const offered = streamsFor(has(values));
  const [policies, setPolicies] = useState<StreamPolicy[]>(() => offered.map((s) => value?.find((p) => p.stream === s) ?? offPolicy(s)));
  const [untouched, setUntouched] = useState<Set<StreamId>>(() => new Set(value ? [] : offered));
  if (!offered.length) return <p className="lm-ik-note">{D.matrix.none}</p>;
  const change = (next: StreamPolicy[]) => {
    const changed = next.filter((p, i) => JSON.stringify(p) !== JSON.stringify(policies[i])).map((p) => p.stream);
    setUntouched((u) => new Set([...u].filter((s) => !changed.includes(s))));
    setPolicies(next);
  };
  return (
    <div className="lm-ik-row">
      <div className="lm-ik-actions">
        <Key
          onClick={() => {
            setPolicies(offered.map(recommendedPolicy));
            setUntouched(new Set());
          }}
        >
          {D.matrix.recommended}
        </Key>
      </div>
      <p className="lm-ik-note">{D.matrix.recommendedNote}</p>
      <HowUsed />
      <StreamMatrix policies={policies} onChange={change} untouched={untouched} />
      <div className="lm-ik-done">
        <Key onClick={() => onCommit(policies)}>{TURN.done}</Key>
      </div>
    </div>
  );
}
