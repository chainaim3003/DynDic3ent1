/**
 * useIpexBallet — orchestrates the IPEX grant/admit choreography
 * ---------------------------------------------------------------------------
 * Phase 3c. Watches the event log for SSE events with kind === 'invoice'.
 * For each one:
 *   1. Dedupes by event id (StrictMode-safe).
 *   2. Fetches GET http://localhost:4000/api/ipex-status (vLEI api-server).
 *      Silent failure — vLEI api-server is OPTIONAL (plain mode skips it).
 *   3. On successful fetch, spawns a BalletInstance. IpexBallet renders one
 *      pair of CredentialPacket components per ballet (GRANT then ADMIT,
 *      staggered 800ms apart by CredentialPacket's `delay` prop).
 *   4. Also pushes two synthesized 'ipex'-kind events into the event log
 *      (one per phase). Timestamps are back-dated relative to the invoice
 *      (-2000ms for GRANT, -1000ms for ADMIT) so Phase 4's BottomTimeline
 *      will render them as preceding the invoice event in chronological
 *      sort order, matching the actual KERI/vLEI semantics: GRANT and
 *      ADMIT happen BEFORE the invoice notification appears on the wire.
 *
 * Pause/skip-backlog behavior mirrors useEnvelopeFlights exactly so the
 * Theater feels consistent when you toggle pause or navigate in mid-deal.
 *
 * IMPORTANT: the visual animation is fired-in-parallel with the invoice
 * envelope (decision (b) confirmed by user). The timestamp back-dating is
 * purely for the event log / future scrubbing — it does not delay or
 * reorder the visual playback in real time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEvent } from '@/theater/shared/types';
import { BACKENDS, REST_PATHS } from '@/theater/shared/constants';

export interface BalletInstance {
  id: string;
  /** Event id of the invoice SSE that triggered this ballet. */
  eventId: string;
  /** SAID strings extracted from /api/ipex-status — used as packet labels. */
  grantSAID: string;
  admitSAID: string;
  credentialSAID: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  spawnedAt: number;
}

// Minimal shape we read from /api/ipex-status. Anything we don't recognize
// is ignored. If the api-server schema drifts, we degrade silently (the
// invoice envelope still flies via EnvelopeLayer).
interface IpexStatusResponse {
  grant?: {
    grantSAID?: string;
    credentialSAID?: string;
    invoiceNumber?: string;
    amount?: number;
    currency?: string;
    selfAttested?: boolean;
    sellerLEI?: string;
    buyerLEI?: string;
  };
  admit?: {
    grantSAID?: string;
    admitSAID?: string;
    credentialSAID?: string;
  };
}

// LogEvent push signature exposed by useEventLog. Kept loose here so we
// don't drag the full type surface into this hook's deps; the consumer
// (AgentTheater) hands us a ready-made push function.
type PushEvent = (init: {
  kind: 'ipex';
  payload: {
    phase: 'grant' | 'admit';
    grantSAID?: string;
    credentialSAID?: string;
    invoiceNumber?: string;
    amount?: number;
    currency?: string;
    selfAttested?: boolean;
    sellerLEI?: string;
    buyerLEI?: string;
  };
  ts?: number;
}) => void;

interface UseIpexBalletOptions {
  events: LogEvent[];
  paused: boolean;
  /** Optional — when provided, useIpexBallet pushes 'ipex' kind events
   *  to the event log for Phase 4+ timeline + Inspector use. */
  pushEvent?: PushEvent;
}

export interface UseIpexBalletResult {
  /** Currently airborne ballets. Render each as a <BalletSequence/>. */
  ballets: BalletInstance[];
  /** Called from BalletSequence once BOTH packets have completed. */
  completeBallet: (balletId: string) => void;
  /** Debug — clear all in-flight ballets. */
  clearBallets: () => void;
}

export function useIpexBallet({
  events,
  paused,
  pushEvent,
}: UseIpexBalletOptions): UseIpexBalletResult {
  const [ballets, setBallets] = useState<BalletInstance[]>([]);
  const lastSeenIdxRef = useRef<number>(-1);
  // Dedupe by invoice event id — StrictMode double-invokes won't fetch twice.
  const processedInvoiceIdsRef = useRef<Set<string>>(new Set());

  // Skip backlog on mount — don't replay every historical invoice as
  // ballets when navigating to /agents-2 mid-session.
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
      if (ev.payload.kind !== 'invoice') continue;
      if (processedInvoiceIdsRef.current.has(ev.id)) continue;
      processedInvoiceIdsRef.current.add(ev.id);
      // Fire & forget — async fetch + setBallets.
      void fetchAndSpawn(ev, setBallets, pushEvent);
    }
    lastSeenIdxRef.current = events.length - 1;
  }, [events, paused, pushEvent]);

  const completeBallet = useCallback((balletId: string) => {
    setBallets(prev => prev.filter(b => b.id !== balletId));
  }, []);

  const clearBallets = useCallback(() => {
    setBallets([]);
  }, []);

  return { ballets, completeBallet, clearBallets };
}

async function fetchAndSpawn(
  invoiceEvent: LogEvent,
  setBallets: React.Dispatch<React.SetStateAction<BalletInstance[]>>,
  pushEvent: PushEvent | undefined,
): Promise<void> {
  let data: IpexStatusResponse | null = null;
  try {
    const res = await fetch(`${BACKENDS.vlei}${REST_PATHS.ipexStatus}`);
    if (!res.ok) return;          // 404 etc. — plain mode, no IPEX
    data = await res.json() as IpexStatusResponse;
  } catch {
    return;                       // connection refused — vLEI server down
  }

  if (!data?.grant) return;       // unexpected schema — degrade silently

  const grant = data.grant;
  const admit = data.admit ?? {};

  const ballet: BalletInstance = {
    id: cryptoRandomId(),
    eventId: invoiceEvent.id,
    grantSAID:      grant.grantSAID      ?? '',
    admitSAID:      admit.admitSAID      ?? admit.grantSAID ?? '',
    credentialSAID: grant.credentialSAID ?? '',
    invoiceNumber:  grant.invoiceNumber  ?? '',
    amount:         grant.amount         ?? 0,
    currency:       grant.currency       ?? 'INR',
    spawnedAt: Date.now(),
  };
  setBallets(prev => [...prev, ballet]);

  // Push 'ipex' events to the log with back-dated timestamps — phase 4
  // BottomTimeline will sort by ts so they appear before the invoice.
  if (pushEvent) {
    pushEvent({
      ts: invoiceEvent.ts - 2000,
      kind: 'ipex',
      payload: {
        phase: 'grant',
        grantSAID:      grant.grantSAID,
        credentialSAID: grant.credentialSAID,
        invoiceNumber:  grant.invoiceNumber,
        amount:         grant.amount,
        currency:       grant.currency,
        selfAttested:   grant.selfAttested,
        sellerLEI:      grant.sellerLEI,
        buyerLEI:       grant.buyerLEI,
      },
    });
    pushEvent({
      ts: invoiceEvent.ts - 1000,
      kind: 'ipex',
      payload: {
        phase: 'admit',
        grantSAID:      admit.grantSAID ?? grant.grantSAID,
        credentialSAID: admit.credentialSAID ?? grant.credentialSAID,
        invoiceNumber:  grant.invoiceNumber,
        amount:         grant.amount,
        currency:       grant.currency,
      },
    });
  }
}

function cryptoRandomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `b-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
}
