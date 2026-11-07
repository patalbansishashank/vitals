/** The short videos page (Ring › Short videos) and its daily limit. */
import { useState, type FormEvent } from 'react';
import { Film, RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  ChartTwin,
  Checkbox,
  Columns,
  DottedTrack,
  Field,
  GradientCard,
  HeroNumber,
  HighlightBars,
  Key,
  MonoMeta,
  ResponsivePanel,
  StackBar,
  Stepper,
  barsTwin,
  stackTwin,
  formatNumber,
} from '@/components';
import { fmtDay } from '@/features/living/format';
import type { LocalDate } from '@/living';
import type { ReelsApp } from '@/net/gaugeCommands';
import { useQuietMode } from '@/state/settingsStore';
import { RING_COPY as C } from '../copy';
import { reelsWords, useRingCommand, useRingLink } from '../commands';
import { engineActive, useGaugeEngine } from '@/state/gaugeEngine';
import { EngineLimitCard } from '../engine/EngineLimit';
import { useShortVideo } from '../data';
import { appName, appsOf, calendarDate, daysFrom, shiftDate } from '../model';
import { displayVideoDay, limitWord } from './shortVideoModel';
import { shortVideosInfo } from '../info/videos';
import { RING_DOMAIN } from '../domains';
import type { GaugeShortVideo, GaugeShortVideoDay } from '../types';
import './videos.css';
import { useNow } from '../useGauge';
import { WhenReady } from '../components/parts';
import { quietDays } from '../quiet';

// ---------------------------------------------------------------------------------------------------------------
// The short-video brain and its limit

const REELS_APPS: ReelsApp[] = ['instagram', 'youtube'];

function LimitEditor({
  open,
  onClose,
  limit,
  countdown,
  apps,
}: {
  open: boolean;
  onClose: () => void;
  limit: number;
  countdown: number;
  apps: string[];
}) {
  const cmd = useRingCommand('reels.set');
  const [l, setL] = useState(limit);
  const [c, setC] = useState(countdown);
  const [a, setA] = useState<ReelsApp[]>(REELS_APPS.filter((x) => apps.includes(x)));
  const formId = 'rg-reels-form';
  const valid = l >= 1 && l <= 500 && c >= 3 && c <= 30 && a.length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    void cmd.send({ dailyLimit: l, countdownSeconds: c, apps: a });
    onClose();
  };
  return (
    <ResponsivePanel
      open={open}
      onClose={onClose}
      title={C.limitSheet}
      doneForm={formId}
      doneLabel={C.save}
      doneDisabled={!valid}
      doneDisabledReason={!valid ? 'Pick at least one app.' : undefined}
    >
      <form id={formId} className="rg-reels" onSubmit={submit}>
        <Field label={C.limit}>
          <Stepper
            value={l}
            onChange={setL}
            min={1}
            max={500}
            step={1}
            unit="a day"
            unitText="videos a day"
            name="daily limit"
          />
        </Field>
        <Field label={C.countdown}>
          <Stepper
            value={c}
            onChange={setC}
            min={3}
            max={30}
            step={1}
            unit="s"
            unitText="seconds"
            name="countdown"
          />
        </Field>
        <fieldset className="rg-reels__apps">
          <legend className="lm-label">{C.apps}</legend>
          {REELS_APPS.map((x) => (
            <Checkbox
              key={x}
              checked={a.includes(x)}
              onChange={(on) => setA((cur) => (on ? [...new Set([...cur, x])] : cur.filter((y) => y !== x)))}
              label={appName(x)}
            />
          ))}
        </fieldset>
        <p className="rg-note">Your phone applies it on the phone the next time it checks in.</p>
      </form>
    </ResponsivePanel>
  );
}

