/**
 * Record an activity (A.3.5 item 3, package C): Cancel · Record an activity · Start. The activity (0.6.3 S26: any type of
 * the catalogue, searchable like the activity sheet's type picker, the recent and common ones first) and a GPS switch.
 * Start asks Gauge to record as the activity's coarse ring sport mode and the catalogue id: on this phone directly when
 * Gauge is installed and allows it, otherwise through the person's server (any device with a paired server). The sheet
 * says which, and waits for Gauge's answer; a start that arrives late never starts. The recording then shows in the
 * banner slot.
 *
 * (0.6.3 S4/A23) When Gauge is on this phone but Vitals may not control it yet, the sheet offers "Allow Vitals to control
 * Gauge on this phone": the system prompt on that tap only, then the local path is checked again. Declined: the server.
 */
import { useState } from 'react';
import { Chip, Field, InlineWarning, Key, ResponsivePanel, Switch, TextInput, toast } from '@/components';
import { ACTIVITY_COPY as C } from '../copy';
import { activityName } from './model';
import { gpsFix, useRecording } from './RecordBanner';
import { coarseRecordType, isRecordableActivity, recentRecordTypes, recordingWord, recordTypeChoices, rememberRecordType } from './recordType';
import './activity.css';

export function RecordSheet({ open, onClose, recent }: { open: boolean; onClose: () => void; recent?: readonly string[] }) {
  const r = useRecording();
  const pinned = [...new Set([...recentRecordTypes(), ...(recent ?? [])])].filter(isRecordableActivity);
  const [typeId, setTypeId] = useState<string>(() => pinned[0] ?? 'walk');
  const [query, setQuery] = useState('');
  const [gps, setGps] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // the picked type stays offered while a search hides it
  const found = recordTypeChoices(query, [typeId, ...pinned]);
  const choices = found.some((t) => t.id === typeId) ? found : [{ id: typeId, name: activityName(typeId) }, ...found];
  const type = coarseRecordType(typeId);
  const start = () =>
    void r.begin(type, gps, typeId).then((o) => {
      if (!o.ok) return setProblem(o.message);
      rememberRecordType(typeId);
      // (r063 FX3, S20) asked for GPS, started without it: say so, with the action that fixes it (the banner keeps it too)
      if (o.gps === 'off') {
        const fix = gpsFix(o.gpsWarning);
        toast(`${C.noGps}. ${C.noGpsWhy(o.gpsWarning)}${fix.here ? '' : ` ${fix.elsewhere}`}`, { duration: 10_000, ...(fix.here ? { action: { label: fix.label, onClick: fix.open } } : {}) });
      } else toast(C.started(recordingWord(type, typeId)));
      onClose();
    });
  const allow = () => {
    setAsking(true);
    void r.allowLocal().then((ok) => {
      setAsking(false);
      if (ok) toast(C.localAllowed);
    });
  };
  // nowhere to send it: no server and no local control yet
  const unreachable = r.via === 'server' && !r.paired;
  const disabled = r.starting ? C.waiting : asking ? C.waiting : unreachable ? C.localNeedsLink : null;
  return (
    <ResponsivePanel open={open} onClose={onClose} title={C.recordTitle} onDone={start} doneLabel={C.startKey} {...(disabled ? { doneDisabledReason: disabled } : {})}>
      <div className="lv-record">
        <Field label={C.recordType}>
          <TextInput type="search" placeholder={C.recordTypeSearch} value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <div className="lv-asheet__types" role="group" aria-label={C.recordType}>
          {choices.map((t) => (
            <Chip key={t.id} kind="filter" pressed={t.id === typeId} onPressedChange={() => setTypeId(t.id)}>
              {t.name}
            </Chip>
          ))}
        </div>
        {/* (r068 S7) the GPS switch is a full-width row with its explainer as the row's caption */}
        <div className="lv-record__gps">
          <Switch checked={gps} onChange={setGps} label={C.gps} labelStyle="sentence" className="lv-switch-row" />
          <p className="lv-act__fact">{C.gpsHelp}</p>
        </div>
        {r.localControl === 'askable' && r.via === 'server' ? (
          <div className="lv-record__local">
            <p className="lv-act__fact">{C.localAsk}</p>
            <Key variant="action" size="sm" disabled={asking} onClick={allow}>
              {C.localAllow}
            </Key>
          </div>
        ) : null}
        {r.localControl === 'declined' && r.via === 'server' ? <p className="lv-act__fact">{C.localDeclined}</p> : null}
        <p className="lv-record__via lv-act__fact">{r.starting ? C.waiting : r.via === 'local' ? C.viaLocal : unreachable ? C.localNeedsLink : C.viaServer}</p>
        {r.via === 'server' && r.paired && !r.online && !r.starting ? <InlineWarning severity="caution">{C.offline}</InlineWarning> : null}
        {problem ? <InlineWarning severity="caution">{problem}</InlineWarning> : null}
      </div>
    </ResponsivePanel>
  );
}
