/**
 * useVerificationRiver — trigger state machine for the river animation
 * ---------------------------------------------------------------------------
 * Triggers the river animation when verification has just completed and
 * negotiation is starting. Detection logic:
 *
 *   PRIMARY (cross-tab safe, SSE-based):
 *     Any SSE event whose text matches /Negotiation started|Initial offer:/.
 *     These always appear right after a successful verify in AgentCenter.
 *     Because the trigger comes through SSE, it works whether the user is
 *     running the negotiation from /agents in the same tab or a different
 *     browser tab.
 *
 *   SECONDARY (same-tab, simulation-based):
 *     simulation.state.agents.buyer.status transitions to 'active'.
 *     Only fires when negotiation is started from the SAME React tree.
 *
 *   MANUAL:
 *     replay() — debug button, increments token directly.
 *
 * The token strictly monotonically increases. Each new value re-runs the
 * GSAP timeline in VerificationRiver. We dedupe SSE triggers by event id
 * (the same event won't trigger twice even if React StrictMode re-renders).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { useSimulation } from '@/hooks/useSimulation';
import type { LogEvent } from '@/theater/shared/types';

type AgentStatus = 'idle' | 'active' | 'paused';

interface UseVerificationRiverOptions {
  simulation: ReturnType<typeof useSimulation>;
  events: LogEvent[];
}

export interface UseVerificationRiverResult {
  /** Incremented every time the river should animate. */
  playToken: number;
  /** Manual trigger — increment the token now. */
  replay: () => void;
}

// Patterns that indicate verification has just completed and negotiation
// is about to start. These strings come from a2aService.ts parseNegotiationUpdate
// and the buyer agent's broadcast on start.
const TRIGGER_PATTERNS = [
  /Negotiation started/,
  /Initial offer:/,
  /✓ Negotiation started/,
];

function eventShouldTrigger(ev: LogEvent): boolean {
  // Primary cross-tab trigger: synthesized verify events from useVleiStatus.
  // Fire on the final step (5) of a successful verification cascade so the
  // river plays once per side rather than 5 times.
  if (ev.kind === 'verify' && ev.payload.step === 5 && ev.payload.status === 'ok') {
    return true;
  }
  // Secondary trigger: SSE messages indicating negotiation has begun, which
  // implies verification just succeeded (the gate is in AgentCenter).
  if (ev.kind === 'sse') {
    return TRIGGER_PATTERNS.some(p => p.test(ev.payload.text));
  }
  return false;
}

export function useVerificationRiver({
  simulation,
  events,
}: UseVerificationRiverOptions): UseVerificationRiverResult {
  const [playToken, setPlayToken] = useState(0);
  // Dedup SSE triggers — Set of event ids we've already used as triggers.
  const triggeredIdsRef = useRef<Set<string>>(new Set());
  // For the secondary (same-tab) trigger.
  const prevStatusRef = useRef<AgentStatus>(simulation.state.agents.buyer.status as AgentStatus);
  // On mount, mark all existing events as already-considered so navigating
  // to /agents-2 mid-negotiation doesn't immediately trigger.
  const initializedRef = useRef(false);

  // ─── Primary trigger — SSE events ───────────────────────────────────
  useEffect(() => {
    // First effect run: mark all existing events as seen, don't trigger.
    if (!initializedRef.current) {
      for (const ev of events) triggeredIdsRef.current.add(ev.id);
      initializedRef.current = true;
      return;
    }
    // Scan for new matching events.
    let shouldTrigger = false;
    for (const ev of events) {
      if (triggeredIdsRef.current.has(ev.id)) continue;
      triggeredIdsRef.current.add(ev.id);
      if (eventShouldTrigger(ev)) {
        shouldTrigger = true;
        // Don't break — mark all events as seen so we don't re-process
        // older events if React re-renders with a different events array
        // reference (e.g. after clear() then refill).
      }
    }
    if (shouldTrigger) {
      setPlayToken(t => t + 1);
    }
  }, [events]);

  // ─── Secondary trigger — simulation status (same-tab only) ──────────
  useEffect(() => {
    const cur = simulation.state.agents.buyer.status as AgentStatus;
    const prev = prevStatusRef.current;
    if (prev !== 'active' && cur === 'active') {
      setPlayToken(t => t + 1);
    }
    prevStatusRef.current = cur;
  }, [simulation.state.agents.buyer.status]);

  const replay = useCallback(() => {
    setPlayToken(t => t + 1);
  }, []);

  return { playToken, replay };
}
