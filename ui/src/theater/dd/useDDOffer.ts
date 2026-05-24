/**
 * useDDOffer — pure-derivation: is a Dynamic Discount offer currently pending?
 * ---------------------------------------------------------------------------
 * Phase 6. Scans the event log for the most recent SSE event with
 * payload.kind === 'dd' (Dynamic Discount Offer). If found, scans forward
 * from that index for evidence the offer was resolved — accepted, declined,
 * or settled via DD invoice. If no resolution event follows, the offer is
 * still pending and the UI should surface it.
 *
 * Resolution text patterns mirror the AgentCenter setFlowStep checks
 * verbatim (a2aService classifyMessage + AgentCenter handlers) so we react
 * to the same SSE strings the live backend already produces:
 *   • 'DD accepted'              (seller side)
 *   • 'dd accept'                (user echo)
 *   • 'DD offer declined'        (seller side)
 *   • 'dd reject'                (user echo)
 *   • '✅ DD Invoice'             (DD-discounted invoice issued)
 *   • 'DD Invoice received'      (buyer-side confirmation)
 *
 * Returns the parsed DD offer (via parseDDOffer from a2aService) so callers
 * can render savings, dates, etc. without re-parsing.
 *
 * This is a pure useMemo derivation — no state, no effects, no refs.
 * Re-runs only when `events` reference changes.
 */

import { useMemo } from 'react';
import type { LogEvent } from '@/theater/shared/types';
import { parseDDOffer, type ParsedDDOffer } from '@/lib/a2aService';

export interface UseDDOfferResult {
  /** True iff a DD offer has been received and not yet accept/reject/invoice-resolved. */
  pending: boolean;
  /** Parsed DD offer fields. null when not pending. */
  offer: ParsedDDOffer | null;
  /** Event ID of the originating DD SSE message — used by AgentTheater to
   *  track per-offer overlay dismissal. null when not pending. */
  eventId: string | null;
}

const RESOLUTION_PATTERNS = [
  'DD accepted',
  'dd accept',
  'DD offer declined',
  'dd reject',
  '✅ DD Invoice',
  'DD Invoice received',
];

function isResolution(text: string): boolean {
  for (const p of RESOLUTION_PATTERNS) {
    if (text.includes(p)) return true;
  }
  return false;
}

export function useDDOffer(events: LogEvent[]): UseDDOfferResult {
  return useMemo<UseDDOfferResult>(() => {
    // Walk backwards to find the latest DD offer.
    let ddIdx = -1;
    let parsed: ParsedDDOffer | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.kind !== 'sse') continue;
      if (ev.payload.kind !== 'dd') continue;
      const p = parseDDOffer(ev.payload.text);
      if (p) { ddIdx = i; parsed = p; break; }
    }
    if (ddIdx < 0 || !parsed) {
      return { pending: false, offer: null, eventId: null };
    }
    // Walk forward from the offer to look for resolution evidence.
    for (let i = ddIdx + 1; i < events.length; i++) {
      const ev = events[i];
      if (ev.kind !== 'sse') continue;
      if (isResolution(ev.payload.text)) {
        return { pending: false, offer: null, eventId: null };
      }
    }
    return { pending: true, offer: parsed, eventId: events[ddIdx].id };
  }, [events]);
}
