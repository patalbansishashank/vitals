/**
 * Progress › Plan (living-mode.md §8.2 item 8): the version list — "v3 · weekly check-in · Thu 9 Oct — Thursday lift
 * moved to Friday" — each opening its diff in Plan details. Pause and end live in the Today menu and Plan details.
 */
import { Link } from 'react-router';
import { Faceplate, KeyLink } from '@/components';
import { useLiving } from '../../data/source';
import { fmtDay } from '../../format';
import { livingPaths } from '../../paths';
import { PROGRESS_COPY as C } from '../copy';

export function PlanSection() {
  const versions = useLiving((s) => s.versions(), []);
  return (
    <Faceplate
      id="plan"
      title={C.faces.plan}
      className="lv-prog-face"
      actions={
        <KeyLink size="sm" to={livingPaths.planActive}>
          {C.planDetails}
        </KeyLink>
      }
      footer={<p className="lv-prog-note">{C.planNote}</p>}
    >
      <ol className="lv-prog-versions">
        {versions.map((v) => (
          <li key={v.version}>
            <Link to={livingPaths.planVersion(v.version)}>{C.versionRow(v.version, v.reasonText, fmtDay(v.date), v.summary)}</Link>
          </li>
        ))}
      </ol>
    </Faceplate>
  );
}
