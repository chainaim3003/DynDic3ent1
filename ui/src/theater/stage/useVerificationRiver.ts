/**
 * useVerificationRiver — trigger state machine for the river animation
 * ---------------------------------------------------------------------------
 * Triggers the river animation when verification has just completed and
 * negotiation is starting. Detection logic:
 *
 *   PRIMARY (cross-tab safe, SSE-based):
 *     Any SSE event whose text matches one of TRIGGER_PATTERNS:
 *       • "identity check passed"          — plain-mode verification success
 *                                              (CREDENTIAL_MODE=plain path)
 *       • "delegation chain verified"      — vLEI-mode verification success
 *       • "Negotiation started" / "Initial offer:" / "✓ Negotiation started"
 *                                            — fallback: implies verify just
 *                                              passed (gate is in agent code)
 *     A 5-second debounce prevents the verify-passed + initial-offer pair
 *     from triggering the river twice for a single negotiation.
 *
 *   SECONDARY (same-tab, simulation-based):
 *     simulation.state.agents.buyer.status transitions to 'active'.
 *     Only fires when negotiation is started from the SAME React tree.
 *
 *   TERTIARY (cross-tab, vLEI-api-server-based):
 *     Synthesized verify events from useVleiStatus (step 5 OK). Only fires
 *     when CREDENTIAL_MODE=vlei AND :4000 is reachable. Becomes a no-op in
 *     plain mode — the PRIMARY SSE-based triggers cover that case.
 *
 *   MANUAL:
 *     replay() — debug button, increments token directly. Bypasses debounce.
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
// is about to start. Sourced from the buyer-agent's broadcasts inside
// startNegotiation (verified 2026-05-23 by reading
// A2A/js/src/agents/buyer-agent/index.ts §startNegotiation):
//   plain mode — "✓ Seller plain-mode identity check passed (NOT vLEI — …)"
//   vLEI mode  — "✅ Seller vLEI delegation chain verified (…)"
// Plus legacy fallbacks from a2aService.ts parseNegotiationUpdate that
// fire after the verify gate on the buyer side.
const TRIGGER_PATTERNS = [
  // Phase A (this iteration) — verification-completion patterns. These
  // fire in BOTH plain and vLEI modes, so the river plays even when
  // :4000 isn't running.
  /identity check passed/i,
  /delegation chain verified/i,
  // Legacy fallbacks — these fire just after verification anyway, so they
  // remain valid signals. The debounce below makes them harmless duplicates.
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
  // Debounce token: timestamp of the last automatic trigger. Within
  // DEBOUNCE_MS of a play, additional matching events are ignored. Stops
  // the verify-passed → initial-offer pair from playing the river twice
  // per negotiation (they arrive ~500ms apart in startNegotiation).
  // manual replay() bypasses this.
  const lastTriggerTsRef = useRef<number>(0);
  const DEBOUNCE_MS = 5_000;

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
      const now = Date.now();
      if (now - lastTriggerTsRef.current >= DEBOUNCE_MS) {
        lastTriggerTsRef.current = now;
        setPlayToken(t => t + 1);
      }
      // else: debounced — verify-passed already triggered the river
      // ~500ms ago; the offer-arrival event is the same trust-chain
      // ceremony, no second play needed.
    }
  }, [events]);

  // ─── Secondary trigger — simulation status (same-tab only) ──────────
  useEffect(() => {
    const cur = simulation.state.agents.buyer.status as AgentStatus;
    const prev = prevStatusRef.current;
    if (prev !== 'active' && cur === 'active') {
      const now = Date.now();
      if (now - lastTriggerTsRef.current >= DEBOUNCE_MS) {
        lastTriggerTsRef.current = now;
        setPlayToken(t => t + 1);
      }
    }
    prevStatusRef.current = cur;
  }, [simulation.state.agents.buyer.status]);

  // Manual replay — bypasses the debounce. The debug button still works
  // when someone wants to replay the river without waiting for the
  // 5-second window to expire.
  const replay = useCallback(() => {
    lastTriggerTsRef.current = Date.now();
    setPlayToken(t => t + 1);
  }, []);

  return { playToken, replay };
}
