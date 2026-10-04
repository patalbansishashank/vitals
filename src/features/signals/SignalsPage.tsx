import { EmptyStage, Page } from '@/components';
import { TopBar } from '@/app/shell';

/** The Body signals page; owned by L-PAGES. Placeholder: the page title in the shell. */
export default function SignalsPage() {
  return (
    <>
      <TopBar title="Body signals" />
      <Page>
        <EmptyStage title="Body signals">Coming soon.</EmptyStage>
      </Page>
    </>
  );
}
