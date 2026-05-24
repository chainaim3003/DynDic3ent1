/**
 * PhaseRing — outer arc around an agent indicating phase progress
 * ---------------------------------------------------------------------------
 * Phase 2 implementation: STATIC. Renders a dashed outer ring as a track,
 * with no progress indicator yet. The visual purpose right now is just to
 * "frame" each agent so the stage doesn't feel sparse.
 *
 * Phase 4 will:
 *   - Compute current phase from event log + rounds (verify / negotiate /
 *     consult / ipex / close / escalate)
 *   - Animate a foreground arc filling the ring as the phase progresses
 *   - Use GSAP DrawSVG for the stroke-dasharray reveal
 *
 * Keeping the API surface stable now means Phase 4 only needs to add a
 * `progress` prop (0-1) and an inner colored arc. Phase 2 callers can
 * already pass `phase` for future readiness, even though we ignore it here.
 */

import React from 'react';
import type { Phase } from '@/theater/shared/types';

interface PhaseRingProps {
  cx: number;
  cy: number;
  /** Inner radius — matches AvatarDisc + StateAura outer ring. */
  r: number;
  /** Phase the agent is currently in. Ignored in Phase 2; reserved for Phase 4. */
  phase?: Phase;
}

export function PhaseRing({ cx, cy, r }: PhaseRingProps) {
  const ringR = r + 26;

  return (
    <g aria-hidden="true">
      {/* Track — dashed, low opacity */}
      <circle
        cx={cx}
        cy={cy}
        r={ringR}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1.2"
        strokeDasharray="3 4"
      />
      {/* Inner edge marker — a thin solid ring just inside the dashed track,
          so it doesn't look like only a hint. */}
      <circle
        cx={cx}
        cy={cy}
        r={ringR - 4}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.08"
        strokeWidth="0.6"
      />
    </g>
  );
}
