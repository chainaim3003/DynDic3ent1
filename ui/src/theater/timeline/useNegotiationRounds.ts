/**
 * useNegotiationRounds — pure-derivation round inference, Phase 4b version
 * ---------------------------------------------------------------------------
 * Replicates AgentCenter's Iter-4.3 round-inference algorithm exactly:
 *   buyer's  Nth update.buyerOffer  → round N in the buyer column
 *   seller's Nth update.sellerOffer → round N in the seller column
 *
 * Reset on text matching /Negotiation started|Initial offer:/.
 *
 * Phase 4b (snapshot replay) refactor:
 *   This used to be a stateful useEffect-driven hook with refs + incremental
 *   processing — the right pattern in AgentCenter where input is a stream of
 *   SSE callbacks. Theater's input is the events ARRAY (from useEventLog), so
 *   pure `useMemo` derivation is more idiomatic AND naturally supports
 *   scrubbing: pass `viewEnd` and the derived state reflects that moment.
 *
 *   Algorithmic semantics are unchanged — Iter-4.3 is still bit-exact. Only
 *   the React plumbing changed (refs/state → memoized iteration).
 *
 * Cost: O(N) per derivation where N ≤ EVENT_LOG_MAX (2000). At a sustained
 * 60Hz scrub-drag rate that's ~120K iterations/sec — comfortable for any
 * modern browser.
 *
 * The `paused` option is no longer load-bearing — the hook always derives
 * from the inputs given. It's retained in the signature for API parity with
 * Phase 4a so the AgentTheater wiring doesn't churn.
 */

import { useMemo } from 'react';
import type { LogEvent, Round } from '@/theater/shared/types';
import { parseNegotiationUpdate } from '@/lib/a2aService';

export type NegotiationStatus = 'idle' | 'in_progress' | 'completed' | 'escalated' | 'failed';

interface UseNegotiationRoundsOptions {
  events: LogEvent[];
  paused: boolean;     // accepted for signature parity; unused
  /** Upper bound (inclusive index) for derivation. Defaults to events.length-1.
   *  Pass playhead.index to scrub: rounds reflect that moment, not the latest. */
  viewEnd?: number;
}

export interface UseNegotiationRoundsResult {
  rounds: Round[];
  status: NegotiationStatus;
  finalPrice?: number;
  totalValue?: number;
  buyerOfferCount: number;
  sellerOfferCount: number;
}

const RESET_PATTERNS = [
  /Negotiation started/,
  /Initial offer:/,
];

function shouldReset(text: string): boolean {
  return RESET_PATTERNS.some(p => p.test(text));
}

/**
 * Pure derivation. Iterates events[0..upperInclusive] once, applying
 * Iter-4.3 round inference + reset handling. Returns the snapshot at
 * that moment. Idempotent and stateless.
 */
function deriveSnapshot(events: LogEvent[], upperInclusive: number): UseNegotiationRoundsResult {
  let buyerOfferCount  = 0;
  let sellerOfferCount = 0;
  let status: NegotiationStatus = 'idle';
  let finalPrice: number | undefined;
  let totalValue: number | undefined;
  let rounds: Round[] = [];
  const processed = new Set<string>();

  const cap = Math.min(upperInclusive, events.length - 1);

  for (let i = 0; i <= cap; i++) {
    const ev = events[i];
    if (ev.kind !== 'sse') continue;
    const p = ev.payload;

    // Reset signal — clear all per-negotiation accumulators before processing
    // this event's own payload (which often carries the round-1 offer).
    if (shouldReset(p.text)) {
      buyerOfferCount  = 0;
      sellerOfferCount = 0;
      rounds = [];
      finalPrice = undefined;
      totalValue = undefined;
      processed.clear();
      // Fall through — the same event may also carry an offer.
    }

    const update = parseNegotiationUpdate(p.text);
    if (!update) continue;

    // Status transitions
    if (update.status === 'IN_PROGRESS') status = 'in_progress';
    if (update.status === 'COMPLETED') {
      status = 'completed';
      if (update.finalPrice !== undefined) finalPrice = update.finalPrice;
      if (update.totalValue !== undefined) totalValue = update.totalValue;
    }
    if (update.status === 'ESCALATED') status = 'escalated';
    if (update.status === 'FAILED')    status = 'failed';

    // Round inference — only on IN_PROGRESS messages carrying an offer
    if (update.status === 'IN_PROGRESS'
        && (update.buyerOffer !== undefined || update.sellerOffer !== undefined)) {
      if (processed.has(ev.id)) continue;
      processed.add(ev.id);

      let roundNum: number | undefined;
      let isBuyer = false;
      let isSeller = false;

      if (update.buyerOffer !== undefined) {
        buyerOfferCount += 1;
        roundNum = buyerOfferCount;
        isBuyer = true;
      } else if (update.sellerOffer !== undefined) {
        sellerOfferCount += 1;
        roundNum = sellerOfferCount;
        isSeller = true;
      }

      if (roundNum !== undefined) {
        const existing = rounds.find(r => r.round === roundNum);
        if (existing) {
          rounds = rounds.map(r => r.round === roundNum ? {
            ...r,
            buyerOffer:    isBuyer  ? update.buyerOffer  : r.buyerOffer,
            sellerOffer:   isSeller ? update.sellerOffer : r.sellerOffer,
            buyerEventId:  isBuyer  ? ev.id              : r.buyerEventId,
            sellerEventId: isSeller ? ev.id              : r.sellerEventId,
            outcome: 'IN_PROGRESS',
          } : r);
        } else {
          rounds = [...rounds, {
            round: roundNum,
            buyerOffer:    isBuyer  ? update.buyerOffer  : undefined,
            sellerOffer:   isSeller ? update.sellerOffer : undefined,
            buyerEventId:  isBuyer  ? ev.id              : undefined,
            sellerEventId: isSeller ? ev.id              : undefined,
            outcome: 'IN_PROGRESS',
          }];
        }
      }
    }
  }

  return {
    rounds,
    status,
    finalPrice,
    totalValue,
    buyerOfferCount,
    sellerOfferCount,
  };
}

export function useNegotiationRounds({
  events,
  viewEnd,
}: UseNegotiationRoundsOptions): UseNegotiationRoundsResult {
  // Default viewEnd → latest event (live behavior).
  const upper = viewEnd ?? events.length - 1;

  return useMemo(
    () => deriveSnapshot(events, upper),
    [events, upper],
  );
}
