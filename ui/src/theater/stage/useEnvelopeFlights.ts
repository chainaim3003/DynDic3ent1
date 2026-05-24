/**
 * useEnvelopeFlights — turn SSE events into envelope flight specs
 * ---------------------------------------------------------------------------
 * Watches the event log; when a new SSE event arrives, decides whether it
 * should spawn an envelope flight and from/to which agents. Each flight is
 * tracked in local state until its onComplete callback removes it.
 *
 * Routing rules:
 *   - Buyer channel + from=BUYER  → buyer → seller
 *   - Seller channel + from=SELLER → seller → buyer
 *   - Treasury channel:
 *       text starts with '📨 Seller → Treasury'  → seller → treasury
 *       text starts with '🏦 Treasury → Seller'  → treasury → seller
 *   - Channel-handshake noise ('Connected to ... events') is filtered out
 *
 * Pause behavior: when `paused` is true, new events DO NOT spawn flights.
 * The lastSeenIdxRef advances on resume to skip everything that piled up
 * during the pause — replaying historical flights on resume would look
 * confusing (200 envelopes at once). Phase 4 will add a dedicated replay
 * mode that consumes events from a specific index on demand.
 *
 * Concurrency: no hard cap. In practice <3 envelopes are airborne at
 * once because each flight is ~1s and SSE arrivals are spaced 0.5-2s.
 * If a stress test ever shows >20 simultaneous flights, add a cap here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEvent } from '@/theater/shared/types';
import type { NegotiationMessage } from '@/lib/a2aService';
import type { AgentId } from '@/theater/shared/types';

export interface ActiveFlight {
  id: string;                  // unique flight id (separate from event id)
  eventId: string;             // source LogEvent.id
  from: AgentId;
  to: AgentId;
  kind: NegotiationMessage['kind'];
  spawnedAt: number;
  textPreview: string;
}

interface UseEnvelopeFlightsOptions {
  events: LogEvent[];
  paused: boolean;
}

export interface UseEnvelopeFlightsResult {
  /** Currently in-flight envelopes. Render each as a <MessageEnvelope/>. */
  flights: ActiveFlight[];
  /** Called from MessageEnvelope's GSAP onComplete to unmount itself. */
  completeFlight: (flightId: string) => void;
  /** Manually clear all in-flight envelopes (used by debug Clear button). */
  clearFlights: () => void;
}

export function useEnvelopeFlights({
  events,
  paused,
}: UseEnvelopeFlightsOptions): UseEnvelopeFlightsResult {
  const [flights, setFlights] = useState<ActiveFlight[]>([]);
  // Index of the last event we processed. Starts at -1 so events[0] is
  // considered new on first run.
  const lastSeenIdxRef = useRef<number>(-1);

  // On mount, treat existing events as already-seen so we don't replay the
  // entire history as a barrage of envelopes when the user navigates to
  // /agents-2 mid-negotiation.
  useEffect(() => {
    lastSeenIdxRef.current = events.length - 1;
    // intentional: empty deps, run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paused) {
      // Advance the index silently so resuming doesn't dump a backlog.
      lastSeenIdxRef.current = events.length - 1;
      return;
    }
    // Process every event past the last seen index.
    const newFlights: ActiveFlight[] = [];
    for (let i = lastSeenIdxRef.current + 1; i < events.length; i++) {
      const ev = events[i];
      const flight = eventToFlight(ev);
      if (flight) newFlights.push(flight);
    }
    lastSeenIdxRef.current = events.length - 1;
    if (newFlights.length > 0) {
      setFlights(prev => [...prev, ...newFlights]);
    }
  }, [events, paused]);

  const completeFlight = useCallback((flightId: string) => {
    setFlights(prev => prev.filter(f => f.id !== flightId));
  }, []);

  const clearFlights = useCallback(() => {
    setFlights([]);
  }, []);

  return { flights, completeFlight, clearFlights };
}

/** Pure mapper: LogEvent → ActiveFlight (or null if no flight needed). */
function eventToFlight(ev: LogEvent): ActiveFlight | null {
  if (ev.kind !== 'sse') return null;
  const p = ev.payload;
  // Channel-handshake noise — same filter AgentCenter uses.
  if (p.text.includes('Connected to') && p.text.includes('events')) return null;

  let from: AgentId | null = null;
  let to: AgentId | null = null;

  if (p.channel === 'treasury') {
    if (p.text.startsWith('📨 Seller → Treasury')) {
      from = 'seller';
      to = 'treasury';
    } else if (p.text.startsWith('🏦 Treasury → Seller')) {
      from = 'treasury';
      to = 'seller';
    } else {
      // Unrecognized treasury prefix — skip rather than guess.
      return null;
    }
  } else {
    // Buyer or seller channel — from = sender, to = the other party.
    if (p.from === 'BUYER') {
      from = 'buyer';
      to = 'seller';
    } else if (p.from === 'SELLER') {
      from = 'seller';
      to = 'buyer';
    } else {
      return null;
    }
  }

  return {
    id: cryptoRandomId(),
    eventId: ev.id,
    from,
    to,
    kind: p.kind,
    spawnedAt: ev.ts,
    textPreview: p.text.slice(0, 80).replace(/\s+/g, ' '),
  };
}

/** Browser-native random id. crypto.randomUUID is used elsewhere in
 *  the project (a2aService.ts) so this is safe across all target browsers. */
function cryptoRandomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for ancient browsers — sufficient for a UI key.
    return `f-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
}
