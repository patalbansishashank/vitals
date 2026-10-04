import { EmptyStage, Page } from '@/components';
import { TopBar } from '@/app/shell';

/** The Ring page; owned by L-PAGES. Placeholder: the page title in the shell. */
export default function RingPage() {
  return (
    <>
      <TopBar title="Ring" />
      <Page>
        <EmptyStage title="Ring">Coming soon.</EmptyStage>
      </Page>
    </>
  );
}
