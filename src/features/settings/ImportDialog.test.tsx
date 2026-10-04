import { render, screen } from '@testing-library/react';
import type { ImportPreview } from '@/state/persistence';
import { ImportDialog, holdsNoUserData } from './ImportDialog';

const entry = (key: string, exists: boolean) => ({ key, label: key, version: 1, summary: key, exists, registered: true });
const preview = (entries: ReturnType<typeof entry>[]): ImportPreview => ({ ok: true, data: { vitalsVersion: '1', stores: {} } as never, exportedAt: null, appVersion: '0.2.0', entries, damaged: [] });
const open = (p: ImportPreview) => render(<ImportDialog state={{ fileName: 'x.json', result: p }} onClose={() => undefined} onChooseAnother={() => undefined} />);

describe('Import defaults', () => {
  it('a device holding only the starter scenario and default settings counts as empty', () => {
    expect(holdsNoUserData([entry('vitals.scenarios', true), entry('vitals.settings', true), entry('vitals.ui.lastRoute', true)])).toBe(true);
    expect(holdsNoUserData([entry('vitals.scenarios', true), entry('vitals.body', true)])).toBe(false);
  });

  it('defaults to Replace on an empty device, so the starter scenario is not duplicated', () => {
    open(preview([entry('vitals.scenarios', true), entry('vitals.settings', true), entry('vitals.body', false)]));
    expect(screen.getByRole('radio', { name: /Replace everything/ })).toBeChecked();
  });

  it('defaults to Merge when the device holds the person’s own data', () => {
    open(preview([entry('vitals.scenarios', true), entry('vitals.body', true)]));
    expect(screen.getByRole('radio', { name: /Merge/ })).toBeChecked();
  });
});
