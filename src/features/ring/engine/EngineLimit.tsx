import { useState, type FormEvent } from 'react';
import { Film, SlidersHorizontal } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  GradientCard,
  MonoMeta,
  Field,
  Key,
  ResponsivePanel,
  Stepper,
  Switch,
} from '@/components';
import { showAllowGuide } from '@/platform/gaugeEngine';
import { engine, isBusy, useGaugeEngine } from '@/state/gaugeEngine';
import { useQuietMode } from '@/state/settingsStore';
import { Facts, Val } from '../components/parts';
import { ENGINE_COPY as C } from './copy';
import { RestrictedGuide } from './RestrictedGuide';
import './engine.css';

const DEFAULT_LIMIT = 30;

/**
 * (r070) The short-video limit when the engine on this phone counts the videos: Off or N a day, and today's counts per
 * app, live from the phone. Replaces the server-command limit card once Gauge is gone; sits on the Short videos page.
 */
export function EngineLimitCard({ embedded = false }: { embedded?: boolean }) {
  const eng = useGaugeEngine();
  const quiet = useQuietMode().on;
  const [open, setOpen] = useState(false);
  const sv = eng.state?.shortVideo;
  if (!sv) return null;
  const limit = sv.enabled ? sv.dailyLimit : null;
  const failed = eng.error?.action === 'limit' ? eng.error.message : null;
  const needsAccess = sv.enabled && eng.state?.permissions.shortVideoAccessibility === false;
  const guide = eng.state ? showAllowGuide(eng.state, eng.accessAsked) : false;
  const { instagram, youtube } = sv.today;
  const controls = (
    <>
      <Key
        variant="text"
        size="sm"
        icon={SlidersHorizontal}
        loading={isBusy(eng, 'limit')}
        onClick={() => setOpen(true)}
      >
        {embedded ? 'Change limit' : C.limitChange}
      </Key>
      {needsAccess ? (
        <>
          <p className="eg-error" role="status">
            {C.limitNeedsAccess}
          </p>
          <div className="eg-keys">
            <Key
              variant="action"
              size="sm"
              loading={isBusy(eng, 'permission:shortVideoAccessibility')}
              onClick={() => void engine.fix('shortVideoAccessibility')}
              aria-label={`${C.openSettings}: ${C.permissions.shortVideoAccessibility}`}
            >
              {C.openSettings}
            </Key>
          </div>
          {guide ? <RestrictedGuide /> : null}
        </>
      ) : null}
      {failed ? (
        <p className="eg-error" role="status">
          {failed}
        </p>
      ) : null}
      {open ? <EngineLimitSheet current={limit} onClose={() => setOpen(false)} /> : null}
    </>
  );
  if (embedded) return <div className="rgv-controls">{controls}</div>;
  return (
    <GradientCard
      as="section"
      domain="videos"
      head={
        <CardHead
          as="h2"
          icon={Film}
          title={C.limit}
          info={{
            title: 'Short-video limit',
            body: 'Vitals counts Instagram Reels and YouTube Shorts on this phone. The daily limit is optional. Changing it updates the phone immediately; Android accessibility permission is needed to count the videos.',
            source: { kind: 'phone' },
          }}
        />
      }
      foot={
        <CardFoot right={quiet ? undefined : limit === null ? C.limitOff : C.limitVideos(limit)}>
          {controls}
        </CardFoot>
      }
    >
      {quiet ? (
        <MonoMeta>{limit === null ? C.limitOff : 'Limit on'}</MonoMeta>
      ) : (
        <Facts
          items={[
            {
              id: 'total',
              label: C.todayCounts,
              value: <Val value={instagram + youtube} unit={limit === null ? undefined : `of ${limit}`} />,
            },
            { id: 'ig', label: C.instagram, value: <Val value={instagram} /> },
            { id: 'yt', label: C.youtube, value: <Val value={youtube} /> },
          ]}
        />
      )}
    </GradientCard>
  );
}

function EngineLimitSheet({ current, onClose }: { current: number | null; onClose: () => void }) {
  const [on, setOn] = useState(current !== null);
  const [n, setN] = useState(current ?? DEFAULT_LIMIT);
  const formId = 'eg-limit-form';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void engine.setLimit(on ? n : null);
    onClose();
  };
  return (
    <ResponsivePanel open onClose={onClose} title={C.limitSheet} doneForm={formId} doneLabel={C.limitSave}>
      <form id={formId} className="eg-limit__form" onSubmit={submit}>
        <Switch checked={on} onChange={setOn} label={C.limitSwitch} labelStyle="sentence" />
        {on ? (
          <Field label={C.limit}>
            <Stepper
              value={n}
              onChange={setN}
              min={1}
              max={500}
              step={1}
              unit="a day"
              unitText="videos a day"
              name="daily limit"
            />
          </Field>
        ) : null}
      </form>
    </ResponsivePanel>
  );
}
