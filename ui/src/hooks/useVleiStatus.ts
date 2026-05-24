/**
 * useVleiStatus — polls the vLEI api-server at :4000/api/status
 * ---------------------------------------------------------------------------
 * Provides cross-tab visibility of verification state. Since verifies happen
 * as REST calls in AgentCenter and never appear in SSE, /agents-2 (which is
 * a separate React tree when opened in another browser tab) cannot observe
 * them through the normal event channel. This hook bridges that gap by
 * polling the vLEI api-server, which tracks verification state per agent.
 *
 * Behavior:
 *   - Polls GET http://localhost:4000/api/status every POLL_INTERVAL_MS (3s)
 *   - When an agent's `verified` flips false → true, synthesizes 5 verify
 *     events (one per GLEIF step) and pushes them into the event log via
 *     pushEvent. These cascade into useVerificationRiver's trigger logic,
 *     causing the river animation to play automatically.
 *   - When the api-server is unreachable (plain mode, server down, etc.),
 *     `reachable` is set to false. Existing `verified` state is preserved
 *     so a transient network failure doesn't trigger spurious "re-verified"
 *     events on recovery.
 *
 * Plain-mode note:
 *   In plain mode (CREDENTIAL_MODE=plain), verification is GLEIF-only and
 *   doesn't touch the vLEI api-server. The endpoint will return 404 or be
 *   unreachable. The hook handles this gracefully — `reachable` stays false.
 *   The river won't auto-trigger via this path; the user can use the
 *   "Replay river" debug button or run a negotiation (which produces SSE).
 *
 * Endpoint shape (defensive — fields beyond what we use are ignored):
 *   {
 *     buyer:    { verified: boolean, agentAID?: string, lei?: string, ... },
 *     seller:   { verified: boolean, agentAID?: string, lei?: string, ... },
 *     treasury: { verified: boolean, agentAID?: string, lei?: string, ... },
 *     ...other top-level fields ignored
 *   }
 */

import { useEffect, useRef, useState } from 'react';
import { BACKENDS, REST_PATHS } from '@/theater/shared/constants';
import type { UseEventLogResult } from './useEventLog';

const POLL_INTERVAL_MS = 3000;

export interface AgentVleiStatus {
  verified: boolean;
  agentAID?: string;
  lei?: string;
}

export interface VleiStatus {
  reachable: boolean;
  lastChecked: Date | null;
  buyer:    AgentVleiStatus;
  seller:   AgentVleiStatus;
  treasury: AgentVleiStatus;
  /** 0–3, count of currently-verified agents. */
  verifiedCount: number;
}

const INITIAL_STATUS: VleiStatus = {
  reachable: false,
  lastChecked: null,
  buyer:    { verified: false },
  seller:   { verified: false },
  treasury: { verified: false },
  verifiedCount: 0,
};

const VERIFY_STEP_LABELS = [
  'AIDs loaded',
  'Delegation field verified',
  'Delegation seal verified',
  'Seal digest verified',
  'Public key found',
] as const;

interface UseVleiStatusOptions {
  /** push() from useEventLog so we can inject verify events on transitions. */
  pushEvent: UseEventLogResult['push'];
  /** When true, stop polling entirely (used when playhead is frozen during
   *  scrub — we don't want polling racing with replay). */
  paused?: boolean;
}

export function useVleiStatus({
  pushEvent,
  paused = false,
}: UseVleiStatusOptions): VleiStatus {
  const [status, setStatus] = useState<VleiStatus>(INITIAL_STATUS);
  const prevStatusRef = useRef<VleiStatus>(INITIAL_STATUS);
  // Keep latest pushEvent in a ref so the polling closure always uses
  // the current version (even though useCallback in useEventLog should
  // give it a stable identity — defensive belt-and-braces).
  const pushEventRef = useRef(pushEvent);
  pushEventRef.current = pushEvent;

  useEffect(() => {
    if (paused) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const url = `${BACKENDS.vlei}${REST_PATHS.vleiStatus}`;
        const res = await fetch(url, {
          // Keep the request lightweight — no body, no special headers,
          // browser cache disabled so we see fresh state each tick.
          method: 'GET',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;

        const next: VleiStatus = {
          reachable: true,
          lastChecked: new Date(),
          buyer:    coerceAgent(data.buyer),
          seller:   coerceAgent(data.seller),
          treasury: coerceAgent(data.treasury),
          verifiedCount: 0,
        };
        next.verifiedCount =
          (next.buyer.verified    ? 1 : 0) +
          (next.seller.verified   ? 1 : 0) +
          (next.treasury.verified ? 1 : 0);

        // Detect transitions and inject verify events.
        const prev = prevStatusRef.current;
        const transitions: Array<'buyer' | 'seller'> = [];
        if (!prev.buyer.verified  && next.buyer.verified ) transitions.push('buyer');
        if (!prev.seller.verified && next.seller.verified) transitions.push('seller');

        for (const side of transitions) {
          // Push 5 step events at 200ms stagger so the event log reads
          // like a real cascade. The 5th event triggers the river via
          // useVerificationRiver (which watches for step:5 status:ok).
          for (let step = 1; step <= 5; step++) {
            setTimeout(() => {
              pushEventRef.current({
                kind: 'verify',
                payload: {
                  side,
                  step: step as 1 | 2 | 3 | 4 | 5,
                  status: 'ok',
                  label: VERIFY_STEP_LABELS[step - 1],
                  detail: `${side} verified via vLEI api-server`,
                },
              });
            }, step * 200);
          }
        }

        prevStatusRef.current = next;
        setStatus(next);
      } catch {
        if (cancelled) return;
        // Unreachable — keep prev verified state so we don't trigger
        // spurious re-verify events on transient blip recovery.
        setStatus(prev => ({
          ...prev,
          reachable: false,
          lastChecked: new Date(),
        }));
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [paused]);

  return status;
}

function coerceAgent(raw: unknown): AgentVleiStatus {
  if (!raw || typeof raw !== 'object') return { verified: false };
  const r = raw as Record<string, unknown>;
  return {
    verified: Boolean(r.verified),
    agentAID: typeof r.agentAID === 'string' ? r.agentAID : undefined,
    lei:      typeof r.lei      === 'string' ? r.lei      : undefined,
  };
}
