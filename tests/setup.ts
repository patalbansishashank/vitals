import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Route screens are lazy chunks; when the whole suite runs in parallel on a busy machine the default 1 s for
// findBy*/waitFor is not enough for a chunk to load (QA 2026-09-30: BodyPage, route-guard tests flaked only under load).
configure({ asyncUtilTimeout: 4000 }); // stays under the 5 s test timeout
