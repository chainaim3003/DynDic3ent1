/**
 * StateAura — pulsing ring behind an agent's avatar disc, indicating state
 * ---------------------------------------------------------------------------
 * SVG element, sits in the SVG layer behind the AvatarDisc (which is HTML).
 * Uses pure CSS animation — NO gsap, NO motion/react. Phase 3 may upgrade
 * specific auras (e.g. when an envelope is mid-flight) but the steady-state
 * pulse stays CSS-driven so it doesn't compete with the choreographed
 * timeline for the GPU.
 *
 * States → color → animation:
 *   idle       → muted gray  → very slow gentle breath
 *   active     → cyan        → faster pulse (negotiating)
 *   verifying  → amber       → fast pulse (cryptographic check in progress)
 *   consulting → purple      → pulse + slight outward expansion
 *   escalated  → orange      → stuttered pulse
 *   completed  → green       → steady glow, no pulse
 *   failed     → red         → no pulse, dim
 *
 * Accessibility: aria-hidden — purely decorative. The status is also
 * communicated through the AgentNode's text label and aria-label.
 */

import React from 'react';
import { useReducedMotion } from 'motion/react';

export type AuraState =
  | 'idle'
  | 'active'
  | 'verifying'
  | 'consulting'
  | 'escalated'
  | 'completed'
  | 'failed';

interface StateAuraProps {
  cx: number;
  cy: number;
  /** Inner radius — matches the AvatarDisc radius. */
  r: number;
  state: AuraState;
  /** Tailwind color token from identities.ts ('buyer' | 'seller' | …).
   *  We map this to an explicit hex below for SVG stroke/fill. */
  colorToken: 'buyer' | 'seller' | 'treasury' | 'vlei' | 'credit' | 'inventory' | 'logistics';
}

// Each state has its own stroke opacity range + duration. We render TWO
// concentric rings — an inner steady ring and an outer expanding ring — so
// the pulse reads clearly without overwhelming the avatar.
const STATE_STYLE: Record<AuraState, { baseOpacity: number; pulseDuration: string; expand: boolean }> = {
  idle:       { baseOpacity: 0.18, pulseDuration: '3.5s', expand: true  },
  active:     { baseOpacity: 0.40, pulseDuration: '1.4s', expand: true  },
  verifying:  { baseOpacity: 0.55, pulseDuration: '0.9s', expand: true  },
  consulting: { baseOpacity: 0.45, pulseDuration: '1.6s', expand: true  },
  escalated:  { baseOpacity: 0.50, pulseDuration: '0.7s', expand: false },
  completed:  { baseOpacity: 0.55, pulseDuration: '0s',   expand: false },  // steady glow
  failed:     { baseOpacity: 0.15, pulseDuration: '0s',   expand: false },
};

// Map color token → CSS color. The app's tailwind.config.ts declares CSS
// variables under these token names (see globals.css / tailwind.config),
// but for stroke/fill in SVG we use explicit hex matching the design.
// Phase 9a tokens (credit/inventory/logistics) match Tailwind palette
// values used in AvatarDisc.tsx.
const TOKEN_HEX: Record<StateAuraProps['colorToken'], string> = {
  buyer:     '#3b82f6',  // blue-500 — matches text-agent-buyer
  seller:    '#10b981',  // emerald-500 — matches text-agent-seller
  treasury:  '#a855f7',  // purple-500 — matches text-agent-treasury
  vlei:      '#64748b',  // slate-500
  credit:    '#f59e0b',  // amber-500
  inventory: '#f97316',  // orange-500
  logistics: '#14b8a6',  // teal-500
};

export function StateAura({ cx, cy, r, state, colorToken }: StateAuraProps) {
  // Phase 8a — when prefers-reduced-motion is set, suppress the infinite
  // pulse keyframes and hold the outer ring at its base opacity. CSS
  // animations don't auto-respect the OS setting (unlike GSAP timelines
  // we can kill via JS), so this opt-out is explicit.
  const reduce = useReducedMotion();
  const style = STATE_STYLE[state];
  const color = TOKEN_HEX[colorToken];
  // Each instance gets its own keyframe name suffix to avoid collisions
  // when multiple auras share a page.
  const animName = `theater-aura-${state}-${colorToken}`;

  // For Phase 2 we use inline <style> blocks so the keyframes ride along
  // with each aura instance. Phase 3 will hoist these to a single
  // stylesheet if perf is an issue, but at <10 auras the overhead is nil.
  const keyframes = (reduce || style.pulseDuration === '0s')
    ? ''
    : style.expand
      ? `@keyframes ${animName} {
          0%   { opacity: ${style.baseOpacity};       r: ${r + 6}; stroke-width: 1.5; }
          50%  { opacity: ${style.baseOpacity * 0.4}; r: ${r + 18}; stroke-width: 0.6; }
          100% { opacity: ${style.baseOpacity};       r: ${r + 6}; stroke-width: 1.5; }
        }`
      : `@keyframes ${animName} {
          0%, 100% { opacity: ${style.baseOpacity}; }
          50%      { opacity: ${style.baseOpacity * 0.3}; }
        }`;

  const animStyle = (reduce || style.pulseDuration === '0s')
    ? { opacity: style.baseOpacity }
    : { animation: `${animName} ${style.pulseDuration} ease-in-out infinite` };

  return (
    <g aria-hidden="true">
      {keyframes && <style>{keyframes}</style>}
      {/* Outer pulsing ring */}
      <circle
        cx={cx}
        cy={cy}
        r={r + 12}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        style={animStyle}
      />
      {/* Inner steady ring — provides a subtle "halo" anchor */}
      <circle
        cx={cx}
        cy={cy}
        r={r + 4}
        fill={color}
        fillOpacity={style.baseOpacity * 0.15}
        stroke={color}
        strokeOpacity={style.baseOpacity * 0.6}
        strokeWidth={0.6}
      />
    </g>
  );
}
