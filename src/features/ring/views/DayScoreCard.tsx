/** The Day score card (Ring › Overview, Ring › Scores) and the Day-score target editor. */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import '@/commands/defs/settings'; // registers `settings.update`
import { sendCommand } from '@/features/lib/sendCommand';
import { CardFoot, CardHead, ChartTwin, DottedTrack, Field, GlowLine, GradientCard, HeroNumber, MonoMeta, RadialTicks, ResponsivePanel, Stepper, formatNumber, lineTwin, type RadialPart } from '@/components';
import { Gauge } from 'lucide-react';
import { useQuietMode } from '@/state/settingsStore';
import { RING_COPY as C } from '../copy';
import { validDayScoreTarget } from '../goals';
import type { RingDay } from '../day';
import { dayArcs } from '../indices';
import { RING_DOMAIN, INDEX_DOMAIN } from '../domains';
import { dayScoreInfo } from '../info/scores';
import { sleepBand } from '../model';
import { ringPaths } from '../paths';
import { Loading } from '../components/parts';
import type { VitalsIndexHistory } from '../history';
import './scores.css';

// ---------------------------------------------------------------------------------------------------------------
// Day score

/** "based on 3 of 3" and, for quiet mode, its words ("based on all three parts"). */
export function basedOnText(n: number, quiet: boolean): string {
  if (!quiet) return `based on ${n} of 3`;
  return n >= 3
    ? 'based on all three parts'
    : n === 2
      ? 'based on two of the three parts'
      : n === 1
        ? 'based on one of the three parts'
        : 'based on none of the parts yet';
}

/** A whole-number target 0–100 (inclusive: 0 is a valid target, S33/A36), or null when the text is not one. */
export function parseTarget(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return validDayScoreTarget(n) ? n : null;
}

