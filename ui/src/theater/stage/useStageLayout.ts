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
  /** Phase 9g — rest positions for back-office sub-agents (treasury,
   *  credit, inventory, logistics). Used when the agent is NOT in an
   *  active consult. Tight horizontal strip under the seller; smaller
   *  radius (icon-only). The active positions live in `positions` above
   *  (unchanged from Phase 9e — 2×2 cluster). The resolver hook decides
   *  which to use based on consult state and animates the transition. */
  restPositions: Record<string, AgentPosition>;
  viewBox: typeof STAGE_VIEWBOX;
  /** Mid-stage point — useful as a default bezier control point for
   *  envelope flights and as the "consult" zoom focus. */
  center: { x: number; y: number };
}

const AVATAR_RADIUS = 42;
// Phase 9e — sub-agents are visually subordinate to the seller; they get
// a smaller disc to read as "team members" rather than equals. Exported
// so per-agent character animations (CreditScoreline, InventoryStacks,
// LogisticsRoute) and the consult spotlight (BackOfficeConsult) can scale
// their visuals to match instead of hard-coding sizes.
export const SUB_AGENT_RADIUS = 30;
// Phase 9g — rest-position radius. Sub-agents shrink to this size when
// they're not consulting (the "strip" idle state). Icon-visible but
// compact — the strip stays unobtrusive under the seller.
export const SUB_AGENT_REST_RADIUS = 11;

export function useStageLayout(): StageLayout {
  return useMemo<StageLayout>(() => {
    // Front row stays centered on the new (narrower) max-width.
    // Buyer pulled in from 170 → 230; seller pulled in from 830 → 770.
    // vLEI stays at top-center 500,110. With a 1100px max stage width
    // (set in TheaterStage's wrapper class), this gives a balanced
    // composition: buyer-left, vLEI-top, seller-right-with-team-cluster.
    const FRONT_Y = 300;
    const VLEI_Y  = 110;

    // Phase 9e — sub-agent cluster directly under the seller. Cluster
    // shifts left with the seller (770 instead of 830). Tight 2×2 grid,
    // smaller radius (30 vs 42).
    //   col-left = 705, col-right = 835  (130px apart, centered under seller)
    //   row-top  = 460, row-bot   = 555  (95px apart)
    // BackOfficeRail's frame and tether constants are kept in sync below.
    const CLUSTER_COL_L = 705;
    const CLUSTER_COL_R = 835;
    const CLUSTER_ROW_T = 460;
    const CLUSTER_ROW_B = 555;

    const positions: Record<string, AgentPosition> = {
      // Front row.
      buyer:        { id: 'buyer',        x: 230, y: FRONT_Y, r: AVATAR_RADIUS },
      seller:       { id: 'seller',       x: 770, y: FRONT_Y, r: AVATAR_RADIUS },
      vleiVerifier: { id: 'vleiVerifier', x: 500, y: VLEI_Y,  r: AVATAR_RADIUS },

      // Seller's back-office cluster — ACTIVE positions (used during consult).
      // Phase 9g: when a sub-agent's consult is active, it lifts from the
      // rest strip up to these positions and grows to r=30. The 2×2 grid
      // still gives each agent room for its character animation + spotlight.
      // When idle, the resolver uses restPositions instead.
      // Row 1 (top):    Treasury (left), Credit (right)
      // Row 2 (bottom): Inventory (left), Logistics (right)
      treasury:       { id: 'treasury',       x: CLUSTER_COL_L, y: CLUSTER_ROW_T, r: SUB_AGENT_RADIUS },
      sellerTreasury: { id: 'sellerTreasury', x: CLUSTER_COL_L, y: CLUSTER_ROW_T, r: SUB_AGENT_RADIUS }, // alias
      credit:         { id: 'credit',         x: CLUSTER_COL_R, y: CLUSTER_ROW_T, r: SUB_AGENT_RADIUS },
      inventory:      { id: 'inventory',      x: CLUSTER_COL_L, y: CLUSTER_ROW_B, r: SUB_AGENT_RADIUS },
      logistics:      { id: 'logistics',      x: CLUSTER_COL_R, y: CLUSTER_ROW_B, r: SUB_AGENT_RADIUS },
    };

    // Phase 9g — REST positions for sub-agents. Tight horizontal strip
    // centered under the seller (x=770). 4 agents, 50px apart, at y=480.
    // Front-row positions (buyer/seller/vlei) are passed through identical
    // so callers can use restPositions uniformly without falling back.
    const STRIP_Y = 480;
    const STRIP_SPACING = 50;
    const STRIP_CENTER_X = 770;  // under seller
    const STRIP_X_TREASURY  = STRIP_CENTER_X - STRIP_SPACING * 1.5;  // 695
    const STRIP_X_CREDIT    = STRIP_CENTER_X - STRIP_SPACING * 0.5;  // 745
    const STRIP_X_INVENTORY = STRIP_CENTER_X + STRIP_SPACING * 0.5;  // 795
    const STRIP_X_LOGISTICS = STRIP_CENTER_X + STRIP_SPACING * 1.5;  // 845

    const restPositions: Record<string, AgentPosition> = {
      // Front row pass-through (same as positions).
      buyer:        positions.buyer,
      seller:       positions.seller,
      vleiVerifier: positions.vleiVerifier,

      // Sub-agent rest positions — strip under seller.
      treasury:       { id: 'treasury',       x: STRIP_X_TREASURY,  y: STRIP_Y, r: SUB_AGENT_REST_RADIUS },
      sellerTreasury: { id: 'sellerTreasury', x: STRIP_X_TREASURY,  y: STRIP_Y, r: SUB_AGENT_REST_RADIUS },
      credit:         { id: 'credit',         x: STRIP_X_CREDIT,    y: STRIP_Y, r: SUB_AGENT_REST_RADIUS },
      inventory:      { id: 'inventory',      x: STRIP_X_INVENTORY, y: STRIP_Y, r: SUB_AGENT_REST_RADIUS },
      logistics:      { id: 'logistics',      x: STRIP_X_LOGISTICS, y: STRIP_Y, r: SUB_AGENT_REST_RADIUS },
    };

    return {
      positions,
      restPositions,
      viewBox: STAGE_VIEWBOX,
      center: { x: STAGE_VIEWBOX.width / 2, y: STAGE_VIEWBOX.height / 2 },
    };
  }, []);
}
