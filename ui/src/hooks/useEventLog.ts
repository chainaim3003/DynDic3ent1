/**
 * useEventLog — bounded ring buffer of LogEvents with SSE wiring
 * ---------------------------------------------------------------------------
 * Subscribes to the three persistent SSE singletons in a2aService.ts
 * (buyer, seller, treasury) and pushes each incoming message into a ring
 * buffer of EVENT_LOG_MAX events.
 *
 * Key properties:
 *   - Read-only: this hook never triggers a negotiation. It only listens.
 *   - Safe alongside AgentCenter: a2aService refcounts listeners, so both
 *     /agents and /agents-2 can be mounted at once without leaks.
 *   - StrictMode-safe: dedupes by NegotiationMessage.id via a ref-held Set.
 *   - Ring-bounded: oldest events scroll off at EVENT_LOG_MAX (2000).
 *   - Push-friendly: exposes `push()` so Phase 2+ consumers can add
 *     non-SSE events (verify, ipex, agent-card, audit, phase).
 *
 * NOT included in this hook (intentional, comes later):
 *   - REST fetches for /api/ipex-status, /api/quality/:id, /api/recent-deals
 *     → those live in their own hooks in Phase 2/3/7 and call push() here.
 *   - Round inference → useNegotiationRounds (Phase 4) reads our events.
 *   - Phase classification → derived in Phase 4 from events + rounds.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  subscribeToNegotiationEvents,
  subscribeToSellerEvents,
  subscribeToTreasuryEvents,
  type NegotiationMessage,
} from '@/lib/a2aService';
import type { LogEvent, LogEventKind } from '@/theater/shared/types';
import { EVENT_LOG_MAX } from '@/theater/shared/constants';

// Monotonic counter for synthesizing LogEvent.id. Module-level so it's
// stable across React StrictMode remounts within a session.
let _seq = 0;
function nextId(kind: LogEventKind): string {
  _seq += 1;
  return `${kind}-${_seq}-${Date.now().toString(36)}`;
}

// Distributive helper — given a kind+payload pair, build a full LogEvent
// without losing the discriminated-union narrowing. Without this, TS
// widens the result to `LogEvent` correctly but only via the union of
// all branches, which is what we want — so a single overload is fine.
type LogEventInit = Pick<LogEvent, 'kind' | 'payload'> & { ts?: number };

function makeEvent(init: LogEventInit): LogEvent {
  const ts = init.ts ?? Date.now();
  // Cast through unknown because TS can't prove kind/payload pairs match
  // at the call site of push(), but the public API of push enforces it
  // via the Pick<LogEvent, ...> constraint. Runtime is safe.
  return { id: nextId(init.kind), ts, kind: init.kind, payload: init.payload } as LogEvent;
}

export interface UseEventLogResult {
  /** Events in newest-last (chronological) order. */
  events: LogEvent[];
  /** Current event count (== events.length). Exposed so consumers don't
   *  have to re-read events.length and trigger extra reactivity. */
  count: number;
  /** Push a non-SSE event (verify/ipex/agent-card/audit/phase). */
  push: (init: LogEventInit) => void;
  /** Clear the log AND the dedup set. Use sparingly. */
  clear: () => void;
  /**
   * Phase 8d — soak diagnostics. Counters are ref-backed so reading them
   * doesn't trigger re-renders; consumers see fresh values whenever the
   * parent re-renders for other reasons (typically when an event arrives).
   */
  stats: {
    /** Highest events.length seen since mount or last clear. */
    peak: number;
    /** Total events evicted from the ring buffer since mount or last clear. */
    dropped: number;
    /** Timestamp of the oldest event currently in the buffer (null if empty). */
    oldestTs: number | null;
  };
}

export function useEventLog(): UseEventLogResult {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  // Phase 8d — soak diagnostics. Refs because these are observed by the
  // Debug panel, not used to drive layout, so we don't want to force a
  // re-render every push solely for stat changes. (The push itself
  // already causes a re-render via setEvents.)
  const droppedRef = useRef(0);
  const peakRef = useRef(0);

  // Stable push — does not capture `events`; uses functional setState
  // so calling push() rapidly from multiple SSE channels can't drop events.
  const push = useCallback((init: LogEventInit) => {
    setEvents(prev => {
      const ev = makeEvent(init);
      let next: LogEvent[];
      if (prev.length >= EVENT_LOG_MAX) {
        // Drop the oldest, append the newest.
        const overflow = prev.length - EVENT_LOG_MAX + 1;
        droppedRef.current += overflow;
        next = [...prev.slice(overflow), ev];
      } else {
        next = [...prev, ev];
      }
      if (next.length > peakRef.current) peakRef.current = next.length;
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    seenRef.current.clear();
    droppedRef.current = 0;
    peakRef.current = 0;
    setEvents([]);
  }, []);

  // ─── Buyer SSE channel ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeToNegotiationEvents((msg: NegotiationMessage) => {
      if (seenRef.current.has(msg.id)) return;
      seenRef.current.add(msg.id);
      push({
        kind: 'sse',
        payload: {
          channel: 'buyer',
          text: msg.text,
          from: msg.from,
          kind: msg.kind,
          seq: msg.seq,
          rawTimestamp: msg.timestamp,
        },
      });
    });
    return unsub;
  }, [push]);

  // ─── Seller SSE channel ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeToSellerEvents((msg: NegotiationMessage) => {
      if (seenRef.current.has(msg.id)) return;
      seenRef.current.add(msg.id);
      push({
        kind: 'sse',
        payload: {
          channel: 'seller',
          text: msg.text,
          from: msg.from,
          kind: msg.kind,
          seq: msg.seq,
          rawTimestamp: msg.timestamp,
        },
      });
    });
    return unsub;
  }, [push]);

  // ─── Treasury SSE channel ──────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeToTreasuryEvents((msg: NegotiationMessage) => {
      if (seenRef.current.has(msg.id)) return;
      seenRef.current.add(msg.id);
      push({
        kind: 'sse',
        payload: {
          channel: 'treasury',
          text: msg.text,
          from: msg.from,
          kind: msg.kind,
          seq: msg.seq,
          rawTimestamp: msg.timestamp,
        },
      });
    });
    return unsub;
  }, [push]);

  return {
    events,
    count: events.length,
    push,
    clear,
    stats: {
      peak: peakRef.current,
      dropped: droppedRef.current,
      oldestTs: events.length > 0 ? events[0].ts : null,
    },
  };
}
