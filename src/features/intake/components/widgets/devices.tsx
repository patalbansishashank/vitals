/** Composite turns of chapter 4 (devices and data). Nothing connects or imports from here. */
import { useState } from 'react';
import { Link } from 'react-router';
import { Key, Select } from '@/components';
import { BRANDED, coachDaily, offPolicy, recommendedPolicy, routeOf, routeText, streamsFor } from '../../chapters/devices';
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

/** D3: how each device's data would reach Vitals (computed, not a question). "Later" moves on. */
export function RoutesWidget({ values, onCommit }: WidgetProps<'later'>) {
  const devices = has(values).filter((d) => BRANDED.includes(d));
  const models = (values.models ?? {}) as Partial<Record<DeviceKind, string>>;
  const platform = values.platform as Platform | undefined;
  const [bt] = useState(bluetoothAvailable);
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
        {D.route.settingsLead}
        <Link to="/settings#devices">{D.route.settingsLink}</Link>
        {D.route.settingsTail}
      </p>
      <div className="lm-ik-done">
        <Key onClick={() => onCommit('later')}>{D.route.later}</Key>
      </div>
    </div>
  );
}

/** D4: the stream matrix; "Use recommended" and "Coach can see daily summaries" are the shortcuts. */
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
        <Key variant="quiet" onClick={() => change(coachDaily(policies))}>
          {D.matrix.coachDaily}
        </Key>
      </div>
      <StreamMatrix policies={policies} onChange={change} untouched={untouched} />
      <div className="lm-ik-done">
        <Key onClick={() => onCommit(policies)}>{TURN.done}</Key>
      </div>
    </div>
  );
}
