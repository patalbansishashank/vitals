/**
 * Score detail (`/progress/:scoreId`; design/screens/scores.md §3.2): the state word or value with its range, the
 * large baseline gauge, the 7-day mean, normal and last night with the device and tier; the history (4 wk · 12 wk ·
 * all); what it changes in the plan with the recent decisions; how it's worked out; the device; the vendor's opinion;
 * versions. Desktop: two columns. An unknown id shows an empty stage with a way back.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { EmptyStage, Engraved, Faceplate, GradeBadge, KeyBank, KeyLink, Page, Section, StatusMark, cx, EM_DASH } from '@/components';
import { TopBar } from '@/app/shell';
import { paths } from '@/app/paths';
import { ScoreHistory } from '@/features/charts/living/ScoreHistory';
import { BaselineGauge, CountScale, provenanceText, scoreValueText } from '../components/ScoreTile';
import { useToday } from '../clock';
import { useScoreDetail, type ScoreDetailModel } from '../data/scores';
import { useLiving } from '../data/source';
import { fmtDay } from '../format';
import { useAppMode } from '../mode';
import { livingPaths } from '../paths';
import { PROGRESS_COPY as C, SCORE_COPY } from './copy';
import { sliceHistory } from './model';
import { RingDetailExtras } from './ring/RingSections';

type HistoryRange = '4wk' | '12wk' | 'all';
const HISTORY_DAYS: Record<HistoryRange, number | null> = { '4wk': 28, '12wk': 84, all: null };
const FLAG_MARK = { yellow: 'info', amber: 'caution', red: 'caution' } as const;

export function ScoreDetailView({ scoreId }: { scoreId: string }) {
  const detail = useScoreDetail(scoreId);
  const { hash } = useLocation();
  const back = { to: livingPaths.progress(undefined, 'signals'), label: C.back };
  useEffect(() => {
    if (!hash) return;
    const f = window.requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' }));
    return () => window.cancelAnimationFrame(f);
  }, [hash, detail]);
  if (!detail) {
    return (
      <>
        <TopBar title={C.title} back={back} />
        <Page>
          <EmptyStage title={C.notFound} action={<KeyLink to={livingPaths.progress()}>{C.backLink}</KeyLink>}>
            {C.notFoundBody}
          </EmptyStage>
        </Page>
      </>
    );
  }
  return (
    <>
      <TopBar title={detail.heading} back={back} />
      <Page>
        <ScoreDetailBody detail={detail} />
      </Page>
    </>
  );
}

function ScoreDetailBody({ detail }: { detail: ScoreDetailModel }) {
  const { plan } = useAppMode();
  const today = useToday();
  const quiet = useLiving((s) => s.today(today)?.quietMode ?? false, [today]);
  const [range, setRange] = useState<HistoryRange>('12wk');
  const t = detail.tile;
  const prov = provenanceText(t);
  const history = sliceHistory(detail.history, HISTORY_DAYS[range]);
  const hasHistory = history.nightly.some(Number.isFinite);

  let headline: ReactNode;
  if (t.flag) {
    headline = (
      <p className="lv-detail__state">
        <StatusMark severity={FLAG_MARK[t.flag.level]} size={20} />
        <span>{t.flag.word}</span>
      </p>
    );
  } else if (t.status === 'withheld') {
    headline = <p className="lv-detail__value lm-num">{EM_DASH}</p>;
  } else if (t.display === 'number') {
    const v = scoreValueText(t, quiet);
    headline = (
      <p className="lv-detail__valueline">
        <span className="lv-detail__value lm-num">{v.main}</span>
        {v.rest.length ? <span className="lv-detail__rest"> · {v.rest.join(' · ')}</span> : null}
      </p>
    );
  } else {
    headline = <p className="lv-detail__state">{t.status === 'insufficient_baseline' ? EM_DASH : (t.state ?? EM_DASH)}</p>;
  }

  return (
    <div className="lv-detail">
      <div className="lv-detail__col">
        <Faceplate title={detail.heading} caption={C.gradeCaption(t.version, t.grade)} actions={<GradeBadge grade={t.grade} size="sm" />}>
          <div className="lv-detail__readout">
            {t.kind === 'index' || t.kind === 'estimate' ? <Engraved>{t.kind === 'index' ? SCORE_COPY.indexChip : SCORE_COPY.estimateChip}</Engraved> : null}
            {headline}
            {t.display === 'state' && t.gauge && t.normal && t.status !== 'insufficient_baseline' ? (
              <BaselineGauge
                min={t.gauge.min}
                max={t.gauge.max}
                normal={t.normal}
                {...(t.mean7 !== undefined ? { mean7: t.mean7 } : {})}
                {...(t.lastNight !== undefined ? { lastNight: t.lastNight } : {})}
                {...(t.status === 'borderline' && t.mean7Range ? { borderline: t.mean7Range } : {})}
                width={320}
                unit={t.unit}
                decimals={t.decimals}
              />
            ) : null}
            {t.status === 'withheld' && t.withheld ? <CountScale needed={t.withheld.needed} have={t.withheld.have} unit={t.withheld.unit} /> : null}
            <ul className="lv-detail__lines">
              {detail.readings.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {prov ? <li className="lv-detail__prov">{prov}</li> : null}
              {detail.confidence ? <li>{C.confidence(detail.confidence)}</li> : null}
            </ul>
            {detail.flagText ? <p className="lv-detail__flag">{detail.flagText}</p> : null}
          </div>
        </Faceplate>

        <Faceplate
          title={C.history}
          actions={
            <KeyBank<HistoryRange>
              size="sm"
              label={C.historyLabel}
              value={range}
              onChange={setRange}
              options={(Object.keys(C.historyRanges) as HistoryRange[]).map((r) => ({ value: r, label: C.historyRanges[r] }))}
            />
          }
        >
          {hasHistory ? <ScoreHistory data={history} label={detail.heading} title={`${t.title} · ${C.historyRanges[range]}`} /> : <p className="lv-prog-state">{C.noHistory}</p>}
        </Faceplate>

        {/* E29: ring views (night stages, heart-rate day, overnight readings) */}
        <RingDetailExtras scoreId={t.scoreId} {...(t.lastNight !== undefined ? { lastNight: t.lastNight } : {})} unit={t.unit} />
      </div>

      <div className="lv-detail__col">
        <Faceplate title={C.changes}>
          <p className="lv-detail__prose">{plan || !detail.changesPlan ? detail.planEffects : C.notRunning(detail.planEffects)}</p>
          <Section label={C.recentDecisions}>
            {detail.decisions.length ? (
              <ul className="lv-detail__decisions">
                {detail.decisions.map((d) => (
                  <li key={`${d.date}:${d.text}`}>
                    <Link to={livingPaths.today(d.date)}>
                      {fmtDay(d.date)} · {d.text} · {d.version} ›
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lv-prog-state">{C.noDecisions}</p>
            )}
          </Section>
        </Faceplate>

        <Faceplate title={C.worked}>
          <p className="lv-detail__prose">{detail.formula}</p>
          <Section label={C.inputs}>
            <ul className="lv-prog-list">
              {detail.inputs.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Section>
          {detail.contributors ? (
            <Section label={C.parts}>
              <table className="lv-prog-table">
                <thead>
                  <tr>
                    <th scope="col">{C.partCols.part}</th>
                    <th scope="col">{C.partCols.today}</th>
                    <th scope="col">{C.partCols.score}</th>
                    <th scope="col">{C.partCols.weight}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.contributors.map((p) => (
                    <tr key={p.part} className={cx(!p.available && 'is-missing')}>
                      <th scope="row">{p.part}</th>
                      <td>{p.today}</td>
                      <td className="lm-num">{p.score ?? EM_DASH}</td>
                      <td className="lm-num">
                        {Math.round(p.weightSet * 100)} % → {Math.round(p.weightUsed * 100)} %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ) : null}
          <p className="lv-detail__evidence">
            <Link to={paths.evidence}>{C.evidence(detail.evidence.text, detail.evidence.grade)} ›</Link>
          </p>
        </Faceplate>

        <Faceplate title={C.device}>
          <p className="lv-detail__prose">{detail.deviceText}</p>
        </Faceplate>

        {t.vendor ? (
          <Faceplate title={C.vendor}>
            <p className="lv-detail__prose lv-detail__vendor">{C.vendorText(t.vendor.name, t.vendor.says)}</p>
          </Faceplate>
        ) : null}

        <Faceplate id="versions" title={C.versions} className="lv-prog-face">
          <ol className="lv-detail__versions">
            {detail.versions.map((v) => (
              <li key={v.version}>
                <span className="lv-detail__ver">{v.version}</span>{' '}
                <span>
                  {v.current ? `${C.current}, ` : ''}
                  {fmtDay(v.date)} · {v.text}
                </span>
              </li>
            ))}
          </ol>
        </Faceplate>
      </div>
    </div>
  );
}
