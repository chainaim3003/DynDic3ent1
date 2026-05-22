/**
 * TreasuryConsult — spotlight overlay that focuses attention on treasury
 * ---------------------------------------------------------------------------
 * Phase 3c. Renders an SVG overlay group containing three pieces:
 *   1. A full-stage dim rect with an SVG mask that punches out a circle
 *      around the treasury node. Effect: everything dims to ~45% except
 *      a clear "spotlight" zone around treasury.
 *   2. A "thinking" ring around treasury that pulses outward continuously
 *      while outcome === 'pending' — driven by GSAP infinite timeline.
 *   3. An APPROVED/REJECTED chip near treasury that appears when the
 *      consult resolves. Held for ~1.5s by useTreasuryConsult's dismiss
 *      timer; this component just renders the right label/color.
 *
 * Decision rationale (Option A vs B): the prompt mentions GSAP Flip but
 * Flip's strength is choreographing layout changes — useful for cards
 * reflowing or grid shuffles. Here we just want focus-shift, which a
 * mask + dim is simpler, doesn't require restructuring TheaterStage's
 * agent layout, and reads as cinematic with zero coupling to other layers.
 *
 * Z-order in TheaterStage: TreasuryConsult sits AFTER agents/auras and
 * BEFORE EnvelopeLayer, so:
 *   - Static agents/rings DO get dimmed (focus shifts)
 *   - In-flight envelopes draw on top of the dim — seller↔treasury
 *     envelopes remain crisp and visible while the consult is active
 *   - IPEX packets also draw on top (they're after EnvelopeLayer)
 *
 * Accessibility: aria-hidden — purely decorative focus shift. The
 * underlying treasury status is conveyed by the AgentNode label and
 * (Phase 5) the Inspector pane.
 */

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { gsap } from './gsap-setup';
import { ANIM } from '@/theater/shared/constants';
import type { TreasuryConsultOutcome } from './useTreasuryConsult';

interface TreasuryConsultProps {
  active: boolean;
  outcome: TreasuryConsultOutcome;
  /** Treasury node position — center of the spotlight + chip anchor. */
  treasuryX: number;
  treasuryY: number;
  treasuryR: number;
  /** SVG viewBox dimensions, for sizing the dim rect. */
  viewBoxW: number;
  viewBoxH: number;
}

// Radius of the spotlight cutout. Comfortably larger than the avatar disc
// (r=42) + state aura (r+18) so the highlighted zone reads as deliberate
// rather than a tight halo.
const SPOTLIGHT_RADIUS = 130;

// Unique IDs so multiple instances (or HMR) don't collide. In practice
// there's only one TreasuryConsult on the page, but defensive coding here
// costs nothing.
const MASK_ID = 'theater-treasury-spotlight-mask';
const GRADIENT_ID = 'theater-treasury-dim-gradient';

