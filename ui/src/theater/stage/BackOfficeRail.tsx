/**
 * BackOfficeRail — faint scaffold for the sub-agent rest strip
 * ---------------------------------------------------------------------------
 * Phase 9g. Where 9e drew a tall cluster frame and a tether, this now draws
 * a thin horizontal strip-frame around just the rest positions of the
 * four sub-agents. The frame is always visible because the strip is
 * always there (even when an agent is lifted, its placeholder ring sits
 * in the strip).
 *
 * The tether is gone — sub-agents at rest sit in a tight icon row right
 * below the seller, no vertical line needed to imply hierarchy.
 *
 * Pure SVG, no animation, no interactivity. Z-order: below VerificationRiver
 * and below per-agent groups.
 */

import React from 'react';
import { SUB_AGENT_REST_RADIUS } from './useStageLayout';

// Rest-strip geometry (kept in sync with useStageLayout.ts).
const STRIP_Y = 480;
const STRIP_X_LEFTMOST  = 695;  // treasury
const STRIP_X_RIGHTMOST = 845;  // logistics

// Horizontal padding around the strip — enough to clear the placeholder
// ring dashes at each end without feeling tight.
const PAD_X = 24;
// Vertical padding — the strip is narrow, frame just hugs the discs.
const PAD_Y = 16;

const FRAME_LEFT   = STRIP_X_LEFTMOST  - SUB_AGENT_REST_RADIUS - PAD_X;
const FRAME_RIGHT  = STRIP_X_RIGHTMOST + SUB_AGENT_REST_RADIUS + PAD_X;
const FRAME_TOP    = STRIP_Y - SUB_AGENT_REST_RADIUS - PAD_Y;
const FRAME_BOTTOM = STRIP_Y + SUB_AGENT_REST_RADIUS + PAD_Y;

export function BackOfficeRail() {
  return (
    <g aria-hidden="true">
      <defs>
        {/* Gentle horizontal gradient — a thin band of light along the
            strip. Stays subtle so it doesn't compete with the agents. */}
        <linearGradient id="back-office-strip-glow" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%"   stopColor="currentColor" stopOpacity="0" />
          <stop offset="50%"  stopColor="currentColor" stopOpacity="0.05" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Strip fill — very subtle. */}
      <rect
        x={FRAME_LEFT}
        y={FRAME_TOP}
        width={FRAME_RIGHT - FRAME_LEFT}
        height={FRAME_BOTTOM - FRAME_TOP}
        rx={FRAME_BOTTOM - FRAME_TOP}  // full pill rounding for a clean horizontal strip
        fill="currentColor"
        fillOpacity={0.025}
      />
      <rect
        x={FRAME_LEFT}
        y={FRAME_TOP}
        width={FRAME_RIGHT - FRAME_LEFT}
        height={FRAME_BOTTOM - FRAME_TOP}
        rx={FRAME_BOTTOM - FRAME_TOP}
        fill="url(#back-office-strip-glow)"
      />

      {/* Strip border — dashed pill outline. Reads as a tray that holds
          the four sub-agent icons. */}
      <rect
        x={FRAME_LEFT}
        y={FRAME_TOP}
        width={FRAME_RIGHT - FRAME_LEFT}
        height={FRAME_BOTTOM - FRAME_TOP}
        rx={FRAME_BOTTOM - FRAME_TOP}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.18}
        strokeWidth={0.6}
        strokeDasharray="4 4"
      />

      {/* Tiny label above the strip's left edge. */}
      <text
        x={FRAME_LEFT + 14}
        y={FRAME_TOP - 4}
        fill="currentColor"
        fillOpacity={0.32}
        fontSize={7}
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        letterSpacing={1.8}
      >
        JUPITER · TEAM
      </text>
    </g>
  );
}

export default BackOfficeRail;
