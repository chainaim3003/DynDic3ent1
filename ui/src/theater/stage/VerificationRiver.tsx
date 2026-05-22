/**
 * VerificationRiver — animated trust-chain visualization across the stage
 * ---------------------------------------------------------------------------
 * Draws a curved path Buyer → vLEI → Seller using a gradient stroke.
 * On each play trigger:
 *   1. Path resets to invisible (drawSVG 0%)
 *   2. Path draws itself over ~1.2s using DrawSVGPlugin
 *   3. 5 checkpoint dots light up sequentially (~400ms apart, matching
 *      AgentCenter's GleifPipeline cascade timing)
 *   4. After ~3.5s total, path fades to a faint "drawn" state at 0.18 opacity
 *      so the trust chain remains visible but doesn't compete for attention
 *
 * The checkpoints map to AgentCenter's 5 verification steps:
 *   1. AIDs loaded             — Tommy + Jupiter agent identifiers fetched
 *   2. Delegation field        — Delegator AID found in agent KEL
 *   3. Delegation seal         — Seal anchored in OOR holder KEL
 *   4. Cryptographic proof     — Seal digest matches inception SAID
 *   5. Public key available    — Agent card has signing key
 *
 * Plays when `playToken` changes (from useVerificationRiver). Initial mount
 * does NOT play — the river is invisible until the first trigger. This
 * avoids playing on every navigation; the user only sees it when
 * something verification-related actually happened.
 */

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { gsap } from './gsap-setup';
import { useStageLayout } from './useStageLayout';

interface VerificationRiverProps {
  /** Increments every time the river should re-animate. From
   *  useVerificationRiver. */
  playToken: number;
}

// Checkpoint labels matched to AgentCenter's GleifPipeline node titles.
const CHECKPOINTS = [
  { label: 'AIDs',         tPct: 0.10 },
  { label: 'Delegation',   tPct: 0.28 },
  { label: 'Seal',         tPct: 0.50 },
  { label: 'Crypto',       tPct: 0.72 },
  { label: 'Public Key',   tPct: 0.90 },
] as const;

// Compute (x,y) along a quadratic-then-quadratic S-path with two control
// points. This mirrors the SVG path "M start Q ctrl1 mid Q ctrl2 end".
function pointOnSCurve(
  start: { x: number; y: number },
  ctrl1: { x: number; y: number },
  mid:   { x: number; y: number },
  ctrl2: { x: number; y: number },
  end:   { x: number; y: number },
  t: number,
): { x: number; y: number } {
  // Path is two quadratics joined at `mid`. Split t at 0.5.
  if (t <= 0.5) {
    const localT = t / 0.5;
    const x = (1 - localT) ** 2 * start.x + 2 * (1 - localT) * localT * ctrl1.x + localT ** 2 * mid.x;
    const y = (1 - localT) ** 2 * start.y + 2 * (1 - localT) * localT * ctrl1.y + localT ** 2 * mid.y;
    return { x, y };
  }
  const localT = (t - 0.5) / 0.5;
  const x = (1 - localT) ** 2 * mid.x + 2 * (1 - localT) * localT * ctrl2.x + localT ** 2 * end.x;
  const y = (1 - localT) ** 2 * mid.y + 2 * (1 - localT) * localT * ctrl2.y + localT ** 2 * end.y;
  return { x, y };
}

