/**
 * `implement()` that survives import cycles: the state stores import `defs/sim` and the bus, so a def module can still
 * be mid-evaluation (its stub not registered yet) when an executor module of this package runs. When the stub is
 * missing, wait for the def modules (a dynamic import resolves once its module has evaluated; test runners resolve it
 * early for modules still in progress, so poll for a few seconds as well), then install the executor.
 */
import { implement, type Executor } from '../implement';

export function implementLate<I = never>(id: string, execute: Executor<I>, by = 'E9b'): void {
  if (implement(id, execute, by)) return;
  const poll = (left: number): void => {
    if (implement(id, execute, by) || left <= 0) return;
    setTimeout(() => poll(left - 1), 10);
  };
  void Promise.all([import('../defs/sim'), import('../defs/living'), import('../defs/intake'), import('../defs/coach')]).then(() => poll(1000));
}
