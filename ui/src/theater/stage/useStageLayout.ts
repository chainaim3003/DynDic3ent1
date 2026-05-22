/**
 * useStageLayout — compute positions of agents on the SVG stage
 * ---------------------------------------------------------------------------
 * Returns positions in viewBox coordinate space (1000 × 600). The SVG itself
 * scales to the container, so callers don't need to recompute on resize —
 * the viewBox handles it. This is intentional: keeps positions stable so
 * Phase 3's envelope animations get predictable start/end points.
 *
 * Stage geometry:
 *
 *                 ┌─────────────[ vLEI verifier ]──────────────┐
 *                 │   (only visible during verify phase)        │
 *                 │                                             │
 *   [ Buyer ]─────────────── center stage ──────────────────[ Seller ]
 *                 │                                             │
 *                 │   ┌────[ Treasury ]────┐                    │
 *                 │   (visible during consult phase)            │
 *                 └─────────────────────────────────────────────┘
 *
 * The center stage is the "arena" where envelope flights happen.
 */

import { useMemo } from 'react';
import type { AgentId } from '@/theater/shared/types';

export const STAGE_VIEWBOX = {
  width: 1000,
  height: 600,
} as const;

export interface AgentPosition {
  id: AgentId;
  x: number;
  y: number;
  // Radius of the agent's avatar disc (used by Phase 3 to compute envelope
  // arrival points just outside the disc).
  r: number;
}

export interface StageLayout {
  positions: Record<string, AgentPosition>;
  viewBox: typeof STAGE_VIEWBOX;
  /** Mid-stage point — useful as a default bezier control point for
   *  envelope flights and as the "consult" zoom focus. */
  center: { x: number; y: number };
}

const AVATAR_RADIUS = 42;

export function useStageLayout(): StageLayout {
  return useMemo<StageLayout>(() => {
    const positions: Record<string, AgentPosition> = {
      // Left side — buyer
      buyer:        { id: 'buyer',        x: 170, y: 300, r: AVATAR_RADIUS },
      // Right side — seller
      seller:       { id: 'seller',       x: 830, y: 300, r: AVATAR_RADIUS },
      // Bottom center — treasury (visible during consult phase)
      treasury:     { id: 'treasury',     x: 500, y: 480, r: AVATAR_RADIUS },
      sellerTreasury: { id: 'sellerTreasury', x: 500, y: 480, r: AVATAR_RADIUS }, // alias
      // Top center — vLEI verifier (visible during verify phase)
      vleiVerifier: { id: 'vleiVerifier', x: 500, y: 110, r: AVATAR_RADIUS },
    };

    return {
      positions,
      viewBox: STAGE_VIEWBOX,
      center: { x: STAGE_VIEWBOX.width / 2, y: STAGE_VIEWBOX.height / 2 },
    };
  }, []);
}
