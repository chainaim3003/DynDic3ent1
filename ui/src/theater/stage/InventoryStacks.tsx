/**
 * InventoryStacks — character animation for the Inventory sub-agent
 * ---------------------------------------------------------------------------
 * Phase 9c. Three small vertical bars to the right of the Inventory disc.
 * Bar heights oscillate independently on staggered periods, reading as
 * "inventory levels rising and falling" — telegraphs the agent's function
 * (stock availability) without taking the eye away from the front-row
 * negotiation.
 *
 * Rendered inside the Inventory agent's <g> wrapper so dim/brighten state
 * is inherited (stage-curtain by default, brightens on consult in 9d).
 *
 * prefers-reduced-motion: bars freeze at their initial heights.
 */

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { gsap } from './gsap-setup';

interface InventoryStacksProps {
  cx: number;
  cy: number;
  r: number;
}

const COLOR  = '#f97316';  // orange-500, matches AvatarDisc + StateAura
const STACKS = 3;
const W      = 4;          // width of each bar (Phase 9e: 5→4 for r=30)
const GAP    = 2;          // horizontal gap between bars (Phase 9e: 3→2)

// Per-stack height sequences. Each row is one stack's loop of target
// heights. Different sequences + different period scales (below) mean the
// three bars never sync, which keeps the motion organic.
// Phase 9e — heights scaled down ~35% to fit the smaller r=30 sub-agent
// disc (was 8..19 px tall; now 6..14).
const HEIGHT_SEQUENCES: number[][] = [
  [10, 13,  7, 12,  9, 14],
  [ 7, 10,  6,  9, 12,  8],
  [12,  9, 10,  6, 13,  9],
];

export function InventoryStacks({ cx, cy, r }: InventoryStacksProps) {
  const reduce = useReducedMotion();
  const refs = useRef<Array<SVGRectElement | null>>([null, null, null]);

  // Anchor point: right of disc, slightly below disc center so the bars
  // sit at a comfortable "ground line" cy + 9. Phase 9e: pulled in to
  // cx+r+10 (was cx+r+14) to keep within the cluster frame.
  const baseX = cx + r + 10;
  const baseY = cy + 9;

  useEffect(() => {
    if (reduce) {
      // Static: park each bar at its first sequence height.
      refs.current.forEach((el, i) => {
        if (!el) return;
        const h = HEIGHT_SEQUENCES[i][0];
        gsap.set(el, { attr: { y: baseY - h, height: h } });
      });
      return;
    }

    // One GSAP timeline per bar, each on its own period + offset so the
    // three never lock into a synchronized march.
    const tls: gsap.core.Timeline[] = [];
    refs.current.forEach((el, i) => {
      if (!el) return;
      const seq = HEIGHT_SEQUENCES[i];
      const period = 2.6 + i * 0.5;  // 2.6s, 3.1s, 3.6s
      const tl = gsap.timeline({
        repeat: -1,
        defaults: { ease: 'sine.inOut' },
        delay: i * 0.3,
      });
      seq.forEach(h => {
        tl.to(el, {
          attr: { y: baseY - h, height: h },
          duration: period / seq.length,
        });
      });
      tls.push(tl);
    });

    return () => { tls.forEach(t => t.kill()); };
  }, [reduce, cx, cy, r]);

  return (
    <g aria-hidden="true" pointerEvents="none">
      {Array.from({ length: STACKS }).map((_, i) => (
        <rect
          key={i}
          ref={el => { refs.current[i] = el; }}
          x={baseX + i * (W + GAP)}
          // Initial y/height — overridden by the GSAP set/to on mount,
          // but provided here so SSR / first paint is sane.
          y={baseY - 10}
          width={W}
          height={10}
          fill={COLOR}
          fillOpacity={0.55}
          rx={1}
        />
      ))}
      {/* Baseline — a faint line under the stacks for visual anchoring. */}
      <line
        x1={baseX - 2}
        y1={baseY + 1}
        x2={baseX + STACKS * (W + GAP)}
        y2={baseY + 1}
        stroke={COLOR}
        strokeOpacity={0.3}
        strokeWidth={0.6}
      />
    </g>
  );
}

export default InventoryStacks;
