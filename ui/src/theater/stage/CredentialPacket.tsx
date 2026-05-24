/**
 * CredentialPacket — one IPEX credential in flight (GRANT or ADMIT)
 * ---------------------------------------------------------------------------
 * Phase 3c. Lives in the SVG layer of TheaterStage. Visually distinct from
 * MessageEnvelope:
 *   - Parchment-style rounded rect (cream fill, colored border + wax seal)
 *   - Variant letter inside (G for GRANT, A for ADMIT)
 *   - Tiny SAID prefix label below the packet
 *
 * Animation lifecycle (~960ms total, optionally delayed by `delay` ms):
 *   1. (delay) — element invisible at sender position
 *   2. 200ms — pop in at sender (scale 0 → 1, opacity 0 → 1, back.out)
 *   3. 600ms — fly along bezier to receiver (power1.inOut, motionPath)
 *   4. 180ms — fade out at receiver
 *   5. onComplete fires → parent removes packet from state → unmount
 *
 * Bezier arcs UPWARD for both grant (seller→buyer) and admit (buyer→seller)
 * since both move along the buyer↔seller corridor — never touch treasury.
 * Arc magnitude differs between variants so two simultaneous packets
 * (rare, but possible during pause/resume edge cases) stay visually
 * separated.
 *
 * Mount-flash prevention: JSX renders <g> with opacity:0 so there's no
 * one-frame flash at SVG origin between React mount and the GSAP useEffect
 * that translates the element to the sender position.
 */

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { gsap } from './gsap-setup';
import { ANIM } from '@/theater/shared/constants';

export type CredentialPacketVariant = 'grant' | 'admit';

interface CredentialPacketProps {
  fromX: number; fromY: number;
  toX: number;   toY: number;
  variant: CredentialPacketVariant;
  /** SAID prefix to display under the packet (truncated to 10 chars). */
  said?: string;
  /** Delay before the timeline starts, in ms. Used by IpexBallet to stagger
   *  ADMIT 800ms after GRANT without managing two separate React lifecycles. */
  delay?: number;
  /** Called by the GSAP timeline once the full lifecycle finishes. */
  onComplete: () => void;
}

// Variant colors — gold for GRANT (a "giving" credential), green for ADMIT
// (an "accepting" confirmation). Chosen to be distinct from MessageEnvelope's
// purple invoice color (#a855f7) since invoice + grant + admit can overlap.
const VARIANT_STYLE: Record<CredentialPacketVariant, {
  color: string;
  letter: string;
  label: string;
  /** Arc magnitude multiplier — GRANT arcs higher than default, ADMIT lower. */
  arcMul: number;
}> = {
  grant: { color: '#D4A017', letter: 'G', label: 'GRANT', arcMul: 1.55 },
  admit: { color: '#22C55E', letter: 'A', label: 'ADMIT', arcMul: 0.65 },
};

export function CredentialPacket({
  fromX, fromY, toX, toY,
  variant,
  said,
  delay = 0,
  onComplete,
}: CredentialPacketProps) {
  const ref = useRef<SVGGElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // Phase 8a — respect prefers-reduced-motion. Skip the parchment flight;
  // the `delay` prop is still honored so ADMIT stays staggered after GRANT.
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!ref.current) return;
    if (reduce) {
      // Short-circuit: complete after the same `delay` so IpexBallet's
      // checkBothDone sequencing matches the animated case.
      const timer = window.setTimeout(() => onCompleteRef.current(), delay);
      return () => window.clearTimeout(timer);
    }

    const { arcMul } = VARIANT_STYLE[variant];

    // Bezier midpoint — same approach as MessageEnvelope but with a
    // variant-specific arc multiplier so GRANT and ADMIT trails don't overlap.
    const horiz = Math.abs(toX - fromX);
    const arcMagnitude = Math.max(80, horiz * 0.28) * arcMul;
    const midX = (fromX + toX) / 2;
    const midY = Math.min(fromY, toY) - arcMagnitude;  // both arc UP

    gsap.set(ref.current, {
      x: fromX,
      y: fromY,
      scale: 0,
      opacity: 0,
      transformOrigin: '50% 50%',
    });

    const tl = gsap.timeline({
      delay: delay / 1000,
      onComplete: () => onCompleteRef.current(),
    });

    // 1) Pop in at sender — slightly longer than envelope so the parchment
    //    visual reads as deliberate / weighty vs. the snappy envelope.
    tl.to(ref.current, {
      scale: 1,
      opacity: 1,
      duration: 0.20,
      ease: 'back.out(1.8)',
    });

    // 2) Fly along bezier — overlaps slightly with pop-in for snappier feel
    tl.to(ref.current, {
      motionPath: {
        path: [
          { x: fromX, y: fromY },
          { x: midX,  y: midY  },
          { x: toX,   y: toY   },
        ],
        curviness: 1.4,
        autoRotate: false,
      },
      duration: ANIM.envelopeFlight / 1000,
      ease: 'power1.inOut',
    }, '-=0.10');

    // 3) Fade out at receiver
    tl.to(ref.current, {
      scale: 0.7,
      opacity: 0,
      duration: 0.18,
      ease: 'power2.in',
    }, '-=0.09');

    return () => { tl.kill(); };
    // One-shot. `reduce` is included so toggling the OS setting takes
    // effect on the next packet; other props are mount-time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  const { color, letter, label } = VARIANT_STYLE[variant];
  const saidShort = said ? said.slice(0, 10) : '';

  return (
    <g
      ref={ref}
      style={{ opacity: 0, pointerEvents: 'none' }}
      data-credential-packet={variant}
    >
      {/* Soft glow halo */}
      <circle cx={0} cy={0} r={18} fill={color} opacity={0.18} />
      {/* Parchment body — cream fill, colored border */}
      <rect
        x={-15} y={-10}
        width={30} height={20}
        rx={3}
        fill="#FAF7ED"
        stroke={color}
        strokeWidth={1.4}
      />
      {/* Wax seal — bottom-right corner */}
      <circle
        cx={11} cy={6}
        r={3}
        fill={color}
        stroke="white"
        strokeWidth={0.6}
      />
      {/* Variant letter (G / A) — bold, colored */}
      <text
        x={-3} y={4}
        fontSize={11}
        fontWeight={700}
        fontFamily="ui-monospace, monospace"
        fill={color}
        textAnchor="middle"
      >
        {letter}
      </text>
      {/* SAID prefix label — sits under the parchment */}
      {saidShort && (
        <g>
          <rect
            x={-22} y={13}
            width={44} height={9}
            rx={1.5}
            fill="hsl(var(--background, 0 0% 100%))"
            fillOpacity={0.85}
            stroke={color}
            strokeOpacity={0.4}
            strokeWidth={0.4}
          />
          <text
            x={0} y={19.5}
            fontSize={6}
            fontFamily="ui-monospace, monospace"
            fill={color}
            textAnchor="middle"
            fillOpacity={0.95}
          >
            {label}·{saidShort}
          </text>
        </g>
      )}
    </g>
  );
}
