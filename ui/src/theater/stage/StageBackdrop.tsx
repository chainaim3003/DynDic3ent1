/**
 * StageBackdrop — SVG decorations behind agent nodes
 * ---------------------------------------------------------------------------
 * Renders:
 *   - Soft radial gradient (subtle depth)
 *   - Faint grid pattern (sense of space, "arena floor")
 *   - Stage edge fade (vignette)
 *
 * All decorations use stage-relative coordinates from STAGE_VIEWBOX
 * (1000 × 600). Colors use theme-aware CSS variables via currentColor + opacity,
 * so the backdrop adapts to light/dark mode automatically.
 *
 * No animation. No interactivity. Pure visual.
 */

import React from 'react';
import { STAGE_VIEWBOX } from './useStageLayout';

export function StageBackdrop() {
  const { width, height } = STAGE_VIEWBOX;

  return (
    <g aria-hidden="true">
      {/* Definitions — gradients + patterns */}
      <defs>
        {/* Radial gradient — slight glow at center stage */}
        <radialGradient id="stage-center-glow" cx="50%" cy="55%" r="55%">
          <stop offset="0%"   stopColor="currentColor" stopOpacity="0.06" />
          <stop offset="60%"  stopColor="currentColor" stopOpacity="0.02" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>

        {/* Grid pattern — large cells, very low opacity */}
        <pattern id="stage-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.5" />
        </pattern>

        {/* Edge vignette */}
        <radialGradient id="stage-vignette" cx="50%" cy="50%" r="60%">
          <stop offset="60%"  stopColor="currentColor" stopOpacity="0" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
        </radialGradient>
      </defs>

      {/* Layer 1 — grid */}
      <rect x="0" y="0" width={width} height={height} fill="url(#stage-grid)" />

      {/* Layer 2 — center glow */}
      <rect x="0" y="0" width={width} height={height} fill="url(#stage-center-glow)" />

      {/* Layer 3 — vignette */}
      <rect x="0" y="0" width={width} height={height} fill="url(#stage-vignette)" />

      {/* Stage floor — a subtle ellipse hint at the bottom */}
      <ellipse
        cx={width / 2}
        cy={height - 40}
        rx={width * 0.4}
        ry="14"
        fill="currentColor"
        fillOpacity="0.04"
      />
    </g>
  );
}