export function VerificationRiver({ playToken }: VerificationRiverProps) {
  // Phase 8a — when prefers-reduced-motion is set, snap to the settled
  // "drawn at low opacity" end state instead of running the cascade.
  const reduce = useReducedMotion();
  const layout = useStageLayout();
  const pathRef = useRef<SVGPathElement>(null);
  const dotRefs = useRef<Array<SVGCircleElement | null>>([]);
  const labelRefs = useRef<Array<SVGGElement | null>>([]);
  const groupRef = useRef<SVGGElement>(null);

  // Anchor points for the curve: Buyer (left) → vLEI (top center) → Seller (right).
  const buyer  = layout.positions.buyer;
  const vlei   = layout.positions.vleiVerifier;
  const seller = layout.positions.seller;

  // Control points for the two quadratics — pulled inward toward vLEI to
  // create a smooth S-curve through the top of the stage.
  const ctrl1 = { x: (buyer.x + vlei.x) / 2, y: vlei.y - 30 };
  const ctrl2 = { x: (seller.x + vlei.x) / 2, y: vlei.y - 30 };

  const pathD = `M ${buyer.x} ${buyer.y - buyer.r - 8} ` +
                `Q ${ctrl1.x} ${ctrl1.y}, ${vlei.x} ${vlei.y + 4} ` +
                `Q ${ctrl2.x} ${ctrl2.y}, ${seller.x} ${seller.y - seller.r - 8}`;

  // Pre-compute checkpoint positions along the path.
  const checkpointPositions = CHECKPOINTS.map(cp => ({
    ...cp,
    pos: pointOnSCurve(
      { x: buyer.x, y: buyer.y - buyer.r - 8 },
      ctrl1,
      { x: vlei.x, y: vlei.y + 4 },
      ctrl2,
      { x: seller.x, y: seller.y - seller.r - 8 },
      cp.tPct,
    ),
  }));

  // ─── Play timeline on playToken change ──────────────────────────────
  useEffect(() => {
    if (playToken === 0) return;  // skip initial mount
    if (!pathRef.current || !groupRef.current) return;

    if (reduce) {
      // Snap straight to the post-cascade resting state — path visible at
      // low opacity, dots faint, labels hidden. No tweens.
      gsap.set(groupRef.current, { opacity: 1 });
      gsap.set(pathRef.current, { drawSVG: '100%', strokeOpacity: 0.22 });
      dotRefs.current.forEach(d => d && gsap.set(d, {
        scale: 1, opacity: 0.35, transformOrigin: '50% 50%',
      }));
      labelRefs.current.forEach(l => l && gsap.set(l, { opacity: 0 }));
      return;
    }

    // Reset state — hide everything, then draw.
    gsap.set(groupRef.current, { opacity: 1 });
    gsap.set(pathRef.current, { drawSVG: '0%', strokeOpacity: 0.9 });
    dotRefs.current.forEach(d => d && gsap.set(d, { scale: 0, opacity: 0, transformOrigin: '50% 50%' }));
    labelRefs.current.forEach(l => l && gsap.set(l, { opacity: 0 }));

    const tl = gsap.timeline();

    // 1) Draw the path
    tl.to(pathRef.current, {
      drawSVG: '100%',
      duration: 1.2,
      ease: 'power2.inOut',
    });

    // 2) Light up checkpoint dots in sequence (~400ms stagger)
    checkpointPositions.forEach((_, i) => {
      const dot = dotRefs.current[i];
      const label = labelRefs.current[i];
      const at = 0.3 + i * 0.4;
      if (dot) {
        tl.to(dot, {
          scale: 1,
          opacity: 1,
          duration: 0.3,
          ease: 'back.out(2.5)',
        }, at);
      }
      if (label) {
        tl.to(label, {
          opacity: 1,
          duration: 0.25,
          ease: 'power1.out',
        }, at + 0.1);
      }
    });

    // 3) After full cascade, fade everything to a faint "drawn" state
    tl.to(pathRef.current, {
      strokeOpacity: 0.22,
      duration: 0.6,
      ease: 'power2.in',
    }, '+=0.4');
    tl.to(dotRefs.current.filter(Boolean) as SVGCircleElement[], {
      opacity: 0.35,
      duration: 0.6,
      ease: 'power2.in',
    }, '<');
    tl.to(labelRefs.current.filter(Boolean) as SVGGElement[], {
      opacity: 0,
      duration: 0.4,
      ease: 'power1.in',
    }, '<');

    return () => { tl.kill(); };
  }, [playToken, reduce]);

  return (
    <g ref={groupRef} style={{ opacity: 0, pointerEvents: 'none' }}>
      <defs>
        <linearGradient id="theater-river-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#3b82f6" />  {/* buyer blue */}
          <stop offset="50%"  stopColor="#64748b" />  {/* vLEI slate */}
          <stop offset="100%" stopColor="#10b981" />  {/* seller emerald */}
        </linearGradient>
      </defs>

      {/* The river path */}
      <path
        ref={pathRef}
        d={pathD}
        fill="none"
        stroke="url(#theater-river-gradient)"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeDasharray="0"  // overridden by drawSVG plugin
      />

      {/* Checkpoint dots + labels */}
      {checkpointPositions.map((cp, i) => (
        <g key={cp.label}>
          {/* Glow halo */}
          <circle
            ref={el => { dotRefs.current[i] = el; }}
            cx={cp.pos.x}
            cy={cp.pos.y}
            r={4.5}
            fill="white"
            stroke="url(#theater-river-gradient)"
            strokeWidth={1.5}
          />
          {/* Label */}
          <g ref={el => { labelRefs.current[i] = el; }}>
            <rect
              x={cp.pos.x - 28}
              y={cp.pos.y - 28}
              width={56}
              height={16}
              rx={3}
              fill="hsl(var(--background, 0 0% 100%))"
              fillOpacity={0.85}
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeWidth={0.5}
            />
            <text
              x={cp.pos.x}
              y={cp.pos.y - 17}
              fontSize="9"
              fontFamily="ui-monospace, monospace"
              fill="currentColor"
              textAnchor="middle"
              fillOpacity={0.85}
            >
              {cp.label}
            </text>
          </g>
        </g>
      ))}
    </g>
  );
}
