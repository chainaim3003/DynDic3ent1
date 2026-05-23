/**
 * LogisticsRoute — character animation for the Logistics sub-agent
 * ---------------------------------------------------------------------------
 * Phase 9c. Horizontal dashed line below the Logistics disc with an arrow
 * tip on the right, plus an animated strokeDashoffset so the dashes
 * appear to march forward. Reads as "freight in transit" — telegraphs
 * the agent's function (carrier quotes + lead time) at a glance.
 *
 * Rendered inside the Logistics agent's <g> wrapper for inherited
 * dim/brighten state.
 *
 * prefers-reduced-motion: dashes freeze; line still renders so the
 * "route" affordance remains visible.
 */

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { gsap } from './gsap-setup';

interface LogisticsRouteProps {
  cx: number;
  cy: number;
  r: number;
}

const COLOR    = '#14b8a6';   // teal-500, matches AvatarDisc + StateAura
const DASH_LEN = 4;           // dash length
const GAP_LEN  = 6;           // gap between dashes
const TOTAL    = DASH_LEN + GAP_LEN;  // one full dash+gap unit

export function LogisticsRoute({ cx, cy, r }: LogisticsRouteProps) {
  const reduce = useReducedMotion();
  const lineRef = useRef<SVGLineElement>(null);

  // Horizontal line below the disc, slightly under the agent label cluster.
  // Phase 9e — length shrunk from 64 to 44 px (-32..+32 → -22..+22) to
  // fit the smaller r=30 sub-agent disc.
  const y  = cy + r + 11;
  const x1 = cx - 22;
  const x2 = cx + 22;

  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;

    if (reduce) {
      // Freeze dashes at offset 0. Line is still visible; just no motion.
      gsap.set(el, { strokeDashoffset: 0 });
      return;
    }

    // Linear march: offset 0 → -TOTAL, repeating. Linear ease so the
    // motion reads as continuous, not breathy. ~1.4s per unit gives a
    // gentle conveyor-belt pace.
    const tl = gsap.timeline({ repeat: -1 });
    tl.fromTo(
      el,
      { strokeDashoffset: 0 },
      { strokeDashoffset: -TOTAL, duration: 1.4, ease: 'none' },
    );

    return () => { tl.kill(); };
  }, [reduce, cx, cy, r]);

  return (
    <g aria-hidden="true" pointerEvents="none">
      <line
        ref={lineRef}
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke={COLOR}
        strokeOpacity={0.55}
        strokeWidth={1.4}
        strokeDasharray={`${DASH_LEN} ${GAP_LEN}`}
        strokeLinecap="round"
      />
      {/* Arrow tip — small chevron at the right end, slightly inside the
          line's end so the cap doesn't overlap the chevron. */}
      <polyline
        points={`${x2 - 4},${y - 2.5} ${x2},${y} ${x2 - 4},${y + 2.5}`}
        fill="none"
        stroke={COLOR}
        strokeOpacity={0.5}
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </g>
  );
}

export default LogisticsRoute;
