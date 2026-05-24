/**
 * MessageEnvelope — one flying envelope, animated by GSAP MotionPath
 * ---------------------------------------------------------------------------
 * SVG element. Lives in the SVG layer of TheaterStage. Animates from a
 * sender's position to a receiver's position along a curved bezier path.
 *
 * Animation lifecycle (~960ms total):
 *   1. 180ms — pop in at sender (scale 0 → 1, opacity 0 → 1, back.out ease)
 *   2. 600ms — fly along bezier to receiver (power1.inOut ease)
 *   3. 180ms — fade out at receiver (scale 1 → 0.7, opacity → 0)
 *   4. onComplete fires → parent removes flight from state → unmount
 *
 * Bezier shape: arc upward (above the straight line) for buyer↔seller,
 * downward for seller↔treasury, so treasury consults don't overlap with
 * negotiation envelopes during heavy traffic.
 *
 * Color is determined by message kind, matching the AgentCenter chat
 * bubble palette so the same kind reads the same across both views.
 *
 * Mount-flash prevention: the JSX renders the <g> with opacity:0 so there's
 * no one-frame flash at SVG origin (0,0) between React mount and the GSAP
 * useEffect that translates it to the sender position.
 */

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { gsap } from './gsap-setup';
import type { NegotiationMessage } from '@/lib/a2aService';
import { ANIM } from '@/theater/shared/constants';

interface MessageEnvelopeProps {
  fromX: number; fromY: number;
  toX: number;   toY: number;
  kind: NegotiationMessage['kind'];
  /** Whether the arc bows upward (default, buyer↔seller) or downward
   *  (for seller↔treasury so envelopes don't collide). */
  arcDirection?: 'up' | 'down';
  /** GSAP timeline calls this when the flight finishes. Parent should
   *  use it to remove this flight from its state, which unmounts the
   *  envelope and triggers GSAP cleanup via the useEffect cleanup. */
  onComplete: () => void;
}

// Color per message kind — chosen to match the AgentCenter palette so a
// buyer "↑ Counter-offer" looks the same in chat and on stage.
const KIND_COLOR: Record<NegotiationMessage['kind'], string> = {
  offer:    '#3b82f6',  // blue
  counter:  '#f59e0b',  // amber
  accept:   '#10b981',  // emerald
  reject:   '#ef4444',  // red
  po:       '#06b6d4',  // cyan
  invoice:  '#a855f7',  // purple
  dd:       '#eab308',  // yellow
  escalate: '#f97316',  // orange
  info:     '#94a3b8',  // slate
};

export function MessageEnvelope({
  fromX, fromY, toX, toY,
  kind,
  arcDirection = 'up',
  onComplete,
}: MessageEnvelopeProps) {
  const ref = useRef<SVGGElement>(null);
  // Capture latest onComplete in a ref so the timeline callback always
  // calls the current version, even if React re-renders the parent.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // Phase 8a — respect prefers-reduced-motion. Skip the flight entirely;
  // the envelope's role is decorative — the underlying event still appears
  // in the timeline / inspector / log.
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!ref.current) return;
    if (reduce) {
      // Short-circuit: signal completion immediately so the parent unmounts
      // this envelope. Microtask defers the setState past the render commit.
      queueMicrotask(() => onCompleteRef.current());
      return;
    }

    // Bezier midpoint — arc magnitude scales with horizontal distance, with
    // a minimum so short hops still read as curves.
    const horiz = Math.abs(toX - fromX);
    const arcMagnitude = Math.max(60, horiz * 0.28);
    const midX = (fromX + toX) / 2;
    const midY = arcDirection === 'up'
      ? Math.min(fromY, toY) - arcMagnitude
      : Math.max(fromY, toY) + arcMagnitude;

    // Set initial transform so the envelope is at sender, invisible, tiny.
    // (JSX renders with opacity:0 so there's no flash; this also sets x,y.)
    gsap.set(ref.current, {
      x: fromX,
      y: fromY,
      scale: 0,
      opacity: 0,
      transformOrigin: '50% 50%',
    });

    const tl = gsap.timeline({
      onComplete: () => onCompleteRef.current(),
    });

    // 1) Pop in at sender
    tl.to(ref.current, {
      scale: 1,
      opacity: 1,
      duration: ANIM.envelopeFadeIn / 1000,
      ease: 'back.out(2)',
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
    }, `-=${(ANIM.envelopeFadeIn * 0.6) / 1000}`);

    // 3) Fade out at receiver
    tl.to(ref.current, {
      scale: 0.7,
      opacity: 0,
      duration: ANIM.envelopeFadeOut / 1000,
      ease: 'power2.in',
    }, `-=${(ANIM.envelopeFadeOut * 0.5) / 1000}`);

    return () => {
      // Kill timeline on unmount / StrictMode cleanup so callbacks
      // don't fire after the element is gone.
      tl.kill();
    };
    // Flight is one-shot. `reduce` is included so toggling the OS
    // prefers-reduced-motion setting takes effect on the next flight;
    // other props are mount-time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  const color = KIND_COLOR[kind] ?? KIND_COLOR.info;

  return (
    <g
      ref={ref}
      style={{ opacity: 0, pointerEvents: 'none' }}  // pre-hidden to prevent mount flash
    >
      {/* Glow */}
      <circle cx={0} cy={0} r={14} fill={color} opacity={0.18} />
      {/* Envelope body */}
      <rect
        x={-11} y={-7.5}
        width={22} height={15}
        rx={2.5}
        fill={color}
        opacity={0.92}
        stroke="white"
        strokeOpacity={0.45}
        strokeWidth={0.6}
      />
      {/* Envelope flap (V) */}
      <polyline
        points="-11,-7.5 0,2.5 11,-7.5"
        fill="none"
        stroke="white"
        strokeOpacity={0.7}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
    </g>
  );
}
