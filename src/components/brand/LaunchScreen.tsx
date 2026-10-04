import type { ReactNode } from 'react';

/** Wraps the whole app for the launch animation; owned by L-BRAND. Today it shows the app straight away. */
export function LaunchScreen({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
