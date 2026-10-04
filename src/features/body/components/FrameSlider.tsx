/**
 * Frame slider (COMPONENTS §13.3, body-figure-v2.md §5.4): one continuous, wordless-at-the-ends control for the
 * figure's drawn frame, 0 = hips-led … 1 = shoulders-led. Drawing only: it never changes an estimate, and the
 * physiology never reads it. Readout and `aria-valuetext` are the five shape words of the DRAWN shoulder:hip breadth
 * ratio, so the words follow what is on screen. No sex or gender words on or near it.
 *
 * Writes `profile.figure.frame` through `profile.patch`: every 250 ms while dragging and on release (the store
 * coalesces them into one change); the figure follows the drag frame by frame through `onDraft`.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Key, ScaleSlider } from '@/components';
import type { AvatarParams } from '@/engine/body';
import { frameSliderWords } from '@/features/body/avatar';
import { patchProfile } from '../commands';
import { DRAWING } from '../copy';

export interface FrameSliderProps {
  /** The figure's params (the readout words are measured on the drawing at each position). */
  params: AvatarParams;
  /** Frame shown (the draft while dragging, else stored or "match my basics"). */
  value: number;
  /** "Match my basics" position (0, 1, or 0.5 for "prefer not to say"). */
  basics: number;
  /** The stored frame is null: it follows the basics. */
  matchesBasics: boolean;
  /** Live position while dragging (null = drop the draft). */
  onDraft: (frame: number | null) => void;
  /** A gesture or key step finished. */
  onCommit?: () => void;
}

const SEND_MS = 250;
const KEY_STEP = 0.05;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1000) / 1000;

/** 24 × 32 front-torso outlines for the ends (decorative). */
function EndCap({ end }: { end: 'hips' | 'shoulders' }) {
  const d =
    end === 'hips'
      ? 'M10.5 1.5V4C8 4.6 6.6 5.4 6.2 7.6 5.9 10 7.2 13.8 7.4 17 7.5 20 4.6 23 4.2 27V30.5H19.8V27C19.4 23 16.5 20 16.6 17 16.8 13.8 18.1 10 17.8 7.6 17.4 5.4 16 4.6 13.5 4V1.5'
      : 'M10.5 1.5V4C6.5 4.6 3 5.4 2.4 8 2 10.6 6 13.6 6.8 17 7.4 20 6.4 23 6.2 27V30.5H17.8V27C17.6 23 16.6 20 17.2 17 18 13.6 22 10.6 21.6 8 21 5.4 17.5 4.6 13.5 4V1.5';
  return (
    <svg className="lm-frame__cap" viewBox="0 0 24 32" width="24" height="32" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

export function FrameSlider({ params, value, basics, matchesBasics, onDraft, onCommit }: FrameSliderProps) {
  const lastSent = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const send = (x: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    lastSent.current = Date.now();
    patchProfile({ figure: { frame: round(x) } });
  };
  const live = (x: number) => {
    onDraft(x);
    const wait = SEND_MS - (Date.now() - lastSent.current);
    if (wait <= 0) send(x);
    else {
      pending.current = x;
      timer.current ??= setTimeout(() => {
        if (pending.current !== null) send(pending.current);
      }, wait);
    }
  };
  const commit = (x: number) => {
    send(x);
    onCommit?.();
  };

  // ←/→ move 0.05 (the scale's own step is 0.01 for dragging); Shift, PgUp/PgDn, Home/End keep the scale's keys
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.target instanceof HTMLInputElement) || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const next = round(clamp01(Math.round((value + dir * KEY_STEP) / KEY_STEP) * KEY_STEP));
    onDraft(next);
    commit(next);
  };

  return (
    <div className="lm-frame" onKeyDownCapture={onKeyDownCapture}>
      <ScaleSlider
        label={DRAWING.frame}
        size="sm"
        value={value}
        min={0}
        max={1}
        step={0.01}
        minorStep={0.05}
        majorStep={0.25}
        labels={false}
        reference={matchesBasics ? undefined : { value: basics, label: DRAWING.basicsTick }}
        format={(x) => frameSliderWords(params, x)}
        valueText={(x) => frameSliderWords(params, x)}
        editable={false}
        onChange={live}
        onCommit={commit}
      />
      <div className="lm-frame__ends">
        <span className="lm-frame__end">
          <EndCap end="hips" />
          {DRAWING.hipsLed}
        </span>
        <span className="lm-frame__end" data-end="right">
          {DRAWING.shouldersLed}
          <EndCap end="shoulders" />
        </span>
      </div>
      <div className="lm-frame__foot">
        <p className="lm-body-hint">{DRAWING.frameHelp}</p>
        <Key
          variant="quiet"
          size="sm"
          disabledReason={matchesBasics ? DRAWING.matchesAlready : undefined}
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
            onDraft(null);
            patchProfile({ figure: { frame: null } });
            onCommit?.();
          }}
        >
          {DRAWING.matchBasics}
        </Key>
      </div>
    </div>
  );
}
