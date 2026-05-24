/**
 * CreditScoreline — character animation for the Credit sub-agent
 * ---------------------------------------------------------------------------
 * Phase 9c. Tiny SVG sparkline-and-scanner that sits to the right of the
 * Credit disc. Reads as a "credit score curve" with a dot tracking through
 * its peaks and valleys — telegraphs the agent's function (scoring +
 * assessment) without being distracting.
 *
 * Rendered INSIDE the Credit agent's <g> wrapper in TheaterStage so it
 * inherits the dim/brighten state (stage-curtain effect by default;
 * brightens with the agent when 9d wires a credit consult signal).
 *
 * prefers-reduced-motion: scanner skips to the last point and stays put.
 * GSAP timeline is killed on unmount via the effect's cleanup.
 */

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { gsap } from './gsap-setup';

interface CreditScorelineProps {
  cx: number;
  cy: number;
  r: number;
}

const COLOR = '#f59e0b';  // amber-500, matches AvatarDisc + StateAura

export function CreditScoreline({ cx, cy, r }: CreditScorelineProps) {
  const reduce = useReducedMotion();
  const dotRef = useRef<SVGCircleElement>(null);

  // Fixed sparkline shape — credit-curve-feeling polyline. 7 points spanning
  // ~52 px to the right of the disc (Phase 9e: scaled down to fit r=30
  // smaller discs; was 74 px when discs were r=42).
  const baseX = cx + r + 8;
  const baseY = cy;
  const pts: Array<[number, number]> = [
    [baseX +  0, baseY +  6],
    [baseX + 10, baseY +  2],
    [baseX + 18, baseY +  4],
    [baseX + 26, baseY -  3],
    [baseX + 34, baseY -  1],
    [baseX + 42, baseY -  6],
    [baseX + 52, baseY -  4],
  ];
  const pointsStr = pts.map(p => p.join(',')).join(' ');

  useEffect(() => {
    const el = dotRef.current;
    if (!el) return;

    if (reduce) {
      // Static: park scanner at the final point. Effect early-returns
      // so no animation loop is created.
      const last = pts[pts.length - 1];
      gsap.set(el, { attr: { cx: last[0], cy: last[1] } });
      return;
    }

    // Tween scanner through every point, then small pause, then loop.
    const tl = gsap.timeline({ repeat: -1, defaults: { ease: 'sine.inOut' } });
    pts.forEach((p, i) => {
      if (i === 0) {
        // First point = teleport (set), not tween — so the loop reset is
        // instantaneous instead of an awkward retrace.
        tl.set(el, { attr: { cx: p[0], cy: p[1] } });
      } else {
        tl.to(el, { attr: { cx: p[0], cy: p[1] }, duration: 0.7 });
      }
    });
    // Short pause at the end before looping back so the eye registers
    // the final peak as a "settled" score before the cycle restarts.
    tl.to({}, { duration: 0.5 });

    return () => { tl.kill(); };
  }, [reduce, cx, cy, r]);

  return (
    <g aria-hidden="true" pointerEvents="none">
      <polyline
        points={pointsStr}
        fill="none"
        stroke={COLOR}
        strokeOpacity={0.45}
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        ref={dotRef}
        r={2}
        fill={COLOR}
        opacity={0.9}
      />
    </g>
  );
}

export default CreditScoreline;
