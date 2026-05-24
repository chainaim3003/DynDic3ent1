/**
 * usePhaseClassification — derive Phase with snapshot replay support (Phase 4b)
 * ---------------------------------------------------------------------------
 * Path A snapshot-replay version. Two derivations:
 *
 *   livePhase: derived from the full events array. Drives the side-effect
 *              that pushes synthesized 'phase'-kind events back into the log
 *              so the BottomTimeline phase strip has stable boundary markers.
 *              Always updates as live SSE arrives, regardless of scrub state.
 *
 *   viewPhase: derived from events[0..viewEnd] using the caller's view-time
 *              rounds + status. This is what we return for display — when
 *              the user scrubs the timeline, viewPhase rolls back with them.
 *
 * Why both: scrubbing must change what the user SEES (viewPhase), but it
 * must NOT prevent the log from gaining phase boundary markers for events
 * that arrive during the scrub session. Otherwise, when the user resumes
 * live, the phase strip would be missing the bands for everything that
 * happened while they were paused.
 *
 * Self-contained consult / IPEX detection:
 *   Instead of taking external boolean props, the derivation scans the
 *   recent event tail for unmatched '📨 Seller → Treasury' (→ consult) and
 *   ipex-kind events (→ ipex). This keeps the hook decoupled from
 *   useTreasuryConsult / useIpexBallet state machines AND ensures viewPhase
 *   is genuinely derivable for any historical moment, not just "right now".
 */

import { useEffect, useMemo, useRef } from 'react';
import type { LogEvent, Phase, Round } from '@/theater/shared/types';
import type { NegotiationStatus } from './useNegotiationRounds';

// Tail window for transient sub-phase detection. 4 covers the typical IPEX
// burst (grant + admit + invoice + 1 buffer) and any treasury request/response
// pair without polluting earlier history.
const TRANSIENT_TAIL_WINDOW = 4;

interface UsePhaseClassificationOptions {
  events: LogEvent[];
  /** Rounds + status derived at the LIVE upper bound (events.length-1). */
  liveRounds: Round[];
  liveStatus: NegotiationStatus;
  /** Rounds + status derived at viewEnd. */
  viewRounds: Round[];
  viewStatus: NegotiationStatus;
  /** Inclusive upper bound for view derivation. Defaults to events.length-1. */
  viewEnd?: number;
  /** Push synthesized 'phase' event on LIVE phase transitions. */
  pushEvent?: (init: {
    kind: 'phase';
    payload: { phase: Phase; reason?: string };
    ts?: number;
  }) => void;
}

export interface UsePhaseClassificationResult {
  /** Phase at the scrubbed moment (or live moment if viewEnd is latest). */
  phase: Phase;
  /** Phase at the latest event. Exposed for callers that need true-live phase. */
  livePhase: Phase;
}

// ── Pure derivation ───────────────────────────────────────────────────────
function derivePhase(
  events: LogEvent[],
  upperInclusive: number,
  rounds: Round[],
  status: NegotiationStatus,
): Phase {
  const cap = Math.min(upperInclusive, events.length - 1);

  // High-priority terminal state
  if (status === 'escalated') return 'escalate';

  // Self-contained consult detection: is there an unmatched
  // '📨 Seller → Treasury' in the tail window before viewEnd?
  const tailStart = Math.max(0, cap - TRANSIENT_TAIL_WINDOW);
  let lastConsultStart = -1;
  let lastConsultEnd   = -1;
  let ipexInTail = false;
  for (let i = tailStart; i <= cap && i < events.length; i++) {
    const ev = events[i];
    if (ev.kind === 'ipex') ipexInTail = true;
    if (ev.kind !== 'sse') continue;
    if (ev.payload.channel !== 'treasury') continue;
    if (ev.payload.text.startsWith('📨 Seller → Treasury')) lastConsultStart = i;
    if (ev.payload.text.startsWith('🏦 Treasury → Seller')) lastConsultEnd   = i;
  }
  if (lastConsultStart > lastConsultEnd) return 'consult';
  if (ipexInTail) return 'ipex';

  if (status === 'completed') return 'close';
  if (status === 'failed')    return 'close';

  if (rounds.length >= 2)            return 'negotiate';
  if (rounds.length === 1)           return 'handshake';
  if (status === 'in_progress')      return 'request';

  // verify if any verify event has been seen so far
  for (let i = 0; i <= cap && i < events.length; i++) {
    if (events[i].kind === 'verify') return 'verify';
  }

  return 'idle';
}

function reasonFor(phase: Phase, status: NegotiationStatus, roundCount: number): string {
  switch (phase) {
    case 'escalate':  return 'status escalated';
    case 'consult':   return 'treasury consult active';
    case 'ipex':      return 'IPEX grant/admit in recent log tail';
    case 'close':     return status === 'failed' ? 'negotiation failed' : 'deal closed';
    case 'negotiate': return `round ${roundCount}`;
    case 'handshake': return 'first counter-offer';
    case 'request':   return 'awaiting initial offer';
    case 'verify':    return 'identity verification underway';
    case 'idle':      return 'no negotiation';
  }
}

export function usePhaseClassification({
  events,
  liveRounds,
  liveStatus,
  viewRounds,
  viewStatus,
  viewEnd,
  pushEvent,
}: UsePhaseClassificationOptions): UsePhaseClassificationResult {
  const effectiveViewEnd = viewEnd ?? events.length - 1;

  // Live phase — drives the side-effect push. Always uses full events array.
  const livePhase = useMemo(
    () => derivePhase(events, events.length - 1, liveRounds, liveStatus),
    [events, liveRounds, liveStatus],
  );

  // View phase — drives display. Rolls back with the scrubber.
  const viewPhase = useMemo(
    () => derivePhase(events, effectiveViewEnd, viewRounds, viewStatus),
    [events, effectiveViewEnd, viewRounds, viewStatus],
  );

  // Side-effect: push 'phase' event when LIVE phase changes. Skipped on
  // initial mount so loading /agents-2 mid-deal doesn't synthesize a spurious
  // idle→X marker. Runs regardless of scrub state — the user being paused
  // doesn't stop the underlying log from gaining phase boundary markers
  // for events that arrive during the pause.
  const prevLivePhaseRef = useRef<Phase | null>(null);
  useEffect(() => {
    if (prevLivePhaseRef.current === null) {
      prevLivePhaseRef.current = livePhase;
      return;
    }
    if (prevLivePhaseRef.current === livePhase) return;
    if (pushEvent) {
      pushEvent({
        kind: 'phase',
        payload: {
          phase: livePhase,
          reason: reasonFor(livePhase, liveStatus, liveRounds.length),
        },
      });
    }
    prevLivePhaseRef.current = livePhase;
  }, [livePhase, liveStatus, liveRounds.length, pushEvent]);

  return { phase: viewPhase, livePhase };
}
