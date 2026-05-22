/**
 * usePlayhead — playhead state machine for replay scrubbing
 * ---------------------------------------------------------------------------
 * Tracks where the user is "looking" in the event log. Three modes:
 *
 *   - 'live'      → index auto-snaps to the last event as new ones arrive.
 *                   This is the default and matches the AgentCenter behavior.
 *   - 'paused'    → index frozen at its current position. New events still
 *                   land in the underlying log (useEventLog keeps growing)
 *                   but the visual playhead does not advance.
 *   - 'scrubbing' → same freeze as paused, but signals UI is actively
 *                   dragging the slider. Mostly relevant to animations
 *                   that want to suspend during drag (e.g. throttle GSAP).
 *
 * Speed only matters during replay-style playback (Phase 4's master timeline
 * scrubber). It's stored here so all components see the same value.
 *
 * Notes:
 *   - This hook is intentionally decoupled from useEventLog — pass `total`
 *     in from the caller. That way the playhead can drive any sequence,
 *     not just the live event log (useful for Phase 4 timeline replay).
 *   - The `index` clamps to [0, total-1]. When total is 0, index is 0
 *     and isLive remains true (no events to look at yet).
 *
 * Keyboard wiring (Phase 8): arrow keys → seek(±1), space → play/pause.
 * Hook itself owns no keyboard listeners; that's the consumer's job.
 */

import { useCallback, useEffect, useState } from 'react';
import type { PlayheadMode, PlayheadSpeed, PlayheadState } from '@/theater/shared/types';
import { PLAYHEAD_DEFAULT_SPEED, PLAYHEAD_SPEEDS } from '@/theater/shared/constants';

export interface UsePlayheadOptions {
  /** Current size of the event log (== useEventLog().count). */
  total: number;
}

export interface UsePlayheadResult extends PlayheadState {
  /** Resume live tail-follow. */
  play: () => void;
  /** Freeze the playhead at its current index. */
  pause: () => void;
  /** Convenience alias for play(); semantically clearer for "exit scrub". */
  resumeLive: () => void;
  /** Jump to a specific index. Implicitly enters 'scrubbing' mode. */
  seek: (index: number) => void;
  /** Set replay speed. Must be one of PLAYHEAD_SPEEDS. */
  setSpeed: (s: PlayheadSpeed) => void;
  /** Convenience: true iff mode === 'live'. */
  isLive: boolean;
  /** Convenience: true iff mode === 'paused' || mode === 'scrubbing'. */
  isFrozen: boolean;
}

export function usePlayhead({ total }: UsePlayheadOptions): UsePlayheadResult {
  const [mode, setMode] = useState<PlayheadMode>('live');
  const [index, setIndex] = useState<number>(0);
  const [speed, setSpeedState] = useState<PlayheadSpeed>(PLAYHEAD_DEFAULT_SPEED);

  // ─── Live mode: snap to latest as events stream in ─────────────────────
  // The dependency on `total` is intentional — every time the log grows,
  // we want to advance the playhead IF we're in live mode. If we're paused
  // or scrubbing, do nothing (the event still lands in useEventLog).
  useEffect(() => {
    if (mode === 'live') {
      setIndex(total === 0 ? 0 : total - 1);
    }
  }, [mode, total]);

  // ─── If total shrinks (clear) or we go out of bounds, clamp ────────────
  useEffect(() => {
    if (total === 0) {
      setIndex(0);
      return;
    }
    if (index > total - 1) {
      setIndex(total - 1);
    }
  }, [total, index]);

  const play = useCallback(() => setMode('live'), []);
  const pause = useCallback(() => setMode('paused'), []);
  const resumeLive = useCallback(() => setMode('live'), []);

  const seek = useCallback((nextIndex: number) => {
    setMode('scrubbing');
    const clamped =
      total === 0 ? 0 : Math.max(0, Math.min(nextIndex, total - 1));
    setIndex(clamped);
  }, [total]);

  const setSpeed = useCallback((s: PlayheadSpeed) => {
    if (PLAYHEAD_SPEEDS.includes(s)) {
      setSpeedState(s);
    }
    // Silently ignore invalid speeds rather than throw — keeps the UI
    // resilient if a stale localStorage value gets restored.
  }, []);

  return {
    mode,
    index,
    total,
    speed,
    play,
    pause,
    resumeLive,
    seek,
    setSpeed,
    isLive: mode === 'live',
    isFrozen: mode === 'paused' || mode === 'scrubbing',
  };
}
