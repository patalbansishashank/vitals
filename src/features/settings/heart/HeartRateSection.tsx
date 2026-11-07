/**
 * Settings › Heart rate (energy SPEC §V4.7, §V2.1, D1, D2, D3, D6). Groups:
 *  - Maximum: the measured upward suggestion first when there is one (`suggestHrMaxRaise`: accept raises the maximum,
 *    "Keep" declines that value; it shows again only for a higher one), then the value with how it was made (age-based
 *    Tanaka ±10 bpm, or set by you) and "Use the estimate" to drop an entered value.
 *  - Resting: the WAKING resting rate you enter, and the D6 opt-in to use the ring's sleeping low instead (off by default;
 *    the sleeping low is lower than a waking rate, which the help line says with your own number).
 *  - Zones: the basis in use and why, the five zones as `freezeZoneBoundaries` would freeze them into the next approved
 *    workout (a frozen workout never changes) drawn as one five-band bar with its bpm edges (r068 S18; the same values
 *    as a table for assistive tech), and how every value is estimated in a sheet (r068 S21).
 *  - Calories: the D2 heart-rate calories switch. (The step rules are Settings › Steps since r068 S20.)
 * Every control applies at once; "Saved" flashes in the header when the change went through. A change that is refused
 * shows its reason in place with "Try again", and the earlier value stays in force.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { CardFoot, InlineWarning, Key, MonoMeta, NumberField, Switch } from '@/components';
import { useInView, useSweep } from '@/app/motion';
import { useQuietMode } from '@/state/settingsStore';
import { ZONE_WORDS } from '@/features/lib/zoneRange';
import { useToday } from '@/features/living/clock';
import { useProgressGauge } from '@/features/living/progress/data/gauge';
import { restingProxyOf } from '@/net/gauge';
import { useBodyEstimate } from '@/state/profileStore';
import { SettingRow, SettingsGroup, SettingsItem, useSavedFlash } from '../SettingRow';
import { SettingsSection } from '../sections';
import { HEART_COPY as C } from './copy';
import { profileOf, suggestionOf, zoneRows, zonesOf, type ZoneRow } from './model';
import { applyHeartSettings, useHeartSettings, useHrMaxEvidenceBouts } from './v3Adapter';
import './heart.css';

type Patch = Parameters<typeof applyHeartSettings>[0];

/** The zone names and edges share one bar; the table is its exact numerical twin outside quiet mode. */
function ZoneBar({ rows, quiet, seen }: { rows: ZoneRow[]; quiet: boolean; seen?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const lit = useSweep(rows.length, { stagger: 60, start: inView });
  const edges = [rows[0]!.fromBpm, ...rows.map((z) => z.toBpm)];
  return (
    <div ref={ref} className="settings-zbar" aria-hidden="true">
      <div className="settings-zbar__names">
        {rows.map((z) => (
          <span key={z.zone}>{ZONE_WORDS[z.zone - 1]}</span>
        ))}
      </div>
      <div className="settings-zbar__track">
        {rows.map((z, i) => (
          <span key={z.zone} style={{ background: `var(--lm-hr-zone-${z.zone})`, opacity: i < lit ? 1 : 0.17 }} />
        ))}
      </div>
      {!quiet ? (
        <>
          <div className="settings-zbar__ticks">
            {edges.map((b, i) => (
              <span key={i} style={{ left: `${i * 20}%` }} data-edge={i === 0 ? 'start' : i === edges.length - 1 ? 'end' : undefined}>
                {b}
              </span>
            ))}
          </div>
          <MonoMeta className="settings-zbar__unit">bpm</MonoMeta>
          {seen !== undefined ? (
            <div className="settings-zbar__seen">
              <span>{seen} seen</span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Toggle({ label, help, checked, onChange, disabled }: { label: string; help?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <SettingRow label={label} help={help}>
      {({ labelId, helpId }) => <Switch checked={checked} labelledBy={labelId} describedBy={helpId} onChange={onChange} disabled={disabled} />}
    </SettingRow>
  );
}

function BpmRow({
  label,
  name,
  help,
  value,
  min,
  max,
  onChange,
  onClear,
  clearLabel,
  placeholder,
}: {
  label: string;
  name: string;
  help?: ReactNode;
  value: number | null;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onClear?: () => void;
  clearLabel: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <SettingRow label={<label htmlFor={id}>{label}</label>} help={help} wide>
      {() => (
        <div className="settings-heart__bpm">
          <NumberField
            id={id}
            name={name}
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={1}
            unit="bpm"
            inputMode="numeric"
            placeholder={placeholder}
            className="settings-heart__field"
          />
          {onClear ? (
            <Key size="sm" variant="outlined" onClick={onClear}>
              {clearLabel}
            </Key>
          ) : null}
        </div>
      )}
    </SettingRow>
  );
}

export function HeartRateSection() {
  const [saved, flash] = useSavedFlash();
  const s = useHeartSettings();
  const quiet = useQuietMode().on;
  const body = useBodyEstimate();
  const today = useToday();
  const base = useProgressGauge(`baselines:${today}`, (api) => api.baselines(today));
  // (0.6.3 FX5) the ring's sleeping low when ready, else Health Connect's resting HR (labelled): the import's own choice
  const proxy = base.status === 'ready' ? restingProxyOf(base.data) : null;
  const sleepingLow = proxy?.bpm ?? null;
  const age = body.missing.includes('age') ? null : body.ageYears;
  const p = profileOf(s, age, sleepingLow);
  const zones = zonesOf(p);
  const rows = zoneRows(zones);
  // the suggestion's 180-day window is read when the page opens
  const [now] = useState(() => Date.now());
  const suggestion = suggestionOf(p, useHrMaxEvidenceBouts(now), now, s.hrMaxSuggestionDeclinedBpm);
  // a change that failed stays on screen (with its reason and a retry) until it is retried, dismissed or superseded;
  // the controls keep showing the value still in force, because nothing was written
  const [failure, setFailure] = useState<{ message: string; patch: Patch } | null>(null);
  const save = (patch: Patch) => {
    void applyHeartSettings(patch).then((r) => {
      if (r.ok) {
        setFailure(null);
        flash();
      } else {
        setFailure({ message: r.message, patch });
      }
    });
  };
  const restOverride = s.hrProfile.hrRestOverride ?? null;
  const maxOverride = s.hrProfile.hrMaxOverride ?? null;

  const maxHelp = p.hrMax === null ? C.needsAge : p.hrMax.source === 'override' ? C.setByYou : quiet ? C.fromAgeQuiet : C.fromAge(p.hrMax.sdBpm ?? 10);
  const why =
    p.basisReason === 'hrrAvailable' && p.hrRest && p.hrMax
      ? C.basisWhy.hrrAvailable(p.hrRest.bpm, p.hrMax.bpm)
      : p.basisReason === 'hrrAvailable'
        ? undefined
        : C.basisWhy[p.basisReason];

  return (
    <SettingsSection id="heart" title={C.title} saved={saved}>
      {failure ? (
        <SettingsItem className="settings-heart__failed">
          <InlineWarning
            severity="caution"
            alert
            action={
              <span className="settings-keys">
                <Key size="sm" variant="action" onClick={() => save(failure.patch)}>
                  {C.retry}
                </Key>
                <Key size="sm" variant="text" onClick={() => setFailure(null)}>
                  {C.dismiss}
                </Key>
              </span>
            }
          >
            {C.failed(failure.message)}
          </InlineWarning>
        </SettingsItem>
      ) : null}
      {/* maximum and resting in one group: a card per rate repeated its row's name (r068 V12) */}
      <SettingsGroup label={C.groups.rates}>
        {suggestion ? (
          <SettingsItem className="settings-heart__suggest">
            <div className="settings-heart__suggest-text" role="status">
              <p className="settings-text">{quiet ? C.suggestTitleQuiet : C.suggestTitle(suggestion.suggestedBpm)}</p>
              <p className="settings-note">{quiet ? C.suggestBodyQuiet : C.suggestBody(suggestion.boutIds.length, suggestion.currentBpm)}</p>
            </div>
            <div className="settings-keys">
              <Key
                size="sm"
                variant="action"
                onClick={() =>
                  save({
                    hrProfile: { hrMaxOverride: suggestion.suggestedBpm },
                    hrMaxSuggestionDeclinedBpm: null,
                  })
                }
              >
                {quiet ? C.raiseQuiet : C.raise(suggestion.suggestedBpm)}
              </Key>
              <Key size="sm" variant="text" onClick={() => save({ hrMaxSuggestionDeclinedBpm: suggestion.suggestedBpm })}>
                {quiet ? C.keepQuiet : C.keep(suggestion.currentBpm)}
              </Key>
            </div>
          </SettingsItem>
        ) : null}
        <BpmRow
          label={C.hrMax}
          name={C.hrMaxName}
          help={maxHelp}
          value={quiet ? maxOverride : p.hrMax ? Math.round(p.hrMax.bpm) : null}
          placeholder={quiet && maxOverride === null ? C.fromAgeQuiet : undefined}
          min={100}
          max={240}
          onChange={(v) => save({ hrProfile: { hrMaxOverride: v } })}
          {...(maxOverride !== null && age !== null ? { onClear: () => save({ hrProfile: { hrMaxOverride: null } }) } : {})}
          clearLabel={C.useEstimate}
        />
        <BpmRow
          label={C.hrRest}
          name={C.hrRestName}
          help={C.hrRestHelp}
          value={restOverride}
          min={30}
          max={120}
          onChange={(v) => save({ hrProfile: { hrRestOverride: v } })}
          {...(restOverride !== null ? { onClear: () => save({ hrProfile: { hrRestOverride: null } }) } : {})}
          clearLabel={C.clear}
          placeholder={quiet ? undefined : C.hrRestPlaceholder}
        />
        <Toggle
          label={C.sleepLow}
          help={restOverride !== null ? C.sleepLowShadowed : quiet ? C.sleepLowHelpQuiet : C.sleepLowHelp(sleepingLow, proxy?.source)}
          checked={s.hrProfile.useSleepLowAsRest}
          onChange={(v) => save({ hrProfile: { useSleepLowAsRest: v } })}
        />
      </SettingsGroup>

      <SettingsGroup
        label={C.groups.zones}
        info={{
          title: C.how,
          body: (quiet ? C.howTextQuiet : [C.zoneScale(p.basis), ...C.howText]).map((body) => ({ body })),
        }}
      >
        <SettingsItem className="settings-heart__zones">
          {/* the basis is a fact, not a choice: the group's first line, with why (r068 S19) */}
          <p className="settings-heart__basis">
            <MonoMeta className="settings-heart__basis-name">{C.bases[p.basis]}</MonoMeta>
            {!quiet && why ? <MonoMeta className="settings-heart__basis-why">{why}</MonoMeta> : null}
          </p>
          {rows.length ? (
            <>
              <ZoneBar rows={rows} quiet={quiet} seen={suggestion?.suggestedBpm} />
              {quiet ? (
                <p className="lm-sr">{ZONE_WORDS.join(', ')}</p>
              ) : (
                <table className="lm-sr" aria-label={C.zonesLabel}>
                  <thead>
                    <tr>
                      <th scope="col">{C.zoneCols.zone}</th>
                      <th scope="col">{C.zoneCols.bpm}</th>
                      <th scope="col">{C.zoneCols.share}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((z) => (
                      <tr key={z.zone}>
                        <th scope="row">{C.zone(z.zone)}</th>
                        <td>{C.bpmRange(z.fromBpm, z.toBpm, z.zone === 5)}</td>
                        <td>{C.pctRange(z.fromPct, z.toPct, z.zone === 5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
          <CardFoot
            state={{
              word: p.hrMax === null ? C.basisWhy.noHrMax : p.hrMax.source === 'override' ? C.setByYou : C.fromAgeQuiet,
            }}
            right={!quiet && p.hrMax ? `${Math.round(p.hrMax.bpm)} bpm` : undefined}
          />
          <p className="settings-note">{C.frozen}</p>
        </SettingsItem>
      </SettingsGroup>

      <SettingsGroup
        label={C.groups.calories}
        info={{
          title: C.keytel,
          body: C.keytelHelp,
          evidence: {
            to: '/evidence/10-wearable-calorie-error',
            label: 'How accurate are wrist devices at counting calories?',
          },
        }}
      >
        <Toggle label={C.keytel} help={C.keytelHelp} checked={s.keytelEnabled} onChange={(v) => save({ keytelEnabled: v })} />
      </SettingsGroup>
    </SettingsSection>
  );
}
