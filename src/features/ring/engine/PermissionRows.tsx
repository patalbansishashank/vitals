import { Check } from 'lucide-react';
import { Icon, Key } from '@/components';
import {
  isRuntimePermission,
  showAllowGuide,
  type EngineState,
  type PermissionKey,
} from '@/platform/gaugeEngine';
import { engine, isBusy, useGaugeEngine } from '@/state/gaugeEngine';
import { ENGINE_COPY as C } from './copy';
import { RestrictedGuide } from './RestrictedGuide';

/** The word a permission's state gets, and the fix key's label (a runtime permission asks; the other two open settings). */
function wordsOf(
  state: EngineState,
  key: PermissionKey,
): { ok: boolean; status: string; fix: string | null } {
  const v = state.permissions[key];
  if (typeof v === 'boolean') return { ok: v, status: v ? C.on : C.off, fix: v ? null : C.openSettings };
  if (v === 'granted') return { ok: true, status: C.state.granted, fix: null };
  if (v === 'unavailable') return { ok: false, status: C.state.unavailable, fix: null };
  return {
    ok: false,
    status: C.state[v],
    fix: v === 'partial' ? C.allowRest : isRuntimePermission(key) ? C.allow : C.openSettings,
  };
}

/**
 * One row per permission: its name and either a check with its state or one key that fixes it (a tap: the system prompt,
 * or the system settings screen for the accessibility and battery ones). `only` limits the rows (the move card lists all six).
 * Under the list, the "allow it first" guide when Android is holding the short-video counter back (`RestrictedGuide`).
 */
export function PermissionRows({
  items,
  withStatus = false,
}: {
  items: ReadonlyArray<{ key: PermissionKey; optional?: boolean }>;
  withStatus?: boolean;
}) {
  const eng = useGaugeEngine();
  const state = eng.state;
  if (!state) return null;
  const failed = eng.error && eng.error.action.startsWith('permission:') ? eng.error.message : null;
  const guide =
    items.some((i) => i.key === 'shortVideoAccessibility') && showAllowGuide(state, eng.accessAsked);
  return (
    <>
      <ul className="eg-perms">
        {items.map(({ key, optional }) => {
          const w = wordsOf(state, key);
          const busy = isBusy(eng, `permission:${key}`);
          return (
            <li key={key} className="eg-perm" data-ok={w.ok || undefined}>
              <span className="eg-perm__name">
                {C.permissions[key]}
                {optional && !w.ok ? <span className="eg-perm__opt"> · {C.optional}</span> : null}
              </span>
              {w.ok ? (
                <span className="eg-perm__ok">
                  <Icon icon={Check} size={16} />
                  <span>{w.status}</span>
                </span>
              ) : (
                <>
                  {withStatus ? <span className="eg-perm__status">{w.status}</span> : null}
                  {w.fix ? (
                    <Key
                      variant="action"
                      size="sm"
                      loading={busy}
                      onClick={() => void engine.fix(key)}
                      aria-label={`${w.fix}: ${C.permissions[key]}`}
                    >
                      {w.fix}
                    </Key>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {guide ? <RestrictedGuide /> : null}
      {failed ? (
        <p className="eg-error" role="status">
          {failed}
        </p>
      ) : null}
    </>
  );
}