/** The Day-score target editor (A.1.2 #42, D17): applies at once through `settings.update` (the synced `dayScoreTarget`). */
function TargetSheet({ open, onClose, current }: { open: boolean; onClose: () => void; current: number }) {
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const valid = validDayScoreTarget(value);
  const formId = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const r = await sendCommand('settings.update', { patch: { dayScoreTarget: value } }, { silent: true });
    setSaving(false);
    if (r.ok) onClose();
    else setError(C.targetFailed);
  };
  return (
    <ResponsivePanel
      open={open}
      onClose={onClose}
      title={C.targetTitle}
      doneForm={formId}
      doneLabel="Save"
      doneDisabled={!valid || saving}
      doneDisabledReason={!valid ? C.targetInvalid : saving ? 'Saving' : undefined}
    >
      <form id={formId} className="rg-target" onSubmit={(e) => void submit(e)}>
        {/* (r068 SC4) a whole number from 0 to 100 is a stepper, as the short-video limit is */}
        <Field label={C.targetLabel}>
          <Stepper value={value} onChange={(v) => (setValue(v), setError(null))} min={0} max={100} step={1} unit="/ 100" unitText="out of 100" name="target" />
        </Field>
        {error ? (
          <p className="rg-note rg-target__error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </ResponsivePanel>
  );
}

/**
 * The Day score (r071, AUDIT cards 1 and 10): the page's one ring, three arcs (recovery, activity, sleep, each in its own hue,
 * a dashed lit arc where the part is low-confidence, a dashed outline where it is missing), the score inside it with its band
 * word, and under or beside it the three parts as rows (name, value, a short track in the part's hue). On the Overview the
 * whole card opens Ring › Scores; on Scores (`link={false}`) each part keeps its "What went into it" drawer and the foot's
 * key edits the target. The explanation is the (i). Quiet: the ring lit in three steps, the band word, no digit.
 */
export function DayScoreCard({ date, day, link = true, infoFooter, parts: showParts = 'rows', trend }: { date: string; day: RingDay; link?: boolean; infoFooter?: ReactNode; parts?: 'rows' | 'none'; trend?: VitalsIndexHistory | null }) {
  const quiet = useQuietMode().on;
  const [editing, setEditing] = useState(false);
  const s = day.scores;
  const arcs = s ? dayArcs(s) : [];
  const share = !link && s ? (s.day.effectiveSleepShare ?? null) : null;
  const score = s && s.day.value !== null ? Math.round(s.day.value) : null;
  const target = day.goals.dayScore;
  const band = score === null ? null : sleepBand(score);
  const needsWord = (needs: string | undefined): string => !quiet ? needs ?? 'No score yet' : needs?.includes('night') ? 'Needs more nights' : needs?.includes('steps') ? 'Needs steps' : 'Not enough data yet';
  const parts: RadialPart[] = arcs.map((a) => ({ id: a.id, label: a.label, value: a.score, hue: INDEX_DOMAIN[a.id as keyof typeof INDEX_DOMAIN], ...(a.confidence ? { confidence: a.confidence } : {}), ...(a.needs ? { needs: needsWord(a.needs) } : {}) }));
  const partsText = arcs.map((a) => `${a.label.toLowerCase()} ${a.score === null ? needsWord(a.needs) : quiet ? sleepBand(a.score).toLowerCase() : a.score}`).join(', ');
  const spoken =
    score === null
      ? `${C.dayScore}, no score yet`
      : quiet
        ? `${C.dayScore}, ${band!.toLowerCase()}: ${partsText}`
        : `${C.dayScore} ${score} of 100: ${partsText}; target ${target}; ${basedOnText(s!.day.basedOn, false)}`;
  const targetWord = score === null ? null : quiet ? (score >= target ? 'At or above your target' : 'Below your target') : `Target ${formatNumber(target, 0)}`;
  const ready = !!s;
  const line = { label: C.dayScore, unit: '/ 100', series: (trend?.dates ?? []).map((d, i) => ({ t: Date.parse(`${d}T12:00:00Z`), v: Number.isFinite(trend?.day[i]) ? trend!.day[i]! : null })) };
  const info = { ...dayScoreInfo({ quiet, weights: !link, share, legacy: s?.source === 'legacy', footer: infoFooter }), twin: !quiet && trend && s?.source === 'vitals' ? <ChartTwin data={lineTwin(line)} /> : undefined };
  return (
    <GradientCard
      as="section"
      domain={RING_DOMAIN.dayScore}
      href={link && ready ? ringPaths.tab('scores', date) : undefined}
      head={<CardHead as="h2" icon={Gauge} title={C.dayScore} meta={!link ? <MonoMeta>{s?.source === 'legacy' ? 'On-device (legacy)' : 'Vitals'}</MonoMeta> : undefined} info={info} />}
      foot={
        ready && score !== null ? (
          <CardFoot
            state={{ word: band! }}
            right={targetWord}
            link={!link && !quiet ? { label: C.editTarget, onClick: () => setEditing(true) } : undefined}
          />
        ) : undefined
      }
    >
      {day.q.status === 'loading' ? <Loading lines={4} /> : null}
      {s ? (
        <div className="rgs-day" data-parts={showParts}>
          <div className="rgs-day__ring">
            <RadialTicks
              label={C.dayScore}
              value={score}
              max={100}
              parts={parts}
              legend={false}
              size="lg"
              state={score === null ? 'none' : s.learning ? 'learning' : 'normal'}
              quiet={quiet}
              spoken={spoken}
              centre={
                <>
                  <HeroNumber value={score} size="num" label={score === null ? C.dayScore : quiet ? `${C.dayScore}, ${band}` : `${score} of 100`} quietWord={quiet && band ? band : undefined} />
                  {quiet || !band ? null : <MonoMeta tone="hue">{band}</MonoMeta>}
                </>
              }
            />
            {s.day.basedOn < 3 ? <MonoMeta>{basedOnText(s.day.basedOn, quiet)}</MonoMeta> : null}
          </div>
          {showParts === 'rows' ? <ul className="rgs-parts" aria-label={`${C.dayScore} parts`}>
            {arcs.map((a) => {
              const hue = INDEX_DOMAIN[a.id as keyof typeof INDEX_DOMAIN];
              return (
                <li key={a.id} className="rgs-part" data-hue={hue} data-low={a.confidence === 'low' || undefined}>
                  <div className="rgs-part__row">
                    <span className="rgs-part__name">{a.label}</span>
                    {a.score === null ? (
                      <MonoMeta>{needsWord(a.needs)}</MonoMeta>
                    ) : quiet ? (
                      <MonoMeta tone="hue">{sleepBand(a.score)}</MonoMeta>
                    ) : (
                      <span className="rgs-part__val lm-num">
                        {formatNumber(a.score, 0)}
                        <span className="lm-unit">/ 100</span>
                      </span>
                    )}
                  </div>
                  {a.score !== null ? (
                    <div className="rgs-part__track">
                      <DottedTrack label={`${a.label} score`} value={a.score} goal={100} valueText={`${formatNumber(a.score, 0)} of 100`} hue={hue} dots={12} thumb={false} quiet={quiet} quietWord={sleepBand(a.score)} />
                      {a.confidence === 'low' ? <MonoMeta className="rgs-part__low">{C.lowConfidence}</MonoMeta> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul> : !quiet && trend && s.source === 'vitals' ? <div className="rgs-day__trend"><MonoMeta>Vitals · last {trend.dates.length} days</MonoMeta><GlowLine {...line} series={trend.day.map((v) => Number.isFinite(v) ? v : null)} variant="spark" smoothing="spark" height={96} yTicks={0} xTicks="none" area hue="recovery" endDot="static" twin={false} /></div> : null}
        </div>
      ) : null}
      {editing ? <TargetSheet open onClose={() => setEditing(false)} current={target} /> : null}
    </GradientCard>
  );
}
