/**
 * BackOfficeConsult — overlay for credit/inventory/logistics consults
 * ---------------------------------------------------------------------------
 * Phase 9d. Generalized counterpart of TreasuryConsult, tuned for the three
 * Jupiter back-office sub-agents. Differences from treasury:
 *
 *   • No dim mask. Treasury pulls focus by darkening the rest of the stage;
 *     back-office uses ADDITIVE light (spotlight glow) so multiple sub-
 *     agents can consult in parallel without compounding dim layers.
 *   • Verdict chip pops + holds + fades on a fixed 2.1s timeline (pop 250,
 *     hold 1450, fade 400) — same rhythm as TreasuryActusBadge.
 *   • Per-agent color (amber / orange / teal) inherits from the same hex
 *     palette as AvatarDisc/StateAura, so visuals stay coherent.
 *
 * Z-order: drawn AFTER per-agent groups + TreasuryConsult, BEFORE the
 * EnvelopeLayer. So envelopes flying to a consulting sub-agent draw on
 * top of the spotlight, while the spotlight draws on top of the dimmed
 * back-row band. Verdict chip sits at the top of the back-office stack
 * since it's the most important info bit during a verdict.
 *
 * prefers-reduced-motion: spotlight + ring opacity toggle statically;
 * chip flash uses setTimeout (no pop scale, no fade tween) — matches the
 * Phase 8a guards we use for TreasuryConsult / TreasuryActusBadge.
 */

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { gsap } from './gsap-setup';
import type {
  BackOfficeConsultState,
  UseBackOfficeConsultResult,
} from './useBackOfficeConsult';
import type { AgentPosition } from './useStageLayout';

// Same hex palette as AvatarDisc/StateAura. Centralised here to keep the
// overlay self-contained — no cross-file color drift.
const COLOR_BY_AGENT = {
  credit:    '#f59e0b',  // amber-500
  inventory: '#f97316',  // orange-500
  logistics: '#14b8a6',  // teal-500
} as const;

type SubAgentId = keyof typeof COLOR_BY_AGENT;
const SUB_AGENTS: SubAgentId[] = ['credit', 'inventory', 'logistics'];

interface BackOfficeConsultProps {
  states: UseBackOfficeConsultResult;
  positions: {
    credit:    AgentPosition;
    inventory: AgentPosition;
    logistics: AgentPosition;
  };
}