/** The server-command control stays with the day hero, including its live outcome and retry. */
function LimitControls({ limit }: { limit: number }) {
  const link = useRingLink();
  const cmd = useRingCommand('reels.set');
  const [open, setOpen] = useState(false);
  const reels = link.reels;
  const can = link.paired && (link.capabilities.length === 0 || link.capabilities.includes('reels.set'));
  const words = reelsWords(cmd.last);
  return (
    <div className="rgv-controls">
      {can ? (
        <Key
          variant="text"
          size="sm"
          icon={SlidersHorizontal}
          onClick={() => setOpen(true)}
          loading={cmd.pending}
        >
          {C.editLimit}
        </Key>
      ) : null}
      {!can ? (
        <p className="rg-note">
          {link.paired
            ? 'This ring app version can’t take the limit from here yet.'
            : 'Connect the ring app to your server to change the limit from here.'}
        </p>
      ) : null}
      <p className="rg-note rg-cmd-words" role="status" aria-live="polite">
        {words ?? ''}
      </p>
      {cmd.last?.lost && !cmd.pending ? (
        <Key variant="text" size="sm" icon={RotateCcw} onClick={() => void cmd.retry()}>
          {C.retry}
        </Key>
      ) : null}
      {open ? (
        <LimitEditor
          open
          onClose={() => setOpen(false)}
          limit={reels?.dailyLimit ?? limit}
          countdown={reels?.countdownSeconds ?? 10}
          apps={reels?.apps ?? REELS_APPS}
        />
      ) : null}
    </div>
  );
}

/** (r063 FX3) Quiet mode's last seven days: how often the day stayed within the limit, in words. */
function QuietWeek({
  days,
  dates,
  limit,
}: {
  days: ReadonlyArray<{ date: string; total: number; limit?: number | null }>;
  dates: readonly string[];
  limit: number | null;
}) {
  const counted = dates.flatMap((d) => {
    const day = days.find((x) => x.date === d);
    if (!day) return [];
    const bound = day.limit !== undefined ? day.limit : limit;
    return bound === null ? [] : [{ ...day, limit: bound }];
  });
  const within = counted.filter((x) => x.total <= x.limit).length;
  if (!counted.length) return <p className="rg-none">{days.length ? 'No daily limit on counted days.' : C.shortVideoNoneSent}</p>;
  const share = quietDays(within, counted.length);
  const text =
    share === 'no days'
      ? 'Over your limit on every day your phone counted.'
      : `Within your limit ${share === 'every day' ? 'on every day' : `on ${share}`} your phone counted.`;
  return <p className="rg-note">{text}</p>;
}

/** App parts retain the same order and hues in the day and history pictures. */
function appRows(day: GaugeShortVideoDay, apps: string[]) {
  return apps.map((app, i) => ({
    id: app,
    label: appName(app),
    share: day.total > 0 ? (day.counts[app] ?? 0) / day.total : 0,
    valueText: formatNumber(day.counts[app] ?? 0, 0),
    hue: i === 0 ? 'var(--lm-hue-videos)' : 'var(--lm-hue-videos-ink)',
  }));
}

function VideoHistory({
  sv,
  date,
  today,
  limit,
}: {
  sv: GaugeShortVideo;
  date: string;
  today: string;
  limit: number | null;
}) {
  const quiet = useQuietMode().on;
  const dates = daysFrom(shiftDate(date, -6), date);
  const apps = appsOf(sv.days);
  const a7 = sv.averages.last7Days;
  const a30 = sv.averages.last30Days;
  const chart = {
    name: C.last7,
    dates,
    values: dates.map((d) => sv.days.find((day) => day.date === d)?.total ?? null),
    stacks: apps.map((app) => ({
      id: app,
      label: appName(app),
      hue: 'videos' as const,
      values: dates.map((d) => {
        const day = sv.days.find((x) => x.date === d);
        return day ? (day.counts[app] ?? 0) : NaN;
      }),
    })),
    limit: limit ?? undefined,
    highlight: dates.includes(today) ? dates.indexOf(today) : null,
    hue: 'videos' as const,
    unit: 'videos',
  };
  const info = shortVideosInfo({});
  return (
    <GradientCard
      as="section"
      domain={RING_DOMAIN.videos}
      head={
        <CardHead
          as="h2"
          icon={Film}
          title={quiet ? 'The past week' : C.last7}
          info={{
            ...info,
            title: 'Short-video history',
            range: quiet
              ? undefined
              : `${limit === null ? 'Daily limit off.' : `Daily limit ${formatNumber(limit, 0)} videos.`} Averages use only days with counts.`,
            twin: quiet ? undefined : <ChartTwin data={barsTwin(chart)} />,
          }}
        />
      }
      foot={
        <CardFoot
          right={quiet ? undefined : `${a7.daysWithData} days with counts`}
          state={{ word: 'Counted on phone' }}
        />
      }
    >
      <div className="rgv-history">
        {quiet ? (
          <QuietWeek days={sv.days} dates={dates} limit={limit} />
        ) : (
          <>
            <HeroNumber
              value={a7.total}
              decimals={1}
              unit="a day"
              size="num-l"
              label={a7.total === null ? 'No average available' : `${formatNumber(a7.total, 1)} videos a day`}
            />
            <MonoMeta
              items={['Average per day', a30.total !== null ? `30-day ${formatNumber(a30.total, 1)}` : null]}
            />
            <HighlightBars {...chart} className="rgv-bars" twin={false} />
            {limit !== null ? <MonoMeta>Limit {formatNumber(limit, 0)}</MonoMeta> : null}
          </>
        )}
      </div>
    </GradientCard>
  );
}

