/**
 * SubAgentSlot — animated wrapper that lifts a sub-agent between its
 * rest and active positions
 * ---------------------------------------------------------------------------
 * Phase 9g. Replaces the static <g key={id} opacity={…}> wrapper used in
 * TheaterStage for credit / inventory / logistics. Treasury also uses this
 * wrapper, but its visuals already include TreasuryConsult's spotlight +
 * dim mask, so the lift effect compounds nicely with that overlay.
 *
 * Behavior:
 *   • At rest (no consult active): renders at restPos with restR.
 *   • On active=true: animates x, y, r to activePos / activeR over ~400ms
 *     via motion/react. The PhaseRing / StateAura / character anims all
 *     consume the animated values via render-prop / motion-value pattern.
 *   • Empty slot in the strip: when active=true and the agent has lifted
 *     out, we leave a small placeholder ring at restPos so the strip
 *     visually shows "Credit is currently lifted, but it belongs here."
 *
 * prefers-reduced-motion: animation is replaced with an instant snap (no
 * tween) — the agent just appears at its new position. Same behavior as
 * the Phase 8a guards elsewhere.
 *
 * The component owns NONE of the visual content — it accepts children
 * (the rings + auras + character anims) which receive (x, y, r) from the
 * caller. Keeps separation of concerns clean: this file just animates,
 * children just render.
 */

import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { AgentPosition } from './useStageLayout';

interface SubAgentSlotProps {
  active: boolean;
  /** Idle-strip position (small, in the row under seller). */
  restPos: AgentPosition;
  /** Lifted position (full size, room for character anim + spotlight). */
  activePos: AgentPosition;
  /** Opacity when at rest. ~0.5 reads as "dimmed but visible" in the
   *  strip; active jumps to 1.0. */
  restOpacity?: number;
  /** Render-prop: receives the resolved live position. Caller wires the
   *  PhaseRing / StateAura / character anims to these coordinates. */
  children: (pos: AgentPosition) => React.ReactNode;
}

const TRANSITION = {
  type: 'tween' as const,
  duration: 0.4,
  ease: [0.4, 0.0, 0.2, 1] as [number, number, number, number],  // standard material easing
};

export function SubAgentSlot({
  active,
  restPos,
  activePos,
  restOpacity = 0.5,
  children,
}: SubAgentSlotProps) {
  const reduce = useReducedMotion();

  // Live position values — what the children should render against.
  // We pick the final destination based on `active`; motion/react handles
  // the visual tween. Children receive the final values so their SVG
  // coordinates are correct at the destination; the motion.g's CSS
  // transform handles the movement between rest and active.
  //
  // Why this works: we draw the children at their *active* x/y/r in SVG
  // coords, and use motion to translate the entire group from rest→active
  // by the delta. Conceptually: children always think they're at the
  // active position; the group's transform makes them appear at rest
  // when active=false.
  const dx = active ? 0 : (restPos.x - activePos.x);
  const dy = active ? 0 : (restPos.y - activePos.y);
  // Radius scales via SVG `scale` on the group around the active position.
  const scale = active ? 1 : (restPos.r / activePos.r);

  // For reduced motion we pass duration:0 (snap). motion/react also has
  // its own prefers-reduced-motion handling, but explicit override keeps
  // behavior predictable across versions.
  const transition = reduce ? { duration: 0 } : TRANSITION;

  return (
    <>
      {/* The lifted agent group. Transform-origin = active position so
          scale shrinks toward the active center as it heads back to rest,
          producing a smooth lift/settle. */}
      <motion.g
        initial={false}
        animate={{
          x: dx,
          y: dy,
          scale,
          opacity: active ? 1 : restOpacity,
        }}
        transition={transition}
        style={{
          transformOrigin: `${activePos.x}px ${activePos.y}px`,
          transformBox: 'fill-box',
        }}
      >
        {children(activePos)}
      </motion.g>

      {/* Phase 9g — empty-slot placeholder ring. Visible only when the
          agent has lifted out of the strip (active=true). Tells the eye
          "this is where Credit belongs; it's currently elsewhere." */}
      {active && (
        <circle
          cx={restPos.x}
          cy={restPos.y}
          r={restPos.r}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={0.6}
          strokeDasharray="2 3"
          pointerEvents="none"
        />
      )}
    </>
  );
}

export default SubAgentSlot;