export function BackOfficeConsult({ states, positions }: BackOfficeConsultProps) {
  return (
    <g aria-hidden="true">
      <defs>
        {SUB_AGENTS.map(id => (
          // Per-agent radial gradient. Defined once in <defs>; the
          // spotlight rect references it by id and is positioned/sized
          // around the agent. cx/cy are 50% so the gradient centers
          // wherever the rect is placed.
          <radialGradient
            key={id}
            id={`back-office-glow-${id}`}
            cx="50%"
            cy="50%"
            r="50%"
          >
            <stop offset="0%"   stopColor={COLOR_BY_AGENT[id]} stopOpacity="0.42" />
            <stop offset="55%"  stopColor={COLOR_BY_AGENT[id]} stopOpacity="0.14" />
            <stop offset="100%" stopColor={COLOR_BY_AGENT[id]} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>

      {SUB_AGENTS.map(id => (
        <SubAgentConsult
          key={id}
          id={id}
          state={states[id]}
          position={positions[id]}
        />
      ))}
    </g>
  );
}

// ─── per-agent overlay subtree ────────────────────────────────────────

interface SubAgentConsultProps {
  id: SubAgentId;
  state: BackOfficeConsultState;
  position: AgentPosition;
}

function SubAgentConsult({ id, state, position }: SubAgentConsultProps) {
  const reduce = useReducedMotion();
  const glowRef    = useRef<SVGCircleElement>(null);
  const ringRef    = useRef<SVGCircleElement>(null);
  const ringLoopRef = useRef<gsap.core.Timeline | null>(null);
  const chipGroupRef = useRef<SVGGElement>(null);

  const color = COLOR_BY_AGENT[id];
  const { x, y, r } = position;
  // Spotlight covers ~50 viewBox units (Phase 9e: 70 → 50 to match the
  // smaller r=30 sub-agents and the tighter 130×95 cluster spacing).
  // Still large enough to halo the disc + character animation without
  // spilling into neighbors.
  const SPOT_R = 50;

  // ── Effect 1: spotlight + thinking ring follow `state.active` ─────
  useEffect(() => {
    const glow = glowRef.current;
    const ring = ringRef.current;
    if (!glow || !ring) return;

    // Always tear down any prior loop before deciding next state.
    if (ringLoopRef.current) {
      ringLoopRef.current.kill();
      ringLoopRef.current = null;
    }
    gsap.killTweensOf([glow, ring]);

    if (reduce) {
      // Static toggle.
      gsap.set(glow, { opacity: state.active ? 1 : 0 });
      gsap.set(ring, { opacity: state.active ? 0.7 : 0, attr: { r: r + 10 } });
      return;
    }

    if (state.active) {
      // Glow fades in and stays. Ring fades in, then loops an expand/
      // contract pulse to convey "thinking".
      gsap.to(glow, { opacity: 1, duration: 0.35, ease: 'power2.out' });
      gsap.to(ring, { opacity: 0.75, duration: 0.35, ease: 'power2.out' });

      const loop = gsap.timeline({ repeat: -1, defaults: { ease: 'sine.inOut' } });
      loop.to(ring, { attr: { r: r + 16 }, opacity: 0.35, duration: 1.1 });
      loop.to(ring, { attr: { r: r + 10 }, opacity: 0.75, duration: 1.1 });
      ringLoopRef.current = loop;
    } else {
      // Fade out both. Glow first (slower) so the ring exits cleanly.
      gsap.to(glow, { opacity: 0, duration: 0.45, ease: 'power2.in' });
      gsap.to(ring, { opacity: 0, duration: 0.35, ease: 'power2.in' });
    }

    return () => {
      if (ringLoopRef.current) {
        ringLoopRef.current.kill();
        ringLoopRef.current = null;
      }
    };
  }, [state.active, r, reduce]);

  // ── Effect 2: chip pop/hold/fade on each new verdict ───────────────
  useEffect(() => {
    if (state.verdictFlashToken === 0) return;  // no verdict yet
    const el = chipGroupRef.current;
    if (!el) return;

    gsap.killTweensOf(el);

    if (reduce) {
      // Static show → hold → static hide, no scale/fade.
      gsap.set(el, { opacity: 1, scale: 1, transformOrigin: '50% 50%' });
      const timer = window.setTimeout(() => gsap.set(el, { opacity: 0 }), 1900);
      return () => window.clearTimeout(timer);
    }

    const tl = gsap.timeline();
    tl.set(el, {
      opacity: 0,
      scale: 0.6,
      transformOrigin: '50% 50%',
    });
    // Pop in
    tl.to(el, { opacity: 1, scale: 1.0, duration: 0.25, ease: 'back.out(2.2)' });
    // Hold
    tl.to(el, { duration: 1.45 });
    // Fade out
    tl.to(el, { opacity: 0, duration: 0.4, ease: 'power2.in' });

    return () => { tl.kill(); };
  }, [state.verdictFlashToken, reduce]);

  // Chip geometry — sits just above the disc inside the cluster frame.
  // Phase 9e: pulled in to 30px above disc center (was 36 below disc top).
  // Width fixed; verdict text truncated to ~18 chars by useBackOfficeConsult.
  const CHIP_W = 76;
  const CHIP_H = 20;
  const chipX  = x - CHIP_W / 2;
  const chipY  = y - r - 26;  // 26px above disc top

  // Chip color by outcome — green for approved, red for rejected,
  // agent's color for pending (which shouldn't really appear, since
  // chip is only shown on verdict, but defensive).
  const chipFill =
    state.outcome === 'approved' ? '#10b981' :     // emerald-500
    state.outcome === 'rejected' ? '#ef4444' :     // red-500
    color;                                          // fallback

  return (
    <g>
      {/* Spotlight glow — a circle filled with the per-agent radial
          gradient. Starts at opacity 0 (no consult). */}
      <circle
        ref={glowRef}
        cx={x}
        cy={y}
        r={SPOT_R}
        fill={`url(#back-office-glow-${id})`}
        opacity={0}
        pointerEvents="none"
      />
      {/* Thinking ring — fill:none, stroked. Pulses radius+opacity on a
          loop while active. */}
      <circle
        ref={ringRef}
        cx={x}
        cy={y}
        r={r + 10}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeOpacity={1}
        opacity={0}
        pointerEvents="none"
      />
      {/* Verdict chip — pops via GSAP on verdictFlashToken change. */}
      <g ref={chipGroupRef} opacity={0} pointerEvents="none">
        <rect
          x={chipX}
          y={chipY}
          width={CHIP_W}
          height={CHIP_H}
          rx={CHIP_H / 2}
          fill={chipFill}
          stroke={chipFill}
          strokeOpacity={0.6}
        />
        <text
          x={x}
          y={chipY + CHIP_H / 2 + 4}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fontFamily="JetBrains Mono, ui-monospace, monospace"
          fill="white"
        >
          {state.verdict}
        </text>
      </g>
    </g>
  );
}

export default BackOfficeConsult;