export function TreasuryConsult({
  active,
  outcome,
  treasuryX,
  treasuryY,
  treasuryR,
  viewBoxW,
  viewBoxH,
}: TreasuryConsultProps) {
  const groupRef     = useRef<SVGGElement>(null);
  const thinkRingRef = useRef<SVGCircleElement>(null);
  const loopTlRef    = useRef<gsap.core.Timeline | null>(null);
  // Phase 8a — when prefers-reduced-motion is set, skip the fade tween and
  // the infinite pulse loop; just toggle the overlay's visibility statically.
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!groupRef.current || !thinkRingRef.current) return;

    const group     = groupRef.current;
    const thinkRing = thinkRingRef.current;

    // Always tear down any prior loop before deciding the next state.
    if (loopTlRef.current) {
      loopTlRef.current.kill();
      loopTlRef.current = null;
    }
    gsap.killTweensOf([group, thinkRing]);

    if (reduce) {
      // No motion. Toggle opacity directly; set ring to a resting size.
      // The APPROVED/REJECTED chip is plain React, no animation needed.
      gsap.set(group, { opacity: active ? 1 : 0 });
      gsap.set(thinkRing, {
        attr: { r: treasuryR + 18 },
        opacity: outcome === 'pending' ? 0.6 : 0.45,
      });
      return;
    }

    if (active) {
      // Reveal the overlay group.
      gsap.to(group, {
        opacity: 1,
        duration: ANIM.treasuryZoom / 1000,
        ease: 'power2.out',
      });

      if (outcome === 'pending') {
        // Start the "thinking" loop — ring expands outward then resets.
        gsap.set(thinkRing, {
          attr: { r: treasuryR + 18 },
          opacity: 0.75,
        });
        const tl = gsap.timeline({ repeat: -1 });
        tl.to(thinkRing, {
          attr: { r: treasuryR + 42 },
          opacity: 0.05,
          duration: 1.2,
          ease: 'power1.out',
        }).to(thinkRing, {
          attr: { r: treasuryR + 18 },
          opacity: 0.75,
          duration: 0.4,
          ease: 'power1.in',
        });
        loopTlRef.current = tl;
      } else {
        // Outcome known — settle the thinking ring at its resting state
        // so it doesn't snap visually on the transition.
        gsap.to(thinkRing, {
          attr: { r: treasuryR + 18 },
          opacity: 0.45,
          duration: 0.3,
          ease: 'power2.out',
        });
      }
    } else {
      // Fade the whole overlay out.
      gsap.to(group, {
        opacity: 0,
        duration: ANIM.treasuryZoom / 1000,
        ease: 'power2.in',
      });
    }

    return () => {
      if (loopTlRef.current) {
        loopTlRef.current.kill();
        loopTlRef.current = null;
      }
    };
  }, [active, outcome, treasuryR, reduce]);

  // Chip label + color depend on outcome. 'pending' shows no chip.
  const chip = (() => {
    if (outcome === 'approved') return { label: 'APPROVED ✓', fill: '#10b981' };
    if (outcome === 'rejected') return { label: 'REJECTED ✗', fill: '#ef4444' };
    return null;
  })();

  return (
    <g
      ref={groupRef}
      style={{ opacity: 0, pointerEvents: 'none' }}
      aria-hidden="true"
      data-layer="treasury-consult"
    >
      <defs>
        <mask id={MASK_ID}>
          {/* White = visible darken; black = no darken (spotlight cutout). */}
          <rect x={0} y={0} width={viewBoxW} height={viewBoxH} fill="white" />
          <circle cx={treasuryX} cy={treasuryY} r={SPOTLIGHT_RADIUS} fill="black" />
        </mask>
        <radialGradient id={GRADIENT_ID} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#a855f7" stopOpacity="0" />
          <stop offset="80%"  stopColor="#a855f7" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Dim everywhere except the spotlight zone */}
      <rect
        x={0}
        y={0}
        width={viewBoxW}
        height={viewBoxH}
        fill="black"
        fillOpacity={0.45}
        mask={`url(#${MASK_ID})`}
      />

      {/* Subtle purple aura inside the spotlight, signaling "treasury at work" */}
      <circle
        cx={treasuryX}
        cy={treasuryY}
        r={SPOTLIGHT_RADIUS}
        fill={`url(#${GRADIENT_ID})`}
      />

      {/* Thinking ring — animates via GSAP attr tweens above */}
      <circle
        ref={thinkRingRef}
        cx={treasuryX}
        cy={treasuryY}
        r={treasuryR + 18}
        fill="none"
        stroke="#a855f7"
        strokeWidth={2}
        opacity={0.75}
      />

      {/* APPROVED / REJECTED chip — anchored above treasury */}
      {chip && (
        <g transform={`translate(${treasuryX}, ${treasuryY - treasuryR - 30})`}>
          <rect
            x={-58}
            y={-13}
            width={116}
            height={24}
            rx={12}
            fill={chip.fill}
            fillOpacity={0.95}
            stroke="white"
            strokeOpacity={0.6}
            strokeWidth={1.2}
          />
          <text
            x={0}
            y={4}
            fontSize={12}
            fontWeight={700}
            fontFamily="ui-monospace, monospace"
            fill="white"
            textAnchor="middle"
          >
            {chip.label}
          </text>
        </g>
      )}
    </g>
  );
}
