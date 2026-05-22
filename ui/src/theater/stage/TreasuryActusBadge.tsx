/**
 * TreasuryActusBadge — small "ACTUS ✓" pill that flashes near treasury
 * ---------------------------------------------------------------------------
 * Phase 3c addendum. Surfaces the end-of-deal ACTUS cashflow notification
 * that treasury emits as a '🏦 Treasury → Seller' SSE without a preceding
 * '📨 Seller → Treasury' request. These messages contain 'ACTUS' but no
 * 'APPROVED'/'REJECTED' outcome, so they're not consult responses — they're
 * just treasury reporting that the cashflow math succeeded.
 *
 * Visual: a small green pill below treasury, deliberately lower-key than
 * the spotlight overlay used for actual approval decisions. Label is
 * 'CASHFLOW ✓' — accurate description of what treasury is actually doing
 * at this point (running the ACTUS cashflow standard to verify settlement
 * amounts), without leaking the standard's name into the UI.
 *
 * Trigger pattern mirrors VerificationRiver — parent owns an integer token
 * (actusFlashToken from useTreasuryConsult). Each increment plays one
 * pop-in → hold → fade-out cycle. The initial value 0 is skipped on mount
 * so the badge does not flash when the user first navigates to /agents-2.
 *
 * Timeline:
 *   - 200ms pop in (scale 0 → 1, opacity 0 → 1, back.out ease)
 *   - 1200ms hold (fully visible)
 *   - 400ms fade out (opacity 1 → 0, scale 1 → 0.9, power2.in ease)
 *
 * Z-order in TheaterStage: sits between EnvelopeLayer and IpexBallet — high
 * enough to draw over envelopes flying in/out of treasury, low enough that
 * IPEX parchment packets (the deal's actual final ceremony) stay on top.
 */

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { gsap } from './gsap-setup';

interface TreasuryActusBadgeProps {
  /** Increments from useTreasuryConsult.actusFlashToken every time an
   *  ACTUS-only treasury message arrives. */
  flashToken: number;
  treasuryX: number;
  treasuryY: number;
  treasuryR: number;
}

// Positioned BELOW treasury so it doesn't clash with the APPROVED/REJECTED
// chip (which sits ABOVE treasury when a consult resolves). They could in
// principle render in the same brief window if the backend ever emits them
// back-to-back, but the spotlight chip auto-dismisses at 2.5s while the
// badge resolves at ~1.8s — they coexist cleanly.
const VERTICAL_OFFSET = 22;

export function TreasuryActusBadge({
  flashToken,
  treasuryX,
  treasuryY,
  treasuryR,
}: TreasuryActusBadgeProps) {
  const groupRef = useRef<SVGGElement>(null);
  // Phase 8a — when prefers-reduced-motion is set, replace the pop/hold/fade
  // timeline with a plain setTimeout: show immediately, hide after the
  // equivalent hold duration.
  const reduce = useReducedMotion();

  useEffect(() => {
    if (flashToken === 0) return;   // skip initial mount
    const el = groupRef.current;
    if (!el) return;

    if (reduce) {
      // Static show → hold → static hide. 1400ms ≈ pop(200) + hold(1200);
      // the fade tween is dropped entirely.
      gsap.killTweensOf(el);
      gsap.set(el, { opacity: 1, scale: 1, transformOrigin: '50% 50%' });
      const timer = window.setTimeout(() => {
        gsap.set(el, { opacity: 0 });
      }, 1400);
      return () => window.clearTimeout(timer);
    }

    // Reset to hidden + scaled-down at the badge's resting position.
    gsap.killTweensOf(el);
    gsap.set(el, {
      opacity: 0,
      scale: 0,
      transformOrigin: '50% 50%',
    });

    const tl = gsap.timeline();
    // 1) Pop in
    tl.to(el, {
      opacity: 1,
      scale: 1,
      duration: 0.20,
      ease: 'back.out(2)',
    });
    // 2) Hold (no tween, just a delay marker)
    tl.to(el, { opacity: 1, duration: 1.20 });
    // 3) Fade out
    tl.to(el, {
      opacity: 0,
      scale: 0.9,
      duration: 0.40,
      ease: 'power2.in',
    });

    return () => { tl.kill(); };
  }, [flashToken, reduce]);

  const cx = treasuryX;
  const cy = treasuryY + treasuryR + VERTICAL_OFFSET;

  return (
    <g
      ref={groupRef}
      style={{ opacity: 0, pointerEvents: 'none' }}
      aria-hidden="true"
      data-layer="treasury-actus-badge"
      transform={`translate(${cx}, ${cy})`}
    >
      {/* Pill background — emerald to match success semantics elsewhere on stage */}
      <rect
        x={-58}
        y={-11}
        width={116}
        height={22}
        rx={11}
        fill="#10b981"
        fillOpacity={0.96}
        stroke="white"
        strokeOpacity={0.55}
        strokeWidth={1}
      />
      {/* Soft outer glow */}
      <rect
        x={-62}
        y={-15}
        width={124}
        height={30}
        rx={15}
        fill="#10b981"
        fillOpacity={0.18}
      />
      {/* Label */}
      <text
        x={0}
        y={4}
        fontSize={11}
        fontWeight={700}
        fontFamily="ui-monospace, monospace"
        fill="white"
        textAnchor="middle"
        letterSpacing="0.4"
      >
        CASHFLOW ✓
      </text>
    </g>
  );
}
