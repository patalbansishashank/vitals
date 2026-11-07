import '../boot';
import { ProgressOverview } from './ProgressOverview';
import './progress.css';

/** Progress (`/progress`; living-mode.md §8): one page of faceplates. */
export default function ProgressPage() {
  return <ProgressOverview />;
}
