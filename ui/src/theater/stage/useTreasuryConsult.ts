/**
 * useTreasuryConsult — state machine for the treasury spotlight overlay
 * ---------------------------------------------------------------------------
 * Phase 3c. Detects treasury-consult start and end from the SSE event log:
 *
 *   START: any treasury-channel SSE event whose text starts with
 *          '📨 Seller → Treasury' → state goes to { active: true, outcome: 'pending' }
 *
 *   END:   any treasury-channel SSE event whose text starts with
 *          '🏦 Treasury → Seller' → outcome is set from body text:
 *            - /APPROVED\s*✓/ → 'approved'
 *            - /REJECTED\s*✗/ → 'rejected'
 *            - otherwise         → 'pending' (display fallback, shouldn't happen)
 *          A 2500ms auto-dismiss timer is then armed to fade the overlay out.
 *
 * ACTUS notification (added after Phase 3c testing revealed a missed event):
 *   '🏦 Treasury → Seller' messages also arrive at end-of-deal carrying the
 *   ACTUS cashflow result (text contains 'ACTUS' but NEITHER 'APPROVED' nor
 *   'REJECTED'). These are not consult responses — treasury just reports that
 *   the cashflow math succeeded. We surface them via a separate actusFlashToken
 *   counter that TreasuryActusBadge watches; it pops a small 'ACTUS ✓' pill
 *   near treasury for ~1.5s without engaging the dramatic spotlight overlay.
 *
 *   Decision: if a single message contains BOTH a consult outcome AND 'ACTUS'
 *   (unlikely in practice), the consult-outcome path wins and the ACTUS flash
 *   is suppressed for that event.
 *
 * Pause/skip-backlog behavior mirrors useEnvelopeFlights and useIpexBallet.
 *
 * Concurrency: if a new consult starts while the previous one is still
 * fading out, the dismiss timer is cancelled and state re-enters pending.
 * Multiple concurrent consults (rare — treasury negotiations are
 * sequential per deal) collapse into one continuous spotlight.
 */

import { useEffect, useRef, useState } from 'react';
import type { LogEvent } from '@/theater/shared/types';

export type TreasuryConsultOutcome = 'pending' | 'approved' | 'rejected';

interface UseTreasuryConsultOptions {
  events: LogEvent[];
  paused: boolean;
}

export interface UseTreasuryConsultResult {
  /** Whether the spotlight overlay should be visible (or fading out). */
  active: boolean;
  /** Current outcome — drives the APPROVED/REJECTED chip near treasury. */
  outcome: TreasuryConsultOutcome;
  /** Increments every time an ACTUS-only treasury message arrives.
   *  TreasuryActusBadge watches this exactly like VerificationRiver watches
   *  its playToken — each new value triggers a one-shot pop/hold/fade. */
  actusFlashToken: number;
}

// How long to keep the outcome chip visible after the response arrives,
// before fading out. Matches the prompt's spec of a brief outcome reveal.
const OUTCOME_HOLD_MS = 2500;

const RE_APPROVED = /APPROVED\s*✓/;
const RE_REJECTED = /REJECTED\s*✗/;
const RE_ACTUS    = /ACTUS/;

export function useTreasuryConsult({
  events,
  paused,
}: UseTreasuryConsultOptions): UseTreasuryConsultResult {
  const [active,  setActive]  = useState(false);
  const [outcome, setOutcome] = useState<TreasuryConsultOutcome>('pending');
  const [actusFlashToken, setActusFlashToken] = useState(0);

  const lastSeenIdxRef = useRef<number>(-1);
  const fadeTimerRef   = useRef<number | null>(null);

  // Skip backlog on mount.
  useEffect(() => {
    lastSeenIdxRef.current = events.length - 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paused) {
      lastSeenIdxRef.current = events.length - 1;
      return;
    }
    for (let i = lastSeenIdxRef.current + 1; i < events.length; i++) {
      const ev = events[i];
      if (ev.kind !== 'sse') continue;
      if (ev.payload.channel !== 'treasury') continue;

      const text = ev.payload.text;

      if (text.startsWith('📨 Seller → Treasury')) {
        // New consult begins — cancel any pending fade-out.
        if (fadeTimerRef.current !== null) {
          clearTimeout(fadeTimerRef.current);
          fadeTimerRef.current = null;
        }
        setActive(true);
        setOutcome('pending');
      } else if (text.startsWith('🏦 Treasury → Seller')) {
        const isApproved = RE_APPROVED.test(text);
        const isRejected = RE_REJECTED.test(text);
        if (isApproved || isRejected) {
          // Consult-response path — wins over ACTUS flash if both present.
          setOutcome(isApproved ? 'approved' : 'rejected');
          if (fadeTimerRef.current !== null) {
            clearTimeout(fadeTimerRef.current);
          }
          fadeTimerRef.current = window.setTimeout(() => {
            setActive(false);
            fadeTimerRef.current = null;
          }, OUTCOME_HOLD_MS);
        } else if (RE_ACTUS.test(text)) {
          // ACTUS-only notification — fire the small badge, no spotlight.
          // Token-increment pattern matches useVerificationRiver.replay().
          setActusFlashToken(t => t + 1);
        }
      }
    }
    lastSeenIdxRef.current = events.length - 1;
  }, [events, paused]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current !== null) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, []);

  return { active, outcome, actusFlashToken };
}
