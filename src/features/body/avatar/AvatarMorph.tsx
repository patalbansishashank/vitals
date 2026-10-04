import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { lerpAvatarParams, type AvatarParams } from '@/engine/body';
import { Key, ScaleSlider, cx, useReducedMotion } from '@/components';
import { BodyAvatar, type BodyAvatarProps } from './BodyAvatar';
import { motionTokens } from './motion';

export interface AvatarMorphProps extends Omit<BodyAvatarProps, 'params' | 'compareTo' | 'tween'> {
  /** Start state (drawn as the ghost outline). */
  from: AvatarParams;
  /** End state. For "figure over time", pass the params of the last simulated day, or feed any day's params as `to` with t = 1. */
  to: AvatarParams;
  /** Scrubber position 0 (start) … 1 (end). Controlled when given. */
  t?: number;
  /** Uncontrolled start position. Default 1 (show the end state, AVATAR_SPEC §6). */
  defaultT?: number;
  /** Fires on scrub and on every animation frame while playing. */
  onTChange?: (t: number) => void;
  /** Play once on mount (and whenever `from`/`to` change). Snaps to the end under reduced motion. */
  autoPlay?: boolean;
  /** Play duration from t = 0. Default: the `--lm-dur-morph` token (900 ms), eased with `--lm-ease-in-out`. */
  durationMs?: number;
  /** Discrete playback: advance in `steps` equal steps, 120 ms each ("weekly steps", AVATAR_SPEC §6). */
  steps?: number;
  /** Render the Play key and the scrubber under the figure. */
  controls?: boolean;
  /** Scrubber readout for a t, e.g. `t => \`day ${Math.round(t * 84)}\``. */
  formatT?: (t: number) => string;
  /** Scrubber caption (lowercase, engraved). Default "time". */
  scrubberLabel?: string;
  /** Show the start state as a ghost outline. Default true. */
  ghost?: boolean;
  /** Line under the figure, e.g. "start 24.1 kg fat · 60.8 kg lean → day 84 19.8 · 61.0". */
  summary?: ReactNode;
}

interface Playback {
  from: number;
  id: number;
}

const STEP_MS = 120;
const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/**
 * Before → after morph of the two-layer figure (AVATAR_SPEC §6). Scrub with `t` (linked to the chart crosshair) or
 * press Play; the start state stays visible as a ghost envelope outline so the user sees which layer moved.
 */
export function AvatarMorph({
  from,
  to,
  t: tProp,
  defaultT = 1,
  onTChange,
  autoPlay = false,
  durationMs,
  steps,
  controls = false,
  formatT,
  scrubberLabel = 'time',
  ghost = true,
  summary,
  className,
  size = 'lg',
  ...avatarProps
}: AvatarMorphProps) {
  const reduced = useReducedMotion();
  const [inner, setInner] = useState(() => (autoPlay && !reduced ? 0 : clamp01(defaultT)));
  const [play, setPlay] = useState<Playback | null>(() => (autoPlay && !reduced ? { from: 0, id: 1 } : null));
  const [playT, setPlayT] = useState<number | null>(null);

  // autoplay again when the pair changes (derived during render, no effect)
  const [pair, setPair] = useState({ from, to });
  if (pair.from !== from || pair.to !== to) {
    setPair({ from, to });
    if (autoPlay && !reduced) setPlay({ from: 0, id: (play?.id ?? 0) + 1 });
  }

  const tBase = tProp !== undefined ? clamp01(tProp) : inner;
  const t = play ? (playT ?? play.from) : tBase;
  const params = useMemo(() => lerpAvatarParams(from, to, t), [from, to, t]);

  const onTChangeRef = useRef(onTChange);
  const controlledRef = useRef(tProp !== undefined);
  const seq = useRef(1);
  useEffect(() => {
    onTChangeRef.current = onTChange;
    controlledRef.current = tProp !== undefined;
  });

  const commit = (v: number) => {
    if (tProp === undefined) setInner(v);
    onTChangeRef.current?.(v);
  };

  const playFrom = play?.from ?? null;
  const playId = play?.id ?? null;
  useEffect(() => {
    if (playFrom === null || playId === null) return;
    const tokens = motionTokens();
    const total = Math.max(0, durationMs ?? tokens.morphMs) * (1 - playFrom);
    const ease = tokens.morphEase;
    const t0 = performance.now();
    let raf = 0;
    const finish = () => {
      setPlay(null);
      setPlayT(null);
      if (!controlledRef.current) setInner(1);
      onTChangeRef.current?.(1);
    };
    if (steps && steps > 0) {
      const first = Math.floor(playFrom * steps + 1e-9);
      raf = requestAnimationFrame(function tick() {
        const k = Math.min(steps, first + Math.floor((performance.now() - t0) / STEP_MS) + 1);
        const v = k / steps;
        setPlayT(v);
        onTChangeRef.current?.(v);
        if (k >= steps) finish();
        else raf = requestAnimationFrame(tick);
      });
    } else if (total < 16) {
      raf = requestAnimationFrame(finish);
    } else {
      raf = requestAnimationFrame(function tick() {
        const p = Math.min(1, (performance.now() - t0) / total);
        const v = playFrom + (1 - playFrom) * ease(p);
        setPlayT(v);
        onTChangeRef.current?.(v);
        if (p >= 1) finish();
        else raf = requestAnimationFrame(tick);
      });
    }
    return () => cancelAnimationFrame(raf);
  }, [playFrom, playId, durationMs, steps]);

  const playing = play !== null;
  const atEnd = tBase >= 0.999 && !playing;
  const onPlay = () => {
    if (playing) {
      const v = playT ?? tBase;
      setPlay(null);
      setPlayT(null);
      commit(v);
      return;
    }
    if (reduced) {
      commit(1);
      return;
    }
    const start = atEnd ? 0 : tBase;
    seq.current += 1;
    setPlayT(start);
    setPlay({ from: start, id: seq.current });
  };

  const stepSize = steps && steps > 0 ? 1 / steps : 0.01;
  const format = formatT ?? ((v: number) => `${Math.round(v * 100)} %`);
  const fill = size === 'fill';

  return (
    <div className={cx('lm-avatar-morph', className)} data-fill={fill || undefined}>
      <BodyAvatar {...avatarProps} size={size} params={params} compareTo={ghost ? from : undefined} tween={false} />
      {summary ? <p className="lm-avatar-morph__summary">{summary}</p> : null}
      {controls ? (
        <div className="lm-avatar-morph__controls">
          <Key
            size="sm"
            icon={playing ? Pause : atEnd ? RotateCcw : Play}
            onClick={onPlay}
            aria-label={playing ? 'Pause' : atEnd ? 'Replay from the start' : 'Play to the end'}
          >
            {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
          </Key>
          <ScaleSlider
            size="sm"
            label={scrubberLabel}
            value={t}
            min={0}
            max={1}
            step={stepSize}
            minorStep={steps && steps > 0 && steps <= 60 ? 1 / steps : 0.05}
            majorStep={0.25}
            labels={[
              { value: 0, label: 'start' },
              { value: 1, label: 'end' },
            ]}
            format={format}
            valueText={format}
            editable={false}
            onChange={(v) => {
              if (playing) {
                setPlay(null);
                setPlayT(null);
              }
              commit(v);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
