import '../boot';
import { useParams } from 'react-router';
import { ProgressOverview } from './ProgressOverview';
import { ScoreDetailView } from './ScoreDetail';
import './progress.css';

/**
 * Progress (`/progress`, `/progress/:metric`; living-mode.md §8, scores.md): the overview of faceplates, or — when
 * `:metric` is a score id — that score's detail.
 */
export default function ProgressPage() {
  const { metric } = useParams();
  return metric ? <ScoreDetailView scoreId={metric} /> : <ProgressOverview />;
}