export function ShortVideoView({ date }: { date: string }) {
  const quiet = useQuietMode().on;
  const today = calendarDate(useNow());
  const q = useShortVideo(shiftDate(date, -6), date);
  const eng = useGaugeEngine();
  const engine = engineActive(eng);
  const link = useRingLink();
  return (
    <WhenReady q={q} lines={6}>
      {(sv) => {
        const remote = sv.days.find((d) => d.date === date) ?? null;
        const local = engine && date === today ? eng.state?.shortVideo : null;
        const fallbackLimit = remote?.limit ?? [...sv.days].reverse().find((d) => d.limit)?.limit ?? 30;
        const day = displayVideoDay(date, remote, local, date === today ? link.reels?.dailyLimit : undefined);
        const limit = day?.limit ?? null;
        const word = day ? (limit === null ? 'Limit off' : limitWord(day.total, limit)) : null;
        const rows = day ? appRows(day, appsOf([day])) : [];
        const info = shortVideosInfo({});
        return (
          <Columns>
            <GradientCard
              as="section"
              domain={RING_DOMAIN.videos}
              head={
                <CardHead
                  as="h2"
                  icon={Film}
                  title={quiet ? 'This day' : fmtDay(date as LocalDate)}
                  info={{
                    ...info,
                    range: quiet
                      ? undefined
                      : limit === null
                        ? 'Daily limit off'
                        : `Your daily limit is ${formatNumber(limit, 0)} videos.`,
                    terms: [
                      ...info.terms!,
                      {
                        term: 'Countdowns',
                        text: 'How many times the countdown started, and how many you cancelled.',
                      },
                      ...(!quiet && link.reels
                        ? [
                            {
                              term: 'Countdown and apps',
                              text: `${link.reels.countdownSeconds} seconds; ${link.reels.apps.map(appName).join(' and ')}.`,
                            },
                          ]
                        : []),
                    ],
                    twin:
                      quiet || !day ? undefined : (
                        <ChartTwin data={stackTwin({ label: 'Videos by app', rows, total: day.total })} />
                      ),
                  }}
                />
              }
              foot={
                <CardFoot
                  state={word ? { word } : undefined}
                  right={quiet ? undefined : limit === null ? 'Limit off' : `Limit ${formatNumber(limit, 0)}`}
                >
                  {engine ? <EngineLimitCard embedded /> : <LimitControls limit={limit ?? fallbackLimit} />}
                </CardFoot>
              }
            >
              <div className="rgv-day">
                {day ? (
                  <>
                    <HeroNumber
                      value={day.total}
                      unit="videos"
                      size="num-l"
                      label={
                        quiet
                          ? word!
                          : `${formatNumber(day.total, 0)} ${limit === null ? 'videos' : C.videosOf(formatNumber(limit, 0))}`
                      }
                      quietWord={quiet ? word! : undefined}
                    />
                    {limit !== null ? (
                      <DottedTrack
                        label="Short videos today"
                        value={day.total}
                        goal={limit}
                        goalKind="limit"
                        valueText={`${formatNumber(day.total, 0)} videos`}
                        goalText={`limit ${formatNumber(limit, 0)}`}
                        quiet={quiet}
                        quietWord={word!}
                      />
                    ) : null}
                    <StackBar
                      label="Videos by app"
                      rows={rows}
                      total={day.total}
                      quiet={quiet}
                      legend="inline"
                    />
                    {!quiet && day.limitHits ? (
                      <MonoMeta items={[`${day.limitHits} countdowns`, C.cancelled(day.cancels ?? 0)]} />
                    ) : null}
                  </>
                ) : (
                  <p className="rg-none">{C.shortVideoNotSent(date === today)}</p>
                )}
              </div>
            </GradientCard>
            <VideoHistory sv={sv} date={date} today={today} limit={limit} />
          </Columns>
        );
      }}
    </WhenReady>
  );
}
